"use client"

import useSWR from "swr"
import { leerCargosFijosGenerados, leerGastosRango } from "@/lib/finanzas-lectura-actions"

/**
 * Fila agregada por categoria. La UI renderiza una fila por cada elemento
 * y al final una fila "Total gastos".
 */
export interface CategoriaRow {
  categoria: string
  total: number
  cantidad: number
}

export interface GastosResumen {
  porCategoria: CategoriaRow[]
  total: number
  cantidadTotal: number
}

interface Args {
  /** Proyectos del alcance: uno solo, o todos los accesibles ("Todos LIP"). */
  ids: number[]
  desde: string
  hasta: string
}

/**
 * useGastosPorCategoria - Trae todos los gastos del periodo (filtrados por
 * id_empresa) y los agrega por categoria en cliente. La tabla `gastos`
 * usa `id_empresa` (snake_case) y `fecha` (DATE), distinto del resto de
 * tablas del estado de resultados.
 *
 * SEGURIDAD (2026-10-03): las filas las trae lib/finanzas-lectura-actions.ts
 * (sesión + permiso + service role); el navegador ya no consulta `gastos` ni
 * `cargos_fijos_generados` directo. La agregación en memoria es la misma.
 */
export function useGastosPorCategoria({
  ids,
  desde,
  hasta,
}: Args) {
  const swrKey =
    ids.length === 0
      ? null
      : (["estado-resultados:gastos", ids.join(","), desde, hasta] as const)

  const { data, error, isLoading } = useSWR<GastosResumen>(
    swrKey,
    async () => {
      // Alquiler de montacargas: gasto FIJO calculado (no registrado a mano
      // en `gastos`), ver lib/cargos-fijos-actions.ts. Aplica a id1/id2/id3
      // (los tres pagan el alquiler; solo id1/id3 lo facturan aparte, pero
      // el GASTO es el mismo en los tres). Mismo filtro de periodo que el
      // resto del hook: `periodo` es el primer dia del mes. La acción es
      // tolerante a que la tabla aun no exista (devuelve vacío).
      const [rows, fijosRows] = await Promise.all([leerGastosRango(ids, desde, hasta), leerCargosFijosGenerados(ids, "gasto", desde, hasta)])

      // Agregamos por categoria en memoria. Usamos un Map para preservar
      // orden de insercion estable.
      const acc = new Map<string, { total: number; cantidad: number }>()
      let total = 0
      let cantidadTotal = 0

      for (const r of rows ?? []) {
        const cat = (r.categoria ?? "Sin categoria").toString()
        const monto = Number(r.monto) || 0
        const cur = acc.get(cat) ?? { total: 0, cantidad: 0 }
        cur.total += monto
        cur.cantidad += 1
        acc.set(cat, cur)
        total += monto
        cantidadTotal += 1
      }

      const totalMontacargas = (fijosRows ?? []).reduce((a, r) => a + (Number(r.valor) || 0), 0)
      if (totalMontacargas > 0) {
        acc.set("Alquiler de montacargas", { total: totalMontacargas, cantidad: (fijosRows ?? []).length })
        total += totalMontacargas
        cantidadTotal += (fijosRows ?? []).length
      }

      const porCategoria: CategoriaRow[] = Array.from(acc.entries())
        .map(([categoria, v]) => ({
          categoria,
          total: v.total,
          cantidad: v.cantidad,
        }))
        // Orden descendente por monto: el usuario ve primero lo que mas pesa.
        .sort((a, b) => b.total - a.total)

      return { porCategoria, total, cantidadTotal }
    },
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
    },
  )

  return {
    data,
    error: error as Error | undefined,
    isLoading,
  }
}
