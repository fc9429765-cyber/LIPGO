"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaData } from "@/lib/user-context"
import { resolverOwnerPorNombre } from "@/lib/owner-utils"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/**
 * Recorta `texto` para que quepa en `anchoMm` con el tamaño de fuente ACTUAL
 * del documento, agregando "…" cuando sobra.
 *
 * Se mide con `getTextWidth` en vez de cortar por numero de caracteres: un
 * corte por caracteres no sabe cuanto ocupa el texto en la hoja, asi que un
 * nombre largo o con muchas mayusculas se salia de su columna y se montaba
 * sobre la siguiente.
 *
 * No se exporta: en un archivo "use server" solo los EXPORTS deben ser async.
 */
function recortarAAncho(doc: any, texto: string, anchoMm: number): string {
  const t = String(texto ?? "")
  if (!t) return ""
  if (doc.getTextWidth(t) <= anchoMm) return t
  let out = t
  while (out.length > 1 && doc.getTextWidth(out + "…") > anchoMm) {
    out = out.slice(0, -1)
  }
  return out + "…"
}

async function imageUrlToBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString("base64")
    const mimeType = blob.type || "image/png"
    return `data:${mimeType};base64,${base64}`
  } catch (error) {
    console.error("[v0] Error converting image URL to base64:", error)
    throw error
  }
}

export async function uploadPDF(
  orderCode: string,
  orderDate: string,
  placa: string,
  conductor: string,
  transporte: string,
  destino: string,
  observaciones: string,
  productsList: Array<{
    cliente: string
    destino: string
    producto: string
    cantidad: number
    pesoKgs: number
    lote: string
    novedad: string
  }>,
  totalUnidades: number,
  totalPesoKgs: number,
): Promise<{ success: boolean; pdfUrl?: string; error?: string }> {
  try {
    // Dynamically import jsPDF to avoid dependency conflicts
    const { default: jsPDF } = await import("jspdf")
    const empresaData = await getCurrentEmpresaData()

    const doc = new jsPDF()

    // Header with logo
    doc.setFontSize(16)
    doc.setTextColor(200, 16, 46)
    doc.setFont(undefined as any, "bold")
    doc.text(empresaData.nombre, 105, 15, { align: "center" })

    doc.setFontSize(8)
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.text(`NIT: ${empresaData.nit}`, 105, 20, { align: "center" })
    doc.text(empresaData.direccion, 105, 25, { align: "center" })
    doc.text("Formato Orden de Cargue", 105, 30, { align: "center" })

    // Order info header
    let y = 35
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 85, 6, "F")
    doc.setFontSize(10)
    doc.text("Fecha y Hora", 20, y + 4)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(100, y, 95, 6, "F")
    doc.text(orderDate, 105, y + 4)

    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y + 7, 85, 6, "F")
    doc.text("OC", 20, y + 11)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(100, y + 7, 95, 6, "F")
    doc.text(orderCode, 105, y + 11)

    y += 18
    doc.setFillColor(100, 100, 100)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 6, "F")

    doc.setFontSize(8)
    doc.setFont(undefined as any, "bold")
    doc.text("Cliente", 20, y + 4)
    doc.text("Destino", 63, y + 4)
    doc.text("Producto", 90, y + 4)
    doc.text("Und.", 152, y + 4, { align: "center" })
    doc.text("Peso (Ton)", 172, y + 4, { align: "center" })

    y += 6
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(6)
    doc.setTextColor(0, 0, 0)
    doc.setDrawColor(200, 200, 200)

    productsList.forEach((product: any) => {
      doc.rect(15, y, 45, 6, "S") // Cliente - wider
      doc.rect(60, y, 25, 6, "S") // Destino - narrower
      doc.rect(85, y, 65, 6, "S") // Producto - wider
      doc.rect(150, y, 15, 6, "S") // Und - narrower
      doc.rect(165, y, 30, 6, "S") // Peso (Ton) - narrower

      doc.text(product.cliente.substring(0, 20), 17, y + 4)
      doc.text(product.destino.substring(0, 12), 62, y + 4)
      doc.text(product.producto.substring(0, 35), 87, y + 4)
      doc.text(String(product.cantidad), 157, y + 4, { align: "center" })
      doc.text(((product.pesoKgs || 0) / 1000).toFixed(3), 180, y + 4, { align: "center" })

      y += 6
    })

    // Add empty rows if needed
    const minRows = 8
    const currentRows = productsList.length
    if (currentRows < minRows) {
      for (let i = 0; i < minRows - currentRows; i++) {
        doc.rect(15, y, 45, 6, "S")
        doc.rect(60, y, 25, 6, "S")
        doc.rect(85, y, 65, 6, "S")
        doc.rect(150, y, 15, 6, "S")
        doc.rect(165, y, 30, 6, "S")

        y += 6
      }
    }

    y += 2
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 110, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("TOTALES", 20, y + 4)

    doc.setFillColor(255, 255, 255)
    doc.setTextColor(0, 0, 0)
    doc.rect(150, y, 15, 6, "FD")
    doc.text(String(totalUnidades), 157, y + 4, { align: "center" })

    doc.setFillColor(255, 255, 255)
    doc.rect(165, y, 30, 6, "FD")
    doc.text(String(totalPesoKgs), 180, y + 4, { align: "center" })

    // Vehicle details section
    y += 12
    doc.setFont(undefined as any, "normal")
    doc.setFillColor(200, 200, 200)
    doc.rect(15, y, 85, 6, "F")
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(9)
    doc.text("Placa", 20, y + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, y, 95, 6, "S")
    doc.text(placa, 105, y + 4)

    y += 6
    doc.setFillColor(200, 200, 200)
    doc.rect(15, y, 85, 6, "F")
    doc.text("Conductor", 20, y + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, y, 95, 6, "S")
    doc.text(conductor, 105, y + 4)

    y += 6
    doc.setFillColor(200, 200, 200)
    doc.rect(15, y, 85, 6, "F")
    doc.text("Transporte", 20, y + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, y, 95, 6, "S")
    doc.text(transporte, 105, y + 4)

    y += 6
    doc.setFillColor(200, 200, 200)
    doc.rect(15, y, 85, 6, "F")
    doc.text("Destino", 20, y + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, y, 95, 6, "S")
    doc.text(destino || " ", 105, y + 4)

    // Notes section
    y += 12
    doc.setFontSize(6)
    doc.text(
      "NOTA: SEÑOR TRANSPORTISTA SE LE INFORMA QUE TODO PRODUCTO QUE LE DEVUELVAN POR AVERÍA O EN MAL ESTADO LE SERÁ DESCONTADO DEL FLETE",
      15,
      y,
      { maxWidth: 180 },
    )

    y += 8
    doc.text(
      "AL FIRMAR ESTE VALE EN PLANTA, CERTIFICO QUE CONTÉ EL PRODUCTO CARGADO SEGÚN ESTA ORDEN DE CARGUE Y ESTÁ COMPLETO. MANIFIESTO CONOCER LA NORMA Y EN CASO OSISO ASUMIRÉ EL COSTO.",
      15,
      y,
      { maxWidth: 180 },
    )
    doc.text("FIRMA DEL CONDUCTOR____________________", 15, y + 10)
    doc.text("C.C. No.____________________", 120, y + 10)

    y += 20
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("Observaciones", 20, y + 4)

    y += 6
    doc.setDrawColor(200, 200, 200)
    doc.setTextColor(0, 0, 0)
    doc.rect(15, y, 180, 15, "S")
    doc.setFontSize(8)
    doc.text(observaciones || "", 20, y + 5, { maxWidth: 175 })

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(6)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    // Generate PDF blob
    const pdfBlob = doc.output("blob")
    const fileName = `pedido_${orderCode}_${Date.now()}.pdf`

    // Upload to Supabase Storage
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase.storage.from("archivos").upload(`pedidos/${fileName}`, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    })

    if (error) {
      console.error("Upload error:", error.message)
      return { success: false, error: error.message }
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("archivos").getPublicUrl(`pedidos/${fileName}`)

    return { success: true, pdfUrl: publicUrl }
  } catch (error) {
    console.error("[v0] Error generating and uploading PDF:", error)
    return { success: false, error: "Error al generar o subir el PDF" }
  }
}

