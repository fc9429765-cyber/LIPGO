import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { GESTION_LIPGO_DESDE } from "@/lib/facturacion-constantes"
import { excluirNoFacturable } from "@/lib/facturas-exclusiones"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")

    if (!empresaId) {
      return NextResponse.json({ alerts: [], count: 0 })
    }

    const supabase = await createClient()

    // Get count of pending orders (estadofactura is null means "Pendiente por procesar").
    // Piso GESTION_LIPGO_DESDE: lo anterior ya se facturó manual fuera de LIPgo
    // (confirmado por gerencia) — no es una alarma abierta real.
    let countQuery = supabase
      .from("cabeceraoc")
      .select("id", { count: "exact", head: true })
      .eq("idempresa", parseInt(empresaId, 10))
      .is("estadofactura", null)
      .neq("tipooperacion", "proyeccion")
      .gte("fechaorden", GESTION_LIPGO_DESDE)
    countQuery = excluirNoFacturable(countQuery)
    const { count, error: countError } = await countQuery

    if (countError) {
      console.error("[v0] Error counting pending facturas:", countError)
      return NextResponse.json({ alerts: [], count: 0 })
    }

    // Get first 5 pending orders for display (estadofactura is null)
    let alertsQuery = supabase
      .from("cabeceraoc")
      .select("id, ordendecargue, placa, transporte, tipooperacion, fechaorden")
      .eq("idempresa", parseInt(empresaId, 10))
      .is("estadofactura", null)
      .neq("tipooperacion", "proyeccion")
      .gte("fechaorden", GESTION_LIPGO_DESDE)
    alertsQuery = excluirNoFacturable(alertsQuery)
    const { data, error } = await alertsQuery.order("id", { ascending: false }).limit(5)

    if (error) {
      console.error("[v0] Error fetching pending facturas:", error)
      return NextResponse.json({ alerts: [], count: 0 })
    }

    return NextResponse.json({ 
      alerts: data || [], 
      count: count || 0 
    })
  } catch (error) {
    console.error("[v0] Error in facturas-alerts:", error)
    return NextResponse.json({ alerts: [], count: 0 }, { status: 500 })
  }
}
