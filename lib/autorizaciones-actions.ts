"use server"

/**
 * Server actions del sistema de AUTORIZACIONES POR CLAVE (SQL 203).
 *
 *  - Autoservicio del usuario (menú de usuario › "Mi clave de autorización"):
 *    ver su estado y sus autorizaciones, crear/cambiar su clave, recuperarla
 *    con un código al correo.
 *  - Administración (Configuración › General › "Autorizaciones por clave"):
 *    perfiles (puestos) y sus procesos, asignación a usuarios con alcance por
 *    proyecto, excepciones, clave provisional, desbloqueo, fecha de transición
 *    y bitácora. Cada acción de administración se GATEA en el servidor con el
 *    permiso del módulo (el PermissionGuard de la UI solo esconde la pantalla).
 *
 * El motor `autorizar()` NO está aquí (lib/autorizaciones-core.ts): no debe
 * poder invocarse desde el navegador.
 */

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { checkModulePermission } from "@/lib/permissions-actions"
import {
  hashClave,
  verificarClaveHash,
  generarCodigoRecuperacion,
  hashCodigoRecuperacion,
  generarClaveProvisional,
} from "@/lib/autorizaciones-crypto"
import { correoConfigurado, enviarCorreo, remitenteCorreo, remitenteEsDePrueba, dominioRecibeCorreo, formatoCorreoValido } from "@/lib/email"
import {
  CONFIG_TRANSICION,
  MAX_INTENTOS_CLAVE,
  MINUTOS_BLOQUEO,
  getTransicionHasta,
  hoyColombiaISO,
  procesosSoloLip,
  usuarioTieneAccesoFinanciero,
} from "@/lib/autorizaciones-core"
import {
  validarFormatoClave,
  enmascararCorreo,
  type EstadoMiClave,
  type MiAutorizacion,
  type ResumenAutorizaciones,
  type ProcesoAutorizable,
  type PerfilAutorizacion,
  type UsuarioAutorizacion,
  type LogAutorizacion,
} from "@/lib/autorizaciones"

const MODULO_ADMIN = "Autorizaciones por clave"
const CODIGO_VIGENCIA_MIN = 15
const MAX_CODIGOS_POR_30_MIN = 3
const MAX_INTENTOS_CODIGO = 5

type Resp<T = {}> = { success: boolean; message?: string } & Partial<T>

async function assertAdmin(): Promise<boolean> {
  return await checkModulePermission(MODULO_ADMIN)
}

async function logInterno(fila: { usuario_id: string | null; usuario: string | null; proceso: string; resultado: string; autorizado_por?: string | null; referencia?: string | null; detalle?: Record<string, unknown> | null }) {
  try {
    const sb: any = await getSupabaseAdmin()
    await sb.from("autorizacion_log").insert({ ...fila, idempresa: null })
  } catch (e) {
    console.error("[autorizaciones] bitácora:", e)
  }
}

async function nombreDeUsuario(sb: any, usuarioId: string): Promise<string | null> {
  const { data } = await sb.from("profiles").select("usuario").eq("id", usuarioId).maybeSingle()
  return data?.usuario ?? null
}

const MSG_SOLO_LIP =
  "Los procesos financieros son exclusivos de LIP: solo pueden otorgarse a usuarios que ya tengan módulos de Gestión Financiera en Gestión de Usuarios."

/**
 * Candado financiero en la ADMINISTRACIÓN: no se puede otorgar (por perfil ni
 * por excepción) un proceso del grupo Financiera a un usuario sin módulos de
 * Gestión Financiera. Devuelve el mensaje de rechazo o null si procede.
 */
async function rechazoFinanciero(sb: any, usuarioId: string, procesos: string[]): Promise<string | null> {
  const soloLip = await procesosSoloLip(sb)
  const financieros = procesos.filter((p) => soloLip.has(p))
  if (!financieros.length) return null
  if (await usuarioTieneAccesoFinanciero(sb, usuarioId)) return null
  const usuario = (await nombreDeUsuario(sb, usuarioId)) || "Ese usuario"
  return `${usuario} no tiene módulos de Gestión Financiera en Gestión de Usuarios y esto incluye ${financieros.length === 1 ? "un proceso financiero" : `${financieros.length} procesos financieros`} (${financieros.join(", ")}). ${MSG_SOLO_LIP} Otórgale primero el acceso financiero allí (solo LIPgo puede) o usa un perfil sin procesos financieros.`
}

/**
 * A qué correo se envían los códigos de un usuario: su correo de RECUPERACIÓN
 * (autorizacion_correos, SQL 204) si lo registró; si no, su correo de acceso,
 * siempre que el dominio reciba mensajes (las cuentas @lipgo.app NO son buzones).
 */
async function destinoRecuperacion(
  sb: any,
  user: { id: string; email?: string | null },
): Promise<{ ok: true; correo: string; fuente: "recuperacion" | "acceso" } | { ok: false; error: string }> {
  const { data: rec } = await sb.from("autorizacion_correos").select("correo").eq("usuario_id", user.id).maybeSingle()
  const correoRec = String(rec?.correo || "").trim()
  if (correoRec.includes("@")) return { ok: true, correo: correoRec, fuente: "recuperacion" }
  const login = String(user.email || "").trim()
  if (!login.includes("@")) {
    return { ok: false, error: "Tu usuario no tiene correo. Registra un correo de recuperación en la pestaña «Correo» de esta ventana, o pide a Gestión de Usuarios una clave provisional." }
  }
  const recibe = await dominioRecibeCorreo(login)
  if (recibe === false) {
    return {
      ok: false,
      error: `Tu correo de acceso (${enmascararCorreo(login)}) no es un buzón real: nada enviado ahí llega. Registra un correo de recuperación real (tu Gmail o tu correo corporativo) en la pestaña «Correo» de esta ventana.`,
    }
  }
  return { ok: true, correo: login, fuente: "acceso" }
}

function alcanceTexto(ids: (number | null)[], empresas: Map<number, string>): string {
  if (ids.some((i) => i == null)) return "Todos los proyectos"
  const nombres = Array.from(new Set(ids.map((i) => empresas.get(Number(i)) || `Proyecto ${i}`)))
  return nombres.join(", ")
}

// ===========================================================================
// AUTOSERVICIO
// ===========================================================================

