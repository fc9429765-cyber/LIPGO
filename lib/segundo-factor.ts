// NÚCLEO PURO del segundo factor en el servidor. Sin base de datos, para probarlo solo.
//
// REGLA DE GERENCIA (2026-10-05): "no debes afectar los permisos que ya tienen los usuarios
// en este momento". Por eso este control NO mira permisos: mira solo si la cuenta YA activó
// su segundo factor. Quien no lo tiene activado sigue exactamente igual que hoy. Quien sí lo
// activó debe haberlo verificado en esta sesión para ejecutar una acción sensible (financiera
// o de gestión de usuarios), igual que ya se lo pide la pantalla al iniciar sesión.
//
// Niveles de Supabase: `currentLevel` es el nivel de ESTA sesión (aal1 = solo contraseña,
// aal2 = contraseña + código); `nextLevel` es el máximo que la cuenta puede alcanzar (aal2
// solo si tiene un factor verificado). "Factor activo y sesión sin verificar" es exactamente
// `nextLevel === "aal2" && currentLevel !== "aal2"`, la misma condición de la pantalla.

export type NivelAAL = "aal1" | "aal2" | null | undefined

export interface EstadoSegundoFactor {
  /** La cuenta tiene un factor TOTP verificado. */
  tieneFactor: boolean
  /** Esta sesión ya pasó por el código. */
  verificado: boolean
  /** true = hay que detener la acción sensible y pedir el código. */
  exigir: boolean
}

export function decidirSegundoFactor(niveles: { currentLevel?: NivelAAL; nextLevel?: NivelAAL } | null | undefined): EstadoSegundoFactor {
  const actual = niveles?.currentLevel ?? null
  const siguiente = niveles?.nextLevel ?? null
  const tieneFactor = siguiente === "aal2"
  const verificado = actual === "aal2"
  return { tieneFactor, verificado, exigir: tieneFactor && !verificado }
}

/** Mensaje único para el usuario cuando la acción se detiene. No revela nada del sistema. */
export const MENSAJE_SEGUNDO_FACTOR =
  "Esta acción exige tu segundo factor. Cierra sesión y vuelve a entrar con tu contraseña y el código de tu aplicación de autenticación."

/** Error reconocible por quien llama, por si quiere tratarlo distinto a un fallo cualquiera. */
export class ErrorSegundoFactor extends Error {
  readonly codigo = "SEGUNDO_FACTOR_REQUERIDO"
  constructor() {
    super(MENSAJE_SEGUNDO_FACTOR)
    this.name = "ErrorSegundoFactor"
  }
}