export async function generateAndUploadOrderPDF(
  orderData: {
    idpedido?: number // Add idpedido field
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
    empresaFactura?: string
    observaciones?: string
    groupedProducts: Record<
      string,
      Array<{
        referencia: string
        cantidad: number
        precioUnitario: number
        categoria: string
        peso?: number
      }>
    >
    subtotal: number
    iva: number
    total: number
    kgDespacho?: number
  },
  empresaNombre?: string,
  empresaLogo?: string,
) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Entrada de pedidos", "Gestionar pedidos"], "ver")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    console.log("[v0] Generating PDF with empresa data from order")

    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter" })

    // Header with logo
    doc.setFontSize(14)
    doc.text("ORDEN DE PEDIDO", 105, 15, { align: "center" })
    doc.setFontSize(12)
    doc.text(empresaNombre || "EMPRESA", 105, 22, { align: "center" })

    if (empresaLogo) {
      try {
        doc.addImage(empresaLogo, "PNG", 165, 8, 30, 15)
      } catch (error) {
        console.log("[v0] Could not add logo to PDF")
      }
    }

    doc.setFontSize(9)
    doc.text(`NIT: ${orderData.nit || "N/A"}`, 105, 28, { align: "center" })
    doc.text(orderData.carrera || "N/A", 105, 33, { align: "center" })

    doc.setFontSize(8)
    if (orderData.idpedido) {
      doc.text(`Pedido #${orderData.idpedido}`, 15, 40)
      doc.text("VIT-CM-1", 80, 40)
      doc.text("R: 1.0", 120, 40)
      doc.text(`Fecha: ${orderData.fechaPedido}`, 195, 40, { align: "right" })
    } else {
      doc.text("VIT-CM-1", 15, 40)
      doc.text("R: 1.0", 105, 40, { align: "center" })
      doc.text(`Fecha: ${orderData.fechaPedido}`, 195, 40, { align: "right" })
    }
    // </CHANGE>

    // Order info section
    let y = 50
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 45, "F")

    doc.setFontSize(8)
    doc.text(`Fecha de pedido: ${orderData.fechaPedido}`, 20, y + 5)
    doc.text(`Sucursal: ${orderData.sucursalMolinos}`, 120, y + 5)
    doc.text(`NIT Cliente: ${orderData.nitCliente}`, 20, y + 10)
    doc.text(`Nombre Cliente: ${orderData.nombreCliente}`, 120, y + 10)
    doc.text(`Dirección de entrega: ${orderData.direccionEntrega}`, 20, y + 15)
    doc.text(`Ciudad de entrega: ${orderData.ciudadEntrega}`, 120, y + 15)
    doc.text(`Asesor comercial: ${orderData.asesorComercial}`, 20, y + 20)
    doc.text(`Fecha de entrega: ${orderData.fechaEntrega}`, 120, y + 20)
    doc.text(`Condición de pago: ${orderData.condicionPago}`, 20, y + 25)
    doc.text(`Tipo de despacho: ${orderData.tipoDespacho}`, 120, y + 25)
    if (orderData.empresaFactura) {
      doc.text(`Empresa Factura: ${orderData.empresaFactura}`, 20, y + 30)
    }

    doc.setTextColor(0, 0, 0)
    y += 45

    // Products table header
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 7, "F")
    doc.setFontSize(8)
    doc.setFont(undefined as any, "bold")
    doc.text("#", 17, y + 5)
    doc.text("Referencia", 25, y + 5)
    doc.text("Precio unitario", 95, y + 5)
    doc.text("Cantidad", 130, y + 5)
    doc.text("Peso", 155, y + 5)
    doc.text("Valor total", 175, y + 5)

    doc.setTextColor(0, 0, 0)
    y += 7

    let rowNumber = 1
    doc.setDrawColor(200, 200, 200)
    doc.setFont(undefined as any, "normal")

    // Products grouped by category
    Object.entries(orderData.groupedProducts).forEach(([categoria, categoryProducts]: [string, any]) => {
      doc.setFillColor(245, 245, 245)
      doc.rect(15, y, 180, 6, "FD")
      doc.setFont(undefined as any, "bold")
      doc.text(categoria, 25, y + 4)
      doc.setFont(undefined as any, "normal")
      y += 6

      categoryProducts.forEach((product: any) => {
        doc.rect(15, y, 180, 6, "D")
        doc.text(String(rowNumber), 17, y + 4)
        doc.text(product.referencia || product.producto || "", 25, y + 4)
        doc.text(`$ ${product.precioUnitario.toLocaleString("es-CO")}`, 95, y + 4)
        doc.text(String(product.cantidad), 130, y + 4)
        const pesoValue = product.peso ? Math.round(product.peso).toLocaleString("es-CO") : "0"
        doc.text(pesoValue, 155, y + 4)
        doc.text(`$ ${(product.precioUnitario * product.cantidad).toLocaleString("es-CO")}`, 175, y + 4)
        y += 6
        rowNumber++
      })
    })

    // Fill remaining rows
    const totalRows = 16
    const rowsUsed = rowNumber - 1 + Object.keys(orderData.groupedProducts).length
    for (let i = rowsUsed; i < totalRows; i++) {
      doc.rect(15, y, 180, 6, "D")
      y += 6
    }

    doc.setDrawColor(0, 0, 0)

    // Totals section
    y += 5
    doc.setFillColor(224, 224, 224)
    doc.rect(15, y, 180, 6, "F")
    doc.setFontSize(8)
    doc.setFont(undefined as any, "normal")
    doc.text("Total orden", 20, y + 4)
    doc.text(`$ ${orderData.subtotal.toLocaleString("es-CO")}`, 175, y + 4)

    y += 6
    doc.text("Descuento IVA", 20, y + 4)
    doc.text(`$ ${orderData.iva.toLocaleString("es-CO")}`, 175, y + 4)

    y += 6
    doc.text("Descuento pronto pago", 20, y + 4)
    doc.text(`$ 0`, 175, y + 4)

    y += 6
    doc.setFont(undefined as any, "bold")
    doc.text("Total a pagar", 20, y + 4)
    doc.text(`$ ${orderData.total.toLocaleString("es-CO")}`, 175, y + 4)

    y += 6
    doc.text("Kg Despacho", 20, y + 4)
    doc.text(Math.round(orderData.kgDespacho || 0).toLocaleString("es-CO"), 155, y + 4)

    // Observaciones
    y += 10
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("Observaciones", 20, y + 4)

    y += 6
    doc.setDrawColor(200, 200, 200)
    doc.rect(15, y, 180, 15, "S")
    doc.setFont(undefined as any, "normal")
    doc.setTextColor(0, 0, 0)
    doc.text(orderData.observaciones || "", 20, y + 5)

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(6)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    const pdfBlob = doc.output("blob")
    const fileName = `pedido_${Date.now()}.pdf`

    const supabaseAdmin = await getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.storage.from("archivos").upload(`pedidos/${fileName}`, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    })

    if (error) {
      console.error("[v0] Error uploading PDF:", error)
      return { success: false, error: error.message }
    }

    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(`pedidos/${fileName}`)

    console.log("[v0] PDF uploaded successfully:", urlData.publicUrl)
    return { success: true, url: urlData.publicUrl }
  } catch (error) {
    console.error("[v0] Error generating PDF:", error)
    return { success: false, error: "Error al generar el PDF" }
  }
}

