"use server"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { createServerClient } from "@/lib/supabase-server"
import { fetchConAvisoTruncamiento } from "@/lib/supabase-fetch-truncamiento"
import { cache } from "react"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Tipo de esquema PERMISIVO: este proyecto no versiona tipos generados de la BD,
// así que sin un `Database` el cliente resolvía cada tabla a `never` y rompía
// `.from()/.insert()/.select()` en todo el repo. Tipar el cliente como
// SupabaseClient<any,any,any> en el helper (una sola vez) restablece el uso sin
// afectar runtime.
type DBClient = SupabaseClient<any, any, any>

// AUDITORÍA: cada cliente admin lleva ligado el header `x-audit-user` con el UUID
// del usuario logueado. El trigger de BD `fn_auditoria` lee ese header y así sabe
// QUIÉN hizo cada cambio (con service-role, `auth.uid()` sería NULL). Se cachea un
// cliente por actor para no recrearlo en cada llamada. Clave `__system__` = sin
// header (cron/background/contextos sin cookies) → auditoría queda como 'sistema'.
const SYSTEM = "__system__"
const clientsByActor = new Map<string, DBClient>()

function buildClient(auditUser?: string): DBClient {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    // `fetch` envuelto: avisa en el log cuando una consulta se trunca en
    // silencio a 1.000 filas (ver lib/supabase-fetch-truncamiento.ts).
    global: { fetch: fetchConAvisoTruncamiento, ...(auditUser ? { headers: { "x-audit-user": auditUser } } : {}) },
  })
}

// Resuelve el UUID del usuario logueado con el MISMO mecanismo probado que usa el
// resto de la app (permisos, filtro por empresa): el cliente `@supabase/ssr` +
// `auth.getUser()`, que reensambla y valida la cookie de sesión correctamente. El
// parseo manual anterior de la cookie fallaba y dejaba TODA la auditoría como
// 'sistema'. Memoizado por request (React `cache`) porque getSupabaseAdmin se llama
// en cada escritura → una sola validación por request. Devuelve null fuera de sesión
// (cron/jobs/contextos sin cookie) → auditoría 'sistema'.
const resolverActorId = cache(async (): Promise<string | null> => {
  try {
    const sb = createServerClient()
    const {
      data: { user },
    } = await sb.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
})

// Cliente admin service-role del usuario actual (para ESCRITURAS → auditoría con
// el actor correcto). Misma firma de siempre; el interior ahora inyecta el actor.
export async function getSupabaseAdmin(): Promise<DBClient> {
  const actor = await resolverActorId()
  const key = actor ?? SYSTEM
  let client = clientsByActor.get(key)
  if (!client) {
    client = buildClient(actor ?? undefined)
    clientsByActor.set(key, client)
  }
  return client
}

// Cliente admin SIN actor (auditoría = 'sistema'). Úsalo para LECTURAS puras y
// para jobs/cron, para no crear un cliente por-actor innecesario.
export async function getSupabaseAdminAsSystem(): Promise<DBClient> {
  let client = clientsByActor.get(SYSTEM)
  if (!client) {
    client = buildClient()
    clientsByActor.set(SYSTEM, client)
  }
  return client
}
