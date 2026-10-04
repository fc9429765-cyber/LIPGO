import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { fetchConAvisoTruncamiento } from "@/lib/supabase-fetch-truncamiento"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

// SEGURIDAD (2026-10-03, paso 6 del programa): este módulo lo importan tanto componentes del
// navegador como 57 archivos de servidor (server actions y rutas /api). En el navegador debe
// usar la clave PÚBLICA (anon) con la sesión del usuario (rol `authenticated`). En el servidor,
// hasta hoy usaba también la clave anon SIN sesión, es decir, consultaba como anónimo; eso
// obligaba a dejar la base abierta al rol `anon`, y cualquiera con la clave pública (viaja en
// el bundle) podía leer y escribir todas las tablas. Ahora en el servidor usa la service role
// (misma clave que lib/supabase-admin.ts) y el SQL 220 cierra el acceso del rol `anon`.
// `SUPABASE_SERVICE_ROLE_KEY` no tiene prefijo NEXT_PUBLIC_: Next nunca la incluye en el
// bundle del navegador, así que allí es `undefined` y se cae a la clave anon.
const enServidor = typeof window === "undefined"
const supabaseKey = (enServidor && process.env.SUPABASE_SERVICE_ROLE_KEY) || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Tipo de esquema PERMISIVO: el proyecto no versiona tipos generados de la BD,
// así que sin un `Database` el cliente resolvía cada tabla a `never` y rompía
// `.from()/.insert()/.select()`. Tipar el cliente como SupabaseClient<any,any,any>
// aquí (una sola vez) restablece el uso sin afectar runtime. Si algún día se
// generan tipos reales, se sustituye `any`.
type DBClient = SupabaseClient<any, any, any>

// Singleton pattern to prevent multiple GoTrueClient instances
let supabaseInstance: DBClient | null = null

// `fetch` envuelto: avisa en la consola cuando una consulta se trunca en
// silencio a 1.000 filas (ver lib/supabase-fetch-truncamiento.ts).
// En el servidor no hay sesión que persistir ni refrescar.
const OPCIONES = enServidor
  ? { global: { fetch: fetchConAvisoTruncamiento }, auth: { persistSession: false, autoRefreshToken: false } }
  : { global: { fetch: fetchConAvisoTruncamiento } }

export async function createClient(): Promise<DBClient> {
  if (!supabaseInstance) {
    supabaseInstance = createSupabaseClient(supabaseUrl, supabaseKey, OPCIONES)
  }
  return supabaseInstance
}

export const supabase: DBClient = (() => {
  if (!supabaseInstance) {
    supabaseInstance = createSupabaseClient(supabaseUrl, supabaseKey, OPCIONES)
  }
  return supabaseInstance
})()
