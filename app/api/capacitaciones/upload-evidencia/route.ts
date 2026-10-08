import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirAccionApi } from "@/lib/puerta-api"

// Endpoint para subir evidencias de Capacitaciones al bucket
// `archivos` dentro de la carpeta `capacitaciones/`. Devuelve la URL
// publica para que el cliente la persista en `capacitaciones.urlcapacitacion`.
// Sigue el mismo patron que /api/headcount/upload-document para mantener
// consistencia entre modulos.
export async function POST(request: NextRequest) {
  const puerta = await exigirAccionApi(["Asistencia a Capacitaciones", "Gestión de Capacitaciones"], "editar")
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json(
        { success: false, error: "Archivo requerido" },
        { status: 400 },
      )
    }

    const supabaseAdmin = await getSupabaseAdmin()
    const timestamp = Date.now()
    const safeName = (file.name || "evidencia")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "")
    const filePath = `capacitaciones/${timestamp}_${safeName}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(filePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      })

    if (uploadError) {
      console.error("[v0] capacitaciones upload error:", uploadError)
      return NextResponse.json(
        { success: false, error: uploadError.message || "Error al subir" },
        { status: 500 },
      )
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("archivos")
      .getPublicUrl(filePath)

    return NextResponse.json({ success: true, url: urlData.publicUrl })
  } catch (err: any) {
    console.error("[v0] capacitaciones upload exception:", err)
    return NextResponse.json(
      { success: false, error: err?.message || "Error inesperado" },
      { status: 500 },
    )
  }
}
