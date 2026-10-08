import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { setEvidenciaISO } from "@/lib/iso9001-actions"
import { exigirSesionApi } from "@/lib/puerta-api"

/**
 * Sube (o re-sube) la evidencia de una clausula ISO 9001 al bucket
 * `archivos` de Supabase Storage, siguiendo la convencion del proyecto
 * (igual que gestion-facturas, headcount, etc.), y registra la URL en
 * `iso_clausulas` via `setEvidenciaISO`.
 */
export async function POST(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const clausulaId = formData.get("clausulaId") as string | null
    const numero = (formData.get("numero") as string | null) || "doc"

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No se proporcionó archivo" },
        { status: 400 },
      )
    }
    if (!clausulaId) {
      return NextResponse.json(
        { success: false, error: "No se proporcionó la cláusula" },
        { status: 400 },
      )
    }

    const supabase = await getSupabaseAdmin()

    const timestamp = Date.now()
    const extension = file.name.split(".").pop() || "pdf"
    const numeroSeguro = numero.replace(/[^0-9.]/g, "") || "doc"
    const filePath = `iso9001/clausula_${numeroSeguro}_${timestamp}.${extension}`

    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from("archivos")
      .upload(filePath, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      })

    if (uploadError) {
      console.error("[v0] iso9001 upload storage error:", uploadError)
      return NextResponse.json(
        { success: false, error: uploadError.message || "Error al subir archivo" },
        { status: 500 },
      )
    }

    const { data: pub } = supabase.storage.from("archivos").getPublicUrl(filePath)
    const publicUrl = pub?.publicUrl || ""

    const res = await setEvidenciaISO(clausulaId, {
      url: publicUrl,
      path: filePath,
      nombre: file.name,
    })

    if (!res.success) {
      /*
       * El archivo YA está en Storage, pero nada lo referencia: sin la fila,
       * no hay forma de encontrarlo ni de borrarlo desde la aplicación.
       *
       * Antes se quedaba ahí. Cada intento fallido --y el usuario reintenta,
       * porque el error no dice que no vale la pena-- dejaba otra copia
       * ocupando espacio para siempre.
       */
      try {
        await supabase.storage.from("archivos").remove([filePath])
      } catch {
        // Si tampoco se puede borrar, el error que importa es el de abajo.
      }

      // El caso más probable: las columnas no existen todavía. El mensaje de
      // Supabase ("Could not find the 'evidencia_path' column...") es correcto
      // pero no dice qué hacer.
      const falta = /column|schema cache/i.test(String(res.error ?? ""))
      return NextResponse.json(
        {
          success: false,
          error: falta
            ? "Falta correr scripts/194_iso_evidencia_columnas.sql en Supabase: la tabla no tiene todavía las columnas de evidencia."
            : res.error || "Error al registrar la evidencia",
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, url: publicUrl, nombre: file.name })
  } catch (error: any) {
    console.error("[v0] iso9001 upload fatal:", error)
    return NextResponse.json(
      { success: false, error: error?.message || "Error al subir archivo" },
      { status: 500 },
    )
  }
}
