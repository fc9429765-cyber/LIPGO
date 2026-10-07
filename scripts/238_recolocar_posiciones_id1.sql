-- =====================================================================
-- RECOLOCAR LAS POSICIONES DE ID1 tras el conteo #40.
--
-- Qué pasó: el 2026-10-01 el coordinador cuadró el sistema A MANO con el mismo
-- conteo físico (136 traslados 311/309). Al contabilizar después las
-- correcciones del conteo, esa misma reubicación quedó aplicada DOS VECES, y la
-- reclasificación que tapó los negativos movió unidades a lotes que no eran.
-- El total del inventario y el inventario inicial del mes están bien; lo que
-- quedó mal es en qué lote y posición está la mercancía.
--
-- Objetivo de cada posición: el físico del conteo + TODO lo que pasó después
-- del corte, salvo el cuadre manual del 2026-10-01 (ya está dentro del físico) y los
-- movimientos del propio conteo y su reclasificación (el duplicado).
--
-- Qué hace: 22 pares (salida + entrada, no cambian el total de ningún
-- producto): 6 traslados de ubicación (311) y 16 reclasificaciones de lote (309),
-- 1.947 und en total. Fechados hoy.
-- Al terminar, cada posición queda EXACTA al objetivo y ninguna en negativo:
-- el SQL lo verifica contra la lista y, si no cuadra, deshace todo.
-- =====================================================================

-- ============================ ANTES =================================
select 'posiciones mal ubicadas' as foto, count(*) as posiciones from (
  select 1 from saldoinvdetalle where idempresa = 1 and stock_actual <> 0) x;
select 'B3 y B4' as foto, codproducto, lote, location, stock_actual
  from saldoinvdetalle where idempresa = 1 and location in ('B3','B4') and stock_actual <> 0 order by location, lote;
select 'total y negativos' as foto, round(sum(stock_actual)::numeric,2) as und, count(*) filter (where stock_actual < 0) as negativas
  from saldoinvdetalle where idempresa = 1;

-- ========================== CORRECCIÓN ==============================
begin;
do $reubicar$
declare
  v_base int;
  v_dup int;
  v_mal int;
  v_neg int;
  v_und_antes numeric;
  v_und_despues numeric;
