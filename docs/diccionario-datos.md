# Diccionario de datos de LIPgo

> **Este archivo se GENERA. No lo edites a mano.**
> Se regenera con `pnpm run diccionario`, que lee el esquema real de Postgres.
> Las descripciones se escriben en la propia base con `comment on table` y
> `comment on column`, para que viajen pegadas al dato.
> Lo que el esquema no puede contar está en [diccionario-trampas.md](diccionario-trampas.md).

Base `postgres`, esquema `public`. Generado el 7/10/2026, 3:50:10 p. m..

| | Cuántos |
|---|---|
| Tablas | 301 |
| Vistas | 47 |
| Columnas | 4.819 |
| Objetos con descripción | 62 de 348 |

## Lo que hay que mirar antes de escribir una consulta

### Columnas generadas: la base las calcula y NO se pueden escribir

Un `update` sobre una de estas falla con `column ... can only be updated to DEFAULT`.

| Tabla | Columna | Se calcula como |
|---|---|---|
| `crm_cuentas_cobrar` | `saldo` | `(valor_original - valor_abonado)` |
| `crm_saldos_favor` | `saldo` | `(valor - valor_aplicado)` |
| `pausas` | `tiempo_minutos` | `round((EXTRACT(epoch FROM (fin - inicio)) / (60)::numeric), 2)` |
| `pausas` | `activo` | `((inicio IS NOT NULL) AND (fin IS NULL))` |
| `pedidosdetalle` | `unidadespendientes` | `(unidades - COALESCE(unidadescargadas, (0)::numeric))` |
| `sst_ipevr` | `np` | `(nd * ne)` |
| `sst_ipevr` | `nr` | `((nd * ne) * nc)` |
| `sst_medevac` | `documento_norm` | `NULLIF(upper(regexp_replace(COALESCE(documento, ''::text), '[^0-9A-Za-z]'::text, ''::text, 'g'::text)), ''::text)` |
| `sst_perfil_sociodemografico` | `documento_norm` | `NULLIF(upper(regexp_replace(COALESCE(documento, ''::text), '[^0-9A-Za-z]'::text, ''::text, 'g'::text)), ''::text)` |

### Columnas de texto que guardan números

`sum()` sobre texto no existe: hay que castear con `::numeric`. Antes de castear, comprobar que todas las filas tengan texto numérico limpio.

| Tabla | Columna | Tipo |
|---|---|---|
| `acceso_perfil_materializado` | `valor` | text |
| `autorizacion_config` | `valor` | text |
| `crm_parametros` | `valor` | text |
| `crm_reglas_comision` | `ambito_valor` | text |
| `facturacion` | `valor_a_facturar` | text |
| `facturacion_filtros` | `valor` | text |
| `historialaprobaciones` | `cantidad` | text |
| `historicolotes` | `cantidad` | text |
| `sig_conteo_parametro` | `valor` | text |
| `sig_objetivos` | `valor_actual` | text |

## Índice

### Tablas

