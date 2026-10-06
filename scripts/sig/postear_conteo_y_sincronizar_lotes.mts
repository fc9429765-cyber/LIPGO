// SOLO LECTURA (emite SQL, no escribe en la base). Dos cosas, para un Conteo total
// ya cargado cuyas correcciones están en "registrado":
//
//   1. POSTEO: el SQL que contabiliza las correcciones a `invtrans` y deja el
//      conteo en 'aprobado'. Replica campo por campo lo que hace
//      `postCorreccionInvtrans` + `marcarAjusteAprobado` + `cerrarMesCuadre`
//      (incluido el marcador [aj#id] que da idempotencia y la fecha del ajuste
//      a las 15:00Z, para que la corrección pertenezca al mes que se cierra).
//
//   2. SINCRONIZACIÓN DE LOTES: cuando el conteo se contabiliza días después del
//      corte, la operación ya despachó sobre la estructura vieja de lotes, así que
//      al forzar el físico quedan lotes en negativo (se despachó de un lote que,
//      según el conteo, no tenía esas unidades: las unidades salieron de otro lote).
//      El remedio del propio sistema es la RECLASIFICACIÓN 309 (lote origen ->
//      lote destino, mismo producto, neto 0). Este script la arma por regla:
//      para cada lote negativo toma del LOTE MÁS PRÓXIMO del mismo producto
//      (la menor diferencia de días entre la fecha del lote donante y la del lote
//      en negativo — instrucción de gerencia 2026-10-05), desempatando por la misma
//      ubicación y luego por el mayor saldo. No cambia el total de ningún producto;
//      cada par queda listado y es reversible.
//      OJO: es una asignación POR REGLA, no evidencia. Si el coordinador sabe de
//      qué lote salió de verdad, se corrige con otra 309.
//
// Uso:
//   npx tsx --env-file=.env.local scripts/sig/postear_conteo_y_sincronizar_lotes.mts \
//     --cuadre 40 --actor "gerenciageneral@lip-sas.com" \
//     --sql-posteo scripts/235_postear_conteo40_id1.sql \
//     --sql-lotes scripts/236_reclasificar_lotes_id1.sql

import { createClient } from "@supabase/supabase-js"
import { readFileSync, writeFileSync } from "fs"

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (f: string) => {
    const i = args.indexOf(f)
    return i >= 0 ? args[i + 1] : undefined
  }
  const cuadreId = Number(get("--cuadre"))
  const actor = get("--actor") || "gerenciageneral@lip-sas.com"
  const sqlPosteo = get("--sql-posteo")
  const sqlLotes = get("--sql-lotes")
  // Códigos cuyas correcciones NO se van a contabilizar porque otro SQL previo las
  // retira (caso real: los productos que el archivo físico no menciona y que
  // gerencia dejó con el saldo del sistema, SQL 234). El SQL generado exige que ya
  // no existan, así que no se puede correr fuera de orden.
  const omitir = (get("--omitir-codigos") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  if (!cuadreId) {
    console.error("Uso: --cuadre <id> [--actor <email>] [--omitir-codigos COD1,COD2] [--sql-posteo <archivo>] [--sql-lotes <archivo>]")
    process.exit(1)
  }
  return { cuadreId, actor, sqlPosteo, sqlLotes, omitir }
}

const n2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => n2(x).toLocaleString("es-CO")
const q = (s: any) => (s === null || s === undefined || s === "" ? "null" : `'${String(s).replace(/'/g, "''")}'`)

/**
 * Día (número) que representa un lote con formato de fecha: 20260929 = 29-sep-2026.
 * También tolera los de 7 dígitos que hay en la base (2026828 = 28-ago-2026).
 * Si no se puede leer como fecha devuelve null y el lote queda de último al elegir
 * el "lote más próximo".
 */
function diaDeLote(lote: any): number | null {
  const s = String(lote ?? "").trim()
  let y: number, m: number, d: number
  if (/^\d{8}$/.test(s)) {
    y = +s.slice(0, 4)
    m = +s.slice(4, 6)
    d = +s.slice(6, 8)
  } else if (/^\d{7}$/.test(s)) {
    y = +s.slice(0, 4)
    m = +s.slice(4, 5)
    d = +s.slice(5, 7)
  } else return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return Date.UTC(y, m - 1, d) / 86400000
}

