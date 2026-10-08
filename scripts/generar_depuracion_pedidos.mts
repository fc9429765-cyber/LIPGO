/**
 * Genera el SQL de DEPURACIÓN DE PEDIDOS, proyecto por proyecto.
 *
 *   npx tsx --env-file=.env.local scripts/generar_depuracion_pedidos.mts
 *   npx tsx --env-file=.env.local scripts/generar_depuracion_pedidos.mts --motivo vencido
 *
 * Es de SOLO LECTURA: no escribe nada en la base. Escribe un archivo .sql que después
 * corre gerencia en Supabase, igual que todas las correcciones de datos del proyecto.
 *
 * POR QUÉ UN GENERADOR Y NO UN SQL ESCRITO A MANO
 *
 * Decidir qué pedido es candidato NO es una consulta simple: depende del estado derivado
 * (`derivarEstado` en lib/pedidos-estado.ts), que mira el rastro logístico, las líneas con
 * orden de cargue, la antigüedad y si el pedido es de un mes anterior. Reescribir esa
 * lógica en SQL sería reimplementarla, y una diferencia mínima depuraría pedidos que no
 * tocaba. Aquí se usa LA MISMA FUNCIÓN que usa la pantalla, así que el conjunto es
 * exactamente el que vería el usuario en "Depurar pendientes".
 *
 * El SQL que sale lleva los ids explícitos, los mismos candados del módulo y antes/después.
 */
import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"
import path from "node:path"
import { derivarEstado, FILTRO_ABIERTOS_POSTGREST, MOTIVOS_DEPURACION, textoMotivo } from "../lib/pedidos-estado"

const NUM = new Intl.NumberFormat("es-CO")

/** Quien autoriza. Es quien corre el SQL; queda en `depurado_por` y en la bitácora. */
const AUTORIZA = "Admon Indupan"

