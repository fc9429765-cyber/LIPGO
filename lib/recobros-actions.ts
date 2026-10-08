"use server"

import { createClient } from "@/lib/supabase-client"
import type { ActualizarRecobroInput } from "@/lib/recobros"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/**
 * Actualiza el seguimiento del recobro de una incapacidad (fila de
 * ausentismosst). Solo toca las columnas de recobro (SQL 27); el resto del
 * registro (días, costos, diagnóstico) no se modifica.
 */
export async function actualizarRecobro(id: string, input: ActualizarRecobroInput) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Recobro de Incapacidades"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  // Cliente tipado a `any` (mismo patrón del resto del proyecto) para evitar
  // que el tipado estricto de supabase-js rechace el update genérico.
  const supabase: any = await createClient()
  const updates: Record<string, any> = {}
  if (input.estado_recobro !== undefined) updates.estado_recobro = input.estado_recobro
  if (input.valor_recobrado !== undefined) updates.valor_recobrado = input.valor_recobrado
  if (input.fecha_radicado_recobro !== undefined)
    updates.fecha_radicado_recobro = input.fecha_radicado_recobro || null
  if (input.obs_recobro !== undefined) updates.obs_recobro = input.obs_recobro
  if (input.soporte_radicado_url !== undefined)
    updates.soporte_radicado_url = input.soporte_radicado_url || null
  if (input.soporte_pago_url !== undefined)
    updates.soporte_pago_url = input.soporte_pago_url || null

  const { error } = await supabase.from("ausentismosst").update(updates).eq("id", id)
  if (error) {
    console.error("[v0] Error actualizando recobro:", error)
    return { success: false, message: error.message }
  }
  return { success: true }
}
