"use client"


import { setVisibleInterval } from "@/lib/polling"
import { useEffect, useState } from "react"
import { getUserPermissionsCached } from "@/lib/permissions-client-cache"

interface CicloFacturacionAlerta {
  id: number
  proyecto: string | null
  owner: string
  estado_ciclo: string
  /** "pendiente_accion" (te toca actuar) y/o "advertencias" (se generó sola
   *  con advertencias -- sin tarifa/sin gestionar/pago no cuadra -- revisa). */
  motivos: string[]
}

interface UseCicloFacturacionAlertsResult {
  alerts: CicloFacturacionAlerta[]
  count: number
  loading: boolean
  hasPermission: boolean
  /**
   * A qué módulo lleva la alerta. Quien tiene los permisos globales del ciclo va a
   * «Ciclo de Facturación»; el coordinador LIP de un proyecto va a «Solicitar
   * Facturas», que es donde vive su bandeja (2026-10-08).
   */
  destino: string
}

/** Pendientes del Ciclo de Facturación que le corresponden al usuario autenticado. */
export function useCicloFacturacionAlerts(): UseCicloFacturacionAlertsResult {
  const [alerts, setAlerts] = useState<CicloFacturacionAlerta[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState(false)
  const [destino, setDestino] = useState("Ciclo de Facturación")

  useEffect(() => {
    const cargar = async () => {
      try {
        /*
         * Antes esto preguntaba primero por el permiso global del ciclo y, sin él,
         * ni consultaba. Así el coordinador LIP de un proyecto —que NO tiene ese
         * permiso y sí tiene firmas esperándolo— nunca recibía la campana. Ahora
         * la ruta decide por la sesión (permiso global o perfil «Coordinador LIP»
         * del proyecto) y la campana se muestra si hay algo que hacer.
         */
        const permisos = await getUserPermissionsCached()
        const permisoGlobal = !!permisos?.ciclo_facturacion_jefe || !!permisos?.ciclo_facturacion_coordinador
        const res = await fetch("/api/ciclo-facturacion-alerts")
        if (!res.ok) {
          setHasPermission(permisoGlobal)
          setLoading(false)
          return
        }
        const data = await res.json()
        const n = Number(data.count || 0)
        setAlerts(data.alerts || [])
        setCount(n)
        setDestino(typeof data.destino === "string" && data.destino ? data.destino : "Ciclo de Facturación")
        setHasPermission(permisoGlobal || n > 0)
      } catch (error) {
        console.error("Error loading ciclo-facturacion alerts:", error)
      } finally {
        setLoading(false)
      }
    }

    cargar()
    const detener = setVisibleInterval(cargar, 60000)
    return () => detener()
  }, [])

  return { alerts, count, loading, hasPermission, destino }
}
