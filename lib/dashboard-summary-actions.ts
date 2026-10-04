"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaId } from "@/lib/company-filter"
import { FILTRO_ABIERTOS_POSTGREST } from "@/lib/pedidos-estado"

// Helper function to get Colombia date string (YYYY-MM-DD)
function getColombiaDateString(): string {
  const now = new Date()
  const colombiaTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
  const year = colombiaTime.getFullYear()
  const month = String(colombiaTime.getMonth() + 1).padStart(2, "0")
  const day = String(colombiaTime.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export async function getDailySummaryStats(selectedEmpresaId?: number) {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())
    const today = getColombiaDateString()

    console.log("[v0] Fetching daily summary for empresa:", empresaId, "date:", today)

    // 1. Órdenes hoy: Count ordendecargue from cabeceraoc
    const { count: ordenesCount, error: ordenesError } = await supabase
      .from("cabeceraoc")
      .select("ordendecargue", { count: "exact", head: true })
      .eq("idempresa", empresaId)
      .eq("fechacargue", today)

    if (ordenesError) {
      console.error("[v0] Error fetching ordenes count:", ordenesError)
    }

    // 2. Pedidos Hoy: Count idpedido from pedidoscabecera
    const { count: pedidosCount, error: pedidosError } = await supabase
      .from("pedidoscabecera")
      .select("idpedido", { count: "exact", head: true })
      .eq("id_empresa", empresaId)
      .eq("fecha_programada", today)
      // "Pedidos Hoy" es lo que queda por atender hoy, así que un pedido YA CERRADO no
      // cuenta, sea cual sea la forma en que se cerró. Antes solo se descartaban
      // "entregado" y "no entregado", así que un pedido anulado o cerrado como
      // "entrega parcial" seguía sumando. Gerencia (2026-10-04): un pedido depurado "no
      // debe seguir afectando los indicadores, son pedidos que ya se gestionaron en su
      // momento". El filtro central vive en lib/pedidos-estado.ts.
      .or(FILTRO_ABIERTOS_POSTGREST)

    if (pedidosError) {
      console.error("[v0] Error fetching pedidos count:", pedidosError)
    }

    // 3. Toneladas movidas: Sum pesoorden from cabeceraoc
    // "proyeccion" excluido (2026-09-08): residuo de un módulo manual
    // descontinuado en jul-2026, nunca fue tonelaje real.
    const { data: toneladasData, error: toneladasError } = await supabase
      .from("cabeceraoc")
      .select("pesoorden")
      .eq("idempresa", empresaId)
      .eq("fechacargue", today)
      .not("fincargue", "is", null)
      .neq("tipooperacion", "proyeccion")

    if (toneladasError) {
      console.error("[v0] Error fetching toneladas:", toneladasError)
    }

    const toneladas = toneladasData?.reduce((sum, row) => sum + (row.pesoorden || 0), 0) || 0

    console.log("[v0] Daily summary results:", {
      ordenes: ordenesCount,
      pedidos: pedidosCount,
      toneladas: toneladas.toFixed(2),
    })

    return {
      success: true,
      data: {
        ordenesHoy: ordenesCount || 0,
        pedidosHoy: pedidosCount || 0,
        toneladasMovidas: Number(toneladas.toFixed(2)),
      },
    }
  } catch (error) {
    console.error("[v0] Error in getDailySummaryStats:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}
