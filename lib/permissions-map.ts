/**
 * Mapeo modulo -> campo de permiso. Vive en un archivo aparte (sin
 * directiva "use server") porque Next.js prohibe exportar valores no
 * async desde modulos con `"use server"`. `lib/permissions-actions.ts`
 * SI tiene esa directiva (porque expone server actions), por eso no
 * puede contener este `const`.
 *
 * Tanto `lib/permissions-actions.ts` (server actions) como
 * `app/api/user-modules/route.ts` y cualquier otro consumidor importan
 * desde aqui para mantener UNA sola fuente de verdad.
 */

export interface UserPermissions {
  id?: number
  usuario_id: string
  // Gestión de Pedidos
  entrada_pedidos: boolean
  gestionar_pedidos: boolean
  gestion_integral_pedidos: boolean
  // Permiso del modulo "Dashboard Pedidos". Se llama `dashboardpedidos`
  // (sin separador) para coincidir exactamente con el nombre de la
  // columna en la tabla `permisos_usuarios`.
  dashboardpedidos: boolean
  // Despachos/Recepción
  generar_ordenes_cargue: boolean
  generar_ordenes_descargue: boolean
  distribucion: boolean
  gestion_ordenes: boolean
  // Permiso del modulo "Dashboard Despachos/Recepción". Se llama
  // `dashboardrecepcion` (sin separador) para coincidir exactamente con
  // el nombre de la columna en la tabla `permisos_usuarios`.
  dashboardrecepcion: boolean
  // Vehículos
  registrar_vehiculos: boolean
  ver_vehiculos: boolean
  // Báscula
  bascula: boolean
  historial_bascula: boolean
  // Almacenamiento
  transacciones_inventario: boolean
  saldos_inventario: boolean
  saldos_producto: boolean
  reprocesos: boolean
  gestion_transacciones: boolean
  ver_solicitudes_traslado: boolean
  traslados_producto: boolean
  capacidad_bodega: boolean
  registro_qr_estibas: boolean
  lectura_qr_estibas: boolean
  inventario_estiba: boolean
  // Permiso del modulo "Montacargas y personal día" (Gestión de
  // Inventario). Coincide con el nombre de la columna en
  // `permisos_usuarios` (sin separador, todo en minuscula).
  montacargasdia: boolean
  // Producción
  ingreso_produccion: boolean
  tolva: boolean
  ver_tolva: boolean
  proyecciones: boolean
  // "Programación del cliente" (Pedidos y solicitudes): el cliente registra la
  // programación de vehículos de mañana y ve su cumplimiento. SQL 211.
  programacion_cliente: boolean
  // "Consignar programación del cliente" (Operación LIP › Operación del día): el
  // coordinador LIP consigna la programación que envía el cliente. SQL 212.
  programacion_cliente_lip: boolean
  ver_ingresos_produccion: boolean
  aprobacion_produccion: boolean
  liquidacion_tolva: boolean
  // Permiso del modulo "Control piso" (tablero Andon de produccion en
  // tiempo real). Coincide con el nombre de la columna en
  // `permisos_usuarios` (todo en minuscula, sin separador).
  controlpiso: boolean
  // Panel "Operación del día" (Operación LIP). Coincide con el nombre de la
  // columna en `permisos_usuarios`.
  operacion_dia: boolean
  asignacion_lotes: boolean
  historial_lotes: boolean
  registro_sanitario: boolean
  ver_historial_inspeccion: boolean
  historial_aprobaciones: boolean
  // Auditoría
  picking: boolean
  packing: boolean
  ver_picking: boolean
  auditoria_inventario: boolean
  cuadre_inventario: boolean
  // Permiso del modulo "Centro de Evidencia ISO 9001" (Auditoría).
  // Coincide con el nombre de la columna en `permisos_usuarios`
  // (sin separador, todo en minuscula).
  evidenciasido: boolean
  // Gestión Integral
  dashboard_operacion: boolean
  asistenteia: boolean
  solicitudturnos: boolean
  // Gestión LIP
  gestion_proveedores: boolean
  creacion_materiales: boolean
  explosion_materiales: boolean
  // MRP: antes eran módulos "no protegidos" (visibles para todos). Ahora se
  // gobiernan desde Gestión de Usuarios como el resto.
  ingresos_mp: boolean
  saldos_empaque: boolean
  saldos_materia_prima: boolean
  tarifas: boolean
  gestionfacturas: boolean
  gastos: boolean
  estadoresultados: boolean
  dashboardop: boolean
  prechequeo: boolean
  aprobacionturnos: boolean
  // Permiso del modulo "Bitácora" (Operación Lip). Coincide con el
  // nombre de la columna en `permisos_usuarios` (todo en minuscula).
  bitacora: boolean
  // Gestión de Personal
  headcount: boolean
  nominapersonal: boolean
  liquidaciones: boolean
  parafiscales: boolean
  revision_nomina: boolean
  registro_asistencia: boolean
  tabla_asistencia: boolean
  asignacion_horas_extra: boolean
  novedades_personal: boolean
  // Permiso PROPIO (no comparte con novedades_personal ni visor): a
  // diferencia de esos módulos, este puede insertar/corregir filas de MESES
  // YA CERRADOS de nómina (retroactivo), así que se gestiona aparte.
  asistencia_administrativa: boolean
  ausentismos: boolean
  // Recobro de Incapacidades: permiso PROPIO para que aparezca como línea
  // independiente en Gestión de Usuarios (antes compartía 'ausentismos' y el
  // dedupe del árbol lo ocultaba).
  recobro_incapacidades: boolean
  vacaciones: boolean
  // Reporte de Acumulados generado por LIPgo (mismo formato que el export de
  // Siigo), fuente de verdad hacia adelante -- ver lib/acumulados-lipgo-actions.ts.
  acumulados_lipgo: boolean
  visor: boolean
  // RRHH LIP
  gestion_contratos: boolean
  dotacion_epp: boolean
  capacitaciones: boolean
  asistencia_capacitaciones: boolean
  solicitud_personal: boolean
  evaluacionpersonal: boolean
  gestionsolicitudes: boolean
  // Permiso del modulo "Evidencia de Inducciones" (RRHH Lip). Coincide
  // con el nombre de la columna en `permisos_usuarios` (sin separador,
  // todo en minuscula).
  evidenciasinducciones: boolean
  // Permiso del modulo "Inducciones" (RRHH Lip): administra inducciones
  // (capacitaciones tipo='induccion') y sus preguntas de evaluacion.
  // Coincide con la columna `inducciones` en `permisos_usuarios`.
  inducciones: boolean
  // Permiso del modulo "Turnos" (RRHH Lip). Gobierna el acceso al CRUD
  // sobre `tarifasturnos`. Coincide con el nombre de la columna en
  // `permisos_usuarios` (sin separador, en minusculas).
  gestionturnos: boolean
  // Permiso del modulo "Programación de turnos" (RRHH Lip).
  // Controla el acceso al flujo de programar a futuro a personal
  // del headcount en `registroasistencia`. Mismo formato que el
  // resto de columnas operativas: sin separador, todo en minuscula.
  programacionturnos: boolean
  // Permiso del modulo "Notificaciones al Personal" (Operación Lip).
  // Gobierna el envio de alertas y programacion de turnos por WhatsApp
  // al celular del personal. Coincide con la columna en `permisos_usuarios`.
  notificaciones: boolean
  // Permiso del modulo "Control de Toneladas" (Operación Lip). Vista
  // operativa del coordinador: toneladas por dia y acumuladas por
  // trabajador, para gestionar personal (no es un modulo de pago).
  control_toneladas: boolean
  // Permiso del módulo "Productividad de Auxiliares" (Operación Lip): informe
  // de gerencia de quién carga de verdad (cabeceraoc.auxiliares_real) por ID,
  // día y mes. Solo lectura. Ver scripts/207_add_productividad_auxiliares_permission.sql.
  productividad_auxiliares: boolean
  // Permiso del modulo "Centro de Coordinación" (Operación Lip). Une en una
  // sola pantalla la gestión que hoy está dispersa en Picking, Packing y el
  // control de muelles/SLA: el coordinador ve los muelles en vivo, asigna
  // personal, inicia y cierra órdenes de Cargue/Descargue/Distribución.
  centro_coordinacion: boolean
  // Configuración
  config_bodegas: boolean
  config_categorias: boolean
  config_subcategorias: boolean
  config_clientes: boolean
  config_condiciones_pago: boolean
  config_destinos: boolean
  config_grupos: boolean
  config_medios: boolean
  config_productos: boolean
  config_sucursales: boolean
  config_tipos_despacho: boolean
  config_transportadoras: boolean
  config_tipos_vehiculos: boolean
  config_vendedores: boolean
  config_localizaciones: boolean
  gestion_usuarios: boolean
  accesos_usuario: boolean
  bitacora_auditoria: boolean
  placas_distribucion: boolean
  muelles_empresa: boolean
  facturacion_proyectos: boolean
  cuadro_facturacion: boolean
  conciliacion_avimol: boolean
  prefactura_produccion: boolean
  // Edición directa de cabeceraoc/detalleoc de una orden ya creada (Gestión
  // Financiera · Facturación). Sin catálogo de motivos: texto libre
  // obligatorio guardado en ordenes_correcciones; el detalle campo-por-campo
  // ya lo cubre el trigger genérico fn_auditoria().
  correccion_ordenes: boolean
  // Configuración › General › "Autorizaciones por clave" (SQL 203): perfiles por
  // puesto, permisos por proceso/código, claves personales. Solo administradores.
  autorizaciones_clave: boolean
  // Ciclo de Facturación: anexo enviado -> firmado -> factura enviada ->
  // firmada -> cierre, más cartera/cobro. Visibilidad general +
  // 2 capacidades separadas (sin rol de usuario real en el sistema).
  ciclo_facturacion: boolean
  ciclo_facturacion_jefe: boolean
  ciclo_facturacion_coordinador: boolean
  bonos: boolean
  // Módulo "Asignación de apoyo en cargue" (Compensación): agrega personal
  // extra a una orden de Cargue/Descargue para que entre en el reparto de
  // toneladas de esa orden (aparte de Picking/Packing).
  apoyo_cargue: boolean
  // ---------------------------------------------------------------------------
  // Certificaciones LIP · SST. Estas columnas ya existian en
  // `permisos_usuarios` pero nunca se habian cableado al mapa de permisos,
  // por eso los submodulos SST se mostraban a todos los usuarios.
  // ---------------------------------------------------------------------------
  sst_auditoria: boolean
  sst_autoevaluacion: boolean
  sst_plan_mejora: boolean
  sst_indicadores: boolean
  sst_ipevr: boolean
  sst_incidentes: boolean
  sst_epp: boolean
  sst_mantenimiento: boolean
  // Módulo "Gestión de Montacargas": maestro de equipos, QR, hoja de vida y
  // bitácora de mantenimiento. Un solo permiso cubre administrar y registrar.
  montacargas: boolean
  // Módulo "Cargos Fijos" (Gestión Financiera): alquiler de montacargas
  // facturado + $2M Manejo de Inventario (id1/id3) + 600 ton fijas Avimol.
  cargos_fijos: boolean
  sst_comunicacion: boolean
  sst_gestion_cambio: boolean
  sst_actividades: boolean
  // Nuevas (creadas por scripts/016_add_permisos_certificaciones_gh.sql)
  sst_repositorio_soportes: boolean
  sst_alertas_at: boolean
  sst_investigaciones: boolean
  sst_medevac: boolean
  sst_perfil: boolean
  examenes_medicos: boolean
  // Certificaciones LIP · ISO 9001 (Centro de Evidencia usa `evidenciasido`)
  iso_repositorio: boolean
  // ---------------------------------------------------------------------------
  // Sistema Integrado de Gestión (SIG): matriz integrada ISO 9001/14001/45001.
  // `sig_matriz` gobierna el acceso al módulo; los `sig_iso*` gatean cada
  // pestaña de norma dentro del módulo (acceso por responsabilidad).
  // ---------------------------------------------------------------------------
  sig_matriz: boolean
  sig_iso9001: boolean
  sig_iso14001: boolean
  sig_iso45001: boolean
  // Satisfacción y PQRSF: permiso propio para que el COORDINADOR (Gestión LIP)
  // lo gestione sin abrir todo el SIG. Vive en SIG y en Gestión LIP.
  satisfaccion_pqrsf: boolean
  // Consulta de facturas en Siigo. Permiso propio: da acceso a toda la
  // facturacion de la empresa, no solo a lo que genera LIPgo.
  siigo_facturas: boolean
  // Calificación del Conductor (kiosko en caliente al fin de cargue): objetivo
  // del coordinador; alimenta la satisfacción del conductor en el BSC.
  calificacion_conductor: boolean
  // ---------------------------------------------------------------------------
  // Gestión Humana. `gestion_colaboradores` ya existia en la tabla pero no
  // estaba ni en la interfaz ni en el mapa; el resto son nuevas.
  // ---------------------------------------------------------------------------
  gestion_colaboradores: boolean
  gh_carpetas: boolean
  gh_entrevistas: boolean
  gh_bienestar: boolean
  gh_participacion: boolean
  // Procesos disciplinarios. Permiso PROPIO: el caso contiene el relato de una
  // conducta, el nombre de testigos y la decision que se tomo. No es
  // informacion operativa y no se hereda del permiso de novedades.
  procesos_disciplinarios: boolean
  // Mensajeria por WhatsApp. Cada mensaje se cobra y se envia a un numero
  // personal en nombre de la empresa: permiso propio, sin backfill.
  whatsapp: boolean
}

