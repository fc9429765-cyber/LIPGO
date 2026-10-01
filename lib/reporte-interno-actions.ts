"use server"

// ---------------------------------------------------------------------------
// REPORTE INTERNO DE OPERACIÓN
//
// Avisos por WhatsApp a números internos de LIP en los cinco momentos de la
// línea de tiempo de un cargue: pesaje, orden creada, lote, muelle y cierre.
//
// NO ES LA NOTIFICACIÓN AL CONDUCTOR. Aquella le escribe al conductor de cada
// orden; esta le escribe a LIP. Comparten la idea pero no el destinatario ni el
// contenido, y por eso viven en tablas y archivos separados.
//
// NADA DE ESTO PUEDE TUMBAR UNA OPERACIÓN. `reportarInterno` se llama desde el
// cierre de un cargue, la creación de una orden y la asignación de un muelle:
// si fallara hacia afuera, un problema de WhatsApp impediría cerrar un camión.
// Por eso NUNCA lanza; devuelve por qué no se envió.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { enviarPlantilla, getPlantillasDeMeta, normalizarTelefono } from "@/lib/whatsapp-actions"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import type {
  AvisoInterno,
  ConfigInterno,
  ContextoInterno,
  DestinatarioInterno,
  EventoInterno,
} from "@/lib/reporte-interno-tipos"

const PLANTILLA = "reporte_interno_operacion"

function faltaTabla(msg: string | undefined): boolean {
  const m = String(msg ?? "").toLowerCase()
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("relation")
}

function mapearConfig(r: any): ConfigInterno {
  return {
    id: Number(r.id),
    evento: r.evento,
    nombre: r.nombre,
    ordenLinea: Number(r.orden_linea ?? 0),
    activo: r.activo === true,
    detalle: r.detalle ?? "",
    empresas: Array.isArray(r.empresas) ? r.empresas.map(Number) : [],
    actualizadoPor: r.actualizado_por ?? null,
  }
}

function mapearDestinatario(r: any): DestinatarioInterno {
  return {
    id: Number(r.id),
    nombre: r.nombre,
    telefono: r.telefono,
    activo: r.activo !== false,
    soloEventos: Array.isArray(r.solo_eventos) ? r.solo_eventos : [],
    empresas: Array.isArray(r.empresas) ? r.empresas.map(Number) : [],
  }
}

/** Los cinco eventos, en orden de la línea de tiempo. */
export async function getConfigInterno(): Promise<{
  success: boolean
  data?: ConfigInterno[]
  faltaMigracion?: boolean
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("reporte_interno_config")
      .select("*")
      .order("orden_linea", { ascending: true })
    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [], faltaMigracion: true }
      return { success: false, message: error.message }
    }
    return { success: true, data: (data ?? []).map(mapearConfig) }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo leer la configuración." }
  }
}

export async function guardarConfigInterno(payload: {
  evento: EventoInterno
  activo: boolean
  detalle: string
  empresas: number[]
}): Promise<{ success: boolean; message?: string }> {
  try {
    if (!payload.detalle?.trim()) {
      return { success: false, message: "El detalle no puede estar vacío." }
    }

    // Activar sin empresas no enviaría nada y parecería roto.
    if (payload.activo && payload.empresas.length === 0) {
      return { success: false, message: "Selecciona al menos una empresa antes de activar." }
    }

    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)
    const { error } = await sb
      .from("reporte_interno_config")
      .update({
        activo: payload.activo,
        // Los saltos de línea rompen el envío: viaja dentro de una variable.
        detalle: payload.detalle.replace(/\s*\n+\s*/g, " · ").trim(),
        empresas: payload.empresas,
        actualizado_por: usuario ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("evento", payload.evento)

    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/196_reporte_interno_operacion.sql." }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo guardar." }
  }
}

/**
 * Estado de la plantilla en Meta, para la pantalla.
 *
 * Que exista el registro en LIPgo no significa que Meta la tenga aprobada, ni
 * que el idioma coincida. Sin esto, un aviso que no sale obliga a revisar en
 * WhatsApp Manager para saber por qué.
 */
export async function getEstadoPlantillaInterna(): Promise<{
  aprobada: boolean
  idioma: string | null
  categoria: string | null
  estado: string | null
  message?: string
}> {
  try {
    const meta = await getPlantillasDeMeta()
    if (!meta.success) {
      return { aprobada: false, idioma: null, categoria: null, estado: null, message: meta.message }
    }
    const t = meta.data?.find((x) => x.nombre === PLANTILLA)
    if (!t) {
      return {
        aprobada: false,
        idioma: null,
        categoria: null,
        estado: null,
        message: `No existe una plantilla llamada "${PLANTILLA}" en Meta.`,
      }
    }
    return {
      aprobada: t.estado === "APPROVED",
      idioma: t.idioma,
      categoria: t.categoria,
      estado: t.estado,
    }
  } catch (e: any) {
    return { aprobada: false, idioma: null, categoria: null, estado: null, message: e?.message }
  }
}

