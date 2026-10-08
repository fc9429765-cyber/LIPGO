"use server"

import { createClient } from "@/lib/supabase/server"
import { getCurrentEmpresaId } from "@/lib/company-filter"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/**
 * Normaliza a "HH:MM:SS" lo que devuelva `asistencia.hora`.
 *
 * /api/attendance/register escribe esa columna como string "HH:MM:SS", pero el
 * script de creacion la declara TIMESTAMPTZ, asi que segun como haya quedado el
 * tipo real en produccion puede volver como "14:30:00" o como un timestamp
 * completo. Se soportan ambos en vez de asumir uno.
 */
function normalizarHora(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  const texto = String(valor).trim()
  if (!texto) return null

  // Ya viene como hora suelta: "14:30" o "14:30:00".
  const soloHora = texto.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (soloHora) {
    const [, h, m, s] = soloHora
    return `${h.padStart(2, "0")}:${m}:${s ?? "00"}`
  }

  // Timestamp completo: se lee en hora de Colombia, que es la zona en la que
  // se captura la marcacion.
  const fecha = new Date(texto)
  if (!Number.isNaN(fecha.getTime())) {
    return fecha.toLocaleTimeString("en-GB", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }

  return null
}

/** Fecha comparable "YYYY-MM-DD" a partir de un date o timestamp. */
function soloFecha(valor: unknown): string {
  return String(valor ?? "").slice(0, 10)
}

/**
 * Hora de entrada del dia de una persona. `asistencia` es la fuente de verdad
 * del ingreso diario (una fila por persona/dia); se consulta con la misma forma
 * de query que usa /api/attendance/register.
 */
async function buscarHoraEntrada(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: number | null | undefined,
  identificacion: string,
  fecha: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("asistencia")
    .select("hora")
    .eq("idempresa", empresaId)
    .eq("identificacion", identificacion)
    .eq("fecha", fecha)
    .limit(1)

  if (error) {
    console.error("[v0] Error consultando hora de entrada en asistencia:", error)
    return null
  }

  return normalizarHora(data?.[0]?.hora)
}

export async function savePreoperacional(formData: Record<string, unknown>, selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Registro Preoperacional"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId || await getCurrentEmpresaId()

    // Get current date/time in Colombia timezone
    const colombiaDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) // YYYY-MM-DD format

    // Log de diagnostico: confirmamos que la firma esta llegando al
    // server action. Si llega vacia, el problema es upstream (upload
    // del componente). Si llega bien pero no se persiste, el problema
    // es el insert (columna mal escrita, RLS, etc.). Solo logueamos
    // un booleano + el largo para no exponer la URL completa.
    const firmaIn = (formData as any).firma
    console.log(
      "[v0] savePreoperacional firma recibida:",
      typeof firmaIn,
      firmaIn ? String(firmaIn).length : 0,
    )

    // Hora de entrada del operador: FOTO tomada al guardar. Si la persona
    // todavia no ha marcado entrada queda null (caso valido y relevante para el
    // negocio: diligencio el preoperacional sin marcar). El Historial resuelve
    // esos nulos al leer, por si la marcacion llega despues.
    const identificacionOperador = String((formData as any).identificacion_operador ?? "").trim()
    const horaEntrada = identificacionOperador
      ? await buscarHoraEntrada(supabase, empresaId, identificacionOperador, colombiaDate)
      : null

    const payload = {
      ...formData,
      identificacion_operador: identificacionOperador || null,
      hora_entrada_operador: horaEntrada,
      fecha: colombiaDate,
      idempresa: empresaId,
    }
    const { data, error } = await supabase
      .from("inspecciones_montacargas")
      .insert([payload])
      .select("id, firma")
      .single()

    if (error) {
      console.error("[v0] Error saving preoperacional:", error)
      return { success: false, error: error.message }
    }

    // Confirmamos en el log que el campo `firma` quedo persistido en
    // la fila recien creada. Si aqui sale null/empty pero firmaIn era
    // truthy, hay un mismatch de columna.
    console.log("[v0] savePreoperacional insertado id:", data?.id, "firma len:", data?.firma ? String(data.firma).length : 0)

    return { success: true }
  } catch (error) {
    console.error("[v0] Unexpected error in savePreoperacional:", error)
    return { success: false, error: "Error inesperado al guardar" }
  }
}

export async function getPreoperacionalHistory(selectedEmpresaId?: number | null) {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId || await getCurrentEmpresaId()

    const { data, error } = await supabase
      .from("inspecciones_montacargas")
      .select("*")
      .eq("idempresa", empresaId)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[v0] Error fetching preoperacional history:", error)
      return { success: false, error: error.message, data: [] }
    }

    const registros = data || []

    // Resolver la hora de entrada que quedo en null al guardar. Pasa cuando el
    // preoperacional se diligencio ANTES de que la persona marcara entrada: la
    // foto salio vacia, pero la marcacion ya existe. Se resuelve al leer para
    // que el Historial no muestre un hueco permanente.
    const porResolver = registros.filter(
      (r: any) => r.identificacion_operador && !r.hora_entrada_operador,
    )

    if (porResolver.length > 0) {
      const identificaciones = [...new Set(porResolver.map((r: any) => r.identificacion_operador))]
      const fechas = [...new Set(porResolver.map((r: any) => r.fecha))]

      const { data: marcaciones, error: errorAsistencia } = await supabase
        .from("asistencia")
        .select("identificacion, fecha, hora")
        .eq("idempresa", empresaId)
        .in("identificacion", identificaciones)
        .in("fecha", fechas)

      if (errorAsistencia) {
        // No bloquea el historial: se muestra sin la hora de entrada.
        console.error("[v0] Error resolviendo horas de entrada del historial:", errorAsistencia)
      } else {
        const porClave = new Map<string, string | null>()
        for (const m of marcaciones ?? []) {
          porClave.set(`${m.identificacion}|${soloFecha(m.fecha)}`, normalizarHora(m.hora))
        }
        for (const r of porResolver) {
          const hora = porClave.get(`${(r as any).identificacion_operador}|${soloFecha((r as any).fecha)}`)
          if (hora) (r as any).hora_entrada_operador = hora
        }
      }
    }

    return { success: true, data: registros }
  } catch (error) {
    console.error("[v0] Unexpected error in getPreoperacionalHistory:", error)
    return { success: false, error: "Error al cargar historial", data: [] }
  }
}

export async function getPreoperacionalDashboardData(
  selectedEmpresaId?: number | null,
  dateFrom?: string,
  dateTo?: string
) {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId || await getCurrentEmpresaId()

    let query = supabase
      .from("inspecciones_montacargas")
      .select("*")
      .eq("idempresa", empresaId)
      .order("fecha", { ascending: true })

    if (dateFrom) {
      query = query.gte("fecha", dateFrom)
    }
    if (dateTo) {
      query = query.lte("fecha", dateTo)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching preoperacional dashboard data:", error)
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Unexpected error in getPreoperacionalDashboardData:", error)
    return { success: false, error: "Error al cargar datos del dashboard", data: [] }
  }
}
