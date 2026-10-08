import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import {
  getMetaDiaForEmpresa,
  rewriteMetaDiaRows,
  buildSyntheticMetaRow,
} from "@/lib/empresa-meta-dia"
import { esProductoPorUnidad } from "@/lib/facturacion-billed-party"
import { exigirSesionApi } from "@/lib/puerta-api"

// Huevos / Empaque MP (Avimol) se facturan y pagan POR UNIDAD: lo que las
// vistas traen como "toneladas" para ese "Tipo de Producto" son unidades (una
// orden del 30-sep-2026 traía 102.000). Se sacan de TODO el tonelaje del
// dashboard y se devuelven aparte en `porUnidad` para una tarjeta pequeña.
const esFilaPorUnidad = (r: any) => esProductoPorUnidad(r?.["Tipo de Producto"] ?? r?.tipo_producto)
const sinUnidad = (rows: any[] | null | undefined) => (rows ?? []).filter((r) => !esFilaPorUnidad(r))
function resumenPorUnidad(metaRows: any[] | null | undefined) {
  let viajes = 0
  let unidades = 0
  const productos = new Set<string>()
  for (const r of metaRows ?? []) {
    if (!esFilaPorUnidad(r)) continue
    viajes += Number(r["Total Viajes/Tickets"] ?? r.total_viajes ?? 0) || 0
    unidades += Number(r["Total Toneladas Procesadas"] ?? r.total_toneladas ?? 0) || 0
    const p = String(r["Tipo de Producto"] ?? r.tipo_producto ?? "").trim()
    if (p) productos.add(p)
  }
  return { viajes, unidades: Math.round(unidades), productos: Array.from(productos) }
}

