
-- =====================================================================
-- 253_cerrar_pendiente_de_lo_ya_entregado.sql
--
-- Cerrar el pendiente de 8 líneas de pedido de ID2 que ya habían recibido MÁS de lo
-- que pidieron, pero seguían mostrando unidades por entregar.
--
-- Pedido por gerencia el 2026-10-07: "también debe coincidir la entrega parcial, lo
-- pendiente, con las órdenes que se entregaron a ese pedido... las órdenes entregadas le
-- restan las cantidades al pedido en cada producto que se despache hasta completarlo".
-- =====================================================================
--
-- LA REGLA, COMPROBADA EN LOS DATOS (2026-10-07)
--
-- Cada orden entregada le resta al pedido, por producto, hasta completarlo. De 20.036
-- líneas de pedido que ya recibieron al menos una orden:
--
--   · 20.028 cuadran: el contador de la línea es exactamente la suma de sus órdenes.
--   ·      8 NO cuadran, todas de ID2, y son todas de antes del 4 de octubre.
--   ·      0 líneas con pendiente negativo en toda la base.
--   ·      0 fallas en las 14.194 líneas que recibieron órdenes DESPUÉS del 4 de octubre,
--          cuando entró el tope duro y la acumulación por el libro de órdenes.
--
-- POR QUÉ FALLARON ESAS 8
--
-- Antes del 2026-10-04 la segunda orden SOBRESCRIBÍA el contador en vez de sumarle. El
-- pendiente volvía a su valor anterior, la pantalla seguía ofreciendo el pedido, y se le
-- generaba otra orden. Así, contra un pedido de 800 unidades llegaron a salir 1.955 en
-- ocho órdenes, y la línea seguía diciendo "540 pendientes".
--
-- QUÉ CORRIGE ESTE SCRIPT Y QUÉ NO
--
--   SÍ: el pendiente de esas 8 líneas queda en 0 y la línea queda cerrada, porque lo
--       pedido ya se entregó (de hecho, de más). Es lo único que quedaba abierto.
--   NO: no toca el inventario. Las unidades salieron de verdad, con su orden de cargue y
--       su picking; `invtrans` está bien y no se modifica.
--   NO: no toca el libro `pedidodetalle_ocargue`. El exceso realmente ocurrió y tiene que
--       quedar registrado para siempre: ahí está, orden por orden.
--   NO: no cambia el `estado` del encabezado de ningún pedido, para no mover ninguna
--       métrica de ID2. Los 8 ya están en estado final (6 los cerró la depuración de
--       ayer como "entrega parcial", 2 ya estaban en "entregado").
--
-- LO QUE HAY QUE DECIDIR APARTE (no se hace aquí)
--
-- Esos 6 quedaron con el motivo "Vencido sin gestión", y eso es falso: no se vencieron
-- sin gestión, se entregaron de más. Este script le AÑADE la verdad al motivo sin borrar
-- lo que escribió la depuración autorizada. Si gerencia quiere además reclasificarlos de
-- "entrega parcial" a "entregado", eso mueve las métricas de cumplimiento de ID2 y se
-- hace en un paso aparte, con su decisión.
--
-- CORRECCIÓN POR LLAVE PRIMARIA, una por una (regla de gerencia): se nombran los 8
-- `transid` explícitamente, se verifica el estado esperado antes, y si algo no cuadra se
-- deshace todo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar esta salida.
-- ---------------------------------------------------------------------
select d.transid,
       d.idpedido,
       d.producto,
       d.unidades                as pedidas,
       d.unidadescargadas        as contador_hoy,
       d.unidadespendientes      as pendiente_hoy,
       d.estado                  as estado_linea,
       (select sum(l.unidades) from public.pedidodetalle_ocargue l where l.transid = d.transid)      as libro_suma,
       (select count(distinct l.ocargue) from public.pedidodetalle_ocargue l where l.transid = d.transid) as libro_ordenes,
       c.estado                  as estado_pedido,
       c.motivo_no_entrega