export async function getMiEstadoClave(): Promise<EstadoMiClave | null> {
  try {
    const user = await getCurrentUser()
    if (!user) return null
    const sb: any = await getSupabaseAdminAsSystem()

    const [{ data: clave }, { data: procesos }, { data: asig }, { data: exc }, { data: emps }, transicionHasta] = await Promise.all([
      sb.from("autorizacion_claves").select("provisional, bloqueado_hasta, actualizado_en").eq("usuario_id", user.id).maybeSingle(),
      sb.from("autorizacion_procesos").select("codigo, nombre, grupo, orden").order("orden"),
      sb.from("autorizacion_usuario_perfiles").select("perfil_id, idempresa, autorizacion_perfiles!inner(nombre, activo)").eq("usuario_id", user.id),
      sb.from("autorizacion_usuario_procesos").select("proceso, idempresa, permitir").eq("usuario_id", user.id),
      sb.from("empresas").select("id, nombre"),
      getTransicionHasta(sb),
    ])
    const { data: correoRec } = await sb.from("autorizacion_correos").select("correo, verificado").eq("usuario_id", user.id).maybeSingle()
    const correoLoginRecibe = await dominioRecibeCorreo(user.email)
    const empresas = new Map<number, string>((emps ?? []).map((e: any) => [Number(e.id), String(e.nombre)]))
    const catalogo = new Map<string, any>((procesos ?? []).map((p: any) => [p.codigo, p]))

    const perfilIds = Array.from(new Set((asig ?? []).filter((a: any) => a.autorizacion_perfiles?.activo !== false).map((a: any) => Number(a.perfil_id))))
    const { data: pp } = perfilIds.length
      ? await sb.from("autorizacion_perfil_procesos").select("perfil_id, proceso").in("perfil_id", perfilIds)
      : { data: [] }

    // proceso -> { alcances, origenes }
    const acumulado = new Map<string, { ids: (number | null)[]; origenes: Set<string> }>()
    for (const a of asig ?? []) {
      if (a.autorizacion_perfiles?.activo === false) continue
      const procesosPerfil = (pp ?? []).filter((r: any) => Number(r.perfil_id) === Number(a.perfil_id))
      for (const r of procesosPerfil) {
        const acc = acumulado.get(r.proceso) ?? { ids: [], origenes: new Set<string>() }
        acc.ids.push(a.idempresa == null ? null : Number(a.idempresa))
        acc.origenes.add(String(a.autorizacion_perfiles?.nombre || "Perfil"))
        acumulado.set(r.proceso, acc)
      }
    }
    const denegadas: MiAutorizacion[] = []
    for (const e of exc ?? []) {
      const p = catalogo.get(e.proceso)
      const item: MiAutorizacion = {
        proceso: e.proceso,
        nombre: p?.nombre || e.proceso,
        grupo: p?.grupo || "",
        alcance: alcanceTexto([e.idempresa == null ? null : Number(e.idempresa)], empresas),
        origen: e.permitir ? "Excepción" : "Excepción (negado)",
      }
      if (e.permitir) {
        const acc = acumulado.get(e.proceso) ?? { ids: [], origenes: new Set<string>() }
        acc.ids.push(e.idempresa == null ? null : Number(e.idempresa))
        acc.origenes.add("Excepción")
        acumulado.set(e.proceso, acc)
      } else denegadas.push(item)
    }
    const autorizaciones: MiAutorizacion[] = Array.from(acumulado.entries())
      .map(([proceso, acc]) => {
        const p = catalogo.get(proceso)
        return {
          proceso,
          nombre: p?.nombre || proceso,
          grupo: p?.grupo || "",
          alcance: alcanceTexto(acc.ids, empresas),
          origen: Array.from(acc.origenes).join(" · "),
          orden: Number(p?.orden ?? 999),
        }
      })
      .sort((a, b) => a.orden - b.orden)
      .map(({ orden: _o, ...rest }) => rest)

    return {
      tieneClave: Boolean(clave),
      provisional: Boolean(clave?.provisional),
      bloqueadaHasta: clave?.bloqueado_hasta && new Date(clave.bloqueado_hasta).getTime() > Date.now() ? clave.bloqueado_hasta : null,
      actualizadaEn: clave?.actualizado_en ?? null,
      correoEnmascarado: enmascararCorreo(user.email),
      correoLoginRecibe,
      correoRecuperacion: enmascararCorreo(correoRec?.correo),
      correoRecuperacionVerificado: Boolean(correoRec?.verificado),
      correoDisponible: correoConfigurado(),
      transicionHasta,
      autorizaciones,
      denegadas,
    }
  } catch (e) {
    console.error("[autorizaciones] getMiEstadoClave:", e)
    return null
  }
}

/**
 * Aviso liviano para la barra superior: el usuario tiene procesos autorizados
 * (perfil o excepción) pero aún no creó su clave personal, o tiene una
 * provisional. Tres consultas mínimas; nada de esto requiere permisos de módulo.
 */
/**
 * Aviso de clave pendiente para la persona en sesión.
 *
 * Devuelve además la FECHA en que vencen las claves compartidas y el día de hoy en Bogotá,
 * para que la franja pueda decir cuántos días faltan. Sin esa cuenta regresiva el aviso es
 * "pendiente" a secas, y eso no mueve a nadie: medido el 2026-10-07, el aviso llevaba desde
 * el 27 de septiembre dentro del menú del avatar y 19 de 21 personas seguían sin clave.
 */
export async function getAvisoMiClave(): Promise<{
  motivo: "sin_clave" | "provisional" | null
  transicionHasta: string | null
  hoy: string
}> {
  const hoy = hoyColombiaISO()
  try {
    const user = await getCurrentUser()
    if (!user) return { motivo: null, transicionHasta: null, hoy }
    const sb: any = await getSupabaseAdminAsSystem()
    const [{ data: clave }, { count: nPerf }, { count: nExc }, { data: cfg }] = await Promise.all([
      sb.from("autorizacion_claves").select("provisional").eq("usuario_id", user.id).maybeSingle(),
      sb.from("autorizacion_usuario_perfiles").select("id", { count: "exact", head: true }).eq("usuario_id", user.id),
      sb.from("autorizacion_usuario_procesos").select("id", { count: "exact", head: true }).eq("usuario_id", user.id).eq("permitir", true),
      sb.from("autorizacion_config").select("valor").eq("clave", "transicion_claves_compartidas_hasta").maybeSingle(),
    ])
    const transicionHasta = typeof cfg?.valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cfg.valor) ? cfg.valor : null
    if (Number(nPerf || 0) + Number(nExc || 0) === 0) return { motivo: null, transicionHasta, hoy }
    if (!clave) return { motivo: "sin_clave", transicionHasta, hoy }
    if (clave.provisional) return { motivo: "provisional", transicionHasta, hoy }
    return { motivo: null, transicionHasta, hoy }
  } catch {
    return { motivo: null, transicionHasta: null, hoy }
  }
}

