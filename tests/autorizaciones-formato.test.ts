// Reglas de formato de la clave personal de autorización (lib/autorizaciones.ts, SQL 203).
import { describe, expect, it } from "vitest"
import { procesoInventarioAprobar, validarFormatoClave, CLAVE_MAX_LARGO, CLAVE_MIN_LARGO } from "@/lib/autorizaciones"

describe("validarFormatoClave", () => {
  it("acepta claves de 6 a 32 caracteres que no sean triviales", () => {
    expect(validarFormatoClave("LIPMJJ")).toBeNull()
    expect(validarFormatoClave("Clave-Segura-2026")).toBeNull()
    expect(CLAVE_MIN_LARGO).toBe(6)
    expect(CLAVE_MAX_LARGO).toBe(32)
  })
  it("rechaza espacios en los bordes, cortas, largas, repetidas y fáciles", () => {
    expect(validarFormatoClave(" LIPMJJ")).toMatch(/espacios/)
    expect(validarFormatoClave("abc")).toMatch(/al menos 6/)
    expect(validarFormatoClave("x".repeat(33))).toMatch(/superar 32/)
    expect(validarFormatoClave("111111")).toMatch(/repetido/)
    expect(validarFormatoClave("aaaaaaa")).toMatch(/repetido/)
    for (const facil of ["123456", "qwerty1", "password", "contraseña1", "lipgo123"]) expect(validarFormatoClave(facil)).toMatch(/adivinar/)
  })
  it("los procesos de inventario se nombran inv_<código>_aprobar", () => {
    expect(procesoInventarioAprobar("702")).toBe("inv_702_aprobar")
    expect(procesoInventarioAprobar(" 555 ")).toBe("inv_555_aprobar")
  })
})
