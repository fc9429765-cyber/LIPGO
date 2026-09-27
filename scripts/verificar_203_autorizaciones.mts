// Verificación de SOLO LECTURA del SQL 203 (Autorizaciones por clave).
// Uso:  npx tsx --env-file=.env.local scripts/verificar_203_autorizaciones.mts
//
// Imprime: catálogo de procesos, perfiles con sus procesos, asignaciones
// sembradas (usuario → perfil · alcance), estado de claves y la fecha de
// transición. No modifica nada.
import { getSupabaseAdminAsSystem } from "../lib/supabase-admin"

const sb: any = await getSupabaseAdminAsSystem()

const { data: procesos, error: e1 } = await sb.from("autorizacion_procesos").select("codigo, grupo, nombre, con_alcance").order("orden")
if (e1) {
  console.error("autorizacion_procesos:", e1.message, "→ ¿ya corriste scripts/203_autorizaciones_por_clave.sql?")
  process.exit(1)
}
console.log(`\n== Procesos autorizables (${procesos.length}) ==`)
for (const p of procesos) console.log(`  ${p.codigo.padEnd(24)} ${p.grupo.padEnd(11)} ${p.nombre}${p.con_alcance ? "" : "  (sin alcance por proyecto)"}`)

const { data: perfiles } = await sb.from("autorizacion_perfiles").select("id, nombre, activo").order("nombre")
const { data: pp } = await sb.from("autorizacion_perfil_procesos").select("perfil_id, proceso")
console.log(`\n== Perfiles (${perfiles.length}) ==`)
for (const p of perfiles) {
  const procs = pp.filter((r: any) => r.perfil_id === p.id).map((r: any) => r.proceso)
  console.log(`  [${p.id}] ${p.nombre}${p.activo ? "" : " (inactivo)"}: ${procs.length} procesos → ${procs.join(", ")}`)
}

const { data: asig } = await sb.from("autorizacion_usuario_perfiles").select("usuario_id, perfil_id, idempresa, asignado_por")
const { data: profiles } = await sb.from("profiles").select("id, usuario, empresa_id")
const { data: emps } = await sb.from("empresas").select("id, nombre")
const nomU = new Map(profiles.map((p: any) => [p.id, p.usuario]))
const nomP = new Map(perfiles.map((p: any) => [p.id, p.nombre]))
const nomE = new Map(emps.map((e: any) => [e.id, e.nombre]))
console.log(`\n== Asignaciones (${asig.length}) ==`)
for (const a of [...asig].sort((x: any, y: any) => String(nomU.get(x.usuario_id)).localeCompare(String(nomU.get(y.usuario_id))))) {
  console.log(`  ${String(nomU.get(a.usuario_id) ?? a.usuario_id).padEnd(34)} → ${String(nomP.get(a.perfil_id)).padEnd(24)} · ${a.idempresa == null ? "TODOS los proyectos" : nomE.get(a.idempresa) ?? a.idempresa}   (${a.asignado_por})`)
}

const { data: exc } = await sb.from("autorizacion_usuario_procesos").select("usuario_id, proceso, idempresa, permitir")
console.log(`\n== Excepciones (${exc.length}) ==`)
for (const e of exc) console.log(`  ${nomU.get(e.usuario_id)} ${e.permitir ? "+" : "−"} ${e.proceso} · ${e.idempresa == null ? "TODOS" : nomE.get(e.idempresa)}`)

const { data: claves } = await sb.from("autorizacion_claves").select("usuario_id, provisional, bloqueado_hasta, actualizado_en")
console.log(`\n== Claves personales (${claves.length}) ==`)
for (const c of claves) console.log(`  ${nomU.get(c.usuario_id)}: ${c.provisional ? "PROVISIONAL" : "activa"}${c.bloqueado_hasta ? ` · bloqueada hasta ${c.bloqueado_hasta}` : ""} · ${c.actualizado_en}`)

const { data: cfg } = await sb.from("autorizacion_config").select("clave, valor")
console.log(`\n== Config ==`)
for (const c of cfg) console.log(`  ${c.clave} = ${c.valor}`)

const { data: perm } = await sb.from("permisos_usuarios").select("usuario_id, autorizaciones_clave").eq("autorizaciones_clave", true)
console.log(`\n== Administran "Autorizaciones por clave" (${perm.length}) ==`)
for (const p of perm) console.log(`  ${nomU.get(p.usuario_id)}`)

const { data: log } = await sb.from("autorizacion_log").select("created_at, usuario, proceso, resultado, autorizado_por, referencia").order("created_at", { ascending: false }).limit(15)
console.log(`\n== Últimos ${log.length} registros de la bitácora ==`)
for (const l of log) console.log(`  ${l.created_at}  ${String(l.usuario ?? "").padEnd(26)} ${l.proceso.padEnd(22)} ${l.resultado.padEnd(18)} ${l.autorizado_por ?? ""}  ${l.referencia ?? ""}`)
console.log()
