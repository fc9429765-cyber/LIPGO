"use server"

// ---------------------------------------------------------------------------
// EMISIÓN DE FACTURAS HACIA SIIGO
//
// Lo único de LIPgo que ESCRIBE en la contabilidad. Todo lo demás de Siigo es
// consulta.
//
// UNA FACTURA ELECTRÓNICA ACEPTADA POR LA DIAN NO SE BORRA: se anula con una
// nota crédito, que es otro documento contable con su propia numeración. Por
// eso aquí todo está construido para que no se emita de más:
//
//   1. Se comprueba el PERMISO. Un server action es un endpoint.
//   2. Se comprueba que la orden esté SOLICITADA en Solicitar Facturas. Lo que
//      no pasó por ahí no se factura.
//   3. Se comprueba que NO esté ya facturada, tanto por `facturasiigo` como
//      por la bitácora de emisión.
//   4. Se registra el intento ANTES de saber si salió bien, y se completa
//      después: si el proceso muere entre la llamada y el registro, queda el
//      rastro de que se intentó.
//
// Esa tercera comprobación importa más de lo que parece: si dos personas
// pulsan el botón a la vez, la segunda debe encontrar la primera.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { crearFactura, type ItemFactura } from "@/lib/siigo"

const MODULO = "Ciclo de Facturación"

/** Lo que `estadofactura` debe decir para poder facturar. */
const SOLICITADA = "CF - Factura solicitada"

async function permitido(): Promise<boolean> {
  try {
    return await checkModulePermission(MODULO)
  } catch {
    // Falla cerrado: sin poder comprobar el permiso, no se emite nada.
    return false
  }
}

function faltaTabla(msg: string | undefined): boolean {
  const m = String(msg ?? "").toLowerCase()
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("relation")
}

export interface ConfigEmision {
  documentoId: number | null
  vendedorId: number | null
  formaPagoId: number | null
  formaPagoCreditoId: number | null
  impuestoId: number | null
  centroCosto: number | null
  productoCodigo: string | null
  enviarDian: boolean
  enviarCorreo: boolean
  /** true = están todos los datos que Siigo exige. */
  completa: boolean
  faltan: string[]
}

