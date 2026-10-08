"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import { invalidarCacheMuelles } from "@/lib/muelles-empresa"
import type { MuelleEmpresa } from "@/lib/muelles-empresa-types"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const MODULO = "Muelles de Cargue"

export async function getMuellesEmpresaList(): Promise<MuelleEmpresa[]> {
  try {
    if (!(await checkModulePermission(MODULO))) return []
    const sb = await getSupabaseAdmin()
    const { data } = await sb
      .from("muelles_empresa")
      .select("*")
      .order("idempresa", { ascending: true })
      .order("muelle", { ascending: true })
    return (data ?? []) as MuelleEmpresa[]
  } catch (err) {
    console.error("[muelles] getMuellesEmpresaList:", err)
    return []
  }
}

// Alta (o reactivación si ya existía inactivo) de un muelle para una empresa.
export async function agregarMuelleEmpresa(input: {
  idempresa: number
  muelle: number
  observacion?: string
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Muelles de Cargue"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!(await checkModulePermission(MODULO))) return { success: false, message: "No autorizado" }
    const idempresa = Number(input.idempresa)
    const muelle = Number(input.muelle)
    if (!idempresa || !Number.isFinite(muelle) || muelle < 1) {
      return { success: false, message: "Empresa y número de muelle son obligatorios" }
    }
    const sb = await getSupabaseAdmin()
    const { data: ya } = await sb
      .from("muelles_empresa")
      .select("id")
      .eq("idempresa", idempresa)
      .eq("muelle", muelle)
      .maybeSingle()
    if (ya?.id) {
      const { error } = await sb
        .from("muelles_empresa")
        .update({ activo: true, observacion: input.observacion || null })
        .eq("id", ya.id)
      if (error) return { success: false, message: error.message }
    } else {
      const { error } = await sb
        .from("muelles_empresa")
        .insert({ idempresa, muelle, activo: true, observacion: input.observacion || null })
      if (error) return { success: false, message: error.message }
    }
    invalidarCacheMuelles()
    return { success: true }
  } catch (err: any) {
    return { success: false, message: err?.message || "Error" }
  }
}

// Verifica que el muelle no tenga una orden abierta antes de desactivar/eliminar.
async function tieneOrdenActiva(idempresa: number, muelle: number): Promise<boolean> {
  const sb = await getSupabaseAdmin()
  const { data } = await sb
    .from("cabeceraoc")
    .select("id")
    .eq("idempresa", idempresa)
    .eq("muelle", muelle)
    .is("fincargue", null)
    .limit(1)
    .maybeSingle()
  return !!data
}

// Desactivar / reactivar (soft) sin perder historial.
export async function setMuelleEmpresaActivo(
  id: number,
  activo: boolean,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Muelles de Cargue"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!(await checkModulePermission(MODULO))) return { success: false, message: "No autorizado" }
    const sb = await getSupabaseAdmin()
    if (!activo) {
      const { data: fila } = await sb.from("muelles_empresa").select("idempresa, muelle").eq("id", id).single()
      if (fila && (await tieneOrdenActiva(fila.idempresa, fila.muelle))) {
        return { success: false, message: `El muelle ${fila.muelle} tiene una orden activa ahora mismo — no se puede desactivar` }
      }
    }
    const { error } = await sb.from("muelles_empresa").update({ activo }).eq("id", id)
    if (error) return { success: false, message: error.message }
    invalidarCacheMuelles()
    return { success: true }
  } catch (err: any) {
    return { success: false, message: err?.message || "Error" }
  }
}

export async function eliminarMuelleEmpresa(id: number): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Muelles de Cargue"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!(await checkModulePermission(MODULO))) return { success: false, message: "No autorizado" }
    const sb = await getSupabaseAdmin()
    const { data: fila } = await sb.from("muelles_empresa").select("idempresa, muelle").eq("id", id).single()
    if (fila && (await tieneOrdenActiva(fila.idempresa, fila.muelle))) {
      return { success: false, message: `El muelle ${fila.muelle} tiene una orden activa ahora mismo — no se puede eliminar` }
    }
    const { error } = await sb.from("muelles_empresa").delete().eq("id", id)
    if (error) return { success: false, message: error.message }
    invalidarCacheMuelles()
    return { success: true }
  } catch (err: any) {
    return { success: false, message: err?.message || "Error" }
  }
}
