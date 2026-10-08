import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { exigirSesionApi } from "@/lib/puerta-api"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Helper to parse time string "HH:MM:SS" or "HH:MM" to total minutes
function parseTimeToMinutes(timeStr: string | null): number {
  if (!timeStr) return 0
  const parts = timeStr.split(":")
  if (parts.length >= 2) {
    const hours = parseInt(parts[0], 10) || 0
    const minutes = parseInt(parts[1], 10) || 0
    return hours * 60 + minutes
  }
  return 0
}

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")

    if (!empresaId) {
      return NextResponse.json({ alerts: [] })
    }

    // Get operations that are "En proceso"
    const { data, error } = await supabase
      .from("dashboardoperaciones")
      .select("ordendecargue, cliente, placa, tipooperacion, iniciocargue, tiempo_en_proceso")
      .eq("idempresa", parseInt(empresaId, 10))
      .eq("estado", "En proceso")

    if (error) {
      console.error("[v0] Error fetching rendimiento data:", error)
      return NextResponse.json({ alerts: [] })
    }

    // Filter operations with more than 2 hours (120 minutes) in tiempo_en_proceso
    const alerts = (data || [])
      .map((op) => ({
        ordendecargue: op.ordendecargue || "",
        cliente: op.cliente || "Sin cliente",
        placa: op.placa || "",
        tipooperacion: op.tipooperacion || "",
        iniciocargue: op.iniciocargue || "",
        tiempo_en_proceso: op.tiempo_en_proceso || "",
        tiempo_minutos: parseTimeToMinutes(op.tiempo_en_proceso),
      }))
      .filter((op) => op.tiempo_minutos > 120) // More than 2 hours
      .sort((a, b) => b.tiempo_minutos - a.tiempo_minutos) // Sort by longest first

    return NextResponse.json({ alerts })
  } catch (error) {
    console.error("[v0] Error in rendimiento-alerts API:", error)
    return NextResponse.json({ alerts: [] })
  }
}
