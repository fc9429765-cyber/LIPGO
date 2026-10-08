"use server"

import { createClient } from "@/lib/supabase-client"
import { SIG_EMPRESA_LIP } from "@/lib/sig-types"
import type { PlanMejoraRow, IndicadorRow } from "@/lib/sst-evidencia-types"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// El Plan de Mejoramiento del SG-SST es de LIP (empresa 100), igual que la
// autoevaluación 0312. LIP es la única empresa que se certifica.
async function resolveEmpresaId(_fromClient?: number | null): Promise<number> {
  return SIG_EMPRESA_LIP
}

// ---------- PLAN DE MEJORAMIENTO (sst_plan_mejora) ----------
export async function listPlanMejora(empresaIdFromClient?: number | null): Promise<PlanMejoraRow[]> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []
  const { data, error } = await supabase
    .from("sst_plan_mejora")
    .select("*")
    .eq("idempresa", empresaId)
    .order("fecha_fin", { ascending: true })
  if (error) {
    console.error("[v0] listPlanMejora:", error.message)
    return []
  }
  return (data ?? []) as PlanMejoraRow[]
}

export async function updatePlanMejora(
  id: number,
  patch: Partial<PlanMejoraRow>,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Plan de Mejoramiento"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const { error } = await supabase.from("sst_plan_mejora").update(patch).eq("id", id)
  return error ? { success: false, message: error.message } : { success: true }
}

export async function createPlanMejora(
  row: Partial<PlanMejoraRow>,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Plan de Mejoramiento"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  const { error } = await supabase.from("sst_plan_mejora").insert([{ ...row, idempresa: empresaId }])
  return error ? { success: false, message: error.message } : { success: true }
}

// ---------------------------------------------------------------------------
// SINCRONIZACION PLAN <-> AUDITORIA 0312
// Crea acciones para los estandares en "no_cumple" que aun no tienen accion,
// y cierra automaticamente las acciones cuyo estandar ya fue subsanado.
// ---------------------------------------------------------------------------
export async function sincronizarPlanConAuditoria(
  empresaIdFromClient?: number | null,
  anio?: number | null,
): Promise<{ success: boolean; message?: string; creadas: number; cerradas: number }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Plan de Mejoramiento"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion, creadas: 0, cerradas: 0 }
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return { success: false, message: "Sin empresa seleccionada", creadas: 0, cerradas: 0 }

  // 1. Autoevaluacion vigente (anio pedido o la mas reciente).
  let aeQuery = supabase.from("sst_autoevaluaciones").select("id").eq("idempresa", empresaId)
  if (anio) aeQuery = aeQuery.eq("anio", anio)
  const { data: ae } = await aeQuery.order("anio", { ascending: false }).limit(1).maybeSingle()
  if (!ae) return { success: false, message: "No hay autoevaluación", creadas: 0, cerradas: 0 }
  const autoevalId = ae.id as number

  // 2. Respuestas (estado actual de cada item) + catalogo de items.
  const [{ data: respuestas }, { data: items }, { data: plan }] = await Promise.all([
    supabase
      .from("sst_autoeval_respuestas")
      .select("item_id,cumple")
      .eq("autoevaluacion_id", autoevalId),
    supabase.from("sst_estandar_items").select("id,numeral,item"),
    supabase
      .from("sst_plan_mejora")
      .select("id,item_id,estado")
      .eq("idempresa", empresaId)
      .eq("autoevaluacion_id", autoevalId),
  ])

  const itemMap = new Map<number, { numeral: string; item: string }>()
  for (const it of items ?? []) itemMap.set(it.id as number, { numeral: it.numeral, item: it.item })

  const noCumpleIds = new Set(
    (respuestas ?? []).filter((r: any) => r.cumple === "no_cumple").map((r: any) => r.item_id as number),
  )
  const planByItem = new Map<number, { id: number; estado: string }>()
  for (const p of plan ?? []) {
    if (p.item_id != null) planByItem.set(p.item_id as number, { id: p.id as number, estado: p.estado })
  }

  // 3. Crear acciones para no_cumple sin accion.
  const nuevas: any[] = []
  for (const itemId of noCumpleIds) {
    if (!planByItem.has(itemId)) {
      const meta = itemMap.get(itemId)
      nuevas.push({
        idempresa: empresaId,
        autoevaluacion_id: autoevalId,
        item_id: itemId,
        hallazgo: `Estándar ${meta?.numeral ?? itemId} en no cumple (autoevaluación 0312)`,
        accion: meta?.item ? `Subsanar: ${meta.item}` : "Definir acción correctiva",
        tipo_accion: "correctiva",
        estado: "abierta",
        avance: 0,
      })
    }
  }
  if (nuevas.length) {
    const { error } = await supabase.from("sst_plan_mejora").insert(nuevas)
    if (error) return { success: false, message: error.message, creadas: 0, cerradas: 0 }
  }

  // 4. Cerrar acciones huerfanas (estandar ya NO esta en no_cumple y la accion sigue abierta).
  let cerradas = 0
  const hoy = new Date().toISOString().slice(0, 10)
  for (const [itemId, p] of planByItem) {
    if (!noCumpleIds.has(itemId) && p.estado !== "cerrada") {
      const { error } = await supabase
        .from("sst_plan_mejora")
        .update({ estado: "cerrada", avance: 100, fecha_fin: hoy })
        .eq("id", p.id)
      if (!error) cerradas++
    }
  }

  return { success: true, creadas: nuevas.length, cerradas }
}