export async function generateAndUploadLoadOrderPDF(orderData: any, ordenCargueId: number, ordenCargueCode: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Generar Órdenes de Cargue", "Gestión de Ordenes", "Picking", "Packing"], "ver")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    console.log("[v0] Starting PDF generation for load order:", ordenCargueCode)
    console.log("[v0] OrderData received:", JSON.stringify(orderData, null, 2))
    console.log("[v0] EmpresaId from orderData:", orderData.empresaId)

    let empresaData = {
      nombre: "EMPRESA",
      nit: "N/A",
      direccion: "N/A",
      logo: null as string | null,
    }

    if (orderData.empresaId) {
      console.log("[v0] Fetching empresa data for ID:", orderData.empresaId)
      const supabaseAdmin = await getSupabaseAdmin()
      const { data: empresa, error: empresaError } = await supabaseAdmin
        .from("empresas")
        .select("nombre, nit, direccion, logo")
        .eq("id", orderData.empresaId)
        .maybeSingle()

      console.log("[v0] Empresa query result:", { empresa, error: empresaError })

      if (empresaError) {
        console.error("[v0] Error fetching empresa data:", empresaError)
      } else if (empresa) {
        empresaData = {
          nombre: empresa.nombre || "EMPRESA",
          nit: empresa.nit || "N/A",
          direccion: empresa.direccion || "N/A",
          logo: empresa.logo || null,
        }
        console.log("[v0] Using empresa data from pedido:", empresaData)
      } else {
        console.log("[v0] No empresa found with ID:", orderData.empresaId)
      }
    } else {
      console.log("[v0] No empresaId provided in orderData")
    }

    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter" })

    // Header with company info
    doc.setFontSize(16)
    doc.setTextColor(200, 16, 46)
    doc.setFont(undefined as any, "bold")
    doc.text(empresaData.nombre || "EMPRESA", 105, 15, { align: "center" })

    if (empresaData.logo) {
      try {
        doc.addImage(empresaData.logo, "PNG", 165, 8, 30, 15)
      } catch (error) {
        console.log("[v0] Could not add logo to PDF to PDF:", error)
      }
    }

    doc.setFontSize(8)
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.text(`NIT: ${empresaData.nit || "N/A"}`, 105, 20, { align: "center" })
    doc.text(empresaData.direccion || "N/A", 105, 25, { align: "center" })
    doc.text("Formato Orden de Cargue", 105, 30, { align: "center" })

    // Order info header
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, 35, 85, 6, "F")
    doc.setFontSize(10)
    doc.text("Fecha y Hora", 20, 39)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(100, 35, 95, 6, "F")
    doc.text(orderData.fechaHora, 105, 39)

    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, 42, 85, 6, "F")
    doc.text("OC", 20, 46)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(100, 42, 95, 6, "F")
    doc.text(ordenCargueCode, 105, 46)

    // Cliente(s) de la orden, en el mismo formato de banda que las dos filas de
    // arriba. Una orden puede traer VARIOS clientes (en los cedis se mezclan en
    // un mismo vehiculo), asi que se listan separados por coma; el recorte por
    // ancho real garantiza que el texto no se salga de su celda.
    const clientesOrden = Array.from(
      new Set(
        ((orderData.products || []) as any[])
          .map((p) => String(p?.cliente ?? "").trim())
          .filter(Boolean),
      ),
    )
    const clienteTexto = clientesOrden.length > 0 ? clientesOrden.join(", ") : "N/A"

    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, 49, 85, 6, "F")
    doc.setFontSize(10)
    doc.text("Cliente", 20, 53)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(100, 49, 95, 6, "F")
    // La celda va de x=100 a x=195 y el texto arranca en 105: quedan 88 mm
    // utiles dejando 2 mm de aire al borde derecho.
    doc.text(recortarAAncho(doc, clienteTexto, 88), 105, 53)

    // --- Tabla de productos AGRUPADA por Cliente -> Owner, con subtotales. ---
    // El OWNER (razón social dueña del producto) se resuelve por id_empresa desde el
    // maestro `productos` — MISMA fuente y etiquetas que la facturación, para que
    // coincidan. En los cedis (Funza, Medellín) conviven varios owners en un mismo
    // vehículo y a cada uno se le factura SU cantidad; por eso el desglose por
    // cliente y por owner con subtotales.
    const ownerRes = await resolverOwnerPorNombre((orderData.products || []).map((p: any) => p.producto))
    const ownerDe = (nombre: string) => ownerRes.ownerPorNombre.get(String(nombre ?? "").trim()) || "SIN OWNER"

    // cliente -> owner -> líneas
    const porCliente = new Map<string, Map<string, any[]>>()
    for (const p of orderData.products || []) {
      const cli = String(p.cliente ?? "").trim() || "(sin cliente)"
      const own = ownerDe(p.producto)
      if (!porCliente.has(cli)) porCliente.set(cli, new Map())
      const owns = porCliente.get(cli)!
      if (!owns.has(own)) owns.set(own, [])
      owns.get(own)!.push(p)
    }

    // Arranca en 59 (antes 52) porque el encabezado gano la fila de Cliente.
    let yPos = 59
    const pageBottom = 250
    const ensure = (need: number) => {
      if (yPos + need > pageBottom) {
        doc.addPage()
        yPos = 20
      }
    }

    // Encabezado de columnas
    doc.setFillColor(100, 100, 100)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, yPos, 180, 6, "F")
    doc.setFontSize(8)
    doc.setFont(undefined as any, "bold")
    doc.text("Producto", 20, yPos + 4)
    doc.text("Destino", 122, yPos + 4)
    doc.text("Und.", 159, yPos + 4, { align: "center" })
    doc.text("Peso (Ton)", 181, yPos + 4, { align: "center" })
    yPos += 6

    let granUnd = 0
    let granTon = 0
    for (const [cli, owners] of porCliente) {
      ensure(6)
      // Banda Cliente
      doc.setFillColor(44, 82, 130)
      doc.setTextColor(255, 255, 255)
      doc.rect(15, yPos, 180, 6, "F")
      doc.setFontSize(8)
      doc.setFont(undefined as any, "bold")
      // Banda completa (15..195) sin cifras a la derecha: 173 mm utiles.
      doc.text(recortarAAncho(doc, `Cliente: ${cli}`, 173), 20, yPos + 4)
      yPos += 6

      let cliUnd = 0
      let cliTon = 0
      for (const [own, prods] of owners) {
        ensure(5)
        // Sub-banda Owner
        doc.setFillColor(224, 224, 224)
        doc.setTextColor(0, 0, 0)
        doc.rect(15, yPos, 180, 5, "F")
        doc.setFontSize(7)
        doc.setFont(undefined as any, "bold")
        doc.text(recortarAAncho(doc, `Owner: ${own}`, 171), 22, yPos + 3.5)
        yPos += 5

        let ownUnd = 0
        let ownTon = 0
        doc.setFont(undefined as any, "normal")
        doc.setDrawColor(200, 200, 200)
        for (const p of prods) {
          ensure(5)
          doc.rect(15, yPos, 105, 5, "S")
          doc.rect(120, yPos, 30, 5, "S")
          doc.rect(150, yPos, 18, 5, "S")
          doc.rect(168, yPos, 27, 5, "S")
          // Producto: celda 15..120, texto desde 17 -> 100 mm utiles, dejando
          // 3 mm de aire antes del borde de Destino. Antes el limite era 103,
          // que terminaba justo SOBRE la linea divisoria.
          doc.setFontSize(5.5)
          doc.text(recortarAAncho(doc, String(p.producto ?? ""), 100), 17, yPos + 3.5)
          // Destino: celda 120..150, texto desde 122 -> 26 mm utiles. Se recorta
          // por ancho y no a 14 caracteres, que no garantizaba nada.
          doc.setFontSize(6)
          doc.text(recortarAAncho(doc, String(p.destino ?? ""), 26), 122, yPos + 3.5)
          const und = Number(p.cantidad) || 0
          const ton = (Number(p.pesoKgs) || 0) / 1000
          doc.text(String(und), 159, yPos + 3.5, { align: "center" })
          doc.text(ton.toFixed(3), 181, yPos + 3.5, { align: "center" })
          ownUnd += und
          ownTon += ton
          yPos += 5
        }
        // Subtotal por Owner
        ensure(5)
        doc.setFillColor(245, 245, 245)
        doc.setDrawColor(180, 180, 180)
        doc.rect(15, yPos, 180, 5, "FD")
        doc.setFont(undefined as any, "bold")
        doc.setFontSize(6.5)
        // Estas filas SI llevan cifras: la de Und. arranca cerca de x=154, asi
        // que el rotulo se corta a 130 mm (20..150) para no montarse encima.
        doc.text(recortarAAncho(doc, `Subtotal ${own}`, 130), 20, yPos + 3.5)
        doc.text(String(ownUnd), 159, yPos + 3.5, { align: "center" })
        doc.text(ownTon.toFixed(3), 181, yPos + 3.5, { align: "center" })
        yPos += 5
        cliUnd += ownUnd
        cliTon += ownTon
      }
      // Subtotal por Cliente
      ensure(5)
      doc.setFillColor(210, 220, 235)
      doc.setDrawColor(150, 160, 180)
      doc.rect(15, yPos, 180, 5, "FD")
      doc.setFont(undefined as any, "bold")
      doc.setFontSize(7)
      doc.setTextColor(0, 0, 0)
      doc.text(recortarAAncho(doc, `Subtotal Cliente ${cli}`, 130), 20, yPos + 3.5)
      doc.text(String(cliUnd), 159, yPos + 3.5, { align: "center" })
      doc.text(cliTon.toFixed(3), 181, yPos + 3.5, { align: "center" })
      yPos += 5
      granUnd += cliUnd
      granTon += cliTon
    }

    // Aviso si algún producto está amarrado a 2+ id_empresa (owner ambiguo).
    if (ownerRes.ambiguos.length > 0) {
      ensure(6)
      doc.setTextColor(180, 0, 0)
      doc.setFontSize(6)
      doc.setFont(undefined as any, "bold")
      doc.text(
        `OJO: producto(s) con 2+ owner, revisar: ${ownerRes.ambiguos.join(", ")}`.substring(0, 120),
        15,
        yPos + 3,
      )
      doc.setTextColor(0, 0, 0)
      yPos += 6
    }

    // TOTAL general de la orden
    yPos += 2
    ensure(6)
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, yPos, 180, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("TOTAL ORDEN", 20, yPos + 4)
    doc.text(String(granUnd), 159, yPos + 4, { align: "center" })
    doc.text(granTon.toFixed(3), 181, yPos + 4, { align: "center" })

    // Asegura espacio para la sección de vehículo/firmas que sigue.
    ensure(78)

    // Vehicle details section
    yPos += 12
    doc.setFont(undefined as any, "normal")
    doc.setFillColor(200, 200, 200)
    doc.rect(15, yPos, 85, 6, "F")
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(9)
    doc.text("Placa", 20, yPos + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, yPos, 95, 6, "S")
    doc.text(orderData.placa, 105, yPos + 4)

    yPos += 6
    doc.setFillColor(200, 200, 200)
    doc.rect(15, yPos, 85, 6, "F")
    doc.text("Conductor", 20, yPos + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, yPos, 95, 6, "S")
    doc.text(orderData.conductor, 105, yPos + 4)

    yPos += 6
    doc.setFillColor(200, 200, 200)
    doc.rect(15, yPos, 85, 6, "F")
    doc.text("Transporte", 20, yPos + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, yPos, 95, 6, "S")
    doc.text(orderData.transporte, 105, yPos + 4)

    yPos += 6
    doc.setFillColor(200, 200, 200)
    doc.rect(15, yPos, 85, 6, "F")
    doc.text("Destino", 20, yPos + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, yPos, 95, 6, "S")
    doc.text(orderData.destino || " ", 105, yPos + 4)

    // Notes section
    yPos += 12
    doc.setFontSize(6)
    doc.text(
      "NOTA: SEÑOR TRANSPORTISTA SE LE INFORMA QUE TODO PRODUCTO QUE LE DEVUELVAN POR AVERÍA O EN MAL ESTADO LE SERÁ DESCONTADO DEL FLETE",
      15,
      yPos,
      { maxWidth: 180 },
    )

    yPos += 8
    doc.text(
      "AL FIRMAR ESTE VALE EN PLANTA, CERTIFICO QUE CONTÉ EL PRODUCTO CARGADO SEGÚN ESTA ORDEN DE CARGUE Y ESTÁ COMPLETO. MANIFIESTO CONOCER LA NORMA Y EN CASO OSISO ASUMIRÉ EL COSTO.",
      15,
      yPos,
      { maxWidth: 180 },
    )
    doc.text("FIRMA DEL CONDUCTOR____________________", 15, yPos + 10)
    doc.text("C.C. No.____________________", 120, yPos + 10)

    yPos += 20
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, yPos, 180, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("Observaciones", 20, yPos + 4)

    yPos += 6
    doc.setDrawColor(200, 200, 200)
    doc.setTextColor(0, 0, 0)
    doc.rect(15, yPos, 180, 15, "S")
    doc.setFontSize(8)
    doc.text(orderData.observaciones || "", 20, yPos + 5, { maxWidth: 175 })

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(6)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    console.log("[v0] PDF generated, creating blob...")

    const pdfBlob = doc.output("blob")
    
    // Generate filename with CONSECUTIVO + AÑO + MES + DÍA + ID format
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    const fileName = `${ordenCargueCode}_${year}${month}${day}_${ordenCargueId}.pdf`
    
    console.log("[v0] Generated PDF filename:", fileName)

    const supabaseAdmin = await getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.storage.from("archivos").upload(`pedidos/${fileName}`, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    })

    if (error) {
      console.error("[v0] Error uploading PDF:", error)
      return { success: false, error: error.message }
    }

    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(`pedidos/${fileName}`)

    console.log("[v0] PDF uploaded successfully:", urlData.publicUrl)
    return { success: true, url: urlData.publicUrl, fileName: fileName }
  } catch (error) {
    console.error("[v0] Error generating PDF:", error)
    return { success: false, error: "Error al generar el PDF" }
  }
}

