import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")

    if (!empresaId) {
      return NextResponse.json({ alerts: [], count: 0 })
    }

    const supabase = await createClient()

    // Get count of products with reserved stock
    const { count, error: countError } = await supabase
      .from("invglobal")
      .select("idproducto", { count: "exact", head: true })
      .eq("idempresa", parseInt(empresaId, 10))
      .gt("stock_res", 0)

    if (countError) {
      console.error("Error counting inventario alerts:", countError)
      return NextResponse.json({ alerts: [], count: 0 })
    }

    // Get products with reserved stock (limit to first 10 for display)
    const { data, error } = await supabase
      .from("invglobal")
      .select("idproducto, codproducto, nombreproducto, categoria, subcategoria, stock_disp, stock_res, stock_global")
      .eq("idempresa", parseInt(empresaId, 10))
      .gt("stock_res", 0)
      .order("stock_res", { ascending: false })
      .limit(10)

    if (error) {
      console.error("Error fetching inventario alerts:", error)
      return NextResponse.json({ alerts: [], count: 0 })
    }

    return NextResponse.json({
      alerts: data || [],
      count: count || 0
    })
  } catch (error) {
    console.error("Error in inventario-alerts API:", error)
    return NextResponse.json({ alerts: [], count: 0 }, { status: 500 })
  }
}
