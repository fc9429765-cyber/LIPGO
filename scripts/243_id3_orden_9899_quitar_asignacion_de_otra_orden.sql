
-- =====================================================================
-- 243_id3_orden_9899_quitar_asignacion_de_otra_orden.sql
--
-- ID3 (Molinos). Quita de la orden MOL202610069899 una asignación de lote que
-- NO es suya: es, línea por línea, la de la orden MOL202610069896.
--
-- Autorizado por gerencia el 2026-10-07 ("organiza invtrans con esto").
-- Correcciones POR LLAVE PRIMARIA, con estado esperado verificado antes,
-- antes/después impreso y comprobación de coherencia al final. Idempotente.
-- =====================================================================
--
-- QUÉ PASÓ
--
-- El 6 de octubre, la pantalla de Asignación de Lote guardaba el NÚMERO de orden
-- al instante y la CANASTA de productos en una carga asíncrona que no limpiaba la
-- anterior. La orden 9896 se creó a las 08:47 con 23 líneas y 1.011 unidades; la
-- 9899 a las 09:12 con 4 líneas y 330. A las 10:00 se guardó la canasta de la 9896
-- bajo el número de la 9899, y a las 11:53 la misma canasta bajo la 9896.
-- Resultado: 1.011 unidades salieron DOS VECES del inventario de ID3.
--
-- La prueba es total: `historicolotes` de la 9899 tiene las 24 filas de la 9896,
-- con sus mismos lotes, ubicaciones y CLIENTES (D1 SAS e INVERSIONES EL MERCADEO),
-- solo con la placa de la 9899 (WPS443). La báscula lo confirma: WPS443 pesó
-- 3,52 t, consistente con sus 330 unidades; WHO689, el de la 9896, pesó 10,851 t.
--
-- POR QUÉ SE QUITA TODO Y NO SE RECORTA
-- Ninguna parte de esa asignación es de la 9899: ni los lotes ni los clientes.
-- Recortarla a las cantidades autorizadas dejaría una porción del picking de otra
-- orden atribuida a un cliente que no es. La orden 9899 queda SIN asignación para
-- que el coordinador la haga contra sus 4 líneas reales, por el flujo normal, que
-- desde hoy ya tiene el candado del servidor.
--
-- EFECTO EN EL SALDO, DICHO CLARO
-- Al correr esto, ID3 recupera las 1.011 unidades que se descontaron de más. Lo
-- que el camión WPS443 sí se llevó (unas 330) queda SIN descontar hasta que el
-- coordinador rehaga la asignación y el picking de la 9899. O sea: después de
-- esto el sistema muestra de más lo de ese camión, y ese es el pendiente a cerrar.
-- Antes de esto mostraba de MENOS unas 681 unidades.
--
-- QUÉ NO SE TOCA
-- La orden 9896 y sus 13 movimientos y 24 filas de historial quedan intactos:
-- cuadran exactos con su propio detalle autorizado. No se toca el pedido 12349
-- (sus 330 unidades están bien atribuidas), ni las básculas, ni los auxiliares,
-- ni la factura, ni el estado de la orden, ni ningún otro proyecto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar estas cuatro salidas.
-- ---------------------------------------------------------------------

-- 1a. Lo que la orden 9899 AUTORIZÓ: 4 líneas, 330 unidades.
select d.id, d.numeroorden, d.producto, d.cantidad, d.cliente
from public.detalleoc d
where d.idorden = 9899
order by d.id;

-- 1b. Lo que hay en invtrans bajo la 9899: 13 movimientos, 1.011 unidades.
select i.id, i.nombreproducto, i.cantidad, i.lote, i.location, i.status,
       i.cod_movimiento, i.origen, i.creado, i.creadopor
from public.invtrans i
where i.ocargue = 'MOL202610069899'
order by i.id;

-- 1c. La prueba del cruce: lo asignado a la 9899 contra lo asignado a la 9896.
-- Las dos columnas deben dar 1.011 y coincidir producto por producto.
select coalesce(a.producto, b.producto) as producto,
       a.asignado_9899, b.asignado_9896
from (select producto, sum(cantidad) as asignado_9899
        from public.historicolotes where ordendecargue = 'MOL202610069899' group by producto) a
