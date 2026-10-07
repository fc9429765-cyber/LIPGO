// LA ORDEN DE CARGUE MANDA. Regla de gerencia del 2026-10-07: puede salir MENOS que la orden
// (merma, y queda pendiente), NUNCA más, y nunca un producto que la orden no incluía.
//
// Estas pruebas reproducen el incidente real de ID3 del 6 de octubre: la asignación de la
// orden MOL202610069899 (4 líneas, 330 und) se guardó con la canasta de MOL202610069896
// (23 líneas, 1.011 und). La validación del navegador pasó perfecto porque comparó la canasta
// de la 9896 contra las cantidades de la 9896. Esta regla corre en el servidor y la rechaza.

import { describe, expect, it } from "vitest"
import { normalizarProducto, validarAsignacionContraOrden } from "@/lib/asignacion-lote-regla"

// Lo que la orden MOL202610069899 autorizó de verdad.
const ORDEN_9899 = [
  { producto: "PT FIDEO 250*24PQ", cantidad: 50 },
  { producto: "PT ESPAGUETI 250GR*24PQ", cantidad: 40 },
  { producto: "PT HARINA PREC MAIZ 24LB BLANCA", cantidad: 40 },
  { producto: "PT LA NIEVE 25LB", cantidad: 200 },
]

// La canasta que de verdad se guardó bajo su número: la de la orden 9896.
const CANASTA_9896 = [
  { producto: "PT ESPAGUETI CAPRISSIMA 1000GR*12PQ", cantidad: 410, lote: "20260914", location: "A17" },
  { producto: "PT CONCHAS 250*24", cantidad: 50, lote: "20260918", location: "A6" },
  { producto: "PT ESPAGUETI 1000GR*12PQ", cantidad: 25, lote: "20260813", location: "A5" },
  { producto: "PT ESPAGUETI 250GR*24PQ", cantidad: 35, lote: "20260829", location: "A1" },
  { producto: "PT ESPAGUETI 500GR*24PQ", cantidad: 25, lote: "20260825", location: "A22" },
  { producto: "PT FIDEO 250*24PQ", cantidad: 120, lote: "20260915", location: "A7" },
  { producto: "PT HARINA PREC MAIZ 20 KG CATEDRAL", cantidad: 45, lote: "20260908", location: "A12" },
  { producto: "PT HARINA PREC MAIZ 24LB BLANCA", cantidad: 16, lote: "20260901", location: "A14" },
  { producto: "PT LA NIEVE 25LB", cantidad: 160, lote: "20260914", location: "A2" },
  { producto: "PT LA NIEVE 25LB LEUDANTE", cantidad: 40, lote: "20260903", location: "E38" },
  { producto: "PT MACARRON C.250GR*24PQ", cantidad: 40, lote: "20260920", location: "A8" },
  { producto: "PT TORNILLOS 250GR*24PQ", cantidad: 24, lote: "20260806", location: "A3" },
  { producto: "PT TORNILLOS 250GR*24PQ", cantidad: 21, lote: "20260807", location: "A3" },
]

