"use client"

import { useState, useEffect, type ReactNode } from "react"
import { esEstadoFinal } from "@/lib/pedidos-estado"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MultiSelect } from "@/components/ui/multi-select"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { ChevronsUpDown } from "lucide-react" // Added ChevronsUpDown for combobox
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getClientes } from "@/lib/actions"
import { getOrders, getOrderDetails, getOrderFiltersData, generateLoadOrder, getAccessibleEmpresesFromPermisos } from "@/lib/orders-actions"
import { getProductStockFromInvGlobal } from "@/lib/inventory-actions"
import { getVehiclesFromCitas } from "@/lib/vehicle-actions"
import { getTransportes } from "@/lib/actions"
import { transportesCargue, transporteHabilitado } from "@/lib/transportes-cargue"
import { Loader2, X, RefreshCw, Check } from "lucide-react" // Added ChevronsUpDown for combobox
import { toast } from "@/components/ui/use-toast"
import { useAuth } from "@/components/auth-provider"

// Importing Accordion components for collapsible order details
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { PedidosDelDia } from "@/components/operacion/pedidos-del-dia"
import { Chip, Cifra, Esqueleto, EstadoVacio, Eyebrow, Progreso, TEXTO_TONO, type Tono } from "@/components/ui/lipgo"
import { AlertTriangle, Search, SlidersHorizontal, Truck } from "lucide-react"
import { hoyBogotaISO } from "@/lib/periodo-listados"
import { diasEntreISO } from "@/lib/pedidos-del-dia"

interface Cliente {
  id: number
  nombre: string
}

interface Bodega {
  id: number
  nombre: string
}

interface Order {
  idpedido: number
  pedido?: string
  fecha: string
  cliente: string
  vendedor: string
  destino: string
  total_pagar: number
  empresa: string
  aprobado: string
  orden_de_compra?: string
  estado?: string
  fecha_programada?: string | null
}

interface OrderDetail {
  transid: number
  producto: string
  unidades: number
  unidadespendientes: number
  categoria: string
  precio_und: number
  total_linea: number
  idproducto?: number
  peso_unitkg?: number
  lote?: string
}

interface Vehicle {
  placa: string
  nombreconductor: string
  peso_disponible: number
  capacidad?: number // Added capacidad field
  transporte?: string // Added transporte field
}

