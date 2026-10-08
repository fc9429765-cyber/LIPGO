import { NextResponse } from "next/server"
import { getCurrentEmpresaData } from "@/lib/user-context"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET() {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const empresaData = await getCurrentEmpresaData()
    return NextResponse.json(empresaData)
  } catch (error) {
    console.error("[v0] Error fetching empresa data:", error)
    return NextResponse.json(
      { nit: "890.204.199", direccion: "Dirección vía 40 # 67B-63", nombre: "LA INSUPERABLE" },
      { status: 500 },
    )
  }
}
