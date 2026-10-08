"use server"

// ACCESO POR EMPRESA Y OWNER DE CADA USUARIO (perfil_acceso_empresas / perfil_acceso_owners).
//
// SEGURIDAD (Fase 0, 2026-10-07). Hasta hoy este archivo NO tenía "use server": lo importaban
// cuatro pantallas y, por eso, viajaba al navegador y consultaba esas tablas con la sesión del
// usuario. Dos consecuencias: (1) `grantUserAccess`/`revokeUserAccess` eran llamables desde la
// consola del navegador por cualquiera con sesión, sin pasar por Gestión de Usuarios; (2) era el
// único lector de `perfil_acceso_*` fuera del servidor, lo que impedía cerrar esas tablas al rol
// `authenticated` (SQL 260). Ahora corre en el servidor con rol de servicio, los otorgamientos
// exigen el módulo "Gestión de Usuarios" (misma guarda que `updateUserPermissions`), y leer el
// acceso de OTRO usuario también es solo para administradores: el propio, cualquiera.
//
// Los tipos (`Empresa`, `Owner`, …) viven en lib/user-access-tipos.ts.

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"
import { getCurrentEmpresaId } from "@/lib/user-context"
import { exigirAdministradorUsuarios } from "@/lib/seguridad-servidor"
import type { Empresa, Owner, UserProfile } from "@/lib/user-access-tipos"

/** El usuario puede ver su propio acceso; el de otro, solo si administra usuarios. */
async function puedeLeerAccesoDe(profileId: string): Promise<boolean> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return false
  if (user.id === profileId) return true
  return (await exigirAdministradorUsuarios("user-access.leer")) === null
}

export async function getAllUsers(selectedEmpresaId?: number | null): Promise<UserProfile[]> {
  try {
    if (!(await getCurrentUser().catch(() => null))) return []
    const supabase = await getSupabaseAdminAsSystem()
    // Usa la empresa seleccionada en el selector superior; si no hay,
    // cae a la empresa del perfil del usuario actual.
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

    const { data, error } = await supabase
      .from("profiles")
      .select("id, usuario")
      .eq("empresa_id", empresaId)
      .order("usuario", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching users:", error)
      return []
    }
    return data || []
  } catch (error) {
    console.error("[v0] Error in getAllUsers:", error)
    return []
  }
}

export async function getAllEmpresas(): Promise<Empresa[]> {
  try {
    if (!(await getCurrentUser().catch(() => null))) return []
    const supabase = await getSupabaseAdminAsSystem()
    const { data, error } = await supabase
      .from("empresas_permisos")
      .select("id, nombre")
      .order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching empresas:", error)
      return []
    }
    return data || []
  } catch (error) {
    console.error("[v0] Error in getAllEmpresas:", error)
    return []
  }
}

export async function getUserAccess(profileId: string): Promise<number[]> {
  try {
    if (!(await puedeLeerAccesoDe(profileId))) return []
    const supabase = await getSupabaseAdminAsSystem()
    const { data, error } = await supabase
      .from("perfil_acceso_empresas")
      .select("empresa_id")
      .eq("profile_id", profileId)

    if (error) {
      console.error("[v0] Error fetching user access:", error)
      return []
    }
    return data?.map((item: any) => item.empresa_id) || []
  } catch (error) {
    console.error("[v0] Error in getUserAccess:", error)
    return []
  }
}

export async function grantUserAccess(profileId: string, empresaId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const motivo = await exigirAdministradorUsuarios("user-access.grant")
    if (motivo) return { success: false, error: motivo }
    const supabase = await getSupabaseAdmin()

    const { data: existingAccess, error: checkError } = await supabase
      .from("perfil_acceso_empresas")
      .select("id")
      .eq("profile_id", profileId)
      .eq("empresa_id", empresaId)
      .maybeSingle()

    if (checkError) {
      console.error("[v0] Error checking existing access:", checkError)
      return { success: false, error: checkError.message }
    }
    if (existingAccess) return { success: true }

    const { error: insertError } = await supabase
      .from("perfil_acceso_empresas")
      .insert([{ profile_id: profileId, empresa_id: empresaId }])
    if (insertError) {
      console.error("[v0] Error granting access:", insertError)
      return { success: false, error: insertError.message }
    }
    return { success: true }
  } catch (error) {
    console.error("[v0] Error in grantUserAccess:", error)
    return { success: false, error: "Error granting access" }
  }
}

