"use server"

/**
 * Server actions del "Horario de Tolva" (Turno 1 / Turno 2), botón dedicado en
 * Programación de turnos. Es un horario COMPARTIDO por (fecha, empresa, turno)
 * — no por persona — independiente del horaentradaprogramada/horasalidaprogramada
 * normal de cada colaborador (que sigue siendo para asistencia/horas extra).
 * "Liquidación Tolva del día" lee esta ventana para clasificar los ingresos de
 * producción aprobados por turno (ver lib/liquidacion-tolva-actions.ts).
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { motivoSinAccion } from "@/lib/puerta-modulo"

export interface VentanaTurno {
  horaInicio: string | null // "HH:MM"
  horaFin: string | null
}

export interface HorarioTolvaDia {
  fecha: string
  idempresa: number
  turno1: VentanaTurno
  turno2: VentanaTurno
}

/** Lee el horario de Tolva configurado para una fecha+empresa. */
export async function getHorarioTolva(
  idempresa: number,
  fecha: string,
): Promise<{ success: boolean; data?: HorarioTolvaDia; message?: string }> {
  if (!idempresa || !fecha) return { success: false, message: "Empresa y fecha son requeridas." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { data, error } = await admin
      .from("horario_tolva")
      .select("turno, hora_inicio, hora_fin")
      .eq("idempresa", idempresa)
      .eq("fecha", fecha)
    if (error) return { success: false, message: error.message }

    const porTurno = new Map<number, VentanaTurno>()
    for (const r of data || []) {
      porTurno.set(Number(r.turno), {
        horaInicio: r.hora_inicio ? String(r.hora_inicio).slice(0, 5) : null,
        horaFin: r.hora_fin ? String(r.hora_fin).slice(0, 5) : null,
      })
    }
    return {
      success: true,
      data: {
        fecha,
        idempresa,
        turno1: porTurno.get(1) || { horaInicio: null, horaFin: null },
        turno2: porTurno.get(2) || { horaInicio: null, horaFin: null },
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al leer el horario de Tolva." }
  }
}

export interface HorarioTolvaBusqueda {
  /** "ok" trae `data`; en los demas casos hay que explicarle al usuario. */
  estado: "ok" | "sin-configurar" | "ambiguo" | "error"
  data?: HorarioTolvaDia
  /** Proyectos que tienen horario ese dia. Sirve para el caso "ambiguo". */
  empresas?: number[]
  message?: string
}

/**
 * Busca el horario de Tolva de una fecha SIN saber el proyecto.
 *
 * El horario se guarda por (fecha, empresa, turno). Cuando el tablero se abre
 * sin proyecto seleccionado -- o con uno distinto al que lo configuro -- la
 * busqueda normal no encuentra nada y la jornada se calcula contra un rango
 * supuesto sin que nadie se entere. Esta funcion resuelve el caso claro: si ese
 * dia solo UN proyecto tiene horario, se usa ese. Si hay varios NO se adivina:
 * se devuelve "ambiguo" con la lista, para que la pantalla pida elegir.
 */
export async function getHorarioTolvaPorFecha(fecha: string): Promise<HorarioTolvaBusqueda> {
  if (!fecha) return { estado: "error", message: "La fecha es requerida." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { data, error } = await admin
      .from("horario_tolva")
      .select("idempresa, turno, hora_inicio, hora_fin")
      .eq("fecha", fecha)
    if (error) return { estado: "error", message: error.message }

    const filas = data || []
    const empresas = [...new Set(filas.map((r: any) => Number(r.idempresa)))].sort(
      (a, b) => (a as number) - (b as number),
    ) as number[]
    if (empresas.length === 0) return { estado: "sin-configurar", empresas: [] }
    if (empresas.length > 1) return { estado: "ambiguo", empresas }

    const idempresa = empresas[0]
    const porTurno = new Map<number, VentanaTurno>()
    for (const r of filas) {
      porTurno.set(Number(r.turno), {
        horaInicio: r.hora_inicio ? String(r.hora_inicio).slice(0, 5) : null,
        horaFin: r.hora_fin ? String(r.hora_fin).slice(0, 5) : null,
      })
    }
    return {
      estado: "ok",
      empresas,
      data: {
        fecha,
        idempresa,
        turno1: porTurno.get(1) || { horaInicio: null, horaFin: null },
        turno2: porTurno.get(2) || { horaInicio: null, horaFin: null },
      },
    }
  } catch (e: any) {
    return { estado: "error", message: e?.message || "Error al leer el horario de Tolva." }
  }
}

/** Guarda (upsert) el horario de Turno 1/Turno 2 para una fecha+empresa. */
export async function guardarHorarioTolva(
  idempresa: number,
  fecha: string,
  turno1: VentanaTurno,
  turno2: VentanaTurno,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Programación de turnos"], "configurar", "Horario de tolva")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!idempresa || !fecha) return { success: false, message: "Empresa y fecha son requeridas." }
  try {
    const admin: any = await getSupabaseAdmin()
    const registros: any[] = []
    if (turno1.horaInicio && turno1.horaFin) {
      registros.push({
        fecha,
        idempresa,
        turno: 1,
        hora_inicio: turno1.horaInicio,
        hora_fin: turno1.horaFin,
        actualizado_en: new Date().toISOString(),
      })
    }
    if (turno2.horaInicio && turno2.horaFin) {
      registros.push({
        fecha,
        idempresa,
        turno: 2,
        hora_inicio: turno2.horaInicio,
        hora_fin: turno2.horaFin,
        actualizado_en: new Date().toISOString(),
      })
    }
    if (registros.length === 0) return { success: false, message: "Define al menos un turno con hora de inicio y fin." }

    const { error } = await admin.from("horario_tolva").upsert(registros, { onConflict: "fecha,idempresa,turno" })
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar el horario de Tolva." }
  }
}
