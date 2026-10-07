"use server"

// MÓDULO DE AUDITORÍA ISO 9001:2015
//
// Reemplaza el libro de Excel "Modulo_Auditoria ISO 9001 v1". La diferencia de
// fondo con el Excel: allí la norma se copiaba en cada hoja nueva, aquí el
// catálogo de requisitos es uno solo y las auditorías lo referencian. Corregir
// la redacción de un requisito ya no obliga a tocar auditorías pasadas --ni
// deja a las viejas con un texto distinto del de las nuevas.
//
// OJO con el nombre: `auditoria-actions.ts` (sin "iso") es otra cosa, la
// Bitácora de Auditoría del sistema que vive en Configuración. No se tocan.
//
// Ver scripts/244_auditoria_iso_9001.sql.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { checkModulePermission } from "@/lib/permissions-actions"
// Los tipos y el cálculo viven aparte: este archivo es "use server" y solo
// puede exportar funciones async.
import {
  calcularCumplimiento,
  type Auditoria,
  type Hallazgo,
  type RequisitoISO,
  type RespuestaAuditoria,
  type ResumenAuditoria,
} from "@/lib/auditoria-iso-tipos"

const MODULO = "Auditoría ISO 9001"

async function permitido(): Promise<boolean> {
  try {
    return await checkModulePermission(MODULO)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// El catálogo de la norma
// ---------------------------------------------------------------------------

export async function listarRequisitos(): Promise<RequisitoISO[]> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("auditoria_iso_requisitos")
      .select("codigo, capitulo, requisito, pregunta, orden")
      .eq("activo", true)
      .order("orden", { ascending: true })
    if (error) {
      console.error("[v0] listarRequisitos:", error.message)
      return []
    }
    return data ?? []
  } catch (e: any) {
    console.error("[v0] listarRequisitos:", e?.message ?? e)
    return []
  }
}

// ---------------------------------------------------------------------------
// Las auditorías
// ---------------------------------------------------------------------------

export async function listarAuditorias(
  idempresa: number | null,
): Promise<{ success: boolean; data: Auditoria[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    let q = sb.from("auditorias").select("*").order("fecha", { ascending: false })
    if (idempresa) q = q.eq("idempresa", idempresa)
    const { data, error } = await q
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: data ?? [] }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message }
  }
}

/**
 * Crea una auditoría y le siembra las respuestas de los 28 requisitos.
 *
 * Las respuestas se crean TODAS de una vez, en 'Pendiente'. Es deliberado: el
 * auditor tiene que ver la lista completa de la norma aunque no vaya a evaluar
 * todo, porque lo que no aparece en pantalla no se audita. Marcar "No aplica"
 * es una decisión que queda registrada; no responder, no.
 */
export async function crearAuditoria(
  datos: Partial<Auditoria> & { idempresa: number },
): Promise<{ success: boolean; id?: number; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  try {
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)

    const { data: aud, error } = await sb
      .from("auditorias")
      .insert({
        idempresa: datos.idempresa,
        codigo: datos.codigo ?? null,
        fecha: datos.fecha ?? new Date().toISOString().slice(0, 10),
        organizacion: datos.organizacion ?? null,
        proceso: datos.proceso ?? null,
        responsable_proceso: datos.responsable_proceso ?? null,
        auditor_lider: datos.auditor_lider ?? null,
        equipo_auditor: datos.equipo_auditor ?? null,
        tipo: datos.tipo ?? "Interna",
        alcance: datos.alcance ?? null,
        periodo_auditado: datos.periodo_auditado ?? null,
        estado: "borrador",
        creado_por: usuario ?? null,
      })
      .select("id")
      .single()

    if (error) return { success: false, message: error.message }

    const requisitos = await listarRequisitos()
    if (requisitos.length > 0) {
      const filas = requisitos.map((r) => ({
        auditoria_id: aud.id,
        requisito_codigo: r.codigo,
        resultado: "Pendiente",
      }))
      const { error: errResp } = await sb.from("auditoria_respuestas").insert(filas)
      if (errResp) {
        /*
         * Sin respuestas la auditoría no sirve para nada --sería una cabecera
         * vacía-- así que se retira en vez de dejarla a medias esperando que
         * alguien note el problema.
         */
        await sb.from("auditorias").delete().eq("id", aud.id)
        return { success: false, message: `No se pudo preparar el checklist: ${errResp.message}` }
      }
    }

    return { success: true, id: aud.id }
  } catch (e: any) {
    console.error("[v0] crearAuditoria:", e?.message ?? e)
    return { success: false, message: e?.message }
  }
}