export async function generateAndUploadOrderPDF_original(
  orderData: {
    idpedido?: number // Add idpedido field
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
    empresaFactura?: string
    observaciones?: string
    groupedProducts: Record<
      string,
      Array<{
        referencia: string
        cantidad: number
        precioUnitario: number
        categoria: string
        peso?: number
      }>
    >
    subtotal: number
    iva: number
    total: number
    kgDespacho?: number
  },
  empresaNombre?: string,
  empresaLogo?: string,
) {
  try {
    console.log("[v0] Generating PDF with empresa data from order")

    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter" })

    // Header with logo
    doc.setFontSize(14)
    doc.text("ORDEN DE PEDIDO", 105, 15, { align: "center" })
    doc.setFontSize(12)
    doc.text(empresaNombre || "EMPRESA", 105, 22, { align: "center" })

    if (empresaLogo) {
      try {
        doc.addImage(empresaLogo, "PNG", 165, 8, 30, 15)
      } catch (error) {
        console.log("[v0] Could not add logo to PDF")
      }
    }

    doc.setFontSize(9)
    doc.text(`NIT: ${orderData.nit || "N/A"}`, 105, 28, { align: "center" })
    doc.text(orderData.carrera || "N/A", 105, 33, { align: "center" })

    doc.setFontSize(8)
    if (orderData.idpedido) {
      doc.text(`Pedido #${orderData.idpedido}`, 15, 40)
      doc.text("VIT-CM-1", 80, 40)
      doc.text("R: 1.0", 120, 40)
      doc.text(`Fecha: ${orderData.fechaPedido}`, 195, 40, { align: "right" })
    } else {
      doc.text("VIT-CM-1", 15, 40)
      doc.text("R: 1.0", 105, 40, { align: "center" })
      doc.text(`Fecha: ${orderData.fechaPedido}`, 195, 40, { align: "right" })
    }
    // </CHANGE>

    // Order info section
    let y = 50
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 45, "F")

    doc.setFontSize(8)
    doc.text(`Fecha de pedido: ${orderData.fechaPedido}`, 20, y + 5)
    doc.text(`Sucursal: ${orderData.nitCliente}`, 20, y + 10)
    doc.text(`Nombre Cliente: ${orderData.nombreCliente}`, 120, y + 10)
    doc.text(`Dirección de entrega: ${orderData.direccionEntrega}`, 20, y + 15)
    doc.text(`Ciudad de entrega: ${orderData.ciudadEntrega}`, 120, y + 15)
    doc.text(`Asesor comercial: ${orderData.asesorComercial}`, 20, y + 20)
    doc.text(`Fecha de entrega: ${orderData.fechaEntrega}`, 120, y + 20)
    doc.text(`Condición de pago: ${orderData.condicionPago}`, 20, y + 25)
    doc.text(`Tipo de despacho: ${orderData.tipoDespacho}`, 120, y + 25)
    if (orderData.empresaFactura) {
      doc.text(`Empresa Factura: ${orderData.empresaFactura}`, 20, y + 30)
    }

    doc.setTextColor(0, 0, 0)
    y += 45

    // Products table header
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 7, "F")
    doc.setFontSize(8)
    doc.setFont(undefined as any, "bold")
    doc.text("#", 17, y + 5)
    doc.text("Referencia", 25, y + 5)
    doc.text("Precio unitario", 95, y + 5)
    doc.text("Cantidad", 130, y + 5)
    doc.text("Peso", 155, y + 5)
    doc.text("Valor total", 175, y + 5)

    doc.setTextColor(0, 0, 0)
    y += 7

    let rowNumber = 1
    doc.setDrawColor(200, 200, 200)
    doc.setFont(undefined as any, "normal")

    // Products grouped by category
    Object.entries(orderData.groupedProducts).forEach(([categoria, categoryProducts]: [string, any]) => {
      doc.setFillColor(245, 245, 245)
      doc.rect(15, y, 180, 6, "FD")
      doc.setFont(undefined as any, "bold")
      doc.text(categoria, 25, y + 4)
      doc.setFont(undefined as any, "normal")
      y += 6

      categoryProducts.forEach((product: any) => {
        doc.rect(15, y, 180, 6, "D")
        doc.text(String(rowNumber), 17, y + 4)
        doc.text(product.referencia || product.producto || "", 25, y + 4)
        doc.text(`$ ${product.precioUnitario.toLocaleString("es-CO")}`, 95, y + 4)
        doc.text(String(product.cantidad), 130, y + 4)
        const pesoValue = product.peso ? Math.round(product.peso).toLocaleString("es-CO") : "0"
        doc.text(pesoValue, 155, y + 4)
        doc.text(`$ ${(product.precioUnitario * product.cantidad).toLocaleString("es-CO")}`, 175, y + 4)
        y += 6
        rowNumber++
      })
    })

    // Fill remaining rows
    const totalRows = 16
    const rowsUsed = rowNumber - 1 + Object.keys(orderData.groupedProducts).length
    for (let i = rowsUsed; i < totalRows; i++) {
      doc.rect(15, y, 180, 6, "D")
      y += 6
    }

    doc.setDrawColor(0, 0, 0)

    // Totals section
    y += 5
    doc.setFillColor(224, 224, 224)
    doc.rect(15, y, 180, 6, "F")
    doc.setFontSize(8)
    doc.setFont(undefined as any, "normal")
    doc.text("Total orden", 20, y + 4)
    doc.text(`$ ${orderData.subtotal.toLocaleString("es-CO")}`, 175, y + 4)

    y += 6
    doc.text("Descuento IVA", 20, y + 4)
    doc.text(`$ ${orderData.iva.toLocaleString("es-CO")}`, 175, y + 4)

    y += 6
    doc.text("Descuento pronto pago", 20, y + 4)
    doc.text(`$ 0`, 175, y + 4)

    y += 6
    doc.setFont(undefined as any, "bold")
    doc.text("Total a pagar", 20, y + 4)
    doc.text(`$ ${orderData.total.toLocaleString("es-CO")}`, 175, y + 4)

    y += 6
    doc.text("Kg Despacho", 20, y + 4)
    doc.text(Math.round(orderData.kgDespacho || 0).toLocaleString("es-CO"), 155, y + 4)

    // Observaciones
    y += 10
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("Observaciones", 20, y + 4)

    y += 6
    doc.setDrawColor(200, 200, 200)
    doc.rect(15, y, 180, 15, "S")
    doc.setFont(undefined as any, "normal")
    doc.setTextColor(0, 0, 0)
    doc.text(orderData.observaciones || "", 20, y + 5)

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(6)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    const pdfBlob = doc.output("blob")
    const fileName = `pedido_${Date.now()}.pdf`

    const supabaseAdmin = await getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.storage.from("archivos").upload(`pedidos/${fileName}`, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    })

    if (error) {
      console.error("[v0] Error uploading PDF:", error)
      return { success: false, error: error.message }
    }

    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(`pedidos/${fileName}`)

    console.log("[v0] PDF uploaded successfully:", urlData.publicUrl)
    return { success: true, url: urlData.publicUrl }
  } catch (error) {
    console.error("[v0] Error generating PDF:", error)
    return { success: false, error: "Error al generar el PDF" }
  }
}

