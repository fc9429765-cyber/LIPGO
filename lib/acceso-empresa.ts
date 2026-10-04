import "server-only"

// ACCESO POR EMPRESA (proyecto) — reglas compartidas por las server actions.
//
// Dos reglas que ya existían en el código y aquí solo se centralizan, SIN cambiar
// su semántica:
//   · perfilConAcceso: la empresa pedida está entre las accesibles del usuario
//     (perfil_acceso_empresas; si no tiene filas, su empresa_id del perfil).
//     Antes vivía en lib/programacion-cliente-actions.ts.
//   · accesoPedidos: empresas accesibles + owners (perfil_acceso_owners) con los
//     que Pedidos filtra `empresafactura`. Misma regla de lib/orders-actions.tsx
//     (getUserAccessibleEmpresas / getUserAccessibleOwners), pero sin el
//     "fallback a la empresa 1" cuando no hay sesión: sin usuario no hay acceso.
//
// Regla de gerencia (2026-10-03): Pedidos es un proceso del CLIENTE; estas
// comprobaciones son las mismas para todos los módulos de pedidos.

import { getCurrentUser, getUserProfile } from "@/lib/auth-actions"

export interface PerfilAcceso {
  id: string
  usuario: string | null
  empresa_id: number | null
}

export interface AccesoPedidos extends PerfilAcceso {
  /** Empresas (proyectos) que el usuario puede ver. */
  empresas: number[]
  /** Owners (dueños de la mercancía) a los que está limitado; vacío = sin límite. */
  owners: string[]
}

async function perfilActual(): Promise<PerfilAcceso | null> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return null
  const profile: any = await getUserProfile(user.id).catch(() => null)
  if (!profile?.id) return null
  return { id: String(profile.id), usuario: profile.usuario ?? null, empresa_id: profile.empresa_id == null ? null : Number(profile.empresa_id) }
}

/** Empresas accesibles del perfil: perfil_acceso_empresas, o su empresa_id si no tiene filas. */
async function empresasDe(sb: any, perfil: PerfilAcceso): Promise<number[]> {
  const { data, error } = await sb.from("perfil_acceso_empresas").select("empresa_id").eq("profile_id", perfil.id)
  if (error) return perfil.empresa_id ? [perfil.empresa_id] : []
  const ids: number[] = (data ?? []).map((r: any) => Number(r.empresa_id)).filter((n: number) => Number.isFinite(n) && n > 0)
  if (ids.length === 0 && perfil.empresa_id) return [perfil.empresa_id]
  return ids
}

/** Perfil de la sesión si la empresa pedida está entre sus accesibles. */
export async function perfilConAcceso(sb: any, empresaId: number): Promise<PerfilAcceso | null> {
  const perfil = await perfilActual()
  if (!perfil) return null
  const ids = await empresasDe(sb, perfil)
  return ids.includes(Number(empresaId)) ? perfil : null
}

/** Acceso completo para Pedidos: perfil + empresas + owners. `null` si no hay sesión o no tiene la empresa. */
export async function accesoPedidos(sb: any, empresaId: number): Promise<AccesoPedidos | null> {
  const perfil = await perfilActual()
  if (!perfil) return null
  const empresas = await empresasDe(sb, perfil)
  if (!empresas.includes(Number(empresaId))) return null
  const { data } = await sb.from("perfil_acceso_owners").select("owner").eq("profile_id", perfil.id)
  const owners: string[] = (data ?? []).map((r: any) => String(r.owner ?? "")).filter(Boolean)
  return { ...perfil, empresas, owners }
}

/** Aplica el límite por owners (empresafactura) a una consulta de pedidoscabecera, igual que getOrders. */
export function limitarPorOwners(q: any, acceso: AccesoPedidos): any {
  return acceso.owners.length > 0 ? q.in("empresafactura", acceso.owners) : q
}