/** A quiénes les llegan los avisos. */
export async function getDestinatarios(): Promise<{
  success: boolean
  data?: DestinatarioInterno[]
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("reporte_interno_destinatarios")
      .select("*")
      .order("nombre", { ascending: true })
    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [] }
      return { success: false, message: error.message }
    }
    return { success: true, data: (data ?? []).map(mapearDestinatario) }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function guardarDestinatario(payload: {
  id?: number
  nombre: string
  telefono: string
  activo: boolean
  soloEventos: EventoInterno[]
  /** Vacío = todas las empresas del evento. */
  empresas?: number[]
}): Promise<{ success: boolean; message?: string }> {
  try {
    if (!payload.nombre?.trim()) return { success: false, message: "Ponle un nombre." }

    // Se normaliza al guardar y no al enviar: un número mal escrito aquí haría
    // fallar TODOS los avisos de esa persona, y el fallo aparecería mucho
    // después, en el historial.
    const telefono = await normalizarTelefono(payload.telefono)
    if (!telefono) {
      return {
        success: false,
        message: `"${payload.telefono}" no es un número válido. En Colombia son 10 dígitos empezando por 3.`,
      }
    }

    const sb: any = await getSupabaseAdmin()
    const empresas = payload.empresas ?? []
    const fila = {
      nombre: payload.nombre.trim(),
      telefono,
      activo: payload.activo,
      solo_eventos: payload.soloEventos,
      empresas,
    }

    /*
     * Un número que ya está en la lista NO crea otra fila: se le fusionan las
     * empresas.
     *
     * Antes lo impedía un índice único, pero ahora un mismo número puede
     * registrarse legítimamente para empresas distintas. Crear dos filas haría
     * que esa persona recibiera cada aviso DOS VECES, y se cobrarían los dos.
     */
    if (!payload.id) {
      const { data: ya } = await sb
        .from("reporte_interno_destinatarios")
        .select("id, empresas")
        .eq("telefono", telefono)
        .maybeSingle()

      if (ya) {
        const previas: number[] = Array.isArray(ya.empresas) ? ya.empresas.map(Number) : []
        // Si alguna de las dos es "todas" (vacío), el resultado es todas.
        const fusion =
          previas.length === 0 || empresas.length === 0
            ? []
            : [...new Set([...previas, ...empresas])].sort((a, b) => a - b)

        const { error } = await sb
          .from("reporte_interno_destinatarios")
          .update({ ...fila, empresas: fusion })
          .eq("id", ya.id)
        if (error) return { success: false, message: error.message }
        return { success: true }
      }
    }

    const { error } = payload.id
      ? await sb.from("reporte_interno_destinatarios").update(fila).eq("id", payload.id)
      : await sb.from("reporte_interno_destinatarios").insert(fila)

    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/196_reporte_interno_operacion.sql." }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo guardar." }
  }
}

