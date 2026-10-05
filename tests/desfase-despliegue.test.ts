// Pestaña vieja tras un despliegue. Los mensajes de prueba son los REALES que quedaron en
// app_errores el 2026-10-04/05 (4 usuarios en Avimol, Cedi e Indupan).

import { describe, expect, it } from "vitest"
import { debeRecargar, esErrorDeDesfase, VENTANA_RECARGA_MS } from "@/lib/desfase-despliegue"

describe("reconocer un error de pestaña vieja", () => {
  it("el JS de la versión anterior ya no existe (mensaje real)", () => {
    expect(esErrorDeDesfase("Failed to load chunk /_next/static/chunks/0e~354u4l2wbq.js?dpl=dpl_56hXfcnVRGk9hKh5g4HCFbiMg3Xr from module 811402")).toBe(true)
  })

  it("la acción del servidor de la versión anterior ya no existe (mensaje real)", () => {
    expect(esErrorDeDesfase('Server Action "409049ea8c89b2bbddd66a3d8646593c34729e5ad9" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action')).toBe(true)
  })

  it("las variantes clásicas que ya reconocía el boundary siguen reconocidas", () => {
    expect(esErrorDeDesfase("ChunkLoadError: Loading chunk 123 failed")).toBe(true)
    expect(esErrorDeDesfase("Failed to fetch dynamically imported module: https://www.lipgo.app/_next/x.js")).toBe(true)
    expect(esErrorDeDesfase("Importing a module script failed.")).toBe(true)
    expect(esErrorDeDesfase("CSS_CHUNK_LOAD_FAILED")).toBe(true)
  })

  it("un error normal de la app NO es de desfase: no se recarga por cualquier cosa", () => {
    expect(esErrorDeDesfase("No se pudo cargar el pedido")).toBe(false)
    expect(esErrorDeDesfase("Cannot read properties of undefined (reading 'map')")).toBe(false)
    expect(esErrorDeDesfase("Uncaught ")).toBe(false)
    expect(esErrorDeDesfase(null)).toBe(false)
  })
})

describe("la recarga automática tiene guarda", () => {
  it("la primera vez recarga", () => {
    expect(debeRecargar(1_000_000, 0)).toBe(true)
  })

  it("dentro de la ventana no vuelve a recargar: evita el bucle", () => {
    const ahora = 1_000_000
    expect(debeRecargar(ahora, ahora - 5_000)).toBe(false)
    expect(debeRecargar(ahora, ahora - VENTANA_RECARGA_MS + 1)).toBe(false)
  })

  it("pasada la ventana vuelve a permitirse", () => {
    const ahora = 1_000_000
    expect(debeRecargar(ahora, ahora - VENTANA_RECARGA_MS - 1)).toBe(true)
  })

  it("un valor basura en el almacenamiento cuenta como nunca", () => {
    expect(debeRecargar(1_000_000, Number.NaN)).toBe(true)
  })
})