describe("el incidente del 6 de octubre en ID3", () => {
  it("la canasta de otra orden se rechaza", () => {
    const r = validarAsignacionContraOrden(ORDEN_9899, CANASTA_9896)
    expect(r.ok).toBe(false)
  })

  it("señala los 8 productos que la orden no incluía", () => {
    const r = validarAsignacionContraOrden(ORDEN_9899, CANASTA_9896)
    const fuera = r.diferencias.filter((d) => d.motivo === "fuera_de_la_orden")
    expect(fuera).toHaveLength(8)
    expect(fuera.reduce((s, d) => s + d.asignado, 0)).toBe(680)
  })

  it("señala el fideo, que iba por encima de lo autorizado", () => {
    const r = validarAsignacionContraOrden(ORDEN_9899, CANASTA_9896)
    const demas = r.diferencias.filter((d) => d.motivo === "mas_que_la_orden")
    expect(demas).toHaveLength(1)
    expect(demas[0].producto).toBe("PT FIDEO 250*24PQ")
    expect(demas[0].autorizado).toBe(50)
    expect(demas[0].asignado).toBe(120)
    expect(demas[0].exceso).toBe(70)
  })

  it("el mensaje le dice al operario que la pantalla quedó con otra orden", () => {
    const r = validarAsignacionContraOrden(ORDEN_9899, CANASTA_9896)
    expect(r.mensaje).toContain("No se guardó nada")
    expect(r.mensaje).toContain("NO incluye")
    expect(r.mensaje).toContain("otra orden")
  })

  it("la misma canasta contra SU propia orden sí pasa", () => {
    // Las 23 líneas de la 9896 suman, por producto, exactamente lo que salió.
    const orden9896 = [
      { producto: "PT ESPAGUETI CAPRISSIMA 1000GR*12PQ", cantidad: 410 },
      { producto: "PT CONCHAS 250*24", cantidad: 20 },
      { producto: "PT CONCHAS 250*24", cantidad: 30 },
      { producto: "PT ESPAGUETI 1000GR*12PQ", cantidad: 10 },
      { producto: "PT ESPAGUETI 1000GR*12PQ", cantidad: 15 },
      { producto: "PT ESPAGUETI 250GR*24PQ", cantidad: 15 },
      { producto: "PT ESPAGUETI 250GR*24PQ", cantidad: 20 },
      { producto: "PT ESPAGUETI 500GR*24PQ", cantidad: 10 },
      { producto: "PT ESPAGUETI 500GR*24PQ", cantidad: 15 },
      { producto: "PT FIDEO 250*24PQ", cantidad: 20 },
      { producto: "PT FIDEO 250*24PQ", cantidad: 100 },
      { producto: "PT HARINA PREC MAIZ 20 KG CATEDRAL", cantidad: 15 },
      { producto: "PT HARINA PREC MAIZ 20 KG CATEDRAL", cantidad: 30 },
      { producto: "PT HARINA PREC MAIZ 24LB BLANCA", cantidad: 6 },
      { producto: "PT HARINA PREC MAIZ 24LB BLANCA", cantidad: 10 },
      { producto: "PT LA NIEVE 25LB", cantidad: 10 },
      { producto: "PT LA NIEVE 25LB", cantidad: 150 },
      { producto: "PT LA NIEVE 25LB LEUDANTE", cantidad: 10 },
      { producto: "PT LA NIEVE 25LB LEUDANTE", cantidad: 30 },
      { producto: "PT MACARRON C.250GR*24PQ", cantidad: 15 },
      { producto: "PT MACARRON C.250GR*24PQ", cantidad: 25 },
      { producto: "PT TORNILLOS 250GR*24PQ", cantidad: 15 },
      { producto: "PT TORNILLOS 250GR*24PQ", cantidad: 30 },
    ]
    expect(validarAsignacionContraOrden(orden9896, CANASTA_9896).ok).toBe(true)
  })
})