export async function crearMiClave(nueva: string, confirmar: string): Promise<Resp> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, message: "No hay sesión activa." }
    const err = validarFormatoClave(nueva)
    if (err) return { success: false, message: err }
    if (nueva !== confirmar) return { success: false, message: "La confirmación no coincide con la clave." }

    const sb: any = await getSupabaseAdmin()
    const { data: existente } = await sb.from("autorizacion_claves").select("usuario_id, provisional").eq("usuario_id", user.id).maybeSingle()
    if (existente && !existente.provisional) {
      return { success: false, message: "Ya tienes una clave de autorización. Para cambiarla usa «Cambiar mi clave» (o recupérala si la olvidaste)." }
    }
    if (existente?.provisional) {
      return { success: false, message: "Tienes una clave PROVISIONAL asignada por Gestión de Usuarios: ingrésala como clave actual en «Cambiar mi clave» para definir la tuya." }
    }
    const usuario = await nombreDeUsuario(sb, user.id)
    const { error } = await sb.from("autorizacion_claves").insert({
      usuario_id: user.id,
      clave_hash: hashClave(nueva),
      provisional: false,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      actualizado_en: new Date().toISOString(),
      actualizado_por: usuario,
    })
    if (error) return { success: false, message: error.message }
    await logInterno({ usuario_id: user.id, usuario, proceso: "clave_personal", resultado: "creada", autorizado_por: usuario })
    return { success: true, message: "Tu clave de autorización quedó creada. Úsala en los procesos que tu perfil tenga autorizados." }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo crear la clave." }
  }
}

export async function cambiarMiClave(actual: string, nueva: string, confirmar: string): Promise<Resp> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, message: "No hay sesión activa." }
    const err = validarFormatoClave(nueva)
    if (err) return { success: false, message: err }
    if (nueva !== confirmar) return { success: false, message: "La confirmación no coincide con la clave nueva." }
    if (actual === nueva) return { success: false, message: "La clave nueva debe ser distinta de la actual." }

    const sb: any = await getSupabaseAdmin()
    const { data: fila } = await sb.from("autorizacion_claves").select("*").eq("usuario_id", user.id).maybeSingle()
    if (!fila) return { success: false, message: "Aún no tienes clave de autorización. Créala primero." }
    if (fila.bloqueado_hasta && new Date(fila.bloqueado_hasta).getTime() > Date.now()) {
      return { success: false, message: "Tu clave está bloqueada temporalmente por intentos fallidos. Espera unos minutos o recupérala con el código al correo." }
    }
    if (!verificarClaveHash(actual, fila.clave_hash)) {
      const intentos = Number(fila.intentos_fallidos || 0) + 1
      const bloquear = intentos >= MAX_INTENTOS_CLAVE
      await sb
        .from("autorizacion_claves")
        .update({ intentos_fallidos: bloquear ? 0 : intentos, bloqueado_hasta: bloquear ? new Date(Date.now() + MINUTOS_BLOQUEO * 60_000).toISOString() : null })
        .eq("usuario_id", user.id)
      return { success: false, message: bloquear ? `Clave actual incorrecta. Quedó bloqueada ${MINUTOS_BLOQUEO} minutos; si la olvidaste, recupérala por correo.` : "La clave actual no es correcta." }
    }
    const usuario = await nombreDeUsuario(sb, user.id)
    const { error } = await sb
      .from("autorizacion_claves")
      .update({ clave_hash: hashClave(nueva), provisional: false, intentos_fallidos: 0, bloqueado_hasta: null, actualizado_en: new Date().toISOString(), actualizado_por: usuario })
      .eq("usuario_id", user.id)
    if (error) return { success: false, message: error.message }
    await logInterno({ usuario_id: user.id, usuario, proceso: "clave_personal", resultado: fila.provisional ? "definida_desde_provisional" : "cambiada", autorizado_por: usuario })
    return { success: true, message: fila.provisional ? "Listo: tu clave definitiva quedó definida y la provisional dejó de valer." : "Tu clave de autorización fue cambiada." }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo cambiar la clave." }
  }
}