export async function actualizarAuditoria(
  id: number,
  datos: Partial<Auditoria>,
): Promise<{ success: boolean; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  try {
    const sb: any = await getSupabaseAdmin()

    const { data: actual } = await sb.from("auditorias").select("estado").eq("id", id).maybeSingle()
    if (actual?.estado === "cerrada" && datos.estado !== "en_curso") {
      return {
        success: false,
        message: "La auditoría está cerrada. Reábrela para poder modificarla.",
      }
    }

    const { error } = await sb
      .from("auditorias")
      .update({ ...datos, updated_at: new Date().toISOString() })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

/**
 * Cierra la auditoría.
 *
 * No se deja cerrar con requisitos pendientes: un informe que dice "28
 * evaluados" cuando 10 nunca se miraron es una afirmación falsa ante el ente
 * certificador. Si de verdad no aplican, se marcan "No aplica" --que es una
 * decisión registrada-- y entonces sí cierra.
 */
export async function cerrarAuditoria(
  id: number,
  conclusiones?: string,
): Promise<{ success: boolean; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  try {
    const sb: any = await getSupabaseAdmin()

    const { data: pendientes } = await sb
      .from("auditoria_respuestas")
      .select("requisito_codigo")
      .eq("auditoria_id", id)
      .eq("resultado", "Pendiente")

    if (pendientes && pendientes.length > 0) {
      return {
        success: false,
        message:
          `Quedan ${pendientes.length} requisito(s) sin evaluar. ` +
          "Márcalos como «No aplica» si no corresponden al proceso auditado.",
      }
    }

    const { error } = await sb
      .from("auditorias")
      .update({
        estado: "cerrada",
        fecha_cierre: new Date().toISOString().slice(0, 10),
        conclusiones: conclusiones ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function eliminarAuditoria(
  id: number,
): Promise<{ success: boolean; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: aud } = await sb.from("auditorias").select("estado").eq("id", id).maybeSingle()
    if (aud?.estado === "cerrada") {
      return {
        success: false,
        message: "Una auditoría cerrada no se elimina: su informe es evidencia del sistema.",
      }
    }
    // Respuestas y hallazgos se van con ella (`on delete cascade` del 244).
    const { error } = await sb.from("auditorias").delete().eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

// ---------------------------------------------------------------------------
// El checklist
// ---------------------------------------------------------------------------

export async function listarRespuestas(
  auditoriaId: number,
): Promise<{ success: boolean; data: RespuestaAuditoria[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const [{ data: resp, error }, requisitos] = await Promise.all([
      sb.from("auditoria_respuestas").select("*").eq("auditoria_id", auditoriaId),
      listarRequisitos(),
    ])
    if (error) return { success: false, data: [], message: error.message }

    // El catálogo se une aquí y no con un join de PostgREST: así el orden de la
    // norma lo decide `orden` del catálogo y no el de inserción.
    const porCodigo = new Map(requisitos.map((r) => [r.codigo, r]))
    const filas = (resp ?? [])
      .map((r: any) => ({ ...r, requisito: porCodigo.get(r.requisito_codigo) }))
      .sort((a: any, b: any) => (a.requisito?.orden ?? 0) - (b.requisito?.orden ?? 0))

    return { success: true, data: filas }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message }
  }
}

export async function guardarRespuesta(
  id: number,
  datos: Partial<RespuestaAuditoria>,
): Promise<{ success: boolean; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  try {
    const sb: any = await getSupabaseAdmin()

    // Una auditoría cerrada no se edita: su informe ya es evidencia.
    const { data: fila } = await sb
      .from("auditoria_respuestas")
      .select("auditoria_id")
      .eq("id", id)
      .maybeSingle()
    if (fila) {
      const { data: aud } = await sb
        .from("auditorias")
        .select("estado")
        .eq("id", fila.auditoria_id)
        .maybeSingle()
      if (aud?.estado === "cerrada") {
        return { success: false, message: "La auditoría está cerrada." }
      }
    }

    const usuario = await getCurrentUsuarioForInsert().catch(() => null)
    const { error } = await sb
      .from("auditoria_respuestas")
      .update({
        ...datos,
        auditor: datos.auditor ?? usuario ?? undefined,
        fecha: datos.fecha ?? new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

// ---------------------------------------------------------------------------
// Los hallazgos
// ---------------------------------------------------------------------------

export async function listarHallazgos(
  auditoriaId: number,
): Promise<{ success: boolean; data: Hallazgo[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("auditoria_hallazgos")
      .select("*")
      .eq("auditoria_id", auditoriaId)
      .order("created_at", { ascending: true })
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: data ?? [] }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message }
  }
}

export async function guardarHallazgo(
  datos: Partial<Hallazgo> & { auditoria_id: number; descripcion: string },
): Promise<{ success: boolean; id?: number; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  try {
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)

    if (datos.id) {
      const { error } = await sb
        .from("auditoria_hallazgos")
        .update({ ...datos, updated_at: new Date().toISOString() })
        .eq("id", datos.id)
      if (error) return { success: false, message: error.message }
      return { success: true, id: datos.id }
    }

    // Consecutivo por auditoría: H-001, H-002…
    const { count } = await sb
      .from("auditoria_hallazgos")
      .select("id", { count: "exact", head: true })
      .eq("auditoria_id", datos.auditoria_id)
    const consecutivo = `H-${String((count ?? 0) + 1).padStart(3, "0")}`

    const { data, error } = await sb
      .from("auditoria_hallazgos")
      .insert({ ...datos, consecutivo, creado_por: usuario ?? null })
      .select("id")
      .single()
    if (error) return { success: false, message: error.message }
    return { success: true, id: data.id }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

/**
 * Cierra un hallazgo.
 *
 * Exige la verificación de eficacia. La norma (10.2) pide revisar que la
 * acción correctiva sirvió, y un hallazgo cerrado sin esa comprobación es
 * exactamente la no conformidad que levanta un auditor externo al revisar el
 * ciclo de mejora.
 */
export async function cerrarHallazgo(
  id: number,
  verificacion: string,
): Promise<{ success: boolean; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  if (!verificacion?.trim()) {
    return {
      success: false,
      message:
        "Para cerrar hay que registrar cómo se verificó que la acción fue eficaz (ISO 9001 · 10.2).",
    }
  }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb
      .from("auditoria_hallazgos")
      .update({
        estado: "Cerrado",
        verificacion_eficacia: verificacion.trim(),
        fecha_cierre: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

export async function eliminarHallazgo(id: number): Promise<{ success: boolean; message?: string }> {
  if (!(await permitido())) return { success: false, message: "Sin permiso." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("auditoria_hallazgos").delete().eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

// ---------------------------------------------------------------------------
// El tablero (la hoja DASHBOARD del Excel)
// ---------------------------------------------------------------------------

export async function getResumenAuditoria(
  auditoriaId: number,
): Promise<{ success: boolean; data?: ResumenAuditoria; message?: string }> {
  try {
    const { success, data: respuestas, message } = await listarRespuestas(auditoriaId)
    if (!success) return { success: false, message }

    const cuenta = (r: string) => respuestas.filter((x) => x.resultado === r).length

    const capitulos = [...new Set(respuestas.map((r) => r.requisito?.capitulo ?? 0))]
      .filter((c) => c > 0)
      .sort((a, b) => a - b)

    return {
      success: true,
      data: {
        evaluados: respuestas.length,
        conformes: cuenta("Conforme"),
        noConformes: cuenta("No conforme"),
        observaciones: cuenta("Observación"),
        oportunidades: cuenta("Oportunidad de mejora"),
        noAplica: cuenta("No aplica"),
        pendientes: cuenta("Pendiente"),
        cumplimiento: calcularCumplimiento(respuestas),
        porCapitulo: capitulos.map((cap) => {
          const delCap = respuestas.filter((r) => r.requisito?.capitulo === cap)
          const c = (res: string) => delCap.filter((x) => x.resultado === res).length
          return {
            capitulo: cap,
            evaluados: delCap.length,
            conformes: c("Conforme"),
            noConformes: c("No conforme"),
            observaciones: c("Observación"),
            oportunidades: c("Oportunidad de mejora"),
            cumplimiento: calcularCumplimiento(delCap),
          }
        }),
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}
