"use server"

// Informe semanal: suscripción por usuario y proyecto (misma tabla de las alertas, SQL 218,
// con indicador 'informe_semanal') y envío inmediato de la semana en curso. El armado y el
// envío viven en lib/informe-semanal-core.ts (cron de los lunes).

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getCurrentUser, getUserProfile } from "@/lib/auth-actions"
import { INDICADOR_INFORME } from "@/lib/informe-semanal"
import { enviarInformeA } from "@/lib/informe-semanal-core"
import { registrarErrorServidor } from "@/lib/errores-servidor"

type Resp<T> = { success: true; data: T } | { success: false; message: string }
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function sesion() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return null
  const profile: any = await getUserProfile(user.id).catch(() => null)
  return { id: user.id, email: user.email ?? null, usuario: profile?.usuario ?? user.email ?? null }
}

function validarCorreo(correo: string): string | null {
  if (!CORREO_RE.test(correo)) return "Escribe un correo válido."
  if (/@lipgo\.app$/i.test(correo)) return "Las cuentas @lipgo.app no son buzones: usa un correo real."
  return null
}

export interface InformeSuscripcion {
  id: number
  correo: string
  ultimoEnvio: string | null
  ultimoEstado: string | null
}

export async function getInformeSuscripcion(empresaId: number | null | undefined): Promise<Resp<{ suscripcion: InformeSuscripcion | null }>> {
  try {
    const s = await sesion()
    if (!s) return { success: false, message: "No hay sesión activa." }
    if (empresaId == null) return { success: true, data: { suscripcion: null } }
    const sb: any = await getSupabaseAdminAsSystem()
    const { data, error } = await sb.from("alerta_suscripciones").select("id, correo, activo").eq("usuario_id", s.id).eq("indicador", INDICADOR_INFORME).eq("empresa_id", empresaId).maybeSingle()
    if (error) {
      if (/alerta_suscripciones/.test(error.message)) return { success: false, message: "Falta correr el script SQL 218 (alertas del BSC)." }
      throw error
    }
    if (!data || !data.activo) return { success: true, data: { suscripcion: null } }
    const { data: env } = await sb.from("alerta_envios").select("created_at, estado").eq("suscripcion_id", data.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
    return { success: true, data: { suscripcion: { id: Number(data.id), correo: String(data.correo), ultimoEnvio: env?.created_at ?? null, ultimoEstado: env?.estado ?? null } } }
  } catch (e: any) {
    void registrarErrorServidor("informe.getInformeSuscripcion", e)
    return { success: false, message: e?.message || "No se pudo leer la suscripción." }
  }
}

export async function suscribirInforme(input: { empresaId: number; correo: string }): Promise<Resp<{ id: number }>> {
  try {
    const s = await sesion()
    if (!s) return { success: false, message: "No hay sesión activa." }
    const empresaId = Number(input.empresaId)
    if (!Number.isFinite(empresaId)) return { success: false, message: "Selecciona un proyecto." }
    const correo = String(input.correo ?? "").trim().toLowerCase()
    const err = validarCorreo(correo)
    if (err) return { success: false, message: err }
    const sb: any = await getSupabaseAdmin()
    const ahora = new Date().toISOString()
    const { data: ex, error: e1 } = await sb.from("alerta_suscripciones").select("id").eq("usuario_id", s.id).eq("indicador", INDICADOR_INFORME).eq("empresa_id", empresaId).maybeSingle()
    if (e1) throw e1
    if (ex?.id) {
      const { error: e2 } = await sb.from("alerta_suscripciones").update({ correo, activo: true, usuario: s.usuario, actualizado_en: ahora }).eq("id", ex.id)
      if (e2) throw e2
      return { success: true, data: { id: Number(ex.id) } }
    }
    const { data: ins, error: e3 } = await sb
      .from("alerta_suscripciones")
      .insert({ usuario_id: s.id, usuario: s.usuario, correo, indicador: INDICADOR_INFORME, empresa_id: empresaId, umbral: "atencion", canal: "correo", activo: true, actualizado_en: ahora })
      .select("id")
      .single()
    if (e3) throw e3
    return { success: true, data: { id: Number(ins.id) } }
  } catch (e: any) {
    void registrarErrorServidor("informe.suscribirInforme", e, { empresaId: input?.empresaId })
    const m = String(e?.message ?? "")
    if (/alerta_suscripciones/.test(m)) return { success: false, message: "Falta correr el script SQL 218 (alertas del BSC)." }
    return { success: false, message: m || "No se pudo activar el informe." }
  }
}

export async function cancelarInforme(id: number): Promise<Resp<null>> {
  try {
    const s = await sesion()
    if (!s) return { success: false, message: "No hay sesión activa." }
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("alerta_suscripciones").delete().eq("id", id).eq("usuario_id", s.id).eq("indicador", INDICADOR_INFORME)
    if (error) throw error
    return { success: true, data: null }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo cancelar el informe." }
  }
}

/** Manda ahora, al correo indicado, el informe de la semana en curso del proyecto. */
export async function enviarInformeAhora(input: { empresaId: number; correo: string }): Promise<Resp<{ asunto: string; fuente: "ia" | "determinista" }>> {
  try {
    const s = await sesion()
    if (!s) return { success: false, message: "No hay sesión activa." }
    const empresaId = Number(input.empresaId)
    if (!Number.isFinite(empresaId)) return { success: false, message: "Selecciona un proyecto." }
    const correo = String(input.correo ?? "").trim().toLowerCase()
    const err = validarCorreo(correo)
    if (err) return { success: false, message: err }
    const r = await enviarInformeA({ empresaId, correo, usuarioId: s.id, modo: "en_curso" })
    if (!r.ok) return { success: false, message: r.error ?? "No se pudo enviar." }
    return { success: true, data: { asunto: r.asunto ?? "Informe semanal", fuente: r.fuente ?? "determinista" } }
  } catch (e: any) {
    void registrarErrorServidor("informe.enviarInformeAhora", e, { empresaId: input?.empresaId })
    return { success: false, message: e?.message || "No se pudo enviar el informe." }
  }
}
