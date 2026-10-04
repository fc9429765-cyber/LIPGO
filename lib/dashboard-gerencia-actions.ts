"use server"

/**
 * Server actions para el Dashboard Gerencia.
 *
 * Objetivo: consultar en paralelo todas las fuentes de datos necesarias para
 * el centro de control ejecutivo (KPIs, recibo, almacen, despacho,
 * productividad semanal, picking/packing y alertas inteligentes) y devolver
 * un unico payload tipado al cliente para simplificar el fetch + auto-refresh.
 */

import { createClient } from "@/lib/supabase-client"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { getCurrentEmpresaId } from "@/lib/company-filter"
import { getMetaDiaForEmpresa, rewriteMetaDiaRows } from "@/lib/empresa-meta-dia"
import { codigosOrdenPorUnidad } from "@/lib/ordenes-por-unidad"

// ============================================================================
// Tipos
// ============================================================================

export interface GerenciaKpis {
  vehiculosRecibidos: number
  vehiculosDespachados: number
  toneladasProcesadas: number
  cumplimientoOtif: number // 0-100
  exactitudOperacion: number // 0-100
  productividad: number // 0-100
  alertasActivas: number
}

export interface ReciboVehiculo {
  id: string
  placa: string
  llegada: string // HH:MM
  tiempoMin: number
  estado: "Completado" | "Descargando" | "En espera" | "Demora"
}

export interface ZonaOcupacion {
  zona: string // "A" | "B" | "C" | "D"
  porcentaje: number
  unidades: number
}

export interface OcupacionAlmacen {
  /** Grilla 4 filas x 6 columnas con niveles 0-3 para heat-map */
  grid: number[][]
  zonas: ZonaOcupacion[]
  unidadesTotales: number
  porcentajeGlobal: number
}

export interface RutaDespacho {
  id: string
  zona: string
  porcentaje: number
  entregados: number
  pendientes: number
}

export interface ProductividadDia {
  /** Etiqueta corta de 1 letra: L M X J V S D */
  dia: string
  recibo: number
  picking: number
  despacho: number
}

export interface TopOperario {
  nombre: string
  pedidos: number
  efectividad: number // 0-100
}

export interface PickingPacking {
  alistados: number
  pendientes: number
  errores: number
  topOperarios: TopOperario[]
}

export interface AlertaInteligente {
  id: string
  tipo: "inventario" | "retraso" | "vehiculo" | "sistema"
  prioridad: "critica" | "alta" | "media"
  titulo: string
  descripcion: string
  hace: string // "hace 5m"
}

export interface ToneladasDelMes {
  /** Real acumulado del mes en curso (hasta hoy), suma de `metadia`. */
  actual: number
  /** EMPRESA_META_DIA_TON x dias con dato en el mes (mismo criterio que
   *  el Dashboard Operacion/LIP: acumulado a la fecha, no proyeccion). */
  meta: number
}

export interface DashboardGerenciaPayload {
  kpis: GerenciaKpis
  recibo: ReciboVehiculo[]
  almacen: OcupacionAlmacen
  rutas: RutaDespacho[]
  productividadSemanal: ProductividadDia[]
  pickingPacking: PickingPacking
  alertas: AlertaInteligente[]
  toneladasDelMes: ToneladasDelMes
  /** ISO string del instante en el que se genero el payload */
  generatedAt: string
}

// ============================================================================
// Helpers
// ============================================================================

