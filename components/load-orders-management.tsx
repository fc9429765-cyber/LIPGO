"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
// `Table` (componente) se omite intencionalmente: introduce un wrapper
// interno con `overflow-x-auto` que rompe `position: sticky` del thead.
// Ver comentario en el JSX abajo.
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import {
  FileTextIcon,
  MoreVertical,
  ClipboardCheck,
  Truck,
  Scale,
  FileDown,
  Pencil,
  Trash2,
  RefreshCwIcon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getLoadOrders, deleteLoadOrder } from "@/lib/orders-actions"
import { PERIODOS_LISTADO, PERIODO_LISTADO_DEFECTO, desdeDePeriodo, type PeriodoListado } from "@/lib/periodo-listados"
import { getAvailableVehiclesForAssignment, assignVehicleToLoadOrder } from "@/lib/vehicle-actions"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"

interface LoadOrder {
  id: number
  idempresa?: number
  ordendecargue: string
  fechaorden: string
  fechacargue: string
  placa: string
  tipooperacion: string
  pesoorden: number
  horaorden: string
  horasanitario: string | null
  horavehiculo: string | null
  pesajeinicial: number | null
  horalote: string | null // Added horalote field
  iniciocargue: string | null
  fincargue: string | null
  pesajefinal: number | null
  pesovascula: number | null
  tiquetebascula: string | null
  pdfoc: string | null
  // PDF operativo (Picking/Packing). Fallback cuando `pdfoc` quedó vacío: en
  // descargues de CEDI (manuales o automáticos) el PDF real queda aquí, no en
  // `pdfoc` — sin este fallback el botón se ve "en blanco" aunque el
  // documento sí existe.
  doccargue: string | null
  status: string | null
  // Distribución creada a mano (no por la automatización +D) — ver getLoadOrders.
  distribucionManual?: boolean
}

interface EmpresaInfo {
  nombre: string
  nit: string
  direccion: string
  logo: string | null
}

