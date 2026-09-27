// Barrido de TRUNCAMIENTO a 1.000 filas: ejecuta las acciones de lectura principales con el
// detector de lib/supabase-fetch-truncamiento.ts activo y agrupa los avisos por acción.
//   npx tsx --env-file=.env.local scripts/barrido_truncamiento_supabase.mts
// Ajustar fechas/casos según el periodo con datos. Última corrida limpia: 2026-09-27
// (solo quedan 4 listas que muestran a propósito los 1.000 más recientes).
// Barrido: ejecuta las acciones de lectura principales con el detector de truncamiento
// activo y agrupa los avisos "[supabase] posible truncamiento" por acción.
const avisos: { accion: string; msg: string }[] = []
let accionActual = "(init)"
const warnOrig = console.warn
console.warn = (...a: any[]) => {
  const s = a.map(String).join(" ")
  if (s.includes("posible truncamiento")) avisos.push({ accion: accionActual, msg: s.replace(/^.*filas \(sin \.range\/\.limit\): /, "") })
  else warnOrig(...a)
}
console.log = () => {}
console.error = () => {}

import { getAnalisisFinanciero } from "../lib/analisis-financiero-actions"
import { getConciliacionAvimol } from "../lib/conciliacion-avimol-actions"
import { getParafiscales } from "../lib/parafiscales-actions"
import { getRevisionNominaProyecto, getConciliacionQuincena, getHcPorDia, getAuxiliaresVsAsistencia } from "../lib/revision-nomina-actions"
import { getNovedadesPeriodo } from "../lib/novedades-periodo-actions"
import { getCierreFinanciero } from "../lib/cierre-financiero-actions"
import { getCierreDiario } from "../lib/cierre-diario-actions"
import { getArchivoPlano } from "../lib/archivo-plano-actions"
import { getLiquidaciones } from "../lib/liquidaciones-actions"
import { generarArchivoCargaPila } from "../lib/parafiscales-exportador-actions"
import { getIndicadoresValores, getFacturacionPorProyecto } from "../lib/sig-actions"
import { getCentroCoordinacion } from "../lib/centro-coordinacion-actions"
import { getLiquidacionTolvaDia, getAuditoriaTolva } from "../lib/liquidacion-tolva-actions"
import { getOperacionDia } from "../lib/operacion-dia-actions"
import { getMarcacionesDia } from "../lib/marcaciones-dia-actions"
import { getProgramacionQuincena } from "../lib/programacion-quincena-actions"
import { getAnalisisAusentismoDiario, getAusentismos, getHeadcountColaboradores } from "../lib/ausentismos-actions"
import { getPrefacturaProduccion } from "../lib/prefactura-produccion-actions"
import { getControlFacturacion, getPrefactura } from "../lib/facturacion-control-actions"
import { getDashboardOperacionesData, getDashboardOperacionesStats, getDashboardData, getDashboardStats } from "../lib/dashboard-actions"
import { getGerenciaDashboardData } from "../lib/dashboard-gerencia-actions"
import { getLocationsFromSaldoInvDetalleForTransactions, getLocations, getProductsWithCodes } from "../lib/inventory-actions"
import { getAvailableLoadOrders, getBatchHistory, getBatchHistoryFilters, getOrdenesForAnnulment } from "../lib/batch-actions"
import { getVehiclesFromCitas, getVehiclesForBascula, getVehiclesForSanitaryWithoutOrder, getAvailableVehiclesForAssignment, getVehiclesForDistribution } from "../lib/vehicle-actions"
import { getOrders, getAllOrders, getOrderFiltersData, getLoadOrders, getLoadOrdersForBascula, getVehiclesForSanitaryRegistry, getSanitaryRegistryHistory, getEstadosFilter, getClientesFilter } from "../lib/orders-actions"
import { getPedidosKpis, getDespachoKpis, getVehiculosNoProcesados, getOrdenesRecientes } from "../lib/pedidos-kpis-actions"
import { getCatalogoTransacciones, getAjustesPendientes, getConsultaMovimientos } from "../lib/transacciones-codigo-actions"
import { getDashboardPedidosData } from "../lib/dashboard-pedidos-actions"

