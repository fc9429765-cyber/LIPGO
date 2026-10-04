-- =====================================================================
-- 209_auditoria_indice_resumen.sql — índice de cobertura para el resumen
-- "quién hizo qué" de la Bitácora de Auditoría.
-- Aditivo e idempotente. Correr en el SQL Editor de Supabase.
--
-- Por qué: `auditoria_resumen(...)` (SQL 208) agrupa por usuario/módulo/tabla/
-- acción. Para un día responde en ~200 ms, pero para un mes completo debe
-- leer ~200.000 filas del heap (cada fila trae los JSON de antes/después,
-- muy anchos) y se agota el statement_timeout de 8 s. Con este índice el
-- planificador hace un "index-only scan": todas las columnas que necesita el
-- resumen están en el índice y no toca las filas, así que un mes entero
-- responde en menos de un segundo.
--
-- Costo: ~355.000 filas (sep-2026) → unos segundos de construcción. Mientras
-- se construye, las escrituras en `auditoria` (es decir, los triggers de
-- auditoría de toda la app) esperan. Correrlo en un momento tranquilo.
-- =====================================================================

create index if not exists idx_auditoria_resumen
  on public.auditoria (ts, idempresa, actor_id, actor_nombre, modulo, tabla, operacion);

-- Estadísticas frescas para que el planificador elija el índice nuevo.
analyze public.auditoria;

-- Opcional, en una corrida APARTE del editor (VACUUM no puede ir dentro de un
-- bloque con otras sentencias): deja el mapa de visibilidad al día para que el
-- index-only scan no revise el heap. La tabla es solo-inserción y el
-- autovacuum lo hace solo con el tiempo, así que no es obligatorio.
--   vacuum public.auditoria;

-- Verificación (debe responder en menos de un segundo):
--   select count(*) from public.auditoria_resumen(now() - interval '30 days', now());
