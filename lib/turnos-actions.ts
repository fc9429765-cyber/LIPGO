"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { autorizarAccion } from "@/lib/puerta-modulo"

/**
 * Server actions del modulo "Turnos" (RRHH Lip).
 *
 * El modulo opera sobre la tabla `tarifasturnos` cuya estructura es:
 *   - id           bigint identity PK
 *   - fechaini     date          (vigencia inicio)
 *   - fechafin     date          (vigencia fin)
 *   - base         numeric       (tarifa base $)
 *   - hed          numeric       (hora extra diurna)
 *   - hedf         numeric       (hora extra diurna festiva)
 *   - hen          numeric       (hora extra nocturna)
 *   - hef          numeric       (hora extra festiva — no nocturna)
 *   - hn           numeric       (recargo nocturno)
 *   - puesto       text          (nombre del cargo / posicion)
 *   - horaentrada  time          (hora de inicio del turno)
 *   - idempresa    numeric       (FK a empresa)
 *   - aplicaton    bool          (si la tarifa aplica por tonelada)
 *
 * TODAS las consultas filtran por `idempresa` para no mezclar datos
 * entre empresas. El cliente pasa `empresaId` desde el contexto de
 * autenticacion (`useAuth().selectedEmpresaId`).
 */

export interface TurnoTarifa {
  id: number
  fechaini: string | null
  fechafin: string | null
  base: number | null
  hed: number | null
  hedf: number | null
  hen: number | null
  hef: number | null
  hn: number | null
  puesto: string | null
  horaentrada: string | null
  idempresa: number | null
  /**
   * Indica si la tarifa del turno aplica con base en toneladas
   * movidas (por ejemplo, recargos por tonelada en operaciones
   * variables). Es un boolean nullable: `null` se trata igual que
   * `false` desde el front, pero conservamos la nulabilidad para no
   * romper registros historicos sin valor.
   */
  aplicaton: boolean | null
}

export type TurnoInput = Omit<TurnoTarifa, "id" | "idempresa">

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Lista todos los turnos de la empresa, ordenados por fecha de inicio
 * descendente (los mas recientes primero) y, en caso de empate, por
 * puesto alfabetico para que la lista siga siendo predecible.
 */
