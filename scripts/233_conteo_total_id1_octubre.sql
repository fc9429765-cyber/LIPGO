-- =====================================================================
-- CONTEO TOTAL de ID1 (Harinera Indupan) con fecha 2026-10-01
-- = inventario inicial de 2026-10 = cierre físico del 2026-09-30.
--
-- Generado por scripts/sig/cargar_conteo_total_fisico.mts el 2026-10-06T03:33:15.932Z
-- Archivo físico: scripts/sig/data/id1-fisico-2026-10.json (111 claves, 45.242 und)
-- Decisiones: scripts/sig/data/id1-fisico-2026-10.config.json
--
-- Hace lo MISMO que la pantalla: crea el conteo (crearCuadre), guarda el
-- físico (guardarConteoCuadre) y genera las correcciones (generarAjustesCuadre)
-- en estado 'registrado'. NO mueve inventario: el stock solo cambia cuando se
-- aprueban las correcciones en "Cuadre y Correcciones de Inventario" con clave.
--
-- Resumen de lo que va a quedar:
--   líneas del conteo ............ 213 (111 del archivo, 85 lotes ausentes -> 0, 17 de productos no contados -> saldo del sistema)
--   total sistema (amanecer) ..... 37.244 und
--   total conteo (inicial) ....... 45.242 und
--   diferencia neta .............. 7.998 und en 203 líneas
--   correcciones ................. 97 sobrante 701 (+26.256) y 106 faltante 702 (-18.258), fechadas 2026-09-30
-- =====================================================================

-- ============================ ANTES =================================
select 'conteos totales de 2026-10' as foto, id, fecha, estado, activo, items, total_sistema, total_conteo, total_diferencia
  from sig_inventario_cuadre where proyecto_id = 1 and tipo = 'total' and fecha between '2026-10-01' and '2026-10-31' order by id;
select 'stock vivo por producto' as foto, codproducto, nombreproducto, round(sum(stock_actual)::numeric, 2) as und
  from saldoinvdetalle where idempresa = 1 group by 1, 2, 3 having sum(stock_actual) <> 0 order by 4 desc;

-- ========================== CORRECCIÓN ==============================
begin;
do $cargue$
declare
  v_cuadre int;
  v_existe int;
  v_pend int;
