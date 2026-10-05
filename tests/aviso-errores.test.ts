// Aviso diario de errores de la app. Una tabla de errores que nadie lee no sirve: esto
// agrupa lo del día y arma el correo. Regla: si no hay errores, no se manda nada, porque un
// aviso que casi siempre dice "todo bien" se deja de leer.

import { describe, expect, it } from "vitest"
import { agruparErrores, asuntoErrores, hayErroresQueAvisar, htmlErrores, huellaMensaje, lineasErrores, type ErrorRegistrado } from "@/lib/aviso-errores"

const E = (extra: Partial<ErrorRegistrado> = {}): ErrorRegistrado => ({
  id: 1,
  creado: "2026-10-04T14:30:00Z",
  origen: "cliente",
  mensaje: "No se pudo cargar el pedido",
  modulo: "pedidos-cola.getColaPedidos",
  url: "https://www.lipgo.app/",
  usuario: "coordinador@lipgo.app",
  empresa_id: 2,
  version: "126ae67",
  entorno: "production",
  ...extra,
})

describe("huella del mensaje para agrupar el mismo problema", () => {
  it("quita los ids largos, las fechas y los UUID", () => {
    const a = huellaMensaje("Error en el pedido 11221 del 2026-10-04")
    const b = huellaMensaje("Error en el pedido 9899 del 2026-09-30")
    expect(a).toBe(b)
  })

  it("quita los UUID", () => {
    const a = huellaMensaje("usuario 3f1a9c4e-11bb-4a55-9d2e-7c8f0a1b2c3d sin permiso")
    const b = huellaMensaje("usuario 99887766-aaaa-bbbb-cccc-ddddeeeeffff sin permiso")
    expect(a).toBe(b)
  })

  it("no junta problemas distintos", () => {
    expect(huellaMensaje("No se pudo guardar")).not.toBe(huellaMensaje("No se pudo leer"))
  })

  it("los códigos de movimiento se conservan: 601 y 702 son problemas distintos", () => {
    expect(huellaMensaje("codigo 601")).not.toBe(huellaMensaje("codigo 702"))
    expect(huellaMensaje("cuarentena 343")).not.toBe(huellaMensaje("cuarentena 344"))
  })
})

describe("agrupar los errores del día", () => {
  it("sin errores no hay nada que avisar", () => {
    const r = agruparErrores([])
    expect(r.total).toBe(0)
    expect(hayErroresQueAvisar(r)).toBe(false)
    expect(asuntoErrores(r, "4 de octubre")).toContain("sin errores")
  })

  it("cuenta las veces y no repite usuarios", () => {
    const r = agruparErrores([
      E({ id: 1, usuario: "a@lipgo.app" }),
      E({ id: 2, usuario: "a@lipgo.app" }),
      E({ id: 3, usuario: "b@lipgo.app" }),
    ])
    expect(r.total).toBe(3)
    expect(r.grupos).toHaveLength(1)
    expect(r.grupos[0].veces).toBe(3)
    expect(r.grupos[0].usuarios).toEqual(["a@lipgo.app", "b@lipgo.app"])
    expect(r.usuariosAfectados).toBe(2)
  })

  it("junta el mismo problema aunque el mensaje traiga ids distintos", () => {
    const r = agruparErrores([
      E({ id: 1, mensaje: "No se pudo cargar el pedido 11221" }),
      E({ id: 2, mensaje: "No se pudo cargar el pedido 9899" }),
    ])
    expect(r.grupos).toHaveLength(1)
    expect(r.grupos[0].veces).toBe(2)
  })

  it("separa por módulo aunque el mensaje sea igual", () => {
    const r = agruparErrores([E({ id: 1, modulo: "picking" }), E({ id: 2, modulo: "despachos" })])
    expect(r.grupos).toHaveLength(2)
  })

  it("ordena del problema más frecuente al menos frecuente", () => {
    const r = agruparErrores([
      E({ id: 1, modulo: "raro", mensaje: "falla rara" }),
      E({ id: 2, modulo: "comun", mensaje: "falla comun" }),
      E({ id: 3, modulo: "comun", mensaje: "falla comun" }),
      E({ id: 4, modulo: "comun", mensaje: "falla comun" }),
    ])
    expect(r.grupos[0].modulo).toBe("comun")
    expect(r.grupos[0].veces).toBe(3)
  })

  it("guarda la primera y la última hora, y el mensaje del más reciente", () => {
    const r = agruparErrores([
      E({ id: 1, creado: "2026-10-04T08:00:00Z", mensaje: "No se pudo cargar el pedido 11221" }),
      E({ id: 2, creado: "2026-10-04T17:45:00Z", mensaje: "No se pudo cargar el pedido 9899" }),
    ])
    expect(r.grupos).toHaveLength(1)
    expect(r.grupos[0].primera).toBe("2026-10-04T08:00:00Z")
    expect(r.grupos[0].ultima).toBe("2026-10-04T17:45:00Z")
    expect(r.grupos[0].mensaje).toContain("pedido 9899")
  })

  it("cuenta cuántos vienen del servidor y cuántos del navegador", () => {
    const r = agruparErrores([E({ id: 1, origen: "servidor" }), E({ id: 2, origen: "cliente" }), E({ id: 3, origen: "cliente" })])
    expect(r.porOrigen[0]).toEqual({ origen: "cliente", veces: 2 })
    expect(r.porOrigen[1]).toEqual({ origen: "servidor", veces: 1 })
  })

  it("tolera filas sin usuario, sin módulo y sin versión", () => {
    const r = agruparErrores([E({ id: 1, usuario: null, modulo: null, version: null, origen: null })])
    expect(r.grupos[0].modulo).toBe("sin módulo")
    expect(r.grupos[0].origen).toBe("desconocido")
    expect(r.usuariosAfectados).toBe(0)
  })
})

describe("el correo", () => {
  const r = agruparErrores([E({ id: 1 }), E({ id: 2, modulo: "picking", mensaje: "estiba en cuarentena" })])

  it("el asunto dice cuántos y en cuántos puntos", () => {
    expect(asuntoErrores(r, "4 de octubre")).toBe("LIPgo · 2 errores en 2 puntos · 4 de octubre")
  })

  it("el texto plano trae cada grupo", () => {
    const l = lineasErrores(r).join("\n")
    expect(l).toContain("picking")
    expect(l).toContain("estiba en cuarentena")
    expect(l).toContain("usuarios afectados")
  })

  it("el html escapa lo que venga en el mensaje", () => {
    const peligroso = agruparErrores([E({ mensaje: '<script>alert("x")</script>' })])
    const html = htmlErrores(peligroso, "4 de octubre", "pie")
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("el html no se rompe sin usuarios ni versiones", () => {
    const sinNada = agruparErrores([E({ usuario: null, version: null })])
    expect(htmlErrores(sinNada, "4 de octubre", "pie")).toContain("Errores de la app")
  })
})
