"use server"

// Control de Toneladas (Operación LIP): vista OPERATIVA para el coordinador —
// toneladas por día y acumuladas por trabajador, para gestionar personal (quién
// mueve menos, quién es más eficiente, qué vehículos atendió). NO es un módulo
// de pago: reutiliza la MISMA fórmula que ya paga nómina (pesoBaseCalculo +
// reparto igualitario de cabeceraoc.auxiliares), para que el número que ve el
// coordinador nunca diverja del que ya usa Revisión de Nómina.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { pesoBaseCalculo, excluirAvimolDistribucion, liquidable, normalizeName } from "@/lib/nomina-calculo-utils"
import { getHcYHorasRealPorDia } from "@/lib/meta-productividad-actions"
import { codigosOrdenPorUnidad } from "@/lib/ordenes-por-unidad"
import { TON_MES_CARGUE_DESCARGUE, DIAS_OPERACION_MES, duracionHorasNetas } from "@/lib/meta-productividad-utils"

// A diferencia de nómina (Revisión de Nómina, PILA, Bonos), aquí NO se
// excluyen los "auxiliares de PRUEBA": a ellos se les paga aparte ("de una"),
// pero sí participan físicamente en la operación y dividen el tonelaje de la
// orden igual que cualquiera — excluirlos de este reporte le ocultaría al
// coordinador parte real de lo programado/movido ese día. Por eso este
// archivo, a propósito, NO importa ningún filtro de nombre "prueba".

const num = (v: any) => Number(v || 0)
const round3 = (v: number) => Math.round(v * 1000) / 1000

export interface OrdenTrabajador {
  fecha: string
  orden: string
  tipooperacion: string
  planta: number
  placa: string | null
  // Puesto donde quedó PROGRAMADO ese día (Programación de Turnos →
  // registroasistencia.puesto). null si no hubo programación ese día/persona.
  puesto: string | null
  tonPersona: number
  // Trazabilidad: quién asignó REALMENTE el coordinador a esta orden
  // (cabeceraoc.auxiliares_real) — en pago 'global' puede diferir de con
  // quién se repartió el tonelaje (auxiliares), que es lo que da tonPersona.
  personalReal: string[]
}

export interface TonPorDia {
  fecha: string
  toneladas: number
  vehiculos: string[]
}

export interface TrabajadorToneladas {
  persona: string
  // Activo HOY en Head Count (liquidable). false = ya se retiró / quedó inactivo
  // DESPUÉS del periodo consultado — su tonelaje histórico se sigue mostrando
  // (es un reporte de periodos pasados, no la nómina a pagar hoy), solo se
  // marca para que el coordinador sepa que esa persona ya no está.
  activo: boolean
  // Proyecto principal si solo trabajó en uno; null si trabajó en varios en el periodo.
  planta: number | null
  diasTrabajados: number
  tonAcumulada: number
  tonPromedioDia: number
  // Meta ton/trabajador/día (0 si el/los proyecto(s) no tienen Meta configurada).
  metaDia: number
  // % de tonPromedioDia sobre metaDia (0 si no hay meta) — "más eficiente" = mayor %.
  pctCumplimiento: number
  vehiculos: string[]
  ordenes: OrdenTrabajador[]
  tonPorDia: TonPorDia[]
}

export interface ControlToneladasData {
  trabajadores: TrabajadorToneladas[]
  totalToneladas: number
  totalTrabajadores: number
  /** Órdenes por unidad (Huevos / Empaque MP) del periodo: fuera de las toneladas, se informan aparte. */
  porUnidad: { ordenes: number; unidades: number }
  periodoDesde: string
  periodoHasta: string
}