export async function generateAndUploadLoadOrderPDF_original(
  orderData: any,
  ordenCargueId: number,
  ordenCargueCode: string,
) {
  try {
    console.log("[v0] Starting PDF generation for load order:", ordenCargueCode)
    console.log("[v0] OrderData received:", JSON.stringify(orderData, null, 2))
    console.log("[v0] EmpresaId from orderData:", orderData.empresaId)

    let empresaData = {
      nombre: "EMPRESA",
      nit: "N/A",
      direccion: "N/A",
      logo: null as string | null,
    }

    if (orderData.empresaId) {
      console.log("[v0] Fetching empresa data for ID:", orderData.empresaId)
      const supabaseAdmin = await getSupabaseAdmin()
      const { data: empresa, error: empresaError } = await supabaseAdmin
        .from("empresas")
        .select("nombre, nit, direccion, logo")
        .eq("id", orderData.empresaId)
        .maybeSingle()

      console.log("[v0] Empresa query result:", { empresa, error: empresaError })

      if (empresaError) {
        console.error("[v0] Error fetching empresa data:", empresaError)
      } else if (empresa) {
        empresaData = {
          nombre: empresa.nombre || "EMPRESA",
          nit: empresa.nit || "N/A",
          direccion: empresa.direccion || "N/A",
          logo: empresa.logo || null,
        }
        console.log("[v0] Using empresa data from pedido:", empresaData)
      } else {
        console.log("[v0] No empresa found with ID:", orderData.empresaId)
      }
    } else {
      console.log("[v0] No empresaId provided in orderData")
    }

    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter" })

    // Header with company info
    doc.setFontSize(16)
    doc.setTextColor(200, 16, 46)
    doc.setFont(undefined as any, "bold")
    doc.text(empresaData.nombre || "EMPRESA", 105, 15, { align: "center" })

    if (empresaData.logo) {
      try {
        doc.addImage(empresaData.logo, "PNG", 165, 8, 30, 15)
      } catch (error) {
        console.log("[v0] Could not add logo to PDF to PDF:", error)
      }
    }

    doc.setFontSize(8)
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.text(`NIT: ${empresaData.nit || "N/A"}`, 105, 20, { align: "center" })
    doc.text(empresaData.direccion || "N/A", 105, 25, { align: "center" })
    doc.text("Formato Orden de Cargue", 105, 30, { align: "center" })

    // Order info header
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, 35, 85, 6, "F")
    doc.setFontSize(10)
    doc.text("Fecha y Hora", 20, 39)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(100, 35, 95, 6, "F")
    doc.text(orderData.fechaHora, 105, 39)

    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, 42, 85, 6, "F")
    doc.text("OC", 20, 46)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(100, 42, 95, 6, "F")
    doc.text(ordenCargueCode, 105, 46)

    let yPos = 52
    doc.setFillColor(100, 100, 100)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, yPos, 180, 6, "F")

    doc.setFontSize(8)
    doc.setFont(undefined as any, "bold")
    doc.text("Cliente", 20, yPos + 4)
    doc.text("Destino", 63, yPos + 4)
    doc.text("Producto", 90, yPos + 4)
    doc.text("Und.", 152, yPos + 4, { align: "center" })
    doc.text("Peso (Ton)", 172, yPos + 4, { align: "center" })

    yPos += 6
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(6)
    doc.setTextColor(0, 0, 0)
    doc.setDrawColor(200, 200, 200)

    orderData.products.forEach((product: any) => {
      doc.rect(15, yPos, 35, 6, "S")
      doc.rect(50, yPos, 35, 6, "S")
      doc.rect(85, yPos, 55, 6, "S")
      doc.rect(140, yPos, 20, 6, "S")
      doc.rect(160, yPos, 35, 6, "S")

      doc.text(product.cliente.substring(0, 18), 17, yPos + 4)
      doc.text(product.destino.substring(0, 18), 52, yPos + 4)
      doc.text(product.producto.substring(0, 32), 87, yPos + 4)
      doc.text(String(product.cantidad), 147, yPos + 4, { align: "center" })
      doc.text(((product.pesoKgs || 0) / 1000).toFixed(3), 177, yPos + 4, { align: "center" })

      yPos += 6
    })

    // Add empty rows if needed
    const minRows = 8
    const currentRows = orderData.products.length
    if (currentRows < minRows) {
      for (let i = 0; i < minRows - currentRows; i++) {
        doc.rect(15, yPos, 35, 6, "S")
        doc.rect(50, yPos, 35, 6, "S")
        doc.rect(85, yPos, 55, 6, "S")
        doc.rect(140, yPos, 20, 6, "S")
        doc.rect(160, yPos, 35, 6, "S")

        yPos += 6
      }
    }

    yPos += 2
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, yPos, 125, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("TOTALES", 20, yPos + 4)

    doc.setFillColor(255, 255, 255)
    doc.setTextColor(0, 0, 0)
    doc.rect(140, yPos, 20, 6, "FD")
    doc.text(String(orderData.totalUnidades), 150, yPos + 4, { align: "center" })

    doc.setFillColor(255, 255, 255)
    doc.rect(160, yPos, 35, 6, "FD")
    doc.text(String(orderData.totalPeso), 177, yPos + 4, { align: "center" })

    // Vehicle details section
    yPos += 12
    doc.setFont(undefined as any, "normal")
    doc.setFillColor(200, 200, 200)
    doc.rect(15, yPos, 85, 6, "F")
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(9)
    doc.text("Placa", 20, yPos + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, yPos, 95, 6, "S")
    doc.text(orderData.placa, 105, yPos + 4)

    yPos += 6
    doc.setFillColor(200, 200, 200)
    doc.rect(15, yPos, 85, 6, "F")
    doc.text("Conductor", 20, yPos + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, yPos, 95, 6, "S")
    doc.text(orderData.conductor, 105, yPos + 4)

    yPos += 6
    doc.setFillColor(200, 200, 200)
    doc.rect(15, yPos, 85, 6, "F")
    doc.text("Transporte", 20, yPos + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, yPos, 95, 6, "S")
    doc.text(orderData.transporte, 105, yPos + 4)

    yPos += 6
    doc.setFillColor(200, 200, 200)
    doc.rect(15, yPos, 85, 6, "F")
    doc.text("Destino", 20, yPos + 4)

    doc.setFillColor(255, 255, 255)
    doc.rect(100, yPos, 95, 6, "S")
    doc.text(orderData.destino || " ", 105, yPos + 4)

    // Notes section
    yPos += 12
    doc.setFontSize(6)
    doc.text(
      "NOTA: SEÑOR TRANSPORTISTA SE LE INFORMA QUE TODO PRODUCTO QUE LE DEVUELVAN POR AVERÍA O EN MAL ESTADO LE SERÁ DESCONTADO DEL FLETE",
      15,
      yPos,
      { maxWidth: 180 },
    )

    yPos += 8
    doc.text(
      "AL FIRMAR ESTE VALE EN PLANTA, CERTIFICO QUE CONTÉ EL PRODUCTO CARGADO SEGÚN ESTA ORDEN DE CARGUE Y ESTÁ COMPLETO. MANIFIESTO CONOCER LA NORMA Y EN CASO OSISO ASUMIRÉ EL COSTO.",
      15,
      yPos,
      { maxWidth: 180 },
    )
    doc.text("FIRMA DEL CONDUCTOR____________________", 15, yPos + 10)
    doc.text("C.C. No.____________________", 120, yPos + 10)

    yPos += 20
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, yPos, 180, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("Observaciones", 20, yPos + 4)

    yPos += 6
    doc.setDrawColor(200, 200, 200)
    doc.setTextColor(0, 0, 0)
    doc.rect(15, yPos, 180, 15, "S")
    doc.setFontSize(8)
    doc.text(orderData.observaciones || "", 20, yPos + 5, { maxWidth: 175 })

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(6)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    console.log("[v0] PDF generated, creating blob...")

    const pdfBlob = doc.output("blob")
    const fileName = `pedido_${Date.now()}.pdf`

    const supabaseAdmin = await getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.storage.from("archivos").upload(`pedidos/${fileName}`, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    })

    if (error) {
      console.error("[v0] Error uploading PDF:", error)
      return { success: false, error: error.message }
    }

    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(`pedidos/${fileName}`)

    console.log("[v0] PDF uploaded successfully:", urlData.publicUrl)
    return { success: true, url: urlData.publicUrl }
  } catch (error) {
    console.error("[v0] Error generating PDF:", error)
    return { success: false, error: "Error al generar el PDF" }
  }
}

