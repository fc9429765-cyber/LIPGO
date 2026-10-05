-- =====================================================================
-- 232 · ID1: borrar 6 salidas 702 del Cuadre #13 que duplican, con la MISMA cifra, una
--       corrección del Cuadre #14 sobre el mismo lote. Autorizado por gerencia el 2026-10-05
--       ("puedes borrarlo"). Corrección POR ID con estado esperado verificado fila por fila.
--
-- Contexto: el 1-sep-2026 hubo DOS Conteos totales de ID1 (#13 del archivo físico, #14 del
-- coordinador) y el 5-sep se contabilizaron los dos. 6 lotes quedaron exactamente en
-- −duplicado y sin ningún movimiento posterior: esos se limpian aquí (235 und). El resto
-- (21 lotes con cifras distintas) NO se toca: se resuelve con el Conteo total de octubre.
--
-- CÓMO CORRERLO (Supabase › SQL Editor), en DOS pasos:
--   PASO 1 · Ejecutar SOLO el bloque "ANTES" (un SELECT, no cambia nada). Deben salir 6 filas
--            con ok = true, saldo_hoy = -cantidad y ultimo_mov = invtrans.
--   PASO 2 · Ejecutar el bloque "CORRECCIÓN" completo (desde BEGIN hasta el SELECT final).
--            Verifica cada fila; si algo no coincide, aborta y NO cambia nada. Al final muestra
--            el DESPUÉS: saldo_lote = 0 en las 6 y el total de cada producto subido en lo borrado.
--
-- Qué hace en cada fila: borra el movimiento invtrans por id y ANULA su corrección en
-- sig_inventario_ajuste (activo = false, motivo escrito), conservando invtrans_id para que no
-- se pueda reactivar ni reversar. La auditoría de la base guarda el "antes" de cada borrado;
-- además se deja copia en la tabla respaldo_20261005_pares_cuadre13.
-- =====================================================================

-- ============================== ANTES (solo lectura) ==================
with pares(invtrans, ajuste, par14, producto, lote, location, cantidad) as (
  values (29517, 117, 29484, 'Harina la Nieve 1000 Gr. X 10 Und.', '20260627', 'P',   10),
         (29516, 118, 29483, 'Harina la Nieve 1000 Gr. X 10 Und.', '20260706', 'P',   50),
         (29532, 102, 29501, 'Indupan Especial Industrial 50 Kg.', '20260723', 'A20', 140),
         (29531, 103, 29500, 'Indupan Especial Industrial 50 Kg.', '20260807', 'A25', 24),
         (29538,  96, 29504, 'Indupan Panificacion 50 Kg.',        '20260831', 'A27', 7),
         (29520, 114, 29486, 'PT LA NIEVE POLI PANADERIA 50KG',    '20260606', 'A18', 4)
), saldos as (
  select p.invtrans,
         round(coalesce(sum(case when t.tipomov ilike 'entrada%' then abs(t.cantidad) else -abs(t.cantidad) end)
                        filter (where t.status ilike 'apr%'), 0)::numeric, 2) as saldo_hoy,
         max(t.id) as ultimo_mov
    from pares p
    left join invtrans t on t.idempresa = 1 and t.nombreproducto = p.producto and t.lote = p.lote and t.location = p.location
   group by p.invtrans
), totales as (
  select nombreproducto,
         round(coalesce(sum(case when tipomov ilike 'entrada%' then abs(cantidad) else -abs(cantidad) end)
                        filter (where status ilike 'apr%'), 0)::numeric, 2) as total_producto
    from invtrans
   where idempresa = 1 and nombreproducto in (select distinct producto from pares)
   group by nombreproducto
)
select p.invtrans, p.ajuste, p.par14, p.producto, p.lote, p.location, p.cantidad,
       i.cantidad as cant_fila, i.cod_movimiento, i.status, left(i.observaciones, 45) as obs,
       a.activo as aj_activo, a.estado as aj_estado, a.invtrans_id as aj_invtrans,
       s.saldo_hoy, s.ultimo_mov, tt.total_producto,
       (i.id is not null and i.idempresa = 1 and i.nombreproducto = p.producto and i.lote = p.lote and i.location = p.location
        and abs(i.cantidad) = p.cantidad and i.tipomov = 'Salida' and i.cod_movimiento = '702' and i.status ilike 'apr%'
        and i.observaciones like '%cuadre #13%' and i.observaciones like '%[aj#' || p.ajuste || ']%'
        and a.id is not null and a.cuadre_id = 13 and a.invtrans_id = p.invtrans and a.activo and a.estado = 'aprobado'
        and s.saldo_hoy = -p.cantidad and s.ultimo_mov = p.invtrans) as ok
  from pares p
  left join invtrans i on i.id = p.invtrans
  left join sig_inventario_ajuste a on a.id = p.ajuste
  left join saldos s on s.invtrans = p.invtrans
  left join totales tt on tt.nombreproducto = p.producto
 order by p.invtrans;

