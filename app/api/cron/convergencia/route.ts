import { NextRequest, NextResponse } from "next/server"
import { revisarYAvisarConvergencia } from "@/lib/convergencia-core"
import { registrarErrorServidor } from "@/lib/errores-servidor"

// CRON DIARIO (05:30 Bogotá, ver vercel.json): comprobaciones de convergencia de datos.
// Cruza las cifras entre sí (órdenes vs salidas, pedidos vs libro de órdenes, reservas,
// saldos, duplicados) y avisa a gerencia solo si algo no cuadra o no se pudo comprobar.
// Protegido con CRON_SECRET (falla cerrado). ?simular=1 corre y responde sin enviar ni
// registrar; ?forzar=1 envía aunque todo cuadre (prueba del correo).

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    console.error("[cron/convergencia] CRON_SECRET no configurado: el cron falla cerrado.")
    return NextResponse.json({ ok: false, error: "CRON_SECRET no configurado" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })
  }
  const url = new URL(req.url)
  try {
    const r = await revisarYAvisarConvergencia({
      forzar: url.searchParams.get("forzar") === "1",
      simular: url.searchParams.get("simular") === "1",
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    void registrarErrorServidor("cron.convergencia", e)
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}
