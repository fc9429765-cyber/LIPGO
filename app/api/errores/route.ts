import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth-actions"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"

// Recibe los errores del navegador (lib/errores-app.ts) y los guarda en app_errores
// (SQL 217) con el usuario de la sesión, la versión desplegada y el entorno.
// Siempre responde 204: el monitoreo nunca puede romper nada ni filtrar detalles.
// Límite: 30 reportes por minuto por usuario (o por IP sin sesión).

export const runtime = "nodejs"

const ventana = new Map<string, { n: number; t: number }>()
const MAX_POR_MINUTO = 30

const corto = (v: unknown, max: number): string | null => (v == null || v === "" ? null : String(v).slice(0, max))

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json().catch(() => null)
    if (!body || typeof body.mensaje !== "string") return new NextResponse(null, { status: 204 })

    const user = await getCurrentUser().catch(() => null)
    const clave = user?.id ?? req.headers.get("x-forwarded-for") ?? "anon"
    const ahora = Date.now()
    const v = ventana.get(clave)
    if (v && ahora - v.t < 60_000) {
      if (v.n >= MAX_POR_MINUTO) return new NextResponse(null, { status: 204 })
      v.n++
    } else ventana.set(clave, { n: 1, t: ahora })
    if (ventana.size > 5000) ventana.clear()

    const sb: any = await getSupabaseAdminAsSystem()
    const { error } = await sb.from("app_errores").insert({
      origen: ["cliente", "promesa", "boundary"].includes(body.origen) ? body.origen : "cliente",
      mensaje: String(body.mensaje).slice(0, 2000),
      stack: corto(body.stack, 8000),
      componente: corto(body.componente, 4000),
      modulo: corto(body.modulo, 120),
      url: corto(body.url, 500),
      navegador: corto(req.headers.get("user-agent"), 300),
      usuario_id: user?.id ?? null,
      usuario: user?.email ?? null,
      empresa_id: Number.isFinite(Number(body.empresaId)) && Number(body.empresaId) > 0 ? Number(body.empresaId) : null,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      entorno: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      extra: body.extra && typeof body.extra === "object" ? body.extra : null,
    })
    if (error) console.warn("[errores] no se pudo guardar el error (¿falta correr el SQL 217?):", error.message)
    return new NextResponse(null, { status: 204 })
  } catch (e: any) {
    console.warn("[errores] ruta:", e?.message ?? e)
    return new NextResponse(null, { status: 204 })
  }
}
