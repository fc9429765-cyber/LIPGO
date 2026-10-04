// Verificación de SOLO LECTURA para la cola logística de pedidos, la depuración
// de pendientes (SQL 215) y el dashboard logístico. No modifica nada.
//
// Uso (desde la raíz del repo):
//   npx tsx --env-file=.env.local scripts/verificar_215_pedidos_cola.mts --auditoria
//   npx tsx --env-file=.env.local scripts/verificar_215_pedidos_cola.mts --candidatos
//   npx tsx --env-file=.env.local scripts/verificar_215_pedidos_cola.mts --mismo-dia
//   npx tsx --env-file=.env.local scripts/verificar_215_pedidos_cola.mts --foto 2 > foto_id2_antes.json
//   npx tsx --env-file=.env.local scripts/verificar_215_pedidos_cola.mts --comparar foto_a.json foto_b.json
//   npx tsx --env-file=.env.local scripts/verificar_215_pedidos_cola.mts --dashboard 3 2026-09-01 2026-09-30
//   npx tsx --env-file=.env.local scripts/verificar_215_pedidos_cola.mts --post
import { readFileSync } from "node:fs"
import { getSupabaseAdminAsSystem } from "../lib/supabase-admin"
import { derivarEstado, diasEntre, esEstadoFinal, FILTRO_ABIERTOS_POSTGREST, normalizarEstado, sumarDiasISO, type EstadoDerivado } from "../lib/pedidos-estado"

const sb: any = await getSupabaseAdminAsSystem()
const args = process.argv.slice(2)
const modo = args[0] ?? "--candidatos"
const HOY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
const log = (...a: any[]) => console.error(...a)
const n0 = (v: any) => Number(v) || 0
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)

const COLS_CAB =
  "idpedido, id_empresa, fecha, fecha_programada, cliente, vendedor, destino, tipo_despacho, orden_de_compra, pedido, total_pagar, aprobado, revisioncartera, revisiongerencia, estado, ocargue, fechaordencargue, fechadeentrega, vehiculo, transporte, factura"

async function todas(q: (desde: number, hasta: number) => any, pag = 1000): Promise<any[]> {
  const out: any[] = []
  for (let d = 0; ; d += pag) {
    const { data, error } = await q(d, d + pag - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < pag) break
  }
  return out
}

type ResLineas = { kg: number; und: number; lineas: number; oc: number; cargadas: number; kgCargados: number }
async function lineasDe(empresaId: number, ids: number[]): Promise<Map<number, ResLineas>> {
  const m = new Map<number, ResLineas>()
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const rows = await todas((a, b) =>
      sb.from("pedidosdetalle").select("idpedido, transid, peso, unidades, ocargue, unidadescargadas, unidades_cargadas").eq("id_empresa", empresaId).in("idpedido", chunk).order("transid").range(a, b),
    )
    for (const d of rows) {
      const r = m.get(d.idpedido) ?? { kg: 0, und: 0, lineas: 0, oc: 0, cargadas: 0, kgCargados: 0 }
      const peso = n0(d.peso)
      const und = n0(d.unidades)
      const carg = n0(d.unidadescargadas ?? d.unidades_cargadas)
      r.kg += peso
      r.und += und
      r.lineas += 1
      if (d.ocargue) r.oc += 1
      r.cargadas += carg
      r.kgCargados += und > 0 ? (peso * Math.min(carg, und)) / und : 0
      m.set(d.idpedido, r)
    }
  }
  return m
}

async function empresas(): Promise<Map<number, string>> {
  const { data } = await sb.from("empresas").select("id, nombre").order("id")
  return new Map((data ?? []).map((e: any) => [Number(e.id), String(e.nombre)]))
}

async function abiertosDe(empresaId: number) {
  return todas((a, b) => sb.from("pedidoscabecera").select(COLS_CAB).eq("id_empresa", empresaId).or(FILTRO_ABIERTOS_POSTGREST).order("idpedido").range(a, b))
}

