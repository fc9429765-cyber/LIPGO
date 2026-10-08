"use server"

import { createClient } from "@/lib/supabase-client"
import { registrarErrorServidor } from "@/lib/errores-servidor"
import { getColombiaDateTime, getColombiaDate } from "@/lib/date-utils"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { exigirAccion } from "@/lib/puerta-modulo"

interface TransferProduct {
  categoria: string
  producto: string
  cantidad: number
  pesoUnitario: number // Added pesoUnitario field
}

interface TransferRequestData {
  bodegaOrigenId: number // Changed to bodegaOrigenId
  bodegaDestinoId: number // Changed to bodegaDestinoId
  products: TransferProduct[]
}

export async function getEmpresasForSelect() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre", { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error("Error fetching empresas:", error)
    return []
  }
}

export async function getProductosWithWeight() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("productos")
      .select("id, nombre, categoria, peso_unitkg")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error("Error fetching productos:", error)
    return []
  }
}

export async function getInventoryByEmpresa(empresaId: number) {
  const supabase = await createClient()

  try {
    console.log("[v0] Fetching inventory for empresa:", empresaId)

    const { data, error } = await supabase
      .from("invglobal")
      .select("idproducto, stock_global")
      .eq("idempresa", empresaId)

    if (error) {
      console.error("[v0] Error fetching inventory:", error)
      throw error
    }

    console.log("[v0] Inventory data received:", data)
    return data || []
  } catch (error) {
    console.error("Error fetching inventory:", error)
    return []
  }
}

export async function getEmpresaById(empresaId: number) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase.from("empresas").select("id, nombre, ciudad").eq("id", empresaId).single()

    if (error) throw error
    return data
  } catch (error) {
    console.error("Error fetching empresa:", error)
    return null
  }
}

