"use server"

// ---------------------------------------------------------------------------
// REQUISICIONES DE PERSONAL — factores de costo y lectura por empresa.
//
// El costo mensual estimado de una vacante NO usa un factor quemado en el
// código: se compone de los porcentajes reales que ya viven en la base y que
// son editables porque la ley cambia:
//   · `parametros_prestaciones` — prima, cesantías, intereses, vacaciones
//   · `parametros_parafiscales` — pensión, salud, ARL, SENA, ICBF, caja
//
// Un "×1,52" fijo se vuelve mentira en cuanto cambie una tasa, y nadie se
// entera hasta que alguien cotiza mal.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import type { FactoresCosto } from "@/lib/requisicion-causales"
import { CARGOS_HEADCOUNT, cargoCanonico } from "@/lib/headcount-cargos"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// ---------------------------------------------------------------------------
// CATÁLOGOS DE LA REQUISICIÓN — "todo amarrado" (gerencia, 2026-09-30).
//
// La requisición ya no se escribe a mano: el CARGO sale de la lista fija de
// Head Count (lib/headcount-cargos.ts), el PUESTO operativo del maestro de
// turnos (`tarifasturnos`, el mismo catálogo que usa Programación de Turnos) y
// el TURNO de `turnos_definicion` de la empresa. El salario de referencia es la
// mediana de lo que hoy ganan los activos con ese cargo en la misma planta, y
// se contrasta con el SMLV vigente de `parametros_legales_anio`.
// ---------------------------------------------------------------------------

export interface CargoCatalogo {
  cargo: string
  /** Activos hoy con ese cargo en la planta. */
  activos: number
  /** Mediana del salario contractual de esos activos; null si no hay dato. */
  salarioReferencia: number | null
}

export interface PuestoCatalogo {
  puesto: string
  especialidad: boolean
  /** Hora de entrada del maestro ("HH:MM") si está definida. */
  horaEntrada: string | null
  /** Tarifa base vigente del turno ($) si está definida. */
  tarifaBase: number | null
}

export interface TurnoCatalogo {
  codigo: string
  nombre: string
  horaInicio: string
  horaFin: string
  /** Texto que se guarda en `vacantes.turno`, p. ej. "T1 · 06:00–14:00". */
  etiqueta: string
}

export interface CatalogosRequisicion {
  cargos: CargoCatalogo[]
  puestos: PuestoCatalogo[]
  turnos: TurnoCatalogo[]
  /** Ciudad más frecuente entre los activos de la planta (headcount.ciudad). */
  ciudad: string | null
  /** Salario mínimo legal vigente del año, o null si no está parametrizado. */
  smlv: number | null
  /** Planta/proyecto (owners.nombre) para el texto de la pantalla. */
  proyecto: string | null
}

const hhmm = (v: unknown) => (v ? String(v).slice(0, 5) : null)

function mediana(nums: number[]): number | null {
  const v = nums.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2)
}

