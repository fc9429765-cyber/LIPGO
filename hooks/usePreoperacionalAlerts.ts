"use client"


import { setVisibleInterval } from "@/lib/polling"
import { useState, useEffect } from "react"
import { getUserPermissionsCached } from "@/lib/permissions-client-cache"

interface PreoperacionalAlert {
  id: number
  fecha: string
  placa: string
  nombre_operador: string
  campo: string
  campo_label: string
}

interface UsePreoperacionalAlertsResult {
  alerts: PreoperacionalAlert[]
  count: number
  loading: boolean
  hasPermission: boolean
}

// Field labels for display
const FIELD_LABELS: Record<string, string> = {
  licencia_vigente: "Licencia vigente",
  certificado_mantenimiento: "Certificado Mantenimiento",
  estado_salud_adecuado: "Estado de salud adecuado",
  sin_consumo_sustancias: "Sin consumo de sustancias",
  espejos_laterales: "Espejos laterales",
  alarma_reversa: "Alarma de reversa",
  extintor_incendio: "Extintor de incendio",
  llantas: "Llantas",
  cilindros_elevacion_direccion: "Cilindros elevación/dirección",
  montura_cilindros: "Montura de cilindros",
  estado_horquillas: "Estado de horquillas",
  estado_mastil: "Estado del mástil",
  estado_mangueras: "Estado de mangueras",
  cadenas_elevacion_descenso: "Cadenas elevación/descenso",
  rejillas_apoyo_carga: "Rejillas apoyo carga",
  luces_delanteras: "Luces delanteras",
  luces_traseras: "Luces traseras",
  bateria: "Batería",
  conexiones_electricas: "Conexiones eléctricas",
  cableado_electrico: "Cableado eléctrico",
  espejo_retrovisor_interior: "Espejo retrovisor interior",
  estado_cabina: "Estado de cabina",
  sillas: "Sillas",
  pedales: "Pedales",
  alarma_retroceso: "Alarma de retroceso",
  cinturones_seguridad: "Cinturones de seguridad",
  pito: "Pito",
  timon_volante: "Timón o volante",
  frenos: "Frenos",
  palancas_control: "Palancas de control",
  freno_parque_mano: "Freno de parque",
  horometro_indicador: "Horómetro/Indicador",
}

const BOOL_FIELDS = [
  "licencia_vigente",
  "certificado_mantenimiento",
  "estado_salud_adecuado",
  "sin_consumo_sustancias",
  "espejos_laterales",
  "alarma_reversa",
  "extintor_incendio",
  "llantas",
  "cilindros_elevacion_direccion",
  "montura_cilindros",
  "estado_horquillas",
  "estado_mastil",
  "estado_mangueras",
  "cadenas_elevacion_descenso",
  "rejillas_apoyo_carga",
  "luces_delanteras",
  "luces_traseras",
  "bateria",
  "conexiones_electricas",
  "cableado_electrico",
  "espejo_retrovisor_interior",
  "estado_cabina",
  "sillas",
  "pedales",
  "alarma_retroceso",
  "cinturones_seguridad",
  "pito",
  "timon_volante",
  "frenos",
  "palancas_control",
  "freno_parque_mano",
  "horometro_indicador",
]

export function usePreoperacionalAlerts(empresaId: number | null, userId?: string): UsePreoperacionalAlertsResult {
  const [alerts, setAlerts] = useState<PreoperacionalAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState(false)

  useEffect(() => {
    const checkPermissionAndLoadAlerts = async () => {
      if (!empresaId) {
        setLoading(false)
        return
      }

      try {
        // Check if user has prechequeo permission
        const permissions = await getUserPermissionsCached(userId)
        if (!permissions || !permissions.prechequeo) {
          setHasPermission(false)
          setLoading(false)
          return
        }

        setHasPermission(true)

        // Solo el dia actual: las alertas de incumplimiento se
        // generan a partir de las inspecciones registradas hoy. Si no
        // hay inspeccion para el dia, no se muestra ninguna alerta —
        // asi evitamos arrastrar incidencias historicas que ya
        // pudieron haberse atendido. Pasamos `dateFrom = hoy` y la
        // API hace WHERE fecha >= dateFrom, que para una fecha
        // unica equivale a "= hoy".
        const hoy = new Date().toISOString().split("T")[0]

        const response = await fetch(
          `/api/preoperacional-alerts?empresaId=${empresaId}&dateFrom=${hoy}`
        )

        if (!response.ok) {
          setLoading(false)
          return
        }

        const data = await response.json()

        // La API ya devuelve solo las inspecciones de hoy gracias al
        // `dateFrom=hoy`. Recorremos cada registro y por cada campo
        // booleano que venga en `false` generamos una alerta.
        const dataArray: Array<{
          id: number
          fecha: string
          placa: string
          nombre_operador: string
          [key: string]: unknown
        }> = Array.isArray(data) ? data : []

        const alertsList: PreoperacionalAlert[] = []

        for (const record of dataArray) {
          for (const field of BOOL_FIELDS) {
            if (record[field] === false) {
              alertsList.push({
                id: record.id,
                fecha: record.fecha,
                placa: record.placa,
                nombre_operador: record.nombre_operador,
                campo: field,
                campo_label: FIELD_LABELS[field] || field,
              })
            }
          }
        }

        setAlerts(alertsList)
      } catch (error) {
        console.error("[v0] Error loading preoperacional alerts:", error)
      } finally {
        setLoading(false)
      }
    }

    checkPermissionAndLoadAlerts()
    
    // Refresh every 60 seconds
    const detener = setVisibleInterval(checkPermissionAndLoadAlerts, 60000)
    return () => detener()
  }, [empresaId, userId])

  return {
    alerts,
    count: alerts.length,
    loading,
    hasPermission,
  }
}
