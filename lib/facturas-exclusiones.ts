// Placas que LIP NO atiende en el cargue de ciertos proyectos y que, por tanto,
// se EXCLUYEN por completo del submódulo de Solicitar Facturas (listado, conteo
// y export). La orden sí existe en `cabeceraoc` (la generó la operación), pero no
// corresponde a LIP facturarla.
//
// Proyecto 4 (CEDI Medellín): WMP446 — vehículo que LIP no atiende en el cargue.
export const PLACAS_EXCLUIDAS_FACTURAS: Record<number, string[]> = {
  4: ["WMP446"],
}

/**
 * Excluye del cobro las órdenes marcadas como NO facturables (`cabeceraoc.facturar
 * = false`). El check "Facturar" se decide en la operación:
 *   · CARGUE en Picking → se desmarca cuando el personal que carga NO es de LIP.
 *   · DISTRIBUCIÓN en Packing → se desmarca cuando el conductor va solo (sin auxiliares).
 * Encendido por defecto: `null`/`true` = SÍ factura; solo `false` (desmarcado) se excluye.
 */
export function excluirNoFacturable(q: any): any {
  // PostgREST: se conservan las filas donde facturar != false (incluye null).
  return q.or("facturar.is.null,facturar.is.true")
}

/**
 * Aplica la exclusión de placas al query de `cabeceraoc` para la empresa dada.
 * CONSERVA las filas con placa nula: el filtro es `placa IS NULL OR placa <> 'X'`
 * (un simple `neq`/`not` dejaría fuera las nulas, que sí deben aparecer).
 * Se usa igual en el listado, el conteo y el export para que el número cuadre.
 */
export function excluirPlacasFacturas(q: any, empresaId: number | null): any {
  if (!empresaId) return q
  for (const placa of PLACAS_EXCLUIDAS_FACTURAS[empresaId] ?? []) {
    q = q.or(`placa.is.null,placa.neq.${placa}`)
  }
  return q
}
