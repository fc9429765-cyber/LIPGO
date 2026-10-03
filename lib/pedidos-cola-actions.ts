"use server"

// GESTIONAR PEDIDOS — cola logística del cliente, depuración de pendientes,
// detalle de un pedido y demanda de un día. Server actions NUEVAS; las acciones
// existentes (aprobar, anular, cerrar pendiente, cierre con factura, eliminar)
// siguen en lib/orders-actions.tsx sin cambios de lógica.
//
// Reglas (gerencia 2026-10-03):
//   · Pedidos es un proceso del CLIENTE (el ID). El acceso es el mismo de siempre:
//     empresas accesibles del perfil y límite por owners (lib/acceso-empresa.ts).
//   · Depurar NUNCA borra: deja el pedido como "no entregado" (o "entrega parcial"
//     si era parcial) con motivo, quién y cuándo. Requiere clave personal con el
//     proceso `ped_depurar` (SQL 215). Solo toca pedidos sin rastro logístico.
//   · En previsualización (NEXT_PUBLIC_VERCEL_ENV = preview) la depuración SIMULA
//     por defecto: no escribe, solo informa qué haría.
//
// Lecturas: cliente admin "sistema" (auditoría neutra). Escrituras: cliente admin
// del actor (queda en la auditoría quién depuró).

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { autorizar } from "@/lib/autorizaciones-core"
import { desdeDePeriodo, hoyBogotaISO, type PeriodoListado } from "@/lib/periodo-listados"
import { accesoPedidos, limitarPorOwners, type AccesoPedidos } from "@/lib/acceso-empresa"
import {
  derivarEstado,
  diasEntre,
  sumarDiasISO,
  normalizarEstado,
  textoMotivo,
  ESTADO_ENTREGA_PARCIAL,
  ESTADO_NO_ENTREGADO,
  FILTRO_ABIERTOS_POSTGREST,
  MOTIVOS_DEPURACION,
  type EstadoDerivado,
  type MotivoDepuracion,
} from "@/lib/pedidos-estado"

type Resp<T> = { success: true; data: T } | { success: false; message: string }

const MSG_SIN_ACCESO = "Sin acceso a la empresa."
const n0 = (v: unknown) => Number(v) || 0
const txt = (v: unknown) => (v == null ? null : String(v))

// ─────────────────────────────── Tipos ───────────────────────────────

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

export interface CandidatoDepuracion extends PedidoCola {
  tipo: "sin_rastro" | "parcial"
  /** Pistas legibles: "Reemplazado por #238 · mismo N°", "Promesa anterior al registro", "Nunca aprobado". */
  pistas: string[]
  /** idpedido del pedido posterior del mismo cliente con el mismo N° u OC, si existe. */
  reemplazadoPor: number | null
  /** Motivo sugerido a partir de las pistas. */
  motivoSugerido: MotivoDepuracion["clave"] | null
}

/** Lo ya depurado, para dejarlo consignado en la tarjeta. */
export interface Consignado {
  total: number
  hoy: number
  ultimoPor: string | null
  ultimoEn: string | null
  /** false cuando faltan las columnas del SQL 215. */
  disponible: boolean
}

export interface CandidatosDepuracion {
  hoy: string
  sinRastro: CandidatoDepuracion[]
  parciales: CandidatoDepuracion[]
  consignado: { sinRastro: Consignado; parciales: Consignado }
  /** Si la app corre en previsualización: la depuración solo simula. */
  simulaEnEsteEntorno: boolean
}

export interface ItemDepuracion {
  idpedido: number
  motivo: MotivoDepuracion["clave"]
  detalle?: string | null
}

export interface ResultadoDepuracion {
  simulado: boolean
  depurados: number
  omitidos: { idpedido: number; razon: string }[]
  autorizadoPor: string | null
  /** Pedidos que quedaron (o quedarían) como "no entregado" / "entrega parcial". */
  comoNoEntregado: number
  comoEntregaParcial: number
}

