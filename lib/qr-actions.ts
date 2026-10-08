"use server"

import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { generateAndUploadProductionEntryPDF } from "@/lib/pdf-actions"
import { getCurrentEmpresaIdForInsert, getCurrentUsuarioForInsert } from "@/lib/user-context"
import { motivoSinAccion } from "@/lib/puerta-modulo"

export async function getQRRegistrationData() {
  const supabase = await createClient()

  try {
    // Fetch locations (codigo)
    const { data: locations, error: locationsError } = await supabase
      .from("locations")
      .select("id, codigo, bodega")
      .eq("activo", true)
      .order("codigo", { ascending: true })

    if (locationsError) throw locationsError

    // Fetch bodegas (almacenes)
    const { data: bodegas, error: bodegasError } = await supabase
      .from("bodegas")
      .select("idbodega, nombrebodega")
      .eq("activo", true)
      .order("nombrebodega", { ascending: true })

    if (bodegasError) throw bodegasError

    // Fetch productos
    const { data: productos, error: productosError } = await supabase
      .from("productos")
      .select("id, nombre, codigo, vidautildias")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (productosError) throw productosError

    return {
      success: true,
      locations: locations || [],
      bodegas: bodegas || [],
      productos: productos || [],
    }
  } catch (error) {
    console.error("Error fetching QR registration data:", error)
    return {
      success: false,
      error: "Failed to fetch data",
      locations: [],
      bodegas: [],
      productos: [],
    }
  }
}

export async function getBodegaByLocation(locationCodigo: string) {
  const supabase = await createClient()

  try {
    // Get the bodega ID from the location
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("bodega")
      .eq("codigo", locationCodigo)
      .eq("activo", true)
      .single()

    if (locationError) throw locationError

    if (!location || !location.bodega) {
      return { success: false, bodega: null }
    }

    // Get the bodega name
    const { data: bodega, error: bodegaError } = await supabase
      .from("bodegas")
      .select("nombrebodega")
      .eq("idbodega", location.bodega)
      .single()

    if (bodegaError) throw bodegaError

    return { success: true, bodega: bodega?.nombrebodega || null }
  } catch (error) {
    console.error("Error fetching bodega by location:", error)
    return { success: false, bodega: null }
  }
}

export async function checkQRInUse(qrId: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase.from("qrestibacabecera").select("id, idproducto").eq("id", qrId).single()

    if (error) {
      // If not found, QR is available
      if (error.code === "PGRST116") {
        return { success: true, inUse: false }
      }
      throw error
    }

    // Check if idproducto is not null or empty
    const isInUse = data && data.idproducto != null && data.idproducto !== ""

    return {
      success: true,
      inUse: isInUse,
      data: data,
    }
  } catch (error) {
    console.error("Error checking QR in use:", error)
    return {
      success: false,
      error: "Error al verificar el código QR",
      inUse: false,
    }
  }
}

