
-- =====================================================================
-- 244_id3_orden_9899_devolver_a_picking.sql
--
-- ID3. La orden MOL202610069899 ya tiene su asignación de lote CORRECTA (la rehizo
-- el coordinador el 2026-10-07 a las 12:44), pero no puede hacerse el Picking.
-- Este script quita el único campo que lo bloquea.
--
-- Correr DESPUÉS del 243. Idempotente. Toca UN campo de UNA fila, por llave primaria.
-- =====================================================================
--
-- POR QUÉ HACE FALTA
--
-- La pantalla de Picking lista las órdenes con `fincargue IS NULL` y `horalote` no nulo
-- (lib/picking-actions.ts). La orden 9899 conserva `fincargue = 11:52:18` del flujo
-- original, el del 6 de octubre con la canasta equivocada, así que NO aparece en Picking
-- y sus 6 líneas se quedan en "por descontar" para siempre.
--
-- El 243 dejó en blanco `horalote` y `horapicking` a propósito, para que la orden volviera
-- a Asignación de Lote, pero no `fincargue`: el alcance se dejó al mínimo. Hecha ya la
-- reasignación, este es el campo que falta.
--
-- QUÉ PASA SI NO SE CORRE
--  · Las 330 unidades quedan como RESERVA, no como despacho: el inventario las aparta pero
--    nunca registra la salida aprobada.
--  · En 3 días el aviso nocturno la reporta como "reserva sin picking".
--  · Una reserva pendiente BLOQUEA el Conteo total del mes.
--  · El radar de orden vs salidas ve la orden sin salida.
--
-- EL SALDO NO CAMBIA CON ESTE SCRIPT. `saldoinvdetalle.stock_actual` ya descuenta las filas
-- "por descontar", así que ID3 ya refleja las 330 unidades fuera (68.430 und). Lo que falta
-- es el ESTADO del proceso, no el número.
--
-- QUÉ NO SE TOCA
-- Ni cantidades, ni lotes, ni ubicaciones, ni el pedido, ni la báscula, ni los auxiliares,
-- ni la factura, ni `iniciocargue`, ni el muelle, ni `status`, ni ningún otro proyecto.
-- Las 7 fotos de `fotospicking` se CONSERVAN: son el rastro de lo que pasó el 6 de octubre.
-- Al rehacer el picking el coordinador tomará las nuevas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES.
-- ---------------------------------------------------------------------
select id, ordendecargue, idempresa, tipooperacion, placa, conductor,
       iniciocargue, fincargue, horalote, horapicking, status
from public.cabeceraoc
where id = 9899;
-- Esperado: fincargue 11:52:18, horalote 12:44:48, horapicking vacío.

-- Las 6 líneas que esperan el picking: 330 unidades, todas "por descontar".
select id, nombreproducto, cantidad, lote, location, status, cod_movimiento, creado, creadopor
from public.invtrans
where ocargue = 'MOL202610069899'
order by id;

-- ---------------------------------------------------------------------
-- PASO 2 — CORRECCIÓN.
-- ---------------------------------------------------------------------
begin;

do $devolver$
declare
  v_lineas    int;
  v_und       numeric;
  v_aprobadas int;
  v_fincargue text;
  v_horalote  text;
