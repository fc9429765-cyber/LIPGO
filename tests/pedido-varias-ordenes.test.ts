// Un pedido puede salir en VARIAS órdenes de cargue (gerencia, 2026-10-04).
// Hasta esa fecha la segunda orden sobrescribía lo cargado por la primera: medido con la
// auditoría, 59 líneas de 56 pedidos dejaron de contar 18.129 unidades que sí salieron del
// inventario (ID1 7, ID2 50, ID3 2). Caso real: pedido 8742 de ID2, línea 17673, 200
// unidades pedidas cargadas en dos órdenes (150 + 50); la línea quedó diciendo 50.

import { describe, expect, it } from "vitest"
import {
  cargadoPorOtrasOrdenes,
  cargadoTrasGuardar,
  estadoDeLinea,
  excedeLoPedido,
  faltantePorDespachar,
  lineaTrasReverso,
  ordenesDelPedido,
  pedidosDeLaOrden,
  totalCargado,
} from "@/lib/pedido-ordenes"

describe("lo cargado de una línea es la suma de sus órdenes", () => {
  it("el caso real del pedido 8742: 150 + 50 son 200, no 50", () => {
    const filas = [
      { ocargue: "AVI202607277242", unidades: 150 },
      { ocargue: "AVI202607277286", unidades: 50 },
    ]
    expect(totalCargado(filas)).toBe(200)
    expect(faltantePorDespachar(200, totalCargado(filas))).toBe(0)
    expect(estadoDeLinea(200, totalCargado(filas), false)).toBe("cerrado")
  })

  it("guardar la segunda orden suma lo de la primera", () => {
    const filas = [{ ocargue: "OC1", unidades: 150 }]
    expect(cargadoTrasGuardar(filas, "OC2", 50)).toBe(200)
  })

  it("volver a guardar la MISMA orden reemplaza, no duplica", () => {
    const filas = [
      { ocargue: "OC1", unidades: 150 },
      { ocargue: "OC2", unidades: 50 },
    ]
    expect(cargadoPorOtrasOrdenes(filas, "OC2")).toBe(150)
    expect(cargadoTrasGuardar(filas, "OC2", 80)).toBe(230)
  })

  it("una sola orden se comporta igual que siempre", () => {
    expect(cargadoTrasGuardar([], "OC1", 120)).toBe(120)
    expect(estadoDeLinea(200, 120, false)).toBe("parcial")
    expect(estadoDeLinea(200, 120, true)).toBe("cerrado")
  })

  it("el faltante nunca es negativo", () => {
    expect(faltantePorDespachar(100, 120)).toBe(0)
  })
})

describe("nunca más de lo pedido", () => {
  it("rechaza el cargue que pasaría de lo pedido sumando las otras órdenes", () => {
    const filas = [{ ocargue: "OC1", unidades: 150 }]
    expect(excedeLoPedido(200, filas, "OC2", 50)).toBe(false)
    expect(excedeLoPedido(200, filas, "OC2", 51)).toBe(true)
  })

  it("completar exactamente lo pedido sí se permite", () => {
    expect(excedeLoPedido(200, [{ ocargue: "OC1", unidades: 100 }], "OC2", 100)).toBe(false)
  })

  it("tolera centésimas de redondeo", () => {
    expect(excedeLoPedido(100, [{ ocargue: "OC1", unidades: 99.995 }], "OC2", 0.01)).toBe(false)
  })

  it("una primera orden sola tampoco puede pasarse", () => {
    expect(excedeLoPedido(50, [], "OC1", 60)).toBe(true)
  })
})

