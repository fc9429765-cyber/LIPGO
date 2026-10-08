
-- =====================================================================
-- 254_id2_borrar_asignacion_huerfana_AVI202609289629.sql
--
-- Borrar las 5 líneas de asignación de lote de una orden que ya no existe.
--
-- Autorizado por gerencia el 2026-10-07: "si la orden no existe y no movió inventario,
-- elimínala, siempre y cuando no vaya a descuadrar el inventario por lotes que tenemos
-- ahora".
-- =====================================================================
--
-- LA HISTORIA COMPLETA, RECONSTRUIDA DE LA AUDITORÍA (horas de Bogotá)
--
--   28-sep 10:13  se crea la orden AVI202609289629 (ID2, placa WGW575, 4 líneas, 186 und)
--   28-sep 10:23  asignación de lote: 5 líneas en `historicolotes` + 3 reservas en
--                 `invtrans` como "por descontar" (1 + 89 + 96 = 186)
--   28-sep 11:57  Jairo Torres verifica el picking: las 3 reservas pasan a "aprobado" y
--                 el inventario SE DESCUENTA
--   28-sep 16:51:37  se BORRA la orden (`cabeceraoc` + sus 4 líneas de `detalleoc`)
--   28-sep 16:51:51  catorce segundos después se borran las 3 transacciones APROBADAS de
--                 `invtrans`, con lo que las 186 unidades VUELVEN al inventario
--    7-oct        gerencia anula por error la asignación desde Historial y se restituye
--                 con el script 249
--
-- Es decir: la asignación quedó huérfana desde el 28 de septiembre, porque el borrado de
-- la orden se llevó la cabecera, el detalle y el inventario, pero no la asignación.
--
-- POR QUÉ BORRARLA NO MUEVE NI UNA UNIDAD
--
-- El inventario sale de `invtrans` y se resume en `saldoinvdetalle`. `historicolotes` es
-- el DOCUMENTO de la asignación: ninguna vista, ninguna función y ningún cálculo de saldo
-- lo usa (verificado en todo el repositorio el 2026-10-07). Esa orden hoy tiene CERO
-- transacciones de inventario, así que no hay nada que devolver ni que descontar.
--
-- Aun así el script toma la foto de los lotes antes y después, y si algo se moviera, se
-- deshace todo.
--
-- LO QUE ESTE SCRIPT NO HACE, Y HAY QUE MIRAR APARTE
--
-- El 28 de septiembre el camión WGW575 cargó (hay PDF de picking y hora de fin de cargue
-- a las 11:58) y el sistema devolvió esas 186 unidades al inventario al borrar la orden.
-- Si la mercancía salió de verdad, el saldo de ID2 quedó alto en 186 unidades desde ese
-- día. ESO NO SE TOCA AQUÍ: el inventario de un proyecto no se mueve sin instrucción
-- expresa, y además el Conteo total del 1 de octubre pudo haberlo absorbido.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar estas tres salidas.
-- ---------------------------------------------------------------------

-- 1a. Las 5 líneas que se van a borrar.
select id, idempresa, ordendecargue, producto, lote, location, cantidad, cliente, fecha, placa
from public.historicolotes
where id in (24816, 24817, 24818, 24819, 24820)
order by id;
-- Esperado: 5 filas, todas de ID2, todas con ordendecargue = 'AVI202609289629', placa WGW575.

-- 1b. La orden NO existe por ningún lado.
select (select count(*) from public.cabeceraoc where ordendecargue = 'AVI202609289629') as en_cabeceraoc,
       (select count(*) from public.detalleoc  where numeroorden   = 'AVI202609289629') as en_detalleoc,
       (select count(*) from public.invtrans   where ocargue       = 'AVI202609289629') as en_invtrans;
-- Esperado: 0 · 0 · 0. Si alguno no es 0, NO siga: la orden revivió y hay que mirarla.

-- 1c. La foto del saldo de los lotes que toca la asignación.
select nombreproducto, lote, location, stock_actual, stock_disp, stock_res
from public.saldoinvdetalle
where idempresa = 2
  and (lote = '20260925' and nombreproducto = 'PT LA INSUPERABLE PANADERIA 25KG'
    or lote = '20260822' and nombreproducto = 'PT LA INSUPERABLE PANADERIA PAPEL 50KG')
order by nombreproducto, location;
-- Medido el 2026-10-07:
--   PANADERIA 25KG · 20260925 · V27 · 577
--   PANADERIA PAPEL 50KG · 20260822 · V25, V26, V31, V32, V4, V7, V8 · todos en 0

-- ---------------------------------------------------------------------
-- PASO 2 — EL BORRADO.
-- ---------------------------------------------------------------------
begin;