export async function GET(request: Request) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    const mode = searchParams.get("mode") || "daily"
    const dateParam = searchParams.get("date")
    const month = searchParams.get("month")

    if (!empresaId) {
      return NextResponse.json({ error: "empresaId is required" }, { status: 400 })
    }

    const supabaseAdmin = await getSupabaseAdmin()

    // Tolva ("Tolva"/"Tolva f", domingo) es PRODUCCIÓN -- reclasificada desde
    // Liquidación Tolva, no una operación de Cargue/Descargue/Distribución a
    // cliente -- y tiene su propio indicador OEE (Control de Piso). Solo
    // ID1/Indupan genera este tipo de orden; se excluye de TODO este
    // dashboard (día y mensual) para que "toneladas diarias/acumulado vs
    // meta" no mezcle producción con operación real (antes ID1 mostraba
    // hasta el doble del tonelaje real por esto).
    const sinProduccion = (q: any) => q.neq("Tipo de Operacion", "Tolva").neq("Tipo de Operacion", "Tolva f")

    if (mode === "daily") {
      const colombiaDate =
        dateParam ||
        new Date()
          .toLocaleString("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" })
          .split(",")[0]

      // Previous day
      const prevObj = new Date(colombiaDate + "T12:00:00")
      prevObj.setDate(prevObj.getDate() - 1)
      const prevDate = prevObj.toISOString().split("T")[0]

      // Last 7 days for sparkline
      const d7 = new Date(colombiaDate + "T12:00:00")
      d7.setDate(d7.getDate() - 6)
      const from7 = d7.toISOString().split("T")[0]

      const [metaRes, metaPrevRes, tonRes, tonPrevRes, meta7Res] = await Promise.all([
        sinProduccion(
          supabaseAdmin
            .from("metadia")
            .select("*")
            .eq("IdEmpresa", empresaId)
            .eq("Fecha", colombiaDate),
        ),
        sinProduccion(
          supabaseAdmin
            .from("metadia")
            .select("*")
            .eq("IdEmpresa", empresaId)
            .eq("Fecha", prevDate),
        ),
        sinProduccion(
          supabaseAdmin
            .from("operaciones_desglosadas")
            .select("*")
            .eq("ID Proyecto", empresaId)
            .eq("Fecha", colombiaDate),
        ),
        sinProduccion(
          supabaseAdmin
            .from("operaciones_desglosadas")
            .select("*")
            .eq("ID Proyecto", empresaId)
            .eq("Fecha", prevDate),
        ),
        sinProduccion(
          supabaseAdmin
            .from("metadia")
            .select("*")
            .eq("IdEmpresa", empresaId)
            .gte("Fecha", from7)
            .lte("Fecha", colombiaDate)
            .order("Fecha", { ascending: true }),
        ),
      ])

      if (metaRes.error) {
        return NextResponse.json({ error: metaRes.error.message }, { status: 500 })
      }

      // Meta diaria fija por empresa (definida en
      // `lib/empresa-meta-dia.ts`). Sobrescribimos la columna
      // `Meta Dia` que viene de la vista para que los dashboards
      // calculen el cumplimiento contra el objetivo operativo
      // acordado, no contra el valor que hubiera quedado guardado
      // en la vista. Para los rangos (last7) hacemos lo mismo
      // agrupando por fecha.
      const empresaIdNum = Number(empresaId)
      const metaDiaTon = getMetaDiaForEmpresa(empresaIdNum)

      // Si la vista no devolvio filas para hoy/ayer, igual
      // emitimos una fila sintetica con la meta para que el
      // dashboard pueda mostrar la barra "objetivo" aunque aun
      // no haya operaciones registradas.
      const metaHoy = sinUnidad(metaRes.data)
      const metaPrev = sinUnidad(metaPrevRes.data)
      const metaDiaRows =
        metaHoy.length > 0
          ? rewriteMetaDiaRows(metaHoy, metaDiaTon)
          : [buildSyntheticMetaRow(empresaIdNum, colombiaDate, metaDiaTon)]
      const metaDiaPrevRows =
        metaPrev.length > 0
          ? rewriteMetaDiaRows(metaPrev, metaDiaTon)
          : [buildSyntheticMetaRow(empresaIdNum, prevDate, metaDiaTon)]
      const last7MetaRows = rewriteMetaDiaRows(sinUnidad(meta7Res.data), metaDiaTon)

      return NextResponse.json({
        metaDia: metaDiaRows,
        metaDiaPrev: metaDiaPrevRows,
        toneladasDia: sinUnidad(tonRes.data),
        toneladasDiaPrev: sinUnidad(tonPrevRes.data),
        last7Meta: last7MetaRows,
        porUnidad: resumenPorUnidad(metaRes.data),
        porUnidadPrev: resumenPorUnidad(metaPrevRes.data),
        date: colombiaDate,
        prevDate,
      })
    }

    if (mode === "monthly") {
      const now = new Date()
      const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
      const [year, mon] = targetMonth.split("-").map(Number)
      const startDate = `${year}-${String(mon).padStart(2, "0")}-01`
      const lastDay = new Date(year, mon, 0).getDate()
      const endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`

      // Previous month
      const prevMon = mon === 1 ? 12 : mon - 1
      const prevYear = mon === 1 ? year - 1 : year
      const prevStart = `${prevYear}-${String(prevMon).padStart(2, "0")}-01`
      const prevLastDay = new Date(prevYear, prevMon, 0).getDate()
      const prevEnd = `${prevYear}-${String(prevMon).padStart(2, "0")}-${String(prevLastDay).padStart(2, "0")}`

      const [metaRes, metaPrevRes, tonRes, tonPrevRes] = await Promise.all([
        sinProduccion(
          supabaseAdmin
            .from("metadia")
            .select("*")
            .eq("IdEmpresa", empresaId)
            .gte("Fecha", startDate)
            .lte("Fecha", endDate)
            .order("Fecha", { ascending: true }),
        ),
        sinProduccion(
          supabaseAdmin
            .from("metadia")
            .select("*")
            .eq("IdEmpresa", empresaId)
            .gte("Fecha", prevStart)
            .lte("Fecha", prevEnd)
            .order("Fecha", { ascending: true }),
        ),
        sinProduccion(
          supabaseAdmin
            .from("operaciones_desglosadas")
            .select("*")
            .eq("ID Proyecto", empresaId)
            .gte("Fecha", startDate)
            .lte("Fecha", endDate)
            .order("Fecha", { ascending: true }),
        ),
        sinProduccion(
          supabaseAdmin
            .from("operaciones_desglosadas")
            .select("*")
            .eq("ID Proyecto", empresaId)
            .gte("Fecha", prevStart)
            .lte("Fecha", prevEnd)
            .order("Fecha", { ascending: true }),
        ),
      ])

      if (metaRes.error) {
        return NextResponse.json({ error: metaRes.error.message }, { status: 500 })
      }

      // Misma sobrescritura de `Meta Dia` que en el modo daily,
      // pero aplicada a cada dia del rango mensual: cada fecha
      // distinta del array recibe la constante de empresa
      // distribuida proporcionalmente entre sus filas.
      const metaDiaTonMonthly = getMetaDiaForEmpresa(Number(empresaId))
      const metaRowsMonthly = rewriteMetaDiaRows(sinUnidad(metaRes.data), metaDiaTonMonthly)
      const metaPrevRowsMonthly = rewriteMetaDiaRows(sinUnidad(metaPrevRes.data), metaDiaTonMonthly)

      return NextResponse.json({
        metaDia: metaRowsMonthly,
        metaDiaPrev: metaPrevRowsMonthly,
        toneladasDia: sinUnidad(tonRes.data),
        toneladasDiaPrev: sinUnidad(tonPrevRes.data),
        porUnidad: resumenPorUnidad(metaRes.data),
        porUnidadPrev: resumenPorUnidad(metaPrevRes.data),
        month: targetMonth,
        startDate,
        endDate,
      })
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
  } catch (error) {
    console.error("[v0] LIP Dashboard API error:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
