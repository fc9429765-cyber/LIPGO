-- =====================================================================
-- Apoyo en cargue: rastro de las EXCLUSIONES del reparto de toneladas.
--
-- Hasta ahora el módulo solo dejaba sacar de una orden a quien se había agregado
-- desde él mismo (había un rastro en `apoyo_cargue_asignaciones` que se borraba).
-- Por decisión de gerencia (2026-10-06) ahora también se puede sacar a un auxiliar
-- asignado en Picking/Packing, así que hace falta dejar constancia de quién lo sacó
-- y cuándo: `cabeceraoc.auxiliares` queda auditado con antes/después, pero el actor
-- que graba el trigger en una acción de servidor es "sistema", no la persona.
--
-- Aditivo e idempotente: solo crea la tabla. No toca nada existente ni cambia
-- ningún cálculo de nómina.
-- =====================================================================

create table if not exists public.apoyo_cargue_exclusiones (
  id serial primary key,
  idorden int not null,                -- cabeceraoc.id
  idempresa int,
  fecha date,                          -- día de la orden (cabeceraoc.fechacargue)
  persona text not null,               -- nombre tal como estaba en cabeceraoc.auxiliares
  origen text,                         -- 'apoyo' (lo había agregado este módulo) | 'picking'
  quitado_por text,                    -- usuario de la app que lo sacó
  creado_en timestamptz default now()
);

create index if not exists idx_apoyo_excl_orden on public.apoyo_cargue_exclusiones (idorden);
create index if not exists idx_apoyo_excl_fecha on public.apoyo_cargue_exclusiones (idempresa, fecha);

comment on table public.apoyo_cargue_exclusiones is
  'Quién sacó a un auxiliar del reparto de toneladas de una orden desde Compensación › Apoyo en cargue, y cuándo. Solo rastro: no lo lee ningún cálculo.';

-- =========================== DESPUÉS ================================
select 'tabla creada' as verificacion, count(*) as filas from public.apoyo_cargue_exclusiones;
