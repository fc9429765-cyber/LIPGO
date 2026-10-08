// Catálogo de políticas por acción (lib/politicas-modulos.ts) y su SQL (262).
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { MODULE_PERMISSION_MAP } from "@/lib/permissions-map"
import { SEPARADOR_ACCION, VERBOS, esClaveAccion, partirClaveAccion } from "@/lib/permisos-verbos"
import {
  POLITICAS,
  PROCESOS_NUEVOS,
  accionesPorClave,
  claveAccion,
  clavesDeAcciones,
  nivelDe,
  paresLlaveAccion,
  procesoDeAccion,
  procesosDeAcciones,
  validarPoliticas,
} from "@/lib/politicas-modulos"
import { columnas262, sql262 } from "@/lib/politicas-sql"
import { CLAVES_PERMISO } from "@/lib/permisos-claves"

describe("catálogo de políticas", () => {
  it("es coherente (módulos existentes, un nivel por verbo, columnas ≤ 63, procesos conocidos)", () => {
    expect(validarPoliticas()).toEqual([])
  })
  it("ninguna llave de módulo contiene el separador de acción", () => {
    for (const k of Object.values(MODULE_PERMISSION_MAP)) expect(String(k).includes(SEPARADOR_ACCION)).toBe(false)
  })
  it("las claves de acción se reconocen y se parten bien", () => {
    expect(esClaveAccion("config_clientes__crear")).toBe(true)
    expect(esClaveAccion("config_clientes")).toBe(false)
    expect(esClaveAccion("ciclo_facturacion_jefe")).toBe(false)
    expect(partirClaveAccion("gestion_ordenes__exportar")).toEqual({ llave: "gestion_ordenes", verbo: "exportar" })
    expect(partirClaveAccion("sig_matriz__volar")).toBeNull()
  })
  it("resuelve nivel, columna y proceso", () => {
    expect(nivelDe("Clientes", "crear")).toBe("silenciosa")
    expect(claveAccion("Clientes", "crear")).toBe("config_clientes__crear")
    expect(claveAccion("Clientes", "ver")).toBe("config_clientes")
    expect(nivelDe("Gestión de Ordenes", "eliminar")).toBe("clave")
    expect(claveAccion("Gestión de Ordenes", "eliminar")).toBeNull()
    expect(procesoDeAccion("Gestión de Ordenes", "eliminar")).toBe("ord_eliminar")
    expect(procesoDeAccion("Cuadre de Inventario", "aprobar")).toEqual(["inv_601_aprobar", "inv_702_aprobar", "inv_555_aprobar"])
    expect(nivelDe("Dashboard Pedidos", "crear")).toBeNull()
    expect(claveAccion("Módulo inexistente", "crear")).toBeNull()
  })
  it("una llave compartida une las acciones de todas sus pantallas", () => {
    const porLlave = accionesPorClave()
    const sig = porLlave.get("sig_matriz")!.map((a) => a.verbo)
    expect(sig).toEqual(["crear", "editar", "eliminar", "configurar"])
    const panel = porLlave.get("sig_matriz")!.find((a) => a.verbo === "crear")!
    expect(panel.modulos).toContain("Dashboard SIG")
    expect(panel.modulos).toContain("Mapa de Procesos")
  })
  it("todas las claves de acción entran en CLAVES_PERMISO y están ordenadas por verbo", () => {
    const claves = clavesDeAcciones()
    expect(claves.length).toBeGreaterThan(150)
    for (const k of claves) {
      expect(CLAVES_PERMISO.has(k)).toBe(true)
      expect(esClaveAccion(k)).toBe(true)
      expect(k.length).toBeLessThanOrEqual(63)
    }
    for (const acciones of accionesPorClave().values()) {
      const idx = acciones.map((a) => VERBOS.indexOf(a.verbo))
      expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    }
  })
  it("los 18 procesos nuevos están declarados y citados", () => {
    expect(PROCESOS_NUEVOS.map((p) => p.codigo).sort()).toEqual(
      [
        "bas_corregir", "fac_corregir_orden", "fac_emitir_siigo", "fac_prefactura_aprobar", "fac_prefactura_prod_aprobar",
        "fac_registrar_pago", "fac_tarifas", "inv_acta_firmar", "inv_cierre_mes", "inv_cuadre_cerrar_mes",
        "nom_ajustes_aprobar", "nom_archivo_plano", "nom_liquidacion_aprobar", "nom_parametros", "nom_periodo_pagar", "nom_vacaciones_liquidar",
        "ord_eliminar", "seg_usuario_eliminar",
      ].sort(),
    )
    const citados = new Set(procesosDeAcciones().map((p) => p.codigo))
    for (const p of PROCESOS_NUEVOS) expect(citados.has(p.codigo)).toBe(true)
  })
  it("cada módulo del catálogo existe en el mapa de permisos", () => {
    for (const modulo of Object.keys(POLITICAS)) expect(MODULE_PERMISSION_MAP[modulo], modulo).toBeTruthy()
  })
})

describe("SQL 262", () => {
  it("el archivo versionado es exactamente lo que produce el catálogo", () => {
    const archivo = readFileSync(new URL("../scripts/262_permisos_acciones.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n")
    expect(archivo).toBe(sql262())
  })
  it("crea una columna por cada clave de acción y siembra solo al crearla", () => {
    const sql = sql262()
    for (const col of columnas262()) expect(sql).toContain(`'${col}'`)
    expect(paresLlaveAccion().length).toBe(columnas262().length)
    expect(sql).toContain("add column %I boolean not null default false")
    expect(sql).toContain("set %I = true where %I is true")
    expect(sql).toContain("('politicas_acciones_modo', 'aviso')")
    expect(sql).toContain("notify pgrst, 'reload schema'")
    for (const p of PROCESOS_NUEVOS) expect(sql).toContain(`'${p.codigo}'`)
    // Todo en public, escrito.
    expect(sql).not.toMatch(/\b(from|into|table|update)\s+(permisos_usuarios|autorizacion_|acceso_perfil)/)
  })
})
