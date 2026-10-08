// CATÁLOGO DE POLÍTICAS POR MÓDULO: qué se puede HACER dentro de cada pantalla.
//
// Hasta el 2026-10-07 el permiso de un módulo era una sola casilla: quien podía
// VER la pantalla podía ejecutar todo lo que había en ella (crear, borrar,
// aprobar, cerrar el mes…). Este catálogo declara, módulo por módulo, las
// acciones que existen y de qué nivel es cada una:
//
//   · SILENCIOSA  → una columna `<llave>__<verbo>` en `permisos_usuarios`. El
//                   servidor la exige sin preguntar nada (`exigirAccion`).
//   · CON CLAVE   → un código de `autorizacion_procesos`. El servidor pide la
//                   clave personal y comprueba el perfil (`autorizarAccion`).
//
// Un (módulo, verbo) es de un nivel O del otro, nunca de los dos.
//
// LAS CLAVES SON NOMBRES EXACTOS DEL MENÚ (los de `MODULE_PERMISSION_MAP`).
// Cuando varias pantallas comparten llave (`sig_matriz`, `gestionsolicitudes`,
// `controlpiso`…), basta declarar las acciones en una: la columna es por
// llave, y `accionesPorClave()` une lo declarado en todas.
//
// Server- y client-safe a propósito (sin "use server", sin iconos): lo usan
// las puertas del servidor, los chips de las pantallas de permisos, el
// generador del SQL 262 y las pruebas (tests/politicas-modulos.test.ts).
//
// CÓMO CAMBIAR UNA POLÍTICA: una línea aquí. Promover una aprobación operativa
// a "con clave" es moverla de `silenciosas` a `conClave` y crear el proceso en
// `PROCESOS_NUEVOS` (el SQL se regenera con scripts/generar_262_permisos_acciones.mts).

import { MODULE_PERMISSION_MAP } from "@/lib/permissions-map"
import { ETIQUETA_VERBO, SEPARADOR_ACCION, VERBOS, type ClaveAccion, type Verbo } from "@/lib/permisos-verbos"

export type PoliticaModulo = {
  /** Nivel A: columna `<llave>__<verbo>`; el servidor la exige sin clave. */
  silenciosas?: readonly Verbo[]
  /**
   * Nivel B: código(s) de `autorizacion_procesos`. Un arreglo significa que el
   * código concreto lo decide el caso (p. ej. aprobar un ajuste 601 o 702): la
   * pantalla lo muestra como "con clave" y el servidor elige el código.
   */
  conClave?: Partial<Record<Verbo, string | readonly string[]>>
  /** Texto del chip cuando el verbo genérico no describe bien la acción. */
  etiquetas?: Partial<Record<Verbo, string>>
}

const CRUD = ["crear", "editar", "eliminar"] as const
const CRUD_EXPORT = ["crear", "editar", "eliminar", "exportar"] as const