export interface DemandaCliente {
  cliente: string
  pedidos: number
  kg: number
  unidades: number
  tiposDespacho: string[]
  aprobados: number
  porAprobar: number
  idpedidos: number[]
}

export interface DemandaFecha {
  hoy: string
  fecha: string
  pedidos: number
  kg: number
  unidades: number
  aprobados: number
  porAprobar: number
  porCliente: DemandaCliente[]
  porDespacho: { tipo: string; pedidos: number; kg: number }[]
  /** Atrasados de 1 a 15 días que podrían salir el mismo día. */
  atrasadosRecientes: { total: number; kg: number; porCliente: { cliente: string; pedidos: number; kg: number; promesas: string[] }[] }
  /** Próximos 8 días (desde mañana) con su demanda, para el selector de fecha. */
  proximosDias: { fecha: string; pedidos: number; kg: number }[]
  programacion: {
    usa: boolean
    tiene: boolean
    vehiculos: number
    capacidadT: number | null
    porTipo: { tipo: string; cantidad: number; capacidadT: number | null }[]
    aTiempo: boolean | null
    enviadaEn: string | null
  }
  /** Catálogo de tipos de vehículo con capacidad (t), para la referencia. */
  tiposVehiculo: { nombre: string; capacidad: number | null }[]
}

// ─────────────────────────────── Internos ───────────────────────────────

type ResLineas = { kg: number; und: number; lineas: number; oc: number; cargadas: number; pend: number }

async function resumenLineas(sb: any, empresaId: number, ids: number[]): Promise<Map<number, ResLineas>> {
  const m = new Map<number, ResLineas>()
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const rows = await fetchAllRows((from, to) =>
      sb
        .from("pedidosdetalle")
        .select("idpedido, transid, peso, unidades, ocargue, unidadescargadas, unidades_cargadas, unidadespendientes")
        .eq("id_empresa", empresaId)
        .in("idpedido", chunk)
        .order("transid", { ascending: true })
        .range(from, to),
    )
    for (const d of rows) {
      const r = m.get(d.idpedido) ?? { kg: 0, und: 0, lineas: 0, oc: 0, cargadas: 0, pend: 0 }
      r.kg += n0(d.peso)
      r.und += n0(d.unidades)
      r.lineas += 1
      if (d.ocargue) r.oc += 1
      r.cargadas += n0(d.unidadescargadas ?? d.unidades_cargadas)
      r.pend += n0(d.unidadespendientes)
      m.set(d.idpedido, r)
    }
  }
  return m
}

