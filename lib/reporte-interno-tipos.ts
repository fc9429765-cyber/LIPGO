// Tipos del Reporte Interno de Operación.
//
// Aparte del archivo de acciones porque ese es "use server" y esos archivos
// solo pueden exportar funciones async: exportar un tipo o una constante desde
// ahí rompe el build (el typecheck no lo detecta, el bundler sí).

/** Los cinco momentos de la línea de tiempo de un cargue. */
export type EventoInterno =
  | "pesaje"
  | "orden_creada"
  | "lote_asignado"
  | "muelle_asignado"
  | "cargue_cerrado"

export interface ConfigInterno {
  id: number
  evento: EventoInterno
  nombre: string
  /** Posición en la línea de tiempo, para ordenarlos en la pantalla. */
  ordenLinea: number
  activo: boolean
  /** Texto de la variable `detalle`, con marcadores. */
  detalle: string
  /** Empresas donde aplica. Vacío = ninguna. */
  empresas: number[]
  actualizadoPor: string | null
}

export interface DestinatarioInterno {
  id: number
  nombre: string
  telefono: string
  activo: boolean
  /** Vacío = recibe todos los eventos activos. */
  soloEventos: EventoInterno[]
  /**
   * Empresas de las que recibe. Vacío = TODAS las del evento.
   *
   * Es lo contrario de lo que significa en la configuración del evento, donde
   * vacío es ninguna: allá protege, aquí es el caso normal (gerencia recibe
   * todo).
   */
  empresas: number[]
}

/**
 * Los datos del cargue con los que se arma el mensaje.
 *
 * No todos existen en todos los eventos: al crear la orden no hay muelle, y en
 * el pesaje no hay lote. Un marcador sin dato se reemplaza por vacío.
 */
export interface ContextoInterno {
  ordenId: number
  empresaId: number
  placa: string | null
  ordenDeCargue: string | null
  conductor: string | null
  cliente: string | null
  muelle: number | null
  lote: string | null
  peso: number | null
  tiquete: string | null
  transporte: string | null
  /** Hora del evento, ya en formato legible. */
  hora: string | null
  /** Nombre de la empresa, no su id. */
  sede: string | null
}

/** Una línea del historial. */
export interface AvisoInterno {
  id: number
  ordenId: number
  evento: EventoInterno
  eventoNombre: string
  ordenDeCargue: string | null
  placa: string | null
  telefono: string | null
  /** De `whatsapp_mensajes`. null = no se llegó a crear el mensaje. */
  estado: string | null
  errorCodigo: string | null
  errorDetalle: string | null
  /** Por qué no salió, cuando aplica. */
  motivo: string | null
  creadoEn: string
}

/**
 * Qué marcadores tiene sentido ofrecer en cada evento.
 *
 * No es una restricción del envío --un marcador sin dato sale vacío-- sino de
 * la pantalla: ofrecer {muelle} en el pesaje invita a escribir un texto que
 * siempre saldrá incompleto.
 *
 * `placa` y `orden` no están en ninguno: van siempre en la variable `vehiculo`
 * de la plantilla, y repetirlos los diría dos veces en el mismo mensaje.
 */
export const MARCADORES_POR_EVENTO: Record<EventoInterno, string[]> = {
  pesaje: ["peso", "tiquete", "conductor", "transporte", "hora", "sede"],
  orden_creada: ["conductor", "transporte", "peso", "cliente", "hora", "sede"],
  lote_asignado: ["lote", "cliente", "conductor", "hora", "sede"],
  muelle_asignado: ["muelle", "conductor", "cliente", "hora", "sede"],
  cargue_cerrado: ["conductor", "peso", "muelle", "cliente", "hora", "sede"],
}

/** Qué significa cada marcador, para el tooltip de la pantalla. */
export const QUE_ES: Record<string, string> = {
  peso: "peso en kg",
  tiquete: "número de tiquete de báscula",
  conductor: "nombre del conductor",
  transporte: "empresa transportadora",
  cliente: "cliente del despacho",
  muelle: "número de muelle",
  lote: "lote asignado",
  hora: "hora del evento",
  sede: "empresa / sede",
}
