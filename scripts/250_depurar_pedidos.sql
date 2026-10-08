
-- =====================================================================
-- 250_depurar_pedidos.sql   ·   GENERADO el 2026-10-07
--
-- NO SE EDITA A MANO. Se regenera con:
--   npx tsx --env-file=.env.local scripts/generar_depuracion_pedidos.mts
--
-- Saca de la cola los pedidos que nunca se van a entregar. NO BORRA NADA: los deja
-- con su estado final, el motivo, quién y cuándo, y se siguen consultando en Historial.
-- NO toca las líneas del pedido, ni el inventario, ni las órdenes de cargue.
--
-- QUIÉN DECIDIÓ QUÉ ENTRA. Los ids NO salen de una consulta escrita a mano: salen de
-- `derivarEstado` (lib/pedidos-estado.ts), la MISMA función con la que la pantalla
-- "Depurar pendientes" arma su lista. Por eso el conjunto es exactamente el que vería
-- el usuario, y no una reinterpretación en SQL que podría barrer de más.
--
-- LAS DOS REGLAS, tal como las aplica el módulo:
--   · Sin rastro logístico y viejo  → "no entregado". Candado: sin orden de cargue,
--     sin vehículo, sin fecha de orden y sin fecha de entrega.
--   · Parcial de más de 30 días     → "entrega parcial". Lo ya cargado se conserva.
--
-- Motivo aplicado: Vencido sin gestión
-- Autoriza: Admon Indupan (queda en depurado_por y en autorizacion_log)
--
-- CORRER UN BLOQUE A LA VEZ, en este orden: primero ID4 y ID5, que son los pequeños y
-- sirven de ensayo; después los grandes. Cada bloque es una transacción aparte.
--
-- RESUMEN DE LO QUE VA A PASAR:
--   ID 1 Harinera Indupan         190 abiertos →  154 no entregado ·   20 entrega parcial
--   ID 2 Avimol                   301 abiertos →   75 no entregado ·  207 entrega parcial
--   ID 3 Cedi Funza               538 abiertos →  471 no entregado ·   13 entrega parcial
--   ID 4 Cedi Medellín              3 abiertos →    3 no entregado ·    0 entrega parcial
--   ID 5 Demogistics SAS            1 abiertos →    1 no entregado ·    0 entrega parcial
--   TOTAL                               704 +  240 = 944
-- =====================================================================

-- =====================================================================
-- ID 1 · Harinera Indupan
-- 154 sin rastro logístico → "no entregado"
-- 20 parciales viejos      → "entrega parcial"
-- de 190 pedidos abiertos.
-- =====================================================================

-- ANTES. Guardar esta salida.
select estado, count(*) from public.pedidoscabecera where id_empresa = 1 group by estado order by 2 desc;

begin;

do $dep_1$
declare
  v_sin int := 0;
  v_par int := 0;
