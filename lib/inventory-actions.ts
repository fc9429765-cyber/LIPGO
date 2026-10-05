"use server"

import { createClient } from "@/lib/supabase-client"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { registrarErrorServidor } from "@/lib/errores-servidor"
import { CODIGOS_REQUIEREN_APROBACION } from "@/lib/transacciones-codigo"
import * as XLSX from "xlsx"
import { generateAndUploadProductionEntryPDF } from "@/lib/pdf-actions"
import { getColombiaDate } from "@/lib/date-utils"
import {
  getCurrentEmpresaIdForInsert,
  getCurrentUsuarioForInsert,
  getCurrentUserContext,
  getCurrentEmpresaId, // Import from lib/company-filter
  getCurrentUsuario, // Import from lib/company-filter
} from "@/lib/company-filter" // Import from lib/company-filter

export async function getColombiaDateTime(): Promise<string> {
  const now = new Date()
  // Convert to Colombia timezone (America/Bogota which is UTC-5)
  const colombiaDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
  return colombiaDate.toISOString()
}

export interface Location {
  codigo: string
  Descripción?: string
  bodega?: number // Added bodega field
}

export interface ProductWithCode {
  id: number // Added id field to get numeric product ID
  nombre: string
  codigo: string
  categoria: string
  subcategoria: string
  vidautildias?: number
}

export interface LoteOption {
  lote: string
}

export async function getAlmacenes(empresaId?: number) {
  try {
    const supabase = await createClient()

    const finalEmpresaId = empresaId || (await getCurrentEmpresaIdForInsert())

    console.log("[v0] getAlmacenes filtering by empresaId:", finalEmpresaId)

    const { data, error } = await supabase
      .from("almacenes")
      .select("id, nombre")
      .eq("idempresa", finalEmpresaId)
      .order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching almacenes:", error)
      return []
    }

    console.log("[v0] Almacenes fetched:", data?.length || 0)
    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error fetching almacenes:", error)
    return []
  }
}

// Added getWarehouses function to get warehouses
export async function getWarehouses(selectedEmpresaId?: number | null) {
  return getAlmacenes(selectedEmpresaId ?? undefined)
}

// New functions for Transacciones de Inventario reordering
// These functions obtain data from saldoinvdetalle table

export async function getLocationsFromSaldoInvDetalleForTransactions(
  selectedEmpresaId?: number | null,
): Promise<string[]> {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    // PAGINADO: saldoinvdetalle supera las 1.000 filas por empresa y Supabase
    // corta ahí en silencio -- el desplegable de ubicaciones perdía opciones.
    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from("saldoinvdetalle")
          .select("location")
          .eq("idempresa", empresaId)
          .order("location", { ascending: true })
          .order("idproducto")
          .order("lote")
          .range(from, to),
      )
    } catch (error) {
      console.error("[v0] Error fetching locations from saldoinvdetalle:", error)
      return []
    }

    const uniqueLocations = [...new Set(data.map((item) => item.location).filter((loc) => loc))]
    console.log("[v0] Unique locations from saldoinvdetalle:", uniqueLocations)
    return uniqueLocations
  } catch (error) {
    console.error("[v0] Unexpected error fetching locations:", error)
    return []
  }
}

/**
 * Localizaciones de una BODEGA (almacén) específica que además tienen saldo en
 * saldoinvdetalle para la empresa. Cruza `locations.bodega = bodegaId` con las
 * localizaciones presentes en saldoinvdetalle. Alimenta el campo Localización
 * del módulo de Transacciones: solo muestra las localizaciones de la bodega
 * elegida en el campo Almacén.
 */
export async function getLocationsByWarehouse(
  bodegaId: number,
  selectedEmpresaId?: number | null,
): Promise<string[]> {
  try {
    if (!bodegaId) return []
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    // 1) Códigos de localización que pertenecen a la bodega.
    const { data: locs, error: locErr } = await supabase
      .from("locations")
      .select("codigo")
      .eq("bodega", bodegaId)
    if (locErr) {
      console.error("[v0] getLocationsByWarehouse: error locations:", locErr)
      return []
    }
    const codigosBodega = new Set((locs ?? []).map((l: any) => String(l.codigo)))
    if (codigosBodega.size === 0) return []

    // 2) Localizaciones con saldo en saldoinvdetalle para la empresa (paginado).
    const conSaldo = new Set<string>()
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from("saldoinvdetalle")
        .select("location")
        .eq("idempresa", empresaId)
        // Orden único y estable para paginar (ver lib/orden-paginacion.ts).
        .order("idempresa")
        .order("idproducto")
        .order("lote")
        .order("location")
        .range(from, from + 999)
      if (error) { console.error("[v0] getLocationsByWarehouse: error saldos:", error); break }
      for (const r of data ?? []) if (r.location) conSaldo.add(String(r.location))
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 60000) break
    }

    // 3) Intersección: localizaciones de la bodega que además tienen saldo.
    return [...conSaldo].filter((loc) => codigosBodega.has(loc)).sort()
  } catch (error) {
    console.error("[v0] Unexpected error getLocationsByWarehouse:", error)
    return []
  }
}

export async function getProductosFromSaldoInvDetalleByLocation(
  location: string,
  // `onlyWithStock`: si es true, descartamos filas con stock_disp <= 0
  // (incluye nulls). Se usa desde el formulario de transacciones cuando
  // el movimiento es "Salida" o "Reproceso", flujos que consumen stock
  // y por tanto solo deberian listar productos que efectivamente tienen
  // disponibilidad. Para "Entrada" se mantiene el comportamiento previo
  // (todos los productos del location, incluso con stock 0) porque ahi
  // si tiene sentido mover sobre referencias agotadas.
  onlyWithStock = false,
  selectedEmpresaId?: number | null,
): Promise<string[]> {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    let query = supabase
      .from("saldoinvdetalle")
      .select("nombreproducto")
      .eq("idempresa", empresaId)
      .eq("location", location)
      .order("nombreproducto", { ascending: true })

    if (onlyWithStock) {
      query = query.gt("stock_disp", 0)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching productos from saldoinvdetalle:", error)
      return []
    }

    const uniqueProductos = [...new Set(data?.map((item) => item.nombreproducto).filter((p) => p) || [])]
    console.log(
      "[v0] Unique productos for location",
      location,
      "(onlyWithStock=" + onlyWithStock + "):",
      uniqueProductos,
    )
    return uniqueProductos
  } catch (error) {
    console.error("[v0] Unexpected error fetching productos:", error)
    return []
  }
}

export async function getLotesFromSaldoInvDetalleByLocationAndProduct(
  location: string,
  producto: string,
  // Mismo criterio que `getProductosFromSaldoInvDetalleByLocation`:
  // cuando el movimiento es Salida/Reproceso solo queremos lotes con
  // stock disponible > 0. Para Entrada permitimos lotes con stock 0
  // (escenario valido al reabastecer una combinacion existente).
  onlyWithStock = false,
  selectedEmpresaId?: number | null,
): Promise<string[]> {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    let query = supabase
      .from("saldoinvdetalle")
      .select("lote")
      .eq("idempresa", empresaId)
      .eq("location", location)
      .eq("nombreproducto", producto)
      .order("lote", { ascending: true })

    if (onlyWithStock) {
      query = query.gt("stock_disp", 0)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching lotes from saldoinvdetalle:", error)
      return []
    }

    const uniqueLotes = [...new Set(data?.map((item) => item.lote).filter((l) => l) || [])]
    console.log(
      "[v0] Unique lotes for location",
      location,
      "and producto",
      producto,
      "(onlyWithStock=" + onlyWithStock + "):",
      uniqueLotes,
    )
    return uniqueLotes
  } catch (error) {
    console.error("[v0] Unexpected error fetching lotes:", error)
    return []
  }
}

export async function getDestinationLocationsFromLocationsTable(selectedEmpresaId?: number): Promise<string[]> {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    console.log("[v0] Fetching destination locations from locations table for empresa:", empresaId)

    const { data, error } = await supabase
      .from("locations")
      .select("codigo")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("codigo", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching destination locations from locations table:", error)
      return []
    }

    const uniqueLocations = [...new Set(data?.map((item) => item.codigo).filter((loc) => loc) || [])]
    console.log("[v0] Destination locations from locations table:", uniqueLocations)
    return uniqueLocations
  } catch (error) {
    console.error("[v0] Unexpected error fetching destination locations from locations table:", error)
    return []
  }
}

export async function getLocationsByProductAndBatch(
  bodegaId: number,
  productId: number,
  lote: string,
): Promise<Location[]> {
  try {
    const supabase = await createClient()
    const empresaId = await getCurrentEmpresaId()

    // Get the product name from the product ID - search without empresa filter
    const { data: productData } = await supabase
      .from("productos")
      .select("nombre")
      .eq("id", productId)
      .maybeSingle()

    const productName = productData?.nombre

    if (!productName) {
      console.error("[v0] Could not find product name for ID:", productId)
      return []
    }

    console.log("[v0] Filtering locations by nombreproducto, lote and bodega:", {
      bodega: bodegaId,
      nombreproducto: productName,
      lote,
      empresaId,
    })

    // Query saldoinvdetalle to find locations with this product and batch combination
    const { data: saldoData, error: saldoError } = await supabase
      .from("saldoinvdetalle")
      .select("location")
      .eq("idempresa", empresaId)
      .eq("nombreproducto", productName)
      .eq("lote", lote)
      .gt("stock_actual", 0) // Only locations with available stock

    if (saldoError) {
      console.error("[v0] Error fetching saldo data:", saldoError)
      return []
    }

    // Get unique location codes from saldo data
    const locationCodes = [...new Set((saldoData || []).map((s: any) => s.location))]

    if (locationCodes.length === 0) {
      console.log("[v0] No locations found for this product and batch combination")
      return []
    }

    // Fetch location details for these codes
    let query = supabase
      .from("locations")
      .select('codigo, "Descripción", bodega')
      .eq("activo", true)
      .eq("idempresa", empresaId)
      .eq("bodega", bodegaId)
      .in("codigo", locationCodes)

    const { data, error } = await query.order("codigo", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching location details:", error)
      return []
    }

    console.log("[v0] Locations for product/batch fetched:", data?.length || 0)
    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getLocations(bodegaId?: number, selectedEmpresaId?: number): Promise<Location[]> {
  try {
    const supabase = await createClient()

    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())
    console.log("[v0] Filtering locations by empresa_id:", empresaId)

    let query = supabase
      .from("locations")
      .select('codigo, "Descripción", bodega')
      .eq("activo", true)
      .eq("idempresa", empresaId) // Added empresa filter

    if (bodegaId) {
      query = query.eq("bodega", bodegaId)
    }

    const { data, error } = await query.order("codigo", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching locations:", error)
      return []
    }

    console.log("[v0] Locations fetched:", data?.length || 0)
    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

// Localizaciones para selección en formularios: devuelve el id numérico
// (para enviarlo al backend) junto con el código y descripción para
// mostrar. Filtra por empresa y, opcionalmente, por almacén (bodega).
export async function getLocationsWithId(
  bodegaId?: number,
  selectedEmpresaId?: number,
): Promise<{ id: number; codigo: string; descripcion: string | null }[]> {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    let query = supabase
      .from("locations")
      .select('id, codigo, "Descripción"')
      .eq("activo", true)
      .eq("idempresa", empresaId)

    if (bodegaId) {
      query = query.eq("bodega", bodegaId)
    }

    const { data, error } = await query.order("codigo", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching locations with id:", error)
      return []
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      codigo: row.codigo,
      descripcion: row["Descripción"] ?? null,
    }))
  } catch (error) {
    console.error("[v0] Unexpected error fetching locations with id:", error)
    return []
  }
}

