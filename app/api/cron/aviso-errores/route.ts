import { NextRequest, NextResponse } from "next/server"
import { revisarYAvisarErrores } from "@/lib/aviso-errores-core"
import { registrarErrorServidor } from "@/lib/errores-servidor"

// CRON DIARIO (ver vercel.json): avisa a gerencia de los errores que la app registró en las
// últimas 24 horas, agrupados por problema. Si no hubo errores, NO manda correo.
// Protegido con CRON_SECRET (falla cerrado). ?forzar=1 envía aunque no haya nada (prueba);
// ?simular=1 revisa y responde qué encontró sin enviar.

export const runtime = "nodejs"
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    console.error("[cron/aviso-errores] CRON_SECRET no configurado: el cron falla cerrado.")
    return NextResponse.json({ ok: false, error: "CRON_SECRET no configurado" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })
  }
  const url = new URL(req.url)
  try {
    const r = await revisarYAvisarErrores({
      forzar: url.searchParams.get("forzar") === "1",
      simular: url.searchParams.get("simular") === "1",
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    void registrarErrorServidor("cron.aviso-errores", e)
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}