export const POLITICAS: Record<string, PoliticaModulo> = {
  // ───────────────────────── Recepción y Despacho ─────────────────────────
  "Generar Órdenes de Cargue": { silenciosas: ["crear", "editar"], etiquetas: { crear: "Generar orden", editar: "Marcar cita como procesada" } },
  "Generar Órdenes de Descargue": { silenciosas: ["crear", "editar"], etiquetas: { crear: "Generar orden", editar: "Marcar cita como procesada" } },
  "Generar Orden de Distribución": { silenciosas: ["crear"], etiquetas: { crear: "Generar orden" } },
  "Gestión de Ordenes": {
    silenciosas: ["editar", "exportar"],
    conClave: { eliminar: "ord_eliminar" },
    etiquetas: { eliminar: "Eliminar orden (revierte inventario y pedidos)" },
  },
  "Recepción de Traslado": { silenciosas: ["crear"], etiquetas: { crear: "Recibir traslado" } },
  "Dashboard Despachos/Recepción": { silenciosas: ["exportar"] },
  "Registrar Vehículos": { silenciosas: ["crear"], etiquetas: { crear: "Registrar cita" } },
  "Ver Vehículos": { silenciosas: ["editar", "eliminar", "cerrar", "exportar"], etiquetas: { cerrar: "Marcar salida" } },
  "Registro sanitario": { silenciosas: ["crear"], etiquetas: { crear: "Registrar inspección" } },
  "Ver historial de Inspección": {},
  Báscula: { silenciosas: ["editar"], etiquetas: { editar: "Registrar pesaje" } },
  "Historial Báscula": {
    silenciosas: ["exportar"],
    conClave: { editar: "bas_corregir" },
    etiquetas: { editar: "Corregir pesaje" },
  },

  // ───────────────────────── Pedidos y solicitudes ─────────────────────────
  "Entrada de pedidos": { silenciosas: ["crear", "editar"] },
  "Gestionar pedidos": {
    silenciosas: ["editar", "eliminar", "exportar"],
    conClave: {
      aprobar: ["ped_aprobar_gerencia", "ped_aprobar_cartera"],
      anular: "ped_anular",
      cerrar: "ped_cerrar_pendiente",
    },
    etiquetas: { eliminar: "Eliminar pedido nuevo", aprobar: "Aprobar (gerencia / cartera)", cerrar: "Cerrar pendiente" },
  },
  "Dashboard Pedidos": {},
  "Programación del cliente": { silenciosas: ["editar"], etiquetas: { editar: "Consignar programación" } },

  // ───────────────────────── Almacenamiento ─────────────────────────
  "Transacciones de Inventario": { silenciosas: ["crear", "exportar"], etiquetas: { crear: "Registrar movimiento" } },
  "Gestión de transacciones": { silenciosas: ["exportar"] },
  "Traslados de producto": { silenciosas: ["crear"], etiquetas: { crear: "Registrar traslado" } },
  "Saldos de inventario": { silenciosas: ["exportar"] },
  "Saldos por producto": { silenciosas: ["exportar"] },
  "Capacidad Bodega": {},
  "Auditoría de Inventario": {
    silenciosas: ["crear", "editar"],
    conClave: { cerrar: "inv_cierre_mes", aprobar: "inv_acta_firmar" },
    etiquetas: { crear: "Registrar conteo", cerrar: "Cerrar mes de inventario", aprobar: "Firmar acta" },
  },
  "Cuadre de Inventario": {
    // "editar" cubre también el avance del conteo (cerrar conteo, firma del cliente,
    // recuentos); el cierre MENSUAL que mueve stock es `cerrar`, con clave.
    silenciosas: ["crear", "editar", "eliminar", "configurar"],
    conClave: {
      aprobar: ["inv_601_aprobar", "inv_702_aprobar", "inv_555_aprobar"],
      cerrar: "inv_cuadre_cerrar_mes",
    },
    etiquetas: { crear: "Registrar corrección", aprobar: "Contabilizar corrección", cerrar: "Cerrar mes del cuadre", configurar: "Umbral y reglas" },
  },
  "Montacargas y personal día": { silenciosas: CRUD_EXPORT },
  "Asignación de Lotes": { silenciosas: ["crear"], etiquetas: { crear: "Asignar lote" } },
  "Historial de lotes": { silenciosas: ["editar", "anular", "exportar"], etiquetas: { editar: "Corregir registro", anular: "Anular asignación" } },

  // ───────────────────────── Producción ─────────────────────────
  "Ingreso de Producción": { silenciosas: ["crear"], etiquetas: { crear: "Registrar ingreso" } },
  "Ver ingresos de producción": { silenciosas: CRUD_EXPORT, etiquetas: { crear: "Registrar Tolva" } },
  "Aprobación de ingreso de producción": { silenciosas: ["aprobar", "anular"], etiquetas: { anular: "Rechazar" } },
  "Historial Aprobaciones": { silenciosas: ["exportar"] },
  "Liquidación Tolva del día": { silenciosas: ["cerrar"], etiquetas: { cerrar: "Liquidar el día" } },
  Tolva: { silenciosas: ["crear", "editar"] },
  "Ver Tolva": { silenciosas: ["editar", "eliminar"] },
  "Dashboard de Producción": { silenciosas: ["editar", "eliminar"], etiquetas: { editar: "Editar paro", eliminar: "Eliminar paro" } },
  Reprocesos: { silenciosas: ["crear", "eliminar"] },
  "Servicios Adicionales": { silenciosas: ["crear", "exportar"], etiquetas: { crear: "Solicitar servicio" } },
  "Creación de materiales": { silenciosas: CRUD_EXPORT },
  "Gestión de proveedores": { silenciosas: CRUD_EXPORT },
  "Explosión de materiales": { silenciosas: CRUD },

  // ───────────────────────── Torre de Control ─────────────────────────
  "Dashboard Operacion": {},
  "Asistente IA": {},
  Proyecciones: { silenciosas: ["editar", "eliminar"], etiquetas: { editar: "Guardar proyección", eliminar: "Eliminar proyección" } },

  // ───────────────────────── Operación LIP ─────────────────────────
  "Operación del día": {},
  "Dashboard Operaciones LIP": {},
  "Ver Picking/Packing": {},
  "Control de Toneladas": {},
  "Productividad de Auxiliares": {},
  "Lectura de QR estibas": {},
  "Inventario por Estiba": {},
  "Consignar programación del cliente": { silenciosas: ["editar"], etiquetas: { editar: "Consignar programación" } },
  Bitácora: { silenciosas: CRUD, etiquetas: { editar: "Editar / cerrar el día" } },
  "Centro de Coordinación": { silenciosas: ["editar"], etiquetas: { editar: "Asignar muelles" } },
  Picking: { silenciosas: ["editar", "cerrar", "exportar"], etiquetas: { cerrar: "Confirmar picking" } },
  Packing: { silenciosas: ["editar", "cerrar", "exportar"], etiquetas: { cerrar: "Confirmar packing" } },
  "Calificación del Conductor": { silenciosas: ["crear", "configurar"], etiquetas: { crear: "Calificar", configurar: "Generar / limpiar histórico" } },
  "Programación de turnos": { silenciosas: ["crear", "eliminar", "configurar"], etiquetas: { crear: "Programar turnos", configurar: "Turnos, demanda, equipo" } },
  "Registro de asistencia": { silenciosas: ["crear"], etiquetas: { crear: "Marcar asistencia" } },
  "Aprobar Turnos": { silenciosas: ["aprobar", "anular"], etiquetas: { anular: "Rechazar" } },
  "Solicitud de Personal": { silenciosas: ["crear"], etiquetas: { crear: "Solicitar personal" } },
  "Notificaciones al Personal": { silenciosas: ["crear", "configurar"], etiquetas: { crear: "Enviar notificación", configurar: "Plantillas" } },
  "Registro de QR estibas": { silenciosas: ["crear"], etiquetas: { crear: "Registrar estiba" } },
  "Solicitar Facturas": { silenciosas: ["editar", "anular", "exportar"], etiquetas: { editar: "Estado, pago, comprobante, amarrar", anular: "Deshacer amarre" } },
  "Satisfacción y PQRSF": { silenciosas: CRUD },

  // ───────────────────────── Gestión Financiera ─────────────────────────
  "Cuadro de Control Facturación": {
    silenciosas: ["crear", "eliminar"],
    conClave: { aprobar: "fac_prefactura_aprobar" },
    etiquetas: { crear: "Crear prefactura", aprobar: "Aprobar / reabrir prefactura" },
  },
  "Resumen de Facturación por Proyecto": { silenciosas: ["exportar"] },
  "Ciclo de Facturación": {
    silenciosas: ["configurar"],
    conClave: { crear: "fac_registrar_pago", aprobar: "fac_emitir_siigo" },
    etiquetas: { crear: "Registrar pago", aprobar: "Emitir factura en Siigo", configurar: "Configuración del ciclo" },
  },
  "Facturación Proyectos": { silenciosas: ["exportar"] },
  "Indicador de Facturación por Proyectos": { silenciosas: ["exportar"] },
  "Consulta Facturas SIIGO": { silenciosas: ["configurar"], etiquetas: { configurar: "Conexión y sincronización" } },
  "Conciliación Avimol": {},
  "Prefactura de Producción": {
    silenciosas: ["crear", "eliminar"],
    conClave: { aprobar: "fac_prefactura_prod_aprobar" },
    etiquetas: { crear: "Crear prefactura" },
  },
  "Cargos Fijos": { silenciosas: ["crear", "editar", "configurar"] },
  "Corrección de Órdenes": { conClave: { editar: "fac_corregir_orden" }, etiquetas: { editar: "Corregir orden" } },
  Tarifas: { silenciosas: ["exportar"], conClave: { configurar: "fac_tarifas" }, etiquetas: { configurar: "Cambiar tarifas" } },
  "Estado de Resultados": { silenciosas: ["configurar"], etiquetas: { configurar: "Acuerdo de volumen" } },
  "Registrar Gasto": { silenciosas: ["crear"], etiquetas: { crear: "Registrar gasto" } },

  // ───────────────────────── Gestión Humana ─────────────────────────
  "Gestión de Solicitudes": {
    silenciosas: ["crear", "editar", "eliminar", "aprobar", "anular", "exportar"],
    etiquetas: { anular: "Rechazar" },
  },
  Entrevistas: { silenciosas: CRUD },
  "Gestión de Contratos": { silenciosas: CRUD },
  "Gestión de Colaboradores": { silenciosas: CRUD },
  "Head Count": { silenciosas: CRUD },
  "Carpetas de Trabajadores": {},
  Visor: { silenciosas: ["editar"], etiquetas: { editar: "Editar novedad del día" } },
  "Programa de Bienestar": {},
  "Participación y Evidencias": { silenciosas: ["crear", "editar"] },
  Inducciones: { silenciosas: ["crear", "editar", "eliminar", "cerrar"] },
  "Evidencia de Inducciones": { silenciosas: ["crear", "editar", "eliminar", "cerrar"] },
  "Gestión de Capacitaciones": { silenciosas: CRUD_EXPORT },
  "Asistencia a Capacitaciones": { silenciosas: CRUD_EXPORT },
  "Evaluaciones de Desempeño": { silenciosas: ["crear"], etiquetas: { crear: "Evaluar" } },
  "Tabla Asistencia": {
    silenciosas: CRUD,
    conClave: { configurar: "nom_parametros" },
    etiquetas: { configurar: "Políticas de horas extra" },
  },
  "Asignación horas extra": { silenciosas: ["aprobar"] },
  "Novedades de personal": { silenciosas: ["crear", "editar"] },
  Ausentismos: { silenciosas: ["crear", "editar", "eliminar", "configurar"], etiquetas: { crear: "Registrar / importar" } },
  "Recobro de Incapacidades": { silenciosas: ["editar"] },
  "Procesos Disciplinarios": { silenciosas: ["crear", "editar", "cerrar"] },
  "Examenes Médicos": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },

  // ───────────────────────── Compensación ─────────────────────────
  "Revisión de nómina": {
    silenciosas: ["crear"],
    conClave: { aprobar: "nom_ajustes_aprobar", anular: "nom_ajustes_aprobar" },
    etiquetas: { crear: "Registrar ajuste", aprobar: "Aprobar ajuste", anular: "Rechazar ajuste" },
  },
  Nominapersonal: { silenciosas: ["exportar"] },
  "Acumulados LIPgo": { silenciosas: ["exportar"] },
  Bonos: {
    silenciosas: ["crear", "eliminar", "anular"],
    conClave: { aprobar: "fin_bonos_aprobar" },
    etiquetas: { crear: "Registrar bono" },
  },
  "Asignación de apoyo en cargue": { silenciosas: ["crear", "eliminar"] },
  "Asistencia Administrativa": { silenciosas: ["crear", "editar", "cerrar"], etiquetas: { cerrar: "Cerrar mes" } },
  Liquidaciones: {
    silenciosas: ["editar"],
    conClave: { aprobar: "nom_liquidacion_aprobar", configurar: "nom_parametros" },
    etiquetas: { aprobar: "Aprobar liquidación", configurar: "Parámetros de liquidación" },
  },
  Parafiscales: {
    silenciosas: ["editar", "exportar"],
    conClave: { configurar: "nom_parametros", cerrar: "nom_periodo_pagar" },
    etiquetas: { cerrar: "Marcar período pagado", configurar: "Tasas y parámetros" },
  },
  Vacaciones: { silenciosas: ["crear", "aprobar", "anular", "cerrar"], etiquetas: { anular: "Rechazar", cerrar: "Liquidar" } },
  Turnos: { conClave: { configurar: "nom_parametros" }, etiquetas: { configurar: "Turnos y tarifas por puesto" } },

  // ───────────────────────── Certificaciones · SIG ─────────────────────────
  "Dashboard SIG": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Indicadores SIG": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Evaluación por Área": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Matriz Integrada SIG": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Análisis de Contexto DOFA": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Objetivos y Metas SIG": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "No Conformidades SIG": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Repositorio por Norma SIG": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Repositorio Universal": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Mapa de Procesos": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Mapa de Interacción del Proceso": { silenciosas: ["crear", "editar", "eliminar", "configurar"] },
  "Centro de Evidencia ISO 9001": { silenciosas: ["editar"] },
  "Repositorio ISO 9001": { silenciosas: ["editar"] },
  "Auditoría ISO 9001": { silenciosas: ["crear", "editar", "eliminar", "cerrar"], etiquetas: { cerrar: "Cerrar auditoría" } },
  "Aspectos e Impactos ISO 14001": { silenciosas: CRUD },
  "Matriz Legal Ambiental": { silenciosas: CRUD },

  // ───────────────────────── SST ─────────────────────────
  "Auditoría 0312": { silenciosas: ["editar", "cerrar"], etiquetas: { cerrar: "Cerrar auditoría" } },
  "Matriz de Estándares": { silenciosas: ["editar", "cerrar"], etiquetas: { cerrar: "Cerrar evaluación" } },
  "Plan de Mejoramiento": { silenciosas: ["crear", "editar", "eliminar", "cerrar"] },
  "Indicadores SST": { silenciosas: ["crear", "editar", "eliminar", "cerrar"] },
  "Repositorio de Soportes": { silenciosas: ["crear", "anular", "eliminar"], etiquetas: { crear: "Subir soporte" } },
  IPEVR: { silenciosas: ["crear", "editar"] },
  "Gestión del Cambio": { silenciosas: ["crear", "editar"] },
  "Equipos y Mantenimiento": { silenciosas: ["crear", "editar"] },
  "Registro Preoperacional": { silenciosas: ["crear", "editar"] },
  "Entrega de EPP": { silenciosas: ["crear", "editar"] },
  "Comunicación SST": { silenciosas: ["crear", "editar"] },
  "Actividades y Comités": { silenciosas: ["crear", "editar"] },
  "Gestión de Montacargas": { silenciosas: CRUD },
  "Gestión de Dotación EPP": { silenciosas: CRUD },
  "Alertas de AT": { silenciosas: ["crear", "editar"] },
  "Investigación AT": { silenciosas: ["crear", "editar"] },
  "Investigaciones Realizadas": { silenciosas: ["crear", "editar"] },
  MEDEVAC: { silenciosas: ["crear", "editar", "eliminar", "aprobar"] },
  "Perfil Sociodemográfico": { silenciosas: ["crear", "editar", "eliminar", "aprobar"] },

  // ───────────────────────── Configuración ─────────────────────────
  Clientes: { silenciosas: CRUD_EXPORT },
  Sucursales: { silenciosas: CRUD_EXPORT },
  "Condiciones Pago": { silenciosas: CRUD_EXPORT },
  Vendedores: { silenciosas: CRUD_EXPORT },
  Productos: { silenciosas: CRUD_EXPORT },
  Categorías: { silenciosas: CRUD_EXPORT },
  "Sub Categorías": { silenciosas: CRUD_EXPORT },
  Bodegas: { silenciosas: CRUD_EXPORT },
  Localizaciones: { silenciosas: CRUD_EXPORT },
  Transportadoras: { silenciosas: CRUD_EXPORT },
  "Tipos de Vehiculos": { silenciosas: CRUD_EXPORT },
  "Tipos Despacho": { silenciosas: CRUD_EXPORT },
  Destinos: { silenciosas: CRUD_EXPORT },
  Grupos: { silenciosas: CRUD_EXPORT },
  Medios: { silenciosas: CRUD_EXPORT },
  "Muelles de Cargue": { silenciosas: CRUD },
  "Placas de Distribución": { silenciosas: CRUD },
  "Gestión de Usuarios": {
    silenciosas: ["crear", "editar", "configurar"],
    conClave: { eliminar: "seg_usuario_eliminar" },
    etiquetas: { crear: "Crear usuario", editar: "Permisos, perfiles, clave", eliminar: "Eliminar usuario", configurar: "Perfiles y procesos" },
  },
  "Bitácora de Auditoría": { silenciosas: ["exportar"] },

  // ───────────────────────── Pantallas que comparten llave con otra ─────────────────────────
  // La columna es por llave, así que lo declarado aquí se UNE con lo de la pantalla
  // hermana; se declaran para que el catálogo cubra el 100% del menú y la puerta
  // pueda nombrar la pantalla real desde la que se llama.
  "Panel LIP Inventario": {
    silenciosas: ["crear", "editar"],
    conClave: { cerrar: "inv_cierre_mes", aprobar: "inv_acta_firmar" },
    etiquetas: { crear: "Acta de cruce", editar: "Corregir acta", cerrar: "Cerrar mes de inventario", aprobar: "Firmar acta" },
  },
  "Reporte de Paros": { silenciosas: ["editar", "eliminar"], etiquetas: { editar: "Registrar paro", eliminar: "Eliminar paro" } },
  "Panel LIP Operación": {},
  "Panel LIP Gestión Humana": {},
  "Dashboard Gastos": {},
  "Aprobación de Solicitudes de Personal": { silenciosas: ["aprobar", "anular", "crear", "editar"], etiquetas: { anular: "Rechazar" } },
  "Hojas de Vida": { silenciosas: ["crear", "editar", "eliminar"], etiquetas: { crear: "Sincronizar desde Head Count" } },
  Antecedentes: { silenciosas: ["crear", "aprobar", "eliminar", "editar"], etiquetas: { crear: "Sincronizar / subir soporte", aprobar: "Decidir antecedente" } },
  "Gestión integral de pedidos": { silenciosas: ["editar", "eliminar", "exportar"] },
  "Ver Picking": {},
  "Ver Solicitudes de traslado": { silenciosas: ["crear"], etiquetas: { crear: "Recibir traslado" } },
}

