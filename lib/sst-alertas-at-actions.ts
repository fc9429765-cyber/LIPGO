"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import type { IncidenteRow } from "@/lib/sst-evidencia-types"
import { motivoSinAccion } from "@/lib/puerta-modulo"

async function resolveEmpresaId(fromClient?: number | null): Promise<number | null> {
  if (fromClient && !Number.isNaN(fromClient)) return fromClient
  return await getCurrentEmpresaIdForInsert()
}

// Una alerta = un ausentismo tipo AT, con el estado de su investigacion (si existe).
export interface AlertaAT {
  ausentismoId: string
  nombre: string
  cedula: string | null
  cargo: string | null
  area: string | null
  centroTrabajo: string | null
  fechaEvento: string | null
  parteCuerpo: string | null
  diagnostico: string | null
  diasIncapacidad: number | null
  // Investigacion vinculada (si ya se creo).
  investigacionId: number | null
  estadoInvestigacion: string | null
  // Calculados.
  diasTranscurridos: number | null
  // "pendiente" (sin investigacion), "en_proceso" (creada/abierta) o "cerrada".
  estadoAlerta: "pendiente" | "en_proceso" | "cerrada"
  // true si lleva > 15 dias sin investigacion cerrada (plazo legal Res. 1401/2007).
  vencida: boolean
}

export async function getAlertasAT(empresaIdFromClient?: number | null): Promise<AlertaAT[]> {
  const supabase: any = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []

  const [{ data: ausentismos }, { data: incidentes }] = await Promise.all([
    supabase
      .from("ausentismosst")
      .select(
        "id,nombre_colaborador,cedula,cargo,area,centro_trabajo,fecha_inicial,parte_cuerpo,descripcion_diagnostico,dias_incapacidad",
      )
      // SST transversal (LIP): TODAS las alertas AT de LIP, sin filtrar por el ID
      // del cliente (la info de cumplimiento es la misma para todos los proyectos).
      .eq("tipo_evento", "AT")
      .order("fecha_inicial", { ascending: false }),
    supabase
      .from("sst_incidentes")
      .select("id,ausentismo_id,estado,documento_numero"),
  ])

  const soloDigitos = (v: any) => String(v ?? "").replace(/[^0-9]/g, "")
  // Investigación vinculada por ausentismo_id (flujo "Crear investigación")
  // y por CÉDULA (investigaciones cargadas desde el formato SST-FOR-21).
  const porAusentismo = new Map<string, { id: number; estado: string }>()
  const porCedula = new Map<string, { id: number; estado: string }>()
  for (const inc of incidentes ?? []) {
    if (inc.ausentismo_id) porAusentismo.set(inc.ausentismo_id as string, { id: inc.id, estado: inc.estado })
    const ced = soloDigitos(inc.documento_numero)
    if (ced && !porCedula.has(ced)) porCedula.set(ced, { id: inc.id, estado: inc.estado })
  }

  // Las prórrogas de un AT son el MISMO evento: se consolida un AT por trabajador
  // (por cédula), sumando días y tomando la fecha inicial más antigua.
  const grupos = new Map<string, any>()
  for (const a of ausentismos ?? []) {
    const key = soloDigitos(a.cedula) || `id:${a.id}`
    const g = grupos.get(key)
    if (!g) {
      grupos.set(key, { ...a, _dias: Number(a.dias_incapacidad) || 0, _ids: [a.id] })
    } else {
      g._dias += Number(a.dias_incapacidad) || 0
      g._ids.push(a.id)
      // fecha inicial más antigua
      if (a.fecha_inicial && (!g.fecha_inicial || a.fecha_inicial < g.fecha_inicial)) g.fecha_inicial = a.fecha_inicial
      // completar campos faltantes
      for (const k of ["nombre_colaborador", "cargo", "area", "centro_trabajo", "parte_cuerpo", "descripcion_diagnostico"]) {
        if (!g[k] && a[k]) g[k] = a[k]
      }
    }
  }

  const hoy = Date.now()
  return Array.from(grupos.values()).map((a: any): AlertaAT => {
    const ced = soloDigitos(a.cedula)
    const inv = a._ids.map((id: string) => porAusentismo.get(id)).find(Boolean) || (ced ? porCedula.get(ced) : null) || null
    const dias = a.fecha_inicial ? Math.floor((hoy - new Date(a.fecha_inicial).getTime()) / 86400000) : null
    const estadoInv = inv?.estado ?? null
    const cerrada = estadoInv === "cerrado" || estadoInv === "cerrada"
    const estadoAlerta: AlertaAT["estadoAlerta"] = !inv ? "pendiente" : cerrada ? "cerrada" : "en_proceso"
    return {
      ausentismoId: a.id,
      nombre: a.nombre_colaborador,
      cedula: a.cedula ?? null,
      cargo: a.cargo ?? null,
      area: a.area ?? null,
      centroTrabajo: a.centro_trabajo ?? null,
      fechaEvento: a.fecha_inicial ?? null,
      parteCuerpo: a.parte_cuerpo ?? null,
      diagnostico: a.descripcion_diagnostico ?? null,
      diasIncapacidad: a._dias || null,
      investigacionId: inv?.id ?? null,
      estadoInvestigacion: estadoInv,
      diasTranscurridos: dias,
      estadoAlerta,
      vencida: !cerrada && dias !== null && dias > 15,
    }
  })
}

