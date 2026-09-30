-- =====================================================================
-- 208_auditoria_resumen.sql — Bitácora de Auditoría: resumen "quién hizo qué"
-- y nombres legibles para las tablas de nómina/compensación.
-- Aditivo e idempotente. Correr en el SQL Editor de Supabase.
-- (v2, 2026-09-30: la primera versión en SQL plano con "p is null or col = p"
--  no usaba el índice de fecha y agotaba el statement_timeout con la bitácora
--  completa; esta versión arma el WHERE solo con los filtros recibidos.)
--
-- 1) Función `auditoria_resumen(...)`: agrupa la bitácora por usuario, módulo,
--    tabla y acción con los mismos filtros de la pantalla (fecha, ID, usuario,
--    módulo, acción, búsqueda). Evita traer miles de filas al navegador y el
--    tope de 1.000 filas de PostgREST. Si la función no existe, la app cae a
--    un conteo paginado en servidor (más lento), así que correr esto es
--    recomendable pero no bloqueante.
-- 2) Catálogo `auditoria_modulos`: nombres bonitos para tablas que hoy salen
--    con el nombre técnico (Ajustes Proyeccion, Asistencia, Bonos Nomina…).
-- =====================================================================

create or replace function public.auditoria_resumen(
  p_desde        timestamptz default null,
  p_hasta        timestamptz default null,
  p_idempresa    integer     default null,
  p_actor_id     uuid        default null,
  p_solo_sistema boolean     default false,
  p_modulo       text        default null,
  p_operacion    text        default null,
  p_busqueda     text        default null
)
returns table (
  actor_id     uuid,
  actor_nombre text,
  idempresa    integer,
  modulo       text,
  tabla        text,
  operacion    text,
  n            bigint,
  primero      timestamptz,
  ultimo       timestamptz
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_where text := 'true';
begin
  -- Solo se agregan los predicados recibidos: así el planificador usa los
  -- índices (idx_auditoria_ts, idx_auditoria_idempresa, idx_auditoria_actor…).
  if p_desde is not null then
    v_where := v_where || ' and a.ts >= $1';
  end if;
  if p_hasta is not null then
    v_where := v_where || ' and a.ts <= $2';
  end if;
  if p_idempresa is not null then
    v_where := v_where || ' and a.idempresa = $3';
  end if;
  if p_actor_id is not null then
    v_where := v_where || ' and a.actor_id = $4';
  end if;
  if coalesce(p_solo_sistema, false) then
    v_where := v_where || ' and a.actor_id is null';
  end if;
  if p_modulo is not null then
    v_where := v_where || ' and a.modulo = $5';
  end if;
  if p_operacion is not null then
    v_where := v_where || ' and a.operacion = $6';
  end if;
  if nullif(btrim(p_busqueda), '') is not null then
    v_where := v_where || ' and (a.descripcion ilike $7 or a.registro_id ilike $7'
                       || ' or a.actor_nombre ilike $7 or a.tabla ilike $7)';
  end if;

  return query execute
       'select a.actor_id, a.actor_nombre, a.idempresa,'
    || '       coalesce(a.modulo, a.tabla), a.tabla, a.operacion,'
    || '       count(*)::bigint, min(a.ts), max(a.ts)'
    || '  from public.auditoria a'
    || ' where ' || v_where
    || ' group by 1, 2, 3, 4, 5, 6'
    || ' order by 2, 4, 6'
  using p_desde, p_hasta, p_idempresa, p_actor_id, p_modulo, p_operacion,
        '%' || coalesce(btrim(p_busqueda), '') || '%';
end;
$$;

comment on function public.auditoria_resumen is
  'Bitácora de Auditoría: conteo por usuario/módulo/tabla/acción con los filtros de la pantalla (WHERE dinámico para usar índices).';

-- Nombres legibles (Grupo · Submódulo) para tablas que hoy salen "prettify".
insert into public.auditoria_modulos (tabla, modulo) values
  ('ajustes_proyeccion',      'Compensación · Ajuste nómina anterior'),
  ('bonos_nomina',            'Compensación · Bonos'),
  ('asistencia',              'Personal · Marcación (foto)'),
  ('ordenes_correcciones',    'Operación · Corrección de órdenes'),
  ('inv_ajustes_pendientes',  'Inventario · Ajustes pendientes'),
  ('inv_correcciones_log',    'Inventario · Correcciones por código'),
  ('whatsapp_mensajes',       'Notificaciones · WhatsApp'),
  ('autorizacion_usuario_perfiles', 'Seguridad · Autorizaciones por clave'),
  ('autorizacion_usuario_procesos', 'Seguridad · Autorizaciones por clave'),
  ('autorizacion_perfil_procesos',  'Seguridad · Autorizaciones por clave'),
  ('autorizacion_correos',    'Seguridad · Autorizaciones por clave'),
  ('registrosanitario',       'Calidad · Registro sanitario'),
  ('historialaprobaciones',   'Pedidos · Aprobaciones'),
  ('inspecciones_montacargas','SST · Inspección montacargas')
on conflict (tabla) do update set modulo = excluded.modulo;

-- Verificación (debe responder en menos de un segundo):
--   select * from public.auditoria_resumen(now() - interval '1 day', now(), 2) limit 20;
