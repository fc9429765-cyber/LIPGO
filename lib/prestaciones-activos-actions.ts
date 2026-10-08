"use server"

// Prestaciones sociales REALES de personal ACTIVO (prima, cesantías,
// intereses de cesantías) -- distinto de Liquidaciones (que solo calcula
// esto al RETIRO de la persona). Aquí se proyecta/confirma el pago masivo
// periódico que la ley exige para TODO el personal activo:
//   · Prima: 2 periodos/año (ene-jun ~30-jun, jul-dic ~20-dic).
//   · Cesantías + intereses: 1 periodo/año (ene-dic), pagadas ~feb/ene.
//
// MISMA fórmula que ya usa y validó Liquidaciones (lib/liquidaciones-actions.ts),
// solo que anclada a fechas de CALENDARIO en vez de a `fecha_retiro`. Se
// duplica aquí una versión mínima de `sumaPeriodo`/parámetros en vez de
// exportarlos desde liquidaciones-actions.ts porque ese archivo es
// "use server" (todo export ahí debe ser async) -- mismo patrón ya usado
// para BONO_DESTAJO_IBC_DESDE en parafiscales.ts. Si se toca la fórmula en
// un lado, tocar el otro.
//
// Patrón "valor real" -- igual que parafiscales_real / liquidaciones_retiro:
// "Generar cálculo" proyecta valor_calculado para todo el personal activo;
// se puede ajustar valor_real por persona; "Marcar como pagada" congela el
// periodo con su fecha_pago real.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { autorizarAccion, motivoSinAccion } from "@/lib/puerta-modulo"

export type ConceptoPrestacion = "prima" | "cesantias" | "intereses_cesantias"

const PCT_PRIMA = 8.33
const PCT_CESANTIAS = 8.33
const PCT_INTERESES_CESANTIAS = 12
const BONO_DESTAJO_PRESTACIONAL_DESDE = "2026-07-01"

async function leerParametrosPrestaciones(admin: any): Promise<{ pctPrima: number; pctCesantias: number; pctInteresesCesantias: number; incluyeAux: boolean }> {
  const { data } = await admin.from("parametros_prestaciones").select("*").eq("id", 1).maybeSingle()
  if (!data) return { pctPrima: PCT_PRIMA, pctCesantias: PCT_CESANTIAS, pctInteresesCesantias: PCT_INTERESES_CESANTIAS, incluyeAux: true }
  return {
    pctPrima: Number(data.pct_prima ?? PCT_PRIMA),
    pctCesantias: Number(data.pct_cesantias ?? PCT_CESANTIAS),
    pctInteresesCesantias: Number(data.pct_intereses_cesantias ?? PCT_INTERESES_CESANTIAS),
    incluyeAux: data.incluye_aux !== false,
  }
}

function sumaPeriodoActivo(rows: any[], desde: string, hasta: string, salarioDia: number): { dev: number; dias: number } {
  let dev = 0
  let dias = 0
  const bonoPorQuincena = new Map<string, number>()
  for (const r of rows) {
    const f = String(r.fecha)
    if (f < desde || f > hasta) continue
    const sinRegistroSinMotivo =
      String(r.actividad_registrada || "") === "Sin Registro" &&
      !String(r.novedad_reportada || "").trim() &&
      Number(r.total_liquidado_dia || 0) === 0
    dev += sinRegistroSinMotivo ? salarioDia : Number(r.total_liquidado_dia || 0)
    dias += 1
    if (f >= BONO_DESTAJO_PRESTACIONAL_DESDE && Number(r.toneladas || 0) > 0) {
      const clave = f.slice(0, 7) + (Number(f.slice(8, 10)) <= 15 ? "-Q1" : "-Q2")
      bonoPorQuincena.set(clave, (bonoPorQuincena.get(clave) || 0) + Number(r.bonif_prestacional || 0))
    }
  }
  for (const v of bonoPorQuincena.values()) dev += Math.max(0, v)
  // Relleno SOLO de los primeros días de enero-2026 que no existen en el
  // sistema (arranque de LIPgo, hasta 4 días) -- mismo mecanismo ya validado
  // en lib/liquidaciones-actions.ts (`fillDias`). Sin esto, cualquier periodo
  // que incluya enero-2026 queda corto en la base salarial, no solo en el
  // bono (que antes de julio-2026 de todas formas NO vive en LIPgo -- ver
  // comentario de cabecera, usar valor_real para esos periodos).
  if (desde <= "2026-01-01" && hasta >= "2026-01-01") {
    const primerDia = rows
      .map((r: any) => String(r.fecha))
      .filter((fx: string) => fx >= "2026-01-01" && fx <= hasta)
      .sort()[0]
    if (primerDia) {
      const fillDias = Math.max(0, Math.min(Number(primerDia.slice(8, 10)) - 1, 4))
      dev += fillDias * salarioDia
      dias += fillDias
    }
  }
  return { dev, dias }
}

