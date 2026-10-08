import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

/**
 * Conteo Cíclico de Inventario - Alertas de vencido / diferencia sin resolver.
 *
 * Política de negocio: cada proyecto debe tener al menos un conteo físico
 * (sig_inventario_cuadre, tipo total o cíclico) cada 7 días. Si no lo tiene,
 * queda "vencido". Además se alerta cualquier cuadre con diferencia que
 * todavía no llegó a estado "aprobado" (el ajuste no se generó/aprobó).
 *
 * Siempre se filtra por la empresa seleccionada (idempresa/proyecto_id).
 */
const DIAS_LIMITE = 7

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    if (!empresaId) return NextResponse.json({ alerts: [], count: 0 })
    const empresaIdNum = parseInt(empresaId, 10)

    const supabase = await getSupabaseAdmin()
    const { data: cuadres, error } = await (supabase as any)
      .from("sig_inventario_cuadre")
      .select("id, fecha, tipo, estado, total_diferencia, items_con_diferencia, created_at")
      .eq("proyecto_id", empresaIdNum)
      .eq("activo", true)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[v0] conteo-ciclico-alerts: error cuadres:", error)
      return NextResponse.json({ alerts: [], count: 0 })
    }

    const alerts: any[] = []
    const ahora = Date.now()
    const fechaDe = (c: any) => new Date(c.fecha || c.created_at).getTime()

    const ultimo = (cuadres || [])[0]
    const diasDesdeUltimo = ultimo ? Math.floor((ahora - fechaDe(ultimo)) / (1000 * 60 * 60 * 24)) : null
    if (!ultimo || diasDesdeUltimo === null || diasDesdeUltimo > DIAS_LIMITE) {
      alerts.push({
        tipo: "vencido",
        mensaje: ultimo
          ? `Conteo cíclico vencido — el último fue hace ${diasDesdeUltimo} días`
          : "Conteo cíclico vencido — nunca se ha hecho un conteo para este proyecto",
        ultima_fecha: ultimo ? ultimo.fecha || ultimo.created_at : null,
        dias_desde_ultimo: diasDesdeUltimo,
      })
    }

    const conDiferenciaSinResolver = (cuadres || []).filter(
      (c: any) => Number(c.total_diferencia) !== 0 && c.estado !== "aprobado",
    )
    for (const c of conDiferenciaSinResolver.slice(0, 5)) {
      alerts.push({
        tipo: "diferencia",
        cuadre_id: c.id,
        mensaje: `Conteo del ${c.fecha || "—"} con diferencia sin resolver (${c.items_con_diferencia ?? "?"} ítems)`,
        total_diferencia: c.total_diferencia,
        estado: c.estado,
      })
    }

    return NextResponse.json({ alerts: alerts.slice(0, 5), count: alerts.length })
  } catch (error) {
    console.error("[v0] Error in conteo-ciclico-alerts:", error)
    return NextResponse.json({ alerts: [], count: 0 }, { status: 500 })
  }
}
