-- =====================================================================
-- 228_libro_ordenes_limpiar.sql — Dejar el libro `pedidodetalle_ocargue` solo con
-- lo que la orden de cargue puede probar. Correr en el SQL Editor de Supabase.
-- Idempotente. NO toca pedidos, ni inventario, ni ninguna tabla existente:
-- solo la tabla creada por el script 226.
-- =====================================================================
--
-- POR QUÉ. La reconstrucción del 226 tomó dos fuentes. La de la auditoría exigía que
-- la orden siguiera existiendo; la de la propia línea del pedido no lo exigía. Al
-- confrontar las 19.854 filas contra el detalle de cada orden (`detalleoc`) y contra
-- las salidas aprobadas de inventario, el resultado fue:
--
--   · 19.598 filas CUADRAN exactamente: lo que el libro atribuye es igual a lo que la
--     orden autorizó y a lo que salió del inventario.
--   · 8 filas son FALSAS: la orden existe, tiene detalle y NUNCA llevó ese producto.
--     Son 1.171 unidades mal atribuidas. La más grande: 695 de PT TOÑITA 25 LB que el
--     libro le achacaba a AVI202610029793, orden que no llevó ese producto.
--   · 248 filas NO SON VERIFICABLES: su orden ya no existe en `cabeceraoc` (124 códigos,
--     reversos y datos viejos). Son el único rastro de lo que la línea registraba, así
--     que NO se borran: se marcan, para que nadie las tome como prueba.
--
-- QUÉ HACE
--  1) Borra las 8 filas falsas, con el criterio de la evidencia (no a mano): la orden
--     existe, tiene detalle y ese producto no está en su detalle.
--  2) Marca las no verificables con origen = 'linea_sin_orden'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar esta salida.
-- ---------------------------------------------------------------------
select 'falsas (se borran)' as grupo, l.id, l.id_empresa, l.idpedido, l.transid, l.ocargue, d.producto, l.unidades, l.origen
from public.pedidodetalle_ocargue l
join public.pedidosdetalle d on d.transid = l.transid
where exists (
        select 1 from public.cabeceraoc c join public.detalleoc o on o.idorden = c.id
        where c.ordendecargue = l.ocargue)
  and not exists (
        select 1 from public.cabeceraoc c join public.detalleoc o on o.idorden = c.id
        where c.ordendecargue = l.ocargue
          and upper(btrim(o.producto)) = upper(btrim(d.producto)))
order by l.id;

select 'no verificables (se marcan)' as grupo, count(*) as filas, count(distinct l.ocargue) as ordenes, sum(l.unidades) as unidades
from public.pedidodetalle_ocargue l
where not exists (
        select 1 from public.cabeceraoc c join public.detalleoc o on o.idorden = c.id
        where c.ordendecargue = l.ocargue);

-- ---------------------------------------------------------------------
-- PASO 2 — LIMPIEZA.
-- ---------------------------------------------------------------------
begin;

-- 2a. Fuera las atribuciones falsas. Solo donde la orden EXISTE y TIENE detalle: así
-- nunca se castiga un vacío de datos, solo se quita lo que está probado que es falso.
delete from public.pedidodetalle_ocargue l
using public.pedidosdetalle d
where d.transid = l.transid
  and exists (
        select 1 from public.cabeceraoc c join public.detalleoc o on o.idorden = c.id
        where c.ordendecargue = l.ocargue)
  and not exists (
        select 1 from public.cabeceraoc c join public.detalleoc o on o.idorden = c.id
        where c.ordendecargue = l.ocargue
          and upper(btrim(o.producto)) = upper(btrim(d.producto)));

-- 2b. Marcar lo que no se puede probar con el documento de la orden.
update public.pedidodetalle_ocargue l
   set origen = 'linea_sin_orden'
where origen <> 'linea_sin_orden'
  and not exists (
        select 1 from public.cabeceraoc c join public.detalleoc o on o.idorden = c.id
        where c.ordendecargue = l.ocargue);

commit;

comment on column public.pedidodetalle_ocargue.origen is
  'app = lo escribió el cargue; backfill_auditoria / backfill_linea = reconstruido el 2026-10-04 y comprobado contra el detalle de la orden; linea_sin_orden = la orden ya no existe, es el rastro que guardaba la línea y no se puede probar con el documento.';

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS. La primera consulta debe dar cero filas.
-- ---------------------------------------------------------------------
select count(*) as falsas_restantes
from public.pedidodetalle_ocargue l
join public.pedidosdetalle d on d.transid = l.transid
where exists (
        select 1 from public.cabeceraoc c join public.detalleoc o on o.idorden = c.id
        where c.ordendecargue = l.ocargue)
  and not exists (
        select 1 from public.cabeceraoc c join public.detalleoc o on o.idorden = c.id
        where c.ordendecargue = l.ocargue
          and upper(btrim(o.producto)) = upper(btrim(d.producto)));

select origen, count(*) as filas, sum(unidades) as unidades
from public.pedidodetalle_ocargue group by origen order by origen;