do $borrar$
declare
  v_ids       int[] := array[24816, 24817, 24818, 24819, 24820];
  v_cuantas   int;
  v_otra      int;
  v_antes     numeric;
  v_despues   numeric;
  v_borradas  int;
begin
  -- Las 5 tienen que estar, ser de ID2 y ser de ESA orden. Si no, no se toca nada.
  select count(*) into v_cuantas
    from public.historicolotes
   where id = any(v_ids) and idempresa = 2 and btrim(ordendecargue) = 'AVI202609289629';
  if v_cuantas <> 5 then
    raise exception 'Se esperaban 5 lineas de ID2 de la orden AVI202609289629 y hay %: se deshace todo.', v_cuantas;
  end if;

  -- Y no puede quedar ninguna otra linea de esa orden por fuera de esos 5 ids.
  select count(*) into v_otra
    from public.historicolotes
   where btrim(ordendecargue) = 'AVI202609289629' and not (id = any(v_ids));
  if v_otra <> 0 then
    raise exception 'Hay % lineas mas de esa orden fuera de la lista: se deshace todo para revisarlas.', v_otra;
  end if;

  -- CANDADO DE INVENTARIO: si la orden tuviera cualquier transaccion, esto no se hace.
  -- Borrar la asignacion de una orden que SI movio inventario dejaria el movimiento sin
  -- su documento de respaldo, que es justo lo contrario de lo que se busca.
  if exists (select 1 from public.invtrans where btrim(ocargue) = 'AVI202609289629') then
    raise exception 'Esa orden SI tiene transacciones de inventario: no se borra la asignacion. Se deshace todo.';
  end if;
  if exists (select 1 from public.cabeceraoc where btrim(ordendecargue) = 'AVI202609289629') then
    raise exception 'La orden SI existe en cabeceraoc: no es huerfana. Se deshace todo.';
  end if;
  if exists (select 1 from public.detalleoc where btrim(numeroorden) = 'AVI202609289629') then
    raise exception 'La orden SI tiene detalle: no es huerfana. Se deshace todo.';
  end if;

  -- Foto del saldo de los dos lotes, antes.
  select coalesce(sum(stock_actual), 0) into v_antes
    from public.saldoinvdetalle
   where idempresa = 2 and lote in ('20260925', '20260822');

  delete from public.historicolotes where id = any(v_ids);
  get diagnostics v_borradas = row_count;
  if v_borradas <> 5 then
    raise exception 'Se borraron % lineas en vez de 5: se deshace todo.', v_borradas;
  end if;

  -- Y la misma foto, despues. Tiene que ser idéntica.
  select coalesce(sum(stock_actual), 0) into v_despues
    from public.saldoinvdetalle
   where idempresa = 2 and lote in ('20260925', '20260822');
  if v_antes is distinct from v_despues then
    raise exception 'El saldo de los lotes cambio de % a %: se deshace todo.', v_antes, v_despues;
  end if;

  raise notice 'Borradas % lineas de asignacion huerfana. El saldo de los lotes sigue en %.', v_borradas, v_despues;
end
$borrar$;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS.
-- ---------------------------------------------------------------------

-- 3a. Ya no queda rastro de esa orden en ninguna parte.
select (select count(*) from public.historicolotes where ordendecargue = 'AVI202609289629') as asignacion,
       (select count(*) from public.cabeceraoc     where ordendecargue = 'AVI202609289629') as orden,
       (select count(*) from public.detalleoc      where numeroorden   = 'AVI202609289629') as detalle,
       (select count(*) from public.invtrans       where ocargue       = 'AVI202609289629') as inventario;
-- Esperado: 0 · 0 · 0 · 0.

-- 3b. El saldo de los lotes, igual que en el paso 1c.
select nombreproducto, lote, location, stock_actual, stock_disp, stock_res
from public.saldoinvdetalle
where idempresa = 2
  and (lote = '20260925' and nombreproducto = 'PT LA INSUPERABLE PANADERIA 25KG'
    or lote = '20260822' and nombreproducto = 'PT LA INSUPERABLE PANADERIA PAPEL 50KG')
order by nombreproducto, location;
-- Esperado: idéntico. PANADERIA 25KG · 20260925 · V27 sigue en 577.

-- 3c. ID2 no tiene ninguna otra asignación sin orden.
select h.ordendecargue, count(*) as lineas, min(h.fecha) as fecha
from public.historicolotes h
where h.idempresa = 2
  and not exists (select 1 from public.cabeceraoc c where btrim(c.ordendecargue) = btrim(h.ordendecargue))
group by h.ordendecargue
order by 3 desc;
-- Esperado: ninguna fila.
