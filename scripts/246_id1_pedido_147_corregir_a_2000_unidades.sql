
-- =====================================================================
-- 246_id1_pedido_147_corregir_a_2000_unidades.sql
--
-- ID1. El pedido 147 (línea transid 260, PT LA NIEVE 25LB) dice que se pidieron
-- 2 unidades y que se cargaron 2.000. Era una digitación: lo pedido eran 2.000.
--
-- Autorizado por gerencia el 2026-10-07 ("corrige el pedido a 2000 y cierra eso").
-- Corrige UNA línea por llave primaria, con antes/después y candados. Idempotente.
-- NO toca inventario: `pedidosdetalle` es el control del pedido del cliente.
-- =====================================================================
--
-- LA PRUEBA DE QUE SON 2.000, de dos fuentes independientes
--
-- 1) EL DINERO DE LA PROPIA LÍNEA. `total_linea` = 58.200.000. El precio real de
--    ese producto en ID1 es 29.100 por unidad, que se comprueba en las líneas
--    hermanas del mismo producto: pedido 96 (40 und → 1.164.000), pedido 178
--    (20 und → 582.000... a 29.100) y pedido 220 (150 und → 4.365.000, con el
--    precio escrito completo como 29.100). Entonces:
--        58.200.000 / 29.100 = 2.000 exactas.
--    Con 2 unidades la línea valdría 58.200, no 58.200.000.
--    (`precio_und` está guardado como 291 en esta fila y como 29.100 en otras:
--     la misma cifra en dos escalas. Por eso se usa el total, no el unitario.)
--
-- 2) EL INVENTARIO. Existe una salida de 2.000 unidades de ese producto atada a
--    esa orden: `invtrans` #496, ID1, PT LA NIEVE 25LB, 2.000, aprobada.
--
-- LO QUE SE ENCONTRÓ DE PASO Y NO SE TOCA (se informa)
--   · La orden de cargue `IND2026010903` NO EXISTE en `cabeceraoc`: cero filas, y
--     tampoco hay ninguna orden de ID1 del 9 de enero. El pedido quedó marcado como
--     entregado por una orden que no está.
--   · La salida #496 no es un despacho normal: lleva `cod_movimiento` 702 (ajuste),
--     no 601 (orden de cargue); está en la ubicación "TEMPORAL", con lote 20250821,
--     sin fecha de creación y a nombre de "Admin". Es una de las filas más antiguas
--     de la tabla. Son datos de arranque del sistema, no una operación del día.
--   Nada de eso se corrige aquí: es enero, un mes ya cerrado con su conteo aprobado,
--   y tocar inventario de un mes cerrado movería su base.
--
-- QUÉ SE CORRIGE: SOLO DOS CAMPOS
--   unidades  2  → 2000   lo pedido de verdad
--   peso      25 → 25000  es el peso de la LÍNEA, no el unitario: en las líneas hermanas
--                         de este producto vale 12,5 por unidad en 11 de 12 casos
--                         (40→500, 20→250, 150→1.875, 1.000→12.500, 2.800→35.000) y aquí
--                         vale 25 para 2 unidades, o sea 12,5. Si se suben las unidades y
--                         no el peso, la demanda en kilos de ese día queda mal por 24.975.
--
--   `unidadespendientes` NO SE TOCA: es una COLUMNA GENERADA (`unidades - unidadescargadas`,
--   comprobado en 25 de 25 filas). Postgres rechaza escribirla con
--   "column unidadespendientes can only be updated to DEFAULT" — así falló la primera
--   corrida de este script. Al subir `unidades` pasa sola de -1.998 a 0, y hay un candado
--   al final que lo verifica.
--
-- QUÉ NO SE TOCA, A PROPÓSITO
--   total_linea 58.200.000  ya corresponde a 2.000: no hay nada que ajustar.
--   precio_und 291          la escala doble del precio es un asunto de toda la tabla.
--   unidades_cargadas 2     columna de legado; la que lee el código es
--                           `unidadescargadas`, que ya vale 2.000.
--   peso_bascula 25         no hubo báscula real (la orden no existe); dejarlo en 25
--                           es menos falso que inventarle un peso.
--   und_eq 200              no mirra ni a 2 ni a 2.000; es otra digitación suelta.
--   estado                  la línea y el pedido ya están en "entregado".
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar esta salida.
-- ---------------------------------------------------------------------
select d.transid, d.idpedido, d.id_empresa, d.producto,
       d.unidades, d.unidadescargadas, d.unidades_cargadas, d.unidadespendientes,
       d.precio_und, d.total_linea, d.peso, d.peso_bascula, d.und_eq, d.estado, d.ocargue
from public.pedidosdetalle d
where d.transid = 260;
-- Esperado: unidades 2, unidadescargadas 2000, unidadespendientes -1998, peso 25.

-- El estado del pedido y su libro.
select c.idpedido, c.id_empresa, c.cliente, c.fecha, c.ocargue, c.factura, c.estado
from public.pedidoscabecera c where c.idpedido = 147;

select l.ocargue, l.unidades, l.origen from public.pedidodetalle_ocargue l where l.transid = 260;

