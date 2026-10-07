
-- =====================================================================
-- 245_id3_orden_9899_devolver_fechas_del_6_de_octubre.sql
--
-- ID3. La orden MOL202610069899 se tramitó el 6 de OCTUBRE. La reparación que
-- hicimos el 7 le dejó la hora de lote, la de picking y la fecha de los movimientos
-- de inventario con el día de HOY. Este script devuelve la línea de tiempo al día en
-- que de verdad se operó.
--
-- Correr DESPUÉS del 243 y el 244, y DESPUÉS de que el coordinador haya hecho el
-- picking. Idempotente. Corrige por llave primaria, con antes/después y candados.
--
-- Instrucción de gerencia (2026-10-07): "esta orden se tramitó el 06 de octubre y
-- debes conservar todos los soportes o evidencias del día de ayer".
-- =====================================================================
--
-- QUÉ SE DAÑÓ Y POR QUÉ
--
-- El 243 dejó en blanco `horalote` y `horapicking` para que la orden volviera a
-- Asignación de Lote, y el 244 dejó en blanco `fincargue` para que pudiera hacerse el
-- Picking. Al rehacer el trabajo, el sistema volvió a estampar la hora: puso las del
-- 7 de octubre. Y los 6 movimientos nuevos de `invtrans` nacieron con `creado` del 7.
--
-- Eso mueve un despacho del 6 al 7 en el kardex, en el informe del día, en las
-- toneladas y en la productividad. La orden tiene que figurar el día que se cargó.
--
-- LOS VALORES SALEN DE LA AUDITORÍA, NO DE UNA SUPOSICIÓN
-- La tabla `auditoria` guardó cada cambio del 6 de octubre con su valor anterior y
-- posterior. De ahí salen, exactos:
--     horalote    10:00:48   (registrado el 6-oct 15:00:48 UTC)
--     horapicking 10:30:33   (registrado el 6-oct 15:30:33 UTC)
--     fincargue   11:52:18   (registrado el 6-oct 16:52:18 UTC por Ander Fabian)
-- Y el `creado` de los movimientos originales de esa orden era 2026-10-06T10:00:48,
-- el mismo instante del `horalote`, que es como lo escribe `approveBatchAllocation`.
--
-- EL FORMATO NO SE INVENTA. `getColombiaISO()` (lib/date-utils.ts) devuelve
-- `toISOString()` de la hora de Bogotá, o sea `YYYY-MM-DDTHH:mm:ss.sssZ`. El literal
-- de abajo reproduce esa convención exacta y sirve igual si la columna es texto o
-- si es una marca de tiempo.
--
-- QUÉ SE CONSERVA Y NO SE TOCA (ya está bien, se verifica y se deja)
--   fechaorden 2026-10-06 · fechacargue 2026-10-06 · horavehiculo 09:11:37
--   horaorden 09:12:00 · pesajeinicial 09:59:14 · pesovascula 3,52 t
--   tiquetebascula · iniciocargue 10:29:46 · pesajefinal 14:51:57 · muelle 2
--   status finalizado · auxiliares y auxiliares_real · las 7 fotos de fotospicking
--   el comprobante, el estado de factura y el medio de pago · el pdfoc de la orden
--
-- LA HISTORIA NO SE BORRA. `auditoria` conserva para siempre el rastro de que el 7 de
-- octubre se reparó esta orden, con quién, qué campo y qué valor. Devolver la línea de
-- tiempo operativa al 6 no oculta nada: la reparación sigue registrada.
--
-- LO QUE ESTE SCRIPT NO PUEDE ARREGLAR
-- El PDF de picking guardado en `doccargue` se generó hoy y lleva impreso "07/10/2026,
-- 12:56". Su CONTENIDO es el correcto (las 6 líneas, 330 unidades), pero su encabezado
-- dice hoy, y la sección de evidencias muestra "Imagen no disponible" siete veces
-- aunque las 7 fotos existen y responden. Eso se resuelve regenerando el PDF desde la
-- pantalla, no desde la base, y queda señalado aparte.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar estas tres salidas.
-- ---------------------------------------------------------------------

-- 1a. La línea de tiempo como está hoy.
select id, ordendecargue, fechaorden, fechacargue, horavehiculo, horaorden,
       pesajeinicial, pesovascula, horalote, horapicking, iniciocargue, fincargue,
       pesajefinal, muelle, status
from public.cabeceraoc
where id = 9899;
-- Esperado AHORA: horalote 12:44:48, horapicking 12:53:43, fincargue vacío o de hoy.

-- 1b. La fecha de los 6 movimientos de inventario.
select id, nombreproducto, cantidad, lote, location, status, creado
from public.invtrans
where ocargue = 'MOL202610069899'
order by id;
-- Esperado AHORA: creado del 2026-10-07.

-- 1c. La fecha de las 6 filas del historial de asignación.
select id, producto, cantidad, lote, location, fecha
from public.historicolotes
where ordendecargue = 'MOL202610069899'
order by id;
-- Esperado AHORA: fecha 2026-10-07.

-- ---------------------------------------------------------------------
-- PASO 2 — CORRECCIÓN. Todo o nada.
-- ---------------------------------------------------------------------
begin;

do $fechas$
declare
  v_lineas  int;
  v_und     numeric;
  v_hoy     int;
  v_hl      int;
