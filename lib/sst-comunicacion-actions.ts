"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import type { AutorreporteRow, PqrsfRow, ComunicacionRow } from "@/lib/sst-evidencia-types"
import { exigirAccion } from "@/lib/puerta-modulo"

async function resolveEmpresaId(fromClient?: number | null): Promise<number | null> {
  if (fromClient && !Number.isNaN(fromClient)) return fromClient
  return await getCurrentEmpresaIdForInsert()
}

async function listAll<T>(table: string, order: string, empresaIdFromClient?: number | null): Promise<T[]> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []
  // SST transversal (LIP): no se filtra por el ID del cliente; se lee toda la data.
  const { data, error } = await supabase.from(table).select("*").order(order, { ascending: false })
  if (error) {
    console.error("[v0] list " + table + ":", error.message)
    return []
  }
  return (data ?? []) as T[]
}
async function save(
  table: string,
  row: Record<string, unknown>,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  const { error } = await supabase.from(table).insert([{ ...row, idempresa: empresaId }])
  return error ? { success: false, message: error.message } : { success: true }
}
async function update(
  table: string,
  id: number,
  patch: Record<string, unknown>,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from(table).update(patch).eq("id", id)
  return error ? { success: false, message: error.message } : { success: true }
}

export async function listAutorreportes(e?: number | null) {
  return listAll<AutorreporteRow>("sst_autorreportes", "fecha", e)
}
export async function saveAutorreporte(r: Partial<AutorreporteRow>, e?: number | null) {
  return save("sst_autorreportes", r as any, e)
}
export async function updateAutorreporte(id: number, p: Partial<AutorreporteRow>) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Comunicación SST"], "editar")
  return update("sst_autorreportes", id, p as any)
}

export async function listPqrsf(e?: number | null) {
  return listAll<PqrsfRow>("sst_pqrsf", "fecha", e)
}
export async function savePqrsf(r: Partial<PqrsfRow>, e?: number | null) {
  return save("sst_pqrsf", r as any, e)
}
export async function updatePqrsf(id: number, p: Partial<PqrsfRow>) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Comunicación SST"], "editar")
  return update("sst_pqrsf", id, p as any)
}

export async function listComunicaciones(e?: number | null) {
  return listAll<ComunicacionRow>("sst_comunicaciones", "fecha", e)
}
export async function saveComunicacion(r: Partial<ComunicacionRow>, e?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Comunicación SST"], "crear")
  return save("sst_comunicaciones", r as any, e)
}
