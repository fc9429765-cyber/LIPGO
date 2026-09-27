import "server-only"

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
