"use server"

// ---------------------------------------------------------------------------
// PROCESOS DISCIPLINARIOS
//
// La empresa usuaria reporta la conducta y solicita la medida; el EMPLEADOR
// --la empresa de servicios temporales-- cita a descargos y decide. Ese reparto
// no es un detalle de flujo: sancionar sin oír al trabajador vicia la sanción
// (Art. 115 CST), y quien sanciona tiene que ser el empleador.
//
// Por eso `avanzarEstado` no deja saltar de "radicado" a "resuelto" con una
// medida: exige que los descargos hayan ocurrido.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { conductaPorId } from "@/lib/disciplinarios-catalogo"
import type {
  CrearProcesoInput,
  DisciplinariosData,
  EntradaBitacora,
  ProcesoDisciplinario,
  SoporteAdjunto,
  TrabajadorDisciplinario,
} from "@/lib/disciplinarios-tipos"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const MAX_MB = 25

function faltaTabla(msg: string | undefined): boolean {
  const m = String(msg ?? "").toLowerCase()
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("relation")
}

function mapear(r: any): ProcesoDisciplinario {
  return {
    id: String(r.id),
    radicado: r.radicado ?? "",
    identificacion: r.identificacion ?? "",
    nombre: r.nombre ?? "",
    cargo: r.cargo ?? null,
    conducta: r.conducta ?? "",
    norma: r.norma ?? null,
    medidaSugerida: r.medida_sugerida ?? null,
    fechaHecho: String(r.fecha_hecho ?? "").slice(0, 10),
    horaHecho: r.hora_hecho ?? null,
    lugar: r.lugar ?? null,
    relato: r.relato ?? "",
    testigo: r.testigo ?? null,
    testigoCargo: r.testigo_cargo ?? null,
    estado: r.estado ?? "radicado",
    fechaCitacionDescargos: r.fecha_citacion_descargos ? String(r.fecha_citacion_descargos).slice(0, 10) : null,
    fechaDescargos: r.fecha_descargos ? String(r.fecha_descargos).slice(0, 10) : null,
    medidaAplicada: r.medida_aplicada ?? null,
    fechaResolucion: r.fecha_resolucion ? String(r.fecha_resolucion).slice(0, 10) : null,
    motivoArchivo: r.motivo_archivo ?? null,
    radicadoPor: r.radicado_por ?? null,
    responsable: r.responsable ?? null,
    areaResponsable: r.area_responsable ?? null,
    documentoUrl: r.documento_url ?? null,
    documentoNombre: r.documento_nombre ?? null,
    soportes: Array.isArray(r.soportes) ? (r.soportes as SoporteAdjunto[]) : [],
    creadoEn: r.created_at ?? null,
  }
}

/** Casos de la empresa y personal activo para el selector. */
export async function getDisciplinarios(
  empresaId: number | null | undefined,
): Promise<{ success: boolean; data?: DisciplinariosData; message?: string }> {
  if (!empresaId) return { success: false, message: "Selecciona una empresa en el selector de arriba." }
  const avisos: string[] = []

  try {
    const sb: any = await getSupabaseAdmin()

    let casos: ProcesoDisciplinario[] = []
    let faltaMigracion = false
    {
      const { data, error } = await sb
        .from("procesos_disciplinarios")
        .select("*")
        .eq("idempresa", empresaId)
        .order("created_at", { ascending: false })
        .limit(100)
      if (error) {
        if (faltaTabla(error.message)) faltaMigracion = true
        else avisos.push("No se pudieron leer los casos.")
      } else {
        casos = (data ?? []).map(mapear)
      }
    }

    let trabajadores: TrabajadorDisciplinario[] = []
    try {
      const { data } = await sb
        .from("headcount")
        .select("identificacion, nombre, cargo")
        .eq("idempresa", empresaId)
        .eq("estado", "Activo")
        .order("nombre", { ascending: true })
      trabajadores = (data ?? [])
        .filter((r: any) => !/prueba/i.test(String(r.nombre ?? "")))
        .map((r: any) => ({
          identificacion: String(r.identificacion ?? "").trim(),
          nombre: r.nombre ?? "",
          cargo: r.cargo ?? null,
        }))
    } catch (e: any) {
      avisos.push("No se pudo leer el personal activo.")
      console.error("[v0] getDisciplinarios headcount:", e?.message ?? e)
    }

    return {
      success: true,
      data: {
        casos,
        trabajadores,
        resumen: {
          total: casos.length,
          radicados: casos.filter((c) => c.estado === "radicado").length,
          enDescargos: casos.filter(
            (c) => c.estado === "descargos_citados" || c.estado === "descargos_realizados",
          ).length,
          resueltos: casos.filter((c) => c.estado === "resuelto").length,
          archivados: casos.filter((c) => c.estado === "archivado").length,
        },
        avisos,
        faltaMigracion,
      },
    }
  } catch (e: any) {
    console.error("[v0] getDisciplinarios excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron cargar los casos." }
  }
}