export async function solicitarCodigoRecuperacion(): Promise<Resp<{ destino: string; correoNoConfigurado: boolean }>> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, message: "No hay sesión activa." }
    if (!correoConfigurado()) {
      return {
        success: false,
        correoNoConfigurado: true,
        message: "El envío de correos aún no está configurado en LIPgo. Pide a Gestión de Usuarios una clave provisional (Autorizaciones por clave › Clave provisional) y luego define la tuya.",
      }
    }
    const sb: any = await getSupabaseAdmin()
    const dest = await destinoRecuperacion(sb, user)
    if (!dest.ok) return { success: false, message: dest.error }
    const email = dest.correo

    const hace30 = new Date(Date.now() - 30 * 60_000).toISOString()
    const { count } = await sb.from("autorizacion_recuperacion").select("id", { count: "exact", head: true }).eq("usuario_id", user.id).eq("canal", "correo").gte("created_at", hace30)
    if (Number(count || 0) >= MAX_CODIGOS_POR_30_MIN) {
      return { success: false, message: "Ya se enviaron varios códigos en los últimos 30 minutos. Revisa tu correo (también spam) o espera un momento." }
    }

    const codigo = generarCodigoRecuperacion()
    const destino = enmascararCorreo(email) || email
    const expira = new Date(Date.now() + CODIGO_VIGENCIA_MIN * 60_000).toISOString()
    const { data: fila, error } = await sb
      .from("autorizacion_recuperacion")
      .insert({ usuario_id: user.id, codigo_hash: hashCodigoRecuperacion(codigo, user.id), canal: "correo", destino, expira_en: expira })
      .select("id")
      .single()
    if (error) return { success: false, message: error.message }

    const usuario = (await nombreDeUsuario(sb, user.id)) || email
    const envio = await enviarCorreo({
      to: email,
      subject: `LIPgo · Código para recuperar tu clave de autorización: ${codigo}`,
      text: `Hola ${usuario},\n\nTu código para restablecer la clave de autorización de LIPgo es: ${codigo}\n\nVence en ${CODIGO_VIGENCIA_MIN} minutos. Si no lo solicitaste, ignora este mensaje: tu clave actual sigue igual.\n\nLIPgo`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
  <h2 style="margin:0 0 12px;color:#111827">Recuperar clave de autorización</h2>
  <p style="color:#374151">Hola <b>${usuario}</b>, este es tu código para restablecer la clave con la que autorizas procesos en LIPgo:</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:700;text-align:center;margin:20px 0;color:#111827">${codigo}</p>
  <p style="color:#6b7280;font-size:13px">Vence en ${CODIGO_VIGENCIA_MIN} minutos. Escríbelo en LIPgo › menú de usuario › <b>Mi clave de autorización</b> › <b>Recuperar</b>.</p>
  <p style="color:#6b7280;font-size:13px">Si no lo solicitaste, ignora este mensaje: tu clave actual sigue igual.</p>
</div>`,
    })
    if (!envio.ok) {
      await sb.from("autorizacion_recuperacion").delete().eq("id", fila.id)
      await logInterno({ usuario_id: user.id, usuario, proceso: "clave_personal", resultado: "codigo_no_enviado", detalle: { destino, error: envio.detalle ?? envio.error ?? null } })
      return { success: false, message: envio.error || "No se pudo enviar el correo." }
    }
    await logInterno({ usuario_id: user.id, usuario, proceso: "clave_personal", resultado: "codigo_enviado", detalle: { destino } })
    return { success: true, destino, message: `Te enviamos un código de 6 dígitos a ${destino}. Vence en ${CODIGO_VIGENCIA_MIN} minutos.` }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo enviar el código." }
  }
}

export async function recuperarClaveConCodigo(codigo: string, nueva: string, confirmar: string): Promise<Resp> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, message: "No hay sesión activa." }
    const cod = String(codigo || "").replace(/\D/g, "")
    if (cod.length !== 6) return { success: false, message: "El código tiene 6 dígitos." }
    const err = validarFormatoClave(nueva)
    if (err) return { success: false, message: err }
    if (nueva !== confirmar) return { success: false, message: "La confirmación no coincide con la clave nueva." }

    const sb: any = await getSupabaseAdmin()
    const { data: fila } = await sb
      .from("autorizacion_recuperacion")
      .select("*")
      .eq("usuario_id", user.id)
      .eq("canal", "correo")
      .is("usado_en", null)
      .gt("expira_en", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!fila) return { success: false, message: "No hay un código vigente. Solicita uno nuevo." }
    if (Number(fila.intentos) >= MAX_INTENTOS_CODIGO) {
      await sb.from("autorizacion_recuperacion").update({ usado_en: new Date().toISOString() }).eq("id", fila.id)
      return { success: false, message: "Ese código se invalidó por demasiados intentos. Solicita uno nuevo." }
    }
    if (fila.codigo_hash !== hashCodigoRecuperacion(cod, user.id)) {
      await sb.from("autorizacion_recuperacion").update({ intentos: Number(fila.intentos) + 1 }).eq("id", fila.id)
      const quedan = MAX_INTENTOS_CODIGO - Number(fila.intentos) - 1
      return { success: false, message: `Código incorrecto. Te quedan ${quedan} intento${quedan === 1 ? "" : "s"}.` }
    }
    const usuario = await nombreDeUsuario(sb, user.id)
    const ahora = new Date().toISOString()
    await sb.from("autorizacion_recuperacion").update({ usado_en: ahora }).eq("id", fila.id)
    const { error } = await sb.from("autorizacion_claves").upsert(
      {
        usuario_id: user.id,
        clave_hash: hashClave(nueva),
        provisional: false,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        actualizado_en: ahora,
        actualizado_por: `${usuario ?? "usuario"} (recuperación por correo)`,
      },
      { onConflict: "usuario_id" },
    )
    if (error) return { success: false, message: error.message }
    await logInterno({ usuario_id: user.id, usuario, proceso: "clave_personal", resultado: "recuperada_por_correo", autorizado_por: usuario })
    return { success: true, message: "Tu clave de autorización quedó restablecida." }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo restablecer la clave." }
  }
}

// ---------------------------------------------------------------------------
// Correo de RECUPERACIÓN (SQL 204): un buzón real, distinto del correo de acceso.
// El usuario lo registra y lo confirma con un código enviado a ESE correo.
// ---------------------------------------------------------------------------

export async function solicitarVerificacionCorreo(correo: string): Promise<Resp<{ destino: string }>> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, message: "No hay sesión activa." }
    const c = String(correo || "").trim().toLowerCase()
    if (!formatoCorreoValido(c)) return { success: false, message: "Escribe un correo válido (por ejemplo nombre@gmail.com)." }
    if ((await dominioRecibeCorreo(c)) === false) {
      return { success: false, message: `El dominio de ${c} no recibe correo. Usa un buzón real: tu Gmail, Outlook o tu correo corporativo.` }
    }
    if (!correoConfigurado()) return { success: false, message: "El envío de correos no está configurado en este despliegue." }

    const sb: any = await getSupabaseAdmin()
    const hace30 = new Date(Date.now() - 30 * 60_000).toISOString()
    const { count } = await sb.from("autorizacion_recuperacion").select("id", { count: "exact", head: true }).eq("usuario_id", user.id).eq("canal", "verificar_correo").gte("created_at", hace30)
    if (Number(count || 0) >= MAX_CODIGOS_POR_30_MIN) {
      return { success: false, message: "Ya se enviaron varios códigos en los últimos 30 minutos. Revisa ese correo (también spam) o espera un momento." }
    }
    const codigo = generarCodigoRecuperacion()
    const expira = new Date(Date.now() + CODIGO_VIGENCIA_MIN * 60_000).toISOString()
    const { data: fila, error } = await sb
      .from("autorizacion_recuperacion")
      .insert({ usuario_id: user.id, codigo_hash: hashCodigoRecuperacion(codigo, user.id), canal: "verificar_correo", destino: c, expira_en: expira })
      .select("id")
      .single()
    if (error) return { success: false, message: error.message }
    const usuario = (await nombreDeUsuario(sb, user.id)) || c
    const envio = await enviarCorreo({
      to: c,
      subject: `LIPgo · confirma tu correo de recuperación: ${codigo}`,
      text: `Hola ${usuario},\n\nCódigo para confirmar este correo como tu correo de recuperación en LIPgo: ${codigo}\n\nVence en ${CODIGO_VIGENCIA_MIN} minutos. Si no lo solicitaste, ignora este mensaje.\n\nLIPgo`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
  <h2 style="margin:0 0 12px;color:#111827">Confirma tu correo de recuperación</h2>
  <p style="color:#374151">Hola <b>${usuario}</b>, escribe este código en LIPgo para confirmar que este correo es tuyo. Aquí llegarán los códigos para recuperar tu clave de autorización.</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:700;text-align:center;margin:20px 0;color:#111827">${codigo}</p>
  <p style="color:#6b7280;font-size:13px">Vence en ${CODIGO_VIGENCIA_MIN} minutos. Si no lo solicitaste, ignora este mensaje.</p>
</div>`,
    })
    if (!envio.ok) {
      await sb.from("autorizacion_recuperacion").delete().eq("id", fila.id)
      return { success: false, message: envio.error || "No se pudo enviar el correo." }
    }
    await logInterno({ usuario_id: user.id, usuario, proceso: "clave_personal", resultado: "verificacion_correo_enviada", detalle: { destino: enmascararCorreo(c) } })
    const destino = enmascararCorreo(c) || c
    return { success: true, destino, message: `Te enviamos un código a ${destino}. Escríbelo aquí para confirmar el correo.` }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo enviar el código de verificación." }
  }
}