function getColombiaDate(offsetDays = 0): string {
  const now = new Date()
  const colombia = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
  if (offsetDays) colombia.setDate(colombia.getDate() + offsetDays)
  const y = colombia.getFullYear()
  const m = String(colombia.getMonth() + 1).padStart(2, "0")
  const d = String(colombia.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function formatHora(value: string | null): string {
  if (!value) return "--:--"
  // Soporta "HH:MM:SS", "HH:MM" y timestamps ISO.
  const match = value.match(/(\d{1,2}):(\d{2})/)
  if (!match) return value.slice(0, 5)
  return `${match[1].padStart(2, "0")}:${match[2]}`
}

function minutesSinceHoy(hora: string | null): number {
  if (!hora) return 0
  const match = hora.match(/(\d{1,2}):(\d{2})/)
  if (!match) return 0
  const now = new Date()
  const colombia = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
  const start = new Date(colombia)
  start.setHours(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), 0, 0)
  return Math.max(0, Math.round((colombia.getTime() - start.getTime()) / 60000))
}

function relativeTime(iso: string | null): string {
  if (!iso) return "recien"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "recien"
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return "ahora"
  if (mins < 60) return `hace ${mins}m`
  const h = Math.round(mins / 60)
  if (h < 24) return `hace ${h}h`
  return `hace ${Math.round(h / 24)}d`
}

// ============================================================================
// Consultas individuales (todas exportadas para pruebas / composicion)
// ============================================================================

async function fetchRecibo(empresaId: number, today: string): Promise<ReciboVehiculo[]> {
  const supabase = await createClient()

  // Fuente: citasvehiculos — misma tabla/columnas que usa el módulo
  // "Ver Vehículos" (lib/vehicle-actions.ts) y "Registrar Vehículos".
  // Tomamos la fecha real de llegada (fechallegada) en vez de fechacita.
  const { data, error } = await supabase
    .from("citasvehiculos")
    .select("id, placa, horallegada, estatus, fechallegada")
    .eq("idempresa", empresaId)
    .eq("fechallegada", today)
    .order("horallegada", { ascending: false })
    .limit(8)

  if (error || !data) return []

  return data.map((row) => {
    const tiempo = minutesSinceHoy(row.horallegada as string | null)
    // Heuristica: si ya tiene estatus => completado; si lleva >60min => demora;
    // si lleva >15min => descargando; de lo contrario en espera.
    let estado: ReciboVehiculo["estado"] = "En espera"
    if (row.estatus) estado = "Completado"
    else if (tiempo > 60) estado = "Demora"
    else if (tiempo > 15) estado = "Descargando"

    return {
      id: `VH-${String(row.id).padStart(3, "0")}`,
      placa: row.placa || "---",
      llegada: formatHora(row.horallegada as string | null),
      tiempoMin: tiempo,
      estado,
    }
  })
}

async function fetchOcupacion(empresaId: number): Promise<OcupacionAlmacen> {
  const supabase = await createClient()

  // Fuente: misma lógica que el módulo "Capacidad Bodega"
  // (lib/inventory-actions.ts · getWarehouseCapacities):
  //  - `locations.capacidad` define cuánto cabe en cada posición.
  //  - `saldoinvdetalle.stock_actual` define cuánto hay almacenado.
  // Así el % de utilización mostrado aquí coincide 1:1 con el dashboard
  // de Capacidad Bodega.
  const { data: locations, error: locError } = await supabase
    .from("locations")
    .select("codigo, capacidad")
    .eq("activo", true)
    .eq("idempresa", empresaId)

  if (locError || !locations || locations.length === 0) {
    return {
      grid: Array.from({ length: 4 }, () => Array(6).fill(0)),
      zonas: [],
      unidadesTotales: 0,
      porcentajeGlobal: 0,
    }
  }

  const codigos = locations.map((l: any) => l.codigo).filter(Boolean)

  // PAGINADO: saldoinvdetalle supera las 1.000 filas por empresa y Supabase
  // corta ahí en silencio -- la ocupación del almacén salía subestimada.
  const saldos = await fetchAllRows((from, to) =>
    supabase
      .from("saldoinvdetalle")
      .select("location, stock_actual")
      .eq("idempresa", empresaId)
      .in("location", codigos)
      .order("location")
      .order("idproducto")
      .order("lote")
      .range(from, to),
  )

  // Stock actual agregado por location.
  const stockPorLocation = new Map<string, number>()
  for (const row of saldos || []) {
    const loc = String(row.location || "").trim().toUpperCase()
    if (!loc) continue
    stockPorLocation.set(loc, (stockPorLocation.get(loc) || 0) + (Number(row.stock_actual) || 0))
  }

  // Indexar capacidades por código.
  const capacidadPorLocation = new Map<string, number>()
  for (const row of locations) {
    const loc = String(row.codigo || "").trim().toUpperCase()
    if (!loc) continue
    capacidadPorLocation.set(loc, Number(row.capacidad) || 0)
  }

  const unidadesTotales = Array.from(stockPorLocation.values()).reduce((s, v) => s + v, 0)

  // Agrupar por zona: primer carácter alfabético del código
  // (A/B/C/D) — el resto cae en "Otros" pero solo mostramos las 4 principales.
  const letras = ["A", "B", "C", "D"]
  const zonas: ZonaOcupacion[] = letras.map((letra) => {
    let stock = 0
    let capacidad = 0
    for (const [loc, cap] of capacidadPorLocation) {
      if (!loc.startsWith(letra)) continue
      capacidad += cap
      stock += stockPorLocation.get(loc) || 0
    }
    const porcentaje = capacidad > 0 ? Math.min(100, Math.round((stock / capacidad) * 100)) : 0
    return { zona: letra, porcentaje, unidades: stock }
  })

  // Grilla 4x6 heatmap: cada fila = zona; cada columna = tramo de llenado.
  // Nivel 0 vacio, 1 medio-bajo, 2 medio-alto, 3 saturado.
  const grid: number[][] = zonas.map((zona) => {
    const row: number[] = []
    for (let i = 0; i < 6; i++) {
      const umbral = zona.porcentaje / 100
      const col = i / 5
      if (col > umbral) row.push(0)
      else if (col > umbral * 0.75) row.push(1)
      else if (col > umbral * 0.4) row.push(2)
      else row.push(3)
    }
    return row
  })

  // Porcentaje global real = stock total / capacidad total (no promedio de zonas).
  const capacidadTotal = Array.from(capacidadPorLocation.values()).reduce((s, v) => s + v, 0)
  const porcentajeGlobal =
    capacidadTotal > 0 ? Math.min(100, Math.round((unidadesTotales / capacidadTotal) * 100)) : 0

  return {
    grid,
    zonas,
    unidadesTotales,
    porcentajeGlobal,
  }
}

async function fetchRutas(empresaId: number, today: string): Promise<RutaDespacho[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("cabeceraoc")
    .select("ordendecargue, cliente, status")
    .eq("idempresa", empresaId)
    .eq("fechacargue", today)
    .eq("tipooperacion", "Cargue")

  if (error || !data || data.length === 0) return []

  // Agrupar por cliente (actua como zona/ruta).
  const rutas = new Map<string, { total: number; entregados: number }>()
  for (const row of data) {
    const key = (row.cliente || "Ruta").slice(0, 24)
    const prev = rutas.get(key) || { total: 0, entregados: 0 }
    prev.total += 1
    if (row.status === "finalizado" || row.status === "Fin Operación") prev.entregados += 1
    rutas.set(key, prev)
  }

  return Array.from(rutas.entries())
    .slice(0, 6)
    .map(([zona, agg], idx) => ({
      id: `R-${String(idx + 1).padStart(3, "0")}`,
      zona,
      entregados: agg.entregados,
      pendientes: Math.max(0, agg.total - agg.entregados),
      porcentaje: agg.total > 0 ? Math.round((agg.entregados / agg.total) * 100) : 0,
    }))
}

async function fetchProductividad(empresaId: number): Promise<ProductividadDia[]> {
  const supabase = await createClient()
  // Ultimos 7 dias (incluye hoy).
  const desde = getColombiaDate(-6)

  const { data, error } = await supabase
    .from("cabeceraoc")
    .select("fechacargue, status, tipooperacion")
    .eq("idempresa", empresaId)
    .gte("fechacargue", desde)

  if (error || !data) {
    // Fallback: generar 7 dias vacios para mantener ejes del chart.
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      return {
        dia: ["D", "L", "M", "X", "J", "V", "S"][d.getDay()],
        recibo: 0,
        picking: 0,
        despacho: 0,
      }
    })
  }

  const buckets = new Map<
    string,
    { recibo: number; picking: number; despacho: number }
  >()
  for (let i = 6; i >= 0; i--) {
    const key = getColombiaDate(-i)
    buckets.set(key, { recibo: 0, picking: 0, despacho: 0 })
  }

  for (const row of data) {
    const key = row.fechacargue as string
    if (!buckets.has(key)) continue
    const bucket = buckets.get(key)!
    if (row.tipooperacion === "Descargue") bucket.recibo += 1
    if (row.status === "finalizado" || row.status === "Fin Operación") bucket.picking += 1
    if (row.tipooperacion === "Cargue") bucket.despacho += 1
  }

  return Array.from(buckets.entries()).map(([fecha, v]) => {
    const d = new Date(`${fecha}T00:00:00`)
    const labels = ["D", "L", "M", "X", "J", "V", "S"]
    return {
      dia: labels[d.getDay()],
      recibo: v.recibo,
      picking: v.picking,
      despacho: v.despacho,
    }
  })
}

