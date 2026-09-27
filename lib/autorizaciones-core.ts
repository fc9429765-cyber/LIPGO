import "server-only"

/**
 * Motor de AUTORIZACIÓN POR CLAVE (SQL 203). Punto ÚNICO por el que pasa toda
 * acción crítica que antes tenía su propia clave compartida:
 *
 *   ¿quién eres? (sesión) → ¿tu clave personal? → ¿tu perfil autoriza ESTE
 *   proceso en ESTE proyecto? → queda registrado quién autorizó (nombre real).
 *
 * Transición: mientras `autorizacion_config.transicion_claves_compartidas_hasta`
 * no haya pasado, las claves compartidas de siempre siguen valiendo para su
 * proceso (y quedan marcadas "ok_compartida" en la bitácora). Después, solo
 * la clave personal + perfil.
 *
 * NO es "use server": solo lo importan server actions. Así nadie puede llamar
 * `autorizar` desde el navegador para adivinar claves.
 */

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"
import { verificarClaveHash } from "@/lib/autorizaciones-crypto"
import type { ResultadoAutorizacion } from "@/lib/autorizaciones"

export const MAX_INTENTOS_CLAVE = 5
export const MINUTOS_BLOQUEO = 15
export const CONFIG_TRANSICION = "transicion_claves_compartidas_hasta"

// Claves compartidas históricas que vivían en el código / variables de entorno.
// Se conservan SOLO como respaldo de transición (ver `claveCompartida`).
const CLAVES_ANULAR_COMPARTIDAS = ["LIP123456", "Avimol2026"]
const CLAVE_CERRAR_PENDIENTE_COMPARTIDA = "LIP123456"
const CLAVE_FINANCIERA_COMPARTIDA = process.env.GESTION_FINANCIERA_CLAVE || "LIPMJJ"
const CLAVE_BONOS_COMPARTIDA = process.env.BONOS_APROBACION_CLAVE || "Jeff1234"

/** Fecha calendario de Colombia (UTC-5) en YYYY-MM-DD. */
export function hoyColombiaISO(): string {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
}

