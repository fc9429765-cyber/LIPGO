// Reglas del estado derivado de un pedido (lib/pedidos-estado.ts). Si alguna cambia sin
// querer, la Cola, Generar órdenes de cargue, los indicadores y la depuración se
// desalinean. Fecha fija: hoy = SÁBADO 3 de octubre de 2026; los proyectos no trabajan los domingos, así que "mañana" es el lunes 5.
import { describe, expect, it } from "vitest"
import {
  derivarEstado,
  diasEntre,
  esEstadoFinal,
  inicioDeMes,
  pesoOrdenCola,
  sumarDiasISO,
  textoMotivo,
  ESTADOS_FINALES,
  FILTRO_ABIERTOS_POSTGREST,
  MOTIVOS_DEPURACION,
} from "@/lib/pedidos-estado"

const HOY = "2026-10-03"
const base = { estado: null, aprobado: null, revisioncartera: null, ocargue: null, fechaordencargue: null, fechadeentrega: null, fecha: "2026-10-01", fecha_programada: "2026-10-06", factura: null, vehiculo: null }

describe("estados finales", () => {
  it("reconoce los cuatro literales finales sin importar mayúsculas", () => {
    expect(ESTADOS_FINALES).toEqual(["entregado", "entrega parcial", "anulado", "no entregado"])
    for (const e of ["Entregado", " ENTREGA PARCIAL ", "anulado", "No Entregado"]) expect(esEstadoFinal(e)).toBe(true)
    for (const e of [null, "", "aprobado", "parcial"]) expect(esEstadoFinal(e)).toBe(false)
  })
  it("el filtro PostgREST de abiertos excluye explícitamente 'no entregado' (que contiene 'entregado')", () => {
    expect(FILTRO_ABIERTOS_POSTGREST).toContain("estado.is.null")
    expect(FILTRO_ABIERTOS_POSTGREST).toContain("estado.not.ilike.no entregado")
    expect(FILTRO_ABIERTOS_POSTGREST).not.toContain("%entregado%")
  })
})

describe("derivarEstado · precedencia", () => {
  it("anulado y no entregado mandan sobre todo lo demás", () => {
    expect(derivarEstado({ ...base, estado: "anulado", aprobado: "si", ocargue: "X" }, HOY).estado).toBe("anulado")
    const ne = derivarEstado({ ...base, estado: "no entregado", aprobado: "si" }, HOY)
    expect(ne.estado).toBe("no_entregado")
    expect(ne.esFinal).toBe(true)
    expect(ne.siguientePaso).toBeNull()
  })
  it("entrega parcial o factura cierran; entregado es entregado", () => {
    expect(derivarEstado({ ...base, estado: "entrega parcial" }, HOY).estado).toBe("cerrado")
    const f = derivarEstado({ ...base, estado: "aprobado", factura: "F-123" }, HOY)
    expect(f.estado).toBe("cerrado")
    expect(f.etiqueta).toContain("F-123")
    expect(derivarEstado({ ...base, estado: "entregado" }, HOY).estado).toBe("entregado")
  })
  it("parcial calcula las unidades que faltan y pide cerrar pendiente", () => {
    const p = derivarEstado({ ...base, estado: "parcial", aprobado: "si", ocargue: "MOL1" }, HOY, { unidadesPedidas: 280, unidadesCargadas: 220 })
    expect(p.estado).toBe("parcial")
    expect(p.etiqueta).toBe("Parcial · faltan 60 und")
    expect(p.siguientePaso?.clave).toBe("cerrar_pendiente")
  })
  it("en cargue por orden en cabecera, por fecha de OC o por líneas con OC", () => {
    expect(derivarEstado({ ...base, aprobado: "si", ocargue: "MOL202610029808" }, HOY).estado).toBe("en_cargue")
    expect(derivarEstado({ ...base, aprobado: "si", fechaordencargue: "2026-10-02" }, HOY).estado).toBe("en_cargue")
    expect(derivarEstado({ ...base, aprobado: "si" }, HOY, { lineasConOcargue: 1 }).estado).toBe("en_cargue")
    expect(derivarEstado({ ...base, aprobado: "si", ocargue: "MOL1" }, HOY).siguientePaso?.clave).toBe("ver_oc")
  })
  it("aprobado sin fecha pide programar", () => {
    const d = derivarEstado({ ...base, aprobado: "si", fecha_programada: null }, HOY)
    expect(d.estado).toBe("aprobado_sin_programar")
    expect(d.siguientePaso?.clave).toBe("programar")
  })
  it("aprobado con promesa vencida es atrasado y crítico; hoy y mañana son info", () => {
    const a = derivarEstado({ ...base, aprobado: "si", fecha_programada: "2026-09-29" }, HOY)
    expect(a.estado).toBe("programado")
    expect(a.atrasoDias).toBe(4)
    expect(a.etiqueta).toBe("Atrasado 4 d")
    expect(a.tono).toBe("critico")
    expect(a.siguientePaso?.clave).toBe("generar_oc")
    const h = derivarEstado({ ...base, aprobado: "si", fecha_programada: HOY }, HOY)
    expect(h.esHoy).toBe(true)
    expect(h.etiqueta).toBe("Para hoy")
    const m = derivarEstado({ ...base, aprobado: "si", fecha_programada: "2026-10-05" }, HOY)
    expect(m.esManana).toBe(true)
    expect(m.etiqueta).toBe("Para mañana")
    expect(derivarEstado({ ...base, aprobado: "si", fecha_programada: "2026-10-06" }, HOY).etiqueta).toBe("Programado")
  })
  it("nuevo sin cartera pide aprobar cartera; con cartera pide aprobar", () => {
    const sin = derivarEstado({ ...base }, HOY)
    expect(sin.estado).toBe("nuevo")
    expect(sin.conCartera).toBe(false)
    expect(sin.siguientePaso?.clave).toBe("aprobar_cartera")
    const con = derivarEstado({ ...base, revisioncartera: "Cartera Indupan" }, HOY)
    expect(con.etiqueta).toBe("Nuevo · cartera lista")
    expect(con.siguientePaso?.clave).toBe("aprobar")
  })
  it("'si' se acepta con cualquier mayúscula y 'Si' no bloquea la aprobación", () => {
    expect(derivarEstado({ ...base, aprobado: "Si", fecha_programada: HOY }, HOY).estado).toBe("programado")
  })
})

