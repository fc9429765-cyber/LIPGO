"use client"

import { useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
 import { Bell, User, LogOut, MessageCircle, Building2, ChevronDown, Clock, Users, Calendar, AlertTriangle, Truck, Timer, DollarSign, Package, ClipboardList, ClipboardCheck, Wrench, ShieldAlert } from "lucide-react"
import { ColombiaClock } from "./colombia-clock"
import { useAuth } from "@/components/auth-provider"
import { useRouter } from "next/navigation"
import { useUnreadMessages } from "@/hooks/useUnreadMessages"
import { usePendingTurnos } from "@/hooks/usePendingTurnos"
import { usePreoperacionalAlerts } from "@/hooks/usePreoperacionalAlerts"
import { useRendimientoAlerts } from "@/hooks/useRendimientoAlerts"
import { useFacturasAlerts } from "@/hooks/useFacturasAlerts"
import { useCicloFacturacionAlerts } from "@/hooks/useCicloFacturacionAlerts"
import { useInventarioAlerts } from "@/hooks/useInventarioAlerts"
 import { useEvaluacionesAlerts } from "@/hooks/useEvaluacionesAlerts"
import { useAsistenciaAlerts } from "@/hooks/useAsistenciaAlerts"
import { useOperacionesDiaAlerts } from "@/hooks/useOperacionesDiaAlerts"
import { useConteoCiclicoAlerts } from "@/hooks/useConteoCiclicoAlerts"
import { useAjustesInventarioAlerts } from "@/hooks/useAjustesInventarioAlerts"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function TopBar() {
  const { 
    profile, 
    signOut, 
    loading,
    accessibleEmpresas,
    selectedEmpresaId,
    selectedEmpresaNombre,
    setSelectedEmpresaId,
    loadingEmpresas,
  } = useAuth()
  const router = useRouter()
  const unreadCount = useUnreadMessages(profile?.id)
  const { pendingSolicitudes, count: pendingTurnosCount } = usePendingTurnos(selectedEmpresaId)
  const { alerts: preoperacionalAlerts, count: preoperacionalAlertCount, hasPermission: hasPrechequeoPermission } = usePreoperacionalAlerts(selectedEmpresaId, profile?.id)
  const { alerts: rendimientoAlerts, count: rendimientoAlertCount, hasPermission: hasDashboardOperacionPermission } = useRendimientoAlerts(selectedEmpresaId, profile?.id)
  const { alerts: facturasAlerts, count: facturasAlertCount, hasPermission: hasGestionFacturasPermission } = useFacturasAlerts(selectedEmpresaId, profile?.id)
  const { alerts: cicloFacturacionAlerts, count: cicloFacturacionAlertCount, hasPermission: hasCicloFacturacionPermission } = useCicloFacturacionAlerts()
  const { alerts: inventarioAlerts, count: inventarioAlertCount, hasPermission: hasSaldosProductoPermission } = useInventarioAlerts(selectedEmpresaId, profile?.id)
  const { alerts: evaluacionesAlerts, count: evaluacionesAlertCount, hasPermission: hasEvaluacionesPermission } = useEvaluacionesAlerts(selectedEmpresaId, profile?.id)
  // Alertas de Asistencia (tabla del dia) y Operaciones del Dia.
  // Reusan el patron de los hooks anteriores: validan permiso por
  // usuario y refrescan cada 2 minutos.
  const {
    pendientes: asistenciaPendientes,
    sinSalida: asistenciaSinSalida,
    pendientesCount: asistenciaPendientesCount,
    sinSalidaCount: asistenciaSinSalidaCount,
    hasPermission: hasTablaAsistenciaPermission,
  } = useAsistenciaAlerts(selectedEmpresaId, profile?.id)
  const {
    alerts: operacionesDiaAlerts,
    count: operacionesDiaAlertCount,
    hasPermission: hasOperacionesDiaPermission,
  } = useOperacionesDiaAlerts(selectedEmpresaId, profile?.id)
  const {
    alerts: conteoCiclicoAlerts,
    count: conteoCiclicoAlertCount,
    hasPermission: hasConteoCiclicoPermission,
  } = useConteoCiclicoAlerts(selectedEmpresaId, profile?.id)
  const {
    alerts: ajustesInventarioAlerts,
    count: ajustesInventarioAlertCount,
    hasPermission: hasAjustesInventarioPermission,
  } = useAjustesInventarioAlerts(selectedEmpresaId, profile?.id)
  const [turnosOpen, setTurnosOpen] = useState(false)
  const [prechequeoOpen, setPrechequeoOpen] = useState(false)
  const [rendimientoOpen, setRendimientoOpen] = useState(false)
  const [facturasOpen, setFacturasOpen] = useState(false)
  const [cicloFacturacionOpen, setCicloFacturacionOpen] = useState(false)
  const [inventarioOpen, setInventarioOpen] = useState(false)
  const [evaluacionesOpen, setEvaluacionesOpen] = useState(false)
  const [asistenciaPendientesOpen, setAsistenciaPendientesOpen] = useState(false)
  const [asistenciaSinSalidaOpen, setAsistenciaSinSalidaOpen] = useState(false)
  const [operacionesDiaOpen, setOperacionesDiaOpen] = useState(false)
  const [conteoCiclicoOpen, setConteoCiclicoOpen] = useState(false)
  const [ajustesInventarioOpen, setAjustesInventarioOpen] = useState(false)

  const hasTurnosAlerts = pendingTurnosCount > 0
  const hasPrechequeoAlerts = hasPrechequeoPermission && preoperacionalAlertCount > 0
  const hasRendimientoAlerts = hasDashboardOperacionPermission && rendimientoAlertCount > 0
  const hasFacturasAlerts = hasGestionFacturasPermission && facturasAlertCount > 0
  const hasCicloFacturacionAlerts = hasCicloFacturacionPermission && cicloFacturacionAlertCount > 0
  const hasInventarioAlerts = hasSaldosProductoPermission && inventarioAlertCount > 0
  const hasEvaluacionesAlerts = hasEvaluacionesPermission && evaluacionesAlertCount > 0
  const hasAsistenciaPendientesAlerts =
    hasTablaAsistenciaPermission && asistenciaPendientesCount > 0
  const hasAsistenciaSinSalidaAlerts =
    hasTablaAsistenciaPermission && asistenciaSinSalidaCount > 0
  const hasOperacionesDiaAlerts =
    hasOperacionesDiaPermission && operacionesDiaAlertCount > 0
  const hasConteoCiclicoAlerts = hasConteoCiclicoPermission && conteoCiclicoAlertCount > 0
  const hasAjustesInventarioAlerts = hasAjustesInventarioPermission && ajustesInventarioAlertCount > 0
  const ajustesPendientesCount = ajustesInventarioAlerts.filter((a) => a.tipo === "pendiente").length

  const handleEmpresaChange = (value: string) => {
    const newId = parseInt(value, 10)
    setSelectedEmpresaId(newId)
  }

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const handleChatClick = () => {
    router.push("/chat")
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })
  }

  const displayText = loading ? "Cargando..." : profile ? null : "LipGo tecnología que mueve tu logística"

  return (
    <div className="border-b border-border bg-card">
      <div className="container mx-auto px-2 sm:px-6 py-2 sm:py-4 max-w-7xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
            <ColombiaClock />
            <span className="text-[10px] sm:text-sm text-muted-foreground">·</span>
            {profile ? (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Empresa Selector */}
                {accessibleEmpresas.length > 1 ? (
                  <div className="flex items-center gap-1">
                    <Building2 className="h-3 w-3 sm:h-4 sm:w-4 text-primary" />
                    <Select
                      value={selectedEmpresaId?.toString() || ""}
                      onValueChange={handleEmpresaChange}
                      disabled={loadingEmpresas}
                    >
                      <SelectTrigger className="h-6 sm:h-7 w-auto min-w-[120px] max-w-[200px] text-[10px] sm:text-xs border-primary/30 bg-primary/5">
                        <SelectValue placeholder="Empresa..." />
                      </SelectTrigger>
                      <SelectContent>
                        {accessibleEmpresas.map((empresa) => (
                          <SelectItem key={empresa.id} value={empresa.id.toString()}>
                            <span className="font-medium">{empresa.id}</span> - {empresa.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <>
                    <span className="text-[10px] sm:text-sm font-bold text-primary">ID: {selectedEmpresaId || profile.empresa_id}</span>
                    <span className="text-[10px] sm:text-sm text-muted-foreground">·</span>
                    <span className="text-[10px] sm:text-sm font-semibold text-foreground">{selectedEmpresaNombre || profile.empresa_nombre}</span>
                  </>
                )}
                <span className="text-[10px] sm:text-sm text-muted-foreground">·</span>
                <span className="text-[10px] sm:text-sm font-medium text-muted-foreground">{profile.usuario}</span>
              </div>
            ) : (
              <span className="text-[10px] sm:text-sm font-medium text-foreground">{displayText}</span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button 
              onClick={handleChatClick}
              className="relative p-1 sm:p-2 rounded-lg hover:bg-accent transition-colors"
              title="Chat"
            >
              <MessageCircle className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-red-500 rounded-full">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {/* Evaluaciones de Desempeno Pendientes - solo si tiene permiso evaluacionpersonal y hay pendientes */}
            {hasEvaluacionesAlerts && (
              <Popover open={evaluacionesOpen} onOpenChange={setEvaluacionesOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-indigo-100 transition-colors"
                    title="Evaluaciones de Desempeno Pendientes"
                  >
                    <ClipboardList className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-indigo-600 rounded-full animate-pulse">
                      {evaluacionesAlertCount > 9 ? "9+" : evaluacionesAlertCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-indigo-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-indigo-700">
                        <ClipboardList className="h-4 w-4" />
                        Evaluaciones Pendientes
                      </h4>
                      <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
                        {evaluacionesAlertCount} pendiente{evaluacionesAlertCount !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <p className="text-xs text-indigo-600 mt-1">Colaboradores sin evaluar o con mas de 30 dias</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <div className="divide-y">
                      {evaluacionesAlerts.map((colaborador) => (
                        <div key={colaborador.id} className="p-3 hover:bg-indigo-50/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-indigo-700 truncate">
                                {colaborador.nombre}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {colaborador.cargo || "Sin cargo"}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0 border-indigo-200 text-indigo-600">
                              {colaborador.dias_desde_ultima !== null
                                ? `${colaborador.dias_desde_ultima} dias`
                                : "Sin evaluar"}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                    {evaluacionesAlertCount > 5 && (
                      <div className="p-3 border-t bg-indigo-50 text-center">
                        <p className="text-xs text-indigo-600">
                          Para ver mas entre a Evaluaciones de Desempeno ({evaluacionesAlertCount - 5} mas)
                        </p>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Ajustes manuales de inventario por código (601/701/702): pendientes de
                aprobación de Gerencia y ejecutados en los últimos 7 días. Nace del
                incidente de Cedi Funza (2026-09-23): un ajuste 702 tapó un Descargue
                duplicado y nadie lo vio. */}
            {hasAjustesInventarioAlerts && (
              <Popover open={ajustesInventarioOpen} onOpenChange={setAjustesInventarioOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-rose-100 transition-colors"
                    title="Ajustes manuales de inventario"
                  >
                    <ShieldAlert className="h-4 w-4 sm:h-5 sm:w-5 text-rose-600" />
                    <span className={`absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white rounded-full ${ajustesPendientesCount > 0 ? "bg-rose-600 animate-pulse" : "bg-rose-400"}`}>
                      {ajustesInventarioAlertCount > 9 ? "9+" : ajustesInventarioAlertCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-rose-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-rose-700">
                        <ShieldAlert className="h-4 w-4" />
                        Ajustes manuales de inventario
                      </h4>
                      <Badge variant="secondary" className="bg-rose-100 text-rose-700">
                        {ajustesPendientesCount > 0
                          ? `${ajustesPendientesCount} por aprobar`
                          : `${ajustesInventarioAlertCount} reciente${ajustesInventarioAlertCount !== 1 ? "s" : ""}`}
                      </Badge>
                    </div>
                    <p className="text-xs text-rose-600 mt-1">
                      Salidas/ingresos por código (601/701/702) pendientes de aprobación o ejecutados en los últimos 7 días — un ajuste manual
                      puede estar tapando un error real (orden duplicada, descargue mal registrado). Se aprueban en Transacciones de Inventario › Por código.
                    </p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <div className="divide-y">
                      {ajustesInventarioAlerts.map((a) => (
                        <div key={`${a.tipo}-${a.id}`} className="p-3 hover:bg-rose-50/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-rose-700">{a.mensaje}</p>
                              {a.motivo && <p className="text-xs text-muted-foreground mt-0.5">Motivo: {a.motivo}</p>}
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0 border-rose-200 text-rose-600">
                              {a.tipo === "pendiente" ? "Por aprobar" : "Ejecutado"}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Conteo Ciclico de Inventario - vencido o con diferencia sin resolver */}
            {hasConteoCiclicoAlerts && (
              <Popover open={conteoCiclicoOpen} onOpenChange={setConteoCiclicoOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-teal-100 transition-colors"
                    title="Conteo Ciclico de Inventario"
                  >
                    <ClipboardCheck className="h-4 w-4 sm:h-5 sm:w-5 text-teal-600" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-teal-600 rounded-full animate-pulse">
                      {conteoCiclicoAlertCount > 9 ? "9+" : conteoCiclicoAlertCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-teal-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-teal-700">
                        <ClipboardCheck className="h-4 w-4" />
                        Conteo Ciclico de Inventario
                      </h4>
                      <Badge variant="secondary" className="bg-teal-100 text-teal-700">
                        {conteoCiclicoAlertCount} pendiente{conteoCiclicoAlertCount !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <p className="text-xs text-teal-600 mt-1">Conteo vencido (7+ dias) o con diferencia sin ajuste aprobado</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <div className="divide-y">
                      {conteoCiclicoAlerts.map((a, index) => (
                        <div key={`${a.tipo}-${a.cuadre_id ?? index}`} className="p-3 hover:bg-teal-50/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-teal-700 flex-1 min-w-0">{a.mensaje}</p>
                            <Badge variant="outline" className="text-xs shrink-0 border-teal-200 text-teal-600">
                              {a.tipo === "vencido" ? "Vencido" : "Diferencia"}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Inventario Stock Reservado Button - only show if user has permission and there are alerts */}
            {hasInventarioAlerts && (
              <Popover open={inventarioOpen} onOpenChange={setInventarioOpen}>
                <PopoverTrigger asChild>
                  <button 
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-purple-100 transition-colors"
                    title="Productos con Stock Reservado"
                  >
                    <Package className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-purple-600 rounded-full animate-pulse">
                      {inventarioAlertCount > 9 ? '9+' : inventarioAlertCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-purple-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-purple-700">
                        <Package className="h-4 w-4" />
                        Stock Reservado
                      </h4>
                      <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                        {inventarioAlertCount} producto{inventarioAlertCount !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <p className="text-xs text-purple-600 mt-1">Productos con inventario reservado</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <div className="divide-y">
                      {inventarioAlerts.map((producto) => (
                        <div key={producto.idproducto} className="p-3 hover:bg-purple-50/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-purple-700 truncate">
                                {producto.nombreproducto}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {producto.categoria} - {producto.subcategoria}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0 border-purple-200 text-purple-600">
                              Res: {producto.stock_res.toLocaleString()}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            <span>Disp: {producto.stock_disp.toLocaleString()}</span>
                            <span>Total: {producto.stock_global.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {inventarioAlertCount > 10 && (
                      <div className="p-3 border-t bg-purple-50 text-center">
                        <p className="text-xs text-purple-600">
                          Para ver mas entre a Saldos por Producto ({inventarioAlertCount - 10} mas)
                        </p>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Facturas Pendientes Button - only show if user has permission and there are alerts */}
            {hasFacturasAlerts && (
              <Popover open={facturasOpen} onOpenChange={setFacturasOpen}>
                <PopoverTrigger asChild>
                  <button 
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-green-100 transition-colors"
                    title="Facturas Pendientes por Procesar"
                  >
                    <DollarSign className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-green-600 rounded-full animate-pulse">
                      {facturasAlertCount > 9 ? '9+' : facturasAlertCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-green-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-green-700">
                        <DollarSign className="h-4 w-4" />
                        Facturas Pendientes
                      </h4>
                      <Badge variant="secondary" className="bg-green-100 text-green-700">
                        {facturasAlertCount} pendiente{facturasAlertCount !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <p className="text-xs text-green-600 mt-1">Ordenes por procesar</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <div className="divide-y">
                      {facturasAlerts.map((factura) => (
                        <div key={factura.id} className="p-3 hover:bg-green-50/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-green-700 truncate">
                                Orden: {factura.ordendecargue}
                              </p>
                              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Truck className="h-3 w-3" />
                                  {factura.placa}
                                </span>
                                <span className="truncate">{factura.transporte}</span>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0 border-green-200 text-green-600">
                              {factura.tipooperacion}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                    {facturasAlertCount > 5 && (
                      <div className="p-3 border-t bg-green-50 text-center">
                        <p className="text-xs text-green-600">
                          Para ver mas entre a Gestion de Facturas ({facturasAlertCount - 5} mas)
                        </p>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Ciclo de Facturación: depende de la SESIÓN (jefe/coordinador), no de la empresa seleccionada. */}
            {hasCicloFacturacionAlerts && (
              <Popover open={cicloFacturacionOpen} onOpenChange={setCicloFacturacionOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-blue-100 transition-colors"
                    title="Pendientes del Ciclo de Facturación"
                  >
                    <ClipboardCheck className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-blue-600 rounded-full animate-pulse">
                      {cicloFacturacionAlertCount > 9 ? "9+" : cicloFacturacionAlertCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-blue-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-blue-700">
                        <ClipboardCheck className="h-4 w-4" />
                        Ciclo de Facturación
                      </h4>
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                        {cicloFacturacionAlertCount} pendiente{cicloFacturacionAlertCount !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <p className="text-xs text-blue-600 mt-1">Te toca actuar</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y">
                    {cicloFacturacionAlerts.map((f) => (
                      <div key={f.id} className="p-3 hover:bg-blue-50/50 transition-colors">
                        <p className="text-sm font-medium text-blue-700 truncate">{f.owner}</p>
                        <p className="text-xs text-muted-foreground truncate">{f.proyecto} · {f.estado_ciclo}</p>
                        {f.motivos?.includes("advertencias") && (
                          <p className="text-xs font-medium text-amber-600 mt-0.5">⚠ Revisar advertencias de generación automática</p>
                        )}
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Rendimiento Alerts Button - only show if user has permission and there are alerts */}
            {hasRendimientoAlerts && (
              <Popover open={rendimientoOpen} onOpenChange={setRendimientoOpen}>
                <PopoverTrigger asChild>
                  <button 
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-amber-100 transition-colors"
                    title="Alertas de Rendimiento - Operaciones lentas"
                  >
                    <Timer className="h-4 w-4 sm:h-5 sm:w-5 text-amber-600" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-amber-600 rounded-full animate-pulse">
                      {rendimientoAlertCount > 9 ? '9+' : rendimientoAlertCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-amber-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-amber-700">
                        <Timer className="h-4 w-4" />
                        Alertas de Rendimiento
                      </h4>
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                        {rendimientoAlertCount} operacion{rendimientoAlertCount !== 1 ? 'es' : ''}
                      </Badge>
                    </div>
                    <p className="text-xs text-amber-600 mt-1">Operaciones En Proceso con mas de 2 horas</p>
                  </div>
                  <ScrollArea className="max-h-72">
                    <div className="divide-y">
                      {rendimientoAlerts.map((alert, index) => (
                        <div key={`${alert.ordendecargue}-${index}`} className="p-3 hover:bg-amber-50/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-amber-700 truncate">
                                Orden: {alert.ordendecargue}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {alert.cliente}
                              </p>
                              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Truck className="h-3 w-3" />
                                  {alert.placa}
                                </span>
                                <span>{alert.tipooperacion}</span>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0 border-amber-300 text-amber-700 bg-amber-50">
                              <Clock className="h-3 w-3 mr-1" />
                              {alert.tiempo_en_proceso}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            )}

            {/* Prechequeo Alerts Button - only show if user has permission and there are alerts */}
            {hasPrechequeoAlerts && (
              <Popover open={prechequeoOpen} onOpenChange={setPrechequeoOpen}>
                <PopoverTrigger asChild>
                  <button 
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-red-100 transition-colors"
                    title="Alertas de Incumplimiento Prechequeo"
                  >
                    <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-red-500" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-red-600 rounded-full animate-pulse">
                      {preoperacionalAlertCount > 9 ? '9+' : preoperacionalAlertCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-red-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-red-700">
                        <AlertTriangle className="h-4 w-4" />
                        Alertas de Incumplimiento
                      </h4>
                      <Badge variant="secondary" className="bg-red-100 text-red-700">
                        {preoperacionalAlertCount} alerta{preoperacionalAlertCount !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <p className="text-xs text-red-600 mt-1">Ultimos 8 dias - Registro Preoperacional</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <div className="divide-y">
                      {preoperacionalAlerts.map((alert, index) => (
                        <div key={`${alert.id}-${alert.campo}-${index}`} className="p-3 hover:bg-red-50/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-red-700 truncate">{alert.campo_label}</p>
                              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Truck className="h-3 w-3" />
                                  {alert.placa}
                                </span>
                                <span className="truncate">Op: {alert.nombre_operador}</span>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0 border-red-200 text-red-600">
                              {new Date(alert.fecha).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Turnos Pendientes Button - only show if there are pending turnos */}
            {hasTurnosAlerts && (
              <Popover open={turnosOpen} onOpenChange={setTurnosOpen}>
                <PopoverTrigger asChild>
                  <button 
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-orange-100 transition-colors"
                    title="Solicitudes de Turnos Pendientes"
                  >
                    <Bell className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-orange-500 rounded-full animate-pulse">
                      {pendingTurnosCount > 9 ? '9+' : pendingTurnosCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="p-3 border-b bg-orange-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-orange-700">
                        <Users className="h-4 w-4" />
                        Turnos Pendientes
                      </h4>
                      <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                        {pendingTurnosCount} pendiente{pendingTurnosCount !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <p className="text-xs text-orange-600 mt-1">Solicitudes por aprobar</p>
                  </div>
                  <ScrollArea className="max-h-72">
                    <div className="divide-y">
                      {pendingSolicitudes.map((solicitud) => (
                        <div key={solicitud.id} className="p-3 hover:bg-orange-50/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{solicitud.puesto}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                Solicitante: {solicitud.nombresolicitante}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0 border-orange-200 text-orange-600">
                              {solicitud.cantidad} turno{solicitud.cantidad !== 1 ? 's' : ''}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(solicitud.fecharequerida)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(solicitud.fechasolicitud)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            )}

            {/* Asistencia Pendientes (Alerta 1): personas activas
                cuya fila del dia no esta procesada en la Tabla
                Asistencia (sin programada, sin registrada y sin
                novedad). */}
            {hasAsistenciaPendientesAlerts && (
              <Popover
                open={asistenciaPendientesOpen}
                onOpenChange={setAsistenciaPendientesOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-amber-100 transition-colors"
                    title="Asistencia: registros pendientes por procesar"
                  >
                    <ClipboardList className="h-4 w-4 sm:h-5 sm:w-5 text-amber-600" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-amber-600 rounded-full animate-pulse">
                      {asistenciaPendientesCount > 9 ? "9+" : asistenciaPendientesCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-amber-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-amber-700">
                        <ClipboardList className="h-4 w-4" />
                        Pendientes por procesar
                      </h4>
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                        {asistenciaPendientesCount} persona{asistenciaPendientesCount !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <p className="text-xs text-amber-600 mt-1">
                      Tabla Asistencia · sin programada, registrada o novedad
                    </p>
                  </div>
                  <ScrollArea className="max-h-72">
                    <div className="divide-y">
                      {asistenciaPendientes.slice(0, 50).map((p) => (
                        <div
                          key={p.identificacion}
                          className="p-3 hover:bg-amber-50/50 transition-colors"
                        >
                          <p className="text-sm font-medium truncate">{p.nombre}</p>
                          <p className="text-xs text-muted-foreground">
                            C.C. {p.identificacion}
                          </p>
                        </div>
                      ))}
                      {asistenciaPendientesCount > 50 && (
                        <div className="p-3 text-xs text-muted-foreground text-center">
                          Y {asistenciaPendientesCount - 50} mas...
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            )}

            {/* Asistencia sin salida (Alerta 2): personas con hora de
                llegada pero sin hora de salida. */}
            {hasAsistenciaSinSalidaAlerts && (
              <Popover
                open={asistenciaSinSalidaOpen}
                onOpenChange={setAsistenciaSinSalidaOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-sky-100 transition-colors"
                    title="Asistencia: con llegada y sin hora de salida"
                  >
                    <ClipboardCheck className="h-4 w-4 sm:h-5 sm:w-5 text-sky-600" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-sky-600 rounded-full animate-pulse">
                      {asistenciaSinSalidaCount > 9 ? "9+" : asistenciaSinSalidaCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-sky-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-sky-700">
                        <ClipboardCheck className="h-4 w-4" />
                        Sin hora de salida
                      </h4>
                      <Badge variant="secondary" className="bg-sky-100 text-sky-700">
                        {asistenciaSinSalidaCount} persona{asistenciaSinSalidaCount !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <p className="text-xs text-sky-600 mt-1">
                      Tienen hora de llegada pero no de salida
                    </p>
                  </div>
                  {/* ScrollArea de Radix necesita una altura concreta
                      en su viewport para activar el scroll interno;
                      con `max-h-*` el contenido se sale del popover
                      cuando hay muchas personas sin salida. Usamos
                      `h-80` para fijar el alto y dejamos que el
                      contenedor padre (`overflow-hidden`) recorte
                      cualquier sobreflujo. */}
                  <ScrollArea className="h-80 overflow-hidden">
                    <div className="divide-y">
                      {asistenciaSinSalida.map((p) => (
                        <div
                          key={p.identificacion}
                          className="p-3 hover:bg-sky-50/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{p.nombre}</p>
                              <p className="text-xs text-muted-foreground">
                                C.C. {p.identificacion}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0 border-sky-200 text-sky-600">
                              <Clock className="h-3 w-3 mr-1" />
                              {p.horaLlegada}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            )}

            {/* Operaciones del Dia sin Ini.Op / Fin.Op (Alerta 3) */}
            {hasOperacionesDiaAlerts && (
              <Popover open={operacionesDiaOpen} onOpenChange={setOperacionesDiaOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="relative p-1 sm:p-2 rounded-lg hover:bg-fuchsia-100 transition-colors"
                    title="Operaciones del Dia sin Ini.Op o Fin.Op"
                  >
                    <Wrench className="h-4 w-4 sm:h-5 sm:w-5 text-fuchsia-600" />
                    <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-fuchsia-600 rounded-full animate-pulse">
                      {operacionesDiaAlertCount > 9 ? "9+" : operacionesDiaAlertCount}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-0" align="end">
                  <div className="p-3 border-b bg-fuchsia-50">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2 text-fuchsia-700">
                        <Wrench className="h-4 w-4" />
                        Operaciones sin Ini.Op / Fin.Op
                      </h4>
                      <Badge variant="secondary" className="bg-fuchsia-100 text-fuchsia-700">
                        {operacionesDiaAlertCount} vehiculo{operacionesDiaAlertCount !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <p className="text-xs text-fuchsia-600 mt-1">
                      Dashboard Operacion · Operaciones del Dia
                    </p>
                  </div>
                  <ScrollArea className="max-h-72">
                    <div className="divide-y">
                      {operacionesDiaAlerts.slice(0, 50).map((op, idx) => (
                        <div
                          key={`${op.ordendecargue}-${idx}`}
                          className="p-3 hover:bg-fuchsia-50/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate flex items-center gap-1">
                                <Truck className="h-3 w-3 text-fuchsia-600" />
                                {op.placa || "Sin placa"}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {op.cliente}
                                {op.ordendecargue ? ` · OC ${op.ordendecargue}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0 border-fuchsia-200 text-fuchsia-600">
                              {op.motivo}
                            </Badge>
                          </div>
                        </div>
                      ))}
                      {operacionesDiaAlertCount > 50 && (
                        <div className="p-3 text-xs text-muted-foreground text-center">
                          Y {operacionesDiaAlertCount - 50} mas...
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="h-7 w-7 sm:h-9 sm:w-9 cursor-pointer border-2 border-border hover:border-primary transition-colors">
                  <AvatarFallback className="bg-muted">
                    <User className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-base">Información de Sesión</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {profile ? (
                  <div className="px-3 py-3 space-y-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground font-medium">ID de Empresa</div>
                      <div className="text-lg font-bold text-primary">{profile.empresa_id}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground font-medium">Empresa</div>
                      <div className="text-base font-semibold text-foreground">{profile.empresa_nombre}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground font-medium">Usuario</div>
                      <div className="text-base font-medium text-foreground">{profile.usuario}</div>
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {loading ? "Cargando información de sesión..." : "No hay sesión activa"}
                  </div>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar Sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}