export const MODULE_PERMISSION_MAP: Record<string, keyof UserPermissions> = {
  "Entrada de pedidos": "entrada_pedidos",
  "Gestionar pedidos": "gestionar_pedidos",
  "Gestión integral de pedidos": "gestion_integral_pedidos",
  "Dashboard Pedidos": "dashboardpedidos",
  "Generar Órdenes de Cargue": "generar_ordenes_cargue",
  "Generar Órdenes de Descargue": "generar_ordenes_descargue",
  "Generar Orden de Distribución": "distribucion",
  "Gestión de Ordenes": "gestion_ordenes",
  "Dashboard Despachos/Recepción": "dashboardrecepcion",
  "Registrar Vehículos": "registrar_vehiculos",
  "Ver Vehículos": "ver_vehiculos",
  Báscula: "bascula",
  "Historial Báscula": "historial_bascula",
  "Transacciones de Inventario": "transacciones_inventario",
  "Saldos de inventario": "saldos_inventario",
  "Saldos por producto": "saldos_producto",
  Reprocesos: "reprocesos",
  "Gestión de transacciones": "gestion_transacciones",
  "Ver Solicitudes de traslado": "ver_solicitudes_traslado",
  "Recepción de Traslado": "ver_solicitudes_traslado",
  "Traslados de producto": "traslados_producto",
  "Capacidad Bodega": "capacidad_bodega",
  "Registro de QR estibas": "registro_qr_estibas",
  "Lectura de QR estibas": "lectura_qr_estibas",
  "Inventario por Estiba": "inventario_estiba",
  "Montacargas y personal día": "montacargasdia",
  "Ingreso de Producción": "ingreso_produccion",
  Tolva: "tolva",
  "Ver Tolva": "ver_tolva",
  Proyecciones: "proyecciones",
  "Programación del cliente": "programacion_cliente",
  "Consignar programación del cliente": "programacion_cliente_lip",
  "Ver ingresos de producción": "ver_ingresos_produccion",
  "Aprobación de ingreso de producción": "aprobacion_produccion",
  "Liquidación Tolva del día": "liquidacion_tolva",
  "Dashboard de Producción": "controlpiso",
  // Reporte de Paros: módulo hermano del dashboard, mismo permiso.
  "Reporte de Paros": "controlpiso",
  // Alias legacy: antes este modulo se llamaba "Control piso".
  "Control piso": "controlpiso",
  "Asignación de Lotes": "asignacion_lotes",
  "Historial de lotes": "historial_lotes",
  "Registro sanitario": "registro_sanitario",
  "Ver historial de Inspección": "ver_historial_inspeccion",
  "Historial Aprobaciones": "historial_aprobaciones",
  Picking: "picking",
  Packing: "packing",
  "Ver Picking": "ver_picking",
  "Ver Picking/Packing": "ver_picking",
  "Auditoría de Inventario": "auditoria_inventario",
  "Centro de Evidencia ISO 9001": "evidenciasido",
  "Dashboard Operacion": "dashboard_operacion",
  "Asistente IA": "asistenteia",
  "Servicios Adicionales": "solicitudturnos",
  "Aprobar Turnos": "aprobacionturnos",
  "Gestión de Contratos": "gestion_contratos",
  // Examenes Médicos: parte de SST, con permiso PROPIO (`examenes_medicos`)
  // para poder otorgarlo por separado en Gestión de Usuarios. Se puebla desde
  // sst_autoevaluacion (ver scripts/063_add_examenes_medicos_permission.sql) para
  // no quitarle el acceso a quien ya audita la matriz 0312.
  "Examenes Médicos": "examenes_medicos",
  "Gestión de Dotación EPP": "dotacion_epp",
  "Gestión de Capacitaciones": "capacitaciones",
  "Asistencia a Capacitaciones": "asistencia_capacitaciones",
  "Operación del día": "operacion_dia",
  "Solicitud de Personal": "solicitud_personal",
  "Evaluaciones de Desempeño": "evaluacionpersonal",
  "Evidencia de Inducciones": "evidenciasinducciones",
  Inducciones: "inducciones",
  "Gestión de Solicitudes": "gestionsolicitudes",
  // Modulo alterno de aprobacion: comparte el permiso de Gestión de Solicitudes.
  "Aprobación de Solicitudes de Personal": "gestionsolicitudes",
  // Banco de hojas de vida: comparte el permiso de Gestión de Solicitudes.
  "Hojas de Vida": "gestionsolicitudes",
  // Antecedentes: comparte el permiso de Gestión de Solicitudes.
  Antecedentes: "gestionsolicitudes",
  "Gestión de proveedores": "gestion_proveedores",
  "Creación de materiales": "creacion_materiales",
  "Ingresos MP": "ingresos_mp",
  "Explosión de materiales": "explosion_materiales",
  "Saldos de empaque": "saldos_empaque",
  "Saldos de materia prima": "saldos_materia_prima",
  Tarifas: "tarifas",
  "Facturación Proyectos": "facturacion_proyectos",
  // Indicador de facturación por proyectos (Gestión Financiera): comparte el
  // permiso de Facturación Proyectos (conserva accesos ya otorgados).
  "Indicador de Facturación por Proyectos": "facturacion_proyectos",
  "Gestión de Facturas": "gestionfacturas",
  // Pestaña "Cuadro de Control" dentro de Gestión de Facturas; permiso propio.
  "Cuadro de Control Facturación": "cuadro_facturacion",
  // Consulta por proyecto (solo lectura): comparte el permiso de Cuadro de
  // Control (misma audiencia, sin migración nueva).
  "Resumen de Facturación por Proyecto": "cuadro_facturacion",
  "Cargos Fijos": "cargos_fijos",
  // Conciliación Avimol (cobro por producción vs pago por turnos); permiso propio.
  "Conciliación Avimol": "conciliacion_avimol",
  // Prefactura de lo que se cobra por PRODUCCIÓN: Avimol (Salvado / Estibado PT
  // + horas extra) e Indupan (Tolva). Documento cobrable con ciclo de vida, así
  // que lleva permiso propio y no el del Cuadro de Control.
  "Prefactura de Producción": "prefactura_produccion",
  "Corrección de Órdenes": "correccion_ordenes",
  // Ciclo de Facturación: la visibilidad del módulo/menú es `ciclo_facturacion`
  // (el mapa solo soporta una llave por módulo); dentro del módulo, las
  // acciones de cada paso se gatean aparte por `ciclo_facturacion_jefe`/
  // `ciclo_facturacion_coordinador`.
  "Ciclo de Facturación": "ciclo_facturacion",
  // Ambos modulos del flujo de gastos comparten un unico permiso `gastos`
  // en `permisos_usuarios`, asi que mapean al mismo campo.
  "Registrar Gasto": "gastos",
  "Dashboard Gastos": "gastos",
  "Estado de Resultados": "estadoresultados",
  "Dashboard Operaciones LIP": "dashboardop",
  "Registro Preoperacional": "prechequeo",
  Bitácora: "bitacora",
  "Head Count": "headcount",
  Nominapersonal: "nominapersonal",
  Liquidaciones: "liquidaciones",
  Parafiscales: "parafiscales",
  "Revisión de nómina": "revision_nomina",
  // Bonos operativos/administrativos (Compensación). Un solo permiso cubre
  // registrar y aprobar; la trazabilidad queda en bonos_nomina.
  "Bonos": "bonos",
  // Agrega personal extra (aparte de Picking/Packing) a una orden de
  // Cargue/Descargue para que entre en el reparto de toneladas.
  "Asignación de apoyo en cargue": "apoyo_cargue",
  "Registro de asistencia": "registro_asistencia",
  "Tabla Asistencia": "tabla_asistencia",
  "Asignación horas extra": "asignacion_horas_extra",
  "Novedades de personal": "novedades_personal",
  "Asistencia Administrativa": "asistencia_administrativa",
  Ausentismos: "ausentismos",
  // Permiso propio para que sea gestionable por separado en Gestión de Usuarios.
  "Recobro de Incapacidades": "recobro_incapacidades",
  Vacaciones: "vacaciones",
  "Acumulados LIPgo": "acumulados_lipgo",
  Turnos: "gestionturnos",
  "Programación de turnos": "programacionturnos",
  "Notificaciones al Personal": "notificaciones",
  "Control de Toneladas": "control_toneladas",
  "Productividad de Auxiliares": "productividad_auxiliares",
  "Centro de Coordinación": "centro_coordinacion",
  Visor: "visor",
  Bodegas: "config_bodegas",
  Categorías: "config_categorias",
  "Sub Categorías": "config_subcategorias",
  Clientes: "config_clientes",
  "Condiciones Pago": "config_condiciones_pago",
  Destinos: "config_destinos",
  Grupos: "config_grupos",
  Medios: "config_medios",
  Productos: "config_productos",
  Sucursales: "config_sucursales",
  "Tipos Despacho": "config_tipos_despacho",
  Transportadoras: "config_transportadoras",
  "Tipos de Vehiculos": "config_tipos_vehiculos",
  Vendedores: "config_vendedores",
  Localizaciones: "config_localizaciones",
  "Gestión de Usuarios": "gestion_usuarios",
  "Accesos de Usuario": "accesos_usuario",
  "Autorizaciones por clave": "autorizaciones_clave",
  "Bitácora de Auditoría": "bitacora_auditoria",
  "Placas de Distribución": "placas_distribucion",
  "Muelles de Cargue": "muelles_empresa",
  // --- Certificaciones LIP · SST ---
  "Auditoría 0312": "sst_auditoria",
  "Matriz de Estándares": "sst_autoevaluacion",
  "Repositorio de Soportes": "sst_repositorio_soportes",
  "Investigación AT": "sst_incidentes",
  "Alertas de AT": "sst_alertas_at",
  "Investigaciones Realizadas": "sst_investigaciones",
  MEDEVAC: "sst_medevac",
  "Perfil Sociodemográfico": "sst_perfil",
  IPEVR: "sst_ipevr",
  "Plan de Mejoramiento": "sst_plan_mejora",
  "Indicadores SST": "sst_indicadores",
  "Entrega de EPP": "sst_epp",
  "Equipos y Mantenimiento": "sst_mantenimiento",
  "Gestión de Montacargas": "montacargas",
  "Comunicación SST": "sst_comunicacion",
  "Gestión del Cambio": "sst_gestion_cambio",
  "Actividades y Comités": "sst_actividades",
  // --- Certificaciones LIP · ISO 9001 ---
  "Repositorio ISO 9001": "iso_repositorio",
  // --- Sistema Integrado de Gestión (SIG) ---
  "Dashboard SIG": "sig_matriz",
  "Análisis de Contexto DOFA": "sig_matriz",
  "Matriz Integrada SIG": "sig_matriz",
  "Repositorio por Norma SIG": "sig_matriz",
  "Repositorio Universal": "sig_matriz",
  "Objetivos y Metas SIG": "sig_matriz",
  "No Conformidades SIG": "sig_matriz",
  "Indicadores SIG": "sig_matriz",
  "Evaluación por Área": "sig_matriz",
  "Panel LIP Operación": "sig_matriz",
  "Mapa de Procesos": "sig_matriz",
  "Mapa de Interacción del Proceso": "sig_matriz",
  "Satisfacción y PQRSF": "satisfaccion_pqrsf",
  "Consulta Facturas SIIGO": "siigo_facturas",
  "Calificación del Conductor": "calificacion_conductor",
  // Inventario operativo (LIPgo = soporte del SIG): gobernados por el permiso
  // operativo `auditoria_inventario`, no por sig_matriz. Viven en Almacenamiento
  // y a la vez sirven de evidencia al SIG (8.5.1 / cierre mensual).
  "Panel LIP Inventario": "auditoria_inventario",
  // Permiso propio (2026-09-01): antes compartia `auditoria_inventario` con
  // Panel LIP Inventario y Auditoría de Inventario (ambos de solo lectura) --
  // Cuadre es el UNICO que ajusta stock real al cerrar el mes, y compartir la
  // llave impedia otorgarlo por separado. Ver scripts/154_add_cuadre_inventario_permission.sql.
  "Cuadre de Inventario": "cuadre_inventario",
  "Panel LIP Gestión Humana": "sig_matriz",
  // ISO 14001 (Ambiental)
  "Aspectos e Impactos ISO 14001": "sig_iso14001",
  "Matriz Legal Ambiental": "sig_iso14001",
  "SIG · ISO 9001": "sig_iso9001",
  "SIG · ISO 14001": "sig_iso14001",
  "SIG · ISO 45001": "sig_iso45001",
  // --- Gestión Humana ---
  "Gestión de Colaboradores": "gestion_colaboradores",
  "Carpetas de Trabajadores": "gh_carpetas",
  Entrevistas: "gh_entrevistas",
  "Programa de Bienestar": "gh_bienestar",
  "Participación y Evidencias": "gh_participacion",
  "Procesos Disciplinarios": "procesos_disciplinarios",
}
