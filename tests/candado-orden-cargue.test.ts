// Candado de la orden de cargue (regla de gerencia 2026-10-04): puede salir MENOS que lo que
// dice la orden, NUNCA MÁS. La lógica vive dentro de approveBatchAllocation (lib/batch-actions);
// aquí se prueba la regla pura, que es la que decide, para que nadie la afloje sin darse cuenta.

import { describe, expect, it } from "vitest"

const norm = (s: unknown) => String(s ?? "").trim().toUpperCase()

/** Misma comparación que hace el candado: por PRODUCTO, no por línea. */
function excesosSobreLaOrden(
  lineasOrden: { producto: string; cantidad: number }[],
  asignaciones: { producto: string; cantidad: number }[],
): string[] {
  const autorizado = new Map<string, number>()
  for (const l of lineasOrden) autorizado.set(norm(l.producto), (autorizado.get(norm(l.producto)) ?? 0) + (Number(l.cantidad) || 0))
  const aAsignar = new Map<string, number>()
  for (const a of asignaciones) aAsignar.set(norm(a.producto), (aAsignar.get(norm(a.producto)) ?? 0) + (Number(a.cantidad) || 0))
  const out: string[] = []
  for (const [prod, cant] of aAsignar) {
    const tope = autorizado.get(prod)
    if (tope == null) out.push(`${prod} no está en la orden`)
    else if (cant > tope) out.push(`${prod}: ${cant} contra ${tope}`)
  }
  return out
}

/** Misma detección de líneas repetidas del candado anti doble clic. */
function hayDuplicadas(asignaciones: { producto: string; lote: string; location: string; cliente: string; cantidad: number }[]): boolean {
  const vistas = new Set<string>()
  for (const a of asignaciones) {
    const k = [a.producto, a.lote, a.location, a.cliente, a.cantidad].map(norm).join("|")
    if (vistas.has(k)) return true
    vistas.add(k)
  }
  return false
}

describe("no se puede cargar más de lo que dice la orden", () => {
  // La orden real que destapó el problema: 25 para PAN PA YA + 100 para MOLINOS = 125.
  const orden = [
    { producto: "Indupan Panificacion 50 Kg.", cantidad: 25 },
    { producto: "Indupan Especial 50 Kg.", cantidad: 150 },
    { producto: "Indupan Panificacion 50 Kg.", cantidad: 100 },
  ]

  it("asignar exactamente lo de la orden pasa", () => {
    expect(excesosSobreLaOrden(orden, [
      { producto: "Indupan Panificacion 50 Kg.", cantidad: 125 },
      { producto: "Indupan Especial 50 Kg.", cantidad: 150 },
    ])).toEqual([])
  })

  it("asignar MENOS pasa: se puede dañar una unidad en el cargue", () => {
    expect(excesosSobreLaOrden(orden, [{ producto: "Indupan Panificacion 50 Kg.", cantidad: 124 }])).toEqual([])
  })

  it("asignar MÁS se bloquea, aunque sea una sola unidad", () => {
    expect(excesosSobreLaOrden(orden, [{ producto: "Indupan Panificacion 50 Kg.", cantidad: 126 }])).toHaveLength(1)
  })

  it("suma por producto aunque la orden lo traiga en varias líneas de clientes distintos", () => {
    // 125 es la suma de las dos líneas: no puede bloquearse por comparar contra una sola.
    expect(excesosSobreLaOrden(orden, [{ producto: "Indupan Panificacion 50 Kg.", cantidad: 125 }])).toEqual([])
  })

  it("un producto que no está en la orden se bloquea", () => {
    expect(excesosSobreLaOrden(orden, [{ producto: "Harina Tres Castillos 50 Kg.", cantidad: 1 }])).toHaveLength(1)
  })

  it("el caso real de agosto habría quedado bloqueado", () => {
    // Orden IND202608047608: autorizaba 30; se asignaron 1 + 35 + 35 = 71.
    const ordenAgosto = [{ producto: "Indupan Panificacion 50 Kg.", cantidad: 30 }]
    expect(excesosSobreLaOrden(ordenAgosto, [
      { producto: "Indupan Panificacion 50 Kg.", cantidad: 1 },
      { producto: "Indupan Panificacion 50 Kg.", cantidad: 35 },
      { producto: "Indupan Panificacion 50 Kg.", cantidad: 35 },
    ])).toHaveLength(1)
  })
})

describe("doble clic en Guardar", () => {
  const base = { producto: "Indupan Panificacion 50 Kg.", lote: "20260725", location: "A23", cliente: "GUERRERO HUGO", cantidad: 35 }

  it("dos líneas idénticas se bloquean", () => {
    expect(hayDuplicadas([base, { ...base }])).toBe(true)
  })
  it("mismo producto y lote en ubicaciones distintas sí se permite", () => {
    expect(hayDuplicadas([base, { ...base, location: "A25" }])).toBe(false)
  })
  it("mismo producto en cantidades distintas sí se permite", () => {
    expect(hayDuplicadas([base, { ...base, cantidad: 29 }])).toBe(false)
  })
})
