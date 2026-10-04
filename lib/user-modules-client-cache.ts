"use client"

// Una sola llamada a /api/user-modules compartida por todos los que preguntan
// "¿qué módulos puede ver este usuario?": barra lateral, buscador global,
// hubs, portal de área, Aprendizaje y tres hooks de alertas. Antes cada uno
// hacía su propio fetch (6 en el primer render y ~3 por ciclo de refresco de
// 2 min). La promesa se comparte 60 s; después se vuelve a pedir, así un
// permiso recién otorgado en Gestión de Usuarios aparece a lo sumo un minuto
// después sin refresco fuerte (antes exigía `cache: "no-store"` en cada sitio,
// que se conserva aquí para el navegador).
//
// `invalidarUserModulesCache()` se llama al cerrar sesión (components/
// auth-provider.tsx) para no servir los módulos del usuario anterior.

export interface UserModulesResponse {
  protectedModules: string[]
  allowedModules: string[]
}

const TTL_MS = 60 * 1000
let vigente: { exp: number; promesa: Promise<UserModulesResponse> } | null = null

export function getUserModulesCached(): Promise<UserModulesResponse> {
  if (vigente && vigente.exp > Date.now()) return vigente.promesa
  const promesa = fetch("/api/user-modules", { method: "GET", cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`/api/user-modules ${res.status}`)
      const data = (await res.json()) as Partial<UserModulesResponse>
      const resultado = {
        protectedModules: Array.isArray(data?.protectedModules) ? data.protectedModules : [],
        allowedModules: Array.isArray(data?.allowedModules) ? data.allowedModules : [],
      }
      // Sin módulos permitidos = casi siempre "todavía no hay sesión" (el
      // endpoint responde vacío sin usuario). No se guarda: el siguiente que
      // pregunte, ya con sesión, vuelve a pedirlos en vez de heredar el vacío.
      if (resultado.allowedModules.length === 0 && vigente?.promesa === promesa) vigente = null
      return resultado
    })
    .catch((e) => {
      // No dejar en caché un fallo: el siguiente que pregunte vuelve a intentar.
      if (vigente?.promesa === promesa) vigente = null
      throw e
    })
  vigente = { exp: Date.now() + TTL_MS, promesa }
  return promesa
}

export function invalidarUserModulesCache(): void {
  vigente = null
}
