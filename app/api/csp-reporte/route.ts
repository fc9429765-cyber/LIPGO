import { NextResponse, type NextRequest } from "next/server"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"

// Recibe los informes de la Content-Security-Policy en modo REPORTE (next.config.mjs) y los
// guarda en app_errores (SQL 217) con origen "csp", para que el aviso diario los muestre.
//
// Modo reporte = la cabecera NO bloquea nada: solo el navegador avisa qué habría bloqueado.
// Así se afina la lista de orígenes con datos reales antes de pasarla a modo estricto, sin
// riesgo de romper una pantalla. Siempre responde 204: el monitoreo nunca rompe nada.
// Límite: 20 informes por minuto por IP (un navegador viejo puede disparar muchos iguales).

export const runtime = "nodejs"

const ventana = new Map<string, { n: number; t: number }>()
const MAX_POR_MINUTO = 20
const corto = (v: unknown, max: number): string | null => (v == null || v === "" ? null : String(v).slice(0, max))

export async function POST(req: NextRequest) {
  try {
    const clave = req.headers.get("x-forwarded-for") ?? "anon"
    const ahora = Date.now()
    const v = ventana.get(clave)
    if (v && ahora - v.t < 60_000) {
      if (v.n >= MAX_POR_MINUTO) return new NextResponse(null, { status: 204 })
      v.n++
    } else ventana.set(clave, { n: 1, t: ahora })
    if (ventana.size > 5000) ventana.clear()

    // Dos formatos: el clásico `{"csp-report": {...}}` (report-uri) y el nuevo Reporting API
    // (`[{type:"csp-violation", body:{...}}]`, report-to). Se aceptan los dos.
    const texto = await req.text().catch(() => "")
    let cuerpo: any = null
    try {
      cuerpo = JSON.parse(texto)
    } catch {
      return new NextResponse(null, { status: 204 })
    }
    const informes: any[] = Array.isArray(cuerpo) ? cuerpo.map((x) => x?.body ?? x) : [cuerpo?.["csp-report"] ?? cuerpo]

    const sb: any = await getSupabaseAdminAsSystem()
    for (const r of informes.slice(0, 5)) {
      if (!r || typeof r !== "object") continue
      const directiva = r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"] ?? r.violatedDirective ?? "desconocida"
      const bloqueado = r["blocked-uri"] ?? r.blockedURL ?? r.blockedUri ?? "inline"
      const documento = r["document-uri"] ?? r.documentURL ?? null
      const fuente = r["source-file"] ?? r.sourceFile ?? null
      const linea = r["line-number"] ?? r.lineNumber ?? null
      await sb
        .from("app_errores")
        .insert({
          origen: "csp",
          mensaje: `CSP ${String(directiva).slice(0, 60)}: ${String(bloqueado).slice(0, 300)}`,
          modulo: `csp.${String(directiva).split(" ")[0].slice(0, 100)}`,
          url: corto(documento, 500),
          navegador: corto(req.headers.get("user-agent"), 300),
          version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
          entorno: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
          extra: { fuente: corto(fuente, 300), linea, disposicion: r.disposition ?? null },
        })
        .then(
          ({ error }: any) => {
            if (error) console.warn("[csp] no se pudo guardar el informe:", error.message)
          },
          () => {},
        )
    }
    return new NextResponse(null, { status: 204 })
  } catch (e: any) {
    console.warn("[csp] ruta:", e?.message ?? e)
    return new NextResponse(null, { status: 204 })
  }
}
