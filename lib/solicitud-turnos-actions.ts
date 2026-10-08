"use server"

import { createClient } from "@/lib/supabase"
import { motivoSinAccion } from "@/lib/puerta-modulo"

interface LineaSolicitud {
  puesto: string
  fecharequerida: string
  cantidad: number
  // Nuevo: tipo de servicio adicional solicitado.
  // Valores permitidos: "Turnos" | "Horas Extra". Se guarda en la columna
  // `tipo` de la tabla solicitudesturnos para que el módulo Aprobar Turnos
  // y el historial puedan mostrarlo.
  tipo: string
}

interface CreateSolicitudParams {
  nombresolicitante: string
  lineas: LineaSolicitud[]
  firmasolicitante: string | null
  idempresa: number | null
  usuariosolicitud?: string | null
}

export async function createSolicitudTurnos(params: CreateSolicitudParams) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Servicios Adicionales"], "crear", "Solicitar servicio")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  
  try {
    const fechasolicitud = new Date().toISOString().split("T")[0]
    
    // Create one record per line (puesto)
    const records = params.lineas.map((linea) => ({
      fechasolicitud,
      idempresa: params.idempresa,
      // TRIM obligatorio: el puesto se cruza por igualdad estricta contra
      // `tarifasfacturacionturnos` (facturación de horas extra) y contra
      // `registroasistencia`. Un espacio sobrante rompe el cruce en silencio.
      puesto: (linea.puesto || "").trim(),
      fecharequerida: linea.fecharequerida,
      nombresolicitante: params.nombresolicitante,
      estado: "pendiente",
      cantidad: linea.cantidad,
      firmasolicitante: params.firmasolicitante,
      nombreaprobo: null,
      firmaaprobo: null,
      usuariosolicitud: params.usuariosolicitud,
      // Persistimos el tipo de servicio por línea (Turnos / Horas Extra).
      tipo: linea.tipo || "Turnos",
    }))

    const { data, error } = await supabase
      .from("solicitudesturnos")
      .insert(records)
      .select()

    if (error) {
      console.error("[v0] Error creating solicitud turnos:", error)
      return { success: false, message: error.message }
    }

    return { success: true, data }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado al crear la solicitud" }
  }
}

export async function getSolicitudesTurnos(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  
  try {
    let query = supabase
      .from("solicitudesturnos")
      .select("*")
      .order("fechasolicitud", { ascending: false })

    if (selectedEmpresaId) {
      query = query.eq("idempresa", selectedEmpresaId)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching solicitudes turnos:", error)
      return { success: false, data: [], message: error.message }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, data: [], message: "Error inesperado" }
  }
}

export async function getSolicitudesPendientes(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  
  try {
    let query = supabase
      .from("solicitudesturnos")
      .select("*")
      .eq("estado", "pendiente")
      .order("fechasolicitud", { ascending: false })

    if (selectedEmpresaId) {
      query = query.eq("idempresa", selectedEmpresaId)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching solicitudes pendientes:", error)
      return { success: false, data: [], message: error.message }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, data: [], message: "Error inesperado" }
  }
}

/** Persona asignada por el coordinador a una solicitud. */
export interface PersonaAsignada {
  nombre: string
  /** Cedula. Es la llave del cruce contra `registroasistencia`. */
  identificacion: string
}

interface AprobarSolicitudesParams {
  ids: number[]
  nombreaprobo: string
  firmaaprobo: string | null
  personal?: string // Lista de personas separadas por coma (columna `personal`)
  /**
   * Mismo personal que `personal`, pero con la cedula de cada uno. Es lo que
   * permite programar las horas extra por persona. Se mantiene `personal`
   * aparte porque el PDF y el detalle de la solicitud ya leen esa columna.
   */
  personalDetalle?: PersonaAsignada[]
}

/** Normaliza para comparar (sin tildes, minusculas, espacios colapsados). */
function normalizarTexto(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

/**
 * Una solicitud es de horas extra cuando su `tipo` es "Horas Extra". El valor
 * por defecto de la UI es "Turnos", asi que un `tipo` vacio NO es horas extra.
 * Mismo criterio que usa la vista `solicitud_horas_extras`.
 */
function esHorasExtra(tipo: unknown): boolean {
  return normalizarTexto(tipo || "Turnos") === "horas extra"
}

export async function aprobarSolicitudes(params: AprobarSolicitudesParams) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Aprobar Turnos"], "aprobar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  
  try {
    // Get Colombia time
    const now = new Date()
    const colombiaTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
    const fechahoraprobo = colombiaTime.toISOString()

    const updateData: Record<string, unknown> = {
      estado: "aprobado",
      nombreaprobo: params.nombreaprobo,
      firmaaprobo: params.firmaaprobo,
      fechahoraprobo: fechahoraprobo,
    }

    // Add personal field if provided
    if (params.personal) {
      updateData.personal = params.personal
    }

    // Cedulas del personal asignado, en el MISMO orden que `personal`. La
    // vista `solicitud_horas_extras` las alinea por posicion para exponer
    // `identificacion_empleado`, que es con lo que el modulo de horas extra
    // cruza contra `registroasistencia` (el cruce por nombre queda de
    // respaldo para lo aprobado antes de este cambio).
    if (params.personalDetalle && params.personalDetalle.length > 0) {
      updateData.personal_identificaciones = params.personalDetalle
        .map((p) => (p.identificacion || "").trim())
        .join(", ")
    }

    const { data, error } = await supabase
      .from("solicitudesturnos")
      .update(updateData)
      .in("id", params.ids)
      .select()

    if (error) {
      console.error("[v0] Error approving solicitudes:", error)
      return { success: false, message: error.message }
    }

    // El reparto de las horas entre el personal NO se hace aqui: lo resuelve la
    // vista `solicitud_horas_extras` a partir de `personal` y `cantidad` (ver
    // scripts/121_create_solicitud_horas_extras.sql). Hacerlo en la vista corrige
    // ademas, de forma retroactiva, todas las solicitudes ya aprobadas.
    //
    // Lo unico que se advierte aqui es el caso en que unas horas extra se
    // aprueben SIN personal asignado: la vista no puede repartir entre nadie,
    // asi que esa solicitud no llega al modulo de horas extra.
    const advertencias: string[] = []
    const sinPersonal =
      (params.personalDetalle?.length ?? 0) === 0 &&
      (data ?? []).some((s: any) => esHorasExtra(s.tipo))

    if (sinPersonal) {
      advertencias.push(
        "Se aprobaron solicitudes de horas extra sin personal asignado, asi que no quedaran programadas por persona.",
      )
    }

    return { success: true, data, advertencias }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado al aprobar las solicitudes" }
  }
}

