import { getUserPermissions } from "@/lib/permissions-actions"

// Los 11 hooks de alertas de la barra superior pedían cada uno los permisos del
// usuario (consulta a permisos_usuarios) en cada ciclo de refresco: ≥12 lecturas
// idénticas en el primer render y ~6 por ciclo. Una sola promesa compartida por
// usuario durante 5 min (misma respuesta para todos los hooks).
const TTL_MS = 5 * 60 * 1000
type Permisos = Awaited<ReturnType<typeof getUserPermissions>>
const vigentes = new Map<string, { exp: number; promesa: Promise<Permisos> }>()

export function getUserPermissionsCached(userId?: string): Promise<Permisos> {
  const clave = userId ?? "__actual__"
  const hit = vigentes.get(clave)
  if (hit && hit.exp > Date.now()) return hit.promesa
  const promesa = getUserPermissions(userId).catch((e) => {
    vigentes.delete(clave)
    throw e
  })
  vigentes.set(clave, { exp: Date.now() + TTL_MS, promesa })
  return promesa
}

// Para invalidar tras guardar permisos (Gestión de Usuarios) sin esperar el TTL.
export function invalidarPermisosCache(): void {
  vigentes.clear()
}
