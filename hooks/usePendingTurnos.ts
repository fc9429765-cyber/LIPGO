"use client"


import { setVisibleInterval } from "@/lib/polling"
import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase-client"

export interface PendingSolicitud {
  id: number
  fechasolicitud: string
  puesto: string
  fecharequerida: string
  nombresolicitante: string
  cantidad: number
}

export function usePendingTurnos(empresaId: number | null) {
  const [pendingSolicitudes, setPendingSolicitudes] = useState<PendingSolicitud[]>([])
  const [loading, setLoading] = useState(true)
  const [count, setCount] = useState(0)

  const fetchPending = useCallback(async () => {
    if (!empresaId) {
      setPendingSolicitudes([])
      setCount(0)
      setLoading(false)
      return
    }

    try {
      const supabase = await createClient()
      const { data, error } = await supabase
        .from("solicitudesturnos")
        .select("id, fechasolicitud, puesto, fecharequerida, nombresolicitante, cantidad")
        .eq("idempresa", empresaId)
        .eq("estado", "pendiente")
        .order("fechasolicitud", { ascending: false })
        .limit(10)

      if (error) {
        console.error("[v0] Error fetching pending turnos:", error)
        return
      }

      setPendingSolicitudes(data || [])
      setCount(data?.length || 0)
    } catch (error) {
      console.error("[v0] Error:", error)
    } finally {
      setLoading(false)
    }
  }, [empresaId])

  useEffect(() => {
    fetchPending()
    
    // Refresh every 30 seconds
    const detener = setVisibleInterval(fetchPending, 30000)
    return () => detener()
  }, [fetchPending])

  return { pendingSolicitudes, count, loading, refresh: fetchPending }
}
