import "server-only"

// Guardas de SERVIDOR para acciones sensibles (financieras y de gestión de usuarios).
//
// POR QUÉ. El `PermissionGuard` de la UI solo esconde pantallas; las server actions corren
// con service role, así que si no verifican por sí mismas, cualquiera con sesión podría
// invocarlas. Y el segundo factor hasta hoy solo se pedía en la pantalla de inicio de sesión:
// una sesión vieja que siguiera abierta podía ejecutar acciones financieras sin el código.
//
// REGLA DE GERENCIA (2026-10-05): "no debes afectar los permisos que ya tienen los usuarios
// en este momento". Estas guardas NO cambian ningún permiso:
//   · `exigirSegundoFactorSiActivo` solo detiene a quien YA activó su segundo factor y no lo
//     verificó en esta sesión. Quien no lo tiene activado sigue exactamente igual que hoy.
//   · `exigirAdministradorUsuarios` comprueba el MISMO módulo "Gestión de Usuarios" que ya
//     exige la UI y `user-admin-actions.ts`: no otorga ni quita nada, solo hace que el
//     servidor respete lo que ya está parametrizado.
//
// La decisión pura y sus pruebas viven en lib/segundo-factor.ts.

import { createServerClient } from "@/lib/supabase-server"
import { checkModulePermission } from "@/lib/permissions-actions"
import { decidirSegundoFactor, ErrorSegundoFactor, type EstadoSegundoFactor } from "@/lib/segundo-factor"

const MODULO_GESTION_USUARIOS = "Gestión de Usuarios"

/** Nivel del segundo factor de la sesión actual. Si no se puede leer, se trata como "sin factor": nunca se bloquea por un fallo de lectura. */
export async function nivelSegundoFactor(): Promise<EstadoSegundoFactor> {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) return decidirSegundoFactor(null)
    return decidirSegundoFactor({ currentLevel: data.currentLevel as any, nextLevel: data.nextLevel as any })
  } catch {
    return decidirSegundoFactor(null)
  }
}

/**
 * Detiene la acción (lanza `ErrorSegundoFactor`) SOLO si la cuenta tiene el segundo factor
 * activado y esta sesión no lo verificó. Para todos los demás es un no-op.
 */
export async function exigirSegundoFactorSiActivo(contexto?: string): Promise<void> {
  const n = await nivelSegundoFactor()
  if (n.exigir) {
    console.warn(`[seguridad] acción sensible sin segundo factor verificado${contexto ? ` (${contexto})` : ""}`)
    throw new ErrorSegundoFactor()
  }
}

/** Igual que la anterior, pero devuelve el mensaje en vez de lanzar: para acciones que responden `{ success, message }`. */
export async function segundoFactorPendiente(contexto?: string): Promise<string | null> {
  try {
    await exigirSegundoFactorSiActivo(contexto)
    return null
  } catch (e: any) {
    return e?.message || "Esta acción exige tu segundo factor."
  }
}

/**
 * Gestión de Usuarios: el llamante debe tener ese módulo (el mismo que ya exige la UI) y, si
 * tiene segundo factor activado, haberlo verificado. Devuelve el motivo si no puede.
 */
export async function exigirAdministradorUsuarios(contexto?: string): Promise<string | null> {
  const esAdmin = await checkModulePermission(MODULO_GESTION_USUARIOS).catch(() => false)
  if (!esAdmin) {
    console.warn(`[seguridad] intento de administrar usuarios sin el módulo "${MODULO_GESTION_USUARIOS}"${contexto ? ` (${contexto})` : ""}`)
    return `Esta acción es solo para quien tiene el módulo "${MODULO_GESTION_USUARIOS}".`
  }
  return segundoFactorPendiente(contexto)
}
