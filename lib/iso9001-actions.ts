"use server"

import { createClient } from "@/lib/supabase-client"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/** Estado de cumplimiento de una clausula ISO. */
export type EstadoISO = "cumple" | "parcial" | "documental" | "pendiente"

export interface ClausulaISO {
  id: string
  capitulo: string
  numero: string
  titulo: string
  descripcion: string | null
  codigo_sig: string | null
  fuente_lipgo: string | null
  metrica: string | null
  estado: EstadoISO
  /** Texto legible con el valor calculado de la metrica (ej. "85% (17/20)"). */
  valor: string | null
  /** Estado fijado manualmente; si existe, prevalece sobre el calculado. */
  estadoManual: EstadoISO | null
  /** Estado calculado automaticamente por la metrica (informativo). */
  estadoAuto: EstadoISO
  /** Evidencia adjunta (Supabase Storage). */
  evidenciaUrl: string | null
  evidenciaNombre: string | null
  evidenciaFecha: string | null
  /** Nota libre del responsable. */
  nota: string | null
}

export interface ResumenISO {
  clausulas: ClausulaISO[]
  totales: {
    cumple: number
    parcial: number
    documental: number
    pendiente: number
    total: number
  }
  generado: string
}

/** Umbral para considerar una metrica porcentual como "cumple". */
const UMBRAL_CUMPLE = 80

/**
 * Centro de Evidencia ISO 9001: lee las clausulas configuradas en
 * `iso_clausulas` y, para las que tienen `metrica`, calcula en vivo el
 * grado de cumplimiento contra datos reales de LIPgo. Cada calculo va
 * envuelto en try/catch para que un fallo puntual marque la clausula
 * como "pendiente" sin tumbar todo el reporte.
 */
