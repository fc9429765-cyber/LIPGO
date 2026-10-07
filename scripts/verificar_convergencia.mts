// Corre las comprobaciones de convergencia (las mismas del cron /api/cron/convergencia)
// contra la base, en SOLO LECTURA, y las imprime. No envía correo ni registra nada.
//
// Uso (desde la raíz del repo):
//   npx tsx --env-file=.env.local scripts/verificar_convergencia.mts
//   npx tsx --env-file=.env.local scripts/verificar_convergencia.mts --json
import { getSupabaseAdminAsSystem } from "../lib/supabase-admin"
import { correrChecks } from "../lib/convergencia-checks"
import { lineasConvergencia, resumirChecks } from "../lib/convergencia"

const sb: any = await getSupabaseAdminAsSystem()
const inicio = Date.now()
const resumen = resumirChecks(await correrChecks(sb))
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(resumen, null, 1))
} else {
  for (const l of lineasConvergencia(resumen)) console.log(l)
  console.log(`\n(${Math.round((Date.now() - inicio) / 100) / 10} s)`)
}
process.exit(resumen.criticos > 0 ? 2 : resumen.alertas > 0 || resumen.sinDatos > 0 ? 1 : 0)
