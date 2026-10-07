-- =====================================================================
-- Conteo total #40 de ID1 (fecha 2026-10-01, inventario inicial de octubre):
-- los 10 productos que el archivo del coordinador NO menciona vuelven a quedar
-- con el saldo del sistema, en vez de en cero.
--
-- Por qué: el archivo "inventario 30 sep.xlsx" trae EXACTAMENTE 15 productos y
-- 45.242 und (verificado en sus dos hojas, "Inventario" y "General"); Mogolla,
-- Salvado, Harina de Tercera, Macarrón C/G, Fideo, Espagueti, Surtida y Harina
-- precocida no aparecen en ninguna fila. Instrucción de gerencia (2026-10-05):
-- "si no están deja el que tiene el sistema al día de hoy... de resto todo igual".
--
-- Efecto: esas 17 líneas quedan con diferencia 0 (no mueven inventario, su stock
-- de hoy no se toca) y se retiran sus 17 correcciones, que nunca se contabilizaron.
-- Las otras 196 líneas y las 186 correcciones restantes NO se tocan.
--
-- Esperado al terminar:
--   líneas ................... 213 (sin cambio)
--   total sistema ............ 37.244 (sin cambio)
--   total conteo ............. 45.242 -> 46.545  (+1.303 de los no contados)
--   diferencia ............... 7.998 -> 9.301
--   líneas con diferencia .... 203 -> 186
--   correcciones ............. 203 -> 186 (97 sobrante 701 / 89 faltante 702)
-- El conteo sigue en 'cerrado' y activo, así que sigue siendo la base de 2026-10.
-- =====================================================================

-- ============================ ANTES =================================
select 'cabecera' as foto, id, fecha, estado, activo, items, items_con_diferencia, total_sistema, total_conteo, total_diferencia
  from sig_inventario_cuadre where id = 40;

select 'lineas a corregir' as foto, codproducto, producto, lote, location, sistema, conteo, diferencia
  from sig_inventario_cuadre_detalle
 where cuadre_id = 40
   and codproducto in ('PT000009','PT000012','PT000018','PT000019','PT000021','PT000035','PT000036','PT000043','PT000080','PT000100')
 order by codproducto, lote;

select 'correcciones a retirar' as foto, id, codproducto, lote, location, cod_movimiento, cantidad, tipo, estado, activo, invtrans_id
  from sig_inventario_ajuste
 where cuadre_id = 40
   and codproducto in ('PT000009','PT000012','PT000018','PT000019','PT000021','PT000035','PT000036','PT000043','PT000080','PT000100')
 order by codproducto, lote;

select 'stock vivo de esos productos (no debe cambiar)' as foto, codproducto, nombreproducto, round(sum(stock_actual)::numeric,2) as und
  from saldoinvdetalle
 where idempresa = 1
   and codproducto in ('PT000009','PT000012','PT000018','PT000019','PT000021','PT000035','PT000036','PT000043','PT000080','PT000100')
 group by 1, 2, 3 having sum(stock_actual) <> 0 order by 4 desc;

-- ========================== CORRECCIÓN ==============================
begin;
do $fix$
declare
  v_lineas int;
  v_ajustes int;
  v_posteadas int;
  v_estado text;
  v_conteo numeric;
  v_dif numeric;
  v_condif int;