export async function generateAndUploadTransferRequestPDF(transferData: any, idpedido: number, pedidoCode: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Recepción de Traslado", "Traslados de producto"], "ver")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    console.log("[v0] Starting PDF generation for transfer request:", pedidoCode)

    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter" })

    // Header
    doc.setFontSize(16)
    doc.setTextColor(200, 16, 46)
    doc.setFont(undefined as any, "bold")
    doc.text("SOLICITUD DE TRASLADO", 105, 20, { align: "center" })

    doc.setFontSize(10)
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.text(`Código: ${pedidoCode}`, 105, 28, { align: "center" })
    doc.text(`Fecha: ${transferData.fecha}`, 105, 34, { align: "center" })

    // Transfer info section
    let y = 45
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 25, "F")

    doc.setFontSize(9)
    doc.text("Bodega Origen:", 20, y + 6)
    doc.setFont(undefined as any, "bold")
    doc.text(transferData.bodegaOrigen, 55, y + 6)

    doc.setFont(undefined as any, "normal")
    doc.text("Bodega Destino:", 20, y + 14)
    doc.setFont(undefined as any, "bold")
    doc.text(transferData.bodegaDestino, 55, y + 14)

    doc.setFont(undefined as any, "normal")
    doc.text("Ciudad Destino:", 20, y + 22)
    doc.setFont(undefined as any, "bold")
    doc.text(transferData.ciudadDestino, 55, y + 22)

    // Products table header
    y = 75
    doc.setFillColor(100, 100, 100)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 7, "F")
    doc.setFontSize(8)
    doc.setFont(undefined as any, "bold")
    doc.text("#", 18, y + 5)
    doc.text("Categoría", 30, y + 5)
    doc.text("Producto", 75, y + 5)
    doc.text("Cantidad", 145, y + 5, { align: "center" })
    doc.text("Peso (kg)", 175, y + 5, { align: "center" })

    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(6)
    y += 7

    let rowNumber = 1
    doc.setDrawColor(200, 200, 200)

    // Products list
    transferData.products.forEach((product: any) => {
      doc.rect(15, y, 10, 6, "S") // #
      doc.rect(25, y, 45, 6, "S") // Categoría
      doc.rect(70, y, 70, 6, "S") // Producto
      doc.rect(140, y, 20, 6, "S") // Cantidad
      doc.rect(160, y, 35, 6, "S") // Peso

      doc.text(String(rowNumber), 18, y + 4)
      doc.text(product.categoria.substring(0, 25), 27, y + 4)
      doc.text(product.producto.substring(0, 40), 72, y + 4)
      doc.text(String(product.cantidad), 150, y + 4, { align: "center" })
      doc.text(product.peso.toFixed(2), 177, y + 4, { align: "center" })

      y += 6
      rowNumber++
    })

    // Add empty rows to fill page
    const minRows = 15
    const currentRows = transferData.products.length
    if (currentRows < minRows) {
      for (let i = 0; i < minRows - currentRows; i++) {
        doc.rect(15, y, 10, 6, "S")
        doc.rect(25, y, 45, 6, "S")
        doc.rect(70, y, 70, 6, "S")
        doc.rect(140, y, 20, 6, "S")
        doc.rect(160, y, 35, 6, "S")
        y += 6
      }
    }

    doc.setDrawColor(0, 0, 0)

    // Totals section
    y += 2
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 125, 6, "F")
    doc.setFontSize(9)
    doc.setFont(undefined as any, "bold")
    doc.text("TOTALES", 20, y + 4)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(140, y, 20, 6, "F")
    doc.text(String(transferData.totalUnidades), 150, y + 4, { align: "center" })

    doc.rect(160, y, 35, 6, "F")
    doc.text(transferData.totalPeso.toFixed(2), 177, y + 4, { align: "center" })

    y += 6
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(8)
    doc.text(
      `Peso Total: ${transferData.totalPeso.toFixed(2)} kg (${(transferData.totalPeso / 1000).toFixed(3)} ton)`,
      20,
      y + 4,
    )

    // Signatures section
    y += 20
    doc.setFontSize(9)
    doc.text("Solicitado por:", 30, y)
    doc.text("Autorizado por:", 130, y)

    y += 5
    doc.line(20, y, 80, y)
    doc.line(120, y, 180, y)

    y += 5
    doc.setFontSize(8)
    doc.text("Nombre y Firma", 40, y)
    doc.text("Nombre y Firma", 140, y)

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(6)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    console.log("[v0] Transfer request PDF generated, creating blob...")

    // Generate PDF blob
    const pdfBlob = doc.output("blob")
    const fileName = `traslado_${pedidoCode}_${Date.now()}.pdf`

    console.log("[v0] Uploading PDF to storage...")

    // Upload to Supabase Storage
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase.storage.from("archivos").upload(`pedidos/${fileName}`, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    })

    if (error) {
      console.error("[v0] Error uploading transfer PDF:", error.message)
      return { success: false, error: error.message }
    }

    const { data: urlData } = supabase.storage.from("archivos").getPublicUrl(`pedidos/${fileName}`)

    console.log("[v0] Transfer PDF uploaded successfully:", urlData.publicUrl)
    return { success: true, url: urlData.publicUrl, message: "Solicitud de traslado registrada exitosamente" }
  } catch (error) {
    console.error("[v0] Error generating transfer request PDF:", error)
    return { success: false, error: "Error al generar el PDF de la solicitud de traslado" }
  }
}

