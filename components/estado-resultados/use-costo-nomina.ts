"use client"

import useSWR from "swr"
import { supabase } from "@/lib/supabase-client"
import { getParafiscales } from "@/lib/parafiscales-actions"
import type { ConceptoPrestacion } from "@/lib/prestaciones-activos-actions"

// El 15 y el ultimo dia del mes son el dia de cierre de su quincena (desde el
// piso 2026-08-15): ese dia se paga el "dia pleno" y su excedente de destajo
// NO entra al bono de ESA quincena -- queda diferido a la SIGUIENTE via
// Ajuste Nomina Anterior. MISMO criterio, MISMA fecha de piso, que
// `agrupado_quincena.total_bono_nomina` en scripts/059_archivoplano_reemplazo.sql
// y que `esDiaCierre` en lib/revision-nomina-actions.ts -- si se toca uno,
// tocar los tres.
const PISO_EXCLUSION_DIA_CIERRE = "2026-08-15"
function esDiaCierre(fechaISO: string): boolean {
  if (fechaISO < PISO_EXCLUSION_DIA_CIERRE) return false
  const d = new Date(fechaISO + "T12:00:00Z")
  const dia = d.getUTCDate()
  if (dia === 15) return true
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  return dia === ultimo
}

/** Llave de bucket quincena, formato "yyyy-mmQ1"/"yyyy-mmQ2" -- MISMO formato
 * que ya usaba `excBucket` de este archivo (persona + este sufijo). */
function bucketQuincena(anio: number, mes: number, quincena: 1 | 2): string {
  return `${anio}-${String(mes).padStart(2, "0")}Q${quincena}`
}

/** Todas las quincenas (anio, mes, quincena) cubiertas por [desde, hasta] --
 * `getPeriodoRango` SIEMPRE alinea el rango a fronteras de quincena (1-15,
 * 16-fin), así que basta recorrer mes a mes entre las dos fechas. */
