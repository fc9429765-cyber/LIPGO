import "server-only"
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto"

// Hash de la clave personal: scrypt con sal aleatoria por usuario. Formato
// almacenado: `scrypt$<sal hex>$<hash hex>`. Nunca se guarda la clave en claro.
const SCRYPT_LARGO = 32

export function hashClave(clave: string): string {
  const sal = randomBytes(16).toString("hex")
  const h = scryptSync(String(clave).normalize("NFKC"), sal, SCRYPT_LARGO).toString("hex")
  return `scrypt$${sal}$${h}`
}

export function verificarClaveHash(clave: string, almacenado: string | null | undefined): boolean {
  try {
    const partes = String(almacenado ?? "").split("$")
    if (partes.length !== 3 || partes[0] !== "scrypt") return false
    const esperado = Buffer.from(partes[2], "hex")
    const calculado = scryptSync(String(clave).normalize("NFKC"), partes[1], esperado.length)
    return esperado.length === calculado.length && timingSafeEqual(esperado, calculado)
  } catch {
    return false
  }
}

/** Código de recuperación de 6 dígitos (criptográficamente aleatorio). */
export function generarCodigoRecuperacion(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

/** El código de recuperación se guarda hasheado y atado al usuario. */
export function hashCodigoRecuperacion(codigo: string, usuarioId: string): string {
  return createHash("sha256").update(`${usuarioId}:${String(codigo).trim()}`).digest("hex")
}

/** Clave provisional que entrega el admin (8 caracteres sin ambiguos: sin 0/O/1/I/l). */
export function generarClaveProvisional(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz"
  let out = ""
  for (let i = 0; i < 8; i++) out += alfabeto[randomInt(0, alfabeto.length)]
  return out
}