begin
  -- SIN RASTRO LOGÍSTICO → "no entregado".
  -- Mismos candados que el módulo: solo abiertos y sin ningún rastro.
  with hechos as (
    update public.pedidoscabecera
       set estado            = 'no entregado',
           motivo_no_entrega = 'Vencido sin gestión',
           depurado_por      = 'Admon Indupan',
           depurado_en       = now()
     where id_empresa = 1
       and idpedido in (
    189, 190, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 315, 316, 320, 321, 322,
    323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342,
    343, 344, 345, 346, 347, 348, 349, 350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 360, 362, 363,
    364, 365, 366, 367, 369, 370, 412, 552, 575, 1184, 1435, 1483, 1485, 1487, 1488, 1489, 1497, 1506, 1562, 1768,
    2069, 2207, 2351, 2392, 2419, 2850, 3008, 3152, 3209, 3257, 3276, 3814, 3852, 3956, 4015, 4118, 4282, 4322, 4913, 5106,
    5107, 5108, 5109, 5278, 5318, 5435, 5548, 5605, 5659, 5698, 5884, 5931, 6674, 6760, 7625, 7626, 7838, 7839, 7840, 7841,
    7842, 7998, 8169, 8794, 8928, 9283, 9307, 9369, 9378, 9403, 9535, 9613, 9631, 9889, 9903, 10000, 10256, 10289, 10462, 10687,
    10830, 10967, 10986, 11096, 11130, 11395, 11397, 11514, 11533, 11629, 11958, 12008, 12030, 12155
       )
       and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'))
       and ocargue is null and vehiculo is null and fechaordencargue is null and fechadeentrega is null
    returning 1)
  select count(*) into v_sin from hechos;
  raise notice 'ID 1: % pedidos quedaron como NO ENTREGADO (se esperaban 154).', v_sin;
  -- PARCIALES VIEJOS → "entrega parcial". Lo cargado se conserva.
  with hechos as (
    update public.pedidoscabecera
       set estado            = 'entrega parcial',
           motivo_no_entrega = 'Vencido sin gestión',
           depurado_por      = 'Admon Indupan',
           depurado_en       = now()
     where id_empresa = 1
       and idpedido in (
    447, 587, 686, 690, 1914, 4155, 4359, 5549, 5552, 5830, 5949, 5954, 5955, 8109, 8556, 9508, 9524, 10452, 10477, 11463
       )
       and lower(estado) = 'parcial'
    returning 1)
  select count(*) into v_par from hechos;
  raise notice 'ID 1: % pedidos quedaron como ENTREGA PARCIAL (se esperaban 20).', v_par;

  -- El rastro de quién autorizó, igual que lo deja la pantalla.
  -- OJO: `detalle` es de tipo JSONB, no texto: un literal suelto revienta el bloque
  -- con "invalid input syntax for type json". Por eso va con jsonb_build_object.
  insert into public.autorizacion_log (usuario, proceso, idempresa, resultado, autorizado_por, referencia, detalle)
  values ('Admon Indupan', 'ped_depurar', 1, 'ok', 'Admon Indupan',
          'depurar ' || (v_sin + v_par)::text || ' pedido(s) por SQL',
          jsonb_build_object(
            'script', '250_depurar_pedidos.sql',
            'generado', '2026-10-07',
            'motivo', 'Vencido sin gestión',
            'no_entregado', v_sin,
            'entrega_parcial', v_par,
            'criterio', 'derivarEstado (lib/pedidos-estado.ts), la misma funcion de la pantalla Depurar pendientes'
          ));

  -- NADA se borra y NADA se toca de las líneas ni del inventario.
end
$dep_1$;

commit;

-- DESPUÉS.
select estado, count(*) from public.pedidoscabecera where id_empresa = 1 group by estado order by 2 desc;
select count(*) as abiertos_que_quedan from public.pedidoscabecera
 where id_empresa = 1
   and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'));


-- =====================================================================
-- ID 2 · Avimol
-- 75 sin rastro logístico → "no entregado"
-- 207 parciales viejos      → "entrega parcial"
-- de 301 pedidos abiertos.
-- =====================================================================

-- ANTES. Guardar esta salida.
select estado, count(*) from public.pedidoscabecera where id_empresa = 2 group by estado order by 2 desc;

begin;

do $dep_2$
declare
  v_sin int := 0;
  v_par int := 0;
