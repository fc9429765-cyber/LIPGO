import "server-only"

// NÚCLEO compartido de Pedidos (solo servidor): tipos de la cola, lectura de pedidos
// abiertos con sus líneas resumidas y el estado derivado. Lo usan
// lib/pedidos-cola-actions.ts (Gestionar) y lib/dashboard-pedidos-periodo-actions.ts
// (Dashboard), para que ambas pantallas hablen de los mismos números.

import { fetchAllRows } from "@/lib/fetch-all-rows"
import { limitarPorOwners, type AccesoPedidos } from "@/lib/acceso-empresa"
import { derivarEstado, FILTRO_ABIERTOS_POSTGREST, type EstadoDerivado } from "@/lib/pedidos-estado"

export const MSG_SIN_ACCESO = "Sin acceso a la empresa."
export const n0 = (v: unknown) => Number(v) || 0
export const txt = (v: unknown) => (v == null ? null : String(v))

export interface PedidoCola {
  idpedido: number
  id_empresa: number
  pedido: string | null
  orden_de_compra: string | null
  cliente: string
  vendedor: string | null
  destino: string | null
  medio: string | null
  direccion: string | null
  tipo_despacho: string | null
  condicion_pago: string | null
  fecha: string
  fecha_programada: string | null
  creado_en: string | null
  estado: string | null
  aprobado: string | null
  revisioncartera: string | null
  revisiongerencia: string | null
  ocargue: string | null
  fechaordencargue: string | null
  fechadeentrega: string | null
  vehiculo: string | null
  transporte: string | null
  factura: string | null
  total_pagar: number
  pdfpedido: string | null
  observaciones: string | null
  empresa: string | null
  empresafactura: string | null
  motivo_no_entrega: string | null
  depurado_por: string | null
  depurado_en: string | null
  /** Agregados de pedidosdetalle. */
  kg: number
  unidades: number
  lineas: number
  lineasConOcargue: number
  unidadesCargadas: number
  unidadesPendientes: number
  /** Estado derivado (lib/pedidos-estado.ts). */
  calc: EstadoDerivado
}

export interface ResumenCola {
  abiertos: number
  atrasados: number
  /** Atrasados de 1 a 15 días. */
  atrasadosRecientes: number
  /** Atrasados de más de 15 días (sin rastro logístico). */
  atrasadosViejos: number
  hoy: number
  kgHoy: number
  manana: number
  kgManana: number
  /** Programados para después de mañana. */
  futuros: number
  sinFecha: number
  enCargue: number
  parciales: number
  porAprobar: number
  porAprobarConCartera: number
  candidatosSinRastro: number
  candidatosParciales: number
}

export interface ColaPedidos {
  hoy: string
  manana: string
  pedidos: PedidoCola[]
  resumen: ResumenCola
}

export interface LineaPedido {
  transid: number
  producto: string
  categoria: string | null
  unidades: number
  peso: number
  precio_und: number
  total_linea: number
  ocargue: string | null
  unidadescargadas: number
  unidadespendientes: number
  estado: string | null
}

export type ResLineas = { kg: number; und: number; lineas: number; oc: number; cargadas: number; pend: number }

/** Línea mínima para cálculos (dashboard): producto, unidades, kg, OC y cargadas. */
export interface LineaMinima {
  idpedido: number
  producto: string
  unidades: number
  peso: number
  ocargue: string | null
  cargadas: number
  pendientes: number
}

/** Trae las líneas mínimas de un conjunto de pedidos (chunks de 150 ids, paginado por transid). */
export async function lineasMinimas(sb: any, empresaId: number, ids: number[]): Promise<LineaMinima[]> {
  const out: LineaMinima[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const rows = await fetchAllRows((from, to) =>
      sb
        .from("pedidosdetalle")
        .select("idpedido, transid, producto, peso, unidades, ocargue, unidadescargadas, unidades_cargadas, unidadespendientes")
        .eq("id_empresa", empresaId)
        .in("idpedido", chunk)
        .order("transid", { ascending: true })
        .range(from, to),
    )
    for (const d of rows) {
      out.push({
        idpedido: Number(d.idpedido),
        producto: String(d.producto ?? ""),
        unidades: n0(d.unidades),
        peso: n0(d.peso),
        ocargue: txt(d.ocargue),
        cargadas: n0(d.unidadescargadas ?? d.unidades_cargadas),
        pendientes: n0(d.unidadespendientes),
      })
    }
  }
  return out
}

export function resumirLineas(lineas: LineaMinima[]): Map<number, ResLineas> {
  const m = new Map<number, ResLineas>()
  for (const d of lineas) {
    const r = m.get(d.idpedido) ?? { kg: 0, und: 0, lineas: 0, oc: 0, cargadas: 0, pend: 0 }
    r.kg += d.peso
    r.und += d.unidades
    r.lineas += 1
    if (d.ocargue) r.oc += 1
    r.cargadas += d.cargadas
    r.pend += d.pendientes
    m.set(d.idpedido, r)
  }
  return m
}

