
-- =====================================================================
-- 255_cabeceraoc_guarda_su_pedido.sql
--
-- La orden de cargue pasa a saber de qué pedido nació.
--
-- Pedido por gerencia el 2026-10-07: "me gusta lo de que cabeceraoc tenga además de la
-- orden asociado el pedido... teniendo en cuenta las lógicas que están el día de hoy y su
-- buen funcionamiento".
--
-- ES PURAMENTE ADITIVO. Dos columnas nuevas que ningún código lee todavía. NO cambia una
-- sola cifra, NO toca el pedido, NO toca inventario, NO toca ninguna lógica existente. Si
-- algo sale mal quedan en nulo y nada deja de funcionar.
-- =====================================================================
--
-- LA LÓGICA QUE SE ESTÁ RESPETANDO (dicha por gerencia)
--
--   El pedido llega (manual o del CRM) → `pedidoscabecera`
--   → se abre su detalle línea por línea → `pedidosdetalle`
--   → con ese detalle se genera la orden de cargue → `cabeceraoc` + `detalleoc`
--
-- Es decir: el INSUMO de la orden de cargue es el detalle del pedido. Una orden de cargue
-- sin pedido detrás no debería poder existir.
--
-- QUÉ SE ENCONTRÓ AL MEDIRLO (2026-10-07)
--
-- `cabeceraoc` tiene 46 columnas y NINGUNA guarda el pedido. La orden no sabe de dónde
-- nació. La relación se escribe solo del lado del pedido, en `pedidoscabecera.ocargue`,
-- que es UN SOLO código de texto.
--
-- Y un código no alcanza, porque de 7.822 órdenes de cargue:
--   · 5.570 (71,2 %) atienden a UN solo pedido
--   · 2.008 (25,7 %) atienden a VARIOS (la mayor, MOL20260116136, atiende a 22)
--   ·   244 ( 3,1 %) no tienen pedido conocido, y 243 de ellas son de enero a julio,
--     cuando aún no existía la bitácora de auditoría de donde se reconstruyó el libro.
--     La última es de agosto. En septiembre y octubre: CERO. El flujo de hoy está limpio.
--
-- LA RELACIÓN ES DE MUCHOS A MUCHOS, Y VA EN LAS DOS DIRECCIONES
--
-- Gerencia lo confirmó el 2026-10-07: "es posible que un pedido se vaya en varias órdenes,
-- siempre que la suma de todas las órdenes no supere el pedido" — el tope que ya quedó en
-- el código el 4 de octubre. Medidas las dos direcciones ese mismo día:
--
--   un PEDIDO sale en varias ÓRDENES:    181 de 11.033 pedidos (1,6 %). El mayor, el
--                                        pedido 9899, salió en 8 órdenes.
--   una ORDEN atiende a varios PEDIDOS:  2.008 de 7.822 órdenes (25,7 %). La mayor,
--                                        MOL20260116136, atiende a 22 pedidos.
--
-- Por eso el registro oficial de la relación tiene que vivir en una tabla aparte, línea
-- por línea: `pedidodetalle_ocargue`. Ninguna columna en ninguna de las dos cabeceras
-- puede representar eso sin mentir.
--
-- POR ESO SON DOS COLUMNAS Y NO UNA
--
--   `idpedido`  el pedido, SOLO cuando la orden atiende a uno. Es exacto para el 71 %.
--               Cuando atiende a varios se deja en NULO a propósito: poner uno de los
--               veintidós sería mentir.
--   `pedidos_n` cuántos pedidos atiende. Es lo que impide confundir "ninguno" con
--               "varios", que es justo la pregunta que no se podía responder:
--                 0 → no tiene pedido (eso es la anomalía que hay que mirar)
--                 1 → está en `idpedido`
--                >1 → la relación completa está en `pedidodetalle_ocargue`
--
-- NO SE DUPLICA LA VERDAD. El registro oficial de qué pedidos atiende una orden sigue
-- siendo `pedidodetalle_ocargue`, línea por línea. Estas dos columnas son el resumen en
-- la cabecera, derivado de él, para que la orden no sea un documento huérfano.
--
-- LOS OTROS TIPOS DE ORDEN NO LLEVAN PEDIDO, Y ESTÁ BIEN: Descargue (686), Distribución
-- (592), Tolva (377+14) y proyección (40) no son despachos contra un pedido. Quedan con
-- `pedidos_n = 0` y no se cuentan como anomalía.
--
-- UNA ORDEN DE UN PROYECTO SÍ PUEDE ATENDER EL PEDIDO DE OTRO (corregido el 2026-10-07)
--
-- La primera versión de este script tenía un candado que lo prohibía, y por eso se negó a
-- correr: "hay ordenes ligadas a un pedido de OTRO proyecto". El candado estaba mal, no
-- los datos. Al revisarlo:
--
--   · Hay 473 vínculos entre proyectos distintos. De ellos, 470 son ID1 ↔ ID3, y esos
--     DOS PROYECTOS SON LA MISMA EMPRESA: Harinera Indupan y Cedi Funza comparten NIT
--     (800.161.555-8), dirección y logo. Son el molino y el CEDI. Que un pedido del CEDI
--     se cargue en el molino es la operación normal, no un error.
--   · Verificado línea por línea en tres casos recientes: la orden y el pedido coinciden
--     en producto, cantidad y cliente. Por ejemplo IND202610079962 (ID1, 7-oct, placa
--     LWY409) contra el pedido 11815 (ID3): los dos dicen PT LA NIEVE 25LB, 1.400
--     unidades, cliente ORJUELA CALDERON MODESTO. Es el mismo despacho.
--   · Solo 3 vínculos son entre empresas DE VERDAD distintas (ID3/ID4 contra ID2), y los
--     tres son de febrero a abril de 2026. Quedan listados en el paso 3b para mirarlos;
--     no se corrigen aquí.
--
-- Por eso el vínculo se guarda tal como lo dicen los datos, y lo que era un candado pasa
-- a ser un aviso con la cuenta. Quien use `idpedido` en una pantalla tiene que filtrar por
-- proyecto por su cuenta, como ya lo hace todo lo demás: la columna dice la verdad del
-- despacho, no reemplaza el control de acceso.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — ANTES. Guardar esta salida.
-- ---------------------------------------------------------------------
select tipooperacion, count(*) as ordenes
from public.cabeceraoc
group by tipooperacion
order by 2 desc;

