// El estado del pedido se decide por CANTIDADES, no solo por las banderas de línea
// (gerencia, 2026-10-04). Regla: "un pedido creado no puede despachar más de lo que se creó;
// menos sí, porque se permiten entregas parciales" — y ese faltante debe quedar VISIBLE.
//
// Hasta el 4-oct el estado se calculaba solo con `pedidosdetalle.estado`: si todas las líneas
// estaban "cerrado" el pedido se marcaba "entregado", aunque quedaran unidades sin despachar.
// Medición de ese día: 87 pedidos "entregados" con 17.505 unidades que nunca salieron
// (ID1 14, ID2 41, ID3 32). Caso real: pedido 11221 de Grupo Superdía, con una línea de 150
// bultos de harina precocida cargada en 0, cerrada, y el pedido entero como "entregado".

import { describe, expect, it } from "vitest"

type Linea = { estado: string | null; unidades: number | null; unidadescargadas?: number | null; unidades_cargadas?: number | null }

/** Misma decisión que toma checkAndUpdatePedidoCabeceraStatus. */
function estadoDelPedido(lineas: Linea[]): string | null {
  if (!lineas.length) return null
  const allClosed = lineas.every((l) => l.estado === "cerrado")
  const hasPartial = lineas.some((l) => l.estado === "parcial")
  const faltante = lineas.reduce((s, l) => {
    const ped = Number(l.unidades) || 0
    const car = Number(l.unidadescargadas ?? l.unidades_cargadas ?? 0) || 0
    return s + Math.max(0, ped - car)
  }, 0)
  const completo = faltante <= 0.01
  if (allClosed) return completo ? "entregado" : "entrega parcial"
  if (hasPartial) return "parcial"
  return null
}

describe("estado del pedido según lo que de verdad salió", () => {
  it("cerrado y completo → entregado", () => {
    expect(estadoDelPedido([
      { estado: "cerrado", unidades: 100, unidadescargadas: 100 },
      { estado: "cerrado", unidades: 50, unidadescargadas: 50 },
    ])).toBe("entregado")
  })

  it("el caso real del pedido 11221: cerrado pero con una línea en cero → entrega parcial", () => {
    expect(estadoDelPedido([
      { estado: "cerrado", unidades: 100, unidadescargadas: 100 },
      { estado: "cerrado", unidades: 150, unidadescargadas: 0 },
      { estado: "cerrado", unidades: 50, unidadescargadas: 50 },
    ])).toBe("entrega parcial")
  })

  it("cerrado con un faltante de una sola unidad también es entrega parcial", () => {
    expect(estadoDelPedido([{ estado: "cerrado", unidades: 100, unidadescargadas: 99 }])).toBe("entrega parcial")
  })

  it("una línea marcada parcial manda sobre lo demás", () => {
    expect(estadoDelPedido([
      { estado: "parcial", unidades: 100, unidadescargadas: 60 },
      { estado: null, unidades: 50, unidadescargadas: 0 },
    ])).toBe("parcial")
  })

  it("sin cerrar y sin parciales no cambia el estado", () => {
    expect(estadoDelPedido([{ estado: null, unidades: 100, unidadescargadas: 0 }])).toBeNull()
  })

  it("tolera decimales: 1916,5 pendientes es parcial; una diferencia de centésimas no", () => {
    expect(estadoDelPedido([{ estado: "cerrado", unidades: 2000, unidadescargadas: 83.5 }])).toBe("entrega parcial")
    expect(estadoDelPedido([{ estado: "cerrado", unidades: 100, unidadescargadas: 99.995 }])).toBe("entregado")
  })

  it("usa la columna heredada cuando la nueva viene vacía", () => {
    expect(estadoDelPedido([{ estado: "cerrado", unidades: 80, unidadescargadas: null, unidades_cargadas: 80 }])).toBe("entregado")
  })

  it("despachar de más nunca convierte el pedido en incompleto", () => {
    // No debería ocurrir (hoy son 0 casos), pero el faltante nunca es negativo.
    expect(estadoDelPedido([{ estado: "cerrado", unidades: 100, unidadescargadas: 120 }])).toBe("entregado")
  })
})
