// CONSULTAS de las comprobaciones de convergencia. Reciben el cliente de Supabase (service
// role) para poder correr igual desde el cron y desde scripts/verificar_convergencia.mts.
// Todas son de SOLO LECTURA y paginadas con orden único (lib/orden-paginacion.ts).
//
// Cada check cruza dos fuentes que DEBEN coincidir. Lo que vigila cada uno está en la regla.

import { fetchAllRows } from "@/lib/fetch-all-rows"
import { resultadoDe, sinDatos, type ResultadoCheck } from "@/lib/convergencia"

const n0 = (v: unknown) => Number(v) || 0
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase()
const diasAtrasISO = (dias: number) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

type SB = any

// ───────────────────────────── Inventario y despacho ─────────────────────────────

const CHK_DUPLICADAS = {
  clave: "salidas_duplicadas",
  titulo: "La misma estiba salió dos veces en la misma orden",
  regla: "Una orden se confirma una sola vez; la misma estiba (QR) no puede salir dos veces. Caso real: agosto 2026, 41 unidades de más.",
  gravedad: "critico" as const,
}
export async function checkSalidasDuplicadas(sb: SB, dias = 30): Promise<ResultadoCheck> {
  try {
    const filas = await fetchAllRows((from, to) =>
      sb
        .from("invtrans")
        .select("id, ocargue, qrestiba, nombreproducto, cantidad, creado")
        .eq("tipomov", "Salida")
        .ilike("status", "apr%")
        .not("qrestiba", "is", null)
        .gte("creado", diasAtrasISO(dias))
        .order("id", { ascending: true })
        .range(from, to),
    )
    const vistos = new Map<string, any[]>()
    for (const f of filas) {
      const k = `${norm(f.ocargue)}|${f.qrestiba}`
      vistos.set(k, [...(vistos.get(k) ?? []), f])
    }
    const casos: string[] = []
    for (const [k, fs] of vistos) {
      if (fs.length > 1) casos.push(`orden ${fs[0].ocargue} · estiba ${fs[0].qrestiba} · ${fs.length} salidas de ${fs[0].nombreproducto} (ids ${fs.map((f) => f.id).join(", ")})`)
    }
    return resultadoDe(CHK_DUPLICADAS, casos)
  } catch (e: any) {
    return sinDatos(CHK_DUPLICADAS, e?.message ?? String(e))
  }
}

const CHK_SALIO_MAS = {
  clave: "salio_mas_que_orden",
  titulo: "Salió más de lo que la orden de cargue autorizó",
  regla: "Nunca puede salir más de lo que dice la orden de cargue, ni un producto que la orden no incluía.",
  gravedad: "critico" as const,
}
export async function checkSalioMasQueOrden(sb: SB, dias = 30): Promise<ResultadoCheck> {
  // LA FECHA SE TOMA DE `primera_salida`, NUNCA DE `fechaorden`.
  //
  // Encontrado el 2026-10-07: este chequeo filtraba por `fechaorden`, y en las filas
  // FUERA_DE_LA_ORDEN no hay línea de orden de donde sacar la fecha, así que `fechaorden`
  // y `fechacargue` vienen NULAS. Un filtro por ellas descartaba el 100 % de esas filas,
  // que son justo las más graves: 79 líneas y 7.299 unidades que salieron de un producto
  // que la orden no incluía (ID3 62 líneas / 5.547 und, ID1 17 / 1.752) llevaban
  // invisibles desde que existe el chequeo, mientras sí reportaba el SALIO_MAS vecino.
  // `primera_salida` es la fecha en que el producto salió de verdad y está poblada en
  // todas las filas con salidas (los SIN_SALIDA no entran en este chequeo).
  //
  // Se pagina en vez de topar en 200: un día malo puede traer más casos que el tope, y un
  // chequeo que trunca informa de menos sin decirlo.
  const desde = diasAtrasISO(dias)
  try {
    const filas = await fetchAllRows((from, to) =>
      sb
        .from("v_orden_vs_salidas")
        .select("idempresa, ocargue, producto, autorizado, despachado, estado_alerta, primera_salida")
        .in("estado_alerta", ["SALIO_MAS", "FUERA_DE_LA_ORDEN"])
        .gte("primera_salida", desde)
        .order("ocargue", { ascending: true })
        .order("producto", { ascending: true })
        .range(from, to),
    )
    const casos = filas.map(
      (r: any) =>
        `ID${n0(r.idempresa)} · ${r.ocargue} · ${r.producto}: autorizado ${n0(r.autorizado)}, salió ${n0(r.despachado)} (${r.estado_alerta === "FUERA_DE_LA_ORDEN" ? "NO estaba en la orden" : "de más"})`,
    )
    return resultadoDe(CHK_SALIO_MAS, casos)
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    const falta = /does not exist|schema cache|not find/i.test(msg)
    return sinDatos(CHK_SALIO_MAS, falta ? "la vista v_orden_vs_salidas no existe: falta correr scripts/sig/63_orden_vs_salidas.sql" : msg)
  }
}

