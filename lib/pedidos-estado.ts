// ESTADOS DE PEDIDO — fuente única (módulo PURO: sin "use server", sin Supabase).
//
// Lo usan las server actions (filtros PostgREST, depuración) y los componentes
// (chips, siguiente paso). Regla de gerencia 2026-10-03: Pedidos es un proceso
// del CLIENTE (el ID); el coordinador LIP no participa.
//
// Literales que viven en pedidoscabecera.estado (todos en minúscula):
//   null              → nuevo (recién registrado, sin aprobar)
//   "aprobado"        → aprobado por gerencia (canal manual) o llegado aprobado del CRM
//   "parcial"         → una parte ya se cargó (orden de cargue parcial)
//   "entregado"       → todas las líneas cerradas
//   "entrega parcial" → parcial cerrado a mano ("Cerrar pendiente") o depurado siendo parcial
//   "anulado"         → anulado con clave
//   "no entregado"    → depurado: nunca tuvo rastro logístico (nuevo desde SQL 215)
//
// OJO: "no entregado" CONTIENE "entregado". Nunca filtrar con ilike '%entregado%'.
// Usar siempre FILTRO_ABIERTOS_POSTGREST / esEstadoFinal.

export const ESTADO_NO_ENTREGADO = "no entregado"
export const ESTADO_ENTREGA_PARCIAL = "entrega parcial"
export const ESTADOS_FINALES = ["entregado", "entrega parcial", "anulado", "no entregado"] as const

/** Para `.or(...)` de PostgREST: pedidos que siguen abiertos (nuevos, aprobados, parciales, en cargue). */
export const FILTRO_ABIERTOS_POSTGREST =
  "estado.is.null,and(estado.not.ilike.entregado,estado.not.ilike.entrega parcial,estado.not.ilike.anulado,estado.not.ilike.no entregado)"

/** Días de atraso sin rastro logístico a partir de los cuales un pedido es candidato a depuración. */
export const DIAS_SIN_RASTRO = 15
/** Días desde la promesa a partir de los cuales un parcial es candidato a cierre por depuración. */
export const DIAS_PARCIAL = 30

export function normalizarEstado(estado: unknown): string {
  return String(estado ?? "").trim().toLowerCase()
}

export function esEstadoFinal(estado: unknown): boolean {
  const e = normalizarEstado(estado)
  return (ESTADOS_FINALES as readonly string[]).includes(e)
}

export type EstadoPedido =
  | "nuevo"
  | "aprobado_sin_programar"
  | "programado"
  | "en_cargue"
  | "parcial"
  | "entregado"
  | "cerrado"
  | "no_entregado"
  | "anulado"

export type TonoEstado = "ok" | "atencion" | "critico" | "info" | "neutro"

export type SiguientePaso = "aprobar_cartera" | "aprobar" | "programar" | "generar_oc" | "ver_oc" | "cerrar_pendiente"

export interface PedidoParaEstado {
  estado?: string | null
  aprobado?: string | null
  revisioncartera?: string | null
  revisiongerencia?: string | null
  ocargue?: string | null
  fechaordencargue?: string | null
  fechadeentrega?: string | null
  fecha_programada?: string | null
  fecha?: string | null
  factura?: string | null
  vehiculo?: string | null
}

export interface EstadoDerivado {
  estado: EstadoPedido
  /** Texto corto para el chip: "Atrasado 4 d", "Para hoy", "Parcial · faltan 60 und"… */
  etiqueta: string
  tono: TonoEstado
  /** Días desde la promesa (positivo = atrasado, 0 = hoy, negativo = futuro). 0 si no hay promesa. */
  atrasoDias: number
  esHoy: boolean
  esManana: boolean
  esFinal: boolean
  conCartera: boolean
  /** Nunca tuvo orden de cargue, vehículo, fecha de OC, entrega ni líneas con OC. */
  sinRastro: boolean
  /** Días de antigüedad para la depuración: desde la fecha más reciente entre registro y promesa. */
  antiguedadDias: number
  candidatoDepuracion: "sin_rastro" | "parcial" | null
  siguientePaso: { clave: SiguientePaso; texto: string } | null
}

export interface OpcionesDerivar {
  /** Cuántas líneas de pedidosdetalle tienen ocargue (si no se pasa, se asume 0). */
  lineasConOcargue?: number
  unidadesPedidas?: number
  unidadesCargadas?: number
}

