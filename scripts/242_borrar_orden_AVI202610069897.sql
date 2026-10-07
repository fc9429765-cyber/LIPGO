-- ============================================================================
-- 242 — BORRADO MANUAL DE LA ORDEN AVI202610069897 (Y SU CLON)
-- ----------------------------------------------------------------------------
-- POR QUÉ A MANO
--
-- La pantalla se niega a borrarla porque su clon automático ya fue INICIADO
-- (`iniciocargue` lleno) o ya movió inventario. Esa salvaguarda existe para
-- que nadie haga desaparecer sin querer un movimiento real de piso.
--
-- El propio mensaje del sistema dice qué hacer: "Elimínala primero
-- manualmente si corresponde". Esto es ese "manualmente", decidido a
-- propósito y con el reverso completo -- no un borrado a medias.
--
-- QUÉ BORRA. Lo mismo que `deleteLoadOrder`, en el mismo orden:
--   inventario -> lotes -> traslados/pausas -> líneas -> cabecera
--   -> y después suelta los pedidos y las citas.
--
-- ESTO NO SE PUEDE DESHACER. Corre primero el PASO 0 y revisa lo que va a
-- desaparecer. Si algo no cuadra, para ahí.
--
-- Fecha: 2026-10-06
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 0 — MIRAR ANTES DE BORRAR  (solo lecturas)
-- ----------------------------------------------------------------------------

-- 0a) La orden madre y su clon. Esto es TODO lo que va a desaparecer.
select id,
       ordendecargue,
       tipooperacion,
       status,
       iniciocargue,
       facturasiigo,
       fechaorden,
       placa,
       case
         when ordendecargue = 'AVI202610069897' then '<<< MADRE'
         else '<<< CLON'
       end as cual_es
from public.cabeceraoc
where ordendecargue = 'AVI202610069897'
   or ordenorigen   = 'AVI202610069897'
   or ordendecargue = 'AVI202610069897D'
order by cual_es desc, ordendecargue;

-- 0b) SI ALGUNA FILA DE ARRIBA TIENE `facturasiigo` LLENO: **DETENTE**.
--     Existe una factura electrónica emitida por esa orden. No se borra:
--     se anula en Siigo con una nota crédito, y después se borra aquí.

-- 0c) El inventario que se va a revertir, con detalle. Si estas cantidades no
--     corresponden a un despacho que realmente hay que deshacer, para.
select i.ocargue,
       count(*)              as movimientos,
       sum(i.cantidad)       as cantidad_total
from public.invtrans i
where i.ocargue in (
  select ordendecargue from public.cabeceraoc
  where ordendecargue = 'AVI202610069897'
     or ordenorigen   = 'AVI202610069897'
     or ordendecargue = 'AVI202610069897D'
)
group by i.ocargue;

-- 0d) Los pedidos que quedarán libres para volver a cargarse.
select idpedido, ocargue, estado, vehiculo, fechadeentrega
from public.pedidoscabecera
where ocargue = 'AVI202610069897';


-- ============================================================================
-- PASO 1 — EL BORRADO
-- ----------------------------------------------------------------------------
-- Va todo dentro de una transacción: o se hace completo, o no se hace nada.
-- Sin esto, un fallo a mitad dejaría inventario revertido y la orden viva, que
-- es peor que no haber empezado.
--
-- Corre el bloque ENTERO de una sola vez, desde `begin;` hasta `commit;`.
-- ============================================================================

begin;

-- 1a) RASTRO DE QUIÉN Y POR QUÉ.
--     La pantalla deja auditoría automática; un borrado a mano no, así que se
--     escribe explícitamente. Sin esto quedaría una orden desaparecida sin
--     responsable -- justo lo que la auditoría de `deleteLoadOrder` vino a
--     resolver (nueve órdenes borradas el 30-sep sin responsable).
insert into public.auditoria (actor_nombre, idempresa, modulo, tabla, operacion, registro_id, descripcion, antes)
select 'borrado manual (script 242)',
       c.idempresa,
       'Gestión de Ordenes',
       'cabeceraoc',
       'DELETE',
       c.id::text,
       'Borrado manual de la orden ' || c.ordendecargue ||
         ' (' || coalesce(c.tipooperacion, '?') || ', placa ' || coalesce(c.placa, 'sin placa') ||
         '). La pantalla lo bloqueaba porque el clon ya estaba iniciado; se autorizó borrar madre y clon.',
       to_jsonb(c)
from public.cabeceraoc c
where c.ordendecargue = 'AVI202610069897'
   or c.ordenorigen   = 'AVI202610069897'
   or c.ordendecargue = 'AVI202610069897D';


