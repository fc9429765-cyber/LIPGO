"use client"


import { setVisibleInterval } from "@/lib/polling"
import { useState, useEffect } from "react"
import { getUserPermissionsCached } from "@/lib/permissions-client-cache"

interface ConteoCiclicoAlerta {
  tipo: "vencido" | "diferencia"
  mensaje: string
  cuadre_id?: number
  ultima_fecha?: string | null
  dias_desde_ultimo?: number | null
  total_diferencia?: number
  estado?: string
}

interface UseConteoCiclicoAlertsResult {
  alerts: ConteoCiclicoAlerta[]
  count: number
  loading: boolean
  hasPermission: boolean
}

/**
 * Hook que expone el conteo y detalle de alertas de conteo cíclico de
 * inventario (vencido o con diferencia sin resolver) para la empresa activa.
 * Solo habilita la alerta si el usuario tiene permiso `cuadre_inventario`
 * (el conteo cíclico vive en Cuadre de Inventario, no en Auditoría).
 */
export function useConteoCiclicoAlerts(
  empresaId: number | null,
  userId?: string,
): UseConteoCiclicoAlertsResult {
  const [alerts, setAlerts] = useState<ConteoCiclicoAlerta[]>([])
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
        const permissions = await getUserPermissionsCached(userId)

        if (!permissions || !(permissions as any).cuadre_inventario) {
          setHasPermission(false)
          setLoading(false)
          return
        }

        setHasPermission(true)

        const response = await fetch(`/api/conteo-ciclico-alerts?empresaId=${empresaId}`)

        if (!response.ok) {
          setLoading(false)
          return
        }

        const data = await response.json()
        setAlerts(data.alerts || [])
        setCount(data.count || 0)
      } catch (error) {
        console.error("Error loading conteo ciclico alerts:", error)
      } finally {
        setLoading(false)
      }
    }

    checkPermissionAndLoadAlerts()

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
