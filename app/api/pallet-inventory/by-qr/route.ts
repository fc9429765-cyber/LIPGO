import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-client"
import { exigirSesionApi } from "@/lib/puerta-api"

// Lectura de QR Estibas: busca en la vista `view_inventario_por_estiba`
// por el campo `idqr`. Se expone como Route Handler (en lugar de Server
// Action) para que el cliente lo consuma vía fetch y no dependa del ID
// de una Server Action, evitando errores de "Server Action not found"
// ante desincronizaciones de despliegue.
export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  const qrId = request.nextUrl.searchParams.get("idqr")?.trim()

  if (!qrId) {
    return NextResponse.json(
      { success: false, error: "Debe proporcionar un código QR", data: [] },
      { status: 400 },
    )
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("view_inventario_por_estiba")
      .select("idqr, codproducto, nombreproducto, lote, location, stock_total")
      .eq("idqr", qrId)
      .order("lote", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching pallet inventory by QR:", error)
      return NextResponse.json(
        { success: false, error: "Error al buscar la información de la estiba", data: [] },
        { status: 500 },
      )
    }

    if (!data || data.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No se encontró información para este código QR",
        data: [],
      })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error in by-qr route:", error)
    return NextResponse.json(
      { success: false, error: "Error al buscar la información de la estiba", data: [] },
      { status: 500 },
    )
  }
}