function aPedidoCola(p: any, r: ResLineas | undefined, hoy: string): PedidoCola {
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
async function cargarCola(sb: any, acceso: AccesoPedidos, empresaId: number, hoy: string): Promise<PedidoCola[]> {
  const cab = await fetchAllRows((from, to) =>
    limitarPorOwners(sb.from("pedidoscabecera").select("*").eq("id_empresa", empresaId).or(FILTRO_ABIERTOS_POSTGREST), acceso)
      .order("idpedido", { ascending: true })
      .range(from, to),
  )
  const lineas = await resumenLineas(sb, empresaId, cab.map((c: any) => Number(c.idpedido)))
  return cab.map((p: any) => aPedidoCola(p, lineas.get(Number(p.idpedido)), hoy))
}

function resumir(pedidos: PedidoCola[]): ResumenCola {
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

// ─────────────────────────────── Cola ───────────────────────────────

export async function getColaPedidos(empresaId: number | null | undefined): Promise<Resp<ColaPedidos>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  try {
    const sb: any = await getSupabaseAdminAsSystem()
    const acceso = await accesoPedidos(sb, empresaId)
    if (!acceso) return { success: false, message: MSG_SIN_ACCESO }
    const hoy = hoyBogotaISO()
    const pedidos = await cargarCola(sb, acceso, empresaId, hoy)
    return { success: true, data: { hoy, manana: sumarDiasISO(hoy, 1), pedidos, resumen: resumir(pedidos) } }
  } catch (e: any) {
    console.error("[pedidos-cola] getColaPedidos:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo cargar la cola de pedidos." }
  }
}

// ─────────────────────────────── Historial ───────────────────────────────

export interface HistorialPedidos {
  hoy: string
  desde: string | null
  pedidos: PedidoCola[]
  /** true cuando el período trae demasiados pedidos y no se sumaron kilos por pedido. */
  kgOmitidos: boolean
  totales: { entregados: number; entregaParcial: number; anulados: number; noEntregados: number }
}

const FILTRO_FINALES_POSTGREST = "estado.ilike.entregado,estado.ilike.entrega parcial,estado.ilike.anulado,estado.ilike.no entregado"

export async function getHistorialPedidos(empresaId: number | null | undefined, periodo: PeriodoListado): Promise<Resp<HistorialPedidos>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  try {
    const sb: any = await getSupabaseAdminAsSystem()
    const acceso = await accesoPedidos(sb, empresaId)
    if (!acceso) return { success: false, message: MSG_SIN_ACCESO }
    const hoy = hoyBogotaISO()
    const desde = desdeDePeriodo(periodo, hoy)
    const cab = await fetchAllRows((from, to) => {
      let q = limitarPorOwners(sb.from("pedidoscabecera").select("*").eq("id_empresa", empresaId).or(FILTRO_FINALES_POSTGREST), acceso)
      if (desde) q = q.gte("fecha", desde)
      return q.order("idpedido", { ascending: false }).range(from, to)
    })
    const kgOmitidos = cab.length > 4000
    const lineas = kgOmitidos ? new Map<number, ResLineas>() : await resumenLineas(sb, empresaId, cab.map((c: any) => Number(c.idpedido)))
    const pedidos = cab.map((p: any) => aPedidoCola(p, lineas.get(Number(p.idpedido)), hoy))
    const totales = { entregados: 0, entregaParcial: 0, anulados: 0, noEntregados: 0 }
    for (const p of pedidos) {
      const e = normalizarEstado(p.estado)
      if (e === "entregado") totales.entregados++
      else if (e === ESTADO_ENTREGA_PARCIAL) totales.entregaParcial++
      else if (e === "anulado") totales.anulados++
      else if (e === ESTADO_NO_ENTREGADO) totales.noEntregados++
    }
    return { success: true, data: { hoy, desde, pedidos, kgOmitidos, totales } }
  } catch (e: any) {
    console.error("[pedidos-cola] getHistorialPedidos:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo cargar el historial." }
  }
}

// ─────────────────────────────── Detalle ───────────────────────────────

export async function getLineasPedido(empresaId: number | null | undefined, idpedido: number): Promise<Resp<{ cabecera: PedidoCola; lineas: LineaPedido[] }>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  if (!Number.isFinite(idpedido)) return { success: false, message: "Pedido inválido." }
  try {
    const sb: any = await getSupabaseAdminAsSystem()
    const acceso = await accesoPedidos(sb, empresaId)
    if (!acceso) return { success: false, message: MSG_SIN_ACCESO }
    const { data: cab, error } = await limitarPorOwners(sb.from("pedidoscabecera").select("*").eq("id_empresa", empresaId).eq("idpedido", idpedido), acceso).maybeSingle()
    if (error) throw error
    if (!cab) return { success: false, message: "El pedido no existe en este proyecto." }
    const { data: det, error: e2 } = await sb.from("pedidosdetalle").select("*").eq("id_empresa", empresaId).eq("idpedido", idpedido).order("transid", { ascending: true }).limit(500)
    if (e2) throw e2
    const lineas: LineaPedido[] = (det ?? []).map((d: any) => ({
      transid: Number(d.transid),
      producto: String(d.producto ?? ""),
      categoria: txt(d.categoria),
      unidades: n0(d.unidades),
      peso: n0(d.peso),
      precio_und: n0(d.precio_und),
      total_linea: n0(d.total_linea),
      ocargue: txt(d.ocargue),
      unidadescargadas: n0(d.unidadescargadas ?? d.unidades_cargadas),
      unidadespendientes: n0(d.unidadespendientes),
      estado: txt(d.estado),
    }))
    const res: ResLineas = { kg: 0, und: 0, lineas: lineas.length, oc: 0, cargadas: 0, pend: 0 }
    for (const l of lineas) {
      res.kg += l.peso
      res.und += l.unidades
      if (l.ocargue) res.oc++
      res.cargadas += l.unidadescargadas
      res.pend += l.unidadespendientes
    }
    return { success: true, data: { cabecera: aPedidoCola(cab, res, hoyBogotaISO()), lineas } }
  } catch (e: any) {
    console.error("[pedidos-cola] getLineasPedido:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo cargar el pedido." }
  }
}