export async function generateAndUploadProductionEntryPDF(productionData: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ingreso de Producción", "Ver ingresos de producción"], "ver")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    console.log("[v0] Starting PDF generation for production entry")

    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter" })

    // Header
    doc.setFontSize(14)
    doc.setTextColor(200, 16, 46)
    doc.setFont(undefined as any, "bold")
    doc.text("INGRESO DE PRODUCCIÓN", 105, 20, { align: "center" })

    doc.setFontSize(9)
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.text(`Fecha: ${productionData.fecha}`, 105, 27, { align: "center" })
    doc.text(`Hora: ${productionData.hora}`, 105, 32, { align: "center" })

    // Products table header
    let y = 45
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(10, y, 190, 6, "F")
    doc.setFontSize(6)
    doc.setFont(undefined as any, "bold")
    doc.text("#", 12, y + 4)
    doc.text("Producto", 20, y + 4)
    doc.text("Código", 65, y + 4)
    doc.text("Lote", 87, y + 4)
    doc.text("F.Venc.", 109, y + 4)
    doc.text("F.Prod.", 131, y + 4)
    doc.text("Observaciones", 153, y + 4)
    doc.text("Cant.", 195, y + 4, { align: "right" })

    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(6)
    y += 6

    let rowNumber = 1
    doc.setDrawColor(200, 200, 200)

    // Products list
    productionData.products.forEach((product: any) => {
      const observacionesText = product.observaciones || "-"
      const splitObservaciones = doc.splitTextToSize(observacionesText, 32) // Width of 32 for observaciones column
      const rowHeight = Math.max(5, splitObservaciones.length * 3) // Minimum 5, or 3 units per line

      doc.rect(10, y, 8, rowHeight, "S")
      doc.rect(18, y, 45, rowHeight, "S")
      doc.rect(63, y, 22, rowHeight, "S")
      doc.rect(85, y, 22, rowHeight, "S")
      doc.rect(107, y, 22, rowHeight, "S")
      doc.rect(129, y, 22, rowHeight, "S")
      doc.rect(151, y, 34, rowHeight, "S")
      doc.rect(185, y, 15, rowHeight, "S")

      doc.text(String(rowNumber), 12, y + 3.5)
      doc.text(product.producto.substring(0, 22), 20, y + 3.5)
      doc.text(product.codigo_producto || "", 65, y + 3.5)
      doc.text(product.lote || "", 87, y + 3.5)
      doc.text(
        product.fechavencimiento ? new Date(product.fechavencimiento).toLocaleDateString("es-CO") : "-",
        109,
        y + 3.5,
      )
      doc.text(
        product.fechaproduccion ? new Date(product.fechaproduccion).toLocaleDateString("es-CO") : "-",
        131,
        y + 3.5,
      )

      if (splitObservaciones.length === 1) {
        doc.text(splitObservaciones[0], 153, y + 3.5)
      } else {
        // Multiple lines - render each line
        splitObservaciones.forEach((line: string, index: number) => {
          doc.text(line, 153, y + 3.5 + index * 3)
        })
      }

      doc.text(String(product.cantidad), 198, y + 3.5, { align: "right" })

      y += rowHeight
      rowNumber++
    })

    // Add empty rows to fill page
    const minRows = 25
    const currentRows = productionData.products.length
    if (currentRows < minRows) {
      for (let i = 0; i < minRows - currentRows; i++) {
        doc.rect(10, y, 8, 5, "S")
        doc.rect(18, y, 45, 5, "S")
        doc.rect(63, y, 22, 5, "S")
        doc.rect(85, y, 22, 5, "S")
        doc.rect(107, y, 22, 5, "S")
        doc.rect(129, y, 22, 5, "S")
        doc.rect(151, y, 34, 5, "S")
        doc.rect(185, y, 15, 5, "S")
        y += 5
      }
    }

    doc.setDrawColor(0, 0, 0)

    // Totals section
    y += 2
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(10, y, 175, 5, "F")
    doc.setFontSize(8)
    doc.setFont(undefined as any, "bold")
    doc.text("TOTAL DE LÍNEAS", 15, y + 3.5)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(185, y, 15, 5, "F")
    doc.text(String(productionData.totalLineas), 192, y + 3.5, { align: "center" })

    // Signatures section
    y += 15
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(8)
    doc.text("Registrado por:", 30, y)
    doc.text("Aprobado por:", 130, y)

    y += 5
    doc.line(20, y, 80, y)
    doc.line(120, y, 180, y)

    y += 5
    doc.setFontSize(6)
    doc.text("Nombre y Firma", 40, y)
    doc.text("Nombre y Firma", 140, y)

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(6)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    console.log("[v0] Production entry PDF generated, creating blob...")

    // Generate PDF blob
    const pdfBlob = doc.output("blob")
    const fileName = `ingreso_prod_${Date.now()}.pdf`

    console.log("[v0] Uploading PDF to storage...")

    // Upload to Supabase Storage
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase.storage.from("archivos").upload(`ingresoprod/${fileName}`, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    })

    if (error) {
      console.error("[v0] Error uploading production entry PDF:", error.message)
      return { success: false, error: error.message }
    }

    const { data: urlData } = supabase.storage.from("archivos").getPublicUrl(`ingresoprod/${fileName}`)

    console.log("[v0] Production entry PDF uploaded successfully:", urlData.publicUrl)
    return { success: true, url: urlData.publicUrl, message: "Ingreso de producción registrado exitosamente" }
  } catch (error) {
    console.error("[v0] Error generating production entry PDF:", error)
    return { success: false, error: String(error) }
  }
}

export async function generateAndUploadBatchAssignmentPDF(batchData: any, ordenCargue: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Asignación de Lotes", "Historial de lotes"], "ver")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    console.log("[v0] Starting PDF generation for batch assignment:", ordenCargue)

    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter" })

    // Header
    doc.setFontSize(16)
    doc.setTextColor(200, 16, 46)
    doc.setFont(undefined as any, "bold")
    doc.text("ASIGNACIÓN DE LOTES", 105, 20, { align: "center" })

    doc.setFontSize(10)
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.text(`Orden de Cargue: ${ordenCargue}`, 105, 28, { align: "center" })

    // La PLACA en negrita y en su propia línea: es lo que busca primero quien
    // recibe el documento en piso. Si la orden todavía no tiene vehículo
    // asignado se dice explícitamente, en vez de dejar el renglón vacío.
    doc.setFont(undefined as any, "bold")
    doc.text(
      batchData.placa
        ? `Vehículo: ${batchData.placa}${batchData.conductor ? ` — ${batchData.conductor}` : ""}`
        : "Vehículo: sin asignar",
      105,
      34,
      { align: "center" },
    )
    doc.setFont(undefined as any, "normal")

    doc.text(`Fecha: ${batchData.fecha}`, 105, 40, { align: "center" })
    doc.text(`Hora: ${batchData.hora}`, 105, 46, { align: "center" })

    // Products table header
    // Column layout: # = 7, Cliente = 30, Producto = 78 (much wider), Cod = 15, Lote = 18, Loc = 16, Cant = 16
    // y = 61 y no 55: el encabezado gano el renglon del vehiculo y la hora bajo
    // a 46. Con 55 la primera fila de la tabla se montaba sobre la hora.
    let y = 61
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 6, "F")
    doc.setFontSize(6)
    doc.setFont(undefined as any, "bold")
    doc.text("#", 17, y + 4)
    doc.text("Cliente", 24, y + 4)
    doc.text("Producto", 54, y + 4)
    doc.text("Cod", 134, y + 4)
    doc.text("Lote", 150, y + 4)
    doc.text("Loc", 168, y + 4)
    doc.text("Cant", 192, y + 4, { align: "right" })

    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(5)
    y += 6

    let rowNumber = 1
    doc.setDrawColor(200, 200, 200)

    // Products list grouped by client
    batchData.allocations.forEach((allocation: any) => {
      const esAlterno = allocation.esAlterno === true

      // Resaltar en amarillo la fila completa cuando es un lote alterno.
      if (esAlterno) {
        doc.setFillColor(255, 243, 205)
        doc.rect(15, y, 180, 5, "F")
      }

      doc.rect(15, y, 7, 5, "S") // #
      doc.rect(22, y, 30, 5, "S") // Cliente
      doc.rect(52, y, 78, 5, "S") // Producto (much wider)
      doc.rect(130, y, 17, 5, "S") // Codigo (smaller)
      doc.rect(147, y, 18, 5, "S") // Lote (smaller)
      doc.rect(165, y, 14, 5, "S") // Localizacion (smaller)
      doc.rect(179, y, 16, 5, "S") // Cantidad (smaller)

      doc.text(String(rowNumber), 17, y + 3.5)
      doc.text(allocation.cliente.substring(0, 16), 23, y + 3.5)
      doc.text(allocation.producto.substring(0, 50), 53, y + 3.5)
      doc.text((allocation.codigo || "").substring(0, 9), 131, y + 3.5)

      // Lote: si es alterno se imprime el lote seguido de "(lote alterno)".
      if (esAlterno) {
        const loteText = allocation.lote.substring(0, 8)
        doc.setFont(undefined as any, "bold")
        doc.text(loteText, 148, y + 2.3)
        doc.setFont(undefined as any, "normal")
        doc.setFontSize(3.2)
        doc.text("(lote alterno)", 148, y + 4.4)
        doc.setFontSize(5)
      } else {
        doc.text(allocation.lote.substring(0, 10), 148, y + 3.5)
      }

      doc.text(allocation.location.substring(0, 8), 166, y + 3.5)
      doc.text(String(allocation.cantidad), 193, y + 3.5, { align: "right" })

      y += 5
      rowNumber++
    })

    // Add empty rows to fill page
    const minRows = 30
    const currentRows = batchData.allocations.length
    if (currentRows < minRows) {
      for (let i = 0; i < minRows - currentRows; i++) {
        doc.rect(15, y, 7, 5, "S")
        doc.rect(22, y, 30, 5, "S")
        doc.rect(52, y, 78, 5, "S")
        doc.rect(130, y, 17, 5, "S")
        doc.rect(147, y, 18, 5, "S")
        doc.rect(165, y, 14, 5, "S")
        doc.rect(179, y, 16, 5, "S")
        y += 5
      }
    }

    doc.setDrawColor(0, 0, 0)

    // Totals section
    y += 2
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 164, 5, "F")
    doc.setFontSize(7)
    doc.setFont(undefined as any, "bold")
    doc.text("TOTAL ASIGNACIONES", 20, y + 3.5)

    doc.setFillColor(224, 224, 224)
    doc.setTextColor(0, 0, 0)
    doc.rect(179, y, 16, 5, "F")
    doc.text(String(batchData.totalAsignaciones), 187, y + 3.5, { align: "center" })

    // Signatures section
    y += 20
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(9)
    doc.text("Aprobado por:", 30, y)
    doc.text("Recibido por:", 130, y)

    y += 5
    doc.line(20, y, 80, y)
    doc.line(120, y, 180, y)

    y += 5
    doc.setFontSize(8)
    doc.text("Nombre y Firma", 40, y)
    doc.text("Nombre y Firma", 140, y)

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(6)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    console.log("[v0] Batch assignment PDF generated, creating blob...")

    // Generate PDF blob
    const pdfBlob = doc.output("blob")
    const fileName = `asignacion_lotes_${ordenCargue}_${Date.now()}.pdf`

    console.log("[v0] Uploading PDF to storage...")

    // Upload to Supabase Storage
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase.storage.from("archivos").upload(`asignacionlotes/${fileName}`, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    })

    if (error) {
      console.error("[v0] Error uploading batch assignment PDF:", error.message)
      return { success: false, error: error.message }
    }

    const { data: urlData } = supabase.storage.from("archivos").getPublicUrl(`asignacionlotes/${fileName}`)

    console.log("[v0] Batch assignment PDF uploaded successfully:", urlData.publicUrl)
    return { success: true, url: urlData.publicUrl, message: "Asignación de lotes registrada exitosamente" }
  } catch (error) {
    console.error("[v0] Error generating batch assignment PDF:", error)
    return { success: false, error: "Error al generar el PDF de asignación de lotes" }
  }
}

