"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/**
 * Server actions del modulo "Montacargas y personal día"
 * (Gestion de Inventario).
 *
 * Opera sobre la tabla `montacargasdia` cuya estructura es:
 *   - id            bigint identity PK
 *   - fecha         date          (dia del registro — se setea automatico)
 *   - idempresa     numeric       (FK empresa — del contexto de sesion)
 *   - montacargas1  boolean       (disponibilidad montacargas 1)
 *   - montacargas2  boolean       (disponibilidad montacargas 2)
 *   - personas      numeric       (head count del dia; precargado)
 *   - aprueba       text          (responsable que aprueba el reporte)
 *   - comentarios   text          (texto libre con observaciones del dia)
 *
 * TODAS las consultas filtran por `idempresa` para no mezclar datos
 * entre empresas. El cliente pasa `empresaId` desde el contexto de
 * autenticacion (`useAuth().selectedEmpresaId`).
 *
 * Reglas particulares:
 *   - `fecha` siempre se calcula del lado del servidor en zona Bogota
 *     (America/Bogota) para que el "dia" sea estable independiente del
 *     reloj del cliente.
 *   - `personas` viene precargado desde `registroasistencia`: count
 *     distinto de `identificacion` para el `idempresa` y la `fecha` del
 *     dia donde `horaingreso IS NOT NULL` (es decir, personas que ya
 *     marcaron ingreso real ese dia). El usuario puede sobreescribir
 *     este valor antes de guardar (el formulario lo muestra editable).
 */

export interface MontacargasDiaRow {
  id: number
  fecha: string | null
  idempresa: number | null
  montacargas1: boolean | null
  montacargas2: boolean | null
  personas: number | null
  aprueba: string | null
  /** Observaciones libres del dia (campo TEXT en BD). */
  comentarios: string | null
}

export interface MontacargasDiaInput {
  montacargas1: boolean | null
  montacargas2: boolean | null
  personas: number | null
  aprueba: string | null
  /**
   * Observaciones libres del dia. Se persiste tal cual; cadenas vacias
   * se normalizan a `null` en el cliente para no guardar strings vacias
   * que despues complican filtros.
   */
  comentarios: string | null
}

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Devuelve la fecha "hoy" en zona horaria America/Bogota en formato
 * `YYYY-MM-DD`. Usamos Intl.DateTimeFormat con `en-CA` porque ese locale
 * formatea de forma ISO-friendly (`YYYY-MM-DD`) sin separadores raros.
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
 * Cuenta el "personal del dia" desde `registroasistencia`: personas
 * con `horaingreso IS NOT NULL` para la empresa y fecha indicadas, es
 * decir, las que efectivamente registraron ingreso en el dia. Antes
 * el filtro era `puesto IS NOT NULL`, pero ese criterio incluia a los
 * programados que aun no habian llegado; ahora el conteo refleja a
 * quienes realmente estan en operacion.
 *
 * Si la tabla no tiene filas todavia, devuelve 0 (no se considera error).
 *
 * Se expone para que el formulario pueda precargar `personas` al abrir
 * el dialogo de "Nuevo registro".
 */
export async function getPersonasPrecargadas(
  empresaId: number,
): Promise<ActionResult<number>> {
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const fecha = getColombiaTodayISO()
    const [{ data, error }, { data: admins }] = await Promise.all([
      supabase
        .from("registroasistencia")
        .select("identificacion", { count: "exact" })
        .eq("idempresa", empresaId)
        .eq("fecha", fecha)
        .not("horaingreso", "is", null),
      // Administrativos fuera: este conteo precarga "personas en operación".
      // `admin` es project-agnostic (hay administrativos con idempresa NULL).
      supabase
        .from("headcount")
        .select("identificacion")
        .eq("admin", true)
        .or(`idempresa.eq.${empresaId},idempresa.is.null`),
    ])

    if (error) {
      console.error("[v0] getPersonasPrecargadas error:", error)
      return { success: false, error: error.message }
    }

    const idsAdmin = new Set((admins ?? []).map((r: any) => String(r.identificacion ?? "").trim()))

    // `count: 'exact'` puede venir en data?.length cuando se proyectan
    // columnas. Para no depender de la API interna del client, contamos
    // unicos por identificacion (defensivo contra duplicados historicos).
    const unique = new Set<string>()
    for (const row of data ?? []) {
      if (row?.identificacion != null && !idsAdmin.has(String(row.identificacion).trim())) {
        unique.add(String(row.identificacion))
      }
    }
    return { success: true, data: unique.size }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] getPersonasPrecargadas exception:", err)
    return { success: false, error: msg }
  }
}