const CASOS: [string, () => Promise<any>][] = [
  ["getAnalisisFinanciero 1-4 sep", () => getAnalisisFinanciero([1, 2, 3, 4], "2026-09-01", "2026-09-26", 1)],
  ["getConciliacionAvimol sep", () => getConciliacionAvimol("2026-09-01", "2026-09-26")],
  ["getParafiscales todos ago", () => getParafiscales(null, 2026, 8)],
  ["generarArchivoCargaPila ago", () => generarArchivoCargaPila(2026, 8)],
  ["getRevisionNominaProyecto todos ago q2", () => getRevisionNominaProyecto(null, 2026, 8, 2)],
  ["getConciliacionQuincena sep q1 todos", () => getConciliacionQuincena(2026, 9, 1, 0)],
  ["getHcPorDia sep", () => getHcPorDia(2026, 9)],
  ["getAuxiliaresVsAsistencia sep q1", () => getAuxiliaresVsAsistencia(2026, 9, 1, 0)],
  ["getNovedadesPeriodo id2 sep q2", () => getNovedadesPeriodo(2, 2026, 9, 2)],
  ["getCierreFinanciero id1", () => getCierreFinanciero(1, "2026-09-25")],
  ["getCierreDiario", () => getCierreDiario("2026-09-25", null)],
  ["getArchivoPlano id1 todos", () => getArchivoPlano(1, null, null)],
  ["getLiquidaciones id2", () => getLiquidaciones(2)],
  ["getIndicadoresValores todos sep", () => getIndicadoresValores(null, "2026-09-01", "2026-09-26")],
  ["getIndicadoresValores id1 anio", () => getIndicadoresValores(1, "2026-01-01", "2026-09-26")],
  ["getFacturacionPorProyecto sep", () => getFacturacionPorProyecto("2026-09-01", "2026-09-26")],
  ["getCentroCoordinacion id1", () => getCentroCoordinacion(1, "2026-09-25")],
  ["getCentroCoordinacion id2", () => getCentroCoordinacion(2, "2026-09-25")],
  ["getLiquidacionTolvaDia id1", () => getLiquidacionTolvaDia("2026-09-25", 1)],
  ["getAuditoriaTolva id1 sep", () => getAuditoriaTolva("2026-09-01", "2026-09-26", 1)],
  ["getOperacionDia id1", () => getOperacionDia(1, "2026-09-25")],
  ["getMarcacionesDia id1", () => getMarcacionesDia(1, "2026-09-25")],
  ["getProgramacionQuincena id1 sep q2", () => getProgramacionQuincena(1, 2026, 9, 2)],
  ["getAnalisisAusentismoDiario id1 sep", () => getAnalisisAusentismoDiario(1, "2026", "9")],
  ["getAusentismos id1", () => getAusentismos(1)],
  ["getHeadcountColaboradores id1", () => getHeadcountColaboradores(1)],
  ["getPrefacturaProduccion id2 sep", () => getPrefacturaProduccion(2, "2026-09-01", "2026-09-26")],
  ["getControlFacturacion id1 sep", () => getControlFacturacion(1, { desde: "2026-09-01", hasta: "2026-09-26" } as any)],
  ["getControlFacturacion id1 sin filtros", () => getControlFacturacion(1, {} as any)],
  ["getPrefactura id3 sep", () => getPrefactura(3, { desde: "2026-09-01", hasta: "2026-09-26" })],
  ["getDashboardOperacionesData id1", () => getDashboardOperacionesData(1)],
  ["getDashboardOperacionesStats id1", () => getDashboardOperacionesStats(1)],
  ["getDashboardData", () => getDashboardData()],
  ["getDashboardStats", () => getDashboardStats()],
  ["getGerenciaDashboardData id1", () => getGerenciaDashboardData(1)],
  ["getGerenciaDashboardData todos", () => getGerenciaDashboardData(undefined)],
  ["getLocationsFromSaldoInvDetalleForTransactions id1", () => getLocationsFromSaldoInvDetalleForTransactions(1)],
  ["getLocations id1", () => getLocations(undefined, 1)],
  ["getProductsWithCodes", () => getProductsWithCodes()],
  ["getAvailableLoadOrders id1", () => getAvailableLoadOrders(1)],
  ["getBatchHistory id1", () => getBatchHistory(1)],
  ["getBatchHistoryFilters id1", () => getBatchHistoryFilters(1)],
  ["getOrdenesForAnnulment", () => getOrdenesForAnnulment()],
  ["getVehiclesFromCitas id1", () => getVehiclesFromCitas(1)],
  ["getVehiclesForBascula id1", () => getVehiclesForBascula(1)],
  ["getVehiclesForSanitaryWithoutOrder id1", () => getVehiclesForSanitaryWithoutOrder(1)],
  ["getAvailableVehiclesForAssignment id1", () => getAvailableVehiclesForAssignment(1)],
  ["getVehiclesForDistribution id2", () => getVehiclesForDistribution(2)],
  ["getOrders id1", () => getOrders(1)],
  ["getAllOrders", () => getAllOrders()],
  ["getOrderFiltersData", () => getOrderFiltersData()],
  ["getLoadOrders todas id1", () => getLoadOrders("todas", false, 1)],
  ["getLoadOrdersForBascula id1", () => getLoadOrdersForBascula(1)],
  ["getVehiclesForSanitaryRegistry", () => getVehiclesForSanitaryRegistry()],
  ["getSanitaryRegistryHistory id1", () => getSanitaryRegistryHistory(1)],
  ["getEstadosFilter", () => getEstadosFilter()],
  ["getClientesFilter", () => getClientesFilter()],
  ["getPedidosKpis id1", () => getPedidosKpis(1)],
  ["getDespachoKpis id1", () => getDespachoKpis(1)],
  ["getVehiculosNoProcesados id1", () => getVehiculosNoProcesados(1)],
  ["getOrdenesRecientes id1", () => getOrdenesRecientes(1)],
  ["getCatalogoTransacciones", () => getCatalogoTransacciones()],
  ["getAjustesPendientes id1", () => getAjustesPendientes({ selectedEmpresaId: 1 })],
  ["getConsultaMovimientos id1 sep", () => getConsultaMovimientos({ selectedEmpresaId: 1, desde: "2026-09-01", hasta: "2026-09-26" } as any)],
  ["getDashboardPedidosData id1", () => getDashboardPedidosData(1)],
]