begin
  -- SIN RASTRO LOGÍSTICO → "no entregado".
  -- Mismos candados que el módulo: solo abiertos y sin ningún rastro.
  with hechos as (
    update public.pedidoscabecera
       set estado            = 'no entregado',
           motivo_no_entrega = 'Vencido sin gestión',
           depurado_por      = 'Admon Indupan',
           depurado_en       = now()
     where id_empresa = 2
       and idpedido in (
    1547, 2042, 2663, 2987, 3030, 3057, 3390, 3411, 3432, 3528, 3878, 4098, 5089, 5151, 5247, 5641, 6139, 6275, 6434, 6549,
    6664, 6944, 7158, 7190, 7266, 7552, 7558, 7597, 7598, 7792, 8077, 8125, 8212, 8215, 8227, 8272, 8281, 8321, 8382, 8406,
    8549, 8581, 8603, 8644, 8671, 8740, 8747, 8984, 9560, 9592, 9642, 9652, 10009, 10015, 10017, 10158, 10196, 10299, 10400, 10608,
    10625, 10635, 10991, 11205, 11334, 11554, 11596, 11697, 11744, 11956, 11961, 12085, 12143, 12171, 12175
       )
       and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'))
       and ocargue is null and vehiculo is null and fechaordencargue is null and fechadeentrega is null
    returning 1)
  select count(*) into v_sin from hechos;
  raise notice 'ID 2: % pedidos quedaron como NO ENTREGADO (se esperaban 75).', v_sin;
  -- PARCIALES VIEJOS → "entrega parcial". Lo cargado se conserva.
  with hechos as (
    update public.pedidoscabecera
       set estado            = 'entrega parcial',
           motivo_no_entrega = 'Vencido sin gestión',
           depurado_por      = 'Admon Indupan',
           depurado_en       = now()
     where id_empresa = 2
       and idpedido in (
    1082, 1176, 1390, 1426, 1458, 1491, 1536, 1574, 1652, 1707, 1720, 1755, 1854, 1995, 2185, 2376, 2669, 2738, 3028, 3059,
    3391, 3407, 3436, 3588, 3631, 3657, 3781, 4026, 4085, 4097, 4107, 4254, 4293, 4316, 4325, 4352, 5038, 5057, 5091, 5153,
    5174, 5255, 5264, 5313, 5322, 5330, 5402, 5416, 5424, 5443, 5527, 5664, 5848, 5896, 5897, 5940, 6163, 6264, 6365, 6439,
    6613, 6622, 6713, 6716, 6722, 6756, 6762, 6812, 6843, 6962, 6994, 6996, 6997, 7122, 7138, 7278, 7316, 7353, 7473, 7555,
    7582, 7584, 7655, 7720, 7736, 7755, 7762, 7775, 7805, 7877, 7895, 7965, 7975, 8008, 8025, 8026, 8152, 8164, 8211, 8216,
    8288, 8344, 8363, 8424, 8425, 8454, 8471, 8510, 8580, 8585, 8600, 8602, 8643, 8654, 8745, 8766, 8843, 8912, 8923, 8941,
    8987, 9023, 9041, 9042, 9154, 9171, 9189, 9432, 9456, 9577, 9698, 9749, 9750, 9806, 9821, 9827, 9833, 9834, 9875, 9876,
    9892, 9899, 9957, 9958, 9961, 10008, 10020, 10056, 10061, 10099, 10142, 10193, 10277, 10285, 10344, 10371, 10393, 10511, 10627, 10686,
    10698, 10726, 10741, 10759, 10900, 11026, 11031, 11045, 11067, 11104, 11108, 11110, 11253, 11273, 11282, 11350, 11478, 11541, 11582, 11607,
    11620, 11677, 11694, 11743, 11752, 11781, 11805, 11870, 11931, 11955, 11976, 11992, 11993, 11994, 11996, 12055, 12056, 12087, 12091, 12135,
    12136, 12149, 12152, 12162, 12168, 12176, 12177
       )
       and lower(estado) = 'parcial'
    returning 1)
  select count(*) into v_par from hechos;
  raise notice 'ID 2: % pedidos quedaron como ENTREGA PARCIAL (se esperaban 207).', v_par;

  -- El rastro de quién autorizó, igual que lo deja la pantalla.
  -- OJO: `detalle` es de tipo JSONB, no texto: un literal suelto revienta el bloque
  -- con "invalid input syntax for type json". Por eso va con jsonb_build_object.
  insert into public.autorizacion_log (usuario, proceso, idempresa, resultado, autorizado_por, referencia, detalle)
  values ('Admon Indupan', 'ped_depurar', 2, 'ok', 'Admon Indupan',
          'depurar ' || (v_sin + v_par)::text || ' pedido(s) por SQL',
          jsonb_build_object(
            'script', '250_depurar_pedidos.sql',
            'generado', '2026-10-07',
            'motivo', 'Vencido sin gestión',
            'no_entregado', v_sin,
            'entrega_parcial', v_par,
            'criterio', 'derivarEstado (lib/pedidos-estado.ts), la misma funcion de la pantalla Depurar pendientes'
          ));

  -- NADA se borra y NADA se toca de las líneas ni del inventario.
end
$dep_2$;

commit;

-- DESPUÉS.
select estado, count(*) from public.pedidoscabecera where id_empresa = 2 group by estado order by 2 desc;
select count(*) as abiertos_que_quedan from public.pedidoscabecera
 where id_empresa = 2
   and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'));