export async function resumenLineas(sb: any, empresaId: number, ids: number[]): Promise<Map<number, ResLineas>> {
  return resumirLineas(await lineasMinimas(sb, empresaId, ids))
}

export function aPedidoCola(p: any, r: ResLineas | undefined, hoy: string): PedidoCola {
  const res = r ?? { kg: 0, und: 0, lineas: 0, oc: 0, cargadas: 0, pend: 0 }
  const calc = derivarEstado(p, hoy, { lineasConOcargue: res.oc, unidadesPedidas: res.und, unidadesCargadas: res.cargadas })
  return {
    idpedido: Number(p.idpedido),
    id_empresa: Number(p.id_empresa),
    pedido: txt(p.pedido),
    orden_de_compra: txt(p.orden_de_compra),
    cliente: String(p.cliente ?? ""),
    vendedor: txt(p.vendedor),
    destino: txt(p.destino),
    medio: txt(p.medio),
    direccion: txt(p.direccion),
    tipo_despacho: txt(p.tipo_despacho),
    condicion_pago: txt(p.condicion_pago),
    fecha: String(p.fecha ?? "").slice(0, 10),
    fecha_programada: p.fecha_programada ? String(p.fecha_programada).slice(0, 10) : null,
    creado_en: txt(p.creado_en),
    estado: txt(p.estado),
    aprobado: txt(p.aprobado),
    revisioncartera: txt(p.revisioncartera),
    revisiongerencia: txt(p.revisiongerencia),
    ocargue: txt(p.ocargue),
    fechaordencargue: p.fechaordencargue ? String(p.fechaordencargue).slice(0, 10) : null,
    fechadeentrega: p.fechadeentrega ? String(p.fechadeentrega).slice(0, 10) : null,
    vehiculo: txt(p.vehiculo),
    transporte: txt(p.transporte),
    factura: txt(p.factura),
    total_pagar: n0(p.total_pagar),
    pdfpedido: txt(p.pdfpedido),
    observaciones: txt(p.observaciones),
    empresa: txt(p.empresa),
    empresafactura: txt(p.empresafactura),
    motivo_no_entrega: txt(p.motivo_no_entrega),
    depurado_por: txt(p.depurado_por),
    depurado_en: txt(p.depurado_en),
    kg: Math.round(res.kg),
    unidades: res.und,
    lineas: res.lineas,
    lineasConOcargue: res.oc,
    unidadesCargadas: res.cargadas,
    unidadesPendientes: res.pend,
    calc,
  }
}

/** Pedidos ABIERTOS de la empresa (sin límite de fecha), con sus líneas resumidas y el estado derivado. */
export async function cargarCola(sb: any, acceso: AccesoPedidos, empresaId: number, hoy: string): Promise<PedidoCola[]> {
  const cab = await fetchAllRows((from, to) =>
    limitarPorOwners(sb.from("pedidoscabecera").select("*").eq("id_empresa", empresaId).or(FILTRO_ABIERTOS_POSTGREST), acceso)
      .order("idpedido", { ascending: true })
      .range(from, to),
  )
  const lineas = await resumenLineas(sb, empresaId, cab.map((c: any) => Number(c.idpedido)))
  return cab.map((p: any) => aPedidoCola(p, lineas.get(Number(p.idpedido)), hoy))
}

export function resumir(pedidos: PedidoCola[]): ResumenCola {
  const r: ResumenCola = {
    abiertos: pedidos.length,
    atrasados: 0,
    atrasadosRecientes: 0,
    atrasadosViejos: 0,
    hoy: 0,
    kgHoy: 0,
    manana: 0,
    kgManana: 0,
    futuros: 0,
    sinFecha: 0,
    enCargue: 0,
    parciales: 0,
    porAprobar: 0,
    porAprobarConCartera: 0,
    candidatosSinRastro: 0,
    candidatosParciales: 0,
  }
  for (const p of pedidos) {
    const c = p.calc
    if (c.candidatoDepuracion === "sin_rastro") r.candidatosSinRastro++
    if (c.candidatoDepuracion === "parcial") r.candidatosParciales++
    switch (c.estado) {
      case "programado":
        if (c.atrasoDias > 0) {
          r.atrasados++
          if (c.atrasoDias <= 15) r.atrasadosRecientes++
          else r.atrasadosViejos++
        } else if (c.esHoy) {
          r.hoy++
          r.kgHoy += p.kg
        } else if (c.esManana) {
          r.manana++
          r.kgManana += p.kg
        } else r.futuros++
        break
      case "aprobado_sin_programar":
        r.sinFecha++
        break
      case "en_cargue":
        r.enCargue++
        break
      case "parcial":
        r.parciales++
        break
      case "nuevo":
        r.porAprobar++
        if (c.conCartera) r.porAprobarConCartera++
        break
    }
  }
  return r
}