export type ProcesoNuevo = {
  codigo: string
  nombre: string
  descripcion: string
  grupo: string
  orden: number
  con_alcance: boolean
}

/**
 * Procesos con clave que este catálogo introduce (SQL 262). Los que ya existían
 * (inv_*, ped_*, fin_*) se citan en `conClave` tal cual y no van aquí.
 */
export const PROCESOS_NUEVOS: readonly ProcesoNuevo[] = [
  { codigo: "ord_eliminar", nombre: "Eliminar orden de cargue / descargue", descripcion: "Gestión de Ordenes › Eliminar. Revierte inventario (invtrans), aprobaciones de calidad y pedidos asociados: irreversible.", grupo: "Órdenes", orden: 10, con_alcance: true },
  { codigo: "bas_corregir", nombre: "Corregir un pesaje de báscula", descripcion: "Historial Báscula › Editar. Reemplaza la clave fija que vivía en el navegador.", grupo: "Órdenes", orden: 20, con_alcance: true },
  { codigo: "inv_cierre_mes", nombre: "Cerrar el mes de inventario", descripcion: "Panel LIP Inventario / Auditoría de Inventario › Cierre mensual.", grupo: "Inventario", orden: 200, con_alcance: true },
  { codigo: "inv_acta_firmar", nombre: "Firmar el acta de inventario", descripcion: "Auditoría de Inventario › Firmar acta del cliente.", grupo: "Inventario", orden: 210, con_alcance: true },
  { codigo: "inv_cuadre_cerrar_mes", nombre: "Cerrar el mes del cuadre (contabiliza correcciones)", descripcion: "Cuadre de Inventario › Cierre mensual: postea todas las correcciones a invtrans y mueve el stock.", grupo: "Inventario", orden: 220, con_alcance: true },
  { codigo: "fac_prefactura_aprobar", nombre: "Aprobar o reabrir una prefactura", descripcion: "Cuadro de Control Facturación › Aprobar / Reabrir.", grupo: "Facturación", orden: 10, con_alcance: true },
  { codigo: "fac_registrar_pago", nombre: "Registrar un pago de contado", descripcion: "Ciclo de Facturación › Pagos de Contado › Registrar pago.", grupo: "Facturación", orden: 20, con_alcance: true },
  { codigo: "fac_emitir_siigo", nombre: "Emitir factura en Siigo (DIAN)", descripcion: "Ciclo de Facturación › Facturar en Siigo. Si la emisión va a la DIAN es irreversible: solo se anula con nota crédito.", grupo: "Facturación", orden: 30, con_alcance: true },
  { codigo: "fac_prefactura_prod_aprobar", nombre: "Aprobar prefactura de producción", descripcion: "Prefactura de Producción › Aprobar.", grupo: "Facturación", orden: 40, con_alcance: true },
  { codigo: "fac_corregir_orden", nombre: "Corregir una orden ya facturada", descripcion: "Corrección de Órdenes › Guardar corrección.", grupo: "Facturación", orden: 50, con_alcance: true },
  { codigo: "fac_tarifas", nombre: "Cambiar tarifas", descripcion: "Tarifas › crear, editar o eliminar una tarifa (también desde LIPbot).", grupo: "Facturación", orden: 60, con_alcance: true },
  { codigo: "nom_ajustes_aprobar", nombre: "Aprobar o rechazar ajustes de nómina", descripcion: "Revisión de nómina › Aprobar / Rechazar.", grupo: "Nómina", orden: 10, con_alcance: false },
  { codigo: "nom_liquidacion_aprobar", nombre: "Aprobar una liquidación", descripcion: "Liquidaciones › Aprobar.", grupo: "Nómina", orden: 20, con_alcance: false },
  { codigo: "nom_parametros", nombre: "Cambiar parámetros de liquidación y pago", descripcion: "Liquidaciones, Parafiscales, Turnos y tarifas por puesto, políticas de horas extra.", grupo: "Nómina", orden: 30, con_alcance: false },
  { codigo: "nom_periodo_pagar", nombre: "Marcar un período como pagado", descripcion: "Parafiscales › Período pagado.", grupo: "Nómina", orden: 40, con_alcance: false },
  { codigo: "seg_usuario_eliminar", nombre: "Eliminar un usuario", descripcion: "Gestión de Usuarios › Eliminar usuario (borra la cuenta de acceso).", grupo: "Seguridad", orden: 10, con_alcance: false },
]

