"use server"

// ---------------------------------------------------------------------------
// ENVÍO DEL CIERRE DIARIO DE PRODUCCIÓN
//
// Calcula las cifras del día, arma el PDF y lo manda por WhatsApp adjunto a la
// plantilla `resumen_produccion_dia`.
//
// LA EMPRESA ESTÁ FIJA EN 1 POR AHORA. Las cifras de producción NO están
// segmentadas por empresa --ninguna consulta del dashboard filtra por
// `idempresa`-- así que generar un PDF "por empresa" daría cuatro archivos con
// los mismos números y solo cambiaría el horario de tolva. Se manda uno solo,
// y cuando la producción se pueda atribuir por empresa se abre aquí.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { construirPdfResumenProduccion } from "@/lib/resumen-produccion-pdf"
import { getResumenProduccionDia } from "@/lib/resumen-produccion-dia"
import { enviarPlantilla, getPlantillasDeMeta, subirArchivoAMeta } from "@/lib/whatsapp-actions"
import { normalizarTelefono } from "@/lib/whatsapp-actions"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { utcDateStr } from "@/lib/paros-produccion"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const PLANTILLA = "resumen_produccion_dia"
const EMPRESA = 1
const EMPRESA_NOMBRE = "Harinera Indupan"

function fmtFecha(iso: string): string {
  const [a, m, d] = iso.split("-")
  return `${d}/${m}/${a}`
}

/**
 * La línea de resumen que va en el cuerpo del mensaje.
 *
 * El PDF trae el detalle; esto es lo que se lee sin abrirlo, en la
 * notificación del teléfono. Por eso son cuatro cifras y no diez.
 */
function armarResumen(r: Awaited<ReturnType<typeof getResumenProduccionDia>>["data"]): string {
  if (!r) return "Sin datos"
  const partes = [
    `${Math.round(r.totalBultos).toLocaleString("es-CO")} bultos`,
    `${r.cumplimientoPct.toFixed(0)}% de la meta`,
    `OEE ${r.oee.toFixed(0)}%`,
  ]
  if (r.parosTotal > 0) {
    const h = Math.floor(r.parosMinutos / 60)
    const m = Math.round(r.parosMinutos % 60)
    partes.push(`${r.parosTotal} paros (${h > 0 ? `${h}h ${m}m` : `${m}m`})`)
  }
  return partes.join(" · ")
}

export interface ConfigCierre {
  activo: boolean
  horaEnvio: string
  empresaId: number
  actualizadoPor: string | null
}

export interface DestinatarioCierre {
  id: number
  nombre: string
  telefono: string
  activo: boolean
}

function faltaTabla(msg: string | undefined): boolean {
  const m = String(msg ?? "").toLowerCase()
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("relation")
}

