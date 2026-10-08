"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaId } from "@/lib/company-filter"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/**
 * Payload de la Inspeccion Sanitaria de Vehiculos (Empresa 1).
 * `fotos` y `firma` llegan como data URLs base64 desde el cliente; aqui
 * se suben a Supabase Storage y en la tabla se persisten solo las URLs.
 */
export interface VehicleInspectionInput {
  fecha: string
  hora_ingreso: string
  actividad: string
  transportador: string
  placa_vehiculo: string
  documentos_vehiculo: boolean
  bpms_transportador: boolean
  paredes_ok: boolean
  piso_ok: boolean
  estibas_ok: boolean
  techo_carpa_ok: boolean
  ausencia_plagas: boolean
  ausencia_quimicos: boolean
  observaciones: string
  responsable: string
  fotos: string[]
  firma: string
}

/**
 * Convierte una data URL base64 (`data:image/png;base64,....`) en un Buffer
 * + content type para subirlo a Supabase Storage.
 */
function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } | null {
  const match = /^data:(.+?);base64,(.*)$/.exec(dataUrl)
  if (!match) return null
  const contentType = match[1]
  const buffer = Buffer.from(match[2], "base64")
  const ext = contentType.split("/")[1]?.split("+")[0] || "png"
  return { buffer, contentType, ext }
}

/**
 * Sube una data URL al bucket `archivos` y devuelve la URL publica.
 * Devuelve null si la data URL es invalida o falla la subida.
 */
async function uploadDataUrl(
  supabaseAdmin: Awaited<ReturnType<typeof getSupabaseAdmin>>,
  dataUrl: string,
  folder: string,
): Promise<string | null> {
  const parsed = dataUrlToBuffer(dataUrl)
  if (!parsed) return null

  const filePath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${parsed.ext}`
  const { error } = await supabaseAdmin.storage
    .from("archivos")
    .upload(filePath, parsed.buffer, { contentType: parsed.contentType, upsert: false })

  if (error) {
    console.error("[v0] uploadDataUrl error:", error.message)
    return null
  }

  const { data } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
  return data.publicUrl
}

export async function saveVehicleInspection(input: VehicleInspectionInput, selectedEmpresaId?: number) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Registro sanitario"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabaseAdmin = await getSupabaseAdmin()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId()) ?? 1

    // 1) Subir firma (si existe) a storage.
    let firmaUrl: string | null = null
    if (input.firma) {
      firmaUrl = await uploadDataUrl(supabaseAdmin, input.firma, "inspeccion_vehiculos/firmas")
    }

    // 2) Subir cada foto a storage en paralelo y conservar solo URLs validas.
    const fotosUrls = (
      await Promise.all(
        (input.fotos || []).map((f) => uploadDataUrl(supabaseAdmin, f, "inspeccion_vehiculos/fotos")),
      )
    ).filter((u): u is string => Boolean(u))

    // 3) Insertar el registro. Las claves coinciden con las columnas reales
    //    de la tabla: la columna de empresa es `id_empresa` (smallint) y la
    //    tabla NO tiene columna `usuario`.
    const payload = {
      fecha: input.fecha,
      hora_ingreso: input.hora_ingreso || null,
      actividad: input.actividad || null,
      transportador: input.transportador || null,
      placa_vehiculo: input.placa_vehiculo,
      documentos_vehiculo: input.documentos_vehiculo,
      bpms_transportador: input.bpms_transportador,
      paredes_ok: input.paredes_ok,
      piso_ok: input.piso_ok,
      estibas_ok: input.estibas_ok,
      techo_carpa_ok: input.techo_carpa_ok,
      ausencia_plagas: input.ausencia_plagas,
      ausencia_quimicos: input.ausencia_quimicos,
      observaciones: input.observaciones || null,
      responsable: input.responsable,
      fotos: fotosUrls,
      firma: firmaUrl,
      id_empresa: empresaId,
    }

    const { data, error } = await supabaseAdmin
      .from("inspeccion_sanitaria_vehiculos")
      .insert([payload])
      .select("id")
      .single()

    if (error) {
      console.error("[v0] saveVehicleInspection insert error:", error)
      return { success: false, error: error.message }
    }

    console.log("[v0] saveVehicleInspection insertado id:", data?.id)
    return { success: true, id: data?.id }
  } catch (error: any) {
    console.error("[v0] saveVehicleInspection unexpected error:", error)
    return { success: false, error: error?.message || "Error inesperado al guardar" }
  }
}

/** Registro tal como se lee desde la tabla para el historial. */
export interface VehicleInspectionRecord {
  id: number
  id_empresa: number | null
  fecha: string | null
  hora_ingreso: string | null
  actividad: string | null
  transportador: string | null
  placa_vehiculo: string | null
  documentos_vehiculo: boolean | null
  bpms_transportador: boolean | null
  paredes_ok: boolean | null
  piso_ok: boolean | null
  estibas_ok: boolean | null
  techo_carpa_ok: boolean | null
  ausencia_plagas: boolean | null
  ausencia_quimicos: boolean | null
  observaciones: string | null
  responsable: string | null
  fotos: string[] | null
  firma: string | null
  fecha_creacion: string | null
}

/**
 * Lista las inspecciones de la empresa actual, opcionalmente filtradas por
 * un rango de fechas (campo `fecha`, formato YYYY-MM-DD inclusive en ambos
 * extremos). Devuelve las mas recientes primero.
 */
export async function getVehicleInspections(filters?: {
  desde?: string
  hasta?: string
  selectedEmpresaId?: number
}): Promise<{ success: boolean; data: VehicleInspectionRecord[]; error?: string }> {
  try {
    const supabaseAdmin = await getSupabaseAdmin()
    const empresaId = filters?.selectedEmpresaId ?? (await getCurrentEmpresaId()) ?? 1

    let query = supabaseAdmin
      .from("inspeccion_sanitaria_vehiculos")
      .select("*")
      .eq("id_empresa", empresaId)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })

    if (filters?.desde) query = query.gte("fecha", filters.desde)
    if (filters?.hasta) query = query.lte("fecha", filters.hasta)

    const { data, error } = await query

    if (error) {
      console.error("[v0] getVehicleInspections error:", error)
      return { success: false, data: [], error: error.message }
    }

    return { success: true, data: (data as VehicleInspectionRecord[]) || [] }
  } catch (error: any) {
    console.error("[v0] getVehicleInspections unexpected error:", error)
    return { success: false, data: [], error: error?.message || "Error inesperado" }
  }
}