begin
  -- Guarda 1: un solo Conteo total activo por mes (misma regla que crearCuadre).
  select count(*) into v_existe from sig_inventario_cuadre
   where proyecto_id = 1 and tipo = 'total' and activo is true and estado <> 'anulado'
     and fecha between '2026-10-01' and '2026-10-31';
  if v_existe > 0 then
    raise exception 'Ya existe un Conteo total activo en 2026-10 para ID1: no se crea otro.';
  end if;
  -- Guarda 2: ninguna salida de orden ya finalizada sin confirmar el picking.
  select count(*) into v_pend from invtrans i
    join cabeceraoc c on c.ordendecargue = trim(i.ocargue) and lower(c.status) = 'finalizado'
   where i.idempresa = 1 and i.status = 'por descontar';
  if v_pend > 0 then
    raise exception 'Hay % salida(s) por descontar de órdenes finalizadas: confirmar el picking antes del conteo.', v_pend;
  end if;

  insert into sig_inventario_cuadre
    (proyecto_id, fecha, tipo, almacen, responsable, estado, total_sistema, total_conteo, total_diferencia, items, items_con_diferencia, observaciones, creado_por)
  values
    (1, '2026-10-01', 'total', null, 'gerenciageneral@lip-sas.com', 'borrador', 37244, 37244, 0, 137, 0, 'Inventario inicial de 2026-10 cargado desde el archivo físico del cliente (id1-fisico-2026-10.json); cierre físico del 2026-09-30.', 'gerenciageneral@lip-sas.com')
  returning id into v_cuadre;
  raise notice 'Conteo total creado: #%', v_cuadre;

  -- Detalle: 213 líneas (producto, lote, ubicación, sistema, conteo).
  insert into sig_inventario_cuadre_detalle (cuadre_id, codproducto, producto, lote, location, sistema, conteo, diferencia, observacion) values
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20200910', 'A16', -248, 0, 248, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó) · el sistema lo tenía en negativo'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20200910', 'C7', 2, 0, -2, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260824', 'A21', -5, 0, 5, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó) · el sistema lo tenía en negativo'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'A10', 20, 0, -20, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'A11', 98, 0, -98, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'A21', 22, 0, -22, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'AV', 57, 0, -57, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'C1', 28, 0, -28, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260829', 'AV', 36, 0, -36, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260831', 'C7', 33, 0, -33, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260904', 'AV', 0, 4, 4, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260909', 'A18', 18, 0, -18, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260909', 'AV', 0, 3, 3, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260910', 'A16', 251, 0, -251, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260911', 'AV', 0, 11, 11, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260914', 'B1', 391, 392, 1, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260915', 'B1', 359, 358, -1, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260915', 'B2', 234, 234, 0, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260917', 'A25', 420, 435, 15, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260918', 'A24', 164, 0, -164, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260918', 'A25', 0, 140, 140, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260918', 'AV', 0, 7, 7, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260925', 'A12', 0, 75, 75, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260925', 'B14', 457, 0, -457, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260925', 'B15', 0, 457, 457, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'A6', 929, 930, 1, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'AV', 0, 6, 6, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'B13', 540, 0, -540, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'B14', 1046, 540, -506, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'B15', 0, 1043, 1043, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260927', 'A15', 0, 135, 135, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260927', 'C2', 380, 245, -135, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'A23', 0, 840, 840, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'A25', 805, 0, -805, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'B6', 0, 557, 557, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'B8', 557, 0, -557, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'A16', 0, 70, 70, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'A17', 0, 116, 116, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'B2', 306, 306, 0, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'B6', 403, 403, 0, null),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'C1', 185, 0, -185, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000001', 'Indupan Especial 50 Kg.', '2026828', 'C1', -251, 0, 251, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó) · el sistema lo tenía en negativo'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20200910', 'A25', -124, 0, 124, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó) · el sistema lo tenía en negativo'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260611', 'AV', 0, 2, 2, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260621', 'A3', 0, 540, 540, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260725', 'A23', 41, 0, -41, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260809', 'AV', 2, 0, -2, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260812', 'B14', -232, 0, 232, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó) · el sistema lo tenía en negativo'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260813', 'TOLVA', 1, 0, -1, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260821', 'AV', 9, 0, -9, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260822', 'AV', 25, 0, -25, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260824', 'AV', 13, 0, -13, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260826', 'AV', 7, 0, -7, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260827', 'AV', 21, 0, -21, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260828', 'CARACOL', 10, 0, -10, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260910', 'A24', 2, 0, -2, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260911', 'AV', 36, 0, -36, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260912', 'AV', 12, 0, -12, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260913', 'A21', 77, 0, -77, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260913', 'AV', 0, 17, 17, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260914', 'B15', 2, 0, -2, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260914', 'B8', 51, 0, -51, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260914', 'B9', 402, 0, -402, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260914', 'CARACOL', 3, 0, -3, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260915', 'B14', 5, 0, -5, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260917', 'B10', 2, 0, -2, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260917', 'B11', 4, 0, -4, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260918', 'AV', 0, 2, 2, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260918', 'B10', 8, 0, -8, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260918', 'B9', 54, 0, -54, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'A23', 60, 0, -60, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B4', 0, 80, 80, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B5', 0, 540, 540, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B8', 9, 0, -9, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'A20', 526, 0, -526, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'A22', 140, 0, -140, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'A24', 62, 0, -62, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'AV', 0, 15, 15, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'B3', 0, 870, 870, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'B4', 870, 460, -410, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'B5', 460, 0, -460, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'C5', 0, 385, 385, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'C6', 0, 280, 280, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260921', 'A2', 330, 0, -330, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260921', 'A3', 484, 29, -455, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260921', 'AV', 0, 12, 12, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260922', 'A1', 930, 930, 0, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260922', 'A2', 775, 130, -645, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260922', 'A21', 550, 105, -445, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A21', 0, 595, 595, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A7', 12, 12, 0, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A8', 930, 930, 0, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', 930, 930, 0, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'AV', 0, 17, 17, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'A27', 315, 0, -315, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'A7', 980, 980, 0, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'B15', 1320, 0, -1320, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'B16', 0, 1320, 1320, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'C6', 280, 0, -280, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'C7', 0, 280, 280, null);
  insert into sig_inventario_cuadre_detalle (cuadre_id, codproducto, producto, lote, location, sistema, conteo, diferencia, observacion) values
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'A27', 245, 1120, 875, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'AV', 0, 41, 41, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'B15', 196, 0, -196, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'B16', 0, 180, 180, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'C2', 160, 0, -160, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'C3', 392, 393, 1, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'AV', 0, 280, 280, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'B11', 378, 0, -378, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'B12', 540, 0, -540, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'B13', 0, 540, 540, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'CARACOL', 1575, 1295, -280, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'A22', 564, 840, 276, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'A26', 320, 0, -320, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'AV', 0, 35, 35, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B10', 1080, 540, -540, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B11', 707, 0, -707, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B12', 0, 540, 540, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B13', 0, 540, 540, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B9', 0, 540, 540, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260929', 'A1', 265, 160, -105, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260929', 'C11', 0, 105, 105, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260930', 'B6', 540, 540, 0, null),
    (v_cuadre, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260930', 'CARACOL', 600, 600, 0, null),
    (v_cuadre, 'PT000003', 'Indupan Premium 50 Kg.', '20260829', 'AV', 0, 51, 51, null),
    (v_cuadre, 'PT000003', 'Indupan Premium 50 Kg.', '20260831', 'A20', 22, 0, -22, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000003', 'Indupan Premium 50 Kg.', '20260831', 'AV', 0, 22, 22, null),
    (v_cuadre, 'PT000003', 'Indupan Premium 50 Kg.', '20260912', 'A20', -11, 0, 11, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó) · el sistema lo tenía en negativo'),
    (v_cuadre, 'PT000003', 'Indupan Premium 50 Kg.', '20260917', 'AV', 0, 4, 4, null),
    (v_cuadre, 'PT000003', 'Indupan Premium 50 Kg.', '20260923', 'A27', 74, 0, -74, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000003', 'Indupan Premium 50 Kg.', '20260923', 'C4', 0, 90, 90, null),
    (v_cuadre, 'PT000003', 'Indupan Premium 50 Kg.', '20260928', 'AV', 0, 1, 1, null),
    (v_cuadre, 'PT000003', 'Indupan Premium 50 Kg.', '20261209', 'A23', 1, 0, -1, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260612', 'AV', 0, 1, 1, null),
    (v_cuadre, 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260911', 'CARACOL', -7, 0, 7, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó) · el sistema lo tenía en negativo'),
    (v_cuadre, 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260912', 'CARACOL', 285, 280, -5, null),
    (v_cuadre, 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260928', 'AV', 0, 13, 13, null),
    (v_cuadre, 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260928', 'CARACOL', 13, 0, -13, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000009', 'Mogolla Kg.', '20260925', 'M1', 218, 0, -218, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000009', 'Mogolla Kg.', '20260926', 'M1', 50, 0, -50, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000010', 'Indupan Integral 50 Kg.', '20260827', 'AV', 0, 21, 21, null),
    (v_cuadre, 'PT000010', 'Indupan Integral 50 Kg.', '20260828', 'AV', 0, 68, 68, null),
    (v_cuadre, 'PT000010', 'Indupan Integral 50 Kg.', '20260829', 'AV', 0, 105, 105, null),
    (v_cuadre, 'PT000010', 'Indupan Integral 50 Kg.', '20260829', 'B16', 194, 0, -194, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000010', 'Indupan Integral 50 Kg.', '20260917', 'AV', 0, 21, 21, null),
    (v_cuadre, 'PT000011', 'Indupan Panificacion 25 Kg.', '20260919', 'A13', 110, 108, -2, null),
    (v_cuadre, 'PT000011', 'Indupan Panificacion 25 Kg.', '20260924', 'AV', 0, 1, 1, null),
    (v_cuadre, 'PT000011', 'Indupan Panificacion 25 Kg.', '20260928', 'AV', 0, 1, 1, null),
    (v_cuadre, 'PT000011', 'Indupan Panificacion 25 Kg.', '20260928', 'CARACOL', 1, 0, -1, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000012', 'Salvado Kg.', '20260826', 'S1', 11, 0, -11, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000012', 'Salvado Kg.', '20260915', 'S1', 267, 0, -267, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000016', 'NIEVE PAPEL 25', '20260817', 'AV', 69, 0, -69, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260821', 'A12', 1, 0, -1, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260916', 'A12', 16, 0, -16, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260916', 'AV', 0, 6, 6, null),
    (v_cuadre, 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260922', 'C6', 0, 285, 285, null),
    (v_cuadre, 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260922', 'C7', 0, 252, 252, null),
    (v_cuadre, 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260922', 'CARACOL', 543, 0, -543, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000018', 'Surtida 250 Gr. X 24 Und.', '20260926', 'AV', 1, 0, -1, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000019', 'PT ESPAGUETI CAPRISSIMA 1000GR*12PQ', '20260926', 'AV', 1, 0, -1, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000021', 'PT HARINA PREC MAIZ 20KG BLANCA', '20260926', 'AV', 13, 0, -13, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000035', 'PT MACARRON G.250GR*24PQ', '20260909', 'AV', 87, 0, -87, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000036', 'PT MACARRON C.250GR*24PQ', '20260909', 'AV', 87, 0, -87, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000036', 'PT MACARRON C.250GR*24PQ', '20260929', 'AV', 87, 0, -87, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000043', 'PT HARINA PREC MAIZ 24LB BLANCA', '20260926', 'AV', 4, 0, -4, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000044', 'indupan panificacion 1000Kg x20', '20260529', 'AV', 2, 0, -2, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000044', 'indupan panificacion 1000Kg x20', '20260805', 'A20', -79, 0, 79, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó) · el sistema lo tenía en negativo'),
    (v_cuadre, 'PT000044', 'indupan panificacion 1000Kg x20', '20260910', 'A19', 1, 0, -1, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000044', 'indupan panificacion 1000Kg x20', '20260910', 'AV', 0, 1, 1, null),
    (v_cuadre, 'PT000044', 'indupan panificacion 1000Kg x20', '20260911', 'A19', 3, 0, -3, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000044', 'indupan panificacion 1000Kg x20', '20260911', 'AV', 0, 1, 1, null),
    (v_cuadre, 'PT000044', 'indupan panificacion 1000Kg x20', '20260925', 'A20', 591, 1246, 655, null),
    (v_cuadre, 'PT000045', 'Indupan Especial 25 Kg.', '20260829', 'AV', 0, 6, 6, null),
    (v_cuadre, 'PT000045', 'Indupan Especial 25 Kg.', '20260829', 'P', 6, 0, -6, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000045', 'Indupan Especial 25 Kg.', '20260925', 'AV', 0, 2, 2, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260822', 'P', -202, 0, 202, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó) · el sistema lo tenía en negativo'),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260909', 'P', 677, 3192, 2515, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260910', 'P', 0, 798, 798, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260914', 'AV', 0, 1, 1, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260914', 'P', 827, 1784, 957, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260915', 'AV', 0, 3, 3, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260915', 'P', 1721, 0, -1721, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260916', 'AV', 0, 3, 3, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260916', 'P', 724, 0, -724, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260917', 'AV', 0, 4, 4, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260918', 'P', 2699, 2793, 94, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260919', 'AV', 0, 7, 7, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260919', 'P', 1981, 2101, 120, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260921', 'P', 0, 34, 34, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260929', 'AV', 0, 3, 3, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260929', 'P', 0, 3600, 3600, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260930', 'AV', 0, 1292, 1292, null),
    (v_cuadre, 'PT000048', 'PT LA NIEVE 25LB', '20260930', 'P', 0, 1330, 1330, null),
    (v_cuadre, 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260728', 'AV', 1, 0, -1, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260814', 'P', 4, 0, -4, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260821', 'A14', 34, 37, 3, null),
    (v_cuadre, 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260821', 'AV', 0, 2, 2, null),
    (v_cuadre, 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260828', 'A17', 10, 0, -10, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000057', 'PT LA INSUPERABLE REPOSTERIA 50KG', '20260811', 'AV', 0, 11, 11, null),
    (v_cuadre, 'PT000057', 'PT LA INSUPERABLE REPOSTERIA 50KG', '20260827', 'AV', 0, 106, 106, null),
    (v_cuadre, 'PT000057', 'PT LA INSUPERABLE REPOSTERIA 50KG', '20260901', 'S1', 117, 0, -117, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)');
  insert into sig_inventario_cuadre_detalle (cuadre_id, codproducto, producto, lote, location, sistema, conteo, diferencia, observacion) values
    (v_cuadre, 'PT000059', 'PT LA NIEVE POLI PANADERIA 50KG', '20260829', 'A19', 7, 0, -7, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000059', 'PT LA NIEVE PAPEL PANADERIA 50KG', '20260831', 'C4', 0, 27, 27, null),
    (v_cuadre, 'PT000059', 'PT LA NIEVE PAPEL PANADERIA 50KG', '20260916', 'C4', 300, 280, -20, null),
    (v_cuadre, 'PT000080', 'PT FIDEO 250*24PQ', '20260926', 'AV', 8, 0, -8, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000094', 'Harina la Nieve 1000 Gr. X 20 Und.', '20260916', 'A16', 13, 0, -13, 'No aparece en el conteo físico del 2026-10-01 (el producto sí se contó)'),
    (v_cuadre, 'PT000094', 'Harina la Nieve 1000 Gr. X 20 Und.', '20260916', 'P', 0, 15, 15, null),
    (v_cuadre, 'PT000094', 'Harina la Nieve 1000 Gr. X 20 Und.', '20260925', 'P', 0, 101, 101, null),
    (v_cuadre, 'PT000100', 'Harina de Tercera', '20260913', 'S1', 98, 0, -98, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000100', 'Harina de Tercera', '20260914', 'S1', 132, 0, -132, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000100', 'Harina de Tercera', '20260915', 'S1', 118, 0, -118, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000100', 'Harina de Tercera', '20260916', 'S1', 76, 0, -76, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000100', 'Harina de Tercera', '20260917', 'S1', 45, 0, -45, 'Producto no contado en el físico; se deja en cero por decisión de gerencia'),
    (v_cuadre, 'PT000189', 'Indupan Premium 12,5 Kg.', '20260925', 'AV', 0, 75, 75, null);

  update sig_inventario_cuadre set
    estado = 'contado', total_sistema = 37244, total_conteo = 45242,
    total_diferencia = 7998, items = 213, items_con_diferencia = 203, updated_at = now()
   where id = v_cuadre;

  -- Correcciones: 203 líneas con diferencia, fechadas 2026-09-30 (pertenecen al mes que se cierra).
  insert into sig_inventario_ajuste (proyecto_id, cuadre_id, fecha, codproducto, producto, lote, location, direccion, cod_movimiento, cantidad, tipo, motivo, responsable, estado) values
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20200910', 'A16', 'ingreso', '701', 248, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20200910', 'C7', 'salida', '702', -2, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260824', 'A21', 'ingreso', '701', 5, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'A10', 'salida', '702', -20, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'A11', 'salida', '702', -98, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'A21', 'salida', '702', -22, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'AV', 'salida', '702', -57, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'C1', 'salida', '702', -28, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260829', 'AV', 'salida', '702', -36, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260831', 'C7', 'salida', '702', -33, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260904', 'AV', 'ingreso', '701', 4, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260909', 'A18', 'salida', '702', -18, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260909', 'AV', 'ingreso', '701', 3, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260910', 'A16', 'salida', '702', -251, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260911', 'AV', 'ingreso', '701', 11, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260914', 'B1', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260915', 'B1', 'salida', '702', -1, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260917', 'A25', 'ingreso', '701', 15, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260918', 'A24', 'salida', '702', -164, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260918', 'A25', 'ingreso', '701', 140, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260918', 'AV', 'ingreso', '701', 7, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260925', 'A12', 'ingreso', '701', 75, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260925', 'B14', 'salida', '702', -457, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260925', 'B15', 'ingreso', '701', 457, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'A6', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'AV', 'ingreso', '701', 6, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'B13', 'salida', '702', -540, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'B14', 'salida', '702', -506, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260926', 'B15', 'ingreso', '701', 1043, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260927', 'A15', 'ingreso', '701', 135, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260927', 'C2', 'salida', '702', -135, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'A23', 'ingreso', '701', 840, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'A25', 'salida', '702', -805, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'B6', 'ingreso', '701', 557, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'B8', 'salida', '702', -557, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'A16', 'ingreso', '701', 70, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'A17', 'ingreso', '701', 116, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'C1', 'salida', '702', -185, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000001', 'Indupan Especial 50 Kg.', '2026828', 'C1', 'ingreso', '701', 251, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20200910', 'A25', 'ingreso', '701', 124, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260611', 'AV', 'ingreso', '701', 2, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260621', 'A3', 'ingreso', '701', 540, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260725', 'A23', 'salida', '702', -41, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260809', 'AV', 'salida', '702', -2, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260812', 'B14', 'ingreso', '701', 232, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260813', 'TOLVA', 'salida', '702', -1, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260821', 'AV', 'salida', '702', -9, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260822', 'AV', 'salida', '702', -25, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260824', 'AV', 'salida', '702', -13, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260826', 'AV', 'salida', '702', -7, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260827', 'AV', 'salida', '702', -21, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260828', 'CARACOL', 'salida', '702', -10, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260910', 'A24', 'salida', '702', -2, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260911', 'AV', 'salida', '702', -36, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260912', 'AV', 'salida', '702', -12, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260913', 'A21', 'salida', '702', -77, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260913', 'AV', 'ingreso', '701', 17, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260914', 'B15', 'salida', '702', -2, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260914', 'B8', 'salida', '702', -51, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260914', 'B9', 'salida', '702', -402, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260914', 'CARACOL', 'salida', '702', -3, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260915', 'B14', 'salida', '702', -5, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260917', 'B10', 'salida', '702', -2, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260917', 'B11', 'salida', '702', -4, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260918', 'AV', 'ingreso', '701', 2, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260918', 'B10', 'salida', '702', -8, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260918', 'B9', 'salida', '702', -54, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'A23', 'salida', '702', -60, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B4', 'ingreso', '701', 80, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B5', 'ingreso', '701', 540, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B8', 'salida', '702', -9, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'A20', 'salida', '702', -526, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'A22', 'salida', '702', -140, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'A24', 'salida', '702', -62, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'AV', 'ingreso', '701', 15, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'B3', 'ingreso', '701', 870, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'B4', 'salida', '702', -410, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'B5', 'salida', '702', -460, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'C5', 'ingreso', '701', 385, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'C6', 'ingreso', '701', 280, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260921', 'A2', 'salida', '702', -330, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260921', 'A3', 'salida', '702', -455, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260921', 'AV', 'ingreso', '701', 12, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260922', 'A2', 'salida', '702', -645, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260922', 'A21', 'salida', '702', -445, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A21', 'ingreso', '701', 595, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'AV', 'ingreso', '701', 17, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'A27', 'salida', '702', -315, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'B15', 'salida', '702', -1320, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'B16', 'ingreso', '701', 1320, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'C6', 'salida', '702', -280, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'C7', 'ingreso', '701', 280, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'A27', 'ingreso', '701', 875, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'AV', 'ingreso', '701', 41, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'B15', 'salida', '702', -196, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'B16', 'ingreso', '701', 180, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'C2', 'salida', '702', -160, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'C3', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'AV', 'ingreso', '701', 280, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'B11', 'salida', '702', -378, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado');
  insert into sig_inventario_ajuste (proyecto_id, cuadre_id, fecha, codproducto, producto, lote, location, direccion, cod_movimiento, cantidad, tipo, motivo, responsable, estado) values
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'B12', 'salida', '702', -540, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'B13', 'ingreso', '701', 540, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'CARACOL', 'salida', '702', -280, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'A22', 'ingreso', '701', 276, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'A26', 'salida', '702', -320, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'AV', 'ingreso', '701', 35, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B10', 'salida', '702', -540, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B11', 'salida', '702', -707, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B12', 'ingreso', '701', 540, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B13', 'ingreso', '701', 540, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B9', 'ingreso', '701', 540, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260929', 'A1', 'salida', '702', -105, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000002', 'Indupan Panificacion 50 Kg.', '20260929', 'C11', 'ingreso', '701', 105, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000003', 'Indupan Premium 50 Kg.', '20260829', 'AV', 'ingreso', '701', 51, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000003', 'Indupan Premium 50 Kg.', '20260831', 'A20', 'salida', '702', -22, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000003', 'Indupan Premium 50 Kg.', '20260831', 'AV', 'ingreso', '701', 22, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000003', 'Indupan Premium 50 Kg.', '20260912', 'A20', 'ingreso', '701', 11, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000003', 'Indupan Premium 50 Kg.', '20260917', 'AV', 'ingreso', '701', 4, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000003', 'Indupan Premium 50 Kg.', '20260923', 'A27', 'salida', '702', -74, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000003', 'Indupan Premium 50 Kg.', '20260923', 'C4', 'ingreso', '701', 90, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000003', 'Indupan Premium 50 Kg.', '20260928', 'AV', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000003', 'Indupan Premium 50 Kg.', '20261209', 'A23', 'salida', '702', -1, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260612', 'AV', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260911', 'CARACOL', 'ingreso', '701', 7, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260912', 'CARACOL', 'salida', '702', -5, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260928', 'AV', 'ingreso', '701', 13, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000006', 'Indupan Panificacion 12.5 Kg.', '20260928', 'CARACOL', 'salida', '702', -13, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000009', 'Mogolla Kg.', '20260925', 'M1', 'salida', '702', -218, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000009', 'Mogolla Kg.', '20260926', 'M1', 'salida', '702', -50, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000010', 'Indupan Integral 50 Kg.', '20260827', 'AV', 'ingreso', '701', 21, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000010', 'Indupan Integral 50 Kg.', '20260828', 'AV', 'ingreso', '701', 68, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000010', 'Indupan Integral 50 Kg.', '20260829', 'AV', 'ingreso', '701', 105, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000010', 'Indupan Integral 50 Kg.', '20260829', 'B16', 'salida', '702', -194, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000010', 'Indupan Integral 50 Kg.', '20260917', 'AV', 'ingreso', '701', 21, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000011', 'Indupan Panificacion 25 Kg.', '20260919', 'A13', 'salida', '702', -2, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000011', 'Indupan Panificacion 25 Kg.', '20260924', 'AV', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000011', 'Indupan Panificacion 25 Kg.', '20260928', 'AV', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000011', 'Indupan Panificacion 25 Kg.', '20260928', 'CARACOL', 'salida', '702', -1, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000012', 'Salvado Kg.', '20260826', 'S1', 'salida', '702', -11, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000012', 'Salvado Kg.', '20260915', 'S1', 'salida', '702', -267, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000016', 'NIEVE PAPEL 25', '20260817', 'AV', 'salida', '702', -69, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260821', 'A12', 'salida', '702', -1, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260916', 'A12', 'salida', '702', -16, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260916', 'AV', 'ingreso', '701', 6, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260922', 'C6', 'ingreso', '701', 285, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260922', 'C7', 'ingreso', '701', 252, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000016', 'PT LA NIEVE PAPEL PANADERIA 25KG', '20260922', 'CARACOL', 'salida', '702', -543, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000018', 'Surtida 250 Gr. X 24 Und.', '20260926', 'AV', 'salida', '702', -1, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000019', 'PT ESPAGUETI CAPRISSIMA 1000GR*12PQ', '20260926', 'AV', 'salida', '702', -1, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000021', 'PT HARINA PREC MAIZ 20KG BLANCA', '20260926', 'AV', 'salida', '702', -13, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000035', 'PT MACARRON G.250GR*24PQ', '20260909', 'AV', 'salida', '702', -87, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000036', 'PT MACARRON C.250GR*24PQ', '20260909', 'AV', 'salida', '702', -87, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000036', 'PT MACARRON C.250GR*24PQ', '20260929', 'AV', 'salida', '702', -87, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000043', 'PT HARINA PREC MAIZ 24LB BLANCA', '20260926', 'AV', 'salida', '702', -4, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000044', 'indupan panificacion 1000Kg x20', '20260529', 'AV', 'salida', '702', -2, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000044', 'indupan panificacion 1000Kg x20', '20260805', 'A20', 'ingreso', '701', 79, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000044', 'indupan panificacion 1000Kg x20', '20260910', 'A19', 'salida', '702', -1, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000044', 'indupan panificacion 1000Kg x20', '20260910', 'AV', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000044', 'indupan panificacion 1000Kg x20', '20260911', 'A19', 'salida', '702', -3, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000044', 'indupan panificacion 1000Kg x20', '20260911', 'AV', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000044', 'indupan panificacion 1000Kg x20', '20260925', 'A20', 'ingreso', '701', 655, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000045', 'Indupan Especial 25 Kg.', '20260829', 'AV', 'ingreso', '701', 6, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000045', 'Indupan Especial 25 Kg.', '20260829', 'P', 'salida', '702', -6, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000045', 'Indupan Especial 25 Kg.', '20260925', 'AV', 'ingreso', '701', 2, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260822', 'P', 'ingreso', '701', 202, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260909', 'P', 'ingreso', '701', 2515, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260910', 'P', 'ingreso', '701', 798, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260914', 'AV', 'ingreso', '701', 1, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260914', 'P', 'ingreso', '701', 957, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260915', 'AV', 'ingreso', '701', 3, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260915', 'P', 'salida', '702', -1721, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260916', 'AV', 'ingreso', '701', 3, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260916', 'P', 'salida', '702', -724, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260917', 'AV', 'ingreso', '701', 4, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260918', 'P', 'ingreso', '701', 94, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260919', 'AV', 'ingreso', '701', 7, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260919', 'P', 'ingreso', '701', 120, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260921', 'P', 'ingreso', '701', 34, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260929', 'AV', 'ingreso', '701', 3, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260929', 'P', 'ingreso', '701', 3600, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260930', 'AV', 'ingreso', '701', 1292, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000048', 'PT LA NIEVE 25LB', '20260930', 'P', 'ingreso', '701', 1330, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260728', 'AV', 'salida', '702', -1, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260814', 'P', 'salida', '702', -4, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260821', 'A14', 'ingreso', '701', 3, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260821', 'AV', 'ingreso', '701', 2, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000054', 'PT LA INSUPERABLE POLI PANADERIA 50 KG BOGOTA', '20260828', 'A17', 'salida', '702', -10, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000057', 'PT LA INSUPERABLE REPOSTERIA 50KG', '20260811', 'AV', 'ingreso', '701', 11, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000057', 'PT LA INSUPERABLE REPOSTERIA 50KG', '20260827', 'AV', 'ingreso', '701', 106, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000057', 'PT LA INSUPERABLE REPOSTERIA 50KG', '20260901', 'S1', 'salida', '702', -117, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000059', 'PT LA NIEVE POLI PANADERIA 50KG', '20260829', 'A19', 'salida', '702', -7, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000059', 'PT LA NIEVE PAPEL PANADERIA 50KG', '20260831', 'C4', 'ingreso', '701', 27, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000059', 'PT LA NIEVE PAPEL PANADERIA 50KG', '20260916', 'C4', 'salida', '702', -20, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000080', 'PT FIDEO 250*24PQ', '20260926', 'AV', 'salida', '702', -8, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000094', 'Harina la Nieve 1000 Gr. X 20 Und.', '20260916', 'A16', 'salida', '702', -13, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000094', 'Harina la Nieve 1000 Gr. X 20 Und.', '20260916', 'P', 'ingreso', '701', 15, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000094', 'Harina la Nieve 1000 Gr. X 20 Und.', '20260925', 'P', 'ingreso', '701', 101, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000100', 'Harina de Tercera', '20260913', 'S1', 'salida', '702', -98, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000100', 'Harina de Tercera', '20260914', 'S1', 'salida', '702', -132, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000100', 'Harina de Tercera', '20260915', 'S1', 'salida', '702', -118, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado');
  insert into sig_inventario_ajuste (proyecto_id, cuadre_id, fecha, codproducto, producto, lote, location, direccion, cod_movimiento, cantidad, tipo, motivo, responsable, estado) values
    (1, v_cuadre, '2026-09-30', 'PT000100', 'Harina de Tercera', '20260916', 'S1', 'salida', '702', -76, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000100', 'Harina de Tercera', '20260917', 'S1', 'salida', '702', -45, 'faltante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado'),
    (1, v_cuadre, '2026-09-30', 'PT000189', 'Indupan Premium 12,5 Kg.', '20260925', 'AV', 'ingreso', '701', 75, 'sobrante', 'Ajuste por conteo físico (cuadre)', 'gerenciageneral@lip-sas.com', 'registrado');

  update sig_inventario_cuadre set estado = 'cerrado', updated_at = now() where id = v_cuadre;
  raise notice 'Correcciones generadas: 203 (estado registrado, sin aprobar)';
end
$cargue$;
commit;

-- =========================== DESPUÉS ================================
select 'conteo creado' as verificacion, id, fecha, tipo, estado, activo, items, items_con_diferencia, total_sistema, total_conteo, total_diferencia
  from sig_inventario_cuadre where proyecto_id = 1 and tipo = 'total' and fecha = '2026-10-01' order by id;
select 'líneas por origen' as verificacion, coalesce(observacion, 'del archivo físico') as origen, count(*) as lineas, round(sum(sistema)::numeric,2) as sistema, round(sum(conteo)::numeric,2) as conteo
  from sig_inventario_cuadre_detalle d
  where d.cuadre_id = (select max(id) from sig_inventario_cuadre where proyecto_id = 1 and tipo = 'total' and fecha = '2026-10-01')
  group by 1, 2 order by 3 desc;
select 'correcciones por tipo' as verificacion, tipo, cod_movimiento, estado, count(*) as lineas, round(sum(cantidad)::numeric,2) as unidades
  from sig_inventario_ajuste
  where cuadre_id = (select max(id) from sig_inventario_cuadre where proyecto_id = 1 and tipo = 'total' and fecha = '2026-10-01')
  group by 1, 2, 3, 4 order by 2;
select 'conteo por producto' as verificacion, codproducto, max(producto) as producto, round(sum(sistema)::numeric,2) as sistema, round(sum(conteo)::numeric,2) as conteo, round(sum(diferencia)::numeric,2) as diferencia
  from sig_inventario_cuadre_detalle
  where cuadre_id = (select max(id) from sig_inventario_cuadre where proyecto_id = 1 and tipo = 'total' and fecha = '2026-10-01')
  group by 1, 2 order by abs(sum(diferencia)) desc;

-- Queda pendiente, en la pantalla "Cuadre y Correcciones de Inventario":
--   1) revisar las 203 correcciones del conteo;
--   2) aprobarlas con la clave del responsable (ahí se mueve el stock);
--   3) el conteo queda 'cerrado' y activo, que es lo que exige obtenerBaseDelMes
--      para tomarlo como base de 2026-10.