export async function getResumenISO(): Promise<ResumenISO> {
  const supabase = await createClient()

  // Clausulas base, ordenadas como deben mostrarse. Usamos "*" para incluir
  // las columnas de gestion manual (evidencia_*, estado_manual, nota) que
  // pueden no existir aun si no se ha corrido la migracion.
  const { data: clausulasRaw, error } = await supabase
    .from("iso_clausulas")
    .select("*")
    .order("orden", { ascending: true })

  if (error) {
    console.error("[v0] getResumenISO error leyendo iso_clausulas:", error)
    return {
      clausulas: [],
      totales: { cumple: 0, parcial: 0, documental: 0, pendiente: 0, total: 0 },
      generado: new Date().toISOString(),
    }
  }

  const clausulas: ClausulaISO[] = []

  for (const c of clausulasRaw || []) {
    let estado: EstadoISO = "documental"
    let valor: string | null = null

    if (!c.metrica) {
      // Clausula soportada de forma documental: la prueba es el documento
      // del SIG y/o la fuente declarada en LIPgo.
      estado = "documental"
      valor = c.codigo_sig || c.fuente_lipgo || null
    } else {
      try {
        switch (c.metrica) {
          case "headcount_docs": {
            // % de colaboradores con contrato, examenes de ingreso y
            // afiliacion ARL no vacios (clausula 7.2 - competencia).
            const { data, error: e } = await supabase
              .from("headcount")
              .select("contrato,examenes_ing,afiliacion_arl")
            if (e) throw e
            const total = data?.length || 0
            const completos = (data || []).filter(
              (r) =>
                !esVacio(r.contrato) &&
                !esVacio(r.examenes_ing) &&
                !esVacio(r.afiliacion_arl),
            ).length
            const pct = total > 0 ? Math.round((completos / total) * 100) : 0
            valor = `${pct}% (${completos}/${total})`
            estado = clasificarPct(pct)
            break
          }
          case "inducciones": {
            // headcount_id DISTINTOS con al menos un intento aprobado, sobre
            // el total de colaboradores (clausula 7.3 - toma de conciencia).
            const { data: intentos, error: e1 } = await supabase
              .from("capacitaciones_evaluacion_intentos")
              .select("headcount_id")
              .eq("aprobado", true)
            if (e1) throw e1
            const aprobados = new Set(
              (intentos || [])
                .map((r) => r.headcount_id)
                .filter((id) => id != null),
            ).size
            const { count: totalHc, error: e2 } = await supabase
              .from("headcount")
              .select("*", { count: "exact", head: true })
            if (e2) throw e2
            const total = totalHc || 0
            const pct = total > 0 ? Math.round((aprobados / total) * 100) : 0
            valor = `${pct}% (${aprobados}/${total})`
            estado = clasificarPct(pct)
            break
          }
          case "documentos": {
            const { count, error: e } = await supabase
              .from("sig_documentos")
              .select("*", { count: "exact", head: true })
            if (e) throw e
            valor = `${count || 0} documentos`
            estado = (count || 0) > 0 ? "cumple" : "pendiente"
            break
          }
          case "bascula": {
            const { count, error: e } = await supabase
              .from("bascula")
              .select("*", { count: "exact", head: true })
            if (e) throw e
            valor = `${count || 0} registros`
            estado = (count || 0) > 0 ? "cumple" : "pendiente"
            break
          }
          case "operacion": {
            const { count: asistencia, error: e1 } = await supabase
              .from("registroasistencia")
              .select("*", { count: "exact", head: true })
            if (e1) throw e1
            const { count: bascula, error: e2 } = await supabase
              .from("bascula")
              .select("*", { count: "exact", head: true })
            if (e2) throw e2
            const total = (asistencia || 0) + (bascula || 0)
            valor = `${total} registros operativos`
            estado = total > 0 ? "cumple" : "pendiente"
            break
          }
          default: {
            // Metrica desconocida: la tratamos como soporte documental.
            estado = "documental"
            valor = c.codigo_sig || c.fuente_lipgo || null
          }
        }
      } catch (err) {
        console.error(`[v0] getResumenISO metrica "${c.metrica}" fallo:`, err)
        estado = "pendiente"
        valor = "No disponible"
      }
    }

    // Estado manual (si esta fijado) prevalece sobre el calculo automatico.
    const estadosValidos: EstadoISO[] = ["cumple", "parcial", "documental", "pendiente"]
    const estadoManual = estadosValidos.includes(c.estado_manual as EstadoISO)
      ? (c.estado_manual as EstadoISO)
      : null
    const estadoFinal = estadoManual ?? estado

    clausulas.push({
      id: c.id,
      capitulo: c.capitulo,
      numero: c.numero,
      titulo: c.titulo,
      descripcion: c.descripcion ?? null,
      codigo_sig: c.codigo_sig ?? null,
      fuente_lipgo: c.fuente_lipgo ?? null,
      metrica: c.metrica ?? null,
      estado: estadoFinal,
      valor,
      estadoManual,
      estadoAuto: estado,
      evidenciaUrl: c.evidencia_url ?? null,
      evidenciaNombre: c.evidencia_nombre ?? null,
      evidenciaFecha: c.evidencia_fecha ?? null,
      nota: c.nota ?? null,
    })
  }

  const totales = {
    cumple: clausulas.filter((c) => c.estado === "cumple").length,
    parcial: clausulas.filter((c) => c.estado === "parcial").length,
    documental: clausulas.filter((c) => c.estado === "documental").length,
    pendiente: clausulas.filter((c) => c.estado === "pendiente").length,
    total: clausulas.length,
  }

  return { clausulas, totales, generado: new Date().toISOString() }
}

/**
 * Actualiza el estado gestionado manualmente de una clausula. Pasar
 * `null` para volver al estado calculado automaticamente.
 */
