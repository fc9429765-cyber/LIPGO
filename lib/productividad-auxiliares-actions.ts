"use server"

/**
 * Productividad de Auxiliares (Operación LIP) — informe de GERENCIA.
 *
 * Quién carga y descarga de verdad en cada ID: usa `cabeceraoc.auxiliares_real`
 * (el personal que el coordinador asignó al vehículo en el Centro de
 * Coordinación), NO la lista de pago `auxiliares`, que en pago Global incluye a
 * todos los del día. Separa CARGUE, DESCARGUE y DISTRIBUCIÓN, y aparte la TOLVA
 * (Indupan), que es PRODUCCIÓN, no cargue ni descargue: esas operaciones no
 * pasan por el Centro de Coordinación, no tienen placa y su cuadrilla es la que
 * trae la orden, así que se informan separadas y nunca se suman a las
 * toneladas de vehículos.
 *
 * Universo y peso: los MISMOS de nómina y de Control de Toneladas (órdenes
 * cerradas por fechacargue, sin "proyeccion", sin Distribución en Avimol,
 * pesoBaseCalculo). Solo lectura.
 *
 * Órdenes de vehículo sin `auxiliares_real` (anteriores a agosto 2026): se usa
 * la lista de pago como aproximación y se marcan "estimadas"; la cobertura
 * (solo sobre vehículos) se informa arriba.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { pesoBaseCalculo, excluirAvimolDistribucion, liquidable } from "@/lib/nomina-calculo-utils"
import { codigosOrdenPorUnidad } from "@/lib/ordenes-por-unidad"

const num = (v: any) => Number(v || 0)
const r3 = (v: number) => Math.round(v * 1000) / 1000
const r1 = (v: number) => Math.round(v * 10) / 10

// Tipos y `clasificarOperacion` viven en lib/productividad-auxiliares-tipos.ts:
// un archivo "use server" solo puede exportar funciones async (el build de
// Vercel falló por exportar una función síncrona desde aquí).
import {
  clasificarOperacion,
  type TipoOp,
  type OrdenReal,
  type PorTipo,
  type AuxiliarProductividad,
  type DiaProductividad,
  type VehiculoProductividad,
  type ProductividadData,
  type AsistenciaDia,
  type Frecuencia,
} from "@/lib/productividad-auxiliares-tipos"

// Cruce por nombre contra registroasistencia: sin acentos, sin dobles espacios, mayúsculas.
const claveNombre = (n: unknown) =>
  String(n ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
const esPuestoCargue = (puesto: unknown) => /cargue|descargue/i.test(String(puesto ?? ""))
const hora = (v: unknown) => (v ? String(v).slice(0, 5) : null)

const porTipoVacio = (): PorTipo => ({ cargue: 0, descargue: 0, distribucion: 0, tolva: 0, otro: 0 })
const redondearPorTipo = (p: PorTipo): PorTipo => ({ cargue: r3(p.cargue), descargue: r3(p.descargue), distribucion: r3(p.distribucion), tolva: r3(p.tolva), otro: r3(p.otro) })

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

    // 2b) Programación/asistencia del periodo (paginada): puesto, novedad y
    //     horarios por (planta|fecha|nombre), para la ficha 360° del auxiliar.
    const asistenciaPorNombre = new Map<string, AsistenciaDia[]>()
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("registroasistencia")
        .select("nombre, idempresa, fecha, puesto, asistencia, horaentradaprogramada, horasalidaprogramada, horaingreso, horasalida")
        .in("idempresa", emps)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("id")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      for (const r of data || []) {
        const k = claveNombre(r.nombre)
        if (!k) continue
        const lista = asistenciaPorNombre.get(k) ?? []
        lista.push({
          fecha: String(r.fecha).slice(0, 10),
          planta: Number(r.idempresa),
          puesto: r.puesto ? String(r.puesto) : null,
          novedad: r.asistencia ? String(r.asistencia) : null,
          entradaProgramada: hora(r.horaentradaprogramada),
          salidaProgramada: hora(r.horasalidaprogramada),
          entradaReal: hora(r.horaingreso),
          salidaReal: hora(r.horasalida),
        })
        asistenciaPorNombre.set(k, lista)
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
      companeros: Map<string, { veces: number; ton: number }>
      placasFrec: Map<string, { veces: number; ton: number }>
      vehiculos: number
      vehiculosPorTipo: PorTipo
      placas: Set<string>
      operacionesTolva: number
      ordenesEstimadas: number
      tonReal: number
      tonPorTipo: PorTipo
      tonTolva: number
      tonBruta: number
      tonPagada: number
      tonPorFecha: Map<string, number>
      tonPorMes: Map<string, number>
      detalle: OrdenReal[]
    }
    type AccDia = { vehiculos: number; vehiculosPorTipo: PorTipo; aux: Set<string>; ton: number; tonPorTipo: PorTipo; opTolva: number; tonTolva: number; auxTolva: Set<string>; estimadas: number }
    type AccVeh = { placa: string; visitas: number; visitasPorTipo: PorTipo; ton: number; primera: string; ultima: string; aux: Map<string, number> }
    const nuevoAcc = (persona: string): Acc => ({ persona, plantas: new Set(), dias: new Set(), companeros: new Map(), placasFrec: new Map(), vehiculos: 0, vehiculosPorTipo: porTipoVacio(), placas: new Set(), operacionesTolva: 0, ordenesEstimadas: 0, tonReal: 0, tonPorTipo: porTipoVacio(), tonTolva: 0, tonBruta: 0, tonPagada: 0, tonPorFecha: new Map(), tonPorMes: new Map(), detalle: [] })

    const porPersona = new Map<string, Acc>()
    const porDia = new Map<string, AccDia>()
    const porVehiculo = new Map<string, AccVeh>()
    const auxPorTipo: Record<TipoOp, Set<string>> = { cargue: new Set(), descargue: new Set(), distribucion: new Set(), tolva: new Set(), otro: new Set() }
    const mesesSet = new Set<string>()
    const fechasSet = new Set<string>()
    const tonPorTipo = porTipoVacio()
    const vehiculosPorTipo = porTipoVacio()
    let totalOrdenes = 0
    let ordenesConReal = 0
    let totalToneladas = 0
    let operacionesTolva = 0
    let tonTolva = 0

    // Órdenes por unidad (Huevos / Empaque MP): su "peso" son unidades. Fuera
    // de las toneladas; se informan aparte.
    const porUnidadSet = await codigosOrdenPorUnidad(admin, ordenes.map((o: any) => o.ordendecargue))
    const porUnidad = { ordenes: 0, unidades: 0 }

    for (const o of ordenes) {
      const planta = Number(o.idempresa)
      const tipoTxt = String(o.tipooperacion || "").trim()
      if (excluirAvimolDistribucion(planta, tipoTxt)) continue
      if (porUnidadSet.has(String(o.ordendecargue ?? "").trim())) {
        porUnidad.ordenes++
        porUnidad.unidades += num(o.pesovascula) || num(o.pesoorden)
        continue
      }
      const { peso } = pesoBaseCalculo(planta, tipoTxt, num(o.pesovascula), num(o.pesoorden))
      if (peso <= 0) continue
      const tipo = clasificarOperacion(tipoTxt)
      const esTolva = tipo === "tolva"
      const pago = partir(o.auxiliares)
      const tieneReal = Boolean(String(o.auxiliares_real || "").trim())
      // Tolva: la cuadrilla es la de la orden (no pasa por Centro de Coordinación) → no es "estimada".
      const crew = esTolva ? (tieneReal ? partir(o.auxiliares_real) : pago) : tieneReal ? partir(o.auxiliares_real) : pago
      if (crew.length === 0) continue
      const estimada = !esTolva && !tieneReal
      const fecha = String(o.fechacargue).slice(0, 10)
      const mes = fecha.slice(0, 7)
      const placa = o.placa ? String(o.placa).trim().toUpperCase() : null
      mesesSet.add(mes)
      fechasSet.add(fecha)
      const tonReal = peso / crew.length
      const tonPago = pago.length ? peso / pago.length : 0

      if (esTolva) {
        operacionesTolva++
        tonTolva += peso
      } else {
        totalOrdenes++
        if (tieneReal) ordenesConReal++
        totalToneladas += peso
        tonPorTipo[tipo] += peso
        vehiculosPorTipo[tipo]++
      }
      for (const p of crew) auxPorTipo[tipo].add(p.toUpperCase())

      const d = porDia.get(fecha) ?? { vehiculos: 0, vehiculosPorTipo: porTipoVacio(), aux: new Set<string>(), ton: 0, tonPorTipo: porTipoVacio(), opTolva: 0, tonTolva: 0, auxTolva: new Set<string>(), estimadas: 0 }
      if (esTolva) {
        d.opTolva++
        d.tonTolva += peso
        for (const p of crew) d.auxTolva.add(p.toUpperCase())
      } else {
        d.vehiculos++
        d.vehiculosPorTipo[tipo]++
        d.ton += peso
        d.tonPorTipo[tipo] += peso
        if (estimada) d.estimadas++
        for (const p of crew) d.aux.add(p.toUpperCase())
      }
      porDia.set(fecha, d)

      if (placa && !esTolva) {
        const v = porVehiculo.get(placa) ?? { placa, visitas: 0, visitasPorTipo: porTipoVacio(), ton: 0, primera: fecha, ultima: fecha, aux: new Map<string, number>() }
        v.visitas++
        v.visitasPorTipo[tipo]++
        v.ton += peso
        if (fecha < v.primera) v.primera = fecha
        if (fecha > v.ultima) v.ultima = fecha
        for (const p of crew) v.aux.set(p, (v.aux.get(p) || 0) + 1)
        porVehiculo.set(placa, v)
      }

      const pagoUpper = new Set(pago.map((p) => p.toUpperCase()))
      for (const p of crew) {
        const key = p.toUpperCase()
        let c = porPersona.get(key)
        if (!c) {
          c = nuevoAcc(p)
          porPersona.set(key, c)
        }
        c.plantas.add(planta)
        c.dias.add(fecha)
        // Con quién comparte equipo (para la ficha 360°).
        for (const otro of crew) {
          if (otro.toUpperCase() === key) continue
          const f = c.companeros.get(otro) ?? { veces: 0, ton: 0 }
          f.veces++
          f.ton += tonReal
          c.companeros.set(otro, f)
        }
        if (esTolva) {
          c.operacionesTolva++
          c.tonTolva += tonReal
          c.tonPorTipo.tolva += tonReal
        } else {
          c.vehiculos++
          c.vehiculosPorTipo[tipo]++
          if (placa) {
            c.placas.add(placa)
            const f = c.placasFrec.get(placa) ?? { veces: 0, ton: 0 }
            f.veces++
            f.ton += tonReal
            c.placasFrec.set(placa, f)
          }
          if (estimada) c.ordenesEstimadas++
          c.tonReal += tonReal
          c.tonPorTipo[tipo] += tonReal
          c.tonBruta += peso
          if (pagoUpper.has(key)) c.tonPagada += tonPago
          c.tonPorFecha.set(fecha, (c.tonPorFecha.get(fecha) || 0) + tonReal)
          c.tonPorMes.set(mes, (c.tonPorMes.get(mes) || 0) + tonReal)
        }
        c.detalle.push({ fecha, orden: String(o.ordendecargue || ""), tipooperacion: tipoTxt, tipo, planta, placa, peso: r3(peso), nReal: crew.length, tonReal: r3(tonReal), estimada, crew })
      }
      // Personas en la lista de pago de un VEHÍCULO que NO cargaron: su tonPagada
      // también cuenta, para que la diferencia real−pagada sea completa.
      if (!esTolva) {
        for (const p of pago) {
          const key = p.toUpperCase()
          if (crew.some((cName) => cName.toUpperCase() === key)) continue
          let c = porPersona.get(key)
          if (!c) {
            c = nuevoAcc(p)
            porPersona.set(key, c)
          }
          c.plantas.add(planta)
          c.tonPagada += tonPago
        }
      }
    }

    const topFrecuencia = (m: Map<string, { veces: number; ton: number }>, n: number): Frecuencia[] =>
      [...m.entries()]
        .sort((a, b) => b[1].veces - a[1].veces || b[1].ton - a[1].ton || a[0].localeCompare(b[0]))
        .slice(0, n)
        .map(([nombre, f]) => ({ nombre, veces: f.veces, toneladas: r3(f.ton) }))

    const auxiliares: AuxiliarProductividad[] = []
    for (const c of porPersona.values()) {
      const dias = c.dias.size
      const diasVehiculo = c.tonPorFecha.size
      const asistencia = (asistenciaPorNombre.get(claveNombre(c.persona)) ?? []).sort((a, b) => a.fecha.localeCompare(b.fecha))
      const diasProgCargue = new Set(asistencia.filter((a) => esPuestoCargue(a.puesto)).map((a) => a.fecha))
      const diasProgramadosSinVehiculo = [...diasProgCargue].filter((f) => !c.tonPorFecha.has(f)).length
      auxiliares.push({
        persona: c.persona,
        activo: activoPorNombre.has(c.persona.toUpperCase()) ? activoPorNombre.get(c.persona.toUpperCase())! : true,
        planta: c.plantas.size === 1 ? [...c.plantas][0] : null,
        asistencia,
        diasProgramadosCargue: diasProgCargue.size,
        diasProgramadosSinVehiculo,
        companeros: topFrecuencia(c.companeros, 8),
        placasTop: topFrecuencia(c.placasFrec, 8),
        dias,
        vehiculos: c.vehiculos,
        vehiculosPorTipo: c.vehiculosPorTipo,
        placasDistintas: c.placas.size,
        operacionesTolva: c.operacionesTolva,
        ordenesEstimadas: c.ordenesEstimadas,
        tonReal: r3(c.tonReal),
        tonPorTipo: redondearPorTipo(c.tonPorTipo),
        tonTolva: r3(c.tonTolva),
        tonBrutaParticipada: r3(c.tonBruta),
        tonPorDia: diasVehiculo ? r3(c.tonReal / diasVehiculo) : 0,
        tonPorVehiculo: c.vehiculos ? r3(c.tonReal / c.vehiculos) : 0,
        pctDelTotal: totalToneladas ? r1((c.tonReal / totalToneladas) * 100) : 0,
        tonPagada: r3(c.tonPagada),
        diferenciaRealPagada: r3(c.tonReal - c.tonPagada),
        tonPorFecha: Object.fromEntries([...c.tonPorFecha.entries()].map(([k, v]) => [k, r3(v)])),
        tonPorMes: Object.fromEntries([...c.tonPorMes.entries()].map(([k, v]) => [k, r3(v)])),
        ordenesDetalle: c.detalle.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden.localeCompare(b.orden)),
      })
    }
    // Más toneladas reales en vehículos primero; los de solo tolva quedan después, ordenados por su tolva.
    auxiliares.sort((a, b) => b.tonReal - a.tonReal || b.tonTolva - a.tonTolva || a.persona.localeCompare(b.persona))

    const dias: DiaProductividad[] = [...porDia.entries()]
      .map(([fecha, d]) => ({
        fecha,
        vehiculos: d.vehiculos,
        vehiculosPorTipo: d.vehiculosPorTipo,
        auxiliares: d.aux.size,
        toneladas: r3(d.ton),
        tonPorTipo: redondearPorTipo(d.tonPorTipo),
        tonPorAuxiliar: d.aux.size ? r3(d.ton / d.aux.size) : 0,
        operacionesTolva: d.opTolva,
        tonTolva: r3(d.tonTolva),
        auxiliaresTolva: d.auxTolva.size,
        ordenesEstimadas: d.estimadas,
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    const sumaAuxDia = dias.reduce((s, d) => s + d.auxiliares, 0)

    const vehiculos: VehiculoProductividad[] = [...porVehiculo.values()]
      .map((v) => ({
        placa: v.placa,
        visitas: v.visitas,
        visitasPorTipo: v.visitasPorTipo,
        toneladas: r3(v.ton),
        tonPorVisita: v.visitas ? r3(v.ton / v.visitas) : 0,
        primeraVisita: v.primera,
        ultimaVisita: v.ultima,
        auxiliaresFrecuentes: [...v.aux.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 5)
          .map(([persona, veces]) => ({ persona, veces })),
      }))
      .sort((a, b) => b.visitas - a.visitas || b.toneladas - a.toneladas || a.placa.localeCompare(b.placa))

    return {
      success: true,
      data: {
        desde,
        hasta,
        plantas: emps,
        porUnidad: { ordenes: porUnidad.ordenes, unidades: Math.round(porUnidad.unidades) },
        totalOrdenes,
        ordenesConReal,
        coberturaReal: totalOrdenes ? r1((ordenesConReal / totalOrdenes) * 100) : 0,
        totalToneladas: r3(totalToneladas),
        tonPorTipo: redondearPorTipo(tonPorTipo),
        vehiculosPorTipo,
        auxiliaresPorTipo: { cargue: auxPorTipo.cargue.size, descargue: auxPorTipo.descargue.size, distribucion: auxPorTipo.distribucion.size, tolva: auxPorTipo.tolva.size, otro: auxPorTipo.otro.size },
        operacionesTolva,
        tonTolva: r3(tonTolva),
        auxiliaresTolva: auxPorTipo.tolva.size,
        totalAuxiliares: auxiliares.filter((a) => a.vehiculos > 0).length,
        promedioTonAuxiliarDia: sumaAuxDia ? r3(totalToneladas / sumaAuxDia) : 0,
        auxiliares,
        dias,
        vehiculos,
        meses: [...mesesSet].sort(),
        fechas: [...fechasSet].sort(),
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al calcular la productividad." }
  }
}