from public.pedidosdetalle d
join public.pedidoscabecera c on c.idpedido = d.idpedido
where d.transid in (19866, 19998, 20043, 20371, 20538, 22525, 22764, 24807)
order by d.transid;

-- Esperado, exactamente:
--   transid 19866 · pedido  9827 · pedidas  700 · contador  33 · pendiente 667 · libro  721 en 3 órdenes
--   transid 19998 · pedido  9876 · pedidas 1000 · contador 502 · pendiente 498 · libro 1292 en 2 órdenes
--   transid 20043 · pedido  9899 · pedidas  800 · contador 260 · pendiente 540 · libro 1955 en 8 órdenes
--   transid 20371 · pedido 10056 · pedidas  200 · contador  50 · pendiente 150 · libro  250 en 4 órdenes
--   transid 20538 · pedido 10130 · pedidas  800 · contador 400 · pendiente 400 · libro 1320 en 5 órdenes
--   transid 22525 · pedido 11026 · pedidas 1000 · contador 688 · pendiente 312 · libro 1238 en 2 órdenes
--   transid 22764 · pedido 11108 · pedidas  800 · contador 400 · pendiente 400 · libro 1324 en 5 órdenes
--   transid 24807 · pedido 12013 · pedidas  800 · contador 400 · pendiente 400 · libro 1080 en 3 órdenes

-- ---------------------------------------------------------------------
-- PASO 2 — LA CORRECCIÓN.
-- ---------------------------------------------------------------------
begin;

do $cerrar$
declare
  -- Los 8 casos, uno por uno: transid, unidades pedidas que se esperan, y lo que el libro
  -- debe sumar. Si cualquiera de los tres no coincide con lo que hay hoy, no se toca nada.
  v_casos  int[][] := array[
    array[19866,  700,  721],
    array[19998, 1000, 1292],
    array[20043,  800, 1955],
    array[20371,  200,  250],
    array[20538,  800, 1320],
    array[22525, 1000, 1238],
    array[22764,  800, 1324],
    array[24807,  800, 1080]
  ];
  v_i          int;
  v_transid    int;
  v_pedidas    int;
  v_libro_esp  int;
  v_pedidas_ok numeric;
  v_libro_real numeric;
  v_pend       numeric;
  v_tocadas    int := 0;
begin
  for v_i in 1 .. array_length(v_casos, 1) loop
    v_transid   := v_casos[v_i][1];
    v_pedidas   := v_casos[v_i][2];
    v_libro_esp := v_casos[v_i][3];

    select d.unidades into v_pedidas_ok from public.pedidosdetalle d where d.transid = v_transid;
    if v_pedidas_ok is null then
      raise exception 'La linea % no existe: se deshace todo.', v_transid;
    end if;
    if v_pedidas_ok <> v_pedidas then
      raise exception 'La linea % pide % y se esperaba %: el dato cambio desde que se midio. Se deshace todo.', v_transid, v_pedidas_ok, v_pedidas;
    end if;

    select coalesce(sum(l.unidades), 0) into v_libro_real from public.pedidodetalle_ocargue l where l.transid = v_transid;
    if v_libro_real <> v_libro_esp then
      raise exception 'La linea %: el libro suma % y se esperaba %. Se deshace todo.', v_transid, v_libro_real, v_libro_esp;
    end if;

    -- CANDADO: esto SOLO cierra lo que ya se entregó de sobra. Si el libro no supera lo
    -- pedido, esta linea no es de este grupo y no se toca.
    if v_libro_real <= v_pedidas_ok then
      raise exception 'La linea % no recibio de mas (libro % <= pedidas %): no es de este grupo. Se deshace todo.', v_transid, v_libro_real, v_pedidas_ok;
    end if;

    -- El contador se deja en lo PEDIDO, no en lo que salio: `unidadespendientes` es una
    -- columna generada (unidades - unidadescargadas) y poner 1.955 contra 800 la dejaria
    -- en -1.155. Hoy no hay un solo pendiente negativo en toda la base y asi se queda.
    -- Lo que de verdad salio sigue en el libro de ordenes, orden por orden.
    update public.pedidosdetalle
       set unidadescargadas = v_pedidas_ok,
           estado           = 'cerrado'
     where transid = v_transid;

    select d.unidadespendientes into v_pend from public.pedidosdetalle d where d.transid = v_transid;
    if v_pend is distinct from 0 then
      raise exception 'La linea % quedo con pendiente % en vez de 0: se deshace todo.', v_transid, v_pend;
    end if;

    v_tocadas := v_tocadas + 1;
  end loop;

  if v_tocadas <> 8 then
    raise exception 'Se esperaban 8 lineas y se tocaron %: se deshace todo.', v_tocadas;
  end if;
  raise notice 'Cerradas % lineas. Ninguna quedo con pendiente.', v_tocadas;
