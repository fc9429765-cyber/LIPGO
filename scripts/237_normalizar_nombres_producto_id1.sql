-- =====================================================================
-- NORMALIZAR EL NOMBRE DE PRODUCTO EN ID1 (Harinera Indupan).
--
-- Problema: la vista `saldoinvdetalle` agrupa por (empresa, código, NOMBRE, lote,
-- ubicación), así que un mismo código con dos nombres parte el lote en dos filas.
-- Eso ya obligó a rehacer la reclasificación del conteo #40 (la entrada con un
-- nombre no cancelaba la fila negativa con el otro) y ensucia cualquier reporte
-- por producto.
--
-- Qué se cambia: SOLO el texto del nombre, al del catálogo (`productos.nombre`).
-- NO se toca ninguna cantidad, ni lote, ni ubicación, ni estado, ni fecha.
-- Son 4 códigos de ID1 y 43 filas en total:
--
--   PT000013  "Nieve Panificacion 50 Kg."          ->  "PT LA NIEVE 25LB LEUDANTE"
--   PT000016  "Harina de Tercera Kg." / "NIEVE PAPEL 25"
--                                                  ->  "PT LA NIEVE PAPEL PANADERIA 25KG"
--   PT000035  "Papel Nieve Panificacion 12.5 Kg."  ->  "PT MACARRON G.250GR*24PQ"
--   PT000059  "PT LA NIEVE PAPEL PANADERIA 50KG"   ->  "PT LA NIEVE POLI PANADERIA 50KG"
--
-- Revisado fila por fila antes de escribir esto:
--   * Los nombres de enero ("Nieve Panificacion 50 Kg.", "Harina de Tercera Kg.",
--     "Papel Nieve Panificacion 12.5 Kg.") son del maestro viejo: NO existen hoy en
--     el catálogo, así que no son un código apuntando a otro producto actual, y los
--     lotes de esas filas están en cero.
--   * "NIEVE PAPEL 25" es la abreviatura que usó el coordinador (conteo #13 y
--     movimientos 311/309); mismo producto, confirmado con el alias de septiembre.
--   * Las 3 filas de PT000059 con el nombre "PAPEL" son las correcciones del conteo
--     #40 (decisión de alias de gerencia): mismo stock, otro nombre.
--
-- NO se toca ID3, que tiene 1 fila con un typo ("PT HARINA PREC MAIZ 24LB BLANCA00",
-- invtrans #1462): es otro proyecto y se informa aparte.
-- =====================================================================

-- ============================ ANTES =================================
select 'invtrans a renombrar' as foto, i.codproducto, i.nombreproducto as nombre_actual, p.nombre as nombre_catalogo, count(*) as filas
  from invtrans i join productos p on p.codigo = i.codproducto
 where i.idempresa = 1
   and i.codproducto in ('PT000013','PT000016','PT000035','PT000059')
   and coalesce(i.nombreproducto, '') <> p.nombre
 group by 1,2,3,4 order by 2,3;

select 'lineas de conteo a renombrar' as foto, d.codproducto, d.producto as nombre_actual, p.nombre as nombre_catalogo, count(*) as filas
  from sig_inventario_cuadre_detalle d
  join sig_inventario_cuadre c on c.id = d.cuadre_id and c.proyecto_id = 1
  join productos p on p.codigo = d.codproducto
 where coalesce(d.producto, '') <> p.nombre
 group by 1,2,3,4 order by 2,3;

select 'correcciones a renombrar' as foto, a.codproducto, a.producto as nombre_actual, p.nombre as nombre_catalogo, count(*) as filas
  from sig_inventario_ajuste a join productos p on p.codigo = a.codproducto
 where a.proyecto_id = 1 and coalesce(a.producto, '') <> p.nombre
 group by 1,2,3,4 order by 2,3;

select 'saldos de ID1' as foto, count(*) as filas_vista, count(*) filter (where stock_actual <> 0) as filas_con_saldo,
       count(*) filter (where stock_actual < 0) as filas_negativas, round(sum(stock_actual)::numeric,2) as und
  from saldoinvdetalle where idempresa = 1;
-- Esperado: 1766 filas, 0 negativas, 51.500 und.

-- ========================== CORRECCIÓN ==============================
begin;
do $norm$
declare
  v_und_antes numeric;
  v_und_despues numeric;
  v_neg int;
  v_it int;
  v_det int;
  v_aj int;
begin
  select round(sum(stock_actual)::numeric, 2) into v_und_antes from saldoinvdetalle where idempresa = 1;

  -- 1) Movimientos de inventario.
  update invtrans i
     set nombreproducto = p.nombre
    from productos p
   where i.idempresa = 1
     and p.codigo = i.codproducto
     and i.codproducto in ('PT000013','PT000016','PT000035','PT000059')
     and coalesce(i.nombreproducto, '') <> p.nombre;
  get diagnostics v_it = row_count;
  if v_it <> 27 then
    raise exception 'Se esperaban 27 movimientos por renombrar y se cambiaron %: se deshace todo.', v_it;
  end if;

  -- 2) Líneas de los conteos de ID1 (el nombre es descriptivo; la base del mes va por código).
  update sig_inventario_cuadre_detalle d
     set producto = p.nombre
    from productos p, sig_inventario_cuadre c
   where c.id = d.cuadre_id
     and c.proyecto_id = 1
     and p.codigo = d.codproducto
     and coalesce(d.producto, '') <> p.nombre;
  get diagnostics v_det = row_count;
  if v_det <> 11 then
    raise exception 'Se esperaban 11 lineas de conteo por renombrar y se cambiaron %: se deshace todo.', v_det;
  end if;

  -- 3) Correcciones de ID1.
  update sig_inventario_ajuste a
     set producto = p.nombre
    from productos p
   where a.proyecto_id = 1
     and p.codigo = a.codproducto
     and coalesce(a.producto, '') <> p.nombre;
  get diagnostics v_aj = row_count;
  if v_aj <> 5 then
    raise exception 'Se esperaban 5 correcciones por renombrar y se cambiaron %: se deshace todo.', v_aj;
  end if;

  raise notice 'Renombrados: % movimientos, % lineas de conteo, % correcciones', v_it, v_det, v_aj;

  -- 4) Control duro: el inventario NO puede cambiar ni aparecer un negativo.
  select round(sum(stock_actual)::numeric, 2) into v_und_despues from saldoinvdetalle where idempresa = 1;
  if v_und_antes is distinct from v_und_despues then
    raise exception 'El inventario cambio de % a % unidades: se deshace todo.', v_und_antes, v_und_despues;
  end if;
  select count(*) into v_neg from saldoinvdetalle where idempresa = 1 and stock_actual < 0;
  if v_neg > 0 then
    raise exception 'Aparecieron % filas negativas: se deshace todo.', v_neg;
  end if;
  raise notice 'Inventario intacto: % und, 0 filas negativas', v_und_despues;
