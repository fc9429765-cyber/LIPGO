"use server"

import { createClient } from "@/lib/supabase-client"
import { SIG_EMPRESA_LIP } from "@/lib/sig-types"
import type {
  Autoevaluacion,
  AuditoriaData,
  AuditoriaEstandarRow,
  CicloResumen,
  EstadoCumple,
  EstandarItem,
  MatrizData,
  Respuesta,
} from "@/lib/sst-types"
import { computar0312, valoracionFromPct } from "@/lib/sst-types"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// El SG-SST (Resolución 0312) es ÚNICO de LIP (empresa 100). LIP es la única
// empresa que se certifica; los ID 1-4 son proyectos/clientes donde LIP presta
// el servicio con LIPgo. Por eso el módulo ignora el selector de cliente a
// propósito y siempre opera a nivel LIP.
async function resolveEmpresaId(_empresaIdFromClient?: number | null): Promise<number> {
  return SIG_EMPRESA_LIP
}

// ---------------------------------------------------------------------------
// Selector de autoevaluacion: trae la del anio pedido (o la mas reciente).
// ---------------------------------------------------------------------------
async function getAutoevaluacion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: number,
  anio?: number | null,
): Promise<{ autoevaluacion: Autoevaluacion | null; aniosDisponibles: number[] }> {
  // Autoevaluación ÚNICA de LIP. No se filtra por empresa (LIP es la única
  // empresa que se certifica); así funciona antes y después de re-etiquetar la
  // autoevaluación a alcance LIP (100). El parámetro empresaId se conserva por
  // compatibilidad de firma pero no se usa para filtrar.
  void empresaId
  const { data: anios } = await supabase
    .from("sst_autoevaluaciones")
    .select("anio")
    .order("anio", { ascending: false })

  const aniosDisponibles = Array.from(new Set((anios ?? []).map((a: any) => a.anio as number)))

  let query = supabase.from("sst_autoevaluaciones").select("*")
  if (anio) query = query.eq("anio", anio)
  const { data, error } = await query.order("anio", { ascending: false }).limit(1).maybeSingle()

  if (error) {
    console.error("[v0] Error fetching autoevaluacion:", error.message)
    return { autoevaluacion: null, aniosDisponibles }
  }
  return { autoevaluacion: (data as Autoevaluacion) ?? null, aniosDisponibles }
}

async function getPorCiclo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  autoevalId: number,
): Promise<CicloResumen[]> {
  const { data, error } = await supabase
    .from("v_sst_autoeval_por_ciclo")
    .select("*")
    .eq("autoevaluacion_id", autoevalId)
  if (error) {
    console.error("[v0] Error fetching por ciclo:", error.message)
    return []
  }
  return (data ?? []) as CicloResumen[]
}

// ---------------------------------------------------------------------------
// P01 — Matriz de los 60 estandares minimos
// ---------------------------------------------------------------------------
export async function getMatrizEstandares(
  empresaIdFromClient?: number | null,
  anio?: number | null,
): Promise<MatrizData> {
  const empty: MatrizData = {
    autoevaluacion: null,
    items: [],
    respuestas: [],
    porCiclo: [],
    aniosDisponibles: [],
  }
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return empty

  // Catalogo fijo de 60 items (no depende de empresa).
  const { data: items, error: itemsError } = await supabase
    .from("sst_estandar_items")
    .select("*")
    .order("numeral", { ascending: true })
  if (itemsError) {
    console.error("[v0] Error fetching estandar items:", itemsError.message)
    return empty
  }

  const { autoevaluacion, aniosDisponibles } = await getAutoevaluacion(supabase, empresaId, anio)

  let respuestas: Respuesta[] = []
  let porCiclo: CicloResumen[] = []
  if (autoevaluacion) {
    const { data: resp } = await supabase
      .from("sst_autoeval_respuestas")
      .select("*")
      .eq("autoevaluacion_id", autoevaluacion.id)
    respuestas = (resp ?? []) as Respuesta[]
    porCiclo = await getPorCiclo(supabase, autoevaluacion.id)
  }

  // CABLEADO de los numerales de MEDICIÓN (3.3.1-3.3.6) con sst_indicadores:
  // si el indicador correspondiente tiene datos del año de la autoevaluación,
  // el estándar se AUTO-MARCA «cumple» (se está midiendo) y se expone el valor.
  // El override es EN VIVO (no se persiste): refleja el estado real de medición.
  const medicion: Record<string, { tipo: string; valor: number | null; meta: number | null; nombre: string | null }> = {}
  if (autoevaluacion?.anio) {
    const NUMERAL_TIPO: Record<string, string> = {
      "3.3.1": "severidad_at",
      "3.3.2": "frecuencia_at",
      "3.3.3": "mortalidad_at",
      "3.3.4": "prevalencia_el",
      "3.3.5": "incidencia_el",
      "3.3.6": "ausentismo",
    }
    const anioStr = String(autoevaluacion.anio)
    const { data: inds } = await supabase
      .from("sst_indicadores")
      .select("tipo, valor, meta, periodo, observacion")
      .eq("idempresa", empresaId)
      .like("periodo", `${anioStr}%`)
    // Por tipo: preferir el consolidado anual (periodo == año), si no, cualquiera.
    const byTipo = new Map<string, any>()
    for (const r of inds ?? []) {
      if (r.periodo === anioStr) byTipo.set(r.tipo, r)
      else if (!byTipo.has(r.tipo)) byTipo.set(r.tipo, r)
    }
    const itemByNumeral = new Map((items ?? []).map((it: any) => [it.numeral, it]))
    const respByItem = new Map(respuestas.map((r) => [r.item_id, r]))
    for (const [num, tipo] of Object.entries(NUMERAL_TIPO)) {
      const ind = byTipo.get(tipo)
      const it: any = itemByNumeral.get(num)
      if (!it || !ind || ind.valor == null) continue
      medicion[num] = { tipo, valor: ind.valor, meta: ind.meta, nombre: ind.observacion }
      // Auto-cumple en vivo.
      const existing = respByItem.get(it.id)
      if (existing) existing.cumple = "cumple"
      else
        respuestas.push({
          autoevaluacion_id: autoevaluacion.id,
          item_id: it.id,
          cumple: "cumple",
          puntaje_obtenido: it.peso,
          observacion: "Auto: indicador medido",
          soporte_url: null,
        } as Respuesta)
    }
  }

  return {
    autoevaluacion,
    items: (items ?? []) as EstandarItem[],
    respuestas,
    porCiclo,
    aniosDisponibles,
    medicion,
  }
}

