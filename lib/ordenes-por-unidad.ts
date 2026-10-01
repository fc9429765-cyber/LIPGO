// ÓRDENES POR UNIDAD (Huevos, Empaque MP) — regla compartida.
//
// En Avimol (ID2) los descargues de Huevos (y "Materia Prima" / Empaque MP) se
// facturan y se pagan POR UNIDAD, no por peso: lo que queda en
// `cabeceraoc.pesovascula/pesoorden` son unidades, no toneladas (el 30-sep-2026
// una orden traía "102.000" de peso = unidades). Sumarlas como toneladas
// dispara cualquier indicador. La regla (`esProductoPorUnidad`, por
// subcategoría del producto) ya existía en lib/facturacion-billed-party.ts y
// la aplicaban Centro de Coordinación y el Dashboard de Operación; aquí se
// centraliza la detección para que TODOS los cálculos de tonelaje la usen.
//
// Archivo normal (sin "use server"): lo importan server actions y rutas API.

import { esProductoPorUnidad } from "@/lib/facturacion-billed-party"

const LOTE = 300

/** Subcategoría por nombre de producto, en lotes (evita URLs demasiado largas). */
async function subcategoriasPorProducto(sb: any, nombres: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const unicos = Array.from(new Set(nombres.map((n) => String(n ?? "").trim()).filter(Boolean)))
  for (let i = 0; i < unicos.length; i += LOTE) {
    const { data } = await sb.from("productos").select("nombre, subcategoria").in("nombre", unicos.slice(i, i + LOTE))
    for (const p of data ?? []) out.set(String(p.nombre ?? "").trim(), p.subcategoria)
  }
  return out
}

/**
 * Códigos (`cabeceraoc.ordendecargue`) de las órdenes que tienen al menos un
 * producto por unidad. Falla-abierto: si no se puede consultar, devuelve vacío
 * (el cálculo sigue como antes en vez de romperse).
 */
export async function codigosOrdenPorUnidad(sb: any, codigos: Array<string | null | undefined>): Promise<Set<string>> {
  const lista = Array.from(new Set(codigos.map((c) => String(c ?? "").trim()).filter(Boolean)))
  const resultado = new Set<string>()
  if (lista.length === 0) return resultado
  try {
    const productosPorOrden = new Map<string, Set<string>>()
    for (let i = 0; i < lista.length; i += LOTE) {
      const { data, error } = await sb.from("detalleoc").select("numeroorden, producto").in("numeroorden", lista.slice(i, i + LOTE))
      if (error) throw error
      for (const d of data ?? []) {
        const on = String(d.numeroorden ?? "").trim()
        const prod = String(d.producto ?? "").trim()
        if (!on || !prod) continue
        if (!productosPorOrden.has(on)) productosPorOrden.set(on, new Set())
        productosPorOrden.get(on)!.add(prod)
      }
    }
    const sub = await subcategoriasPorProducto(sb, Array.from(productosPorOrden.values()).flatMap((s) => Array.from(s)))
    for (const [on, prods] of productosPorOrden) {
      for (const p of prods) {
        if (esProductoPorUnidad(sub.get(p))) {
          resultado.add(on)
          break
        }
      }
    }
  } catch (e: any) {
    console.error("[v0] codigosOrdenPorUnidad:", e?.message ?? e)
  }
  return resultado
}

/** Igual que `codigosOrdenPorUnidad` pero por `cabeceraoc.id` (detalleoc.idorden). */
export async function idsOrdenPorUnidad(sb: any, ids: Array<number | null | undefined>): Promise<Set<number>> {
  const lista = Array.from(new Set(ids.map((i) => Number(i)).filter((n) => Number.isFinite(n) && n > 0)))
  const resultado = new Set<number>()
  if (lista.length === 0) return resultado
  try {
    const productosPorOrden = new Map<number, Set<string>>()
    for (let i = 0; i < lista.length; i += LOTE) {
      const { data, error } = await sb.from("detalleoc").select("idorden, producto").in("idorden", lista.slice(i, i + LOTE))
      if (error) throw error
      for (const d of data ?? []) {
        const id = Number(d.idorden)
        const prod = String(d.producto ?? "").trim()
        if (!id || !prod) continue
        if (!productosPorOrden.has(id)) productosPorOrden.set(id, new Set())
        productosPorOrden.get(id)!.add(prod)
      }
    }
    const sub = await subcategoriasPorProducto(sb, Array.from(productosPorOrden.values()).flatMap((s) => Array.from(s)))
    for (const [id, prods] of productosPorOrden) {
      for (const p of prods) {
        if (esProductoPorUnidad(sub.get(p))) {
          resultado.add(id)
          break
        }
      }
    }
  } catch (e: any) {
    console.error("[v0] idsOrdenPorUnidad:", e?.message ?? e)
  }
  return resultado
}

/** Resumen aparte para mostrar "Huevos (por unidad)" como tarjeta pequeña. */
export interface ResumenPorUnidad {
  ordenes: number
  /** Suma de lo registrado como "peso" en esas órdenes: son UNIDADES, no toneladas. */
  unidades: number
}
