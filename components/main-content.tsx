"use client"

import React from "react"
import { useAuth } from "@/components/auth-provider"
import { getAtencionDelDiaCompartida } from "@/lib/atencion-del-dia-cache"
import { LipAiAssistant, type AtencionItem } from "@/components/lip-ai-assistant"
import { AtencionBanner } from "@/components/atencion-banner"
import { TopBar } from "@/components/top-bar"
import { DailySummary } from "@/components/daily-summary"
import { ModuleCards } from "@/components/module-cards"
import { ModulesView } from "@/components/modules-view"
import { ModulePlaceholder } from "@/components/module-placeholder"
import { configModules } from "@/lib/config-definitions"
import ConsultaSiigo from "@/components/facturacion/consulta-siigo"
// Producción: maestro de montacargas, QR y bitácora de mantenimiento.
import { ModuloGuiaBar } from "@/components/modulo-guia-bar" // Guia embebida en la pantalla de cada modulo
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PermissionGuard } from "@/components/permission-guard"
// Reconstruido: reportar la novedad y ver su efecto en la quincena en una sola
// pantalla, con el impacto en pesos tomado de la vista que liquida.
// Envoltorio con dos pestañas: la programación diaria de siempre (la que
// escribe los turnos) y la vista de quincena (cobertura, equipos, grilla).
import { ClaveFinancieraGuard } from "@/components/clave-financiera-guard"
// Gestión Financiera: alquiler de montacargas facturado + cargos fijos ($2M, 600 ton).
// Reconstruido: requisicion con causal legal del Art. 77 Ley 50/1990 y costo
// mensual estimado con los porcentajes reales de prestaciones y parafiscales.
import { ModuleKpiHeader } from "@/components/module-kpi-header"
import { GroupKey } from "@/lib/dashboard-data"
import dynamic from "next/dynamic"
import { ModuleLoading } from "@/components/module-loading"

