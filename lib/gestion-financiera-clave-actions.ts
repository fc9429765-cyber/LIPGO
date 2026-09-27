"use server"

/**
 * Candado del grupo "Gestión Financiera" — control extra (más allá de los
 * permisos granulares de cada submódulo) pedido por gerencia.
 *
 * Desde SQL 203 pasa por el sistema de AUTORIZACIONES POR CLAVE: vale la clave
 * PERSONAL de un usuario cuyo perfil tenga el proceso `fin_gestion_financiera`
 * (perfil "Financiera" o "Gerencia General LIPgo"). La clave compartida
 * histórica (GESTION_FINANCIERA_CLAVE) sigue valiendo solo durante la
 * transición configurada en Autorizaciones por clave.
 */

import { autorizar } from "@/lib/autorizaciones-core"

export async function verificarClaveFinanciera(clave: string): Promise<{ success: boolean; message?: string; autorizadoPor?: string }> {
  const r = await autorizar({ proceso: "fin_gestion_financiera", clave: String(clave ?? ""), referencia: "candado Gestión Financiera" })
  if (!r.ok) return { success: false, message: r.error || "Clave incorrecta." }
  return { success: true, autorizadoPor: r.autorizadoPor }
}
