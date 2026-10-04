// Tipos de "Programación del cliente" (Pedidos y solicitudes › Programación de
// mañana; Torre de Control › Programación del cliente · cumplimiento). Viven
// aparte porque lib/programacion-cliente-actions.ts es "use server" y solo
// puede exportar funciones async.

/** Hora límite (America/Bogota) del día ANTERIOR para que la programación cuente como a tiempo. */
export const HORA_LIMITE = 17
export const HORA_LIMITE_TEXTO = "5:00 p. m."

export interface LineaProgramacion {
  /** Nombre del catálogo tiposvehiculos (Mula, Sencillo, Dobletroque…). */
  tipovehiculo: string
  /** Destino o ruta tal como lo escribe el cliente (Bodega Bogotá, Fundación, Urbano…). */
  destino: string
  /** Opcional: producto (Bulto, Huevo, Mogolla…). */
  producto?: string
  cantidad: number
  observaciones?: string
}

export interface ProgramacionCliente {
  id: number
  idempresa: number
  /** 'YYYY-MM-DD' del día de operación programado. */
  fechaOperacion: string
  version: number
  vigente: boolean
  lineas: LineaProgramacion[]
  totalVehiculos: number
  observaciones: string | null
  /** ISO timestamptz del envío. */
  enviadaEn: string
  aTiempo: boolean
  enviadaPorUsuario: string | null
  enviadaPorEmpresa: number | null
}

export interface CatalogosProgramacion {
  tiposVehiculo: { nombre: string; capacidad: number | null }[]
  /** Destinos ya usados por esta empresa en programaciones anteriores (sugerencias). */
  destinos: string[]
  /** Productos vistos en portería y en programaciones anteriores (sugerencias). */
  productos: string[]
  /** ¿La empresa ya tiene alguna programación registrada? (para no mostrar avisos a quien no usa el módulo) */
  usa: boolean
}

export interface CumplimientoTipo {
  tipovehiculo: string
  programados: number
  llegaron: number
  /** min(programados, llegaron) */
  cumplidos: number
  noLlegaron: number
  noProgramados: number
}

export interface CumplimientoDia {
  fecha: string
  tieneProgramacion: boolean
  aTiempo: boolean | null
  enviadaEn: string | null
  enviadaPorUsuario: string | null
  version: number | null
  programados: number
  llegaron: number
  cumplidos: number
  noLlegaron: number
  noProgramados: number
  /** cumplidos / programados × 100; null si no hubo programación. */
  porcentaje: number | null
  porTipo: CumplimientoTipo[]
  lineas: LineaProgramacion[]
}

export interface CumplimientoResumen {
  desde: string
  hasta: string
  /** Solo días con programación o con vehículos (los domingos vacíos no aparecen). */
  dias: CumplimientoDia[]
  diasOperados: number
  diasConProgramacion: number
  diasATiempo: number
  /** Días con vehículos pero sin programación del cliente. */
  diasSinProgramacion: number
  programados: number
  llegaron: number
  cumplidos: number
  noLlegaron: number
  noProgramados: number
  porcentaje: number | null
}

/** Resumen corto de un día (Operación del día). */
export interface ProgramacionResumenDia {
  usa: boolean
  tiene: boolean
  programados: number
  llegaron: number
  cumplidos: number
  porcentaje: number | null
  aTiempo: boolean | null
  enviadaEn: string | null
  enviadaPorUsuario: string | null
}
