
-- =====================================================================
-- scripts/diccionario/01_funcion_diccionario.sql
--
-- Instala `public.diccionario_esquema()`: la función que lee el esquema REAL de
-- Postgres y lo devuelve como JSON. Es la fuente del diccionario de datos.
--
-- Se corre UNA vez (y otra vez cada que se cambie esta función). Es idempotente:
-- `create or replace`. NO crea tablas, NO toca datos, NO escribe nada: solo lee los
-- catálogos del sistema.
-- =====================================================================
--
-- POR QUÉ UNA FUNCIÓN Y NO UN DOCUMENTO ESCRITO A MANO
--
-- Un diccionario escrito a mano se desactualiza en semanas y entonces MIENTE, que es
-- peor que no tenerlo. Este se genera del esquema real cada vez, así que no puede
-- mentir sobre tipos, llaves ni columnas generadas.
--
-- Las DESCRIPCIONES sí las escribe una persona, pero viven dentro de la propia base
-- como comentarios (`comment on table` / `comment on column`), que es donde ya están
-- las 121 que el proyecto tiene repartidas en 57 scripts. Así la descripción viaja
-- pegada a la columna y nadie tiene que acordarse de actualizar un archivo aparte.
--
-- QUÉ DEVUELVE, por cada tabla y vista de `public`:
--   nombre, tipo (tabla/vista/vista materializada/particionada), descripción,
--   filas aproximadas, y por cada columna: nombre, orden, tipo, si admite nulos,
--   valor por defecto, SI ES GENERADA y con qué expresión, si es de identidad y su
--   descripción. Más la llave primaria, las llaves foráneas con su destino y las
--   restricciones de unicidad.
--
-- POR QUÉ IMPORTA CADA COSA (todas costaron un error real el 2026-10-07):
--   · el TIPO: `historicolotes.cantidad` es texto, y `sum()` sobre texto no existe.
--   · GENERADA: `pedidosdetalle.unidadespendientes` no se puede escribir.
--   · las LLAVES FORÁNEAS: `detalleoc` se liga por `idorden`, no por el número de orden.
--   · la UNICIDAD: `cabeceraoc` tiene números de orden repetidos.
-- =====================================================================

