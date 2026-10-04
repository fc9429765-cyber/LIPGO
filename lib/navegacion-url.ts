// Estado de navegación ⇄ URL del dashboard (`/?g=<grupo>&m=<hub|módulo>&t=<pestaña>`).
//
// Hoy la navegación vive solo en memoria (app/page.tsx); con esto, refrescar
// mantiene el lugar, el botón atrás funciona y un enlace se puede compartir.
// Se usa `window.history` directamente, NO `useSearchParams`: en Next 15/16 un
// componente cliente que lo lea exige un límite de Suspense o `next build`
// falla en "/" (ya documentado en components/portal/portal-login-form.tsx).
// `pushState` sobre el mismo pathname es "shallow routing" soportado por el
// App Router y no re-renderiza componentes de servidor.

import type { GroupKey } from "@/lib/dashboard-data"
import { HUB_POR_KEY, grupoDeModulo, hubDe, resolverAlias } from "@/lib/navegacion"

export interface EstadoNav {
  group: GroupKey | null
  /** Módulo HOJA (nunca la clave del hub). */
  module: string | null
}

const CLAVES_GRUPO = new Set<string>([
  "aprendizaje", "pedidos", "inventarios", "produccion", "integral", "lip", "rrhh",
  "compensacion", "certificaciones_lip", "sst", "configuracion", "despachos", "financiera",
])

/**
 * Lee `?g=&m=&t=`: `t` (pestaña = módulo hoja) manda si viene; si `m` es una
 * clave de hub, se toma su primera pestaña (el hub redirige luego a la primera
 * visible); si `m` es un módulo, se usa tal cual. Aplica alias de nombres viejos.
 */
export function leerEstadoDeUrl(search: string): EstadoNav {
  const p = new URLSearchParams(search)
  const g = p.get("g")
  const m = p.get("m")
  const t = p.get("t")
  let module: string | null = null
  if (t) module = resolverAlias(t)
  else if (m) {
    const hub = HUB_POR_KEY.get(m)
    module = hub ? hub.tabs[0]?.module ?? null : resolverAlias(m)
  }
  let group: GroupKey | null = g && CLAVES_GRUPO.has(g) ? (g as GroupKey) : null
  if (!group && module) group = grupoDeModulo(module)
  return { group, module }
}

export function urlDeEstado(e: EstadoNav): string {
  if (!e.group) return ""
  const p = new URLSearchParams()
  p.set("g", e.group)
  if (e.module) {
    const hub = hubDe(e.group, e.module)
    if (hub) {
      p.set("m", hub.key)
      p.set("t", e.module)
    } else {
      p.set("m", e.module)
    }
  }
  return `?${p.toString()}`
}

/** Escribe la URL si cambió. No-op en servidor. */
export function escribirUrl(e: EstadoNav, modo: "push" | "replace"): void {
  if (typeof window === "undefined") return
  const destino = urlDeEstado(e)
  const actual = window.location.search
  if (destino === actual || (destino === "" && actual === "")) return
  const url = `${window.location.pathname}${destino}${window.location.hash}`
  if (modo === "push") window.history.pushState(null, "", url)
  else window.history.replaceState(null, "", url)
}
