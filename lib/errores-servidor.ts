import "server-only"

// Registro de errores del SERVIDOR en app_errores (SQL 217), para usar en los catch de
// las server actions críticas: `void registrarErrorServidor("pedidos-cola.depurar", e, { empresaId })`.
// Nunca lanza; si falta la tabla, solo deja un aviso en el log.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"

export async function registrarErrorServidor(contexto: string, error: unknown, extra?: Record<string, unknown>): Promise<void> {
  try {
    const e: any = error
    const sb: any = await getSupabaseAdminAsSystem()
    const { error: err } = await sb.from("app_errores").insert({
      origen: "servidor",
      mensaje: `${contexto}: ${e?.message ?? String(e)}`.slice(0, 2000),
      stack: e?.stack ? String(e.stack).slice(0, 8000) : null,
      modulo: contexto.slice(0, 120),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      entorno: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      extra: extra ?? null,
    })
    if (err) console.warn("[errores] servidor, no se pudo guardar (¿falta SQL 217?):", err.message)
  } catch {
    /* nunca romper la acción por el monitoreo */
  }
}
