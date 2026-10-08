"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import type { PerfilSociodemograficoRow } from "@/lib/sst-evidencia-types"
import { edadDesdeFechaISO } from "@/lib/sst-datos-catalogos"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// Cliente admin server-side (la tabla tiene RLS; el acceso lo controla PermissionGuard).
async function resolveEmpresaId(fromClient?: number | null): Promise<number | null> {
  if (fromClient && !Number.isNaN(fromClient)) return fromClient
  return await getCurrentEmpresaIdForInsert()
}

// Columnas que la app puede escribir. `documento_norm` NO está aquí a propósito:
// es una columna GENERADA y Postgres rechaza cualquier escritura sobre ella.
const CAMPOS_ESCRIBIBLES = [
  "idempresa", "estado", "documento_tipo", "documento", "nombres", "apellidos",
  "fecha_nacimiento", "edad", "sexo", "eps", "afp", "arl", "centro_trabajo", "turno",
  "cargo", "fecha_ingreso", "fecha_retiro", "pais_nacimiento", "depto_nacimiento",
  "municipio_residencia", "grupo_etnico", "nivel_escolaridad", "estado_civil",
  "cabeza_familia", "num_hijos", "personas_hogar", "ingresos_familiares",
  "tipo_vivienda", "caracteristicas_vivienda", "zona", "direccion", "transporte",
  "estrato", "consume_alcohol", "actividad_fisica", "fumador",
  "requiere_revision", "revision_nota",
] as const

// Sin `export`: en un archivo "use server" todo lo exportado debe ser una
// funcion async, y esta es un helper sincrono de uso interno.
function normalizarDocumentoPerfil(v: unknown): string {
  return String(v ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase()
}

function saneado(row: Partial<PerfilSociodemograficoRow>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const k of CAMPOS_ESCRIBIBLES) {
    const v = row[k as keyof PerfilSociodemograficoRow]
    if (v !== undefined) out[k] = v
  }
  if (typeof out.documento === "string") out.documento = normalizarDocumentoPerfil(out.documento)
  for (const k of Object.keys(out)) {
    if (typeof out[k] === "string") {
      const v = out[k].trim().replace(/\s+/g, " ")
      out[k] = v === "" ? null : v
    }
    // `edad`, `num_hijos` y `personas_hogar` son enteros: una cadena vacía que
    // llegue del formulario debe ir como null, no como 0 (0 hijos y "no
    // respondió" no son lo mismo para el análisis sociodemográfico).
    if (["edad", "num_hijos", "personas_hogar"].includes(k)) {
      const n = Number(out[k])
      out[k] = out[k] === null || out[k] === "" || Number.isNaN(n) ? null : n
    }
  }
  return out
}

// Misma regla de "activo" que usan el portal (lib/portal-actions.ts) y el
// listado de MEDEVAC: un solo criterio en toda la app.
function esHeadcountActivo(estado: unknown): boolean {
  return String(estado ?? "").trim().toUpperCase() === "ACTIVO"
}

/**
 * El censo sociodemográfico, cruzado contra el head count por documento.
 *
 * El cruce importa: la columna `estado` de `sst_perfil_sociodemografico` la
 * escribe la carga masiva y queda en "activo" para todos, así que no dice nada
 * sobre quién sigue trabajando aquí. El estado REAL vive en el head count, y
 * sin cruzarlo el censo cuenta como plantilla actual a gente que ya se retiró
 * — que es justo lo que un análisis sociodemográfico no debe hacer.
 *
 * Cada fila sale con `estado_headcount`: "Activo", "Inactivo" o "Sin head
 * count" (el documento no aparece allí; suele ser una cédula escrita distinto,
 * y eso lo corrige Gestión Humana).
 *
 * Si la consulta del head count falla, los perfiles se devuelven igual con el
 * estado en null: quedarse sin censo por no poder resolver un estado sería
 * peor que mostrarlo sin esa marca.
 */
