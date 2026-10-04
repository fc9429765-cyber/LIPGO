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
 * SEGURIDAD (2026-10-03): las filas ya NO se leen desde el navegador; las trae
 * lib/finanzas-lectura-actions.ts (sesión + permiso de Estado de Resultados +
 * service role, paginado en el servidor). La agregación sigue aquí, idéntica.
 */

import useSWR from "swr"
import { leerCargosFijosGenerados, leerFacturacionRango, leerFacturacionTurnosRango } from "@/lib/finanzas-lectura-actions"
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

// Suma `columnaValor` y agrupa por `claveDe` (para el drill-down) sobre las
// filas que trae el servidor.
async function sumarYAgrupar(
  leer: () => Promise<Array<Record<string, unknown>>>,
  columnaValor: string,
  claveDe: (r: Record<string, unknown>) => string,
  toneladasDe?: (r: Record<string, unknown>) => number,
): Promise<{ suma: number; filas: number; detalle: DetalleIngreso[] }> {
  const rows = await leer()
  let suma = 0
  const grupos = new Map<string, { valor: number; registros: number; toneladas: number }>()
  for (const r of rows) {
    const v = Number(r[columnaValor]) || 0
    suma += v
    const k = claveDe(r)
    const g = grupos.get(k) ?? { valor: 0, registros: 0, toneladas: 0 }
    g.valor += v
    g.registros += 1
    if (toneladasDe) g.toneladas += toneladasDe(r)
    grupos.set(k, g)
  }
  const detalle: DetalleIngreso[] = Array.from(grupos.entries())
    .map(([nombre, g]) => ({
      nombre,
      valor: g.valor,
      registros: g.registros,
      ...(toneladasDe ? { toneladas: g.toneladas } : {}),
    }))
    .sort((a, b) => b.valor - a.valor)
  return { suma, filas: rows.length, detalle }
}

// Toneladas: aplica la regla de "a quién se factura" de Avimol (id2, confirmada
// por gerencia 2026-08-02) — Cargue/Descargue/Distribución con transporte
// Zamudio/Terceros se factura a esa transportadora, no a Avimol; con placa
// propia (transporte Avimol) va cubierto por el fijo de 600 ton/mes (Cargos
// Fijos), valor=0 aquí para no duplicar. Mismo criterio que getControlFacturacion
// (Cuadro de Control, la fuente canónica) — ver lib/facturacion-billed-party.ts.
// Para los demás proyectos (idempresa !== 2) no cambia nada.
async function sumarYAgruparToneladas(
  ids: number[],
  desde: string,
  hastaExclusivo: string,
): Promise<{ suma: number; filas: number; detalle: DetalleIngreso[] }> {
  // `facturadoAOwner` (vía `esPlacaDistribucion`) lee un caché en memoria que
  // este código -- corriendo en el navegador -- no puede calentar directo
  // (esa función usa el cliente admin de Supabase). Se trae el mapa real por
  // un Server Action serializable y se hidrata el caché antes de usarlo, o
  // esPlacaDistribucion caería siempre al DEFAULT hardcodeado del código.
  const [mapa, rows] = await Promise.all([getMapaPlacasDistribucion(), leerFacturacionRango(ids, desde, hastaExclusivo)])
  hidratarCachePlacas(mapa)

  let suma = 0
  const grupos = new Map<string, { valor: number; registros: number; toneladas: number }>()
  for (const r of rows as Array<Record<string, unknown>>) {
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

  const detalle: DetalleIngreso[] = Array.from(grupos.entries())
    .map(([nombre, g]) => ({ nombre, valor: g.valor, registros: g.registros, toneladas: g.toneladas }))
    .sort((a, b) => b.valor - a.valor)

  return { suma, filas: rows.length, detalle }
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
          () => leerFacturacionTurnosRango(idsVista, desde, hasta),
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
  // montacargas facturado). `periodo` = primer dia del mes. La acción es
  // tolerante a que la tabla aun no exista (devuelve vacío).
  const fijosPromise = sumarYAgrupar(
    () => leerCargosFijosGenerados(ids, "ingreso", desde, hasta),
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
