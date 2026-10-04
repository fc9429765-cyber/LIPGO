// Reglas puras de la vigilancia de accesos (lib/vigilancia-cuentas.ts).
import { describe, expect, it } from "vitest"
import { PERMISOS_SENSIBLES, asuntoVigilancia, hayAlgoQueAvisar, htmlVigilancia, lineasVigilancia, type Hallazgos } from "@/lib/vigilancia-cuentas"

const vacio: Hallazgos = { desde: "3 oct 2026, 7:00 a. m.", cuentasNuevas: [], cambios: [] }

const conTodo: Hallazgos = {
  desde: "3 oct 2026, 7:00 a. m.",
  cuentasNuevas: [
    { correo: "test@test.com", nombre: "test@test.com", creada: "16 sept 2026, 9:25 a. m.", permisos: 179, sensibles: ["Estado de Resultados", "Gastos (registrar y dashboard)"], sinPerfil: false },
    { correo: "nuevo@lipgo.app", nombre: null, creada: "4 oct 2026, 8:10 a. m.", permisos: 0, sensibles: [], sinPerfil: true },
  ],
  cambios: [
    { cuando: "4 oct 2026, 9:00 a. m.", actor: "Admon Indupan", afectado: "Coordinador Avimol", otorgados: ["Estado de Resultados"], retirados: [] },
    { cuando: "4 oct 2026, 9:30 a. m.", actor: "Admon Indupan", afectado: "Bodega Avimol", otorgados: [], retirados: ["Nómina de Personal"] },
  ],
}

describe("qué se considera sensible", () => {
  it("incluye lo financiero y el control de accesos", () => {
    for (const k of ["estadoresultados", "gastos", "nominapersonal", "liquidaciones", "parafiscales", "gestion_usuarios", "accesos_usuario", "autorizaciones_clave"]) {
      expect(PERMISOS_SENSIBLES[k]).toBeTruthy()
    }
  })
  it("no marca como sensible un módulo operativo del cliente", () => {
    for (const k of ["entrada_pedidos", "gestionar_pedidos", "bascula", "registrar_vehiculos", "transacciones_inventario"]) {
      expect(PERMISOS_SENSIBLES[k]).toBeUndefined()
    }
  })
})

describe("cuándo avisar", () => {
  it("sin novedades no se avisa", () => {
    expect(hayAlgoQueAvisar(vacio)).toBe(false)
  })
  it("una cuenta nueva o un cambio sensible sí se avisa", () => {
    expect(hayAlgoQueAvisar(conTodo)).toBe(true)
    expect(hayAlgoQueAvisar({ ...vacio, cambios: conTodo.cambios })).toBe(true)
  })
})

describe("redacción del aviso", () => {
  it("el asunto resume cuentas y cambios", () => {
    expect(asuntoVigilancia(conTodo)).toBe("LIPgo · Accesos: 2 cuentas nuevas y 2 cambios de permisos sensibles")
  })
  it("el texto nombra la cuenta, quién dio el permiso y cuál", () => {
    const t = lineasVigilancia(conTodo).join("\n")
    expect(t).toContain("test@test.com")
    expect(t).toContain("CON ACCESO A: Estado de Resultados")
    expect(t).toContain("SIN PERFIL")
    expect(t).toContain("Admon Indupan dio acceso a Estado de Resultados")
    expect(t).toContain("quitó acceso a Nómina de Personal")
  })
  it("el HTML escapa el texto y pone el enlace", () => {
    const html = htmlVigilancia({ ...vacio, cuentasNuevas: [{ correo: "<b>x</b>@y.com", nombre: null, creada: "hoy", permisos: 1, sensibles: [], sinPerfil: false }] }, "https://www.lipgo.app/?g=configuracion", "pie")
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;@y.com")
    expect(html).not.toContain("<b>x</b>@y.com")
    expect(html).toContain('href="https://www.lipgo.app/?g=configuracion"')
  })
})