/** Radica un caso nuevo. */
export async function crearProcesoDisciplinario(
  input: CrearProcesoInput,
): Promise<{ success: boolean; id?: string; radicado?: string; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Procesos Disciplinarios"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!input.empresaId) return { success: false, message: "Falta la empresa." }
    if (!input.identificacion || !input.nombre) return { success: false, message: "Falta el colaborador." }
    if (!input.conductaId) return { success: false, message: "Indica la conducta reportada." }
    if (!input.fechaHecho) return { success: false, message: "Indica la fecha del hecho." }
    if (!input.relato?.trim() || input.relato.trim().length < 20) {
      // El relato es la prueba del caso. Uno de tres palabras no sostiene una
      // sanción ante un juez, así que no se acepta.
      return {
        success: false,
        message: "El relato debe describir los hechos con detalle: qué pasó, cuándo y dónde.",
      }
    }

    const conducta = conductaPorId(input.conductaId)
    if (!conducta) return { success: false, message: "La conducta no es válida." }

    const hoy = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
    if (input.fechaHecho > hoy) {
      return { success: false, message: "La fecha del hecho no puede ser futura." }
    }

    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)

    // Radicado consecutivo por empresa. Se calcula del máximo actual: sin
    // secuencia propia, dos radicaciones simultáneas podrían chocar contra el
    // índice único, y en ese caso se reintenta una vez.
    const siguienteRadicado = async (): Promise<string> => {
      const { data } = await sb
        .from("procesos_disciplinarios")
        .select("radicado")
        .eq("idempresa", input.empresaId)
        .order("radicado", { ascending: false })
        .limit(1)
        .maybeSingle()
      const ultimo = Number(String(data?.radicado ?? "").replace(/\D/g, "")) || 0
      return `DIS-${String(ultimo + 1).padStart(4, "0")}`
    }

    const fila = {
      idempresa: input.empresaId,
      identificacion: input.identificacion.trim(),
      nombre: input.nombre.trim(),
      cargo: input.cargo?.trim() || null,
      conducta: conducta.etiqueta,
      norma: conducta.norma,
      medida_sugerida: conducta.medidaSugerida,
      fecha_hecho: input.fechaHecho,
      hora_hecho: input.horaHecho?.trim() || null,
      lugar: input.lugar?.trim() || null,
      relato: input.relato.trim(),
      testigo: input.testigo?.trim() || null,
      testigo_cargo: input.testigoCargo?.trim() || null,
      estado: "radicado",
      radicado_por: usuario,
      updated_at: new Date().toISOString(),
    }

    let creado: any = null
    for (let intento = 0; intento < 2; intento++) {
      const radicado = await siguienteRadicado()
      const { data, error } = await sb
        .from("procesos_disciplinarios")
        .insert({ ...fila, radicado })
        .select("id, radicado")
        .single()
      if (!error) { creado = data; break }
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/179_add_procesos_disciplinarios.sql." }
      }
      // Choque del índice único: otro caso tomó ese radicado. Se reintenta.
      if (!String(error.message).includes("uq_disc_radicado") || intento === 1) {
        return { success: false, message: error.message }
      }
    }
    if (!creado) return { success: false, message: "No se pudo radicar el caso." }

    await sb.from("procesos_disciplinarios_bitacora").insert({
      proceso_id: creado.id,
      estado_anterior: null,
      estado_nuevo: "radicado",
      nota: `Caso radicado por ${usuario ?? "usuario"}.`,
      actor: usuario,
    })

    return { success: true, id: String(creado.id), radicado: creado.radicado }
  } catch (e: any) {
    console.error("[v0] crearProcesoDisciplinario excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo radicar el caso." }
  }
}