-- ---------------------------------------------------------------------
-- PASO 2 — LAS COLUMNAS Y EL RELLENO.
-- ---------------------------------------------------------------------
begin;

alter table public.cabeceraoc add column if not exists idpedido  bigint;
alter table public.cabeceraoc add column if not exists pedidos_n smallint;

comment on column public.cabeceraoc.idpedido is
  'Pedido del que nacio esta orden de cargue (pedidoscabecera.idpedido). SOLO se llena cuando la orden atiende a UN pedido: si atiende a varios queda en nulo a proposito y la relacion completa esta en pedidodetalle_ocargue. Script 255.';
comment on column public.cabeceraoc.pedidos_n is
  'Cuantos pedidos atiende esta orden. 0 = ninguno (anomalia en una orden de Cargue; normal en Descargue, Distribucion, Tolva y proyeccion), 1 = esta en idpedido, >1 = ver pedidodetalle_ocargue. Evita confundir "sin pedido" con "varios pedidos". Script 255.';

create index if not exists idx_cabeceraoc_idpedido on public.cabeceraoc (idpedido);

do $ligar$
declare
  v_uno           int;
  v_varios        int;
  v_cero          int;
  v_mismo_nit     int;
  v_otra_empresa  int;
begin
  -- Los pedidos de cada orden, de las DOS fuentes que existen hoy: el codigo que guarda
  -- el propio pedido y el libro linea por linea. Se unen porque ninguna sola es completa:
  -- el codigo del pedido recuerda una sola orden, y el libro se reconstruyo desde la
  -- auditoria, que empieza el 2026-07-26.
  create temporary table _pedidos_de_la_orden on commit drop as
  select oc, count(distinct idpedido)::int as n, min(idpedido) as unico
  from (
    select btrim(ocargue) as oc, idpedido
      from public.pedidoscabecera
     where ocargue is not null and btrim(ocargue) <> ''
    union
    select btrim(ocargue) as oc, idpedido
      from public.pedidodetalle_ocargue
     where ocargue is not null and btrim(ocargue) <> ''
  ) t
  group by oc;

  create index on _pedidos_de_la_orden (oc);

  -- Todas las ordenes arrancan en 0 y luego se corrige: asi `pedidos_n` nunca queda nulo
  -- y "no tiene pedido" se distingue de "no se ha calculado".
  update public.cabeceraoc set pedidos_n = 0 where pedidos_n is null;

  update public.cabeceraoc c
     set pedidos_n = p.n,
         idpedido  = case when p.n = 1 then p.unico else null end
    from _pedidos_de_la_orden p
   where btrim(c.ordendecargue) = p.oc;

  select count(*) into v_uno    from public.cabeceraoc where tipooperacion = 'Cargue' and pedidos_n = 1;
  select count(*) into v_varios from public.cabeceraoc where tipooperacion = 'Cargue' and pedidos_n > 1;
  select count(*) into v_cero   from public.cabeceraoc where tipooperacion = 'Cargue' and coalesce(pedidos_n, 0) = 0;
  raise notice 'Ordenes de Cargue -> con 1 pedido: % · con varios: % · sin pedido: %', v_uno, v_varios, v_cero;

  -- CANDADO 1. Ningun `idpedido` puede apuntar a un pedido que no existe.
  if exists (select 1 from public.cabeceraoc c
              where c.idpedido is not null
                and not exists (select 1 from public.pedidoscabecera p where p.idpedido = c.idpedido)) then
    raise exception 'Quedaron ordenes ligadas a un pedido inexistente: se deshace todo.';
  end if;

  -- CANDADO 2. `idpedido` solo puede estar lleno cuando atiende a UNO.
  if exists (select 1 from public.cabeceraoc where idpedido is not null and pedidos_n <> 1) then
    raise exception 'Hay ordenes con idpedido lleno que atienden a un numero de pedidos distinto de 1: se deshace todo.';
  end if;

  -- AVISO (no es candado). Una orden de un proyecto SI puede atender el pedido de otro:
  -- ID1 e ID3 son el molino y el CEDI de la misma empresa (mismo NIT). Lo que si hay que
  -- ver con ojos son los vinculos entre empresas de verdad distintas, que se listan en el
  -- paso 3b. Aqui solo se cuentan.
  -- Se cuenta desde las FUENTES, no desde la columna que se acaba de llenar: `idpedido`
  -- solo queda puesto cuando la orden atiende a UNO, asi que mirar la columna dejaria
  -- fuera los cruces de las ordenes que atienden a varios.
  create temporary table _cruces on commit drop as
  select c.id              as orden_id,
         c.ordendecargue,
         c.idempresa       as proyecto_orden,
         c.fechacargue,
         v.idpedido,
         p.id_empresa      as proyecto_pedido,
         p.cliente
  from (
    select btrim(ocargue) as oc, idpedido
      from public.pedidoscabecera
     where ocargue is not null and btrim(ocargue) <> ''
    union
    select btrim(ocargue) as oc, idpedido
      from public.pedidodetalle_ocargue
     where ocargue is not null and btrim(ocargue) <> ''
  ) v
  join public.cabeceraoc     c on btrim(c.ordendecargue) = v.oc
  join public.pedidoscabecera p on p.idpedido = v.idpedido
  where c.idempresa is distinct from p.id_empresa;

  select count(*) into v_mismo_nit    from _cruces
   where least(proyecto_orden, proyecto_pedido) = 1 and greatest(proyecto_orden, proyecto_pedido) = 3;
  select count(*) into v_otra_empresa from _cruces
   where not (least(proyecto_orden, proyecto_pedido) = 1 and greatest(proyecto_orden, proyecto_pedido) = 3);
  raise notice 'Ordenes que atienden el pedido de otro proyecto -> ID1<->ID3 (misma empresa, esperado 470): % · entre empresas distintas (esperado 3, ver paso 3b): %', v_mismo_nit, v_otra_empresa;

  raise notice 'LISTO. Ninguna cifra cambio: solo se agrego de que pedido nacio cada orden.';