export async function confirmarCorreoRecuperacion(codigo: string): Promise<Resp<{ correo: string }>> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, message: "No hay sesión activa." }
    const cod = String(codigo || "").replace(/\D/g, "")
    if (cod.length !== 6) return { success: false, message: "El código tiene 6 dígitos." }
    const sb: any = await getSupabaseAdmin()
    const { data: fila } = await sb
      .from("autorizacion_recuperacion")
      .select("*")
      .eq("usuario_id", user.id)
      .eq("canal", "verificar_correo")
      .is("usado_en", null)
      .gt("expira_en", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!fila) return { success: false, message: "No hay un código vigente. Solicita uno nuevo." }
    if (Number(fila.intentos) >= MAX_INTENTOS_CODIGO) {
      await sb.from("autorizacion_recuperacion").update({ usado_en: new Date().toISOString() }).eq("id", fila.id)
      return { success: false, message: "Ese código se invalidó por demasiados intentos. Solicita uno nuevo." }
    }
    if (fila.codigo_hash !== hashCodigoRecuperacion(cod, user.id)) {
      await sb.from("autorizacion_recuperacion").update({ intentos: Number(fila.intentos) + 1 }).eq("id", fila.id)
      const quedan = MAX_INTENTOS_CODIGO - Number(fila.intentos) - 1
      return { success: false, message: `Código incorrecto. Te quedan ${quedan} intento${quedan === 1 ? "" : "s"}.` }
    }
    const usuario = await nombreDeUsuario(sb, user.id)
    const ahora = new Date().toISOString()
    await sb.from("autorizacion_recuperacion").update({ usado_en: ahora }).eq("id", fila.id)
    const { error } = await sb.from("autorizacion_correos").upsert(
      { usuario_id: user.id, correo: String(fila.destino), verificado: true, origen: "usuario", actualizado_en: ahora, actualizado_por: usuario },
      { onConflict: "usuario_id" },
    )
    if (error) return { success: false, message: error.message }
    await logInterno({ usuario_id: user.id, usuario, proceso: "clave_personal", resultado: "correo_recuperacion_confirmado", detalle: { destino: enmascararCorreo(fila.destino) } })
    return { success: true, correo: enmascararCorreo(fila.destino) || "", message: "Correo de recuperación confirmado. Ahí llegarán tus códigos." }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo confirmar el correo." }
  }
}

// ===========================================================================
// ADMINISTRACIÓN
// ===========================================================================

async function emailsPorUsuario(sb: any): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  const perPage = 1000
  let page = 1
  for (let guard = 0; guard < 50; guard++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage })
    if (error) break
    const users = data?.users ?? []
    for (const u of users) out[u.id] = u.email ?? null
    if (users.length < perPage) break
    page += 1
  }
  return out
}