export async function getProductsWithCodes() {
  try {
    const supabase = await createClient()

    let query = supabase
      .from("productos")
      .select("id, nombre, codigo, categoria, subcategoria, vidautildias")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching products:", error)
      return []
    }

    console.log("[v0] Fetched", data?.length || 0, "productos without empresa filter in production entry")
    return (data as ProductWithCode[]) || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getProductByName(productName: string): Promise<ProductWithCode | null> {
  try {
    if (!productName) {
      return null
    }

    const supabase = await createClient()

    console.log("[v0] Searching for product by name:", productName)

    const { data, error } = await supabase
      .from("productos")
      .select("id, nombre, codigo, categoria, subcategoria, vidautildias")
      .eq("activo", true)
      .ilike("nombre", productName)
      .maybeSingle()

    if (error) {
      console.error("[v0] Error fetching product by name:", error)
      return null
    }

    if (data) {
      console.log("[v0] Product found by name:", {
        id: data.id,
        nombre: data.nombre,
        codigo: data.codigo,
      })
    } else {
      console.log("[v0] No product found with name:", productName)
    }

    return data as ProductWithCode | null
  } catch (error) {
    console.error("[v0] Unexpected error fetching product by name:", error)
    return null
  }
}

export interface InventoryTransaction {
  id_producto: number
  codigo_producto: string
  producto: string
  lote: string
  localizacion: string
  almacen?: string // Changed from number to string to store almacen name
  cantidad: number
  tipo_movimiento: "Entrada" | "Salida" | "Reproceso"
  observaciones?: string | null // Added observaciones field
  cod_movimiento?: string | null // Código de nomenclatura elegido (si null, lo deriva el trigger)
  selectedEmpresaId?: number
}

export async function registerInventoryTransaction(transaction: InventoryTransaction) {
  try {
    console.log("[v0] Registering transaction with data:", transaction)

    // CONTROL DE GERENCIA (2026-09-27): 601 y 702 NO se ejecutan desde aquí.
    // Este formulario "clásico" insertaba directo en invtrans -- sin aprobación
    // y sin pasar por inv_correcciones_log -- y era la puerta trasera del control
    // que ya existía en "Movimiento por código" (SQL 62). Caso real: 120 und de
    // PT La Insuperable (lote 20260804, V28) salieron por 702 el 26-sep por
    // este camino mientras dos solicitudes del MISMO ajuste seguían
    // "pendientes" de aprobación; al ir a aprobarlas el stock ya era 0.
    const cod = String(transaction.cod_movimiento ?? "").trim()
    if (CODIGOS_REQUIEREN_APROBACION.has(cod)) {
      const nombre = cod === "601" ? "salida sin orden de cargue" : "salida por ajuste / faltante"
      return {
        success: false,
        message: `El concepto ${cod} (${nombre}) requiere aprobación de Gerencia y no se registra desde este formulario. Solicítalo en Transacciones de Inventario › "Movimiento por código": queda en "Aprobaciones pendientes" hasta que Gerencia lo apruebe con su clave.`,
      }
    }

    const supabase = await createClient()

    const { data: maxIdData, error: maxIdError } = await supabase
      .from("invtrans")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .single()

    if (maxIdError && maxIdError.code !== "PGRST116") {
      // PGRST116 = no rows returned (empty table)
      console.error("[v0] Error fetching max ID:", maxIdError)
      return { success: false, message: "Error al obtener el último ID: " + maxIdError.message }
    }

    const nextId = maxIdData ? maxIdData.id + 1 : 1
    console.log("[v0] Next ID to use:", nextId)

    const empresaId = transaction.selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())
    const usuario = await getCurrentUsuarioForInsert()

    const insertData: any = {
      id: nextId,
      idempresa: empresaId,
      idproducto: transaction.id_producto,
      codproducto: transaction.codigo_producto,
      nombreproducto: transaction.producto,
      lote: transaction.lote,
      location: transaction.localizacion,
      almacen: transaction.almacen, // Now stores almacen name (string) instead of ID
      cantidad: transaction.cantidad,
      tipomov: transaction.tipo_movimiento,
      observaciones: transaction.observaciones || null,
      status: "aprobado",
      origen: "transaccion manual",
      creadopor: usuario,
      creado: await getColombiaDateTime(), // Using Colombia timezone - MUST await
    }
    // Código de nomenclatura elegido (si no viene, el trigger lo deriva).
    if (transaction.cod_movimiento) insertData.cod_movimiento = transaction.cod_movimiento

    console.log("[v0] Insert data:", insertData)

    const { data, error } = await supabase.from("invtrans").insert([insertData]).select()

    if (error) {
      console.error("[v0] Error inserting transaction:", error)
      return { success: false, message: "Error al registrar la transacción: " + error.message }
    }

    console.log("[v0] Transaction inserted with ID:", data?.[0]?.id)

    if (transaction.tipo_movimiento === "Reproceso") {
      const reprocesoData = {
        idempresa: empresaId,
        lote: transaction.lote,
        producto: transaction.producto,
        codproducto: transaction.codigo_producto,
        cantidad: transaction.cantidad,
        creado: await getColombiaDateTime(), // Using Colombia timezone - MUST await
        creadopor: usuario,
      }

      console.log("[v0] Inserting reproceso data:", reprocesoData)

      const { error: reprocesoError } = await supabase.from("reprocesos").insert([reprocesoData])

      if (reprocesoError) {
        console.error("[v0] Error inserting reproceso:", reprocesoError)
        return { success: false, message: "Error al registrar el reproceso: " + reprocesoError.message }
      }

      console.log("[v0] Reproceso registered successfully")
    }

    console.log("[v0] Transaction registered successfully")
    return { success: true, message: "Transacción registrada exitosamente" }
  } catch (error) {
    console.error("[v0] Unexpected error registering transaction:", error)
    // Un movimiento de inventario que falla a medias tiene que verse el mismo día (registro SQL 217).
    void registrarErrorServidor("inventario.registerInventoryTransaction", error)
    return { success: false, message: "Error inesperado al registrar la transacción" }
  }
}

export async function getProductStockFromInvGlobal(productNames: string[], idempresa?: number): Promise<Record<string, number>> {
  try {
    if (productNames.length === 0) {
      return {}
    }

    // Use provided idempresa or get from user context
    let empresaId: number | null | undefined = idempresa
    if (!empresaId) {
      const { empresaId: contextEmpresaId } = await getCurrentUserContext()
      empresaId = contextEmpresaId
    }

    console.log("[v0] Fetching stock from invglobal for products:", productNames)
    console.log("[v0] Filtering by empresa ID:", empresaId)

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("invglobal")
      .select("nombreproducto, stock_global, idempresa")
      .in("nombreproducto", productNames)
      .eq("idempresa", empresaId) // Filter by empresa from parameter or session

    if (error) {
      console.error("[v0] Error fetching stock from invglobal:", error)
      return {}
    }

    console.log("[v0] Stock data retrieved:", data)
    console.log("[v0] Total records returned:", data?.length || 0)

    // Convert array to object with nombreproducto as key and stock_global as value
    // Initialize all products with 0, then override with actual values
    const stockMap: Record<string, number> = {}
    productNames.forEach((name) => {
      stockMap[name] = 0 // Default to 0 for all requested products
    })
    
    // Override with actual values from database
    // If there are duplicates for the same product/empresa, sum them
    data?.forEach((item) => {
      const currentStock = stockMap[item.nombreproducto] || 0
      stockMap[item.nombreproducto] = currentStock + (item.stock_global || 0)
      console.log(
        `[v0] Product: ${item.nombreproducto}, Empresa: ${item.idempresa}, Stock: ${item.stock_global}, Total: ${stockMap[item.nombreproducto]}`,
      )
    })

    console.log("[v0] Final stock map:", stockMap)
    return stockMap
  } catch (error) {
    console.error("[v0] Unexpected error fetching stock:", error)
    return {}
  }
}

export interface InventoryBalanceDetail {
  idproducto: number
  codproducto: string
  nombreproducto: string
  categoria: string
  subcategoria: string
  lote: string
  location: string
  stock_disp: number
  stock_res: number
  stock_actual: number
  /** Días transcurridos desde la fecha que codifica el lote. null = no se pudo
   *  determinar (ver `edadLoteDias`). Puede ser negativo si el lote quedó
   *  fechado en el futuro. */
  edad_dias: number | null
}

/** Hoy en el calendario COLOMBIANO (YYYY-MM-DD), sin depender de la zona del
 *  servidor. La edad del lote se cuenta contra este día. */
function hoyColombiaISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

/**
 * EDAD DEL LOTE en días.
 *
 * El lote codifica su fecha en formato YYYYMMDD. Es la convención del negocio,
 * no un supuesto de esta función: es la misma con la que
 * `lib/conciliacion-avimol-actions.ts` fecha la producción para facturarla y la
 * que consultan los scripts de tarifas (`lote ~ '^\d{8}$'`).
 *
 * Devuelve null cuando el lote no es una fecha válida —otro formato, vacío, o
 * dígitos imposibles como 20260231—. Preferimos no mostrar edad a mostrar una
 * inventada: en la tabla eso sale como "—".
 *
 * Un valor NEGATIVO significa lote fechado en el futuro. No se oculta ni se
 * recorta a 0 a propósito: es un error de digitación y conviene que se vea.
 */
function edadLoteDias(lote: unknown, hoyISO: string): number | null {
  const m = String(lote ?? "").trim().match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  const ms = Date.UTC(anio, mes - 1, dia)
  // Date.UTC corre las fechas imposibles al mes siguiente (31-feb -> 3-mar), así
  // que se comprueba que los componentes sobrevivan el viaje de ida y vuelta.
  const d = new Date(ms)
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  const [hy, hm, hd] = hoyISO.split("-").map(Number)
  return Math.round((Date.UTC(hy, hm - 1, hd) - ms) / 86_400_000)
}