export async function listPerfilSociodemografico(
  empresaIdFromClient?: number | null,
): Promise<PerfilSociodemograficoRow[]> {
  const supabase: any = await getSupabaseAdmin()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  // SST transversal (LIP): se lista TODO el perfil sociodemográfico sin filtrar
  // por el ID del cliente; la info de SST es la misma para todos los proyectos.
  void empresaId

  const [perf, hc] = await Promise.all([
    supabase.from("sst_perfil_sociodemografico").select("*").order("apellidos", { ascending: true }),
    supabase.from("headcount").select("identificacion, estado, cargo"),
  ])

  if (perf.error) {
    console.error("[v0] listPerfilSociodemografico:", perf.error.message, perf.error.code, perf.error.details, perf.error.hint)
    return []
  }
  const filas = (perf.data ?? []) as PerfilSociodemograficoRow[]

  if (hc.error) {
    console.error("[v0] listPerfilSociodemografico headcount:", hc.error.message, hc.error.code)
    return filas.map((r) => ({ ...r, estado_headcount: null, cargo_headcount: null }))
  }

  const porDocumento = new Map<string, { estado: string; cargo: string | null }>()
  for (const h of hc.data ?? []) {
    const k = normalizarDocumentoPerfil(h.identificacion)
    if (k) porDocumento.set(k, { estado: h.estado ?? "", cargo: h.cargo ?? null })
  }

  return filas.map((r) => {
    const h = porDocumento.get(normalizarDocumentoPerfil(r.documento))
    return {
      ...r,
      estado_headcount: !h ? "Sin head count" : esHeadcountActivo(h.estado) ? "Activo" : "Inactivo",
      cargo_headcount: h?.cargo ?? null,
    }
  })
}

/**
 * El perfil de UNA persona, por documento. El módulo MEDEVAC lo usa para
 * editar el registro completo de alguien sin tener que traerse el censo
 * entero, que es de cientos de filas.
 */
export async function getPerfilPorDocumento(
  documento: string,
): Promise<PerfilSociodemograficoRow | null> {
  const doc = normalizarDocumentoPerfil(documento)
  if (!doc) return null
  const supabase: any = await getSupabaseAdmin()
  const { data, error } = await supabase
    .from("sst_perfil_sociodemografico").select("*")
    .eq("documento_norm", doc).limit(1).maybeSingle()
  if (error) {
    console.error("[v0] getPerfilPorDocumento:", error.message, error.code, error.details, error.hint)
    return null
  }
  return (data ?? null) as PerfilSociodemograficoRow | null
}

/**
 * Alta o actualización del perfil de una persona. Upsert por documento: el
 * documento es la llave que enlaza este perfil con su tarjeta MEDEVAC y con el
 * head count, así que una persona no puede tener dos perfiles.
 */
export async function savePerfilSociodemografico(
  row: Partial<PerfilSociodemograficoRow>,
  empresaIdFromClient?: number | null,
  actualizadoPor?: string,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Perfil Sociodemográfico", "MEDEVAC"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase: any = await getSupabaseAdmin()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  const limpio = saneado(row)

  if (!limpio.documento) return { success: false, message: "El N° de documento es obligatorio: es la llave que enlaza al colaborador." }

  // La edad se DERIVA de la fecha de nacimiento, nunca se guarda lo que venga
  // en el formulario: una edad capturada a mano deja de ser cierta al año
  // siguiente, y la fecha no. Mismo helper que usa el portal.
  const edadCalculada = edadDesdeFechaISO(limpio.fecha_nacimiento)

  const payload = {
    ...limpio,
    edad: edadCalculada ?? limpio.edad ?? null,
    // Guardar a mano ES la revisión: si alguien abrió el perfil, lo revisó y lo
    // guardó, la marca que dejó la carga masiva ya no aplica.
    requiere_revision: limpio.requiere_revision ?? false,
    revision_nota: limpio.revision_nota ?? null,
    idempresa: limpio.idempresa ?? empresaId ?? 100,
    origen: (row as any).origen ?? "sst",
    actualizado_en: new Date().toISOString(),
    actualizado_por: actualizadoPor ?? null,
  }

  const { error } = await supabase
    .from("sst_perfil_sociodemografico")
    .upsert([payload], { onConflict: "documento_norm" })
  if (!error) return { success: true }

  // `requiere_revision` y `revision_nota` las agrega scripts/sig/45_...sql. Si
  // el código se despliega antes de que ese script corra, la tabla todavía no
  // las tiene y el guardado fallaría entero — incluido el de MEDEVAC, que ya
  // está en uso. Guardar el perfil sin esas dos columnas es mucho mejor que no
  // guardarlo: son control de calidad de una carga masiva, no datos del censo.
  const columnaFaltante =
    error.code === "PGRST204" || error.code === "42703" ||
    /requiere_revision|revision_nota/.test(String(error.message ?? ""))
  if (columnaFaltante) {
    const { requiere_revision, revision_nota, ...sinCalidad } = payload as Record<string, any>
    const reintento = await supabase
      .from("sst_perfil_sociodemografico")
      .upsert([sinCalidad], { onConflict: "documento_norm" })
    if (!reintento.error) {
      console.warn("[v0] savePerfilSociodemografico: la tabla aún no tiene requiere_revision/revision_nota. " +
        "Se guardó sin ellas. Corre scripts/sig/45_perfil_sociodemografico_carga.sql")
      return { success: true }
    }
    console.error("[v0] savePerfilSociodemografico reintento:", reintento.error.message, reintento.error.code)
    return { success: false, message: reintento.error.message }
  }

  console.error("[v0] savePerfilSociodemografico:", error.message, error.code, error.details, error.hint)
  return { success: false, message: error.message }
}

