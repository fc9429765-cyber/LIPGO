// Reporte de errores del NAVEGADOR a /api/errores (tabla app_errores, SQL 217).
// Código puro de cliente: lo usan el límite de error de React (components/error-boundary.tsx)
// y el monitor global (components/monitor-errores.tsx). Nunca lanza; nunca bloquea la UI.
//
// Reglas: un mismo mensaje se reporta máximo una vez por minuto; el ruido conocido de
// despliegues (chunks viejos) y de ResizeObserver no se envía; se usa sendBeacon para que
// el reporte salga aunque la pestaña se esté cerrando.

export type OrigenErrorApp = "cliente" | "promesa" | "boundary"

export interface ErrorAppReporte {
  mensaje: string
  stack?: string | null
  componente?: string | null
  origen?: OrigenErrorApp
  extra?: Record<string, unknown> | null
}

const RUIDO = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|CSS_CHUNK_LOAD_FAILED|ResizeObserver loop|Script error\.?$/i
const vistos = new Map<string, number>()
const VENTANA_MS = 60_000

export function reportarErrorApp(input: ErrorAppReporte): void {
  try {
    if (typeof window === "undefined") return
    const mensaje = String(input.mensaje || "Error sin mensaje").slice(0, 2000)
    if (RUIDO.test(mensaje)) return
    const clave = `${input.origen ?? "cliente"}|${mensaje.slice(0, 200)}`
    const ahora = Date.now()
    const previo = vistos.get(clave)
    if (previo && ahora - previo < VENTANA_MS) return
    vistos.set(clave, ahora)
    if (vistos.size > 200) vistos.clear()

    let empresaId: number | null = null
    try {
      empresaId = Number(window.localStorage.getItem("selectedEmpresaId")) || null
    } catch {
      /* almacenamiento bloqueado */
    }
    const params = new URLSearchParams(window.location.search)
    const body = JSON.stringify({
      origen: input.origen ?? "cliente",
      mensaje,
      stack: input.stack ? String(input.stack).slice(0, 8000) : null,
      componente: input.componente ? String(input.componente).slice(0, 4000) : null,
      modulo: params.get("m"),
      url: `${window.location.pathname}${window.location.search}`.slice(0, 500),
      empresaId,
      extra: input.extra ?? null,
    })
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/errores", new Blob([body], { type: "application/json" }))
    } else {
      void fetch("/api/errores", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {})
    }
  } catch {
    /* el reporte de errores nunca produce errores */
  }
}
