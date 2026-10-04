// Tipos del panel "Operación del día".
//
// Van aparte del archivo de acciones porque ese es "use server" y esos archivos
// solo pueden exportar funciones async: exportar un tipo o una constante desde
// alli rompe el BUILD aunque el typecheck pase.

import type { ProgramacionResumenDia } from "@/lib/programacion-cliente-tipos"

/** Cobertura de un turno: cuantos se programaron y cuantos marcaron. */
export interface CoberturaTurno {
  /** 1 | 2 para puestos de doble jornada; null = jornada unica. */
  turno: number | null
  etiqueta: string
  /** Rango horario real, tomado de horario_tolva cuando existe. */
  horario: string | null
  programados: number
  presentes: number
  /** Programados que todavia no tienen marcacion. */
  sinMarcar: number
}

/** Una fila de la bandeja: algo que requiere atencion hoy. */
export interface ItemBandeja {
  id: string
  /** rojo = bloquea o esta vencido · ambar = pendiente · verde = informativo */
  nivel: "alto" | "medio" | "bajo"
  titulo: string
  detalle: string
  /** Modulo de LIPgo al que lleva el boton (nombre exacto del menu). */
  moduloDestino: string | null
  textoBoton: string | null
}

/** Requisicion de personal en curso. */
export interface RequisicionResumen {
  id: string
  cargo: string
  proyecto: string
  vacantes: number
  estado: string
  /** Texto legible del avance de la doble aprobacion. */
  avance: string
  aprobadas: number
  totalPasos: number
}

export interface OperacionDiaData {
  /** Contexto */
  fecha: string
  quincena: { anio: number; mes: number; numero: 1 | 2; desde: string; hasta: string; etiqueta: string }

  /** Cabecera */
  personalActivo: number
  turnosProgramadosQuincena: number
  novedadesAbiertas: number

  /**
   * Cobertura de la quincena: turnos cubiertos vs turnos programados,
   * acumulado dia a dia. Es el anillo de la cabecera.
   */
  cobertura: { programados: number; cubiertos: number; pct: number; diasConDatos: number }

  /** Cobertura de hoy, por turno. */
  hoy: { turnos: CoberturaTurno[]; total: CoberturaTurno }

  /** Bandeja del dia. */
  bandeja: ItemBandeja[]

  /** Requisiciones de personal en curso. */
  requisiciones: RequisicionResumen[]

  /**
   * Vehículos y toneladas de HOY. Reemplaza (2026-09-30) a la tarjeta de pago
   * de la quincena: el dinero de nómina es información financiera de LIP y no
   * va en el panel operativo del coordinador; vive en Compensación.
   * Mismas fuentes que Gestión de Órdenes (getDespachoKpis), Vehículos por
   * cerrar (getVehiculosNoProcesados) y Control de Toneladas (misma fórmula
   * que paga nómina).
   */
  operacionHoy: OperacionHoy

  /** Lista de cierre del día: lo que debe quedar en cero antes de irse. */
  cierre: CierreDia

  /** Avisos de datos que no se pudieron leer, para no mostrar ceros falsos. */
  avisos: string[]
}

export interface OperacionHoy {
  /** Órdenes de vehículo con fecha de cargue hoy. */
  ordenesHoy: number
  finalizadas: number
  /** Iniciadas y aún sin fincargue (de cualquier fecha: siguen abiertas). */
  sinCerrar: number
  /** Vehículos en patio sin procesar (citasvehiculos sin estatus). */
  enPatio: number
  /** Toneladas de órdenes cerradas hoy, repartidas como paga nómina. */
  toneladas: number
  /** Meta de toneladas del día (meta mensual / días de operación). 0 si no hay meta. */
  metaTonDia: number
  /** Tiempo promedio de operación (min) sobre el histórico medido; null si no hay. */
  tiempoPromMin: number | null
  /** Auxiliares con tonelaje hoy, de mayor a menor. */
  auxiliares: { persona: string; ton: number }[]
  /** Descargues POR UNIDAD de hoy (Huevos / Empaque MP): aparte de las toneladas. */
  porUnidad: { ordenes: number; unidades: number }
  /** Programación del cliente para HOY (vehículos programados vs. llegados). `usa` = la empresa registra programaciones. */
  programacion: ProgramacionResumenDia
  /** Vehículos registrados HOY en portería (citasvehiculos.fechallegada = hoy). */
  vehiculosRegistrados: number
  /** Los mismos, por tipo de vehículo y por tipo de despacho (cargue propio / tercero / cliente recoge), de mayor a menor. */
  porTipoVehiculo: { tipo: string; n: number }[]
  porDespacho: { tipo: string; n: number }[]
  /** Vehículos iniciados sin finalizar: placas (máx. 6) y minutos en proceso del más antiguo. */
  sinCerrarDetalle: { placas: string[]; masAntiguoMin: number | null }
  disponible: boolean
  mensaje: string | null
}

export interface CierreDia {
  vehiculosSinCerrar: number
  sinMarcar: number
  turnosPorAprobar: number
  ausentismosSinCompletar: number
  /** true si hoy ya hay al menos una anotación en la Bitácora. */
  bitacoraHoy: boolean
  /** Programación del cliente para MAÑANA (solo si la empresa usa el módulo). */
  programacionManana: { usa: boolean; recibida: boolean; aTiempo: boolean | null; enviadaEn: string | null; enviadaPorUsuario: string | null; programados: number }
}
