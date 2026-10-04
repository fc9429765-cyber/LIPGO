// Orden ÚNICO y estable para paginar con `.range()` en Supabase/PostgREST.
//
// Cada página de 1.000 filas es una consulta distinta, y Postgres NO garantiza
// el mismo desempate de filas iguales entre una página y la siguiente: sin un
// ORDER BY por una llave única, en el corte de página una fila se repite y otra
// se pierde. Verificado con datos reales el 2026-09-27 en la nómina (ver la nota
// en lib/liquidaciones-actions.ts): dos retirados cobraban un día duplicado.
//
// Regla: todo `.range(...)` va precedido de `.order(...)` por una llave única.
// Para las tablas con `id` basta `id`; las vistas no tienen `id` y se ordenan
// por la combinación de columnas que identifica cada fila (o, si aún así
// hubiera dos filas idénticas, da igual cuál quede en qué página).

export const ORDEN_PAGINACION: Record<string, string[]> = {
  facturacion: ["numeroorden", "producto", "toneladas", "cantidad", "tiquetebascula"],
  saldoinvdetalle: ["idempresa", "idproducto", "lote", "location"],
  v_pedidos_vs_salidas: ["ocargue", "producto", "idempresa_pedido", "idempresa_salida"],
  v_orden_vs_salidas: ["ocargue", "producto"],
  pedidoscabecera: ["idpedido"],
  pedidosdetalle: ["idpedido", "producto", "transid"],
  parametros_legales_anio: ["anio"],
  pagonomina: ["persona", "fecha"],
  pagonomina_rango: ["persona", "fecha"],
  archivoplano: ["identificacionempleado", "nombrenovedad", "fechainicio"],
  archivoplano_periodo: ["identificacionempleado", "nombrenovedad", "fechainicio"],
}

/** Columnas de orden estable para una tabla/vista (por defecto `id`). */
export function ordenEstable(tabla: string): string[] {
  return ORDEN_PAGINACION[tabla] ?? ["id"]
}

/** Encadena los `.order(...)` de orden estable a un builder de PostgREST. */
export function aplicarOrdenEstable(q: any, tabla: string): any {
  return ordenEstable(tabla).reduce((acc, col) => acc.order(col), q)
}
