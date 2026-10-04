"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"

// KPIs de gestión del cliente para el módulo de Pedidos, alineados a los objetivos
// del área (cumplimiento de entregas). Misma definición del Dashboard Pedidos:
//   - Universo: pedido con fecha_programada (promesa) y SIN fechaordencargue (no
//     entregado aún). Se excluyen anulados.
//   - Vencido = fecha_programada < hoy (America/Bogota) · Vence hoy = == hoy
//   - Por vencer = fecha_programada en los próximos 7 días.
// Optimizado: se usan CONSULTAS DE CONTEO en paralelo (no se traen todas las filas).

export interface PedidosKpis {
  total: number
  pendientes: number
  vencidos: number
  venceHoy: number
  porVencer7: number
  entregados: number
  valorVencido: number
}

// Fecha de hoy en Bogotá + a 7 días, en formato YYYY-MM-DD (las columnas son texto de fecha).
function fechasBogota() {
  const b = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }))
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const b7 = new Date(b)
  b7.setDate(b.getDate() + 7)
  return { hoyStr: ymd(b), en7Str: ymd(b7) }
}

export async function getPedidosKpis(selectedEmpresaId?: number | null): Promise<PedidosKpis> {
  const empty: PedidosKpis = { total: 0, pendientes: 0, vencidos: 0, venceHoy: 0, porVencer7: 0, entregados: 0, valorVencido: 0 }
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return empty
  const { hoyStr, en7Str } = fechasBogota()

  // Base: pedidos de la empresa, excluyendo anulados (misma condición del dashboard).
  const base = () =>
    sb.from("pedidoscabecera").select("*", { count: "exact", head: true }).eq("id_empresa", empresaId).or("estado.is.null,and(estado.not.ilike.%anulado%,estado.not.ilike.no entregado)")
  // Pendiente = con promesa (fecha_programada) y sin entregar (fechaordencargue null).
  const pend = () => base().not("fecha_programada", "is", null).is("fechaordencargue", null)

  const [rTotal, rPend, rVenc, rHoy, rProx, rEntreg] = await Promise.all([
    base(),
    pend(),
    pend().lt("fecha_programada", hoyStr),
    pend().eq("fecha_programada", hoyStr),
    pend().gt("fecha_programada", hoyStr).lte("fecha_programada", en7Str),
    base().not("fechaordencargue", "is", null),
  ])

  // Valor de lo vencido: solo esas filas (pocas) para sumar total_pagar.
  let valorVencido = 0
  try {
    const { data } = await sb
      .from("pedidoscabecera")
      .select("total_pagar")
      .eq("id_empresa", empresaId)
      .or("estado.is.null,and(estado.not.ilike.%anulado%,estado.not.ilike.no entregado)")
      .not("fecha_programada", "is", null)
      .is("fechaordencargue", null)
      .lt("fecha_programada", hoyStr)
    for (const r of data ?? []) valorVencido += Number(r.total_pagar) || 0
  } catch {}

  return {
    total: rTotal.count || 0,
    pendientes: rPend.count || 0,
    vencidos: rVenc.count || 0,
    venceHoy: rHoy.count || 0,
    porVencer7: rProx.count || 0,
    entregados: rEntreg.count || 0,
    valorVencido: Math.round(valorVencido),
  }
}

// KPIs de DESPACHO (Gestión de Órdenes): operativo del día desde cabeceraoc + eficiencia
// desde la vista del dashboard de recepción. Optimizado con conteos en paralelo.
export interface DespachoKpis {
  ordenesHoy: number
  sinCerrar: number // iniciadas y aún sin fincargue (en proceso, requieren cierre)
  finalizadasHoy: number
  tiempoPromOperacion: number
  operacionesMedidas: number
}