export interface InventoryBalanceGlobal {
  idproducto: number
  codproducto: string
  nombreproducto: string
  categoria: string
  subcategoria: string
  stock_disp: number
  stock_res: number
  stock_global: number
}

export async function getInventoryBalanceDetails(
  productFilter?: string,
  locationFilter?: string,
  categoriaFilter?: string,
  subcategoriaFilter?: string,
  empresaId?: number | null,
): Promise<InventoryBalanceDetail[]> {
  try {
    const supabase = await createClient()

    console.log(
      "[v0] Filter values - product:",
      productFilter,
      "location:",
      locationFilter,
      "categoria:",
      categoriaFilter,
      "subcategoria:",
      subcategoriaFilter,
      "empresaId:",
      empresaId,
    )

    // Consulta re-construible por página: `saldoinvdetalle` supera 1000 filas por
    // empresa (misma tabla que getWarehouseCapacities ya pagina), así que sin paginar
    // el saldo mostrado y el Excel salían TRUNCADOS en silencio. Orden estable
    // (idproducto, lote, location) para que las páginas no se solapen ni salten. El
    // orden fino por letra/número de localización se resuelve en memoria más abajo.
    const makeQuery = (from: number, to: number) => {
      let query = supabase
        .from("saldoinvdetalle")
        .select(
          "idproducto, codproducto, nombreproducto, lote, location, stock_disp, stock_res, stock_actual, categoria, subcategoria",
        )
        .gt("stock_disp", 0)
        .order("idproducto", { ascending: true })
        .order("lote", { ascending: true })
        .order("location", { ascending: true })
      if (empresaId) query = query.eq("idempresa", empresaId)
      if (productFilter && productFilter.trim() !== "") query = query.ilike("nombreproducto", `%${productFilter}%`)
      if (locationFilter && locationFilter.trim() !== "" && locationFilter !== "all") query = query.eq("location", locationFilter)
      if (categoriaFilter && categoriaFilter !== "all") query = query.eq("categoria", categoriaFilter)
      if (subcategoriaFilter && subcategoriaFilter !== "all") query = query.eq("subcategoria", subcategoriaFilter)
      return query.range(from, to)
    }

    let data: any[]
    try {
      data = await fetchAllRows(makeQuery)
    } catch (err: any) {
      console.error("[v0] Error fetching inventory balance details:", err?.message || err)
      return []
    }

    console.log("[v0] Query returned", data?.length, "results")
    if (data && data.length > 0) {
      console.log("[v0] Sample result categoria:", data[0].categoria, "subcategoria:", data[0].subcategoria)
    }

    // ---- Orden compuesto final: idproducto ASC, luego localizacion
    // ASC (letra A-Z, dentro de cada letra numero ascendente). Hacemos
    // UNA sola query a `locations` filtrada por los codigos presentes
    // en el resultado para construir un mapa codigo -> { letra, numero }
    // y ordenar en memoria. Esto evita un join PostgREST que requeriria
    // FK declarada y ademas mantiene la compatibilidad con
    // `saldoinvdetalle.location` como string suelto.
    if (!data || data.length === 0) return []

    const uniqueCodigos = Array.from(
      new Set(data.map((d: any) => d.location).filter((c): c is string => !!c)),
    )

    const locMap = new Map<string, { letra: string | null; numero: number | null }>()
    if (uniqueCodigos.length > 0) {
      let locQuery = supabase
        .from("locations")
        .select("codigo, letra, numero")
        .in("codigo", uniqueCodigos)
      if (empresaId) {
        locQuery = locQuery.eq("idempresa", empresaId)
      }
      const { data: locRows, error: locError } = await locQuery
      if (locError) {
        console.error(
          "[v0] Error fetching locations for sort key in saldoinvdetalle:",
          locError,
        )
      }
      for (const row of locRows ?? []) {
        locMap.set(row.codigo, {
          letra: row.letra ?? null,
          numero: row.numero ?? null,
        })
      }
    }

    // Comparador estable: idproducto -> letra -> numero -> lote.
    // Mantenemos `lote` como ultimo desempate para preservar la
    // estabilidad cuando hay multiples lotes del mismo producto en la
    // misma localizacion. Codigos sin coincidencia en `locations` se
    // empujan al final (letra = "\uffff", numero = +Infinity).
    const sorted = [...data].sort((a: any, b: any) => {
      const idA = a.idproducto ?? 0
      const idB = b.idproducto ?? 0
      if (idA !== idB) return idA < idB ? -1 : 1

      const locA = locMap.get(a.location ?? "") ?? { letra: null, numero: null }
      const locB = locMap.get(b.location ?? "") ?? { letra: null, numero: null }

      const letraA = (locA.letra ?? "\uffff").toString()
      const letraB = (locB.letra ?? "\uffff").toString()
      const cmpLetra = letraA.localeCompare(letraB)
      if (cmpLetra !== 0) return cmpLetra

      const numA = locA.numero ?? Number.POSITIVE_INFINITY
      const numB = locB.numero ?? Number.POSITIVE_INFINITY
      if (numA !== numB) return numA - numB

      const loteA = (a.lote ?? "").toString()
      const loteB = (b.lote ?? "").toString()
      return loteA.localeCompare(loteB)
    })

    // Edad del lote. Se calcula aquí y no en el componente para que la tabla y
    // el Excel exportado salgan con el mismo número: `exportInventoryDetailsToExcel`
    // reutiliza esta misma función.
    const hoy = hoyColombiaISO()
    return sorted.map((r: any) => ({ ...r, edad_dias: edadLoteDias(r.lote, hoy) }))
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getInventoryBalanceGlobal(
  categoriaFilter?: string,
  subcategoriaFilter?: string,
  productoFilter?: string,
  empresaId?: number | null,
): Promise<InventoryBalanceGlobal[]> {
  try {
    const supabase = await createClient()

    console.log(
      "[v0] Global filter values - categoria:",
      categoriaFilter,
      "subcategoria:",
      subcategoriaFilter,
      "producto:",
      productoFilter,
      "empresaId:",
      empresaId,
    )

    let query = supabase
      .from("invglobal")
      .select("idproducto, codproducto, nombreproducto, stock_disp, stock_res, stock_global, categoria, subcategoria")
      // Filtro fijo del modulo "Saldos por producto": ocultar todo
      // producto cuyo Stock Final (`stock_global`) sea exactamente 0.
      // Se aplica en el servidor para no transferir filas que igual
      // no se mostrarian en la tabla ni en el Excel exportado. Se usa
      // `.neq(0)` (no `.gt(0)`) para preservar saldos negativos, que
      // son anomalias de datos que el negocio si quiere ver.
      .neq("stock_global", 0)
      .order("nombreproducto", { ascending: true })

    if (empresaId) {
      query = query.eq("idempresa", empresaId)
    }

    if (categoriaFilter && categoriaFilter !== "all") {
      console.log("[v0] Applying categoria filter:", categoriaFilter)
      query = query.eq("categoria", categoriaFilter)
    }

    if (subcategoriaFilter && subcategoriaFilter !== "all") {
      console.log("[v0] Applying subcategoria filter:", subcategoriaFilter)
      query = query.eq("subcategoria", subcategoriaFilter)
    }

    if (productoFilter && productoFilter !== "all") {
      console.log("[v0] Applying producto filter:", productoFilter)
      query = query.eq("nombreproducto", productoFilter)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching global inventory balance:", error)
      return []
    }

    console.log("[v0] Global query returned", data?.length, "results")
    if (data && data.length > 0) {
      console.log("[v0] Sample global result categoria:", data[0].categoria, "subcategoria:", data[0].subcategoria)
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error:", error)
    return []
  }
}

export async function getLotesByProductId(productId: number): Promise<string[]> {
  try {
    if (!productId) {
      return []
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("lote")
      .eq("idproducto", productId)
      .order("lote", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching lotes:", error)
      return []
    }

    // Extract unique lotes from the result
    const uniqueLotes = [...new Set(data?.map((item) => item.lote).filter((lote) => lote))]
    return uniqueLotes
  } catch (error) {
    console.error("[v0] Unexpected error fetching lotes:", error)
    return []
  }
}

export async function getBatches(productId: number): Promise<string[]> {
  return getLotesByProductId(productId)
}

export async function getCurrentStock(codproducto: string, lote: string, location: string): Promise<number | null> {
  try {
    if (!codproducto || !lote || !location) {
      return null
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("stock_actual")
      .eq("codproducto", codproducto)
      .eq("lote", lote)
      .eq("location", location)
      .maybeSingle()

    if (error) {
      console.error("[v0] Error fetching current stock:", error)
      return null
    }

    return data?.stock_actual ?? null
  } catch (error) {
    console.error("[v0] Unexpected error fetching current stock:", error)
    return null
  }
}

/** Saldo de UN lote del producto en una ubicación. */
export interface SaldoLoteUbicacion {
  lote: string
  stockActual: number
  stockDisp: number
  stockRes: number
}

/**
 * Saldo del producto en una ubicación: el total y el desglose por lote.
 */
export interface SaldoEnUbicacion {
  totalActual: number
  totalDisp: number
  totalRes: number
  lotes: SaldoLoteUbicacion[]
  /** El lote elegido en el formulario, si se paso y existe alli. */
  loteSeleccionado: SaldoLoteUbicacion | null
}

/**
 * Saldo ACTUAL de un producto en una ubicación, con el desglose por lote.
 *
 * Existe aparte de `getStockFromSaldoInvDetalle` por dos motivos:
 *
 *  1. No exige el LOTE. Al armar un movimiento se elige ubicación y producto
 *     antes que el lote, y es justo ahi cuando hace falta saber cuanto hay.
 *  2. Recibe la empresa como PARAMETRO en vez de leerla de la sesion. El modulo
 *     de transacciones trabaja con el selector global, que puede apuntar a una
 *     empresa distinta a la de la sesion; leyendo la de sesion se consultaria el
 *     saldo de otra empresa sin que nadie lo note.
 *
 * Se devuelven las tres cifras porque no son lo mismo y en una salida importan
 * las tres: `disp` es lo que se puede mover, `res` lo comprometido en ordenes y
 * `actual` el fisico total.
 */
export async function getSaldoEnUbicacion(
  location: string,
  nombreproducto: string,
  lote?: string | null,
  empresaId?: number | null,
): Promise<SaldoEnUbicacion | null> {
  try {
    if (!location || !nombreproducto) return null

    const supabase = await createClient()
    const idempresa = empresaId ?? (await getCurrentEmpresaId())

    let query = supabase
      .from("saldoinvdetalle")
      .select("lote, stock_actual, stock_disp, stock_res")
      .eq("nombreproducto", nombreproducto)
      .eq("location", location)
    if (idempresa) query = query.eq("idempresa", idempresa)

    const { data, error } = await query
    if (error) {
      console.error("[v0] Error fetching saldo en ubicacion:", error)
      return null
    }

    const num = (v: any) => Number(v) || 0
    const lotes: SaldoLoteUbicacion[] = (data || [])
      .map((r: any) => ({
        lote: String(r.lote ?? ""),
        stockActual: num(r.stock_actual),
        stockDisp: num(r.stock_disp),
        stockRes: num(r.stock_res),
      }))
      // Del lote mas viejo al mas nuevo: el lote codifica su fecha (AAAAMMDD),
      // asi que el orden alfabetico ES el cronologico y deja arriba lo que
      // deberia salir primero.
      .sort((a, b) => a.lote.localeCompare(b.lote))

    const loteBuscado = String(lote ?? "").trim()
    return {
      totalActual: lotes.reduce((s, l) => s + l.stockActual, 0),
      totalDisp: lotes.reduce((s, l) => s + l.stockDisp, 0),
      totalRes: lotes.reduce((s, l) => s + l.stockRes, 0),
      lotes,
      loteSeleccionado: loteBuscado ? lotes.find((l) => l.lote === loteBuscado) ?? null : null,
    }
  } catch (error) {
    console.error("[v0] Unexpected error fetching saldo en ubicacion:", error)
    return null
  }
}

export async function getStockFromSaldoInvDetalle(
  nombreproducto: string,
  lote: string,
  location: string,
): Promise<number | null> {
  try {
    if (!nombreproducto || !lote || !location) {
      console.log(
        "[v0] Missing parameters for stock query:",
        { nombreproducto, lote, location },
      )
      return null
    }

    const supabase = await createClient()
    const empresaId = await getCurrentEmpresaId()

    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("stock_actual")
      .eq("idempresa", empresaId)
      .eq("nombreproducto", nombreproducto)
      .eq("lote", lote)
      .eq("location", location)
      .maybeSingle()

    if (error) {
      console.error("[v0] Error fetching stock from saldoinvdetalle:", error)
      return null
    }

    const stock = data?.stock_actual ?? null
    console.log(
      "[v0] Stock fetched from saldoinvdetalle:",
      {
        nombreproducto,
        lote,
        location,
        stock,
      },
    )
    return stock
  } catch (error) {
    console.error("[v0] Unexpected error fetching stock from saldoinvdetalle:", error)
    return null
  }
}

export async function exportInventoryDetailsToExcel(
  productFilter?: string,
  locationFilter?: string,
  categoriaFilter?: string,
  subcategoriaFilter?: string,
  empresaId?: number | null,
): Promise<{ success: boolean; data?: string; filename?: string; error?: string }> {
  try {
    const details = await getInventoryBalanceDetails(
      productFilter,
      locationFilter,
      categoriaFilter,
      subcategoriaFilter,
      empresaId,
    )

    if (details.length === 0) {
      return { success: false, error: "No hay datos para exportar" }
    }

    const worksheet = XLSX.utils.json_to_sheet(
      details.map((item) => ({
        "ID Producto": item.idproducto,
        "Código Producto": item.codproducto,
        "Nombre Producto": item.nombreproducto,
        Categoria: item.categoria,
        Subcategoria: item.subcategoria,
        Lote: item.lote,
        // Numero (no texto) para que en Excel se pueda ordenar y filtrar por
        // edad. Vacio cuando el lote no codifica una fecha valida.
        "Edad del Lote (días)": item.edad_dias ?? "",
        Localización: item.location,
        "Stock Disponible": item.stock_disp,
        "Stock Reservado": item.stock_res,
        "Stock Actual": item.stock_actual,
      })),
    )

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Saldos Inventario")

    const excelBuffer = XLSX.write(workbook, { type: "base64", bookType: "xlsx" })
    const filename = `Saldos_Inventario_${await getColombiaDate()}.xlsx`

    return {
      success: true,
      data: excelBuffer,
      filename: filename,
    }
  } catch (error) {
    console.error("[v0] Error exporting inventory details to Excel:", error)
    return { success: false, error: "Error al generar el archivo Excel" }
  }
}

export async function exportInventoryGlobalToExcel(
  categoriaFilter?: string,
  subcategoriaFilter?: string,
  productoFilter?: string,
  empresaId?: number | null,
): Promise<{
  success: boolean
  data?: string
  filename?: string
  error?: string
}> {
  try {
    // Reutilizamos la misma funcion de consulta que usa la vista para
    // garantizar que el Excel salga con EXACTAMENTE los mismos
    // registros que el usuario esta viendo: respetando el filtro
    // dinamico de empresa (`empresaId`) y los filtros de categoria,
    // subcategoria y producto. Antes la exportacion no recibia
    // ningun parametro y `getInventoryBalanceGlobal()` caia al
    // empresa_id de la sesion, por lo que el archivo no respetaba el
    // selector de empresa.
    const balances = await getInventoryBalanceGlobal(
      categoriaFilter,
      subcategoriaFilter,
      productoFilter,
      empresaId ?? undefined,
    )

    if (balances.length === 0) {
      return { success: false, error: "No hay datos para exportar" }
    }

    const worksheet = XLSX.utils.json_to_sheet(
      balances.map((item) => ({
        "ID Producto": item.idproducto,
        "Código Producto": item.codproducto,
        "Nombre Producto": item.nombreproducto,
        Categoria: item.categoria,
        Subcategoria: item.subcategoria,
        "Stock Global": item.stock_global,
      })),
    )

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Global")

    const excelBuffer = XLSX.write(workbook, { type: "base64", bookType: "xlsx" })
    const filename = `Stock_Global_${await getColombiaDate()}.xlsx`

    return {
      success: true,
      data: excelBuffer,
      filename: filename,
    }
  } catch (error) {
    console.error("[v0] Error exporting global inventory to Excel:", error)
    return { success: false, error: "Error al generar el archivo Excel" }
  }
}

export interface Reproceso {
  id: number
  producto: string
  codproducto: string
  lote: string
  cantidad: number
  estado?: string
  creado?: string
  idempresa?: number
}

export async function getReprocesos(selectedEmpresaId?: number | null): Promise<Reproceso[]> {
  try {
    const supabase = await createClient()
    
    let query = supabase
      .from("reprocesos")
      .select("id, producto, codproducto, lote, cantidad, estado, creado, idempresa")
      .or("estado.is.null,estado.eq.")
    
    // Filter by empresa if provided
    if (selectedEmpresaId) {
      query = query.eq("idempresa", selectedEmpresaId)
    }
    
    const { data, error } = await query.order("id", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching reprocesos:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error fetching reprocesos:", error)
    return []
  }
}

export async function deleteReproceso(id: number): Promise<{ success: boolean; message: string }> {
  try {
    const supabase = await createClient()
    const { error } = await supabase.from("reprocesos").delete().eq("id", id)

    if (error) {
      console.error("[v0] Error deleting reproceso:", error)
      return { success: false, message: "Error al eliminar el reproceso: " + error.message }
    }

    return { success: true, message: "Reproceso eliminado exitosamente" }
  } catch (error) {
    console.error("[v0] Unexpected error deleting reproceso:", error)
    void registrarErrorServidor("inventario.deleteReproceso", error, { id })
    return { success: false, message: "Error inesperado al eliminar el reproceso" }
  }
}

export interface ProcessReprocesoData {
  id: number
  codproducto: string
  producto: string
  lote: string
  localizacion: string
  cantidad: number
}

export async function processReproceso(data: ProcessReprocesoData): Promise<{ success: boolean; message: string }> {
  try {
    const supabase = await createClient()

    // La gestion de reproceso ya NO genera transaccion en invtrans. Solo
    // actualiza el registro de la tabla reprocesos:
    // - estado = "procesado" (sale de la lista de pendientes)
    // - lote: se reescribe con el valor (posiblemente cambiado) recibido
    // - procesado: fecha/hora en que se gestiona el reproceso
    const { error: updateError } = await supabase
      .from("reprocesos")
      .update({
        estado: "procesado",
        lote: data.lote,
        procesado: new Date().toISOString(),
      })
      .eq("id", data.id)

    if (updateError) {
      console.error("[v0] Error updating reproceso:", updateError)
      return { success: false, message: "Error al actualizar el reproceso: " + updateError.message }
    }

    return { success: true, message: "Reproceso procesado exitosamente" }
  } catch (error) {
    console.error("[v0] Unexpected error processing reproceso:", error)
    void registrarErrorServidor("inventario.processReproceso", error)
    return { success: false, message: "Error inesperado al procesar el reproceso" }
  }
}

export interface ProductionEntry {
  id_producto: number
  codigo_producto: string
  producto: string
  lote: string
  cantidad: number
  observaciones?: string
  fechavencimiento?: string | null
  fechaproduccion?: string | null
  // Hora real de produccion ("HH:MM"). Junto con `fechaproduccion` es lo que
  // Liquidación Tolva usa para repartir las toneladas entre Turno 1 y Turno 2.
  // NO se deriva de `creado`: esa es la hora de REGISTRO, que puede ser de otro
  // dia si la produccion se captura despues.
  horaproduccion?: string | null
}

// Alias for backward compatibility.
// selectedEmpresaId: id de empresa elegido en el filtro dinamico de la barra superior.
// Si se provee se usa por encima del empresaId de la sesion del usuario.
const registerMultipleProductionEntries = async (
  entries: ProductionEntry[],
  selectedEmpresaId?: number | null,
): Promise<{
  success: boolean
  message: string
  pdfUrl?: string
}> => {
  try {
    console.log("[v0] Registering multiple production entries:", entries)

    const supabase = await createClient()

    // Get the last ID from invtrans
    const { data: lastRecord, error: lastRecordError } = await supabase
      .from("invtrans")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextId = 1
    if (lastRecordError) {
      console.error("[v0] Error fetching last invtrans ID:", lastRecordError)
      return { success: false, message: "Error al generar ID: " + lastRecordError.message }
    }

    if (lastRecord) {
      nextId = (lastRecord.id || 0) + 1
    }

    // Priorizar el filtro dinamico de empresa de la barra superior; si no, usar el de la sesion
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())
    const usuario = await getCurrentUsuario()

    console.log("[v0] DEBUG registerMultipleProductionEntries - selectedEmpresaId:", selectedEmpresaId)
    console.log("[v0] DEBUG registerMultipleProductionEntries - empresaId:", empresaId)
    console.log("[v0] DEBUG registerMultipleProductionEntries - usuario:", usuario)
    console.log("[v0] DEBUG registerMultipleProductionEntries - Final idempresa to use:", empresaId || 1)

    const now = new Date()
    const fecha = now.toLocaleDateString("es-CO")
    const hora = now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })

    const productionData = {
      fecha,
      hora,
      products: entries.map((entry) => ({
        producto: entry.producto,
        codigo_producto: entry.codigo_producto,
        lote: entry.lote,
        cantidad: entry.cantidad,
        observaciones: entry.observaciones || null,
        fechavencimiento: entry.fechavencimiento || null,
        fechaproduccion: entry.fechaproduccion || null,
      })),
      totalLineas: entries.length,
    }

    const pdfResult = await generateAndUploadProductionEntryPDF(productionData)

    if (!pdfResult.success) {
      console.error("[v0] Error generating PDF:", pdfResult.error)
      return { success: false, message: "Error al generar el PDF: " + pdfResult.error }
    }

    const pdfUrl = pdfResult.url || ""
    console.log("[v0] PDF generated successfully:", pdfUrl)

    const insertData = entries.map((entry, index) => ({
      id: nextId + index,
      idempresa: empresaId || 1, // Use empresaId from session with fallback
      idproducto: entry.id_producto,
      codproducto: entry.codigo_producto,
      nombreproducto: entry.producto,
      lote: entry.lote,
      cantidad: entry.cantidad,
      tipomov: "Entrada",
      status: null,
      origen: "ingreso producción",
      creadopor: usuario || "admin", // Use usuario from session with fallback
      creado: new Date().toISOString(),
      pdf: pdfUrl,
      observaciones: entry.observaciones || null,
      fechavencimiento: entry.fechavencimiento || null,
      fechaprod: entry.fechaproduccion || null,
      horaprod: entry.horaproduccion || null,
    }))

    console.log("[v0] Insert data for multiple entries:", insertData)

    const { error } = await supabase.from("invtrans").insert(insertData)

    if (error) {
      console.error("[v0] Error inserting production entries:", error)
      return { success: false, message: "Error al registrar los ingresos de producción: " + error.message }
    }

    console.log("[v0] All production entries registered successfully")
    return {
      success: true,
      message: `${entries.length} ingreso(s) de producción registrado(s) exitosamente`,
      pdfUrl,
    }
  } catch (error) {
    console.error("[v0] Unexpected error registering production entries:", error)
    void registrarErrorServidor("inventario.registerProductionEntries", error)
    return { success: false, message: "Error inesperado al registrar los ingresos de producción" }
  }
}

export const registerProductionEntries = registerMultipleProductionEntries

export async function registerProductionEntry(entry: ProductionEntry) {
  try {
    console.log("[v0] Registering production entry with data:", entry)

    const supabase = await createClient()

    const { data: lastRecord, error: lastRecordError } = await supabase
      .from("invtrans")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextId = 1
    if (lastRecordError) {
      console.error("[v0] Error fetching last invtrans ID:", lastRecordError)
      return { success: false, message: "Error al generar ID: " + lastRecordError.message }
    }

    if (lastRecord) {
      nextId = (lastRecord.id || 0) + 1
    }

    const empresaId = await getCurrentEmpresaId()
    const usuario = await getCurrentUsuario()

    console.log("[v0] DEBUG - empresaId returned:", empresaId)
    console.log("[v0] DEBUG - empresaId type:", typeof empresaId)
    console.log("[v0] DEBUG - empresaId is null?:", empresaId === null)
    console.log("[v0] DEBUG - empresaId is undefined?:", empresaId === undefined)
    console.log("[v0] DEBUG - Final idempresa value:", empresaId || 1)

    const insertData = {
      id: nextId,
      idempresa: empresaId || 1, // Use empresaId from session, fallback to 1 if null
      idproducto: entry.id_producto,
      codproducto: entry.codigo_producto,
      nombreproducto: entry.producto,
      lote: entry.lote,
      cantidad: entry.cantidad,
      tipomov: "Entrada",
      status: null,
      origen: "ingreso producción",
      creadopor: usuario,
      creado: await getColombiaDateTime(),
      observaciones: entry.observaciones || null,
      fechavencimiento: entry.fechavencimiento || null,
      fechaprod: entry.fechaproduccion || null,
      horaprod: entry.horaproduccion || null,
    }

    console.log("[v0] Insert data with idempresa:", insertData.idempresa)

    const { error } = await supabase.from("invtrans").insert([insertData])

    if (error) {
      console.error("[v0] Error inserting production entry:", error)
      return { success: false, message: "Error al registrar el ingreso de producción: " + error.message }
    }

    console.log("[v0] Production entry registered successfully")
    return { success: true, message: "Ingreso de producción registrado exitosamente" }
  } catch (error) {
    console.error("[v0] Unexpected error registering production entry:", error)
    void registrarErrorServidor("inventario.registerProductionEntry", error)
    return { success: false, message: "Error inesperado al registrar el ingreso de producción" }
  }
}

export interface ProductionEntryPending {
  id: number
  idproducto: number
  codproducto: string
  nombreproducto: string
  lote: string
  location: string
  almacen: string | null
  qrestiba: number | string | null
  cantidad: number
  creado: string
  creadopor: string
  observaciones: string | null
  origen: string | null
}

// selectedEmpresaId: id de empresa elegido en el filtro dinamico de la barra superior.
// Si se provee, se usa en lugar del empresaId de la sesion del usuario.
export async function getPendingProductionEntries(
  selectedEmpresaId?: number | null,
): Promise<ProductionEntryPending[]> {
  try {
    const supabase = await createClient()

    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    if (!empresaId) {
      console.error("[v0] No empresa ID found for current user")
      return []
    }

    const { data, error } = await supabase
      .from("invtrans")
      .select(
        "id, idproducto, codproducto, nombreproducto, lote, location, almacen, qrestiba, cantidad, creado, creadopor, observaciones, origen, tipo_produccion",
      )
      .eq("tipomov", "Entrada")
      .eq("idempresa", empresaId) // Filter by empresa ID from session
      .or("status.is.null,status.eq.")
      .order("creado", { ascending: false })

    if (error) {
      console.error("[v0] Error fetching pending production entries:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error fetching pending production entries:", error)
    return []
  }
}

// selectedEmpresaId: id de empresa elegido en el filtro dinamico de la barra superior.
// Si se provee se usa para marcar el historialaprobaciones; si no, se intenta tomar el de la sesion.
export async function approveProductionEntry(
  id: number,
  location: string,
  almacen: string,
  observaciones?: string,
  selectedEmpresaId?: number | null,
): Promise<{ success: boolean; message: string }> {
  try {
    const supabase = await createClient()

    const { data: entryData, error: fetchError } = await supabase
      .from("invtrans")
      .select("id, codproducto, nombreproducto, lote, cantidad, observaciones, fechaprod")
      .eq("id", id)
      .single()

    if (fetchError || !entryData) {
      console.error("[v0] Error fetching production entry:", fetchError)
      return {
        success: false,
        message: "Error al obtener los datos del ingreso: " + (fetchError?.message || "No encontrado"),
      }
    }

    const { error: updateError } = await supabase
      .from("invtrans")
      .update({
        status: "Aprobado",
        location: location,
        almacen: almacen,
        observaciones: observaciones || null,
      })
      .eq("id", id)

    if (updateError) {
      console.error("[v0] Error approving production entry:", updateError)
      return {
        success: false,
        message: "Error al aprobar el ingreso: " + updateError.message,
      }
    }

    // Usar el empresaId del filtro dinamico si se proveyo; si no, caer al de la sesion (por defecto 1)
    const empresaIdForApproval = selectedEmpresaId ?? (await getCurrentEmpresaId()) ?? 1

    const approvalRecord = {
      id: id, // Use the same ID from invtrans for traceability
      empresaid: empresaIdForApproval,
      codigo: entryData.codproducto,
      producto: entryData.nombreproducto,
      lote: entryData.lote,
      almacen: almacen,
      location: location,
      cantidad: entryData.cantidad,
      observaciones: observaciones || entryData.observaciones || null,
      fechahorafab: entryData.fechaprod || null,
      fechahoraaprob: await getColombiaDateTime(), // MUST await: es async; sin await se
      // insertaba una Promise -> el registro en historialaprobaciones fallaba en silencio.
      aprobadopor: "admin",
    }

    const { error: insertError } = await supabase.from("historialaprobaciones").insert([approvalRecord])

    if (insertError) {
      console.error("[v0] Error inserting approval history:", insertError)
      // Don't fail the whole operation if history insert fails
    }

    return {
      success: true,
      message: "Ingreso aprobado exitosamente",
    }
  } catch (error) {
    console.error("[v0] Unexpected error approving production entry:", error)
    void registrarErrorServidor("inventario.approveProductionEntry", error)
    return {
      success: false,
      message: "Error inesperado al aprobar el ingreso",
    }
  }
}

export async function rejectProductionEntry(id: number): Promise<{ success: boolean; message: string }> {
  try {
    const supabase = await createClient()
    const { error } = await supabase.from("invtrans").update({ status: "rechazado" }).eq("id", id)

    if (error) {
      console.error("[v0] Error rejecting production entry:", error)
      return { success: false, message: "Error al rechazar el ingreso: " + error.message }
    }

    return { success: true, message: "Ingreso rechazado exitosamente" }
  } catch (error) {
    console.error("[v0] Unexpected error rejecting production entry:", error)
    void registrarErrorServidor("inventario.rejectProductionEntry", error)
    return { success: false, message: "Error inesperado al rechazar el ingreso" }
  }
}

export interface InventoryTransactionRecord {
  id: number
  idempresa: number
  idproducto: number
  codproducto: string
  nombreproducto: string
  lote: string
  location: string
  cantidad: number
  tipomov: string
  status: string | null
  origen: string
  creadopor: string
  creado: string
  pdf?: string
  observaciones?: string // Added observaciones field to InventoryTransactionRecord interface
  fechavencimiento?: string | null // Added fechavencimiento field to InventoryTransactionRecord interface
  fechaprod?: string | null // Added fechaprod field to InventoryTransactionRecord interface
  almacen?: string // Added almacen field to InventoryTransactionRecord interface
  ordentolva?: string | null // Orden de tolva asociada al ingreso de produccion
  cod_movimiento?: string | null // Código de nomenclatura del movimiento (101/601/311/701/702/551)
  /**
   * De quien es la produccion. `null` = LIP (todo lo historico y todo lo que
   * sube el LOGO); `"Harinera"` = produccion propia de Harinera, que genera
   * inventario pero nunca llega a cabeceraoc ni a facturacion.
   */
  tipo_produccion?: string | null
}

export async function getAllInventoryTransactions(filters?: {
  producto?: string
  location?: string
  tipomov?: string
  status?: string
  // string = un solo ILIKE (comportamiento original, todos los llamadores
  // existentes). string[] = ILIKE de CUALQUIERA de los textos (OR) — lo usa
  // "Ver Ingresos de Producción" para incluir tanto "ingreso producción"
  // (ID1, manual) como "descargue" (CEDIs id3/id4, automático), sin tocar el
  // filtro de un solo texto que ya usan Tolva/Conciliación Avimol/QR.
  origen?: string | string[]
  creadopor?: string
  fecha?: string
  idempresa?: number | null
}): Promise<InventoryTransactionRecord[]> {
  try {
    const supabase = await createClient()
    let query = supabase
      .from("invtrans")
      .select(
        "id, idempresa, idproducto, codproducto, nombreproducto, lote, location, cantidad, tipomov, status, origen, creadopor, creado, pdf, observaciones, fechavencimiento, fechaprod, almacen, ordentolva, cod_movimiento, tipo_produccion",
      )

    // Filter by empresa_id if provided
    if (filters?.idempresa) {
      console.log("[v0] Filtering production entries by empresa_id:", filters.idempresa)
      query = query.eq("idempresa", filters.idempresa)
    }

    if (filters?.producto) {
      query = query.ilike("nombreproducto", `%${filters.producto}%`)
    }
    if (filters?.location) {
      query = query.eq("location", filters.location)
    }
    if (filters?.tipomov) {
      query = query.eq("tipomov", filters.tipomov)
    }
    if (filters?.status) {
      if (filters.status === "null") {
        query = query.is("status", null)
      } else {
        query = query.eq("status", filters.status)
      }
    }
    if (filters?.origen) {
      if (Array.isArray(filters.origen)) {
        query = query.or(filters.origen.map((o) => `origen.ilike.%${o}%`).join(","))
      } else {
        query = query.ilike("origen", `%${filters.origen}%`)
      }
    }
    if (filters?.creadopor) {
      query = query.ilike("creadopor", `%${filters.creadopor}%`)
    }
    if (filters?.fecha) {
      const startDate = new Date(filters.fecha)
      startDate.setHours(0, 0, 0, 0)
      const endDate = new Date(filters.fecha)
      endDate.setHours(23, 59, 59, 999)
      query = query.gte("creado", startDate.toISOString()).lte("creado", endDate.toISOString())
    }

    // Supabase topa cada respuesta en 1000 filas — sin paginar, cualquier
    // vista/filtro que junte más de 1000 movimientos (ej. "Ver Ingresos de
    // Producción" sin filtro de fecha) se corta en silencio. Orden estable
    // por `id` (columna única) para que `.range()` no salte/duplique filas
    // entre páginas.
    const todas: InventoryTransactionRecord[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await query.order("id", { ascending: false }).range(off, off + 999)
      if (error) {
        console.error("[v0] Error fetching all inventory transactions:", error)
        return todas
      }
      if (!data || data.length === 0) break
      todas.push(...data)
      if (data.length < 1000) break
    }

    console.log("[v0] Production entries fetched:", todas.length)
    return todas
  } catch (error) {
    console.error("[v0] Unexpected error fetching all inventory transactions:", error)
    return []
  }
}

export async function deleteInventoryTransaction(id: number): Promise<{ success: boolean; message: string }> {
  try {
    const supabase = await createClient()
    const { error } = await supabase.from("invtrans").delete().eq("id", id)

    if (error) {
      console.error("[v0] Error deleting inventory transaction:", error)
      return { success: false, message: "Error al eliminar la transacción: " + error.message }
    }

    return { success: true, message: "Transacción eliminada exitosamente" }
  } catch (error) {
    console.error("[v0] Unexpected error deleting inventory transaction:", error)
    void registrarErrorServidor("inventario.deleteInventoryTransaction", error, { id })
    return { success: false, message: "Error inesperado al eliminar la transacción" }
  }
}

/**
 * Actualiza el campo `ordentolva` en multiples filas de `invtrans` con el
 * numero de orden generado al crear una Tolva. Se usa para enlazar los
 * ingresos de produccion seleccionados con la orden de cargue creada en
 * `cabeceraoc` (ordendecargue = "Tolva{id}").
 */
export async function updateInvtransOrdentolva(
  ids: number[],
  ordentolva: string,
): Promise<{ success: boolean; message: string; updated?: number }> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false, message: "No se recibieron IDs para actualizar" }
  }
  if (!ordentolva || !ordentolva.trim()) {
    return { success: false, message: "Numero de orden de Tolva vacio" }
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("invtrans")
      .update({ ordentolva: ordentolva.trim() })
      .in("id", ids)
      .select("id")

    if (error) {
      console.error("[v0] Error updating invtrans.ordentolva:", error)
      return { success: false, message: `Error al actualizar orden de Tolva: ${error.message}` }
    }

    return {
      success: true,
      message: `Se vincularon ${data?.length ?? 0} ingresos a la orden ${ordentolva}`,
      updated: data?.length ?? 0,
    }
  } catch (error) {
    console.error("[v0] Unexpected error updating invtrans.ordentolva:", error)
    return { success: false, message: "Error inesperado al actualizar orden de Tolva" }
  }
}

export interface UpdateInventoryTransactionData {
  id: number
  idempresa: number
  idproducto: number
  codproducto: string
  nombreproducto: string
  // Opcionales: varios formularios de edición no los envían (runtime vigente).
  categoria?: string
  subcategoria?: string
  lote: string
  location: string
  cantidad: number
  tipomov: string
  status: string | null
  origen: string
  creadopor: string
  observaciones?: string // Added observaciones field to UpdateInventoryTransactionData interface
  fechavencimiento?: string | null // Added fechavencimiento field to UpdateInventoryTransactionData interface
  fechaprod?: string | null // Added fechaprod field to UpdateInventoryTransactionData interface
  almacen?: string // Added almacen field to UpdateInventoryTransactionData interface
}

export async function updateInventoryTransaction(
  data: UpdateInventoryTransactionData,
): Promise<{ success: boolean; message: string }> {
  try {
    const supabase = await createClient()

    const updateData = {
      idempresa: data.idempresa,
      idproducto: data.idproducto,
      codproducto: data.codproducto,
      nombreproducto: data.nombreproducto,
      categoria: data.categoria,
      subcategoria: data.subcategoria,
      lote: data.lote,
      location: data.location,
      almacen: data.almacen, // Added almacen field to update
      cantidad: data.cantidad,
      tipomov: data.tipomov,
      status: data.status,
      origen: data.origen,
      creadopor: data.creadopor,
      observaciones: data.observaciones || null, // Added observaciones field to update
      fechavencimiento: data.fechavencimiento || null, // Added fechavencimiento field to update
      fechaprod: data.fechaprod || null, // Added fechaprod field to update
    }

    const { error } = await supabase.from("invtrans").update(updateData).eq("id", data.id)

    if (error) {
      console.error("[v0] Error updating inventory transaction:", error)
      return { success: false, message: "Error al actualizar la transacción: " + error.message }
    }

    return { success: true, message: "Transacción actualizada exitosamente" }
  } catch (error) {
    console.error("[v0] Unexpected error updating inventory transaction:", error)
    void registrarErrorServidor("inventario.updateInventoryTransaction", error)
    return { success: false, message: "Error inesperado al actualizar la transacción" }
  }
}

export async function getBatchesByLocationAndProduct(location: string, nombreProducto: string): Promise<string[]> {
  try {
    if (!location || !nombreProducto) {
      console.log("[v0] getBatchesByLocationAndProduct called with missing params:", { location, nombreProducto })
      return []
    }

    console.log("[v0] Querying saldoinvdetalle with filters:", { location, nombreProducto })

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("lote, stock_actual")
      .eq("location", location)
      .eq("nombreproducto", nombreProducto)
      .gt("stock_actual", 0)
      .order("lote", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching batches:", error)
      return []
    }

    console.log("[v0] Raw data from saldoinvdetalle:", data)

    const uniqueLotes = [...new Set(data?.map((item) => item.lote).filter((lote) => lote))]
    console.log("[v0] Unique lotes extracted:", uniqueLotes)
    return uniqueLotes
  } catch (error) {
    console.error("[v0] Unexpected error fetching batches:", error)
    return []
  }
}

export async function getStockActual(location: string, nombreProducto: string, lote: string): Promise<number> {
  try {
    if (!location || !nombreProducto || !lote) {
      return 0
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("stock_actual")
      .eq("location", location)
      .eq("nombreproducto", nombreProducto)
      .eq("lote", lote)
      .single()

    if (error) {
      console.error("[v0] Error fetching stock actual:", error)
      return 0
    }

    console.log("[v0] Stock found:", data?.stock_actual ?? 0, "for", {
      location,
      nombreProducto,
      lote,
    })
    return data?.stock_actual ?? 0
  } catch (error) {
    console.error("[v0] Unexpected error fetching stock actual:", error)
    return 0
  }
}

export async function getLotesByProductAndLocation(productName: string, location: string): Promise<string[]> {
  try {
    if (!productName || !location) {
      console.log("[v0] Missing parameters - productName:", productName, "location:", location)
      return []
    }

    const supabase = await createClient()
    console.log(
      "[v0] Fetching lotes from saldoinvdetalle where nombreproducto =",
      productName,
      "and location =",
      location,
    )

    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("lote, stock_actual")
      .eq("nombreproducto", productName)
      .eq("location", location)
      .gt("stock_actual", 0)
      .order("lote", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching lotes by product and location:", error)
      return []
    }

    console.log("[v0] Raw data from saldoinvdetalle:", data)
    const uniqueLotes = [...new Set(data?.map((item) => item.lote).filter((lote) => lote))]
    console.log("[v0] Lotes found for product", productName, "at location", location, ":", uniqueLotes)
    return uniqueLotes
  } catch (error) {
    console.error("[v0] Unexpected error fetching lotes by product and location:", error)
    return []
  }
}

export async function getStockByProductCodeLoteLocation(
  codproducto: string,
  lote: string,
  location: string,
): Promise<number> {
  try {
    if (!codproducto || !lote || !location) {
      return 0
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("stock_actual")
      .eq("codproducto", codproducto)
      .eq("lote", lote)
      .eq("location", location)
      .maybeSingle()

    if (error) {
      console.error("[v0] Error fetching stock:", error)
      return 0
    }

    console.log("[v0] Stock found:", data?.stock_actual ?? 0, "for", {
      codproducto,
      lote,
      location,
    })
    return data?.stock_actual ?? 0
  } catch (error) {
    console.error("[v0] Unexpected error fetching stock:", error)
    return 0
  }
}

export async function getAllLocationsFromSaldoInvDetalle(): Promise<string[]> {
  try {
    const supabase = await createClient()
    const empresaId = await getCurrentEmpresaId()
    
    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("location")
      .eq("idempresa", empresaId)
      .order("location", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching all locations from saldoinvdetalle:", error)
      return []
    }

    const uniqueLocations = [...new Set(data?.map((item) => item.location).filter((loc) => loc))]
    console.log("[v0] All unique locations from saldoinvdetalle (no stock filter) for empresa", empresaId, ":", uniqueLocations)
    return uniqueLocations
  } catch (error) {
    console.error("[v0] Unexpected error fetching all locations:", error)
    return []
  }
}

/**
 * Localizaciones disponibles para el conteo fisico.
 *
 * Por defecto devuelve todas las locations con stock > 0 de la empresa
 * activa. Si se pasa `bodegaId`, intersectamos con la tabla `locations`
 * para devolver SOLO las localizaciones que pertenecen al almacen
 * seleccionado (`locations.bodega === bodegaId`).
 *
 * El cruce se hace en dos queries pequeñas en lugar de un join porque
 * `saldoinvdetalle.location` guarda el codigo (string) y `locations`
 * usa `codigo` como llave logica, sin FK formal.
 */
export async function getLocationsFromSaldoInvDetalle(
  bodegaId?: number,
  selectedEmpresaId?: number,
): Promise<string[]> {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    // PAGINADO (2026-09-30): sin `.range()` Supabase corta en 1.000 filas y, como
    // se ordena por ubicación, las últimas alfabéticamente (p. ej. CUARENTENA,
    // TMP, V…) desaparecían del desplegable en proyectos con mucho stock. Caso
    // real: en Avimol el 555 nunca activaba el botón porque CUARENTENA no
    // llegaba. Orden único (location, idproducto, lote) para paginar estable.
    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from("saldoinvdetalle")
          .select("location")
          .eq("idempresa", empresaId)
          .gt("stock_actual", 0)
          .order("location", { ascending: true })
          .order("idproducto")
          .order("lote")
          .range(from, to),
      )
    } catch (error) {
      console.error("[v0] Error fetching locations from saldoinvdetalle:", error)
      return []
    }

    const uniqueLocations = [
      ...new Set(data.map((item) => item.location).filter((loc) => loc)),
    ]

    // Si no se filtra por almacen, devolvemos todas.
    if (!bodegaId) {
      console.log(
        "[v0] Unique locations from saldoinvdetalle for empresa",
        empresaId,
        ":",
        uniqueLocations.length,
      )
      return uniqueLocations
    }

    if (uniqueLocations.length === 0) return []

    // Filtramos por almacen consultando la tabla `locations`. Usamos
    // `idempresa` y `bodega` para asegurar que la localizacion realmente
    // pertenezca al almacen Y a la empresa activa.
    const { data: locRows, error: locErr } = await supabase
      .from("locations")
      .select("codigo")
      .eq("idempresa", empresaId)
      .eq("bodega", bodegaId)
      .eq("activo", true)
      .in("codigo", uniqueLocations)

    if (locErr) {
      console.error("[v0] Error filtering locations by bodega:", locErr)
      return []
    }

    const allowed = new Set((locRows ?? []).map((r) => r.codigo))
    const filtered = uniqueLocations.filter((c) => allowed.has(c))
    console.log(
      "[v0] Locations filtered by bodega",
      bodegaId,
      ":",
      filtered.length,
      "/",
      uniqueLocations.length,
    )
    return filtered
  } catch (error) {
    console.error("[v0] Unexpected error fetching locations:", error)
    return []
  }
}

