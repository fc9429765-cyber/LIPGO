import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

// Sube el documento de una investigación de AT al bucket `archivos`:
// investigaciones/at/{empresaId}/{incidenteId}-{archivo}
export async function POST(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const empresaId = (formData.get("empresaId") as string | null) || "0"
    const incidenteId = (formData.get("incidenteId") as string | null) || "0"
    if (!file) return NextResponse.json({ success: false, error: "Archivo requerido" }, { status: 400 })

    const supabaseAdmin = await getSupabaseAdmin()
    const safe = (file.name || "documento").replace(/[^a-zA-Z0-9._-]/g, "_")
    const filePath = `investigaciones/at/${empresaId}/${incidenteId}-${Date.now()}-${safe}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(filePath, file, { contentType: file.type || "application/octet-stream", upsert: true })
    if (uploadError) {
      return NextResponse.json({ success: false, error: uploadError.message || "Error al subir" }, { status: 500 })
    }
    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
    return NextResponse.json({ success: true, url: urlData.publicUrl, path: filePath })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Error inesperado" }, { status: 500 })
  }
}
