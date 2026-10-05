"use server"

// ---------------------------------------------------------------------------
// Acciones de ADMINISTRACION de usuarios (crear / resetear contrasena /
// eliminar / leer ultima conexion). A diferencia de `permissions-actions.ts`
// (que solo edita permisos de usuarios ya existentes), aqui se toca el sistema
// de Auth de Supabase via `supabase.auth.admin.*` usando el service-role key.
//
// SEGURIDAD: cada accion se GATEA con `checkModulePermission("Gestión de
// Usuarios")`. El `PermissionGuard` de la UI solo esconde la pantalla; estas
// acciones corren en el servidor con service-role, asi que deben verificar por
// si mismas que el llamante es un administrador. Sin esta verificacion,
// cualquiera con sesion podria invocarlas.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"
import { checkModulePermission } from "@/lib/permissions-actions"
import { segundoFactorPendiente } from "@/lib/seguridad-servidor"
import { updateUserPermissions } from "@/lib/permissions-actions"
import { MODULE_PERMISSION_MAP, type UserPermissions } from "@/lib/permissions-map"
import type { CrearUsuarioInput, AuthMetaUsuario } from "@/lib/user-admin-types"

const MODULO_ADMIN = "Gestión de Usuarios"

async function assertAdmin(): Promise<boolean> {
  const esAdmin = await checkModulePermission(MODULO_ADMIN)
  if (!esAdmin) return false
  // Segundo factor (2026-10-05): si la cuenta lo tiene activado, esta sesión debe haberlo
  // verificado. Quien no lo tiene activado sigue igual que hoy; ningún permiso cambia.
  return (await segundoFactorPendiente("gestion-usuarios")) === null
}

// Todas las columnas de permiso en `false`. Se construye desde la unica fuente
// de verdad (`MODULE_PERMISSION_MAP`): cada valor del mapa es el nombre real de
// una columna booleana en `permisos_usuarios`. Necesario porque esas columnas
// tienen DEFAULT `true`: si insertaramos una fila "vacia", el usuario nuevo
// naceria con TODO habilitado. Con este objeto nace SIN permisos y el admin le
// habilita modulos con el arbol de permisos existente.
function permisosEnFalse(): Partial<UserPermissions> {
  const claves = Array.from(new Set(Object.values(MODULE_PERMISSION_MAP)))
  const out: Record<string, boolean> = {}
  for (const k of claves) out[k as string] = false
  return out as Partial<UserPermissions>
}

export async function crearUsuario(input: CrearUsuarioInput): Promise<{ success: boolean; error?: string; userId?: string }> {
  try {
    if (!(await assertAdmin())) return { success: false, error: "No autorizado" }

    const email = input.email?.trim().toLowerCase()
    const usuario = input.usuario?.trim()
    const password = input.password ?? ""

    if (!email || !password || !usuario || !input.empresaId) {
      return { success: false, error: "Datos incompletos: correo, contraseña, usuario y empresa son obligatorios." }
    }
    if (password.length < 8) {
      return { success: false, error: "La contraseña debe tener al menos 8 caracteres." }
    }

    const supabase = await getSupabaseAdmin()

    // 1) Crear la cuenta en Supabase Auth con el correo YA validado
    //    (email_confirm: true => no se envia correo de confirmacion y el
    //    usuario puede iniciar sesion de inmediato).
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { usuario },
    })

    if (createErr || !created?.user) {
      const msg = createErr?.message || "No se pudo crear la cuenta"
      // Mensaje mas claro para el caso mas comun (correo ya registrado).
      if (/already|registered|exists/i.test(msg)) {
        return { success: false, error: "Ya existe un usuario con ese correo." }
      }
      return { success: false, error: msg }
    }

    const newId = created.user.id

    // 2) Fila en `profiles` (id = auth user id). Si algo falla de aqui en
    //    adelante hacemos ROLLBACK borrando el auth user para no dejar
    //    cuentas huerfanas que puedan iniciar sesion sin perfil.
    const { error: profileErr } = await supabase.from("profiles").insert({
      id: newId,
      usuario,
      empresa_id: input.empresaId,
    })

    if (profileErr) {
      await supabase.auth.admin.deleteUser(newId).catch(() => {})
      return { success: false, error: `Error al crear el perfil: ${profileErr.message}` }
    }

    // 3) Permisos iniciales en `false` (override del DEFAULT true).
    const permResult = await updateUserPermissions(newId, permisosEnFalse())
    if (!permResult.success) {
      await supabase.from("profiles").delete().eq("id", newId)
      await supabase.auth.admin.deleteUser(newId).catch(() => {})
      return { success: false, error: `Error al inicializar permisos: ${permResult.error}` }
    }

    // 4) Accesos opcionales (best-effort: no revierten la creacion del usuario;
    //    el admin puede completarlos luego desde "Accesos de Usuario").
    const empresas = Array.from(new Set([input.empresaId, ...(input.empresasAdicionales ?? [])]))
    if (empresas.length) {
      const rows = empresas.map((empresa_id) => ({ profile_id: newId, empresa_id }))
      const { error } = await supabase.from("perfil_acceso_empresas").insert(rows)
      if (error) console.error("[user-admin] Error insertando perfil_acceso_empresas:", error.message)
    }
    const owners = Array.from(new Set((input.owners ?? []).map((o) => o.trim()).filter(Boolean)))
    if (owners.length) {
      const rows = owners.map((owner) => ({ profile_id: newId, owner }))
      const { error } = await supabase.from("perfil_acceso_owners").insert(rows)
      if (error) console.error("[user-admin] Error insertando perfil_acceso_owners:", error.message)
    }

    return { success: true, userId: newId }
  } catch (error) {
    console.error("[user-admin] Error en crearUsuario:", error)
    return { success: false, error: String(error) }
  }
}

