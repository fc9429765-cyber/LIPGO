"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import type { EppRow } from "@/lib/sst-evidencia-types"
import { exigirAccion } from "@/lib/puerta-modulo"

async function resolveEmpresaId(fromClient?: number | null): Promise<number | null> {
  if (fromClient && !Number.isNaN(fromClient)) return fromClient
  return await getCurrentEmpresaIdForInsert()
}

export async function listEpp(empresaIdFromClient?: number | null): Promise<EppRow[]> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []
  const { data, error } = await supabase
    .from("sst_entrega_epp")
    .select("*")
    // SST transversal (LIP): no se filtra por el ID del cliente.
    .order("fecha", { ascending: false })
  if (error) {
    console.error("[v0] listEpp:", error.message)
    return []
  }
  return (data ?? []) as EppRow[]
}

export async function saveEpp(
  row: Partial<EppRow>,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Entrega de EPP"], "crear")
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  const { error } = await supabase.from("sst_entrega_epp").insert([{ ...row, idempresa: empresaId }])
  return error ? { success: false, message: error.message } : { success: true }
}