// Guarda (upsert) la respuesta de un item y recalcula la autoevaluacion.
export async function guardarRespuesta(input: {
  autoevaluacion_id: number
  item_id: number
  cumple: EstadoCumple
  peso: number
  observacion?: string | null
  soporte_url?: string | null
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Matriz de Estándares", "Auditoría 0312"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  // Art. 27: "cumple" y "no_aplica" suman el peso; "no_cumple" suma 0.
  const puntaje = input.cumple === "no_cumple" ? 0 : input.peso

  const { error } = await supabase.from("sst_autoeval_respuestas").upsert(
    {
      autoevaluacion_id: input.autoevaluacion_id,
      item_id: input.item_id,
      cumple: input.cumple,
      puntaje_obtenido: puntaje,
      observacion: input.observacion ?? null,
      soporte_url: input.soporte_url ?? null,
    },
    { onConflict: "autoevaluacion_id,item_id" },
  )
  if (error) {
    console.error("[v0] Error upserting respuesta:", error.message)
    return { success: false, message: error.message }
  }

  // Recalcular y PERSISTIR el puntaje_total + valoracion con el cálculo OFICIAL
  // (Art. 27: cumple y no_aplica suman peso; no_cumple = 0). NO se usa el RPC
  // `sst_recalcular_autoevaluacion` porque cuenta el `no_aplica` como 0 (bug que
  // desalineaba la Auditoría 0312 vs la Matriz de 60). Fuente única: computar0312.
  try {
    const { data: its } = await supabase.from("sst_estandar_items").select("id, ciclo, peso")
    const { data: resp } = await supabase
      .from("sst_autoeval_respuestas")
      .select("item_id, cumple")
      .eq("autoevaluacion_id", input.autoevaluacion_id)
    const { pct } = computar0312((its ?? []) as any, (resp ?? []) as any)
    const puntaje = Math.round(pct * 10) / 10
    await supabase
      .from("sst_autoevaluaciones")
      .update({ puntaje_total: puntaje, valoracion: valoracionFromPct(pct) })
      .eq("id", input.autoevaluacion_id)
  } catch (e: any) {
    console.error("[v0] Error recalculando autoevaluacion:", e?.message || e)
  }
  return { success: true }
}

// ---------------------------------------------------------------------------
// P04 — Dashboard de auditoria 0312 (estandar <-> evidencia)
// ---------------------------------------------------------------------------
export async function getAuditoria0312(
  empresaIdFromClient?: number | null,
  anio?: number | null,
): Promise<AuditoriaData> {
  const empty: AuditoriaData = {
    autoevaluacion: null,
    porCiclo: [],
    estandares: [],
    evidencia: {},
    aniosDisponibles: [],
  }
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return empty

  const { autoevaluacion, aniosDisponibles } = await getAutoevaluacion(supabase, empresaId, anio)
  if (!autoevaluacion) return { ...empty, aniosDisponibles }

  // % EN VIVO (Res. 0312 Art. 27), MISMA fuente que la Matriz de 60 Estándares —
  // usa las respuestas CON el override de medición. Antes se mostraba el
  // `puntaje_total` denormalizado de `sst_autoevaluaciones`, que quedaba desactualizado
  // frente a las respuestas (p. ej. auditoría 86 vs matriz 91.5). Ahora ambos coinciden.
  const matriz = await getMatrizEstandares(empresaIdFromClient, anio)
  const calc = computar0312(matriz.items, matriz.respuestas)
  autoevaluacion.puntaje_total = Math.round(calc.pct * 10) / 10
  autoevaluacion.valoracion = valoracionFromPct(calc.pct)
  const porCiclo = calc.porCiclo

  const { data: estData, error: estError } = await supabase
    .from("v_sst_auditoria_estandar")
    .select("*")
    .eq("autoevaluacion_id", autoevaluacion.id)
    .order("numeral", { ascending: true })
  if (estError) {
    console.error("[v0] Error fetching auditoria estandar:", estError.message)
  }
  const estandares = (estData ?? []) as AuditoriaEstandarRow[]

  // Mapa de evidencia: conteo de registros vivos por tabla de soporte.
  const tablas = Array.from(
    new Set(estandares.map((e) => e.tabla).filter((t): t is string => !!t)),
  )
  // Evidencia = registros VIVOS de LIP en cada tabla de soporte. Como LIP es la
  // única empresa (los ID 1-4 son proyectos/sitios donde opera), se cuentan
  // TODOS los registros de la tabla: son todos de LIP. No se filtra por empresa.
  const evidencia: Record<string, number> = {}
  await Promise.all(
    tablas.map(async (tabla) => {
      try {
        const { count, error } = await supabase
          .from(tabla)
          .select("*", { count: "exact", head: true })
        evidencia[tabla] = error ? 0 : count ?? 0
      } catch {
        evidencia[tabla] = 0
      }
    }),
  )

  return { autoevaluacion, porCiclo, estandares, evidencia, aniosDisponibles }
}