export async function resetearPassword(userId: string, nuevaPassword: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(await assertAdmin())) return { success: false, error: "No autorizado" }
    if (!userId) return { success: false, error: "Usuario no especificado" }
    if (!nuevaPassword || nuevaPassword.length < 8) {
      return { success: false, error: "La contraseña debe tener al menos 8 caracteres." }
    }

    const supabase = await getSupabaseAdmin()
    const { error } = await supabase.auth.admin.updateUserById(userId, { password: nuevaPassword })
    if (error) {
      console.error("[user-admin] Error en resetearPassword:", error.message)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (error) {
    console.error("[user-admin] Error en resetearPassword:", error)
    return { success: false, error: String(error) }
  }
}

export async function eliminarUsuario(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(await assertAdmin())) return { success: false, error: "No autorizado" }
    if (!userId) return { success: false, error: "Usuario no especificado" }

    // Salvaguarda: un admin NO puede eliminarse a si mismo (evita quedarse sin
    // acceso o borrar la propia sesion en curso).
    const current = await getCurrentUser()
    if (current?.id === userId) {
      return { success: false, error: "No puedes eliminar tu propio usuario." }
    }

    const supabase = await getSupabaseAdmin()

    // Borrado explicito y ordenado de las tablas de la app antes de tocar Auth.
    // Es robusto sin depender de la config de ON DELETE de cada FK. Los errores
    // por fila inexistente no son fatales (best-effort por tabla).
    await supabase.from("perfil_acceso_empresas").delete().eq("profile_id", userId)
    await supabase.from("perfil_acceso_owners").delete().eq("profile_id", userId)
    await supabase.from("permisos_usuarios").delete().eq("usuario_id", userId)
    await supabase.from("profiles").delete().eq("id", userId)

    // Por ultimo, la cuenta de Auth.
    const { error } = await supabase.auth.admin.deleteUser(userId)
    if (error) {
      console.error("[user-admin] Error borrando auth user:", error.message)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("[user-admin] Error en eliminarUsuario:", error)
    return { success: false, error: String(error) }
  }
}

// Devuelve un mapa (objeto serializable) userId -> metadatos de Auth. La
// "ultima conexion" (`last_sign_in_at`) es nativa de Supabase Auth y se
// actualiza en cada `signInWithPassword`, asi que no requiere tracking propio.
// Se pagina `listUsers` para cubrir bases grandes.
export async function getAuthMetaUsuarios(): Promise<{ success: boolean; data?: Record<string, AuthMetaUsuario>; error?: string }> {
  try {
    if (!(await assertAdmin())) return { success: false, error: "No autorizado" }

    const supabase = await getSupabaseAdmin()
    const out: Record<string, AuthMetaUsuario> = {}
    const perPage = 1000
    let page = 1

    // Tope de seguridad para no iterar de mas si la API cambiara su contrato.
    for (let guard = 0; guard < 100; guard++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
      if (error) {
        console.error("[user-admin] Error en listUsers:", error.message)
        return { success: false, error: error.message }
      }
      const users = data?.users ?? []
      for (const u of users) {
        out[u.id] = {
          email: u.email ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
          created_at: u.created_at ?? null,
        }
      }
      if (users.length < perPage) break
      page += 1
    }

    return { success: true, data: out }
  } catch (error) {
    console.error("[user-admin] Error en getAuthMetaUsuarios:", error)
    return { success: false, error: String(error) }
  }
}
