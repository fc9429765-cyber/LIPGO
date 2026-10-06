// SOLO LECTURA (emite SQL). Lleva el stock de un proyecto a la posición que le
// corresponde cuando el conteo físico se contabilizó DESPUÉS de que el coordinador
// ya había cuadrado el sistema a mano: ahí la misma reubicación queda aplicada dos
// veces y la mercancía termina en lotes y ubicaciones que no son.
//
// Objetivo por (producto, lote, ubicación):
//     físico del conteo  +  TODO lo que pasó después del corte,
//   excepto (a) los traslados manuales con que el coordinador cuadró el sistema el
//   primer día (ya están dentro del físico) y (b) los movimientos del propio conteo
//   y de su reclasificación (el duplicado que hay que deshacer).
//
// Dónde el objetivo da NEGATIVO (se despachó de una posición que el físico dice que
// estaba vacía) se deja en 0 y las unidades se toman del LOTE MÁS PRÓXIMO del mismo
// producto, que es la regla de gerencia para la reclasificación 309.
//
// Movimientos que emite, todos con su pareja (no cambian el total de ningún producto):
//   * 311 cuando solo cambia la UBICACIÓN (mismo lote)
//   * 309 cuando cambia el LOTE
//   * 701/702 solo para el neto que no se pueda emparejar (sobrante/faltante real)
//
// Uso:
//   npx tsx --env-file=.env.local scripts/sig/recolocar_posiciones.mts \
//     --proyecto 1 --cuadre 40 --corte 2026-10-01 --dia-cuadre-manual 2026-10-01 \
//     --actor "gerenciageneral@lip-sas.com" --sql scripts/238_recolocar_posiciones_id1.sql

import { createClient } from "@supabase/supabase-js"
import { readFileSync, writeFileSync } from "fs"

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (f: string) => {
    const i = args.indexOf(f)
    return i >= 0 ? args[i + 1] : undefined
  }
  const proyectoId = Number(get("--proyecto"))
  const cuadreId = Number(get("--cuadre"))
  const corte = get("--corte")
  const diaManual = get("--dia-cuadre-manual") ?? corte
  const actor = get("--actor") || "gerenciageneral@lip-sas.com"
  const sql = get("--sql")
  if (!proyectoId || !cuadreId || !corte) {
    console.error("Uso: --proyecto <id> --cuadre <id> --corte <YYYY-MM-DD> [--dia-cuadre-manual <YYYY-MM-DD>] [--actor <email>] [--sql <archivo>]")
    process.exit(1)
  }
  return { proyectoId, cuadreId, corte, diaManual, actor, sql }
}

const n2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => n2(x).toLocaleString("es-CO")
const q = (s: any) => (s === null || s === undefined || s === "" ? "null" : `'${String(s).replace(/'/g, "''")}'`)
const fechaCo = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))

/** Día que representa un lote con formato de fecha (20260929 = 29-sep-2026). */
function diaDeLote(lote: any): number | null {
  const s = String(lote ?? "").trim()
  let y: number, m: number, d: number
  if (/^\d{8}$/.test(s)) { y = +s.slice(0, 4); m = +s.slice(4, 6); d = +s.slice(6, 8) }
  else if (/^\d{7}$/.test(s)) { y = +s.slice(0, 4); m = +s.slice(4, 5); d = +s.slice(5, 7) }
  else return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return Date.UTC(y, m - 1, d) / 86400000
}

