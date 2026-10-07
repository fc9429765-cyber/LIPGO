
-- =====================================================================
-- 251_ligar_rastros_a_la_orden_por_id.sql
--
-- PASO 1 de 4 para que la base IMPIDA los rastros huérfanos, en vez de que los
-- detectemos después.
--
-- Agrega la columna `idorden` a las tres tablas que hoy se ligan a la orden de cargue
-- por un CÓDIGO DE TEXTO, y la rellena. NO crea la llave foránea todavía: eso es el
-- paso 3, cuando las filas nuevas lleguen al 100 %.
--
-- ES PURAMENTE ADITIVO. Una columna nueva que ningún código lee todavía. NO cambia
-- ni una cifra: no toca cantidades, ni saldos, ni estados, ni el código de texto que
-- ya estaba. Si algo sale mal, la columna queda en nulo y nada deja de funcionar.
-- =====================================================================
--
-- EL PATRÓN QUE LO MOTIVA (medido el 2026-10-07)
--
-- `detalleoc` se liga a su orden por un id numérico Y tiene llave foránea hacia
-- `cabeceraoc`. En todo un día de auditoría no apareció ni una línea huérfana ahí.
--
-- Las otras tres se ligan por texto y NO tienen ninguna llave foránea hacia la orden.
-- Ahí vive todo lo que hubo que arreglar ese día:
--
--   tabla                    se liga por            huérfanas
--   detalleoc                idorden (numérico)         0
--   invtrans                 ocargue (texto)          322
--   historicolotes           ordendecargue (texto)     77
--   pedidodetalle_ocargue    ocargue (texto)          254
--
-- Una asignación que sobrevivió a su orden, 149 movimientos de inventario apuntando a
-- órdenes que ya no existen, una canasta de lotes guardada bajo el número de otra orden:
-- todas son la misma causa.
--
-- POR QUÉ NUNCA SE PUSO LA LLAVE FORÁNEA, y por qué hace falta este paso intermedio:
-- una llave foránea no puede apuntar a una columna que no es única, y
-- `cabeceraoc.ordendecargue` tiene **55 códigos repetidos** (9.529 órdenes, 9.464 códigos
-- distintos). Por eso primero se liga por `id`, que sí es único, y la llave foránea viene
-- después.
--
-- QUÉ RELLENA Y QUÉ NO
-- Solo donde el código resuelve a UNA sola orden. Medido antes de escribir esto:
--   invtrans              98,31 % de las filas que traen código
--   historicolotes        99,57 %
--   pedidodetalle_ocargue 98,62 %
-- Lo demás queda en NULO a propósito: códigos ambiguos (apuntan a varias órdenes) y
-- huérfanos (la orden no existe). Rellenarlos a dedo sería inventar un vínculo.
-- Las filas sin código también quedan en nulo: en `invtrans` son 11.851 movimientos que
-- no vienen de una orden de cargue, y está bien que así sea.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar esta salida.
-- ---------------------------------------------------------------------
select 'invtrans' as tabla, count(*) as filas, count(ocargue) as con_codigo
from public.invtrans
union all
select 'historicolotes', count(*), count(ordendecargue) from public.historicolotes
union all
select 'pedidodetalle_ocargue', count(*), count(ocargue) from public.pedidodetalle_ocargue;

-- Los códigos repetidos, que son la raíz de todo esto.
select btrim(ordendecargue) as codigo, count(*) as veces, string_agg(id::text, ', ' order by id) as ids
from public.cabeceraoc
where ordendecargue is not null and btrim(ordendecargue) <> ''
group by btrim(ordendecargue)
having count(*) > 1
order by 2 desc, 1;
-- Esperado: 55 filas. Son el paso 4, no se tocan aquí.

-- ---------------------------------------------------------------------
-- PASO 2 — LA COLUMNA Y EL RELLENO.
-- ---------------------------------------------------------------------
begin;

-- 2a. La columna. `if not exists` la hace idempotente.
alter table public.invtrans              add column if not exists idorden bigint;
alter table public.historicolotes        add column if not exists idorden bigint;
alter table public.pedidodetalle_ocargue add column if not exists idorden bigint;

comment on column public.invtrans.idorden is
  'Orden de cargue a la que pertenece el movimiento, por id (cabeceraoc.id). Es el vinculo FIABLE: `ocargue` es un codigo de texto y cabeceraoc tiene codigos repetidos. Nulo cuando el movimiento no viene de una orden, o cuando el codigo es ambiguo o huerfano. Script 251.';
comment on column public.historicolotes.idorden is
  'Orden de cargue de esta asignacion de lote, por id (cabeceraoc.id). Ver invtrans.idorden. Script 251.';
comment on column public.pedidodetalle_ocargue.idorden is
  'Orden de cargue de esta atribucion, por id (cabeceraoc.id). Ver invtrans.idorden. Script 251.';

-- 2b. Índices: la columna existe para consultarse y, mañana, para la llave foránea.
create index if not exists idx_invtrans_idorden              on public.invtrans (idorden);
create index if not exists idx_historicolotes_idorden        on public.historicolotes (idorden);
create index if not exists idx_pedidodetalle_ocargue_idorden on public.pedidodetalle_ocargue (idorden);

do $ligar$
declare
  v_inv int;
  v_hl  int;
  v_pdo int;
  v_amb int;