export async function getTurnos(empresaId: number): Promise<ActionResult<TurnoTarifa[]>> {
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("tarifasturnos")
      .select(
        "id, fechaini, fechafin, base, hed, hedf, hen, hef, hn, puesto, horaentrada, idempresa, aplicaton",
      )
      .eq("idempresa", empresaId)
      .order("fechaini", { ascending: false })
      .order("puesto", { ascending: true })

    if (error) {
      console.error("[v0] getTurnos error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as TurnoTarifa[] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    console.error("[v0] getTurnos exception:", msg)
    return { success: false, error: msg }
  }
}

/**
 * Crea un nuevo turno. `idempresa` viene del contexto del cliente, no
 * del payload, para evitar que el front-end pueda inyectar otra
 * empresa.
 */
export async function createTurno(
  empresaId: number,
  input: TurnoInput,
  clave?: string,
): Promise<ActionResult<TurnoTarifa>> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Turnos", "configurar", { clave: clave ?? "", idempresa: empresaId ?? null, referencia: "crear turno/tarifa" })
  if (!autorizacionAccion.ok) return { success: false, error: autorizacionAccion.error || "Sin autorización." }
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const payload = sanitizeTurnoInput(input, empresaId)

    const { data, error } = await supabase
      .from("tarifasturnos")
      .insert(payload)
      .select(
        "id, fechaini, fechafin, base, hed, hedf, hen, hef, hn, puesto, horaentrada, idempresa, aplicaton",
      )
      .single()

    if (error) {
      console.error("[v0] createTurno error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data as TurnoTarifa }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    console.error("[v0] createTurno exception:", msg)
    return { success: false, error: msg }
  }
}

/**
 * Actualiza un turno. Validamos que el registro pertenezca a la
 * empresa antes del update para evitar que un cliente con id de otra
 * empresa pueda editarlo. Hacemos la validacion como condicion del
 * `update` (`eq("idempresa", empresaId)`) para que sea atomica.
 */
export async function updateTurno(
  empresaId: number,
  id: number,
  input: TurnoInput,
  clave?: string,
): Promise<ActionResult<TurnoTarifa>> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Turnos", "configurar", { clave: clave ?? "", idempresa: empresaId ?? null, referencia: `editar turno/tarifa ${id}` })
  if (!autorizacionAccion.ok) return { success: false, error: autorizacionAccion.error || "Sin autorización." }
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }
  if (!id) {
    return { success: false, error: "ID de turno requerido" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const payload = sanitizeTurnoInput(input, empresaId)

    const { data, error } = await supabase
      .from("tarifasturnos")
      .update(payload)
      .eq("id", id)
      .eq("idempresa", empresaId)
      .select(
        "id, fechaini, fechafin, base, hed, hedf, hen, hef, hn, puesto, horaentrada, idempresa, aplicaton",
      )
      .single()

    if (error) {
      console.error("[v0] updateTurno error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data as TurnoTarifa }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    console.error("[v0] updateTurno exception:", msg)
    return { success: false, error: msg }
  }
}

/**
 * Elimina un turno por id, restringido a su empresa.
 */
export async function deleteTurno(
  empresaId: number,
  id: number,
  clave?: string,
): Promise<ActionResult<{ id: number }>> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Turnos", "configurar", { clave: clave ?? "", idempresa: empresaId ?? null, referencia: `eliminar turno/tarifa ${id}` })
  if (!autorizacionAccion.ok) return { success: false, error: autorizacionAccion.error || "Sin autorización." }
  if (!empresaId) {
    return { success: false, error: "Empresa no seleccionada" }
  }
  if (!id) {
    return { success: false, error: "ID de turno requerido" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const { error } = await supabase
      .from("tarifasturnos")
      .delete()
      .eq("id", id)
      .eq("idempresa", empresaId)

    if (error) {
      console.error("[v0] deleteTurno error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: { id } }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    console.error("[v0] deleteTurno exception:", msg)
    return { success: false, error: msg }
  }
}

/**
 * Normaliza el input antes de persistirlo:
 *  - cadenas vacias -> null (para que la BD interprete "no diligenciado"
 *    en vez de almacenar literales vacios).
 *  - numericos: convierte string "" -> null y "12.5" -> 12.5; rechaza
 *    NaN convirtiendolo en null.
 *  - inyecta el `idempresa` del contexto.
 */
function sanitizeTurnoInput(input: TurnoInput, empresaId: number) {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }
  const str = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    const s = String(v).trim()
    return s.length === 0 ? null : s
  }
  // Boolean tolerante: aceptamos true/false, "true"/"false" y los
  // strings "1"/"0" para que el form sea flexible. `null` se preserva
  // como tal para no sobreescribir registros historicos.
  const bool = (v: unknown): boolean | null => {
    if (v === null || v === undefined || v === "") return null
    if (typeof v === "boolean") return v
    if (typeof v === "number") return v !== 0
    const s = String(v).trim().toLowerCase()
    if (["true", "1", "si", "sí", "yes"].includes(s)) return true
    if (["false", "0", "no"].includes(s)) return false
    return null
  }

  return {
    fechaini: str(input.fechaini),
    fechafin: str(input.fechafin),
    base: num(input.base),
    hed: num(input.hed),
    hedf: num(input.hedf),
    hen: num(input.hen),
    hef: num(input.hef),
    hn: num(input.hn),
    puesto: str(input.puesto),
    horaentrada: str(input.horaentrada),
    aplicaton: bool(input.aplicaton),
    idempresa: empresaId,
  }
}
