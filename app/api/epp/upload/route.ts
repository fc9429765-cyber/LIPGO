import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

/**
 * Evidencia PDF de entrega de Dotación / EPP.
 *
 * DOS MODOS, y el que importa es el primero:
 *
 *  1. `POST` con JSON `{ nombre }` → devuelve una URL FIRMADA para que el
 *     navegador suba el archivo DIRECTO a Supabase Storage. Es el camino normal.
 *
 *  2. `POST` con FormData `{ file }` → sube el archivo desde el servidor.
 *     Se conserva como respaldo para archivos pequeños.
 *
 * POR QUÉ LA URL FIRMADA: en el modo 2 el archivo viaja dentro de la petición a
 * una función serverless, y esa petición se corta alrededor de 4,5 MB. No es
 * configurable — es un límite de la plataforma. Un PDF escaneado lo supera con
 * facilidad, y cuando pasa el archivo ni siquiera llega aquí: la respuesta no es
 * JSON y el error termina siendo un genérico sin causa.
 *
 * Con la URL firmada el archivo va del navegador a Supabase sin pasar por la
 * función, así que el único tope que queda es el del bucket
 * (`storage.buckets.file_size_limit`, ver scripts/135_verificar_bucket_archivos.sql).
 * La clave de servicio nunca sale del servidor: solo se emite un permiso de
 * subida acotado a esa ruta.
 *
 * Antes todo esto usaba `@vercel/blob`, que exige `BLOB_READ_WRITE_TOKEN` — no
 * configurado aquí — y por eso fallaba con "Upload failed".
 */
export const maxDuration = 60

/** Ruta destino, con el nombre normalizado. */
function rutaDestino(nombreOriginal: string): string {
  // Espacios, tildes y paréntesis rompen la ruta del bucket y dejan una URL que
  // después no abre. `\p{Diacritic}` quita los acentos que `NFD` separó.
  const limpio = String(nombreOriginal || "")
    .replace(/\.pdf$/i, "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\w-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
  return `epp/${Date.now()}-${limpio || "evidencia"}.pdf`
}

async function clienteAdmin() {
  // Si falta la clave de servicio esto lanza. Se aísla para poder decir "no se
  // pudo conectar al almacenamiento" en vez de un error genérico: ese caso y
  // "el bucket rechazó el archivo" son problemas muy distintos.
  return await getSupabaseAdmin()
}

export async function POST(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  const tipoContenido = request.headers.get("content-type") || ""

  // ── Modo 1: emitir URL firmada ────────────────────────────────────────
  if (tipoContenido.includes("application/json")) {
    try {
      const { nombre } = await request.json()
      const filePath = rutaDestino(nombre)

      let supabase: any
      try {
        supabase = await clienteAdmin()
      } catch (e: any) {
        console.error("[v0] epp/upload sin cliente admin:", e)
        return NextResponse.json(
          { error: `No se pudo conectar al almacenamiento: ${e?.message || "cliente no disponible"}` },
          { status: 500 },
        )
      }

      const { data, error } = await supabase.storage
        .from("archivos")
        .createSignedUploadUrl(filePath)

      if (error || !data) {
        console.error("[v0] epp/upload createSignedUploadUrl:", error)
        return NextResponse.json(
          { error: error?.message || "No se pudo preparar la subida" },
          { status: 500 },
        )
      }

      const { data: pub } = supabase.storage.from("archivos").getPublicUrl(filePath)
      return NextResponse.json({
        modo: "firmada",
        path: data.path ?? filePath,
        token: data.token,
        url: pub?.publicUrl || "",
      })
    } catch (error: any) {
      console.error("[v0] epp/upload fatal (firmada):", error)
      return NextResponse.json(
        { error: error?.message || "Error al preparar la subida" },
        { status: 500 },
      )
    }
  }

  // ── Modo 2: subida por el servidor (respaldo) ─────────────────────────
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 })
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Solo se permiten archivos PDF" }, { status: 400 })
    }

    let supabase: any
    try {
      supabase = await clienteAdmin()
    } catch (e: any) {
      console.error("[v0] epp/upload sin cliente admin:", e)
      return NextResponse.json(
        { error: `No se pudo conectar al almacenamiento: ${e?.message || "cliente no disponible"}` },
        { status: 500 },
      )
    }

    const filePath = rutaDestino(file.name)
    const bytes = new Uint8Array(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from("archivos")
      .upload(filePath, bytes, { contentType: "application/pdf", upsert: true })

    if (uploadError) {
      console.error("[v0] epp/upload storage error:", uploadError)
      return NextResponse.json(
        { error: uploadError.message || "Error al subir el archivo" },
        { status: 500 },
      )
    }

    const { data: pub } = supabase.storage.from("archivos").getPublicUrl(filePath)
    return NextResponse.json({ modo: "servidor", url: pub?.publicUrl || "", path: filePath })
  } catch (error: any) {
    console.error("[v0] epp/upload fatal:", error)
    return NextResponse.json(
      { error: error?.message || "Error al subir el archivo" },
      { status: 500 },
    )
  }
}