-- 1b) Las órdenes afectadas, en una tabla temporal: la madre y su clon.
--     Se fija AQUÍ la lista, antes de borrar nada, para que los pasos
--     siguientes no dependan de filas que ya desaparecieron.
create temporary table _ordenes_a_borrar on commit drop as
select id, ordendecargue
from public.cabeceraoc
where ordendecargue = 'AVI202610069897'
   or ordenorigen   = 'AVI202610069897'
   or ordendecargue = 'AVI202610069897D';


-- 1c) INVENTARIO. Retirarlo restituye el saldo: `saldoinvdetalle` se deriva
--     de `invtrans`, así que no hay que recalcular nada.
delete from public.invtrans
where ocargue in (select ordendecargue from _ordenes_a_borrar);

-- 1d) LOTES (la aprobación de calidad).
delete from public.historicolotes
where ordendecargue in (select ordendecargue from _ordenes_a_borrar);

-- 1e) Traslados y pausas: quedarían apuntando a una orden inexistente.
delete from public.despachotraslados
where ocargue in (select ordendecargue from _ordenes_a_borrar);

delete from public.pausas
where ordendecargue in (select ordendecargue from _ordenes_a_borrar);

-- 1f) El libro que dice qué pedido salió en qué orden.
delete from public.pedidodetalle_ocargue
where ocargue in (select ordendecargue from _ordenes_a_borrar);

-- 1g) Las líneas y la cabecera.
delete from public.detalleoc
where idorden in (select id from _ordenes_a_borrar);

delete from public.cabeceraoc
where id in (select id from _ordenes_a_borrar);


-- 1h) LOS PEDIDOS VUELVEN A QUEDAR LIBRES.
--     `estado` vuelve a 'aprobado', NO a null: un pedido siempre pasa por
--     aprobación antes de poder generar una orden de cargue. Dejarlo en null
--     significaría "recién creado, nunca aprobado" y habría que volver a
--     aprobarlo; dejarlo en 'entregado' sería mentir sobre una entrega que no
--     ocurrió porque la orden se borró.
update public.pedidoscabecera
   set ocargue          = null,
       estado           = 'aprobado',
       vehiculo         = null,
       transporte       = null,
       fechaordencargue = null,
       fechadeentrega   = null
 where ocargue = 'AVI202610069897';

-- 1i) Las líneas del pedido: cantidad entregada en cero y sin estado, listas
--     para asociarse a una orden nueva.
update public.pedidosdetalle
   set ocargue          = null,
       unidades_cargadas = null,
       unidadescargadas  = null,
       estado            = null
 where ocargue = 'AVI202610069897';

-- 1j) La cita del vehículo queda libre.
update public.citasvehiculos
   set ocargue = null,
       estatus = null
 where ocargue = 'AVI202610069897';

commit;


-- ============================================================================
-- PASO 2 — COMPROBAR QUE QUEDÓ LIMPIO  (solo lecturas)
-- ============================================================================

-- 2a) No debe quedar NINGUNA fila. Si devuelve algo, el borrado no terminó.
select 'cabeceraoc'            as tabla, count(*) as quedan from public.cabeceraoc            where ordendecargue in ('AVI202610069897','AVI202610069897D') or ordenorigen = 'AVI202610069897'
union all
select 'invtrans',                       count(*)           from public.invtrans              where ocargue       in ('AVI202610069897','AVI202610069897D')
union all
select 'historicolotes',                 count(*)           from public.historicolotes        where ordendecargue in ('AVI202610069897','AVI202610069897D')
union all
select 'pedidodetalle_ocargue',          count(*)           from public.pedidodetalle_ocargue where ocargue       in ('AVI202610069897','AVI202610069897D')
union all
select 'despachotraslados',              count(*)           from public.despachotraslados     where ocargue       in ('AVI202610069897','AVI202610069897D')
union all
select 'pausas',                         count(*)           from public.pausas                where ordendecargue in ('AVI202610069897','AVI202610069897D')
order by 1;

-- 2b) Los pedidos quedaron listos para una orden nueva.
select idpedido, ocargue, estado
from public.pedidoscabecera
where idpedido in (
  select idpedido from public.pedidosdetalle where ocargue is null
)
  and estado = 'aprobado'
order by idpedido desc
limit 10;
-- `ocargue` en null y `estado` = 'aprobado' es lo correcto.


-- ============================================================================
-- SI ALGO SALIÓ MAL
-- ----------------------------------------------------------------------------
-- Mientras no hayas corrido `commit;` puedes deshacer todo con `rollback;`.
-- Después del commit no hay vuelta atrás: lo que queda es la fila de
-- auditoría del paso 1a, con los datos de la orden tal como estaba.
-- ============================================================================
