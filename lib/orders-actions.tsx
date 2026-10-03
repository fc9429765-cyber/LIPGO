"use server"

import { createClient } from "@/lib/supabase-client"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { desdeDePeriodo, hoyBogotaISO, restarDiasISO, PERIODO_LISTADO_DEFECTO } from "@/lib/periodo-listados"
import { getColombiaDateTime, getColombiaDate, getColombiaTime, dateInputToColombiaDate } from "@/lib/date-utils"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { getCurrentUser, getUserProfile } from "@/lib/auth-actions"
import { getCurrentEmpresaId, getCurrentUserContext } from "@/lib/company-filter"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { autorizar } from "@/lib/autorizaciones-core"
import { revalidatePath } from "next/cache"
import { generateAndUploadLoadOrderPDF } from "./pdf-actions" // Added for generateLoadOrder
import { esPlacaDistribucion, numeroOrdenDistribucion, getPlacasEmpresa, cargarPlacasDistribucion } from "@/lib/distribucion-placas"
import { cediDeDestino, PLANTAS_ORIGEN, type CediDestino } from "@/lib/cedis-destino"
import { esProductoPorUnidad } from "@/lib/facturacion-billed-party"
import { reportarInterno } from "@/lib/reporte-interno-actions"
import { FILTRO_ABIERTOS_POSTGREST, normalizarEstado } from "@/lib/pedidos-estado"

/**
 * Obtiene los IDs de empresa accesibles para el usuario actual desde perfil_acceso_empresas
 */
async function getUserAccessibleEmpresas(): Promise<number[]> {
  const supabase = await createClient()
  try {
    // Get current user
    const user = await getCurrentUser()
    if (!user) {
      console.warn("[v0] No authenticated user found, using default empresa filter")
      return [1] // Fallback
    }

    // Get user profile to get profile_id
    const profile = await getUserProfile(user.id)
    if (!profile || !profile.id) {
      console.warn("[v0] No profile found for user, using default empresa filter")
      return [1] // Fallback
    }

    console.log("[v0] Fetching accessible empresas for profile:", profile.id)

    // Query perfil_acceso_empresas to get all empresa_id for this profile
    const { data: accesoData, error } = await supabase
      .from("perfil_acceso_empresas")
      .select("empresa_id")
      .eq("profile_id", profile.id)

    if (error) {
      console.error("[v0] Error fetching accessible empresas:", error)
      return [1] // Fallback
    }

    const empresaIds = accesoData?.map((item: any) => item.empresa_id) || []
    console.log("[v0] User accessible empresas:", empresaIds)

    // Return empresaIds if available, otherwise fallback to current empresa
    if (empresaIds.length === 0) {
      const empresaId = await getCurrentEmpresaIdForInsert()
      return [empresaId]
    }

    return empresaIds
  } catch (error) {
    console.error("[v0] Error in getUserAccessibleEmpresas:", error)
    const empresaId = await getCurrentEmpresaIdForInsert()
    return [empresaId] // Fallback
  }
}

/**
 * Obtiene los owners accesibles para el usuario actual desde perfil_acceso_owners
 */
async function getUserAccessibleOwners(): Promise<string[]> {
  const supabase = await createClient()
  try {
    // Get current user
    const user = await getCurrentUser()
    if (!user) {
      console.warn("[v0] No authenticated user found, no owner filter")
      return []
    }

    // Get user profile to get profile_id
    const profile = await getUserProfile(user.id)
    if (!profile || !profile.id) {
      console.warn("[v0] No profile found for user, no owner filter")
      return []
    }

    console.log("[v0] Fetching accessible owners for profile:", profile.id)

    // Query perfil_acceso_owners to get all owner names for this profile
    const { data: accesoData, error } = await supabase
      .from("perfil_acceso_owners")
      .select("owner")
      .eq("profile_id", profile.id)

    if (error) {
      console.error("[v0] Error fetching accessible owners:", error)
      return []
    }

    const ownerNames = accesoData?.map((item: any) => item.owner) || []
    console.log("[v0] User accessible owners:", ownerNames)

    return ownerNames
  } catch (error) {
    console.error("[v0] Error in getUserAccessibleOwners:", error)
    return []
  }
}

/**
 * Obtiene las empresas accesibles con sus nombres desde empresas_permisos
 * para mostrar en el selector de "Bodega"
 */
export async function getAccessibleEmpresesFromPermisos(): Promise<Array<{ id: number; nombre: string }>> {
  const supabase = await createClient()
  try {
    // Get accessible empresa IDs
    const accessibleEmpresas = await getUserAccessibleEmpresas()

    console.log("[v0] Fetching empresas_permisos for accessible IDs:", accessibleEmpresas)

    // Query empresas_permisos to get empresa info
    const { data: empresasData, error } = await supabase
      .from("empresas_permisos")
      .select("id, nombre")
      .in("id", accessibleEmpresas)
      .order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching empresas_permisos:", error)
      return []
    }

    console.log("[v0] Fetched empresas from permisos:", empresasData)
    return empresasData || []
  } catch (error) {
    console.error("[v0] Error in getAccessibleEmpresesFromPermisos:", error)
    return []
  }
}

/** Opciones de los listados de pedidos (ver lib/periodo-listados.ts). */
export interface OpcionesPedidos {
  /** 'YYYY-MM-DD' desde el que se traen pedidos (por `fecha`); `null` = todo el
   *  historial; ausente = últimos 90 días. */
  desde?: string | null
  /** Solo pedidos ABIERTOS (estado distinto de entregado / entrega parcial /
   *  anulado, o sin estado), sin límite de fecha: los usa Generar Órdenes de
   *  Cargue, donde un pedido pendiente puede ser viejo y no debe desaparecer. */
  soloAbiertos?: boolean
}

// Periodo/estado sobre el builder de pedidoscabecera. Antes las pantallas
// pedían "todo" y Supabase lo recortaba en silencio a los 1.000 pedidos más
// recientes; ahora se acota por periodo y se pagina COMPLETO dentro de él.
function aplicarOpcionesPedidos(q: any, opciones?: OpcionesPedidos) {
  if (opciones?.soloAbiertos) {
    // Misma regla que aplicaba Generar Órdenes en el cliente (sin estado = abierto).
    // Desde SQL 215 también quedan fuera los depurados ("no entregado").
    return q.or(FILTRO_ABIERTOS_POSTGREST)
  }
  const desde = opciones?.desde === undefined ? desdeDePeriodo(PERIODO_LISTADO_DEFECTO, hoyBogotaISO()) : opciones.desde
  return desde ? q.gte("fecha", desde) : q
}

export async function getOrders(selectedEmpresaId?: number | null, opciones?: OpcionesPedidos) {
  const supabase = await createClient()
  try {
    // Get all empresas accessible to the user from perfil_acceso_empresas
    const accessibleEmpresas = await getUserAccessibleEmpresas()

    // Get all owners accessible to the user from perfil_acceso_owners
    const accessibleOwners = await getUserAccessibleOwners()

    console.log("[v0] Filtering orders by empresas:", accessibleEmpresas, "selectedEmpresaId:", selectedEmpresaId, "and owners:", accessibleOwners)

    const construir = () => {
      // Orden único (idpedido) para paginar sin repetir/perder filas.
      let q = supabase.from("pedidoscabecera").select("*").order("idpedido", { ascending: false })
      // If a specific empresa is selected, filter by that empresa only (if user has access)
      if (selectedEmpresaId && accessibleEmpresas.includes(selectedEmpresaId)) q = q.eq("id_empresa", selectedEmpresaId)
      else q = q.in("id_empresa", accessibleEmpresas) // Otherwise filter by all accessible empresas
      // Filter by accessible owners in empresafactura field (if user has owner permissions)
      if (accessibleOwners.length > 0) q = q.in("empresafactura", accessibleOwners)
      return aplicarOpcionesPedidos(q, opciones)
    }

    const data = await fetchAllRows((from, to) => construir().range(from, to))
    return { success: true, data }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar pedidos" }
  }
}

export async function getAllOrders(opciones?: OpcionesPedidos) {
  const supabase = await createClient()
  try {
    // Get all empresas accessible to the user from perfil_acceso_empresas
    const accessibleEmpresas = await getUserAccessibleEmpresas()
    
    // Get all owners accessible to the user from perfil_acceso_owners
    const accessibleOwners = await getUserAccessibleOwners()

    console.log("[v0] getAllOrders - Filtering by empresas:", accessibleEmpresas, "and owners:", accessibleOwners)

    // Nota: "proyeccion" es un concepto de cabeceraoc (órdenes), NO de pedidoscabecera.
    // pedidoscabecera no tiene columna tipooperacion, así que no se filtra aquí
    // (antes esto rompía la consulta con error 42703).
    const construir = () => {
      // Orden único (idpedido) para paginar sin repetir/perder filas.
      let q = supabase.from("pedidoscabecera").select("*").order("idpedido", { ascending: false })
      // Filter by accessible empresas
      q = q.in("id_empresa", accessibleEmpresas)
      // Filter by accessible owners in empresafactura field (if user has owner permissions)
      if (accessibleOwners.length > 0) q = q.in("empresafactura", accessibleOwners)
      return aplicarOpcionesPedidos(q, opciones)
    }

    const data = await fetchAllRows((from, to) => construir().range(from, to))
    console.log("[v0] getAllOrders - Found", data.length, "orders for empresas:", accessibleEmpresas)
    return { success: true, data }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar pedidos" }
  }
}

export async function getOrderDetails(idpedido: number) {
  const supabase = await createClient()
  try {
    const { data: details, error } = await supabase
      .from("pedidosdetalle")
      .select("*")
      .eq("idpedido", idpedido)
      .or("estado.is.null,estado.eq.,estado.eq.parcial")
      .order("transid", { ascending: true })

    if (error) {
      console.error("Error fetching order details:", error)
      return { success: false, message: error.message }
    }

    if (!details || details.length === 0) {
      return { success: true, data: [] }
    }

    const productNames = [...new Set(details.map((item: any) => item.producto).filter(Boolean))]

    const { data: products, error: productsError } = await supabase
      .from("productos")
      .select("id, nombre, peso_unitkg")
      .in("nombre", productNames)

    if (productsError) {
      console.error("Error fetching product IDs:", productsError)
      return { success: false, message: productsError.message }
    }

    const productIdMap = new Map(products?.map((p: any) => [p.nombre, p.id]) || [])
    const productWeightMap = new Map(products?.map((p: any) => [p.nombre, p.peso_unitkg]) || [])

    const mappedData = details.map((item: any) => ({
      ...item,
      idproducto: productIdMap.get(item.producto) || null,
      peso_unitkg: productWeightMap.get(item.producto) || 0,
    }))

    return { success: true, data: mappedData }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar detalles" }
  }
}

