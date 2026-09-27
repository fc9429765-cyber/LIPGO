import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { fetchConAvisoTruncamiento } from "@/lib/supabase-fetch-truncamiento"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

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
const OPCIONES = { global: { fetch: fetchConAvisoTruncamiento } }

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
