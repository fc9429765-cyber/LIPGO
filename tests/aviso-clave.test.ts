// El aviso de clave pendiente. Lo que esta en juego: el dia que vencen las claves
// compartidas, quien no tenga la suya deja de poder autorizar en su proyecto.
//
// Medido el 2026-10-07, a 20 dias del cierre: 19 de 21 personas con perfil de autorizacion
// no tenian clave, y NINGUNA tenia correo real registrado, asi que el unico canal posible
// es la propia aplicacion.

import { describe, expect, it } from "vitest"
import { avisoDeClave, diasHasta } from "@/lib/aviso-clave"

const CIERRE = "2026-10-27"

describe("cuántos días faltan", () => {
  it("cuenta los días completos hasta el cierre", () => {
    expect(diasHasta(CIERRE, "2026-10-07")).toBe(20)
    expect(diasHasta(CIERRE, "2026-10-26")).toBe(1)
    expect(diasHasta(CIERRE, "2026-10-27")).toBe(0)
    expect(diasHasta(CIERRE, "2026-10-30")).toBe(-3)
  })

  it("cruza bien el cambio de mes y de año", () => {
    expect(diasHasta("2026-11-01", "2026-10-31")).toBe(1)
    expect(diasHasta("2027-01-01", "2026-12-31")).toBe(1)
  })

  it("una fecha que no se entiende no inventa un número", () => {
    expect(diasHasta(null, "2026-10-07")).toBeNull()
    expect(diasHasta("", "2026-10-07")).toBeNull()
    expect(diasHasta("27/10/2026", "2026-10-07")).toBeNull()
  })
})

describe("el aviso", () => {
  it("quien ya tiene su clave no ve nada", () => {
    expect(avisoDeClave(null, CIERRE, "2026-10-07")).toBeNull()
  })

  it("a 20 días avisa sin alarmar, y se puede posponer", () => {
    const a = avisoDeClave("sin_clave", CIERRE, "2026-10-07")!
    expect(a.tono).toBe("atencion")
    expect(a.dias).toBe(20)
    expect(a.sePuedePosponer).toBe(true)
    expect(a.texto).toContain("20 días")
    expect(a.boton).toBe("Crear mi clave")
  })

  it("en la última semana se vuelve crítico y YA NO se puede posponer", () => {
    const a = avisoDeClave("sin_clave", CIERRE, "2026-10-21")!
    expect(a.tono).toBe("critico")
    expect(a.dias).toBe(6)
    expect(a.sePuedePosponer).toBe(false)
    expect(a.titulo).toContain("6 días")
  })

  it("el día del cierre lo dice sin rodeos", () => {
    const a = avisoDeClave("sin_clave", CIERRE, CIERRE)!
    expect(a.tono).toBe("critico")
    expect(a.dias).toBe(0)
    expect(a.titulo).toContain("Hoy")
    expect(a.sePuedePosponer).toBe(false)
  })

  it("pasado el plazo dice que ya no puede autorizar", () => {
    const a = avisoDeClave("sin_clave", CIERRE, "2026-10-30")!
    expect(a.tono).toBe("critico")
    expect(a.dias).toBe(-3)
    expect(a.titulo).toContain("No puedes autorizar")
    expect(a.texto).toContain("3 días")
    expect(a.sePuedePosponer).toBe(false)
  })

  it("la clave provisional avisa distinto y el botón cambia", () => {
    const a = avisoDeClave("provisional", CIERRE, "2026-10-07")!
    expect(a.texto).toContain("provisional")
    expect(a.boton).toBe("Cambiar mi clave")
  })

  it("sin fecha de cierre avisa igual, pero sin meter prisa falsa", () => {
    const a = avisoDeClave("sin_clave", null, "2026-10-07")!
    expect(a.dias).toBeNull()
    expect(a.tono).toBe("atencion")
    expect(a.sePuedePosponer).toBe(true)
    expect(a.texto).not.toContain("null")
  })

  it("un día en singular se escribe en singular", () => {
    const a = avisoDeClave("sin_clave", CIERRE, "2026-10-26")!
    expect(a.titulo).toContain("1 día")
    expect(a.titulo).not.toContain("1 días")
  })
})
