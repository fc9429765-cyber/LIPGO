"use client"

import { useState, useEffect } from "react"
import {
  getAllOrders,
  deleteOrder,
  approveOrder,
  getEstadosFilter,
  getClientesFilter,
  getVendedoresFilter,
  getDestinosFilter,
  annulOrder,
  closePendingOrder,
  verifyCarteraPassword,
  approveCartera,
} from "@/lib/orders-actions"
import { PERIODOS_LISTADO, PERIODO_LISTADO_DEFECTO, desdeDePeriodo, type PeriodoListado } from "@/lib/periodo-listados"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Loader2,
  Pencil,
  Trash2,
  CheckCircle,
  RefreshCw,
  Plus,
  ArrowLeft,
  FileDown,
  MoreHorizontal,
  EyeOff,
  XCircle,
  FileTextIcon,
  Eye,
  Check,
  ChevronsUpDown,
} from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import OrderEntryForm from "../order-entry-form"
import { getOwners } from "@/lib/actions"

interface Order {
  idpedido: number
  pedido: string
  fecha: string
  cliente: string
  vendedor: string
  destino: string
  aprobado: string
  direccion: string
  condicion_pago: string
  total_pagar: number
  ocargue: string
  pdfpedido: string | null
  orden_de_compra?: string | null
  estado?: string | null
  fecha_programada?: string | null
  total_linea?: number | null
  descuentoiva?: number | null
  descuentopp?: number | null
  observaciones?: string | null
  empresa?: string | null
  bodega?: string | null
  tipodespacho?: string | null
  npedido?: string | null
  id_empresa?: number
  empresafactura?: string | null
  revisioncartera?: string | null
  revisiongerencia?: string | null
}

interface ProductLine {
  id: string
  transid?: number
  categoria: string
  producto: string
  cantidad: number
  precioUnitario: number
  totalLinea: number
  descuentoIVA: number
  descuentoPP: number
  subtotal: number
  peso?: number
}

