"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"
import { exigirAdministradorUsuarios } from "@/lib/seguridad-servidor"
import { getCurrentEmpresaId } from "@/lib/company-filter"
// La interfaz `UserPermissions` y el mapa `MODULE_PERMISSION_MAP` viven
// en `permissions-map.ts` (sin "use server"). Next.js prohibe exportar
// valores no async desde archivos con "use server", asi que el mapa no
// puede vivir aqui. Importamos desde el modulo compartido.
import { MODULE_PERMISSION_MAP, type UserPermissions } from "@/lib/permissions-map"
import { cache } from "react"

// UNA lectura de la fila de permisos por request (React `cache`, mismo patrón
// que `resolverActorId` en lib/supabase-admin.ts). Una server action que exige
// módulo, acción y segundo factor preguntaba por la misma fila tres veces; y
// con ~400 columnas (acciones por módulo, SQL 262) cada lectura pesa.
// También dejó de imprimirse la fila completa en el log del servidor: son los
// permisos de una persona, no un dato de depuración.
const leerFilaPermisos = cache(async (userId: string): Promise<UserPermissions | null> => {
  const supabase = await getSupabaseAdmin()
  const { data, error } = await supabase.from("permisos_usuarios").select("*").eq("usuario_id", userId).maybeSingle()
  if (error) {
    console.error("Error fetching user permissions:", error.message)
    return null
  }
  return (data as UserPermissions) ?? null
})

export async function getUserPermissions(userId?: string): Promise<UserPermissions | null> {
  try {
    let id = userId
    if (!id) {
      const currentUser = await getCurrentUser()
      if (!currentUser) return null
      id = currentUser.id
    }
    return await leerFilaPermisos(id)
  } catch (error) {
    console.error("Error in getUserPermissions:", error)
    return null
  }
}

export async function checkModulePermission(moduleName: string): Promise<boolean> {
  try {
    const permissionKey = MODULE_PERMISSION_MAP[moduleName]
    if (!permissionKey) {
      console.warn("[permisos] módulo fuera del mapa, se niega:", moduleName)
      return false
    }
    const permissions = await getUserPermissions()
    if (!permissions) return false
    return permissions[permissionKey] === true
  } catch (error) {
    console.error("[permisos] checkModulePermission:", error)
    return false
  }
}

export async function getAllUsersWithPermissions(selectedEmpresaId?: number | null) {
  try {
    const supabase = await getSupabaseAdmin()

    // Use selectedEmpresaId if provided, otherwise fall back to current user's empresa_id
    let empresaId = selectedEmpresaId
    if (!empresaId) {
      empresaId = await getCurrentEmpresaId()
    }

    if (!empresaId) {
      console.error("Error: No empresa_id found for current user")
      return { success: false, error: "No empresa found" }
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(
        `
        id,
        usuario,
        empresa_id,
        permisos_usuarios!inner (*)
      `,
      )
      .eq("empresa_id", empresaId) // Filter by empresa_id
      .order("usuario", { ascending: true })

    if (error) {
      console.error("Error fetching users with permissions:", error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("Error in getAllUsersWithPermissions:", error)
    return { success: false, error: String(error) }
  }
}

export async function updateUserPermissions(userId: string, permissions: Partial<UserPermissions>) {
  try {
    // GUARDA DE SERVIDOR (2026-10-05). Esta acción corre con service role y antes NO verificaba
    // quién la llamaba: cualquiera con sesión podía invocarla y darse a sí mismo cualquier
    // módulo. Exige el MISMO módulo "Gestión de Usuarios" que ya exige la UI y
    // user-admin-actions.ts (no cambia ningún permiso: hace que el servidor respete lo que ya
    // está parametrizado) y, si la cuenta tiene segundo factor activado, que esté verificado.
    // crearUsuario la llama desde una acción ya gateada, así que la creación no se afecta.
    const motivo = await exigirAdministradorUsuarios("updateUserPermissions")
    if (motivo) return { success: false, error: motivo }

    const supabase = await getSupabaseAdmin()

    // Verificar si ya existen permisos para este usuario
    const { data: existing } = await supabase.from("permisos_usuarios").select("id").eq("usuario_id", userId).single()

    if (existing) {
      // Actualizar permisos existentes
      const { error } = await supabase.from("permisos_usuarios").update(permissions).eq("usuario_id", userId)

      if (error) {
        console.error("Error updating user permissions:", error)
        return { success: false, error: error.message }
      }
    } else {
      // Crear nuevos permisos.
      //
      // INSERT ROBUSTO: la secuencia SERIAL de `permisos_usuarios.id` está
      // desincronizada en esta BD (max(id) por delante del nextval, por filas
      // insertadas con id explícito en el pasado). Un insert SIN id choca con la
      // PK (`permisos_usuarios_pkey`, 23505) y rompía la creación de usuarios.
      // Insertamos con id EXPLÍCITO = max(id)+1 y reintentamos ante colisión, así
      // no dependemos del estado de la secuencia.
      let creado = false
      let lastErr: any = null
      for (let intento = 0; intento < 8 && !creado; intento++) {
        const { data: maxRow } = await supabase
          .from("permisos_usuarios")
          .select("id")
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
        const nextId = (maxRow?.id || 0) + 1
        const { error } = await supabase.from("permisos_usuarios").insert({
          id: nextId,
          usuario_id: userId,
          ...permissions,
        })
        if (!error) {
          creado = true
          break
        }
        lastErr = error
        // 23505 = choque de PK por secuencia atrasada / carrera: reintentar con id fresco.
        if ((error as any).code === "23505") continue
        // Otro error: no insistir.
        break
      }
      if (!creado) {
        console.error("Error creating user permissions:", lastErr)
        return { success: false, error: lastErr?.message || "No se pudieron crear los permisos" }
      }
    }

    return { success: true }
  } catch (error) {
    console.error("Error in updateUserPermissions:", error)
    return { success: false, error: String(error) }
  }
}
