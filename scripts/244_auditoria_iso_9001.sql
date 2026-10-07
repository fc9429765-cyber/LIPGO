-- ============================================================================
-- 244 - MODULO DE AUDITORIA ISO 9001:2015
-- ----------------------------------------------------------------------------
-- Lleva a LIPgo el libro de Excel "Modulo_Auditoria ISO 9001:2015 v1": la
-- planeacion de la auditoria, el checklist de los 28 requisitos de la norma,
-- los hallazgos con su accion correctiva, y el informe.
--
-- POR QUE VARIAS TABLAS Y NO UNA
--
-- En el Excel todo vive en hojas sueltas que se copian para cada auditoria.
-- Aqui una AUDITORIA es una cabecera, sus RESPUESTAS son una fila por
-- requisito, y los HALLAZGOS cuelgan de la respuesta que los origino. Asi dos
-- auditorias del mismo proceso no se pisan, y un hallazgo siempre sabe de que
-- requisito salio -- que es lo que pide la norma para la trazabilidad.
--
-- El CATALOGO de requisitos va aparte: la norma es la misma para todas las
-- auditorias. Copiar las 28 preguntas en cada una las volveria imposibles de
-- corregir, y es justo lo que hace el Excel.
--
-- Aditivo e idempotente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASO 1 - EL CATALOGO DE REQUISITOS DE LA NORMA
-- ----------------------------------------------------------------------------

create table if not exists public.auditoria_iso_requisitos (
  codigo text primary key,              -- 'ISO-4.1'
  capitulo int not null,                -- 4..10
  requisito text not null,
  pregunta text not null,
  orden int,
  activo boolean not null default true  -- sin borrar: un requisito retirado se apaga
);

comment on table public.auditoria_iso_requisitos is
  'Catalogo de los requisitos auditables de ISO 9001:2015. Es la norma, igual para todas las auditorias: por eso vive aparte y no copiado en cada una. Ver scripts/244.';

