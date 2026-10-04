-- =====================================================================
-- 226_pedido_ordenes_cargue.sql — Control de un pedido que sale en VARIAS
-- órdenes de cargue. Aditivo e idempotente. Correr en el SQL Editor de Supabase.
-- NO toca inventario (invtrans) ni modifica ninguna tabla existente.
-- =====================================================================
--
-- Gerencia (2026-10-04): "toda orden debe estar ligada a un pedido... ten claro
-- que un pedido puede salir en varias órdenes cuando envían parciales y debes
-- llevar el control del mismo; un pedido creado no puede despachar más de lo
-- que se creó, menos sí, porque se permiten entregas parciales."
--
-- POR QUÉ HACE FALTA ESTA TABLA
--
-- Hoy el rastro de "cuánto salió" vive en UNA sola columna de la línea del
-- pedido (`pedidosdetalle.unidadescargadas`) y en UNA sola referencia de orden
-- (`pedidosdetalle.ocargue`). Cuando la MISMA línea se carga en dos órdenes, la
-- segunda SOBRESCRIBE a la primera en lugar de sumarse, y la referencia a la
-- primera orden se pierde.
--
-- Medición del 2026-10-04 (auditoría desde el 2026-07-26, 6.033 líneas con
-- historial): 59 líneas de 56 pedidos se cargaron en dos o más órdenes sin
-- reverso en medio, y el pedido NO cuenta como cargadas 18.129 unidades que sí
-- salieron del inventario. Reparto: ID1 7 líneas, ID2 50, ID3 2.
-- Ejemplo: pedido 8742 (ID2), línea 17673, 200 unidades pedidas, cargadas en
-- dos órdenes (150 + 50 = 200); la línea quedó diciendo 50.
--
-- El mismo vacío afecta el REVERSO: al eliminar una orden de cargue se ponen en
-- nulo `unidadescargadas` y `ocargue` de TODAS las líneas con ese código, así
-- que una línea que también había salido en otra orden pierde ese despacho.
--
-- QUÉ HACE ESTE SCRIPT
--  1) Crea `pedidodetalle_ocargue`: una fila por (línea de pedido, orden de
--     cargue) con las unidades que ESA orden tomó de ESA línea. Es el libro
--     auxiliar que permite sumar, revertir una sola orden y mostrarle al cliente
--     qué orden despachó cada parte.
--  2) Reconstruye el histórico que SÍ se puede probar: desde `auditoria`
--     (2026-07-26 en adelante) y, para el resto, desde la propia línea cuando
--     tiene una sola orden. Lo anterior al 2026-07-26 con dos órdenes no es
--     reconstruible: no quedó registrado en ninguna parte.
--  3) Imprime al final las líneas donde el libro auxiliar y la columna
--     `unidadescargadas` NO coinciden. ESTE SCRIPT NO CORRIGE ESA COLUMNA:
--     cambiar los números de un proyecto necesita instrucción expresa de
--     gerencia. La corrección queda lista y aparte en el script 227 (sin correr).
--
-- Seguridad: la tabla queda con RLS y la política de paso `lipgo_autenticados`,
-- igual que el resto tras el script 220. El cargue escribe con la sesión del
-- usuario, así que necesita el privilegio para `authenticated`.
-- =====================================================================

begin;

create table if not exists public.pedidodetalle_ocargue (
  id         bigserial   primary key,
  id_empresa integer     not null,
  idpedido   integer     not null,
  transid    bigint      not null,
  ocargue    text        not null,
  unidades   numeric     not null default 0,
  creado_en  timestamptz not null default now(),
  creado_por text,
  origen     text        not null default 'app'
);

create unique index if not exists ux_pedidodetalle_ocargue_linea_orden
  on public.pedidodetalle_ocargue (transid, ocargue);
create index if not exists idx_pedidodetalle_ocargue_pedido
  on public.pedidodetalle_ocargue (idpedido);
create index if not exists idx_pedidodetalle_ocargue_orden
  on public.pedidodetalle_ocargue (ocargue);
create index if not exists idx_pedidodetalle_ocargue_empresa
  on public.pedidodetalle_ocargue (id_empresa, idpedido);

comment on table public.pedidodetalle_ocargue is
  'Libro auxiliar: cuántas unidades tomó cada orden de cargue de cada línea de pedido. Permite que un pedido salga en varias órdenes sin perder lo ya despachado, revertir una sola orden y mostrar al cliente qué orden despachó cada parte. No es inventario: el inventario es invtrans.';
comment on column public.pedidodetalle_ocargue.transid is
  'pedidosdetalle.transid — la línea del pedido.';
comment on column public.pedidodetalle_ocargue.ocargue is
  'cabeceraoc.ordendecargue — el código de la orden de cargue.';
comment on column public.pedidodetalle_ocargue.unidades is
  'Unidades que ESA orden tomó de ESA línea. La suma por línea es lo cargado del pedido.';
