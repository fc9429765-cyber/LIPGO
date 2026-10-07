-- ============================================================================
-- 229 — MAESTROS DE SIIGO GUARDADOS EN LIPgo
-- ----------------------------------------------------------------------------
-- Copia local de los catálogos de Siigo: productos, clientes, formas de pago e
-- impuestos. Sirven para cruzar lo que factura Siigo con lo que opera LIPgo
-- --un código de producto, un NIT-- sin tener que mirarlos a mano en el panel.
--
-- MISMA IDEA QUE LAS FACTURAS (scripts/206): la llave es el `id` de Siigo, así
-- que reimportar ACTUALIZA en vez de duplicar. Un producto cuyo precio cambia
-- debe quedar con el precio nuevo, no con dos filas contradictorias.
--
-- PRODUCTOS Y CLIENTES SE SINCRONIZAN INCREMENTALMENTE; las formas de pago y
-- los impuestos NO. La diferencia es de tamaño: los primeros son miles y
-- cambian a diario, los segundos son unas pocas decenas que casi nunca cambian
-- --traerlos enteros cuesta una llamada--.
--
-- Aditivo e idempotente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — PRODUCTOS
-- ----------------------------------------------------------------------------

create table if not exists public.siigo_productos (
  id text primary key,

  codigo text,
  nombre text,
  referencia text,
  descripcion text,

  tipo text,                      -- Product | Service | Consumer Good
  activo boolean default true,
  controla_inventario boolean,

  grupo_id int,
  grupo_nombre text,

  unidad_codigo text,
  unidad_nombre text,

  -- El precio de la primera lista. El resto queda en `precios`.
  precio numeric(18,2),
  /*
   * Siigo admite varias listas de precios y varias monedas. Se guarda el
   * bloque entero y se saca aparte el de la primera lista, que es el que se
   * consulta el 99% de las veces. Normalizarlo todo exigiría otra tabla para
   * un dato que LIPgo no cruza con nada.
   */
  precios jsonb default '[]'::jsonb,

  impuestos jsonb default '[]'::jsonb,
  clasificacion_impuesto text,
  impuesto_incluido boolean,

  -- Inventario. Útil para cruzar con lo que LIPgo tiene en bodega.
  cantidad_disponible numeric(18,3),
  bodegas jsonb default '[]'::jsonb,

  codigo_barras text,
  marca text,

  siigo_creado timestamptz,
  siigo_actualizado timestamptz,
  sincronizado_en timestamptz default now()
);

comment on table public.siigo_productos is
  'Copia local de los productos de Siigo. La llave es el id de Siigo: reimportar actualiza, no duplica. Ver scripts/229.';

create index if not exists ix_siigo_prod_codigo on public.siigo_productos (codigo);
create index if not exists ix_siigo_prod_nombre on public.siigo_productos (nombre);
create index if not exists ix_siigo_prod_activo on public.siigo_productos (activo) where activo = true;
create index if not exists ix_siigo_prod_actualizado on public.siigo_productos (siigo_actualizado desc);


-- ----------------------------------------------------------------------------
-- PASO 2 — CLIENTES
-- ----------------------------------------------------------------------------

create table if not exists public.siigo_clientes (
  id text primary key,

  identificacion text,
  digito_verificacion text,
  tipo_identificacion text,
  sucursal int,

  /*
   * Siigo manda el nombre PARTIDO en un arreglo: para una persona son nombre y
   * apellido, para una empresa la razón social en un solo elemento. Se guarda
   * ya unido, que es como se usa, y el arreglo original se pierde a propósito:
   * reconstruirlo no sirve para nada y guardarlo invitaría a usarlo mal.
   */
  nombre text,
  nombre_comercial text,

  tipo text,                      -- Customer | Supplier | Other
  tipo_persona text,              -- Person | Company
  activo boolean default true,
  responsable_iva boolean,

  direccion text,
  ciudad text,
  departamento text,
  pais text,

  -- El primer teléfono y el primer correo de contacto, que es lo que se busca.
  telefono text,
  email text,

  responsabilidades_fiscales jsonb default '[]'::jsonb,
  contactos jsonb default '[]'::jsonb,
  observaciones text,

  siigo_creado timestamptz,
  siigo_actualizado timestamptz,
  sincronizado_en timestamptz default now()
);

