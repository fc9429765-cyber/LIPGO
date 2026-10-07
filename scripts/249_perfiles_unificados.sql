-- ============================================================================
-- 249 — UN SOLO CATÁLOGO DE PERFILES
-- ----------------------------------------------------------------------------
-- Había DOS sistemas de perfiles que decían cosas distintas de la misma
-- persona:
--
--   · autorizacion_perfiles (script 203): el PUESTO y los procesos que puede
--     autorizar con su clave personal, asignado con alcance por proyecto.
--   · acceso_perfiles (script 247, ayer): las EMPRESAS, OWNERS y MÓDULOS que
--     ve y gestiona.
--
-- Un "Coordinador Indupan" tenía que existir dos veces y asignarse dos veces.
-- Desde aquí es UNO: `autorizacion_perfiles` absorbe el acceso. Sus tablas
-- hijas de acceso (empresas, owners, permisos) se re-apuntan a él, la
-- asignación es la de autorizaciones, y `acceso_perfiles` desaparece.
--
-- POR QUÉ SOBREVIVE EL DE AUTORIZACIONES Y NO EL NUEVO. El de autorizaciones
-- está en producción con perfiles reales y asignaciones con alcance, y el
-- flujo de claves (`autorizar()`, ocho archivos) lee sus tablas. El de acceso
-- nació ayer y está vacío o casi. Se mueve lo liviano hacia lo pesado.
--
-- EL ALCANCE PASA A SEGUIR LAS EMPRESAS DEL PERFIL. Antes "qué empresas ve" y
-- "dónde vale su clave" eran dos preguntas; ahora son una: si el perfil
-- define empresas, la asignación lleva una fila por cada una. Un perfil SIN
-- empresas (los de autorizaciones de siempre) se asigna como hasta hoy, con
-- el alcance que diga la administración. Así nada se amplía por accidente.
--
-- Idempotente. Si el 247 nunca se corrió, crea las tablas hijas directamente
-- sobre autorizacion_perfiles; si se corrió, migra y limpia.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — autorizacion_perfiles gana lo que le faltaba
-- ----------------------------------------------------------------------------

alter table public.autorizacion_perfiles add column if not exists creado_por text;
alter table public.autorizacion_perfiles add column if not exists updated_at timestamptz not null default now();

comment on table public.autorizacion_perfiles is
  'EL perfil de LIPgo (puesto): procesos que autoriza con clave (autorizacion_perfil_procesos) + empresas, owners y modulos que abre (acceso_perfil_*). Unificado el 2026-10-07 (script 249).';


-- ----------------------------------------------------------------------------
-- PASO 2 — Migrar lo que exista de acceso_perfiles y re-apuntar las hijas
-- ----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.acceso_perfiles') is null then
    raise notice '249: acceso_perfiles no existe (el 247 no se corrio, o esto ya se migro). Se omite la migracion.';
    return;
  end if;

  -- 2a) Los perfiles de acceso que no existan en autorizaciones, por nombre.
  insert into public.autorizacion_perfiles (nombre, descripcion, activo, creado_por)
  select a.nombre, a.descripcion, a.activo, a.creado_por
  from public.acceso_perfiles a
  where not exists (select 1 from public.autorizacion_perfiles p where p.nombre = a.nombre);

  -- 2b) El mapa de ids: viejo (acceso) -> nuevo (autorizaciones), por nombre.
  create temporary table _mapa_perfiles on commit drop as
  select a.id as viejo, p.id as nuevo
  from public.acceso_perfiles a
  join public.autorizacion_perfiles p on p.nombre = a.nombre;

  -- 2c) Soltar las FK hacia acceso_perfiles: sin esto no se puede re-apuntar.
  alter table public.acceso_perfil_empresas drop constraint if exists acceso_perfil_empresas_perfil_id_fkey;
  alter table public.acceso_perfil_owners   drop constraint if exists acceso_perfil_owners_perfil_id_fkey;
  alter table public.acceso_perfil_permisos drop constraint if exists acceso_perfil_permisos_perfil_id_fkey;

  -- 2d) Re-apuntar en DOS fases, pasando por negativos. Los dos catalogos
  --     numeran con serial propio, asi que un id viejo puede coincidir con
  --     otro id nuevo; actualizar de una vez pisaria filas a mitad de camino.
  update public.acceso_perfil_empresas e set perfil_id = -m.nuevo from _mapa_perfiles m where e.perfil_id = m.viejo;
  update public.acceso_perfil_owners   o set perfil_id = -m.nuevo from _mapa_perfiles m where o.perfil_id = m.viejo;
  update public.acceso_perfil_permisos p set perfil_id = -m.nuevo from _mapa_perfiles m where p.perfil_id = m.viejo;
  update public.acceso_perfil_empresas set perfil_id = -perfil_id where perfil_id < 0;
  update public.acceso_perfil_owners   set perfil_id = -perfil_id where perfil_id < 0;
  update public.acceso_perfil_permisos set perfil_id = -perfil_id where perfil_id < 0;

  -- 2e) Las asignaciones pasan a la tabla de autorizaciones: una fila por
  --     empresa del perfil; si el perfil no define empresas, "todos".
  if to_regclass('public.acceso_perfil_usuarios') is not null then
    insert into public.autorizacion_usuario_perfiles (usuario_id, perfil_id, idempresa, asignado_por)
    select u.profile_id, m.nuevo, e.empresa_id, coalesce(u.asignado_por, 'migracion 249')
    from public.acceso_perfil_usuarios u
    join _mapa_perfiles m on m.viejo = u.perfil_id
    join public.acceso_perfil_empresas e on e.perfil_id = m.nuevo
    on conflict do nothing;

    insert into public.autorizacion_usuario_perfiles (usuario_id, perfil_id, idempresa, asignado_por)
    select u.profile_id, m.nuevo, null, coalesce(u.asignado_por, 'migracion 249')
    from public.acceso_perfil_usuarios u
    join _mapa_perfiles m on m.viejo = u.perfil_id
    where not exists (select 1 from public.acceso_perfil_empresas e where e.perfil_id = m.nuevo)
    on conflict do nothing;

    drop table public.acceso_perfil_usuarios;
  end if;

  -- 2f) El catalogo viejo ya no tiene razon de ser.
  drop table public.acceso_perfiles;
  raise notice '249: migracion completada.';
