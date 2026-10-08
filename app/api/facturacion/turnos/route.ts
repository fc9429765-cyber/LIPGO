import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/client"
import { getCurrentEmpresaIdForInsert } from "@/lib/company-filter"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: Request) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const selectedEmpresaId = searchParams.get("empresaId")
    
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ? parseInt(selectedEmpresaId, 10) : await getCurrentEmpresaIdForInsert()

    console.log("[v0] Facturacion Turnos API: Filtering by empresaId:", empresaId)

    // Paginado: facturacionturnos (vista sobre registroasistencia) supera 1000 filas
    // por empresa en pocas semanas; sin paginar, Facturación/Costo/Utilidad se sumaban
    // sobre solo las 1000 más recientes. Orden estable (fecha desc, id desc) por página.
    const data = await fetchAllRows((from, to) =>
      supabase
        .from("facturacionturnos")
        .select("id, fecha, nombre, puesto, hed, tarifaturno, tarifahoraextra, valorextra, facturacion_total, costo_total, utilidad, idempresa")
        .eq("idempresa", empresaId)
        .order("fecha", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    )

    console.log("[v0] Facturacion Turnos API: Returning", data.length, "records for empresa", empresaId)
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Unexpected error in facturacion turnos API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
