"use client"

// Monitor global de errores del navegador: errores no capturados y promesas rechazadas
// se reportan a /api/errores (lib/errores-app.ts). Invisible; se monta una vez en el layout.

import { useEffect } from "react"
import { reportarErrorApp } from "@/lib/errores-app"

export function MonitorErrores() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const err: any = e.error
      reportarErrorApp({
        origen: "cliente",
        mensaje: e.message || err?.message || String(err ?? "Error"),
        stack: err?.stack ?? (e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null),
      })
    }
    const onRechazo = (e: PromiseRejectionEvent) => {
      const r: any = e.reason
      reportarErrorApp({ origen: "promesa", mensaje: r?.message ?? (typeof r === "string" ? r : "Promesa rechazada sin mensaje"), stack: r?.stack ?? null })
    }
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRechazo)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRechazo)
    }
  }, [])
  return null
}