async function main() {
  const { proyectoId, cuadreId, corte, diaManual, actor, sql: rutaSql } = parseArgs()
  const env = readFileSync(".env.local", "utf8")
  const getEnv = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim()
  const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL")!, getEnv("SUPABASE_SERVICE_ROLE_KEY")!)

  console.log("=".repeat(78))
  console.log(`RECOLOCAR POSICIONES · ID${proyectoId} · conteo #${cuadreId} · corte ${corte}`)
  console.log("=".repeat(78))

  // ---------- 1) Físico del conteo ----------
  const det: any[] = []
  {
    let f = 0
    while (true) {
      const { data } = await supabase.from("sig_inventario_cuadre_detalle").select("codproducto,producto,lote,location,conteo").eq("cuadre_id", cuadreId).order("id").range(f, f + 999)
      det.push(...(data ?? []))
      if (!data || data.length < 1000) break
      f += 1000
    }
  }
  const objetivo = new Map<string, number>()
  const nombrePorCod = new Map<string, string>()
  for (const d of det) {
    const k = `${d.codproducto}||${d.lote ?? ""}||${d.location ?? ""}`
    objetivo.set(k, n2((objetivo.get(k) ?? 0) + (Number(d.conteo) || 0)))
    if (d.producto && !nombrePorCod.has(d.codproducto)) nombrePorCod.set(d.codproducto, d.producto)
  }
  console.log(`\nfísico del conteo: ${det.length} líneas · ${fmt(Array.from(objetivo.values()).reduce((s, v) => s + v, 0))} und`)

  // Nombre del catálogo (manda sobre el de los saldos).
  {
    const cods = Array.from(new Set(det.map((d) => d.codproducto)))
    for (let i = 0; i < cods.length; i += 200) {
      const { data } = await supabase.from("productos").select("codigo,nombre").in("codigo", cods.slice(i, i + 200))
      for (const p of data ?? []) if (p.codigo && p.nombre) nombrePorCod.set(p.codigo, p.nombre)
    }
  }

  // ---------- 2) Movimientos posteriores al corte ----------
  const mov: any[] = []
  {
    let f = 0
    while (true) {
      const { data } = await supabase
        .from("invtrans")
        .select("id,creado,codproducto,nombreproducto,lote,location,tipomov,cantidad,status,cod_movimiento,origen,ocargue,creadopor,observaciones")
        .eq("idempresa", proyectoId)
        .gte("creado", `${corte}T00:00:00Z`)
        .order("id")
        .range(f, f + 999)
      mov.push(...(data ?? []))
      if (!data || data.length < 1000) break
      f += 1000
    }
  }
  const vigentes = mov.filter((m) => m.creado && fechaCo(m.creado) >= corte && (String(m.status).toLowerCase().startsWith("aprob") || String(m.status) === "por descontar"))
  const esDelConteo = (m: any) => String(m.observaciones ?? "").includes(`cuadre #${cuadreId}`) || String(m.observaciones ?? "").includes(`[recl#${cuadreId}]`)
  const esCuadreManual = (m: any) => !esDelConteo(m) && fechaCo(m.creado) === diaManual && ["311", "309", "701", "702"].includes(String(m.cod_movimiento ?? ""))
  const cuentan = vigentes.filter((m) => !esDelConteo(m) && !esCuadreManual(m))

  console.log(`\nmovimientos desde el corte: ${vigentes.length}`)
  console.log(`   del conteo y su reclasificación (NO cuentan: son el duplicado) ... ${vigentes.filter(esDelConteo).length}`)
  console.log(`   cuadre manual del ${diaManual} (NO cuentan: ya están en el físico) .. ${vigentes.filter(esCuadreManual).length}`)
  console.log(`   operación real y correcciones posteriores (SÍ cuentan) .......... ${cuentan.length}`)

  for (const m of cuentan) {
    const k = `${m.codproducto}||${m.lote ?? ""}||${m.location ?? ""}`
    const c = Math.abs(Number(m.cantidad) || 0)
    objetivo.set(k, n2((objetivo.get(k) ?? 0) + (m.tipomov === "Entrada" ? c : -c)))
    if (m.nombreproducto && !nombrePorCod.has(m.codproducto)) nombrePorCod.set(m.codproducto, m.nombreproducto)
  }

  // ---------- 3) Objetivo negativo -> 0, cubierto desde el lote más próximo ----------
  const negativos = Array.from(objetivo.entries()).filter(([, v]) => v < -0.009).sort((a, b) => a[1] - b[1])
  console.log(`\nposiciones con objetivo negativo (se despachó de donde el físico dice que no había): ${negativos.length} · ${fmt(negativos.reduce((s, [, v]) => s + v, 0))} und`)
  type Par = { cod: string; producto: string; loteOrigen: string; locOrigen: string; loteDestino: string; locDestino: string; cantidad: number; dias: number; motivo: string }
  const pares: Par[] = []
  const sinCubrir: string[] = []
  for (const [keyNeg, valNeg] of negativos) {
    const [cod, loteNeg, locNeg] = keyNeg.split("||")
    let falta = n2(-valNeg)
    const diaNeg = diaDeLote(loteNeg)
    // Primero el MISMO lote en otra ubicación: si se despachó de una posición que el
    // físico dejó vacía, lo natural es que la estiba saliera de otra posición del mismo
    // lote (un traslado), no de un lote distinto. Solo cuando el lote ya no tiene saldo
    // en ninguna parte se recurre al lote más próximo.
    const donantes = Array.from(objetivo.entries())
      .filter(([k, v]) => k.startsWith(`${cod}||`) && v > 0.009 && k !== keyNeg)
      .map(([k, v]) => {
        const [, lote, loc] = k.split("||")
        const diaDon = diaDeLote(lote)
        const dias = diaNeg === null || diaDon === null ? Number.POSITIVE_INFINITY : Math.abs(diaDon - diaNeg)
        return { k, lote, loc, v, misma: loc === locNeg, dias, mismoLote: lote === loteNeg }
      })
      .sort((a, b) =>
        a.mismoLote !== b.mismoLote ? (a.mismoLote ? -1 : 1) : a.dias !== b.dias ? a.dias - b.dias : a.misma !== b.misma ? (a.misma ? -1 : 1) : b.v - a.v,
      )
    for (const d of donantes) {
      if (falta <= 0.009) break
      const toma = Math.min(falta, d.v)
      objetivo.set(d.k, n2(d.v - toma))
      falta = n2(falta - toma)
      pares.push({ cod, producto: nombrePorCod.get(cod) ?? cod, loteOrigen: d.lote, locOrigen: d.loc, loteDestino: loteNeg, locDestino: locNeg, cantidad: n2(toma), dias: d.dias, motivo: "cubre el despacho de una posición que el físico no tenía" })
    }
    objetivo.set(keyNeg, n2((objetivo.get(keyNeg) ?? 0) + (n2(-valNeg) - falta)))
    if (falta > 0.009) sinCubrir.push(`${cod} L${loteNeg} ${locNeg}: ${fmt(falta)} und sin lote de donde tomar`)
  }
  if (sinCubrir.length) for (const s of sinCubrir) console.log(`   ⚠️ ${s}`)
  if (pares.length) {
    console.log(`   de dónde se toman esas unidades (${pares.length} asignaciones):`)
    for (const p of pares.sort((a, b) => b.cantidad - a.cantidad)) {
      console.log(`      ${p.cod} ${`${p.loteDestino}/${p.locDestino}`.padEnd(22)} <- ${`${p.loteOrigen}/${p.locOrigen}`.padEnd(22)} ${fmt(p.cantidad).padStart(8)}  ${p.loteOrigen === p.loteDestino ? "mismo lote" : `otro lote (${Number.isFinite(p.dias) ? p.dias + " días" : "sin fecha"})`}`)
    }
  }

  // ---------- 4) Stock de hoy ----------
  const vivo = new Map<string, number>()
  {
    let f = 0
    while (true) {
      const { data } = await supabase.from("saldoinvdetalle").select("codproducto,nombreproducto,lote,location,stock_actual").eq("idempresa", proyectoId).order("codproducto").order("lote").order("location").range(f, f + 999)
      for (const r of data ?? []) {
        const k = `${r.codproducto}||${r.lote ?? ""}||${r.location ?? ""}`
        vivo.set(k, n2((vivo.get(k) ?? 0) + (Number(r.stock_actual) || 0)))
        if (r.nombreproducto && !nombrePorCod.has(r.codproducto)) nombrePorCod.set(r.codproducto, r.nombreproducto)
      }
      if (!data || data.length < 1000) break
      f += 1000
    }
  }
  const totObj = n2(Array.from(objetivo.values()).reduce((s, v) => s + v, 0))
  const totVivo = n2(Array.from(vivo.values()).reduce((s, v) => s + v, 0))
  console.log(`\nobjetivo: ${fmt(totObj)} und · stock de hoy: ${fmt(totVivo)} und · diferencia ${fmt(totVivo - totObj)}`)

  // ---------- 5) Diferencias y emparejamiento ----------
  const claves = new Set([...objetivo.keys(), ...vivo.keys()])
  const sobra = new Map<string, number>() // hoy > objetivo
  const falta = new Map<string, number>() // hoy < objetivo
  for (const k of claves) {
    const d = n2((vivo.get(k) ?? 0) - (objetivo.get(k) ?? 0))
    if (d > 0.009) sobra.set(k, d)
    else if (d < -0.009) falta.set(k, -d)
  }
  console.log(`\nposiciones a corregir: ${sobra.size + falta.size} (${sobra.size} con exceso, ${falta.size} con defecto)`)
  console.log(`   exceso total: ${fmt(Array.from(sobra.values()).reduce((s, v) => s + v, 0))} · defecto total: ${fmt(Array.from(falta.values()).reduce((s, v) => s + v, 0))}`)

  // Emparejar dentro de cada producto: del que sobra al que falta, lote más próximo primero.
  const movimientos: Par[] = []
  const neto: Array<{ cod: string; producto: string; lote: string; loc: string; cantidad: number }> = []
  const prods = new Set([...Array.from(sobra.keys()), ...Array.from(falta.keys())].map((k) => k.split("||")[0]))
  for (const cod of Array.from(prods).sort()) {
    const sobraP = Array.from(sobra.entries()).filter(([k]) => k.startsWith(`${cod}||`)).map(([k, v]) => ({ k, v }))
    const faltaP = Array.from(falta.entries()).filter(([k]) => k.startsWith(`${cod}||`)).map(([k, v]) => ({ k, v }))
    for (const fa of faltaP.sort((a, b) => b.v - a.v)) {
      const [, loteF, locF] = fa.k.split("||")
      const diaF = diaDeLote(loteF)
      let pend = fa.v
      const cands = sobraP
        .filter((s) => s.v > 0.009)
        .map((s) => {
          const [, lote, loc] = s.k.split("||")
          const diaS = diaDeLote(lote)
          const dias = diaF === null || diaS === null ? Number.POSITIVE_INFINITY : Math.abs(diaS - diaF)
          return { ...s, lote, loc, dias, mismoLote: lote === loteF }
        })
        .sort((a, b) => (a.mismoLote !== b.mismoLote ? (a.mismoLote ? -1 : 1) : a.dias !== b.dias ? a.dias - b.dias : b.v - a.v))
      for (const c of cands) {
        if (pend <= 0.009) break
        const toma = Math.min(pend, c.v)
        movimientos.push({ cod, producto: nombrePorCod.get(cod) ?? cod, loteOrigen: c.lote, locOrigen: c.loc, loteDestino: loteF, locDestino: locF, cantidad: n2(toma), dias: c.dias, motivo: c.mismoLote ? "traslado de ubicación" : "reclasificación de lote" })
        c.v = n2(c.v - toma)
        const orig = sobraP.find((s) => s.k === c.k)!
        orig.v = c.v
        pend = n2(pend - toma)
      }
      if (pend > 0.009) neto.push({ cod, producto: nombrePorCod.get(cod) ?? cod, lote: loteF, loc: locF, cantidad: pend })
    }
    for (const s of sobraP) if (s.v > 0.009) {
      const [, lote, loc] = s.k.split("||")
      neto.push({ cod, producto: nombrePorCod.get(cod) ?? cod, lote, loc, cantidad: -s.v })
    }
  }
  const traslados = movimientos.filter((m) => m.loteOrigen === m.loteDestino)
  const reclas = movimientos.filter((m) => m.loteOrigen !== m.loteDestino)
  console.log(`\nmovimientos a generar: ${movimientos.length} pares + ${neto.length} netos`)
  console.log(`   311 traslado de ubicación (mismo lote): ${traslados.length} · ${fmt(traslados.reduce((s, m) => s + m.cantidad, 0))} und`)
  console.log(`   309 reclasificación de lote: ${reclas.length} · ${fmt(reclas.reduce((s, m) => s + m.cantidad, 0))} und`)
  console.log(`   701/702 neto sin pareja: ${neto.length} · ${fmt(neto.reduce((s, x) => s + x.cantidad, 0))} und`)
  for (const x of neto) console.log(`      ${x.cod} L${x.lote}/${x.loc} ${x.cantidad > 0 ? "+" : ""}${fmt(x.cantidad)}`)
  console.log(`\n  ${"COD".padEnd(10)}${"DE (lote/ubic)".padEnd(24)}${"A (lote/ubic)".padEnd(24)}${"UND".padStart(9)}  TIPO`)
  for (const m of movimientos.sort((a, b) => b.cantidad - a.cantidad).slice(0, 25)) {
    console.log(`  ${m.cod.padEnd(10)}${`${m.loteOrigen}/${m.locOrigen}`.padEnd(24)}${`${m.loteDestino}/${m.locDestino}`.padEnd(24)}${fmt(m.cantidad).padStart(9)}  ${m.loteOrigen === m.loteDestino ? "311" : "309"}`)
  }
  if (movimientos.length > 25) console.log(`  … y ${movimientos.length - 25} más (todos van en el SQL)`)

  // Comprobación: aplicar lo propuesto deja el stock EXACTO al objetivo y sin negativos.
  const sim = new Map(vivo)
  for (const m of movimientos) {
    const ko = `${m.cod}||${m.loteOrigen}||${m.locOrigen}`
    const kd = `${m.cod}||${m.loteDestino}||${m.locDestino}`
    sim.set(ko, n2((sim.get(ko) ?? 0) - m.cantidad))
    sim.set(kd, n2((sim.get(kd) ?? 0) + m.cantidad))
  }
  for (const x of neto) {
    const k = `${x.cod}||${x.lote}||${x.loc}`
    sim.set(k, n2((sim.get(k) ?? 0) + x.cantidad))
  }
  let malas = 0
  for (const k of new Set([...sim.keys(), ...objetivo.keys()])) {
    if (Math.abs((sim.get(k) ?? 0) - (objetivo.get(k) ?? 0)) > 0.009) malas++
  }
  const negFinal = Array.from(sim.values()).filter((v) => v < -0.009).length
  console.log(`\ncomprobación: posiciones que quedarían distintas del objetivo: ${malas} · negativas: ${negFinal} ${malas === 0 && negFinal === 0 ? "✅" : "⛔"}`)
  if (malas > 0 || negFinal > 0) {
    console.log("No se emite el SQL: el plan no deja el inventario exacto.")
    return
  }

  if (!rutaSql) {
    console.log("\n(sin --sql: no se escribió nada)")
    return
  }

  // ---------- 6) SQL ----------
  const L: string[] = []
  const totalMov = movimientos.reduce((s, m) => s + m.cantidad, 0)
  L.push(`-- =====================================================================`)
  L.push(`-- RECOLOCAR LAS POSICIONES DE ID${proyectoId} tras el conteo #${cuadreId}.`)
  L.push(`--`)
  L.push(`-- Qué pasó: el ${diaManual} el coordinador cuadró el sistema A MANO con el mismo`)
  L.push(`-- conteo físico (${vigentes.filter(esCuadreManual).length} traslados 311/309). Al contabilizar después las`)
  L.push(`-- correcciones del conteo, esa misma reubicación quedó aplicada DOS VECES, y la`)
  L.push(`-- reclasificación que tapó los negativos movió unidades a lotes que no eran.`)
  L.push(`-- El total del inventario y el inventario inicial del mes están bien; lo que`)
  L.push(`-- quedó mal es en qué lote y posición está la mercancía.`)
  L.push(`--`)
  L.push(`-- Objetivo de cada posición: el físico del conteo + TODO lo que pasó después`)
  L.push(`-- del corte, salvo el cuadre manual del ${diaManual} (ya está dentro del físico) y los`)
  L.push(`-- movimientos del propio conteo y su reclasificación (el duplicado).`)
  L.push(`--`)
  L.push(`-- Qué hace: ${movimientos.length} pares (salida + entrada, no cambian el total de ningún`)
  L.push(`-- producto): ${traslados.length} traslados de ubicación (311) y ${reclas.length} reclasificaciones de lote (309),`)
  L.push(`-- ${fmt(totalMov)} und en total${neto.length ? `, más ${neto.length} ajuste(s) neto(s) 701/702` : ""}. Fechados hoy.`)
  L.push(`-- Al terminar, cada posición queda EXACTA al objetivo y ninguna en negativo:`)
  L.push(`-- el SQL lo verifica contra la lista y, si no cuadra, deshace todo.`)
  L.push(`-- =====================================================================`)
  L.push(``)
  L.push(`-- ============================ ANTES =================================`)
  L.push(`select 'posiciones mal ubicadas' as foto, count(*) as posiciones from (`)
  L.push(`  select 1 from saldoinvdetalle where idempresa = ${proyectoId} and stock_actual <> 0) x;`)
  L.push(`select 'B3 y B4' as foto, codproducto, lote, location, stock_actual`)
  L.push(`  from saldoinvdetalle where idempresa = ${proyectoId} and location in ('B3','B4') and stock_actual <> 0 order by location, lote;`)
  L.push(`select 'total y negativos' as foto, round(sum(stock_actual)::numeric,2) as und, count(*) filter (where stock_actual < 0) as negativas`)
  L.push(`  from saldoinvdetalle where idempresa = ${proyectoId};`)
  L.push(``)
  L.push(`-- ========================== CORRECCIÓN ==============================`)
  L.push(`begin;`)
  L.push(`do $reubicar$`)
  L.push(`declare`)
  L.push(`  v_base int;`)
  L.push(`  v_dup int;`)
  L.push(`  v_mal int;`)
  L.push(`  v_neg int;`)
  L.push(`  v_und_antes numeric;`)
  L.push(`  v_und_despues numeric;`)
  L.push(`begin`)
  L.push(`  select count(*) into v_dup from invtrans where idempresa = ${proyectoId} and observaciones like '%[reub#${cuadreId}]%';`)
  L.push(`  if v_dup > 0 then`)
  L.push(`    raise exception 'Ya hay % movimiento(s) de esta recolocación: no se repite.', v_dup;`)
  L.push(`  end if;`)
  L.push(`  select round(sum(stock_actual)::numeric, 2) into v_und_antes from saldoinvdetalle where idempresa = ${proyectoId};`)
  L.push(`  select coalesce(max(id), 0) into v_base from invtrans;`)
  L.push(``)
  L.push(`  -- Pares (de dónde sale -> a dónde entra). 311 = misma caja de lote, otra posición; 309 = otro lote.`)
  L.push(`  create temporary table tmp_reub (n int, codproducto text, producto text, lote_origen text, loc_origen text, lote_destino text, loc_destino text, cantidad numeric, codigo text) on commit drop;`)
  for (let i = 0; i < movimientos.length; i += 100) {
    const trozo = movimientos.slice(i, i + 100)
    L.push(`  insert into tmp_reub (n, codproducto, producto, lote_origen, loc_origen, lote_destino, loc_destino, cantidad, codigo) values`)
    L.push(trozo.map((m, j) => `    (${i + j + 1}, ${q(m.cod)}, ${q(m.producto)}, ${q(m.loteOrigen)}, ${q(m.locOrigen)}, ${q(m.loteDestino)}, ${q(m.locDestino)}, ${m.cantidad}, ${m.loteOrigen === m.loteDestino ? "'311'" : "'309'"})`).join(",\n") + ";")
  }
  L.push(``)
  L.push(`  insert into invtrans`)
  L.push(`    (id, idempresa, idproducto, codproducto, nombreproducto, lote, location, almacen, cantidad, tipomov, status, origen, observaciones, cod_movimiento, creadopor, creado)`)
  L.push(`  select`)
  L.push(`    v_base + row_number() over (order by t.n, m.orden),`)
  L.push(`    ${proyectoId},`)
  L.push(`    coalesce(p.id, 0),`)
  L.push(`    t.codproducto,`)
  L.push(`    t.producto,`)
  L.push(`    case when m.orden = 1 then t.lote_origen else t.lote_destino end,`)
  L.push(`    case when m.orden = 1 then t.loc_origen else t.loc_destino end,`)
  L.push(`    alm.nombre,`)
  L.push(`    t.cantidad,`)
  L.push(`    case when m.orden = 1 then 'Salida' else 'Entrada' end,`)
  L.push(`    'aprobado',`)
  L.push(`    'transaccion manual',`)
  L.push(`    'Recolocación por el conteo #${cuadreId}: ' || t.lote_origen || '/' || t.loc_origen || ' -> ' || t.lote_destino || '/' || t.loc_destino || ' (la reubicación del inventario inicial quedó aplicada dos veces) [reub#${cuadreId}]',`)
  L.push(`    t.codigo,`)
  L.push(`    ${q(actor)},`)
  L.push(`    now()`)
  L.push(`  from tmp_reub t`)
  L.push(`  cross join (select 1 as orden union all select 2) m`)
  L.push(`  left join productos p on p.codigo = t.codproducto`)
  L.push(`  left join locations l on l.codigo = (case when m.orden = 1 then t.loc_origen else t.loc_destino end) and l.idempresa = ${proyectoId}`)
  L.push(`  left join almacenes alm on alm.id = l.bodega;`)
  L.push(`  raise notice 'Movimientos de recolocación: % (${movimientos.length} pares x 2)', ${movimientos.length * 2};`)
  L.push(``)
  L.push(`  insert into sig_inventario_ajuste`)
  L.push(`    (proyecto_id, cuadre_id, fecha, codproducto, producto, lote, location, direccion, cod_movimiento, cantidad, tipo, motivo, responsable, estado, aprobado_por, aprobado_fecha)`)
  L.push(`  select ${proyectoId}, null, current_date, t.codproducto, t.producto,`)
  L.push(`         case when m.orden = 1 then t.lote_origen else t.lote_destino end,`)
  L.push(`         case when m.orden = 1 then t.loc_origen else t.loc_destino end,`)
  L.push(`         case when m.orden = 1 then 'salida' else 'ingreso' end,`)
  L.push(`         t.codigo,`)
  L.push(`         case when m.orden = 1 then -t.cantidad else t.cantidad end,`)
  L.push(`         case when t.codigo = '311' then 'traslado' else 'reclasificacion' end,`)
  L.push(`         'Recolocación tras el conteo #${cuadreId}: ' || t.lote_origen || '/' || t.loc_origen || ' -> ' || t.lote_destino || '/' || t.loc_destino,`)
  L.push(`         ${q(actor)}, 'aprobado', ${q(actor)}, now()`)
  L.push(`    from tmp_reub t cross join (select 1 as orden union all select 2) m;`)
  if (neto.length) {
    L.push(``)
    L.push(`  -- Ajustes netos que no se pueden emparejar (sobrante/faltante real).`)
    L.push(`  insert into invtrans`)
    L.push(`    (id, idempresa, idproducto, codproducto, nombreproducto, lote, location, almacen, cantidad, tipomov, status, origen, observaciones, cod_movimiento, creadopor, creado)`)
    L.push(`  select (select coalesce(max(id),0) from invtrans) + row_number() over (order by x.ord), ${proyectoId}, coalesce(p.id, 0), x.cod, x.prod, x.lote, x.loc, alm.nombre,`)
    L.push(`         abs(x.cant), case when x.cant > 0 then 'Entrada' else 'Salida' end, 'aprobado', 'transaccion manual',`)
    L.push(`         'Recolocación por el conteo #${cuadreId}: ajuste neto en ' || x.lote || '/' || x.loc || ' [reub#${cuadreId}]',`)
    L.push(`         case when x.cant > 0 then '701' else '702' end, ${q(actor)}, now()`)
    L.push(`    from (values`)
    L.push(neto.map((x, i) => `      (${i + 1}, ${q(x.cod)}, ${q(x.producto)}, ${q(x.lote)}, ${q(x.loc)}, ${x.cantidad}::numeric)`).join(",\n"))
    L.push(`    ) as x(ord, cod, prod, lote, loc, cant)`)
    L.push(`    left join productos p on p.codigo = x.cod`)
    L.push(`    left join locations l on l.codigo = x.loc and l.idempresa = ${proyectoId}`)
    L.push(`    left join almacenes alm on alm.id = l.bodega;`)
  }
  L.push(``)
  L.push(`  -- Control: cada posición debe quedar EXACTA al objetivo y ninguna en negativo.`)
  L.push(`  create temporary table tmp_objetivo (codproducto text, lote text, location text, cantidad numeric) on commit drop;`)
  const objLista = Array.from(objetivo.entries()).filter(([, v]) => Math.abs(v) > 0.009)
  for (let i = 0; i < objLista.length; i += 200) {
    const trozo = objLista.slice(i, i + 200)
    L.push(`  insert into tmp_objetivo (codproducto, lote, location, cantidad) values`)
    L.push(trozo.map(([k, v]) => {
      const [cod, lote, loc] = k.split("||")
      return `    (${q(cod)}, ${q(lote)}, ${q(loc)}, ${v})`
    }).join(",\n") + ";")
  }
  L.push(``)
  L.push(`  select count(*) into v_mal from (`)
  L.push(`    select coalesce(s.codproducto, o.codproducto) as cod, coalesce(s.lote, o.lote) as lote, coalesce(s.location, o.location) as loc,`)
  L.push(`           coalesce(s.und, 0) as hoy, coalesce(o.cantidad, 0) as objetivo`)
  L.push(`      from (select codproducto, lote, location, round(sum(stock_actual)::numeric,2) as und from saldoinvdetalle where idempresa = ${proyectoId} group by 1,2,3) s`)
  L.push(`      full outer join tmp_objetivo o on o.codproducto = s.codproducto and coalesce(o.lote,'') = coalesce(s.lote,'') and coalesce(o.location,'') = coalesce(s.location,'')`)
  L.push(`  ) z where abs(z.hoy - z.objetivo) > 0.009;`)
  L.push(`  if v_mal > 0 then`)
  L.push(`    raise exception 'Quedaron % posiciones distintas del objetivo: se deshace todo.', v_mal;`)
  L.push(`  end if;`)
  L.push(`  select count(*) into v_neg from saldoinvdetalle where idempresa = ${proyectoId} and stock_actual < 0;`)
  L.push(`  if v_neg > 0 then`)
  L.push(`    raise exception 'Quedaron % posiciones en negativo: se deshace todo.', v_neg;`)
  L.push(`  end if;`)
  L.push(`  select round(sum(stock_actual)::numeric, 2) into v_und_despues from saldoinvdetalle where idempresa = ${proyectoId};`)
  L.push(`  raise notice 'Inventario: % -> % und · todas las posiciones cuadran · 0 negativas', v_und_antes, v_und_despues;`)
  L.push(`end`)
  L.push(`$reubicar$;`)
  L.push(`commit;`)
  L.push(``)
  L.push(`-- =========================== DESPUÉS ================================`)
  L.push(`select 'B3 y B4' as verificacion, codproducto, lote, location, stock_actual`)
  L.push(`  from saldoinvdetalle where idempresa = ${proyectoId} and location in ('B3','B4') and stock_actual <> 0 order by location, lote;`)
  const b3 = Array.from(objetivo.entries()).filter(([k]) => k.endsWith("||B3") || k.endsWith("||B4"))
  L.push(`-- Esperado: ${b3.map(([k, v]) => { const [c, l, u] = k.split("||"); return `${u} ${c} L${l} = ${fmt(v)}` }).join(" · ") || "sin saldo"}`)
  L.push(`select 'total y negativos' as verificacion, round(sum(stock_actual)::numeric,2) as und, count(*) filter (where stock_actual < 0) as negativas`)
  L.push(`  from saldoinvdetalle where idempresa = ${proyectoId};`)
  L.push(`-- Esperado: ${fmt(totObj)} und y 0 negativas.`)
  L.push(`select 'movimientos de la recolocación' as verificacion, cod_movimiento, tipomov, count(*) as filas, round(sum(cantidad)::numeric,2) as und`)
  L.push(`  from invtrans where idempresa = ${proyectoId} and observaciones like '%[reub#${cuadreId}]%' group by 1,2,3 order by 2,3;`)
  L.push(`select 'total por producto' as verificacion, codproducto, round(sum(stock_actual)::numeric,2) as und`)
  L.push(`  from saldoinvdetalle where idempresa = ${proyectoId} group by 1,2 having sum(stock_actual) <> 0 order by 3 desc;`)
  writeFileSync(rutaSql, L.join("\n") + "\n", "utf8")
  console.log(`\n✅ SQL escrito en ${rutaSql}. LA BASE DE DATOS NO SE TOCÓ.`)
}
main()