begin
  -- ESTADO ESPERADO: la asignación buena, 6 líneas y 330 unidades.
  select count(*), coalesce(sum(cantidad), 0) into v_lineas, v_und
    from public.invtrans where ocargue = 'MOL202610069899';
  if v_lineas <> 6 or v_und <> 330 then
    raise exception 'Se esperaban 6 lineas y 330 unidades en MOL202610069899 y hay % con %: se deshace todo.', v_lineas, v_und;
  end if;

  -- Y que lo autorizado siga siendo 330: si no, este no es el caso.
  if (select coalesce(sum(cantidad), 0) from public.detalleoc where idorden = 9899) <> 330 then
    raise exception 'El detalle de la orden 9899 ya no suma 330 unidades: se deshace todo.';
  end if;

  -- Ni un movimiento puede quedar fuera del 6 de octubre al terminar.
  select count(*) into v_hoy
    from public.invtrans
   where ocargue = 'MOL202610069899' and creado::text not like '2026-10-06%';

  -- 2a. Los movimientos de inventario vuelven al 6 de octubre, al instante del lote.
  if v_hoy > 0 then
    update public.invtrans
       set creado = '2026-10-06T10:00:48.000Z'
     where ocargue = 'MOL202610069899';
    raise notice 'invtrans: % movimientos devueltos al 2026-10-06 10:00:48.', v_hoy;
  else
    raise notice 'invtrans: los movimientos ya estaban en el 6 de octubre.';
  end if;

  -- 2b. El historial de asignación, al mismo día.
  select count(*) into v_hl
    from public.historicolotes
   where ordendecargue = 'MOL202610069899' and fecha::text <> '2026-10-06';
  if v_hl > 0 then
    update public.historicolotes
       set fecha = '2026-10-06'
     where ordendecargue = 'MOL202610069899';
    raise notice 'historicolotes: % filas devueltas al 2026-10-06.', v_hl;
  else
    raise notice 'historicolotes: las filas ya estaban en el 6 de octubre.';
  end if;

  -- 2c. La línea de tiempo de la orden, con los valores que guardó la auditoría.
  update public.cabeceraoc
     set horalote    = '10:00:48',
         horapicking = '10:30:33',
         fincargue   = '11:52:18'
   where id = 9899 and ordendecargue = 'MOL202610069899' and idempresa = 3;
  raise notice 'cabeceraoc 9899: horalote 10:00:48, horapicking 10:30:33, fincargue 11:52:18.';

  -- COHERENCIA FINAL.
  select count(*) into v_hoy
    from public.invtrans
   where ocargue = 'MOL202610069899' and creado::text not like '2026-10-06%';
  if v_hoy > 0 then
    raise exception 'Quedaron % movimientos fuera del 6 de octubre: se deshace todo.', v_hoy;
  end if;

  select count(*), coalesce(sum(cantidad), 0) into v_lineas, v_und
    from public.invtrans where ocargue = 'MOL202610069899';
  if v_lineas <> 6 or v_und <> 330 then
    raise exception 'Se alteraron las lineas (quedaron % con %): se deshace todo.', v_lineas, v_und;
  end if;

  -- Los soportes del 6 de octubre tienen que seguir ahí.
  if not exists (
    select 1 from public.cabeceraoc
     where id = 9899
       and fechacargue::text = '2026-10-06'
       and pesajeinicial is not null
       and pesajefinal is not null
       and pesovascula is not null
       and iniciocargue is not null
       and fotospicking is not null) then
    raise exception 'Falta alguno de los soportes del 6 de octubre (basculas, inicio de cargue o fotos): se deshace todo.';
  end if;

  raise notice 'LISTO. La orden vuelve a figurar el 6 de octubre, con sus basculas, horas, fotos y soportes.';
end
$fechas$;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS. La línea de tiempo del 6 de octubre, completa.
-- ---------------------------------------------------------------------

-- 3a. Debe leerse de corrido: vehículo 09:11, orden 09:12, báscula 09:59,
--     lote 10:00, inicio 10:29, picking 10:30, fin 11:52, báscula final 14:51.
select ordendecargue, fechaorden, fechacargue, horavehiculo, horaorden,
       pesajeinicial, pesovascula, tiquetebascula, horalote, horapicking,
       iniciocargue, fincargue, pesajefinal, muelle, status
from public.cabeceraoc
where id = 9899;

-- 3b. Los 6 movimientos, todos del 6 de octubre y aprobados.
select id, nombreproducto, cantidad, lote, location, status, cod_movimiento, creado
from public.invtrans
where ocargue = 'MOL202610069899'
order by id;

-- 3c. Las salidas de ID3 por día: la 9899 debe contar el 6, no el 7.
select substring(creado::text, 1, 10) as dia,
       count(*) as movimientos,
       sum(cantidad) as unidades,
       string_agg(distinct ocargue, ', ') as ordenes
from public.invtrans
where idempresa = 3
  and tipomov = 'Salida'
  and creado::text >= '2026-10-06'
  and creado::text < '2026-10-08'
group by 1
order by 1;

-- 3d. Los soportes del día, intactos.
select id,
       (fotospicking is not null) as tiene_fotos,
       (comprobante is not null)  as tiene_comprobante,
       (doccargue is not null)    as tiene_pdf_picking,
       (pdfoc is not null)        as tiene_pdf_orden,
       auxiliares_real
from public.cabeceraoc
where id = 9899;