end
$cerrar$;

-- El motivo sincero, AÑADIDO al que dejó la depuración autorizada (no se borra nada: esa
-- depuración se hizo con clave y tiene que seguir siendo legible).
update public.pedidoscabecera c
   set motivo_no_entrega = trim(both ' · ' from
         coalesce(c.motivo_no_entrega, '') || ' · ' ||
         'Corregido 2026-10-07 (script 253): el pedido ya habia recibido ' ||
         (select sum(l.unidades)::text from public.pedidodetalle_ocargue l where l.idpedido = c.idpedido) ||
         ' und de las ' ||
         (select sum(d.unidades)::text from public.pedidosdetalle d where d.idpedido = c.idpedido) ||
         ' pedidas, en ' ||
         (select count(distinct l.ocargue)::text from public.pedidodetalle_ocargue l where l.idpedido = c.idpedido) ||
         ' ordenes. Se cierra el pendiente; el detalle esta en pedidodetalle_ocargue.')
 where c.idpedido in (9827, 9876, 9899, 10056, 10130, 11026, 11108, 12013)
   and c.motivo_no_entrega not like '%script 253%';

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS.
-- ---------------------------------------------------------------------

-- 3a. Las 8 líneas, ya cerradas y en cero.
select d.transid, d.idpedido, d.unidades as pedidas, d.unidadescargadas as contador,
       d.unidadespendientes as pendiente, d.estado,
       (select sum(l.unidades) from public.pedidodetalle_ocargue l where l.transid = d.transid) as salio_de_verdad
from public.pedidosdetalle d
where d.transid in (19866, 19998, 20043, 20371, 20538, 22525, 22764, 24807)
order by d.transid;
-- Esperado: pendiente 0 y estado 'cerrado' en las 8. `salio_de_verdad` NO cambia.

-- 3b. Nadie quedó con pendiente negativo en toda la base.
select count(*) as pendientes_negativos
from public.pedidosdetalle
where unidadespendientes < 0;
-- Esperado: 0.

-- 3c. El universo de ID2 no se movió: lo pedido sigue siendo lo mismo.
select sum(unidades) as unidades_pedidas_id2, count(*) as lineas
from public.pedidosdetalle
where id_empresa = 2;
-- Esperado: 4.579 líneas y 774.829 unidades, medido el 2026-10-07 antes de correr esto.
-- Solo cambió lo CARGADO de 8 líneas; lo pedido no se toca.

-- 3d. El inventario no se tocó: ni una transacción de estos pedidos cambió.
select count(*) as ordenes_del_grupo
from public.cabeceraoc
where ordendecargue in (
  select distinct l.ocargue from public.pedidodetalle_ocargue l
  where l.idpedido in (9827, 9876, 9899, 10056, 10130, 11026, 11108, 12013)
);
-- Esperado: 32 órdenes, las mismas de antes. Este script no las toca.