export async function getProductsFromSaldoInvDetalle(selectedEmpresaId?: number): Promise<string[]> {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("nombreproducto")
      .eq("idempresa", empresaId)
      .gt("stock_actual", 0)
      .order("nombreproducto", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching products from saldoinvdetalle:", error)
      return []
    }

    const uniqueProducts = [...new Set(data?.map((item) => item.nombreproducto).filter((prod) => prod))]
    console.log("[v0] Unique products from saldoinvdetalle for empresa", empresaId, ":", uniqueProducts)
    return uniqueProducts
  } catch (error) {
    console.error("[v0] Unexpected error fetching products:", error)
    return []
  }
}

export async function getLotesFromSaldoInvDetalle(location: string, nombreProducto: string): Promise<string[]> {
  try {
    if (!location || !nombreProducto) {
      console.log("[v0] Missing parameters - location:", location, "nombreProducto:", nombreProducto)
      return []
    }

    const supabase = await createClient()
    const empresaId = await getCurrentEmpresaId()
    console.log(
      "[v0] Fetching lotes from saldoinvdetalle where location =",
      location,
      "and nombreproducto =",
      nombreProducto,
      "and id_empresa =",
      empresaId,
    )

    const { data, error } = await supabase
      .from("saldoinvdetalle")
      .select("lote, stock_actual")
      .eq("location", location)
      .eq("nombreproducto", nombreProducto)
      .eq("idempresa", empresaId)
      .gt("stock_actual", 0)
      .order("lote", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching lotes from saldoinvdetalle:", error)
      return []
    }

    console.log("[v0] Raw data from saldoinvdetalle:", data)
    const uniqueLotes = [...new Set(data?.map((item) => item.lote).filter((lote) => lote))]
    console.log("[v0] Unique lotes found:", uniqueLotes)
    return uniqueLotes
  } catch (error) {
    console.error("[v0] Unexpected error fetching lotes:", error)
    return []
  }
}

