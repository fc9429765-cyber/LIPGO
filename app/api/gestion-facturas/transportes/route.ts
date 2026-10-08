import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

// Lista de transportes REALES (distintos) que existen para un proyecto, para
// que el filtro de Transporte de Solicitar Facturas sea una lista
// desplegable en vez de texto libre — evita errores de tipeo al amarrar una
// factura Siigo al transporte equivocado (o a ninguno, por un typo).
export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    if (!empresaId) return NextResponse.json({ success: false, error: "empresaId es requerido" }, { status: 400 })
    // Opcional: acota la lista al rango de FECHA DE CARGUE del "Rango factura
    // Siigo" — si el rango solo tiene un transporte, no tiene sentido ofrecer
    // los demás (de otras fechas) como si aplicaran aquí.
    const desde = searchParams.get("desde") || ""
    const hasta = searchParams.get("hasta") || ""

    const supabase = await getSupabaseAdmin()
    const emp = parseInt(empresaId, 10)
    const vistos = new Set<string>()
    const pageSize = 1000
    for (let offset = 0; ; offset += pageSize) {
      let q = supabase
        .from("cabeceraoc")
        .select("transporte")
        .eq("idempresa", emp)
        .neq("tipooperacion", "proyeccion")
        .not("transporte", "is", null)
      if (desde) q = q.gte("fechacargue", desde)
      if (hasta) q = q.lte("fechacargue", hasta)
      const { data, error } = await q.order("id").range(offset, offset + pageSize - 1)
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      if (!data || data.length === 0) break
      for (const r of data) {
        const t = String(r.transporte ?? "").trim()
        if (t) vistos.add(t)
      }
      if (data.length < pageSize) break
    }

    const transportes = [...vistos].sort((a, b) => a.localeCompare(b, "es"))
    return NextResponse.json({ success: true, transportes })
  } catch (error) {
    console.error("Error en /api/gestion-facturas/transportes:", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
