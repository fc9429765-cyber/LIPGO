// Registro de HUBS de navegación (pantallas con pestañas) y utilidades de
// navegación. Cliente-seguro, sin "use server".
//
// Principio (reorg 2026-09-30): `lib/dashboard-data.ts` sigue siendo el registro
// PLANO de módulos hoja — lo leen 11 consumidores, dos del lado servidor
// (lib/permisos-financieros.ts y el prompt de LIPbot) y el chequeo
// scripts/check-aprendizaje.mjs. Por eso los hubs viven AQUÍ, aparte, y solo
// REFERENCIAN nombres de módulos existentes. Un hub nunca es un módulo: no tiene
// permiso propio, no tiene KPIs ni guía; cada pestaña conserva los suyos.
//
// El estado de navegación (`selectedModule` en app/page.tsx) sigue siendo el
// módulo HOJA; el hub se deriva con `hubDe()` y nunca se guarda. Así todo lo que
// consume `selectedModule` (KPIs, guía, LIPbot, eventos, ErrorBoundary) sigue
// funcionando sin cambios.

import { groups, type GroupKey, type Module } from "@/lib/dashboard-data"
import {
  Activity,
  ArrowRightLeft,
  BadgeCheck,
  Banknote,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileCheck,
  FolderArchive,
  Forklift,
  Gauge,
  GraduationCap,
  HeartHandshake,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Leaf,
  Lock,
  NotebookPen,
  Package,
  PackagePlus,
  QrCode,
  Receipt,
  Scale,
  ShieldCheck,
  Stethoscope,
  Store,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react"

export interface HubTab {
  /** `name` EXACTO de un módulo existente (clave de ruteo/permiso/KPI/guía). Nunca se renombra. */
  module: string
  /** Texto corto de la pestaña. Por defecto, el label del módulo o su name. */
  label?: string
}

export interface Hub {
  /** Única en toda la app, con prefijo del grupo (p. ej. "lip_centro"). Va en la URL. */
  key: string
  group: GroupKey
  title: string
  icon: LucideIcon
  /** Color propio de la pantalla (barra de pestañas, tarjeta, ícono). Si falta, se asigna de la paleta. */
  color?: string
  /** Una frase: para qué sirve la pantalla (portal de área y buscador). */
  descripcion?: string
  /** Todas las pestañas deben pertenecer a UN mismo subgrupo (o a la lista directa) de `group`. */
  tabs: HubTab[]
}

/** Entrada ya "plegada" para pintar en barra lateral, portal de grupo o buscador. */
export type EntradaMenu =
  | { tipo: "modulo"; modulo: Module }
  | { tipo: "hub"; hub: Hub; tabs: Module[] }

// ---------------------------------------------------------------------------
// Hubs por área. Se llenan por fases (piloto 2026-09-30: Operación LIP y
// Recepción y Despacho). Cada `module` es un `name` real de dashboard-data.
// ---------------------------------------------------------------------------
export const HUBS: Hub[] = [
  // ===== Operación LIP =====
  {
    key: "lip_dia",
    group: "lip",
    title: "Operación del día",
    icon: LayoutDashboard,
    color: "#0d9488",
    descripcion: "Cómo va el día en la planta: personal, pendientes, vehículos, toneladas y cierre.",
    tabs: [
      { module: "Operación del día", label: "Resumen del día" },
      { module: "Panel LIP Operación", label: "Tablero del coordinador" },
      { module: "Dashboard Operaciones LIP", label: "Dashboard de operaciones" },
      { module: "Bitácora", label: "Bitácora" },
    ],
  },
  {
    key: "lip_centro",
    group: "lip",
    title: "Centro de Coordinación",
    icon: LayoutGrid,
    color: "#2563eb",
    descripcion: "Muelles en vivo, asignar personal e iniciar y cerrar cada vehículo.",
    tabs: [
      { module: "Centro de Coordinación", label: "Muelles y órdenes" },
      { module: "Picking", label: "Picking" },
      { module: "Packing", label: "Packing" },
      { module: "Ver Picking/Packing", label: "Historial" },
      { module: "Calificación del Conductor", label: "Calificar conductor" },
    ],
  },
  {
    key: "lip_personal",
    group: "lip",
    title: "Personal del día",
    icon: Users,
    color: "#db2777",
    descripcion: "Programar turnos, registrar asistencia, aprobar turnos y pedir personal.",
    tabs: [
      { module: "Programación de turnos", label: "Programación" },
      { module: "Registro de asistencia", label: "Registro de asistencia" },
      { module: "Aprobar Turnos", label: "Aprobar turnos" },
      { module: "Solicitud de Personal", label: "Solicitud de personal" },
      { module: "Notificaciones al Personal", label: "Notificaciones" },
    ],
  },
  {
    key: "lip_toneladas",
    group: "lip",
    title: "Toneladas y productividad",
    icon: Scale,
    color: "#d97706",
    descripcion: "Quién carga de verdad: toneladas por auxiliar, ranking y real contra pagado.",
    tabs: [
      { module: "Control de Toneladas", label: "Control de toneladas" },
      { module: "Productividad de Auxiliares", label: "Productividad de auxiliares" },
    ],
  },
  {
    key: "lip_estibas",
    group: "lip",
    title: "Estibas QR",
    icon: QrCode,
    color: "#7c3aed",
    descripcion: "Etiquetar, leer y consultar estibas por código QR.",
    tabs: [
      { module: "Registro de QR estibas", label: "Registrar" },
      { module: "Lectura de QR estibas", label: "Leer" },
      { module: "Inventario por Estiba", label: "Inventario por estiba" },
    ],
  },
  // ===== Recepción y Despacho =====
  {
    key: "desp_ordenes",
    group: "despachos",
    title: "Órdenes",
    icon: Truck,
    color: "#2563eb",
    descripcion: "Crear órdenes de cargue, descargue y distribución, y gestionarlas.",
    tabs: [
      { module: "Generar Órdenes de Cargue", label: "Cargue" },
      { module: "Generar Órdenes de Descargue", label: "Descargue" },
      { module: "Generar Orden de Distribución", label: "Distribución" },
      { module: "Gestión de Ordenes", label: "Gestión de órdenes" },
    ],
  },
  {
    key: "desp_porteria",
    group: "despachos",
    title: "Portería y vehículos",
    icon: ClipboardCheck,
    color: "#059669",
    descripcion: "Citas y llegada de vehículos, inspección sanitaria y su historial.",
    tabs: [
      { module: "Registrar Vehículos", label: "Registrar" },
      { module: "Ver Vehículos", label: "Ver vehículos" },
      { module: "Registro sanitario", label: "Registro sanitario" },
      { module: "Ver historial de Inspección", label: "Historial de inspección" },
    ],
  },
  {
    key: "desp_bascula",
    group: "despachos",
    title: "Báscula",
    icon: Scale,
    color: "#d97706",
    descripcion: "Pesar vehículos y revisar el historial de pesajes.",
    tabs: [
      { module: "Báscula", label: "Pesar" },
      { module: "Historial Báscula", label: "Historial" },
    ],
  },
  // ===== Pedidos y solicitudes (Fase 4) =====
  {
    key: "ped_pedidos",
    group: "pedidos",
    title: "Pedidos",
    icon: PackagePlus,
    color: "#2563eb",
    descripcion: "Registrar los pedidos del cliente, gestionarlos y ver su cumplimiento.",
    tabs: [
      { module: "Entrada de pedidos", label: "Entrada" },
      { module: "Gestionar pedidos", label: "Gestionar" },
      { module: "Dashboard Pedidos", label: "Dashboard" },
    ],
  },
  // ===== Almacenamiento (Fase 4) =====
  {
    key: "inv_movimientos",
    group: "inventarios",
    title: "Movimientos",
    icon: ArrowRightLeft,
    color: "#0d9488",
    descripcion: "Entradas, salidas, traslados y correcciones de inventario por código.",
    tabs: [
      { module: "Transacciones de Inventario", label: "Transacciones" },
      { module: "Gestión de transacciones", label: "Gestión" },
      { module: "Traslados de producto", label: "Traslados" },
    ],
  },
  {
    key: "inv_saldos",
    group: "inventarios",
    title: "Saldos",
    icon: BarChart3,
    color: "#2563eb",
    descripcion: "Qué hay en bodega: por lote, por producto y ocupación de las localizaciones.",
    tabs: [
      { module: "Saldos de inventario", label: "Por lote" },
      { module: "Saldos por producto", label: "Por producto" },
      { module: "Capacidad Bodega", label: "Capacidad de bodega" },
    ],
  },
  {
    key: "inv_exactitud",
    group: "inventarios",
    title: "Exactitud y cierre",
    icon: ClipboardCheck,
    color: "#d97706",
    descripcion: "Exactitud del inventario, cuadre de cierre mensual y auditoría.",
    tabs: [
      { module: "Panel LIP Inventario", label: "Exactitud" },
      { module: "Cuadre de Inventario", label: "Cuadre mensual" },
      { module: "Auditoría de Inventario", label: "Auditoría" },
    ],
  },
  {
    key: "inv_lotes",
    group: "inventarios",
    title: "Lotes",
    icon: FileCheck,
    color: "#7c3aed",
    descripcion: "Asignar lotes a las órdenes de cargue y consultar el historial.",
    tabs: [
      { module: "Asignación de Lotes", label: "Asignar" },
      { module: "Historial de lotes", label: "Historial" },
    ],
  },
  // ===== Producción (Fase 4) =====
  {
    key: "prod_ingresos",
    group: "produccion",
    title: "Ingresos de producción",
    icon: PackagePlus,
    color: "#059669",
    descripcion: "Registrar lo producido, revisarlo, aprobarlo y ver el historial.",
    tabs: [
      { module: "Ingreso de Producción", label: "Registrar" },
      { module: "Ver ingresos de producción", label: "Ver ingresos" },
      { module: "Aprobación de ingreso de producción", label: "Aprobar" },
      { module: "Historial Aprobaciones", label: "Historial" },
    ],
  },
  {
    key: "prod_tolva",
    group: "produccion",
    title: "Tolva",
    icon: Wallet,
    color: "#d97706",
    descripcion: "Liquidar la tolva del día y consultar sus órdenes.",
    tabs: [
      { module: "Liquidación Tolva del día", label: "Liquidación del día" },
      { module: "Tolva", label: "Orden de tolva" },
      { module: "Ver Tolva", label: "Ver tolva" },
    ],
  },
  {
    key: "prod_piso",
    group: "produccion",
    title: "Control de piso",
    icon: Activity,
    color: "#dc2626",
    descripcion: "Ritmo de producción en vivo y registro de paros.",
    tabs: [
      { module: "Dashboard de Producción", label: "Dashboard" },
      { module: "Reporte de Paros", label: "Paros" },
    ],
  },
  // ===== Gestión Financiera (Fase 4b) — todo bajo ClaveFinancieraGuard =====
  {
    key: "fin_facturacion",
    group: "financiera",
    title: "Facturación",
    icon: Receipt,
    color: "#059669",
    descripcion: "Control de lo facturado por proyecto, ciclo documental y consulta en Siigo.",
    tabs: [
      { module: "Cuadro de Control Facturación", label: "Cuadro de control" },
      { module: "Ciclo de Facturación", label: "Ciclo" },
      { module: "Resumen de Facturación por Proyecto", label: "Resumen por proyecto" },
      { module: "Facturación Proyectos", label: "Facturación proyectos" },
      { module: "Indicador de Facturación por Proyectos", label: "Indicador" },
      { module: "Consulta Facturas SIIGO", label: "Siigo" },
    ],
  },
  {
    key: "fin_produccion",
    group: "financiera",
    title: "Producción y conciliación",
    icon: Scale,
    color: "#d97706",
    descripcion: "Lo que se cobra por producción: conciliación Avimol, prefactura y cargos fijos.",
    tabs: [
      { module: "Conciliación Avimol", label: "Conciliación Avimol" },
      { module: "Prefactura de Producción", label: "Prefactura" },
      { module: "Cargos Fijos", label: "Cargos fijos" },
    ],
  },
  {
    key: "fin_gastos",
    group: "financiera",
    title: "Gastos",
    icon: Wallet,
    color: "#7c3aed",
    descripcion: "Registrar gastos con soporte y verlos consolidados.",
    tabs: [
      { module: "Registrar Gasto", label: "Registrar" },
      { module: "Dashboard Gastos", label: "Dashboard" },
    ],
  },
  // ===== Gestión Humana (Fase 4b) =====
  {
    key: "rrhh_seleccion",
    group: "rrhh",
    title: "Selección y contratación",
    icon: BadgeCheck,
    color: "#2563eb",
    descripcion: "De la solicitud de personal a la firma del contrato: hojas de vida, antecedentes y entrevistas.",
    tabs: [
      { module: "Gestión de Solicitudes", label: "Solicitudes" },
      { module: "Aprobación de Solicitudes de Personal", label: "Aprobación" },
      { module: "Hojas de Vida", label: "Hojas de vida" },
      { module: "Antecedentes", label: "Antecedentes" },
      { module: "Entrevistas", label: "Entrevistas" },
      { module: "Gestión de Contratos", label: "Contratos" },
    ],
  },
  {
    key: "rrhh_colaboradores",
    group: "rrhh",
    title: "Colaboradores",
    icon: UserCog,
    color: "#0d9488",
    descripcion: "Directorio, Head Count y expediente de cada colaborador.",
    tabs: [
      { module: "Gestión de Colaboradores", label: "Directorio" },
      { module: "Head Count", label: "Head Count" },
      { module: "Carpetas de Trabajadores", label: "Expediente" },
    ],
  },
  {
    key: "rrhh_formacion",
    group: "rrhh",
    title: "Formación y desempeño",
    icon: GraduationCap,
    color: "#7c3aed",
    descripcion: "Inducciones, capacitaciones, asistencia y evaluaciones de desempeño.",
    tabs: [
      { module: "Inducciones", label: "Inducciones" },
      { module: "Evidencia de Inducciones", label: "Evidencia" },
      { module: "Gestión de Capacitaciones", label: "Capacitaciones" },
      { module: "Asistencia a Capacitaciones", label: "Asistencia" },
      { module: "Evaluaciones de Desempeño", label: "Evaluaciones" },
    ],
  },
  {
    key: "rrhh_bienestar",
    group: "rrhh",
    title: "Bienestar",
    icon: HeartHandshake,
    color: "#db2777",
    descripcion: "Programa de bienestar y participación del personal.",
    tabs: [
      { module: "Programa de Bienestar", label: "Programa" },
      { module: "Participación y Evidencias", label: "Participación" },
    ],
  },
  {
    key: "rrhh_tiempos",
    group: "rrhh",
    title: "Asistencia y tiempos",
    icon: ClipboardList,
    color: "#2563eb",
    descripcion: "Asistencia del día, visor histórico y horas extra.",
    tabs: [
      { module: "Tabla Asistencia", label: "Tabla del día" },
      { module: "Visor", label: "Visor" },
      { module: "Asignación horas extra", label: "Horas extra" },
    ],
  },
  {
    key: "rrhh_novedades",
    group: "rrhh",
    title: "Novedades y ausentismo",
    icon: NotebookPen,
    color: "#d97706",
    descripcion: "Novedades, ausentismos, recobro de incapacidades y procesos disciplinarios.",
    tabs: [
      { module: "Novedades de personal", label: "Novedades" },
      { module: "Ausentismos", label: "Ausentismos" },
      { module: "Recobro de Incapacidades", label: "Recobro" },
      { module: "Procesos Disciplinarios", label: "Disciplinarios" },
    ],
  },
  // ===== Compensación (Fase 4b) =====
  {
    key: "comp_nomina",
    group: "compensacion",
    title: "Nómina de la quincena",
    icon: Banknote,
    color: "#059669",
    descripcion: "Revisión y pago de la quincena, acumulados, bonos y apoyos en cargue.",
    tabs: [
      { module: "Revisión de nómina", label: "Revisión" },
      { module: "Nominapersonal", label: "Nómina de personal" },
      { module: "Acumulados LIPgo", label: "Acumulados" },
      { module: "Bonos", label: "Bonos" },
      { module: "Asignación de apoyo en cargue", label: "Apoyo en cargue" },
    ],
  },
  {
    key: "comp_prestaciones",
    group: "compensacion",
    title: "Prestaciones y seguridad social",
    icon: Landmark,
    color: "#2563eb",
    descripcion: "Liquidaciones de retiro, parafiscales y vacaciones.",
    tabs: [
      { module: "Liquidaciones", label: "Liquidaciones" },
      { module: "Parafiscales", label: "Parafiscales" },
      { module: "Vacaciones", label: "Vacaciones" },
    ],
  },
  // ===== Certificaciones · SIG (Fase 4b) =====
  {
    key: "sig_tablero",
    group: "certificaciones_lip",
    title: "Tablero SIG",
    icon: BarChart3,
    color: "#2563eb",
    descripcion: "Cómo va el sistema integrado: dashboard, cuadro de mando y evaluación por área.",
    tabs: [
      { module: "Dashboard SIG", label: "Dashboard" },
      { module: "Indicadores SIG", label: "Cuadro de mando" },
      { module: "Evaluación por Área", label: "Por área" },
    ],
  },
  {
    key: "sig_requisitos",
    group: "certificaciones_lip",
    title: "Requisitos y mejora",
    icon: ClipboardCheck,
    color: "#0d9488",
    descripcion: "Matriz integrada de las tres normas, contexto, objetivos y no conformidades.",
    tabs: [
      { module: "Matriz Integrada SIG", label: "Matriz integrada" },
      { module: "Análisis de Contexto DOFA", label: "DOFA" },
      { module: "Objetivos y Metas SIG", label: "Objetivos" },
      { module: "No Conformidades SIG", label: "No conformidades" },
    ],
  },
  {
    key: "sig_documentos",
    group: "certificaciones_lip",
    title: "Documentos",
    icon: FolderArchive,
    color: "#d97706",
    descripcion: "Repositorio documental por norma y repositorio universal.",
    tabs: [
      { module: "Repositorio por Norma SIG", label: "Por norma" },
      { module: "Repositorio Universal", label: "Universal" },
    ],
  },
  {
    key: "sig_procesos",
    group: "certificaciones_lip",
    title: "Procesos",
    icon: LayoutGrid,
    color: "#7c3aed",
    descripcion: "Mapa de procesos y cómo interactúan en LIPgo.",
    tabs: [
      { module: "Mapa de Procesos", label: "Mapa de procesos" },
      { module: "Mapa de Interacción del Proceso", label: "Interacción" },
    ],
  },
  {
    key: "sig_iso9001",
    group: "certificaciones_lip",
    title: "Calidad ISO 9001",
    icon: BadgeCheck,
    color: "#059669",
    descripcion: "Evidencia por cláusula y repositorio de la norma de calidad.",
    tabs: [
      { module: "Centro de Evidencia ISO 9001", label: "Evidencia" },
      { module: "Repositorio ISO 9001", label: "Repositorio" },
    ],
  },
  {
    key: "sig_iso14001",
    group: "certificaciones_lip",
    title: "Ambiental ISO 14001",
    icon: Leaf,
    color: "#65a30d",
    descripcion: "Aspectos e impactos ambientales y matriz legal ambiental.",
    tabs: [
      { module: "Aspectos e Impactos ISO 14001", label: "Aspectos e impactos" },
      { module: "Matriz Legal Ambiental", label: "Matriz legal" },
    ],
  },
  // ===== SST (Fase 4b) =====
  {
    key: "sst_0312",
    group: "sst",
    title: "Autoevaluación 0312",
    icon: ShieldCheck,
    color: "#dc2626",
    descripcion: "Autoevaluación de estándares mínimos, plan de mejora, soportes e indicadores.",
    tabs: [
      { module: "Auditoría 0312", label: "Auditoría" },
      { module: "Matriz de Estándares", label: "Estándares" },
      { module: "Plan de Mejoramiento", label: "Plan de mejora" },
      { module: "Repositorio de Soportes", label: "Soportes" },
      { module: "Indicadores SST", label: "Indicadores" },
    ],
  },
  {
    key: "sst_riesgos",
    group: "sst",
    title: "Riesgos y cambio",
    icon: Gauge,
    color: "#d97706",
    descripcion: "Identificación de peligros (GTC 45) y gestión del cambio.",
    tabs: [
      { module: "IPEVR", label: "IPEVR" },
      { module: "Gestión del Cambio", label: "Gestión del cambio" },
    ],
  },
  {
    key: "sst_equipos",
    group: "sst",
    title: "Equipos y montacargas",
    icon: Forklift,
    color: "#2563eb",
    descripcion: "Maestro de montacargas, mantenimiento y chequeo preoperacional.",
    tabs: [
      { module: "Gestión de Montacargas", label: "Montacargas" },
      { module: "Equipos y Mantenimiento", label: "Mantenimiento" },
      { module: "Registro Preoperacional", label: "Preoperacional" },
    ],
  },
  {
    key: "sst_epp",
    group: "sst",
    title: "EPP",
    icon: ShieldCheck,
    color: "#0d9488",
    descripcion: "Entrega y dotación de elementos de protección personal.",
    tabs: [
      { module: "Entrega de EPP", label: "Entrega" },
      { module: "Gestión de Dotación EPP", label: "Dotación" },
    ],
  },
  {
    key: "sst_salud",
    group: "sst",
    title: "Accidentes y salud",
    icon: Stethoscope,
    color: "#db2777",
    descripcion: "Alertas e investigación de accidentes, exámenes médicos, MEDEVAC y perfil sociodemográfico.",
    tabs: [
      { module: "Alertas de AT", label: "Alertas" },
      { module: "Investigación AT", label: "Investigación" },
      { module: "Investigaciones Realizadas", label: "Realizadas" },
      { module: "Examenes Médicos", label: "Exámenes médicos" },
      { module: "MEDEVAC", label: "MEDEVAC" },
      { module: "Perfil Sociodemográfico", label: "Sociodemográfico" },
    ],
  },
  {
    key: "sst_comunicacion",
    group: "sst",
    title: "Comunicación y comités",
    icon: NotebookPen,
    color: "#7c3aed",
    descripcion: "Autorreportes, PQRSF de SST, actividades y comités.",
    tabs: [
      { module: "Comunicación SST", label: "Comunicación" },
      { module: "Actividades y Comités", label: "Actividades y comités" },
    ],
  },
  // ===== Configuración (Fase 4b) =====
  {
    key: "conf_clientes",
    group: "configuracion",
    title: "Clientes y ventas",
    icon: Store,
    color: "#2563eb",
    descripcion: "Clientes, sucursales, condiciones de pago y vendedores.",
    tabs: [
      { module: "Clientes", label: "Clientes" },
      { module: "Sucursales", label: "Sucursales" },
      { module: "Condiciones Pago", label: "Condiciones de pago" },
      { module: "Vendedores", label: "Vendedores" },
    ],
  },
  {
    key: "conf_productos",
    group: "configuracion",
    title: "Productos",
    icon: Package,
    color: "#0d9488",
    descripcion: "Maestro de productos con sus categorías y subcategorías.",
    tabs: [
      { module: "Productos", label: "Productos" },
      { module: "Categorías", label: "Categorías" },
      { module: "Sub Categorías", label: "Subcategorías" },
    ],
  },
  {
    key: "conf_bodegas",
    group: "configuracion",
    title: "Bodegas y muelles",
    icon: Warehouse,
    color: "#d97706",
    descripcion: "Bodegas, localizaciones y muelles de cargue por planta.",
    tabs: [
      { module: "Bodegas", label: "Bodegas" },
      { module: "Localizaciones", label: "Localizaciones" },
      { module: "Muelles de Cargue", label: "Muelles" },
    ],
  },
  {
    key: "conf_transporte",
    group: "configuracion",
    title: "Transporte",
    icon: Truck,
    color: "#7c3aed",
    descripcion: "Transportadoras, tipos de vehículo y de despacho, placas de distribución.",
    tabs: [
      { module: "Transportadoras", label: "Transportadoras" },
      { module: "Tipos de Vehiculos", label: "Tipos de vehículo" },
      { module: "Tipos Despacho", label: "Tipos de despacho" },
      { module: "Placas de Distribución", label: "Placas" },
    ],
  },
  {
    key: "conf_seguridad",
    group: "configuracion",
    title: "Seguridad y accesos",
    icon: Lock,
    color: "#dc2626",
    descripcion: "Usuarios, accesos por proyecto y autorizaciones por clave. Exclusivo de LIPgo.",
    tabs: [
      { module: "Gestión de Usuarios", label: "Usuarios" },
      { module: "Accesos de Usuario", label: "Accesos" },
      { module: "Autorizaciones por clave", label: "Autorizaciones" },
    ],
  },
  // ===== MRP (Fase 4b) =====
  {
    key: "mrp_materiales",
    group: "mrp",
    title: "Materiales",
    icon: Package,
    color: "#b45309",
    descripcion: "Maestro de materiales, explosión de materiales y proveedores.",
    tabs: [
      { module: "Creación de materiales", label: "Materiales" },
      { module: "Explosión de materiales", label: "Explosión" },
      { module: "Gestión de proveedores", label: "Proveedores" },
    ],
  },
]

/** Etiqueta corta del área para barra lateral, miga de pan y buscador. */
export const ETIQUETA_GRUPO: Record<GroupKey, string> = {
  integral: "Torre de Control",
  pedidos: "Pedidos y solicitudes",
  despachos: "Recepción y Despacho",
  inventarios: "Almacenamiento",
  mrp: "MRP · Materiales",
  produccion: "Producción",
  lip: "Operación LIP",
  financiera: "Gestión Financiera",
  rrhh: "Gestión Humana",
  compensacion: "Compensación",
  certificaciones_lip: "Certificaciones · SIG",
  sst: "Seguridad y Salud (SST)",
  configuracion: "Configuración",
  aprendizaje: "Aprendizaje",
}

export function etiquetaDeGrupo(key: GroupKey | null | undefined): string {
  if (!key) return "Inicio"
  return ETIQUETA_GRUPO[key] ?? groups.find((g) => g.key === key)?.title ?? key
}

// ---------------------------------------------------------------------------
// Alias: nombres antiguos/huérfanos que aún pueden llegar por evento, LIPbot o
// URL. Se resuelven SOLO en los puntos de entrada (navigateToModule, URL,
// buscador); las ramas de main-content con el nombre viejo se conservan.
// ---------------------------------------------------------------------------
export const ALIAS_MODULO: Record<string, string> = {
  "Ver Picking": "Ver Picking/Packing",
  "Ver Solicitudes de traslado": "Recepción de Traslado",
}

export function resolverAlias(name: string): string {
  return ALIAS_MODULO[name] ?? name
}

// ---------------------------------------------------------------------------
// Índices derivados
// ---------------------------------------------------------------------------
export const HUB_POR_KEY: Map<string, Hub> = new Map(HUBS.map((h) => [h.key, h]))

/** `${group}|${module}` → hub. Un módulo puede estar en dos grupos (Satisfacción y PQRSF). */
const HUB_POR_GRUPO_MODULO: Map<string, Hub> = new Map()
for (const h of HUBS) for (const t of h.tabs) HUB_POR_GRUPO_MODULO.set(`${h.group}|${t.module}`, h)

export function esHubKey(s: string | null | undefined): boolean {
  return !!s && HUB_POR_KEY.has(s)
}

/** Hub que contiene al módulo dentro del grupo dado (o null si es un módulo suelto). */
export function hubDe(groupKey: GroupKey | null | undefined, moduleName: string | null | undefined): Hub | null {
  if (!groupKey || !moduleName) return null
  return HUB_POR_GRUPO_MODULO.get(`${groupKey}|${moduleName}`) ?? null
}

/** Primera pestaña del hub visible para el usuario, o null si ninguna. */
export function primeraTabVisible(hub: Hub, visible: (name: string) => boolean): string | null {
  return hub.tabs.find((t) => visible(t.module))?.module ?? null
}

/** Grupo que contiene al módulo (mismo recorrido que app/page.tsx y module-kpi-header). */
export function grupoDeModulo(moduleName: string): GroupKey | null {
  for (const g of groups) {
    if (g.modules?.some((m) => m.name === moduleName)) return g.key
    if (g.subgroups?.some((sg) => sg.modules.some((m) => m.name === moduleName))) return g.key
  }
  return null
}

/** Módulo hoja por nombre (busca en todos los grupos). */
export function moduloPorNombre(moduleName: string): Module | null {
  for (const g of groups) {
    const d = g.modules?.find((m) => m.name === moduleName)
    if (d) return d
    for (const sg of g.subgroups ?? []) {
      const s = sg.modules.find((m) => m.name === moduleName)
      if (s) return s
    }
  }
  return null
}

/** Texto que se pinta para un módulo (label si existe; si no, name). */
export function etiquetaDeModulo(moduleName: string): string {
  const m = moduloPorNombre(moduleName)
  return m?.label ?? m?.name ?? moduleName
}

/** Texto de la pestaña dentro de su hub (label de la pestaña > label del módulo > name). */
export function etiquetaDeTab(hub: Hub, moduleName: string): string {
  const t = hub.tabs.find((x) => x.module === moduleName)
  return t?.label ?? etiquetaDeModulo(moduleName)
}

/**
 * Convierte una lista de módulos YA filtrada por permisos (salida de
 * filterGroupsByPermissions o de visibleGroups del sidebar) en entradas de menú:
 * los módulos sueltos pasan tal cual; el primer módulo de un hub emite el hub con
 * SOLO sus pestañas presentes (en el orden declarado en el hub) y los demás
 * módulos de ese hub se omiten. Regla resultante: el hub se ve si al menos una
 * pestaña es visible; las pestañas sin permiso no aparecen.
 */
export function plegarEnHubs(groupKey: GroupKey, modules: Module[]): EntradaMenu[] {
  const presentes = new Map(modules.map((m) => [m.name, m]))
  const emitidos = new Set<string>()
  const out: EntradaMenu[] = []
  for (const m of modules) {
    const hub = HUB_POR_GRUPO_MODULO.get(`${groupKey}|${m.name}`)
    if (!hub) {
      out.push({ tipo: "modulo", modulo: m })
      continue
    }
    if (emitidos.has(hub.key)) continue
    emitidos.add(hub.key)
    const tabs = hub.tabs.map((t) => presentes.get(t.module)).filter((x): x is Module => !!x)
    out.push({ tipo: "hub", hub, tabs })
  }
  return out
}

/** Color de dominio por grupo (una sola paleta para Inicio, portal, barra y buscador). */
export const TINT_GRUPO: Record<string, string> = {
  integral: "#5b6b7f",
  pedidos: "#4f63c4",
  despachos: "#1f8fb0",
  inventarios: "#0e9c9c",
  mrp: "#b5852a",
  produccion: "#c56a2a",
  lip: "#7b57c9",
  financiera: "#2f9b64",
  rrhh: "#c65893",
  compensacion: "#c9a227",
  certificaciones_lip: "#c8492f",
  sst: "#d84a3e",
  configuracion: "#6b7683",
  aprendizaje: "#3b7dd8",
}

// ---------------------------------------------------------------------------
// Color por ENTRADA (pantalla/módulo), distinto entre vecinas de la misma área
// (gerencia 2026-09-30: "deben tener color diferente para que sepan que son
// diferentes"). Se asigna sobre la lista COMPLETA del área (sin filtrar por
// permisos) para que sea estable entre usuarios y pantallas; los hubs pueden
// fijar el suyo con `color`.
// ---------------------------------------------------------------------------
export const PALETA_ENTRADAS = [
  "#2563eb", "#0d9488", "#d97706", "#7c3aed", "#dc2626", "#059669", "#db2777",
  "#0891b2", "#ea580c", "#4f46e5", "#65a30d", "#9333ea", "#b45309", "#0284c7",
]

const COLOR_POR_ENTRADA: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const g of groups) {
    const listas = [...(g.modules ? [g.modules] : []), ...(g.subgroups ?? []).map((s) => s.modules)]
    const entradas = listas.flatMap((lista) => plegarEnHubs(g.key, lista))
    // 1) Los hubs con color fijo lo reservan primero, para que ningún módulo
    //    de la misma área reciba ese mismo color de la paleta.
    const usados = new Set<string>()
    for (const e of entradas) if (e.tipo === "hub" && e.hub.color) usados.add(e.hub.color)
    // 2) El resto toma, en orden, el primer color de la paleta aún libre en el
    //    área; si el área tiene más entradas que colores, se reinicia.
    let cursor = 0
    const siguienteLibre = () => {
      for (let k = 0; k < PALETA_ENTRADAS.length; k++) {
        const c = PALETA_ENTRADAS[(cursor + k) % PALETA_ENTRADAS.length]
        if (!usados.has(c)) {
          cursor = (cursor + k + 1) % PALETA_ENTRADAS.length
          usados.add(c)
          if (usados.size >= PALETA_ENTRADAS.length) usados.clear()
          return c
        }
      }
      usados.clear()
      return PALETA_ENTRADAS[cursor++ % PALETA_ENTRADAS.length]
    }
    for (const e of entradas) {
      if (e.tipo === "hub") m.set(`${g.key}|hub:${e.hub.key}`, e.hub.color ?? siguienteLibre())
      else m.set(`${g.key}|mod:${e.modulo.name}`, siguienteLibre())
    }
  }
  return m
})()

