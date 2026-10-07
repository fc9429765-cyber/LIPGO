#!/usr/bin/env node
/**
 * Chequeo de la NUMERACION de los scripts SQL.
 *
 * El proyecto numera los scripts de forma consecutiva (scripts/README.md). Cuando dos
 * personas trabajan a la vez, las dos toman "el siguiente numero" al mismo tiempo y
 * quedan dos scripts distintos con el mismo numero. Entonces la frase que mas se usa en
 * el dia a dia, "corre el 244", deja de identificar un archivo.
 *
 * Paso de verdad el 2026-10-07: 241, 243 y 244 quedaron duplicados en una sola jornada.
 *
 * Este chequeo hace dos cosas:
 *   1. Falla cuando aparece un numero duplicado NUEVO. Los que ya existen viven en la
 *      linea base y no rompen nada: renombrar un script que ya se corrio solo crearia
 *      confusion sobre que se ejecuto.
 *   2. Dice cual es el SIGUIENTE numero libre de cada serie, que es lo que uno necesita
 *      saber antes de crear uno.
 *
 *   pnpm run check:scripts                      -> verifica
 *   pnpm run check:scripts -- --update-baseline -> congela los duplicados de hoy
 *   pnpm run check:scripts -- --siguiente       -> solo dice el proximo numero libre
 *
 * Cada carpeta lleva su propia serie, como ya documenta scripts/README.md.
 * Sin dependencias, igual que los otros chequeos.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUTA_BASELINE = join(raiz, "scripts", "scripts-numeros-duplicados.json")

/** Carpetas con serie propia. El numero se lee del prefijo del nombre. */
const SERIES = [
  { carpeta: "scripts", digitos: 3 },
  { carpeta: "scripts/sig", digitos: 2 },
  { carpeta: "scripts/auditoria", digitos: 2 },
  { carpeta: "scripts/diccionario", digitos: 2 },
]

const rojo = (s) => `\x1b[31m${s}\x1b[0m`
const verde = (s) => `\x1b[32m${s}\x1b[0m`
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`
const gris = (s) => `\x1b[90m${s}\x1b[0m`

const actualizarBaseline = process.argv.includes("--update-baseline")
const soloSiguiente = process.argv.includes("--siguiente")

/** { "241": ["241_a.sql", "241_b.sql"], ... } para una carpeta. */
function numerosDe(carpeta, digitos) {
  const ruta = join(raiz, carpeta)
  if (!existsSync(ruta)) return new Map()
  const re = new RegExp(`^(\\d{${digitos}})_.+\\.sql$`)
  const mapa = new Map()
  for (const archivo of readdirSync(ruta)) {
    const m = archivo.match(re)
    if (!m) continue
    const n = m[1]
    if (!mapa.has(n)) mapa.set(n, [])
    mapa.get(n).push(archivo)
  }
  return mapa
}

function siguienteLibre(mapa, digitos) {
  const usados = [...mapa.keys()].map(Number).filter((n) => Number.isFinite(n))
  const max = usados.length ? Math.max(...usados) : 0
  return String(max + 1).padStart(digitos, "0")
}

const estado = SERIES.map(({ carpeta, digitos }) => {
  const mapa = numerosDe(carpeta, digitos)
  const duplicados = [...mapa.entries()]
    .filter(([, archivos]) => archivos.length > 1)
    .map(([n, archivos]) => ({ numero: n, archivos: archivos.sort() }))
    .sort((a, b) => a.numero.localeCompare(b.numero))
  return { carpeta, digitos, total: mapa.size, duplicados, siguiente: siguienteLibre(mapa, digitos) }
})

// ─────────────────────────── el proximo numero libre ───────────────────────────

if (soloSiguiente) {
  for (const s of estado) console.log(`${s.carpeta.padEnd(22)} siguiente libre: ${s.siguiente}`)
  process.exit(0)
}

// ─────────────────────────── linea base ───────────────────────────

const clave = (carpeta, numero) => `${carpeta}/${numero}`
const duplicadosHoy = estado.flatMap((s) => s.duplicados.map((d) => clave(s.carpeta, d.numero)))

function leerBaseline() {
  if (!existsSync(RUTA_BASELINE)) return []
  try {
    const json = JSON.parse(readFileSync(RUTA_BASELINE, "utf8"))
    return Array.isArray(json.duplicados) ? json.duplicados : []
  } catch (e) {
    throw new Error(`No pude leer ${RUTA_BASELINE}: ${e.message}`)
  }
}

if (actualizarBaseline) {
  writeFileSync(
    RUTA_BASELINE,
    JSON.stringify(
      {
        _comentario:
          "Numeros de script que YA estan duplicados. No se renombran: un script que ya se corrio debe conservar su nombre, o nadie sabe que ejecuto. Esta lista solo deberia encoger si alguna vez se consolidan. Un duplicado NUEVO si rompe el chequeo.",
        _actualizado: new Date().toISOString().slice(0, 10),
        duplicados: duplicadosHoy,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  )
  console.log(verde(`✓ Linea base actualizada: ${duplicadosHoy.length} numero(s) duplicado(s) congelado(s).`))
  process.exit(0)
}

const conocidos = new Set(leerBaseline())
const nuevos = duplicadosHoy.filter((d) => !conocidos.has(d))
const resueltos = [...conocidos].filter((d) => !duplicadosHoy.includes(d))

// ─────────────────────────── el veredicto ───────────────────────────

for (const s of estado) {
  console.log(gris(`· ${s.carpeta}: ${s.total} script(s) numerado(s). Siguiente libre: ${s.siguiente}`))
}

let falla = false

if (nuevos.length > 0) {
  falla = true
  console.error(rojo(`\n✗ ${nuevos.length} numero(s) de script quedaron duplicados:`))
  for (const s of estado) {
    for (const d of s.duplicados) {
      if (!nuevos.includes(clave(s.carpeta, d.numero))) continue
      console.error(rojo(`    ${s.carpeta}/${d.numero}:`))
      for (const a of d.archivos) console.error(rojo(`      · ${a}`))
      console.error(amarillo(`    Renombra el que todavia NO se haya corrido al ${s.siguiente}.`))
    }
  }
  console.error(
    gris(
      "\n  Antes de crear un script, pregunta el proximo numero libre:\n    pnpm run check:scripts -- --siguiente",
    ),
  )
  console.error(gris("  Si los dos ya se corrieron y hay que convivir con el duplicado:\n    pnpm run check:scripts -- --update-baseline"))
}

if (resueltos.length > 0) {
  console.warn(amarillo(`\n· ${resueltos.length} duplicado(s) de la linea base ya no existen. Podala:`))
  console.warn(gris("  pnpm run check:scripts -- --update-baseline"))
}

if (!falla) {
  console.log(verde("✓ Numeracion de scripts sin duplicados nuevos.") + (conocidos.size ? gris(` (${conocidos.size} historico(s) congelado(s))`) : ""))
}

process.exit(falla ? 1 : 0)