// ─────────────────────────────── Depuración ───────────────────────────────

const EN_PREVIEW = process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"
// Proyecto de PRUEBAS (gerencia 2026-10-03): ID4 Cedi Medellín ya no va a operar, así
// que en la previsualización la depuración escribe de verdad solo ahí; en los demás
// proyectos sigue simulando hasta publicar.
const EMPRESAS_PRUEBA_EN_PREVIEW = new Set<number>([4])
const simulaEn = (empresaId: number) => EN_PREVIEW && !EMPRESAS_PRUEBA_EN_PREVIEW.has(Number(empresaId))

function pistasDe(p: PedidoCola, posteriores: any[] | undefined): { pistas: string[]; reemplazadoPor: number | null; motivoSugerido: MotivoDepuracion["clave"] | null } {
  const pistas: string[] = []
  let reemplazadoPor: number | null = null
  const num = (p.pedido ?? "").trim()
  const oc = (p.orden_de_compra ?? "").trim()
  if (posteriores && (num || oc)) {
    const q = posteriores.find((x) => Number(x.idpedido) > p.idpedido && ((num && String(x.pedido ?? "").trim() === num) || (oc && String(x.orden_de_compra ?? "").trim() === oc)))
    if (q) {
      reemplazadoPor = Number(q.idpedido)
      const por = num && String(q.pedido ?? "").trim() === num ? "mismo N°" : "misma OC"
      const est = q.ocargue ? `OC ${q.ocargue}` : normalizarEstado(q.estado) || "nuevo"
      pistas.push(`Reemplazado por #${q.idpedido} · ${por} · ${est}`)
    }
  }
  if (p.fecha_programada && p.fecha && p.fecha_programada < p.fecha) pistas.push("Promesa anterior al registro")
  if (normalizarEstado(p.aprobado) !== "si") pistas.push("Nunca aprobado")
  return { pistas, reemplazadoPor, motivoSugerido: reemplazadoPor ? "reemplazado" : null }
}

async function consignadoDe(sb: any, acceso: AccesoPedidos, empresaId: number, hoy: string, estado: string): Promise<Consignado> {
  try {
    const base = () => limitarPorOwners(sb.from("pedidoscabecera").select("idpedido", { count: "exact", head: true }).eq("id_empresa", empresaId).ilike("estado", estado).not("depurado_en", "is", null), acceso)
    const [t, h] = await Promise.all([base(), base().gte("depurado_en", `${hoy}T00:00:00-05:00`)])
    if (t.error) throw t.error
    const { data: ult, error } = await limitarPorOwners(sb.from("pedidoscabecera").select("depurado_por, depurado_en").eq("id_empresa", empresaId).ilike("estado", estado).not("depurado_en", "is", null), acceso)
      .order("depurado_en", { ascending: false })
      .limit(1)
    if (error) throw error
    return { total: t.count ?? 0, hoy: h.count ?? 0, ultimoPor: ult?.[0]?.depurado_por ?? null, ultimoEn: ult?.[0]?.depurado_en ?? null, disponible: true }
  } catch {
    return { total: 0, hoy: 0, ultimoPor: null, ultimoEn: null, disponible: false }
  }
}

