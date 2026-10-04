-- =====================================================================
-- 212_programacion_cliente_lip.sql — Permiso del COORDINADOR LIP para
-- consignar la programación del cliente. Aditivo e idempotente. Correr en
-- el SQL Editor de Supabase (después del 211).
--
-- Gerencia (2026-10-01): "esto lo envía el cliente, pero el que lo debe
-- consignar en la app es el coordinador LIP, con opción de que el cliente
-- lo haga si quiere; cualquiera de los dos". Igual que Servicios Adicionales
-- (cliente, `solicitudturnos`) frente a Aprobar Turnos (LIP,
-- `aprobacionturnos`), cada lado tiene su permiso:
--   - programacion_cliente     → Pedidos y solicitudes › "Programación de
--                                 mañana" (el cliente, opcional). SQL 211.
--   - programacion_cliente_lip → Operación LIP › Operación del día ›
--                                 "Programación de mañana" (el coordinador).
-- Torre de Control › "Programación del cliente · cumplimiento" sigue con
-- `proyecciones` (gerencia). Aquí NO se activa el permiso a nadie: se asigna
-- desde Gestión de Usuarios.
-- =====================================================================

alter table public.permisos_usuarios
  add column if not exists programacion_cliente_lip boolean not null default false;

comment on column public.permisos_usuarios.programacion_cliente_lip is
  'Módulo "Consignar programación del cliente" (Operación LIP › Operación del día): el coordinador registra la programación de mañana que envía el cliente y ve su cumplimiento.';
