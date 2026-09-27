"use server"

// Meta de productividad DINAMICA (ton/trabajador/hora) por proyecto.
//
// Reemplaza el HC y la meta fijos de `meta_toneladas_proyecto` (estaticos,
// escritos a mano en Financiera > Tarifas > Metas) por un calculo real por
// dia: cuantos auxiliares de Cargue/Descargue llegaron REALMENTE ese dia
// (registroasistencia, con hora de ingreso real) y cuantas horas tenian
// programadas, para que la meta se ajuste sola cuando el personal real
// cambia — en vez de comparar a todos contra un numero plano fijo.
//
// Alimenta lib/control-toneladas-actions.ts y lib/revision-nomina-actions.ts
// (solo indicador de productividad; NUNCA cambia total_liquidado_dia ni el
// bono, que siguen sobre salario/30). Constantes y helpers sincronos en
// lib/meta-productividad-utils.ts (un archivo "use server" solo puede
// exportar funciones async).

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { TON_MES_CARGUE_DESCARGUE, DIAS_OPERACION_MES, duracionHorasNetas, normNombreMeta, esPuestoCargueDescargue } from "@/lib/meta-productividad-utils"

export interface HcYHorasDia {
  /** Cantidad de auxiliares de Cargue/Descargue con asistencia real ese dia. */
  headcount: number
  /** Suma de horas programadas NETAS (salida - entrada - 1h de almuerzo) de esos auxiliares ese dia. */
  horasTotales: number
}

/**
 * Headcount real + horas programadas del pool de Cargue/Descargue, por
 * (idempresa, fecha), para TODO un rango de fechas de una sola vez —
 * evita N+1 queries en reportes que recorren varios dias (Control de
 * Toneladas, Revision de Nomina). Fuente: registroasistencia — mismo dato
 * que ya escribe Programacion de Turnos (horaentradaprogramada/
 * horasalidaprogramada) y que ya confirma la marcacion real (horaingreso).
 *
 * Incluye SOLO los puestos de Cargue/Distribución confirmados por el
 * usuario (`esPuestoCargueDescargue`, lib/meta-productividad-utils.ts) —
 * excluye producción (Estibado PT, Salvado, Montacargas de producción) y
 * líneas ajenas al acuerdo (Arrume Negro, Huevos, Cosedor, Pacas, etc. en
 * Avimol). También excluye filas de novedad (puesto null), quien no tiene
 * horaingreso real (programado pero no llegó), y el placeholder
 * "SIN AUXILIAR". NO excluye personal de prueba (participan físicamente y
 * dividen tonelaje igual que cualquiera — mismo criterio que
 * control-toneladas-actions.ts).
 *
 * Devuelve un Map con clave `${fecha}|${idempresa}`.
 */
export async function getHcYHorasRealPorDia(
  idsEmpresa: number[],
  desde: string,
  hasta: string,
): Promise<Map<string, HcYHorasDia>> {
  const out = new Map<string, HcYHorasDia>()
  if (!idsEmpresa.length) return out
  const admin: any = await getSupabaseAdmin()
  for (let off = 0; ; off += 1000) {
    const { data, error } = await admin
      .from("registroasistencia")
      .select("idempresa, fecha, nombre, puesto, horaingreso, horaentradaprogramada, horasalidaprogramada")
      .in("idempresa", idsEmpresa)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .not("puesto", "is", null)
      .not("horaingreso", "is", null)
      // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
      .order("id")
      .range(off, off + 999)
    if (error || !data || data.length === 0) break
    for (const r of data) {
      if (!esPuestoCargueDescargue(Number(r.idempresa), r.puesto)) continue
      if (normNombreMeta(r.nombre) === "SIN AUXILIAR") continue
      const key = `${String(r.fecha).slice(0, 10)}|${Number(r.idempresa)}`
      const acc = out.get(key) || { headcount: 0, horasTotales: 0 }
      acc.headcount += 1
      if (r.horaentradaprogramada && r.horasalidaprogramada) {
        acc.horasTotales += duracionHorasNetas(String(r.horaentradaprogramada), String(r.horasalidaprogramada))
      }
      out.set(key, acc)
    }
    if (data.length < 1000) break
  }
  return out
}

/** Headcount real + horas programadas de un solo dia/proyecto (para el ritmo en vivo). */
export async function getHcYHorasRealDia(idempresa: number, fecha: string): Promise<HcYHorasDia> {
  const porDia = await getHcYHorasRealPorDia([idempresa], fecha, fecha)
  return porDia.get(`${fecha}|${idempresa}`) || { headcount: 0, horasTotales: 0 }
}

export interface MetaTonTrabajadorHora {
  fecha: string
  idempresa: number
  metaTonDia: number
  headcount: number
  horasTotales: number
  /** ton/trabajador/hora — 0 si no hay horas reales ese dia (sin programacion cargada aun). */
  metaPorHora: number
}

/** Meta ton/trabajador/hora de un proyecto en un dia especifico, con datos reales de ese dia. */
export async function getMetaTonTrabajadorHora(idempresa: number, fecha: string): Promise<MetaTonTrabajadorHora> {
  const tonMes = TON_MES_CARGUE_DESCARGUE[idempresa] || 0
  const metaTonDia = tonMes / DIAS_OPERACION_MES
  const { headcount, horasTotales } = await getHcYHorasRealDia(idempresa, fecha)
  const metaPorHora = horasTotales > 0 ? metaTonDia / horasTotales : 0
  return { fecha, idempresa, metaTonDia, headcount, horasTotales, metaPorHora }
}
