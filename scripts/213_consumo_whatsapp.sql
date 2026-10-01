-- ============================================================================
-- 198 — CUÁNTO SE ESTÁ GASTANDO EN WHATSAPP, Y EN QUÉ
-- ----------------------------------------------------------------------------
-- Diagnóstico. NO modifica nada: solo lecturas.
--
-- La factura de Meta dice cuánto se gastó en total. Lo que NO dice es de dónde
-- salió ese gasto: si son los avisos al conductor, los reportes internos, las
-- pruebas, o un flujo que quedó encendido sin que nadie lo revisara.
--
-- LIPgo sí lo sabe: cada envío queda en `whatsapp_mensajes` con su `origen`.
-- Esto lo agrupa para poder contrastarlo con la factura.
--
-- LOS PRECIOS NO SALEN DE AQUÍ. Meta cobra por mensaje según país y categoría,
-- y cambia sus tarifas. Este script cuenta MENSAJES, que es el dato duro; el
-- costo se multiplica en la factura real. Poner un precio aquí lo dejaría
-- desactualizado sin que nadie se enterara.
--
-- Dónde ver la factura: Administrador comercial → Facturación y pagos.
-- Desglose por categoría: WhatsApp Manager → Información general → Analíticas.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1 — ESTE MES, POR FLUJO
-- ----------------------------------------------------------------------------
-- El número que importa: qué parte del gasto viene de cada cosa.

select coalesce(origen, '(sin origen)')                     as flujo,
       count(*)                                             as mensajes,
       count(*) filter (where estado in ('entregado','leido')) as llegaron,
       count(*) filter (where estado = 'fallido')            as fallidos,
       round(100.0 * count(*) filter (where estado = 'fallido')
             / nullif(count(*), 0), 1)                       as pct_fallidos,
       min(created_at)::date                                 as desde,
       max(created_at)::date                                 as hasta
from public.whatsapp_mensajes
where created_at >= date_trunc('month', current_date)
group by 1
order by mensajes desc;
-- Un `pct_fallidos` alto es dinero perdido: el mensaje se cobra aunque no
-- llegue. Conviene mirarlo antes que el total.


-- ----------------------------------------------------------------------------
-- 2 — LOS ÚLTIMOS 6 MESES
-- ----------------------------------------------------------------------------
-- Para ver si el consumo está creciendo, y desde cuándo.

select to_char(date_trunc('month', created_at), 'YYYY-MM') as mes,
       count(*)                                            as mensajes,
       count(distinct telefono)                            as destinatarios,
       count(*) filter (where estado = 'fallido')          as fallidos
from public.whatsapp_mensajes
where created_at >= date_trunc('month', current_date) - interval '5 months'
group by 1
order by 1;


-- ----------------------------------------------------------------------------
-- 3 — POR PLANTILLA
-- ----------------------------------------------------------------------------
-- La CATEGORÍA de la plantilla decide la tarifa: las de marketing cuestan más
-- que las de utilidad, y además tienen tope por destinatario. Si aquí aparece
-- mucho volumen en una plantilla de marketing que debería ser utilidad, ahí
-- hay dinero de más.
--
-- La categoría real está en WhatsApp Manager, no en la base.

select plantilla,
       count(*) as mensajes,
       count(*) filter (where estado = 'fallido') as fallidos,
       min(created_at)::date as primera,
       max(created_at)::date as ultima
from public.whatsapp_mensajes
where created_at >= date_trunc('month', current_date)
group by plantilla
order by mensajes desc;


-- ----------------------------------------------------------------------------
-- 4 — QUÉ SE ESTÁ COBRANDO SIN LLEGAR
-- ----------------------------------------------------------------------------
-- Cada fallo se cobró igual. Agrupado por causa, para saber qué arreglar
-- primero.

select error_codigo,
       count(*) as veces,
       min(error_detalle) as ejemplo
from public.whatsapp_mensajes
where created_at >= date_trunc('month', current_date)
  and estado = 'fallido'
group by error_codigo
order by veces desc;


-- ----------------------------------------------------------------------------
-- 5 — A QUIÉN SE LE ESCRIBE MÁS
-- ----------------------------------------------------------------------------
-- Un número que recibe mucho más que el resto suele ser el de pruebas, o un
-- destinatario que quedó suscrito a todo sin querer.

select telefono,
       count(*) as mensajes,
       count(distinct origen) as flujos_distintos,
       max(created_at)::date as ultimo
from public.whatsapp_mensajes
where created_at >= date_trunc('month', current_date)
group by telefono
order by mensajes desc
limit 20;


-- ----------------------------------------------------------------------------
-- 6 — PROYECCIÓN DEL MES
-- ----------------------------------------------------------------------------
-- Cuántos van y cuántos serían si el ritmo se mantiene. Sirve para ver si el
-- consumo se va a disparar antes de que llegue la factura.

with dias as (
  select extract(day from current_date)::int                         as transcurridos,
         extract(day from (date_trunc('month', current_date)
                + interval '1 month - 1 day'))::int                  as del_mes
)
select count(*)                                                      as van,
       (select transcurridos from dias)                              as dias_corridos,
       round(count(*)::numeric / nullif((select transcurridos from dias), 0), 1)
                                                                     as por_dia,
       round(count(*)::numeric / nullif((select transcurridos from dias), 0)
             * (select del_mes from dias))                           as proyectado_al_cierre
from public.whatsapp_mensajes
where created_at >= date_trunc('month', current_date);
