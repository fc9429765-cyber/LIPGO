"use client"

/**
 * Hook que calcula los INGRESOS del Estado de Resultados para el periodo
 * y el ALCANCE indicado (uno o varios proyectos — `ids`).
 *
 * Fuentes (cada una es una fila expandible en la seccion, con su detalle
 * para drill-down):
 *  - Facturacion de toneladas: `public.facturacion` (idempresa IN ids,
 *    fechacargue en [desde, hastaExclusivo)) → detalle por operacion×owner.
 *  - Facturacion de turnos (vista): `public.facturacionturnos` para los ids
 *    DISTINTOS de 2 → detalle por puesto.
 *  - Produccion, turnos y HE de AVIMOL: si `ids` incluye 2, va como fila
 *    PROPIA desde getConciliacionAvimol (su facturacion real: produccion
 *    aprobada + turnos solicitados/aprobados + horas extra) → detalle en 3
 *    sublineas. La vista facturacionturnos NO se usa para id2 (cobraba por
 *    ejecucion e ignoraba cobraturno).
 *  - Cargos fijos: `cargos_fijos_generados` tipo='ingreso' → detalle por
 *    concepto. Tolerante a que la tabla aun no exista.
 *
 * IMPORTANTE - paginacion obligatoria: Supabase/PostgREST corta toda
 * respuesta en 1000 filas. `facturacion` supera las 7.000 filas por empresa
 * en un anio; sin `.range(...)` el ingreso se truncaba en silencio (68% del
 * 2026 quedaba oculto). Mismo patron de bloques de 1000 que use-costo-nomina.
 */

import useSWR from "swr"
import { supabase } from "@/lib/supabase-client"
import { aplicarOrdenEstable } from "@/lib/orden-paginacion"
import { getConciliacionAvimol } from "@/lib/conciliacion-avimol-actions"
import { getMapaPlacasDistribucion } from "@/lib/facturacion-control-actions"
import { facturadoAOwner } from "@/lib/facturacion-billed-party"
import { hidratarCachePlacas } from "@/lib/distribucion-placas"
import { serviciosAdicionalesDelProyecto } from "@/lib/facturacion-produccion-conceptos"
import { calcularServiciosAdicionalesIndupan } from "@/lib/servicios-adicionales-indupan-actions"

export interface DetalleIngreso {
  nombre: string
  valor: number
  registros: number
  /** Toneladas del grupo cuando aplica (detalle de la fila de toneladas). */
  toneladas?: number
}

export interface IngresosTotales {
  toneladas: number
  turnosVista: number
  turnosConciliacion: number
  /** Servicios Adicionales (Turnos/Horas Extra aprobados) de proyectos que NO
   *  tienen el circuito de conciliación de Avimol -- hoy solo Indupan. Ver
   *  lib/servicios-adicionales-indupan-actions.ts. */
  turnosServiciosAdicionales: number
  fijos: number
  total: number
  conteoToneladas: number
  conteoTurnosVista: number
  /** Dias con datos de la conciliacion (no filas). */
  conteoConciliacion: number
  conteoServiciosAdicionales: number
  conteoFijos: number
  detalleToneladas: DetalleIngreso[]
  detalleTurnosVista: DetalleIngreso[]
  detalleConciliacion: DetalleIngreso[]
  detalleServiciosAdicionales: DetalleIngreso[]
  detalleFijos: DetalleIngreso[]
}

interface UseIngresosArgs {
  /** Proyectos del alcance: uno solo, o todos los accesibles ("Todos LIP"). */
  ids: number[]
  desde: string
  hasta: string
  hastaExclusivo: string
}

