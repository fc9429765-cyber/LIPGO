-- =====================================================================
-- 211_programacion_cliente.sql — Programación del cliente para el día
-- siguiente y su cumplimiento. Aditivo e idempotente. Correr en el SQL
-- Editor de Supabase.
--
-- Gerencia (2026-10-01): el cliente entrega un día antes la programación de
-- vehículos de mañana (cantidad · tipo de vehículo · destino o ruta). Con eso
-- se planea la operación y se mide cuánto cumple el cliente cada proyección.
-- Reemplaza a la "Proyección" de nómina (último día de la quincena), que ya
-- no se usa porque se paga el día base.
--
-- 1) Tabla programacion_cliente: una fila por ENVÍO (versión). Solo la última
--    versión de cada (empresa, fecha) está `vigente`; las anteriores quedan de
--    historial. `a_tiempo` = enviada antes de las 5:00 p. m. (America/Bogota)
--    del día anterior a la fecha de operación.
-- 2) Permiso `programacion_cliente` en permisos_usuarios para el módulo
--    "Programación del cliente" (Pedidos y solicitudes). La vista de
--    cumplimiento de Torre de Control usa el permiso `proyecciones`, que ya
--    existe. El permiso nuevo se asigna desde Gestión de Usuarios: aquí NO se
--    activa a nadie.
-- =====================================================================

create table if not exists public.programacion_cliente (
  id                  bigserial primary key,
  idempresa           integer     not null,
  fecha_operacion     date        not null,
  version             integer     not null default 1,
  vigente             boolean     not null default true,
  lineas              jsonb       not null default '[]'::jsonb,
  total_vehiculos     integer     not null default 0,
  observaciones       text,
  enviada_en          timestamptz not null default now(),
  a_tiempo            boolean     not null default true,
  enviada_por         uuid,
  enviada_por_usuario text,
  enviada_por_empresa integer,
  created_at          timestamptz not null default now()
);

create unique index if not exists ux_programacion_cliente_version
  on public.programacion_cliente (idempresa, fecha_operacion, version);

create index if not exists idx_programacion_cliente_vigente
  on public.programacion_cliente (idempresa, fecha_operacion)
  where vigente;

comment on table public.programacion_cliente is
  'Programación de vehículos que el cliente entrega para el día siguiente. Una fila por versión enviada; vigente = la última.';
comment on column public.programacion_cliente.lineas is
  'JSON [{tipovehiculo, destino, producto, cantidad, observaciones}]. tipovehiculo = nombre del catálogo tiposvehiculos.';
comment on column public.programacion_cliente.a_tiempo is
  'true si se envió antes de las 17:00 (America/Bogota) del día anterior a fecha_operacion.';
comment on column public.programacion_cliente.enviada_por_empresa is
  'empresa_id del perfil que envió: permite distinguir si la registró el cliente o LIP.';

alter table public.permisos_usuarios
  add column if not exists programacion_cliente boolean not null default false;

comment on column public.permisos_usuarios.programacion_cliente is
  'Módulo "Programación del cliente" (Pedidos y solicitudes): registrar la programación de mañana y ver su cumplimiento.';