create or replace function public.diccionario_esquema()
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
with objetos as (
  select c.oid,
         c.relname                                as nombre,
         c.relkind                                as clase,
         case c.relkind
           when 'r' then 'tabla'
           when 'p' then 'tabla particionada'
           when 'v' then 'vista'
           when 'm' then 'vista materializada'
           when 'f' then 'tabla externa'
         end                                      as tipo,
         -- `reltuples` es la estimación del planificador: -1 significa "nunca analizada".
         case when c.reltuples < 0 then null else c.reltuples::bigint end as filas_aprox,
         obj_description(c.oid, 'pg_class')        as descripcion
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
),
columnas as (
  select a.attrelid as oid,
         jsonb_agg(
           jsonb_build_object(
             'nombre',             a.attname,
             'orden',              a.attnum,
             'tipo',               format_type(a.atttypid, a.atttypmod),
             'admite_nulos',       not a.attnotnull,
             'defecto',            case when a.attgenerated = '' then pg_get_expr(ad.adbin, ad.adrelid) end,
             -- LO MÁS IMPORTANTE DE ESTA FUNCIÓN: una columna generada NO se puede escribir.
             'generada',           (a.attgenerated <> ''),
             'expresion_generada', case when a.attgenerated <> '' then pg_get_expr(ad.adbin, ad.adrelid) end,
             'identidad',          (a.attidentity <> ''),
             'descripcion',        col_description(a.attrelid, a.attnum)
           )
           order by a.attnum
         ) as cols
  from pg_attribute a
  left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  join objetos o on o.oid = a.attrelid
  where a.attnum > 0
    and not a.attisdropped
  group by a.attrelid
),
restricciones as (
  select con.conrelid as oid,
         jsonb_agg(
           jsonb_build_object(
             'tipo', case con.contype
                       when 'p' then 'llave primaria'
                       when 'f' then 'llave foranea'
                       when 'u' then 'unica'
                     end,
             'nombre', con.conname,
             'columnas', (
               select jsonb_agg(att.attname order by u.ord)
               from unnest(con.conkey) with ordinality as u(num, ord)
               join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.num
             ),
             'referencia_tabla', case when con.contype = 'f'
               then (select cl.relname from pg_class cl where cl.oid = con.confrelid) end,
             'referencia_columnas', case when con.contype = 'f' then (
               select jsonb_agg(att.attname order by u.ord)
               from unnest(con.confkey) with ordinality as u(num, ord)
               join pg_attribute att on att.attrelid = con.confrelid and att.attnum = u.num
             ) end
           )
           order by con.contype, con.conname
         ) as rs
  from pg_constraint con
  join objetos o on o.oid = con.conrelid
  where con.contype in ('p', 'f', 'u')
  group by con.conrelid
),
-- Índices únicos que NO son una restricción declarada: tambien garantizan unicidad.
indices_unicos as (
  select i.indrelid as oid,
         jsonb_agg(
           jsonb_build_object(
             'nombre', ci.relname,
             'columnas', (
               select jsonb_agg(att.attname order by u.ord)
               from unnest(i.indkey::int[]) with ordinality as u(num, ord)
               join pg_attribute att on att.attrelid = i.indrelid and att.attnum = u.num
             ),
             'parcial', (i.indpred is not null)
           )
           order by ci.relname
         ) as ix
  from pg_index i
  join pg_class ci on ci.oid = i.indexrelid
  join objetos o on o.oid = i.indrelid
  where i.indisunique
    and not i.indisprimary
    and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)
  group by i.indrelid
)
select jsonb_build_object(
  'generado_en', now(),
  'base', current_database(),
  'esquema', 'public',
  'objetos', coalesce(jsonb_agg(
    jsonb_build_object(
      'nombre',        o.nombre,
      'tipo',          o.tipo,
      'descripcion',   o.descripcion,
      'filas_aprox',   o.filas_aprox,
      'columnas',      coalesce(c.cols, '[]'::jsonb),
      'restricciones', coalesce(r.rs,  '[]'::jsonb),
      'indices_unicos',coalesce(u.ix,  '[]'::jsonb)
    )
    order by o.nombre
  ), '[]'::jsonb)
)
from objetos o
left join columnas       c on c.oid = o.oid
left join restricciones  r on r.oid = o.oid
left join indices_unicos u on u.oid = o.oid;
$$;

comment on function public.diccionario_esquema() is
  'Devuelve el esquema real de `public` como JSON: tablas, vistas, columnas con tipo y si son generadas, llaves primarias, foraneas y unicidad. Es la fuente del diccionario de datos; se consume desde scripts/generar-diccionario.mts. Solo lectura.';

-- ---------------------------------------------------------------------
-- COMPROBACIÓN. Debe devolver un resumen con cientos de objetos y columnas.
-- ---------------------------------------------------------------------
select (public.diccionario_esquema() -> 'base')                          as base,
       jsonb_array_length(public.diccionario_esquema() -> 'objetos')      as objetos,
       (select sum(jsonb_array_length(o -> 'columnas'))
          from jsonb_array_elements(public.diccionario_esquema() -> 'objetos') o) as columnas,
       (select count(*)
          from jsonb_array_elements(public.diccionario_esquema() -> 'objetos') o
         where o -> 'descripcion' <> 'null'::jsonb)                       as objetos_descritos;

-- Las columnas GENERADAS que hay en la base: son las que no se pueden escribir.
select o ->> 'nombre' as tabla, col ->> 'nombre' as columna, col ->> 'expresion_generada' as se_calcula_como
from jsonb_array_elements(public.diccionario_esquema() -> 'objetos') o,
     jsonb_array_elements(o -> 'columnas') col
where (col ->> 'generada')::boolean
order by 1, 2;
