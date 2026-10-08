"use server"

import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { motivoSinAccion } from "@/lib/puerta-modulo"

export interface HojaDeVida {
  id: string
  idempresa: number
  nombre_candidato: string
  cedula: string | null
  cargo_aspirado: string | null
  correo: string | null
  telefono: string | null
  notas: string | null
  archivo_url: string
  archivo_nombre: string
  archivo_tipo: string | null
  archivo_tamano: number | null
  estado: "pendiente" | "aceptado" | "rechazado"
  created_at: string
  // PDF de antecedentes (Compliance) propagado desde la consulta. Columnas nuevas
  // (ver 046_add_antecedentes_decision.sql). No pisan el CV (archivo_url).
  antecedentes_url?: string | null
  antecedentes_nombre?: string | null
  antecedentes_estado?: string | null
  antecedentes_score?: number | null
}

// Lista las hojas de vida de la empresa seleccionada (o la de sesion).
export async function getHojasVida(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

  const { data, error } = await supabase
    .from("hojas_de_vida")
    .select("*")
    .eq("idempresa", empresaId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching hojas_de_vida:", error)
    return { success: false, data: [] as HojaDeVida[], message: error.message }
  }

  return { success: true, data: (data || []) as HojaDeVida[] }
}

// Deriva el nombre de archivo desde la URL pública de Storage.
function nombreDeUrl(url: string, fallback: string): string {
  try {
    const seg = decodeURIComponent(url.split("/").pop() || "")
    return seg || fallback
  } catch {
    return fallback
  }
}
function tipoDeUrl(url: string): string | null {
  const u = url.toLowerCase()
  if (u.endsWith(".pdf")) return "application/pdf"
  if (u.endsWith(".png")) return "image/png"
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg"
  return null
}

// SINCRONIZAR desde Head Count: los colaboradores antiguos YA tienen su hoja de
// vida cargada en Head Count (columna hoja_de_vida = URL del documento). Esta
// acción trae esos datos + el documento al Banco de Hojas de Vida, sin re-subir.
// Idempotente por cédula: crea las que faltan y actualiza el archivo de las que ya están.
export async function sincronizarHojasVidaDesdeHeadcount(selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Hojas de Vida", "Gestión de Solicitudes"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const admin: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return { success: false, creadas: 0, actualizadas: 0, message: "Sin empresa seleccionada." }

  const { data: hc, error: eHc } = await admin
    .from("headcount")
    .select("identificacion,nombre,cargo,correo,celular,hoja_de_vida")
    .eq("idempresa", empresaId)
    .not("hoja_de_vida", "is", null)
  if (eHc) return { success: false, creadas: 0, actualizadas: 0, message: eHc.message }

  const { data: exist } = await admin.from("hojas_de_vida").select("id,cedula").eq("idempresa", empresaId)
  const byCedula = new Map<string, string>()
  for (const h of exist ?? []) if (h.cedula) byCedula.set(String(h.cedula).trim(), h.id)

  let actualizadas = 0
  const nuevas: any[] = []
  for (const c of hc ?? []) {
    const url = c.hoja_de_vida as string
    if (!url) continue
    const ced = c.identificacion ? String(c.identificacion).trim() : ""
    const existingId = ced ? byCedula.get(ced) : undefined
    const base = {
      cargo_aspirado: c.cargo ?? null,
      correo: c.correo ?? null,
      telefono: c.celular ?? null,
      archivo_url: url,
      archivo_nombre: nombreDeUrl(url, `Hoja de vida - ${c.nombre}`),
      archivo_tipo: tipoDeUrl(url),
    }
    if (existingId) {
      const { error } = await admin.from("hojas_de_vida").update(base).eq("id", existingId)
      if (!error) actualizadas++
    } else {
      nuevas.push({
        idempresa: empresaId,
        nombre_candidato: c.nombre,
        cedula: ced || null,
        notas: "Importado desde Head Count",
        archivo_tamano: null,
        estado: "aceptado",
        ...base,
      })
    }
  }
  if (nuevas.length) {
    const { error } = await admin.from("hojas_de_vida").insert(nuevas)
    if (error) return { success: false, creadas: 0, actualizadas, message: error.message }
  }
  return { success: true, creadas: nuevas.length, actualizadas }
}

// Marca una hoja de vida como aceptada, rechazada o pendiente.
export async function updateEstadoHojaVida(
  id: string,
  estado: "pendiente" | "aceptado" | "rechazado",
) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Hojas de Vida", "Gestión de Solicitudes"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const { error } = await supabase.from("hojas_de_vida").update({ estado }).eq("id", id)

  if (error) {
    console.error("[v0] Error updating estado hoja_de_vida:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}

// Elimina una hoja de vida (archivo en Supabase Storage + metadatos).
export async function deleteHojaVida(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Hojas de Vida", "Gestión de Solicitudes"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { data: current } = await supabase
    .from("hojas_de_vida")
    .select("archivo_url")
    .eq("id", id)
    .maybeSingle()

  // Borramos primero el archivo del bucket "archivos" (si falla no
  // interrumpimos el borrado del registro). Derivamos la ruta interna a
  // partir de la URL publica de Supabase Storage.
  if (current?.archivo_url) {
    try {
      const marker = "/object/public/archivos/"
      const idx = current.archivo_url.indexOf(marker)
      if (idx !== -1) {
        const filePath = decodeURIComponent(current.archivo_url.slice(idx + marker.length))
        const supabaseAdmin = await getSupabaseAdmin()
        await supabaseAdmin.storage.from("archivos").remove([filePath])
      }
    } catch (err: any) {
      console.error("[v0] Error eliminando archivo de Storage:", err?.message || err)
    }
  }

  const { error } = await supabase.from("hojas_de_vida").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting hoja_de_vida:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}
