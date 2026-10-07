-- =====================================================================
-- 241_libro_quitar_atribuciones_sobrantes.sql
--
-- Quita del libro `pedidodetalle_ocargue` cinco atribuciones que la orden NO
-- puede respaldar. Correr ANTES del 227.
--
-- Idempotente. NO toca pedidos, ni inventario, ni ninguna tabla existente: solo
-- la tabla que creó el script 226.
-- =====================================================================
--
-- POR QUÉ
--
-- El 226 reconstruyó el libro desde la auditoría. En cuatro órdenes la
-- reconstrucción repartió la misma salida entre VARIOS pedidos, así que el libro
-- les atribuyó en conjunto más unidades de las que la orden llevó según su propio
-- detalle (`detalleoc`). Son 5 filas y 150 unidades, de 15.624 combinaciones de
-- orden y producto: las otras 15.393 verificables cuadran exactas.
--
-- QUÉ SE QUITA Y POR QUÉ CUADRA
-- En los cuatro casos, al retirar la fila señalada el resto suma EXACTAMENTE lo
-- que la orden llevó, que es la prueba de que esa fila es la sobrante:
--
--  1) AVI202609309736 llevó 70 + 2 de Insuperable Panadería Papel 50 kg.
--     El libro atribuía 70 al pedido 12136, 70 al 12150 y 2 al 12139 (142 de 72).
--     Se quita la del 12150: ese pedido ya tiene sus 150 completas por la orden
--     AVI202610019757 (pidió 150 y están cargadas). Quedan 70 + 2 = 72 exacto.
--     Y de paso el pedido 12150 deja de aparecer como "salió más de lo pedido".
--
--  2) IND202609088894 llevó 30 de Indupan Panificación 50 kg.
--     El libro atribuía 30 a los pedidos 11111, 11112 y 11113 (90 de 30).
--     Se quitan las de 11111 y 11112: los dos están sin despachar (0 cargadas,
--     sin orden asignada); el 11113 sí apunta a esta orden y tiene sus 30
--     cargadas. Queda 30 exacto.
--
--  3) AVI202607317489 llevó 645 + 25 de Insuperable Panadería Papel 50 kg.
--     El libro atribuía 645 y 25 al pedido 9366 y 15 al 9299 (685 de 670).
--     Se quita la del 9299: esa línea apunta a OTRA orden (AVI202607317512).
--     Quedan 645 + 25 = 670 exacto, y el pedido 9299 deja de figurar con exceso.
--
--  4) MOL202607307397 llevó 5 de Macarrón G 250gr.
--     El libro atribuía 5 a dos líneas del mismo pedido 9266 (10 de 5).
--     Se quita la de la línea que no recibió nada (transid 18711, 0 cargadas).
--     Queda 5 exacto.
--
-- QUÉ NO SE TOCA
-- Tres líneas viejas de ID1 (pedidos 913 de enero, 2970 y 3345 de marzo) donde la
-- línea dice más unidades de las que la orden registró. Vienen del dato que ya
-- tenía la propia línea, no de la reconstrucción; los tres pedidos están
-- entregados y cerrados desde hace meses. Por decisión de gerencia (2026-10-07)
-- se dan por cerrados: a hoy no tienen validez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar esta salida. Deben salir exactamente 5 filas.
-- ---------------------------------------------------------------------
select l.id, l.id_empresa, l.idpedido, l.transid, l.ocargue, l.unidades, l.origen, d.producto,
       d.unidades as pedidas, d.unidadescargadas as cargadas, d.ocargue as orden_de_la_linea, d.estado
from public.pedidodetalle_ocargue l
join public.pedidosdetalle d on d.transid = l.transid
where (l.ocargue, l.transid) in (
        ('AVI202609309736', 25114),
        ('IND202609088894', 22768),
        ('IND202609088894', 22770),
        ('AVI202607317489', 18788),
        ('MOL202607307397', 18711))
order by l.ocargue, l.transid;

-- Lo que queda en cada una de esas cuatro órdenes después de quitar: debe ser
-- igual a lo que la orden llevó (72, 30, 670 y 5).
select l.ocargue, sum(l.unidades) as quedaria
from public.pedidodetalle_ocargue l
where l.ocargue in ('AVI202609309736','IND202609088894','AVI202607317489','MOL202607307397')
  and (l.ocargue, l.transid) not in (
        ('AVI202609309736', 25114),
        ('IND202609088894', 22768),
        ('IND202609088894', 22770),
        ('AVI202607317489', 18788),
        ('MOL202607307397', 18711))
group by l.ocargue order by l.ocargue;

-- ---------------------------------------------------------------------
-- PASO 2 — CORRECCIÓN.
-- ---------------------------------------------------------------------
begin;

do $limpiar$
declare
  v_filas int;
begin
  select count(*) into v_filas
    from public.pedidodetalle_ocargue
   where (ocargue, transid) in (
          ('AVI202609309736', 25114),
          ('IND202609088894', 22768),
          ('IND202609088894', 22770),
          ('AVI202607317489', 18788),
          ('MOL202607307397', 18711));
  if v_filas = 0 then
    raise notice 'Las 5 atribuciones ya estaban quitadas: no hay nada que hacer.';
    return;
  end if;
  if v_filas <> 5 then
    raise exception 'Se esperaban 5 filas por quitar y hay %: se deshace todo y hay que revisar.', v_filas;
  end if;

  delete from public.pedidodetalle_ocargue
   where (ocargue, transid) in (
          ('AVI202609309736', 25114),
          ('IND202609088894', 22768),
          ('IND202609088894', 22770),
          ('AVI202607317489', 18788),
          ('MOL202607307397', 18711));
  raise notice 'Atribuciones retiradas: 5 (150 unidades)';
end
$limpiar$;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS.
-- ---------------------------------------------------------------------
-- 3a. Las cuatro órdenes deben quedar con lo que llevaron: 72, 30, 670 y 5.
select l.ocargue, sum(l.unidades) as atribuido
from public.pedidodetalle_ocargue l
where l.ocargue in ('AVI202609309736','IND202609088894','AVI202607317489','MOL202607307397')
group by l.ocargue order by l.ocargue;

-- 3b. Los pedidos 12150 y 9299 ya no deben figurar con exceso.
with libro as (
  select transid, sum(unidades) as segun_ordenes from public.pedidodetalle_ocargue group by transid
)
select d.id_empresa, d.idpedido, d.producto, d.unidades as pedidas, l.segun_ordenes as salio,
       l.segun_ordenes - d.unidades as exceso
from libro l join public.pedidosdetalle d on d.transid = l.transid
where l.segun_ordenes > d.unidades + 0.01
order by (l.segun_ordenes - d.unidades) desc;
-- Esperado: 9 filas (antes 11). Las de ID2 12150 y 9299 desaparecen.

-- 3c. Total del libro.
select origen, count(*) as filas, sum(unidades) as unidades
from public.pedidodetalle_ocargue group by origen order by origen;