export async function savePalletRegistration(data: {
  id: string
  idproducto: number
  nombreproducto: string
  fecha: string
  hora: string
  operador: string
  semana: number
  bodega: string
  lotes: Array<{
    lote: string
    cantidad: string
  }>
  codproducto: string
  localizacion: string
}) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Registro de QR estibas"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  const supabase = await createClient()

  try {
    const qrCheck = await checkQRInUse(data.id)

    if (!qrCheck.success) {
      return {
        success: false,
        error: qrCheck.error || "Error al verificar el código QR",
      }
    }

    if (qrCheck.inUse) {
      return {
        success: false,
        error: "Este código QR ya está en uso y no puede ser sobrescrito",
      }
    }

    const { data: productoData, error: productoError } = await supabase
      .from("productos")
      .select("vidautildias")
      .eq("id", data.idproducto)
      .single()

    if (productoError) {
      console.error("Error fetching product vidautildias:", productoError)
      throw productoError
    }

    let fechaVencimiento: string | null = null
    if (productoData && productoData.vidautildias) {
      const today = new Date()
      today.setDate(today.getDate() + productoData.vidautildias)
      fechaVencimiento = today.toISOString().split("T")[0] // Format: YYYY-MM-DD
    }

    const empresaId = await getCurrentEmpresaIdForInsert()

    const { error: cabeceraError } = await supabase
      .from("qrestibacabecera")
      .update({
        idempresa: empresaId,
        idproducto: data.idproducto,
        nombreproducto: data.nombreproducto,
        fecha: data.fecha,
        hora: data.hora,
        operador: data.operador,
        semana: data.semana,
        bodega: data.bodega,
      })
      .eq("id", data.id)

    if (cabeceraError) {
      console.error("Error updating qrestibacabecera:", cabeceraError)
      throw cabeceraError
    }

    // SIN id explícito: qrestibadetalle.id es SERIAL. Fijarlo a mano (max+1) NO avanza
    // la secuencia y colisiona con las rutas que insertan por nextval (verificación QR
    // en Picking, traslado de estibas) -> 'duplicate key'. Que el SERIAL asigne el id.
    const detalleRecords = data.lotes.map((lote) => ({
      idqr: data.id,
      codproducto: data.codproducto,
      nombreproducto: data.nombreproducto,
      lote: lote.lote,
      cantidad: Number.parseFloat(lote.cantidad),
      location: data.localizacion,
      fechavenc: fechaVencimiento,
      tipomov: "entrada",
    }))

    const { error: detalleError } = await supabase.from("qrestibadetalle").insert(detalleRecords)

    if (detalleError) {
      console.error("Error inserting qrestibadetalle:", detalleError)
      throw detalleError
    }

    const productionData = {
      fecha: data.fecha,
      hora: data.hora,
      products: data.lotes.map((lote) => ({
        producto: data.nombreproducto,
        codigo_producto: data.codproducto,
        lote: lote.lote,
        cantidad: Number.parseFloat(lote.cantidad),
        observaciones: null,
        fechavencimiento: fechaVencimiento,
        fechaproduccion: data.fecha,
      })),
      totalLineas: data.lotes.length,
    }

    const pdfResult = await generateAndUploadProductionEntryPDF(productionData)

    if (!pdfResult.success) {
      console.error("Error generating PDF:", pdfResult.error)
      throw new Error("Error al generar el PDF")
    }

    const pdfUrl = pdfResult.url || ""

    const { data: lastInvtransRecords, error: lastInvtransError } = await supabase
      .from("invtrans")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)

    let nextInvtransId = 1
    if (!lastInvtransError && lastInvtransRecords && lastInvtransRecords.length > 0) {
      nextInvtransId = lastInvtransRecords[0].id + 1
    }

    const usuario = await getCurrentUsuarioForInsert()

    const invtransRecords = data.lotes.map((lote, index) => ({
      id: nextInvtransId + index,
      idempresa: empresaId,
      idproducto: data.idproducto,
      nombreproducto: data.nombreproducto,
      lote: lote.lote,
      location: data.localizacion,
      cantidad: Number.parseFloat(lote.cantidad),
      tipomov: "Salida",
      status: null,
      origen: "ingreso producción qr",
      creado: new Date().toISOString(),
      creadopor: usuario,
      codproducto: data.codproducto,
      fechaprod: data.fecha,
      almacen: data.bodega,
      pdf: pdfUrl,
      fechavencimiento: fechaVencimiento,
    }))

    const { error: invtransError } = await supabase.from("invtrans").insert(invtransRecords)

    if (invtransError) {
      console.error("Error inserting invtrans:", invtransError)
      throw invtransError
    }

    return {
      success: true,
      message: "Estiba registrada correctamente",
      pdfUrl: pdfUrl,
    }
  } catch (error) {
    console.error("Error saving pallet registration:", error)
    return {
      success: false,
      error: "Error al registrar la estiba",
    }
  }
}