// Pagina en bloques de 1000 acumulando la suma de `columnaValor` y grupos
// por `claveDe` (para el drill-down), sin queries extra.
async function sumarYAgrupar(
  aplicarFiltros: (q: any) => any,
  tabla: string,
  select: string,
  columnaValor: string,
  claveDe: (r: Record<string, unknown>) => string,
  toneladasDe?: (r: Record<string, unknown>) => number,
): Promise<{ suma: number; filas: number; detalle: DetalleIngreso[] }> {
  const PAGE_SIZE = 1000
  const MAX_ROWS = 200_000 // tope defensivo; cubre varios anios de 4 proyectos
  let suma = 0
  let filas = 0
  let offset = 0
  const grupos = new Map<string, { valor: number; registros: number; toneladas: number }>()

  while (offset < MAX_ROWS) {
    // Orden único y estable para paginar (ver lib/orden-paginacion.ts).
    const { data: page, error } = await aplicarOrdenEstable(aplicarFiltros(supabase.from(tabla).select(select)), tabla).range(
      offset,
      offset + PAGE_SIZE - 1,
    )
    if (error) throw new Error(`Error al leer ${tabla}: ${error.message}`)
    if (!page || page.length === 0) break

    for (const r of page as Array<Record<string, unknown>>) {
      const v = Number(r[columnaValor]) || 0
      suma += v
      const k = claveDe(r)
      const g = grupos.get(k) ?? { valor: 0, registros: 0, toneladas: 0 }
      g.valor += v
      g.registros += 1
      if (toneladasDe) g.toneladas += toneladasDe(r)
      grupos.set(k, g)
    }
    filas += page.length
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const detalle: DetalleIngreso[] = Array.from(grupos.entries())
    .map(([nombre, g]) => ({
      nombre,
      valor: g.valor,
      registros: g.registros,
      ...(toneladasDe ? { toneladas: g.toneladas } : {}),
    }))
    .sort((a, b) => b.valor - a.valor)

  return { suma, filas, detalle }
}

// Toneladas: variante de sumarYAgrupar que aplica la regla de "a quién se
// factura" de Avimol (id2, confirmada por gerencia 2026-08-02) — Cargue/
// Descargue/Distribución con transporte Zamudio/Terceros se factura a esa
// transportadora, no a Avimol; con placa propia (transporte Avimol) va
// cubierto por el fijo de 600 ton/mes (Cargos Fijos), valor=0 aquí para no
// duplicar. Mismo criterio que getControlFacturacion (Cuadro de Control,
// la fuente canónica) — ver lib/facturacion-billed-party.ts. Para los demás
// proyectos (idempresa !== 2) no cambia nada.
async function sumarYAgruparToneladas(
  ids: number[],
  desde: string,
  hastaExclusivo: string,
): Promise<{ suma: number; filas: number; detalle: DetalleIngreso[] }> {
  const PAGE_SIZE = 1000
  const MAX_ROWS = 200_000
  let suma = 0
  let filas = 0
  let offset = 0
  const grupos = new Map<string, { valor: number; registros: number; toneladas: number }>()

  // `facturadoAOwner` (vía `esPlacaDistribucion`) lee un caché en memoria que
  // este código -- corriendo en el navegador -- no puede calentar directo
  // (esa función usa el cliente admin de Supabase). Se trae el mapa real por
  // un Server Action serializable y se hidrata el caché antes de usarlo, o
  // esPlacaDistribucion caería siempre al DEFAULT hardcodeado del código.
  hidratarCachePlacas(await getMapaPlacasDistribucion())

  while (offset < MAX_ROWS) {
    const { data: page, error } = await supabase
      .from("facturacion")
      .select("valor_a_facturar, tipooperacion, owner, toneladas, transporte, idempresa, placa, subcategoria")
      .in("idempresa", ids)
      .gte("fechacargue", desde)
      .lt("fechacargue", hastaExclusivo)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`Error al leer facturacion: ${error.message}`)
    if (!page || page.length === 0) break

    for (const r of page as Array<Record<string, unknown>>) {
      const fa = facturadoAOwner(
        Number(r.idempresa),
        String(r.owner ?? "SIN OWNER").trim(),
        String(r.tipooperacion ?? ""),
        (r.transporte as string | null) ?? null,
        (r.subcategoria as string | null) ?? null,
        (r.placa as string | null) ?? null,
      )
      const v = fa.cubiertoPorFijo ? 0 : Number(r.valor_a_facturar) || 0
      suma += v
      const k = `${String(r.tipooperacion ?? "(sin operación)").trim()} · ${fa.owner}`
      const g = grupos.get(k) ?? { valor: 0, registros: 0, toneladas: 0 }
      g.valor += v
      g.registros += 1
      g.toneladas += Number(r.toneladas) || 0
      grupos.set(k, g)
    }
    filas += page.length
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const detalle: DetalleIngreso[] = Array.from(grupos.entries())
    .map(([nombre, g]) => ({ nombre, valor: g.valor, registros: g.registros, toneladas: g.toneladas }))
    .sort((a, b) => b.valor - a.valor)

  return { suma, filas, detalle }
}

// Igual, pero TOLERANTE a que la tabla aun no exista (cargos fijos: depende
// de migraciones nuevas). Sin esto, el P&L entero se caeria hasta correrlas.
async function sumarYAgruparTolerante(
  aplicarFiltros: (q: any) => any,
  tabla: string,
  select: string,
  columnaValor: string,
  claveDe: (r: Record<string, unknown>) => string,
): Promise<{ suma: number; filas: number; detalle: DetalleIngreso[] }> {
  try {
    return await sumarYAgrupar(aplicarFiltros, tabla, select, columnaValor, claveDe)
  } catch (e) {
    console.warn(`[estado-resultados] ${tabla} no disponible todavia (¿faltan migraciones?):`, e)
    return { suma: 0, filas: 0, detalle: [] }
  }
}

async function fetchIngresos(
  ids: number[],
  desde: string,
  hasta: string,
  hastaExclusivo: string,
): Promise<IngresosTotales> {
  // id2 (Avimol) va por Conciliación; los proyectos declarados en
  // SERVICIOS_ADICIONALES_POR_PROYECTO (hoy solo Indupan) van por su propio
  // cálculo -- ninguno de los dos por la vista legacy, o el ingreso quedaría
  // duplicado/desactualizado frente a lo realmente facturado.
  const idsVista = ids.filter((i) => i !== 2 && !serviciosAdicionalesDelProyecto(i))
  const incluyeAvimol = ids.includes(2)
  const idIndupanServAd = ids.find((i) => serviciosAdicionalesDelProyecto(i)) ?? null

  // Toneladas: `fechacargue` es timestamp → gte/lt con dia+1 exclusivo.
  const tonsPromise = sumarYAgruparToneladas(ids, desde, hastaExclusivo)

  // Turnos por la vista (todos los ids menos Avimol). `fecha` es DATE puro.
  const turnosPromise =
    idsVista.length > 0
      ? sumarYAgrupar(
          (q) => q.in("idempresa", idsVista).gte("fecha", desde).lte("fecha", hasta),
          "facturacionturnos",
          "facturacion_total, puesto",
          "facturacion_total",
          (r) => String(r.puesto ?? "(sin puesto)").trim(),
        )
      : Promise.resolve({ suma: 0, filas: 0, detalle: [] as DetalleIngreso[] })

  // Avimol: su facturacion real de turnos/produccion/HE es la Conciliacion
  // (mismo motor que la prefactura, para que ambos cuadren).
  const concPromise = incluyeAvimol ? getConciliacionAvimol(desde, hasta) : Promise.resolve(null)

  // Servicios Adicionales (Turnos/Horas Extra aprobados) de proyectos sin el
  // circuito de conciliación de Avimol -- mismo motor que la Prefactura, para
  // que el P&L no diverja de lo realmente facturado (hoy solo Indupan).
  const servAdPromise = idIndupanServAd ? calcularServiciosAdicionalesIndupan(desde, hasta) : Promise.resolve(null)

  // Cargos fijos reconocidos ($2M id1/id3, 600 ton fijas id2, alquiler de
  // montacargas facturado). `periodo` = primer dia del mes.
  const fijosPromise = sumarYAgruparTolerante(
    (q) => q.in("idempresa", ids).eq("tipo", "ingreso").gte("periodo", desde).lte("periodo", hasta),
    "cargos_fijos_generados",
    "valor, concepto",
    "valor",
    (r) => String(r.concepto ?? "(sin concepto)").trim(),
  )

  const [tons, turnos, conc, servAd, fijos] = await Promise.all([
    tonsPromise,
    turnosPromise,
    concPromise,
    servAdPromise,
    fijosPromise,
  ])

  let turnosConciliacion = 0
  let conteoConciliacion = 0
  let detalleConciliacion: DetalleIngreso[] = []
  if (conc) {
    if (!conc.success || !conc.data) {
      throw new Error(`Error al leer la conciliacion de Avimol: ${conc.message || "desconocido"}`)
    }
    const r = conc.data.resumen
    turnosConciliacion = r.cobroTotal
    conteoConciliacion = r.diasConDatos
    detalleConciliacion = [
      {
        nombre: "Producción aprobada (Estibado PT + Salvado)",
        valor: r.cobroProduccion,
        registros: r.diasConDatos,
        toneladas: r.tonTotal,
      },
      { nombre: "Horas extra facturables", valor: r.cobroHorasExtra, registros: Math.round(r.horasExtraEjecutadas) },
      { nombre: "Turnos solicitados y aprobados", valor: r.cobroTurnos, registros: r.turnosCobrados },
    ].filter((d) => d.valor > 0 || d.registros > 0)
  }

  let turnosServiciosAdicionales = 0
  let conteoServiciosAdicionales = 0
  let detalleServiciosAdicionales: DetalleIngreso[] = []
  if (servAd) {
    turnosServiciosAdicionales = servAd.conceptos.reduce((s, c) => s + c.valor, 0)
    conteoServiciosAdicionales = servAd.soporte.length
    detalleServiciosAdicionales = servAd.conceptos.map((c) => ({ nombre: c.concepto, valor: c.valor, registros: 0 }))
  }

  return {
    toneladas: tons.suma,
    turnosVista: turnos.suma,
    turnosConciliacion,
    turnosServiciosAdicionales,
    fijos: fijos.suma,
    total: tons.suma + turnos.suma + turnosConciliacion + turnosServiciosAdicionales + fijos.suma,
    conteoToneladas: tons.filas,
    conteoTurnosVista: turnos.filas,
    conteoConciliacion,
    conteoServiciosAdicionales,
    conteoFijos: fijos.filas,
    detalleToneladas: tons.detalle,
    detalleTurnosVista: turnos.detalle,
    detalleConciliacion,
    detalleServiciosAdicionales,
    detalleFijos: fijos.detalle,
  }
}

export function useIngresos({ ids, desde, hasta, hastaExclusivo }: UseIngresosArgs) {
  const key = ids.length > 0 ? (["estado-resultados:ingresos", ids.join(","), desde, hasta] as const) : null

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => fetchIngresos(ids, desde, hasta, hastaExclusivo),
    {
      // El periodo cambia poco; no necesitamos refrescar con foco.
      revalidateOnFocus: false,
      keepPreviousData: true,
    },
  )

  return {
    data,
    isLoading,
    error: error as Error | undefined,
    refrescar: mutate,
  }
}
