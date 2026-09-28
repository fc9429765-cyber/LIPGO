-- ============================================================================
-- 205 — PERMISO DEL MÓDULO "CONSULTA FACTURAS SIIGO"
-- ----------------------------------------------------------------------------
-- Consulta de solo lectura contra la API de Siigo: facturas de venta, su
-- detalle y el PDF.
--
-- POR QUÉ UN PERMISO PROPIO Y NO REUSAR `gestionfacturas`
-- Aquel da acceso a la facturación que LIPgo genera. Este deja ver la
-- facturación REAL de la empresa en Siigo: todas las ventas, a todos los
-- clientes, con sus valores y saldos. Es información contable completa, y
-- quien deba conciliar una prefactura no necesariamente debe poder ver eso.
--
-- SIN BACKFILL, a propósito. Se otorga a mano desde Gestión de Usuarios a
-- quien deba tenerlo. Heredarlo de otro permiso abriría la contabilidad a
-- gente que hoy solo ve lo suyo, sin que nadie lo decidiera.
--
-- Aditivo e idempotente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — LA COLUMNA
-- ----------------------------------------------------------------------------

alter table public.permisos_usuarios
  add column if not exists siigo_facturas boolean not null default false;

comment on column public.permisos_usuarios.siigo_facturas is
  'Consulta de facturas en Siigo (solo lectura). Da acceso a TODA la facturacion de la empresa: se otorga a mano.';


-- ----------------------------------------------------------------------------
-- PASO 2 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 2a) La columna quedó creada.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'permisos_usuarios'
  and column_name  = 'siigo_facturas';

-- 2b) Nadie lo tiene todavía. Es lo esperado: se otorga desde la pantalla.
select count(*) filter (where siigo_facturas) as con_permiso,
       count(*)                               as usuarios
from public.permisos_usuarios;

-- 2c) Qué columnas tiene `profiles`, para no adivinar en la siguiente consulta.
--     (La columna del nombre es `usuario`, no `nombre`.)
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- 2d) Quién tiene hoy acceso a la facturación de LIPgo, como referencia de a
--     quién podría tener sentido otorgarle el permiso nuevo.
select p.usuario_id, pr.usuario
from public.permisos_usuarios p
join public.profiles pr on pr.id = p.usuario_id
where p.gestionfacturas = true
order by pr.usuario;


-- ----------------------------------------------------------------------------
-- REVERSIÓN
-- ----------------------------------------------------------------------------
--   alter table public.permisos_usuarios drop column if exists siigo_facturas;
