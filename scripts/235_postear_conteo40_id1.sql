-- =====================================================================
-- CONTABILIZAR el Conteo total #40 de ID1 (fecha 2026-10-01) y dejarlo APROBADO.
--
-- Hace exactamente lo que el botón "Cerrar mes (ajusta stock)" de la pantalla
-- (cerrarMesCuadre -> postCorreccionInvtrans -> marcarAjusteAprobado):
--   * inserta en invtrans un movimiento por corrección, fechado 2026-09-30 15:00Z
--     (la corrección pertenece al mes que se cierra), status 'aprobado',
--     origen 'transaccion manual', con el marcador [aj#id] en observaciones
--     que da idempotencia;
--   * marca cada corrección como aprobada con su invtrans_id;
--   * deja el conteo en 'aprobado' = inventario inicial en firme de 2026-10.
--
-- Correcciones a contabilizar: 186 (97 sobrante 701 +26.256 / 89 faltante 702 -16.955).
-- Efecto en el stock: 9.301 und netas; el saldo de los 15 productos del conteo
-- queda igual al físico del coordinador más los movimientos ya registrados desde el corte.
--
-- AVISO: 49 lote(s) quedan en negativo (-9.281 und) porque la operación
-- despachó del 1 al 5 de octubre sobre la estructura vieja de lotes. Los totales por
-- producto quedan correctos. Eso se corrige con el SQL siguiente (reclasificación 309).
-- =====================================================================

-- ============================ ANTES =================================
select 'cabecera' as foto, id, fecha, estado, activo, items, items_con_diferencia, total_sistema, total_conteo, total_diferencia from sig_inventario_cuadre where id = 40;
select 'correcciones' as foto, estado, tipo, cod_movimiento, count(*) as lineas, round(sum(cantidad)::numeric,2) as und, count(invtrans_id) as posteadas
  from sig_inventario_ajuste where cuadre_id = 40 and activo is true group by 1,2,3,4 order by 4;
select 'stock vivo total' as foto, round(sum(stock_actual)::numeric,2) as und, count(*) filter (where stock_actual < 0) as lotes_negativos
  from saldoinvdetalle where idempresa = 1;

-- ========================== CORRECCIÓN ==============================
begin;
do $postear$
declare
  v_base int;
  v_pend int;
  v_ins int;
  v_marc int;
  v_dup int;
begin
  -- Guarda 1: el conteo debe estar contado/cerrado y activo.
  if not exists (select 1 from sig_inventario_cuadre where id = 40 and activo is true and estado in ('contado','cerrado')) then
    raise exception 'El conteo #40 no está activo en estado contado/cerrado.';
  end if;
  -- Guarda 2: nada posteado antes (idempotencia por el marcador).
  select count(*) into v_dup from invtrans where observaciones like '%cuadre #40%';
  if v_dup > 0 then
    raise exception 'Ya hay % movimiento(s) de este conteo en invtrans: no se postea dos veces.', v_dup;
  end if;
  -- Guarda 3: el número de correcciones pendientes debe ser el verificado.
  select count(*) into v_pend from sig_inventario_ajuste where cuadre_id = 40 and activo is true and invtrans_id is null;
  if v_pend <> 186 then
    raise exception 'Se esperaban 186 correcciones pendientes y hay % (¿falta correr el SQL anterior?).', v_pend;
  end if;
  -- Guarda 4: los productos que el archivo no menciona ya no deben tener correcciones
  -- (las retira el SQL previo). Si todavía están, este SQL no se puede correr.
  if exists (select 1 from sig_inventario_ajuste where cuadre_id = 40
              and codproducto in ('PT000009', 'PT000012', 'PT000018', 'PT000019', 'PT000021', 'PT000035', 'PT000036', 'PT000043', 'PT000080', 'PT000100')) then
    raise exception 'Todavía hay correcciones de los productos no contados: hay que correr primero el SQL que los deja con el saldo del sistema.';
  end if;

  select coalesce(max(id), 0) into v_base from invtrans;

  -- Un movimiento por corrección, con los mismos campos que postCorreccionInvtrans.
  insert into invtrans
    (id, idempresa, idproducto, codproducto, nombreproducto, lote, location, almacen, cantidad, tipomov, status, origen, observaciones, cod_movimiento, creadopor, creado)
  select
    v_base + row_number() over (order by a.id),
    a.proyecto_id,
    coalesce(p.id, 0),
    a.codproducto,
    a.producto,
    a.lote,
    a.location,
    alm.nombre,
    abs(a.cantidad),
    case when a.tipo = 'averia' then 'Reproceso' when a.direccion = 'salida' then 'Salida' else 'Entrada' end,
    'aprobado',
    'transaccion manual',
    'Corrección de inventario · cuadre #' || a.cuadre_id || ' · ' || a.tipo || coalesce(' · ' || a.motivo, '') || ' [aj#' || a.id || ']',
    a.cod_movimiento,
    'gerenciageneral@lip-sas.com',
    (a.fecha::text || ' 15:00:00+00')::timestamptz
  from sig_inventario_ajuste a
  left join productos p on p.codigo = a.codproducto
  left join locations l on l.codigo = a.location and l.idempresa = a.proyecto_id
  left join almacenes alm on alm.id = l.bodega
  where a.cuadre_id = 40 and a.activo is true and a.invtrans_id is null;
  get diagnostics v_ins = row_count;
  raise notice 'Movimientos insertados en invtrans: %', v_ins;

  -- Cada corrección queda aprobada y amarrada a su movimiento (por el marcador).
  update sig_inventario_ajuste a
     set estado = 'aprobado', aprobado_por = 'gerenciageneral@lip-sas.com', aprobado_fecha = now(), invtrans_id = i.id
    from invtrans i
   where a.cuadre_id = 40 and a.activo is true and a.invtrans_id is null
     and i.observaciones like '%[aj#' || a.id || ']%';
  get diagnostics v_marc = row_count;
  raise notice 'Correcciones marcadas como aprobadas: %', v_marc;
  if v_marc <> v_ins then
    raise exception 'Se insertaron % movimientos pero se marcaron % correcciones: se deshace todo.', v_ins, v_marc;
  end if;

  update sig_inventario_cuadre set estado = 'aprobado', updated_at = now() where id = 40;
  raise notice 'Conteo #40 APROBADO = inventario inicial en firme de 2026-10';
end
$postear$;
commit;

-- =========================== DESPUÉS ================================
select 'cabecera' as verificacion, id, fecha, estado, activo, items, items_con_diferencia, total_sistema, total_conteo, total_diferencia from sig_inventario_cuadre where id = 40;
-- Esperado: estado = 'aprobado'.
select 'correcciones' as verificacion, estado, tipo, cod_movimiento, count(*) as lineas, round(sum(cantidad)::numeric,2) as und, count(invtrans_id) as posteadas
  from sig_inventario_ajuste where cuadre_id = 40 and activo is true group by 1,2,3,4 order by 4;
-- Esperado: todas 'aprobado' y posteadas = lineas.
select 'movimientos creados' as verificacion, tipomov, cod_movimiento, status, count(*) as filas, round(sum(cantidad)::numeric,2) as und, min(creado) as desde, max(creado) as hasta
  from invtrans where observaciones like '%cuadre #40%' group by 1,2,3,4 order by 3;
-- Esperado: 97 Entrada 701 y 89 Salida 702, todos fechados 2026-09-30.
select 'stock vivo total' as verificacion, round(sum(stock_actual)::numeric,2) as und, count(*) filter (where stock_actual < 0) as lotes_negativos
  from saldoinvdetalle where idempresa = 1;
-- Esperado: 51.500 und y 49 lotes negativos (los arregla el SQL de reclasificación).
select 'lotes negativos' as verificacion, codproducto, nombreproducto, lote, location, stock_actual
  from saldoinvdetalle where idempresa = 1 and stock_actual < 0 order by stock_actual;
