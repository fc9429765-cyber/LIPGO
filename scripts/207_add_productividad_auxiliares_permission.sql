-- =====================================================================
-- 207 — Permiso del módulo "Productividad de Auxiliares" (Operación LIP).
--
-- Informe de gerencia: quién carga de verdad en cada ID (cabeceraoc.auxiliares_real,
-- el personal que el coordinador asignó al vehículo en el Centro de Coordinación),
-- por día y por mes, con ranking, toneladas reales vs. pagadas (pago Global) y
-- exportación a Excel. Solo lectura: no toca cabeceraoc ni nómina.
--
-- Se otorga al mismo conjunto que administra Gestión de Usuarios (LIPgo); a
-- coordinadores u otros se les da desde Gestión de Usuarios como cualquier módulo.
-- =====================================================================
alter table public.permisos_usuarios
  add column if not exists productividad_auxiliares boolean not null default false;
update public.permisos_usuarios set productividad_auxiliares = true where gestion_usuarios = true;

-- Verificación:
-- select count(*) filter (where productividad_auxiliares) as con_permiso, count(*) as total from public.permisos_usuarios;
