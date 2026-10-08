"use server"

import { createClient } from "@supabase/supabase-js"
import { getCurrentEmpresaId } from "@/lib/company-filter"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// Re-export for backwards compatibility
export { getCurrentEmpresaId }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

export interface Vendedor {
  nombre: string
}

export interface Medio {
  nombre: string
}

export interface Cliente {
  id: number
  nombre: string
  nit?: string | null
}

export interface Destino {
  nombre: string
}

export interface Categoria {
  nombre: string
}

export interface Transporte {
  nombretransporte: string
}

export interface TipoVehiculo {
  nombretipo: string
  capacidad?: number
}

export interface Producto {
  nombre: string
  categoria: string
  peso_unitkg?: number
}

export interface CondicionPago {
  nombrecondicion: string
}

export interface TipoDespacho {
  nombretipodespacho: string
}

export interface Bodega {
  idbodega: number
  nombrebodega: string
  clienteid: number
  ciudad: string
  direccion: string
}

export interface Empresa {
  id: number
  nombre: string
  nit: string
  direccion: string
  logo?: string
}

export interface Owner {
  nombre: string
}

export async function getVendedores(): Promise<Vendedor[]> {
  console.log("[v0] Fetching vendedores from server action")

  try {
    const empresaId = await getCurrentEmpresaIdForInsert()
    console.log("[v0] Filtering vendedores by empresaId:", empresaId)

    const { data, error } = await supabase
      .from("vendedores")
      .select("nombre")
      .eq("id_empresa", empresaId) // Apply empresa filter
      .order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching vendedores:", error)
      return []
    }

    console.log("[v0] Vendedores fetched:", data?.length || 0)
    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getCondicionesPago(): Promise<CondicionPago[]> {
  console.log("[v0] Fetching condiciones de pago from server action")

  try {
    const { data, error } = await supabase
      .from("condicionespago")
      .select("nombrecondicion")
      .order("nombrecondicion", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching condiciones de pago:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getTiposDespacho(): Promise<TipoDespacho[]> {
  console.log("[v0] Fetching tipos de despacho from server action")

  try {
    const { data, error } = await supabase
      .from("tipodespacho")
      .select("nombretipodespacho")
      .order("nombretipodespacho", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching tipos de despacho:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getDestinos(): Promise<Destino[]> {
  console.log("[v0] Fetching destinos from server action")

  try {
    const { data, error } = await supabase.from("destinos").select("nombre").order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching destinos:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getMedios(): Promise<Medio[]> {
  console.log("[v0] Fetching medios from server action")

  try {
    const { data, error } = await supabase.from("medio").select("nombre").order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching medios:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getClientes(selectedEmpresaId?: number): Promise<Cliente[]> {
  console.log("[v0] Fetching clientes from server action")
  const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

  try {
    let query = supabase.from("clientes").select("id, nombre").order("nombre", { ascending: true })

    if (empresaId) {
      query = query.eq("id_empresa", empresaId)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching clientes:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getCategorias(): Promise<Categoria[]> {
  console.log("[v0] Fetching categorias from server action")

  try {
    const { data, error } = await supabase.from("categorias").select("nombre").order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching categorias:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getTransportes(): Promise<Transporte[]> {
  console.log("[v0] Fetching transportes from server action")

  try {
    const { data, error } = await supabase
      .from("transportes")
      .select("nombretransporte")
      .order("nombretransporte", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching transportes:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getTiposVehiculos(): Promise<TipoVehiculo[]> {
  console.log("[v0] Fetching tipos de vehiculos from server action")

  try {
    const { data, error } = await supabase
      .from("tiposvehiculos")
      .select("nombretipo, capacidad")
      .order("nombretipo", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching tipos de vehiculos:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getProductos(): Promise<Producto[]> {
  try {
    const empresaId = await getCurrentEmpresaIdForInsert()

    let query = supabase
      .from("productos")
      .select("nombre, categoria, peso_unitkg")
      .order("nombre", { ascending: true })

    // Only apply empresa filter for company 5 (demo company)
    if (empresaId === 5) {
      query = query.eq("id_empresa", empresaId)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching productos:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getProductWeight(productName: string): Promise<number> {
  console.log("[v0] Fetching product weight for:", productName)

  try {
    // First, try to find the product by name without empresa filter
    const { data, error } = await supabase
      .from("productos")
      .select("peso_unitkg")
      .ilike("nombre", productName)
      .limit(1)

    if (error) {
      console.error("[v0] Error fetching product weight:", error)
      return 0
    }

    // If we found a product, return its weight
    if (data && data.length > 0) {
      console.log("[v0] Product weight found:", data[0].peso_unitkg)
      return data[0].peso_unitkg || 0
    }

    console.warn("[v0] Product not found:", productName)
    return 0
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return 0
  }
}

export async function getBodegasByCliente(clienteId: number): Promise<Bodega[]> {
  console.log("[v0] Fetching bodegas for cliente:", clienteId)

  try {
    const { data, error } = await supabase
      .from("bodegas")
      .select("idbodega, nombrebodega, clienteid, ciudad, direccion")
      .eq("clienteid", clienteId)
      .order("nombrebodega", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching bodegas:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getAllEmpresas(): Promise<{ id: number; nombre: string }[]> {
  console.log("[v0] Fetching all empresas from server action")

  try {
    const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching all empresas:", error)
      return []
    }

    console.log("[v0] All Empresas fetched:", data?.length || 0)
    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getEmpresas(): Promise<Empresa[]> {
  console.log("[v0] Fetching empresas from server action")

  try {
    const { data, error } = await supabase
      .from("empresas")
      .select("id, nombre, nit, direccion, logo")
      .order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching empresas:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getEmpresaById(empresaId: number): Promise<Empresa | null> {
  console.log("[v0] Fetching empresa by ID:", empresaId)

  try {
    const { data, error } = await supabase
      .from("empresas")
      .select("id, nombre, nit, direccion, logo")
      .eq("id", empresaId)
      .single()

    if (error) {
      console.error("[v0] Error fetching empresa:", error)
      return null
    }

    return data
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return null
  }
}

export async function getOwners(): Promise<Owner[]> {
  console.log("[v0] Fetching owners from server action")

  try {
    const { data, error } = await supabase.from("owners").select("nombre").order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching owners:", error)
      return []
    }

    console.log("[v0] Owners fetched:", data?.length || 0)
    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export interface OrderHeader {
  fecha: string
  vendedor: string
  cliente: string
  destino: string
  medio: string
  fecha_programada: string
  direccion: string
  empresa: string
  empresafactura?: string
  condicion_pago: string
  orden_de_compra: string
  pedido: string
  total_linea: number
  total_pagar: number
  descuentopp: number
  descuentoiva: number
  tipo_despacho: string
  pdfpedido?: string
}

export interface OrderDetail {
  categoria: string
  producto: string
  cantidad: number
  precio_unitario: number
  total_linea: number
  descuento_iva: number
  descuento_pp: number
  subtotal: number
}

export async function registerOrder(header: OrderHeader, details: OrderDetail[], selectedEmpresaId?: number) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Entrada de pedidos"], "crear", "Registrar pedido")
  if (motivoAccion) return { success: false, message: motivoAccion }
  console.log("[v0] Registering order...")

  try {
    // 1. Get the last idpedido
    const { data: lastOrder, error: lastOrderError } = await supabase
      .from("pedidoscabecera")
      .select("idpedido")
      .order("idpedido", { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextId = 1
    if (lastOrderError && lastOrderError.code !== "PGRST116") {
      console.error("[v0] Error fetching last order ID:", lastOrderError)
      return { success: false, message: "Error al generar ID de pedido" }
    }

    if (lastOrder) {
      nextId = (lastOrder.idpedido || 0) + 1
    }

    console.log("[v0] Next Order ID:", nextId)

    const { data: lastDetail, error: lastDetailError } = await supabase
      .from("pedidosdetalle")
      .select("transid")
      .order("transid", { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextTransId = 1
    if (lastDetailError && lastDetailError.code !== "PGRST116") {
      console.error("[v0] Error fetching last transid:", lastDetailError)
      return { success: false, message: "Error al generar ID de detalle" }
    }

    if (lastDetail) {
      nextTransId = (lastDetail.transid || 0) + 1
    }

    console.log("[v0] Next TransID:", nextTransId)

    const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

    // 2. Insert header
    const { error: headerError } = await supabase.from("pedidoscabecera").insert([
      {
        idpedido: nextId,
        id_empresa: empresaId,
        fecha: header.fecha,
        vendedor: header.vendedor,
        cliente: header.cliente,
        destino: header.destino,
        medio: header.medio,
        fecha_programada: header.fecha_programada,
        direccion: header.direccion,
        empresa: header.empresa,
        empresafactura: header.empresafactura || null,
        condicion_pago: header.condicion_pago,
        orden_de_compra: header.orden_de_compra,
        pedido: header.pedido,
        total_linea: header.total_linea,
        total_pagar: header.total_pagar,
        descuentopp: header.descuentopp,
        descuentoiva: header.descuentoiva,
        tipo_despacho: header.tipo_despacho,
        pdfpedido: header.pdfpedido || null,
      },
    ])

    if (headerError) {
      console.error("[v0] Error inserting header:", headerError)
      return { success: false, message: "Error al guardar la cabecera del pedido: " + headerError.message }
    }

    // 3. Insert details
    if (details.length > 0) {
      const detailsToInsert = await Promise.all(
        details.map(async (detail, index) => {
          const pesoUnitario = await getProductWeight(detail.producto)
          const pesoTotal = pesoUnitario * detail.cantidad

          return {
            transid: nextTransId + index,
            idpedido: nextId,
            id_empresa: empresaId,
            producto: detail.producto,
            unidades: detail.cantidad,
            precio_und: detail.precio_unitario,
            total_linea: detail.total_linea,
            iva: detail.descuento_iva,
            descuentopp: detail.descuento_pp,
            subtotal: detail.subtotal,
            peso: pesoTotal,
            categoria: detail.categoria,
          }
        }),
      )

      const { error: detailsError } = await supabase.from("pedidosdetalle").insert(detailsToInsert)

      if (detailsError) {
        console.error("[v0] Error inserting details:", detailsError)
        return { success: false, message: "Pedido registrado parcialmente. Error en detalles: " + detailsError.message }
      }
    }

    return { success: true, message: `Pedido #${nextId} registrado exitosamente`, idpedido: nextId }
  } catch (error) {
    console.error("[v0] Unexpected error registering order:", error)
    return { success: false, message: "Error inesperado al registrar el pedido" }
  }
}

export async function getOrderForEdit(orderId: number) {
  console.log("[v0] Fetching order for edit:", orderId)

  try {
    // Get header
    const { data: header, error: headerError } = await supabase
      .from("pedidoscabecera")
      .select("*")
      .eq("idpedido", orderId)
      .single()

    if (headerError) {
      console.error("[v0] Error fetching order header:", headerError)
      return { success: false, message: "Error al cargar el pedido" }
    }

    // Get details
    const { data: details, error: detailsError } = await supabase
      .from("pedidosdetalle")
      .select("*")
      .eq("idpedido", orderId)
      .order("transid", { ascending: true })

    if (detailsError) {
      console.error("[v0] Error fetching order details:", detailsError)
      return { success: false, message: "Error al cargar los detalles del pedido" }
    }

    return { success: true, header, details: details || [] }
  } catch (error) {
    console.error("[v0] Unexpected error fetching order:", error)
    return { success: false, message: "Error inesperado al cargar el pedido" }
  }
}

export async function updateOrder(
  orderId: number,
  header: OrderHeader,
  details: OrderDetail[],
  selectedEmpresaId?: number,
) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Entrada de pedidos", "Gestionar pedidos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  console.log("[v0] Updating order:", orderId)

  try {
    const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

    // 1. Update header
    const { error: headerError } = await supabase
      .from("pedidoscabecera")
      .update({
        id_empresa: empresaId,
        fecha: header.fecha,
        vendedor: header.vendedor,
        cliente: header.cliente,
        destino: header.destino,
        medio: header.medio,
        fecha_programada: header.fecha_programada,
        direccion: header.direccion,
        empresa: header.empresa,
        empresafactura: header.empresafactura || null,
        condicion_pago: header.condicion_pago,
        orden_de_compra: header.orden_de_compra,
        pedido: header.pedido,
        total_linea: header.total_linea,
        total_pagar: header.total_pagar,
        descuentopp: header.descuentopp,
        descuentoiva: header.descuentoiva,
        tipo_despacho: header.tipo_despacho,
        pdfpedido: header.pdfpedido || null,
      })
      .eq("idpedido", orderId)

    if (headerError) {
      console.error("[v0] Error updating header:", headerError)
      return { success: false, message: "Error al actualizar la cabecera del pedido: " + headerError.message }
    }

    // 2. Delete existing details
    const { error: deleteError } = await supabase.from("pedidosdetalle").delete().eq("idpedido", orderId)

    if (deleteError) {
      console.error("[v0] Error deleting old details:", deleteError)
      return { success: false, message: "Error al eliminar detalles antiguos: " + deleteError.message }
    }

    // 3. Insert new details
    if (details.length > 0) {
      // Get next transid
      const { data: lastDetail, error: lastDetailError } = await supabase
        .from("pedidosdetalle")
        .select("transid")
        .order("transid", { ascending: false })
        .limit(1)
        .maybeSingle()

      let nextTransId = 1
      if (lastDetailError && lastDetailError.code !== "PGRST116") {
        console.error("[v0] Error fetching last transid:", lastDetailError)
        return { success: false, message: "Error al generar ID de detalle" }
      }

      if (lastDetail) {
        nextTransId = (lastDetail.transid || 0) + 1
      }

      const detailsToInsert = await Promise.all(
        details.map(async (detail, index) => {
          const pesoUnitario = await getProductWeight(detail.producto)
          const pesoTotal = pesoUnitario * detail.cantidad

          return {
            transid: nextTransId + index,
            idpedido: orderId,
            id_empresa: empresaId,
            producto: detail.producto,
            unidades: detail.cantidad,
            precio_und: detail.precio_unitario,
            total_linea: detail.total_linea,
            iva: detail.descuento_iva,
            descuentopp: detail.descuento_pp,
            subtotal: detail.subtotal,
            peso: pesoTotal,
            categoria: detail.categoria,
          }
        }),
      )

      const { error: detailsError } = await supabase.from("pedidosdetalle").insert(detailsToInsert)

      if (detailsError) {
        console.error("[v0] Error inserting new details:", detailsError)
        return { success: false, message: "Error al actualizar detalles: " + detailsError.message }
      }
    }

    return { success: true, message: `Pedido #${orderId} actualizado exitosamente`, idpedido: orderId }
  } catch (error) {
    console.error("[v0] Unexpected error updating order:", error)
    return { success: false, message: "Error inesperado al actualizar el pedido" }
  }
}

export interface PDFOrderData {
  nit: string
  carrera: string
  fechaPedido: string
  nitCliente: string
  sucursalMolinos: string
  nombreCliente: string
  direccionEntrega: string
  ciudadEntrega: string
  asesorComercial: string
  fechaEntrega: string
  condicionPago: string
  tipoDespacho: string
  groupedProducts: Record<string, any[]>
  totalOrden: number
  descuentoIVA: number
  descuentoPP: number
  totalPagar: number
  kgDespacho: number
  observaciones: string
}