export async function setEstadoManualISO(
  id: string,
  estado: EstadoISO | null,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Centro de Evidencia ISO 9001", "Repositorio ISO 9001"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!id) return { success: false, error: "ID requerido" }
  const estadosValidos: EstadoISO[] = ["cumple", "parcial", "documental", "pendiente"]
  if (estado !== null && !estadosValidos.includes(estado)) {
    return { success: false, error: "Estado no válido" }
  }
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("iso_clausulas")
      .update({ estado_manual: estado, actualizado_en: new Date().toISOString() })
      .eq("id", id)
    if (error) throw error
    return { success: true }
  } catch (err: any) {
    console.error("[v0] setEstadoManualISO error:", err)
    return { success: false, error: err?.message || "No se pudo actualizar el estado" }
  }
}

/**
 * Edita los campos base de una clausula: requisito (titulo), prueba/fuente
 * (fuente_lipgo) y documento del SIG (codigo_sig). Son columnas que siempre
 * existen, por lo que la edicion funciona sin migraciones adicionales.
 */
export async function updateClausulaISO(
  id: string,
  campos: { titulo?: string; fuente_lipgo?: string | null; codigo_sig?: string | null },
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Centro de Evidencia ISO 9001", "Repositorio ISO 9001"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!id) return { success: false, error: "ID requerido" }
  if (campos.titulo !== undefined && !campos.titulo.trim()) {
    return { success: false, error: "El requisito no puede quedar vacío" }
  }
  try {
    const supabase = await createClient()
    const patch: Record<string, unknown> = {}
    if (campos.titulo !== undefined) patch.titulo = campos.titulo.trim()
    if (campos.fuente_lipgo !== undefined) patch.fuente_lipgo = campos.fuente_lipgo?.trim() || null
    if (campos.codigo_sig !== undefined) patch.codigo_sig = campos.codigo_sig?.trim() || null
    if (Object.keys(patch).length === 0) return { success: true }

    const { error } = await supabase.from("iso_clausulas").update(patch).eq("id", id)
    if (error) throw error
    return { success: true }
  } catch (err: any) {
    console.error("[v0] updateClausulaISO error:", err)
    return { success: false, error: err?.message || "No se pudo actualizar la cláusula" }
  }
}

/** Guarda una nota libre del responsable para una clausula. */
export async function setNotaISO(
  id: string,
  nota: string,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Centro de Evidencia ISO 9001", "Repositorio ISO 9001"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!id) return { success: false, error: "ID requerido" }
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("iso_clausulas")
      .update({ nota: nota || null, actualizado_en: new Date().toISOString() })
      .eq("id", id)
    if (error) throw error
    return { success: true }
  } catch (err: any) {
    console.error("[v0] setNotaISO error:", err)
    return { success: false, error: err?.message || "No se pudo guardar la nota" }
  }
}

/**
 * Registra (o reemplaza) la evidencia adjunta de una clausula tras subir
 * el archivo a Supabase Storage. El upload se hace en el route handler
 * `/api/iso9001/upload`; aqui solo persistimos los metadatos.
 */
export async function setEvidenciaISO(
  id: string,
  evidencia: { url: string; path: string; nombre: string },
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Centro de Evidencia ISO 9001", "Repositorio ISO 9001"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!id) return { success: false, error: "ID requerido" }
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("iso_clausulas")
      .update({
        evidencia_url: evidencia.url,
        evidencia_path: evidencia.path,
        evidencia_nombre: evidencia.nombre,
        evidencia_fecha: new Date().toISOString(),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", id)
    if (error) throw error
    return { success: true }
  } catch (err: any) {
    console.error("[v0] setEvidenciaISO error:", err)
    return { success: false, error: err?.message || "No se pudo registrar la evidencia" }
  }
}

/** Considera vacio null, undefined o string en blanco. */
function esVacio(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "")
}

/** Clasifica un porcentaje: >=80 cumple, >=40 parcial, resto pendiente. */
function clasificarPct(pct: number): EstadoISO {
  if (pct >= UMBRAL_CUMPLE) return "cumple"
  if (pct >= 40) return "parcial"
  return "pendiente"
}
