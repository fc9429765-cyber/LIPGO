
-- 225 · Arreglo DEFINITIVO del desfase de secuencias de id.
--
-- EL PROBLEMA (visto en vivo el 2026-10-04 al corregir la orden IND202608047608):
-- insertar en `invtrans` sin dar el id falla con
--   duplicate key value violates unique constraint "invtrans_pkey"
-- porque la secuencia va por detrás del mayor id que existe en la tabla.
--
-- POR QUÉ SE DESFASA: buena parte del código calcula el id a mano (`max(id) + 1`) y lo manda
-- explícito en el insert. Postgres solo adelanta la secuencia cuando ES ELLA la que entrega el
-- id; si se lo damos nosotros, la secuencia se queda atrás. Mezclar los dos estilos (y el
-- proyecto los mezcla) garantiza el choque tarde o temprano. Tablas donde hoy se asigna el id
-- a mano: invtrans, cabeceraoc, detalleoc, productos, registrosanitario.
-- El script 039 ya había resincronizado `invtrans` una vez; volvió a desfasarse, porque
-- resincronizar ataca el síntoma, no la causa.
--
-- QUÉ HACE ESTE SCRIPT (las dos cosas):
--   A. Pone AL DÍA todas las secuencias de `public` que estén por detrás de su tabla.
--   B. Instala un disparador que, cada vez que alguien inserte con id explícito, ADELANTA la
--      secuencia si hace falta. Así nunca se vuelve a desfasar, sin tener que cambiar las
--      decenas de sitios del código que asignan el id a mano. El disparador solo adelanta,
--      nunca retrocede, y no modifica ningún dato.
--
-- No toca datos. Idempotente: se puede volver a correr sin riesgo.

-- =============================================================== A. Poner al día
do $$
declare
  r record;
  seq text;
  maxid bigint;
  ultimo bigint;
  arregladas int := 0;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name = 'id'
      and pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name) is not null
  loop
    seq := pg_get_serial_sequence('public.' || quote_ident(r.table_name), r.column_name);
    execute format('select coalesce(max(%I), 0) from public.%I', r.column_name, r.table_name) into maxid;
    execute format('select last_value from %s', seq) into ultimo;
    if maxid > ultimo then
      perform setval(seq, maxid, true);
      arregladas := arregladas + 1;
      raise notice 'secuencia al día: %  (iba en % y la tabla ya tenía %)', r.table_name, ultimo, maxid;
    end if;
  end loop;
  raise notice 'Secuencias corregidas: %', arregladas;
end $$;

-- =============================================================== B. Que no se vuelva a desfasar
create or replace function public.mantener_secuencia_al_dia()
returns trigger
language plpgsql
as $$
declare
  seq text;
  ultimo bigint;
begin
  if NEW.id is null then
    return null; -- lo entregó la secuencia: no hay nada que hacer
  end if;
  seq := pg_get_serial_sequence(TG_TABLE_SCHEMA || '.' || quote_ident(TG_TABLE_NAME), 'id');
  if seq is null then
    return null;
  end if;
  execute format('select last_value from %s', seq) into ultimo;
  if NEW.id > ultimo then
    perform setval(seq, NEW.id, true); -- solo adelanta
  end if;
  return null;
end $$;

comment on function public.mantener_secuencia_al_dia() is
  'Adelanta la secuencia de id cuando una fila se inserta con id explícito, para que un insert posterior sin id no choque con la llave primaria. Solo adelanta, nunca retrocede. Ver scripts/225.';

-- Se instala en las tablas donde el código asigna el id a mano.
do $$
declare
  t text;
begin
  foreach t in array array['invtrans', 'cabeceraoc', 'detalleoc', 'productos', 'registrosanitario']
  loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('drop trigger if exists trg_secuencia_al_dia on public.%I', t);
      execute format('create trigger trg_secuencia_al_dia after insert on public.%I for each row execute function public.mantener_secuencia_al_dia()', t);
      raise notice 'disparador instalado en %', t;
    end if;
  end loop;
end $$;

-- =============================================================== Comprobación
select
  c.table_name as tabla,
  (select last_value from pg_sequences s
    where s.schemaname = 'public'
      and 'public.' || s.sequencename = pg_get_serial_sequence('public.' || quote_ident(c.table_name), 'id')) as secuencia_va_en,
  (select count(*) from pg_trigger g
    where g.tgrelid = ('public.' || quote_ident(c.table_name))::regclass and g.tgname = 'trg_secuencia_al_dia') as tiene_disparador
from information_schema.columns c
where c.table_schema = 'public'
  and c.column_name = 'id'
  and c.table_name in ('invtrans', 'cabeceraoc', 'detalleoc', 'productos', 'registrosanitario')
order by c.table_name;
