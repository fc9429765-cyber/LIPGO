"use server"

import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert, getCurrentUsuarioForInsert } from "@/lib/user-context"
import { motivoSinAccion } from "@/lib/puerta-modulo"

export interface Antecedente {
  id: string
  idempresa: number
  hoja_vida_id: string | null
  cedula: string | null
  nombre: string
  policia_url: string | null
  policia_nombre: string | null
  procuraduria_url: string | null
  procuraduria_nombre: string | null
  contraloria_url: string | null
  contraloria_nombre: string | null
  created_at: string
  // Decisión + consulta Compliance (columnas nuevas, ver 046_add_antecedentes_decision.sql).
  estado?: "pendiente" | "aceptado" | "rechazado" | null
  compliance_pdf_url?: string | null
  compliance_pdf_nombre?: string | null
  id_dato_consultado?: number | null
  score_riesgo?: number | null
  presenta_riesgo?: boolean | null
  pep?: boolean | null
  decidido_por?: string | null
  decidido_en?: string | null
}

// Lista los antecedentes de la empresa seleccionada (o la de sesion).
export async function getAntecedentes(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

  const { data, error } = await supabase
    .from("antecedentes")
    .select("*")
    .eq("idempresa", empresaId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching antecedentes:", error)
    return { success: false, data: [] as Antecedente[], message: error.message }
  }

  return { success: true, data: (data || []) as Antecedente[] }
}

// SINCRONIZAR desde Head Count: los colaboradores antiguos YA tienen su documento
// de antecedentes cargado en Head Count (columna antecedentes = URL). Esta acción
// lo trae al submódulo de Antecedentes sin re-subir. Head Count guarda UN documento
// consolidado → se referencia en el slot principal (policía); los otros dos quedan
// para carga separada si el cliente maneja certificados independientes.
// Idempotente por cédula: crea los que faltan y actualiza el documento de los que ya están.
export async function sincronizarAntecedentesDesdeHeadcount(selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Antecedentes", "Gestión de Solicitudes"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const admin: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return { success: false, creadas: 0, actualizadas: 0, message: "Sin empresa seleccionada." }

  const { data: hc, error: eHc } = await admin
    .from("headcount")
    .select("identificacion,nombre,antecedentes")
    .eq("idempresa", empresaId)
    .not("antecedentes", "is", null)
  if (eHc) return { success: false, creadas: 0, actualizadas: 0, message: eHc.message }

  const { data: exist } = await admin.from("antecedentes").select("id,cedula").eq("idempresa", empresaId)
  const byCedula = new Map<string, string>()
  for (const a of exist ?? []) if (a.cedula) byCedula.set(String(a.cedula).trim(), a.id)

  let actualizadas = 0
  const nuevas: any[] = []
  for (const c of hc ?? []) {
    const url = c.antecedentes as string
    if (!url) continue
    const ced = c.identificacion ? String(c.identificacion).trim() : ""
    const existingId = ced ? byCedula.get(ced) : undefined
    const doc = { policia_url: url, policia_nombre: "Antecedentes (Head Count)" }
    if (existingId) {
      const { error } = await admin.from("antecedentes").update(doc).eq("id", existingId)
      if (!error) actualizadas++
    } else {
      nuevas.push({ idempresa: empresaId, hoja_vida_id: null, cedula: ced || null, nombre: c.nombre, ...doc })
    }
  }
  if (nuevas.length) {
    const { error } = await admin.from("antecedentes").insert(nuevas)
    if (error) return { success: false, creadas: 0, actualizadas, message: error.message }
  }
  return { success: true, creadas: nuevas.length, actualizadas }
}

// Verifica el código de acceso que protege la Investigación en Compliance.
// El código vive solo en el servidor (process.env.COMPLIANCE_ACCESS_CODE).
export async function verificarCodigoCompliance(codigo: string): Promise<{ ok: boolean }> {
  const expected = process.env.COMPLIANCE_ACCESS_CODE
  return { ok: !!expected && String(codigo || "") === expected }
}

