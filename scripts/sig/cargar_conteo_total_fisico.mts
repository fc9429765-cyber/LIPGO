// Carga el CONTEO TOTAL del mes a partir del archivo físico del cliente, cuando
// ese físico es el AMANECER del corte (se contó al cerrar el día anterior).
// Es el caso normal de cierre de mes: "inventario 30 sep" = inicial del 1 de octubre.
//
// Diferencia con `aplicar_cuadre_inventario_fisico.mts` (cargue de septiembre de
// ID1): allí la foto era el CIERRE del día del corte, así que había que sumarle
// de vuelta, lote por lote, las salidas de ese mismo día. Aquí no se reconstruye
// nada — la foto ya es la apertura. Ese script se deja intacto para poder
// reproducir el cargue de septiembre tal como se hizo.
//
// Reutiliza las funciones REALES del módulo (crearCuadre, guardarConteoCuadre,
// generarAjustesCuadre): nunca reimplementa esa lógica. NO aprueba las
// correcciones ni cierra el mes — eso lo hace el usuario en la pantalla
// "Cuadre y Correcciones de Inventario" con su clave, a propósito.
//
// Reglas de armado de las líneas (las tres quedan impresas en el reporte):
//   1. Clave (producto+lote+ubicación) que está en el archivo -> conteo = físico.
//   2. Clave que NO está en el archivo pero cuyo PRODUCTO sí se contó -> conteo = 0.
//      El contador recorrió ese producto; si no listó el lote, no está. Un lote
//      negativo del sistema entra así y queda en 0 (es lo que pidió gerencia el
//      2026-10-02: que el físico los corrija en vez de esconderlos).
//   3. Clave de un producto que el archivo NO menciona en ninguna línea ->
//      conteo = sistema (diferencia 0, no mueve inventario). Es la misma
//      convención que `obtenerBaseDelMes` ya aplica a una línea sin digitar, y
//      deja la base del mes completa. Se controla con "noContados" en el config.
//
// Uso (solo lectura, no escribe nada):
//   npx tsx --env-file=.env.local scripts/sig/cargar_conteo_total_fisico.mts \
//     --proyecto 1 --corte 2026-10-01 \
//     --input scripts/sig/data/id1-fisico-2026-10.json \
//     --config scripts/sig/data/id1-fisico-2026-10.config.json
//
// Para escribir de verdad, agregar --escribir (crea el conteo, guarda el físico
// y genera las correcciones en estado "registrado").

import { createClient } from "@supabase/supabase-js"
import { readFileSync, writeFileSync } from "fs"
import { calcularStockAlCorte, crearCuadre, guardarConteoCuadre, generarAjustesCuadre } from "../../lib/sig-actions"

interface FilaFisica {
  producto: string
  lote: string
  location: string
  fisico: number
  nota: string | null
}

interface Config {
  alias?: Record<string, string>
  excluir?: string[]
  noContados?: "sistema" | "cero"
  foto?: "apertura" | "cierre"
}

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const proyectoId = Number(get("--proyecto"))
  const corte = get("--corte")
  const input = get("--input")
  const config = get("--config")
  const sql = get("--sql")
  const actor = get("--actor") || "gerenciageneral@lip-sas.com"
  const escribir = args.includes("--escribir")
  if (!proyectoId || !corte || !input) {
    console.error("Uso: --proyecto <id> --corte <YYYY-MM-DD> --input <archivo.json> [--config <archivo.json>] [--sql <archivo.sql>] [--actor <email>] [--escribir]")
    process.exit(1)
  }
  return { proyectoId, corte, input, config, sql, actor, escribir }
}

