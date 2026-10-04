
-- 223 · EMERGENCIA — revertir por completo el SQL 221.
--
-- ESTE SCRIPT ES UN SEGURO, NO HAY QUE CORRERLO SI TODO FUNCIONA.
--
-- Córrelo SOLO si mañana (o cualquier día) una pantalla empieza a decir que un dato "no
-- existe", sale vacía sin motivo, o un módulo deja de guardar, y no hay tiempo de analizar.
-- Devuelve el acceso de los usuarios CON SESIÓN a todas las tablas que el 221 cerró, es decir,
-- deja la base como estaba el 3 de octubre después del SQL 220.
--
-- Qué NO deshace (a propósito): el SQL 220 sigue en pie, o sea que quien NO ha iniciado sesión
-- sigue sin poder leer ni escribir nada. Esa protección, que es la importante, no se toca.
--
-- Después de correrlo, avísame para volver a cerrar lo financiero con la lista exacta y
-- verificada, en vez de a ciegas.

begin;

do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and rowsecurity
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = pg_tables.tablename)
  loop
    execute format('create policy lipgo_autenticados on public.%I for all to authenticated using (true) with check (true)', t);
    n := n + 1;
    raise notice 'acceso devuelto a: %', t;
  end loop;
  raise notice 'tablas con acceso devuelto: %', n;
end $$;

-- Vistas y funciones de nómina/facturación que el 221 también cerró.
do $$
declare
  v text;
  f record;
begin
  for v in
    select viewname from pg_views
    where schemaname = 'public'
      and (
        viewname in ('facturacionturnos','toneladasauxiliarespago','pagonomina','archivoplano')
        or viewname ~ '^(pago|nomina|factur|prefactur|archivoplano|liquidacion|parafiscal|prestacion|cuadro_control|cierre_financiero|analisis_financiero)'
      )
  loop
    execute format('grant select on public.%I to authenticated', v);
  end loop;
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('pagonomina_rango','archivoplano_periodo','auditoria_resumen')
  loop
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;

commit;

-- Comprobación
select
  (select count(*) from pg_tables t where t.schemaname = 'public' and t.rowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename)) as tablas_aun_cerradas_a_usuarios,
  (select count(*) from pg_policies where schemaname = 'public' and policyname = 'lipgo_autenticados') as tablas_con_acceso_de_usuario;