// Crea una investigacion (borrador) prellenada con los datos del ausentismo AT
// y la deja vinculada por ausentismo_id. Idempotente: si ya existe, la devuelve.
export async function crearInvestigacionDesdeAusentismo(
  ausentismoId: string,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; yaExistia?: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Alertas de AT", "Investigación AT"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase: any = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return { success: false, message: "Sin empresa seleccionada" }

  // Evitar duplicados.
  const { data: existente } = await supabase
    .from("sst_incidentes")
    .select("id")
    .eq("ausentismo_id", ausentismoId)
    .maybeSingle()
  if (existente) return { success: true, id: existente.id, yaExistia: true }

  // Datos del ausentismo para prellenar.
  const { data: a, error: aErr } = await supabase
    .from("ausentismosst")
    .select(
      "idempresa,nombre_colaborador,cargo,area,centro_trabajo,fecha_inicial,parte_cuerpo,descripcion_diagnostico,dias_incapacidad,codigo_diagnostico",
    )
    .eq("id", ausentismoId)
    .maybeSingle()
  if (aErr || !a) return { success: false, message: aErr?.message ?? "Ausentismo no encontrado" }

  const row: Partial<IncidenteRow> = {
    // La investigación se etiqueta con el proyecto REAL del ausentismo (no el del
    // selector), para que los indicadores SIG/KPIs de AT por proyecto sigan
    // contándola correctamente. Si el ausentismo no trae empresa, cae al selector.
    idempresa: (a as any).idempresa ?? empresaId,
    ausentismo_id: ausentismoId,
    tipo: "accidente",
    trabajador: a.nombre_colaborador,
    cargo: a.cargo,
    area_ocurrencia: a.area,
    sede: a.centro_trabajo,
    fecha_evento: a.fecha_inicial ?? new Date().toISOString().slice(0, 10),
    parte_cuerpo: a.parte_cuerpo,
    cie10_codigo: a.codigo_diagnostico,
    cie10_diagnostico: a.descripcion_diagnostico,
    dias_incapacidad: a.dias_incapacidad,
    descripcion: a.descripcion_diagnostico
      ? `Generado desde ausentismo AT: ${a.descripcion_diagnostico}`
      : "Generado desde ausentismo AT (Gestión Humana)",
    estado: "reportado",
  }

  const { data: inserted, error } = await supabase
    .from("sst_incidentes")
    .insert([row])
    .select("id")
    .single()
  if (error) return { success: false, message: error.message }
  return { success: true, id: (inserted as any)?.id }
}
