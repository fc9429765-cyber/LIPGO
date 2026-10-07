-- =====================================================================
-- 227_pedidos_cuadrar_cargadas_historico.sql
--
-- AUTORIZADO POR GERENCIA EL 2026-10-07: el PASO 2 ya está habilitado (antes venía
-- comentado como salvaguarda, por eso una primera corrida solo mostró las consultas).
--
-- Cambia los NÚMEROS DE PEDIDOS de proyectos en operación. No toca inventario
-- (invtrans) ni ningún saldo: `pedidosdetalle` es el control del pedido del
-- cliente, no el inventario. Aun así son datos de un proyecto, y la regla es que
-- un cambio así se hace con gerencia presente, con foto antes y después.
--
-- REQUISITOS: scripts 226 y 228 corridos, en ese orden.
-- =====================================================================
--
-- QUÉ ARREGLA
--
-- Cuando la misma línea de un pedido se cargó en dos órdenes, la segunda
-- sobrescribía lo de la primera en lugar de sumarse, así que el pedido dejó de
-- contar unidades que sí salieron. El código quedó corregido el 2026-10-04
-- (acumula por orden), así que esto es solo para el histórico.
--
-- Medición del 2026-10-04, ya confrontada contra el detalle de cada orden y
-- contra las salidas aprobadas de inventario:
--
--   GRUPO C, lo que este script corrige: 79 líneas de 76 pedidos, 22.732
--   unidades que salieron y el pedido no cuenta, y que CABEN en lo pedido.
--   Reparto: ID1 13 líneas / 2.795 unidades · ID2 62 / 18.132 · ID3 4 / 1.805.
--
--   GRUPO B, lo que este script NO toca: 11 líneas donde salió MÁS de lo pedido
--   (ID2 10 líneas / 3.165 unidades de exceso; ID1 1 línea / 1.998, que parece un
--   error de digitación de enero: 2 unidades pedidas y 2.000 cargadas).
--   Eso NO se cuadra por software: taparlo con un tope escondería que salió
--   mercancía por encima de lo que el cliente pidió. El paso 1b las lista para
--   que gerencia las revise una por una.
--
-- CÓMO LO ARREGLA
--  · Por llave primaria (transid), nunca por filtros amplios.
--  · Solo sube `unidadescargadas` hasta lo que suman las órdenes, y solo cuando
--    eso cabe en lo pedido. Nunca baja un valor. Nunca pasa de lo pedido.
--  · Vuelve a derivar el estado de esos pedidos con la misma regla del código.
--  · Imprime antes y después.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1a — ANTES: lo que SÍ se va a corregir (grupo C). Guardar esta salida.
-- ---------------------------------------------------------------------
with libro as (
  select transid, sum(unidades) as segun_ordenes, count(*) as ordenes,
         string_agg(ocargue || ':' || unidades::text, ' + ' order by creado_en) as detalle
  from public.pedidodetalle_ocargue group by transid
)
select d.id_empresa, d.idpedido, d.transid, d.producto,
       d.unidades                                            as pedidas,
       coalesce(d.unidadescargadas, d.unidades_cargadas, 0)   as dice_ahora,
       l.segun_ordenes                                       as quedaria,
       l.ordenes, l.detalle, d.estado
from libro l
join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > coalesce(d.unidadescargadas, d.unidades_cargadas, 0) + 0.01
  and l.segun_ordenes <= d.unidades + 0.01
order by d.id_empresa, d.idpedido, d.transid;

-- ---------------------------------------------------------------------
-- PASO 1b — SALIÓ MÁS DE LO PEDIDO (grupo B). Este script NO las toca.
-- Revisar una por una con gerencia: son unidades que se entregaron por encima de
-- lo que el cliente pidió.
-- ---------------------------------------------------------------------
with libro as (
  select transid, sum(unidades) as segun_ordenes, count(*) as ordenes,
         string_agg(ocargue || ':' || unidades::text, ' + ' order by creado_en) as detalle
  from public.pedidodetalle_ocargue group by transid
)
select d.id_empresa, d.idpedido, d.transid, d.producto,
       d.unidades                                            as pedidas,
       coalesce(d.unidadescargadas, d.unidades_cargadas, 0)   as dice_ahora,
       l.segun_ordenes                                       as salio,
       l.segun_ordenes - d.unidades                          as exceso,
       l.ordenes, l.detalle, d.estado
