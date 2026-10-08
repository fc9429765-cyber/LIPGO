import { NextResponse } from "next/server"
import { getUserPermissions } from "@/lib/permissions-actions"
// MODULE_PERMISSION_MAP vive en `permissions-map.ts` (sin "use server"),
// porque Next.js no permite exportar valores no async desde un archivo
// con la directiva "use server".
import { MODULE_PERMISSION_MAP } from "@/lib/permissions-map"
import { esClaveAccion } from "@/lib/permisos-verbos"
import { modoPoliticas } from "@/lib/puerta-modulo"

// Render dinámico explícito: los permisos cambian en caliente (Gestión de
// Usuarios) y una respuesta cacheada dejaría al usuario sin ver un módulo que
// ya le otorgaron. Mismo criterio que app/api/attendance/table/route.ts.
export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Endpoint que devuelve, para el usuario autenticado:
 *   - `protectedModules`: TODOS los nombres de modulos que estan
 *     protegidos por permisos (las claves de MODULE_PERMISSION_MAP).
 *   - `allowedModules`: subconjunto de los anteriores cuyo flag esta
 *     en `true` para el usuario actual.
 *
 * El sidebar usa estos dos sets para decidir que mostrar:
 *   - Si un modulo NO esta en `protectedModules`, se muestra (no esta
 *     gobernado por permisos).
 *   - Si esta protegido, se muestra solo si aparece en `allowedModules`.
 *
 * Esto evita duplicar el mapeo modulo->permiso en el cliente y mantiene
 * una sola fuente de verdad en `lib/permissions-actions.ts`.
 */
export async function GET() {
  try {
    const protectedModules = Object.keys(MODULE_PERMISSION_MAP)

    const permissions = await getUserPermissions()
    if (!permissions) {
      // Sin permisos cargados (usuario no autenticado o sin fila en
      // `permisos_usuarios`): no se permite ningun modulo protegido.
      return NextResponse.json({ protectedModules, allowedModules: [], allowedActions: [], modoPoliticas: "aviso" })
    }

    const allowedModules = protectedModules.filter((moduleName) => {
      const key = MODULE_PERMISSION_MAP[moduleName]
      return permissions[key] === true
    })

    // Acciones por módulo (plan 2026-10-07): las columnas `<llave>__<verbo>` en
    // true. El hook useModulePermissions las usa para deshabilitar botones; la
    // barrera real sigue siendo el servidor (exigirAccion).
    const allowedActions = Object.entries(permissions as unknown as Record<string, unknown>)
      .filter(([k, v]) => v === true && esClaveAccion(k))
      .map(([k]) => k)

    return NextResponse.json({ protectedModules, allowedModules, allowedActions, modoPoliticas: await modoPoliticas() })
  } catch (error) {
    console.error("[v0] /api/user-modules error:", error)
    // En caso de error devolvemos `protectedModules` vacio para no ocultar
    // accidentalmente modulos por un fallo del backend; el guard del modulo
    // sigue siendo la barrera real de acceso.
    return NextResponse.json(
      { protectedModules: [], allowedModules: [], allowedActions: [], modoPoliticas: "aviso" },
      { status: 200 },
    )
  }
}
