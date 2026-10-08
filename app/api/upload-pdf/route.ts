import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

// Endpoint para subir PDFs generados por la app (ej. PDF de
// Aprobacion de Turnos). Antes usaba `@vercel/blob`, que estaba
// devolviendo "Upload failed" generico — el mismo problema que ya
// tuvimos con `/api/upload-signature`. Unificamos al patron de
// Supabase Storage (bucket `archivos`) que es el que funciona en el
// resto del proyecto. La carpeta destino llega como `folder` en el
// FormData (ej. "aprobacionturnos") y, si no viene, cae a
// "documentos".
export async function POST(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const folder = (formData.get("folder") as string) || "documentos"

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const supabaseAdmin = await getSupabaseAdmin()
    const timestamp = Date.now()
    const filePath = `${folder}/documento_${timestamp}.pdf`

    const { error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(filePath, file, {
        contentType: file.type || "application/pdf",
        upsert: false,
      })

    if (uploadError) {
      // Propagamos el mensaje real de Supabase para no perder
      // visibilidad del problema en el cliente.
      console.error("[v0] upload-pdf error:", uploadError)
      return NextResponse.json(
        { error: uploadError.message || "Upload failed" },
        { status: 500 },
      )
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("archivos")
      .getPublicUrl(filePath)

    return NextResponse.json({ url: urlData.publicUrl })
  } catch (error: any) {
    console.error("[v0] upload-pdf exception:", error)
    return NextResponse.json(
      { error: error?.message || "Upload failed" },
      { status: 500 },
    )
  }
}
