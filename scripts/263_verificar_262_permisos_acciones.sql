-- 263 · VERIFICAR el 262 (políticas por acción). Solo lecturas: se puede correr las veces que haga falta.
--
-- Qué comprueba:
--   1. Cuántas columnas de acción ("<llave>__<verbo>") hay en permisos_usuarios.
--   2. INVARIANTE DEL DÍA UNO: ninguna acción en true sin su módulo en true. Si el 262 sembró
--      bien, no debe salir ninguna fila. (Después de que un administrador empiece a editar,
--      la pantalla impide marcar una acción sin su módulo, así que debería seguir en cero.)
--   3. Los procesos nuevos por grupo.
--   4. El modo vigente de las puertas ('aviso' recién corrido el 262; 'bloquear' cuando se decida).
--   5. Avisos registrados por las puertas en modo aviso, por acción y usuario (debe ir a cero).

-- 1) Columnas de acción
select count(*) as columnas_de_accion
from information_schema.columns
where table_schema = 'public' and table_name = 'permisos_usuarios' and column_name like '%\_\_%';

-- 2) Invariante: acción = true y módulo = false → fila por par (usuario, acción)
do $$
declare
  r record;
  q text;
  n int;
  total int := 0;
begin
  for r in
    select column_name as accion, split_part(column_name, '__', 1) as llave
    from information_schema.columns
    where table_schema = 'public' and table_name = 'permisos_usuarios' and column_name like '%\_\_%'
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'permisos_usuarios' and column_name = r.llave
    ) then
      raise warning 'la acción % no tiene columna de módulo %', r.accion, r.llave;
      continue;
    end if;
    q := format('select count(*) from public.permisos_usuarios where %I is true and %I is not true', r.accion, r.llave);
    execute q into n;
    if n > 0 then
      total := total + n;
      raise warning 'INVARIANTE ROTA: % usuario(s) con % en true sin %', n, r.accion, r.llave;
    end if;
  end loop;
  if total = 0 then
    raise notice 'Invariante OK: ninguna acción encendida sin su módulo.';
  else
    raise warning 'Invariante rota en % par(es) usuario-acción.', total;
  end if;
end $$;

-- 3) Procesos nuevos por grupo
select grupo, codigo, nombre, con_alcance
from public.autorizacion_procesos
where grupo in ('Órdenes', 'Inventario', 'Facturación', 'Nómina', 'Seguridad')
order by grupo, orden;

-- 4) Modo vigente
select clave, valor, actualizado_en from public.autorizacion_config where clave = 'politicas_acciones_modo';

-- 5) Avisos de las puertas (modo aviso): si sale algo, una pantalla ofrece una acción que el
--    catálogo no otorga a ese usuario → corregir el catálogo o el perfil antes de pasar a 'bloquear'.
select proceso as accion, usuario, count(*) as veces, max(created_at) as ultimo
from public.autorizacion_log
where resultado = 'aviso_accion'
group by 1, 2
order by 3 desc, 1;
