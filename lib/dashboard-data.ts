import { FileSearch, Gift, Truck, Forklift, Scale, ClipboardCheck, Package, FileText, CheckCircle, Box, PackagePlus, BarChart3, Package2, ArrowRightLeft, History, Search, LayoutDashboard, Activity, FileCheck, Receipt, Clock, Users, Eye, Settings, Type as type, LucideIcon, CreditCard, UserCheck, Store, Tag, Layers, MapPin, Warehouse, Gauge, QrCode, Sparkles, BadgeCheck, BookOpen, Lock, ClipboardList, CalendarDays, NotebookPen, GraduationCap, Wallet, Banknote, Calculator, CalendarClock, FolderOpen, FolderArchive, UserCog, HeartHandshake, ShieldCheck, Stethoscope, AlertTriangle, Star, Send, Landmark, UserPlus, LayoutGrid, FileSpreadsheet, FileEdit, KeyRound, Trophy } from "lucide-react"

export interface Module {
  name: string
  icon: LucideIcon
  // Texto visible opcional en el sidebar. `name` sigue siendo la clave de
  // ruteo y permisos; si `label` existe, se pinta en lugar de `name`.
  label?: string
}

export interface Subgroup {
  title: string
  modules: Module[]
}

export interface Group {
  key: GroupKey
  title: string
  icon: LucideIcon
  modules?: Module[]
  subgroups?: Subgroup[]
}

export type GroupKey =
  // Guia de usuario. Es el UNICO grupo cuyo modulo no esta protegido por
  // permisos a proposito: "Aprendizaje" debe verlo todo el mundo. Lo que se
  // filtra por permisos es su CONTENIDO, no el acceso al modulo. Por eso
  // tambien esta exento del filtro de grupo en `components/sidebar.tsx`
  // (GRUPOS_SIN_FILTRO_PROTEGIDO).
  | "aprendizaje"
  | "pedidos"
  | "inventarios"
  | "produccion"
  | "integral"
  | "lip"
  | "rrhh"
  | "compensacion"
  | "certificaciones_lip"
  | "sst"
  | "configuracion"
  | "despachos"
  | "financiera"

/**
 * Modulo "Aprendizaje" (guia de usuario): EN CONSTRUCCION, oculto del menu.
 *
 * El catalogo (lib/aprendizaje-content.ts), el componente
 * (components/aprendizaje.tsx) y el chequeo de cobertura
 * (scripts/check-aprendizaje.mjs) ya existen y funcionan, pero el modulo no se
 * muestra todavia. Poner en `true` para publicarlo: el sidebar lo toma solo de
 * aqui (el item del menu superior se filtra contra los grupos visibles), asi
 * que esta constante es el unico interruptor.
 */
const APRENDIZAJE_HABILITADO = true

