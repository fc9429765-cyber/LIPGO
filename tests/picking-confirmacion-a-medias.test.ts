// La confirmación del picking no es una transacción: si se interrumpe a la mitad, la orden
// queda con unas líneas aprobadas y otras en "por descontar". El candado del 4-oct, que
// responde "ya estaba verificada" al ver UNA salida aprobada, convertía eso en permanente:
// el reintento decía "listo" y lo que faltaba no se aprobaba nunca, dejando salidas
// pendientes que además bloquean el Conteo total del mes.
//
// Medido el 2026-10-04: 0 filas "por descontar" en las 32.345 de invtrans y 0 órdenes a
// medias. Esto cierra un riesgo latente, no un daño existente.

import { describe, expect, it } from "vitest"
import {
  decidirConfirmacion,
  esCuarentena,
  itemsPorProcesar,
  textoReparos,
  textoYaVerificada,
  evaluarDespacho,
  justificacionValida,
  textoDespachos,
  validarAntesDeEscribir,
  validarDespachos,
  type LineaDespacho,
  type FilaParaValidar,
  type FilaSalida,
} from "@/lib/picking-estado"

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

// TODO O NADA DE VERDAD. Gerencia (2026-10-04): "al final del picking está el botón de
// confirmar verificación, que garantiza que se verifique todo y salga, salvo una diferencia
// por daño". Hasta hoy la revisión de CUARENTENA vivía dentro del bucle: si la estiba
// bloqueada era la tercera línea, las dos primeras YA habían salido y la confirmación
// abortaba a medias. Calidad puede bloquear un palé después de la asignación y antes del
// picking (344 bloquear / 343 liberar), así que el caso es real.
describe("revisar toda la lista antes de escribir la primera línea", () => {
  const fila = (id: number, extra: Partial<FilaParaValidar> = {}): FilaParaValidar => ({ id, status: "por descontar", ...extra })

  it("sin reparos, se puede escribir", () => {
    expect(validarAntesDeEscribir([fila(1, { location: "A6" }), fila(2, { location: "B12" })], [1, 2])).toEqual([])
  })

  it("una estiba en CUARENTENA detiene la confirmación aunque sea la última línea", () => {
    const r = validarAntesDeEscribir(
      [fila(1, { location: "A6" }), fila(2, { location: "A6" }), fila(3, { location: "CUARENTENA-1", nombreproducto: "PT LA NIEVE 25LB", lote: "20260930" })],
      [1, 2, 3],
    )
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ tipo: "cuarentena", id: 3, lote: "20260930" })
    expect(textoReparos(r)).toContain("No se despachó nada")
    expect(textoReparos(r)).toContain("343")
  })

  it("avisa de todas las estibas bloqueadas en un solo mensaje", () => {
    const r = validarAntesDeEscribir(
      [fila(1, { location: "cuarentena", nombreproducto: "A" }), fila(2, { location: "CUARENTENA 2", nombreproducto: "B" })],
      [1, 2],
    )
    expect(r).toHaveLength(2)
    expect(textoReparos(r)).toContain("2 estibas")
  })

  it("una línea que ya no existe también detiene la confirmación", () => {
    const r = validarAntesDeEscribir([fila(1, { location: "A6" })], [1, 99])
    expect(r).toEqual([{ tipo: "no_existe", id: 99 }])
    expect(textoReparos(r)).toContain("recargar la lista")
  })

  it("una fila YA APROBADA no se revisa: su despacho ya ocurrió", () => {
    // Al reanudar, una línea aprobada antes puede estar en una ubicación que luego
    // se bloqueó; eso no puede impedir terminar lo que falta.
    const r = validarAntesDeEscribir([{ id: 1, status: "aprobado", location: "CUARENTENA-9" }], [1])
    expect(r).toEqual([])
  })

  it("reconoce la ubicación de cuarentena en cualquier forma de escritura", () => {
    expect(esCuarentena("CUARENTENA")).toBe(true)
    expect(esCuarentena("cuarentena-3")).toBe(true)
    expect(esCuarentena("Zona Cuarentena B")).toBe(true)
    expect(esCuarentena("A6")).toBe(false)
    expect(esCuarentena(null)).toBe(false)
  })
})