from libro l
join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > d.unidades + 0.01
order by (l.segun_ordenes - d.unidades) desc;

-- ---------------------------------------------------------------------
-- PASO 2 — CORRECCIÓN DEL GRUPO C.
-- HABILITADO el 2026-10-07 por instrucción expresa de gerencia ("corre el 227"),
-- después de revisar con ella a dónde mueve cantidades: solo sube el contador
-- `pedidosdetalle.unidadescargadas` y vuelve a derivar el estado del pedido; no
-- toca inventario ni ningún saldo. Hasta esa fecha el bloque estuvo comentado.
-- ---------------------------------------------------------------------
begin;

-- 2a. Las líneas, por llave primaria. Solo las que caben en lo pedido.
create temporary table _lineas_a_cuadrar as
with libro as (
  select transid, sum(unidades) as segun_ordenes
  from public.pedidodetalle_ocargue group by transid
)
select d.transid, d.idpedido, d.id_empresa, l.segun_ordenes
from libro l
join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > coalesce(d.unidadescargadas, d.unidades_cargadas, 0) + 0.01
  and l.segun_ordenes <= d.unidades + 0.01;

update public.pedidosdetalle d
   set unidadescargadas = x.segun_ordenes
from _lineas_a_cuadrar x
where d.transid = x.transid;

-- 2b. El estado de esos pedidos se vuelve a derivar de las cantidades, con la MISMA regla
-- del código (checkAndUpdatePedidoCabeceraStatus): todas las líneas cerradas y sin faltante
-- es "entregado"; cerradas con faltante es "entrega parcial"; alguna parcial es "parcial".
-- Solo los pedidos tocados arriba; ningún otro pedido de ningún proyecto se altera.
with afectados as (
  select distinct idpedido from _lineas_a_cuadrar
),
resumen as (
  select d.idpedido,
         bool_and(d.estado = 'cerrado')                                                      as todas_cerradas,
         bool_or(d.estado = 'parcial')                                                       as alguna_parcial,
         sum(greatest(0, d.unidades - coalesce(d.unidadescargadas, d.unidades_cargadas, 0))) as faltante
  from public.pedidosdetalle d
  where d.idpedido in (select idpedido from afectados)
  group by d.idpedido
)
update public.pedidoscabecera c
   set estado = case
                  when r.todas_cerradas and r.faltante <= 0.01 then 'entregado'
                  when r.todas_cerradas                        then 'entrega parcial'
                  when r.alguna_parcial                        then 'parcial'
                  else c.estado
                end
from resumen r
where c.idpedido = r.idpedido
  and c.estado is distinct from case
                  when r.todas_cerradas and r.faltante <= 0.01 then 'entregado'
                  when r.todas_cerradas                        then 'entrega parcial'
                  when r.alguna_parcial                        then 'parcial'
                  else c.estado
                end;

drop table _lineas_a_cuadrar;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS. La primera consulta debe quedar en cero. La segunda debe seguir
-- mostrando las 11 del grupo B: esas quedan para revisión con gerencia.
-- Correr también: npx tsx --env-file=.env.local scripts/verificar_226_pedido_ordenes.mts --diferencias
-- ---------------------------------------------------------------------
with libro as (
  select transid, sum(unidades) as segun_ordenes from public.pedidodetalle_ocargue group by transid
)
select count(*) as grupo_c_pendiente
from libro l join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > coalesce(d.unidadescargadas, d.unidades_cargadas, 0) + 0.01
  and l.segun_ordenes <= d.unidades + 0.01;

with libro as (
  select transid, sum(unidades) as segun_ordenes from public.pedidodetalle_ocargue group by transid
)
select count(*) as grupo_b_para_revisar, sum(l.segun_ordenes - d.unidades) as unidades_de_exceso
from libro l join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > d.unidades + 0.01;