export async function getProductDetailsForTransfer(
  nombreProducto: string,
): Promise<{ id: number; codigo: string } | null> {
  try {
    console.log("[v0] Getting product details for:", nombreProducto)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("productos")
      .select("id, codigo")
      .eq("nombre", nombreProducto)
      .limit(1)

    if (error) {
      console.error("[v0] Error getting product details:", error)
      return null
    }

    if (!data || data.length === 0) {
      console.error("[v0] No product found with name:", nombreProducto)
      return null
    }

    console.log("[v0] Product details found:", data[0])
    return data[0]
  } catch (error) {
    console.error("[v0] Error in getProductDetailsForTransfer:", error)
    return null
  }
}

export async function registerProductTransfer(
  origenLocation: string,
  destinoLocation: string,
  producto: string,
  lote: string,
  cantidad: number,
  selectedEmpresaId?: number,
): Promise<{ success: boolean; message: string }> {
  try {
    console.log("[v0] Registering product transfer:", {
      origenLocation,
      destinoLocation,
      producto,
      lote,
      cantidad,
    })

    // Get product details
    const productDetails = await getProductDetailsForTransfer(producto)
    if (!productDetails) {
      return { success: false, message: "No se encontró el producto" }
    }

    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    const { data: lastRecord, error: lastRecordError } = await supabase
      .from("invtrans")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextId = 1
    if (lastRecordError) {
      console.error("[v0] Error fetching last invtrans ID:", lastRecordError)
      return { success: false, message: "Error al generar ID: " + lastRecordError.message }
    }

    if (lastRecord) {
      nextId = (lastRecord.id || 0) + 1
    }

    // Trazabilidad real: usuario de la sesión (antes quedaba "admin" fijo y
    // nunca se sabía quién hizo el traslado) y hora Colombia, con el código
    // de nomenclatura 311 explícito.
    const now = await getColombiaDateTime()
    const usuarioTraslado = await getCurrentUsuarioForInsert()

    const transactions = [
      {
        id: nextId,
        idempresa: empresaId,
        codproducto: productDetails.codigo,
        idproducto: productDetails.id,
        nombreproducto: producto,
        lote: lote,
        location: origenLocation,
        almacen: origenLocation, // Save location value to almacen field
        cantidad: cantidad,
        tipomov: "Salida",
        status: "aprobado",
        origen: "traslado entre localizaciones",
        cod_movimiento: "311",
        creado: now,
        creadopor: usuarioTraslado,
      },
      {
        id: nextId + 1,
        idempresa: empresaId,
        codproducto: productDetails.codigo,
        idproducto: productDetails.id,
        nombreproducto: producto,
        lote: lote,
        location: destinoLocation,
        almacen: destinoLocation, // Save location value to almacen field
        cantidad: cantidad,
        tipomov: "Entrada",
        status: "aprobado",
        origen: "traslado entre localizaciones",
        cod_movimiento: "311",
        creado: now,
        creadopor: usuarioTraslado,
      },
    ]

    console.log("[v0] Inserting transactions:", transactions)

    const { error } = await supabase.from("invtrans").insert(transactions)

    if (error) {
      console.error("[v0] Error inserting transactions:", error)
      return { success: false, message: "Error al registrar el traslado: " + error.message }
    }

    console.log("[v0] Product transfer registered successfully")
    return { success: true, message: "Traslado registrado exitosamente" }
  } catch (error) {
    console.error("[v0] Unexpected error in registerProductTransfer:", error)
    void registrarErrorServidor("inventario.registerProductTransfer", error)
    return { success: false, message: "Error inesperado al registrar el traslado" }
  }
}

