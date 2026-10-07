"use client"

// Monitor global de errores del navegador: errores no capturados y promesas rechazadas
// se reportan a /api/errores (lib/errores-app.ts). Invisible; se monta una vez en el layout.

import { useEffect } from "react"
import { reportarErrorApp } from "@/lib/errores-app"
import { esErrorDeDesfase, recargarPorDesfase } from "@/lib/desfase-despliegue"

export function MonitorErrores() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const err: any = e.error
      // "Uncaught " a secas (registro real del 5-oct) no sirve para nada: si el mensaje viene
      // vacío se deja al menos el archivo y la línea donde ocurrió.
      const texto = (e.message || err?.message || (err != null ? String(err) : "")).trim()
      const mensaje = texto && texto !== "Uncaught" ? texto : `Error sin mensaje${e.filename ? ` en ${e.filename}:${e.lineno}:${e.colno}` : ""}`
      reportarErrorApp({
        origen: "cliente",
        mensaje,
        stack: err?.stack ?? (e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null),
      })
      // Pestaña vieja tras un despliegue (JS que ya no existe): recargar una vez.
      if (esErrorDeDesfase(`${err?.name ?? ""} ${mensaje}`)) recargarPorDesfase()
    }
    const onRechazo = (e: PromiseRejectionEvent) => {
      const r: any = e.reason
      const mensaje = r?.message ?? (typeof r === "string" ? r : "Promesa rechazada sin mensaje")
      reportarErrorApp({ origen: "promesa", mensaje, stack: r?.stack ?? null })
      // "Server Action … was not found on the server" llega por aquí (registro real del 4 y
      // 5 de octubre): la acción es de la versión anterior; la pestaña necesita recargarse.
      if (esErrorDeDesfase(mensaje)) recargarPorDesfase()
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