begin
  -- Guarda 1: el conteo #40 debe ser el total activo del 2026-10-01, sin contabilizar.
  select estado into v_estado from sig_inventario_cuadre
   where id = 40 and proyecto_id = 1 and tipo = 'total' and fecha = '2026-10-01' and activo is true;
  if v_estado is null then
    raise exception 'El conteo #40 no es el Conteo total activo de ID1 del 2026-10-01.';
  end if;
  if v_estado not in ('contado', 'cerrado') then
    raise exception 'El conteo #40 está "%": solo se corrige un conteo contado o cerrado.', v_estado;
  end if;

  select count(*) into v_posteadas from sig_inventario_ajuste where cuadre_id = 40 and invtrans_id is not null;
  if v_posteadas > 0 then
    raise exception 'Ya hay % correccion(es) contabilizadas en el conteo #40: no se puede corregir asi (habria que reversarlas primero).', v_posteadas;
  end if;

  -- Guarda 2: deben ser exactamente las 17 lineas y las 17 correcciones esperadas.
  select count(*) into v_lineas from sig_inventario_cuadre_detalle
   where cuadre_id = 40
     and codproducto in ('PT000009','PT000012','PT000018','PT000019','PT000021','PT000035','PT000036','PT000043','PT000080','PT000100');
  if v_lineas <> 17 then
    raise exception 'Se esperaban 17 lineas de productos no contados y hay %.', v_lineas;
  end if;

  select count(*) into v_ajustes from sig_inventario_ajuste
   where cuadre_id = 40
     and codproducto in ('PT000009','PT000012','PT000018','PT000019','PT000021','PT000035','PT000036','PT000043','PT000080','PT000100');
  if v_ajustes <> 17 then
    raise exception 'Se esperaban 17 correcciones de productos no contados y hay %.', v_ajustes;
  end if;

  -- 1) El conteo de esas lineas vuelve a ser el saldo del sistema (diferencia 0).
  update sig_inventario_cuadre_detalle
     set conteo = sistema,
         diferencia = 0,
         observacion = 'Producto no contado en el físico; se da por bueno el saldo del sistema (gerencia 2026-10-05)'
   where cuadre_id = 40
     and codproducto in ('PT000009','PT000012','PT000018','PT000019','PT000021','PT000035','PT000036','PT000043','PT000080','PT000100');
  raise notice 'Lineas corregidas: 17 (conteo = sistema, diferencia 0)';

  -- 2) Se retiran sus correcciones (nunca se contabilizaron).
  delete from sig_inventario_ajuste
   where cuadre_id = 40
     and codproducto in ('PT000009','PT000012','PT000018','PT000019','PT000021','PT000035','PT000036','PT000043','PT000080','PT000100')
     and invtrans_id is null;
  raise notice 'Correcciones retiradas: 17';

  -- 3) Totales de la cabecera recalculados DESDE el detalle (no a mano).
  select round(sum(conteo)::numeric, 2), round(sum(diferencia)::numeric, 2), count(*) filter (where diferencia <> 0)
    into v_conteo, v_dif, v_condif
    from sig_inventario_cuadre_detalle where cuadre_id = 40;
  update sig_inventario_cuadre
     set total_conteo = v_conteo,
         total_diferencia = v_dif,
         items_con_diferencia = v_condif,
         updated_at = now()
   where id = 40;
  raise notice 'Cabecera: conteo=% diferencia=% lineas con diferencia=%', v_conteo, v_dif, v_condif;
end
$fix$;
commit;

-- =========================== DESPUÉS ================================
select 'cabecera' as verificacion, id, fecha, estado, activo, items, items_con_diferencia, total_sistema, total_conteo, total_diferencia
  from sig_inventario_cuadre where id = 40;
-- Esperado: items 213 · con_diferencia 186 · sistema 37.244 · conteo 46.545 · diferencia 9.301

select 'lineas de los no contados' as verificacion, codproducto, producto, lote, location, sistema, conteo, diferencia, observacion
  from sig_inventario_cuadre_detalle
 where cuadre_id = 40
   and codproducto in ('PT000009','PT000012','PT000018','PT000019','PT000021','PT000035','PT000036','PT000043','PT000080','PT000100')
 order by codproducto, lote;
-- Esperado: 17 filas, conteo = sistema y diferencia = 0 en todas.

select 'correcciones que quedan' as verificacion, tipo, cod_movimiento, estado, count(*) as lineas, round(sum(cantidad)::numeric,2) as unidades
  from sig_inventario_ajuste where cuadre_id = 40
 group by 1, 2, 3, 4 order by 2;
-- Esperado: 97 sobrante 701 (+26.256) y 89 faltante 702 (-16.955) = 186, todas 'registrado'.

select 'ninguna correccion de los no contados' as verificacion, count(*) as deben_ser_cero
  from sig_inventario_ajuste
 where cuadre_id = 40
   and codproducto in ('PT000009','PT000012','PT000018','PT000019','PT000021','PT000035','PT000036','PT000043','PT000080','PT000100');

select 'conteo por producto' as verificacion, codproducto, max(producto) as producto,
       round(sum(sistema)::numeric,2) as sistema, round(sum(conteo)::numeric,2) as conteo, round(sum(diferencia)::numeric,2) as diferencia
  from sig_inventario_cuadre_detalle where cuadre_id = 40
 group by 1, 2 order by abs(sum(diferencia)) desc;

-- Después de esto, en la pantalla "Cuadre y Correcciones de Inventario":
--   conteo #40 -> "Cerrar mes (ajusta stock)" contabiliza las 186 correcciones.
--   Los 15 productos del archivo quedan exactamente con el físico del coordinador
--   y los 10 que no estaban en el archivo no se mueven.
