
-- =====================================================================
-- 249_id2_restituir_asignacion_AVI202609289629.sql
--
-- ID2 (Avimol). Devuelve las 5 filas de la asignación de lotes de la orden
-- AVI202609289629, que se anularon por error el 2026-10-07 a las 14:35 de Bogotá
-- desde el Historial de Asignación de Lotes.
--
-- Pedido por gerencia el 2026-10-07: "acabo de anular esta asignación de lotes por
-- error, la puedes restablecer, urgente".
--
-- Idempotente. Inserta por llave primaria, con los MISMOS ids que tenían.
-- NO TOCA INVENTARIO: la anulación no borró ningún movimiento de `invtrans` porque
-- esa orden no tenía ninguno (comprobado). El stock de ID2 no cambia ni un bulto.
-- =====================================================================
--
-- DE DÓNDE SALEN LOS DATOS
--
-- De la tabla `auditoria`, que guardó el contenido completo de cada fila antes de
-- borrarla. No se reconstruye nada de memoria: son los valores exactos, columna por
-- columna, incluido el enlace al PDF de la asignación.
--
-- QUÉ BORRÓ LA ANULACIÓN, EXACTAMENTE
-- `annulBatchAssignment` hace tres cosas: borra de `historicolotes`, borra de
-- `invtrans` y pone en blanco `horalote` de la orden. Aquí solo hubo que deshacer la
-- primera: las otras dos no afectaron nada, por lo que se explica abajo.
--
-- HALLAZGO QUE HAY QUE SABER ANTES DE CORRER ESTO
--
-- **La orden AVI202609289629 NO EXISTE.** Se buscó en `cabeceraoc`, `detalleoc`,
-- `invtrans`, `pedidoscabecera`, `pedidodetalle_ocargue` y `facturacion`: cero filas en
-- todas. La asignación ya estaba HUÉRFANA antes de que se anulara.
--
-- Lo que probablemente pasó: el 28 de septiembre se creó la orden, se le asignaron los
-- lotes, y después la orden se borró y se rehízo. Ese mismo día, con la MISMA placa
-- WGW575, existe la orden AVI202609289651. Al borrar la orden quedaron atrás sus filas
-- de `historicolotes`, y el Historial de Asignación de Lotes las sigue listando porque
-- lee de esa tabla, no de las órdenes.
--
-- Por eso restituir esto devuelve el historial tal como estaba, pero NO devuelve una
-- orden: sigue siendo un registro huérfano. Queda informado para que gerencia decida si
-- se conserva como rastro o se depura junto con los demás huérfanos que haya.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Debe salir vacío: eso es lo que se va a restituir.
-- ---------------------------------------------------------------------
select id, idempresa, ordendecargue, producto, cantidad, lote, location, cliente, fecha, placa, aprobadopor
from public.historicolotes
where ordendecargue = 'AVI202609289629'
order by id;
-- Esperado AHORA: 0 filas.

-- Los ids que se van a usar tienen que estar libres.
select id from public.historicolotes where id in (24816, 24817, 24818, 24819, 24820);
-- Esperado: 0 filas.

-- ---------------------------------------------------------------------
-- PASO 2 — RESTITUCIÓN.
-- ---------------------------------------------------------------------
begin;

do $restituir$
declare
  v_existen int;
  v_ocupados int;