async function main() {
  const { cuadreId, actor, sqlPosteo, sqlLotes, omitir } = parseArgs()
  const omitirSet = new Set(omitir)
  const env = readFileSync(".env.local", "utf8")
  const getEnv = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim()
  const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL")!, getEnv("SUPABASE_SERVICE_ROLE_KEY")!)

  const { data: cuadre } = await supabase.from("sig_inventario_cuadre").select("*").eq("id", cuadreId).single()
  if (!cuadre) {
    console.error(`⛔ No existe el conteo #${cuadreId}`)
    process.exit(1)
  }
  const proyectoId = Number(cuadre.proyecto_id)
  console.log("=".repeat(78))
  console.log(`Conteo #${cuadreId} · ID${proyectoId} · fecha ${cuadre.fecha} · estado ${cuadre.estado} · activo ${cuadre.activo}`)
  console.log("=".repeat(78))

  // ---------- Correcciones pendientes ----------
  const { data: ajustes } = await supabase.from("sig_inventario_ajuste").select("*").eq("cuadre_id", cuadreId).eq("activo", true).order("id")
  const omitidas = (ajustes ?? []).filter((a: any) => omitirSet.has(a.codproducto))
  const pendientes = (ajustes ?? []).filter((a: any) => !a.invtrans_id && !omitirSet.has(a.codproducto))
  const yaPosteadas = (ajustes ?? []).filter((a: any) => a.invtrans_id)
  console.log(`\nCorrecciones activas: ${ajustes?.length ?? 0} · pendientes de contabilizar: ${pendientes.length} · ya posteadas: ${yaPosteadas.length}`)
  if (omitirSet.size) {
    console.log(`  se OMITEN ${omitidas.length} correcciones de ${omitirSet.size} códigos (${omitir.join(", ")}): las retira el SQL previo, y el SQL generado exige que ya no existan.`)
  }
  if (pendientes.length === 0) {
    console.log("No hay nada que postear.")
    return
  }
  const sob = pendientes.filter((a: any) => Number(a.cantidad) > 0)
  const fal = pendientes.filter((a: any) => Number(a.cantidad) < 0)
  console.log(`  sobrante (701/ingreso): ${sob.length} · +${fmt(sob.reduce((s: number, a: any) => s + Number(a.cantidad), 0))} und`)
  console.log(`  faltante (702/salida):  ${fal.length} · ${fmt(fal.reduce((s: number, a: any) => s + Number(a.cantidad), 0))} und`)
  const fechas = Array.from(new Set(pendientes.map((a: any) => String(a.fecha))))
  console.log(`  fecha(s) de las correcciones: ${fechas.join(", ")} (los movimientos se fechan ese día a las 15:00Z)`)

  // ---------- Stock vivo y simulación ----------
  const vivo = new Map<string, number>()
  const nombrePorCod = new Map<string, string>()
  {
    let from = 0
    while (true) {
      const { data } = await supabase
        .from("saldoinvdetalle")
        .select("codproducto,nombreproducto,lote,location,stock_actual")
        .eq("idempresa", proyectoId)
        .order("codproducto")
        .order("lote")
        .order("location")
        .range(from, from + 999)
      for (const r of data ?? []) {
        const k = `${r.codproducto}||${r.lote ?? ""}||${r.location ?? ""}`
        vivo.set(k, (vivo.get(k) ?? 0) + (Number(r.stock_actual) || 0))
        if (r.nombreproducto && !nombrePorCod.has(r.codproducto)) nombrePorCod.set(r.codproducto, r.nombreproducto)
      }
      if (!data || data.length < 1000) break
      from += 1000
    }
  }
  const despues = new Map(vivo)
  for (const a of pendientes) {
    const k = `${a.codproducto}||${a.lote ?? ""}||${a.location ?? ""}`
    despues.set(k, n2((despues.get(k) ?? 0) + (Number(a.cantidad) || 0)))
    if (a.producto && !nombrePorCod.has(a.codproducto)) nombrePorCod.set(a.codproducto, a.producto)
  }
  const negativos = Array.from(despues.entries()).filter(([, v]) => v < -0.009).sort((a, b) => a[1] - b[1])
  console.log(`\nLotes negativos después del posteo: ${negativos.length} (${fmt(negativos.reduce((s, [, v]) => s + v, 0))} und)`)

  // ---------- Asignación de las reclasificaciones 309 ----------
  type Par = { cod: string; producto: string; loteDestino: string; locDestino: string; loteOrigen: string; locOrigen: string; cantidad: number; mismaUbicacion: boolean; dias: number }
  const pares: Par[] = []
  const sinCubrir: string[] = []
  const saldo = new Map(despues) // se va consumiendo al asignar
  for (const [keyNeg, valNeg] of negativos) {
    const [cod, loteNeg, locNeg] = keyNeg.split("||")
    let falta = n2(-valNeg)
    const diaNeg = diaDeLote(loteNeg)
    // Donantes: mismo producto, saldo > 0. Regla de gerencia: el LOTE MÁS PRÓXIMO
    // (menor diferencia de días); desempate por la misma ubicación y mayor saldo.
    const donantes = Array.from(saldo.entries())
      .filter(([k, v]) => k.startsWith(`${cod}||`) && v > 0.009 && k !== keyNeg)
      .map(([k, v]) => {
        const [, lote, loc] = k.split("||")
        const diaDon = diaDeLote(lote)
        const dias = diaNeg === null || diaDon === null ? Number.POSITIVE_INFINITY : Math.abs(diaDon - diaNeg)
        return { k, lote, loc, v, misma: loc === locNeg, dias }
      })
      .sort((a, b) => (a.dias !== b.dias ? a.dias - b.dias : a.misma !== b.misma ? (a.misma ? -1 : 1) : b.v - a.v))
    for (const d of donantes) {
      if (falta <= 0.009) break
      const toma = Math.min(falta, d.v)
      pares.push({
        cod,
        producto: nombrePorCod.get(cod) ?? cod,
        loteDestino: loteNeg,
        locDestino: locNeg,
        loteOrigen: d.lote,
        locOrigen: d.loc,
        cantidad: n2(toma),
        mismaUbicacion: d.misma,
        dias: d.dias,
      })
      saldo.set(d.k, n2(d.v - toma))
      falta = n2(falta - toma)
    }
    saldo.set(keyNeg, n2((saldo.get(keyNeg) ?? 0) + (n2(-valNeg) - falta)))
    if (falta > 0.009) sinCubrir.push(`${cod} L${loteNeg} ${locNeg}: faltan ${fmt(falta)} und sin lote de donde tomar`)
  }
  const negDespuesDeReclasificar = Array.from(saldo.entries()).filter(([, v]) => v < -0.009)
  console.log(`\nReclasificaciones 309 necesarias: ${pares.length} pares · ${fmt(pares.reduce((s, p) => s + p.cantidad, 0))} und`)
  console.log(`  en la MISMA ubicación (solo cambia el lote): ${pares.filter((p) => p.mismaUbicacion).length} · distancia media al lote donante: ${(pares.filter((p) => Number.isFinite(p.dias)).reduce((s, p) => s + p.dias, 0) / Math.max(1, pares.filter((p) => Number.isFinite(p.dias)).length)).toFixed(1)} días`)
  console.log(`  lotes que seguirían negativos: ${negDespuesDeReclasificar.length}${sinCubrir.length ? " -> " + sinCubrir.join(" | ") : ""}`)
  console.log(`\n  ${"COD".padEnd(10)}${"LOTE DESTINO".padEnd(14)}${"UBIC".padEnd(10)}${"LOTE ORIGEN".padEnd(14)}${"UBIC".padEnd(10)}${"UND".padStart(9)}${"DÍAS".padStart(7)}`)
  for (const p of pares.slice(0, 40)) {
    console.log(`  ${p.cod.padEnd(10)}${p.loteDestino.padEnd(14)}${p.locDestino.padEnd(10)}${p.loteOrigen.padEnd(14)}${p.locOrigen.padEnd(10)}${fmt(p.cantidad).padStart(9)}${(Number.isFinite(p.dias) ? String(p.dias) : "?").padStart(7)}`)
  }
  if (pares.length > 40) console.log(`  … y ${pares.length - 40} pares más (todos van en el SQL)`)

  // Control: por producto, la reclasificación no cambia nada.
  const cambioPorProd = new Map<string, number>()
  for (const p of pares) cambioPorProd.set(p.cod, n2((cambioPorProd.get(p.cod) ?? 0) + 0))
  console.log(`\n  control: la reclasificación mueve ${fmt(pares.reduce((s, p) => s + p.cantidad, 0))} und entre lotes y deja el total de cada producto IGUAL (${cambioPorProd.size} productos tocados).`)

  const { data: maxRow } = await supabase.from("invtrans").select("id").order("id", { ascending: false }).limit(1).maybeSingle()
  console.log(`\nmax(invtrans.id) hoy: ${maxRow?.id}`)

  // =================== SQL 1: POSTEO ===================
  if (sqlPosteo) {
    const L: string[] = []
    const mes = String(cuadre.fecha).slice(0, 7)
    L.push(`-- =====================================================================`)
    L.push(`-- CONTABILIZAR el Conteo total #${cuadreId} de ID${proyectoId} (fecha ${cuadre.fecha}) y dejarlo APROBADO.`)
    L.push(`--`)
    L.push(`-- Hace exactamente lo que el botón "Cerrar mes (ajusta stock)" de la pantalla`)
    L.push(`-- (cerrarMesCuadre -> postCorreccionInvtrans -> marcarAjusteAprobado):`)
    L.push(`--   * inserta en invtrans un movimiento por corrección, fechado ${fechas[0]} 15:00Z`)
    L.push(`--     (la corrección pertenece al mes que se cierra), status 'aprobado',`)
    L.push(`--     origen 'transaccion manual', con el marcador [aj#id] en observaciones`)
    L.push(`--     que da idempotencia;`)
    L.push(`--   * marca cada corrección como aprobada con su invtrans_id;`)
    L.push(`--   * deja el conteo en 'aprobado' = inventario inicial en firme de ${mes}.`)
    L.push(`--`)
    L.push(`-- Correcciones a contabilizar: ${pendientes.length} (${sob.length} sobrante 701 +${fmt(sob.reduce((s: number, a: any) => s + Number(a.cantidad), 0))} / ${fal.length} faltante 702 ${fmt(fal.reduce((s: number, a: any) => s + Number(a.cantidad), 0))}).`)
    L.push(`-- Efecto en el stock: ${fmt(pendientes.reduce((s: number, a: any) => s + Number(a.cantidad), 0))} und netas; el saldo de los ${new Set(pendientes.map((a: any) => a.codproducto)).size} productos del conteo`)
    L.push(`-- queda igual al físico del coordinador más los movimientos ya registrados desde el corte.`)
    L.push(`--`)
    L.push(`-- AVISO: ${negativos.length} lote(s) quedan en negativo (${fmt(negativos.reduce((s, [, v]) => s + v, 0))} und) porque la operación`)
    L.push(`-- despachó del 1 al 5 de octubre sobre la estructura vieja de lotes. Los totales por`)
    L.push(`-- producto quedan correctos. Eso se corrige con el SQL siguiente (reclasificación 309).`)
    L.push(`-- =====================================================================`)
    L.push(``)
    L.push(`-- ============================ ANTES =================================`)
    L.push(`select 'cabecera' as foto, id, fecha, estado, activo, items, items_con_diferencia, total_sistema, total_conteo, total_diferencia from sig_inventario_cuadre where id = ${cuadreId};`)
    L.push(`select 'correcciones' as foto, estado, tipo, cod_movimiento, count(*) as lineas, round(sum(cantidad)::numeric,2) as und, count(invtrans_id) as posteadas`)
    L.push(`  from sig_inventario_ajuste where cuadre_id = ${cuadreId} and activo is true group by 1,2,3 order by 3;`)
    L.push(`select 'stock vivo total' as foto, round(sum(stock_actual)::numeric,2) as und, count(*) filter (where stock_actual < 0) as lotes_negativos`)
    L.push(`  from saldoinvdetalle where idempresa = ${proyectoId};`)
    L.push(``)
    L.push(`-- ========================== CORRECCIÓN ==============================`)
    L.push(`begin;`)
    L.push(`do $postear$`)
    L.push(`declare`)
    L.push(`  v_base int;`)
    L.push(`  v_pend int;`)
    L.push(`  v_ins int;`)
    L.push(`  v_marc int;`)
    L.push(`  v_dup int;`)
    L.push(`begin`)
    L.push(`  -- Guarda 1: el conteo debe estar contado/cerrado y activo.`)
    L.push(`  if not exists (select 1 from sig_inventario_cuadre where id = ${cuadreId} and activo is true and estado in ('contado','cerrado')) then`)
    L.push(`    raise exception 'El conteo #${cuadreId} no está activo en estado contado/cerrado.';`)
    L.push(`  end if;`)
    L.push(`  -- Guarda 2: nada posteado antes (idempotencia por el marcador).`)
    L.push(`  select count(*) into v_dup from invtrans where observaciones like '%cuadre #${cuadreId}%';`)
    L.push(`  if v_dup > 0 then`)
    L.push(`    raise exception 'Ya hay % movimiento(s) de este conteo en invtrans: no se postea dos veces.', v_dup;`)
    L.push(`  end if;`)
    L.push(`  -- Guarda 3: el número de correcciones pendientes debe ser el verificado.`)
    L.push(`  select count(*) into v_pend from sig_inventario_ajuste where cuadre_id = ${cuadreId} and activo is true and invtrans_id is null;`)
    L.push(`  if v_pend <> ${pendientes.length} then`)
    L.push(`    raise exception 'Se esperaban ${pendientes.length} correcciones pendientes y hay % (¿falta correr el SQL anterior?).', v_pend;`)
    L.push(`  end if;`)
    if (omitirSet.size) {
      L.push(`  -- Guarda 4: los productos que el archivo no menciona ya no deben tener correcciones`)
      L.push(`  -- (las retira el SQL previo). Si todavía están, este SQL no se puede correr.`)
      L.push(`  if exists (select 1 from sig_inventario_ajuste where cuadre_id = ${cuadreId}`)
      L.push(`              and codproducto in (${omitir.map((c) => q(c)).join(", ")})) then`)
      L.push(`    raise exception 'Todavía hay correcciones de los productos no contados: hay que correr primero el SQL que los deja con el saldo del sistema.';`)
      L.push(`  end if;`)
    }
    L.push(``)
    L.push(`  select coalesce(max(id), 0) into v_base from invtrans;`)
    L.push(``)
    L.push(`  -- Un movimiento por corrección, con los mismos campos que postCorreccionInvtrans.`)
    L.push(`  insert into invtrans`)
    L.push(`    (id, idempresa, idproducto, codproducto, nombreproducto, lote, location, almacen, cantidad, tipomov, status, origen, observaciones, cod_movimiento, creadopor, creado)`)
    L.push(`  select`)
    L.push(`    v_base + row_number() over (order by a.id),`)
    L.push(`    a.proyecto_id,`)
    L.push(`    coalesce(p.id, 0),`)
    L.push(`    a.codproducto,`)
    L.push(`    a.producto,`)
    L.push(`    a.lote,`)
    L.push(`    a.location,`)
    L.push(`    alm.nombre,`)
    L.push(`    abs(a.cantidad),`)
    L.push(`    case when a.tipo = 'averia' then 'Reproceso' when a.direccion = 'salida' then 'Salida' else 'Entrada' end,`)
    L.push(`    'aprobado',`)
    L.push(`    'transaccion manual',`)
    L.push(`    'Corrección de inventario · cuadre #' || a.cuadre_id || ' · ' || a.tipo || coalesce(' · ' || a.motivo, '') || ' [aj#' || a.id || ']',`)
    L.push(`    a.cod_movimiento,`)
    L.push(`    ${q(actor)},`)
    L.push(`    (a.fecha::text || ' 15:00:00+00')::timestamptz`)
    L.push(`  from sig_inventario_ajuste a`)
    L.push(`  left join productos p on p.codigo = a.codproducto`)
    L.push(`  left join locations l on l.codigo = a.location and l.idempresa = a.proyecto_id`)
    L.push(`  left join almacenes alm on alm.id = l.bodega`)
    L.push(`  where a.cuadre_id = ${cuadreId} and a.activo is true and a.invtrans_id is null;`)
    L.push(`  get diagnostics v_ins = row_count;`)
    L.push(`  raise notice 'Movimientos insertados en invtrans: %', v_ins;`)
    L.push(``)
    L.push(`  -- Cada corrección queda aprobada y amarrada a su movimiento (por el marcador).`)
    L.push(`  update sig_inventario_ajuste a`)
    L.push(`     set estado = 'aprobado', aprobado_por = ${q(actor)}, aprobado_fecha = now(), invtrans_id = i.id`)
    L.push(`    from invtrans i`)
    L.push(`   where a.cuadre_id = ${cuadreId} and a.activo is true and a.invtrans_id is null`)
    L.push(`     and i.observaciones like '%[aj#' || a.id || ']%';`)
    L.push(`  get diagnostics v_marc = row_count;`)
    L.push(`  raise notice 'Correcciones marcadas como aprobadas: %', v_marc;`)
    L.push(`  if v_marc <> v_ins then`)
    L.push(`    raise exception 'Se insertaron % movimientos pero se marcaron % correcciones: se deshace todo.', v_ins, v_marc;`)
    L.push(`  end if;`)
    L.push(``)
    L.push(`  update sig_inventario_cuadre set estado = 'aprobado', updated_at = now() where id = ${cuadreId};`)
    L.push(`  raise notice 'Conteo #${cuadreId} APROBADO = inventario inicial en firme de ${mes}';`)
    L.push(`end`)
    L.push(`$postear$;`)
    L.push(`commit;`)
    L.push(``)
    L.push(`-- =========================== DESPUÉS ================================`)
    L.push(`select 'cabecera' as verificacion, id, fecha, estado, activo, items, items_con_diferencia, total_sistema, total_conteo, total_diferencia from sig_inventario_cuadre where id = ${cuadreId};`)
    L.push(`-- Esperado: estado = 'aprobado'.`)
    L.push(`select 'correcciones' as verificacion, estado, tipo, cod_movimiento, count(*) as lineas, round(sum(cantidad)::numeric,2) as und, count(invtrans_id) as posteadas`)
    L.push(`  from sig_inventario_ajuste where cuadre_id = ${cuadreId} and activo is true group by 1,2,3 order by 3;`)
    L.push(`-- Esperado: todas 'aprobado' y posteadas = lineas.`)
    L.push(`select 'movimientos creados' as verificacion, tipomov, cod_movimiento, status, count(*) as filas, round(sum(cantidad)::numeric,2) as und, min(creado) as desde, max(creado) as hasta`)
    L.push(`  from invtrans where observaciones like '%cuadre #${cuadreId}%' group by 1,2,3 order by 2;`)
    L.push(`-- Esperado: ${sob.length} Entrada 701 y ${fal.length} Salida 702, todos fechados ${fechas[0]}.`)
    L.push(`select 'stock vivo total' as verificacion, round(sum(stock_actual)::numeric,2) as und, count(*) filter (where stock_actual < 0) as lotes_negativos`)
    L.push(`  from saldoinvdetalle where idempresa = ${proyectoId};`)
    L.push(`-- Esperado: ${fmt(Array.from(despues.values()).reduce((s, v) => s + v, 0))} und y ${negativos.length} lotes negativos (los arregla el SQL de reclasificación).`)
    L.push(`select 'lotes negativos' as verificacion, codproducto, nombreproducto, lote, location, stock_actual`)
    L.push(`  from saldoinvdetalle where idempresa = ${proyectoId} and stock_actual < 0 order by stock_actual;`)
    writeFileSync(sqlPosteo, L.join("\n") + "\n", "utf8")
    console.log(`\n✅ SQL de posteo escrito en ${sqlPosteo}`)
  }

  // =================== SQL 2: RECLASIFICACIÓN 309 ===================
  if (sqlLotes && pares.length > 0) {
    const L: string[] = []
    const totalRecl = n2(pares.reduce((s, p) => s + p.cantidad, 0))
    L.push(`-- =====================================================================`)
    L.push(`-- SINCRONIZAR LOS LOTES de ID${proyectoId} con el inventario inicial del ${cuadre.fecha}.`)
    L.push(`--`)
    L.push(`-- Correr DESPUÉS del SQL de posteo del conteo #${cuadreId}.`)
    L.push(`--`)
    L.push(`-- Por qué: el conteo se contabiliza días después del corte y la operación ya`)
    L.push(`-- despachó sobre la estructura vieja de lotes, así que ${negativos.length} lote(s) quedan en`)
    L.push(`-- negativo (${fmt(negativos.reduce((s, [, v]) => s + v, 0))} und): se despachó de un lote que, según el conteo físico, no`)
    L.push(`-- tenía esas unidades — salieron de otro lote del mismo producto. El remedio del`)
    L.push(`-- sistema para eso es la RECLASIFICACIÓN DE LOTE (código 309).`)
    L.push(`--`)
    L.push(`-- Qué hace: ${pares.length} pares 309 (Salida del lote origen + Entrada al lote negativo),`)
    L.push(`-- ${fmt(totalRecl)} und en total, fechados hoy (son movimientos de octubre, no tocan el`)
    L.push(`-- cierre de septiembre ni el inventario inicial). El total de cada producto NO cambia:`)
    L.push(`-- solo se mueve entre lotes. Después de esto ningún lote queda negativo.`)
    L.push(`--`)
    L.push(`-- REGLA DE ASIGNACIÓN (instrucción de gerencia 2026-10-05): el lote origen es el`)
    L.push(`-- LOTE MÁS PRÓXIMO del mismo producto, es decir el de fecha de lote más cercana al`)
    L.push(`-- lote que quedó en negativo (desempate: misma ubicación y luego mayor saldo).`)
    L.push(`-- En estos ${pares.length} pares la distancia media es de ${(pares.filter((p) => Number.isFinite(p.dias)).reduce((s, p) => s + p.dias, 0) / Math.max(1, pares.filter((p) => Number.isFinite(p.dias)).length)).toFixed(1)} días y ${pares.filter((p) => p.dias === 0).length} son del mismo día.`)
    L.push(`-- Es una asignación por regla, no evidencia: si el coordinador sabe de qué lote`)
    L.push(`-- salió de verdad, se corrige con otra 309. Cada par queda registrado en`)
    L.push(`-- sig_inventario_ajuste con su motivo y es reversible.`)
    L.push(`-- =====================================================================`)
    L.push(``)
    L.push(`-- ============================ ANTES =================================`)
    L.push(`select 'lotes negativos' as foto, codproducto, nombreproducto, lote, location, stock_actual`)
    L.push(`  from saldoinvdetalle where idempresa = ${proyectoId} and stock_actual < 0 order by stock_actual;`)
    L.push(`select 'total por producto' as foto, codproducto, round(sum(stock_actual)::numeric,2) as und`)
    L.push(`  from saldoinvdetalle where idempresa = ${proyectoId} group by 1 having sum(stock_actual) <> 0 order by 2 desc;`)
    L.push(``)
    L.push(`-- ========================== CORRECCIÓN ==============================`)
    L.push(`begin;`)
    L.push(`do $recl$`)
    L.push(`declare`)
    L.push(`  v_base int;`)
    L.push(`  v_neg int;`)
    L.push(`  v_dup int;`)
    L.push(`begin`)
    L.push(`  -- Guarda 1: el conteo #${cuadreId} ya debe estar contabilizado.`)
    L.push(`  if not exists (select 1 from sig_inventario_cuadre where id = ${cuadreId} and estado = 'aprobado') then`)
    L.push(`    raise exception 'Primero hay que contabilizar y aprobar el conteo #${cuadreId}.';`)
    L.push(`  end if;`)
    L.push(`  -- Guarda 2: no repetir la reclasificación.`)
    L.push(`  select count(*) into v_dup from invtrans where observaciones like '%[recl#${cuadreId}]%';`)
    L.push(`  if v_dup > 0 then`)
    L.push(`    raise exception 'Ya hay % movimiento(s) de esta reclasificación: no se repite.', v_dup;`)
    L.push(`  end if;`)
    L.push(`  -- Guarda 3: deben seguir existiendo los lotes negativos que se van a corregir.`)
    L.push(`  select count(*) into v_neg from saldoinvdetalle where idempresa = ${proyectoId} and stock_actual < 0;`)
    L.push(`  if v_neg = 0 then`)
    L.push(`    raise exception 'No hay lotes negativos: nada que reclasificar.';`)
    L.push(`  end if;`)
    L.push(`  raise notice 'Lotes negativos antes: %', v_neg;`)
    L.push(``)
    L.push(`  select coalesce(max(id), 0) into v_base from invtrans;`)
    L.push(``)
    L.push(`  -- Pares (lote origen -> lote destino) con el código 309. Dos movimientos por par.`)
    L.push(`  create temporary table tmp_recl (n int, codproducto text, producto text, lote_origen text, loc_origen text, lote_destino text, loc_destino text, cantidad numeric) on commit drop;`)
    for (let i = 0; i < pares.length; i += 100) {
      const trozo = pares.slice(i, i + 100)
      L.push(`  insert into tmp_recl (n, codproducto, producto, lote_origen, loc_origen, lote_destino, loc_destino, cantidad) values`)
      L.push(
        trozo
          .map((p, j) => `    (${i + j + 1}, ${q(p.cod)}, ${q(p.producto)}, ${q(p.loteOrigen)}, ${q(p.locOrigen)}, ${q(p.loteDestino)}, ${q(p.locDestino)}, ${n2(p.cantidad)})`)
          .join(",\n") + ";",
      )
    }
    L.push(``)
    L.push(`  -- Salida del lote origen (309) y Entrada al lote destino (309).`)
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
    L.push(`    'Reclasificación de lote por conteo #${cuadreId}: ' || t.lote_origen || '/' || t.loc_origen || ' -> ' || t.lote_destino || '/' || t.loc_destino || ' (lote negativo tras el inventario inicial del ${cuadre.fecha}) [recl#${cuadreId}]',`)
    L.push(`    '309',`)
    L.push(`    ${q(actor)},`)
    L.push(`    now()`)
    L.push(`  from tmp_recl t`)
    L.push(`  cross join (select 1 as orden union all select 2) m`)
    L.push(`  left join productos p on p.codigo = t.codproducto`)
    L.push(`  left join locations l on l.codigo = (case when m.orden = 1 then t.loc_origen else t.loc_destino end) and l.idempresa = ${proyectoId}`)
    L.push(`  left join almacenes alm on alm.id = l.bodega;`)
    L.push(`  raise notice 'Movimientos de reclasificación insertados: % (${pares.length} pares x 2)', ${pares.length * 2};`)
    L.push(``)
    L.push(`  -- Queda registrado también como corrección (sin cuadre: es posterior al conteo).`)
    L.push(`  insert into sig_inventario_ajuste`)
    L.push(`    (proyecto_id, cuadre_id, fecha, codproducto, producto, lote, location, direccion, cod_movimiento, cantidad, tipo, motivo, responsable, estado, aprobado_por, aprobado_fecha)`)
    L.push(`  select ${proyectoId}, null, current_date, t.codproducto, t.producto,`)
    L.push(`         case when m.orden = 1 then t.lote_origen else t.lote_destino end,`)
    L.push(`         case when m.orden = 1 then t.loc_origen else t.loc_destino end,`)
    L.push(`         case when m.orden = 1 then 'salida' else 'ingreso' end,`)
    L.push(`         '309',`)
    L.push(`         case when m.orden = 1 then -t.cantidad else t.cantidad end,`)
    L.push(`         'reclasificacion',`)
    L.push(`         'Reclasificación de lote tras el inventario inicial del ${cuadre.fecha} (conteo #${cuadreId}): ' || t.lote_origen || '/' || t.loc_origen || ' -> ' || t.lote_destino || '/' || t.loc_destino,`)
    L.push(`         ${q(actor)}, 'aprobado', ${q(actor)}, now()`)
    L.push(`    from tmp_recl t cross join (select 1 as orden union all select 2) m;`)
    L.push(``)
    L.push(`  select count(*) into v_neg from saldoinvdetalle where idempresa = ${proyectoId} and stock_actual < 0;`)
    L.push(`  raise notice 'Lotes negativos después: %', v_neg;`)
    L.push(`  if v_neg > 0 then`)
    L.push(`    raise exception 'Quedaron % lotes negativos: se deshace todo y hay que revisar.', v_neg;`)
    L.push(`  end if;`)
    L.push(`end`)
    L.push(`$recl$;`)
    L.push(`commit;`)
    L.push(``)
    L.push(`-- =========================== DESPUÉS ================================`)
    L.push(`select 'lotes negativos (debe ser 0)' as verificacion, count(*) as lotes`)
    L.push(`  from saldoinvdetalle where idempresa = ${proyectoId} and stock_actual < 0;`)
    L.push(`select 'movimientos de reclasificación' as verificacion, tipomov, cod_movimiento, count(*) as filas, round(sum(cantidad)::numeric,2) as und`)
    L.push(`  from invtrans where observaciones like '%[recl#${cuadreId}]%' group by 1,2 order by 1;`)
    L.push(`-- Esperado: ${pares.length} Salida y ${pares.length} Entrada, ${fmt(totalRecl)} und cada lado (neto 0).`)
    L.push(`select 'total por producto' as verificacion, codproducto, round(sum(stock_actual)::numeric,2) as und`)
    L.push(`  from saldoinvdetalle where idempresa = ${proyectoId} group by 1 having sum(stock_actual) <> 0 order by 2 desc;`)
    L.push(`-- Esperado: idéntico al ANTES (la reclasificación no cambia totales por producto).`)
    writeFileSync(sqlLotes, L.join("\n") + "\n", "utf8")
    console.log(`✅ SQL de reclasificación escrito en ${sqlLotes}`)
  }

  console.log(`\nLA BASE DE DATOS NO SE TOCÓ.`)
}
main()
