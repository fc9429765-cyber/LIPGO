-- ============================================================================
-- 240 — POR QUÉ NO SE DEJA ELIMINAR UNA ORDEN
-- ----------------------------------------------------------------------------
-- `deleteLoadOrder` se detiene por varias razones distintas y el mensaje en
-- pantalla no siempre dice cuál. Esto las revisa todas y nombra la que aplica.
--
-- SOLO LECTURAS. No borra ni cambia nada.
--
-- Cambia el número de orden en la primera línea y corre todo el bloque.
-- ============================================================================

-- ↓↓↓ LA ORDEN A DIAGNOSTICAR ↓↓↓
-- (está puesta AVI202610069897; cámbiala para revisar otra)


-- ----------------------------------------------------------------------------
-- 1) ¿EXISTE? ¿Y CÓMO ESTÁ?
-- ----------------------------------------------------------------------------
select id,
       ordendecargue,
       tipooperacion,
       status,
       facturasiigo,
       estadofactura,
       iniciocargue,
       horalote,
       ordenorigen,
       fechaorden,
       placa,
       idempresa
from public.cabeceraoc
where ordendecargue = 'AVI202610069897';
-- Si no devuelve NADA: la orden ya no existe (o el número está mal escrito).
-- Si devuelve VARIAS filas: hay más de una cabecera con ese número; cada una
-- se borra por separado desde la pantalla.


-- ----------------------------------------------------------------------------
-- 2) LA CAUSA MÁS PROBABLE: YA ESTÁ FACTURADA
-- ----------------------------------------------------------------------------
-- Una orden con `facturasiigo` lleno NO se deja borrar: existe una factura
-- electrónica emitida por ella, y esa factura no se borra -- se anula con una
-- nota crédito. Borrar la orden dejaría la factura sin respaldo en LIPgo.
select case
         when coalesce(btrim(facturasiigo), '') <> ''
           then 'BLOQUEADA: ya tiene factura -> ' || facturasiigo
         else 'Sin factura: esta no es la causa'
       end as diagnostico_factura
from public.cabeceraoc
where ordendecargue = 'AVI202610069897';


-- ----------------------------------------------------------------------------
-- 3) LA OTRA CAUSA FRECUENTE: UN CLON YA PROCESADO
-- ----------------------------------------------------------------------------
-- Una orden de CARGUE arrastra sus clones automáticos (el descargue en el
-- CEDI destino y la distribución "+D"). Si algún clon ya se inició o ya movió
-- inventario, se bloquea el borrado de la madre: hacerlo desaparecería un
-- movimiento real sin contexto.
select c.ordendecargue        as clon,
       c.tipooperacion,
       c.iniciocargue,
       (select count(*) from public.invtrans i where i.ocargue = c.ordendecargue) as movs_inventario,
       case
         when c.iniciocargue is not null then 'BLOQUEA: el clon ya fue iniciado'
         when exists (select 1 from public.invtrans i where i.ocargue = c.ordendecargue)
           then 'BLOQUEA: el clon ya movió inventario'
         else 'Este clon no bloquea (se borraría en cascada)'
       end as diagnostico_clon
from public.cabeceraoc c
where c.ordenorigen = 'AVI202610069897'
   or c.ordendecargue = 'AVI202610069897' || 'D';
-- Sin filas = la orden no tiene clones, o no es de tipo Cargue.