const norm = (s: any): string => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase()
const n2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => n2(x).toLocaleString("es-CO")
const vispera = (fecha: string) => {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const { proyectoId, corte, input, config: rutaConfig, sql: rutaSql, actor, escribir } = parseArgs()
  const env = readFileSync(".env.local", "utf8")
  const getEnv = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim()
  const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL")!, getEnv("SUPABASE_SERVICE_ROLE_KEY")!)

  const cfg: Config = rutaConfig ? JSON.parse(readFileSync(rutaConfig, "utf8")) : {}
  const alias: Record<string, string> = {}
  for (const [k, v] of Object.entries(cfg.alias ?? {})) alias[norm(k)] = v
  const excluir = new Set((cfg.excluir ?? []).map((c) => String(c)))
  const noContados = cfg.noContados ?? "sistema"
  if ((cfg.foto ?? "apertura") !== "apertura") {
    console.error(`⛔ Este script asume que la foto es la APERTURA del corte; el config dice foto="${cfg.foto}". Para una foto de cierre usa aplicar_cuadre_inventario_fisico.mts.`)
    process.exit(1)
  }

  const filas: FilaFisica[] = JSON.parse(readFileSync(input, "utf8"))
  const { data: emp } = await supabase.from("empresas").select("id,nombre").eq("id", proyectoId).single()
  console.log("=".repeat(78))
  console.log(`CONTEO TOTAL · ID${proyectoId} ${emp?.nombre ?? ""} · corte ${corte} (inventario inicial del ${corte})`)
  console.log(`Archivo físico: ${input} — ${filas.length} claves, ${fmt(filas.reduce((s, f) => s + f.fisico, 0))} und`)
  console.log(`Modo: ${escribir ? "ESCRITURA" : "SOLO LECTURA (no escribe nada)"}`)
  console.log("=".repeat(78))

  const bloqueantes: string[] = []

  // ---------------- 1) Resolver cada nombre del archivo a un codproducto ----------------
  // Candidatos: catálogo GLOBAL (productos.nombre) + variantes históricas del
  // propio proyecto (saldoinvdetalle.nombreproducto). El catálogo global importa:
  // un producto nuevo para el sitio (p. ej. PT000189) no tiene historia local.
  const nombresLocales: Record<string, Set<string>> = {}
  {
    let from = 0
    while (true) {
      const { data } = await supabase.from("saldoinvdetalle").select("codproducto,nombreproducto").eq("idempresa", proyectoId).range(from, from + 999)
      for (const r of data ?? []) if (r.codproducto) (nombresLocales[r.codproducto] ||= new Set()).add(r.nombreproducto || "")
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 60000) break
    }
  }
  const nombreCatalogo: Record<string, string> = {}
  {
    let from = 0
    while (true) {
      const { data } = await supabase.from("productos").select("codigo,nombre").order("codigo").range(from, from + 999)
      for (const p of data ?? []) if (p.codigo && p.nombre) nombreCatalogo[p.codigo] = p.nombre
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 20000) break
    }
  }
  const porNombre: Record<string, Set<string>> = {}
  for (const [cod, nombre] of Object.entries(nombreCatalogo)) (porNombre[norm(nombre)] ||= new Set()).add(cod)
  for (const [cod, variantes] of Object.entries(nombresLocales)) for (const v of variantes) if (v) (porNombre[norm(v)] ||= new Set()).add(cod)

  const codDeNombre = new Map<string, string>()
  const sinResolver: string[] = []
  const ambiguos: string[] = []
  for (const nombre of new Set(filas.map((f) => norm(f.producto)))) {
    if (alias[nombre]) {
      codDeNombre.set(nombre, alias[nombre])
      continue
    }
    const cands = Array.from(porNombre[nombre] ?? [])
    if (cands.length === 1) codDeNombre.set(nombre, cands[0])
    else if (cands.length === 0) sinResolver.push(nombre)
    else ambiguos.push(`${nombre} -> [${cands.join(", ")}]`)
  }
  console.log(`\n--- Productos del archivo resueltos: ${codDeNombre.size} de ${new Set(filas.map((f) => norm(f.producto))).size} ---`)
  for (const [nombre, cod] of Array.from(codDeNombre).sort()) {
    const via = alias[nombre] ? "alias confirmado" : nombreCatalogo[cod] && norm(nombreCatalogo[cod]) === nombre ? "catálogo" : "variante del sitio"
    console.log(`  ${cod}  ${nombre.slice(0, 48).padEnd(48)} (${via})`)
  }
  if (sinResolver.length) bloqueantes.push(`${sinResolver.length} nombre(s) sin resolver: ${sinResolver.join(" | ")}`)
  if (ambiguos.length) bloqueantes.push(`${ambiguos.length} nombre(s) ambiguo(s): ${ambiguos.join(" | ")}`)

  // ---------------- 2) Ortografía de las ubicaciones ----------------
  // El archivo del cliente escribe "Caracol" y el sistema "CARACOL": si no se
  // unifica, la misma estiba entra como ubicación nueva (sobrante) y la del
  // sistema sale como faltante, y la corrección crearía una ubicación fantasma
  // en invtrans. Se compara sin distinguir mayúsculas y se guarda SIEMPRE la
  // ortografía del sistema.
  const ubicacionCanonica = new Map<string, string>()
  {
    let from = 0
    while (true) {
      const { data } = await supabase.from("saldoinvdetalle").select("location").eq("idempresa", proyectoId).range(from, from + 999)
      for (const r of data ?? []) {
        const l = String(r.location ?? "").trim()
        if (l && !ubicacionCanonica.has(l.toUpperCase())) ubicacionCanonica.set(l.toUpperCase(), l)
      }
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 60000) break
    }
    // La tabla `locations` manda sobre las variantes vistas en los saldos.
    const { data: locsCat } = await supabase.from("locations").select("codigo").eq("idempresa", proyectoId)
    for (const l of locsCat ?? []) {
      const c = String(l.codigo ?? "").trim()
      if (c) ubicacionCanonica.set(c.toUpperCase(), c)
    }
  }
  const canonUbi = (u: any): string => {
    const t = String(u ?? "").trim()
    return ubicacionCanonica.get(t.toUpperCase()) ?? t
  }
  const ubicacionesCorregidas = new Map<string, string>()
  for (const f of filas) {
    const t = String(f.location ?? "").trim()
    const c = canonUbi(t)
    if (c !== t) ubicacionesCorregidas.set(t, c)
  }
  if (ubicacionesCorregidas.size) {
    console.log(`\n--- Ubicaciones del archivo reescritas con la ortografía del sistema (${ubicacionesCorregidas.size}) ---`)
    for (const [de, a] of ubicacionesCorregidas) console.log(`  "${de}" -> "${a}"`)
  }

  // ---------------- 3) Físico por clave (codproducto||lote||location) ----------------
  const fisicoPorClave = new Map<string, { und: number; nota: string | null; producto: string }>()
  const dupes: string[] = []
  for (const f of filas) {
    const cod = codDeNombre.get(norm(f.producto))
    if (!cod || excluir.has(cod)) continue
    const key = `${cod}||${String(f.lote ?? "").trim()}||${canonUbi(f.location)}`
    if (fisicoPorClave.has(key)) {
      dupes.push(key)
      const prev = fisicoPorClave.get(key)!
      prev.und += f.fisico
    } else {
      fisicoPorClave.set(key, { und: f.fisico, nota: f.nota, producto: f.producto })
    }
  }
  if (dupes.length) bloqueantes.push(`${dupes.length} clave(s) repetida(s) en el archivo (debieron sumarse al convertir): ${dupes.slice(0, 5).join(" | ")}`)
  const codsEnArchivo = new Set(Array.from(fisicoPorClave.keys()).map((k) => k.split("||")[0]))

  // ---------------- 4) Sistema al amanecer del corte (igual que crearCuadre) ----------------
  console.log(`\nCalculando el sistema con el que AMANECE el ${corte}…`)
  const { porLote } = await calcularStockAlCorte(supabase, proyectoId, corte, { entradasDelDiaSonApertura: false, recortarNegativos: false })
  const sistemaPorClave = new Map<string, { und: number; producto: string }>()
  for (const [k, v] of Object.entries(porLote)) {
    if (v.valor === 0) continue
    if (excluir.has(v.codproducto)) continue
    sistemaPorClave.set(k, { und: v.valor, producto: v.producto })
  }

  // ---------------- 5) Armar las líneas del conteo ----------------
  type Linea = { codproducto: string; producto: string; lote: string; location: string; sistema: number; conteo: number; observacion: string | null; origen: "archivo" | "lote_ausente" | "producto_no_contado" }
  const lineas: Linea[] = []
  const claves = new Set([...fisicoPorClave.keys(), ...sistemaPorClave.keys()])
  for (const key of Array.from(claves).sort()) {
    const [cod, lote, location] = key.split("||")
    const sis = sistemaPorClave.get(key)?.und ?? 0
    const fis = fisicoPorClave.get(key)
    const nombre = fis?.producto || sistemaPorClave.get(key)?.producto || nombreCatalogo[cod] || cod
    if (fis) {
      lineas.push({ codproducto: cod, producto: nombre, lote, location, sistema: sis, conteo: fis.und, observacion: fis.nota, origen: "archivo" })
    } else if (codsEnArchivo.has(cod)) {
      lineas.push({
        codproducto: cod,
        producto: nombre,
        lote,
        location,
        sistema: sis,
        conteo: 0,
        observacion: `No aparece en el conteo físico del ${corte} (el producto sí se contó)${sis < 0 ? " · el sistema lo tenía en negativo" : ""}`,
        origen: "lote_ausente",
      })
    } else {
      lineas.push({
        codproducto: cod,
        producto: nombre,
        lote,
        location,
        sistema: sis,
        conteo: noContados === "cero" ? 0 : sis,
        observacion: noContados === "cero" ? "Producto no contado en el físico; se deja en cero por decisión de gerencia" : "Producto no contado en el físico; se da por bueno el saldo del sistema",
        origen: "producto_no_contado",
      })
    }
  }

  // ---------------- 6) Reporte ----------------
  const porOrigen = { archivo: 0, lote_ausente: 0, producto_no_contado: 0 }
  for (const l of lineas) porOrigen[l.origen]++
  const totalSistema = n2(lineas.reduce((s, l) => s + l.sistema, 0))
  const totalConteo = n2(lineas.reduce((s, l) => s + l.conteo, 0))
  const conDif = lineas.filter((l) => n2(l.conteo - l.sistema) !== 0)
  const sobrantes = conDif.filter((l) => l.conteo > l.sistema)
  const faltantes = conDif.filter((l) => l.conteo < l.sistema)

  console.log(`\n--- Líneas del conteo: ${lineas.length} ---`)
  console.log(`  del archivo físico .................. ${String(porOrigen.archivo).padStart(4)}`)
  console.log(`  lote del sistema ausente -> 0 ....... ${String(porOrigen.lote_ausente).padStart(4)}`)
  console.log(`  producto no contado -> ${noContados === "cero" ? "0" : "sistema"} ......... ${String(porOrigen.producto_no_contado).padStart(4)}`)
  console.log(`\n  total sistema (amanecer ${corte}) = ${fmt(totalSistema)} und`)
  console.log(`  total conteo (lo que queda de inicial) = ${fmt(totalConteo)} und`)
  console.log(`  diferencia neta = ${fmt(totalConteo - totalSistema)} und  (${conDif.length} líneas con diferencia)`)
  console.log(`  correcciones que se generarían: ${sobrantes.length} sobrante (701, +${fmt(sobrantes.reduce((s, l) => s + (l.conteo - l.sistema), 0))}) y ${faltantes.length} faltante (702, ${fmt(faltantes.reduce((s, l) => s + (l.conteo - l.sistema), 0))}), fechadas ${vispera(corte)}`)

  // Resumen por producto
  const porProd = new Map<string, { nombre: string; sis: number; con: number; lineas: number }>()
  for (const l of lineas) {
    const g = porProd.get(l.codproducto) ?? { nombre: l.producto, sis: 0, con: 0, lineas: 0 }
    g.sis += l.sistema
    g.con += l.conteo
    g.lineas++
    porProd.set(l.codproducto, g)
  }
  console.log(`\n--- Por producto (${porProd.size}) ---`)
  console.log(`  ${"COD".padEnd(10)}${"PRODUCTO".padEnd(44)}${"SISTEMA".padStart(10)}${"CONTEO".padStart(10)}${"DIF".padStart(10)}`)
  for (const [cod, g] of Array.from(porProd).sort((a, b) => Math.abs(b[1].con - b[1].sis) - Math.abs(a[1].con - a[1].sis))) {
    console.log(`  ${cod.padEnd(10)}${String(g.nombre).slice(0, 42).padEnd(44)}${fmt(g.sis).padStart(10)}${fmt(g.con).padStart(10)}${fmt(g.con - g.sis).padStart(10)}`)
  }

  // Lotes del archivo que el sistema no tiene (candidatos a entradas no registradas)
  const lotesNuevos = lineas.filter((l) => l.origen === "archivo" && l.sistema === 0 && l.conteo !== 0)
  console.log(`\n--- Lotes contados que el sistema NO tiene (${lotesNuevos.length}; ${fmt(lotesNuevos.reduce((s, l) => s + l.conteo, 0))} und) ---`)
  console.log(`    Son los candidatos a "entrada de producción no registrada": revisar con el cliente.`)
  for (const l of lotesNuevos.sort((a, b) => b.conteo - a.conteo).slice(0, 30)) {
    console.log(`  ${l.codproducto} ${String(l.producto).slice(0, 36).padEnd(36)} L${l.lote.padEnd(10)} ${l.location.padEnd(10)} ${fmt(l.conteo).padStart(9)}`)
  }

  // Lotes del sistema que el físico no vio
  const ausentes = lineas.filter((l) => l.origen === "lote_ausente")
  console.log(`\n--- Lotes del sistema que el físico no vio (${ausentes.length}; sistema ${fmt(ausentes.reduce((s, l) => s + l.sistema, 0))} und) ---`)
  for (const l of ausentes.sort((a, b) => Math.abs(b.sistema) - Math.abs(a.sistema)).slice(0, 30)) {
    console.log(`  ${l.codproducto} ${String(l.producto).slice(0, 36).padEnd(36)} L${l.lote.padEnd(10)} ${l.location.padEnd(10)} ${fmt(l.sistema).padStart(9)}${l.sistema < 0 ? "  (negativo: queda en 0)" : ""}`)
  }

  // Productos no contados que entran con el saldo del sistema
  const noCont = lineas.filter((l) => l.origen === "producto_no_contado")
  if (noCont.length) {
    const porProdNC = new Map<string, { nombre: string; und: number }>()
    for (const l of noCont) {
      const g = porProdNC.get(l.codproducto) ?? { nombre: l.producto, und: 0 }
      g.und += l.sistema
      porProdNC.set(l.codproducto, g)
    }
    console.log(`\n--- Productos no contados, entran con el saldo del sistema (${porProdNC.size}; ${fmt(noCont.reduce((s, l) => s + l.sistema, 0))} und) ---`)
    for (const [cod, g] of Array.from(porProdNC).sort((a, b) => b[1].und - a[1].und)) console.log(`  ${cod} ${String(g.nombre).slice(0, 44).padEnd(44)} ${fmt(g.und).padStart(9)}`)
  }

  // Ubicaciones nuevas
  const ubiSistema = new Set(Array.from(sistemaPorClave.keys()).map((k) => norm(k.split("||")[2])))
  const { data: locs } = await supabase.from("locations").select("codigo").eq("idempresa", proyectoId)
  for (const l of locs ?? []) if (l.codigo) ubiSistema.add(norm(l.codigo))
  const ubiNuevas = Array.from(new Set(lineas.filter((l) => l.origen === "archivo").map((l) => norm(l.location)))).filter((u) => !ubiSistema.has(u))
  console.log(`\n--- Ubicaciones del archivo que no existen hoy en ID${proyectoId}: ${ubiNuevas.length ? ubiNuevas.join(", ") : "ninguna"} ---`)

  // Control: ¿ya hay conteo total del mes?
  const mes = corte.slice(0, 7)
  const { data: existentes } = await supabase
    .from("sig_inventario_cuadre")
    .select("id,fecha,estado,activo")
    .eq("proyecto_id", proyectoId)
    .eq("tipo", "total")
    .gte("fecha", `${mes}-01`)
    .lte("fecha", `${mes}-31`)
    .order("id")
  console.log(`\n--- Conteos totales ya existentes en ${mes} (${existentes?.length ?? 0}) ---`)
  for (const c of existentes ?? []) {
    const bloquea = c.activo && c.estado !== "anulado"
    console.log(`  #${c.id} ${c.fecha} ${c.estado} activo=${c.activo}${bloquea ? "  <- BLOQUEA la creación" : "  (no bloquea)"}`)
    if (bloquea) bloqueantes.push(`Ya existe el Conteo total #${c.id} (${c.estado}, activo) en ${mes}`)
  }

  if (bloqueantes.length) {
    console.log(`\n${"!".repeat(78)}`)
    console.log(`BLOQUEANTES (${bloqueantes.length}) — no se escribe nada:`)
    for (const b of bloqueantes) console.log(`  ⛔ ${b}`)
    process.exit(1)
  }

  // ---------------- 7) Emitir el cargue como SQL (para correrlo en Supabase) ----------------
  if (rutaSql) {
    const q = (s: any): string => (s === null || s === undefined || s === "" ? "null" : `'${String(s).replace(/'/g, "''")}'`)
    const num = (x: number) => String(n2(x))
    const fechaCorreccion = vispera(corte)
    const conDifSql = lineas.filter((l) => n2(l.conteo - l.sistema) !== 0)
    const L: string[] = []
    L.push(`-- =====================================================================`)
    L.push(`-- CONTEO TOTAL de ID${proyectoId} (${emp?.nombre ?? ""}) con fecha ${corte}`)
    L.push(`-- = inventario inicial de ${mes} = cierre físico del ${fechaCorreccion}.`)
    L.push(`--`)
    L.push(`-- Generado por scripts/sig/cargar_conteo_total_fisico.mts el ${new Date().toISOString()}`)
    L.push(`-- Archivo físico: ${input} (${filas.length} claves, ${fmt(filas.reduce((s, f) => s + f.fisico, 0))} und)`)
    L.push(`-- Decisiones: ${rutaConfig ?? "(sin config)"}`)
    L.push(`--`)
    L.push(`-- Hace lo MISMO que la pantalla: crea el conteo (crearCuadre), guarda el`)
    L.push(`-- físico (guardarConteoCuadre) y genera las correcciones (generarAjustesCuadre)`)
    L.push(`-- en estado 'registrado'. NO mueve inventario: el stock solo cambia cuando se`)
    L.push(`-- aprueban las correcciones en "Cuadre y Correcciones de Inventario" con clave.`)
    L.push(`--`)
    L.push(`-- Resumen de lo que va a quedar:`)
    L.push(`--   líneas del conteo ............ ${lineas.length} (${porOrigen.archivo} del archivo, ${porOrigen.lote_ausente} lotes ausentes -> 0, ${porOrigen.producto_no_contado} de productos no contados -> saldo del sistema)`)
    L.push(`--   total sistema (amanecer) ..... ${fmt(totalSistema)} und`)
    L.push(`--   total conteo (inicial) ....... ${fmt(totalConteo)} und`)
    L.push(`--   diferencia neta .............. ${fmt(totalConteo - totalSistema)} und en ${conDifSql.length} líneas`)
    L.push(`--   correcciones ................. ${sobrantes.length} sobrante 701 (+${fmt(sobrantes.reduce((s, l) => s + (l.conteo - l.sistema), 0))}) y ${faltantes.length} faltante 702 (${fmt(faltantes.reduce((s, l) => s + (l.conteo - l.sistema), 0))}), fechadas ${fechaCorreccion}`)
    L.push(`-- =====================================================================`)
    L.push(``)
    L.push(`-- ============================ ANTES =================================`)
    L.push(`select 'conteos totales de ${mes}' as foto, id, fecha, estado, activo, items, total_sistema, total_conteo, total_diferencia`)
    L.push(`  from sig_inventario_cuadre where proyecto_id = ${proyectoId} and tipo = 'total' and fecha between '${mes}-01' and '${mes}-31' order by id;`)
    L.push(`select 'stock vivo por producto' as foto, codproducto, nombreproducto, round(sum(stock_actual)::numeric, 2) as und`)
    L.push(`  from saldoinvdetalle where idempresa = ${proyectoId} group by 1, 2, 3 having sum(stock_actual) <> 0 order by 4 desc;`)
    L.push(``)
    L.push(`-- ========================== CORRECCIÓN ==============================`)
    L.push(`begin;`)
    L.push(`do $cargue$`)
    L.push(`declare`)
    L.push(`  v_cuadre int;`)
    L.push(`  v_existe int;`)
    L.push(`  v_pend int;`)
    L.push(`begin`)
    L.push(`  -- Guarda 1: un solo Conteo total activo por mes (misma regla que crearCuadre).`)
    L.push(`  select count(*) into v_existe from sig_inventario_cuadre`)
    L.push(`   where proyecto_id = ${proyectoId} and tipo = 'total' and activo is true and estado <> 'anulado'`)
    L.push(`     and fecha between '${mes}-01' and '${mes}-31';`)
    L.push(`  if v_existe > 0 then`)
    L.push(`    raise exception 'Ya existe un Conteo total activo en ${mes} para ID${proyectoId}: no se crea otro.';`)
    L.push(`  end if;`)
    L.push(`  -- Guarda 2: ninguna salida de orden ya finalizada sin confirmar el picking.`)
    L.push(`  select count(*) into v_pend from invtrans i`)
    L.push(`    join cabeceraoc c on c.ordendecargue = trim(i.ocargue) and lower(c.status) = 'finalizado'`)
    L.push(`   where i.idempresa = ${proyectoId} and i.status = 'por descontar';`)
    L.push(`  if v_pend > 0 then`)
    L.push(`    raise exception 'Hay % salida(s) por descontar de órdenes finalizadas: confirmar el picking antes del conteo.', v_pend;`)
    L.push(`  end if;`)
    L.push(``)
    L.push(`  insert into sig_inventario_cuadre`)
    L.push(`    (proyecto_id, fecha, tipo, almacen, responsable, estado, total_sistema, total_conteo, total_diferencia, items, items_con_diferencia, observaciones, creado_por)`)
    L.push(`  values`)
    L.push(`    (${proyectoId}, '${corte}', 'total', null, ${q(actor)}, 'borrador', ${num(totalSistema)}, ${num(totalSistema)}, 0, ${sistemaPorClave.size}, 0, ${q(`Inventario inicial de ${mes} cargado desde el archivo físico del cliente (${input.split("/").pop()}); cierre físico del ${fechaCorreccion}.`)}, ${q(actor)})`)
    L.push(`  returning id into v_cuadre;`)
    L.push(`  raise notice 'Conteo total creado: #%', v_cuadre;`)
    L.push(``)
    L.push(`  -- Detalle: ${lineas.length} líneas (producto, lote, ubicación, sistema, conteo).`)
    for (let i = 0; i < lineas.length; i += 100) {
      const trozo = lineas.slice(i, i + 100)
      L.push(`  insert into sig_inventario_cuadre_detalle (cuadre_id, codproducto, producto, lote, location, sistema, conteo, diferencia, observacion) values`)
      L.push(
        trozo
          .map((l) => `    (v_cuadre, ${q(l.codproducto)}, ${q(l.producto)}, ${q(l.lote)}, ${q(l.location)}, ${num(l.sistema)}, ${num(l.conteo)}, ${num(l.conteo - l.sistema)}, ${q(l.observacion)})`)
          .join(",\n") + ";",
      )
    }
    L.push(``)
    L.push(`  update sig_inventario_cuadre set`)
    L.push(`    estado = 'contado', total_sistema = ${num(totalSistema)}, total_conteo = ${num(totalConteo)},`)
    L.push(`    total_diferencia = ${num(totalConteo - totalSistema)}, items = ${lineas.length}, items_con_diferencia = ${conDifSql.length}, updated_at = now()`)
    L.push(`   where id = v_cuadre;`)
    L.push(``)
    if (conDifSql.length > 0) {
      L.push(`  -- Correcciones: ${conDifSql.length} líneas con diferencia, fechadas ${fechaCorreccion} (pertenecen al mes que se cierra).`)
      for (let i = 0; i < conDifSql.length; i += 100) {
        const trozo = conDifSql.slice(i, i + 100)
        L.push(`  insert into sig_inventario_ajuste (proyecto_id, cuadre_id, fecha, codproducto, producto, lote, location, direccion, cod_movimiento, cantidad, tipo, motivo, responsable, estado) values`)
        L.push(
          trozo
            .map((l) => {
              const dif = n2(l.conteo - l.sistema)
              const esFaltante = dif < 0
              return `    (${proyectoId}, v_cuadre, '${fechaCorreccion}', ${q(l.codproducto)}, ${q(l.producto)}, ${q(l.lote)}, ${q(l.location)}, ${esFaltante ? "'salida'" : "'ingreso'"}, ${esFaltante ? "'702'" : "'701'"}, ${num(dif)}, ${esFaltante ? "'faltante'" : "'sobrante'"}, 'Ajuste por conteo físico (cuadre)', ${q(actor)}, 'registrado')`
            })
            .join(",\n") + ";",
        )
      }
      L.push(``)
      L.push(`  update sig_inventario_cuadre set estado = 'cerrado', updated_at = now() where id = v_cuadre;`)
      L.push(`  raise notice 'Correcciones generadas: ${conDifSql.length} (estado registrado, sin aprobar)';`)
    }
    L.push(`end`)
    L.push(`$cargue$;`)
    L.push(`commit;`)
    L.push(``)
    L.push(`-- =========================== DESPUÉS ================================`)
    L.push(`select 'conteo creado' as verificacion, id, fecha, tipo, estado, activo, items, items_con_diferencia, total_sistema, total_conteo, total_diferencia`)
    L.push(`  from sig_inventario_cuadre where proyecto_id = ${proyectoId} and tipo = 'total' and fecha = '${corte}' order by id;`)
    L.push(`select 'líneas por origen' as verificacion, coalesce(observacion, 'del archivo físico') as origen, count(*) as lineas, round(sum(sistema)::numeric,2) as sistema, round(sum(conteo)::numeric,2) as conteo`)
    L.push(`  from sig_inventario_cuadre_detalle d`)
    L.push(`  where d.cuadre_id = (select max(id) from sig_inventario_cuadre where proyecto_id = ${proyectoId} and tipo = 'total' and fecha = '${corte}')`)
    L.push(`  group by 1, 2 order by 3 desc;`)
    L.push(`select 'correcciones por tipo' as verificacion, tipo, cod_movimiento, estado, count(*) as lineas, round(sum(cantidad)::numeric,2) as unidades`)
    L.push(`  from sig_inventario_ajuste`)
    L.push(`  where cuadre_id = (select max(id) from sig_inventario_cuadre where proyecto_id = ${proyectoId} and tipo = 'total' and fecha = '${corte}')`)
    L.push(`  group by 1, 2, 3, 4 order by 2;`)
    L.push(`select 'conteo por producto' as verificacion, codproducto, max(producto) as producto, round(sum(sistema)::numeric,2) as sistema, round(sum(conteo)::numeric,2) as conteo, round(sum(diferencia)::numeric,2) as diferencia`)
    L.push(`  from sig_inventario_cuadre_detalle`)
    L.push(`  where cuadre_id = (select max(id) from sig_inventario_cuadre where proyecto_id = ${proyectoId} and tipo = 'total' and fecha = '${corte}')`)
    L.push(`  group by 1, 2 order by abs(sum(diferencia)) desc;`)
    L.push(``)
    L.push(`-- Queda pendiente, en la pantalla "Cuadre y Correcciones de Inventario":`)
    L.push(`--   1) revisar las ${conDifSql.length} correcciones del conteo;`)
    L.push(`--   2) aprobarlas con la clave del responsable (ahí se mueve el stock);`)
    L.push(`--   3) el conteo queda 'cerrado' y activo, que es lo que exige obtenerBaseDelMes`)
    L.push(`--      para tomarlo como base de ${mes}.`)
    writeFileSync(rutaSql, L.join("\n") + "\n", "utf8")
    console.log(`\n✅ SQL escrito en ${rutaSql} (${L.length} líneas). La base de datos NO se tocó.`)
    console.log(`   Córrelo en Supabase (SQL Editor) en tres pasos: ANTES, CORRECCIÓN, DESPUÉS.`)
    return
  }

  if (!escribir) {
    console.log(`\n${"=".repeat(78)}`)
    console.log(`SOLO LECTURA: no se escribió nada. Para cargarlo, repetir el comando con --escribir`)
    console.log(`(o con --sql <archivo> para generar el SQL y correrlo en Supabase).`)
    console.log(`Después del cargue, las correcciones quedan en estado "registrado": se aprueban`)
    console.log(`en "Cuadre y Correcciones de Inventario" con la clave del responsable.`)
    return
  }

  // ---------------- 7) Escritura ----------------
  console.log(`\n--- ESCRIBIENDO ---`)
  const crear = await crearCuadre(proyectoId, { fecha: corte, tipo: "total", responsable: actor, creado_por: actor })
  if (!crear.success || !crear.id) {
    console.error(`⛔ crearCuadre falló: ${crear.error}`)
    process.exit(1)
  }
  console.log(`✅ Conteo creado #${crear.id} (semilla de ${crear.items} líneas del sistema; se reemplaza por el físico)`)
  if (crear.items !== sistemaPorClave.size) {
    console.log(`   ⚠️ La semilla trae ${crear.items} líneas y este reporte calculó ${sistemaPorClave.size}: hubo movimientos entre el cálculo y la creación. Revisar el conteo antes de aprobar.`)
  }

  const guardar = await guardarConteoCuadre(
    crear.id,
    lineas.map((l) => ({ codproducto: l.codproducto, producto: l.producto, lote: l.lote, location: l.location, sistema: l.sistema, conteo: l.conteo, observacion: l.observacion })),
  )
  if (!guardar.success) {
    console.error(`⛔ guardarConteoCuadre falló: ${guardar.error}`)
    process.exit(1)
  }
  console.log(`✅ Físico guardado: ${lineas.length} líneas (estado -> contado)`)

  const ajustes = await generarAjustesCuadre(crear.id)
  if (!ajustes.success) {
    console.error(`⛔ generarAjustesCuadre falló: ${ajustes.error}`)
    process.exit(1)
  }
  console.log(`✅ Correcciones generadas: ${ajustes.creados}, fechadas ${vispera(corte)} (estado -> cerrado)`)

  const { data: verif } = await supabase.from("sig_inventario_cuadre").select("id,fecha,estado,items,items_con_diferencia,total_sistema,total_conteo,total_diferencia").eq("id", crear.id).single()
  console.log(`\n--- DESPUÉS ---`)
  console.log(`  Conteo #${verif?.id} ${verif?.fecha} estado=${verif?.estado} items=${verif?.items} con diferencia=${verif?.items_con_diferencia}`)
  console.log(`  sistema=${fmt(Number(verif?.total_sistema) || 0)} conteo=${fmt(Number(verif?.total_conteo) || 0)} diferencia=${fmt(Number(verif?.total_diferencia) || 0)}`)
  console.log(`\nPENDIENTE (lo hace el usuario en la pantalla, con su clave):`)
  console.log(`  1. Revisar las ${ajustes.creados} correcciones en "Cuadre y Correcciones de Inventario".`)
  console.log(`  2. Aprobarlas para que el stock quede igual al físico.`)
  console.log(`  3. El conteo debe quedar en "cerrado" o "aprobado" y activo para ser la base de ${mes}.`)
}
main()
