"use client"

import React from "react"
import { useAuth } from "@/components/auth-provider"
import { getAtencionDelDia } from "@/lib/atencion-actions"
import { LipAiAssistant, type AtencionItem } from "@/components/lip-ai-assistant"
import { AtencionBanner } from "@/components/atencion-banner"
import { TopBar } from "@/components/top-bar"
import { DailySummary } from "@/components/daily-summary"
import { ModuleCards } from "@/components/module-cards"
import { ModulesView } from "@/components/modules-view"
import { OrderEntryForm } from "@/components/order-entry-form"
import { ModulePlaceholder } from "@/components/module-placeholder"
import { GenericCrudTable } from "@/components/configuration/generic-crud-table"
import { configModules } from "@/lib/config-definitions"
import { OrdersManagement } from "@/components/orders/orders-management"
import { ComprehensiveOrdersManagement } from "@/components/orders/comprehensive-orders-management"
import { DashboardPedidos } from "@/components/orders/dashboard-pedidos"
import { DashboardRecepcion } from "@/components/dashboard-recepcion"
import { OrderEditPage } from "@/components/orders/order-edit-page"
import { ProductosWithCategories } from "@/components/configuration/productos-with-categories"
import { VehicleAppointmentsForm } from "@/components/vehicle-appointments-form"
import { BasculaForm } from "@/components/bascula-form"
import { BasculaHistory } from "@/components/bascula-history"
import { GenerateLoadOrders } from "@/components/generate-load-orders"
import { GenerateUnloadOrders } from "@/components/generate-unload-orders"
import { GenerateDistributionOrders } from "@/components/generate-distribution-orders"
import { InventoryTransactionsModule } from "@/components/inventory-transactions-module"
import { ProductionEntryForm } from "@/components/production-entry-form"
import { InventoryBalanceDetails } from "@/components/inventory-balance-details"
import { InventoryBalanceGlobal } from "@/components/inventory-balance-global"
import { ReprocesosManagement } from "@/components/reprocesos-management"
import { LoadOrdersManagement } from "@/components/load-orders-management"
import { ProductionApproval } from "@/components/production-approval"
import LiquidacionTolva from "@/components/produccion/liquidacion-tolva"
import ControlPiso from "@/components/produccion/control-piso"
import ReporteParos from "@/components/produccion/reporte-paros"
// Producción: maestro de montacargas, QR y bitácora de mantenimiento.
import GestionMontacargas from "@/components/montacargas/gestion-montacargas"
import { InventoryTransactionsManagement } from "@/components/inventory-transactions-management"
import { SanitaryRegistryForm } from "@/components/sanitary-registry-form"
import { ProductTransferForm } from "@/components/product-transfer-form"
import { TransferRequestsView } from "@/components/transfer-requests-view"
import { BatchApproval } from "@/components/batch-approval"
import { Picking } from "@/components/picking"
import { Packing } from "@/components/packing"
import DashboardOperacion from "@/components/dashboard-operacion"
import { BatchHistory } from "@/components/batch-history"
import { Aprendizaje } from "@/components/aprendizaje" // Guia de usuario (modulo universal, sin permiso)
import { ModuloGuiaBar } from "@/components/modulo-guia-bar" // Guia embebida en la pantalla de cada modulo
import { ProductionEntriesView } from "@/components/production-entries-view"
import InventoryAudit from "@/components/inventory-audit"
import { SanitaryInspectionHistory } from "@/components/sanitary-inspection-history"
import { ApprovalHistory } from "@/components/approval-history"
import { WarehouseCapacityComponent } from "@/components/warehouse-capacity"
import QRPalletRegistration from "@/components/qr-pallet-registration"
import QRPalletReading from "@/components/qr-pallet-reading"
import { PalletInventoryView } from "@/components/pallet-inventory-view"
import MaterialExplosion from "@/components/material-explosion"
import MontacargasDia from "@/components/inventario/montacargas-dia" // CRUD diario de disponibilidad de montacargas y conteo de personal
import Bitacora from "@/components/lip/bitacora" // CRUD de bitacora del dia (Operacion Lip)
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { UserPermissionsManagement } from "@/components/configuration/user-permissions-management"
import BitacoraAuditoria from "@/components/configuration/bitacora-auditoria"
import PlacasDistribucion from "@/components/configuration/placas-distribucion"
import MuellesEmpresaConfig from "@/components/configuration/muelles-empresa"
import { PermissionGuard } from "@/components/permission-guard"
import { UserAccessModule } from "@/components/user-access-module"
import HeadcountManagement from "@/components/headcount-management" // Added Head Count component import
import { Tolva } from "@/components/tolva"
import VerTolva from "@/components/ver-tolva"
import { Proyecciones } from "@/components/proyecciones"
import AttendanceRegistration from "@/components/attendance-registration" // Added import for attendance registration
import AttendanceTable from "@/components/attendance-table" // Added import for attendance table
import { ExtraHoursAssignment } from "@/components/extra-hours-assignment" // Added import for extra hours assignment module
import { ApoyoCargue } from "@/components/apoyo-cargue" // Added import for apoyo en cargue module
// Reconstruido: reportar la novedad y ver su efecto en la quincena en una sola
// pantalla, con el impacto en pesos tomado de la vista que liquida.
import NovedadesTiempoReal from "@/components/rrhh/novedades-tiempo-real" // Added import for personnel notices module
import AsistenciaAdministrativa from "@/components/rrhh/asistencia-administrativa"
import GestionTurnos from "@/components/rrhh/gestion-turnos" // CRUD de turnos (tabla tarifasturnos)
// Envoltorio con dos pestañas: la programación diaria de siempre (la que
// escribe los turnos) y la vista de quincena (cobertura, equipos, grilla).
import ProgramacionPersonal from "@/components/rrhh/programacion-personal"
import NotificacionesPersonal from "@/components/rrhh/notificaciones-personal" // Envío de alertas/turnos por WhatsApp al celular del personal
import { ViewPicking } from "@/components/view-picking" // Added import for ViewPicking component
import { Tarifas } from "@/components/configuration/tarifas" // Added import for Tarifas component
import { FacturacionProyectos } from "@/components/facturacion-proyectos" // Added import for Facturacion Proyectos component
import { CuadroControlFacturacion } from "@/components/cuadro-control-facturacion"
import ResumenFacturacionProyecto from "@/components/resumen-facturacion-proyecto"
import { ClaveFinancieraGuard } from "@/components/clave-financiera-guard"
// Gestión Financiera: alquiler de montacargas facturado + cargos fijos ($2M, 600 ton).
import CargosFijos from "@/components/cargos-fijos"
import CorreccionOrdenes from "@/components/correccion-ordenes"
import ConciliacionAvimol from "@/components/conciliacion-avimol"
import PrefacturaProduccion from "@/components/prefactura-produccion"
import CicloFacturacion from "@/components/ciclo-facturacion"
import { DashboardOperacionesLip } from "@/components/dashboard-operaciones-lip" // Dashboard Operaciones LIP
import { RegistroPreoperacional } from "@/components/registro-preoperacional" // Registro Preoperacional
import GestionContratos from "@/components/rrhh/gestion-contratos"
import DotacionEPP from "@/components/rrhh/dotacion-epp"
import Capacitaciones from "@/components/rrhh/capacitaciones"
import CapacitacionesAsistencia from "@/components/rrhh/capacitaciones-asistencia"
// Reconstruido: requisicion con causal legal del Art. 77 Ley 50/1990 y costo
// mensual estimado con los porcentajes reales de prestaciones y parafiscales.
import RequisicionPersonal from "@/components/rrhh/requisicion-personal"
import ProcesosDisciplinarios from "@/components/rrhh/procesos-disciplinarios"
import EvaluacionesDashboard from "@/components/rrhh/evaluaciones-dashboard"
import InduccionesEvidenciaDashboard from "@/components/rrhh/inducciones-evidencia-dashboard"
import InduccionesManagement from "@/components/rrhh/inducciones-management"
import IsoEvidenceDashboard from "@/components/iso9001/iso-evidence-dashboard"
import GestionSolicitudes from "@/components/rrhh/gestion-solicitudes"
import GestionSolicitudesPersonal from "@/components/rrhh/gestion-solicitudes-personal"
import HojasDeVida from "@/components/rrhh/hojas-de-vida"
import Antecedentes from "@/components/rrhh/antecedentes"
import ExamenesMedicos from "@/components/rrhh/examenes-medicos"
import Ausentismos from "@/components/rrhh/ausentismos"
import RecobroIncapacidades from "@/components/rrhh/recobro-incapacidades"
import Vacaciones from "@/components/rrhh/vacaciones"
import { Auditoria0312 } from "@/components/sst/auditoria-0312"
import { Matriz60Estandares } from "@/components/sst/matriz-60-estandares"
import { RepositorioSoportes } from "@/components/sst/repositorio-soportes"
import { RepositorioISO9001 } from "@/components/iso9001/repositorio-iso9001"
import { InvestigacionAT } from "@/components/sst/investigacion-at"
import { AlertasAT } from "@/components/sst/alertas-at"
import { InvestigacionesRepositorio } from "@/components/sst/investigaciones-repositorio"
import { MatrizIpevr } from "@/components/sst/ipevr"
import { Medevac } from "@/components/sst/medevac"
import { PerfilSociodemografico } from "@/components/sst/perfil-sociodemografico"
import { PlanMejoramiento } from "@/components/sst/plan-mejoramiento"
import { IndicadoresSST } from "@/components/sst/indicadores"
import { EntregaEpp } from "@/components/sst/entrega-epp"
import { EquiposMantenimiento } from "@/components/sst/equipos-mantenimiento"
import { ComunicacionSST } from "@/components/sst/comunicacion"
import { GestionCambio } from "@/components/sst/gestion-cambio"
import { ActividadesSST } from "@/components/sst/actividades"
import { MatrizIntegradaSIG } from "@/components/sst/matriz-integrada-sig"
import { RepositorioSIG } from "@/components/sst/repositorio-sig"
import RepositorioUniversal from "@/components/sst/repositorio-universal"
import { ModuleKpiHeader } from "@/components/module-kpi-header"
import { DashboardSIG } from "@/components/sst/dashboard-sig"
import { AspectosAmbientales } from "@/components/sst/aspectos-ambientales"
import { ObjetivosSIG } from "@/components/sst/objetivos-sig"
import { NoConformidadesSIG } from "@/components/sst/no-conformidades-sig"
import { IndicadoresSIG } from "@/components/sst/indicadores-sig"
import { EvaluacionAreas } from "@/components/sst/evaluacion-areas"
import { PanelOperacionLIP } from "@/components/sst/panel-operacion-lip"
import ControlToneladas from "@/components/control-toneladas"
import CentroCoordinacion from "@/components/centro-coordinacion"
import { OperacionDelDia } from "@/components/operacion/operacion-del-dia"
import { MapaInteraccionProceso } from "@/components/sst/mapa-interaccion-proceso"
import { MapaProcesos } from "@/components/sig/mapa-procesos"
import { PanelInventarioLIP } from "@/components/sst/panel-inventario-lip"
import { CuadreInventario } from "@/components/sst/cuadre-inventario"
import { PanelGestionHumanaLIP } from "@/components/sst/panel-gestion-humana-lip"
import { SatisfaccionPQRSF } from "@/components/sst/satisfaccion-pqrsf"
import { CalificacionConductor } from "@/components/sst/calificacion-conductor"
import { FacturacionProyectosIndicador } from "@/components/sst/facturacion-proyectos-indicador"
import { MatrizLegalAmbiental } from "@/components/sst/matriz-legal-ambiental"
import { ContextoDofa } from "@/components/sst/contexto-dofa"
import GestionColaboradores from "@/components/rrhh/gestion-colaboradores"
import { CarpetasTrabajadores } from "@/components/rrhh/carpetas-trabajadores"
import Entrevistas from "@/components/rrhh/entrevistas"
import BienestarPrograma from "@/components/rrhh/bienestar-programa"
import BienestarParticipacion from "@/components/rrhh/bienestar-participacion"
import Nominapersonal from "@/components/nominapersonal" // Added import for Nominapersonal component
import Liquidaciones from "@/components/liquidaciones"
import AcumuladosLIPgo from "@/components/acumulados-lipgo"
import Parafiscales from "@/components/parafiscales"
import RevisionNomina from "@/components/revision-nomina"
import Bonos from "@/components/bonos"
import { SolicitudTurnos } from "@/components/solicitud-turnos" // Added import for Solicitud de Turnos
import { AprobarTurnos } from "@/components/aprobar-turnos" // Added import for Aprobar Turnos
import { AttendanceViewer } from "@/components/attendance-viewer" // Added import for AttendanceViewer component
import GestionFacturas from "@/components/gestion-facturas" // Added import for Gestion de Facturas
import AsistenteIA from "@/components/asistente-ia" // Added import for AI Assistant
import FormularioRegistroGasto from "@/components/gastos/formulario-registro-gasto"
import DashboardGastos from "@/components/gastos/dashboard-gastos"
import EstadoResultados from "@/components/estado-resultados/estado-resultados"
import { GroupKey } from "@/lib/dashboard-data"

