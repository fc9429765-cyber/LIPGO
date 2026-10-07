// DESFASE DE DESPLIEGUE: la pestaña vieja tras publicar una versión nueva.
//
// Hallazgo real del 2026-10-04/05 (app_errores, 7 registros de 4 usuarios en Avimol, Cedi e
// Indupan): cada vez que se publicó en horario de operación, quien tenía la app abierta quedó
// con una página que ya no encontraba su versión del servidor:
//   · "Failed to load chunk /_next/static/chunks/…?dpl=…"   (el JS de la versión anterior)
//   · "Server Action "…" was not found on the server"        (la acción de la versión anterior)
// y las pantallas de Báscula y Registro Preoperacional se cayeron al boundary.
//
// La recarga automática que ya existía buscaba "Loading chunk" y nunca vio "Failed to load
// chunk"; y para la acción no encontrada no había ninguna recuperación. Este módulo centraliza
// la detección (pura, probada) y la recarga con guarda, para que una pestaña vieja se arregle
// sola en un segundo en vez de dejar al usuario con una pantalla rota.
//
// La solución de fondo son dos: activar "Skew Protection" en el proyecto de Vercel (mantiene
// disponibles los archivos y las acciones de la versión anterior durante un tiempo) y publicar
// en horas de poca operación. Esto es la red de seguridad para cuando igual pase.

const PATRONES = [
  /ChunkLoadError/i,
  /Loading chunk [^ ]+ failed/i,
  /Failed to load chunk/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /CSS_CHUNK_LOAD_FAILED/i,
  /Server Action .* was not found on the server/i,
  /Failed to find Server Action/i,
]

/** ¿Este error es de una pestaña vieja tras un despliegue? */
export function esErrorDeDesfase(texto: unknown): boolean {
  const t = String(texto ?? "")
  return PATRONES.some((p) => p.test(t))
}

/** Clave de sessionStorage con la hora de la última recarga automática. */
export const CLAVE_RECARGA = "lipgo:recarga-chunk"
/** Entre recargas automáticas: evita el bucle si el error persiste por otra causa. */
export const VENTANA_RECARGA_MS = 30_000

/** Decide si toca recargar ahora, dada la hora de la última recarga (0 = nunca). */
export function debeRecargar(ahoraMs: number, ultimaMs: number, ventanaMs = VENTANA_RECARGA_MS): boolean {
  return ahoraMs - (Number(ultimaMs) || 0) > ventanaMs
}

/**
 * Recarga la pestaña UNA vez por ventana. Devuelve true si la disparó. Solo en el navegador.
 * Si sessionStorage no está disponible (modo privado, etc.), recarga igual: es la única salida.
 */
export function recargarPorDesfase(): boolean {
  if (typeof window === "undefined") return false
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE_RECARGA) || 0)
    if (!debeRecargar(Date.now(), ultima)) return false
    sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()))
  } catch {
    /* sin almacenamiento: recargar de todos modos */
  }
  window.location.reload()
  return true
}
