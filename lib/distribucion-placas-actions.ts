"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import { invalidarCachePlacas } from "@/lib/distribucion-placas"
import type { DistribucionPlaca } from "@/lib/distribucion-placas-types"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const MODULO = "Placas de Distribución"
const norm = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase()

export async function getDistribucionPlacas(): Promise<DistribucionPlaca[]> {
  try {
    if (!(await checkModulePermission(MODULO))) return []
    const sb = await getSupabaseAdmin()
    const { data } = await sb
      .from("distribucion_placas")
      .select("*")
      .order("idempresa", { ascending: true })
      .order("placa", { ascending: true })
    return (data ?? []) as DistribucionPlaca[]
  } catch (err) {
    console.error("[placas] getDistribucionPlacas:", err)
    return []
  }
}

// Alta (o reactivación si ya existía inactiva) de una placa para una empresa.
export async function agregarPlacaDistribucion(input: {
  idempresa: number
  placa: string
  observacion?: string
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Placas de Distribución"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!(await checkModulePermission(MODULO))) return { success: false, message: "No autorizado" }
    const idempresa = Number(input.idempresa)
    const placa = norm(input.placa)
    if (!idempresa || !placa) return { success: false, message: "Empresa y placa son obligatorias" }
    const sb = await getSupabaseAdmin()
    // ¿Existe (activa o inactiva)? La reactivamos; si no, insertamos.
    const { data: ya } = await sb
      .from("distribucion_placas")
      .select("id")
      .eq("idempresa", idempresa)
      .ilike("placa", placa)
      .maybeSingle()
    if (ya?.id) {
      const { error } = await sb
        .from("distribucion_placas")
        .update({ activo: true, placa, observacion: input.observacion || null })
        .eq("id", ya.id)
      if (error) return { success: false, message: error.message }
    } else {
      const { error } = await sb
        .from("distribucion_placas")
        .insert({ idempresa, placa, activo: true, observacion: input.observacion || null })
      if (error) return { success: false, message: error.message }
    }
    invalidarCachePlacas()
    return { success: true }
  } catch (err: any) {
    return { success: false, message: err?.message || "Error" }
  }
}

// Asignar / desasignar (soft) sin perder historial.
export async function setPlacaDistribucionActivo(
  id: number,
  activo: boolean,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Placas de Distribución"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!(await checkModulePermission(MODULO))) return { success: false, message: "No autorizado" }
    const sb = await getSupabaseAdmin()
    const { error } = await sb.from("distribucion_placas").update({ activo }).eq("id", id)
    if (error) return { success: false, message: error.message }
    invalidarCachePlacas()
    return { success: true }
  } catch (err: any) {
    return { success: false, message: err?.message || "Error" }
  }
}

export async function eliminarPlacaDistribucion(id: number): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Placas de Distribución"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!(await checkModulePermission(MODULO))) return { success: false, message: "No autorizado" }
    const sb = await getSupabaseAdmin()
    const { error } = await sb.from("distribucion_placas").delete().eq("id", id)
    if (error) return { success: false, message: error.message }
    invalidarCachePlacas()
    return { success: true }
  } catch (err: any) {
    return { success: false, message: err?.message || "Error" }
  }
}
