"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import type { IncidenteRow, IncidenteAccionRow, IncidenteTestigoRow } from "@/lib/sst-evidencia-types"
import { motivoSinAccion } from "@/lib/puerta-modulo"

async function resolveEmpresaId(fromClient?: number | null): Promise<number | null> {
  if (fromClient && !Number.isNaN(fromClient)) return fromClient
  return await getCurrentEmpresaIdForInsert()
}

export async function listIncidentes(empresaIdFromClient?: number | null): Promise<IncidenteRow[]> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []
  const { data, error } = await supabase
    .from("sst_incidentes")
    .select("*")
    // SST transversal (LIP): se listan TODAS las investigaciones AT sin filtrar
    // por el ID del cliente (misma info para todos los proyectos).
    .order("fecha_evento", { ascending: false })
  if (error) {
    console.error("[v0] listIncidentes:", error.message)
    return []
  }
  return (data ?? []) as IncidenteRow[]
}

// Guarda el incidente con sus acciones (plan F/M/I) y testigos. Devuelve el id creado.
export async function saveIncidente(
  row: Partial<IncidenteRow>,
  acciones: Partial<IncidenteAccionRow>[] = [],
  empresaIdFromClient?: number | null,
  testigos: Partial<IncidenteTestigoRow>[] = [],
): Promise<{ success: boolean; id?: number; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Investigación AT"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase: any = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  const { data, error } = await supabase
    .from("sst_incidentes")
    .insert([{ ...row, idempresa: empresaId }])
    .select("id")
    .single()
  if (error) {
    console.error("[v0] saveIncidente:", error.message)
    return { success: false, message: error.message }
  }
  const incidenteId = (data as any)?.id as number
  const validas = acciones.filter((a) => a.plan && a.plan.trim())
  if (incidenteId && validas.length) {
    const payload = validas.map((a) => ({ ...a, incidente_id: incidenteId, idempresa: empresaId }))
    const { error: e2 } = await supabase.from("sst_incidente_acciones").insert(payload)
    if (e2) console.error("[v0] saveIncidente acciones:", e2.message)
  }
  const testValidos = testigos.filter((t) => (t.nombre && t.nombre.trim()) || (t.documento && t.documento.trim()))
  if (incidenteId && testValidos.length) {
    const payloadT = testValidos.map((t) => ({
      nombre: t.nombre ?? null,
      documento: t.documento ?? null,
      version: t.version ?? null,
      cargo: t.cargo ?? null,
      incidente_id: incidenteId,
      idempresa: empresaId,
    }))
    const { error: e3 } = await supabase.from("sst_incidente_testigos").insert(payloadT)
    if (e3) console.error("[v0] saveIncidente testigos:", e3.message)
  }
  return { success: true, id: incidenteId }
}

export async function listTestigos(incidenteId: number): Promise<IncidenteTestigoRow[]> {
  const supabase: any = await createClient()
  const { data, error } = await supabase
    .from("sst_incidente_testigos")
    .select("*")
    .eq("incidente_id", incidenteId)
    .order("id")
  if (error) {
    console.error("[v0] listTestigos:", error.message)
    return []
  }
  return (data ?? []) as IncidenteTestigoRow[]
}

export async function updateIncidente(
  id: number,
  patch: Partial<IncidenteRow>,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Investigación AT", "Investigaciones Realizadas"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase: any = await createClient()
  const { error } = await supabase.from("sst_incidentes").update(patch).eq("id", id)
  return error ? { success: false, message: error.message } : { success: true }
}

/**
 * Actualiza una investigacion existente y REEMPLAZA su plan de accion y sus
 * testigos por los que vengan.
 *
 * El reemplazo es deliberado: el formulario de edicion muestra la lista
 * completa en pantalla, asi que lo que quede alli es lo que debe quedar
 * guardado. Si en vez de reemplazar se insertara --como hace `saveIncidente`,
 * que siempre crea-- cada edicion duplicaria el plan de accion.
 */
export async function actualizarIncidenteCompleto(
  id: number,
  row: Partial<IncidenteRow>,
  acciones: Partial<IncidenteAccionRow>[] = [],
  testigos: Partial<IncidenteTestigoRow>[] = [],
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Investigación AT", "Investigaciones Realizadas"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!id) return { success: false, message: "No se indico que investigacion actualizar." }
  const supabase: any = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)

  // Ni `id` ni `idempresa` se tocan: sigue siendo el mismo registro y del mismo
  // proyecto. Van fuera del update para que un formulario mal armado no pueda
  // moverlo de proyecto sin querer.
  const { id: _sinId, idempresa: _sinEmpresa, ...campos } = row as any
  const { error } = await supabase.from("sst_incidentes").update(campos).eq("id", id)
  if (error) {
    console.error("[v0] actualizarIncidenteCompleto:", error.message)
    return { success: false, message: error.message }
  }

  const { error: eBorrarAcc } = await supabase
    .from("sst_incidente_acciones")
    .delete()
    .eq("incidente_id", id)
  if (eBorrarAcc) {
    console.error("[v0] actualizarIncidenteCompleto acciones (borrado):", eBorrarAcc.message)
    return { success: false, message: eBorrarAcc.message }
  }
  const accValidas = acciones.filter((a) => a.plan && String(a.plan).trim())
  if (accValidas.length) {
    // Los campos se listan uno por uno y no con spread: las filas que vienen de
    // `listAcciones` traen su propio `id`, y reinsertarlo chocaria con el que
    // ya existio.
    const payload = accValidas.map((a) => ({
      plan: a.plan ?? null,
      tipo_control: a.tipo_control ?? null,
      fecha_implementacion: a.fecha_implementacion || null,
      responsable_ejecucion: a.responsable_ejecucion || null,
      fecha_verificacion: a.fecha_verificacion || null,
      responsable_verificacion: a.responsable_verificacion || null,
      observacion: a.observacion || null,
      estado: a.estado ?? "pendiente",
      incidente_id: id,
      idempresa: empresaId,
    }))
    const { error: e2 } = await supabase.from("sst_incidente_acciones").insert(payload)
    if (e2) {
      console.error("[v0] actualizarIncidenteCompleto acciones:", e2.message)
      return { success: false, message: e2.message }
    }
  }

  const { error: eBorrarTes } = await supabase
    .from("sst_incidente_testigos")
    .delete()
    .eq("incidente_id", id)
  if (eBorrarTes) {
    console.error("[v0] actualizarIncidenteCompleto testigos (borrado):", eBorrarTes.message)
    return { success: false, message: eBorrarTes.message }
  }
  const tesValidos = testigos.filter(
    (t) => (t.nombre && String(t.nombre).trim()) || (t.documento && String(t.documento).trim()),
  )
  if (tesValidos.length) {
    const payloadT = tesValidos.map((t) => ({
      nombre: t.nombre ?? null,
      documento: t.documento ?? null,
      version: t.version ?? null,
      cargo: t.cargo ?? null,
      incidente_id: id,
      idempresa: empresaId,
    }))
    const { error: e3 } = await supabase.from("sst_incidente_testigos").insert(payloadT)
    if (e3) {
      console.error("[v0] actualizarIncidenteCompleto testigos:", e3.message)
      return { success: false, message: e3.message }
    }
  }

  return { success: true }
}

export async function listAcciones(incidenteId: number): Promise<IncidenteAccionRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("sst_incidente_acciones")
    .select("*")
    .eq("incidente_id", incidenteId)
    .order("id")
  if (error) {
    console.error("[v0] listAcciones:", error.message)
    return []
  }
  return (data ?? []) as IncidenteAccionRow[]
}
