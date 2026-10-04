// Verificación de SOLO LECTURA del control "un pedido sale en varias órdenes de cargue"
// (SQL 226 y el libro auxiliar `pedidodetalle_ocargue`). No modifica nada.
//
// Uso (desde la raíz del repo):
//   npx tsx --env-file=.env.local scripts/verificar_226_pedido_ordenes.mts --estado
//   npx tsx --env-file=.env.local scripts/verificar_226_pedido_ordenes.mts --grupos
//   npx tsx --env-file=.env.local scripts/verificar_226_pedido_ordenes.mts --diferencias
//   npx tsx --env-file=.env.local scripts/verificar_226_pedido_ordenes.mts --pedido 8742
//   npx tsx --env-file=.env.local scripts/verificar_226_pedido_ordenes.mts --foto 2 > foto_id2.json
//   npx tsx --env-file=.env.local scripts/verificar_226_pedido_ordenes.mts --comparar a.json b.json
import { readFileSync } from "node:fs"
import { getSupabaseAdminAsSystem } from "../lib/supabase-admin"
import { ordenesDelPedido, totalCargado } from "../lib/pedido-ordenes"

const sb: any = await getSupabaseAdminAsSystem()
const args = process.argv.slice(2)
const modo = args[0] ?? "--estado"
const n0 = (v: any) => Number(v) || 0
const norm = (v: any) => String(v ?? "").trim().toUpperCase()
const log = (...a: any[]) => console.error(...a)

async function todas(q: (d: number, h: number) => any, pag = 1000): Promise<any[]> {
  const out: any[] = []
  for (let d = 0; ; d += pag) {
    const { data, error } = await q(d, d + pag - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < pag) break
  }
  return out
}

async function libroCompleto() {
  return todas((d, h) =>
    sb.from("pedidodetalle_ocargue").select("id, transid, idpedido, id_empresa, ocargue, unidades, origen, creado_en").order("id", { ascending: true }).range(d, h),
  )
}

async function existeLibro(): Promise<boolean> {
  const { error } = await sb.from("pedidodetalle_ocargue").select("id").limit(1)
  if (error) {
    log(`La tabla pedidodetalle_ocargue no está disponible: ${error.message}`)
    log("Falta correr scripts/226_pedido_ordenes_cargue.sql en el editor SQL de Supabase.")
    return false
  }
  return true
}

/** Líneas donde lo que suman las órdenes no coincide con lo que registra la línea del pedido. */
async function diferencias() {
  const libro = await libroCompleto()
  const porLinea = new Map<number, { ocargue: string; unidades: number }[]>()
  for (const f of libro) {
    const t = Number(f.transid)
    porLinea.set(t, [...(porLinea.get(t) ?? []), { ocargue: String(f.ocargue), unidades: n0(f.unidades) }])
  }
  const transids = [...porLinea.keys()]
  const lineas: any[] = []
  for (let i = 0; i < transids.length; i += 300) {
    const { data, error } = await sb
      .from("pedidosdetalle")
      .select("transid, idpedido, id_empresa, producto, unidades, unidadescargadas, unidades_cargadas, estado, ocargue")
      .in("transid", transids.slice(i, i + 300))
    if (error) throw error
    lineas.push(...(data ?? []))
  }
  const fuera: any[] = []
  for (const l of lineas) {
    const filas = porLinea.get(Number(l.transid)) ?? []
    const segun = totalCargado(filas)
    const dice = n0(l.unidadescargadas ?? l.unidades_cargadas)
    if (segun > dice + 0.01 || dice > segun + 0.01)
      fuera.push({
        id_empresa: Number(l.id_empresa),
        idpedido: Number(l.idpedido),
        transid: Number(l.transid),
        producto: String(l.producto ?? ""),
        pedidas: n0(l.unidades),
        dice,
        segunOrdenes: segun,
        ordenes: filas.length,
        detalle: filas.map((f) => `${f.ocargue}:${f.unidades}`).join(" + "),
        estado: l.estado,
        sentido: segun > dice ? "el pedido no cuenta lo que salió" : "la línea dice más que las órdenes",
      })
  }
  return { libro, porLinea, fuera }
}

