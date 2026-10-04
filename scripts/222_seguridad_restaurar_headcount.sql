
-- 222 · URGENTE: restaurar el acceso de los usuarios con sesión a headcount y
-- evaluaciones_desempeno. Corregir un sobrealcance del SQL 221.
--
-- Qué pasó: el SQL 221 (ayer) cerró "headcount" a cualquier usuario con sesión, pensando que
-- era dato de nómina. Pero headcount es el directorio de personal (cédula, nombre, cargo,
-- estado) y lo consultan muchas pantallas operativas a través de rutas que preguntan a la base
-- "como el propio usuario" (no con la clave maestra del servidor): el registro de asistencia
-- (valida la cédula), la Tabla de Asistencia, todo el módulo Head Count (ver/crear/editar/
-- eliminar personal), partes de Gestión de Colaboradores y Dotación EPP, y la alerta de
-- evaluaciones de desempeño. Al quedar sin política, esas consultas devuelven vacío, y por eso
-- el sistema decía "este documento no existe" aunque la persona sí está activa.
--
-- Qué hace: les devuelve a "headcount" y a "evaluaciones_desempeno" la MISMA política de paso
-- que tienen hoy la mayoría de las tablas no financieras (acceso completo para cualquier
-- usuario CON SESIÓN; sigue cerrado para quien no ha iniciado sesión, eso no cambia). Ninguna
-- de las dos tablas trae montos de pago: no es un retroceso de lo financiero, que sigue
-- bloqueado (facturación, gastos, nómina, prestaciones, bonos, prefacturas, autorizaciones,
-- alertas...) tal como quedó ayer.
--
-- AUDITORÍA COMPLETA (2026-10-04, hecha tabla por tabla antes de escribir esto):
--   · Se revisaron los 102 archivos del sistema que construyen o usan un cliente de base de
--     datos, clasificando cada uno en "pregunta como el usuario" o "pregunta como el servidor".
--   · Se cruzó cada una de las 27 tablas de la lista explícita del 221 MÁS todas las que caen
--     por patrón de nombre, contra esos 102 archivos.
--   · Resultado: las ÚNICAS tablas con un consumidor que pregunta como el usuario son
--     headcount y evaluaciones_desempeno (las dos de este script). Todo lo demás que cerró el
--     221 se consulta siempre como servidor, así que sigue funcionando.
--   · PORTAL DEL TRABAJADOR: verificado archivo por archivo. Sus tres módulos de datos
--     (portal-actions, portal-datos-personales-actions, portal-objetivos-actions) usan SIEMPRE
--     el acceso de servidor, y ninguna página del portal abre su propia conexión. No está ni
--     estuvo afectado. (El "Desprendible de nómina" sigue siendo una pantalla en construcción.)
--   · Páginas públicas sin sesión (encuesta de calificación del conductor por enlace, QR de
--     montacargas): también usan acceso de servidor. No afectadas.
--
-- Si aun así mañana aparece cualquier otra pantalla vacía, corre scripts/223_EMERGENCIA_revertir_221.sql
-- y avísame: devuelve todo a como estaba el 3 de octubre sin dejar la base abierta a extraños.
--
-- No toca datos. Se puede correr de inmediato.

begin;

drop policy if exists lipgo_autenticados on public.headcount;
create policy lipgo_autenticados on public.headcount for all to authenticated using (true) with check (true);

drop policy if exists lipgo_autenticados on public.evaluaciones_desempeno;
create policy lipgo_autenticados on public.evaluaciones_desempeno for all to authenticated using (true) with check (true);

commit;

-- Comprobación (visible en el editor SQL)
select tablename, policyname
from pg_policies
where schemaname = 'public' and tablename in ('headcount', 'evaluaciones_desempeno')
order by tablename;