end
$ligar$;

commit;

-- ---------------------------------------------------------------------
-- PASO 3 — DESPUÉS.
-- ---------------------------------------------------------------------

-- 3a. El reparto, por tipo de operación.
select tipooperacion,
       count(*)                                        as ordenes,
       count(*) filter (where pedidos_n = 1)           as con_un_pedido,
       count(*) filter (where pedidos_n > 1)           as con_varios,
       count(*) filter (where coalesce(pedidos_n,0)=0) as sin_pedido
from public.cabeceraoc
group by tipooperacion
order by 2 desc;
-- Medido el 2026-10-07, justo antes de correrlo:
--   Cargue        7.822 órdenes · 5.570 con uno · 2.008 con varios · 244 sin pedido
--   Descargue       686 · 4 con uno · 682 sin pedido
--   Distribucion    592 · 6 con uno · 3 con varios · 583 sin pedido
--   Tolva 377 · proyeccion 40 · Tolva f 14 · todas sin pedido
-- En Descargue, Distribucion, Tolva y proyeccion es lo correcto: no son despachos
-- contra un pedido.

-- 3b. Los vínculos entre empresas DE VERDAD distintas. Son los únicos que hay que mirar
--     con ojos: ID1 ↔ ID3 es la misma empresa (molino y CEDI) y no cuenta.
with vinculos as (
  select btrim(ocargue) as oc, idpedido
    from public.pedidoscabecera
   where ocargue is not null and btrim(ocargue) <> ''
  union
  select btrim(ocargue) as oc, idpedido
    from public.pedidodetalle_ocargue
   where ocargue is not null and btrim(ocargue) <> ''
)
select c.id            as orden_id,
       c.ordendecargue,
       c.idempresa     as proyecto_de_la_orden,
       c.fechacargue,
       v.idpedido,
       p.id_empresa    as proyecto_del_pedido,
       p.cliente       as cliente_del_pedido