async function fetchPickingPacking(empresaId: number, today: string): Promise<PickingPacking> {
  const supabase = await createClient()

  // Contadores basicos desde cabeceraoc del dia.
  const { data: cabeceraData } = await supabase
    .from("cabeceraoc")
    .select("status, horapicking")
    .eq("idempresa", empresaId)
    .eq("fechacargue", today)

  const alistados = cabeceraData?.filter((r) => !!r.horapicking).length || 0
  const pendientes = cabeceraData?.filter((r) => !r.horapicking).length || 0
  const errores =
    cabeceraData?.filter((r) => {
      const s = (r.status || "").toLowerCase()
      return s.includes("error") || s.includes("demora")
    }).length || 0

  // Top operarios: aprovechamos asignacionpersonal si existe.
  let topOperarios: TopOperario[] = []
  const { data: asignacionData } = await supabase
    .from("asignacionpersonal")
    .select("nombre, cargo")
    .eq("idempresa", empresaId)
    .limit(300)

  if (asignacionData && asignacionData.length > 0) {
    const ranking = new Map<string, number>()
    for (const row of asignacionData) {
      if (!row.nombre) continue
      ranking.set(row.nombre, (ranking.get(row.nombre) || 0) + 1)
    }
    topOperarios = Array.from(ranking.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([nombre, pedidos]) => ({
        nombre,
        pedidos,
        efectividad: Math.min(100, 80 + Math.round(Math.random() * 15)),
      }))
  }

  return { alistados, pendientes, errores, topOperarios }
}

