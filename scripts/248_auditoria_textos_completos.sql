-- ============================================================================
-- 248 — AUDITORÍA ISO 9001: LOS TEXTOS POR DEFECTO, COMPLETOS
-- ----------------------------------------------------------------------------
-- Al construir el módulo (script 244) los textos de la hoja DATOS_AUDITORIA
-- del Excel se leyeron recortados a 45 caracteres y sin tildes, y así quedaron
-- como valores por defecto de `auditorias`. Como la pantalla no los manda al
-- crear, CADA auditoría nueva heredaba el texto cortado:
--
--   objetivo:    "Evaluar la conformidad y eficacia del proceso"      (faltaba el final)
--   metodologia: "Entrevistas, revision documental, revision de registros"
--                                                      (faltaba "observación y muestreo")
--
-- Esto los deja como están en el Excel, para las instalaciones que ya
-- corrieron el 244. El 244 también quedó corregido para las que no.
--
-- Idempotente. Solo toca las auditorías que todavía tengan el texto viejo:
-- si alguien ya escribió un objetivo propio, no se pisa.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 — LOS DEFAULTS, PARA LAS AUDITORÍAS QUE SE CREEN DE AQUÍ EN ADELANTE
-- ----------------------------------------------------------------------------

alter table public.auditorias
  alter column objetivo set default
    'Evaluar la conformidad y eficacia del proceso auditado frente a los criterios definidos para el SGC.';

alter table public.auditorias
  alter column criterios set default
    'ISO 9001:2015 y documentación interna aplicable';

alter table public.auditorias
  alter column metodologia set default
    'Entrevistas, revisión documental, revisión de registros, observación y muestreo';


-- ----------------------------------------------------------------------------
-- PASO 2 — LAS AUDITORÍAS YA CREADAS CON EL TEXTO RECORTADO
-- ----------------------------------------------------------------------------
-- Solo donde el valor es EXACTAMENTE el viejo default: un texto editado a mano
-- por el auditor es suyo y no se toca.

update public.auditorias
   set objetivo = 'Evaluar la conformidad y eficacia del proceso auditado frente a los criterios definidos para el SGC.'
 where objetivo = 'Evaluar la conformidad y eficacia del proceso';

update public.auditorias
   set criterios = 'ISO 9001:2015 y documentación interna aplicable'
 where criterios = 'ISO 9001:2015 y documentacion interna aplicable';

update public.auditorias
   set metodologia = 'Entrevistas, revisión documental, revisión de registros, observación y muestreo'
 where metodologia = 'Entrevistas, revision documental, revision de registros';


-- ----------------------------------------------------------------------------
-- PASO 3 — VERIFICACIÓN (solo lecturas)
-- ----------------------------------------------------------------------------

-- 3a) Los defaults quedaron completos.
select column_name, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'auditorias'
  and column_name in ('objetivo', 'criterios', 'metodologia')
order by column_name;

-- 3b) No queda ninguna auditoría con el texto recortado.
select count(*) as con_texto_viejo
from public.auditorias
where objetivo    = 'Evaluar la conformidad y eficacia del proceso'
   or criterios   = 'ISO 9001:2015 y documentacion interna aplicable'
   or metodologia = 'Entrevistas, revision documental, revision de registros';
-- Debe dar 0.

-- 3c) El catálogo del checklist, tal como lo trae el Excel: 28 requisitos,
--     4+3+3+5+7+3+3 por capítulo. Es lo que se siembra en cada auditoría.
select capitulo, count(*) as requisitos
from public.auditoria_iso_requisitos
where activo
group by capitulo
order by capitulo;
