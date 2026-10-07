#!/usr/bin/env node
/**
 * Chequeo de cobertura del DICCIONARIO DE DATOS.
 *
 * Hace dos cosas que ningun humano hace de forma fiable:
 *
 *  1. AVISA CUANDO EL DICCIONARIO SE QUEDO VIEJO. Recorre el codigo buscando
 *     `.from("tabla")` y compara contra las tablas que el diccionario conoce. Si el
 *     codigo usa una tabla que el diccionario no tiene, alguien creo una tabla y no
 *     regenero: hay que correr `pnpm run diccionario`.
 *
 *  2. AVISA CUANDO UNA TABLA NUEVA LLEGA SIN DESCRIPCION. Las tablas que a hoy siguen
 *     sin describir viven en scripts/diccionario-pendientes.json (la "linea base").
 *     Esa lista solo deberia encoger: es la deuda de documentacion conocida.
 *
 *   pnpm run check:diccionario                      -> verifica
 *   pnpm run check:diccionario -- --update-baseline -> poda la linea base
 *
 * NO necesita conexion a la base: lee docs/diccionario-datos.json, que esta versionado.
 * Mientras ese archivo no exista (antes de instalar la funcion y generar por primera
 * vez), el chequeo avisa y pasa, para no romper el pipeline de nadie.
 *
 * Sin dependencias a proposito, igual que check-aprendizaje.mjs.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, extname } from "node:path"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUTA_DICCIONARIO = join(raiz, "docs", "diccionario-datos.json")
const RUTA_BASELINE = join(raiz, "scripts", "diccionario-pendientes.json")
const CARPETAS_CODIGO = ["lib", "components", "app", "hooks"]

const rojo = (s) => `\x1b[31m${s}\x1b[0m`
const verde = (s) => `\x1b[32m${s}\x1b[0m`
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`
const gris = (s) => `\x1b[90m${s}\x1b[0m`

const actualizarBaseline = process.argv.includes("--update-baseline")

// ─────────────────────────── el diccionario ───────────────────────────

if (!existsSync(RUTA_DICCIONARIO)) {
  console.warn(amarillo("· Diccionario de datos: todavia no existe docs/diccionario-datos.json."))
  console.warn(gris("  Para crearlo: correr scripts/diccionario/01_funcion_diccionario.sql en Supabase"))
  console.warn(gris("  y luego `pnpm run diccionario`. El chequeo pasa hasta entonces."))
  process.exit(0)
}

let diccionario
try {
  diccionario = JSON.parse(readFileSync(RUTA_DICCIONARIO, "utf8"))
} catch (e) {
  console.error(rojo(`✗ No pude leer ${RUTA_DICCIONARIO}: ${e.message}`))
  console.error(gris("  Regenera con: pnpm run diccionario"))
  process.exit(1)
}

const objetos = Array.isArray(diccionario?.objetos) ? diccionario.objetos : []
if (objetos.length === 0) {
  console.error(rojo("✗ El diccionario no tiene objetos. Regenera con: pnpm run diccionario"))
  process.exit(1)
}
const conocidas = new Set(objetos.map((o) => o.nombre))

// ─────────────────────────── las tablas que usa el codigo ───────────────────────────

/** Recorre una carpeta y devuelve los archivos de codigo. */
function archivosDe(carpeta) {
  const base = join(raiz, carpeta)
  if (!existsSync(base)) return []
  const out = []
  const pendientes = [base]
  while (pendientes.length) {
    const dir = pendientes.pop()
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada.startsWith(".")) continue
      const ruta = join(dir, entrada)
      const st = statSync(ruta)
      if (st.isDirectory()) pendientes.push(ruta)
      else if ([".ts", ".tsx", ".mts", ".mjs", ".js"].includes(extname(entrada))) out.push(ruta)
    }
  }
  return out
}

// `.from("tabla")` y `.from('tabla')`. Se ignoran los que llevan variable o plantilla,
// porque ahi no se puede saber el nombre sin ejecutar.
const RE_FROM = /\.from\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*\)/g
const usadas = new Map() // tabla -> Set(archivos)

for (const carpeta of CARPETAS_CODIGO) {
  for (const ruta of archivosDe(carpeta)) {
    let src
    try {
      src = readFileSync(ruta, "utf8")
    } catch {
      continue
    }
    for (const m of src.matchAll(RE_FROM)) {
      const tabla = m[1]
      if (!usadas.has(tabla)) usadas.set(tabla, new Set())
      usadas.get(tabla).add(ruta.slice(raiz.length + 1).replace(/\\/g, "/"))
    }
  }
}

