import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { liquidable } from "@/lib/nomina-calculo-utils"
import { exigirSesionApi } from "@/lib/puerta-api"

/**
 * Evaluaciones de Desempeno - Alertas de pendientes.
 *
 * Politica de evaluacion (requerimiento de negocio):
 *  - Primera evaluacion: fecha de ingreso (headcount.fechainicio) + 1 mes.
 *  - Evaluaciones siguientes: ultima evaluacion + 1 anio.
 *
 * Un colaborador esta "pendiente" cuando la fecha de su PROXIMA evaluacion
 * ya vencio (o no se puede calcular por falta de datos).
 *
 * Siempre se filtra por la empresa seleccionada (idempresa).
 */
export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")

    if (!empresaId) {
      return NextResponse.json({ alerts: [], count: 0 })
    }

    const supabase = await createClient()
    const empresaIdNum = parseInt(empresaId, 10)

    // 1) Trae el headcount total de la empresa
    const { data: headcount, error: errHeadcount } = await supabase
      .from("headcount")
      .select("id, nombre, cargo, fechainicio, estado, contratosiigo, fecha_retiro")
      .eq("idempresa", empresaIdNum)
      .order("nombre", { ascending: true })

    if (errHeadcount) {
      console.error("[v0] evaluaciones-alerts: error headcount:", errHeadcount)
      return NextResponse.json({ alerts: [], count: 0 })
    }

    // Solo personal ACTIVO y CONTRATADO: `liquidable()` (lib/nomina-calculo-utils,
    // misma regla que nómina) exige estado != inactivo, sin fecha_retiro y con
    // contratosiigo diligenciado — así los retirados nunca generan una alerta de
    // evaluación pendiente. Aparte, excluye "auxiliares de PRUEBA" por nombre
    // (mismo criterio que `getColaboradoresConUltimaEvaluacion` en
    // evaluaciones-desempeno-actions.ts, la fuente real del módulo: ahí NO se
    // excluye a los auxiliares reales, solo a los de PRUEBA — antes esta ruta
    // excluía a cualquiera con "AUXILIAR" en el nombre, lo que tapaba del badge a
    // la mayoría del personal operativo real) y al registro placeholder literal
    // "SIN AUXILIAR" (headcount id 92, ID4) — no es una persona, es el relleno que
    // usan las órdenes sin auxiliar asignado; tiene contratosiigo fabricado ("13-1")
    // así que sin este filtro pasaba `liquidable()` como si fuera un colaborador real.
    const headcountList = (headcount || []).filter(
      (h) => liquidable(h) && !/prueba/i.test(h.nombre || "") && h.nombre?.trim().toUpperCase() !== "SIN AUXILIAR",
    )
    if (headcountList.length === 0) {
      return NextResponse.json({ alerts: [], count: 0 })
    }

    // 2) Trae las evaluaciones de la empresa para calcular la ultima por colaborador.
    //    Si la tabla no existe (modulo aun sin setup), regresa todos como pendientes.
    const ids = headcountList.map((h) => h.id)
    // Nota: el esquema real usa `created_at` (no existe fecha_evaluacion)
    const { data: evaluaciones, error: errEval } = await supabase
      .from("evaluaciones_desempeno")
      .select("colaborador_id, created_at")
      .in("colaborador_id", ids)
      .order("created_at", { ascending: false })

    // Mapa colaborador_id -> fecha mas reciente
    const ultimaPorColaborador = new Map<number, string>()
    if (!errEval && evaluaciones) {
      for (const e of evaluaciones) {
        if (!ultimaPorColaborador.has(e.colaborador_id)) {
          ultimaPorColaborador.set(e.colaborador_id, e.created_at)
        }
      }
    }

    // 3) Calcular pendientes segun la politica de proxima evaluacion:
    //    - con evaluacion previa: proxima = ultima + 1 anio
    //    - sin evaluacion pero con ingreso: proxima = ingreso + 1 mes
    //    - sin datos: pendiente (no se puede calcular)
    const ahora = Date.now()
    const pendientes = headcountList
      .map((h) => {
        const ultima = ultimaPorColaborador.get(h.id) || null
        const fechaInicio = (h as any).fechainicio || null

        let proxima: Date | null = null
        if (ultima) {
          proxima = new Date(ultima)
          proxima.setFullYear(proxima.getFullYear() + 1)
        } else if (fechaInicio) {
          proxima = new Date(fechaInicio)
          proxima.setMonth(proxima.getMonth() + 1)
        }

        const proximaValida = proxima && !isNaN(proxima.getTime())
        const isPendiente = !proximaValida || (proxima as Date).getTime() < ahora

        let diasDesdeUltima: number | null = null
        if (ultima) {
          diasDesdeUltima = Math.floor((ahora - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24))
        }

        return {
          id: h.id,
          nombre: h.nombre,
          cargo: h.cargo,
          ultima_evaluacion: ultima,
          proxima_evaluacion: proximaValida ? (proxima as Date).toISOString() : null,
          dias_desde_ultima: diasDesdeUltima,
          isPendiente,
        }
      })
      .filter((c) => c.isPendiente)

    // Retornar los primeros 5 para el popover, y el conteo total
    const alerts = pendientes.slice(0, 5).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      cargo: p.cargo,
      ultima_evaluacion: p.ultima_evaluacion,
      proxima_evaluacion: p.proxima_evaluacion,
      dias_desde_ultima: p.dias_desde_ultima,
    }))

    return NextResponse.json({
      alerts,
      count: pendientes.length,
    })
  } catch (error) {
    console.error("[v0] Error in evaluaciones-alerts:", error)
    return NextResponse.json({ alerts: [], count: 0 }, { status: 500 })
  }
}
