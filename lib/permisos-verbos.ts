// VOCABULARIO FIJO DE ACCIONES DENTRO DE UN MÓDULO.
//
// Sin imports a propósito: lo leen el servidor (puertas), las pantallas (chips de
// permisos), el generador del SQL 262 y las pruebas. `ver` NO está aquí: ver un
// módulo es la llave del módulo que ya existe en `permisos_usuarios`.
//
// La columna de una acción se llama `<llave del módulo>__<verbo>`, por ejemplo
// `config_clientes__crear`. El separador doble es deliberado: ninguna llave de
// módulo contiene `__`, así que `k.includes("__")` distingue una acción de un
// módulo sin consultar ningún catálogo.

export const VERBOS = ["crear", "editar", "eliminar", "aprobar", "anular", "cerrar", "exportar", "configurar"] as const
export type Verbo = (typeof VERBOS)[number]

export const SEPARADOR_ACCION = "__"

/** Clave de una acción en `permisos_usuarios`: `<llave>__<verbo>`. */
export type ClaveAccion = `${string}__${Verbo}`

export const ETIQUETA_VERBO: Record<Verbo, string> = {
  crear: "Crear",
  editar: "Editar",
  eliminar: "Eliminar",
  aprobar: "Aprobar",
  anular: "Anular",
  cerrar: "Cerrar",
  exportar: "Exportar",
  configurar: "Configurar",
}

export function esVerbo(x: unknown): x is Verbo {
  return typeof x === "string" && (VERBOS as readonly string[]).includes(x)
}

/** `true` si la clave tiene forma de acción (`algo__verbo`). */
export function esClaveAccion(clave: string): clave is ClaveAccion {
  const i = clave.lastIndexOf(SEPARADOR_ACCION)
  if (i <= 0) return false
  return esVerbo(clave.slice(i + SEPARADOR_ACCION.length))
}

/** Separa `<llave>__<verbo>`; `null` si no es una clave de acción. */
export function partirClaveAccion(clave: string): { llave: string; verbo: Verbo } | null {
  const i = clave.lastIndexOf(SEPARADOR_ACCION)
  if (i <= 0) return null
  const verbo = clave.slice(i + SEPARADOR_ACCION.length)
  if (!esVerbo(verbo)) return null
  return { llave: clave.slice(0, i), verbo }
}
