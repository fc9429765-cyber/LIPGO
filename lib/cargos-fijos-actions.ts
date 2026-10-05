"use server"

/**
 * CARGOS FIJOS — conceptos que se facturan/pagan por un monto fijo mensual,
 * sin relación con órdenes de cargue ni con turnos ejecutados:
 *
 *   · Alquiler de montacargas (`montacargas_alquiler`, por equipo de
 *     `sst_equipos`): LIP paga siempre; solo ID1 e ID3 lo facturan aparte
 *     (ID2 lo trae embebido en su facturación general, ID4 no aplica).
 *   · Cargos del proyecto (`cargos_fijos_proyecto`): $2.000.000/mes en
 *     ID1/ID3 ("Manejo de Inventario y Aplicación LIPgo") y 600 toneladas
 *     fijas/mes en ID2, en dos tramos de 300 ton cada uno.
 *
 * Cada mes se GENERA un registro por concepto en `cargos_fijos_generados`
 * (idempotente: no duplica si se corre dos veces) y ese registro es el que
 * se factura/rastrea, con el MISMO criterio canónico de "facturado" que el
 * resto del sistema: manda `facturasiigo`, no `estadofactura` — ver
 * `categoriaDeFactura` en lib/facturacion-control-actions.ts (se replica
 * aquí porque ese archivo no puede exportarla sin dejar de ser "use server"
 * con solo funciones async).
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { segundoFactorPendiente } from "@/lib/seguridad-servidor"

const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

export type CategoriaCargoFijo = "facturado" | "en_proceso" | "sin_gestionar"

function categoriaDeCargo(facturasiigo: unknown, estado: unknown): CategoriaCargoFijo {
  if (String(facturasiigo ?? "").trim() !== "") return "facturado"
  const e = String(estado ?? "").trim()
  if (e !== "" && !/pendiente/i.test(e)) return "en_proceso"
  return "sin_gestionar"
}

/** Primer día del mes de una fecha ISO. */
function inicioMes(periodo: string): string {
  return `${String(periodo).slice(0, 7)}-01`
}

// ---------------------------------------------------------------------------
// Equipos disponibles (para el formulario de configuración)
// ---------------------------------------------------------------------------

export async function getEquiposMontacargas(): Promise<{
  success: boolean
  data: Array<{ id: number; idempresa: number; identificacion: string }>
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("sst_equipos")
      .select("id, idempresa, identificacion")
      .eq("tipo", "montacargas")
      .eq("activo", true)
      .order("idempresa", { ascending: true })
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: (data || []).map((r: any) => ({ id: r.id, idempresa: Number(r.idempresa), identificacion: r.identificacion })) }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer los equipos." }
  }
}

// ---------------------------------------------------------------------------
// Configuración — Alquiler de montacargas
// ---------------------------------------------------------------------------

export interface MontacargasAlquilerRow {
  id: number
  equipo_id: number
  idempresa: number
  identificacion: string
  proveedor: string
  valor_pagado: number
  valor_facturado: number | null
  fechainicio: string
  fechafin: string
}

export async function getMontacargasAlquiler(): Promise<{
  success: boolean
  data: MontacargasAlquilerRow[]
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("montacargas_alquiler")
      .select("id, equipo_id, proveedor, valor_pagado, valor_facturado, fechainicio, fechafin, sst_equipos(idempresa, identificacion)")
      .order("fechainicio", { ascending: false })
    if (error) return { success: false, data: [], message: error.message }
    const rows: MontacargasAlquilerRow[] = (data || []).map((r: any) => ({
      id: r.id,
      equipo_id: r.equipo_id,
      idempresa: Number(r.sst_equipos?.idempresa ?? 0),
      identificacion: String(r.sst_equipos?.identificacion ?? ""),
      proveedor: r.proveedor,
      valor_pagado: num(r.valor_pagado),
      valor_facturado: r.valor_facturado === null ? null : num(r.valor_facturado),
      fechainicio: r.fechainicio,
      fechafin: r.fechafin,
    }))
    return { success: true, data: rows }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer el alquiler de montacargas." }
  }
}

