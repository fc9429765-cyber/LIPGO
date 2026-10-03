
-- 215 · Pedidos y solicitudes: cola logística del cliente, depuración de pendientes
--       y hora de registro del pedido.
-- Decisión de gerencia 2026-10-03: Pedidos y Recepción y Despacho son procesos del
-- CLIENTE (el ID); el coordinador LIP no participa. Los pedidos que nunca se van a
-- entregar se depuran: quedan como 'no entregado' con motivo, quién y cuándo. No se
-- borra nada.
-- Idempotente y aditivo: se puede correr más de una vez y no cambia el comportamiento
-- de la app actual (las columnas nuevas quedan vacías hasta que se publique Gestionar).

-- (a) Columnas nuevas en pedidoscabecera
alter table public.pedidoscabecera add column if not exists creado_en timestamptz;
alter table public.pedidoscabecera alter column creado_en set default now();
alter table public.pedidoscabecera add column if not exists motivo_no_entrega text;
alter table public.pedidoscabecera add column if not exists depurado_por text;
alter table public.pedidoscabecera add column if not exists depurado_en timestamptz;

comment on column public.pedidoscabecera.creado_en is 'Fecha y hora de registro del pedido (default now()). Las filas anteriores a este script se rellenan desde la auditoría (INSERT) cuando existe; si no, queda nulo: solo se conoce la fecha.';
comment on column public.pedidoscabecera.motivo_no_entrega is 'Motivo de depuración (Gestionar pedidos › Depurar pendientes): reemplazado · desistió · modificado · vencido · otro, con detalle opcional.';
comment on column public.pedidoscabecera.depurado_por is 'Usuario que autorizó la depuración con su clave personal (proceso ped_depurar).';
comment on column public.pedidoscabecera.depurado_en is 'Fecha y hora de la depuración.';

-- (b) Relleno de creado_en desde la auditoría.
--     La bitácora guarda cada INSERT de pedidoscabecera desde el 2026-07-27 con la fila
--     completa en "despues" (registro_id llega nulo en esos INSERT; por eso se usa el JSON).
--     Solo se rellenan filas con creado_en nulo; nunca se sobreescribe.
--     Verificado el 2026-10-03 (scripts/verificar_215_pedidos_cola.mts --auditoria):
--     3.205 INSERT, todos con despues->>'idpedido'; en los 200 más recientes la fecha del
--     pedido coincide con el día (Bogotá) del INSERT.
update public.pedidoscabecera p
set creado_en = a.ts
from (
  select (despues->>'idpedido')::bigint   as idpedido,
         (despues->>'id_empresa')::integer as id_empresa,
         min(ts)                           as ts
  from public.auditoria
  where tabla = 'pedidoscabecera'
    and operacion = 'INSERT'
    and (despues->>'idpedido') is not null
  group by 1, 2
) a
where p.idpedido = a.idpedido
  and p.id_empresa = a.id_empresa
  and p.creado_en is null;

-- (c) Índices para la cola (por proyecto y fecha prometida / estado) y para saber si una
--     línea ya tiene orden de cargue.
create index if not exists pedidoscabecera_emp_fprog_idx  on public.pedidoscabecera (id_empresa, fecha_programada);
create index if not exists pedidoscabecera_emp_estado_idx on public.pedidoscabecera (id_empresa, estado);
create index if not exists pedidosdetalle_ped_oc_idx      on public.pedidosdetalle (idpedido, ocargue);

-- (d) Proceso autorizable: depurar pedidos. Lo tienen la gerencia del proyecto (el cliente)
--     y la gerencia general de LIPgo. El coordinador LIP NO: Pedidos es un proceso del cliente.
insert into public.autorizacion_procesos (codigo, nombre, descripcion, grupo, orden, con_alcance) values
  ('ped_depurar', 'Depurar pedidos que no se entregarán', 'En Gestionar pedidos › Depurar pendientes: marcar como "no entregado" los pedidos sin orden de cargue, vehículo ni lote (o cerrar como "entrega parcial" los parciales viejos), con motivo. No borra nada.', 'Pedidos', 44, true)
on conflict (codigo) do update set
  nombre = excluded.nombre, descripcion = excluded.descripcion, grupo = excluded.grupo,
  orden = excluded.orden, con_alcance = excluded.con_alcance;

insert into public.autorizacion_perfil_procesos (perfil_id, proceso)
select p.id, 'ped_depurar'
from public.autorizacion_perfiles p
where p.nombre in ('Gerencia General LIPgo', 'Gerencia de proyecto')
on conflict do nothing;

-- (e) Comprobación (el resultado se ve en el editor SQL)
select
  (select count(*) from public.pedidoscabecera)                                          as pedidos,
  (select count(*) from public.pedidoscabecera where creado_en is not null)              as con_hora_de_registro,
  (select count(*) from public.pedidoscabecera where lower(estado) = 'no entregado')     as no_entregados,
  (select count(*) from public.autorizacion_perfil_procesos where proceso = 'ped_depurar') as perfiles_con_ped_depurar;