export function LoadOrdersManagement() {
  const [orders, setOrders] = useState<LoadOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<"pendiente" | "finalizada" | "todas">("todas")
  // Periodo que se CARGA del servidor (ver lib/periodo-listados.ts); no aplica a
  // "Pendientes", que siempre trae todas.
  const [periodo, setPeriodo] = useState<PeriodoListado>(PERIODO_LISTADO_DEFECTO)
  const [filteredOrders, setFilteredOrders] = useState<LoadOrder[]>([])
  const [showDateDialog, setShowDateDialog] = useState(false)
  const [editingOrder, setEditingOrder] = useState<LoadOrder | null>(null)
  const [newFechaCargue, setNewFechaCargue] = useState("")
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [assigningOrderId, setAssigningOrderId] = useState<number | null>(null)
  const [availableVehicles, setAvailableVehicles] = useState<any[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState("")
  const [isAssigning, setIsAssigning] = useState(false)
  const [orderToDelete, setOrderToDelete] = useState<LoadOrder | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [empresasMap, setEmpresasMap] = useState<Map<number, EmpresaInfo>>(new Map())
  const [selectedOrderEmpresa, setSelectedOrderEmpresa] = useState<EmpresaInfo | null>(null)
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const [searchOrden, setSearchOrden] = useState("")
  const [filterFechaOrden, setFilterFechaOrden] = useState("")
  const [filterFechaCargue, setFilterFechaCargue] = useState("")
  const [filterTipoOperacion, setFilterTipoOperacion] = useState("")
  const [filterPlaca, setFilterPlaca] = useState("")
  const [filterEmpresa, setFilterEmpresa] = useState("")

  useEffect(() => {
    loadOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, periodo, selectedEmpresaId])

  useEffect(() => {
    applyFilters()
  }, [orders, searchOrden, filterFechaOrden, filterFechaCargue, filterTipoOperacion, filterPlaca, filterEmpresa])

  useEffect(() => {
    loadEmpresasData()
  }, [orders])

  const loadEmpresasData = async () => {
    const empresaIds = [...new Set(orders.map((o) => o.idempresa).filter(Boolean))] as number[]
    if (empresaIds.length === 0) return

    const { getEmpresaById } = await import("@/lib/actions")
    const empresasData = new Map<number, EmpresaInfo>()

    for (const id of empresaIds) {
      const result = await getEmpresaById(id)
      if (result) {
        empresasData.set(id, result as any)
      }
    }

    setEmpresasMap(empresasData)
  }

  const loadOrders = async () => {
    setLoading(true)
    const result = await getLoadOrders(statusFilter, false, selectedEmpresaId, desdeDePeriodo(periodo))

    if (result.success && result.data) {
      setOrders(result.data)
      setFilteredOrders(result.data)
    } else {
      toast({
        title: "Error",
        description: result.message || "Error al cargar órdenes",
        variant: "destructive",
      })
    }
    setLoading(false)
  }

  const handlePrintPDF = (pdfUrl: string | null) => {
    if (!pdfUrl) {
      toast({
        title: "PDF no disponible",
        description: "No hay PDF asociado a esta orden",
        variant: "destructive",
      })
      return
    }

    window.open(pdfUrl, "_blank")
  }

  const handleRegistroSanitario = (order: LoadOrder) => {
    window.dispatchEvent(
      new CustomEvent("navigate-to-sanitary-registry", {
        detail: { vehicleId: order.id },
      }),
    )
  }

  const handleAsignarVehiculo = async (orderId: number) => {
    setAssigningOrderId(orderId)
    setSelectedVehicleId("")

    // Fetch available vehicles
    const result = await getAvailableVehiclesForAssignment(selectedEmpresaId ?? undefined)
    if (result.success && result.data) {
      setAvailableVehicles(result.data)
      setShowAssignDialog(true)
    } else {
      toast({
        title: "Error",
        description: result.error || "Error al cargar vehículos disponibles",
        variant: "destructive",
      })
    }
  }

  const handleBascula = (orderId: number) => {
    window.dispatchEvent(
      new CustomEvent("navigate-to-bascula", {
        detail: { orderId },
      }),
    )
  }

  const handleEditFechaCargue = (order: LoadOrder) => {
    setEditingOrder(order)
    setNewFechaCargue(order.fechacargue)
    setShowDateDialog(true)
  }

  const handleSaveFechaCargue = async () => {
    if (!editingOrder || !newFechaCargue) {
      toast({
        title: "Error",
        description: "Debe seleccionar una fecha válida",
        variant: "destructive",
      })
      return
    }

    const { updateLoadOrder } = await import("@/lib/orders-actions")
    const result = await updateLoadOrder(editingOrder.id, { fechacargue: newFechaCargue })

    if (result.success) {
      toast({
        title: "Fecha actualizada",
        description: "La fecha de cargue ha sido actualizada exitosamente",
      })
      setShowDateDialog(false)
      setEditingOrder(null)
      setNewFechaCargue("")
      loadOrders() // Reload orders to show updated data
    } else {
      toast({
        title: "Error",
        description: result.message || "Error al actualizar la fecha de cargue",
        variant: "destructive",
      })
    }
  }

  const handleExportToExcel = async () => {
    const XLSX = await import("xlsx")
    if (filteredOrders.length === 0) {
      toast({
        title: "No hay datos",
        description: "No hay órdenes para exportar",
        variant: "destructive",
      })
      return
    }

    const exportData = filteredOrders.map((order) => ({
      Orden: order.ordendecargue,
      "Fecha Orden": formatDate(order.fechaorden),
      "Fecha Cargue": formatDate(order.fechacargue),
      Placa: order.placa,
      "Tipo Operación": order.tipooperacion,
      "Peso Orden": order.pesoorden,
      "Hora Orden": formatTime(order.horaorden),
      "Hora Sanitario": formatTime(order.horasanitario),
      "Hora Vehículo": formatTime(order.horavehiculo),
      "Pesaje Inicial": order.pesajeinicial || "",
      "Asignación Lote": formatTime(order.horalote), // Added horalote to Excel export
      "Inicio Cargue": formatTime(order.iniciocargue),
      "Fin Cargue": formatTime(order.fincargue),
      "Pesaje Final": order.pesajefinal || "",
      "Peso Báscula": order.pesovascula || "",
      "Tiquete Báscula": order.tiquetebascula || "",
      Empresa: (order.idempresa && empresasMap.get(order.idempresa)?.nombre) || "N/A",
    }))

    const worksheet = XLSX.utils.json_to_sheet(exportData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ordenes de Cargue")

    const today = new Date().toISOString().split("T")[0]
    XLSX.writeFile(workbook, `ordenes_cargue_${today}.xlsx`)

    toast({
      title: "Exportación exitosa",
      description: "Las órdenes han sido exportadas a Excel",
    })
  }

  const handleConfirmVehicleAssignment = async () => {
    if (!assigningOrderId || !selectedVehicleId) {
      toast({
        title: "Error",
        description: "Debe seleccionar un vehículo",
        variant: "destructive",
      })
      return
    }

    setIsAssigning(true)
    const result = await assignVehicleToLoadOrder(assigningOrderId, Number.parseInt(selectedVehicleId))

    if (result.success) {
      toast({
        title: "Vehículo asignado",
        description: (result as any).distribucionOrderCode
          ? `Vehículo asignado. Se generó la orden de distribución ${(result as any).distribucionOrderCode}.`
          : "El vehículo ha sido asignado exitosamente a la orden",
      })
      setShowAssignDialog(false)
      setAssigningOrderId(null)
      setSelectedVehicleId("")
      loadOrders() // Reload orders to show updated data
    } else {
      toast({
        title: "Error",
        description: result.error || "Error al asignar vehículo",
        variant: "destructive",
      })
    }
    setIsAssigning(false)
  }

  const handleDeleteOrder = (order: LoadOrder) => {
    setOrderToDelete(order)
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = async () => {
    if (!orderToDelete) return

    // Doble validacion: aunque el item del menu se deshabilita
    // visualmente cuando la orden ya tiene Asignacion Lote
    // (`horalote`) o cargue finalizado (`fincargue`), reforzamos
    // aqui para bloquear cualquier disparo externo (ej. shortcut,
    // automatizacion) que pudiera saltarse el `disabled` del UI.
    if (orderToDelete.horalote) {
      toast({
        title: "No se puede eliminar",
        description:
          "La orden tiene Asignación Lote. Elimine primero la asignación para poder borrarla.",
        variant: "destructive",
      })
      setShowDeleteDialog(false)
      setOrderToDelete(null)
      return
    }
    if (orderToDelete.fincargue) {
      toast({
        title: "No se puede eliminar",
        description: "La orden ya finalizó cargue.",
        variant: "destructive",
      })
      setShowDeleteDialog(false)
      setOrderToDelete(null)
      return
    }

    setIsAssigning(true)
    const result = await deleteLoadOrder(orderToDelete.id)

    if (result.success) {
      toast({
        title: "Orden eliminada",
        description: result.message || "La orden de cargue ha sido eliminada exitosamente",
      })
      setShowDeleteDialog(false)
      setOrderToDelete(null)
      loadOrders() // Reload orders to reflect changes
    } else {
      toast({
        title: "Error",
        description: result.message || "Error al eliminar la orden de cargue",
        variant: "destructive",
      })
    }
    setIsAssigning(false)
  }

  const formatDate = (date: string | null) => {
    if (!date) return "-"
    // Split the date string and create a Date object in local timezone
    const [year, month, day] = date.split("T")[0].split("-")
    const localDate = new Date(Number(year), Number(month) - 1, Number(day))
    return localDate.toLocaleDateString("es-CO")
  }

  const formatTime = (time: string | null) => {
    if (!time) return "-"
    return time
  }

  const formatNumber = (num: number | null) => {
    if (num === null || num === undefined) return "-"
    return num.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const applyFilters = () => {
    let filtered = [...orders]

    // Search by order number
    if (searchOrden.trim()) {
      filtered = filtered.filter((order) => order.ordendecargue.toLowerCase().includes(searchOrden.toLowerCase()))
    }

    // Filter by Fecha Orden
    if (filterFechaOrden) {
      filtered = filtered.filter((order) => {
        if (!order.fechaorden) return false
        const orderDate = order.fechaorden.split("T")[0]
        return orderDate === filterFechaOrden
      })
    }

    // Filter by Fecha Cargue
    if (filterFechaCargue) {
      filtered = filtered.filter((order) => {
        if (!order.fechacargue) return false
        const cargueDate = order.fechacargue.split("T")[0]
        return cargueDate === filterFechaCargue
      })
    }

    // Filter by Tipo Operación
    if (filterTipoOperacion) {
      filtered = filtered.filter((order) => order.tipooperacion === filterTipoOperacion)
    }

    // Filter by Placa
    if (filterPlaca.trim()) {
      filtered = filtered.filter((order) => order.placa.toLowerCase().includes(filterPlaca.toLowerCase()))
    }

    // Filter by Empresa
    if (filterEmpresa) {
      filtered = filtered.filter((order) => {
        if (!order.idempresa) return false
        const empresaNombre = empresasMap.get(order.idempresa)?.nombre || ""
        return empresaNombre.toLowerCase().includes(filterEmpresa.toLowerCase())
      })
    }

    setFilteredOrders(filtered)
  }

  const handleClearFilters = () => {
    setSearchOrden("")
    setFilterFechaOrden("")
    setFilterFechaCargue("")
    setFilterTipoOperacion("")
    setFilterPlaca("")
    setFilterEmpresa("")
  }

  const tipoOperacionOptions = [...new Set(orders.map((o) => o.tipooperacion).filter(Boolean))]

  return (
    <div className="p-2 sm:p-4 space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Gestión de Órdenes de Cargue</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">Administra las órdenes de cargue generadas</p>
        </div>

        {selectedOrderEmpresa && (
          <Card className="p-3 bg-blue-50 border-blue-200">
            <div className="text-sm space-y-1">
              <p className="font-semibold text-blue-900">Empresa: {selectedOrderEmpresa.nombre}</p>
              <p className="text-blue-700">NIT: {selectedOrderEmpresa.nit}</p>
              <p className="text-blue-700">Dirección: {selectedOrderEmpresa.direccion}</p>
            </div>
          </Card>
        )}

        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filtrar por estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="pendiente">Pendientes</SelectItem>
              <SelectItem value="finalizada">Finalizadas</SelectItem>
            </SelectContent>
          </Select>
          {statusFilter !== "pendiente" && (
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoListado)}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Periodo" />
              </SelectTrigger>
              <SelectContent>
                {PERIODOS_LISTADO.map((p) => (
                  <SelectItem key={p.valor} value={p.valor}>
                    {p.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={loadOrders} disabled={loading} variant="outline" className="w-full sm:w-auto bg-transparent">
            <RefreshCwIcon className="h-4 w-4 mr-2" />
            Actualizar
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="text-base sm:text-lg">Ordenes de Cargue</CardTitle>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
              <Button
                onClick={handleExportToExcel}
                variant="outline"
                size="sm"
                className="w-full sm:w-auto text-xs bg-transparent"
              >
                <FileDown className="mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                Exportar a Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 bg-muted/50 rounded-lg">
            <div className="space-y-1.5">
              <Label htmlFor="search-orden" className="text-xs">
                Buscar Orden
              </Label>
              <Input
                id="search-orden"
                placeholder="Buscar por orden..."
                value={searchOrden}
                onChange={(e) => setSearchOrden(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-fecha-orden" className="text-xs">
                Fecha Orden
              </Label>
              <DatePickerField
                id="filter-fecha-orden"
                value={filterFechaOrden}
                onChange={setFilterFechaOrden}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-fecha-cargue" className="text-xs">
                Fecha Cargue
              </Label>
              <DatePickerField
                id="filter-fecha-cargue"
                value={filterFechaCargue}
                onChange={setFilterFechaCargue}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-tipo" className="text-xs">
                Tipo Operación
              </Label>
              <Select value={filterTipoOperacion} onValueChange={setFilterTipoOperacion}>
                <SelectTrigger id="filter-tipo" className="h-8 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">Todos</SelectItem>
                  {tipoOperacionOptions.map((tipo) => (
                    <SelectItem key={tipo} value={tipo}>
                      {tipo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-placa" className="text-xs">
                Placa
              </Label>
              <Input
                id="filter-placa"
                placeholder="Buscar placa..."
                value={filterPlaca}
                onChange={(e) => setFilterPlaca(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-empresa" className="text-xs">
                Empresa
              </Label>
              <Input
                id="filter-empresa"
                placeholder="Buscar empresa..."
                value={filterEmpresa}
                onChange={(e) => setFilterEmpresa(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleClearFilters}
                variant="outline"
                size="sm"
                className="h-8 text-xs w-full bg-transparent"
              >
                Limpiar Filtros
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-xs sm:text-sm">Cargando órdenes...</div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-8 text-xs sm:text-sm text-muted-foreground">
              No hay órdenes de cargue {statusFilter !== "todas" ? statusFilter + "s" : ""} disponibles
            </div>
          ) : (
            // Sticky fix: <Table> de shadcn envuelve la <table> en un div
            // con overflow-x-auto que crea un scroll container al que se
            // ancla `position: sticky` de los <th>, por lo que el thead nunca
            // queda fijo. Solucion: <table> HTML nativo dentro de un unico
            // div que maneja ambos ejes de scroll, con `sticky top-0` movido
            // a cada <TableHead> individual.
            <div className="w-full max-h-[400px] sm:max-h-[600px] overflow-auto rounded-md border relative">
              <table className="w-full caption-bottom text-sm border-separate border-spacing-0">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Orden</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Empresa</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Fecha Orden</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Fecha Cargue</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Placa</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Tipo Operación</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Peso Orden</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Hora Orden</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Hora Sanitario</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Hora Vehículo</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Pesaje Inicial</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Asignación Lote</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Inicio Cargue</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Fin Cargue</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Pesaje Final</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Peso Báscula</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs whitespace-nowrap">Tiquete Báscula</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs text-center whitespace-nowrap">PDF</TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-[10px] sm:text-xs text-center whitespace-nowrap">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => {
                    const esDistribucionManual = order.tipooperacion === "Distribucion" && order.distribucionManual
                    return (
                    <TableRow
                      key={order.id}
                      className={`cursor-pointer ${esDistribucionManual ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50" : "hover:bg-blue-50"}`}
                      onClick={() => {
                        if (order.idempresa) {
                          setSelectedOrderEmpresa(empresasMap.get(order.idempresa) || null)
                        }
                      }}
                    >
                      <TableCell className="font-medium text-[10px] sm:text-xs">{order.ordendecargue}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">
                        {(order.idempresa && empresasMap.get(order.idempresa)?.nombre) || "N/A"}
                      </TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatDate(order.fechaorden)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatDate(order.fechacargue)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{order.placa}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">
                        {order.tipooperacion}
                        {esDistribucionManual && (
                          <span className="ml-1 rounded bg-red-600 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-white">
                            manual
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatNumber(order.pesoorden)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatTime(order.horaorden)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatTime(order.horasanitario)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatTime(order.horavehiculo)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatNumber(order.pesajeinicial)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatTime(order.horalote)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatTime(order.iniciocargue)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatTime(order.fincargue)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatNumber(order.pesajefinal)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{formatNumber(order.pesovascula)}</TableCell>
                      <TableCell className="text-[10px] sm:text-xs">{order.tiquetebascula || "-"}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 sm:h-7 sm:w-7"
                          onClick={() => handlePrintPDF(order.pdfoc || order.doccargue)}
                          disabled={!order.pdfoc && !order.doccargue}
                        >
                          <FileTextIcon className="h-3 w-3 sm:h-4 sm:w-4 text-purple-500" />
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7">
                              <MoreVertical className="h-3 w-3 sm:h-4 sm:w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditFechaCargue(order)} className="text-xs">
                              <Pencil className="mr-2 h-3 w-3" />
                              Editar Fecha Cargue
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleRegistroSanitario(order)}
                              disabled={!order.placa}
                              className="text-xs"
                            >
                              <ClipboardCheck className="mr-2 h-3 w-3" />
                              Registro sanitario
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleAsignarVehiculo(order.id)}
                              disabled={!!order.placa}
                              className="text-xs"
                            >
                              <Truck className="mr-2 h-3 w-3" />
                              Asignar vehículo
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBascula(order.id)} className="text-xs">
                              <Scale className="mr-2 h-3 w-3" />
                              Báscula
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteOrder(order)}
                              disabled={!!order.fincargue || !!order.horalote}
                              className={`text-xs ${!!order.fincargue || !!order.horalote ? "opacity-50 cursor-not-allowed" : ""}`}
                              title={
                                order.horalote
                                  ? "No se puede eliminar: la orden ya tiene Asignación Lote"
                                  : order.fincargue
                                    ? "No se puede eliminar: la orden ya finalizó cargue"
                                    : undefined
                              }
                            >
                              <Trash2 className="mr-2 h-3 w-3" />
                              Eliminar Orden
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )})}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDateDialog} onOpenChange={setShowDateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Fecha de Cargue</DialogTitle>
            <DialogDescription>
              Actualice la fecha de cargue para la orden {editingOrder?.ordendecargue}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nueva-fecha-cargue">Nueva Fecha de Cargue</Label>
              <DatePickerField
                id="nueva-fecha-cargue"
                value={newFechaCargue}
                onChange={setNewFechaCargue}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDateDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveFechaCargue} disabled={!newFechaCargue}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Asignar Vehículo</DialogTitle>
            <DialogDescription>Seleccione un vehículo de la lista de vehículos disponibles</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {availableVehicles.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No hay vehículos disponibles para asignar</div>
            ) : (
              <div className="space-y-2">
                <Label>Vehículos Disponibles</Label>
                <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione un vehículo" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableVehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {vehicle.placa} - {vehicle.nombreconductor}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {vehicle.tipoproducto || "Sin producto"} | Tel: {vehicle.telefono || "N/A"}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmVehicleAssignment} disabled={!selectedVehicleId}>
              Asignar Vehículo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Eliminación</DialogTitle>
            <DialogDescription asChild>
              <div>
                ¿Está seguro que desea eliminar la orden de cargue {orderToDelete?.ordendecargue}?
                <br />
                <br />
                Esta acción eliminará:
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>La cabecera de la orden</li>
                  <li>Todos los detalles asociados</li>
                  <li>Limpiará los campos relacionados en los pedidos asociados</li>
                </ul>
                <br />
                <span className="font-semibold text-destructive">Esta acción no se puede deshacer.</span>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Eliminar Orden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