if (modo === "--estado") {
  if (!(await existeLibro())) process.exit(1)
  const libro = await libroCompleto()
  const porOrigen = new Map<string, number>()
  const lineasPorN = new Map<number, number>()
  const porLinea = new Map<number, number>()
  for (const f of libro) {
    porOrigen.set(String(f.origen), (porOrigen.get(String(f.origen)) ?? 0) + 1)
    porLinea.set(Number(f.transid), (porLinea.get(Number(f.transid)) ?? 0) + 1)
  }
  for (const n of porLinea.values()) lineasPorN.set(n, (lineasPorN.get(n) ?? 0) + 1)
  console.log(`filas del libro: ${libro.length}`)
  console.log(`líneas distintas: ${porLinea.size}   órdenes distintas: ${new Set(libro.map((f) => f.ocargue)).size}`)
  console.log("por origen:", JSON.stringify([...porOrigen.entries()].sort()))
  console.log("líneas según en cuántas órdenes salieron:", JSON.stringify([...lineasPorN.entries()].sort((a, b) => a[0] - b[0])))
  const multi = [...porLinea.entries()].filter(([, n]) => n > 1).map(([t]) => t)
  console.log(`líneas que salieron en más de una orden: ${multi.length}`)
  process.exit(0)
}

if (modo === "--grupos") {
  // Confronta el libro contra el DOCUMENTO de cada orden (`detalleoc`) y separa:
  //   A1 falsas (la orden existe con detalle y no autorizó ese producto) -> SQL 228 las borra.
  //   A2 no verificables (la orden ya no existe) -> se conservan, marcadas 'linea_sin_orden'.
  //   B  salió MÁS de lo pedido -> no se corrige por software, se revisa con gerencia.
  //   C  el pedido no cuenta lo que salió y cabe en lo pedido -> lo corrige el SQL 227.
  if (!(await existeLibro())) process.exit(1)
  const libro = await libroCompleto()
  const transids = [...new Set<number>(libro.map((f: any) => Number(f.transid)))]
  const linea = new Map<number, any>()
  for (let i = 0; i < transids.length; i += 300) {
    const { data } = await sb
      .from("pedidosdetalle")
      .select("transid, idpedido, id_empresa, producto, unidades, unidadescargadas, unidades_cargadas, estado")
      .in("transid", transids.slice(i, i + 300))
    for (const l of data ?? []) linea.set(Number(l.transid), l)
  }
  const codigos = [...new Set<string>(libro.map((f: any) => String(f.ocargue)))]
  const codigoDeId = new Map<number, string>()
  for (let i = 0; i < codigos.length; i += 100) {
    const { data } = await sb.from("cabeceraoc").select("id, ordendecargue").in("ordendecargue", codigos.slice(i, i + 100))
    for (const c of data ?? []) codigoDeId.set(Number(c.id), String(c.ordendecargue))
  }
  const autorizado = new Set<string>()
  const conDetalle = new Set<string>()
  const ids = [...codigoDeId.keys()]
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await todas((d, h) => sb.from("detalleoc").select("idorden, producto").in("idorden", ids.slice(i, i + 100)).order("id").range(d, h))
    for (const r of rows) {
      const oc = String(codigoDeId.get(Number(r.idorden)))
      conDetalle.add(oc)
      autorizado.add(`${norm(oc)}|${norm(r.producto)}`)
    }
  }
  const A1: any[] = []
  const A2: any[] = []
  const buenas: any[] = []
  for (const f of libro) {
    const l = linea.get(Number(f.transid))
    if (!l) continue
    const oc = String(f.ocargue)
    const fila = { id: Number(f.id), id_empresa: Number(f.id_empresa), idpedido: Number(f.idpedido), transid: Number(f.transid), ocargue: oc, producto: String(l.producto), unidades: n0(f.unidades), origen: f.origen }
    if (!conDetalle.has(oc)) { A2.push(fila); buenas.push(f); continue }
    if (!autorizado.has(`${norm(oc)}|${norm(l.producto)}`)) A1.push(fila)
    else buenas.push(f)
  }
  const suma = new Map<number, number>()
  const nOrd = new Map<number, number>()
  for (const f of buenas) {
    const t = Number(f.transid)
    suma.set(t, (suma.get(t) ?? 0) + n0(f.unidades))
    nOrd.set(t, (nOrd.get(t) ?? 0) + 1)
  }
  const B: any[] = []
  const C: any[] = []
  for (const [t, s] of suma) {
    const l = linea.get(t)
    if (!l) continue
    const pedidas = n0(l.unidades)
    const dice = n0(l.unidadescargadas ?? l.unidades_cargadas)
    if (s > pedidas + 0.01) B.push({ id_empresa: Number(l.id_empresa), idpedido: Number(l.idpedido), transid: t, producto: String(l.producto).slice(0, 32), pedidas, dice, salio: s, exceso: s - pedidas, ordenes: nOrd.get(t), estado: l.estado })
    else if (s > dice + 0.01) C.push({ id_empresa: Number(l.id_empresa), idpedido: Number(l.idpedido), transid: t, producto: String(l.producto).slice(0, 32), pedidas, dice, salio: s, dif: s - dice })
  }
  const porEmpresa = (xs: any[], campo: string) => {
    const m = new Map<number, { lineas: number; unidades: number }>()
    for (const x of xs) {
      const r = m.get(x.id_empresa) ?? { lineas: 0, unidades: 0 }
      r.lineas++
      r.unidades += n0(x[campo])
      m.set(x.id_empresa, r)
    }
    return JSON.stringify([...m.entries()].sort())
  }
  console.log(`libro: ${libro.length} filas · ${codigos.length} órdenes`)
  console.log(`\nA1 FALSAS (la orden existe y no autorizó ese producto): ${A1.length} filas, ${A1.reduce((s, f) => s + f.unidades, 0)} unidades`)
  for (const f of A1) console.log("  ", JSON.stringify(f))
  console.log(`\nA2 NO VERIFICABLES (la orden ya no existe): ${A2.length} filas, ${A2.reduce((s, f) => s + f.unidades, 0)} unidades, ${new Set(A2.map((f) => f.ocargue)).size} órdenes`)
  console.log("   por ID:", porEmpresa(A2, "unidades"))
  console.log(`\nB SALIÓ MÁS DE LO PEDIDO (no se corrige por software): ${B.length} líneas, ${new Set(B.map((x) => x.idpedido)).size} pedidos`)
  console.log("   por ID:", porEmpresa(B, "exceso"))
  for (const x of B) console.log("  ", JSON.stringify(x))
  console.log(`\nC POR CORREGIR (SQL 227): ${C.length} líneas, ${new Set(C.map((x) => x.idpedido)).size} pedidos, ${C.reduce((s, x) => s + x.dif, 0)} unidades`)
  console.log("   por ID:", porEmpresa(C, "dif"))
  for (const x of C.slice(0, 30)) console.log("  ", JSON.stringify(x))
  if (C.length > 30) console.log(`   … y ${C.length - 30} más`)
  process.exit(0)
}

