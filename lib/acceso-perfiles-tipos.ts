// TIPOS DE LOS PERFILES DE ACCESO
//
// Viven aquí y no en `acceso-perfiles-actions.ts` porque aquel es "use server"
// y solo puede exportar funciones async.

export type PerfilAcceso = {
  id: number
  nombre: string
  descripcion: string | null
  activo: boolean
  created_at: string
  updated_at: string
  /** Empresas (proyectos) que abre en el selector global. */
  empresas: number[]
  /** Owners a los que limita Pedidos. Vacío = sin límite por owner. */
  owners: string[]
  /** Claves de `permisos_usuarios` que enciende. */
  permisos: string[]
  /** Cuántos usuarios lo tienen asignado. */
  usuarios: number
}

export type PerfilAccesoInput = {
  id?: number
  nombre: string
  descripcion?: string | null
  activo?: boolean
  empresas: number[]
  owners: string[]
  permisos: string[]
}

export type UsuarioDePerfil = { id: string; usuario: string }

/** Lo que trae un usuario hoy, para arrancar un perfil a partir de él. */
export type PlantillaAcceso = { empresas: number[]; owners: string[]; permisos: string[] }

/** Qué cambió en el acceso efectivo de un usuario al recalcular. */
export type CambiosAcceso = {
  empresas: { agregadas: number; retiradas: number }
  owners: { agregadas: number; retiradas: number }
  permisos: { agregados: number; retirados: number }
}

export type ResultadoRecalculo = { usuarios: number; errores: string[] }
