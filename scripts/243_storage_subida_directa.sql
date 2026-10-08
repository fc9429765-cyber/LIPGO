-- ============================================================================
-- 243 — PERMITIR QUE EL NAVEGADOR SUBA ARCHIVOS GRANDES DIRECTO
-- ----------------------------------------------------------------------------
-- EL PROBLEMA
--
-- En Investigación de AT (SST-FOR-21) los soportes son expedientes escaneados
-- y la subida fallaba pasados ~20 MB, aunque la pantalla dijera 50.
--
-- El tope no lo ponía LIPgo. El archivo viajaba al Server Action --es decir,
-- al servidor de Vercel-- y de ahí a Supabase. Vercel corta el cuerpo de la
-- petición mucho antes de los 50 MB que declara `next.config.mjs`, y eso NO
-- se arregla con configuración: es un límite de la plataforma.
--
-- LA SOLUCIÓN
--
-- Que el archivo NO pase por Vercel: del navegador directo a Supabase
-- Storage. Al servidor solo llega la URL, unos cientos de bytes. Así el único
-- tope que queda es el del bucket, que sí se configura.
--
-- Para eso el rol `authenticated` --el del usuario con sesión iniciada-- tiene
-- que poder escribir en el bucket `archivos`. Hasta ahora solo escribía el
-- servidor con la service role, así que no hacía falta ninguna política.
--
-- Aditivo e idempotente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — SUBIR EL TOPE DEL BUCKET
-- ----------------------------------------------------------------------------
-- Si el bucket trae un límite por archivo, es el que manda una vez quitado el
-- de Vercel. Se deja en 200 MB: un expediente escaneado con sensatez --150 dpi
-- en escala de grises-- rara vez pasa de 30 MB, así que 200 deja margen de
-- sobra sin invitar a subir vídeo por descuido.
update storage.buckets
   set file_size_limit = 209715200          -- 200 MB
 where id = 'archivos';


-- ----------------------------------------------------------------------------
-- PASO 2 — DEJAR QUE EL USUARIO CON SESIÓN ESCRIBA EN `soportes/`
-- ----------------------------------------------------------------------------
-- Acotado a la carpeta `soportes/`: quien tenga sesión puede subir soportes,
-- no cualquier cosa en cualquier parte del bucket. El servidor sigue usando la
-- service role y no se ve afectado por estas políticas.

-- Subir.
drop policy if exists soportes_subida_autenticados on storage.objects;
create policy soportes_subida_autenticados on storage.objects
  for insert to authenticated
  with check (bucket_id = 'archivos' and name like 'soportes/%');

-- Reemplazar el propio archivo (la subida usa `upsert`, que puede necesitar
-- actualizar si el nombre ya existiera).
drop policy if exists soportes_update_autenticados on storage.objects;
create policy soportes_update_autenticados on storage.objects
  for update to authenticated
  using (bucket_id = 'archivos' and name like 'soportes/%')
  with check (bucket_id = 'archivos' and name like 'soportes/%');

-- Leer. Hace falta para que la pantalla confirme la subida y para abrir el
-- documento desde el listado.
drop policy if exists soportes_lectura_autenticados on storage.objects;
create policy soportes_lectura_autenticados on storage.objects
  for select to authenticated
  using (bucket_id = 'archivos');

-- NO se da permiso de BORRAR a `authenticated`. Un soporte documental es
-- evidencia de cumplimiento: se marca como histórico (`vigente = false`), no
-- se destruye. El borrado real lo hace el servidor con la service role, y solo
-- para limpiar un archivo cuyo registro falló.


-- ----------------------------------------------------------------------------
-- PASO 3 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 3a) El tope del bucket quedó en 200 MB.
select id,
       public,
       file_size_limit,
       round(file_size_limit / 1024.0 / 1024.0) as limite_mb
from storage.buckets
where id = 'archivos';
-- Si `file_size_limit` sale NULL, el bucket no tiene tope propio y manda el
-- del proyecto (Supabase trae 50 MB por defecto en el plan gratuito; se sube
-- desde el panel: Storage → Settings → Upload file size limit).

-- 3b) Las políticas quedaron creadas.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename  = 'objects'
  and policyname like 'soportes_%'
order by policyname;

-- 3c) Qué hay hoy en la carpeta de soportes, y el más pesado subido hasta
--     ahora. Sirve para saber contra qué se estaba chocando.
select count(*)                                            as archivos,
       round(max(coalesce((metadata->>'size')::bigint, 0)) / 1024.0 / 1024.0, 1) as mayor_mb,
       round(sum(coalesce((metadata->>'size')::bigint, 0)) / 1024.0 / 1024.0, 1) as total_mb
from storage.objects
where bucket_id = 'archivos'
  and name like 'soportes/%';


-- ----------------------------------------------------------------------------
-- REVERSIÓN
-- ----------------------------------------------------------------------------
--   drop policy if exists soportes_subida_autenticados  on storage.objects;
--   drop policy if exists soportes_update_autenticados  on storage.objects;
--   drop policy if exists soportes_lectura_autenticados on storage.objects;
--   -- y volver a dejar el tope anterior del bucket, si tenía uno.
-- OJO: al revertir, la subida de soportes vuelve a fallar con archivos
-- grandes, porque la pantalla ya sube directo.
-- ============================================================================
