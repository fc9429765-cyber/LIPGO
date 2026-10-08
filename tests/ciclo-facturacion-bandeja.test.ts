// A quién le llega cada paso del Ciclo de Facturación (gerencia, 2026-10-08): "el
// automatismo debe enviar los soportes a la bandeja del encargado de cartera LIP y al
// coordinador de ESE proyecto de LIP". Hasta ese día el papel "coordinador" era un permiso
// global que tenían cuatro administradores y ningún coordinador de proyecto: el anexo se
// enviaba a nadie y 59 prefacturas llevaban hasta un mes en el primer paso.

import { describe, expect, it } from "vitest"
import {
  diasEsperando,
  eventoDelCoordinador,
  papelDelPaso,
  proyectosComoCoordinadorLip,
  puedeActuarComoCoordinador,
  tareaDelCoordinador,
} from "@/lib/ciclo-facturacion-bandeja"

describe("a quién le toca cada paso", () => {
  it("enviar el anexo, facturar y cerrar son de Cartera LIP", () => {
    expect(papelDelPaso("pendiente_anexo")).toBe("cartera")
    expect(papelDelPaso("pendiente_factura")).toBe("cartera")
    expect(papelDelPaso("pendiente_cierre")).toBe("cartera")
  })

  it("las dos firmas del cliente son del coordinador del proyecto", () => {
    expect(papelDelPaso("pendiente_firma_anexo")).toBe("coordinador")
    expect(papelDelPaso("pendiente_firma_factura")).toBe("coordinador")
  })

  it("cerrado ya no espera a nadie, y un estado desconocido tampoco", () => {
    expect(papelDelPaso("cerrado")).toBeNull()
    expect(papelDelPaso(null)).toBeNull()
    expect(papelDelPaso("lo_que_sea")).toBeNull()
  })

  it("el coordinador sabe qué subir en cada paso y qué evento deja", () => {
    expect(eventoDelCoordinador("pendiente_firma_anexo")).toBe("anexo_firmado")
    expect(eventoDelCoordinador("pendiente_firma_factura")).toBe("factura_firmada")
    expect(eventoDelCoordinador("pendiente_anexo")).toBeNull()
    expect(tareaDelCoordinador("pendiente_firma_anexo")).toMatch(/anexo/i)
    expect(tareaDelCoordinador("pendiente_firma_factura")).toMatch(/factura/i)
    expect(tareaDelCoordinador("cerrado")).toBeNull()
  })
})

describe("quién es coordinador LIP de qué proyecto", () => {
  const universo = [1, 2, 3, 4, 5, 6]

  it("sale del perfil «Coordinador LIP» con alcance al proyecto", () => {
    const perfiles = [{ perfil: "Coordinador LIP", idempresa: 1 }]
    expect(proyectosComoCoordinadorLip(perfiles, universo)).toEqual([1])
  })

  it("una persona puede coordinar varios proyectos", () => {
    const perfiles = [
      { perfil: "Coordinador LIP", idempresa: 3 },
      { perfil: "Coordinador LIP", idempresa: 1 },
    ]
    expect(proyectosComoCoordinadorLip(perfiles, universo)).toEqual([1, 3])
  })

  it("otro perfil en el mismo proyecto no lo convierte en coordinador", () => {
    const perfiles = [
      { perfil: "Cartera", idempresa: 2 },
      { perfil: "Calidad", idempresa: 2 },
      { perfil: "Gerencia de proyecto", idempresa: 2 },
    ]
    expect(proyectosComoCoordinadorLip(perfiles, universo)).toEqual([])
  })

  it("el nombre del perfil se compara sin importar mayúsculas ni espacios de más", () => {
    expect(proyectosComoCoordinadorLip([{ perfil: "  coordinador lip ", idempresa: 2 }], universo)).toEqual([2])
  })

  it("un perfil desactivado no cuenta", () => {
    expect(proyectosComoCoordinadorLip([{ perfil: "Coordinador LIP", idempresa: 1, activo: false }], universo)).toEqual([])
  })

  it("alcance «todos» cubre todos los proyectos del universo", () => {
    expect(proyectosComoCoordinadorLip([{ perfil: "Coordinador LIP", idempresa: null }], [1, 2, 3])).toEqual([1, 2, 3])
  })

  it("un proyecto ENTREGADO nunca entra, ni por alcance directo ni por «todos»", () => {
    // ID4 Cedi Medellín se entregó el 26 de septiembre de 2026.
    expect(proyectosComoCoordinadorLip([{ perfil: "Coordinador LIP", idempresa: 4 }], universo)).toEqual([])
    expect(proyectosComoCoordinadorLip([{ perfil: "Coordinador LIP", idempresa: null }], universo)).toEqual([1, 2, 3, 5, 6])
  })
})

describe("quién puede dar el paso del coordinador", () => {
  it("el coordinador LIP del proyecto puede, sin necesitar el permiso global", () => {
    expect(
      puedeActuarComoCoordinador({ permisoGlobal: false, perfiles: [{ perfil: "Coordinador LIP", idempresa: 2 }], idempresa: 2 }),
    ).toBe(true)
  })

  it("el coordinador de OTRO proyecto no puede", () => {
    expect(
      puedeActuarComoCoordinador({ permisoGlobal: false, perfiles: [{ perfil: "Coordinador LIP", idempresa: 1 }], idempresa: 2 }),
    ).toBe(false)
  })

  it("el permiso global sigue valiendo como hasta hoy: nadie pierde nada", () => {
    expect(puedeActuarComoCoordinador({ permisoGlobal: true, perfiles: [], idempresa: 3 })).toBe(true)
  })

  it("sin proyecto no hay a qué aplicar el alcance", () => {
    expect(puedeActuarComoCoordinador({ permisoGlobal: false, perfiles: [{ perfil: "Coordinador LIP", idempresa: 1 }], idempresa: null })).toBe(false)
  })

  it("sobre un proyecto entregado no actúa nadie, ni con permiso global", () => {
    expect(puedeActuarComoCoordinador({ permisoGlobal: true, perfiles: [], idempresa: 4 })).toBe(false)
  })
})

describe("cuántos días lleva esperando", () => {
  it("cuenta días completos desde que entró al paso", () => {
    const ahora = new Date("2026-10-08T15:00:00Z")
    expect(diasEsperando("2026-10-01T13:00:00Z", ahora)).toBe(7)
    expect(diasEsperando("2026-10-08T10:00:00Z", ahora)).toBe(0)
  })

  it("sin fecha o con basura devuelve nulo, nunca un número inventado", () => {
    expect(diasEsperando(null)).toBeNull()
    expect(diasEsperando("no es fecha")).toBeNull()
  })
})