/** La configuración del envío automático. */
export async function getConfigCierre(): Promise<{
  success: boolean
  data?: ConfigCierre
  faltaMigracion?: boolean
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("cierre_produccion_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle()

    if (error) {
      if (faltaTabla(error.message)) return { success: true, faltaMigracion: true }
      return { success: false, message: error.message }
    }
    if (!data) return { success: true, faltaMigracion: true }

    return {
      success: true,
      data: {
        activo: data.activo === true,
        // Postgres devuelve "20:00:00"; en la pantalla sobra el segundo campo.
        horaEnvio: String(data.hora_envio ?? "20:00").slice(0, 5),
        empresaId: Number(data.empresa_id ?? 1),
        actualizadoPor: data.actualizado_por ?? null,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function guardarConfigCierre(payload: {
  activo: boolean
  horaEnvio: string
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Dashboard de Producción", "Reporte de Paros", "Notificaciones al Personal"], "configurar", "Configurar cierre de producción")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const sb: any = await getSupabaseAdmin()

    // Activar sin destinatarios no enviaría nada y parecería roto.
    if (payload.activo) {
      const { data: dest } = await sb
        .from("cierre_produccion_destinatarios")
        .select("id")
        .eq("activo", true)
        .limit(1)
      if (!dest?.length) {
        return { success: false, message: "Agrega al menos un destinatario antes de activar." }
      }
    }

    const usuario = await getCurrentUsuarioForInsert().catch(() => null)
    const { error } = await sb
      .from("cierre_produccion_config")
      .update({
        activo: payload.activo,
        hora_envio: payload.horaEnvio,
        actualizado_por: usuario ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)

    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/197_cierre_produccion_automatico.sql." }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function getDestinatariosCierre(): Promise<{
  success: boolean
  data?: DestinatarioCierre[]
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("cierre_produccion_destinatarios")
      .select("*")
      .order("nombre", { ascending: true })
    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [] }
      return { success: false, message: error.message }
    }
    return {
      success: true,
      data: (data ?? []).map((d: any) => ({
        id: Number(d.id),
        nombre: d.nombre,
        telefono: d.telefono,
        activo: d.activo !== false,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function guardarDestinatarioCierre(payload: {
  nombre: string
  telefono: string
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Dashboard de Producción", "Reporte de Paros", "Notificaciones al Personal"], "configurar", "Destinatarios del cierre")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!payload.nombre?.trim()) return { success: false, message: "Ponle un nombre." }

    // Se normaliza al guardar, no al enviar: un número mal escrito aquí haría
    // fallar el envío de esa persona todos los días, y el fallo aparecería
    // mucho después.
    const telefono = await normalizarTelefono(payload.telefono)
    if (!telefono) {
      return {
        success: false,
        message: `"${payload.telefono}" no es un número válido. En Colombia son 10 dígitos empezando por 3.`,
      }
    }

    const sb: any = await getSupabaseAdmin()
    const { error } = await sb
      .from("cierre_produccion_destinatarios")
      .insert({ nombre: payload.nombre.trim(), telefono, activo: true })

    if (error) {
      if (String(error.message).includes("uq_cierre_prod_telefono")) {
        return { success: false, message: "Ese número ya está en la lista." }
      }
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/197_cierre_produccion_automatico.sql." }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function eliminarDestinatarioCierre(
  id: number,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Dashboard de Producción", "Reporte de Paros", "Notificaciones al Personal"], "configurar", "Destinatarios del cierre")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("cierre_produccion_destinatarios").delete().eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

/**
 * Estado de la plantilla en Meta.
 *
 * La pantalla lo muestra ANTES de que alguien pulse enviar: el fallo más
 * probable es que la plantilla se haya aprobado con otro nombre, y Meta lo
 * reporta como "no existe", que se lee como si nunca se hubiera creado.
 */
export async function getEstadoPlantillaProduccion(): Promise<{
  aprobada: boolean
  nombreBuscado: string
  idioma: string | null
  categoria: string | null
  estado: string | null
  /** Otras plantillas aprobadas, por si quedó con un nombre distinto. */
  candidatas: string[]
  message?: string
}> {
  const base = {
    aprobada: false,
    nombreBuscado: PLANTILLA,
    idioma: null,
    categoria: null,
    estado: null,
    candidatas: [] as string[],
  }
  try {
    const meta = await getPlantillasDeMeta()
    if (!meta.success) return { ...base, message: meta.message }

    const t = meta.data?.find((x) => x.nombre === PLANTILLA)
    const candidatas = (meta.data ?? [])
      .filter((x) => x.estado === "APPROVED" && x.nombre !== PLANTILLA)
      .map((x) => x.nombre)

    if (!t) {
      return {
        ...base,
        candidatas,
        message: `No existe una plantilla llamada "${PLANTILLA}" en Meta.`,
      }
    }
    return {
      aprobada: t.estado === "APPROVED",
      nombreBuscado: PLANTILLA,
      idioma: t.idioma,
      categoria: t.categoria,
      estado: t.estado,
      candidatas,
    }
  } catch (e: any) {
    return { ...base, message: e?.message }
  }
}

/** El PDF del día, para descargarlo desde la pantalla. */
export async function getPdfResumenProduccion(
  fecha?: string,
): Promise<{ success: boolean; pdf?: string; nombre?: string; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const dia = fecha || utcDateStr()
    const r = await getResumenProduccionDia(sb, EMPRESA, dia)
    if (!r.success || !r.data) return { success: false, message: r.message }

    const buffer = await construirPdfResumenProduccion(r.data, EMPRESA_NOMBRE)
    return {
      success: true,
      // Base64 porque un server action no puede devolver un Buffer crudo.
      pdf: Buffer.from(buffer).toString("base64"),
      nombre: `Cierre produccion ${dia}.pdf`,
    }
  } catch (e: any) {
    console.error("[v0] getPdfResumenProduccion:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo generar el PDF." }
  }
}

/** Las cifras del día, para la vista previa de la pantalla. */
export async function getCifrasProduccionDia(fecha?: string) {
  const sb: any = await getSupabaseAdmin()
  return getResumenProduccionDia(sb, EMPRESA, fecha || utcDateStr())
}

/**
 * Manda el cierre del día por WhatsApp.
 *
 * NUNCA LANZA: la va a llamar una tarea programada, y un fallo hacia afuera
 * dejaría el error solo en los registros de Vercel, donde nadie mira.
 */
export async function enviarResumenProduccion(payload: {
  telefono: string
  fecha?: string
}): Promise<{ success: boolean; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const dia = payload.fecha || utcDateStr()

    // --- 1) Las cifras -----------------------------------------------------
    const r = await getResumenProduccionDia(sb, EMPRESA, dia)
    if (!r.success || !r.data) {
      return { success: false, message: r.message ?? "No se pudieron calcular las cifras." }
    }

    // Un día sin producción no se manda: el mensaje se cobra igual y un PDF en
    // ceros no informa nada que no diga su ausencia.
    if (r.data.totalBultos === 0) {
      return { success: false, message: `El ${fmtFecha(dia)} no registra producción.` }
    }

    // --- 2) La plantilla ---------------------------------------------------
    // El idioma y el formato de las variables se leen de Meta: `en`, `es` y
    // `es_CO` son plantillas distintas y mandar el equivocado falla con un
    // error que no dice cuál es el problema.
    const meta = await getPlantillasDeMeta()
    if (!meta.success) {
      return { success: false, message: `No se pudo consultar a Meta: ${meta.message ?? ""}` }
    }
    const propia = meta.data?.find((t) => t.nombre === PLANTILLA && t.estado === "APPROVED")
    if (!propia) {
      const otra = meta.data?.find((t) => t.nombre === PLANTILLA)
      return {
        success: false,
        message: otra
          ? `La plantilla "${PLANTILLA}" está en estado ${otra.estado} en Meta, no aprobada.`
          : `No existe una plantilla llamada "${PLANTILLA}" en Meta.`,
      }
    }

    // --- 3) El PDF ---------------------------------------------------------
    const buffer = await construirPdfResumenProduccion(r.data, EMPRESA_NOMBRE)
    const subida = await subirArchivoAMeta(Buffer.from(buffer), "application/pdf")
    if (!subida.success || !subida.mediaId) {
      return { success: false, message: subida.message ?? "No se pudo subir el PDF." }
    }

    // --- 4) El envío -------------------------------------------------------
    const body = [fmtFecha(dia), armarResumen(r.data)]
    const nombresBody =
      propia.conNombre
        ? propia.varsBody.length === body.length
          ? propia.varsBody
          : ["fecha", "resumen"]
        : undefined

    const env = await enviarPlantilla({
      empresaId: EMPRESA,
      telefono: payload.telefono,
      plantilla: PLANTILLA,
      idioma: propia.idioma,
      headerDocId: subida.mediaId,
      headerDocNombre: `Cierre produccion ${dia}.pdf`,
      body,
      nombresBody,
      origen: "produccion:cierre_dia",
    })

    if (!env.success) return { success: false, message: env.message }
    return { success: true }
  } catch (e: any) {
    console.error("[v0] enviarResumenProduccion:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo enviar el resumen." }
  }
}

/**
 * Manda el cierre a TODOS los destinatarios activos.
 *
 * La usa el cron y también el botón de "enviar a todos" de la pantalla.
 *
 * `origen` distingue las pruebas de lo programado. Los automáticos llevan un
 * índice único por día y destinatario --un cron que corriera dos veces no
 * duplica el cobro-- y las pruebas no, porque repetirlas es justo lo que se
 * hace al probar.
 */
export async function enviarCierreATodos(payload?: {
  fecha?: string
  origen?: "manual" | "automatico"
}): Promise<{ enviados: number; fallidos: number; message?: string }> {
  const origen = payload?.origen ?? "manual"
  try {
    const sb: any = await getSupabaseAdmin()
    const dia = payload?.fecha || utcDateStr()

    const { data: dest } = await sb
      .from("cierre_produccion_destinatarios")
      .select("*")
      .eq("activo", true)

    if (!dest?.length) return { enviados: 0, fallidos: 0, message: "No hay destinatarios activos." }

    let enviados = 0
    let fallidos = 0

    for (const d of dest) {
      if (origen === "automatico") {
        // Ya se mandó hoy a esta persona: no se repite ni se cobra otra vez.
        const { data: ya } = await sb
          .from("cierre_produccion_enviados")
          .select("id")
          .eq("fecha", dia)
          .eq("telefono", d.telefono)
          .eq("origen", "automatico")
          .maybeSingle()
        if (ya) continue
      }

      const r = await enviarResumenProduccion({ telefono: d.telefono, fecha: dia })

      try {
        await sb.from("cierre_produccion_enviados").insert({
          fecha: dia,
          telefono: d.telefono,
          motivo: r.success ? null : r.message ?? null,
          origen,
        })
      } catch {
        // El índice único lo rechaza si otra llamada ya lo registró.
      }

      if (r.success) enviados++
      else fallidos++
    }

    return { enviados, fallidos }
  } catch (e: any) {
    console.error("[v0] enviarCierreATodos:", e?.message ?? e)
    return { enviados: 0, fallidos: 0, message: e?.message }
  }
}

/** Historial de envíos del cierre, para la pantalla. */
export async function getHistorialCierre(limite = 30): Promise<{
  success: boolean
  data?: Array<{
    id: number
    fecha: string
    telefono: string
    motivo: string | null
    origen: string
    creadoEn: string
  }>
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("cierre_produccion_enviados")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limite)
    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [] }
      return { success: false, message: error.message }
    }
    return {
      success: true,
      data: (data ?? []).map((e: any) => ({
        id: Number(e.id),
        fecha: e.fecha,
        telefono: e.telefono,
        motivo: e.motivo ?? null,
        origen: e.origen ?? "automatico",
        creadoEn: e.created_at,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}