export interface PrestacionActivoPersona {
  identificacion: string
  persona: string
  idempresa: number | null
  concepto: ConceptoPrestacion
  periodo_desde: string
  periodo_hasta: string
  valor_calculado: number
  valor_real: number | null
  estado: "proyectado" | "pagada"
  fecha_pago: string | null
}

/**
 * Calcula (SIN GUARDAR) prima/cesantías/intereses de TODO el personal activo
 * para el periodo dado, misma fórmula que Liquidaciones. `concepto` decide
 * qué prestación se calcula -- se llaman una por una desde la UI/backfill.
 */
export async function calcularPrestacionesActivos(
  concepto: ConceptoPrestacion,
  periodoDesde: string,
  periodoHasta: string,
  idempresaFiltro?: number | null,
): Promise<{ success: boolean; data: PrestacionActivoPersona[]; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Parafiscales", "Liquidaciones"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion, data: [] }
  try {
    const admin: any = await getSupabaseAdmin()
    const pp = await leerParametrosPrestaciones(admin)
    const anio = Number(periodoDesde.slice(0, 4))
    const { data: pa } = await admin.from("parametros_legales_anio").select("smlv, auxilio_transporte").eq("anio", anio).maybeSingle()
    const smlv = Number(pa?.smlv || 0)
    const auxMensual = Number(pa?.auxilio_transporte || 0)

    let q = admin
      .from("headcount")
      .select("identificacion, nombre, idempresa, salario, contratosiigo, estado, fechainicio")
      .eq("estado", "Activo")
      .not("nombre", "ilike", "%prueba%")
    if (idempresaFiltro) q = q.eq("idempresa", idempresaFiltro)
    const { data: personal } = await q
    const info = new Map<string, { identificacion: string; idempresa: number | null; salario: number; fechainicio: string | null }>()
    for (const h of personal || []) {
      const nombre = String(h.nombre || "").trim()
      if (!nombre || !String(h.contratosiigo || "").trim()) continue
      info.set(nombre, {
        identificacion: String(h.identificacion || "").trim(),
        idempresa: h.idempresa ?? null,
        salario: Number(h.salario) || smlv,
        fechainicio: h.fechainicio ? String(h.fechainicio).slice(0, 10) : null,
      })
    }
    if (info.size === 0) return { success: true, data: [] }

    const nombres = Array.from(info.keys())
    let filas: any[] = []
    const pageSize = 1000
    for (let offset = 0; ; offset += pageSize) {
      const { data } = await admin
        .rpc("pagonomina_rango", { p_desde: periodoDesde, p_hasta: periodoHasta })
        .select("persona, fecha, total_liquidado_dia, actividad_registrada, novedad_reportada, bonif_prestacional, toneladas")
        .in("persona", nombres)
        .gte("fecha", periodoDesde)
        .lte("fecha", periodoHasta)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("persona")
        .order("fecha")
        .range(offset, offset + pageSize - 1)
      if (!data || data.length === 0) break
      filas = filas.concat(data)
      if (data.length < pageSize) break
    }
    const porPersona = new Map<string, any[]>()
    for (const r of filas) {
      const nombre = String(r.persona || "").trim()
      if (!info.has(nombre)) continue
      const arr = porPersona.get(nombre) || []
      arr.push(r)
      porPersona.set(nombre, arr)
    }

    const out: PrestacionActivoPersona[] = []
    for (const [nombre, ficha] of info) {
      const rows = porPersona.get(nombre) || []
      const desde = ficha.fechainicio && ficha.fechainicio > periodoDesde ? ficha.fechainicio : periodoDesde
      if (desde > periodoHasta) continue // ingresó después de cerrar el periodo
      const salarioDia = ficha.salario / 30
      const { dev, dias } = sumaPeriodoActivo(rows, desde, periodoHasta, salarioDia)
      if (dias === 0) continue
      const auxProp = (auxMensual / 30) * dias
      const base = dev + (pp.incluyeAux ? auxProp : 0)

      let valor = 0
      if (concepto === "prima") valor = base * (pp.pctPrima / 100)
      else if (concepto === "cesantias") valor = base * (pp.pctCesantias / 100)
      else if (concepto === "intereses_cesantias") {
        const cesantias = base * (pp.pctCesantias / 100)
        valor = cesantias * (pp.pctInteresesCesantias / 100) * (dias / 360)
      }

      out.push({
        identificacion: ficha.identificacion,
        persona: nombre,
        idempresa: ficha.idempresa,
        concepto,
        periodo_desde: periodoDesde,
        periodo_hasta: periodoHasta,
        valor_calculado: Math.round(valor),
        valor_real: null,
        estado: "proyectado",
        fecha_pago: null,
      })
    }
    return { success: true, data: out }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al calcular las prestaciones." }
  }
}