// ───────────────────────────── --auditoria ─────────────────────────────
if (modo === "--auditoria") {
  log("== auditoria: INSERT de pedidoscabecera (fuente del backfill de creado_en) ==")
  const { data: muestra, error } = await sb.from("auditoria").select("registro_id, ts, idempresa").eq("tabla", "pedidoscabecera").eq("operacion", "INSERT").order("ts", { ascending: true }).limit(5)
  if (error) {
    log("No se pudo leer auditoria:", error.message)
    process.exit(1)
  }
  log("Primeros INSERT:", JSON.stringify(muestra))
  const { count } = await sb.from("auditoria").select("id", { count: "exact", head: true }).eq("tabla", "pedidoscabecera").eq("operacion", "INSERT")
  log("Total INSERT registrados:", count)
  const formatoOk = (muestra ?? []).every((r: any) => /^\d+$/.test(String(r.registro_id ?? "")))
  log(`Formato de registro_id numérico (idpedido): ${formatoOk ? "SÍ" : "NO → el backfill debe usar despues->>'idpedido'"}`)
  const { data: conJson } = await sb.from("auditoria").select("ts, despues").eq("tabla", "pedidoscabecera").eq("operacion", "INSERT").order("ts", { ascending: false }).limit(2)
  for (const r of conJson ?? []) log("despues →", r.despues ? `claves: ${Object.keys(r.despues).join(", ")} · idpedido=${r.despues.idpedido} · fecha=${r.despues.fecha}` : "null", "· ts", r.ts)
  const { count: conId } = await sb.from("auditoria").select("id", { count: "exact", head: true }).eq("tabla", "pedidoscabecera").eq("operacion", "INSERT").not("despues->>idpedido", "is", null)
  log(`INSERT con despues->>idpedido disponible: ${conId} de ${count}`)
  // ¿La fecha del pedido coincide con el día (Bogotá) del INSERT? Muestra de 200.
  const { data: muestra200 } = await sb.from("auditoria").select("ts, despues").eq("tabla", "pedidoscabecera").eq("operacion", "INSERT").not("despues->>idpedido", "is", null).order("ts", { ascending: false }).limit(200)
  let coinciden = 0
  for (const r of muestra200 ?? []) {
    const diaBogota = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(r.ts))
    if (String(r.despues?.fecha ?? "").slice(0, 10) === diaBogota) coinciden++
  }
  log(`En los últimos ${muestra200?.length ?? 0} INSERT, fecha del pedido = día Bogotá del INSERT en ${coinciden} casos`)
  const { data: ult } = await sb.from("auditoria").select("registro_id, ts").eq("tabla", "pedidoscabecera").eq("operacion", "INSERT").order("ts", { ascending: false }).limit(3)
  log("Últimos INSERT:", JSON.stringify(ult))
  // ¿Cuántos pedidos registrados desde que existe la auditoría quedarían con hora?
  const primero = muestra?.[0]?.ts ? String(muestra[0].ts).slice(0, 10) : null
  if (primero) {
    const { count: cPed } = await sb.from("pedidoscabecera").select("idpedido", { count: "exact", head: true }).gte("fecha", primero)
    log(`Pedidos con fecha ≥ ${primero} (candidatos a tener creado_en por backfill): ${cPed}`)
  }
  const { count: cTot } = await sb.from("pedidoscabecera").select("idpedido", { count: "exact", head: true })
  log("Pedidos totales en pedidoscabecera:", cTot)
  process.exit(0)
}

