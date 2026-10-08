import { describe, it, expect } from "vitest"
import { resumenPedidosDeLaOrden } from "@/lib/pedido-de-la-orden"

describe("de qué pedido nació la orden de cargue", () => {
  it("una orden que atiende a un solo pedido lo guarda", () => {
    expect(resumenPedidosDeLaOrden([{ idpedido: 12429, unidadescargadas: 200 }])).toEqual({
      idpedido: 12429,
      pedidos_n: 1,
    })
  })

  it("varias líneas del MISMO pedido siguen siendo un solo pedido", () => {
    const r = resumenPedidosDeLaOrden([
      { idpedido: 9899, unidadescargadas: 100 },
      { idpedido: 9899, unidadescargadas: 60 },
      { idpedido: 9899, unidadescargadas: 40 },
    ])
    expect(r).toEqual({ idpedido: 9899, pedidos_n: 1 })
  })

  it("si atiende a varios pedidos NO elige uno: deja el id en nulo y dice cuántos", () => {
    const r = resumenPedidosDeLaOrden([
      { idpedido: 101, unidadescargadas: 10 },
      { idpedido: 202, unidadescargadas: 20 },
      { idpedido: 303, unidadescargadas: 30 },
    ])
    // Poner uno de los tres seria mentir: la relacion completa vive en el libro.
    expect(r).toEqual({ idpedido: null, pedidos_n: 3 })
  })

  it("una línea que no lleva nada no cuenta: el libro tampoco la anota", () => {
    const r = resumenPedidosDeLaOrden([
      { idpedido: 101, unidadescargadas: 50 },
      { idpedido: 202, unidadescargadas: 0 },
    ])
    expect(r).toEqual({ idpedido: 101, pedidos_n: 1 })
  })

  it("si NINGUNA línea lleva algo, la orden queda sin pedido", () => {
    expect(resumenPedidosDeLaOrden([{ idpedido: 101, unidadescargadas: 0 }])).toEqual({
      idpedido: null,
      pedidos_n: 0,
    })
  })

  it("una orden sin líneas (Tolva, Distribución) queda en cero, no en nulo", () => {
    expect(resumenPedidosDeLaOrden([])).toEqual({ idpedido: null, pedidos_n: 0 })
    expect(resumenPedidosDeLaOrden(null)).toEqual({ idpedido: null, pedidos_n: 0 })
    expect(resumenPedidosDeLaOrden(undefined)).toEqual({ idpedido: null, pedidos_n: 0 })
  })

  it("ignora pedidos sin id válido en vez de inventarse un cero", () => {
    const r = resumenPedidosDeLaOrden([
      { idpedido: null, unidadescargadas: 10 },
      { idpedido: 0, unidadescargadas: 10 },
      { idpedido: Number.NaN, unidadescargadas: 10 },
      { idpedido: 777, unidadescargadas: 10 },
    ])
    expect(r).toEqual({ idpedido: 777, pedidos_n: 1 })
  })

  it("no cuenta cantidades negativas como si llevaran algo", () => {
    expect(resumenPedidosDeLaOrden([{ idpedido: 55, unidadescargadas: -10 }])).toEqual({
      idpedido: null,
      pedidos_n: 0,
    })
  })

  it("aguanta cantidades que llegan como texto desde un formulario", () => {
    const r = resumenPedidosDeLaOrden([
      { idpedido: 42, unidadescargadas: "150" as unknown as number },
      { idpedido: 43, unidadescargadas: "0" as unknown as number },
    ])
    expect(r).toEqual({ idpedido: 42, pedidos_n: 1 })
  })

  it("el caso real del 7 de octubre: 4 pedidos en una orden de ID2", () => {
    // Orden AVI202610079971: pedidos_n 4 e idpedido nulo, como quedo en la base.
    const r = resumenPedidosDeLaOrden([
      { idpedido: 12430, unidadescargadas: 64 },
      { idpedido: 12431, unidadescargadas: 22 },
      { idpedido: 12432, unidadescargadas: 14 },
      { idpedido: 12433, unidadescargadas: 30 },
    ])
    expect(r).toEqual({ idpedido: null, pedidos_n: 4 })
  })
})
