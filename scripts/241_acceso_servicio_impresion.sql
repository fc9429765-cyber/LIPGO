-- ============================================================================
-- 241 — DEVOLVERLE EL ACCESO AL SERVICIO DE IMPRESIÓN DE ETIQUETAS
-- ----------------------------------------------------------------------------
-- QUÉ PASÓ
--
-- El script 220 (2026-10-03) cerró la base al rol `anon`. Era necesario: con
-- la clave pública que viaja en el navegador, y SIN iniciar sesión,
-- cualquiera podía leer y escribir todas las tablas de `public`.
--
-- El 220 contempló dos consumidores -- el servidor de LIPgo (que pasó a usar
-- la service role) y el navegador con sesión (rol `authenticated`) -- pero NO
-- contempló el SERVICIO EXTERNO DE IMPRESIÓN DE ETIQUETAS, una aplicación
-- Python expuesta por ngrok que se conectaba como `anon`.
--
-- Desde entonces ese servicio responde 500 a todo:
--   permission denied for table produccion     (42501)
--   permission denied for table estado_linea   (42501)
--
-- ----------------------------------------------------------------------------
-- LO QUE **NO** HAY QUE HACER
--
-- NO devolverle los privilegios a `anon`. El 220 trae una reversa de
-- emergencia (`grant ... to anon`) y usarla por esto reabriría el agujero
-- entero: cualquiera con la clave pública volvería a poder escribir en toda
-- la base. El problema no es que `anon` tenga poco; es que el servicio no
-- debería estar usando `anon`.
--
-- ----------------------------------------------------------------------------
-- LA SOLUCIÓN (no se hace aquí, se hace en el servicio Python)
--
-- Que el servicio use la SERVICE ROLE KEY de Supabase en vez de la anónima.
-- Es un cambio de UNA variable en su configuración:
--
--     SUPABASE_KEY = <service_role key>     (en vez de la anon key)
--
-- La service role salta tanto los privilegios como RLS, así que resuelve las
-- dos barreras que levantó el 220 de una sola vez. Es lo mismo que ya hace el
-- servidor de LIPgo.
--
-- La clave está en Supabase → Project Settings → API → `service_role`.
--
-- ADVERTENCIA: esa clave da acceso TOTAL a la base. Va en la configuración
-- del servidor donde corre el servicio (variable de entorno o archivo de
-- configuración), NUNCA en código que llegue a un navegador, NUNCA en un
-- repositorio, y NUNCA pegada en un chat.
--
-- ----------------------------------------------------------------------------
-- ESTE SCRIPT SOLO DIAGNOSTICA. No cambia permisos.
-- Sirve para confirmar el estado y para saber qué tablas necesita el servicio.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) CONFIRMAR EL DIAGNÓSTICO: ¿`anon` quedó sin privilegios?
-- ----------------------------------------------------------------------------
select count(*) as privilegios_de_anon_en_public
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
-- 0 = confirmado: el 220 corrió y `anon` no puede tocar nada.
--     Es el estado correcto y deseado; el servicio es el que debe cambiar.


-- ----------------------------------------------------------------------------
-- 2) LAS TABLAS QUE EL SERVICIO NECESITA
-- ----------------------------------------------------------------------------
-- Las dos que ya reportaron error, más las que suelen ir con ellas.
-- `rowsecurity` en true significa que, además del permiso, hay RLS: otra razón
-- más para usar la service role en vez de repartir grants.
select tablename,
       rowsecurity                                    as tiene_rls,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = t.tablename) as politicas
from pg_tables t
where schemaname = 'public'
  and tablename in ('produccion', 'estado_linea', 'invtrans', 'locations', 'qrestibacabecera')
order by tablename;


-- ----------------------------------------------------------------------------
-- 3) ¿EXISTEN ESAS TABLAS?
-- ----------------------------------------------------------------------------
-- `estado_linea` no aparece en el código de LIPgo: la usa solo el servicio de
-- impresión. Conviene confirmar que existe y en qué esquema.
select table_schema, table_name
from information_schema.tables
where table_name in ('produccion', 'estado_linea')
order by table_schema, table_name;
-- Si alguna sale en un esquema distinto de `public`, revísalo: la app solo lee
-- `public` (ver la nota de esquemas del proyecto).


-- ----------------------------------------------------------------------------
-- 4) PARA DESPUÉS DEL CAMBIO: COMPROBAR QUE VOLVIÓ A ESCRIBIR
-- ----------------------------------------------------------------------------
-- Correr después de cambiar la clave en el servicio y registrar una etiqueta.
select max(id) as ultimo_id, count(*) as filas_hoy
from public.produccion
where created_at::date = current_date;
-- Si `filas_hoy` crece al registrar, el servicio ya está escribiendo.
-- Si la columna `created_at` no existe en esta tabla, usa la de fecha que
-- tenga; el nombre varía entre instalaciones.


-- ============================================================================
-- ALTERNATIVA, SOLO SI NO SE PUEDE CAMBIAR LA CLAVE DEL SERVICIO
-- ----------------------------------------------------------------------------
-- Un rol dedicado, con permiso ÚNICAMENTE sobre lo que el servicio necesita.
-- Es más trabajo y más frágil que usar la service role, pero no reabre nada.
--
-- NO está activo: hay que descomentarlo y completar las tablas reales.
--
--   create role impresion_etiquetas login password '<una clave larga y unica>';
--   grant usage on schema public to impresion_etiquetas;
--   grant select, insert on public.produccion   to impresion_etiquetas;
--   grant select, insert, update on public.estado_linea to impresion_etiquetas;
--   grant usage, select on all sequences in schema public to impresion_etiquetas;
--   -- RLS: hace falta una política por tabla, o el rol seguirá sin ver nada.
--   -- alter table public.produccion force row level security;
--   -- create policy impresion_ok on public.produccion
--   --   for all to impresion_etiquetas using (true) with check (true);
--
-- OJO: este camino exige mantener la lista de tablas a mano. Cada tabla nueva
-- que el servicio empiece a usar volverá a fallar con 42501 hasta que alguien
-- se acuerde de agregarla aquí. Por eso se recomienda la service role.
-- ============================================================================
