import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirAccionApi } from "@/lib/puerta-api"

// Mapa de extensión -> content-type, para no depender de `file.type` (que el
// navegador a veces deja vacío o incorrecto, sobre todo con archivos .html).
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain; charset=utf-8",
}

/**
 * Sube el material de una inducción (PPT/PPTX/PDF u otro documento) al bucket
 * `archivos` de Supabase Storage, siguiendo la convención del proyecto (igual
 * que iso9001, headcount, gestion-facturas, etc.), y devuelve la URL pública
 * para almacenarla en `capacitaciones_evaluaciones.material_url` y poder
 * abrirla/verla desde el portal.
 */
export async function POST(request: NextRequest) {
  const puerta = await exigirAccionApi(["Inducciones"], "editar")
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ success: false, error: "No se proporcionó archivo" }, { status: 400 })
    }

    const supabase = await getSupabaseAdmin()

    const timestamp = Date.now()
    const extension = (file.name.split(".").pop() || "pptx").toLowerCase()
    // Nombre base saneado para conservar legibilidad del archivo.
    const baseName = (file.name.replace(/\.[^.]+$/, "") || "material")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 60)
    const filePath = `inducciones/${baseName}_${timestamp}.${extension}`

    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    // Priorizamos el content-type derivado de la extensión para conservar la
    // naturaleza real del archivo (un .html se guarda como text/html y no como
    // octet-stream/texto plano, evitando que al descargarlo quede como .txt).
    const contentType = CONTENT_TYPE_BY_EXT[extension] || file.type || "application/octet-stream"

    const { error: uploadError } = await supabase.storage.from("archivos").upload(filePath, bytes, {
      contentType,
      upsert: true,
    })

    if (uploadError) {
      console.error("[v0] inducciones upload storage error:", uploadError)
      return NextResponse.json(
        { success: false, error: uploadError.message || "Error al subir archivo" },
        { status: 500 },
      )
    }

    const { data: pub } = supabase.storage.from("archivos").getPublicUrl(filePath)
    const publicUrl = pub?.publicUrl || ""

    return NextResponse.json({ success: true, url: publicUrl, path: filePath, nombre: file.name })
  } catch (error: any) {
    console.error("[v0] inducciones upload fatal:", error)
    return NextResponse.json(
      { success: false, error: error?.message || "Error al subir archivo" },
      { status: 500 },
    )
  }
}
