"use server"

import { createClient } from "@/lib/supabase-client"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { generateAndUploadBatchAssignmentPDF } from "@/lib/pdf-actions"
import { getColombiaDate, getColombiaISO, getColombiaTime } from "@/lib/date-utils"
import { getCurrentUserContext } from "@/lib/company-filter"
import { generarDistribucionAutomatica, autoGenerarDescarguesCedi } from "@/lib/orders-actions"
import { reportarInterno } from "@/lib/reporte-interno-actions"
import { registrarErrorServidor } from "@/lib/errores-servidor"
import { validarAsignacionContraOrden } from "@/lib/asignacion-lote-regla"

export interface LoadOrder {
  id: number
  ordendecargue: string
  placa: string | null
}

export interface OrderProduct {
  id: number // This is the detalleoc id
  idorden: number
  producto: string
  cantidad: number
  cliente: string
}

export interface InventoryLot {
  codproducto: string
  nombreproducto: string
  lote: string
  location: string
  stock_actual: number
}

export interface BatchApprovalData {
  ordendecargue: string
  /**
   * Id de la orden en `cabeceraoc`. La pantalla SIEMPRE lo manda: es la llave con la que
   * el servidor lee el detalle autorizado y confronta lo asignado. Sin él hay que resolver
   * la orden por su número, y `cabeceraoc` tiene códigos repetidos (hallazgo abierto), así
   * que ese camino puede ser ambiguo y por eso se rechaza si lo es.
   */
  idorden?: number
  allocations: {
    cliente: string
    producto: string
    lote: string
    location: string
    cantidad: number
    // Cuando es true, el registro en invtrans se marca con status "Lote alterno".
    esAlterno?: boolean
  }[]
}

export interface BatchHistoryRecord {
  id: number
  fecha: string
  cliente: string
  producto: string
  lote: string
  location: string
  cantidad: number
  ordendecargue: string
  pdf: string | null // Added pdf field
  placa: string | null // Placa del vehiculo al que se le hizo la aprobacion de lotes
}

export interface UpdateBatchHistoryData {
  id: number
  cliente: string
  producto: string
  lote: string
  location: string
  cantidad: number
  ordendecargue: string
  placa: string | null
}

// BLINDAJE (2026-10-02): la orden con la que se guardan las salidas de
// inventario se resuelve en la base por su id, en el momento de aprobar.
// Caso real ID3, 30-sep: la asignación de la orden MOL202609309719 se
// guardó con las líneas de MOL202609309720 (la orden de HERMARLY se había
// creado y eliminado dos veces esa mañana y la pantalla quedó con un
// número en memoria que ya no correspondía): 9720 quedó registrada dos
// veces y 9719 nunca. Devuelve null si la orden ya no existe.
export async function getLoadOrderById(id: number): Promise<{ id: number; ordendecargue: string; placa: string | null } | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("cabeceraoc").select("id, ordendecargue, placa").eq("id", id).maybeSingle()
    if (error || !data) return null
    return { id: data.id, ordendecargue: data.ordendecargue, placa: data.placa ?? null }
  } catch {
    return null
  }
}