// DECISIÓN de antecedentes (aceptar/rechazar) tras la consulta Compliance.
// - Genera/actualiza el registro en `antecedentes` (por idempresa+cédula) con el
//   PDF Completo y el score de la consulta.
// - Propaga el PDF a la HOJA DE VIDA de la persona (columna antecedentes_url) para
//   que quede visible en ese módulo.
// - Si es RECHAZO, marca la hoja de vida como rechazada (bloquea contratación).
export async function decidirAntecedente(payload: {
  empresaId?: number | null
  cedula: string
  nombre?: string | null
  hojaVidaId?: string | null
  idDatoConsultado?: number | null
  scoreRiesgo?: number | null
  presentaRiesgo?: boolean | null
  pep?: boolean | null
  pdfUrl?: string | null
  pdfNombre?: string | null
  estado: "aceptado" | "rechazado"
}) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Antecedentes", "Gestión de Solicitudes"], "aprobar", "Decidir antecedente")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const admin: any = await getSupabaseAdmin()
  const empresaId = payload.empresaId || (await getCurrentEmpresaIdForInsert())
  const cedula = String(payload.cedula || "").trim()
  if (!empresaId) return { success: false, message: "Sin empresa seleccionada." }
  if (!cedula) return { success: false, message: "Falta la cédula." }

  const usuario = await getCurrentUsuarioForInsert()
  const nombrePdf = payload.pdfNombre || `Antecedentes ${cedula}.pdf`

  // 1) Registro de antecedentes (upsert manual por idempresa+cédula).
  const doc: Record<string, any> = {
    idempresa: empresaId,
    cedula,
    nombre: payload.nombre || cedula,
    estado: payload.estado,
    compliance_pdf_url: payload.pdfUrl || null,
    compliance_pdf_nombre: nombrePdf,
    id_dato_consultado: payload.idDatoConsultado ?? null,
    score_riesgo: payload.scoreRiesgo ?? null,
    presenta_riesgo: payload.presentaRiesgo ?? null,
    pep: payload.pep ?? null,
    decidido_por: usuario,
    decidido_en: new Date().toISOString(),
  }
  if (payload.hojaVidaId) doc.hoja_vida_id = payload.hojaVidaId

  const { data: exist } = await admin
    .from("antecedentes")
    .select("id")
    .eq("idempresa", empresaId)
    .eq("cedula", cedula)
    .limit(1)
  const existingId = exist?.[0]?.id
  if (existingId) {
    const { error } = await admin.from("antecedentes").update(doc).eq("id", existingId)
    if (error) return { success: false, message: error.message }
  } else {
    const { error } = await admin.from("antecedentes").insert(doc)
    if (error) return { success: false, message: error.message }
  }

  // 2) Propagar a la HOJA DE VIDA por cédula (no pisa el CV: columnas propias).
  const hvUpdate: Record<string, any> = {
    antecedentes_url: payload.pdfUrl || null,
    antecedentes_nombre: nombrePdf,
    antecedentes_estado: payload.estado,
    antecedentes_score: payload.scoreRiesgo ?? null,
  }
  // El rechazo bloquea contratación: marca la hoja como rechazada (igual que exámenes).
  if (payload.estado === "rechazado") hvUpdate.estado = "rechazado"
  await admin.from("hojas_de_vida").update(hvUpdate).eq("idempresa", empresaId).eq("cedula", cedula)

  return { success: true }
}

// Elimina un antecedente (archivos en Supabase Storage + registro).
export async function deleteAntecedente(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Antecedentes", "Gestión de Solicitudes"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { data: current } = await supabase
    .from("antecedentes")
    .select("policia_url, procuraduria_url, contraloria_url")
    .eq("id", id)
    .maybeSingle()

  // Borramos los archivos del bucket "archivos" (si falla no interrumpimos el
  // borrado del registro). Derivamos la ruta interna desde la URL publica.
  if (current) {
    const marker = "/object/public/archivos/"
    const urls = [current.policia_url, current.procuraduria_url, current.contraloria_url].filter(
      Boolean,
    ) as string[]
    const paths = urls
      .map((u) => {
        const idx = u.indexOf(marker)
        return idx !== -1 ? decodeURIComponent(u.slice(idx + marker.length)) : null
      })
      .filter(Boolean) as string[]
    if (paths.length > 0) {
      try {
        const supabaseAdmin = await getSupabaseAdmin()
        await supabaseAdmin.storage.from("archivos").remove(paths)
      } catch (err: any) {
        console.error("[v0] Error eliminando archivos de antecedentes:", err?.message || err)
      }
    }
  }

  const { error } = await supabase.from("antecedentes").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting antecedente:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}
