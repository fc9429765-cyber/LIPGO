export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { fetchClientes } from "@/lib/config-actions"
import { NextRequest, NextResponse } from "next/server"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaIdParam = searchParams.get("empresaId")
    const result = await fetchClientes(empresaIdParam ? Number(empresaIdParam) : undefined)
    return NextResponse.json(result)
  } catch (error) {
    console.error("[API] Error fetching clientes:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
