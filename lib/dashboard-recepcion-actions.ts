"use server"

/**
 * Server actions para el Dashboard Despachos/Recepción.
 *
 * Fuente: Vista `dashboardoperacionesgerencia` con campos:
 *   - idempresa, ordendecargue, fechacargue, tipooperacion, pesovascula, estado, placa
 *   - Tiempos en MINUTOS: tiempo_llegada_a_pesaje_min, tiempo_pesaje_a_orden_min,
 *     tiempo_orden_a_lote_min, tiempo_lote_a_inicio_min, tiempo_cargue_neto_min,
 *     tiempo_fin_a_pesaje_final_min, tiempo_total_operacion_min, tiempo_en_proceso_min
 *
 * Vista Diaria: Operación en tiempo real del día actual.
 * Vista Mensual/Anual: Análisis histórico agregado.
 */

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaId } from "@/lib/company-filter"
import { codigosOrdenPorUnidad } from "@/lib/ordenes-por-unidad"

// ============================================================================
// Tipos
// ============================================================================

export interface RecepcionKpisDiario {
  volumenHoyTon: number
  ordenesHoy: number
  ordenesCargue: number
  ordenesDescargue: number
  ordenesDistribucion: number
  leadTimePromedioMin: number
  vehiculosActivosPatio: number
  rendimientoTonHr: number
  tiempoPromedioColaMin: number
  cuelloBotellaDia: string
  alertasRojas: number // Vehículos en 'Sin lote' o 'Por pesar'
}

export interface EtapaTiempo {
  etapa: string
  promedioMin: number
  porcentaje: number
  esCuelloBotella: boolean
}

export interface VehiculoActivo {
  placa: string
  estado: string
  tipooperacion: string
  tiempoEnProcesoMin: number
  /**
   * Toneladas; el campo `pesovascula` ya viene almacenado en TONELADAS
   * (la pantalla de báscula valida `pesoNeto > 40` como tope, lo que
   * solo tiene sentido si la unidad es t — un camión típico ronda los
   * 30-35 t). NO dividir entre 1000.
   */
  pesovasculaTon: number
  /**
   * Categoría de urgencia para colorear el item en la UI:
   *   - "danger": estados críticos (Sin lote / Por pesar) o > 90 min
   *   - "warn":   > 45 min en proceso
   *   - "ok":     resto
   */
  urgencia: "ok" | "warn" | "danger"
}

/**
 * Mensaje cíclico que mostramos en el ticker del header. Cada insight
 * tiene un nivel ("info" | "success" | "warn" | "danger") que define
 * el color del marcador y un icono opcional implicito por nivel.
 */
export interface OperacionInsight {
  id: string
  level: "info" | "success" | "warn" | "danger"
  message: string
}

/**
 * Resumen agregado del flujo en patio para la cabecera del panel
 * "Operación en Tiempo Real". Permite mostrar de un vistazo el
 * tamaño del backlog y donde está concentrado.
 */
export interface LiveSummary {
  totalVehiculos: number
  /** Suma de tiempoEnProcesoMin de todos los vehiculos activos. */
  horasAcumuladasMin: number
  /** Toneladas ya pesadas pero aun en proceso. */
  tonsEnProceso: number
  /** Distribucion compacta por estado, descendente. */
  porEstado: Array<{ estado: string; count: number; critico: boolean }>
}

export interface ThroughputHora {
  hora: string
  ordenes: number
  toneladas: number
}

export interface DistribucionEstado {
  estado: string
  cantidad: number
  porcentaje: number
}

export interface VolumenPorTipo {
  tipooperacion: string
  toneladas: number
}

export interface VolumenPorMes {
  mes: string
  cargue: number
  descargue: number
  distribucion: number
  /**
   * Promedio de `tiempo_total_operacion_min` para todas las operaciones
   * de ese mes. Usado por la línea secundaria roja en el ComposedChart
   * de la Vista Anual.
   */
  leadTimePromedioMin: number
}

export interface VolumenPorDia {
  dia: string
  cargue: number
  descargue: number
  distribucion: number
  /**
   * Promedio de `tiempo_total_operacion_min` para todas las operaciones
   * de ese día. Clave para que el ComposedChart de la Vista Mensual
   * muestre la correlación entre volumen y demoras.
   */
  leadTimePromedioMin: number
}

/**
 * KPIs específicos de la Vista Mensual. No reusamos `RecepcionKpisDiario`
 * porque algunos significados cambian (por ejemplo "rendimiento" en
 * tiempo real vs promedio diario, o "alertas rojas" del momento vs
 * "día pico" del mes).
 */
export interface RecepcionKpisMensual {
  /** Suma de pesovascula del mes en toneladas. */
  volumenAcumuladoTon: number
  /** Volumen / días operativos transcurridos (con al menos 1 orden). */
  promedioDiarioTon: number
  /** Total de registros del mes. */
  totalOrdenesMes: number
  pctCargue: number
  pctDescargue: number
  pctDistribucion: number
  /** Promedio general de tiempo_total_operacion_min en el mes. */
  leadTimePromedioMin: number
  /** Día (DD) con la mayor suma de toneladas. */
  diaPicoLabel: string
  diaPicoTon: number
  /** Promedio del mes de tiempo_orden_a_lote_min. */
  tiempoPromedioColaMin: number
  /** Etapa con mayor promedio en el mes. */
  cuelloBotellaMes: string
  /**
   * % de variación vs mes anterior. Por ahora siempre 0 (estable),
   * pero el campo existe para poder llenarlo cuando tengamos historial.
   */
  evolucionLeadTimePct: number
}

