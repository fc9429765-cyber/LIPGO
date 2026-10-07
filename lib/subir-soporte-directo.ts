// SUBIDA DIRECTA DE SOPORTES AL ALMACENAMIENTO
//
// El camino normal --`subirYRegistrarSoporte`-- manda el archivo entero a
// través de un Server Action. Ahí el tope no lo pone LIPgo: lo pone la
// plataforma. Vercel corta el cuerpo de la petición mucho antes de los 50 MB
// que declara `next.config.mjs`, y con un escaneo grande el usuario ve un
// fallo sin explicación.
//
// Aquí el archivo va del NAVEGADOR DIRECTO a Supabase Storage, sin pasar por
// Vercel, así que ese límite deja de existir. Al servidor solo llega la URL y
// los datos del archivo: unos cientos de bytes.
//
// Requiere que el rol `authenticated` pueda escribir en el bucket `archivos`
// (ver scripts/243). Sin esa política la subida falla con "new row violates
// row-level security policy".

import { createClient } from "@/lib/supabase-client"
import { registrarSoporteSubido } from "@/lib/soportes-actions"
// El tipo viene del archivo de tipos y no de las acciones: aquel es
// "use server" y solo puede exportar funciones async.
import type { SoporteMeta } from "@/lib/soportes-types"

/** Deja solo lo que es seguro en un nombre de archivo o carpeta. */
function safe(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80)
}

export type ProgresoSubida = {
  /** 0 a 100. Llega a 100 cuando el archivo terminó de subir. */
  porcentaje: number
  /** Lo que conviene mostrarle a quien espera. */
  etapa: "subiendo" | "registrando" | "listo"
}

/**
 * Sube un soporte y lo registra.
 *
 * Son dos pasos y el orden importa: primero el archivo llega a Storage, y solo
 * cuando está arriba se registra. Al revés quedaría una fila apuntando a un
 * archivo que podría no haberse subido.
 *
 * Si el registro falla, el servidor retira el archivo que acababa de subirse
 * (ver `registrarSoporteSubido`), así que no quedan huérfanos.
 */
export async function subirSoporteDirecto(
  file: File,
  meta: SoporteMeta,
  empresaId?: number | null,
  onProgreso?: (p: ProgresoSubida) => void,
): Promise<{ success: boolean; url?: string; id?: number; message?: string }> {
  try {
    const supabase = await createClient()

    const ext = file.name.split(".").pop() || "bin"
    const fileName = `${safe(meta.referenciaTipo)}_${safe(meta.referenciaId)}_${Date.now()}.${ext}`
    const storagePath = `soportes/${safe(meta.modulo)}/${fileName}`

    onProgreso?.({ porcentaje: 0, etapa: "subiendo" })

    const up = await supabase.storage
      .from("archivos")
      .upload(storagePath, file, { contentType: file.type || undefined, upsert: true })

    if (up.error) {
      console.error("[v0] subirSoporteDirecto upload:", up.error.message)
      /*
       * El fallo más probable aquí es de permisos: si el bucket no deja
       * escribir al rol `authenticated`, Supabase responde con un error de
       * RLS que no significa nada para quien está subiendo un escaneo.
       */
      const esPermisos =
        /row-level security|policy|unauthorized|403/i.test(up.error.message)
      return {
        success: false,
        message: esPermisos
          ? "El almacenamiento no está aceptando archivos de este usuario. Avisa a sistemas (falta correr scripts/243)."
          : up.error.message,
      }
    }

    onProgreso?.({ porcentaje: 100, etapa: "registrando" })

    const { data: urlData } = supabase.storage.from("archivos").getPublicUrl(storagePath)

    const res = await registrarSoporteSubido(
      {
        storagePath,
        url: urlData.publicUrl,
        nombre: file.name,
        tipo: file.type || ext,
        tamano: file.size,
      },
      meta,
      empresaId ?? null,
    )

    if (res.success) onProgreso?.({ porcentaje: 100, etapa: "listo" })
    return res
  } catch (e: any) {
    console.error("[v0] subirSoporteDirecto:", e?.message ?? e)
    return { success: false, message: e?.message ?? "No se pudo subir el archivo." }
  }
}