-- ============================== CORRECCIÓN ============================
begin;

create table if not exists public.respaldo_20261005_pares_cuadre13 as
  select now() as respaldado_en, i.*
    from invtrans i
   where i.id in (29517, 29516, 29532, 29531, 29538, 29520);

do $$
declare
  p record;
  i record;
  a record;
  saldo numeric;
  ultimo bigint;
  n int;
begin
  for p in
    select * from (values
      (29517, 117, 29484, 'Harina la Nieve 1000 Gr. X 10 Und.', '20260627', 'P',   10),
      (29516, 118, 29483, 'Harina la Nieve 1000 Gr. X 10 Und.', '20260706', 'P',   50),
      (29532, 102, 29501, 'Indupan Especial Industrial 50 Kg.', '20260723', 'A20', 140),
      (29531, 103, 29500, 'Indupan Especial Industrial 50 Kg.', '20260807', 'A25', 24),
      (29538,  96, 29504, 'Indupan Panificacion 50 Kg.',        '20260831', 'A27', 7),
      (29520, 114, 29486, 'PT LA NIEVE POLI PANADERIA 50KG',    '20260606', 'A18', 4)
    ) as v(invtrans, ajuste, par14, producto, lote, location, cantidad)
  loop
    -- 1) el movimiento a borrar está exactamente como se esperaba
    select * into i from invtrans where id = p.invtrans;
    if not found then
      raise exception 'invtrans % no existe', p.invtrans;
    end if;
    if i.idempresa <> 1 or i.nombreproducto <> p.producto or i.lote <> p.lote or i.location <> p.location
       or abs(i.cantidad) <> p.cantidad or i.tipomov <> 'Salida' or i.cod_movimiento <> '702'
       or i.status not ilike 'apr%' or i.observaciones not like '%cuadre #13%'
       or i.observaciones not like '%[aj#' || p.ajuste || ']%' then
      raise exception 'invtrans % no está en el estado esperado: % | % | % | % | % | %',
        p.invtrans, i.nombreproducto, i.lote, i.location, i.cantidad, i.cod_movimiento, i.status;
    end if;
    -- 2) su corrección en el cuadre #13, activa y contabilizada con ese movimiento
    select * into a from sig_inventario_ajuste where id = p.ajuste;
    if not found or a.cuadre_id <> 13 or a.invtrans_id <> p.invtrans or a.activo is not true or a.estado <> 'aprobado' then
      raise exception 'ajuste % no está en el estado esperado', p.ajuste;
    end if;
    -- 3) la pareja del cuadre #14 existe con la misma cifra sobre el mismo lote
    perform 1 from invtrans
      where id = p.par14 and nombreproducto = p.producto and lote = p.lote and location = p.location
        and abs(cantidad) = p.cantidad and cod_movimiento = '702' and observaciones like '%cuadre #14%';
    if not found then
      raise exception 'la pareja del #14 (%) no es la esperada', p.par14;
    end if;
    -- 4) el lote está hoy exactamente en −cantidad y no tiene movimientos posteriores
    select round(coalesce(sum(case when tipomov ilike 'entrada%' then abs(cantidad) else -abs(cantidad) end)
                          filter (where status ilike 'apr%'), 0)::numeric, 2), max(id)
      into saldo, ultimo
      from invtrans
     where idempresa = 1 and nombreproducto = p.producto and lote = p.lote and location = p.location;
    if saldo <> -p.cantidad then
      raise exception '% % @%: saldo de hoy % (se esperaba -%); ya no es un caso limpio', p.producto, p.lote, p.location, saldo, p.cantidad;
    end if;
    if ultimo <> p.invtrans then
      raise exception '% % @%: hay movimientos posteriores (último id %)', p.producto, p.lote, p.location, ultimo;
    end if;
    -- 5) nadie la reversó ya
    perform 1 from sig_inventario_ajuste where activo and soporte like '%[rev de aj#' || p.ajuste || ']%';
    if found then
      raise exception 'la corrección % ya tiene reverso registrado', p.ajuste;
    end if;

    -- aplicar, por id
    delete from invtrans where id = p.invtrans and lote = p.lote and cod_movimiento = '702';
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'invtrans %: se afectaron % filas', p.invtrans, n;
    end if;
    update sig_inventario_ajuste
       set activo = false,
           motivo = coalesce(motivo, '') || ' · Anulada el 2026-10-05 por instrucción de gerencia: duplicaba con la misma cifra la corrección del Cuadre #14 (invtrans '
                    || p.par14 || ') sobre el mismo lote; el movimiento invtrans ' || p.invtrans || ' se borró.'
     where id = p.ajuste and cuadre_id = 13;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'ajuste %: se afectaron % filas', p.ajuste, n;
    end if;
    raise notice 'borrado invtrans % · anulado ajuste #% (% % @%, %)', p.invtrans, p.ajuste, p.producto, p.lote, p.location, p.cantidad;
  end loop;