// ───────────────────────── helpers ─────────────────────────

/** Llave de `permisos_usuarios` del módulo; `null` si el módulo no existe. */
export function llaveDeModulo(modulo: string): string | null {
  return (MODULE_PERMISSION_MAP[modulo] as string | undefined) ?? null
}

/**
 * Clave en `permisos_usuarios` de (módulo, verbo): `<llave>__<verbo>`; con
 * `"ver"` devuelve la llave del módulo. `null` si el módulo no existe o si
 * esa acción no es silenciosa en ese módulo (no está, o es con clave).
 */
export function claveAccion(modulo: string, verbo: Verbo | "ver"): string | null {
  const llave = llaveDeModulo(modulo)
  if (!llave) return null
  if (verbo === "ver") return llave
  if (nivelDe(modulo, verbo) !== "silenciosa") return null
  return `${llave}${SEPARADOR_ACCION}${verbo}`
}

/** Código(s) de proceso de una acción con clave; `null` si no es con clave. */
export function procesoDeAccion(modulo: string, verbo: Verbo): string | readonly string[] | null {
  return POLITICAS[modulo]?.conClave?.[verbo] ?? null
}

export function nivelDe(modulo: string, verbo: Verbo): "silenciosa" | "clave" | null {
  const p = POLITICAS[modulo]
  if (!p) return null
  if (p.conClave?.[verbo]) return "clave"
  if (p.silenciosas?.includes(verbo)) return "silenciosa"
  return null
}

