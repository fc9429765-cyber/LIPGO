// Lectura de SOLO LECTURA de los errores capturados por la app (tabla app_errores, SQL 217).
// Uso:  npx tsx --env-file=.env.local scripts/verificar_errores_app.mts [dias=7]
// Imprime: errores por mensaje (agrupados) en los últimos N días y los 20 más recientes.
import { getSupabaseAdminAsSystem } from "../lib/supabase-admin"

const dias = Number(process.argv[2] ?? 7)
const sb: any = await getSupabaseAdminAsSystem()
const desde = new Date(Date.now() - dias * 86400000).toISOString()
const { data, error } = await sb
  .from("app_errores")
  .select("id, created_at, origen, mensaje, modulo, url, usuario, empresa_id, version, entorno, resuelto")
  .gte("created_at", desde)
  .order("created_at", { ascending: false })
  .limit(2000)
if (error) {
  console.error("No se pudo leer app_errores:", error.message, "→ ¿ya corriste scripts/217_app_errores.sql?")
  process.exit(1)
}
const filas: any[] = data ?? []
console.log(`\n== Errores de la app · últimos ${dias} días · ${filas.length} registros ==`)
const grupos = new Map<string, { n: number; ultimo: string; modulos: Set<string>; usuarios: Set<string>; origen: string; abiertos: number }>()
for (const f of filas) {
  const k = String(f.mensaje).slice(0, 120)
  const g = grupos.get(k) ?? { n: 0, ultimo: f.created_at, modulos: new Set(), usuarios: new Set(), origen: f.origen, abiertos: 0 }
  g.n++
  if (f.modulo) g.modulos.add(f.modulo)
  if (f.usuario) g.usuarios.add(f.usuario)
  if (!f.resuelto) g.abiertos++
  grupos.set(k, g)
}
for (const [msg, g] of [...grupos.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30)) {
  console.log(`\n  ${String(g.n).padStart(4)} ×  [${g.origen}] ${msg}`)
  console.log(`        último ${g.ultimo} · pantallas: ${[...g.modulos].slice(0, 5).join(", ") || "—"} · usuarios: ${g.usuarios.size} · sin resolver: ${g.abiertos}`)
}
console.log(`\n== Últimos 20 ==`)
for (const f of filas.slice(0, 20)) console.log(`  ${f.created_at}  #${f.id}  [${f.origen}] ${f.entorno ?? ""} ${f.version ?? ""}  ${f.modulo ?? "-"}  ${f.usuario ?? "-"}  ID${f.empresa_id ?? "-"}  ${String(f.mensaje).slice(0, 110)}`)
console.log()
