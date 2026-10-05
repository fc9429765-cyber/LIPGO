-- ============================================================================
-- 230 — EMISIÓN DE FACTURAS HACIA SIIGO
-- ----------------------------------------------------------------------------
-- Hasta ahora LIPgo solo LEÍA de Siigo. Esto le permite CREAR facturas de
-- venta, que es una operación de otra naturaleza:
--
--   UNA FACTURA ELECTRÓNICA ACEPTADA POR LA DIAN NO SE BORRA. Se anula con una
--   nota crédito, que es otro documento contable con su propia numeración. No
--   hay "deshacer".
--
-- Por eso esta tabla existe aunque `cabeceraoc.facturasiigo` ya marque qué
-- órdenes están facturadas: hace falta saber QUÉ SE MANDÓ, CUÁNDO, QUIÉN lo
-- mandó y QUÉ RESPONDIÓ Siigo. Si una factura sale mal, esa es la única forma
-- de reconstruir qué pasó.
--
-- GUARDA LA PETICIÓN ENTERA, no un resumen. Una factura con un valor
-- equivocado se investiga mirando exactamente lo que se envió, no una versión
-- interpretada de ello.
--
-- Aditivo e idempotente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — LA BITÁCORA DE EMISIÓN
-- ----------------------------------------------------------------------------

create table if not exists public.siigo_facturas_emitidas (
  id serial primary key,

  -- Lo que devolvió Siigo. NULL si el intento falló.
  siigo_id text,
  siigo_numero bigint,
  siigo_nombre text,                -- "FV-1-1234"
  -- El CUFE que asigna la DIAN. Solo lo hay si se envió y fue aceptada.
  cufe text,
  /*
   * Draft | Accepted | Rejected, según Siigo.
   *
   * Draft  = quedó en Siigo pero NO se envió a la DIAN.
   * Accepted = la DIAN la recibió y aceptó. Ya es oficial.
   * Rejected = la DIAN la rechazó; se corrige y se reenvía DESDE SIIGO.
   */
  estado_dian text,

  /*
   * Las órdenes que cubre esta factura.
   *
   * Es un arreglo porque en el Ciclo se factura una agrupación completa --
   * varias órdenes en un solo documento-- mientras que en Pagos de Contado va
   * una por una. Las dos formas caben aquí.
   */
  ordenes bigint[] not null default '{}',

  -- A quién se le facturó.
  cliente_identificacion text,
  cliente_nombre text,

  valor_total numeric(18,2),
  /*
   * La petición tal como se mandó, y la respuesta tal como llegó.
   *
   * Sin esto, una factura con un valor equivocado solo se puede investigar
   * adivinando. Con esto se ve exactamente qué se envió.
   */
  peticion jsonb,
  respuesta jsonb,

  -- false = el intento falló; `error` dice por qué.
  exitosa boolean not null default false,
  error text,

  -- De dónde salió: 'ciclo' (agrupación) o 'contado' (una orden).
  origen text not null default 'ciclo',

  emitida_por text,
  created_at timestamptz default now()
);

comment on table public.siigo_facturas_emitidas is
  'Bitacora de las facturas creadas en Siigo desde LIPgo. Guarda la peticion y la respuesta completas: una factura electronica no se borra, y si sale mal esta es la unica forma de reconstruir que paso. Ver scripts/230.';

create index if not exists ix_siigo_emit_fecha on public.siigo_facturas_emitidas (created_at desc);
create index if not exists ix_siigo_emit_siigo on public.siigo_facturas_emitidas (siigo_id);
create index if not exists ix_siigo_emit_exitosa on public.siigo_facturas_emitidas (exitosa);
-- Para preguntar "¿esta orden ya se facturó?" sin recorrer la tabla.
create index if not exists ix_siigo_emit_ordenes on public.siigo_facturas_emitidas using gin (ordenes);


-- ----------------------------------------------------------------------------
-- PASO 2 — LA CONFIGURACIÓN DE EMISIÓN
-- ----------------------------------------------------------------------------
-- Siigo exige datos que no están en LIPgo: qué tipo de comprobante usar, qué
-- vendedor va en la factura, qué forma de pago. Son ids de Siigo, no conceptos
-- de la operación.
--
-- Van en una tabla y no en el código porque los cambia quien factura, no quien
-- programa: si Siigo renumera un tipo de comprobante, el arreglo no debe
-- exigir un despliegue.

