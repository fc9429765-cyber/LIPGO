import { NextRequest, NextResponse } from "next/server"
import { evaluarYEnviarAlertas } from "@/lib/alertas-bsc-core"
import { registrarErrorServidor } from "@/lib/errores-servidor"

// CRON DIARIO (06:30 Bogotá, ver vercel.json): evalúa las suscripciones a indicadores del
// BSC contra el mes en curso y envía por correo los que están fuera de meta. Un mismo
// aviso (suscripción + severidad) se envía una vez al día. Protegido con CRON_SECRET,
// como los demás cron. También acepta ?simular=1 para ver qué haría sin enviar.

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    console.error("[cron/alertas-bsc] CRON_SECRET no configurado: el cron falla cerrado.")
    return NextResponse.json({ ok: false, error: "CRON_SECRET no configurado" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })
  }
  const simular = new URL(req.url).searchParams.get("simular") === "1"
  try {
    const r = await evaluarYEnviarAlertas({ simular })
    return NextResponse.json({ ok: true, simular, ...r })
  } catch (e: any) {
    void registrarErrorServidor("cron.alertas-bsc", e)
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}