const soloFecha = (v: unknown): string | null => {
  if (!v) return null
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** Días calendario entre dos fechas ISO (a − b). */
export function diasEntre(aISO: string, bISO: string): number {
  return Math.round((Date.parse(aISO + "T12:00:00Z") - Date.parse(bISO + "T12:00:00Z")) / 86400000)
}

export function sumarDiasISO(fechaISO: string, n: number): string {
  return new Date(Date.parse(fechaISO + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10)
}

const tieneTexto = (v: unknown) => String(v ?? "").trim().length > 0

export function derivarEstado(p: PedidoParaEstado, hoyISO: string, opts: OpcionesDerivar = {}): EstadoDerivado {
  const est = normalizarEstado(p.estado)
  const promesa = soloFecha(p.fecha_programada)
  const registro = soloFecha(p.fecha)
  const atraso = promesa ? diasEntre(hoyISO, promesa) : 0
  const referencia = promesa && registro ? (promesa > registro ? promesa : registro) : promesa ?? registro
  const antiguedad = referencia ? diasEntre(hoyISO, referencia) : 0
  const lineasOc = opts.lineasConOcargue ?? 0
  const conCartera = tieneTexto(p.revisioncartera)
  const aprobado = normalizarEstado(p.aprobado) === "si"
  const sinRastro = !tieneTexto(p.ocargue) && !p.fechaordencargue && !tieneTexto(p.vehiculo) && !p.fechadeentrega && lineasOc === 0 && est !== "parcial"

  const base = { atrasoDias: atraso, esHoy: atraso === 0 && !!promesa, esManana: atraso === -1, conCartera, sinRastro, antiguedadDias: antiguedad }
  const fin = (estado: EstadoPedido, etiqueta: string, tono: TonoEstado): EstadoDerivado => ({
    ...base,
    estado,
    etiqueta,
    tono,
    esFinal: true,
    candidatoDepuracion: null,
    siguientePaso: null,
  })

  if (est === "anulado") return fin("anulado", "Anulado", "neutro")
  if (est === ESTADO_NO_ENTREGADO) return fin("no_entregado", "No entregado", "neutro")
  if (est === ESTADO_ENTREGA_PARCIAL || tieneTexto(p.factura)) return fin("cerrado", tieneTexto(p.factura) ? `Cerrado · F ${String(p.factura).trim()}` : "Entrega parcial", "ok")
  if (est === "entregado") return fin("entregado", "Entregado", "ok")

  if (est === "parcial") {
    const faltan = opts.unidadesPedidas != null && opts.unidadesCargadas != null ? Math.max(0, opts.unidadesPedidas - opts.unidadesCargadas) : null
    return {
      ...base,
      estado: "parcial",
      etiqueta: faltan != null ? `Parcial · faltan ${faltan.toLocaleString("es-CO")} und` : "Parcial",
      tono: "atencion",
      esFinal: false,
      candidatoDepuracion: antiguedad > DIAS_PARCIAL ? "parcial" : null,
      siguientePaso: { clave: "cerrar_pendiente", texto: "Cerrar pendiente" },
    }
  }

  if (!sinRastro) {
    return {
      ...base,
      estado: "en_cargue",
      etiqueta: tieneTexto(p.ocargue) ? `En cargue · ${String(p.ocargue).trim()}` : "En cargue",
      tono: "info",
      esFinal: false,
      candidatoDepuracion: null,
      siguientePaso: { clave: "ver_oc", texto: "Ver orden de cargue" },
    }
  }

  const candidato: "sin_rastro" | null = antiguedad > DIAS_SIN_RASTRO ? "sin_rastro" : null

  if (aprobado) {
    if (!promesa) {
      return { ...base, estado: "aprobado_sin_programar", etiqueta: "Aprobado · sin fecha", tono: "atencion", esFinal: false, candidatoDepuracion: candidato, siguientePaso: { clave: "programar", texto: "Programar fecha" } }
    }
    if (atraso > 0) {
      return { ...base, estado: "programado", etiqueta: `Atrasado ${atraso} d`, tono: "critico", esFinal: false, candidatoDepuracion: candidato, siguientePaso: { clave: "generar_oc", texto: "Generar orden de cargue" } }
    }
    return {
      ...base,
      estado: "programado",
      etiqueta: atraso === 0 ? "Para hoy" : atraso === -1 ? "Para mañana" : "Programado",
      tono: "info",
      esFinal: false,
      candidatoDepuracion: null,
      siguientePaso: { clave: "generar_oc", texto: "Generar orden de cargue" },
    }
  }

  // Nuevo (canal manual): falta cartera o falta aprobación de gerencia.
  return {
    ...base,
    estado: "nuevo",
    etiqueta: conCartera ? "Nuevo · cartera lista" : "Nuevo",
    tono: "neutro",
    esFinal: false,
    candidatoDepuracion: candidato,
    siguientePaso: conCartera ? { clave: "aprobar", texto: "Aprobar" } : { clave: "aprobar_cartera", texto: "Aprobar cartera" },
  }
}

export interface MotivoDepuracion {
  clave: "reemplazado" | "desistio" | "modificado" | "vencido" | "otro"
  texto: string
}

export const MOTIVOS_DEPURACION: readonly MotivoDepuracion[] = [
  { clave: "reemplazado", texto: "Reemplazado por otro pedido" },
  { clave: "desistio", texto: "El cliente desistió" },
  { clave: "modificado", texto: "Pedido modificado (se registró otro)" },
  { clave: "vencido", texto: "Vencido sin gestión" },
  { clave: "otro", texto: "Otro" },
]

export function textoMotivo(clave: string, detalle?: string | null): string {
  const m = MOTIVOS_DEPURACION.find((x) => x.clave === clave)
  const base = m ? m.texto : "Otro"
  const d = String(detalle ?? "").trim()
  return d ? `${base} · ${d}` : base
}

/** Orden de urgencia para la cola: atrasados → hoy → mañana → futuros → sin fecha → en cargue → parciales → nuevos. */
export function pesoOrdenCola(d: EstadoDerivado): number {
  switch (d.estado) {
    case "programado":
      if (d.atrasoDias > 0) return 0
      if (d.esHoy) return 1
      if (d.esManana) return 2
      return 3
    case "aprobado_sin_programar":
      return 4
    case "en_cargue":
      return 5
    case "parcial":
      return 6
    case "nuevo":
      return d.conCartera ? 7 : 8
    default:
      return 9
  }
}