full join (select producto, sum(cantidad) as asignado_9896
        from public.historicolotes where ordendecargue = 'MOL202610069896' group by producto) b
  on b.producto = a.producto
order by 1;

-- 1d. Saldo de hoy en los lotes y ubicaciones afectados.
select s.nombreproducto, s.lote, s.location, s.stock_actual
from public.saldoinvdetalle s
where s.idempresa = 3
  and (s.nombreproducto, s.lote, s.location) in (
        select i.nombreproducto, i.lote, i.location
        from public.invtrans i where i.ocargue = 'MOL202610069899')
order by s.nombreproducto, s.lote, s.location;

-- ---------------------------------------------------------------------
-- PASO 2 — CORRECCIÓN. Todo o nada, con candados antes y después.
-- ---------------------------------------------------------------------
begin;

do $corregir$
declare
  v_invtrans    int;
  v_und         numeric;
  v_historico   int;
  v_und_hl      numeric;
  v_9896_mov    int;
  v_9896_und    numeric;
  v_negativos   int;
  v_negativos_0 int;
begin
  -- Foto de los negativos que ID3 YA tenía (son 2 y vienen de otro asunto):
  -- al final no puede haber más que estos.
  select count(*) into v_negativos_0
    from public.saldoinvdetalle where idempresa = 3 and stock_actual < 0;

  -- ¿Ya se corrigió?
  select count(*), coalesce(sum(cantidad), 0) into v_invtrans, v_und
    from public.invtrans where ocargue = 'MOL202610069899';
  if v_invtrans = 0 then
    raise notice 'La orden MOL202610069899 ya no tiene movimientos de inventario: nada que hacer.';
    return;
  end if;

  -- ESTADO ESPERADO. Si algo no calza, no se toca nada.
  if v_invtrans <> 13 or v_und <> 1011 then
    raise exception 'Se esperaban 13 movimientos y 1011 unidades en MOL202610069899, y hay % movimientos con % unidades: se deshace todo y hay que revisar.', v_invtrans, v_und;
  end if;

  select count(*), coalesce(sum(cantidad), 0) into v_historico, v_und_hl
    from public.historicolotes where ordendecargue = 'MOL202610069899';
  if v_historico <> 24 or v_und_hl <> 1011 then
    raise exception 'Se esperaban 24 filas de historicolotes y 1011 unidades en MOL202610069899, y hay % filas con % unidades: se deshace todo.', v_historico, v_und_hl;
  end if;

  -- La orden BUENA tiene que estar completa ANTES de tocar nada: si la 9896 no
  -- está entera, este diagnóstico no se sostiene y no se corrige.
  select count(*), coalesce(sum(cantidad), 0) into v_9896_mov, v_9896_und
    from public.invtrans where ocargue = 'MOL202610069896';
  if v_9896_mov <> 13 or v_9896_und <> 1011 then
    raise exception 'La orden MOL202610069896 debería tener sus 13 movimientos y 1011 unidades, y tiene % con %: se deshace todo.', v_9896_mov, v_9896_und;
  end if;

  -- Solo de ID3 y solo de esta orden, nunca por filtros amplios.
  if exists (select 1 from public.invtrans
              where ocargue = 'MOL202610069899' and (idempresa <> 3 or origen <> 'orden de cargue')) then
    raise exception 'Hay movimientos de MOL202610069899 que no son de ID3 o no vienen de la orden de cargue: se deshace todo.';
  end if;

  -- 2a. Fuera los 13 movimientos de inventario que no son de esta orden.
  delete from public.invtrans where ocargue = 'MOL202610069899';
  raise notice 'invtrans: 13 movimientos retirados (1.011 unidades devueltas al saldo de ID3).';

  -- 2b. Fuera las 24 filas del historial de asignación (la canasta de la 9896).
  delete from public.historicolotes where ordendecargue = 'MOL202610069899';
  raise notice 'historicolotes: 24 filas retiradas.';

  -- 2c. La orden vuelve a estar disponible para asignarle su lote de verdad.
  -- `getAvailableLoadOrders` solo lista órdenes con horalote nulo, y el picking
  -- que se registró era el de la canasta equivocada.
  update public.cabeceraoc
     set horalote = null,
         horapicking = null
   where id = 9899 and ordendecargue = 'MOL202610069899' and idempresa = 3;
  raise notice 'cabeceraoc 9899: horalote y horapicking en blanco. La orden vuelve a Asignacion de Lote.';

  -- COHERENCIA FINAL.
  if exists (select 1 from public.invtrans where ocargue = 'MOL202610069899') then
    raise exception 'Quedaron movimientos en MOL202610069899: se deshace todo.';
  end if;

  select count(*), coalesce(sum(cantidad), 0) into v_9896_mov, v_9896_und
    from public.invtrans where ocargue = 'MOL202610069896';
  if v_9896_mov <> 13 or v_9896_und <> 1011 then
    raise exception 'Se alteró la orden MOL202610069896 (quedo con % movimientos y % unidades): se deshace todo.', v_9896_mov, v_9896_und;
  end if;

  select count(*) into v_negativos
    from public.saldoinvdetalle where idempresa = 3 and stock_actual < 0;
  if v_negativos > v_negativos_0 then
    raise exception 'ID3 pasó de % a % lotes en negativo: se deshace todo.', v_negativos_0, v_negativos;
  end if;

  raise notice 'LISTO. Falta que el coordinador rehaga la asignación y el picking de MOL202610069899 contra sus 4 líneas (330 unidades).';
