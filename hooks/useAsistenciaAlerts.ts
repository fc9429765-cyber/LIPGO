"use client"


import { setVisibleInterval } from "@/lib/polling"
import { useEffect, useState } from "react"

export interface AsistenciaPendiente {
  identificacion: string
  nombre: string
}

export interface AsistenciaSinSalida {
  identificacion: string
  nombre: string
  horaLlegada: string
}

/**
 * Hook compartido para alertas de la tabla de Asistencia que se
 * muestran en la TopBar:
 *
 *   - Alerta 1 (`pendientes`): personas activas cuyo registro del dia
 *     aun no esta procesado (sin programada, sin registrada y sin
 *     novedad).
 *   - Alerta 2 (`sinSalida`): personas que tienen hora de llegada pero
 *     no tienen hora de salida.
 *
 * Solo se activa si el usuario tiene permiso `tabla_asistencia`.
 * Refresca cada 2 minutos como las demas alertas de la barra superior.
 */
export function useAsistenciaAlerts(
  empresaId: number | null,
  userId: string | undefined,
) {
  const [pendientes, setPendientes] = useState<AsistenciaPendiente[]>([])
  const [sinSalida, setSinSalida] = useState<AsistenciaSinSalida[]>([])
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
        // El endpoint /api/user-permissions NO existe en la app, asi
        // que el fetch fallaba siempre y `hasPermission` se quedaba
        // en false: la alerta de "personas sin hora de salida" no se
        // pintaba aunque el endpoint /api/asistencia-alerts ya
        // estuviera devolviendo los registros correctos. La fuente
        // real de permisos del cliente es /api/user-modules, que
        // devuelve los nombres de modulos permitidos. Verificamos que
        // "Tabla Asistencia" este en esa lista (es la key registrada
        // en lib/permissions-map.ts -> tabla_asistencia).
        const permRes = await fetch(`/api/user-modules`, { cache: "no-store" })
        if (!permRes.ok) {
          if (!cancelled) {
            setHasPermission(false)
            setLoading(false)
          }
          return
        }
        const permData = await permRes.json()
        const allowedModules: string[] = Array.isArray(permData?.allowedModules)
          ? permData.allowedModules
          : []
        const allowed = allowedModules.includes("Tabla Asistencia")
        if (!cancelled) setHasPermission(allowed)
        if (!allowed) {
          if (!cancelled) setLoading(false)
          return
        }

        const res = await fetch(
          `/api/asistencia-alerts?empresaId=${empresaId}`,
          { cache: "no-store" },
        )
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) {
            setPendientes(data.pendientes ?? [])
            setSinSalida(data.sinSalida ?? [])
          }
        }
      } catch (err) {
        console.error("[v0] useAsistenciaAlerts error:", err)
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
    pendientes,
    sinSalida,
    pendientesCount: pendientes.length,
    sinSalidaCount: sinSalida.length,
    hasPermission,
    loading,
  }
}