export async function guardarMontacargasAlquiler(payload: {
  id?: number
  equipo_id: number
  proveedor: string
  valor_pagado: number
  valor_facturado: number | null
  fechainicio: string
  fechafin: string
}): Promise<{ success: boolean; message?: string }> {
  const segundoFactor = await segundoFactorPendiente("cargos-fijos:guardarMontacargasAlquiler")
  if (segundoFactor) return { success: false, message: segundoFactor }
  try {
    const sb: any = await getSupabaseAdmin()
    const row = {
      equipo_id: payload.equipo_id,
      proveedor: payload.proveedor.trim(),
      valor_pagado: payload.valor_pagado,
      valor_facturado: payload.valor_facturado,
      fechainicio: payload.fechainicio,
      fechafin: payload.fechafin,
    }
    const { error } = payload.id
      ? await sb.from("montacargas_alquiler").update(row).eq("id", payload.id)
      : await sb.from("montacargas_alquiler").insert(row)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar el alquiler de montacargas." }
  }
}

// ---------------------------------------------------------------------------
// Configuración — Cargos fijos del proyecto ($2M, 600 ton, etc.)
// ---------------------------------------------------------------------------

export interface CargoFijoProyectoRow {
  id: number
  idempresa: number
  concepto: string
  cantidad: number | null
  tarifa: number | null
  valor: number | null
  tipo: "ingreso" | "gasto"
  fechainicio: string
  fechafin: string
  valorMensual: number
}

export async function getCargosFijosProyecto(): Promise<{
  success: boolean
  data: CargoFijoProyectoRow[]
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("cargos_fijos_proyecto")
      .select("*")
      .order("idempresa", { ascending: true })
    if (error) return { success: false, data: [], message: error.message }
    const rows: CargoFijoProyectoRow[] = (data || []).map((r: any) => ({
      id: r.id,
      idempresa: Number(r.idempresa),
      concepto: r.concepto,
      cantidad: r.cantidad === null ? null : num(r.cantidad),
      tarifa: r.tarifa === null ? null : num(r.tarifa),
      valor: r.valor === null ? null : num(r.valor),
      tipo: r.tipo,
      fechainicio: r.fechainicio,
      fechafin: r.fechafin,
      valorMensual: r.valor !== null ? num(r.valor) : num(r.cantidad) * num(r.tarifa),
    }))
    return { success: true, data: rows }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer los cargos fijos del proyecto." }
  }
}

export async function guardarCargoFijoProyecto(payload: {
  id?: number
  idempresa: number
  concepto: string
  cantidad: number | null
  tarifa: number | null
  valor: number | null
  tipo: "ingreso" | "gasto"
  fechainicio: string
  fechafin: string
}): Promise<{ success: boolean; message?: string }> {
  const segundoFactor = await segundoFactorPendiente("cargos-fijos:guardarCargoFijoProyecto")
  if (segundoFactor) return { success: false, message: segundoFactor }
  try {
    const sb: any = await getSupabaseAdmin()
    const row = {
      idempresa: payload.idempresa,
      concepto: payload.concepto.trim(),
      cantidad: payload.cantidad,
      tarifa: payload.tarifa,
      valor: payload.valor,
      tipo: payload.tipo,
      fechainicio: payload.fechainicio,
      fechafin: payload.fechafin,
    }
    const { error } = payload.id
      ? await sb.from("cargos_fijos_proyecto").update(row).eq("id", payload.id)
      : await sb.from("cargos_fijos_proyecto").insert(row)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar el cargo fijo." }
  }
}

// ---------------------------------------------------------------------------
// Generación del mes
// ---------------------------------------------------------------------------

export interface ResultadoGeneracion {
  creados: number
  yaExistian: number
}

