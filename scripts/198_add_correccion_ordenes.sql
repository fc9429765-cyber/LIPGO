-- =====================================================================
-- 198 — Submódulo "Corrección de Órdenes" (Gestión Financiera).
--
-- (a) Permiso del módulo. Sin esta columna /api/user-modules trata el
--     módulo como NO permitido y el sidebar lo oculta (mismo patrón que
--     scripts/109_add_cargos_fijos_permission.sql).
-- (b) Bitácora del "por qué" de cada corrección. El trigger genérico
--     fn_auditoria() YA registra el "qué cambió" campo por campo en
--     public.auditoria para cabeceraoc/detalleoc; esta tabla SOLO guarda
--     el motivo en texto libre de cada sesión de corrección (no hay
--     catálogo de códigos, a diferencia de inv_correcciones_log).
--
-- Aditivo e idempotente.
-- =====================================================================

alter table public.permisos_usuarios
  add column if not exists correccion_ordenes boolean not null default false;

create table if not exists public.ordenes_correcciones (
  id serial primary key,
  idempresa int,
  idorden int not null,          -- cabeceraoc.id en el momento de la corrección
  ordendecargue text not null,
  motivo text not null,
  realizado_por text not null,   -- usuario de la sesión (profiles.usuario)
  created_at timestamptz default now()
);

create index if not exists idx_ordenes_correcciones_orden   on public.ordenes_correcciones (ordendecargue);
create index if not exists idx_ordenes_correcciones_idorden on public.ordenes_correcciones (idorden);

alter table public.ordenes_correcciones disable row level security;

-- Verificación:
-- select count(*) filter (where correccion_ordenes) as con_permiso, count(*) as total from public.permisos_usuarios;
-- select * from public.ordenes_correcciones order by created_at desc limit 20;