export function ComprehensiveOrdersManagement() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [aprobadoFilter, setAprobadoFilter] = useState<string>("todos")
  const [clienteFilter, setClienteFilter] = useState<string>("todos")
  const [vendedorFilter, setVendedorFilter] = useState<string>("todos")
  const [destinoFilter, setDestinoFilter] = useState<string>("todos")
  const [estadoFilter, setEstadoFilter] = useState<string>("todos")
  const [ownerFilter, setOwnerFilter] = useState<string>("todos")
  // Periodo que se CARGA del servidor (ver lib/periodo-listados.ts). Los demás
  // filtros, incluidos los de fecha, aplican en memoria dentro de este periodo.
  const [periodo, setPeriodo] = useState<PeriodoListado>(PERIODO_LISTADO_DEFECTO)
  const [fechaDesde, setFechaDesde] = useState<string>("")
  const [fechaHasta, setFechaHasta] = useState<string>("")
  const [openClienteCombobox, setOpenClienteCombobox] = useState(false)

  const [clientes, setClientes] = useState<string[]>([])
  const [clientesMap, setClientesMap] = useState<Map<string, number>>(new Map())
  const [vendedores, setVendedores] = useState<string[]>([])
  const [destinos, setDestinos] = useState<string[]>([])
  const [estados, setEstados] = useState<string[]>([])
  const [owners, setOwners] = useState<string[]>([])

  const [deletingOrder, setDeletingOrder] = useState<number | null>(null)
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false)
  const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false)
  const [approvingOrder, setApprovingOrder] = useState<number | null>(null)
  const [approvalCode, setApprovalCode] = useState("")
  const [isApproving, setIsApproving] = useState(false)
  const [showApprovalPassword, setShowApprovalPassword] = useState(false)
  const [approvalError, setApprovalError] = useState("")

  const [annullingOrder, setAnnullingOrder] = useState<number | null>(null)
  const [isAnnulDialogOpen, setIsAnnulDialogOpen] = useState(false)
  const [annulPassword, setAnnulPassword] = useState("")
  const [showAnnulPassword, setShowAnnulPassword] = useState(false)
  const [annulObservaciones, setAnnulObservaciones] = useState("")

  const [closePendingOrderId, setClosePendingOrderId] = useState<number | null>(null)
  const [closePendingPassword, setClosePendingPassword] = useState("")
  const [showClosePendingPassword, setShowClosePendingPassword] = useState(false)
  const [closePendingObservaciones, setClosePendingObservaciones] = useState("")

  const [approvingCartera, setApprovingCartera] = useState<number | null>(null)
  const [carteraPassword, setCarteraPassword] = useState("")
  const [loadingCartera, setLoadingCartera] = useState(false)

  const [currentView, setCurrentView] = useState<"management" | "entry">("management")
  const [editOrderId, setEditOrderId] = useState<number | undefined>(undefined)

  const loadOrders = async () => {
    setLoading(true)
    const result = await getAllOrders({ desde: desdeDePeriodo(periodo) })
    if (result.success) {
      setOrders(result.data || [])
    } else {
      toast({
        title: "Error",
        description: "No se pudieron cargar los pedidos.",
        variant: "destructive",
      })
    }
    setLoading(false)
  }

  const loadFilterOptions = async () => {
    const [clientesResult, vendedoresResult, destinosResult, estadosResult, ownersResult] = await Promise.all([
      getClientesFilter(),
      getVendedoresFilter(),
      getDestinosFilter(),
      getEstadosFilter(),
      getOwners(),
    ])

    if (clientesResult.success && clientesResult.data) {
      // Remove duplicate names using Set
      const uniqueClienteNames = Array.from(new Set(clientesResult.data.map((c: any) => c.nombre)))
      setClientes(uniqueClienteNames)
      if (clientesResult.clientesMap) {
        setClientesMap(clientesResult.clientesMap)
      }
    }

    if (vendedoresResult.success && vendedoresResult.data) {
      // Remove duplicate names using Set
      const uniqueVendedorNames = Array.from(new Set(vendedoresResult.data as string[]))
      setVendedores(uniqueVendedorNames)
    }

    if (destinosResult.success && destinosResult.data) {
      setDestinos(destinosResult.data as string[])
    }

    if (estadosResult.success && estadosResult.data) {
      setEstados(estadosResult.data.filter(Boolean) as string[])
    }

    if (ownersResult) {
      setOwners(ownersResult.map((owner) => owner.nombre))
    }
  }

  useEffect(() => {
    loadOrders()
    loadFilterOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo])

  const handleEdit = (order: Order) => {
    // Bloquear edicion si el pedido ya fue aprobado.
    if (order.aprobado?.toLowerCase() === "si") {
      toast({
        title: "No permitido",
        description: "No se puede editar un pedido que ya está aprobado.",
        variant: "destructive",
      })
      return
    }
    // Bloquear edicion si el pedido ya fue revisado por cartera.
    // `revisioncartera` guarda el nombre de quien reviso: cualquier
    // valor no vacio indica que ya tiene revision de cartera.
    if (order.revisioncartera && order.revisioncartera.trim() !== "") {
      toast({
        title: "No permitido",
        description: "No se puede editar un pedido que ya tiene revisión de cartera.",
        variant: "destructive",
      })
      return
    }
    setEditOrderId(order.idpedido)
    setCurrentView("entry")
  }

  const handleDeleteClick = (idpedido: number, ocargue: string, aprobado: string) => {
    if (aprobado === "Si") {
      toast({
        title: "No permitido",
        description: "No se puede eliminar un pedido que ya está aprobado.",
        variant: "destructive",
      })
      return
    }

    if (ocargue && ocargue.trim() !== "") {
      toast({
        title: "No permitido",
        description: "No se puede eliminar un pedido con O.Cargue asignada.",
        variant: "destructive",
      })
      return
    }
    setDeletingOrder(idpedido)
    setIsDeleteAlertOpen(true)
  }

  const handleDelete = async () => {
    if (!deletingOrder) return

    const result = await deleteOrder(deletingOrder)
    if (result.success) {
      toast({
        title: "Éxito",
        description: "Pedido eliminado correctamente.",
      })
      loadOrders()
    } else {
      toast({
        title: "Error",
        description: "No se pudo eliminar el pedido.",
        variant: "destructive",
      })
    }
    setIsDeleteAlertOpen(false)
    setDeletingOrder(null)
  }

  const handleApproveClick = (idpedido: number, aprobado: string) => {
    if (aprobado === "Si") {
      toast({
        title: "Ya aprobado",
        description: "Este pedido ya está aprobado.",
        variant: "destructive",
      })
      return
    }

    setApprovingOrder(idpedido)
    setApprovalCode("")
    setApprovalError("")
    setShowApprovalPassword(false)
    setIsApprovalDialogOpen(true)
  }

  const confirmApproval = async () => {
    if (!approvingOrder || !approvalCode) return

    setIsApproving(true)
    setApprovalError("")
    const result = await approveOrder(approvingOrder, approvalCode)
    setIsApproving(false)

    if (result.success) {
      toast({
        title: "Éxito",
        description: result.message || "Pedido aprobado correctamente.",
      })
      setIsApprovalDialogOpen(false)
      setApprovingOrder(null)
      setApprovalCode("")
      setApprovalError("")
      setShowApprovalPassword(false)
      loadOrders()
    } else {
      setApprovalError(result.message || "Clave incorrecta")
    }
  }

  const handleApproveCaterClick = (idpedido: number) => {
    setApprovingCartera(idpedido)
    setCarteraPassword("")
  }

  const handleCarteraApprovalSubmit = async () => {
    if (!carteraPassword.trim()) {
      toast({
        title: "Error",
        description: "Por favor ingrese la contraseña",
        variant: "destructive",
      })
      return
    }

    setLoadingCartera(true)
    try {
      // Verify the password
      const verifyResult = await verifyCarteraPassword(carteraPassword, approvingCartera)

      if (!verifyResult.success) {
        toast({
          title: "Error",
          description: verifyResult.message,
          variant: "destructive",
        })
        setLoadingCartera(false)
        return
      }

      // If password is valid, approve the cartera
      const approveResult = await approveCartera(approvingCartera!, verifyResult.nombre!)

      if (approveResult.success) {
        toast({
          title: "Éxito",
          description: "Aprobación de cartera registrada exitosamente",
        })
        setApprovingCartera(null)
        setCarteraPassword("")
        loadOrders()
      } else {
        toast({
          title: "Error",
          description: approveResult.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("[v0] Error in cartera approval:", error)
      toast({
        title: "Error",
        description: "Error al procesar la aprobación",
        variant: "destructive",
      })
    } finally {
      setLoadingCartera(false)
    }
  }

  const handleAnnulClick = (order: Order) => {
    if (order.aprobado?.toLowerCase() !== "si") {
      toast({
        title: "No permitido",
        description: "Solo se pueden anular pedidos aprobados.",
        variant: "destructive",
      })
      return
    }

    if (order.ocargue && order.ocargue.trim() !== "") {
      toast({
        title: "No permitido",
        description: "No se puede anular un pedido con O.Cargue asignada.",
        variant: "destructive",
      })
      return
    }

    setAnnullingOrder(order.idpedido)
    setAnnulPassword("")
    setShowAnnulPassword(false)
    setAnnulObservaciones("")
    setIsAnnulDialogOpen(true)
  }

  const handleAnnulConfirm = async () => {
    if (!annullingOrder) return

    const result = await annulOrder(annullingOrder, annulPassword, annulObservaciones)

    if (result.success) {
      toast({
        title: "Éxito",
        description: result.message || "Pedido anulado exitosamente",
      })
      setIsAnnulDialogOpen(false)
      setAnnullingOrder(null)
      setAnnulPassword("")
      setShowAnnulPassword(false)
      setAnnulObservaciones("")
      await loadOrders()
    } else {
      toast({
        title: "Error",
        description: result.message || "No se pudo anular el pedido",
        variant: "destructive",
      })
    }
  }

  const handleClosePendingClick = (order: Order) => {
    setClosePendingOrderId(order.idpedido)
    setClosePendingPassword("")
    setShowClosePendingPassword(false)
    setClosePendingObservaciones("")
  }

  const handleClosePendingConfirm = async () => {
    if (!closePendingOrderId) return

    try {
      const result = await closePendingOrder(closePendingOrderId, closePendingPassword, closePendingObservaciones)

      if (result.success) {
        toast({
          title: "Éxito",
          description: result.message,
        })
        setClosePendingOrderId(null)
        setClosePendingPassword("")
        setClosePendingObservaciones("")
        await loadOrders()
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Error inesperado al cerrar el pedido",
        variant: "destructive",
      })
    }
  }

  const handleDownloadPDF = async (order: Order) => {
    if (order.pdfpedido) {
      window.open(order.pdfpedido, "_blank")
    } else {
      toast({
        title: "No disponible",
        description: "Este pedido no tiene PDF generado.",
        variant: "destructive",
      })
    }
  }

  const handleExportExcel = async () => {
    const XLSX = await import("xlsx")
    const wsData = orders
      .filter((order) => {
        // 'aprobado' se guarda en minúscula ('si') o null; el filtro compara normalizado
        // (antes las opciones eran 'Si'/'No' y nunca coincidían -> tabla/Excel en 0).
        const matchAprobado =
          aprobadoFilter === "todos" ||
          (aprobadoFilter === "si") === ((order.aprobado || "").toLowerCase() === "si")
        const matchCliente = clienteFilter === "todos" || order.cliente === clienteFilter
        const matchVendedor = vendedorFilter === "todos" || order.vendedor === vendedorFilter
        const matchDestino = destinoFilter === "todos" || order.destino === destinoFilter
        const matchEstado = estadoFilter === "todos" || order.estado === estadoFilter
        const matchOwner = ownerFilter === "todos" || order.empresafactura === ownerFilter

        let matchFecha = true
        if (fechaDesde && fechaHasta) {
          const orderDate = new Date(order.fecha)
          const desde = new Date(fechaDesde)
          const hasta = new Date(fechaHasta)
          matchFecha = orderDate >= desde && orderDate <= hasta
        }

        return matchAprobado && matchCliente && matchVendedor && matchDestino && matchEstado && matchOwner && matchFecha
      })
      .map((order) => ({
        "ID Pedido": order.idpedido,
        Pedido: order.pedido,
        "Orden de Compra": order.orden_de_compra || "",
        "O. Cargue": order.ocargue || "",
        Estado: order.estado || "",
        Fecha: order.fecha,
        Cliente: order.cliente,
        Vendedor: order.vendedor,
        Destino: order.destino,
        Dirección: order.direccion,
        "Condición de Pago": order.condicion_pago,
        "Total a Pagar": order.total_pagar,
        Aprobado: order.aprobado,
        "Rev. Cartera": order.revisioncartera || "",
        "Rev. Gerencia": order.revisiongerencia || "",
        Owner: order.empresafactura || "",
      }))

    const ws = XLSX.utils.json_to_sheet(wsData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Pedidos")
    XLSX.writeFile(wb, `Pedidos_${new Date().toISOString().split("T")[0]}.xlsx`)

    toast({
      title: "Éxito",
      description: "Archivo Excel generado correctamente.",
    })
  }

  const filteredOrders = orders.filter((order) => {
    const matchAprobado = aprobadoFilter === "todos" || order.aprobado === aprobadoFilter
    const matchCliente = clienteFilter === "todos" || order.cliente === clienteFilter
    const matchVendedor = vendedorFilter === "todos" || order.vendedor === vendedorFilter
    const matchDestino = destinoFilter === "todos" || order.destino === destinoFilter
    const matchEstado = estadoFilter === "todos" || order.estado === estadoFilter
    const matchOwner = ownerFilter === "todos" || order.empresafactura === ownerFilter

    let matchFecha = true
    if (fechaDesde && fechaHasta) {
      const orderDate = new Date(order.fecha)
      const desde = new Date(fechaDesde)
      const hasta = new Date(fechaHasta)
      matchFecha = orderDate >= desde && orderDate <= hasta
    }

    return matchAprobado && matchCliente && matchVendedor && matchDestino && matchEstado && matchOwner && matchFecha
  })

  if (currentView === "entry") {
    return (
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCurrentView("management")
            setEditOrderId(undefined)
          }}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver a Gestión
        </Button>
        <OrderEntryForm
          editOrderId={editOrderId}
          onOrderSaved={() => {
            setCurrentView("management")
            setEditOrderId(undefined)
            loadOrders()
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Gestión Integral de Pedidos</CardTitle>
              <CardDescription>Administra todos los pedidos del sistema</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleExportExcel} variant="outline" size="sm">
                <FileDown className="h-4 w-4 mr-2" />
                Exportar Excel
              </Button>
              <Button onClick={loadOrders} disabled={loading} size="sm">
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Actualizar
              </Button>
              <Button onClick={() => setCurrentView("entry")} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Pedido
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
            <div>
              <Label className="text-xs">Periodo</Label>
              <Select value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoListado)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODOS_LISTADO.map((p) => (
                    <SelectItem key={p.valor} value={p.valor}>
                      {p.etiqueta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Aprobado</Label>
              <Select value={aprobadoFilter} onValueChange={setAprobadoFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="si">Si</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Owner</Label>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {owners.map((owner) => (
                    <SelectItem key={owner} value={owner}>
                      {owner}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Cliente</Label>
              <Popover open={openClienteCombobox} onOpenChange={setOpenClienteCombobox}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={openClienteCombobox}
                    className="w-full md:w-[180px] h-8 md:h-10 text-xs md:text-sm justify-between bg-transparent"
                  >
                    {clienteFilter === "todos"
                      ? "Todos"
                      : clientes.find((cliente) => cliente === clienteFilter) || "Todos"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full md:w-[180px] p-0">
                  <Command>
                    <CommandInput placeholder="Buscar cliente..." className="h-9" />
                    <CommandList>
                      <CommandEmpty>No se encontró cliente.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="todos"
                          onSelect={() => {
                            setClienteFilter("todos")
                            setOpenClienteCombobox(false)
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              clienteFilter === "todos" ? "opacity-100" : "opacity-0"
                            )}
                          />
                          Todos
                        </CommandItem>
                        {clientes.map((cliente, index) => (
                          <CommandItem
                            key={`cliente-combobox-${index}-${cliente}`}
                            value={cliente}
                            onSelect={(currentValue) => {
                              setClienteFilter(currentValue === clienteFilter ? "todos" : currentValue)
                              setOpenClienteCombobox(false)
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                clienteFilter === cliente ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {cliente}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label className="text-xs">Vendedor</Label>
              <Select value={vendedorFilter} onValueChange={setVendedorFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {vendedores.map((vendedor) => (
                    <SelectItem key={vendedor} value={vendedor}>
                      {vendedor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Destino</Label>
              <Select value={destinoFilter} onValueChange={setDestinoFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {destinos.map((destino) => (
                    <SelectItem key={destino} value={destino}>
                      {destino}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Estado</Label>
              <Select value={estadoFilter} onValueChange={setEstadoFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {estados.map((estado) => (
                    <SelectItem key={estado} value={estado}>
                      {estado}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Fecha Desde</Label>
              <DatePickerField
                value={fechaDesde}
                onChange={setFechaDesde}
                className="h-8 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs">Fecha Hasta</Label>
              <DatePickerField
                value={fechaHasta}
                onChange={setFechaHasta}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <Separator className="my-4" />

          <div className="border rounded-lg">
            <div className="overflow-x-auto">
              <div className="max-h-[400px] sm:max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-20 bg-background border-b">
                    <TableRow>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">ID Pedido</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Pedido</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Orden de Compra</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">O. Cargue</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Estado</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Fecha</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Cliente</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Vendedor</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Destino</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Empresa Factura</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Condición de Pago</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Total a Pagar</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Aprobado</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Rev. Cartera</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Rev. Gerencia</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Owner</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">PDF</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 border-b">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={18} className="text-center py-8">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto" />
                        </TableCell>
                      </TableRow>
                    ) : filteredOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={18} className="text-center py-8 text-muted-foreground">
                          No se encontraron pedidos
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredOrders.map((order) => (
                        <TableRow key={order.idpedido}>
                          <TableCell className="font-medium">{order.idpedido}</TableCell>
                          <TableCell>
                            {order.pedido ? (
                              order.pedido
                            ) : (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-muted-foreground/30 text-muted-foreground text-sm">
                                -
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {order.orden_de_compra ? (
                              order.orden_de_compra
                            ) : (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-muted-foreground/30 text-muted-foreground text-sm">
                                -
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {order.ocargue ? (
                              order.ocargue
                            ) : (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-muted-foreground/30 text-muted-foreground text-sm">
                                -
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {order.estado && (
                              <Badge variant={order.estado === "Pendiente" ? "secondary" : "default"}>
                                {order.estado}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{new Date(order.fecha + "T00:00:00").toLocaleDateString("es-CO")}</TableCell>
                          <TableCell>{order.cliente}</TableCell>
                          <TableCell>{order.vendedor}</TableCell>
                          <TableCell>{order.destino}</TableCell>
                          <TableCell>
                            {order.empresafactura ? (
                              order.empresafactura
                            ) : (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-muted-foreground/30 text-muted-foreground text-sm">
                                -
                              </span>
                            )}
                          </TableCell>
                          <TableCell>{order.condicion_pago}</TableCell>
                          <TableCell>
                            {new Intl.NumberFormat("es-CO", {
                              style: "currency",
                              currency: "COP",
                              minimumFractionDigits: 0,
                            }).format(order.total_pagar)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={order.aprobado?.toLowerCase() === "si" ? "default" : "secondary"}>
                              {order.aprobado?.toLowerCase() === "si" ? "Sí" : "No"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {order.revisioncartera ? (
                              <span>{order.revisioncartera}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {order.revisiongerencia ? (
                              <span>{order.revisiongerencia}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>{order.empresafactura || "-"}</TableCell>
                          <TableCell>
                            {order.pdfpedido ? (
                              <Button variant="ghost" size="sm" onClick={() => handleDownloadPDF(order)}>
                                <FileTextIcon className="h-4 w-4 text-fuchsia-500" />
                              </Button>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleEdit(order)}
                                  disabled={
                                    order.aprobado?.toLowerCase() === "si" ||
                                    (!!order.revisioncartera && order.revisioncartera.trim() !== "")
                                  }
                                  className={
                                    order.aprobado?.toLowerCase() === "si" ||
                                    (!!order.revisioncartera && order.revisioncartera.trim() !== "")
                                      ? "opacity-50 cursor-not-allowed"
                                      : ""
                                  }
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDeleteClick(order.idpedido, order.ocargue, order.aprobado)}
                                  disabled={order.aprobado?.toLowerCase() === "si"}
                                  className={
                                    order.aprobado?.toLowerCase() === "si" ? "opacity-50 cursor-not-allowed" : ""
                                  }
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Eliminar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleApproveCaterClick(order.idpedido)}
                                  disabled={!!order.revisioncartera && order.revisioncartera.trim() !== ""}
                                  className={`text-xs ${
                                    !!order.revisioncartera && order.revisioncartera.trim() !== ""
                                      ? "opacity-50 cursor-not-allowed"
                                      : ""
                                  }`}
                                >
                                  <CheckCircle className="h-4 w-4 mr-2" />
                                  Aprobar Cartera
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleApproveClick(order.idpedido, order.aprobado)}
                                  disabled={!order.revisioncartera || order.revisioncartera.trim() === ""}
                                  className={`text-xs ${
                                    !order.revisioncartera || order.revisioncartera.trim() === ""
                                      ? "opacity-50 cursor-not-allowed"
                                      : ""
                                  }`}
                                >
                                  <CheckCircle className="h-4 w-4 mr-2" />
                                  Aprobar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleAnnulClick(order)}
                                  disabled={
                                    !!(order.aprobado?.toLowerCase() !== "si" ||
                                    (order.ocargue && order.ocargue.trim() !== ""))
                                  }
                                  className={
                                    order.aprobado?.toLowerCase() !== "si" ||
                                    (order.ocargue && order.ocargue.trim() !== "")
                                      ? "opacity-50 cursor-not-allowed"
                                      : ""
                                  }
                                >
                                  <XCircle className="h-4 w-4 mr-2" />
                                  Anular
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleClosePendingClick(order)}
                                  disabled={order.estado?.toLowerCase() !== "parcial"}
                                  className={
                                    order.estado?.toLowerCase() !== "parcial" ? "opacity-50 cursor-not-allowed" : ""
                                  }
                                >
                                  <CheckCircle className="h-4 w-4 mr-2" />
                                  Cerrar Pendiente
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El pedido será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isApprovalDialogOpen} onOpenChange={setIsApprovalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar Pedido</DialogTitle>
            <DialogDescription>
              Ingrese la contraseña de aprobación para aprobar este pedido. Se validará contra el registro de usuarios autorizados. Una vez aprobado, no se podrá editar ni eliminar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="approval-code">Clave de autorización (gerencia)</Label>
                <AyudaClaveAutorizacion />
              </div>
              <div className="relative">
                <Input
                  id="approval-code"
                  type={showApprovalPassword ? "text" : "password"}
                  value={approvalCode}
                  onChange={(e) => {
                    setApprovalCode(e.target.value)
                    setApprovalError("")
                  }}
                  placeholder="Ingresa el código"
                  className={approvalError ? "border-red-500" : ""}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowApprovalPassword(!showApprovalPassword)}
                >
                  {showApprovalPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {approvalError && <p className="text-sm text-red-500">{approvalError}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsApprovalDialogOpen(false)
                setApprovalCode("")
                setApprovalError("")
                setShowApprovalPassword(false)
              }}
            >
              Cancelar
            </Button>
            <Button onClick={confirmApproval} disabled={isApproving || !approvalCode}>
              {isApproving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Aprobando...
                </>
              ) : (
                "Aprobar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAnnulDialogOpen} onOpenChange={setIsAnnulDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular Pedido</DialogTitle>
            <DialogDescription>
              Ingresa la contraseña de autorización para anular este pedido. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="annul-password">Clave de autorización</Label>
                <AyudaClaveAutorizacion />
              </div>
              <div className="relative">
                <Input
                  id="annul-password"
                  type={showAnnulPassword ? "text" : "password"}
                  value={annulPassword}
                  onChange={(e) => setAnnulPassword(e.target.value)}
                  placeholder="Ingresa la contraseña"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowAnnulPassword(!showAnnulPassword)}
                >
                  {showAnnulPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="annul-observaciones">Observaciones</Label>
              <Textarea
                id="annul-observaciones"
                value={annulObservaciones}
                onChange={(e) => setAnnulObservaciones(e.target.value)}
                placeholder="Ingrese observaciones sobre la anulación"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAnnulDialogOpen(false)
                setAnnulPassword("")
                setShowAnnulPassword(false)
                setAnnulObservaciones("")
              }}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleAnnulConfirm} disabled={!annulPassword}>
              Anular Pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!closePendingOrderId} onOpenChange={(open) => !open && setClosePendingOrderId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar Pedido Pendiente</DialogTitle>
            <DialogDescription>
              Ingresa la contraseña de autorización para cerrar este pedido pendiente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="close-pending-password">Clave de autorización</Label>
                <AyudaClaveAutorizacion />
              </div>
              <div className="relative">
                <Input
                  id="close-pending-password"
                  type={showClosePendingPassword ? "text" : "password"}
                  value={closePendingPassword}
                  onChange={(e) => setClosePendingPassword(e.target.value)}
                  placeholder="Ingresa la contraseña"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowClosePendingPassword(!showClosePendingPassword)}
                >
                  {showClosePendingPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="close-pending-observaciones">Observaciones</Label>
              <Textarea
                id="close-pending-observaciones"
                value={closePendingObservaciones}
                onChange={(e) => setClosePendingObservaciones(e.target.value)}
                placeholder="Ingrese observaciones sobre el cierre"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setClosePendingOrderId(null)
                setClosePendingPassword("")
                setShowClosePendingPassword(false)
                setClosePendingObservaciones("")
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleClosePendingConfirm} disabled={!closePendingPassword}>
              Cerrar Pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cartera Approval Dialog */}
      <Dialog open={!!approvingCartera} onOpenChange={() => setApprovingCartera(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar Cartera</DialogTitle>
            <DialogDescription>
              Ingrese la contraseña de cartera para registrar la aprobación. Esta acción registrará el nombre del usuario autorizado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="cartera-password">Clave de autorización (cartera)</Label>
                <AyudaClaveAutorizacion />
              </div>
              <Input
                id="cartera-password"
                type="password"
                placeholder="Ingrese contraseña"
                value={carteraPassword}
                onChange={(e) => setCarteraPassword(e.target.value)}
                disabled={loadingCartera}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovingCartera(null)} disabled={loadingCartera}>
              Cancelar
            </Button>
            <Button
              onClick={handleCarteraApprovalSubmit}
              disabled={!carteraPassword || loadingCartera}
              className="bg-green-600 hover:bg-green-700"
            >
              {loadingCartera ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aprobando...
                </>
              ) : (
                "Aprobar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
