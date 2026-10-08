"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import type { EquipoRow, MantenimientoRow } from "@/lib/sst-evidencia-types"
import { exigirAccion } from "@/lib/puerta-modulo"

async function resolveEmpresaId(fromClient?: number | null): Promise<number | null> {
  if (fromClient && !Number.isNaN(fromClient)) return fromClient
  return await getCurrentEmpresaIdForInsert()
}

export async function listEquipos(empresaIdFromClient?: number | null): Promise<EquipoRow[]> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []
  const { data, error } = await supabase
    .from("sst_equipos")
    .select("*")
    // SST transversal (LIP): no se filtra por el ID del cliente.
    .order("identificacion")
  if (error) {
    console.error("[v0] listEquipos:", error.message)
    return []
  }
  return (data ?? []) as EquipoRow[]
}

export async function saveEquipo(
  row: Partial<EquipoRow>,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Equipos y Mantenimiento"], "editar")
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  const { error } = await supabase.from("sst_equipos").insert([{ ...row, idempresa: empresaId }])
  return error ? { success: false, message: error.message } : { success: true }
}

export async function listMantenimientos(empresaIdFromClient?: number | null): Promise<MantenimientoRow[]> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []
  const { data, error } = await supabase
    .from("sst_mantenimientos")
    .select("*, sst_equipos(identificacion,tipo,sede)")
    // SST transversal (LIP): no se filtra por el ID del cliente.
    .order("fecha_programada", { ascending: false })
  if (error) {
    console.error("[v0] listMantenimientos:", error.message)
    return []
  }
  return (data ?? []) as MantenimientoRow[]
}

export async function saveMantenimiento(
  row: Partial<MantenimientoRow>,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Equipos y Mantenimiento"], "editar")
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  const { error } = await supabase.from("sst_mantenimientos").insert([{ ...row, idempresa: empresaId }])
  return error ? { success: false, message: error.message } : { success: true }
}
