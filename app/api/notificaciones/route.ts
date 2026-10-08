import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * GET /api/notificaciones?empresaId=1&limit=100
 * Historial de envios (evidencia). Ordenado del mas reciente al mas
 * antiguo. Filtra por empresa si se pasa empresaId.
 */
export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    const limit = Math.min(Number(searchParams.get("limit") || 200), 500)

    const supabase = await getSupabaseAdmin()

    let query = supabase
      .from("notificaciones_enviadas")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (empresaId) query = query.eq("idempresa", Number(empresaId))

    const { data, error } = await query
    if (error) {
      console.error("[notificaciones] error historial:", error)
      return NextResponse.json({ error: "Error al cargar el historial" }, { status: 500 })
    }

    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    console.error("[notificaciones] error GET historial:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
