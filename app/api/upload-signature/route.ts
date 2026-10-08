import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

// Endpoint para subir la firma del Registro Preoperacional. La firma
// se guarda en el bucket `archivos` dentro de la carpeta `firmas/` y
// la URL publica resultante se persiste en
// `inspecciones_montacargas.firma`. Antes este endpoint usaba
// `@vercel/blob` pero estaba devolviendo "Upload failed" generico
// porque el token de Blob no estaba enrutando bien y, ademas, el
// resto del proyecto (capacitaciones) ya guarda firmas en Supabase
// Storage. Unificamos al patron de Supabase para evitar tener dos
// proveedores de storage para el mismo tipo de activo.
export async function POST(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const supabaseAdmin = await getSupabaseAdmin()
    const timestamp = Date.now()
    // Sanitizamos el nombre por si el client envia algo distinto a
    // "firma.png". El timestamp asegura que no haya colisiones.
    const safeName = (file.name || "firma.png")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "")
    const filePath = `firmas/firma_${timestamp}_${safeName}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(filePath, file, {
        contentType: file.type || "image/png",
        upsert: false,
      })

    if (uploadError) {
      // Devolvemos el mensaje real para no perder visibilidad del
      // problema en el cliente (antes se devolvia un generico).
      console.error("[v0] upload-signature error:", uploadError)
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
    console.error("[v0] upload-signature exception:", error)
    return NextResponse.json(
      { error: error?.message || "Upload failed" },
      { status: 500 },
    )
  }
}
