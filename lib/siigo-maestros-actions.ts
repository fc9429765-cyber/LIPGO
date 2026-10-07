"use server"

// ---------------------------------------------------------------------------
// MAESTROS DE SIIGO
//
// Trae los catálogos --productos, clientes, formas de pago e impuestos-- y los
// guarda en LIPgo para poder consultarlos y cruzarlos sin llamar a la API cada
// vez.
//
// DOS RITMOS DISTINTOS, A PROPÓSITO:
//
//   · Productos y clientes son miles y cambian a diario: se sincronizan
//     INCREMENTALMENTE, pidiendo solo lo modificado desde la última vez.
//   · Formas de pago e impuestos son unas pocas decenas que casi nunca
//     cambian: se traen ENTEROS en cada corrida. Montar el mecanismo
//     incremental para eso sería complejidad sin ganancia.
//
// Y DOS FORMAS DE RESPUESTA. Productos y clientes vienen envueltos en
// `{results, pagination}`; los catálogos devuelven un arreglo directo. Es la
// convención de Siigo, y confundirlas daría una lista vacía sin ningún error.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import {
  listarClientes,
  listarFormasPago,
  listarImpuestos,
  listarProductos,
  nombreDeCliente,
  precioDeLista,
  PAGE_SIZE,
  type SiigoCliente,
  type SiigoProducto,
} from "@/lib/siigo"

const MODULO = "Consulta Facturas SIIGO"

/** Tope de páginas por corrida: una función serverless tiene límite de tiempo. */
const MAX_PAGINAS = 40

export type Maestro = "productos" | "clientes" | "formas_pago" | "impuestos"

async function permitido(): Promise<boolean> {
  try {
    return await checkModulePermission(MODULO)
  } catch {
    return false
  }
}

function faltaTabla(msg: string | undefined): boolean {
  const m = String(msg ?? "").toLowerCase()
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("relation")
}

export interface EstadoMaestro {
  maestro: Maestro
  ultimaActualizacion: string | null
  ultimaCorrida: string | null
  ultimoResultado: string | null
  registros: number
  corriendo: boolean
  /** Lo que hay guardado ahora mismo. */
  guardados: number
}

const TABLA: Record<Maestro, string> = {
  productos: "siigo_productos",
  clientes: "siigo_clientes",
  formas_pago: "siigo_formas_pago",
  impuestos: "siigo_impuestos",
}

