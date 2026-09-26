"use client"

import { useState, useEffect } from "react"
import {
  getOrders,
  deleteOrder,
  approveOrder,
  updateOrder,
  updateOrderDetails,
  updateOrderPDFUrl,
  getEstadosFilter,
  getClientesFilter,
  getVendedoresFilter,
  getDestinosFilter,
  annulOrder,
  closePendingOrder,
  closeOrderWithInvoice,
  getOrderDetails,
  verifyCarteraPassword,
  approveCartera,
} from "@/lib/orders-actions"
import {
  getBodegasByCliente, // Import new function
  getEmpresaById, // Import getEmpresaById
} from "@/lib/actions"
import { uploadPDF } from "@/lib/pdf-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Loader2,
  Pencil,
  Trash2,
  CheckCircle,
  FileText,
  RefreshCw,
  Plus,
  ArrowLeft,
  FileDown,
  MoreHorizontal,
  Eye,
  EyeOff,
  XCircle,
  ChevronsUpDown,
  Check,
  Filter,
  RotateCcw,
} from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { OrderDetailsDialog } from "./order-details-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import OrderEntryForm from "./order-entry-form" // Assuming OrderEntryForm is in the same directory
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useAuth } from "@/components/auth-provider"

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
  empresafactura?: string | null
  bodega?: string | null
  tipodespacho?: string | null
  npedido?: string | null
  id_empresa?: number
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