export interface VolumenPorCategoria {
  categoria: string
  toneladas: number
  ordenes: number
}

/**
 * KPIs específicos de la Vista Anual (YTD). Se calculan agrupando toda
 * la data del año en curso. La proyección de cierre es un cálculo
 * simple: promedio mensual * 12; no intenta ser un forecast estadistico
 * — sirve como "si seguimos al ritmo actual, terminaremos así".
 */
export interface RecepcionKpisAnual {
  /** Suma total de pesovascula del año en curso (toneladas). */
  volumenTotalYTDTon: number
  /** Volumen total / meses transcurridos. */
  promedioMensualTon: number
  /** Total de órdenes del año. */
  totalOrdenesYTD: number
  pctCargue: number
  pctDescargue: number
  pctDistribucion: number
  /** Promedio histórico (todo el año) de tiempo_total_operacion_min. */
  leadTimeHistoricoMin: number
  /** Mes con mayor volumen del año. */
  mesRecordLabel: string
  mesRecordTon: number
  /** Etapa con mayor promedio histórico (mostrar en rojo). */
  cuelloBotellaAnual: string
  /** Mes con MENOR lead time promedio (>0). "—" si no hay data. */
  mesEficienteLabel: string
  mesEficienteMin: number
  /** Proyección simple de cierre: promedioMensualTon * 12. */
  proyeccionCierreTon: number
}

export interface DashboardRecepcionPayload {
  kpisDiario: RecepcionKpisDiario
  /** Solo presente cuando vistaActual === "mensual". */
  kpisMensual?: RecepcionKpisMensual
  /** Solo presente cuando vistaActual === "anual". */
  kpisAnual?: RecepcionKpisAnual
  etapasTiempo: EtapaTiempo[]
  vehiculosActivos: VehiculoActivo[]
  /** Resumen agregado para la cabecera del Live Tracker (solo diario). */
  liveSummary?: LiveSummary
  /** Mensajes para el ticker rotativo (solo diario). */
  insightsDelDia?: OperacionInsight[]
  throughputHora: ThroughputHora[]
  distribucionEstados: DistribucionEstado[]
  volumenPorTipo: VolumenPorTipo[]
  volumenTemporal: VolumenPorMes[] | VolumenPorDia[]
  volumenPorCategoria: VolumenPorCategoria[]
  vistaActual: "diario" | "mensual" | "anual"
  fechaHoy: string
  /** "YYYY-MM" del mes en análisis (solo para vista mensual). */
  mesActual?: string
  /** Etiqueta legible del mes ("noviembre 2026"). */
  mesActualLabel?: string
  /** Año en análisis (para vistas mensual/anual). */
  anioActual?: number
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

function getColombiaYear(): number {
  const now = new Date()
  const colombia = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
  return colombia.getFullYear()
}

function getColombiaMonth(): number {
  const now = new Date()
  const colombia = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
  return colombia.getMonth() + 1
}

function getColombiaHour(): number {
  const now = new Date()
  const colombia = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
  return colombia.getHours()
}

function parseMinutes(val: unknown): number {
  if (val === null || val === undefined) return 0
  const n = Number(val)
  return Number.isNaN(n) ? 0 : Math.max(0, n)
}

/**
 * Extrae año/mes/día de un campo de fecha tolerando todos los formatos
 * que devuelve la vista `dashboardoperacionesgerencia` según la versión
 * del schema:
 *   - "2026-11-06"             (DATE puro)
 *   - "2026-11-06T12:34:56"     (TIMESTAMP local)
 *   - "2026-11-06T12:34:56.000Z" (TIMESTAMPTZ con UTC)
 *   - "2026-11-06 12:34:56"     (TIMESTAMP con espacio)
 *
 * Antes el código usaba `match(/-(\d{2})$/)` para sacar el día, lo que
 * SOLO funcionaba con DATE puro: en cuanto la columna tiene un timestamp
 * la regex falla, la fila se descarta y la sumatoria de toneladas en la
 * Vista Mensual / Anual se vuelve absurdamente baja (eso explica que
 * "100 toneladas de ayer" aparezcan como 0.1 en la tendencia mensual).
 *
 * Devolvemos null si el string no calza ni siquiera con el prefijo
 * básico, para que el caller pueda decidir si saltar la fila.
 */
function parseFechaParts(
  s: string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!s) return null
  // Capturamos los primeros 10 caracteres "YYYY-MM-DD" que comparten
  // todos los formatos. No usamos new Date() para evitar deslices de
  // timezone que muevan el día al anterior.
  const match = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  if (!year || !month || !day) return null
  return { year, month, day }
}

/** Formato corto de toneladas para mensajes de insights. */
function fmtTonShort(n: number): string {
  if (n >= 1000) {
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(n)
  }
  // Para <1000 mantenemos 1 decimal pero sin decimales finales en .0.
  const rounded = Math.round(n * 10) / 10
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(rounded)
}

const MES_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

// ============================================================================
// Query principal
// ============================================================================

