-- =====================================================================
-- 202 — Flujo de CALIDAD estilo SAP: bloquear (344) / liberar (343) /
--       desechar (555), con la clave de la GERENCIA DE CADA PROYECTO.
--
-- Por qué (caso Avimol 26-sep-2026): 120 und de producto contaminado se
-- sacaron con un 702 (faltante de inventario). En SAP un problema de calidad
-- no es un faltante: el producto pasa a stock BLOQUEADO (344), sigue en el
-- inventario pero no disponible, y luego se LIBERA (343) o se DESECHA (555).
-- El 702 queda solo para diferencias de conteo. Además, quien autoriza las
-- decisiones de calidad y los ajustes de un proyecto es la gerencia de ESE
-- proyecto -- no la gerencia general de LIPgo.
--
-- Aditivo e idempotente. No toca movimientos existentes.
-- =====================================================================

-- (a) Clave de gerencia POR PROYECTO. La usa: liberar de cuarentena (343),
--     aprobar/rechazar los ajustes pendientes (601 / 702 / 555) de su proyecto.
--     La clave general de inv_clave_aprobacion_ajustes sigue valiendo como
--     respaldo. Semilla: la misma clave con la que hoy cada gerencia autoriza o
--     anula pedidos (lib/orders-actions.tsx, CLAVES_ANULAR). Cambiarla es un
--     UPDATE de esta tabla; agregar otra persona es un INSERT.
create table if not exists public.inv_clave_gerencia_proyecto (
  id serial primary key,
  idempresa integer not null,
  responsable text not null,
  clave text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_inv_clave_gerencia_proyecto_empresa_clave
  on public.inv_clave_gerencia_proyecto (idempresa, clave);
alter table public.inv_clave_gerencia_proyecto disable row level security;

insert into public.inv_clave_gerencia_proyecto (idempresa, responsable, clave)
select v.idempresa, v.responsable, v.clave
from (values
  (1, 'Gerencia Indupan',        'LIP123456'),
  (2, 'Gerencia Avimol',         'Avimol2026'),
  (3, 'Gerencia Cedi Funza',     'LIP123456'),
  (4, 'Gerencia Cedi Medellín',  'LIP123456')
) as v(idempresa, responsable, clave)
where not exists (select 1 from public.inv_clave_gerencia_proyecto c where c.idempresa = v.idempresa);

-- (b) Ubicación CUARENTENA en cada proyecto (344 la usa como destino, 343 y
--     555 como origen). Se cuelga de la bodega con más ubicaciones del
--     proyecto. `activo` es texto en esta tabla ('true'), igual que las demás.
insert into public.locations (codigo, nombre, "Descripción", idempresa, activo, bodega)
select 'CUARENTENA',
       'Cuarentena — bloqueo por calidad (344)',
       'Producto retenido por calidad: sigue en el inventario pero NO está disponible para despacho. Sale con 343 (liberar) o 555 (desechar, requiere aprobación de la gerencia del proyecto).',
       e.id,
       'true',
       (select l.bodega from public.locations l
         where l.idempresa = e.id and l.bodega is not null
         group by l.bodega order by count(*) desc limit 1)
from public.empresas e
where e.id in (1, 2, 3, 4)
  and not exists (select 1 from public.locations l where l.idempresa = e.id and upper(l.codigo) like '%CUARENTENA%');

-- (c) 555 en la nomenclatura y en la cola de aprobación.
insert into public.sig_tipos_movimiento (codigo_sap, nombre, clase, origen_lipgo, descripcion, afecta_stock, orden, activo)
select '555', 'Desecho por calidad (desde cuarentena)', 'ajuste',
       'tipomov=Salida · origen: transaccion manual · solo desde CUARENTENA · requiere aprobación de la gerencia del proyecto',
       'Salida definitiva de producto que estaba BLOQUEADO en cuarentena (contaminado, vencido, no conforme) y calidad decidió no recuperar. Queda pendiente hasta que la gerencia del proyecto lo apruebe con su clave. Nunca se usa 702 para esto: 702 es solo diferencia de conteo.',
       true, 16, true
where not exists (select 1 from public.sig_tipos_movimiento where codigo_sap = '555');

alter table public.inv_ajustes_pendientes drop constraint if exists inv_ajustes_pendientes_codigo_check;
alter table public.inv_ajustes_pendientes add constraint inv_ajustes_pendientes_codigo_check
  check (codigo in ('601', '702', '555'));

-- Verificación:
-- select idempresa, responsable, activo from public.inv_clave_gerencia_proyecto order by idempresa;
-- select idempresa, codigo, bodega from public.locations where upper(codigo) like '%CUARENTENA%' order by idempresa;
-- select codigo_sap, nombre from public.sig_tipos_movimiento where codigo_sap in ('344','343','555');