export async function getAvailableLoadOrders(selectedEmpresaId?: number | null): Promise<LoadOrder[]> {
  try {
    // Use selectedEmpresaId if provided, otherwise fall back to current user's empresa_id
    let currentEmpresaId = selectedEmpresaId
    if (!currentEmpresaId) {
      const { empresaId } = await getCurrentUserContext()
      currentEmpresaId = empresaId || 1
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("cabeceraoc")
      .select("id, ordendecargue, placa")
      .is("horalote", null)
      .eq("idempresa", currentEmpresaId) // Filter by empresa_id from session
      .neq("tipooperacion", "Tolva") // Exclude orders with tipooperacion = "Tolva"
      .neq("tipooperacion", "proyeccion") // Exclude orders with tipooperacion = "proyeccion"
      // Los CLONES de distribución (+D) NO asignan lotes: son copia exacta de la
      // orden madre (que ya tiene sus lotes) y solo se tramitan en Packing y se ven
      // en el dashboard del día. Sin esto aparecían aquí por nacer con horalote null.
      .neq("tipooperacion", "Distribucion")
      // Cualquier orden con `ordenorigen` (clon de descargue CEDI generado por
      // autoGenerarDescarguesCedi cuando la madre YA tiene lote, o descargue de
      // traslado entre bodegas generado por transfer-actions) trae su lote de
      // otro lado — de la madre (historicolotes) o del propio traslado
      // (despachotraslados) — nunca se asigna aquí. Sin este filtro, si el
      // `horalote` propio del clon queda en null por cualquier motivo (visto en
      // producción: la orden MED202608087747 nació con horalote heredado de su
      // madre pero quedó en null después), el clon reaparece aquí indefinidamente
      // aunque su mercancía ya esté aprobada en el sistema.
      .is("ordenorigen", null)
      .order("id", { ascending: false })

    if (error) {
      console.error("[v0] Error fetching available load orders:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getOrderProducts(orderId: number): Promise<OrderProduct[]> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("detalleoc")
      .select("id, idorden, producto, cantidad, cliente")
      .eq("idorden", orderId)
      .order("cliente", { ascending: true })
      .order("producto", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching order products:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getInventoryForProduct(
  productName: string,
  selectedEmpresaId?: number | null,
): Promise<InventoryLot[]> {
  try {
    // Usa la empresa seleccionada en el selector superior; si no hay,
    // cae a la empresa del perfil del usuario actual.
    let currentEmpresaId = selectedEmpresaId
    if (!currentEmpresaId) {
      const { empresaId } = await getCurrentUserContext()
      currentEmpresaId = empresaId || 1
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("codproducto, nombreproducto, lote, location, stock_actual")
      .eq("nombreproducto", productName)
      .eq("idempresa", currentEmpresaId)
      .gt("stock_actual", 0)
      .order("lote", { ascending: true })
      .order("codproducto", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching inventory for product:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function approveBatchAllocation(data: BatchApprovalData, selectedEmpresaId?: number | null) {
  const supabase = await createClient()

  try {
    const { empresaId, usuario } = await getCurrentUserContext()
    // Usa la empresa seleccionada en el selector superior; si no hay,
    // cae a la empresa del perfil del usuario actual.
    const currentEmpresaId = selectedEmpresaId || empresaId || 1
    const currentUsuario = usuario || "admin" // Fallback to "admin" if not found

    // BLOQUEO: una orden solo puede tener UNA salida de inventario. Si ya
    // existe una salida registrada para esta orden (cualquier estado salvo
    // rechazado), NO se permite digitar otra — caso real: orden
    // IND202607247162 quedó con la salida doble y dejó el lote en negativo
    // (detectado 2026-08-08; regla del cliente: "no está permitido").
    const { data: salidaExistente } = await supabase
      .from("invtrans")
      .select("id, creado, creadopor, status")
      .eq("idempresa", currentEmpresaId)
      .eq("ocargue", data.ordendecargue)
      .eq("tipomov", "Salida")
      .eq("origen", "orden de cargue")
      .not("status", "ilike", "rechazado%")
      .limit(1)
      .maybeSingle()
    if (salidaExistente) {
      const cuando = String(salidaExistente.creado || "").slice(0, 16).replace("T", " ")
      // Retorno explícito (no throw): en producción Next.js enmascara los
      // mensajes de errores lanzados en server actions y el usuario vería
      // un genérico en vez de esta alerta.
      return {
        success: false as const,
        error:
          `Esta orden YA tiene su salida de inventario registrada (${cuando} por ${salidaExistente.creadopor || "?"}). ` +
          `No está permitido digitar dos salidas para la misma orden — si necesita corregir la asignación, use Cuadre y Correcciones.`,
        recordsInserted: 0,
        invtransRecordsInserted: 0,
        pdfUrl: null as string | null,
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // LA ORDEN DE CARGUE MANDA (2026-10-07, por instrucción expresa de gerencia).
    //
    // Nunca puede salir una cantidad mayor a la de la orden, ni un producto que la orden no
    // incluya. Hasta hoy esto se verificaba SOLO en el navegador y SOLO contra la cantidad que
    // la pantalla tenía en memoria, así que una canasta desfasada pasaba la validación: el
    // 6-oct la asignación de MOL202610069899 (330 und autorizadas) se guardó con la canasta de
    // MOL202610069896 (1.011 und) y esas 1.011 unidades salieron dos veces de ID3.
    // Aquí no hay carrera posible: se lee el detalle REAL de la orden y se confronta.
    // ──────────────────────────────────────────────────────────────────────
    let ordenId: number | null = null
    if (Number.isFinite(Number(data.idorden))) {
      const { data: porId } = await supabase
        .from("cabeceraoc")
        .select("id, ordendecargue, idempresa")
        .eq("id", Number(data.idorden))
        .maybeSingle()
      if (!porId) {
        return {
          success: false as const,
          error: "La orden de cargue seleccionada ya no existe. Recargue la lista y vuelva a elegirla.",
          recordsInserted: 0,
          invtransRecordsInserted: 0,
          pdfUrl: null as string | null,
        }
      }
      if (String(porId.ordendecargue).trim() !== String(data.ordendecargue).trim()) {
        return {
          success: false as const,
          error:
            `No se guardó nada: la pantalla envió la orden ${data.ordendecargue} pero el registro ${data.idorden} ` +
            `es la orden ${porId.ordendecargue}. Recargue la lista y vuelva a elegir la orden.`,
          recordsInserted: 0,
          invtransRecordsInserted: 0,
          pdfUrl: null as string | null,
        }
      }
      ordenId = Number(porId.id)
    } else {
      // Sin id hay que resolver por número, y `cabeceraoc` tiene códigos repetidos: si el
      // número no identifica UNA orden, no se adivina.
      const { data: porNumero } = await supabase
        .from("cabeceraoc")
        .select("id")
        .eq("ordendecargue", data.ordendecargue)
        .eq("idempresa", currentEmpresaId)
        .limit(2)
      if (!porNumero || porNumero.length === 0) {
        return {
          success: false as const,
          error: `No se encontró la orden de cargue ${data.ordendecargue} en este proyecto.`,
          recordsInserted: 0,
          invtransRecordsInserted: 0,
          pdfUrl: null as string | null,
        }
      }
      if (porNumero.length > 1) {
        return {
          success: false as const,
          error:
            `Hay más de una orden con el número ${data.ordendecargue} en este proyecto, así que no se puede saber ` +
            `contra cuál validar. Avise a soporte antes de continuar.`,
          recordsInserted: 0,
          invtransRecordsInserted: 0,
          pdfUrl: null as string | null,
        }
      }
      ordenId = Number(porNumero[0].id)
    }

    const { data: detalleAutorizado, error: detalleError } = await supabase
      .from("detalleoc")
      .select("producto, cantidad")
      .eq("idorden", ordenId)
    if (detalleError) {
      return {
        success: false as const,
        error: `No se pudo leer el detalle de la orden para verificarlo: ${detalleError.message}. No se guardó nada.`,
        recordsInserted: 0,
        invtransRecordsInserted: 0,
        pdfUrl: null as string | null,
      }
    }

    const juicio = validarAsignacionContraOrden(
      (detalleAutorizado ?? []).map((d: any) => ({ producto: d.producto, cantidad: d.cantidad })),
      data.allocations.map((a) => ({
        producto: a.producto,
        cantidad: a.cantidad,
        lote: a.lote,
        location: a.location,
        // El alterno no cuenta para el techo, pero su producto sí tiene que estar en la orden.
        esAlterno: a.esAlterno === true,
      })),
    )
    if (!juicio.ok) {
      void registrarErrorServidor(
        "batch.asignacionFueraDeLaOrden",
        new Error(`Asignación rechazada en ${data.ordendecargue}: ${juicio.mensaje}`),
        { ordendecargue: data.ordendecargue, idorden: ordenId, idempresa: currentEmpresaId, diferencias: juicio.diferencias },
      )
      return {
        success: false as const,
        error: juicio.mensaje,
        recordsInserted: 0,
        invtransRecordsInserted: 0,
        pdfUrl: null as string | null,
      }
    }

    // Get the last id from historicolotes to generate the next consecutive ID
    const { data: lastRecord, error: lastRecordError } = await supabase
      .from("historicolotes")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .single()

    let nextId = 1
    if (lastRecordError && lastRecordError.code !== "PGRST116") {
      console.error("[v0] Error fetching last historicolotes ID:", lastRecordError)
      throw new Error("Error al generar ID para historial de lotes")
    }

    if (lastRecord) {
      nextId = (lastRecord.id || 0) + 1
    }

    // Get current date
    const currentDate = await getColombiaDate()

    // Placa del vehiculo al que se le hace esta aprobacion de lotes. Se
    // consulta de nuevo aqui (no se confia en el state del cliente) contra
    // cabeceraoc, que es la misma fuente que ya usa getAvailableLoadOrders.
    const { data: ordenData } = await supabase
      .from("cabeceraoc")
      .select("placa")
      .eq("ordendecargue", data.ordendecargue)
      .eq("idempresa", currentEmpresaId)
      .maybeSingle()
    const placaOrden: string | null = ordenData?.placa ?? null

    // Prepare records to insert
    const recordsToInsert = data.allocations.map((allocation, index) => ({
      id: nextId + index,
      idempresa: currentEmpresaId,
      cliente: allocation.cliente,
      producto: allocation.producto,
      lote: allocation.lote,
      location: allocation.location,
      cantidad: allocation.cantidad,
      ordendecargue: data.ordendecargue,
      fecha: currentDate,
      aprobadopor: currentUsuario,
      placa: placaOrden,
    }))

    // Insert all records
    const { error: insertError } = await supabase.from("historicolotes").insert(recordsToInsert)

    if (insertError) {
      console.error("[v0] Error inserting into historicolotes:", insertError)
      throw new Error("Error al registrar la aprobación de lotes")
    }

    // Group allocations by producto, lote, location (summing quantities across all clients)
    const groupedAllocations = new Map<
      string,
      {
        producto: string
        lote: string
        location: string
        cantidad: number
        esAlterno: boolean
      }
    >()

    data.allocations.forEach((allocation) => {
      const esAlterno = allocation.esAlterno === true
      // Se separan los lotes alternos para que conserven su propio status en invtrans.
      const key = `${allocation.producto}_${allocation.lote}_${allocation.location}_${esAlterno ? "ALT" : "STD"}`
      if (groupedAllocations.has(key)) {
        const existing = groupedAllocations.get(key)!
        existing.cantidad += allocation.cantidad
      } else {
        groupedAllocations.set(key, {
          producto: allocation.producto,
          lote: allocation.lote,
          location: allocation.location,
          cantidad: allocation.cantidad,
          esAlterno,
        })
      }
    })

    // Get product details (codproducto and idproducto) from saldoinvdetalle
    const productNames = Array.from(new Set(data.allocations.map((a) => a.producto)))
    const { data: productDetails, error: productDetailsError } = await supabase
      .from("saldoinvdetalle")
      .select("nombreproducto, codproducto, idproducto")
      .in("nombreproducto", productNames)
      .eq("idempresa", currentEmpresaId)

    if (productDetailsError) {
      console.error("[v0] Error fetching product details:", productDetailsError)
      throw new Error("Error al obtener detalles de productos")
    }

    // Create a map for quick lookup
    const productMap = new Map(
      productDetails?.map((p) => [p.nombreproducto, { codproducto: p.codproducto, idproducto: p.idproducto }]) || [],
    )

    // Get the last id from invtrans to generate the next consecutive ID
    const { data: lastInvtransRecord, error: lastInvtransError } = await supabase
      .from("invtrans")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .single()

    let nextInvtransId = 1
    if (lastInvtransError && lastInvtransError.code !== "PGRST116") {
      console.error("[v0] Error fetching last invtrans ID:", lastInvtransError)
      throw new Error("Error al generar ID para invtrans")
    }

    if (lastInvtransRecord) {
      nextInvtransId = (lastInvtransRecord.id || 0) + 1
    }

    // Prepare invtrans records
    const currentTimestamp = await getColombiaISO()
    const invtransRecords = Array.from(groupedAllocations.values()).map((group, index) => {
      const productInfo = productMap.get(group.producto)

      return {
        id: nextInvtransId + index,
        idempresa: currentEmpresaId,
        codproducto: productInfo?.codproducto || "",
        idproducto: productInfo?.idproducto || 0,
        nombreproducto: group.producto,
        lote: group.lote,
        location: group.location,
        cantidad: group.cantidad,
        tipomov: "Salida",
        status: group.esAlterno ? "Lote alterno" : "por descontar",
        origen: "orden de cargue",
        ocargue: data.ordendecargue,
        creado: currentTimestamp,
        creadopor: currentUsuario,
      }
    })

    // Insert into invtrans
    const { error: invtransInsertError } = await supabase.from("invtrans").insert(invtransRecords)

    if (invtransInsertError) {
      console.error("[v0] Error inserting into invtrans:", invtransInsertError)
      throw new Error("Error al registrar en invtrans")
    }

    console.log("[v0] Updating horalote for order:", data.ordendecargue)
    const currentTime = await getColombiaTime()
    console.log("[v0] Current time obtained:", currentTime)

    const { error: updateHoraloteError } = await supabase
      .from("cabeceraoc")
      .update({ horalote: currentTime })
      .eq("ordendecargue", data.ordendecargue)

    if (updateHoraloteError) {
      console.error("[v0] Error updating horalote in cabeceraoc:", updateHoraloteError)
      throw new Error("Error al actualizar la hora del lote en la orden de cargue")
    }

    console.log("[v0] Horalote updated successfully:", currentTime)

    // CLON +D y DESCARGUE CEDI: ahora que la MADRE ya tiene lote asignado
    // (horalote), generamos sus clones (distribución si la placa es propia, y
    // descargue en el CEDI destino si alguna línea va a un CEDI). Así heredan
    // el horalote / ya encuentran lote en historicolotes al iniciarse.
    // Idempotentes y falla-seguros (no bloquean la aprobación del lote).
    try {
      const { data: madre } = await supabase
        .from("cabeceraoc")
        .select("id")
        .eq("ordendecargue", data.ordendecargue)
        .maybeSingle()
      if (madre?.id) {
        await generarDistribucionAutomatica(null, madre.id)
        await autoGenerarDescarguesCedi(null, madre.id)

        // Reporte interno. Se reaprovecha el id que ya se resolvió arriba: la
        // asignación de lote trabaja con `ordendecargue` (el código) y el
        // reporte necesita el id numérico.
        //
        // El lote va explícito porque vive en `historicolotes`, no en la
        // cabecera: releer la orden no lo encontraría. Si hay varios, se
        // nombran todos los distintos.
        const lotes = [...new Set((data.allocations ?? []).map((a) => a.lote).filter(Boolean))]
        await reportarInterno("lote_asignado", madre.id, {
          lote: lotes.join(", ") || null,
        })
      }
    } catch (distErr) {
      console.error("[+D/auto-descargue] generar clones tras aprobar lote (no bloquea):", distErr)
    }

    // Get fecha and hora for PDF generation
    const fechaActual = await getColombiaDate()
    const horaActual = currentTime // Use the same time we just saved

    // Get product codes for PDF
    const allocationsWithCodes = await Promise.all(
      data.allocations.map(async (allocation) => {
        const { data: productData } = await supabase
          .from("saldoinvdetalle")
          .select("codproducto")
          .eq("nombreproducto", allocation.producto)
          .eq("idempresa", currentEmpresaId)
          .limit(1)
          .single()

        return {
          ...allocation,
          codigo: productData?.codproducto || "",
        }
      }),
    )

    // La PLACA en el PDF de asignación de lotes: quien recibe el documento en
    // piso necesita saber a qué vehículo corresponde sin tener que cruzarlo
    // contra otra pantalla. Se lee de `cabeceraoc` y no de lo que mande el
    // navegador: es el mismo dato con el que después se carga el camión.
    const { data: ordenVehiculo } = await supabase
      .from("cabeceraoc")
      .select("placa, conductor")
      .eq("ordendecargue", data.ordendecargue)
      .limit(1)
      .maybeSingle()

    const pdfData = {
      fecha: fechaActual,
      hora: horaActual,
      placa: ordenVehiculo?.placa || null,
      conductor: ordenVehiculo?.conductor || null,
      allocations: allocationsWithCodes,
      totalAsignaciones: data.allocations.length,
    }

    const pdfResult = await generateAndUploadBatchAssignmentPDF(pdfData, data.ordendecargue)

    if (!pdfResult.success) {
      console.error("[v0] Error generating PDF:", pdfResult.error)
      // Don't throw error, just log it - the batch was already approved
    }

    if (pdfResult.success && pdfResult.url) {
      const recordIds = recordsToInsert.map((r) => r.id)
      const { error: updatePdfError } = await supabase
        .from("historicolotes")
        .update({ pdf: pdfResult.url })
        .in("id", recordIds)

      if (updatePdfError) {
        console.error("[v0] Error updating PDF URL in historicolotes:", updatePdfError)
      }
    }

    return {
      success: true as const,
      error: null as string | null,
      recordsInserted: recordsToInsert.length,
      invtransRecordsInserted: invtransRecords.length,
      pdfUrl: pdfResult.url || null,
    }
  } catch (error) {
    console.error("[v0] Error in approveBatchAllocation:", error)
    // La asignación de lotes reserva inventario: si falla, hay que saberlo el mismo día.
    void registrarErrorServidor("batch.approveBatchAllocation", error, {
      ordendecargue: (data as any)?.ordendecargue ?? null,
      empresaId: selectedEmpresaId ?? null,
    })
    throw error
  }
}

export async function getBatchHistory(selectedEmpresaId?: number | null): Promise<BatchHistoryRecord[]> {
  try {
    const { empresaId } = await getCurrentUserContext()
    const currentEmpresaId = selectedEmpresaId || empresaId || 1

    const supabase = await createClient()
    
    // Fetch in batches of 1000 to bypass Supabase default limit
    const batchSize = 1000
    const maxRecords = 6000
    const allRecords: BatchHistoryRecord[] = []

    for (let offset = 0; offset < maxRecords; offset += batchSize) {
      const { data, error } = await supabase
        .from("historicolotes")
        .select("id, fecha, cliente, producto, lote, location, cantidad, ordendecargue, pdf, placa")
        .eq("idempresa", currentEmpresaId)
        .order("fecha", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + batchSize - 1)

      if (error) {
        console.error("[v0] Error fetching batch history:", error)
        break
      }

      if (!data || data.length === 0) {
        break // No more records
      }

      allRecords.push(...data)

      // If we got fewer records than batch size, we've reached the end
      if (data.length < batchSize) {
        break
      }
    }

    console.log("[v0] Total batch history records fetched:", allRecords.length)
    return allRecords
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getBatchHistoryFilters(selectedEmpresaId?: number | null) {
  try {
    const { empresaId } = await getCurrentUserContext()
    const currentEmpresaId = selectedEmpresaId || empresaId || 1

    const supabase = await createClient()

    // Get clientes from clientes table filtered by id_empresa
    const { data: clientesData } = await supabase
      .from("clientes")
      .select("nombre")
      .eq("id_empresa", currentEmpresaId)
      .eq("activo", true)
      .order("nombre", { ascending: true })

    // Productos y placas distintos -- PAGINADO: historicolotes tiene miles de
    // filas por empresa y Supabase corta en 1.000 sin avisar, así que los
    // filtros perdían opciones. Una sola pasada por las dos columnas.
    const filasLotes = await fetchAllRows((from, to) =>
      supabase.from("historicolotes").select("producto, placa").eq("idempresa", currentEmpresaId).order("id").range(from, to),
    )

    const clientes = (clientesData?.map((item) => item.nombre).filter(Boolean) || []) as string[]
    const productos = Array.from(new Set(filasLotes.map((item) => item.producto).filter(Boolean))).sort() as string[]
    const placas = Array.from(new Set(filasLotes.map((item) => item.placa).filter(Boolean))).sort() as string[]

    return {
      clientes,
      productos,
      placas,
    }
  } catch (error) {
    console.error("[v0] Error fetching batch history filters:", error)
    return {
      clientes: [],
      productos: [],
      placas: [],
    }
  }
}

export async function updateBatchHistoryRecord(data: UpdateBatchHistoryData) {
  try {
    const supabase = await createClient()

    const { error } = await supabase
      .from("historicolotes")
      .update({
        cliente: data.cliente,
        producto: data.producto,
        lote: data.lote,
        location: data.location,
        cantidad: data.cantidad,
        ordendecargue: data.ordendecargue,
        placa: data.placa,
      })
      .eq("id", data.id)

    if (error) {
      console.error("[v0] Error updating batch history record:", error)
      return {
        success: false,
        message: "Error al actualizar el registro",
      }
    }

    return {
      success: true,
      message: "Registro actualizado exitosamente",
    }
  } catch (error) {
    console.error("[v0] Unexpected error updating batch history:", error)
    return {
      success: false,
      message: "Error inesperado al actualizar el registro",
    }
  }
}

export async function annulBatchAssignment(ordenCargue: string) {
  try {
    const supabase = await createClient()

    /*
     * UNA ASIGNACIÓN QUE YA PASÓ POR PICKING NO SE ANULA.
     *
     * Regla de gerencia (2026-10-07): "si tiene los otros pasos del proceso, como picking
     * verificado, no se puede borrar o afectaría el inventario".
     *
     * La asignación de lote es una RESERVA: aparta el producto para que otra orden no lo
     * tome, y sus líneas quedan en `por descontar`. El picking es el que despacha: las pasa
     * a `aprobado` y ahí la mercancía salió de verdad.
     *
     * Anular después del picking borra esas salidas y devuelve el inventario, así que el
     * sistema queda diciendo que hay producto que ya se fue en un camión. Pasa en silencio.
     *
     * Mientras solo haya reserva, anular es correcto y sigue permitido.
     */
    const { data: yaDespacho, error: errDespacho } = await supabase
      .from("invtrans")
      .select("id, cantidad")
      .eq("ocargue", ordenCargue)
      .ilike("origen", "orden de cargue")
      .ilike("status", "apr%")
      .limit(500)
    if (errDespacho) {
      return { success: false, message: `No se pudo comprobar si la orden ya despachó: ${errDespacho.message}. No se anuló nada.` }
    }
    if ((yaDespacho ?? []).length > 0) {
      const unidades = (yaDespacho ?? []).reduce((s: number, r: any) => s + (Number(r.cantidad) || 0), 0)
      return {
        success: false,
        message:
          `La orden ${ordenCargue} ya pasó por Picking: tiene ${yaDespacho!.length} salida(s) aprobadas por ` +
          `${unidades.toLocaleString("es-CO")} unidades. Anular la asignación devolvería a la bodega un producto que ` +
          `ya salió. Si hay que corregirla, hazlo desde Cuadre y Correcciones de inventario, que deja rastro.`,
      }
    }

    const { error: deleteError } = await supabase.from("historicolotes").delete().eq("ordendecargue", ordenCargue)

    if (deleteError) {
      console.error("[v0] Error deleting from historicolotes:", deleteError)
      return {
        success: false,
        message: "Error al eliminar las asignaciones de lotes",
      }
    }

    const { error: deleteInvtransError } = await supabase.from("invtrans").delete().eq("ocargue", ordenCargue)

    if (deleteInvtransError) {
      console.error("[v0] Error deleting from invtrans:", deleteInvtransError)
      return {
        success: false,
        message: "Error al eliminar las transacciones de inventario",
      }
    }

    const { error: updateError } = await supabase
      .from("cabeceraoc")
      .update({ horalote: null })
      .eq("ordendecargue", ordenCargue)

    if (updateError) {
      console.error("[v0] Error clearing horalote in cabeceraoc:", updateError)
      return {
        success: false,
        message: "Error al actualizar la orden de cargue",
      }
    }

    return {
      success: true,
      message: "Asignaciones de lotes anuladas exitosamente",
    }
  } catch (error) {
    console.error("[v0] Unexpected error annulling batch assignment:", error)
    return {
      success: false,
      message: "Error inesperado al anular las asignaciones",
    }
  }
}

export async function getOrdenesForAnnulment(): Promise<string[]> {
  try {
    const supabase = await createClient()

    // PAGINADO: historicolotes tiene más de 20.000 filas y Supabase corta en
    // 1.000 sin avisar -- el desplegable de órdenes a anular quedaba incompleto.
    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase.from("historicolotes").select("ordendecargue").order("ordendecargue", { ascending: true }).order("id").range(from, to),
      )
    } catch (error) {
      console.error("[v0] Error fetching ordenes de cargue:", error)
      return []
    }

    // Get unique values
    const uniqueOrdenes = Array.from(new Set(data.map((item) => item.ordendecargue).filter(Boolean))) as string[]
    return uniqueOrdenes
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}
