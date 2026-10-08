"use client"

/**
 * GlobalLocationScheduler
 * -----------------------
 * Componente invisible que captura la ubicacion del usuario automaticamente
 * en 3 ventanas fijas en Hora de Colombia (America/Bogota):
 *   - 08:00
 *   - 14:00
 *   - 17:00
 *
 * Caracteristicas clave:
 *   - Usa date-fns-tz para que la logica funcione sin importar la zona horaria
 *     del dispositivo del usuario.
 *   - Revisa el reloj cada 60 segundos y tambien al volver a primer plano.
 *   - Control de duplicados: usa localStorage con una bandera por ventana/dia
 *     (ej: "ubicacion_capture_8am_2024-11-15") para evitar multiples capturas
 *     en el mismo minuto o tras un refresh.
 *   - Catch-up: si el usuario abre la app a las 08:05 AM y no hay bandera
 *     para la ventana de las 08:00 ese dia, dispara la captura inmediatamente.
 *   - Falla silenciosamente en errores de permiso/GPS/Supabase (solo console.log)
 *     para no interrumpir la experiencia.
 *   - Timeout de GPS de 10 segundos para no colgar el navegador en sitios sin
 *     senal.
 *   - Insert en Supabase es fire-and-forget (async sin await bloqueante) para
 *     no afectar el render.
 */

import { useEffect, useRef } from "react"
import { createBrowserClient } from "@supabase/ssr"
import { toZonedTime, formatInTimeZone } from "date-fns-tz"
import { useAuth } from "@/components/auth-provider"
import { registrarConexion } from "@/lib/conexiones-actions"

// ---------- Constantes ----------

const TIMEZONE = "America/Bogota"

// Etiqueta "human-friendly" usada como parte del campo `accion` del insert y
// como parte de la clave de localStorage. No cambiar sin actualizar las
// banderas existentes, o los usuarios podrian recibir capturas duplicadas
// tras el despliegue.
const CAPTURE_WINDOWS = [
  { hour: 8, minute: 0, slug: "8am", accion: "Captura Automática 08:00" },
  { hour: 14, minute: 0, slug: "2pm", accion: "Captura Automática 14:00" },
  { hour: 17, minute: 0, slug: "5pm", accion: "Captura Automática 17:00" },
] as const

const STORAGE_PREFIX = "ubicacion_capture_"
const CHECK_INTERVAL_MS = 60_000 // 60 segundos
const GPS_TIMEOUT_MS = 10_000 // 10 segundos

// Credenciales publicas del proyecto Supabase (mismas que usa AuthProvider).
// Solo se usan desde el navegador, por eso es seguro embeberlas.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ---------- Helpers ----------

function buildStorageKey(slug: string, dateStr: string) {
  return `${STORAGE_PREFIX}${slug}_${dateStr}`
}

/**
 * Envuelve navigator.geolocation.getCurrentPosition en una promesa con
 * enableHighAccuracy y un timeout de 10 segundos.
 */
function getGeolocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("Geolocation no soportada en este navegador"))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: GPS_TIMEOUT_MS,
      maximumAge: 0,
    })
  })
}

// ---------- Componente ----------

export default function GlobalLocationScheduler() {
  const { user } = useAuth()
  // Evita re-entradas en caso que un check anterior todavia no haya terminado
  // (GPS lento) cuando el siguiente intervalo dispara.
  const runningRef = useRef<boolean>(false)

  useEffect(() => {
    // Sin usuario autenticado no hay a quien asociar las capturas: nada que hacer.
    if (!user?.id) return

    // Cliente Supabase del navegador para inserts (fire-and-forget).
    const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        get(name: string) {
          if (typeof document === "undefined") return undefined
          const value = `; ${document.cookie}`
          const parts = value.split(`; ${name}=`)
          if (parts.length === 2) return parts.pop()?.split(";").shift()
        },
        set() {
          /* no-op: el scheduler no crea sesiones */
        },
        remove() {
          /* no-op */
        },
      },
    })

    const runCheck = async () => {
      if (runningRef.current) return
      runningRef.current = true
      try {
        const now = new Date()
        const zoned = toZonedTime(now, TIMEZONE)
        const currentHour = zoned.getHours()
        const currentMinute = zoned.getMinutes()
        const dateStr = formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd")

        for (const win of CAPTURE_WINDOWS) {
          // La ventana ya "comenzo" hoy si la hora actual (Colombia) es posterior
          // o igual a la hora de la ventana.
          const isPastWindow =
            currentHour > win.hour ||
            (currentHour === win.hour && currentMinute >= win.minute)

          if (!isPastWindow) continue

          const key = buildStorageKey(win.slug, dateStr)
          if (localStorage.getItem(key)) continue

          // Marcamos la bandera ANTES del intento de captura: si dos checks se
          // solapan (p. ej. tab en background que despierta), solo uno procede.
          // Si luego la geolocalizacion falla, igualmente no reintentamos en ese
          // minuto, pero el siguiente dia vuelve a empezar limpio.
          localStorage.setItem(key, new Date().toISOString())

          try {
            const pos = await getGeolocation()
            const { latitude, longitude } = pos.coords

            // Server action: el usuario sale de la sesión del servidor (antes el navegador
            // escribía su propio usuario_id). Fire-and-forget: no bloquea la UI.
            void registrarConexion({ latitud: latitude, longitud: longitude, accion: win.accion }).then(({ success, message }) => {
              if (!success) console.log("[v0] GlobalLocationScheduler: insert fallo", win.slug, message)
              else console.log("[v0] GlobalLocationScheduler: captura ok", win.slug, dateStr)
            })
          } catch (err: any) {
            // Errores tipicos: permiso denegado, timeout de GPS, sin senal.
            // Fallamos silenciosamente por requerimiento.
            console.log(
              "[v0] GlobalLocationScheduler: geolocalizacion fallo",
              win.slug,
              err?.message || err,
            )
          }
        }
      } finally {
        runningRef.current = false
      }
    }

    // 1) Corrida inmediata al montar: cubre el caso "catch-up" cuando el
    //    usuario abre la app despues de la hora de una ventana.
    void runCheck()

    // 2) Intervalo cada 60 segundos.
    const intervalId = setInterval(() => {
      void runCheck()
    }, CHECK_INTERVAL_MS)

    // 3) Al volver a primer plano (Page Visibility API): los navegadores
    //    ralentizan los timers de pestanas en background, asi que forzamos
    //    una revision cuando la pestana se vuelve visible.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void runCheck()
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [user?.id])

  // Componente invisible
  return null
}