// `.from()` tambien lo usan Array.from y otras APIs; se descartan los nombres que
// claramente no son tablas por no parecerse a nada del esquema conocido NI a una tabla.
const NO_SON_TABLAS = new Set(["length", "default", "window", "document"])
const desconocidas = [...usadas.keys()].filter((t) => !conocidas.has(t) && !NO_SON_TABLAS.has(t)).sort()

// ─────────────────────────── descripciones que faltan ───────────────────────────

const sinDescripcion = objetos.filter((o) => !o.descripcion).map((o) => o.nombre).sort()

function leerBaseline() {
  if (!existsSync(RUTA_BASELINE)) return { sinDescripcion: [] }
  try {
    const json = JSON.parse(readFileSync(RUTA_BASELINE, "utf8"))
    return { sinDescripcion: Array.isArray(json.sinDescripcion) ? json.sinDescripcion : [] }
  } catch (e) {
    throw new Error(`No pude leer ${RUTA_BASELINE}: ${e.message}`)
  }
}

const baseline = leerBaseline()
const conocidasSinDescripcion = new Set(baseline.sinDescripcion)
const nuevasSinDescripcion = sinDescripcion.filter((t) => !conocidasSinDescripcion.has(t))
const yaDescritas = baseline.sinDescripcion.filter((t) => !sinDescripcion.includes(t))

if (actualizarBaseline) {
  writeFileSync(
    RUTA_BASELINE,
    JSON.stringify(
      {
        _comentario:
          "Tablas y vistas que a hoy siguen SIN descripcion en la base. Es la deuda conocida: esta lista solo deberia encoger. Se describe con `comment on table public.X is '...'` en un script SQL, y luego `pnpm run diccionario`.",
        _actualizado: new Date().toISOString().slice(0, 10),
        sinDescripcion,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  )
  console.log(verde(`✓ Linea base actualizada: ${sinDescripcion.length} objeto(s) sin descripcion.`))
  process.exit(0)
}

// ─────────────────────────── el veredicto ───────────────────────────

let falla = false

console.log(
  gris(
    `· Diccionario: ${objetos.length} objetos, ${objetos.reduce((s, o) => s + (o.columnas?.length ?? 0), 0)} columnas, generado el ${String(diccionario.generado_en ?? "").slice(0, 10)}.`,
  ),
)

if (desconocidas.length > 0) {
  falla = true
  console.error(rojo(`\n✗ El diccionario esta viejo: el codigo usa ${desconocidas.length} tabla(s) que no estan en el.`))
  for (const t of desconocidas) {
    const d = [...usadas.get(t)].slice(0, 2).join(", ")
    console.error(rojo(`    · ${t}`) + gris(`  (${d}${usadas.get(t).size > 2 ? ", …" : ""})`))
  }
  console.error(amarillo("\n  Regenera el diccionario:  pnpm run diccionario"))
  console.error(gris("  (si alguno de esos nombres no es una tabla, agregalo a NO_SON_TABLAS en este script)"))
}

if (nuevasSinDescripcion.length > 0) {
  falla = true
  console.error(rojo(`\n✗ ${nuevasSinDescripcion.length} tabla(s) o vista(s) NUEVAS llegaron sin descripcion:`))
  for (const t of nuevasSinDescripcion) console.error(rojo(`    · ${t}`))
  console.error(amarillo("\n  Describelas en la base, en el mismo script SQL que las creo:"))
  console.error(gris(`    comment on table public.${nuevasSinDescripcion[0]} is 'Para que sirve, en una frase.';`))
  console.error(amarillo("  Luego: pnpm run diccionario"))
  console.error(gris("  Si de verdad no toca describirlas ahora: pnpm run check:diccionario -- --update-baseline"))
}

if (yaDescritas.length > 0) {
  console.warn(amarillo(`\n· ${yaDescritas.length} objeto(s) de la deuda YA tienen descripcion. Poda la linea base:`))
  for (const t of yaDescritas.slice(0, 10)) console.warn(gris(`    · ${t}`))
  console.warn(amarillo("  pnpm run check:diccionario -- --update-baseline"))
}

if (!falla) {
  const deuda = sinDescripcion.length
  console.log(
    verde(`✓ Diccionario al dia.`) +
      gris(` ${usadas.size} tabla(s) usadas por el codigo, todas conocidas.${deuda ? ` Deuda conocida: ${deuda} sin descripcion.` : ""}`),
  )
}

process.exit(falla ? 1 : 0)
