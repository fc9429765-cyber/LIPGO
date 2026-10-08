-- ============================================================================
-- 231 — LA BITÁCORA DE EMISIÓN TAMBIÉN GUARDA LA PREFACTURA
-- ----------------------------------------------------------------------------
-- El script 230 creó `siigo_facturas_emitidas` pensando en órdenes sueltas:
-- guarda `ordenes bigint[]`. Pero en el Ciclo se factura una PREFACTURA
-- completa --la agrupación de un período-- y esa no es una lista de órdenes:
-- es un documento con su propia identidad.
--
-- Sin esta columna no se podría responder "¿esta prefactura ya se facturó?",
-- que es justo el candado que impide emitir dos veces el mismo período. Y una
-- factura electrónica de más no se borra: se anula con nota crédito.
--
-- Aditivo e idempotente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — LA COLUMNA
-- ----------------------------------------------------------------------------

alter table public.siigo_facturas_emitidas
  add column if not exists prefactura_id bigint;

comment on column public.siigo_facturas_emitidas.prefactura_id is
  'Prefactura facturada, cuando el origen es "ciclo". NULL cuando se factura una orden suelta desde Pagos de Contado.';

-- El candado contra emitir dos veces la misma prefactura.
create index if not exists ix_siigo_emit_prefactura
  on public.siigo_facturas_emitidas (prefactura_id)
  where prefactura_id is not null;


-- ----------------------------------------------------------------------------
-- PASO 2 — ENCENDER EL ENVÍO A LA DIAN
-- ----------------------------------------------------------------------------
-- El 230 creó la configuración con el envío apagado. El negocio decidió que
-- las facturas salgan firmadas y oficiales en el momento.
--
-- A PARTIR DE AQUÍ, cada factura que se emita desde LIPgo es un documento
-- fiscal definitivo: no se borra, se anula con nota crédito. Lo que protege de
-- emitir de más son las comprobaciones previas --que corresponda, que no esté
-- ya emitida-- y la confirmación explícita de cada envío.

update public.siigo_emision_config
   set enviar_dian = true,
       updated_at = now()
 where id = 1 and enviar_dian = false;


-- ----------------------------------------------------------------------------
-- PASO 3 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 3a) El envío a la DIAN quedó encendido.
select enviar_dian, documento_id, vendedor_id, forma_pago_id, producto_codigo
from public.siigo_emision_config;
-- Si `enviar_dian` es true pero falta alguno de los otros, la emisión todavía
-- no funciona: la pantalla dice cuáles faltan.

-- 3b) La columna quedó creada.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'siigo_facturas_emitidas'
  and column_name  = 'prefactura_id';

-- 3c) Cuántas facturas se han emitido de cada tipo.
select origen,
       count(*)                                    as intentos,
       count(*) filter (where exitosa)             as exitosas,
       count(*) filter (where not exitosa)         as fallidas
from public.siigo_facturas_emitidas
group by origen;

-- 3d) Las prefacturas listas para facturar: con el anexo ya firmado y sin
--     factura todavía. Son las que mostrarán el botón.
select id, owner, proyecto, periodo_desde, periodo_hasta, total
from public.prefacturas
where estado = 'aprobada'
  and estado_ciclo = 'pendiente_factura'
  and (numero_factura_siigo is null or btrim(numero_factura_siigo) = '')
  and periodo_hasta >= '2026-10-01'
order by periodo_hasta desc;
-- El filtro de fecha es el CORTE: el Ciclo arranca de cero el 1 de octubre
-- para empezar a emitir en Siigo desde este mes. Lo anterior ya se facturó
-- por fuera.


-- ----------------------------------------------------------------------------
-- REVERSIÓN
-- ----------------------------------------------------------------------------
--   alter table public.siigo_facturas_emitidas drop column if exists prefactura_id;