interface MainContentProps {
  selectedGroup: GroupKey | null
  selectedModule: string | null
  onBack: () => void
  onSelectGroup: (group: GroupKey) => void
  onSelectModule: (moduleName: string) => void
  /** Navegación robusta (fija grupo + módulo). La usa el asistente IA. */
  onNavigateModule: (moduleName: string) => void
  /** Abrir un módulo principal (grupo/barra izquierda). La usa el asistente IA. */
  onOpenGroup: (key: string) => void
  sidebarCollapsed: boolean
}

export function MainContent({
  selectedGroup,
  selectedModule,
  onBack,
  onSelectGroup,
  onSelectModule,
  onNavigateModule,
  onOpenGroup,
  sidebarCollapsed,
}: MainContentProps) {
  const [editingOrderId, setEditingOrderId] = React.useState<number | null>(null)
  const [basculaOrderId, setBasculaOrderId] = React.useState<number | null>(null) // Added state to store initial order ID for Báscula module
  const [sanitaryRegistryVehicleId, setSanitaryRegistryVehicleId] = React.useState<number | null>(null) // Added state to store initial vehicle ID for Sanitary Registry module
  // Identificación a preseleccionar al saltar desde "Ausentismo acumulado" (Visor de Asistencia) hasta Ausentismos.
  const [ausentismosInitialSearch, setAusentismosInitialSearch] = React.useState<string | null>(null)
  // Salto directo desde Ciclo de Facturación/Cuadro de Control ("N órdenes
  // sin gestionar") hasta Gestión de Facturas, ya filtrado en el proyecto y
  // período correctos -- para que el aviso sirva para ACTUAR, no solo para
  // informar (usuario 2026-09-14: "que no sea solo lectura que sirva para
  // gestionar").
  const [gestionFacturasFiltroInicial, setGestionFacturasFiltroInicial] = React.useState<{
    estado?: string
    fechaDesde?: string
    fechaHasta?: string
  } | null>(null)

  // Saludo del hero: personalizado por hora del día + nombre + empresa. Se
  // calcula en useEffect para no romper la hidratación (hora del server ≠ cliente).
  const { profile, selectedEmpresaId, selectedEmpresaNombre, setSelectedEmpresaId } = useAuth()
  const [nowInfo, setNowInfo] = React.useState<{ saludo: string; fecha: string }>({ saludo: "Hola", fecha: "" })
  const [homeAlertas, setHomeAlertas] = React.useState<AtencionItem[]>([])
  React.useEffect(() => {
    if (!selectedEmpresaId) return
    let cancel = false
    getAtencionDelDia(profile?.id, selectedEmpresaId ?? undefined)
      .then((r) => {
        if (!cancel && r.success) setHomeAlertas(r.items as AtencionItem[])
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [selectedEmpresaId, profile?.id])
  React.useEffect(() => {
    const d = new Date()
    const h = d.getHours()
    const saludo = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"
    const f = d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })
    setNowInfo({ saludo, fecha: f.charAt(0).toUpperCase() + f.slice(1) })
  }, [])
  const primerNombre = (profile?.nombre || "").trim().split(" ")[0]

  // Helper to match module names to config keys more reliably
  const getConfigModule = (moduleName: string | null) => {
    if (!moduleName) return null

    const map: Record<string, string> = {
      Bodegas: "almacenes",
      Categorías: "categorias",
      "Sub Categorías": "subcategorias",
      Clientes: "clientes",
      "Condiciones Pago": "condicionespago",
      Destinos: "destinos",
      Grupos: "grupos",
      Medios: "medios",
      Productos: "productos",
      Sucursales: "sucursales",
      "Tipos Despacho": "tipodespacho",
      Transportadoras: "transportes",
      "Tipos de Vehiculos": "tiposvehiculos",
      Vendedores: "vendedores",
      Localizaciones: "localizaciones",
      "Ver Citas": "citas_vehiculos",
      "Citas de vehículos": "citas_vehiculos",
      "Ingreso de Producción": "production_entry",
      "Aprobación de ingreso de producción": "production_approval",
      "Gestión de transacciones": "inventory_transactions",
      "Registro sanitario": "sanitary_registry",
      "Registrar Vehículos": "registrar_vehiculos",
      "Ver Vehículos": "ver_vehiculos",
      "Asignación de Lotes": "batch_approval",
      Picking: "picking",
      Packing: "packing",
      "Dashboard Operacion": "dashboard_operacion",
      "Historial de lotes": "batch_history",
      "Auditoría de Inventario": "inventory_audit",
      "Ver historial de Inspección": "sanitary_inspection_history",
      "Historial Aprobaciones": "approval_history",
      "Capacidad Bodega": "warehouse_capacity",
      "Registro de QR estibas": "qr_pallet_registration",
      "Lectura de QR estibas": "qr_pallet_reading",
      "Gestión de proveedores": "proveedores",
      "Creación de materiales": "materiales",
      "Explosión de materiales": "material_explosion",
      "Inventario por Estiba": "pallet_inventory_view",
      "Gestión de Usuarios": "user_permissions",
      "Head Count": "headcount",
      "Registro de asistencia": "attendance_registration", // Added mapping for attendance module
      "Tabla Asistencia": "attendance_table", // Added mapping for attendance table
      "Asignación horas extra": "extra_hours_assignment", // Added mapping for extra hours assignment module
      "Asignación de apoyo en cargue": "apoyo_cargue", // Added mapping for apoyo en cargue module
      "Novedades de personal": "personnel_notices", // Added mapping for personnel notices module
      "Ver Picking": "view_picking", // Added mapping for ViewPicking module
      "Ver Picking/Packing": "view_picking", // Added mapping for renamed module Ver Picking/Packing
      Tarifas: "tarifas", // Added mapping for Tarifas module
      "Facturación Proyectos": "facturacion_proyectos", // Added mapping for Facturacion Proyectos module
      "Cuadro de Control Facturación": "cuadro_facturacion",
      "Prefactura de Producción": "prefactura_produccion",
      "Gestión de Facturas": "gestionfacturas", // Added mapping for Gestión de Facturas module
      "Dashboard Operaciones LIP": "dashboardop", // Dashboard Operaciones LIP
      "Recepción de Traslado": "transfer_requests", // Added mapping for renamed module
      Proyecciones: "proyecciones", // Added mapping for Proyecciones module
      Liquidaciones: "liquidaciones", // Submódulo de liquidaciones de personal retirado
      Parafiscales: "parafiscales", // Aportes de seguridad social y parafiscales (PILA)
      "Gestión de Contratos": "gestion_contratos",
      "Gestión de Dotación EPP": "dotacion_epp",
      "Gestión de Capacitaciones": "capacitaciones",
      "Asistencia a Capacitaciones": "asistencia_capacitaciones",
      "Operación del día": "operacion_dia",
      "Solicitud de Personal": "solicitud_personal",
      "Evaluaciones de Desempeño": "evaluacionpersonal",
      "Gestión de Solicitudes": "gestionsolicitudes",
      // Mismo permiso que Gestión de Solicitudes (peticion del cliente).
      "Aprobación de Solicitudes de Personal": "gestionsolicitudes",
      "Registro Preoperacional": "prechequeo",
      "Servicios Adicionales": "solicitudturnos",
      "Aprobar Turnos": "aprobacionturnos",
    }

    return configModules[map[moduleName]]
  }

  React.useEffect(() => {
    const handleNavigateToBascula = (event: Event) => {
      const customEvent = event as CustomEvent<{ orderId: number }>
      setBasculaOrderId(customEvent.detail.orderId)
      onSelectModule("Báscula")
    }

    const handleNavigateToSanitaryRegistry = (event: Event) => {
      const customEvent = event as CustomEvent<{ vehicleId: number }>
      setSanitaryRegistryVehicleId(customEvent.detail.vehicleId)
      onSelectModule("Registro sanitario")
    }

    const handleVerAusentismosPersona = (event: Event) => {
      const customEvent = event as CustomEvent<{ identificacion: string }>
      setAusentismosInitialSearch(customEvent.detail.identificacion)
      onSelectModule("Ausentismos")
    }

    const handleIrAGestionarFacturas = (event: Event) => {
      const customEvent = event as CustomEvent<{ empresaId?: number | null; estado?: string; fechaDesde?: string; fechaHasta?: string }>
      if (customEvent.detail.empresaId) setSelectedEmpresaId(customEvent.detail.empresaId)
      setGestionFacturasFiltroInicial({
        estado: customEvent.detail.estado,
        fechaDesde: customEvent.detail.fechaDesde,
        fechaHasta: customEvent.detail.fechaHasta,
      })
      onSelectModule("Gestión de Facturas")
    }

    window.addEventListener("navigate-to-bascula", handleNavigateToBascula)
    window.addEventListener("navigate-to-sanitary-registry", handleNavigateToSanitaryRegistry)
    window.addEventListener("lipgo:ver-ausentismos-persona", handleVerAusentismosPersona)
    window.addEventListener("lipgo:ir-a-gestionar-facturas", handleIrAGestionarFacturas)

    return () => {
      window.removeEventListener("navigate-to-bascula", handleNavigateToBascula)
      window.removeEventListener("navigate-to-sanitary-registry", handleNavigateToSanitaryRegistry)
      window.removeEventListener("lipgo:ver-ausentismos-persona", handleVerAusentismosPersona)
      window.removeEventListener("lipgo:ir-a-gestionar-facturas", handleIrAGestionarFacturas)
    }
  }, [onSelectModule, setSelectedEmpresaId])

  const configDef = getConfigModule(selectedModule)

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden relative z-10">
      <TopBar />

      {(selectedModule || selectedGroup) && (
        <div className="md:hidden px-4 py-2 border-b bg-background">
          <Button variant="ghost" size="sm" onClick={onBack} className="flex items-center gap-2 text-sm">
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20 md:pb-0">
        <div
          className={
            selectedModule === "Dashboard Operacion"
              ? "w-full px-2 sm:px-4 py-2 sm:py-4"
              : "w-full max-w-full px-2 sm:px-4 lg:px-8 xl:px-12 py-2 sm:py-4 lg:py-6"
          }
        >
          {/* KPIs del módulo, presentes en CUALQUIER submódulo del módulo (self-gated:
              solo pinta en submódulos de grupos con KPIs; null en home/portada). */}
          {selectedGroup && selectedModule ? <ModuleKpiHeader selectedModule={selectedModule} /> : null}
          {selectedGroup && selectedModule ? <ModuloGuiaBar selectedModule={selectedModule} /> : null}
          {editingOrderId ? (
            <OrderEditPage {...({ orderId: editingOrderId, onBack: () => setEditingOrderId(null) } as any)} />
          ) : !selectedGroup ? (
            <>
              {/* Hero premium con IA (rediseño 2026-07-03). Solo layout; el botón
                  abre el Asistente IA que ya existe. */}
              <style>{`
                .lipgo-home-hero{ position:relative; overflow:hidden; border-radius:18px; color:#eaf6fa;
                  background:
                    radial-gradient(80% 130% at 92% -20%, rgba(0,194,220,.30), transparent 55%),
                    radial-gradient(70% 120% at -5% 120%, rgba(95,120,225,.32), transparent 55%),
                    linear-gradient(120deg,#0a2545,#0b2f57 55%,#0e4a72);
                  border:1px solid rgba(120,190,230,.15); }
                .lipgo-ai-bar{ background:rgba(255,255,255,.1); border:1px solid rgba(180,230,245,.28); backdrop-filter:blur(4px); }
                .lipgo-ai-bar input::placeholder{ color:#bfe0ec; }
                .lipgo-ai-chip{ color:#d6eef5; background:rgba(255,255,255,.08); border:1px solid rgba(180,230,245,.2); transition:background .15s; }
                .lipgo-ai-chip:hover{ background:rgba(255,255,255,.16); }
              `}</style>
              <div className="lipgo-home-hero mb-3 px-4 py-2.5">
                <div className="relative z-10 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <h1 className="text-base font-extrabold tracking-tight sm:text-lg">
                    <span aria-hidden="true">👋</span> {nowInfo.saludo}
                    {primerNombre ? `, ${primerNombre}` : ""}
                  </h1>
                  <span className="text-xs sm:text-sm" style={{ color: "#9fd4e6" }}>
                    {nowInfo.fecha}
                    {selectedEmpresaNombre ? ` · ${selectedEmpresaNombre}` : ""}
                  </span>
                </div>
              </div>

              {/* ===== LIPbot — LA INTELIGENCIA DE LIPGO, protagonista del Inicio =====
                  La IA es el diferencial: no es un chat, es un copiloto que consulta
                  datos reales, navega y EJECUTA acciones (gobernado por permisos). Es
                  la puerta de entrada y además surge las alertas del día. El botón
                  flotante queda para el resto de pantallas (aquí no, para no duplicar). */}
              <section className="mb-5 sm:mb-6">
                <div className="mb-2.5">
                  <span
                    className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em]"
                    style={{ color: "#00a6c4" }}
                  >
                    <span aria-hidden="true">✨</span> La inteligencia de LIPgo
                  </span>
                  <p className="mt-1 max-w-[62ch] text-[13px] text-muted-foreground">
                    Háblale a <span className="font-bold text-foreground">LIPbot</span> en lenguaje natural: te da{" "}
                    <span className="font-semibold text-foreground">datos exactos</span>, te{" "}
                    <span className="font-semibold text-foreground">lleva al módulo</span> y{" "}
                    <span className="font-semibold text-foreground">ejecuta acciones</span> por ti — todo gobernado por tus permisos.
                  </p>
                </div>

                {/* Barra de comando: compacta por defecto, se expande al preguntar.
                    Protagonista por tratamiento (brillo + orbe), no por tamaño → los
                    módulos quedan visibles. Sugerencias contextuales al módulo. */}
                <LipAiAssistant
                  variant="bar"
                  empresaLabel={selectedEmpresaNombre}
                  onNavigate={onNavigateModule}
                  onOpenGroup={onOpenGroup}
                  onOpen={() => onSelectModule("Asistente IA")}
                />

                {/* Los tres superpoderes — lo que hace a LIPbot distinto de un chat */}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1 text-[11.5px] font-semibold text-foreground">
                    <span aria-hidden="true">🔎</span> <span><b className="font-extrabold">Consulta</b> datos reales</span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1 text-[11.5px] font-semibold text-foreground">
                    <span aria-hidden="true">🧭</span> <span><b className="font-extrabold">Navega</b> a cualquier módulo</span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1 text-[11.5px] font-semibold text-foreground">
                    <span aria-hidden="true">⚡</span> <span><b className="font-extrabold">Ejecuta</b> acciones por ti</span>
                  </span>
                </div>

                {/* Atención del día — franja compacta (fuera de la barra de IA) */}
                {homeAlertas.length > 0 && (
                  <div className="mt-3.5">
                    <AtencionBanner
                      alertas={homeAlertas}
                      onAlerta={(a) => {
                        const m = (a as { modulo?: string }).modulo
                        if (m) onNavigateModule(m)
                      }}
                    />
                  </div>
                )}
              </section>

              {/* Aplicaciones — el otro pilar del Inicio */}
              <ModuleCards onSelectGroup={onSelectGroup} onSelectModule={onSelectModule} />

              {/* Pulso operativo */}
              <div className="mt-5 sm:mt-6">
                <DailySummary />
              </div>
            </>
          ) : selectedModule === "Entrada de pedidos" ? (
            <PermissionGuard moduleName="Entrada de pedidos">
              <OrderEntryForm onNavigateToManageOrders={() => onSelectModule("Gestionar pedidos")} />
            </PermissionGuard>
          ) : selectedModule === "Gestionar pedidos" ? (
            <PermissionGuard moduleName="Gestionar pedidos">
              <OrdersManagement onEditOrder={(orderId) => setEditingOrderId(orderId)} />
            </PermissionGuard>
          ) : selectedModule === "Gestión integral de pedidos" ? (
            <PermissionGuard moduleName="Gestión integral de pedidos">
              <ComprehensiveOrdersManagement />
            </PermissionGuard>
          ) : selectedModule === "Dashboard Pedidos" ? (
            <PermissionGuard moduleName="Dashboard Pedidos">
              <DashboardPedidos />
            </PermissionGuard>
          ) : selectedModule === "Generar Órdenes de Cargue" ? (
            <PermissionGuard moduleName="Generar Órdenes de Cargue">
              <GenerateLoadOrders />
            </PermissionGuard>
          ) : selectedModule === "Generar Órdenes de Descargue" ? (
            <PermissionGuard moduleName="Generar Órdenes de Descargue">
              <GenerateUnloadOrders />
            </PermissionGuard>
          ) : selectedModule === "Generar Orden de Distribución" ? (
            <PermissionGuard moduleName="Generar Orden de Distribución">
              <GenerateDistributionOrders />
            </PermissionGuard>
          ) : selectedModule === "Gestión de Ordenes" ? (
            <PermissionGuard moduleName="Gestión de Ordenes">
              <LoadOrdersManagement />
            </PermissionGuard>
          ) : selectedModule === "Dashboard Despachos/Recepción" ? (
            <PermissionGuard moduleName="Dashboard Despachos/Recepción">
              <DashboardRecepcion />
            </PermissionGuard>
          ) : selectedModule === "Transacciones de Inventario" ? (
            <PermissionGuard moduleName="Transacciones de Inventario">
              <InventoryTransactionsModule />
            </PermissionGuard>
          ) : selectedModule === "Ingreso de Producción" ? (
            <PermissionGuard moduleName="Ingreso de Producción">
              <ProductionEntryForm />
            </PermissionGuard>
          ) : selectedModule === "Tolva" ? (
            <PermissionGuard moduleName="Tolva">
              <Tolva />
            </PermissionGuard>
          ) : selectedModule === "Ver Tolva" ? (
            <PermissionGuard moduleName="Ver Tolva">
              <VerTolva />
            </PermissionGuard>
          ) : selectedModule === "Proyecciones" ? (
            <PermissionGuard moduleName="Proyecciones">
              <Proyecciones />
            </PermissionGuard>
          ) : selectedModule === "Ver ingresos de producción" ? (
            <PermissionGuard moduleName="Ver ingresos de producción">
              <ProductionEntriesView />
            </PermissionGuard>
          ) : selectedModule === "Aprobación de ingreso de producción" ? (
            <PermissionGuard moduleName="Aprobación de ingreso de producción">
              <ProductionApproval />
            </PermissionGuard>
          ) : selectedModule === "Liquidación Tolva del día" ? (
            <PermissionGuard moduleName="Liquidación Tolva del día">
              <LiquidacionTolva />
            </PermissionGuard>
          ) : selectedModule === "Historial Aprobaciones" ? (
            <PermissionGuard moduleName="Historial Aprobaciones">
              <ApprovalHistory />
            </PermissionGuard>
          ) : selectedModule === "Dashboard de Producción" ? (
            <PermissionGuard moduleName="Dashboard de Producción">
              <ControlPiso />
            </PermissionGuard>
          ) : selectedModule === "Reporte de Paros" ? (
            <PermissionGuard moduleName="Reporte de Paros">
              <ReporteParos />
            </PermissionGuard>
          ) : selectedModule === "Gestión de Montacargas" ? (
            <PermissionGuard moduleName="Gestión de Montacargas">
              <GestionMontacargas />
            </PermissionGuard>
          ) : selectedModule === "Saldos de inventario" ? (
            <PermissionGuard moduleName="Saldos de inventario">
              <InventoryBalanceDetails />
            </PermissionGuard>
          ) : selectedModule === "Saldos por producto" ? (
            <PermissionGuard moduleName="Saldos por producto">
              <InventoryBalanceGlobal />
            </PermissionGuard>
          ) : selectedModule === "Capacidad Bodega" ? (
            <PermissionGuard moduleName="Capacidad Bodega">
              <WarehouseCapacityComponent />
            </PermissionGuard>
          ) : selectedModule === "Registro de QR estibas" ? (
            <PermissionGuard moduleName="Registro de QR estibas">
              <QRPalletRegistration />
            </PermissionGuard>
          ) : selectedModule === "Lectura de QR estibas" ? (
            <PermissionGuard moduleName="Lectura de QR estibas">
              <QRPalletReading />
            </PermissionGuard>
          ) : selectedModule === "Inventario por Estiba" ? (
            <PermissionGuard moduleName="Inventario por Estiba">
              <PalletInventoryView />
            </PermissionGuard>
          ) : selectedModule === "Montacargas y personal día" ? (
            <PermissionGuard moduleName="Montacargas y personal día">
              <MontacargasDia />
            </PermissionGuard>
          ) : selectedModule === "Reprocesos" ? (
            <PermissionGuard moduleName="Reprocesos">
              <ReprocesosManagement />
            </PermissionGuard>
          ) : selectedModule === "Gestión de transacciones" ? (
            <PermissionGuard moduleName="Gestión de transacciones">
              <InventoryTransactionsManagement />
            </PermissionGuard>
          ) : selectedModule === "Ver Solicitudes de traslado" ? (
            <PermissionGuard moduleName="Ver Solicitudes de traslado">
              <TransferRequestsView />
            </PermissionGuard>
          ) : selectedModule === "Recepción de Traslado" ? (
            <PermissionGuard moduleName="Recepción de Traslado">
              <TransferRequestsView />
            </PermissionGuard>
          ) : selectedModule === "Traslados de producto" ? (
            <PermissionGuard moduleName="Traslados de producto">
              <ProductTransferForm />
            </PermissionGuard>
          ) : selectedModule === "Asignación de Lotes" ? (
            <PermissionGuard moduleName="Asignación de Lotes">
              <BatchApproval />
            </PermissionGuard>
          ) : selectedModule === "Picking" ? (
            <PermissionGuard moduleName="Picking">
              <Picking />
            </PermissionGuard>
          ) : selectedModule === "Packing" ? (
            <PermissionGuard moduleName="Packing">
              <Packing />
            </PermissionGuard>
          ) : selectedModule === "Ver Picking" ? (
            <PermissionGuard moduleName="Ver Picking">
              <ViewPicking />
            </PermissionGuard>
          ) : selectedModule === "Ver Picking/Packing" ? (
            <PermissionGuard moduleName="Ver Picking/Packing">
              <ViewPicking />
            </PermissionGuard>
          ) : selectedModule === "Dashboard Operacion" ? (
            <PermissionGuard moduleName="Dashboard Operacion">
              <DashboardOperacion />
            </PermissionGuard>
          ) : selectedModule === "Gestión de Contratos" ? (
            <PermissionGuard moduleName="Gestión de Contratos">
              <GestionContratos />
            </PermissionGuard>
          ) : selectedModule === "Gestión de Dotación EPP" ? (
            <PermissionGuard moduleName="Gestión de Dotación EPP">
              <DotacionEPP />
            </PermissionGuard>
          ) : selectedModule === "Examenes Médicos" ? (
            <PermissionGuard moduleName="Examenes Médicos">
              <ExamenesMedicos />
            </PermissionGuard>
          ) : selectedModule === "Gestión de Capacitaciones" ? (
            <PermissionGuard moduleName="Gestión de Capacitaciones">
              <Capacitaciones />
            </PermissionGuard>
          ) : selectedModule === "Asistencia a Capacitaciones" ? (
            <PermissionGuard moduleName="Asistencia a Capacitaciones">
              <CapacitacionesAsistencia />
            </PermissionGuard>
) : selectedModule === "Solicitud de Personal" ? (
<PermissionGuard moduleName="Solicitud de Personal">
  <RequisicionPersonal />
  </PermissionGuard>
) : selectedModule === "Evaluaciones de Desempeño" ? (
  <PermissionGuard moduleName="Evaluaciones de Desempeño">
    <EvaluacionesDashboard />
  </PermissionGuard>
) : selectedModule === "Evidencia de Inducciones" ? (
  <PermissionGuard moduleName="Evidencia de Inducciones">
    <InduccionesEvidenciaDashboard />
  </PermissionGuard>
) : selectedModule === "Inducciones" ? (
  <PermissionGuard moduleName="Inducciones">
    <InduccionesManagement />
  </PermissionGuard>
) : selectedModule === "Gestión de Solicitudes" ? (
  <PermissionGuard moduleName="Gestión de Solicitudes">
    <GestionSolicitudes />
  </PermissionGuard>
) : selectedModule === "Aprobación de Solicitudes de Personal" ? (
  <PermissionGuard moduleName="Aprobación de Solicitudes de Personal">
    <GestionSolicitudesPersonal />
  </PermissionGuard>
) : selectedModule === "Hojas de Vida" ? (
  <PermissionGuard moduleName="Hojas de Vida">
    <HojasDeVida />
  </PermissionGuard>
) : selectedModule === "Antecedentes" ? (
  <PermissionGuard moduleName="Antecedentes">
    <Antecedentes />
  </PermissionGuard>
) : selectedModule === "Gestión de Colaboradores" ? (
  <PermissionGuard moduleName="Gestión de Colaboradores">
    <GestionColaboradores />
  </PermissionGuard>
) : selectedModule === "Procesos Disciplinarios" ? (
  <PermissionGuard moduleName="Procesos Disciplinarios">
    <ProcesosDisciplinarios />
  </PermissionGuard>
) : selectedModule === "Carpetas de Trabajadores" ? (
  <PermissionGuard moduleName="Carpetas de Trabajadores">
    <CarpetasTrabajadores />
  </PermissionGuard>
) : selectedModule === "Entrevistas" ? (
  <PermissionGuard moduleName="Entrevistas">
    <Entrevistas />
  </PermissionGuard>
) : selectedModule === "Programa de Bienestar" ? (
  <PermissionGuard moduleName="Programa de Bienestar">
    <BienestarPrograma />
  </PermissionGuard>
) : selectedModule === "Participación y Evidencias" ? (
  <PermissionGuard moduleName="Participación y Evidencias">
    <BienestarParticipacion />
  </PermissionGuard>
          ) : selectedModule === "Historial de lotes" ? (
            <PermissionGuard moduleName="Historial de lotes">
              <BatchHistory />
            </PermissionGuard>
          ) : selectedModule === "Auditoría de Inventario" ? (
            <PermissionGuard moduleName="Auditoría de Inventario">
              <InventoryAudit />
            </PermissionGuard>
          ) : selectedModule === "Registrar Vehículos" ? (
            <PermissionGuard moduleName="Registrar Vehículos">
              <VehicleAppointmentsForm />
            </PermissionGuard>
          ) : selectedModule === "Ver Vehículos" ? (
            <PermissionGuard moduleName="Ver Vehículos">
              <GenericCrudTable moduleDef={configModules["citas_vehiculos"]} hideNewButton={true} />
            </PermissionGuard>
          ) : selectedModule === "Ver historial de Inspección" ? (
            <PermissionGuard moduleName="Ver historial de Inspección">
              <SanitaryInspectionHistory />
            </PermissionGuard>
          ) : selectedModule === "Báscula" ? (
            <PermissionGuard moduleName="Báscula">
              <BasculaForm initialOrderId={basculaOrderId} onOrderLoaded={() => setBasculaOrderId(null)} />
            </PermissionGuard>
          ) : selectedModule === "Historial Báscula" ? (
            <PermissionGuard moduleName="Historial Báscula">
              <BasculaHistory />
            </PermissionGuard>
          ) : selectedModule === "Registro sanitario" ? (
            <PermissionGuard moduleName="Registro sanitario">
              <SanitaryRegistryForm
                initialVehicleId={sanitaryRegistryVehicleId}
                onVehicleLoaded={() => setSanitaryRegistryVehicleId(null)}
              />
            </PermissionGuard>
          ) : selectedModule === "Productos" ? (
            <PermissionGuard moduleName="Productos">
              <ProductosWithCategories />
            </PermissionGuard>
          ) : selectedModule === "Sub Categorías" ? (
            <PermissionGuard moduleName="Sub Categorías">
              <GenericCrudTable moduleDef={configModules["subcategorias"]} />
            </PermissionGuard>
          ) : selectedModule === "Transportadoras" ? (
            <PermissionGuard moduleName="Transportadoras">
              <GenericCrudTable moduleDef={configModules["transportes"]} />
            </PermissionGuard>
          ) : selectedModule === "Tipos de Vehiculos" ? (
            <PermissionGuard moduleName="Tipos de Vehiculos">
              <GenericCrudTable moduleDef={configModules["tiposvehiculos"]} />
            </PermissionGuard>
          ) : selectedModule === "Localizaciones" ? (
            <PermissionGuard moduleName="Localizaciones">
              <GenericCrudTable moduleDef={configModules["localizaciones"]} />
            </PermissionGuard>
          ) : selectedModule === "Gestión de proveedores" ? (
            <PermissionGuard moduleName="Gestión de proveedores">
              <GenericCrudTable moduleDef={configModules["proveedores"]} />
            </PermissionGuard>
          ) : selectedModule === "Creación de materiales" ? (
            <PermissionGuard moduleName="Creación de materiales">
              <GenericCrudTable moduleDef={configModules["materiales"]} />
            </PermissionGuard>
          ) : selectedModule === "Explosión de materiales" ? (
            <PermissionGuard moduleName="Explosión de materiales">
              <MaterialExplosion />
            </PermissionGuard>
          ) : selectedModule === "Gestión de Usuarios" ? (
            <PermissionGuard moduleName="Gestión de Usuarios">
              <UserPermissionsManagement />
            </PermissionGuard>
          ) : selectedModule === "Accesos de Usuario" ? (
            <PermissionGuard moduleName="Accesos de Usuario">
              <UserAccessModule />
            </PermissionGuard>
          ) : selectedModule === "Bitácora de Auditoría" ? (
            <PermissionGuard moduleName="Bitácora de Auditoría">
              <BitacoraAuditoria />
            </PermissionGuard>
          ) : selectedModule === "Placas de Distribución" ? (
            <PermissionGuard moduleName="Placas de Distribución">
              <PlacasDistribucion />
            </PermissionGuard>
          ) : selectedModule === "Muelles de Cargue" ? (
            <PermissionGuard moduleName="Muelles de Cargue">
              <MuellesEmpresaConfig />
            </PermissionGuard>
          ) : selectedModule === "Head Count" ? (
            <PermissionGuard moduleName="Head Count">
              <HeadcountManagement />
            </PermissionGuard>
          ) : selectedModule === "Nominapersonal" ? (
            <PermissionGuard moduleName="Nominapersonal">
              <Nominapersonal />
            </PermissionGuard>
          ) : selectedModule === "Liquidaciones" ? (
            <PermissionGuard moduleName="Liquidaciones">
              <Liquidaciones />
            </PermissionGuard>
          ) : selectedModule === "Parafiscales" ? (
            <PermissionGuard moduleName="Parafiscales">
              <Parafiscales />
            </PermissionGuard>
          ) : selectedModule === "Revisión de nómina" ? (
            <PermissionGuard moduleName="Revisión de nómina">
              <RevisionNomina />
            </PermissionGuard>
          ) : selectedModule === "Bonos" ? (
            <PermissionGuard moduleName="Bonos">
              <Bonos />
            </PermissionGuard>
          ) : selectedModule === "Registro de asistencia" ? (
            <PermissionGuard moduleName="Registro de asistencia">
              <AttendanceRegistration />
            </PermissionGuard>
          ) : selectedModule === "Tabla Asistencia" ? (
            <PermissionGuard moduleName="Tabla Asistencia">
              <AttendanceTable />
            </PermissionGuard>
          ) : selectedModule === "Asignación horas extra" ? (
            <PermissionGuard moduleName="Asignación horas extra">
              <ExtraHoursAssignment
                onNavigateToAprobarTurnosHistorial={() => {
                  // Bandera leída por AprobarTurnos al montar para abrir
                  // directamente la vista de historial.
                  if (typeof window !== "undefined") {
                    sessionStorage.setItem("aprobarTurnosInitialView", "historial")
                  }
                  onSelectModule("Aprobar Turnos")
                }}
              />
            </PermissionGuard>
          ) : selectedModule === "Asignación de apoyo en cargue" ? (
            <PermissionGuard moduleName="Asignación de apoyo en cargue">
              <ApoyoCargue />
            </PermissionGuard>
          ) : selectedModule === "Novedades de personal" ? (
            <PermissionGuard moduleName="Novedades de personal">
              <NovedadesTiempoReal />
            </PermissionGuard>
          ) : selectedModule === "Asistencia Administrativa" ? (
            <PermissionGuard moduleName="Asistencia Administrativa">
              <AsistenciaAdministrativa />
            </PermissionGuard>
          ) : selectedModule === "Ausentismos" ? (
            <PermissionGuard moduleName="Ausentismos">
              <Ausentismos
                initialSearch={ausentismosInitialSearch ?? undefined}
                onInitialSearchApplied={() => setAusentismosInitialSearch(null)}
              />
            </PermissionGuard>
          ) : selectedModule === "Recobro de Incapacidades" ? (
            <PermissionGuard moduleName="Recobro de Incapacidades">
              <RecobroIncapacidades />
            </PermissionGuard>
          ) : selectedModule === "Vacaciones" ? (
            <PermissionGuard moduleName="Vacaciones">
              <Vacaciones />
            </PermissionGuard>
          ) : selectedModule === "Acumulados LIPgo" ? (
            <PermissionGuard moduleName="Acumulados LIPgo">
              <AcumuladosLIPgo />
            </PermissionGuard>
          ) : selectedModule === "Auditoría 0312" ? (
            <PermissionGuard moduleName="Auditoría 0312">
              <Auditoria0312 />
            </PermissionGuard>
          ) : selectedModule === "Matriz de Estándares" ? (
            <PermissionGuard moduleName="Matriz de Estándares">
              <Matriz60Estandares onNavigate={onNavigateModule} />
            </PermissionGuard>
          ) : selectedModule === "Repositorio de Soportes" ? (
            <PermissionGuard moduleName="Repositorio de Soportes">
              <RepositorioSoportes />
            </PermissionGuard>
          ) : selectedModule === "Investigación AT" ? (
            <PermissionGuard moduleName="Investigación AT">
              <InvestigacionAT />
            </PermissionGuard>
          ) : selectedModule === "Alertas de AT" ? (
            <PermissionGuard moduleName="Alertas de AT">
              <AlertasAT />
            </PermissionGuard>
          ) : selectedModule === "Investigaciones Realizadas" ? (
            <PermissionGuard moduleName="Investigaciones Realizadas">
              <InvestigacionesRepositorio />
            </PermissionGuard>
          ) : selectedModule === "IPEVR" ? (
            <PermissionGuard moduleName="IPEVR">
              <MatrizIpevr />
            </PermissionGuard>
          ) : selectedModule === "MEDEVAC" ? (
            <PermissionGuard moduleName="MEDEVAC">
              <Medevac />
            </PermissionGuard>
          ) : selectedModule === "Perfil Sociodemográfico" ? (
            <PermissionGuard moduleName="Perfil Sociodemográfico">
              <PerfilSociodemografico />
            </PermissionGuard>
          ) : selectedModule === "Plan de Mejoramiento" ? (
            <PermissionGuard moduleName="Plan de Mejoramiento">
              <PlanMejoramiento />
            </PermissionGuard>
          ) : selectedModule === "Indicadores SST" ? (
            <PermissionGuard moduleName="Indicadores SST">
              <IndicadoresSST />
            </PermissionGuard>
          ) : selectedModule === "Entrega de EPP" ? (
            <PermissionGuard moduleName="Entrega de EPP">
              <EntregaEpp />
            </PermissionGuard>
          ) : selectedModule === "Equipos y Mantenimiento" ? (
            <PermissionGuard moduleName="Equipos y Mantenimiento">
              <EquiposMantenimiento />
            </PermissionGuard>
          ) : selectedModule === "Comunicación SST" ? (
            <PermissionGuard moduleName="Comunicación SST">
              <ComunicacionSST />
            </PermissionGuard>
          ) : selectedModule === "Gestión del Cambio" ? (
            <PermissionGuard moduleName="Gestión del Cambio">
              <GestionCambio />
            </PermissionGuard>
          ) : selectedModule === "Actividades y Comités" ? (
            <PermissionGuard moduleName="Actividades y Comités">
              <ActividadesSST />
            </PermissionGuard>
          ) : selectedModule === "Dashboard SIG" ? (
            <PermissionGuard moduleName="Dashboard SIG">
              <DashboardSIG />
            </PermissionGuard>
          ) : selectedModule === "Análisis de Contexto DOFA" ? (
            <PermissionGuard moduleName="Análisis de Contexto DOFA">
              <ContextoDofa />
            </PermissionGuard>
          ) : selectedModule === "Matriz Integrada SIG" ? (
            <PermissionGuard moduleName="Matriz Integrada SIG">
              <MatrizIntegradaSIG />
            </PermissionGuard>
          ) : selectedModule === "Repositorio por Norma SIG" ? (
            <PermissionGuard moduleName="Repositorio por Norma SIG">
              <RepositorioSIG />
            </PermissionGuard>
          ) : selectedModule === "Repositorio Universal" ? (
            <PermissionGuard moduleName="Repositorio Universal">
              <RepositorioUniversal />
            </PermissionGuard>
          ) : selectedModule === "Aspectos e Impactos ISO 14001" ? (
            <PermissionGuard moduleName="Aspectos e Impactos ISO 14001">
              <AspectosAmbientales />
            </PermissionGuard>
          ) : selectedModule === "Objetivos y Metas SIG" ? (
            <PermissionGuard moduleName="Objetivos y Metas SIG">
              <ObjetivosSIG />
            </PermissionGuard>
          ) : selectedModule === "No Conformidades SIG" ? (
            <PermissionGuard moduleName="No Conformidades SIG">
              <NoConformidadesSIG />
            </PermissionGuard>
          ) : selectedModule === "Indicadores SIG" ? (
            <PermissionGuard moduleName="Indicadores SIG">
              <IndicadoresSIG />
            </PermissionGuard>
          ) : selectedModule === "Evaluación por Área" ? (
            <PermissionGuard moduleName="Evaluación por Área">
              <EvaluacionAreas />
            </PermissionGuard>
          ) : selectedModule === "Panel LIP Operación" ? (
            <PermissionGuard moduleName="Panel LIP Operación">
              <PanelOperacionLIP />
            </PermissionGuard>
          ) : selectedModule === "Control de Toneladas" ? (
            <PermissionGuard moduleName="Control de Toneladas">
              <ControlToneladas />
            </PermissionGuard>
          ) : selectedModule === "Operación del día" ? (
            <PermissionGuard moduleName="Operación del día">
              <OperacionDelDia />
            </PermissionGuard>
          ) : selectedModule === "Centro de Coordinación" ? (
            <PermissionGuard moduleName="Centro de Coordinación">
              <CentroCoordinacion onNavigate={onNavigateModule} />
            </PermissionGuard>
          ) : selectedModule === "Mapa de Procesos" ? (
            <PermissionGuard moduleName="Mapa de Procesos">
              <MapaProcesos />
            </PermissionGuard>
          ) : selectedModule === "Mapa de Interacción del Proceso" ? (
            <PermissionGuard moduleName="Mapa de Interacción del Proceso">
              <MapaInteraccionProceso />
            </PermissionGuard>
          ) : selectedModule === "Panel LIP Inventario" ? (
            <PermissionGuard moduleName="Panel LIP Inventario">
              <PanelInventarioLIP />
            </PermissionGuard>
          ) : selectedModule === "Cuadre de Inventario" ? (
            <PermissionGuard moduleName="Cuadre de Inventario">
              <CuadreInventario />
            </PermissionGuard>
          ) : selectedModule === "Panel LIP Gestión Humana" ? (
            <PermissionGuard moduleName="Panel LIP Gestión Humana">
              <PanelGestionHumanaLIP />
            </PermissionGuard>
          ) : selectedModule === "Satisfacción y PQRSF" ? (
            <PermissionGuard moduleName="Satisfacción y PQRSF">
              <SatisfaccionPQRSF />
            </PermissionGuard>
          ) : selectedModule === "Calificación del Conductor" ? (
            <PermissionGuard moduleName="Calificación del Conductor">
              <CalificacionConductor />
            </PermissionGuard>
          ) : selectedModule === "Matriz Legal Ambiental" ? (
            <PermissionGuard moduleName="Matriz Legal Ambiental">
              <MatrizLegalAmbiental />
            </PermissionGuard>
          ) : selectedModule === "Turnos" ? (
            <PermissionGuard moduleName="Turnos">
              <GestionTurnos />
            </PermissionGuard>
          ) : selectedModule === "Programación de turnos" ? (
            <PermissionGuard moduleName="Programación de turnos">
              <ProgramacionPersonal />
            </PermissionGuard>
          ) : selectedModule === "Notificaciones al Personal" ? (
            <PermissionGuard moduleName="Notificaciones al Personal">
              <NotificacionesPersonal />
            </PermissionGuard>
          ) : selectedModule === "Tarifas" ? (
            <PermissionGuard moduleName="Tarifas">
              <ClaveFinancieraGuard>
                <Tarifas />
              </ClaveFinancieraGuard>
            </PermissionGuard>
) : selectedModule === "Servicios Adicionales" ? (
  <PermissionGuard moduleName="Servicios Adicionales">
  <SolicitudTurnos />
  </PermissionGuard>
        ) : selectedModule === "Indicador de Facturación por Proyectos" ? (
          <PermissionGuard moduleName="Indicador de Facturación por Proyectos">
            <ClaveFinancieraGuard>
              <FacturacionProyectosIndicador />
            </ClaveFinancieraGuard>
          </PermissionGuard>
        ) : selectedModule === "Facturación Proyectos" ? (
          <PermissionGuard moduleName="Facturación Proyectos">
            <ClaveFinancieraGuard>
              <FacturacionProyectos />
            </ClaveFinancieraGuard>
          </PermissionGuard>
          ) : selectedModule === "Cuadro de Control Facturación" ? (
            <PermissionGuard moduleName="Cuadro de Control Facturación">
              <ClaveFinancieraGuard>
                <CuadroControlFacturacion />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Resumen de Facturación por Proyecto" ? (
            <PermissionGuard moduleName="Resumen de Facturación por Proyecto">
              <ClaveFinancieraGuard>
                <ResumenFacturacionProyecto />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Cargos Fijos" ? (
            <PermissionGuard moduleName="Cargos Fijos">
              <ClaveFinancieraGuard>
                <CargosFijos />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Corrección de Órdenes" ? (
            <PermissionGuard moduleName="Corrección de Órdenes">
              <ClaveFinancieraGuard>
                <CorreccionOrdenes />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Conciliación Avimol" ? (
            <PermissionGuard moduleName="Conciliación Avimol">
              <ClaveFinancieraGuard>
                <ConciliacionAvimol />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Prefactura de Producción" ? (
            <PermissionGuard moduleName="Prefactura de Producción">
              <ClaveFinancieraGuard>
                <PrefacturaProduccion />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Ciclo de Facturación" ? (
            <PermissionGuard moduleName="Ciclo de Facturación">
              <ClaveFinancieraGuard>
                <CicloFacturacion />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Gestión de Facturas" ? (
            <PermissionGuard moduleName="Gestión de Facturas">
              <GestionFacturas
                onBack={onBack}
                filtroInicial={gestionFacturasFiltroInicial}
                onFiltroInicialConsumido={() => setGestionFacturasFiltroInicial(null)}
              />
            </PermissionGuard>
          ) : selectedModule === "Dashboard Operaciones LIP" ? (
            <PermissionGuard moduleName="Dashboard Operaciones LIP">
              <DashboardOperacionesLip />
            </PermissionGuard>
) : selectedModule === "Registro Preoperacional" ? (
  <PermissionGuard moduleName="Registro Preoperacional">
  <RegistroPreoperacional />
  </PermissionGuard>
  ) : selectedModule === "Aprobar Turnos" ? (
  <PermissionGuard moduleName="Aprobar Turnos">
  <AprobarTurnos />
  </PermissionGuard>
          ) : selectedModule === "Bitácora" ? (
            <PermissionGuard moduleName="Bitácora">
              <Bitacora />
            </PermissionGuard>
          ) : selectedModule === "Visor" ? (
            <PermissionGuard moduleName="Visor">
              <AttendanceViewer />
            </PermissionGuard>
          ) : selectedModule === "Registrar Gasto" ? (
            <PermissionGuard moduleName="Registrar Gasto">
              <ClaveFinancieraGuard>
                <FormularioRegistroGasto />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Dashboard Gastos" ? (
            <PermissionGuard moduleName="Dashboard Gastos">
              <ClaveFinancieraGuard>
                <DashboardGastos />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Estado de Resultados" ? (
            <PermissionGuard moduleName="Estado de Resultados">
              <ClaveFinancieraGuard>
                <EstadoResultados />
              </ClaveFinancieraGuard>
            </PermissionGuard>
          ) : selectedModule === "Centro de Evidencia ISO 9001" ? (
            <PermissionGuard moduleName="Centro de Evidencia ISO 9001">
              <IsoEvidenceDashboard />
            </PermissionGuard>
          ) : selectedModule === "Repositorio ISO 9001" ? (
            <PermissionGuard moduleName="Repositorio ISO 9001">
              <RepositorioISO9001 />
            </PermissionGuard>
          ) : selectedModule === "Asistente IA" ? (
            <PermissionGuard moduleName="Asistente IA">
              {/*
                Caja con altura calculada para que el chat administre su
                propio scroll interno (mensajes) sin generar doble scroll
                con el `<main>` del shell. Restamos ~9rem por la TopBar
                + paddings del wrapper. min-h asegura que en pantallas
                pequenas siga siendo usable.
              */}
              <div className="h-[calc(100dvh-9rem)] min-h-[520px] w-full overflow-hidden rounded-lg border border-border/60">
                <AsistenteIA onNavigate={onNavigateModule} onOpenGroup={onOpenGroup} />
              </div>
            </PermissionGuard>
          ) : selectedModule === "Aprendizaje" ? (
            // Guia de usuario: universal a proposito, SIN PermissionGuard. El
            // filtrado por permisos ocurre dentro del modulo, sobre el
            // contenido (solo se documenta lo que el usuario puede abrir).
            <Aprendizaje />
          ) : configDef ? (
            <PermissionGuard moduleName={selectedModule || "Configuración"}>
              <GenericCrudTable moduleDef={configDef} />
            </PermissionGuard>
          ) : selectedModule ? (
            <ModulePlaceholder moduleName={selectedModule} onBack={onBack} />
          ) : (
            <ModulesView
              groupKey={selectedGroup}
              onBack={onBack}
              onSelectModule={onSelectModule}
              onNavigate={onNavigateModule}
              onOpenGroup={onOpenGroup}
            />
          )}
        </div>
      </main>
    </div>
  )
}
