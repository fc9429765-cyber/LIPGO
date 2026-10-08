/**
 * De qué pedido nació una orden de cargue.
 *
 * Módulo PURO (sin "use server", sin base de datos) para poder probarlo. Lo usa
 * `generateLoadOrder` al crear la orden, y es la misma regla que aplicó el relleno del
 * script 255 sobre el histórico.
 *
 * LA REGLA, dicha por gerencia el 2026-10-07
 *
 * Una orden puede atender a VARIOS pedidos, y un pedido puede salir en VARIAS órdenes. Por
 * eso el registro oficial de la relación vive línea por línea en `pedidodetalle_ocargue`, y
 * en la cabecera solo va el resumen:
 *
 *   `idpedido`   el pedido, SOLO cuando la orden atiende a uno. Si atiende a varios queda
 *                en nulo a propósito: poner uno de los veintidós sería mentir.
 *   `pedidos_n`  cuántos atiende. Distingue "ninguno" (la anomalía) de "varios".
 *
 * SOLO CUENTAN LAS LÍNEAS QUE DE VERDAD LLEVAN ALGO. Una línea en cero no se anota en el
 * libro (`updatePedidoDetalleStatus` solo escribe las de cantidad > 0), así que si aquí se
 * contaran, la cabecera diría que atiende a un pedido del que el libro no tiene rastro, y
 * las dos fuentes dejarían de cuadrar.
 */

export type LineaDeOrden = {
  idpedido?: number | null
  unidadescargadas?: number | null
}

export type ResumenPedidos = {
  /** El pedido, solo si la orden atiende exactamente a uno. */
  idpedido: number | null
  /** Cuántos pedidos atiende: 0 ninguno, 1 está en `idpedido`, >1 ver el libro. */
  pedidos_n: number
}

export function resumenPedidosDeLaOrden(lineas: readonly LineaDeOrden[] | null | undefined): ResumenPedidos {
  const pedidos = new Set<number>()
  for (const l of lineas ?? []) {
    const lleva = Number(l?.unidadescargadas) || 0
    if (lleva <= 0) continue
    const idp = Number(l?.idpedido)
    if (!Number.isFinite(idp) || idp <= 0) continue
    pedidos.add(idp)
  }
  return {
    idpedido: pedidos.size === 1 ? [...pedidos][0] : null,
    pedidos_n: pedidos.size,
  }
}