const CHK_A_MEDIAS = {
  clave: "ordenes_a_medias",
  titulo: "Órdenes con picking a medias",
  regla: "El picking es todo o nada: una orden no puede tener salidas aprobadas y, a la vez, líneas por descontar.",
  gravedad: "critico" as const,
}
const CHK_RESERVAS = {
  clave: "reservas_viejas",
  titulo: "Reservas de asignación sin picking hace más de 3 días",
  regla: "La asignación reserva y el picking despacha; una reserva vieja bloquea el Conteo total del mes y suele ser una orden olvidada.",
  gravedad: "alerta" as const,
}
export async function checkPendientesInventario(sb: SB): Promise<ResultadoCheck[]> {
  try {
    const pendientes = await fetchAllRows((from, to) =>
      sb
        .from("invtrans")
        .select("id, ocargue, nombreproducto, lote, cantidad, status, creado")
        .eq("tipomov", "Salida")
        .ilike("origen", "orden de cargue")
        .ilike("status", "por descontar")
        .order("id", { ascending: true })
        .range(from, to),
    )
    const porOrden = new Map<string, any[]>()
    for (const p of pendientes) porOrden.set(String(p.ocargue), [...(porOrden.get(String(p.ocargue)) ?? []), p])

    const aMedias: string[] = []
    const ocs = [...porOrden.keys()]
    for (let i = 0; i < ocs.length; i += 100) {
      const { data } = await sb
        .from("invtrans")
        .select("ocargue")
        .in("ocargue", ocs.slice(i, i + 100))
        .eq("tipomov", "Salida")
        .ilike("origen", "orden de cargue")
        .ilike("status", "apr%")
        .limit(1000)
      const conAprobadas = new Set((data ?? []).map((r: any) => String(r.ocargue)))
      for (const oc of ocs.slice(i, i + 100)) {
        if (conAprobadas.has(oc)) aMedias.push(`orden ${oc}: ${porOrden.get(oc)!.length} líneas por descontar junto a salidas aprobadas`)
      }
    }
    const limite = diasAtrasISO(3)
    const viejas = pendientes
      .filter((p) => String(p.creado ?? "") < limite)
      .map((p) => `orden ${p.ocargue} · ${p.nombreproducto} lote ${p.lote} (${n0(p.cantidad)}) desde ${String(p.creado).slice(0, 10)}`)
    return [resultadoDe(CHK_A_MEDIAS, aMedias), resultadoDe(CHK_RESERVAS, viejas)]
  } catch (e: any) {
    return [sinDatos(CHK_A_MEDIAS, e?.message ?? String(e)), sinDatos(CHK_RESERVAS, e?.message ?? String(e))]
  }
}

