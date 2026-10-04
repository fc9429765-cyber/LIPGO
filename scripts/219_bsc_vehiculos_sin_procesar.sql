
-- 219 · BSC: "Vehículos sin procesar" como indicador de Recepción y Despacho.
-- Gerencia 2026-10-03: "tiene 45 vehículos sin procesar y no sucede nada; esto debe ser una
-- alerta". Definición: citasvehiculos con estatus nulo (registrados en portería y nunca
-- cerrados con una orden ni eliminados). Foto de hoy, sin período. Meta 0, menor es mejor:
-- cualquier pendiente pinta en rojo en el panel Indicadores del área y dispara la alerta por
-- correo a quien se suscriba (SQL 218). Se calcula en vivo (calculo_auto = veh_sin_procesar)
-- en getIndicadoresValores; la meta también vive en lib/kpis-area.ts (KPI_DEFS).
-- Aditivo e idempotente. Alcance LIP (idempresa = 100).

insert into public.sig_indicadores
  (idempresa, codigo, proceso_codigo, nombre, tipo, parte_interesada, formula, fuente, calculo_auto, unidad, meta, sentido, frecuencia, responsable, orden,
   perspectiva, area, finalidad, cliente_interno, cliente_externo, contribucion)
values
  (100, 'IND-VEH-01', 'CD', 'Vehículos sin procesar', 'resultado', 'cliente',
   'Vehículos registrados en portería (citasvehiculos) sin cerrar con una orden de cargue ni eliminar, a la fecha de consulta (foto de hoy, acumulado)',
   'citasvehiculos', 'veh_sin_procesar', '#', 0, 'menor_mejor', 'diaria', 'Gerencia de proyecto (cliente)', 65,
   'procesos', 'Cargue y Descargue', 'Que ningún vehículo registrado quede sin gestionar: cerrar con su orden o eliminar el registro el mismo día',
   'Recepción y Despacho del cliente (portería y quien programa la ruta)', 'Transportadores y cliente final del proyecto',
   'Limpia el patio en LIPgo: la lista de vehículos en patio vuelve a ser confiable para programar la ruta')
on conflict (idempresa, codigo) do update set
  proceso_codigo = excluded.proceso_codigo, nombre = excluded.nombre, tipo = excluded.tipo, parte_interesada = excluded.parte_interesada,
  formula = excluded.formula, fuente = excluded.fuente, calculo_auto = excluded.calculo_auto, unidad = excluded.unidad,
  meta = excluded.meta, sentido = excluded.sentido, frecuencia = excluded.frecuencia, responsable = excluded.responsable, orden = excluded.orden,
  perspectiva = excluded.perspectiva, area = excluded.area, finalidad = excluded.finalidad, cliente_interno = excluded.cliente_interno,
  cliente_externo = excluded.cliente_externo, contribucion = excluded.contribucion, activo = true;

-- Comprobación (visible en el editor SQL)
select codigo, nombre, calculo_auto, unidad, meta, sentido, frecuencia, perspectiva
from public.sig_indicadores
where idempresa = 100 and codigo = 'IND-VEH-01';