export async function adminGetResumen(): Promise<Resp<{ data: ResumenAutorizaciones }>> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    const sb: any = await getSupabaseAdminAsSystem()
    const adminUser = await getCurrentUser().catch(() => null)
    const [
      { data: procesos },
      { data: perfiles },
      { data: pp },
      { data: profiles },
      { data: claves },
      { data: asig },
      { data: exc },
      { data: emps },
      transicionHasta,
      emails,
      { data: correosRec },
    ] = await Promise.all([
      sb.from("autorizacion_procesos").select("*").order("orden"),
      sb.from("autorizacion_perfiles").select("*").order("nombre"),
      sb.from("autorizacion_perfil_procesos").select("perfil_id, proceso"),
      sb.from("profiles").select("id, usuario, empresa_id").order("usuario"),
      sb.from("autorizacion_claves").select("usuario_id, provisional, bloqueado_hasta, actualizado_en"),
      sb.from("autorizacion_usuario_perfiles").select("id, usuario_id, perfil_id, idempresa"),
      sb.from("autorizacion_usuario_procesos").select("id, usuario_id, proceso, idempresa, permitir"),
      sb.from("empresas").select("id, nombre").order("id"),
      getTransicionHasta(sb),
      emailsPorUsuario(sb),
      sb.from("autorizacion_correos").select("usuario_id, correo, verificado"),
    ])
    // MISMO criterio que Gestión de Usuarios: solo cuentas con fila en
    // permisos_usuarios. Las que no la tienen (cuentas viejas "quitadas") no se
    // muestran allá y tampoco aquí, para no resucitarlas en pantalla.
    const { data: conPermisos } = await sb.from("permisos_usuarios").select("usuario_id")
    const visibles = new Set((conPermisos ?? []).map((r: any) => String(r.usuario_id)))
    const profilesVisibles = (profiles ?? []).filter((u: any) => visibles.has(String(u.id)))
    const correoRecPorUsuario = new Map<string, any>((correosRec ?? []).map((c: any) => [String(c.usuario_id), c]))
    // ¿El dominio del correo de acceso recibe mensajes? (caché por dominio dentro de dominioRecibeCorreo)
    const recibePorDominio = new Map<string, boolean | null>()
    const recibe = async (email: string | null) => {
      const dom = String(email ?? "").split("@")[1]?.toLowerCase()
      if (!dom) return null
      if (!recibePorDominio.has(dom)) recibePorDominio.set(dom, await dominioRecibeCorreo(email))
      return recibePorDominio.get(dom) ?? null
    }
    const perfilNombre = new Map<number, string>((perfiles ?? []).map((p: any) => [Number(p.id), String(p.nombre)]))
    const usuariosPorPerfil = new Map<number, number>()
    for (const a of asig ?? []) usuariosPorPerfil.set(Number(a.perfil_id), (usuariosPorPerfil.get(Number(a.perfil_id)) || 0) + 1)

    const perfilesOut: PerfilAutorizacion[] = (perfiles ?? []).map((p: any) => ({
      id: Number(p.id),
      nombre: p.nombre,
      descripcion: p.descripcion ?? null,
      activo: p.activo !== false,
      procesos: (pp ?? []).filter((r: any) => Number(r.perfil_id) === Number(p.id)).map((r: any) => String(r.proceso)),
      usuarios: usuariosPorPerfil.get(Number(p.id)) || 0,
    }))
    const clavePorUsuario = new Map<string, any>((claves ?? []).map((c: any) => [String(c.usuario_id), c]))
    const usuarios: UsuarioAutorizacion[] = []
    for (const u of profilesVisibles) {
      const c = clavePorUsuario.get(String(u.id))
      const email = emails[String(u.id)] ?? null
      const rec = correoRecPorUsuario.get(String(u.id))
      usuarios.push({
        id: String(u.id),
        usuario: String(u.usuario ?? ""),
        empresa_id: u.empresa_id == null ? null : Number(u.empresa_id),
        email,
        emailRecibe: await recibe(email),
        correoRecuperacion: rec?.correo ?? null,
        correoRecuperacionVerificado: Boolean(rec?.verificado),
        tieneClave: Boolean(c),
        provisional: Boolean(c?.provisional),
        bloqueadaHasta: c?.bloqueado_hasta && new Date(c.bloqueado_hasta).getTime() > Date.now() ? c.bloqueado_hasta : null,
        actualizadaEn: c?.actualizado_en ?? null,
        perfiles: (asig ?? [])
          .filter((a: any) => String(a.usuario_id) === String(u.id))
          .map((a: any) => ({ id: Number(a.id), perfil_id: Number(a.perfil_id), perfil: perfilNombre.get(Number(a.perfil_id)) || `Perfil ${a.perfil_id}`, idempresa: a.idempresa == null ? null : Number(a.idempresa) })),
        excepciones: (exc ?? [])
          .filter((e: any) => String(e.usuario_id) === String(u.id))
          .map((e: any) => ({ id: Number(e.id), proceso: String(e.proceso), idempresa: e.idempresa == null ? null : Number(e.idempresa), permitir: e.permitir !== false })),
      })
    }
    return {
      success: true,
      data: {
        procesos: (procesos ?? []) as ProcesoAutorizable[],
        perfiles: perfilesOut,
        usuarios,
        empresas: (emps ?? []).map((e: any) => ({ id: Number(e.id), nombre: String(e.nombre) })),
        transicionHasta,
        correoConfigurado: correoConfigurado(),
        correoRemitente: remitenteCorreo(),
        correoRemitentePrueba: remitenteEsDePrueba(),
        correoAdmin: adminUser?.email ?? null,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo cargar la información." }
  }
}

export async function adminGuardarPerfil(input: { id?: number | null; nombre: string; descripcion?: string | null; activo?: boolean; procesos: string[] }): Promise<Resp<{ id: number }>> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    const nombre = String(input.nombre || "").trim()
    if (!nombre) return { success: false, message: "El perfil necesita un nombre." }
    const procesos = Array.from(new Set((input.procesos ?? []).map((p) => String(p).trim()).filter(Boolean)))
    const sb: any = await getSupabaseAdmin()
    let id = input.id ? Number(input.id) : null

    // Candado financiero: si el perfil YA está asignado a usuarios sin acceso
    // financiero, no se le pueden agregar procesos financieros.
    if (id) {
      const soloLip = await procesosSoloLip(sb)
      if (procesos.some((p) => soloLip.has(p))) {
        const { data: asignados } = await sb.from("autorizacion_usuario_perfiles").select("usuario_id").eq("perfil_id", id)
        const sinAcceso: string[] = []
        for (const uid of Array.from(new Set((asignados ?? []).map((a: any) => String(a.usuario_id))))) {
          if (!(await usuarioTieneAccesoFinanciero(sb, uid as string))) sinAcceso.push((await nombreDeUsuario(sb, uid as string)) || (uid as string))
        }
        if (sinAcceso.length) {
          return {
            success: false,
            message: `No se puede: este perfil está asignado a usuarios sin módulos de Gestión Financiera (${sinAcceso.join(", ")}). ${MSG_SOLO_LIP} Quítales el perfil o crea un perfil aparte para lo financiero.`,
          }
        }
      }
    }

    if (id) {
      const { error } = await sb.from("autorizacion_perfiles").update({ nombre, descripcion: input.descripcion ?? null, activo: input.activo !== false }).eq("id", id)
      if (error) return { success: false, message: error.code === "23505" ? "Ya existe un perfil con ese nombre." : error.message }
    } else {
      const { data, error } = await sb.from("autorizacion_perfiles").insert({ nombre, descripcion: input.descripcion ?? null, activo: input.activo !== false }).select("id").single()
      if (error) return { success: false, message: error.code === "23505" ? "Ya existe un perfil con ese nombre." : error.message }
      id = Number(data.id)
    }
    await sb.from("autorizacion_perfil_procesos").delete().eq("perfil_id", id)
    if (procesos.length) {
      const { error } = await sb.from("autorizacion_perfil_procesos").insert(procesos.map((proceso) => ({ perfil_id: id, proceso })))
      if (error) return { success: false, message: error.message }
    }
    const admin = await getCurrentUsuarioForInsert()
    await logInterno({ usuario_id: null, usuario: admin, proceso: "admin_perfil", resultado: "guardado", autorizado_por: admin, referencia: nombre, detalle: { id, procesos } })
    return { success: true, id: id! }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo guardar el perfil." }
  }
}

