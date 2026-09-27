// Foto de SOLO LECTURA de permisos_usuarios (todas las filas, todas las columnas),
// ordenada por usuario, para comparar ANTES y DESPUÉS de correr un SQL y
// demostrar que la configuración de módulos por usuario no cambió.
//
// Uso:
//   npx tsx --env-file=.env.local scripts/snapshot_permisos_usuarios.mts <archivo.json>
//   (guarda la foto)  y luego, con un segundo archivo:
//   npx tsx --env-file=.env.local scripts/snapshot_permisos_usuarios.mts <antes.json> <despues.json>
//   (compara: lista columnas nuevas y cualquier valor que haya cambiado)
import { readFileSync, writeFileSync } from "node:fs"
import { getSupabaseAdminAsSystem } from "../lib/supabase-admin"

const [a, b] = process.argv.slice(2)
if (!a) {
  console.error("Indica el archivo destino (o dos archivos para comparar).")
  process.exit(1)
}

if (a && b) {
  const antes = JSON.parse(readFileSync(a, "utf8")) as Record<string, Record<string, unknown>>
  const despues = JSON.parse(readFileSync(b, "utf8")) as Record<string, Record<string, unknown>>
  const cols = (o: Record<string, Record<string, unknown>>) => new Set(Object.values(o).flatMap((r) => Object.keys(r)))
  const cA = cols(antes)
  const cB = cols(despues)
  const nuevas = [...cB].filter((c) => !cA.has(c))
  const quitadas = [...cA].filter((c) => !cB.has(c))
  console.log(`Usuarios antes: ${Object.keys(antes).length} · después: ${Object.keys(despues).length}`)
  console.log(`Columnas nuevas: ${nuevas.join(", ") || "ninguna"}`)
  console.log(`Columnas quitadas: ${quitadas.join(", ") || "ninguna"}`)
  let cambios = 0
  for (const [usuario, fila] of Object.entries(antes)) {
    const f2 = despues[usuario]
    if (!f2) {
      console.log(`  FALTA usuario ${usuario}`)
      cambios++
      continue
    }
    for (const [col, val] of Object.entries(fila)) {
      if (col === "updated_at") continue
      if (JSON.stringify(val) !== JSON.stringify(f2[col])) {
        console.log(`  CAMBIÓ ${usuario}.${col}: ${JSON.stringify(val)} → ${JSON.stringify(f2[col])}`)
        cambios++
      }
    }
  }
  for (const usuario of Object.keys(despues)) if (!antes[usuario]) { console.log(`  NUEVO usuario ${usuario}`); cambios++ }
  console.log(cambios === 0 ? "\nRESULTADO: ningún permiso existente cambió." : `\nRESULTADO: ${cambios} diferencia(s).`)
  for (const c of nuevas) {
    const con = Object.entries(despues).filter(([, r]) => r[c] === true).map(([u]) => u)
    console.log(`Columna nueva "${c}" en true para: ${con.join(", ") || "nadie"}`)
  }
  process.exit(0)
}

const sb: any = await getSupabaseAdminAsSystem()
const { data: perms, error } = await sb.from("permisos_usuarios").select("*").order("usuario_id")
if (error) throw new Error(error.message)
const { data: profiles } = await sb.from("profiles").select("id, usuario")
const nombre = new Map<string, string>((profiles ?? []).map((p: any) => [p.id, p.usuario]))
const out: Record<string, Record<string, unknown>> = {}
for (const r of perms ?? []) {
  const { id: _id, ...resto } = r
  out[`${nombre.get(r.usuario_id) ?? "?"} <${r.usuario_id}>`] = resto
}
// OJO: no usar un array como "replacer" de JSON.stringify (filtraría las claves
// de las filas y dejaría los objetos vacíos). Se ordena construyendo el objeto.
const ordenado: Record<string, Record<string, unknown>> = {}
for (const k of Object.keys(out).sort()) ordenado[k] = out[k]
writeFileSync(a, JSON.stringify(ordenado, null, 2), "utf8")
console.log(`Foto guardada: ${a} (${Object.keys(out).length} usuarios, ${new Set(Object.values(out).flatMap((r) => Object.keys(r))).size} columnas)`)
