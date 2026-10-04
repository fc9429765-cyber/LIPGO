// SOLO LECTURA. ¿Son ÚNICAS de verdad las llaves declaradas en lib/orden-paginacion.ts?
// Si una no lo es, las páginas de .range() pueden repetir o perder filas en silencio
// (caso real documentado: vacaciones +1 día).
import { getSupabaseAdminAsSystem } from "../lib/supabase-admin"
import { ORDEN_PAGINACION } from "../lib/orden-paginacion"
const sb: any = await getSupabaseAdminAsSystem()

async function todas(tabla: string, cols: string[]): Promise<any[] | null> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(tabla).select(cols.join(", "))
    for (const c of cols) q = q.order(c)
    const { data, error } = await q.range(from, from + 999)
    if (error) { console.log(`  ${tabla}: no se pudo leer (${error.message})`); return null }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
    if (out.length > 120000) { console.log(`  ${tabla}: demasiadas filas, se corta la muestra en ${out.length}`); break }
  }
  return out
}

const FUNCIONES = new Set(["pagonomina_rango", "archivoplano_periodo"]) // se leen por rpc, aparte
for (const [tabla, cols] of Object.entries(ORDEN_PAGINACION)) {
  if (FUNCIONES.has(tabla)) { console.log(`${tabla}: es una funcion (rpc) — comprobada aparte`); continue }
  const filas = await todas(tabla, cols)
  if (!filas) continue
  const vistos = new Map<string, number>()
  for (const r of filas) {
    const k = cols.map((c) => String((r as any)[c] ?? "")).join("|")
    vistos.set(k, (vistos.get(k) ?? 0) + 1)
  }
  const empates = [...vistos.entries()].filter(([, n]) => n > 1)
  const total = filas.length
  const estado = empates.length === 0 ? "UNICA ✓" : `NO UNICA ✗ (${empates.length} llaves repetidas)`
  console.log(`${tabla} [${cols.join(" + ")}]  filas=${total}  ${estado}`)
  for (const [k, n] of empates.slice(0, 5)) console.log(`     repetida ${n} veces: ${k.slice(0, 110)}`)
}
process.exit(0)