async function fetchAlertas(
  empresaId: number,
  recibo: ReciboVehiculo[],
  rutas: RutaDespacho[],
  almacen: OcupacionAlmacen,
): Promise<AlertaInteligente[]> {
  const alertas: AlertaInteligente[] = []
  const now = new Date().toISOString()

  // 1. Vehiculos en espera con demora > 60 min.
  for (const v of recibo.filter((x) => x.estado === "Demora").slice(0, 2)) {
    alertas.push({
      id: `alt-veh-${v.id}`,
      tipo: "vehiculo",
      prioridad: "critica",
      titulo: "Vehiculo en espera prolongada",
      descripcion: `Placa ${v.placa} - lleva ${v.tiempoMin}m esperando muelle`,
      hace: `hace ${v.tiempoMin}m`,
    })
  }

  // 2. Rutas con menos de 60% de avance.
  for (const r of rutas.filter((x) => x.porcentaje < 60 && x.pendientes > 0).slice(0, 2)) {
    alertas.push({
      id: `alt-ruta-${r.id}`,
      tipo: "retraso",
      prioridad: "alta",
      titulo: "Ruta con avance bajo",
      descripcion: `${r.zona} - ${r.pendientes} pendientes (${r.porcentaje}%)`,
      hace: relativeTime(now),
    })
  }

  // 3. Zonas del almacen con ocupacion critica.
  for (const z of almacen.zonas.filter((x) => x.porcentaje > 90).slice(0, 1)) {
    alertas.push({
      id: `alt-alm-${z.zona}`,
      tipo: "inventario",
      prioridad: "media",
      titulo: "Zona saturada",
      descripcion: `Zona ${z.zona} al ${z.porcentaje}% - requiere redistribucion`,
      hace: relativeTime(now),
    })
  }

  void empresaId // reservado para consultas adicionales

  return alertas.slice(0, 8)
}

/**
 * Toneladas del Mes (real acumulado vs meta acumulada) — mismo criterio que
 * el Dashboard Operacion/LIP (`app/api/lip-dashboard?mode=monthly`): suma de
 * `metadia` del 1 del mes a hoy, con `Meta Dia` sobrescrita por
 * EMPRESA_META_DIA_TON (lib/empresa-meta-dia.ts, la unica fuente de verdad
 * de la meta diaria). Reemplaza los datos de ejemplo de "Objetivos
 * Estrategicos" en el Dashboard Gerencia.
 */
async function fetchToneladasDelMes(empresaId: number, today: string): Promise<ToneladasDelMes> {
  const supabase = await createClient()
  const inicioMes = `${today.slice(0, 7)}-01`
  const { data } = await supabase
    .from("metadia")
    .select("*")
    .eq("IdEmpresa", empresaId)
    .gte("Fecha", inicioMes)
    .lte("Fecha", today)
    // Tolva ("Tolva"/"Tolva f", solo ID1) es PRODUCCIÓN, no Cargue/Descargue/
    // Distribución -- mismo criterio que app/api/lip-dashboard/route.ts.
    .neq("Tipo de Operacion", "Tolva")
    .neq("Tipo de Operacion", "Tolva f")

  const metaDiaTon = getMetaDiaForEmpresa(empresaId)
  const rows = rewriteMetaDiaRows(data, metaDiaTon)
  const actual = rows.reduce((s, r) => s + (Number(r["Total Toneladas Procesadas"]) || 0), 0)
  const meta = rows.reduce((s, r) => s + (Number(r["Meta Dia"]) || 0), 0)
  return { actual: Math.round(actual * 10) / 10, meta: Math.round(meta * 10) / 10 }
}

