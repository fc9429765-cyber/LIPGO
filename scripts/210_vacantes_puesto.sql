-- =====================================================================
-- 210_vacantes_puesto.sql — Solicitud de personal amarrada a los catálogos.
-- Aditivo e idempotente. Correr en el SQL Editor de Supabase.
--
-- La requisición ahora elige el CARGO de Head Count (lista fija) y el PUESTO
-- operativo del maestro de turnos (`tarifasturnos.puesto`, el mismo que usa
-- Programación de Turnos), y el TURNO de `turnos_definicion`. Antes eran
-- texto libre. `cargo` y `turno` ya existían como texto; falta `puesto`.
-- La app funciona sin esta columna (guarda el puesto dentro de "requisitos"
-- si aún no existe), pero con ella el dato queda estructurado.
-- =====================================================================

alter table public.vacantes
  add column if not exists puesto text;

comment on column public.vacantes.puesto is
  'Puesto operativo del maestro de turnos (tarifasturnos.puesto) para el que se pide el personal. Distinto del cargo de Head Count.';
