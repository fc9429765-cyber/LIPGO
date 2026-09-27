"use client"

import { setVisibleInterval } from "@/lib/polling"
import { useState, useEffect } from "react"
import { getUserPermissionsCached } from "@/lib/permissions-client-cache"

export interface AjusteInventarioAlerta {
  tipo: "pendiente" | "ejecutado"
  id: number
  codigo: string
  mensaje: string
  motivo?: string | null
  fecha?: string
}

interface UseAjustesInventarioAlertsResult {
  alerts: AjusteInventarioAlerta[]
  count: number
  loading: boolean
  hasPermission: boolean
}

/**
 * Ajustes manuales de inventario por código (601/701/702) de la empresa
 * activa: los que esperan aprobación de Gerencia y los ejecutados en los
 * últimos días (ver app/api/ajustes-inventario-alerts/route.ts). Solo para
 * quien tiene permiso `transacciones_inventario`, que es donde se aprueban.
 */
export function useAjustesInventarioAlerts(empresaId: number | null, userId?: string): UseAjustesInventarioAlertsResult {
  const [alerts, setAlerts] = useState<AjusteInventarioAlerta[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState(false)

  useEffect(() => {
    const cargar = async () => {
      if (!empresaId) {
        setLoading(false)
        return
      }
      try {
        const permissions = await getUserPermissionsCached(userId)
        if (!permissions || !(permissions as any).transacciones_inventario) {
          setHasPermission(false)
          setLoading(false)
          return
        }
        setHasPermission(true)

        const response = await fetch(`/api/ajustes-inventario-alerts?empresaId=${empresaId}`)
        if (!response.ok) {
          setLoading(false)
          return
        }
        const data = await response.json()
        setAlerts(data.alerts || [])
        setCount(data.count || 0)
      } catch (error) {
        console.error("Error loading ajustes de inventario alerts:", error)
      } finally {
        setLoading(false)
      }
    }

    cargar()
    const detener = setVisibleInterval(cargar, 60000)
    return () => detener()
  }, [empresaId, userId])

  return { alerts, count, loading, hasPermission }
}