export async function getPalletDataByQR(qrId: string) {
  const supabase = await createClient()

  try {
    // Fetch cabecera data
    const { data: cabecera, error: cabeceraError } = await supabase
      .from("qrestibacabecera")
      .select("*")
      .eq("id", qrId)
      .single()

    if (cabeceraError) {
      console.error("Error fetching qrestibacabecera:", cabeceraError)
      return {
        success: false,
        error: "No se encontró información para este código QR",
        data: null,
      }
    }

    // Fetch detalle data
    const { data: detalle, error: detalleError } = await supabase
      .from("qrestibadetalle")
      .select("*")
      .eq("idqr", qrId)
      .order("id", { ascending: true })

    if (detalleError) {
      console.error("Error fetching qrestibadetalle:", detalleError)
      return {
        success: false,
        error: "Error al cargar los detalles de la estiba",
        data: null,
      }
    }

    return {
      success: true,
      data: {
        cabecera,
        detalle: detalle || [],
      },
    }
  } catch (error) {
    console.error("Error fetching pallet data:", error)
    return {
      success: false,
      error: "Error al buscar la información de la estiba",
      data: null,
    }
  }
}

export async function getInventoryByPallet(filters: {
  producto?: string
  lote?: string
  location?: string
}) {
  const supabase = await createClient()

  try {
    let query = supabase
      .from("view_inventario_por_estiba")
      .select("idqr, codproducto, nombreproducto, lote, location, stock_total")
      .order("idqr", { ascending: true })

    // Apply filters
    if (filters.producto && filters.producto !== "all") {
      query = query.eq("nombreproducto", filters.producto)
    }

    if (filters.lote && filters.lote !== "all") {
      query = query.eq("lote", filters.lote)
    }

    if (filters.location && filters.location !== "all") {
      query = query.eq("location", filters.location)
    }

    const { data, error } = await query

    if (error) {
      console.error("Error fetching inventory by pallet:", error)
      throw error
    }

    return {
      success: true,
      data: data || [],
    }
  } catch (error) {
    console.error("Error in getInventoryByPallet:", error)
    return {
      success: false,
      error: "Error al obtener el inventario por estiba",
      data: [],
    }
  }
}

export async function getProductosForPalletFilter() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("view_inventario_por_estiba")
      .select("nombreproducto")
      .order("nombreproducto", { ascending: true })

    if (error) throw error

    // Get unique product names
    const uniqueProducts = Array.from(new Set(data?.map((item) => item.nombreproducto) || []))

    return uniqueProducts.map((nombre) => ({ nombre }))
  } catch (error) {
    console.error("Error fetching productos for filter:", error)
    return []
  }
}

export async function getLotesForPalletFilter() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("view_inventario_por_estiba")
      .select("lote")
      .order("lote", { ascending: true })

    if (error) throw error

    // Get unique lotes
    const uniqueLotes = Array.from(new Set(data?.map((item) => item.lote) || []))

    return uniqueLotes.map((lote) => ({ lote }))
  } catch (error) {
    console.error("Error fetching lotes for filter:", error)
    return []
  }
}

export async function getLocationsForPalletFilter() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("view_inventario_por_estiba")
      .select("location")
      .order("location", { ascending: true })

    if (error) throw error

    // Get unique locations
    const uniqueLocations = Array.from(new Set(data?.map((item) => item.location) || []))

    return uniqueLocations.map((location) => ({ location }))
  } catch (error) {
    console.error("Error fetching locations for filter:", error)
    return []
  }
}

/**
 * Traslado ENTRE ESTIBAS (por código QR / campo qrestiba).
 *
 * Funciona igual que el traslado entre localizaciones, pero el movimiento se
 * controla por el campo `qrestiba`:
 *  - SALIDA de la estiba origen (qrestiba = originQrId)
 *  - ENTRADA en la estiba destino (qrestiba = destQrId)
 *
 * Además de invtrans, se registran los movimientos en `qrestibadetalle` para
 * que la vista `view_inventario_por_estiba` actualice los saldos de cada
 * estiba. Devuelve los payloads de las etiquetas a imprimir:
 *  - Etiqueta de la estiba DESTINO con su nuevo saldo (conserva su QR).
 *  - Etiqueta de la estiba ORIGEN con el remanente, solo si quedó > 0
 *    (conserva su QR original).
 */
export interface PalletTransferLabel {
  idqr: number
  reimpresion: true
  producto: number | null
  bodega: number | null
  localizacion: number | null
  lote: number | string
  bultos_procesados: number
  tipo_empaque: "Estiba"
}

