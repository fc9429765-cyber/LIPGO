
-- 217 · Monitoreo de errores propio de LIPgo (programa de nivel mundial, paso 3).
-- Hasta hoy los errores los descubría el usuario. Desde este script la app guarda cada
-- error no capturado del navegador (window.onerror, promesas rechazadas, límite de error
-- de React) y los que las acciones del servidor registren, con usuario, proyecto,
-- pantalla, versión desplegada y navegador. Sin servicio externo ni cuenta adicional.
-- Aditivo e idempotente. Lectura: scripts/verificar_errores_app.mts.

create table if not exists public.app_errores (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  origen        text not null default 'cliente',   -- cliente | promesa | boundary | servidor
  mensaje       text not null,
  stack         text,
  componente    text,                              -- pila de componentes de React (boundary)
  modulo        text,                              -- pantalla activa (parámetro m de la URL)
  url           text,
  navegador     text,
  usuario_id    uuid,
  usuario       text,
  empresa_id    integer,
  version       text,                              -- commit desplegado (7 caracteres)
  entorno       text,                              -- production | preview | development
  extra         jsonb,
  resuelto      boolean not null default false,
  resuelto_por  text,
  resuelto_en   timestamptz
);
create index if not exists idx_app_errores_fecha   on public.app_errores (created_at desc);
create index if not exists idx_app_errores_mensaje on public.app_errores (left(mensaje, 120), created_at desc);
create index if not exists idx_app_errores_abiertos on public.app_errores (resuelto, created_at desc);
alter table public.app_errores disable row level security;

comment on table public.app_errores is 'Errores de la app capturados automáticamente (navegador y servidor). Ver scripts/verificar_errores_app.mts.';

-- Comprobación
select count(*) as errores_registrados from public.app_errores;