export async function createTransferRequest(data: TransferRequestData) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Recepción de Traslado", "Traslados de producto"], "crear")
  const supabase = await createClient()

  try {
    // Get the last idpedido to generate the next consecutive ID
    const { data: lastOrder, error: lastOrderError } = await supabase
      .from("pedidoscabecera")
      .select("idpedido")
      .order("idpedido", { ascending: false })
      .limit(1)
      .single()

    let nextIdPedido = 1
    if (lastOrderError && lastOrderError.code !== "PGRST116") {
      console.error("Error fetching last order ID:", lastOrderError)
      throw new Error("Error al generar ID de pedido")
    }

    if (lastOrder) {
      nextIdPedido = (lastOrder.idpedido || 0) + 1
    }

    // Get bodega origen empresa data (id, nombre)
    const bodegaOrigen = await getEmpresaById(data.bodegaOrigenId)
    if (!bodegaOrigen) {
      throw new Error("No se pudo obtener información de bodega origen")
    }

    // Get bodega destino empresa data (nombre, ciudad)
    const bodegaDestino = await getEmpresaById(data.bodegaDestinoId)
    if (!bodegaDestino) {
      throw new Error("No se pudo obtener información de bodega destino")
    }

    const colombiaTime = await getColombiaDateTime()
    const year = colombiaTime.getFullYear()
    const month = String(colombiaTime.getMonth() + 1).padStart(2, "0")
    const day = String(colombiaTime.getDate()).padStart(2, "0")
    const pedidoCode = `TRA${year}${month}${day}${nextIdPedido}`
    const fechaFormato = `${day}/${month}/${year}`

    const { generateAndUploadTransferRequestPDF } = await import("@/lib/pdf-actions")

    // Calculate totals for PDF
    const totalUnidades = data.products.reduce((sum, p) => sum + p.cantidad, 0)
    const totalPeso = data.products.reduce((sum, p) => sum + p.cantidad * p.pesoUnitario, 0)

    const pdfData = {
      fecha: fechaFormato,
      bodegaOrigen: bodegaOrigen.nombre,
      bodegaDestino: bodegaDestino.nombre,
      ciudadDestino: bodegaDestino.ciudad || "",
      products: data.products.map((p) => ({
        categoria: p.categoria,
        producto: p.producto,
        cantidad: p.cantidad,
        peso: p.cantidad * p.pesoUnitario,
      })),
      totalUnidades,
      totalPeso,
    }

    const pdfResult = await generateAndUploadTransferRequestPDF(pdfData, nextIdPedido, pedidoCode)

    if (!pdfResult.success) {
      console.error("Error generating PDF, but continuing with registration:", pdfResult.error)
    }

    // Insert into pedidoscabecera
    const { error: headerError } = await supabase.from("pedidoscabecera").insert({
      idpedido: nextIdPedido,
      id_empresa: bodegaOrigen.id,
      fecha: await getColombiaDate(), // Using Colombia date for database insertion
      vendedor: "Gerencia",
      cliente: bodegaDestino.nombre,
      destino: bodegaDestino.ciudad || "",
      empresa: bodegaOrigen.nombre,
      pedido: pedidoCode,
      tipo_despacho: "traslado interno",
      medio: "traslado interno",
      pdfpedido: pdfResult.success ? pdfResult.url : null, // Add PDF URL to pdfpedido field
    })

    if (headerError) {
      console.error("Error creating transfer request header:", headerError)
      throw new Error("Error al crear la solicitud de traslado en pedidoscabecera")
    }

    // Get the last transid for pedidosdetalle
    const { data: lastDetail, error: lastDetailError } = await supabase
      .from("pedidosdetalle")
      .select("transid")
      .order("transid", { ascending: false })
      .limit(1)
      .single()

    let nextTransId = 1
    if (lastDetailError && lastDetailError.code !== "PGRST116") {
      console.error("Error fetching last transid:", lastDetailError)
      throw new Error("Error al generar ID de detalle")
    }

    if (lastDetail) {
      nextTransId = (lastDetail.transid || 0) + 1
    }

    // Insert into pedidosdetalle
    const detailsToInsert = data.products.map((product, index) => ({
      transid: nextTransId + index,
      idpedido: nextIdPedido,
      id_empresa: bodegaOrigen.id,
      producto: product.producto,
      unidades: product.cantidad,
      peso: product.cantidad * product.pesoUnitario,
      categoria: product.categoria,
    }))

    const { error: detailsError } = await supabase.from("pedidosdetalle").insert(detailsToInsert)

    if (detailsError) {
      console.error("Error creating transfer request details:", detailsError)
      throw new Error("Error al crear el detalle de la solicitud")
    }

    const { error: trasladosError } = await supabase.from("traslados").insert({
      id: nextIdPedido,
      codigosolicitud: pedidoCode,
      fehasolicitud: await getColombiaDate(), // Changed fechasolicitud to fehasolicitud
      bodegaorigen: bodegaOrigen.nombre,
      bodegadestino: bodegaDestino.nombre,
      estado: "pendiente",
    })

    if (trasladosError) {
      console.error("Error creating traslados record:", trasladosError)
      throw new Error("Error al crear el registro en traslados")
    }

    return { success: true, pedidoCode, idpedido: nextIdPedido, pdfUrl: pdfResult.url }
  } catch (error) {
    console.error("Error in createTransferRequest:", error)
    // Un traslado entre bodegas a medias deja inventario en dos sitios: al registro (SQL 217).
    void registrarErrorServidor("traslados.createTransferRequest", error)
    throw error
  }
}

export async function getTransferRequests() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("traslados")
      .select("id, codigosolicitud, fehasolicitud, bodegaorigen, bodegadestino, estado")
      .order("id", { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error("Error fetching transfer requests:", error)
    throw error
  }
}

export async function updateTransferRequest(
  id: number,
  updates: Partial<{
    codigosolicitud: string
    fehasolicitud: string // Changed fechasolicitud to fehasolicitud
    bodegaorigen: string
    bodegadestino: string
    estado: string
  }>,
) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Recepción de Traslado"], "crear", "Recibir traslado")
  const supabase = await createClient()

  try {
    const { error } = await supabase.from("traslados").update(updates).eq("id", id)

    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error("Error updating transfer request:", error)
    void registrarErrorServidor("traslados.updateTransferRequest", error)
    throw error
  }
}

