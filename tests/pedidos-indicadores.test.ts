// Indicadores de pedidos para el BSC y el Dashboard (lib/pedidos-indicadores.ts).
import { describe, expect, it } from "vitest"
import { clasificarPedido, resumirIndicadoresPedidos, valoresBscPedidos, CLAVES_BSC_PEDIDOS } from "@/lib/pedidos-indicadores"

describe("clasificarPedido", () => {
  it("a tiempo cuando la OC es el día de la promesa o antes; tarde después; la entrega sirve si no hubo OC", () => {
    expect(clasificarPedido({ estado: "entregado", fecha_programada: "2026-09-10", fechaordencargue: "2026-09-10" }).clase).toBe("a_tiempo")
    expect(clasificarPedido({ estado: "entregado", fecha_programada: "2026-09-10", fechaordencargue: "2026-09-12" }).clase).toBe("tarde")
    expect(clasificarPedido({ estado: "entregado", fecha_programada: "2026-09-10", fechadeentrega: "2026-09-09" }).clase).toBe("a_tiempo")
  })
  it("anulado y no entregado van aparte; abierto sin OC es pendiente; final sin fechas es cerrado sin fecha", () => {
    expect(clasificarPedido({ estado: "anulado", fecha_programada: "2026-09-10", fechaordencargue: "2026-09-10" }).clase).toBe("anulado")
    expect(clasificarPedido({ estado: "no entregado", fecha_programada: "2026-09-10" }).clase).toBe("no_entregado")
    expect(clasificarPedido({ estado: "aprobado", fecha_programada: "2026-09-10" }).clase).toBe("pendiente")
    expect(clasificarPedido({ estado: "entregado", fecha_programada: "2026-09-10" }).clase).toBe("cerrado_sin_fecha")
    expect(clasificarPedido({ estado: null, fecha_programada: "2026-09-10", ocargue: "F-1" }).clase).toBe("cerrado_sin_fecha")
  })
})

describe("resumirIndicadoresPedidos y valores del BSC", () => {
  const pedidos = [
    { estado: "entregado", fecha: "2026-09-01", fecha_programada: "2026-09-01", fechaordencargue: "2026-09-01" },
    { estado: "entregado", fecha: "2026-09-01", fecha_programada: "2026-09-03", fechaordencargue: "2026-09-05" },
    { estado: "parcial", fecha: "2026-09-02", fecha_programada: "2026-09-02", fechaordencargue: "2026-09-02" },
    { estado: "aprobado", fecha: "2026-09-04", fecha_programada: "2026-09-06" },
    { estado: "anulado", fecha: "2026-09-04", fecha_programada: "2026-09-04" },
    { estado: "no entregado", fecha: "2026-09-04", fecha_programada: "2026-09-04" },
  ]
  it("cuenta cada clase una sola vez y mide completos, parciales y mismo día", () => {
    const r = resumirIndicadoresPedidos(pedidos)
    expect(r.pedidos).toBe(6)
    expect(r.conFecha).toBe(3)
    expect(r.aTiempo).toBe(2)
    expect(r.tarde).toBe(1)
    expect(r.pendientes).toBe(1)
    expect(r.anulados).toBe(1)
    expect(r.noEntregados).toBe(1)
    expect(r.completos).toBe(2)
    expect(r.parciales).toBe(1)
    expect(r.conPromesa).toBe(6)
    expect(r.mismoDia).toBe(4)
  })
  it("traduce a las claves del BSC con porcentaje a un decimal y base legible", () => {
    const v = valoresBscPedidos(resumirIndicadoresPedidos(pedidos), 7)
    expect(Object.keys(v).sort()).toEqual([...CLAVES_BSC_PEDIDOS].sort())
    expect(v.ped_a_tiempo.valor).toBe(66.7)
    expect(v.ped_completos.valor).toBe(66.7)
    expect(v.ped_mismo_dia.valor).toBe(66.7)
    expect(v.ped_pendientes.valor).toBe(1)
    expect(v.ped_atrasados.valor).toBe(7)
    expect(v.ped_a_tiempo.base).toBe("2/3 con fecha de cargue")
  })
  it("sin datos devuelve null, nunca cero falso", () => {
    const v = valoresBscPedidos(resumirIndicadoresPedidos([]), null)
    expect(v.ped_a_tiempo.valor).toBeNull()
    expect(v.ped_atrasados.valor).toBeNull()
    expect(v.ped_pendientes.valor).toBe(0)
  })
})