describe("derivarEstado · candidatos a depuración", () => {
  it("sin rastro y con más de 15 días es candidato; con menos no", () => {
    const viejo = derivarEstado({ ...base, aprobado: "si", fecha: "2026-09-10", fecha_programada: "2026-09-15" }, HOY)
    expect(viejo.sinRastro).toBe(true)
    expect(viejo.antiguedadDias).toBe(18)
    expect(viejo.candidatoDepuracion).toBe("sin_rastro")
    const reciente = derivarEstado({ ...base, aprobado: "si", fecha: "2026-10-01", fecha_programada: "2026-10-02" }, HOY)
    expect(reciente.candidatoDepuracion).toBeNull()
  })
  it("la antigüedad se cuenta desde la fecha más reciente entre registro y promesa", () => {
    // Promesa mal digitada en enero, pero registrado el 31 de agosto: 33 días, no 273.
    const d = derivarEstado({ ...base, aprobado: null, fecha: "2026-08-31", fecha_programada: "2026-01-03" }, HOY)
    expect(d.antiguedadDias).toBe(33)
    expect(d.candidatoDepuracion).toBe("sin_rastro")
  })
  it("anterior al mes en curso es candidato aunque no lleve 15 días", () => {
    const d = derivarEstado({ ...base, aprobado: "si", fecha: "2026-09-25", fecha_programada: "2026-09-30" }, HOY)
    expect(d.antiguedadDias).toBe(3)
    expect(d.anteriorAlMes).toBe(true)
    expect(d.candidatoDepuracion).toBe("sin_rastro")
    const delMes = derivarEstado({ ...base, aprobado: "si", fecha: "2026-10-01", fecha_programada: "2026-10-02" }, HOY)
    expect(delMes.anteriorAlMes).toBe(false)
    expect(delMes.candidatoDepuracion).toBeNull()
  })
  it("con cualquier rastro logístico nunca es candidato", () => {
    for (const rastro of [{ ocargue: "MOL1" }, { vehiculo: "ABC123" }, { fechaordencargue: "2026-09-01" }, { fechadeentrega: "2026-09-01" }]) {
      const d = derivarEstado({ ...base, aprobado: "si", fecha: "2026-06-01", fecha_programada: "2026-06-05", ...rastro }, HOY)
      expect(d.sinRastro).toBe(false)
      expect(d.candidatoDepuracion).toBeNull()
    }
    expect(derivarEstado({ ...base, aprobado: "si", fecha: "2026-06-01", fecha_programada: "2026-06-05" }, HOY, { lineasConOcargue: 2 }).candidatoDepuracion).toBeNull()
  })
  it("parcial con más de 30 días (o del mes anterior) es candidato parcial", () => {
    expect(derivarEstado({ ...base, estado: "parcial", aprobado: "si", ocargue: "MOL1", fecha: "2026-08-20", fecha_programada: "2026-08-26" }, HOY).candidatoDepuracion).toBe("parcial")
    expect(derivarEstado({ ...base, estado: "parcial", aprobado: "si", ocargue: "MOL1", fecha: "2026-10-02", fecha_programada: "2026-10-02" }, HOY).candidatoDepuracion).toBeNull()
  })
})

describe("orden de la cola y utilidades", () => {
  it("ordena atrasados → hoy → mañana → futuros → sin fecha → en cargue → parciales → nuevos", () => {
    const pesos = [
      derivarEstado({ ...base, aprobado: "si", fecha_programada: "2026-09-29" }, HOY),
      derivarEstado({ ...base, aprobado: "si", fecha_programada: HOY }, HOY),
      derivarEstado({ ...base, aprobado: "si", fecha_programada: "2026-10-05" }, HOY),
      derivarEstado({ ...base, aprobado: "si", fecha_programada: "2026-10-09" }, HOY),
      derivarEstado({ ...base, aprobado: "si", fecha_programada: null }, HOY),
      derivarEstado({ ...base, aprobado: "si", ocargue: "MOL1" }, HOY),
      derivarEstado({ ...base, estado: "parcial", ocargue: "MOL1" }, HOY),
      derivarEstado({ ...base, revisioncartera: "Cartera" }, HOY),
      derivarEstado({ ...base }, HOY),
    ].map(pesoOrdenCola)
    expect(pesos).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
  it("fechas: días entre, sumar días e inicio de mes", () => {
    expect(diasEntre("2026-10-03", "2026-09-29")).toBe(4)
    expect(sumarDiasISO("2026-09-30", 1)).toBe("2026-10-01")
    expect(inicioDeMes("2026-10-03")).toBe("2026-10-01")
  })
  it("motivos de depuración: catálogo y texto con detalle", () => {
    expect(MOTIVOS_DEPURACION.map((m) => m.clave)).toEqual(["reemplazado", "desistio", "modificado", "vencido", "otro"])
    expect(textoMotivo("reemplazado", "por #238")).toBe("Reemplazado por otro pedido · por #238")
    expect(textoMotivo("vencido")).toBe("Vencido sin gestión")
    expect(textoMotivo("inexistente")).toBe("Otro")
  })
})
