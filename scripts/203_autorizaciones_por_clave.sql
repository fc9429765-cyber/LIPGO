-- =====================================================================
-- 203 — AUTORIZACIONES POR CLAVE (estilo SAP: identidad del usuario +
--       permisos por proceso/código asignados por puesto).
--
-- Antes: 7 mecanismos de clave distintos, todos COMPARTIDOS y sin
-- recuperación (inv_clave_movimiento, inv_clave_aprobacion_ajustes,
-- inv_clave_gerencia_proyecto, usuariocartera.contra, CLAVES_ANULAR en el
-- código, GESTION_FINANCIERA_CLAVE, BONOS_APROBACION_CLAVE).
--
-- Ahora: cada usuario de LIPgo tiene UNA clave personal (hash scrypt, nunca
-- en claro), la crea y la recupera él mismo (código al correo) y con ella
-- autoriza SOLO los procesos que su perfil (puesto) tenga permitidos, en los
-- proyectos que se le indiquen. Quién autorizó queda con nombre real.
--
-- Transición: las claves compartidas de hoy siguen valiendo hasta la fecha de
-- `autorizacion_config.transicion_claves_compartidas_hasta` (30 días). Después
-- solo valen las personales. La fecha se administra desde la pantalla.
--
-- Aditivo e idempotente.
-- =====================================================================

-- DOS NIVELES QUE NO SE MEZCLAN:
--   · Gerencia General LIPgo = la DUEÑA del software. Administra la herramienta
--     (quién tiene qué perfil) y es respaldo de emergencia. NO es el camino normal
--     para autorizar movimientos del inventario del cliente.
--   · Gerencia de proyecto = la gerencia del CLIENTE de cada ID (Indupan, Avimol,
--     cada Cedi). Autoriza SOLO en su proyecto (alcance = su idempresa).
--
-- LO FINANCIERO ES PROPIEDAD DE LIP: los procesos del grupo "Financiera" solo
-- pueden otorgarse y usarse por usuarios que YA tengan módulos de Gestión
-- Financiera en Gestión de Usuarios (exclusiva de LIPgo). Lo hace cumplir el
-- código (lib/permisos-financieros.ts + lib/autorizaciones-core.ts), tanto al
-- asignar como al autorizar.
--
-- ESTE SQL NO MODIFICA NINGÚN PERMISO POR MÓDULO EXISTENTE: solo agrega la
-- columna del nuevo submódulo. Comprobable con scripts/snapshot_permisos_usuarios.mts
-- (foto antes / foto después: cero cambios en las columnas existentes).
--
-- (a) Permiso del nuevo submódulo "Autorizaciones por clave" (Configuración ›
--     General). Se otorga EXACTAMENTE al mismo conjunto que hoy tiene "Gestión de
--     Usuarios" (exclusivo de LIPgo): mismo criterio, misma gente, sin ampliar.
alter table public.permisos_usuarios
  add column if not exists autorizaciones_clave boolean not null default false;
update public.permisos_usuarios
   set autorizaciones_clave = true
 where gestion_usuarios = true;

-- (b) Catálogo de procesos autorizables (el "código" al que se da permiso).
create table if not exists public.autorizacion_procesos (
  codigo text primary key,
  nombre text not null,
  descripcion text,
  grupo text not null,
  orden integer not null default 0,
  con_alcance boolean not null default true,   -- se puede limitar por proyecto (idempresa)
  activo boolean not null default true
);
alter table public.autorizacion_procesos disable row level security;

