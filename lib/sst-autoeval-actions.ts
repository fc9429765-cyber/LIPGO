"use server"

// Cierre / formalización del acta de autoevaluación SG-SST.

import { createClient } from "@/lib/supabase-client"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// Actualiza responsable, fecha, estado y firma de la autoevaluación.
export async function cerrarAutoevaluacion(
  id: number,
  patch: {
    responsable?: string | null
    fecha?: string | null
    estado: string
    firma?: string | null
  },
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Matriz de Estándares", "Auditoría 0312"], "cerrar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const update: Record<string, any> = {
    estado: patch.estado,
    updated_at: new Date().toISOString(),
  }
  if (patch.responsable !== undefined) update.responsable = patch.responsable
  if (patch.fecha !== undefined) update.fecha = patch.fecha
  if (patch.firma !== undefined && patch.firma !== null) update.firma = patch.firma

  const { error } = await supabase.from("sst_autoevaluaciones").update(update).eq("id", id)
  if (error) {
    console.error("[v0] cerrarAutoevaluacion:", error.message)
    return { success: false, message: error.message }
  }
  return {
    success: true,
    message:
      patch.estado === "cerrada"
        ? "El acta quedó fechada y firmada."
        : "La autoevaluación se reabrió para edición.",
  }
}