const CHK_STOCK_PRODUCTO = {
  clave: "stock_negativo_producto",
  titulo: "Productos con existencias negativas en total",
  regla: "Un producto no puede quedar en negativo sumando todos sus lotes: salió más de lo que entró más la base del mes.",
  gravedad: "critico" as const,
}
const CHK_STOCK_LOTE = {
  clave: "stock_negativo_lote",
  titulo: "Lotes o ubicaciones en negativo con el producto en positivo",
  regla: "El total del producto cuadra, pero una salida se cargó a un lote o ubicación que no tenía existencias: afecta la trazabilidad por lote y el FIFO.",
  gravedad: "alerta" as const,
}
/** Medido el 2026-10-05: 19 lotes en negativo (ID1 17, ID3 2) de 11 productos; 2 productos de ID1 negativos en total. */
export async function checkStockNegativo(sb: SB): Promise<ResultadoCheck[]> {
  try {
    const { data: neg, error } = await sb
      .from("saldoinvdetalle")
      .select("idempresa, idproducto, nombreproducto, lote, location, stock_actual")
      .lt("stock_actual", 0)
      .order("idempresa")
      .order("nombreproducto")
      .order("lote")
      .limit(300)
    if (error) return [sinDatos(CHK_STOCK_PRODUCTO, error.message), sinDatos(CHK_STOCK_LOTE, error.message)]
    const claves = [...new Set<string>((neg ?? []).map((r: any) => `${r.idempresa}|${r.idproducto}`))]
    const productosNegativos: string[] = []
    const lotesNegativos: string[] = []
    for (const k of claves) {
      const [emp, prod] = k.split("|").map(Number)
      const { data: filas } = await sb.from("saldoinvdetalle").select("nombreproducto, lote, location, stock_actual").eq("idempresa", emp).eq("idproducto", prod)
      const total = (filas ?? []).reduce((s: number, f: any) => s + n0(f.stock_actual), 0)
      const negs = (filas ?? []).filter((f: any) => n0(f.stock_actual) < 0)
      const nombre = String(filas?.[0]?.nombreproducto ?? prod)
      const detalle = negs.map((f: any) => `lote ${f.lote} en ${f.location}: ${n0(f.stock_actual)}`).join("; ")
      if (total < -0.01) productosNegativos.push(`ID${emp} · ${nombre}: total ${total} (${detalle})`)
      else lotesNegativos.push(`ID${emp} · ${nombre}: total ${total}, pero ${detalle}`)
    }
    return [resultadoDe(CHK_STOCK_PRODUCTO, productosNegativos), resultadoDe(CHK_STOCK_LOTE, lotesNegativos)]
  } catch (e: any) {
    const m = e?.message ?? String(e)
    return [sinDatos(CHK_STOCK_PRODUCTO, m), sinDatos(CHK_STOCK_LOTE, m)]
  }
}

// ───────────────────────────── Pedidos ─────────────────────────────

const CHK_PEDIDO_MAS = {
  clave: "pedido_despacho_mayor",
  titulo: "Líneas de pedido con más cargado que lo pedido",
  regla: "Un pedido no puede despachar más de lo que se creó; menos sí, con justificación.",
  gravedad: "critico" as const,
}
const CHK_LIBRO = {
  clave: "libro_vs_linea",
  titulo: "El libro de órdenes y la línea del pedido no coinciden (últimos 7 días)",
  regla: "Lo cargado de una línea es la suma de lo que se llevó cada orden; si difieren, una orden se escribió sin anotarse.",
  gravedad: "alerta" as const,
}

/**
 * Líneas históricas que gerencia revisó una por una y dio por cerradas AUNQUE sigan
 * incumpliendo la regla. Sirve para no repetir todas las noches una alerta ya decidida,
 * que es la mejor forma de enseñarle a la gente a ignorar las alertas.
 *
 * HOY ESTÁ VACÍO, y es lo correcto: una excepción solo se justifica mientras el dato
 * siga mal. La única que hubo, la línea 260 del pedido 147 de ID1, dejó de hacer falta
 * el 2026-10-07 cuando gerencia ordenó corregir el dato en vez de taparlo: la línea
 * decía 2 unidades pedidas y 2.000 cargadas, y se corrigió a 2.000 pedidas con el
 * script 246. Dejar la excepción puesta habría escondido cualquier recaída de esa
 * misma línea.
 *
 * Una línea nueva que incumpla SÍ salta, que es para lo que sirve el control.
 */
const PEDIDO_MAS_REVISADOS: Record<number, string> = {}

