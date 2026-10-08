"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert, getCurrentUsuarioForInsert } from "@/lib/user-context"
import { motivoSinAccion } from "@/lib/puerta-modulo"

export interface ParoComentario {
  id: string
  idempresa: number
  fecha: string
  inicio: string
  fin: string | null
  minutos: number | null
  motivo: string | null
  categoria: string | null
  reportado_por: string | null
  created_at: string
}

// Comentarios de paro guardados de un día (por empresa).
export async function getParos(selectedEmpresaId: number | null | undefined, fecha: string) {
  const admin: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId || !fecha) return { success: true, data: [] as ParoComentario[] }
  const { data, error } = await admin
    .from("paros_produccion")
    .select("*")
    .eq("idempresa", empresaId)
    .eq("fecha", fecha)
    .order("inicio", { ascending: true })
  if (error) return { success: false, data: [] as ParoComentario[], message: error.message }
  return { success: true, data: (data || []) as ParoComentario[] }
}

// Guarda/actualiza el motivo de una franja de paro (upsert por empresa+fecha+inicio).
export async function guardarParo(payload: {
  empresaId?: number | null
  fecha: string
  inicio: string
  fin?: string | null
  minutos?: number | null
  motivo: string
  categoria?: string | null
}) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Reporte de Paros", "Dashboard de Producción"], "crear", "Registrar paro")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const admin: any = await getSupabaseAdmin()
  const empresaId = payload.empresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return { success: false, message: "Sin empresa seleccionada." }
  if (!payload.fecha || !payload.inicio) return { success: false, message: "Falta la franja de paro." }
  const motivo = (payload.motivo || "").trim()
  if (!motivo) return { success: false, message: "Escribe el motivo del paro." }

  const usuario = await getCurrentUsuarioForInsert()
  const row = {
    idempresa: empresaId,
    fecha: payload.fecha,
    inicio: payload.inicio,
    fin: payload.fin ?? null,
    minutos: payload.minutos ?? null,
    motivo,
    categoria: payload.categoria ?? null,
    reportado_por: usuario,
    updated_at: new Date().toISOString(),
  }
  const { data: exist } = await admin
    .from("paros_produccion")
    .select("id")
    .eq("idempresa", empresaId)
    .eq("fecha", payload.fecha)
    .eq("inicio", payload.inicio)
    .limit(1)
  const id = exist?.[0]?.id
  if (id) {
    const { error } = await admin.from("paros_produccion").update(row).eq("id", id)
    if (error) return { success: false, message: error.message }
  } else {
    const { error } = await admin.from("paros_produccion").insert(row)
    if (error) return { success: false, message: error.message }
  }
  return { success: true }
}

export interface HistorialParos {
  rows: ParoComentario[]
  porCategoria: { categoria: string; count: number; minutos: number }[]
  porDia: { fecha: string; count: number; minutos: number }[]
  total: number
  totalMinutos: number
}

// Historial de paros justificados en un rango de fechas, con agregados por
// categoría (cuál se repite más) y por día.
export async function getHistorialParos(
  empresaId: number | null | undefined,
  desde?: string | null,
  hasta?: string | null,
): Promise<{ success: boolean; data?: HistorialParos; message?: string }> {
  const admin: any = await getSupabaseAdmin()
  const emp = empresaId || (await getCurrentEmpresaIdForInsert())
  if (!emp) return { success: true, data: { rows: [], porCategoria: [], porDia: [], total: 0, totalMinutos: 0 } }
  try {
    let q = admin.from("paros_produccion").select("*").eq("idempresa", emp)
    if (desde) q = q.gte("fecha", desde)
    if (hasta) q = q.lte("fecha", hasta)
    const { data, error } = await q.order("fecha", { ascending: false }).order("inicio", { ascending: true })
    if (error) return { success: false, message: error.message }
    const rows = (data || []) as ParoComentario[]
    const catMap = new Map<string, { categoria: string; count: number; minutos: number }>()
    const diaMap = new Map<string, { fecha: string; count: number; minutos: number }>()
    let totalMinutos = 0
    for (const r of rows) {
      const min = Number(r.minutos) || 0
      totalMinutos += min
      const cat = r.categoria || ""
      const c = catMap.get(cat) || { categoria: cat, count: 0, minutos: 0 }
      c.count++
      c.minutos += min
      catMap.set(cat, c)
      const d = diaMap.get(r.fecha) || { fecha: r.fecha, count: 0, minutos: 0 }
      d.count++
      d.minutos += min
      diaMap.set(r.fecha, d)
    }
    const porCategoria = [...catMap.values()].sort((a, b) => b.count - a.count || b.minutos - a.minutos)
    const porDia = [...diaMap.values()].sort((a, b) => b.fecha.localeCompare(a.fecha))
    return { success: true, data: { rows, porCategoria, porDia, total: rows.length, totalMinutos } }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al cargar el historial." }
  }
}

// Elimina el comentario de una franja (vuelve a "sin comentar").
export async function eliminarParo(payload: { empresaId?: number | null; fecha: string; inicio: string }) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Reporte de Paros", "Dashboard de Producción"], "eliminar", "Eliminar paro")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const admin: any = await getSupabaseAdmin()
  const empresaId = payload.empresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return { success: false, message: "Sin empresa seleccionada." }
  const { error } = await admin
    .from("paros_produccion")
    .delete()
    .eq("idempresa", empresaId)
    .eq("fecha", payload.fecha)
    .eq("inicio", payload.inicio)
  if (error) return { success: false, message: error.message }
  return { success: true }
}
