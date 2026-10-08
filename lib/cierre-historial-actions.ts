"use server"

/**
 * Historial de Cierres del Dia.
 *
 * Por solicitud de negocio:
 *   - El snapshot HTML del cierre se guarda en el bucket de Supabase
 *     Storage `cierrediario`.
 *   - La URL publica del archivo subido se persiste en la tabla
 *     `bitacora` (columna `dashdia`) para el (idempresa, fecha)
 *     correspondiente. Si no existe registro de ese dia se crea uno;
 *     si existe, se actualiza solo `dashdia` sin tocar el texto.
 *
 * Estructura de paths en el bucket:
 *   <empresaId>/<YYYY-MM-DD>.html
 *
 * `upsert: true` permite reimprimir el mismo dia y reemplazar el
 * archivo anterior — el ultimo print del dia es el "oficial".
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const BUCKET = "cierrediario"

export interface CierreSnapshot {
  fecha: string // YYYY-MM-DD
  url: string
  size: number
  uploadedAt: string // ISO
  empresaId: number
}

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Sube un snapshot HTML del cierre al bucket `cierrediario` y guarda
 * la URL publica en `bitacora.dashdia`. `html` debe ser un documento
 * HTML completo y autocontenido (head + body + estilos) para que se
 * pueda abrir directo desde la URL del bucket sin depender de la app.
 */
export async function saveCierreSnapshot(
  empresaId: number,
  fechaISO: string,
  html: string,
): Promise<ActionResult<CierreSnapshot>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Bitácora", "Operación del día"], "editar", "Guardar cierre del día")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!empresaId) return { success: false, error: "Empresa no seleccionada" }
  if (!fechaISO) return { success: false, error: "Fecha requerida" }
  if (!html || html.length < 100) {
    return { success: false, error: "HTML del cierre vacio" }
  }

  try {
    const supabase = await getSupabaseAdmin()
    const path = `${empresaId}/${fechaISO}.html`

    // 1) Subir al bucket. `upsert: true` reemplaza el archivo si ya
    //    existe (caso reimpresion del mismo dia).
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Blob([html], { type: "text/html; charset=utf-8" }), {
        cacheControl: "0",
        contentType: "text/html; charset=utf-8",
        upsert: true,
      })
    if (upErr) {
      console.error("[v0] saveCierreSnapshot upload error:", upErr)
      return { success: false, error: upErr.message }
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const publicUrl = pub?.publicUrl || ""

    // 2) Persistir la URL en bitacora.dashdia (upsert por
    //    idempresa+fecha). Si ya existe la fila, actualizamos solo el
    //    campo `dashdia` para no pisar el texto de la bitacora.
    const { data: existing, error: selErr } = await supabase
      .from("bitacora")
      .select("id")
      .eq("idempresa", empresaId)
      .eq("fecha", fechaISO)
      .limit(1)
      .maybeSingle()
    if (selErr) {
      console.error("[v0] saveCierreSnapshot select error:", selErr)
    }

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from("bitacora")
        .update({ dashdia: publicUrl })
        .eq("id", existing.id)
      if (updErr) {
        console.error("[v0] saveCierreSnapshot update error:", updErr)
        return { success: false, error: updErr.message }
      }
    } else {
      const { error: insErr } = await supabase
        .from("bitacora")
        .insert({
          idempresa: empresaId,
          fecha: fechaISO,
          dashdia: publicUrl,
          // `bitacora` (texto libre) se deja null - se llenara cuando
          // el usuario cree manualmente la nota del dia.
        })
      if (insErr) {
        console.error("[v0] saveCierreSnapshot insert error:", insErr)
        return { success: false, error: insErr.message }
      }
    }

    return {
      success: true,
      data: {
        fecha: fechaISO,
        url: publicUrl,
        size: html.length,
        uploadedAt: new Date().toISOString(),
        empresaId,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] saveCierreSnapshot exception:", err)
    return { success: false, error: msg }
  }
}

/**
 * Lista los snapshots guardados de la empresa leyendo la tabla
 * `bitacora` (filas con `dashdia` no nula). El tamaño no esta
 * almacenado en BD, asi que se reporta como 0 — el dato relevante
 * para el usuario es la fecha y la URL.
 */
export async function listCierreSnapshots(
  empresaId: number,
): Promise<ActionResult<CierreSnapshot[]>> {
  if (!empresaId) return { success: false, error: "Empresa no seleccionada" }

  try {
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("bitacora")
      .select("id, fecha, dashdia")
      .eq("idempresa", empresaId)
      .not("dashdia", "is", null)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })

    if (error) {
      console.error("[v0] listCierreSnapshots error:", error)
      return { success: false, error: error.message }
    }

    const snapshots: CierreSnapshot[] = (data ?? [])
      .filter(
        (r) =>
          typeof r.fecha === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.fecha as string) &&
          typeof r.dashdia === "string" &&
          (r.dashdia as string).length > 0,
      )
      .map((r) => ({
        fecha: r.fecha as string,
        url: r.dashdia as string,
        size: 0,
        // No tenemos timestamp explicito; usamos la fecha como
        // referencia de "subida" para que la UI tenga algo consistente.
        uploadedAt: new Date(`${r.fecha}T00:00:00-05:00`).toISOString(),
        empresaId,
      }))

    return { success: true, data: snapshots }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] listCierreSnapshots exception:", err)
    return { success: false, error: msg }
  }
}

/**
 * Borra el snapshot del bucket y limpia `bitacora.dashdia` para esa
 * (empresa, fecha). NO borramos la fila de `bitacora` para no perder
 * el texto libre que el usuario haya capturado para ese dia.
 */
export async function deleteCierreSnapshot(
  empresaId: number,
  fechaISO: string,
): Promise<ActionResult> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Bitácora"], "eliminar", "Borrar cierre del día")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!empresaId) return { success: false, error: "Empresa no seleccionada" }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) {
    return { success: false, error: "Fecha invalida" }
  }
  try {
    const supabase = await getSupabaseAdmin()
    const path = `${empresaId}/${fechaISO}.html`

    // 1) borrar archivo del bucket (idempotente — si no existe el
    //    storage retorna error pero no abortamos el limpiado de BD).
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path])
    if (rmErr) {
      console.warn("[v0] deleteCierreSnapshot remove warn:", rmErr.message)
    }

    // 2) limpiar campo dashdia en bitacora
    const { error: updErr } = await supabase
      .from("bitacora")
      .update({ dashdia: null })
      .eq("idempresa", empresaId)
      .eq("fecha", fechaISO)
    if (updErr) {
      console.error("[v0] deleteCierreSnapshot update error:", updErr)
      return { success: false, error: updErr.message }
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido"
    console.error("[v0] deleteCierreSnapshot exception:", err)
    return { success: false, error: msg }
  }
}