insert into public.autorizacion_procesos (codigo, nombre, descripcion, grupo, orden, con_alcance) values
  ('inv_309', 'Corrección de lote / reclasificación (309)', 'Ejecutar el movimiento 309 en Transacciones de Inventario › Movimiento por código.', 'Inventario', 10, true),
  ('inv_102', 'Reverso de ingreso (102)', 'Anular total o parcialmente un ingreso digitado mal.', 'Inventario', 11, true),
  ('inv_602', 'Reverso de salida (602)', 'Anular total o parcialmente una salida digitada mal.', 'Inventario', 12, true),
  ('inv_552', 'Reverso de merma (552)', 'Devolver al inventario una merma registrada por error.', 'Inventario', 13, true),
  ('inv_312', 'Reverso de traslado (312)', 'Regresar a su ubicación un traslado hecho por error.', 'Inventario', 14, true),
  ('inv_343', 'Liberar de cuarentena (343)', 'Devolver a disponible producto retenido por calidad. Decisión de la gerencia del proyecto.', 'Inventario', 20, true),
  ('inv_601_aprobar', 'Aprobar despacho manual (601)', 'Aprobar o rechazar en "Aprobaciones pendientes" una salida sin orden de cargue.', 'Inventario', 30, true),
  ('inv_702_aprobar', 'Aprobar faltante de inventario (702)', 'Aprobar o rechazar en "Aprobaciones pendientes" una diferencia de conteo.', 'Inventario', 31, true),
  ('inv_555_aprobar', 'Aprobar desecho por calidad (555)', 'Aprobar o rechazar en "Aprobaciones pendientes" la salida definitiva de producto en cuarentena.', 'Inventario', 32, true),
  ('ped_aprobar_gerencia', 'Aprobar pedido (revisión de gerencia)', 'Botón "Aprobar" en Gestionar pedidos. Queda como revisión de gerencia.', 'Pedidos', 40, true),
  ('ped_aprobar_cartera', 'Aprobar cartera de un pedido', 'Registrar la revisión de cartera de un pedido.', 'Pedidos', 41, true),
  ('ped_anular', 'Anular pedido aprobado', 'Anular un pedido ya aprobado (sin orden de cargue asignada).', 'Pedidos', 42, true),
  ('ped_cerrar_pendiente', 'Cerrar pedido con entrega parcial', 'Cerrar un pedido en estado parcial.', 'Pedidos', 43, true),
  ('fin_gestion_financiera', 'Entrar a Gestión Financiera', 'Candado del grupo Gestión Financiera (además de los permisos de cada submódulo).', 'Financiera', 50, false),
  ('fin_bonos_aprobar', 'Aprobar bonos de nómina', 'Aprobar un bono: entra a la nómina y al archivo plano.', 'Financiera', 51, false)
on conflict (codigo) do update set
  nombre = excluded.nombre, descripcion = excluded.descripcion, grupo = excluded.grupo,
  orden = excluded.orden, con_alcance = excluded.con_alcance;

