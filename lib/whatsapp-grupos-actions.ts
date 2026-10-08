"use server"

// ---------------------------------------------------------------------------
// GRUPOS DE WHATSAPP (Groups API de la Cloud API)
//
// Permite que un aviso llegue a un grupo en vez de a números sueltos. Meta lo
// abrió en 2025, con restricciones que conviene tener claras ANTES de montarlo
// sobre un flujo real:
//
//   · MÁXIMO 8 PARTICIPANTES. Es un tope duro de Meta, no configurable.
//   · SOLO GRUPOS QUE CREA LA API. Un grupo existente del equipo --creado en
//     WhatsApp normal-- no se puede usar.
//   · CADA UNO ENTRA POR INVITACIÓN. Se comparte un enlace y cada persona
//     acepta; no se agregan solos. No hay endpoint para meter a alguien.
//   · EXIGE Official Business Account. Es un estado distinto de tener la
//     empresa verificada, y si no se tiene, todo esto responde error.
//
// PROBADO EL 23/09/2026 Y NO ESTÁ DISPONIBLE. Meta respondió:
//
//     "Groups APIs are only available for eligible phone numbers."
//
// El número de LIP no es elegible: la documentación dice que hace falta ser
// Official Business Account, y no explica cómo pedirlo. Se deja el código
// porque la elegibilidad puede cambiar --es una marca que Meta otorga con el
// tiempo-- y entonces solo hay que volver a pulsar el botón.
//
// Mientras tanto el flujo real son los destinatarios uno a uno, que no tienen
// ninguna de estas restricciones.
//
// El envío usa el MISMO endpoint de siempre: cambia `recipient_type` a "group"
// y `to` pasa a ser el id del grupo en vez de un teléfono.
// ---------------------------------------------------------------------------

import { getPlantillasDeMeta } from "@/lib/whatsapp-actions"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0"

export interface GrupoWhatsapp {
  id: string
  asunto: string
  descripcion: string | null
  participantes: number
  creadoEn: string | null
}

function credenciales(): { token?: string; phoneId?: string; falta?: string } {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) {
    return { falta: "Falta configurar WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID." }
  }
  return { token, phoneId }
}

/**
 * Traduce los errores de Meta a algo accionable.
 *
 * El más probable aquí es el de cuenta no OBA, que Meta reporta de forma
 * genérica y manda a buscar en el sitio equivocado.
 */
function traducir(err: any, status: number): string {
  const codigo = String(err?.code ?? status)
  const detalle = err?.error_data?.details ?? err?.message ?? `Meta respondió ${status}`

  if (codigo === "200" || /permission|oba|official business/i.test(String(detalle))) {
    return (
      `${detalle} — la Groups API exige que la cuenta sea Official Business Account (OBA), ` +
      `que es un estado distinto de tener la empresa verificada. Se solicita en WhatsApp Manager.`
    )
  }
  // El error real que dio este número (23/09/2026). Meta enlaza a una página
  // que solo dice "hay que ser OBA", sin explicar cómo conseguirlo.
  if (/eligible phone number|not eligible/i.test(String(detalle))) {
    return (
      `Meta no tiene habilitada la función de grupos para este número. ` +
      `Exige que la cuenta sea Official Business Account (OBA), una marca que Meta otorga y que ` +
      `no se puede solicitar desde el panel. Mientras tanto, los avisos van a cada destinatario ` +
      `por separado, que no tiene esa restricción.`
    )
  }
  if (codigo === "100" && /unknown path|nonexisting field/i.test(String(detalle))) {
    return (
      `${detalle} — este número no tiene habilitada la Groups API. Suele ser porque la cuenta ` +
      `no es OBA todavía.`
    )
  }
  return detalle
}

/**
 * Crea un grupo.
 *
 * `auto_approve` hace que quien abra el enlace entre directo. Con
 * `approval_required` alguien tendría que aprobar cada ingreso desde el
 * teléfono, que para un grupo interno de 8 personas es fricción sin ganancia.
 */
export async function crearGrupo(payload: {
  asunto: string
  descripcion?: string
}): Promise<{ success: boolean; grupoId?: string; message?: string }> {
  const { token, phoneId, falta } = credenciales()
  if (falta) return { success: false, message: falta }

  const asunto = String(payload.asunto ?? "").trim()
  if (!asunto) return { success: false, message: "Ponle un nombre al grupo." }
  if (asunto.length > 128) return { success: false, message: "El nombre no puede pasar de 128 caracteres." }

  try {
    const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneId}/groups`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        subject: asunto,
        description: payload.descripcion?.trim() || undefined,
        join_approval_mode: "auto_approve",
      }),
    })
    const j = await r.json()
    if (!r.ok) return { success: false, message: traducir(j?.error, r.status) }

    return { success: true, grupoId: j?.id ?? j?.group_id ?? null }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo contactar a Meta." }
  }
}

/** Los grupos que este número ha creado. */
export async function getGrupos(): Promise<{
  success: boolean
  data?: GrupoWhatsapp[]
  message?: string
}> {
  const { token, phoneId, falta } = credenciales()
  if (falta) return { success: false, message: falta }

  try {
    const r = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${phoneId}/groups?limit=100`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    )
    const j = await r.json()
    if (!r.ok) return { success: false, message: traducir(j?.error, r.status) }

    return {
      success: true,
      data: (j?.data ?? []).map((g: any) => ({
        id: String(g.id),
        asunto: g.subject ?? "(sin nombre)",
        descripcion: g.description ?? null,
        participantes: Number(g.total_participant_count ?? 0),
        creadoEn: g.creation_timestamp ?? null,
      })),
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo contactar a Meta." }
  }
}

