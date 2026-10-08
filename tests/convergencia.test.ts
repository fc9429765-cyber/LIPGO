// Comprobaciones de convergencia: que las cifras de la app cuadren entre sí todos los días.
// Gerencia (2026-10-05): "¿estás validando que todos los datos converjan y sea una información
// veraz y confiable?". Esto es la parte pura, probada sola.

import { describe, expect, it } from "vitest"
import { asuntoConvergencia, hayQueAvisar, htmlConvergencia, lineasConvergencia, resultadoDe, resumirChecks, sinDatos } from "@/lib/convergencia"

const base = { clave: "x", titulo: "Salió más que la orden", regla: "Nunca puede salir más de lo que dice la orden.", gravedad: "critico" as const }

describe("resultado de un check", () => {
  it("sin casos es ok", () => {
    const r = resultadoDe(base, [])
    expect(r.estado).toBe("ok")
    expect(r.casos).toBe(0)
  })

  it("con casos toma la gravedad del check y guarda hasta 10 ejemplos", () => {
    const r = resultadoDe(base, Array.from({ length: 14 }, (_, i) => `caso ${i}`))
    expect(r.estado).toBe("critico")
    expect(r.casos).toBe(14)
    expect(r.ejemplos).toHaveLength(10)
  })

  it("sin datos no es ok: hay que decir por qué no se pudo comprobar", () => {
    const r = sinDatos(base, "falta correr scripts/sig/63_orden_vs_salidas.sql")
    expect(r.estado).toBe("sin_datos")
    expect(r.motivo).toContain("63")
  })
})

describe("resumen y aviso", () => {
  it("todo cuadra: no se avisa", () => {
    const r = resumirChecks([resultadoDe(base, []), resultadoDe({ ...base, clave: "y", gravedad: "alerta" }, [])])
    expect(r.ok).toBe(2)
    expect(hayQueAvisar(r)).toBe(false)
    expect(asuntoConvergencia(r, "5 de octubre")).toContain("todo cuadra")
  })

  it("un crítico obliga a avisar y va primero", () => {
    const r = resumirChecks([
      resultadoDe({ ...base, clave: "a", titulo: "Alerta menor", gravedad: "alerta" }, ["uno"]),
      resultadoDe({ ...base, clave: "c", titulo: "Grave" }, ["dos", "tres"]),
      resultadoDe({ ...base, clave: "o", titulo: "Bien" }, []),
    ])
    expect(hayQueAvisar(r)).toBe(true)
    expect(asuntoConvergencia(r, "5 de octubre")).toBe("LIPgo · convergencia: 1 crítico, 1 alerta · 5 de octubre")
    const l = lineasConvergencia(r)
    expect(l[1]).toContain("[CRÍTICO] Grave")
    expect(l[1]).toContain("2 casos")
  })

  it("lo que no se pudo comprobar también obliga a avisar: nunca 'todo bien' por silencio", () => {
    const r = resumirChecks([resultadoDe(base, []), sinDatos({ ...base, clave: "s" }, "la vista no existe")])
    expect(hayQueAvisar(r)).toBe(true)
    expect(asuntoConvergencia(r, "hoy")).toContain("1 sin comprobar")
    expect(lineasConvergencia(r).join("\n")).toContain("SIN COMPROBAR")
  })

  it("el html escapa los ejemplos", () => {
    const r = resumirChecks([resultadoDe(base, ['<img src=x onerror="1">'])])
    const html = htmlConvergencia(r, "hoy", "pie")
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })
})
