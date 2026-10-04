"use server"

// ---------------------------------------------------------------------------
// SINCRONIZACIÓN DE FACTURAS DE SIIGO
//
// Trae las facturas de Siigo y las guarda en LIPgo para poder consultarlas,
// cruzarlas y exportarlas sin depender de la API en cada lectura.
//
// ES INCREMENTAL. Cada corrida pide solo lo creado o modificado DESDE LA
// ÚLTIMA VEZ. El primer barrido puede tardar --son años de facturas-- pero los
// siguientes tardan segundos.
//
// NO DUPLICA. La llave es el `id` de Siigo, así que volver a traer una factura
// la actualiza en vez de insertarla otra vez. Esto importa más de lo que
// parece: una factura puede modificarse en Siigo (un pago, una anulación) y lo
// que debe quedar es su estado actual, no dos versiones.
//
// UNA SOLA A LA VEZ. Dos sincronizaciones simultáneas se pisarían y dejarían la
// marca de avance en un punto que no corresponde. El candado está en la base,
// no en memoria, porque en Vercel cada llamada puede caer en otra instancia.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import { listarFacturas, nombreCliente, PAGE_SIZE, type SiigoFactura } from "@/lib/siigo"

const MODULO = "Consulta Facturas SIIGO"

/** Desde cuándo barrer cuando no hay nada guardado. */
const DESDE_EL_PRINCIPIO = "2000-01-01"

/**
 * Tope de páginas por corrida.
 *
 * Una función serverless tiene límite de tiempo: un barrido de años no cabe en
 * una sola llamada. Al llegar aquí se guarda el avance y se devuelve
 * `quedaPendiente`, para que la pantalla siga desde donde quedó. Así el
 * histórico se trae en varias pasadas sin perder nada.
 */
const MAX_PAGINAS_POR_CORRIDA = 40

async function permitido(): Promise<boolean> {
  try {
    return await checkModulePermission(MODULO)
  } catch {
    return false
  }
}

export interface EstadoSync {
  ultimaActualizacion: string | null
  ultimaCorrida: string | null
  ultimoResultado: string | null
  facturasTotales: number
  corriendo: boolean
  /** Lo que hay guardado ahora mismo. */
  guardadas: number
  desde: string | null
  hasta: string | null
}

function faltaTabla(msg: string | undefined): boolean {
  const m = String(msg ?? "").toLowerCase()
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("relation")
}

