// TIPOS DE LA PESTAÑA "FACTURAR A SIIGO"
//
// Viven aquí y no en `facturar-siigo-actions.ts` porque aquel es "use server"
// y solo puede exportar funciones async.

/**
 * El estado que deja Solicitar Facturas cuando el coordinador pide la factura.
 * Es la misma cadena que `SOLICITADA` en lib/siigo-emision-actions.ts (allí no
 * se puede exportar por ser "use server"); si cambia una, cambia la otra.
 */
export const ESTADO_SOLICITADA = "CF - Factura solicitada"

export type MedioFactura = "Contado" | "Crédito" | "Sin definir"

export type OrdenFacturable = {
  id: number
  ordendecargue: string
  fechacargue: string | null
  idempresa: number
  proyecto: string
  placa: string | null
  transporte: string | null
  tipooperacion: string | null
  cliente: string | null
  /** Razón social dueña del producto, según la vista `facturacion`. */
  owner: string
  /** La orden mezcla productos de más de un owner: se factura con cuidado. */
  ownerMezclado: boolean
  mediopago: string | null
  estadofactura: string | null
  facturasiigo: string | null
  /** Nombre del comprobante si ya se emitió desde LIPgo. */
  emitidaSiigo: string | null
  /** Lo confirmado en Solicitar Facturas (con IVA y retefuente). 0 si no se ha confirmado. */
  valorpago: number
  /** Operación × tarifa, el mismo número del cuadro y la prefactura. */
  valorNeto: number
  /** Lo que se factura: `valorpago` si existe, si no el neto. */
  valor: number
  medio: MedioFactura
  /** El medio no estaba definido en la orden: sale de la regla del proyecto. */
  medioEsperado: boolean
  facturable: boolean
  /** Por qué no se puede facturar, cuando no se puede. */
  motivo: string | null
}

export type FiltroPeriodo = { desde: string; hasta: string; empresaId?: number | null }
