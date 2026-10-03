// Cumplimiento de la programación del cliente (lib/programacion-cliente-calculo.ts):
// por tipo de vehículo, decisión de gerencia 2026-10-01.
import { describe, expect, it } from "vitest"
import { calcularCumplimiento, diaSemana, diasEntre, normalizarTipo, sumarDias } from "@/lib/programacion-cliente-calculo"
import type { ProgramacionCliente } from "@/lib/programacion-cliente-tipos"

const prog = (fecha: string, lineas: { tipovehiculo: string; cantidad: number }[], vigente = true): ProgramacionCliente =>
  ({
    id: 1,
    idempresa: 1,
    fechaOperacion: fecha,
    version: 1,
    vigente,
    lineas: lineas.map((l) => ({ ...l, destino: "Bogotá" })),
    totalVehiculos: lineas.reduce((s, l) => s + l.cantidad, 0),
    observaciones: null,
    enviadaEn: `${fecha}T20:00:00Z`,
    aTiempo: true,
    enviadaPorUsuario: "cliente",
    enviadaPorEmpresa: 1,
  }) as unknown as ProgramacionCliente

describe("normalización y fechas", () => {
  it("'Doble troque' ≡ 'DOBLETROQUE' y las fechas suman sin zona horaria", () => {
    expect(normalizarTipo("Doble troque")).toBe(normalizarTipo("DOBLETROQUE"))
    expect(sumarDias("2026-02-28", 1)).toBe("2026-03-01")
    expect(diasEntre("2026-10-01", "2026-10-03")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"])
    expect(diaSemana("2026-10-03")).toBe(6)
  })
})

describe("calcularCumplimiento", () => {
  it("cumplidos = min(programados, llegaron) por tipo; lo demás no llegó o no estaba programado", () => {
    const r = calcularCumplimiento(
      "2026-10-01",
      "2026-10-01",
      [prog("2026-10-01", [{ tipovehiculo: "Mula", cantidad: 3 }, { tipovehiculo: "Turbo", cantidad: 1 }])],
      [
        { fecha: "2026-10-01", tipovehiculo: "mula" },
        { fecha: "2026-10-01", tipovehiculo: "MULA" },
        { fecha: "2026-10-01", tipovehiculo: "Sencillo" },
      ],
    )
    expect(r.dias).toHaveLength(1)
    const d = r.dias[0]
    expect(d.tieneProgramacion).toBe(true)
    expect(d.programados).toBe(4)
    expect(d.llegaron).toBe(3)
    expect(d.cumplidos).toBe(2)
    expect(d.noLlegaron).toBe(2)
    expect(d.noProgramados).toBe(1)
  })
  it("un día sin programación ni llegadas no cuenta; una versión no vigente se ignora", () => {
    const r = calcularCumplimiento("2026-10-01", "2026-10-02", [prog("2026-10-02", [{ tipovehiculo: "Mula", cantidad: 2 }], false)], [])
    expect(r.dias).toHaveLength(0)
  })
  it("llegadas sin programación quedan como no programadas", () => {
    const r = calcularCumplimiento("2026-10-05", "2026-10-05", [], [{ fecha: "2026-10-05", tipovehiculo: "Turbo" }])
    expect(r.dias[0].tieneProgramacion).toBe(false)
    expect(r.dias[0].noProgramados).toBe(1)
    expect(r.dias[0].cumplidos).toBe(0)
  })
})