end $$;


-- ----------------------------------------------------------------------------
-- PASO 3 — Las tablas hijas, apuntando a autorizacion_perfiles
-- ----------------------------------------------------------------------------
-- `create if not exists` cubre a quien nunca corrio el 247; la FK se agrega
-- aparte porque las tablas migradas ya existen sin ella.

create table if not exists public.acceso_perfil_empresas (
  perfil_id  int not null,
  empresa_id int not null,
  primary key (perfil_id, empresa_id)
);
create table if not exists public.acceso_perfil_owners (
  perfil_id int  not null,
  owner     text not null,
  primary key (perfil_id, owner)
);
create table if not exists public.acceso_perfil_permisos (
  perfil_id int  not null,
  permiso   text not null,
  primary key (perfil_id, permiso)
);
create table if not exists public.acceso_perfil_materializado (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tipo  text not null check (tipo in ('empresa', 'owner', 'permiso')),
  valor text not null,
  primary key (profile_id, tipo, valor)
);

do $$
declare t text;
begin
  foreach t in array array['acceso_perfil_empresas', 'acceso_perfil_owners', 'acceso_perfil_permisos'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_autorizacion_fk') then
      execute format(
        'alter table public.%I add constraint %I foreign key (perfil_id) references public.autorizacion_perfiles(id) on delete cascade',
        t, t || '_autorizacion_fk');
    end if;
  end loop;
end $$;

comment on table public.acceso_perfil_empresas is 'Empresas que abre cada perfil (autorizacion_perfiles). Ver scripts/249.';
comment on table public.acceso_perfil_owners   is 'Owners a los que limita Pedidos cada perfil (autorizacion_perfiles). Ver scripts/249.';
comment on table public.acceso_perfil_permisos is 'Permisos de modulo (columnas de permisos_usuarios) que enciende cada perfil. Ver scripts/249.';


-- ----------------------------------------------------------------------------
-- PASO 4 — Seguridad, como el resto de `public` (script 220)
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['acceso_perfil_empresas', 'acceso_perfil_owners', 'acceso_perfil_permisos', 'acceso_perfil_materializado'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lipgo_autenticados on public.%I', t);
    execute format('create policy lipgo_autenticados on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- PASO 5 — Una sola pantalla, una sola llave
-- ----------------------------------------------------------------------------
-- La pantalla unica vive bajo el permiso de "Gestion de Usuarios". Las
-- acciones de autorizaciones aceptan desde hoy cualquiera de las dos llaves,
-- y aqui se repite la regla del 203 para que nadie quede con una y sin la
-- otra. No amplia a nadie: autorizaciones_clave ya se otorgo asi.

update public.permisos_usuarios
   set autorizaciones_clave = true
 where gestion_usuarios = true
   and autorizaciones_clave is distinct from true;


-- ----------------------------------------------------------------------------
-- PASO 6 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 6a) El catalogo viejo ya no existe.
select to_regclass('public.acceso_perfiles')         as acceso_perfiles,          -- debe ser NULL
       to_regclass('public.acceso_perfil_usuarios')  as acceso_perfil_usuarios;   -- debe ser NULL

-- 6b) Las hijas apuntan a autorizacion_perfiles.
select conrelid::regclass as tabla, confrelid::regclass as apunta_a
from pg_constraint
where conname like 'acceso_perfil_%_autorizacion_fk'
order by 1;

-- 6c) Cada perfil, con todo lo que trae ahora.
select p.id, p.nombre, p.activo,
       (select count(*) from public.autorizacion_perfil_procesos x where x.perfil_id = p.id) as procesos,
       (select count(*) from public.acceso_perfil_empresas        x where x.perfil_id = p.id) as empresas,
       (select count(*) from public.acceso_perfil_owners          x where x.perfil_id = p.id) as owners,
       (select count(*) from public.acceso_perfil_permisos        x where x.perfil_id = p.id) as modulos,
       (select count(distinct usuario_id) from public.autorizacion_usuario_perfiles x where x.perfil_id = p.id) as usuarios
from public.autorizacion_perfiles p
order by p.activo desc, p.nombre;