async function main(): Promise<number> {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!URL || !KEY) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Corre con --env-file=.env.local desde la raíz.")
    return 1
  }
  const args = process.argv.slice(2)
  const iMotivo = args.indexOf("--motivo")
  const motivoClave = iMotivo >= 0 ? String(args[iMotivo + 1] ?? "") : "vencido"
  if (!MOTIVOS_DEPURACION.some((m) => m.clave === motivoClave)) {
    console.error(`Motivo inválido: "${motivoClave}". Válidos: ${MOTIVOS_DEPURACION.map((m) => m.clave).join(", ")}`)
    return 1
  }
  const motivo = textoMotivo(motivoClave)

  const sb = createClient(URL, KEY, { auth: { persistSession: false } })

  // Hoy en Bogotá, igual que lo calcula el módulo.
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })).toISOString().slice(0, 10)

  async function todas(tabla: string, construir: (q: any) => any, orden: string) {
    const out: any[] = []
    for (let i = 0; ; i += 1000) {
      const { data, error } = await construir(sb.from(tabla)).order(orden, { ascending: true }).range(i, i + 999)
      if (error) throw new Error(`${tabla}: ${error.message}`)
      out.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }
    return out
  }

  const empresas = await sb.from("empresas").select("id, nombre").order("id")
  const bloques: string[] = []
  const resumen: { id: number; nombre: string; sinRastro: number[]; parciales: number[]; abiertos: number }[] = []

  for (const emp of empresas.data ?? []) {
    const empresaId = Number(emp.id)
    const cab = await todas("pedidoscabecera", (q) => q.select("*").eq("id_empresa", empresaId).or(FILTRO_ABIERTOS_POSTGREST), "idpedido")
    if (cab.length === 0) continue

    // Resumen de líneas, EXACTAMENTE como lo hace `resumirLineas` del núcleo.
    const ids = cab.map((c: any) => Number(c.idpedido))
    const lineas: any[] = []
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150)
      lineas.push(
        ...(await todas(
          "pedidosdetalle",
          (q) => q.select("idpedido, transid, unidades, ocargue, unidadescargadas, unidades_cargadas").eq("id_empresa", empresaId).in("idpedido", chunk),
          "transid",
        )),
      )
    }
    const res = new Map<number, { und: number; oc: number; cargadas: number }>()
    for (const d of lineas) {
      const k = Number(d.idpedido)
      const r = res.get(k) ?? { und: 0, oc: 0, cargadas: 0 }
      r.und += Number(d.unidades) || 0
      if (d.ocargue != null && String(d.ocargue).trim() !== "") r.oc += 1
      r.cargadas += Number(d.unidadescargadas ?? d.unidades_cargadas) || 0
      res.set(k, r)
    }

    const sinRastro: number[] = []
    const parciales: number[] = []
    for (const p of cab) {
      const r = res.get(Number(p.idpedido)) ?? { und: 0, oc: 0, cargadas: 0 }
      const calc = derivarEstado(p, hoy, { lineasConOcargue: r.oc, unidadesPedidas: r.und, unidadesCargadas: r.cargadas })
      if (calc.esFinal) continue
      if (calc.candidatoDepuracion === "sin_rastro") sinRastro.push(Number(p.idpedido))
      else if (calc.candidatoDepuracion === "parcial") parciales.push(Number(p.idpedido))
    }
    resumen.push({ id: empresaId, nombre: String(emp.nombre ?? ""), sinRastro, parciales, abiertos: cab.length })
    if (sinRastro.length === 0 && parciales.length === 0) continue

    const lista = (ids: number[]) => {
      const l: string[] = []
      for (let i = 0; i < ids.length; i += 20) l.push("    " + ids.slice(i, i + 20).join(", "))
      return l.join(",\n")
    }

    const b: string[] = []
    b.push(`-- =====================================================================`)
    b.push(`-- ID ${empresaId} · ${emp.nombre}`)
    b.push(`-- ${NUM.format(sinRastro.length)} sin rastro logístico → "no entregado"`)
    b.push(`-- ${NUM.format(parciales.length)} parciales viejos      → "entrega parcial"`)
    b.push(`-- de ${NUM.format(cab.length)} pedidos abiertos.`)
    b.push(`-- =====================================================================`)
    b.push(``)
    b.push(`-- ANTES. Guardar esta salida.`)
    b.push(`select estado, count(*) from public.pedidoscabecera where id_empresa = ${empresaId} group by estado order by 2 desc;`)
    b.push(``)
    b.push(`begin;`)
    b.push(``)
    b.push(`do $dep_${empresaId}$`)
    b.push(`declare`)
    b.push(`  v_sin int := 0;`)
    b.push(`  v_par int := 0;`)
    b.push(`begin`)
    if (sinRastro.length) {
      b.push(`  -- SIN RASTRO LOGÍSTICO → "no entregado".`)
      b.push(`  -- Mismos candados que el módulo: solo abiertos y sin ningún rastro.`)
      b.push(`  with hechos as (`)
      b.push(`    update public.pedidoscabecera`)
      b.push(`       set estado            = 'no entregado',`)
      b.push(`           motivo_no_entrega = ${sqlStr(motivo)},`)
      b.push(`           depurado_por      = ${sqlStr(AUTORIZA)},`)
      b.push(`           depurado_en       = now()`)
      b.push(`     where id_empresa = ${empresaId}`)
      b.push(`       and idpedido in (`)
      b.push(lista(sinRastro))
      b.push(`       )`)
      b.push(`       and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'))`)
      b.push(`       and ocargue is null and vehiculo is null and fechaordencargue is null and fechadeentrega is null`)
      b.push(`    returning 1)`)
      b.push(`  select count(*) into v_sin from hechos;`)
      b.push(`  raise notice 'ID ${empresaId}: % pedidos quedaron como NO ENTREGADO (se esperaban ${sinRastro.length}).', v_sin;`)
    }
    if (parciales.length) {
      b.push(`  -- PARCIALES VIEJOS → "entrega parcial". Lo cargado se conserva.`)
      b.push(`  with hechos as (`)
      b.push(`    update public.pedidoscabecera`)
      b.push(`       set estado            = 'entrega parcial',`)
      b.push(`           motivo_no_entrega = ${sqlStr(motivo)},`)
      b.push(`           depurado_por      = ${sqlStr(AUTORIZA)},`)
      b.push(`           depurado_en       = now()`)
      b.push(`     where id_empresa = ${empresaId}`)
      b.push(`       and idpedido in (`)
      b.push(lista(parciales))
      b.push(`       )`)
      b.push(`       and lower(estado) = 'parcial'`)
      b.push(`    returning 1)`)
      b.push(`  select count(*) into v_par from hechos;`)
      b.push(`  raise notice 'ID ${empresaId}: % pedidos quedaron como ENTREGA PARCIAL (se esperaban ${parciales.length}).', v_par;`)
    }
    b.push(``)
    b.push(`  -- El rastro de quién autorizó, igual que lo deja la pantalla.`)
    b.push(`  -- OJO: \`detalle\` es de tipo JSONB, no texto: un literal suelto revienta el bloque`)
    b.push(`  -- con "invalid input syntax for type json". Por eso va con jsonb_build_object.`)
    b.push(`  insert into public.autorizacion_log (usuario, proceso, idempresa, resultado, autorizado_por, referencia, detalle)`)
    b.push(`  values (${sqlStr(AUTORIZA)}, 'ped_depurar', ${empresaId}, 'ok', ${sqlStr(AUTORIZA)},`)
    b.push(`          'depurar ' || (v_sin + v_par)::text || ' pedido(s) por SQL',`)
    b.push(`          jsonb_build_object(`)
    b.push(`            'script', '250_depurar_pedidos.sql',`)
    b.push(`            'generado', ${sqlStr(hoy)},`)
    b.push(`            'motivo', ${sqlStr(motivo)},`)
    b.push(`            'no_entregado', v_sin,`)
    b.push(`            'entrega_parcial', v_par,`)
    b.push(`            'criterio', 'derivarEstado (lib/pedidos-estado.ts), la misma funcion de la pantalla Depurar pendientes'`)
    b.push(`          ));`)
    b.push(``)
    b.push(`  -- NADA se borra y NADA se toca de las líneas ni del inventario.`)
    b.push(`end`)
    b.push(`$dep_${empresaId}$;`)
    b.push(``)
    b.push(`commit;`)
    b.push(``)
    b.push(`-- DESPUÉS.`)
    b.push(`select estado, count(*) from public.pedidoscabecera where id_empresa = ${empresaId} group by estado order by 2 desc;`)
    b.push(`select count(*) as abiertos_que_quedan from public.pedidoscabecera`)
    b.push(` where id_empresa = ${empresaId}`)
    b.push(`   and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'));`)
    b.push(``)
    bloques.push(b.join("\n"))
  }

  const cab: string[] = []
  cab.push(``)
  cab.push(`-- =====================================================================`)
  cab.push(`-- 250_depurar_pedidos.sql   ·   GENERADO el ${hoy}`)
  cab.push(`--`)
  cab.push(`-- NO SE EDITA A MANO. Se regenera con:`)
  cab.push(`--   npx tsx --env-file=.env.local scripts/generar_depuracion_pedidos.mts`)
  cab.push(`--`)
  cab.push(`-- Saca de la cola los pedidos que nunca se van a entregar. NO BORRA NADA: los deja`)
  cab.push(`-- con su estado final, el motivo, quién y cuándo, y se siguen consultando en Historial.`)
  cab.push(`-- NO toca las líneas del pedido, ni el inventario, ni las órdenes de cargue.`)
  cab.push(`--`)
  cab.push(`-- QUIÉN DECIDIÓ QUÉ ENTRA. Los ids NO salen de una consulta escrita a mano: salen de`)
  cab.push(`-- \`derivarEstado\` (lib/pedidos-estado.ts), la MISMA función con la que la pantalla`)
  cab.push(`-- "Depurar pendientes" arma su lista. Por eso el conjunto es exactamente el que vería`)
  cab.push(`-- el usuario, y no una reinterpretación en SQL que podría barrer de más.`)
  cab.push(`--`)
  cab.push(`-- LAS DOS REGLAS, tal como las aplica el módulo:`)
  cab.push(`--   · Sin rastro logístico y viejo  → "no entregado". Candado: sin orden de cargue,`)
  cab.push(`--     sin vehículo, sin fecha de orden y sin fecha de entrega.`)
  cab.push(`--   · Parcial de más de 30 días     → "entrega parcial". Lo ya cargado se conserva.`)
  cab.push(`--`)
  cab.push(`-- Motivo aplicado: ${motivo}`)
  cab.push(`-- Autoriza: ${AUTORIZA} (queda en depurado_por y en autorizacion_log)`)
  cab.push(`--`)
  cab.push(`-- CORRER UN BLOQUE A LA VEZ, en este orden: primero ID4 y ID5, que son los pequeños y`)
  cab.push(`-- sirven de ensayo; después los grandes. Cada bloque es una transacción aparte.`)
  cab.push(`--`)
  cab.push(`-- RESUMEN DE LO QUE VA A PASAR:`)
  for (const r of resumen) {
    if (r.sinRastro.length === 0 && r.parciales.length === 0) continue
    cab.push(`--   ID ${r.id} ${r.nombre.padEnd(22)} ${String(r.abiertos).padStart(5)} abiertos → ${String(r.sinRastro.length).padStart(4)} no entregado · ${String(r.parciales.length).padStart(4)} entrega parcial`)
  }
  const totalSin = resumen.reduce((s, r) => s + r.sinRastro.length, 0)
  const totalPar = resumen.reduce((s, r) => s + r.parciales.length, 0)
  cab.push(`--   TOTAL                              ${String(totalSin).padStart(4)} + ${String(totalPar).padStart(4)} = ${totalSin + totalPar}`)
  cab.push(`-- =====================================================================`)
  cab.push(``)

  const salida = cab.join("\n") + "\n" + bloques.join("\n\n")
  const ruta = path.join(process.cwd(), "scripts", "250_depurar_pedidos.sql")
  fs.writeFileSync(ruta, salida, "utf8")

  console.log(`Generado scripts/250_depurar_pedidos.sql (${NUM.format(salida.length)} caracteres)`)
  console.log(`Motivo: ${motivo}`)
  for (const r of resumen) {
    if (r.sinRastro.length === 0 && r.parciales.length === 0) continue
    console.log(`  ID${r.id} ${r.nombre}: ${r.abiertos} abiertos → ${r.sinRastro.length} no entregado · ${r.parciales.length} entrega parcial`)
  }
  console.log(`  TOTAL: ${totalSin} + ${totalPar} = ${totalSin + totalPar} pedidos`)
  return 0
}

/** Texto a literal SQL, escapando comillas. */
function sqlStr(s: string): string {
  return "'" + String(s).replace(/'/g, "''") + "'"
}

process.exitCode = await main()
