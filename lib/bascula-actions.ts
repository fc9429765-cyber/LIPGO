"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaId } from "@/lib/company-filter"
import { esProductoPorUnidad } from "@/lib/facturacion-billed-party"

export async function getBasculaHistory(selectedEmpresaId?: number | null) {
  try {
    const supabase = await createClient()
    // Use selectedEmpresaId if provided, otherwise fall back to current user's empresa_id
    const empresaId = selectedEmpresaId ?? await getCurrentEmpresaId()

    let query = supabase
      .from("cabeceraoc")
      .select(
        "id, ordendecargue, fechaorden, fechacargue, placa, transporte, tiquetebascula, pesoorden, pesovascula",
      )
      // Las proyecciones (tipooperacion="proyeccion") son estimados de
      // producción/pedidos, no pasan por báscula real: no pertenecen a este
      // historial. La Tolva ("Tolva"/"Tolva f") es tonelaje interno de
      // producción (destajo de auxiliares), tampoco pasa por báscula.
      .neq("tipooperacion", "proyeccion")
      .neq("tipooperacion", "Tolva")
      .neq("tipooperacion", "Tolva f")
      // Solo las PLANTAS (idempresa 1/2) tienen báscula física. Los CEDIS
      // (3/4 y cualquier otra empresa) por ahora no la tienen: su
      // pesovascula/pesoorden se calcula desde los productos de la orden,
      // no desde un pesaje real, así que no pertenecen a este historial.
      // Mismo criterio que `esBascula` en facturacion-control-actions.ts.
      .in("idempresa", [1, 2])
      .order("fechaorden", { ascending: false })

    // Aplicar filtro de empresa (si el usuario filtró una planta específica)
    if (empresaId) {
      query = query.eq("idempresa", empresaId)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error loading bascula history:", error)
      return { success: false, error: error.message, data: [] }
    }

    const rows = data || []

    // Ton producto = Σ toneladas del detalle REAL de cada orden (detalleoc),
    // no `pesoorden` (que puede quedar desactualizado si se editan las
    // líneas después de creada la orden). Sirve para comparar contra el
    // peso de báscula y detectar tiquetes mal digitados.
    const ids = rows.map((r: any) => r.id).filter((id: any) => id != null)
    const tonProductoPorOrden = new Map<number, number>()
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      // Un chunk de 500 órdenes puede traer MÁS de 1000 líneas de detalle (una
      // orden trae varias): sin paginar, Supabase corta en 1000 filas y varias
      // órdenes se quedan sin ninguna línea contada (Ton Producto queda null
      // por error, no porque de verdad no tenga detalle). Se pagina hasta
      // agotar el chunk, igual que el resto de consultas grandes de la app.
      for (let offset = 0; ; offset += 1000) {
        const { data: detalle } = await supabase
          .from("detalleoc")
          .select("idorden, toneladas")
          .in("idorden", chunk)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(offset, offset + 999)
        if (!detalle || detalle.length === 0) break
        for (const d of detalle) {
          const idorden = Number(d.idorden)
          tonProductoPorOrden.set(idorden, (tonProductoPorOrden.get(idorden) || 0) + (Number(d.toneladas) || 0))
        }
        if (detalle.length < 1000) break
      }
    }

    const dataConComparacion = rows.map((r: any) => {
      const tonProducto = tonProductoPorOrden.has(r.id) ? Math.round(tonProductoPorOrden.get(r.id)! * 1000) / 1000 : null
      const diferencia =
        r.pesovascula != null && tonProducto != null ? Math.round((Number(r.pesovascula) - tonProducto) * 1000) / 1000 : null
      return { ...r, tonProducto, diferencia }
    })

    return { success: true, data: dataConComparacion }
  } catch (error) {
    console.error("[v0] Error in getBasculaHistory:", error)
    return { success: false, error: "Error al cargar el historial de báscula", data: [] }
  }
}

/**
 * Retrieves the product + lote + cantidad detail lines for a given
 * loading order (ocargue), so the Báscula screens can display what's
 * physically loaded on the truck. Data comes from `invtrans`.
 *
 * Columns: nombreproducto, lote, cantidad (matching the request).
 */
export async function getOrderProductDetails(
  ocargue: string,
  selectedEmpresaId?: number | null,
) {
  try {
    if (!ocargue) {
      return { success: false, error: "Orden de cargue vacía", data: [] }
    }

    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    let query = supabase
      .from("invtrans")
      .select("nombreproducto, lote, cantidad")
      .eq("ocargue", ocargue)

    if (empresaId) {
      query = query.eq("idempresa", empresaId)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error loading order product details:", error)
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Error in getOrderProductDetails:", error)
    return {
      success: false,
      error: "Error al cargar el detalle de productos",
      data: [],
    }
  }
}

export async function updateBasculaRecord(
  id: number,
  pesovascula: number,
  tiquetebascula: string,
  // Opcional para mantener compatibilidad con llamadas existentes. Si se
  // envia, se persiste el nuevo transporte en cabeceraoc junto con el
  // peso y el tiquete.
  transporte?: string,
) {
  try {
    const supabase = await createClient()

    const updatePayload: Record<string, unknown> = { pesovascula, tiquetebascula }
    if (transporte !== undefined) {
      updatePayload.transporte = transporte
    }

    const { error } = await supabase
      .from("cabeceraoc")
      .update(updatePayload)
      .eq("id", id)

    if (error) {
      console.error("[v0] Error updating bascula record:", error)
      return { success: false, error: error.message }
    }

    // Productos por UNIDAD (Huevos/Empaque MP, ver esProductoPorUnidad) no
    // tienen "peso de báscula" real -- su pesovascula/pesoorden es la propia
    // cantidad de unidades (ver comentario "es_por_unidad" en dashboard-actions.ts).
    // La facturación NO lee cabeceraoc.pesoorden para estos productos, lee
    // detalleoc.cantidad directo (vista `facturacion`) -- así que si aquí solo
    // se corrige cabeceraoc, la corrección nunca llega a lo que se factura.
    // Solo se sincroniza cuando la orden tiene EXACTAMENTE una línea por
    // unidad (mapeo sin ambigüedad); si hay 0 o varias, se deja intacto.
    const { data: detalle } = await supabase
      .from("detalleoc")
      .select("id, producto, cantidad, toneladas")
      .eq("idorden", id)

    if (detalle && detalle.length > 0) {
      const nombresProductos = Array.from(new Set(detalle.map((d: any) => d.producto).filter(Boolean)))
      const { data: productosData } = await supabase
        .from("productos")
        .select("nombre, subcategoria")
        .in("nombre", nombresProductos)
      const subcategoriaPorNombre = new Map<string, string | null>()
      for (const p of productosData || []) subcategoriaPorNombre.set(p.nombre, p.subcategoria ?? null)

      const lineasPorUnidad = detalle.filter((d: any) => esProductoPorUnidad(subcategoriaPorNombre.get(d.producto)))
      if (lineasPorUnidad.length === 1) {
        const linea = lineasPorUnidad[0] as any
        const { error: errDetalle } = await supabase
          .from("detalleoc")
          .update({ cantidad: pesovascula, toneladas: pesovascula })
          .eq("id", linea.id)
        if (errDetalle) {
          console.error("[v0] Error sincronizando detalleoc tras corrección de báscula:", errDetalle)
        }
      }
    }

    return { success: true }
  } catch (error) {
    console.error("[v0] Error in updateBasculaRecord:", error)
    return { success: false, error: "Error al actualizar el registro de báscula" }
  }
}