// ───────────────────────────── --candidatos ─────────────────────────────
if (modo === "--candidatos") {
  const emps = await empresas()
  let totSinRastroTodos = 0, totSinRastro15 = 0, totParc30 = 0, totParcTodos = 0
  log(`== Candidatos a depuración al ${HOY} ==`)
  for (const [id, nombre] of emps) {
    const cab = await abiertosDe(id)
    if (cab.length === 0) continue
    const lin = await lineasDe(id, cab.map((c: any) => c.idpedido))
    let sinRastroTodos = 0, sinRastro15 = 0, parcTodos = 0, parc30 = 0, atrasados = 0, hoy = 0, manana = 0, enCargue = 0, nuevos = 0
    const buckets = { "1-15": 0, "16-30": 0, "31-90": 0, ">90": 0 } as Record<string, number>
    for (const p of cab) {
      const r = lin.get(p.idpedido)
      const d: EstadoDerivado = derivarEstado(p, HOY, { lineasConOcargue: r?.oc ?? 0, unidadesPedidas: r?.und, unidadesCargadas: r?.cargadas })
      if (d.sinRastro && d.estado !== "parcial") sinRastroTodos++
      if (d.candidatoDepuracion === "sin_rastro") {
        sinRastro15++
        const a = d.antiguedadDias
        buckets[a <= 15 ? "1-15" : a <= 30 ? "16-30" : a <= 90 ? "31-90" : ">90"]++
      }
      if (d.estado === "parcial") parcTodos++
      if (d.candidatoDepuracion === "parcial") parc30++
      if (d.estado === "programado" && d.atrasoDias > 0) atrasados++
      if (d.esHoy && !d.esFinal) hoy++
      if (d.esManana && !d.esFinal) manana++
      if (d.estado === "en_cargue") enCargue++
      if (d.estado === "nuevo") nuevos++
    }
    totSinRastroTodos += sinRastroTodos; totSinRastro15 += sinRastro15; totParc30 += parc30; totParcTodos += parcTodos
    log(`\nID ${id} · ${nombre}: ${cab.length} abiertos`)
    log(`  sin rastro logístico: ${sinRastroTodos} (de cualquier antigüedad) · candidatos > ${15} d: ${sinRastro15} → ${JSON.stringify(buckets)}`)
    log(`  parciales: ${parcTodos} · candidatos > 30 d: ${parc30}`)
    log(`  franja: atrasados ${atrasados} · hoy ${hoy} · mañana ${manana} · en cargue ${enCargue} · parciales ${parcTodos} · por aprobar ${nuevos}`)
  }
  log(`\nTOTAL sin rastro (cualquier antigüedad): ${totSinRastroTodos} (medición previa: 763) · candidatos > 15 d: ${totSinRastro15}`)
  log(`TOTAL parciales: ${totParcTodos} · candidatos > 30 d: ${totParc30} (medición previa: 193)`)
  process.exit(0)
}

// ───────────────────────────── --mismo-dia ─────────────────────────────
if (modo === "--mismo-dia") {
  const desde = args[1] ?? "2026-07-01"
  const hasta = args[2] ?? HOY
  const emps = await empresas()
  log(`== Pedidos del mismo día y entregas a tiempo · fecha entre ${desde} y ${hasta} ==`)
  for (const [id, nombre] of emps) {
    const cab = await todas((a, b) => sb.from("pedidoscabecera").select("idpedido, fecha, fecha_programada, fechaordencargue, estado").eq("id_empresa", id).gte("fecha", desde).lte("fecha", hasta).order("idpedido").range(a, b))
    if (cab.length === 0) continue
    const conPromesa = cab.filter((p: any) => p.fecha && p.fecha_programada)
    const mismoDia = conPromesa.filter((p: any) => String(p.fecha).slice(0, 10) === String(p.fecha_programada).slice(0, 10)).length
    const antic = { "0": 0, "1": 0, "2-3": 0, ">3": 0, neg: 0 } as Record<string, number>
    for (const p of conPromesa) {
      const d = diasEntre(String(p.fecha_programada).slice(0, 10), String(p.fecha).slice(0, 10))
      antic[d < 0 ? "neg" : d === 0 ? "0" : d === 1 ? "1" : d <= 3 ? "2-3" : ">3"]++
    }
    const conOc = cab.filter((p: any) => p.fechaordencargue && p.fecha_programada)
    const aTiempo = conOc.filter((p: any) => String(p.fechaordencargue).slice(0, 10) <= String(p.fecha_programada).slice(0, 10)).length
    log(`\nID ${id} · ${nombre}: ${cab.length} pedidos · ${conPromesa.length} con promesa`)
    log(`  mismo día (registro = promesa): ${mismoDia} → ${pct(mismoDia, conPromesa.length)} %  · anticipación: ${JSON.stringify(antic)} (neg = promesa anterior al registro)`)
    log(`  a tiempo (fecha OC ≤ promesa) sobre ${conOc.length} con OC: ${aTiempo} → ${pct(aTiempo, conOc.length)} %`)
  }
  log("\nMedición previa (jul–oct): mismo día ID1 79 · ID2 98 · ID3 44 · ID4 98 % · a tiempo ID1 83 · ID2 64 · ID3 72 · ID4 97 %")
  process.exit(0)
}