-- =====================================================================
-- ID 3 · Cedi Funza
-- 471 sin rastro logístico → "no entregado"
-- 13 parciales viejos      → "entrega parcial"
-- de 538 pedidos abiertos.
-- =====================================================================

-- ANTES. Guardar esta salida.
select estado, count(*) from public.pedidoscabecera where id_empresa = 3 group by estado order by 2 desc;

begin;

do $dep_3$
declare
  v_sin int := 0;
  v_par int := 0;
begin
  -- SIN RASTRO LOGÍSTICO → "no entregado".
  -- Mismos candados que el módulo: solo abiertos y sin ningún rastro.
  with hechos as (
    update public.pedidoscabecera
       set estado            = 'no entregado',
           motivo_no_entrega = 'Vencido sin gestión',
           depurado_por      = 'Admon Indupan',
           depurado_en       = now()
     where id_empresa = 3
       and idpedido in (
    235, 236, 237, 238, 239, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 267, 268, 269, 270,
    271, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 300, 301, 302, 303, 304, 305, 306,
    307, 309, 311, 312, 313, 314, 371, 372, 373, 374, 375, 376, 377, 378, 379, 380, 524, 545, 553, 557,
    590, 593, 599, 602, 614, 679, 685, 741, 742, 747, 749, 751, 752, 753, 754, 763, 769, 807, 846, 861,
    922, 932, 1121, 1158, 1187, 1846, 2288, 2650, 2757, 3141, 3219, 3344, 3442, 3461, 3616, 3673, 3906, 3924, 3958, 4029,
    4033, 4037, 4038, 4045, 4076, 4079, 4130, 4131, 4136, 4164, 4225, 4226, 4283, 4396, 4397, 4399, 4456, 5020, 5076, 5078,
    5284, 5289, 5342, 5371, 5375, 5376, 5387, 5409, 5441, 5444, 5446, 5487, 5539, 5594, 5727, 5738, 5767, 5768, 5770, 5772,
    5773, 5774, 5775, 5810, 5813, 5814, 5815, 5878, 5879, 5908, 5963, 5964, 5966, 5981, 5988, 6017, 6026, 6028, 6047, 6064,
    6076, 6114, 6116, 6117, 6146, 6147, 6148, 6149, 6150, 6175, 6323, 6359, 6382, 6394, 6395, 6396, 6397, 6402, 6412, 6413,
    6415, 6418, 6441, 6445, 6495, 6496, 6497, 6498, 6606, 6609, 6612, 6676, 6698, 6710, 6786, 6787, 6788, 6790, 6791, 6793,
    6794, 6795, 6796, 6800, 6836, 6837, 6839, 6871, 6873, 6874, 6888, 6896, 6924, 6993, 7031, 7068, 7080, 7104, 7105, 7107,
    7130, 7131, 7197, 7249, 7284, 7303, 7304, 7345, 7346, 7348, 7349, 7355, 7386, 7445, 7483, 7517, 7535, 7538, 7564, 7614,
    7632, 7633, 7709, 7717, 7718, 7719, 7778, 7790, 7830, 7848, 7953, 7954, 7955, 7957, 7958, 7986, 8056, 8100, 8102, 8240,
    8249, 8252, 8254, 8258, 8259, 8260, 8261, 8317, 8329, 8381, 8476, 8498, 8539, 8544, 8566, 8568, 8569, 8570, 8594, 8595,
    8596, 8621, 8701, 8702, 8703, 8705, 8709, 8710, 8759, 8760, 8761, 8791, 8792, 8796, 8797, 8804, 8805, 8838, 8846, 8852,
    8853, 8862, 8867, 8876, 8877, 8879, 8880, 8882, 8883, 8887, 8911, 8918, 8920, 8955, 8994, 9031, 9063, 9103, 9142, 9144,
    9145, 9195, 9220, 9230, 9231, 9236, 9310, 9363, 9364, 9406, 9447, 9541, 9542, 9547, 9654, 9675, 9676, 9728, 9730, 9764,
    9778, 9781, 9785, 9786, 9844, 9846, 9867, 9950, 9967, 10037, 10039, 10040, 10058, 10087, 10135, 10148, 10163, 10168, 10173, 10174,
    10175, 10177, 10178, 10185, 10186, 10188, 10189, 10190, 10206, 10207, 10209, 10243, 10304, 10306, 10307, 10308, 10309, 10311, 10385, 10390,
    10427, 10453, 10478, 10479, 10488, 10494, 10496, 10497, 10498, 10545, 10546, 10547, 10579, 10604, 10639, 10722, 10724, 10738, 10739, 10783,
    10814, 10826, 10827, 10828, 10851, 10852, 10854, 10855, 10856, 10859, 10885, 10932, 10961, 10987, 11020, 11052, 11061, 11069, 11116, 11118,
    11119, 11122, 11126, 11169, 11178, 11190, 11194, 11195, 11264, 11267, 11268, 11275, 11309, 11310, 11338, 11363, 11380, 11407, 11421, 11422,
    11423, 11427, 11429, 11447, 11448, 11449, 11450, 11451, 11452, 11454, 11455, 11456, 11474, 11586, 11683, 11760, 11762, 11763, 11774, 11775,
    11776, 11777, 11778, 11790, 11817, 11821, 11822, 11936, 11967, 11968, 11969
       )
       and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'))
       and ocargue is null and vehiculo is null and fechaordencargue is null and fechadeentrega is null
    returning 1)
  select count(*) into v_sin from hechos;
  raise notice 'ID 3: % pedidos quedaron como NO ENTREGADO (se esperaban 471).', v_sin;
  -- PARCIALES VIEJOS → "entrega parcial". Lo cargado se conserva.
  with hechos as (
    update public.pedidoscabecera
       set estado            = 'entrega parcial',
           motivo_no_entrega = 'Vencido sin gestión',
           depurado_por      = 'Admon Indupan',
           depurado_en       = now()
     where id_empresa = 3
       and idpedido in (
    430, 596, 3114, 3835, 4236, 4237, 5465, 7485, 7959, 10208, 10680, 10858, 11230
       )
       and lower(estado) = 'parcial'
    returning 1)
  select count(*) into v_par from hechos;
  raise notice 'ID 3: % pedidos quedaron como ENTREGA PARCIAL (se esperaban 13).', v_par;

  -- El rastro de quién autorizó, igual que lo deja la pantalla.
  -- OJO: `detalle` es de tipo JSONB, no texto: un literal suelto revienta el bloque
  -- con "invalid input syntax for type json". Por eso va con jsonb_build_object.
  insert into public.autorizacion_log (usuario, proceso, idempresa, resultado, autorizado_por, referencia, detalle)
  values ('Admon Indupan', 'ped_depurar', 3, 'ok', 'Admon Indupan',
          'depurar ' || (v_sin + v_par)::text || ' pedido(s) por SQL',
          jsonb_build_object(
            'script', '250_depurar_pedidos.sql',
            'generado', '2026-10-07',
            'motivo', 'Vencido sin gestión',
            'no_entregado', v_sin,
            'entrega_parcial', v_par,
            'criterio', 'derivarEstado (lib/pedidos-estado.ts), la misma funcion de la pantalla Depurar pendientes'
          ));

  -- NADA se borra y NADA se toca de las líneas ni del inventario.