end
$norm$;
commit;

-- =========================== DESPUÉS ================================
select 'nombres por codigo' as verificacion, i.codproducto, i.nombreproducto, count(*) as filas
  from invtrans i
 where i.idempresa = 1 and i.codproducto in ('PT000013','PT000016','PT000035','PT000059')
 group by 1,2,3 order by 2,3;
-- Esperado: UN solo nombre por codigo, el del catalogo.

select 'cualquier nombre fuera del catalogo (debe ser 0)' as verificacion, count(*) as filas
  from invtrans i join productos p on p.codigo = i.codproducto
 where i.idempresa = 1 and coalesce(i.nombreproducto, '') <> p.nombre;

select 'saldos de ID1' as verificacion, count(*) as filas_vista, count(*) filter (where stock_actual <> 0) as filas_con_saldo,
       count(*) filter (where stock_actual < 0) as filas_negativas, round(sum(stock_actual)::numeric,2) as und
  from saldoinvdetalle where idempresa = 1;
-- Esperado: 1764 filas (dos menos: se unieron las que estaban partidas por el nombre),
-- 0 negativas y las MISMAS 51.500 und.

select 'total por producto' as verificacion, codproducto, max(nombreproducto) as producto, round(sum(stock_actual)::numeric,2) as und
  from saldoinvdetalle where idempresa = 1 group by 1,2 having sum(stock_actual) <> 0 order by 4 desc;
-- Esperado: los mismos 25 productos con los mismos saldos que antes.