export const groups: Group[] = [
  {
    // REORG (2026-07-03): "Recepción y Despacho" fusiona los antiguos grupos
    // "Gestión de Vehículos", "Despachos/Recepción" y "Báscula" en un solo
    // grupo por flujo de puerta (inbound/outbound). Los módulos conservan su
    // `name` → sus permisos NO cambian; solo cambia dónde se muestran.
    key: "despachos",
    title: "Recepción y Despacho",
    icon: Truck,
    modules: [],
    subgroups: [
      {
        title: "Órdenes y Recepción",
        modules: [
          { name: "Generar Órdenes de Cargue", icon: Truck },
          { name: "Generar Órdenes de Descargue", icon: Truck },
          { name: "Generar Orden de Distribución", icon: Truck },
          { name: "Gestión de Ordenes", icon: Receipt },
          { name: "Recepción de Traslado", icon: Eye },
          // Dashboard de indicadores de despachos y recepción. Su visibilidad
          // queda gobernada por el permiso `dashboardrecepcion` (mapeado en
          // `lib/permissions-map.ts`).
          { name: "Dashboard Despachos/Recepción", icon: LayoutDashboard },
        ],
      },
      {
        title: "Vehículos y Portería",
        modules: [
          { name: "Registrar Vehículos", icon: Clock },
          { name: "Ver Vehículos", icon: Eye },
          { name: "Registro sanitario", icon: ClipboardCheck },
          { name: "Ver historial de Inspección", icon: History },
        ],
      },
      {
        title: "Báscula",
        modules: [
          { name: "Báscula", icon: Scale },
          { name: "Historial Báscula", icon: History },
        ],
      },
    ],
  },
  {
    // REORG navegación (2026-09-30): "Pedidos y solicitudes" = lo que el CLIENTE
    // le pide a LIP (pedidos y servicios adicionales). "Gestión integral de
    // pedidos" salió del menú porque ya no se usa (gerencia); su permiso
    // (`gestion_integral_pedidos`) y su rama en main-content se conservan hasta
    // la limpieza final aprobada.
    key: "pedidos",
    title: "Pedidos y solicitudes",
    icon: Package,
    modules: [
      // — Hub "Pedidos" —
      { name: "Entrada de pedidos", icon: PackagePlus },
      { name: "Gestionar pedidos", icon: FileText },
      // Modulo nuevo: vista de indicadores de pedidos. Su visibilidad
      // queda gobernada por el permiso `dashboardpedidos` (mapeado en
      // `lib/permissions-map.ts`).
      { name: "Dashboard Pedidos", icon: LayoutDashboard },
      // Programación de vehículos que el cliente entrega para mañana (cantidad ·
      // tipo · destino) y su cumplimiento. Permiso `programacion_cliente` (SQL 211).
      // La misma pantalla, en modo LIP, vive en Torre de Control como "Proyecciones".
      { name: "Programación del cliente", icon: CalendarClock, label: "Programación de mañana" },
    ],
  },
  {
    key: "inventarios",
    title: "Almacenamiento",
    icon: Box,
    modules: [],
    subgroups: [
      {
        title: "Gestión inventario",
        // REORG navegación (2026-09-30): el orden define los hubs de
        // lib/navegacion.ts (Movimientos · Saldos · Exactitud y cierre). Los
        // `name` y permisos no cambian.
        modules: [
          // — Hub "Movimientos" —
          { name: "Transacciones de Inventario", icon: ArrowRightLeft },
          { name: "Gestión de transacciones", icon: FileText },
          { name: "Traslados de producto", icon: ArrowRightLeft },
          // — Hub "Saldos" —
          { name: "Saldos de inventario", icon: BarChart3 },
          { name: "Saldos por producto", icon: Package2 },
          { name: "Capacidad Bodega", icon: Gauge },
          // — Hub "Exactitud y cierre" —
          { name: "Panel LIP Inventario", icon: BarChart3, label: "Panel de Inventario (Exactitud y movimientos)" },
          { name: "Cuadre de Inventario", icon: ClipboardCheck, label: "Cuadre y Correcciones (Cierre mensual)" },
          // REORG (2026-07-03): "Auditoría de Inventario" se movió aquí desde su
          // antiguo grupo propio "Auditoría". Conserva su `name`/permiso.
          { name: "Auditoría de Inventario", icon: Search },
          // — Pantalla sola —
          // Registro diario de disponibilidad de montacargas y conteo
          // del personal de operación. CRUD sobre `montacargasdia`,
          // protegido por el permiso `montacargasdia`.
          { name: "Montacargas y personal día", icon: Truck },
        ],
      },
      {
        title: "Asignación de Lotes",
        modules: [
          { name: "Asignación de Lotes", icon: FileCheck },
          { name: "Historial de lotes", icon: History },
        ],
      },
    ],
  },
  {
    key: "produccion",
    title: "Producción",
    icon: Package2,
    // REORG navegación (2026-09-30): el orden define los hubs de
    // lib/navegacion.ts (Ingresos de producción · Tolva · Control de piso).
    // "Servicios Adicionales" se queda aquí (subgrupo Planta): la solicitud nace
    // en producción. Los `name` y permisos no cambian.
    // 2026-10-01: el área "MRP" (una sola tarjeta) se plegó aquí como subgrupo
    // "Materiales · MRP"; la clave de grupo `mrp` ya no existe. Los permisos
    // de esos módulos siguen bajo Producción en Gestión de Usuarios.
    subgroups: [
      {
        title: "Planta",
        modules: [
          // — Hub "Ingresos de producción" —
          { name: "Ingreso de Producción", icon: PackagePlus },
          { name: "Ver ingresos de producción", icon: Eye },
          { name: "Aprobación de ingreso de producción", icon: CheckCircle },
          { name: "Historial Aprobaciones", icon: History },
          // — Hub "Tolva" —
          // Toma las toneladas APROBADAS del día por Turno 1/Turno 2 (ventana
          // horaria programada en RRHH > Programación de turnos, Auxiliar Mixto)
          // y genera la orden de Tolva/Tolva f en cabeceraoc con un click.
          { name: "Liquidación Tolva del día", icon: Wallet },
          { name: "Tolva", icon: Package },
          { name: "Ver Tolva", icon: Eye },
          // — Hub "Control de piso" —
          { name: "Dashboard de Producción", icon: Activity },
          { name: "Reporte de Paros", icon: AlertTriangle },
          // — Pantallas solas —
          { name: "Reprocesos", icon: ArrowRightLeft },
          // Servicios Adicionales (turnos u horas extra que el proyecto solicita):
          // la solicitud NACE EN PRODUCCIÓN, por eso vive aquí (gerencia 2026-10-02;
          // el 30-sep se había movido a Pedidos y se revirtió). La aprobación
          // sigue en Operación LIP › Personal del día › Aprobar Turnos. Conserva
          // nombre y permiso (`solicitudturnos`).
          { name: "Servicios Adicionales", icon: Clock },
        ],
      },
      {
        title: "Materiales · MRP",
        // "Ingresos MP", "Saldos de empaque" y "Saldos de materia prima" NO
        // tienen implementación (caían en ModulePlaceholder) y están fuera del
        // menú hasta que existan; sus permisos (ingresos_mp, saldos_empaque,
        // saldos_materia_prima) se conservan.
        modules: [
          // — Hub "Materiales · MRP" —
          { name: "Creación de materiales", icon: Package },
          { name: "Explosión de materiales", icon: Layers },
          { name: "Gestión de proveedores", icon: Users },
        ],
      },
    ],
  },
  {
    key: "integral",
    title: "Torre de Control",
    icon: LayoutDashboard,
    modules: [
      // Etiqueta "vista clásica" (2026-09-30) para no confundirlo con la pantalla
      // "Operación del día" de Operación LIP. Nombre y permiso intactos.
      { name: "Dashboard Operacion", icon: Activity, label: "Dashboard Operación · vista clásica" },
      { name: "Asistente IA", icon: Sparkles },
      // 2026-10-01: ya no es la proyección de nómina del último día de la quincena
      // (se paga el día base). Conserva `name` y permiso `proyecciones`, pero
      // muestra la Programación del cliente (vehículos de mañana) y su
      // cumplimiento, en modo LIP. El cliente la registra desde Pedidos y solicitudes.
      { name: "Proyecciones", icon: CalendarClock, label: "Programación del cliente · cumplimiento" },
    ],
  },
  {
    key: "lip",
    title: "Operación LIP",
    icon: Users,
    modules: [],
    subgroups: [
      {
        title: "Operación Lip",
        modules: [
          // Panel ejecutivo del coordinador: personal, cobertura de turnos,
          // pendientes del dia, solicitudes de personal y pago de la quincena,
          // todo de la empresa seleccionada. No calcula nada por su cuenta:
          // reune las cifras de los modulos que ya las producen.
          // REORG navegación (2026-09-30): el ORDEN de esta lista define el orden
          // de las pantallas en la barra lateral; los hubs (pantallas con
          // pestañas) se definen en lib/navegacion.ts y aparecen en la posición
          // de su primera pestaña. Los `name` y permisos NO cambian.
          //
          // — Hub "Operación del día" —
          // Panel ejecutivo del coordinador: personal, cobertura de turnos,
          // pendientes del dia, solicitudes de personal y pago de la quincena,
          // todo de la empresa seleccionada. No calcula nada por su cuenta:
          // reune las cifras de los modulos que ya las producen.
          { name: "Operación del día", icon: LayoutDashboard },
          // El coordinador LIP consigna la programación de vehículos que el cliente
          // envía para mañana (el cliente también puede, desde Pedidos y solicitudes).
          // Permiso `programacion_cliente_lip` (SQL 212). Misma pantalla que
          // "Programación del cliente" y que "Proyecciones" (Torre de Control).
          { name: "Consignar programación del cliente", icon: CalendarClock, label: "Programación de mañana" },
          { name: "Panel LIP Operación", icon: BarChart3, label: "Tablero del Coordinador" },
          { name: "Dashboard Operaciones LIP", icon: LayoutDashboard },
          // Modulo "Bitácora": registro diario de novedades/observaciones
          // de la operacion. CRUD sobre la tabla `bitacora` filtrado por
          // empresa y protegido por el permiso `bitacora`.
          { name: "Bitácora", icon: NotebookPen },
          // — Hub "Centro de Coordinación" —
          // Une en una sola pantalla lo que hoy está disperso en Picking,
          // Packing y el control de muelles/SLA: el coordinador ve los
          // muelles en vivo (Cargue/Descargue/Distribución), asigna
          // personal, inicia y cierra órdenes desde ahí mismo.
          { name: "Centro de Coordinación", icon: LayoutGrid },
          { name: "Picking", icon: PackagePlus },
          { name: "Packing", icon: Package },
          { name: "Ver Picking/Packing", icon: Eye },
          // Calificación del conductor EN CALIENTE al fin de cargue (kiosko 🟢🟡🔴).
          { name: "Calificación del Conductor", icon: Star, label: "Calificación del Conductor (en caliente)" },
          // — Hub "Personal del día" —
          // Movido desde "Compensación" por solicitud del negocio.
          // Conserva su permiso original.
          { name: "Programación de turnos", icon: CalendarClock, label: "Programación de Turnos" },
          // Movido desde "Compensación" por solicitud del negocio.
          // Conserva su permiso original.
          { name: "Registro de asistencia", icon: UserCheck, label: "Registro de Asistencia" },
          { name: "Aprobar Turnos", icon: CheckCircle },
          // Movido desde "Reclutamiento y Selección" por solicitud del
          // negocio: la solicitud de personal se gestiona dentro de la
          // operacion LIP. Conserva su permiso original.
          { name: "Solicitud de Personal", icon: UserCheck },
          // Envio de alertas y programacion de turnos por WhatsApp al
          // celular del personal (desde colaboradores_th / registroasistencia).
          { name: "Notificaciones al Personal", icon: Send, label: "Notificaciones al Personal (WhatsApp)" },
          // — Hub "Toneladas y productividad" —
          // Toneladas por día y acumuladas por trabajador (mismo cálculo que
          // paga nómina): para que el coordinador gestione personal — quién
          // mueve menos, quién es más eficiente, qué vehículos atendió.
          { name: "Control de Toneladas", icon: Scale },
          // Informe de GERENCIA: quién carga de verdad en cada ID
          // (cabeceraoc.auxiliares_real, lo que asignó el coordinador), por día
          // y por mes, ranking y real vs. pagado en pago Global. Solo lectura.
          { name: "Productividad de Auxiliares", icon: Trophy },
          // — Hub "Estibas QR" —
          { name: "Registro de QR estibas", icon: QrCode },
          { name: "Lectura de QR estibas", icon: QrCode },
          { name: "Inventario por Estiba", icon: QrCode },
          // — Pantallas solas —
          // "Solicitar Facturas" reubicado aquí desde Gestión Financiera: es
          // función operativa propia del coordinador/líder de LIP. Conserva su
          // nombre y permiso (gestionfacturas).
          { name: "Solicitar Facturas", icon: Receipt },
          // El coordinador es responsable de las partes interesadas (conductores
          // y cliente): gestiona aquí satisfacción y PQRSF. Mismo módulo del SIG,
          // permiso propio (satisfaccion_pqrsf).
          { name: "Satisfacción y PQRSF", icon: ClipboardList, label: "Satisfacción y PQRSF (conductores y cliente)" },
          // "Proyecciones" se movio al grupo RRHH Lip por solicitud del
          // negocio: el modulo proyecta cargas/ingresos asociados al
          // personal y conceptualmente vive mas cerca de RRHH que de
          // operacion logistica.
        ],
      },
      // REORG (2026-07-03): el subgrupo "Administración LIP" (Registrar Gasto,
      // Dashboard Gastos) se movió a "Gestión Financiera". Conservan sus
      // permisos (gastos).
    ],
  },
  {
    // Módulo de Gestión Financiera. "Facturación" se elevó desde Gestión LIP a
    // su propio módulo. Los submódulos CONSERVAN sus permisos ya otorgados en
    // Gestión de Usuarios (facturacion_proyectos, tarifas, gestionfacturas).
    key: "financiera",
    title: "Gestión Financiera",
    icon: Wallet,
    modules: [],
    subgroups: [
      {
        title: "Facturación",
        // REORG navegación (2026-09-30): el orden define los hubs de
        // lib/navegacion.ts (Facturación · Producción y conciliación). Nombres y
        // permisos intactos; todo sigue bajo ClaveFinancieraGuard.
        modules: [
          // — Hub "Facturación" —
          // Cruce órdenes procesadas vs facturado por owner + prefactura. Permiso propio.
          { name: "Cuadro de Control Facturación", icon: ClipboardCheck },
          // Flujo documental de una prefactura ya aprobada: anexo enviado ->
          // firmado por el cliente -> factura enviada -> firmada -> cierre,
          // más cartera/cobro (días vencidos) desde el cierre. Permiso propio.
          { name: "Ciclo de Facturación", icon: Landmark },
          // Consulta por proyecto: esperado (acuerdo) vs a quién se factura de
          // verdad. Solo lectura. Mismo permiso que Cuadro de Control.
          { name: "Resumen de Facturación por Proyecto", icon: ClipboardList },
          { name: "Facturación Proyectos", icon: CreditCard },
          { name: "Indicador de Facturación por Proyectos", icon: BarChart3 },
          // Consulta de solo lectura contra la API de Siigo: facturas, su
          // detalle y el PDF. Permiso propio: da acceso a TODA la facturacion
          // de la empresa, no solo a la que genera LIPgo.
          { name: "Consulta Facturas SIIGO", icon: FileSearch },
          // — Hub "Producción y conciliación" —
          // Avimol: se cobra por producción (tolva × tarifa/ton) pero se paga por
          // turnos (Estibado PT / Salvado). Cruce día a día. Permiso propio.
          { name: "Conciliación Avimol", icon: Scale },
          // Prefactura de lo que se cobra por PRODUCCIÓN, con selector de proyecto:
          // Avimol (Salvado / Estibado PT + horas extra) e Indupan (Tolva / Tolva f).
          // La de Avimol también vive como pestaña dentro de Conciliación Avimol.
          { name: "Prefactura de Producción", icon: FileText },
          // Alquiler de montacargas facturado (id1/id3) + $2M Manejo de
          // Inventario (id1/id3) + 600 ton fijas Avimol. Permiso propio.
          { name: "Cargos Fijos", icon: CalendarClock },
          // — Pantallas solas —
          { name: "Tarifas", icon: CreditCard },
          // Edición directa de cabeceraoc/detalleoc de una orden ya creada
          // (antes Facturación lo hacía a mano en Supabase). Permiso propio.
          { name: "Corrección de Órdenes", icon: FileEdit },
          // "Solicitar Facturas" se MOVIÓ a Gestión LIP → Operación Lip (función
          // operativa del coordinador). Conserva su permiso (gestionfacturas).
        ],
      },
      {
        // Estado de Resultados (P&L) trasladado desde Gestión LIP. Conserva su
        // permiso `estadoresultados`.
        title: "Resultados",
        modules: [
          { name: "Estado de Resultados", icon: BarChart3 },
        ],
      },
      {
        // REORG (2026-07-03): "Gastos" trasladado desde "Gestión LIP ·
        // Administración LIP". Conservan su permiso `gastos`.
        title: "Gastos",
        modules: [
          { name: "Registrar Gasto", icon: Receipt },
          { name: "Dashboard Gastos", icon: BarChart3 },
        ],
      },
    ],
  },
  {
    key: "rrhh",
    title: "Gestión Humana",
    icon: Users,
    // REORG (2026-07-06): navegación ordenada por el CICLO DE VIDA del colaborador.
    // REORG navegación (2026-09-30, gerencia): TRES bloques al estilo de las suites
    // de talento humano (Recruiting · Core HR · Payroll): "Selección y
    // contratación", "Gestión del talento" y "Tiempos y novedades". Lo de
    // compensación vive en Compensación: "Turnos" (tarifas por puesto, maestro de
    // pago) se fue allá; "Proyecciones" (no es nómina) se fue a Torre de Control.
    // Todos los módulos CONSERVAN su name/permiso.
    subgroups: [
      {
        title: "Selección y contratación",
        modules: [
          // — Hub "Selección y contratación" —
          { name: "Gestión de Solicitudes", icon: ClipboardList },
          { name: "Aprobación de Solicitudes de Personal", icon: BadgeCheck },
          { name: "Hojas de Vida", icon: BookOpen },
          { name: "Antecedentes", icon: ShieldCheck },
          { name: "Entrevistas", icon: FileCheck },
          { name: "Gestión de Contratos", icon: FileText },
        ],
      },
      {
        title: "Gestión del talento",
        modules: [
          // — Hub "Colaboradores" —
          { name: "Gestión de Colaboradores", icon: UserCog, label: "Directorio de Colaboradores" },
          { name: "Head Count", icon: Users },
          { name: "Carpetas de Trabajadores", icon: FolderOpen, label: "Expediente del Colaborador" },
          // — Hub "Formación y desempeño" —
          { name: "Inducciones", icon: GraduationCap },
          { name: "Evidencia de Inducciones", icon: BookOpen },
          { name: "Gestión de Capacitaciones", icon: GraduationCap },
          { name: "Asistencia a Capacitaciones", icon: ClipboardList },
          { name: "Evaluaciones de Desempeño", icon: BadgeCheck },
          // — Hub "Bienestar" —
          { name: "Programa de Bienestar", icon: HeartHandshake },
          { name: "Participación y Evidencias", icon: ClipboardList },
          // — Pantalla sola —
          { name: "Panel LIP Gestión Humana", icon: BarChart3, label: "Panel LIP · Gestión Humana (SIG)" },
        ],
      },
      {
        title: "Tiempos y novedades",
        modules: [
          // — Hub "Asistencia y tiempos" — (registrar horas es gestión de tiempos;
          // pagarlas es Compensación)
          { name: "Tabla Asistencia", icon: ClipboardList, label: "Tabla de Asistencia" },
          { name: "Visor", icon: Eye, label: "Visor de Asistencia" },
          { name: "Asignación horas extra", icon: Clock, label: "Asignación de Horas Extra" },
          // Vacaciones se movió al grupo "Compensación" (REORG 2026-07-29).
          // — Hub "Novedades y ausentismo" —
          { name: "Novedades de personal", icon: NotebookPen, label: "Novedades de Personal" },
          // Asistencia Administrativa se movió al grupo "Compensación" (REORG
          // 2026-09-09, pedido explícito): ahí es donde vive todo lo que
          // liquida/paga al colaborador, y este módulo alimenta directo esa
          // liquidación (registra la asistencia que consume pagonomina).
          // Matriz SST-MAT-06 de ausentismo laboral (EG / AT). Comparte el
          // permiso de "Novedades de personal".
          { name: "Ausentismos", icon: Activity },
          // Seguimiento del costo recuperable de incapacidades (EPS/ARL).
          // Comparte el permiso de "Ausentismos".
          { name: "Recobro de Incapacidades", icon: CreditCard },
          // La usuaria reporta la conducta y solicita la medida; el empleador
          // cita a descargos y decide. Permiso propio: el caso contiene el
          // relato de una conducta y el nombre de testigos.
          { name: "Procesos Disciplinarios", icon: Scale },
        ],
      },
    ],
  },
  {
    // REORG (2026-07-29): "Compensación" agrupa TODO lo que liquida/paga al
    // colaborador (antes disperso dentro de Gestión Humana): nómina de destajo/
    // turno, liquidaciones de retirados, parafiscales/seguridad social, el cuadro
    // de revisión/cruce con Siigo, y vacaciones (causa/liquida valor día). Todos
    // los módulos CONSERVAN su `name` y por tanto su permiso — mover el objeto de
    // grupo no afecta lo ya otorgado en Gestión de Usuarios.
    key: "compensacion",
    title: "Compensación",
    icon: Wallet,
    // REORG navegación (2026-09-30, gerencia: "todo lo de compensación en
    // Compensación"): dos bloques, Nómina y Prestaciones y parámetros. "Turnos"
    // (tarifas por puesto) viene de Gestión Humana: es un maestro de PAGO y por
    // eso queda como módulo financiero (solo LIP). Nombres y permisos intactos.
    subgroups: [
      {
        title: "Nómina",
        modules: [
          // — Hub "Nómina de la quincena" —
          // Cuadro definitivo por colaborador: liquidación diaria + resumen + archivo plano (Siigo).
          { name: "Revisión de nómina", icon: ClipboardCheck, label: "Revisión de nómina" },
          { name: "Nominapersonal", icon: Banknote, label: "Nómina de Personal" },
          // Reporte de Acumulados que LIPgo CONSTRUYE (mismo formato que el export
          // de Siigo), fuente de verdad hacia adelante -- ver lib/acumulados-lipgo-actions.ts.
          { name: "Acumulados LIPgo", icon: FileSpreadsheet, label: "Acumulados LIPgo" },
          // Bonos operativos/administrativos por día y persona (no prestacionales).
          // Al aprobarse entran a pagonomina y salen en el archivo plano (43/50/66).
          { name: "Bonos", icon: Gift },
          // Agrega personal extra (aparte de Picking/Packing) a una orden de
          // Cargue/Descargue para que también entre en el reparto de toneladas.
          { name: "Asignación de apoyo en cargue", icon: UserPlus },
          // — Pantalla sola —
          // Movido desde "Gestión Humana" (REORG 2026-09-09, pedido explícito):
          // registra/corrige asistencia y novedades para CUALQUIER fecha (pasada
          // o futura) -- tapa huecos de captura operativa y lleva la asistencia
          // diaria del personal administrativo. Alimenta directo a pagonomina,
          // por eso pertenece aquí. Permiso propio (no comparte con "Novedades
          // de personal"): puede tocar meses ya cerrados de nómina.
          { name: "Asistencia Administrativa", icon: ClipboardList },
        ],
      },
      {
        title: "Prestaciones y parámetros",
        modules: [
          // — Hub "Prestaciones y seguridad social" —
          { name: "Liquidaciones", icon: Receipt, label: "Liquidaciones" },
          // Aportes de seguridad social y parafiscales del mes (guía de la planilla PILA).
          { name: "Parafiscales", icon: Landmark, label: "Parafiscales y Seguridad Social" },
          // Causación desde fecha de ingreso, disfrute (novedad del control diario), saldo y liquidación.
          { name: "Vacaciones", icon: CalendarClock },
          // — Pantalla sola —
          // Viene de Gestión Humana (2026-09-30): tarifa base, recargos y vigencia
          // por puesto = maestro de pago. Conserva su nombre y permiso.
          { name: "Turnos", icon: Clock, label: "Turnos y tarifas por puesto" },
        ],
      },
    ],
  },
  {
    // Modulo de certificaciones LIP. Agrupa el sistema SST 0312 y el centro
    // de evidencia ISO 9001 (movido desde Auditoria) como submodulos.
    key: "certificaciones_lip",
    title: "Certificaciones · SIG (Calidad · Ambiente · SST)",
    icon: BadgeCheck,
    // Submódulos agrupados POR NORMA para que se vea claro a cuál pertenece
    // cada uno: SIG transversal, luego una sección por norma certificable.
    subgroups: [
      {
        // Transversal: aplica a las 3 normas a la vez.
        // REORG navegación (2026-09-30): el orden define los hubs de
        // lib/navegacion.ts (Tablero SIG · Requisitos y mejora · Documentos ·
        // Procesos). Nombres y permisos intactos.
        title: "Sistema Integrado (SIG) · Transversal",
        modules: [
          // — Hub "Tablero SIG" —
          { name: "Dashboard SIG", icon: BarChart3, label: "Dashboard SIG (Auditoría)" },
          { name: "Indicadores SIG", icon: Gauge, label: "BSC · Cuadro de Mando Integral" },
          { name: "Evaluación por Área", icon: Gauge, label: "Evaluación de Desempeño por Área" },
          // — Hub "Requisitos y mejora" —
          { name: "Matriz Integrada SIG", icon: ClipboardCheck, label: "Matriz Integrada (ISO 9001·14001·45001)" },
          { name: "Análisis de Contexto DOFA", icon: ClipboardCheck, label: "Análisis de Contexto (DOFA)" },
          { name: "Objetivos y Metas SIG", icon: ClipboardList, label: "Objetivos y Metas (6.2)" },
          { name: "No Conformidades SIG", icon: ClipboardList, label: "No Conformidades (10.2)" },
          // — Hub "Documentos" —
          { name: "Repositorio por Norma SIG", icon: FolderArchive, label: "Repositorio Documental por Norma" },
          { name: "Repositorio Universal", icon: FolderArchive, label: "Repositorio Universal de Documentos" },
          // — Hub "Procesos" —
          { name: "Mapa de Procesos", icon: ClipboardCheck, label: "Mapa de Procesos (SIG)" },
          { name: "Mapa de Interacción del Proceso", icon: ClipboardCheck, label: "Mapa de Interacción del Proceso (LIPgo)" },
          // — Pantalla sola —
          { name: "Satisfacción y PQRSF", icon: ClipboardList, label: "Satisfacción y PQRSF (9.1.2)" },
        ],
      },
      {
        title: "ISO 9001:2015 · Calidad",
        modules: [
          { name: "Centro de Evidencia ISO 9001", icon: BadgeCheck, label: "Centro de Evidencia" },
          { name: "Repositorio ISO 9001", icon: FolderArchive, label: "Repositorio Documental" },
          { name: "Auditoría ISO 9001", icon: ClipboardCheck, label: "Auditoría" },
        ],
      },
      {
        title: "ISO 14001:2015 · Ambiental",
        modules: [
          { name: "Aspectos e Impactos ISO 14001", icon: Gauge, label: "Aspectos e Impactos Ambientales" },
          { name: "Matriz Legal Ambiental", icon: ClipboardCheck, label: "Matriz Legal Ambiental" },
        ],
      },
    ],
  },
  {
    // REORG: SST deja de ser un subgrupo dentro de Certificaciones y pasa a ser
    // su PROPIO módulo (grupo), para que sea un área calificable por sí misma y
    // conectada al BSC por área. Los submódulos CONSERVAN su `name` y permiso
    // (sst_auditoria, sst_autoevaluacion, sst_epp, sst_incidentes, sst_medevac…),
    // así que los accesos ya otorgados no cambian. Certificaciones conserva el
    // SIG transversal + ISO 9001 + ISO 14001.
    key: "sst",
    title: "Seguridad y Salud en el Trabajo (SST)",
    icon: ShieldCheck,
    // REORG navegación (2026-09-30): el orden define los hubs de
    // lib/navegacion.ts. "Gestión del Cambio" pasa al bloque de riesgos (es
    // gestión del cambio de peligros). Nombres y permisos intactos.
    subgroups: [
      {
        title: "Autoevaluación y Mejora (Dec. 0312)",
        modules: [
          // — Hub "Autoevaluación 0312" —
          { name: "Auditoría 0312", icon: ShieldCheck, label: "Auditoría 0312" },
          { name: "Matriz de Estándares", icon: ClipboardCheck, label: "Matriz 60 Estándares" },
          { name: "Plan de Mejoramiento", icon: ClipboardList, label: "Plan de Mejoramiento" },
          { name: "Repositorio de Soportes", icon: FolderArchive, label: "Repositorio de Soportes (Matriz)" },
          { name: "Indicadores SST", icon: BarChart3, label: "Indicadores SG-SST" },
        ],
      },
      {
        title: "Peligros, Riesgos y Operación Segura",
        modules: [
          // — Hub "Riesgos y cambio" —
          { name: "IPEVR", icon: Gauge, label: "IPEVR (GTC 45)" },
          { name: "Gestión del Cambio", icon: ArrowRightLeft, label: "Gestión del Cambio" },
          // — Hub "Equipos y montacargas" —
          // Va junto al preoperacional (que alimenta su hoja de vida) y a
          // Equipos y Mantenimiento, con el que comparte sst_equipos y
          // sst_mantenimientos. Ver scripts/104_create_gestion_montacargas.sql.
          { name: "Gestión de Montacargas", icon: Forklift, label: "Gestión de Montacargas" },
          { name: "Equipos y Mantenimiento", icon: Settings, label: "Equipos y Mantenimiento" },
          { name: "Registro Preoperacional", icon: ClipboardCheck },
          // — Hub "EPP" —
          { name: "Entrega de EPP", icon: ShieldCheck, label: "Entrega de EPP" },
          { name: "Gestión de Dotación EPP", icon: Package, label: "Dotación de EPP" },
        ],
      },
      {
        title: "Accidentalidad y Salud en el Trabajo",
        modules: [
          // — Hub "Accidentes y salud" —
          { name: "Alertas de AT", icon: AlertTriangle, label: "Alertas de AT (Ausentismo)" },
          { name: "Investigación AT", icon: Activity, label: "Investigación de AT (SST-FOR-21)" },
          { name: "Investigaciones Realizadas", icon: FolderArchive, label: "Repositorio de Investigaciones" },
          { name: "Examenes Médicos", icon: Stethoscope },
          { name: "MEDEVAC", icon: Stethoscope, label: "MEDEVAC (Plan de Emergencias Médicas)" },
          { name: "Perfil Sociodemográfico", icon: Users, label: "Perfil Sociodemográfico (SST-FOR-32)" },
        ],
      },
      {
        title: "Comunicación, Cambio y Cultura",
        modules: [
          // — Hub "Comunicación y comités" —
          { name: "Comunicación SST", icon: NotebookPen, label: "Comunicación / Autorreporte / PQRSF" },
          { name: "Actividades y Comités", icon: GraduationCap, label: "Actividades y Comités" },
        ],
      },
    ],
  },
  {
    key: "configuracion",
    title: "Configuración",
    icon: Settings,
    subgroups: [
      // La configuracion de WhatsApp se movio a "Notificaciones al Personal",
      // como pestaña "Conexion y pruebas": es el mismo canal que ese modulo usa
      // para enviar, y tenerlo en dos sitios hacia que nadie supiera cual era la
      // fuente de verdad. El permiso `whatsapp` se conserva por si mas adelante
      // se quiere separar de nuevo.
      // REORG navegación (2026-09-30): un hub por bloque (lib/navegacion.ts).
      // Nombres y permisos intactos; Usuarios/Accesos/Autorizaciones siguen
      // siendo exclusivos de LIPgo.
      {
        title: "Clientes y ventas",
        modules: [
          { name: "Clientes", icon: Users },
          { name: "Sucursales", icon: Store },
          { name: "Condiciones Pago", icon: CreditCard },
          { name: "Vendedores", icon: UserCheck },
        ],
      },
      {
        title: "Productos",
        modules: [
          { name: "Productos", icon: Package },
          { name: "Categorías", icon: Tag },
          { name: "Sub Categorías", icon: Layers },
        ],
      },
      {
        title: "Bodegas y muelles",
        modules: [
          { name: "Bodegas", icon: Warehouse },
          { name: "Localizaciones", icon: MapPin },
          { name: "Muelles de Cargue", icon: Warehouse },
        ],
      },
      {
        title: "Transporte",
        modules: [
          { name: "Transportadoras", icon: Truck },
          { name: "Tipos de Vehiculos", icon: Truck },
          { name: "Tipos Despacho", icon: Truck },
          { name: "Placas de Distribución", icon: Truck },
        ],
      },
      {
        title: "Seguridad y accesos",
        modules: [
          { name: "Gestión de Usuarios", icon: Users },
          { name: "Accesos de Usuario", icon: Lock },
          { name: "Autorizaciones por clave", icon: KeyRound },
        ],
      },
      {
        title: "Auditoría",
        modules: [{ name: "Bitácora de Auditoría", icon: History }],
      },
    ],
  },
  // Guia de usuario. Universal a proposito: "Aprendizaje" NO se registra en
  // MODULE_PERMISSION_MAP, asi que cuando se habilite el sidebar lo mostrara a
  // todos. El modulo filtra internamente su contenido contra /api/user-modules
  // para que cada usuario solo lea la guia de los modulos que si puede abrir.
  // Mientras `APRENDIZAJE_HABILITADO` sea false, el grupo no entra al menu.
  ...(APRENDIZAJE_HABILITADO
    ? [
        {
          key: "aprendizaje" as GroupKey,
          title: "Aprendizaje",
          icon: GraduationCap,
          modules: [{ name: "Aprendizaje", icon: BookOpen }],
        },
      ]
    : []),
]

