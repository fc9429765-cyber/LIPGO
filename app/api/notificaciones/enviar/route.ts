import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { enviarWhatsApp } from "@/lib/whatsapp"
import { exigirAccionApi } from "@/lib/puerta-api"

export const dynamic = "force-dynamic"
export const revalidate = 0

interface DestinatarioEntrada {
  documento?: string
  nombre?: string
  celular?: string | null
  puesto?: string | null
  fecha?: string | null
  placa?: string | null
  // Horario programado del turno (de Programación de Turnos).
  horario?: string | null
  horaEntrada?: string | null
  horaSalida?: string | null
}

interface CuerpoEnvio {
  empresaId: number
  tipo?: "alerta" | "turno" | "conductor"
  // Plantilla del mensaje con placeholders {nombre} {puesto} {fecha}.
  mensaje: string
  // Nombre de la plantilla aprobada en Meta (envio real). Opcional.
  plantilla?: string
  createdBy?: string
  destinatarios: DestinatarioEntrada[]
}

// Reemplaza {nombre}, {puesto}, {fecha}, {placa}, {horario}, {hora_entrada},
// {hora_salida} en la plantilla.
function renderMensaje(plantilla: string, d: DestinatarioEntrada): string {
  return plantilla
    .replace(/\{nombre\}/gi, d.nombre ?? "")
    .replace(/\{puesto\}/gi, d.puesto ?? "")
    .replace(/\{fecha\}/gi, d.fecha ?? "")
    .replace(/\{placa\}/gi, d.placa ?? "")
    .replace(/\{horario\}/gi, d.horario ?? "")
    .replace(/\{hora_entrada\}/gi, d.horaEntrada ?? "")
    .replace(/\{hora_salida\}/gi, d.horaSalida ?? "")
    .trim()
}

/**
 * POST /api/notificaciones/enviar
 * Envia (o simula) el mensaje a cada destinatario y registra la
 * auditoria en `notificaciones_enviadas`. Devuelve el resumen del lote.
 */
export async function POST(request: NextRequest) {
  const puerta = await exigirAccionApi(["Notificaciones al Personal", "Programación de turnos"], "crear")
  if (puerta) return puerta
  try {
    const body = (await request.json()) as CuerpoEnvio
    const { empresaId, tipo = "alerta", mensaje, plantilla, createdBy, destinatarios } = body

    if (!empresaId) {
      return NextResponse.json({ error: "empresaId es requerido" }, { status: 400 })
    }
    if (!mensaje || !mensaje.trim()) {
      return NextResponse.json({ error: "El mensaje no puede estar vacio" }, { status: 400 })
    }
    if (!Array.isArray(destinatarios) || destinatarios.length === 0) {
      return NextResponse.json({ error: "No hay destinatarios seleccionados" }, { status: 400 })
    }

    const supabase = await getSupabaseAdmin()
    const loteId = globalThis.crypto.randomUUID()

    const filas: Record<string, unknown>[] = []
    const resumen = { total: destinatarios.length, enviados: 0, simulados: 0, sinCelular: 0, errores: 0 }

    // Enviar en serie mantiene el orden y evita rate-limits de Meta.
    // Para volumenes grandes se puede paralelizar por bloques mas adelante.
    for (const d of destinatarios) {
      const textoRenderizado = renderMensaje(mensaje, d)

      const res = await enviarWhatsApp({
        celular: d.celular ?? "",
        mensaje: textoRenderizado,
        plantilla,
      })

      if (res.estado === "enviado") resumen.enviados++
      else if (res.estado === "simulado") resumen.simulados++
      else if (res.estado === "sin_celular") resumen.sinCelular++
      else resumen.errores++

      filas.push({
        idempresa: Number(empresaId),
        lote_id: loteId,
        tipo,
        canal: "whatsapp",
        destinatario_nombre: d.nombre ?? null,
        destinatario_documento: d.documento ?? null,
        destinatario_celular: d.celular ?? null,
        plantilla: plantilla ?? "texto_libre",
        mensaje: textoRenderizado,
        variables: { nombre: d.nombre ?? null, puesto: d.puesto ?? null, fecha: d.fecha ?? null, placa: d.placa ?? null, horario: d.horario ?? null },
        estado: res.estado,
        proveedor_msg_id: res.proveedorMsgId ?? null,
        error: res.error ?? null,
        created_by: createdBy ?? null,
      })
    }

    const { error: errInsert } = await supabase.from("notificaciones_enviadas").insert(filas)
    if (errInsert) {
      console.error("[notificaciones] error guardando auditoria:", errInsert)
      // El envio ya ocurrio; avisamos que fallo el registro pero no
      // rompemos el resultado del envio.
      return NextResponse.json(
        { ...resumen, loteId, warning: "Los mensajes se procesaron pero fallo el registro de auditoria" },
        { status: 200 },
      )
    }

    const simulado = process.env.WHATSAPP_ENABLED !== "true"
    return NextResponse.json({ ...resumen, loteId, simulado })
  } catch (error) {
    console.error("[notificaciones] error en POST enviar:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
