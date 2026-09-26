-- =====================================================================
-- 199 — Rendimiento: índices en tablas transaccionales + caché persistente
--       de indicadores del BSC (franja de KPIs del encabezado).
--
-- (a) Índices. cabeceraoc (9k filas) y detalleoc (23k) NO tenían ningún índice
--     de negocio (solo cabeceraoc.tipo_factura). Hoy son tablas pequeñas, pero
--     crecen sin freno y todas las pantallas de facturación/nómina/dashboards
--     las recorren por empresa+fecha, por número de orden o por idorden.
-- (b) sig_indicadores_cache. getIndicadoresValores (lib/sig-actions.ts) es el
--     motor del BSC: ~49 consultas y ~13 s en frío. Ya tenía caché en memoria
--     (10 min), pero en Vercel cada instancia arranca fría, así que el usuario
--     pagaba esos 13 s con frecuencia al entrar a cualquier submódulo. Esta
--     tabla persiste el resultado por (alcance, rango) para que cualquier
--     instancia lo sirva al instante; se refresca en segundo plano al vencer.
--
-- Aditivo e idempotente.
-- =====================================================================

create index if not exists idx_cabeceraoc_empresa_fechacargue on public.cabeceraoc (idempresa, fechacargue);
create index if not exists idx_cabeceraoc_empresa_fechaorden  on public.cabeceraoc (idempresa, fechaorden);
create index if not exists idx_cabeceraoc_ordendecargue       on public.cabeceraoc (ordendecargue);
create index if not exists idx_cabeceraoc_placa               on public.cabeceraoc (placa);
create index if not exists idx_detalleoc_idorden              on public.detalleoc (idorden);
create index if not exists idx_detalleoc_numeroorden          on public.detalleoc (numeroorden);
create index if not exists idx_detalleoc_producto             on public.detalleoc (producto);
create index if not exists idx_headcount_nombre               on public.headcount (nombre);

create table if not exists public.sig_indicadores_cache (
  clave text primary key,              -- `${proyectoId|all}|${desde}|${hasta}`
  valores jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.sig_indicadores_cache disable row level security;

-- Es una caché técnica que se reescribe cada 10 minutos con un JSON grande:
-- no tiene sentido que el trigger genérico de auditoría (que el event trigger
-- adjunta automáticamente a toda tabla nueva) llene public.auditoria con eso.
drop trigger if exists trg_auditoria on public.sig_indicadores_cache;

-- Verificación:
-- select indexname from pg_indexes where tablename in ('cabeceraoc','detalleoc','headcount') order by 1;
-- select clave, computed_at from public.sig_indicadores_cache order by computed_at desc;