// Gerencia (2026-10-04): "cuando se despacha con QR la cantidad total es la suma de varios
// QR; puede ser exacta o puede quedar saldo". Ese saldo es el menor despacho legítimo, así
// que la validación previa NO mira cantidades: solo existencia, dueño y cuarentena.
describe("la validación previa no toca cantidades", () => {
  it("no se queja si lo escaneado suma menos que la línea", () => {
    const filas: FilaParaValidar[] = [{ id: 1, status: "por descontar", cantidad: 200, location: "A6", ocargue: "MOL1" }]
    expect(validarAntesDeEscribir(filas, [1], "MOL1")).toEqual([])
  })

  it("detiene la confirmación si una línea es de OTRA orden de cargue", () => {
    const filas: FilaParaValidar[] = [{ id: 1, status: "por descontar", location: "A6", ocargue: "MOL2", nombreproducto: "PT CONCHAS" }]
    const r = validarAntesDeEscribir(filas, [1], "MOL1")
    expect(r[0]).toMatchObject({ tipo: "otra_orden", ocargue: "MOL2" })
    expect(textoReparos(r)).toContain("otra orden de cargue")
  })

  it("sin pasar la orden, no se revisa el dueño (compatibilidad)", () => {
    const filas: FilaParaValidar[] = [{ id: 1, status: "por descontar", location: "A6", ocargue: "MOL2" }]
    expect(validarAntesDeEscribir(filas, [1])).toEqual([])
  })
})

// REGLA DE GERENCIA (2026-10-04): "se debe despachar completo, y si no va completo, como pocas
// veces pasa, debe haber una justificación". El saldo es válido pero nunca silencioso.
describe("despachar completo, y si queda saldo, con justificación", () => {
  const L = (extra: Partial<LineaDespacho> = {}): LineaDespacho => ({ id: 1, asignado: 200, despachado: 200, producto: "PT LA NIEVE 25LB", lote: "20260930", ...extra })

  it("la suma exacta de varios QR es un despacho completo", () => {
    expect(evaluarDespacho(L({ despachado: 200 }))).toBe("completo")
  })

  it("si queda saldo y nadie lo explica, no se puede confirmar", () => {
    expect(evaluarDespacho(L({ despachado: 160 }))).toBe("incompleto_sin_justificar")
  })

  it("con el motivo escrito, el saldo se acepta", () => {
    expect(evaluarDespacho(L({ despachado: 160, justificacion: "El cliente recibio 160, no habia mas estiba completa" }))).toBe("incompleto_justificado")
  })

  it("una justificación vacía o de relleno no vale", () => {
    expect(evaluarDespacho(L({ despachado: 160, justificacion: "   " }))).toBe("incompleto_sin_justificar")
    expect(evaluarDespacho(L({ despachado: 160, justificacion: "ok" }))).toBe("incompleto_sin_justificar")
    expect(justificacionValida("saldo")).toBe(true)
  })

  it("NUNCA se puede despachar más de lo asignado, ni con justificación", () => {
    expect(evaluarDespacho(L({ despachado: 210 }))).toBe("excede")
    expect(evaluarDespacho(L({ despachado: 210, justificacion: "el cliente pidio mas" }))).toBe("excede")
  })

  it("tolera centésimas de redondeo", () => {
    expect(evaluarDespacho(L({ asignado: 83.5, despachado: 83.5 }))).toBe("completo")
    expect(evaluarDespacho(L({ asignado: 100, despachado: 99.995 }))).toBe("completo")
  })

  it("resume una confirmación con varias líneas", () => {
    const r = validarDespachos([
      L({ id: 1, despachado: 200 }),
      L({ id: 2, despachado: 150, producto: "PT CONCHAS" }),
      L({ id: 3, despachado: 150, justificacion: "faltaron 50, se averio una estiba completa" }),
      L({ id: 4, despachado: 250, producto: "PT FIDEO" }),
    ])
    expect(r.completas).toBe(1)
    expect(r.sinJustificar.map((l) => l.id)).toEqual([2])
    expect(r.justificadas.map((l) => l.id)).toEqual([3])
    expect(r.excede.map((l) => l.id)).toEqual([4])
    const t = textoDespachos(r)
    expect(t).toContain("No se despachó nada")
    expect(t).toContain("No se puede despachar MÁS")
    expect(t).toContain("faltan 50 de 200")
  })

  it("una avería NO es un saldo: la salida se registra por el bruto escaneado", () => {
    // 200 escaneados con 10 averías sigue siendo despacho completo; la avería ya quedó
    // documentada como entrada aparte.
    expect(evaluarDespacho(L({ asignado: 200, despachado: 200 }))).toBe("completo")
  })
})