end
$dep_3$;

commit;

-- DESPUÉS.
select estado, count(*) from public.pedidoscabecera where id_empresa = 3 group by estado order by 2 desc;
select count(*) as abiertos_que_quedan from public.pedidoscabecera
 where id_empresa = 3
   and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'));


-- =====================================================================
-- ID 4 · Cedi Medellín
-- 3 sin rastro logístico → "no entregado"
-- 0 parciales viejos      → "entrega parcial"
-- de 3 pedidos abiertos.
-- =====================================================================

-- ANTES. Guardar esta salida.
select estado, count(*) from public.pedidoscabecera where id_empresa = 4 group by estado order by 2 desc;

begin;

do $dep_4$
declare
  v_sin int := 0;
  v_par int := 0;
begin
  -- SIN RASTRO LOGÍSTICO → "no entregado".
  -- Mismos candados que el módulo: solo abiertos y sin ningún rastro.
  with hechos as (
    update public.pedidoscabecera
       set estado            = 'no entregado',
           motivo_no_entrega = 'Vencido sin gestión',
           depurado_por      = 'Admon Indupan',
           depurado_en       = now()
     where id_empresa = 4
       and idpedido in (
    3789, 9353, 11623
       )
       and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'))
       and ocargue is null and vehiculo is null and fechaordencargue is null and fechadeentrega is null
    returning 1)
  select count(*) into v_sin from hechos;
  raise notice 'ID 4: % pedidos quedaron como NO ENTREGADO (se esperaban 3).', v_sin;

  -- El rastro de quién autorizó, igual que lo deja la pantalla.
  -- OJO: `detalle` es de tipo JSONB, no texto: un literal suelto revienta el bloque
  -- con "invalid input syntax for type json". Por eso va con jsonb_build_object.
  insert into public.autorizacion_log (usuario, proceso, idempresa, resultado, autorizado_por, referencia, detalle)
  values ('Admon Indupan', 'ped_depurar', 4, 'ok', 'Admon Indupan',
          'depurar ' || (v_sin + v_par)::text || ' pedido(s) por SQL',
          jsonb_build_object(
            'script', '250_depurar_pedidos.sql',
            'generado', '2026-10-07',
            'motivo', 'Vencido sin gestión',
            'no_entregado', v_sin,
            'entrega_parcial', v_par,
            'criterio', 'derivarEstado (lib/pedidos-estado.ts), la misma funcion de la pantalla Depurar pendientes'
          ));

  -- NADA se borra y NADA se toca de las líneas ni del inventario.