export function etiquetaAccion(modulo: string, verbo: Verbo): string {
  return POLITICAS[modulo]?.etiquetas?.[verbo] ?? ETIQUETA_VERBO[verbo]
}

export type AccionDeClave = {
  /** `<llave>__<verbo>` */
  key: ClaveAccion
  verbo: Verbo
  /** Etiqueta del chip: la del primer módulo que la declara con etiqueta propia. */
  label: string
  /** Módulos del menú que comparten la llave y declaran la acción. */
  modulos: string[]
}

export type ProcesoDeClave = { verbo: Verbo; proceso: string | readonly string[]; label: string; modulos: string[] }

/** Acciones silenciosas por llave de módulo (unión de las pantallas que la comparten), en el orden de VERBOS. */
export function accionesPorClave(): Map<string, AccionDeClave[]> {
  const out = new Map<string, Map<Verbo, AccionDeClave>>()
  for (const [modulo, pol] of Object.entries(POLITICAS)) {
    const llave = llaveDeModulo(modulo)
    if (!llave) continue
    for (const verbo of pol.silenciosas ?? []) {
      if (pol.conClave?.[verbo]) continue
      let porLlave = out.get(llave)
      if (!porLlave) out.set(llave, (porLlave = new Map()))
      const key = `${llave}${SEPARADOR_ACCION}${verbo}` as ClaveAccion
      const prev = porLlave.get(verbo)
      if (prev) {
        prev.modulos.push(modulo)
        if (prev.label === ETIQUETA_VERBO[verbo] && pol.etiquetas?.[verbo]) prev.label = pol.etiquetas[verbo]!
      } else {
        porLlave.set(verbo, { key, verbo, label: pol.etiquetas?.[verbo] ?? ETIQUETA_VERBO[verbo], modulos: [modulo] })
      }
    }
  }
  const ordenado = new Map<string, AccionDeClave[]>()
  for (const [llave, m] of out) ordenado.set(llave, VERBOS.filter((v) => m.has(v)).map((v) => m.get(v)!))
  return ordenado
}

