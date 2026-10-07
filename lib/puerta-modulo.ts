import "server-only"

// PUERTA DE PERMISO POR MÓDULO, en el SERVIDOR.
//
// POR QUÉ HACE FALTA
//
// Una server action es una URL: cualquiera con sesión puede llamarla, aunque la pantalla
// que la usa esté escondida para él. El `<PermissionGuard>` de la interfaz decide qué se
// PINTA, no qué se puede EJECUTAR. Si la acción no vuelve a preguntar por el permiso, el
// candado está solo en la puerta de vidrio.
//
// Ya pasó: hasta el 2026-10-05, `updateUserPermissions` corría con rol de servicio sin
// verificar a quien llamaba, así que cualquiera con sesión podía darse a sí mismo Estado
// de Resultados o Gestión de Usuarios.
//
// CÓMO SE USA, Y POR QUÉ NO BLOQUEA A NADIE
//
// Se exige el MISMO módulo que la pantalla ya exige para mostrarse. Quien puede ver la
// pantalla pasa; quien no, nunca debió poder llamarla. Cuando una acción la consumen
// varias pantallas, se pasan todos los módulos y basta con tener uno.
//
//   await exigirModulo(["Cargos Fijos"])
//   await exigirModulo(["Cuadro de Control Facturación", "Ciclo de Facturación"])
//
// ANTES DE PONERLE PUERTA A UN ARCHIVO, CLASIFICA SUS CONSUMIDORES. Es la lección del
// incidente del SQL 221 (4-oct): cerrar `headcount` sin mirar quién la consultaba dejó a
// ID2 sin poder marcar asistencia. Busca quién importa el archivo y comprueba desde qué
// pantallas se llega; si son varias, el módulo de todas va en la lista.
//
// SEGUNDO FACTOR: si la cuenta lo tiene activado, esta sesión debe haberlo verificado.
// Quien no lo tiene activado sigue igual que hoy; ningún permiso cambia.

import { getCurrentUser } from "@/lib/auth-actions"
import { checkModulePermission } from "@/lib/permissions-actions"
import { exigirSegundoFactorSiActivo } from "@/lib/seguridad-servidor"

/**
 * Deja pasar si la persona en sesión tiene AL MENOS UNO de los módulos. Si no, lanza.
 *
 * @param modulos  Nombres EXACTOS del menú, tal como aparecen en `MODULE_PERMISSION_MAP`.
 * @param etiqueta Qué se estaba haciendo, para el rastro del segundo factor.
 */
export async function exigirModulo(modulos: string[], etiqueta?: string): Promise<void> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) throw new Error("Sesión requerida.")
  for (const m of modulos) {
    if (await checkModulePermission(m)) {
      await exigirSegundoFactorSiActivo(etiqueta ?? `modulo:${m}`)
      return
    }
  }
  throw new Error(`Sin permiso para ${modulos[0]}.`)
}

/**
 * Igual que `exigirModulo`, pero devuelve un `false` en vez de lanzar. Para acciones que ya
 * contestan `{ success: false, message }` y no quieren que una excepción llegue cruda a la
 * pantalla: en producción Next enmascara los errores lanzados en server actions y el
 * usuario vería un genérico en vez del motivo.
 */
export async function tieneModulo(modulos: string[]): Promise<boolean> {
  try {
    await exigirModulo(modulos)
    return true
  } catch {
    return false
  }
}
