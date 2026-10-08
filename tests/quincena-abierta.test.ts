import { describe, expect, it } from "vitest"
import { estadoQuincena, quincenaDeFecha } from "@/lib/quincena-abierta"

describe("quincenaDeFecha", () => {
  it("parte el mes en dos quincenas: 1-15 y 16-fin", () => {
    expect(quincenaDeFecha("2026-10-01")).toMatchObject({ quincena: 1, desde: "2026-10-01", hasta: "2026-10-15" })
    expect(quincenaDeFecha("2026-10-15")).toMatchObject({ quincena: 1, desde: "2026-10-01", hasta: "2026-10-15" })
    expect(quincenaDeFecha("2026-10-16")).toMatchObject({ quincena: 2, desde: "2026-10-16", hasta: "2026-10-31" })
    expect(quincenaDeFecha("2026-10-31")).toMatchObject({ quincena: 2, desde: "2026-10-16", hasta: "2026-10-31" })
  })

  it("respeta el último día de cada mes", () => {
    expect(quincenaDeFecha("2026-02-20")?.hasta).toBe("2026-02-28")
    expect(quincenaDeFecha("2026-09-20")?.hasta).toBe("2026-09-30")
  })

  it("rechaza una fecha que no sirve", () => {
    expect(quincenaDeFecha("")).toBeNull()
    expect(quincenaDeFecha("06/10/2026")).toBeNull()
    expect(quincenaDeFecha("2026-13-01")).toBeNull()
  })
})

describe("estadoQuincena", () => {
  const hoy = "2026-10-06" // quincena en curso: 1 al 15 de octubre

  it("deja corregir hacia atrás DENTRO de la quincena en curso", () => {
    // El caso real que motivó la regla: el 1 de octubre, estando a 6.
    expect(estadoQuincena("2026-10-01", hoy).abierta).toBe(true)
    expect(estadoQuincena("2026-10-06", hoy).abierta).toBe(true)
    expect(estadoQuincena("2026-10-15", hoy).abierta).toBe(true)
  })

  it("cierra las quincenas anteriores porque ya se pagaron", () => {
    const r = estadoQuincena("2026-09-30", hoy)
    expect(r.abierta).toBe(false)
    expect(r.motivo).toContain("ya se pagó")
    expect(r.motivo).toContain("16 al 30 de septiembre de 2026")
    expect(estadoQuincena("2026-09-15", hoy).abierta).toBe(false)
    expect(estadoQuincena("2025-10-06", hoy).abierta).toBe(false)
  })

  it("la quincena siguiente sigue abierta: tampoco se ha pagado", () => {
    expect(estadoQuincena("2026-10-16", hoy).abierta).toBe(true)
    expect(estadoQuincena("2026-11-02", hoy).abierta).toBe(true)
  })

  it("el 16 abre quincena nueva y cierra la del 1 al 15", () => {
    expect(estadoQuincena("2026-10-15", "2026-10-16").abierta).toBe(false)
    expect(estadoQuincena("2026-10-16", "2026-10-16").abierta).toBe(true)
  })
})