insert into public.auditoria_iso_requisitos (codigo, capitulo, requisito, pregunta) values
  ('ISO-4.1', 4, '4.1 Comprensión de la organización y de su contexto', '¿La organización determina las cuestiones externas e internas pertinentes para su propósito y dirección estratégica?'),
  ('ISO-4.2', 4, '4.2 Necesidades y expectativas de las partes interesadas', '¿La organización determina las partes interesadas pertinentes y sus requisitos relevantes?'),
  ('ISO-4.3', 4, '4.3 Determinación del alcance del SGC', '¿El alcance del SGC está determinado y disponible como información documentada?'),
  ('ISO-4.4', 4, '4.4 Sistema de gestión de la calidad y sus procesos', '¿La organización determina y gestiona los procesos necesarios y sus interacciones?'),
  ('ISO-5.1', 5, '5.1 Liderazgo y compromiso', '¿La alta dirección demuestra liderazgo y compromiso con el SGC?'),
  ('ISO-5.2', 5, '5.2 Política de la calidad', '¿La política de calidad es apropiada, comunicada y está disponible según corresponda?'),
  ('ISO-5.3', 5, '5.3 Roles, responsabilidades y autoridades', '¿Están definidas y comunicadas las responsabilidades y autoridades pertinentes?'),
  ('ISO-6.1', 6, '6.1 Acciones para abordar riesgos y oportunidades', '¿La organización determina riesgos y oportunidades y planifica acciones para abordarlos?'),
  ('ISO-6.2', 6, '6.2 Objetivos de la calidad y planificación', '¿Existen objetivos de calidad coherentes, medibles cuando sea aplicable, y planes para lograrlos?'),
  ('ISO-6.3', 6, '6.3 Planificación de los cambios', '¿Los cambios del SGC se planifican considerando propósito, consecuencias, integridad, recursos y responsabilidades?'),
  ('ISO-7.1', 7, '7.1 Recursos', '¿La organización determina y proporciona los recursos necesarios para establecer, implementar, mantener y mejorar el SGC?'),
  ('ISO-7.2', 7, '7.2 Competencia', '¿Se determina la competencia necesaria y se conserva evidencia apropiada?'),
  ('ISO-7.3', 7, '7.3 Toma de conciencia', '¿Las personas son conscientes de la política, objetivos pertinentes y contribución al SGC?'),
  ('ISO-7.4', 7, '7.4 Comunicación', '¿La organización determina las comunicaciones internas y externas pertinentes al SGC?'),
  ('ISO-7.5', 7, '7.5 Información documentada', '¿La información documentada requerida es controlada y está disponible cuando se necesita?'),
  ('ISO-8.1', 8, '8.1 Planificación y control operacional', '¿La organización planifica, implementa y controla los procesos necesarios para cumplir requisitos?'),
  ('ISO-8.2', 8, '8.2 Requisitos para los productos y servicios', '¿La organización determina, revisa y comunica adecuadamente los requisitos de productos y servicios?'),
  ('ISO-8.3', 8, '8.3 Diseño y desarrollo', '¿Cuando aplica, se controlan las etapas y controles del diseño y desarrollo?'),
  ('ISO-8.4', 8, '8.4 Control de procesos, productos y servicios suministrados externamente', '¿Se determinan y aplican criterios para evaluar, seleccionar, seguir el desempeño y reevaluar proveedores externos?'),
  ('ISO-8.5', 8, '8.5 Producción y provisión del servicio', '¿La producción o prestación del servicio se realiza bajo condiciones controladas?'),
  ('ISO-8.6', 8, '8.6 Liberación de productos y servicios', '¿Se implementan disposiciones planificadas para verificar que se cumplen los requisitos antes de la liberación?'),
  ('ISO-8.7', 8, '8.7 Control de las salidas no conformes', '¿Las salidas no conformes se identifican y controlan para prevenir su uso o entrega no intencionada?'),
  ('ISO-9.1', 9, '9.1 Seguimiento, medición, análisis y evaluación', '¿La organización determina qué necesita seguimiento y medición y evalúa el desempeño y eficacia del SGC?'),
  ('ISO-9.2', 9, '9.2 Auditoría interna', '¿La organización realiza auditorías internas a intervalos planificados y conserva evidencia de su programa y resultados?'),
  ('ISO-9.3', 9, '9.3 Revisión por la dirección', '¿La alta dirección revisa el SGC a intervalos planificados considerando las entradas y salidas requeridas?'),
  ('ISO-10.1', 10, '10.1 Generalidades de mejora', '¿La organización determina y selecciona oportunidades de mejora e implementa acciones necesarias?'),
  ('ISO-10.2', 10, '10.2 No conformidad y acción correctiva', '¿Las no conformidades son reaccionadas, corregidas, analizadas en cuanto a causa y seguidas para verificar eficacia?'),
  ('ISO-10.3', 10, '10.3 Mejora continua', '¿La organización mejora continuamente la conveniencia, adecuación y eficacia del SGC?')
on conflict (codigo) do update
  set capitulo  = excluded.capitulo,
      requisito = excluded.requisito,
      pregunta  = excluded.pregunta;

-- El orden de la norma: por capitulo y por el numero dentro del capitulo.
update public.auditoria_iso_requisitos
   set orden = (capitulo * 100) + coalesce(
         nullif(split_part(split_part(codigo, '-', 2), '.', 2), '')::int, 0);


-- ----------------------------------------------------------------------------
-- PASO 2 - LA AUDITORIA (la hoja DATOS_AUDITORIA)
-- ----------------------------------------------------------------------------