function GenerateLoadOrdersComponent() {
  const { selectedEmpresaId } = useAuth()
  // Solo presentación: búsqueda, vista rápida y filtros plegados (no cambian la consulta ni los filtros).
  const [busqueda, setBusqueda] = useState("")
  const [vista, setVista] = useState<"todos" | "hoy" | "atrasados" | "parciales">("todos")
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [selectedBodega, setSelectedBodega] = useState<string>("all")
  const [selectedCliente, setSelectedCliente] = useState<string>("all")
  const [selectedEmpresa, setSelectedEmpresa] = useState<string>("all")
  const [selectedCiudad, setSelectedCiudad] = useState<string>("all")
  const [selectedVendedor, setSelectedVendedor] = useState<string>("all") // Added state for selectedVendedor
  const [selectedFecha, setSelectedFecha] = useState<string>("")
  const [selectedEstado, setSelectedEstado] = useState<string>("all") // default to "all" (Todos)
  const [selectedPedidos, setSelectedPedidos] = useState<string[]>([])
  const [selectedOrdenesCompra, setSelectedOrdenesCompra] = useState<string[]>([])
  const [pedidoOptions, setPedidoOptions] = useState<{ label: string; value: string }[]>([])
  const [ordenCompraOptions, setOrdenCompraOptions] = useState<{ label: string; value: string }[]>([])
  const [ciudadOptions, setCiudadOptions] = useState<string[]>([])
  const [vendedorOptions, setVendedorOptions] = useState<string[]>([]) // Added state for vendedorOptions
  const [orders, setOrders] = useState<Order[]>([])
  const [selectedOrders, setSelectedOrders] = useState<number[]>([])
  const [selectedOrdersData, setSelectedOrdersData] = useState<Order[]>([])
  const [orderDetails, setOrderDetails] = useState<Record<number, OrderDetail[]>>({})
  const [loading, setLoading] = useState(false)
  const [vehiculo, setVehiculo] = useState<string>("")
  const [nombreConductor, setNombreConductor] = useState<string>("")
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [fechaEntrega, setFechaEntrega] = useState<string>("")
  const [tipoTransporte, setTipoTransporte] = useState<string>("") // vacío: el centinela "defaultTransport" era truthy y anulaba la validación de abajo
  const [fechaOrdenCargue, setFechaOrdenCargue] = useState<string>("")
  const [observaciones, setObservaciones] = useState<string>("")
  const [productStock, setProductStock] = useState<Record<number, number>>({})
  const [generatingOrder, setGeneratingOrder] = useState(false)
  const [totalPesoPedidos, setTotalPesoPedidos] = useState(0)
  const [pesoDisponible, setPesoDisponible] = useState(0)
  const [ciudad, setCiudad] = useState<string>("") // Declare setCiudad variable
  const [cantidadDespachada, setCantidadDespachada] = useState<Record<string, number>>({})
  const [showLineClosureDialog, setShowLineClosureDialog] = useState(false)
  const [pendingLineClosures, setPendingLineClosures] = useState<
    Array<{
      transid: number
      idpedido: number
      producto: string
      cantPedida: number
      cantDesp: number
      lineKey: string
    }>
  >([])
  const [lineClosureDecisions, setLineClosureDecisions] = useState<Record<string, boolean>>({})
  const [tipoOperacion, setTipoOperacion] = useState<"Despacho" | "Recibo">("Despacho")
  const [sinVehiculo, setSinVehiculo] = useState<boolean>(false)
  const [vehicleCapacity, setVehicleCapacity] = useState<number>(0) // Added state for vehicle capacity
  const [transportes, setTransportes] = useState<Array<{ nombretransporte: string }>>([])
  const [missingFields, setMissingFields] = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false) // Renamed from generatingOrder for clarity
  const [openClienteCombobox, setOpenClienteCombobox] = useState(false)

  // Renamed variables to match the updates
  const [selectedOCs, setSelectedOCs] = useState<string[]>([])
  const ocOptions = ordenCompraOptions // Alias for clarity in the form

  // New state for managing units to load per order item
  const [unitsToLoadMap, setUnitsToLoadMap] = useState<Record<string, number>>({})

  const handleCantDespChange = (lineKey: string, value: string, max: number) => {
    const newValue = Math.min(max, Number.parseInt(value, 10) || 0)
    setCantidadDespachada((prev) => ({
      ...prev,
      [lineKey]: newValue,
    }))
  }

  // Simplified handler for changing units to load
  const handleUnitsToLoadChange = (lineKey: string, value: number, maxUnits: number) => {
    setUnitsToLoadMap((prev) => ({ ...prev, [lineKey]: Math.min(Math.max(0, value), maxUnits) }))
  }

  useEffect(() => {
    const loadFilterData = async () => {
      const [clientesData, filtersData, vehiclesData, bodegasData] = await Promise.all([
        getClientes(selectedEmpresaId ?? undefined),
        getOrderFiltersData(selectedEmpresaId ?? undefined),
        getVehiclesFromCitas(selectedEmpresaId ?? undefined),
        getAccessibleEmpresesFromPermisos(),
      ])

      setClientes(clientesData)
      setBodegas(bodegasData)

      if (filtersData.success && filtersData.data) {
        setPedidoOptions(
          filtersData.data.pedidoNumbers.map((num) => ({
            label: num.toString(),
            value: num.toString(),
          })),
        )
        setOrdenCompraOptions(
          filtersData.data.ordenCompraValues.map((oc) => ({
            label: oc,
            value: oc,
          })),
        )
        setCiudadOptions(filtersData.data.ciudades || [])
        setVendedorOptions(filtersData.data.vendedores || []) // Set vendedor options
      }

      if (vehiclesData.success && vehiclesData.data) {
        setVehicles(vehiclesData.data as any)
      }
    }
    loadFilterData()
  }, [selectedEmpresaId])

  useEffect(() => {
    const loadTransportesData = async () => {
      const transportesData = await getTransportes()
      // Solo las transportadoras vigentes (lib/transportes-cargue.ts). Susanita
      // NO está: es un CLIENTE, y quien transporta su carga es Zamudio, que sí
      // está. El maestro conserva las demás para no alterar el histórico.
      const orden = transportesCargue()
      const vigentes = transportesData.filter((t) => transporteHabilitado(t.nombretransporte))
      // Se ordena como la lista declarada, no alfabéticamente: así el operador
      // siempre encuentra cada opción en el mismo sitio.
      vigentes.sort(
        (a, b) =>
          orden.indexOf(a.nombretransporte.trim().toUpperCase()) -
          orden.indexOf(b.nombretransporte.trim().toUpperCase()),
      )
      setTransportes(vigentes)
    }
    loadTransportesData()
  }, [])

  const loadOrders = async () => {
    setLoading(true)
    // Solo pedidos ABIERTOS, sin límite de fecha: un pedido pendiente puede ser
    // viejo y no debe desaparecer de aquí (el filtro de estado de abajo se
    // conserva como segunda barrera).
    // La empresa elegida arriba manda (gerencia 2026-10-05: el pedido 5102611 de Cedi Funza aparecía en Avimol
    // para un usuario con acceso a varios proyectos). getOrders comprueba que sea accesible antes de usarla; si
    // no viene, cae a todas las accesibles, como antes.
    const result = await getOrders(selectedEmpresaId ?? undefined, { soloAbiertos: true })
    if (result.success && result.data) {
      let filteredOrders = result.data

      // Exclude orders with estado: "entregado", "entrega parcial", "anulado" y, desde
      // SQL 215, "no entregado" (depurados). Misma lista que lib/pedidos-estado.ts.
      filteredOrders = filteredOrders.filter((order: Order) => !esEstadoFinal(order.estado))

      if (selectedFecha) {
        filteredOrders = filteredOrders.filter((order: Order) => {
          if (!order.fecha) return false
          const orderDate = new Date(order.fecha).toISOString().split("T")[0]
          return orderDate === selectedFecha
        })
      }

      if (selectedEstado !== "all") {
        filteredOrders = filteredOrders.filter((order: Order) => {
          const estado = order.estado?.toLowerCase().trim()
          if (selectedEstado === "sin_estado") {
            return !estado || estado === ""
          }
          return estado === selectedEstado.toLowerCase()
        })
      }

      if (selectedCliente !== "all") {
        filteredOrders = filteredOrders.filter((order: Order) => order.cliente === selectedCliente)
      }

      if (selectedVendedor !== "all") {
        filteredOrders = filteredOrders.filter((order: Order) => order.vendedor === selectedVendedor)
      }

      if (selectedCiudad !== "all") {
        filteredOrders = filteredOrders.filter((order: Order) => order.destino === selectedCiudad)
      }

      if (selectedPedidos.length > 0) {
        filteredOrders = filteredOrders.filter((order: Order) => order.pedido && selectedPedidos.includes(order.pedido))
      }

      if (selectedOCs.length > 0) {
        filteredOrders = filteredOrders.filter(
          (order: Order) => order.orden_de_compra && selectedOCs.includes(order.orden_de_compra),
        )
      }

      filteredOrders = filteredOrders.filter((order: Order) => order.aprobado === "si")

      setOrders(filteredOrders)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadOrders()
  }, [
    selectedEmpresaId,
    selectedCliente,
    selectedCiudad,
    selectedPedidos,
    selectedOCs,
    selectedFecha,
    selectedEstado,
    selectedVendedor,
  ])

  // Al cambiar la empresa seleccionada en la parte superior, limpiar las
  // selecciones de pedidos y vehículo para evitar arrastrar datos de la
  // empresa anterior.
  useEffect(() => {
    setSelectedOrders([])
    setSelectedOrdersData([])
    setOrderDetails({})
    setUnitsToLoadMap({})
    setVehiculo("")
    setNombreConductor("")
    setPesoDisponible(0)
    setVehicleCapacity(0)
  }, [selectedEmpresaId])

  useEffect(() => {
    const fetchProductStock = async () => {
      const productNames = new Set<string>()
      Object.values(orderDetails).forEach((details) => {
        details.forEach((detail) => {
          if (detail.producto) {
            productNames.add(detail.producto)
          }
        })
      })

      if (productNames.size > 0) {
        // Pass selected bodega ID if selected, otherwise use default
        const bodegaId = selectedBodega !== "all" ? Number.parseInt(selectedBodega, 10) : undefined
        const stockData = await getProductStockFromInvGlobal(Array.from(productNames), bodegaId)
        setProductStock(stockData)
      }
    }

    fetchProductStock()
  }, [orderDetails, selectedBodega])

  const handleOrderSelection = async (orderId: number, checked: boolean) => {
    if (checked) {
      setSelectedOrders((prev) => [...prev, orderId])
      const order = orders.find((o) => o.idpedido === orderId)
      if (order) {
        // Fetch details when an order is selected
        if (!orderDetails[orderId]) {
          const result = await getOrderDetails(orderId)
          if (result.success && result.data) {
            setOrderDetails((prev) => ({
              ...prev,
              [orderId]: result.data,
            }))
            // Initialize unitsToLoadMap for the new order's details
            result.data.forEach((detail: OrderDetail) => {
              const key = `${orderId}-${detail.transid}`
              setUnitsToLoadMap((prevMap) => ({
                ...prevMap,
                [key]: detail.unidadespendientes, // Default to pending units
              }))
            })
          }
        }
        // Add order to selectedOrdersData only if it's not already there (redundant check, but safe)
        setSelectedOrdersData((prev) => {
          if (prev.some((o) => o.idpedido === orderId)) return prev
          return [...prev, order]
        })
      }
    } else {
      setSelectedOrders((prev) => prev.filter((id) => id !== orderId))
      setSelectedOrdersData((prev) => prev.filter((o) => o.idpedido !== orderId))
      // Clean up unitsToLoadMap for the deselected order
      setUnitsToLoadMap((prevMap) => {
        const newMap = { ...prevMap }
        orderDetails[orderId]?.forEach((detail) => {
          delete newMap[`${orderId}-${detail.transid}`]
        })
        return newMap
      })
      // Optionally, clean up orderDetails if no longer needed
      // setOrderDetails(prev => {
      //   const { [orderId]: _, ...rest } = prev;
      //   return rest;
      // });
    }
  }

  const handleVehicleChange = (placa: string) => {
    setVehiculo(placa)
    const selectedVehicle = vehicles.find((v) => v.placa === placa)
    if (selectedVehicle) {
      setNombreConductor(selectedVehicle.nombreconductor)
      setPesoDisponible(selectedVehicle.peso_disponible) // Corrected typo: Peso Disponible
      setVehicleCapacity(selectedVehicle.capacidad || 0) // Set vehicle capacity
      // Autocarga la transportadora de la cita, pero SOLO si sigue vigente. Si
      // la cita trae una que ya no se ofrece, se deja el campo vacío para que
      // la validación obligue a escoger: si se dejara el valor puesto, el
      // desplegable se vería en blanco (no hay opción que lo represente) pero
      // la orden se guardaría igual con esa transportadora, sin que nadie lo vea.
      setTipoTransporte(transporteHabilitado(selectedVehicle.transporte) ? selectedVehicle.transporte! : "")
    } else {
      setNombreConductor("")
      setPesoDisponible(0)
      setVehicleCapacity(0) // Reset vehicle capacity
      setTipoTransporte("") // Reset transportadora
    }
  }

  const getProductsSummary = () => {
    const summary: Record<
      string,
      {
        categoria: string
        producto: string
        totalUnidadesPedidas: number
        totalUnidadesDespachadas: number
        invDisp: number
        idproducto?: number
        peso_unitkg: number
      }
    > = {}

    selectedOrders.forEach((orderId) => {
      const details = orderDetails[orderId] || []
      details.forEach((detail, idx) => {
        const key = detail.producto
        const lineKey = `${orderId}-${detail.transid}` // Use transid for unique line key
        // Use unitsToLoadMap for despachadas, fallback to original if not found
        const cantDesp = unitsToLoadMap[lineKey] ?? detail.unidadespendientes

        if (summary[key]) {
          summary[key].totalUnidadesPedidas += detail.unidadespendientes
          summary[key].totalUnidadesDespachadas += cantDesp
        } else {
          summary[key] = {
            categoria: detail.categoria,
            producto: detail.producto,
            totalUnidadesPedidas: detail.unidadespendientes,
            totalUnidadesDespachadas: cantDesp,
            invDisp: detail.producto ? productStock[detail.producto as any] || 0 : 0,
            idproducto: detail.idproducto,
            peso_unitkg: detail.peso_unitkg || 0,
          }
        }
      })
    })

    return Object.values(summary).sort((a, b) => a.producto.localeCompare(b.producto))
  }

  const hasInventoryIssues = () => {
    const summary = getProductsSummary()
    return summary.some((item) => item.totalUnidadesDespachadas > item.invDisp)
  }

  const handleGenerateLoadOrder = async () => {
    const missing = new Set<string>()

    if (!sinVehiculo && (!vehiculo || !nombreConductor || !tipoTransporte)) {
      if (!vehiculo) missing.add("vehiculo")
      if (!nombreConductor) missing.add("conductor")
      if (!tipoTransporte) missing.add("transporte")
    }

    if (!fechaOrdenCargue) missing.add("fechaCargue")
    if (!fechaEntrega) missing.add("fechaEntrega")

    if (missing.size > 0) {
      setMissingFields(missing)

      toast({
        title: "Campos requeridos",
        description: "Por favor complete todos los campos requeridos (fechas son obligatorias)",
        variant: "destructive",
      })
      return
    }

    setMissingFields(new Set())

    if (hasInventoryIssues()) {
      toast({
        title: "Error",
        description: "No se puede generar la orden. Algunos productos exceden el inventario disponible.",
        variant: "destructive",
      })
      return
    }

    if (selectedOrders.length === 0) {
      toast({
        title: "Error",
        description: "Debe seleccionar al menos un pedido",
        variant: "destructive",
      })
      return
    }

    const partialLines: Array<{
      transid: number
      idpedido: number
      producto: string
      cantPedida: number
      cantDesp: number
      lineKey: string
    }> = []

    selectedOrders.forEach((orderId) => {
      const details = orderDetails[orderId] || []

      details.forEach((detail, idx) => {
        const lineKey = `${orderId}-${detail.transid}` // Use transid for unique line key
        const cantDesp = unitsToLoadMap[lineKey] ?? detail.unidadespendientes // Use unitsToLoadMap

        if (cantDesp < detail.unidadespendientes) {
          partialLines.push({
            transid: detail.transid,
            idpedido: orderId,
            producto: detail.producto,
            cantPedida: detail.unidadespendientes,
            cantDesp: cantDesp,
            lineKey: lineKey,
          })
        }
      })
    })

    if (partialLines.length > 0) {
      setPendingLineClosures(partialLines)
      setShowLineClosureDialog(true)
      return
    }

    await executeGenerateLoadOrder()
  }

  const executeGenerateLoadOrder = async () => {
    setIsGenerating(true) // Use setIsGenerating for the new state variable

    try {
      // Build products list with individual lines per order, preserving cliente and destino
      const productsList: Array<{
        producto: string
        cantidad: number
        toneladas: number
        cliente: string
        destino: string
        idpedido: number
      }> = []

      selectedOrders.forEach((orderId) => {
        const order = selectedOrdersData.find((o) => o.idpedido === orderId)
        const details = orderDetails[orderId] || []

        details.forEach((detail) => {
          const lineKey = `${orderId}-${detail.transid}`
          const cantDesp = unitsToLoadMap[lineKey] ?? detail.unidadespendientes

          if (cantDesp > 0) {
            productsList.push({
              producto: detail.producto,
              cantidad: cantDesp,
              toneladas: (detail.peso_unitkg! * cantDesp) / 1000,
              cliente: order?.cliente || "",
              destino: order?.destino || "",
              idpedido: orderId,
            })
          }
        })
      })
      // </CHANGE>

      const totalWeight = productsList.reduce((sum, item) => sum + item.toneladas, 0)

      const detailUpdates: Array<{
        transid: number
        idpedido: number
        unidadescargadas: number
        estado: "cerrado" | "parcial"
      }> = []

      selectedOrders.forEach((orderId) => {
        const details = orderDetails[orderId] || []

        details.forEach((detail, idx) => {
          const lineKey = `${orderId}-${detail.transid}` // Use transid for unique line key
          const cantDesp = unitsToLoadMap[lineKey] ?? detail.unidadespendientes // Use unitsToLoadMap

          let estado: "cerrado" | "parcial"

          if (cantDesp < detail.unidadespendientes) {
            estado = lineClosureDecisions[lineKey] ? "cerrado" : "parcial"
          } else {
            estado = "cerrado"
          }

          detailUpdates.push({
            transid: detail.transid,
            idpedido: orderId,
            unidadescargadas: cantDesp,
            estado: estado,
          })
        })
      })

      console.log("[v0] Generating load order...")
      const result = await generateLoadOrder({
        selectedOrderIds: selectedOrders,
        sinVehiculo,
        vehiculo: sinVehiculo ? "" : vehiculo,
        nombreConductor: sinVehiculo ? "" : nombreConductor,
        fechaEntrega,
        fechaOrdenCargue,
        tipoTransporte: sinVehiculo ? "" : tipoTransporte,
        productsList,
        totalWeight,
        observaciones,
        detailUpdates,
        tipoOperacion,
        idempresaSeleccionada: selectedBodega !== "all" ? Number.parseInt(selectedBodega, 10) : undefined,
      })

      if (result.success && result.orderData && result.orderId) {
        console.log("[v0] Load order generated successfully, generating PDF...")

        try {
          const { generateAndUploadLoadOrderPDF } = await import("@/lib/pdf-actions")
          const { updateLoadOrderPDFUrl } = await import("@/lib/orders-actions")

          const pdfData = {
            empresaId: result.orderData.empresaId, // Pass empresaId from pedido
            fechaHora: result.orderData.fecha,
            products: result.orderData.productsList,
            totalUnidades: result.orderData.totalUnidades,
            totalPeso: (result.orderData.totalPesoKgs / 1000).toFixed(3),
            placa: result.orderData.placa,
            conductor: result.orderData.conductor,
            transporte: result.orderData.transporte,
            destino: result.orderData.destino || " ",
            observaciones: result.orderData.observaciones || "",
          }
          // </CHANGE>

          const pdfResult = await generateAndUploadLoadOrderPDF(pdfData, result.orderId, result.orderData.orderCode)

          if (pdfResult.success && pdfResult.url) {
            console.log("[v0] PDF generated and uploaded successfully:", pdfResult.url)

            console.log("[v0] Updating PDF URL in cabeceraoc for order ID:", result.orderId)
            const updateResult = await updateLoadOrderPDFUrl(result.orderId, pdfResult.url)

            if (updateResult.success) {
              console.log("[v0] PDF URL saved to database successfully")
            } else {
              console.error("[v0] Error saving PDF URL to database:", updateResult.message)
            }

            window.open(pdfResult.url, "_blank")

            toast({
              title: "Éxito",
              description: `${result.message}. PDF generado exitosamente.`,
            })
          } else {
            console.error("[v0] Error generating PDF:", pdfResult.error)
            toast({
              title: "Advertencia",
              description: `${result.message}. Advertencia: No se pudo generar el PDF.`,
            })
          }
        } catch (pdfError) {
          console.error("[v0] Error generating PDF:", pdfError)
          toast({
            title: "Advertencia",
            description: `${result.message}. Advertencia: No se pudo generar el PDF.`,
            variant: "destructive",
          })
        }

        // Reset state after successful generation
        setSelectedOrders([])
        setOrderDetails({})
        setUnitsToLoadMap({}) // Clear units map
        setVehiculo("")
        setNombreConductor("")
        setFechaEntrega("")
        setFechaOrdenCargue("")
        setCiudad("")
        setObservaciones("")
        setLineClosureDecisions({})
        setSelectedFecha("")
        setSelectedEstado("all")
        setSelectedCliente("all")
        setSelectedCiudad("all")
        setSelectedVendedor("all")
        setSelectedPedidos([])
        setSelectedOCs([])
        setSelectedOrdersData([]) // Clear selected orders data

        loadOrders()
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("[v0] Error generating load order:", error)
      toast({
        title: "Error",
        description: "Error inesperado al generar orden de cargue",
        variant: "destructive",
      })
    } finally {
      setIsGenerating(false) // Use setIsGenerating for the new state variable
    }
  }

  const handleConfirmLineClosures = () => {
    setShowLineClosureDialog(false)
    executeGenerateLoadOrder()
  }

  const handleCancelLineClosures = () => {
    setShowLineClosureDialog(false)
    setPendingLineClosures([])
    setLineClosureDecisions({})
  }

  const toggleLineClosureDecision = (lineKey: string) => {
    setLineClosureDecisions((prev) => ({
      ...prev,
      [lineKey]: !prev[lineKey],
    }))
  }

  const loadVehicles = async () => {
    const vehiclesData = await getVehiclesFromCitas(selectedEmpresaId ?? undefined)
    if (vehiclesData.success && vehiclesData.data) {
      setVehicles(vehiclesData.data as any)
    }
  }

  // This function is not directly used in the current flow but might be useful
  // const getSelectedProducts = () => {
  //   const products: { nombreproducto: string; quantity: number }[] = []

  //   selectedOrders.forEach((orderId) => {
  //     const details = orderDetails[orderId] || []
  //     details.forEach((detail) => {
  //       const productIndex = products.findIndex((p) => p.nombreproducto === detail.producto)
  //       if (productIndex !== -1) {
  //         products[productIndex].quantity += detail.unidadespendientes
  //       } else {
  //         products.push({ nombreproducto: detail.producto, quantity: detail.unidadespendientes })
  //       }
  //     })
  //   })

  //   return products
  // }

  useEffect(() => {
    const calculateWeights = () => {
      const productsSummary = getProductsSummary()
      const totalWeight = productsSummary.reduce(
        (sum, item) => sum + item.peso_unitkg * item.totalUnidadesDespachadas,
        0,
      )
      const availableWeight = vehicles.find((v) => v.placa === vehiculo)?.peso_disponible || 0

      setTotalPesoPedidos(totalWeight)
      setPesoDisponible(availableWeight - totalWeight)
    }

    calculateWeights()
  }, [selectedOrders, orderDetails, vehiculo, unitsToLoadMap]) // Depend on unitsToLoadMap

  useEffect(() => {
    const newCantidadDespachada: Record<string, number> = {}

    selectedOrders.forEach((orderId) => {
      const details = orderDetails[orderId] || []
      details.forEach((detail, idx) => {
        const lineKey = `${orderId}-${detail.transid}` // Use transid for unique line key
        // Initialize with the value from unitsToLoadMap or fallback to pending units
        newCantidadDespachada[lineKey] = unitsToLoadMap[lineKey] ?? detail.unidadespendientes
      })
    })
    // Update initial values for unitsToLoadMap if they haven't been set yet
    selectedOrders.forEach((orderId) => {
      const details = orderDetails[orderId] || []
      details.forEach((detail) => {
        const key = `${orderId}-${detail.transid}` // Use transid for unique line key
        if (unitsToLoadMap[key] === undefined) {
          setUnitsToLoadMap((prev) => ({ ...prev, [key]: detail.unidadespendientes }))
        }
      })
    })

    // This state is now primarily managed by unitsToLoadMap
    // setCantidadDespachada(newCantidadDespachada)
  }, [selectedOrders, orderDetails, unitsToLoadMap]) // Depend on unitsToLoadMap

  const getTotalWeightTons = () => {
    let total = 0
    selectedOrders.forEach((orderId) => {
      const details = orderDetails[orderId] || []
      details.forEach((detail) => {
        const lineKey = `${orderId}-${detail.transid}` // Use transid for unique line key
        const cantDesp = unitsToLoadMap[lineKey] ?? detail.unidadespendientes // Use unitsToLoadMap
        const pesoUnitario = detail.peso_unitkg || 0
        total += (pesoUnitario * cantDesp) / 1000 // Convert to tons
      })
    })
    return total
  }

  const totalWeightTons = getTotalWeightTons()
  const capacityPercentage = vehicleCapacity > 0 ? (totalWeightTons / vehicleCapacity) * 100 : 0
  const isOverCapacity = totalWeightTons > vehicleCapacity && vehicleCapacity > 0

  const getCapacityColor = () => {
    if (capacityPercentage >= 100) return "bg-red-500"
    if (capacityPercentage >= 80) return "bg-orange-500"
    if (capacityPercentage >= 60) return "bg-yellow-500"
    return "bg-green-500"
  }

  // Extract just the names for the cliente filter dropdown
  const clienteOptions = clientes.map((cliente) => cliente.nombre)
  // ---- Solo presentación (gerencia 2026-10-05: "esa lógica está perfecta, ojo con dañar algo ahí";
  // y después: "arriba el vehículo y los otros campos; no se puede suprimir ningún filtro"). La
  // estructura es la de siempre: encabezado de la orden | filtros (todos visibles) | capacidad, y abajo
  // listado de pedidos | pedidos seleccionados. Búsqueda y vista rápida son ADICIONALES sobre los pedidos
  // ya cargados por loadOrders; la promesa viene de pedidoscabecera (select *). ----
  const hoyISO = hoyBogotaISO()
  const promesaDe = (o: Order) => (o.fecha_programada ? String(o.fecha_programada).slice(0, 10) : null)
  const diasAtraso = (o: Order) => {
    const p = promesaDe(o)
    return p ? diasEntreISO(p, hoyISO) : 0
  }
  const esParcial = (o: Order) => String(o.estado ?? "").toLowerCase().trim() === "parcial"
  const coincide = (o: Order) => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return true
    return [o.cliente, o.pedido, o.orden_de_compra, String(o.idpedido), o.destino].some((v) => String(v ?? "").toLowerCase().includes(q))
  }
  const enVista = (o: Order) =>
    vista === "todos" ? true : vista === "hoy" ? promesaDe(o) === hoyISO : vista === "atrasados" ? diasAtraso(o) > 0 : esParcial(o)
  // Mismo orden de siempre (el de loadOrders): la vista rápida y la búsqueda solo filtran, no reordenan.
  const ordenesVisibles = orders.filter((o) => coincide(o) && enVista(o))
  const nHoy = orders.filter((o) => promesaDe(o) === hoyISO).length
  const nAtrasados = orders.filter((o) => diasAtraso(o) > 0).length
  const nParciales = orders.filter(esParcial).length
  const resumen = getProductsSummary()
  const totalUnidades = resumen.reduce((s, i) => s + i.totalUnidadesDespachadas, 0)
  const tonoCapacidad: Tono = capacityPercentage >= 100 ? "critico" : capacityPercentage >= 80 ? "atencion" : capacityPercentage >= 60 ? "info" : "ok"
  const fechaCorta = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number)
    return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
  }
  const chipPromesa = (o: Order) => {
    const p = promesaDe(o)
    if (!p) return <Chip tono="neutro">Sin promesa</Chip>
    const d = diasAtraso(o)
    if (d > 0) return <Chip tono="atencion">Atrasado {d} d</Chip>
    if (p === hoyISO) return <Chip tono="critico">Vence hoy</Chip>
    return <Chip tono="info">{fechaCorta(p)}</Chip>
  }
  const campo = (id: string) => cn("h-9 bg-background text-sm", missingFields.has(id) && "border-2 border-critico-bd")
  const pildora = (activa: boolean) =>
    cn("lg-num inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", activa ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")
  const botonGenerar = (ancho?: boolean) => (
    <Button onClick={handleGenerateLoadOrder} disabled={selectedOrders.length === 0 || isGenerating} className={cn("gap-1.5", ancho && "w-full")}>
      {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
      {isGenerating ? "Generando…" : selectedOrders.length > 0 ? `Generar orden · ${selectedOrders.length} ${selectedOrders.length === 1 ? "pedido" : "pedidos"} · ${totalWeightTons.toFixed(1)} t` : "Generar orden de cargue"}
    </Button>
  )
  const tituloTarjeta = (texto: string, extra?: ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
      <h2 className="text-sm font-semibold">{texto}</h2>
      {extra}
    </div>
  )

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Recepción y Despacho · Órdenes · Cargue</Eyebrow>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Generar orden de cargue</h1>
          <p className="lg-num text-sm text-muted-foreground">
            {orders.length} {orders.length === 1 ? "pedido aprobado" : "pedidos aprobados"} sin orden · {vehicles.length} {vehicles.length === 1 ? "vehículo" : "vehículos"} en cita
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={loading}
            onClick={() => {
              loadOrders()
              toast({ title: "Actualizando datos", description: "Recargando pedidos desde la base de datos..." })
            }}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Actualizar
          </Button>
          {botonGenerar()}
        </div>
      </div>

      {/* Pedidos del día: qué vence hoy, con panel lateral; solo con permiso de este módulo (gerencia 2026-10-05). */}
      <PedidosDelDia empresaId={selectedEmpresaId} />

      {/* FILA SUPERIOR: Encabezado de la orden | Filtros de pedidos | Capacidad del vehículo */}
      <div className="grid gap-3 lg:grid-cols-12">
        {/* Encabezado de la orden */}
        <section className="lg-card lg:col-span-4" aria-label="Encabezado de la orden">
          {tituloTarjeta(
            "Encabezado de la orden",
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <Checkbox
                id="sin-vehiculo"
                checked={sinVehiculo}
                onCheckedChange={(checked) => {
                  setSinVehiculo(checked as boolean)
                  if (checked as boolean) {
                    setVehiculo("")
                    setNombreConductor("")
                    setTipoTransporte("")
                  }
                }}
              />
              Sin vehículo
            </label>,
          )}
          <div className="grid grid-cols-1 gap-2.5 p-4 sm:grid-cols-2">
            {!sinVehiculo && (
              <>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="vehiculo" className="text-xs">Vehículo</Label>
                  <Select value={vehiculo} onValueChange={handleVehicleChange}>
                    <SelectTrigger id="vehiculo" className={campo("vehiculo")}>
                      <SelectValue placeholder={vehicles.length === 0 ? "No hay vehículos en cita" : "Seleccione un vehículo"} />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicles.map((vehicle) => (
                        <SelectItem key={vehicle.placa} value={vehicle.placa}>
                          <span className="lg-num">{vehicle.placa}</span>
                          {vehicle.capacidad ? ` · ${vehicle.capacidad} t` : ""}
                          {vehicle.transporte ? ` · ${vehicle.transporte}` : ""}
                          {vehicle.nombreconductor ? ` · ${vehicle.nombreconductor}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="conductor" className="text-xs">Nombre conductor</Label>
                  <Input id="conductor" value={nombreConductor} disabled className={cn(campo("conductor"), "bg-muted")} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tipoTransporte" className="text-xs">Tipo transporte</Label>
                  <Select value={tipoTransporte} onValueChange={setTipoTransporte}>
                    <SelectTrigger id="tipoTransporte" className={campo("transporte")}><SelectValue placeholder="Seleccione tipo" /></SelectTrigger>
                    <SelectContent>
                      {transportes.map((t) => (
                        <SelectItem key={t.nombretransporte} value={t.nombretransporte}>{t.nombretransporte}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fechaOrdenCargue" className="text-xs">Fecha orden de cargue</Label>
                  <DatePickerField id="fechaOrdenCargue" value={fechaOrdenCargue} onChange={setFechaOrdenCargue} className={campo("fechaCargue")} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fechaEntrega" className="text-xs">Fecha entrega</Label>
                  <DatePickerField id="fechaEntrega" value={fechaEntrega} onChange={setFechaEntrega} className={campo("fechaEntrega")} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="observaciones" className="text-xs">Observaciones</Label>
                  <Textarea id="observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="min-h-[56px] bg-background text-sm" placeholder="Agregar observaciones..." />
                </div>
              </>
            )}
          </div>
        </section>

        {/* Filtros de pedidos — TODOS visibles, en el mismo orden de siempre */}
        <section className="lg-card lg:col-span-5" aria-label="Filtros de pedidos">
          {tituloTarjeta("Filtros de pedidos")}
          <div className="grid grid-cols-2 gap-2.5 p-4 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="bodega-filter" className="text-xs">Bodega</Label>
              <Select value={selectedBodega} onValueChange={setSelectedBodega}>
                <SelectTrigger id="bodega-filter" className="h-9 bg-background text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {bodegas.map((bodega) => (
                    <SelectItem key={bodega.id} value={bodega.id.toString()}>{bodega.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fecha-filter" className="text-xs">Fecha</Label>
              <DatePickerField id="fecha-filter" value={selectedFecha} onChange={setSelectedFecha} className="h-9 bg-background text-sm" />
              {selectedFecha && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedFecha("")} className="h-6 px-1.5 text-xs">Limpiar</Button>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="estado-filter" className="text-xs">Estado</Label>
              <Select value={selectedEstado} onValueChange={setSelectedEstado}>
                <SelectTrigger id="estado-filter" className="h-9 bg-background text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="parcial">Parcial</SelectItem>
                  <SelectItem value="sin_estado">Sin estado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ciudad-filter" className="text-xs">Ciudad</Label>
              <Select value={selectedCiudad} onValueChange={setSelectedCiudad}>
                <SelectTrigger id="ciudad-filter" className="h-9 bg-background text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {ciudadOptions.map((ciudad) => (
                    <SelectItem key={ciudad} value={ciudad}>{ciudad}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cliente-filter" className="text-xs">Cliente</Label>
              <Popover open={openClienteCombobox} onOpenChange={setOpenClienteCombobox}>
                <PopoverTrigger asChild>
                  <Button id="cliente-filter" variant="outline" role="combobox" aria-expanded={openClienteCombobox} className="h-9 w-full justify-between bg-background text-sm font-normal">
                    <span className="truncate">{selectedCliente && selectedCliente !== "all" ? selectedCliente : "Todos"}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] p-0">
                  <Command>
                    <CommandInput placeholder="Buscar cliente..." className="h-9 text-sm" />
                    <CommandEmpty>No se encontró cliente.</CommandEmpty>
                    <CommandGroup>
                      <CommandList>
                        <CommandItem
                          value="all"
                          onSelect={() => {
                            setSelectedCliente("all")
                            setOpenClienteCombobox(false)
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", selectedCliente === "all" ? "opacity-100" : "opacity-0")} />
                          Todos
                        </CommandItem>
                        {clienteOptions.map((cliente) => (
                          <CommandItem
                            key={cliente}
                            value={cliente}
                            onSelect={(currentValue) => {
                              setSelectedCliente(currentValue === selectedCliente ? "all" : currentValue)
                              setOpenClienteCombobox(false)
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedCliente === cliente ? "opacity-100" : "opacity-0")} />
                            {cliente}
                          </CommandItem>
                        ))}
                      </CommandList>
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label htmlFor="vendedor-filter" className="text-xs">Vendedor</Label>
              <Select value={selectedVendedor} onValueChange={setSelectedVendedor}>
                <SelectTrigger id="vendedor-filter" className="h-9 bg-background text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {vendedorOptions.map((vendedor) => (
                    <SelectItem key={vendedor} value={vendedor}>{vendedor}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="oc-filter" className="text-xs">OC</Label>
              <MultiSelect options={ocOptions} selected={selectedOCs} onChange={setSelectedOCs} placeholder="Todas" className="h-9 bg-background text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="busqueda-pedidos" className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input id="busqueda-pedidos" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Cliente, pedido u OC" className="h-9 bg-background pl-8 text-sm" />
              </div>
            </div>
          </div>
        </section>

        {/* Capacidad del vehículo */}
        <section className="lg-card lg:col-span-3" aria-label="Capacidad del vehículo">
          {tituloTarjeta("Capacidad del vehículo", vehiculo ? <span className="lg-num text-xs text-muted-foreground">{vehiculo}</span> : undefined)}
          <div className="flex flex-col gap-3 p-4">
            {vehiculo && vehicleCapacity > 0 ? (
              <>
                <div className="flex items-end justify-between gap-2">
                  <Cifra tamano="compacta" label="Peso cargado" valor={totalWeightTons.toFixed(1)} unidad="t" />
                  <Cifra tamano="compacta" label="Capacidad" valor={vehicleCapacity.toFixed(1)} unidad="t" className="text-right" />
                </div>
                <div className="flex items-center gap-2">
                  <Progreso pct={Math.min(capacityPercentage, 100)} tono={tonoCapacidad} className="flex-1" />
                  <span className={cn("lg-num w-12 text-right text-xs font-semibold", TEXTO_TONO[tonoCapacidad])}>{capacityPercentage.toFixed(0)} %</span>
                </div>
                {isOverCapacity ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-critico-fg"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Capacidad superada</p>
                ) : (
                  <p className="lg-num text-xs text-muted-foreground">Quedan {(vehicleCapacity - totalWeightTons).toFixed(1)} t</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{sinVehiculo ? "Orden sin vehículo: no aplica capacidad." : "Selecciona un vehículo para ver su capacidad frente al peso de los pedidos."}</p>
            )}
            {selectedOrders.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                <Chip tono="info">{selectedOrders.length} {selectedOrders.length === 1 ? "pedido" : "pedidos"}</Chip>
                <Chip tono="neutro">{totalUnidades} und</Chip>
                <Chip tono="neutro">{totalWeightTons.toFixed(1)} t</Chip>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* FILA INFERIOR: Listado de pedidos | Pedidos seleccionados */}
      <div className="grid gap-3 lg:grid-cols-5">
        {/* Listado de pedidos */}
        <section className="lg-card flex flex-col lg:col-span-2" aria-label="Listado de pedidos">
          {tituloTarjeta(
            "Listado de pedidos",
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setVista("todos")} className={pildora(vista === "todos")}>Todos {orders.length}</button>
              <button type="button" onClick={() => setVista("hoy")} className={pildora(vista === "hoy")}><span className="inline-block h-2 w-2 rounded-full bg-red-700" aria-hidden />Vencen hoy {nHoy}</button>
              <button type="button" onClick={() => setVista("atrasados")} className={pildora(vista === "atrasados")}><span className="inline-block h-2 w-2 rounded-full bg-amber-600" aria-hidden />Atrasados {nAtrasados}</button>
              <button type="button" onClick={() => setVista("parciales")} className={pildora(vista === "parciales")}>Parciales {nParciales}</button>
            </div>,
          )}
          <div className="max-h-[calc(100vh-24rem)] overflow-auto">
            {loading ? (
              <div className="p-4"><Esqueleto lineas={6} /></div>
            ) : ordenesVisibles.length === 0 ? (
              <div className="p-4">
                <EstadoVacio titulo={orders.length === 0 ? "No hay pedidos disponibles con los filtros seleccionados" : "Ningún pedido coincide con la búsqueda o la vista"} />
              </div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-10"><span className="sr-only">Seleccionar</span></TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Promesa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordenesVisibles.map((order) => {
                    const sel = selectedOrders.includes(order.idpedido)
                    return (
                      <TableRow key={order.idpedido} className={cn(sel && "bg-ok-bg/60")}>
                        <TableCell>
                          <Checkbox id={`order-${order.idpedido}`} checked={sel} onCheckedChange={(checked) => handleOrderSelection(order.idpedido, checked as boolean)} aria-label={`Seleccionar el pedido ${order.pedido || order.idpedido}`} />
                        </TableCell>
                        <TableCell>
                          <div className="lg-num font-semibold">{order.pedido || order.idpedido}</div>
                          <div className="lg-num text-xs text-muted-foreground">
                            {order.pedido && String(order.pedido) !== String(order.idpedido) ? `#${order.idpedido}` : ""}
                            {order.orden_de_compra ? `${order.pedido && String(order.pedido) !== String(order.idpedido) ? " · " : ""}OC ${order.orden_de_compra}` : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[220px] truncate font-medium" title={order.cliente}>{order.cliente}</div>
                          {order.vendedor && <div className="truncate text-xs text-muted-foreground">{order.vendedor}</div>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{order.destino || "—"}</TableCell>
                        <TableCell>{chipPromesa(order)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
          {!loading && ordenesVisibles.length > 0 && ordenesVisibles.length !== orders.length && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{ordenesVisibles.length} de {orders.length} pedidos.</p>
          )}
        </section>

        {/* Pedidos seleccionados */}
        <section className="lg-card flex flex-col lg:col-span-3" aria-label="Pedidos seleccionados">
          {tituloTarjeta("Pedidos seleccionados", selectedOrders.length > 0 ? <Chip tono="info">{selectedOrders.length} {selectedOrders.length === 1 ? "pedido" : "pedidos"} · {totalUnidades} und · {totalWeightTons.toFixed(1)} t</Chip> : undefined)}
          <div className="px-4 pt-3">{botonGenerar(true)}</div>

          {selectedOrders.length === 0 ? (
            <div className="p-4">
              <EstadoVacio titulo="No hay pedidos seleccionados" texto="Marca uno o varios en el listado; aquí verás sus líneas y podrás ajustar cuánto va en esta orden." />
            </div>
          ) : (
            <div className="max-h-[calc(100vh-24rem)] overflow-auto">
              <div className="flex flex-col gap-2.5 p-4">
                <p className="lg-eyebrow">Detalle de pedidos</p>
                {selectedOrdersData.map((orderData) => (
                  <div key={orderData.idpedido} className="overflow-hidden rounded-xl border border-border">
                    <div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        <b className="lg-num">Pedido {orderData.pedido || orderData.idpedido}</b> · {orderData.cliente}
                        {orderData.destino ? <span className="text-muted-foreground"> · {orderData.destino}</span> : null}
                        {orderData.orden_de_compra ? <span className="text-muted-foreground"> · OC {orderData.orden_de_compra}</span> : null}
                      </span>
                      <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" onClick={() => handleOrderSelection(orderData.idpedido, false)} aria-label={`Quitar el pedido ${orderData.idpedido} de la orden`}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <Table>
                      <TableBody>
                        {orderDetails[orderData.idpedido]?.map((detail) => {
                          const lineKey = `${orderData.idpedido}-${detail.transid}` // Use transid for unique line key
                          const maxToLoad = detail.unidadespendientes
                          const unitsToLoad = unitsToLoadMap[lineKey] ?? maxToLoad
                          const pesoUnitarioKg = detail.peso_unitkg || 0
                          const pesoTotalKg = pesoUnitarioKg * unitsToLoad
                          return (
                            <TableRow key={detail.transid}>
                              <TableCell className="whitespace-normal py-2">
                                <div className="text-sm font-medium leading-tight">{detail.producto}</div>
                                <div className="lg-num text-xs text-muted-foreground">Pendientes: {maxToLoad} · {pesoUnitarioKg.toLocaleString("es-CO", { maximumFractionDigits: 3 })} kg/und</div>
                              </TableCell>
                              <TableCell className="w-24 py-2 text-right">
                                <Label htmlFor={`und-${lineKey}`} className="sr-only">Unidades a cargar</Label>
                                <Input
                                  id={`und-${lineKey}`}
                                  type="number"
                                  min={0}
                                  max={maxToLoad}
                                  value={unitsToLoad}
                                  onChange={(e) => {
                                    const inputValue = e.target.value
                                    if (inputValue === "") {
                                      handleUnitsToLoadChange(lineKey, 0, maxToLoad)
                                    } else {
                                      const value = Number.parseInt(inputValue, 10)
                                      if (!isNaN(value)) {
                                        handleUnitsToLoadChange(lineKey, value, maxToLoad)
                                      }
                                    }
                                  }}
                                  className={cn("lg-num h-8 w-20 text-right text-sm", unitsToLoad < maxToLoad && "border-atencion-bd bg-atencion-bg")}
                                />
                              </TableCell>
                              <TableCell className="lg-num w-28 py-2 text-right text-xs text-muted-foreground">{unitsToLoad > 0 ? `${(pesoTotalKg / 1000).toFixed(3)} t` : "—"}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ))}

                <p className="lg-eyebrow mt-2">Resumen por producto</p>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Total und</TableHead>
                        <TableHead className="text-right">Inv. disp.</TableHead>
                        <TableHead className="text-right">Diferencia</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resumen.map((item, index) => {
                        const diferencia = item.invDisp - item.totalUnidadesDespachadas
                        const hasIssue = diferencia < 0
                        return (
                          <TableRow key={index} className={hasIssue ? "bg-critico-bg/60" : undefined}>
                            <TableCell className="whitespace-normal text-sm">{item.producto}</TableCell>
                            <TableCell className="lg-num text-right font-semibold">{item.totalUnidadesDespachadas}</TableCell>
                            <TableCell className="lg-num text-right">{item.invDisp}</TableCell>
                            <TableCell className="text-right"><Chip tono={hasIssue ? "critico" : "ok"}>{diferencia}</Chip></TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
                {hasInventoryIssues() && (
                  <div className="flex items-start gap-2 rounded-xl border border-critico-bd bg-critico-bg p-3 text-sm text-critico-fg">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <div>
                      <p className="font-semibold">Alerta de inventario</p>
                      <p className="text-xs">Algunos productos tienen cantidades solicitadas mayores al inventario disponible.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Line Closure Dialog */}
      <Dialog open={showLineClosureDialog} onOpenChange={setShowLineClosureDialog}>
        <DialogContent className="max-w-[95vw] md:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Decisión sobre líneas parciales</DialogTitle>
            <DialogDescription>
              Las siguientes líneas tienen cantidades menores a las solicitadas. ¿Desea cerrar estas líneas o mantenerlas abiertas para futuros despachos?
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cant. pedida</TableHead>
                  <TableHead className="text-right">Cant. a despachar</TableHead>
                  <TableHead className="text-center">¿Cerrar línea?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingLineClosures.map((line) => {
                  const lineKey = `${line.idpedido}-${line.transid}`
                  const isClosed = lineClosureDecisions[lineKey] ?? false
                  return (
                    <TableRow key={line.transid}>
                      <TableCell className="lg-num font-semibold">{line.idpedido}</TableCell>
                      <TableCell className="whitespace-normal text-sm">{line.producto}</TableCell>
                      <TableCell className="lg-num text-right">{line.cantPedida}</TableCell>
                      <TableCell className="lg-num text-right">
                        <span className="font-semibold">{line.cantDesp}</span> <Chip tono="atencion" className="ml-1">faltan {line.cantPedida - line.cantDesp}</Chip>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox id={`close-${lineKey}`} checked={isClosed} onCheckedChange={() => toggleLineClosureDecision(lineKey)} aria-label={`Cerrar la línea ${line.producto} del pedido ${line.idpedido}`} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelLineClosures}>Cancelar</Button>
            <Button onClick={handleConfirmLineClosures}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { GenerateLoadOrdersComponent as GenerateLoadOrders }
export default GenerateLoadOrdersComponent
