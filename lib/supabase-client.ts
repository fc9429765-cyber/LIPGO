import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { createBrowserClient } from "@supabase/ssr"
import { fetchConAvisoTruncamiento } from "@/lib/supabase-fetch-truncamiento"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

// SEGURIDAD (2026-10-03, paso 6 del programa): este módulo lo importan tanto componentes del
// navegador como 57 archivos de servidor (server actions y rutas /api).
//
//  · SERVIDOR: usa la service role (misma clave que lib/supabase-admin.ts). Hasta hoy usaba la
//    clave pública SIN sesión, es decir, consultaba como anónimo; eso obligaba a dejar la base
//    abierta al rol `anon`, y cualquiera con la clave pública podía leer y escribir todas las
//    tablas. El SQL 220 cerró el acceso de `anon`. `SUPABASE_SERVICE_ROLE_KEY` no tiene prefijo
//    NEXT_PUBLIC_: Next nunca la incluye en el bundle del navegador.
//  · NAVEGADOR: usa el MISMO cliente de @supabase/ssr que el inicio de sesión y el AuthProvider
//    (sesión en cookies, rol `authenticated`). Antes era un cliente supabase-js aparte, que
//    guarda la sesión en localStorage: no veía la sesión de las cookies y consultaba como
//    anónimo, lo que funcionaba solo porque la base estaba abierta. Con el SQL 220 esas
//    pantallas (Tabla de asistencia, Marcaciones del día, Control de piso, Generar órdenes de
//    descargue, chat, ubicaciones…) habrían quedado sin datos.
type DBClient = SupabaseClient<any, any, any>

const enServidor = typeof window === "undefined"

let supabaseInstance: DBClient | null = null

function construir(): DBClient {
  if (enServidor) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    // `fetch` envuelto: avisa en la consola cuando una consulta se trunca en silencio a 1.000
    // filas (ver lib/supabase-fetch-truncamiento.ts). En el servidor no hay sesión que persistir.
    return createSupabaseClient(supabaseUrl, key, { global: { fetch: fetchConAvisoTruncamiento }, auth: { persistSession: false, autoRefreshToken: false } })
  }
  // Navegador: cliente de @supabase/ssr (cookies). Es un singleton compartido con el AuthProvider
  // y el login, así que la sesión y el canal de tiempo real son los mismos en toda la app.
  return createBrowserClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { fetch: fetchConAvisoTruncamiento } }) as unknown as DBClient
}

export async function createClient(): Promise<DBClient> {
  if (!supabaseInstance) supabaseInstance = construir()
  return supabaseInstance
}

export const supabase: DBClient = (() => {
  if (!supabaseInstance) supabaseInstance = construir()
  return supabaseInstance
})()
