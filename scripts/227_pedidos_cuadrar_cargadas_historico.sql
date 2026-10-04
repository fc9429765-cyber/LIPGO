-- =====================================================================
-- 227_pedidos_cuadrar_cargadas_historico.sql
--
-- NO CORRER SIN INSTRUCCIÓN EXPRESA DE GERENCIA.
--
-- Cambia los NÚMEROS DE PEDIDOS de proyectos en operación. No toca inventario
-- (invtrans) ni ningún saldo: `pedidosdetalle` es el control del pedido del
-- cliente, no el inventario. Aun así, son datos de un proyecto, y la regla es que
-- un cambio así se hace con gerencia presente, con foto antes y después.
--
-- REQUISITO: el script 226 corrido (crea y reconstruye `pedidodetalle_ocargue`).
-- =====================================================================
--
-- QUÉ ARREGLA
--
-- Cuando la misma línea de un pedido se cargó en dos órdenes, la segunda
-- sobrescribía lo de la primera en lugar de sumarse. Medición del 2026-10-04:
-- 59 líneas de 56 pedidos, 18.129 unidades que salieron del inventario y el
-- pedido no cuenta como despachadas (ID1 7 líneas, ID2 50, ID3 2).
-- Ejemplo: pedido 8742 (ID2), línea 17673, 200 unidades pedidas, cargadas
-- 150 + 50 en dos órdenes; la línea quedó diciendo 50 y el pedido aparece como
-- entrega parcial cuando salió completo.
--
-- El código ya quedó corregido el 2026-10-04 (acumula por orden), así que esto
-- NO vuelve a pasar: este script es solo para el histórico.
--
-- CÓMO LO ARREGLA
--  · Por llave primaria (transid), nunca por filtros amplios.
--  · Solo sube `unidadescargadas` hasta lo que suman las órdenes del libro
--    auxiliar, y nunca por encima de lo pedido en la línea.
--  · Nunca baja un valor: si la línea dice más que las órdenes, se deja y se
--    informa (puede ser un cuadre manual de auditoría hecho con clave).
--  · Imprime el antes y el después de cada línea.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar esta salida antes de seguir.
-- ---------------------------------------------------------------------
with libro as (
  select transid, sum(unidades) as segun_ordenes, count(*) as ordenes,
         string_agg(ocargue || ':' || unidades::text, ' + ' order by creado_en) as detalle
  from public.pedidodetalle_ocargue group by transid
)
select d.id_empresa, d.idpedido, d.transid, d.producto,
       d.unidades                                               as pedidas,
       coalesce(d.unidadescargadas, d.unidades_cargadas, 0)      as dice_ahora,
       least(l.segun_ordenes, d.unidades)                        as quedaria,
       l.ordenes, l.detalle, d.estado
from libro l
join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > coalesce(d.unidadescargadas, d.unidades_cargadas, 0) + 0.01
order by d.id_empresa, d.idpedido, d.transid;

-- ---------------------------------------------------------------------
-- PASO 2 — CORRECCIÓN. Quitar el comentario de abajo SOLO con la instrucción dada.
-- ---------------------------------------------------------------------
/*
begin;

-- 2a. Las líneas, por llave primaria.
create temporary table _lineas_a_cuadrar as
with libro as (
  select transid, sum(unidades) as segun_ordenes
  from public.pedidodetalle_ocargue group by transid
)
select d.transid, d.idpedido, d.id_empresa
from libro l
join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > coalesce(d.unidadescargadas, d.unidades_cargadas, 0) + 0.01;

with libro as (
  select transid, sum(unidades) as segun_ordenes
  from public.pedidodetalle_ocargue group by transid
)
update public.pedidosdetalle d
   set unidadescargadas = least(l.segun_ordenes, d.unidades)
from libro l
where d.transid = l.transid
  and d.transid in (select transid from _lineas_a_cuadrar);

-- 2b. El estado de esos pedidos se vuelve a derivar de las cantidades, con la MISMA regla
-- del código (checkAndUpdatePedidoCabeceraStatus): todas las líneas cerradas y sin faltante
-- es "entregado"; cerradas con faltante es "entrega parcial"; alguna parcial es "parcial".
-- Solo los pedidos tocados arriba; ningún otro pedido de ningún proyecto se altera.
with afectados as (
  select distinct idpedido from _lineas_a_cuadrar
),
resumen as (
  select d.idpedido,
         bool_and(d.estado = 'cerrado')                                                   as todas_cerradas,
         bool_or(d.estado = 'parcial')                                                    as alguna_parcial,
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
*/

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS. Debe quedar en cero filas. Correr también el verificador
-- de la app: scripts/verificar_226_pedido_ordenes.mts --diferencias
-- Y después revisar en Pedidos el estado de los 56 pedidos: los que salieron
-- completos deben dejar de aparecer como entrega parcial.
-- ---------------------------------------------------------------------
with libro as (
  select transid, sum(unidades) as segun_ordenes from public.pedidodetalle_ocargue group by transid
)
select count(*) as lineas_descuadradas
from libro l
join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > coalesce(d.unidadescargadas, d.unidades_cargadas, 0) + 0.01;
