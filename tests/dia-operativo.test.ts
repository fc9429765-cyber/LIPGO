// Regla de gerencia (2026-10-03): los proyectos no trabajan los domingos → "mañana" es el
// siguiente día operativo. Misma regla en programación del cliente y en la cola de pedidos.
import { describe, expect, it } from "vitest"
import { diaSemana, siguienteDiaOperativo } from "@/lib/programacion-cliente-calculo"
import { derivarEstado, esDomingoISO, siguienteDiaOperativoISO } from "@/lib/pedidos-estado"

describe("siguiente día operativo", () => {
  it("un sábado, mañana es el lunes; un domingo, también el lunes", () => {
    expect(diaSemana("2026-10-03")).toBe(6) // sábado
    expect(siguienteDiaOperativo("2026-10-03")).toBe("2026-10-05")
    expect(siguienteDiaOperativo("2026-10-04")).toBe("2026-10-05")
    expect(siguienteDiaOperativoISO("2026-10-03")).toBe("2026-10-05")
  })
  it("entre semana, mañana es el día siguiente", () => {
    expect(siguienteDiaOperativo("2026-10-05")).toBe("2026-10-06")
    expect(siguienteDiaOperativo("2026-10-09")).toBe("2026-10-10") // viernes → sábado (se trabaja)
    expect(siguienteDiaOperativo("2026-10-31")).toBe("2026-11-02") // sábado fin de mes → lunes
  })
  it("esDomingoISO", () => {
    expect(esDomingoISO("2026-10-04")).toBe(true)
    expect(esDomingoISO("2026-10-05")).toBe(false)
  })
  it("la cola marca 'para mañana' el pedido del lunes cuando hoy es sábado", () => {
    const base = { estado: null, aprobado: "si", revisioncartera: "ok", ocargue: null, fechaordencargue: null, fechadeentrega: null, factura: null, vehiculo: null, fecha: "2026-10-01" }
    const lunes = derivarEstado({ ...base, fecha_programada: "2026-10-05" } as any, "2026-10-03")
    const domingo = derivarEstado({ ...base, fecha_programada: "2026-10-04" } as any, "2026-10-03")
    expect(lunes.esManana).toBe(true)
    expect(domingo.esManana).toBe(false)
  })
})