/** Solo el resumen de la cola (franja del portal del área): mismo cálculo que getColaPedidos, sin las filas. */
export async function getResumenCola(empresaId: number | null | undefined): Promise<Resp<{ hoy: string; manana: string; resumen: ResumenCola }>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  try {
    const sb: any = await getSupabaseAdminAsSystem()
    const acceso = await accesoPedidos(sb, empresaId)
    if (!acceso) return { success: false, message: MSG_SIN_ACCESO }
    const hoy = hoyBogotaISO()
    const pedidos = await cargarCola(sb, acceso, empresaId, hoy)
    return { success: true, data: { hoy, manana: sumarDiasISO(hoy, 1), resumen: resumir(pedidos) } }
  } catch (e: any) {
    console.error("[pedidos-cola] getResumenCola:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo leer la cola de pedidos." }
  }
}

export async function getCandidatosDepuracion(empresaId: number | null | undefined): Promise<Resp<CandidatosDepuracion>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  try {
    const sb: any = await getSupabaseAdminAsSystem()
    const acceso = await accesoPedidos(sb, empresaId)
    if (!acceso) return { success: false, message: MSG_SIN_ACCESO }
    const hoy = hoyBogotaISO()
    const cola = await cargarCola(sb, acceso, empresaId, hoy)
    const candidatos = cola.filter((p) => p.calc.candidatoDepuracion)
    // Pista "reemplazado por": pedidos posteriores del mismo cliente con el mismo N° u OC.
    const cabs = await fetchAllRows((from, to) =>
      sb
        .from("pedidoscabecera")
        .select("idpedido, cliente, pedido, orden_de_compra, estado, ocargue")
        .eq("id_empresa", empresaId)
        .gte("fecha", sumarDiasISO(hoy, -400))
        .order("idpedido", { ascending: true })
        .range(from, to),
    )
    const porCliente = new Map<string, any[]>()
    for (const c of cabs) {
      const k = String(c.cliente ?? "")
      const arr = porCliente.get(k) ?? []
      arr.push(c)
      porCliente.set(k, arr)
    }
    const enriquecer = (p: PedidoCola): CandidatoDepuracion => ({ ...p, tipo: p.calc.candidatoDepuracion as "sin_rastro" | "parcial", ...pistasDe(p, porCliente.get(p.cliente)) })
    const orden = (a: CandidatoDepuracion, b: CandidatoDepuracion) => b.calc.antiguedadDias - a.calc.antiguedadDias || a.idpedido - b.idpedido
    const [cSin, cPar] = await Promise.all([consignadoDe(sb, acceso, empresaId, hoy, ESTADO_NO_ENTREGADO), consignadoDe(sb, acceso, empresaId, hoy, ESTADO_ENTREGA_PARCIAL)])
    return {
      success: true,
      data: {
        hoy,
        sinRastro: candidatos.filter((p) => p.calc.candidatoDepuracion === "sin_rastro").map(enriquecer).sort(orden),
        parciales: candidatos.filter((p) => p.calc.candidatoDepuracion === "parcial").map(enriquecer).sort(orden),
        consignado: { sinRastro: cSin, parciales: cPar },
        simulaEnEsteEntorno: simulaEn(empresaId),
      },
    }
  } catch (e: any) {
    console.error("[pedidos-cola] getCandidatosDepuracion:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron cargar los candidatos." }
  }
}