create table if not exists public.auditorias (
  id bigserial primary key,
  idempresa int not null,

  codigo text,
  fecha date not null default current_date,
  organizacion text,
  proceso text,
  responsable_proceso text,
  auditor_lider text,
  equipo_auditor text,

  tipo text not null default 'Interna',
  objetivo text default 'Evaluar la conformidad y eficacia del proceso',
  alcance text,
  criterios text default 'ISO 9001:2015 y documentacion interna aplicable',
  metodologia text default 'Entrevistas, revision documental, revision de registros',
  periodo_auditado text,

  /*
   * borrador -> en_curso -> cerrada
   *
   * Una auditoria CERRADA ya no admite cambios en sus respuestas: su informe
   * es evidencia ante el ente certificador, y editarlo despues dejaria un
   * informe que no corresponde a lo que se audito.
   */
  estado text not null default 'borrador',

  conclusiones text,
  fecha_cierre date,

  creado_por text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.auditorias is
  'Cabecera de cada auditoria ISO 9001. Una fila por auditoria realizada. Ver scripts/244.';

create index if not exists ix_auditorias_empresa on public.auditorias (idempresa, fecha desc);
create index if not exists ix_auditorias_estado  on public.auditorias (estado);


-- ----------------------------------------------------------------------------
-- PASO 3 - LAS RESPUESTAS DEL CHECKLIST
-- ----------------------------------------------------------------------------
-- Una fila por requisito evaluado en esa auditoria. Se crean las 28 al abrir
-- la auditoria, en 'Pendiente', para que el auditor vea la lista completa y no
-- se le olvide ninguna -- igual que el Excel, pero sin copiar la norma.

create table if not exists public.auditoria_respuestas (
  id bigserial primary key,
  auditoria_id bigint not null references public.auditorias(id) on delete cascade,
  requisito_codigo text not null references public.auditoria_iso_requisitos(codigo),

  /*
   * Pendiente | Conforme | No conforme | Observacion | Oportunidad de mejora | No aplica
   *
   * `No aplica` sale del calculo de cumplimiento: un requisito que no le
   * corresponde al proceso no puede contar como incumplido. Es la misma regla
   * del Excel: conformes / (evaluados - no aplica).
   */
  resultado text not null default 'Pendiente',

  evidencia text,
  documento text,
  comentario text,
  auditor text,
  fecha date,

  updated_at timestamptz default now(),

  -- Un requisito se evalua UNA vez por auditoria.
  unique (auditoria_id, requisito_codigo)
);

comment on table public.auditoria_respuestas is
  'Respuesta a cada requisito dentro de una auditoria. "No aplica" no cuenta como incumplimiento. Ver scripts/244.';

create index if not exists ix_aud_resp_auditoria on public.auditoria_respuestas (auditoria_id);
create index if not exists ix_aud_resp_resultado on public.auditoria_respuestas (resultado);


-- ----------------------------------------------------------------------------
-- PASO 4 - LOS HALLAZGOS Y SUS ACCIONES
-- ----------------------------------------------------------------------------
-- La hoja HALLAZGOS. Cuelgan de la respuesta que los origino: un hallazgo sin
-- requisito no se puede defender ante un auditor externo.

create table if not exists public.auditoria_hallazgos (
  id bigserial primary key,
  auditoria_id bigint not null references public.auditorias(id) on delete cascade,
  /*
   * De que requisito salio. Puede ser NULL para un hallazgo general que no
   * cuelga de un requisito concreto, pero lo normal es que apunte a uno.
   */
  requisito_codigo text references public.auditoria_iso_requisitos(codigo),

  consecutivo text,
  tipo text not null default 'No conformidad',
  proceso text,
  criterio text,
  evidencia text,
  descripcion text not null,

  correccion_inmediata text,
  analisis_causa text,
  accion_correctiva text,
  responsable text,
  fecha_compromiso date,

  verificacion_eficacia text,
  /*
   * Abierto -> En proceso -> Cerrado
   *
   * Un hallazgo no se cierra sin verificacion de eficacia: cerrar sin
   * comprobar que la accion sirvio es justo lo que la norma pide evitar
   * (10.2: "revisar la eficacia de la accion correctiva").
   */
  estado text not null default 'Abierto',
  fecha_cierre date,
  observaciones text,

  creado_por text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.auditoria_hallazgos is
  'Hallazgos de auditoria con su accion correctiva y verificacion de eficacia (ISO 9001 10.2). Ver scripts/244.';

create index if not exists ix_aud_hall_auditoria on public.auditoria_hallazgos (auditoria_id);
create index if not exists ix_aud_hall_estado    on public.auditoria_hallazgos (estado);
create index if not exists ix_aud_hall_vence     on public.auditoria_hallazgos (fecha_compromiso)
  where estado <> 'Cerrado';


-- ----------------------------------------------------------------------------
-- PASO 5 - VERIFICACION (solo lecturas)
-- ----------------------------------------------------------------------------

-- 5a) El catalogo quedo completo: capitulos 4 a 10.
select capitulo, count(*) as requisitos
from public.auditoria_iso_requisitos
where activo
group by capitulo
order by capitulo;

-- 5b) Las tablas quedaron creadas.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('auditorias','auditoria_respuestas','auditoria_hallazgos','auditoria_iso_requisitos')
order by table_name;


-- ----------------------------------------------------------------------------
-- REVERSION
-- ----------------------------------------------------------------------------
--   drop table if exists public.auditoria_hallazgos;
--   drop table if exists public.auditoria_respuestas;
--   drop table if exists public.auditorias;
--   drop table if exists public.auditoria_iso_requisitos;
