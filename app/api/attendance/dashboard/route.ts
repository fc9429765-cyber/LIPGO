import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: Request) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    const mode = searchParams.get("mode") || "daily" // daily | monthly
    const month = searchParams.get("month") // YYYY-MM format for monthly mode
    const dateParam = searchParams.get("date") // YYYY-MM-DD for daily mode (optional)

    if (!empresaId) {
      return NextResponse.json({ error: "empresaId is required" }, { status: 400 })
    }

    const supabaseAdmin = await getSupabaseAdmin()

    if (mode === "daily") {
      // Use provided date or default to today in Colombia timezone
      const colombiaDate = dateParam || new Date()
        .toLocaleString("en-CA", {
          timeZone: "America/Bogota",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
        .split(",")[0]

      // Calculate previous day
      const currentDateObj = new Date(colombiaDate + "T12:00:00")
      currentDateObj.setDate(currentDateObj.getDate() - 1)
      const prevDate = currentDateObj.toISOString().split("T")[0]

      const COLS =
        "id, fecha, nombre, identificacion, puesto, asistencia, hed, hedf, hen, hef, hn, especialidad, horaingreso, horaentradaprogramada"

      // Fetch current and previous day in parallel
      const [currentRes, prevRes, last7Res, adminRes, headcountRes] = await Promise.all([
        supabaseAdmin.from("registroasistencia").select(COLS).eq("idempresa", empresaId).eq("fecha", colombiaDate),
        supabaseAdmin.from("registroasistencia").select(COLS).eq("idempresa", empresaId).eq("fecha", prevDate),
        // Last 7 days for sparkline mini-trend
        (() => {
          const d7 = new Date(colombiaDate + "T12:00:00")
          d7.setDate(d7.getDate() - 6)
          const from7 = d7.toISOString().split("T")[0]
          return supabaseAdmin
            .from("registroasistencia")
            .select("fecha, puesto, asistencia, identificacion, nombre")
            .eq("idempresa", empresaId)
            .gte("fecha", from7)
            .lte("fecha", colombiaDate)
            .order("fecha", { ascending: true })
        })(),
        // Personal administrativo (headcount.admin=true) de este proyecto o
        // sin proyecto asignado (mismo criterio que getPersonasAsistenciaAdministrativa):
        // el Dashboard Diario es una vista OPERATIVA -- el administrativo ya
        // tiene su propio módulo (Asistencia Administrativa) y no debe contarse
        // aquí en ningún KPI/lista/panel, ni siquiera vía su novedad "Descanso".
        supabaseAdmin
          .from("headcount")
          .select("identificacion")
          .eq("admin", true)
          .or(`idempresa.eq.${empresaId},idempresa.is.null`),
        // Head Count real operativo de ESTE proyecto (activo, sin admin, sin
        // cuentas de prueba) -- para comparar el ausentismo del día contra el
        // total real de personal, no solo contra quien tiene fila hoy.
        supabaseAdmin.from("headcount").select("identificacion, nombre, admin").eq("idempresa", empresaId).eq("estado", "Activo"),
      ])

      if (currentRes.error) {
        console.error("[v0] Dashboard daily error:", currentRes.error)
        return NextResponse.json({ error: currentRes.error.message }, { status: 500 })
      }

      const adminIds = new Set((adminRes.data || []).map((r: any) => String(r.identificacion).trim()))
      // Cuentas de prueba ("AUXILIAR PRUEBA AVIMOL 1", etc.) quedan activas en
      // headcount para pruebas manuales -- mismo criterio que ya usa
      // getPersonasAsistenciaAdministrativa/getParafiscales, filtrado por
      // nombre (no hace falta join: registroasistencia.nombre ya lo trae).
      const soloOperativos = (rows: any[] | null) =>
        (rows || []).filter((r) => !adminIds.has(String(r.identificacion).trim()) && !/prueba/i.test(String(r.nombre || "")))

      const headcountTotal = (headcountRes.data || []).filter(
        (h: any) => !h.admin && !/prueba/i.test(String(h.nombre || "")),
      ).length

      return NextResponse.json({
        data: soloOperativos(currentRes.data),
        prevData: soloOperativos(prevRes.data),
        last7Data: soloOperativos(last7Res.data),
        date: colombiaDate,
        prevDate,
        headcountTotal,
      })
    }

    if (mode === "monthly") {
      // If no month provided, use current month
      const now = new Date()
      const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
      const [year, mon] = targetMonth.split("-").map(Number)
      const startDate = `${year}-${String(mon).padStart(2, "0")}-01`
      const lastDay = new Date(year, mon, 0).getDate()
      const endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`

      const [monthRes, adminRes] = await Promise.all([
        supabaseAdmin
          .from("registroasistencia")
          .select("id, fecha, nombre, identificacion, puesto, asistencia, hed, hedf, hen, hef, hn, especialidad")
          .eq("idempresa", empresaId)
          .gte("fecha", startDate)
          .lte("fecha", endDate)
          .order("fecha", { ascending: true }),
        // Mismo criterio que en "daily": el administrativo no cuenta aquí.
        supabaseAdmin
          .from("headcount")
          .select("identificacion")
          .eq("admin", true)
          .or(`idempresa.eq.${empresaId},idempresa.is.null`),
      ])

      if (monthRes.error) {
        console.error("[v0] Dashboard monthly error:", monthRes.error)
        return NextResponse.json({ error: monthRes.error.message }, { status: 500 })
      }

      const adminIds = new Set((adminRes.data || []).map((r: any) => String(r.identificacion).trim()))
      const data = (monthRes.data || []).filter(
        (r: any) => !adminIds.has(String(r.identificacion).trim()) && !/prueba/i.test(String(r.nombre || "")),
      )

      return NextResponse.json({ data, startDate, endDate, month: targetMonth })
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
  } catch (error) {
    console.error("[v0] Dashboard API error:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
