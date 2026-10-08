"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { getCurrentUser } from "@/lib/auth-actions"
import { liquidable } from "@/lib/nomina-calculo-utils"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/**
 * Evaluaciones de Desempeno - server actions
 *
 * Esquema real en Supabase (ver scripts):
 *  - headcount: id (bigint), idempresa (smallint), nombre, cargo, estado, identificacion
 *  - profiles: id (uuid), usuario, empresa_id
 *  - evaluaciones_desempeno:
 *      id                       uuid primary key
 *      colaborador_id           bigint FK -> headcount(id)
 *      idempresa                smallint FK -> empresas(id)
 *      evaluador_id             uuid FK -> auth.users(id)
 *      p1..p12                  integer (1-5)
 *      p13..p16                 text
 *      comentarios_adicionales  text
 *      firma_coordinador        text
 *      puntaje_total            numeric
 *      porcentaje_riesgo        numeric
 *      created_at               timestamptz
 */

export interface ColaboradorConEvaluacion {
  id: number
  idempresa: number
  nombre: string
  cargo: string | null
  estado: string | null
  identificacion: string | null
  ultima_evaluacion: string | null
  // Fecha de ingreso del colaborador (headcount.fechainicio). Sirve para
  // calcular la primera evaluacion (ingreso + 1 mes).
  fecha_inicio: string | null
}

export interface EvaluacionPayload {
  colaborador_id: number
  idempresa: number
  p1_seguridad_normas: number
  p2_seguridad_conducta: number
  p3_productividad_metas: number
  p4_productividad_ritmo: number
  p5_calidad_mercancia: number
  p6_calidad_precision: number
  p7_disciplina_puntualidad: number
  p8_disciplina_asistencia: number
  p9_disciplina_instrucciones: number
  p10_actitud_equipo: number
  p11_actitud_disposicion: number
  p12_actitud_proactividad: number
  p13_continuidad: string
  p14_nivel_riesgo: string
  p15_decision_sugerida: string
  p16_recontrataria: string
  comentarios_adicionales: string
  firma_coordinador: string
}

/**
 * Lista de colaboradores con la fecha de su ultima evaluacion.
 * Aplica el filtro de empresa de la barra superior.
 */
