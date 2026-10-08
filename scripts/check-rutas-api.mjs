#!/usr/bin/env node
/**
 * Chequeo de PUERTAS en las rutas /api.
 *
 * Una ruta de app/api es una URL pública. Si no pregunta quién llama, responde a
 * cualquiera, con o sin sesión. Hasta la Fase 0 del plan de políticas por acción
 * (2026-10-07) la mayoría no preguntaba. Este chequeo recorre app/api/⁎⁎/route.ts
 * y FALLA si una ruta no usa ninguna de estas puertas:
 *
 *   · exigirSesionApi / exigirModuloApi   (lib/puerta-api.ts)
 *   · el cliente de sesión (createServerClient de @/lib/supabase-server, o @supabase/ssr
 *     con cookies): la base aplica RLS como `authenticated`, así que sin sesión no hay datos
 *   · getCurrentUser / checkModulePermission / getUserPermissions
 *   · CRON_SECRET (rutas de cron, llamadas por Vercel con Authorization: Bearer)
 *
 * ...y no está en la línea base scripts/rutas-api-sin-puerta.json con un MOTIVO escrito.
 * La línea base es para rutas que de verdad no pueden exigir sesión (el reporte CSP del
 * navegador, el webhook de WhatsApp con su propia verificación, el portal del colaborador
 * que no usa la sesión de Supabase). Solo debería encoger.
 *
 *   pnpm run check:rutas-api
 *
 * Sin dependencias, igual que los otros chequeos.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, sep } from "node:path"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUTA_API = join(raiz, "app", "api")
const RUTA_BASELINE = join(raiz, "scripts", "rutas-api-sin-puerta.json")

const rojo = (s) => `\x1b[31m${s}\x1b[0m`
const verde = (s) => `\x1b[32m${s}\x1b[0m`
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`
const gris = (s) => `\x1b[90m${s}\x1b[0m`

const PUERTAS = [
  /exigirSesionApi|exigirModuloApi/,
  /from "@\/lib\/supabase-server"/,
  /from "@supabase\/ssr"/,
  /getCurrentUser|checkModulePermission|getUserPermissions|exigirAdministradorUsuarios|exigirModulo|exigirAccion|motivoSinAccion/,
  /CRON_SECRET/,
]

function rutas(dir) {
  const out = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...rutas(p))
    else if (f === "route.ts") out.push(p)
  }
  return out
}

function nombre(p) {
  return relative(RUTA_API, dirname(p)).split(sep).join("/")
}

const baseline = existsSync(RUTA_BASELINE) ? JSON.parse(readFileSync(RUTA_BASELINE, "utf8")) : { rutas: {} }
const permitidas = baseline.rutas ?? {}

const todas = rutas(RUTA_API).sort()
const sinPuerta = []
const conPuerta = []
for (const p of todas) {
  const src = readFileSync(p, "utf8")
  if (PUERTAS.some((re) => re.test(src))) conPuerta.push(nombre(p))
  else sinPuerta.push(nombre(p))
}

const nuevas = sinPuerta.filter((r) => !permitidas[r])
const baselineObsoleta = Object.keys(permitidas).filter((r) => !sinPuerta.includes(r))

console.log(`Rutas /api: ${verde(`${conPuerta.length} con puerta`)} · ${sinPuerta.length} sin puerta ${gris(`(${Object.keys(permitidas).length} en la línea base)`)}`)

let falla = false
if (nuevas.length) {
  falla = true
  console.error(rojo(`\n✗ ${nuevas.length} ruta(s) sin ninguna puerta y fuera de la línea base:`))
  for (const r of nuevas) console.error(rojo(`    · app/api/${r}/route.ts`))
  console.error(
    gris(
      "\n  Pon la puerta al inicio del handler (lib/puerta-api.ts):\n" +
        "    const puerta = await exigirSesionApi()      // lecturas\n" +
        "    if (puerta) return puerta\n" +
        "    const puerta = await exigirModuloApi([\"Módulo\"]) // escrituras\n" +
        "  Si de verdad no puede exigir sesión, agrégala a scripts/rutas-api-sin-puerta.json CON el motivo.",
    ),
  )
}
if (baselineObsoleta.length) {
  console.warn(amarillo(`\n! ${baselineObsoleta.length} entrada(s) de la línea base ya tienen puerta o no existen; pódalas:`))
  for (const r of baselineObsoleta) console.warn(amarillo(`    · ${r}`))
}
if (!falla) console.log(verde("✓ Todas las rutas /api tienen puerta o motivo escrito."))
process.exit(falla ? 1 : 0)
