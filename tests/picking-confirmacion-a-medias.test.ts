// La confirmación del picking no es una transacción: si se interrumpe a la mitad, la orden
// queda con unas líneas aprobadas y otras en "por descontar". El candado del 4-oct, que
// responde "ya estaba verificada" al ver UNA salida aprobada, convertía eso en permanente:
// el reintento decía "listo" y lo que faltaba no se aprobaba nunca, dejando salidas
// pendientes que además bloquean el Conteo total del mes.
//
// Medido el 2026-10-04: 0 filas "por descontar" en las 32.345 de invtrans y 0 órdenes a
// medias. Esto cierra un riesgo latente, no un daño existente.

import { describe, expect, it } from "vitest"
import { decidirConfirmacion, itemsPorProcesar, textoYaVerificada, type FilaSalida } from "@/lib/picking-estado"

const apr = (id: number, extra: Partial<FilaSalida> = {}): FilaSalida => ({ id, status: "aprobado", creado: "2026-10-04T10:00:00Z", creadopor: "Ander Fabian", ...extra })
const pend = (id: number, extra: Partial<FilaSalida> = {}): FilaSalida => ({ id, status: "por descontar", ...extra })

describe("qué hacer con una confirmación de picking", () => {
  it("orden sin empezar: se procesa", () => {
    const d = decidirConfirmacion([pend(1), pend(2)])
    expect(d.accion).toBe("procesar")
    expect(d.porDescontar).toBe(2)
  })

  it("orden ya verificada por completo: éxito, para que el trabajador deje de reintentar", () => {
    const d = decidirConfirmacion([apr(1), apr(2)])
    expect(d.accion).toBe("ya_verificada")
    expect(d.aprobadas).toBe(2)
  })

  it("CONFIRMACIÓN A MEDIAS: hay aprobadas y todavía quedan pendientes, hay que reanudar", () => {
    const d = decidirConfirmacion([apr(1), pend(2, { nombreproducto: "PT LA NIEVE 25LB", lote: "20260930", cantidad: 40 })])
    expect(d.accion).toBe("reanudar")
    expect(d.aprobadas).toBe(1)
    expect(d.porDescontar).toBe(1)
    expect(d.pendientesTexto).toBe("PT LA NIEVE 25LB lote 20260930 (40)")
  })

  it("tolera las variantes de digitación del status en la base", () => {
    // En invtrans conviven 'aprobado', 'Aprobado', 'Aprobaado' y 'Aprrobado'.
    expect(decidirConfirmacion([{ id: 1, status: "Aprobado" }]).accion).toBe("ya_verificada")
    expect(decidirConfirmacion([{ id: 1, status: "Aprobaado" }]).accion).toBe("ya_verificada")
    expect(decidirConfirmacion([{ id: 1, status: "Aprrobado" }]).accion).toBe("ya_verificada")
  })

  it("un lote alterno sin usar no convierte la orden en incompleta", () => {
    // Puede quedar legítimamente sin usar: el alterno no resta del restante.
    const d = decidirConfirmacion([apr(1), { id: 2, status: "Lote alterno" }])
    expect(d.accion).toBe("ya_verificada")
    expect(d.alternosPendientes).toBe(1)
  })

  it("orden sin ninguna salida: se procesa", () => {
    expect(decidirConfirmacion([]).accion).toBe("procesar")
  })

  // Gerencia (2026-10-04): "la asignación de lotes indica que se debe despachar en el picking
  // y a la vez deja el producto en inventario en stock, para evitar que otras órdenes de
  // cargue tomen este mismo producto; asignar un lote no significa que se despachó".
  it("una línea asignada que NADIE verificó es una reserva, no una falta", () => {
    const d = decidirConfirmacion([apr(1), pend(99, { nombreproducto: "PT TOÑITA 25 LB" })], new Set([1]))
    expect(d.accion).toBe("ya_verificada")
    expect(d.porDescontar).toBe(0)
    expect(d.reservas).toBe(1)
  })

  it("si la línea pendiente SÍ es de esta confirmación, se reanuda", () => {
    const d = decidirConfirmacion([apr(1), pend(2, { nombreproducto: "PT LA NIEVE 25LB" })], new Set([1, 2]))
    expect(d.accion).toBe("reanudar")
    expect(d.porDescontar).toBe(1)
    expect(d.reservas).toBe(0)
  })

  it("sin lista de verificadas se comporta como antes: toda pendiente cuenta", () => {
    expect(decidirConfirmacion([apr(1), pend(99)]).accion).toBe("reanudar")
  })

  it("el mensaje de la ya verificada dice cuándo y quién", () => {
    const d = decidirConfirmacion([apr(1, { creado: "2026-08-04T10:47:18Z", creadopor: "Coordinador Indupan" })])
    expect(textoYaVerificada(d)).toContain("2026-08-04 10:47")
    expect(textoYaVerificada(d)).toContain("Coordinador Indupan")
  })

  it("toma la PRIMERA aprobada para el mensaje, no la última", () => {
    const d = decidirConfirmacion([apr(2, { creado: "2026-08-04T12:00:00Z", creadopor: "Segundo" }), apr(1, { creado: "2026-08-04T10:00:00Z", creadopor: "Primero" })])
    expect(textoYaVerificada(d)).toContain("Primero")
  })
})

describe("al reanudar solo se procesa lo que falta", () => {
  it("salta los items cuya línea ya se procesó", () => {
    const items = [{ id: 10 }, { id: 11 }, { id: 12 }]
    expect(itemsPorProcesar(items, new Set([11, 12])).map((i) => i.id)).toEqual([11, 12])
  })

  it("mantiene el item si lo que falta es su lote alterno", () => {
    const items = [{ id: 10, alternoScans: [{ alternoId: 99 }] }, { id: 11 }]
    expect(itemsPorProcesar(items, new Set([99])).map((i) => i.id)).toEqual([10])
  })

  it("mantiene el item si lo que falta es su alterno simple", () => {
    const items = [{ id: 10, alternoSimple: [{ alternoId: 77 }] }]
    expect(itemsPorProcesar(items, new Set([77])).map((i) => i.id)).toEqual([10])
  })

  it("si no falta nada, no se procesa nada", () => {
    expect(itemsPorProcesar([{ id: 10 }, { id: 11 }], new Set())).toEqual([])
  })
})
