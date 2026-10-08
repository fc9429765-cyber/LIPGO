import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { createServerClient } from "@/lib/supabase-server"
import { exigirAccionApi } from "@/lib/puerta-api"

export async function POST(request: NextRequest) {
  const puerta = await exigirAccionApi(["Head Count", "Gestión de Colaboradores"], "editar")
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const personId = Number.parseInt(formData.get("personId") as string)
    const documentType = formData.get("documentType") as string

    console.log("[v0] Uploading document:", { personId, documentType, fileName: file.name })

    const supabaseAdmin = await getSupabaseAdmin()
    const timestamp = Date.now()
    const fileName = `${documentType}_${personId}_${timestamp}.${file.name.split(".").pop()}`
    const filePath = `personal/${fileName}`

    const { error: uploadError } = await supabaseAdmin.storage.from("archivos").upload(filePath, file)

    if (uploadError) {
      console.error("[v0] Error uploading document:", uploadError)
      return NextResponse.json({ error: "Error al subir el documento" }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
    const url = urlData.publicUrl

    console.log("[v0] Document uploaded, URL:", url)

    const supabase = createServerClient()
    const { error: updateError } = await supabase
      .from("headcount")
      .update({
        [documentType]: url,
      })
      .eq("id", personId)

    if (updateError) {
      console.error("[v0] Error updating headcount record:", updateError)
      return NextResponse.json({ error: "Error al actualizar el registro" }, { status: 500 })
    }

    return NextResponse.json({ url })
  } catch (error) {
    console.error("[v0] Error in POST /api/headcount/upload-document:", error)
    return NextResponse.json({ error: "Error al cargar el documento" }, { status: 500 })
  }
}
