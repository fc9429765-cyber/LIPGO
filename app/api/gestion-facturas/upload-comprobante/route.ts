import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirModuloApi } from "@/lib/puerta-api"

/**
 * Sube comprobantes de pago / facturas Siigo de Gestion de Facturas.
 *
 * Antes este endpoint usaba `@vercel/blob.put`, lo que requeria la
 * variable de entorno `BLOB_READ_WRITE_TOKEN`. En este proyecto la
 * convencion es Supabase Storage (bucket `archivos`) - por eso los
 * uploads desde gestion-facturas.tsx empezaron a fallar con 500
 * "Error al subir archivo" cuando el token no estaba configurado.
 * Migrado a Supabase Storage para alinear con `lib/picking-actions`,
 * `lib/headcount-actions`, `lib/orders-actions`, etc.
 */
export async function POST(request: NextRequest) {
  const puerta = await exigirModuloApi(["Solicitar Facturas", "Cuadro de Control Facturación"])
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const ordenId = formData.get("ordenId") as string | null
    const type = formData.get("type") as string | null // "facturasiigo" o null = comprobante

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No se proporcionó archivo" },
        { status: 400 },
      )
    }
    if (!ordenId) {
      return NextResponse.json(
        { success: false, error: "No se proporcionó ID de orden" },
        { status: 400 },
      )
    }

    const supabase = await getSupabaseAdmin()

    const timestamp = Date.now()
    const extension = file.name.split(".").pop() || "jpg"
    const folder = type === "facturasiigo" ? "facturas_siigo" : "comprobantes"
    const filePath = `${folder}/orden_${ordenId}_${timestamp}.${extension}`

    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from("archivos")
      .upload(filePath, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      })

    if (uploadError) {
      console.error("[v0] upload-comprobante storage error:", uploadError)
      return NextResponse.json(
        { success: false, error: uploadError.message || "Error al subir archivo" },
        { status: 500 },
      )
    }

    const { data: pub } = supabase.storage.from("archivos").getPublicUrl(filePath)
    const publicUrl = pub?.publicUrl || ""

    if (type === "facturasiigo") {
      const { error: dbError } = await supabase
        .from("cabeceraoc")
        .update({ facturasiigo: publicUrl })
        .eq("id", parseInt(ordenId, 10))

      if (dbError) {
        console.error("[v0] upload-comprobante db error:", dbError)
        return NextResponse.json(
          { success: false, error: "Error al actualizar la base de datos" },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({
      success: true,
      url: publicUrl,
      pathname: filePath,
    })
  } catch (error: any) {
    console.error("[v0] upload-comprobante fatal:", error)
    return NextResponse.json(
      { success: false, error: error?.message || "Error al subir archivo" },
      { status: 500 },
    )
  }
}
