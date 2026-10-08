export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { fetchConfigData } from "@/lib/config-actions"
import { NextResponse } from "next/server"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: Request) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const tableName = searchParams.get("table")
    const empresaIdParam = searchParams.get("empresaId")

    if (!tableName) {
      return NextResponse.json({ success: false, error: "Table name is required" }, { status: 400 })
    }

    // Parse empresaId if provided
    const empresaId = empresaIdParam ? parseInt(empresaIdParam, 10) : undefined

    const result = await fetchConfigData(tableName, empresaId)
    return NextResponse.json(result)
  } catch (error) {
    console.error("[API] Error fetching config data:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
