import "server-only"
import { promises as dns } from "node:dns"

/**
 * Envío de correo transaccional de LIPgo (hoy: código de recuperación de la
 * clave de autorización). Proveedor: Resend (https://resend.com) vía HTTP,
 * sin SDK. Se activa con la variable de entorno RESEND_API_KEY; el remitente
 * es EMAIL_FROM (dominio verificado en Resend, p. ej. "LIPgo <no-reply@lip-sas.com>").
 *
 * OJO: sin EMAIL_FROM se usa el remitente de PRUEBA de Resend
 * (onboarding@resend.dev), que SOLO entrega al correo del dueño de la cuenta
 * de Resend. Para enviar a cualquier usuario hay que verificar un dominio en
 * Resend (registros DNS) y poner EMAIL_FROM con ese dominio.
 *
 * Sin RESEND_API_KEY la función responde `configurado: false` y las pantallas
 * ofrecen el camino asistido (clave provisional desde Gestión de Usuarios).
 * En Vercel, una variable nueva o cambiada solo aplica tras un nuevo despliegue.
 */

const REMITENTE_PRUEBA = "LIPgo <onboarding@resend.dev>"

export function correoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

/** Remitente en uso (EMAIL_FROM o el de prueba de Resend). */
export function remitenteCorreo(): string {
  return (process.env.EMAIL_FROM || "").trim() || REMITENTE_PRUEBA
}

/** true si se está usando el remitente de prueba de Resend (solo llega al dueño de la cuenta). */
export function remitenteEsDePrueba(): boolean {
  return /resend\.dev/i.test(remitenteCorreo())
}

// ¿El dominio de un correo puede RECIBIR mensajes? (tiene registros MX). Las
// cuentas de LIPgo entran con direcciones @lipgo.app que no son buzones: enviar
// ahí un código de recuperación es tirarlo. Caché de 1 h por dominio. Ante un
// error de DNS se responde null (desconocido) y no se bloquea al usuario.
const cacheMx = new Map<string, { exp: number; recibe: boolean }>()

// Consulta MX por DNS-sobre-HTTPS (Google y Cloudflare), independiente del
// resolutor del sistema (en algunos equipos/entornos serverless el de Node no
// responde). Devuelve true/false, o null si ninguno contestó.
async function mxPorDoH(dominio: string): Promise<boolean | null> {
  const fuentes = [
    `https://dns.google/resolve?name=${encodeURIComponent(dominio)}&type=MX`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(dominio)}&type=MX`,
  ]
  for (const url of fuentes) {
    try {
      const r = await fetch(url, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) })
      if (!r.ok) continue
      const j: any = await r.json()
      // Status 0 = NOERROR, 3 = NXDOMAIN. Answer con type 15 = MX.
      if (j?.Status === 3) return false
      if (j?.Status !== 0) continue
      const mx = (j.Answer ?? []).filter((a: any) => a.type === 15 && String(a.data ?? "").trim() && !/\s\.$/.test(String(a.data)))
      return mx.length > 0
    } catch {
      /* siguiente fuente */
    }
  }
  return null
}

export async function dominioRecibeCorreo(email: string | null | undefined): Promise<boolean | null> {
  const dominio = String(email ?? "").split("@")[1]?.trim().toLowerCase()
  if (!dominio) return false
  const hit = cacheMx.get(dominio)
  if (hit && hit.exp > Date.now()) return hit.recibe
  let recibe: boolean | null = null
  try {
    const mx = await dns.resolveMx(dominio)
    recibe = Array.isArray(mx) && mx.some((m) => m.exchange && m.exchange !== ".")
  } catch (e: any) {
    // ENODATA / ENOTFOUND = el dominio existe pero no tiene MX (o no existe): no recibe.
    if (e?.code === "ENODATA" || e?.code === "ENOTFOUND") recibe = false
    else recibe = await mxPorDoH(dominio)
  }
  if (recibe !== null) cacheMx.set(dominio, { exp: Date.now() + 3600_000, recibe })
  return recibe
}

export function formatoCorreoValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email ?? "").trim())
}

export interface ResultadoEnvioCorreo {
  ok: boolean
  /** Explicación para mostrar al usuario/administrador. */
  error?: string
  /** Respuesta cruda del proveedor (código HTTP + mensaje), para diagnóstico. */
  detalle?: string
}

function explicarErrorResend(status: number, cuerpo: string): string {
  let msg = cuerpo
  try {
    const j = JSON.parse(cuerpo)
    msg = String(j?.message || j?.error || cuerpo)
  } catch {
    /* texto plano */
  }
  const m = msg.toLowerCase()
  if (/api key|apikey|unauthorized|invalid.*key|restricted/.test(m) || status === 401) {
    return "La API key de Resend no es válida, fue revocada o no tiene permiso de envío. Revisa RESEND_API_KEY en Vercel y vuelve a desplegar."
  }
  if (/testing emails|own email|verify a domain|not verified|domain/.test(m) || status === 403) {
    return `Resend solo permite enviar correos de PRUEBA al correo del dueño de la cuenta mientras no haya un dominio verificado. Verifica el dominio (p. ej. lip-sas.com) en Resend › Domains, agrega los registros DNS y configura EMAIL_FROM con ese dominio (remitente actual: ${remitenteCorreo()}). Detalle del proveedor: ${msg}`
  }
  if (status === 422 || /from|invalid.*email|validation/.test(m)) {
    return `El remitente o el destinatario no tienen un formato válido (EMAIL_FROM actual: ${remitenteCorreo()}). Usa el formato "LIPgo <no-reply@tu-dominio.com>". Detalle: ${msg}`
  }
  if (status === 429) return "Resend rechazó el envío por límite de tasa. Intenta de nuevo en unos minutos."
  return `El proveedor de correo respondió ${status}: ${msg}`
}

export async function enviarCorreo(opts: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<ResultadoEnvioCorreo> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: "El envío de correos no está configurado (falta RESEND_API_KEY en el entorno del despliegue)." }
  const from = remitenteCorreo()
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text ?? undefined }),
    })
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => "")
      console.error("[email] Resend respondió", res.status, cuerpo.slice(0, 500), "from:", from)
      return { ok: false, error: explicarErrorResend(res.status, cuerpo), detalle: `HTTP ${res.status} · ${cuerpo.slice(0, 300)}` }
    }
    return { ok: true }
  } catch (e: any) {
    console.error("[email] Error enviando:", e?.message || e)
    return { ok: false, error: "No se pudo contactar al proveedor de correo (error de red desde el servidor).", detalle: String(e?.message || e) }
  }
}
