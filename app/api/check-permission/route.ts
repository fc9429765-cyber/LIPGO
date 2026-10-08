import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-actions"
import { checkModulePermission } from "@/lib/permissions-actions"

// La consulta del <PermissionGuard>: "¿puedo ver este módulo?".
//
// FALLA CERRADO (Fase 0, 2026-10-07). Antes, ante cualquier error (base caída, fila ilegible),
// respondía 200 con `hasPermission: true`: un fallo del servidor abría TODAS las pantallas a
// todo el mundo. Un guard que no puede comprobar debe esconder, no mostrar: ahora responde 401
// sin sesión y 500 con `hasPermission: false` cuando algo falla. La pantalla queda en blanco,
// que es exactamente lo que pasa hoy cuando no hay permiso.
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return NextResponse.json({ error: "Sesión requerida", hasPermission: false }, { status: 401 })

    const { moduleName } = await request.json()
    if (!moduleName) {
      return NextResponse.json({ error: "Module name is required", hasPermission: false }, { status: 400 })
    }

    const hasPermission = await checkModulePermission(moduleName)
    return NextResponse.json({ hasPermission })
  } catch (error) {
    console.error("[v0] Error checking permission:", error)
    return NextResponse.json({ error: "Failed to check permission", hasPermission: false }, { status: 500 })
  }
}