export async function getDispatchTransfers(selectedEmpresaId?: number) {
  const supabase = await createClient()

  try {
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())
    console.log("[v0] Getting dispatch transfers for empresa:", empresaId)

    const { data, error } = await supabase
      .from("despachotraslados")
      .select(`
        id, 
        ocargue, 
        placa, 
        creado, 
        nombreproducto, 
        idproducto, 
        codproducto, 
        lote, 
        cantidad, 
        tipoproducto
      `)
      .eq("id", empresaId)
      .order("ocargue", { ascending: false })
      .order("creado", { ascending: false })

    console.log("[v0] Dispatch transfers query result:", { dataCount: data?.length, error })

    if (error) {
      console.error("[v0] Error in query:", error)
      throw error
    }

    console.log("[v0] Sample data:", data?.slice(0, 2))

    const uniqueProductIds = [...new Set(data?.map((item) => item.idproducto).filter(Boolean))]
    console.log("[v0] Unique product IDs:", uniqueProductIds)

    let productsWeights: Record<number, number> = {}

    if (uniqueProductIds.length > 0) {
      const { data: productsData, error: productsError } = await supabase
        .from("productos")
        .select("id, peso_unitkg")
        .in("id", uniqueProductIds)

      if (productsError) {
        console.error("[v0] Error fetching products weights:", productsError)
      } else {
        productsWeights =
          productsData?.reduce(
            (acc, p) => {
              acc[p.id] = p.peso_unitkg || 0
              return acc
            },
            {} as Record<number, number>,
          ) || {}
        console.log("[v0] Products weights:", productsWeights)
      }
    }

    const transformedData =
      data?.map((item) => {
        const pesoUnitkg = productsWeights[item.idproducto] || 0
        const pesoLinea = (item.cantidad || 0) * pesoUnitkg
        console.log(
          "[v0] Item:",
          item.nombreproducto,
          "ID:",
          item.idproducto,
          "Peso unitkg:",
          pesoUnitkg,
          "Cantidad:",
          item.cantidad,
          "Peso línea:",
          pesoLinea,
        )
        return {
          ...item,
          peso_unitkg: pesoUnitkg,
          peso_linea: pesoLinea,
        }
      }) || []

    console.log("[v0] Transformed data sample:", transformedData?.slice(0, 2))

    return transformedData
  } catch (error) {
    console.error("Error fetching dispatch transfers:", error)
    throw error
  }
}