/**
 * Lista los registros de la empresa, ordenados por fecha descendente
 * (los mas recientes primero) y, en caso de empate, por id descendente
 * para que el orden sea estable y previsible.
 */
export async function getMontacargasDia(
  empresaId: number,
): Promise<ActionResult<MontacargasDiaRow[]>> {
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("montacargasdia")
      .select(
        "id, fecha, idempresa, montacargas1, montacargas2, personas, aprueba, comentarios",
      )
      .eq("idempresa", empresaId)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })

    if (error) {
      console.error("[v0] getMontacargasDia error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as MontacargasDiaRow[] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] getMontacargasDia exception:", err)
    return { success: false, error: msg }
  }
}

/**
 * Crea un registro nuevo. `fecha` se calcula en servidor (Bogota) y
 * `idempresa` se toma del parametro `empresaId`. El resto de campos
 * viene del formulario.
 */
export async function createMontacargasDia(
  empresaId: number,
  input: MontacargasDiaInput,
): Promise<ActionResult<MontacargasDiaRow>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Montacargas y personal día"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const fecha = getColombiaTodayISO()
    const { data, error } = await supabase
      .from("montacargasdia")
      .insert({
        fecha,
        idempresa: empresaId,
        montacargas1: input.montacargas1,
        montacargas2: input.montacargas2,
        personas: input.personas,
        aprueba: input.aprueba,
        comentarios: input.comentarios,
      })
      .select(
        "id, fecha, idempresa, montacargas1, montacargas2, personas, aprueba, comentarios",
      )
      .single()

    if (error) {
      console.error("[v0] createMontacargasDia error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data as MontacargasDiaRow }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] createMontacargasDia exception:", err)
    return { success: false, error: msg }
  }
}

/**
 * Actualiza un registro existente. La `fecha` y el `idempresa` no se
 * modifican; sirven como datos de auditoria del momento original. Si
 * el usuario quiere registrar un nuevo dia, debe crear otra fila.
 */
export async function updateMontacargasDia(
  empresaId: number,
  id: number,
  input: MontacargasDiaInput,
): Promise<ActionResult<MontacargasDiaRow>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Montacargas y personal día"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }
  if (!id) {
    return { success: false, error: "Id requerido" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("montacargasdia")
      .update({
        montacargas1: input.montacargas1,
        montacargas2: input.montacargas2,
        personas: input.personas,
        aprueba: input.aprueba,
        comentarios: input.comentarios,
      })
      .eq("id", id)
      .eq("idempresa", empresaId)
      .select(
        "id, fecha, idempresa, montacargas1, montacargas2, personas, aprueba, comentarios",
      )
      .single()

    if (error) {
      console.error("[v0] updateMontacargasDia error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data as MontacargasDiaRow }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] updateMontacargasDia exception:", err)
    return { success: false, error: msg }
  }
}

/**
 * Borra un registro por id, asegurando que pertenezca a la empresa
 * actual (defensa en profundidad: aun si alguien manda un id ajeno,
 * el filtro por `idempresa` impide tocar datos de otra empresa).
 */
export async function deleteMontacargasDia(
  empresaId: number,
  id: number,
): Promise<ActionResult> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Montacargas y personal día"], "eliminar")
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
      .from("montacargasdia")
      .delete()
      .eq("id", id)
      .eq("idempresa", empresaId)

    if (error) {
      console.error("[v0] deleteMontacargasDia error:", error)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] deleteMontacargasDia exception:", err)
    return { success: false, error: msg }
  }
}