begin
  select count(*) into v_existen
    from public.historicolotes where ordendecargue = 'AVI202609289629';
  if v_existen > 0 then
    raise notice 'La asignacion ya tiene % fila(s): nada que hacer.', v_existen;
    return;
  end if;

  select count(*) into v_ocupados
    from public.historicolotes where id in (24816, 24817, 24818, 24819, 24820);
  if v_ocupados > 0 then
    raise exception 'Alguno de los ids 24816-24820 ya esta ocupado por otra fila (% ocupados): se deshace todo y hay que revisar.', v_ocupados;
  end if;

  -- Los valores son EXACTAMENTE los que guardo `auditoria` antes del borrado.
  -- OJO: `cantidad` es de tipo TEXTO en esta tabla, por eso van entre comillas.
  insert into public.historicolotes
    (id, idempresa, cliente, producto, lote, cantidad, ordendecargue, fecha, aprobadopor, location, pdf, placa)
  values
    (24816, 2, 'INVERSIONES LEGUMBRES MARINILLA SAS', 'PT LA INSUPERABLE PANADERIA 25KG',       '20260925',  '1', 'AVI202609289629', '2026-09-28', 'Bodega Avimol', 'V27',
     'https://izibxufnaecgtfsjgffd.supabase.co/storage/v1/object/public/archivos/asignacionlotes/asignacion_lotes_AVI202609289629_1790608987284.pdf', 'WGW575'),
    (24817, 2, 'INVERSIONES LEGUMBRES MARINILLA SAS', 'PT LA INSUPERABLE PANADERIA PAPEL 50KG', '20260822',  '8', 'AVI202609289629', '2026-09-28', 'Bodega Avimol', 'V32',
     'https://izibxufnaecgtfsjgffd.supabase.co/storage/v1/object/public/archivos/asignacionlotes/asignacion_lotes_AVI202609289629_1790608987284.pdf', 'WGW575'),
    (24818, 2, 'INVERSIONES LEGUMBRES MARINILLA SAS', 'PT LA INSUPERABLE PANADERIA PAPEL 50KG', '20260822', '96', 'AVI202609289629', '2026-09-28', 'Bodega Avimol', 'V25',
     'https://izibxufnaecgtfsjgffd.supabase.co/storage/v1/object/public/archivos/asignacionlotes/asignacion_lotes_AVI202609289629_1790608987284.pdf', 'WGW575'),
    (24819, 2, 'INVERSIONES LEGUMBRES MARINILLA SAS', 'PT LA INSUPERABLE PANADERIA PAPEL 50KG', '20260822',  '1', 'AVI202609289629', '2026-09-28', 'Bodega Avimol', 'V32',
     'https://izibxufnaecgtfsjgffd.supabase.co/storage/v1/object/public/archivos/asignacionlotes/asignacion_lotes_AVI202609289629_1790608987284.pdf', 'WGW575'),
    (24820, 2, 'PLASTI ABARROTES SAS',                'PT LA INSUPERABLE PANADERIA PAPEL 50KG', '20260822', '80', 'AVI202609289629', '2026-09-28', 'Bodega Avimol', 'V32',
     'https://izibxufnaecgtfsjgffd.supabase.co/storage/v1/object/public/archivos/asignacionlotes/asignacion_lotes_AVI202609289629_1790608987284.pdf', 'WGW575');

  raise notice 'Restituidas 5 filas de la asignacion AVI202609289629 (186 unidades).';

  -- COHERENCIA FINAL.
  select count(*) into v_existen
    from public.historicolotes where ordendecargue = 'AVI202609289629';
  if v_existen <> 5 then
    raise exception 'Quedaron % filas en vez de 5: se deshace todo.', v_existen;
  end if;

  if (select sum(cantidad::numeric) from public.historicolotes where ordendecargue = 'AVI202609289629') <> 186 then
    raise exception 'Las cantidades no suman 186: se deshace todo.';
  end if;

  if exists (select 1 from public.historicolotes where ordendecargue = 'AVI202609289629' and idempresa <> 2) then
    raise exception 'Quedo alguna fila fuera de ID2: se deshace todo.';
  end if;

  raise notice 'LISTO. La asignacion vuelve a verse en el Historial de Asignacion de Lotes. El inventario no cambio.';
end
$restituir$;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS.
-- ---------------------------------------------------------------------

-- 3a. Las 5 filas, con sus mismos ids y cantidades.
select id, idempresa, ordendecargue, producto, cantidad, lote, location, cliente, fecha, placa, aprobadopor
from public.historicolotes
where ordendecargue = 'AVI202609289629'
order by id;
-- Esperado: 5 filas, ids 24816 a 24820, cantidades 1, 8, 96, 1 y 80.

-- 3b. El total.
select count(*) as filas, sum(cantidad::numeric) as unidades
from public.historicolotes
where ordendecargue = 'AVI202609289629';
-- Esperado: 5 filas, 186 unidades.

-- 3c. El inventario de ID2 no se tocó: esa orden no tiene ni tenía movimientos.
select count(*) as movimientos_de_inventario
from public.invtrans
where ocargue = 'AVI202609289629';
-- Esperado: 0, igual que antes.