// ───────────────────────────── --foto <id> ─────────────────────────────
if (modo === "--foto") {
  const id = Number(args[1])
  if (!id) { log("Uso: --foto <idEmpresa>"); process.exit(1) }
  const cab = await abiertosDe(id)
  const lin = await lineasDe(id, cab.map((c: any) => c.idpedido))
  const filas = cab.map((p: any) => {
    const r = lin.get(p.idpedido)
    const d = derivarEstado(p, HOY, { lineasConOcargue: r?.oc ?? 0, unidadesPedidas: r?.und, unidadesCargadas: r?.cargadas })
    return { idpedido: p.idpedido, estado: p.estado ?? null, aprobado: p.aprobado ?? null, ocargue: p.ocargue ?? null, fecha_programada: p.fecha_programada ?? null, derivado: d.estado, candidato: d.candidatoDepuracion, kg: Math.round(r?.kg ?? 0), und: r?.und ?? 0 }
  })
  const resumen: Record<string, number> = {}
  for (const f of filas) resumen[f.derivado] = (resumen[f.derivado] ?? 0) + 1
  const { count: finales } = await sb.from("pedidoscabecera").select("idpedido", { count: "exact", head: true }).eq("id_empresa", id).in("estado", ["entregado", "entrega parcial", "anulado", "no entregado"])
  const { count: noEnt } = await sb.from("pedidoscabecera").select("idpedido", { count: "exact", head: true }).eq("id_empresa", id).ilike("estado", "no entregado")
  console.log(JSON.stringify({ empresa: id, hoy: HOY, tomada: new Date().toISOString(), abiertos: filas.length, finales, noEntregados: noEnt, resumen, filas }, null, 1))
  process.exit(0)
}

// ───────────────────────────── --comparar A B ─────────────────────────────
if (modo === "--comparar") {
  const A = JSON.parse(readFileSync(args[1], "utf8"))
  const B = JSON.parse(readFileSync(args[2], "utf8"))
  const mapA = new Map<number, any>(A.filas.map((f: any) => [f.idpedido, f]))
  const mapB = new Map<number, any>(B.filas.map((f: any) => [f.idpedido, f]))
  const salieron = [...mapA.keys()].filter((k) => !mapB.has(k))
  const entraron = [...mapB.keys()].filter((k) => !mapA.has(k))
  const cambiaron = [...mapA.keys()].filter((k) => mapB.has(k) && JSON.stringify(mapA.get(k)) !== JSON.stringify(mapB.get(k)))
  log(`== Comparación ID ${A.empresa}: ${A.tomada} → ${B.tomada} ==`)
  log(`abiertos: ${A.abiertos} → ${B.abiertos} · finales: ${A.finales} → ${B.finales} · no entregados: ${A.noEntregados} → ${B.noEntregados}`)
  log(`salieron de abiertos (${salieron.length}): ${salieron.slice(0, 50).join(", ")}${salieron.length > 50 ? " …" : ""}`)
  log(`entraron a abiertos (${entraron.length}): ${entraron.slice(0, 50).join(", ")}${entraron.length > 50 ? " …" : ""}`)
  log(`cambiaron (${cambiaron.length}):`)
  for (const k of cambiaron.slice(0, 30)) log("  ", k, JSON.stringify(mapA.get(k)), "→", JSON.stringify(mapB.get(k)))
  process.exit(0)
}