/** Genera (si faltan) los cargos del mes para TODAS las configuraciones vigentes. Idempotente. */
export async function generarCargosDelMes(
  periodo: string,
): Promise<{ success: boolean; data?: ResultadoGeneracion; message?: string }> {
  // Segundo factor (2026-10-05): solo detiene a quien lo tiene activado y no lo verificó.
  const segundoFactor = await segundoFactorPendiente("cargos-fijos:generarCargosDelMes")
  if (segundoFactor) return { success: false, message: segundoFactor }
  try {
    const mes = inicioMes(periodo)
    const sb: any = await getSupabaseAdmin()
    let creados = 0
    let yaExistian = 0

    // 1) Alquiler de montacargas — una fila por equipo vigente ese mes.
    const { data: mont, error: errMont } = await sb
      .from("montacargas_alquiler")
      .select("id, valor_pagado, valor_facturado, fechainicio, fechafin, sst_equipos(idempresa)")
      .lte("fechainicio", mes)
      .gte("fechafin", mes)
    if (errMont) return { success: false, message: errMont.message }
    for (const m of mont || []) {
      const idempresa = Number(m.sst_equipos?.idempresa ?? 0)
      if (!idempresa) continue
      // Gasto (siempre): lo que LIP paga.
      const rGasto = await sb
        .from("cargos_fijos_generados")
        .upsert(
          {
            idempresa,
            origen_tipo: "montacargas",
            origen_id: m.id,
            concepto: "Alquiler de montacargas",
            periodo: mes,
            valor: num(m.valor_pagado),
            tipo: "gasto",
          },
          { onConflict: "origen_tipo,origen_id,periodo", ignoreDuplicates: true },
        )
        .select("id")
      if (rGasto.data && rGasto.data.length) creados++
      else yaExistian++

      // Ingreso (solo si se factura aparte): valor_facturado no nulo.
      if (m.valor_facturado !== null) {
        const rIng = await sb
          .from("cargos_fijos_generados")
          .upsert(
            {
              idempresa,
              origen_tipo: "montacargas",
              // Mismo origen_id que el gasto colisionaría en la unique key
              // (origen_tipo,origen_id,periodo) porque origen_tipo es igual.
              // Se distingue con un origen_id negativo para el ingreso.
              origen_id: -m.id,
              concepto: "Alquiler de montacargas (facturado)",
              periodo: mes,
              valor: num(m.valor_facturado),
              tipo: "ingreso",
            },
            { onConflict: "origen_tipo,origen_id,periodo", ignoreDuplicates: true },
          )
          .select("id")
        if (rIng.data && rIng.data.length) creados++
        else yaExistian++
      }
    }

    // 2) Cargos fijos del proyecto ($2M, tramos de 600 ton…).
    const { data: cfp, error: errCfp } = await sb
      .from("cargos_fijos_proyecto")
      .select("*")
      .lte("fechainicio", mes)
      .gte("fechafin", mes)
    if (errCfp) return { success: false, message: errCfp.message }
    for (const c of cfp || []) {
      const valor = c.valor !== null ? num(c.valor) : num(c.cantidad) * num(c.tarifa)
      const r = await sb
        .from("cargos_fijos_generados")
        .upsert(
          {
            idempresa: Number(c.idempresa),
            origen_tipo: "proyecto",
            origen_id: c.id,
            concepto: c.concepto,
            periodo: mes,
            valor,
            tipo: c.tipo,
          },
          { onConflict: "origen_tipo,origen_id,periodo", ignoreDuplicates: true },
        )
        .select("id")
      if (r.data && r.data.length) creados++
      else yaExistian++
    }

    return { success: true, data: { creados, yaExistian } }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al generar los cargos del mes." }
  }
}

// ---------------------------------------------------------------------------
// Listado / estado de facturación
// ---------------------------------------------------------------------------

export interface CargoFijoGenerado {
  id: number
  idempresa: number
  concepto: string
  periodo: string
  valor: number
  tipo: "ingreso" | "gasto"
  estadofactura: string | null
  facturasiigo: string | null
  categoria: CategoriaCargoFijo
}