export async function revokeUserAccess(profileId: string, empresaId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const motivo = await exigirAdministradorUsuarios("user-access.revoke")
    if (motivo) return { success: false, error: motivo }
    const supabase = await getSupabaseAdmin()

    const { error } = await supabase
      .from("perfil_acceso_empresas")
      .delete()
      .eq("profile_id", profileId)
      .eq("empresa_id", empresaId)

    if (error) {
      console.error("[v0] Error revoking access:", error)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (error) {
    console.error("[v0] Error in revokeUserAccess:", error)
    return { success: false, error: "Error revoking access" }
  }
}

// ==================== OWNERS ====================

export async function getAllOwners(): Promise<Owner[]> {
  try {
    if (!(await getCurrentUser().catch(() => null))) return []
    const supabase = await getSupabaseAdminAsSystem()
    const { data, error } = await supabase
      .from("owners")
      .select("id, nombre")
      .order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching owners:", error)
      return []
    }
    return data || []
  } catch (error) {
    console.error("[v0] Error in getAllOwners:", error)
    return []
  }
}

export async function getUserOwnerAccess(profileId: string): Promise<string[]> {
  try {
    if (!(await puedeLeerAccesoDe(profileId))) return []
    const supabase = await getSupabaseAdminAsSystem()
    const { data, error } = await supabase
      .from("perfil_acceso_owners")
      .select("owner")
      .eq("profile_id", profileId)

    if (error) {
      console.error("[v0] Error fetching user owner access:", error)
      return []
    }
    return data?.map((item: any) => item.owner) || []
  } catch (error) {
    console.error("[v0] Error in getUserOwnerAccess:", error)
    return []
  }
}

export async function grantUserOwnerAccess(profileId: string, ownerName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const motivo = await exigirAdministradorUsuarios("user-access.grant-owner")
    if (motivo) return { success: false, error: motivo }
    const supabase = await getSupabaseAdmin()

    const { data: existingAccess, error: checkError } = await supabase
      .from("perfil_acceso_owners")
      .select("id")
      .eq("profile_id", profileId)
      .eq("owner", ownerName)
      .maybeSingle()

    if (checkError) {
      console.error("[v0] Error checking existing owner access:", checkError)
      return { success: false, error: checkError.message }
    }
    if (existingAccess) return { success: true }

    const { error: insertError } = await supabase
      .from("perfil_acceso_owners")
      .insert([{ profile_id: profileId, owner: ownerName }])
    if (insertError) {
      console.error("[v0] Error granting owner access:", insertError)
      return { success: false, error: insertError.message }
    }
    return { success: true }
  } catch (error) {
    console.error("[v0] Error in grantUserOwnerAccess:", error)
    return { success: false, error: "Error granting owner access" }
  }
}

export async function revokeUserOwnerAccess(profileId: string, ownerName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const motivo = await exigirAdministradorUsuarios("user-access.revoke-owner")
    if (motivo) return { success: false, error: motivo }
    const supabase = await getSupabaseAdmin()

    const { error } = await supabase
      .from("perfil_acceso_owners")
      .delete()
      .eq("profile_id", profileId)
      .eq("owner", ownerName)

    if (error) {
      console.error("[v0] Error revoking owner access:", error)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (error) {
    console.error("[v0] Error in revokeUserOwnerAccess:", error)
    return { success: false, error: "Error revoking owner access" }
  }
}