/** Acciones con clave por llave de módulo. */
export function procesosPorClave(): Map<string, ProcesoDeClave[]> {
  const out = new Map<string, Map<Verbo, ProcesoDeClave>>()
  for (const [modulo, pol] of Object.entries(POLITICAS)) {
    const llave = llaveDeModulo(modulo)
    if (!llave || !pol.conClave) continue
    for (const [v, proceso] of Object.entries(pol.conClave) as [Verbo, string | readonly string[]][]) {
      let porLlave = out.get(llave)
      if (!porLlave) out.set(llave, (porLlave = new Map()))
      const prev = porLlave.get(v)
      if (prev) prev.modulos.push(modulo)
      else porLlave.set(v, { verbo: v, proceso, label: pol.etiquetas?.[v] ?? ETIQUETA_VERBO[v], modulos: [modulo] })
    }
  }
  const ordenado = new Map<string, ProcesoDeClave[]>()
  for (const [llave, m] of out) ordenado.set(llave, VERBOS.filter((v) => m.has(v)).map((v) => m.get(v)!))
  return ordenado
}

/** Todas las claves de acción (columnas nuevas de `permisos_usuarios`), únicas y ordenadas. */
export function clavesDeAcciones(): string[] {
  const out: string[] = []
  for (const acciones of accionesPorClave().values()) for (const a of acciones) out.push(a.key)
  return out.sort()
}

