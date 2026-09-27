// Compara fila por fila la vista `pagonomina` contra `pagonomina_rango(desde, hasta)`
// para varios rangos. Deben coincidir en cantidad de filas y en cada valor.
// Correr SIEMPRE después de regenerar y ejecutar scripts/200 (ver
// scripts/generar_200_201_funciones_rango.mjs). Ajustar RANGOS a fechas con datos.
//   npx tsx --env-file=.env.local scripts/verificar_200_pagonomina_rango.mts
import { getSupabaseAdminAsSystem } from "../lib/supabase-admin"

const RANGOS: { desde: string; hasta: string; idempresa?: number }[] = [
  { desde: "2026-09-01", hasta: "2026-09-26", idempresa: 3 },
  { desde: "2026-08-20", hasta: "2026-09-10" },
  { desde: "2026-08-01", hasta: "2026-08-31" },
]

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
const clave = (r: any) => `${r.persona}|${r.fecha}|${r.idempresa}|${r.idempresaliquidacion}`

async function main() {
  const sb = await getSupabaseAdminAsSystem()
  let ok = true
  for (const rg of RANGOS) {
    let qv: any = sb.from("pagonomina").select("*").gte("fecha", rg.desde).lte("fecha", rg.hasta).order("persona").order("fecha")
    let qf: any = sb.rpc("pagonomina_rango", { p_desde: rg.desde, p_hasta: rg.hasta }).select("*").order("persona").order("fecha")
    if (rg.idempresa) { qv = qv.eq("idempresa", rg.idempresa); qf = qf.eq("idempresa", rg.idempresa) }
    const t0 = performance.now(); const vista = await todas(qv); const msV = Math.round(performance.now() - t0)
    const t1 = performance.now(); const fn = await todas(qf); const msF = Math.round(performance.now() - t1)
    const mv = new Map(vista.map((r) => [clave(r), r]))
    const mf = new Map(fn.map((r) => [clave(r), r]))
    const soloVista = [...mv.keys()].filter((k) => !mf.has(k))
    const soloFn = [...mf.keys()].filter((k) => !mv.has(k))
    const difs: string[] = []
    for (const [k, r] of mv) {
      const f = mf.get(k); if (!f) continue
      for (const col of Object.keys(r)) if (JSON.stringify(r[col]) !== JSON.stringify(f[col])) difs.push(`${k} · ${col}: vista=${r[col]} fn=${f[col]}`)
    }
    const igual = soloVista.length === 0 && soloFn.length === 0 && difs.length === 0
    ok &&= igual
    console.log(`\n${rg.desde}..${rg.hasta}${rg.idempresa ? " ID" + rg.idempresa : ""}: vista ${vista.length} filas (${msV} ms) | función ${fn.length} filas (${msF} ms) → ${igual ? "IDÉNTICO" : "DIFERENTE"}`)
    if (soloVista.length) console.log("  solo en vista:", soloVista.slice(0, 5))
    if (soloFn.length) console.log("  solo en función:", soloFn.slice(0, 5))
    if (difs.length) console.log(`  ${difs.length} valores distintos, p.ej.:`, difs.slice(0, 5))
  }
  console.log(ok ? "\nTODO IDÉNTICO" : "\nHAY DIFERENCIAS")
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1) })
