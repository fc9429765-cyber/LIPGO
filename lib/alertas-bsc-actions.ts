"use server"

// Suscripciones a alertas del BSC (SQL 218): cada usuario decide de qué indicador quiere
// aviso, en qué proyecto, con qué umbral y a qué correo. La evaluación y el envío viven en
// lib/alertas-bsc-core.ts (cron diario). "Enviarme una prueba" manda el estado actual del
// indicador al correo elegido, para comprobar que llega.

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getCurrentUser, getUserProfile } from "@/lib/auth-actions"
import { KPI_DEFS } from "@/lib/kpis-area"
import type { UmbralAlerta } from "@/lib/alertas-bsc"
import { evaluarYEnviarAlertas } from "@/lib/alertas-bsc-core"
import { registrarErrorServidor } from "@/lib/errores-servidor"
import { motivoSinAccion } from "@/lib/puerta-modulo"

type Resp<T> = { success: true; data: T } | { success: false; message: string }

export interface SuscripcionMia {
  id: number
  indicador: string
  nombre: string
  empresa_id: number | null
  umbral: UmbralAlerta
  correo: string
  activo: boolean
  ultimoEnvio: string | null
  ultimoEstado: string | null
}

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function sesion() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return null
  const profile: any = await getUserProfile(user.id).catch(() => null)
  return { id: user.id, email: user.email ?? null, usuario: profile?.usuario ?? user.email ?? null }
}

/** Correo sugerido para las alertas: el de recuperación de la clave si existe, si no el de la cuenta. */
async function correoSugerido(sb: any, usuarioId: string, emailCuenta: string | null): Promise<string | null> {
  try {
    // autorizacion_correos (SQL 204): el correo de recuperación de la clave personal.
    const { data } = await sb.from("autorizacion_correos").select("correo, verificado").eq("usuario_id", usuarioId).maybeSingle()
    if (data?.correo && String(data.correo).includes("@")) return String(data.correo).trim().toLowerCase()
  } catch {
    /* sin correo de recuperación */
  }
  if (emailCuenta && !/@lipgo\.app$/i.test(emailCuenta)) return emailCuenta
  return null
}

export async function getMisSuscripciones(empresaId: number | null | undefined): Promise<Resp<{ suscripciones: SuscripcionMia[]; correoSugerido: string | null; correoHabitual: string | null }>> {
  try {
    const s = await sesion()
    if (!s) return { success: false, message: "No hay sesión activa." }
    const sb: any = await getSupabaseAdminAsSystem()
    const { data, error } = await sb.from("alerta_suscripciones").select("*").eq("usuario_id", s.id).order("id")
    if (error) {
      if (/alerta_suscripciones/.test(error.message)) return { success: false, message: "Falta correr el script SQL 218 (alertas del BSC)." }
      throw error
    }
    const filas: any[] = data ?? []
    const ids = filas.map((f) => f.id)
    const ultimos = new Map<number, { en: string; estado: string }>()
    if (ids.length) {
      const { data: env } = await sb.from("alerta_envios").select("suscripcion_id, created_at, estado").in("suscripcion_id", ids).order("created_at", { ascending: false }).limit(500)
      for (const e of env ?? []) if (!ultimos.has(e.suscripcion_id)) ultimos.set(e.suscripcion_id, { en: e.created_at, estado: e.estado })
    }
    const suscripciones: SuscripcionMia[] = filas
      .filter((f) => empresaId == null || f.empresa_id == null || Number(f.empresa_id) === Number(empresaId))
      .map((f) => ({
        id: Number(f.id),
        indicador: String(f.indicador),
        nombre: KPI_DEFS[f.indicador]?.nombre ?? String(f.indicador),
        empresa_id: f.empresa_id == null ? null : Number(f.empresa_id),
        umbral: (f.umbral === "critico" ? "critico" : "atencion") as UmbralAlerta,
        correo: String(f.correo),
        activo: !!f.activo,
        ultimoEnvio: ultimos.get(f.id)?.en ?? null,
        ultimoEstado: ultimos.get(f.id)?.estado ?? null,
      }))
    const correoHabitual = filas[0]?.correo ? String(filas[0].correo) : null
    return { success: true, data: { suscripciones, correoSugerido: await correoSugerido(sb, s.id, s.email), correoHabitual } }
  } catch (e: any) {
    void registrarErrorServidor("alertas.getMisSuscripciones", e)
    return { success: false, message: e?.message || "No se pudieron leer tus alertas." }
  }
}

