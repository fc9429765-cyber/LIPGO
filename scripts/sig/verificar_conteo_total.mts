// SOLO LECTURA. Verifica un Conteo total ya cargado contra el archivo físico del
// cliente: estado del documento, líneas por origen, correcciones por tipo y el
// contraste lote por lote (el conteo debe quedar idéntico al archivo).
//
// Uso: npx tsx --env-file=.env.local scripts/sig/verificar_conteo_total.mts \
//        --proyecto 1 --corte 2026-10-01 --input scripts/sig/data/id1-fisico-2026-10.json \
//        [--config scripts/sig/data/id1-fisico-2026-10.config.json]

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (f: string) => {
    const i = args.indexOf(f)
    return i >= 0 ? args[i + 1] : undefined
  }
  const proyectoId = Number(get("--proyecto"))
  const corte = get("--corte")
  const input = get("--input")
  const config = get("--config")
  if (!proyectoId || !corte) {
    console.error("Uso: --proyecto <id> --corte <YYYY-MM-DD> [--input <archivo.json>] [--config <archivo.json>]")
    process.exit(1)
  }
  return { proyectoId, corte, input, config }
}

const norm = (s: any) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase()
const n2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => n2(x).toLocaleString("es-CO")

async function main() {
  const { proyectoId, corte, input, config: rutaConfig } = parseArgs()
  const env = readFileSync(".env.local", "utf8")
  const getEnv = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim()
  const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL")!, getEnv("SUPABASE_SERVICE_ROLE_KEY")!)

  // ---------- 1) El documento ----------
  const { data: cuadres } = await supabase
    .from("sig_inventario_cuadre")
    .select("*")
    .eq("proyecto_id", proyectoId)
    .eq("tipo", "total")
    .eq("fecha", corte)
    .order("id", { ascending: false })
  const activos = (cuadres ?? []).filter((c: any) => c.activo && c.estado !== "anulado")
  console.log("=".repeat(76))
  console.log(`VERIFICACIÓN · Conteo total de ID${proyectoId} con fecha ${corte}`)
  console.log("=".repeat(76))
  console.log(`\n--- Documentos con esa fecha (${cuadres?.length ?? 0}) ---`)
  for (const c of cuadres ?? []) {
    console.log(
      `  #${c.id} estado=${String(c.estado).padEnd(9)} activo=${String(c.activo).padEnd(5)} items=${String(c.items).padStart(4)} con_dif=${String(c.items_con_diferencia).padStart(4)} sistema=${fmt(Number(c.total_sistema) || 0).padStart(8)} conteo=${fmt(Number(c.total_conteo) || 0).padStart(8)} dif=${fmt(Number(c.total_diferencia) || 0).padStart(8)}  creado_por=${c.creado_por}`,
    )
  }
  if (activos.length !== 1) {
    console.log(`\n⛔ Se esperaba EXACTAMENTE 1 conteo activo y hay ${activos.length}. Revisar antes de seguir.`)
    if (activos.length === 0) process.exit(1)
  }
  const cuadre = activos[0]
  const ESTADOS_BASE = ["aprobado", "cerrado"]
  const esBase = ESTADOS_BASE.includes(String(cuadre.estado)) && cuadre.activo && corte <= `${corte.slice(0, 7)}-07`
  console.log(`\n  ¿lo tomará obtenerBaseDelMes como base de ${corte.slice(0, 7)}? ${esBase ? "SÍ" : "NO"} (exige activo, estado aprobado/cerrado y fecha entre el 1 y el 7)`)

  // ---------- 2) El detalle ----------
  const detalle: any[] = []
  {
    let from = 0
    while (true) {
      const { data } = await supabase
        .from("sig_inventario_cuadre_detalle")
        .select("codproducto,producto,lote,location,sistema,conteo,diferencia,observacion")
        .eq("cuadre_id", cuadre.id)
        .order("id", { ascending: true })
        .range(from, from + 999)
      detalle.push(...(data ?? []))
      if (!data || data.length < 1000) break
      from += 1000
    }
  }
  const sumSis = n2(detalle.reduce((s, d) => s + (Number(d.sistema) || 0), 0))
  const sumCon = n2(detalle.reduce((s, d) => s + (Number(d.conteo) || 0), 0))
  const sumDif = n2(detalle.reduce((s, d) => s + (Number(d.diferencia) || 0), 0))
  console.log(`\n--- Detalle: ${detalle.length} líneas · sistema ${fmt(sumSis)} · conteo ${fmt(sumCon)} · diferencia ${fmt(sumDif)} ---`)
  const porOrigen: Record<string, { n: number; sis: number; con: number }> = {}
  for (const d of detalle) {
    const k = !d.observacion ? "del archivo físico" : String(d.observacion).startsWith("Producto no contado") ? "producto no contado" : "lote ausente del archivo"
    const g = (porOrigen[k] ||= { n: 0, sis: 0, con: 0 })
    g.n++
    g.sis += Number(d.sistema) || 0
    g.con += Number(d.conteo) || 0
  }
  for (const [k, g] of Object.entries(porOrigen)) console.log(`  ${k.padEnd(26)} ${String(g.n).padStart(4)} líneas · sistema ${fmt(g.sis).padStart(8)} · conteo ${fmt(g.con).padStart(8)}`)

  // ---------- 3) Las correcciones ----------
  const { data: ajustes } = await supabase.from("sig_inventario_ajuste").select("*").eq("cuadre_id", cuadre.id)
  const porTipo: Record<string, { n: number; und: number; posteadas: number }> = {}
  for (const a of ajustes ?? []) {
    const k = `${a.tipo}/${a.cod_movimiento}/${a.estado}${a.activo ? "" : " (inactiva)"}`
    const g = (porTipo[k] ||= { n: 0, und: 0, posteadas: 0 })
    g.n++
    g.und += Number(a.cantidad) || 0
    if (a.invtrans_id) g.posteadas++
  }
  console.log(`\n--- Correcciones: ${ajustes?.length ?? 0} ---`)
  for (const [k, g] of Object.entries(porTipo).sort()) console.log(`  ${k.padEnd(34)} ${String(g.n).padStart(4)} · ${fmt(g.und).padStart(9)} und · posteadas a invtrans: ${g.posteadas}`)
  const fechas = Array.from(new Set((ajustes ?? []).map((a: any) => String(a.fecha))))
  console.log(`  fecha(s): ${fechas.join(", ")}`)
  const sumAj = n2((ajustes ?? []).reduce((s: number, a: any) => s + (Number(a.cantidad) || 0), 0))
  console.log(`  suma de correcciones ${fmt(sumAj)} vs diferencia del detalle ${fmt(sumDif)} -> ${Math.abs(sumAj - sumDif) < 0.01 ? "OK" : "DESCUADRE"}`)

  // ---------- 4) Contraste con el archivo del cliente ----------
  if (input) {
    const filas: any[] = JSON.parse(readFileSync(input, "utf8"))
    const cfg = rutaConfig ? JSON.parse(readFileSync(rutaConfig, "utf8")) : {}
    const alias: Record<string, string> = {}
    for (const [k, v] of Object.entries(cfg.alias ?? {})) alias[norm(k)] = String(v)

    const totalArchivo = n2(filas.reduce((s, f) => s + (Number(f.fisico) || 0), 0))
    console.log(`\n--- Contraste con ${input} ---`)
    console.log(`  total del archivo: ${fmt(totalArchivo)} und en ${filas.length} claves`)
    console.log(`  total del conteo:  ${fmt(sumCon)} und en ${detalle.length} líneas`)

    // Por producto: el archivo agrupado por nombre vs el conteo agrupado por nombre/código.
    const codPorNombreConteo = new Map<string, string>()
    for (const d of detalle) if (d.producto) codPorNombreConteo.set(norm(d.producto), d.codproducto)
    const archivoPorCod = new Map<string, number>()
    const sinMapear: string[] = []
    for (const f of filas) {
      const nombre = norm(f.producto)
      const cod = alias[nombre] ?? codPorNombreConteo.get(nombre)
      if (!cod) {
        sinMapear.push(nombre)
        continue
      }
      archivoPorCod.set(cod, n2((archivoPorCod.get(cod) ?? 0) + (Number(f.fisico) || 0)))
    }
    if (sinMapear.length) console.log(`  ⚠️ nombres del archivo que no se pudieron mapear: ${Array.from(new Set(sinMapear)).join(" | ")}`)

    const conteoPorCod = new Map<string, number>()
    for (const d of detalle) conteoPorCod.set(d.codproducto, n2((conteoPorCod.get(d.codproducto) ?? 0) + (Number(d.conteo) || 0)))

    console.log(`\n  ${"COD".padEnd(10)}${"ARCHIVO".padStart(10)}${"CONTEO".padStart(10)}${"DIF".padStart(8)}`)
    let difs = 0
    for (const cod of Array.from(new Set([...archivoPorCod.keys(), ...conteoPorCod.keys()])).sort()) {
      const a = archivoPorCod.get(cod) ?? 0
      const c = conteoPorCod.get(cod) ?? 0
      const d = n2(c - a)
      if (d !== 0) difs++
      console.log(`  ${cod.padEnd(10)}${fmt(a).padStart(10)}${fmt(c).padStart(10)}${fmt(d).padStart(8)}${d !== 0 ? (a === 0 ? "  <- no está en el archivo (no contado -> 0)" : "  <- REVISAR") : ""}`)
    }
    console.log(`\n  productos con diferencia contra el archivo: ${difs} ${difs === 0 ? "(el conteo es idéntico al archivo)" : "(los de ARCHIVO=0 son los productos que el archivo no menciona)"}`)

    // Lote por lote de las claves del archivo.
    let iguales = 0
    const distintas: string[] = []
    const conteoPorClave = new Map<string, number>()
    for (const d of detalle) conteoPorClave.set(`${d.codproducto}||${String(d.lote ?? "").trim()}||${norm(d.location)}`, n2((conteoPorClave.get(`${d.codproducto}||${String(d.lote ?? "").trim()}||${norm(d.location)}`) ?? 0) + (Number(d.conteo) || 0)))
    for (const f of filas) {
      const nombre = norm(f.producto)
      const cod = alias[nombre] ?? codPorNombreConteo.get(nombre)
      if (!cod) continue
      const key = `${cod}||${String(f.lote ?? "").trim()}||${norm(f.location)}`
      const enConteo = conteoPorClave.get(key) ?? 0
      if (Math.abs(enConteo - (Number(f.fisico) || 0)) < 0.01) iguales++
      else distintas.push(`${cod} L${f.lote} ${f.location}: archivo ${fmt(Number(f.fisico) || 0)} vs conteo ${fmt(enConteo)}`)
    }
    console.log(`\n  lote por lote: ${iguales} de ${filas.length} claves del archivo coinciden exacto${distintas.length ? `; ${distintas.length} NO:` : " ✅"}`)
    for (const x of distintas.slice(0, 20)) console.log(`    ⚠️ ${x}`)
  }

  // ---------- 5) Qué falta ----------
  const pendientes = (ajustes ?? []).filter((a: any) => a.activo && !a.invtrans_id).length
  console.log(`\n--- Estado final ---`)
  if (pendientes > 0) {
    console.log(`  Faltan ${pendientes} correcciones por contabilizar: el STOCK todavía NO es igual al físico.`)
    console.log(`  Paso en la app: Cuadre de Inventario -> conteo #${cuadre.id} -> "Cerrar mes (ajusta stock)".`)
  } else {
    console.log(`  Todas las correcciones están posteadas: el stock ya quedó igual al conteo físico.`)
  }
  console.log("\nNO SE ESCRIBIÓ NADA.")
}
main()