-- (c) Perfiles de autorización (= puestos) y qué procesos permite cada uno.
create table if not exists public.autorizacion_perfiles (
  id serial primary key,
  nombre text not null unique,
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.autorizacion_perfiles disable row level security;

create table if not exists public.autorizacion_perfil_procesos (
  perfil_id integer not null references public.autorizacion_perfiles(id) on delete cascade,
  proceso text not null references public.autorizacion_procesos(codigo) on delete cascade,
  primary key (perfil_id, proceso)
);
alter table public.autorizacion_perfil_procesos disable row level security;

insert into public.autorizacion_perfiles (nombre, descripcion) values
  ('Gerencia General LIPgo', 'Administración general de LIPgo: todos los procesos en todos los proyectos. Respaldo, no el camino normal para movimientos del cliente.'),
  ('Gerencia de proyecto', 'Gerencia del cliente/proyecto (Indupan, Avimol, cada Cedi): aprueba ajustes 601/702/555, libera cuarentena, aprueba y anula pedidos. Asignar con alcance a SU proyecto.'),
  ('Calidad', 'Decide sobre producto retenido: libera de cuarentena (343). Bloquear (344) y solicitar desecho (555) no piden clave.'),
  ('Cartera', 'Revisión de cartera de pedidos.'),
  ('Coordinación de inventario', 'Ejecuta correcciones de inventario (309/102/602/552/312) con motivo; quedan en el historial de correcciones.'),
  ('Financiera', 'Acceso al grupo Gestión Financiera y aprobación de bonos.')
on conflict (nombre) do nothing;

insert into public.autorizacion_perfil_procesos (perfil_id, proceso)
select p.id, pr.codigo
from public.autorizacion_perfiles p
join public.autorizacion_procesos pr on (
     (p.nombre = 'Gerencia General LIPgo')
  or (p.nombre = 'Gerencia de proyecto' and pr.codigo in ('inv_601_aprobar','inv_702_aprobar','inv_555_aprobar','inv_343','ped_aprobar_gerencia','ped_anular','ped_cerrar_pendiente'))
  or (p.nombre = 'Calidad' and pr.codigo in ('inv_343'))
  or (p.nombre = 'Cartera' and pr.codigo in ('ped_aprobar_cartera'))
  or (p.nombre = 'Coordinación de inventario' and pr.codigo in ('inv_309','inv_102','inv_602','inv_552','inv_312'))
  or (p.nombre = 'Financiera' and pr.codigo in ('fin_gestion_financiera','fin_bonos_aprobar'))
)
on conflict do nothing;

-- (d) Asignación de perfiles a usuarios, con alcance por proyecto (null = todos).
create table if not exists public.autorizacion_usuario_perfiles (
  id serial primary key,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  perfil_id integer not null references public.autorizacion_perfiles(id) on delete cascade,
  idempresa integer null,
  asignado_por text,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_autorizacion_usuario_perfiles
  on public.autorizacion_usuario_perfiles (usuario_id, perfil_id, coalesce(idempresa, 0));
alter table public.autorizacion_usuario_perfiles disable row level security;

-- Excepciones puntuales por usuario: conceder o negar UN proceso (gana sobre el perfil).
create table if not exists public.autorizacion_usuario_procesos (
  id serial primary key,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  proceso text not null references public.autorizacion_procesos(codigo) on delete cascade,
  idempresa integer null,
  permitir boolean not null default true,
  asignado_por text,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_autorizacion_usuario_procesos
  on public.autorizacion_usuario_procesos (usuario_id, proceso, coalesce(idempresa, 0));
alter table public.autorizacion_usuario_procesos disable row level security;

-- Semilla de asignaciones (editable en la pantalla):
--   · Gerencia General LIPgo → SOLO la cuenta de la DUEÑA del software: la
--     Gerencia de LIP entra con admonind@lipgo.app (perfil "Admon Indupan").
--     NO es la cuenta `admin` (admin@lipgocrm.com). Alcance: todos los
--     proyectos. Este perfil autoriza TODO y es respaldo; a otros
--     administradores se lo asigna la gerencia desde la pantalla si lo considera.
--   · Gerencia de proyecto / Calidad / Cartera → los usuarios "Gerencia X",
--     "Calidad X", "Cartera X" de cada proyecto (son del cliente), con alcance a
--     SU proyecto únicamente.
--   · Cartera → usuarios de LIPgo cuyo nombre coincide con un usuario de
--     cartera actual (usuariocartera), con alcance a su proyecto.
insert into public.autorizacion_usuario_perfiles (usuario_id, perfil_id, idempresa, asignado_por)
select pr.id, p.id, null, 'sql 203'
from public.profiles pr
join public.autorizacion_perfiles p on p.nombre = 'Gerencia General LIPgo'
where pr.id in (select u.id from auth.users u where lower(u.email) = 'admonind@lipgo.app')
on conflict do nothing;

-- "Gerencia Indupan" (perfil sin cuenta de acceso) es la misma persona que
-- "Jose Rangel" (gerenciaindupan@lipgo.app): el perfil se le da a Jose Rangel.
insert into public.autorizacion_usuario_perfiles (usuario_id, perfil_id, idempresa, asignado_por)
select pr.id, p.id, pr.empresa_id, 'sql 203'
from public.profiles pr
join public.autorizacion_perfiles p on p.nombre = 'Gerencia de proyecto'
where pr.empresa_id is not null
  and (pr.usuario ilike 'gerencia %' or pr.usuario = 'Jose Rangel')
on conflict do nothing;

insert into public.autorizacion_usuario_perfiles (usuario_id, perfil_id, idempresa, asignado_por)
select pr.id, p.id, pr.empresa_id, 'sql 203'
from public.profiles pr
join public.autorizacion_perfiles p on p.nombre = 'Calidad'
where pr.usuario ilike 'calidad%' and pr.empresa_id is not null
on conflict do nothing;

insert into public.autorizacion_usuario_perfiles (usuario_id, perfil_id, idempresa, asignado_por)
select pr.id, p.id, pr.empresa_id, 'sql 203'
from public.profiles pr
join public.autorizacion_perfiles p on p.nombre = 'Cartera'
where pr.empresa_id is not null
  and (pr.usuario ilike 'cartera%'
       or exists (select 1 from public.usuariocartera uc where lower(trim(uc.nombre)) = lower(trim(pr.usuario))))
on conflict do nothing;

-- (e) Clave personal (hash), recuperación y bitácora.
create table if not exists public.autorizacion_claves (
  usuario_id uuid primary key references public.profiles(id) on delete cascade,
  clave_hash text not null,
  provisional boolean not null default false,   -- la asignó un admin: obliga a definir la propia
  intentos_fallidos integer not null default 0,
  bloqueado_hasta timestamptz null,
  actualizado_en timestamptz not null default now(),
  actualizado_por text,
  created_at timestamptz not null default now()
);
alter table public.autorizacion_claves disable row level security;

create table if not exists public.autorizacion_recuperacion (
  id serial primary key,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  codigo_hash text not null,
  canal text not null default 'correo',
  destino text,
  expira_en timestamptz not null,
  intentos integer not null default 0,
  usado_en timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists ix_autorizacion_recuperacion_usuario on public.autorizacion_recuperacion (usuario_id, created_at desc);
alter table public.autorizacion_recuperacion disable row level security;

create table if not exists public.autorizacion_log (
  id bigserial primary key,
  usuario_id uuid null,
  usuario text,
  proceso text not null,
  idempresa integer null,
  resultado text not null,        -- ok | ok_compartida | clave_incorrecta | sin_permiso | sin_clave | bloqueado | provisional | sin_sesion
  autorizado_por text,
  referencia text,
  detalle jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_autorizacion_log_fecha on public.autorizacion_log (created_at desc);
create index if not exists ix_autorizacion_log_usuario on public.autorizacion_log (usuario_id, created_at desc);
alter table public.autorizacion_log disable row level security;

create table if not exists public.autorizacion_config (
  clave text primary key,
  valor text,
  actualizado_en timestamptz not null default now()
);
alter table public.autorizacion_config disable row level security;
insert into public.autorizacion_config (clave, valor)
values ('transicion_claves_compartidas_hasta', to_char(current_date + 30, 'YYYY-MM-DD'))
on conflict (clave) do nothing;

-- (f) El event trigger de auditoría (scripts/auditoria/04b) cuelga trg_auditoria a
--     toda tabla nueva. En estas tres NO conviene: la bitácora ya es la
--     auditoría (duplicaría cada fila), y los hashes de clave/código no deben
--     copiarse a otra tabla.
drop trigger if exists trg_auditoria on public.autorizacion_log;
drop trigger if exists trg_auditoria on public.autorizacion_recuperacion;
drop trigger if exists trg_auditoria on public.autorizacion_claves;

-- Verificación:
-- select codigo, grupo, nombre from public.autorizacion_procesos order by orden;
-- select p.nombre, count(pp.proceso) procesos from public.autorizacion_perfiles p left join public.autorizacion_perfil_procesos pp on pp.perfil_id = p.id group by p.nombre order by p.nombre;
-- select pr.usuario, pr.empresa_id, p.nombre perfil, up.idempresa alcance from public.autorizacion_usuario_perfiles up join public.profiles pr on pr.id = up.usuario_id join public.autorizacion_perfiles p on p.id = up.perfil_id order by pr.usuario;
-- select * from public.autorizacion_config;