comment on column public.pedidodetalle_ocargue.origen is
  'app = lo escribió el cargue; backfill_auditoria / backfill_linea = reconstruido al correr este script.';

alter table public.pedidodetalle_ocargue enable row level security;
drop policy if exists lipgo_autenticados on public.pedidodetalle_ocargue;
create policy lipgo_autenticados on public.pedidodetalle_ocargue
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.pedidodetalle_ocargue to authenticated, service_role;
grant usage, select on sequence public.pedidodetalle_ocargue_id_seq to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------
-- RECONSTRUCCIÓN A — desde la auditoría: el último valor que cada orden dejó en
-- cada línea. Solo órdenes que TODAVÍA existen en cabeceraoc: si la orden se
-- eliminó, ese despacho no ocurrió y no debe entrar al libro.
-- ---------------------------------------------------------------------
begin;

with eventos as (
  select (a.despues->>'transid')::bigint                            as transid,
         (a.despues->>'idpedido')::integer                          as idpedido,
         coalesce((a.despues->>'id_empresa')::integer, a.idempresa) as id_empresa,
         a.despues->>'ocargue'                                      as ocargue,
         coalesce((a.despues->>'unidadescargadas')::numeric, 0)     as unidades,
         a.ts,
         a.actor_nombre                                             as actor,
         a.id
  from public.auditoria a
  where a.tabla = 'pedidosdetalle'
    and a.operacion = 'UPDATE'
    and a.despues->>'ocargue' is not null
    and a.despues->>'transid' is not null
    and coalesce((a.despues->>'unidadescargadas')::numeric, 0) > 0
    and ( (a.antes->>'ocargue')          is distinct from (a.despues->>'ocargue')
       or (a.antes->>'unidadescargadas') is distinct from (a.despues->>'unidadescargadas') )
),
ultimos as (
  select distinct on (e.transid, e.ocargue)
         e.transid, e.idpedido, e.id_empresa, e.ocargue, e.unidades, e.ts, e.actor
  from eventos e
  order by e.transid, e.ocargue, e.id desc
)
insert into public.pedidodetalle_ocargue (id_empresa, idpedido, transid, ocargue, unidades, creado_en, creado_por, origen)
select u.id_empresa, u.idpedido, u.transid, u.ocargue, u.unidades, u.ts, u.actor, 'backfill_auditoria'
from ultimos u
where exists (select 1 from public.cabeceraoc     c where c.ordendecargue = u.ocargue)
  and exists (select 1 from public.pedidosdetalle d where d.transid       = u.transid)
on conflict (transid, ocargue) do nothing;

-- ---------------------------------------------------------------------
-- RECONSTRUCCIÓN B — el resto: líneas con una orden y unidades cargadas que no
-- quedaron cubiertas por la auditoría (cargues anteriores al 2026-07-26).
-- ---------------------------------------------------------------------
insert into public.pedidodetalle_ocargue (id_empresa, idpedido, transid, ocargue, unidades, creado_en, creado_por, origen)
select d.id_empresa, d.idpedido, d.transid, d.ocargue,
       coalesce(d.unidadescargadas, d.unidades_cargadas, 0), now(), null, 'backfill_linea'
from public.pedidosdetalle d
where d.ocargue is not null
  and coalesce(d.unidadescargadas, d.unidades_cargadas, 0) > 0
  and not exists (
    select 1 from public.pedidodetalle_ocargue l
    where l.transid = d.transid and l.ocargue = d.ocargue
  )
on conflict (transid, ocargue) do nothing;

commit;

-- ---------------------------------------------------------------------
-- COMPROBACIÓN (se ve en el editor SQL). No cambia nada.
-- ---------------------------------------------------------------------
select 'filas del libro auxiliar' as concepto, origen, count(*) as filas,
       count(distinct transid) as lineas, count(distinct ocargue) as ordenes
from public.pedidodetalle_ocargue group by origen order by origen;

-- Líneas que salieron en más de una orden.
select 'lineas en varias ordenes' as concepto, l.id_empresa, count(*) as lineas
from (select transid, id_empresa, count(*) as n from public.pedidodetalle_ocargue group by transid, id_empresa) l
where l.n > 1 group by l.id_empresa order by l.id_empresa;

-- DIFERENCIAS: lo que dicen las órdenes vs lo que dice la columna de la línea.
-- Estas son las unidades que salieron y el pedido no cuenta. NO se corrigen aquí.
with libro as (
  select transid, sum(unidades) as segun_ordenes, count(*) as ordenes
  from public.pedidodetalle_ocargue group by transid
)
select d.id_empresa,
       count(*)                                                             as lineas,
       sum(l.segun_ordenes - coalesce(d.unidadescargadas, d.unidades_cargadas, 0)) as unidades_no_contadas
from libro l
join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > coalesce(d.unidadescargadas, d.unidades_cargadas, 0) + 0.01
group by d.id_empresa
order by d.id_empresa;
