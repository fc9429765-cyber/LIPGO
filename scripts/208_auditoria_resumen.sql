-- =====================================================================
-- 208_auditoria_resumen.sql — Bitácora de Auditoría: resumen "quién hizo qué"
-- y nombres legibles para las tablas de nómina/compensación.
-- Aditivo e idempotente. Correr en el SQL Editor de Supabase.
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
language sql
stable
set search_path = public
as $$
  select a.actor_id,
         a.actor_nombre,
         a.idempresa,
         coalesce(a.modulo, a.tabla) as modulo,
         a.tabla,
         a.operacion,
         count(*)::bigint            as n,
         min(a.ts)                   as primero,
         max(a.ts)                   as ultimo
    from public.auditoria a
   where (p_desde is null or a.ts >= p_desde)
     and (p_hasta is null or a.ts <= p_hasta)
     and (p_idempresa is null or a.idempresa = p_idempresa)
     and (p_actor_id is null or a.actor_id = p_actor_id)
     and (not p_solo_sistema or a.actor_id is null)
     and (p_modulo is null or a.modulo = p_modulo)
     and (p_operacion is null or a.operacion = p_operacion)
     and (p_busqueda is null
          or a.descripcion  ilike '%' || p_busqueda || '%'
          or a.registro_id  ilike '%' || p_busqueda || '%'
          or a.actor_nombre ilike '%' || p_busqueda || '%'
          or a.tabla        ilike '%' || p_busqueda || '%')
   group by 1, 2, 3, 4, 5, 6
   order by 2, 4, 6;
$$;

comment on function public.auditoria_resumen is
  'Bitácora de Auditoría: conteo por usuario/módulo/tabla/acción con los filtros de la pantalla.';

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

-- Verificación:
--   select * from public.auditoria_resumen(now() - interval '1 day', now(), 2) limit 20;
