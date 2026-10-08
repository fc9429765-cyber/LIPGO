"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/**
 * Server actions del modulo "Bitácora" (Operación Lip).
 *
 * Opera sobre la tabla `bitacora`:
 *   - id         bigint identity PK
 *   - fecha      date         (dia del registro — se setea automatico en servidor)
 *   - bitacora   text         (texto libre con la novedad/registro)
 *   - idempresa  numeric      (FK empresa — del contexto de sesion)
 *
 * Todas las consultas filtran por `idempresa` para aislar la informacion
 * entre empresas. `fecha` siempre se calcula del lado del servidor en
 * zona horaria America/Bogota para evitar inconsistencias por relojes
 * de cliente o servidores en otra zona.
 */

export interface BitacoraRow {
  id: number
  fecha: string | null
  bitacora: string | null
  idempresa: number | null
}

export interface BitacoraInput {
  bitacora: string
}

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Devuelve la fecha "hoy" en zona horaria America/Bogota en formato
 * `YYYY-MM-DD`. Usamos Intl.DateTimeFormat con `en-CA` porque ese locale
 * formatea de forma ISO-friendly sin separadores raros.
 */
function getColombiaTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

/**
 * Lista los registros de bitacora de la empresa, ordenados por fecha
 * descendente y por id descendente como desempate para que el orden
 * sea estable cuando haya varios registros del mismo dia.
 */
export async function getBitacoras(
  empresaId: number,
): Promise<ActionResult<BitacoraRow[]>> {
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("bitacora")
      .select("id, fecha, bitacora, idempresa")
      .eq("idempresa", empresaId)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })

    if (error) {
      console.error("[v0] getBitacoras error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as BitacoraRow[] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] getBitacoras exception:", err)
    return { success: false, error: msg }
  }
}

/**
 * Crea un nuevo registro de bitacora. `fecha` se calcula en servidor
 * (Bogota) y `idempresa` se toma del parametro. El texto se valida
 * para que no sea cadena vacia (espacios solamente tampoco se aceptan).
 */
export async function createBitacora(
  empresaId: number,
  input: BitacoraInput,
): Promise<ActionResult<BitacoraRow>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Bitácora"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }
  const texto = (input.bitacora ?? "").trim()
  if (!texto) {
    return { success: false, error: "La bitácora no puede estar vacía" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const fecha = getColombiaTodayISO()
    const { data, error } = await supabase
      .from("bitacora")
      .insert({ fecha, idempresa: empresaId, bitacora: texto })
      .select("id, fecha, bitacora, idempresa")
      .single()

    if (error) {
      console.error("[v0] createBitacora error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data as BitacoraRow }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] createBitacora exception:", err)
    return { success: false, error: msg }
  }
}

/**
 * Actualiza el texto de un registro existente. `fecha` e `idempresa`
 * no se modifican; sirven como auditoria. El filtro por `idempresa` en
 * la mutacion previene tocar registros de otra empresa.
 */
export async function updateBitacora(
  empresaId: number,
  id: number,
  input: BitacoraInput,
): Promise<ActionResult<BitacoraRow>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Bitácora"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }
  if (!id) {
    return { success: false, error: "Id requerido" }
  }
  const texto = (input.bitacora ?? "").trim()
  if (!texto) {
    return { success: false, error: "La bitácora no puede estar vacía" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("bitacora")
      .update({ bitacora: texto })
      .eq("id", id)
      .eq("idempresa", empresaId)
      .select("id, fecha, bitacora, idempresa")
      .single()

    if (error) {
      console.error("[v0] updateBitacora error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data as BitacoraRow }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] updateBitacora exception:", err)
    return { success: false, error: msg }
  }
}

/**
 * Borra un registro por id; el filtro por `idempresa` actua como una
 * defensa adicional para impedir el borrado de filas de otra empresa
 * aun si llegaran ids manipulados.
 */
export async function deleteBitacora(
  empresaId: number,
  id: number,
): Promise<ActionResult> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Bitácora"], "eliminar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }
  if (!id) {
    return { success: false, error: "Id requerido" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const { error } = await supabase
      .from("bitacora")
      .delete()
      .eq("id", id)
      .eq("idempresa", empresaId)

    if (error) {
      console.error("[v0] deleteBitacora error:", error)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] deleteBitacora exception:", err)
    return { success: false, error: msg }
  }
}
