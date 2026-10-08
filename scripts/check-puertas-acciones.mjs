#!/usr/bin/env node
/**
 * Chequeo de PUERTAS POR ACCIÓN: toda escritura del servidor pasa por una puerta.
 *
 * Recorre lib/*.ts(x) con "use server" y, por cada `export async function` que
 * ESCRIBE (insert / update / delete / upsert / rpc / storage upload / auth.admin),
 * exige que el cuerpo use alguna puerta: motivoSinAccion, exigirAccion,
 * autorizarAccion, autorizar, exigirModulo, tieneModulo, exigirAdministradorUsuarios,
 * puertaConfig, autorizarBonos, clienteConPermiso, permitido(), checkModulePermission…
 *
 * Las excepciones viven en scripts/acciones-sin-puerta.json CON MOTIVO escrito:
 * autogestión del propio usuario (su clave personal), portal del colaborador (sin
 * sesión de Supabase), páginas públicas por token, helpers internos que solo
 * llaman acciones ya gateadas, y cron. Esa lista solo debería encoger.
 *
 * También falla si un componente del navegador (components/, hooks/, o un lib sin
 * "use server"/"server-only") escribe directo en la base con `.from("x").insert/
 * update/delete/upsert`: lo que escribe el navegador no pasa por NINGUNA puerta.
 *
 *   pnpm run check:puertas
 *
 * Sin dependencias, igual que los otros chequeos (regex sobre el código).
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, sep } from "node:path"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUTA_BASELINE = join(raiz, "scripts", "acciones-sin-puerta.json")

const rojo = (s) => `\x1b[31m${s}\x1b[0m`
const verde = (s) => `\x1b[32m${s}\x1b[0m`
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`
const gris = (s) => `\x1b[90m${s}\x1b[0m`

const ESCRITURA = /\.(insert|update|delete|upsert|rpc)\(|storage\s*\n?\s*\.from\([^)]*\)\s*\n?\s*\.(upload|remove)|auth\.admin\./
const PUERTA =
  /motivoSinAccion\(|exigirAccion\(|autorizarAccion\(|autorizar\(|exigirModulo\(|tieneModulo\(|exigirAdministradorUsuarios\(|assertAdmin\(|clienteConPermiso\(|permitido\(\)|verificarClave|exigirSegundoFactor|segundoFactorPendiente\(|resolverClaveAprobacion\(|checkModulePermission\(|puertaConfig\(|autorizarBonos\(/

function archivos(dir, ext) {
  const out = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...archivos(p, ext))
    else if (ext.some((e) => f.endsWith(e))) out.push(p)
  }
  return out
}
const rel = (p) => relative(raiz, p).split(sep).join("/")

const baseline = existsSync(RUTA_BASELINE) ? JSON.parse(readFileSync(RUTA_BASELINE, "utf8")) : { acciones: {}, componentes: {} }
const permitidasAcc = baseline.acciones ?? {}
const permitidosComp = baseline.componentes ?? {}

// ── 1. server actions que escriben sin puerta ──
const sinPuerta = []
let totalEscriben = 0
for (const ruta of archivos(join(raiz, "lib"), [".ts", ".tsx"])) {
  const src = readFileSync(ruta, "utf8")
  if (!src.slice(0, 300).includes('"use server"')) continue
  const re = /^export async function (\w+)\(/gm
  let m
  const inicios = []
  while ((m = re.exec(src))) inicios.push({ nombre: m[1], ini: m.index })
  for (let i = 0; i < inicios.length; i++) {
    const fin = i + 1 < inicios.length ? inicios[i + 1].ini : src.length
    const cuerpo = src.slice(inicios[i].ini, fin)
    if (!ESCRITURA.test(cuerpo)) continue
    totalEscriben++
    if (PUERTA.test(cuerpo)) continue
    sinPuerta.push(`${rel(ruta)}:${inicios[i].nombre}`)
  }
}
const nuevasAcc = sinPuerta.filter((k) => !permitidasAcc[k])
const baselineAccObsoleta = Object.keys(permitidasAcc).filter((k) => !sinPuerta.includes(k))

// ── 2. escrituras directas desde el navegador ──
const candidatos = [
  ...archivos(join(raiz, "components"), [".tsx", ".ts"]),
  ...archivos(join(raiz, "hooks"), [".ts", ".tsx"]),
  ...archivos(join(raiz, "lib"), [".ts"]).filter((p) => {
    const cab = readFileSync(p, "utf8").slice(0, 300)
    return !cab.includes('"use server"') && !cab.includes("server-only")
  }),
]
const directas = []
for (const ruta of candidatos) {
  const src = readFileSync(ruta, "utf8")
  if (!src.includes(".from(")) continue
  const re = /\.from\("([a-z_0-9]+)"\)([\s\S]{0,300}?)\.(insert|update|delete|upsert)\(/g
  let m
  while ((m = re.exec(src))) directas.push({ archivo: rel(ruta), op: `${m[1]}.${m[3]}` })
}
const porArchivo = new Map()
for (const d of directas) {
  if (!porArchivo.has(d.archivo)) porArchivo.set(d.archivo, new Set())
  porArchivo.get(d.archivo).add(d.op)
}
const nuevasComp = [...porArchivo.keys()].filter((a) => !permitidosComp[a])
const baselineCompObsoleta = Object.keys(permitidosComp).filter((a) => !porArchivo.has(a))

console.log(
  `Puertas: ${verde(`${totalEscriben - sinPuerta.length} acciones con puerta`)} de ${totalEscriben} que escriben ` +
    gris(`(${Object.keys(permitidasAcc).length} excepciones con motivo)`) +
    ` · escrituras directas del navegador: ${porArchivo.size === 0 ? verde("0") : amarillo(String(porArchivo.size))}`,
)

let falla = false
if (nuevasAcc.length) {
  falla = true
  console.error(rojo(`\n✗ ${nuevasAcc.length} server action(s) que escriben SIN puerta y fuera de la lista blanca:`))
  for (const k of nuevasAcc) console.error(rojo(`    · ${k}`))
  console.error(
    gris(
      "\n  Pon la puerta al inicio de la función (lib/puerta-modulo.ts):\n" +
        '    const motivoAccion = await motivoSinAccion(["Módulo"], "verbo")\n' +
        "    if (motivoAccion) return { success: false, message: motivoAccion }\n" +
        "  y declara el verbo en lib/politicas-modulos.ts. Si de verdad no puede exigir módulo (portal,\n" +
        "  público por token, interno, cron), agrégala a scripts/acciones-sin-puerta.json CON el motivo.",
    ),
  )
}
if (nuevasComp.length) {
  falla = true
  console.error(rojo(`\n✗ ${nuevasComp.length} componente(s) escriben directo en la base desde el navegador:`))
  for (const a of nuevasComp) console.error(rojo(`    · ${a}  (${[...porArchivo.get(a)].join(", ")})`))
  console.error(gris("\n  Mueve la escritura a una server action con puerta. El navegador no debe escribir tablas."))
}
if (baselineAccObsoleta.length || baselineCompObsoleta.length) {
  console.warn(amarillo(`\n! Entradas de la lista blanca que ya no hacen falta; pódalas:`))
  for (const k of [...baselineAccObsoleta, ...baselineCompObsoleta]) console.warn(amarillo(`    · ${k}`))
}
if (!falla) console.log(verde("✓ Toda escritura del servidor pasa por una puerta (o tiene motivo escrito)."))
process.exit(falla ? 1 : 0)