/** Guarda (upsert) el cálculo proyectado de un periodo/concepto -- botón
 * "Generar cálculo del periodo". No pisa `valor_real`/`estado` si la fila ya
 * existía y estaba pagada -- solo actualiza `valor_calculado`. */
export async function generarCalculoPrestacionesActivos(
  concepto: ConceptoPrestacion,
  periodoDesde: string,
  periodoHasta: string,
  idempresaFiltro?: number | null,
): Promise<{ success: boolean; personas?: number; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Parafiscales"], "crear", "Generar cálculo de prestaciones")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const r = await calcularPrestacionesActivos(concepto, periodoDesde, periodoHasta, idempresaFiltro)
  if (!r.success) return { success: false, message: r.message }
  try {
    const admin: any = await getSupabaseAdmin()
    const { data: existentes } = await admin
      .from("prestaciones_activos_pagos")
      .select("identificacion, estado, valor_real")
      .eq("concepto", concepto)
      .eq("periodo_desde", periodoDesde)
      .eq("periodo_hasta", periodoHasta)
    const yaExiste = new Map((existentes || []).map((e: any) => [e.identificacion, e]))

    const filas = r.data.map((p) => {
      const prev: any = yaExiste.get(p.identificacion)
      return {
        idempresa: p.idempresa,
        identificacion: p.identificacion,
        persona: p.persona,
        concepto: p.concepto,
        periodo_desde: p.periodo_desde,
        periodo_hasta: p.periodo_hasta,
        valor_calculado: p.valor_calculado,
        valor_real: prev?.valor_real ?? null,
        estado: prev?.estado ?? "proyectado",
        updated_at: new Date().toISOString(),
      }
    })
    if (filas.length === 0) return { success: true, personas: 0 }
    const { error } = await admin
      .from("prestaciones_activos_pagos")
      .upsert(filas, { onConflict: "identificacion,concepto,periodo_desde,periodo_hasta" })
    if (error) return { success: false, message: error.message }
    return { success: true, personas: filas.length }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar el cálculo." }
  }
}

export async function getPrestacionesActivosPeriodo(
  concepto: ConceptoPrestacion,
  periodoDesde: string,
  periodoHasta: string,
  idempresaFiltro?: number | null,
): Promise<{ success: boolean; data: PrestacionActivoPersona[]; message?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()
    let q = admin
      .from("prestaciones_activos_pagos")
      .select("*")
      .eq("concepto", concepto)
      .eq("periodo_desde", periodoDesde)
      .eq("periodo_hasta", periodoHasta)
      .order("persona", { ascending: true })
    if (idempresaFiltro) q = q.eq("idempresa", idempresaFiltro)
    const { data, error } = await q
    if (error) return { success: false, data: [], message: error.message }
    return {
      success: true,
      data: (data || []).map((d: any) => ({
        identificacion: d.identificacion,
        persona: d.persona,
        idempresa: d.idempresa,
        concepto: d.concepto,
        periodo_desde: d.periodo_desde,
        periodo_hasta: d.periodo_hasta,
        valor_calculado: Number(d.valor_calculado) || 0,
        valor_real: d.valor_real != null ? Number(d.valor_real) : null,
        estado: d.estado,
        fecha_pago: d.fecha_pago,
      })),
    }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer el periodo." }
  }
}

/** Ajusta el valor_real de UNA persona (si lo pagado en Siigo no coincide
 * con la fórmula) -- mismo patrón que los demás "valor real" del sistema. */
export async function guardarValorRealPrestacionActivo(payload: {
  identificacion: string
  concepto: ConceptoPrestacion
  periodo_desde: string
  periodo_hasta: string
  valor_real: number | null
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Parafiscales"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin
      .from("prestaciones_activos_pagos")
      .update({ valor_real: payload.valor_real, updated_at: new Date().toISOString() })
      .eq("identificacion", payload.identificacion)
      .eq("concepto", payload.concepto)
      .eq("periodo_desde", payload.periodo_desde)
      .eq("periodo_hasta", payload.periodo_hasta)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar el valor real." }
  }
}

/** Marca TODO un periodo/concepto como pagado (fecha real) -- congela el
 * periodo: Estado de Resultados / Cierre Financiero empiezan a usar estos
 * valores en vez de la provisión estimada para los meses de ese periodo. */
export async function marcarPeriodoPagado(
  concepto: ConceptoPrestacion,
  periodoDesde: string,
  periodoHasta: string,
  fechaPago: string,
  clave?: string,
): Promise<{ success: boolean; message?: string }> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Parafiscales", "cerrar", { clave: clave ?? "", idempresa: null, referencia: "marcar período pagado" })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin
      .from("prestaciones_activos_pagos")
      .update({ estado: "pagada", fecha_pago: fechaPago, updated_at: new Date().toISOString() })
      .eq("concepto", concepto)
      .eq("periodo_desde", periodoDesde)
      .eq("periodo_hasta", periodoHasta)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al marcar el periodo como pagado." }
  }
}