/**
 * Mueve el caso al siguiente estado.
 *
 * El orden se valida acá y no solo en la pantalla: una sanción impuesta sin
 * descargos es ineficaz, y si el servidor la acepta, tarde o temprano alguien
 * la crea desde otro lado.
 */
export async function avanzarEstadoDisciplinario(payload: {
  empresaId: number
  id: string
  nuevoEstado: string
  fecha?: string | null
  medidaAplicada?: string | null
  nota?: string | null
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Procesos Disciplinarios"], "editar", "Avanzar estado")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)

    const { data: actual } = await sb
      .from("procesos_disciplinarios")
      .select("id, estado, fecha_descargos")
      .eq("id", payload.id)
      .eq("idempresa", payload.empresaId)
      .maybeSingle()
    if (!actual) return { success: false, message: "No se encontró el caso." }

    const patch: any = { estado: payload.nuevoEstado, updated_at: new Date().toISOString() }

    if (payload.nuevoEstado === "descargos_citados") {
      if (!payload.fecha) return { success: false, message: "Indica la fecha de la citación." }
      patch.fecha_citacion_descargos = payload.fecha
    }

    if (payload.nuevoEstado === "descargos_realizados") {
      if (!payload.fecha) return { success: false, message: "Indica la fecha de los descargos." }
      patch.fecha_descargos = payload.fecha
    }

    if (payload.nuevoEstado === "resuelto") {
      if (!payload.medidaAplicada) {
        return { success: false, message: "Indica la medida que decidió el empleador." }
      }
      const huboDescargos = actual.fecha_descargos != null
      const sinSancion = payload.medidaAplicada === "Sin sanción"
      if (!huboDescargos && !sinSancion) {
        return {
          success: false,
          message:
            "No se puede imponer una sanción sin haber oído al trabajador en descargos (Art. 115 CST). Registra primero la diligencia.",
        }
      }
      patch.medida_aplicada = payload.medidaAplicada
      patch.fecha_resolucion = payload.fecha ?? new Date().toISOString().slice(0, 10)
    }

    if (payload.nuevoEstado === "archivado") {
      if (!payload.nota?.trim()) {
        return { success: false, message: "Indica por qué se archiva el caso." }
      }
      patch.motivo_archivo = payload.nota.trim()
    }

    const { error } = await sb.from("procesos_disciplinarios").update(patch).eq("id", payload.id)
    if (error) return { success: false, message: error.message }

    await sb.from("procesos_disciplinarios_bitacora").insert({
      proceso_id: payload.id,
      estado_anterior: actual.estado,
      estado_nuevo: payload.nuevoEstado,
      nota: payload.nota?.trim() || null,
      actor: usuario,
    })

    return { success: true }
  } catch (e: any) {
    console.error("[v0] avanzarEstadoDisciplinario excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo actualizar el caso." }
  }
}

