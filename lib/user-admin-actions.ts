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
import type { UserPermissions } from "@/lib/permissions-map"
import { CLAVES_PERMISO } from "@/lib/permisos-claves"
import type { CrearUsuarioInput, AuthMetaUsuario } from "@/lib/user-admin-types"
import { autorizarAccion } from "@/lib/puerta-modulo"

const MODULO_ADMIN = "Gestión de Usuarios"

async function assertAdmin(): Promise<boolean> {
  const esAdmin = await checkModulePermission(MODULO_ADMIN)
  if (!esAdmin) return false
  // Segundo factor (2026-10-05): si la cuenta lo tiene activado, esta sesión debe haberlo
  // verificado. Quien no lo tiene activado sigue igual que hoy; ningún permiso cambia.
  return (await segundoFactorPendiente("gestion-usuarios")) === null
}

// Todas las columnas de permiso en `false`. Se construye desde la unica fuente
// de verdad (`CLAVES_PERMISO`: módulos, extras y acciones): cada clave es el
// nombre real de una columna booleana en `permisos_usuarios`. Necesario porque
// las columnas de módulo tienen DEFAULT `true`: si insertaramos una fila
// "vacia", el usuario nuevo naceria con TODO habilitado. Con este objeto nace
// SIN permisos y el admin le habilita modulos con el arbol de permisos.
// (Antes iteraba solo MODULE_PERMISSION_MAP y las extras nunca se sembraban.)
function permisosEnFalse(): Partial<UserPermissions> {
  const out: Record<string, boolean> = {}
  for (const k of CLAVES_PERMISO) out[k] = false
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

export async function eliminarUsuario(userId: string, clave?: string): Promise<{ success: boolean; error?: string }> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Gestión de Usuarios", "eliminar", { clave: clave ?? "", idempresa: null, referencia: `eliminar usuario ${userId}` })
  if (!autorizacionAccion.ok) return { success: false, error: autorizacionAccion.error || "Sin autorización." }
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

    /*
     * SE LIMPIAN LAS DOCE TABLAS QUE APUNTAN A `profiles`, NO TRES.
     *
     * Hasta hoy esto borraba tres y pasaba de largo. El problema (ID4, 2026-10-08, al
     * intentar retirar a los usuarios de Medellín por la entrega del proyecto): las tablas
     * de autorizaciones por clave nacieron después y nadie las añadió aquí, así que el
     * borrado de `profiles` chocaba contra su llave foránea. Y como el error de ese borrado
     * NO se revisaba, seguía de largo hasta Auth y el administrador veía un mensaje de base
     * de datos que no explicaba nada.
     *
     * `auditoria` NO se toca y no hace falta: su `actor_id` es un uuid suelto, sin llave
     * foránea, y el nombre vive aparte en `actor_nombre`, que es texto. El rastro de lo que
     * hizo la persona sobrevive intacto al borrado de su usuario, que es justo lo que se
     * quiere.
     */
    for (const [tabla, col] of [
      ["autorizacion_usuario_perfiles", "usuario_id"],
      ["autorizacion_usuario_procesos", "usuario_id"],
      ["autorizacion_recuperacion", "usuario_id"],
      ["autorizacion_correos", "usuario_id"],
      ["autorizacion_claves", "usuario_id"],
      ["acceso_perfil_usuarios", "profile_id"],
      ["acceso_perfil_materializado", "profile_id"],
      ["permisos_mapa_procesos", "usuario_id"],
      ["perfil_acceso_empresas", "profile_id"],
      ["perfil_acceso_owners", "profile_id"],
      ["permisos_usuarios", "usuario_id"],
    ] as const) {
      const { error } = await supabase.from(tabla).delete().eq(col, userId)
      // Una tabla que todavía no existe (script sin correr) no puede frenar el borrado.
      if (error && !/does not exist|schema cache|not find/i.test(error.message)) {
        console.error(`[user-admin] no se pudo limpiar ${tabla}:`, error.message)
      }
    }

    /*
     * EL CHAT NO SE BORRA EN SILENCIO.
     *
     * `messages.receiver_id` también apunta a `profiles`, pero eso es CONTENIDO, no permisos:
     * son conversaciones que también le pertenecen a quien las escribió. Borrarlas de paso,
     * sin decirlo, destruiría el historial del otro lado. Se cuenta y se informa para que
     * quien administra decida.
     */
    const { count: mensajes } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("receiver_id", userId)
    if (Number(mensajes || 0) > 0) {
      return {
        success: false,
        error:
          `No se eliminó: este usuario tiene ${mensajes} mensaje(s) del chat interno dirigidos a él. ` +
          `Son conversaciones que también le pertenecen a quien las escribió, así que no se borran solas. ` +
          `Si el usuario ya no debe entrar, lo efectivo es quitarle los módulos y bloquear la cuenta: eso le cierra el acceso y conserva el rastro.`,
      }
    }

    const { error: errProfile } = await supabase.from("profiles").delete().eq("id", userId)
    if (errProfile) {
      console.error("[user-admin] Error borrando profiles:", errProfile.message)
      return {
        success: false,
        error: `No se pudo eliminar el perfil del usuario: ${errProfile.message}. Nada quedó a medias: la cuenta sigue existiendo.`,
      }
    }

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