comment on table public.siigo_clientes is
  'Copia local de los clientes/terceros de Siigo. Ver scripts/229.';

create index if not exists ix_siigo_cli_ident on public.siigo_clientes (identificacion);
create index if not exists ix_siigo_cli_nombre on public.siigo_clientes (nombre);
create index if not exists ix_siigo_cli_activo on public.siigo_clientes (activo) where activo = true;
create index if not exists ix_siigo_cli_actualizado on public.siigo_clientes (siigo_actualizado desc);


-- ----------------------------------------------------------------------------
-- PASO 3 — FORMAS DE PAGO E IMPUESTOS
-- ----------------------------------------------------------------------------
-- Son unas pocas decenas y casi nunca cambian: se traen enteras en cada
-- sincronización, sin marca incremental. No vale la pena el mecanismo.

create table if not exists public.siigo_formas_pago (
  id int primary key,
  nombre text,
  tipo text,
  activo boolean default true,
  maneja_vencimiento boolean,
  sincronizado_en timestamptz default now()
);

create table if not exists public.siigo_impuestos (
  id int primary key,
  nombre text,
  tipo text,
  porcentaje numeric(9,4),
  activo boolean default true,
  sincronizado_en timestamptz default now()
);


-- ----------------------------------------------------------------------------
-- PASO 4 — EL ESTADO DE CADA MAESTRO
-- ----------------------------------------------------------------------------
-- Una fila por maestro. Guarda hasta dónde se trajo, igual que el de facturas.

create table if not exists public.siigo_maestros_estado (
  -- productos | clientes | formas_pago | impuestos
  maestro text primary key,

  /*
   * Hasta cuándo se trajo. Solo lo usan productos y clientes.
   *
   * Se guarda la fecha del registro más reciente que se sincronizó, NO el
   * momento de la corrida: si Siigo tardara en exponer un cambio, usar "cuándo
   * corrí" lo saltaría para siempre.
   */
  ultima_actualizacion timestamptz,

  ultima_corrida timestamptz,
  ultimo_resultado text,
  registros int default 0,
  corriendo boolean not null default false,

  created_at timestamptz default now()
);

insert into public.siigo_maestros_estado (maestro)
values ('productos'), ('clientes'), ('formas_pago'), ('impuestos')
on conflict (maestro) do nothing;


-- ----------------------------------------------------------------------------
-- PASO 5 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 5a) Las tablas quedaron creadas.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'siigo_%'
order by table_name;

-- 5b) El estado inicial: nada sincronizado todavía.
select * from public.siigo_maestros_estado order by maestro;

-- 5c) Cuánto hay guardado de cada cosa.
select 'productos'   as maestro, count(*) as registros,
       count(*) filter (where activo) as activos,
       max(siigo_actualizado) as ultimo_cambio
from public.siigo_productos
union all
select 'clientes', count(*), count(*) filter (where activo), max(siigo_actualizado)
from public.siigo_clientes
union all
select 'formas_pago', count(*), count(*) filter (where activo), null
from public.siigo_formas_pago
union all
select 'impuestos', count(*), count(*) filter (where activo), null
from public.siigo_impuestos;


-- ----------------------------------------------------------------------------
-- REVERSIÓN
-- ----------------------------------------------------------------------------
-- Borra la copia local. Los maestros siguen en Siigo y se pueden volver a
-- traer.
--
--   drop table if exists public.siigo_productos;
--   drop table if exists public.siigo_clientes;
--   drop table if exists public.siigo_formas_pago;
--   drop table if exists public.siigo_impuestos;
--   drop table if exists public.siigo_maestros_estado;
