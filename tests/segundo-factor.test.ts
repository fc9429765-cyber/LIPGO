// Segundo factor en el servidor. REGLA DE GERENCIA (2026-10-05): "no debes afectar los
// permisos que ya tienen los usuarios en este momento". Este control no mira permisos: solo
// si la cuenta YA activó su segundo factor. Quien no lo tiene sigue exactamente igual.

import { describe, expect, it } from "vitest"
import { decidirSegundoFactor, ErrorSegundoFactor, MENSAJE_SEGUNDO_FACTOR } from "@/lib/segundo-factor"

describe("cuándo exigir el segundo factor en una acción sensible", () => {
  it("cuenta SIN factor: nunca se exige, sigue igual que hoy", () => {
    const d = decidirSegundoFactor({ currentLevel: "aal1", nextLevel: "aal1" })
    expect(d.tieneFactor).toBe(false)
    expect(d.exigir).toBe(false)
  })

  it("cuenta CON factor y sesión ya verificada con el código: pasa", () => {
    const d = decidirSegundoFactor({ currentLevel: "aal2", nextLevel: "aal2" })
    expect(d.tieneFactor).toBe(true)
    expect(d.verificado).toBe(true)
    expect(d.exigir).toBe(false)
  })

  it("cuenta CON factor pero sesión solo con contraseña: se exige", () => {
    const d = decidirSegundoFactor({ currentLevel: "aal1", nextLevel: "aal2" })
    expect(d.exigir).toBe(true)
  })

  it("es la MISMA condición que usa la pantalla de inicio de sesión", () => {
    // login-form.tsx: aal.nextLevel === "aal2" && aal.currentLevel !== "aal2"
    const pantalla = (n: { currentLevel: any; nextLevel: any }) => n.nextLevel === "aal2" && n.currentLevel !== "aal2"
    for (const n of [
      { currentLevel: "aal1", nextLevel: "aal1" },
      { currentLevel: "aal1", nextLevel: "aal2" },
      { currentLevel: "aal2", nextLevel: "aal2" },
    ]) {
      expect(decidirSegundoFactor(n as any).exigir).toBe(pantalla(n))
    }
  })

  it("sin datos (no se pudo leer el nivel) no se bloquea a nadie", () => {
    expect(decidirSegundoFactor(null).exigir).toBe(false)
    expect(decidirSegundoFactor(undefined).exigir).toBe(false)
    expect(decidirSegundoFactor({}).exigir).toBe(false)
  })

  it("el error lleva un código reconocible y el mensaje para el usuario", () => {
    const e = new ErrorSegundoFactor()
    expect(e.codigo).toBe("SEGUNDO_FACTOR_REQUERIDO")
    expect(e.message).toBe(MENSAJE_SEGUNDO_FACTOR)
    expect(e.message).toContain("código")
  })
})