// ───────────────────────────── --dashboard <id> <desde> <hasta> ─────────────────────────────
if (modo === "--dashboard") {
  const id = Number(args[1])
  const desde = args[2]
  const hasta = args[3]
  if (!id || !desde || !hasta) { log("Uso: --dashboard <idEmpresa> <desde> <hasta>"); process.exit(1) }
  const emps = await empresas()
  const cab = await todas((a, b) => sb.from("pedidoscabecera").select(COLS_CAB).eq("id_empresa", id).gte("fecha_programada", desde).lte("fecha_programada", hasta).order("idpedido").range(a, b))
  const lin = await lineasDe(id, cab.map((c: any) => c.idpedido))
  const clase = (p: any): "a_tiempo" | "tarde" | "pendiente" | "no_entregado" | "anulado" => {
    const e = normalizarEstado(p.estado)
    if (e === "anulado") return "anulado"
    if (e === "no entregado") return "no_entregado"
    if (p.fechaordencargue && p.fecha_programada) return String(p.fechaordencargue).slice(0, 10) <= String(p.fecha_programada).slice(0, 10) ? "a_tiempo" : "tarde"
    if (esEstadoFinal(p.estado)) return "a_tiempo"
    return "pendiente"
  }
  const semanaDe = (f: string) => {
    const d = new Date(f + "T12:00:00Z")
    const dow = (d.getUTCDay() + 6) % 7
    return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10)
  }
  const porSemana = new Map<string, Record<string, number>>()
  const porDespacho = new Map<string, { n: number; aTiempo: number; conOc: number; pend: number; kg: number; kgCargados: number }>()
  let kgProg = 0, kgCarg = 0, conDinero = 0, dinero = 0, mismoDia = 0, conPromesa = 0, conOc = 0, aTiempo = 0, pendKg = 0
  const clientes = new Set<string>()
  const antic = { "0": 0, "1": 0, "2-3": 0, ">3": 0 } as Record<string, number>
  for (const p of cab) {
    const r = lin.get(p.idpedido)
    const c = clase(p)
    const s = semanaDe(String(p.fecha_programada).slice(0, 10))
    const w = porSemana.get(s) ?? { a_tiempo: 0, tarde: 0, pendiente: 0, no_entregado: 0, anulado: 0, kg: 0, kgCargados: 0 }
    w[c]++
    w.kg += r?.kg ?? 0
    w.kgCargados += r?.kgCargados ?? 0
    porSemana.set(s, w)
    const td = String(p.tipo_despacho ?? "Sin tipo").trim() || "Sin tipo"
    const dsp = porDespacho.get(td) ?? { n: 0, aTiempo: 0, conOc: 0, pend: 0, kg: 0, kgCargados: 0 }
    dsp.n++; if (c === "a_tiempo") dsp.aTiempo++; if (c === "a_tiempo" || c === "tarde") dsp.conOc++; if (c === "pendiente") dsp.pend++; dsp.kg += r?.kg ?? 0; dsp.kgCargados += r?.kgCargados ?? 0
    porDespacho.set(td, dsp)
    kgProg += r?.kg ?? 0
    kgCarg += r?.kgCargados ?? 0
    if (c === "pendiente") pendKg += r?.kg ?? 0
    clientes.add(String(p.cliente ?? ""))
    if (n0(p.total_pagar) > 0) { conDinero++; dinero += n0(p.total_pagar) }
    if (p.fecha && p.fecha_programada) {
      conPromesa++
      const dd = diasEntre(String(p.fecha_programada).slice(0, 10), String(p.fecha).slice(0, 10))
      if (dd === 0) mismoDia++
      if (dd >= 0) antic[dd === 0 ? "0" : dd === 1 ? "1" : dd <= 3 ? "2-3" : ">3"]++
    }
    if (p.fechaordencargue && p.fecha_programada) { conOc++; if (c === "a_tiempo") aTiempo++ }
  }
  log(`== Dashboard logístico · ID ${id} · ${emps.get(id)} · promesa entre ${desde} y ${hasta} ==`)
  log(`pedidos programados: ${cab.length} · kg programados ${Math.round(kgProg).toLocaleString("es-CO")} · kg cargados ${Math.round(kgCarg).toLocaleString("es-CO")} (${pct(kgCarg, kgProg)} %)`)
  const tot = { a_tiempo: 0, tarde: 0, pendiente: 0, no_entregado: 0, anulado: 0 } as Record<string, number>
  for (const w of porSemana.values()) for (const k of Object.keys(tot)) tot[k] += w[k]
  log(`clases: ${JSON.stringify(tot)} · a tiempo sobre con OC: ${aTiempo}/${conOc} = ${pct(aTiempo, conOc)} % · pendientes del período: ${tot.pendiente} pedidos · ${Math.round(pendKg).toLocaleString("es-CO")} kg · clientes distintos: ${clientes.size}`)
  log(`con valor en dinero: ${conDinero}/${cab.length} = ${pct(conDinero, cab.length)} % → ${pct(conDinero, cab.length)! < 50 ? "mostrar KILOS" : "mostrar $ y kg"} · $ programado ${Math.round(dinero).toLocaleString("es-CO")}`)
  log(`mismo día: ${mismoDia}/${conPromesa} = ${pct(mismoDia, conPromesa)} % · anticipación ${JSON.stringify(antic)}`)
  log("\npor semana (lunes):")
  for (const [s, w] of [...porSemana.entries()].sort()) log(`  ${s}: a tiempo ${w.a_tiempo} · tarde ${w.tarde} · pendiente ${w.pendiente} · no entregado ${w.no_entregado} · anulado ${w.anulado} · kg ${Math.round(w.kg).toLocaleString("es-CO")} · cargados ${Math.round(w.kgCargados).toLocaleString("es-CO")}`)
  log("\npor tipo de despacho:")
  for (const [k, v] of porDespacho) log(`  ${k}: ${v.n} pedidos · a tiempo ${pct(v.aTiempo, v.conOc)} % (${v.aTiempo}/${v.conOc} con OC) · pendientes ${v.pend} · kg ${Math.round(v.kg).toLocaleString("es-CO")} · cargados ${Math.round(v.kgCargados).toLocaleString("es-CO")}`)

  // Pendiente y atraso a HOY (independiente del período)
  const abiertos = await abiertosDe(id)
  const linAb = await lineasDe(id, abiertos.map((c: any) => c.idpedido))
  const buckets = { "1-7": { n: 0, kg: 0 }, "8-15": { n: 0, kg: 0 }, "16-30": { n: 0, kg: 0 }, ">30": { n: 0, kg: 0 } } as Record<string, { n: number; kg: number }>
  const porCliente = new Map<string, { n: number; kg: number }>()
  let paraHoy = 0, paraHoyConOc = 0, paraHoyKg = 0
  for (const p of abiertos) {
    const r = linAb.get(p.idpedido)
    const d = derivarEstado(p, HOY, { lineasConOcargue: r?.oc ?? 0 })
    if (d.esHoy) { paraHoy++; paraHoyKg += r?.kg ?? 0; if (!d.sinRastro) paraHoyConOc++ }
    if (d.estado === "programado" && d.atrasoDias > 0) {
      const a = d.atrasoDias
      const b = buckets[a <= 7 ? "1-7" : a <= 15 ? "8-15" : a <= 30 ? "16-30" : ">30"]
      b.n++; b.kg += r?.kg ?? 0
      const c = porCliente.get(p.cliente) ?? { n: 0, kg: 0 }
      c.n++; c.kg += r?.kg ?? 0
      porCliente.set(p.cliente, c)
    }
  }
  log(`\nPENDIENTE Y ATRASO a ${HOY}: abiertos ${abiertos.length}`)
  for (const [k, v] of Object.entries(buckets)) log(`  atraso ${k} d: ${v.n} pedidos · ${Math.round(v.kg).toLocaleString("es-CO")} kg`)
  log("  top clientes atrasados:")
  for (const [c, v] of [...porCliente.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 6)) log(`    ${c}: ${v.n} pedidos · ${Math.round(v.kg).toLocaleString("es-CO")} kg`)
  log(`  cierre de hoy: ${paraHoy} para hoy · ${paraHoyConOc} con orden de cargue · ${Math.round(paraHoyKg).toLocaleString("es-CO")} kg`)
  process.exit(0)
}