end
$corregir$;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS. Comprobaciones.
-- ---------------------------------------------------------------------

-- 3a. La 9899 debe quedar en cero y lista para asignar; la 9896 intacta.
select 'MOL202610069899' as orden,
       (select count(*) from public.invtrans where ocargue = 'MOL202610069899')        as movimientos,
       (select count(*) from public.historicolotes where ordendecargue = 'MOL202610069899') as historial,
       (select horalote::text from public.cabeceraoc where id = 9899)                   as horalote
union all
select 'MOL202610069896',
       (select count(*) from public.invtrans where ocargue = 'MOL202610069896'),
       (select count(*) from public.historicolotes where ordendecargue = 'MOL202610069896'),
       (select horalote::text from public.cabeceraoc where id = 9896);
-- Esperado: 9899 con 0, 0 y horalote vacío. 9896 con 13, 24 y su hora.

-- 3b. Saldo nuevo de los lotes afectados (deben haber subido).
select s.nombreproducto, s.lote, s.location, s.stock_actual
from public.saldoinvdetalle s
where s.idempresa = 3
  and (s.nombreproducto, s.lote, s.location) in (
        ('PT ESPAGUETI CAPRISSIMA 1000GR*12PQ','20260914','A17'),
        ('PT CONCHAS 250*24','20260918','A6'),
        ('PT ESPAGUETI 1000GR*12PQ','20260813','A5'),
        ('PT ESPAGUETI 250GR*24PQ','20260829','A1'),
        ('PT ESPAGUETI 500GR*24PQ','20260825','A22'),
        ('PT FIDEO 250*24PQ','20260915','A7'),
        ('PT HARINA PREC MAIZ 20 KG CATEDRAL','20260908','A12'),
        ('PT HARINA PREC MAIZ 24LB BLANCA','20260901','A14'),
        ('PT LA NIEVE 25LB','20260914','A2'),
        ('PT LA NIEVE 25LB LEUDANTE','20260903','E38'),
        ('PT MACARRON C.250GR*24PQ','20260920','A8'),
        ('PT TORNILLOS 250GR*24PQ','20260806','A3'),
        ('PT TORNILLOS 250GR*24PQ','20260807','A3'))
order by s.nombreproducto, s.lote, s.location;

-- 3c. Negativos de ID3: deben seguir siendo los 2 de antes, ni uno más.
select nombreproducto, lote, location, stock_actual
from public.saldoinvdetalle
where idempresa = 3 and stock_actual < 0
order by stock_actual;

-- 3d. El radar de "salió más de lo que la orden autorizó" ya no debe ver la 9899.
select ocargue, producto, autorizado, despachado, estado_alerta
from public.v_orden_vs_salidas
where ocargue in ('MOL202610069899','MOL202610069896')
  and estado_alerta in ('SALIO_MAS','FUERA_DE_LA_ORDEN')
order by ocargue, producto;
-- Esperado: 0 filas.