describe("la regla, caso por caso", () => {
  it("asignar exactamente lo autorizado pasa", () => {
    const r = validarAsignacionContraOrden([{ producto: "A", cantidad: 100 }], [{ producto: "A", cantidad: 100 }])
    expect(r.ok).toBe(true)
    expect(r.diferencias).toHaveLength(0)
  })

  it("asignar MENOS pasa: es la merma y queda pendiente", () => {
    expect(validarAsignacionContraOrden([{ producto: "A", cantidad: 100 }], [{ producto: "A", cantidad: 80 }]).ok).toBe(true)
  })

  it("una sola unidad de más se rechaza", () => {
    const r = validarAsignacionContraOrden([{ producto: "A", cantidad: 100 }], [{ producto: "A", cantidad: 101 }])
    expect(r.ok).toBe(false)
    expect(r.diferencias[0].exceso).toBe(1)
  })

  it("la suma de varios lotes de la misma línea es la que cuenta", () => {
    const r = validarAsignacionContraOrden(
      [{ producto: "A", cantidad: 100 }],
      [
        { producto: "A", cantidad: 60, lote: "L1" },
        { producto: "A", cantidad: 50, lote: "L2" },
      ],
    )
    expect(r.ok).toBe(false)
    expect(r.diferencias[0].asignado).toBe(110)
  })

  it("una orden que repite el producto en varias líneas autoriza la suma", () => {
    const r = validarAsignacionContraOrden(
      [
        { producto: "A", cantidad: 60 },
        { producto: "A", cantidad: 50 },
      ],
      [{ producto: "A", cantidad: 110 }],
    )
    expect(r.ok).toBe(true)
  })

  it("un producto que la orden no incluye se rechaza aunque los demás cuadren", () => {
    const r = validarAsignacionContraOrden(
      [{ producto: "A", cantidad: 100 }],
      [
        { producto: "A", cantidad: 100 },
        { producto: "B", cantidad: 1 },
      ],
    )
    expect(r.ok).toBe(false)
    expect(r.diferencias).toHaveLength(1)
    expect(r.diferencias[0].motivo).toBe("fuera_de_la_orden")
  })

  it("una orden sin detalle no autoriza nada", () => {
    const r = validarAsignacionContraOrden([], [{ producto: "A", cantidad: 1 }])
    expect(r.ok).toBe(false)
    expect(r.mensaje).toContain("no tiene productos autorizados")
  })

  it("no inventa un rechazo cuando no hay nada asignado", () => {
    expect(validarAsignacionContraOrden([{ producto: "A", cantidad: 100 }], []).ok).toBe(true)
  })

  it("la mayúscula y los espacios de más no cambian el juicio", () => {
    expect(normalizarProducto("  indupan   panificacion  50 kg. ")).toBe("INDUPAN PANIFICACION 50 KG.")
    const r = validarAsignacionContraOrden(
      [{ producto: "Indupan Panificacion 50 Kg.", cantidad: 100 }],
      [{ producto: "INDUPAN  PANIFICACION 50 KG.", cantidad: 100 }],
    )
    expect(r.ok).toBe(true)
  })

  it("no pelea por centésimas en cantidades decimales", () => {
    expect(validarAsignacionContraOrden([{ producto: "A", cantidad: 10.5 }], [{ producto: "A", cantidad: 10.5005 }]).ok).toBe(true)
    expect(validarAsignacionContraOrden([{ producto: "A", cantidad: 10.5 }], [{ producto: "A", cantidad: 10.6 }]).ok).toBe(false)
  })

})

describe("el lote alterno no se suma al techo, y por qué", () => {
  // El 2026-10-04 se intentó sumar el alterno al techo y hubo que revertirlo porque bloqueaba
  // cargues legítimos. Medido el 2026-10-07 sobre toda la base: existe UN movimiento con status
  // "Lote alterno", la orden IND202606226011 de ID5, con firme 150 + alterno 20 contra 150
  // autorizadas. Esta prueba es ese caso real: no se puede rechazar.
  it("el caso real de ID5: firme 150 más alterno 20 contra 150 autorizadas NO se bloquea", () => {
    const r = validarAsignacionContraOrden(
      [{ producto: "HARINA LA NIEVE 1000 GR. X 10 UND.", cantidad: 150 }],
      [
        { producto: "HARINA LA NIEVE 1000 GR. X 10 UND.", cantidad: 150, esAlterno: false },
        { producto: "HARINA LA NIEVE 1000 GR. X 10 UND.", cantidad: 20, esAlterno: true },
      ],
    )
    expect(r.ok).toBe(true)
  })

  it("pero el firme solo sí tiene techo: 101 firmes contra 100 se rechaza aunque haya alterno", () => {
    const r = validarAsignacionContraOrden(
      [{ producto: "A", cantidad: 100 }],
      [
        { producto: "A", cantidad: 101, esAlterno: false },
        { producto: "A", cantidad: 5, esAlterno: true },
      ],
    )
    expect(r.ok).toBe(false)
    expect(r.diferencias[0].motivo).toBe("mas_que_la_orden")
    expect(r.diferencias[0].asignado).toBe(101)
    expect(r.diferencias[0].exceso).toBe(1)
  })

  it("un alterno NO puede meter un producto que la orden no tiene", () => {
    // Un lote de sustitución sustituye algo de la orden; no agrega un producto nuevo.
    const r = validarAsignacionContraOrden(
      [{ producto: "A", cantidad: 100 }],
      [
        { producto: "A", cantidad: 100, esAlterno: false },
        { producto: "B", cantidad: 5, esAlterno: true },
      ],
    )
    expect(r.ok).toBe(false)
    expect(r.diferencias).toHaveLength(1)
    expect(r.diferencias[0].motivo).toBe("fuera_de_la_orden")
    expect(r.diferencias[0].producto).toBe("B")
  })

  it("sin la marca, una línea cuenta como firme", () => {
    const r = validarAsignacionContraOrden([{ producto: "A", cantidad: 100 }], [{ producto: "A", cantidad: 120 }])
    expect(r.ok).toBe(false)
  })
})