- [`acceso_perfil_empresas`](#acceso-perfil-empresas)
- [`acceso_perfil_materializado`](#acceso-perfil-materializado) — Que filas de perfil_acceso_empresas / perfil_acceso_owners / permisos_usuarios puso un perfil de acceso en cada usuario. Permite retirar un perfil sin pisar lo marcado a mano. Ver scripts/247.
- [`acceso_perfil_owners`](#acceso-perfil-owners)
- [`acceso_perfil_permisos`](#acceso-perfil-permisos)
- [`acceso_perfil_usuarios`](#acceso-perfil-usuarios)
- [`acceso_perfiles`](#acceso-perfiles) — Perfiles de acceso: paquete con nombre de empresas + owners + permisos de modulo que se asigna a usuarios. Mismo patron que autorizacion_perfiles (203). Ver scripts/247.
- [`acuerdo_volumenes`](#acuerdo-volumenes) — CONFIDENCIAL gerencia: estructura acordada por proyecto (tarifa × volumen mensual mínimo + personal). Si el volumen real no se cumple, el faltante se factura.
- [`acumulados_siigo`](#acumulados-siigo)
- [`ajustes_historicos_siigo`](#ajustes-historicos-siigo)
- [`ajustes_proyeccion`](#ajustes-proyeccion)
- [`alerta_envios`](#alerta-envios) — Bitácora de avisos enviados (una fila por aviso); evita repetir el mismo aviso el mismo día.
- [`alerta_suscripciones`](#alerta-suscripciones) — Quién quiere aviso de qué indicador del BSC, en qué proyecto y a qué correo.
- [`almacenes`](#almacenes)
- [`antecedentes`](#antecedentes)
- [`apoyo_cargue_asignaciones`](#apoyo-cargue-asignaciones)
- [`apoyo_cargue_exclusiones`](#apoyo-cargue-exclusiones) — Quién sacó a un auxiliar del reparto de toneladas de una orden desde Compensación › Apoyo en cargue, y cuándo. Solo rastro: no lo lee ningún cálculo.
- [`app_errores`](#app-errores) — Errores de la app capturados automáticamente (navegador y servidor). Ver scripts/verificar_errores_app.mts.
- [`asignacionpersonal`](#asignacionpersonal)
- [`asistencia`](#asistencia)
- [`auditoria`](#auditoria)
- [`auditoria_hallazgos`](#auditoria-hallazgos) — Hallazgos de auditoria con su accion correctiva y verificacion de eficacia (ISO 9001 10.2). Ver scripts/244.
- [`auditoria_iso_requisitos`](#auditoria-iso-requisitos) — Catalogo de los requisitos auditables de ISO 9001:2015. Es la norma, igual para todas las auditorias: por eso vive aparte y no copiado en cada una. Ver scripts/244.
- [`auditoria_modulos`](#auditoria-modulos)
- [`auditoria_respuestas`](#auditoria-respuestas) — Respuesta a cada requisito dentro de una auditoria. "No aplica" no cuenta como incumplimiento. Ver scripts/244.
- [`auditorias`](#auditorias) — Cabecera de cada auditoria ISO 9001. Una fila por auditoria realizada. Ver scripts/244.
- [`ausentismosst`](#ausentismosst)
- [`autorizacion_claves`](#autorizacion-claves)
- [`autorizacion_config`](#autorizacion-config)
- [`autorizacion_correos`](#autorizacion-correos)
- [`autorizacion_log`](#autorizacion-log)
- [`autorizacion_perfil_procesos`](#autorizacion-perfil-procesos)
- [`autorizacion_perfiles`](#autorizacion-perfiles)
- [`autorizacion_procesos`](#autorizacion-procesos)
- [`autorizacion_recuperacion`](#autorizacion-recuperacion)
- [`autorizacion_usuario_perfiles`](#autorizacion-usuario-perfiles)
- [`autorizacion_usuario_procesos`](#autorizacion-usuario-procesos)
- [`bitacora`](#bitacora)
- [`bodegas`](#bodegas)
- [`bonos_nomina`](#bonos-nomina)
- [`cabeceraoc`](#cabeceraoc)
- [`capacitaciones`](#capacitaciones)
- [`capacitaciones_asistencia`](#capacitaciones-asistencia)
- [`capacitaciones_evaluacion_intentos`](#capacitaciones-evaluacion-intentos)
- [`capacitaciones_evaluacion_preguntas`](#capacitaciones-evaluacion-preguntas)
- [`capacitaciones_evaluacion_respuestas`](#capacitaciones-evaluacion-respuestas)
- [`capacitaciones_evaluaciones`](#capacitaciones-evaluaciones)
- [`cargos_fijos_generados`](#cargos-fijos-generados) — Cargo fijo YA GENERADO para un mes concreto, con su propio estado de facturación (facturasiigo manda, igual que Gestión de Facturas).
- [`cargos_fijos_proyecto`](#cargos-fijos-proyecto) — Conceptos de facturación fija mensual por proyecto (no ligados a órdenes ni turnos): $2M Manejo de Inventario (id1/id3), 600 ton fijas Avimol (id2).
- [`categorias`](#categorias)
- [`cierre_produccion_config`](#cierre-produccion-config) — Configuracion del envio automatico del cierre diario de produccion. Fila unica. La hora real del cron esta en vercel.json; esta columna es la verificacion. Ver scripts/197.
- [`cierre_produccion_destinatarios`](#cierre-produccion-destinatarios)
- [`cierre_produccion_enviados`](#cierre-produccion-enviados)
- [`citasvehiculos`](#citasvehiculos)
- [`clientes`](#clientes)
- [`colaboradores`](#colaboradores)
- [`colaboradores_th`](#colaboradores-th)
- [`condiciones_envio_anexo`](#condiciones-envio-anexo)
- [`condiciones_generacion_prefactura`](#condiciones-generacion-prefactura)
- [`condiciones_pago_owner`](#condiciones-pago-owner)
- [`condicionespago`](#condicionespago)
- [`contratos`](#contratos)
- [`crm_actividades`](#crm-actividades) — Bitacora de lo ocurrido. Es historico: no se edita ni se borra, se agrega.
- [`crm_agenda`](#crm-agenda) — Compromisos futuros. Alimenta el calendario, la alerta de la campana y el tablero de proximas visitas.
- [`crm_autorizaciones_log`](#crm-autorizaciones-log) — Historia de las autorizaciones, incluidos los intentos fallidos (clave errada). Solo se agrega.
- [`crm_bancos`](#crm-bancos)
- [`crm_catalogo_cliente`](#crm-catalogo-cliente) — Productos que se le pueden vender a cada cliente (PED-07). Sin filas para un cliente, manda el parametro catalogo.modo.
- [`crm_comisiones`](#crm-comisiones)
- [`crm_consecutivos`](#crm-consecutivos) — Contador por empresa, tipo de documento y anio. Se bloquea la fila al asignar para que dos usuarios simultaneos no reciban el mismo numero.
- [`crm_cotizacion_detalle`](#crm-cotizacion-detalle)
- [`crm_cotizaciones`](#crm-cotizaciones)
- [`crm_cuentas_cobrar`](#crm-cuentas-cobrar) — Cartera. Nace con el pedido autorizado a credito; el numero de factura de Siigo se agrega despues.
- [`crm_cuentas_destino`](#crm-cuentas-destino)
- [`crm_documentos`](#crm-documentos) — Documentos del CRM (comprobantes, RUT, camara de comercio...). El archivo vive en el bucket privado crm-privado; se ve solo con URL firmada.
- [`crm_etapas`](#crm-etapas) — Etapas del embudo. La probabilidad pondera el pronostico de ventas.
- [`crm_eventos`](#crm-eventos) — Historial unico del CRM: pedidos, recaudos, prospectos, cartera, seguridad. Solo insercion. Alimenta el historial de cada documento y la auditoria.
- [`crm_importacion_filas`](#crm-importacion-filas)
- [`crm_importaciones`](#crm-importaciones) — Cada carga de archivo: se simula, se revisa y solo entonces se aplica. Guarda autor, fecha y resultado.
- [`crm_impuestos`](#crm-impuestos) — Tarifas de impuesto que se asignan a cada producto. La marcada es_default se usa para los productos sin impuesto asignado.
- [`crm_integracion_log`](#crm-integracion-log) — Cada intento de envio con su request, response y error (INT-08). Es lo que se mira cuando SAP rechaza algo.
- [`crm_integracion_outbox`](#crm-integracion-outbox) — Bandeja de salida hacia sistemas externos (SAP, LIPgo, WhatsApp). Equivale al integration_outbox del requerimiento. Nada de negocio espera a que esto se envie.
- [`crm_lista_precio_detalle`](#crm-lista-precio-detalle)
- [`crm_listas_precios`](#crm-listas-precios) — Listas de precios por cliente. El precio final lo resuelve una unica funcion en el codigo (resolverPrecio), no cada modulo por su cuenta.
- [`crm_medios_pago`](#crm-medios-pago)
- [`crm_motivos`](#crm-motivos)
- [`crm_notificacion_destinatarios`](#crm-notificacion-destinatarios) — Quien recibe cada aviso por WhatsApp. El requerimiento nombra a Jefferson para pedido_aprobado; se registra aqui con su celular.
- [`crm_owners`](#crm-owners) — Owners comerciales (INDUPAN, Molinos). El owner del producto decide el flujo del pedido: a que centro de LIPgo se proyecta, con que empresafactura y si pasa por SAP.
- [`crm_pagos`](#crm-pagos)
- [`crm_parametros`](#crm-parametros) — Todo numero del que depende una regla de negocio del CRM. Si un valor aparece literal en el codigo y gobierna una regla, es un bug: va aqui.
- [`crm_pedido_detalle`](#crm-pedido-detalle)
- [`crm_pedidos`](#crm-pedidos)
- [`crm_prospecto_interes`](#crm-prospecto-interes)
- [`crm_prospectos`](#crm-prospectos)
- [`crm_recaudo_aplicaciones`](#crm-recaudo-aplicaciones)
- [`crm_recaudos`](#crm-recaudos)
- [`crm_reglas_comision`](#crm-reglas-comision)
- [`crm_saldos_favor`](#crm-saldos-favor) — Lo que un cliente pago de mas (REC-17). Queda a su favor, visible en su cuenta, hasta que se aplique a una factura nueva.
- [`crm_sap_mapeo`](#crm-sap-mapeo) — Equivalencia id del CRM/LIPgo ↔ codigo de SAP. Solo la usa el traductor al enviar; nunca es llave del CRM (INT-06).
- [`crm_sesiones`](#crm-sesiones)
- [`crm_tipos_documento`](#crm-tipos-documento) — Que documentos se piden en cada caso. Configurable: la lista de documentos obligatorios de un prospecto (PRO-01) se ajusta aqui, no en el codigo.
- [`crm_usuarios`](#crm-usuarios) — Usuarios del CRM. Independientes de LIPgo (no usan auth.users ni profiles). Ver scripts/209.
- [`crm_vendedores_detalle`](#crm-vendedores-detalle) — Datos comerciales del vendedor. Tabla aparte de `vendedores` para no modificar una tabla que LIPgo ya usa.
- [`demanda_puesto`](#demanda-puesto)
- [`destinos`](#destinos)
- [`detalleoc`](#detalleoc)
- [`distribucion_placas`](#distribucion-placas)
- [`dotacion_epp`](#dotacion-epp)
- [`empresas`](#empresas)
- [`empresas_permisos`](#empresas-permisos) — This is a duplicate of empresas
- [`entrevistas`](#entrevistas)
- [`equipos_integrantes`](#equipos-integrantes)
- [`equipos_trabajo`](#equipos-trabajo)
- [`estado_linea`](#estado-linea)
- [`evaluaciones_desempeno`](#evaluaciones-desempeno)
- [`examenes_medicos`](#examenes-medicos)
- [`facturar_registro`](#facturar-registro)
- [`festivos`](#festivos)
- [`gastos`](#gastos)
- [`grupos`](#grupos)
- [`headcount`](#headcount)
- [`historial_intervalos`](#historial-intervalos)
- [`historial_nomina`](#historial-nomina)
- [`historialaprobaciones`](#historialaprobaciones)
- [`historicolotes`](#historicolotes)
- [`hojas_de_vida`](#hojas-de-vida)
- [`horario_tolva`](#horario-tolva) — Ventana horaria de Turno 1/Turno 2 para Tolva, por día+empresa. Independiente del horario de entrada/salida normal de cada persona.
- [`indicador_historico`](#indicador-historico)
- [`indicativo`](#indicativo) — This is a duplicate of empresas
- [`inspeccion_sanitaria_vehiculos`](#inspeccion-sanitaria-vehiculos)
- [`inspecciones_montacargas`](#inspecciones-montacargas)
- [`inv_ajustes_pendientes`](#inv-ajustes-pendientes)
- [`inv_clave_aprobacion_ajustes`](#inv-clave-aprobacion-ajustes)
- [`inv_clave_gerencia_proyecto`](#inv-clave-gerencia-proyecto)
- [`inv_clave_movimiento`](#inv-clave-movimiento)
- [`inv_correcciones_log`](#inv-correcciones-log)
- [`invtrans`](#invtrans)
- [`iso_clausulas`](#iso-clausulas)
- [`jornada_legal`](#jornada-legal)
- [`liquidaciones_retiro`](#liquidaciones-retiro)
- [`liquidaciones_retiro_deducciones`](#liquidaciones-retiro-deducciones)
- [`locations`](#locations)
- [`materiales`](#materiales)
- [`medio`](#medio)
- [`messages`](#messages)
- [`meta_toneladas_proyecto`](#meta-toneladas-proyecto)
- [`montacargas_alquiler`](#montacargas-alquiler) — Costo y facturación mensual de alquiler de montacargas, por equipo y vigencia. Se ajusta anual por IPC.
- [`montacargas_documentos`](#montacargas-documentos) — Documentos con vigencia de un equipo (certificado de operación, póliza, factura). Producción · Gestión de Montacargas.
- [`montacargasdia`](#montacargasdia)
- [`mptrans`](#mptrans) — This is a duplicate of invtrans
- [`mrpexplosion`](#mrpexplosion)
- [`muelles_empresa`](#muelles-empresa)
- [`notificaciones_conductor_config`](#notificaciones-conductor-config) — Configuración de los avisos automáticos al conductor. Ver scripts/182_notificacion_conductor.sql
- [`notificaciones_conductor_enviadas`](#notificaciones-conductor-enviadas)
- [`notificaciones_enviadas`](#notificaciones-enviadas)
- [`ordenes_correcciones`](#ordenes-correcciones)
- [`owners`](#owners) — Owner
- [`parafiscales_estatico`](#parafiscales-estatico)
- [`parafiscales_real`](#parafiscales-real)
- [`parametros_legales_anio`](#parametros-legales-anio)
- [`parametros_legales_vigencia`](#parametros-legales-vigencia)
- [`parametros_parafiscales`](#parametros-parafiscales)
- [`parametros_prestaciones`](#parametros-prestaciones)
- [`paros_produccion`](#paros-produccion)
- [`patrones_rotacion`](#patrones-rotacion)
- [`pausas`](#pausas)
- [`pedidodetalle_ocargue`](#pedidodetalle-ocargue) — Libro auxiliar: cuántas unidades tomó cada orden de cargue de cada línea de pedido. Permite que un pedido salga en varias órdenes sin perder lo ya despachado, revertir una sola orden y mostrar al cliente qué orden despachó cada parte. No es inventario: el inventario es invtrans.
- [`pedidoscabecera`](#pedidoscabecera)
- [`pedidosdetalle`](#pedidosdetalle)
- [`perfil_acceso_empresas`](#perfil-acceso-empresas)
- [`perfil_acceso_owners`](#perfil-acceso-owners)
- [`permisos_mapa_procesos`](#permisos-mapa-procesos) — Procesos del Mapa de Procesos que cada usuario puede abrir. La ausencia de fila es la negación: sin fila, el botón se ve pero no abre. Ver scripts/189.
- [`permisos_usuarios`](#permisos-usuarios)
- [`politica_horas_extra`](#politica-horas-extra) — Reglas de generación de horas extra por puesto y día. Reemplaza los literales que estaban quemados en calcular_y_asignar_horas_extras().
- [`prefactura_ciclo_eventos`](#prefactura-ciclo-eventos)
- [`prefactura_pagos`](#prefactura-pagos)
- [`prefacturas`](#prefacturas)
- [`prestaciones_activos_pagos`](#prestaciones-activos-pagos)
- [`procesos_disciplinarios`](#procesos-disciplinarios) — Solicitudes de medida disciplinaria y su trámite. La usuaria reporta y solicita; el empleador (la temporal) cita a descargos y decide. Ver scripts/add_procesos_disciplinarios.sql
- [`procesos_disciplinarios_bitacora`](#procesos-disciplinarios-bitacora)
- [`produccion`](#produccion)
- [`productos`](#productos)
- [`profiles`](#profiles)
- [`programacion_cliente`](#programacion-cliente) — Programación de vehículos que el cliente entrega para el día siguiente. Una fila por versión enviada; vigente = la última.
- [`proveedores`](#proveedores)
- [`qrestibacabecera`](#qrestibacabecera)
- [`qrestibadetalle`](#qrestibadetalle)
- [`reasignacion_puesto_log`](#reasignacion-puesto-log) — Cambios de puesto del día hechos desde Tabla Asistencia. Cada fila exige un motivo escrito: el puesto decide quién puede asignarse en Picking/Packing y cómo liquida pagonomina ese día.
- [`recargo_dominical_legal`](#recargo-dominical-legal)
- [`registro_conexiones`](#registro-conexiones)
- [`registroasistencia`](#registroasistencia)
- [`registrosanitario`](#registrosanitario)
- [`reporte_interno_config`](#reporte-interno-config) — Los cinco avisos internos de operación. Cada uno se enciende por separado: con ~35 cargues al dia, los cinco son ~175 mensajes diarios por destinatario. Ver scripts/196.
- [`reporte_interno_destinatarios`](#reporte-interno-destinatarios)
- [`reporte_interno_enviados`](#reporte-interno-enviados)
- [`reprocesos`](#reprocesos)
- [`respaldo_20261005_pares_cuadre13`](#respaldo-20261005-pares-cuadre13)
- [`respaldo_extras_17ago2026`](#respaldo-extras-17ago2026)
- [`respaldo_horas_extra_sabado_dt_ago2026`](#respaldo-horas-extra-sabado-dt-ago2026)
- [`respaldo_recalculo_extras`](#respaldo-recalculo-extras) — Foto de las horas extra ANTES de cada recálculo retroactivo. Permite revertir un lote completo.
- [`rrhh_config`](#rrhh-config)
- [`sig_aspectos_ambientales`](#sig-aspectos-ambientales)
- [`sig_conteo_novedad_regla`](#sig-conteo-novedad-regla)
- [`sig_conteo_parametro`](#sig-conteo-parametro)
- [`sig_contexto_dofa`](#sig-contexto-dofa)
- [`sig_documento_cobertura`](#sig-documento-cobertura)
- [`sig_documento_versiones`](#sig-documento-versiones)
- [`sig_documentos`](#sig-documentos)
- [`sig_indicadores`](#sig-indicadores)
- [`sig_indicadores_cache`](#sig-indicadores-cache)
- [`sig_inventario_acta_cruce`](#sig-inventario-acta-cruce)
- [`sig_inventario_acta_cruce_detalle`](#sig-inventario-acta-cruce-detalle)
- [`sig_inventario_ajuste`](#sig-inventario-ajuste)
- [`sig_inventario_cierre_mes`](#sig-inventario-cierre-mes)
- [`sig_inventario_cuadre`](#sig-inventario-cuadre)
- [`sig_inventario_cuadre_detalle`](#sig-inventario-cuadre-detalle)
- [`sig_metas_colaborador`](#sig-metas-colaborador)
- [`sig_nc_catalogo`](#sig-nc-catalogo)
- [`sig_no_conformidades`](#sig-no-conformidades)
- [`sig_normas`](#sig-normas)
- [`sig_objetivos`](#sig-objetivos)
- [`sig_pqrsf`](#sig-pqrsf)
- [`sig_proceso_interaccion`](#sig-proceso-interaccion)
- [`sig_procesos`](#sig-procesos)
- [`sig_requisito_modulo`](#sig-requisito-modulo) — Numerales de la Matriz Integrada que se sustentan con un módulo de LIPgo en vez de un archivo. Ver scripts/sig/59.
- [`sig_requisito_norma`](#sig-requisito-norma)
- [`sig_requisitos`](#sig-requisitos)
- [`sig_requisitos_legales`](#sig-requisitos-legales)
- [`sig_satisfaccion`](#sig-satisfaccion)
- [`sig_tipos_movimiento`](#sig-tipos-movimiento)
- [`siigo_clientes`](#siigo-clientes) — Copia local de los clientes/terceros de Siigo. Ver scripts/229.
- [`siigo_emision_config`](#siigo-emision-config)
- [`siigo_facturas`](#siigo-facturas) — Copia local de las facturas de Siigo. La llave es el id de Siigo: reimportar actualiza, no duplica. Ver scripts/206.
- [`siigo_facturas_emitidas`](#siigo-facturas-emitidas) — Bitacora de las facturas creadas en Siigo desde LIPgo. Guarda la peticion y la respuesta completas: una factura electronica no se borra, y si sale mal esta es la unica forma de reconstruir que paso. Ver scripts/230.
- [`siigo_formas_pago`](#siigo-formas-pago)
- [`siigo_impuestos`](#siigo-impuestos)
- [`siigo_maestros_estado`](#siigo-maestros-estado)
- [`siigo_owner_cliente`](#siigo-owner-cliente) — Puente entre los owners de LIPgo y los terceros de Siigo. Evita elegir el cliente a mano en cada factura, que es donde se cometeria el error mas caro.
- [`siigo_productos`](#siigo-productos) — Copia local de los productos de Siigo. La llave es el id de Siigo: reimportar actualiza, no duplica. Ver scripts/229.
- [`siigo_sync_estado`](#siigo-sync-estado)
- [`solicitudes_trabajadores`](#solicitudes-trabajadores)
- [`solicitudesturnos`](#solicitudesturnos)
- [`soportes_documentales`](#soportes-documentales)
- [`sst_actividades`](#sst-actividades)
- [`sst_autoeval_respuestas`](#sst-autoeval-respuestas)
- [`sst_autoevaluaciones`](#sst-autoevaluaciones)
- [`sst_autorreportes`](#sst-autorreportes)
- [`sst_capacitacion_asistencia`](#sst-capacitacion-asistencia)
- [`sst_capacitaciones`](#sst-capacitaciones)
- [`sst_comite_actas`](#sst-comite-actas)
- [`sst_comite_miembros`](#sst-comite-miembros)
- [`sst_comites`](#sst-comites)
- [`sst_comunicaciones`](#sst-comunicaciones)
- [`sst_entrega_epp`](#sst-entrega-epp)
- [`sst_equipos`](#sst-equipos)
- [`sst_estandar_evidencia`](#sst-estandar-evidencia)
- [`sst_estandar_items`](#sst-estandar-items)
- [`sst_gestion_cambio`](#sst-gestion-cambio)
- [`sst_incidente_acciones`](#sst-incidente-acciones)
- [`sst_incidente_testigos`](#sst-incidente-testigos)
- [`sst_incidentes`](#sst-incidentes)
- [`sst_indicadores`](#sst-indicadores)
- [`sst_indicadores_definicion`](#sst-indicadores-definicion)
- [`sst_inspecciones`](#sst-inspecciones)
- [`sst_ipevr`](#sst-ipevr)
- [`sst_mantenimientos`](#sst-mantenimientos)
- [`sst_matriz_legal`](#sst-matriz-legal)
- [`sst_medevac`](#sst-medevac)
- [`sst_medevac_backup_44`](#sst-medevac-backup-44)
- [`sst_medevac_duplicados_44`](#sst-medevac-duplicados-44)
- [`sst_peligros`](#sst-peligros)
- [`sst_perfil_sd_backup_44`](#sst-perfil-sd-backup-44)
- [`sst_perfil_sd_backup_45`](#sst-perfil-sd-backup-45)
- [`sst_perfil_sd_backup_46`](#sst-perfil-sd-backup-46)
- [`sst_perfil_sd_duplicados_44`](#sst-perfil-sd-duplicados-44)
- [`sst_perfil_sd_eliminados_45`](#sst-perfil-sd-eliminados-45)
- [`sst_perfil_sd_eliminados_46`](#sst-perfil-sd-eliminados-46)
- [`sst_perfil_sociodemografico`](#sst-perfil-sociodemografico)
- [`sst_plan_anual`](#sst-plan-anual)
- [`sst_plan_anual_actividades`](#sst-plan-anual-actividades)
- [`sst_plan_mejora`](#sst-plan-mejora)
- [`sst_pqrsf`](#sst-pqrsf)
- [`sst_simulacros`](#sst-simulacros)
- [`subcategorias`](#subcategorias)
- [`sucursales`](#sucursales)
- [`tarifas`](#tarifas)
- [`tarifasfacturacionturnos`](#tarifasfacturacionturnos)
- [`tarifasoperacion`](#tarifasoperacion)
- [`tarifaspersonal`](#tarifaspersonal)
- [`tarifasturnos`](#tarifasturnos)
- [`tipodespacho`](#tipodespacho)
- [`tiposvehiculos`](#tiposvehiculos)
- [`transportes`](#transportes)
- [`traslados`](#traslados)
- [`turnos_definicion`](#turnos-definicion) — Turnos con nombre por empresa (T1 mañana, T2 tarde...). NO se usa para liquidar: las horas siguen saliendo de registroasistencia. Ver scripts/add_programacion_turnos_quincena.sql
- [`usuariocartera`](#usuariocartera)
- [`vacaciones_liquidaciones`](#vacaciones-liquidaciones)
- [`vacaciones_solicitudes`](#vacaciones-solicitudes)
- [`vacantes`](#vacantes)
- [`vacantes_candidatos`](#vacantes-candidatos)
- [`vendedores`](#vendedores)
- [`whatsapp_mensajes`](#whatsapp-mensajes)
- [`whatsapp_plantillas`](#whatsapp-plantillas)

### Vistas

- [`archivoplano`](#archivoplano)
- [`auditoria_modulos_usados`](#auditoria-modulos-usados)
- [`crm_cartera_aging`](#crm-cartera-aging) — Cartera pendiente clasificada por antiguedad. Los tramos salen de crm_parametros: cambiarlos alli reclasifica todo sin desplegar.
- [`crm_inventario_producto`](#crm-inventario-producto) — Inventario de LIPgo (invglobal) agrupado por producto, con desglose por sede de despacho. Solo lectura.
- [`dashboard`](#dashboard)
- [`dashboardoperaciones`](#dashboardoperaciones)
- [`dashboardoperacionesgerencia`](#dashboardoperacionesgerencia)
- [`despachotraslados`](#despachotraslados)
- [`facturacion`](#facturacion)
- [`facturacion_filtros`](#facturacion-filtros)
- [`facturacionturnos`](#facturacionturnos)
- [`invglobal`](#invglobal)
- [`metadia`](#metadia)
- [`operaciones_desglosadas`](#operaciones-desglosadas)
- [`pagonomina`](#pagonomina)
- [`saldoinvdetalle`](#saldoinvdetalle)
- [`solicitud_horas_extras`](#solicitud-horas-extras)
- [`toneladasauxiliares`](#toneladasauxiliares)
- [`toneladasauxiliarespago`](#toneladasauxiliarespago)
- [`toneladasdia`](#toneladasdia)
- [`v_orden_vs_salidas`](#v-orden-vs-salidas) — Conciliación del DESPACHO: lo que la orden de cargue autorizó (detalleoc, solo tipooperacion Cargue) contra lo que salió del inventario (invtrans 601 aprobado). SALIO_MAS y FUERA_DE_LA_ORDEN son críticos: nunca puede salir más de lo que la orden dice. SALIO_MENOS es una diferencia a explicar (merma en el cargue). No reemplaza a v_pedidos_vs_salidas, que controla el pedido.
- [`v_pedidos_vs_salidas`](#v-pedidos-vs-salidas)
- [`v_soportes_resumen`](#v-soportes-resumen)
- [`v_soportes_vigentes`](#v-soportes-vigentes)
- [`v_sst_acciones_seguimiento`](#v-sst-acciones-seguimiento)
- [`v_sst_auditoria_estandar`](#v-sst-auditoria-estandar)
- [`v_sst_autoeval_por_ciclo`](#v-sst-autoeval-por-ciclo)
- [`v_sst_capacitacion_mensual`](#v-sst-capacitacion-mensual)
- [`v_sst_cumplimiento_plan_anual`](#v-sst-cumplimiento-plan-anual)
- [`v_sst_epp_por_trabajador`](#v-sst-epp-por-trabajador)
- [`v_sst_incidentes_mensual`](#v-sst-incidentes-mensual)
- [`v_sst_indicadores_tablero`](#v-sst-indicadores-tablero)
- [`v_sst_investigacion_plazo`](#v-sst-investigacion-plazo)
- [`v_sst_ipevr_resumen`](#v-sst-ipevr-resumen)
- [`v_sst_items_no_cumple`](#v-sst-items-no-cumple)
- [`v_sst_mantenimiento_cumplimiento`](#v-sst-mantenimiento-cumplimiento)
- [`v_sst_matriz_legal_cumplimiento`](#v-sst-matriz-legal-cumplimiento)
- [`v_sst_montacargas_estado`](#v-sst-montacargas-estado)
- [`v_sst_peligros_criticos`](#v-sst-peligros-criticos)
- [`v_sst_plan_mejora_estado`](#v-sst-plan-mejora-estado)
- [`view_inventario_por_estiba`](#view-inventario-por-estiba)
- [`vw_alertas_aprobacion`](#vw-alertas-aprobacion)
- [`vw_insight_cliente_producto`](#vw-insight-cliente-producto)
- [`vw_kpi_diarios`](#vw-kpi-diarios)
- [`vw_produccion_agrupada_10m`](#vw-produccion-agrupada-10m)
- [`vw_produccion_dashboard`](#vw-produccion-dashboard)
- [`vw_sst_datos_colaborador`](#vw-sst-datos-colaborador)

## Detalle

### acceso_perfil_empresas

Tabla · — filas aprox. · 2 columnas

_Sin descripción. Se escribe en la base con `comment on table public.acceso_perfil_empresas is '...'`._

**Llave primaria:** `perfil_id`, `empresa_id`

**Se liga a:** `perfil_id` → `acceso_perfiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `perfil_id` 🔑 | integer | obligatoria |  |  |
| `empresa_id` 🔑 | integer | obligatoria |  |  |

### acceso_perfil_materializado

Tabla · — filas aprox. · 3 columnas

Que filas de perfil_acceso_empresas / perfil_acceso_owners / permisos_usuarios puso un perfil de acceso en cada usuario. Permite retirar un perfil sin pisar lo marcado a mano. Ver scripts/247.

**Llave primaria:** `profile_id`, `tipo`, `valor`

**Se liga a:** `profile_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `profile_id` 🔑 | uuid | obligatoria |  |  |
| `tipo` 🔑 | text | obligatoria |  |  |
| `valor` 🔑 | text | obligatoria |  |  |

### acceso_perfil_owners

Tabla · — filas aprox. · 2 columnas

_Sin descripción. Se escribe en la base con `comment on table public.acceso_perfil_owners is '...'`._

**Llave primaria:** `perfil_id`, `owner`

**Se liga a:** `perfil_id` → `acceso_perfiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `perfil_id` 🔑 | integer | obligatoria |  |  |
| `owner` 🔑 | text | obligatoria |  |  |

### acceso_perfil_permisos

Tabla · — filas aprox. · 2 columnas

_Sin descripción. Se escribe en la base con `comment on table public.acceso_perfil_permisos is '...'`._

**Llave primaria:** `perfil_id`, `permiso`

**Se liga a:** `perfil_id` → `acceso_perfiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `perfil_id` 🔑 | integer | obligatoria |  |  |
| `permiso` 🔑 | text | obligatoria |  |  |

### acceso_perfil_usuarios

Tabla · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.acceso_perfil_usuarios is '...'`._

**Llave primaria:** `perfil_id`, `profile_id`

**Se liga a:** `perfil_id` → `acceso_perfiles`(id) · `profile_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `perfil_id` 🔑 | integer | obligatoria |  |  |
| `profile_id` 🔑 | uuid | obligatoria |  |  |
| `asignado_por` | text |  |  |  |
| `asignado_en` | timestamp with time zone | obligatoria | `now()` |  |

### acceso_perfiles

Tabla · — filas aprox. · 7 columnas

Perfiles de acceso: paquete con nombre de empresas + owners + permisos de modulo que se asigna a usuarios. Mismo patron que autorizacion_perfiles (203). Ver scripts/247.

**Llave primaria:** `id`

**Unicidad:** `nombre`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('acceso_perfiles_id_seq'::regclass)` |  |
| `nombre` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_por` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |
| `updated_at` | timestamp with time zone | obligatoria | `now()` |  |

### acuerdo_volumenes

Tabla · 49 filas aprox. · 11 columnas

CONFIDENCIAL gerencia: estructura acordada por proyecto (tarifa × volumen mensual mínimo + personal). Si el volumen real no se cumple, el faltante se factura.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `actividad` | text | obligatoria |  |  |
| `actividad_codigo` | text |  |  |  |
| `auxiliares` | numeric |  |  |  |
| `muelle` | text |  |  |  |
| `tarifa` | numeric |  |  |  |
| `volumen_acordado` | numeric |  |  |  |
| `fechainicio` | date | obligatoria |  |  |
| `fechafin` | date | obligatoria |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### acumulados_siigo

Tabla · 7.168 filas aprox. · 17 columnas

_Sin descripción. Se escribe en la base con `comment on table public.acumulados_siigo is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `identificacion` | text | obligatoria |  |  |
| `nombre_empleado` | text | obligatoria |  |  |
| `no_contrato` | text |  |  |  |
| `periodo` | text |  |  |  |
| `mes` | integer |  |  |  |
| `anio` | integer |  |  |  |
| `centro_costo` | text |  |  |  |
| `origen` | text |  |  |  |
| `novedad` | text |  |  |  |
| `tipo` | text |  |  |  |
| `horas_dias` | text |  |  |  |
| `valor_total` | numeric | obligatoria | `0` |  |
| `archivo_origen` | text | obligatoria |  |  |
| `rango_desde` | date |  |  |  |
| `rango_hasta` | date |  |  |  |
| `cargado_en` | timestamp with time zone | obligatoria | `now()` |  |

### ajustes_historicos_siigo

Tabla · 403 filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.ajustes_historicos_siigo is '...'`._

**Llave primaria:** `id`

**Unicidad:** `identificacion` + `anio` + `mes` + `quincena` + `concepto`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `identificacion` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `idempresa` | integer |  |  |  |
| `anio` | integer | obligatoria |  |  |
| `mes` | integer | obligatoria |  |  |
| `quincena` | integer | obligatoria |  |  |
| `concepto` | text | obligatoria | `'bono_destajo'::text` |  |
| `valor_lipgo_calculado` | numeric | obligatoria | `0` |  |
| `valor_siigo_real` | numeric | obligatoria | `0` |  |
| `valor_ajuste` | numeric | obligatoria | `0` |  |
| `fuente` | text |  |  |  |
| `observacion` | text |  |  |  |
| `creado_por` | text |  |  |  |
| `creado` | timestamp with time zone | obligatoria | `now()` |  |

### ajustes_proyeccion

Tabla · 111 filas aprox. · 26 columnas

_Sin descripción. Se escribe en la base con `comment on table public.ajustes_proyeccion is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `fecha_proyectada` + `persona`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('ajustes_proyeccion_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `fecha_proyectada` | date | obligatoria |  |  |
| `anio` | integer | obligatoria |  |  |
| `mes` | integer | obligatoria |  |  |
| `quincena` | smallint | obligatoria |  |  |
| `persona` | text | obligatoria |  |  |
| `identificacion` | text |  |  |  |
| `ton_pagada` | numeric | obligatoria | `0` |  |
| `ton_real` | numeric | obligatoria | `0` |  |
| `diferencia_ton` | numeric | obligatoria | `0` |  |
| `valor_pagado` | numeric | obligatoria | `0` |  |
| `valor_real` | numeric | obligatoria | `0` |  |
| `valor_ajuste` | numeric | obligatoria | `0` |  |
| `novedad_siigo` | text | obligatoria |  |  |
| `anio_aplica` | integer | obligatoria |  |  |
| `mes_aplica` | integer | obligatoria |  |  |
| `quincena_aplica` | smallint | obligatoria |  |  |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `creado_por` | text |  |  |  |
| `creado` | timestamp with time zone | obligatoria | `now()` |  |
| `aprobado_por` | text |  |  |  |
| `aprobado_en` | timestamp with time zone |  |  |  |
| `observacion` | text |  |  |  |
| `ton_proyectada` | numeric | obligatoria | `0` |  |
| `hora_corte` | text |  |  |  |

### alerta_envios

Tabla · — filas aprox. · 14 columnas

Bitácora de avisos enviados (una fila por aviso); evita repetir el mismo aviso el mismo día.

**Llave primaria:** `id`

**Se liga a:** `suscripcion_id` → `alerta_suscripciones`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('alerta_envios_id_seq'::regclass)` |  |
| `suscripcion_id` | bigint |  |  |  |
| `usuario_id` | uuid |  |  |  |
| `correo` | text |  |  |  |
| `indicador` | text | obligatoria |  |  |
| `empresa_id` | integer |  |  |  |
| `severidad` | text | obligatoria |  |  |
| `valor` | numeric |  |  |  |
| `meta` | numeric |  |  |  |
| `periodo` | text |  |  |  |
| `canal` | text | obligatoria | `'correo'::text` |  |
| `estado` | text | obligatoria |  |  |
| `detalle` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### alerta_suscripciones

Tabla · — filas aprox. · 11 columnas

Quién quiere aviso de qué indicador del BSC, en qué proyecto y a qué correo.

**Llave primaria:** `id`

**Unicidad:** `usuario_id` + `indicador`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('alerta_suscripciones_id_seq'::regclass)` |  |
| `usuario_id` | uuid | obligatoria |  |  |
| `usuario` | text |  |  |  |
| `correo` | text | obligatoria |  |  |
| `indicador` | text | obligatoria |  |  |
| `empresa_id` | integer |  |  |  |
| `umbral` | text | obligatoria | `'atencion'::text` |  |
| `canal` | text | obligatoria | `'correo'::text` |  |
| `activo` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### almacenes

Tabla · 14 filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.almacenes is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `descripcion` | text |  |  |  |
| `activo` | text |  |  |  |

### antecedentes

Tabla · 71 filas aprox. · 21 columnas

_Sin descripción. Se escribe en la base con `comment on table public.antecedentes is '...'`._

**Llave primaria:** `id`

**Se liga a:** `hoja_vida_id` → `hojas_de_vida`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `hoja_vida_id` | uuid |  |  |  |
| `cedula` | text |  |  |  |
| `nombre` | text | obligatoria |  |  |
| `policia_url` | text |  |  |  |
| `policia_nombre` | text |  |  |  |
| `procuraduria_url` | text |  |  |  |
| `procuraduria_nombre` | text |  |  |  |
| `contraloria_url` | text |  |  |  |
| `contraloria_nombre` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |
| `estado` | text |  | `'pendiente'::text` |  |
| `compliance_pdf_url` | text |  |  |  |
| `compliance_pdf_nombre` | text |  |  |  |
| `id_dato_consultado` | bigint |  |  |  |
| `score_riesgo` | integer |  |  |  |
| `presenta_riesgo` | boolean |  |  |  |
| `pep` | boolean |  |  |  |
| `decidido_por` | text |  |  |  |
| `decidido_en` | timestamp with time zone |  |  |  |

### apoyo_cargue_asignaciones

Tabla · 112 filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.apoyo_cargue_asignaciones is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idorden` → `cabeceraoc`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('apoyo_cargue_asignaciones_id_seq'::regclass)` |  |
| `idorden` | bigint | obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `fecha` | date | obligatoria |  |  |
| `persona` | text | obligatoria |  |  |
| `asignado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### apoyo_cargue_exclusiones

Tabla · — filas aprox. · 8 columnas

Quién sacó a un auxiliar del reparto de toneladas de una orden desde Compensación › Apoyo en cargue, y cuándo. Solo rastro: no lo lee ningún cálculo.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('apoyo_cargue_exclusiones_id_seq'::regclass)` |  |
| `idorden` | integer | obligatoria |  |  |
| `idempresa` | integer |  |  |  |
| `fecha` | date |  |  |  |
| `persona` | text | obligatoria |  |  |
| `origen` | text |  |  |  |
| `quitado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone |  | `now()` |  |

### app_errores

Tabla · 47 filas aprox. · 18 columnas

Errores de la app capturados automáticamente (navegador y servidor). Ver scripts/verificar_errores_app.mts.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('app_errores_id_seq'::regclass)` |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |
| `origen` | text | obligatoria | `'cliente'::text` |  |
| `mensaje` | text | obligatoria |  |  |
| `stack` | text |  |  |  |
| `componente` | text |  |  |  |
| `modulo` | text |  |  |  |
| `url` | text |  |  |  |
| `navegador` | text |  |  |  |
| `usuario_id` | uuid |  |  |  |
| `usuario` | text |  |  |  |
| `empresa_id` | integer |  |  |  |
| `version` | text |  |  |  |
| `entorno` | text |  |  |  |
| `extra` | jsonb |  |  |  |
| `resuelto` | boolean | obligatoria | `false` |  |
| `resuelto_por` | text |  |  |  |
| `resuelto_en` | timestamp with time zone |  |  |  |

### archivoplano

Vista · — filas aprox. · 14 columnas

_Sin descripción. Se escribe en la base con `comment on table public.archivoplano is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `mes` | text |  |  |  |
| `quincena` | integer |  |  |  |
| `idempresa` | integer |  |  |  |
| `identificacionempleado` | text |  |  |  |
| `nombreempleado` | text |  |  |  |
| `contratoempleado` | text |  |  |  |
| `nombrenovedad` | text |  |  |  |
| `tiponovedad` | text |  |  |  |
| `cantidadvalor` | numeric |  |  |  |
| `nominaproyectada` | integer |  |  |  |
| `fechainicio` | text |  |  |  |
| `fechafin` | text |  |  |  |
| `diasnohabiles` | integer |  |  |  |
| `anio` | integer |  |  |  |

### asignacionpersonal

Tabla · 3.759 filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.asignacionpersonal is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fecha` | date | obligatoria |  |  |
| `idempleado` | text |  |  |  |
| `nombreempleado` | text |  |  |  |
| `asignacion` | text |  |  |  |
| `idempresa` | smallint |  |  |  |

### asistencia

Tabla · 10.947 filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.asistencia is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fecha` | date | obligatoria |  |  |
| `idempresa` | smallint |  |  |  |
| `hora` | time without time zone |  |  |  |
| `identificacion` | text |  |  |  |
| `foto_ingreso` | text |  |  | URL pública de la foto tomada al marcar el ingreso. Vive aquí —y no solo en registroasistencia— porque esta tabla siempre tiene fila cuando alguien marca, mientras que la de registroasistencia puede no existir todavía. |

### auditoria

Tabla · 465.671 filas aprox. · 13 columnas

_Sin descripción. Se escribe en la base con `comment on table public.auditoria is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `ts` | timestamp with time zone | obligatoria | `now()` |  |
| `actor_id` | uuid |  |  |  |
| `actor_nombre` | text | obligatoria | `'sistema'::text` |  |
| `idempresa` | integer |  |  |  |
| `modulo` | text |  |  |  |
| `tabla` | text | obligatoria |  |  |
| `operacion` | text | obligatoria |  |  |
| `registro_id` | text |  |  |  |
| `descripcion` | text |  |  |  |
| `antes` | jsonb |  |  |  |
| `despues` | jsonb |  |  |  |
| `campos_cambiados` | text[] |  |  |  |

### auditoria_hallazgos

Tabla · — filas aprox. · 21 columnas

Hallazgos de auditoria con su accion correctiva y verificacion de eficacia (ISO 9001 10.2). Ver scripts/244.

**Llave primaria:** `id`

**Se liga a:** `auditoria_id` → `auditorias`(id) · `requisito_codigo` → `auditoria_iso_requisitos`(codigo)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('auditoria_hallazgos_id_seq'::regclass)` |  |
| `auditoria_id` | bigint | obligatoria |  |  |
| `requisito_codigo` | text |  |  |  |
| `consecutivo` | text |  |  |  |
| `tipo` | text | obligatoria | `'No conformidad'::text` |  |
| `proceso` | text |  |  |  |
| `criterio` | text |  |  |  |
| `evidencia` | text |  |  |  |
| `descripcion` | text | obligatoria |  |  |
| `correccion_inmediata` | text |  |  |  |
| `analisis_causa` | text |  |  |  |
| `accion_correctiva` | text |  |  |  |
| `responsable` | text |  |  |  |
| `fecha_compromiso` | date |  |  |  |
| `verificacion_eficacia` | text |  |  |  |
| `estado` | text | obligatoria | `'Abierto'::text` |  |
| `fecha_cierre` | date |  |  |  |
| `observaciones` | text |  |  |  |
| `creado_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### auditoria_iso_requisitos

Tabla · 28 filas aprox. · 6 columnas

Catalogo de los requisitos auditables de ISO 9001:2015. Es la norma, igual para todas las auditorias: por eso vive aparte y no copiado en cada una. Ver scripts/244.

**Llave primaria:** `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `codigo` 🔑 | text | obligatoria |  |  |
| `capitulo` | integer | obligatoria |  |  |
| `requisito` | text | obligatoria |  |  |
| `pregunta` | text | obligatoria |  |  |
| `orden` | integer |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |

### auditoria_modulos

Tabla · 36 filas aprox. · 2 columnas

_Sin descripción. Se escribe en la base con `comment on table public.auditoria_modulos is '...'`._

**Llave primaria:** `tabla`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `tabla` 🔑 | text | obligatoria |  |  |
| `modulo` | text | obligatoria |  |  |

### auditoria_modulos_usados

Vista · — filas aprox. · 1 columnas

_Sin descripción. Se escribe en la base con `comment on table public.auditoria_modulos_usados is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `modulo` | text |  |  |  |

### auditoria_respuestas

Tabla · — filas aprox. · 10 columnas

Respuesta a cada requisito dentro de una auditoria. "No aplica" no cuenta como incumplimiento. Ver scripts/244.

**Llave primaria:** `id`

**Unicidad:** `auditoria_id` + `requisito_codigo`

**Se liga a:** `auditoria_id` → `auditorias`(id) · `requisito_codigo` → `auditoria_iso_requisitos`(codigo)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('auditoria_respuestas_id_seq'::regclass)` |  |
| `auditoria_id` | bigint | obligatoria |  |  |
| `requisito_codigo` | text | obligatoria |  |  |
| `resultado` | text | obligatoria | `'Pendiente'::text` |  |
| `evidencia` | text |  |  |  |
| `documento` | text |  |  |  |
| `comentario` | text |  |  |  |
| `auditor` | text |  |  |  |
| `fecha` | date |  |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### auditorias

Tabla · — filas aprox. · 21 columnas

Cabecera de cada auditoria ISO 9001. Una fila por auditoria realizada. Ver scripts/244.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('auditorias_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `codigo` | text |  |  |  |
| `fecha` | date | obligatoria | `CURRENT_DATE` |  |
| `organizacion` | text |  |  |  |
| `proceso` | text |  |  |  |
| `responsable_proceso` | text |  |  |  |
| `auditor_lider` | text |  |  |  |
| `equipo_auditor` | text |  |  |  |
| `tipo` | text | obligatoria | `'Interna'::text` |  |
| `objetivo` | text |  | `'Evaluar la conformidad y eficacia del proceso auditado frente a los criterios definidos para el SGC.'::text` |  |
| `alcance` | text |  |  |  |
| `criterios` | text |  | `'ISO 9001:2015 y documentación interna aplicable'::text` |  |
| `metodologia` | text |  | `'Entrevistas, revisión documental, revisión de registros, observación y muestreo'::text` |  |
| `periodo_auditado` | text |  |  |  |
| `estado` | text | obligatoria | `'borrador'::text` |  |
| `conclusiones` | text |  |  |  |
| `fecha_cierre` | date |  |  |  |
| `creado_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### ausentismosst

Tabla · 437 filas aprox. · 41 columnas

_Sin descripción. Se escribe en la base con `comment on table public.ausentismosst is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `cedula` + `fecha_inicial` (parcial)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer |  |  |  |
| `mes` | text |  |  |  |
| `nombre_colaborador` | text |  |  |  |
| `cedula` | text |  |  |  |
| `cargo` | text |  |  |  |
| `area` | text |  |  |  |
| `estado_colaborador` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `tipo_evento` | text |  | `'EG'::text` |  |
| `eps` | text |  |  |  |
| `fecha_inicial` | date |  |  |  |
| `fecha_final` | date |  |  |  |
| `dias_incapacidad` | integer |  | `0` |  |
| `prorroga` | integer |  | `0` |  |
| `total_dias_incapacidad` | integer |  | `0` |  |
| `dias_empresa` | integer |  | `0` |  |
| `dias_eps` | integer |  | `0` |  |
| `codigo_diagnostico` | text |  |  |  |
| `descripcion_diagnostico` | text |  |  |  |
| `parte_cuerpo` | text |  |  |  |
| `estadistica` | text |  |  |  |
| `salario_base` | numeric |  | `0` |  |
| `salario_base_dia` | numeric |  | `0` |  |
| `costos_empresa` | numeric |  | `0` |  |
| `costos_eps` | numeric |  | `0` |  |
| `total_salario_pagado` | numeric |  | `0` |  |
| `requiere_revision_sst` | boolean |  | `false` |  |
| `observaciones` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `costos_arl` | numeric |  | `0` |  |
| `estado_recobro` | text |  | `'PENDIENTE'::text` |  |
| `valor_recobrado` | numeric |  | `0` |  |
| `fecha_radicado_recobro` | date |  |  |  |
| `obs_recobro` | text |  |  |  |
| `soporte_radicado_url` | text |  |  |  |
| `soporte_pago_url` | text |  |  |  |
| `estado_registro` | text |  | `'COMPLETO'::text` |  |
| `origen` | text |  | `'MANUAL'::text` |  |
| `soporte_incapacidad_url` | text |  |  |  |
| `categoria` | text |  |  |  |

### autorizacion_claves

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_claves is '...'`._

**Llave primaria:** `usuario_id`

**Se liga a:** `usuario_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `usuario_id` 🔑 | uuid | obligatoria |  |  |
| `clave_hash` | text | obligatoria |  |  |
| `provisional` | boolean | obligatoria | `false` |  |
| `intentos_fallidos` | integer | obligatoria | `0` |  |
| `bloqueado_hasta` | timestamp with time zone |  |  |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_por` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### autorizacion_config

Tabla · — filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_config is '...'`._

**Llave primaria:** `clave`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `clave` 🔑 | text | obligatoria |  |  |
| `valor` | text |  |  |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### autorizacion_correos

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_correos is '...'`._

**Llave primaria:** `usuario_id`

**Se liga a:** `usuario_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `usuario_id` 🔑 | uuid | obligatoria |  |  |
| `correo` | text | obligatoria |  |  |
| `verificado` | boolean | obligatoria | `false` |  |
| `origen` | text | obligatoria | `'usuario'::text` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_por` | text |  |  |  |

### autorizacion_log

Tabla · 948 filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_log is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('autorizacion_log_id_seq'::regclass)` |  |
| `usuario_id` | uuid |  |  |  |
| `usuario` | text |  |  |  |
| `proceso` | text | obligatoria |  |  |
| `idempresa` | integer |  |  |  |
| `resultado` | text | obligatoria |  |  |
| `autorizado_por` | text |  |  |  |
| `referencia` | text |  |  |  |
| `detalle` | jsonb |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### autorizacion_perfil_procesos

Tabla · 34 filas aprox. · 2 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_perfil_procesos is '...'`._

**Llave primaria:** `perfil_id`, `proceso`

**Se liga a:** `perfil_id` → `autorizacion_perfiles`(id) · `proceso` → `autorizacion_procesos`(codigo)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `perfil_id` 🔑 | integer | obligatoria |  |  |
| `proceso` 🔑 | text | obligatoria |  |  |

### autorizacion_perfiles

Tabla · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_perfiles is '...'`._

**Llave primaria:** `id`

**Unicidad:** `nombre`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('autorizacion_perfiles_id_seq'::regclass)` |  |
| `nombre` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### autorizacion_procesos

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_procesos is '...'`._

**Llave primaria:** `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `codigo` 🔑 | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `grupo` | text | obligatoria |  |  |
| `orden` | integer | obligatoria | `0` |  |
| `con_alcance` | boolean | obligatoria | `true` |  |
| `activo` | boolean | obligatoria | `true` |  |

### autorizacion_recuperacion

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_recuperacion is '...'`._

**Llave primaria:** `id`

**Se liga a:** `usuario_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('autorizacion_recuperacion_id_seq'::regclass)` |  |
| `usuario_id` | uuid | obligatoria |  |  |
| `codigo_hash` | text | obligatoria |  |  |
| `canal` | text | obligatoria | `'correo'::text` |  |
| `destino` | text |  |  |  |
| `expira_en` | timestamp with time zone | obligatoria |  |  |
| `intentos` | integer | obligatoria | `0` |  |
| `usado_en` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### autorizacion_usuario_perfiles

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_usuario_perfiles is '...'`._

**Llave primaria:** `id`

**Unicidad:** `usuario_id` + `perfil_id`

**Se liga a:** `perfil_id` → `autorizacion_perfiles`(id) · `usuario_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('autorizacion_usuario_perfiles_id_seq'::regclass)` |  |
| `usuario_id` | uuid | obligatoria |  |  |
| `perfil_id` | integer | obligatoria |  |  |
| `idempresa` | integer |  |  |  |
| `asignado_por` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### autorizacion_usuario_procesos

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.autorizacion_usuario_procesos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `usuario_id` + `proceso`

**Se liga a:** `proceso` → `autorizacion_procesos`(codigo) · `usuario_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('autorizacion_usuario_procesos_id_seq'::regclass)` |  |
| `usuario_id` | uuid | obligatoria |  |  |
| `proceso` | text | obligatoria |  |  |
| `idempresa` | integer |  |  |  |
| `permitir` | boolean | obligatoria | `true` |  |
| `asignado_por` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### bitacora

Tabla · 227 filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.bitacora is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fecha` | date | obligatoria |  |  |
| `bitacora` | text |  |  |  |
| `idempresa` | numeric |  |  |  |
| `dashdia` | text |  |  |  |

### bodegas

Tabla · 1.090 filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.bodegas is '...'`._

**Llave primaria:** `idbodega`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idbodega` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `nombrebodega` | text |  |  |  |
| `direccion` | text |  |  |  |
| `ciudad` | text |  |  |  |
| `activo` | text |  |  |  |
| `clienteid` | bigint |  |  |  |
| `departamento` | text |  |  |  |
| `latitud` | numeric(10,7) |  |  | Coordenada del punto de entrega. La usa el planificador de rutas del CRM. |
| `longitud` | numeric(10,7) |  |  |  |

### bonos_nomina

Tabla · 158 filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.bonos_nomina is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('bonos_nomina_id_seq'::regclass)` |  |
| `fecha` | date | obligatoria |  |  |
| `identificacion` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `tipo` | text | obligatoria |  |  |
| `concepto` | text | obligatoria |  |  |
| `novedad_siigo` | text | obligatoria |  |  |
| `valor` | numeric | obligatoria |  |  |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `creado_por` | text |  |  |  |
| `creado` | timestamp with time zone | obligatoria | `now()` |  |
| `aprobado_por` | text |  |  |  |
| `aprobado_en` | timestamp with time zone |  |  |  |
| `motivo_rechazo` | text |  |  |  |

### cabeceraoc

Tabla · 9.528 filas aprox. · 46 columnas

_Sin descripción. Se escribe en la base con `comment on table public.cabeceraoc is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `ordendecargue` | text |  |  |  |
| `fechaorden` | date |  |  |  |
| `placa` | text |  |  |  |
| `conductor` | text |  |  |  |
| `celular` | text |  |  |  |
| `transporte` | text |  |  |  |
| `tipooperacion` | text |  |  |  |
| `pesoorden` | numeric |  |  |  |
| `horaorden` | time without time zone |  |  |  |
| `horasanitario` | time without time zone |  |  |  |
| `horavehiculo` | time without time zone |  |  |  |
| `pesajeinicial` | time without time zone |  |  |  |
| `pesajefinal` | time without time zone |  |  |  |
| `iniciocargue` | time without time zone |  |  |  |
| `fincargue` | time without time zone |  |  |  |
| `auxiliares` | text |  |  |  |
| `tiquetebascula` | text |  |  |  |
| `pdfoc` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `status` | text |  |  |  |
| `pesovascula` | numeric |  |  |  |
| `tipoproducto` | text |  |  |  |
| `fechacargue` | date |  |  |  |
| `horalote` | time without time zone |  |  |  |
| `doccargue` | text |  |  |  |
| `fotospicking` | text |  |  |  |
| `ordenorigen` | text |  |  |  |
| `horapicking` | time without time zone |  |  |  |
| `estadofactura` | text |  |  |  |
| `mediopago` | text |  |  |  |
| `valorpago` | numeric |  |  |  |
| `iva` | numeric |  |  |  |
| `comprobante` | text |  |  |  |
| `cuentatransferencia` | text |  |  |  |
| `retefuente` | numeric |  |  |  |
| `facturasiigo` | text |  |  |  |
| `cliente` | text |  |  |  |
| `tipo_factura` | text |  |  |  |
| `observacionesfactura` | text |  |  |  |
| `facturar` | boolean |  |  |  |
| `muelle` | integer |  |  |  |
| `tipo_pago` | text |  |  |  |
| `auxiliares_real` | text |  |  |  |
| `modo_carga` | text |  |  |  |

### capacitaciones

Tabla · 140 filas aprox. · 23 columnas

_Sin descripción. Se escribe en la base con `comment on table public.capacitaciones is '...'`._

**Llave primaria:** `id`

**Unicidad:** `codigo_sig` (parcial)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `extensions.uuid_generate_v4()` |  |
| `tema` | text |  |  |  |
| `categoria` | text |  |  |  |
| `fecha` | date |  |  |  |
| `duracion_horas` | numeric |  |  |  |
| `instructor` | text |  |  |  |
| `cliente_aplica` | text |  |  |  |
| `sede` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `idempresa` | smallint |  |  |  |
| `fecha_fin` | date |  |  |  |
| `urlcapacitacion` | text |  |  |  |
| `planilla` | text |  |  |  |
| `codigo_sig` | text |  |  |  |
| `tipo` | text |  |  |  |
| `descripcion` | text |  |  |  |
| `material_url` | text |  |  |  |
| `obligatoria` | boolean |  | `false` |  |
| `activa` | boolean |  | `true` |  |
| `ejecutada` | boolean |  |  |  |
| `trabajadores` | text |  |  |  |
| `admin` | boolean |  |  |  |

### capacitaciones_asistencia

Tabla · 89 filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.capacitaciones_asistencia is '...'`._

**Llave primaria:** `id`

**Unicidad:** `capacitacion_id` + `headcount_id` (parcial)

**Se liga a:** `headcount_id` → `headcount`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `extensions.uuid_generate_v4()` |  |
| `capacitacion_id` | uuid |  |  |  |
| `colaborador_id` | text |  |  |  |
| `asistio` | boolean |  |  |  |
| `resultado` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `firmaurl` | text |  |  |  |
| `idempresa` | smallint |  |  |  |
| `headcount_id` | bigint |  |  |  |

### capacitaciones_evaluacion_intentos

Tabla · 1.145 filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.capacitaciones_evaluacion_intentos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `capacitacion_id` → `capacitaciones`(id) · `evaluacion_id` → `capacitaciones_evaluaciones`(id) · `headcount_id` → `headcount`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `evaluacion_id` | uuid |  |  |  |
| `capacitacion_id` | uuid |  |  |  |
| `headcount_id` | bigint |  |  |  |
| `fecha` | timestamp with time zone |  | `now()` |  |
| `puntaje` | integer | obligatoria | `0` |  |
| `total` | integer | obligatoria | `0` |  |
| `aprobado` | boolean | obligatoria | `false` |  |
| `ip` | text |  |  |  |
| `user_agent` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### capacitaciones_evaluacion_preguntas

Tabla · 243 filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.capacitaciones_evaluacion_preguntas is '...'`._

**Llave primaria:** `id`

**Unicidad:** `evaluacion_id` + `orden`

**Se liga a:** `evaluacion_id` → `capacitaciones_evaluaciones`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `evaluacion_id` | uuid |  |  |  |
| `orden` | integer | obligatoria |  |  |
| `enunciado` | text | obligatoria |  |  |
| `tipo` | text | obligatoria | `'mcq'::text` |  |
| `opciones` | jsonb |  |  |  |
| `respuesta_correcta` | text | obligatoria |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### capacitaciones_evaluacion_respuestas

Tabla · 1.558 filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.capacitaciones_evaluacion_respuestas is '...'`._

**Llave primaria:** `id`

**Se liga a:** `intento_id` → `capacitaciones_evaluacion_intentos`(id) · `pregunta_id` → `capacitaciones_evaluacion_preguntas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `intento_id` | uuid |  |  |  |
| `pregunta_id` | uuid |  |  |  |
| `respuesta` | text |  |  |  |
| `es_correcta` | boolean |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### capacitaciones_evaluaciones

Tabla · 129 filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.capacitaciones_evaluaciones is '...'`._

**Llave primaria:** `id`

**Unicidad:** `capacitacion_id`

**Se liga a:** `capacitacion_id` → `capacitaciones`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `capacitacion_id` | uuid |  |  |  |
| `codigo_sig` | text |  |  |  |
| `titulo` | text | obligatoria |  |  |
| `total_preguntas` | integer | obligatoria | `8` |  |
| `puntaje_aprobacion` | integer | obligatoria | `7` |  |
| `activa` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `urlfirma` | text |  |  |  |
| `evidencia` | text |  |  |  |

### cargos_fijos_generados

Tabla · — filas aprox. · 11 columnas

Cargo fijo YA GENERADO para un mes concreto, con su propio estado de facturación (facturasiigo manda, igual que Gestión de Facturas).

**Llave primaria:** `id`

**Unicidad:** `origen_tipo` + `origen_id` + `periodo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `origen_tipo` | text | obligatoria |  |  |
| `origen_id` | bigint | obligatoria |  |  |
| `concepto` | text | obligatoria |  |  |
| `periodo` | date | obligatoria |  |  |
| `valor` | numeric | obligatoria |  |  |
| `tipo` | text | obligatoria |  |  |
| `estadofactura` | text |  |  |  |
| `facturasiigo` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### cargos_fijos_proyecto

Tabla · — filas aprox. · 10 columnas

Conceptos de facturación fija mensual por proyecto (no ligados a órdenes ni turnos): $2M Manejo de Inventario (id1/id3), 600 ton fijas Avimol (id2).

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `concepto` | text | obligatoria |  |  |
| `cantidad` | numeric |  |  |  |
| `tarifa` | numeric |  |  |  |
| `valor` | numeric |  |  |  |
| `tipo` | text | obligatoria |  |  |
| `fechainicio` | date | obligatoria |  |  |
| `fechafin` | date | obligatoria |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### categorias

Tabla · — filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.categorias is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `activo` | text |  |  |  |

### cierre_produccion_config

Tabla · — filas aprox. · 7 columnas

Configuracion del envio automatico del cierre diario de produccion. Fila unica. La hora real del cron esta en vercel.json; esta columna es la verificacion. Ver scripts/197.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `1` |  |
| `activo` | boolean | obligatoria | `false` |  |
| `hora_envio` | time without time zone | obligatoria | `'20:00:00'::time without time zone` |  |
| `empresa_id` | integer | obligatoria | `1` |  |
| `actualizado_por` | text |  |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### cierre_produccion_destinatarios

Tabla · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.cierre_produccion_destinatarios is '...'`._

**Llave primaria:** `id`

**Unicidad:** `telefono`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('cierre_produccion_destinatarios_id_seq'::regclass)` |  |
| `nombre` | text | obligatoria |  |  |
| `telefono` | text | obligatoria |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### cierre_produccion_enviados

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.cierre_produccion_enviados is '...'`._

**Llave primaria:** `id`

**Unicidad:** `fecha` + `telefono` (parcial)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('cierre_produccion_enviados_id_seq'::regclass)` |  |
| `fecha` | date | obligatoria |  |  |
| `telefono` | text | obligatoria |  |  |
| `mensaje_id` | text |  |  |  |
| `motivo` | text |  |  |  |
| `origen` | text | obligatoria | `'automatico'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### citasvehiculos

Tabla · 8.423 filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.citasvehiculos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `placa` | text |  |  |  |
| `nombreconductor` | text |  |  |  |
| `telefono` | text |  |  |  |
| `transporte` | text |  |  |  |
| `tipovehiculo` | text |  |  |  |
| `tipoproducto` | text |  |  |  |
| `estatus` | text |  |  |  |
| `horallegada` | time without time zone |  |  |  |
| `horaregistro` | time without time zone |  |  |  |
| `horapesoinicial` | time without time zone |  |  |  |
| `capacidad` | numeric |  |  |  |
| `tipodespacho` | text |  |  |  |
| `fechallegada` | date |  |  |  |
| `ocargue` | text |  |  |  |

### clientes

Tabla · 2.467 filas aprox. · 22 columnas

_Sin descripción. Se escribe en la base con `comment on table public.clientes is '...'`._

**Llave primaria:** `id`

**Se liga a:** `id_empresa` → `empresas`(id) · `lista_precio_id` → `crm_listas_precios`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `id_empresa` | smallint | obligatoria |  |  |
| `documento` | numeric |  |  |  |
| `nombre` | text |  |  |  |
| `correo` | text |  |  |  |
| `personacontacto` | text |  |  |  |
| `celular` | text |  |  |  |
| `tipo_cliente` | text |  |  |  |
| `tiporegimeniva` | text |  |  |  |
| `responsableiva` | text |  |  |  |
| `responsabilidadfiscal` | text |  |  |  |
| `activo` | text |  |  |  |
| `correofact` | text |  |  |  |
| `cupo_credito` | numeric(14,2) | obligatoria | `0` | Monto maximo de cartera pendiente. 0 = solo contado. Lo valida el CRM antes de autorizar un pedido a credito. |
| `dias_credito` | integer | obligatoria | `0` |  |
| `lista_precio_id` | integer |  |  |  |
| `latitud` | numeric(10,7) |  |  |  |
| `longitud` | numeric(10,7) |  |  |  |
| `bloqueado_cartera` | boolean | obligatoria | `false` | Bloqueo manual de ventas a credito, independiente del cupo. Lo activa cartera. |
| `vendedor_asignado` | integer |  |  |  |
| `segmento` | text |  |  | Agrupador comercial libre (mayorista, institucional, panaderia...). Alimenta el analisis de oportunidades. |
| `observaciones_crm` | text |  |  |  |

### colaboradores

Tabla · — filas aprox. · 33 columnas

_Sin descripción. Se escribe en la base con `comment on table public.colaboradores is '...'`._

**Llave primaria:** `id`

**Unicidad:** `numero_documento`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `extensions.uuid_generate_v4()` |  |
| `tipo_documento` | text |  |  |  |
| `numero_documento` | text |  |  |  |
| `nombres` | text |  |  |  |
| `apellidos` | text |  |  |  |
| `fecha_nacimiento` | date |  |  |  |
| `telefono` | text |  |  |  |
| `email` | text |  |  |  |
| `direccion` | text |  |  |  |
| `ciudad` | text |  |  |  |
| `departamento` | text |  |  |  |
| `contacto_emergencia_nombre` | text |  |  |  |
| `contacto_emergencia_telefono` | text |  |  |  |
| `cargo` | text |  |  |  |
| `area` | text |  |  |  |
| `cliente_asignado` | text |  |  |  |
| `sede` | text |  |  |  |
| `tipo_contrato` | text |  |  |  |
| `fecha_ingreso` | date |  |  |  |
| `fecha_retiro` | date |  |  |  |
| `estado` | text |  |  |  |
| `salario_base` | numeric |  |  |  |
| `banco` | text |  |  |  |
| `cuenta_bancaria` | text |  |  |  |
| `eps` | text |  |  |  |
| `arl` | text |  |  |  |
| `caja_compensacion` | text |  |  |  |
| `fondo_pension` | text |  |  |  |
| `talla_camisa` | text |  |  |  |
| `talla_pantalon` | text |  |  |  |
| `talla_zapato` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### colaboradores_th

Tabla · — filas aprox. · 56 columnas

_Sin descripción. Se escribe en la base con `comment on table public.colaboradores_th is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `numero_documento`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `extensions.uuid_generate_v4()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `primer_nombre` | text | obligatoria |  |  |
| `segundo_nombre` | text |  |  |  |
| `primer_apellido` | text | obligatoria |  |  |
| `segundo_apellido` | text |  |  |  |
| `tipo_documento` | text | obligatoria |  |  |
| `numero_documento` | text | obligatoria |  |  |
| `centro_costos` | text |  |  |  |
| `correo_electronico` | text | obligatoria |  |  |
| `numero_celular` | text | obligatoria |  |  |
| `pais_residencia` | text | obligatoria |  |  |
| `departamento_residencia` | text | obligatoria |  |  |
| `ciudad_residencia` | text | obligatoria |  |  |
| `direccion_residencia` | text | obligatoria |  |  |
| `metodo_pago` | text | obligatoria |  |  |
| `entidad_bancaria` | text |  |  |  |
| `tipo_cuenta` | text |  |  |  |
| `numero_cuenta` | text |  |  |  |
| `numero_telefono_celular` | text |  |  |  |
| `direccion_oficina` | text | obligatoria |  |  |
| `pais_oficina` | text | obligatoria |  |  |
| `departamento_oficina` | text | obligatoria |  |  |
| `ciudad_oficina` | text | obligatoria |  |  |
| `nombre_empleado` | text |  |  |  |
| `numero_identificacion` | text | obligatoria |  |  |
| `tipo_contrato` | text | obligatoria |  |  |
| `fecha_inicio_contrato` | date | obligatoria |  |  |
| `fecha_fin_contrato` | date |  |  |  |
| `sueldo` | numeric | obligatoria |  |  |
| `salario_integral` | boolean |  | `false` |  |
| `numero_contrato` | text | obligatoria |  |  |
| `grupo_nomina` | text | obligatoria |  |  |
| `cargo` | text | obligatoria |  |  |
| `centro_costo` | text |  |  |  |
| `tipo_cotizante` | text | obligatoria |  |  |
| `subtipo_cotizante` | text | obligatoria |  |  |
| `fondo_salud` | text | obligatoria |  |  |
| `porcentaje_salud` | numeric | obligatoria |  |  |
| `fondo_pension` | text |  |  |  |
| `porcentaje_pension` | numeric |  |  |  |
| `fondo_arl` | text |  |  |  |
| `clase_riesgo` | text |  |  |  |
| `codigo_ciiu` | text |  |  |  |
| `codigo` | text |  |  |  |
| `caja_compensacion` | text |  |  |  |
| `fondo_cesantias` | text |  |  |  |
| `deduccion_vivienda` | numeric |  |  |  |
| `deduccion_medicina_prepagada` | numeric |  |  |  |
| `aportes_voluntarios_pension_obligatoria` | numeric |  |  |  |
| `aporte_voluntario_pension_renta_exenta` | numeric |  |  |  |
| `aporte_voluntario_afc` | numeric |  |  |  |
| `aplica_deduccion_dependientes` | boolean |  | `false` |  |
| `estado` | text |  | `'activo'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### condiciones_envio_anexo

Tabla · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.condiciones_envio_anexo is '...'`._

**Llave primaria:** `idempresa`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` 🔑 | integer | obligatoria |  |  |
| `frecuencia` | text | obligatoria | `'semanal'::text` |  |
| `dia_semana` | integer |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |

### condiciones_generacion_prefactura

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.condiciones_generacion_prefactura is '...'`._

**Llave primaria:** `idempresa`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` 🔑 | integer | obligatoria |  |  |
| `frecuencia` | text | obligatoria | `'semanal'::text` |  |
| `dia_semana` | integer |  |  |  |
| `activo` | boolean | obligatoria | `false` |  |
| `fecha_inicio` | date |  |  |  |
| `dias_corte` | integer[] |  |  |  |

### condiciones_pago_owner

Tabla · — filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.condiciones_pago_owner is '...'`._

**Llave primaria:** `owner`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `owner` 🔑 | text | obligatoria |  |  |
| `dias_plazo` | integer | obligatoria | `30` |  |
| `activo` | boolean | obligatoria | `true` |  |

### condicionespago

Tabla · — filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.condicionespago is '...'`._

**Llave primaria:** `idcondicion`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idcondicion` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombrecondicion` | text | obligatoria |  |  |
| `activo` | text |  |  |  |

### contratos

Tabla · 70 filas aprox. · 17 columnas

_Sin descripción. Se escribe en la base con `comment on table public.contratos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `extensions.uuid_generate_v4()` |  |
| `colaborador_id` | text |  |  |  |
| `fecha_inicio` | date |  |  |  |
| `fecha_fin` | date |  |  |  |
| `tipo_contrato` | text |  |  |  |
| `cargo` | text |  |  |  |
| `salario_base` | numeric |  |  |  |
| `cliente_asignado` | text |  |  |  |
| `sede` | text |  |  |  |
| `estado` | text |  |  |  |
| `url_documento` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `fechaenvio` | date |  |  |  |
| `fechafirma` | date |  |  |  |
| `idempresa` | smallint |  |  |  |
| `causaretiro` | text |  |  |  |

### crm_actividades

Tabla · — filas aprox. · 17 columnas

Bitacora de lo ocurrido. Es historico: no se edita ni se borra, se agrega.

**Llave primaria:** `id`

**Se liga a:** `prospecto_id` → `crm_prospectos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_actividades_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `prospecto_id` | bigint |  |  |  |
| `cliente_id` | integer |  |  |  |
| `tipo` | text | obligatoria |  |  |
| `asunto` | text | obligatoria |  |  |
| `detalle` | text |  |  |  |
| `resultado` | text |  |  |  |
| `fecha_hora` | timestamp with time zone | obligatoria | `now()` |  |
| `duracion_min` | integer |  |  |  |
| `latitud` | numeric(10,7) |  |  |  |
| `longitud` | numeric(10,7) |  |  |  |
| `gps_precision_m` | numeric(8,2) |  |  |  |
| `vendedor_id` | integer |  |  |  |
| `usuario` | text |  |  |  |
| `adjunto_url` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_agenda

Tabla · — filas aprox. · 21 columnas

Compromisos futuros. Alimenta el calendario, la alerta de la campana y el tablero de proximas visitas.

**Llave primaria:** `id`

**Se liga a:** `actividad_id` → `crm_actividades`(id) · `prospecto_id` → `crm_prospectos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_agenda_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `titulo` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `tipo` | text | obligatoria | `'visita'::text` |  |
| `fecha` | date | obligatoria |  |  |
| `hora_inicio` | time without time zone |  |  |  |
| `hora_fin` | time without time zone |  |  |  |
| `prospecto_id` | bigint |  |  |  |
| `cliente_id` | integer |  |  |  |
| `vendedor_id` | integer |  |  |  |
| `usuario_asignado` | uuid |  |  |  |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `recordatorio_dias` | integer | obligatoria | `1` |  |
| `actividad_id` | bigint |  |  | Al marcar cumplida se crea una actividad y se enlaza aqui: el compromiso queda amarrado a su evidencia. |
| `direccion` | text |  |  |  |
| `latitud` | numeric(10,7) |  |  |  |
| `longitud` | numeric(10,7) |  |  |  |
| `creado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_autorizaciones_log

Tabla · — filas aprox. · 10 columnas

Historia de las autorizaciones, incluidos los intentos fallidos (clave errada). Solo se agrega.

**Llave primaria:** `id`

**Se liga a:** `pedido_id` → `crm_pedidos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_autorizaciones_log_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `pedido_id` | bigint | obligatoria |  |  |
| `rol` | text | obligatoria |  |  |
| `accion` | text | obligatoria |  |  |
| `usuario_id` | uuid |  |  |  |
| `usuario_nombre` | text |  |  |  |
| `nota` | text |  |  |  |
| `total_al_momento` | numeric(14,2) |  |  | Valor del pedido cuando se autorizo. Si alguien lo modifica despues, queda la evidencia de que se autorizo otra cifra. |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_bancos

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_bancos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_bancos_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `codigo` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `sap_codigo` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_cartera_aging

Vista · — filas aprox. · 16 columnas

Cartera pendiente clasificada por antiguedad. Los tramos salen de crm_parametros: cambiarlos alli reclasifica todo sin desplegar.

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | bigint |  |  |  |
| `idempresa` | integer |  |  |  |
| `cliente_id` | integer |  |  |  |
| `cliente_nombre` | text |  |  |  |
| `pedido_id` | bigint |  |  |  |
| `numero_factura` | text |  |  |  |
| `fecha_factura` | date |  |  |  |
| `fecha_vencimiento` | date |  |  |  |
| `valor_original` | numeric(14,2) |  |  |  |
| `valor_abonado` | numeric(14,2) |  |  |  |
| `saldo` | numeric(14,2) |  |  |  |
| `estado` | text |  |  |  |
| `vendedor_id` | integer |  |  |  |
| `dias_vencido` | integer |  |  |  |
| `tramo_aging` | text |  |  |  |
| `tramo_orden` | integer |  |  |  |

### crm_catalogo_cliente

Tabla · — filas aprox. · 8 columnas

Productos que se le pueden vender a cada cliente (PED-07). Sin filas para un cliente, manda el parametro catalogo.modo.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `cliente_id` + `producto_id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_catalogo_cliente_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `cliente_id` | integer | obligatoria |  |  |
| `producto_id` | bigint | obligatoria |  |  |
| `orden` | integer | obligatoria | `0` |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_comisiones

Tabla · — filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_comisiones is '...'`._

**Llave primaria:** `id`

**Unicidad:** `vendedor_id` + `cuenta_cobrar_id` (parcial)

**Se liga a:** `cuenta_cobrar_id` → `crm_cuentas_cobrar`(id) · `pedido_id` → `crm_pedidos`(id) · `regla_id` → `crm_reglas_comision`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_comisiones_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `vendedor_id` | integer | obligatoria |  |  |
| `pedido_id` | bigint |  |  |  |
| `cuenta_cobrar_id` | bigint |  |  |  |
| `regla_id` | integer |  |  |  |
| `periodo` | text | obligatoria |  |  |
| `base_calculo` | numeric(14,2) | obligatoria |  |  |
| `porcentaje` | numeric(6,3) | obligatoria |  | Tasa con la que se liquido, copiada de la regla. Es un hecho historico: no se recalcula. |
| `valor` | numeric(14,2) | obligatoria |  |  |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `liquidado_por` | text |  |  |  |
| `liquidado_en` | timestamp with time zone |  |  |  |
| `observaciones` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_consecutivos

Tabla · — filas aprox. · 4 columnas

Contador por empresa, tipo de documento y anio. Se bloquea la fila al asignar para que dos usuarios simultaneos no reciban el mismo numero.

**Llave primaria:** `idempresa`, `tipo`, `anio`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` 🔑 | integer | obligatoria | `1` |  |
| `tipo` 🔑 | text | obligatoria |  |  |
| `anio` 🔑 | integer | obligatoria |  |  |
| `ultimo` | integer | obligatoria | `0` |  |

### crm_cotizacion_detalle

Tabla · — filas aprox. · 20 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_cotizacion_detalle is '...'`._

**Llave primaria:** `id`

**Unicidad:** `cotizacion_id` + `linea`

**Se liga a:** `cotizacion_id` → `crm_cotizaciones`(id) · `impuesto_id` → `crm_impuestos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_cotizacion_detalle_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `cotizacion_id` | bigint | obligatoria |  |  |
| `linea` | integer | obligatoria |  |  |
| `producto_id` | integer |  |  |  |
| `producto_nombre` | text | obligatoria |  | Texto, no solo id: es lo que viaja a LIPgo, que une por nombre. Y el precio debe quedar congelado aunque el producto se renombre. |
| `categoria` | text |  |  |  |
| `unidad` | text |  |  |  |
| `cantidad` | numeric(14,3) | obligatoria |  |  |
| `precio_lista` | numeric(14,2) |  |  | Precio que resolvio la lista, antes de que el vendedor lo tocara. Comparado con precio_unitario dice cuanto descuento dio. |
| `precio_unitario` | numeric(14,2) | obligatoria |  |  |
| `descuento_pct` | numeric(6,3) | obligatoria | `0` |  |
| `descuento_valor` | numeric(14,2) | obligatoria | `0` |  |
| `subtotal` | numeric(14,2) | obligatoria | `0` |  |
| `total_linea` | numeric(14,2) | obligatoria | `0` |  |
| `peso` | numeric(14,3) | obligatoria | `0` |  |
| `impuesto_id` | integer |  |  |  |
| `impuesto_pct` | numeric(6,3) |  |  |  |
| `base_impuesto` | numeric(14,2) |  |  |  |
| `impuesto_valor` | numeric(14,2) |  |  |  |

### crm_cotizaciones

Tabla · — filas aprox. · 34 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_cotizaciones is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `numero`

**Se liga a:** `cotizacion_padre_id` → `crm_cotizaciones`(id) · `lista_precio_id` → `crm_listas_precios`(id) · `owner_id` → `crm_owners`(id) · `prospecto_id` → `crm_prospectos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_cotizaciones_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `numero` | text |  |  |  |
| `prospecto_id` | bigint |  |  |  |
| `cliente_id` | integer |  |  |  |
| `bodega_id` | integer |  |  |  |
| `vendedor_id` | integer |  |  |  |
| `tipo_venta` | text | obligatoria | `'cotizacion'::text` |  |
| `forma_pago` | text | obligatoria | `'contado'::text` |  |
| `dias_credito` | integer | obligatoria | `0` |  |
| `condicion_pago_id` | integer |  |  |  |
| `fecha_emision` | date | obligatoria | `CURRENT_DATE` |  |
| `vigencia_dias` | integer | obligatoria |  | Copiada del parametro cotizacion.vigencia_dias EN EL MOMENTO DE EMITIR. Cambiar el parametro no altera las cotizaciones ya emitidas. |
| `fecha_vencimiento` | date | obligatoria |  |  |
| `estado` | text | obligatoria | `'borrador'::text` |  |
| `subtotal` | numeric(14,2) | obligatoria | `0` |  |
| `descuento_valor` | numeric(14,2) | obligatoria | `0` |  |
| `iva_pct` | numeric(6,3) | obligatoria |  |  |
| `iva_valor` | numeric(14,2) | obligatoria | `0` |  |
| `total` | numeric(14,2) | obligatoria | `0` |  |
| `peso_total` | numeric(14,3) | obligatoria | `0` |  |
| `lista_precio_id` | integer |  |  |  |
| `requiere_autorizacion_descuento` | boolean | obligatoria | `false` | Se marca cuando alguna linea baja del tope parametrizado (descuento.maximo_vendedor). |
| `pdf_url` | text |  |  |  |
| `version` | integer | obligatoria | `1` |  |
| `cotizacion_padre_id` | bigint |  |  | Si es una revision, apunta a la version anterior. Permite ver como evoluciono la negociacion. |
| `observaciones` | text |  |  |  |
| `motivo_rechazo` | text |  |  |  |
| `crm_pedido_id` | bigint |  |  |  |
| `creado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `owner_id` | integer |  |  |  |
| `idempresa_despacho` | integer |  |  |  |

### crm_cuentas_cobrar

Tabla · — filas aprox. · 21 columnas

Cartera. Nace con el pedido autorizado a credito; el numero de factura de Siigo se agrega despues.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `numero_factura` (parcial) · `idempresa` + `pedido_id` (parcial)

**Se liga a:** `importacion_id` → `crm_importaciones`(id) · `owner_id` → `crm_owners`(id) · `pedido_id` → `crm_pedidos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_cuentas_cobrar_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `cliente_id` | integer | obligatoria |  |  |
| `pedido_id` | bigint |  |  |  |
| `idpedido_lipgo` | integer |  |  |  |
| `numero_factura` | text |  |  |  |
| `fecha_factura` | date | obligatoria | `CURRENT_DATE` |  |
| `fecha_vencimiento` | date | obligatoria |  |  |
| `valor_original` | numeric(14,2) | obligatoria |  |  |
| `valor_abonado` | numeric(14,2) | obligatoria | `0` |  |
| `saldo` | numeric(14,2) | **GENERADA** |  | GENERADA: valor_original - valor_abonado. No se actualiza a mano, no puede quedar inconsistente. |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `vendedor_id` | integer |  |  |  |
| `observaciones` | text |  |  |  |
| `creado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `owner_id` | integer |  |  |  |
| `tipo_documento` | text | obligatoria | `'factura'::text` |  |
| `origen` | text | obligatoria | `'pedido'::text` | pedido = nacio al aprobar un pedido a credito. importacion = saldo inicial cargado por archivo. Una cuenta de pedido nunca se vuelve a crear por importacion. |
| `importacion_id` | bigint |  |  |  |

### crm_cuentas_destino

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_cuentas_destino is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `alias`

**Se liga a:** `banco_id` → `crm_bancos`(id) · `owner_id` → `crm_owners`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_cuentas_destino_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `alias` | text | obligatoria |  |  |
| `banco_id` | integer | obligatoria |  |  |
| `owner_id` | integer |  |  |  |
| `tipo` | text |  |  |  |
| `numero` | text |  |  | Opcional. El vendedor elige la cuenta por su alias; el numero solo sirve para conciliar y para SAP. |
| `sap_cuenta` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_documentos

Tabla · — filas aprox. · 21 columnas

Documentos del CRM (comprobantes, RUT, camara de comercio...). El archivo vive en el bucket privado crm-privado; se ve solo con URL firmada.

**Llave primaria:** `id`

**Unicidad:** `bucket` + `storage_path` · `idempresa` + `sha256` (parcial)

**Se liga a:** `tipo_documento_id` → `crm_tipos_documento`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_documentos_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `entidad` | text | obligatoria |  |  |
| `entidad_id` | bigint | obligatoria |  |  |
| `tipo_documento_id` | integer |  |  |  |
| `bucket` | text | obligatoria | `'crm-privado'::text` |  |
| `storage_path` | text | obligatoria |  |  |
| `nombre_archivo` | text |  |  |  |
| `mime` | text |  |  |  |
| `tamano` | integer |  |  |  |
| `sha256` | text | obligatoria |  |  |
| `ocr_resultado` | jsonb |  |  |  |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `subido_por` | uuid |  |  |  |
| `subido_nombre` | text |  |  |  |
| `subido_en` | timestamp with time zone | obligatoria | `now()` |  |
| `revisado_por` | uuid |  |  |  |
| `revisado_nombre` | text |  |  |  |
| `revisado_en` | timestamp with time zone |  |  |  |
| `nota` | text |  |  |  |
| `prospecto_id` | bigint |  |  |  |

### crm_etapas

Tabla · — filas aprox. · 10 columnas

Etapas del embudo. La probabilidad pondera el pronostico de ventas.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `nombre`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_etapas_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `nombre` | text | obligatoria |  |  |
| `orden` | integer | obligatoria |  |  |
| `probabilidad` | numeric(5,2) | obligatoria | `0` |  |
| `es_ganada` | boolean | obligatoria | `false` | Marca la etapa terminal de exito. El prospecto se convierte en cliente al llegar aqui. |
| `es_perdida` | boolean | obligatoria | `false` |  |
| `color` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_eventos

Tabla · — filas aprox. · 12 columnas

Historial unico del CRM: pedidos, recaudos, prospectos, cartera, seguridad. Solo insercion. Alimenta el historial de cada documento y la auditoria.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_eventos_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `entidad` | text | obligatoria |  |  |
| `entidad_id` | bigint |  |  |  |
| `tipo` | text | obligatoria |  | Que paso: creado, editado, solicitado, firmado, rechazado, reenviado, proyectado, error_integracion, acceso_denegado... |
| `estado_desde` | text |  |  |  |
| `estado_hasta` | text |  |  |  |
| `usuario_id` | uuid |  |  |  |
| `usuario_nombre` | text |  |  |  |
| `nota` | text |  |  |  |
| `datos` | jsonb | obligatoria | `'{}'::jsonb` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_importacion_filas

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_importacion_filas is '...'`._

**Llave primaria:** `id`

**Se liga a:** `importacion_id` → `crm_importaciones`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_importacion_filas_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `importacion_id` | bigint | obligatoria |  |  |
| `fila` | integer | obligatoria |  |  |
| `datos` | jsonb | obligatoria |  |  |
| `accion` | text | obligatoria |  |  |
| `errores` | jsonb | obligatoria | `'[]'::jsonb` |  |
| `entidad_id` | bigint |  |  |  |
| `antes` | jsonb |  |  |  |
| `aplicada` | boolean | obligatoria | `false` |  |

### crm_importaciones

Tabla · — filas aprox. · 14 columnas

Cada carga de archivo: se simula, se revisa y solo entonces se aplica. Guarda autor, fecha y resultado.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_importaciones_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `tipo` | text | obligatoria |  |  |
| `archivo_nombre` | text |  |  |  |
| `estado` | text | obligatoria | `'simulada'::text` |  |
| `total_filas` | integer | obligatoria | `0` |  |
| `filas_crear` | integer | obligatoria | `0` |  |
| `filas_actualizar` | integer | obligatoria | `0` |  |
| `filas_omitir` | integer | obligatoria | `0` |  |
| `filas_error` | integer | obligatoria | `0` |  |
| `creado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `aplicado_por` | text |  |  |  |
| `aplicado_en` | timestamp with time zone |  |  |  |

### crm_impuestos

Tabla · — filas aprox. · 10 columnas

Tarifas de impuesto que se asignan a cada producto. La marcada es_default se usa para los productos sin impuesto asignado.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo` · `idempresa` (parcial)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_impuestos_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `codigo` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `tipo` | text | obligatoria |  |  |
| `tarifa` | numeric(6,3) | obligatoria |  |  |
| `sap_codigo` | text |  |  |  |
| `es_default` | boolean | obligatoria | `false` |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_integracion_log

Tabla · — filas aprox. · 12 columnas

Cada intento de envio con su request, response y error (INT-08). Es lo que se mira cuando SAP rechaza algo.

**Llave primaria:** `id`

**Se liga a:** `outbox_id` → `crm_integracion_outbox`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_integracion_log_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `outbox_id` | bigint |  |  |  |
| `sistema` | text | obligatoria |  |  |
| `modo` | text | obligatoria |  |  |
| `request` | jsonb |  |  |  |
| `response` | jsonb |  |  |  |
| `http_status` | integer |  |  |  |
| `duracion_ms` | integer |  |  |  |
| `ok` | boolean | obligatoria |  |  |
| `error` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_integracion_outbox

Tabla · — filas aprox. · 22 columnas

Bandeja de salida hacia sistemas externos (SAP, LIPgo, WhatsApp). Equivale al integration_outbox del requerimiento. Nada de negocio espera a que esto se envie.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `idempotency_key`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_integracion_outbox_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `sistema` | text | obligatoria |  |  |
| `flujo` | text | obligatoria |  |  |
| `entidad` | text | obligatoria |  |  |
| `entidad_id` | bigint |  |  |  |
| `operacion` | text | obligatoria |  |  |
| `payload` | jsonb | obligatoria | `'{}'::jsonb` |  |
| `idempotency_key` | text | obligatoria |  | Llave unica del envio (ej. sap:pedido:123:v1). Evita que un reintento duplique el documento en el sistema externo. |
| `estado` | text | obligatoria | `'pendiente'::text` | pendiente: por enviar. procesando: tomado por el worker. enviado: el sistema externo lo acepto. error: fallo, se reintenta hasta max_intentos. omitido: la integracion estaba apagada al procesarlo. descartado: un administrador decidio no enviarlo. |
| `intentos` | integer | obligatoria | `0` |  |
| `max_intentos` | integer | obligatoria | `5` |  |
| `proximo_intento_en` | timestamp with time zone | obligatoria | `now()` |  |
| `bloqueado_por` | text |  |  |  |
| `bloqueado_en` | timestamp with time zone |  |  |  |
| `ultimo_error` | text |  |  |  |
| `referencia_externa` | text |  |  |  |
| `respuesta` | jsonb |  |  |  |
| `creado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `enviado_en` | timestamp with time zone |  |  |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_inventario_producto

Vista · — filas aprox. · 5 columnas

Inventario de LIPgo (invglobal) agrupado por producto, con desglose por sede de despacho. Solo lectura.

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `producto_id` | smallint |  |  |  |
| `stock_disponible` | numeric |  |  |  |
| `stock_reservado` | numeric |  |  |  |
| `stock_global` | numeric |  |  |  |
| `por_sede` | jsonb |  |  |  |

### crm_lista_precio_detalle

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_lista_precio_detalle is '...'`._

**Llave primaria:** `id`

**Unicidad:** `lista_id` + `producto_id`

**Se liga a:** `lista_id` → `crm_listas_precios`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_lista_precio_detalle_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `lista_id` | integer | obligatoria |  |  |
| `producto_id` | integer | obligatoria |  |  |
| `producto_nombre` | text |  |  |  |
| `precio_manual` | numeric(14,2) |  |  |  |
| `descuento_pct` | numeric(6,3) |  |  |  |
| `precio_minimo` | numeric(14,2) |  |  | Piso absoluto: ni con el descuento maximo del vendedor se baja de aqui. Es la ultima defensa del margen. |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_listas_precios

Tabla · — filas aprox. · 13 columnas

Listas de precios por cliente. El precio final lo resuelve una unica funcion en el codigo (resolverPrecio), no cada modulo por su cuenta.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `nombre` · `idempresa` (parcial)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_listas_precios_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `nombre` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `tipo` | text | obligatoria | `'manual'::text` |  |
| `descuento_global` | numeric(6,3) | obligatoria | `0` |  |
| `vigente_desde` | date | obligatoria | `CURRENT_DATE` |  |
| `vigente_hasta` | date |  |  |  |
| `es_default` | boolean | obligatoria | `false` | Lista que se aplica al cliente que no tiene ninguna asignada. |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_medios_pago

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_medios_pago is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_medios_pago_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `codigo` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `requiere_banco` | boolean | obligatoria | `true` |  |
| `requiere_comprobante` | boolean | obligatoria | `true` |  |
| `sap_codigo` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `orden` | integer | obligatoria | `0` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_motivos

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_motivos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `tipo` + `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_motivos_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `tipo` | text | obligatoria |  |  |
| `codigo` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `exige_nota` | boolean | obligatoria | `false` |  |
| `activo` | boolean | obligatoria | `true` |  |
| `orden` | integer | obligatoria | `0` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_notificacion_destinatarios

Tabla · — filas aprox. · 8 columnas

Quien recibe cada aviso por WhatsApp. El requerimiento nombra a Jefferson para pedido_aprobado; se registra aqui con su celular.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `evento` + `celular` + `owner_id`

**Se liga a:** `owner_id` → `crm_owners`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_notificacion_destinatarios_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `evento` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `celular` | text | obligatoria |  |  |
| `owner_id` | integer |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_owners

Tabla · — filas aprox. · 21 columnas

Owners comerciales (INDUPAN, Molinos). El owner del producto decide el flujo del pedido: a que centro de LIPgo se proyecta, con que empresafactura y si pasa por SAP.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_owners_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `codigo` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `owner_lipgo_id` | integer |  |  |  |
| `nombre_empresafactura` | text | obligatoria |  |  |
| `alias_producto` | text[] | obligatoria | `'{}'::text[]` |  |
| `idempresas_origen` | integer[] | obligatoria | `'{}'::integer[]` |  |
| `idempresa_lipgo` | integer | obligatoria |  |  |
| `envia_sap` | boolean | obligatoria | `false` | Solo los owners con true generan envios a SAP. Molinos va en false: sus pedidos terminan en LIPgo. |
| `color` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `idempresas_despacho` | integer[] | obligatoria | `'{}'::integer[]` | Centros de LIPgo (id_empresa) desde los que se despachan los pedidos de este owner. El pedido solo admite productos que existan en el centro elegido. |
| `nit` | text |  |  |  |
| `logo_url` | text |  |  | Logo del membrete (estado de cuenta, recibo de caja). Debe estar en el Storage del proyecto: el servidor no descarga imagenes de otros dominios. |
| `direccion` | text |  |  |  |
| `telefono` | text |  |  |  |
| `correo` | text |  |  |  |
| `pie_documento` | text |  |  | Texto legal al pie del estado de cuenta y del recibo de caja. |

### crm_pagos

Tabla · — filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_pagos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `cuenta_cobrar_id` → `crm_cuentas_cobrar`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_pagos_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `cuenta_cobrar_id` | bigint | obligatoria |  |  |
| `fecha_pago` | date | obligatoria | `CURRENT_DATE` |  |
| `valor` | numeric(14,2) | obligatoria |  |  |
| `medio_pago` | text |  |  |  |
| `referencia` | text |  |  |  |
| `soporte_url` | text |  |  |  |
| `observacion` | text |  |  |  |
| `registrado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `tipo` | text | obligatoria | `'legacy'::text` |  |
| `recaudo_id` | bigint |  |  |  |
| `anulado_en` | timestamp with time zone |  |  | Un pago anulado no se borra: se marca aqui y deja de sumar al saldo. Asi queda quien lo anulo, cuando y por que. |
| `anulado_por` | text |  |  |  |
| `motivo_anulacion` | text |  |  |  |

### crm_parametros

Tabla · 47 filas aprox. · 17 columnas

Todo numero del que depende una regla de negocio del CRM. Si un valor aparece literal en el codigo y gobierna una regla, es un bug: va aqui.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `clave` + `vigente_desde` · `idempresa` + `clave` (parcial)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_parametros_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `clave` | text | obligatoria |  |  |
| `valor` | text | obligatoria |  | Siempre texto; la columna `tipo` dice como interpretarlo. El helper de TypeScript hace la conversion. |
| `tipo` | text | obligatoria | `'number'::text` |  |
| `grupo` | text | obligatoria |  |  |
| `etiqueta` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `unidad` | text |  |  |  |
| `min_valor` | numeric |  |  |  |
| `max_valor` | numeric |  |  |  |
| `vigente_desde` | date | obligatoria | `CURRENT_DATE` |  |
| `vigente_hasta` | date |  |  | NULL = vigente. Cambiar un parametro cierra el anterior y abre uno nuevo, para no reescribir el pasado. |
| `editable` | boolean | obligatoria | `true` | false para parametros que solo deberia mover un tecnico (ej. limites de integracion). |
| `actualizado_por` | text |  |  |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_pedido_detalle

Tabla · — filas aprox. · 20 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_pedido_detalle is '...'`._

**Llave primaria:** `id`

**Unicidad:** `pedido_id` + `linea`

**Se liga a:** `impuesto_id` → `crm_impuestos`(id) · `pedido_id` → `crm_pedidos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_pedido_detalle_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `pedido_id` | bigint | obligatoria |  |  |
| `linea` | integer | obligatoria |  |  |
| `producto_id` | integer |  |  |  |
| `producto_nombre` | text | obligatoria |  |  |
| `categoria` | text |  |  |  |
| `unidad` | text |  |  |  |
| `cantidad` | numeric(14,3) | obligatoria |  |  |
| `precio_lista` | numeric(14,2) |  |  |  |
| `precio_unitario` | numeric(14,2) | obligatoria |  |  |
| `descuento_pct` | numeric(6,3) | obligatoria | `0` |  |
| `descuento_valor` | numeric(14,2) | obligatoria | `0` |  |
| `subtotal` | numeric(14,2) | obligatoria | `0` |  |
| `total_linea` | numeric(14,2) | obligatoria | `0` |  |
| `peso` | numeric(14,3) | obligatoria | `0` |  |
| `impuesto_id` | integer |  |  |  |
| `impuesto_pct` | numeric(6,3) |  |  |  |
| `base_impuesto` | numeric(14,2) |  |  |  |
| `impuesto_valor` | numeric(14,2) |  |  |  |

### crm_pedidos

Tabla · — filas aprox. · 60 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_pedidos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `numero` · `idpedido_lipgo` (parcial)

**Se liga a:** `cotizacion_id` → `crm_cotizaciones`(id) · `motivo_rechazo_id` → `crm_motivos`(id) · `owner_id` → `crm_owners`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_pedidos_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `numero` | text |  |  |  |
| `cotizacion_id` | bigint |  |  |  |
| `cliente_id` | integer | obligatoria |  |  |
| `bodega_id` | integer |  |  |  |
| `vendedor_id` | integer |  |  |  |
| `fecha` | date | obligatoria | `CURRENT_DATE` |  |
| `fecha_programada` | date |  |  |  |
| `forma_pago` | text | obligatoria | `'contado'::text` |  |
| `dias_credito` | integer | obligatoria | `0` |  |
| `condicion_pago_id` | integer |  |  |  |
| `tipo_despacho_id` | integer |  |  |  |
| `orden_compra` | text |  |  |  |
| `destino` | text |  |  |  |
| `direccion` | text |  |  |  |
| `subtotal` | numeric(14,2) | obligatoria | `0` |  |
| `descuento_valor` | numeric(14,2) | obligatoria | `0` |  |
| `iva_pct` | numeric(6,3) | obligatoria |  |  |
| `iva_valor` | numeric(14,2) | obligatoria | `0` |  |
| `total` | numeric(14,2) | obligatoria | `0` |  |
| `peso_total` | numeric(14,3) | obligatoria | `0` |  |
| `estado` | text | obligatoria | `'borrador'::text` |  |
| `auth_contabilidad_por` | uuid |  |  |  |
| `auth_contabilidad_nombre` | text |  |  |  |
| `auth_contabilidad_en` | timestamp with time zone |  |  |  |
| `auth_contabilidad_nota` | text |  |  |  |
| `auth_gerencia_por` | uuid |  |  |  |
| `auth_gerencia_nombre` | text |  |  |  |
| `auth_gerencia_en` | timestamp with time zone |  |  |  |
| `auth_gerencia_nota` | text |  |  |  |
| `rechazado_por` | uuid |  |  |  |
| `rechazado_nombre` | text |  |  |  |
| `rechazado_en` | timestamp with time zone |  |  |  |
| `motivo_rechazo` | text |  |  |  |
| `idpedido_lipgo` | integer |  |  | pedidoscabecera.idpedido una vez proyectado. NULL = todavia no viajo a LIPgo. |
| `enviado_lipgo_en` | timestamp with time zone |  |  |  |
| `enviado_lipgo_por` | uuid |  |  |  |
| `error_lipgo` | text |  |  | Motivo por el que fallo la proyeccion (tipicamente, un producto cuyo nombre no existe en el catalogo de LIPgo). |
| `pdf_url` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `creado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `owner_id` | integer |  |  |  |
| `idempresa_despacho` | integer |  |  |  |
| `requiere_sobrecupo` | boolean | obligatoria | `false` |  |
| `sobrecupo_valor` | numeric(14,2) | obligatoria | `0` | Cuanto excede el cupo del cliente si se aprueba. Se calcula al solicitar aprobacion y lo ven Cartera y Gerencia (PED-04). |
| `cupo_snapshot` | numeric(14,2) |  |  |  |
| `saldo_snapshot` | numeric(14,2) |  |  |  |
| `vencido_snapshot` | numeric(14,2) |  |  |  |
| `dias_mora_snapshot` | integer |  |  |  |
| `solicitado_por` | uuid |  |  |  |
| `solicitado_nombre` | text |  |  |  |
| `solicitado_en` | timestamp with time zone |  |  |  |
| `version` | integer | obligatoria | `1` |  |
| `motivo_rechazo_id` | integer |  |  |  |
| `sap_estado` | text | obligatoria | `'no_aplica'::text` | Estado del envio a SAP, independiente del estado del pedido: para INDUPAN, SAP y LIPgo van en paralelo (PED-23). |
| `sap_referencia` | text |  |  |  |
| `sap_error` | text |  |  |  |

### crm_prospecto_interes

Tabla · — filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_prospecto_interes is '...'`._

**Llave primaria:** `id`

**Se liga a:** `prospecto_id` → `crm_prospectos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_prospecto_interes_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `prospecto_id` | bigint | obligatoria |  |  |
| `producto_id` | integer |  |  |  |
| `producto_nombre` | text | obligatoria |  |  |
| `cantidad` | numeric(14,3) |  |  |  |
| `unidad` | text |  |  |  |
| `frecuencia` | text |  |  |  |
| `precio_referencia` | numeric(14,2) |  |  | Lo que el prospecto dice pagar hoy a su proveedor actual. Es la informacion mas util para armar la propuesta. |
| `observacion` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_prospectos

Tabla · — filas aprox. · 61 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_prospectos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo` · `enlace_hash` (parcial)

**Se liga a:** `etapa_id` → `crm_etapas`(id) · `motivo_rechazo_id` → `crm_motivos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_prospectos_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `codigo` | text |  |  |  |
| `razon_social` | text | obligatoria |  |  |
| `nombre_comercial` | text |  |  |  |
| `documento` | text |  |  |  |
| `tipo_documento` | text |  |  |  |
| `contacto_nombre` | text |  |  |  |
| `contacto_cargo` | text |  |  |  |
| `contacto_celular` | text |  |  |  |
| `contacto_telefono` | text |  |  |  |
| `contacto_email` | text |  |  |  |
| `direccion` | text |  |  |  |
| `barrio` | text |  |  |  |
| `ciudad` | text |  |  |  |
| `departamento` | text |  |  |  |
| `latitud` | numeric(10,7) |  |  |  |
| `longitud` | numeric(10,7) |  |  |  |
| `gps_precision_m` | numeric(8,2) |  |  | Exactitud en metros que reporta el navegador. Por encima de ~100 m casi seguro es ubicacion por IP, no GPS: la UI lo advierte. |
| `gps_capturado_en` | timestamp with time zone |  |  |  |
| `etapa_id` | integer | obligatoria |  |  |
| `vendedor_id` | integer |  |  |  |
| `valor_estimado` | numeric(14,2) | obligatoria | `0` |  |
| `probabilidad_manual` | numeric(5,2) |  |  | Si esta, manda sobre la probabilidad de la etapa. Para el caso en que el vendedor sabe algo que el embudo no. |
| `fuente` | text |  |  |  |
| `proxima_accion` | text |  |  |  |
| `proxima_fecha` | date |  |  |  |
| `proxima_hora` | time without time zone |  |  |  |
| `motivo_perdida` | text |  |  |  |
| `fecha_cierre` | date |  |  |  |
| `cliente_id` | integer |  |  | Se llena al ganar el prospecto. Conserva el rastro de como se consiguio el cliente. |
| `convertido_en` | timestamp with time zone |  |  |  |
| `observaciones` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_por` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `estado_aprobacion` | text | obligatoria | `'borrador'::text` |  |
| `version` | integer | obligatoria | `1` |  |
| `cupo_solicitado` | numeric(14,2) |  |  |  |
| `dias_credito_solicitado` | integer |  |  |  |
| `solicitado_por` | uuid |  |  |  |
| `solicitado_nombre` | text |  |  |  |
| `solicitado_en` | timestamp with time zone |  |  |  |
| `solicitud_nota` | text |  |  |  |
| `aprobado_por` | uuid |  |  |  |
| `aprobado_nombre` | text |  |  |  |
| `aprobado_en` | timestamp with time zone |  |  |  |
| `aprobacion_nota` | text |  |  |  |
| `rechazado_por` | uuid |  |  |  |
| `rechazado_nombre` | text |  |  |  |
| `rechazado_en` | timestamp with time zone |  |  |  |
| `motivo_rechazo_id` | integer |  |  |  |
| `motivo_rechazo` | text |  |  |  |
| `sucursal_id` | integer |  |  |  |
| `sap_estado` | text | obligatoria | `'no_aplica'::text` |  |
| `sap_referencia` | text |  |  |  |
| `sap_error` | text |  |  |  |
| `enlace_hash` | text |  |  |  |
| `enlace_vence` | timestamp with time zone |  |  |  |
| `enlace_creado_nombre` | text |  |  |  |

### crm_recaudo_aplicaciones

Tabla · — filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_recaudo_aplicaciones is '...'`._

**Llave primaria:** `id`

**Unicidad:** `recaudo_id` + `cuenta_cobrar_id`

**Se liga a:** `cuenta_cobrar_id` → `crm_cuentas_cobrar`(id) · `recaudo_id` → `crm_recaudos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_recaudo_aplicaciones_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `recaudo_id` | bigint | obligatoria |  |  |
| `cuenta_cobrar_id` | bigint | obligatoria |  |  |
| `valor_aplicado` | numeric(14,2) | obligatoria |  |  |
| `valor_descuento` | numeric(14,2) | obligatoria | `0` |  |
| `saldo_anterior` | numeric(14,2) |  |  |  |
| `saldo_posterior` | numeric(14,2) |  |  |  |
| `orden` | integer | obligatoria | `1` |  |
| `modo` | text | obligatoria | `'auto'::text` |  |
| `aplicado` | boolean | obligatoria | `false` |  |

### crm_recaudos

Tabla · — filas aprox. · 39 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_recaudos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `numero` (parcial)

**Se liga a:** `banco_id` → `crm_bancos`(id) · `comprobante_id` → `crm_documentos`(id) · `cuenta_destino_id` → `crm_cuentas_destino`(id) · `medio_pago_id` → `crm_medios_pago`(id) · `motivo_rechazo_id` → `crm_motivos`(id) · `owner_id` → `crm_owners`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_recaudos_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `numero` | text |  |  |  |
| `cliente_id` | integer | obligatoria |  |  |
| `owner_id` | integer |  |  |  |
| `vendedor_id` | integer |  |  |  |
| `fecha_documento` | date | obligatoria |  |  |
| `valor` | numeric(14,2) | obligatoria |  |  |
| `medio_pago_id` | integer |  |  |  |
| `banco_id` | integer |  |  |  |
| `cuenta_destino_id` | integer |  |  |  |
| `referencia` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `comprobante_id` | bigint |  |  |  |
| `ocr` | jsonb |  |  |  |
| `ocr_alertas` | text[] | obligatoria | `'{}'::text[]` |  |
| `estado` | text | obligatoria | `'pendiente_aprobacion'::text` |  |
| `version` | integer | obligatoria | `1` |  |
| `registrado_por` | uuid |  |  |  |
| `registrado_nombre` | text |  |  |  |
| `registrado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `aprobado_por` | uuid |  |  |  |
| `aprobado_nombre` | text |  |  |  |
| `aprobado_en` | timestamp with time zone |  |  |  |
| `rechazado_por` | uuid |  |  |  |
| `rechazado_nombre` | text |  |  |  |
| `rechazado_en` | timestamp with time zone |  |  |  |
| `motivo_rechazo_id` | integer |  |  |  |
| `motivo_rechazo` | text |  |  |  |
| `anulado_nombre` | text |  |  |  |
| `anulado_en` | timestamp with time zone |  |  |  |
| `motivo_anulacion` | text |  |  |  |
| `total_aplicado` | numeric(14,2) | obligatoria | `0` |  |
| `saldo_favor_valor` | numeric(14,2) | obligatoria | `0` |  |
| `sap_estado` | text | obligatoria | `'no_aplica'::text` |  |
| `sap_referencia` | text |  |  |  |
| `sap_error` | text |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_reglas_comision

Tabla · — filas aprox. · 14 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_reglas_comision is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_reglas_comision_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `nombre` | text | obligatoria |  |  |
| `ambito` | text | obligatoria |  |  |
| `ambito_valor` | text |  |  |  |
| `porcentaje` | numeric(6,3) | obligatoria |  |  |
| `base` | text | obligatoria | `'subtotal'::text` |  |
| `momento` | text | obligatoria | `'recaudo'::text` | Cuando se causa: recaudo (al pagar el cliente), despacho o autorizacion. El valor por defecto sale del parametro comision.momento_causacion. |
| `monto_minimo` | numeric(14,2) | obligatoria | `0` |  |
| `vigente_desde` | date | obligatoria | `CURRENT_DATE` |  |
| `vigente_hasta` | date |  |  |  |
| `prioridad` | integer | obligatoria | `0` | Ante varias reglas aplicables gana la de mayor prioridad. Permite excepciones sin borrar la regla general. |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_saldos_favor

Tabla · — filas aprox. · 10 columnas

Lo que un cliente pago de mas (REC-17). Queda a su favor, visible en su cuenta, hasta que se aplique a una factura nueva.

**Llave primaria:** `id`

**Se liga a:** `owner_id` → `crm_owners`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_saldos_favor_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `cliente_id` | integer | obligatoria |  |  |
| `owner_id` | integer |  |  |  |
| `recaudo_id` | bigint |  |  |  |
| `valor` | numeric(14,2) | obligatoria |  |  |
| `valor_aplicado` | numeric(14,2) | obligatoria | `0` |  |
| `saldo` | numeric(14,2) | **GENERADA** |  |  |
| `anulado_en` | timestamp with time zone |  |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_sap_mapeo

Tabla · — filas aprox. · 8 columnas

Equivalencia id del CRM/LIPgo ↔ codigo de SAP. Solo la usa el traductor al enviar; nunca es llave del CRM (INT-06).

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `entidad` + `entidad_id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('crm_sap_mapeo_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `entidad` | text | obligatoria |  |  |
| `entidad_id` | bigint | obligatoria |  |  |
| `codigo_sap` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `actualizado_por` | text |  |  |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_sesiones

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.crm_sesiones is '...'`._

**Llave primaria:** `id`

**Se liga a:** `usuario_id` → `crm_usuarios`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `usuario_id` | uuid | obligatoria |  |  |
| `creada_en` | timestamp with time zone | obligatoria | `now()` |  |
| `expira_en` | timestamp with time zone | obligatoria |  |  |
| `revocada_en` | timestamp with time zone |  |  |  |
| `ip` | text |  |  |  |
| `user_agent` | text |  |  |  |

### crm_tipos_documento

Tabla · — filas aprox. · 9 columnas

Que documentos se piden en cada caso. Configurable: la lista de documentos obligatorios de un prospecto (PRO-01) se ajusta aqui, no en el codigo.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `entidad` + `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('crm_tipos_documento_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `entidad` | text | obligatoria |  |  |
| `codigo` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `obligatorio` | boolean | obligatoria | `false` |  |
| `ayuda` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `orden` | integer | obligatoria | `0` |  |

### crm_usuarios

Tabla · — filas aprox. · 19 columnas

Usuarios del CRM. Independientes de LIPgo (no usan auth.users ni profiles). Ver scripts/209.

**Llave primaria:** `id`

**Unicidad:**  · 

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `usuario` | text | obligatoria |  |  |
| `email` | text | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `password_hash` | text | obligatoria |  |  |
| `empresa_id` | integer | obligatoria | `1` |  |
| `empresas_acceso` | integer[] | obligatoria | `'{}'::integer[]` |  |
| `owners_acceso` | text[] | obligatoria | `'{}'::text[]` |  |
| `permisos` | jsonb | obligatoria | `'{}'::jsonb` |  |
| `activo` | boolean | obligatoria | `true` |  |
| `debe_cambiar_clave` | boolean | obligatoria | `true` |  |
| `intentos_fallidos` | integer | obligatoria | `0` |  |
| `bloqueado_hasta` | timestamp with time zone |  |  |  |
| `ultimo_ingreso` | timestamp with time zone |  |  |  |
| `clave_cambiada_en` | timestamp with time zone |  |  |  |
| `origen` | text | obligatoria | `'crm'::text` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `creado_por` | uuid |  |  |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### crm_vendedores_detalle

Tabla · — filas aprox. · 18 columnas

Datos comerciales del vendedor. Tabla aparte de `vendedores` para no modificar una tabla que LIPgo ya usa.

**Llave primaria:** `vendedor_id`

**Unicidad:** `usuario_id` (parcial)

**Se liga a:** `vendedor_id` → `vendedores`(idvendedor)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `vendedor_id` 🔑 | integer | obligatoria |  |  |
| `idempresa` | integer | obligatoria | `1` |  |
| `usuario_id` | uuid |  |  | profiles.id del vendedor. Si esta, el CRM le muestra solo lo suyo. |
| `zona` | text |  |  |  |
| `ciudad_base` | text |  |  |  |
| `meta_mensual` | numeric(14,2) | obligatoria | `0` |  |
| `comision_propia` | numeric(6,3) |  |  | Tasa individual. Si es NULL se aplica la regla de crm_reglas_comision que corresponda. |
| `fecha_ingreso` | date |  |  |  |
| `fecha_retiro` | date |  |  |  |
| `telefono` | text |  |  |  |
| `email` | text |  |  |  |
| `foto_url` | text |  |  |  |
| `latitud` | numeric(10,7) |  |  | Punto de partida de sus rutas. Sin esto, el planificador arranca desde la primera parada. |
| `longitud` | numeric(10,7) |  |  |  |
| `observaciones` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### dashboard

Vista · — filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.dashboard is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | smallint |  |  |  |
| `orden` | text |  |  |  |
| `peso_orden` | numeric |  |  |  |
| `tipo_producto` | text |  |  |  |
| `placa` | text |  |  |  |
| `tipo_operacion` | text |  |  |  |
| `hora_orden` | time without time zone |  |  |  |
| `hora_pesaje_inicial` | time without time zone |  |  |  |
| `hora_lote` | time without time zone |  |  |  |
| `hora_registro_sanitario` | time without time zone |  |  |  |
| `hora_vehiculo` | time without time zone |  |  |  |
| `hora_inicio_cargue` | time without time zone |  |  |  |
| `hora_fin_cargue` | time without time zone |  |  |  |
| `hora_pesaje_final` | time without time zone |  |  |  |
| `estado` | text |  |  |  |
| `duracion_minutos` | numeric |  |  |  |

### dashboardoperaciones

Vista · — filas aprox. · 20 columnas

_Sin descripción. Se escribe en la base con `comment on table public.dashboardoperaciones is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | smallint |  |  |  |
| `ordendecargue` | text |  |  |  |
| `fechaorden` | date |  |  |  |
| `fechacargue` | date |  |  |  |
| `placa` | text |  |  |  |
| `tipooperacion` | text |  |  |  |
| `pesoorden` | numeric |  |  |  |
| `horaorden` | time without time zone |  |  |  |
| `horavehiculo` | time without time zone |  |  |  |
| `horalote` | time without time zone |  |  |  |
| `horasanitario` | time without time zone |  |  |  |
| `pesajeinicial` | time without time zone |  |  |  |
| `pesajefinal` | time without time zone |  |  |  |
| `iniciocargue` | time without time zone |  |  |  |
| `fincargue` | time without time zone |  |  |  |
| `cliente` | text |  |  |  |
| `estado` | text |  |  |  |
| `tiempo_en_proceso` | time without time zone |  |  |  |
| `en_pausa` | boolean |  |  |  |
| `total_tiempo_pausado` | time(0) without time zone |  |  |  |

### dashboardoperacionesgerencia

Vista · — filas aprox. · 25 columnas

_Sin descripción. Se escribe en la base con `comment on table public.dashboardoperacionesgerencia is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | smallint |  |  |  |
| `ordendecargue` | text |  |  |  |
| `fechaorden` | date |  |  |  |
| `fechacargue` | date |  |  |  |
| `placa` | text |  |  |  |
| `tipooperacion` | text |  |  |  |
| `pesovascula` | numeric |  |  |  |
| `horaorden` | time without time zone |  |  |  |
| `horavehiculo` | time without time zone |  |  |  |
| `horalote` | time without time zone |  |  |  |
| `horasanitario` | time without time zone |  |  |  |
| `pesajeinicial` | time without time zone |  |  |  |
| `pesajefinal` | time without time zone |  |  |  |
| `iniciocargue` | time without time zone |  |  |  |
| `fincargue` | time without time zone |  |  |  |
| `cliente` | text |  |  |  |
| `estado` | text |  |  |  |
| `tiempo_llegada_a_pesaje_min` | numeric |  |  |  |
| `tiempo_pesaje_a_orden_min` | numeric |  |  |  |
| `tiempo_orden_a_lote_min` | numeric |  |  |  |
| `tiempo_lote_a_inicio_min` | numeric |  |  |  |
| `tiempo_cargue_neto_min` | numeric |  |  |  |
| `tiempo_fin_a_pesaje_final_min` | numeric |  |  |  |
| `tiempo_total_operacion_min` | numeric |  |  |  |
| `tiempo_en_proceso_min` | numeric |  |  |  |

### demanda_puesto

Tabla · 1 filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.demanda_puesto is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `puesto` + `turno_codigo` (parcial) · `idempresa` + `puesto` + `turno_codigo` + `fecha` (parcial) · `idempresa` + `puesto` + `hora_inicio` (parcial) · `idempresa` + `puesto` + `hora_inicio` + `fecha` (parcial)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('demanda_puesto_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `puesto` | text | obligatoria |  |  |
| `turno_codigo` | text |  |  |  |
| `fecha` | date |  |  | NULL = demanda base de todos los días. Con fecha = excepción solo de ese día. |
| `requeridos` | integer | obligatoria | `0` |  |
| `nota` | text |  |  |  |
| `actualizado_por` | text |  |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `hora_inicio` | text |  |  | Hora de entrada real ("HH:MM") del horario para el que se declara la demanda. Reemplaza a turno_codigo (que queda solo como histórico). |

### despachotraslados

Vista · — filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.despachotraslados is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | smallint |  |  |  |
| `idproducto` | smallint |  |  |  |
| `nombreproducto` | text |  |  |  |
| `lote` | text |  |  |  |
| `location` | text |  |  |  |
| `cantidad` | numeric |  |  |  |
| `creado` | timestamp with time zone |  |  |  |
| `creadopor` | text |  |  |  |
| `codproducto` | text |  |  |  |
| `ocargue` | text |  |  |  |
| `cliente` | text |  |  |  |
| `aprobadopor` | text |  |  |  |
| `placa` | text |  |  |  |
| `id` | smallint |  |  |  |
| `tipoproducto` | text |  |  |  |

### destinos

Tabla · 905 filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.destinos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `activo` | text |  |  |  |
| `departamento` | text |  |  |  |

### detalleoc

Tabla · 23.804 filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.detalleoc is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idorden` → `cabeceraoc`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idorden` | bigint | obligatoria |  |  |
| `numeroorden` | text |  |  |  |
| `producto` | text |  |  |  |
| `cantidad` | numeric |  |  |  |
| `toneladas` | numeric |  |  |  |
| `cliente` | text |  |  |  |
| `lote` | text |  |  |  |

### distribucion_placas

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.distribucion_placas is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `placa` | text | obligatoria |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `observacion` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### dotacion_epp

Tabla · 54 filas aprox. · 14 columnas

_Sin descripción. Se escribe en la base con `comment on table public.dotacion_epp is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `extensions.uuid_generate_v4()` |  |
| `colaborador_id` | text |  |  |  |
| `fecha_entrega` | date |  |  |  |
| `tipo_item` | text |  |  |  |
| `item` | text |  |  |  |
| `talla` | text |  |  |  |
| `cantidad` | integer |  |  |  |
| `estado` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `tallapant` | numeric |  |  |  |
| `evidenciaepp` | text |  |  |  |
| `idempresa` | smallint |  |  |  |

### empresas

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.empresas is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `nombre` | text | obligatoria |  |  |
| `id` 🔑 | smallint | obligatoria |  |  |
| `ciudad` | text |  |  |  |
| `nit` | text |  |  |  |
| `direccion` | text |  |  |  |
| `logo` | text |  |  |  |
| `indicativo` | text |  |  |  |

### empresas_permisos

Tabla · — filas aprox. · 7 columnas

This is a duplicate of empresas

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `nombre` | text | obligatoria |  |  |
| `id` 🔑 | smallint | obligatoria |  |  |
| `ciudad` | text |  |  |  |
| `nit` | text |  |  |  |
| `direccion` | text |  |  |  |
| `logo` | text |  |  |  |
| `indicativo` | text |  |  |  |

### entrevistas

Tabla · — filas aprox. · 28 columnas

_Sin descripción. Se escribe en la base con `comment on table public.entrevistas is '...'`._

**Llave primaria:** `id`

**Se liga a:** `hoja_vida_id` → `hojas_de_vida`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `hoja_vida_id` | uuid |  |  |  |
| `nombre_candidato` | text | obligatoria |  |  |
| `cedula` | text |  |  |  |
| `correo` | text |  |  |  |
| `telefono` | text |  |  |  |
| `edad` | text |  |  |  |
| `fecha_nacimiento` | text |  |  |  |
| `lugar_nacimiento` | text |  |  |  |
| `procedencia` | text |  |  |  |
| `direccion` | text |  |  |  |
| `contacto_emergencia_nombre` | text |  |  |  |
| `contacto_emergencia_parentesco` | text |  |  |  |
| `contacto_emergencia_telefono` | text |  |  |  |
| `sabe_leer_escribir` | text |  |  |  |
| `talla_pantalon` | text |  |  |  |
| `talla_camisa` | text |  |  |  |
| `institucion_educativa` | text |  |  |  |
| `nivel_educativo` | text |  |  |  |
| `ano_ingreso` | text |  |  |  |
| `ano_finalizacion` | text |  |  |  |
| `experiencia_laboral` | jsonb | obligatoria | `'[]'::jsonb` |  |
| `observaciones` | text |  |  |  |
| `concepto_final` | text | obligatoria | `'aplazado'::text` |  |
| `entrevistador` | text |  |  |  |
| `fecha_entrevista` | date |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### equipos_integrantes

Tabla · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.equipos_integrantes is '...'`._

**Llave primaria:** `id`

**Unicidad:** `equipo_id` + `identificacion`

**Se liga a:** `equipo_id` → `equipos_trabajo`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('equipos_integrantes_id_seq'::regclass)` |  |
| `equipo_id` | integer | obligatoria |  |  |
| `identificacion` | text | obligatoria |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### equipos_trabajo

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.equipos_trabajo is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `nombre`

**Se liga a:** `patron_id` → `patrones_rotacion`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('equipos_trabajo_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `area` | text |  |  |  |
| `patron_id` | integer |  |  |  |
| `color` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### estado_linea

Tabla · 1 filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.estado_linea is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria |  |  |
| `producto_id` | integer |  |  |  |
| `bultos_lote` | integer |  |  |  |
| `bultos_dia` | numeric |  |  |  |
| `estado` | text |  |  |  |
| `ultima_actualizacion` | timestamp without time zone |  |  |  |

### evaluaciones_desempeno

Tabla · 101 filas aprox. · 25 columnas

_Sin descripción. Se escribe en la base con `comment on table public.evaluaciones_desempeno is '...'`._

**Llave primaria:** `id`

**Se liga a:** `colaborador_id` → `headcount`(id) · `evaluador_id` → `users`(id) · `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `colaborador_id` | bigint |  |  |  |
| `idempresa` | smallint |  |  |  |
| `evaluador_id` | uuid |  |  |  |
| `p1_seguridad_normas` | integer |  |  |  |
| `p2_seguridad_conducta` | integer |  |  |  |
| `p3_productividad_metas` | integer |  |  |  |
| `p4_productividad_ritmo` | integer |  |  |  |
| `p5_calidad_mercancia` | integer |  |  |  |
| `p6_calidad_precision` | integer |  |  |  |
| `p7_disciplina_puntualidad` | integer |  |  |  |
| `p8_disciplina_asistencia` | integer |  |  |  |
| `p9_disciplina_instrucciones` | integer |  |  |  |
| `p10_actitud_equipo` | integer |  |  |  |
| `p11_actitud_disposicion` | integer |  |  |  |
| `p12_actitud_proactividad` | integer |  |  |  |
| `p13_continuidad` | text |  |  |  |
| `p14_nivel_riesgo` | text |  |  |  |
| `p15_decision_sugerida` | text |  |  |  |
| `p16_recontrataria` | text |  |  |  |
| `porcentaje_riesgo` | numeric |  |  |  |
| `firma_coordinador` | text |  |  |  |
| `comentarios_adicionales` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `puntaje_total` | numeric |  |  |  |

### examenes_medicos

Tabla · 116 filas aprox. · 18 columnas

_Sin descripción. Se escribe en la base con `comment on table public.examenes_medicos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `entrevista_id` → `entrevistas`(id) · `hoja_vida_id` → `hojas_de_vida`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `entrevista_id` | uuid |  |  |  |
| `hoja_vida_id` | uuid |  |  |  |
| `cedula` | text |  |  |  |
| `nombre` | text | obligatoria |  |  |
| `tipo_examen` | text |  |  |  |
| `resultado` | text |  |  |  |
| `fecha_examen` | date |  |  |  |
| `observaciones` | text |  |  |  |
| `archivo_url` | text | obligatoria |  |  |
| `archivo_nombre` | text | obligatoria |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |
| `apto` | boolean |  |  |  |
| `costo` | numeric(14,2) |  | `0` |  |
| `promovido` | boolean |  | `false` |  |
| `fuente` | text |  | `'candidato'::text` |  |
| `vigente` | boolean |  | `true` |  |

### facturacion

Vista · — filas aprox. · 18 columnas

_Sin descripción. Se escribe en la base con `comment on table public.facturacion is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `numeroorden` | text |  |  |  |
| `tiquetebascula` | text |  |  |  |
| `placa` | text |  |  |  |
| `fechacargue` | date |  |  |  |
| `pesobascula` | numeric |  |  |  |
| `cliente` | text |  |  |  |
| `producto` | text |  |  |  |
| `toneladas` | numeric |  |  |  |
| `owner` | text |  |  |  |
| `subcategoria` | text |  |  |  |
| `idempresa` | smallint |  |  |  |
| `fechaorden` | date |  |  |  |
| `transporte` | text |  |  |  |
| `tipooperacion` | text |  |  |  |
| `tarifa` | text |  |  |  |
| `valor_a_facturar` | text |  |  |  |
| `idorden` | bigint |  |  |  |
| `cantidad` | numeric |  |  |  |

### facturacion_filtros

Vista · — filas aprox. · 2 columnas

_Sin descripción. Se escribe en la base con `comment on table public.facturacion_filtros is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `tipo` | text |  |  |  |
| `valor` | text |  |  |  |

### facturacionturnos

Vista · — filas aprox. · 23 columnas

_Sin descripción. Se escribe en la base con `comment on table public.facturacionturnos is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | bigint |  |  |  |
| `fecha` | date |  |  |  |
| `nombre` | text |  |  |  |
| `identificacion` | text |  |  |  |
| `puesto` | text |  |  |  |
| `asistencia` | text |  |  |  |
| `hed` | numeric |  |  |  |
| `hedf` | numeric |  |  |  |
| `hen` | numeric |  |  |  |
| `hef` | numeric |  |  |  |
| `hn` | numeric |  |  |  |
| `idempresa` | smallint |  |  |  |
| `especialidad` | text |  |  |  |
| `tarifaturno` | numeric |  |  |  |
| `tarifahoraextra` | numeric |  |  |  |
| `costoturno` | numeric |  |  |  |
| `costohoraextra` | numeric |  |  |  |
| `estado_tarifa` | text |  |  |  |
| `valorextra` | numeric |  |  |  |
| `facturacion_total` | numeric |  |  |  |
| `costoextra` | numeric |  |  |  |
| `costo_total` | numeric |  |  |  |
| `utilidad` | numeric |  |  |  |

### facturar_registro

Tabla · 107 filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.facturar_registro is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('facturar_registro_id_seq'::regclass)` |  |
| `orden_id` | integer |  |  |  |
| `ordendecargue` | text |  |  |  |
| `idempresa` | integer |  |  |  |
| `tipooperacion` | text |  |  |  |
| `placa` | text |  |  |  |
| `facturar` | boolean |  |  |  |
| `usuario` | text |  |  |  |
| `motivo` | text |  |  |  |
| `modulo` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### festivos

Tabla · — filas aprox. · 2 columnas

_Sin descripción. Se escribe en la base con `comment on table public.festivos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fecha` | date | obligatoria |  |  |

### gastos

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.gastos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `id_empresa` → `empresas`(id) · `registrado_por` → `users`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `id_empresa` | smallint |  |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `categoria` | text | obligatoria |  |  |
| `monto` | numeric(15,2) | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `url_soporte` | text |  |  |  |
| `registrado_por` | uuid |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `creado_por` | text |  |  |  |

### grupos

Tabla · — filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.grupos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `activo` | text |  |  |  |

### headcount

Tabla · 140 filas aprox. · 43 columnas

_Sin descripción. Se escribe en la base con `comment on table public.headcount is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint |  |  |  |
| `identificacion` | text |  |  |  |
| `nombre` | text |  |  |  |
| `hoja_de_vida` | text |  |  |  |
| `copia_doc_id` | text |  |  |  |
| `afiliacion_arl` | text |  |  |  |
| `afiliacion_eps` | text |  |  |  |
| `afiliacion_afp` | text |  |  |  |
| `afiliacion_caja` | text |  |  |  |
| `cert_laborales` | text |  |  |  |
| `cert_personales` | text |  |  |  |
| `antecedentes` | text |  |  |  |
| `doc_beneficia` | text |  |  |  |
| `examenes_ing` | text |  |  |  |
| `cert_m_alimentos` | text |  |  |  |
| `cert_eva_med` | text |  |  |  |
| `acta_dotacion` | text |  |  |  |
| `cert_cuenta` | text |  |  |  |
| `estado` | text |  |  |  |
| `contrato` | text |  |  |  |
| `sst` | text |  |  |  |
| `induccion` | text |  |  |  |
| `contratosiigo` | text |  |  |  |
| `correo` | text |  |  |  |
| `celular` | text |  |  |  |
| `fechainicio` | date |  |  |  |
| `salario` | numeric |  |  |  |
| `cargo` | text |  |  |  |
| `evidenciaepp` | text |  |  |  |
| `aplicaplano` | boolean |  |  |  |
| `admin` | boolean |  |  |  |
| `reglamentocheck` | boolean |  |  |  |
| `fecha_retiro` | date |  |  |  |
| `motivo_retiro` | text |  |  |  |
| `ciudad` | text |  |  |  |
| `administradora_pension` | text |  |  |  |
| `administradora_salud` | text |  |  |  |
| `administradora_caja` | text |  |  |  |
| `tipo_cotizante` | text |  |  |  |
| `subtipo_cotizante` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `actividad_economica` | text |  |  |  |

### historial_intervalos

Tabla · 54.532 filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.historial_intervalos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fecha_hora` | timestamp with time zone |  | `now()` |  |
| `bultos_dia_acumulado` | integer |  |  |  |
| `produccion_2min` | integer |  |  |  |

### historial_nomina

Tabla · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.historial_nomina is '...'`._

**Llave primaria:** `id`

**Se liga a:** `colaborador_id` → `headcount`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `colaborador_id` | bigint |  |  |  |
| `mes_anio` | text | obligatoria |  |  |
| `url_desprendible` | text | obligatoria |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### historialaprobaciones

Tabla · 2.973 filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.historialaprobaciones is '...'`._

**Llave primaria:** `id`

**Se liga a:** `empresaid` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `empresaid` | smallint | obligatoria |  |  |
| `codigo` | text |  |  |  |
| `producto` | text |  |  |  |
| `lote` | text |  |  |  |
| `almacen` | text |  |  |  |
| `location` | text |  |  |  |
| `cantidad` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `fechahorafab` | timestamp without time zone |  |  |  |
| `fechahoraaprob` | timestamp without time zone |  |  |  |
| `aprobadopor` | text |  |  |  |

### historicolotes

Tabla · 24.792 filas aprox. · 13 columnas

_Sin descripción. Se escribe en la base con `comment on table public.historicolotes is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `cliente` | text |  |  |  |
| `producto` | text |  |  |  |
| `lote` | text |  |  |  |
| `cantidad` | text |  |  |  |
| `ordendecargue` | text |  |  |  |
| `fecha` | date |  |  |  |
| `aprobadopor` | text |  |  |  |
| `location` | text |  |  |  |
| `pdf` | text |  |  |  |
| `placa` | text |  |  |  |
| `idorden` | bigint |  |  | Orden de cargue de esta asignacion de lote, por id (cabeceraoc.id). Ver invtrans.idorden. Script 251. |

### hojas_de_vida

Tabla · 71 filas aprox. · 18 columnas

_Sin descripción. Se escribe en la base con `comment on table public.hojas_de_vida is '...'`._

**Llave primaria:** `id`

**Unicidad:** `cedula`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `nombre_candidato` | text | obligatoria |  |  |
| `cargo_aspirado` | text |  |  |  |
| `correo` | text |  |  |  |
| `telefono` | text |  |  |  |
| `notas` | text |  |  |  |
| `archivo_url` | text | obligatoria |  |  |
| `archivo_nombre` | text | obligatoria |  |  |
| `archivo_tipo` | text |  |  |  |
| `archivo_tamano` | bigint |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |
| `cedula` | text |  |  |  |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `antecedentes_url` | text |  |  |  |
| `antecedentes_nombre` | text |  |  |  |
| `antecedentes_estado` | text |  |  |  |
| `antecedentes_score` | integer |  |  |  |

### horario_tolva

Tabla · 68 filas aprox. · 6 columnas

Ventana horaria de Turno 1/Turno 2 para Tolva, por día+empresa. Independiente del horario de entrada/salida normal de cada persona.

**Llave primaria:** `fecha`, `idempresa`, `turno`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `fecha` 🔑 | date | obligatoria |  |  |
| `idempresa` 🔑 | integer | obligatoria |  |  |
| `turno` 🔑 | smallint | obligatoria |  |  |
| `hora_inicio` | time without time zone | obligatoria |  |  |
| `hora_fin` | time without time zone | obligatoria |  |  |
| `actualizado_en` | timestamp with time zone | obligatoria | `now()` |  |

### indicador_historico

Tabla · 786 filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.indicador_historico is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo` + `periodo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria | `100` |  |
| `codigo` | text | obligatoria |  |  |
| `periodo` | text | obligatoria |  |  |
| `valor` | numeric |  |  |  |
| `meta` | numeric |  |  |  |
| `base` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### indicativo

Tabla · — filas aprox. · 7 columnas

This is a duplicate of empresas

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `nombre` | text | obligatoria |  |  |
| `id` 🔑 | smallint | obligatoria |  |  |
| `ciudad` | text |  |  |  |
| `nit` | text |  |  |  |
| `direccion` | text |  |  |  |
| `logo` | text |  |  |  |
| `indicativo` | text |  |  |  |

### inspeccion_sanitaria_vehiculos

Tabla · — filas aprox. · 20 columnas

_Sin descripción. Se escribe en la base con `comment on table public.inspeccion_sanitaria_vehiculos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `id_empresa` | smallint | obligatoria |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `hora_ingreso` | time without time zone |  |  |  |
| `actividad` | text |  |  |  |
| `transportador` | text |  |  |  |
| `placa_vehiculo` | text |  |  |  |
| `documentos_vehiculo` | boolean |  | `false` |  |
| `bpms_transportador` | boolean |  | `false` |  |
| `paredes_ok` | boolean |  | `false` |  |
| `piso_ok` | boolean |  | `false` |  |
| `estibas_ok` | boolean |  | `false` |  |
| `techo_carpa_ok` | boolean |  | `false` |  |
| `ausencia_plagas` | boolean |  | `false` |  |
| `ausencia_quimicos` | boolean |  | `false` |  |
| `observaciones` | text |  |  |  |
| `responsable` | text |  |  |  |
| `fotos` | text[] |  |  |  |
| `firma` | text | obligatoria |  |  |
| `fecha_creacion` | timestamp with time zone |  | `now()` |  |

### inspecciones_montacargas

Tabla · 698 filas aprox. · 44 columnas

_Sin descripción. Se escribe en la base con `comment on table public.inspecciones_montacargas is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |
| `fecha` | date | obligatoria |  |  |
| `turno` | character varying(50) | obligatoria |  |  |
| `referencia_montacargas` | character varying(100) | obligatoria |  |  |
| `placa` | character varying(50) | obligatoria |  |  |
| `nombre_operador` | character varying(150) | obligatoria |  |  |
| `licencia_vigente` | boolean | obligatoria | `false` |  |
| `certificado_mantenimiento` | boolean | obligatoria | `false` |  |
| `estado_salud_adecuado` | boolean | obligatoria | `false` |  |
| `sin_consumo_sustancias` | boolean | obligatoria | `false` |  |
| `espejos_laterales` | boolean | obligatoria | `false` |  |
| `alarma_reversa` | boolean | obligatoria | `false` |  |
| `extintor_incendio` | boolean | obligatoria | `false` |  |
| `llantas` | boolean | obligatoria | `false` |  |
| `cilindros_elevacion_direccion` | boolean | obligatoria | `false` |  |
| `montura_cilindros` | boolean | obligatoria | `false` |  |
| `estado_horquillas` | boolean | obligatoria | `false` |  |
| `estado_mastil` | boolean | obligatoria | `false` |  |
| `estado_mangueras` | boolean | obligatoria | `false` |  |
| `cadenas_elevacion_descenso` | boolean | obligatoria | `false` |  |
| `rejillas_apoyo_carga` | boolean | obligatoria | `false` |  |
| `luces_delanteras` | boolean | obligatoria | `false` |  |
| `luces_traseras` | boolean | obligatoria | `false` |  |
| `bateria` | boolean | obligatoria | `false` |  |
| `conexiones_electricas` | boolean | obligatoria | `false` |  |
| `cableado_electrico` | boolean | obligatoria | `false` |  |
| `espejo_retrovisor_interior` | boolean | obligatoria | `false` |  |
| `estado_cabina` | boolean | obligatoria | `false` |  |
| `sillas` | boolean | obligatoria | `false` |  |
| `pedales` | boolean | obligatoria | `false` |  |
| `alarma_retroceso` | boolean | obligatoria | `false` |  |
| `cinturones_seguridad` | boolean | obligatoria | `false` |  |
| `pito` | boolean | obligatoria | `false` |  |
| `timon_volante` | boolean | obligatoria | `false` |  |
| `frenos` | boolean | obligatoria | `false` |  |
| `palancas_control` | boolean | obligatoria | `false` |  |
| `freno_parque_mano` | boolean | obligatoria | `false` |  |
| `horometro_indicador` | boolean | obligatoria | `false` |  |
| `desviacion_identificada` | text |  |  |  |
| `idempresa` | smallint |  |  |  |
| `firma` | text |  |  |  |
| `identificacion_operador` | text |  |  |  |
| `hora_entrada_operador` | text |  |  |  |

### inv_ajustes_pendientes

Tabla · — filas aprox. · 17 columnas

_Sin descripción. Se escribe en la base con `comment on table public.inv_ajustes_pendientes is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('inv_ajustes_pendientes_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `codigo` | text | obligatoria |  |  |
| `payload` | jsonb | obligatoria |  |  |
| `producto` | text |  |  |  |
| `lote` | text |  |  |  |
| `location` | text |  |  |  |
| `cantidad` | numeric | obligatoria |  |  |
| `motivo` | text |  |  |  |
| `solicitado_por` | text | obligatoria |  |  |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `aprobado_por` | text |  |  |  |
| `aprobado_en` | timestamp with time zone |  |  |  |
| `motivo_rechazo` | text |  |  |  |
| `invtrans_ids` | jsonb |  |  |  |
| `log_id` | bigint |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### inv_clave_aprobacion_ajustes

Tabla · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.inv_clave_aprobacion_ajustes is '...'`._

**Llave primaria:** `id`

**Unicidad:** `clave`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('inv_clave_aprobacion_ajustes_id_seq'::regclass)` |  |
| `responsable` | text | obligatoria |  |  |
| `clave` | text | obligatoria |  |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### inv_clave_gerencia_proyecto

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.inv_clave_gerencia_proyecto is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `clave`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('inv_clave_gerencia_proyecto_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `responsable` | text | obligatoria |  |  |
| `clave` | text | obligatoria |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### inv_clave_movimiento

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.inv_clave_movimiento is '...'`._

**Llave primaria:** `id`

**Unicidad:** `clave`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('inv_clave_movimiento_id_seq'::regclass)` |  |
| `usuario_id` | uuid |  |  |  |
| `responsable` | text | obligatoria |  |  |
| `clave` | text | obligatoria |  |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### inv_correcciones_log

Tabla · 310 filas aprox. · 18 columnas

_Sin descripción. Se escribe en la base con `comment on table public.inv_correcciones_log is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('inv_correcciones_log_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `codigo` | text | obligatoria |  |  |
| `ref_invtrans_id` | bigint |  |  |  |
| `codproducto` | text |  |  |  |
| `producto` | text |  |  |  |
| `lote_origen` | text |  |  |  |
| `location_origen` | text |  |  |  |
| `codproducto_destino` | text |  |  |  |
| `producto_destino` | text |  |  |  |
| `lote_destino` | text |  |  |  |
| `location_destino` | text |  |  |  |
| `cantidad` | numeric | obligatoria |  |  |
| `motivo` | text |  |  |  |
| `realizado_por` | text | obligatoria |  |  |
| `autorizado_por` | text |  |  |  |
| `invtrans_ids` | jsonb |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### invglobal

Vista · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.invglobal is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | smallint |  |  |  |
| `idproducto` | smallint |  |  |  |
| `codproducto` | text |  |  |  |
| `nombreproducto` | text |  |  |  |
| `categoria` | text |  |  |  |
| `subcategoria` | text |  |  |  |
| `stock_global` | numeric |  |  |  |
| `stock_disp` | numeric |  |  |  |
| `stock_res` | numeric |  |  |  |

### invtrans

Tabla · 33.147 filas aprox. · 25 columnas

_Sin descripción. Se escribe en la base con `comment on table public.invtrans is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `idproducto` | smallint |  |  |  |
| `nombreproducto` | text |  |  |  |
| `lote` | text |  |  |  |
| `location` | text |  |  |  |
| `cantidad` | numeric |  |  |  |
| `tipomov` | text |  |  |  |
| `status` | text |  |  |  |
| `origen` | text |  |  |  |
| `creado` | timestamp with time zone |  |  |  |
| `creadopor` | text |  |  |  |
| `codproducto` | text |  |  |  |
| `ocargue` | text |  |  |  |
| `pdf` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `fechavencimiento` | date |  |  |  |
| `fechaprod` | date |  |  |  |
| `almacen` | text |  |  |  |
| `ordentolva` | text |  |  |  |
| `qrestiba` | numeric |  |  |  |
| `cod_movimiento` | text |  |  |  |
| `horaprod` | text |  |  | Hora real de produccion del lote, formato "HH:MM" (hora Colombia). La captura el formulario de Ingreso de Producción. Junto con `fechaprod` determina el turno en Liquidación Tolva; NO usar `creado`, que es la hora de registro. |
| `tipo_produccion` | text |  |  | Origen de la produccion: NULL = LIP (servicio facturable, valor de todo lo historico y de lo que sube el LOGO); 'Harinera' = produccion propia de Harinera, genera inventario pero NUNCA llega a cabeceraoc ni a facturacion. |
| `idorden` | bigint |  |  | Orden de cargue a la que pertenece el movimiento, por id (cabeceraoc.id). Es el vinculo FIABLE: `ocargue` es un codigo de texto y cabeceraoc tiene codigos repetidos. Nulo cuando el movimiento no viene de una orden, o cuando el codigo es ambiguo o huerfano. Script 251. |

### iso_clausulas

Tabla · — filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.iso_clausulas is '...'`._

**Llave primaria:** `id`

**Unicidad:** `numero`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `capitulo` | text |  |  |  |
| `numero` | text |  |  |  |
| `titulo` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `fuente_lipgo` | text |  |  |  |
| `metrica` | text |  |  |  |
| `codigo_sig` | text |  |  |  |
| `orden` | integer |  |  |  |
| `actualizado_en` | date |  |  |  |
| `evidencia_fecha` | date |  |  |  |
| `evidencia_nombre` | text |  |  |  |
| `evidencia_url` | text |  |  |  |
| `evidencia_path` | text |  |  | Ruta interna en Storage. Necesaria para reemplazar o borrar el archivo; la URL publica no sirve para eso. |
| `estado_manual` | text |  |  | Estado puesto a mano. Manda sobre el calculo automatico. NULL = usar el calculo. |
| `nota` | text |  |  |  |

### jornada_legal

Tabla · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.jornada_legal is '...'`._

**Llave primaria:** `fecha_desde`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `fecha_desde` 🔑 | date | obligatoria |  |  |
| `horas_dia` | numeric | obligatoria |  |  |
| `horas_semana` | numeric |  |  |  |
| `norma` | text |  |  |  |

### liquidaciones_retiro

Tabla · 35 filas aprox. · 17 columnas

_Sin descripción. Se escribe en la base con `comment on table public.liquidaciones_retiro is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `identificacion`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer |  |  |  |
| `identificacion` | text |  |  |  |
| `persona` | text |  |  |  |
| `fecha_retiro` | date |  |  |  |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `soporte_url` | text |  |  |  |
| `soporte_nombre` | text |  |  |  |
| `total_liquidado` | numeric |  |  |  |
| `fecha_liquidacion` | timestamp with time zone |  |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `pagado_hasta` | date |  |  |  |
| `cesantias_real` | numeric |  |  |  |
| `intereses_real` | numeric |  |  |  |
| `prima_real` | numeric |  |  |  |
| `vacaciones_real` | numeric |  |  |  |
| `indemnizacion_real` | numeric |  |  |  |

### liquidaciones_retiro_deducciones

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.liquidaciones_retiro_deducciones is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `identificacion` | text | obligatoria |  |  |
| `persona` | text |  |  |  |
| `concepto` | text | obligatoria |  |  |
| `valor` | numeric | obligatoria | `0` |  |
| `observacion` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### locations

Tabla · 305 filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.locations is '...'`._

**Llave primaria:** `id`

**Se liga a:** `bodega` → `almacenes`(id) · `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `codigo` | text |  |  |  |
| `nombre` | text |  |  |  |
| `Descripción` | text |  |  |  |
| `idempresa` | smallint |  |  |  |
| `activo` | text |  |  |  |
| `bodega` | bigint |  |  |  |
| `capacidad` | numeric |  |  |  |
| `letra` | text |  |  |  |
| `numero` | integer |  |  |  |

### materiales

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.materiales is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `codigo` | text |  |  |  |
| `nombre` | text |  |  |  |
| `proveedor` | text |  |  |  |
| `tipo` | text |  |  |  |
| `activo` | text |  |  |  |
| `undmedida` | text |  |  |  |

### medio

Tabla · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.medio is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `id_empresa` | smallint |  |  |  |
| `nombre` | text | obligatoria |  |  |
| `activo` | text |  |  |  |

### messages

Tabla · 55 filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.messages is '...'`._

**Llave primaria:** `id`

**Se liga a:** `receiver_id` → `profiles`(id) · `sender_id` → `users`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `content` | text | obligatoria |  |  |
| `sender_id` | uuid | obligatoria |  |  |
| `receiver_id` | uuid | obligatoria |  |  |
| `is_read` | boolean |  | `false` |  |
| `created_at` | timestamp with time zone | obligatoria | `timezone('utc'::text, now())` |  |

### meta_toneladas_proyecto

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.meta_toneladas_proyecto is '...'`._

**Llave primaria:** `idempresa`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` 🔑 | integer | obligatoria |  |  |
| `proyecto` | text |  |  |  |
| `toneladas_mes` | numeric | obligatoria | `0` |  |
| `dias_operacion` | numeric | obligatoria | `24.7` |  |
| `hc` | integer | obligatoria | `1` |  |
| `actualizado_at` | timestamp with time zone | obligatoria | `now()` |  |

### metadia

Vista · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.metadia is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `Fecha` | date |  |  |  |
| `IdEmpresa` | smallint |  |  |  |
| `Tipo de Producto` | text |  |  |  |
| `Tipo de Operacion` | text |  |  |  |
| `Total Viajes/Tickets` | bigint |  |  |  |
| `Total Toneladas Procesadas` | numeric |  |  |  |
| `Meta Dia` | numeric |  |  |  |
| `% Cumplimiento` | numeric |  |  |  |

### montacargas_alquiler

Tabla · — filas aprox. · 8 columnas

Costo y facturación mensual de alquiler de montacargas, por equipo y vigencia. Se ajusta anual por IPC.

**Llave primaria:** `id`

**Se liga a:** `equipo_id` → `sst_equipos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `equipo_id` | bigint | obligatoria |  |  |
| `proveedor` | text | obligatoria |  |  |
| `valor_pagado` | numeric | obligatoria |  |  |
| `valor_facturado` | numeric |  |  | NULL = este proyecto NO factura el alquiler aparte (va embebido en la facturación general, caso ID2). |
| `fechainicio` | date | obligatoria |  |  |
| `fechafin` | date | obligatoria |  |  |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |

### montacargas_documentos

Tabla · — filas aprox. · 12 columnas

Documentos con vigencia de un equipo (certificado de operación, póliza, factura). Producción · Gestión de Montacargas.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `equipo_id` | bigint | obligatoria |  |  |
| `tipo` | text | obligatoria |  |  |
| `numero` | text |  |  |  |
| `fecha_expedicion` | date |  |  |  |
| `fecha_vencimiento` | date |  |  |  |
| `archivo_url` | text |  |  |  |
| `archivo_nombre` | text |  |  |  |
| `observacion` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### montacargasdia

Tabla · 20 filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.montacargasdia is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fecha` | date | obligatoria |  |  |
| `idempresa` | numeric |  |  |  |
| `montacargas1` | boolean |  |  |  |
| `montacargas2` | boolean |  |  |  |
| `personas` | numeric |  |  |  |
| `aprueba` | text |  |  |  |
| `comentarios` | text |  |  |  |

### mptrans

Tabla · — filas aprox. · 19 columnas

This is a duplicate of invtrans

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `idproducto` | smallint |  |  |  |
| `nombreproducto` | text |  |  |  |
| `lote` | text |  |  |  |
| `location` | text |  |  |  |
| `cantidad` | numeric |  |  |  |
| `tipomov` | text |  |  |  |
| `status` | text |  |  |  |
| `origen` | text |  |  |  |
| `creado` | timestamp with time zone |  |  |  |
| `creadopor` | text |  |  |  |
| `codproducto` | text |  |  |  |
| `ocargue` | text |  |  |  |
| `pdf` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `fechavencimiento` | date |  |  |  |
| `fechaprod` | date |  |  |  |
| `almacen` | text |  |  |  |

### mrpexplosion

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.mrpexplosion is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `producto` | text |  |  |  |
| `idproducto` | smallint |  |  |  |
| `material` | text |  |  |  |
| `idmaterial` | smallint |  |  |  |
| `tipomaterial` | text |  |  |  |
| `consumo` | text |  |  |  |
| `unidad` | text |  |  |  |
| `codmat` | text |  |  |  |

### muelles_empresa

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.muelles_empresa is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `muelle`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `muelle` | integer | obligatoria |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `observacion` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### notificaciones_conductor_config

Tabla · — filas aprox. · 12 columnas

Configuración de los avisos automáticos al conductor. Ver scripts/182_notificacion_conductor.sql

**Llave primaria:** `id`

**Unicidad:** `evento`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('notificaciones_conductor_config_id_seq'::regclass)` |  |
| `evento` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `activo` | boolean | obligatoria | `false` |  |
| `mensaje` | text | obligatoria |  |  |
| `titulo` | text | obligatoria | `'LIP Logística'::text` |  |
| `url_encuesta` | text |  |  |  |
| `empresas` | integer[] | obligatoria | `'{}'::integer[]` | Arreglo vacío = ninguna empresa habilitada. No significa "todas". |
| `telefono_prueba` | text |  |  | Con valor, TODOS los avisos van a este número en vez de al conductor. Vaciarlo pone el flujo en real. |
| `actualizado_por` | text |  |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### notificaciones_conductor_enviadas

Tabla · 812 filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.notificaciones_conductor_enviadas is '...'`._

**Llave primaria:** `id`

**Unicidad:** `orden_id` + `evento`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('notificaciones_conductor_enviadas_id_seq'::regclass)` |  |
| `orden_id` | bigint | obligatoria |  |  |
| `evento` | text | obligatoria |  |  |
| `telefono` | text |  |  |  |
| `mensaje_id` | text |  |  | Identificador de Meta (wamid...), el mismo de whatsapp_mensajes.message_id. Es TEXTO, no uuid. |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `motivo` | text |  |  | Por que no se envio, cuando aplica: celular invalido, plantilla no aprobada, etc. NULL cuando el envio si se hizo. |

### notificaciones_enviadas

Tabla · — filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.notificaciones_enviadas is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `lote_id` | uuid |  |  |  |
| `tipo` | text | obligatoria | `'alerta'::text` |  |
| `canal` | text | obligatoria | `'whatsapp'::text` |  |
| `destinatario_nombre` | text |  |  |  |
| `destinatario_documento` | text |  |  |  |
| `destinatario_celular` | text |  |  |  |
| `plantilla` | text |  |  |  |
| `mensaje` | text |  |  |  |
| `variables` | jsonb |  |  |  |
| `estado` | text | obligatoria | `'simulado'::text` |  |
| `proveedor_msg_id` | text |  |  |  |
| `error` | text |  |  |  |
| `created_by` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### operaciones_desglosadas

Vista · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.operaciones_desglosadas is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `Fecha` | date |  |  |  |
| `Operador` | text |  |  |  |
| `ID Proyecto` | smallint |  |  |  |
| `Tipo de Producto` | text |  |  |  |
| `Tipo de Operacion` | text |  |  |  |
| `Cantidad Auxiliares en Operacion` | integer |  |  |  |
| `Total Viajes/Tickets` | bigint |  |  |  |
| `Toneladas Cargadas` | numeric |  |  |  |

### ordenes_correcciones

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.ordenes_correcciones is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('ordenes_correcciones_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `idorden` | integer | obligatoria |  |  |
| `ordendecargue` | text | obligatoria |  |  |
| `motivo` | text | obligatoria |  |  |
| `realizado_por` | text | obligatoria |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### owners

Tabla · — filas aprox. · 7 columnas

Owner

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `nombre` | text | obligatoria |  |  |
| `id` 🔑 | smallint | obligatoria |  |  |
| `ciudad` | text |  |  |  |
| `nit` | text |  |  |  |
| `direccion` | text |  |  |  |
| `logo` | text |  |  |  |
| `indicativo` | text |  |  |  |

### pagonomina

Vista · — filas aprox. · 27 columnas

_Sin descripción. Se escribe en la base con `comment on table public.pagonomina is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `fecha` | date |  |  |  |
| `idempresa` | integer |  |  |  |
| `idempresaliquidacion` | integer |  |  |  |
| `persona` | text |  |  |  |
| `actividad_registrada` | text |  |  |  |
| `novedad_reportada` | text |  |  |  |
| `especialidad` | boolean |  |  |  |
| `toneladas` | numeric |  |  |  |
| `pago_produccion` | numeric |  |  |  |
| `base_dia` | numeric |  |  |  |
| `bonif_prestacional` | numeric |  |  |  |
| `bonif_no_prestacional` | numeric |  |  |  |
| `horas_hed` | numeric |  |  |  |
| `horas_hedf` | numeric |  |  |  |
| `horas_hen` | numeric |  |  |  |
| `horas_hef` | numeric |  |  |  |
| `horas_hn` | numeric |  |  |  |
| `hed` | numeric |  |  |  |
| `hedf` | numeric |  |  |  |
| `hen` | numeric |  |  |  |
| `hef` | numeric |  |  |  |
| `hn` | numeric |  |  |  |
| `total_recargos` | numeric |  |  |  |
| `pago_domingo` | numeric |  |  |  |
| `recargodominical` | numeric |  |  |  |
| `total_liquidado_dia` | numeric |  |  |  |
| `recargo_dominical_tasa_completa` | boolean |  |  |  |

### parafiscales_estatico

Tabla · 74 filas aprox. · 19 columnas

_Sin descripción. Se escribe en la base con `comment on table public.parafiscales_estatico is '...'`._

**Llave primaria:** `id`

**Unicidad:** `identificacion`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `identificacion` | text | obligatoria |  |  |
| `proyecto` | text |  |  |  |
| `departamento` | text |  |  |  |
| `ciudad` | text |  |  |  |
| `tipo_cotizante` | text |  |  |  |
| `subtipo_cotizante` | text |  |  |  |
| `administradora_pension` | text |  |  |  |
| `administradora_salud` | text |  |  |  |
| `administradora_arl` | text |  |  |  |
| `administradora_caja` | text |  |  |  |
| `clase_riesgo` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `actividad_economica` | text |  |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `apellido1` | text |  |  |  |
| `apellido2` | text |  |  |  |
| `nombre1` | text |  |  |  |
| `nombre2` | text |  |  |  |

### parafiscales_real

Tabla · 540 filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.parafiscales_real is '...'`._

**Llave primaria:** `id`

**Unicidad:** `identificacion` + `anio` + `mes`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer |  |  |  |
| `identificacion` | text | obligatoria |  |  |
| `persona` | text |  |  |  |
| `anio` | integer | obligatoria |  |  |
| `mes` | integer | obligatoria |  |  |
| `ibc_real` | numeric |  |  |  |
| `dias_real` | integer |  |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### parametros_legales_anio

Tabla · — filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.parametros_legales_anio is '...'`._

**Llave primaria:** `anio`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `anio` 🔑 | integer | obligatoria |  |  |
| `smlv` | numeric | obligatoria |  |  |
| `auxilio_transporte` | numeric |  | `0` |  |
| `dias_cargo_empleador` | integer |  | `2` |  |
| `pct_pago_incapacidad` | numeric |  | `66.67` |  |
| `activo` | boolean |  | `true` |  |
| `actualizado_at` | timestamp with time zone |  | `now()` |  |
| `dias_calendario` | integer |  | `30` |  |
| `jornada_horas` | numeric |  | `7` |  |
| `pct_hed` | numeric |  | `25` |  |
| `pct_hen` | numeric |  | `75` |  |
| `pct_hn` | numeric |  | `35` |  |
| `pct_recargo_dominical` | numeric |  | `90` |  |
| `pct_hedf` | numeric |  | `115` |  |
| `pct_hef` | numeric |  | `165` |  |
| `pct_recargo_nocturno_dominical` | numeric |  | `125` |  |

### parametros_legales_vigencia

Tabla · — filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.parametros_legales_vigencia is '...'`._

**Llave primaria:** `fecha_desde`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `fecha_desde` 🔑 | date | obligatoria |  |  |
| `smlv` | numeric | obligatoria |  |  |
| `auxilio_transporte` | numeric | obligatoria | `0` |  |
| `dias_cargo_empleador` | integer | obligatoria | `2` |  |
| `pct_pago_incapacidad` | numeric | obligatoria | `66.67` |  |
| `dias_calendario` | numeric | obligatoria | `30` |  |
| `jornada_horas` | numeric | obligatoria |  |  |
| `pct_hed` | numeric | obligatoria | `25` |  |
| `pct_hen` | numeric | obligatoria | `75` |  |
| `pct_hn` | numeric | obligatoria | `35` |  |
| `pct_recargo_dominical` | numeric | obligatoria |  |  |
| `pct_hedf` | numeric | obligatoria |  |  |
| `pct_hef` | numeric | obligatoria |  |  |
| `pct_recargo_nocturno_dominical` | numeric | obligatoria |  |  |
| `actualizado_at` | timestamp with time zone |  | `now()` |  |

### parametros_parafiscales

Tabla · — filas aprox. · 14 columnas

_Sin descripción. Se escribe en la base con `comment on table public.parametros_parafiscales is '...'`._

**Llave primaria:** `anio`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `anio` 🔑 | integer | obligatoria |  |  |
| `pct_pension_empleador` | numeric | obligatoria | `12` |  |
| `pct_pension_empleado` | numeric | obligatoria | `4` |  |
| `pct_salud_empleador` | numeric | obligatoria | `8.5` |  |
| `pct_salud_empleado` | numeric | obligatoria | `4` |  |
| `pct_sena` | numeric | obligatoria | `2` |  |
| `pct_icbf` | numeric | obligatoria | `3` |  |
| `pct_caja` | numeric | obligatoria | `4` |  |
| `umbral_exoneracion_smlv` | numeric | obligatoria | `10` |  |
| `tope_ibc_smlv` | numeric | obligatoria | `25` |  |
| `clase_arl_admin` | text | obligatoria | `'I'::text` |  |
| `clase_arl_operativo` | text | obligatoria | `'IV'::text` |  |
| `incluye_aux_parafiscales` | boolean | obligatoria | `true` |  |
| `actualizado_at` | timestamp with time zone |  | `now()` |  |

### parametros_prestaciones

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.parametros_prestaciones is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `1` |  |
| `pct_prima` | numeric | obligatoria | `8.33` |  |
| `pct_cesantias` | numeric | obligatoria | `8.33` |  |
| `pct_intereses_cesantias` | numeric | obligatoria | `12` |  |
| `pct_vacaciones` | numeric | obligatoria | `4.17` |  |
| `incluye_aux` | boolean | obligatoria | `true` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### paros_produccion

Tabla · 677 filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.paros_produccion is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `fecha` + `inicio`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer |  |  |  |
| `fecha` | text |  |  |  |
| `inicio` | text |  |  |  |
| `fin` | text |  |  |  |
| `minutos` | integer |  |  |  |
| `motivo` | text |  |  |  |
| `categoria` | text |  |  |  |
| `reportado_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### patrones_rotacion

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.patrones_rotacion is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `nombre`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('patrones_rotacion_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `secuencia` | text[] | obligatoria |  |  |
| `horas_semana` | numeric |  |  | Referencia declarada, no calculada. El sistema no valida el límite semanal. |
| `activo` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### pausas

Tabla · 463 filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.pausas is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `ordendecargue` | text | obligatoria |  |  |
| `inicio` | time without time zone |  |  |  |
| `fin` | time without time zone |  |  |  |
| `tiempo_minutos` | numeric | **GENERADA** |  |  |
| `activo` | boolean | **GENERADA** |  |  |

### pedidodetalle_ocargue

Tabla · 20.146 filas aprox. · 10 columnas

Libro auxiliar: cuántas unidades tomó cada orden de cargue de cada línea de pedido. Permite que un pedido salga en varias órdenes sin perder lo ya despachado, revertir una sola orden y mostrar al cliente qué orden despachó cada parte. No es inventario: el inventario es invtrans.

**Llave primaria:** `id`

**Unicidad:** `transid` + `ocargue`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('pedidodetalle_ocargue_id_seq'::regclass)` |  |
| `id_empresa` | integer | obligatoria |  |  |
| `idpedido` | integer | obligatoria |  |  |
| `transid` | bigint | obligatoria |  | pedidosdetalle.transid — la línea del pedido. |
| `ocargue` | text | obligatoria |  | cabeceraoc.ordendecargue — el código de la orden de cargue. |
| `unidades` | numeric | obligatoria | `0` | Unidades que ESA orden tomó de ESA línea. La suma por línea es lo cargado del pedido. |
| `creado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `creado_por` | text |  |  |  |
| `origen` | text | obligatoria | `'app'::text` | app = lo escribió el cargue; backfill_auditoria / backfill_linea = reconstruido el 2026-10-04 y comprobado contra el detalle de la orden; linea_sin_orden = la orden ya no existe, es el rastro que guardaba la línea y no se puede probar con el documento. |
| `idorden` | bigint |  |  | Orden de cargue de esta atribucion, por id (cabeceraoc.id). Ver invtrans.idorden. Script 251. |

### pedidoscabecera

Tabla · 12.216 filas aprox. · 42 columnas

_Sin descripción. Se escribe en la base con `comment on table public.pedidoscabecera is '...'`._

**Llave primaria:** `idpedido`

**Unicidad:** `idpedido`

**Se liga a:** `id_empresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id_empresa` | smallint | obligatoria |  |  |
| `fecha` | date |  |  |  |
| `vendedor` | text |  |  |  |
| `cliente` | text |  |  |  |
| `destino` | text |  |  |  |
| `empresa` | text |  |  |  |
| `orden_de_compra` | text |  |  |  |
| `pedido` | character varying |  |  |  |
| `total_linea` | numeric |  |  |  |
| `aprobado` | text |  |  |  |
| `medio` | text |  |  |  |
| `fecha_programada` | date |  |  |  |
| `hora_recibido_cartera` | time without time zone |  |  |  |
| `hora_entrega_cartera` | time without time zone |  |  |  |
| `obs_cartera` | text |  |  |  |
| `soporte_recibido_cliente` | text |  |  |  |
| `fechaordencargue` | date |  |  |  |
| `transporte` | text |  |  |  |
| `vehiculo` | text |  |  |  |
| `ocargue` | text |  |  |  |
| `factura` | text |  |  |  |
| `estado` | text |  |  |  |
| `flete` | numeric |  |  |  |
| `demora` | numeric |  |  |  |
| `comentarios` | text |  |  |  |
| `direccion` | text |  |  |  |
| `idpedido` 🔑 | numeric | obligatoria | `nextval('pedidoscabecera_idpedido_seq'::regclass)` |  |
| `condicion_pago` | text |  |  |  |
| `total_pagar` | numeric |  |  |  |
| `descuentopp` | numeric |  |  |  |
| `descuentoiva` | numeric |  |  |  |
| `tipo_despacho` | text |  |  |  |
| `pdfpedido` | text |  |  |  |
| `fechadeentrega` | date |  |  |  |
| `observaciones` | text |  |  |  |
| `empresafactura` | text |  |  |  |
| `revisioncartera` | text |  |  |  |
| `revisiongerencia` | text |  |  |  |
| `creado_en` | timestamp with time zone |  | `now()` | Fecha y hora de registro del pedido (default now()). Las filas anteriores a este script se rellenan desde la auditoría (INSERT) cuando existe; si no, queda nulo: solo se conoce la fecha. |
| `motivo_no_entrega` | text |  |  | Motivo de depuración (Gestionar pedidos › Depurar pendientes): reemplazado · desistió · modificado · vencido · otro, con detalle opcional. |
| `depurado_por` | text |  |  | Usuario que autorizó la depuración con su clave personal (proceso ped_depurar). |
| `depurado_en` | timestamp with time zone |  |  | Fecha y hora de la depuración. |

### pedidosdetalle

Tabla · 23.964 filas aprox. · 21 columnas

_Sin descripción. Se escribe en la base con `comment on table public.pedidosdetalle is '...'`._

**Llave primaria:** `transid`

**Se liga a:** `idpedido` → `pedidoscabecera`(idpedido) · `id_empresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id_empresa` | smallint | obligatoria |  |  |
| `producto` | text |  |  |  |
| `unidades` | numeric |  |  |  |
| `precio_und` | numeric |  |  |  |
| `total_linea` | numeric |  |  |  |
| `iva` | numeric |  |  |  |
| `descuentopp` | numeric |  |  |  |
| `subtotal` | numeric |  |  |  |
| `und_eq` | numeric |  |  |  |
| `$_x_und_equivalente` | numeric |  |  |  |
| `peso` | numeric |  |  |  |
| `categoria` | text |  |  |  |
| `ocargue` | text |  |  |  |
| `unidades_cargadas` | numeric |  |  |  |
| `in_Full` | numeric |  |  |  |
| `peso_bascula` | numeric |  |  |  |
| `idpedido` | numeric |  |  |  |
| `transid` 🔑 | numeric | obligatoria | `nextval('pedidosdetalle_transid_seq'::regclass)` |  |
| `unidadescargadas` | numeric |  | `'0'::numeric` |  |
| `estado` | text |  |  |  |
| `unidadespendientes` | integer | **GENERADA** |  |  |

### perfil_acceso_empresas

Tabla · 81 filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.perfil_acceso_empresas is '...'`._

**Llave primaria:** `id`

**Unicidad:** `profile_id` + `empresa_id`

**Se liga a:** `empresa_id` → `empresas`(id) · `profile_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `profile_id` | uuid |  |  |  |
| `empresa_id` | smallint |  |  |  |

### perfil_acceso_owners

Tabla · 68 filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.perfil_acceso_owners is '...'`._

**Llave primaria:** `id`

**Unicidad:** `profile_id` + `owner`

**Se liga a:** `profile_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `profile_id` | uuid |  |  |  |
| `owner` | text |  |  |  |

### permisos_mapa_procesos

Tabla · 77 filas aprox. · 5 columnas

Procesos del Mapa de Procesos que cada usuario puede abrir. La ausencia de fila es la negación: sin fila, el botón se ve pero no abre. Ver scripts/189.

**Llave primaria:** `id`

**Unicidad:** `usuario_id` + `proceso_id`

**Se liga a:** `usuario_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('permisos_mapa_procesos_id_seq'::regclass)` |  |
| `usuario_id` | uuid | obligatoria |  |  |
| `proceso_id` | text | obligatoria |  | Codigo del proceso en el mapa (E-01, M-02, IN-01...), el mismo de sig_documentos.proceso_id. |
| `otorgado_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### permisos_usuarios

Tabla · 53 filas aprox. · 196 columnas

_Sin descripción. Se escribe en la base con `comment on table public.permisos_usuarios is '...'`._

**Llave primaria:** `id`

**Unicidad:** `usuario_id`

**Se liga a:** `usuario_id` → `profiles`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('permisos_usuarios_id_seq'::regclass)` |  |
| `usuario_id` | uuid | obligatoria |  |  |
| `entrada_pedidos` | boolean |  | `true` |  |
| `gestionar_pedidos` | boolean |  | `true` |  |
| `generar_ordenes_cargue` | boolean |  | `true` |  |
| `gestion_ordenes` | boolean |  | `true` |  |
| `registrar_vehiculos` | boolean |  | `true` |  |
| `ver_vehiculos` | boolean |  | `true` |  |
| `bascula` | boolean |  | `true` |  |
| `transacciones_inventario` | boolean |  | `true` |  |
| `saldos_inventario` | boolean |  | `true` |  |
| `saldos_producto` | boolean |  | `true` |  |
| `reprocesos` | boolean |  | `true` |  |
| `gestion_transacciones` | boolean |  | `true` |  |
| `solicitudes_traslados` | boolean |  | `true` |  |
| `ver_solicitudes_traslado` | boolean |  | `true` |  |
| `traslados_producto` | boolean |  | `true` |  |
| `capacidad_bodega` | boolean |  | `true` |  |
| `creacion_materiales` | boolean |  | `true` |  |
| `ingresos_mp` | boolean |  | `true` |  |
| `explosion_materiales` | boolean |  | `true` |  |
| `gestion_proveedores` | boolean |  | `true` |  |
| `saldos_empaque` | boolean |  | `true` |  |
| `saldos_materia_prima` | boolean |  | `true` |  |
| `ingreso_produccion` | boolean |  | `true` |  |
| `ver_ingresos_produccion` | boolean |  | `true` |  |
| `aprobacion_produccion` | boolean |  | `true` |  |
| `asignacion_lotes` | boolean |  | `true` |  |
| `historial_lotes` | boolean |  | `true` |  |
| `registro_sanitario` | boolean |  | `true` |  |
| `ver_historial_inspeccion` | boolean |  | `true` |  |
| `historial_aprobaciones` | boolean |  | `true` |  |
| `auditoria_inventario` | boolean |  | `true` |  |
| `dashboard_operacion` | boolean |  | `true` |  |
| `headcount` | boolean |  | `true` |  |
| `registro_asistencia` | boolean |  | `true` |  |
| `tabla_asistencia` | boolean |  | `true` |  |
| `picking` | boolean |  | `true` |  |
| `registro_qr_estibas` | boolean |  | `true` |  |
| `lectura_qr_estibas` | boolean |  | `true` |  |
| `inventario_estiba` | boolean |  | `true` |  |
| `config_bodegas` | boolean |  | `true` |  |
| `config_categorias` | boolean |  | `true` |  |
| `config_subcategorias` | boolean |  | `true` |  |
| `config_clientes` | boolean |  | `true` |  |
| `config_condiciones_pago` | boolean |  | `true` |  |
| `config_destinos` | boolean |  | `true` |  |
| `config_grupos` | boolean |  | `true` |  |
| `config_medios` | boolean |  | `true` |  |
| `config_productos` | boolean |  | `true` |  |
| `config_sucursales` | boolean |  | `true` |  |
| `config_tipos_despacho` | boolean |  | `true` |  |
| `config_transportadoras` | boolean |  | `true` |  |
| `config_tipos_vehiculos` | boolean |  | `true` |  |
| `config_vendedores` | boolean |  | `true` |  |
| `config_localizaciones` | boolean |  | `true` |  |
| `gestion_usuarios` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `asignacion_horas_extra` | boolean |  | `true` |  |
| `novedades_personal` | boolean |  | `true` |  |
| `visor` | boolean |  | `true` |  |
| `gestion_integral_pedidos` | boolean |  |  |  |
| `ver_picking` | boolean |  | `true` |  |
| `packing` | boolean |  |  |  |
| `tarifas` | boolean |  | `true` |  |
| `historial_bascula` | boolean |  | `true` |  |
| `generar_ordenes_descargue` | boolean |  | `true` |  |
| `tolva` | boolean |  | `true` |  |
| `ver_tolva` | boolean |  | `true` |  |
| `nominapersonal` | boolean |  | `true` |  |
| `proyecciones` | boolean |  | `true` |  |
| `asistenteia` | boolean |  | `true` |  |
| `gestion_colaboradores` | boolean |  | `true` |  |
| `gestion_contratos` | boolean |  | `true` |  |
| `dotacion_epp` | boolean |  | `true` |  |
| `capacitaciones` | boolean |  | `true` |  |
| `asistencia_capacitaciones` | boolean |  | `true` |  |
| `solicitud_personal` | boolean |  |  |  |
| `distribucion` | boolean |  | `false` |  |
| `accesos_usuario` | boolean |  | `true` |  |
| `facturacion_proyectos` | boolean |  | `true` |  |
| `dashboardop` | boolean |  | `false` |  |
| `prechequeo` | boolean |  | `true` |  |
| `solicitudturnos` | boolean |  | `true` |  |
| `aprobacionturnos` | boolean |  | `true` |  |
| `gestionfacturas` | boolean |  | `false` |  |
| `evaluacionpersonal` | boolean |  | `true` |  |
| `gestionsolicitudes` | boolean |  | `true` |  |
| `gastos` | boolean |  | `true` |  |
| `estadoresultados` | boolean |  | `true` |  |
| `dashboardpedidos` | boolean |  | `false` |  |
| `dashboardrecepcion` | boolean |  | `false` |  |
| `gestionturnos` | boolean |  |  |  |
| `programacionturnos` | boolean |  |  |  |
| `montacargasdia` | boolean |  | `true` |  |
| `bitacora` | boolean |  |  |  |
| `controlpiso` | boolean |  | `false` |  |
| `evidenciasido` | boolean |  | `false` |  |
| `evidenciasinducciones` | boolean |  |  |  |
| `inducciones` | boolean |  | `false` |  |
| `sst_autoevaluacion` | boolean | obligatoria | `false` |  |
| `sst_plan_mejora` | boolean | obligatoria | `false` |  |
| `sst_indicadores` | boolean | obligatoria | `false` |  |
| `sst_ipevr` | boolean | obligatoria | `false` |  |
| `sst_incidentes` | boolean | obligatoria | `false` |  |
| `sst_epp` | boolean | obligatoria | `false` |  |
| `sst_mantenimiento` | boolean | obligatoria | `false` |  |
| `sst_comunicacion` | boolean | obligatoria | `false` |  |
| `sst_gestion_cambio` | boolean | obligatoria | `false` |  |
| `sst_actividades` | boolean | obligatoria | `false` |  |
| `sst_auditoria` | boolean | obligatoria | `false` |  |
| `sst` | boolean |  | `false` |  |
| `sst_repositorio_soportes` | boolean | obligatoria | `false` |  |
| `sst_alertas_at` | boolean | obligatoria | `false` |  |
| `sst_investigaciones` | boolean | obligatoria | `false` |  |
| `iso_repositorio` | boolean | obligatoria | `false` |  |
| `gh_carpetas` | boolean | obligatoria | `false` |  |
| `gh_entrevistas` | boolean | obligatoria | `false` |  |
| `gh_bienestar` | boolean | obligatoria | `false` |  |
| `gh_participacion` | boolean | obligatoria | `false` |  |
| `ausentismos` | boolean | obligatoria | `false` |  |
| `sig_matriz` | boolean |  | `false` |  |
| `sig_iso9001` | boolean |  | `false` |  |
| `sig_iso14001` | boolean |  | `false` |  |
| `sig_iso45001` | boolean |  | `false` |  |
| `sig_control_cambios` | boolean |  | `false` |  |
| `recobro_incapacidades` | boolean |  | `false` |  |
| `satisfaccion_pqrsf` | boolean |  | `false` |  |
| `calificacion_conductor` | boolean |  | `false` |  |
| `sst_medevac` | boolean |  | `false` |  |
| `sst_perfil` | boolean |  | `false` |  |
| `notificaciones` | boolean | obligatoria | `false` |  |
| `liquidaciones` | boolean | obligatoria | `false` |  |
| `examenes_medicos` | boolean | obligatoria | `false` |  |
| `parafiscales` | boolean | obligatoria | `false` |  |
| `cuadro_facturacion` | boolean | obligatoria | `false` |  |
| `vacaciones` | boolean |  | `true` |  |
| `bitacora_auditoria` | boolean |  | `false` |  |
| `placas_distribucion` | boolean |  | `false` |  |
| `revision_nomina` | boolean | obligatoria | `false` |  |
| `liquidacion_tolva` | boolean | obligatoria | `false` |  |
| `conciliacion_avimol` | boolean | obligatoria | `false` |  |
| `bonos` | boolean | obligatoria | `false` |  |
| `prefactura_produccion` | boolean | obligatoria | `false` |  |
| `montacargas` | boolean | obligatoria | `false` |  |
| `cargos_fijos` | boolean | obligatoria | `false` |  |
| `apoyo_cargue` | boolean | obligatoria | `false` |  |
| `control_toneladas` | boolean | obligatoria | `false` |  |
| `centro_coordinacion` | boolean | obligatoria | `false` |  |
| `muelles_empresa` | boolean |  | `false` |  |
| `cuadre_inventario` | boolean | obligatoria | `false` |  |
| `acumulados_lipgo` | boolean | obligatoria | `false` |  |
| `asistencia_administrativa` | boolean | obligatoria | `false` |  |
| `ciclo_facturacion` | boolean | obligatoria | `false` |  |
| `ciclo_facturacion_jefe` | boolean | obligatoria | `false` |  |
| `ciclo_facturacion_coordinador` | boolean | obligatoria | `false` |  |
| `operacion_dia` | boolean | obligatoria | `false` |  |
| `procesos_disciplinarios` | boolean | obligatoria | `false` |  |
| `whatsapp` | boolean | obligatoria | `false` |  |
| `crm_dashboard` | boolean | obligatoria | `false` |  |
| `crm_agenda` | boolean | obligatoria | `false` |  |
| `crm_prospectos` | boolean | obligatoria | `false` |  |
| `crm_embudo` | boolean | obligatoria | `false` |  |
| `crm_actividades` | boolean | obligatoria | `false` |  |
| `crm_cotizaciones` | boolean | obligatoria | `false` |  |
| `crm_pedidos` | boolean | obligatoria | `false` |  |
| `crm_autorizar_contabilidad` | boolean | obligatoria | `false` | Primera firma del pedido. Separado de gerencia a proposito: la misma persona no puede dar las dos. |
| `crm_autorizar_gerencia` | boolean | obligatoria | `false` | Segunda firma del pedido. Solo con ambas el pedido viaja a LIPgo. |
| `crm_clientes` | boolean | obligatoria | `false` |  |
| `crm_listas_precios` | boolean | obligatoria | `false` |  |
| `crm_cartera` | boolean | obligatoria | `false` |  |
| `crm_pagos` | boolean | obligatoria | `false` |  |
| `crm_comisiones` | boolean | obligatoria | `false` |  |
| `crm_ia_rutas` | boolean | obligatoria | `false` |  |
| `crm_ia_oportunidades` | boolean | obligatoria | `false` |  |
| `crm_reportes` | boolean | obligatoria | `false` |  |
| `crm_productos` | boolean | obligatoria | `false` |  |
| `crm_vendedores` | boolean | obligatoria | `false` |  |
| `crm_parametros` | boolean | obligatoria | `false` | Editar los numeros de los que dependen las reglas de negocio (IVA, vigencias, comisiones, tramos de cartera). |
| `crm_usuarios` | boolean | obligatoria | `false` | Crear usuarios, asignar y cambiar contrasenas, otorgar permisos. Es el permiso mas sensible del sistema. |
| `crm_auditoria` | boolean | obligatoria | `false` |  |
| `correccion_ordenes` | boolean | obligatoria | `false` |  |
| `crm_ver_todos_clientes` | boolean | obligatoria | `false` | Ver clientes, pedidos y cartera de todos los vendedores. Sin el, un usuario vinculado a un vendedor solo ve lo de ese vendedor. |
| `crm_recaudos_registrar` | boolean | obligatoria | `false` | Reportar un recaudo con su comprobante. Es la unica accion de cartera que tiene el vendedor. |
| `crm_recaudos_aprobar` | boolean | obligatoria | `false` | Aprobar o rechazar recaudos. Al aprobar se mueven los saldos de las facturas. |
| `crm_prospectos_aprobar` | boolean | obligatoria | `false` | Aprobar la creacion de un cliente a partir de un prospecto. |
| `crm_maestros_admin` | boolean | obligatoria | `false` | Administrar maestros: owners, impuestos, bancos, cuentas destino, medios de pago, motivos, destinatarios. |
| `crm_importar` | boolean | obligatoria | `false` | Cargar archivos CSV o Excel de clientes, sucursales, productos, catalogos y facturas. |
| `crm_integraciones_admin` | boolean | obligatoria | `false` | Ver la bandeja de integraciones (SAP, LIPgo, WhatsApp), reintentar y descartar envios. |
| `crm_descuentos_admin` | boolean | obligatoria | `false` | Aplicar descuentos. Segun el requerimiento solo se gestionan desde el panel administrador, nunca desde la venta. |
| `autorizaciones_clave` | boolean | obligatoria | `false` |  |
| `siigo_facturas` | boolean | obligatoria | `false` | Consulta de facturas en Siigo (solo lectura). Da acceso a TODA la facturacion de la empresa: se otorga a mano. |
| `productividad_auxiliares` | boolean | obligatoria | `false` |  |
| `programacion_cliente` | boolean | obligatoria | `false` | Módulo "Programación del cliente" (Pedidos y solicitudes): registrar la programación de mañana y ver su cumplimiento. |
| `programacion_cliente_lip` | boolean | obligatoria | `false` | Módulo "Consignar programación del cliente" (Operación LIP › Operación del día): el coordinador registra la programación de mañana que envía el cliente y ve su cumplimiento. |

### politica_horas_extra

Tabla · — filas aprox. · 18 columnas

Reglas de generación de horas extra por puesto y día. Reemplaza los literales que estaban quemados en calcular_y_asignar_horas_extras().

**Llave primaria:** `id`

**Unicidad:** `puesto` + `fecha_desde` (parcial) · `puesto` + `fecha_desde` + `dia_semana` (parcial)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `puesto` | text | obligatoria |  | Puesto tal como se escribe en registroasistencia.puesto. El valor '*' es la política por defecto para los puestos sin regla propia. |
| `fecha_desde` | date | obligatoria |  | Vigencia. Se compara contra la FECHA TRABAJADA (registroasistencia.fecha), no contra la fecha de edición. |
| `dia_semana` | smallint |  |  | ISODOW 1=lunes..7=domingo. NULL = política base del puesto (todos los días). |
| `umbral_horas` | numeric | obligatoria | `7.0` |  |
| `horas_descanso` | numeric | obligatoria | `1.0` |  |
| `descanso_desde_horas` | numeric |  |  | Si no es null, el descanso solo se descuenta cuando el total trabajado supera este valor (turno corto sin almuerzo). |
| `tolerancia_salida_min` | integer | obligatoria | `45` |  |
| `minimo_extra_horas` | numeric | obligatoria | `0` |  |
| `tope_extra_turno_horas` | numeric |  |  | Tope POR TURNO, no por día: el trigger corre por fila y Auxiliar Mixto tiene dos filas el mismo día. |
| `redondeo_modo` | text | obligatoria | `'truncar'::text` |  |
| `redondeo_bloque_min` | integer |  |  |  |
| `ventana_nocturna_desde` | time without time zone |  |  | RESERVADO. El cálculo automático de hen/hef/hn es una entrega aparte; hoy esta columna no se usa. |
| `ventana_nocturna_hasta` | time without time zone |  |  | RESERVADO. Ver ventana_nocturna_desde. |
| `activa` | boolean | obligatoria | `true` |  |
| `nota` | text |  |  |  |
| `actualizado_at` | timestamp with time zone | obligatoria | `now()` |  |
| `actualizado_por` | text |  |  |  |

### prefactura_ciclo_eventos

Tabla · 19 filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.prefactura_ciclo_eventos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `prefactura_id` → `prefacturas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('prefactura_ciclo_eventos_id_seq'::regclass)` |  |
| `prefactura_id` | bigint | obligatoria |  |  |
| `evento` | text | obligatoria |  |  |
| `archivo_url` | text |  |  |  |
| `archivo_nombre` | text |  |  |  |
| `usuario` | text | obligatoria |  |  |
| `nota` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### prefactura_pagos

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.prefactura_pagos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `prefactura_id` → `prefacturas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('prefactura_pagos_id_seq'::regclass)` |  |
| `prefactura_id` | bigint | obligatoria |  |  |
| `fecha` | date | obligatoria |  |  |
| `valor` | numeric | obligatoria |  |  |
| `observacion` | text |  |  |  |
| `usuario` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### prefacturas

Tabla · 56 filas aprox. · 27 columnas

_Sin descripción. Se escribe en la base con `comment on table public.prefacturas is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('prefacturas_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `proyecto` | text |  |  |  |
| `periodo_desde` | date |  |  |  |
| `periodo_hasta` | date |  |  |  |
| `lineas` | jsonb | obligatoria | `'[]'::jsonb` |  |
| `total` | numeric | obligatoria | `0` |  |
| `toneladas` | numeric | obligatoria | `0` |  |
| `estado` | text | obligatoria | `'borrador'::text` |  |
| `usuario` | text |  |  |  |
| `observacion` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `soporte` | jsonb | obligatoria | `'[]'::jsonb` |  |
| `origen` | text | obligatoria | `'cuadro_control'::text` |  |
| `aprobado_por` | text |  |  |  |
| `aprobado_en` | timestamp with time zone |  |  |  |
| `estado_ciclo` | text | obligatoria | `'pendiente_anexo'::text` |  |
| `ciclo_actualizado_en` | timestamp with time zone |  |  |  |
| `dias_plazo` | integer |  |  |  |
| `fecha_vencimiento` | date |  |  |  |
| `numero_factura_siigo` | text |  |  |  |
| `valor_pagado` | numeric | obligatoria | `0` |  |
| `estado_cobro` | text | obligatoria | `'pendiente'::text` |  |
| `fecha_ultimo_pago` | date |  |  |  |
| `advertencias` | jsonb | obligatoria | `'[]'::jsonb` |  |
| `owner` | text |  |  |  |

### prestaciones_activos_pagos

Tabla · 205 filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.prestaciones_activos_pagos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `identificacion` + `concepto` + `periodo_desde` + `periodo_hasta`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer |  |  |  |
| `identificacion` | text | obligatoria |  |  |
| `persona` | text |  |  |  |
| `concepto` | text | obligatoria |  |  |
| `periodo_desde` | date | obligatoria |  |  |
| `periodo_hasta` | date | obligatoria |  |  |
| `fecha_pago` | date |  |  |  |
| `valor_calculado` | numeric |  |  |  |
| `valor_real` | numeric |  |  |  |
| `estado` | text | obligatoria | `'proyectado'::text` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### procesos_disciplinarios

Tabla · — filas aprox. · 29 columnas

Solicitudes de medida disciplinaria y su trámite. La usuaria reporta y solicita; el empleador (la temporal) cita a descargos y decide. Ver scripts/add_procesos_disciplinarios.sql

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `radicado`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `radicado` | text | obligatoria |  |  |
| `identificacion` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `cargo` | text |  |  |  |
| `conducta` | text | obligatoria |  |  |
| `norma` | text |  |  |  |
| `medida_sugerida` | text |  |  | Sugerencia del catálogo para la conducta. NO es la medida aplicada: esa se decide tras los descargos. |
| `fecha_hecho` | date | obligatoria |  |  |
| `hora_hecho` | text |  |  |  |
| `lugar` | text |  |  |  |
| `relato` | text | obligatoria |  |  |
| `testigo` | text |  |  |  |
| `testigo_cargo` | text |  |  |  |
| `estado` | text | obligatoria | `'radicado'::text` | radicado \| descargos_citados \| descargos_realizados \| resuelto \| archivado |
| `fecha_citacion_descargos` | date |  |  |  |
| `fecha_descargos` | date |  |  |  |
| `medida_aplicada` | text |  |  |  |
| `fecha_resolucion` | date |  |  |  |
| `motivo_archivo` | text |  |  |  |
| `radicado_por` | text |  |  |  |
| `responsable` | text |  |  |  |
| `area_responsable` | text |  |  |  |
| `documento_url` | text |  |  |  |
| `documento_nombre` | text |  |  |  |
| `soportes` | jsonb | obligatoria | `'[]'::jsonb` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### procesos_disciplinarios_bitacora

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.procesos_disciplinarios_bitacora is '...'`._

**Llave primaria:** `id`

**Se liga a:** `proceso_id` → `procesos_disciplinarios`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('procesos_disciplinarios_bitacora_id_seq'::regclass)` |  |
| `proceso_id` | uuid | obligatoria |  |  |
| `estado_anterior` | text |  |  |  |
| `estado_nuevo` | text | obligatoria |  |  |
| `nota` | text |  |  |  |
| `actor` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### produccion

Tabla · 2.559 filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.produccion is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fecha_hora` | timestamp with time zone | obligatoria | `timezone('utc'::text, now())` |  |
| `producto` | integer | obligatoria |  |  |
| `bodega` | integer | obligatoria |  |  |
| `localizacion` | integer | obligatoria |  |  |
| `tipo_empaque` | text | obligatoria |  |  |
| `lote` | bigint | obligatoria |  |  |
| `bultos_procesados` | integer | obligatoria |  |  |
| `cantidad_meta` | integer | obligatoria |  |  |
| `averias` | integer |  |  |  |

### productos

Tabla · 146 filas aprox. · 25 columnas

_Sin descripción. Se escribe en la base con `comment on table public.productos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `crm_impuesto_id` → `crm_impuestos`(id) · `id_empresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `id_empresa` | smallint | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `codigo` | character varying |  |  |  |
| `gramaje` | numeric |  |  |  |
| `und` | numeric |  |  |  |
| `peso_unitkg` | numeric |  |  |  |
| `und_equivalente` | numeric |  |  |  |
| `equivalencia_bultos` | numeric |  |  |  |
| `unidades_estiba` | numeric |  |  |  |
| `categoria` | text |  |  |  |
| `grupo` | text |  |  |  |
| `bodega` | smallint |  |  |  |
| `activo` | text |  |  |  |
| `peso_bruto` | numeric |  |  |  |
| `subcategoria` | text |  |  |  |
| `pesobruto` | numeric |  |  |  |
| `vidautildias` | numeric |  |  |  |
| `owner` | text |  |  |  |
| `empresasacceso` | smallint[] |  | `'{}'::smallint[]` |  |
| `foto_url` | text |  |  | Foto principal: la que sale en listados, cotizaciones y catalogo. |
| `fotos` | jsonb | obligatoria | `'[]'::jsonb` | Galeria adicional, array de URLs. Separada de foto_url porque casi toda lectura quiere una sola imagen y no conviene desarmar un jsonb en cada fila. |
| `descripcion_comercial` | text |  |  |  |
| `precio_base` | numeric(14,2) |  |  | Precio de lista antes de descuentos. Es la base sobre la que operan las listas de precios del CRM. |
| `crm_impuesto_id` | integer |  |  | CRM: impuesto del producto. NULL = el impuesto por defecto (crm_impuestos.es_default). LIPgo no la usa. |

### profiles

Tabla · 58 filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.profiles is '...'`._

**Llave primaria:** `id`

**Se liga a:** `empresa_id` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `empresa_id` | smallint | obligatoria |  |  |
| `id` 🔑 | uuid | obligatoria |  |  |
| `usuario` | text |  |  |  |

### programacion_cliente

Tabla · — filas aprox. · 14 columnas

Programación de vehículos que el cliente entrega para el día siguiente. Una fila por versión enviada; vigente = la última.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `fecha_operacion` + `version`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('programacion_cliente_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `fecha_operacion` | date | obligatoria |  |  |
| `version` | integer | obligatoria | `1` |  |
| `vigente` | boolean | obligatoria | `true` |  |
| `lineas` | jsonb | obligatoria | `'[]'::jsonb` | JSON [{tipovehiculo, destino, producto, cantidad, observaciones}]. tipovehiculo = nombre del catálogo tiposvehiculos. |
| `total_vehiculos` | integer | obligatoria | `0` |  |
| `observaciones` | text |  |  |  |
| `enviada_en` | timestamp with time zone | obligatoria | `now()` |  |
| `a_tiempo` | boolean | obligatoria | `true` | true si se envió antes de las 17:00 (America/Bogota) del día anterior a fecha_operacion. |
| `enviada_por` | uuid |  |  |  |
| `enviada_por_usuario` | text |  |  |  |
| `enviada_por_empresa` | integer |  |  | empresa_id del perfil que envió: permite distinguir si la registró el cliente o LIP. |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### proveedores

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.proveedores is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `pais` | text |  |  |  |
| `direccion` | text |  |  |  |
| `tipo` | text |  |  |  |
| `idproveedor` | text |  |  |  |
| `correo` | text |  |  |  |
| `activo` | text |  |  |  |

### qrestibacabecera

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.qrestibacabecera is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | smallint | identidad, obligatoria |  |  |
| `idempresa` | smallint |  |  |  |
| `idproducto` | bigint |  |  |  |
| `nombreproducto` | text |  |  |  |
| `fecha` | date |  |  |  |
| `hora` | time without time zone |  |  |  |
| `operador` | text |  |  |  |
| `semana` | numeric |  |  |  |
| `bodega` | text |  |  |  |

### qrestibadetalle

Tabla · 0 filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.qrestibadetalle is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idqr` → `qrestibacabecera`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idqr` | smallint | obligatoria |  |  |
| `codproducto` | text |  |  |  |
| `nombreproducto` | text |  |  |  |
| `lote` | text |  |  |  |
| `cantidad` | numeric |  |  |  |
| `location` | text |  |  |  |
| `fechavenc` | date |  |  |  |
| `tipomov` | text |  |  |  |

### reasignacion_puesto_log

Tabla · 51 filas aprox. · 11 columnas

Cambios de puesto del día hechos desde Tabla Asistencia. Cada fila exige un motivo escrito: el puesto decide quién puede asignarse en Picking/Packing y cómo liquida pagonomina ese día.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | obligatoria | `nextval('reasignacion_puesto_log_id_seq'::regclass)` |  |
| `fecha` | date | obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `identificacion` | text | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `puesto_anterior` | text |  |  |  |
| `puesto_nuevo` | text | obligatoria |  |  |
| `tipo_nuevo` | text | obligatoria |  |  |
| `motivo` | text | obligatoria |  |  |
| `usuario` | text |  |  |  |
| `creado` | timestamp with time zone | obligatoria | `now()` |  |

### recargo_dominical_legal

Tabla · — filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.recargo_dominical_legal is '...'`._

**Llave primaria:** `fecha_desde`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `fecha_desde` 🔑 | date | obligatoria |  |  |
| `pct` | numeric | obligatoria |  |  |
| `norma` | text |  |  |  |

### registro_conexiones

Tabla · 4.657 filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.registro_conexiones is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `usuario_id` | uuid |  |  |  |
| `latitud` | numeric |  |  |  |
| `longitud` | numeric |  |  |  |
| `accion` | text |  |  |  |
| `metodo_captura` | text |  | `'automatica'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### registroasistencia

Tabla · 13.257 filas aprox. · 24 columnas

_Sin descripción. Se escribe en la base con `comment on table public.registroasistencia is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fecha` | date | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `identificacion` | text |  |  |  |
| `puesto` | text |  |  |  |
| `asistencia` | text |  |  |  |
| `hed` | numeric |  |  |  |
| `hedf` | numeric |  |  |  |
| `hen` | numeric |  |  |  |
| `hef` | numeric |  |  |  |
| `hn` | numeric |  |  |  |
| `idempresa` | smallint |  |  |  |
| `especialidad` | text |  |  |  |
| `horaingreso` | time without time zone |  |  |  |
| `horasalida` | time without time zone |  |  |  |
| `horasturno` | numeric |  |  |  |
| `aprobado` | text |  |  |  |
| `horaentradaprogramada` | time without time zone |  |  |  |
| `horasalidaprogramada` | time without time zone |  |  |  |
| `foto_ingreso` | text |  |  | URL de la foto tomada al marcar ingreso (cámara del módulo de asistencia). |
| `foto_salida` | text |  |  | URL de la foto tomada al marcar salida. |
| `turno` | smallint |  |  | Turno del día para puestos con doble jornada (Auxiliar Mixto): 1 o 2. NULL = jornada única (todos los demás puestos, sin cambios). |
| `horafinauto` | boolean |  |  |  |
| `extras_manual` | boolean | obligatoria | `false` | Las horas extra de esta fila se fijaron a mano y el trigger no debe recalcularlas. Se limpia sola si cambia la marcación (horaingreso/horasalida). |

### registrosanitario

Tabla · 2.663 filas aprox. · 20 columnas

_Sin descripción. Se escribe en la base con `comment on table public.registrosanitario is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `ordencargue` | text |  |  |  |
| `placa` | text |  |  |  |
| `conductor` | text |  |  |  |
| `producto` | text |  |  |  |
| `carpas` | text |  |  |  |
| `limpieza` | text |  |  |  |
| `olores` | text |  |  |  |
| `plastico` | text |  |  |  |
| `fumigacion` | text |  |  |  |
| `plaguicida` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `fumigador` | text |  |  |  |
| `auxiliar` | text |  |  |  |
| `foto` | text |  |  |  |
| `aprobacion` | text |  |  |  |
| `pdf` | text |  |  |  |
| `horaregistro` | time without time zone |  |  |  |
| `fecha` | date |  |  |  |

### reporte_interno_config

Tabla · — filas aprox. · 10 columnas

Los cinco avisos internos de operación. Cada uno se enciende por separado: con ~35 cargues al dia, los cinco son ~175 mensajes diarios por destinatario. Ver scripts/196.

**Llave primaria:** `id`

**Unicidad:** `evento`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('reporte_interno_config_id_seq'::regclass)` |  |
| `evento` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `orden_linea` | integer | obligatoria | `0` |  |
| `activo` | boolean | obligatoria | `false` |  |
| `detalle` | text | obligatoria |  |  |
| `empresas` | integer[] | obligatoria | `'{}'::integer[]` |  |
| `actualizado_por` | text |  |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### reporte_interno_destinatarios

Tabla · 1 filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.reporte_interno_destinatarios is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('reporte_interno_destinatarios_id_seq'::regclass)` |  |
| `nombre` | text | obligatoria |  |  |
| `telefono` | text | obligatoria |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `solo_eventos` | text[] | obligatoria | `'{}'::text[]` | Arreglo vacio = recibe TODOS los eventos activos. Con valores, solo esos. |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `empresas` | integer[] | obligatoria | `'{}'::integer[]` | Empresas de las que recibe. Arreglo VACIO = todas las del evento (lo contrario que en reporte_interno_config, donde vacio = ninguna). |

### reporte_interno_enviados

Tabla · 1.090 filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.reporte_interno_enviados is '...'`._

**Llave primaria:** `id`

**Unicidad:** `orden_id` + `evento` + `telefono`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('reporte_interno_enviados_id_seq'::regclass)` |  |
| `orden_id` | bigint | obligatoria |  |  |
| `evento` | text | obligatoria |  |  |
| `telefono` | text |  |  |  |
| `mensaje_id` | text |  |  |  |
| `motivo` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### reprocesos

Tabla · 69 filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.reprocesos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | smallint | obligatoria |  |  |
| `lote` | text |  |  |  |
| `producto` | text |  |  |  |
| `cantidad` | numeric |  |  |  |
| `estado` | text |  |  |  |
| `codproducto` | text |  |  |  |
| `creado` | timestamp with time zone |  |  |  |
| `creadopor` | text |  |  |  |
| `procesado` | date |  |  |  |

### respaldo_20261005_pares_cuadre13

Tabla · — filas aprox. · 25 columnas

_Sin descripción. Se escribe en la base con `comment on table public.respaldo_20261005_pares_cuadre13 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `respaldado_en` | timestamp with time zone |  |  |  |
| `id` | bigint |  |  |  |
| `idempresa` | smallint |  |  |  |
| `idproducto` | smallint |  |  |  |
| `nombreproducto` | text |  |  |  |
| `lote` | text |  |  |  |
| `location` | text |  |  |  |
| `cantidad` | numeric |  |  |  |
| `tipomov` | text |  |  |  |
| `status` | text |  |  |  |
| `origen` | text |  |  |  |
| `creado` | timestamp with time zone |  |  |  |
| `creadopor` | text |  |  |  |
| `codproducto` | text |  |  |  |
| `ocargue` | text |  |  |  |
| `pdf` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `fechavencimiento` | date |  |  |  |
| `fechaprod` | date |  |  |  |
| `almacen` | text |  |  |  |
| `ordentolva` | text |  |  |  |
| `qrestiba` | numeric |  |  |  |
| `cod_movimiento` | text |  |  |  |
| `horaprod` | text |  |  |  |
| `tipo_produccion` | text |  |  |  |

### respaldo_extras_17ago2026

Tabla · — filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.respaldo_extras_17ago2026 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | bigint |  |  |  |
| `fecha` | date |  |  |  |
| `idempresa` | smallint |  |  |  |
| `nombre` | text |  |  |  |
| `identificacion` | text |  |  |  |
| `aprobado` | text |  |  |  |
| `hed` | numeric |  |  |  |
| `hedf` | numeric |  |  |  |
| `hen` | numeric |  |  |  |
| `hef` | numeric |  |  |  |
| `respaldado_en` | timestamp with time zone |  |  |  |

### respaldo_horas_extra_sabado_dt_ago2026

Tabla · — filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.respaldo_horas_extra_sabado_dt_ago2026 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | bigint |  |  |  |
| `fecha` | date |  |  |  |
| `idempresa` | smallint |  |  |  |
| `nombre` | text |  |  |  |
| `identificacion` | text |  |  |  |
| `aprobado` | text |  |  |  |
| `hed` | numeric |  |  |  |
| `hedf` | numeric |  |  |  |
| `hen` | numeric |  |  |  |
| `hef` | numeric |  |  |  |
| `respaldado_en` | timestamp with time zone |  |  |  |

### respaldo_recalculo_extras

Tabla · — filas aprox. · 15 columnas

Foto de las horas extra ANTES de cada recálculo retroactivo. Permite revertir un lote completo.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `lote_id` | uuid | obligatoria |  |  |
| `registro_id` | bigint | obligatoria |  |  |
| `fecha` | date |  |  |  |
| `nombre` | text |  |  |  |
| `identificacion` | text |  |  |  |
| `puesto` | text |  |  |  |
| `aprobado` | text |  |  |  |
| `hed` | numeric |  |  |  |
| `hedf` | numeric |  |  |  |
| `hen` | numeric |  |  |  |
| `hef` | numeric |  |  |  |
| `hn` | numeric |  |  |  |
| `respaldado_en` | timestamp with time zone | obligatoria | `now()` |  |
| `motivo` | text |  |  |  |

### rrhh_config

Tabla · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.rrhh_config is '...'`._

**Llave primaria:** `idempresa`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` 🔑 | integer | obligatoria |  |  |
| `costo_examen_default` | numeric(14,2) | obligatoria | `0` |  |
| `updated_at` | timestamp with time zone | obligatoria | `now()` |  |
| `costo_periodico` | numeric(14,2) |  | `0` |  |

### saldoinvdetalle

Vista · — filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.saldoinvdetalle is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | smallint |  |  |  |
| `idproducto` | smallint |  |  |  |
| `codproducto` | text |  |  |  |
| `nombreproducto` | text |  |  |  |
| `categoria` | text |  |  |  |
| `subcategoria` | text |  |  |  |
| `lote` | text |  |  |  |
| `location` | text |  |  |  |
| `stock_actual` | numeric |  |  |  |
| `stock_disp` | numeric |  |  |  |
| `stock_res` | numeric |  |  |  |

### sig_aspectos_ambientales

Tabla · — filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_aspectos_ambientales is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `actividad` + `aspecto`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_aspectos_ambientales_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `actividad` | text | obligatoria |  |  |
| `aspecto` | text | obligatoria |  |  |
| `impacto` | text |  |  |  |
| `tipo_recurso` | text |  |  |  |
| `condicion` | text |  | `'normal'::text` |  |
| `cumplimiento_legal` | boolean |  | `true` |  |
| `frecuencia` | integer |  | `3` |  |
| `severidad` | integer |  | `3` |  |
| `alcance` | integer |  | `3` |  |
| `significancia` | text |  | `'no_significativo'::text` |  |
| `control` | text |  |  |  |
| `responsable` | text |  |  |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_conteo_novedad_regla

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_conteo_novedad_regla is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_conteo_novedad_regla_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `codigo` | text | obligatoria |  |  |
| `patron` | text | obligatoria |  |  |
| `etiqueta` | text |  |  |  |
| `orden` | integer | obligatoria | `100` |  |
| `activo` | boolean | obligatoria | `true` |  |
| `creado_por` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### sig_conteo_parametro

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_conteo_parametro is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `clave`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_conteo_parametro_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `clave` | text | obligatoria |  |  |
| `valor` | text | obligatoria |  |  |
| `actualizado_por` | text |  |  |  |
| `updated_at` | timestamp with time zone | obligatoria | `now()` |  |

### sig_contexto_dofa

Tabla · 35 filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_contexto_dofa is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_contexto_dofa_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `cuadrante` | text | obligatoria |  |  |
| `origen` | text |  |  |  |
| `descripcion` | text | obligatoria |  |  |
| `orden` | integer |  | `0` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_documento_cobertura

Tabla · 321 filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_documento_cobertura is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `requisito_id` + `norma_id` + `soporte_id`

**Se liga a:** `norma_id` → `sig_normas`(id) · `requisito_id` → `sig_requisitos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_documento_cobertura_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `soporte_id` | bigint |  |  |  |
| `requisito_id` | integer | obligatoria |  |  |
| `norma_id` | integer | obligatoria |  |  |
| `estado` | text | obligatoria | `'pendiente'::text` |  |
| `observacion` | text |  |  |  |
| `actualizado_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `documento_id` | bigint |  |  |  |

### sig_documento_versiones

Tabla · — filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_documento_versiones is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_documento_versiones_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `documento_id` | uuid |  |  |  |
| `documento_codigo` | text |  |  |  |
| `version` | text |  |  |  |
| `version_anterior` | text |  |  |  |
| `tipo` | text | obligatoria | `'modificacion'::text` |  |
| `motivo` | text |  |  |  |
| `descripcion_cambio` | text |  |  |  |
| `responsable` | text |  |  |  |
| `fecha` | date |  | `now()` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_documentos

Tabla · 99 filas aprox. · 19 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_documentos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `codigo` | text |  |  |  |
| `nombre` | text |  |  |  |
| `tipo` | text |  |  |  |
| `proceso` | text |  |  |  |
| `version` | text |  |  |  |
| `soporte` | text |  |  |  |
| `estado` | text |  | `'Vigente'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `categoria` | text |  |  | Lista del Mapa de Procesos: formato \| informacion \| registro. NULL = documento previo sin clasificar, visible solo en el Listado Maestro. |
| `proceso_id` | text |  |  | Código del proceso del mapa (E-01, M-02, A-03, IN-01, OUT-01). Se guarda el código y no el nombre para que renombrar un proceso no deje huérfanos sus documentos. |
| `archivo_url` | text |  |  | Adjunto en el bucket "archivos". El mismo bucket que usa soportes_documentales. |
| `archivo_nombre` | text |  |  |  |
| `subido_por` | text |  |  |  |
| `actualizado_at` | timestamp with time zone |  | `now()` |  |
| `eliminado` | boolean | obligatoria | `false` | Retirado del listado sin borrarlo, con su motivo. Mismo criterio que soportes_documentales.eliminado. |
| `eliminado_motivo` | text |  |  |  |
| `eliminado_en` | timestamp with time zone |  |  |  |

### sig_indicadores

Tabla · 38 filas aprox. · 27 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_indicadores is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_indicadores_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `codigo` | text | obligatoria |  |  |
| `proceso_codigo` | text |  |  |  |
| `nombre` | text | obligatoria |  |  |
| `tipo` | text |  |  |  |
| `parte_interesada` | text |  |  |  |
| `formula` | text |  |  |  |
| `fuente` | text |  |  |  |
| `calculo_auto` | text |  |  |  |
| `unidad` | text |  |  |  |
| `meta` | numeric |  |  |  |
| `sentido` | text |  |  |  |
| `frecuencia` | text |  |  |  |
| `responsable` | text |  |  |  |
| `valor_manual` | numeric |  |  |  |
| `orden` | integer |  | `0` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `perspectiva` | text |  |  |  |
| `area` | text |  |  |  |
| `finalidad` | text |  |  |  |
| `cliente_interno` | text |  |  |  |
| `cliente_externo` | text |  |  |  |
| `contribucion` | text |  |  |  |
| `objetivo_id` | integer |  |  |  |
| `peso` | numeric | obligatoria | `0` | Peso % del indicador dentro de su área para la evaluación del responsable. Por área suma 100. 0 = informativo. |

### sig_indicadores_cache

Tabla · 58 filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_indicadores_cache is '...'`._

**Llave primaria:** `clave`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `clave` 🔑 | text | obligatoria |  |  |
| `valores` | jsonb | obligatoria |  |  |
| `computed_at` | timestamp with time zone | obligatoria | `now()` |  |

### sig_inventario_acta_cruce

Tabla · 4 filas aprox. · 14 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_inventario_acta_cruce is '...'`._

**Llave primaria:** `id`

**Unicidad:** `proyecto_id` + `mes`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_inventario_acta_cruce_id_seq'::regclass)` |  |
| `proyecto_id` | integer | obligatoria |  |  |
| `mes` | text | obligatoria |  |  |
| `fecha_corte` | date | obligatoria |  |  |
| `origen` | text |  | `'calculado'::text` |  |
| `estado` | text |  | `'borrador'::text` |  |
| `firmante` | text |  |  |  |
| `firmante_cargo` | text |  |  |  |
| `firma_url` | text |  |  |  |
| `fecha_firma` | date |  |  |  |
| `observaciones` | text |  |  |  |
| `creado_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sig_inventario_acta_cruce_detalle

Tabla · 363 filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_inventario_acta_cruce_detalle is '...'`._

**Llave primaria:** `id`

**Unicidad:** `acta_id` + `codproducto` + `lote` + `location`

**Se liga a:** `acta_id` → `sig_inventario_acta_cruce`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_inventario_acta_cruce_detalle_id_seq'::regclass)` |  |
| `acta_id` | integer | obligatoria |  |  |
| `codproducto` | text | obligatoria |  |  |
| `producto` | text |  |  |  |
| `lote` | text | obligatoria | `''::text` |  |
| `location` | text | obligatoria | `''::text` |  |
| `sistema_original` | numeric | obligatoria | `0` |  |
| `fisico_actual` | numeric | obligatoria | `0` |  |
| `diferencia` | numeric | obligatoria | `0` |  |
| `corregido` | boolean |  | `false` |  |
| `motivo_correccion` | text |  |  |  |
| `invtrans_id` | integer |  |  |  |
| `corregido_por` | text |  |  |  |
| `corregido_fecha` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sig_inventario_ajuste

Tabla · 512 filas aprox. · 21 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_inventario_ajuste is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_inventario_ajuste_id_seq'::regclass)` |  |
| `proyecto_id` | integer |  |  |  |
| `cuadre_id` | integer |  |  |  |
| `fecha` | date |  | `now()` |  |
| `codproducto` | text |  |  |  |
| `producto` | text |  |  |  |
| `lote` | text |  |  |  |
| `cantidad` | numeric |  | `0` |  |
| `tipo` | text |  |  |  |
| `motivo` | text |  |  |  |
| `responsable` | text |  |  |  |
| `soporte` | text |  |  |  |
| `estado` | text |  | `'registrado'::text` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `location` | text |  |  |  |
| `direccion` | text |  |  |  |
| `cod_movimiento` | text |  |  |  |
| `aprobado_por` | text |  |  |  |
| `aprobado_fecha` | timestamp with time zone |  |  |  |
| `invtrans_id` | bigint |  |  |  |

### sig_inventario_cierre_mes

Tabla · 28 filas aprox. · 25 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_inventario_cierre_mes is '...'`._

**Llave primaria:** `id`

**Unicidad:** `proyecto_id` + `mes`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_inventario_cierre_mes_id_seq'::regclass)` |  |
| `proyecto_id` | integer | obligatoria |  |  |
| `mes` | text | obligatoria |  |  |
| `estado` | text |  | `'pendiente'::text` |  |
| `saldo_inicial` | numeric |  | `0` |  |
| `ingresos` | numeric |  | `0` |  |
| `cargue` | numeric |  | `0` |  |
| `merma` | numeric |  | `0` |  |
| `salidas` | numeric |  | `0` |  |
| `saldo_final` | numeric |  | `0` |  |
| `faltante` | numeric |  | `0` |  |
| `ajuste` | numeric |  | `0` |  |
| `produccion` | numeric |  | `0` |  |
| `devolucion` | numeric |  | `0` |  |
| `documento_url` | text |  |  |  |
| `firmante` | text |  |  |  |
| `fecha_firma` | date |  |  |  |
| `observaciones` | text |  |  |  |
| `cerrado_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `fisico_congelado` | numeric |  |  |  |
| `fisico_snapshot` | jsonb |  |  |  |
| `firma_url` | text |  |  |  |
| `firmante_cargo` | text |  |  |  |

### sig_inventario_cuadre

Tabla · 37 filas aprox. · 23 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_inventario_cuadre is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_inventario_cuadre_id_seq'::regclass)` |  |
| `proyecto_id` | integer |  |  |  |
| `fecha` | date |  | `now()` |  |
| `tipo` | text |  | `'total'::text` |  |
| `almacen` | text |  |  |  |
| `responsable` | text |  |  |  |
| `estado` | text |  | `'borrador'::text` |  |
| `total_sistema` | numeric |  | `0` |  |
| `total_conteo` | numeric |  | `0` |  |
| `total_diferencia` | numeric |  | `0` |  |
| `items` | integer |  | `0` |  |
| `items_con_diferencia` | integer |  | `0` |  |
| `observaciones` | text |  |  |  |
| `creado_por` | text |  |  |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `cliente_firmante` | text |  |  |  |
| `cliente_cargo` | text |  |  |  |
| `fecha_firma` | date |  |  |  |
| `firmado` | boolean |  | `false` |  |
| `acta_observaciones` | text |  |  |  |
| `firma_url` | text |  |  |  |

### sig_inventario_cuadre_detalle

Tabla · 3.392 filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_inventario_cuadre_detalle is '...'`._

**Llave primaria:** `id`

**Unicidad:** `cuadre_id` + `codproducto` + `lote` + `location`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_inventario_cuadre_detalle_id_seq'::regclass)` |  |
| `cuadre_id` | integer | obligatoria |  |  |
| `codproducto` | text |  |  |  |
| `producto` | text |  |  |  |
| `lote` | text |  | `''::text` |  |
| `location` | text |  | `''::text` |  |
| `sistema` | numeric |  | `0` |  |
| `conteo` | numeric |  | `0` |  |
| `diferencia` | numeric |  | `0` |  |
| `observacion` | text |  |  |  |
| `contado_por` | text |  |  |  |
| `contado_en` | timestamp with time zone |  |  |  |

### sig_metas_colaborador

Tabla · — filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_metas_colaborador is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_metas_colaborador_id_seq'::regclass)` |  |
| `colaborador_id` | bigint |  |  |  |
| `identificacion` | text |  |  |  |
| `idempresa` | integer |  |  |  |
| `sig_objetivo_id` | integer |  |  |  |
| `area` | text |  |  |  |
| `indicador` | text | obligatoria |  |  |
| `meta` | numeric |  |  |  |
| `unidad` | text |  | `'%'::text` |  |
| `sentido` | text |  | `'mayor_mejor'::text` |  |
| `periodo` | text |  |  |  |
| `valor_actual` | numeric |  |  |  |
| `estado` | text |  | `'en_curso'::text` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_nc_catalogo

Tabla · 29 filas aprox. · 13 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_nc_catalogo is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `proceso_codigo` + `descripcion`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_nc_catalogo_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `proceso_codigo` | text | obligatoria |  |  |
| `etapa` | text |  |  |  |
| `descripcion` | text | obligatoria |  |  |
| `tipo` | text |  |  |  |
| `afecta_cliente` | boolean |  | `false` |  |
| `requisito_iso` | text |  |  |  |
| `deteccion` | text |  |  |  |
| `accion` | text |  |  |  |
| `orden` | integer |  | `0` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_no_conformidades

Tabla · — filas aprox. · 23 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_no_conformidades is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_no_conformidades_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `codigo` | text |  |  |  |
| `proceso_codigo` | text |  |  |  |
| `catalogo_id` | integer |  |  |  |
| `fecha` | date |  | `now()` |  |
| `origen` | text |  |  |  |
| `descripcion` | text | obligatoria |  |  |
| `tipo` | text |  |  |  |
| `afecta_cliente` | boolean |  | `false` |  |
| `requisito_incumplido` | text |  |  |  |
| `correccion` | text |  |  |  |
| `causa_raiz` | text |  |  |  |
| `accion_correctiva` | text |  |  |  |
| `responsable` | text |  |  |  |
| `fecha_compromiso` | date |  |  |  |
| `fecha_cierre` | date |  |  |  |
| `estado` | text |  | `'abierta'::text` |  |
| `eficacia` | text |  | `'pendiente'::text` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `proyecto_id` | integer |  |  |  |

### sig_normas

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_normas is '...'`._

**Llave primaria:** `id`

**Unicidad:** `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_normas_id_seq'::regclass)` |  |
| `codigo` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `descripcion` | text |  |  |  |
| `color` | text |  |  |  |
| `orden` | integer |  | `0` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_objetivos

Tabla · — filas aprox. · 14 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_objetivos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `objetivo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_objetivos_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `norma_codigo` | text |  |  |  |
| `objetivo` | text | obligatoria |  |  |
| `meta` | text |  |  |  |
| `indicador` | text |  |  |  |
| `unidad` | text |  |  |  |
| `linea_base` | text |  |  |  |
| `valor_actual` | text |  |  |  |
| `fecha_meta` | date |  |  |  |
| `responsable` | text |  |  |  |
| `estado` | text |  | `'en_curso'::text` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_pqrsf

Tabla · — filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_pqrsf is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_pqrsf_id_seq'::regclass)` |  |
| `proyecto_id` | integer |  |  |  |
| `fecha` | date |  | `now()` |  |
| `tipo` | text |  | `'queja'::text` |  |
| `parte_interesada` | text |  |  |  |
| `canal` | text |  |  |  |
| `descripcion` | text | obligatoria |  |  |
| `responsable` | text |  |  |  |
| `estado` | text |  | `'abierta'::text` |  |
| `respuesta` | text |  |  |  |
| `fecha_compromiso` | date |  |  |  |
| `fecha_cierre` | date |  |  |  |
| `dias_respuesta` | integer |  |  |  |
| `genera_nc` | boolean |  | `false` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_proceso_interaccion

Tabla · — filas aprox. · 14 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_proceso_interaccion is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `orden`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_proceso_interaccion_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `orden` | integer | obligatoria |  |  |
| `fase` | text | obligatoria |  |  |
| `paso` | text | obligatoria |  |  |
| `responsable` | text |  |  |  |
| `es_valor_agregado` | boolean |  | `false` |  |
| `accion_lipgo` | text |  |  |  |
| `modulo_lipgo` | text |  |  |  |
| `evidencia` | text |  |  |  |
| `campo_dato` | text |  |  |  |
| `norma_iso` | text |  |  |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_procesos

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_procesos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_procesos_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `codigo` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `tipo` | text | obligatoria |  |  |
| `responsable` | text |  |  |  |
| `objetivo` | text |  |  |  |
| `orden` | integer |  | `0` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_requisito_modulo

Tabla · — filas aprox. · 11 columnas

Numerales de la Matriz Integrada que se sustentan con un módulo de LIPgo en vez de un archivo. Ver scripts/sig/59.

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `requisito_id` + `norma_id` + `modulo` (parcial) · `idempresa` + `requisito_id` + `modulo` (parcial)

**Se liga a:** `norma_id` → `sig_normas`(id) · `requisito_id` → `sig_requisitos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_requisito_modulo_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `requisito_id` | integer | obligatoria |  |  |
| `norma_id` | integer |  |  | NULL = aplica a todas las normas donde el requisito aplique. |
| `modulo` | text | obligatoria |  | Nombre visible del módulo, idéntico a lib/dashboard-data.ts / MODULE_PERMISSION_MAP. |
| `tabla` | text |  |  | Tabla de respaldo para contar registros vivos. Catálogo curado: NO aceptar entrada de usuario. |
| `nota` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `actualizado_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sig_requisito_norma

Tabla · 111 filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_requisito_norma is '...'`._

**Llave primaria:** `id`

**Unicidad:** `requisito_id` + `norma_id`

**Se liga a:** `norma_id` → `sig_normas`(id) · `requisito_id` → `sig_requisitos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_requisito_norma_id_seq'::regclass)` |  |
| `requisito_id` | integer | obligatoria |  |  |
| `norma_id` | integer | obligatoria |  |  |
| `texto` | text |  |  |  |
| `aplica` | boolean |  | `true` |  |
| `peso` | numeric | obligatoria | `1` |  |

### sig_requisitos

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_requisitos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `numeral`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_requisitos_id_seq'::regclass)` |  |
| `numeral` | text | obligatoria |  |  |
| `tema` | text | obligatoria |  |  |
| `es_comun` | text | obligatoria | `'no'::text` |  |
| `evidencia_comun_sugerida` | text |  |  |  |
| `orden` | integer |  | `0` |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_requisitos_legales

Tabla · — filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_requisitos_legales is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `identificacion`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_requisitos_legales_id_seq'::regclass)` |  |
| `idempresa` | integer |  |  |  |
| `norma_codigo` | text |  | `'ISO14001'::text` |  |
| `tipo_norma` | text |  |  |  |
| `identificacion` | text |  |  |  |
| `titulo` | text |  |  |  |
| `requisito` | text |  |  |  |
| `como_cumple` | text |  |  |  |
| `cumple` | text |  | `'cumple'::text` |  |
| `responsable` | text |  |  |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sig_satisfaccion

Tabla · 1.598 filas aprox. · 18 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_satisfaccion is '...'`._

**Llave primaria:** `id`

**Unicidad:** `ref_orden` (parcial)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_satisfaccion_id_seq'::regclass)` |  |
| `proyecto_id` | integer |  |  |  |
| `tipo` | text |  | `'cliente'::text` |  |
| `fecha` | date |  | `now()` |  |
| `periodo` | text |  |  |  |
| `encuestado` | text |  |  |  |
| `calificacion` | numeric |  |  |  |
| `oportunidad` | numeric |  |  |  |
| `calidad` | numeric |  |  |  |
| `comunicacion` | numeric |  |  |  |
| `recomendaria` | boolean |  |  |  |
| `comentario` | text |  |  |  |
| `canal` | text |  |  | De donde vino la respuesta: encuesta_conductor = enlace de WhatsApp al celular del conductor; kiosko = dispositivo de LIP en sitio; telefonico/presencial = digitada por alguien de LIP; historico = generada por el poblado del periodo anterior al corte. |
| `responsable` | text |  |  |  |
| `activo` | boolean |  | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `ref_orden` | text |  |  | Orden de cargue calificada (cabeceraoc.ordendecargue, el codigo). NULL en las encuestas digitadas a mano. |
| `placa` | text |  |  |  |

### sig_tipos_movimiento

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sig_tipos_movimiento is '...'`._

**Llave primaria:** `id`

**Unicidad:** `codigo_sap`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sig_tipos_movimiento_id_seq'::regclass)` |  |
| `codigo_sap` | text |  |  |  |
| `nombre` | text | obligatoria |  |  |
| `clase` | text | obligatoria |  |  |
| `origen_lipgo` | text |  |  |  |
| `descripcion` | text |  |  |  |
| `afecta_stock` | boolean |  | `true` |  |
| `orden` | integer |  | `0` |  |
| `activo` | boolean |  | `true` |  |

### siigo_clientes

Tabla · 1.249 filas aprox. · 23 columnas

Copia local de los clientes/terceros de Siigo. Ver scripts/229.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | text | obligatoria |  |  |
| `identificacion` | text |  |  |  |
| `digito_verificacion` | text |  |  |  |
| `tipo_identificacion` | text |  |  |  |
| `sucursal` | integer |  |  |  |
| `nombre` | text |  |  |  |
| `nombre_comercial` | text |  |  |  |
| `tipo` | text |  |  |  |
| `tipo_persona` | text |  |  |  |
| `activo` | boolean |  | `true` |  |
| `responsable_iva` | boolean |  |  |  |
| `direccion` | text |  |  |  |
| `ciudad` | text |  |  |  |
| `departamento` | text |  |  |  |
| `pais` | text |  |  |  |
| `telefono` | text |  |  |  |
| `email` | text |  |  |  |
| `responsabilidades_fiscales` | jsonb |  | `'[]'::jsonb` |  |
| `contactos` | jsonb |  | `'[]'::jsonb` |  |
| `observaciones` | text |  |  |  |
| `siigo_creado` | timestamp with time zone |  |  |  |
| `siigo_actualizado` | timestamp with time zone |  |  |  |
| `sincronizado_en` | timestamp with time zone |  | `now()` |  |

### siigo_emision_config

Tabla · — filas aprox. · 13 columnas

_Sin descripción. Se escribe en la base con `comment on table public.siigo_emision_config is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `1` |  |
| `documento_id` | integer |  |  |  |
| `vendedor_id` | integer |  |  |  |
| `forma_pago_id` | integer |  |  |  |
| `forma_pago_credito_id` | integer |  |  |  |
| `impuesto_id` | integer |  |  |  |
| `centro_costo` | integer |  |  |  |
| `producto_codigo` | text |  |  |  |
| `enviar_dian` | boolean | obligatoria | `false` | true = la factura sale firmada y oficial al crearla, y ya NO se puede borrar (solo anular con nota credito). Arranca en false. |
| `enviar_correo` | boolean | obligatoria | `false` |  |
| `actualizado_por` | text |  |  |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### siigo_facturas

Tabla · 4.000 filas aprox. · 21 columnas

Copia local de las facturas de Siigo. La llave es el id de Siigo: reimportar actualiza, no duplica. Ver scripts/206.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | text | obligatoria |  |  |
| `numero` | bigint |  |  |  |
| `nombre` | text |  |  |  |
| `documento_id` | integer |  |  |  |
| `fecha` | date |  |  |  |
| `cliente_id` | text |  |  |  |
| `cliente_identificacion` | text |  |  |  |
| `cliente_nombre` | text |  |  |  |
| `cliente_sucursal` | text |  |  |  |
| `total` | numeric(18,2) |  |  |  |
| `saldo` | numeric(18,2) |  |  |  |
| `moneda` | text |  | `'COP'::text` |  |
| `tasa_cambio` | numeric(18,6) |  |  |  |
| `centro_costo` | integer |  |  |  |
| `vendedor` | integer |  |  |  |
| `observaciones` | text |  |  |  |
| `items` | jsonb |  | `'[]'::jsonb` |  |
| `pagos` | jsonb |  | `'[]'::jsonb` |  |
| `siigo_creada` | timestamp with time zone |  |  |  |
| `siigo_actualizada` | timestamp with time zone |  |  | last_updated de Siigo. Es la marca con la que se pide solo lo nuevo en la siguiente sincronizacion. |
| `sincronizada_en` | timestamp with time zone |  | `now()` |  |

### siigo_facturas_emitidas

Tabla · — filas aprox. · 18 columnas

Bitacora de las facturas creadas en Siigo desde LIPgo. Guarda la peticion y la respuesta completas: una factura electronica no se borra, y si sale mal esta es la unica forma de reconstruir que paso. Ver scripts/230.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('siigo_facturas_emitidas_id_seq'::regclass)` |  |
| `siigo_id` | text |  |  |  |
| `siigo_numero` | bigint |  |  |  |
| `siigo_nombre` | text |  |  |  |
| `cufe` | text |  |  |  |
| `estado_dian` | text |  |  |  |
| `ordenes` | bigint[] | obligatoria | `'{}'::bigint[]` |  |
| `cliente_identificacion` | text |  |  |  |
| `cliente_nombre` | text |  |  |  |
| `valor_total` | numeric(18,2) |  |  |  |
| `peticion` | jsonb |  |  |  |
| `respuesta` | jsonb |  |  |  |
| `exitosa` | boolean | obligatoria | `false` |  |
| `error` | text |  |  |  |
| `origen` | text | obligatoria | `'ciclo'::text` |  |
| `emitida_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `prefactura_id` | bigint |  |  | Prefactura facturada, cuando el origen es "ciclo". NULL cuando se factura una orden suelta desde Pagos de Contado. |

### siigo_formas_pago

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.siigo_formas_pago is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `tipo` | text |  |  |  |
| `activo` | boolean |  | `true` |  |
| `maneja_vencimiento` | boolean |  |  |  |
| `sincronizado_en` | timestamp with time zone |  | `now()` |  |

### siigo_impuestos

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.siigo_impuestos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `tipo` | text |  |  |  |
| `porcentaje` | numeric(9,4) |  |  |  |
| `activo` | boolean |  | `true` |  |
| `sincronizado_en` | timestamp with time zone |  | `now()` |  |

### siigo_maestros_estado

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.siigo_maestros_estado is '...'`._

**Llave primaria:** `maestro`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `maestro` 🔑 | text | obligatoria |  |  |
| `ultima_actualizacion` | timestamp with time zone |  |  |  |
| `ultima_corrida` | timestamp with time zone |  |  |  |
| `ultimo_resultado` | text |  |  |  |
| `registros` | integer |  | `0` |  |
| `corriendo` | boolean | obligatoria | `false` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### siigo_owner_cliente

Tabla · — filas aprox. · 5 columnas

Puente entre los owners de LIPgo y los terceros de Siigo. Evita elegir el cliente a mano en cada factura, que es donde se cometeria el error mas caro.

**Llave primaria:** `owner`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `owner` 🔑 | text | obligatoria |  |  |
| `cliente_identificacion` | text | obligatoria |  |  |
| `cliente_nombre` | text |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### siigo_productos

Tabla · — filas aprox. · 24 columnas

Copia local de los productos de Siigo. La llave es el id de Siigo: reimportar actualiza, no duplica. Ver scripts/229.

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | text | obligatoria |  |  |
| `codigo` | text |  |  |  |
| `nombre` | text |  |  |  |
| `referencia` | text |  |  |  |
| `descripcion` | text |  |  |  |
| `tipo` | text |  |  |  |
| `activo` | boolean |  | `true` |  |
| `controla_inventario` | boolean |  |  |  |
| `grupo_id` | integer |  |  |  |
| `grupo_nombre` | text |  |  |  |
| `unidad_codigo` | text |  |  |  |
| `unidad_nombre` | text |  |  |  |
| `precio` | numeric(18,2) |  |  |  |
| `precios` | jsonb |  | `'[]'::jsonb` |  |
| `impuestos` | jsonb |  | `'[]'::jsonb` |  |
| `clasificacion_impuesto` | text |  |  |  |
| `impuesto_incluido` | boolean |  |  |  |
| `cantidad_disponible` | numeric(18,3) |  |  |  |
| `bodegas` | jsonb |  | `'[]'::jsonb` |  |
| `codigo_barras` | text |  |  |  |
| `marca` | text |  |  |  |
| `siigo_creado` | timestamp with time zone |  |  |  |
| `siigo_actualizado` | timestamp with time zone |  |  |  |
| `sincronizado_en` | timestamp with time zone |  | `now()` |  |

### siigo_sync_estado

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.siigo_sync_estado is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `1` |  |
| `ultima_actualizacion` | timestamp with time zone |  |  |  |
| `ultima_corrida` | timestamp with time zone |  |  |  |
| `ultimo_resultado` | text |  |  |  |
| `facturas_totales` | integer |  | `0` |  |
| `corriendo` | boolean | obligatoria | `false` | Evita que dos sincronizaciones corran a la vez y se pisen. Se libera al terminar, incluso con error. |
| `created_at` | timestamp with time zone |  | `now()` |  |

### solicitud_horas_extras

Vista · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.solicitud_horas_extras is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id_solicitud` | bigint |  |  |  |
| `fecharequerida` | date |  |  |  |
| `idempresa` | smallint |  |  |  |
| `puesto` | text |  |  |  |
| `nombre_empleado` | text |  |  |  |
| `identificacion_empleado` | text |  |  |  |
| `cantidad` | integer |  |  |  |

### solicitudes_trabajadores

Tabla · 113 filas aprox. · 21 columnas

_Sin descripción. Se escribe en la base con `comment on table public.solicitudes_trabajadores is '...'`._

**Llave primaria:** `id`

**Se liga a:** `colaborador_id` → `headcount`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `colaborador_id` | bigint |  |  |  |
| `tipo` | text | obligatoria |  |  |
| `estado` | text |  | `'pendiente'::text` |  |
| `monto_anticipo` | numeric |  |  |  |
| `firma_trabajador` | text |  |  |  |
| `tipo_permiso` | text |  |  |  |
| `fecha_inicio_permiso` | date |  |  |  |
| `fecha_fin_permiso` | date |  |  |  |
| `comentarios` | text |  |  |  |
| `url_soporte` | text |  |  |  |
| `url_documento_final` | text |  |  |  |
| `motivo_rechazo` | text |  |  |  |
| `fecha_solicitud` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `monto` | numeric |  |  |  |
| `url_evidencia_firma` | text |  |  |  |
| `url_comprobante_pago` | text |  |  |  |
| `permiso_aprobacion_gh` | text |  | `'pendiente'::text` |  |
| `permiso_aprobacion_coord` | text |  | `'pendiente'::text` |  |
| `fecha_aprobacion` | date |  |  |  |

### solicitudesturnos

Tabla · 228 filas aprox. · 17 columnas

_Sin descripción. Se escribe en la base con `comment on table public.solicitudesturnos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fechasolicitud` | date | obligatoria |  |  |
| `idempresa` | smallint |  |  |  |
| `puesto` | text |  |  |  |
| `fecharequerida` | date |  |  |  |
| `nombresolicitante` | text |  |  |  |
| `estado` | text |  |  |  |
| `nombreaprobo` | text |  |  |  |
| `cantidad` | numeric |  |  |  |
| `firmasolicitante` | text |  |  |  |
| `firmaaprobo` | text |  |  |  |
| `fechahoraprobo` | timestamp with time zone |  |  |  |
| `pdfaprobacion` | text |  |  |  |
| `usuariosolicitud` | text |  |  |  |
| `personal` | text |  |  |  |
| `tipo` | text |  |  |  |
| `personal_identificaciones` | text |  |  | Cedulas del personal asignado, separadas por coma y en el MISMO orden que `personal`. La escribe la aprobacion del coordinador; alimenta solicitud_horas_extras.identificacion_empleado. |

### soportes_documentales

Tabla · 41 filas aprox. · 18 columnas

_Sin descripción. Se escribe en la base con `comment on table public.soportes_documentales is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `norma` | text | obligatoria | `'SIG'::text` |  |
| `modulo` | text | obligatoria |  |  |
| `referencia_tipo` | text | obligatoria |  |  |
| `referencia_id` | text | obligatoria |  |  |
| `referencia_desc` | text |  |  |  |
| `archivo_url` | text | obligatoria |  |  |
| `archivo_nombre` | text |  |  |  |
| `tipo_archivo` | text |  |  |  |
| `tamano` | bigint |  |  |  |
| `subido_por` | text |  |  |  |
| `observacion` | text |  |  |  |
| `vigente` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `eliminado` | boolean | obligatoria | `false` | Soporte retirado (subido por error, archivo equivocado). Distinto de vigente=false, que es un histórico legítimo y sí se muestra como evidencia. |
| `eliminado_en` | timestamp with time zone |  |  | Cuándo se retiró. Se conserva junto con el motivo para poder explicar el retiro en una auditoría. |
| `eliminado_motivo` | text |  |  | Por qué se retiró. Se exige al quitarlo: sin motivo, dentro de un año nadie sabe si fue un error o una maniobra. |

### sst_actividades

Tabla · — filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_actividades is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `tipo` | text |  |  |  |
| `tema` | text | obligatoria |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `facilitador` | text |  |  |  |
| `n_asistentes` | integer |  | `0` |  |
| `duracion_horas` | numeric(5,1) |  |  |  |
| `evidencia_url` | text |  |  |  |
| `observacion` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_autoeval_respuestas

Tabla · 60 filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_autoeval_respuestas is '...'`._

**Llave primaria:** `id`

**Unicidad:** `autoevaluacion_id` + `item_id`

**Se liga a:** `autoevaluacion_id` → `sst_autoevaluaciones`(id) · `item_id` → `sst_estandar_items`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `autoevaluacion_id` | bigint | obligatoria |  |  |
| `item_id` | bigint | obligatoria |  |  |
| `cumple` | text | obligatoria | `'no_cumple'::text` |  |
| `puntaje_obtenido` | numeric(5,2) |  | `0` |  |
| `observacion` | text |  |  |  |
| `soporte_url` | text |  |  |  |
| `justifica_no_aplica` | boolean |  | `false` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_autoevaluaciones

Tabla · 1 filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_autoevaluaciones is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `anio` + `sede`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `anio` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `responsable` | text |  |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `estado` | text |  | `'en_proceso'::text` |  |
| `puntaje_total` | numeric(5,2) |  | `0` |  |
| `valoracion` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `firma` | text |  |  |  |

### sst_autorreportes

Tabla · — filas aprox. · 13 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_autorreportes is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `trabajador` | text |  |  |  |
| `tipo` | text |  |  |  |
| `descripcion` | text | obligatoria |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `estado` | text |  | `'abierto'::text` |  |
| `accion` | text |  |  |  |
| `responsable` | text |  |  |  |
| `fecha_cierre` | date |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_capacitacion_asistencia

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_capacitacion_asistencia is '...'`._

**Llave primaria:** `id`

**Se liga a:** `capacitacion_id` → `sst_capacitaciones`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `capacitacion_id` | bigint | obligatoria |  |  |
| `colaborador_id` | bigint |  |  |  |
| `asistio` | boolean |  | `true` |  |
| `nota_evaluacion` | numeric(5,2) |  |  |  |
| `aprobado` | boolean |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_capacitaciones

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_capacitaciones is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `tema` | text | obligatoria |  |  |
| `tipo` | text |  | `'pyp'::text` |  |
| `facilitador` | text |  |  |  |
| `fecha` | date |  |  |  |
| `duracion_horas` | numeric(5,1) |  |  |  |
| `evidencia_url` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_comite_actas

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_comite_actas is '...'`._

**Llave primaria:** `id`

**Se liga a:** `comite_id` → `sst_comites`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `comite_id` | bigint | obligatoria |  |  |
| `fecha` | date |  |  |  |
| `tipo_reunion` | text |  | `'ordinaria'::text` |  |
| `temas` | text |  |  |  |
| `compromisos` | text |  |  |  |
| `acta_url` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_comite_miembros

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_comite_miembros is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `comite` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `documento` | text |  |  |  |
| `rol` | text |  |  |  |
| `periodo_inicio` | date |  |  |  |
| `periodo_fin` | date |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_comites

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_comites is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `tipo` | text |  |  |  |
| `sede` | text |  |  |  |
| `periodo_inicio` | date |  |  |  |
| `periodo_fin` | date |  |  |  |
| `estado` | text |  | `'vigente'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_comunicaciones

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_comunicaciones is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `tema` | text | obligatoria |  |  |
| `dirigido_a` | text |  |  |  |
| `medio` | text |  |  |  |
| `frecuencia` | text |  |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `evidencia_url` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_entrega_epp

Tabla · — filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_entrega_epp is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `trabajador` | text | obligatoria |  |  |
| `cedula` | text |  |  |  |
| `cargo` | text |  |  |  |
| `tipo_persona` | text |  | `'propio'::text` |  |
| `elemento` | text | obligatoria |  |  |
| `cantidad` | integer |  | `1` |  |
| `motivo` | text |  | `'entrega_inicial'::text` |  |
| `motivo_reposicion` | text |  |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `firma` | text |  |  |  |
| `observacion` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_equipos

Tabla · — filas aprox. · 27 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_equipos is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `identificacion` · `codigo_qr`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `tipo` | text | obligatoria |  |  |
| `identificacion` | text | obligatoria |  |  |
| `marca` | text |  |  |  |
| `modelo` | text |  |  |  |
| `serie` | text |  |  |  |
| `fecha_ingreso` | date |  |  |  |
| `horometro` | numeric(10,1) |  |  |  |
| `estado` | text |  | `'operativo'::text` |  |
| `observaciones` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `codigo_qr` | text |  | `(gen_random_uuid())::text` |  |
| `alias` | text |  |  |  |
| `anio` | integer |  |  |  |
| `capacidad_kg` | numeric |  |  |  |
| `tipo_energia` | text |  |  |  |
| `altura_elevacion_mm` | numeric |  |  |  |
| `tipo_llanta` | text |  |  |  |
| `frecuencia_preventivo_horas` | integer |  |  |  |
| `frecuencia_preventivo_dias` | integer |  |  |  |
| `horometro_actual` | numeric |  |  |  |
| `horometro_ultimo_preventivo` | numeric |  |  |  |
| `fecha_ultimo_preventivo` | date |  |  |  |
| `activo` | boolean | obligatoria | `true` |  |

### sst_estandar_evidencia

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_estandar_evidencia is '...'`._

**Llave primaria:** `id`

**Unicidad:** `numeral`

**Se liga a:** `numeral` → `sst_estandar_items`(numeral)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `numeral` | text | obligatoria |  |  |
| `modulo` | text | obligatoria |  |  |
| `tabla` | text |  |  |  |
| `documento` | text |  |  |  |
| `descripcion` | text |  |  |  |

### sst_estandar_items

Tabla · 60 filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_estandar_items is '...'`._

**Llave primaria:** `id`

**Unicidad:** `numeral`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `ciclo` | text | obligatoria |  |  |
| `estandar` | text | obligatoria |  |  |
| `numeral` | text | obligatoria |  |  |
| `item` | text | obligatoria |  |  |
| `peso` | numeric(5,2) | obligatoria |  |  |
| `modo_aplica` | text |  | `'todos'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_gestion_cambio

Tabla · — filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_gestion_cambio is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `tipo_cambio` | text |  |  |  |
| `descripcion` | text | obligatoria |  |  |
| `fecha_reporte` | date |  | `CURRENT_DATE` |  |
| `impacto_sst` | text |  |  |  |
| `controles` | text |  |  |  |
| `ipevr_actualizado` | boolean |  | `false` |  |
| `capacitacion_realizada` | boolean |  | `false` |  |
| `estado` | text |  | `'evaluacion'::text` |  |
| `fecha_implementacion` | date |  |  |  |
| `responsable` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_incidente_acciones

Tabla · 20 filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_incidente_acciones is '...'`._

**Llave primaria:** `id`

**Se liga a:** `incidente_id` → `sst_incidentes`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `incidente_id` | bigint | obligatoria |  |  |
| `plan` | text | obligatoria |  |  |
| `tipo_control` | text |  |  |  |
| `fecha_implementacion` | date |  |  |  |
| `responsable_ejecucion` | text |  |  |  |
| `fecha_verificacion` | date |  |  |  |
| `responsable_verificacion` | text |  |  |  |
| `observacion` | text |  |  |  |
| `estado` | text |  | `'pendiente'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_incidente_testigos

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_incidente_testigos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `incidente_id` → `sst_incidentes`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `incidente_id` | bigint | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `cargo` | text |  |  |  |
| `documento` | text |  |  |  |
| `version` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_incidentes

Tabla · 13 filas aprox. · 108 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_incidentes is '...'`._

**Llave primaria:** `id`

**Se liga a:** `ausentismo_id` → `ausentismosst`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `tipo` | text | obligatoria | `'accidente'::text` |  |
| `gravedad` | text |  |  |  |
| `trabajador` | text |  |  |  |
| `cargo` | text |  |  |  |
| `tipo_vinculacion` | text |  |  |  |
| `ocupacion_habitual` | text |  |  |  |
| `antiguedad_dias` | integer |  |  |  |
| `funciones_asignadas` | text |  |  |  |
| `epp_portado` | text |  |  |  |
| `fecha_evento` | date | obligatoria | `CURRENT_DATE` |  |
| `hora_evento` | time without time zone |  |  |  |
| `dia_semana` | text |  |  |  |
| `departamento_evento` | text |  |  |  |
| `municipio_evento` | text |  |  |  |
| `zona_evento` | text |  |  |  |
| `area_ocurrencia` | text |  |  |  |
| `lugar_ocurrencia` | text |  |  |  |
| `jornada_evento` | text |  |  |  |
| `labor_habitual` | boolean |  |  |  |
| `tiempo_previo_horas` | integer |  |  |  |
| `tiempo_previo_min` | integer |  |  |  |
| `tipo_accidente` | text |  |  |  |
| `causo_muerte` | boolean |  | `false` |  |
| `tipo_lesion` | text |  |  |  |
| `parte_cuerpo` | text |  |  |  |
| `agente_accidente` | text |  |  |  |
| `mecanismo` | text |  |  |  |
| `descripcion` | text |  |  |  |
| `testigos_presenciaron` | boolean |  |  |  |
| `reportado_arl` | boolean |  | `false` |  |
| `fecha_reporte_arl` | date |  |  |  |
| `furat_radicado` | text |  |  |  |
| `reportado_mintrabajo` | boolean |  | `false` |  |
| `equipo_investigador` | text |  |  |  |
| `metodologia` | text |  |  |  |
| `causas_inmediatas` | text |  |  |  |
| `causas_basicas` | text |  |  |  |
| `observaciones_investigadores` | text |  |  |  |
| `plan_accion` | text |  |  |  |
| `fecha_investigacion` | date |  |  |  |
| `primeros_auxilios` | boolean |  |  |  |
| `remitido_centro_salud` | boolean |  |  |  |
| `centro_salud` | text |  |  |  |
| `hospitalizado` | boolean |  |  |  |
| `dias_incapacidad` | integer |  | `0` |  |
| `dias_incapacidad_inicial` | integer |  |  |  |
| `dias_prorroga` | integer |  | `0` |  |
| `cie10_codigo` | text |  |  |  |
| `cie10_diagnostico` | text |  |  |  |
| `estado` | text |  | `'reportado'::text` |  |
| `fecha_cierre` | date |  |  |  |
| `soporte_url` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `ishikawa` | jsonb |  |  |  |
| `causa_actos_inseguros` | text |  |  |  |
| `causa_condiciones_inseguras` | text |  |  |  |
| `causa_factores_personales` | text |  |  |  |
| `causa_factores_trabajo` | text |  |  |  |
| `ausentismo_id` | uuid |  |  |  |
| `documento_tipo` | text |  |  |  |
| `documento_numero` | text |  |  |  |
| `fecha_nacimiento` | date |  |  |  |
| `sexo` | text |  |  |  |
| `eps` | text |  |  |  |
| `arl` | text |  |  |  |
| `afp` | text |  |  |  |
| `salario` | numeric |  |  |  |
| `codigo_ocupacion` | text |  |  |  |
| `fecha_ingreso` | date |  |  |  |
| `jornada_habitual` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `centro_direccion` | text |  |  |  |
| `centro_municipio` | text |  |  |  |
| `codigo_actividad` | text |  |  |  |
| `fecha_reporte` | date |  |  |  |
| `tiempo_laborado_previo` | text |  |  |  |
| `dentro_fuera_empresa` | text |  |  |  |
| `requirio_transporte` | boolean |  |  |  |
| `ausentismo_tipo` | text |  |  |  |
| `ausentismo_fecha_inicial` | date |  |  |  |
| `ausentismo_fecha_final` | date |  |  |  |
| `divulgacion_leccion` | text |  |  |  |
| `charla_seguridad` | text |  |  |  |
| `retroalimentacion` | text |  |  |  |
| `firmas` | jsonb |  |  |  |
| `documento_url` | text |  |  |  |
| `documento_editable_url` | text |  |  |  |
| `cierre_arl` | boolean | obligatoria | `false` | La ARL ya cerró el expediente del evento. Distinto de `fecha_cierre`, que es el cierre de la investigación interna. |
| `fecha_cierre_arl` | date |  |  | Fecha en que se marcó el cierre del expediente ARL. Se pone sola al marcar el check y se limpia al desmarcarlo. |
| `centro_departamento` | text |  |  |  |
| `centro_telefono` | text |  |  |  |
| `centro_zona` | text |  |  | Urbana / Rural del CENTRO DE TRABAJO. Distinto de zona_evento, que es la del lugar del accidente. |
| `telefono` | text |  |  |  |
| `fax` | text |  |  |  |
| `direccion_trabajador` | text |  |  |  |
| `eps_codigo` | text |  |  |  |
| `arl_codigo` | text |  |  |  |
| `afp_codigo` | text |  |  |  |
| `antiguedad_meses` | integer |  |  | Antigüedad en el cargo, casilla "Meses" del formato. Se acompaña de antiguedad_dias y antiguedad_anios. |
| `antiguedad_anios` | integer |  |  |  |
| `lugar_otro` | text |  |  | Texto de la opción "9. Otros especifica" del lugar donde ocurrió el evento. |
| `tipo_lesion_otro` | text |  |  | Texto de la opción "16. Otro (especificar)" del tipo de lesión. |
| `agente_otro` | text |  |  | Texto de la opción "8. Otros Agentes no clasificados" del agente del accidente. |
| `mecanismo_otro` | text |  |  | Texto de la opción "10. Otro (especificar)" del mecanismo o forma del accidente. |

### sst_indicadores

Tabla · 208 filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_indicadores is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `periodo` + `tipo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `periodo` | text | obligatoria |  |  |
| `tipo` | text | obligatoria |  |  |
| `valor` | numeric(12,3) |  |  |  |
| `meta` | numeric(12,3) |  |  |  |
| `unidad` | text |  |  |  |
| `numerador` | numeric(14,2) |  |  |  |
| `denominador` | numeric(14,2) |  |  |  |
| `observacion` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_indicadores_definicion

Tabla · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_indicadores_definicion is '...'`._

**Llave primaria:** `tipo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `tipo` 🔑 | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `formula` | text | obligatoria |  |  |
| `periodicidad` | text |  |  |  |

### sst_inspecciones

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_inspecciones is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `tipo` | text |  |  |  |
| `sede` | text |  |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `responsable` | text |  |  |  |
| `hallazgos` | text |  |  |  |
| `estado` | text |  | `'abierta'::text` |  |
| `evidencia_url` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### sst_ipevr

Tabla · 42 filas aprox. · 40 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_ipevr is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `proceso` | text |  |  |  |
| `zona` | text |  |  |  |
| `actividad` | text |  |  |  |
| `rutinaria` | boolean |  | `true` |  |
| `clasificacion_peligro` | text |  |  |  |
| `descripcion_peligro` | text |  |  |  |
| `efectos_posibles` | text |  |  |  |
| `control_fuente` | text |  |  |  |
| `control_medio` | text |  |  |  |
| `control_individuo` | text |  |  |  |
| `nd` | integer |  | `0` |  |
| `ne` | integer |  | `0` |  |
| `np` | integer | **GENERADA** |  |  |
| `nc` | integer |  | `0` |  |
| `nr` | integer | **GENERADA** |  |  |
| `interpretacion_np` | text |  |  |  |
| `interpretacion_nr` | text |  |  |  |
| `aceptabilidad` | text |  |  |  |
| `n_expuestos` | integer |  | `0` |  |
| `peor_consecuencia` | text |  |  |  |
| `medidas_intervencion` | text |  |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `tarea` | text |  |  |  |
| `especificacion` | text |  |  |  |
| `medida_eliminacion` | text |  |  |  |
| `medida_sustitucion` | text |  |  |  |
| `control_ingenieria` | text |  |  |  |
| `control_administrativo` | text |  |  |  |
| `medida_epp` | text |  |  |  |
| `gc_plan_accion` | text |  |  |  |
| `gc_fecha_implementacion` | text |  |  |  |
| `gc_tipo_plan` | text |  |  |  |
| `gc_controles_propuestos` | text |  |  |  |
| `gc_controles_implementados` | text |  |  |  |
| `gc_pct_cumplimiento` | numeric |  |  |  |

### sst_mantenimientos

Tabla · 39 filas aprox. · 20 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_mantenimientos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `equipo_id` → `sst_equipos`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `equipo_id` | bigint |  |  |  |
| `tipo` | text | obligatoria |  |  |
| `fecha_programada` | date |  |  |  |
| `fecha_ejecucion` | date |  |  |  |
| `descripcion` | text |  |  |  |
| `proveedor` | text |  |  |  |
| `costo` | numeric(14,2) |  |  |  |
| `estado` | text |  | `'programado'::text` |  |
| `evidencia_url` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `estado_gestion` | text | obligatoria | `'cerrado'::text` |  |
| `horometro` | numeric |  |  |  |
| `reportado_por` | text |  |  |  |
| `cerrado_por` | text |  |  |  |
| `cerrado_en` | timestamp with time zone |  |  |  |
| `solucion` | text |  |  |  |
| `repuestos` | text |  |  |  |

### sst_matriz_legal

Tabla · — filas aprox. · 13 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_matriz_legal is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `tipo_norma` | text |  |  |  |
| `numero` | text |  |  |  |
| `anio` | integer |  |  |  |
| `tema` | text |  |  |  |
| `articulo_aplicable` | text |  |  |  |
| `obligacion` | text |  |  |  |
| `cumple` | text |  | `'no_cumple'::text` |  |
| `evidencia_url` | text |  |  |  |
| `fecha_evaluacion` | date |  | `CURRENT_DATE` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_medevac

Tabla · 68 filas aprox. · 25 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_medevac is '...'`._

**Llave primaria:** `id`

**Unicidad:** `documento_norm`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sst_medevac_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `centro_trabajo` | text |  |  |  |
| `nombres` | text |  |  |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `cargo` | text |  |  |  |
| `celular` | text |  |  |  |
| `alergias` | text |  |  |  |
| `rh` | text |  |  |  |
| `arl` | text |  |  |  |
| `eps` | text |  |  |  |
| `contacto_nombre` | text |  |  |  |
| `contacto_telefono` | text |  |  |  |
| `contacto_parentesco` | text |  |  |  |
| `email` | text |  |  |  |
| `mes_cumple` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `documento_norm` | text | **GENERADA** |  |  |
| `origen` | text |  |  |  |
| `actualizado_en` | timestamp with time zone |  |  |  |
| `actualizado_por` | text |  |  |  |
| `requiere_revision` | boolean |  | `false` |  |
| `revision_nota` | text |  |  |  |

### sst_medevac_backup_44

Tabla · — filas aprox. · 19 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_medevac_backup_44 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | integer |  |  |  |
| `idempresa` | integer |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `nombres` | text |  |  |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `cargo` | text |  |  |  |
| `celular` | text |  |  |  |
| `alergias` | text |  |  |  |
| `rh` | text |  |  |  |
| `arl` | text |  |  |  |
| `eps` | text |  |  |  |
| `contacto_nombre` | text |  |  |  |
| `contacto_telefono` | text |  |  |  |
| `contacto_parentesco` | text |  |  |  |
| `email` | text |  |  |  |
| `mes_cumple` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  |  |  |

### sst_medevac_duplicados_44

Tabla · — filas aprox. · 25 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_medevac_duplicados_44 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | integer | obligatoria | `nextval('sst_medevac_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `centro_trabajo` | text |  |  |  |
| `nombres` | text |  |  |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `cargo` | text |  |  |  |
| `celular` | text |  |  |  |
| `alergias` | text |  |  |  |
| `rh` | text |  |  |  |
| `arl` | text |  |  |  |
| `eps` | text |  |  |  |
| `contacto_nombre` | text |  |  |  |
| `contacto_telefono` | text |  |  |  |
| `contacto_parentesco` | text |  |  |  |
| `email` | text |  |  |  |
| `mes_cumple` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `documento_norm` | text |  |  |  |
| `origen` | text |  |  |  |
| `actualizado_en` | timestamp with time zone |  |  |  |
| `actualizado_por` | text |  |  |  |
| `requiere_revision` | boolean |  | `false` |  |
| `revision_nota` | text |  |  |  |

### sst_peligros

Tabla · — filas aprox. · 21 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_peligros is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `proceso` | text |  |  |  |
| `actividad` | text |  |  |  |
| `rutinaria` | boolean |  | `true` |  |
| `clasificacion` | text |  |  |  |
| `peligro` | text | obligatoria |  |  |
| `efecto_posible` | text |  |  |  |
| `nivel_deficiencia` | text |  |  |  |
| `nivel_exposicion` | text |  |  |  |
| `nivel_probabilidad` | text |  |  |  |
| `nivel_consecuencia` | text |  |  |  |
| `nivel_riesgo` | text |  |  |  |
| `aceptabilidad` | text |  |  |  |
| `controles_existentes` | text |  |  |  |
| `controles_propuestos` | text |  |  |  |
| `responsable` | text |  |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_perfil_sd_backup_44

Tabla · 92 filas aprox. · 39 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_perfil_sd_backup_44 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | integer |  |  |  |
| `idempresa` | integer |  |  |  |
| `estado` | text |  |  |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `nombres` | text |  |  |  |
| `apellidos` | text |  |  |  |
| `fecha_nacimiento` | text |  |  |  |
| `edad` | integer |  |  |  |
| `sexo` | text |  |  |  |
| `eps` | text |  |  |  |
| `afp` | text |  |  |  |
| `arl` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `turno` | text |  |  |  |
| `cargo` | text |  |  |  |
| `fecha_ingreso` | text |  |  |  |
| `fecha_retiro` | text |  |  |  |
| `pais_nacimiento` | text |  |  |  |
| `depto_nacimiento` | text |  |  |  |
| `municipio_residencia` | text |  |  |  |
| `grupo_etnico` | text |  |  |  |
| `nivel_escolaridad` | text |  |  |  |
| `estado_civil` | text |  |  |  |
| `cabeza_familia` | text |  |  |  |
| `num_hijos` | integer |  |  |  |
| `personas_hogar` | integer |  |  |  |
| `ingresos_familiares` | text |  |  |  |
| `tipo_vivienda` | text |  |  |  |
| `caracteristicas_vivienda` | text |  |  |  |
| `zona` | text |  |  |  |
| `direccion` | text |  |  |  |
| `transporte` | text |  |  |  |
| `estrato` | text |  |  |  |
| `consume_alcohol` | text |  |  |  |
| `actividad_fisica` | text |  |  |  |
| `fumador` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  |  |  |

### sst_perfil_sd_backup_45

Tabla · 92 filas aprox. · 43 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_perfil_sd_backup_45 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | integer |  |  |  |
| `idempresa` | integer |  |  |  |
| `estado` | text |  |  |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `nombres` | text |  |  |  |
| `apellidos` | text |  |  |  |
| `fecha_nacimiento` | text |  |  |  |
| `edad` | integer |  |  |  |
| `sexo` | text |  |  |  |
| `eps` | text |  |  |  |
| `afp` | text |  |  |  |
| `arl` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `turno` | text |  |  |  |
| `cargo` | text |  |  |  |
| `fecha_ingreso` | text |  |  |  |
| `fecha_retiro` | text |  |  |  |
| `pais_nacimiento` | text |  |  |  |
| `depto_nacimiento` | text |  |  |  |
| `municipio_residencia` | text |  |  |  |
| `grupo_etnico` | text |  |  |  |
| `nivel_escolaridad` | text |  |  |  |
| `estado_civil` | text |  |  |  |
| `cabeza_familia` | text |  |  |  |
| `num_hijos` | integer |  |  |  |
| `personas_hogar` | integer |  |  |  |
| `ingresos_familiares` | text |  |  |  |
| `tipo_vivienda` | text |  |  |  |
| `caracteristicas_vivienda` | text |  |  |  |
| `zona` | text |  |  |  |
| `direccion` | text |  |  |  |
| `transporte` | text |  |  |  |
| `estrato` | text |  |  |  |
| `consume_alcohol` | text |  |  |  |
| `actividad_fisica` | text |  |  |  |
| `fumador` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  |  |  |
| `documento_norm` | text |  |  |  |
| `origen` | text |  |  |  |
| `actualizado_en` | timestamp with time zone |  |  |  |
| `actualizado_por` | text |  |  |  |

### sst_perfil_sd_backup_46

Tabla · — filas aprox. · 45 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_perfil_sd_backup_46 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | integer |  |  |  |
| `idempresa` | integer |  |  |  |
| `estado` | text |  |  |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `nombres` | text |  |  |  |
| `apellidos` | text |  |  |  |
| `fecha_nacimiento` | text |  |  |  |
| `edad` | integer |  |  |  |
| `sexo` | text |  |  |  |
| `eps` | text |  |  |  |
| `afp` | text |  |  |  |
| `arl` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `turno` | text |  |  |  |
| `cargo` | text |  |  |  |
| `fecha_ingreso` | text |  |  |  |
| `fecha_retiro` | text |  |  |  |
| `pais_nacimiento` | text |  |  |  |
| `depto_nacimiento` | text |  |  |  |
| `municipio_residencia` | text |  |  |  |
| `grupo_etnico` | text |  |  |  |
| `nivel_escolaridad` | text |  |  |  |
| `estado_civil` | text |  |  |  |
| `cabeza_familia` | text |  |  |  |
| `num_hijos` | integer |  |  |  |
| `personas_hogar` | integer |  |  |  |
| `ingresos_familiares` | text |  |  |  |
| `tipo_vivienda` | text |  |  |  |
| `caracteristicas_vivienda` | text |  |  |  |
| `zona` | text |  |  |  |
| `direccion` | text |  |  |  |
| `transporte` | text |  |  |  |
| `estrato` | text |  |  |  |
| `consume_alcohol` | text |  |  |  |
| `actividad_fisica` | text |  |  |  |
| `fumador` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  |  |  |
| `documento_norm` | text |  |  |  |
| `origen` | text |  |  |  |
| `actualizado_en` | timestamp with time zone |  |  |  |
| `actualizado_por` | text |  |  |  |
| `requiere_revision` | boolean |  |  |  |
| `revision_nota` | text |  |  |  |

### sst_perfil_sd_duplicados_44

Tabla · — filas aprox. · 43 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_perfil_sd_duplicados_44 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | integer | obligatoria | `nextval('sst_perfil_sociodemografico_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `estado` | text |  | `'activo'::text` |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `nombres` | text |  |  |  |
| `apellidos` | text |  |  |  |
| `fecha_nacimiento` | text |  |  |  |
| `edad` | integer |  |  |  |
| `sexo` | text |  |  |  |
| `eps` | text |  |  |  |
| `afp` | text |  |  |  |
| `arl` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `turno` | text |  |  |  |
| `cargo` | text |  |  |  |
| `fecha_ingreso` | text |  |  |  |
| `fecha_retiro` | text |  |  |  |
| `pais_nacimiento` | text |  |  |  |
| `depto_nacimiento` | text |  |  |  |
| `municipio_residencia` | text |  |  |  |
| `grupo_etnico` | text |  |  |  |
| `nivel_escolaridad` | text |  |  |  |
| `estado_civil` | text |  |  |  |
| `cabeza_familia` | text |  |  |  |
| `num_hijos` | integer |  |  |  |
| `personas_hogar` | integer |  |  |  |
| `ingresos_familiares` | text |  |  |  |
| `tipo_vivienda` | text |  |  |  |
| `caracteristicas_vivienda` | text |  |  |  |
| `zona` | text |  |  |  |
| `direccion` | text |  |  |  |
| `transporte` | text |  |  |  |
| `estrato` | text |  |  |  |
| `consume_alcohol` | text |  |  |  |
| `actividad_fisica` | text |  |  |  |
| `fumador` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `documento_norm` | text |  |  |  |
| `origen` | text |  |  |  |
| `actualizado_en` | timestamp with time zone |  |  |  |
| `actualizado_por` | text |  |  |  |

### sst_perfil_sd_eliminados_45

Tabla · 63 filas aprox. · 45 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_perfil_sd_eliminados_45 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | integer | obligatoria | `nextval('sst_perfil_sociodemografico_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `estado` | text |  | `'activo'::text` |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `nombres` | text |  |  |  |
| `apellidos` | text |  |  |  |
| `fecha_nacimiento` | text |  |  |  |
| `edad` | integer |  |  |  |
| `sexo` | text |  |  |  |
| `eps` | text |  |  |  |
| `afp` | text |  |  |  |
| `arl` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `turno` | text |  |  |  |
| `cargo` | text |  |  |  |
| `fecha_ingreso` | text |  |  |  |
| `fecha_retiro` | text |  |  |  |
| `pais_nacimiento` | text |  |  |  |
| `depto_nacimiento` | text |  |  |  |
| `municipio_residencia` | text |  |  |  |
| `grupo_etnico` | text |  |  |  |
| `nivel_escolaridad` | text |  |  |  |
| `estado_civil` | text |  |  |  |
| `cabeza_familia` | text |  |  |  |
| `num_hijos` | integer |  |  |  |
| `personas_hogar` | integer |  |  |  |
| `ingresos_familiares` | text |  |  |  |
| `tipo_vivienda` | text |  |  |  |
| `caracteristicas_vivienda` | text |  |  |  |
| `zona` | text |  |  |  |
| `direccion` | text |  |  |  |
| `transporte` | text |  |  |  |
| `estrato` | text |  |  |  |
| `consume_alcohol` | text |  |  |  |
| `actividad_fisica` | text |  |  |  |
| `fumador` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `documento_norm` | text |  |  |  |
| `origen` | text |  |  |  |
| `actualizado_en` | timestamp with time zone |  |  |  |
| `actualizado_por` | text |  |  |  |
| `requiere_revision` | boolean |  | `false` |  |
| `revision_nota` | text |  |  |  |

### sst_perfil_sd_eliminados_46

Tabla · — filas aprox. · 45 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_perfil_sd_eliminados_46 is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | integer | obligatoria | `nextval('sst_perfil_sociodemografico_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `estado` | text |  | `'activo'::text` |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `nombres` | text |  |  |  |
| `apellidos` | text |  |  |  |
| `fecha_nacimiento` | text |  |  |  |
| `edad` | integer |  |  |  |
| `sexo` | text |  |  |  |
| `eps` | text |  |  |  |
| `afp` | text |  |  |  |
| `arl` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `turno` | text |  |  |  |
| `cargo` | text |  |  |  |
| `fecha_ingreso` | text |  |  |  |
| `fecha_retiro` | text |  |  |  |
| `pais_nacimiento` | text |  |  |  |
| `depto_nacimiento` | text |  |  |  |
| `municipio_residencia` | text |  |  |  |
| `grupo_etnico` | text |  |  |  |
| `nivel_escolaridad` | text |  |  |  |
| `estado_civil` | text |  |  |  |
| `cabeza_familia` | text |  |  |  |
| `num_hijos` | integer |  |  |  |
| `personas_hogar` | integer |  |  |  |
| `ingresos_familiares` | text |  |  |  |
| `tipo_vivienda` | text |  |  |  |
| `caracteristicas_vivienda` | text |  |  |  |
| `zona` | text |  |  |  |
| `direccion` | text |  |  |  |
| `transporte` | text |  |  |  |
| `estrato` | text |  |  |  |
| `consume_alcohol` | text |  |  |  |
| `actividad_fisica` | text |  |  |  |
| `fumador` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `documento_norm` | text |  |  |  |
| `origen` | text |  |  |  |
| `actualizado_en` | timestamp with time zone |  |  |  |
| `actualizado_por` | text |  |  |  |
| `requiere_revision` | boolean |  | `false` |  |
| `revision_nota` | text |  |  |  |

### sst_perfil_sociodemografico

Tabla · 67 filas aprox. · 45 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_perfil_sociodemografico is '...'`._

**Llave primaria:** `id`

**Unicidad:** `documento_norm`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('sst_perfil_sociodemografico_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `estado` | text |  | `'activo'::text` |  |
| `documento_tipo` | text |  |  |  |
| `documento` | text |  |  |  |
| `nombres` | text |  |  |  |
| `apellidos` | text |  |  |  |
| `fecha_nacimiento` | text |  |  |  |
| `edad` | integer |  |  |  |
| `sexo` | text |  |  |  |
| `eps` | text |  |  |  |
| `afp` | text |  |  |  |
| `arl` | text |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `turno` | text |  |  |  |
| `cargo` | text |  |  |  |
| `fecha_ingreso` | text |  |  |  |
| `fecha_retiro` | text |  |  |  |
| `pais_nacimiento` | text |  |  |  |
| `depto_nacimiento` | text |  |  |  |
| `municipio_residencia` | text |  |  |  |
| `grupo_etnico` | text |  |  |  |
| `nivel_escolaridad` | text |  |  |  |
| `estado_civil` | text |  |  |  |
| `cabeza_familia` | text |  |  |  |
| `num_hijos` | integer |  |  |  |
| `personas_hogar` | integer |  |  |  |
| `ingresos_familiares` | text |  |  |  |
| `tipo_vivienda` | text |  |  |  |
| `caracteristicas_vivienda` | text |  |  |  |
| `zona` | text |  |  |  |
| `direccion` | text |  |  |  |
| `transporte` | text |  |  |  |
| `estrato` | text |  |  |  |
| `consume_alcohol` | text |  |  |  |
| `actividad_fisica` | text |  |  |  |
| `fumador` | text |  |  |  |
| `marca_temporal` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `documento_norm` | text | **GENERADA** |  |  |
| `origen` | text |  |  |  |
| `actualizado_en` | timestamp with time zone |  |  |  |
| `actualizado_por` | text |  |  |  |
| `requiere_revision` | boolean |  | `false` |  |
| `revision_nota` | text |  |  |  |

### sst_plan_anual

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_plan_anual is '...'`._

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `anio`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `anio` | integer | obligatoria |  |  |
| `objetivo` | text |  |  |  |
| `aprobado_por` | text |  |  |  |
| `fecha_aprobacion` | date |  |  |  |
| `estado` | text |  | `'vigente'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_plan_anual_actividades

Tabla · — filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_plan_anual_actividades is '...'`._

**Llave primaria:** `id`

**Se liga a:** `plan_id` → `sst_plan_anual`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `plan_id` | bigint | obligatoria |  |  |
| `ciclo` | text |  |  |  |
| `actividad` | text | obligatoria |  |  |
| `responsable` | text |  |  |  |
| `recurso` | text |  |  |  |
| `mes_programado` | integer |  |  |  |
| `fecha_ejecucion` | date |  |  |  |
| `estado` | text |  | `'programada'::text` |  |
| `evidencia_url` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_plan_mejora

Tabla · 30 filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_plan_mejora is '...'`._

**Llave primaria:** `id`

**Unicidad:** `autoevaluacion_id` + `item_id`

**Se liga a:** `autoevaluacion_id` → `sst_autoevaluaciones`(id) · `item_id` → `sst_estandar_items`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `autoevaluacion_id` | bigint |  |  |  |
| `item_id` | bigint |  |  |  |
| `hallazgo` | text | obligatoria |  |  |
| `accion` | text | obligatoria |  |  |
| `tipo_accion` | text |  | `'correctiva'::text` |  |
| `responsable` | text |  |  |  |
| `fecha_inicio` | date |  |  |  |
| `fecha_fin` | date |  |  |  |
| `estado` | text | obligatoria | `'abierta'::text` |  |
| `avance` | integer |  | `0` |  |
| `evidencia_url` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_pqrsf

Tabla · — filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_pqrsf is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `tipo` | text |  |  |  |
| `remitente` | text |  |  |  |
| `descripcion` | text | obligatoria |  |  |
| `fecha` | date |  | `CURRENT_DATE` |  |
| `estado` | text |  | `'abierto'::text` |  |
| `respuesta` | text |  |  |  |
| `fecha_respuesta` | date |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### sst_simulacros

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sst_simulacros is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `idempresa` | integer | obligatoria |  |  |
| `sede` | text |  |  |  |
| `tipo` | text |  |  |  |
| `fecha` | date |  |  |  |
| `participantes` | integer |  |  |  |
| `observaciones` | text |  |  |  |
| `plan_mejora` | text |  |  |  |
| `evidencia_url` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### subcategorias

Tabla · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.subcategorias is '...'`._

**Llave primaria:** `id`

**Se liga a:** `categoriaid` → `categorias`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `activo` | text |  |  |  |
| `categoriaid` | bigint |  |  |  |

### sucursales

Tabla · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.sucursales is '...'`._

**Llave primaria:** `idcliente`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idcliente` 🔑 | bigint | identidad, obligatoria |  |  |
| `direccion` | text | obligatoria |  |  |
| `sucursalnombre` | text |  |  |  |
| `ciudad` | text |  |  |  |
| `activo` | text |  |  |  |
| `idempresa` | smallint |  |  |  |
| `departamento` | text |  |  |  |

### tarifas

Tabla · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.tarifas is '...'`._

**Llave primaria:** `id`

**Se liga a:** `idempresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `inicio` | date |  |  |  |
| `fin` | date |  |  |  |
| `descripcion` | text |  |  |  |
| `unidad` | text |  |  |  |
| `valor` | numeric |  |  |  |
| `idempresa` | smallint |  |  |  |
| `empresa` | text |  |  |  |

### tarifasfacturacionturnos

Tabla · 9 filas aprox. · 12 columnas

_Sin descripción. Se escribe en la base con `comment on table public.tarifasfacturacionturnos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fechainicio` | date |  |  |  |
| `fechafin` | date |  |  |  |
| `puesto` | text |  |  |  |
| `tarifaturno` | numeric |  |  |  |
| `tarifaturnofestivo` | numeric |  |  |  |
| `tarifahoraextra` | numeric |  |  |  |
| `idempresa` | smallint |  |  |  |
| `cobraturno` | text |  |  |  |
| `costoturno` | numeric |  |  |  |
| `costohoraextra` | numeric |  |  |  |
| `costoturnofestivo` | numeric |  |  |  |

### tarifasoperacion

Tabla · 43 filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.tarifasoperacion is '...'`._

**Llave primaria:** `id`

**Se liga a:** `empresaid` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fechainicio` | date | obligatoria |  |  |
| `fechafin` | date |  |  |  |
| `empresaid` | smallint |  |  |  |
| `operacion` | text |  |  |  |
| `tarifa` | text |  |  |  |
| `descripcion` | text |  |  |  |
| `empresafactura` | text |  |  |  |
| `producto` | text |  |  |  |

### tarifaspersonal

Tabla · 19 filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.tarifaspersonal is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fechaini` | date |  |  |  |
| `fechafin` | date |  |  |  |
| `empresaid` | smallint |  |  |  |
| `operacion` | text |  |  |  |
| `tarifa` | numeric |  |  |  |

### tarifasturnos

Tabla · 16 filas aprox. · 14 columnas

_Sin descripción. Se escribe en la base con `comment on table public.tarifasturnos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `fechaini` | date |  |  |  |
| `fechafin` | date |  |  |  |
| `base` | numeric |  |  |  |
| `hed` | numeric |  |  |  |
| `hedf` | numeric |  |  |  |
| `hen` | numeric |  |  |  |
| `hef` | numeric |  |  |  |
| `hn` | numeric |  |  |  |
| `puesto` | text |  |  |  |
| `horaentrada` | time without time zone |  |  |  |
| `idempresa` | numeric |  |  |  |
| `aplicaton` | boolean |  |  |  |
| `especialidad` | boolean |  |  |  |

### tipodespacho

Tabla · — filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.tipodespacho is '...'`._

**Llave primaria:** `idtipodespacho`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idtipodespacho` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombretipodespacho` | text | obligatoria |  |  |
| `activo` | text |  |  |  |

### tiposvehiculos

Tabla · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.tiposvehiculos is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombretipo` | text | obligatoria |  |  |
| `activo` | text |  |  |  |
| `capacidad` | numeric |  |  |  |

### toneladasauxiliares

Vista · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.toneladasauxiliares is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `ordendecargue` | text |  |  |  |
| `fechacargue` | date |  |  |  |
| `idempresa` | smallint |  |  |  |
| `tipooperacion` | text |  |  |  |
| `nombre_auxiliar` | text |  |  |  |
| `peso_total_operacion` | numeric |  |  |  |
| `cantidad_auxiliares` | integer |  |  |  |
| `toneladas_auxiliar` | numeric |  |  |  |
| `tarifa_aplicada` | numeric |  |  |  |
| `pago_total` | numeric |  |  |  |

### toneladasauxiliarespago

Vista · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.toneladasauxiliarespago is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `fechacargue` | date |  |  |  |
| `idempresa` | smallint |  |  |  |
| `persona` | text |  |  |  |
| `total_toneladas_dia` | numeric |  |  |  |
| `total_pago_dia` | numeric |  |  |  |
| `total_operaciones_realizadas` | bigint |  |  |  |

### toneladasdia

Vista · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.toneladasdia is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `Fecha` | date |  |  |  |
| `Operador` | text |  |  |  |
| `ID Proyecto` | smallint |  |  |  |
| `Tipo de Producto` | text |  |  |  |
| `Tipo de Operacion` | text |  |  |  |
| `Cantidad Auxiliares en Operacion` | integer |  |  |  |
| `Total Viajes/Tickets` | bigint |  |  |  |
| `Toneladas Cargadas` | numeric |  |  |  |

### transportes

Tabla · — filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.transportes is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombretransporte` | text | obligatoria |  |  |
| `activo` | text |  |  |  |

### traslados

Tabla · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.traslados is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `codigosolicitud` | text |  |  |  |
| `fehasolicitud` | timestamp with time zone | obligatoria | `now()` |  |
| `bodegaorigen` | text |  |  |  |
| `bodegadestino` | text |  |  |  |
| `estado` | text |  |  |  |

### turnos_definicion

Tabla · — filas aprox. · 12 columnas

Turnos con nombre por empresa (T1 mañana, T2 tarde...). NO se usa para liquidar: las horas siguen saliendo de registroasistencia. Ver scripts/add_programacion_turnos_quincena.sql

**Llave primaria:** `id`

**Unicidad:** `idempresa` + `codigo`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('turnos_definicion_id_seq'::regclass)` |  |
| `idempresa` | integer | obligatoria |  |  |
| `codigo` | text | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `hora_inicio` | time without time zone | obligatoria |  |  |
| `hora_fin` | time without time zone | obligatoria |  | Si hora_fin < hora_inicio el turno cruza la medianoche (p. ej. 22:00-06:00). |
| `descanso_min` | integer | obligatoria | `0` |  |
| `color` | text |  |  |  |
| `es_administrativo` | boolean | obligatoria | `false` |  |
| `orden` | integer | obligatoria | `0` |  |
| `activo` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

### usuariocartera

Tabla · — filas aprox. · 3 columnas

_Sin descripción. Se escribe en la base con `comment on table public.usuariocartera is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | bigint | identidad, obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `contra` | text |  |  |  |

### v_orden_vs_salidas

Vista · — filas aprox. · 15 columnas

Conciliación del DESPACHO: lo que la orden de cargue autorizó (detalleoc, solo tipooperacion Cargue) contra lo que salió del inventario (invtrans 601 aprobado). SALIO_MAS y FUERA_DE_LA_ORDEN son críticos: nunca puede salir más de lo que la orden dice. SALIO_MENOS es una diferencia a explicar (merma en el cargue). No reemplaza a v_pedidos_vs_salidas, que controla el pedido.

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | smallint |  |  |  |
| `idempresa_orden` | smallint |  |  |  |
| `idempresa_salida` | smallint |  |  |  |
| `ocargue` | text |  |  |  |
| `producto` | text |  |  |  |
| `fechaorden` | date |  |  |  |
| `fechacargue` | date |  |  |  |
| `placa` | text |  |  |  |
| `autorizado` | numeric |  |  |  |
| `despachado` | numeric |  |  |  |
| `diferencia` | numeric |  |  |  |
| `movimientos` | bigint |  |  |  |
| `primera_salida` | timestamp with time zone |  |  |  |
| `ultima_salida` | timestamp with time zone |  |  |  |
| `estado_alerta` | text |  |  |  |

### v_pedidos_vs_salidas

Vista · — filas aprox. · 15 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_pedidos_vs_salidas is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | smallint |  |  |  |
| `idempresa_pedido` | smallint |  |  |  |
| `idempresa_salida` | smallint |  |  |  |
| `ocargue` | text |  |  |  |
| `producto` | text |  |  |  |
| `ped_unidades` | numeric |  |  |  |
| `ped_cargadas` | numeric |  |  |  |
| `salida_qty` | numeric |  |  |  |
| `diferencia` | numeric |  |  |  |
| `pendiente_despacho` | numeric |  |  |  |
| `pedido_cerrado` | boolean |  |  |  |
| `estado_pedido` | text |  |  |  |
| `salida_con_lote` | boolean |  |  |  |
| `empresa_distinta` | boolean |  |  |  |
| `estado_alerta` | text |  |  |  |

### v_soportes_resumen

Vista · — filas aprox. · 6 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_soportes_resumen is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `norma` | text |  |  |  |
| `modulo` | text |  |  |  |
| `total` | bigint |  |  |  |
| `vigentes` | bigint |  |  |  |
| `referencias` | bigint |  |  |  |

### v_soportes_vigentes

Vista · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_soportes_vigentes is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `norma` | text |  |  |  |
| `modulo` | text |  |  |  |
| `referencia_tipo` | text |  |  |  |
| `referencia_id` | text |  |  |  |
| `referencia_desc` | text |  |  |  |
| `archivo_url` | text |  |  |  |
| `archivo_nombre` | text |  |  |  |
| `created_at` | timestamp with time zone |  |  |  |

### v_sst_acciones_seguimiento

Vista · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_acciones_seguimiento is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `total_acciones` | bigint |  |  |  |
| `pendientes` | bigint |  |  |  |
| `implementadas` | bigint |  |  |  |
| `verificadas` | bigint |  |  |  |

### v_sst_auditoria_estandar

Vista · — filas aprox. · 16 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_auditoria_estandar is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `ciclo` | text |  |  |  |
| `estandar` | text |  |  |  |
| `numeral` | text |  |  |  |
| `item` | text |  |  |  |
| `peso` | numeric(5,2) |  |  |  |
| `modulo` | text |  |  |  |
| `tabla` | text |  |  |  |
| `documento` | text |  |  |  |
| `idempresa` | integer |  |  |  |
| `anio` | integer |  |  |  |
| `sede` | text |  |  |  |
| `autoevaluacion_id` | bigint |  |  |  |
| `cumple` | text |  |  |  |
| `puntaje_obtenido` | numeric(5,2) |  |  |  |
| `observacion` | text |  |  |  |
| `soporte_url` | text |  |  |  |

### v_sst_autoeval_por_ciclo

Vista · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_autoeval_por_ciclo is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `autoevaluacion_id` | bigint |  |  |  |
| `ciclo` | text |  |  |  |
| `peso_ciclo` | numeric |  |  |  |
| `obtenido_ciclo` | numeric |  |  |  |
| `pct_ciclo` | numeric |  |  |  |

### v_sst_capacitacion_mensual

Vista · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_capacitacion_mensual is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `sede` | text |  |  |  |
| `mes` | date |  |  |  |
| `capacitaciones` | bigint |  |  |  |
| `pausas_activas` | bigint |  |  |  |
| `actividades_estilos_vida` | bigint |  |  |  |
| `simulacros` | bigint |  |  |  |
| `total_asistentes` | bigint |  |  |  |

### v_sst_cumplimiento_plan_anual

Vista · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_cumplimiento_plan_anual is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `anio` | integer |  |  |  |
| `actividades` | bigint |  |  |  |
| `ejecutadas` | bigint |  |  |  |
| `pct_cumplimiento` | numeric |  |  |  |

### v_sst_epp_por_trabajador

Vista · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_epp_por_trabajador is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `sede` | text |  |  |  |
| `trabajador` | text |  |  |  |
| `cedula` | text |  |  |  |
| `cargo` | text |  |  |  |
| `entregas` | bigint |  |  |  |
| `elementos_distintos` | bigint |  |  |  |
| `ultima_entrega` | date |  |  |  |

### v_sst_incidentes_mensual

Vista · — filas aprox. · 9 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_incidentes_mensual is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `sede` | text |  |  |  |
| `mes` | date |  |  |  |
| `incidentes` | bigint |  |  |  |
| `accidentes` | bigint |  |  |  |
| `enf_laborales` | bigint |  |  |  |
| `at_graves` | bigint |  |  |  |
| `at_mortales` | bigint |  |  |  |
| `dias_perdidos` | bigint |  |  |  |

### v_sst_indicadores_tablero

Vista · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_indicadores_tablero is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `periodo` | text |  |  |  |
| `tipo` | text |  |  |  |
| `nombre` | text |  |  |  |
| `valor` | numeric(12,3) |  |  |  |
| `meta` | numeric(12,3) |  |  |  |
| `unidad` | text |  |  |  |
| `estado` | text |  |  |  |

### v_sst_investigacion_plazo

Vista · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_investigacion_plazo is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `id` | bigint |  |  |  |
| `tipo` | text |  |  |  |
| `fecha_evento` | date |  |  |  |
| `fecha_investigacion` | date |  |  |  |
| `dias_para_investigar` | integer |  |  |  |
| `en_plazo` | boolean |  |  |  |

### v_sst_ipevr_resumen

Vista · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_ipevr_resumen is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `sede` | text |  |  |  |
| `total_peligros` | bigint |  |  |  |
| `nivel_i` | bigint |  |  |  |
| `nivel_ii` | bigint |  |  |  |
| `nivel_iii` | bigint |  |  |  |
| `nivel_iv` | bigint |  |  |  |
| `no_aceptables` | bigint |  |  |  |

### v_sst_items_no_cumple

Vista · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_items_no_cumple is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `autoevaluacion_id` | bigint |  |  |  |
| `anio` | integer |  |  |  |
| `sede` | text |  |  |  |
| `ciclo` | text |  |  |  |
| `estandar` | text |  |  |  |
| `numeral` | text |  |  |  |
| `item` | text |  |  |  |
| `peso` | numeric(5,2) |  |  |  |
| `observacion` | text |  |  |  |

### v_sst_mantenimiento_cumplimiento

Vista · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_mantenimiento_cumplimiento is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `sede` | text |  |  |  |
| `tipo_equipo` | text |  |  |  |
| `identificacion` | text |  |  |  |
| `programados` | bigint |  |  |  |
| `ejecutados` | bigint |  |  |  |
| `vencidos` | bigint |  |  |  |

### v_sst_matriz_legal_cumplimiento

Vista · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_matriz_legal_cumplimiento is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `requisitos` | bigint |  |  |  |
| `cumplidos` | bigint |  |  |  |
| `pct_cumplimiento` | numeric |  |  |  |

### v_sst_montacargas_estado

Vista · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_montacargas_estado is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `sede` | text |  |  |  |
| `placa` | text |  |  |  |
| `estado_equipo` | text |  |  |  |
| `ultima_inspeccion` | date |  |  |  |

### v_sst_peligros_criticos

Vista · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_peligros_criticos is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `sede` | text |  |  |  |
| `proceso` | text |  |  |  |
| `peligro` | text |  |  |  |
| `nivel_riesgo` | text |  |  |  |
| `aceptabilidad` | text |  |  |  |
| `controles_propuestos` | text |  |  |  |

### v_sst_plan_mejora_estado

Vista · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.v_sst_plan_mejora_estado is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idempresa` | integer |  |  |  |
| `total` | bigint |  |  |  |
| `cerradas` | bigint |  |  |  |
| `pendientes` | bigint |  |  |  |
| `vencidas` | bigint |  |  |  |

### vacaciones_liquidaciones

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vacaciones_liquidaciones is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `cedula` | text | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `dias` | numeric | obligatoria | `0` |  |
| `valor_dia` | numeric | obligatoria | `0` |  |
| `valor_total` | numeric | obligatoria | `0` |  |
| `fecha` | date | obligatoria | `CURRENT_DATE` |  |
| `observaciones` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### vacaciones_solicitudes

Tabla · — filas aprox. · 14 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vacaciones_solicitudes is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `cedula` | text | obligatoria |  |  |
| `nombre` | text |  |  |  |
| `cargo` | text |  |  |  |
| `fecha_inicio` | date | obligatoria |  |  |
| `fecha_fin` | date | obligatoria |  |  |
| `dias_habiles` | integer | obligatoria | `0` |  |
| `estado` | text | obligatoria | `'PENDIENTE'::text` |  |
| `aprobado_por` | text |  |  |  |
| `fecha_aprobacion` | timestamp with time zone |  |  |  |
| `motivo_rechazo` | text |  |  |  |
| `observaciones` | text |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |

### vacantes

Tabla · — filas aprox. · 21 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vacantes is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `extensions.uuid_generate_v4()` |  |
| `idempresa` | integer | obligatoria |  |  |
| `proyecto` | text | obligatoria |  |  |
| `cargo` | text | obligatoria |  |  |
| `headcount` | integer |  |  |  |
| `turno` | text |  |  |  |
| `ciudad` | text |  |  |  |
| `rango_salarial_min` | numeric |  |  |  |
| `rango_salarial_max` | numeric |  |  |  |
| `requisitos` | text |  |  |  |
| `estado` | text |  | `'en_revision'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |
| `proyecto_id` | smallint |  |  |  |
| `aprobacion_rrhh` | text | obligatoria | `'pendiente'::text` |  |
| `aprobacion_operaciones` | text | obligatoria | `'pendiente'::text` |  |
| `motivo_rechazo` | text |  |  |  |
| `causal` | text |  |  | Causal del Art. 77 Ley 50/1990: ocasional \| reemplazo \| incremento \| periodos_estacionales. Define el plazo máximo de la vinculación. |
| `fecha_inicio_prevista` | date |  |  |  |
| `fecha_fin_prevista` | date |  |  | Fin previsto de la misión. Contrastado con la causal dice si se supera el tope legal. |
| `puesto` | text |  |  | Puesto operativo del maestro de turnos (tarifasturnos.puesto) para el que se pide el personal. Distinto del cargo de Head Count. |

### vacantes_candidatos

Tabla · — filas aprox. · 10 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vacantes_candidatos is '...'`._

**Llave primaria:** `id`

**Se liga a:** `vacante_id` → `vacantes`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `extensions.uuid_generate_v4()` |  |
| `vacante_id` | uuid | obligatoria |  |  |
| `nombre` | text | obligatoria |  |  |
| `email` | text |  |  |  |
| `telefono` | text |  |  |  |
| `documento` | text |  |  |  |
| `experiencia` | text |  |  |  |
| `estado_candidato` | text |  | `'pendiente'::text` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `updated_at` | timestamp with time zone |  | `now()` |  |

### vendedores

Tabla · 39 filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vendedores is '...'`._

**Llave primaria:** `idvendedor`

**Se liga a:** `id_empresa` → `empresas`(id)

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idvendedor` 🔑 | bigint | identidad, obligatoria |  |  |
| `id_empresa` | smallint |  |  |  |
| `created_at` | timestamp with time zone | obligatoria | `now()` |  |
| `nombre` | text |  |  |  |
| `cedula` | text |  |  |  |
| `celular` | text |  |  |  |
| `correo` | text |  |  |  |
| `activo` | text |  |  |  |

### view_inventario_por_estiba

Vista · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.view_inventario_por_estiba is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idqr` | numeric |  |  |  |
| `codproducto` | text |  |  |  |
| `nombreproducto` | text |  |  |  |
| `lote` | text |  |  |  |
| `location` | text |  |  |  |
| `stock_total` | numeric |  |  |  |
| `fecha_vencimiento` | date |  |  |  |

### vw_alertas_aprobacion

Vista · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vw_alertas_aprobacion is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `idpedido` | numeric |  |  |  |
| `cliente` | text |  |  |  |
| `vendedor` | text |  |  |  |
| `total_pagar` | numeric |  |  |  |
| `revisioncartera` | text |  |  |  |
| `revisiongerencia` | text |  |  |  |
| `estado` | text |  |  |  |

### vw_insight_cliente_producto

Vista · — filas aprox. · 4 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vw_insight_cliente_producto is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `cliente` | text |  |  |  |
| `producto` | text |  |  |  |
| `total_comprado` | numeric |  |  |  |
| `total_peso` | numeric |  |  |  |

### vw_kpi_diarios

Vista · — filas aprox. · 7 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vw_kpi_diarios is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `fecha` | date |  |  |  |
| `total_pedidos` | bigint |  |  |  |
| `total_facturado` | numeric |  |  |  |
| `toneladas_pedidas` | numeric |  |  |  |
| `toneladas_despachadas` | numeric |  |  |  |
| `porcentaje_otif_cumplimiento` | numeric |  |  |  |
| `pendientes_aprobacion` | bigint |  |  |  |

### vw_produccion_agrupada_10m

Vista · — filas aprox. · 5 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vw_produccion_agrupada_10m is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `intervalo` | timestamp with time zone |  |  |  |
| `total_bultos` | bigint |  |  |  |
| `total_averias` | bigint |  |  |  |
| `total_estibas` | bigint |  |  |  |
| `bultos_arrume` | bigint |  |  |  |

### vw_produccion_dashboard

Vista · — filas aprox. · 11 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vw_produccion_dashboard is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` | bigint |  |  |  |
| `fecha_hora` | timestamp with time zone |  |  |  |
| `producto_id` | integer |  |  |  |
| `producto_nombre` | text |  |  |  |
| `tipo_empaque` | text |  |  |  |
| `lote` | bigint |  |  |  |
| `bultos_procesados` | integer |  |  |  |
| `averias` | integer |  |  |  |
| `intervalo_10m` | timestamp with time zone |  |  |  |
| `minutos_desde_anterior` | numeric |  |  |  |
| `alerta_parada` | boolean |  |  |  |

### vw_sst_datos_colaborador

Vista · — filas aprox. · 18 columnas

_Sin descripción. Se escribe en la base con `comment on table public.vw_sst_datos_colaborador is '...'`._

**Llave primaria:** ninguna declarada

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `documento_norm` | text |  |  |  |
| `identificacion` | text |  |  |  |
| `nombre` | text |  |  |  |
| `cargo_headcount` | text |  |  |  |
| `idempresa` | smallint |  |  |  |
| `estado` | text |  |  |  |
| `tiene_medevac` | boolean |  |  |  |
| `tiene_perfil` | boolean |  |  |  |
| `centro_trabajo` | text |  |  |  |
| `rh` | text |  |  |  |
| `eps` | text |  |  |  |
| `arl` | text |  |  |  |
| `medevac_requiere_revision` | boolean |  |  |  |
| `medevac_revision_nota` | text |  |  |  |
| `medevac_actualizado_en` | timestamp with time zone |  |  |  |
| `perfil_actualizado_en` | timestamp with time zone |  |  |  |
| `medevac_completo` | boolean |  |  |  |
| `perfil_completo` | boolean |  |  |  |

### whatsapp_mensajes

Tabla · 1.534 filas aprox. · 17 columnas

_Sin descripción. Se escribe en la base con `comment on table public.whatsapp_mensajes is '...'`._

**Llave primaria:** `id`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | uuid | obligatoria | `gen_random_uuid()` |  |
| `idempresa` | integer |  |  |  |
| `telefono` | text | obligatoria |  |  |
| `identificacion` | text |  |  |  |
| `nombre` | text |  |  |  |
| `plantilla` | text |  |  |  |
| `idioma` | text |  |  |  |
| `parametros` | jsonb |  |  |  |
| `estado` | text | obligatoria | `'enviado'::text` | enviado \| entregado \| leido \| fallido \| error. "enviado" solo significa que la API lo acepto. |
| `message_id` | text |  |  |  |
| `error_codigo` | text |  |  |  |
| `error_detalle` | text |  |  |  |
| `origen` | text |  |  |  |
| `enviado_por` | text |  |  |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `entregado_at` | timestamp with time zone |  |  |  |
| `leido_at` | timestamp with time zone |  |  |  |

### whatsapp_plantillas

Tabla · — filas aprox. · 8 columnas

_Sin descripción. Se escribe en la base con `comment on table public.whatsapp_plantillas is '...'`._

**Llave primaria:** `id`

**Unicidad:** `nombre`

| Columna | Tipo | Señales | Defecto | Descripción |
|---|---|---|---|---|
| `id` 🔑 | integer | obligatoria | `nextval('whatsapp_plantillas_id_seq'::regclass)` |  |
| `nombre` | text | obligatoria |  |  |
| `idioma` | text | obligatoria | `'es'::text` |  |
| `descripcion` | text |  |  |  |
| `uso` | text |  |  |  |
| `variables` | jsonb | obligatoria | `'{"body": [], "header": []}'::jsonb` | Nombres legibles de las variables POR POSICION. WhatsApp usa {{1}},{{2}}... por orden, no por nombre. |
| `activa` | boolean | obligatoria | `true` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |

