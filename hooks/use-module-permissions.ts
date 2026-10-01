"use client"

import { useEffect, useState } from "react"
import { getUserModulesCached } from "@/lib/user-modules-client-cache"

interface UserModulesResponse {
  protectedModules: string[]
  allowedModules: string[]
}

export interface ModulePermissions {
  protectedModules: Set<string>
  allowedModules: Set<string>
  /** false mientras se carga la primera respuesta de /api/user-modules. */
  loaded: boolean
  /** true si el módulo no está protegido, o si está protegido y permitido. */
  isModuleVisible: (moduleName: string) => boolean
}

/**
 * Permisos de módulo del usuario actual — mismo criterio y misma fuente
 * (`/api/user-modules`) que ya usa `components/sidebar.tsx` para decidir qué
 * se ve en el menú. Se extrajo como hook aparte para que Inicio (module-cards)
 * y la vista de grupo (modules-view) puedan aplicar el MISMO filtro sin
 * duplicar la carga ni arriesgar el sidebar, que ya funciona bien.
 *
 * Antes de que carguen los permisos se muestra todo (`loaded=false` →
 * `isModuleVisible` siempre true), para no parpadear vacío en el primer
 * render — el `PermissionGuard` real sigue siendo la barrera de verdad al
 * abrir el contenido de un módulo.
 */
export function useModulePermissions(): ModulePermissions {
  const [protectedModules, setProtectedModules] = useState<Set<string>>(new Set())
  const [allowedModules, setAllowedModules] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // `no-store`: mismo motivo que en sidebar.tsx — sin esto un permiso
        // recién otorgado no aparece hasta un refresco fuerte.
        const data = await getUserModulesCached()
        if (cancelled) return
        setProtectedModules(new Set(data.protectedModules))
        setAllowedModules(new Set(data.allowedModules))
        setLoaded(true)
      } catch {
        if (!cancelled) setLoaded(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const isModuleVisible = (moduleName: string): boolean => {
    if (!loaded) return true
    if (!protectedModules.has(moduleName)) return true
    return allowedModules.has(moduleName)
  }

  return { protectedModules, allowedModules, loaded, isModuleVisible }
}