/**
 * Elimina un perfil del censo.
 *
 * Es DEFINITIVO: no hay papelera. Antes de borrar se devuelve a quién
 * pertenecía, para que la pantalla pueda decirlo en la confirmación y en el
 * aviso posterior — un "registro eliminado" a secas no deja rastro de qué se
 * fue, y este dato lo diligenció una persona una sola vez.
 *
 * La persona NO desaparece del sistema: su vínculo vive en el head count y su
 * ficha de emergencia en MEDEVAC. Lo que se borra es su caracterización
 * sociodemográfica, y con ella vuelve a aparecer como pendiente en Cobertura.
 */
export async function eliminarPerfil(id: number): Promise<{ success: boolean; message?: string; persona?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Perfil Sociodemográfico"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!id) return { success: false, message: "No se indicó qué perfil eliminar." }
  const supabase: any = await getSupabaseAdmin()

  const { data: antes } = await supabase
    .from("sst_perfil_sociodemografico")
    .select("documento, nombres, apellidos")
    .eq("id", id)
    .maybeSingle()

  const { error } = await supabase.from("sst_perfil_sociodemografico").delete().eq("id", id)
  if (error) {
    console.error("[v0] eliminarPerfil:", error.message, error.code, error.details, error.hint)
    return { success: false, message: error.message }
  }

  const persona = antes
    ? `${String(antes.apellidos ?? "").trim()} ${String(antes.nombres ?? "").trim()}`.trim() || String(antes.documento ?? "")
    : undefined
  return { success: true, persona }
}

/**
 * Quita la marca de "requiere revisión" de un perfil. Se usa cuando SST ya
 * revisó a mano lo que la carga masiva no pudo resolver y confirma que el dato
 * está bien como está.
 *
 * Si la tabla todavía no tiene esas columnas —las agrega
 * scripts/sig/45_perfil_sociodemografico_carga.sql— no se rompe: se avisa en el
 * log y se responde que no hay nada que marcar, que es la verdad.
 */
export async function resolverRevisionPerfil(id: number): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Perfil Sociodemográfico"], "aprobar", "Resolver revisión")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase: any = await getSupabaseAdmin()
  const { error } = await supabase
    .from("sst_perfil_sociodemografico")
    .update({ requiere_revision: false, revision_nota: null, actualizado_en: new Date().toISOString() })
    .eq("id", id)

  if (!error) return { success: true }

  const columnaFaltante =
    error.code === "PGRST204" || error.code === "42703" ||
    /requiere_revision|revision_nota/.test(String(error.message ?? ""))
  if (columnaFaltante) {
    console.warn("[v0] resolverRevisionPerfil: la tabla aún no tiene requiere_revision. " +
      "Corre scripts/sig/45_perfil_sociodemografico_carga.sql")
    return { success: true, message: "No hay marcas de revisión en esta base todavía." }
  }
  console.error("[v0] resolverRevisionPerfil:", error.message, error.code)
  return { success: false, message: error.message }
}
