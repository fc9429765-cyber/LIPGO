#!/usr/bin/env node
/**
 * Chequeo de cobertura del modulo "Aprendizaje".
 *
 * Compara los modulos que realmente existen en el menu (`groups` de
 * lib/dashboard-data.ts) contra las guias escritas en
 * lib/aprendizaje-content.ts, y falla cuando aparece un modulo NUEVO sin
 * guia. Asi, crear un modulo y olvidar documentarlo rompe el chequeo.
 *
 * Los modulos que a hoy siguen sin documentar viven en
 * scripts/aprendizaje-pendientes.json (la "linea base"). Esa lista solo
 * deberia encogerse: es la deuda de documentacion conocida.
 *
 *   pnpm run check:aprendizaje                    -> verifica
 *   pnpm run check:aprendizaje -- --update-baseline -> poda la linea base
 *
 * Sin dependencias a proposito: el proyecto no tiene tsx/ts-node, asi que se
 * extraen los datos de los .ts con expresiones regulares. Los formatos que
 * parsea son los que ya usan esos archivos; si cambian de forma, este script
 * lo reporta como "no pude leer", nunca en silencio.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUTA_GRUPOS = join(raiz, "lib", "dashboard-data.ts")
const RUTA_CATALOGO = join(raiz, "lib", "aprendizaje-content.ts")
const RUTA_BASELINE = join(raiz, "scripts", "aprendizaje-pendientes.json")
const RUTA_AREAS = join(raiz, "lib", "aprendizaje")

const rojo = (s) => `\x1b[31m${s}\x1b[0m`
const verde = (s) => `\x1b[32m${s}\x1b[0m`
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`
const gris = (s) => `\x1b[90m${s}\x1b[0m`

/** Modulos del menu: `{ name: "X", icon: Y }` dentro de lib/dashboard-data.ts. */
function leerModulosDelMenu() {
  const src = readFileSync(RUTA_GRUPOS, "utf8")
  const nombres = [...src.matchAll(/\{\s*name:\s*"([^"]+)"/g)].map((m) => m[1])
  if (nombres.length === 0) {
    throw new Error(`No se encontro ningun modulo en ${RUTA_GRUPOS}. ¿Cambio el formato de \`groups\`?`)
  }
  return [...new Set(nombres)]
}

/** Modulos con permiso (claves de MODULE_PERMISSION_MAP en lib/permissions-map.ts), esten o no en el menu. */
function leerModulosConPermiso() {
  try {
    const src = readFileSync(join(raiz, "lib", "permissions-map.ts"), "utf8")
    const ini = src.indexOf("MODULE_PERMISSION_MAP")
    const cuerpo = ini >= 0 ? src.slice(ini) : src
    // Claves con comillas ("Gestión de Ordenes": "x") o sin ellas (Picking: "x").
    const nombres = [...cuerpo.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z_][\w]*)):\s*"[a-z0-9_]+"/gm)].map((m) => m[1] ?? m[2])
    return [...new Set(nombres)]
  } catch {
    return []
  }
}

