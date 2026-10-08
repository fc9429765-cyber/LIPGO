"use server"

import { createClient } from "@supabase/supabase-js"
import { createServerClient } from "@/lib/supabase-server"
import { cache } from "react"

export interface UserProfile {
  id: string
  usuario: string
  empresa_id: number
  empresa_nombre: string
  // Nombre del usuario (opcional): varios componentes lo leen (saludo, firmas).
  nombre?: string | null
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, usuario, empresa_id")
      .eq("id", userId)
      .single()

    if (profileError) {
      console.error("[v0] Error fetching profile:", profileError)
      return null
    }

    if (!profiles) {
      console.error("[v0] No profile found for user:", userId)
      return null
    }

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresas")
      .select("id, nombre")
      .eq("id", profiles.empresa_id)
      .single()

    if (empresaError || !empresa) {
      console.error("[v0] Empresa not found for empresa_id:", profiles.empresa_id)
      return null
    }

    return {
      id: profiles.id,
      usuario: profiles.usuario,
      empresa_id: profiles.empresa_id,
      empresa_nombre: empresa.nombre,
    }
  } catch (error) {
    console.error("[v0] Error in getUserProfile:", error)
    return null
  }
}

// Una validación de la cookie de sesión por request (React `cache`): cada puerta
// de servidor --módulo, acción, segundo factor, auditoría-- vuelve a preguntar
// quién es el usuario, y antes cada pregunta era un viaje a Supabase Auth.
const leerUsuarioActual = cache(async () => {
  const supabase = createServerClient()
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error || !user) return null
    return user
  } catch (error) {
    console.error("[v0] Error getting current user:", error)
    return null
  }
})

export async function getCurrentUser() {
  return leerUsuarioActual()
}

export async function signIn(email: string, password: string) {
  const supabase = createServerClient()

  try {
    console.log("[v0] signIn: Attempting authentication...")
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error("[v0] signIn: Authentication error:", error.message)
      return { success: false, error: error.message }
    }

    console.log("[v0] signIn: Authentication successful, user:", data.user?.id)
    return { success: true, user: data.user }
  } catch (error) {
    console.error("[v0] signIn: Exception during sign in:", error)
    return { success: false, error: "Error al iniciar sesión" }
  }
}

export async function signOut() {
  const supabase = createServerClient()

  try {
    const { error } = await supabase.auth.signOut()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("[v0] Error signing out:", error)
    return { success: false, error: "Error al cerrar sesión" }
  }
}