export async function updateOrder(idpedido: number, data: any) {
  const supabase = await createClient()
  try {
    const { error } = await supabase.from("pedidoscabecera").update(data).eq("idpedido", idpedido)

    if (error) {
      console.error("Error updating order:", error)
      return { success: false, message: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al actualizar pedido" }
  }
}

export async function deleteOrder(idpedido: number) {
  const supabase = await createClient()
  try {
    // Check if ocargue is null or empty
    const { data: order, error: fetchError } = await supabase
      .from("pedidoscabecera")
      .select("ocargue, aprobado, revisioncartera")
      .eq("idpedido", idpedido)
      .single()

    if (fetchError) {
      return { success: false, message: "Error al verificar el estado del pedido" }
    }

    if (order.ocargue && order.ocargue.trim() !== "") {
      return {
        success: false,
        message: "No se puede eliminar el pedido porque ya tiene O.Cargue asignada.",
      }
    }

    // Candado en servidor (gerencia 2026-10-03): el borrado físico es solo para
    // pedidos NUEVOS sin revisión de cartera ni aprobación. Lo demás se anula o
    // se depura (queda rastro), nunca se borra.
    if (normalizarEstado(order.aprobado) === "si") {
      return { success: false, message: "No se puede eliminar un pedido aprobado. Anúlalo o depúralo desde Gestionar pedidos." }
    }
    if (order.revisioncartera && String(order.revisioncartera).trim() !== "") {
      return { success: false, message: "No se puede eliminar un pedido con revisión de cartera. Anúlalo o depúralo desde Gestionar pedidos." }
    }

    // Delete details first (if no cascade)
    const { error: detailsError } = await supabase.from("pedidosdetalle").delete().eq("idpedido", idpedido)

    if (detailsError) {
      return { success: false, message: "Error al eliminar detalles del pedido" }
    }

    // Delete header
    const { error: headerError } = await supabase.from("pedidoscabecera").delete().eq("idpedido", idpedido)

    if (headerError) {
      return { success: false, message: "Error al eliminar cabecera del pedido" }
    }

    return { success: true }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al eliminar pedido" }
  }
}

export async function updateOrderDetails(idpedido: number, products: any[]) {
  const supabase = await createClient()
  try {
    console.log("[v0] Server: Fetching existing details for order:", idpedido)

    // Get existing detail transids for this order
    const { data: existingDetails, error: fetchError } = await supabase
      .from("pedidosdetalle")
      .select("transid")
      .eq("idpedido", idpedido)

    if (fetchError) {
      console.error("[v0] Server: Error fetching existing details:", fetchError)
      return { success: false, message: "Error al consultar detalles existentes" }
    }

    const existingTransIds = existingDetails?.map((d) => d.transid) || []
    console.log("[v0] Server: Existing transIds:", existingTransIds)

    // Separate products into updates and inserts
    const productsToUpdate = products.filter((p) => p.transid && existingTransIds.includes(p.transid))
    const productsToInsert = products.filter((p) => !p.transid)

    console.log("[v0] Server: Products to update:", productsToUpdate.length)
    console.log("[v0] Server: Products to insert:", productsToInsert.length)

    // Update existing lines
    for (const product of productsToUpdate) {
      const updateData = {
        producto: product.producto,
        unidades: product.cantidad,
        precio_und: product.precioUnitario,
        total_linea: product.totalLinea,
        iva: product.descuentoIVA,
        descuentopp: product.descuentoPP,
        subtotal: product.subtotal,
        peso: product.peso,
        categoria: product.categoria,
      }

      console.log("[v0] Server: Updating line with transid:", product.transid)
      const { error: updateError } = await supabase
        .from("pedidosdetalle")
        .update(updateData)
        .eq("transid", product.transid)

      if (updateError) {
        console.error("[v0] Server: Error updating line:", updateError)
        return { success: false, message: `Error al actualizar línea con transid ${product.transid}` }
      }
    }

    // Insert new lines
    if (productsToInsert.length > 0) {
      console.log("[v0] Server: Inserting new lines...")
      const { data: lastDetail } = await supabase
        .from("pedidosdetalle")
        .select("transid")
        .order("transid", { ascending: false })
        .limit(1)
        .single()

      let nextTransId = 1
      if (lastDetail) {
        nextTransId = (lastDetail.transid || 0) + 1
      }

      console.log("[v0] Server: Next transId will be:", nextTransId)

      const detailsToInsert = productsToInsert.map((product, index) => ({
        transid: nextTransId + index,
        idpedido: idpedido,
        id_empresa: 1,
        producto: product.producto,
        unidades: product.cantidad,
        precio_und: product.precioUnitario,
        total_linea: product.totalLinea,
        iva: product.descuentoIVA,
        descuentopp: product.descuentoPP,
        subtotal: product.subtotal,
        peso: product.peso,
        categoria: product.categoria,
      }))

      const { error: insertError } = await supabase.from("pedidosdetalle").insert(detailsToInsert)

      if (insertError) {
        console.error("[v0] Server: Error inserting lines:", insertError)
        return { success: false, message: "Error al insertar nuevas líneas" }
      }
      console.log("[v0] Server: Lines inserted successfully")
    }

    // Delete lines that were removed (exist in DB but not in current products)
    const currentTransIds = products.filter((p) => p.transid).map((p) => p.transid)
    const transIdsToDelete = existingTransIds.filter((id) => !currentTransIds.includes(id))

    console.log("[v0] Server: TransIds to delete:", transIdsToDelete)

    if (transIdsToDelete.length > 0) {
      const { error: deleteError } = await supabase.from("pedidosdetalle").delete().in("transid", transIdsToDelete)

      if (deleteError) {
        console.error("[v0] Server: Error deleting lines:", deleteError)
        return { success: false, message: "Error al eliminar líneas" }
      }
      console.log("[v0] Server: Lines deleted successfully")
    }

    return { success: true }
  } catch (error) {
    console.error("[v0] Server: Unexpected error:", error)
    return { success: false, message: "Error inesperado al actualizar detalles" }
  }
}

export async function approveOrder(idpedido: number, approvalCode: string) {
  const supabase = await createClient()

  try {
    // Check if order exists and is not already approved
    const { data: order, error: fetchError } = await supabase
      .from("pedidoscabecera")
      .select("aprobado, id_empresa")
      .eq("idpedido", idpedido)
      .single()

    if (fetchError) {
      return { success: false, message: "Error al verificar el estado del pedido" }
    }

    if (order.aprobado === "si") {
      return { success: false, message: "El pedido ya está aprobado" }
    }

    // Autorización (SQL 203): clave PERSONAL de un usuario cuyo perfil tenga
    // `ped_aprobar_gerencia` en el proyecto del pedido. Las contraseñas de
    // `usuariocartera` siguen valiendo solo durante la transición.
    const auth = await autorizar({
      proceso: "ped_aprobar_gerencia",
      idempresa: order.id_empresa,
      clave: approvalCode,
      referencia: `pedido ${idpedido}`,
    })
    if (!auth.ok) {
      return { success: false, message: auth.error || "Código de aprobación incorrecto" }
    }

    const { error: updateError } = await supabase
      .from("pedidoscabecera")
      .update({
        aprobado: "si",
        estado: "aprobado",
        revisiongerencia: auth.autorizadoPor,
      })
      .eq("idpedido", idpedido)

    if (updateError) {
      console.error("Error approving order:", updateError)
      return { success: false, message: "Error al aprobar el pedido" }
    }

    const { error: trasladoError } = await supabase.from("traslados").update({ estado: "aprobado" }).eq("id", idpedido)

    // Don't fail the approval if traslado doesn't exist (not all orders are traslados)
    if (trasladoError) {
      console.log("[v0] Traslado not found or error updating:", trasladoError)
    }

    return { success: true, message: "Pedido aprobado correctamente" }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al aprobar pedido" }
  }
}

export async function updateOrderPDFUrl(idpedido: number, pdfUrl: string) {
  const supabase = await createClient()
  try {
    const { error } = await supabase.from("pedidoscabecera").update({ pdfpedido: pdfUrl }).eq("idpedido", idpedido)

    if (error) {
      console.error("Error updating PDF URL:", error)
      return { success: false, message: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al actualizar URL del PDF" }
  }
}

export async function getOrderFiltersData() {
  const supabase = await createClient()
  try {
    console.log("[v0] Fetching order filters data")

    // Get all empresas accessible to the user from perfil_acceso_empresas
    const accessibleEmpresas = await getUserAccessibleEmpresas()
    
    // Get all owners accessible to the user from perfil_acceso_owners
    const accessibleOwners = await getUserAccessibleOwners()

    // PAGINADO: pedidoscabecera tiene más de 11.000 filas y Supabase corta en
    // 1.000 sin avisar -- los filtros (pedidos, órdenes de compra, destinos,
    // vendedores) perdían valores. Orden único (pedido, idpedido).
    const construir = () => {
      let q = supabase
        .from("pedidoscabecera")
        .select("pedido, orden_de_compra, estado, destino, cliente, vendedor")
        .eq("aprobado", "si")
        .order("pedido", { ascending: false })
        .order("idpedido", { ascending: false })
      // Filter by accessible empresas
      q = q.in("id_empresa", accessibleEmpresas)
      // Filter by accessible owners in empresafactura field (if user has owner permissions)
      if (accessibleOwners.length > 0) q = q.in("empresafactura", accessibleOwners)
      return q
    }

    let data: any[]
    try {
      data = await fetchAllRows((from, to) => construir().range(from, to))
    } catch (error: any) {
      console.error("[v0] Error fetching order filters data:", error)
      return { success: false, message: error?.message || "Error al cargar filtros" }
    }

    console.log("[v0] Raw order filters data:", data)

    // Fuera los entregados y los depurados ("no entregado"); el resto sigue igual que antes.
    const filteredData = data?.filter((order) => order.estado !== "entregado" && normalizarEstado(order.estado) !== "no entregado") || []

    console.log("[v0] Filtered order data (excluding entregado):", filteredData)

    const pedidoNumbers = [
      ...new Set(filteredData.map((order) => order.pedido).filter((p) => p && p.trim() !== "")),
    ].sort()

    const ordenCompraValues = [
      ...new Set(filteredData.map((order) => order.orden_de_compra).filter((oc) => oc && oc.trim() !== "")),
    ].sort()

    const ciudades = [...new Set(filteredData.map((order) => order.destino).filter((d) => d && d.trim() !== ""))].sort()

    const vendedores = [
      ...new Set(filteredData.map((order) => order.vendedor).filter((v) => v && v.trim() !== "")),
    ].sort()

    console.log("[v0] Pedido numbers:", pedidoNumbers)
    console.log("[v0] Orden compra values:", ordenCompraValues)
    console.log("[v0] Ciudades:", ciudades)
    console.log("[v0] Vendedores:", vendedores)

    return {
      success: true,
      data: {
        pedidoNumbers,
        ordenCompraValues,
        ciudades,
        vendedores,
      },
    }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar datos de filtros" }
  }
}

// ------------------------------------------------------------------------------
// DESCARGUE AUTOMÁTICO EN CEDI DESTINO.
// Cuando una planta (Avimol id2 / Indupan id1) crea un cargue con líneas cuyo
// destino es un CEDI (el destino vive en detalleoc.cliente: "CEDI MEDELLIN",
// "CEDI FUNZA", "TOSTADITOS SUSANITA..."), se genera automáticamente el/los
// DESCARGUE(S) pendientes en el CEDI destino (idempresa 3/4). Igual que la
// distribución "+D", pero CRUZANDO EMPRESAS. Mapeo en lib/cedis-destino.ts.
// Idempotente (dedup por `ordenorigen`) y FALLA-SEGURO (nunca revierte el cargue).
export async function autoGenerarDescarguesCedi(_supabase: any, orderId: number) {
  // El DESTINO a un CEDI vive en detalleoc.cliente ("CEDI FUNZA/BOGOTA"→id3,
  // "CEDI MEDELLIN"→id4, "TOSTADITOS SUSANITA"→id4). NO depende de la placa. Se dispara
  // al CREAR el cargue en la planta y también al ASIGNAR el vehículo (idempotente,
  // dedup por `ordenorigen`), para garantizar el descargue pendiente en el CEDI destino.
  //
  // IMPORTANTE: usa el cliente SERVICE_ROLE (admin), NO el de la petición. Igual que
  // el clon +D, el INSERT quedaba sujeto a RLS con el cliente de sesión y fallaba en
  // silencio (falla-seguro), por eso los descargues no se generaban en producción. El
  // admin bypassa RLS y garantiza la escritura en cualquier ruta.
  const supabase = await getSupabaseAdmin()
  const cargueId = orderId
  const { data: origHeader } = await supabase.from("cabeceraoc").select("*").eq("id", cargueId).maybeSingle()
  if (!origHeader) return
  if (origHeader.tipooperacion !== "Cargue") return // solo desde órdenes de cargue

  // EL CLON SOLO SE GENERA CUANDO LA MADRE YA TIENE LOTE ASIGNADO (horalote) —
  // mismo criterio que el clon +D (generarDistribucionAutomatica, línea ~741).
  // Antes de esto, si el CEDI le daba "inicio" al descargue antes de que la
  // planta asignara lote, `generarIngresoProduccionDesdeDescargue` no encontraba
  // nada en `historicolotes` y el ingreso de producción nacía sin lote. Si la
  // madre aún no tiene lote, se omite: se genera al aprobar el lote
  // (approveBatchAllocation) o en la reconciliación (reconciliarDescarguesCediFaltantes).
  if (!origHeader.horalote) return

  const sessionEmpresaId: number = origHeader.idempresa
  const orderCodeMadre: string = origHeader.ordendecargue
  if (!PLANTAS_ORIGEN.has(sessionEmpresaId)) return // solo plantas (Avimol/Indupan)

  // FILAS REALES del cargue: se clonan tal cual (cabecera + detalle), como el "+D".
  const { data: origDetails } = await supabase.from("detalleoc").select("*").eq("idorden", cargueId)
  if (!origDetails || origDetails.length === 0) return

  // Agrupar el DETALLE REAL por CEDI destino (el destino está en detalleoc.cliente).
  const grupos = new Map<number, { cedi: CediDestino; det: any[] }>()
  for (const d of origDetails) {
    if ((Number(d.cantidad) || 0) <= 0) continue
    const cedi = cediDeDestino(d.cliente)
    if (!cedi) continue
    const g = grupos.get(cedi.idempresa) || { cedi, det: [] as any[] }
    g.det.push(d)
    grupos.set(cedi.idempresa, g)
  }
  if (grupos.size === 0) return

  const colombiaTime = await getColombiaDateTime()
  const y = colombiaTime.getFullYear()
  const m = String(colombiaTime.getMonth() + 1).padStart(2, "0")
  const d = String(colombiaTime.getDate()).padStart(2, "0")
  const fechaorden = await getColombiaDate()

  for (const { cedi, det } of grupos.values()) {
    try {
      // Dedup: ¿ya existe un descargue de esta orden madre en ese CEDI?
      const { data: existe } = await supabase
        .from("cabeceraoc")
        .select("id")
        .eq("ordenorigen", orderCodeMadre)
        .eq("idempresa", cedi.idempresa)
        .eq("tipooperacion", "Descargue")
        .limit(1)
        .maybeSingle()
      if (existe) {
        console.log("[auto-descargue] ya existe para", orderCodeMadre, "->", cedi.label)
        continue
      }

      const { data: ind } = await supabase.from("indicativo").select("indicativo").eq("id", cedi.idempresa).maybeSingle()
      const indicativo = ind?.indicativo || "IND"
      const totalTon = det.reduce((s, x) => s + (Number(x.toneladas) || 0), 0)

      // CABECERA = CLON EXACTO de la del cargue, con id FRESCO + reintento ante colisión.
      // Se cambia solo: id, empresa DESTINO, número, ordenorigen, tipo, transporte, fecha, peso.
      let headerId = 0, creada = false, orderCode = ""
      for (let intento = 0; intento < 6 && !creada; intento++) {
        const { data: maxH } = await supabase.from("cabeceraoc").select("id").order("id", { ascending: false }).limit(1).maybeSingle()
        headerId = (maxH?.id || cargueId) + 1
        orderCode = `${indicativo}${y}${m}${d}${headerId}`
        const header = {
          ...origHeader,
          id: headerId,
          idempresa: cedi.idempresa, // empresa DESTINO (CEDI)
          ordendecargue: orderCode,
          ordenorigen: orderCodeMadre, // enlace a la orden de cargue madre
          tipooperacion: "Descargue",
          transporte: cedi.transporte ?? origHeader.transporte ?? null,
          fechaorden,
          fechacargue: null,
          pesoorden: totalTon,
          observaciones: `Auto desde cargue ${orderCodeMadre}`,
          // NACE PENDIENTE: se limpian TODOS los campos de proceso/cierre del cargue
          // origen (por si el cargue ya venía finalizado). Así el descargue aparece como
          // pendiente por atender en el CEDI destino hasta que lo procesen.
          status: null,
          iniciocargue: null,
          fincargue: null,
          pesajeinicial: null,
          pesajefinal: null,
          pesovascula: null,
          tiquetebascula: null,
          pdfoc: null,
          fotospicking: null,
          horapicking: null,
          doccargue: null,
          auxiliares: null,
        }
        const { error: hErr } = await supabase.from("cabeceraoc").insert(header)
        if (!hErr) creada = true
        else if ((hErr as any).code === "23505") { console.warn("[auto-descargue] colisión id, reintento", intento + 1); continue }
        else { console.error("[auto-descargue] error cabecera", cedi.label, hErr.message); break }
      }
      if (!creada) { console.error("[auto-descargue] no se pudo crear cabecera tras reintentos", cedi.label); continue }

      // DETALLE = CLON EXACTO de las líneas del grupo (todas las columnas), con id fresco.
      const { data: maxD } = await supabase.from("detalleoc").select("id").order("id", { ascending: false }).limit(1).maybeSingle()
      let did = (maxD?.id || 0) + 1
      const detalles = det.map((x: any) => ({ ...x, id: did++, idorden: headerId, numeroorden: orderCode }))
      const { error: dErr } = await supabase.from("detalleoc").insert(detalles)
      if (dErr) console.error("[auto-descargue] error detalle", cedi.label, dErr.message)
      console.log("[auto-descargue] clon exacto", orderCode, "en", cedi.label, "desde", orderCodeMadre, `(${totalTon} t, ${detalles.length} líneas)`)
    } catch (e: any) {
      console.error("[auto-descargue] excepción (no bloquea cargue):", e?.message || e)
    }
  }
}

// DISTRIBUCIÓN AUTOMÁTICA (+D). Si la placa de un CARGUE es un vehículo propio que
// hace distribución (lib/distribucion-placas.ts), duplica la orden como Distribución:
// mismo número + "D", CLON EXACTO (cabecera + detalle). Idempotente (no duplica si ya
// existe) y falla-seguro. Se invoca en DOS momentos porque la placa puede fijarse al
// CREAR la orden (generateLoadOrder) o DESPUÉS al asignar el vehículo
// (assignVehicleToLoadOrder): el flujo real crea la orden sin placa y la asigna luego,
// por eso el clon debe generarse también en la asignación.
export async function generarDistribucionAutomatica(
  _supabase: any,
  orderId: number,
): Promise<string | null> {
  try {
    // IMPORTANTE: usamos el cliente SERVICE_ROLE (admin) para leer y escribir el
    // clon, NO el cliente de la petición. El clon casi nunca se creaba en
    // producción pese a estar desplegado el enganche; el INSERT del clon queda
    // sujeto a RLS con el cliente de sesión y fallaba en silencio (falla-seguro).
    // El admin bypassa RLS y garantiza la escritura en cualquier ruta (creación,
    // asignación de placa o reconciliación). El parámetro se conserva por
    // compatibilidad de firma pero ya no se usa para escribir.
    const supabase = await getSupabaseAdmin()
    await cargarPlacasDistribucion() // calienta el caché de placas (tabla, fallback a DEFAULT)
    const { data: origHeader } = await supabase.from("cabeceraoc").select("*").eq("id", orderId).maybeSingle()
    if (!origHeader) return null
    if (origHeader.tipooperacion !== "Cargue") return null // solo cargues

    // CASO AISLADO — WMP446 (ID4) / Tostaditos Susanita SAS (confirmado 2026-08-08).
    // Es un vehículo EVENTUAL (pasa pocas veces), NO una placa propia de
    // distribución: a propósito NO está en `distribucion_placas` ni entra por
    // `esPlacaDistribucion`, para no tocar la lógica general que usan LWY393,
    // QHC437, etc. Solo genera clon cuando el cargue trae Susanita, y solo
    // clona esas líneas — cualquier otro cliente mezclado en el mismo viaje
    // (ej. Ospina Bedoya en MED202608067722) queda fuera.
    const esWMP446Susanita =
      origHeader.idempresa === 4 && String(origHeader.placa ?? "").trim().toUpperCase() === "WMP446"
    if (!esPlacaDistribucion(origHeader.idempresa, origHeader.placa) && !esWMP446Susanita) return null // solo placas propias de distribución

    // EL CLON SOLO SE GENERA CUANDO LA MADRE YA TIENE LOTE ASIGNADO (horalote).
    // Así hereda ese horalote por el spread y NUNCA aparece como pendiente en
    // Asignación de Lotes (que lista por `horalote IS NULL`). Si la madre aún no
    // tiene lote, se omite: se generará al aprobar el lote (approveBatchAllocation)
    // o en la reconciliación (que solo actúa cuando la madre ya tiene horalote).
    if (!origHeader.horalote) return null

    const distCode = numeroOrdenDistribucion(origHeader.ordendecargue)
    // `.limit(1)` ANTES de maybeSingle: si por una carrera previa ya hubiera 2 clones
    // con el mismo código, maybeSingle sin límite lanzaría error (múltiples filas) y
    // yaExiste caería a null → se crearía un TERCERO. Con limit(1) es idempotente.
    const { data: yaExiste } = await supabase.from("cabeceraoc").select("id").eq("ordendecargue", distCode).limit(1).maybeSingle()
    if (yaExiste) return distCode // idempotente: no duplica

    // DETALLE a clonar: se lee ANTES de crear la cabecera (antes se leía después,
    // línea 804) para poder decidir si hay algo que clonar sin dejar una cabecera
    // huérfana. En ID4, las líneas de JERÓNIMO MARTINS COLOMBIA se excluyen: ese
    // cliente descarga él mismo, no usa el servicio de distribución de LIP
    // (confirmado 2026-08-06). Si el cargue completo era de ese cliente, no se
    // genera clon. El resto de proyectos (incl. ID3) clona todo, como siempre.
    const { data: origDetails } = await supabase.from("detalleoc").select("*").eq("idorden", orderId)
    if (!origDetails || origDetails.length === 0) return null
    const normCliente = (s: any) =>
      String(s ?? "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    let detallesAClonar =
      origHeader.idempresa === 4
        ? origDetails.filter((d: any) => !normCliente(d.cliente).includes("JERONIMO MARTINS"))
        : origDetails
    if (esWMP446Susanita) {
      detallesAClonar = detallesAClonar.filter((d: any) => normCliente(d.cliente).includes("SUSANITA"))
    }
    if (detallesAClonar.length === 0) return null // todo el cargue era Jerónimo Martins (u otro cliente en WMP446): no se genera clon
    // Solo se recalcula el peso si de verdad se excluyó algo (ID4 con Jerónimo
    // Martins mezclado). En cualquier otro caso (incl. TODO id2/id3) el peso
    // sigue heredado tal cual de la madre por el spread, sin cambio de conducta.
    const seExcluyoAlgo = detallesAClonar.length !== origDetails.length
    const pesoDetallesAClonar = seExcluyoAlgo
      ? detallesAClonar.reduce((s: number, d: any) => s + (Number(d.toneladas) || 0), 0)
      : null

    // CABECERA = clon exacto con id FRESCO + reintento ante colisión de PK (23505).
    let distId = 0, creada = false
    for (let intento = 0; intento < 6 && !creada; intento++) {
      const { data: maxH } = await supabase.from("cabeceraoc").select("id").order("id", { ascending: false }).limit(1).maybeSingle()
      distId = (maxH?.id || orderId) + 1
      const distHeader = {
        ...origHeader,
        id: distId,
        ordendecargue: distCode,
        tipooperacion: "Distribucion",
        facturar: true,
        // Si se excluyó algún cliente (Jerónimo Martins en ID4), el peso del
        // header refleja SOLO lo que realmente se clona — si no, quedaría con
        // más peso del que tienen sus propias líneas de detalle. Si no se
        // excluyó nada, se deja el heredado del spread (sin cambio de conducta).
        ...(seExcluyoAlgo ? { pesoorden: pesoDetallesAClonar, pesovascula: pesoDetallesAClonar } : {}),
        // ES UN CLON: HEREDA de la orden madre TODO el contenido por el spread
        // `...origHeader` — incluidos `horalote` (lotes) y los campos de PESAJE. NO
        // se anulan, porque el clon NO re-asigna lotes ni vuelve a báscula (la madre
        // ya lo hizo). Así tampoco reaparece en Asignación de Lotes (lista por
        // `horalote IS NULL`) ni en Báscula (lista por `pesajefinal IS NULL`).
        //
        // Solo se dejan FRESCOS (null) los pasos PROPIOS de la distribución, que se
        // tramitan en Packing (PDF -> Personal -> Fotos -> cierre): `fincargue` null
        // es OBLIGATORIO para que aparezca pendiente en Packing; `iniciocargue` null
        // permite generar el PDF de distribución; `auxiliares` null para asignar el
        // personal de la ENTREGA (distinto al del cargue).
        status: null,
        iniciocargue: null,
        fincargue: null,
        pdfoc: null,
        doccargue: null,
        fotospicking: null,
        horapicking: null,
        auxiliares: null,
      }
      const { error } = await supabase.from("cabeceraoc").insert(distHeader)
      if (!error) creada = true
      else if ((error as any).code === "23505") { console.warn("[+D] colisión de id, reintento", intento + 1); continue }
      else { console.error("[+D] error creando cabecera:", error.message); return null }
    }
    if (!creada) { console.error("[+D] no se pudo crear la cabecera tras varios reintentos"); return null }

    // DETALLE = clon de las líneas A CLONAR (todas, salvo Jerónimo Martins en ID4).
    const { data: maxD } = await supabase.from("detalleoc").select("id").order("id", { ascending: false }).limit(1).maybeSingle()
    let did = (maxD?.id || 0) + 1
    const distDetails = detallesAClonar.map((d: any) => ({ ...d, id: did++, idorden: distId, numeroorden: distCode }))
    const { error: dErr } = await supabase.from("detalleoc").insert(distDetails)
    if (dErr) console.error("[+D] error creando detalle:", dErr.message)
    console.log("[+D] distribución automática creada:", distCode, "id", distId, "desde", origHeader.ordendecargue)
    return distCode
  } catch (e: any) {
    console.error("[+D] excepción (no bloquea la orden):", e?.message || e)
    return null
  }
}

// ---------------------------------------------------------------------------
// AUTO-SANACIÓN del clon +D (garantía de robustez).
//
// El clon de distribución se genera en línea al crear la orden con vehículo
// (`generateLoadOrder`) y al asignar la placa después (`assignVehicleToLoadOrder`).
// Si por cualquier motivo ese enganche no corrió (despliegue rezagado, un error
// en un paso previo, un flujo de asignación no contemplado), la orden "D" no
// aparece y toca hacerla a mano. Esta función RECONCILIA: busca cargues
// RECIENTES (ventana de 2 días, para NO tocar históricos ya procesados) con
// placa propia de distribución que NO tengan su `{código}D`, y lo genera.
//
// Es idempotente (no duplica), acotada (≤ ~50 filas por empresa, solo días
// recientes) y falla-segura. Se invoca desde las lecturas donde la "D" se
// consume (Gestión de Órdenes de Cargue y Packing), así el clon aparece solo
// aunque el enganche de escritura hubiera fallado.
// ---------------------------------------------------------------------------
export async function reconciliarDistribucionesFaltantes(supabase: any, empresaId: number): Promise<number> {
  try {
    await cargarPlacasDistribucion() // caché de placas (tabla, fallback a DEFAULT)
    const lista = getPlacasEmpresa(empresaId)
    if (!lista || lista.length === 0) return 0 // empresa sin placas de distribución

    // Ventana reciente: hoy y los 2 días previos (cubre rezagos de despliegue
    // sin retroceder a órdenes históricas que pudieron gestionarse distinto).
    const ahora = await getColombiaDateTime()
    const cutoff = new Date(ahora.getTime() - 2 * 86400000)
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`

    const { data: cargues } = await supabase
      .from("cabeceraoc")
      .select("id, ordendecargue, placa, fechacargue, horalote")
      .eq("idempresa", empresaId)
      .eq("tipooperacion", "Cargue")
      .in("placa", lista)
      .gte("fechacargue", cutoffStr)
      .order("id", { ascending: false })
      .limit(50)

    if (!cargues || cargues.length === 0) return 0

    let creados = 0
    let sanados = 0
    for (const c of cargues) {
      const distCode = numeroOrdenDistribucion(c.ordendecargue)
      const { data: ya } = await supabase.from("cabeceraoc").select("id, horalote").eq("ordendecargue", distCode).limit(1).maybeSingle()
      if (ya) {
        // SANACIÓN: clones creados con la lógica antigua nacieron con horalote null
        // (antes de que la madre tuviera lote). Si la madre YA tiene horalote y el
        // clon no, se lo heredamos para que desaparezca de Asignación de Lotes.
        if (!ya.horalote && c.horalote) {
          await supabase.from("cabeceraoc").update({ horalote: c.horalote }).eq("id", ya.id)
          sanados++
        }
        continue // ya tiene su +D
      }
      // Solo genera si la madre ya tiene lote (guard dentro de generarDistribucionAutomatica).
      const code = await generarDistribucionAutomatica(supabase, c.id)
      if (code) creados++
    }
    if (creados > 0 || sanados > 0)
      console.log(`[+D] reconciliación empresa ${empresaId}: ${creados} generada(s), ${sanados} sanada(s) (horalote heredado)`)
    return creados
  } catch (e: any) {
    console.error("[+D] reconciliación falló (no bloquea la lectura):", e?.message || e)
    return 0
  }
}

// ---------------------------------------------------------------------------
// AUTO-SANACIÓN del clon de descargue CEDI (mismo espíritu que la de +D, pero
// mirando desde el lado CEDI/destino, que es donde se lee/consume la lista de
// descargues pendientes). Cubre el caso de una madre que YA tiene lote pero
// cuyo clon no se generó (por rezago de despliegue del guard de arriba, o por
// cualquier fallo silencioso en creación/asignación de vehículo).
//
// Ventana de 2 días (igual que +D), acotada (≤100 cargues), idempotente
// (autoGenerarDescarguesCedi ya deduplica por `ordenorigen`) y falla-segura.
//
// FIX PERFORMANCE (2026-08-06): la primera versión hacía 1 query de "¿ya
// existe?" POR CADA candidato (hasta 100, secuenciales) — con 0 faltantes
// reales tardaba ~56s en getLoadOrders (id4) sin crear nada. Ahora se trae en
// UNA sola consulta cuáles códigos YA tienen su descargue en este CEDI, y solo
// se itera (llamando autoGenerarDescarguesCedi) sobre los que de verdad faltan
// — que en el caso normal son 0.
// ---------------------------------------------------------------------------
export async function reconciliarDescarguesCediFaltantes(supabase: any, empresaId: number): Promise<number> {
  if (empresaId !== 3 && empresaId !== 4) return 0 // solo tiene sentido desde el lado CEDI
  try {
    const ahora = await getColombiaDateTime()
    const cutoff = new Date(ahora.getTime() - 2 * 86400000)
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`

    const { data: cargues } = await supabase
      .from("cabeceraoc")
      .select("id, ordendecargue")
      .in("idempresa", Array.from(PLANTAS_ORIGEN))
      .eq("tipooperacion", "Cargue")
      .not("horalote", "is", null)
      .gte("fechacargue", cutoffStr)
      .order("id", { ascending: false })
      .limit(100)

    if (!cargues || cargues.length === 0) return 0

    // Pre-filtro por destino real ANTES de llamar autoGenerarDescarguesCedi: la
    // inmensa mayoría de cargues de planta NO van a un CEDI (van a clientes
    // normales), así que sin esto se llamaba la función (header+detalle+grupos)
    // para ~100 candidatos que nunca iban a generar nada — el otro origen del
    // mismo problema de rendimiento. Una sola consulta de detalleoc basta.
    const idsCargue = cargues.map((c: any) => c.id)
    const { data: detalles } = await supabase.from("detalleoc").select("idorden, cliente").in("idorden", idsCargue)
    const idsConEsteCedi = new Set<number>()
    for (const d of detalles ?? []) {
      const cedi = cediDeDestino(d.cliente)
      if (cedi && cedi.idempresa === empresaId) idsConEsteCedi.add(d.idorden)
    }
    const candidatosRelevantes = cargues.filter((c: any) => idsConEsteCedi.has(c.id))
    if (candidatosRelevantes.length === 0) return 0

    const codigos = candidatosRelevantes.map((c: any) => c.ordendecargue)
    const { data: existentes } = await supabase
      .from("cabeceraoc")
      .select("ordenorigen")
      .eq("idempresa", empresaId)
      .eq("tipooperacion", "Descargue")
      .in("ordenorigen", codigos)
    const yaExisten = new Set((existentes ?? []).map((e: any) => e.ordenorigen))

    const faltantes = candidatosRelevantes.filter((c: any) => !yaExisten.has(c.ordendecargue))
    if (faltantes.length === 0) return 0

    // autoGenerarDescarguesCedi decide sola a qué CEDI(s) corresponde (por
    // detalleoc.cliente) y ya deduplica por ordenorigen — llamarla de más no
    // genera duplicados. No se re-verifica después (esa segunda consulta era
    // parte del mismo problema de rendimiento): son pocos candidatos y la
    // función ya loguea sus propios errores.
    for (const c of faltantes) {
      await autoGenerarDescarguesCedi(supabase, c.id)
    }
    console.log(`[auto-descargue] reconciliación CEDI ${empresaId}: ${faltantes.length} candidato(s) faltante(s) procesado(s)`)
    return faltantes.length
  } catch (e: any) {
    console.error("[auto-descargue] reconciliación falló (no bloquea la lectura):", e?.message || e)
    return 0
  }
}

export async function generateLoadOrder(orderData: {
  selectedOrderIds: number[]
  sinVehiculo?: boolean
  vehiculo: string
  nombreConductor: string
  fechaEntrega: string
  fechaOrdenCargue: string
  tipoTransporte: string
  productsList: Array<{
    producto: string
    cantidad: number
    toneladas: number
    cliente: string
    destino: string
    idpedido?: number
  }>
  totalWeight: number
  observaciones?: string
  detailUpdates: Array<{
    transid: number
    idpedido: number
    unidadescargadas: number
    estado: "cerrado" | "parcial"
  }>
  tipoOperacion?: string
  idempresaSeleccionada?: number // Optional: warehouse/bodega ID selected by user
}) {
  const supabase = await createClient()

  try {
    console.log("[v0] Generating load order with data:", orderData)

    // Get current session empresa ID, or use selected warehouse ID if provided
    let sessionEmpresaId = await getCurrentEmpresaId()
    
    // If a specific warehouse/bodega is selected, use that ID instead
    if (orderData.idempresaSeleccionada) {
      sessionEmpresaId = orderData.idempresaSeleccionada
      console.log("[v0] Using selected bodega ID:", sessionEmpresaId)
    }
    
    if (!sessionEmpresaId) {
      console.error("[v0] Could not get empresa ID")
      return { success: false, message: "Error al obtener la empresa" }
    }

    console.log("[v0] Using empresa ID for order:", sessionEmpresaId)

    console.log("[v0] Attempting to fetch indicativo for empresa ID:", sessionEmpresaId)

    const { data: indicativoData, error: indicativoError } = await supabase
      .from("indicativo")
      .select("id, indicativo")
      .eq("id", sessionEmpresaId)
      .maybeSingle()

    console.log("[v0] Indicativo query result - data:", indicativoData, "error:", indicativoError)

    let indicativo = "IND" // Default fallback value

    if (indicativoError) {
      console.error("[v0] Error fetching indicativo:", indicativoError.message)
      console.log("[v0] Using default indicativo due to error:", indicativo)
    } else if (!indicativoData) {
      console.warn("[v0] No indicativo record found with ID:", sessionEmpresaId)
      console.log("[v0] Using default indicativo (no record found):", indicativo)
    } else if (!indicativoData.indicativo) {
      console.warn("[v0] Indicativo record found but indicativo field is null/empty for ID:", sessionEmpresaId)
      console.log("[v0] Using default indicativo (empty indicativo field):", indicativo)
    } else {
      indicativo = indicativoData.indicativo
      console.log("[v0] Successfully found indicativo from indicativo table:", indicativo)
    }
    // </CHANGE>

    let telefono = ""
    let horapesoinicial = null
    let horallegada = null
    let horaregistro = null

    if (!orderData.sinVehiculo && orderData.vehiculo) {
      const { data: vehicleData, error: vehicleError } = await supabase
        .from("citasvehiculos")
        .select("telefono, horapesoinicial, horallegada, horaregistro")
        .eq("placa", orderData.vehiculo)
        .is("estatus", null)
        .maybeSingle()

      if (vehicleError) {
        console.error("[v0] Error fetching vehicle data:", vehicleError)
        return { success: false, message: "Error al obtener datos del vehículo" }
      }

      if (vehicleData) {
        telefono = vehicleData.telefono
        horapesoinicial = vehicleData.horapesoinicial
        horallegada = vehicleData.horallegada
        // La hora de la inspección sanitaria hecha ANTES de que existiera esta
        // orden. Se leía `horapesoinicial` y `horallegada` pero no esta, así que
        // la orden nacía sin hora de sanitario aunque el vehículo sí se hubiera
        // inspeccionado.
        horaregistro = vehicleData.horaregistro
        console.log(
          "[v0] Vehicle data - phone:",
          telefono,
          "horapesoinicial:",
          horapesoinicial,
          "horallegada:",
          horallegada,
          "horaregistro:",
          horaregistro,
        )
      } else {
        console.warn("[v0] No vehicle data found for placa:", orderData.vehiculo)
      }
    }

    const { data: lastHeader, error: lastHeaderError } = await supabase
      .from("cabeceraoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastHeaderError) {
      console.error("[v0] Error fetching last header ID:", lastHeaderError)
      return { success: false, message: "Error al obtener último ID de cabecera" }
    }

    const nextId = lastHeader ? (lastHeader.id || 0) + 1 : 1
    console.log("[v0] Next ID will be:", nextId)

    const colombiaTime = await getColombiaDateTime()
    const year = colombiaTime.getFullYear()
    const month = String(colombiaTime.getMonth() + 1).padStart(2, "0")
    const day = String(colombiaTime.getDate()).padStart(2, "0")
    const orderCode = `${indicativo}${year}${month}${day}${nextId}`

    console.log("[v0] Generated order code:", orderCode)

    const currentDate = await getColombiaDate()
    const currentTime = await getColombiaTime()

    const fechaCargue = orderData.fechaOrdenCargue ? await dateInputToColombiaDate(orderData.fechaOrdenCargue) : null
    const fechaEntrega = orderData.fechaEntrega ? await dateInputToColombiaDate(orderData.fechaEntrega) : null

    // Inspección sanitaria previa: si el vehículo se inspeccionó antes de que
    // existiera esta orden, su hora vive en la cita o en el propio registro.
    // `horaregistro` de la cita es el camino directo; el helper cubre además el
    // caso en que la cita no quedó actualizada.
    const horaSanitaria = horaregistro
      ? { hora: horaregistro as string | null, registroId: null as number | null }
      : await resolverHoraSanitaria(supabase, orderData.vehiculo, currentDate)
    if (horaSanitaria.hora) {
      console.log("[v0] Hora sanitaria recuperada para la orden:", horaSanitaria.hora)
    }

    const { error: headerInsertError } = await supabase.from("cabeceraoc").insert({
      id: nextId,
      idempresa: sessionEmpresaId, // Use empresa ID from session
      ordendecargue: orderCode,
      fechaorden: currentDate,
      fechacargue: fechaCargue,
      placa: orderData.sinVehiculo ? null : orderData.vehiculo,
      conductor: orderData.sinVehiculo ? null : orderData.nombreConductor,
      celular: orderData.sinVehiculo ? null : telefono,
      transporte: orderData.sinVehiculo ? null : orderData.tipoTransporte,
      tipooperacion: "Cargue", // Changed from "Descargue" to "Cargue" for load orders
      pesoorden: orderData.totalWeight,
      horaorden: currentTime,
      observaciones: orderData.observaciones || "",
      pesajeinicial: horapesoinicial, // From citasvehiculos.horapesoinicial
      horavehiculo: horallegada, // From citasvehiculos.horallegada
      horasanitario: horaSanitaria.hora, // Inspección hecha antes de esta orden
    })

    if (headerInsertError) {
      console.error("[v0] Error inserting cabeceraoc:", headerInsertError)
      return { success: false, message: `Error al crear cabecera: ${headerInsertError.message}` }
    }

    console.log("[v0] Cabeceraoc inserted successfully")

    // Reporte interno. Va aquí, con la orden ya insertada, y nunca lanza: un
    // problema de WhatsApp no puede impedir crear una orden de cargue.
    try {
      await reportarInterno("orden_creada", nextId)
    } catch (e: any) {
      console.error("[v0] reporte interno orden_creada:", e?.message ?? e)
    }

    // La inspección deja de estar huérfana: queda amarrada a esta orden.
    await vincularRegistroSanitario(supabase, horaSanitaria.registroId, orderCode)

    const detailUpdateResult = await updatePedidoDetalleStatus(orderData.detailUpdates, orderCode)

    if (!detailUpdateResult.success) {
      return { success: false, message: detailUpdateResult.message }
    }

    console.log("[v0] Updated pedidosdetalle with unidadescargadas and estado")

    const uniqueOrderIds = [...new Set(orderData.detailUpdates.map((u) => u.idpedido))]

    for (const idpedido of uniqueOrderIds) {
      const statusUpdateResult = await checkAndUpdatePedidoCabeceraStatus(idpedido)
      if (!statusUpdateResult.success) {
        console.error(`Error updating status for order ${idpedido}:`, statusUpdateResult.message)
      }
    }

    console.log("[v0] Updated pedidoscabecera estados")

    const { data: ordersData, error: ordersError } = await supabase
      .from("pedidoscabecera")
      .select("cliente, destino")
      .in("idpedido", orderData.selectedOrderIds)

    if (ordersError) {
      console.error("[v0] Error fetching orders data:", ordersError)
    }

    const updatePromises = orderData.selectedOrderIds.map((idpedido) =>
      supabase
        .from("pedidoscabecera")
        .update({
          fechaordencargue: currentDate,
          fechadeentrega: fechaEntrega,
          transporte: orderData.tipoTransporte,
          vehiculo: orderData.vehiculo,
          ocargue: orderCode,
        })
        .eq("idpedido", idpedido),
    )

    const updateResults = await Promise.all(updatePromises)
    const failedUpdates = updateResults.filter((result) => result.error)

    if (failedUpdates.length > 0) {
      console.error("[v0] Some orders failed to update:", failedUpdates)
      return { success: false, message: "Error al actualizar algunos pedidos" }
    }

    console.log("[v0] Updated", orderData.selectedOrderIds.length, "orders successfully")

    const { data: lastDetail, error: lastDetailError } = await supabase
      .from("detalleoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastDetailError) {
      console.error("[v0] Error fetching last detail ID:", lastDetailError)
      return { success: false, message: "Error al obtener último ID de detalle" }
    }

    let nextDetailId = lastDetail ? (lastDetail.id || 0) + 1 : 1
    console.log("[v0] Next detail ID will be:", nextDetailId)

    const detailsToInsert = orderData.productsList
      .filter((product) => product.cantidad > 0)
      .map((product) => ({
        id: nextDetailId++,
        idorden: nextId,
        numeroorden: (orderData as any).numeroOrden || orderCode,
        producto: product.producto,
        cantidad: product.cantidad,
        toneladas: product.toneladas,
        cliente: product.cliente,
      }))

    console.log("[v0] Inserting", detailsToInsert.length, "detail records (excluding zero quantities)")

    const { error: detailsInsertError } = await supabase.from("detalleoc").insert(detailsToInsert)

    if (detailsInsertError) {
      console.error("[v0] Error insertingdetalleoc:", detailsInsertError)
      return { success: false, message: `Error al crear detalles: ${detailsInsertError.message}` }
    }

    console.log("[v0] Detalleoc inserted successfully")

    // ------------------------------------------------------------------
    // DISTRIBUCIÓN AUTOMÁTICA (+D). Caso "Generar órdenes de cargue" cuando la orden
    // se crea YA con vehículo. Si la placa se asigna DESPUÉS en "Gestión de órdenes de
    // cargue", el clon se genera en assignVehicleToLoadOrder. Helper idempotente y
    // falla-seguro: si algo falla, NO se tumba la orden de cargue.
    let distribucionOrderCode: string | null = null
    if (!orderData.sinVehiculo) {
      distribucionOrderCode = await generarDistribucionAutomatica(supabase, nextId)
    }

    // ------------------------------------------------------------------
    // DESCARGUE AUTOMÁTICO EN CEDI DESTINO (Avimol/Indupan → CEDI Funza/Medellín/
    // Susanita). Crea el descargue PENDIENTE en el CEDI destino. Falla-seguro.
    try {
      await autoGenerarDescarguesCedi(supabase, nextId)
    } catch (cediErr) {
      console.error("[v0] Excepción en descargue automático a CEDI (no bloquea el cargue):", cediErr)
    }

    if (!orderData.sinVehiculo && orderData.vehiculo) {
      const { error: vehicleUpdateError } = await supabase
        .from("citasvehiculos")
        .update({
          estatus: "Procesado",
          ocargue: orderCode,
        })
        .eq("placa", orderData.vehiculo)
        .is("estatus", null)

      if (vehicleUpdateError) {
        console.error("[v0] Error updating vehicle status and ocargue:", vehicleUpdateError)
      } else {
        console.log("[v0] Vehicle status updated to Procesado and ocargue set to:", orderCode)
      }
    }

    // Generate PDF and upload it
    // La firma real espera (orderData, ordenCargueId, ordenCargueCode). Aquí se
    // llama con 1 arg (comportamiento vigente); se casta para conservarlo intacto.
    const pdfResult = await (generateAndUploadLoadOrderPDF as any)({
      orderId: nextId,
      orderCode,
      empresaId: sessionEmpresaId,
      fecha: `${currentDate} ${currentTime}`,
      placa: orderData.vehiculo,
      conductor: orderData.nombreConductor,
      transporte: orderData.tipoTransporte,
      destino: ordersData?.[0]?.destino || "",
      observaciones: orderData.observaciones || "",
      productsList: orderData.productsList.map((product) => ({
        cliente: product.cliente,
        destino: product.destino,
        producto: product.producto,
        cantidad: product.cantidad,
        pesoKgs: product.toneladas * 1000,
        lote: "",
        novedad: "",
      })),
      totalUnidades: orderData.productsList.reduce((sum, p) => sum + p.cantidad, 0),
      totalPesoKgs: orderData.totalWeight * 1000,
    })

    if (!pdfResult.success) {
      console.error("Failed to generate and upload PDF:", (pdfResult as any).message)
      // Decide if this should prevent the order creation or just log an error
      // For now, we'll log and proceed
    } else {
      console.log("PDF generated and uploaded successfully:", pdfResult.url)
      // Update cabeceraoc with the PDF URL if needed and if the PDF generation was successful
      await supabase.from("cabeceraoc").update({ pdfoc: pdfResult.url }).eq("id", nextId)
    }

    revalidatePath("/dashboard/orders") // Revalidate path after successful creation

    return {
      success: true,
      message: distribucionOrderCode
        ? `Orden de cargue generada. Se creó automáticamente la orden de distribución ${distribucionOrderCode}.`
        : "Orden de cargue generada exitosamente",
      orderId: nextId,
      distribucionOrderCode,
      orderData: {
        orderCode,
        empresaId: sessionEmpresaId,
        fecha: `${currentDate} ${currentTime}`,
        placa: orderData.vehiculo,
        conductor: orderData.nombreConductor,
        transporte: orderData.tipoTransporte,
        destino: ordersData?.[0]?.destino || "",
        observaciones: orderData.observaciones || "",
        productsList: orderData.productsList.map((product) => ({
          cliente: product.cliente,
          destino: product.destino,
          producto: product.producto,
          cantidad: product.cantidad,
          pesoKgs: product.toneladas * 1000,
          lote: "",
          novedad: "",
        })),
        totalUnidades: orderData.productsList.reduce((sum, p) => sum + p.cantidad, 0),
        totalPesoKgs: orderData.totalWeight * 1000,
      },
    }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado al generar orden de cargue" }
  }
}

export async function getOrderCodeForSelectedOrders(selectedOrderIds: number[]) {
  const supabase = await createClient()

  try {
    const { data: lastOrder, error } = await supabase
      .from("pedidoscabecera")
      .select("ocargue")
      .in("idpedido", selectedOrderIds)
      .not("ocargue", "is", null)
      .order("fechaordencargue", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error("[v0] Error fetching order code:", error)
      return { success: false, message: error.message }
    }

    if (!lastOrder || !lastOrder.ocargue) {
      return {
        success: false,
        message: "No se encontró orden de cargue. Debe generar primero la orden de cargue antes de generar el PDF",
      }
    }

    return { success: true, orderCode: lastOrder.ocargue }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado al obtener código de orden" }
  }
}

export async function updateLoadOrderPDFUrl(orderId: number, pdfUrl: string) {
  const supabase = await createClient()
  try {
    const { error } = await supabase.from("cabeceraoc").update({ pdfoc: pdfUrl }).eq("id", orderId)

    if (error) {
      console.error("Error updating PDF URL in cabeceraoc:", error)
      return { success: false, message: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al actualizar URL del PDF" }
  }
}

export async function updateLoadOrderFechaCargue(orderId: number, fechaCargue: string) {
  const supabase = await createClient()
  try {
    const fechaCargueFormatted = await dateInputToColombiaDate(fechaCargue)

    const { error } = await supabase.from("cabeceraoc").update({ fechacargue: fechaCargueFormatted }).eq("id", orderId)

    if (error) {
      console.error("Error updating fechacargue in cabeceraoc:", error)
      return { success: false, message: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al actualizar fecha de cargue" }
  }
}

export async function getLoadOrders(
  statusFilter: "pendiente" | "finalizada" | "todas" = "todas",
  onlyWithoutBatch: boolean = false,
  selectedEmpresaId?: number | null,
  /** 'YYYY-MM-DD' desde el que se traen órdenes (por `fechaorden`); `null` = todo
   *  el historial; ausente = últimos 90 días. No aplica a "pendiente". */
  desde?: string | null,
) {
  const supabase = await createClient()
  try {
    // Use selectedEmpresaId if provided, otherwise fall back to current user's empresa_id
    const empresaId = selectedEmpresaId ?? await getCurrentEmpresaIdForInsert()

    // Auto-sanación del clon +D: garantiza que las órdenes de cargue recientes
    // con placa de distribución tengan su "D", aunque el enganche en creación/
    // asignación no hubiera corrido. Idempotente, acotada y falla-segura.
    try {
      await reconciliarDistribucionesFaltantes(supabase, empresaId as number)
    } catch (reconErr) {
      console.error("[+D] reconciliación en getLoadOrders (no bloquea):", reconErr)
    }

    // Auto-sanación del clon de descargue CEDI: si la empresa vista es un CEDI
    // (id3/id4), garantiza que los cargues recientes de planta con lote ya
    // asignado tengan su descargue pendiente en este CEDI. Idempotente,
    // acotada y falla-segura.
    try {
      await reconciliarDescarguesCediFaltantes(supabase, empresaId as number)
    } catch (reconErr) {
      console.error("[auto-descargue] reconciliación en getLoadOrders (no bloquea):", reconErr)
    }

    let query = supabase
      .from("cabeceraoc")
      .select("*, idempresa")
      .eq("idempresa", empresaId) // Filter by empresa ID
      .in("tipooperacion", ["Cargue", "Descargue", "Distribucion"]) // Only show Cargue, Descargue and Distribucion operations
      .order("id", { ascending: false })

    // Only apply horalote NULL filter when explicitly requested (e.g., from Asignación de Lotes).
    // Defensa en profundidad: en ese contexto de LOTES se excluyen los clones +D
    // (Distribucion), que nunca asignan lotes; así no reaparecen aquí si un clon
    // antiguo quedó con horalote null.
    if (onlyWithoutBatch) {
      query = query.is("horalote", null).neq("tipooperacion", "Distribucion")
    }

    if (statusFilter === "pendiente") {
      query = query.or("status.is.null,status.eq.")
    } else if (statusFilter === "finalizada") {
      query = query.eq("status", "finalizado")
    }

    // PERIODO (ver lib/periodo-listados.ts): "pendiente" no se acota (son pocas
    // y pueden ser viejas); "finalizada"/"todas" traen por defecto los últimos
    // 90 días, `desde = null` = todo el historial. Y se pagina COMPLETO dentro
    // del periodo: antes "todas" llegaba recortada en silencio a las 1.000
    // órdenes más recientes (Supabase corta ahí).
    if (statusFilter !== "pendiente") {
      const d = desde === undefined ? desdeDePeriodo(PERIODO_LISTADO_DEFECTO, hoyBogotaISO()) : desde
      if (d) query = query.gte("fechaorden", d)
    }

    let data: any[]
    try {
      data = await fetchAllRows((from, to) => query.range(from, to))
    } catch (e: any) {
      console.error("Error fetching load orders:", e)
      return { success: false, message: e?.message || "Error al cargar órdenes" }
    }

    // Alerta: Distribución creada A MANO (no por la automatización +D). La
    // automatización ya funciona bien, así que una manual hoy es señal de que
    // algo debió generarse solo y no pasó (o alguien se está saltando el
    // flujo). No hay columna que distinga origen; la señal confiable es que
    // TODO clon automático tiene `ordendecargue = {código del cargue madre}D`
    // y esa madre existe como Cargue real — si no hay madre, es manual.
    // Solo se evalúa si esta empresa participa de la automatización +D (si no
    // tiene placas de distribución, ninguna Distribución suya es "automática"
    // y marcar todas sería puro ruido) y SOLO desde que el clon automático
    // existe (16-jul-2026, confirmado por el usuario) — antes de esa fecha
    // TODO era manual por diseño, marcarlo sería puro ruido histórico.
    const DISTRIBUCION_AUTOMATICA_DESDE = "2026-07-16"
    try {
      await cargarPlacasDistribucion()
      const tienePlacasPropias = getPlacasEmpresa(empresaId as number).length > 0
      const distribuciones = (data ?? []).filter(
        (o: any) => o.tipooperacion === "Distribucion" && (o.fechaorden ?? "") >= DISTRIBUCION_AUTOMATICA_DESDE,
      )
      if (tienePlacasPropias && distribuciones.length > 0) {
        const candidatosMadre = Array.from(
          new Set(
            distribuciones
              .filter((o: any) => String(o.ordendecargue || "").endsWith("D"))
              .map((o: any) => String(o.ordendecargue).slice(0, -1)),
          ),
        )
        const madresExistentes = new Set<string>()
        if (candidatosMadre.length > 0) {
          const { data: madres } = await supabase
            .from("cabeceraoc")
            .select("ordendecargue")
            .eq("tipooperacion", "Cargue")
            .in("ordendecargue", candidatosMadre)
          for (const m of madres ?? []) madresExistentes.add(String(m.ordendecargue))
        }
        for (const o of distribuciones) {
          const code = String(o.ordendecargue || "")
          const madreCode = code.endsWith("D") ? code.slice(0, -1) : null
          ;(o as any).distribucionManual = !(madreCode && madresExistentes.has(madreCode))
        }
      }
    } catch (alertErr) {
      console.error("[+D] deteccion de distribucion manual (no bloquea):", alertErr)
    }

    return { success: true, data }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar órdenes de cargue" }
  }
}

export async function getLoadOrdersForBascula(selectedEmpresaId?: number) {
  const supabase = await createClient()
  try {
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    const { data, error } = await supabase
      .from("cabeceraoc")
      .select(
        "id, ordendecargue, placa, pesajeinicial, pesajefinal, pesovascula, tiquetebascula, fechaorden, fechacargue, pesoorden",
      )
      .eq("idempresa", empresaId) // Filter by empresa from session
      .neq("tipooperacion", "Tolva") // Exclude Tolva operations
      // Los CLONES de distribución (+D) NO pasan por báscula: la orden madre ya se
      // pesó. Sin esto aparecían aquí por nacer con pesajefinal null y placa heredada.
      // Los clones solo se tramitan en Packing y se ven en el dashboard del día.
      .neq("tipooperacion", "Distribucion")
      .is("pesajefinal", null)
      .not("placa", "is", null)
      .neq("placa", "")
      .order("id", { ascending: false })

    if (error) {
      console.error("Error fetching load orders for bascula:", error)
      return { success: false, message: error.message }
    }

    return { success: true, data }
  } catch (error) {
    console.error("Error in getLoadOrdersForBascula:", error)
    return { success: false, message: "Error inesperado al cargar órdenes de cargue" }
  }
}

export async function updateBasculaData(orderData: {
  orderId: number
  pesajeinicial?: string
  pesajefinal?: string
  pesovascula?: number
  tiquetebascula?: string
}) {
  const supabase = await createClient()
  try {
    const updateData: any = {}

    if (orderData.pesajeinicial) updateData.pesajeinicial = orderData.pesajeinicial
    if (orderData.pesajefinal) {
      // CANDADO (gerencia 2026-10-02): el pesaje final FINALIZA la orden. Un
      // Cargue no puede finalizar con salidas de inventario "por descontar"
      // (picking sin confirmar): el camión se va con el stock ya descontado
      // pero sin transacción aprobada, y esas líneas quedan como diferencia
      // sin soporte del mes (caso real ID3: 6 líneas en 3 órdenes de
      // septiembre; ID1: 9 líneas en 4 órdenes). El cierre con fotos ya lo
      // exigía; Báscula era la puerta que faltaba. El coordinador resuelve
      // con "Confirmar Picking" en Centro de Coordinación y se registra el
      // pesaje final después.
      try {
        const admin = await getSupabaseAdmin()
        const { data: orden } = await admin.from("cabeceraoc").select("ordendecargue, tipooperacion").eq("id", orderData.orderId).maybeSingle()
        if (orden?.tipooperacion === "Cargue" && orden?.ordendecargue) {
          const { count } = await admin
            .from("invtrans")
            .select("id", { count: "exact", head: true })
            .eq("ocargue", orden.ordendecargue)
            .eq("status", "por descontar")
          if ((count || 0) > 0) {
            return {
              success: false,
              message: `La orden ${orden.ordendecargue} tiene ${count} línea(s) de inventario sin confirmar (picking pendiente). El coordinador debe confirmar el Picking en Centro de Coordinación antes del pesaje final.`,
            }
          }
        }
      } catch (e: any) {
        // Falla segura hacia el control: si no se pudo verificar, no se finaliza.
        return { success: false, message: `No se pudo verificar el picking de la orden: ${e?.message ?? e}` }
      }
      updateData.pesajefinal = orderData.pesajefinal
      // When pesajefinal is set, also set status to "finalizado"
      updateData.status = "finalizado"
    }
    if (orderData.pesovascula !== undefined) updateData.pesovascula = orderData.pesovascula
    if (orderData.tiquetebascula) updateData.tiquetebascula = orderData.tiquetebascula

    const { error } = await supabase.from("cabeceraoc").update(updateData).eq("id", orderData.orderId)

    if (error) {
      console.error("Error updating bascula data:", error)
      return { success: false, message: error.message }
    }

    // Sincroniza el pesaje al clon de Distribución (+D) de placa propia, si
    // existe. La báscula NUNCA pesa el clon (está excluido de esa lista): sin
    // esto, Pes.Ini/Pes.Fin/Peso báscula/Tiquete quedan en blanco para
    // siempre en el clon. NO toca iniciocargue/fincargue/status: esos los
    // llena el coordinador al tramitar el Packing de la propia distribución.
    await sincronizarBasculaAClon(orderData.orderId)

    /*
     * Reporte interno del pesaje.
     *
     * Solo cuando llega `pesovascula`: esta función también se usa para
     * corregir un tiquete o ajustar una hora, y avisar en cada corrección
     * mandaría varios mensajes por el mismo pesaje.
     *
     * El peso y el tiquete se pasan explícitos porque acaban de escribirse y
     * releer la fila podría traer el valor anterior.
     */
    if (orderData.pesovascula !== undefined) {
      try {
        await reportarInterno("pesaje", orderData.orderId, {
          peso: orderData.pesovascula ?? null,
          tiquete: orderData.tiquetebascula ?? null,
        })
      } catch (e: any) {
        console.error("[v0] reporte interno pesaje:", e?.message ?? e)
      }
    }

    return { success: true }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al actualizar datos de báscula" }
  }
}

/**
 * Copia pesajeinicial/pesajefinal/pesovascula/tiquetebascula/status de una
 * orden de Cargue hacia su clon de Distribución (+D), si el clon ya existe.
 * `status` va aquí también: lo cierra la báscula (updateData.status arriba),
 * no el coordinador de Packing (ese usa fincargue, que nunca se toca aquí).
 * Falla segura: nunca bloquea la actualización de báscula de la madre.
 */
async function sincronizarBasculaAClon(ordenId: number): Promise<void> {
  try {
    const admin = await getSupabaseAdmin()
    const { data: madre } = await admin
      .from("cabeceraoc")
      .select("ordendecargue, tipooperacion, pesajeinicial, pesajefinal, pesovascula, tiquetebascula, status")
      .eq("id", ordenId)
      .maybeSingle()
    if (!madre || madre.tipooperacion !== "Cargue") return

    const distCode = numeroOrdenDistribucion(madre.ordendecargue)
    const { data: clon } = await admin.from("cabeceraoc").select("id").eq("ordendecargue", distCode).limit(1).maybeSingle()
    if (!clon) return

    await admin
      .from("cabeceraoc")
      .update({
        pesajeinicial: madre.pesajeinicial,
        pesajefinal: madre.pesajefinal,
        pesovascula: madre.pesovascula,
        tiquetebascula: madre.tiquetebascula,
        status: madre.status,
      })
      .eq("id", clon.id)
  } catch (e: any) {
    console.error("[sincronizarBasculaAClon] excepción (no bloquea la orden):", e?.message || e)
  }
}


/**
 * Hora de la inspección sanitaria de un vehículo, para una orden que se está
 * creando AHORA.
 *
 * El caso que resuelve: la inspección se hace ANTES de que exista la orden. En
 * ese momento el registro se guarda con `ordencargue` en null y la hora queda
 * en `citasvehiculos.horaregistro`. Si después la orden se crea directamente
 * con la placa —y no asignando el vehículo a una orden ya existente— esa hora
 * no viajaba a `cabeceraoc.horasanitario` y en la orden aparecía vacía, como si
 * el vehículo nunca se hubiera inspeccionado.
 *
 * Busca en dos lugares, en este orden:
 *   1. `citasvehiculos.horaregistro` — donde la deja la inspección sin orden.
 *   2. `registrosanitario` — la inspección misma. Cubre los casos en que la
 *      cita no se actualizó o en que no había cita.
 *
 * Solo mira inspecciones APROBADAS y del mismo día o del anterior: una
 * inspección de hace tres días no dice nada del estado del vehículo hoy, y
 * arrastrarla a la orden sería peor que dejar el campo vacío. El día anterior
 * sí cuenta porque un vehículo inspeccionado de noche se carga a la mañana
 * siguiente.
 *
 * Devuelve también el `id` del registro para poder amarrarlo a la orden.
 * Nunca lanza: si algo falla, devuelve la hora en null y la orden sigue.
 */
async function resolverHoraSanitaria(
  supabase: any,
  placa: string | null | undefined,
  fechaOrden: string,
): Promise<{ hora: string | null; registroId: number | null }> {
  const vacio = { hora: null as string | null, registroId: null as number | null }
  const chapa = String(placa ?? "").trim()
  if (!chapa || !/^\d{4}-\d{2}-\d{2}$/.test(fechaOrden)) return vacio

  // Día anterior, comparando por texto: `fechaOrden` es AAAA-MM-DD y en ese
  // formato el orden alfabético es el cronológico. No se usa `new Date(...)`
  // porque interpreta la cadena como UTC y en Colombia devuelve el día previo.
  const [y, m, d] = fechaOrden.split("-").map(Number)
  const anterior = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)

  try {
    const { data: reg, error: regError } = await supabase
      .from("registrosanitario")
      .select("id, horaregistro, fecha, aprobacion, ordencargue")
      .eq("placa", chapa)
      .is("ordencargue", null)
      .gte("fecha", anterior)
      .lte("fecha", fechaOrden)
      .order("id", { ascending: false })
      .limit(5)

    if (regError) {
      console.error("[v0] resolverHoraSanitaria registrosanitario:", regError.message, regError.code)
    } else {
      const aprobado = (reg ?? []).find(
        (r: any) => String(r.aprobacion ?? "aprobado").trim().toLowerCase() !== "rechazado" && r.horaregistro,
      )
      if (aprobado) {
        return { hora: aprobado.horaregistro, registroId: aprobado.id ?? null }
      }
    }

    // Respaldo: la hora que la inspección dejó en la cita del vehículo.
    const { data: cita, error: citaError } = await supabase
      .from("citasvehiculos")
      .select("horaregistro")
      .eq("placa", chapa)
      .not("horaregistro", "is", null)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (citaError) {
      console.error("[v0] resolverHoraSanitaria citasvehiculos:", citaError.message, citaError.code)
      return vacio
    }
    return { hora: cita?.horaregistro ?? null, registroId: null }
  } catch (e: any) {
    console.error("[v0] resolverHoraSanitaria excepción:", e?.message)
    return vacio
  }
}

/**
 * Amarra una inspección sanitaria previa a la orden que acaba de nacer, para
 * que el histórico de inspecciones deje de mostrarla sin orden. No bloquea:
 * si falla, la orden ya quedó bien y esto es trazabilidad.
 */
async function vincularRegistroSanitario(supabase: any, registroId: number | null, ordenCargue: string) {
  if (!registroId || !ordenCargue) return
  const { error } = await supabase
    .from("registrosanitario")
    .update({ ordencargue: ordenCargue })
    .eq("id", registroId)
    .is("ordencargue", null)
  if (error) {
    console.error("[v0] vincularRegistroSanitario:", error.message, error.code)
  }
}

export async function getVehiclesForSanitaryRegistry() {
  const supabase = await createClient()
  try {
    const empresaId = await getCurrentEmpresaIdForInsert()

    // Vehículos pendientes de registro sanitario de los ÚLTIMOS 30 DÍAS,
    // paginado. Antes traía toda la historia sin `horasanitario` (miles de
    // órdenes viejas que ya nunca se registrarán) y Supabase la recortaba en
    // silencio a las 1.000 más recientes.
    const desde = restarDiasISO(hoyBogotaISO(), 30)
    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from("cabeceraoc")
          .select("id, placa, ordendecargue, conductor, tipoproducto")
          .eq("idempresa", empresaId)
          .is("horasanitario", null)
          .gte("fechaorden", desde)
          .order("id", { ascending: false })
          .range(from, to),
      )
    } catch (e: any) {
      console.error("Error fetching vehicles for sanitary registry:", e)
      return { success: false, message: e?.message || "Error al cargar vehículos" }
    }

    return { success: true, data }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar vehículos" }
  }
}

export async function uploadSanitaryPhoto(file: File, ordenCargue: string) {
  try {
    console.log("[v0] uploadSanitaryPhoto - Starting upload for order:", ordenCargue)
    console.log("[v0] uploadSanitaryPhoto - File name:", file.name, "size:", file.size, "type:", file.type)

    const supabase = await getSupabaseAdmin()

    // Generate filename based on order code
    const fileExtension = file.name.split(".").pop()
    const fileName = `${ordenCargue}_${Date.now()}.${fileExtension}`
    const filePath = `registrosanitario/${fileName}`

    console.log("[v0] uploadSanitaryPhoto - Uploading to path:", filePath)

    // Upload file directly to Supabase Storage in the 'archivos' bucket
    const { data, error } = await supabase.storage.from("archivos").upload(filePath, file, {
      contentType: file.type,
      upsert: true, // Replace if exists
    })

    if (error) {
      console.error("[v0] uploadSanitaryPhoto - Error uploading photo:", error)
      return { success: false, message: error.message, url: null }
    }

    console.log("[v0] uploadSanitaryPhoto - Upload successful, getting public URL")

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("archivos").getPublicUrl(filePath)

    console.log("[v0] uploadSanitaryPhoto - Photo uploaded successfully. Public URL:", publicUrl)
    return { success: true, message: "Foto subida exitosamente", url: publicUrl }
  } catch (error) {
    console.error("[v0] uploadSanitaryPhoto - Unexpected error:", error)
    return { success: false, message: "Error inesperado al subir foto", url: null }
  }
}

export async function registerSanitaryVerification(data: {
  ordencargue: string
  placa: string
  conductor: string
  producto: string
  carpas: string
  limpieza: string
  olores: string
  plastico: string
  fumigacion: string
  plaguicida: string
  observaciones: string
  fumigador: string
  auxiliar: string
  foto?: string | null
  vehicleId?: number | null
  aprobacion?: string
  isVehicleOnly?: boolean
  citasVehiculosId?: number | null
}) {
  const supabase = await createClient()
  try {
    console.log("[v0] Registering sanitary verification:", data)

    const { data: maxIdData, error: maxIdError } = await supabase
      .from("registrosanitario")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)

    if (maxIdError) {
      console.error("Error fetching max ID:", maxIdError)
      return { success: false, message: maxIdError.message }
    }

    const nextId = maxIdData && maxIdData.length > 0 ? maxIdData[0].id + 1 : 1

    const colombiaTime = await getColombiaDateTime()
    const fechaForDB = colombiaTime.toISOString().split("T")[0] // YYYY-MM-DD for date type
    const horaForDB = colombiaTime.toTimeString().split(" ")[0] // HH:MM:SS for time type
    const fechaDisplay = colombiaTime.toLocaleDateString("es-CO") // For PDF display

    console.log("[v0] Generating PDF for sanitary registry...")
    const { generateAndUploadSanitaryRegistryPDF } = await import("@/lib/pdf-actions")

    const pdfResult = await generateAndUploadSanitaryRegistryPDF({
      id: nextId,
      ordencargue: data.isVehicleOnly ? null : data.ordencargue,
      placa: data.placa,
      conductor: data.conductor,
      producto: data.producto,
      carpas: data.carpas,
      limpieza: data.limpieza,
      olores: data.olores,
      plastico: data.plastico,
      fumigacion: data.fumigacion,
      plaguicida: data.plaguicida,
      observaciones: data.observaciones,
      fumigador: data.fumigador,
      auxiliar: data.auxiliar,
      fecha: fechaDisplay,
      hora: horaForDB,
      aprobacion: data.aprobacion || "aprobado",
      isVehicleOnly: data.isVehicleOnly,
    })

    let pdfUrl: string | null = null
    if (pdfResult.success && pdfResult.url) {
      pdfUrl = pdfResult.url
      console.log("[v0] PDF generated successfully:", pdfUrl)
    } else {
      console.error("[v0] Failed to generate PDF:", pdfResult.error)
    }

    const empresaId = await getCurrentEmpresaIdForInsert()

    console.log("[v0] registerSanitaryVerification - Saving to database with foto URL:", data.foto)
    console.log("[v0] registerSanitaryVerification - PDF URL:", pdfUrl)

    const { error: insertError } = await supabase.from("registrosanitario").insert({
      id: nextId,
      idempresa: empresaId, // Use dynamic empresa ID
      ordencargue: data.isVehicleOnly ? null : data.ordencargue,
      placa: data.placa,
      conductor: data.conductor,
      producto: data.producto,
      carpas: data.carpas,
      limpieza: data.limpieza,
      olores: data.olores,
      plastico: data.plastico,
      fumigacion: data.fumigacion,
      plaguicida: data.plaguicida,
      observaciones: data.observaciones,
      fumigador: data.fumigador,
      auxiliar: data.auxiliar,
      foto: data.foto || null,
      aprobacion: data.aprobacion || "aprobado",
      pdf: pdfUrl,
      fecha: fechaForDB, // date type: YYYY-MM-DD
      horaregistro: horaForDB, // time type: HH:MM:SS
    })

    if (insertError) {
      console.error("Error inserting sanitary registry:", insertError)
      return { success: false, message: insertError.message }
    }

    console.log("[v0] Sanitary verification registered successfully with ID:", nextId)

    if (data.isVehicleOnly && data.citasVehiculosId) {
      // Update citasvehiculos table with horaregistro
      console.log("[v0] Updating horaregistro for citasvehiculos ID:", data.citasVehiculosId, "with time:", horaForDB)

      const { error: updateError } = await supabase
        .from("citasvehiculos")
        .update({ horaregistro: horaForDB })
        .eq("id", data.citasVehiculosId)

      if (updateError) {
        console.error("Error updating horaregistro in citasvehiculos:", updateError)
      } else {
        console.log("[v0] horaregistro updated successfully in citasvehiculos")
      }
    } else if (data.vehicleId) {
      // Original logic for orders with orden de cargue
      if (data.aprobacion === "rechazado") {
        console.log("[v0] Updating status to 'Registro sanitario rechazado' for vehicle ID:", data.vehicleId)

        const { error: updateError } = await supabase
          .from("cabeceraoc")
          .update({ status: "Registro sanitario rechazado" })
          .eq("id", data.vehicleId)

        if (updateError) {
          console.error("Error updating status:", updateError)
        } else {
          console.log("[v0] Status updated successfully")
        }
      } else {
        console.log("[v0] Updating horasanitario for vehicle ID:", data.vehicleId, "with time:", horaForDB)

        const { error: updateError } = await supabase
          .from("cabeceraoc")
          .update({ horasanitario: horaForDB })
          .eq("id", data.vehicleId)

        if (updateError) {
          console.error("Error updating horasanitario:", updateError)
        } else {
          console.log("[v0] horasanitario updated successfully")
        }
      }
    }

    return {
      success: true,
      message:
        data.aprobacion === "rechazado"
          ? "Inspección rechazada exitosamente"
          : "Registro sanitario guardado exitosamente",
    }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al registrar verificación sanitaria" }
  }
}

export async function updatePedidoDetalleStatus(
  updates: Array<{
    transid: number
    unidadescargadas: number
    estado: "cerrado" | "parcial"
  }>,
  orderCode?: string,
) {
  const supabase = await createClient()
  try {
    const updatePromises = updates.map((update) => {
      const updateData: {
        unidadescargadas: number
        estado: "cerrado" | "parcial"
        ocargue?: string
      } = {
        unidadescargadas: update.unidadescargadas,
        estado: update.estado,
      }

      if (orderCode) {
        updateData.ocargue = orderCode
      }

      return supabase.from("pedidosdetalle").update(updateData).eq("transid", update.transid)
    })

    const results = await Promise.all(updatePromises)
    const failedUpdates = results.filter((result) => result.error)

    if (failedUpdates.length > 0) {
      console.error("Error updating pedidosdetalle:", failedUpdates)
      return { success: false, message: "Error al actualizar detalles de pedido" }
    }

    return { success: true }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al actualizar detalles" }
  }
}

export async function checkAndUpdatePedidoCabeceraStatus(idpedido: number) {
  const supabase = await createClient()
  try {
    // Get all lines for this order
    const { data: allLines, error: linesError } = await supabase
      .from("pedidosdetalle")
      .select("estado")
      .eq("idpedido", idpedido)

    if (linesError) {
      console.error("Error fetching order lines:", linesError)
      return { success: false, message: "Error al verificar líneas del pedido" }
    }

    if (!allLines || allLines.length === 0) {
      return { success: true }
    }

    // Check if all lines are closed
    const allClosed = allLines.every((line) => line.estado === "cerrado")

    // Check if at least one line is partial
    const hasPartial = allLines.some((line) => line.estado === "parcial")

    let newEstado: string | null = null

    if (allClosed) {
      newEstado = "entregado"
    } else if (hasPartial) {
      newEstado = "parcial"
    }

    // Update pedidoscabecera estado if needed
    if (newEstado) {
      const { error: updateError } = await supabase
        .from("pedidoscabecera")
        .update({ estado: newEstado })
        .eq("idpedido", idpedido)

      if (updateError) {
        console.error("Error updating pedidoscabecera:", updateError)
        return { success: false, message: "Error al actualizar estado del pedido" }
      }
    }

    return { success: true }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al actualizar estado del pedido" }
  }
}

export async function getSanitaryRegistryHistory(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  
  try {
  // Use selectedEmpresaId if provided, otherwise fall back to current user's empresa_id
  const empresaId = selectedEmpresaId ?? await getCurrentEmpresaIdForInsert()
  
  console.log("[v0] getSanitaryRegistryHistory - Filtering by empresaId:", empresaId)

    const { data, error } = await supabase
      .from("registrosanitario")
      .select("*")
      .eq("idempresa", empresaId)
      .order("id", { ascending: true })

    if (error) {
      console.error("Error fetching sanitary registry history:", error)
      return { success: false, data: [], error: error.message }
    }

    console.log("[v0] getSanitaryRegistryHistory - Found", data?.length || 0, "records for empresa", empresaId)
    return { success: true, data: data || [] }
  } catch (error) {
    console.error("Error in getSanitaryRegistryHistory:", error)
    return { success: false, data: [], error: "Error al cargar el historial" }
  }
}

export async function getEstadosFilter() {
  const supabase = await createClient()
  try {
    // PAGINADO: pedidoscabecera tiene más de 11.000 filas y Supabase corta en
    // 1.000 sin avisar -- el filtro de estados podía perder valores.
    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase.from("pedidoscabecera").select("estado").order("estado", { ascending: true }).order("idpedido").range(from, to),
      )
    } catch (error: any) {
      console.error("Error fetching estados:", error)
      return { success: false, message: error?.message || "Error al cargar estados" }
    }

    // Get unique estados and filter out null/empty values
    const uniqueEstados = [
      ...new Set(data.map((row) => row.estado).filter((estado) => estado && estado.trim() !== "")),
    ].sort()

    return { success: true, data: uniqueEstados }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar estados" }
  }
}

export async function getClientesFilter() {
  const supabase = await createClient()
  try {
    const empresaId = await getCurrentEmpresaIdForInsert()

    const { data, error } = await supabase
      .from("clientes")
      .select("id, nombre")
      .eq("id_empresa", empresaId) // Apply empresa filter
      .order("nombre", { ascending: true })

    if (error) {
      console.error("Error fetching clientes:", error)
      return { success: false, message: error.message, data: null }
    }

    return {
      success: true,
      data: data || [],
      clientesMap: new Map(data?.map((c) => [c.nombre, c.id]) || []),
    }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar clientes", data: null }
  }
}

export async function getVendedoresFilter() {
  const supabase = await createClient()
  try {
    const { data, error } = await supabase.from("vendedores").select("nombre").order("nombre", { ascending: true })

    if (error) {
      console.error("Error fetching vendedores:", error)
      return { success: false, message: error.message, data: null }
    }

    const vendedores = data?.map((v) => v.nombre).filter((nombre) => nombre && nombre.trim() !== "") || []

    return { success: true, data: vendedores }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar vendedores", data: null }
  }
}

export async function getDestinosFilter() {
  const supabase = await createClient()
  try {
    const { data, error } = await supabase.from("destinos").select("nombre").order("nombre", { ascending: true })

    if (error) {
      console.error("Error fetching destinos:", error)
      return { success: false, message: error.message, data: null }
    }

    const destinos = data?.map((d) => d.nombre).filter((nombre) => nombre && nombre.trim() !== "") || []

    return { success: true, data: destinos }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al cargar destinos", data: null }
  }
}

export async function annulOrder(idpedido: number, password: string, observaciones?: string) {
  const supabase = await createClient()

  console.log("[v0] Annul order attempt:", { idpedido })

  try {
    // Verify order conditions
    const { data: order, error: fetchError } = await supabase
      .from("pedidoscabecera")
      .select("aprobado, ocargue, estado, id_empresa")
      .eq("idpedido", idpedido)
      .single()

    if (fetchError) {
      console.error("[v0] Fetch error:", fetchError)
      return { success: false, message: "Error al verificar el pedido" }
    }

    if (order.aprobado?.toLowerCase() !== "si") {
      console.log("[v0] Order not approved:", order.aprobado)
      return { success: false, message: "Solo se pueden anular pedidos aprobados" }
    }

    if (order.ocargue && order.ocargue.trim() !== "") {
      console.log("[v0] Order has ocargue:", order.ocargue)
      return { success: false, message: "No se puede anular un pedido con O.Cargue asignada" }
    }

    // Autorización (SQL 203): clave PERSONAL con el proceso `ped_anular` en el
    // proyecto del pedido (perfil "Gerencia de proyecto" con alcance a ese
    // proyecto). Las claves compartidas históricas ("LIP123456", "Avimol2026")
    // ya no viven en el código: solo valen durante la transición.
    const auth = await autorizar({ proceso: "ped_anular", idempresa: order.id_empresa, clave: password, referencia: `anular pedido ${idpedido}` })
    if (!auth.ok) {
      console.log("[v0] Password validation failed")
      return { success: false, message: auth.error || "Contraseña incorrecta" }
    }

    const { error: updateError } = await supabase
      .from("pedidoscabecera")
      .update({
        estado: "anulado",
        observaciones: observaciones || "",
      })
      .eq("idpedido", idpedido)

    if (updateError) {
      console.error("[v0] Update error:", updateError)
      return { success: false, message: "Error al anular el pedido" }
    }

    console.log("[v0] Order successfully annulled")
    return { success: true, message: "Pedido anulado exitosamente" }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado al anular pedido" }
  }
}

export async function closePendingOrder(idpedido: number, password: string, observaciones?: string) {
  const supabase = await createClient()

  try {
    // Verify order conditions
    const { data: order, error: fetchError } = await supabase
      .from("pedidoscabecera")
      .select("estado, id_empresa")
      .eq("idpedido", idpedido)
      .single()

    if (fetchError) {
      return { success: false, message: "Error al verificar el pedido" }
    }

    if (order.estado?.toLowerCase() !== "parcial") {
      return { success: false, message: "Solo se pueden cerrar pedidos con estado parcial" }
    }

    // Autorización (SQL 203): proceso `ped_cerrar_pendiente` en el proyecto del pedido.
    const auth = await autorizar({ proceso: "ped_cerrar_pendiente", idempresa: order.id_empresa, clave: password, referencia: `cerrar pedido ${idpedido}` })
    if (!auth.ok) {
      return { success: false, message: auth.error || "Contraseña incorrecta" }
    }

    const { error: updateError } = await supabase
      .from("pedidoscabecera")
      .update({
        estado: "entrega parcial",
        observaciones: observaciones || "",
      })
      .eq("idpedido", idpedido)

    if (updateError) {
      return { success: false, message: "Error al cerrar el pedido" }
    }

    return { success: true, message: "Pedido cerrado exitosamente" }
  } catch (error) {
    return { success: false, message: "Error inesperado al cerrar pedido" }
  }
}

// Si se borra una orden de CARGUE (madre), sus clones automáticos (descargue
// en el CEDI destino + distribución "+D") deben borrarse con ella — si no,
// quedan huérfanos apuntando a una madre que ya no existe (exactamente el caso
// real encontrado: MED202608037573 con `ordenorigen = AVI202608037572` y esa
// madre ya no está en cabeceraoc).
//
// Si algún clon YA fue procesado (tiene `iniciocargue`, o ya generó
// movimientos en `invtrans`), NO se borra nada — se bloquea la eliminación de
// la madre y se avisa, porque eso significaría hacer desaparecer un
// movimiento de inventario real sin más contexto.
async function eliminarClonesDeCargue(
  supabase: any,
  ordenDeCargueMadre: string,
): Promise<{ success: boolean; message?: string }> {
  const { data: clonesDescargue } = await supabase
    .from("cabeceraoc")
    .select("id, ordendecargue, iniciocargue")
    .eq("ordenorigen", ordenDeCargueMadre)
    .eq("tipooperacion", "Descargue")

  const distCode = numeroOrdenDistribucion(ordenDeCargueMadre)
  const { data: clonDistribucion } = await supabase
    .from("cabeceraoc")
    .select("id, ordendecargue, iniciocargue")
    .eq("ordendecargue", distCode)
    .eq("tipooperacion", "Distribucion")
    .maybeSingle()

  const candidatos = [...(clonesDescargue ?? []), ...(clonDistribucion ? [clonDistribucion] : [])]
  if (candidatos.length === 0) return { success: true }

  for (const clon of candidatos) {
    if (clon.iniciocargue) {
      return {
        success: false,
        message: `No se pudo eliminar: la orden clon ${clon.ordendecargue} ya fue iniciada. Elimínala primero manualmente si corresponde.`,
      }
    }
    const { data: ingresos } = await supabase.from("invtrans").select("id").eq("ocargue", clon.ordendecargue).limit(1)
    if (ingresos && ingresos.length > 0) {
      return {
        success: false,
        message: `No se pudo eliminar: la orden clon ${clon.ordendecargue} ya generó movimientos de inventario. Elimínala primero manualmente si corresponde.`,
      }
    }
  }

  for (const clon of candidatos) {
    await supabase.from("detalleoc").delete().eq("idorden", clon.id)
    await supabase.from("cabeceraoc").delete().eq("id", clon.id)
    console.log("[v0] Clon eliminado en cascada junto con su madre:", clon.ordendecargue)
  }
  return { success: true }
}

export async function deleteLoadOrder(orderId: number) {
  // (2026-10-02) Eliminar una orden es delicado: debe quedar QUIÉN lo hizo.
  // Con el cliente genérico la auditoría registraba actor "sistema" sin id
  // (nueve órdenes eliminadas el 30-sep sin responsable identificable). El
  // cliente admin por actor inyecta el usuario en sesión en cada escritura
  // (header x-audit-user → trigger de auditoría): cabecera, líneas y clones
  // quedan con nombre y hora. Además se deja una fila explícita de auditoría
  // con el resumen de la orden antes de borrarla.
  const supabase: any = await getSupabaseAdmin()
  try {
    console.log("[v0] Starting deleteLoadOrder for orderId:", orderId)
    try {
      const { data: resumen } = await supabase
        .from("cabeceraoc")
        .select("idempresa, ordendecargue, tipooperacion, placa, conductor, cliente, pesoorden, status, fechaorden")
        .eq("id", orderId)
        .maybeSingle()
      if (resumen) {
        const { usuario } = await getCurrentUserContext()
        await supabase.from("auditoria").insert({
          actor_nombre: usuario || "sistema",
          idempresa: resumen.idempresa ?? null,
          modulo: "Gestión de Ordenes",
          tabla: "cabeceraoc",
          operacion: "DELETE",
          registro_id: String(orderId),
          descripcion: `Eliminó la orden ${resumen.ordendecargue} (${resumen.tipooperacion ?? ""}, placa ${resumen.placa ?? "sin placa"}, ${resumen.conductor ?? "sin conductor"}, ${resumen.pesoorden ?? "?"} t, estado ${resumen.status ?? "en curso"}, fecha ${resumen.fechaorden ?? ""})`,
          antes: resumen,
        })
      }
    } catch (e: any) {
      console.error("[v0] auditoría explícita de eliminación:", e?.message ?? e)
    }

    // Step 1: Get the order to be deleted to get ordendecargue
    const { data: orderToDelete, error: fetchError } = await supabase
      .from("cabeceraoc")
      .select("ordendecargue, tipooperacion")
      .eq("id", orderId)
      .single()

    if (fetchError) {
      console.error("[v0] Error fetching order to delete:", fetchError)
      return { success: false, message: "Error al obtener la orden de cargue" }
    }

    if (!orderToDelete) {
      return { success: false, message: "Orden de cargue no encontrada" }
    }

    const ordenDeCargue = orderToDelete.ordendecargue
    console.log("[v0] Order to delete has ordendecargue:", ordenDeCargue)

    // Si es una orden de Cargue (madre), borra primero sus clones automáticos
    // (o bloquea si alguno ya fue procesado). Los demás tipos (Descargue,
    // Distribucion, Tolva...) no disparan esta cascada.
    if (orderToDelete.tipooperacion === "Cargue") {
      const cascada = await eliminarClonesDeCargue(supabase, ordenDeCargue)
      if (!cascada.success) {
        return cascada
      }
    }

    // Step 2: Delete all associated lines in detalleoc where idorden = orderId
    const { error: detailsDeleteError } = await supabase.from("detalleoc").delete().eq("idorden", orderId)

    if (detailsDeleteError) {
      console.error("[v0] Error deletingdetalleoc:", detailsDeleteError)
      return { success: false, message: "Error al eliminar detalles de la orden" }
    }

    console.log("[v0] Deleteddetalleoc records for order:", orderId)

    // Step 3: Delete the line from cabeceraoc
    const { error: headerDeleteError } = await supabase.from("cabeceraoc").delete().eq("id", orderId)

    if (headerDeleteError) {
      console.error("[v0] Error deleting cabeceraoc:", headerDeleteError)
      return { success: false, message: "Error al eliminar cabecera de la orden" }
    }

    console.log("[v0] Deleted cabeceraoc record for order:", orderId)

    // Step 4: Clear fields in pedidoscabecera where ocargue matches ordenDeCargue.
    // `estado` vuelve a "aprobado" (no a null): un pedido SIEMPRE pasa por
    // approveOrder ("aprobado") ANTES de poder entrar a generateLoadOrder
    // (que le asigna `ocargue` y, si sus líneas quedan cerradas, lo marca
    // "entregado"/"parcial" vía checkAndUpdatePedidoCabeceraStatus). Si esta
    // orden se elimina — típicamente por error humano después de finalizar
    // el vehículo — el pedido debe recuperar exactamente ESE estado previo
    // ("aprobado", listo para volver a cargarse), no quedar en null (que en
    // otras pantallas significa "recién creado, nunca aprobado") ni seguir
    // marcado "entregado" de una entrega que nunca ocurrió porque la orden
    // se borró.
    const { error: pedidosUpdateError } = await supabase
      .from("pedidoscabecera")
      .update({
        ocargue: null,
        estado: "aprobado",
        vehiculo: null,
        transporte: null,
        fechaordencargue: null,
        fechadeentrega: null,
      })
      .eq("ocargue", ordenDeCargue)

    if (pedidosUpdateError) {
      console.error("[v0] Error updating pedidoscabecera:", pedidosUpdateError)
      return { success: false, message: "Error al actualizar pedidos relacionados" }
    }

    console.log("[v0] Cleared fields in pedidoscabecera for ocargue:", ordenDeCargue)

    const { error: pedidosDetalleUpdateError } = await supabase
      .from("pedidosdetalle")
      .update({
        ocargue: null,
        unidades_cargadas: null,
        unidadescargadas: null,
        estado: null,
      })
      .eq("ocargue", ordenDeCargue)

    if (pedidosDetalleUpdateError) {
      console.error("[v0] Error updating pedidosdetalle:", pedidosDetalleUpdateError)
      return { success: false, message: "Error al actualizar detalles de pedidos relacionados" }
    }

    console.log("[v0] Cleared fields in pedidos detalle for ocargue:", ordenDeCargue)

    const { error: citasUpdateError } = await supabase
      .from("citasvehiculos")
      .update({
        ocargue: null,
        estatus: null,
      })
      .eq("ocargue", ordenDeCargue)

    if (citasUpdateError) {
      console.error("[v0] Error updating citasvehiculos:", citasUpdateError)
      return { success: false, message: "Error al actualizar citas de vehículos relacionadas" }
    }

    console.log("[v0] Cleared fields in citasvehiculos for ocargue:", ordenDeCargue)

    revalidatePath("/dashboard/orders/load-orders")

    return { success: true, message: "Orden de cargue eliminada exitosamente" }
  } catch (error) {
    console.error("[v0] Error deleting load order:", error)
    return { success: false, message: "Error inesperado al eliminar la orden de cargue" }
  }
}

// Verifica la autorización de CARTERA y devuelve el nombre de quien autoriza.
// SQL 203: clave PERSONAL con el proceso `ped_aprobar_cartera` en el proyecto
// del pedido (perfil "Cartera"). Las contraseñas de `usuariocartera` siguen
// valiendo solo durante la transición.
export async function verifyCarteraPassword(password: string, idpedido?: number | null) {
  try {
    let idempresa: number | null = null
    if (idpedido) {
      const supabase = await createClient()
      const { data } = await supabase.from("pedidoscabecera").select("id_empresa").eq("idpedido", idpedido).maybeSingle()
      idempresa = data?.id_empresa ?? null
    }
    const auth = await autorizar({
      proceso: "ped_aprobar_cartera",
      idempresa,
      clave: password,
      referencia: idpedido ? `cartera pedido ${idpedido}` : "cartera",
    })
    if (!auth.ok) {
      return { success: false, message: auth.error || "Contraseña de cartera inválida" }
    }
    return { success: true, nombre: auth.autorizadoPor, message: "Contraseña válida" }
  } catch (error) {
    console.error("[v0] Error verifying cartera password:", error)
    return { success: false, message: "Error al verificar contraseña" }
  }
}

// New function to update pedido with revisioncartera
export async function approveCartera(idpedido: number, nombreCartera: string) {
  const supabase = await createClient()
  try {
    console.log("[v0] Approving cartera for pedido:", idpedido, "with nombre:", nombreCartera)

    const { error } = await supabase
      .from("pedidoscabecera")
      .update({ revisioncartera: nombreCartera })
      .eq("idpedido", idpedido)

    if (error) {
      console.error("[v0] Error updating revisioncartera:", error)
      return { success: false, message: "Error al actualizar aprobación de cartera" }
    }

    return { success: true, message: "Aprobación de cartera registrada exitosamente" }
  } catch (error) {
    console.error("[v0] Error approving cartera:", error)
    return { success: false, message: "Error inesperado al aprobar cartera" }
  }
}

export async function addProductsToOrder(idpedido: number, productsToInsert: any[]) {
  const supabase = await createClient()
  try {
    const empresaId = await getCurrentEmpresaIdForInsert()

    // Fetch the last transid to correctly generate new ones
    const { data: lastDetail } = await supabase
      .from("pedidosdetalle")
      .select("transid")
      .order("transid", { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextTransId = 1
    if (lastDetail) {
      nextTransId = (lastDetail.transid || 0) + 1
    }

    const detailsToInsert = productsToInsert.map((product, index) => ({
      transid: nextTransId + index,
      idpedido: idpedido,
      id_empresa: empresaId, // Use dynamic empresa ID
      producto: product.producto,
      unidades: product.cantidad,
      precio_und: product.precioUnitario,
      total_linea: product.totalLinea,
      iva: product.descuentoIVA,
      descuentopp: product.descuentoPP,
      subtotal: product.subtotal,
      peso: product.peso,
      categoria: product.categoria,
    }))

    const { error: insertError } = await supabase.from("pedidosdetalle").insert(detailsToInsert)

    if (insertError) {
      console.error("Error inserting new products:", insertError)
      return { success: false, message: "Error al agregar nuevos productos al pedido" }
    }

    revalidatePath(`/dashboard/orders/${idpedido}`)

    return { success: true, message: "Productos agregados exitosamente" }
  } catch (error) {
    console.error("Unexpected error in addProductsToOrder:", error)
    return { success: false, message: "Error inesperado al agregar productos al pedido" }
  }
}

export async function generateUnloadOrder(orderData: {
  selectedEmpresaId?: number
  fechaDescargue: string
  placa: string
  nombreConductor?: string | null
  transporte: string
  tiquete: string
  numeroOrden: string
  pesoBascula: number
  lineas: Array<{
    id: string
    producto?: { id: number; nombre: string; peso_unitkg: number; pesobruto?: number }
    lote?: string | null
    cantidad: number
    pesoBrutoTotal?: number
  }>
  pesoTotalOrden: number
  pesoBrutoTotalOrden?: number
  // Confirmación explícita de que ya se avisó de un posible duplicado y el
  // coordinador quiere crear el Descargue de todos modos (ver chequeo abajo).
  forzarDuplicado?: boolean
}) {
  const supabase = await createClient()

  try {
    console.log("[v0] Generating unload order with data:", orderData)

    // Empresa del SELECTOR GLOBAL manda (el usuario puede estar digitando una
    // orden para un proyecto distinto al de su empresa de perfil, ej. terceros
    // en ID4 mientras su perfil por defecto es otra empresa). Fallback a la
    // empresa de sesión solo si el selector no vino en el payload.
    const sessionEmpresaId = orderData.selectedEmpresaId ?? (await getCurrentEmpresaId())

    if (!sessionEmpresaId) {
      console.error("[v0] Could not get session empresa ID")
      return { success: false, message: "Error al obtener la empresa de la sesión" }
    }

    console.log("[v0] Using empresa ID from session:", sessionEmpresaId)

    // Get indicativo
    const { data: indicativoData, error: indicativoError } = await supabase
      .from("indicativo")
      .select("id, indicativo")
      .eq("id", sessionEmpresaId)
      .maybeSingle()

    let indicativo = "IND" // Default fallback value

    if (indicativoError) {
      console.error("[v0] Error fetching indicativo:", indicativoError.message)
    } else if (!indicativoData) {
      console.warn("[v0] No indicativo record found with ID:", sessionEmpresaId)
    } else if (!indicativoData.indicativo) {
      console.warn("[v0] Indicativo record found but indicativo field is null/empty")
    } else {
      indicativo = indicativoData.indicativo
      console.log("[v0] Successfully found indicativo:", indicativo)
    }

    // Get next ID
    const { data: lastHeader, error: lastHeaderError } = await supabase
      .from("cabeceraoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastHeaderError) {
      console.error("[v0] Error fetching last header ID:", lastHeaderError)
      return { success: false, message: "Error al obtener último ID de cabecera" }
    }

    const nextId = lastHeader ? (lastHeader.id || 0) + 1 : 1
    console.log("[v0] Next ID will be:", nextId)

    // Generate order code
    const colombiaTime = await getColombiaDateTime()
    const year = colombiaTime.getFullYear()
    const month = String(colombiaTime.getMonth() + 1).padStart(2, "0")
    const day = String(colombiaTime.getDate()).padStart(2, "0")
    const orderCode = `${indicativo}${year}${month}${day}${nextId}`

    console.log("[v0] Generated order code:", orderCode)

    const currentDate = await getColombiaDate()
    const currentTime = await getColombiaTime()
    const fechaDescargueFormatted = await dateInputToColombiaDate(orderData.fechaDescargue)

    // Blindaje 2026-09-23 (incidente Cedi Funza: un coordinador generó un
    // Descargue manual para un camión que YA tenía su clon automático desde
    // Avimol -- duplicó el registro, dobló el pago de nómina a los mismos
    // auxiliares, y "tapó" el inventario con un ajuste 702 que no arregló
    // nada). El clon automático (autoGenerarDescarguesCedi) sí se protege a
    // sí mismo por `ordenorigen`, pero el formulario manual nunca cruzaba
    // contra eso. Aviso, no bloqueo duro (decisión del cliente): si ya existe
    // un Descargue para esta placa el mismo día en este proyecto, se avisa
    // ANTES de crear -- el coordinador puede confirmar si de verdad es una
    // segunda entrega real del mismo camión el mismo día.
    if (!orderData.forzarDuplicado) {
      const { data: existentes } = await supabase
        .from("cabeceraoc")
        .select("id, ordendecargue, tiquetebascula, pesovascula, horaorden")
        .eq("idempresa", sessionEmpresaId)
        .eq("tipooperacion", "Descargue")
        .eq("placa", orderData.placa)
        .eq("fechacargue", fechaDescargueFormatted)
      if (existentes && existentes.length > 0) {
        const detalle = existentes
          .map((o: any) => `orden ${o.ordendecargue} (tiquete ${o.tiquetebascula || "—"}, ${o.pesovascula ?? "—"} ton, ${o.horaorden || ""})`)
          .join("; ")
        return {
          success: false,
          duplicado: true,
          message: `Ya existe ${existentes.length === 1 ? "un Descargue" : `${existentes.length} Descargues`} para la placa ${orderData.placa} el ${orderData.fechaDescargue}: ${detalle}. ¿Seguro que quieres crear otro?`,
          existentes,
        }
      }
    }

    // Mismo caso que en la orden de cargue: el vehiculo pudo inspeccionarse
    // antes de que existiera la orden, y esa hora hay que conservarla.
    const horaSanitariaDesc = await resolverHoraSanitaria(supabase, orderData.placa, currentDate)
    if (horaSanitariaDesc.hora) {
      console.log("[v0] Hora sanitaria recuperada para el descargue:", horaSanitariaDesc.hora)
    }

    // Productos por UNIDAD (ej. Huevo/Avimol, $2,95 c/u) NO se dividen entre
    // 1000 -- esa división es la conversión kg->toneladas y este producto no
    // se mide en peso. Se consulta subcategoria fresca desde `productos` (no
    // se confía en el payload del cliente) para reusar la misma regla que ya
    // gobierna la facturación (`esProductoPorUnidad`), sin reimplementarla.
    const lineasValidas = orderData.lineas.filter((line) => line.cantidad > 0 && line.producto)
    const nombresProductos = Array.from(new Set(lineasValidas.map((l) => l.producto!.nombre)))
    const subcategoriaPorNombre: Record<string, string | null> = {}
    if (nombresProductos.length > 0) {
      const { data: productosData } = await supabase.from("productos").select("nombre,subcategoria").in("nombre", nombresProductos)
      for (const p of productosData ?? []) subcategoriaPorNombre[p.nombre] = p.subcategoria ?? null
    }
    const esLineaPorUnidad = lineasValidas.map((line) => esProductoPorUnidad(subcategoriaPorNombre[line.producto!.nombre]))
    const toneladasPorLinea = lineasValidas.map((line, idx) =>
      esLineaPorUnidad[idx] ? line.cantidad : (line.cantidad * line.producto!.peso_unitkg) / 1000,
    )
    // Si NINGUNA línea es por unidad, el encabezado se calcula EXACTAMENTE
    // igual que antes (a partir del total que manda el cliente) -- cero
    // cambio de comportamiento para el resto de productos. Solo cuando hay
    // una línea por unidad se recalcula sumando línea por línea (necesario
    // para no dividir esa línea entre 1000).
    const pesoOrdenAjustado = esLineaPorUnidad.some(Boolean)
      ? toneladasPorLinea.reduce((s, t) => s + t, 0)
      : orderData.pesoTotalOrden / 1000

    // Insert into cabeceraoc with tipooperacion = "Descargue"
    const { error: headerInsertError } = await supabase.from("cabeceraoc").insert({
      id: nextId,
      idempresa: sessionEmpresaId,
      ordendecargue: orderData.numeroOrden || orderCode,
      fechaorden: currentDate,
      placa: orderData.placa,
      conductor: orderData.nombreConductor || null,
      transporte: orderData.transporte,
      tiquetebascula: orderData.tiquete,
      tipooperacion: "Descargue",
      pesoorden: pesoOrdenAjustado, // Productos por unidad ya vienen sin dividir; el resto conserva /1000
      horaorden: currentTime,
      horalote: currentTime,
      horavehiculo: currentTime,
      horasanitario: horaSanitariaDesc.hora,
      fechacargue: fechaDescargueFormatted,
      pesovascula: orderData.pesoBascula,
    })

    if (headerInsertError) {
      console.error("[v0] Error inserting cabeceraoc:", headerInsertError)
      return { success: false, message: `Error al crear cabecera: ${headerInsertError.message}` }
    }

    console.log("[v0] Cabeceraoc inserted successfully")

    await vincularRegistroSanitario(
      supabase, horaSanitariaDesc.registroId, orderData.numeroOrden || orderCode,
    )

    // Get next detail ID
    const { data: lastDetail, error: lastDetailError } = await supabase
      .from("detalleoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastDetailError) {
      console.error("[v0] Error fetching last detail ID:", lastDetailError)
      return { success: false, message: "Error al obtener último ID de detalle" }
    }

    let nextDetailId = lastDetail ? (lastDetail.id || 0) + 1 : 1
    console.log("[v0] Next detail ID will be:", nextDetailId)

    // Insert detail lines
    const detailsToInsert = lineasValidas.map((line, idx) => ({
      id: nextDetailId++,
      idorden: nextId,
      numeroorden: (orderData as any).numeroOrden || orderCode,
      producto: line.producto!.nombre,
      cantidad: line.cantidad,
      toneladas: toneladasPorLinea[idx],
      cliente: "",
      lote: line.lote || null,
    }))

    console.log("[v0] Inserting", detailsToInsert.length, "detail records")

    if (detailsToInsert.length > 0) {
      const { error: detailsInsertError } = await supabase.from("detalleoc").insert(detailsToInsert)

      if (detailsInsertError) {
        console.error("[v0] Error inserting detalleoc:", detailsInsertError)
        return { success: false, message: `Error al crear detalles: ${detailsInsertError.message}` }
      }

      console.log("[v0] Detalleoc inserted successfully")
    }

    // Generate PDF and upload it
    const pdfResult = await generateAndUploadUnloadOrderPDF({
      orderId: nextId,
      orderCode,
      empresaId: sessionEmpresaId,
      fecha: `${currentDate} ${currentTime}`,
      placa: orderData.placa,
      transporte: orderData.transporte,
      productsList: orderData.lineas
        .filter((line) => line.cantidad > 0 && line.producto)
        .map((line) => ({
          producto: line.producto!.nombre,
          cantidad: line.cantidad,
          pesoKgs: line.cantidad * line.producto!.peso_unitkg,
          pesoBrutoKgs: line.pesoBrutoTotal || 0,
        })),
      totalPesoKgs: orderData.pesoTotalOrden,
      totalPesoBrutoKgs: orderData.pesoBrutoTotalOrden || 0,
    })

    if (!pdfResult.success) {
      console.error("Failed to generate and upload PDF:", (pdfResult as any).message)
    } else {
      console.log("PDF generated and uploaded successfully:", pdfResult.url)
      // Update cabeceraoc with the PDF URL
      await supabase.from("cabeceraoc").update({ pdfoc: pdfResult.url }).eq("id", nextId)
    }

    revalidatePath("/dashboard/orders")

    return {
      success: true,
      message: "Orden de descargue generada exitosamente",
      orderId: nextId,
      orderCode,
    }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado al generar orden de descargue" }
  }
}

export async function generateDistributionOrder(orderData: {
  selectedEmpresaId?: number
  fechaDistribucion: string
  placa: string
  transporte: string
  tiquete: string
  numeroOrden: string
  pesoBascula: number
  lineas: Array<{
    id: string
    producto?: { id: number; nombre: string; peso_unitkg: number; pesobruto?: number }
    cantidad: number
    pesoBrutoTotal?: number
  }>
  pesoTotalOrden: number
  pesoBrutoTotalOrden?: number
}) {
  const supabase = await createClient()

  try {
    console.log("[v0] Generating distribution order with data:", orderData)

    // Empresa del SELECTOR GLOBAL manda (mismo criterio que generateUnloadOrder).
    const sessionEmpresaId = orderData.selectedEmpresaId ?? (await getCurrentEmpresaId())

    if (!sessionEmpresaId) {
      console.error("[v0] Could not get session empresa ID")
      return { success: false, message: "Error al obtener la empresa de la sesión" }
    }

    console.log("[v0] Using empresa ID from session:", sessionEmpresaId)

    // Get indicativo
    const { data: indicativoData, error: indicativoError } = await supabase
      .from("indicativo")
      .select("id, indicativo")
      .eq("id", sessionEmpresaId)
      .maybeSingle()

    let indicativo = "IND" // Default fallback value

    if (indicativoError) {
      console.error("[v0] Error fetching indicativo:", indicativoError.message)
    } else if (!indicativoData) {
      console.warn("[v0] No indicativo record found with ID:", sessionEmpresaId)
    } else if (!indicativoData.indicativo) {
      console.warn("[v0] Indicativo record found but indicativo field is null/empty")
    } else {
      indicativo = indicativoData.indicativo
      console.log("[v0] Successfully found indicativo:", indicativo)
    }

    // Get next ID
    const { data: lastHeader, error: lastHeaderError } = await supabase
      .from("cabeceraoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastHeaderError) {
      console.error("[v0] Error fetching last header ID:", lastHeaderError)
      return { success: false, message: "Error al obtener último ID de cabecera" }
    }

    const nextId = lastHeader ? (lastHeader.id || 0) + 1 : 1
    console.log("[v0] Next ID will be:", nextId)

    // Generate order code
    const colombiaTime = await getColombiaDateTime()
    const year = colombiaTime.getFullYear()
    const month = String(colombiaTime.getMonth() + 1).padStart(2, "0")
    const day = String(colombiaTime.getDate()).padStart(2, "0")
    const orderCode = `${indicativo}${year}${month}${day}${nextId}`

    console.log("[v0] Generated order code:", orderCode)

    const currentDate = await getColombiaDate()
    const currentTime = await getColombiaTime()
    const fechaDistribucionFormatted = await dateInputToColombiaDate(orderData.fechaDistribucion)

    // Insert into cabeceraoc with tipooperacion = "Distribución"
    // El usuario ahora ingresa pesoBascula directamente en TONELADAS desde el UI,
    // por lo que ya no se divide por 1000 al persistir.
    const pesoBasculaTons = orderData.pesoBascula

    // Igual que en cargue y descargue: si el vehiculo se inspecciono antes de
    // que existiera la orden, esa hora tiene que viajar a la cabecera.
    const horaSanitariaDist = await resolverHoraSanitaria(supabase, orderData.placa, currentDate)
    if (horaSanitariaDist.hora) {
      console.log("[v0] Hora sanitaria recuperada para la distribucion:", horaSanitariaDist.hora)
    }

    const { error: headerInsertError } = await supabase.from("cabeceraoc").insert({
      id: nextId,
      idempresa: sessionEmpresaId,
      ordendecargue: orderData.numeroOrden || orderCode,
      fechaorden: currentDate,
      placa: orderData.placa,
      transporte: orderData.transporte,
      tiquetebascula: orderData.tiquete,
      tipooperacion: "Distribucion",
      pesoorden: pesoBasculaTons, // ya en toneladas
      horaorden: currentTime,
      horalote: currentTime,
      horavehiculo: currentTime,
      horasanitario: horaSanitariaDist.hora,
      fechacargue: fechaDistribucionFormatted,
      pesovascula: pesoBasculaTons, // ya en toneladas
    })

    if (headerInsertError) {
      console.error("[v0] Error inserting cabeceraoc:", headerInsertError)
      return { success: false, message: `Error al crear cabecera: ${headerInsertError.message}` }
    }

    console.log("[v0] Cabeceraoc inserted successfully")

    // Get next detail ID
    const { data: lastDetail, error: lastDetailError } = await supabase
      .from("detalleoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastDetailError) {
      console.error("[v0] Error fetching last detail ID:", lastDetailError)
      return { success: false, message: "Error al obtener último ID de detalle" }
    }

    let nextDetailId = lastDetail ? (lastDetail.id || 0) + 1 : 1
    console.log("[v0] Next detail ID will be:", nextDetailId)

    // Insert detail lines
    const detailsToInsert = orderData.lineas
      .filter((line) => line.cantidad > 0 && line.producto)
      .map((line) => ({
        id: nextDetailId++,
        idorden: nextId,
        numeroorden: (orderData as any).numeroOrden || orderCode,
        producto: line.producto!.nombre,
        cantidad: line.cantidad,
        toneladas: (line.cantidad * line.producto!.peso_unitkg) / 1000,
        cliente: "",
      }))

    console.log("[v0] Inserting", detailsToInsert.length, "detail records")

    if (detailsToInsert.length > 0) {
      const { error: detailsInsertError } = await supabase.from("detalleoc").insert(detailsToInsert)

      if (detailsInsertError) {
        console.error("[v0] Error inserting detalleoc:", detailsInsertError)
        return { success: false, message: `Error al crear detalles: ${detailsInsertError.message}` }
      }

      console.log("[v0] Detalleoc inserted successfully")
    }

    // Update citasvehiculos estatus to "Procesado" for the selected vehicle
    const { error: vehicleUpdateError } = await supabase
      .from("citasvehiculos")
      .update({ estatus: "Procesado" })
      .eq("placa", orderData.placa)
      .eq("idempresa", sessionEmpresaId)
      .is("estatus", null)

    if (vehicleUpdateError) {
      console.error("[v0] Error updating vehicle status:", vehicleUpdateError)
      // Don't fail the order creation, just log the error
    } else {
      console.log("[v0] Vehicle status updated to Procesado for placa:", orderData.placa)
    }

    revalidatePath("/dashboard/orders")

    return {
      success: true,
      message: "Orden de distribución generada exitosamente",
      orderId: nextId,
      orderCode,
    }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return { success: false, message: "Error inesperado al generar orden de distribución" }
  }
}

async function generateAndUploadUnloadOrderPDF(data: {
  orderId: number
  orderCode: string
  empresaId: number
  fecha: string
  placa: string
  transporte: string
  productsList: Array<{ producto: string; cantidad: number; pesoKgs: number; pesoBrutoKgs: number }>
  totalPesoKgs: number
  totalPesoBrutoKgs: number
}) {
  try {
    // Import dinámico de jsPDF (mismo patrón que pdf-actions). Antes faltaba y
    // esta función lanzaría ReferenceError en runtime al generar el PDF.
    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF()

    // Header - Title
    doc.setFontSize(16)
    doc.setTextColor(44, 82, 130)
    doc.setFont(undefined as any, "bold")
    doc.text("ORDEN DE DESCARGUE", 105, 15, { align: "center" })

    // Order information header
    let y = 25
    doc.setFontSize(10)
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")

    // Orden
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 40, 6, "F")
    doc.text("Orden", 17, y + 4)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(55, y, 55, 6, "F")
    doc.text(data.orderCode, 57, y + 4)

    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(110, y, 40, 6, "F")
    doc.text("Fecha", 112, y + 4)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(150, y, 45, 6, "F")
    doc.text(data.fecha, 152, y + 4)

    // Placa
    y += 8
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 40, 6, "F")
    doc.text("Placa", 17, y + 4)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(55, y, 55, 6, "F")
    doc.text(data.placa, 57, y + 4)

    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(110, y, 40, 6, "F")
    doc.text("Transporte", 112, y + 4)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(150, y, 45, 6, "F")
    doc.text(data.transporte, 152, y + 4)

    // Products table header
    y += 12
    doc.setFillColor(100, 100, 100)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 75, 6, "F")
    doc.rect(90, y, 25, 6, "F")
    doc.rect(115, y, 40, 6, "F")
    doc.rect(155, y, 40, 6, "F")

    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("Producto", 17, y + 4)
    doc.text("Cantidad", 102, y + 4, { align: "center" })
    doc.text("Peso (Kg)", 135, y + 4, { align: "center" })
    doc.text("P. Bruto (Kg)", 175, y + 4, { align: "center" })

    // Products table body
    y += 7
    doc.setFontSize(8)
    doc.setFont(undefined as any, "normal")
    doc.setTextColor(0, 0, 0)
    doc.setDrawColor(200, 200, 200)

    data.productsList.forEach((item) => {
      if (y > 270) {
        doc.addPage()
        y = 15
      }

      doc.rect(15, y, 75, 6, "S")
      doc.rect(90, y, 25, 6, "S")
      doc.rect(115, y, 40, 6, "S")
      doc.rect(155, y, 40, 6, "S")

      doc.text(item.producto.substring(0, 40), 17, y + 4)
      doc.text(String(item.cantidad), 102, y + 4, { align: "center" })
      doc.text(item.pesoKgs.toFixed(2), 135, y + 4, { align: "center" })
      doc.text(item.pesoBrutoKgs.toFixed(2), 175, y + 4, { align: "center" })

      y += 6
    })

    // Add empty rows for consistency
    const minRows = 8
    const currentRows = data.productsList.length
    if (currentRows < minRows) {
      for (let i = 0; i < minRows - currentRows; i++) {
        if (y > 270) {
          doc.addPage()
          y = 15
        }
        doc.rect(15, y, 75, 6, "S")
        doc.rect(90, y, 25, 6, "S")
        doc.rect(115, y, 40, 6, "S")
        doc.rect(155, y, 40, 6, "S")
        y += 6
      }
    }

    // Totals row
    y += 2
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 75, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("TOTALES", 17, y + 4)

    doc.setFillColor(255, 255, 255)
    doc.setTextColor(0, 0, 0)
    doc.rect(90, y, 25, 6, "FD")
    doc.text(String(data.productsList.length), 102, y + 4, { align: "center" })

    doc.setFillColor(255, 255, 255)
    doc.rect(115, y, 40, 6, "FD")
    doc.text(data.totalPesoKgs.toFixed(2), 135, y + 4, { align: "center" })

    doc.setFillColor(255, 255, 255)
    doc.rect(155, y, 40, 6, "FD")
    doc.text(data.totalPesoBrutoKgs.toFixed(2), 175, y + 4, { align: "center" })

    console.log("[v0] PDF generated, creating blob...")

    // Generate PDF blob
    const pdfBlob = doc.output("blob")
    const fileName = `${data.orderCode}.pdf`

    console.log("[v0] Uploading PDF to Supabase storage...")

    // Get admin client
    const supabaseAdmin = await getSupabaseAdmin()

    // Upload to Supabase storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(`doccargue/${fileName}`, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (uploadError) {
      console.error("[v0] Error uploading unload order PDF:", uploadError)
      return { success: false, message: "Error al cargar PDF" }
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from("archivos").getPublicUrl(`doccargue/${fileName}`)

    console.log("[v0] Unload order PDF uploaded successfully:", publicUrl)

    return { success: true, url: publicUrl }
  } catch (error) {
    console.error("[v0] Error generating PDF:", error)
    return { success: false, message: "Error al generar PDF" }
  }
}


export async function createSanitaryRegister(data: any) {
  const supabase = await createClient()
  try {
    const empresaId = await getCurrentEmpresaIdForInsert()

    // Fetch the last ID to correctly generate new ones
    const { data: maxIdData, error: maxIdError } = await supabase
      .from("registrosanitario")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)

    if (maxIdError) {
      console.error("Error fetching max ID for sanitary registry:", maxIdError)
      return { success: false, message: maxIdError.message }
    }

    const nextId = maxIdData && maxIdData.length > 0 ? maxIdData[0].id + 1 : 1

    const { error: insertError } = await supabase.from("registrosanitario").insert({
      id: nextId,
      idempresa: empresaId, // Use dynamic empresa ID
      ordencargue: data.isVehicleOnly ? null : data.ordencargue,
      placa: data.placa,
      conductor: data.conductor,
      producto: data.producto,
      carpas: data.carpas,
      limpieza: data.limpieza,
      olores: data.olores,
      plastico: data.plastico,
      fumigacion: data.fumigacion,
      plaguicida: data.plaguicida,
      observaciones: data.observaciones,
      fumigador: data.fumigador,
      auxiliar: data.auxiliar,
      foto: data.foto || null,
      aprobacion: data.aprobacion || "aprobado",
      fecha: data.fecha, // Assuming data.fecha is already in YYYY-MM-DD format
      horaregistro: data.hora, // Assuming data.hora is already in HH:MM:SS format
    })

    if (insertError) {
      console.error("Error inserting sanitary registry:", insertError)
      return { success: false, message: insertError.message }
    }

    console.log("[v0] Sanitary verification registered successfully with ID:", nextId)
    return {
      success: true,
      message: "Registro sanitario creado exitosamente",
      id: nextId,
    }
  } catch (error) {
    console.error("Unexpected error in createSanitaryRegister:", error)
    return { success: false, message: "Error inesperado al crear registro sanitario" }
  }
}

export async function saveTolva(tolvaData: {
  fechaFabricacion: string
  lote: string
  empleados: Array<{ id: number; nombreempleado: string }>
  productos: Array<{
    id: string
    producto?: { id: number; nombre: string; peso_unitkg: number }
    cantidad: number
  }>
  selectedEmpresaId?: number
}) {
  const supabase = await createClient()

  try {
    console.log("[v0] Tolva: Saving tolva with data:", tolvaData)

    // Empresa del SELECTOR GLOBAL manda.
    const empresaId = tolvaData.selectedEmpresaId ?? (await getCurrentEmpresaId())

    if (!empresaId) {
      console.error("[v0] Could not get session empresa ID")
      return { success: false, message: "Error al obtener la empresa de la sesión" }
    }

    // Get next ID for cabeceraoc
    const { data: lastHeader, error: lastHeaderError } = await supabase
      .from("cabeceraoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastHeaderError) {
      console.error("[v0] Error fetching last header ID:", lastHeaderError)
      return { success: false, message: "Error al obtener último ID de cabecera" }
    }

    const nextId = lastHeader ? (lastHeader.id || 0) + 1 : 1

    // Get Colombia date
    const colombiaDate = await getColombiaDate()
    
    // Get current time in HH:MM:SS format
    const now = new Date()
    const hours = String(now.getHours()).padStart(2, "0")
    const minutes = String(now.getMinutes()).padStart(2, "0")
    const seconds = String(now.getSeconds()).padStart(2, "0")
    const timeOnlyStr = `${hours}:${minutes}:${seconds}`

    // Calculate total weight
    const pesoTotal = tolvaData.productos.reduce((sum, line) => {
      if (line.producto && line.cantidad > 0) {
        return sum + line.cantidad * line.producto.peso_unitkg
      }
      return sum
    }, 0)

    // Format employee names as comma-separated string
    const empleadosStr = tolvaData.empleados.map((e) => e.nombreempleado).join(", ")

    // Determinar tipooperacion segun el dia de la semana de la fecha
    // de fabricacion: si cae en domingo se marca como "Tolva f"
    // (festivo / fin de semana), de lo contrario "Tolva". La fecha
    // viene como "YYYY-MM-DD" — la construimos con `new Date(y, m-1, d)`
    // para evitar el desfase de un dia que produce `new Date("YYYY-MM-DD")`
    // al interpretarse como UTC (un domingo en Bogota podria leerse
    // como sabado en UTC y al reves).
    let tipoOperacionTolva: "Tolva" | "Tolva f" = "Tolva"
    if (typeof tolvaData.fechaFabricacion === "string") {
      const parts = tolvaData.fechaFabricacion.split("-")
      if (parts.length === 3) {
        const y = Number(parts[0])
        const m = Number(parts[1])
        const d = Number(parts[2])
        if (
          Number.isFinite(y) &&
          Number.isFinite(m) &&
          Number.isFinite(d)
        ) {
          // getDay(): 0 = domingo, 1 = lunes, ..., 6 = sabado.
          const dow = new Date(y, m - 1, d).getDay()
          if (dow === 0) {
            tipoOperacionTolva = "Tolva f"
          }
        }
      }
    }
    console.log(
      "[v0] Tolva tipooperacion para fecha",
      tolvaData.fechaFabricacion,
      "=",
      tipoOperacionTolva,
    )

    // Insert into cabeceraoc
    const { error: headerInsertError } = await supabase.from("cabeceraoc").insert({
      id: nextId,
      idempresa: empresaId,
      ordendecargue: `Tolva${nextId}`,
      fechaorden: tolvaData.fechaFabricacion,
      tipooperacion: tipoOperacionTolva,
      auxiliares: empleadosStr,
      status: "finalizado",
      pesoorden: pesoTotal / 1000,
      pesovascula: pesoTotal / 1000,
      fechacargue: tolvaData.fechaFabricacion,
      fincargue: timeOnlyStr,
      horalote: timeOnlyStr,
    })

    if (headerInsertError) {
      console.error("[v0] Error inserting cabeceraoc:", headerInsertError)
      return { success: false, message: `Error al crear cabecera: ${headerInsertError.message}` }
    }

    console.log("[v0] Tolva cabeceraoc inserted successfully with ID:", nextId)

    // Get next ID for detalleoc
    const { data: lastDetail, error: lastDetailError } = await supabase
      .from("detalleoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastDetailError) {
      console.error("[v0] Error fetching last detail ID:", lastDetailError)
      return { success: false, message: "Error al obtener último ID de detalle" }
    }

    let nextDetailId = lastDetail ? (lastDetail.id || 0) + 1 : 1
    console.log("[v0] Next detail ID will be:", nextDetailId)

    // Insert detail lines into detalleoc
    const detailsToInsert = tolvaData.productos
      .filter((line) => line.cantidad > 0 && line.producto)
      .map((line) => ({
        id: nextDetailId++,
        idorden: nextId,
        numeroorden: `Tolva${nextId}`,
        producto: line.producto!.nombre,
        cantidad: line.cantidad,
        toneladas: (line.cantidad * line.producto!.peso_unitkg) / 1000,
      }))

    console.log("[v0] Inserting", detailsToInsert.length, "detail records")

    if (detailsToInsert.length > 0) {
      const { error: detailsInsertError } = await supabase.from("detalleoc").insert(detailsToInsert)

      if (detailsInsertError) {
        console.error("[v0] Error inserting detalleoc:", detailsInsertError)
        return { success: false, message: `Error al crear detalles: ${detailsInsertError.message}` }
      }

      console.log("[v0] Detalleoc inserted successfully")
    }

    revalidatePath("/dashboard/production")

    return {
      success: true,
      message: "Tolva registrada exitosamente",
      id: nextId,
    }
  } catch (error) {
    console.error("[v0] Error saving tolva:", error)
    return { success: false, message: "Error inesperado al guardar tolva" }
  }
}

export async function saveProyecciones(proyeccionData: {
  fechaFabricacion: string
  productos: Array<{
    id: string
    producto?: { id: number; nombre: string; peso_unitkg: number }
    cantidad: number
  }>
  empleados?: Array<{ nombre: string }>
  /**
   * Empresa seleccionada en la UI (selector del header). Si viene
   * definida, tiene prioridad sobre la empresa por defecto del perfil
   * del usuario. Antes la proyeccion siempre se guardaba con
   * `getCurrentEmpresaId()` (perfil) y los usuarios multi-empresa
   * terminaban grabando en la empresa equivocada al cambiar de
   * empresa en la UI. Mismo patron que `saveOrder` usa con
   * `idempresaSeleccionada`.
   */
  idempresaSeleccionada?: number
}) {
  const supabase = await createClient()

  try {
    console.log("[v0] Proyecciones: Saving proyeccion with data:", proyeccionData)

    // Prioridad: empresa seleccionada en la UI > empresa del perfil.
    // Validamos que sea un numero finito > 0 antes de aceptarla — asi
    // un 0/NaN accidental del cliente no rompe la insercion.
    const empresaSeleccionada =
      typeof proyeccionData.idempresaSeleccionada === "number" &&
      Number.isFinite(proyeccionData.idempresaSeleccionada) &&
      proyeccionData.idempresaSeleccionada > 0
        ? proyeccionData.idempresaSeleccionada
        : null

    const empresaId = empresaSeleccionada ?? (await getCurrentEmpresaId())

    if (!empresaId) {
      console.error("[v0] Could not get session empresa ID")
      return { success: false, message: "Error al obtener la empresa de la sesión" }
    }

    console.log(
      "[v0] Proyecciones: using empresaId",
      empresaId,
      "(seleccionada:",
      empresaSeleccionada,
      ")",
    )

    // Get next ID for cabeceraoc
    const { data: lastHeader, error: lastHeaderError } = await supabase
      .from("cabeceraoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastHeaderError) {
      console.error("[v0] Error fetching last header ID:", lastHeaderError)
      return { success: false, message: "Error al obtener último ID de cabecera" }
    }

    const nextId = lastHeader ? (lastHeader.id || 0) + 1 : 1

    // Get Colombia date and time
    const colombiaDate = await getColombiaDate()
    const colombiaDateTimeRaw = await getColombiaDateTime()
    
    // Ensure colombiaDateTime is a string before calling split
    const colombiaDateTimeStr = typeof colombiaDateTimeRaw === "string" ? colombiaDateTimeRaw : JSON.stringify(colombiaDateTimeRaw)
    
    // Extract just the time portion (HH:MM:SS) from colombiaDateTime
    const colombiaTimeOnly = colombiaDateTimeStr.split("T")[1]?.split(".")[0] || "00:00:00"

    // Calculate total weight (kg) - allow negative values for adjustments/returns
    const pesoTotalKg = proyeccionData.productos.reduce((sum, line) => {
      if (line.producto && line.cantidad !== 0) {
        return sum + line.cantidad * line.producto.peso_unitkg
      }
      return sum
    }, 0)

    // Format auxiliares from empleados
    const auxiliares = proyeccionData.empleados
      ?.map((emp) => {
        // Use nombreempleado field from Employee interface
        const nombreCompleto = (emp as any).nombreempleado || emp.nombre || ""
        return nombreCompleto
      })
      .filter((name) => name.length > 0) // Remove empty strings
      .join(",") || ""

    // Insert into cabeceraoc with proyecciones-specific data
    const { error: headerInsertError } = await supabase.from("cabeceraoc").insert({
      id: nextId,
      idempresa: empresaId,
      ordendecargue: `proyeccion${nextId}`,
      fechaorden: colombiaDate,
      tipooperacion: "proyeccion",
      pesoorden: pesoTotalKg / 1000,
      pesovascula: pesoTotalKg / 1000,
      status: "finalizado",
      fechacargue: proyeccionData.fechaFabricacion,
      fincargue: colombiaTimeOnly,
      pesajefinal: colombiaTimeOnly,
      auxiliares: auxiliares,
    })

    if (headerInsertError) {
      console.error("[v0] Error inserting cabeceraoc for proyeccion:", headerInsertError)
      return { success: false, message: `Error al crear proyección: ${headerInsertError.message}` }
    }

    console.log("[v0] Proyecciones cabeceraoc inserted successfully with ID:", nextId)

    revalidatePath("/dashboard/operations")

    return {
      success: true,
      message: "Proyección registrada exitosamente",
      id: nextId,
    }
  } catch (error) {
    console.error("[v0] Error saving proyeccion:", error)
    return { success: false, message: "Error inesperado al guardar proyección" }
  }
}

export async function updateTolva(
  tolvaId: number,
  tolvaData: {
    fechaFabricacion: string
    lote: string
    empleados: Array<{ id: number; nombreempleado: string }>
    productos: Array<{
      id: string
      producto?: { id: number; nombre: string; peso_unitkg: number }
      cantidad: number
    }>
  },
) {
  const supabase = await createClient()

  try {
    console.log("[v0] Tolva: Updating tolva ID", tolvaId, "with data:", tolvaData)

    // Calculate total weight
    const pesoTotal = tolvaData.productos.reduce((sum, line) => {
      if (line.producto && line.cantidad > 0) {
        return sum + line.cantidad * line.producto.peso_unitkg
      }
      return sum
    }, 0)

    // Format employee names as comma-separated string
    const empleadosStr = tolvaData.empleados.map((e) => e.nombreempleado).join(", ")

    // Update cabeceraoc
    const { error: headerUpdateError } = await supabase
      .from("cabeceraoc")
      .update({
        auxiliares: empleadosStr,
        pesoorden: pesoTotal / 1000,
        pesovascula: pesoTotal / 1000,
      })
      .eq("id", tolvaId)

    if (headerUpdateError) {
      console.error("[v0] Error updating cabeceraoc:", headerUpdateError)
      return { success: false, message: `Error al actualizar cabecera: ${headerUpdateError.message}` }
    }

    console.log("[v0] Tolva cabeceraoc updated successfully")

    // Delete existing details
    const { error: deleteError } = await supabase.from("detalleoc").delete().eq("idorden", tolvaId)

    if (deleteError) {
      console.error("[v0] Error deleting old details:", deleteError)
      return { success: false, message: `Error al eliminar detalles antiguos: ${deleteError.message}` }
    }

    // Get next detail ID
    const { data: lastDetail, error: lastDetailError } = await supabase
      .from("detalleoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastDetailError) {
      console.error("[v0] Error fetching last detail ID:", lastDetailError)
      return { success: false, message: "Error al obtener último ID de detalle" }
    }

    let nextDetailId = lastDetail ? (lastDetail.id || 0) + 1 : 1

    // Insert new detail lines
    const detailsToInsert = tolvaData.productos
      .filter((line) => line.cantidad > 0 && line.producto)
      .map((line) => ({
        id: nextDetailId++,
        idorden: tolvaId,
        numeroorden: `Tolva${tolvaId}`,
        producto: line.producto!.nombre,
        cantidad: line.cantidad,
        toneladas: (line.cantidad * line.producto!.peso_unitkg) / 1000,
      }))

    console.log("[v0] Inserting", detailsToInsert.length, "new detail records")

    if (detailsToInsert.length > 0) {
      const { error: detailsInsertError } = await supabase.from("detalleoc").insert(detailsToInsert)

      if (detailsInsertError) {
        console.error("[v0] Error inserting detalleoc:", detailsInsertError)
        return { success: false, message: `Error al crear detalles: ${detailsInsertError.message}` }
      }

      console.log("[v0] Detalleoc inserted successfully")
    }

    revalidatePath("/dashboard/production")

    return {
      success: true,
      message: "Tolva actualizada exitosamente",
    }
  } catch (error) {
    console.error("[v0] Error updating tolva:", error)
    return { success: false, message: "Error inesperado al actualizar tolva" }
  }
}

// INGRESO DE PT AL INVENTARIO DEL CEDI desde un DESCARGUE. Los CEDIs (id3/id4) NO
// producen: reciben Producto Terminado de las plantas (o de terceros) vía DESCARGUE. El
// clon de descargue queda para GESTIONAR en Packing (PDF -> Personal -> Fotos); solo
// cuando Packing lo CIERRA (mismo evento que graba `fincargue`, en el modo "finalize" de
// /api/upload-picking-photos) el producto entra a Producción → "Aprobación de ingreso"
// como PENDIENTE por aprobar. Antes de eso el clon es solo un placeholder de producto en
// tránsito y NO debe aparecer ahí (si aparece antes de gestionarse, se pide aprobar el
// ingreso de algo que fisicamente aún no ha llegado):
//   - `invtrans` tipomov="Entrada", status=null (idéntico a un ingreso manual, así el
//     submódulo lo lista solo). Una fila por producto+lote+cantidad.
//   - LOTE: se conserva el de la bodega ORIGEN. Tres fuentes, en este orden:
//     1) TRASLADO entre bodegas -> `despachotraslados` por `ocargue = ordenorigen`,
//        cruzando por producto. Es lo que realmente salio de la bodega.
//     2) Descargue de planta id1/id2 -> el cargue madre (`historicolotes` por
//        producto+cliente).
//     3) `detalleoc.lote` de la PROPIA linea del descargue — lo captura quien
//        genera la orden a mano en "Generar Orden de Descargue" cuando NO viene
//        de un cargue madre en LIPgo (recepciones de terceros, ej. Molinos: sin
//        `ordenorigen`, las dos fuentes anteriores no aplican).
//     Solo si ninguna aplica nace sin lote y se completa manual.
//   - `origen`/`ocargue` = código del descargue → trazabilidad + IDEMPOTENCIA (no duplica).
// A futuro, el QR de la estiba se engancha a ESTA fila (campo `qrestiba`) — NO crea un
// ingreso nuevo, así el producto entra al inventario UNA sola vez.
export async function generarIngresoProduccionDesdeDescargue(supabase: any, orderId: number) {
  try {
    const { data: oh } = await supabase
      .from("cabeceraoc")
      .select("id, idempresa, ordendecargue, ordenorigen, tipooperacion")
      .eq("id", orderId)
      .maybeSingle()
    if (!oh) return
    if (oh.tipooperacion !== "Descargue") return
    if (oh.idempresa !== 3 && oh.idempresa !== 4) return // solo CEDIs receptores de PT

    // Idempotente: si ya se generó el ingreso de este descargue, no repetir.
    const { data: ya } = await supabase
      .from("invtrans").select("id").eq("tipomov", "Entrada").eq("ocargue", oh.ordendecargue).limit(1).maybeSingle()
    if (ya) return

    const { data: det } = await supabase.from("detalleoc").select("producto, cantidad, cliente, lote").eq("idorden", orderId)
    if (!det || det.length === 0) return

    const norm = (s: any) => String(s ?? "").trim().toUpperCase()

    // Lotes del cargue madre por (producto+cliente) — SOLO si viene de planta (ordenorigen).
    const lotesPorLinea = new Map<string, { lote: string; cantidad: number }[]>()
    if (oh.ordenorigen) {
      const { data: hl } = await supabase
        .from("historicolotes").select("producto, cliente, lote, cantidad").eq("ordendecargue", oh.ordenorigen)
      for (const r of hl ?? []) {
        const k = norm(r.producto) + "|" + norm(r.cliente)
        if (!lotesPorLinea.has(k)) lotesPorLinea.set(k, [])
        lotesPorLinea.get(k)!.push({ lote: r.lote, cantidad: Number(r.cantidad) || 0 })
      }
    }

    // TRASLADO ENTRE BODEGAS: los lotes salen de `despachotraslados`, cruzando
    // SOLO por producto.
    //
    // El mapa de `historicolotes` de arriba nunca casa en este flujo: su clave
    // incluye el cliente, y `generateUnloadOrder` escribe el literal
    // "Transferencia interna" en `detalleoc.cliente` (lib/transfer-actions.ts),
    // mientras que `historicolotes.cliente` guarda el cliente real de la
    // asignacion de lotes. Por eso el ingreso nacia siempre sin lote.
    //
    // No se filtra por empresa a proposito: en esa vista la columna `id` hace de
    // idempresa y corresponde a la empresa ORIGEN, mientras que `oh.idempresa` es
    // la RECEPTORA (3 o 4). Filtrar por la receptora no traeria nada. El
    // `ocargue` ya identifica el despacho de forma univoca.
    const lotesPorProducto = new Map<string, { lote: string; cantidad: number }[]>()
    if (oh.ordenorigen) {
      const { data: dt } = await supabase
        .from("despachotraslados").select("nombreproducto, lote, cantidad").eq("ocargue", oh.ordenorigen)
      for (const r of dt ?? []) {
        const lote = String(r.lote ?? "").trim()
        if (!lote) continue
        const k = norm(r.nombreproducto)
        if (!lotesPorProducto.has(k)) lotesPorProducto.set(k, [])
        lotesPorProducto.get(k)!.push({ lote, cantidad: Number(r.cantidad) || 0 })
      }
    }

    // Nombre de producto -> productos (idproducto, codproducto) para la forma estándar.
    const nombres = [...new Set(det.map((d: any) => d.producto).filter(Boolean))]
    const prodByNombre = new Map<string, { id: number; codigo: string }>()
    if (nombres.length) {
      const { data: prods } = await supabase.from("productos").select("id, codigo, nombre").in("nombre", nombres)
      for (const p of prods ?? []) prodByNombre.set(norm(p.nombre), { id: p.id, codigo: p.codigo })
    }

    const creado = await getColombiaDateTime()
    const filas: any[] = []
    for (const d of det) {
      const cant = Number(d.cantidad) || 0
      if (cant <= 0) continue
      const p = prodByNombre.get(norm(d.producto))
      const base = {
        idempresa: oh.idempresa,
        idproducto: p?.id ?? null,
        codproducto: p?.codigo ?? null,
        nombreproducto: d.producto,
        tipomov: "Entrada",
        status: null, // PENDIENTE por aprobar
        origen: `descargue ${oh.ordendecargue}`,
        ocargue: oh.ordendecargue,
        creado,
        creadopor: "Auto (descargue PT)",
      }
      // Orden de preferencia: el despacho del traslado manda sobre el cargue
      // madre, porque es el registro de lo que REALMENTE salio de la bodega.
      const lotes =
        lotesPorProducto.get(norm(d.producto)) ??
        lotesPorLinea.get(norm(d.producto) + "|" + norm(d.cliente))

      if (lotes && lotes.length) {
        // Un ingreso por lote, con su cantidad.
        const sumaLotes = lotes.reduce((s, l) => s + l.cantidad, 0)
        if (sumaLotes !== cant) {
          // Se conservan las cantidades por lote (son el dato real) y se avisa:
          // un descuadre aqui significa que el despacho y el detalle de la orden
          // no cuentan lo mismo, y eso hay que mirarlo.
          console.warn(
            `[ingreso-descargue] ${oh.ordendecargue}: "${d.producto}" suma ${sumaLotes} por lote ` +
              `pero el detalle dice ${cant}. Se usan las cantidades por lote.`,
          )
        }
        for (const l of lotes) filas.push({ ...base, lote: l.lote, cantidad: l.cantidad })
      } else {
        // Sin traslado ni cargue madre: el lote propio de la línea (capturado a
        // mano al generar la orden), si lo hay. Si tampoco, sin lote (manual).
        const loteLinea = String(d.lote ?? "").trim()
        filas.push({ ...base, lote: loteLinea || null, cantidad: cant })
      }
    }
    if (!filas.length) return

    const { data: maxT } = await supabase.from("invtrans").select("id").order("id", { ascending: false }).limit(1).maybeSingle()
    let nid = (maxT?.id || 0) + 1
    const conId = filas.map((f) => ({ ...f, id: nid++ }))
    const { error } = await supabase.from("invtrans").insert(conId)
    if (error) console.error("[ingreso-descargue] error insert invtrans:", error.message)
    else console.log("[ingreso-descargue] ingresos pendientes creados:", conId.length, "para", oh.ordendecargue)
  } catch (e: any) {
    console.error("[ingreso-descargue] excepción (no bloquea el inicio):", e?.message || e)
  }
}

export async function closeOrderWithInvoice(
  idpedido: number,
  factura: string,
  unitsReceived: { transid: number; unidadesRecibidas: number }[],
) {
  const supabase = await createClient()
  try {
    // Get Colombia date
    const colombiaDate = await getColombiaDate()

    // Update pedidosdetalle for each product line
    for (const item of unitsReceived) {
      const { error: detailError } = await supabase
        .from("pedidosdetalle")
        .update({
          unidadescargadas: item.unidadesRecibidas,
          estado: "entregado",
        })
        .eq("transid", item.transid)

      if (detailError) {
        console.error("[v0] Error updating pedidosdetalle:", detailError)
        return {
          success: false,
          message: `Error al actualizar producto: ${detailError.message}`,
        }
      }
    }

    // Update pedidoscabecera
    const { error: headerError } = await supabase
      .from("pedidoscabecera")
      .update({
        ocargue: factura,
        factura: factura,
        fechadeentrega: colombiaDate,
      })
      .eq("idpedido", idpedido)

    if (headerError) {
      console.error("[v0] Error updating pedidoscabecera:", headerError)
      return {
        success: false,
        message: `Error al actualizar cabecera: ${headerError.message}`,
      }
    }

    return {
      success: true,
      message: "Cierre con factura registrado exitosamente",
    }
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return {
      success: false,
      message: "Error inesperado al cerrar con factura",
    }
  }
}

export async function updateLoadOrder(orderId: number, data: Record<string, any>) {
  const supabase = await createClient()
  try {
    // Format fechacargue if it exists in the data
    if (data.fechacargue) {
      data.fechacargue = await dateInputToColombiaDate(data.fechacargue)
    }

    const { error } = await supabase.from("cabeceraoc").update(data).eq("id", orderId)

    if (error) {
      console.error("Error updating load order in cabeceraoc:", error)
      return { success: false, message: error.message }
    }

    return { success: true, message: "Orden actualizada exitosamente" }
  } catch (error) {
    console.error("Unexpected error:", error)
    return { success: false, message: "Error inesperado al actualizar orden de cargue" }
  }
}
