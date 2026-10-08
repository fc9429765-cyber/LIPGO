"use client"

import { useEffect, useState } from "react"
import { getUserModulesCached } from "@/lib/user-modules-client-cache"
import type { Verbo } from "@/lib/permisos-verbos"
import { claveAccion, nivelDe } from "@/lib/politicas-modulos"

export interface ModulePermissions {
  protectedModules: Set<string>
  allowedModules: Set<string>
  /** Claves de acción `<llave>__<verbo>` permitidas (plan 2026-10-07). */
  allowedActions: Set<string>
  /** 'aviso' (las puertas registran y dejan pasar) o 'bloquear'. */
  modoPoliticas: "aviso" | "bloquear"
  /** false mientras se carga la primera respuesta de /api/user-modules. */
  loaded: boolean
  /** true si el módulo no está protegido, o si está protegido y permitido. */
  isModuleVisible: (moduleName: string) => boolean
  /**
   * ¿Puede hacer `verbo` en `modulo`? Para deshabilitar botones. Mientras carga
   * devuelve false: el botón deshabilitado es el estado honesto, y la barrera
   * real es el servidor (exigirAccion). Una acción cuya columna aún no existe
   * en la base (SQL 262 sin correr) se trata como permitida, igual que en el
   * servidor. En modo 'aviso' siempre true: nada cambia para el usuario.
   */
  puedeAccion: (modulo: string, verbo: Verbo) => boolean
  /** true si el catálogo declara esa acción CON CLAVE (hay que pedir la clave personal). */
  accionConClave: (modulo: string, verbo: Verbo) => boolean
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
  const [allowedActions, setAllowedActions] = useState<Set<string>>(new Set())
  const [modoPoliticas, setModoPoliticas] = useState<"aviso" | "bloquear">("aviso")
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
        setAllowedActions(new Set(data.allowedActions))
        setModoPoliticas(data.modoPoliticas)
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

  const puedeAccion = (modulo: string, verbo: Verbo): boolean => {
    if (!loaded) return false
    if (!allowedModules.has(modulo)) return false
    if (modoPoliticas === "aviso") return true
    const nivel = nivelDe(modulo, verbo)
    // Con clave: el botón se muestra; la clave se pide al pulsar.
    if (nivel === "clave") return true
    const key = claveAccion(modulo, verbo)
    if (!key) return false
    return allowedActions.has(key)
  }

  const accionConClave = (modulo: string, verbo: Verbo): boolean => nivelDe(modulo, verbo) === "clave"

  return { protectedModules, allowedModules, allowedActions, modoPoliticas, loaded, isModuleVisible, puedeAccion, accionConClave }
}
