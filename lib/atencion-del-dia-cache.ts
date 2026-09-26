import { getAtencionDelDia } from "@/lib/atencion-actions"

// El home pide "atención del día" desde dos sitios (badge del LIPbot en
// app/page.tsx y hero en main-content.tsx) con la misma empresa: una sola
// llamada compartida por 60 s en vez de dos idénticas en cada montaje.
const TTL_MS = 60_000
type Resultado = Awaited<ReturnType<typeof getAtencionDelDia>>
let vigente: { clave: string; exp: number; promesa: Promise<Resultado> } | null = null

export function getAtencionDelDiaCompartida(userId?: string, empresaId?: number): Promise<Resultado> {
  const clave = `${userId ?? ""}|${empresaId ?? ""}`
  if (vigente && vigente.clave === clave && vigente.exp > Date.now()) return vigente.promesa
  const promesa = getAtencionDelDia(userId, empresaId).catch((e) => {
    vigente = null
    throw e
  })
  vigente = { clave, exp: Date.now() + TTL_MS, promesa }
  return promesa
}
