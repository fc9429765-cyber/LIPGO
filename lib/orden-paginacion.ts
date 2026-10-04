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

// COMPROBADO CON DATOS el 2026-10-04 (así es como se debe decidir esto, no por intuición):
// se leyeron las fuentes completas y se contaron las llaves repetidas. Resultado por fuente
// más abajo. Reproducible con `scripts/verificar_llaves_paginacion.mts`.
export const ORDEN_PAGINACION: Record<string, string[]> = {
  // 23.438 filas. La llave anterior (sin `cliente`) repetía 545 veces; con `cliente`,
  // `tarifa` y `valor_a_facturar` baja a 213. NO llega a ser única: la vista produce filas
  // IDÉNTICAS en todas sus columnas (una misma orden factura el mismo producto, al mismo
  // cliente, con la misma tarifa, en dos líneas). Ningún ORDER BY puede separarlas; para
  // cerrarlo de verdad la vista tendría que exponer el id de `detalleoc`. Entre tanto, más
  // columnas = menos empates = menos riesgo en el borde de página.
  facturacion: ["numeroorden", "producto", "cliente", "toneladas", "cantidad", "tiquetebascula", "tarifa", "valor_a_facturar"],
  // 6.171 filas. La llave anterior repetía 2 veces: el mismo `idproducto` aparece con dos
  // nombres distintos ("NIEVE PAPEL 25" vs "PT LA NIEVE PAPEL PANADERIA 25KG" y
  // "...24LB BLANCA" vs "...24LB BLANCA00"). Con `nombreproducto` la llave es ÚNICA.
  saldoinvdetalle: ["idempresa", "idproducto", "lote", "location", "nombreproducto"],
  v_pedidos_vs_salidas: ["ocargue", "producto", "idempresa_pedido", "idempresa_salida"],
  v_orden_vs_salidas: ["ocargue", "producto"],
  pedidoscabecera: ["idpedido"],
  pedidosdetalle: ["idpedido", "producto", "transid"],
  parametros_legales_anio: ["anio"],
  pagonomina: ["persona", "fecha"],
  pagonomina_rango: ["persona", "fecha"],
  // 1.946 filas. La llave anterior repetía 795 veces porque no incluía el PERÍODO y
  // `fechainicio` viene vacía en la mayoría de novedades: la misma persona con la misma
  // novedad en varias quincenas colapsaba en una sola llave. Con año, mes, quincena,
  // empresa, contrato, tipo y valor baja a 1 repetida (dos filas idénticas en todo).
  archivoplano: [
    "anio",
    "mes",
    "quincena",
    "idempresa",
    "identificacionempleado",
    "contratoempleado",
    "nombrenovedad",
    "tiponovedad",
    "cantidadvalor",
    "fechainicio",
    "fechafin",
  ],
  // Misma llave que `archivoplano`: es su copia generada por rango (scripts/201) y devuelve
  // las mismas columnas (comprobado el 2026-10-04: no falta ninguna).
  archivoplano_periodo: [
    "anio",
    "mes",
    "quincena",
    "idempresa",
    "identificacionempleado",
    "contratoempleado",
    "nombrenovedad",
    "tiponovedad",
    "cantidadvalor",
    "fechainicio",
    "fechafin",
  ],
}

/** Columnas de orden estable para una tabla/vista (por defecto `id`). */
export function ordenEstable(tabla: string): string[] {
  return ORDEN_PAGINACION[tabla] ?? ["id"]
}

/** Encadena los `.order(...)` de orden estable a un builder de PostgREST. */
export function aplicarOrdenEstable(q: any, tabla: string): any {
  return ordenEstable(tabla).reduce((acc, col) => acc.order(col), q)
}
