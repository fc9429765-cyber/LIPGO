-- =====================================================================
-- 204 — CORREO DE RECUPERACIÓN por usuario (Autorizaciones por clave).
--
-- Hallazgo 2026-09-27: los usuarios de LIPgo entran con direcciones @lipgo.app
-- que NO son buzones (el dominio lipgo.app no tiene servicio de correo). Un
-- código de recuperación enviado a esa dirección se pierde. Cada usuario debe
-- registrar un correo REAL de recuperación, verificado con un código; la
-- gerencia también puede asignarlo desde Autorizaciones por clave.
--
-- Aditivo e idempotente.
-- =====================================================================

create table if not exists public.autorizacion_correos (
  usuario_id uuid primary key references public.profiles(id) on delete cascade,
  correo text not null,
  verificado boolean not null default false,      -- true si el usuario confirmó el código enviado a ese correo
  origen text not null default 'usuario',         -- usuario | admin
  actualizado_en timestamptz not null default now(),
  actualizado_por text
);
alter table public.autorizacion_correos disable row level security;

-- Verificación:
-- select pr.usuario, c.correo, c.verificado, c.origen from public.autorizacion_correos c join public.profiles pr on pr.id = c.usuario_id order by pr.usuario;
