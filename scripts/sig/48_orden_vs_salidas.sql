-- =====================================================================
-- 48 — Conciliación ORDEN DE CARGUE vs SALIDAS (invtrans)
-- ----------------------------------------------------------------------------
-- Gerencia (2026-10-04): "la orden de cargue creada es la fuente de verdad... el pedido
-- es el documento con el cual el cliente da la orden a realizar el cargue, no puedo
-- cargar más de lo que dice la orden" y "si puede salir menos debe mostrar la diferencia,
-- ya que se puede dañar una unidad en el cargue; lo que nunca puede pasar es que salga más".
--
-- POR QUÉ ESTA VISTA. La conciliación de hoy (vista 47) compara el PEDIDO
-- (`pedidosdetalle.unidadescargadas`) contra las salidas. Eso mide el control del pedido,
-- no el cumplimiento del despacho, y heredaba el defecto de la sobrescritura: medido el
-- 2026-10-04, de 40 alertas "CANTIDAD_DIFERENTE" vigentes, 37 eran de ID2 y TODAS falsas
-- (el pedido decía 100 y habían salido 160 porque la columna del pedido se sobrescribía).
--
-- Medido con esta definición el mismo día:
--   ID1  4.988 combinaciones: 4.970 cuadran · 7 salió menos · 4 SALIÓ MÁS · 7 sin salida
--   ID2  2.917: 2.911 cuadran · 0 menos · 0 más · 6 sin salida   (Avimol perfecto)
--   ID3  5.616: 5.573 cuadran · 8 menos · 0 más · 35 sin salida
--   ID4  2.066: 2.053 cuadran · 2 menos · 0 más · 11 sin salida
-- Y aparecen 10 (ID1) y 53 (ID3) salidas de un producto que la orden NO autorizó, casi
-- todas de enero.
--
-- DEFINICIONES, todas verificadas contra los datos:
--   · AUTORIZADO = `detalleoc` de las cabeceras con tipooperacion 'Cargue'. Se EXCLUYEN
--     Tolva y "Tolva f" (390 órdenes: Tolva es PRODUCCIÓN, no despacho, y no debe estar en
--     el radar de este proceso), Descargue, Distribucion (es un clon de un cargue: contarla
--     duplicaría) y proyeccion.
--   · DESPACHADO = `invtrans` tipomov 'Salida' con cod_movimiento '601' (salida por orden de
--     cargue) y status aprobado. Se EXCLUYE el 702 (salida de material / faltante): hay 143
--     salidas 702 atadas a una orden en ID1 y NO son despacho de esa orden.
--   · El status viene con variantes de digitación en la base ('aprobado', 'Aprobado',
--     'Aprobaado', 'Aprrobado'), así que se compara con `like 'apr%'`. 'Lote alterno' NO
--     cuenta: no es una salida aprobada.
--   · Producto normalizado (upper + trim). Tolerancia de media unidad por redondeos.
--
-- Solo lectura. Es una VISTA: no tiene datos y no toca invtrans ni el físico.
-- Aditiva e idempotente. No modifica la vista 47, que sigue sirviendo al control del pedido.
-- =====================================================================

drop view if exists public.v_orden_vs_salidas;

create view public.v_orden_vs_salidas as
with ord as (
  select
    c.idempresa                                   as idempresa,
    c.ordendecargue                               as ocargue,
    c.fechaorden                                  as fechaorden,
    c.fechacargue                                 as fechacargue,
    c.placa                                       as placa,
    upper(btrim(o.producto))                      as producto,
    sum(coalesce(o.cantidad, 0))                  as autorizado
  from public.cabeceraoc c
  join public.detalleoc  o on o.idorden = c.id
  where lower(btrim(coalesce(c.tipooperacion, ''))) = 'cargue'
  group by c.idempresa, c.ordendecargue, c.fechaorden, c.fechacargue, c.placa, upper(btrim(o.producto))
),
sal as (
  select
    t.idempresa                                   as idempresa,
    t.ocargue                                     as ocargue,
    upper(btrim(t.nombreproducto))                as producto,
    sum(coalesce(t.cantidad, 0))                  as despachado,
    count(*)                                      as movimientos,
    min(t.creado)                                 as primera_salida,
    max(t.creado)                                 as ultima_salida
  from public.invtrans t
  where t.tipomov = 'Salida'
    and t.cod_movimiento = '601'
    and lower(btrim(coalesce(t.status, ''))) like 'apr%'
    and t.ocargue is not null
    and exists (
      select 1 from public.cabeceraoc c2
      where c2.ordendecargue = t.ocargue
        and lower(btrim(coalesce(c2.tipooperacion, ''))) = 'cargue'
    )
  group by t.idempresa, t.ocargue, upper(btrim(t.nombreproducto))
)
select
  coalesce(o.idempresa, s.idempresa)                       as idempresa,
  o.idempresa                                             as idempresa_orden,
  s.idempresa                                             as idempresa_salida,
  coalesce(o.ocargue, s.ocargue)                          as ocargue,
  coalesce(o.producto, s.producto)                         as producto,
  o.fechaorden                                            as fechaorden,
  o.fechacargue                                           as fechacargue,
  o.placa                                                 as placa,
  coalesce(o.autorizado, 0)                               as autorizado,
  coalesce(s.despachado, 0)                               as despachado,
  coalesce(s.despachado, 0) - coalesce(o.autorizado, 0)    as diferencia,
  coalesce(s.movimientos, 0)                              as movimientos,
  s.primera_salida                                        as primera_salida,
  s.ultima_salida                                         as ultima_salida,
  case
    -- Salió un producto que la orden no autorizó. Es tan grave como salir de más.
    when o.autorizado is null                                              then 'FUERA_DE_LA_ORDEN'
    -- NUNCA puede pasar: se despachó por encima de lo que la orden autoriza.
    when coalesce(s.despachado, 0) > o.autorizado + 0.5                    then 'SALIO_MAS'
    when abs(coalesce(s.despachado, 0) - o.autorizado) <= 0.5              then 'CUADRA'
    -- Aún no ha salido nada de esa línea de la orden.
    when coalesce(s.despachado, 0) = 0                                     then 'SIN_SALIDA'
    -- Puede pasar (una unidad dañada en el cargue) y debe quedar a la vista.
    else 'SALIO_MENOS'
  end                                                     as estado_alerta
from ord o
full outer join sal s
  on s.ocargue = o.ocargue and s.producto = o.producto;

comment on view public.v_orden_vs_salidas is
  'Conciliación del DESPACHO: lo que la orden de cargue autorizó (detalleoc, solo tipooperacion Cargue) contra lo que salió del inventario (invtrans 601 aprobado). SALIO_MAS y FUERA_DE_LA_ORDEN son críticos: nunca puede salir más de lo que la orden dice. SALIO_MENOS es una diferencia a explicar (merma en el cargue). No reemplaza a v_pedidos_vs_salidas, que controla el pedido.';

-- Comprobación (se ve en el editor SQL).
select idempresa, estado_alerta, count(*) as combinaciones,
       sum(autorizado) as autorizado, sum(despachado) as despachado
from public.v_orden_vs_salidas
group by idempresa, estado_alerta
order by idempresa, estado_alerta;
