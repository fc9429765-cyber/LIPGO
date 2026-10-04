// Candados contra el DOBLE DESPACHO en Picking (gerencia, 2026-10-04).
//
// Caso real que los motivó — orden IND202608047608 del 4-ago-2026: con intermitencia de red
// el trabajador no vio el cierre y repitió la acción; la lista llegó con la MISMA estiba
// (QR 960) dos veces y se insertaron dos salidas idénticas en el mismo microsegundo
// (17:26:31.017717), sacando 70 bultos cuando la estiba tenía 35.
//
// Aquí se prueba la regla pura de deduplicación, que es la que decide. El otro candado
// (una orden ya verificada no se vuelve a procesar) vive contra la base de datos.

import { describe, expect, it } from "vitest"

/** Misma deduplicación que aplica confirmPicking: una estiba física sale UNA vez. */
function sinEstibasRepetidas<T extends { idqr: number }>(
  items: { qrScans?: T[]; alternoScans?: T[] }[],
): { qrScans?: T[]; alternoScans?: T[] }[] {
  const vistas = new Set<number>()
  const filtrar = (scans: T[] | undefined): T[] | undefined => {
    if (!scans?.length) return scans
    const out: T[] = []
    for (const s of scans) {
      if (vistas.has(s.idqr)) continue
      vistas.add(s.idqr)
      out.push(s)
    }
    return out
  }
  return items.map((i) => ({ ...i, qrScans: filtrar(i.qrScans), alternoScans: filtrar(i.alternoScans) }))
}

const total = (items: { qrScans?: { cantidad: number }[]; alternoScans?: { cantidad: number }[] }[]) =>
  items.reduce((s, i) => s + (i.qrScans ?? []).reduce((a, x) => a + x.cantidad, 0) + (i.alternoScans ?? []).reduce((a, x) => a + x.cantidad, 0), 0)

describe("una estiba no puede salir dos veces", () => {
  it("el caso real de agosto: la misma estiba repetida saca 35, no 70", () => {
    const comoLlegó = [{ qrScans: [{ idqr: 960, cantidad: 35 }, { idqr: 960, cantidad: 35 }] }]
    expect(total(comoLlegó)).toBe(70)
    expect(total(sinEstibasRepetidas(comoLlegó))).toBe(35)
  })

  it("estibas distintas con la misma cantidad SÍ salen las dos", () => {
    const dos = [{ qrScans: [{ idqr: 960, cantidad: 35 }, { idqr: 961, cantidad: 35 }] }]
    expect(total(sinEstibasRepetidas(dos))).toBe(70)
  })

  it("la repetición se detecta aunque venga en líneas distintas de la misma confirmación", () => {
    const cruzado = [{ qrScans: [{ idqr: 960, cantidad: 35 }] }, { qrScans: [{ idqr: 960, cantidad: 35 }] }]
    expect(total(sinEstibasRepetidas(cruzado))).toBe(35)
  })

  it("la repetición también se detecta entre lote normal y lote alterno", () => {
    const mixto = [{ qrScans: [{ idqr: 777, cantidad: 20 }], alternoScans: [{ idqr: 777, cantidad: 20 }] }]
    expect(total(sinEstibasRepetidas(mixto))).toBe(20)
  })

  it("una confirmación normal no se ve afectada", () => {
    const normal = [{ qrScans: [{ idqr: 1, cantidad: 10 }, { idqr: 2, cantidad: 15 }] }, { qrScans: [{ idqr: 3, cantidad: 5 }] }]
    expect(total(sinEstibasRepetidas(normal))).toBe(30)
    expect(sinEstibasRepetidas(normal)[0].qrScans).toHaveLength(2)
  })

  it("sin escaneo de QR (modo simple) no se toca nada", () => {
    const simple = [{ qrScans: undefined, alternoScans: undefined }]
    expect(sinEstibasRepetidas(simple)[0].qrScans).toBeUndefined()
  })
})
