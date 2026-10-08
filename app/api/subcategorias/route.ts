export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { fetchSubcategorias } from "@/lib/config-actions"
import { NextResponse } from "next/server"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET() {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const result = await fetchSubcategorias()
    return NextResponse.json(result)
  } catch (error) {
    console.error("[API] Error fetching subcategorias:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