export async function adminEliminarPerfil(id: number): Promise<Resp> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    const sb: any = await getSupabaseAdmin()
    const { count } = await sb.from("autorizacion_usuario_perfiles").select("id", { count: "exact", head: true }).eq("perfil_id", id)
    if (Number(count || 0) > 0) return { success: false, message: `Este perfil está asignado a ${count} usuario(s). Quítaselo primero (o desactívalo).` }
    const { error } = await sb.from("autorizacion_perfiles").delete().eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo eliminar el perfil." }
  }
}

export async function adminAsignarPerfil(usuarioId: string, perfilId: number, idempresa: number | null): Promise<Resp> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    if (!usuarioId || !perfilId) return { success: false, message: "Usuario y perfil son obligatorios." }
    const sb: any = await getSupabaseAdmin()
    const admin = await getCurrentUsuarioForInsert()
    const { data: pp } = await sb.from("autorizacion_perfil_procesos").select("proceso").eq("perfil_id", perfilId)
    const rechazo = await rechazoFinanciero(sb, usuarioId, (pp ?? []).map((r: any) => String(r.proceso)))
    if (rechazo) return { success: false, message: rechazo }
    const { error } = await sb.from("autorizacion_usuario_perfiles").insert({ usuario_id: usuarioId, perfil_id: perfilId, idempresa: idempresa ?? null, asignado_por: admin })
    if (error && error.code !== "23505") return { success: false, message: error.message }
    if (error?.code === "23505") return { success: false, message: "Ese usuario ya tiene ese perfil con ese alcance." }
    await logInterno({ usuario_id: usuarioId, usuario: await nombreDeUsuario(sb, usuarioId), proceso: "admin_asignacion", resultado: "perfil_asignado", autorizado_por: admin, detalle: { perfilId, idempresa } })
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo asignar el perfil." }
  }
}

export async function adminQuitarPerfil(asignacionId: number): Promise<Resp> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    const sb: any = await getSupabaseAdmin()
    const { data: fila } = await sb.from("autorizacion_usuario_perfiles").select("usuario_id, perfil_id, idempresa").eq("id", asignacionId).maybeSingle()
    const { error } = await sb.from("autorizacion_usuario_perfiles").delete().eq("id", asignacionId)
    if (error) return { success: false, message: error.message }
    const admin = await getCurrentUsuarioForInsert()
    if (fila) await logInterno({ usuario_id: fila.usuario_id, usuario: await nombreDeUsuario(sb, fila.usuario_id), proceso: "admin_asignacion", resultado: "perfil_quitado", autorizado_por: admin, detalle: { perfilId: fila.perfil_id, idempresa: fila.idempresa } })
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo quitar el perfil." }
  }
}

export async function adminGuardarExcepcion(usuarioId: string, proceso: string, idempresa: number | null, permitir: boolean): Promise<Resp> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    if (!usuarioId || !proceso) return { success: false, message: "Usuario y proceso son obligatorios." }
    const sb: any = await getSupabaseAdmin()
    const admin = await getCurrentUsuarioForInsert()
    if (permitir) {
      const rechazo = await rechazoFinanciero(sb, usuarioId, [proceso])
      if (rechazo) return { success: false, message: rechazo }
    }
    let del = sb.from("autorizacion_usuario_procesos").delete().eq("usuario_id", usuarioId).eq("proceso", proceso)
    del = idempresa == null ? del.is("idempresa", null) : del.eq("idempresa", idempresa)
    await del
    const { error } = await sb.from("autorizacion_usuario_procesos").insert({ usuario_id: usuarioId, proceso, idempresa: idempresa ?? null, permitir, asignado_por: admin })
    if (error) return { success: false, message: error.message }
    await logInterno({ usuario_id: usuarioId, usuario: await nombreDeUsuario(sb, usuarioId), proceso: "admin_excepcion", resultado: permitir ? "concedida" : "negada", autorizado_por: admin, referencia: proceso, detalle: { idempresa } })
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo guardar la excepción." }
  }
}

export async function adminQuitarExcepcion(id: number): Promise<Resp> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("autorizacion_usuario_procesos").delete().eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo quitar la excepción." }
  }
}

/** Asigna una clave PROVISIONAL (se muestra UNA vez al admin). El usuario debe definir la suya al primer uso. */
export async function adminClaveProvisional(usuarioId: string): Promise<Resp<{ clave: string }>> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    if (!usuarioId) return { success: false, message: "Usuario no especificado." }
    const sb: any = await getSupabaseAdmin()
    const admin = await getCurrentUsuarioForInsert()
    const clave = generarClaveProvisional()
    const { error } = await sb.from("autorizacion_claves").upsert(
      {
        usuario_id: usuarioId,
        clave_hash: hashClave(clave),
        provisional: true,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        actualizado_en: new Date().toISOString(),
        actualizado_por: `${admin} (provisional)`,
      },
      { onConflict: "usuario_id" },
    )
    if (error) return { success: false, message: error.message }
    await logInterno({ usuario_id: usuarioId, usuario: await nombreDeUsuario(sb, usuarioId), proceso: "clave_personal", resultado: "provisional_asignada", autorizado_por: admin })
    return { success: true, clave }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo generar la clave provisional." }
  }
}

export async function adminDesbloquearClave(usuarioId: string): Promise<Resp> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("autorizacion_claves").update({ intentos_fallidos: 0, bloqueado_hasta: null }).eq("usuario_id", usuarioId)
    if (error) return { success: false, message: error.message }
    const admin = await getCurrentUsuarioForInsert()
    await logInterno({ usuario_id: usuarioId, usuario: await nombreDeUsuario(sb, usuarioId), proceso: "clave_personal", resultado: "desbloqueada", autorizado_por: admin })
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo desbloquear." }
  }
}