// Carga por demanda de los módulos (rendimiento): antes, los ~160 módulos se
// importaban estáticamente aquí y el bundle inicial del dashboard traía el
// código de TODOS aunque el usuario abriera uno. Con next/dynamic cada módulo
// se descarga la primera vez que se abre. Las piezas de layout/guards/home
// siguen estáticas arriba. Generado a partir de los imports originales.
const OrderEntryForm = dynamic(() => import("@/components/order-entry-form").then((m) => m.OrderEntryForm), { loading: ModuleLoading })
const GenericCrudTable = dynamic(() => import("@/components/configuration/generic-crud-table").then((m) => m.GenericCrudTable), { loading: ModuleLoading })
const OrdersManagement = dynamic(() => import("@/components/orders/orders-management").then((m) => m.OrdersManagement), { loading: ModuleLoading })
const ComprehensiveOrdersManagement = dynamic(() => import("@/components/orders/comprehensive-orders-management").then((m) => m.ComprehensiveOrdersManagement), { loading: ModuleLoading })
const DashboardPedidos = dynamic(() => import("@/components/orders/dashboard-pedidos").then((m) => m.DashboardPedidos), { loading: ModuleLoading })
const DashboardRecepcion = dynamic(() => import("@/components/dashboard-recepcion").then((m) => m.DashboardRecepcion), { loading: ModuleLoading })
const OrderEditPage = dynamic(() => import("@/components/orders/order-edit-page").then((m) => m.OrderEditPage), { loading: ModuleLoading })
const ProductosWithCategories = dynamic(() => import("@/components/configuration/productos-with-categories").then((m) => m.ProductosWithCategories), { loading: ModuleLoading })
const VehicleAppointmentsForm = dynamic(() => import("@/components/vehicle-appointments-form").then((m) => m.VehicleAppointmentsForm), { loading: ModuleLoading })
const BasculaForm = dynamic(() => import("@/components/bascula-form").then((m) => m.BasculaForm), { loading: ModuleLoading })
const BasculaHistory = dynamic(() => import("@/components/bascula-history").then((m) => m.BasculaHistory), { loading: ModuleLoading })
const GenerateLoadOrders = dynamic(() => import("@/components/generate-load-orders").then((m) => m.GenerateLoadOrders), { loading: ModuleLoading })
const GenerateUnloadOrders = dynamic(() => import("@/components/generate-unload-orders").then((m) => m.GenerateUnloadOrders), { loading: ModuleLoading })
const GenerateDistributionOrders = dynamic(() => import("@/components/generate-distribution-orders").then((m) => m.GenerateDistributionOrders), { loading: ModuleLoading })
const InventoryTransactionsModule = dynamic(() => import("@/components/inventory-transactions-module").then((m) => m.InventoryTransactionsModule), { loading: ModuleLoading })
const ProductionEntryForm = dynamic(() => import("@/components/production-entry-form").then((m) => m.ProductionEntryForm), { loading: ModuleLoading })
const InventoryBalanceDetails = dynamic(() => import("@/components/inventory-balance-details").then((m) => m.InventoryBalanceDetails), { loading: ModuleLoading })
const InventoryBalanceGlobal = dynamic(() => import("@/components/inventory-balance-global").then((m) => m.InventoryBalanceGlobal), { loading: ModuleLoading })
const ReprocesosManagement = dynamic(() => import("@/components/reprocesos-management").then((m) => m.ReprocesosManagement), { loading: ModuleLoading })
const LoadOrdersManagement = dynamic(() => import("@/components/load-orders-management").then((m) => m.LoadOrdersManagement), { loading: ModuleLoading })
const ProductionApproval = dynamic(() => import("@/components/production-approval").then((m) => m.ProductionApproval), { loading: ModuleLoading })
const LiquidacionTolva = dynamic(() => import("@/components/produccion/liquidacion-tolva"), { loading: ModuleLoading })
const ControlPiso = dynamic(() => import("@/components/produccion/control-piso"), { loading: ModuleLoading })
const ReporteParos = dynamic(() => import("@/components/produccion/reporte-paros"), { loading: ModuleLoading })
const GestionMontacargas = dynamic(() => import("@/components/montacargas/gestion-montacargas"), { loading: ModuleLoading })
const InventoryTransactionsManagement = dynamic(() => import("@/components/inventory-transactions-management").then((m) => m.InventoryTransactionsManagement), { loading: ModuleLoading })
const SanitaryRegistryForm = dynamic(() => import("@/components/sanitary-registry-form").then((m) => m.SanitaryRegistryForm), { loading: ModuleLoading })
const ProductTransferForm = dynamic(() => import("@/components/product-transfer-form").then((m) => m.ProductTransferForm), { loading: ModuleLoading })
const TransferRequestsView = dynamic(() => import("@/components/transfer-requests-view").then((m) => m.TransferRequestsView), { loading: ModuleLoading })
const BatchApproval = dynamic(() => import("@/components/batch-approval").then((m) => m.BatchApproval), { loading: ModuleLoading })
const Picking = dynamic(() => import("@/components/picking").then((m) => m.Picking), { loading: ModuleLoading })
const Packing = dynamic(() => import("@/components/packing").then((m) => m.Packing), { loading: ModuleLoading })
const DashboardOperacion = dynamic(() => import("@/components/dashboard-operacion"), { loading: ModuleLoading })
const BatchHistory = dynamic(() => import("@/components/batch-history").then((m) => m.BatchHistory), { loading: ModuleLoading })
const Aprendizaje = dynamic(() => import("@/components/aprendizaje").then((m) => m.Aprendizaje), { loading: ModuleLoading })
const ProductionEntriesView = dynamic(() => import("@/components/production-entries-view").then((m) => m.ProductionEntriesView), { loading: ModuleLoading })
const InventoryAudit = dynamic(() => import("@/components/inventory-audit"), { loading: ModuleLoading })
const SanitaryInspectionHistory = dynamic(() => import("@/components/sanitary-inspection-history").then((m) => m.SanitaryInspectionHistory), { loading: ModuleLoading })
const ApprovalHistory = dynamic(() => import("@/components/approval-history").then((m) => m.ApprovalHistory), { loading: ModuleLoading })
const WarehouseCapacityComponent = dynamic(() => import("@/components/warehouse-capacity").then((m) => m.WarehouseCapacityComponent), { loading: ModuleLoading })
const QRPalletRegistration = dynamic(() => import("@/components/qr-pallet-registration"), { loading: ModuleLoading })
const QRPalletReading = dynamic(() => import("@/components/qr-pallet-reading"), { loading: ModuleLoading })
const PalletInventoryView = dynamic(() => import("@/components/pallet-inventory-view").then((m) => m.PalletInventoryView), { loading: ModuleLoading })
const MaterialExplosion = dynamic(() => import("@/components/material-explosion"), { loading: ModuleLoading })
const MontacargasDia = dynamic(() => import("@/components/inventario/montacargas-dia"), { loading: ModuleLoading })
const Bitacora = dynamic(() => import("@/components/lip/bitacora"), { loading: ModuleLoading })
const UserPermissionsManagement = dynamic(() => import("@/components/configuration/user-permissions-management").then((m) => m.UserPermissionsManagement), { loading: ModuleLoading })
const BitacoraAuditoria = dynamic(() => import("@/components/configuration/bitacora-auditoria"), { loading: ModuleLoading })
const PlacasDistribucion = dynamic(() => import("@/components/configuration/placas-distribucion"), { loading: ModuleLoading })
const MuellesEmpresaConfig = dynamic(() => import("@/components/configuration/muelles-empresa"), { loading: ModuleLoading })
const UserAccessModule = dynamic(() => import("@/components/user-access-module").then((m) => m.UserAccessModule), { loading: ModuleLoading })
const AutorizacionesClave = dynamic(() => import("@/components/configuration/autorizaciones-clave"), { loading: ModuleLoading })
const HeadcountManagement = dynamic(() => import("@/components/headcount-management"), { loading: ModuleLoading })
const Tolva = dynamic(() => import("@/components/tolva").then((m) => m.Tolva), { loading: ModuleLoading })
const VerTolva = dynamic(() => import("@/components/ver-tolva"), { loading: ModuleLoading })
const Proyecciones = dynamic(() => import("@/components/proyecciones").then((m) => m.Proyecciones), { loading: ModuleLoading })
const AttendanceRegistration = dynamic(() => import("@/components/attendance-registration"), { loading: ModuleLoading })
const AttendanceTable = dynamic(() => import("@/components/attendance-table"), { loading: ModuleLoading })
const ExtraHoursAssignment = dynamic(() => import("@/components/extra-hours-assignment").then((m) => m.ExtraHoursAssignment), { loading: ModuleLoading })
const ApoyoCargue = dynamic(() => import("@/components/apoyo-cargue").then((m) => m.ApoyoCargue), { loading: ModuleLoading })
const NovedadesTiempoReal = dynamic(() => import("@/components/rrhh/novedades-tiempo-real"), { loading: ModuleLoading })
const AsistenciaAdministrativa = dynamic(() => import("@/components/rrhh/asistencia-administrativa"), { loading: ModuleLoading })
const GestionTurnos = dynamic(() => import("@/components/rrhh/gestion-turnos"), { loading: ModuleLoading })
const ProgramacionPersonal = dynamic(() => import("@/components/rrhh/programacion-personal"), { loading: ModuleLoading })
const NotificacionesPersonal = dynamic(() => import("@/components/rrhh/notificaciones-personal"), { loading: ModuleLoading })
const ViewPicking = dynamic(() => import("@/components/view-picking").then((m) => m.ViewPicking), { loading: ModuleLoading })
const Tarifas = dynamic(() => import("@/components/configuration/tarifas").then((m) => m.Tarifas), { loading: ModuleLoading })
const FacturacionProyectos = dynamic(() => import("@/components/facturacion-proyectos").then((m) => m.FacturacionProyectos), { loading: ModuleLoading })
const CuadroControlFacturacion = dynamic(() => import("@/components/cuadro-control-facturacion").then((m) => m.CuadroControlFacturacion), { loading: ModuleLoading })
const ResumenFacturacionProyecto = dynamic(() => import("@/components/resumen-facturacion-proyecto"), { loading: ModuleLoading })
const CargosFijos = dynamic(() => import("@/components/cargos-fijos"), { loading: ModuleLoading })
const CorreccionOrdenes = dynamic(() => import("@/components/correccion-ordenes"), { loading: ModuleLoading })
const ConciliacionAvimol = dynamic(() => import("@/components/conciliacion-avimol"), { loading: ModuleLoading })
const PrefacturaProduccion = dynamic(() => import("@/components/prefactura-produccion"), { loading: ModuleLoading })
const CicloFacturacion = dynamic(() => import("@/components/ciclo-facturacion"), { loading: ModuleLoading })
const DashboardOperacionesLip = dynamic(() => import("@/components/dashboard-operaciones-lip").then((m) => m.DashboardOperacionesLip), { loading: ModuleLoading })
const RegistroPreoperacional = dynamic(() => import("@/components/registro-preoperacional").then((m) => m.RegistroPreoperacional), { loading: ModuleLoading })
const GestionContratos = dynamic(() => import("@/components/rrhh/gestion-contratos"), { loading: ModuleLoading })
const DotacionEPP = dynamic(() => import("@/components/rrhh/dotacion-epp"), { loading: ModuleLoading })
const Capacitaciones = dynamic(() => import("@/components/rrhh/capacitaciones"), { loading: ModuleLoading })
const CapacitacionesAsistencia = dynamic(() => import("@/components/rrhh/capacitaciones-asistencia"), { loading: ModuleLoading })
const RequisicionPersonal = dynamic(() => import("@/components/rrhh/requisicion-personal"), { loading: ModuleLoading })
const ProcesosDisciplinarios = dynamic(() => import("@/components/rrhh/procesos-disciplinarios"), { loading: ModuleLoading })
const EvaluacionesDashboard = dynamic(() => import("@/components/rrhh/evaluaciones-dashboard"), { loading: ModuleLoading })
const InduccionesEvidenciaDashboard = dynamic(() => import("@/components/rrhh/inducciones-evidencia-dashboard"), { loading: ModuleLoading })
const InduccionesManagement = dynamic(() => import("@/components/rrhh/inducciones-management"), { loading: ModuleLoading })
const IsoEvidenceDashboard = dynamic(() => import("@/components/iso9001/iso-evidence-dashboard"), { loading: ModuleLoading })
const GestionSolicitudes = dynamic(() => import("@/components/rrhh/gestion-solicitudes"), { loading: ModuleLoading })
const GestionSolicitudesPersonal = dynamic(() => import("@/components/rrhh/gestion-solicitudes-personal"), { loading: ModuleLoading })
const HojasDeVida = dynamic(() => import("@/components/rrhh/hojas-de-vida"), { loading: ModuleLoading })
const Antecedentes = dynamic(() => import("@/components/rrhh/antecedentes"), { loading: ModuleLoading })
const ExamenesMedicos = dynamic(() => import("@/components/rrhh/examenes-medicos"), { loading: ModuleLoading })
const Ausentismos = dynamic(() => import("@/components/rrhh/ausentismos"), { loading: ModuleLoading })
const RecobroIncapacidades = dynamic(() => import("@/components/rrhh/recobro-incapacidades"), { loading: ModuleLoading })
const Vacaciones = dynamic(() => import("@/components/rrhh/vacaciones"), { loading: ModuleLoading })
const Auditoria0312 = dynamic(() => import("@/components/sst/auditoria-0312").then((m) => m.Auditoria0312), { loading: ModuleLoading })
const Matriz60Estandares = dynamic(() => import("@/components/sst/matriz-60-estandares").then((m) => m.Matriz60Estandares), { loading: ModuleLoading })
const RepositorioSoportes = dynamic(() => import("@/components/sst/repositorio-soportes").then((m) => m.RepositorioSoportes), { loading: ModuleLoading })
const RepositorioISO9001 = dynamic(() => import("@/components/iso9001/repositorio-iso9001").then((m) => m.RepositorioISO9001), { loading: ModuleLoading })
const InvestigacionAT = dynamic(() => import("@/components/sst/investigacion-at").then((m) => m.InvestigacionAT), { loading: ModuleLoading })
const AlertasAT = dynamic(() => import("@/components/sst/alertas-at").then((m) => m.AlertasAT), { loading: ModuleLoading })
const InvestigacionesRepositorio = dynamic(() => import("@/components/sst/investigaciones-repositorio").then((m) => m.InvestigacionesRepositorio), { loading: ModuleLoading })
const MatrizIpevr = dynamic(() => import("@/components/sst/ipevr").then((m) => m.MatrizIpevr), { loading: ModuleLoading })
const Medevac = dynamic(() => import("@/components/sst/medevac").then((m) => m.Medevac), { loading: ModuleLoading })
const PerfilSociodemografico = dynamic(() => import("@/components/sst/perfil-sociodemografico").then((m) => m.PerfilSociodemografico), { loading: ModuleLoading })
const PlanMejoramiento = dynamic(() => import("@/components/sst/plan-mejoramiento").then((m) => m.PlanMejoramiento), { loading: ModuleLoading })
const IndicadoresSST = dynamic(() => import("@/components/sst/indicadores").then((m) => m.IndicadoresSST), { loading: ModuleLoading })
const EntregaEpp = dynamic(() => import("@/components/sst/entrega-epp").then((m) => m.EntregaEpp), { loading: ModuleLoading })
const EquiposMantenimiento = dynamic(() => import("@/components/sst/equipos-mantenimiento").then((m) => m.EquiposMantenimiento), { loading: ModuleLoading })
const ComunicacionSST = dynamic(() => import("@/components/sst/comunicacion").then((m) => m.ComunicacionSST), { loading: ModuleLoading })
const GestionCambio = dynamic(() => import("@/components/sst/gestion-cambio").then((m) => m.GestionCambio), { loading: ModuleLoading })
const ActividadesSST = dynamic(() => import("@/components/sst/actividades").then((m) => m.ActividadesSST), { loading: ModuleLoading })
const MatrizIntegradaSIG = dynamic(() => import("@/components/sst/matriz-integrada-sig").then((m) => m.MatrizIntegradaSIG), { loading: ModuleLoading })
const RepositorioSIG = dynamic(() => import("@/components/sst/repositorio-sig").then((m) => m.RepositorioSIG), { loading: ModuleLoading })
const RepositorioUniversal = dynamic(() => import("@/components/sst/repositorio-universal"), { loading: ModuleLoading })
const DashboardSIG = dynamic(() => import("@/components/sst/dashboard-sig").then((m) => m.DashboardSIG), { loading: ModuleLoading })
const AspectosAmbientales = dynamic(() => import("@/components/sst/aspectos-ambientales").then((m) => m.AspectosAmbientales), { loading: ModuleLoading })
const ObjetivosSIG = dynamic(() => import("@/components/sst/objetivos-sig").then((m) => m.ObjetivosSIG), { loading: ModuleLoading })
const NoConformidadesSIG = dynamic(() => import("@/components/sst/no-conformidades-sig").then((m) => m.NoConformidadesSIG), { loading: ModuleLoading })
const IndicadoresSIG = dynamic(() => import("@/components/sst/indicadores-sig").then((m) => m.IndicadoresSIG), { loading: ModuleLoading })
const EvaluacionAreas = dynamic(() => import("@/components/sst/evaluacion-areas").then((m) => m.EvaluacionAreas), { loading: ModuleLoading })
const PanelOperacionLIP = dynamic(() => import("@/components/sst/panel-operacion-lip").then((m) => m.PanelOperacionLIP), { loading: ModuleLoading })
const ControlToneladas = dynamic(() => import("@/components/control-toneladas"), { loading: ModuleLoading })
const CentroCoordinacion = dynamic(() => import("@/components/centro-coordinacion"), { loading: ModuleLoading })
const OperacionDelDia = dynamic(() => import("@/components/operacion/operacion-del-dia").then((m) => m.OperacionDelDia), { loading: ModuleLoading })
const MapaInteraccionProceso = dynamic(() => import("@/components/sst/mapa-interaccion-proceso").then((m) => m.MapaInteraccionProceso), { loading: ModuleLoading })
const MapaProcesos = dynamic(() => import("@/components/sig/mapa-procesos").then((m) => m.MapaProcesos), { loading: ModuleLoading })
const PanelInventarioLIP = dynamic(() => import("@/components/sst/panel-inventario-lip").then((m) => m.PanelInventarioLIP), { loading: ModuleLoading })
const CuadreInventario = dynamic(() => import("@/components/sst/cuadre-inventario").then((m) => m.CuadreInventario), { loading: ModuleLoading })
const PanelGestionHumanaLIP = dynamic(() => import("@/components/sst/panel-gestion-humana-lip").then((m) => m.PanelGestionHumanaLIP), { loading: ModuleLoading })
const SatisfaccionPQRSF = dynamic(() => import("@/components/sst/satisfaccion-pqrsf").then((m) => m.SatisfaccionPQRSF), { loading: ModuleLoading })
const CalificacionConductor = dynamic(() => import("@/components/sst/calificacion-conductor").then((m) => m.CalificacionConductor), { loading: ModuleLoading })
const FacturacionProyectosIndicador = dynamic(() => import("@/components/sst/facturacion-proyectos-indicador").then((m) => m.FacturacionProyectosIndicador), { loading: ModuleLoading })
const MatrizLegalAmbiental = dynamic(() => import("@/components/sst/matriz-legal-ambiental").then((m) => m.MatrizLegalAmbiental), { loading: ModuleLoading })
const ContextoDofa = dynamic(() => import("@/components/sst/contexto-dofa").then((m) => m.ContextoDofa), { loading: ModuleLoading })
const GestionColaboradores = dynamic(() => import("@/components/rrhh/gestion-colaboradores"), { loading: ModuleLoading })
const CarpetasTrabajadores = dynamic(() => import("@/components/rrhh/carpetas-trabajadores").then((m) => m.CarpetasTrabajadores), { loading: ModuleLoading })
const Entrevistas = dynamic(() => import("@/components/rrhh/entrevistas"), { loading: ModuleLoading })
const BienestarPrograma = dynamic(() => import("@/components/rrhh/bienestar-programa"), { loading: ModuleLoading })
const BienestarParticipacion = dynamic(() => import("@/components/rrhh/bienestar-participacion"), { loading: ModuleLoading })
const Nominapersonal = dynamic(() => import("@/components/nominapersonal"), { loading: ModuleLoading })
const Liquidaciones = dynamic(() => import("@/components/liquidaciones"), { loading: ModuleLoading })
const AcumuladosLIPgo = dynamic(() => import("@/components/acumulados-lipgo"), { loading: ModuleLoading })
const Parafiscales = dynamic(() => import("@/components/parafiscales"), { loading: ModuleLoading })
const RevisionNomina = dynamic(() => import("@/components/revision-nomina"), { loading: ModuleLoading })
const Bonos = dynamic(() => import("@/components/bonos"), { loading: ModuleLoading })
const SolicitudTurnos = dynamic(() => import("@/components/solicitud-turnos").then((m) => m.SolicitudTurnos), { loading: ModuleLoading })
const AprobarTurnos = dynamic(() => import("@/components/aprobar-turnos").then((m) => m.AprobarTurnos), { loading: ModuleLoading })
const AttendanceViewer = dynamic(() => import("@/components/attendance-viewer").then((m) => m.AttendanceViewer), { loading: ModuleLoading })
const GestionFacturas = dynamic(() => import("@/components/gestion-facturas"), { loading: ModuleLoading })
const AsistenteIA = dynamic(() => import("@/components/asistente-ia"), { loading: ModuleLoading })
const FormularioRegistroGasto = dynamic(() => import("@/components/gastos/formulario-registro-gasto"), { loading: ModuleLoading })
const DashboardGastos = dynamic(() => import("@/components/gastos/dashboard-gastos"), { loading: ModuleLoading })
const EstadoResultados = dynamic(() => import("@/components/estado-resultados/estado-resultados"), { loading: ModuleLoading })

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
    getAtencionDelDiaCompartida(profile?.id, selectedEmpresaId ?? undefined)
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
          ) : selectedModule === "Autorizaciones por clave" ? (
            <PermissionGuard moduleName="Autorizaciones por clave">
              <AutorizacionesClave />
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
          ) : selectedModule === "Consulta Facturas SIIGO" ? (
            <PermissionGuard moduleName="Consulta Facturas SIIGO">
              {/* Lleva la clave financiera como los demás módulos de
                  facturación: esto muestra la contabilidad real de la empresa,
                  no solo lo que genera LIPgo. */}
              <ClaveFinancieraGuard>
                <ConsultaSiigo />
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
