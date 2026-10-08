// TIPOS Y CONSTANTES DEL MÓDULO DE AUDITORÍA ISO 9001:2015
//
// Viven aquí y no en `auditoria-actions.ts` porque aquel es `"use server"` y
// esos archivos solo pueden exportar funciones async: exportar un tipo o una
// constante rompe el build, y el typecheck no lo detecta.

/** Los resultados posibles de evaluar un requisito. */
export const RESULTADOS = [
  "Pendiente",
  "Conforme",
  "No conforme",
  "Observación",
  "Oportunidad de mejora",
  "No aplica",
] as const
export type Resultado = (typeof RESULTADOS)[number]

export const TIPOS_AUDITORIA = ["Interna", "Externa", "Certificación"] as const
export const TIPOS_HALLAZGO = ["No conformidad", "Observación", "Oportunidad de mejora"] as const
export const ESTADOS_HALLAZGO = ["Abierto", "En proceso", "Cerrado"] as const

/** borrador → en_curso → cerrada */
export const ESTADOS_AUDITORIA = ["borrador", "en_curso", "cerrada"] as const
export type EstadoAuditoria = (typeof ESTADOS_AUDITORIA)[number]

export type RequisitoISO = {
  codigo: string
  capitulo: number
  requisito: string
  pregunta: string
  orden: number | null
}

export type Auditoria = {
  id: number
  idempresa: number
  codigo: string | null
  fecha: string
  organizacion: string | null
  proceso: string | null
  responsable_proceso: string | null
  auditor_lider: string | null
  equipo_auditor: string | null
  tipo: string
  objetivo: string | null
  alcance: string | null
  criterios: string | null
  metodologia: string | null
  periodo_auditado: string | null
  estado: EstadoAuditoria
  conclusiones: string | null
  fecha_cierre: string | null
  creado_por: string | null
  created_at: string
}

export type RespuestaAuditoria = {
  id: number
  auditoria_id: number
  requisito_codigo: string
  resultado: Resultado
  evidencia: string | null
  documento: string | null
  comentario: string | null
  auditor: string | null
  fecha: string | null
  // Se trae junto con la respuesta para no pedir el catálogo aparte.
  requisito?: RequisitoISO
}

export type Hallazgo = {
  id: number
  auditoria_id: number
  requisito_codigo: string | null
  consecutivo: string | null
  tipo: string
  proceso: string | null
  criterio: string | null
  evidencia: string | null
  descripcion: string
  correccion_inmediata: string | null
  analisis_causa: string | null
  accion_correctiva: string | null
  responsable: string | null
  fecha_compromiso: string | null
  verificacion_eficacia: string | null
  estado: string
  fecha_cierre: string | null
  observaciones: string | null
  created_at: string
}

/** El tablero de una auditoría: lo que el Excel calcula en la hoja DASHBOARD. */
export type ResumenAuditoria = {
  evaluados: number
  conformes: number
  noConformes: number
  observaciones: number
  oportunidades: number
  noAplica: number
  pendientes: number
  /** conformes / (evaluados − no aplica). null cuando no hay nada que medir. */
  cumplimiento: number | null
  porCapitulo: Array<{
    capitulo: number
    evaluados: number
    conformes: number
    noConformes: number
    observaciones: number
    oportunidades: number
    cumplimiento: number | null
  }>
}

/**
 * Cumplimiento de un conjunto de respuestas.
 *
 * `No aplica` se RESTA del denominador: un requisito que no le corresponde al
 * proceso auditado no puede contar como incumplido. Es la misma regla que trae
 * el Excel ("conformes / (evaluados - no aplica)").
 *
 * Los `Pendiente` SÍ cuentan en el denominador: mientras no se evalúen, el
 * proceso no ha demostrado conformidad. Si no contaran, una auditoría recién
 * abierta mostraría 100% de cumplimiento sin haber revisado nada.
 *
 * Devuelve null --no 0-- cuando no queda nada que medir: un 0% diría "todo
 * incumplido", que es una afirmación distinta de "no hay con qué calcularlo".
 */
export function calcularCumplimiento(respuestas: Array<{ resultado: string }>): number | null {
  const aplicables = respuestas.filter((r) => r.resultado !== "No aplica")
  if (aplicables.length === 0) return null
  const conformes = aplicables.filter((r) => r.resultado === "Conforme").length
  return Math.round((conformes / aplicables.length) * 1000) / 10
}