-- ----------------------------------------------------------------------------
-- 4) QUÉ SE LLEVARÍA POR DELANTE EL BORRADO
-- ----------------------------------------------------------------------------
-- Para ver el tamaño de lo que se va a revertir antes de hacerlo.
select 'invtrans (inventario)'        as tabla, count(*) as filas from public.invtrans              where ocargue        = 'AVI202610069897'
union all
select 'historicolotes (calidad)',             count(*)           from public.historicolotes        where ordendecargue  = 'AVI202610069897'
union all
select 'detalleoc (líneas)',                   count(*)           from public.detalleoc             where idorden in (select id from public.cabeceraoc where ordendecargue = 'AVI202610069897')
union all
select 'pedidodetalle_ocargue (libro)',        count(*)           from public.pedidodetalle_ocargue where ocargue        = 'AVI202610069897'
union all
select 'pedidoscabecera (pedidos)',            count(*)           from public.pedidoscabecera       where ocargue        = 'AVI202610069897'
union all
select 'pedidosdetalle (líneas de pedido)',    count(*)           from public.pedidosdetalle        where ocargue        = 'AVI202610069897'
union all
select 'citasvehiculos',                       count(*)           from public.citasvehiculos        where ocargue        = 'AVI202610069897'
union all
select 'despachotraslados',                    count(*)           from public.despachotraslados     where ocargue        = 'AVI202610069897'
union all
select 'pausas',                               count(*)           from public.pausas                where ordendecargue  = 'AVI202610069897'
order by 1;


-- ----------------------------------------------------------------------------
-- 5) ¿SE INTENTÓ FACTURAR DESDE LIPgo?
-- ----------------------------------------------------------------------------
-- Si hay un intento EXITOSO aquí pero `facturasiigo` está vacío en la orden,
-- la factura existe en Siigo y la orden no se enteró: hay que revisarlo antes
-- de borrar nada.
select siigo_nombre,
       estado_dian,
       exitosa,
       error,
       valor_total,
       created_at,
       emitida_por
from public.siigo_facturas_emitidas
where ordenes @> array[(select id from public.cabeceraoc where ordendecargue = 'AVI202610069897' limit 1)]::bigint[]
order by created_at desc;


-- ----------------------------------------------------------------------------
-- 6) ¿SE REGISTRÓ UN ERROR DEL SERVIDOR AL INTENTAR BORRARLA?
-- ----------------------------------------------------------------------------
-- `deleteLoadOrder` registra los fallos inesperados. Si la pantalla dijo
-- "Error inesperado", el motivo real está aquí.
select modulo, mensaje, extra, created_at
from public.app_errores
where modulo like 'orders.deleteLoadOrder%'
order by created_at desc
limit 10;
-- Si la tabla no existe en esta instalación (falta el SQL 217), esta consulta
-- falla sola: el resto del diagnóstico ya corrió.


-- ----------------------------------------------------------------------------
-- 7) LLAVES FORÁNEAS QUE PUEDEN ESTAR BLOQUEANDO EL BORRADO
-- ----------------------------------------------------------------------------
-- Si el borrado falla con "Error al eliminar cabecera de la orden", casi
-- siempre es una llave foránea: otra tabla apunta a esta orden y la base se
-- niega a dejarla huérfana.
--
-- Lo que importa es la columna `al_borrar`:
--   NO ACTION / RESTRICT -> BLOQUEA. Hay que limpiar esa tabla primero.
--   CASCADE              -> se borra solo, no estorba.
--   SET NULL             -> se desliga solo, no estorba.
select tc.table_name                                   as tabla_que_apunta,
       kcu.column_name                                 as columna,
       rc.delete_rule                                  as al_borrar,
       case rc.delete_rule
         when 'NO ACTION' then 'BLOQUEA el borrado'
         when 'RESTRICT'  then 'BLOQUEA el borrado'
         else 'no estorba'
       end                                             as diagnostico
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
 and kcu.constraint_schema = tc.constraint_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
 and rc.constraint_schema = tc.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.constraint_schema = tc.constraint_schema
where tc.constraint_type = 'FOREIGN KEY'
  and ccu.table_schema   = 'public'
  and ccu.table_name     = 'cabeceraoc'
order by rc.delete_rule, tc.table_name;


-- ----------------------------------------------------------------------------
-- 8) SI EL PASO 7 SEÑALÓ UNA TABLA QUE BLOQUEA: ¿TIENE FILAS DE ESTA ORDEN?
-- ----------------------------------------------------------------------------
-- Cambia `apoyo_cargue_asignaciones` por la tabla que haya salido arriba.
select count(*) as filas_que_bloquean
from public.apoyo_cargue_asignaciones
where idorden in (select id from public.cabeceraoc where ordendecargue = 'AVI202610069897');