if (modo === "--diferencias") {
  if (!(await existeLibro())) process.exit(1)
  const { fuera } = await diferencias()
  const porEmpresa = new Map<number, { lineas: number; unidades: number }>()
  for (const f of fuera) {
    if (f.sentido !== "el pedido no cuenta lo que salió") continue
    const r = porEmpresa.get(f.id_empresa) ?? { lineas: 0, unidades: 0 }
    r.lineas++
    r.unidades += f.segunOrdenes - f.dice
    porEmpresa.set(f.id_empresa, r)
  }
  console.log(`líneas descuadradas: ${fuera.length}`)
  console.log("unidades que el pedido NO cuenta y sí salieron, por ID:", JSON.stringify([...porEmpresa.entries()].sort()))
  console.log(`pedidos afectados: ${new Set(fuera.map((f) => f.idpedido)).size}`)
  for (const f of fuera.slice(0, 60)) console.log(JSON.stringify(f))
  if (fuera.length > 60) console.log(`… y ${fuera.length - 60} más`)
  process.exit(0)
}

if (modo === "--pedido") {
  const idpedido = Number(args[1])
  if (!Number.isFinite(idpedido)) {
    log("Falta el idpedido: --pedido 8742")
    process.exit(1)
  }
  const { data: cab, error } = await sb.from("pedidoscabecera").select("idpedido, id_empresa, cliente, estado, ocargue, fecha, fecha_programada").eq("idpedido", idpedido).maybeSingle()
  if (error) throw error
  if (!cab) {
    log(`El pedido ${idpedido} no existe.`)
    process.exit(1)
  }
  const { data: det } = await sb.from("pedidosdetalle").select("transid, producto, unidades, unidadescargadas, unidades_cargadas, estado, ocargue").eq("idpedido", idpedido).order("transid")
  const { data: libro } = await sb.from("pedidodetalle_ocargue").select("transid, ocargue, unidades, creado_en, origen").eq("idpedido", idpedido).order("creado_en")
  const codigos = [...new Set((libro ?? []).map((f: any) => String(f.ocargue)))]
  const datos = new Map<string, { fecha: string | null; placa: string | null; conductor: string | null }>()
  if (codigos.length) {
    const { data: ocs } = await sb.from("cabeceraoc").select("ordendecargue, fechaorden, fechacargue, placa, conductor").in("ordendecargue", codigos)
    for (const o of ocs ?? [])
      datos.set(String(o.ordendecargue), { fecha: o.fechacargue ?? o.fechaorden ?? null, placa: o.placa ?? null, conductor: o.conductor ?? null })
  }
  console.log(`Pedido ${idpedido} · ID${cab.id_empresa} · ${cab.cliente} · estado=${cab.estado ?? "null"} · ocargue en cabecera=${cab.ocargue ?? "—"}`)
  console.log("\nLíneas:")
  for (const l of det ?? []) {
    const filas = (libro ?? []).filter((f: any) => Number(f.transid) === Number(l.transid)).map((f: any) => ({ ocargue: String(f.ocargue), unidades: n0(f.unidades) }))
    const segun = totalCargado(filas)
    const dice = n0(l.unidadescargadas ?? l.unidades_cargadas)
    const marca = Math.abs(segun - dice) > 0.01 ? "  <-- DESCUADRADA" : ""
    console.log(`  t${l.transid} ${String(l.producto).slice(0, 30).padEnd(30)} pedidas=${n0(l.unidades)} dice=${dice} ordenes=[${filas.map((f) => `${f.ocargue}:${f.unidades}`).join(" + ") || "sin anotación"}] suma=${segun} estado=${l.estado ?? "null"}${marca}`)
  }
  console.log("\nÓrdenes que atendieron el pedido:")
  for (const o of ordenesDelPedido((libro ?? []).map((f: any) => ({ transid: Number(f.transid), ocargue: String(f.ocargue), unidades: n0(f.unidades), creadoEn: f.creado_en })), datos))
    console.log(`  ${o.ocargue} · ${o.unidades} und · ${o.lineas} línea(s) · ${o.fecha ?? "sin fecha"} · ${o.placa ?? "sin vehículo"}${o.conductor ? ` · ${o.conductor}` : ""}`)
  process.exit(0)
}

