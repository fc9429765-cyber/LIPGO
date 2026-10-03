
-- 216 · BSC: indicadores de PEDIDOS del cliente como parte de la matriz integradora.
-- Gerencia 2026-10-03: "todo orientado al resultado; el BSC es la matriz integradora".
-- Los cinco indicadores se calculan en vivo con la MISMA definición de Gestionar pedidos
-- y del Dashboard (lib/pedidos-indicadores.ts), vía calculo_auto en getIndicadoresValores.
-- Aditivo e idempotente. Alcance LIP (idempresa = 100). Las metas también viven en
-- lib/kpis-area.ts (KPI_DEFS): si se cambian aquí, cambiarlas allá.

insert into public.sig_indicadores
  (idempresa, codigo, proceso_codigo, nombre, tipo, parte_interesada, formula, fuente, calculo_auto, unidad, meta, sentido, frecuencia, responsable, orden,
   perspectiva, area, finalidad, cliente_interno, cliente_externo, contribucion)
values
  (100, 'IND-PED-01', 'CD', 'Pedidos a tiempo', 'resultado', 'cliente',
   'Pedidos cuya orden de cargue (o entrega) se dio el día de la promesa o antes / pedidos con fecha de cargue en el período (por fecha prometida)',
   'pedidoscabecera', 'ped_a_tiempo', '%', 95, 'mayor_mejor', 'mensual', 'Gerencia de proyecto (cliente)', 60,
   'cliente', 'Cargue y Descargue', 'Saber si la operación cumple la fecha prometida al cliente final', 'Logística del cliente y Recepción y Despacho', 'Cliente final del proyecto', 'Alimenta el nivel de servicio global (IND-G-06)'),
  (100, 'IND-PED-02', 'CD', 'Pedidos atrasados hoy', 'resultado', 'cliente',
   'Pedidos aprobados con promesa vencida y sin orden de cargue, vehículo ni entrega, a la fecha de consulta (foto de hoy)',
   'pedidoscabecera', 'ped_atrasados', '#', 0, 'menor_mejor', 'diaria', 'Gerencia de proyecto (cliente)', 61,
   'procesos', 'Cargue y Descargue', 'Actuar hoy sobre lo que ya incumplió: programar vehículos o depurar', 'Logística del cliente', 'Cliente final del proyecto', 'Reduce el atraso y limpia la cola de pedidos'),
  (100, 'IND-PED-03', 'CD', 'Entregas completas', 'resultado', 'cliente',
   'Pedidos entregados completos / (entregados completos + entregas parciales) en el período',
   'pedidoscabecera', 'ped_completos', '%', 98, 'mayor_mejor', 'mensual', 'Gerencia de proyecto (cliente)', 62,
   'cliente', 'Cargue y Descargue', 'Medir si el pedido sale completo o en partes (inventario y producción)', 'Logística del cliente, Almacenamiento y Producción', 'Cliente final del proyecto', 'Alimenta el nivel de servicio global (IND-G-06)'),
  (100, 'IND-PED-04', 'CD', 'Pedidos pendientes del período', 'resultado', 'cliente',
   'Pedidos del período (por promesa) que siguen abiertos sin orden de cargue',
   'pedidoscabecera', 'ped_pendientes', '#', null, 'menor_mejor', 'mensual', 'Gerencia de proyecto (cliente)', 63,
   'procesos', 'Cargue y Descargue', 'Ver cuánto del mes prometido sigue sin despachar', 'Logística del cliente', 'Cliente final del proyecto', 'Informativo: explica el % a tiempo'),
  (100, 'IND-PED-05', 'CD', 'Pedidos del mismo día', 'resultado', 'cliente',
   'Pedidos registrados el mismo día de la fecha prometida / pedidos con promesa en el período',
   'pedidoscabecera', 'ped_mismo_dia', '%', null, 'menor_mejor', 'mensual', 'Gerencia de proyecto (cliente)', 64,
   'procesos', 'Cargue y Descargue', 'Medir la anticipación con que llega el pedido para programar la flota', 'Logística del cliente y comercial (CRM)', 'Cliente final del proyecto', 'Informativo: a mayor anticipación, mejor programación de vehículos')
on conflict (idempresa, codigo) do update set
  proceso_codigo = excluded.proceso_codigo, nombre = excluded.nombre, tipo = excluded.tipo, parte_interesada = excluded.parte_interesada,
  formula = excluded.formula, fuente = excluded.fuente, calculo_auto = excluded.calculo_auto, unidad = excluded.unidad,
  meta = excluded.meta, sentido = excluded.sentido, frecuencia = excluded.frecuencia, responsable = excluded.responsable, orden = excluded.orden,
  perspectiva = excluded.perspectiva, area = excluded.area, finalidad = excluded.finalidad, cliente_interno = excluded.cliente_interno,
  cliente_externo = excluded.cliente_externo, contribucion = excluded.contribucion, activo = true;

-- Comprobación (visible en el editor SQL)
select codigo, nombre, calculo_auto, unidad, meta, sentido, frecuencia, perspectiva
from public.sig_indicadores
where idempresa = 100 and codigo like 'IND-PED-%'
order by orden;