// ───────────────────────────── --post ─────────────────────────────
if (modo === "--post") {
  log("== Verificación posterior a la depuración ==")
  const dep = await todas((a, b) => sb.from("pedidoscabecera").select("idpedido, id_empresa, estado, ocargue, vehiculo, fechaordencargue, motivo_no_entrega, depurado_por, depurado_en").ilike("estado", "no entregado").order("idpedido").range(a, b))
  log(`pedidos con estado 'no entregado': ${dep.length}`)
  const malos = dep.filter((p: any) => p.ocargue || p.vehiculo || p.fechaordencargue)
  log(`  con rastro logístico (NO debería haber): ${malos.length}${malos.length ? " → " + malos.map((p: any) => p.idpedido).join(", ") : ""}`)
  const sinMotivo = dep.filter((p: any) => !p.motivo_no_entrega || !p.depurado_por || !p.depurado_en)
  log(`  sin motivo/quién/cuándo (NO debería haber): ${sinMotivo.length}`)
  const porEmp: Record<string, number> = {}
  for (const p of dep) porEmp[p.id_empresa] = (porEmp[p.id_empresa] ?? 0) + 1
  log("  por empresa:", JSON.stringify(porEmp))
  const { data: logs } = await sb.from("autorizacion_log").select("created_at, usuario, proceso, resultado, autorizado_por, referencia").eq("proceso", "ped_depurar").order("created_at", { ascending: false }).limit(10)
  log(`bitácora ped_depurar (${logs?.length ?? 0}):`)
  for (const l of logs ?? []) log(`  ${l.created_at} ${l.usuario ?? ""} ${l.resultado} ${l.autorizado_por ?? ""} ${l.referencia ?? ""}`)
  process.exit(0)
}

log(`Modo desconocido: ${modo}. Opciones: --auditoria · --candidatos · --mismo-dia [desde hasta] · --foto <id> · --comparar A B · --dashboard <id> <desde> <hasta> · --post`)
process.exit(1)