export async function getDespachoKpis(selectedEmpresaId?: number | null): Promise<DespachoKpis> {
  const empty: DespachoKpis = { ordenesHoy: 0, sinCerrar: 0, finalizadasHoy: 0, tiempoPromOperacion: 0, operacionesMedidas: 0 }
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return empty
  const { hoyStr } = fechasBogota()

  const oc = () => sb.from("cabeceraoc").select("*", { count: "exact", head: true }).eq("idempresa", empresaId)
  const [rHoy, rSinCerrar, rFinHoy, vTiempo] = await Promise.all([
    oc().eq("fechacargue", hoyStr),
    oc().not("iniciocargue", "is", null).is("fincargue", null),
    oc().eq("fechacargue", hoyStr).not("fincargue", "is", null),
    sb.from("dashboardoperacionesgerencia").select("tiempo_total_operacion_min").eq("idempresa", empresaId).not("tiempo_total_operacion_min", "is", null).limit(5000),
  ])

  let tiempoPromOperacion = 0, operacionesMedidas = 0
  const vals = (vTiempo.data ?? []).map((r: any) => Number(r.tiempo_total_operacion_min)).filter((n: number) => !isNaN(n) && n > 0)
  operacionesMedidas = vals.length
  if (vals.length) tiempoPromOperacion = Math.round(vals.reduce((a: number, x: number) => a + x, 0) / vals.length)

  return {
    ordenesHoy: rHoy.count || 0,
    sinCerrar: rSinCerrar.count || 0,
    finalizadasHoy: rFinHoy.count || 0,
    tiempoPromOperacion,
    operacionesMedidas,
  }
}

// Vehículos NO PROCESADOS (sin cerrar): citasvehiculos con estatus IS NULL.
export interface VehiculoPendiente {
  id: number
  placa: string
  conductor: string | null
  transporte: string | null
  tipovehiculo: string | null
  fechallegada: string | null
}
export interface VehiculosKpis {
  noProcesados: number
  vehiculos: VehiculoPendiente[]
}

export async function getVehiculosNoProcesados(selectedEmpresaId?: number | null): Promise<VehiculosKpis> {
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return { noProcesados: 0, vehiculos: [] }
  const { data, count } = await sb
    .from("citasvehiculos")
    .select("id,placa,nombreconductor,transporte,tipovehiculo,fechallegada", { count: "exact" })
    .eq("idempresa", empresaId)
    .is("estatus", null)
    .order("fechallegada", { ascending: true })
    .limit(50)
  const vehiculos: VehiculoPendiente[] = (data ?? []).map((r: any) => ({
    id: r.id,
    placa: r.placa,
    conductor: r.nombreconductor || null,
    transporte: r.transporte || null,
    tipovehiculo: r.tipovehiculo || null,
    fechallegada: r.fechallegada || null,
  }))
  return { noProcesados: count || vehiculos.length, vehiculos }
}

// Órdenes de cargue RECIENTES para sugerir al cerrar un vehículo contra una orden.
// Solo lectura de cabeceraoc; el usuario puede además escribir la orden libremente.
export async function getOrdenesRecientes(selectedEmpresaId?: number | null): Promise<{ ordendecargue: string; fechaorden: string | null }[]> {
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return []
  const { data } = await sb
    .from("cabeceraoc")
    .select("ordendecargue,fechaorden")
    .eq("idempresa", empresaId)
    .not("ordendecargue", "is", null)
    .order("fechaorden", { ascending: false })
    .limit(150)
  return (data ?? [])
    .filter((r: any) => r.ordendecargue && String(r.ordendecargue).trim())
    .map((r: any) => ({ ordendecargue: r.ordendecargue, fechaorden: r.fechaorden || null }))
}

// Cerrar un vehículo asociándolo a una orden de cargue: marca estatus=Procesado y
// registra el ocargue en el propio vehículo (no toca cabeceraoc). Mantiene el
// indicador de "no procesados" al día.
export async function cerrarVehiculoConOrden(vehicleId: number, ordendecargue: string, selectedEmpresaId?: number | null) {
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!vehicleId || !empresaId) return { success: false, message: "Datos incompletos." }
  const { error } = await sb
    .from("citasvehiculos")
    .update({ estatus: "Procesado", ocargue: ordendecargue || null })
    .eq("id", vehicleId)
    .eq("idempresa", empresaId)
    .is("estatus", null)
  if (error) return { success: false, message: error.message }
  return { success: true }
}

// Eliminar un registro de vehículo NO procesado (por error / no se va a usar).
export async function eliminarVehiculoNoProcesado(vehicleId: number, selectedEmpresaId?: number | null) {
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!vehicleId || !empresaId) return { success: false, message: "Datos incompletos." }
  // Seguridad: solo borra si sigue sin procesar (estatus null).
  const { error } = await sb
    .from("citasvehiculos")
    .delete()
    .eq("id", vehicleId)
    .eq("idempresa", empresaId)
    .is("estatus", null)
  if (error) return { success: false, message: error.message }
  return { success: true }
}