export async function getColaboradoresConUltimaEvaluacion(
  selectedEmpresaId?: number | null,
): Promise<{ success: boolean; data: ColaboradorConEvaluacion[]; error?: string }> {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    if (!empresaId) {
      return { success: false, data: [], error: "No se pudo determinar la empresa" }
    }

    // Listado base de colaboradores para el modulo de Evaluaciones de
    // Desempeño. Reglas de presentacion (requerimiento de negocio):
    //   1) Orden DESCENDENTE por `fechainicio` para ver primero los
    //      ingresos mas recientes. Los nulos van al final (nullsFirst:
    //      false) para no "secuestrar" la cabecera del listado.
    //   2) Excluimos colaboradores cuyo `nombre` contiene "PRUEBA"
    //      (case-insensitive con ilike + comodines) — son registros
    //      tecnicos/QA que no deben aparecer en la operacion real de
    //      evaluaciones.
    //   3) Filtro por empresa (como antes).
    //   4) Solo personal ACTIVO Y CONTRATADO: `liquidable()`
    //      (lib/nomina-calculo-utils, misma regla que nómina — estado !=
    //      inactivo, sin fecha_retiro, con contratosiigo) + fuera el
    //      placeholder literal "SIN AUXILIAR" (no es una persona). Mismo
    //      criterio en todos los ID, igual que /api/evaluaciones-alerts.
    //      Antes los retirados seguian apareciendo como "pendientes"
    //      (casos reales: FELIPE PEREZ VEGA, JUAN DAVID GAMEZ TATIS, ID1).
    //
    // Traemos `fechainicio` aunque el shape publico de
    // ColaboradorConEvaluacion no lo exponga (no rompe nada: el .map de
    // abajo solo proyecta los campos del contrato).
    const { data: headcountRaw, error: errHeadcount } = await supabase
      .from("headcount")
      .select("id, idempresa, nombre, cargo, estado, identificacion, fechainicio, contratosiigo, fecha_retiro")
      .eq("idempresa", empresaId)
      .not("nombre", "ilike", "%PRUEBA%")
      .order("fechainicio", { ascending: false, nullsFirst: false })

    if (errHeadcount) {
      return { success: false, data: [], error: errHeadcount.message }
    }

    const headcount = (headcountRaw || []).filter(
      (h) => liquidable(h) && h.nombre?.trim().toUpperCase() !== "SIN AUXILIAR",
    )

    const ids = (headcount || []).map((h) => h.id)
    if (ids.length === 0) {
      return { success: true, data: [] }
    }

    const { data: evaluaciones, error: errEval } = await supabase
      .from("evaluaciones_desempeno")
      .select("colaborador_id, created_at")
      .in("colaborador_id", ids)
      .order("created_at", { ascending: false })

    if (errEval) {
      console.warn("[v0] evaluaciones_desempeno no disponible:", errEval.message)
    }

    const ultimaPorColaborador = new Map<number, string>()
    for (const ev of evaluaciones || []) {
      if (!ultimaPorColaborador.has(ev.colaborador_id)) {
        ultimaPorColaborador.set(ev.colaborador_id, ev.created_at)
      }
    }

    return {
      success: true,
      data: (headcount || []).map((h) => ({
        id: h.id,
        idempresa: h.idempresa,
        nombre: h.nombre,
        cargo: h.cargo,
        estado: h.estado,
        identificacion: h.identificacion,
        ultima_evaluacion: ultimaPorColaborador.get(h.id) ?? null,
        fecha_inicio: (h as any).fechainicio ?? null,
      })),
    }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Crea una nueva evaluacion y registra el evaluador_id (usuario logueado).
 */
export async function createEvaluacionDesempeno(
  payload: EvaluacionPayload,
): Promise<{ success: boolean; id?: string; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Evaluaciones de Desempeño"], "crear", "Evaluar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()

    const puntajes = [
      payload.p1_seguridad_normas,
      payload.p2_seguridad_conducta,
      payload.p3_productividad_metas,
      payload.p4_productividad_ritmo,
      payload.p5_calidad_mercancia,
      payload.p6_calidad_precision,
      payload.p7_disciplina_puntualidad,
      payload.p8_disciplina_asistencia,
      payload.p9_disciplina_instrucciones,
      payload.p10_actitud_equipo,
      payload.p11_actitud_disposicion,
      payload.p12_actitud_proactividad,
    ]
    const puntaje_total = puntajes.reduce((a, b) => a + b, 0)
    const porcentaje_riesgo = Math.round(((60 - puntaje_total) / 60) * 100)

    // evaluador_id es uuid FK a auth.users: usamos el id del usuario autenticado
    let evaluador_id: string | null = null
    try {
      const user = await getCurrentUser()
      evaluador_id = user?.id ?? null
    } catch {
      evaluador_id = null
    }

    const { data, error } = await supabase
      .from("evaluaciones_desempeno")
      .insert({
        ...payload,
        puntaje_total,
        porcentaje_riesgo,
        evaluador_id,
      })
      .select("id")
      .single()

    if (error) {
      console.error("[v0] Error creating evaluacion:", error)
      return { success: false, error: error.message }
    }

    return { success: true, id: data?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Fila del listado global de evaluaciones (join con headcount y profiles).
 */
export interface EvaluacionConColaborador {
  id: string
  created_at: string
  puntaje_total: number | null
  porcentaje_riesgo: number | null
  evaluador_id: string | null
  evaluador_nombre: string | null
  colaborador_id: number
  colaborador_nombre: string
  colaborador_cargo: string | null
  colaborador_identificacion: string | null
}

/**
 * Detalle completo de una evaluacion (para el dialogo "Ver detalle" y para re-generar el PDF).
 */
export interface EvaluacionDetalle {
  id: string
  created_at: string
  colaborador_id: number
  idempresa: number
  evaluador_id: string | null
  evaluador_nombre: string | null
  p1_seguridad_normas: number
  p2_seguridad_conducta: number
  p3_productividad_metas: number
  p4_productividad_ritmo: number
  p5_calidad_mercancia: number
  p6_calidad_precision: number
  p7_disciplina_puntualidad: number
  p8_disciplina_asistencia: number
  p9_disciplina_instrucciones: number
  p10_actitud_equipo: number
  p11_actitud_disposicion: number
  p12_actitud_proactividad: number
  p13_continuidad: string | null
  p14_nivel_riesgo: string | null
  p15_decision_sugerida: string | null
  p16_recontrataria: string | null
  comentarios_adicionales: string | null
  firma_coordinador: string | null
  puntaje_total: number | null
  porcentaje_riesgo: number | null
}

/**
 * Lista TODAS las evaluaciones de la empresa seleccionada con los datos del colaborador
 * y el nombre del evaluador (profile.usuario). Ordenadas por created_at desc.
 *
 * Importante: el select directo con join anidado a headcount/profiles requiere que
 * PostgREST detecte las FKs. Como el headcount-FK sí existe pero profiles no es
 * FK directa de evaluador_id (evaluador_id apunta a auth.users, no a profiles),
 * hacemos la consulta en dos pasos: primero las evaluaciones + headcount, luego
 * resolvemos los nombres de evaluador contra la tabla profiles por lote.
 */
export async function getAllEvaluacionesDetalladas(
  selectedEmpresaId?: number | null,
): Promise<{ success: boolean; data: EvaluacionConColaborador[]; error?: string }> {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    console.log("[v0] getAllEvaluacionesDetalladas - empresaId:", empresaId)

    if (!empresaId) {
      return { success: false, data: [], error: "No se pudo determinar la empresa" }
    }

    const { data, error } = await supabase
      .from("evaluaciones_desempeno")
      .select(
        "id, created_at, puntaje_total, porcentaje_riesgo, evaluador_id, colaborador_id, headcount:colaborador_id ( nombre, cargo, identificacion )",
      )
      .eq("idempresa", empresaId)
      .order("created_at", { ascending: false })

    console.log("[v0] evaluaciones_desempeno filas:", data?.length ?? 0)

    if (error) {
      console.error("[v0] Error fetching all evaluaciones:", error)
      return { success: false, data: [], error: error.message }
    }

    const rows = data || []

    // Resolver evaluador_nombre desde profiles.usuario en un segundo paso (batch)
    const evaluadorIds = Array.from(
      new Set(rows.map((r: any) => r.evaluador_id).filter(Boolean)),
    ) as string[]
    const evaluadorMap = new Map<string, string>()
    if (evaluadorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, usuario")
        .in("id", evaluadorIds)
      for (const p of profiles || []) {
        if (p.id && p.usuario) evaluadorMap.set(p.id, p.usuario)
      }
    }

    return {
      success: true,
      data: rows.map((r: any) => {
        const hc = Array.isArray(r.headcount) ? r.headcount[0] : r.headcount
        return {
          id: r.id,
          created_at: r.created_at,
          puntaje_total: r.puntaje_total ?? null,
          porcentaje_riesgo: r.porcentaje_riesgo ?? null,
          evaluador_id: r.evaluador_id ?? null,
          evaluador_nombre: r.evaluador_id ? evaluadorMap.get(r.evaluador_id) ?? null : null,
          colaborador_id: r.colaborador_id,
          colaborador_nombre: hc?.nombre || "(sin nombre)",
          colaborador_cargo: hc?.cargo || null,
          colaborador_identificacion: hc?.identificacion || null,
        }
      }),
    }
  } catch (err: any) {
    console.error("[v0] getAllEvaluacionesDetalladas exception:", err)
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Obtiene el detalle completo de una evaluacion por id (uuid).
 */
export async function getEvaluacionById(
  evaluacionId: string,
): Promise<{ success: boolean; data?: EvaluacionDetalle; error?: string }> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("evaluaciones_desempeno")
      .select("*")
      .eq("id", evaluacionId)
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    // Resolver nombre del evaluador
    let evaluador_nombre: string | null = null
    if (data?.evaluador_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("usuario")
        .eq("id", data.evaluador_id)
        .maybeSingle()
      evaluador_nombre = profile?.usuario ?? null
    }

    return { success: true, data: { ...(data as any), evaluador_nombre } }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Datos basicos de un colaborador para la cabecera del formulario.
 */
export async function getColaboradorBasico(
  colaboradorId: number,
): Promise<{ success: boolean; data?: { id: number; nombre: string; cargo: string | null; idempresa: number }; error?: string }> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("headcount")
      .select("id, nombre, cargo, idempresa")
      .eq("id", colaboradorId)
      .single()

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}
