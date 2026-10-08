-- 260 · FASE 0 del plan de políticas por acción (2026-10-07) — SEGURIDAD EN LA BASE.
--
-- QUÉ HACE
--
--   A. Las tablas que GOBIERNAN los permisos dejan de ser legibles o escribibles para el rol
--      `authenticated` (= un navegador con sesión). Quedan solo para el rol de servicio, que
--      es el que usan las server actions. Hasta hoy el SQL 220 les había dejado la política de
--      paso `lipgo_autenticados` (using true / with check true): cualquiera con sesión podía,
--      desde la consola del navegador, cambiar su propia fila de `permisos_usuarios` o
--      asignarse un perfil.
--
--      Tablas: permisos_usuarios, perfil_acceso_empresas, perfil_acceso_owners,
--      acceso_perfil_empresas, acceso_perfil_owners, acceso_perfil_permisos,
--      acceso_perfil_materializado, acceso_perfiles, acceso_perfil_usuarios (si existen),
--      autorizacion_* (procesos, perfiles, perfil_procesos, usuario_perfiles,
--      usuario_procesos, claves, log, config), permisos_mapa_procesos.
--
--   B. Los MAESTROS de Configuración (clientes, productos, bodegas, almacenes, categorias,
--      subcategorias, condicionespago, destinos, grupos, medio, tipodespacho, vendedores,
--      transportes, tiposvehiculos, locations, proveedores, materiales, tarifas*) pasan a
--      SOLO LECTURA para `authenticated`. Nueve componentes del navegador los leen directo
--      (control-piso, generate-unload-orders, generate-distribution-orders, correccion-ordenes,
--      tolva, proyecciones, owner-utils, ordenes-por-unidad, config-definitions) y NINGUNO
--      escribe: las escrituras pasan por lib/config-actions.ts, que ya exige el módulo.
--
-- REQUISITO: desplegar ANTES el commit que pasa lib/user-access-actions.ts a "use server".
-- Era el único lector de perfil_acceso_* desde el navegador; con este SQL y el código viejo,
-- la pestaña Usuarios de Autorizaciones dejaría de mostrar empresas y owners.
--
-- CÓMO SE CLASIFICÓ (lección del SQL 221): búsqueda estática de `.from("<tabla>")` en
-- components/, hooks/ y app/ (sin app/api), y en los archivos de lib/ que NO tienen "use
-- server" ni "server-only" (son los que viajan al navegador); `postgres_changes` en
-- components/hooks; y los logs de la API de Supabase filtrados por role=authenticated.
--
-- REVERSA: scripts/261_fase0_revertir_260.sql (devuelve la política de paso a estas tablas).
--
-- IDEMPOTENTE: se puede correr dos veces.

begin;

-- ── A. Tablas de permisos: sin política para authenticated (solo rol de servicio) ──
do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and (
        tablename in ('permisos_usuarios', 'perfil_acceso_empresas', 'perfil_acceso_owners', 'permisos_mapa_procesos')
        or tablename like 'acceso_perfil%'
        or tablename like 'autorizacion\_%'
      )
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lipgo_autenticados on public.%I', t);
    execute format('drop policy if exists lipgo_autenticados_lectura on public.%I', t);
    n := n + 1;
    raise notice 'cerrada a authenticated: %', t;
  end loop;
  raise notice 'tablas de permisos cerradas: %', n;
end $$;

-- ── B. Maestros de Configuración: solo lectura para authenticated ──
do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename in (
        'clientes', 'productos', 'bodegas', 'almacenes', 'categorias', 'subcategorias',
        'condicionespago', 'destinos', 'grupos', 'medio', 'tipodespacho', 'vendedores',
        'transportes', 'tiposvehiculos', 'locations', 'proveedores', 'materiales',
        'tarifas', 'tarifasoperacion', 'tarifaspersonal', 'tarifasturnos', 'tarifasfacturacionturnos'
      )
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lipgo_autenticados on public.%I', t);
    execute format('drop policy if exists lipgo_autenticados_lectura on public.%I', t);
    execute format('create policy lipgo_autenticados_lectura on public.%I for select to authenticated using (true)', t);
    n := n + 1;
  end loop;
  raise notice 'maestros en solo lectura para authenticated: %', n;
end $$;

commit;

-- ── Verificación (solo lecturas) ──
-- 1) Tablas de permisos: deben tener RLS y CERO políticas.
select t.tablename, t.rowsecurity,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename) as politicas
from pg_tables t
where t.schemaname = 'public'
  and (t.tablename in ('permisos_usuarios', 'perfil_acceso_empresas', 'perfil_acceso_owners', 'permisos_mapa_procesos')
       or t.tablename like 'acceso_perfil%' or t.tablename like 'autorizacion\_%')
order by 1;

-- 2) Maestros: deben tener exactamente la política de lectura.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('clientes', 'productos', 'bodegas', 'almacenes', 'categorias', 'subcategorias', 'condicionespago',
                    'destinos', 'grupos', 'medio', 'tipodespacho', 'vendedores', 'transportes', 'tiposvehiculos',
                    'locations', 'proveedores', 'materiales', 'tarifas', 'tarifasoperacion', 'tarifaspersonal',
                    'tarifasturnos', 'tarifasfacturacionturnos')
order by 1, 2;