export async function getInventoryForAudit(
  location: string,
  productFilter?: string,
  selectedEmpresaId?: number,
): Promise<{ nombreproducto: string; lote: string; stock_actual: number }[]> {
  const supabase = await createClient()
  // Aplicamos el filtro dinamico de empresa (mismo helper que el resto
  // de funciones del modulo). Sin esto, dos empresas con el mismo
  // codigo de `location` podrian ver inventario cruzado y al hacer el
  // conteo fisico se cargarian lotes que no pertenecen a la empresa
  // activa. `stock_actual > 0` ya estaba; lo conservamos para que el
  // operador solo vea producto realmente contable.
  const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

  let query = supabase
    .from("saldoinvdetalle")
    .select("nombreproducto, lote, stock_actual")
    .eq("idempresa", empresaId)
    .eq("location", location)
    .gt("stock_actual", 0)
    .order("nombreproducto", { ascending: true })
    .order("lote", { ascending: true })

  if (productFilter && productFilter !== "all") {
    query = query.eq("nombreproducto", productFilter)
  }

  const { data, error } = await query

  if (error) {
    console.error("[v0] Error fetching inventory for audit:", error)
    throw new Error("Error al cargar el inventario para auditoría")
  }

  return data || []
}

export interface ApprovalHistoryRecord {
  id: number
  empresaid: number
  codigo: string
  producto: string
  lote: string
  almacen: string
  location: string
  cantidad: number
  observaciones: string | null
  fechahorafab: string | null
  fechahoraaprob: string
  aprobadopor: string
}

