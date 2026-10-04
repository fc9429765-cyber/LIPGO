// Novedad del conteo físico → código de corrección (lib/conteo-novedades.ts).
// Regla de gerencia 2026-10-02: el contador escribe la novedad, el sistema propone el código.
import { describe, expect, it } from "vitest"
import { codigoReversoDe, compilarPatron, normalizarNovedad, opcionesPara, proponerCodigo } from "@/lib/conteo-novedades"

describe("proponerCodigo", () => {
  it("sin novedad: 701 si sobra, 702 si falta", () => {
    expect(proponerCodigo("", 5).codigo).toBe("701")
    expect(proponerCodigo(null, -5).codigo).toBe("702")
  })
  it("reconoce cruce de lote y mal ubicado con su pareja", () => {
    const l = proponerCodigo("Es del lote 20260920", -10)
    expect(l.codigo).toBe("309")
    expect(l.pareja).toBe("lote")
    const u = proponerCodigo("Estaba en otra ubicación", 10)
    expect(u.codigo).toBe("311")
    expect(u.pareja).toBe("ubicacion")
  })
  it("avería en un faltante es 551; avería en un sobrante vuelve al 701 con aviso", () => {
    expect(proponerCodigo("bultos rotos y mojados", -3).codigo).toBe("551")
    const s = proponerCodigo("avería", 3)
    expect(s.codigo).toBe("701")
    expect(s.aviso).toMatch(/sobrante/)
  })
  it("devolución de cliente solo aplica a sobrantes; cuarentena no se aplica desde el conteo", () => {
    expect(proponerCodigo("devolución del cliente", 4).codigo).toBe("653")
    const q = proponerCodigo("retenido por calidad", -4)
    expect(q.codigo).toBe("344")
    expect(q.aplicable).toBe(false)
  })
  it("ignora tildes y mayúsculas y respeta el diccionario editable", () => {
    expect(normalizarNovedad("  AVERÍA   Múltiple ")).toBe("averia multiple")
    const propio = proponerCodigo("cliente lo regresó", 2, [{ codigo: "653", patron: "regres", orden: 1 }])
    expect(propio.codigo).toBe("653")
  })
})

describe("utilidades", () => {
  it("compila texto simple escapado y regex; regex inválida devuelve null", () => {
    expect(compilarPatron("cruce de lote")?.test("hubo cruce de lote")).toBe(true)
    expect(compilarPatron("/\\bfalta/")?.test("falta producto")).toBe(true)
    expect(compilarPatron("/[/")).toBeNull()
  })
  it("opciones por signo y códigos de reverso", () => {
    expect(opcionesPara(-1).map((o) => o.codigo)).toEqual(["702", "309", "311", "551", "344"])
    expect(opcionesPara(1).map((o) => o.codigo)).toEqual(["701", "309", "311", "653", "344"])
    expect(codigoReversoDe("701", null)?.codigo).toBe("102")
    expect(codigoReversoDe("702", null)?.codigo).toBe("602")
    expect(codigoReversoDe("551", null)?.codigo).toBe("552")
    expect(codigoReversoDe("311", null)?.codigo).toBe("312")
    expect(codigoReversoDe("309", "salida")?.etiqueta).toContain("vuelve a entrar")
    expect(codigoReversoDe("102", null)).toBeNull()
  })
})
