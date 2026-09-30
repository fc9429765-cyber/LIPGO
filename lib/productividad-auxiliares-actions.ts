"use server"

/**
 * Productividad de Auxiliares (Operación LIP) — informe de GERENCIA.
 *
 * Quién carga de verdad en cada ID: usa `cabeceraoc.auxiliares_real` (el
 * personal que el coordinador asignó al vehículo en el Centro de Coordinación),
 * NO la lista de pago `auxiliares`, que en pago Global incluye a todos los del
 * día. Con eso se ve quién mueve más toneladas, cuántas órdenes atiende, su
 * promedio por día y cuánto difiere lo que cargó de lo que se le pagó.
 *
 * Universo y peso: los MISMOS de nómina y de Control de Toneladas (órdenes
 * cerradas por fechacargue, sin "proyeccion", sin Distribución en Avimol,
 * pesoBaseCalculo). Solo lectura.
 *
 * Órdenes sin `auxiliares_real` (anteriores a agosto 2026, cuando se empezó a
 * guardar): se usa la lista de pago como aproximación y se marcan "estimadas";
 * la cobertura se informa arriba del informe.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { pesoBaseCalculo, excluirAvimolDistribucion, liquidable } from "@/lib/nomina-calculo-utils"

const num = (v: any) => Number(v || 0)
const r3 = (v: number) => Math.round(v * 1000) / 1000
const r1 = (v: number) => Math.round(v * 10) / 10

export interface OrdenReal {
  fecha: string
  orden: string
  tipooperacion: string
  planta: number
  placa: string | null
  peso: number
  nReal: number
  tonReal: number
  /** true si la orden no tenía auxiliares_real y se usó la lista de pago. */
  estimada: boolean
  crew: string[]
}

export interface AuxiliarProductividad {
  persona: string
  activo: boolean
  planta: number | null
  dias: number
  ordenes: number
  ordenesEstimadas: number
  tonReal: number
  tonRealCargue: number
  tonRealDescargue: number
  tonBrutaParticipada: number
  tonPorDia: number
  tonPorOrden: number
  pctDelTotal: number
  /** Toneladas que le pagó nómina (reparto de la lista de pago) en el mismo periodo. */
  tonPagada: number
  diferenciaRealPagada: number
  tonPorFecha: Record<string, number>
  tonPorMes: Record<string, number>
  ordenesDetalle: OrdenReal[]
}

export interface DiaProductividad {
  fecha: string
  ordenes: number
  auxiliares: number
  toneladas: number
  tonPorAuxiliar: number
  ordenesEstimadas: number
}

export interface ProductividadData {
  desde: string
  hasta: string
  plantas: number[]
  totalOrdenes: number
  ordenesConReal: number
  coberturaReal: number
  totalToneladas: number
  totalAuxiliares: number
  promedioTonAuxiliarDia: number
  auxiliares: AuxiliarProductividad[]
  dias: DiaProductividad[]
  meses: string[]
  fechas: string[]
}

