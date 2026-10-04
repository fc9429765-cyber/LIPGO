// Períodos del Dashboard de pedidos y de los listados (lib/periodo-rango.ts, lib/periodo-listados.ts).
import { describe, expect, it } from "vitest"
import { etiquetaMes, etiquetaRango, lunesDe, rangoDe, validarRango, MAX_DIAS_RANGO } from "@/lib/periodo-rango"
import { desdeDePeriodo, restarDiasISO } from "@/lib/periodo-listados"

describe("rangoDe", () => {
  const HOY = "2026-10-03" // sábado
  it("esta semana va de lunes a domingo", () => {
    expect(lunesDe(HOY)).toBe("2026-09-28")
    expect(rangoDe("semana", HOY)).toEqual({ desde: "2026-09-28", hasta: "2026-10-04" })
  })
  it("quincena según el día del mes", () => {
    expect(rangoDe("quincena", HOY)).toEqual({ desde: "2026-10-01", hasta: "2026-10-15" })
    expect(rangoDe("quincena", "2026-10-20")).toEqual({ desde: "2026-10-16", hasta: "2026-10-31" })
    expect(rangoDe("quincena", "2026-02-20")).toEqual({ desde: "2026-02-16", hasta: "2026-02-28" })
  })
  it("este mes, mes anterior (incluido el cruce de año) y últimos 90 días", () => {
    expect(rangoDe("mes", HOY)).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" })
    expect(rangoDe("mes_anterior", HOY)).toEqual({ desde: "2026-09-01", hasta: "2026-09-30" })
    expect(rangoDe("mes_anterior", "2026-01-15")).toEqual({ desde: "2025-12-01", hasta: "2025-12-31" })
    expect(rangoDe("90", HOY)).toEqual({ desde: "2026-07-06", hasta: HOY })
  })
})

describe("validarRango y etiquetas", () => {
  it("rechaza fechas inválidas, invertidas o demasiado largas", () => {
    expect(validarRango("2026-10-01", "2026-10-31")).toBeNull()
    expect(validarRango("2026-10-31", "2026-10-01")).toMatch(/anterior/)
    expect(validarRango("x", "2026-10-01")).toMatch(/inválidas/)
    expect(validarRango("2025-01-01", "2026-12-31")).toContain(String(MAX_DIAS_RANGO))
  })
  it("etiqueta rangos y meses en español", () => {
    expect(etiquetaRango("2026-09-01", "2026-09-30")).toBe("1 – 30 sep 2026")
    expect(etiquetaRango("2026-09-28", "2026-10-04")).toBe("28 sep – 4 oct 2026")
    expect(etiquetaRango("2025-12-20", "2026-01-05")).toBe("20 dic 2025 – 5 ene 2026")
    expect(etiquetaMes("2026-09")).toBe("sep 2026")
  })
})

describe("periodo-listados", () => {
  it("desde del período y resta de días", () => {
    expect(desdeDePeriodo("90", "2026-10-03")).toBe("2026-07-05")
    expect(desdeDePeriodo("todo", "2026-10-03")).toBeNull()
    expect(restarDiasISO("2026-03-01", 1)).toBe("2026-02-28")
  })
})