/** Registra (o quita, con null) el correo REAL de recuperación de un usuario. Queda "sin verificar" hasta que el usuario lo confirme, pero ya sirve para enviarle códigos. */
export async function adminSetCorreoRecuperacion(usuarioId: string, correo: string | null): Promise<Resp> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    if (!usuarioId) return { success: false, message: "Usuario no especificado." }
    const sb: any = await getSupabaseAdmin()
    const admin = await getCurrentUsuarioForInsert()
    const c = String(correo || "").trim().toLowerCase()
    if (!c) {
      const { error } = await sb.from("autorizacion_correos").delete().eq("usuario_id", usuarioId)
      if (error) return { success: false, message: error.message }
      await logInterno({ usuario_id: usuarioId, usuario: await nombreDeUsuario(sb, usuarioId), proceso: "clave_personal", resultado: "correo_recuperacion_quitado", autorizado_por: admin })
      return { success: true, message: "Correo de recuperación eliminado." }
    }
    if (!formatoCorreoValido(c)) return { success: false, message: "Escribe un correo válido." }
    if ((await dominioRecibeCorreo(c)) === false) return { success: false, message: `El dominio de ${c} no recibe correo (no tiene buzones). Usa un correo real.` }
    const { error } = await sb.from("autorizacion_correos").upsert(
      { usuario_id: usuarioId, correo: c, verificado: false, origen: "admin", actualizado_en: new Date().toISOString(), actualizado_por: admin },
      { onConflict: "usuario_id" },
    )
    if (error) return { success: false, message: error.message }
    await logInterno({ usuario_id: usuarioId, usuario: await nombreDeUsuario(sb, usuarioId), proceso: "clave_personal", resultado: "correo_recuperacion_asignado", autorizado_por: admin, detalle: { destino: enmascararCorreo(c) } })
    return { success: true, message: `Correo de recuperación guardado: ${c}.` }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo guardar el correo." }
  }
}

/** Elimina la clave del usuario (p. ej. retiro). Sus perfiles se conservan; al volver debe crear una nueva. */
export async function adminEliminarClave(usuarioId: string): Promise<Resp> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("autorizacion_claves").delete().eq("usuario_id", usuarioId)
    if (error) return { success: false, message: error.message }
    const admin = await getCurrentUsuarioForInsert()
    await logInterno({ usuario_id: usuarioId, usuario: await nombreDeUsuario(sb, usuarioId), proceso: "clave_personal", resultado: "eliminada_por_admin", autorizado_por: admin })
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo eliminar la clave." }
  }
}

/**
 * Envía un correo de PRUEBA al correo del administrador en sesión y devuelve la
 * respuesta exacta del proveedor. Sirve para diagnosticar la configuración de
 * Resend (API key, remitente, dominio verificado) desde el propio despliegue,
 * que es donde viven las variables de entorno.
 */
export async function adminProbarCorreo(): Promise<Resp<{ detalle: string; remitente: string; destino: string }>> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    const user = await getCurrentUser()
    if (!user) return { success: false, message: "No hay sesión activa." }
    const sbLectura: any = await getSupabaseAdminAsSystem()
    const dest = await destinoRecuperacion(sbLectura, user)
    if (!dest.ok) return { success: false, message: dest.error.replace("de esta ventana", "de «Mi clave de autorización» (menú del avatar)") }
    const destino = dest.correo
    const remitente = remitenteCorreo()
    if (!correoConfigurado()) {
      return { success: false, remitente, destino, message: "RESEND_API_KEY no está definida en el entorno de este despliegue. En Vercel: Settings › Environment Variables › agregar RESEND_API_KEY (y EMAIL_FROM) y volver a desplegar." }
    }
    const r = await enviarCorreo({
      to: destino,
      subject: "LIPgo · prueba de correo (Autorizaciones por clave)",
      text: `Prueba de envío desde LIPgo. Remitente: ${remitente}. Si lees esto, la recuperación de clave por correo funciona.`,
      html: `<p>Prueba de envío desde <b>LIPgo</b>.</p><p>Remitente: ${remitente}</p><p>Si lees esto, la recuperación de clave por correo funciona.</p>`,
    })
    const admin = await getCurrentUsuarioForInsert()
    await logInterno({ usuario_id: user?.id ?? null, usuario: admin, proceso: "admin_correo", resultado: r.ok ? "prueba_enviada" : "prueba_fallida", autorizado_por: admin, detalle: { destino: enmascararCorreo(destino), remitente, error: r.detalle ?? r.error ?? null } })
    if (!r.ok) return { success: false, remitente, destino, message: r.error, detalle: r.detalle ?? "" }
    return { success: true, remitente, destino, message: `Correo de prueba enviado a ${destino} desde ${remitente}. Revisa la bandeja (y spam).`, detalle: "HTTP 200" }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo probar el correo." }
  }
}

/** Fecha hasta la que siguen valiendo las claves compartidas. `null` = terminar la transición hoy. */
export async function adminSetTransicion(fecha: string | null): Promise<Resp<{ transicionHasta: string | null }>> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    let valor: string
    if (fecha == null || fecha === "") {
      const ayer = new Date(Date.now() - 5 * 3600 * 1000)
      ayer.setUTCDate(ayer.getUTCDate() - 1)
      valor = ayer.toISOString().slice(0, 10)
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { success: false, message: "Fecha inválida (AAAA-MM-DD)." }
      valor = fecha
    }
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("autorizacion_config").upsert({ clave: CONFIG_TRANSICION, valor, actualizado_en: new Date().toISOString() }, { onConflict: "clave" })
    if (error) return { success: false, message: error.message }
    const admin = await getCurrentUsuarioForInsert()
    await logInterno({ usuario_id: null, usuario: admin, proceso: "admin_transicion", resultado: valor < hoyColombiaISO() ? "terminada" : "fecha_actualizada", autorizado_por: admin, referencia: valor })
    return { success: true, transicionHasta: valor }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo actualizar la transición." }
  }
}

export async function adminGetLog(opts?: {
  limit?: number
  usuarioId?: string | null
  resultado?: string | null
  /** Proyecto del selector global: trae sus registros MÁS los sin proyecto (financiero, claves, administración). */
  idempresa?: number | null
}): Promise<Resp<{ data: LogAutorizacion[] }>> {
  try {
    if (!(await assertAdmin())) return { success: false, message: "No autorizado" }
    const sb: any = await getSupabaseAdminAsSystem()
    let q = sb
      .from("autorizacion_log")
      .select("id, usuario, proceso, idempresa, resultado, autorizado_por, referencia, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(Math.min(Math.max(Number(opts?.limit) || 300, 1), 1000))
    if (opts?.usuarioId) q = q.eq("usuario_id", opts.usuarioId)
    if (opts?.resultado) q = q.eq("resultado", opts.resultado)
    if (opts?.idempresa != null && Number(opts.idempresa) > 0) q = q.or(`idempresa.is.null,idempresa.eq.${Number(opts.idempresa)}`)
    const { data, error } = await q
    if (error) return { success: false, message: error.message }
    return { success: true, data: (data ?? []) as LogAutorizacion[] }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo leer la bitácora." }
  }
}
