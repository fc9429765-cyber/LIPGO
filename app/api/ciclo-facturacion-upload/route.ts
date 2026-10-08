import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

/**
 * Sube un archivo (anexo/factura, original o firmado por el cliente) de una
 * prefactura dentro del Ciclo de Facturación. Mismo patrón que
 * `/api/gestion-facturas/upload-comprobante` (Supabase Storage, bucket
 * `archivos`) -- solo devuelve la URL; quien persiste el evento en
 * `prefactura_ciclo_eventos` es `registrarEventoCiclo` (server action), no
 * este endpoint.
 */
export async function POST(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const prefacturaId = formData.get("prefacturaId") as string | null
    const evento = formData.get("evento") as string | null

    if (!file) return NextResponse.json({ success: false, error: "No se proporcionó archivo" }, { status: 400 })
    if (!prefacturaId) return NextResponse.json({ success: false, error: "Falta el ID de la prefactura" }, { status: 400 })
    if (!evento) return NextResponse.json({ success: false, error: "Falta el tipo de evento" }, { status: 400 })

    const supabase = await getSupabaseAdmin()

    const timestamp = Date.now()
    const extension = file.name.split(".").pop() || "pdf"
    const filePath = `ciclo_facturacion/${evento}/prefactura_${prefacturaId}_${timestamp}.${extension}`

    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from("archivos")
      .upload(filePath, bytes, { contentType: file.type || "application/octet-stream", upsert: true })

    if (uploadError) {
      console.error("[ciclo-facturacion-upload] storage error:", uploadError)
      return NextResponse.json({ success: false, error: uploadError.message || "Error al subir archivo" }, { status: 500 })
    }

    const { data: pub } = supabase.storage.from("archivos").getPublicUrl(filePath)
    return NextResponse.json({ success: true, url: pub?.publicUrl || "", nombre: file.name })
  } catch (error: any) {
    console.error("[ciclo-facturacion-upload] fatal:", error)
    return NextResponse.json({ success: false, error: error?.message || "Error al subir archivo" }, { status: 500 })
  }
}