interface RawRow {
  idempresa: number
  ordendecargue: string | number
  fechacargue: string | null
  tipooperacion: string | null
  pesovascula: number | null
  /** Peso en `dashboardoperaciones` (empresas 3 y 4). Se normaliza a pesovascula. */
  pesoorden?: number | null
  estado: string | null
  placa?: string | null
  tiempo_llegada_a_pesaje_min?: number | null
  tiempo_pesaje_a_orden_min?: number | null
  tiempo_orden_a_lote_min?: number | null
  tiempo_lote_a_inicio_min?: number | null
  tiempo_cargue_neto_min?: number | null
  tiempo_fin_a_pesaje_final_min?: number | null
  tiempo_total_operacion_min?: number | null
  tiempo_en_proceso_min?: number | null
  categoria?: string | null
  horacreacion?: string | null
  // Legacy field names (fallback)
  tiempo_llegada_a_pesaje?: number | null
  tiempo_pesaje_a_orden?: number | null
  tiempo_lote_a_inicio?: number | null
  tiempo_cargue_neto?: number | null
  tiempo_fin_a_pesaje_final?: number | null
}

export async function getDashboardRecepcionData(
  selectedEmpresaId?: number,
  vista: "diario" | "mensual" | "anual" = "diario",
  /**
   * Fecha objetivo (YYYY-MM-DD) para la vista diaria. Si se omite, se
   * usa el dia actual en zona Bogota. Permite consultar el cierre de
   * dias anteriores desde el dashboard de "Cierre del Dia".
   */
  fecha?: string,
  /**
   * Año/mes objetivo para las vistas mensual y anual. Permiten que el
   * usuario navegue a periodos historicos distintos al actual:
   *   - vista "mensual": usa targetYear + targetMonth.
   *   - vista "anual":   usa targetYear (YTD si es el año en curso, o el
   *     año completo si es un año pasado).
   * Si se omiten, se usa el año/mes actual en zona Bogota.
   */
  targetYear?: number,
  targetMonth?: number,
): Promise<{ success: boolean; data: DashboardRecepcionPayload | null; error?: string }> {
  try {
    const empresaId = selectedEmpresaId || (await getCurrentEmpresaId())
    if (!empresaId) {
      return { success: false, data: null, error: "Empresa no definida" }
    }

    const supabase = await createClient()
    const todayReal = getColombiaDate()
    const currentYear = getColombiaYear()
    const today = fecha || todayReal
    // Año/mes efectivos: respetan el periodo seleccionado por el usuario,
    // cayendo al actual cuando no se especifica.
    const year = targetYear || currentYear
    const month = targetMonth || getColombiaMonth()
    const currentHour = getColombiaHour()

    // Determinamos el rango de fechas según la vista
    let fechaInicio: string
    let fechaFin: string

    if (vista === "diario") {
      fechaInicio = today
      fechaFin = today
    } else if (vista === "mensual") {
      fechaInicio = `${year}-${String(month).padStart(2, "0")}-01`
      const lastDay = new Date(year, month, 0).getDate()
      fechaFin = `${year}-${String(month).padStart(2, "0")}-${lastDay}`
    } else {
      // Anual: desde el 1 de enero del año objetivo.
      // - Año en curso: YTD (hasta hoy) para no inflar el rango con
      //   meses futuros sin data y mantener el "promedio mensual" sano.
      // - Año pasado: año completo (hasta 31 de diciembre).
      fechaInicio = `${year}-01-01`
      fechaFin = year < currentYear ? `${year}-12-31` : today
    }

    // ────────────────────────────────────────────────────────────────
    // Fuente de datos por empresa.
    //
    // Por defecto el dashboard lee de la vista `dashboardoperacionesgerencia`,
    // donde el peso vive en `pesovascula`. Sin embargo, las empresas 3 y 4
    // NO registran `pesovascula` (viene null en sus operaciones de Cargue),
    // por lo que el volumen aparecía en 0. Para esas dos empresas usamos la
    // tabla `dashboardoperaciones`, cuyo peso está en `pesoorden`, y lo
    // normalizamos al campo `pesovascula` para que TODO el cálculo posterior
    // funcione sin cambios.
    const usaPesoOrden = empresaId === 3 || empresaId === 4
    const tabla = usaPesoOrden ? "dashboardoperaciones" : "dashboardoperacionesgerencia"

    // Paginación: PostgREST limita por defecto a 1000 filas por respuesta.
    // Sin paginar, periodos mensuales/anuales con >1000 órdenes se truncaban
    // silenciosamente (perdiendo más del 50% del volumen). Iteramos en
    // bloques de 1000 hasta traer el rango completo.
    const PAGE_SIZE = 1000
    const rows: RawRow[] = []
    let from = 0
    while (true) {
      const { data: pageData, error: queryError } = await supabase
        .from(tabla)
        .select("*")
        .eq("idempresa", empresaId)
        .gte("fechacargue", fechaInicio)
        .lte("fechacargue", fechaFin)
        // "proyeccion" excluido (2026-09-08): residuo de un módulo manual
        // descontinuado en jul-2026, nunca fue tonelaje real (ver
        // scripts/053_pagonomina_reemplazo.sql) -- sin esto inflaba el volumen y
        // los conteos de órdenes de ID3/ID4 en este dashboard.
        .neq("tipooperacion", "proyeccion")
        // "Tolva"/"Tolva f" excluido (2026-09-15): es PRODUCCIÓN reclasificada
        // (solo ID1), no una operación de Cargue/Descargue/Distribución a
        // cliente -- mezclarla inflaba el volumen del día/mes de Indupan.
        .neq("tipooperacion", "Tolva")
        .neq("tipooperacion", "Tolva f")
        .order("fechacargue", { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (queryError) {
        console.error(`[v0] Error fetching ${tabla}:`, queryError)
        return { success: false, data: null, error: "Error al consultar datos de operaciones" }
      }

      const page = pageData || []
      // Normalizamos `pesoorden` → `pesovascula` para empresas 3 y 4.
      for (const r of page as any[]) {
        if (usaPesoOrden) r.pesovascula = r.pesoorden ?? null
        rows.push(r as RawRow)
      }

      if (page.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // Huevos / Empaque MP (por unidad, Avimol): cuentan como orden/vehículo
    // pero NO como toneladas: su "peso" son unidades. Se deja en 0 aquí, una
    // sola vez, para que TODO el cálculo posterior (día, mes, año, por
    // transporte, por cliente) los excluya (lib/ordenes-por-unidad.ts, 2026-09-30).
    const porUnidadRec = await codigosOrdenPorUnidad(supabase, rows.map((r) => String(r.ordendecargue ?? "")))
    for (const r of rows as any[]) {
      if (porUnidadRec.has(String(r.ordendecargue ?? "").trim())) r.pesovascula = 0
    }

    // ========================================================================
    // KPIs Vista Diaria
    // ========================================================================
    const ordenesCargue = rows.filter((r) => r.tipooperacion === "Cargue").length
    const ordenesDescargue = rows.filter((r) => r.tipooperacion === "Descargue").length
    const ordenesDistribucion = rows.filter(
      (r) => r.tipooperacion === "Distribución" || r.tipooperacion === "Distribucion",
    ).length
    const ordenesHoy = rows.length

    // Volumen en toneladas. `pesovascula` YA está en toneladas en la
    // BD (cf. tope de validación `pesoNeto > 40` en bascula-form), por
    // eso NO dividimos entre 1000. Antes lo hacíamos y por eso 100 t
    // del día anterior aparecían como 0.1 en la tendencia mensual.
    const volumenHoyTon = rows.reduce((sum, r) => sum + (r.pesovascula || 0), 0)

    // Lead Time promedio (solo órdenes finalizadas)
    const finalizadas = rows.filter((r) => r.estado === "Fin Operación" || r.estado === "Finalizado LIP")
    const tiemposTotales = finalizadas
      .map((r) => parseMinutes(r.tiempo_total_operacion_min))
      .filter((m) => m > 0)
    const leadTimePromedioMin =
      tiemposTotales.length > 0
        ? Math.round(tiemposTotales.reduce((a, b) => a + b, 0) / tiemposTotales.length)
        : 0

    // Vehículos activos en patio (estado != Fin Operación)
    const vehiculosActivosPatio = rows.filter(
      (r) => r.estado !== "Fin Operación" && r.estado !== "Finalizado LIP",
    ).length

    // Rendimiento actual (Ton/Hr): volumen / horas transcurridas
    const horasTranscurridas = Math.max(1, currentHour - 6) // Asumiendo jornada desde las 6am
    const rendimientoTonHr = Math.round((volumenHoyTon / horasTranscurridas) * 10) / 10

    // Tiempo promedio en cola (tiempo_orden_a_lote_min)
    const tiemposCola = rows
      .map((r) => parseMinutes(r.tiempo_orden_a_lote_min))
      .filter((m) => m > 0)
    const tiempoPromedioColaMin =
      tiemposCola.length > 0
        ? Math.round(tiemposCola.reduce((a, b) => a + b, 0) / tiemposCola.length)
        : 0

    // Alertas rojas: vehículos en 'Sin lote' o 'Por pesar'
    const alertasRojas = rows.filter(
      (r) => r.estado === "Sin lote" || r.estado === "Por pesar",
    ).length

    // ========================================================================
    // Análisis de Cuellos de Botella (Funnel de Tiempos)
    // ========================================================================
    const etapasConfig = [
      { key: "tiempo_llegada_a_pesaje_min", legacy: "tiempo_llegada_a_pesaje", label: "Llegada → Pesaje" },
      { key: "tiempo_pesaje_a_orden_min", legacy: "tiempo_pesaje_a_orden", label: "Pesaje → Orden" },
      { key: "tiempo_orden_a_lote_min", legacy: null, label: "Orden → Lote" },
      { key: "tiempo_lote_a_inicio_min", legacy: "tiempo_lote_a_inicio", label: "Lote → Inicio" },
      { key: "tiempo_cargue_neto_min", legacy: "tiempo_cargue_neto", label: "Cargue/Descargue" },
      { key: "tiempo_fin_a_pesaje_final_min", legacy: "tiempo_fin_a_pesaje_final", label: "Fin → Pesaje Final" },
    ] as const

    // Para cada etapa del funnel calculamos el PROMEDIO POR VEHICULO
    // (no la suma del dia). Importante:
    //
    // - `tiempos` es la lista de tiempos > 0 que reportaron los
    //   vehiculos para ESA etapa (un valor por vehiculo que ya paso por
    //   la etapa).
    // - El divisor es `tiempos.length` (vehiculos que efectivamente
    //   pasaron por la etapa), NO `rows.length`. Esto evita diluir el
    //   promedio con ceros de vehiculos que aun no llegaron a la etapa
    //   y representa correctamente "cuanto en promedio espero cada
    //   vehiculo en esta etapa de espera".
    // - Si un solo vehiculo paso por la etapa, el "promedio" es ese
    //   unico valor (matematicamente correcto). Esto puede parecer una
    //   "suma" cuando el dia tiene poco volumen y el vehiculo tomo
    //   mucho tiempo, pero es el comportamiento esperado.
    const etapasPromedio: { etapa: string; promedioMin: number }[] = etapasConfig.map((cfg) => {
      const tiempos = rows
        .map((r) => {
          const val = r[cfg.key as keyof RawRow] ?? (cfg.legacy ? r[cfg.legacy as keyof RawRow] : null)
          return parseMinutes(val)
        })
        .filter((m) => m > 0)
      const suma = tiempos.reduce((a, b) => a + b, 0)
      const cantidadVehiculos = tiempos.length
      const promedio = cantidadVehiculos > 0 ? suma / cantidadVehiculos : 0
      return { etapa: cfg.label, promedioMin: Math.round(promedio) }
    })

    const totalTiempo = etapasPromedio.reduce((sum, e) => sum + e.promedioMin, 0)
    const maxTiempo = Math.max(...etapasPromedio.map((e) => e.promedioMin))
    const cuelloBotellaDia =
      etapasPromedio.find((e) => e.promedioMin === maxTiempo && maxTiempo > 0)?.etapa || "N/A"

    const etapasTiempo: EtapaTiempo[] = etapasPromedio.map((e) => ({
      etapa: e.etapa,
      promedioMin: e.promedioMin,
      porcentaje: totalTiempo > 0 ? Math.round((e.promedioMin / totalTiempo) * 100) : 0,
      esCuelloBotella: e.promedioMin === maxTiempo && maxTiempo > 0,
    }))

    // ========================================================================
    // Vehículos Activos (Live Tracker - solo vista diaria)
    // ========================================================================
    const ESTADOS_CRITICOS = new Set(["Sin lote", "Por pesar"])

    const vehiculosActivos: VehiculoActivo[] = rows
      .filter((r) => r.estado !== "Fin Operación" && r.estado !== "Finalizado LIP")
      .map((r) => {
        const tiempo = parseMinutes(r.tiempo_en_proceso_min)
        const estado = (r.estado || "Sin estado").trim()
        // Heurística simple: estados críticos pintan rojo desde el
        // primer minuto; el resto sube según cuanto tiempo lleva.
        let urgencia: "ok" | "warn" | "danger" = "ok"
        if (ESTADOS_CRITICOS.has(estado) || tiempo > 90) urgencia = "danger"
        else if (tiempo > 45) urgencia = "warn"

        return {
          placa: (r.placa || "N/A").trim(),
          estado,
          tipooperacion: (r.tipooperacion || "N/A").trim(),
          tiempoEnProcesoMin: tiempo,
          pesovasculaTon: r.pesovascula ? Math.round(r.pesovascula * 10) / 10 : 0,
          urgencia,
        }
      })
      .sort((a, b) => b.tiempoEnProcesoMin - a.tiempoEnProcesoMin)
      .slice(0, 20)

    // Resumen agregado del live tracker.
    const horasAcumuladasMin = vehiculosActivos.reduce(
      (s, v) => s + v.tiempoEnProcesoMin,
      0,
    )
    const tonsEnProceso =
      Math.round(vehiculosActivos.reduce((s, v) => s + v.pesovasculaTon, 0) * 10) / 10
    // OJO: usamos un nombre distinto a `estadoCount` porque mas abajo
    // (en el bucket de "Distribución de Estados") ya hay otra variable
    // con ese nombre que cuenta TODOS los rows del periodo, no solo los
    // vehiculos activos. Mantenerlas separadas evita el shadowing y deja
    // claro que sirven para cosas distintas.
    const liveEstadoCount = new Map<string, number>()
    for (const v of vehiculosActivos) {
      liveEstadoCount.set(v.estado, (liveEstadoCount.get(v.estado) ?? 0) + 1)
    }
    const liveSummary: LiveSummary = {
      totalVehiculos: vehiculosActivos.length,
      horasAcumuladasMin,
      tonsEnProceso,
      porEstado: Array.from(liveEstadoCount.entries())
        .map(([estado, count]) => ({
          estado,
          count,
          critico: ESTADOS_CRITICOS.has(estado),
        }))
        .sort((a, b) => b.count - a.count),
    }

    // ========================================================================
    // Throughput por Hora (solo vista diaria)
    // ========================================================================
    const throughputHora: ThroughputHora[] = []
    if (vista === "diario") {
      const horaMap = new Map<string, { ordenes: number; toneladas: number }>()
      for (let h = 6; h <= 22; h++) {
        horaMap.set(String(h).padStart(2, "0"), { ordenes: 0, toneladas: 0 })
      }

      for (const r of rows) {
        let hora: string | null = null
        if (r.horacreacion) {
          const match = String(r.horacreacion).match(/(\d{1,2}):/)
          if (match) hora = match[1].padStart(2, "0")
        }
        if (!hora && r.fechacargue) {
          // Soportamos los dos separadores que produce Postgres al
          // serializar timestamps a JSON: "T" (ISO) y " " (formato
          // legacy). Antes solo aceptábamos "T", lo que tiraba muchos
          // registros del bucket horario.
          const match = String(r.fechacargue).match(/[T ](\d{2}):/)
          if (match) hora = match[1]
        }
        if (hora && horaMap.has(hora)) {
          const entry = horaMap.get(hora)!
          entry.ordenes++
          entry.toneladas += r.pesovascula || 0
        }
      }

      for (const [hora, data] of horaMap.entries()) {
        throughputHora.push({
          hora,
          ordenes: data.ordenes,
          toneladas: Math.round(data.toneladas * 10) / 10,
        })
      }
    }

    // ========================================================================
    // Distribución de Estados (Donut)
    // ========================================================================
    const estadoCount = new Map<string, number>()
    for (const r of rows) {
      const est = (r.estado || "Sin estado").trim()
      estadoCount.set(est, (estadoCount.get(est) || 0) + 1)
    }

    const distribucionEstados: DistribucionEstado[] = Array.from(estadoCount.entries())
      .map(([estado, cantidad]) => ({
        estado,
        cantidad,
        porcentaje: ordenesHoy > 0 ? Math.round((cantidad / ordenesHoy) * 100) : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad)

    // ========================================================================
    // Volumen por Tipo de Operación
    // ========================================================================
    const volumenPorTipo: VolumenPorTipo[] = [
      { tipooperacion: "Cargue", toneladas: 0 },
      { tipooperacion: "Descargue", toneladas: 0 },
      { tipooperacion: "Distribución", toneladas: 0 },
    ]

    for (const r of rows) {
      let t = r.tipooperacion || "Otros"
      if (t === "Distribucion") t = "Distribución"
      const vpt = volumenPorTipo.find((v) => v.tipooperacion === t)
      if (vpt) {
        vpt.toneladas += r.pesovascula || 0
      }
    }

    volumenPorTipo.forEach((v) => {
      v.toneladas = Math.round(v.toneladas * 10) / 10
    })

    // ========================================================================
    // Volumen por Categoría
    // ========================================================================
    const categoriaMap = new Map<string, { toneladas: number; ordenes: number }>()
    for (const r of rows) {
      const cat = (r.categoria || "Sin categoría").trim()
      const entry = categoriaMap.get(cat) || { toneladas: 0, ordenes: 0 }
      entry.toneladas += r.pesovascula || 0
      entry.ordenes++
      categoriaMap.set(cat, entry)
    }

    const volumenPorCategoria: VolumenPorCategoria[] = Array.from(categoriaMap.entries())
      .map(([categoria, data]) => ({
        categoria,
        toneladas: Math.round(data.toneladas * 10) / 10,
        ordenes: data.ordenes,
      }))
      .sort((a, b) => b.toneladas - a.toneladas)
      .slice(0, 6)

    // ========================================================================
    // Volumen Temporal (mensual/anual)
    // ========================================================================
    let volumenTemporal: VolumenPorMes[] | VolumenPorDia[] = []

    if (vista === "anual") {
      // Bucket por mes con sumas de toneladas + buffer de tiempos para
      // promediar al final (numerador/denominador en una sola pasada).
      const mesMap = new Map<
        number,
        {
          cargue: number
          descargue: number
          distribucion: number
          leadSum: number
          leadCount: number
        }
      >()
      for (let m = 1; m <= 12; m++) {
        mesMap.set(m, { cargue: 0, descargue: 0, distribucion: 0, leadSum: 0, leadCount: 0 })
      }

      for (const r of rows) {
        const parts = parseFechaParts(r.fechacargue)
        if (!parts) continue
        const entry = mesMap.get(parts.month)
        if (!entry) continue
        // pesovascula ya viene en toneladas, NO dividir.
        const ton = r.pesovascula || 0
        if (r.tipooperacion === "Cargue") entry.cargue += ton
        else if (r.tipooperacion === "Descargue") entry.descargue += ton
        else if (r.tipooperacion === "Distribución" || r.tipooperacion === "Distribucion")
          entry.distribucion += ton

        const lt = parseMinutes(r.tiempo_total_operacion_min)
        if (lt > 0) {
          entry.leadSum += lt
          entry.leadCount++
        }
      }

      volumenTemporal = Array.from(mesMap.entries()).map(([m, data]) => ({
        mes: MES_LABELS[m - 1],
        cargue: Math.round(data.cargue * 10) / 10,
        descargue: Math.round(data.descargue * 10) / 10,
        distribucion: Math.round(data.distribucion * 10) / 10,
        leadTimePromedioMin:
          data.leadCount > 0 ? Math.round(data.leadSum / data.leadCount) : 0,
      })) as VolumenPorMes[]
    } else if (vista === "mensual") {
      const lastDay = new Date(year, month, 0).getDate()
      const diaMap = new Map<
        number,
        {
          cargue: number
          descargue: number
          distribucion: number
          leadSum: number
          leadCount: number
        }
      >()
      for (let d = 1; d <= lastDay; d++) {
        diaMap.set(d, { cargue: 0, descargue: 0, distribucion: 0, leadSum: 0, leadCount: 0 })
      }

      for (const r of rows) {
        const parts = parseFechaParts(r.fechacargue)
        // Filtramos por mes activo: en vista mensual el query ya viene
        // limitado por rango pero validar el mes dentro del bucket es
        // barato y nos protege si en el futuro la query incluye días
        // adyacentes (ej. timezone shifts).
        if (!parts || parts.month !== month) continue
        const entry = diaMap.get(parts.day)
        if (!entry) continue
        // pesovascula ya viene en toneladas, NO dividir.
        const ton = r.pesovascula || 0
        if (r.tipooperacion === "Cargue") entry.cargue += ton
        else if (r.tipooperacion === "Descargue") entry.descargue += ton
        else if (r.tipooperacion === "Distribución" || r.tipooperacion === "Distribucion")
          entry.distribucion += ton

        const lt = parseMinutes(r.tiempo_total_operacion_min)
        if (lt > 0) {
          entry.leadSum += lt
          entry.leadCount++
        }
      }

      volumenTemporal = Array.from(diaMap.entries()).map(([d, data]) => ({
        dia: String(d).padStart(2, "0"),
        cargue: Math.round(data.cargue * 10) / 10,
        descargue: Math.round(data.descargue * 10) / 10,
        distribucion: Math.round(data.distribucion * 10) / 10,
        leadTimePromedioMin:
          data.leadCount > 0 ? Math.round(data.leadSum / data.leadCount) : 0,
      })) as VolumenPorDia[]
    }

    // ========================================================================
    // KPIs Diario agregados
    // ========================================================================
    const kpisDiario: RecepcionKpisDiario = {
      volumenHoyTon: Math.round(volumenHoyTon * 10) / 10,
      ordenesHoy,
      ordenesCargue,
      ordenesDescargue,
      ordenesDistribucion,
      leadTimePromedioMin,
      vehiculosActivosPatio,
      rendimientoTonHr,
      tiempoPromedioColaMin,
      cuelloBotellaDia,
      alertasRojas,
    }

    // ========================================================================
    // Insights del Día (mensajes para el ticker - solo vista diaria)
    // ========================================================================
    let insightsDelDia: OperacionInsight[] | undefined
    if (vista === "diario") {
      const arr: OperacionInsight[] = []

      // 1) Total operado vs ritmo
      if (volumenHoyTon > 0) {
        arr.push({
          id: "vol",
          level: "info",
          message: `Hoy se han operado ${fmtTonShort(volumenHoyTon)} t en ${ordenesHoy} órdenes (${ordenesCargue} cargue · ${ordenesDescargue} descargue${ordenesDistribucion > 0 ? ` · ${ordenesDistribucion} distrib.` : ""}).`,
        })
      }

      // 2) Ritmo / proyección lineal del día
      if (rendimientoTonHr > 0) {
        // Proyección al final de la jornada (asumimos 16h productivas).
        const proyeccion = Math.round(rendimientoTonHr * 16)
        arr.push({
          id: "ritmo",
          level: "success",
          message: `Ritmo actual: ${fmtTonShort(rendimientoTonHr)} t/h. Proyección de cierre: ~${fmtTonShort(proyeccion)} t.`,
        })
      }

      // 3) Pico horario detectado
      const picoEntry = throughputHora.reduce(
        (best, cur) => (cur.toneladas > best.toneladas ? cur : best),
        { hora: "", toneladas: 0, ordenes: 0 } as ThroughputHora,
      )
      if (picoEntry.toneladas > 0) {
        arr.push({
          id: "pico",
          level: "info",
          message: `Hora pico: ${picoEntry.hora}:00 con ${fmtTonShort(picoEntry.toneladas)} t (${picoEntry.ordenes} órdenes).`,
        })
      }

      // 4) Cuello de botella estructural del día
      if (cuelloBotellaDia !== "N/A") {
        const cuelloEtapa = etapasTiempo.find((e) => e.esCuelloBotella)
        if (cuelloEtapa) {
          arr.push({
            id: "cuello",
            level: "warn",
            message: `Cuello de botella en "${cuelloBotellaDia}" con ${cuelloEtapa.promedioMin} min promedio (${cuelloEtapa.porcentaje}% del lead time total).`,
          })
        }
      }

      // 5) Alertas rojas concretas (estado crítico en patio)
      if (alertasRojas > 0) {
        arr.push({
          id: "alertas",
          level: "danger",
          message: `${alertasRojas} ${alertasRojas === 1 ? "vehículo requiere" : "vehículos requieren"} atención inmediata (Sin lote / Por pesar).`,
        })
      }

      // 6) Vehículo más demorado
      const peor = vehiculosActivos[0]
      if (peor && peor.tiempoEnProcesoMin > 60) {
        arr.push({
          id: "demora",
          level: peor.urgencia === "danger" ? "danger" : "warn",
          message: `Vehículo ${peor.placa} lleva ${Math.round(peor.tiempoEnProcesoMin)} min en proceso (estado "${peor.estado}").`,
        })
      }

      // 7) Si lead time es muy alto vs umbral típico
      if (leadTimePromedioMin > 120) {
        arr.push({
          id: "lead",
          level: "warn",
          message: `Lead time promedio elevado: ${leadTimePromedioMin} min (umbral objetivo: 120 min).`,
        })
      } else if (leadTimePromedioMin > 0 && leadTimePromedioMin <= 90) {
        arr.push({
          id: "lead-ok",
          level: "success",
          message: `Lead time promedio en zona óptima: ${leadTimePromedioMin} min.`,
        })
      }

      // Si no hay nada, devolvemos un placeholder neutro.
      if (arr.length === 0) {
        arr.push({
          id: "sin-datos",
          level: "info",
          message: "Sin actividad registrada hoy todavía.",
        })
      }
      insightsDelDia = arr
    }

    // ========================================================================
    // KPIs Mensuales (solo cuando vista === "mensual")
    // ========================================================================
    let kpisMensual: RecepcionKpisMensual | undefined
    let mesActual: string | undefined
    let mesActualLabel: string | undefined

    if (vista === "mensual") {
      mesActual = `${year}-${String(month).padStart(2, "0")}`
      // Etiqueta legible "noviembre 2026" usando Intl en es-CO. Probamos
      // construir la fecha local del 1ro de mes a las 12pm para evitar
      // problemas de timezone (que mover el día al mes anterior).
      mesActualLabel = new Date(year, month - 1, 1, 12, 0, 0).toLocaleDateString("es-CO", {
        month: "long",
        year: "numeric",
      })

      const diasMap = volumenTemporal as VolumenPorDia[]

      // Días operativos = días con al menos 1 orden (cargue+descargue+distribucion > 0)
      const diasOperativos = diasMap.filter(
        (d) => d.cargue + d.descargue + d.distribucion > 0,
      ).length

      const promedioDiarioTon =
        diasOperativos > 0
          ? Math.round((volumenHoyTon / diasOperativos) * 10) / 10
          : 0

      // Día pico: el día con la suma más alta de toneladas en el mes.
      let diaPicoLabel = "—"
      let diaPicoTon = 0
      for (const d of diasMap) {
        const tot = d.cargue + d.descargue + d.distribucion
        if (tot > diaPicoTon) {
          diaPicoTon = tot
          diaPicoLabel = `${d.dia}/${String(month).padStart(2, "0")}`
        }
      }

      const totalOrdenesMes = ordenesHoy
      const pctCargue =
        totalOrdenesMes > 0 ? Math.round((ordenesCargue / totalOrdenesMes) * 100) : 0
      const pctDescargue =
        totalOrdenesMes > 0 ? Math.round((ordenesDescargue / totalOrdenesMes) * 100) : 0
      const pctDistribucion =
        totalOrdenesMes > 0
          ? Math.round((ordenesDistribucion / totalOrdenesMes) * 100)
          : 0

      kpisMensual = {
        volumenAcumuladoTon: Math.round(volumenHoyTon * 10) / 10,
        promedioDiarioTon,
        totalOrdenesMes,
        pctCargue,
        pctDescargue,
        pctDistribucion,
        leadTimePromedioMin,
        diaPicoLabel,
        diaPicoTon: Math.round(diaPicoTon * 10) / 10,
        tiempoPromedioColaMin,
        cuelloBotellaMes: cuelloBotellaDia,
        // Sin historial de mes anterior aún, devolvemos 0 = "estable".
        evolucionLeadTimePct: 0,
      }
    }

    // ========================================================================
    // KPIs Anuales (solo cuando vista === "anual")
    // ========================================================================
    let kpisAnual: RecepcionKpisAnual | undefined

    if (vista === "anual") {
      const meses = volumenTemporal as VolumenPorMes[]

      // Meses transcurridos: para el año en curso usamos el numero de
      // mes actual (en marzo dividimos entre 3); para un año pasado el
      // año ya esta completo, asi que dividimos entre 12.
      const mesesTranscurridos = year < currentYear ? 12 : month
      const promedioMensualTon =
        mesesTranscurridos > 0
          ? Math.round((volumenHoyTon / mesesTranscurridos) * 10) / 10
          : 0

      // Mes record = el mes con mayor suma cargue+descargue+distribucion.
      let mesRecordLabel = "—"
      let mesRecordTon = 0
      for (const m of meses) {
        const tot = m.cargue + m.descargue + m.distribucion
        if (tot > mesRecordTon) {
          mesRecordTon = tot
          mesRecordLabel = m.mes
        }
      }

      // Mes mas eficiente = el mes con MENOR lead time promedio (>0).
      // Excluimos meses sin data porque su lead = 0 (engañoso).
      let mesEficienteLabel = "—"
      let mesEficienteMin = 0
      const mesesConData = meses.filter((m) => m.leadTimePromedioMin > 0)
      if (mesesConData.length > 0) {
        const best = mesesConData.reduce((a, b) =>
          a.leadTimePromedioMin <= b.leadTimePromedioMin ? a : b,
        )
        mesEficienteLabel = best.mes
        mesEficienteMin = best.leadTimePromedioMin
      }

      const totalOrdenesYTD = ordenesHoy
      const pctCargueY =
        totalOrdenesYTD > 0 ? Math.round((ordenesCargue / totalOrdenesYTD) * 100) : 0
      const pctDescargueY =
        totalOrdenesYTD > 0 ? Math.round((ordenesDescargue / totalOrdenesYTD) * 100) : 0
      const pctDistribucionY =
        totalOrdenesYTD > 0 ? Math.round((ordenesDistribucion / totalOrdenesYTD) * 100) : 0

      kpisAnual = {
        volumenTotalYTDTon: Math.round(volumenHoyTon * 10) / 10,
        promedioMensualTon,
        totalOrdenesYTD,
        pctCargue: pctCargueY,
        pctDescargue: pctDescargueY,
        pctDistribucion: pctDistribucionY,
        leadTimeHistoricoMin: leadTimePromedioMin,
        mesRecordLabel,
        mesRecordTon: Math.round(mesRecordTon * 10) / 10,
        cuelloBotellaAnual: cuelloBotellaDia,
        mesEficienteLabel,
        mesEficienteMin,
        proyeccionCierreTon: Math.round(promedioMensualTon * 12 * 10) / 10,
      }
    }

    return {
      success: true,
      data: {
        kpisDiario,
        kpisMensual,
        kpisAnual,
        etapasTiempo,
        vehiculosActivos,
        // liveSummary y insightsDelDia solo tienen sentido en la vista
        // diaria; en mensual/anual los enviamos como undefined.
        liveSummary: vista === "diario" ? liveSummary : undefined,
        insightsDelDia,
        throughputHora,
        distribucionEstados,
        volumenPorTipo,
        volumenTemporal,
        volumenPorCategoria,
        vistaActual: vista,
        fechaHoy: today,
        mesActual,
        mesActualLabel,
        anioActual: year,
        generatedAt: new Date().toISOString(),
      },
    }
  } catch (error) {
    console.error("[v0] getDashboardRecepcionData error:", error)
    return { success: false, data: null, error: "Error al cargar Dashboard Despachos/Recepción" }
  }
}
