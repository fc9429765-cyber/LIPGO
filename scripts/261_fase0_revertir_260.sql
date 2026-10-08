-- 261 · EMERGENCIA — revertir el SQL 260 (Fase 0 del plan de políticas por acción).
--
-- ESTE SCRIPT ES UN SEGURO, NO HAY QUE CORRERLO SI TODO FUNCIONA.
--
-- Córrelo SOLO si, después del 260, una pantalla deja de mostrar datos o de guardar y no
-- hay tiempo de analizar. Devuelve la política de paso `lipgo_autenticados` (la del SQL 220)
-- a las tablas de permisos y a los maestros de Configuración, es decir, deja la base como
-- estaba antes del 260.
--
-- Qué NO deshace (a propósito): el SQL 220 sigue en pie, o sea que quien NO ha iniciado
-- sesión sigue sin poder leer ni escribir nada.
--
-- Después de correrlo, avísame: hay que encontrar al lector del navegador que no se
-- clasificó, moverlo a una server action y volver a cerrar.

begin;

do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and (
        tablename in ('permisos_usuarios', 'perfil_acceso_empresas', 'perfil_acceso_owners', 'permisos_mapa_procesos',
                      'clientes', 'productos', 'bodegas', 'almacenes', 'categorias', 'subcategorias',
                      'condicionespago', 'destinos', 'grupos', 'medio', 'tipodespacho', 'vendedores',
                      'transportes', 'tiposvehiculos', 'locations', 'proveedores', 'materiales',
                      'tarifas', 'tarifasoperacion', 'tarifaspersonal', 'tarifasturnos', 'tarifasfacturacionturnos')
        or tablename like 'acceso_perfil%'
        or tablename like 'autorizacion\_%'
      )
  loop
    execute format('drop policy if exists lipgo_autenticados_lectura on public.%I', t);
    execute format('drop policy if exists lipgo_autenticados on public.%I', t);
    execute format('create policy lipgo_autenticados on public.%I for all to authenticated using (true) with check (true)', t);
    n := n + 1;
    raise notice 'acceso devuelto a: %', t;
  end loop;
  raise notice 'tablas con acceso devuelto: %', n;
end $$;

commit;

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and policyname = 'lipgo_autenticados'
  and (tablename like 'acceso_perfil%' or tablename like 'autorizacion\_%' or tablename in ('permisos_usuarios', 'clientes', 'productos'))
order by 1;