export async function getTransicionHasta(sb: any): Promise<string | null> {
  const { data } = await sb.from("autorizacion_config").select("valor").eq("clave", CONFIG_TRANSICION).maybeSingle()
  const v = String(data?.valor ?? "").trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

/**
 * ¿Siguen valiendo las claves compartidas? Si la tabla de configuración aún no
 * existe o no se puede leer (p. ej. el código se desplegó antes de correr el
 * SQL 203), la respuesta es SÍ: nunca se deja la operación sin forma de
 * autorizar por un despliegue adelantado.
 */
export async function transicionActiva(sb: any): Promise<boolean> {
  const { data, error } = await sb.from("autorizacion_config").select("valor").eq("clave", CONFIG_TRANSICION).maybeSingle()
  if (error) {
    console.warn("[autorizaciones] No se pudo leer autorizacion_config; se aceptan claves compartidas:", error.message)
    return true
  }
  const hasta = String(data?.valor ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return true
  return hoyColombiaISO() <= hasta
}

export async function nombreProceso(sb: any, proceso: string): Promise<string> {
  const { data } = await sb.from("autorizacion_procesos").select("nombre").eq("codigo", proceso).maybeSingle()
  return data?.nombre || proceso
}

async function nombreEmpresa(sb: any, idempresa: number | null | undefined): Promise<string | null> {
  if (!idempresa) return null
  const { data } = await sb.from("empresas").select("nombre").eq("id", idempresa).maybeSingle()
  return data?.nombre || `proyecto ${idempresa}`
}

function aplicaAlcance(filaIdempresa: number | null, idempresa: number | null | undefined): boolean {
  if (filaIdempresa == null) return true
  return idempresa != null && Number(filaIdempresa) === Number(idempresa)
}

/**
 * ¿El usuario tiene autorizado `proceso` en `idempresa`?
 *   1) Excepciones puntuales (autorizacion_usuario_procesos): una negación gana;
 *      si no hay negación y hay una concesión → permitido.
 *   2) Perfiles asignados (autorizacion_usuario_perfiles) cuyo alcance cubra el
 *      proyecto y que incluyan el proceso (perfil activo).
 */
export async function usuarioTienePermiso(
  sb: any,
  usuarioId: string,
  proceso: string,
  idempresa: number | null | undefined,
): Promise<{ permitido: boolean; origen?: string }> {
  const { data: exc } = await sb
    .from("autorizacion_usuario_procesos")
    .select("idempresa, permitir")
    .eq("usuario_id", usuarioId)
    .eq("proceso", proceso)
  const aplicables = (exc ?? []).filter((r: any) => aplicaAlcance(r.idempresa, idempresa))
  if (aplicables.some((r: any) => r.permitir === false)) return { permitido: false, origen: "Excepción (negado)" }
  if (aplicables.some((r: any) => r.permitir === true)) return { permitido: true, origen: "Excepción" }

  const { data: asig } = await sb
    .from("autorizacion_usuario_perfiles")
    .select("perfil_id, idempresa, autorizacion_perfiles!inner(nombre, activo)")
    .eq("usuario_id", usuarioId)
  const perfiles = (asig ?? []).filter((r: any) => r.autorizacion_perfiles?.activo !== false && aplicaAlcance(r.idempresa, idempresa))
  if (!perfiles.length) return { permitido: false }
  const ids = Array.from(new Set(perfiles.map((r: any) => Number(r.perfil_id))))
  const { data: pp } = await sb.from("autorizacion_perfil_procesos").select("perfil_id").in("perfil_id", ids).eq("proceso", proceso)
  const match = (pp ?? [])[0]
  if (!match) return { permitido: false }
  const perfil = perfiles.find((r: any) => Number(r.perfil_id) === Number(match.perfil_id))
  return { permitido: true, origen: perfil?.autorizacion_perfiles?.nombre || "Perfil" }
}

/** Respaldo de transición: las claves compartidas de siempre, por proceso. */
async function claveCompartida(
  sb: any,
  proceso: string,
  clave: string,
  idempresa: number | null | undefined,
): Promise<{ ok: boolean; responsable?: string }> {
  const buscar = async (tabla: string, filtros: Record<string, any>) => {
    let q = sb.from(tabla).select("responsable").eq("clave", clave).eq("activo", true)
    for (const [k, v] of Object.entries(filtros)) q = q.eq(k, v)
    const { data } = await q.limit(1).maybeSingle()
    return data?.responsable ? { ok: true, responsable: String(data.responsable) } : { ok: false }
  }

  if (/^inv_\d{3}_aprobar$/.test(proceso)) {
    if (idempresa) {
      const p = await buscar("inv_clave_gerencia_proyecto", { idempresa })
      if (p.ok) return p
    }
    return buscar("inv_clave_aprobacion_ajustes", {})
  }
  if (proceso === "inv_343") {
    return idempresa ? buscar("inv_clave_gerencia_proyecto", { idempresa }) : { ok: false }
  }
  if (/^inv_\d{3}$/.test(proceso)) {
    return buscar("inv_clave_movimiento", {})
  }
  if (proceso === "ped_aprobar_gerencia" || proceso === "ped_aprobar_cartera") {
    const { data } = await sb.from("usuariocartera").select("nombre").eq("contra", clave).limit(1).maybeSingle()
    return data?.nombre ? { ok: true, responsable: String(data.nombre) } : { ok: false }
  }
  if (proceso === "ped_anular") {
    return CLAVES_ANULAR_COMPARTIDAS.includes(clave) ? { ok: true, responsable: "Gerencia (clave compartida)" } : { ok: false }
  }
  if (proceso === "ped_cerrar_pendiente") {
    return clave === CLAVE_CERRAR_PENDIENTE_COMPARTIDA ? { ok: true, responsable: "Gerencia (clave compartida)" } : { ok: false }
  }
  if (proceso === "fin_gestion_financiera") {
    return clave === CLAVE_FINANCIERA_COMPARTIDA ? { ok: true, responsable: "Gestión Financiera (clave compartida)" } : { ok: false }
  }
  if (proceso === "fin_bonos_aprobar") {
    return clave === CLAVE_BONOS_COMPARTIDA ? { ok: true, responsable: "Aprobación de bonos (clave compartida)" } : { ok: false }
  }
  return { ok: false }
}

async function registrarLog(fila: {
  usuario_id: string | null
  usuario: string | null
  proceso: string
  idempresa: number | null
  resultado: string
  autorizado_por?: string | null
  referencia?: string | null
  detalle?: Record<string, unknown> | null
}) {
  try {
    const sb: any = await getSupabaseAdmin()
    await sb.from("autorizacion_log").insert({
      usuario_id: fila.usuario_id,
      usuario: fila.usuario,
      proceso: fila.proceso,
      idempresa: fila.idempresa,
      resultado: fila.resultado,
      autorizado_por: fila.autorizado_por ?? null,
      referencia: fila.referencia ?? null,
      detalle: fila.detalle ?? null,
    })
  } catch (e) {
    console.error("[autorizaciones] No se pudo registrar la bitácora:", e)
  }
}

/**
 * Verifica que el usuario en sesión puede autorizar `proceso` (en `idempresa`
 * si el proceso tiene alcance) con la clave dada. Devuelve el nombre real de
 * quien autoriza para guardarlo en el registro de negocio.
 */
export async function autorizar(input: {
  proceso: string
  idempresa?: number | null
  clave: string
  referencia?: string | null
}): Promise<ResultadoAutorizacion> {
  const proceso = String(input.proceso || "").trim()
  const idempresa = input.idempresa != null && Number(input.idempresa) > 0 ? Number(input.idempresa) : null
  const clave = String(input.clave ?? "")
  const referencia = input.referencia ?? null
  const sb: any = await getSupabaseAdminAsSystem()

  if (!clave.trim()) return { ok: false, error: "Ingresa tu clave de autorización." }

  const user = await getCurrentUser().catch(() => null)
  const usuarioId = user?.id ?? null
  let usuarioNombre: string | null = null
  if (usuarioId) {
    const { data: prof } = await sb.from("profiles").select("usuario").eq("id", usuarioId).maybeSingle()
    usuarioNombre = prof?.usuario ?? user?.email ?? null
  }

  const base = { usuario_id: usuarioId, usuario: usuarioNombre, proceso, idempresa, referencia }

  // 1) Clave personal del usuario en sesión.
  let personal: any = null
  if (usuarioId) {
    const { data } = await sb.from("autorizacion_claves").select("*").eq("usuario_id", usuarioId).maybeSingle()
    personal = data ?? null
  }

  if (personal?.bloqueado_hasta && new Date(personal.bloqueado_hasta).getTime() > Date.now()) {
    const hasta = new Date(personal.bloqueado_hasta)
    const hora = hasta.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" })
    await registrarLog({ ...base, resultado: "bloqueado" })
    return { ok: false, error: `Tu clave está bloqueada por intentos fallidos hasta las ${hora}. Si la olvidaste, recupérala desde el menú de usuario › Mi clave de autorización.` }
  }

  if (personal && verificarClaveHash(clave, personal.clave_hash)) {
    if (Number(personal.intentos_fallidos) > 0 || personal.bloqueado_hasta) {
      await sb.from("autorizacion_claves").update({ intentos_fallidos: 0, bloqueado_hasta: null }).eq("usuario_id", usuarioId)
    }
    if (personal.provisional) {
      await registrarLog({ ...base, resultado: "provisional" })
      return { ok: false, error: "Tu clave es PROVISIONAL (la asignó Gestión de Usuarios). Antes de autorizar debes definir tu clave definitiva: menú de usuario › Mi clave de autorización." }
    }
    const permiso = await usuarioTienePermiso(sb, usuarioId!, proceso, idempresa)
    if (!permiso.permitido) {
      const nombre = await nombreProceso(sb, proceso)
      const emp = await nombreEmpresa(sb, idempresa)
      await registrarLog({ ...base, resultado: "sin_permiso", detalle: { origen: permiso.origen ?? null } })
      return {
        ok: false,
        error: `Tu clave es correcta, pero tu perfil no tiene autorizado «${nombre}»${emp ? ` en ${emp}` : ""}. Pide el permiso en Gestión de Usuarios › Autorizaciones por clave.`,
      }
    }
    await registrarLog({ ...base, resultado: "ok", autorizado_por: usuarioNombre, detalle: { origen: permiso.origen ?? null } })
    return { ok: true, autorizadoPor: usuarioNombre || "Usuario LIPgo", usuarioId, via: "personal" }
  }

  // 2) Transición: clave compartida histórica del proceso.
  if (await transicionActiva(sb)) {
    const comp = await claveCompartida(sb, proceso, clave.trim(), idempresa)
    if (comp.ok) {
      await registrarLog({ ...base, resultado: "ok_compartida", autorizado_por: comp.responsable })
      return { ok: true, autorizadoPor: comp.responsable || "Clave compartida", usuarioId, via: "compartida" }
    }
  }

  // 3) Falló. Contar intentos si el usuario tiene clave personal.
  if (personal) {
    const intentos = Number(personal.intentos_fallidos || 0) + 1
    const bloquear = intentos >= MAX_INTENTOS_CLAVE
    await sb
      .from("autorizacion_claves")
      .update({
        intentos_fallidos: bloquear ? 0 : intentos,
        bloqueado_hasta: bloquear ? new Date(Date.now() + MINUTOS_BLOQUEO * 60_000).toISOString() : null,
      })
      .eq("usuario_id", usuarioId)
    await registrarLog({ ...base, resultado: "clave_incorrecta", detalle: { intentos } })
    if (bloquear) {
      return { ok: false, error: `Clave incorrecta. Se bloqueó por ${MINUTOS_BLOQUEO} minutos tras ${MAX_INTENTOS_CLAVE} intentos. Si la olvidaste, recupérala desde el menú de usuario › Mi clave de autorización.` }
    }
    const quedan = MAX_INTENTOS_CLAVE - intentos
    return { ok: false, error: `Clave incorrecta. Te quedan ${quedan} intento${quedan === 1 ? "" : "s"} antes del bloqueo.` }
  }

  await registrarLog({ ...base, resultado: usuarioId ? "sin_clave" : "sin_sesion" })
  if (!usuarioId) return { ok: false, error: "No hay sesión activa. Vuelve a iniciar sesión e intenta de nuevo." }
  return {
    ok: false,
    error: "Clave incorrecta. Si aún no tienes tu clave personal de autorización, créala desde el menú de usuario (ícono de la esquina superior derecha) › Mi clave de autorización.",
  }
}