begin
  -- Solo los códigos que identifican UNA orden. Los repetidos se quedan fuera: con un
  -- código ambiguo no se puede saber a cuál de las dos órdenes pertenece la fila, y
  -- elegir una sería inventarlo.
  create temporary table _codigos_unicos on commit drop as
  select btrim(ordendecargue) as codigo, min(id) as id
  from public.cabeceraoc
  where ordendecargue is not null and btrim(ordendecargue) <> ''
  group by btrim(ordendecargue)
  having count(*) = 1;

  create index on _codigos_unicos (codigo);

  select count(*) into v_amb
    from (select 1 from public.cabeceraoc
           where ordendecargue is not null and btrim(ordendecargue) <> ''
           group by btrim(ordendecargue) having count(*) > 1) t;
  raise notice 'Codigos de orden repetidos (quedan sin ligar, son el paso 4): %', v_amb;

  update public.invtrans t
     set idorden = u.id
    from _codigos_unicos u
   where t.idorden is null
     and t.ocargue is not null
     and btrim(t.ocargue) = u.codigo;
  get diagnostics v_inv = row_count;

  update public.historicolotes t
     set idorden = u.id
    from _codigos_unicos u
   where t.idorden is null
     and t.ordendecargue is not null
     and btrim(t.ordendecargue) = u.codigo;
  get diagnostics v_hl = row_count;

  update public.pedidodetalle_ocargue t
     set idorden = u.id
    from _codigos_unicos u
   where t.idorden is null
     and t.ocargue is not null
     and btrim(t.ocargue) = u.codigo;
  get diagnostics v_pdo = row_count;

  raise notice 'Ligadas por id -> invtrans: % · historicolotes: % · pedidodetalle_ocargue: %', v_inv, v_hl, v_pdo;

  -- CANDADO. Ninguna fila puede haber quedado apuntando a una orden que no existe:
  -- se ligó desde la propia `cabeceraoc`, pero más vale comprobarlo que suponerlo.
  if exists (select 1 from public.invtrans t where t.idorden is not null
               and not exists (select 1 from public.cabeceraoc c where c.id = t.idorden)) then
    raise exception 'Quedaron movimientos ligados a una orden inexistente: se deshace todo.';
  end if;
  if exists (select 1 from public.historicolotes t where t.idorden is not null
               and not exists (select 1 from public.cabeceraoc c where c.id = t.idorden)) then
    raise exception 'Quedaron asignaciones ligadas a una orden inexistente: se deshace todo.';
  end if;
  if exists (select 1 from public.pedidodetalle_ocargue t where t.idorden is not null
               and not exists (select 1 from public.cabeceraoc c where c.id = t.idorden)) then
    raise exception 'Quedaron atribuciones ligadas a una orden inexistente: se deshace todo.';
  end if;

  -- CANDADO 2. El id y el código tienen que hablar de la MISMA orden. Si no coinciden,
  -- el vinculo nuevo seria peor que no tenerlo.
  if exists (
    select 1 from public.invtrans t
    join public.cabeceraoc c on c.id = t.idorden
    where t.idorden is not null and btrim(t.ocargue) <> btrim(c.ordendecargue)) then
    raise exception 'Hay movimientos cuyo id de orden no corresponde a su codigo: se deshace todo.';
  end if;

  raise notice 'LISTO. Ninguna cifra cambio: solo se agrego el vinculo por id.';
end
$ligar$;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS. La cobertura lograda.
-- ---------------------------------------------------------------------
select 'invtrans' as tabla,
       count(*) as filas,
       count(ocargue) as con_codigo,
       count(idorden) as ligadas,
       round(100.0 * count(idorden) / nullif(count(ocargue), 0), 2) as pct_de_las_que_tienen_codigo
from public.invtrans
union all
select 'historicolotes', count(*), count(ordendecargue), count(idorden),
       round(100.0 * count(idorden) / nullif(count(ordendecargue), 0), 2)
from public.historicolotes
union all
select 'pedidodetalle_ocargue', count(*), count(ocargue), count(idorden),
       round(100.0 * count(idorden) / nullif(count(ocargue), 0), 2)
from public.pedidodetalle_ocargue;
-- Esperado aprox.: invtrans 98,31 % · historicolotes 99,57 % · pedidodetalle_ocargue 98,62 %

-- Lo que quedó SIN ligar y por qué. Esta es la lista de trabajo del paso 4.
with codigos as (
  select btrim(ordendecargue) as codigo, count(*) as veces
  from public.cabeceraoc
  where ordendecargue is not null and btrim(ordendecargue) <> ''
  group by btrim(ordendecargue)
),
clasificadas as (
  select case
           when t.ocargue is null or btrim(t.ocargue) = '' then 'sin codigo'
           when t.idorden is not null                      then 'ligada'
           when c.veces > 1                                then 'codigo ambiguo'
           else                                                 'huerfana (la orden no existe)'
         end as situacion
  from public.invtrans t
  left join codigos c on c.codigo = btrim(t.ocargue)
)
select situacion, count(*) as filas
from clasificadas
group by situacion
order by 2 desc;

-- ---------------------------------------------------------------------
-- LO QUE SIGUE
-- ---------------------------------------------------------------------
-- PASO 2: que el codigo escriba `idorden` al crear cada fila. Las acciones ya conocen el
--         id de la orden (la asignacion de lotes lo recibe desde el 2026-10-07).
-- PASO 3: cuando las filas NUEVAS lleguen al 100 %, agregar la llave foranea
--         (primero `not valid`, luego `validate constraint`, para no bloquear la tabla).
--         Desde ese momento la base misma impide el huerfano.
-- PASO 4: resolver los 55 codigos de orden repetidos, que son la raiz de la fragilidad.