export async function registerPalletTransfer(params: {
  originQrId: number
  destQrId: number
  codproducto: string
  nombreproducto: string
  lote: string
  cantidad: number
  selectedEmpresaId?: number
}): Promise<{ success: boolean; message: string; labels: PalletTransferLabel[] }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Traslados de producto", "Registro de QR estibas"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion, labels: [] }
  const supabase = await createClient()

  try {
    const { originQrId, destQrId, codproducto, nombreproducto, lote, cantidad } = params

    if (!originQrId || !destQrId) {
      return { success: false, message: "Debe indicar la estiba origen y destino", labels: [] }
    }
    if (originQrId === destQrId) {
      return { success: false, message: "La estiba origen y destino deben ser diferentes", labels: [] }
    }
    if (!cantidad || cantidad <= 0) {
      return { success: false, message: "La cantidad debe ser mayor a 0", labels: [] }
    }

    // --- Validar saldo en la estiba origen para este producto + lote ---
    const { data: originRow, error: originErr } = await supabase
      .from("view_inventario_por_estiba")
      .select("idqr, location, nombreproducto, lote, stock_total")
      .eq("idqr", originQrId)
      .eq("nombreproducto", nombreproducto)
      .eq("lote", lote)
      .maybeSingle()

    if (originErr) {
      console.error("[v0] Error fetching origin pallet:", originErr)
      return { success: false, message: "Error al validar la estiba origen", labels: [] }
    }

    const originStock = originRow?.stock_total || 0
    const originLocation = originRow?.location || ""

    if (originStock <= 0) {
      return { success: false, message: "La estiba origen no tiene inventario para este producto/lote", labels: [] }
    }
    if (cantidad > originStock) {
      return {
        success: false,
        message: `No puede trasladar más del disponible en la estiba origen (${originStock})`,
        labels: [],
      }
    }

    // --- Datos de la estiba destino (ubicación + saldo existente del producto/lote) ---
    const { data: destAll, error: destErr } = await supabase
      .from("view_inventario_por_estiba")
      .select("idqr, location, nombreproducto, lote, stock_total")
      .eq("idqr", destQrId)

    if (destErr) {
      console.error("[v0] Error fetching destination pallet:", destErr)
      return { success: false, message: "Error al validar la estiba destino", labels: [] }
    }
    if (!destAll || destAll.length === 0) {
      return { success: false, message: "No se encontró la estiba destino (QR sin inventario asociado)", labels: [] }
    }

    const destLocation = destAll[0].location
    const destExistingStock =
      destAll.find((r) => r.nombreproducto === nombreproducto && r.lote === lote)?.stock_total || 0

    const empresaId = params.selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())
    const usuario = await getCurrentUsuarioForInsert()
    const now = new Date().toISOString()

    // id del producto (para invtrans.idproducto)
    const { data: prod } = await supabase.from("productos").select("id").eq("codigo", codproducto).maybeSingle()
    const idproducto = prod?.id ?? null

    // --- invtrans: SALIDA (origen) + ENTRADA (destino), control por qrestiba ---
    const { data: lastInv, error: lastInvErr } = await supabase
      .from("invtrans")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastInvErr) {
      console.error("[v0] Error fetching last invtrans id:", lastInvErr)
      return { success: false, message: "Error al generar ID de movimiento", labels: [] }
    }

    const nextId = (lastInv?.id || 0) + 1

    const invRows = [
      {
        id: nextId,
        idempresa: empresaId,
        codproducto,
        idproducto,
        nombreproducto,
        lote,
        location: originLocation,
        almacen: originLocation,
        cantidad,
        tipomov: "Salida",
        status: "aprobado",
        origen: "traslado entre estibas",
        qrestiba: originQrId,
        creado: now,
        creadopor: usuario,
      },
      {
        id: nextId + 1,
        idempresa: empresaId,
        codproducto,
        idproducto,
        nombreproducto,
        lote,
        location: destLocation,
        almacen: destLocation,
        cantidad,
        tipomov: "Entrada",
        status: "aprobado",
        origen: "traslado entre estibas",
        qrestiba: destQrId,
        creado: now,
        creadopor: usuario,
      },
    ]

    const { error: invInsertErr } = await supabase.from("invtrans").insert(invRows)
    if (invInsertErr) {
      console.error("[v0] Error inserting invtrans for pallet transfer:", invInsertErr)
      return { success: false, message: "Error al registrar el movimiento: " + invInsertErr.message, labels: [] }
    }

    // --- qrestibadetalle: salida de la estiba origen + entrada a la destino ---
    // Esto actualiza los saldos de cada estiba en view_inventario_por_estiba.
    const detalleRows = [
      {
        idqr: originQrId,
        codproducto,
        nombreproducto,
        lote,
        cantidad,
        location: originLocation,
        tipomov: "salida",
      },
      {
        idqr: destQrId,
        codproducto,
        nombreproducto,
        lote,
        cantidad,
        location: destLocation,
        tipomov: "entrada",
      },
    ]

    const { error: detInsertErr } = await supabase.from("qrestibadetalle").insert(detalleRows)
    if (detInsertErr) {
      console.error("[v0] Error inserting qrestibadetalle for pallet transfer:", detInsertErr)
      return { success: false, message: "Error al actualizar el saldo de las estibas: " + detInsertErr.message, labels: [] }
    }

    // --- Construir etiquetas (resolver location código -> id + bodega) ---
    const resolveLoc = async (codigo: string) => {
      const { data } = await supabase
        .from("locations")
        .select("id, bodega")
        .eq("codigo", codigo)
        .eq("activo", true)
        .maybeSingle()
      return data
    }

    const loteNum = Number.parseInt(lote)
    const loteValue = Number.isNaN(loteNum) ? lote : loteNum

    const labels: PalletTransferLabel[] = []

    // Etiqueta de la estiba DESTINO con el nuevo saldo del producto/lote.
    const destLocRow = await resolveLoc(destLocation)
    labels.push({
      idqr: destQrId,
      reimpresion: true,
      producto: idproducto,
      bodega: destLocRow?.bodega ?? null,
      localizacion: destLocRow?.id ?? null,
      lote: loteValue,
      bultos_procesados: destExistingStock + cantidad,
      tipo_empaque: "Estiba",
    })

    // Etiqueta de la estiba ORIGEN con el remanente (solo si quedó algo).
    const remnant = originStock - cantidad
    if (remnant > 0) {
      const originLocRow = await resolveLoc(originLocation)
      labels.push({
        idqr: originQrId,
        reimpresion: true,
        producto: idproducto,
        bodega: originLocRow?.bodega ?? null,
        localizacion: originLocRow?.id ?? null,
        lote: loteValue,
        bultos_procesados: remnant,
        tipo_empaque: "Estiba",
      })
    }

    return { success: true, message: "Traslado entre estibas registrado exitosamente", labels }
  } catch (error) {
    console.error("[v0] Unexpected error in registerPalletTransfer:", error)
    return { success: false, message: "Error inesperado al registrar el traslado entre estibas", labels: [] }
  }
}