-- ---------------------------------------------------------------------
-- PASO 2 — CORRECCIÓN.
-- ---------------------------------------------------------------------
begin;

do $corregir$
declare
  v_und      numeric;
  v_cargadas numeric;
  v_pend     numeric;
  v_peso     numeric;
  v_total    numeric;
  v_empresa  int;
begin
  select unidades, unidadescargadas, peso, total_linea, id_empresa
    into v_und, v_cargadas, v_peso, v_total, v_empresa
    from public.pedidosdetalle where transid = 260;
  if not found then
    raise exception 'No existe la linea transid 260: se deshace todo.';
  end if;

  -- Candado de proyecto: esto es de ID1 y de nadie mas.
  if v_empresa <> 1 then
    raise exception 'La linea transid 260 no es de ID1 (es de ID%): se deshace todo.', v_empresa;
  end if;

  if v_und = 2000 then
    raise notice 'La linea ya dice 2000 unidades: nada que hacer.';
    return;
  end if;

  -- ESTADO ESPERADO.
  if v_und <> 2 then
    raise exception 'Se esperaba que la linea dijera 2 unidades y dice %: se deshace todo y hay que revisar.', v_und;
  end if;
  if v_cargadas <> 2000 then
    raise exception 'Se esperaban 2000 unidades cargadas y hay %: se deshace todo.', v_cargadas;
  end if;
  -- El dinero tiene que seguir correspondiendo a 2.000 a 29.100 por unidad.
  if v_total <> 58200000 then
    raise exception 'El total de la linea ya no es 58.200.000 (es %): se deshace todo, la prueba del dinero no se sostiene.', v_total;
  end if;
  -- Y el peso tiene que ser el de la linea a 12,5 por unidad.
  if v_peso <> 25 then
    raise exception 'El peso de la linea ya no es 25 (es %): se deshace todo y hay que revisar la tasa.', v_peso;
  end if;

  -- OJO: `unidadespendientes` es una COLUMNA GENERADA (`unidades - unidadescargadas`,
  -- comprobado en 25 de 25 filas el 2026-10-07). Postgres rechaza escribirla:
  -- "column unidadespendientes can only be updated to DEFAULT". No se toca: al subir
  -- `unidades` a 2.000 se recalcula sola a 0, y el candado de abajo lo verifica.
  update public.pedidosdetalle
     set unidades = 2000,
         peso     = 25000
   where transid = 260;

  raise notice 'Linea 260 del pedido 147: unidades 2 -> 2000, peso 25 -> 25000 (pendientes se recalculan solos).';

  -- COHERENCIA FINAL.
  select unidades, unidadescargadas, unidadespendientes, peso
    into v_und, v_cargadas, v_pend, v_peso
    from public.pedidosdetalle where transid = 260;
  if v_und <> 2000 then
    raise exception 'La linea no quedo en 2000: se deshace todo.';
  end if;
  if v_cargadas > v_und then
    raise exception 'Sigue habiendo mas cargado que pedido: se deshace todo.';
  end if;
  -- La columna generada tiene que haberse recalculado sola.
  if v_pend <> 0 then
    raise exception 'Las unidades pendientes quedaron en % en vez de 0: se deshace todo.', v_pend;
  end if;
  if v_peso <> 25000 then
    raise exception 'El peso de la linea quedo en % en vez de 25000: se deshace todo.', v_peso;
  end if;

  -- Cuantas lineas siguen incumpliendo en TODA la base. Se INFORMA, no se aborta: si
  -- alguien creo otra linea mala mientras tanto, ese es otro caso y no es razon para
  -- deshacer esta correccion, que ya quedo bien y verificada arriba.
  declare
    v_restantes int;
  begin
    select count(*) into v_restantes
      from public.pedidosdetalle
     where unidadescargadas is not null
       and unidadescargadas > unidades + 0.01;
    if v_restantes = 0 then
      raise notice 'LISTO. No queda ninguna linea con mas cargado que lo pedido en toda la base.';
    else
      raise notice 'LISTO con esta linea. OJO: quedan % lineas con mas cargado que lo pedido en la base; son otros casos, revisarlos aparte.', v_restantes;
    end if;
  end;
end
$corregir$;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS.
-- ---------------------------------------------------------------------

-- 3a. La línea corregida.
select d.transid, d.idpedido, d.id_empresa, d.producto,
       d.unidades, d.unidadescargadas, d.unidadespendientes, d.peso, d.total_linea, d.estado
from public.pedidosdetalle d
where d.transid = 260;
-- Esperado: unidades 2000, cargadas 2000, pendientes 0, peso 25000.

-- 3b. En TODA la base no puede quedar ni una línea con más cargado que lo pedido.
select count(*) as lineas_con_mas_cargado_que_pedido
from public.pedidosdetalle
where unidadescargadas is not null and unidadescargadas > unidades + 0.01;
-- Esperado: 0.

-- 3c. El pedido sigue entregado y con su factura.
select idpedido, cliente, fecha, ocargue, factura, estado
from public.pedidoscabecera where idpedido = 147;
