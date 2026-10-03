"use server"

// DASHBOARD DE PEDIDOS — indicadores logísticos del cliente por período.
// Reconstrucción total (gerencia 2026-10-03): cada bloque responde a una pregunta del
// gerente y termina en una acción. Fuera lo comercial (vendedores, facturado, ticket) y
// lo que no tiene datos (flete, demora, In-Full con campos vacíos).
//
// Definiciones (las mismas de Gestionar pedidos y del script de verificación):
//   · Período = pedidos cuya PROMESA (fecha_programada) cae en [desde, hasta].
//   · A tiempo = la orden de cargue (o la entrega, si no hay OC) se dio el día de la
//     promesa o antes. Tarde = después. Pendiente = abierto sin OC. Los anulados y los
//     no entregados se cuentan aparte y no entran en el % a tiempo.
//   · Kilos = suma de pedidosdetalle.peso; kilos cargados = peso × (cargadas / unidades)
//     por línea, solo donde hay unidades cargadas registradas (se informa la cobertura).
//   · Dinero solo si al menos la mitad de los pedidos del período tiene valor (Avimol no).
// Las consultas van acotadas al período: nunca el histórico completo.
// La acción antigua getDashboardPedidosData queda solo para cierre-dia-dashboard.tsx.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { hoyBogotaISO } from "@/lib/periodo-listados"
import { accesoPedidos, limitarPorOwners } from "@/lib/acceso-empresa"
import { diasEntre, esEstadoFinal, inicioDeMes, normalizarEstado, sumarDiasISO } from "@/lib/pedidos-estado"
import { validarRango, lunesDe } from "@/lib/periodo-rango"
import { MSG_SIN_ACCESO, cargarCola, lineasMinimas, n0, resumirLineas, type ResLineas } from "@/lib/pedidos-cola-core"
import { clasificarPedido } from "@/lib/pedidos-indicadores"

type Resp<T> = { success: true; data: T } | { success: false; message: string }

export interface SemanaCumplimiento {
  inicio: string
  aTiempo: number
  tarde: number
  pendiente: number
  noEntregado: number
  anulado: number
  cerradoSinFecha: number
  kg: number
  kgCargados: number
}

export interface MesTendencia {
  mes: string
  pedidos: number
  aTiempo: number
  conFecha: number
  pendientes: number
  mismoDia: number
  conPromesa: number
}

export interface DashboardPedidosPeriodo {
  hoy: string
  desde: string
  hasta: string
  mostrarDinero: boolean
  franja: {
    pedidos: number
    clientes: number
    kg: number
    kgCargados: number
    /** Pedidos con alguna unidad cargada registrada (cobertura del dato "cargado"). */
    conCargado: number
    dinero: number
    aTiempo: number
    conFecha: number
    tarde: number
    pendientes: number
    kgPendientes: number
    anulados: number
    noEntregados: number
    cerradosSinFecha: number
    mismoDia: number
    conPromesa: number
  }
  semanas: SemanaCumplimiento[]
  meses: MesTendencia[]
  porDespacho: { tipo: string; pedidos: number; aTiempo: number; conFecha: number; pendientes: number; kg: number; kgCargados: number }[]
  porCliente: { cliente: string; pedidos: number; aTiempo: number; conFecha: number; tarde: number; pendientes: number; kg: number }[]
  atraso: { promedio: number | null; mediana: number | null; maximo: number; buckets: { rango: string; pedidos: number }[]; pendientesPromedio: number | null }
  completitud: { completos: number; parciales: number; sinDato: number; productosPendientes: { producto: string; unidades: number; pedidos: number }[] }
  volumen: { porDiaSemana: { dia: string; pedidos: number; kg: number }[]; diaPico: string | null; ordenesCargue: number; kgPorOrden: number | null }
  anticipacion: { buckets: { rango: string; pedidos: number }[]; porCliente: { cliente: string; pedidos: number; mismoDia: number }[]; despues5pm: number | null; conHora: number }
  backlog: { abiertos: number; atrasados: number; kgAtrasados: number; buckets: { rango: string; pedidos: number; kg: number }[]; topClientes: { cliente: string; pedidos: number; kg: number }[]; candidatos: number }
  noEntregados: { total: number; kg: number; porMotivo: { motivo: string; pedidos: number; kg: number }[]; porCliente: { cliente: string; pedidos: number; kg: number }[]; disponible: boolean }
  cierreHoy: { paraHoy: number; conOc: number; kgHoy: number; entregadosHoy: number }
}