/** Guias escritas: entradas `modulo: "X"` en lib/aprendizaje-content.ts y lib/aprendizaje/*.ts. */
function leerModulosDocumentados() {
  let areas = []
  try {
    areas = readdirSync(RUTA_AREAS).filter((f) => f.endsWith(".ts")).map((f) => join(RUTA_AREAS, f))
  } catch { /* carpeta aun no creada */ }
  const nombres = []
  for (const archivo of [RUTA_CATALOGO, ...areas]) {
    const src = readFileSync(archivo, "utf8")
    nombres.push(...[...src.matchAll(/^\s*modulo:\s*"([^"]+)"/gm)].map((m) => m[1]))
  }
  return [...new Set(nombres)]
}

function leerBaseline() {
  try {
    const json = JSON.parse(readFileSync(RUTA_BASELINE, "utf8"))
    if (!Array.isArray(json.pendientes)) throw new Error("falta el arreglo `pendientes`")
    return json.pendientes
  } catch (e) {
    if (e.code === "ENOENT") return []
    throw new Error(`No pude leer ${RUTA_BASELINE}: ${e.message}`)
  }
}

function escribirBaseline(pendientes) {
  const contenido = {
    _comentario:
      "Modulos que todavia NO tienen guia en lib/aprendizaje-content.ts. Esta lista solo deberia encoger. " +
      "Si agregas un modulo nuevo al menu, documentalo en el catalogo en vez de agregarlo aqui.",
    pendientes: [...pendientes].sort((a, b) => a.localeCompare(b)),
  }
  writeFileSync(RUTA_BASELINE, JSON.stringify(contenido, null, 2) + "\n", "utf8")
}

// ---------------------------------------------------------------------------

const actualizarBaseline = process.argv.includes("--update-baseline")

const delMenu = leerModulosDelMenu()
const documentados = leerModulosDocumentados()
const baseline = leerBaseline()

const setMenu = new Set(delMenu)
const setDocumentados = new Set(documentados)
const setBaseline = new Set(baseline)

// 1. Modulos del menu sin guia y que NO estan en la linea base = modulos
//    nuevos que alguien olvido documentar. Esto es lo que rompe el chequeo.
const nuevosSinGuia = delMenu.filter((m) => !setDocumentados.has(m) && !setBaseline.has(m))

// 2. Guias que apuntan a un modulo que no existe en el menu (typo o modulo
//    renombrado/eliminado). Tambien rompe: la guia seria inalcanzable.
//    EXCEPCION (reorg de navegacion 2026-09-30): modulos que siguen existiendo
//    con permiso y rama de codigo pero se RETIRARON del menu a proposito
//    (p. ej. "Gestion integral de pedidos", "Ingresos MP"). Su guia se
//    conserva para cuando vuelvan y LIPbot puede seguir consultandola: se
//    reporta como aviso, no como error.
const enPermisos = new Set(leerModulosConPermiso())
const guiasOcultas = documentados.filter((m) => !setMenu.has(m) && enPermisos.has(m))
const guiasHuerfanas = documentados.filter((m) => !setMenu.has(m) && !enPermisos.has(m))

// 3. Entradas de la linea base que ya fueron documentadas, o que ya no
//    existen en el menu: solo hay que podarlas. No rompe el chequeo.
const baselineObsoleta = baseline.filter((m) => setDocumentados.has(m) || !setMenu.has(m))

if (actualizarBaseline) {
  const nueva = delMenu.filter((m) => !setDocumentados.has(m))
  escribirBaseline(nueva)
  console.log(verde(`✓ Linea base actualizada: ${nueva.length} modulo(s) pendiente(s) de documentar.`))
  process.exit(0)
}

const documentadosDelMenu = delMenu.filter((m) => setDocumentados.has(m)).length
console.log(
  `Aprendizaje: ${verde(`${documentadosDelMenu} documentado(s)`)} de ${delMenu.length} modulo(s) del menu ` +
    gris(`(${delMenu.length - documentadosDelMenu} pendiente(s))`),
)

let falla = false

if (nuevosSinGuia.length > 0) {
  falla = true
  console.error(
    rojo(`\n✗ ${nuevosSinGuia.length} modulo(s) NUEVO(S) sin guia en lib/aprendizaje-content.ts:`),
  )
  for (const m of nuevosSinGuia) console.error(rojo(`    · ${m}`))
  console.error(
    "\n  Agrega su entrada al catalogo (resumen, proposito, puedes, noPuedes,\n" +
      "  funcionalidades). Si de verdad se debe posponer, corre:\n" +
      "    pnpm run check:aprendizaje -- --update-baseline",
  )
}

if (guiasHuerfanas.length > 0) {
  falla = true
  console.error(rojo(`\n✗ ${guiasHuerfanas.length} guia(s) apuntan a un modulo que no existe en el menu:`))
  for (const m of guiasHuerfanas) console.error(rojo(`    · ${m}`))
  console.error(
    "\n  El campo `modulo` debe coincidir EXACTAMENTE (tildes incluidas) con el\n" +
      "  `name` del modulo en lib/dashboard-data.ts.",
  )
}

if (guiasOcultas.length > 0) {
  console.warn(amarillo(`\n! ${guiasOcultas.length} guia(s) de modulos retirados del menu (con permiso, sin entrada en dashboard-data): se conservan.`))
  for (const m of guiasOcultas) console.warn(amarillo(`    · ${m}`))
}

if (baselineObsoleta.length > 0) {
  console.warn(amarillo(`\n! ${baselineObsoleta.length} entrada(s) de la linea base ya se pueden podar:`))
  for (const m of baselineObsoleta) console.warn(amarillo(`    · ${m}`))
  console.warn(amarillo("  Corre: pnpm run check:aprendizaje -- --update-baseline"))
}

if (falla) process.exit(1)

console.log(verde("\n✓ Sin modulos nuevos sin documentar."))