export async function getApprovalHistory(filters?: {
  producto?: string
  lote?: string
  almacen?: string
  location?: string
  fechaDesde?: string
  fechaHasta?: string
}): Promise<ApprovalHistoryRecord[]> {
  try {
    const supabase = await createClient()

    const empresaId = await getCurrentEmpresaId()

    let query = supabase
      .from("historialaprobaciones")
      .select(
        "id, empresaid, codigo, producto, lote, almacen, location, cantidad, observaciones, fechahorafab, fechahoraaprob, aprobadopor",
      )
      .eq("empresaid", empresaId) // Apply empresa filter
      .order("id", { ascending: true })

    if (filters?.producto) {
      query = query.ilike("producto", `%${filters.producto}%`)
    }
    if (filters?.lote) {
      query = query.ilike("lote", `%${filters.lote}%`)
    }
    if (filters?.almacen) {
      query = query.eq("almacen", filters.almacen)
    }
    if (filters?.location) {
      query = query.eq("location", filters.location)
    }
    if (filters?.fechaDesde) {
      query = query.gte("fechahoraaprob", filters.fechaDesde)
    }
    if (filters?.fechaHasta) {
      const endDate = new Date(filters.fechaHasta)
      endDate.setHours(23, 59, 59, 999)
      query = query.lte("fechahoraaprob", endDate.toISOString())
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching approval history:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Unexpected error fetching approval history:", error)
    return []
  }
}

export async function getApprovalHistoryFilterOptions(): Promise<{
  productos: string[]
  lotes: string[]
  almacenes: string[]
  localizaciones: string[]
}> {
  try {
    const supabase = await createClient()

    const empresaId = await getCurrentEmpresaId()

    // Get unique productos
    const { data: productosData } = await supabase
      .from("historialaprobaciones")
      .select("producto")
      .eq("empresaid", empresaId) // Apply empresa filter
      .not("producto", "is", null)
      .order("producto")

    // Get unique lotes
    const { data: lotesData } = await supabase
      .from("historialaprobaciones")
      .select("lote")
      .eq("empresaid", empresaId) // Apply empresa filter
      .not("lote", "is", null)
      .order("lote")

    // Get unique almacenes
    const { data: almacenesData } = await supabase
      .from("historialaprobaciones")
      .select("almacen")
      .eq("empresaid", empresaId) // Apply empresa filter
      .not("almacen", "is", null)
      .order("almacen")

    // Get unique localizaciones
    const { data: localizacionesData } = await supabase
      .from("historialaprobaciones")
      .select("location")
      .eq("empresaid", empresaId) // Apply empresa filter
      .not("location", "is", null)
      .order("location")

    const productos = Array.from(new Set(productosData?.map((p) => p.producto) || []))
    const lotes = Array.from(new Set(lotesData?.map((l) => l.lote) || []))
    const almacenes = Array.from(new Set(almacenesData?.map((a) => a.almacen) || []))
    const localizaciones = Array.from(new Set(localizacionesData?.map((l) => l.location) || []))

    return { productos, lotes, almacenes, localizaciones }
  } catch (error) {
    console.error("[v0] Error fetching approval history filter options:", error)
    return { productos: [], lotes: [], almacenes: [], localizaciones: [] }
  }
}

export interface WarehouseCapacity {
  codigo: string
  capacidad: number
  stockActual: number
  porcentajeUtilizacion: number
  // Almacen al que pertenece la localizacion. La columna `bodega` en la
  // tabla `locations` referencia `almacenes.id`. Se devuelve tanto el id
  // como el nombre legible para que el dashboard pueda filtrar por
  // almacen sin un segundo viaje a BD.
  bodegaId: number | null
  bodegaNombre: string | null
}

export async function getWarehouseCapacities(selectedEmpresaId?: number | null): Promise<WarehouseCapacity[]> {
  try {
    console.log("[v0] Starting getWarehouseCapacities")
    const supabase = await createClient()

    // Respeta el selector global: usa la empresa que manda el cliente; si no
    // llegó, cae a la empresa de sesión (cookie).
    const empresaId = selectedEmpresaId || (await getCurrentEmpresaId())
    console.log("[v0] Filtering locations by empresaId:", empresaId)

    // Orden compuesto: PRIMERO alfabetico ascendente por `letra`
    // (A, B, C...) y dentro de cada letra, ascendente NUMERICO por
    // `numero` (1, 2, 10, no 1, 10, 2 como seria con orden lexicografico).
    // PostgREST ordena `numero` como entero porque la columna es
    // numerica en BD; si fuera text habria que usar `cast`. Se mantiene
    // `id` en el SELECT por compatibilidad con la dedupe que conserva
    // la PRIMERA ocurrencia segun el orden de la query.
    const { data: locations, error: locationsError } = await supabase
      .from("locations")
      .select("id, codigo, capacidad, bodega, letra, numero")
      .eq("activo", true)
      .eq("idempresa", empresaId)
      .order("letra", { ascending: true })
      .order("numero", { ascending: true })

    console.log("[v0] Locations query result:", { locations, error: locationsError })

    if (locationsError) {
      console.error("[v0] Error fetching locations:", locationsError)
      return []
    }

    if (!locations || locations.length === 0) {
      console.log("[v0] No locations found")
      return []
    }

    console.log("[v0] Found locations:", locations.length)

    // Dedupe por `codigo`. La tabla `locations` puede tener duplicados
    // (carga repetida, mismo codigo entre bodegas, etc.) y eso provoca
    // que la misma localizacion aparezca varias veces en el dashboard,
    // independiente del bucket filtrado (Llenas/Parciales/Vacias).
    // Conservamos la PRIMERA ocurrencia (la query viene ordenada por
    // codigo asc, por id implicito de PostgREST) y registramos cuantos
    // duplicados se descartaron para visibilidad en logs.
    const seenCodigos = new Set<string>()
    const uniqueLocations = locations.filter((l) => {
      if (seenCodigos.has(l.codigo)) return false
      seenCodigos.add(l.codigo)
      return true
    })
    if (uniqueLocations.length !== locations.length) {
      console.log(
        `[v0] Dedupe locations: ${locations.length - uniqueLocations.length} duplicados descartados`,
      )
    }

    // Map de almacenes (id -> nombre) para enriquecer cada localizacion
    // con el nombre legible del almacen. Una sola query, sin N+1.
    const bodegaIds = Array.from(
      new Set(uniqueLocations.map((l) => l.bodega).filter((id): id is number => id != null)),
    )
    const almacenMap = new Map<number, string>()
    if (bodegaIds.length > 0) {
      const { data: almacenesData, error: almacenesError } = await supabase
        .from("almacenes")
        .select("id, nombre")
        .in("id", bodegaIds)
      if (almacenesError) {
        console.error("[v0] Error fetching almacenes for capacity dashboard:", almacenesError)
      }
      for (const a of almacenesData ?? []) {
        almacenMap.set(a.id, a.nombre)
      }
    }

    // Stock por localización en UNA sola consulta (antes se hacía UNA query por
    // cada localización → N+1: con 140 localizaciones tardaba ~10s). Traemos todo
    // el saldo de la empresa para esas localizaciones y sumamos en memoria. Se
    // filtra por `idempresa` para que cada empresa vea SOLO su stock (no cruzado).
    const codigos = uniqueLocations.map((l) => l.codigo)
    const stockPorLocation = new Map<string, number>()
    {
      let from = 0
      while (true) {
        const { data: rows, error: stockErr } = await supabase
          .from("saldoinvdetalle")
          .select("location, stock_actual")
          .eq("idempresa", empresaId)
          .in("location", codigos)
          // Orden único y estable para paginar (ver lib/orden-paginacion.ts).
          .order("idempresa")
          .order("idproducto")
          .order("lote")
          .order("location")
          .range(from, from + 999)
        if (stockErr) {
          console.error("[v0] Error fetching stock (batch):", stockErr)
          break
        }
        for (const r of rows ?? []) {
          const loc = String((r as any).location)
          stockPorLocation.set(loc, (stockPorLocation.get(loc) || 0) + (Number((r as any).stock_actual) || 0))
        }
        if (!rows || rows.length < 1000) break
        from += 1000
        if (from > 100000) break
      }
    }

    const capacities: WarehouseCapacity[] = uniqueLocations.map((location) => {
      const stockActual = stockPorLocation.get(location.codigo) || 0
      const capacidad = location.capacidad || 0
      const porcentajeUtilizacion = capacidad > 0 ? (stockActual / capacidad) * 100 : 0
      const bodegaId = location.bodega ?? null
      const bodegaNombre = bodegaId != null ? almacenMap.get(bodegaId) ?? null : null
      return { codigo: location.codigo, capacidad, stockActual, porcentajeUtilizacion, bodegaId, bodegaNombre }
    })

    console.log("[v0] Returning capacities:", capacities.length)
    return capacities
  } catch (error) {
    console.error("[v0] Unexpected error in getWarehouseCapacities:", error)
    return []
  }
}

export async function searchInventoryByQR(qrId: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("view_inventario_por_estiba")
      .select("codproducto, nombreproducto, lote, location, stock_total")
      .eq("idqr", qrId)

    if (error) {
      console.error("[v0] Error searching inventory by QR:", error)
      return {
        success: false,
        error: "Error al buscar el inventario por QR",
        data: [],
      }
    }

    return {
      success: true,
      data: data || [],
      hasData: data && data.length > 0,
    }
  } catch (error) {
    console.error("[v0] Unexpected error searching inventory by QR:", error)
    return {
      success: false,
      error: "Error inesperado al buscar el inventario",
      data: [],
    }
  }
}