export function OrdersManagement(_props?: { onEditOrder?: (orderId: number) => void }) {
  const { selectedEmpresaId } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  // Filtros "borrador": son los que pintan los Selects/Inputs y se
  // actualizan en cada `onChange`. Pero la tabla NO se filtra con
  // ellos directamente: se filtra con `appliedFilters`, que solo se
  // actualiza al pulsar "Aplicar filtro". Esto permite armar una
  // combinacion de filtros sin que la tabla se redibuje en cada
  // cambio (mejor UX y menos re-renders sobre listas grandes).
  const [aprobadoFilter, setAprobadoFilter] = useState<string>("todos")
  const [clienteFilter, setClienteFilter] = useState<string>("todos")
  const [vendedorFilter, setVendedorFilter] = useState<string>("todos")
  const [destinoFilter, setDestinoFilter] = useState<string>("todos")
  const [estadoFilter, setEstadoFilter] = useState<string>("todos")
  const [fechaDesde, setFechaDesde] = useState<string>("")
  const [fechaHasta, setFechaHasta] = useState<string>("")

  type AppliedFilters = {
    aprobado: string
    cliente: string
    vendedor: string
    destino: string
    estado: string
    fechaDesde: string
    fechaHasta: string
  }
  const DEFAULT_APPLIED: AppliedFilters = {
    aprobado: "todos",
    cliente: "todos",
    vendedor: "todos",
    destino: "todos",
    estado: "todos",
    fechaDesde: "",
    fechaHasta: "",
  }
  const [appliedFilters, setAppliedFilters] =
    useState<AppliedFilters>(DEFAULT_APPLIED)

  const [clientes, setClientes] = useState<string[]>([])
  const [clientesMap, setClientesMap] = useState<Map<string, number>>(new Map())
  const [vendedores, setVendedores] = useState<string[]>([])
  const [destinos, setDestinos] = useState<string[]>([])
  const [estados, setEstados] = useState<string[]>([]) // Changed from 'string[]' to 'string[]' for consistency

  const [selectedOrder, setSelectedOrder] = useState<number | null>(null)
  const [deletingOrder, setDeletingOrder] = useState<number | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false)
  const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false)
  const [approvingOrder, setApprovingOrder] = useState<number | null>(null)
  const [approvalCode, setApprovalCode] = useState("")
  const [approvingCartera, setApprovingCartera] = useState<number | null>(null)
  const [carteraPassword, setCarteraPassword] = useState("")
  const [loadingCartera, setLoadingCartera] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [showApprovalPassword, setShowApprovalPassword] = useState(false)
  const [approvalError, setApprovalError] = useState("")

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  const [editProducts, setEditProducts] = useState<ProductLine[]>([])
  const [editCategorias, setEditCategorias] = useState<{ nombre: string }[]>([])
  const [editAllProductos, setEditAllProductos] = useState<
    { nombre: string; categoria: string; peso_unitkg?: number }[]
  >([])
  const [editCondicionesPago, setEditCondicionesPago] = useState<{ nombrecondicion: string }[]>([])
  const [editTiposDespacho, setEditTiposDespacho] = useState<{ nombretipodespacho: string }[]>([])
  const [editSucursales, setEditSucursales] = useState<
    { nombrebodega: string; direccion: string; ciudad: string; cliente: string }[]
  >([])
  const [editSucursal, setEditSucursal] = useState("")
  const [editAplicarDescuentoIVA, setEditAplicarDescuentoIVA] = useState(false)
  const [editAplicarDescuentoPP, setEditAplicarDescuentoPP] = useState(false)
  const [editDescuentoPPPercent, setEditDescuentoPPPercent] = useState<number | string>("")
  const [editFechaProgramada, setEditFechaProgramada] = useState("")
  const [editDireccion, setEditDireccion] = useState("")
  const [editCondicionPago, setEditCondicionPago] = useState("")
  const [editTipoDespacho, setEditTipoDespacho] = useState("")
  const [editObservaciones, setEditObservaciones] = useState("")
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false)

  const [annullingOrder, setAnnullingOrder] = useState<number | null>(null)
  const [isAnnulDialogOpen, setIsAnnulDialogOpen] = useState(false)
  const [annulPassword, setAnnulPassword] = useState("")
  const [showAnnulPassword, setShowAnnulPassword] = useState(false)
  const [annulObservaciones, setAnnulObservaciones] = useState("")

  const [closePendingOrderId, setClosePendingOrderId] = useState<number | null>(null)
  const [closePendingPassword, setClosePendingPassword] = useState("")
  const [showClosePendingPassword, setShowClosePendingPassword] = useState(false)
  const [closePendingObservaciones, setClosePendingObservaciones] = useState("")

  const [isInvoiceCloseDialogOpen, setIsInvoiceCloseDialogOpen] = useState(false)
  const [invoiceCloseOrderId, setInvoiceCloseOrderId] = useState<number | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [invoiceProducts, setInvoiceProducts] = useState<any[]>([])
  const [invoiceHeader, setInvoiceHeader] = useState<any>(null)
  const [isClosingWithInvoice, setIsClosingWithInvoice] = useState(false)

  const [currentView, setCurrentView] = useState<"management" | "entry">("management")
  const [editOrderId, setEditOrderId] = useState<number | undefined>(undefined)

  const [clienteComboOpen, setClienteComboOpen] = useState(false)

  const loadOrders = async () => {
    setLoading(true)
    const result = await getOrders(selectedEmpresaId)
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
    const [clientesResult, vendedoresResult, destinosResult, estadosResult] = await Promise.all([
      getClientesFilter(),
      getVendedoresFilter(),
      getDestinosFilter(),
      getEstadosFilter(),
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
  }

  useEffect(() => {
    if (selectedEmpresaId) {
      loadOrders()
      loadFilterOptions()
    }
  }, [selectedEmpresaId])

  const handleViewDetails = (idpedido: number) => {
    setSelectedOrder(idpedido)
    setIsDetailsOpen(true)
  }

  const loadSucursalesByCliente = async (clienteNombre: string) => {
    const clienteId = clientesMap.get(clienteNombre)
    if (!clienteId) {
      console.log("[v0] No clienteId found for:", clienteNombre)
      setEditSucursales([])
      return
    }

    console.log("[v0] Loading sucursales for cliente:", clienteNombre, "id:", clienteId)
    const bodegas = await getBodegasByCliente(clienteId)
    setEditSucursales(
      bodegas.map((b) => ({
        nombrebodega: b.nombrebodega,
        direccion: b.direccion,
        ciudad: b.ciudad,
        cliente: clienteNombre,
      })),
    )
  }

  const handleEdit = async (order: Order) => {
    if (order.aprobado === "Si") {
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

    // Switch to order entry form with the order ID
    setCurrentView("entry")
    setEditOrderId(order.idpedido)
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
      setApprovalError("Contraseña errada")
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
      const verifyResult = await verifyCarteraPassword(carteraPassword)

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
    // Validate conditions
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

  // Added handler for annul confirmation
  const handleAnnulConfirm = async () => {
    if (!annullingOrder) return

    console.log("[v0] Confirming annul with password:", annulPassword) // Added debug log

    const result = await annulOrder(annullingOrder, annulPassword, annulObservaciones)

    console.log("[v0] Annul result:", result) // Added debug log

    if (result.success) {
      toast({
        title: "Éxito",
        description: result.message || "Pedido anulado exitosamente",
      })
      setIsAnnulDialogOpen(false)
      setAnnullingOrder(null)
      setAnnulPassword("")
      setShowAnnulPassword(false) // Reset password visibility
      setAnnulObservaciones("")
      await loadOrders()
    } else {
      toast({
        title: "Error",
        description: result.message || "No se pudo anular el pedido", // Improved error handling
        variant: "destructive",
      })
    }
  }

  const handleClosePendingClick = (order: Order) => {
    setClosePendingOrderId(order.idpedido)
    setClosePendingPassword("")
    setShowClosePendingPassword(false)
    setClosePendingObservaciones("")
    // Implicitly open dialog because state is set
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

  const handleInvoiceCloseClick = async (order: Order) => {
    setInvoiceCloseOrderId(order.idpedido)
    setInvoiceNumber("")
    setInvoiceHeader(order)

    // Fetch order details
    const result = await getOrderDetails(order.idpedido)
    if (result.success && result.data) {
      setInvoiceProducts(
        result.data.map((item: any) => ({
          ...item,
          unidadesRecibidas: item.unidades || 0,
        })),
      )
    } else {
      toast({
        title: "Error",
        description: "No se pudieron cargar los detalles del pedido para la facturación.",
        variant: "destructive",
      })
      return // Exit if details can't be loaded
    }

    setIsInvoiceCloseDialogOpen(true)
  }

  const handleInvoiceCloseConfirm = async () => {
    if (!invoiceCloseOrderId || !invoiceNumber) {
      toast({
        title: "Error",
        description: "Debe ingresar el número de factura",
        variant: "destructive",
      })
      return
    }

    setIsClosingWithInvoice(true)

    const unitsReceived = invoiceProducts.map((p) => ({
      transid: p.transid,
      unidadesRecibidas: p.unidadesRecibidas,
    }))

    const result = await closeOrderWithInvoice(invoiceCloseOrderId, invoiceNumber, unitsReceived)

    setIsClosingWithInvoice(false)

    if (result.success) {
      toast({
        title: "Éxito",
        description: result.message,
      })
      setIsInvoiceCloseDialogOpen(false)
      setInvoiceCloseOrderId(null)
      setInvoiceNumber("")
      setInvoiceProducts([])
      setInvoiceHeader(null)
      await loadOrders()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
  }

  const addEditProduct = () => {
    const newProduct: ProductLine = {
      id: Date.now().toString(),
      categoria: "",
      producto: "",
      cantidad: 0,
      precioUnitario: 0,
      totalLinea: 0,
      descuentoIVA: 0,
      descuentoPP: 0,
      subtotal: 0,
    }
    setEditProducts([...editProducts, newProduct])
  }

  const updateEditProductLine = (id: string, field: keyof ProductLine, value: any) => {
    setEditProducts(
      editProducts.map((p) => {
        if (p.id === id) {
          const updated = { ...p, [field]: value }
          if (field === "categoria") {
            updated.producto = ""
          }

          // Calculate base total
          const baseTotal = (updated.cantidad || 0) * (updated.precioUnitario || 0)
          updated.totalLinea = baseTotal

          // Calculate discounts
          const descuentoIVA = editAplicarDescuentoIVA ? baseTotal * 0.05 : 0
          const ppPercent =
            typeof editDescuentoPPPercent === "number" ? editDescuentoPPPercent : Number(editDescuentoPPPercent)
          const descuentoPP = editAplicarDescuentoPP && ppPercent > 0 ? baseTotal * (ppPercent / 100) : 0

          updated.descuentoIVA = descuentoIVA
          updated.descuentoPP = descuentoPP
          updated.subtotal = baseTotal - descuentoIVA - descuentoPP

          return updated
        }
        return p
      }),
    )
  }

  const removeEditProduct = (id: string) => {
    setEditProducts(editProducts.filter((p) => p.id !== id))
  }

  // Recalculate discounts when discount settings change
  useEffect(() => {
    setEditProducts((prevProducts) =>
      prevProducts.map((p) => {
        const baseTotal = (p.cantidad || 0) * (p.precioUnitario || 0)
        const descuentoIVA = editAplicarDescuentoIVA ? baseTotal * 0.05 : 0
        const ppPercent =
          typeof editDescuentoPPPercent === "number" ? editDescuentoPPPercent : Number(editDescuentoPPPercent)
        const descuentoPP = editAplicarDescuentoPP && ppPercent > 0 ? baseTotal * (ppPercent / 100) : 0

        return {
          ...p,
          totalLinea: baseTotal,
          descuentoIVA,
          descuentoPP,
          subtotal: baseTotal - descuentoIVA - descuentoPP,
        }
      }),
    )
  }, [editAplicarDescuentoIVA, editAplicarDescuentoPP, editDescuentoPPPercent])

  const calculateEditTotals = () => {
    const totalOrden = editProducts.reduce((sum, p) => sum + p.totalLinea, 0)
    const descuentoIVATotal = editProducts.reduce((sum, p) => sum + p.descuentoIVA, 0)
    const descuentoPPTotal = editProducts.reduce((sum, p) => sum + p.descuentoPP, 0)
    const totalPagar = totalOrden - descuentoIVATotal - descuentoPPTotal

    return { totalOrden, descuentoIVATotal, descuentoPPTotal, totalPagar }
  }

  const generateEditedOrderPDF = async (order: Order, products: ProductLine[], totals: any) => {
    try {
      console.log("[v0] Generating PDF for order:", order.idpedido)
      console.log("[v0] Order empresa ID:", order.id_empresa)

      const empresaData = await getEmpresaById(order.id_empresa || 1)

      if (!empresaData) {
        console.error("[v0] No empresa found with ID:", order.id_empresa)
        throw new Error("No se encontró la empresa con el ID especificado")
      }

      console.log("[v0] Empresa data retrieved:", empresaData.nombre)

      // Group products by category
      const groupedProducts = products.reduce(
        (acc, product) => {
          const productInfo = editAllProductos.find((p) => p.nombre === product.producto)
          const categoria = productInfo?.categoria || product.categoria || "Sin categoría"

          if (!acc[categoria]) {
            acc[categoria] = []
          }
          acc[categoria].push({
            categoria: categoria,
            referencia: product.producto,
            precioUnitario: product.precioUnitario,
            cantidad: product.cantidad,
            peso: product.peso || 0,
          })
          return acc
        },
        {} as Record<string, any[]>,
      )

      const orderData = {
        nit: empresaData.nit || "N/A",
        carrera: empresaData.direccion || "N/A",
        fechaPedido: new Date().toLocaleDateString("es-CO"),
        nitCliente: "900653385",
        // Use correct fields from order and editSucursal
        sucursalMolinos: editSucursal || order.destino,
        nombreCliente: order.cliente,
        direccionEntrega: editDireccion || order.direccion,
        ciudadEntrega: editDireccion.split(",")[0] || order.destino.split(",")[0] || "", // Assuming destination is "City, Country"
        asesorComercial: order.vendedor,
        fechaEntrega: new Date(editFechaProgramada).toLocaleDateString("es-CO"),
        condicionPago: editCondicionPago,
        tipoDespacho: editTipoDespacho || "N/A",
        groupedProducts: groupedProducts,
        totalOrden: totals.totalOrden,
        descuentoIVA: totals.descuentoIVATotal,
        descuentoPP: totals.descuentoPPTotal,
        totalPagar: totals.totalPagar,
        kgDespacho: products.reduce((sum, p) => sum + (p.peso || 0), 0),
        observaciones: editObservaciones || "",
      }

      const { jsPDF } = await import("jspdf")
      const doc = new jsPDF({ format: "letter" })

      // PDF generation (same as OrderEntryForm)
      doc.setFontSize(14)
      doc.text("ORDEN DE PEDIDO", 105, 15, { align: "center" })
      doc.setFontSize(12)
      doc.text(empresaData.nombre || "N/A", 105, 22, { align: "center" }) // Use dynamic company name
      doc.setFontSize(9)
      doc.text(`NIT: ${orderData.nit}`, 105, 28, { align: "center" })
      doc.text(orderData.carrera, 105, 33, { align: "center" })

      doc.setFontSize(8)
      doc.text("VIT-CM-1", 15, 40)
      doc.text("R: 1.0", 105, 40, { align: "center" })
      doc.text(`Fecha: ${orderData.fechaPedido}`, 195, 40, { align: "right" })

      let y = 50
      doc.setFillColor(44, 82, 130)
      doc.setTextColor(255, 255, 255)
      doc.rect(15, y, 180, 40, "F")

      doc.setFontSize(8)
      doc.text(`Fecha de pedido: ${orderData.fechaPedido}`, 20, y + 5)
      doc.text(`Sucursal : ${orderData.sucursalMolinos}`, 120, y + 5)
      doc.text(`NIT Cliente: ${orderData.nitCliente}`, 20, y + 10)
      doc.text(`Nombre Cliente: ${orderData.nombreCliente}`, 120, y + 10)
      doc.text(`Dirección de entrega: ${orderData.direccionEntrega}`, 20, y + 15)
      doc.text(`Ciudad de entrega: ${orderData.ciudadEntrega}`, 120, y + 15)
      doc.text(`Asesor comercial: ${orderData.asesorComercial}`, 20, y + 20)
      doc.text(`Fecha de entrega: ${orderData.fechaEntrega}`, 120, y + 20)
      doc.text(`Condición de pago: ${orderData.condicionPago}`, 20, y + 25)
      doc.text(`Tipo de despacho: ${orderData.tipoDespacho}`, 120, y + 25)

      y = 95
      doc.setFillColor(44, 82, 130)
      doc.setTextColor(255, 255, 255)
      doc.rect(15, y, 180, 7, "F")
      doc.setFontSize(8)
      doc.text("#", 17, y + 5)
      doc.text("Referencia", 25, y + 5)
      doc.text("Precio unitario", 95, y + 5)
      doc.text("Cantidad", 130, y + 5)
      doc.text("Peso", 155, y + 5)
      doc.text("Valor total", 175, y + 5)

      doc.setTextColor(0, 0, 0)
      y += 7
      let rowNumber = 1
      doc.setDrawColor(200, 200, 200)

      Object.entries(orderData.groupedProducts).forEach(([categoria, categoryProducts]) => {
        doc.setFillColor(245, 245, 245)
        doc.rect(15, y, 180, 6, "FD")
        doc.setFont(undefined as any, "bold")
        doc.text(categoria, 25, y + 4)
        doc.setFont(undefined as any, "normal")
        y += 6

        categoryProducts.forEach((product: any) => {
          doc.rect(15, y, 180, 6, "D")
          doc.text(String(rowNumber), 17, y + 4)
          doc.text(product.referencia, 25, y + 4)
          doc.text(`$ ${product.precioUnitario.toLocaleString("es-CO")}`, 95, y + 4)
          doc.text(String(product.cantidad), 130, y + 4)
          doc.text(Math.round(product.peso).toLocaleString("es-CO"), 155, y + 4)
          doc.text(`$ ${(product.precioUnitario * product.cantidad).toLocaleString("es-CO")}`, 175, y + 4)
          y += 6
          rowNumber++
        })
      })

      const totalRows = 16
      const rowsUsed = rowNumber - 1 + Object.keys(orderData.groupedProducts).length
      for (let i = rowsUsed; i < totalRows; i++) {
        doc.rect(15, y, 180, 6, "D")
        y += 6
      }

      doc.setDrawColor(0, 0, 0)

      y += 5
      doc.setFillColor(224, 224, 224)
      doc.rect(15, y, 180, 6, "F")
      doc.setFontSize(8)
      doc.setFont(undefined as any, "normal")
      doc.text("Total orden", 20, y + 4)
      doc.text(`$ ${orderData.totalOrden.toLocaleString("es-CO")}`, 175, y + 4)

      y += 6
      doc.text("Descuento IVA", 20, y + 4)
      doc.text(`$ ${orderData.descuentoIVA.toLocaleString("es-CO")}`, 175, y + 4)

      y += 6
      doc.text("Descuento pronto pago", 20, y + 4)
      doc.text(`$ ${orderData.descuentoPP.toLocaleString("es-CO")}`, 175, y + 4)

      y += 6
      doc.setFont(undefined as any, "bold")
      doc.text("Total a pagar", 20, y + 4)
      doc.text(`$ ${orderData.totalPagar.toLocaleString("es-CO")}`, 175, y + 4)

      y += 6
      doc.setFont(undefined as any, "normal")
      doc.text("Kg Despacho", 20, y + 4)
      doc.text(Math.round(orderData.kgDespacho).toLocaleString("es-CO"), 155, y + 4)

      y += 10
      doc.setFillColor(44, 82, 130)
      doc.setTextColor(255, 255, 255)
      doc.rect(15, y, 180, 6, "F")
      doc.setFont(undefined as any, "bold")
      doc.text("Observaciones", 20, y + 4)

      y += 6
      doc.setDrawColor(200, 200, 200)
      doc.rect(15, y, 180, 15, "S")
      doc.setFont(undefined as any, "normal")
      doc.setTextColor(0, 0, 0)
      doc.text(orderData.observaciones || "", 20, y + 5)

      doc.setTextColor(100, 100, 100)
      doc.setFontSize(7)
      doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

      const pdfBlob = doc.output("blob")
      const fileName = `pedido_${order.idpedido}_edit_${Date.now()}.pdf`

      const formData = new FormData()
      formData.append("file", pdfBlob, fileName)
      formData.append("path", `pedidos/${fileName}`)

      const result: any = await (uploadPDF as any)(formData)

      if (result.error) {
        console.error("Error uploading PDF:", result.error)
        return { success: false, error: result.error }
      }

      console.log("[v0] PDF generated successfully:", result.url)
      return { success: true, url: result.url }
    } catch (error) {
      console.error("Error generating PDF:", error)
      return { success: false, error: error instanceof Error ? error.message : "Error al generar el PDF" }
    }
  }

  const handleUpdateOrder = async () => {
    if (!editingOrder) return

    if (editProducts.length === 0) {
      toast({
        title: "Error",
        description: "Debe tener al menos un producto.",
        variant: "destructive",
      })
      return
    }

    setIsUpdating(true)

    try {
      const totals = calculateEditTotals()

      // Update header - only include fields that exist in the database
      const headerResult = await updateOrder(editingOrder.idpedido, {
        cliente: editingOrder.cliente,
        vendedor: editingOrder.vendedor,
        destino: editingOrder.destino,
        direccion: editDireccion,
        fecha_programada: editFechaProgramada,
        condicion_pago: editCondicionPago,
        total_linea: totals.totalOrden,
        total_pagar: totals.totalPagar,
        descuentoiva: totals.descuentoIVATotal,
        descuentopp: totals.descuentoPPTotal,
        // Pass orden_de_compra to updateOrder
        orden_de_compra: editingOrder.orden_de_compra,
        id_empresa: editingOrder.id_empresa, // Pass id_empresa
      })

      if (!headerResult.success) {
        toast({
          title: "Error",
          description: headerResult.message || "No se pudo actualizar el encabezado del pedido.",
          variant: "destructive",
        })
        setIsUpdating(false)
        return
      }

      // Update products with peso
      const productsWithWeight = await Promise.all(
        editProducts.map(async (p) => {
          const productInfo = editAllProductos.find((prod) => prod.nombre === p.producto)
          const weight = productInfo?.peso_unitkg || 0
          return {
            ...p,
            peso: weight * p.cantidad,
          }
        }),
      )

      const detailsResult = await updateOrderDetails(editingOrder.idpedido, productsWithWeight)

      if (!detailsResult.success) {
        toast({
          title: "Error",
          description: detailsResult.message || "No se pudieron actualizar los productos.",
          variant: "destructive",
        })
        setIsUpdating(false)
        return
      }

      setIsGeneratingPDF(true)
      const pdfResult = await generateEditedOrderPDF(editingOrder, productsWithWeight, totals)
      setIsGeneratingPDF(false)

      if (pdfResult.success && pdfResult.url) {
        // Update pdfpedido field in database
        await updateOrderPDFUrl(editingOrder.idpedido, pdfResult.url)

        const link = document.createElement("a")
        link.href = pdfResult.url
        link.download = `pedido_${editingOrder.idpedido}_actualizado.pdf`
        link.target = "_blank"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        toast({
          title: "Éxito",
          description: "Pedido actualizado correctamente. PDF regenerado y descargado automáticamente.",
          duration: 5000,
        })
      } else if (!pdfResult.success) {
        toast({
          title: "Error",
          description: pdfResult.error || "No se pudo regenerar el PDF del pedido.",
          variant: "destructive",
        })
        setIsUpdating(false)
        return
      }

      setIsEditMode(false)
      setEditingOrder(null)
      setEditProducts([])
      loadOrders()
    } catch (error) {
      console.error("Error updating order:", error)
      toast({
        title: "Error",
        description: "Ocurrió un error al actualizar el pedido.",
        variant: "destructive",
      })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditMode(false)
    setEditingOrder(null)
    setEditProducts([])
    setCurrentView("management") // Reset to management view
    setEditOrderId(undefined) // Clear edit order ID
  }

  const confirmDelete = async () => {
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
        description: result.message || "No se pudo eliminar el pedido.",
        variant: "destructive",
      })
    }
    setIsDeleteAlertOpen(false)
    setDeletingOrder(null)
  }

  // Renderizamos la tabla a partir de `appliedFilters` (snapshot
  // confirmado por el usuario al pulsar "Aplicar filtro"). Los
  // setters de los inputs siguen siendo `setClienteFilter`, etc.,
  // pero esos valores solo se promueven al snapshot al confirmar.
  const filteredOrders = orders.filter((order) => {
    const f = appliedFilters

    const matchesAprobado =
      f.aprobado === "todos" ||
      (f.aprobado === "si" && order.aprobado === "si") ||
      (f.aprobado === "no" && order.aprobado !== "si")

    const matchesCliente = f.cliente === "todos" || order.cliente === f.cliente
    const matchesVendedor = f.vendedor === "todos" || order.vendedor === f.vendedor
    const matchesDestino = f.destino === "todos" || order.destino === f.destino
    const matchesEstado = f.estado === "todos" || order.estado === f.estado

    let matchesFecha = true
    if (f.fechaDesde || f.fechaHasta) {
      const orderDate = order.fecha ? new Date(order.fecha) : null
      if (orderDate) {
        if (f.fechaDesde) {
          const fromDate = new Date(f.fechaDesde)
          fromDate.setHours(0, 0, 0, 0)
          if (orderDate < fromDate) matchesFecha = false
        }
        if (f.fechaHasta) {
          const toDate = new Date(f.fechaHasta)
          toDate.setHours(23, 59, 59, 999)
          if (orderDate > toDate) matchesFecha = false
        }
      }
    }

    return matchesAprobado && matchesCliente && matchesVendedor && matchesDestino && matchesEstado && matchesFecha
  })

  // Indica si los filtros borrador difieren del snapshot aplicado.
  // Se usa para resaltar el boton "Aplicar filtro" cuando hay
  // cambios pendientes y para etiquetar el estado en la UI.
  const hasPendingFilterChanges =
    aprobadoFilter !== appliedFilters.aprobado ||
    clienteFilter !== appliedFilters.cliente ||
    vendedorFilter !== appliedFilters.vendedor ||
    destinoFilter !== appliedFilters.destino ||
    estadoFilter !== appliedFilters.estado ||
    fechaDesde !== appliedFilters.fechaDesde ||
    fechaHasta !== appliedFilters.fechaHasta

  const handleApplyFilters = () => {
    setAppliedFilters({
      aprobado: aprobadoFilter,
      cliente: clienteFilter,
      vendedor: vendedorFilter,
      destino: destinoFilter,
      estado: estadoFilter,
      fechaDesde,
      fechaHasta,
    })
  }

  const handleResetFilters = () => {
    // Reinicia tanto el borrador como el snapshot a los defaults,
    // de modo que la tabla vuelve al estado "todos" sin requerir
    // un click adicional de "Aplicar".
    setAprobadoFilter(DEFAULT_APPLIED.aprobado)
    setClienteFilter(DEFAULT_APPLIED.cliente)
    setVendedorFilter(DEFAULT_APPLIED.vendedor)
    setDestinoFilter(DEFAULT_APPLIED.destino)
    setEstadoFilter(DEFAULT_APPLIED.estado)
    setFechaDesde(DEFAULT_APPLIED.fechaDesde)
    setFechaHasta(DEFAULT_APPLIED.fechaHasta)
    setAppliedFilters(DEFAULT_APPLIED)
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ""
    // Fixed timezone issue - append T00:00:00 to force local time interpretation
    return new Date(dateStr + "T00:00:00").toLocaleDateString("es-CO")
  }

  const handleViewPDF = (pdfUrl: string | null) => {
    if (!pdfUrl) {
      toast({
        title: "PDF no disponible",
        description: "Este pedido no tiene un PDF asociado.",
        variant: "destructive",
      })
      return
    }
    window.open(pdfUrl, "_blank")
  }

  const handleExportToExcel = async () => {
    const XLSX = await import("xlsx")
    if (filteredOrders.length === 0) {
      toast({
        title: "No hay datos",
        description: "No hay pedidos para exportar.",
        variant: "destructive",
      })
      return
    }

    // Prepare data for Excel
    const excelData = filteredOrders.map((order) => ({
      ID: order.idpedido,
      Pedido: order.pedido || "-",
      Fecha: formatDate(order.fecha),
      Cliente: order.cliente,
      Vendedor: order.vendedor,
      Destino: order.destino,
      // Display 'orden_de_compra' in Excel export
      "Orden Compra": order.orden_de_compra || "-",
      Aprobado: order.aprobado === "si" ? "Sí" : "No",
      "Rev. Cartera": order.revisioncartera || "-",
      "Rev. Gerencia": order.revisiongerencia || "-",
      Dirección: order.direccion || "-",
      "Condición Pago": order.condicion_pago || "-",
      "Total Pagar": order.total_pagar || 0,
      "O.Cargue": order.ocargue || "-",
    }))

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(excelData)

    // Create workbook
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Pedidos")

    // Generate file name with current date
    const fileName = `Pedidos_${new Date().toISOString().split("T")[0]}.xlsx`

    // Save file
    XLSX.writeFile(workbook, fileName)

    toast({
      title: "Éxito",
      description: "Los pedidos se han exportado correctamente.",
    })
  }

  const editTotals = calculateEditTotals()

  // Helper function to get total order value for the table view
  const getTotalOrderValue = (order: Order) => {
    // For the table view, we might not have the breakdown of totals,
    // so we'll use the 'total_pagar' or a default if not available.
    // In a real scenario, you might fetch more detailed data or calculate it differently.
    return order.total_pagar ?? 0
  }

  // Handle delete action for table view
  const handleDelete = (order: Order) => {
    handleDeleteClick(order.idpedido, order.ocargue, order.aprobado)
  }

  // Handle approve action for table view
  const handleApprove = (order: Order) => {
    handleApproveClick(order.idpedido, order.aprobado)
  }

  // Function to fetch orders, used by OrderEntryForm
  const fetchOrders = loadOrders

  if (currentView === "entry") {
    return (
      <OrderEntryForm
        onManageOrders={() => {
          setCurrentView("management")
          setEditOrderId(undefined)
          fetchOrders() // Reload orders after editing
        }}
        editOrderId={editOrderId}
      />
    )
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* This is the management view part */}
      {isEditMode && editingOrder ? ( // This condition is now redundant with currentView === "entry" logic
        <div className="space-y-6">
          {/* Optimizing header and filters for mobile */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold">Editar Pedido #{editingOrder.pedido}</h2>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Modifique todos los campos del pedido incluyendo productos. El PDF será regenerado automáticamente.
              </p>
            </div>
            <Button variant="outline" onClick={handleCancelEdit} disabled={isUpdating || isGeneratingPDF} size="sm">
              <ArrowLeft className="mr-2 h-3 w-3 sm:h-4 sm:w-4" />
              Volver a la lista
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Información del Pedido</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Header Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-cliente">Cliente *</Label>
                  <Select
                    value={editingOrder.cliente}
                    onValueChange={async (value) => {
                      setEditingOrder({ ...editingOrder, cliente: value, orden_de_compra: "" }) // Reset orden_de_compra
                      setEditSucursal("")
                      setEditDireccion("")
                      await loadSucursalesByCliente(value)
                    }}
                  >
                    <SelectTrigger id="edit-cliente">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {clientes.map((cliente, index) => (
                        <SelectItem key={`edit-cliente-${index}-${cliente}`} value={cliente}>
                          {cliente}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-vendedor">Vendedor *</Label>
                  <Select
                    value={editingOrder.vendedor}
                    onValueChange={(value) => setEditingOrder({ ...editingOrder, vendedor: value })}
                  >
                    <SelectTrigger id="edit-vendedor">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {vendedores.map((vendedor) => (
                        <SelectItem key={vendedor} value={vendedor}>
                          {vendedor}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-sucursal">Sucursal</Label>
                  <Select
                    value={editSucursal}
                    onValueChange={(value) => {
                      setEditSucursal(value)
                      const selectedSucursal = editSucursales.find((s) => s.nombrebodega === value)
                      if (selectedSucursal) {
                        setEditingOrder({
                          ...editingOrder,
                          // Use the selected sucursal's destination or fallback
                          destino: selectedSucursal.ciudad || "",
                          orden_de_compra: "", // Reset orden_de_compra when sucursal changes
                        })
                        setEditDireccion(selectedSucursal.direccion || "")
                      }
                    }}
                  >
                    <SelectTrigger id="edit-sucursal">
                      <SelectValue placeholder="Seleccione sucursal" />
                    </SelectTrigger>
                    <SelectContent>
                      {editSucursales.map((sucursal) => (
                        <SelectItem key={sucursal.nombrebodega} value={sucursal.nombrebodega}>
                          {sucursal.nombrebodega}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-destino">Destino *</Label>
                  <Input
                    id="edit-destino"
                    value={editingOrder.destino}
                    disabled
                    className="bg-muted"
                    placeholder="Se carga desde la sucursal"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-fecha-programada">Fecha Programada *</Label>
                  <DatePickerField
                    id="edit-fecha-programada"
                    value={editFechaProgramada}
                    onChange={setEditFechaProgramada}
                  />
                </div>

                <div className="space-y-2 col-span-1 lg:col-span-2">
                  <Label htmlFor="edit-direccion">Dirección</Label>
                  <Input
                    id="edit-direccion"
                    value={editDireccion}
                    disabled
                    className="bg-muted"
                    placeholder="Se carga desde la sucursal"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-condicion-pago">Condición de Pago</Label>
                  <Select value={editCondicionPago} onValueChange={setEditCondicionPago}>
                    <SelectTrigger id="edit-condicion-pago">
                      <SelectValue placeholder="Seleccione condición" />
                    </SelectTrigger>
                    <SelectContent>
                      {editCondicionesPago.map((cond) => (
                        <SelectItem key={cond.nombrecondicion} value={cond.nombrecondicion}>
                          {cond.nombrecondicion}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-tipo-despacho">Tipo de Despacho</Label>
                  <Select value={editTipoDespacho} onValueChange={setEditTipoDespacho}>
                    <SelectTrigger id="edit-tipo-despacho">
                      <SelectValue placeholder="Seleccione tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {editTiposDespacho.map((tipo) => (
                        <SelectItem key={tipo.nombretipodespacho} value={tipo.nombretipodespacho}>
                          {tipo.nombretipodespacho}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Added Orden de Compra input */}
                <div className="space-y-2 col-span-1">
                  <Label htmlFor="edit-orden-de-compra">Orden de Compra</Label>
                  <Input
                    id="edit-orden-de-compra"
                    value={editingOrder.orden_de_compra || ""}
                    onChange={(e) => setEditingOrder({ ...editingOrder, orden_de_compra: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-observaciones">Observaciones</Label>
                <Textarea
                  id="edit-observaciones"
                  value={editObservaciones}
                  onChange={(e) => setEditObservaciones(e.target.value)}
                  placeholder="Ingrese observaciones adicionales"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Productos</span>
                <Button onClick={addEditProduct} size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Producto
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Discount Options */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 bg-muted rounded-lg">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-descuento-iva"
                    checked={editAplicarDescuentoIVA}
                    onCheckedChange={(checked) => setEditAplicarDescuentoIVA(checked === true)}
                  />
                  <Label htmlFor="edit-descuento-iva" className="text-xs sm:text-sm">
                    Aplicar descuento IVA (5%)
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-descuento-pp"
                    checked={editAplicarDescuentoPP}
                    onCheckedChange={(checked) => setEditAplicarDescuentoPP(checked === true)}
                  />
                  <Label htmlFor="edit-descuento-pp" className="text-xs sm:text-sm">
                    Aplicar descuento pronto pago
                  </Label>
                </div>

                {editAplicarDescuentoPP && (
                  <div className="flex items-center space-x-2">
                    <Label htmlFor="edit-descuento-pp-percent" className="text-xs sm:text-sm">
                      %:
                    </Label>
                    <Input
                      id="edit-descuento-pp-percent"
                      type="number"
                      className="w-16 sm:w-20 h-8"
                      value={editDescuentoPPPercent}
                      onChange={(e) => setEditDescuentoPPPercent(e.target.value)}
                      min="0"
                      max="100"
                    />
                  </div>
                )}
              </div>

              {/* Products Table */}
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Categoría</TableHead>
                      <TableHead className="text-xs">Producto</TableHead>
                      <TableHead className="text-xs">Cantidad</TableHead>
                      <TableHead className="text-xs">Precio Unit.</TableHead>
                      <TableHead className="text-xs">Total Línea</TableHead>
                      <TableHead className="text-xs">Desc. IVA</TableHead>
                      <TableHead className="text-xs">Desc. PP</TableHead>
                      <TableHead className="text-xs">Subtotal</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {editProducts.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <Select
                            value={product.categoria}
                            onValueChange={(value) => updateEditProductLine(product.id, "categoria", value)}
                          >
                            <SelectTrigger className="w-[120px] sm:w-[150px] h-8 text-xs">
                              <SelectValue placeholder="Categoría" />
                            </SelectTrigger>
                            <SelectContent>
                              {editCategorias.map((cat) => (
                                <SelectItem key={cat.nombre} value={cat.nombre} className="text-xs">
                                  {cat.nombre}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={product.producto}
                            onValueChange={(value) => updateEditProductLine(product.id, "producto", value)}
                            disabled={!product.categoria}
                          >
                            <SelectTrigger className="w-[150px] sm:w-[200px] h-8 text-xs">
                              <SelectValue placeholder="Producto" />
                            </SelectTrigger>
                            <SelectContent>
                              {editAllProductos
                                .filter((p) => p.categoria === product.categoria)
                                .map((prod) => (
                                  <SelectItem key={prod.nombre} value={prod.nombre} className="text-xs">
                                    {prod.nombre}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="w-20 sm:w-24 h-8 text-xs"
                            value={product.cantidad}
                            onChange={(e) => updateEditProductLine(product.id, "cantidad", Number(e.target.value))}
                            min="0"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="w-24 sm:w-32 h-8 text-xs"
                            value={product.precioUnitario}
                            onChange={(e) =>
                              updateEditProductLine(product.id, "precioUnitario", Number(e.target.value))
                            }
                            min="0"
                          />
                        </TableCell>
                        <TableCell className="font-medium text-xs">
                          ${product.totalLinea.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-red-600 text-xs">
                          ${product.descuentoIVA.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-red-600 text-xs">
                          ${product.descuentoPP.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="font-bold text-xs">
                          ${product.subtotal.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => removeEditProduct(product.id)}
                            disabled={editProducts.length === 1}
                          >
                            <Trash2 className="h-3 w-3 sm:h-4 sm:w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-full sm:w-80 space-y-2 bg-muted p-3 sm:p-4 rounded-lg">
                  <div className="flex justify-between text-xs sm:text-sm">
                    <span>Total Orden:</span>
                    <span className="font-medium">
                      ${calculateEditTotals().totalOrden.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs sm:text-sm text-red-600">
                    <span>Descuento IVA Total:</span>
                    <span>
                      -${calculateEditTotals().descuentoIVATotal.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs sm:text-sm text-red-600">
                    <span>Descuento PP Total:</span>
                    <span>
                      -${calculateEditTotals().descuentoPPTotal.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-base sm:text-lg font-bold">
                    <span>Total a Pagar:</span>
                    <span>
                      ${calculateEditTotals().totalPagar.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button variant="outline" onClick={handleCancelEdit} disabled={isUpdating || isGeneratingPDF}>
              Cancelar
            </Button>
            <Button
              onClick={handleUpdateOrder}
              disabled={isUpdating || isGeneratingPDF}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isUpdating || isGeneratingPDF ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isGeneratingPDF ? "Generando PDF..." : "Actualizando..."}
                </>
              ) : (
                "Guardar y Regenerar PDF"
              )}
            </Button>
          </div>
        </div> // This else block renders the management view
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Gestionar Pedidos</CardTitle>
                  <CardDescription>Administre todos los pedidos del sistema</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleExportToExcel} variant="outline">
                    <FileDown className="mr-2 h-4 w-4" />
                    Exportar a Excel
                  </Button>
                  <Button onClick={loadOrders} variant="outline">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Actualizar
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <Card>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="filter-cliente" className="text-xs sm:text-sm">
                        Cliente
                      </Label>
                      <Popover open={clienteComboOpen} onOpenChange={setClienteComboOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={clienteComboOpen}
                            className="w-full h-8 sm:h-9 text-xs justify-between bg-transparent"
                          >
                            {clienteFilter === "todos" ? "Todos los clientes" : clienteFilter || "Cliente"}
                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Buscar cliente..." className="h-8 text-xs" />
                            <CommandEmpty>No se encontró el cliente.</CommandEmpty>
                            <CommandList>
                              {" "}
                              {/* Wrapped CommandGroup and CommandEmpty in CommandList */}
                              <CommandGroup className="max-h-64 overflow-auto">
                                <CommandItem
                                  value=""
                                  onSelect={() => {
                                    setClienteFilter("todos") // Set to 'todos' to match initial state
                                    setClienteComboOpen(false)
                                  }}
                                  className="text-xs"
                                >
                                  <Check
                                    className={`mr-2 h-3 w-3 ${clienteFilter === "todos" ? "opacity-100" : "opacity-0"}`}
                                  />
                                  Todos los clientes
                                </CommandItem>
                                {clientes.map((cliente, index) => (
                                  <CommandItem
                                    key={`cliente-${index}-${cliente}`}
                                    value={cliente}
                                    onSelect={() => {
                                      setClienteFilter(cliente)
                                      setClienteComboOpen(false)
                                    }}
                                    className="text-xs"
                                  >
                                    <Check
                                      className={`mr-2 h-3 w-3 ${clienteFilter === cliente ? "opacity-100" : "opacity-0"}`}
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

                    <div className="space-y-2">
                      <Label htmlFor="filter-vendedor" className="text-xs sm:text-sm">
                        Vendedor
                      </Label>
                      <Select value={vendedorFilter} onValueChange={setVendedorFilter}>
                        <SelectTrigger className="w-full h-8 sm:h-9 text-xs" id="filter-vendedor">
                          <SelectValue placeholder="Vendedor" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Todos</SelectItem>
                          {vendedores.map((vendedor) => (
                            <SelectItem key={vendedor} value={vendedor} className="text-xs">
                              {vendedor}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="filter-destino" className="text-xs sm:text-sm">
                        Destino
                      </Label>
                      <Select value={destinoFilter} onValueChange={setDestinoFilter}>
                        <SelectTrigger className="w-full h-8 sm:h-9 text-xs" id="filter-destino">
                          <SelectValue placeholder="Destino" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Todos</SelectItem>
                          {destinos.map((destino) => (
                            <SelectItem key={destino} value={destino} className="text-xs">
                              {destino}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="filter-aprobado" className="text-xs sm:text-sm">
                        Aprobado
                      </Label>
                      <Select value={aprobadoFilter} onValueChange={setAprobadoFilter}>
                        <SelectTrigger className="w-full h-8 sm:h-9 text-xs" id="filter-aprobado">
                          <SelectValue placeholder="Aprobado" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Todos</SelectItem>
                          <SelectItem value="si">Sí</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="filter-estado" className="text-xs sm:text-sm">
                        Estado
                      </Label>
                      <Select value={estadoFilter} onValueChange={setEstadoFilter}>
                        <SelectTrigger className="w-full h-8 sm:h-9 text-xs" id="filter-estado">
                          <SelectValue placeholder="Estado" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Todos</SelectItem>
                          {estados.map((estado) => (
                            <SelectItem key={estado} value={estado} className="text-xs">
                              {estado}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
                    <div className="space-y-2">
                      <Label htmlFor="filter-fecha-desde" className="text-xs sm:text-sm">
                        Fecha Desde
                      </Label>
                      <DatePickerField
                        id="filter-fecha-desde"
                        className="h-8 sm:h-9 text-xs"
                        value={fechaDesde}
                        onChange={setFechaDesde}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="filter-fecha-hasta" className="text-xs sm:text-sm">
                        Fecha Hasta
                      </Label>
                      <DatePickerField
                        id="filter-fecha-hasta"
                        className="h-8 sm:h-9 text-xs"
                        value={fechaHasta}
                        onChange={setFechaHasta}
                      />
                    </div>
                  </div>

                  {/* Barra de acciones de filtros.
                      "Aplicar filtro" promueve el borrador a snapshot
                      activo y la tabla se re-renderiza desde cero.
                      "Limpiar" devuelve borrador y snapshot a los
                      valores por defecto en un solo click. Se
                      destaca con un punto pulsante cuando hay cambios
                      sin aplicar para que el usuario sepa que la
                      tabla aun no refleja sus selecciones. */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1 border-t">
                    <p className="text-xs text-muted-foreground flex-1">
                      {hasPendingFilterChanges ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-700">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                          </span>
                          Cambios sin aplicar — pulsa “Aplicar filtro” para refrescar la tabla
                        </span>
                      ) : (
                        <span>
                          Tabla mostrando {filteredOrders.length}{" "}
                          {filteredOrders.length === 1 ? "pedido" : "pedidos"}
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleResetFilters}
                        className="h-8 text-xs gap-1.5"
                        title="Restablecer filtros a sus valores por defecto"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Limpiar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleApplyFilters}
                        disabled={!hasPendingFilterChanges}
                        className="h-8 text-xs gap-1.5"
                        aria-label="Aplicar filtros y re-renderizar la tabla"
                      >
                        <Filter className="h-3.5 w-3.5" />
                        Aplicar filtro
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Orders Table */}
              {loading ? (
                <div className="flex justify-center items-center py-8">
                  <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin" />
                </div>
              ) : (
                // Sticky fix: <Table> de shadcn envuelve la <table> en un div
                // con overflow-x-auto que crea un scroll container al que se
                // ancla `position: sticky` de los <th> (sin scroll vertical
                // propio), por lo que el thead nunca queda fijo. Solucion:
                // <table> HTML nativo dentro de un unico div que maneja ambos
                // ejes de scroll. Se mantienen TableHeader/TableHead/etc.
                // porque son etiquetas HTML semanticas con estilos shadcn.
                <div className="rounded-md border max-h-[400px] sm:max-h-[600px] overflow-auto relative">
                      <table className="w-full caption-bottom text-sm border-separate border-spacing-0">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">ID Pedido</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Pedido</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Orden Compra</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">O. Cargue</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Estado</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Cliente</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Vendedor</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Destino</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Empresa Factura</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Fecha</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Total</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Aprobado</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Rev. Cartera</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Rev. Gerencia</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">PDF</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-background border-b text-xs whitespace-nowrap">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredOrders.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={16}
                                className="text-center py-8 text-xs sm:text-sm text-muted-foreground"
                              >
                                No se encontraron pedidos
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredOrders.map((order) => (
                              <TableRow key={order.idpedido}>
                                <TableCell className="font-medium text-xs">{order.idpedido}</TableCell>
                                <TableCell className="font-medium text-xs">
                                  {order.pedido ? (
                                    order.pedido
                                  ) : (
                                    <Badge variant="outline" className="text-[10px]">
                                      -
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {order.orden_de_compra ? (
                                    order.orden_de_compra
                                  ) : (
                                    <Badge variant="outline" className="text-[10px]">
                                      -
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {order.ocargue ? (
                                    order.ocargue
                                  ) : (
                                    <Badge variant="outline" className="text-[10px]">
                                      -
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-[10px]">
                                    {order.estado || "-"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs">{order.cliente}</TableCell>
                                <TableCell className="text-xs">{order.vendedor}</TableCell>
                                <TableCell className="text-xs">{order.destino}</TableCell>
                                <TableCell className="text-xs">
                                  {order.empresafactura ? (
                                    order.empresafactura
                                  ) : (
                                    <Badge variant="outline" className="text-[10px]">
                                      -
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {new Date(order.fecha + "T00:00:00").toLocaleDateString("es-CO")}
                                </TableCell>
                                <TableCell className="text-xs">
                                  ${order.total_linea?.toLocaleString("es-CO") || "0"}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={order.aprobado === "si" ? "default" : "secondary"}
                                    className="text-[10px]"
                                  >
                                    {order.aprobado === "si" ? "Sí" : "No"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs">
                                  {order.revisioncartera ? (
                                    <span>{order.revisioncartera}</span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {order.revisiongerencia ? (
                                    <span>{order.revisiongerencia}</span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {order.pdfpedido ? (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => handleViewPDF(order.pdfpedido)}
                                      title="Ver/Descargar PDF"
                                    >
                                      <FileText
                                        className={`h-3 w-3 sm:h-4 sm:w-4 ${order.pdfpedido ? "text-purple-600" : "text-gray-300"}`}
                                      />
                                    </Button>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">No disponible</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7">
                                        <MoreHorizontal className="h-3 w-3 sm:h-4 sm:w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => handleEdit(order)}
                                        disabled={
                                          order.aprobado === "si" ||
                                          (!!order.revisioncartera && order.revisioncartera.trim() !== "")
                                        }
                                        className="text-xs"
                                      >
                                        <Pencil className="mr-2 h-3 w-3" />
                                        Editar
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => handleDeleteClick(order.idpedido, order.ocargue, order.aprobado)}
                                        disabled={order.aprobado === "si" || !!order.ocargue}
                                        className="text-xs"
                                      >
                                        <Trash2 className="mr-2 h-3 w-3" />
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
                                        <CheckCircle className="mr-2 h-3 w-3" />
                                        Aprobar Cartera
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => handleApproveClick(order.idpedido, order.aprobado)}
                                        disabled={
                                          (!order.revisioncartera || order.revisioncartera.trim() === "") ||
                                          order.aprobado === "si"
                                        }
                                        className={`text-xs ${
                                          (!order.revisioncartera || order.revisioncartera.trim() === "") ||
                                          order.aprobado === "si"
                                            ? "opacity-50 cursor-not-allowed"
                                            : ""
                                        }`}
                                      >
                                        <CheckCircle className="mr-2 h-3 w-3" />
                                        Aprobar
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => handleAnnulClick(order)}
                                        disabled={
                                          order.aprobado?.toLowerCase() !== "si" ||
                                          (!!order.ocargue && order.ocargue.trim() !== "")
                                        }
                                        className="text-xs"
                                      >
                                        <XCircle className="mr-2 h-3 w-3" />
                                        Anular
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => handleClosePendingClick(order)}
                                        disabled={order.estado?.toLowerCase() !== "parcial"}
                                        className="text-xs"
                                      >
                                        <CheckCircle className="mr-2 h-3 w-3" />
                                        Cerrar Pendiente
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => handleInvoiceCloseClick(order)}
                                        // Cierre con Factura: ahora habilitado
                                        // para CUALQUIER pedido aprobado
                                        // (`aprobado === "si"`), sin restringir
                                        // por estado. Antes solo se permitia
                                        // cuando el estado era "pendiente".
                                        disabled={order.aprobado?.toLowerCase() !== "si"}
                                      >
                                        Cierre con Factura
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {selectedOrder && (
        <OrderDetailsDialog isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} idpedido={selectedOrder} />
      )}

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Está seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente el pedido y todos sus detalles. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Eliminar
            </AlertDialogAction>
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
              <Label htmlFor="approval-code">Contraseña de Aprobación</Label>
              <div className="relative">
                <Input
                  id="approval-code"
                  type={showApprovalPassword ? "text" : "password"}
                  placeholder="Ingrese el código"
                  value={approvalCode}
                  onChange={(e) => {
                    setApprovalCode(e.target.value)
                    setApprovalError("") // Clear error on input change
                  }}
                  disabled={isApproving}
                  className={approvalError ? "border-red-500" : ""}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowApprovalPassword(!showApprovalPassword)}
                  disabled={isApproving}
                >
                  {showApprovalPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </Button>
              </div>
              {approvalError && <p className="text-xs text-red-600">{approvalError}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsApprovalDialogOpen(false)} disabled={isApproving}>
              Cancelar
            </Button>
            <Button
              onClick={confirmApproval}
              disabled={!approvalCode || isApproving}
              className="bg-green-600 hover:bg-green-700"
            >
              {isApproving ? (
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

      <Dialog open={isAnnulDialogOpen} onOpenChange={setIsAnnulDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular Pedido</DialogTitle>
            <DialogDescription>
              Esta acción cambiará el estado del pedido a "anulado". Por favor ingrese la contraseña para confirmar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="annul-password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="annul-password"
                  type={showAnnulPassword ? "text" : "password"}
                  value={annulPassword}
                  onChange={(e) => setAnnulPassword(e.target.value)}
                  placeholder="Ingrese la contraseña"
                  className="pr-10"
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
            <Button variant="outline" onClick={() => setIsAnnulDialogOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleAnnulConfirm}>
              Anular Pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!closePendingOrderId} onOpenChange={() => setClosePendingOrderId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar Pedido Pendiente</DialogTitle>
            <DialogDescription>
              Ingrese la contraseña para cerrar este pedido pendiente. El estado cambiará a "entrega parcial".
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="close-pending-password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="close-pending-password"
                  type={showClosePendingPassword ? "text" : "password"}
                  value={closePendingPassword}
                  onChange={(e) => setClosePendingPassword(e.target.value)}
                  placeholder="Ingrese contraseña"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
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
            <Button variant="outline" onClick={() => setClosePendingOrderId(null)}>
              Cancelar
            </Button>
            <Button onClick={handleClosePendingConfirm}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isInvoiceCloseDialogOpen} onOpenChange={setIsInvoiceCloseDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cierre con Factura - Pedido #{invoiceHeader?.pedido}</DialogTitle>
            <DialogDescription>Complete la información de cierre con factura del pedido</DialogDescription>
          </DialogHeader>

          {invoiceHeader && (
            <div className="space-y-4">
              {/* Order Header Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Información del Pedido</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-semibold">Cliente:</span> {invoiceHeader.cliente}
                  </div>
                  <div>
                    <span className="font-semibold">Fecha:</span> {invoiceHeader.fecha}
                  </div>
                  <div>
                    <span className="font-semibold">Destino:</span> {invoiceHeader.destino}
                  </div>
                  <div>
                    <span className="font-semibold">Vendedor:</span> {invoiceHeader.vendedor}
                  </div>
                </CardContent>
              </Card>

              {/* Invoice Info */}
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="factura">Factura *</Label>
                  <Input
                    id="factura"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="Ingrese número de factura"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Fecha de Entrega</Label>
                  <Input value={new Date().toLocaleDateString("es-CO")} disabled />
                </div>
              </div>

              {/* Products Table */}
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Productos del Pedido</h3>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Unidades</TableHead>
                        <TableHead className="text-right">Unidades Recibidas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceProducts.map((product, index) => (
                        <TableRow key={product.transid}>
                          <TableCell>{product.producto}</TableCell>
                          <TableCell className="text-right">{product.unidades}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              max={product.unidades}
                              value={product.unidadesRecibidas}
                              onChange={(e) => {
                                const newProducts = [...invoiceProducts]
                                newProducts[index].unidadesRecibidas = Number(e.target.value)
                                setInvoiceProducts(newProducts)
                              }}
                              className="w-24 text-right"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsInvoiceCloseDialogOpen(false)}
              disabled={isClosingWithInvoice}
            >
              Cancelar
            </Button>
            <Button onClick={handleInvoiceCloseConfirm} disabled={isClosingWithInvoice || !invoiceNumber}>
              {isClosingWithInvoice && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar Cierre
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
              <Label htmlFor="cartera-password">Contraseña de Cartera</Label>
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