/** Color de un hub o módulo dentro de su área (cae al color del área si no está). */
export function colorDeEntrada(groupKey: GroupKey, entrada: { hubKey?: string; modulo?: string }): string {
  const k = entrada.hubKey ? `${groupKey}|hub:${entrada.hubKey}` : `${groupKey}|mod:${entrada.modulo ?? ""}`
  return COLOR_POR_ENTRADA.get(k) ?? TINT_GRUPO[groupKey] ?? "#0e9c9c"
}

/**
 * Validación en desarrollo: cada pestaña debe existir en `groups[hub.group]`
 * dentro de un solo subgrupo (o la lista directa), un módulo no puede estar en
 * dos hubs del mismo grupo y las claves de hub deben ser únicas. Devuelve la
 * lista de problemas (vacía = todo bien).
 */
export function validarHubs(): string[] {
  const problemas: string[] = []
  const claves = new Set<string>()
  for (const h of HUBS) {
    if (claves.has(h.key)) problemas.push(`Hub duplicado: ${h.key}`)
    claves.add(h.key)
    const g = groups.find((x) => x.key === h.group)
    if (!g) {
      problemas.push(`Hub ${h.key}: grupo inexistente ${h.group}`)
      continue
    }
    const contenedores = new Set<string>()
    for (const t of h.tabs) {
      let hallado = false
      if (g.modules?.some((m) => m.name === t.module)) {
        hallado = true
        contenedores.add("(directo)")
      }
      for (const sg of g.subgroups ?? []) {
        if (sg.modules.some((m) => m.name === t.module)) {
          hallado = true
          contenedores.add(sg.title)
        }
      }
      if (!hallado) problemas.push(`Hub ${h.key}: la pestaña "${t.module}" no existe en el grupo ${h.group}`)
    }
    if (contenedores.size > 1) problemas.push(`Hub ${h.key}: pestañas en varios subgrupos (${[...contenedores].join(", ")})`)
  }
  const vistos = new Set<string>()
  for (const h of HUBS)
    for (const t of h.tabs) {
      const k = `${h.group}|${t.module}`
      if (vistos.has(k)) problemas.push(`"${t.module}" está en dos hubs del grupo ${h.group}`)
      vistos.add(k)
    }
  return problemas
}

if (process.env.NODE_ENV !== "production") {
  const p = validarHubs()
  if (p.length) console.error("[navegacion] hubs inválidos:\n  " + p.join("\n  "))
}