export async function eliminarDestinatario(id: number): Promise<{ success: boolean; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("reporte_interno_destinatarios").delete().eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

/** Los nombres de las empresas, para la variable `sede`. */
const SEDES: Record<number, string> = {
  1: "Harinera Indupan",
  2: "Avimol",
  3: "Cedi Funza",
  4: "Cedi Medellín",
}

/**
 * Reemplaza los marcadores del detalle con los datos del cargue.
 *
 * Un marcador sin dato se va en vacío y se limpian los separadores que quedan
 * sueltos: sin eso, un mensaje sin lote saldría con « · · » en medio.
 */
function armarDetalle(plantilla: string, ctx: ContextoInterno): string {
  const val: Record<string, string> = {
    conductor: ctx.conductor ?? "",
    cliente: ctx.cliente ?? "",
    muelle: ctx.muelle == null ? "" : String(ctx.muelle),
    lote: ctx.lote ?? "",
    peso: ctx.peso == null ? "" : ctx.peso.toLocaleString("es-CO"),
    tiquete: ctx.tiquete ?? "",
    transporte: ctx.transporte ?? "",
    hora: ctx.hora ?? "",
    sede: ctx.sede ?? "",
  }

  let t = String(plantilla ?? "")
  for (const [k, v] of Object.entries(val)) {
    t = t.replace(new RegExp(`\\{${k}\\}`, "gi"), v)
  }

  return t
    // Una etiqueta cuyo valor quedó vacío ("Lote: · Cliente: X") sobra entera.
    .replace(/[A-Za-zÁÉÍÓÚáéíóúÑñ ]+:\s*(?=·|$)/g, "")
    .replace(/\s*\n+\s*/g, " · ")
    .replace(/(\s*·\s*)+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/**
 * Envía el aviso interno de un evento.
 *
 * NUNCA LANZA. Se llama desde el cierre de cargues, la creación de órdenes y la
 * asignación de muelles: si fallara hacia afuera, WhatsApp podría impedir
 * cerrar un camión.
 */
export async function reportarInterno(
  evento: EventoInterno,
  ordenId: number,
  extra?: { lote?: string | null; peso?: number | null; tiquete?: string | null },
): Promise<{ enviados: number; motivo?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()

    // --- 1) ¿Está encendido? -----------------------------------------------
    const { data: cfgRow, error: errCfg } = await sb
      .from("reporte_interno_config")
      .select("*")
      .eq("evento", evento)
      .maybeSingle()

    if (errCfg || !cfgRow) return { enviados: 0, motivo: "Evento no configurado." }
    const cfg = mapearConfig(cfgRow)
    if (!cfg.activo) return { enviados: 0, motivo: "El aviso está desactivado." }

    // --- 2) Los datos del cargue -------------------------------------------
    const { data: orden } = await sb
      .from("cabeceraoc")
      .select(
        "id, idempresa, ordendecargue, placa, conductor, cliente, muelle, transporte, pesovascula, pesoorden, tiquetebascula",
      )
      .eq("id", ordenId)
      .maybeSingle()
    if (!orden) return { enviados: 0, motivo: "No se encontró la orden." }

    const empresaId = Number(orden.idempresa)
    if (!cfg.empresas.includes(empresaId)) {
      return { enviados: 0, motivo: `No está habilitado para la empresa ${empresaId}.` }
    }

    const ahora = new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date())

    const ctx: ContextoInterno = {
      ordenId,
      empresaId,
      placa: orden.placa ?? null,
      ordenDeCargue: orden.ordendecargue ?? null,
      conductor: orden.conductor ?? null,
      cliente: orden.cliente ?? null,
      muelle: orden.muelle == null ? null : Number(orden.muelle),
      lote: extra?.lote ?? null,
      // El peso de báscula es el real; el de la orden es lo programado. Al
      // crear la orden todavía no hay báscula, así que se cae al programado.
      peso: extra?.peso ?? (orden.pesovascula ?? orden.pesoorden ?? null),
      tiquete: extra?.tiquete ?? orden.tiquetebascula ?? null,
      transporte: orden.transporte ?? null,
      hora: ahora,
      sede: SEDES[empresaId] ?? `Empresa ${empresaId}`,
    }

    const detalle = armarDetalle(cfg.detalle, ctx)
    const vehiculo = [ctx.placa, ctx.ordenDeCargue ? `Orden ${ctx.ordenDeCargue}` : null]
      .filter(Boolean)
      .join(" · ")

    // --- 3) A quiénes ------------------------------------------------------
    const { data: destRows } = await sb
      .from("reporte_interno_destinatarios")
      .select("*")
      .eq("activo", true)
    const destinatarios = (destRows ?? [])
      .map(mapearDestinatario)
      // `solo_eventos` vacío = todos los eventos.
      .filter((d: DestinatarioInterno) => !d.soloEventos.length || d.soloEventos.includes(evento))
      /*
       * `empresas` vacío = todas las del evento.
       *
       * Es lo contrario de lo que significa en la configuración del evento,
       * donde vacío es ninguna. Allá vacío protege --activar un evento no debe
       * empezar a escribir de proyectos que nadie revisó-- y aquí es el caso
       * normal: gerencia recibe todo, y los coordinadores solo lo suyo.
       */
      .filter((d: DestinatarioInterno) => !d.empresas.length || d.empresas.includes(empresaId))

    if (!destinatarios.length) {
      return { enviados: 0, motivo: `Nadie recibe este evento para la empresa ${empresaId}.` }
    }

    /*
     * --- 4) Cómo está la plantilla en Meta ---------------------------------
     *
     * El idioma se LEE de Meta, no se asume. `en`, `es` y `es_CO` son
     * plantillas DISTINTAS para Meta: pedir una en el idioma equivocado falla
     * con el error 132001, que dice "no existe" aunque esté aprobada. Esta
     * quedó aprobada en inglés --el texto es español, pero el código declarado
     * es `en`-- y funciona porque esto lo consulta antes de cada envío.
     *
     * También de ahí sale si las variables llevan nombre ({{evento}}) o son
     * posicionales ({{1}}): mandar el formato equivocado falla con el 100.
     */
    const meta = await getPlantillasDeMeta()
    if (!meta.success) {
      // Sin respuesta de Meta no se envía: mandar con el idioma o el formato
      // equivocado gasta un mensaje que se cobra y nunca llega.
      return { enviados: 0, motivo: `No se pudo consultar a Meta: ${meta.message ?? "sin detalle"}` }
    }

    const propia = meta.data?.find((t) => t.nombre === PLANTILLA && t.estado === "APPROVED")
    if (!propia) {
      const otra = meta.data?.find((t) => t.nombre === PLANTILLA)
      return {
        enviados: 0,
        motivo: otra
          ? `La plantilla "${PLANTILLA}" está en estado ${otra.estado} en Meta, no aprobada.`
          : `La plantilla "${PLANTILLA}" no existe en Meta con ese nombre exacto.`,
      }
    }

    const nombresBody = propia.conNombre
      ? propia.varsBody.length === 3
        ? propia.varsBody
        : ["evento", "vehiculo", "detalle"]
      : undefined

    // --- 5) Enviar ---------------------------------------------------------
    let enviados = 0
    for (const d of destinatarios) {
      // Una vez por orden, evento y destinatario: reasignar un muelle o
      // corregir un peso dispararía el mismo aviso otra vez.
      const { data: ya } = await sb
        .from("reporte_interno_enviados")
        .select("id")
        .eq("orden_id", ordenId)
        .eq("evento", evento)
        .eq("telefono", d.telefono)
        .maybeSingle()
      if (ya) continue

      const r = await enviarPlantilla({
        empresaId,
        telefono: d.telefono,
        plantilla: PLANTILLA,
        idioma: propia.idioma,
        body: [cfg.nombre, vehiculo || "—", detalle || "Sin detalle"],
        nombresBody,
        origen: `interno:${evento}`,
        nombre: d.nombre,
      })

      // Se registra aunque falle: un intento fallido también cuenta como "ya se
      // intentó", y evita que un reintento inunde al destinatario.
      try {
        await sb.from("reporte_interno_enviados").insert({
          orden_id: ordenId,
          evento,
          telefono: d.telefono,
          mensaje_id: r.messageId ?? null,
          motivo: r.success ? null : r.message ?? null,
        })
      } catch {
        // El índice único lo rechaza si otra llamada ya lo registró.
      }

      if (r.success) enviados++
    }

    return { enviados }
  } catch (e: any) {
    console.error("[v0] reportarInterno:", e?.message ?? e)
    return { enviados: 0, motivo: e?.message || "Error al enviar el aviso." }
  }
}

/** Historial de los avisos internos, con el estado real de cada mensaje. */
export async function getHistorialInterno(
  limite = 50,
): Promise<{ success: boolean; data?: AvisoInterno[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: envios, error } = await sb
      .from("reporte_interno_enviados")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limite)

    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [] }
      return { success: false, message: error.message }
    }
    if (!envios?.length) return { success: true, data: [] }

    const ids = envios.map((e: any) => e.mensaje_id).filter(Boolean)
    const porMensaje: Record<string, any> = {}
    if (ids.length) {
      const { data: msgs } = await sb
        .from("whatsapp_mensajes")
        .select("message_id, estado, error_codigo, error_detalle")
        .in("message_id", ids)
      for (const m of msgs ?? []) porMensaje[String(m.message_id)] = m
    }

    const ordenIds = [...new Set(envios.map((e: any) => Number(e.orden_id)))]
    const porOrden: Record<number, any> = {}
    if (ordenIds.length) {
      const { data: ords } = await sb
        .from("cabeceraoc")
        .select("id, ordendecargue, placa")
        .in("id", ordenIds)
      for (const o of ords ?? []) porOrden[Number(o.id)] = o
    }

    const { data: cfgs } = await sb.from("reporte_interno_config").select("evento, nombre")
    const nombres: Record<string, string> = {}
    for (const c of cfgs ?? []) nombres[c.evento] = c.nombre

    return {
      success: true,
      data: envios.map((e: any) => {
        const m = e.mensaje_id ? porMensaje[String(e.mensaje_id)] : null
        const o = porOrden[Number(e.orden_id)]
        return {
          id: Number(e.id),
          ordenId: Number(e.orden_id),
          evento: e.evento,
          eventoNombre: nombres[e.evento] ?? e.evento,
          ordenDeCargue: o?.ordendecargue ?? null,
          placa: o?.placa ?? null,
          telefono: e.telefono ?? null,
          estado: m?.estado ?? null,
          errorCodigo: m?.error_codigo ?? null,
          errorDetalle: m?.error_detalle ?? null,
          motivo: e.motivo ?? null,
          creadoEn: e.created_at,
        }
      }),
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo leer el historial." }
  }
}