export async function rechazarSolicitudes(ids: number[], nombreaprobo: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Aprobar Turnos"], "anular", "Rechazar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  
  try {
    const now = new Date()
    const colombiaTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
    const fechahoraprobo = colombiaTime.toISOString()

    const { data, error } = await supabase
      .from("solicitudesturnos")
      .update({
        estado: "rechazado",
        nombreaprobo: nombreaprobo,
        fechahoraprobo: fechahoraprobo,
      })
      .in("id", ids)
      .select()

    if (error) {
      console.error("[v0] Error rejecting solicitudes:", error)
      return { success: false, message: error.message }
    }

    return { success: true, data }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado al rechazar las solicitudes" }
  }
}

export async function getSolicitudesAprobadas(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  
  try {
    let query = supabase
      .from("solicitudesturnos")
      .select("*")
      .eq("estado", "aprobado")
      .order("fechahoraprobo", { ascending: false })

    if (selectedEmpresaId) {
      query = query.eq("idempresa", selectedEmpresaId)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching solicitudes aprobadas:", error)
      return { success: false, data: [], message: error.message }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, data: [], message: "Error inesperado" }
  }
}

export async function updatePdfUrl(ids: number[], pdfUrl: string) {
  const supabase = await createClient()
  
  try {
    const { error } = await supabase
      .from("solicitudesturnos")
      .update({ pdfaprobacion: pdfUrl })
      .in("id", ids)

    if (error) {
      console.error("[v0] Error updating PDF URL:", error)
      return { success: false, message: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado" }
  }
}

export async function getEmpresaData(empresaId: number) {
  const supabase = await createClient()
  
  try {
    const { data, error } = await supabase
      .from("empresas_permisos")
      .select("id, nombre, nit, direccion")
      .eq("id", empresaId)
      .maybeSingle()

    if (error) {
      console.error("[v0] Error fetching empresa data from empresas_permisos:", error)
      return null
    }

    // Return default empresa data if not found
    if (!data) {
      return { id: empresaId, nombre: `Empresa ${empresaId}`, nit: null, direccion: null }
    }

    return data
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return null
  }
}

/**
 * Catálogo de PUESTOS para el formulario de solicitud, tomado del maestro de
 * facturación de turnos (`tarifasfacturacionturnos`).
 *
 * Por qué de esta tabla y no de `tarifasturnos`: el puesto solicitado se cruza
 * después contra lo que se le FACTURA al cliente por horas extra
 * (`tarifasfacturacionturnos.tarifahoraextra`, ver Conciliación Avimol). Si el
 * puesto se escribiera libre —como era antes— el cruce fallaba en silencio: el
 * JOIN de facturación es igualdad estricta, sin TRIM ni normalización de tildes.
 *
 * El catálogo es TRANSVERSAL (no se filtra por empresa): `tarifasfacturacionturnos`
 * es una tabla global, su `idempresa` está casi sin asignar (ver
 * lib/company-constants.ts). Si un puesto aparece en varias vigencias, se
 * conserva una sola entrada. Mismo patrón que `getPuestosFromTarifas`
 * (lib/programacion-turnos-actions.ts).
 */
export async function getPuestosFacturacion(): Promise<{
  success: boolean
  data: string[]
  message?: string
}> {
  const supabase = await createClient()
  try {
    const { data, error } = await supabase
      .from("tarifasfacturacionturnos")
      .select("puesto, fechainicio")
      .order("fechainicio", { ascending: false, nullsFirst: false })

    if (error) {
      console.error("[v0] Error fetching puestos de facturación:", error)
      return { success: false, data: [], message: error.message }
    }

    const vistos = new Set<string>()
    for (const row of data || []) {
      const puesto = String(row.puesto || "").trim()
      if (puesto) vistos.add(puesto)
    }

    return {
      success: true,
      data: Array.from(vistos).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })),
    }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, data: [], message: "Error inesperado al cargar los puestos" }
  }
}
