import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    const dateFrom = searchParams.get("dateFrom")

    if (!empresaId) {
      return NextResponse.json({ error: "empresaId is required" }, { status: 400 })
    }

    const supabase = await getSupabaseAdmin()

    let query = supabase
      .from("inspecciones_montacargas")
      .select("*")
      .eq("idempresa", parseInt(empresaId, 10))
      .order("fecha", { ascending: false })

    if (dateFrom) {
      query = query.gte("fecha", dateFrom)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching preoperacional alerts:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Unexpected error in preoperacional-alerts:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