async function main() {
  const t0 = performance.now()
  for (const [nombre, fn] of CASOS) {
    accionActual = nombre
    const inicio = performance.now()
    try {
      await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 90s")), 90_000))])
    } catch (e: any) {
      avisos.push({ accion: nombre, msg: `(ERROR de la acción: ${String(e?.message ?? e).slice(0, 80)})` })
    }
    process.stderr.write(`· ${nombre} ${Math.round(performance.now() - inicio)} ms\n`)
  }
  accionActual = "(fin)"
  const porAccion = new Map<string, string[]>()
  for (const a of avisos) (porAccion.get(a.accion) ?? porAccion.set(a.accion, []).get(a.accion)!).push(a.msg)
  process.stderr.write(`\n===== AVISOS DE TRUNCAMIENTO (${avisos.filter((a) => !a.msg.startsWith("(ERROR")).length}) en ${Math.round((performance.now() - t0) / 1000)} s =====\n`)
  for (const [acc, msgs] of porAccion) {
    process.stderr.write(`\n## ${acc}\n`)
    for (const m of [...new Set(msgs)]) process.stderr.write(`   ${m}\n`)
  }
}
main().then(() => process.exit(0)).catch((e) => { process.stderr.write("ERROR: " + e?.message + "\n"); process.exit(1) })