const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
const diaSemana = (iso: string) => DIAS[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7]

// La clasificación (a tiempo / tarde / pendiente…) es la misma del BSC: lib/pedidos-indicadores.ts.
const clasificar = (p: any, _hoy: string) => clasificarPedido(p)

const mediana = (xs: number[]) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const prom = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)

export async function getDashboardPedidosPeriodo(empresaId: number | null | undefined, desde: string, hasta: string): Promise<Resp<DashboardPedidosPeriodo>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  const errRango = validarRango(desde, hasta)
  if (errRango) return { success: false, message: errRango }
  try {
    const sb: any = await getSupabaseAdminAsSystem()
    const acceso = await accesoPedidos(sb, empresaId)
    if (!acceso) return { success: false, message: MSG_SIN_ACCESO }
    const hoy = hoyBogotaISO()

    // 1. Pedidos del período (por promesa), todos los estados.
    const cab: any[] = await fetchAllRows((from, to) =>
      limitarPorOwners(sb.from("pedidoscabecera").select("*").eq("id_empresa", empresaId).gte("fecha_programada", desde).lte("fecha_programada", hasta), acceso)
        .order("idpedido", { ascending: true })
        .range(from, to),
    )
    const lineas = await lineasMinimas(sb, empresaId, cab.map((c) => Number(c.idpedido)))
    const porPedido = resumirLineas(lineas)
    const kgCargadosDe = new Map<number, number>()
    for (const l of lineas) {
      if (l.unidades > 0 && l.cargadas > 0) kgCargadosDe.set(l.idpedido, (kgCargadosDe.get(l.idpedido) ?? 0) + (l.peso * Math.min(l.cargadas, l.unidades)) / l.unidades)
    }

    const franja = { pedidos: cab.length, clientes: 0, kg: 0, kgCargados: 0, conCargado: 0, dinero: 0, aTiempo: 0, conFecha: 0, tarde: 0, pendientes: 0, kgPendientes: 0, anulados: 0, noEntregados: 0, cerradosSinFecha: 0, mismoDia: 0, conPromesa: 0 }
    const semanas = new Map<string, SemanaCumplimiento>()
    const despacho = new Map<string, { tipo: string; pedidos: number; aTiempo: number; conFecha: number; pendientes: number; kg: number; kgCargados: number }>()
    const clientes = new Map<string, { cliente: string; pedidos: number; aTiempo: number; conFecha: number; tarde: number; pendientes: number; kg: number }>()
    const diasAtraso: number[] = []
    const diasPendiente: number[] = []
    const bucketsAtraso = { "1-2": 0, "3-7": 0, ">7": 0 } as Record<string, number>
    const completitud = { completos: 0, parciales: 0, sinDato: 0 }
    const pendientesProducto = new Map<string, { producto: string; unidades: number; pedidos: Set<number> }>()
    const porDia = new Map<string, { dia: string; pedidos: number; kg: number }>(DIAS.map((d) => [d, { dia: d, pedidos: 0, kg: 0 }]))
    const ordenes = new Set<string>()
    const antic = { "0": 0, "1": 0, "2-3": 0, ">3": 0 } as Record<string, number>
    const anticCliente = new Map<string, { cliente: string; pedidos: number; mismoDia: number }>()
    let conDinero = 0
    let despues5pm = 0
    let conHora = 0
    const clientesSet = new Set<string>()

    for (const p of cab) {
      const r: ResLineas = porPedido.get(Number(p.idpedido)) ?? { kg: 0, und: 0, lineas: 0, oc: 0, cargadas: 0, pend: 0 }
      const kgC = kgCargadosDe.get(Number(p.idpedido)) ?? 0
      const { clase, fechaRef } = clasificar(p, hoy)
      const promesa = String(p.fecha_programada).slice(0, 10)
      const registro = p.fecha ? String(p.fecha).slice(0, 10) : null
      const cliente = String(p.cliente ?? "")
      const td = String(p.tipo_despacho ?? "Sin tipo").trim() || "Sin tipo"
      clientesSet.add(cliente)
      franja.kg += r.kg
      franja.kgCargados += kgC
      if (r.cargadas > 0) franja.conCargado++
      if (n0(p.total_pagar) > 0) {
        conDinero++
        franja.dinero += n0(p.total_pagar)
      }
      // Clase
      if (clase === "a_tiempo" || clase === "tarde") franja.conFecha++
      if (clase === "a_tiempo") franja.aTiempo++
      if (clase === "tarde") franja.tarde++
      if (clase === "pendiente") {
        franja.pendientes++
        franja.kgPendientes += r.kg
        const dp = diasEntre(hoy, promesa)
        if (dp > 0) diasPendiente.push(dp)
      }
      if (clase === "anulado") franja.anulados++
      if (clase === "no_entregado") franja.noEntregados++
      if (clase === "cerrado_sin_fecha") franja.cerradosSinFecha++
      if (clase === "tarde" && fechaRef) {
        const d = diasEntre(fechaRef, promesa)
        diasAtraso.push(d)
        bucketsAtraso[d <= 2 ? "1-2" : d <= 7 ? "3-7" : ">7"]++
      }
      // Semana
      const ini = lunesDe(promesa)
      const w = semanas.get(ini) ?? { inicio: ini, aTiempo: 0, tarde: 0, pendiente: 0, noEntregado: 0, anulado: 0, cerradoSinFecha: 0, kg: 0, kgCargados: 0 }
      if (clase === "a_tiempo") w.aTiempo++
      else if (clase === "tarde") w.tarde++
      else if (clase === "pendiente") w.pendiente++
      else if (clase === "no_entregado") w.noEntregado++
      else if (clase === "anulado") w.anulado++
      else w.cerradoSinFecha++
      w.kg += r.kg
      w.kgCargados += kgC
      semanas.set(ini, w)
      // Despacho y cliente
      const dd = despacho.get(td) ?? { tipo: td, pedidos: 0, aTiempo: 0, conFecha: 0, pendientes: 0, kg: 0, kgCargados: 0 }
      dd.pedidos++
      if (clase === "a_tiempo" || clase === "tarde") dd.conFecha++
      if (clase === "a_tiempo") dd.aTiempo++
      if (clase === "pendiente") dd.pendientes++
      dd.kg += r.kg
      dd.kgCargados += kgC
      despacho.set(td, dd)
      const cc = clientes.get(cliente) ?? { cliente, pedidos: 0, aTiempo: 0, conFecha: 0, tarde: 0, pendientes: 0, kg: 0 }
      cc.pedidos++
      if (clase === "a_tiempo" || clase === "tarde") cc.conFecha++
      if (clase === "a_tiempo") cc.aTiempo++
      if (clase === "tarde") cc.tarde++
      if (clase === "pendiente") cc.pendientes++
      cc.kg += r.kg
      clientes.set(cliente, cc)
      // Completitud (solo pedidos que ya tuvieron cargue o cierre)
      const est = normalizarEstado(p.estado)
      if (clase === "a_tiempo" || clase === "tarde" || clase === "cerrado_sin_fecha") {
        if (est === "entregado" || (r.cargadas > 0 && r.und > 0 && r.cargadas >= r.und)) completitud.completos++
        else if (est === "parcial" || est === "entrega parcial" || (r.cargadas > 0 && r.cargadas < r.und)) completitud.parciales++
        else completitud.sinDato++
      }
      // Volumen
      const dia = porDia.get(diaSemana(promesa))!
      dia.pedidos++
      dia.kg += r.kg
      if (p.ocargue && String(p.ocargue).trim()) ordenes.add(String(p.ocargue).trim())
      // Anticipación
      if (registro) {
        franja.conPromesa++
        const d = diasEntre(promesa, registro)
        if (d === 0) franja.mismoDia++
        if (d >= 0) antic[d === 0 ? "0" : d === 1 ? "1" : d <= 3 ? "2-3" : ">3"]++
        const ac = anticCliente.get(cliente) ?? { cliente, pedidos: 0, mismoDia: 0 }
        ac.pedidos++
        if (d === 0) ac.mismoDia++
        anticCliente.set(cliente, ac)
        if (p.creado_en) {
          conHora++
          const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "numeric", hour12: false }).format(new Date(p.creado_en)))
          if (d === 0 && h >= 17) despues5pm++
        }
      }
    }
    franja.clientes = clientesSet.size
    const estadoDe = new Map<number, string>(cab.map((c) => [Number(c.idpedido), normalizarEstado(c.estado)]))
    for (const l of lineas) {
      const est = estadoDe.get(l.idpedido)
      if (est == null) continue
      if (est !== "parcial" && est !== "entrega parcial") continue
      const falt = Math.max(0, l.unidades - l.cargadas)
      if (falt <= 0) continue
      const pp = pendientesProducto.get(l.producto) ?? { producto: l.producto, unidades: 0, pedidos: new Set<number>() }
      pp.unidades += falt
      pp.pedidos.add(l.idpedido)
      pendientesProducto.set(l.producto, pp)
      if (l.ocargue) ordenes.add(l.ocargue)
    }
    for (const l of lineas) if (l.ocargue) ordenes.add(l.ocargue)

    // 2. Tendencia mensual: 6 meses hasta el mes de `hasta` (solo columnas necesarias).
    const [hy, hm] = hasta.split("-").map(Number)
    const mesesLista: string[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(hy, hm - 1 - i, 1))
      mesesLista.push(d.toISOString().slice(0, 7))
    }
    const desdeMeses = `${mesesLista[0]}-01`
    const tend: any[] = await fetchAllRows((from, to) =>
      limitarPorOwners(sb.from("pedidoscabecera").select("idpedido, fecha, fecha_programada, fechaordencargue, fechadeentrega, estado, ocargue").eq("id_empresa", empresaId).gte("fecha_programada", desdeMeses).lte("fecha_programada", hasta), acceso)
        .order("idpedido", { ascending: true })
        .range(from, to),
    )
    const meses = new Map<string, MesTendencia>(mesesLista.map((m) => [m, { mes: m, pedidos: 0, aTiempo: 0, conFecha: 0, pendientes: 0, mismoDia: 0, conPromesa: 0 }]))
    for (const p of tend) {
      const m = String(p.fecha_programada).slice(0, 7)
      const t = meses.get(m)
      if (!t) continue
      const { clase } = clasificar(p, hoy)
      t.pedidos++
      if (clase === "a_tiempo" || clase === "tarde") t.conFecha++
      if (clase === "a_tiempo") t.aTiempo++
      if (clase === "pendiente") t.pendientes++
      if (p.fecha) {
        t.conPromesa++
        if (String(p.fecha).slice(0, 10) === String(p.fecha_programada).slice(0, 10)) t.mismoDia++
      }
    }

    // 3. Pendiente y atraso a HOY (independiente del período) + cierre de hoy.
    const cola = await cargarCola(sb, acceso, empresaId, hoy)
    const atr = cola.filter((p) => p.calc.estado === "programado" && p.calc.atrasoDias > 0)
    const bk = [
      { rango: "1 – 7 d", min: 1, max: 7 },
      { rango: "8 – 15 d", min: 8, max: 15 },
      { rango: "16 – 30 d", min: 16, max: 30 },
      { rango: "más de 30 d", min: 31, max: Infinity },
    ].map((b) => ({ rango: b.rango, pedidos: atr.filter((p) => p.calc.atrasoDias >= b.min && p.calc.atrasoDias <= b.max).length, kg: atr.filter((p) => p.calc.atrasoDias >= b.min && p.calc.atrasoDias <= b.max).reduce((s, p) => s + p.kg, 0) }))
    const topCli = new Map<string, { cliente: string; pedidos: number; kg: number }>()
    for (const p of atr) {
      const c = topCli.get(p.cliente) ?? { cliente: p.cliente, pedidos: 0, kg: 0 }
      c.pedidos++
      c.kg += p.kg
      topCli.set(p.cliente, c)
    }
    const paraHoy = cola.filter((p) => p.calc.esHoy && !p.calc.esFinal)
    const { count: entregadosHoy } = await limitarPorOwners(sb.from("pedidoscabecera").select("idpedido", { count: "exact", head: true }).eq("id_empresa", empresaId).eq("fechadeentrega", hoy), acceso)

    // 4. No entregados (depurados) en el período, por fecha de depuración.
    let noEntregados: DashboardPedidosPeriodo["noEntregados"] = { total: 0, kg: 0, porMotivo: [], porCliente: [], disponible: true }
    try {
      const dep: any[] = await fetchAllRows((from, to) =>
        limitarPorOwners(sb.from("pedidoscabecera").select("idpedido, cliente, estado, motivo_no_entrega, depurado_en").eq("id_empresa", empresaId).not("depurado_en", "is", null).gte("depurado_en", `${desde}T00:00:00-05:00`).lte("depurado_en", `${hasta}T23:59:59-05:00`), acceso)
          .order("idpedido", { ascending: true })
          .range(from, to),
      )
      const kgDep = resumirLineas(await lineasMinimas(sb, empresaId, dep.map((d) => Number(d.idpedido))))
      const pm = new Map<string, { motivo: string; pedidos: number; kg: number }>()
      const pc = new Map<string, { cliente: string; pedidos: number; kg: number }>()
      let kgT = 0
      for (const d of dep) {
        const kg = kgDep.get(Number(d.idpedido))?.kg ?? 0
        kgT += kg
        const motivo = String(d.motivo_no_entrega ?? "Sin motivo").split(" · ")[0]
        const a = pm.get(motivo) ?? { motivo, pedidos: 0, kg: 0 }
        a.pedidos++
        a.kg += kg
        pm.set(motivo, a)
        const c = pc.get(String(d.cliente ?? "")) ?? { cliente: String(d.cliente ?? ""), pedidos: 0, kg: 0 }
        c.pedidos++
        c.kg += kg
        pc.set(c.cliente, c)
      }
      noEntregados = { total: dep.length, kg: kgT, porMotivo: [...pm.values()].sort((a, b) => b.pedidos - a.pedidos), porCliente: [...pc.values()].sort((a, b) => b.pedidos - a.pedidos).slice(0, 8), disponible: true }
    } catch {
      noEntregados = { total: 0, kg: 0, porMotivo: [], porCliente: [], disponible: false }
    }

    const porDiaArr = [...porDia.values()]
    const pico = porDiaArr.reduce<{ dia: string; kg: number } | null>((m, d) => (d.pedidos > 0 && (!m || d.kg > m.kg) ? { dia: d.dia, kg: d.kg } : m), null)

    return {
      success: true,
      data: {
        hoy,
        desde,
        hasta,
        mostrarDinero: cab.length > 0 && conDinero / cab.length >= 0.5,
        franja,
        semanas: [...semanas.values()].sort((a, b) => a.inicio.localeCompare(b.inicio)),
        meses: [...meses.values()],
        porDespacho: [...despacho.values()].sort((a, b) => b.pedidos - a.pedidos),
        porCliente: [...clientes.values()].sort((a, b) => b.pedidos - a.pedidos || b.kg - a.kg).slice(0, 10),
        atraso: {
          promedio: prom(diasAtraso),
          mediana: mediana(diasAtraso),
          maximo: diasAtraso.length ? Math.max(...diasAtraso) : 0,
          buckets: Object.entries(bucketsAtraso).map(([rango, pedidos]) => ({ rango: rango === "1-2" ? "1 – 2 d" : rango === "3-7" ? "3 – 7 d" : "más de 7 d", pedidos })),
          pendientesPromedio: prom(diasPendiente),
        },
        completitud: {
          ...completitud,
          productosPendientes: [...pendientesProducto.values()].map((x) => ({ producto: x.producto, unidades: Math.round(x.unidades), pedidos: x.pedidos.size })).sort((a, b) => b.unidades - a.unidades).slice(0, 10),
        },
        volumen: { porDiaSemana: porDiaArr, diaPico: pico?.dia ?? null, ordenesCargue: ordenes.size, kgPorOrden: ordenes.size > 0 ? Math.round(franja.kgCargados / ordenes.size) : null },
        anticipacion: {
          buckets: Object.entries(antic).map(([rango, pedidos]) => ({ rango: rango === "0" ? "mismo día" : rango === "1" ? "1 día" : rango === "2-3" ? "2 – 3 días" : "más de 3 días", pedidos })),
          porCliente: [...anticCliente.values()].sort((a, b) => b.pedidos - a.pedidos).slice(0, 8),
          despues5pm: conHora > 0 ? despues5pm : null,
          conHora,
        },
        backlog: {
          abiertos: cola.length,
          atrasados: atr.length,
          kgAtrasados: atr.reduce((s, p) => s + p.kg, 0),
          buckets: bk,
          topClientes: [...topCli.values()].sort((a, b) => b.pedidos - a.pedidos).slice(0, 5),
          candidatos: cola.filter((p) => p.calc.candidatoDepuracion).length,
        },
        noEntregados,
        cierreHoy: { paraHoy: paraHoy.length, conOc: paraHoy.filter((p) => !p.calc.sinRastro).length, kgHoy: paraHoy.reduce((s, p) => s + p.kg, 0), entregadosHoy: entregadosHoy ?? 0 },
      },
    }
  } catch (e: any) {
    console.error("[dashboard-pedidos-periodo]", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo calcular el dashboard." }
  }
}

export async function getRangoSugerido(): Promise<{ hoy: string; inicioMes: string; ayer: string }> {
  const hoy = hoyBogotaISO()
  return { hoy, inicioMes: inicioDeMes(hoy), ayer: sumarDiasISO(hoy, -1) }
}