if (modo === "--foto") {
  // Foto de un proyecto ANTES y DESPUÉS de publicar: ningún número de pedidos puede cambiar
  // por el solo hecho de publicar el código (el libro es aditivo).
  const empresaId = Number(args[1])
  if (!Number.isFinite(empresaId)) {
    log("Falta el ID: --foto 2")
    process.exit(1)
  }
  const det = await todas((d, h) =>
    sb.from("pedidosdetalle").select("transid, idpedido, unidades, unidadescargadas, unidades_cargadas, estado, ocargue").eq("id_empresa", empresaId).order("transid").range(d, h),
  )
  const cab = await todas((d, h) => sb.from("pedidoscabecera").select("idpedido, estado, ocargue").eq("id_empresa", empresaId).order("idpedido").range(d, h))
  const foto = {
    empresaId,
    tomada: new Date().toISOString(),
    lineas: det.length,
    cabeceras: cab.length,
    sumaPedidas: det.reduce((s, l) => s + n0(l.unidades), 0),
    sumaCargadas: det.reduce((s, l) => s + n0(l.unidadescargadas ?? l.unidades_cargadas), 0),
    estadosLinea: det.reduce((m: any, l) => ((m[String(l.estado ?? "null")] = (m[String(l.estado ?? "null")] ?? 0) + 1), m), {}),
    estadosCabecera: cab.reduce((m: any, c) => ((m[String(c.estado ?? "null")] = (m[String(c.estado ?? "null")] ?? 0) + 1), m), {}),
    porLinea: det.map((l) => ({ t: Number(l.transid), c: n0(l.unidadescargadas ?? l.unidades_cargadas), e: l.estado ?? null, o: l.ocargue ?? null })),
  }
  console.log(JSON.stringify(foto))
  process.exit(0)
}

if (modo === "--comparar") {
  const a = JSON.parse(readFileSync(args[1], "utf8"))
  const b = JSON.parse(readFileSync(args[2], "utf8"))
  const dif: string[] = []
  for (const k of ["lineas", "cabeceras", "sumaPedidas", "sumaCargadas"] as const) if (a[k] !== b[k]) dif.push(`${k}: ${a[k]} -> ${b[k]}`)
  const mapa = new Map<number, any>(a.porLinea.map((l: any) => [l.t, l]))
  let lineasCambiadas = 0
  for (const l of b.porLinea) {
    const v = mapa.get(l.t)
    if (!v) continue
    if (v.c !== l.c || v.e !== l.e || v.o !== l.o) {
      lineasCambiadas++
      if (lineasCambiadas <= 25) dif.push(`línea ${l.t}: cargadas ${v.c} -> ${l.c}, estado ${v.e} -> ${l.e}, orden ${v.o} -> ${l.o}`)
    }
  }
  console.log(dif.length === 0 ? `Sin diferencias (ID${a.empresaId}).` : `ID${a.empresaId}: ${lineasCambiadas} líneas cambiaron.\n${dif.join("\n")}`)
  process.exit(0)
}

log(`Modo no reconocido: ${modo}`)
process.exit(1)
