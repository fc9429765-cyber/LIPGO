-- ============================================================================
-- 247 — PERFILES DE ACCESO
-- ----------------------------------------------------------------------------
-- Hasta hoy el acceso de cada usuario se arma a mano, pieza por pieza y en
-- tres sitios distintos: qué EMPRESAS ve (perfil_acceso_empresas), a qué
-- OWNERS queda limitado en Pedidos (perfil_acceso_owners) y qué MÓDULOS puede
-- abrir (permisos_usuarios, 126 casillas). Dar de alta a un coordinador nuevo
-- es repetir ~140 clics copiando a otro parecido, y nadie puede responder
-- "¿qué tiene un coordinador?" sin abrir a uno y mirar.
--
-- UN PERFIL DE ACCESO es ese paquete con nombre: "Coordinador Indupan" trae
-- sus empresas, su owner y sus módulos. Se asigna el perfil y el usuario
-- queda listo. Sigue el mismo patrón de `autorizacion_perfiles` (script 203),
-- que ya hace esto para las autorizaciones por clave.
--
-- CÓMO SE APLICA SIN TOCAR LO QUE YA EXISTE
--
-- Veintiún módulos leen las tres tablas de siempre. No se cambia ninguno. El
-- perfil es la FUENTE; cuando se asigna o se edita, el servidor recalcula el
-- acceso efectivo del usuario y lo ESCRIBE en esas tres tablas. Para poder
-- retirar limpiamente lo que un perfil trajo --sin pisar lo que el
-- administrador marcó a mano-- `acceso_perfil_materializado` recuerda qué
-- filas vinieron de perfiles. Lo marcado a mano sigue siendo del usuario.
--
-- Aditivo e idempotente. No cambia ningún acceso existente al correrlo: las
-- tablas nacen vacías y nada se recalcula hasta que alguien asigne un perfil.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — EL CATÁLOGO DE PERFILES
-- ----------------------------------------------------------------------------

