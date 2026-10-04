import { NextRequest, NextResponse } from "next/server"
import { generarYEnviarInformes } from "@/lib/informe-semanal-core"
import { registrarErrorServidor } from "@/lib/errores-servidor"

// CRON SEMANAL (lunes 06:00 Bogotá, ver vercel.json): manda el informe de la semana cerrada a
// cada suscripción activa (alerta_suscripciones con indicador 'informe_semanal'), una vez al día.
// Protegido con CRON_SECRET (falla cerrado). ?simular=1 arma los informes sin enviar.

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    console.error("[cron/informe-semanal] CRON_SECRET no configurado: el cron falla cerrado.")
    return NextResponse.json({ ok: false, error: "CRON_SECRET no configurado" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })
  }
  const simular = new URL(req.url).searchParams.get("simular") === "1"
  try {
    const r = await generarYEnviarInformes({ simular })
    return NextResponse.json({ ok: true, simular, ...r })
  } catch (e: any) {
    void registrarErrorServidor("cron.informe-semanal", e)
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}