// ---------------------------------------------------------------------------
// Produccion propia de HARINERA
// ---------------------------------------------------------------------------
//
// El registro por QR lo hace un servicio EXTERNO que inserta en
// `public.produccion`; el trigger `trg_produccion_after_insert` copia esa fila
// a `invtrans` (con `qrestiba = produccion.id`) y de ahi el ingreso sigue hacia
// Aprobacion y Liquidacion Tolva, que lo factura.
//
// Ni el servicio ni el trigger se tocan: el trigger es lo que garantiza que la
// produccion subida desde el LOGO llegue a `invtrans` sin depender de LIPgo.
// Por eso la marca de "esto es de Harinera" se aplica DESPUES, y solo desde
// LIPgo, que es el unico que conoce la eleccion del operador.

/**
 * Mayor id de `produccion` en este momento.
 *
 * Se lee ANTES de mandar el registro al servicio externo para poder ubicar
 * despues la fila recien creada. No se usa el id que devuelve el servicio
 * porque su forma no es confiable: el cliente prueba cuatro nombres distintos
 * (`id`, `id_generado`, `idqr`, `registro_id`) y cae a "—".
 */
export async function getMaxProduccionId(): Promise<{ success: boolean; maxId: number; error?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()
    const { data, error } = await admin
      .from("produccion")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error("[v0] Error leyendo max(id) de produccion:", error)
      return { success: false, maxId: 0, error: error.message }
    }
    return { success: true, maxId: Number(data?.id) || 0 }
  } catch (e: any) {
    console.error("[v0] Excepcion en getMaxProduccionId:", e)
    return { success: false, maxId: 0, error: e?.message || "Error inesperado" }
  }
}