export async function getCargosFijosGenerados(
  idempresa: number | null,
  periodo: string,
): Promise<{ success: boolean; data: CargoFijoGenerado[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const mes = inicioMes(periodo)
    let q = sb.from("cargos_fijos_generados").select("*").eq("periodo", mes)
    if (idempresa) q = q.eq("idempresa", idempresa)
    const { data, error } = await q.order("idempresa", { ascending: true })
    if (error) return { success: false, data: [], message: error.message }
    const rows: CargoFijoGenerado[] = (data || []).map((r: any) => ({
      id: r.id,
      idempresa: Number(r.idempresa),
      concepto: r.concepto,
      periodo: r.periodo,
      valor: num(r.valor),
      tipo: r.tipo,
      estadofactura: r.estadofactura ?? null,
      facturasiigo: r.facturasiigo ?? null,
      categoria: categoriaDeCargo(r.facturasiigo, r.estadofactura),
    }))
    return { success: true, data: rows }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer los cargos fijos del mes." }
  }
}

// ---------------------------------------------------------------------------
// Toneladas fijas vs reales (hoy solo aplica a Avimol/ID2 — Distribución
// fija, 600 t/mes en 2 tramos). El fijo SIEMPRE se cobra completo, pase lo
// que pase con el volumen real — este comparativo es solo informativo, para
// no perder de vista si el fijo cubre bien lo que realmente se distribuye.
// No se toca lo que ya se cobra/paga: es una lectura aparte.
// ---------------------------------------------------------------------------

export interface ComparativoToneladasFijas {
  toneladasFijas: number
  toneladasReales: number
}

export async function getComparativoToneladasFijas(
  idempresa: number,
  periodo: string, // YYYY-MM-01
): Promise<{ success: boolean; data?: ComparativoToneladasFijas; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const mes = inicioMes(periodo)
    const [anioStr, mesStr] = mes.split("-")
    const ultimoDia = new Date(Number(anioStr), Number(mesStr), 0).getDate()
    const desde = mes
    const hasta = `${anioStr}-${mesStr}-${String(ultimoDia).padStart(2, "0")}`

    // Toneladas FIJAS: suma de `cantidad` de los conceptos vigentes ese mes
    // (cantidad IS NOT NULL = son cantidad×tarifa, no un valor fijo directo).
    const { data: cfp, error: errCfp } = await sb
      .from("cargos_fijos_proyecto")
      .select("cantidad")
      .eq("idempresa", idempresa)
      .not("cantidad", "is", null)
      .lte("fechainicio", mes)
      .gte("fechafin", mes)
    if (errCfp) return { success: false, message: errCfp.message }
    const toneladasFijas = (cfp || []).reduce((s: number, r: any) => s + num(r.cantidad), 0)
    if (toneladasFijas <= 0) return { success: true, data: { toneladasFijas: 0, toneladasReales: 0 } }

    // Toneladas REALES: Distribución de ese proyecto en el mes, peso de báscula
    // (mismo criterio que pagonomina/facturación para plantas sin CEDI).
    const { data: distrib, error: errDist } = await sb
      .from("cabeceraoc")
      .select("pesovascula")
      .eq("idempresa", idempresa)
      .eq("tipooperacion", "Distribucion")
      .gte("fechacargue", desde)
      .lte("fechacargue", hasta)
    if (errDist) return { success: false, message: errDist.message }
    const toneladasReales = (distrib || []).reduce((s: number, r: any) => s + num(r.pesovascula), 0)

    return { success: true, data: { toneladasFijas, toneladasReales } }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al calcular el comparativo de toneladas." }
  }
}

export async function marcarCargoSolicitado(id: number): Promise<{ success: boolean; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb
      .from("cargos_fijos_generados")
      .update({ estadofactura: "CF - Factura solicitada" })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al marcar el cargo como solicitado." }
  }
}

/** Adjunta la factura Siigo (URL ya subida vía subirYRegistrarSoporte) — esto es lo que marca "facturado". */
export async function adjuntarFacturaSiigoCargo(
  id: number,
  url: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb
      .from("cargos_fijos_generados")
      .update({ facturasiigo: url, estadofactura: "CF - Cerrado" })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al adjuntar la factura." }
  }
}

export async function quitarFacturaSiigoCargo(id: number): Promise<{ success: boolean; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb
      .from("cargos_fijos_generados")
      .update({ facturasiigo: null, estadofactura: "CF - Factura solicitada" })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al quitar la factura." }
  }
}
