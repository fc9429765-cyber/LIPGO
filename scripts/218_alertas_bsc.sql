
-- 218 · Alertas del BSC con suscripción (programa de nivel mundial, paso 4).
-- Cada indicador con meta avisa, a quien se suscriba, cuando se sale de rango (atención o
-- crítico según el semáforo del BSC), por correo, con el enlace a la pantalla donde se actúa.
-- Un cron diario (06:30 Bogotá, /api/cron/alertas-bsc) evalúa el mes en curso por proyecto.
-- La suscripción se hace desde el panel "Indicadores" de cualquier pantalla (campana).
-- Aditivo e idempotente.

create table if not exists public.alerta_suscripciones (
  id              bigserial primary key,
  usuario_id      uuid not null,
  usuario         text,
  correo          text not null,                   -- destino (las cuentas @lipgo.app no son buzones)
  indicador       text not null,                   -- clave calculo_auto del BSC (p. ej. ped_a_tiempo)
  empresa_id      integer,                         -- proyecto; null = agregado LIP (indicadores transversales)
  umbral          text not null default 'atencion',-- atencion (fuera de meta) | critico (muy por debajo)
  canal           text not null default 'correo',  -- correo (hoy) | whatsapp | app (futuro)
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
create unique index if not exists uq_alerta_suscripcion
  on public.alerta_suscripciones (usuario_id, indicador, coalesce(empresa_id, 0));
create index if not exists idx_alerta_suscripciones_activas on public.alerta_suscripciones (activo, empresa_id);
alter table public.alerta_suscripciones disable row level security;

create table if not exists public.alerta_envios (
  id              bigserial primary key,
  suscripcion_id  bigint references public.alerta_suscripciones(id) on delete cascade,
  usuario_id      uuid,
  correo          text,
  indicador       text not null,
  empresa_id      integer,
  severidad       text not null,                   -- warn | crit | prueba
  valor           numeric,
  meta            numeric,
  periodo         text,                            -- "2026-10-01..2026-10-03"
  canal           text not null default 'correo',
  estado          text not null,                   -- enviado | simulado | error
  detalle         text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_alerta_envios_susc on public.alerta_envios (suscripcion_id, created_at desc);
create index if not exists idx_alerta_envios_fecha on public.alerta_envios (created_at desc);
alter table public.alerta_envios disable row level security;

comment on table public.alerta_suscripciones is 'Quién quiere aviso de qué indicador del BSC, en qué proyecto y a qué correo.';
comment on table public.alerta_envios is 'Bitácora de avisos enviados (una fila por aviso); evita repetir el mismo aviso el mismo día.';

-- Comprobación
select
  (select count(*) from public.alerta_suscripciones) as suscripciones,
  (select count(*) from public.alerta_envios) as envios;
