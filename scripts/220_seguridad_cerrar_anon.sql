
-- 220 · SEGURIDAD: cerrar la base al rol anónimo (paso 6 del programa de nivel mundial).
--
-- Hallazgo 2026-10-03: con la clave pública de Supabase (NEXT_PUBLIC_SUPABASE_ANON_KEY, que
-- viaja en el navegador) y SIN iniciar sesión, cualquiera podía LEER y ESCRIBIR todas las
-- tablas de `public` (headcount, cabeceraoc, pedidoscabecera, invtrans, autorizacion_claves,
-- empresas...). Causa: RLS deshabilitado y los privilegios por defecto de Supabase para `anon`.
--
-- Requisito ANTES de correrlo: producción con el commit que hace que el servidor use la
-- service role (lib/supabase-client.ts, 2026-10-03). Hasta ese commit, 57 archivos del servidor
-- consultaban como `anon` y este script los dejaría sin datos.
--
-- Qué hace (reversible, no toca datos):
--  A. Quita al rol `anon` TODOS los privilegios sobre tablas, vistas, secuencias y funciones de
--     `public`, hoy y para lo que se cree en adelante. El servidor usa service role (no se ve
--     afectado); el navegador consulta con sesión (rol `authenticated`, no se ve afectado).
--  B. Activa RLS en todas las tablas de `public` que aún no lo tengan, con UNA política de paso
--     para `authenticated` (igual al comportamiento actual: los permisos viven en la app). Las
--     tablas que ya tenían políticas propias no se tocan. Esto deja el terreno listo para el
--     paso siguiente: políticas por empresa en las tablas sensibles.
--
-- Reversa de emergencia (solo si algo quedó sin datos):
--   grant select, insert, update, delete on all tables in schema public to anon;
--   grant usage, select on all sequences in schema public to anon;

begin;

-- A. Sin acceso anónimo.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
do $$
begin
  -- Los privilegios por defecto de Supabase los define también supabase_admin/postgres.
  begin
    execute 'alter default privileges for role postgres in schema public revoke all on tables from anon';
    execute 'alter default privileges for role postgres in schema public revoke all on sequences from anon';
    execute 'alter default privileges for role postgres in schema public revoke all on functions from anon';
  exception when others then
    raise notice 'default privileges (postgres): %', sqlerrm;
  end;
end $$;

-- B. RLS encendido con política de paso para usuarios autenticados.
do $$
declare
  r record;
  n_pol int;
begin
  -- Solo las tablas que HOY no tienen RLS. Las que ya lo tienen (con o sin políticas) se
  -- respetan tal cual: alguien las configuró a propósito.
  for r in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    select count(*) into n_pol from pg_policies where schemaname = 'public' and tablename = r.tablename;
    execute format('alter table public.%I enable row level security', r.tablename);
    if n_pol = 0 then
      execute format('drop policy if exists lipgo_autenticados on public.%I', r.tablename);
      execute format('create policy lipgo_autenticados on public.%I for all to authenticated using (true) with check (true)', r.tablename);
    end if;
  end loop;
end $$;

commit;

-- Comprobación (visible en el editor SQL)
select
  (select count(*) from pg_tables where schemaname = 'public' and rowsecurity) as tablas_con_rls,
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as tablas_sin_rls,
  (select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public') as privilegios_anon_restantes,
  (select count(*) from pg_policies where schemaname = 'public' and policyname = 'lipgo_autenticados') as politicas_de_paso;
