// TIPOS DEL ACCESO POR EMPRESA Y OWNER
//
// Viven aquí y no en `user-access-actions.ts` porque aquel pasó a ser
// "use server" (Fase 0 del plan de políticas por acción, 2026-10-07): un
// archivo con esa directiva solo puede exportar funciones async, y estas
// cuatro interfaces las importan pantallas del navegador.

export interface UserProfile {
  id: string
  usuario: string
}

export interface Empresa {
  id: number
  nombre: string
}

export interface Owner {
  id: number
  nombre: string
}

export interface UserAccess {
  usuario: string
  profile_id: string
  empresas: number[]
}