create table if not exists public.acceso_perfiles (
  id serial primary key,
  nombre text not null unique,
  descripcion text,
  -- Un perfil inactivo sigue asignado a sus usuarios pero no aporta nada: al
  -- recalcular, lo que traía se retira. Se apaga en vez de borrarse para que
  -- la asignación quede como rastro y se pueda reactivar.
  activo boolean not null default true,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.acceso_perfiles is
  'Perfiles de acceso: paquete con nombre de empresas + owners + permisos de modulo que se asigna a usuarios. Mismo patron que autorizacion_perfiles (203). Ver scripts/247.';


-- ----------------------------------------------------------------------------
-- PASO 2 — LO QUE TRAE CADA PERFIL
-- ----------------------------------------------------------------------------

-- Empresas (proyectos) que el perfil abre en el selector global.
create table if not exists public.acceso_perfil_empresas (
  perfil_id  int not null references public.acceso_perfiles(id) on delete cascade,
  empresa_id int not null,
  primary key (perfil_id, empresa_id)
);

-- Owners a los que queda limitado en Pedidos (misma semántica que
-- perfil_acceso_owners: SOLO recorta Pedidos por `empresafactura`).
create table if not exists public.acceso_perfil_owners (
  perfil_id int  not null references public.acceso_perfiles(id) on delete cascade,
  owner     text not null,
  primary key (perfil_id, owner)
);

-- Permisos de módulo. `permiso` es el nombre de la columna en
-- `permisos_usuarios` (las claves de MODULE_PERMISSION_MAP). El servidor
-- rechaza claves que no existan en el mapa.
create table if not exists public.acceso_perfil_permisos (
  perfil_id int  not null references public.acceso_perfiles(id) on delete cascade,
  permiso   text not null,
  primary key (perfil_id, permiso)
);


-- ----------------------------------------------------------------------------
-- PASO 3 — QUIÉN TIENE CADA PERFIL
-- ----------------------------------------------------------------------------
-- Un usuario puede tener varios perfiles: su acceso es la UNIÓN de todos los
-- activos. Si se borra el usuario, la asignación se va con él.

create table if not exists public.acceso_perfil_usuarios (
  perfil_id   int  not null references public.acceso_perfiles(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id)       on delete cascade,
  asignado_por text,
  asignado_en  timestamptz not null default now(),
  primary key (perfil_id, profile_id)
);

create index if not exists ix_acceso_perfil_usuarios_usuario
  on public.acceso_perfil_usuarios (profile_id);


-- ----------------------------------------------------------------------------
-- PASO 4 — LA MEMORIA DE LO QUE LOS PERFILES TRAJERON
-- ----------------------------------------------------------------------------
-- Sin esto no se podría quitar un perfil con seguridad: al recalcular no
-- habría forma de distinguir una empresa que trajo el perfil de una que el
-- administrador marcó a mano, y habría que borrar todo o no borrar nada.
--
-- Guarda, por usuario, qué filas de las tres tablas efectivas se insertaron
-- POR CAUSA de un perfil. Lo que ya estaba a mano no se anota, así que al
-- retirar el perfil se conserva.

create table if not exists public.acceso_perfil_materializado (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tipo  text not null check (tipo in ('empresa', 'owner', 'permiso')),
  valor text not null,     -- empresa_id como texto, nombre del owner, o clave del permiso
  primary key (profile_id, tipo, valor)
);

comment on table public.acceso_perfil_materializado is
  'Que filas de perfil_acceso_empresas / perfil_acceso_owners / permisos_usuarios puso un perfil de acceso en cada usuario. Permite retirar un perfil sin pisar lo marcado a mano. Ver scripts/247.';


-- ----------------------------------------------------------------------------
-- PASO 5 — SEGURIDAD, IGUAL QUE EL RESTO DE `public` (script 220)
-- ----------------------------------------------------------------------------
-- RLS encendido con la política de paso para `authenticated`; el servidor
-- escribe con la service role y no se ve afectado. `anon` no tiene nada.

do $$
declare t text;
begin
  foreach t in array array[
    'acceso_perfiles', 'acceso_perfil_empresas', 'acceso_perfil_owners',
    'acceso_perfil_permisos', 'acceso_perfil_usuarios', 'acceso_perfil_materializado'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lipgo_autenticados on public.%I', t);
    execute format(
      'create policy lipgo_autenticados on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- PASO 6 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 6a) Las seis tablas, con RLS encendido.
select tablename, rowsecurity as rls
from pg_tables
where schemaname = 'public' and tablename like 'acceso_perfil%'
order by tablename;

-- 6b) Nacen vacías: nada cambió para ningún usuario al correr esto.
select (select count(*) from public.acceso_perfiles)            as perfiles,
       (select count(*) from public.acceso_perfil_usuarios)     as asignaciones,
       (select count(*) from public.acceso_perfil_materializado) as materializado;

-- 6c) Punto de partida: cuántos usuarios hay y cuánto acceso suelto tienen
--     hoy. Es lo que los perfiles van a ordenar.
select (select count(*) from public.profiles)                        as usuarios,
       (select count(*) from public.perfil_acceso_empresas)           as filas_empresa,
       (select count(*) from public.perfil_acceso_owners)             as filas_owner,
       (select count(distinct profile_id) from public.perfil_acceso_empresas) as usuarios_con_empresa;


-- ----------------------------------------------------------------------------
-- REVERSIÓN
-- ----------------------------------------------------------------------------
-- OJO: borrar las tablas NO deshace el acceso que los perfiles ya escribieron
-- en perfil_acceso_empresas / perfil_acceso_owners / permisos_usuarios. Ese
-- acceso se queda tal cual, como si se hubiera marcado a mano. Para retirarlo
-- primero hay que quitar los perfiles desde la pantalla (que recalcula), y
-- DESPUÉS borrar las tablas.
--
--   drop table if exists public.acceso_perfil_materializado;
--   drop table if exists public.acceso_perfil_usuarios;
--   drop table if exists public.acceso_perfil_permisos;
--   drop table if exists public.acceso_perfil_owners;
--   drop table if exists public.acceso_perfil_empresas;
--   drop table if exists public.acceso_perfiles;
