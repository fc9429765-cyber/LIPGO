import "server-only"

// PUERTA DE SESIÓN Y DE MÓDULO PARA LAS RUTAS /api/*.
//
// Las rutas de `app/api` son URLs públicas: si no preguntan quién llama, cualquiera que las
// conozca puede usarlas, con o sin sesión. Hasta la Fase 0 (2026-10-07) la mayoría no preguntaba:
// corrían con rol de servicio y respondían a quien fuera. Estas dos funciones son el equivalente,
// para rutas, de `exigirModulo` (server actions, lib/puerta-modulo.ts).
//
// REGLA: lecturas = sesión; escrituras = el módulo de la pantalla que las usa. Antes de poner la
// puerta a una ruta, CLASIFICA SUS CONSUMIDORES (lección del SQL 221): busca quién hace `fetch` a
// esa URL y desde qué pantalla; si varias, el módulo de todas va en la lista.
//
// Devuelven un `NextResponse` listo para retornar cuando NO se puede pasar, o `null` si sí:
//
//   const puerta = await exigirSesionApi()
//   if (puerta) return puerta
//
//   const puerta = await exigirModuloApi(["Solicitar Facturas", "Cuadro de Control Facturación"])
//   if (puerta) return puerta
//
// `scripts/check-rutas-api.mjs` falla si una ruta no usa ninguna puerta (ni estas, ni el cliente
// de sesión, ni el secreto del cron) y no está en la línea base con un motivo escrito.

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-actions"
import { checkModulePermission } from "@/lib/permissions-actions"

/** 401 si no hay sesión; `null` si la hay. */
export async function exigirSesionApi(): Promise<NextResponse | null> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ success: false, error: "Sesión requerida." }, { status: 401 })
  return null
}

/**
 * 401 sin sesión; 403 si la persona no tiene NINGUNO de los módulos (nombres EXACTOS del menú,
 * como en `MODULE_PERMISSION_MAP`); `null` si puede pasar.
 */
export async function exigirModuloApi(modulos: string[]): Promise<NextResponse | null> {
  const sinSesion = await exigirSesionApi()
  if (sinSesion) return sinSesion
  for (const m of modulos) {
    if (await checkModulePermission(m)) return null
  }
  return NextResponse.json({ success: false, error: `Sin permiso para ${modulos[0]}.` }, { status: 403 })
}
