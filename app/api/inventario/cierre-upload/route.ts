import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

// Sube el acta PDF de cierre mensual de inventario al bucket `archivos`:
// inventario/cierres/{proyecto_id}/{mes}/acta-conciliacion.pdf
export async function POST(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const proyectoId = (formData.get("proyectoId") as string | null) || "0"
    const mes = (formData.get("mes") as string | null) || "sin-mes"
    if (!file) {
      return NextResponse.json({ success: false, error: "Archivo requerido" }, { status: 400 })
    }

    const supabaseAdmin = await getSupabaseAdmin()
    const safeMes = mes.replace(/[^0-9-]/g, "")
    const filePath = `inventario/cierres/${proyectoId}/${safeMes}/acta-conciliacion.pdf`

    const { error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(filePath, file, {
        contentType: file.type || "application/pdf",
        upsert: true,
      })

    if (uploadError) {
      console.error("[v0] inventario cierre upload error:", uploadError)
      return NextResponse.json(
        { success: false, error: uploadError.message || "Error al subir" },
        { status: 500 },
      )
    }

    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
    return NextResponse.json({ success: true, url: urlData.publicUrl, path: filePath })
  } catch (err: any) {
    console.error("[v0] inventario cierre upload exception:", err)
    return NextResponse.json(
      { success: false, error: err?.message || "Error inesperado" },
      { status: 500 },
    )
  }
}
