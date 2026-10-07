// TIPOS DE LOS PERFILES DE ACCESO
//
// Viven aquí y no en `acceso-perfiles-actions.ts` porque aquel es "use server"
// y solo puede exportar funciones async.
//
// Desde el 2026-10-07 el perfil es UNO solo (`autorizacion_perfiles`, script
// 252): el puesto, con los procesos que autoriza con clave y las empresas,
// owners y módulos que abre.

export type PerfilAcceso = {
  id: number
  nombre: string
  descripcion: string | null
  activo: boolean
  created_at: string
  updated_at: string | null
  /** Empresas (proyectos) que abre en el selector global. También es el alcance de su clave. */
  empresas: number[]
  /** Owners a los que limita Pedidos. Vacío = sin límite por owner. */
  owners: string[]
  /** Claves de `permisos_usuarios` que enciende. */
  permisos: string[]
  /** Procesos que autoriza con clave personal (códigos de autorizacion_procesos). */
  procesos: string[]
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
  procesos?: string[]
}

export type UsuarioDePerfil = { id: string; usuario: string }

/** Lo que trae un usuario hoy, para arrancar un perfil a partir de él. */
export type PlantillaAcceso = { empresas: number[]; owners: string[]; permisos: string[]; procesos: string[] }

/** Qué cambió en el acceso efectivo de un usuario al recalcular. */
export type CambiosAcceso = {
  empresas: { agregadas: number; retiradas: number }
  owners: { agregadas: number; retiradas: number }
  permisos: { agregados: number; retirados: number }
}

export type ResultadoRecalculo = { usuarios: number; errores: string[] }
