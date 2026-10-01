-- ============================================================================
-- 207 — DESTINATARIOS DEL REPORTE INTERNO, POR EMPRESA
-- ----------------------------------------------------------------------------
-- Hoy cada destinatario recibe los avisos de TODAS las empresas habilitadas en
-- el evento. Esto permite decir de cuáles: el coordinador de Indupan recibe lo
-- de Indupan, el de Avimol lo de Avimol, y gerencia lo de todas.
--
-- POR QUÉ UN ARREGLO Y NO UNA FILA POR EMPRESA
-- Una persona que recibe de dos proyectos es un solo destinatario con dos
-- empresas, no dos destinatarios. Con filas separadas habría que mantener su
-- nombre y sus eventos sincronizados en ambas, y editar una sin la otra dejaría
-- una contradicción silenciosa.
--
-- HAY QUE QUITAR EL ÚNICO POR TELÉFONO
-- Estaba para evitar el mismo número dos veces --recibiría el aviso duplicado y
-- se cobrarían los dos--. Pero ahora un número legítimamente puede repetirse si
-- alguien lo registra para empresas distintas. El control pasa al código, que
-- fusiona las empresas en vez de crear otra fila.
--
-- Aditivo e idempotente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — LA COLUMNA
-- ----------------------------------------------------------------------------

alter table public.reporte_interno_destinatarios
  add column if not exists empresas int[] not null default '{}';

/*
 * Arreglo vacío = TODAS las empresas del evento.
 *
 * Es lo contrario de lo que significa en `reporte_interno_config`, donde vacío
 * es NINGUNA. La diferencia es deliberada: allá vacío protege --activar un
 * evento no debe empezar a escribir de proyectos que nadie revisó-- y aquí
 * vacío es el caso normal, que es gerencia recibiendo todo.
 *
 * Y es lo que hace que lo ya configurado siga funcionando igual: los
 * destinatarios que existen hoy quedan con el arreglo vacío y no cambian de
 * comportamiento.
 */
comment on column public.reporte_interno_destinatarios.empresas is
  'Empresas de las que recibe. Arreglo VACIO = todas las del evento (lo contrario que en reporte_interno_config, donde vacio = ninguna).';


-- ----------------------------------------------------------------------------
-- PASO 2 — QUITAR EL ÚNICO POR TELÉFONO
-- ----------------------------------------------------------------------------
-- Impedía que el mismo número apareciera dos veces. Ya no sirve: una persona
-- puede estar registrada para empresas distintas.
--
-- El control de duplicados pasa al código (`guardarDestinatario`), que al
-- encontrar un número repetido FUSIONA las empresas en la fila que ya existe
-- en vez de crear otra. Así nadie recibe el mismo aviso dos veces.

drop index if exists public.uq_reporte_interno_telefono;

-- Para buscar por teléfono al fusionar.
create index if not exists ix_reporte_interno_telefono
  on public.reporte_interno_destinatarios (telefono);


-- ----------------------------------------------------------------------------
-- PASO 3 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 3a) La columna quedó creada.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'reporte_interno_destinatarios'
  and column_name  = 'empresas';

-- 3b) El índice único ya no está, y sí el de búsqueda.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename  = 'reporte_interno_destinatarios'
order by indexname;

-- 3c) Los destinatarios de hoy, que siguen recibiendo de todas.
select id, nombre, telefono, activo, empresas, solo_eventos
from public.reporte_interno_destinatarios
order by nombre;

-- 3d) Que no haya números repetidos ya. Si los hubiera, el código los
--     fusionaría al guardarlos de nuevo, pero conviene saberlo.
select telefono, count(*) as veces, array_agg(nombre) as nombres
from public.reporte_interno_destinatarios
group by telefono
having count(*) > 1;
-- Esperado: vacío.


-- ----------------------------------------------------------------------------
-- REVERSIÓN
-- ----------------------------------------------------------------------------
-- Ojo: reponer el único por teléfono falla si para entonces hay números
-- repetidos. Habría que fusionarlos antes a mano.
--
--   alter table public.reporte_interno_destinatarios drop column if exists empresas;
--   create unique index uq_reporte_interno_telefono
--     on public.reporte_interno_destinatarios (telefono);