export async function checkPedidos(sb: SB): Promise<ResultadoCheck[]> {
  const out: ResultadoCheck[] = []
  try {
    // TODAS las líneas, no las primeras 5.000: `pedidosdetalle` tiene más de
    // 24.000 y con el tope una línea nueva con transid alto nunca se habría
    // mirado (encontrado el 2026-10-07).
    const data = await fetchAllRows((from, to) =>
      sb
        .from("pedidosdetalle")
        .select("transid, idpedido, id_empresa, producto, unidades, unidadescargadas")
        .not("unidadescargadas", "is", null)
        .order("transid", { ascending: true })
        .range(from, to),
    )
    const casos = (data ?? [])
      .filter((l: any) => n0(l.unidadescargadas) > n0(l.unidades) + 0.01 && !PEDIDO_MAS_REVISADOS[Number(l.transid)])
      .map((l: any) => `ID${l.id_empresa} pedido ${l.idpedido} · ${l.producto}: pedidas ${n0(l.unidades)}, cargadas ${n0(l.unidadescargadas)}`)
    out.push(resultadoDe(CHK_PEDIDO_MAS, casos))
  } catch (e: any) {
    out.push(sinDatos(CHK_PEDIDO_MAS, e?.message ?? String(e)))
  }
  try {
    // Solo lo que escribió la APP (origen = app): las filas reconstruidas el 4-oct llevan la
    // fecha de ese día y entrarían todas en "últimos 7 días" (13.888 filas → la consulta
    // `.in()` reventaba por tamaño y el check quedaba "sin comprobar" con motivo vacío).
    const recientes = await fetchAllRows((from, to) =>
      sb
        .from("pedidodetalle_ocargue")
        .select("transid, idpedido, ocargue, unidades")
        .eq("origen", "app")
        .gte("creado_en", diasAtrasISO(7))
        .order("id", { ascending: true })
        .range(from, to),
    )
    const transids = [...new Set<number>(recientes.map((r: any) => Number(r.transid)))]
    const sumaPorLinea = new Map<number, number>()
    if (transids.length > 0) {
      // Las listas `.in()` van en tandas de 150 ids: una URL demasiado larga falla.
      const todas: any[] = []
      const lineas: any[] = []
      for (let i = 0; i < transids.length; i += 150) {
        const tanda = transids.slice(i, i + 150)
        todas.push(
          ...(await fetchAllRows((from, to) =>
            sb.from("pedidodetalle_ocargue").select("transid, unidades").in("transid", tanda).order("id", { ascending: true }).range(from, to),
          )),
        )
        lineas.push(
          ...(await fetchAllRows((from, to) =>
            sb.from("pedidosdetalle").select("transid, idpedido, producto, unidadescargadas, unidades_cargadas").in("transid", tanda).order("transid", { ascending: true }).range(from, to),
          )),
        )
      }
      for (const r of todas) sumaPorLinea.set(Number(r.transid), (sumaPorLinea.get(Number(r.transid)) ?? 0) + n0(r.unidades))
      const casos: string[] = []
      for (const l of lineas) {
        const libro = sumaPorLinea.get(Number(l.transid)) ?? 0
        const dice = n0(l.unidadescargadas ?? l.unidades_cargadas)
        if (Math.abs(libro - dice) > 0.01) casos.push(`pedido ${l.idpedido} · ${l.producto}: línea dice ${dice}, órdenes suman ${libro}`)
      }
      out.push(resultadoDe(CHK_LIBRO, casos))
    } else {
      out.push(resultadoDe(CHK_LIBRO, []))
    }
  } catch (e: any) {
    const texto = e?.message || e?.details || e?.hint || String(e) || "error sin mensaje"
    const falta = /does not exist|schema cache|not find/i.test(texto)
    out.push(sinDatos(CHK_LIBRO, falta ? "la tabla pedidodetalle_ocargue no existe: falta correr scripts/226_pedido_ordenes_cargue.sql" : texto))
  }
  return out
}

// ───────────────────────────── El propio monitoreo ─────────────────────────────

const CHK_ERRORES = {
  clave: "errores_legibles",
  titulo: "La tabla de errores se puede leer",
  regla: "Un monitoreo que no puede leer su tabla no puede decir 'todo bien' (lección del 5-oct: una columna mal escrita hizo leer 0 cuando había 7).",
  gravedad: "critico" as const,
}
export async function checkErroresLegibles(sb: SB): Promise<ResultadoCheck> {
  const { error } = await sb.from("app_errores").select("id, created_at").order("id", { ascending: false }).limit(1)
  if (error) return sinDatos(CHK_ERRORES, error.message)
  return resultadoDe(CHK_ERRORES, [])
}

/** Corre todas las comprobaciones. Cada una falla por separado: nunca una tumba a las demás. */
export async function correrChecks(sb: SB): Promise<ResultadoCheck[]> {
  const [dup, mas, pend, stock, ped, err] = await Promise.all([
    checkSalidasDuplicadas(sb),
    checkSalioMasQueOrden(sb),
    checkPendientesInventario(sb),
    checkStockNegativo(sb),
    checkPedidos(sb),
    checkErroresLegibles(sb),
  ])
  return [dup, mas, ...pend, ...stock, ...ped, err]
}