// ---------------------------------------------------------------------------
// Cierra una accion al 100% y, si esta ligada a un estandar, lo pasa a
// "cumple" en la autoevaluacion y recalcula el puntaje (RPC).
// ---------------------------------------------------------------------------
export async function cerrarAccionYActualizarEstandar(
  id: number,
): Promise<{ success: boolean; message?: string; estandarActualizado: boolean }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Plan de Mejoramiento"], "cerrar")
  if (motivoAccion) return { success: false, message: motivoAccion, estandarActualizado: false }
  const supabase = await createClient()

  // 1. Datos de la accion.
  const { data: accion, error: aErr } = await supabase
    .from("sst_plan_mejora")
    .select("id,autoevaluacion_id,item_id")
    .eq("id", id)
    .maybeSingle()
  if (aErr || !accion) return { success: false, message: aErr?.message ?? "Acción no encontrada", estandarActualizado: false }

  // 2. Cerrar la accion.
  const { error: uErr } = await supabase
    .from("sst_plan_mejora")
    .update({ estado: "cerrada", avance: 100, fecha_fin: new Date().toISOString().slice(0, 10) })
    .eq("id", id)
  if (uErr) return { success: false, message: uErr.message, estandarActualizado: false }

  // 3. Si esta ligada a un estandar, pasarlo a "cumple" y recalcular.
  let estandarActualizado = false
  if (accion.autoevaluacion_id && accion.item_id) {
    const { data: item } = await supabase
      .from("sst_estandar_items")
      .select("peso")
      .eq("id", accion.item_id)
      .maybeSingle()
    const peso = Number(item?.peso ?? 0)
    const { error: rErr } = await supabase.from("sst_autoeval_respuestas").upsert(
      {
        autoevaluacion_id: accion.autoevaluacion_id,
        item_id: accion.item_id,
        cumple: "cumple",
        puntaje_obtenido: peso,
      },
      { onConflict: "autoevaluacion_id,item_id" },
    )
    if (!rErr) {
      estandarActualizado = true
      await supabase.rpc("sst_recalcular_autoevaluacion", { p_autoeval_id: accion.autoevaluacion_id })
    }
  }

  return { success: true, estandarActualizado }
}

// ---------- INDICADORES (sst_indicadores) ----------
export async function listIndicadores(empresaIdFromClient?: number | null): Promise<IndicadorRow[]> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []
  const { data, error } = await supabase
    .from("sst_indicadores")
    .select("*")
    .eq("idempresa", empresaId)
    .order("periodo", { ascending: false })
  if (error) {
    console.error("[v0] listIndicadores:", error.message)
    return []
  }
  return (data ?? []) as IndicadorRow[]
}

export async function upsertIndicador(
  row: Partial<IndicadorRow>,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Indicadores SST"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  const { error } = await supabase
    .from("sst_indicadores")
    .upsert([{ ...row, idempresa: empresaId }], { onConflict: "idempresa,periodo,tipo" })
  return error ? { success: false, message: error.message } : { success: true }
}
