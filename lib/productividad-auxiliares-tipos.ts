// Tipos y clasificación de "Productividad de Auxiliares". SIN "use server":
// un archivo de server actions solo puede exportar funciones async (Next.js lo
// exige y el build de Vercel falla si no), así que la función síncrona
// `clasificarOperacion` y las interfaces viven aquí, compartidas por la acción
// (lib/productividad-auxiliares-actions.ts) y la pantalla.

export type TipoOp = "cargue" | "descargue" | "distribucion" | "tolva" | "otro"

/** Tolva (Indupan) es PRODUCCIÓN, no cargue ni descargue: se clasifica aparte. */
export function clasificarOperacion(tipooperacion: string): TipoOp {
  const t = String(tipooperacion || "").toLowerCase()
  if (t.includes("tolva")) return "tolva"
  if (t.includes("descargue")) return "descargue"
  if (t.includes("distribuci")) return "distribucion"
  if (t.includes("cargue")) return "cargue"
  return "otro"
}

export interface OrdenReal {
  fecha: string
  orden: string
  tipooperacion: string
  tipo: TipoOp
  planta: number
  placa: string | null
  peso: number
  nReal: number
  tonReal: number
  /** true si la orden de vehículo no tenía auxiliares_real y se usó la lista de pago. */
  estimada: boolean
  crew: string[]
}

export interface PorTipo {
  cargue: number
  descargue: number
  distribucion: number
  tolva: number
  otro: number
}

/** Un día del auxiliar según Programación/Asistencia (registroasistencia). */
export interface AsistenciaDia {
  fecha: string
  planta: number
  /** Puesto programado ese día (Cargue/Descargue, Estibado PT, Distribución Turno…). */
  puesto: string | null
  /** Novedad registrada (Descanso, Incapacidad, Retiro, Vacaciones…). */
  novedad: string | null
  entradaProgramada: string | null
  salidaProgramada: string | null
  entradaReal: string | null
  salidaReal: string | null
}

export interface Frecuencia {
  nombre: string
  veces: number
  toneladas: number
}

export interface AuxiliarProductividad {
  persona: string
  activo: boolean
  planta: number | null
  /** Programación/asistencia del periodo (solo días con registro). */
  asistencia: AsistenciaDia[]
  /** Días programados en un puesto de Cargue/Descargue. */
  diasProgramadosCargue: number
  /** Días programados en Cargue/Descargue SIN ningún vehículo ese día. */
  diasProgramadosSinVehiculo: number
  /** Compañeros con los que más comparte equipo real (veces y toneladas conjuntas). */
  companeros: Frecuencia[]
  /** Placas que más atiende (veces y toneladas). */
  placasTop: Frecuencia[]
  /** Días con al menos una operación (vehículo o tolva). */
  dias: number
  /** Vehículos atendidos = órdenes de vehículo (cargue/descargue/distribución) en las que estuvo en el equipo real. */
  vehiculos: number
  vehiculosPorTipo: PorTipo
  placasDistintas: number
  /** Operaciones de tolva en las que estuvo en la cuadrilla. */
  operacionesTolva: number
  ordenesEstimadas: number
  /** Toneladas reales en VEHÍCULOS (sin tolva). */
  tonReal: number
  tonPorTipo: PorTipo
  /** Toneladas de TOLVA (aparte, nunca sumadas a tonReal). */
  tonTolva: number
  tonBrutaParticipada: number
  tonPorDia: number
  tonPorVehiculo: number
  pctDelTotal: number
  /** Toneladas que le pagó nómina por vehículos (reparto de la lista de pago). */
  tonPagada: number
  diferenciaRealPagada: number
  tonPorFecha: Record<string, number>
  tonPorMes: Record<string, number>
  ordenesDetalle: OrdenReal[]
}

export interface DiaProductividad {
  fecha: string
  vehiculos: number
  vehiculosPorTipo: PorTipo
  auxiliares: number
  /** Toneladas en vehículos (sin tolva). */
  toneladas: number
  tonPorTipo: PorTipo
  tonPorAuxiliar: number
  operacionesTolva: number
  tonTolva: number
  auxiliaresTolva: number
  ordenesEstimadas: number
}

export interface VehiculoProductividad {
  placa: string
  visitas: number
  visitasPorTipo: PorTipo
  toneladas: number
  tonPorVisita: number
  primeraVisita: string
  ultimaVisita: string
  auxiliaresFrecuentes: { persona: string; veces: number }[]
}

export interface ProductividadData {
  desde: string
  hasta: string
  plantas: number[]
  /** Órdenes de VEHÍCULO (cargue/descargue/distribución/otro). */
  totalOrdenes: number
  ordenesConReal: number
  coberturaReal: number
  /** Toneladas en vehículos (sin tolva). */
  totalToneladas: number
  tonPorTipo: PorTipo
  vehiculosPorTipo: PorTipo
  auxiliaresPorTipo: PorTipo
  /** Tolva, aparte. */
  operacionesTolva: number
  tonTolva: number
  auxiliaresTolva: number
  totalAuxiliares: number
  promedioTonAuxiliarDia: number
  auxiliares: AuxiliarProductividad[]
  dias: DiaProductividad[]
  vehiculos: VehiculoProductividad[]
  meses: string[]
  fechas: string[]
}