/** Cómo va cada maestro y cuánto hay guardado. */
export async function getEstadoMaestros(): Promise<{
  success: boolean
  data?: EstadoMaestro[]
  faltaMigracion?: boolean
  message?: string
}> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }

  try {
    const sb: any = await getSupabaseAdmin()
    const { data: filas, error } = await sb
      .from("siigo_maestros_estado")
      .select("*")
      .order("maestro", { ascending: true })

    if (error) {
      if (faltaTabla(error.message)) return { success: true, faltaMigracion: true }
      return { success: false, message: error.message }
    }

    const data: EstadoMaestro[] = []
    for (const f of filas ?? []) {
      const tabla = TABLA[f.maestro as Maestro]
      let guardados = 0
      if (tabla) {
        const { count } = await sb.from(tabla).select("id", { count: "exact", head: true })
        guardados = Number(count ?? 0)
      }
      data.push({
        maestro: f.maestro,
        ultimaActualizacion: f.ultima_actualizacion ?? null,
        ultimaCorrida: f.ultima_corrida ?? null,
        ultimoResultado: f.ultimo_resultado ?? null,
        registros: Number(f.registros ?? 0),
        corriendo: f.corriendo === true,
        guardados,
      })
    }
    return { success: true, data }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

function productoAFila(p: SiigoProducto) {
  return {
    id: p.id,
    codigo: p.code ?? null,
    nombre: p.name ?? null,
    referencia: p.reference ?? null,
    descripcion: p.description ?? null,
    tipo: p.type ?? null,
    activo: p.active !== false,
    controla_inventario: p.stock_control ?? null,
    grupo_id: p.account_group?.id ?? null,
    grupo_nombre: p.account_group?.name ?? null,
    unidad_codigo: p.unit?.code ?? null,
    unidad_nombre: p.unit?.name ?? p.unit_label ?? null,
    precio: precioDeLista(p),
    precios: p.prices ?? [],
    impuestos: p.taxes ?? [],
    clasificacion_impuesto: p.tax_classification ?? null,
    impuesto_incluido: p.tax_included ?? null,
    cantidad_disponible: p.available_quantity ?? null,
    bodegas: p.warehouses ?? [],
    codigo_barras: p.additional_fields?.barcode ?? null,
    marca: p.additional_fields?.brand ?? null,
    siigo_creado: p.metadata?.created ?? null,
    siigo_actualizado: p.metadata?.last_updated ?? p.metadata?.created ?? null,
    sincronizado_en: new Date().toISOString(),
  }
}

function clienteAFila(c: SiigoCliente) {
  // El primer teléfono y correo de contacto: es lo que se busca al llamar.
  const tel = c.phones?.[0]
  const telefono = tel
    ? [tel.indicative, tel.number].filter(Boolean).join(" ") + (tel.extension ? ` ext. ${tel.extension}` : "")
    : null

  return {
    id: c.id,
    identificacion: c.identification ?? null,
    digito_verificacion: c.check_digit ?? null,
    tipo_identificacion: c.id_type?.name ?? null,
    sucursal: c.branch_office ?? null,
    nombre: nombreDeCliente(c) || null,
    nombre_comercial: c.commercial_name ?? null,
    tipo: c.type ?? null,
    tipo_persona: c.person_type ?? null,
    activo: c.active !== false,
    responsable_iva: c.vat_responsible ?? null,
    direccion: c.address?.address ?? null,
    ciudad: c.address?.city?.city_name ?? null,
    departamento: c.address?.city?.state_name ?? null,
    pais: c.address?.city?.country_name ?? null,
    telefono,
    email: c.contacts?.[0]?.email ?? null,
    responsabilidades_fiscales: c.fiscal_responsibilities ?? [],
    contactos: c.contacts ?? [],
    observaciones: c.comments ?? null,
    siigo_creado: c.metadata?.created ?? null,
    siigo_actualizado: c.metadata?.last_updated ?? c.metadata?.created ?? null,
    sincronizado_en: new Date().toISOString(),
  }
}

export interface ResultadoMaestro {
  success: boolean
  maestro: Maestro
  traidos: number
  quedaPendiente: boolean
  message?: string
}

/**
 * Trae un maestro de Siigo.
 *
 * `desdeCero` ignora la marca de avance y vuelve a barrer todo. No borra nada:
 * reimportar actualiza.
 */
export async function sincronizarMaestro(
  maestro: Maestro,
  opciones?: { desdeCero?: boolean },
): Promise<ResultadoMaestro> {
  const vacio: ResultadoMaestro = { success: false, maestro, traidos: 0, quedaPendiente: false }
  if (!(await permitido())) return { ...vacio, message: "No tienes permiso para este módulo." }

  const sb: any = await getSupabaseAdmin()

  const { data: est, error: errEst } = await sb
    .from("siigo_maestros_estado")
    .select("*")
    .eq("maestro", maestro)
    .maybeSingle()

  if (errEst) {
    if (faltaTabla(errEst.message)) {
      return { ...vacio, message: "Falta correr scripts/229_siigo_maestros.sql." }
    }
    return { ...vacio, message: errEst.message }
  }

  // El candado, en la base y no en memoria: en Vercel cada llamada puede caer
  // en otra instancia. Caduca a los 15 minutos por si una corrida muere.
  if (est?.corriendo) {
    const desdeHace = est.ultima_corrida
      ? Date.now() - new Date(est.ultima_corrida).getTime()
      : Infinity
    if (desdeHace < 15 * 60 * 1000) {
      return { ...vacio, message: `Ya hay una sincronización de ${maestro} en curso.` }
    }
  }

  await sb
    .from("siigo_maestros_estado")
    .update({ corriendo: true, ultima_corrida: new Date().toISOString() })
    .eq("maestro", maestro)

  try {
    // --- Los catálogos: arreglo directo, sin paginar ------------------------
    if (maestro === "formas_pago" || maestro === "impuestos") {
      const r = maestro === "formas_pago" ? await listarFormasPago("FV") : await listarImpuestos()
      if (!r.ok || !r.data) {
        await liberar(sb, maestro, `Error: ${r.error}`)
        return { ...vacio, message: r.error }
      }

      const filas =
        maestro === "formas_pago"
          ? (r.data as any[]).map((f) => ({
              id: f.id,
              nombre: f.name ?? null,
              tipo: f.type ?? null,
              activo: f.active !== false,
              maneja_vencimiento: f.due_date ?? null,
              sincronizado_en: new Date().toISOString(),
            }))
          : (r.data as any[]).map((t) => ({
              id: t.id,
              nombre: t.name ?? null,
              tipo: t.type ?? null,
              porcentaje: t.percentage ?? null,
              activo: t.active !== false,
              sincronizado_en: new Date().toISOString(),
            }))

      if (filas.length) {
        const { error } = await sb.from(TABLA[maestro]).upsert(filas, { onConflict: "id" })
        if (error) {
          await liberar(sb, maestro, `Error al guardar: ${error.message}`)
          return { ...vacio, message: error.message }
        }
      }

      await sb
        .from("siigo_maestros_estado")
        .update({
          corriendo: false,
          ultima_actualizacion: new Date().toISOString(),
          ultimo_resultado: `${filas.length} traídos`,
          registros: filas.length,
        })
        .eq("maestro", maestro)

      return { success: true, maestro, traidos: filas.length, quedaPendiente: false }
    }

    // --- Productos y clientes: paginados e incrementales --------------------
    /*
     * Desde dónde pedir. Se retrocede un día sobre la marca de avance para
     * cubrir lo modificado justo en el límite: traer de más no cuesta nada
     * --actualiza la misma fila-- y perder un cambio sí.
     */
    let desde: string | undefined
    if (!opciones?.desdeCero && est?.ultima_actualizacion) {
      const d = new Date(est.ultima_actualizacion)
      d.setDate(d.getDate() - 1)
      desde = d.toISOString()
    }

    let pagina = 1
    let traidos = 0
    let masReciente: string | null = est?.ultima_actualizacion ?? null
    let quedaPendiente = false

    for (; pagina <= MAX_PAGINAS; pagina++) {
      const r =
        maestro === "productos"
          ? await listarProductos({ page: pagina, pageSize: PAGE_SIZE, actualizadoDesde: desde })
          : await listarClientes({ page: pagina, pageSize: PAGE_SIZE, actualizadoDesde: desde })

      if (!r.ok || !r.data) {
        await liberar(sb, maestro, `Error: ${r.error}`)
        return { ...vacio, traidos, message: r.error }
      }

      const lote = r.data.results ?? []
      if (lote.length === 0) break

      const filas =
        maestro === "productos"
          ? (lote as SiigoProducto[]).map(productoAFila)
          : (lote as SiigoCliente[]).map(clienteAFila)

      const { error } = await sb.from(TABLA[maestro]).upsert(filas, { onConflict: "id" })
      if (error) {
        await liberar(sb, maestro, `Error al guardar: ${error.message}`)
        return { ...vacio, traidos, message: error.message }
      }

      traidos += filas.length
      for (const f of filas as any[]) {
        if (f.siigo_actualizado && (!masReciente || f.siigo_actualizado > masReciente)) {
          masReciente = f.siigo_actualizado
        }
      }

      if (lote.length < PAGE_SIZE) break
      if (pagina === MAX_PAGINAS) quedaPendiente = true
    }

    const { count } = await sb.from(TABLA[maestro]).select("id", { count: "exact", head: true })

    await sb
      .from("siigo_maestros_estado")
      .update({
        corriendo: false,
        /*
         * La marca solo avanza si NO quedó pendiente. Guardarla a medias haría
         * que la siguiente corrida empezara después de registros que todavía
         * no se trajeron, y quedarían fuera para siempre.
         */
        ...(quedaPendiente ? {} : { ultima_actualizacion: masReciente }),
        ultimo_resultado: quedaPendiente
          ? `${traidos} traídos, quedan más`
          : `${traidos} traídos, al día`,
        registros: Number(count ?? 0),
      })
      .eq("maestro", maestro)

    return { success: true, maestro, traidos, quedaPendiente }
  } catch (e: any) {
    await liberar(sb, maestro, `Error: ${e?.message ?? e}`)
    return { ...vacio, message: e?.message || "Falló la sincronización." }
  }
}

async function liberar(sb: any, maestro: Maestro, resultado: string) {
  try {
    await sb
      .from("siigo_maestros_estado")
      .update({ corriendo: false, ultimo_resultado: resultado })
      .eq("maestro", maestro)
  } catch {
    // Si tampoco se puede liberar, el candado caduca solo a los 15 minutos.
  }
}

// ---------------------------------------------------------------------------
// Consultas de lo guardado
// ---------------------------------------------------------------------------

export interface ProductoGuardado {
  id: string
  codigo: string | null
  nombre: string | null
  tipo: string | null
  activo: boolean
  precio: number | null
  unidad: string | null
  disponible: number | null
  grupo: string | null
}

export async function buscarProductos(filtro: {
  texto?: string
  soloActivos?: boolean
  limite?: number
}): Promise<{ success: boolean; data?: ProductoGuardado[]; total?: number; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }

  try {
    const sb: any = await getSupabaseAdmin()
    let q = sb
      .from("siigo_productos")
      .select("id, codigo, nombre, tipo, activo, precio, unidad_nombre, cantidad_disponible, grupo_nombre", {
        count: "exact",
      })
      .order("nombre", { ascending: true })
      .limit(filtro.limite ?? 300)

    if (filtro.texto?.trim()) {
      const t = filtro.texto.trim()
      q = q.or(`nombre.ilike.%${t}%,codigo.ilike.%${t}%,referencia.ilike.%${t}%`)
    }
    if (filtro.soloActivos) q = q.eq("activo", true)

    const { data, error, count } = await q
    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/229_siigo_maestros.sql." }
      }
      return { success: false, message: error.message }
    }

    return {
      success: true,
      total: count ?? 0,
      data: (data ?? []).map((p: any) => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        tipo: p.tipo,
        activo: p.activo !== false,
        precio: p.precio == null ? null : Number(p.precio),
        unidad: p.unidad_nombre,
        disponible: p.cantidad_disponible == null ? null : Number(p.cantidad_disponible),
        grupo: p.grupo_nombre,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export interface ClienteGuardado {
  id: string
  identificacion: string | null
  nombre: string | null
  nombreComercial: string | null
  tipo: string | null
  activo: boolean
  ciudad: string | null
  telefono: string | null
  email: string | null
}

export async function buscarClientes(filtro: {
  texto?: string
  soloActivos?: boolean
  limite?: number
}): Promise<{ success: boolean; data?: ClienteGuardado[]; total?: number; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }

  try {
    const sb: any = await getSupabaseAdmin()
    let q = sb
      .from("siigo_clientes")
      .select(
        "id, identificacion, nombre, nombre_comercial, tipo, activo, ciudad, telefono, email",
        { count: "exact" },
      )
      .order("nombre", { ascending: true })
      .limit(filtro.limite ?? 300)

    if (filtro.texto?.trim()) {
      const t = filtro.texto.trim()
      q = q.or(`nombre.ilike.%${t}%,identificacion.ilike.%${t}%,nombre_comercial.ilike.%${t}%`)
    }
    if (filtro.soloActivos) q = q.eq("activo", true)

    const { data, error, count } = await q
    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/229_siigo_maestros.sql." }
      }
      return { success: false, message: error.message }
    }

    return {
      success: true,
      total: count ?? 0,
      data: (data ?? []).map((c: any) => ({
        id: c.id,
        identificacion: c.identificacion,
        nombre: c.nombre,
        nombreComercial: c.nombre_comercial,
        tipo: c.tipo,
        activo: c.activo !== false,
        ciudad: c.ciudad,
        telefono: c.telefono,
        email: c.email,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

/** Las formas de pago y los impuestos guardados. Son pocos: se traen juntos. */
export async function getCatalogos(): Promise<{
  success: boolean
  formasPago?: Array<{ id: number; nombre: string; tipo: string | null; activo: boolean; vencimiento: boolean | null }>
  impuestos?: Array<{ id: number; nombre: string; tipo: string | null; porcentaje: number | null; activo: boolean }>
  message?: string
}> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }

  try {
    const sb: any = await getSupabaseAdmin()
    const [fp, imp] = await Promise.all([
      sb.from("siigo_formas_pago").select("*").order("nombre", { ascending: true }),
      sb.from("siigo_impuestos").select("*").order("nombre", { ascending: true }),
    ])

    if (fp.error && faltaTabla(fp.error.message)) {
      return { success: false, message: "Falta correr scripts/229_siigo_maestros.sql." }
    }

    return {
      success: true,
      formasPago: (fp.data ?? []).map((f: any) => ({
        id: Number(f.id),
        nombre: f.nombre ?? "",
        tipo: f.tipo,
        activo: f.activo !== false,
        vencimiento: f.maneja_vencimiento,
      })),
      impuestos: (imp.data ?? []).map((t: any) => ({
        id: Number(t.id),
        nombre: t.nombre ?? "",
        tipo: t.tipo,
        porcentaje: t.porcentaje == null ? null : Number(t.porcentaje),
        activo: t.activo !== false,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}
