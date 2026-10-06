-- =====================================================================
-- SINCRONIZAR LOS LOTES de ID1 con el inventario inicial del 2026-10-01.
--
-- Correr DESPUÉS del SQL de posteo del conteo #40.
--
-- Por qué: el conteo se contabiliza días después del corte y la operación ya
-- despachó sobre la estructura vieja de lotes, así que 49 lote(s) quedan en
-- negativo (-9.281 und): se despachó de un lote que, según el conteo físico, no
-- tenía esas unidades — salieron de otro lote del mismo producto. El remedio del
-- sistema para eso es la RECLASIFICACIÓN DE LOTE (código 309).
--
-- Qué hace: 74 pares 309 (Salida del lote origen + Entrada al lote negativo),
-- 9.281 und en total, fechados hoy (son movimientos de octubre, no tocan el
-- cierre de septiembre ni el inventario inicial). El total de cada producto NO cambia:
-- solo se mueve entre lotes. Después de esto ningún lote queda negativo.
--
-- REGLA DE ASIGNACIÓN (instrucción de gerencia 2026-10-05): el lote origen es el
-- LOTE MÁS PRÓXIMO del mismo producto, es decir el de fecha de lote más cercana al
-- lote que quedó en negativo (desempate: misma ubicación y luego mayor saldo).
-- En estos 74 pares la distancia media es de 4.9 días y 31 son del mismo día.
-- Es una asignación por regla, no evidencia: si el coordinador sabe de qué lote
-- salió de verdad, se corrige con otra 309. Cada par queda registrado en
-- sig_inventario_ajuste con su motivo y es reversible.
-- =====================================================================

-- ============================ ANTES =================================
select 'lotes negativos' as foto, codproducto, nombreproducto, lote, location, stock_actual
  from saldoinvdetalle where idempresa = 1 and stock_actual < 0 order by stock_actual;
select 'total por producto' as foto, codproducto, round(sum(stock_actual)::numeric,2) as und
  from saldoinvdetalle where idempresa = 1 group by 1 having sum(stock_actual) <> 0 order by 2 desc;

-- ========================== CORRECCIÓN ==============================
begin;
do $recl$
declare
  v_base int;
  v_neg int;
  v_dup int;