export async function generateUnloadOrder(ocargue: string, selectedEmpresaId?: number) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Generar Órdenes de Descargue", "Recepción de Traslado"], "crear")
  const supabase = await createClient()

  try {
    // Get empresa ID from session
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    // Get dispatch transfer details for this ocargue
    const { data: transferDetails, error: transferError } = await supabase
      .from("despachotraslados")
      .select(`
        id,
        ocargue,
        placa,
        nombreproducto,
        idproducto,
        cantidad
      `)
      .eq("ocargue", ocargue)
      .eq("id", empresaId)

    if (transferError) {
      console.error("[v0] Error fetching transfer details:", transferError)
      throw new Error("Error al obtener detalles del traslado")
    }

    if (!transferDetails || transferDetails.length === 0) {
      throw new Error("No se encontraron detalles para esta orden de cargue")
    }

    // Get product weights
    const productIds = [...new Set(transferDetails.map((item) => item.idproducto))]
    const { data: productsData, error: productsError } = await supabase
      .from("productos")
      .select("id, peso_unitkg")
      .in("id", productIds)

    if (productsError) {
      console.error("[v0] Error fetching products:", productsError)
      throw new Error("Error al obtener información de productos")
    }

    const productsWeights =
      productsData?.reduce(
        (acc, p) => {
          acc[p.id] = p.peso_unitkg || 0
          return acc
        },
        {} as Record<number, number>,
      ) || {}

    // Calculate total weight in kg
    const totalWeightKg = transferDetails.reduce((sum, item) => {
      const pesoUnitkg = productsWeights[item.idproducto] || 0
      return sum + item.cantidad * pesoUnitkg
    }, 0)

    // Convert to tons
    const pesoOrdenTons = totalWeightKg / 1000

    // Get the last id from cabeceraoc to generate next consecutive ID
    const { data: lastCabeceraoc, error: lastCabError } = await supabase
      .from("cabeceraoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .single()

    let nextId = 1
    if (lastCabError && lastCabError.code !== "PGRST116") {
      console.error("[v0] Error fetching last cabeceraoc ID:", lastCabError)
      throw new Error("Error al generar ID de orden")
    }

    if (lastCabeceraoc) {
      nextId = (lastCabeceraoc.id || 0) + 1
    }

    // Generate ordendecargue code: TRA + YYYYMMDD + id
    const colombiaTime = await getColombiaDateTime()
    const year = colombiaTime.getFullYear()
    const month = String(colombiaTime.getMonth() + 1).padStart(2, "0")
    const day = String(colombiaTime.getDate()).padStart(2, "0")
    const ordendecargue = `TRA${year}${month}${day}${nextId}`

    // Get current Colombia date for fechaorden
    const fechaorden = await getColombiaDate()

    // Get current Colombia time for horaorden (HH:MM:SS format)
    const hours = String(colombiaTime.getHours()).padStart(2, "0")
    const minutes = String(colombiaTime.getMinutes()).padStart(2, "0")
    const seconds = String(colombiaTime.getSeconds()).padStart(2, "0")
    const horaorden = `${hours}:${minutes}:${seconds}`

    // Get placa from first record (all should have same placa)
    const placa = transferDetails[0].placa

    // Insert into cabeceraoc
    const { error: cabeceraError } = await supabase.from("cabeceraoc").insert({
      id: nextId,
      idempresa: empresaId,
      ordendecargue: ordendecargue,
      fechaorden: fechaorden,
      placa: placa,
      tipooperacion: "Descargue",
      pesoorden: pesoOrdenTons,
      horaorden: horaorden,
      ordenorigen: ocargue, // Store the source ocargue
    })

    if (cabeceraError) {
      console.error("[v0] Error inserting into cabeceraoc:", cabeceraError)
      throw new Error("Error al crear la orden de descargue")
    }

    // Get the last id from detalleoc to generate next consecutive IDs
    const { data: lastDetalleoc, error: lastDetError } = await supabase
      .from("detalleoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .single()

    let nextDetalleId = 1
    if (lastDetError && lastDetError.code !== "PGRST116") {
      console.error("[v0] Error fetching last detalleoc ID:", lastDetError)
      throw new Error("Error al generar ID de detalle")
    }

    if (lastDetalleoc) {
      nextDetalleId = (lastDetalleoc.id || 0) + 1
    }

    // Insert into detalleoc for each product
    const detalleInserts = transferDetails.map((item, index) => {
      const pesoUnitkg = productsWeights[item.idproducto] || 0
      const pesoLineaKg = item.cantidad * pesoUnitkg
      const toneladasLinea = pesoLineaKg / 1000

      return {
        id: nextDetalleId + index,
        idorden: nextId,
        numeroorden: ordendecargue,
        producto: item.nombreproducto,
        cantidad: item.cantidad,
        toneladas: toneladasLinea,
        cliente: "Transferencia interna",
      }
    })

    const { error: detalleError } = await supabase.from("detalleoc").insert(detalleInserts)

    if (detalleError) {
      console.error("[v0] Error inserting into detalleoc:", detalleError)
      throw new Error("Error al crear el detalle de la orden de descargue")
    }

    return {
      success: true,
      ordendecargue: ordendecargue,
      id: nextId,
    }
  } catch (error) {
    console.error("[v0] Error in generateUnloadOrder:", error)
    void registrarErrorServidor("traslados.generateUnloadOrder", error)
    throw error
  }
}