/** Pares (llave de módulo, clave de acción), para sembrar `acción = true where módulo is true`. */
export function paresLlaveAccion(): { llave: string; accion: string }[] {
  const out: { llave: string; accion: string }[] = []
  for (const [llave, acciones] of accionesPorClave()) for (const a of acciones) out.push({ llave, accion: a.key })
  return out.sort((a, b) => a.accion.localeCompare(b.accion))
}

/** Códigos de proceso citados en `conClave` (nuevos y existentes), con los módulos que los usan. */
export function procesosDeAcciones(): { codigo: string; verbo: Verbo; modulos: string[] }[] {
  const m = new Map<string, { codigo: string; verbo: Verbo; modulos: string[] }>()
  for (const [modulo, pol] of Object.entries(POLITICAS)) {
    for (const [v, proceso] of Object.entries(pol.conClave ?? {}) as [Verbo, string | readonly string[]][]) {
      for (const codigo of Array.isArray(proceso) ? proceso : [proceso as string]) {
        const prev = m.get(codigo)
        if (prev) prev.modulos.push(modulo)
        else m.set(codigo, { codigo, verbo: v, modulos: [modulo] })
      }
    }
  }
  return [...m.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))
}

/**
 * Errores de coherencia del catálogo. La prueba exige que esté vacío; en
 * desarrollo se imprime al cargar el módulo.
 */
