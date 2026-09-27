// Compara la vista `archivoplano` (filtrada por mes) contra archivoplano_periodo(anio, mes)
// como MULTICONJUNTOS de filas (las filas no tienen llave única): misma cantidad de
// cada fila idéntica.
// Correr SIEMPRE después de regenerar y ejecutar scripts/201 (ver
// scripts/generar_200_201_funciones_rango.mjs). Ajustar MESES a meses con datos.
//   npx tsx --env-file=.env.local scripts/verificar_201_archivoplano_periodo.mts
import { getSupabaseAdminAsSystem } from "../lib/supabase-admin"

const MESES = [{ anio: 2026, mes: 7 }, { anio: 2026, mes: 8 }, { anio: 2026, mes: 9 }]

async function todas(q: any): Promise<any[]> {
  const out: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await q.range(off, off + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}
const canon = (r: any) => JSON.stringify(Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]])))
function conteo(rows: any[]) {
  const m = new Map<string, number>()
  for (const r of rows) { const k = canon(r); m.set(k, (m.get(k) ?? 0) + 1) }
  return m
}

async function main() {
  const sb: any = await getSupabaseAdminAsSystem()
  let ok = true
  for (const { anio, mes } of MESES) {
    const mm = String(mes).padStart(2, "0")
    const qv = sb.from("archivoplano").select("*").eq("mes", mm).order("identificacionempleado").order("quincena").order("nombrenovedad")
    const qf = sb.rpc("archivoplano_periodo", { p_anio: anio, p_mes: mes }).select("*").order("identificacionempleado").order("quincena").order("nombrenovedad")
    const t0 = performance.now(); const vista = await todas(qv); const msV = Math.round(performance.now() - t0)
    const t1 = performance.now(); const fn = await todas(qf); const msF = Math.round(performance.now() - t1)
    const cv = conteo(vista), cf = conteo(fn)
    const soloVista = [...cv].filter(([k, n]) => (cf.get(k) ?? 0) !== n).map(([k, n]) => `${k} ×${n} (fn ×${cf.get(k) ?? 0})`)
    const soloFn = [...cf].filter(([k, n]) => (cv.get(k) ?? 0) !== n).map(([k, n]) => `${k} ×${n} (vista ×${cv.get(k) ?? 0})`)
    const igual = soloVista.length === 0 && soloFn.length === 0
    ok &&= igual
    console.log(`\n${anio}-${mm}: vista ${vista.length} filas (${msV} ms) | función ${fn.length} filas (${msF} ms) → ${igual ? "IDÉNTICO" : "DIFERENTE"}`)
    if (soloVista.length) console.log("  distinto en vista:", soloVista.slice(0, 4))
    if (soloFn.length) console.log("  distinto en función:", soloFn.slice(0, 4))
  }
  console.log(ok ? "\nTODO IDÉNTICO" : "\nHAY DIFERENCIAS")
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", e.message); process.exit(1) })