end $$;

commit;

-- ============================== DESPUÉS ===============================
with pares(invtrans, ajuste, producto, lote, location, cantidad) as (
  values (29517, 117, 'Harina la Nieve 1000 Gr. X 10 Und.', '20260627', 'P',   10),
         (29516, 118, 'Harina la Nieve 1000 Gr. X 10 Und.', '20260706', 'P',   50),
         (29532, 102, 'Indupan Especial Industrial 50 Kg.', '20260723', 'A20', 140),
         (29531, 103, 'Indupan Especial Industrial 50 Kg.', '20260807', 'A25', 24),
         (29538,  96, 'Indupan Panificacion 50 Kg.',        '20260831', 'A27', 7),
         (29520, 114, 'PT LA NIEVE POLI PANADERIA 50KG',    '20260606', 'A18', 4)
), saldos as (
  select p.invtrans,
         round(coalesce(sum(case when t.tipomov ilike 'entrada%' then abs(t.cantidad) else -abs(t.cantidad) end)
                        filter (where t.status ilike 'apr%'), 0)::numeric, 2) as saldo_lote
    from pares p
    left join invtrans t on t.idempresa = 1 and t.nombreproducto = p.producto and t.lote = p.lote and t.location = p.location
   group by p.invtrans
), totales as (
  select nombreproducto,
         round(coalesce(sum(case when tipomov ilike 'entrada%' then abs(cantidad) else -abs(cantidad) end)
                        filter (where status ilike 'apr%'), 0)::numeric, 2) as total_producto
    from invtrans
   where idempresa = 1 and nombreproducto in (select distinct producto from pares)
   group by nombreproducto
)
select p.invtrans, p.ajuste, p.producto, p.lote, p.location, p.cantidad,
       (select count(*) from invtrans where id = p.invtrans) as fila_existe,   -- debe ser 0
       a.activo as aj_activo,                                                 -- debe ser false
       s.saldo_lote,                                                          -- debe ser 0
       tt.total_producto                                                      -- Harina 1000 Gr x10: -60 → 0 · Especial Industrial: -164 → 0 · Panificacion 50: 17963 → 17970 · PT LA NIEVE POLI: 303 → 307
  from pares p
  left join sig_inventario_ajuste a on a.id = p.ajuste
  left join saldos s on s.invtrans = p.invtrans
  left join totales tt on tt.nombreproducto = p.producto
 order by p.invtrans;