export async function registerQRPalletFromTransaction(data: {
  qrId: string
  idproducto: number
  nombreproducto: string
  codproducto: string
  lote: string
  cantidad: number
  localizacion: string
  bodega: string
  tipoMovimiento: string
  fechaVencimiento: string | null
}) {
  const supabase = await createClient()

  try {
    const currentDate = new Date()
    const fecha = currentDate.toISOString().split("T")[0]
    const hora = currentDate.toTimeString().split(" ")[0]

    // Get week number
    const onejan = new Date(currentDate.getFullYear(), 0, 1)
    const week = Math.ceil(((currentDate.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7)

    // Update qrestibacabecera
    const { error: cabeceraError } = await supabase
      .from("qrestibacabecera")
      .update({
        idempresa: 1,
        idproducto: data.idproducto,
        nombreproducto: data.nombreproducto,
        fecha: fecha,
        hora: hora,
        operador: "admin",
        semana: week,
        bodega: data.bodega,
      })
      .eq("id", data.qrId)

    if (cabeceraError) {
      console.error("[v0] Error updating qrestibacabecera:", cabeceraError)
      throw cabeceraError
    }

    // Insert into qrestibadetalle SIN id explícito: la columna es SERIAL. Fijarlo a
    // mano (max+1) NO avanza la secuencia y colisiona con las rutas que insertan por
    // nextval (verificación QR en Picking, traslado de estibas) -> 'duplicate key'.
    const detalleRecord = {
      idqr: data.qrId,
      codproducto: data.codproducto,
      nombreproducto: data.nombreproducto,
      lote: data.lote,
      cantidad: data.cantidad,
      location: data.localizacion,
      fechavenc: data.fechaVencimiento,
      tipomov: data.tipoMovimiento,
    }

    const { error: detalleError } = await supabase.from("qrestibadetalle").insert([detalleRecord])

    if (detalleError) {
      console.error("[v0] Error inserting qrestibadetalle:", detalleError)
      throw detalleError
    }

    return {
      success: true,
      message: "Estiba registrada correctamente en tablas QR",
    }
  } catch (error) {
    console.error("[v0] Error registering QR pallet from transaction:", error)
    return {
      success: false,
      error: "Error al registrar la estiba en tablas QR",
    }
  }
}