/**
 * El enlace de invitación.
 *
 * Es la ÚNICA forma de que alguien entre al grupo: no hay endpoint para
 * agregar a una persona. Se le comparte el enlace y ella acepta.
 */
export async function getEnlaceInvitacion(
  grupoId: string,
): Promise<{ success: boolean; enlace?: string; message?: string }> {
  const { token, falta } = credenciales()
  if (falta) return { success: false, message: falta }
  if (!grupoId) return { success: false, message: "Indica el grupo." }

  try {
    const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${grupoId}/invite_link`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    const j = await r.json()
    if (!r.ok) return { success: false, message: traducir(j?.error, r.status) }

    return { success: true, enlace: j?.invite_link ?? j?.link ?? null }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo contactar a Meta." }
  }
}

/** Cuánta gente hay en el grupo, y quiénes. */
export async function getInfoGrupo(grupoId: string): Promise<{
  success: boolean
  data?: { asunto: string; participantes: number; suspendido: boolean }
  message?: string
}> {
  const { token, falta } = credenciales()
  if (falta) return { success: false, message: falta }

  try {
    const r = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${grupoId}?fields=subject,total_participant_count,suspended`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    )
    const j = await r.json()
    if (!r.ok) return { success: false, message: traducir(j?.error, r.status) }

    return {
      success: true,
      data: {
        asunto: j?.subject ?? "(sin nombre)",
        participantes: Number(j?.total_participant_count ?? 0),
        suspendido: j?.suspended === true,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message }
  }
}

/**
 * Manda una plantilla a un grupo.
 *
 * Mismo endpoint que el envío normal: lo que cambia es `recipient_type:
 * "group"` y que `to` lleva el id del grupo en vez de un teléfono.
 *
 * Se registra en `whatsapp_mensajes` igual que cualquier otro envío --cada
 * mensaje se cobra, venga a un grupo o a una persona-- con el id del grupo en
 * el campo del teléfono.
 */
export async function enviarPlantillaAGrupo(input: {
  grupoId: string
  plantilla: string
  /** Valores del cuerpo, en orden. */
  body: string[]
  origen?: string
}): Promise<{ success: boolean; messageId?: string; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Notificaciones al Personal"], "crear", "Enviar a grupo")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const { token, phoneId, falta } = credenciales()
  if (falta) return { success: false, message: falta }
  if (!input.grupoId) return { success: false, message: "Indica el grupo." }

  // El idioma y el formato de las variables se leen de Meta, no se asumen:
  // `en`, `es` y `es_CO` son plantillas distintas, y mandar el formato
  // equivocado falla con un error que no dice cuál es el problema.
  const meta = await getPlantillasDeMeta()
  if (!meta.success) {
    return { success: false, message: `No se pudo consultar a Meta: ${meta.message ?? "sin detalle"}` }
  }
  const propia = meta.data?.find((t) => t.nombre === input.plantilla && t.estado === "APPROVED")
  if (!propia) {
    return { success: false, message: `La plantilla "${input.plantilla}" no está aprobada en Meta.` }
  }

  const conNombre = propia.conNombre
  const nombres = propia.varsBody.length === input.body.length ? propia.varsBody : []
  const parametros = input.body.map((v, i) =>
    conNombre && nombres[i]
      ? { type: "text", parameter_name: nombres[i], text: String(v ?? "") }
      : { type: "text", text: String(v ?? "") },
  )

  const componentes: any[] = [{ type: "body", parameters: parametros }]

  const sb: any = await getSupabaseAdmin()
  const usuario = await getCurrentUsuarioForInsert().catch(() => null)
  const fila = {
    telefono: input.grupoId,
    nombre: "(grupo)",
    plantilla: input.plantilla,
    parametros: input.body,
    origen: input.origen ?? "grupo:prueba",
    enviado_por: usuario ?? null,
  }

  try {
    const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "group",
        to: input.grupoId,
        type: "template",
        template: {
          name: input.plantilla,
          language: { code: propia.idioma },
          components: componentes,
        },
      }),
    })
    const j = await r.json()

    if (!r.ok) {
      const msg = traducir(j?.error, r.status)
      try {
        await sb.from("whatsapp_mensajes").insert({
          ...fila,
          estado: "fallido",
          error_codigo: String(j?.error?.code ?? r.status),
          error_detalle: msg,
        })
      } catch {
        // El registro es para poder revisar después; no vale perder el error.
      }
      return { success: false, message: msg }
    }

    const messageId = j?.messages?.[0]?.id ?? null
    try {
      await sb.from("whatsapp_mensajes").insert({
        ...fila,
        estado: "enviado",
        message_id: messageId,
      })
    } catch {
      // Igual que arriba.
    }
    return { success: true, messageId: messageId ?? undefined }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo contactar a Meta." }
  }
}
