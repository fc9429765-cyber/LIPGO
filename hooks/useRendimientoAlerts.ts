"use client"


import { setVisibleInterval } from "@/lib/polling"
import { getUserModulesCached } from "@/lib/user-modules-client-cache"
import { useState, useEffect } from "react"

export interface RendimientoAlert {
  ordendecargue: string
  cliente: string
  placa: string
  tipooperacion: string
  iniciocargue: string
  tiempo_en_proceso: string
  tiempo_minutos: number
}

export function useRendimientoAlerts(empresaId: number | null, userId: string | undefined) {
  const [alerts, setAlerts] = useState<RendimientoAlert[]>([])
  const [count, setCount] = useState(0)
  const [hasPermission, setHasPermission] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkPermissionAndFetchAlerts = async () => {
      if (!empresaId || !userId) {
        setLoading(false)
        return
      }

      try {
        // Check permission for dashboard_operacion. `/api/user-permissions`
        // NO existe en la app (404 constante en consola) — la fuente real de
        // permisos del cliente es `/api/user-modules`, que devuelve los
        // modulos cuyo flag de permiso esta activo. Mismo patron ya usado en
        // useOperacionesDiaAlerts/useAsistenciaAlerts para este mismo permiso.
        const permData = await getUserModulesCached().catch(() => null)
        if (permData) {
          const allowedModules: string[] = permData.allowedModules
          const hasDashboardOperacionPermission = allowedModules.includes("Dashboard Operacion")
          setHasPermission(hasDashboardOperacionPermission)

          if (!hasDashboardOperacionPermission) {
            setLoading(false)
            return
          }
        } else {
          setHasPermission(false)
          setLoading(false)
          return
        }

        // Fetch operations "En proceso" 
        const response = await fetch(`/api/rendimiento-alerts?empresaId=${empresaId}`)
        if (response.ok) {
          const data = await response.json()
          setAlerts(data.alerts || [])
          setCount(data.alerts?.length || 0)
        }
      } catch (error) {
        console.error("[v0] Error fetching rendimiento alerts:", error)
      } finally {
        setLoading(false)
      }
    }

    checkPermissionAndFetchAlerts()

    // Refresh every 2 minutes
    const detener = setVisibleInterval(checkPermissionAndFetchAlerts, 120000)
    return () => detener()
  }, [empresaId, userId])

  return { alerts, count, hasPermission, loading }
}