export async function getCatalogosRequisicion(
  empresaId: number | null | undefined,
): Promise<{ success: boolean; data?: CatalogosRequisicion; message?: string }> {
  if (!empresaId) return { success: false, message: "Selecciona una empresa en el selector de arriba." }
  try {
    const sb: any = await getSupabaseAdmin()
    const anio = new Date().getFullYear()

    const [hc, tt, td, par, own] = await Promise.all([
      sb.from("headcount").select("cargo, salario, ciudad").eq("idempresa", empresaId).eq("estado", "Activo").not("admin", "is", true).limit(2000),
      // Sin filtro de empresa, igual que getPuestosFromTarifas (Programación de
      // Turnos): el catálogo de puestos es transversal; filtrado por empresa,
      // Indupan queda sin puestos.
      sb.from("tarifasturnos").select("puesto, especialidad, horaentrada, base, fechaini").order("fechaini", { ascending: false, nullsFirst: false }).limit(2000),
      sb.from("turnos_definicion").select("codigo, nombre, hora_inicio, hora_fin, es_administrativo, activo, orden").eq("idempresa", empresaId).eq("activo", true).order("orden").order("codigo"),
      sb.from("parametros_legales_anio").select("smlv").eq("anio", anio).maybeSingle(),
      sb.from("owners").select("nombre").eq("id", empresaId).maybeSingle(),
    ])

    // Cargos: lista fija de Head Count + cuántos activos hay y qué ganan.
    const porCargo = new Map<string, number[]>()
    const ciudades = new Map<string, number>()
    for (const r of (hc.data ?? []) as any[]) {
      const c = cargoCanonico(r.cargo)
      if (c) {
        if (!porCargo.has(c)) porCargo.set(c, [])
        porCargo.get(c)!.push(Number(r.salario) || 0)
      }
      const ciu = String(r.ciudad ?? "").trim()
      if (ciu) ciudades.set(ciu, (ciudades.get(ciu) || 0) + 1)
    }
    const cargos: CargoCatalogo[] = CARGOS_HEADCOUNT.map((c) => ({
      cargo: c,
      activos: porCargo.get(c)?.length ?? 0,
      salarioReferencia: mediana(porCargo.get(c) ?? []),
    }))

    // Puestos: una fila por puesto, con la tarifa más reciente (lista viene por fechaini desc).
    const puestosMap = new Map<string, PuestoCatalogo>()
    for (const r of (tt.data ?? []) as any[]) {
      const p = String(r.puesto ?? "").trim()
      if (!p || puestosMap.has(p)) continue
      puestosMap.set(p, {
        puesto: p,
        especialidad: r.especialidad === true,
        horaEntrada: hhmm(r.horaentrada),
        tarifaBase: r.base != null ? Number(r.base) : null,
      })
    }
    const puestos = [...puestosMap.values()].sort((a, b) => a.puesto.localeCompare(b.puesto, "es", { sensitivity: "base" }))

    // Turnos: los definidos para la empresa (sin administrativos). Si no hay,
    // se ofrecen las horas de entrada distintas del maestro de puestos.
    let turnos: TurnoCatalogo[] = ((td.data ?? []) as any[])
      .filter((t) => !t.es_administrativo)
      .map((t) => {
        const hi = hhmm(t.hora_inicio) ?? ""
        const hf = hhmm(t.hora_fin) ?? ""
        return { codigo: String(t.codigo), nombre: String(t.nombre ?? t.codigo), horaInicio: hi, horaFin: hf, etiqueta: `${t.codigo} · ${hi}–${hf}` }
      })
    if (turnos.length === 0) {
      const horas = [...new Set(puestos.map((p) => p.horaEntrada).filter((h): h is string => !!h))].sort()
      turnos = horas.map((h) => ({ codigo: h, nombre: `Entrada ${h}`, horaInicio: h, horaFin: "", etiqueta: `Entrada ${h}` }))
    }

    const ciudad = [...ciudades.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const smlv = par.data?.smlv != null ? Number(par.data.smlv) : null

    return { success: true, data: { cargos, puestos, turnos, ciudad, smlv, proyecto: own.data?.nombre ?? null } }
  } catch (e: any) {
    console.error("[v0] getCatalogosRequisicion excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron leer los catálogos." }
  }
}

/** Tasas de ARL por clase de riesgo (Decreto 1772/1994). */
const ARL_POR_CLASE: Record<string, number> = {
  I: 0.522,
  II: 1.044,
  III: 2.436,
  IV: 4.35,
  V: 6.96,
}

/**
 * Margen de administración (AIU) por defecto.
 *
 * NO existe en la base: no hay tabla ni columna que lo guarde hoy. Se deja como
 * valor editable en la pantalla, arrancando en 0 para que nadie cotice con un
 * margen que nadie definió. Cuando el negocio fije el suyo, este es el lugar
 * para persistirlo.
 */
export async function getFactoresCosto(
  empresaId: number | null | undefined,
): Promise<{
  success: boolean
  data?: FactoresCosto & { detalle: string[]; aiuDeclarado: boolean }
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const detalle: string[] = []

    // --- PRESTACIONES ------------------------------------------------------
    let pctPrestaciones = 0
    try {
      const { data } = await sb
        .from("parametros_prestaciones")
        .select("pct_prima, pct_cesantias, pct_intereses_cesantias, pct_vacaciones")
        .eq("id", 1)
        .maybeSingle()
      if (data) {
        const prima = Number(data.pct_prima) || 0
        const ces = Number(data.pct_cesantias) || 0
        // Los intereses a las cesantías son 12% ANUAL sobre las cesantías, que
        // a su vez son 8.33% mensual: el equivalente mensual es 12% de 8.33%,
        // no 12% del salario. Tomarlo directo inflaría el costo casi 11 puntos.
        const intMensual = (Number(data.pct_intereses_cesantias) || 0) / 100 * ces
        const vac = Number(data.pct_vacaciones) || 0
        pctPrestaciones = prima + ces + intMensual + vac
        detalle.push(
          `Prestaciones ${pctPrestaciones.toFixed(2)}% (prima ${prima}% + cesantías ${ces}% + intereses ${intMensual.toFixed(2)}% + vacaciones ${vac}%)`,
        )
      }
    } catch (e: any) {
      console.error("[v0] getFactoresCosto prestaciones:", e?.message ?? e)
    }

    // --- APORTES PATRONALES ------------------------------------------------
    let pctAportes = 0
    let exonerada = false
    try {
      const { data } = await sb
        .from("parametros_parafiscales")
        .select(
          "pct_pension_empleador, pct_salud_empleador, pct_sena, pct_icbf, pct_caja, clase_arl_operativo",
        )
        .limit(1)
        .maybeSingle()
      if (data) {
        const pension = Number(data.pct_pension_empleador) || 0
        const caja = Number(data.pct_caja) || 0
        const arl = ARL_POR_CLASE[String(data.clase_arl_operativo ?? "III")] ?? ARL_POR_CLASE.III
        // Salud, SENA e ICBF: la exoneración del Art. 114-1 ET aplica a quien
        // gana menos de 10 SMLV. Para una estimación se asume el caso general
        // (exonerado), que es el de la mayoría del personal operativo, y se
        // dice en el detalle para que no se lea como un dato oculto.
        const salud = Number(data.pct_salud_empleador) || 0
        const sena = Number(data.pct_sena) || 0
        const icbf = Number(data.pct_icbf) || 0
        exonerada = true
        pctAportes = pension + caja + arl
        detalle.push(
          `Aportes ${pctAportes.toFixed(2)}% (pensión ${pension}% + caja ${caja}% + ARL ${arl}% riesgo ${data.clase_arl_operativo ?? "III"})`,
        )
        detalle.push(
          `Exonerado de salud ${salud}%, SENA ${sena}% e ICBF ${icbf}% por el Art. 114-1 ET (salario bajo 10 SMLV). Si el cargo supera ese tope, el costo real sube.`,
        )
      }
    } catch (e: any) {
      console.error("[v0] getFactoresCosto parafiscales:", e?.message ?? e)
    }

    if (pctPrestaciones === 0 && pctAportes === 0) {
      return {
        success: false,
        message:
          "No se pudieron leer los parámetros de prestaciones y parafiscales. El costo estimado no se puede calcular.",
      }
    }

    return {
      success: true,
      data: {
        pctPrestaciones,
        pctAportes,
        pctAiu: 0,
        exonerada,
        detalle,
        aiuDeclarado: false,
      },
    }
  } catch (e: any) {
    console.error("[v0] getFactoresCosto excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron leer los parámetros." }
  }
}