describe("reverso de una sola orden", () => {
  it("si la línea solo salió en esa orden, queda como antes: todo en nulo", () => {
    const r = lineaTrasReverso(200, [{ ocargue: "OC1", unidades: 200 }], "OC1")
    expect(r).toEqual({ cargadas: null, ocargue: null, estado: null, quedanOtrasOrdenes: false })
  })

  it("si salió en dos, conserva lo de la otra y apunta a ella", () => {
    const filas = [
      { ocargue: "OC1", unidades: 150, creadoEn: "2026-07-27T16:00:00Z" },
      { ocargue: "OC2", unidades: 50, creadoEn: "2026-07-27T22:00:00Z" },
    ]
    const r = lineaTrasReverso(200, filas, "OC2")
    expect(r.cargadas).toBe(150)
    expect(r.ocargue).toBe("OC1")
    expect(r.estado).toBe("parcial")
    expect(r.quedanOtrasOrdenes).toBe(true)
  })

  it("al eliminar la primera de tres, apunta a la más reciente que queda", () => {
    const filas = [
      { ocargue: "OC1", unidades: 100, creadoEn: "2026-08-01T10:00:00Z" },
      { ocargue: "OC2", unidades: 60, creadoEn: "2026-08-05T10:00:00Z" },
      { ocargue: "OC3", unidades: 40, creadoEn: "2026-08-09T10:00:00Z" },
    ]
    const r = lineaTrasReverso(200, filas, "OC1")
    expect(r.cargadas).toBe(100)
    expect(r.ocargue).toBe("OC3")
    expect(r.estado).toBe("parcial")
  })

  it("si lo que queda completa el pedido, la línea queda cerrada", () => {
    const filas = [
      { ocargue: "OC1", unidades: 200, creadoEn: "2026-08-01T10:00:00Z" },
      { ocargue: "OC2", unidades: 0, creadoEn: "2026-08-05T10:00:00Z" },
    ]
    expect(lineaTrasReverso(200, filas, "OC2").estado).toBe("cerrado")
  })
})

describe("qué orden se llevó qué parte del pedido", () => {
  it("agrupa por orden, suma unidades y cuenta líneas", () => {
    const datos = new Map([
      ["OC1", { fecha: "2026-08-01", placa: "ABC123", conductor: "Juan" }],
      ["OC2", { fecha: "2026-08-05", placa: "XYZ789", conductor: "Ana" }],
    ])
    const r = ordenesDelPedido(
      [
        { transid: 1, ocargue: "OC1", unidades: 100 },
        { transid: 2, ocargue: "OC1", unidades: 50 },
        { transid: 1, ocargue: "OC2", unidades: 60 },
      ],
      datos,
    )
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ ocargue: "OC1", unidades: 150, lineas: 2, placa: "ABC123" })
    expect(r[1]).toMatchObject({ ocargue: "OC2", unidades: 60, lineas: 1, conductor: "Ana" })
  })

  it("ordena por fecha de la orden", () => {
    const datos = new Map([
      ["B", { fecha: "2026-08-01", placa: null, conductor: null }],
      ["A", { fecha: "2026-08-09", placa: null, conductor: null }],
    ])
    const r = ordenesDelPedido([{ transid: 1, ocargue: "A", unidades: 1 }, { transid: 1, ocargue: "B", unidades: 1 }], datos)
    expect(r.map((o) => o.ocargue)).toEqual(["B", "A"])
  })

  it("sin datos de la orden no falla", () => {
    const r = ordenesDelPedido([{ transid: 1, ocargue: "OC9", unidades: 7 }], new Map())
    expect(r[0]).toMatchObject({ ocargue: "OC9", unidades: 7, fecha: null })
  })
})

// Vista 360 de la orden: qué pedidos atendió. Gerencia (2026-10-05): "toda orden tiene su
// pedido; hoy revisé el ciclo de una orden y me sale sin pedido ligado". Cuando un pedido sale
// en dos órdenes, la línea y la cabecera solo recuerdan UNA (`ocargue` es un solo campo); la
// otra orden vive solo en el libro. Medido: 7 órdenes de los últimos 14 días (2 ID1, 5 ID2).
describe("qué pedidos atendió una orden", () => {
  it("la orden que solo está en el libro sí muestra su pedido, con lo que ella se llevó", () => {
    const r = pedidosDeLaOrden([{ idpedido: 8742, unidades: 50 }], [], [])
    expect(r).toEqual([{ idpedido: 8742, unidades: 50, fuente: "libro" }])
  })

  it("si el pedido está en el libro y en la línea, manda el libro: 50 de esta orden, no los 200 de la línea", () => {
    const r = pedidosDeLaOrden([{ idpedido: 8742, unidades: 50 }], [{ idpedido: 8742, unidades: 200 }], [8742])
    expect(r).toEqual([{ idpedido: 8742, unidades: 50, fuente: "libro" }])
  })

  it("sin libro usa las líneas (sumadas); solo cabecera queda con 0 unidades", () => {
    const r = pedidosDeLaOrden([], [{ idpedido: 10, unidades: 30 }, { idpedido: 10, unidades: 20 }], [11, 10])
    expect(r).toEqual([
      { idpedido: 10, unidades: 50, fuente: "linea" },
      { idpedido: 11, unidades: 0, fuente: "cabecera" },
    ])
  })

  it("una fila del libro cuya línea ya no existe no inventa un pedido", () => {
    expect(pedidosDeLaOrden([{ idpedido: 0, unidades: 9 }], [], [])).toEqual([])
  })
})
