"use server"

// Subida de soportes/evidencias del SG-SST a LIPgo (bucket "archivos"), mismo
// patrón que uploadHeadcountDocument / uploadSanitaryPhoto. Devuelve la URL pública,
// que luego se guarda en sst_autoeval_respuestas.soporte_url (vía guardarRespuesta).

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const sanit = (s: string) => (s || "").replace(/[^a-zA-Z0-9._-]/g, "_")

export async function subirSoporteEstandar(
  file: File,
  autoevaluacionId: number,
  numeral: string,
): Promise<{ success: boolean; url?: string; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Repositorio de Soportes"], "crear", "Subir soporte")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const supabaseAdmin = await getSupabaseAdmin()
    const ext = file.name.split(".").pop() || "bin"
    const fileName = `${sanit(numeral)}_${autoevaluacionId}_${Date.now()}.${ext}`
    const filePath = `sst-soportes/${fileName}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(filePath, file, { contentType: file.type || undefined, upsert: true })
    if (uploadError) {
      console.error("[v0] subirSoporteEstandar upload:", uploadError.message)
      return { success: false, message: uploadError.message }
    }

    const { data } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
    return { success: true, url: data.publicUrl }
  } catch (e: any) {
    console.error("[v0] subirSoporteEstandar:", e?.message ?? e)
    return { success: false, message: e?.message ?? "Error inesperado al subir el soporte." }
  }
}
