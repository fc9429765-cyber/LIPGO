"use client"


import { setVisibleInterval } from "@/lib/polling"
import { useState, useEffect } from "react"
import { getUserPermissionsCached } from "@/lib/permissions-client-cache"

interface EvaluacionAlerta {
  id: number
  nombre: string
  cargo: string | null
  ultima_evaluacion: string | null
  dias_desde_ultima: number | null
}

interface UseEvaluacionesAlertsResult {
  alerts: EvaluacionAlerta[]
  count: number
  loading: boolean
  hasPermission: boolean
}

/**
 * Hook que expone el conteo y detalle de evaluaciones pendientes para la empresa activa.
 * Solo habilita la alerta si el usuario tiene permiso `evaluacionpersonal` en permisos_usuarios.
 */
export function useEvaluacionesAlerts(
  empresaId: number | null,
  userId?: string,
): UseEvaluacionesAlertsResult {
  const [alerts, setAlerts] = useState<EvaluacionAlerta[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState(false)

  useEffect(() => {
    const checkPermissionAndLoadAlerts = async () => {
      if (!empresaId) {
        setLoading(false)
        return
      }

      try {
        // Verificar el permiso `evaluacionpersonal` antes de consultar
        const permissions = await getUserPermissionsCached(userId)

        if (!permissions || !permissions.evaluacionpersonal) {
          setHasPermission(false)
          setLoading(false)
          return
        }

        setHasPermission(true)

        const response = await fetch(`/api/evaluaciones-alerts?empresaId=${empresaId}`)

        if (!response.ok) {
          setLoading(false)
          return
        }

        const data = await response.json()
        setAlerts(data.alerts || [])
        setCount(data.count || 0)
      } catch (error) {
        console.error("Error loading evaluaciones alerts:", error)
      } finally {
        setLoading(false)
      }
    }

    checkPermissionAndLoadAlerts()

    // Refrescar cada 60 segundos como el resto de alertas
    const detener = setVisibleInterval(checkPermissionAndLoadAlerts, 60000)
    return () => detener()
  }, [empresaId, userId])

  return {
    alerts,
    count,
    loading,
    hasPermission,
  }
}
