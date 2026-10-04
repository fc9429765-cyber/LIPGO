# Integración CRM de LIP → LIPgo (Pedidos y solicitudes)

Borrador guardado el 2026-10-03 por instrucción de la Gerencia General, para cuando se
retome. Aún no se ha construido nada de esto en LIPgo.

## Alcance (gerencia, 2026-10-03)

- **Solo el ID1 (Harinera Indupan) tendrá CRM.** ID2 (Avimol) e ID3 (Cedi Funza) siguen con el
  canal manual tal como está hoy: Entrada de pedidos con aprobación de cartera y gerencia por
  clave dentro de LIPgo.
- En ID1 e ID3 la misma persona maneja pedidos y Recepción y Despacho; en ID2 son personas
  distintas. Por eso en Gestionar pedidos los botones "Generar orden de cargue" y "Ver orden de
  cargue" solo aparecen si el usuario tiene esos módulos en Gestión de Usuarios; si no, la fila
  dice "Espera orden de cargue".

## El proceso real

1. El vendedor gestiona el pedido en el **CRM de LIP** (sistema propio de LIP, fuera de LIPgo).
2. En el CRM se aprueban **cartera** y **gerencia**.
3. El pedido aprobado **cae a LIPgo** (área de Pedidos y solicitudes = logística).
4. Logística lo gestiona y lo convierte en trabajo para **Recepción y Despacho** (orden de
   cargue, vehículo, lotes, picking, báscula, entrega).
5. El CRM necesita saber en qué va cada pedido (programado, en cargue, parcial, entregado,
   cerrado, no entregado).

Mientras la integración no exista, **Entrada de pedidos** en LIPgo es el canal manual y sigue
pidiendo cartera y aprobación por clave dentro de LIPgo.

## Lo que LIPgo guarda hoy (destino de la integración)

- `pedidoscabecera`: idpedido (consecutivo de LIPgo), id_empresa (ID del proyecto), fecha,
  fecha_programada, vendedor, cliente, destino, medio (sucursal), empresa (bodega origen),
  empresafactura, condicion_pago, tipo_despacho, orden_de_compra, pedido (número del cliente),
  observaciones, total_linea, total_pagar, descuentopp, descuentoiva, aprobado ("si"),
  revisioncartera, revisiongerencia, estado (null = nuevo · aprobado · parcial · entrega
  parcial · entregado · anulado), ocargue, fechaordencargue, vehiculo, transporte, factura,
  pdfpedido.
- `pedidosdetalle`: idpedido, id_empresa, producto (nombre del catálogo), categoria,
  unidades, precio_und, total_linea, iva, descuentopp, subtotal, peso, ocargue,
  unidades_cargadas, unidadespendientes, estado.

## Contrato propuesto

### 1. CRM → LIPgo: pedido aprobado

`POST /api/integraciones/crm/pedidos` con una llave por proyecto (cabecera `x-api-key`).

```json
{
  "crm_pedido_id": "CRM-2026-004512",
  "id_empresa": 3,
  "cliente": { "nombre": "HERMARLY DISTRIBUCIONES SAS", "nit": "900653385", "sucursal": "Principal" },
  "vendedor": "JUAN BRICEÑO",
  "fecha_programada": "2026-10-06",
  "tipo_despacho": "CARGUE PROPIO",
  "condicion_pago": "Crédito 30 días",
  "orden_de_compra": "OC-7781",
  "numero_pedido_cliente": "21241",
  "observaciones": "Entregar antes de las 10 a. m.",
  "aprobaciones": {
    "cartera": { "por": "María Pérez", "en": "2026-10-03T14:02:00-05:00" },
    "gerencia": { "por": "Carlos Gómez", "en": "2026-10-03T15:10:00-05:00" }
  },
  "lineas": [
    { "producto": "PT LA NIEVE 25LB", "cantidad": 920, "precio_unitario": 48900, "descuento_iva": 0, "descuento_pp": 0 }
  ],
  "totales": { "total_linea": 44988000, "descuentos": 0, "total_pagar": 44988000 }
}
```

Reglas:
- **Idempotente** por `crm_pedido_id` (columna nueva en `pedidoscabecera`): si llega dos veces,
  responde el mismo `idpedido` de LIPgo y no duplica.
- **Mismas validaciones del formulario**: cliente y productos deben existir en el maestro del
  proyecto (por nombre, que es la llave que usa LIPgo hoy; ideal: código); tipo de despacho y
  condición de pago del catálogo; cantidad > 0.
- Llega **aprobado**: `aprobado = "si"`, `revisioncartera` y `revisiongerencia` con el nombre y la
  fecha que manda el CRM; `estado = "aprobado"`. LIPgo no vuelve a pedir clave.
- Calcula `peso` por línea con `peso_unitkg` del catálogo, genera el PDF igual que hoy y lo
  deja en `pdfpedido`.
- Si el pedido ya existía como manual con el mismo `numero_pedido_cliente` en el ID, responde
  `409` con el `idpedido` para que el CRM decida (evita el pedido doble que hoy queda pendiente).
- Respuesta: `{ "idpedido": 12345, "estado": "aprobado", "pdf": "https://…" }`.

### 2. LIPgo → CRM: estado logístico

`GET /api/integraciones/crm/pedidos/{crm_pedido_id}` o webhook a una URL del CRM en cada cambio.

```json
{
  "crm_pedido_id": "CRM-2026-004512",
  "idpedido": 12345,
  "estado": "en_cargue",
  "detalle": {
    "orden_de_cargue": "MOL202610069801",
    "vehiculo": "VXH572",
    "fecha_orden_cargue": "2026-10-06",
    "entregado_unidades": 0,
    "pendiente_unidades": 920,
    "factura": null
  },
  "actualizado_en": "2026-10-06T08:15:00-05:00"
}
```

Estados que LIPgo informa: `recibido` (cayó a logística) · `programado` (fecha asignada) ·
`en_cargue` (orden de cargue creada) · `parcial` (entregó una parte) · `entregado` · `cerrado`
(cerrado con factura) · `no_entregado` (depurado: reemplazado / cliente desistió / modificado,
con el motivo).

### 3. Cambios en LIPgo cuando se construya

- Columnas: `pedidoscabecera.crm_pedido_id` (único por id_empresa), `motivo_no_entrega`,
  `depurado_por`, `depurado_en`.
- Gestionar pedidos pasa a ser cola logística; "Aprobar cartera / Aprobar" quedan solo para el
  canal manual.
- Registro de cada mensaje recibido/enviado en una tabla de integración (payload, respuesta,
  fecha) para auditoría.