export async function guardarSuscripcion(input: { indicador: string; empresaId: number | null; umbral: UmbralAlerta; correo: string }): Promise<Resp<{ id: number }>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Indicadores SIG", "Dashboard SIG"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const s = await sesion()
    if (!s) return { success: false, message: "No hay sesión activa." }
    const indicador = String(input.indicador ?? "").trim()
    if (!KPI_DEFS[indicador]) return { success: false, message: "Indicador desconocido." }
    if (KPI_DEFS[indicador].meta == null) return { success: false, message: "Ese indicador es informativo (sin meta): no genera alertas." }
    const correo = String(input.correo ?? "").trim().toLowerCase()
    if (!CORREO_RE.test(correo)) return { success: false, message: "Escribe un correo válido para recibir las alertas." }
    if (/@lipgo\.app$/i.test(correo)) return { success: false, message: "Las cuentas @lipgo.app no son buzones: usa un correo real." }
    const umbral: UmbralAlerta = input.umbral === "critico" ? "critico" : "atencion"
    const empresaId = input.empresaId == null ? null : Number(input.empresaId)
    const sb: any = await getSupabaseAdmin()
    // El índice único usa coalesce(empresa_id, 0), así que se busca a mano y se actualiza o inserta.
    let q = sb.from("alerta_suscripciones").select("id").eq("usuario_id", s.id).eq("indicador", indicador)
    q = empresaId == null ? q.is("empresa_id", null) : q.eq("empresa_id", empresaId)
    const { data: ex, error: e1 } = await q.maybeSingle()
    if (e1) throw e1
    const ahora = new Date().toISOString()
    if (ex?.id) {
      const { error: e2 } = await sb.from("alerta_suscripciones").update({ correo, umbral, activo: true, usuario: s.usuario, actualizado_en: ahora }).eq("id", ex.id)
      if (e2) throw e2
      return { success: true, data: { id: Number(ex.id) } }
    }
    const { data: ins, error: e3 } = await sb
      .from("alerta_suscripciones")
      .insert({ usuario_id: s.id, usuario: s.usuario, correo, indicador, empresa_id: empresaId, umbral, canal: "correo", activo: true, actualizado_en: ahora })
      .select("id")
      .single()
    if (e3) throw e3
    return { success: true, data: { id: Number(ins.id) } }
  } catch (e: any) {
    void registrarErrorServidor("alertas.guardarSuscripcion", e, { indicador: input?.indicador })
    const m = String(e?.message ?? "")
    if (/alerta_suscripciones/.test(m)) return { success: false, message: "Falta correr el script SQL 218 (alertas del BSC)." }
    return { success: false, message: m || "No se pudo guardar la alerta." }
  }
}

export async function cancelarSuscripcion(id: number): Promise<Resp<null>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Indicadores SIG", "Dashboard SIG"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const s = await sesion()
    if (!s) return { success: false, message: "No hay sesión activa." }
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("alerta_suscripciones").delete().eq("id", id).eq("usuario_id", s.id)
    if (error) throw error
    return { success: true, data: null }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo cancelar la alerta." }
  }
}

/** Envía ahora, al correo de la suscripción, el estado actual del indicador (ignora umbral y repetición). */
export async function enviarPruebaAlerta(id: number): Promise<Resp<{ enviadas: number; detalle: string }>> {
  try {
    const s = await sesion()
    if (!s) return { success: false, message: "No hay sesión activa." }
    const sb: any = await getSupabaseAdminAsSystem()
    const { data: susc } = await sb.from("alerta_suscripciones").select("indicador, empresa_id").eq("id", id).eq("usuario_id", s.id).maybeSingle()
    if (!susc) return { success: false, message: "Esa alerta no es tuya o no existe." }
    const r = await evaluarYEnviarAlertas({ usuarioId: s.id, indicador: susc.indicador, empresaId: susc.empresa_id ?? undefined, forzar: true })
    if (r.errores.length) return { success: false, message: r.errores[0].error }
    if (r.enviadas === 0) return { success: false, message: r.omitidas[0]?.razon ? `No se envió: ${r.omitidas[0].razon}.` : "No se envió." }
    return { success: true, data: { enviadas: r.enviadas, detalle: "Revisa tu correo (también la carpeta de no deseados)." } }
  } catch (e: any) {
    void registrarErrorServidor("alertas.enviarPruebaAlerta", e, { id })
    return { success: false, message: e?.message || "No se pudo enviar la prueba." }
  }
}