begin
  select count(*) into v_dup from invtrans where idempresa = 1 and observaciones like '%[reub#40]%';
  if v_dup > 0 then
    raise exception 'Ya hay % movimiento(s) de esta recolocación: no se repite.', v_dup;
  end if;
  select round(sum(stock_actual)::numeric, 2) into v_und_antes from saldoinvdetalle where idempresa = 1;
  select coalesce(max(id), 0) into v_base from invtrans;

  -- Pares (de dónde sale -> a dónde entra). 311 = misma caja de lote, otra posición; 309 = otro lote.
  create temporary table tmp_reub (n int, codproducto text, producto text, lote_origen text, loc_origen text, lote_destino text, loc_destino text, cantidad numeric, codigo text) on commit drop;
  insert into tmp_reub (n, codproducto, producto, lote_origen, loc_origen, lote_destino, loc_destino, cantidad, codigo) values
    (1, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B9', '20260928', 'B10', 373, '311'),
    (2, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260924', 'C7', '20260924', 'B16', 280, '311'),
    (3, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260925', 'B16', '20260919', 'B5', 180, '309'),
    (4, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260930', 'CARACOL', '20260925', 'A27', 171, '309'),
    (5, 'PT000001', 'Indupan Especial 50 Kg.', '20260927', 'A15', '20260927', 'C2', 135, '311'),
    (6, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B13', '20260928', 'B10', 132, '311'),
    (7, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260930', 'CARACOL', '20260923', 'A9', 123, '309'),
    (8, 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'A17', '20260930', 'B6', 116, '311'),
    (9, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260930', 'CARACOL', '20260919', 'B4', 80, '309'),
    (10, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260930', 'CARACOL', '20260923', 'A8', 80, '309'),
    (11, 'PT000001', 'Indupan Especial 50 Kg.', '20260930', 'A16', '20260930', 'B6', 69, '311'),
    (12, 'PT000001', 'Indupan Especial 50 Kg.', '20260915', 'B1', '20260914', 'B1', 55, '309'),
    (13, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260923', 'A21', '20260919', 'B5', 45, '309'),
    (14, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260930', 'CARACOL', '20260928', 'A22', 35, '309'),
    (15, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B13', '20260919', 'B5', 26, '309'),
    (16, 'PT000001', 'Indupan Especial 50 Kg.', '20260917', 'A25', '20260911', 'AV', 11, '309'),
    (17, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260928', 'B13', '20260925', 'A27', 9, '309'),
    (18, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260930', 'CARACOL', '20260923', 'AV', 9, '309'),
    (19, 'PT000002', 'Indupan Panificacion 50 Kg.', '20260930', 'B6', '20260923', 'AV', 8, '309'),
    (20, 'PT000001', 'Indupan Especial 50 Kg.', '20260917', 'A25', '20260904', 'AV', 4, '309'),
    (21, 'PT000001', 'Indupan Especial 50 Kg.', '20260917', 'A25', '20260914', 'B1', 3, '309'),
    (22, 'PT000001', 'Indupan Especial 50 Kg.', '20260917', 'A25', '20260909', 'AV', 3, '309');

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
    'Recolocación por el conteo #40: ' || t.lote_origen || '/' || t.loc_origen || ' -> ' || t.lote_destino || '/' || t.loc_destino || ' (la reubicación del inventario inicial quedó aplicada dos veces) [reub#40]',
    t.codigo,
    'gerenciageneral@lip-sas.com',
    now()
  from tmp_reub t
  cross join (select 1 as orden union all select 2) m
  left join productos p on p.codigo = t.codproducto
  left join locations l on l.codigo = (case when m.orden = 1 then t.loc_origen else t.loc_destino end) and l.idempresa = 1
  left join almacenes alm on alm.id = l.bodega;
  raise notice 'Movimientos de recolocación: % (22 pares x 2)', 44;

  insert into sig_inventario_ajuste
    (proyecto_id, cuadre_id, fecha, codproducto, producto, lote, location, direccion, cod_movimiento, cantidad, tipo, motivo, responsable, estado, aprobado_por, aprobado_fecha)
  select 1, null, current_date, t.codproducto, t.producto,
         case when m.orden = 1 then t.lote_origen else t.lote_destino end,
         case when m.orden = 1 then t.loc_origen else t.loc_destino end,
         case when m.orden = 1 then 'salida' else 'ingreso' end,
         t.codigo,
         case when m.orden = 1 then -t.cantidad else t.cantidad end,
         case when t.codigo = '311' then 'traslado' else 'reclasificacion' end,
         'Recolocación tras el conteo #40: ' || t.lote_origen || '/' || t.loc_origen || ' -> ' || t.lote_destino || '/' || t.loc_destino,
         'gerenciageneral@lip-sas.com', 'aprobado', 'gerenciageneral@lip-sas.com', now()
    from tmp_reub t cross join (select 1 as orden union all select 2) m;

  -- Control: cada posición debe quedar EXACTA al objetivo y ninguna en negativo.
  create temporary table tmp_objetivo (codproducto text, lote text, location text, cantidad numeric) on commit drop;
  insert into tmp_objetivo (codproducto, lote, location, cantidad) values
    ('PT000001', '20260904', 'AV', 8),
    ('PT000001', '20260909', 'AV', 6),
    ('PT000001', '20260911', 'AV', 22),
    ('PT000001', '20260914', 'B1', 450),
    ('PT000001', '20260915', 'B1', 303),
    ('PT000001', '20260915', 'B2', 234),
    ('PT000001', '20260925', 'A12', 75),
    ('PT000001', '20260925', 'B15', 366),
    ('PT000001', '20260926', 'A6', 931),
    ('PT000001', '20260926', 'AV', 6),
    ('PT000001', '20260926', 'B14', 540),
    ('PT000001', '20260926', 'B15', 1043),
    ('PT000001', '20260927', 'C2', 380),
    ('PT000001', '20260929', 'A23', 840),
    ('PT000001', '20260929', 'B6', 557),
    ('PT000001', '20260930', 'A16', 1),
    ('PT000001', '20260930', 'B2', 306),
    ('PT000001', '20260930', 'B6', 588),
    ('PT000002', '20260611', 'AV', 2),
    ('PT000002', '20260621', 'A3', 499),
    ('PT000002', '20260919', 'B4', 160),
    ('PT000002', '20260919', 'B5', 693),
    ('PT000002', '20260923', 'A21', 203),
    ('PT000002', '20260923', 'A7', 12),
    ('PT000002', '20260923', 'A8', 481),
    ('PT000002', '20260923', 'A9', 807),
    ('PT000002', '20260923', 'AV', 34),
    ('PT000002', '20260924', 'A7', 980),
    ('PT000002', '20260924', 'B16', 1600),
    ('PT000002', '20260925', 'A27', 1764),
    ('PT000002', '20260925', 'C3', 393),
    ('PT000002', '20260927', 'AV', 280),
    ('PT000002', '20260927', 'B13', 540),
    ('PT000002', '20260927', 'CARACOL', 1295),
    ('PT000002', '20260928', 'A22', 875),
    ('PT000002', '20260928', 'AV', 35),
    ('PT000002', '20260928', 'B10', 1045),
    ('PT000002', '20260928', 'B12', 540),
    ('PT000002', '20260928', 'B13', 373),
    ('PT000002', '20260928', 'B9', 167),
    ('PT000002', '20260929', 'A1', 160),
    ('PT000002', '20260929', 'C11', 105),
    ('PT000002', '20260930', 'B6', 532),
    ('PT000002', '20260930', 'CARACOL', 102),
    ('PT000003', '20260829', 'AV', 51),
    ('PT000003', '20260831', 'AV', 22),
    ('PT000003', '20260917', 'AV', 4),
    ('PT000003', '20260923', 'C4', 106),
    ('PT000003', '20260928', 'AV', 1),
    ('PT000006', '20260612', 'AV', 1),
    ('PT000006', '20260912', 'CARACOL', 192),
    ('PT000006', '20260928', 'AV', 13),
    ('PT000010', '20260827', 'AV', 21),
    ('PT000010', '20260828', 'AV', 68),
    ('PT000010', '20260829', 'AV', 105),
    ('PT000010', '20260917', 'AV', 21),
    ('PT000011', '20260919', 'A13', 107),
    ('PT000011', '20260924', 'AV', 1),
    ('PT000011', '20260928', 'AV', 1),
    ('PT000012', '20260826', 'S1', 11),
    ('PT000012', '20260915', 'S1', 117),
    ('PT000016', '20260922', 'C6', 275),
    ('PT000018', '20260926', 'AV', 1),
    ('PT000019', '20260926', 'AV', 1),
    ('PT000021', '20260926', 'AV', 13),
    ('PT000035', '20260909', 'AV', 87),
    ('PT000036', '20260909', 'AV', 87),
    ('PT000036', '20260929', 'AV', 87),
    ('PT000043', '20260926', 'AV', 4),
    ('PT000044', '20260910', 'AV', 1),
    ('PT000044', '20260911', 'AV', 1),
    ('PT000044', '20260925', 'A20', 1098),
    ('PT000045', '20260829', 'AV', 3),
    ('PT000045', '20260925', 'AV', 2),
    ('PT000048', '20260909', 'P', 3192),
    ('PT000048', '20260910', 'P', 798),
    ('PT000048', '20260914', 'AV', 1),
    ('PT000048', '20260914', 'P', 1784),
    ('PT000048', '20260915', 'AV', 3),
    ('PT000048', '20260916', 'AV', 3),
    ('PT000048', '20260917', 'AV', 4),
    ('PT000048', '20260918', 'P', 2793),
    ('PT000048', '20260919', 'AV', 7),
    ('PT000048', '20260919', 'P', 1801),
    ('PT000048', '20260921', 'P', 34),
    ('PT000048', '20260929', 'AV', 3),
    ('PT000048', '20260929', 'P', 7191),
    ('PT000048', '20260930', 'AV', 1292),
    ('PT000048', '20260930', 'P', 2260),
    ('PT000054', '20260821', 'A14', 37),
    ('PT000054', '20260821', 'AV', 2),
    ('PT000057', '20260811', 'AV', 11),
    ('PT000057', '20260827', 'AV', 56),
    ('PT000059', '20260831', 'C4', 27),
    ('PT000059', '20260916', 'C4', 280),
    ('PT000080', '20260926', 'AV', 8),
    ('PT000094', '20260916', 'P', 15),
    ('PT000094', '20260925', 'P', 101),
    ('PT000100', '20260913', 'S1', 98),
    ('PT000100', '20260914', 'S1', 132),
    ('PT000100', '20260915', 'S1', 118),
    ('PT000100', '20260916', 'S1', 76),
    ('PT000100', '20260917', 'S1', 45),
    ('PT000189', '20260925', 'AV', 75),
    ('PT000010', '20260917', 'A10', 21),
    ('PT000003', '20261002', 'A24', 785),
    ('PT000002', '20261002', 'A26', 707),
    ('PT000002', '20261002', 'A5', 791),
    ('PT000002', '20261003', 'A5', 139),
    ('PT000002', '20261003', 'A4', 930),
    ('PT000002', '20261003', 'A3', 930),
    ('PT000002', '20261003', 'A2', 489),
    ('PT000009', '20260930', 'M1', 1626);

  select count(*) into v_mal from (
    select coalesce(s.codproducto, o.codproducto) as cod, coalesce(s.lote, o.lote) as lote, coalesce(s.location, o.location) as loc,
           coalesce(s.und, 0) as hoy, coalesce(o.cantidad, 0) as objetivo
      from (select codproducto, lote, location, round(sum(stock_actual)::numeric,2) as und from saldoinvdetalle where idempresa = 1 group by 1,2,3) s
      full outer join tmp_objetivo o on o.codproducto = s.codproducto and coalesce(o.lote,'') = coalesce(s.lote,'') and coalesce(o.location,'') = coalesce(s.location,'')
  ) z where abs(z.hoy - z.objetivo) > 0.009;
  if v_mal > 0 then
    raise exception 'Quedaron % posiciones distintas del objetivo: se deshace todo.', v_mal;
  end if;
  select count(*) into v_neg from saldoinvdetalle where idempresa = 1 and stock_actual < 0;
  if v_neg > 0 then
    raise exception 'Quedaron % posiciones en negativo: se deshace todo.', v_neg;
  end if;
  select round(sum(stock_actual)::numeric, 2) into v_und_despues from saldoinvdetalle where idempresa = 1;
  raise notice 'Inventario: % -> % und · todas las posiciones cuadran · 0 negativas', v_und_antes, v_und_despues;
end
$reubicar$;
commit;

-- =========================== DESPUÉS ================================
select 'B3 y B4' as verificacion, codproducto, lote, location, stock_actual
  from saldoinvdetalle where idempresa = 1 and location in ('B3','B4') and stock_actual <> 0 order by location, lote;
-- Esperado: B4 PT000002 L20260919 = 160 · B3 PT000002 L20260920 = 0 · B4 PT000002 L20260920 = 0
select 'total y negativos' as verificacion, round(sum(stock_actual)::numeric,2) as und, count(*) filter (where stock_actual < 0) as negativas
  from saldoinvdetalle where idempresa = 1;
-- Esperado: 51.500 und y 0 negativas.
select 'movimientos de la recolocación' as verificacion, cod_movimiento, tipomov, count(*) as filas, round(sum(cantidad)::numeric,2) as und
  from invtrans where idempresa = 1 and observaciones like '%[reub#40]%' group by 1,2,3 order by 2,3;
select 'total por producto' as verificacion, codproducto, round(sum(stock_actual)::numeric,2) as und
  from saldoinvdetalle where idempresa = 1 group by 1,2 having sum(stock_actual) <> 0 order by 3 desc;