export async function getProductividadAuxiliares(
  idempresa: number | null,
  desde: string,
  hasta: string,
): Promise<{ success: boolean; data?: ProductividadData; message?: string }> {
  try {
    if (!desde || !hasta) return { success: false, message: "Rango de fechas requerido (desde y hasta)." }
    const admin: any = await getSupabaseAdmin()
    const emps = idempresa != null && [1, 2, 3, 4].includes(idempresa) ? [idempresa] : [1, 2, 3, 4]

    // 1) Órdenes cerradas del periodo (paginado, orden único por id).
    const ordenes: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("cabeceraoc")
        .select("id, ordendecargue, fechacargue, idempresa, tipooperacion, pesovascula, pesoorden, auxiliares, auxiliares_real, placa")
        .in("idempresa", emps)
        .gte("fechacargue", desde)
        .lte("fechacargue", hasta)
        .not("fincargue", "is", null)
        .neq("tipooperacion", "proyeccion")
        .order("id")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      if (!data || data.length === 0) break
      ordenes.push(...data)
      if (data.length < 1000) break
    }

    // 2) Head Count: activo hoy (badge) — no decide quién aparece.
    const activoPorNombre = new Map<string, boolean>()
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("headcount")
        .select("nombre, idempresa, estado, contratosiigo, fecha_retiro")
        .in("idempresa", emps)
        .order("id")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      for (const r of data || []) {
        const n = String(r.nombre || "").trim().toUpperCase()
        if (n) activoPorNombre.set(n, liquidable(r))
      }
      if (!data || data.length < 1000) break
    }

    const partir = (s: any) =>
      String(s || "")
        .split(",")
        .map((x: string) => x.trim())
        .filter(Boolean)

    type Acc = {
      persona: string
      plantas: Set<number>
      dias: Set<string>
      ordenes: number
      ordenesEstimadas: number
      tonReal: number
      tonRealCargue: number
      tonRealDescargue: number
      tonBruta: number
      tonPagada: number
      tonPorFecha: Map<string, number>
      tonPorMes: Map<string, number>
      detalle: OrdenReal[]
    }
    const porPersona = new Map<string, Acc>()
    const porDia = new Map<string, { ordenes: number; aux: Set<string>; ton: number; estimadas: number }>()
    const mesesSet = new Set<string>()
    const fechasSet = new Set<string>()
    let totalOrdenes = 0
    let ordenesConReal = 0
    let totalToneladas = 0

    for (const o of ordenes) {
      const planta = Number(o.idempresa)
      const tipo = String(o.tipooperacion || "").trim()
      if (excluirAvimolDistribucion(planta, tipo)) continue
      const { peso } = pesoBaseCalculo(planta, tipo, num(o.pesovascula), num(o.pesoorden))
      if (peso <= 0) continue
      const pago = partir(o.auxiliares)
      const tieneReal = Boolean(String(o.auxiliares_real || "").trim())
      const crew = tieneReal ? partir(o.auxiliares_real) : pago
      if (crew.length === 0) continue
      const fecha = String(o.fechacargue).slice(0, 10)
      const mes = fecha.slice(0, 7)
      totalOrdenes++
      if (tieneReal) ordenesConReal++
      totalToneladas += peso
      mesesSet.add(mes)
      fechasSet.add(fecha)
      const tonReal = peso / crew.length
      const tonPago = pago.length ? peso / pago.length : 0
      const placa = o.placa ? String(o.placa).trim() : null

      const d = porDia.get(fecha) ?? { ordenes: 0, aux: new Set<string>(), ton: 0, estimadas: 0 }
      d.ordenes++
      d.ton += peso
      if (!tieneReal) d.estimadas++
      for (const p of crew) d.aux.add(p.toUpperCase())
      porDia.set(fecha, d)

      const pagoUpper = new Set(pago.map((p) => p.toUpperCase()))
      for (const p of crew) {
        const key = p.toUpperCase()
        let c = porPersona.get(key)
        if (!c) {
          c = { persona: p, plantas: new Set(), dias: new Set(), ordenes: 0, ordenesEstimadas: 0, tonReal: 0, tonRealCargue: 0, tonRealDescargue: 0, tonBruta: 0, tonPagada: 0, tonPorFecha: new Map(), tonPorMes: new Map(), detalle: [] }
          porPersona.set(key, c)
        }
        c.plantas.add(planta)
        c.dias.add(fecha)
        c.ordenes++
        if (!tieneReal) c.ordenesEstimadas++
        c.tonReal += tonReal
        if (/descargue/i.test(tipo)) c.tonRealDescargue += tonReal
        else c.tonRealCargue += tonReal
        c.tonBruta += peso
        if (pagoUpper.has(key)) c.tonPagada += tonPago
        c.tonPorFecha.set(fecha, (c.tonPorFecha.get(fecha) || 0) + tonReal)
        c.tonPorMes.set(mes, (c.tonPorMes.get(mes) || 0) + tonReal)
        c.detalle.push({ fecha, orden: String(o.ordendecargue || ""), tipooperacion: tipo, planta, placa, peso: r3(peso), nReal: crew.length, tonReal: r3(tonReal), estimada: !tieneReal, crew })
      }
      // Personas que estaban en la lista de pago pero NO cargaron: su tonPagada
      // también cuenta, para que la diferencia real−pagada sea completa.
      for (const p of pago) {
        const key = p.toUpperCase()
        if (crew.some((cName) => cName.toUpperCase() === key)) continue
        let c = porPersona.get(key)
        if (!c) {
          c = { persona: p, plantas: new Set(), dias: new Set(), ordenes: 0, ordenesEstimadas: 0, tonReal: 0, tonRealCargue: 0, tonRealDescargue: 0, tonBruta: 0, tonPagada: 0, tonPorFecha: new Map(), tonPorMes: new Map(), detalle: [] }
          porPersona.set(key, c)
        }
        c.plantas.add(planta)
        c.tonPagada += tonPago
      }
    }

    const auxiliares: AuxiliarProductividad[] = []
    for (const c of porPersona.values()) {
      const dias = c.dias.size
      auxiliares.push({
        persona: c.persona,
        activo: activoPorNombre.has(c.persona.toUpperCase()) ? activoPorNombre.get(c.persona.toUpperCase())! : true,
        planta: c.plantas.size === 1 ? [...c.plantas][0] : null,
        dias,
        ordenes: c.ordenes,
        ordenesEstimadas: c.ordenesEstimadas,
        tonReal: r3(c.tonReal),
        tonRealCargue: r3(c.tonRealCargue),
        tonRealDescargue: r3(c.tonRealDescargue),
        tonBrutaParticipada: r3(c.tonBruta),
        tonPorDia: dias ? r3(c.tonReal / dias) : 0,
        tonPorOrden: c.ordenes ? r3(c.tonReal / c.ordenes) : 0,
        pctDelTotal: totalToneladas ? r1((c.tonReal / totalToneladas) * 100) : 0,
        tonPagada: r3(c.tonPagada),
        diferenciaRealPagada: r3(c.tonReal - c.tonPagada),
        tonPorFecha: Object.fromEntries([...c.tonPorFecha.entries()].map(([k, v]) => [k, r3(v)])),
        tonPorMes: Object.fromEntries([...c.tonPorMes.entries()].map(([k, v]) => [k, r3(v)])),
        ordenesDetalle: c.detalle.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden.localeCompare(b.orden)),
      })
    }
    // Más toneladas reales primero (el pedido de la gerencia: quién carga más).
    auxiliares.sort((a, b) => b.tonReal - a.tonReal || a.persona.localeCompare(b.persona))

    const dias: DiaProductividad[] = [...porDia.entries()]
      .map(([fecha, d]) => ({ fecha, ordenes: d.ordenes, auxiliares: d.aux.size, toneladas: r3(d.ton), tonPorAuxiliar: d.aux.size ? r3(d.ton / d.aux.size) : 0, ordenesEstimadas: d.estimadas }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    const sumaAuxDia = dias.reduce((s, d) => s + d.auxiliares, 0)

    return {
      success: true,
      data: {
        desde,
        hasta,
        plantas: emps,
        totalOrdenes,
        ordenesConReal,
        coberturaReal: totalOrdenes ? r1((ordenesConReal / totalOrdenes) * 100) : 0,
        totalToneladas: r3(totalToneladas),
        totalAuxiliares: auxiliares.filter((a) => a.ordenes > 0).length,
        promedioTonAuxiliarDia: sumaAuxDia ? r3(totalToneladas / sumaAuxDia) : 0,
        auxiliares,
        dias,
        meses: [...mesesSet].sort(),
        fechas: [...fechasSet].sort(),
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al calcular la productividad." }
  }
}
