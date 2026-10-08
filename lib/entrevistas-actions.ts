"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { motivoSinAccion } from "@/lib/puerta-modulo"

export interface ExperienciaLaboral {
  empresa: string
  cargo: string
  fecha_inicio: string
  fecha_fin: string
  motivo_retiro: string
  funciones: string
  jefe_nombre: string
  jefe_telefono: string
}

export interface Entrevista {
  id: string
  idempresa: number
  hoja_vida_id: string | null
  nombre_candidato: string
  cedula: string | null
  correo: string | null
  telefono: string | null
  edad: string | null
  fecha_nacimiento: string | null
  lugar_nacimiento: string | null
  procedencia: string | null
  direccion: string | null
  contacto_emergencia_nombre: string | null
  contacto_emergencia_parentesco: string | null
  contacto_emergencia_telefono: string | null
  sabe_leer_escribir: string | null
  talla_pantalon: string | null
  talla_camisa: string | null
  institucion_educativa: string | null
  nivel_educativo: string | null
  ano_ingreso: string | null
  ano_finalizacion: string | null
  experiencia_laboral: ExperienciaLaboral[]
  observaciones: string | null
  concepto_final: "apto" | "no_apto" | "aplazado"
  entrevistador: string | null
  fecha_entrevista: string | null
  created_at: string
}

// Lista las entrevistas de la empresa seleccionada (o la de sesion).
export async function getEntrevistas(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

  const { data, error } = await supabase
    .from("entrevistas")
    .select("*")
    .eq("idempresa", empresaId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching entrevistas:", error)
    return { success: false, data: [] as Entrevista[], message: error.message }
  }

  return { success: true, data: (data || []) as Entrevista[] }
}

// Crea una entrevista. Inyecta idempresa de forma segura (cliente o sesion).
export async function createEntrevista(
  entrevista: Record<string, any>,
  selectedEmpresaId?: number | null,
) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Entrevistas"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

  const { data, error } = await supabase
    .from("entrevistas")
    .insert([{ ...entrevista, idempresa: empresaId }])
    .select()

  if (error) {
    console.error("[v0] Error creating entrevista:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] as Entrevista }
}

// Actualiza una entrevista existente. No permite cambiar idempresa.
export async function updateEntrevista(id: string, updates: Record<string, any>) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Entrevistas"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const { idempresa, id: _ignore, created_at, ...rest } = updates

  const { data, error } = await supabase
    .from("entrevistas")
    .update(rest)
    .eq("id", id)
    .select()

  if (error) {
    console.error("[v0] Error updating entrevista:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] as Entrevista }
}

// Elimina una entrevista.
export async function deleteEntrevista(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Entrevistas"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const { error } = await supabase.from("entrevistas").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting entrevista:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}
