// REGRESIÓN del 2026-10-07.
//
// El chequeo nocturno "Salió más de lo que la orden de cargue autorizó" promete vigilar dos
// cosas: que no salga más de lo autorizado Y que no salga un producto que la orden no incluía.
// La segunda nunca se cumplió: filtraba por `fechaorden`, que en las filas FUERA_DE_LA_ORDEN
// viene NULA (no hay línea de orden de donde sacar la fecha), así que PostgREST descartaba el
// 100 % de esas filas. Quedaron invisibles 79 líneas y 7.299 unidades reales.
//
// Estas pruebas fijan el contrato: se filtra por `primera_salida`, jamás por `fechaorden`.

import { describe, expect, it } from "vitest"
import { checkSalioMasQueOrden } from "@/lib/convergencia-checks"

/** Cliente de Supabase de mentiras que apunta qué filtros le pidieron. */
function fakeSb(filas: any[], errorAlLeer?: string) {
  const visto = { tabla: "", columnas: "", in: [] as [string, any[]][], gte: [] as [string, any][], orden: [] as string[], paginas: 0 }
  const q: any = {
    select(c: string) { visto.columnas = c; return q },
    in(col: string, vals: any[]) { visto.in.push([col, vals]); return q },
    gte(col: string, v: any) { visto.gte.push([col, v]); return q },
    order(col: string) { visto.orden.push(col); return q },
    range(from: number) {
      visto.paginas++
      if (errorAlLeer) return Promise.resolve({ data: null, error: { message: errorAlLeer } })
      return Promise.resolve({ data: from === 0 ? filas : [], error: null })
    },
  }
  return { sb: { from(t: string) { visto.tabla = t; return q } }, visto }
}

const fueraDeLaOrden = {
  idempresa: 3,
  ocargue: "MOL202610069899",
  producto: "PT ESPAGUETI CAPRISSIMA 1000GR*12PQ",
  autorizado: 0,
  despachado: 410,
  estado_alerta: "FUERA_DE_LA_ORDEN",
  // Tal como la devuelve la vista: sin fecha de orden, con fecha de salida.
  fechaorden: null,
  fechacargue: null,
  primera_salida: "2026-10-06T10:00:48+00:00",
}

const salioMas = {
  idempresa: 3,
  ocargue: "MOL202610069899",
  producto: "PT FIDEO 250*24PQ",
  autorizado: 50,
  despachado: 120,
  estado_alerta: "SALIO_MAS",
  primera_salida: "2026-10-06T10:00:48+00:00",
}

describe("chequeo: salió más de lo que la orden autorizó", () => {
  it("acota por primera_salida y NUNCA por fechaorden ni fechacargue", async () => {
    const { sb, visto } = fakeSb([])
    await checkSalioMasQueOrden(sb, 30)
    expect(visto.tabla).toBe("v_orden_vs_salidas")
    const columnasFiltradas = visto.gte.map(([c]) => c)
    expect(columnasFiltradas).toEqual(["primera_salida"])
    expect(columnasFiltradas).not.toContain("fechaorden")
    expect(columnasFiltradas).not.toContain("fechacargue")
  })

  it("pide los dos estados graves, no solo el de 'salió más'", async () => {
    const { sb, visto } = fakeSb([])
    await checkSalioMasQueOrden(sb, 30)
    expect(visto.in).toHaveLength(1)
    const [columna, valores] = visto.in[0]
    expect(columna).toBe("estado_alerta")
    expect(valores).toContain("SALIO_MAS")
    expect(valores).toContain("FUERA_DE_LA_ORDEN")
  })

  it("una fila FUERA_DE_LA_ORDEN con fechaorden nula SÍ se reporta", async () => {
    const { sb } = fakeSb([fueraDeLaOrden])
    const r = await checkSalioMasQueOrden(sb, 30)
    expect(r.estado).toBe("critico")
    expect(r.casos).toBe(1)
    expect(r.ejemplos[0]).toContain("NO estaba en la orden")
    expect(r.ejemplos[0]).toContain("MOL202610069899")
  })

  it("el caso dice de qué proyecto es y cuánto salió de más", async () => {
    const { sb } = fakeSb([salioMas])
    const r = await checkSalioMasQueOrden(sb, 30)
    expect(r.ejemplos[0]).toContain("ID3")
    expect(r.ejemplos[0]).toContain("autorizado 50")
    expect(r.ejemplos[0]).toContain("salió 120")
    expect(r.ejemplos[0]).toContain("de más")
  })

  it("cuenta los dos tipos juntos: el caso real del 6 de octubre eran 9, no 1", async () => {
    const ocho = Array.from({ length: 8 }, (_, i) => ({ ...fueraDeLaOrden, producto: `PRODUCTO ${i}` }))
    const { sb } = fakeSb([...ocho, salioMas])
    const r = await checkSalioMasQueOrden(sb, 30)
    expect(r.casos).toBe(9)
  })

  it("si todo cuadra, queda en ok", async () => {
    const { sb } = fakeSb([])
    const r = await checkSalioMasQueOrden(sb, 30)
    expect(r.estado).toBe("ok")
    expect(r.casos).toBe(0)
  })

  it("si falta la vista, no dice 'ok': dice qué script correr", async () => {
    const { sb } = fakeSb([], 'relation "v_orden_vs_salidas" does not exist')
    const r = await checkSalioMasQueOrden(sb, 30)
    expect(r.estado).toBe("sin_datos")
    expect(r.motivo).toContain("63_orden_vs_salidas.sql")
  })

  it("un fallo de lectura cualquiera tampoco se reporta como 'ok'", async () => {
    const { sb } = fakeSb([], "se cayó la conexión")
    const r = await checkSalioMasQueOrden(sb, 30)
    expect(r.estado).toBe("sin_datos")
    expect(r.motivo).toContain("conexión")
  })
})
