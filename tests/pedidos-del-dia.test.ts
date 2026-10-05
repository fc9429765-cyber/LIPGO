// Pedidos del día: la demanda real a cargar hoy (gerencia, 2026-10-05). Caso real de ID 3
// (Cedi Funza) el 5 de octubre: 16 pedidos prometidos para hoy = 106,6 t; 12 ya salieron
// (36,2 t); 4 sin orden (70,4 t), 1 de ellos por aprobar; 35 atrasados sin orden (350 t).

import { describe, expect, it } from "vitest"
import { diasEntreISO, formatoPeso, hayQueMostrar, pctAvance, resumenVencen, textoVencen, tonoVencen, type PedidosDelDia } from "@/lib/pedidos-del-dia"

const pedido = (idpedido: number, kg: number, aprobado = true, atrasoDias = 0) => ({
  idpedido, pedido: null, cliente: `Cliente ${idpedido}`, destino: null, tipoDespacho: "CARGUE PROPIO", kg, unidades: 0, lineas: 1,
  aprobado, carteraLista: true, fechaProgramada: "2026-10-05", registrado: "2026-10-05", atrasoDias,
})

const id3: PedidosDelDia = {
  empresaId: 3, hoy: "2026-10-05", manana: "2026-10-06", metaAcuerdoT: 89.1,
  demandaHoy: { pedidos: 16, kg: 106_600, registradosHoy: 11 },
  salieronHoy: { pedidos: 12, kg: 36_200 },
  vencenHoy: { pedidos: 4, kg: 70_400, porAprobar: 1, lista: [pedido(12218, 34_004), pedido(12123, 18_375), pedido(12110, 13_056), pedido(12262, 5_000, false)] },
  atrasados: { pedidos: 35, kg: 350_100, recientes: [pedido(12165, 5_580, true, 2), pedido(12229, 5_000, true, 3), pedido(12105, 4_390, false, 3)] },
  paraManana: { pedidos: 5, kg: 90_200, porAprobar: 2, lista: [], salieron: { pedidos: 4, kg: 23_700 } },
}

describe("la línea llamativa", () => {
  it("resume lo que vence hoy con lo que falta por cargar, no con toda la demanda", () => {
    const r = resumenVencen(id3)
    expect(r.pendientes).toBe(4)
    expect(r.kg).toBe(70_400)
    expect(textoVencen(r)).toBe("Vencen hoy: 4 pedidos · 70,4 t · 1 por aprobar · 3 atrasados recientes")
  })

  it("es crítica si hay atrasados recientes o pedidos de hoy sin aprobar", () => {
    expect(tonoVencen(resumenVencen(id3))).toBe("critico")
    expect(tonoVencen({ pendientes: 2, kg: 5000, porAprobar: 1, atrasadosRecientes: 0, atrasadosTotal: 0, atrasadosKg: 0 })).toBe("critico")
  })

  it("es de atención si solo falta cargar, y ok si no hay nada pendiente", () => {
    expect(tonoVencen({ pendientes: 2, kg: 5000, porAprobar: 0, atrasadosRecientes: 0, atrasadosTotal: 0, atrasadosKg: 0 })).toBe("atencion")
    expect(tonoVencen({ pendientes: 0, kg: 0, porAprobar: 0, atrasadosRecientes: 0, atrasadosTotal: 0, atrasadosKg: 0 })).toBe("ok")
  })

  it("no se muestra cuando no hay nada que hacer: no satura el módulo", () => {
    expect(hayQueMostrar({ pendientes: 0, kg: 0, porAprobar: 0, atrasadosRecientes: 0, atrasadosTotal: 0, atrasadosKg: 0 })).toBe(false)
    expect(hayQueMostrar({ pendientes: 0, kg: 0, porAprobar: 0, atrasadosRecientes: 0, atrasadosTotal: 35, atrasadosKg: 350_100 })).toBe(true)
  })

  it("sin pendientes pero con atraso, lo dice sin alarmar de más", () => {
    expect(textoVencen({ pendientes: 0, kg: 0, porAprobar: 0, atrasadosRecientes: 0, atrasadosTotal: 35, atrasadosKg: 350_100 })).toBe("Nada vence hoy · 35 pedidos atrasados sin orden (350,1 t)")
    expect(textoVencen({ pendientes: 1, kg: 850, porAprobar: 0, atrasadosRecientes: 0, atrasadosTotal: 2, atrasadosKg: 3000 })).toBe("Vencen hoy: 1 pedido · 850 kg · 2 atrasados sin orden")
  })
})

describe("cifras", () => {
  it("formatea pesos en toneladas con una decimal, y en kilos por debajo de una tonelada", () => {
    expect(formatoPeso(70_400)).toBe("70,4 t")
    expect(formatoPeso(350_100)).toBe("350,1 t")
    expect(formatoPeso(850)).toBe("850 kg")
    expect(formatoPeso(0)).toBe("0 kg")
  })

  it("el avance del día es lo que salió sobre toda la demanda", () => {
    expect(pctAvance(id3)).toBe(34)
    expect(pctAvance({ demandaHoy: { pedidos: 0, kg: 0, registradosHoy: 0 }, salieronHoy: { pedidos: 0, kg: 0 } })).toBeNull()
  })

  it("cuenta días entre fechas sin depender de la zona horaria", () => {
    expect(diasEntreISO("2026-10-03", "2026-10-05")).toBe(2)
    expect(diasEntreISO("2026-10-05", "2026-10-05")).toBe(0)
    expect(diasEntreISO("2026-10-06", "2026-10-05")).toBe(-1)
  })
})
