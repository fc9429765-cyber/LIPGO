import { NextResponse } from "next/server"
import { getAlmacenes } from "@/lib/inventory-actions"
import type { NextRequest } from "next/server"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const searchParams = request.nextUrl.searchParams
    const empresaId = searchParams.get("empresaId")

    const data = await getAlmacenes(empresaId ? Number.parseInt(empresaId) : undefined)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error in almacenes API:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch almacenes" }, { status: 500 })
  }
}