/**
 * Marca como HARINERA el registro de produccion recien creado.
 *
 * Hace dos cosas sobre la fila que acaba de nacer:
 *  1. `invtrans.tipo_produccion = 'Harinera'` (por `qrestiba = produccion.id`),
 *     que es lo que la excluye de Liquidacion Tolva y de todo camino de cobro.
 *  2. `produccion.bultos_procesados = 0`, para que Control Piso no la cuente
 *     como produccion de LIP. La cantidad REAL no se pierde: queda en
 *     `invtrans` y se recupera por ese mismo `qrestiba`.
 *
 * Poner la fila de produccion en 0 es seguro porque el trigger es AFTER INSERT
 * unicamente: un UPDATE posterior no vuelve a sincronizar ni duplica nada.
 */
export async function marcarProduccionHarinera(params: {
  maxIdPrevio: number
  producto: number
  bodega: number
  localizacion: number
  lote: number
  bultos: number
}): Promise<{ success: boolean; produccionId?: number; error?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()

    // Fila nueva: la mas reciente por encima del max previo que coincida con lo
    // que se acaba de enviar. El cruce por los cinco campos evita agarrar el
    // registro de otro operador que haya entrado en el mismo instante.
    const { data: filas, error: errBusqueda } = await admin
      .from("produccion")
      .select("id, bultos_procesados")
      .gt("id", params.maxIdPrevio)
      .eq("producto", params.producto)
      .eq("bodega", params.bodega)
      .eq("localizacion", params.localizacion)
      .eq("lote", params.lote)
      .eq("bultos_procesados", params.bultos)
      .order("id", { ascending: false })
      .limit(1)

    if (errBusqueda) {
      console.error("[v0] Error ubicando la fila de produccion a marcar:", errBusqueda)
      return { success: false, error: errBusqueda.message }
    }

    const fila = filas?.[0]
    if (!fila) {
      return {
        success: false,
        error:
          "No se encontró el registro recién creado en producción, así que no se pudo marcar como Harinera.",
      }
    }

    const produccionId = Number(fila.id)

    // 1) La marca en invtrans es lo que de verdad bloquea la facturacion, asi
    //    que va PRIMERO: si fallara el paso 2, al menos el ingreso ya quedo
    //    aislado del cobro.
    // Se acota a la fila de INGRESO DE PRODUCCION. `qrestiba` no es exclusivo
    // del trigger: picking y los traslados entre estibas tambien lo escriben
    // con el mismo id de estiba. Sin estos dos filtros, marcar por `qrestiba` a
    // secas podria alcanzar una salida de picking de esa misma estiba.
    const { error: errInv } = await admin
      .from("invtrans")
      .update({ tipo_produccion: "Harinera" })
      .eq("qrestiba", produccionId)
      .eq("tipomov", "Entrada")
      .ilike("origen", "%ingreso producci%")

    if (errInv) {
      console.error("[v0] Error marcando invtrans como Harinera:", errInv)
      return { success: false, produccionId, error: errInv.message }
    }

    // 2) Neutralizar el conteo en Control Piso.
    const { error: errProd } = await admin
      .from("produccion")
      .update({ bultos_procesados: 0 })
      .eq("id", produccionId)

    if (errProd) {
      // No es critico para la facturacion (el paso 1 ya cerro esa puerta), pero
      // si para los indicadores de produccion, asi que se reporta.
      console.error("[v0] Error poniendo en 0 la fila de produccion:", errProd)
      return {
        success: false,
        produccionId,
        error:
          `El ingreso quedó marcado como Harinera, pero no se pudo poner en 0 la fila de producción ` +
          `(id ${produccionId}); contará como producción de LIP en Control Piso.`,
      }
    }

    return { success: true, produccionId }
  } catch (e: any) {
    console.error("[v0] Excepcion en marcarProduccionHarinera:", e)
    return { success: false, error: e?.message || "Error inesperado al marcar la producción" }
  }
}
