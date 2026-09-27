// Qué usuarios tienen acceso al área FINANCIERA según la configuración de
// módulos de Gestión de Usuarios (permisos_usuarios). SIN "use server": lo usan
// el servidor (motor de autorización) y las pantallas.
//
// REGLA DEL NEGOCIO (Gerencia General, 2026-09-27): todo lo financiero es
// propiedad de LIP y no se comparte nunca con ningún ID (cliente). Los procesos
// del grupo "Financiera" del catálogo de autorizaciones solo pueden otorgarse y
// usarse por usuarios que YA tengan algún módulo de Gestión Financiera o de
// Compensación (nómina/bonos) en Gestión de Usuarios, que es exclusiva de
// LIPgo. Así el nuevo sistema nunca abre una puerta que la configuración de
// módulos tenga cerrada.
import { groups } from "@/lib/dashboard-data"
import { MODULE_PERMISSION_MAP, type UserPermissions } from "@/lib/permissions-map"

export const GRUPO_PROCESOS_SOLO_LIP = "Financiera"

/** Grupos del menú cuyo contenido es financiero de LIP: Gestión Financiera y Compensación (nómina, bonos, liquidaciones). */
const GRUPOS_FINANCIEROS = new Set(["financiera", "compensacion"])

/**
 * Módulos de Compensación que son gestión OPERATIVA de personal, no dinero:
 * tenerlos NO convierte a un usuario en "financiero" (p. ej. una bodega del
 * cliente con Vacaciones no debe poder recibir un proceso financiero).
 */
const EXCLUIDOS_NO_FINANCIEROS = new Set<string>(["vacaciones", "apoyo_cargue", "asistencia_administrativa"])

/** Columnas de permisos_usuarios que corresponden a módulos financieros (derivadas del menú real, sin lista paralela). */
export function clavesPermisoFinanciero(): (keyof UserPermissions)[] {
  const nombres = groups
    .filter((g) => GRUPOS_FINANCIEROS.has(g.key))
    .flatMap((g) => [...(g.modules ?? []), ...(g.subgroups ?? []).flatMap((s) => s.modules ?? [])])
    .map((m) => m.name)
  const claves = nombres
    .map((n) => MODULE_PERMISSION_MAP[n])
    .filter((k): k is keyof UserPermissions => Boolean(k) && !EXCLUIDOS_NO_FINANCIEROS.has(String(k)))
  return Array.from(new Set(claves))
}

/** true si la fila de permisos_usuarios tiene al menos un módulo financiero habilitado. */
export function tieneAccesoFinanciero(permisos: Record<string, unknown> | null | undefined): boolean {
  if (!permisos) return false
  return clavesPermisoFinanciero().some((k) => permisos[k as string] === true)
}
