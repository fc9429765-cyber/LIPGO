// Reglas puras de las alertas del BSC (lib/alertas-bsc.ts).
import { describe, expect, it } from "vitest"
import { debeAvisar, formatearValor, htmlAviso, redactarAviso } from "@/lib/alertas-bsc"
import { KPI_DEFS, kpiSev } from "@/lib/kpis-area"

describe("debeAvisar", () => {
  it("umbral 'atencion' avisa en amarillo y rojo; 'critico' solo en rojo; nunca en verde o sin meta", () => {
    expect(debeAvisar("warn", "atencion")).toBe(true)
    expect(debeAvisar("crit", "atencion")).toBe(true)
    expect(debeAvisar("warn", "critico")).toBe(false)
    expect(debeAvisar("crit", "critico")).toBe(true)
    expect(debeAvisar("good", "atencion")).toBe(false)
    expect(debeAvisar("none", "atencion")).toBe(false)
  })
})

describe("semáforo de los indicadores de pedidos", () => {
  it("a tiempo: meta 95, amarillo desde 85,5 y rojo por debajo", () => {
    const def = KPI_DEFS.ped_a_tiempo
    expect(kpiSev(def, 96)).toBe("good")
    expect(kpiSev(def, 90)).toBe("warn")
    expect(kpiSev(def, 79.3)).toBe("crit")
  })
  it("atrasados hoy: meta 0, menor es mejor", () => {
    const def = KPI_DEFS.ped_atrasados
    expect(kpiSev(def, 0)).toBe("good")
    expect(kpiSev(def, 1)).toBe("crit")
  })
  it("indicadores informativos no tienen semáforo", () => {
    expect(kpiSev(KPI_DEFS.ped_mismo_dia, 70)).toBe("none")
  })
  it("vehículos sin procesar: meta 0, cualquier pendiente es crítico", () => {
    const def = KPI_DEFS.veh_sin_procesar
    expect(def.meta).toBe(0)
    expect(kpiSev(def, 0)).toBe("good")
    expect(kpiSev(def, 1)).toBe("crit")
    expect(kpiSev(def, 45)).toBe("crit")
  })
})

describe("redactarAviso y htmlAviso", () => {
  it("formatea en español con una decimal y la unidad", () => {
    expect(formatearValor(KPI_DEFS.ped_a_tiempo, 79.34)).toBe("79,3 %")
    expect(formatearValor(KPI_DEFS.ped_a_tiempo, 95)).toBe("95 %")
    expect(formatearValor(KPI_DEFS.ped_atrasados, 3)).toBe("3")
    expect(formatearValor(KPI_DEFS.ped_atrasados, Number.NaN)).toBe("sin lectura")
  })
  it("redacta asunto, título y líneas con valor, meta y proyecto", () => {
    const a = redactarAviso(KPI_DEFS.ped_a_tiempo, 79.3, "226/285 con fecha de cargue", "Cedi Funza", "1 – 3 oct 2026")
    expect(a.severidad).toBe("crit")
    expect(a.asunto).toBe("LIPgo · Pedidos a tiempo CRÍTICO en Cedi Funza")
    expect(a.titulo).toContain("79,3")
    expect(a.lineas.some((l) => l.includes("Cedi Funza"))).toBe(true)
    expect(a.lineas.some((l) => l.includes("226/285"))).toBe(true)
  })
  it("el HTML escapa texto y pone el enlace", () => {
    const a = redactarAviso(KPI_DEFS.ped_atrasados, 3, "<x>", "Avimol", "hoy")
    const html = htmlAviso(a, "https://www.lipgo.app/?g=pedidos", "pie")
    expect(html).toContain("&lt;x&gt;")
    expect(html).toContain('href="https://www.lipgo.app/?g=pedidos"')
    expect(html).not.toContain("<x>")
  })
})