export function validarPoliticas(): string[] {
  const errores: string[] = []
  const nuevos = new Set(PROCESOS_NUEVOS.map((p) => p.codigo))
  const existentesConocidos = /^(inv_\d{3}(_aprobar)?|inv_cuadre_manual|inv_conteo_umbral|ped_aprobar_gerencia|ped_aprobar_cartera|ped_anular|ped_cerrar_pendiente|ped_depurar|fin_gestion_financiera|fin_bonos_aprobar)$/
  for (const [modulo, pol] of Object.entries(POLITICAS)) {
    const llave = llaveDeModulo(modulo)
    if (!llave) {
      errores.push(`"${modulo}" no existe en MODULE_PERMISSION_MAP`)
      continue
    }
    if (llave.includes(SEPARADOR_ACCION)) errores.push(`la llave "${llave}" contiene "${SEPARADOR_ACCION}"`)
    for (const v of pol.silenciosas ?? []) {
      if (pol.conClave?.[v]) errores.push(`"${modulo}" declara "${v}" silenciosa y con clave a la vez`)
      const col = `${llave}${SEPARADOR_ACCION}${v}`
      if (col.length > 63) errores.push(`la columna "${col}" supera 63 caracteres`)
    }
    for (const [v, proceso] of Object.entries(pol.conClave ?? {}) as [Verbo, string | readonly string[]][]) {
      for (const codigo of Array.isArray(proceso) ? proceso : [proceso as string]) {
        if (!nuevos.has(codigo) && !existentesConocidos.test(codigo)) errores.push(`"${modulo}".${v} cita el proceso "${codigo}", que no es nuevo ni conocido`)
      }
    }
    for (const v of Object.keys(pol.etiquetas ?? {}) as Verbo[]) {
      if (!nivelDe(modulo, v)) errores.push(`"${modulo}" etiqueta "${v}" sin declararla`)
    }
  }
  const vistos = new Set<string>()
  for (const p of PROCESOS_NUEVOS) {
    if (vistos.has(p.codigo)) errores.push(`proceso nuevo repetido: ${p.codigo}`)
    vistos.add(p.codigo)
  }
  const citados = new Set(procesosDeAcciones().map((p) => p.codigo))
  for (const p of PROCESOS_NUEVOS) if (!citados.has(p.codigo)) errores.push(`el proceso nuevo "${p.codigo}" no lo usa ningún módulo`)
  return errores
}

if (process.env.NODE_ENV !== "production") {
  const errores = validarPoliticas()
  if (errores.length) console.warn("[politicas-modulos] catálogo incoherente:\n  " + errores.join("\n  "))
}