/** Cómo va la sincronización y qué hay guardado. */
export async function getEstadoSync(): Promise<{
  success: boolean
  data?: EstadoSync
  faltaMigracion?: boolean
  message?: string
}> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }

  try {
    const sb: any = await getSupabaseAdmin()
    const { data: est, error } = await sb
      .from("siigo_sync_estado")
      .select("*")
      .eq("id", 1)
      .maybeSingle()

    if (error) {
      if (faltaTabla(error.message)) return { success: true, faltaMigracion: true }
      return { success: false, message: error.message }
    }

    const { count } = await sb
      .from("siigo_facturas")
      .select("id", { count: "exact", head: true })

    const { data: rango } = await sb
      .from("siigo_facturas")
      .select("fecha")
      .order("fecha", { ascending: true })
      .limit(1)
    const { data: rango2 } = await sb
      .from("siigo_facturas")
      .select("fecha")
      .order("fecha", { ascending: false })
      .limit(1)

    return {
      success: true,
      data: {
        ultimaActualizacion: est?.ultima_actualizacion ?? null,
        ultimaCorrida: est?.ultima_corrida ?? null,
        ultimoResultado: est?.ultimo_resultado ?? null,
        facturasTotales: Number(est?.facturas_totales ?? 0),
        corriendo: est?.corriendo === true,
        guardadas: Number(count ?? 0),
        desde: rango?.[0]?.fecha ?? null,
        hasta: rango2?.[0]?.fecha ?? null,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

/** Convierte lo de Siigo a la fila que se guarda. */
function aFila(f: SiigoFactura) {
  return {
    id: f.id,
    numero: f.number ?? null,
    nombre: f.name ?? null,
    documento_id: f.document?.id ?? null,
    fecha: f.date ?? null,
    cliente_id: f.customer?.id ?? null,
    cliente_identificacion: f.customer?.identification ?? null,
    cliente_nombre: nombreCliente(f) || null,
    cliente_sucursal: f.customer?.branch_office ?? null,
    total: f.total ?? 0,
    saldo: f.balance ?? 0,
    moneda: f.currency?.code ?? "COP",
    tasa_cambio: f.currency?.exchange_rate ?? null,
    centro_costo: f.cost_center ?? null,
    vendedor: f.seller ?? null,
    observaciones: f.observations ?? null,
    // El detalle completo, sin reinterpretar: si mañana hace falta un campo
    // que hoy no se usa, está aquí en vez de exigir volver a barrer.
    items: f.items ?? [],
    pagos: f.payments ?? [],
    siigo_creada: f.created ?? null,
    siigo_actualizada: f.last_updated ?? f.created ?? null,
    sincronizada_en: new Date().toISOString(),
  }
}

export interface ResultadoSync {
  success: boolean
  /** Facturas traídas en esta corrida (nuevas + actualizadas). */
  traidas: number
  paginas: number
  /** true = hay más por traer; volver a llamar. */
  quedaPendiente: boolean
  /** Hasta dónde llegó, para mostrarlo. */
  hasta: string | null
  message?: string
}

/**
 * Trae de Siigo lo que falta.
 *
 * `desdeCero` ignora la marca de avance y vuelve a barrer todo. Sirve cuando se
 * sospecha que falta algo; no borra nada, porque reimportar actualiza.
 */
export async function sincronizarFacturas(opciones?: {
  desdeCero?: boolean
}): Promise<ResultadoSync> {
  const vacio: ResultadoSync = {
    success: false,
    traidas: 0,
    paginas: 0,
    quedaPendiente: false,
    hasta: null,
  }

  if (!(await permitido())) return { ...vacio, message: "No tienes permiso para este módulo." }

  const sb: any = await getSupabaseAdmin()

  // --- El candado --------------------------------------------------------
  // Está en la base y no en memoria porque en Vercel cada llamada puede caer
  // en otra instancia, y dos barridos a la vez dejarían la marca de avance en
  // un punto que no corresponde.
  const { data: est, error: errEst } = await sb
    .from("siigo_sync_estado")
    .select("*")
    .eq("id", 1)
    .maybeSingle()

  if (errEst) {
    if (faltaTabla(errEst.message)) {
      return { ...vacio, message: "Falta correr scripts/206_siigo_facturas_sincronizadas.sql." }
    }
    return { ...vacio, message: errEst.message }
  }

  if (est?.corriendo) {
    // Un candado que no se libera --por un fallo a mitad-- dejaría la
    // sincronización bloqueada para siempre. Se considera abandonado a los 15
    // minutos, que es más de lo que tarda cualquier corrida.
    const desdeHace = est.ultima_corrida
      ? Date.now() - new Date(est.ultima_corrida).getTime()
      : Infinity
    if (desdeHace < 15 * 60 * 1000) {
      return { ...vacio, message: "Ya hay una sincronización en curso." }
    }
  }

  await sb
    .from("siigo_sync_estado")
    .update({ corriendo: true, ultima_corrida: new Date().toISOString() })
    .eq("id", 1)

  try {
    /*
     * Desde dónde pedir.
     *
     * Se usa la fecha de la factura más reciente que se trajo, NO el momento
     * de la última corrida: si Siigo tardara en exponer una factura, usar
     * "cuándo corrí" la saltaría para siempre.
     *
     * Se retrocede un día para cubrir facturas modificadas justo en el
     * límite. Traerlas de más no cuesta nada --actualizan la misma fila-- y
     * perderlas sí.
     */
    let desde = DESDE_EL_PRINCIPIO
    if (!opciones?.desdeCero && est?.ultima_actualizacion) {
      const d = new Date(est.ultima_actualizacion)
      d.setDate(d.getDate() - 1)
      desde = d.toISOString().slice(0, 10)
    }

    let pagina = 1
    let traidas = 0
    let masReciente: string | null = est?.ultima_actualizacion ?? null
    let quedaPendiente = false

    for (; pagina <= MAX_PAGINAS_POR_CORRIDA; pagina++) {
      const r = await listarFacturas({
        fechaDesde: desde,
        page: pagina,
        pageSize: PAGE_SIZE,
      })

      if (!r.ok || !r.data) {
        await liberar(sb, `Error: ${r.error}`)
        return { ...vacio, paginas: pagina - 1, traidas, message: r.error }
      }

      const lote = r.data.results ?? []
      if (lote.length === 0) break

      const filas = lote.map(aFila)

      // `upsert` por id: reimportar ACTUALIZA, no duplica. Es lo que permite
      // pedir con un día de margen sin generar copias.
      const { error } = await sb.from("siigo_facturas").upsert(filas, { onConflict: "id" })
      if (error) {
        await liberar(sb, `Error al guardar: ${error.message}`)
        return { ...vacio, paginas: pagina, traidas, message: error.message }
      }

      traidas += filas.length
      for (const f of filas) {
        if (f.siigo_actualizada && (!masReciente || f.siigo_actualizada > masReciente)) {
          masReciente = f.siigo_actualizada
        }
      }

      // Página incompleta = era la última.
      if (lote.length < PAGE_SIZE) break

      // Se llegó al tope de la corrida: queda trabajo para la siguiente.
      if (pagina === MAX_PAGINAS_POR_CORRIDA) quedaPendiente = true
    }

    const { count } = await sb.from("siigo_facturas").select("id", { count: "exact", head: true })

    await sb
      .from("siigo_sync_estado")
      .update({
        corriendo: false,
        // Solo se avanza la marca cuando NO queda pendiente: si se guardara a
        // medias, la siguiente corrida empezaría después de facturas que
        // todavía no se trajeron y quedarían fuera para siempre.
        ...(quedaPendiente ? {} : { ultima_actualizacion: masReciente }),
        ultimo_resultado: quedaPendiente
          ? `${traidas} traídas, quedan más`
          : `${traidas} traídas, al día`,
        facturas_totales: Number(count ?? 0),
      })
      .eq("id", 1)

    return {
      success: true,
      traidas,
      paginas: pagina - 1,
      quedaPendiente,
      hasta: masReciente,
    }
  } catch (e: any) {
    await liberar(sb, `Error: ${e?.message ?? e}`)
    return { ...vacio, message: e?.message || "Falló la sincronización." }
  }
}

/** Libera el candado. Se llama también en los caminos de error. */
async function liberar(sb: any, resultado: string) {
  try {
    await sb
      .from("siigo_sync_estado")
      .update({ corriendo: false, ultimo_resultado: resultado })
      .eq("id", 1)
  } catch {
    // Si tampoco se puede liberar, el candado caduca solo a los 15 minutos.
  }
}

export interface FacturaGuardada {
  id: string
  numero: number | null
  nombre: string | null
  fecha: string | null
  cliente: string | null
  identificacion: string | null
  total: number
  saldo: number
  moneda: string
  pagada: boolean
  observaciones: string | null
}

/** Las facturas guardadas, con filtro. No llama a Siigo. */
export async function buscarGuardadas(filtro: {
  desde?: string
  hasta?: string
  identificacion?: string
  numero?: string
  soloConSaldo?: boolean
  limite?: number
}): Promise<{ success: boolean; data?: FacturaGuardada[]; total?: number; message?: string }> {
  if (!(await permitido())) return { success: false, message: "No tienes permiso para este módulo." }

  try {
    const sb: any = await getSupabaseAdmin()
    let q = sb
      .from("siigo_facturas")
      .select(
        "id, numero, nombre, fecha, cliente_nombre, cliente_identificacion, total, saldo, moneda, observaciones",
        { count: "exact" },
      )
      .order("fecha", { ascending: false })
      .limit(filtro.limite ?? 500)

    if (filtro.desde) q = q.gte("fecha", filtro.desde)
    if (filtro.hasta) q = q.lte("fecha", filtro.hasta)
    if (filtro.identificacion?.trim()) {
      q = q.ilike("cliente_identificacion", `%${filtro.identificacion.trim()}%`)
    }
    if (filtro.numero?.trim()) q = q.eq("numero", Number(filtro.numero.trim()))
    if (filtro.soloConSaldo) q = q.gt("saldo", 0)

    const { data, error, count } = await q
    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/206_siigo_facturas_sincronizadas.sql." }
      }
      return { success: false, message: error.message }
    }

    return {
      success: true,
      total: count ?? 0,
      data: (data ?? []).map((f: any) => ({
        id: f.id,
        numero: f.numero,
        nombre: f.nombre,
        fecha: f.fecha,
        cliente: f.cliente_nombre,
        identificacion: f.cliente_identificacion,
        total: Number(f.total ?? 0),
        saldo: Number(f.saldo ?? 0),
        moneda: f.moneda ?? "COP",
        // Con un centavo de margen: Siigo redondea y un saldo de 0,004 no
        // significa que quede algo por cobrar.
        pagada: Number(f.saldo ?? 0) <= 0.01,
        observaciones: f.observaciones,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}
