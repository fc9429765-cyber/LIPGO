
-- 221 · SEGURIDAD etapa 2: lo financiero y la nómina quedan SOLO para el servidor.
--
-- Gerencia 2026-10-03: "el área financiera debe estar bloqueada para todos salvo gerencia
-- general" y "no quiero que esto bloquee a los usuarios en sus manejos de módulos con
-- permisos en la app". Con el SQL 220 el rol `authenticated` (cualquier usuario con sesión)
-- quedó con una política de paso en todas las tablas: la app funciona igual, pero un usuario
-- con conocimientos técnicos podía consultar nómina o facturación por fuera de la app con su
-- propia sesión. Este script quita ese paso SOLO en tablas, vistas y funciones financieras,
-- de nómina, de personal, de autorizaciones y de alertas. Los permisos por módulo de la app
-- (Gestión de Usuarios) NO cambian: quien tiene el módulo sigue viéndolo igual, porque desde
-- el commit "feat(seguridad): consultas financieras y de nómina pasan al servidor" esas
-- pantallas leen a través del servidor (sesión + permiso del módulo + service role).
--
-- Requisito ANTES de correrlo: producción con ese commit (si no, Estado de Resultados,
-- Nominapersonal, Tolva, Novedades de personal y Gastos quedarían sin datos).
-- No toca datos. Reversible (ver al final).

begin;

-- A. Tablas: sin política de paso para authenticated (RLS activo y sin política = sin acceso
--    directo; el servidor usa service role y no se ve afectado).
do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and (
        tablename in (
          'facturacion','gastos','cargos_fijos_generados','prestaciones_activos_pagos','ajustes_proyeccion',
          'bonos_nomina','headcount','toneladasauxiliares','toneladasauxiliarespago','pagonomina',
          'autorizacion_claves','autorizacion_correos','autorizacion_recuperacion','autorizacion_log',
          'autorizacion_usuario_perfiles','autorizacion_usuario_procesos','autorizacion_perfil_procesos','autorizacion_config',
          'alerta_suscripciones','alerta_envios','app_errores',
          'prefacturas','prefactura_ciclo_eventos','condiciones_generacion_prefactura','condiciones_envio_anexo',
          'cierre_produccion_destinatarios','sig_indicadores'
        )
        or tablename ~ '^(pago|nomina|prestacion|parafiscal|factur|prefactur|gasto|cargos_fijos|bonos_|autorizacion_|alerta_|liquidacion|vacaciones|tarifa|siigo|cierre_financiero|cuadro_control|archivoplano|recobro|incapacidad|examenes|hojas_vida|antecedentes|entrevistas|evaluaciones|headcount|salario|planilla|pila_|parametros_nomina|parametros_legales|revision_nomina|analisis_financiero)'
      )
  loop
    execute format('drop policy if exists lipgo_autenticados on public.%I', t);
    execute format('alter table public.%I enable row level security', t);
    n := n + 1;
    raise notice 'tabla solo servidor: %', t;
  end loop;
  raise notice 'tablas cerradas a authenticated: %', n;
end $$;

-- B. Vistas financieras/nómina: sin SELECT para authenticated (las vistas no usan RLS).
do $$
declare
  v text;
begin
  for v in
    select viewname from pg_views
    where schemaname = 'public'
      and (
        viewname in ('facturacionturnos','toneladasauxiliarespago','pagonomina','archivoplano')
        or viewname ~ '^(pago|nomina|factur|prefactur|archivoplano|liquidacion|parafiscal|prestacion|cuadro_control|cierre_financiero|analisis_financiero)'
      )
  loop
    execute format('revoke all on public.%I from authenticated', v);
    raise notice 'vista solo servidor: %', v;
  end loop;
end $$;

-- C. Funciones de nómina/facturación que el navegador llamaba directo: sin EXECUTE para
--    authenticated. Lista explícita (nunca funciones de trigger).
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('pagonomina_rango','archivoplano_periodo','auditoria_resumen')
  loop
    execute format('revoke all on function %s from authenticated', f.firma);
    raise notice 'función solo servidor: %', f.firma;
  end loop;
end $$;

commit;

-- Comprobación (visible en el editor SQL)
select
  (select count(*) from pg_tables t where t.schemaname = 'public' and t.rowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename)) as tablas_solo_servidor,
  (select count(*) from pg_policies where schemaname = 'public' and policyname = 'lipgo_autenticados') as tablas_con_paso_authenticated,
  (select count(*) from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public'
     and table_name in ('facturacionturnos','toneladasauxiliarespago','pagonomina','archivoplano','facturacion','headcount','gastos')) as grants_authenticated_restantes_en_sensibles;

-- Reversa (por objeto) si una pantalla quedara sin datos:
--   create policy lipgo_autenticados on public.<tabla> for all to authenticated using (true) with check (true);
--   grant select on public.<vista> to authenticated;
--   grant execute on function public.pagonomina_rango(date, date) to authenticated;
