-- ============================================================================
-- 206 — FACTURAS DE SIIGO GUARDADAS EN LIPgo
-- ----------------------------------------------------------------------------
-- Copia local de la facturación de Siigo, para poder consultarla, cruzarla y
-- exportarla sin depender de la API en cada lectura.
--
-- LA SINCRONIZACIÓN ES INCREMENTAL. Cada corrida pide a Siigo solo lo creado o
-- modificado desde la última vez, no el histórico entero. Eso es lo que hace
-- que la segunda consulta tarde segundos en vez de minutos.
--
-- POR QUÉ `id` DE SIIGO COMO LLAVE
-- Es el identificador que asigna Siigo y no cambia. Usar el número de factura
-- sería un error: se reinicia por tipo de comprobante, así que dos facturas
-- distintas pueden compartir número. Con `id` como llave primaria, volver a
-- traer una factura la ACTUALIZA en vez de duplicarla --que es justo lo que se
-- pide: que no se repitan las que ya están.
--
-- LOS ITEMS Y PAGOS VAN EN JSONB, NO EN TABLAS APARTE
-- Se guardan para poder consultarlos, pero LIPgo no los cruza con nada: no
-- hace falta normalizarlos. Una tabla de items obligaría a borrarlos y
-- reinsertarlos en cada actualización, con el riesgo de dejar huérfanos si
-- algo falla a mitad.
--
-- Aditivo e idempotente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — LAS FACTURAS
-- ----------------------------------------------------------------------------

create table if not exists public.siigo_facturas (
  -- El id de Siigo (uuid en texto). Llave primaria: reimportar actualiza.
  id text primary key,

  -- Identificación del comprobante.
  numero bigint,
  nombre text,                    -- "FV-1-1234", como lo arma Siigo
  documento_id int,               -- tipo de comprobante
  fecha date,

  -- Cliente.
  cliente_id text,
  cliente_identificacion text,
  cliente_nombre text,
  cliente_sucursal text,

  -- Valores.
  total numeric(18,2),
  saldo numeric(18,2),
  moneda text default 'COP',
  tasa_cambio numeric(18,6),

  centro_costo int,
  vendedor int,
  observaciones text,

  /*
   * El detalle tal como lo manda Siigo.
   *
   * Se guarda completo y sin reinterpretar: si mañana hace falta un campo que
   * hoy no se usa, está aquí en vez de exigir volver a barrer el histórico.
   */
  items jsonb default '[]'::jsonb,
  pagos jsonb default '[]'::jsonb,

  -- Fechas de Siigo. `siigo_actualizada` es la que manda la sincronización.
  siigo_creada timestamptz,
  siigo_actualizada timestamptz,

  -- Cuándo la trajo LIPgo por última vez.
  sincronizada_en timestamptz default now()
);

comment on table public.siigo_facturas is
  'Copia local de las facturas de Siigo. La llave es el id de Siigo: reimportar actualiza, no duplica. Ver scripts/206.';
comment on column public.siigo_facturas.siigo_actualizada is
  'last_updated de Siigo. Es la marca con la que se pide solo lo nuevo en la siguiente sincronizacion.';

-- Las consultas de la pantalla: por fecha, por cliente y por número.
create index if not exists ix_siigo_fact_fecha on public.siigo_facturas (fecha desc);
create index if not exists ix_siigo_fact_cliente on public.siigo_facturas (cliente_identificacion);
create index if not exists ix_siigo_fact_numero on public.siigo_facturas (numero);
-- La que decide hasta dónde se sincronizó.
create index if not exists ix_siigo_fact_actualizada on public.siigo_facturas (siigo_actualizada desc);
-- Facturas con saldo: la consulta de cartera.
create index if not exists ix_siigo_fact_saldo on public.siigo_facturas (saldo)
  where saldo > 0;


-- ----------------------------------------------------------------------------
-- PASO 2 — EL ESTADO DE LA SINCRONIZACIÓN
-- ----------------------------------------------------------------------------
-- Una sola fila. Guarda hasta dónde se trajo, para que la siguiente corrida
-- sepa desde dónde seguir.
--
-- Sin esto, cada consulta tendría que barrer el histórico completo para saber
-- qué falta: son cientos de llamadas a Siigo y varios minutos.

create table if not exists public.siigo_sync_estado (
  id int primary key default 1 check (id = 1),

  /*
   * Hasta cuándo se trajo.
   *
   * La próxima corrida pide desde aquí. Se guarda la fecha de la factura más
   * reciente que se sincronizó, NO el momento de la corrida: si Siigo tardara
   * en exponer una factura, usar "cuándo corrí" la saltaría para siempre.
   */
  ultima_actualizacion timestamptz,

  ultima_corrida timestamptz,
  ultimo_resultado text,
  facturas_totales int default 0,
  corriendo boolean not null default false,

  created_at timestamptz default now()
);

comment on column public.siigo_sync_estado.corriendo is
  'Evita que dos sincronizaciones corran a la vez y se pisen. Se libera al terminar, incluso con error.';

insert into public.siigo_sync_estado (id) values (1) on conflict (id) do nothing;


-- ----------------------------------------------------------------------------
-- PASO 3 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 3a) Las tablas quedaron creadas.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('siigo_facturas', 'siigo_sync_estado')
order by table_name;

-- 3b) El estado inicial: sin sincronizar.
select * from public.siigo_sync_estado;

-- 3c) Cuántas facturas hay guardadas.
select count(*)                     as facturas,
       min(fecha)                   as desde,
       max(fecha)                   as hasta,
       max(siigo_actualizada)       as ultima_modificada,
       count(*) filter (where saldo > 0) as con_saldo,
       sum(total)                   as total_facturado
from public.siigo_facturas;

-- 3d) Que no haya duplicados. Con `id` como llave primaria no puede haberlos;
--     esta consulta comprueba que tampoco los haya por número, que es el caso
--     que se vería raro en pantalla.
select numero, count(*) as veces
from public.siigo_facturas
where numero is not null
group by numero
having count(*) > 1
order by veces desc
limit 10;
-- Un número repetido NO es necesariamente un error: Siigo reinicia el
-- consecutivo por tipo de comprobante. Se mira junto a `documento_id`.


-- ----------------------------------------------------------------------------
-- REVERSIÓN
-- ----------------------------------------------------------------------------
-- Borra la copia local. Las facturas siguen en Siigo: se pueden volver a
-- traer, aunque el primer barrido tarde.
--
--   drop table if exists public.siigo_facturas;
--   drop table if exists public.siigo_sync_estado;
