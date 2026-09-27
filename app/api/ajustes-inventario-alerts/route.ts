import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"

/**
 * Ajustes manuales de inventario por código — alertas para Gerencia.
 *
 * Origen (incidente 2026-09-23, Cedi Funza): un Descargue duplicado pagó
 * nómina de más y se "cuadró" con una salida manual por código (702) que nadie
 * revisó. Desde entonces 601/702 quedan en cola hasta que Gerencia los apruebe
 * con clave (inv_ajustes_pendientes), pero nadie se enteraba de que había algo
 * en cola, y los ajustes que sí se ejecutan (701 y los aprobados) solo quedan
 * en la bitácora (inv_correcciones_log) si alguien va a buscarlos.
 *
 * Dos tipos de alerta, siempre para la empresa seleccionada:
 *   · "pendiente": ajustes 601/702 esperando aprobación de Gerencia.
 *   · "ejecutado": ajustes manuales por código ejecutados en los últimos
 *     DIAS_VENTANA días (701 libre, o 601/702 ya aprobados) — para que Gerencia
 *     los vea sin tener que ir a la bitácora.
 */
const DIAS_VENTANA = 7

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    if (!empresaId) return NextResponse.json({ alerts: [], count: 0 })
    const empresaIdNum = parseInt(empresaId, 10)

    const sb: any = await getSupabaseAdminAsSystem()
    const desde = new Date(Date.now() - DIAS_VENTANA * 86_400_000).toISOString()

    const [pendRes, logRes] = await Promise.all([
      sb
        .from("inv_ajustes_pendientes")
        .select("id, codigo, producto, lote, cantidad, motivo, solicitado_por, created_at")
        .eq("idempresa", empresaIdNum)
        .eq("estado", "pendiente")
        .order("created_at", { ascending: false })
        .limit(20),
      sb
        .from("inv_correcciones_log")
        .select("id, codigo, producto, lote_origen, cantidad, motivo, realizado_por, autorizado_por, created_at")
        .eq("idempresa", empresaIdNum)
        .in("codigo", ["701", "702", "601", "555"])
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(20),
    ])
    if (pendRes.error) console.error("[v0] ajustes-inventario-alerts: pendientes:", pendRes.error)
    if (logRes.error) console.error("[v0] ajustes-inventario-alerts: log:", logRes.error)

    const diasDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
    const hace = (iso: string) => {
      const d = diasDesde(iso)
      return d === 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`
    }
    const num = (v: any) => Number(v) || 0

    const alerts: any[] = []
    for (const p of pendRes.data ?? []) {
      alerts.push({
        tipo: "pendiente",
        id: p.id,
        codigo: p.codigo,
        mensaje: `Ajuste ${p.codigo} pendiente de aprobación: ${p.producto ?? "—"}${p.lote ? ` · lote ${p.lote}` : ""} · ${num(p.cantidad).toLocaleString("es-CO")} und · ${p.solicitado_por || "—"} ${hace(p.created_at)}`,
        motivo: p.motivo ?? null,
        fecha: p.created_at,
      })
    }
    for (const l of logRes.data ?? []) {
      alerts.push({
        tipo: "ejecutado",
        id: l.id,
        codigo: l.codigo,
        mensaje: `Ajuste ${l.codigo} ejecutado ${hace(l.created_at)}: ${l.producto ?? "—"}${l.lote_origen ? ` · lote ${l.lote_origen}` : ""} · ${num(l.cantidad).toLocaleString("es-CO")} und · ${l.realizado_por || "—"}${l.autorizado_por ? ` (aprobó ${l.autorizado_por})` : ""}`,
        motivo: l.motivo ?? null,
        fecha: l.created_at,
      })
    }

    return NextResponse.json({ alerts: alerts.slice(0, 12), count: alerts.length })
  } catch (error) {
    console.error("[v0] Error in ajustes-inventario-alerts:", error)
    return NextResponse.json({ alerts: [], count: 0 }, { status: 500 })
  }
}
