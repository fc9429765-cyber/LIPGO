import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirAccionApi } from "@/lib/puerta-api"

/**
 * Subida de UNA foto de mantenimiento de montacargas.
 *
 * Sube de a un archivo por petición, a propósito: el cuerpo de una función
 * serverless de Vercel tope en ~4.5 MB, y mandar 5 fotos juntas desde un
 * celular deja el diálogo colgado sin error visible. El cliente sube 1×1 y
 * junta las URLs; es el mismo patrón de app/api/upload-picking-photos.
 *
 * La foto NO se asocia aquí a la actividad: solo se guarda y se devuelve la
 * URL. El vínculo lo hace `registrarActividad`/`cerrarActividad` contra
 * `soportes_documentales`, para que una foto huérfana (si el usuario abandona
 * el formulario) no ensucie la hoja de vida.
 */

export const runtime = "nodejs"
export const maxDuration = 60

const MAX_BYTES = 8 * 1024 * 1024

export async function POST(req: Request) {
  const puerta = await exigirAccionApi(["Gestión de Montacargas"], "editar")
  if (puerta) return puerta
  try {
    // `formData()` lanza si el cuerpo no es multipart, así que se atrapa aparte:
    // si no, una petición malformada devolvía 500 con un mensaje de MIME que no
    // le dice nada a quien la hizo.
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json(
        { success: false, error: "La petición debe enviar la foto como multipart/form-data." },
        { status: 400 },
      )
    }
    const file = form.get("file") as File | null
    const equipoId = String(form.get("equipoId") ?? "").trim()

    if (!file) return NextResponse.json({ success: false, error: "No llegó ningún archivo." }, { status: 400 })
    if (!equipoId) return NextResponse.json({ success: false, error: "Falta el equipo." }, { status: 400 })
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "La foto pesa más de 8 MB. Vuelve a tomarla o reduce la calidad." },
        { status: 413 },
      )
    }

    const ext = (file.name?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"
    const safeEquipo = equipoId.replace(/[^\w-]/g, "")
    const ruta = `montacargas/${safeEquipo}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.storage
      .from("archivos")
      .upload(ruta, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || "image/jpeg",
        upsert: false,
      })
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    const { data } = sb.storage.from("archivos").getPublicUrl(ruta)
    return NextResponse.json({ success: true, url: data.publicUrl, nombre: file.name ?? null })
  } catch (e: any) {
    console.error("[v0] upload-foto montacargas error:", e)
    return NextResponse.json({ success: false, error: e?.message || "Error al subir la foto." }, { status: 500 })
  }
}