export interface RequisicionResumen {
  id: string
  codigo: string
  cargo: string
  proyecto: string
  vacantes: number
  causal: string | null
  estado: string
  /** Paso actual del proceso, de 1 a 5. */
  paso: number
  pasoEtiqueta: string
  detalle: string
  aprobacionRrhh: string
  aprobacionOperaciones: string
  creada: string | null
}

/** Los 5 pasos por los que pasa una requisición, en orden. */
const PASOS = [
  "Solicitada",
  "Aprobada",
  "En selección",
  "Terna enviada",
  "Contratado",
]

/**
 * Requisiciones de la empresa, con el avance real de cada una.
 *
 * Se lee con `empresaId` EXPLÍCITO. `getVacantes()` resuelve la empresa con
 * `getCurrentEmpresaIdForInsert()`, que cae al fallback 1 cuando no hay sesión
 * de Supabase Auth: mostraría requisiciones de otra empresa.
 */
export async function getRequisiciones(
  empresaId: number | null | undefined,
): Promise<{ success: boolean; data?: RequisicionResumen[]; message?: string }> {
  if (!empresaId) return { success: false, message: "Selecciona una empresa en el selector de arriba." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("vacantes")
      .select("*")
      .eq("idempresa", empresaId)
      .order("created_at", { ascending: false })
      .limit(40)
    if (error) return { success: false, message: error.message }

    const filas: RequisicionResumen[] = (data ?? []).map((v: any, i: number) => {
      const rrhh = String(v.aprobacion_rrhh ?? "pendiente")
      const ops = String(v.aprobacion_operaciones ?? "pendiente")
      const rechazada = rrhh === "rechazado" || ops === "rechazado" || v.estado === "rechazado"
      const aprobada = rrhh === "aprobado" && ops === "aprobado"

      // El avance solo llega hasta donde el sistema SABE. No hay estados de
      // selección ni de terna en la base: inventarlos daría una barra que
      // avanza sola sin que nadie haya hecho nada.
      let paso = 1
      if (aprobada) paso = 2
      if (v.estado === "contratado") paso = 5

      const detalle = rechazada
        ? `Rechazada${v.motivo_rechazo ? `: ${v.motivo_rechazo}` : ""}`
        : aprobada
          ? "Aprobada por RRHH y Operaciones. En proceso de selección."
          : `Pendiente de aprobación · RRHH ${rrhh} · Operaciones ${ops}`

      return {
        id: String(v.id),
        // `vacantes` no tiene número de requisición: se arma uno legible a
        // partir del orden, y se dice que es de referencia.
        codigo: `REQ-${String((data ?? []).length - i).padStart(4, "0")}`,
        cargo: v.cargo ?? "Sin cargo",
        proyecto: v.proyecto ?? "",
        vacantes: Number(v.headcount) || 0,
        causal: v.causal ?? null,
        estado: rechazada ? "rechazado" : aprobada ? "aprobado" : "en_revision",
        paso: rechazada ? 0 : paso,
        pasoEtiqueta: rechazada ? "Rechazada" : PASOS[paso - 1] ?? "Solicitada",
        detalle,
        aprobacionRrhh: rrhh,
        aprobacionOperaciones: ops,
        creada: v.created_at ?? null,
      }
    })

    return { success: true, data: filas }
  } catch (e: any) {
    console.error("[v0] getRequisiciones excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron leer las requisiciones." }
  }
}

