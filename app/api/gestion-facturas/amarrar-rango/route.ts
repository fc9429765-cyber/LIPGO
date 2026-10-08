import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirModuloApi } from "@/lib/puerta-api"

// Amarra UNA factura de Siigo a TODAS las órdenes "CF - Factura solicitada" de una
// empresa dentro de un rango de fechas (una factura de Siigo cubre varios días/solicitudes).
// Les fija `facturasiigo` (la misma URL) y cierra su estado a "CF - Cerrado".
export async function POST(request: NextRequest) {
  const puerta = await exigirModuloApi(["Solicitar Facturas", "Cuadro de Control Facturación"])
  if (puerta) return puerta
  try {
    const body = await request.json()
    const { idempresa, facturasiigo, desde, hasta, transporte, undo } = body as {
      idempresa?: number
      facturasiigo?: string
      desde?: string
      hasta?: string
      // Opcional: acota el amarre/deshacer a un transporte (mismo criterio "contiene,
      // sin mayúsculas" que el filtro de Transporte del listado principal), para
      // aplicar la factura Siigo exactamente al transporte correspondiente cuando el
      // rango de fechas tiene órdenes de más de una transportadora.
      transporte?: string
      undo?: boolean
    }

    if (!idempresa) return NextResponse.json({ success: false, error: "idempresa es requerido" }, { status: 400 })
    if (!desde || !hasta) return NextResponse.json({ success: false, error: "Rango de fechas requerido (desde y hasta)" }, { status: 400 })
    if (!undo && !facturasiigo) return NextResponse.json({ success: false, error: "Primero sube la factura de Siigo" }, { status: 400 })

    const supabase = await getSupabaseAdmin()
    // "all" = sin filtro (sentinel del Select "Todos"), igual que estado/tipoOperacion.
    const transporteTrim = transporte && transporte !== "all" ? transporte.trim() : ""

    // UPDATE directo por FILTROS (no por lista de ids): un SELECT previo se topa en
    // 1000 filas y dejaba el resto del rango sin amarrar/deshacer en silencio. El
    // UPDATE por filtros afecta TODAS las filas que cumplen y `count: "exact"` devuelve
    // el total real actualizado, sin el tope de 1000 de las lecturas.
    if (undo) {
      // DESHACER: revierte las órdenes cerradas CON factura Siigo del rango a "Factura solicitada".
      let undoQuery = supabase
        .from("cabeceraoc")
        .update({ facturasiigo: null, estadofactura: "CF - Factura solicitada" }, { count: "exact" })
        .eq("idempresa", idempresa)
        .eq("estadofactura", "CF - Cerrado")
        .not("facturasiigo", "is", null)
        .gte("fechacargue", desde)
        .lte("fechacargue", hasta)
      if (transporteTrim) undoQuery = undoQuery.ilike("transporte", `%${transporteTrim}%`)
      const { count, error: updError } = await undoQuery
      if (updError) return NextResponse.json({ success: false, error: updError.message }, { status: 500 })
      if (!count) return NextResponse.json({ success: true, count: 0, message: "No hay órdenes amarradas en ese rango." })
      return NextResponse.json({ success: true, count })
    }

    // AMARRAR: órdenes "CF - Factura solicitada" del rango (y transporte, si se filtró) → factura Siigo + cerrar.
    let amarrarQuery = supabase
      .from("cabeceraoc")
      .update({ facturasiigo, estadofactura: "CF - Cerrado" }, { count: "exact" })
      .eq("idempresa", idempresa)
      .eq("estadofactura", "CF - Factura solicitada")
      .gte("fechacargue", desde)
      .lte("fechacargue", hasta)
    if (transporteTrim) amarrarQuery = amarrarQuery.ilike("transporte", `%${transporteTrim}%`)
    const { count, error: updError } = await amarrarQuery

    if (updError) return NextResponse.json({ success: false, error: updError.message }, { status: 500 })
    if (!count) {
      return NextResponse.json({ success: true, count: 0, message: "No hay órdenes 'Factura solicitada' en ese rango." })
    }

    return NextResponse.json({ success: true, count })
  } catch (error) {
    console.error("Error en amarrar-rango:", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
