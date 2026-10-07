// NÚCLEO PURO de "PEDIDOS DEL DÍA": la demanda real a cargar hoy, por fecha de entrega
// prometida. Sin "use server" y sin base de datos: aquí viven los tipos y las reglas de
// presentación, y se prueban solas (tests/pedidos-del-dia.test.ts).
//
// Gerencia (2026-10-05): "una cosa es la proyección de vehículos y otra más acertada es la de
// pedidos a cargar"; "debería mostrarle al que tenga el permiso de órdenes de cargue los
// pedidos que están proyectados para ese día, [...] la IA indicando qué pedidos se vencen ese
// día"; y "de manera llamativa, y si quieren ver lo que preparó la IA ingresan, para no saturar
// los módulos". De ahí el contrato: UNA línea llamativa arriba del módulo y un panel lateral con
// el detalle. Lo ve quien tiene el permiso de "Generar Órdenes de Cargue" (la compuerta la pone
// la acción de servidor), sin precios ni condiciones comerciales.

export interface PedidoDelDia {
  idpedido: number
  pedido: string | null
  cliente: string
  destino: string | null
  tipoDespacho: string | null
  kg: number
  unidades: number
  lineas: number
  aprobado: boolean
  carteraLista: boolean
  fechaProgramada: string | null
  /** Fecha de registro del pedido (ISO). */
  registrado: string
  /** Días de atraso frente a la promesa (0 si vence hoy o después). */
  atrasoDias: number
}

export interface PedidosDelDia {
  empresaId: number
  hoy: string
  /** Siguiente día operativo (los proyectos no operan los domingos). */
  manana: string
  /** Meta del acuerdo en t/día (piso de referencia). */
  metaAcuerdoT: number
  /** Todo lo prometido para hoy: lo que ya salió + lo que falta. */
  demandaHoy: { pedidos: number; kg: number; registradosHoy: number }
  /** Pedidos de hoy que ya tienen orden de cargue o quedaron entregados. */
  salieronHoy: { pedidos: number; kg: number }
  /** Pedidos de hoy sin orden de cargue: lo que falta por cargar. */
  vencenHoy: { pedidos: number; kg: number; porAprobar: number; lista: PedidoDelDia[] }
  /** Promesa vencida y sin orden. `recientes` = hasta 3 días de atraso. */
  atrasados: { pedidos: number; kg: number; recientes: PedidoDelDia[] }
  paraManana: { pedidos: number; kg: number; porAprobar: number; lista: PedidoDelDia[]; salieron: { pedidos: number; kg: number } }
}

export type TonoVencen = "ok" | "atencion" | "critico"

export interface ResumenVencen {
  pendientes: number
  kg: number
  porAprobar: number
  atrasadosRecientes: number
  atrasadosTotal: number
  atrasadosKg: number
}

export function resumenVencen(d: PedidosDelDia): ResumenVencen {
  return {
    pendientes: d.vencenHoy.pedidos,
    kg: d.vencenHoy.kg,
    porAprobar: d.vencenHoy.porAprobar,
    atrasadosRecientes: d.atrasados.recientes.length,
    atrasadosTotal: d.atrasados.pedidos,
    atrasadosKg: d.atrasados.kg,
  }
}

/** Crítico si hay atrasados recientes o pedidos de hoy sin aprobar; atención si solo falta cargar; ok si no hay nada pendiente. */
export function tonoVencen(r: ResumenVencen): TonoVencen {
  if (r.atrasadosRecientes > 0 || r.porAprobar > 0) return "critico"
  if (r.pendientes > 0) return "atencion"
  return "ok"
}

/** La línea solo aparece cuando hay algo que hacer: sin pendientes ni atrasados no ocupa espacio. */
export function hayQueMostrar(r: ResumenVencen): boolean {
  return r.pendientes > 0 || r.atrasadosTotal > 0
}

const T1 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 })
const N0 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 })

/** 70.400 → "70,4 t"; 850 → "850 kg". */
export function formatoPeso(kg: number): string {
  const v = Number(kg) || 0
  return v >= 1000 ? `${T1.format(Math.round(v / 100) / 10)} t` : `${N0.format(Math.round(v))} kg`
}

export function plural(n: number, uno: string, varios: string): string {
  return `${N0.format(n)} ${n === 1 ? uno : varios}`
}

/** El texto de la línea llamativa. */
export function textoVencen(r: ResumenVencen): string {
  if (r.pendientes === 0) {
    return r.atrasadosTotal > 0
      ? `Nada vence hoy · ${plural(r.atrasadosTotal, "pedido atrasado sin orden", "pedidos atrasados sin orden")} (${formatoPeso(r.atrasadosKg)})`
      : "Nada vence hoy"
  }
  const partes = [`Vencen hoy: ${plural(r.pendientes, "pedido", "pedidos")} · ${formatoPeso(r.kg)}`]
  if (r.porAprobar > 0) partes.push(plural(r.porAprobar, "por aprobar", "por aprobar"))
  if (r.atrasadosRecientes > 0) partes.push(plural(r.atrasadosRecientes, "atrasado reciente", "atrasados recientes"))
  else if (r.atrasadosTotal > 0) partes.push(plural(r.atrasadosTotal, "atrasado sin orden", "atrasados sin orden"))
  return partes.join(" · ")
}

/** Avance del día: lo que ya salió sobre la demanda total. null si no hay demanda. */
export function pctAvance(d: Pick<PedidosDelDia, "demandaHoy" | "salieronHoy">): number | null {
  if (d.demandaHoy.kg <= 0) return null
  return Math.max(0, Math.min(100, Math.round((d.salieronHoy.kg / d.demandaHoy.kg) * 100)))
}

/** Días enteros entre dos fechas ISO (b − a); negativo si b es antes. */
export function diasEntreISO(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}
