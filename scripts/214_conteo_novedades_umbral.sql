-- 214 · Conteo físico: diccionario de novedades editable, umbral de aprobación con clave
--       y proceso de autorización para aplicar correcciones por encima del umbral.
-- Decisión de gerencia 2026-10-02 (lógica de inventario físico tipo SAP):
--   el contador escribe la novedad lote por lote → el sistema propone el código →
--   el revisor aplica; por encima del umbral se exige clave personal.
-- Idempotente: se puede correr más de una vez.

-- (a) Diccionario novedad → código. idempresa null = regla global (todos los proyectos).
--     "patron" es texto simple (se busca sin tildes ni mayúsculas) o una expresión
--     regular si empieza por "/" (p. ej. /lote (equivocad|cruzad)/).
create table if not exists public.sig_conteo_novedad_regla (
  id serial primary key,
  idempresa integer,                       -- null = global
  codigo text not null,                    -- 701 702 309 311 653 551 344
  patron text not null,
  etiqueta text,
  orden integer not null default 100,      -- menor = se evalúa primero
  activo boolean not null default true,
  creado_por text,
  created_at timestamptz not null default now()
);
create index if not exists sig_conteo_novedad_regla_emp_idx on public.sig_conteo_novedad_regla (idempresa, activo, orden);
alter table public.sig_conteo_novedad_regla disable row level security;

-- (b) Parámetros del conteo por proyecto (clave/valor). idempresa null = valor por defecto.
--     Hoy: 'umbral_clave_unidades' = cantidad (en unidades) a partir de la cual una
--     corrección del conteo exige clave personal. Sin fila: 50.
create table if not exists public.sig_conteo_parametro (
  id serial primary key,
  idempresa integer,
  clave text not null,
  valor text not null,
  actualizado_por text,
  updated_at timestamptz not null default now(),
  unique (idempresa, clave)
);
alter table public.sig_conteo_parametro disable row level security;

-- (c) Proceso autorizable: aplicar desde el conteo una corrección por encima del umbral.
insert into public.autorizacion_procesos (codigo, nombre, descripcion, grupo, orden, con_alcance) values
  ('inv_conteo_umbral', 'Aplicar corrección de conteo sobre el umbral', 'En Cuadre de Inventario › Diferencias: aplicar una corrección (701/702/309/311/653/551) cuya cantidad supera el umbral del proyecto.', 'Inventario', 33, true)
on conflict (codigo) do update set
  nombre = excluded.nombre, descripcion = excluded.descripcion, grupo = excluded.grupo,
  orden = excluded.orden, con_alcance = excluded.con_alcance;

-- Lo tienen los mismos perfiles que aprueban faltantes (702): gerencia del proyecto y
-- coordinador LIP, además de la gerencia general de LIPgo.
insert into public.autorizacion_perfil_procesos (perfil_id, proceso)
select p.id, 'inv_conteo_umbral'
from public.autorizacion_perfiles p
where p.nombre in ('Gerencia General LIPgo', 'Gerencia de proyecto', 'Coordinador LIP')
on conflict do nothing;
