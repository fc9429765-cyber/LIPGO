// Reglas puras del informe semanal (lib/informe-semanal.ts).
import { describe, expect, it } from "vitest"
import { asuntoInforme, clavesInformeProyecto, construirDatosInforme, htmlInforme, narrativaDeterminista, validarNarrativa } from "@/lib/informe-semanal"

const datos = () =>
  construirDatosInforme({
    empresaNombre: "Avimol",
    rango: "22 – 28 sep 2026",
    rangoPrevio: "15 – 21 sep 2026",
    semana: {
      ped_a_tiempo: { valor: 76.2, base: "16/21 con fecha de cargue" },
      ped_atrasados: { valor: 63, base: "63 aprobados con promesa vencida" },
      veh_sin_procesar: { valor: 45, base: "2 de hoy · 43 de días anteriores" },
      desp_cumplimiento: { valor: 99.4, base: "170/171" },
      sat_conductor: { valor: 0, base: "0 encuestas" },
    },
    previa: { ped_a_tiempo: { valor: 80 }, ped_atrasados: { valor: 70 }, desp_cumplimiento: { valor: 98.1 } },
    pendientes: [{ texto: "43 vehículos sin procesar de días anteriores", modulo: "Ver vehículos", nivel: "alto" }],
    claves: [
      { key: "ped_a_tiempo", area: "pedidos" },
      { key: "ped_atrasados", area: "pedidos" },
      { key: "veh_sin_procesar", area: "despachos" },
      { key: "desp_cumplimiento", area: "despachos" },
      { key: "sat_conductor", area: "despachos" },
      { key: "inv_eri", area: "inventarios" },
    ],
  })

describe("construirDatosInforme", () => {
  it("clasifica semáforo, delta y mejora según el sentido del indicador", () => {
    const d = datos()
    const f = Object.fromEntries(d.filas.map((x) => [x.key, x]))
    expect(f.ped_a_tiempo.sev).toBe("crit")
    expect(f.ped_a_tiempo.delta).toBe(-3.8)
    expect(f.ped_a_tiempo.mejora).toBe(false)
    expect(f.ped_atrasados.delta).toBe(-7)
    expect(f.ped_atrasados.mejora).toBe(true) // menor es mejor
    expect(f.veh_sin_procesar.sev).toBe("crit")
    expect(f.desp_cumplimiento.sev).toBe("good")
    expect(f.sat_conductor.valorTxt).toBe("sin datos")
    expect(f.inv_eri.valorTxt).toBe("sin lectura")
    expect(d.criticos).toBe(3)
    expect(d.enMeta).toBe(1)
    expect(d.sinLectura).toBe(1)
  })
  it("el asunto resume el estado", () => {
    expect(asuntoInforme(datos())).toBe("LIPgo · Informe semanal Avimol · 22 – 28 sep 2026 · 3 en rojo")
  })
})

describe("narrativa", () => {
  it("la lectura determinista nombra lo crítico con sus cifras", () => {
    const t = narrativaDeterminista(datos()).join("\n")
    expect(t).toContain("Vehículos sin procesar está en 45")
    expect(t).toContain("Pedidos a tiempo está en 76,2 %")
    expect(t).toContain("Hoy requiere acción")
  })
  it("valida que la IA no invente cifras", () => {
    const d = datos()
    expect(validarNarrativa("Pedidos a tiempo cayó a 76,2 % desde 80 %, con 63 atrasados y 45 vehículos sin procesar.", d)).toBeNull()
    expect(validarNarrativa("1. Cerrar los 45 vehículos.\n2. Revisar la meta de 95 %.", d)).toBeNull()
    expect(validarNarrativa("La operación cargó 1.250 toneladas esta semana.", d)).toBe("1.250")
    expect(validarNarrativa("Se perdieron 12 pedidos.", d)).toBe("12")
  })
  it("la narrativa determinista siempre pasa su propia validación", () => {
    const d = datos()
    expect(validarNarrativa(narrativaDeterminista(d).join("\n"), d)).toBeNull()
  })
})

describe("html y claves", () => {
  it("el HTML escapa y agrupa por área", () => {
    const html = htmlInforme(datos(), ["<b>x</b>"], { enlace: "https://www.lipgo.app", pie: "pie", fuenteLectura: "determinista" })
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).toContain("Recepción y Despacho")
    expect(html).toContain('href="https://www.lipgo.app"')
  })
  it("las claves del proyecto no repiten ni incluyen áreas transversales", () => {
    const claves = clavesInformeProyecto()
    const keys = claves.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(claves.some((c) => c.area === "sst" || c.area === "certificaciones_lip")).toBe(false)
    expect(keys).toContain("veh_sin_procesar")
    expect(keys).toContain("ped_a_tiempo")
  })
})
