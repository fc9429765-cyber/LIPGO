"use server"

// Registro de ubicación de la sesión (08:00, 14:00 y 17:00; ver
// components/global-location-scheduler.tsx).
//
// Antes el navegador insertaba directo en `registro_conexiones` con su propio
// `usuario_id`: cualquiera con sesión podía escribir una ubicación a nombre de
// otro. Ahora el usuario sale de la sesión del servidor y la fila la escribe el
// rol de servicio (Fase 3 del plan de políticas por acción, 2026-10-07). No
// lleva puerta de módulo: es telemetría del propio usuario, no una acción de
// una pantalla.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"

export async function registrarConexion(input: { latitud: number; longitud: number; accion: string }): Promise<{ success: boolean; message?: string }> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { success: false, message: "Sesión requerida." }
  const lat = Number(input.latitud)
  const lng = Number(input.longitud)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { success: false, message: "Coordenadas inválidas." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("registro_conexiones").insert({
      usuario_id: user.id,
      latitud: lat,
      longitud: lng,
      accion: String(input.accion ?? "").slice(0, 60),
    })
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo registrar la conexión." }
  }
}