/** Crea una requisición con su causal y salario. */
export async function crearRequisicion(payload: {
  empresaId: number
  cargo: string
  vacantes: number
  causal: string
  salarioMensual: number
  turno?: string | null
  ciudad?: string | null
  requisitos?: string | null
  /** Puesto operativo del maestro de turnos (opcional). */
  puesto?: string | null
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Solicitud de Personal", "Gestión de Solicitudes"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!payload.empresaId) return { success: false, message: "Falta la empresa." }
    if (!payload.cargo?.trim()) return { success: false, message: "Indica el cargo requerido." }
    if (!payload.salarioMensual || payload.salarioMensual <= 0) return { success: false, message: "Indica el salario mensual." }
    if (!payload.causal) return { success: false, message: "Indica la causal de contratación." }
    if (!payload.vacantes || payload.vacantes < 1) {
      return { success: false, message: "Indica cuántas vacantes se necesitan." }
    }

    const sb: any = await getSupabaseAdmin()

    // Nombre del proyecto, igual que hace createVacante.
    let proyecto = `Empresa ${payload.empresaId}`
    try {
      const { data } = await sb.from("owners").select("nombre").eq("id", payload.empresaId).maybeSingle()
      if (data?.nombre) proyecto = data.nombre
    } catch {
      // Sin nombre de proyecto la requisición se crea igual.
    }

    const fila: any = {
      idempresa: payload.empresaId,
      proyecto,
      cargo: payload.cargo.trim(),
      headcount: payload.vacantes,
      turno: payload.turno?.trim() || null,
      ciudad: payload.ciudad?.trim() || null,
      // El salario va al rango: la tabla guarda min y max, y una requisición
      // con salario único es un rango de un solo valor.
      rango_salarial_min: payload.salarioMensual,
      rango_salarial_max: payload.salarioMensual,
      requisitos: payload.requisitos?.trim() || null,
      estado: "en_revision",
    }
    // `causal` (SQL 178) y `puesto` (SQL 210) pueden no existir todavía: se
    // intenta con ellas y, si una columna falta, se reintenta sin ella en vez
    // de perder la requisición (el puesto cae al texto de requisitos).
    const puesto = payload.puesto?.trim() || null
    const conTodo = { ...fila, causal: payload.causal, ...(puesto ? { puesto } : {}) }
    const { error } = await sb.from("vacantes").insert(conTodo)
    if (error) {
      const msg = String(error.message ?? "").toLowerCase()
      if (msg.includes("puesto")) {
        const sinPuesto = { ...fila, causal: payload.causal, requisitos: [puesto ? `Puesto: ${puesto}` : null, fila.requisitos].filter(Boolean).join(" · ") || null }
        const { error: e3 } = await sb.from("vacantes").insert(sinPuesto)
        if (e3) return { success: false, message: e3.message }
        return { success: true, message: "Requisición creada. El puesto quedó en el texto: falta correr el script 210." }
      }
      if (msg.includes("causal")) {
        const { error: e2 } = await sb.from("vacantes").insert(fila)
        if (e2) return { success: false, message: e2.message }
        return {
          success: true,
          message: "Requisición creada. La causal no se guardó: falta correr el script de esta entrega.",
        }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    console.error("[v0] crearRequisicion excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo crear la requisición." }
  }
}