create table if not exists public.siigo_emision_config (
  id int primary key default 1 check (id = 1),

  /*
   * Tipo de comprobante (document.id de Siigo).
   *
   * Se consulta en /document-types. Si está mal, Siigo rechaza con un error
   * que no dice cuál era el correcto.
   */
  documento_id int,

  -- Vendedor que va en la factura (id de /users en Siigo).
  vendedor_id int,

  -- Forma de pago por defecto (id de /payment-types).
  forma_pago_id int,
  -- Forma de pago para las de crédito, que llevan vencimiento.
  forma_pago_credito_id int,

  -- Impuesto que se aplica a los items (id de /taxes). NULL = sin impuesto.
  impuesto_id int,

  -- Centro de costo, opcional.
  centro_costo int,

  /*
   * Código del producto o servicio en Siigo con el que se factura.
   *
   * LIPgo factura un SERVICIO de logística, no productos: todas las líneas
   * usan el mismo código. Debe existir y estar activo en Siigo.
   */
  producto_codigo text,

  /*
   * Si las facturas se envían a la DIAN al crearlas.
   *
   * En true la factura sale firmada y oficial en el momento. En false queda en
   * Draft dentro de Siigo y alguien la revisa antes.
   *
   * Arranca en FALSE a propósito: la primera factura de verdad conviene verla
   * antes de que sea oficial.
   */
  enviar_dian boolean not null default false,

  -- Si se le manda copia por correo al cliente.
  enviar_correo boolean not null default false,

  actualizado_por text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

comment on column public.siigo_emision_config.enviar_dian is
  'true = la factura sale firmada y oficial al crearla, y ya NO se puede borrar (solo anular con nota credito). Arranca en false.';

insert into public.siigo_emision_config (id) values (1) on conflict (id) do nothing;


-- ----------------------------------------------------------------------------
-- PASO 3 — EL CLIENTE DE SIIGO POR CADA OWNER DE LIPgo
-- ----------------------------------------------------------------------------
-- LIPgo factura a "owners" (Indupan, Avimol...). Siigo factura a terceros con
-- NIT. Esta tabla es el puente.
--
-- Sin ella habría que elegir el cliente a mano en cada factura, que es
-- justamente donde se cometería el error más caro: facturarle a quien no era.

create table if not exists public.siigo_owner_cliente (
  owner text primary key,
  -- NIT o cédula, tal como está en Siigo.
  cliente_identificacion text not null,
  cliente_nombre text,
  activo boolean not null default true,
  created_at timestamptz default now()
);

comment on table public.siigo_owner_cliente is
  'Puente entre los owners de LIPgo y los terceros de Siigo. Evita elegir el cliente a mano en cada factura, que es donde se cometeria el error mas caro.';


-- ----------------------------------------------------------------------------
-- PASO 4 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 4a) Las tablas quedaron creadas.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('siigo_facturas_emitidas', 'siigo_emision_config', 'siigo_owner_cliente')
order by table_name;

-- 4b) La configuración arranca vacía y SIN envío a la DIAN.
select * from public.siigo_emision_config;

-- 4c) Todavía no se ha emitido ninguna.
select count(*) as emitidas,
       count(*) filter (where exitosa) as exitosas,
       count(*) filter (where not exitosa) as fallidas
from public.siigo_facturas_emitidas;

-- 4d) Qué owners existen hoy en la facturación, para saber cuáles hay que
--     mapear a un tercero de Siigo.
select distinct empresafactura as owner
from public.pedidoscabecera
where empresafactura is not null
order by 1;

-- 4e) Órdenes que ya tienen factura de Siigo registrada: esas NO se deben
--     volver a facturar.
select count(*) as ya_facturadas
from public.cabeceraoc
where facturasiigo is not null and btrim(facturasiigo) <> '';


-- ----------------------------------------------------------------------------
-- REVERSIÓN
-- ----------------------------------------------------------------------------
-- OJO: borrar la bitácora NO anula las facturas en Siigo. Lo que se pierde es
-- el rastro de qué se mandó, que es justo lo que haría falta para investigar.
--
--   drop table if exists public.siigo_facturas_emitidas;
--   drop table if exists public.siigo_emision_config;
--   drop table if exists public.siigo_owner_cliente;