/** La configuración de emisión. */
export async function getConfigEmision(): Promise<{
  success: boolean
  data?: ConfigEmision
  faltaMigracion?: boolean
  message?: string
}> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }

  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("siigo_emision_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle()

    if (error) {
      if (faltaTabla(error.message)) return { success: true, faltaMigracion: true }
      return { success: false, message: error.message }
    }
    if (!data) return { success: true, faltaMigracion: true }

    // Lo que Siigo exige y LIPgo no puede deducir.
    const faltan: string[] = []
    if (!data.documento_id) faltan.push("tipo de comprobante")
    if (!data.vendedor_id) faltan.push("vendedor")
    if (!data.forma_pago_id) faltan.push("forma de pago")
    if (!data.producto_codigo) faltan.push("código del servicio")

    return {
      success: true,
      data: {
        documentoId: data.documento_id ?? null,
        vendedorId: data.vendedor_id ?? null,
        formaPagoId: data.forma_pago_id ?? null,
        formaPagoCreditoId: data.forma_pago_credito_id ?? null,
        impuestoId: data.impuesto_id ?? null,
        centroCosto: data.centro_costo ?? null,
        productoCodigo: data.producto_codigo ?? null,
        enviarDian: data.enviar_dian === true,
        enviarCorreo: data.enviar_correo === true,
        completa: faltan.length === 0,
        faltan,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function guardarConfigEmision(payload: {
  documentoId: number | null
  vendedorId: number | null
  formaPagoId: number | null
  formaPagoCreditoId: number | null
  impuestoId: number | null
  centroCosto: number | null
  productoCodigo: string | null
  enviarDian: boolean
  enviarCorreo: boolean
}): Promise<{ success: boolean; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }

  try {
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)
    const { error } = await sb
      .from("siigo_emision_config")
      .update({
        documento_id: payload.documentoId,
        vendedor_id: payload.vendedorId,
        forma_pago_id: payload.formaPagoId,
        forma_pago_credito_id: payload.formaPagoCreditoId,
        impuesto_id: payload.impuestoId,
        centro_costo: payload.centroCosto,
        producto_codigo: payload.productoCodigo?.trim() || null,
        enviar_dian: payload.enviarDian,
        enviar_correo: payload.enviarCorreo,
        actualizado_por: usuario ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)

    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/230_siigo_emision_facturas.sql." }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

// ---------------------------------------------------------------------------
// El puente owner → cliente de Siigo
// ---------------------------------------------------------------------------

export interface OwnerCliente {
  owner: string
  identificacion: string
  nombre: string | null
  activo: boolean
}

export async function getOwnerClientes(): Promise<{
  success: boolean
  data?: OwnerCliente[]
  message?: string
}> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("siigo_owner_cliente")
      .select("*")
      .order("owner", { ascending: true })
    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [] }
      return { success: false, message: error.message }
    }
    return {
      success: true,
      data: (data ?? []).map((o: any) => ({
        owner: o.owner,
        identificacion: o.cliente_identificacion,
        nombre: o.cliente_nombre ?? null,
        activo: o.activo !== false,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function guardarOwnerCliente(payload: {
  owner: string
  identificacion: string
}): Promise<{ success: boolean; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }

  const owner = payload.owner?.trim()
  const ident = payload.identificacion?.trim()
  if (!owner || !ident) return { success: false, message: "Faltan datos." }

  try {
    const sb: any = await getSupabaseAdmin()

    /*
     * Se comprueba contra los clientes YA SINCRONIZADOS de Siigo.
     *
     * Un NIT mal escrito aquí haría fallar todas las facturas de ese owner, y
     * el error aparecería recién al intentar emitir. Mejor atajarlo ahora, que
     * además permite guardar el nombre real.
     */
    const { data: cli } = await sb
      .from("siigo_clientes")
      .select("identificacion, nombre")
      .eq("identificacion", ident)
      .maybeSingle()

    if (!cli) {
      return {
        success: false,
        message: `No hay ningún cliente con identificación ${ident} entre los sincronizados de Siigo. Revisa el número, o trae de nuevo los clientes desde Maestros SIIGO.`,
      }
    }

    const { error } = await sb.from("siigo_owner_cliente").upsert(
      {
        owner,
        cliente_identificacion: ident,
        cliente_nombre: cli.nombre ?? null,
        activo: true,
      },
      { onConflict: "owner" },
    )
    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/230_siigo_emision_facturas.sql." }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function eliminarOwnerCliente(
  owner: string,
): Promise<{ success: boolean; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("siigo_owner_cliente").delete().eq("owner", owner)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

// ---------------------------------------------------------------------------
// Emisión de una orden de contado
// ---------------------------------------------------------------------------

export interface ResultadoEmision {
  success: boolean
  siigoId?: string
  numero?: number
  nombre?: string
  cufe?: string | null
  /** Draft | Accepted | Rejected */
  estadoDian?: string
  message?: string
}

/** Lo que bloquea una emisión, para poder decirlo antes de intentarla. */
export interface Verificacion {
  puede: boolean
  motivo?: string
}

/**
 * ¿Se puede facturar esta orden?
 *
 * La misma comprobación que hace la emisión, expuesta aparte para que la
 * pantalla pueda deshabilitar el botón en vez de dejar que alguien lo pulse y
 * reciba un error.
 */
export async function puedeFacturarOrden(ordenId: number): Promise<Verificacion> {
  if (!(await permitido())) return { puede: false, motivo: "Sin permiso." }

  try {
    const sb: any = await getSupabaseAdmin()
    const { data: orden } = await sb
      .from("cabeceraoc")
      .select("id, ordendecargue, estadofactura, facturasiigo, valorpago, cliente")
      .eq("id", ordenId)
      .maybeSingle()

    if (!orden) return { puede: false, motivo: "No se encontró la orden." }

    // Lo que no pasó por Solicitar Facturas no se factura.
    if (String(orden.estadofactura ?? "").trim() !== SOLICITADA) {
      return {
        puede: false,
        motivo: `La orden está en "${orden.estadofactura || "sin gestionar"}". Solo se factura lo que ya se solicitó en Solicitar Facturas.`,
      }
    }

    // Ya tiene el soporte de una factura de Siigo subido a mano.
    if (String(orden.facturasiigo ?? "").trim() !== "") {
      return { puede: false, motivo: "Esta orden ya tiene factura de Siigo registrada." }
    }

    // Ya se emitió desde aquí.
    const { data: emitida } = await sb
      .from("siigo_facturas_emitidas")
      .select("siigo_nombre")
      .contains("ordenes", [ordenId])
      .eq("exitosa", true)
      .maybeSingle()

    if (emitida) {
      return {
        puede: false,
        motivo: `Ya se emitió la factura ${emitida.siigo_nombre ?? ""} para esta orden.`,
      }
    }

    if (!orden.valorpago || Number(orden.valorpago) <= 0) {
      return { puede: false, motivo: "La orden no tiene valor a facturar." }
    }

    return { puede: true }
  } catch (e: any) {
    return { puede: false, motivo: e?.message }
  }
}

/**
 * Emite la factura de una orden de contado.
 *
 * Una orden, una factura: así se pidió para esta pestaña.
 *
 * NUNCA LANZA. Un fallo aquí tiene que dejar rastro en la bitácora, no
 * desaparecer en un error genérico.
 */
export async function emitirFacturaOrden(
  ordenId: number,
  opciones?: { clienteIdentificacion?: string },
): Promise<ResultadoEmision> {
  if (!(await permitido())) return { success: false, message: "No tienes permiso para emitir." }

  const sb: any = await getSupabaseAdmin()
  const usuario = await getCurrentUsuarioForInsert().catch(() => null)

  try {
    // --- 1) ¿Se puede? -----------------------------------------------------
    const v = await puedeFacturarOrden(ordenId)
    if (!v.puede) return { success: false, message: v.motivo }

    // --- 2) La configuración -----------------------------------------------
    const cfg = await getConfigEmision()
    if (!cfg.success || !cfg.data) {
      return { success: false, message: cfg.message ?? "Falta configurar la emisión." }
    }
    if (!cfg.data.completa) {
      return {
        success: false,
        message: `Falta configurar: ${cfg.data.faltan.join(", ")}. Se hace en la pestaña de emisión.`,
      }
    }

    // --- 3) Los datos de la orden ------------------------------------------
    const { data: orden } = await sb
      .from("cabeceraoc")
      .select("id, ordendecargue, cliente, valorpago, iva, fechacargue, idempresa")
      .eq("id", ordenId)
      .maybeSingle()
    if (!orden) return { success: false, message: "No se encontró la orden." }

    // --- 4) A quién se le factura ------------------------------------------
    /*
     * El NIT no sale de `cabeceraoc.cliente`, que es texto libre: viene del
     * puente owner→cliente, o se elige explícitamente en el diálogo.
     *
     * Facturarle a quien no era es el error más caro de todos, y adivinar el
     * tercero a partir de un nombre escrito a mano es justo cómo ocurriría.
     */
    let identificacion = opciones?.clienteIdentificacion?.trim()
    if (!identificacion) {
      const nombre = String(orden.cliente ?? "").trim()
      if (nombre) {
        const { data: puente } = await sb
          .from("siigo_owner_cliente")
          .select("cliente_identificacion")
          .eq("owner", nombre)
          .eq("activo", true)
          .maybeSingle()
        identificacion = puente?.cliente_identificacion
      }
    }
    if (!identificacion) {
      return {
        success: false,
        message: `No se sabe a qué tercero de Siigo facturarle "${orden.cliente ?? "sin cliente"}". Elígelo en el diálogo o configura la correspondencia.`,
      }
    }

    const { data: cliente } = await sb
      .from("siigo_clientes")
      .select("identificacion, nombre, activo")
      .eq("identificacion", identificacion)
      .maybeSingle()

    if (!cliente) {
      return {
        success: false,
        message: `El tercero ${identificacion} no está entre los clientes sincronizados de Siigo.`,
      }
    }
    if (cliente.activo === false) {
      return { success: false, message: `El tercero ${identificacion} está inactivo en Siigo.` }
    }

    // --- 5) La factura ------------------------------------------------------
    const valor = Number(orden.valorpago ?? 0)
    const hoy = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())

    const items: ItemFactura[] = [
      {
        code: cfg.data.productoCodigo!,
        description: `Servicio logístico · Orden ${orden.ordendecargue ?? ordenId}`,
        quantity: 1,
        price: valor,
        ...(cfg.data.impuestoId ? { taxes: [{ id: cfg.data.impuestoId }] } : {}),
      },
    ]

    /*
     * Se registra el intento ANTES de llamar a Siigo.
     *
     * Si el proceso muere entre la llamada y el registro --un tiempo agotado,
     * un despliegue a mitad-- quedaría una factura creada en Siigo sin rastro
     * en LIPgo, y nadie sabría que existe. Así al menos queda el intento.
     */
    const { data: bitacora } = await sb
      .from("siigo_facturas_emitidas")
      .insert({
        ordenes: [ordenId],
        cliente_identificacion: identificacion,
        cliente_nombre: cliente.nombre ?? null,
        valor_total: valor,
        origen: "contado",
        emitida_por: usuario ?? null,
        exitosa: false,
        error: "en curso",
      })
      .select("id")
      .single()

    const r = await crearFactura({
      documentoId: cfg.data.documentoId!,
      // La fecha es HOY: para facturas electrónicas la DIAN no acepta una
      // anterior, aunque el cargue haya sido antes.
      fecha: hoy,
      clienteIdentificacion: identificacion,
      vendedor: cfg.data.vendedorId!,
      items,
      pagos: [{ id: cfg.data.formaPagoId!, value: valor }],
      observaciones: `Orden de cargue ${orden.ordendecargue ?? ordenId}`,
      ...(cfg.data.centroCosto ? { centroCosto: cfg.data.centroCosto } : {}),
      enviarDian: cfg.data.enviarDian,
      enviarCorreo: cfg.data.enviarCorreo,
      ...(orden.ordendecargue ? { ordenCompra: { number: String(orden.ordendecargue) } } : {}),
    })

    // --- 6) El resultado ----------------------------------------------------
    if (!r.ok || !r.data) {
      if (bitacora?.id) {
        await sb
          .from("siigo_facturas_emitidas")
          .update({
            exitosa: false,
            error: r.error ?? "Error desconocido",
            peticion: r.peticion ?? null,
            respuesta: r.respuesta ?? null,
          })
          .eq("id", bitacora.id)
      }
      return { success: false, message: r.error }
    }

    const estadoDian = r.data.stamp?.status ?? (cfg.data.enviarDian ? "Accepted" : "Draft")

    if (bitacora?.id) {
      await sb
        .from("siigo_facturas_emitidas")
        .update({
          siigo_id: r.data.id,
          siigo_numero: r.data.number ?? null,
          siigo_nombre: r.data.name ?? null,
          cufe: r.data.cufe ?? null,
          estado_dian: estadoDian,
          exitosa: true,
          error: null,
          peticion: r.peticion ?? null,
          respuesta: r.respuesta ?? null,
        })
        .eq("id", bitacora.id)
    }

    /*
     * Se marca la orden como facturada.
     *
     * `facturasiigo` guarda hoy la URL del PDF que alguien sube a mano. Aquí
     * se pone el nombre del comprobante, que es lo que identifica la factura;
     * todo el sistema trata esa columna como "¿se facturó?" sin mirar su
     * contenido, así que el criterio sigue valiendo.
     */
    await sb
      .from("cabeceraoc")
      .update({
        facturasiigo: r.data.name ?? r.data.id,
        estadofactura: "CF - Cerrado",
      })
      .eq("id", ordenId)

    return {
      success: true,
      siigoId: r.data.id,
      numero: r.data.number,
      nombre: r.data.name,
      cufe: r.data.cufe,
      estadoDian,
    }
  } catch (e: any) {
    console.error("[v0] emitirFacturaOrden:", e?.message ?? e)
    return { success: false, message: e?.message || "Falló la emisión." }
  }
}

/** Historial de lo emitido. */
export async function getHistorialEmision(limite = 50): Promise<{
  success: boolean
  data?: Array<{
    id: number
    siigoNombre: string | null
    cufe: string | null
    estadoDian: string | null
    ordenes: number[]
    cliente: string | null
    valor: number
    exitosa: boolean
    error: string | null
    origen: string
    emitidaPor: string | null
    creadoEn: string
  }>
  message?: string
}> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }

  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("siigo_facturas_emitidas")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limite)

    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [] }
      return { success: false, message: error.message }
    }

    return {
      success: true,
      data: (data ?? []).map((e: any) => ({
        id: Number(e.id),
        siigoNombre: e.siigo_nombre ?? null,
        cufe: e.cufe ?? null,
        estadoDian: e.estado_dian ?? null,
        ordenes: Array.isArray(e.ordenes) ? e.ordenes.map(Number) : [],
        cliente: e.cliente_nombre ?? e.cliente_identificacion ?? null,
        valor: Number(e.valor_total ?? 0),
        exitosa: e.exitosa === true,
        error: e.error ?? null,
        origen: e.origen ?? "ciclo",
        emitidaPor: e.emitida_por ?? null,
        creadoEn: e.created_at,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}