export async function depurarPedidos(input: { empresaId: number | null | undefined; clave: string; items: ItemDepuracion[]; simular?: boolean }): Promise<Resp<ResultadoDepuracion>> {
  const empresaId = Number(input?.empresaId)
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  const items = Array.isArray(input.items) ? input.items : []
  if (items.length === 0) return { success: false, message: "No hay pedidos seleccionados." }
  if (items.length > 2000) return { success: false, message: "Máximo 2.000 pedidos por tanda." }
  const clavesMotivo = new Set(MOTIVOS_DEPURACION.map((m) => m.clave))
  for (const it of items) {
    if (!Number.isFinite(Number(it.idpedido))) return { success: false, message: "Pedido inválido en la selección." }
    if (!clavesMotivo.has(it.motivo)) return { success: false, message: `Motivo inválido en el pedido #${it.idpedido}.` }
  }
  const simular = input.simular ?? simulaEn(empresaId)
  try {
    const sbLectura: any = await getSupabaseAdminAsSystem()
    const acceso = await accesoPedidos(sbLectura, empresaId)
    if (!acceso) return { success: false, message: MSG_SIN_ACCESO }

    const auth = await autorizar({ proceso: "ped_depurar", idempresa: empresaId, clave: input.clave, referencia: `depurar ${items.length} pedido(s)${simular ? " (simulación)" : ""}` })
    if (!auth.ok) return { success: false, message: auth.error || "Clave incorrecta." }

    const hoy = hoyBogotaISO()
    const ids = [...new Set(items.map((i) => Number(i.idpedido)))]
    const cab: any[] = []
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await limitarPorOwners(sbLectura.from("pedidoscabecera").select("*").eq("id_empresa", empresaId).in("idpedido", ids.slice(i, i + 150)), acceso).order("idpedido").range(0, 999)
      if (error) throw error
      cab.push(...(data ?? []))
    }
    const lineas = await resumenLineas(sbLectura, empresaId, cab.map((c: any) => Number(c.idpedido)))
    const porId = new Map<number, PedidoCola>(cab.map((p: any) => [Number(p.idpedido), aPedidoCola(p, lineas.get(Number(p.idpedido)), hoy)]))

    const omitidos: { idpedido: number; razon: string }[] = []
    // Grupos de actualización: mismo estado destino + mismo texto de motivo → un UPDATE.
    const grupos = new Map<string, { estado: string; motivo: string; ids: number[] }>()
    let comoNoEntregado = 0
    let comoEntregaParcial = 0
    for (const it of items) {
      const id = Number(it.idpedido)
      const p = porId.get(id)
      if (!p) {
        omitidos.push({ idpedido: id, razon: "No existe en este proyecto o no tienes acceso" })
        continue
      }
      const c = p.calc
      if (c.esFinal) {
        omitidos.push({ idpedido: id, razon: `Ya está finalizado (${c.etiqueta})` })
        continue
      }
      if (!c.candidatoDepuracion) {
        const razon = !c.sinRastro && c.estado !== "parcial" ? "Ya tiene orden de cargue, vehículo o entrega" : c.estado === "parcial" ? "Parcial con menos de 30 días" : "Aún no cumple los 15 días sin rastro"
        omitidos.push({ idpedido: id, razon })
        continue
      }
      const estadoDestino = c.candidatoDepuracion === "parcial" ? ESTADO_ENTREGA_PARCIAL : ESTADO_NO_ENTREGADO
      if (estadoDestino === ESTADO_NO_ENTREGADO) comoNoEntregado++
      else comoEntregaParcial++
      const motivo = textoMotivo(it.motivo, it.detalle)
      const k = `${estadoDestino}|${motivo}`
      const g = grupos.get(k) ?? { estado: estadoDestino, motivo, ids: [] }
      g.ids.push(id)
      grupos.set(k, g)
    }

    let depurados = 0
    if (!simular) {
      const sb: any = await getSupabaseAdmin()
      const ahora = new Date().toISOString()
      for (const g of grupos.values()) {
        for (let i = 0; i < g.ids.length; i += 100) {
          const lote = g.ids.slice(i, i + 100)
          // Candado en el UPDATE: solo abiertos y, para "no entregado", sin ningún rastro logístico.
          let q = sb
            .from("pedidoscabecera")
            .update({ estado: g.estado, motivo_no_entrega: g.motivo, depurado_por: auth.autorizadoPor ?? acceso.usuario ?? "autorizado", depurado_en: ahora })
            .eq("id_empresa", empresaId)
            .in("idpedido", lote)
            .or(FILTRO_ABIERTOS_POSTGREST)
          q = g.estado === ESTADO_NO_ENTREGADO ? q.is("ocargue", null).is("vehiculo", null).is("fechaordencargue", null).is("fechadeentrega", null) : q.ilike("estado", "parcial")
          const { data, error } = await q.select("idpedido")
          if (error) throw error
          const hechos = new Set((data ?? []).map((r: any) => Number(r.idpedido)))
          depurados += hechos.size
          for (const id of lote) if (!hechos.has(id)) omitidos.push({ idpedido: id, razon: "Cambió mientras se depuraba (ya tiene rastro o se cerró)" })
        }
      }
    } else {
      depurados = comoNoEntregado + comoEntregaParcial
    }

    return { success: true, data: { simulado: simular, depurados, omitidos, autorizadoPor: auth.autorizadoPor ?? null, comoNoEntregado, comoEntregaParcial } }
  } catch (e: any) {
    console.error("[pedidos-cola] depurarPedidos:", e?.message ?? e)
    const m = String(e?.message ?? "")
    if (/motivo_no_entrega|depurado_por|depurado_en/.test(m)) return { success: false, message: "Falta correr el script SQL 215 (columnas de depuración en pedidoscabecera)." }
    return { success: false, message: m || "No se pudo depurar." }
  }
}