export async function generateAndUploadSanitaryRegistryPDF(sanitaryData: {
  id: number
  ordencargue?: string | null
  placa: string
  conductor: string
  producto: string
  carpas: string
  limpieza: string
  olores: string
  plastico: string
  fumigacion: string
  plaguicida: string
  fumigador: string
  observaciones: string
  auxiliar: string
  fecha: string
  hora: string
  aprobacion: string
  isVehicleOnly?: boolean
}) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Registro sanitario", "Ver historial de Inspección"], "ver")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    console.log("[v0] Starting PDF generation for sanitary registry")

    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter" })

    // Header
    doc.setFontSize(16)
    doc.setTextColor(200, 16, 46)
    doc.setFont(undefined as any, "bold")
    doc.text("REGISTRO SANITARIO DE VEHÍCULO", 105, 20, { align: "center" })

    // Document info
    doc.setFontSize(10)
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.text(`Registro No: ${sanitaryData.id}`, 15, 35)
    doc.text(`Fecha: ${sanitaryData.fecha}`, 15, 41)
    doc.text(`Hora: ${sanitaryData.hora}`, 15, 47)

    // Status badge
    doc.setFontSize(12)
    doc.setFont(undefined as any, "bold")
    if (sanitaryData.aprobacion === "aprobado") {
      doc.setTextColor(0, 128, 0)
      doc.text("APROBADO", 170, 35)
    } else {
      doc.setTextColor(255, 0, 0)
      doc.text("RECHAZADO", 165, 35)
    }
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")

    let y = 60

    // Vehicle Information Section
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 7, "F")
    doc.setFontSize(10)
    doc.setFont(undefined as any, "bold")
    doc.text("DATOS DEL VEHÍCULO", 20, y + 5)

    y += 12
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(9)

    if (!sanitaryData.isVehicleOnly && sanitaryData.ordencargue) {
      doc.text(`Orden de Cargue: ${sanitaryData.ordencargue}`, 20, y)
      y += 6
    }

    doc.text(`Placa: ${sanitaryData.placa}`, 20, y)
    doc.text(`Conductor: ${sanitaryData.conductor}`, 110, y)
    y += 6
    doc.text(`Producto: ${sanitaryData.producto || "N/A"}`, 20, y)

    y += 10

    // Inspection Checklist Section
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 7, "F")
    doc.setFontSize(10)
    doc.setFont(undefined as any, "bold")
    doc.text("INSPECCIÓN SANITARIA", 20, y + 5)

    y += 12
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(9)

    // Checklist items
    const checklistItems = [
      { label: "¿Paredes y pisos en buen estado?", value: sanitaryData.carpas },
      { label: "¿Cumple con limpieza (sin extraños)?", value: sanitaryData.limpieza },
      { label: "¿Libre de olores extraños?", value: sanitaryData.olores },
      { label: "¿Cuenta con protección para el piso?", value: sanitaryData.plastico },
      { label: "¿Se realizó fumigación del vehículo?", value: sanitaryData.fumigacion },
    ]

    checklistItems.forEach((item) => {
      doc.text(item.label, 20, y)

      // Checkbox
      if (item.value === "Si") {
        doc.setFillColor(0, 128, 0)
        doc.rect(160, y - 3, 4, 4, "F")
        doc.setTextColor(0, 128, 0)
        doc.text("Sí", 170, y)
      } else {
        doc.setFillColor(255, 0, 0)
        doc.rect(160, y - 3, 4, 4, "F")
        doc.setTextColor(255, 0, 0)
        doc.text("No", 170, y)
      }
      doc.setTextColor(0, 0, 0)

      y += 6
    })

    y += 5

    // Fumigation details (if applicable)
    if (sanitaryData.fumigacion === "Si") {
      doc.setFillColor(44, 82, 130)
      doc.setTextColor(255, 255, 255)
      doc.rect(15, y, 180, 7, "F")
      doc.setFontSize(10)
      doc.setFont(undefined as any, "bold")
      doc.text("DETALLES DE FUMIGACIÓN", 20, y + 5)

      y += 12
      doc.setTextColor(0, 0, 0)
      doc.setFont(undefined as any, "normal")
      doc.setFontSize(9)
      doc.text(`Plaguicida Usado: ${sanitaryData.plaguicida || "N/A"}`, 20, y)
      y += 6
      doc.text(`Nombre del Fumigador: ${sanitaryData.fumigador || "N/A"}`, 20, y)
      y += 10
    }

    // Observations Section
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 7, "F")
    doc.setFontSize(10)
    doc.setFont(undefined as any, "bold")
    doc.text("OBSERVACIONES", 20, y + 5)

    y += 12
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(9)

    const observations = sanitaryData.observaciones || "Ninguna"
    const obsLines = doc.splitTextToSize(observations, 170)
    doc.text(obsLines, 20, y)
    y += obsLines.length * 5 + 10

    // Personnel Section
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 7, "F")
    doc.setFontSize(10)
    doc.setFont(undefined as any, "bold")
    doc.text("PERSONAL RESPONSABLE", 20, y + 5)

    y += 12
    doc.setTextColor(0, 0, 0)
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(9)
    doc.text(`Auxiliar Logístico: ${sanitaryData.auxiliar}`, 20, y)

    // Signatures section
    y += 20
    doc.setFont(undefined as any, "normal")
    doc.setFontSize(9)
    doc.text("Revisado por:", 30, y)
    doc.text("Conductor:", 130, y)

    y += 5
    doc.line(20, y, 80, y)
    doc.line(120, y, 180, y)

    y += 5
    doc.setFontSize(8)
    doc.text("Nombre y Firma", 40, y)
    doc.text("Nombre y Firma", 140, y)

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(6)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })
    doc.text(`Documento generado el ${new Date().toLocaleString("es-CO")}`, 105, 275, { align: "center" })

    console.log("[v0] Sanitary registry PDF generated, creating blob...")

    // Generate PDF blob
    const pdfBlob = doc.output("blob")
    const fileName = `registro_sanitario_${sanitaryData.id}_${Date.now()}.pdf`

    console.log("[v0] Uploading sanitary registry PDF to storage...")

    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase.storage
      .from("archivos")
      .upload(`registrossanitariospdf/${fileName}`, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (error) {
      console.error("[v0] Error uploading sanitary registry PDF:", error.message)
      return { success: false, error: error.message }
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("archivos").getPublicUrl(`registrossanitariospdf/${fileName}`)

    console.log("[v0] Sanitary registry PDF uploaded successfully:", publicUrl)
    return { success: true, url: publicUrl }
  } catch (error) {
    console.error("[v0] Error generating sanitary registry PDF:", error)
    return { success: false, error: "Error al generar el PDF del registro sanitario" }
  }
}