begin
  select fincargue::text, horalote::text into v_fincargue, v_horalote
    from public.cabeceraoc where id = 9899 and ordendecargue = 'MOL202610069899' and idempresa = 3;
  if not found then
    raise exception 'No existe la orden 9899 MOL202610069899 en ID3: se deshace todo.';
  end if;

  if v_fincargue is null then
    raise notice 'La orden ya tiene fincargue en blanco: nada que hacer.';
    return;
  end if;

  if v_horalote is null then
    raise exception 'La orden no tiene asignación de lote (horalote vacío): primero hay que asignarle el lote. Se deshace todo.';
  end if;

  -- ESTADO ESPERADO: su asignación nueva, 6 líneas y 330 unidades, ninguna aprobada.
  select count(*), coalesce(sum(cantidad), 0),
         count(*) filter (where status ilike 'apr%')
    into v_lineas, v_und, v_aprobadas
    from public.invtrans where ocargue = 'MOL202610069899';

  if v_aprobadas > 0 then
    raise notice 'La orden ya tiene % líneas aprobadas: el picking ya se hizo, no se toca nada.', v_aprobadas;
    return;
  end if;

  if v_lineas <> 6 or v_und <> 330 then
    raise exception 'Se esperaban 6 líneas y 330 unidades asignadas a MOL202610069899, y hay % líneas con % unidades: se deshace todo y hay que revisar la asignación.', v_lineas, v_und;
  end if;

  -- Lo que la orden autorizó tiene que seguir siendo 330: si no, no es este el caso.
  if (select coalesce(sum(cantidad), 0) from public.detalleoc where idorden = 9899) <> 330 then
    raise exception 'El detalle de la orden 9899 ya no suma 330 unidades: se deshace todo.';
  end if;

  update public.cabeceraoc
     set fincargue = null
   where id = 9899 and ordendecargue = 'MOL202610069899' and idempresa = 3;

  raise notice 'cabeceraoc 9899: fincargue en blanco (estaba en %). La orden vuelve a Picking con sus 6 lineas y 330 unidades.', v_fincargue;

  -- COHERENCIA FINAL: tiene que quedar visible en Picking y no haber tocado las líneas.
  if not exists (
    select 1 from public.cabeceraoc
     where id = 9899 and idempresa = 3 and tipooperacion = 'Cargue'
       and fincargue is null and horalote is not null) then
    raise exception 'La orden no quedó en condiciones de aparecer en Picking: se deshace todo.';
  end if;

  select count(*), coalesce(sum(cantidad), 0) into v_lineas, v_und
    from public.invtrans where ocargue = 'MOL202610069899';
  if v_lineas <> 6 or v_und <> 330 then
    raise exception 'Se alteraron las líneas de la orden (quedaron % con %): se deshace todo.', v_lineas, v_und;
  end if;
end
$devolver$;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS.
-- ---------------------------------------------------------------------

-- 3a. fincargue vacío, horalote con valor, horapicking vacío.
select id, ordendecargue, iniciocargue, fincargue, horalote, horapicking, status
from public.cabeceraoc
where id = 9899;

-- 3b. La orden debe aparecer en esta lista: es el mismo filtro de la pantalla de Picking.
select id, ordendecargue, placa, horalote, horapicking
from public.cabeceraoc
where idempresa = 3
  and tipooperacion = 'Cargue'
  and fincargue is null
  and horalote is not null
order by ordendecargue desc;
-- Esperado: la MOL202610069899 entre ellas.

-- 3c. Sus 6 líneas intactas, esperando el picking.
select id, nombreproducto, cantidad, lote, location, status
from public.invtrans
where ocargue = 'MOL202610069899'
order by id;
-- Esperado: 6 filas, 330 unidades, todas "por descontar".

-- ---------------------------------------------------------------------
-- LO QUE SIGUE, Y LO HACE LA OPERACIÓN, NO UN SCRIPT
-- ---------------------------------------------------------------------
-- 1. El coordinador entra a Picking, abre la MOL202610069899, verifica las 6 líneas
--    (producto, cantidad, ubicación y lote) y pulsa Confirmar verificación. Ahí las
--    6 filas pasan de "por descontar" a "aprobado" y la salida queda registrada.
-- 2. Se finaliza el cargue como siempre, que vuelve a poner `fincargue`.
-- 3. Comprobación final: esta consulta debe dar 6 filas aprobadas y 330 unidades.
--      select count(*), sum(cantidad) from public.invtrans
--       where ocargue = 'MOL202610069899' and status ilike 'apr%';