export async function getControlToneladas(
  idempresa: number | null, // null = todo LIP (1-4)
  desde: string,
  hasta: string,
): Promise<{ success: boolean; data?: ControlToneladasData; message?: string }> {
  try {
    if (!desde || !hasta) return { success: false, message: "Rango de fechas requerido (desde y hasta)." }
    const admin: any = await getSupabaseAdmin()
    const emps = idempresa != null && [1, 2, 3, 4].includes(idempresa) ? [idempresa] : [1, 2, 3, 4]

    // 1) Órdenes del periodo, FINALIZADAS — mismo universo que pagonomina
    //    (liquida por fechacargue de órdenes con fincargue). Paginado (tope 1000).
    //    "proyeccion" excluido — residuo de un módulo manual descontinuado en
    //    jul-2026, nunca fue tonelaje real (ver scripts/053_pagonomina_reemplazo.sql).
    const ordenesRaw: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("cabeceraoc")
        .select("id, ordendecargue, fechacargue, idempresa, tipooperacion, pesovascula, pesoorden, auxiliares, auxiliares_real, placa")
        .in("idempresa", emps)
        .gte("fechacargue", desde)
        .lte("fechacargue", hasta)
        .not("fincargue", "is", null)
        .neq("tipooperacion", "proyeccion")
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      if (!data || data.length === 0) break
      ordenesRaw.push(...data)
      if (data.length < 1000) break
    }

    // 2) Head Count de los proyectos filtrados — SOLO para saber quién sigue
    //    activo hoy (badge informativo) y tener el nombre canónico. NO decide
    //    si una persona aparece en el reporte: este es un reporte de un periodo
    //    PASADO, así que alguien que se retiró después sigue contando su
    //    tonelaje real (igual que hace Conciliación báscula↔pago en nómina).
    const activoPorNombre = new Map<string, boolean>()
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("headcount")
        .select("nombre, idempresa, estado, contratosiigo, fecha_retiro")
        .in("idempresa", emps)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      for (const r of data || []) {
        const persona = String(r.nombre || "").trim()
        if (!persona) continue
        activoPorNombre.set(persona.toUpperCase(), liquidable(r))
      }
      if (!data || data.length < 1000) break
    }

    // 3) Meta DINÁMICA ton/trabajador/hora por (fecha, proyecto) — real,
    //    a partir del headcount con asistencia real de ese día (ver
    //    lib/meta-productividad-actions.ts). Reemplaza la meta plana fija
    //    que antes venía de Financiera › Tarifas › Metas.
    const hcHorasPorDia = await getHcYHorasRealPorDia(emps, desde, hasta)
    const metaPorHoraPorDia = new Map<string, number>()
    for (const [key, { horasTotales }] of hcHorasPorDia) {
      const emp = Number(key.split("|")[1])
      const metaTonDia = (TON_MES_CARGUE_DESCARGUE[emp] || 0) / DIAS_OPERACION_MES
      metaPorHoraPorDia.set(key, horasTotales > 0 ? metaTonDia / horasTotales : 0)
    }

    // 3b) Puesto y horas PROGRAMADAS de cada persona ese día — mismo cruce
    //    (idempresa|fecha|nombre normalizado) que ya usa Revisión de Nómina
    //    en getAuxiliaresVsAsistencia, contra registroasistencia.puesto
    //    (Programación de Turnos). cabeceraoc no trae esta info.
    const puestoMap = new Map<string, string>()
    const horasPersonaPorDia = new Map<string, number>()
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("registroasistencia")
        .select("nombre, idempresa, fecha, puesto, horaentradaprogramada, horasalidaprogramada")
        .in("idempresa", emps)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      for (const r of data || []) {
        if (!r.puesto) continue
        const key = `${Number(r.idempresa)}|${String(r.fecha).slice(0, 10)}|${normalizeName(r.nombre)}`
        if (!puestoMap.has(key)) puestoMap.set(key, r.puesto)
        if (!horasPersonaPorDia.has(key) && r.horaentradaprogramada && r.horasalidaprogramada) {
          horasPersonaPorDia.set(key, duracionHorasNetas(String(r.horaentradaprogramada), String(r.horasalidaprogramada)))
        }
      }
      if (!data || data.length < 1000) break
    }

    // 4) Procesar órdenes: reparto EXACTO de nómina (peso base ÷ n auxiliares).
    type Acc = {
      persona: string
      activo: boolean
      plantas: Set<number>
      tonAcumulada: number
      vehiculos: Set<string>
      ordenes: OrdenTrabajador[]
      tonPorDiaMap: Map<string, number>
      // Meta INDIVIDUAL de esa persona ese día = meta/hora del proyecto ese
      // día × sus horas programadas ese día (0 si no hay programación).
      metaPorDiaMap: Map<string, number>
      vehiculosPorDiaMap: Map<string, Set<string>>
    }
    const porPersona = new Map<string, Acc>()

    // Órdenes por unidad (Huevos / Empaque MP): su "peso" son unidades y ese
    // personal se paga aparte. Fuera de las toneladas; se informan aparte.
    const porUnidadSet = await codigosOrdenPorUnidad(admin, ordenesRaw.map((o: any) => o.ordendecargue))
    const porUnidad = { ordenes: 0, unidades: 0 }

    for (const o of ordenesRaw) {
      const planta = Number(o.idempresa)
      const tipo = String(o.tipooperacion || "").trim()
      if (excluirAvimolDistribucion(planta, tipo)) continue
      if (porUnidadSet.has(String(o.ordendecargue ?? "").trim())) {
        porUnidad.ordenes++
        porUnidad.unidades += num(o.pesovascula) || num(o.pesoorden)
        continue
      }
      const fecha = String(o.fechacargue).slice(0, 10)
      const auxiliares = String(o.auxiliares || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
      const nAux = auxiliares.length
      if (nAux === 0) continue
      const { peso: tonBase } = pesoBaseCalculo(planta, tipo, num(o.pesovascula), num(o.pesoorden))
      if (tonBase <= 0) continue
      const tonPersona = tonBase / nAux
      const placa = o.placa ? String(o.placa).trim() : null
      const personalReal = String(o.auxiliares_real || o.auxiliares || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)

      for (const p of auxiliares) {
        const key = p.toUpperCase()
        let c = porPersona.get(key)
        if (!c) {
          c = {
            persona: p,
            activo: activoPorNombre.has(key) ? activoPorNombre.get(key)! : true,
            plantas: new Set(),
            tonAcumulada: 0,
            vehiculos: new Set(),
            ordenes: [],
            tonPorDiaMap: new Map(),
            metaPorDiaMap: new Map(),
            vehiculosPorDiaMap: new Map(),
          }
          porPersona.set(key, c)
        }
        c.plantas.add(planta)
        c.tonAcumulada += tonPersona
        if (placa) c.vehiculos.add(placa)
        const puesto = puestoMap.get(`${planta}|${fecha}|${normalizeName(p)}`) || null
        c.ordenes.push({ fecha, orden: String(o.ordendecargue || ""), tipooperacion: tipo, planta, placa, puesto, tonPersona: round3(tonPersona), personalReal })
        c.tonPorDiaMap.set(fecha, (c.tonPorDiaMap.get(fecha) || 0) + tonPersona)
        if (!c.metaPorDiaMap.has(fecha)) {
          const horasPersona = horasPersonaPorDia.get(`${planta}|${fecha}|${normalizeName(p)}`) || 0
          const metaPorHoraDia = metaPorHoraPorDia.get(`${fecha}|${planta}`) || 0
          c.metaPorDiaMap.set(fecha, metaPorHoraDia * horasPersona)
        }
        if (placa) {
          if (!c.vehiculosPorDiaMap.has(fecha)) c.vehiculosPorDiaMap.set(fecha, new Set())
          c.vehiculosPorDiaMap.get(fecha)!.add(placa)
        }
      }
    }

    // 5) Armar salida por trabajador, con meta/eficiencia.
    const trabajadores: TrabajadorToneladas[] = []
    let totalToneladas = 0
    for (const c of porPersona.values()) {
      const diasTrabajados = c.tonPorDiaMap.size
      const tonPromedioDia = diasTrabajados > 0 ? c.tonAcumulada / diasTrabajados : 0
      // Meta DINÁMICA: promedio de la meta individual (horas programadas de
      // ESA persona ese día × meta/hora real del proyecto ese día) sobre los
      // días con meta calculable — ya no es un número plano igual para todos.
      const metasDelPeriodo = [...c.metaPorDiaMap.values()].filter((m) => m > 0)
      const metaDia = metasDelPeriodo.length > 0 ? metasDelPeriodo.reduce((a, b) => a + b, 0) / metasDelPeriodo.length : 0
      const pctCumplimiento = metaDia > 0 ? Math.round((tonPromedioDia / metaDia) * 1000) / 10 : 0
      totalToneladas += c.tonAcumulada
      trabajadores.push({
        persona: c.persona,
        activo: c.activo,
        planta: c.plantas.size === 1 ? [...c.plantas][0] : null,
        diasTrabajados,
        tonAcumulada: round3(c.tonAcumulada),
        tonPromedioDia: round3(tonPromedioDia),
        metaDia: round3(metaDia),
        pctCumplimiento,
        vehiculos: [...c.vehiculos].sort(),
        ordenes: c.ordenes.sort((a, b) => a.fecha.localeCompare(b.fecha)),
        tonPorDia: [...c.tonPorDiaMap.entries()]
          .map(([fecha, toneladas]) => ({
            fecha,
            toneladas: round3(toneladas),
            vehiculos: [...(c.vehiculosPorDiaMap.get(fecha) || [])].sort(),
          }))
          .sort((a, b) => a.fecha.localeCompare(b.fecha)),
      })
    }
    // Menor tonelaje primero — el pedido explícito del coordinador.
    trabajadores.sort((a, b) => a.tonAcumulada - b.tonAcumulada)

    return {
      success: true,
      data: {
        trabajadores,
        totalToneladas: round3(totalToneladas),
        totalTrabajadores: trabajadores.length,
        porUnidad: { ordenes: porUnidad.ordenes, unidades: Math.round(porUnidad.unidades) },
        periodoDesde: desde,
        periodoHasta: hasta,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al calcular el control de toneladas." }
  }
}

// El ritmo en vivo por muelle (SLA, proyección de cierre, ocupación real) se
// movió a lib/centro-coordinacion-actions.ts (getCentroCoordinacion) — ahí
// usa el `cabeceraoc.muelle` REAL en vez de la simulación que vivía aquí.