end
$dep_4$;

commit;

-- DESPUÉS.
select estado, count(*) from public.pedidoscabecera where id_empresa = 4 group by estado order by 2 desc;
select count(*) as abiertos_que_quedan from public.pedidoscabecera
 where id_empresa = 4
   and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'));


-- =====================================================================
-- ID 5 · Demogistics SAS
-- 1 sin rastro logístico → "no entregado"
-- 0 parciales viejos      → "entrega parcial"
-- de 1 pedidos abiertos.
-- =====================================================================

-- ANTES. Guardar esta salida.
select estado, count(*) from public.pedidoscabecera where id_empresa = 5 group by estado order by 2 desc;

begin;

do $dep_5$
declare
  v_sin int := 0;
  v_par int := 0;
begin
  -- SIN RASTRO LOGÍSTICO → "no entregado".
  -- Mismos candados que el módulo: solo abiertos y sin ningún rastro.
  with hechos as (
    update public.pedidoscabecera
       set estado            = 'no entregado',
           motivo_no_entrega = 'Vencido sin gestión',
           depurado_por      = 'Admon Indupan',
           depurado_en       = now()
     where id_empresa = 5
       and idpedido in (
    2814
       )
       and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'))
       and ocargue is null and vehiculo is null and fechaordencargue is null and fechadeentrega is null
    returning 1)
  select count(*) into v_sin from hechos;
  raise notice 'ID 5: % pedidos quedaron como NO ENTREGADO (se esperaban 1).', v_sin;

  -- El rastro de quién autorizó, igual que lo deja la pantalla.
  -- OJO: `detalle` es de tipo JSONB, no texto: un literal suelto revienta el bloque
  -- con "invalid input syntax for type json". Por eso va con jsonb_build_object.
  insert into public.autorizacion_log (usuario, proceso, idempresa, resultado, autorizado_por, referencia, detalle)
  values ('Admon Indupan', 'ped_depurar', 5, 'ok', 'Admon Indupan',
          'depurar ' || (v_sin + v_par)::text || ' pedido(s) por SQL',
          jsonb_build_object(
            'script', '250_depurar_pedidos.sql',
            'generado', '2026-10-07',
            'motivo', 'Vencido sin gestión',
            'no_entregado', v_sin,
            'entrega_parcial', v_par,
            'criterio', 'derivarEstado (lib/pedidos-estado.ts), la misma funcion de la pantalla Depurar pendientes'
          ));

  -- NADA se borra y NADA se toca de las líneas ni del inventario.
end
$dep_5$;

commit;

-- DESPUÉS.
select estado, count(*) from public.pedidoscabecera where id_empresa = 5 group by estado order by 2 desc;
select count(*) as abiertos_que_quedan from public.pedidoscabecera
 where id_empresa = 5
   and (estado is null or lower(estado) not in ('entregado','entrega parcial','anulado','no entregado'));
