import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"
import { getCurrentEmpresaIdForInsert } from "@/lib/company-filter"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const selectedEmpresaId = searchParams.get("empresaId")
    
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ? parseInt(selectedEmpresaId, 10) : await getCurrentEmpresaIdForInsert()

    console.log("[v0] Facturacion API: Filtering by empresaId:", empresaId)

    // Fetch all records from facturacion table using pagination
    // Supabase has a hard limit per query, so we need to paginate
    const pageSize = 1000
    let allData: any[] = []
    let page = 0
    let hasMore = true

    while (hasMore) {
      const from = page * pageSize
      const to = from + pageSize - 1

      const { data, error } = await supabase
        .from("facturacion")
        .select("*")
        .eq("idempresa", empresaId)
        .range(from, to)
        .order("fechacargue", { ascending: false })
        // Desempate por llave única de la vista: sin él la paginación puede
        // repetir/perder filas (ver lib/orden-paginacion.ts).
        .order("numeroorden")
        .order("producto")
        .order("toneladas")
        .order("cantidad")
        .order("tiquetebascula")

      if (error) {
        console.error("[v0] Error fetching facturacion data:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      if (!data || data.length === 0) {
        hasMore = false
        break
      }

      allData = allData.concat(data)
      console.log(`[v0] Fetched facturacion page ${page}. Got ${data.length} records. Total so far: ${allData.length}`)

      // If we got fewer records than the page size, we've reached the end
      if (data.length < pageSize) {
        hasMore = false
      }

      page++
    }

    console.log(`[v0] Fetched all facturacion records. Total: ${allData.length}`)

    return NextResponse.json(allData)
  } catch (error) {
    console.error("[v0] Unexpected error in facturacion API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
