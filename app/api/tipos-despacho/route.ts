export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { fetchTiposDespacho } from "@/lib/config-actions"
import { NextResponse } from "next/server"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET() {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const result = await fetchTiposDespacho()
    return NextResponse.json(result)
  } catch (error) {
    console.error("[API] Error fetching tipos despacho:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