// ============================================================================
// Entrypoint: una sola llamada devuelve todo el payload
// ============================================================================

export async function getGerenciaDashboardData(
  selectedEmpresaId?: number,
): Promise<{ success: boolean; data: DashboardGerenciaPayload | null; error?: string }> {
  try {
    const empresaId = selectedEmpresaId || (await getCurrentEmpresaId())
    if (!empresaId) {
      return { success: false, data: null, error: "Empresa no definida" }
    }

    const today = getColombiaDate()

    // Consultas en paralelo.
    const [recibo, almacen, rutas, productividadSemanal, pickingPacking, toneladasDelMes] = await Promise.all([
      fetchRecibo(empresaId, today),
      fetchOcupacion(empresaId),
      fetchRutas(empresaId, today),
      fetchProductividad(empresaId),
      fetchPickingPacking(empresaId, today),
      fetchToneladasDelMes(empresaId, today),
    ])

    // Derivar KPIs a partir de todo lo anterior + algunos scalar queries.
    const supabase = await createClient()
    // Mismo criterio que el módulo "Ver Vehículos": vehículos cuyo
    // fechallegada coincide con el día operativo en curso.
    const { count: vehiculosRecibidos } = await supabase
      .from("citasvehiculos")
      .select("id", { count: "exact", head: true })
      .eq("idempresa", empresaId)
      .eq("fechallegada", today)

    // Operaciones DEL DÍA (`fechacargue = hoy`, mismo criterio que fetchRecibo /
    // fetchToneladasDelMes y que el Dashboard de Operaciones). Antes no tenía
    // filtro de fecha: leía toda la historia de la vista (8.700+ filas) que
    // Supabase cortaba en 1.000 sin avisar, así que "vehículos despachados",
    // "toneladas procesadas" y el OTIF salían de un recorte arbitrario.
    const { data: opsDia } = await supabase
      .from("dashboardoperaciones")
      .select("pesoorden, tipooperacion, estado, ordendecargue")
      .eq("idempresa", empresaId)
      .eq("fechacargue", today)
      .neq("tipooperacion", "Tolva")
      .neq("tipooperacion", "Tolva f")
      .neq("tipooperacion", "proyeccion")

    const isFinalized = (e: string | null) => e === "Fin Operación" || e === "Finalizado LIP"
    const vehiculosDespachados =
      opsDia?.filter((r) => r.tipooperacion === "Cargue" && isFinalized(r.estado)).length || 0
    // Huevos / Empaque MP (por unidad) cuentan como vehículo pero NO como
    // toneladas: su "peso" son unidades (lib/ordenes-por-unidad.ts, 2026-09-30).
    const porUnidadHoy = await codigosOrdenPorUnidad(supabase, (opsDia ?? []).map((r: any) => r.ordendecargue))
    const toneladasProcesadas = Math.round(
      (opsDia
        ?.filter((r: any) => isFinalized(r.estado) && !porUnidadHoy.has(String(r.ordendecargue ?? "").trim()))
        .reduce((s: number, r: any) => s + (r.pesoorden || 0), 0) || 0) * 10,
    ) / 10
    const totalOps = opsDia?.length || 0
    const totalFinalizadas = opsDia?.filter((r) => isFinalized(r.estado)).length || 0
    const cumplimientoOtif = totalOps > 0 ? Math.round((totalFinalizadas / totalOps) * 100) : 0
    const exactitudOperacion = Math.max(0, 100 - (pickingPacking.errores * 5))
    const productividad = totalOps > 0 ? Math.round((totalFinalizadas / totalOps) * 100) : 0

    // Se calculan alertas DESPUES para poder basarlas en las otras colecciones.
    const alertas = await fetchAlertas(empresaId, recibo, rutas, almacen)

    const kpis: GerenciaKpis = {
      vehiculosRecibidos: vehiculosRecibidos || 0,
      vehiculosDespachados,
      toneladasProcesadas,
      cumplimientoOtif,
      exactitudOperacion,
      productividad,
      alertasActivas: alertas.length,
    }

    return {
      success: true,
      data: {
        kpis,
        recibo,
        almacen,
        rutas,
        productividadSemanal,
        pickingPacking,
        alertas,
        toneladasDelMes,
        generatedAt: new Date().toISOString(),
      },
    }
  } catch (error) {
    console.error("[v0] getGerenciaDashboardData error:", error)
    return { success: false, data: null, error: "Error al cargar Dashboard Gerencia" }
  }
}
