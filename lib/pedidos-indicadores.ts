// INDICADORES DE PEDIDOS — cálculo PURO (sin Supabase, sin "use server").
//
// Una sola definición para el BSC (sig-actions → sig_indicadores), el Dashboard de
// pedidos, la franja del portal y las alertas. Gerencia 2026-10-03: "todo orientado al
// resultado; el BSC es la matriz integradora". Si una pantalla necesita otro número,
// se agrega aquí, no en la pantalla.
//
// Definiciones:
//   · Período = pedidos cuya PROMESA (fecha_programada) cae en el rango.
//   · A tiempo = la orden de cargue (o la entrega, si no hubo OC) se dio el día de la
//     promesa o antes; tarde = después. El % es sobre los pedidos con fecha de cargue.
//   · Pendiente = abierto sin orden de cargue. Anulados y no entregados aparte.
//   · Completo = estado "entregado"; parcial = "parcial" o "entrega parcial".
//   · Mismo día = fecha de registro igual a la promesa.

import { esEstadoFinal, normalizarEstado } from "@/lib/pedidos-estado"

export type ClasePedido = "a_tiempo" | "tarde" | "pendiente" | "no_entregado" | "anulado" | "cerrado_sin_fecha"

export interface PedidoParaIndicador {
  estado?: string | null
  fecha?: string | null
  fecha_programada?: string | null
  fechaordencargue?: string | null
  fechadeentrega?: string | null
  ocargue?: string | null
}

const dia = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null)

/** Clasifica un pedido del período según su cumplimiento de la promesa. */
export function clasificarPedido(p: PedidoParaIndicador): { clase: ClasePedido; fechaRef: string | null } {
  const est = normalizarEstado(p.estado)
  const promesa = dia(p.fecha_programada)
  const fechaRef = dia(p.fechaordencargue) ?? dia(p.fechadeentrega)
  if (est === "anulado") return { clase: "anulado", fechaRef }
  if (est === "no entregado") return { clase: "no_entregado", fechaRef }
  if (fechaRef && promesa) return { clase: fechaRef <= promesa ? "a_tiempo" : "tarde", fechaRef }
  if (fechaRef) return { clase: "a_tiempo", fechaRef }
  if (esEstadoFinal(est) || String(p.ocargue ?? "").trim()) return { clase: "cerrado_sin_fecha", fechaRef }
  return { clase: "pendiente", fechaRef }
}

export interface ResumenIndicadoresPedidos {
  pedidos: number
  /** Con fecha de cargue o entrega: denominador del % a tiempo. */
  conFecha: number
  aTiempo: number
  tarde: number
  pendientes: number
  anulados: number
  noEntregados: number
  cerradosSinFecha: number
  completos: number
  parciales: number
  conPromesa: number
  mismoDia: number
}

export function resumirIndicadoresPedidos(pedidos: PedidoParaIndicador[]): ResumenIndicadoresPedidos {
  const r: ResumenIndicadoresPedidos = { pedidos: 0, conFecha: 0, aTiempo: 0, tarde: 0, pendientes: 0, anulados: 0, noEntregados: 0, cerradosSinFecha: 0, completos: 0, parciales: 0, conPromesa: 0, mismoDia: 0 }
  for (const p of pedidos) {
    r.pedidos++
    const { clase } = clasificarPedido(p)
    if (clase === "a_tiempo" || clase === "tarde") r.conFecha++
    if (clase === "a_tiempo") r.aTiempo++
    else if (clase === "tarde") r.tarde++
    else if (clase === "pendiente") r.pendientes++
    else if (clase === "anulado") r.anulados++
    else if (clase === "no_entregado") r.noEntregados++
    else r.cerradosSinFecha++
    const est = normalizarEstado(p.estado)
    if (est === "entregado") r.completos++
    else if (est === "parcial" || est === "entrega parcial") r.parciales++
    const reg = dia(p.fecha)
    const prom = dia(p.fecha_programada)
    if (reg && prom) {
      r.conPromesa++
      if (reg === prom) r.mismoDia++
    }
  }
  return r
}

const pct1 = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)

/** Valores listos para el BSC (clave calculo_auto → valor + base). null = sin datos. */
export function valoresBscPedidos(r: ResumenIndicadoresPedidos, atrasadosHoy: number | null): Record<string, { valor: number | null; base: string }> {
  return {
    ped_a_tiempo: { valor: pct1(r.aTiempo, r.conFecha), base: r.conFecha > 0 ? `${r.aTiempo}/${r.conFecha} con fecha de cargue` : "sin cargues en el período" },
    ped_completos: { valor: pct1(r.completos, r.completos + r.parciales), base: r.completos + r.parciales > 0 ? `${r.completos} completos · ${r.parciales} parciales` : "sin entregas en el período" },
    ped_mismo_dia: { valor: pct1(r.mismoDia, r.conPromesa), base: r.conPromesa > 0 ? `${r.mismoDia}/${r.conPromesa} registrados el día de la entrega` : "sin pedidos" },
    ped_pendientes: { valor: r.pendientes, base: `${r.pendientes} del período sin orden de cargue` },
    ped_atrasados: { valor: atrasadosHoy, base: atrasadosHoy == null ? "sin lectura" : `${atrasadosHoy} aprobados con promesa vencida y sin orden de cargue (hoy)` },
  }
}

/** Claves del BSC que produce este módulo (para KPI_DEFS, AREA_KPIS y sig_indicadores). */
export const CLAVES_BSC_PEDIDOS = ["ped_a_tiempo", "ped_atrasados", "ped_completos", "ped_pendientes", "ped_mismo_dia"] as const