from vinculos v
join public.cabeceraoc      c on btrim(c.ordendecargue) = v.oc
join public.pedidoscabecera p on p.idpedido = v.idpedido
where c.idempresa is distinct from p.id_empresa
  and not (least(c.idempresa, p.id_empresa) = 1 and greatest(c.idempresa, p.id_empresa) = 3)
order by c.fechacargue;
-- Esperado: 3 filas, todas de febrero a abril de 2026 (órdenes 814 y 2862 de ID3 y la
-- 2436 de ID4, las tres contra pedidos de ID2). Ninguna reciente. Se informan, no se
-- corrigen aquí.

-- 3c. Las órdenes de CARGUE sin pedido, que es la anomalía de la que hablamos.
select to_char(fechacargue, 'YYYY-MM') as mes, count(*) as ordenes
from public.cabeceraoc
where tipooperacion = 'Cargue' and coalesce(pedidos_n, 0) = 0
group by 1
order by 1 desc;
-- Esperado: 244 en total, la última en agosto (1 caso) y el resto de enero a julio.
-- CERO en septiembre y octubre: el flujo de hoy está limpio.

-- 3d. Una muestra, para verla con ojos.
select c.id, c.ordendecargue, c.idempresa, c.fechacargue, c.pedidos_n, c.idpedido,
       p.cliente as cliente_del_pedido
from public.cabeceraoc c
left join public.pedidoscabecera p on p.idpedido = c.idpedido
where c.tipooperacion = 'Cargue' and c.fechacargue >= '2026-10-01'
order by c.id desc
limit 15;

-- ---------------------------------------------------------------------
-- LO QUE SIGUE (no se hace aqui)
-- ---------------------------------------------------------------------
-- · Que `generateLoadOrder` escriba las dos columnas al crear la orden. Ya conoce los
--   pedidos que esta despachando.
-- · Cuando lo nuevo este al 100 %, la llave foranea `idpedido -> pedidoscabecera(idpedido)`.
--   `pedidoscabecera.idpedido` SI es unico (es su llave primaria), asi que aqui la llave
--   es directa: no hace falta el rodeo que exigio `cabeceraoc.ordendecargue`.