// ─────────────────────────────── Demanda de un día ───────────────────────────────

export async function getDemandaFecha(empresaId: number | null | undefined, fecha: string): Promise<Resp<DemandaFecha>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { success: false, message: "Fecha inválida." }
  try {
    const sb: any = await getSupabaseAdminAsSystem()
    const acceso = await accesoPedidos(sb, empresaId)
    if (!acceso) return { success: false, message: MSG_SIN_ACCESO }
    const hoy = hoyBogotaISO()
    const cola = await cargarCola(sb, acceso, empresaId, hoy)

    const del = cola.filter((p) => p.fecha_programada === fecha)
    const clientes = new Map<string, DemandaCliente>()
    const despacho = new Map<string, { tipo: string; pedidos: number; kg: number }>()
    let aprobados = 0
    for (const p of del) {
      const esAprobado = normalizarEstado(p.aprobado) === "si"
      if (esAprobado) aprobados++
      const c = clientes.get(p.cliente) ?? { cliente: p.cliente, pedidos: 0, kg: 0, unidades: 0, tiposDespacho: [], aprobados: 0, porAprobar: 0, idpedidos: [] }
      c.pedidos++
      c.kg += p.kg
      c.unidades += p.unidades
      c.idpedidos.push(p.idpedido)
      if (esAprobado) c.aprobados++
      else c.porAprobar++
      const td = (p.tipo_despacho ?? "Sin tipo").trim() || "Sin tipo"
      if (!c.tiposDespacho.includes(td)) c.tiposDespacho.push(td)
      clientes.set(p.cliente, c)
      const d = despacho.get(td) ?? { tipo: td, pedidos: 0, kg: 0 }
      d.pedidos++
      d.kg += p.kg
      despacho.set(td, d)
    }

    const atr = cola.filter((p) => p.calc.estado === "programado" && p.calc.atrasoDias > 0 && p.calc.atrasoDias <= 15)
    const atrCli = new Map<string, { cliente: string; pedidos: number; kg: number; promesas: string[] }>()
    for (const p of atr) {
      const a = atrCli.get(p.cliente) ?? { cliente: p.cliente, pedidos: 0, kg: 0, promesas: [] }
      a.pedidos++
      a.kg += p.kg
      if (p.fecha_programada && !a.promesas.includes(p.fecha_programada)) a.promesas.push(p.fecha_programada)
      atrCli.set(p.cliente, a)
    }

    const proximosDias: { fecha: string; pedidos: number; kg: number }[] = []
    for (let i = 1; i <= 8; i++) {
      const f = sumarDiasISO(hoy, i)
      const ps = cola.filter((p) => p.fecha_programada === f)
      proximosDias.push({ fecha: f, pedidos: ps.length, kg: ps.reduce((s, p) => s + p.kg, 0) })
    }

    // Programación de vehículos del cliente para ese día (si el proyecto la usa).
    const [tipos, prog, usa] = await Promise.all([
      sb.from("tiposvehiculos").select("nombretipo, capacidad, activo").order("capacidad", { ascending: false }).limit(50),
      sb.from("programacion_cliente").select("lineas, total_vehiculos, a_tiempo, enviada_en").eq("idempresa", empresaId).eq("fecha_operacion", fecha).eq("vigente", true).limit(1),
      sb.from("programacion_cliente").select("id", { count: "exact", head: true }).eq("idempresa", empresaId),
    ])
    const tiposVehiculo: { nombre: string; capacidad: number | null }[] = (tipos.data ?? [])
      .filter((t: any) => t.activo === true || t.activo === "true" || t.activo == null)
      .map((t: any) => ({ nombre: String(t.nombretipo), capacidad: t.capacidad == null ? null : Number(t.capacidad) }))
    const capDe = new Map<string, number | null>(tiposVehiculo.map((t) => [t.nombre.toLowerCase(), t.capacidad] as [string, number | null]))
    const vig = prog.error ? null : prog.data?.[0] ?? null
    const porTipoMap = new Map<string, { tipo: string; cantidad: number; capacidadT: number | null }>()
    let vehiculos = 0
    let capacidadT: number | null = 0
    for (const l of Array.isArray(vig?.lineas) ? vig.lineas : []) {
      const tipo = String(l?.tipovehiculo ?? "").trim()
      const cant = n0(l?.cantidad)
      vehiculos += cant
      const cap = capDe.get(tipo.toLowerCase()) ?? null
      const t = porTipoMap.get(tipo) ?? { tipo, cantidad: 0, capacidadT: cap }
      t.cantidad += cant
      porTipoMap.set(tipo, t)
      if (cap == null) capacidadT = null
      else if (capacidadT != null) capacidadT += cap * cant
    }

    return {
      success: true,
      data: {
        hoy,
        fecha,
        pedidos: del.length,
        kg: del.reduce((s, p) => s + p.kg, 0),
        unidades: del.reduce((s, p) => s + p.unidades, 0),
        aprobados,
        porAprobar: del.length - aprobados,
        porCliente: [...clientes.values()].sort((a, b) => b.kg - a.kg || a.cliente.localeCompare(b.cliente)),
        porDespacho: [...despacho.values()].sort((a, b) => b.pedidos - a.pedidos),
        atrasadosRecientes: { total: atr.length, kg: atr.reduce((s, p) => s + p.kg, 0), porCliente: [...atrCli.values()].sort((a, b) => b.kg - a.kg).slice(0, 5) },
        proximosDias,
        programacion: {
          usa: !usa.error && (usa.count ?? 0) > 0,
          tiene: !!vig,
          vehiculos,
          capacidadT: vig ? capacidadT : null,
          porTipo: [...porTipoMap.values()],
          aTiempo: vig ? !!vig.a_tiempo : null,
          enviadaEn: vig?.enviada_en ? String(vig.enviada_en) : null,
        },
        tiposVehiculo,
      },
    }
  } catch (e: any) {
    console.error("[pedidos-cola] getDemandaFecha:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo cargar la demanda del día." }
  }
}
