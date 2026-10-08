import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirAccionApi } from "@/lib/puerta-api"

/**
 * Soportes del recobro de incapacidades: el soporte clínico de la incapacidad,
 * el correo radicado a la EPS/ARL y el comprobante de pago. Van al bucket
 * `archivos`, en `recobro/{id}/`.
 *
 * DOS MODOS, y el que importa es el primero:
 *
 *  1. `POST` con JSON `{ id, tipo, nombre }` → devuelve una URL FIRMADA para que
 *     el navegador suba el archivo DIRECTO a Supabase Storage. Es el camino normal.
 *
 *  2. `POST` con FormData `{ file, id, tipo }` → sube el archivo desde el
 *     servidor. Se conserva como respaldo para archivos pequeños.
 *
 * POR QUÉ LA URL FIRMADA: en el modo 2 el archivo viaja dentro de la petición a
 * una función serverless, y esa petición se corta alrededor de 4,5 MB. No es
 * configurable — es un límite de la plataforma. Un soporte de incapacidad
 * escaneado lo supera con facilidad, y cuando pasa, el archivo ni siquiera llega
 * aquí: la plataforma responde "Request Entity Too Large" en TEXTO PLANO, y el
 * cliente, que esperaba JSON, mostraba "unexpected token 'Request En'... is not
 * valid JSON" — un error que no dice nada de la causa real.
 *
 * Con la URL firmada el archivo va del navegador a Supabase sin pasar por la
 * función, así que el único tope que queda es el del bucket
 * (`storage.buckets.file_size_limit`, ver scripts/135_verificar_bucket_archivos.sql).
 * La clave de servicio nunca sale del servidor: solo se emite un permiso de
 * subida acotado a esa ruta.
 *
 * Mismo patrón que /api/epp/upload, donde este problema ya se había resuelto.
 */
export const maxDuration = 60

/** Ruta destino dentro del bucket, con el nombre normalizado. */
function rutaDestino(id: string, tipo: string, nombreOriginal: string): string {
  // Espacios, tildes y paréntesis rompen la ruta del bucket y dejan una URL que
  // después no abre. `\p{Diacritic}` quita los acentos que `NFD` separó.
  const limpiar = (v: string, max: number) =>
    String(v || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, max)

  const safeId = limpiar(id, 40) || "sin-id"
  const safeTipo = limpiar(tipo, 20) || "soporte"
  const safeName = limpiar(nombreOriginal, 60) || "soporte"
  return `recobro/${safeId}/${safeTipo}-${Date.now()}_${safeName}`
}

export async function POST(request: NextRequest) {
  const puerta = await exigirAccionApi(["Recobro de Incapacidades", "Ausentismos"], "editar")
  if (puerta) return puerta
  const tipoContenido = request.headers.get("content-type") || ""

  // ── Modo 1: emitir URL firmada ────────────────────────────────────────
  if (tipoContenido.includes("application/json")) {
    try {
      const { id, tipo, nombre } = await request.json()
      const filePath = rutaDestino(id ?? "sin-id", tipo ?? "soporte", nombre ?? "soporte")

      let supabase: any
      try {
        supabase = await getSupabaseAdmin()
      } catch (e: any) {
        console.error("[v0] recobro/upload sin cliente admin:", e)
        return NextResponse.json(
          { success: false, error: `No se pudo conectar al almacenamiento: ${e?.message || "cliente no disponible"}` },
          { status: 500 },
        )
      }

      const { data, error } = await supabase.storage.from("archivos").createSignedUploadUrl(filePath)

      if (error || !data) {
        console.error("[v0] recobro/upload createSignedUploadUrl:", error)
        return NextResponse.json(
          { success: false, error: error?.message || "No se pudo preparar la subida" },
          { status: 500 },
        )
      }

      const { data: pub } = supabase.storage.from("archivos").getPublicUrl(filePath)
      return NextResponse.json({
        success: true,
        modo: "firmada",
        path: data.path ?? filePath,
        token: data.token,
        url: pub?.publicUrl || "",
      })
    } catch (error: any) {
      console.error("[v0] recobro/upload fatal (firmada):", error)
      return NextResponse.json(
        { success: false, error: error?.message || "Error al preparar la subida" },
        { status: 500 },
      )
    }
  }

  // ── Modo 2: subida por el servidor (respaldo) ─────────────────────────
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const id = (formData.get("id") as string | null) || "sin-id"
    const tipo = (formData.get("tipo") as string | null) || "soporte"
    if (!file) {
      return NextResponse.json({ success: false, error: "Archivo requerido" }, { status: 400 })
    }

    const supabaseAdmin = await getSupabaseAdmin()
    const filePath = rutaDestino(id, tipo, file.name || "soporte")

    const { error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(filePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      })

    if (uploadError) {
      console.error("[v0] recobro upload error:", uploadError)
      return NextResponse.json(
        { success: false, error: uploadError.message || "Error al subir" },
        { status: 500 },
      )
    }

    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
    return NextResponse.json({ success: true, modo: "servidor", url: urlData.publicUrl })
  } catch (err: any) {
    console.error("[v0] recobro upload exception:", err)
    return NextResponse.json(
      { success: false, error: err?.message || "Error inesperado" },
      { status: 500 },
    )
  }
}