// Grupos que NUNCA se ocultan por el filtro de "al menos un módulo protegido
// permitido" (ver filterGroupsByPermissions abajo) — contienen solo módulos
// no protegidos que deben verse para todos. DUPLICADO A PROPÓSITO de
// `GRUPOS_SIN_FILTRO_PROTEGIDO` en components/sidebar.tsx: ese archivo ya
// funciona bien y no se tocó para no arriesgarlo: si se agrega un grupo acá,
// agregarlo también allá.
const GRUPOS_SIN_FILTRO_PROTEGIDO: GroupKey[] = ["certificaciones_lip", "aprendizaje"]

/**
 * Filtra `groups` contra los permisos del usuario actual — MISMO criterio que
 * usa `components/sidebar.tsx` para el menú lateral (isModuleVisible +
 * visibleGroups ahí): un módulo se ve si no está protegido, o si está
 * protegido y el usuario lo tiene permitido; un grupo se descarta si se
 * queda sin módulos visibles, o si (salvo exención) no le queda NINGÚN
 * módulo protegido permitido. Usado por Inicio (module-cards) y la vista de
 * grupo (modules-view) para que dejen de mostrar módulos sin permiso.
 */
export function filterGroupsByPermissions(
  isModuleVisible: (name: string) => boolean,
  permissionsLoaded: boolean,
  allowedModules: Set<string>,
): Group[] {
  return groups
    .map((group) => {
      const filteredSubgroups: Subgroup[] | undefined = group.subgroups
        ?.map((sg) => ({ ...sg, modules: sg.modules.filter((m) => isModuleVisible(m.name)) }))
        .filter((sg) => sg.modules.length > 0)
      const filteredModules: Module[] | undefined = group.modules?.filter((m) => isModuleVisible(m.name))

      const hasVisibleSubgroups = (filteredSubgroups?.length ?? 0) > 0
      const hasVisibleModules = (filteredModules?.length ?? 0) > 0
      if (!hasVisibleSubgroups && !hasVisibleModules) return null

      if (permissionsLoaded && !GRUPOS_SIN_FILTRO_PROTEGIDO.includes(group.key)) {
        const allModulesInGroup = [
          ...(filteredModules ?? []),
          ...((filteredSubgroups ?? []).flatMap((sg) => sg.modules)),
        ]
        const hasAtLeastOneAllowedProtected = allModulesInGroup.some((m) => allowedModules.has(m.name))
        if (!hasAtLeastOneAllowedProtected) return null
      }

      return { ...group, subgroups: filteredSubgroups, modules: filteredModules }
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)
}
