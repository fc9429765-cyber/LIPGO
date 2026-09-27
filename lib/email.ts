import "server-only"

/**
 * Envío de correo transaccional de LIPgo (hoy: código de recuperación de la
 * clave de autorización). Proveedor: Resend (https://resend.com) vía HTTP,
 * sin SDK. Se activa con la variable de entorno RESEND_API_KEY; el remitente
 * es EMAIL_FROM (dominio verificado en Resend, p. ej. "LIPgo <no-reply@lip-sas.com>").
 *
 * Sin RESEND_API_KEY la función responde `configurado: false` y las pantallas
 * ofrecen el camino asistido (clave provisional desde Gestión de Usuarios).
 */

export function correoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function enviarCorreo(opts: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: "El envío de correos no está configurado (RESEND_API_KEY)." }
  const from = process.env.EMAIL_FROM || "LIPgo <onboarding@resend.dev>"
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text ?? undefined }),
    })
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => "")
      console.error("[email] Resend respondió", res.status, cuerpo.slice(0, 500))
      return { ok: false, error: `No se pudo enviar el correo (proveedor respondió ${res.status}).` }
    }
    return { ok: true }
  } catch (e: any) {
    console.error("[email] Error enviando:", e?.message || e)
    return { ok: false, error: "No se pudo enviar el correo (error de red)." }
  }
}