/** Sube un soporte del caso al storage. */
export async function subirSoporteDisciplinario(
  file: File,
  radicado: string,
): Promise<{ success: boolean; data?: SoporteAdjunto; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Procesos Disciplinarios"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!file) return { success: false, message: "No se seleccionó ningún archivo." }
  if (file.size > MAX_MB * 1024 * 1024) {
    return {
      success: false,
      message: `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo son ${MAX_MB} MB.`,
    }
  }
  try {
    const sb: any = await getSupabaseAdmin()
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_")
    const ext = file.name.split(".").pop() || "bin"
    const ruta = `disciplinarios/${safe(radicado)}/soporte_${Date.now()}.${ext}`

    const { error } = await sb.storage
      .from("archivos")
      .upload(ruta, file, { contentType: file.type || "application/octet-stream", upsert: false })
    if (error) return { success: false, message: error.message }

    const { data } = sb.storage.from("archivos").getPublicUrl(ruta)
    return {
      success: true,
      data: { url: data.publicUrl, nombre: file.name, subidoEn: new Date().toISOString() },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo subir el soporte." }
  }
}

/** Adjunta un soporte ya subido al caso. */
export async function agregarSoporteAlCaso(
  empresaId: number,
  id: string,
  soporte: SoporteAdjunto,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Procesos Disciplinarios"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: actual } = await sb
      .from("procesos_disciplinarios")
      .select("soportes")
      .eq("id", id)
      .eq("idempresa", empresaId)
      .maybeSingle()
    if (!actual) return { success: false, message: "No se encontró el caso." }
    const lista = Array.isArray(actual.soportes) ? actual.soportes : []
    const { error } = await sb
      .from("procesos_disciplinarios")
      .update({ soportes: [...lista, soporte], updated_at: new Date().toISOString() })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo adjuntar el soporte." }
  }
}

/**
 * Guarda el acta generada y la deja en la carpeta del trabajador.
 *
 * El PDF lo genera el navegador (jsPDF necesita DOM), así que llega acá como
 * base64 y se sube desde el servidor: así el bucket no queda expuesto al
 * cliente.
 */
export async function guardarActaDisciplinaria(payload: {
  empresaId: number
  id: string
  radicado: string
  identificacion: string
  pdfBase64: string
}): Promise<{ success: boolean; url?: string; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Procesos Disciplinarios"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const sb: any = await getSupabaseAdmin()
    const limpio = payload.pdfBase64.replace(/^data:application\/pdf;base64,/, "")
    const bytes = Buffer.from(limpio, "base64")
    if (!bytes.length) return { success: false, message: "El documento llegó vacío." }

    const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_")
    // La ruta cuelga de la CÉDULA: así el acta queda bajo la carpeta de esa
    // persona y se encuentra buscando por documento, que es como se consulta un
    // expediente laboral.
    const nombre = `acta_${safe(payload.radicado)}.pdf`
    const ruta = `carpetas/${safe(payload.identificacion)}/disciplinarios/${nombre}`

    const { error: errUp } = await sb.storage
      .from("archivos")
      .upload(ruta, bytes, { contentType: "application/pdf", upsert: true })
    if (errUp) return { success: false, message: errUp.message }

    const { data } = sb.storage.from("archivos").getPublicUrl(ruta)

    const { error } = await sb
      .from("procesos_disciplinarios")
      .update({
        documento_url: data.publicUrl,
        documento_nombre: nombre,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.id)
      .eq("idempresa", payload.empresaId)
    if (error) return { success: false, message: error.message }

    return { success: true, url: data.publicUrl }
  } catch (e: any) {
    console.error("[v0] guardarActaDisciplinaria excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo guardar el acta." }
  }
}

/** Bitácora de un caso. */
export async function getBitacoraDisciplinaria(
  id: string,
): Promise<{ success: boolean; data?: EntradaBitacora[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("procesos_disciplinarios_bitacora")
      .select("*")
      .eq("proceso_id", id)
      .order("created_at", { ascending: true })
    if (error) return { success: false, message: error.message }
    return {
      success: true,
      data: (data ?? []).map((r: any) => ({
        id: Number(r.id),
        estadoAnterior: r.estado_anterior ?? null,
        estadoNuevo: r.estado_nuevo,
        nota: r.nota ?? null,
        actor: r.actor ?? null,
        creadoEn: r.created_at,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo leer la bitácora." }
  }
}

/** Casos de una persona: alimenta la carpeta del trabajador. */
export async function getDisciplinariosDePersona(
  identificacion: string,
): Promise<{ success: boolean; data?: ProcesoDisciplinario[]; message?: string }> {
  if (!identificacion) return { success: false, message: "Falta la identificación." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("procesos_disciplinarios")
      .select("*")
      .eq("identificacion", String(identificacion).trim())
      .order("created_at", { ascending: false })
    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [] }
      return { success: false, message: error.message }
    }
    return { success: true, data: (data ?? []).map(mapear) }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudieron leer los casos." }
  }
}