function quincenasEnRango(desde: string, hasta: string): Array<{ anio: number; mes: number; quincena: 1 | 2 }> {
  const out: Array<{ anio: number; mes: number; quincena: 1 | 2 }> = []
  const [ay, am] = desde.slice(0, 7).split("-").map(Number)
  const [by, bm] = hasta.slice(0, 7).split("-").map(Number)
  const diaDesde = Number(desde.slice(8, 10))
  const diaHasta = Number(hasta.slice(8, 10))
  let y = ay
  let m = am
  while (y < by || (y === by && m <= bm)) {
    const esPrimerMes = y === ay && m === am
    const esUltimoMes = y === by && m === bm
    const incluyeQ1 = !esPrimerMes || diaDesde <= 15
    const incluyeQ2 = !esUltimoMes || diaHasta > 15
    if (incluyeQ1) out.push({ anio: y, mes: m, quincena: 1 })
    if (incluyeQ2) out.push({ anio: y, mes: m, quincena: 2 })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/**
 * Porcentajes regulatorios usados en Colombia para calcular las
 * provisiones a partir del valor liquidado de nomina del periodo.
 *
 * Centralizados aqui para que tanto el hook (calculos numericos) como
 * la seccion presentacional (etiquetas en la UI) los compartan y nunca
 * se desincronicen.
 */
export const PROVISIONES_PRESTACIONES = {
  cesantias: 0.0833, // 8.33%
  interesesCesantias: 0.01, // 1%
  prima: 0.0833, // 8.33% (igual a cesantias)
  vacaciones: 0.0417, // 4.17%
} as const

// Seguridad social YA NO es un % plano estimado -- se reemplazo por el aporte
// patronal REAL (pension+ARL+caja+salud patronal+SENA+ICBF), calculado mes a
// mes con `getParafiscales` (lib/parafiscales-actions.ts), ya validado al
// 100% contra las 7 planillas reales de Aportes en Linea (ver memoria
// lipgo-parafiscales-pila-reconciliacion). Confirmado por el usuario
// 2026-09-07: "el costo de nomina debe ser el real, como se pago... de lo
// contrario seria ineficaz el estado de resultados". Se deja esta constante
// SOLO como referencia legal en la UI (ya no se usa para calcular).
export const PROVISIONES_SEG_SOCIAL_REFERENCIA = {
  pensionEmpresa: 0.12, // 12%
  cajaCompensacion: 0.04, // 4%
  arl: 0.0244, // 2.44% (varia por clase de riesgo; esto es solo referencial)
} as const

export interface ProvisionesPrestaciones {
  cesantias: number
  interesesCesantias: number
  prima: number
  vacaciones: number
  total: number
}

export interface ProvisionesSegSocial {
  /** Aporte patronal REAL de pension (getParafiscales.resumen.pensionEmpleador). */
  pensionEmpresa: number
  /** Aporte patronal REAL de Caja de Compensacion (resumen.caja). */
  cajaCompensacion: number
  /** Aporte patronal REAL de ARL (resumen.arl). */
  arl: number
  /** Salud patronal + SENA + ICBF reales -- normalmente $0 por la exoneracion
   * del art. 114-1 (E.T.), pero puede ser mayor a $0 si hay salarios altos. */
  otros: number
  total: number
}

/** Meses (anio, mes) cubiertos por [desde, hasta], con la FRACCION de ese mes
 * que cae dentro del rango (1 = mes completo; <1 = quincena o rango parcial).
 * `getParafiscales` solo calcula MESES completos, asi que un rango de
 * quincena se resuelve prorrateando el aporte real del mes completo por la
 * fraccion de dias que corresponde -- mas preciso que un % plano estimado,
 * aunque no es "el real exacto de esos 15 dias" (Aportes en Linea no se
 * radica por quincena).
 */
function mesesEnRango(desde: string, hasta: string): Array<{ anio: number; mes: number; fraccion: number }> {
  const out: Array<{ anio: number; mes: number; fraccion: number }> = []
  const [ay, am] = desde.slice(0, 7).split("-").map(Number)
  const [by, bm] = hasta.slice(0, 7).split("-").map(Number)
  let y = ay
  let m = am
  while (y < by || (y === by && m <= bm)) {
    const diasMes = new Date(y, m, 0).getDate()
    const diaDesde = y === ay && m === am ? Number(desde.slice(8, 10)) : 1
    const diaHasta = y === by && m === bm ? Number(hasta.slice(8, 10)) : diasMes
    const fraccion = Math.max(0, diaHasta - diaDesde + 1) / diasMes
    if (fraccion > 0) out.push({ anio: y, mes: m, fraccion })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/** Si [desde,hasta] queda TOTALMENTE dentro de un periodo de
 * `prestaciones_activos_pagos` ya marcado 'pagada' para ese concepto, suma el
 * valor REAL (valor_real si se ajustó, si no valor_calculado) de esas
 * personas, prorrateado por la fraccion de dias que [desde,hasta] cubre
 * dentro del periodo pagado. Devuelve null si no hay cobertura completa (el
 * llamador debe usar la provision estimada como respaldo). */
async function obtenerPrestacionRealSiPagada(
  ids: number[],
  concepto: ConceptoPrestacion,
  desde: string,
  hasta: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("prestaciones_activos_pagos")
    .select("idempresa, periodo_desde, periodo_hasta, valor_real, valor_calculado, estado")
    .eq("concepto", concepto)
    .eq("estado", "pagada")
    .in("idempresa", ids)
    .lte("periodo_desde", desde)
    .gte("periodo_hasta", hasta)
  if (error || !data || data.length === 0) return null
  // Todas las filas encontradas ya cumplen periodo_desde<=desde y
  // periodo_hasta>=hasta (cobertura completa) por el filtro de arriba.
  let total = 0
  for (const r of data as any[]) {
    const diasPeriodo = Math.round((Date.parse(r.periodo_hasta) - Date.parse(r.periodo_desde)) / 86_400_000) + 1
    const diasRango = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1
    const fraccion = diasPeriodo > 0 ? Math.min(1, diasRango / diasPeriodo) : 0
    total += (Number(r.valor_real) || Number(r.valor_calculado) || 0) * fraccion
  }
  return total
}

/** Suma el aporte patronal REAL (Parafiscales) de todas las empresas en
 * `ids`, para cada mes cubierto por [desde, hasta], prorrateado si el rango
 * no cubre el mes completo (quincena). */
async function calcularSegSocialReal(ids: number[], desde: string, hasta: string): Promise<ProvisionesSegSocial> {
  const meses = mesesEnRango(desde, hasta)
  let pensionEmpresa = 0, cajaCompensacion = 0, arl = 0, otros = 0
  for (const { anio, mes, fraccion } of meses) {
    for (const id of ids) {
      const r = await getParafiscales(id, anio, mes)
      if (!r.success || !r.resumen) continue
      pensionEmpresa += r.resumen.pensionEmpleador * fraccion
      cajaCompensacion += r.resumen.caja * fraccion
      arl += r.resumen.arl * fraccion
      otros += (r.resumen.saludEmpleador + r.resumen.sena + r.resumen.icbf) * fraccion
    }
  }
  return { pensionEmpresa, cajaCompensacion, arl, otros, total: pensionEmpresa + cajaCompensacion + arl + otros }
}

export interface CostoNominaData {
  /** Suma de pagonomina.total_liquidado_dia en el rango (base + bono destajo). */
  totalLiquidado: number
  /** Numero de registros (filas-dia) usados para calcular el total. */
  registros: number
  /** Provisiones de prestaciones sociales calculadas sobre `totalLiquidado`. */
  prestaciones: ProvisionesPrestaciones
  /** Provisiones de seguridad social calculadas sobre `totalLiquidado`. */
  segSocial: ProvisionesSegSocial
  /** Bonos APROBADOS del modulo Bonos (43/50/66, bonos_nomina). NO generan
   * provision (son "no prestacionales" por definicion — no cotizan IBC),
   * pero SI son costo real pagado: se suman al costo total, igual que en
   * el archivo plano (rama propia, aparte de la novedad 52-). */
  bonosNoPrestacionales: number
  /** Costo total = nomina + prestaciones.total + segSocial.total + bonosNoPrestacionales */
  costoTotal: number
}

interface UseCostoNominaArgs {
  /** Proyectos del alcance: uno solo, o todos los accesibles ("Todos LIP"). */
  ids: number[]
  desde: string
  hasta: string
}

/**
 * Lee `pagonomina` filtrando por empresa y rango (`fecha` es DATE puro,
 * por eso usamos `gte`/`lte` con el dia inclusive sin necesidad de
 * `hastaExclusivo`), suma `total_liquidado_dia` y calcula sobre ese
 * total las provisiones de prestaciones sociales y seguridad social
 * con los porcentajes regulatorios definidos arriba.
 */
export function useCostoNomina({
  ids,
  desde,
  hasta,
}: UseCostoNominaArgs) {
  const key =
    ids.length === 0
      ? null
      : (["estado-resultados:nomina", ids.join(","), desde, hasta] as const)

  const { data, error, isLoading, mutate } = useSWR<CostoNominaData>(
    key,
    async () => {
      // -----------------------------------------------------------------
      // Mismo principio que el fix de la tarjeta "Total liquidado del mes"
      // en nominapersonal: el total DEBE corresponder EXACTAMENTE a todas
      // las filas que pasan el filtro. Aqui la query ya filtra por empresa
      // y rango en el servidor, pero Supabase corta a 1000 filas por
      // defecto (PostgREST `max-rows`), asi que para empresas con varios
      // empleados un mes completo puede truncarse silenciosamente y el
      // costo de nomina queda subestimado en el estado de resultados.
      //
      // Solucion: paginar con `.range(...)` en bloques de 1000 hasta que
      // no lleguen mas filas. Asi el `reduce` posterior trabaja sobre el
      // 100% del dataset filtrado, igual que en nomina personal.
      // -----------------------------------------------------------------
      const PAGE_SIZE = 1000
      const allRows: Array<{
        persona: string | null
        fecha: string | null
        bonif_prestacional: number | null
        total_liquidado_dia: number | null
      }> = []
      let offset = 0
      // Tope defensivo contra loops infinitos. Con el alcance "Todos los
      // proyectos" + "Todo el anio" pueden ser ~150k filas-dia (4 proyectos
      // x ~100 personas x 365 dias), asi que 300k da margen de sobra.
      const MAX_ROWS = 300_000

      while (offset < MAX_ROWS) {
        // Filtramos por `idempresaliquidacion` (empresa contratante de la
        // liquidacion), igual que la pestana "Ver Liquidacion" del modulo
        // Nominapersonal. Asi la tarjeta "Total liquidado del mes" y el
        // costo de nomina del estado de resultados muestran exactamente
        // el mismo total para una misma empresa y periodo.
        const { data: pageData, error: pageError } = await supabase
          .rpc("pagonomina_rango", { p_desde: desde, p_hasta: hasta })
          .select("persona, fecha, bonif_prestacional, total_liquidado_dia")
          .in("idempresaliquidacion", ids)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("persona")
          .order("fecha")
          .range(offset, offset + PAGE_SIZE - 1)

        if (pageError) throw pageError
        // `.rpc()` tipa el resultado como T | T[] porque no sabe que la función
        // devuelve un SET de filas; siempre es un arreglo.
        const page = (pageData ?? []) as typeof allRows
        if (page.length === 0) break

        allRows.push(...page)
        if (page.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      // RETIRADOS (headcount.estado = 'Inactivo') quedan FUERA — MISMO
      // filtro que 059_archivoplano_reemplazo.sql: su nomina pendiente se paga
      // por el submodulo Liquidaciones, no por el plano, asi que no debe
      // contar como costo aqui tampoco. Match por NOMBRE (igual que
      // pagonomina/archivoplano — no hay una llave mas fuerte disponible
      // en `pagonomina.persona`).
      const { data: retirados, error: retiradosError } = await supabase
        .from("headcount")
        .select("nombre")
        .eq("estado", "Inactivo")
      if (retiradosError) throw retiradosError
      const nombresRetirados = new Set(
        (retirados || []).map((h: any) => String(h.nombre || "").trim().toUpperCase()),
      )
      const filasActivas = allRows.filter(
        (r: any) => !nombresRetirados.has(String(r.persona || "").trim().toUpperCase()),
      )

      // Base diaria liquidada (cada dia trabajado = su base, nuevo modelo).
      const totalBase = filasActivas.reduce(
        (acc, r: any) => acc + (Number(r.total_liquidado_dia) || 0),
        0,
      )
      // Bono de productividad = excedente de destajo NETO por (persona, quincena),
      // piso 0 y todo prestacional. Se netea por bucket para no perder los dias bajos
      // ni inflar los altos — mismo criterio que parafiscales y el archivo plano.
      //
      // SOLO DESDE LA QUINCENA DEL 16-JUL-2026: el modelo base+bono arranco
      // ahi (confirmado en el archivo plano: la 1ra quincena de julio siguio
      // con la formula vieja). Antes de esa fecha la columna trae el
      // excedente historico (formula legacy) pero NO se pago como bono:
      // sumarlo inflaria el costo de los meses/quincenas viejas con plata
      // que nunca salio.
      const BONO_DESDE = "2026-07-16"
      const excBucket = new Map<string, number>()
      for (const r of filasActivas) {
        const f = String((r as any).fecha || "")
        if (f.length < 10 || f.slice(0, 10) < BONO_DESDE) continue
        // EXCLUIR EL DIA DE CIERRE (15 o ultimo del mes, desde el piso
        // 2026-08-15): ese dia ya se pago a dia pleno, y su excedente NO
        // entra al bono de ESTA quincena -- queda diferido a la siguiente y
        // se recupera mas abajo via `ajustes_proyeccion` (Ajuste Nomina
        // Anterior). Sin esto, este bucket contaba esa plata en la quincena
        // equivocada.
        if (esDiaCierre(f.slice(0, 10))) continue
        const q = Number(f.slice(8, 10)) <= 15 ? 1 : 2
        const key = String((r as any).persona || "") + "|" + bucketQuincena(Number(f.slice(0, 4)), Number(f.slice(5, 7)), q)
        excBucket.set(key, (excBucket.get(key) || 0) + (Number((r as any).bonif_prestacional) || 0))
      }

      // Ajuste Nomina Anterior APROBADO que aplica a alguna quincena cubierta
      // por [desde, hasta] -- MISMO mecanismo que `ajustes_aplicables` en
      // 059_archivoplano_reemplazo.sql: el excedente del dia de cierre que se
      // excluyo arriba reaparece aqui, sumado al bucket de la quincena
      // SIGUIENTE (positivo o negativo, antes del piso $0 por bucket).
      const periodosEnRango = new Set(
        quincenasEnRango(desde, hasta).map((p) => bucketQuincena(p.anio, p.mes, p.quincena)),
      )
      if (periodosEnRango.size > 0) {
        const { data: ajustes, error: ajustesError } = await supabase
          .from("ajustes_proyeccion")
          .select("persona, idempresa, valor_ajuste, anio_aplica, mes_aplica, quincena_aplica")
          .eq("estado", "aprobado")
          .in("idempresa", ids)
        if (ajustesError) throw ajustesError
        for (const a of ajustes || []) {
          // Mismo filtro de retirados que arriba (y que `ajustes_aplicables`
          // en 059_archivoplano_reemplazo.sql).
          if (nombresRetirados.has(String((a as any).persona || "").trim().toUpperCase())) continue
          const periodo = bucketQuincena(Number((a as any).anio_aplica), Number((a as any).mes_aplica), Number((a as any).quincena_aplica) as 1 | 2)
          if (!periodosEnRango.has(periodo)) continue
          const key = String((a as any).persona || "") + "|" + periodo
          excBucket.set(key, (excBucket.get(key) || 0) + (Number((a as any).valor_ajuste) || 0))
        }
      }

      let totalBono = 0
      for (const v of excBucket.values()) totalBono += Math.max(0, v)
      // Costo real de nomina del periodo = base garantizada + bono neto de destajo.
      // Esta es la base sobre la que se calculan las provisiones abajo — SOLO
      // esto es prestacional (cotiza IBC). Los bonos no prestacionales
      // (43/50/66, mas abajo) se suman DESPUES, sin generar provision.
      const totalLiquidado = totalBase + totalBono

      // BONOS NO PRESTACIONALES (Compensacion > Bonos, modulo aparte de la
      // novedad 52-) — MISMO criterio que la rama propia de archivoplano:
      // solo APROBADOS, retirados fuera. Por definicion NO cotizan IBC (por
      // eso "no prestacional"), asi que NO entran a `totalLiquidado` ni a la
      // base de las provisiones de abajo — se suman directo al costo total.
      const { data: bonosNomina, error: bonosError } = await supabase
        .from("bonos_nomina")
        .select("nombre, valor")
        .eq("estado", "aprobado")
        .in("idempresa", ids)
        .gte("fecha", desde)
        .lte("fecha", hasta)
      if (bonosError) throw bonosError
      const totalBonosNoPrestacionales = (bonosNomina || [])
        .filter((b: any) => !nombresRetirados.has(String(b.nombre || "").trim().toUpperCase()))
        .reduce((acc: number, b: any) => acc + (Number(b.valor) || 0), 0)

      // --- Prestaciones sociales: REAL cuando el periodo ya se pagó ------
      // (módulo "Prestaciones Sociales · Personal Activo", dentro de
      // Parafiscales -- lib/prestaciones-activos-actions.ts). Si [desde,hasta]
      // cae dentro de un periodo YA marcado 'pagada' para ese concepto, se usa
      // el valor real (prorrateado); si no, sigue la provisión legal estimada
      // -- vacaciones sigue siendo provisión (no hay un pago masivo periódico
      // equivalente para personal activo; `vacaciones_liquidaciones` es solo
      // el cash-out al retiro, otro concepto).
      const [cesantiasReal, interesesReal, primaReal] = await Promise.all([
        obtenerPrestacionRealSiPagada(ids, "cesantias", desde, hasta),
        obtenerPrestacionRealSiPagada(ids, "intereses_cesantias", desde, hasta),
        obtenerPrestacionRealSiPagada(ids, "prima", desde, hasta),
      ])
      const cesantias = cesantiasReal ?? totalLiquidado * PROVISIONES_PRESTACIONES.cesantias
      const interesesCesantias = interesesReal ?? totalLiquidado * PROVISIONES_PRESTACIONES.interesesCesantias
      const prima = primaReal ?? totalLiquidado * PROVISIONES_PRESTACIONES.prima
      const vacaciones = totalLiquidado * PROVISIONES_PRESTACIONES.vacaciones
      const totalPrestaciones =
        cesantias + interesesCesantias + prima + vacaciones

      // --- Seguridad social: aporte patronal REAL (ya no % plano) --------
      // `saludEmpleado` (deduccion) y `pensionEmpleado` (deduccion) siguen
      // fuera del P&L (son retencion al trabajador, no costo de la empresa)
      // -- `getParafiscales.resumen` ya las separa igual (pensionEmpleador/
      // saludEmpleador = costo empresa; pensionEmpleado/saludEmpleado =
      // retencion). Incluye a retirados por sus dias TRABAJADOS ese mes (el
      // aporte a Pension/ARL/Caja de esos dias es un costo real ya pagado,
      // aparte de que su nomina PENDIENTE se siga viendo en Liquidaciones).
      const segSocial = await calcularSegSocialReal(ids, desde, hasta)

      const costoTotal = totalLiquidado + totalPrestaciones + segSocial.total + totalBonosNoPrestacionales

      return {
        totalLiquidado,
        registros: filasActivas.length,
        prestaciones: {
          cesantias,
          interesesCesantias,
          prima,
          vacaciones,
          total: totalPrestaciones,
        },
        segSocial,
        bonosNoPrestacionales: totalBonosNoPrestacionales,
        costoTotal,
      }
    },
    {
      // Mantenemos los datos previos visibles mientras llega la nueva
      // peticion para evitar flicker entre quincenas.
      keepPreviousData: true,
      revalidateOnFocus: false,
    },
  )

  return { data, error, isLoading, mutate }
}
