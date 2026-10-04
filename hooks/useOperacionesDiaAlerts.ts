"use client"


import { setVisibleInterval } from "@/lib/polling"
import { getUserModulesCached } from "@/lib/user-modules-client-cache"
import { useEffect, useState } from "react"

export interface OperacionDiaAlert {
  ordendecargue: string
  cliente: string
  placa: string
  tipooperacion: string
  estado: string
  faltaIni: boolean
  faltaFin: boolean
  motivo: string
}

/**
 * Alerta 3: Operaciones del Dia con falta de Ini.Op y/o Fin.Op.
 * Reutiliza el permiso `dashboard_operacion` (mismo modulo donde se
 * pinta la tabla y donde el usuario completa esos campos).
 */
export function useOperacionesDiaAlerts(
  empresaId: number | null,
  userId: string | undefined,
) {
  const [alerts, setAlerts] = useState<OperacionDiaAlert[]>([])
  const [hasPermission, setHasPermission] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!empresaId || !userId) {
        setLoading(false)
        return
      }
      try {
        // Antes este hook llamaba a `/api/user-permissions` que NO
        // existe en la app, por lo que el fetch fallaba (404), se
        // forzaba `hasPermission=false` y la alerta nunca se pintaba
        // aunque hubiera ordenes sin Fin.Op. La fuente real de
        // permisos del cliente es `/api/user-modules`, que devuelve
        // los modulos cuyo flag de permiso esta activo. Verificamos
        // que "Dashboard Operacion" este en esa lista.
        const permData = await getUserModulesCached().catch(() => null)
        if (!permData) {
          if (!cancelled) {
            setHasPermission(false)
            setLoading(false)
          }
          return
        }
        const allowedModules: string[] = permData.allowedModules
        const allowed = allowedModules.includes("Dashboard Operacion")
        if (!cancelled) setHasPermission(allowed)
        if (!allowed) {
          if (!cancelled) setLoading(false)
          return
        }

        const res = await fetch(
          `/api/operaciones-dia-alerts?empresaId=${empresaId}`,
          { cache: "no-store" },
        )
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setAlerts(data.alerts ?? [])
        }
      } catch (err) {
        console.error("[v0] useOperacionesDiaAlerts error:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    const detener = setVisibleInterval(run, 120000)
    return () => {
      cancelled = true
      detener()
    }
  }, [empresaId, userId])

  return {
    alerts,
    count: alerts.length,
    hasPermission,
    loading,
  }
}