begin
  -- Guarda 1: el conteo #40 ya debe estar contabilizado.
  if not exists (select 1 from sig_inventario_cuadre where id = 40 and estado = 'aprobado') then
    raise exception 'Primero hay que contabilizar y aprobar el conteo #40.';
  end if;
  -- Guarda 2: no repetir la reclasificación.
  select count(*) into v_dup from invtrans where observaciones like '%[recl#40]%';
  if v_dup > 0 then
    raise exception 'Ya hay % movimiento(s) de esta reclasificación: no se repite.', v_dup;
  end if;
  -- Guarda 3: deben seguir existiendo los lotes negativos que se van a corregir.
  select count(*) into v_neg from saldoinvdetalle where idempresa = 1 and stock_actual < 0;
  if v_neg = 0 then
    raise exception 'No hay lotes negativos: nada que reclasificar.';
  end if;
  raise notice 'Lotes negativos antes: %', v_neg;

  select coalesce(max(id), 0) into v_base from invtrans;

  -- Pares (lote origen -> lote destino) con el código 309. Dos movimientos por par.
  create temporary table tmp_recl (n int, codproducto text, producto text, lote_origen text, loc_origen text, lote_destino text, loc_destino text, cantidad numeric) on commit drop;
  insert into tmp_recl (n, codproducto, producto, lote_origen, loc_origen, lote_destino, loc_destino, cantidad) values
    (1, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'B16', '20260924', 'B15', 1320),
    (2, 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'A23', '20260929', 'A25', 805),
    (3, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260922', 'A1', '20260922', 'A2', 15),
    (4, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260922', 'A4', '20260922', 'A2', 10),
    (5, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260922', 'A3', '20260922', 'A2', 5),
    (6, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A8', '20260922', 'A2', 609),
    (7, 'PT000001', 'Indupan Especial 50 Kg.', '20260929', 'B6', '20260929', 'B8', 557),
    (8, 'PT000016', 'Harina de Tercera Kg.', '20260922', 'C6', '20260922', 'CARACOL', 537),
    (9, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'B3', '20260920', 'A20', 526),
    (10, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'B3', '20260920', 'B5', 460),
    (11, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260921', 'AV', '20260921', 'A3', 12),
    (12, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'C5', '20260921', 'A3', 406),
    (13, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'C6', '20260921', 'A3', 28),
    (14, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260914', 'AV', '20260914', 'B9', 5),
    (15, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260913', 'AV', '20260914', 'B9', 17),
    (16, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260915', 'AV', '20260914', 'B9', 5),
    (17, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260917', 'AV', '20260914', 'B9', 4),
    (18, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260918', 'AV', '20260914', 'B9', 2),
    (19, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B5', '20260914', 'B9', 369),
    (20, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260927', 'CARACOL', '20260927', 'B11', 378),
    (21, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'C6', '20260921', 'A2', 252),
    (22, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'B3', '20260921', 'A2', 53),
    (23, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260920', 'AV', '20260921', 'A2', 16),
    (24, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260921', 'A2', 1),
    (25, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'A22', '20260928', 'A26', 311),
    (26, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A21', '20260922', 'A21', 302),
    (27, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'B16', '20260924', 'C6', 280),
    (28, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'A27', '20260925', 'B15', 196),
    (29, 'PT000010', 'Indupan Integral 50 Kg.', '20260829', 'A18', '20260829', 'B16', 140),
    (30, 'PT000010', 'Indupan Integral 50 Kg.', '20260829', 'AV', '20260829', 'B16', 54),
    (31, 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'B6', '20260930', 'C1', 185),
    (32, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B9', '20260928', 'B11', 167),
    (33, 'PT000001', 'Indupan Especial 50 Kg.', '20260918', 'A25', '20260918', 'A24', 143),
    (34, 'PT000001', 'Indupan Especial 50 Kg.', '20260918', 'A10', '20260918', 'A24', 11),
    (35, 'PT000001', 'Indupan Especial 50 Kg.', '20260918', 'AV', '20260918', 'A24', 7),
    (36, 'PT000001', 'Indupan Especial 50 Kg.', '20260917', 'A25', '20260918', 'A24', 3),
    (37, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'A27', '20260925', 'C2', 160),
    (38, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B5', '20260920', 'A22', 140),
    (39, 'PT000001', 'Indupan Especial 50 Kg.', '20260828', 'AV', '20260828', 'A11', 42),
    (40, 'PT000001', 'Indupan Especial 50 Kg.', '20260831', 'AV', '20260828', 'A11', 33),
    (41, 'PT000001', 'Indupan Especial 50 Kg.', '20260904', 'AV', '20260828', 'A11', 4),
    (42, 'PT000001', 'Indupan Especial 50 Kg.', '20260909', 'AV', '20260828', 'A11', 3),
    (43, 'PT000001', 'Indupan Especial 50 Kg.', '20260911', 'AV', '20260828', 'A11', 11),
    (44, 'PT000001', 'Indupan Especial 50 Kg.', '20260914', 'B1', '20260828', 'A11', 5),
    (45, 'PT000001', 'Indupan Especial 50 Kg.', '20260925', 'B15', '20260925', 'B14', 91),
    (46, 'PT000003', 'Indupan Premium 50 Kg.', '20260923', 'C4', '20260923', 'A27', 74),
    (47, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B4', '20260919', 'A23', 60),
    (48, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B4', '20260918', 'B9', 54),
    (49, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B4', '20260914', 'B8', 46),
    (50, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B5', '20260914', 'B8', 5),
    (51, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260919', 'B5', '20260920', 'B4', 26),
    (52, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260920', 'B4', 24),
    (53, 'PT000057', 'PT LA INSUPERABLE REPOSTERIA 50KG', '20260827', 'AV', '20260901', 'S1', 50),
    (54, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260621', 'A3', '20260725', 'A23', 41),
    (55, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'AV', '20260911', 'AV', 17),
    (56, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260911', 'AV', 19),
    (57, 'PT000001', 'Indupan Especial 50 Kg.', '20260914', 'B1', '20260831', 'C7', 33),
    (58, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260822', 'AV', 25),
    (59, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260827', 'AV', 21),
    (60, 'PT000001', 'Indupan Especial 50 Kg.', '20260914', 'B1', '20260828', 'A10', 20),
    (61, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260824', 'AV', 13),
    (62, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260912', 'AV', 12),
    (63, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260828', 'CARACOL', 10),
    (64, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260919', 'B8', 9),
    (65, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260918', 'B10', 8),
    (66, 'PT000059', 'PT LA NIEVE POLI PANADERIA 50KG', '20260829', 'C4', '20260829', 'A19', 7),
    (67, 'PT000016', 'Harina de Tercera Kg.', '20260916', 'AV', '20260916', 'A12', 6),
    (68, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260915', 'B14', 5),
    (69, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260917', 'B11', 4),
    (70, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260914', 'CARACOL', 3),
    (71, 'PT000045', 'Indupan Especial 25 Kg.', '20260829', 'AV', '20260829', 'P', 3),
    (72, 'PT000001', 'Indupan Especial 50 Kg.', '20200910', 'AV', '20200910', 'C7', 2),
    (73, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260914', 'B15', 2),
    (74, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A9', '20260917', 'B10', 2);

  -- Salida del lote origen (309) y Entrada al lote destino (309).
  insert into invtrans
    (id, idempresa, idproducto, codproducto, nombreproducto, lote, location, almacen, cantidad, tipomov, status, origen, observaciones, cod_movimiento, creadopor, creado)
  select
    v_base + row_number() over (order by t.n, m.orden),
    1,
    coalesce(p.id, 0),
    t.codproducto,
    t.producto,
    case when m.orden = 1 then t.lote_origen else t.lote_destino end,
    case when m.orden = 1 then t.loc_origen else t.loc_destino end,
    alm.nombre,
    t.cantidad,
    case when m.orden = 1 then 'Salida' else 'Entrada' end,
    'aprobado',
    'transaccion manual',
    'Reclasificación de lote por conteo #40: ' || t.lote_origen || '/' || t.loc_origen || ' -> ' || t.lote_destino || '/' || t.loc_destino || ' (lote negativo tras el inventario inicial del 2026-10-01) [recl#40]',
    '309',
    'gerenciageneral@lip-sas.com',
    now()
  from tmp_recl t
  cross join (select 1 as orden union all select 2) m
  left join productos p on p.codigo = t.codproducto
  left join locations l on l.codigo = (case when m.orden = 1 then t.loc_origen else t.loc_destino end) and l.idempresa = 1
  left join almacenes alm on alm.id = l.bodega;
  raise notice 'Movimientos de reclasificación insertados: % (74 pares x 2)', 148;

  -- Queda registrado también como corrección (sin cuadre: es posterior al conteo).
  insert into sig_inventario_ajuste
    (proyecto_id, cuadre_id, fecha, codproducto, producto, lote, location, direccion, cod_movimiento, cantidad, tipo, motivo, responsable, estado, aprobado_por, aprobado_fecha)
  select 1, null, current_date, t.codproducto, t.producto,
         case when m.orden = 1 then t.lote_origen else t.lote_destino end,
         case when m.orden = 1 then t.loc_origen else t.loc_destino end,
         case when m.orden = 1 then 'salida' else 'ingreso' end,
         '309',
         case when m.orden = 1 then -t.cantidad else t.cantidad end,
         'reclasificacion',
         'Reclasificación de lote tras el inventario inicial del 2026-10-01 (conteo #40): ' || t.lote_origen || '/' || t.loc_origen || ' -> ' || t.lote_destino || '/' || t.loc_destino,
         'gerenciageneral@lip-sas.com', 'aprobado', 'gerenciageneral@lip-sas.com', now()
    from tmp_recl t cross join (select 1 as orden union all select 2) m;

  select count(*) into v_neg from saldoinvdetalle where idempresa = 1 and stock_actual < 0;
  raise notice 'Lotes negativos después: %', v_neg;
  if v_neg > 0 then
    raise exception 'Quedaron % lotes negativos: se deshace todo y hay que revisar.', v_neg;
  end if;
end
$recl$;
commit;

-- =========================== DESPUÉS ================================
select 'lotes negativos (debe ser 0)' as verificacion, count(*) as lotes
  from saldoinvdetalle where idempresa = 1 and stock_actual < 0;
select 'movimientos de reclasificación' as verificacion, tipomov, cod_movimiento, count(*) as filas, round(sum(cantidad)::numeric,2) as und
  from invtrans where observaciones like '%[recl#40]%' group by 1,2 order by 1;
-- Esperado: 74 Salida y 74 Entrada, 9.281 und cada lado (neto 0).
select 'total por producto' as verificacion, codproducto, round(sum(stock_actual)::numeric,2) as und
  from saldoinvdetalle where idempresa = 1 group by 1 having sum(stock_actual) <> 0 order by 2 desc;
-- Esperado: idéntico al ANTES (la reclasificación no cambia totales por producto).
