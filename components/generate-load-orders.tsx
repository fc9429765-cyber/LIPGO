"use client"

import { useState, useEffect } from "react"
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
        getOrderFiltersData(),
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
    const result = await getOrders(undefined, { soloAbiertos: true })
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

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="p-2 lg:p-3 space-y-2">
        {/* Top Row: Encabezado de la orden + Filtros de Pedidos + Capacidad Vehículo */}
        <div className="w-full flex gap-2 lg:gap-3">
          {/* Encabezado de la orden - Left side (smaller card) */}
          <Card className="w-80 flex-shrink-0">
            <CardHeader className="pb-1 py-1.5">
              <CardTitle className="text-xs lg:text-sm">Encabezado de la orden</CardTitle>
            </CardHeader>

            <CardContent className="space-y-2 overflow-y-auto flex-1 px-2 py-1.5 max-h-[200px]">
              <div className="flex items-center space-x-1.5">
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
                  className="h-3 w-3 rounded border-gray-300"
                />
                <Label htmlFor="sin-vehiculo" className="text-[10px] lg:text-xs font-medium cursor-pointer">
                  Sin vehículo
                </Label>
              </div>

              {!sinVehiculo && (
                <>
                  <div className="space-y-0.5">
                    <Label htmlFor="vehiculo" className="text-[10px] lg:text-xs">
                      Vehículo
                    </Label>
                    <Select value={vehiculo} onValueChange={handleVehicleChange}>
                      <SelectTrigger id="vehiculo" className="bg-white h-6 lg:h-7 text-[10px] lg:text-xs">
                        <SelectValue placeholder="Seleccione un vehículo" />
                      </SelectTrigger>
                      <SelectContent>
                        {vehicles.map((vehicle) => (
                          <SelectItem key={vehicle.placa} value={vehicle.placa}>
                            {vehicle.placa}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-0.5">
                    <Label htmlFor="conductor" className="text-[10px] lg:text-xs">
                      Nombre Conductor
                    </Label>
                    <Input
                      id="conductor"
                      value={nombreConductor}
                      disabled
                      className="bg-muted h-6 lg:h-7 text-[10px] lg:text-xs"
                    />
                  </div>

                  <div className="space-y-0.5">
                    <Label htmlFor="tipoTransporte" className="text-[10px] lg:text-xs">
                      Tipo Transporte
                    </Label>
                    <Select value={tipoTransporte} onValueChange={setTipoTransporte}>
                      <SelectTrigger id="tipoTransporte" className="bg-white h-6 lg:h-7 text-[10px] lg:text-xs">
                        <SelectValue placeholder="Seleccione tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {transportes.map((t) => (
                          <SelectItem key={t.nombretransporte} value={t.nombretransporte}>
                            {t.nombretransporte}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-0.5">
                    <Label htmlFor="fechaOrdenCargue" className="text-[10px] lg:text-xs">
                      Fecha Orden de Cargue
                    </Label>
                    <DatePickerField
                      id="fechaOrdenCargue"
                      value={fechaOrdenCargue}
                      onChange={setFechaOrdenCargue}
                      className={`bg-white h-6 lg:h-7 text-[10px] lg:text-xs ${
                        missingFields.has("fechaCargue") ? "border-red-500 border-2" : ""
                      }`}
                    />
                  </div>

                  <div className="space-y-0.5">
                    <Label htmlFor="fechaEntrega" className="text-[10px] lg:text-xs">
                      Fecha Entrega
                    </Label>
                    <DatePickerField
                      id="fechaEntrega"
                      value={fechaEntrega}
                      onChange={setFechaEntrega}
                      className={`bg-white h-6 lg:h-7 text-[10px] lg:text-xs ${
                        missingFields.has("fechaEntrega") ? "border-red-500 border-2" : ""
                      }`}
                    />
                  </div>

                  <div className="space-y-0.5">
                    <Label htmlFor="observaciones" className="text-[10px] lg:text-xs">
                      Observaciones
                    </Label>
                    <Textarea
                      id="observaciones"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      className="bg-white text-[10px] lg:text-xs min-h-12 max-h-20 p-1.5 resize-none"
                      placeholder="Agregar observaciones..."
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Filtros de Pedidos - Middle (flex-1) */}
          <Card className="flex-1">
            <CardHeader className="pb-1 py-1.5">
              {/* CHANGE: Added refresh button next to title */}
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs lg:text-sm">Filtros de Pedidos</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    loadOrders()
                    toast({
                      title: "Actualizando datos",
                      description: "Recargando pedidos desde la base de datos...",
                    })
                  }}
                  disabled={loading}
                  className="h-6 px-2 text-[10px] lg:text-xs"
                >
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  <span className="ml-1 hidden sm:inline">Actualizar</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pb-1.5 pt-1 space-y-2">
              {/* First Row: Bodega, Fecha, Estado, Ciudad (4 columns) */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 lg:gap-2">
                <div className="space-y-0.5">
                  <Label htmlFor="bodega-filter" className="text-[10px] lg:text-xs font-semibold">
                    Bodega
                  </Label>
                  <Select value={selectedBodega} onValueChange={setSelectedBodega}>
                    <SelectTrigger id="bodega-filter" className="bg-white h-6 lg:h-7 text-[10px] lg:text-xs">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {bodegas.map((bodega) => (
                        <SelectItem key={bodega.id} value={bodega.id.toString()}>
                          {bodega.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-0.5">
                  <Label htmlFor="fecha-filter" className="text-[10px] lg:text-xs">
                    Fecha
                  </Label>
                  <div className="space-y-0.5">
                    <DatePickerField
                      id="fecha-filter"
                      value={selectedFecha}
                      onChange={setSelectedFecha}
                      className="bg-white h-6 lg:h-7 text-[10px] lg:text-xs"
                    />
                    {selectedFecha && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedFecha("")}
                        className="h-5 px-1.5 text-[10px] w-full"
                      >
                        Limpiar
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-0.5">
                  <Label htmlFor="estado-filter" className="text-[10px] lg:text-xs">
                    Estado
                  </Label>
                  <Select value={selectedEstado} onValueChange={setSelectedEstado}>
                    <SelectTrigger id="estado-filter" className="bg-white h-6 lg:h-7 text-[10px] lg:text-xs">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="parcial">Parcial</SelectItem>
                      <SelectItem value="sin_estado">Sin estado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-0.5">
                  <Label htmlFor="ciudad-filter" className="text-[10px] lg:text-xs">
                    Ciudad
                  </Label>
                  <Select value={selectedCiudad} onValueChange={setSelectedCiudad}>
                    <SelectTrigger id="ciudad-filter" className="bg-white h-6 lg:h-7 text-[10px] lg:text-xs">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {ciudadOptions.map((ciudad) => (
                        <SelectItem key={ciudad} value={ciudad}>
                          {ciudad}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Second Row: Cliente, Vendedor, OC, Empty (4 columns to match first row) */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 lg:gap-2">
                <div className="space-y-0.5">
                  <Label htmlFor="cliente-filter" className="text-[10px] lg:text-xs">
                    Cliente
                  </Label>
                  <Popover open={openClienteCombobox} onOpenChange={setOpenClienteCombobox}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={openClienteCombobox}
                        className="bg-white h-6 lg:h-7 text-[10px] lg:text-xs w-full justify-between"
                      >
                        {selectedCliente && selectedCliente !== "all" ? selectedCliente : "Todos"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[200px] p-0">
                      <Command>
                        <CommandInput placeholder="Buscar cliente..." className="h-8 text-[10px] lg:text-xs" />
                        <CommandEmpty>No se encontró cliente.</CommandEmpty>
                        <CommandGroup>
                          <CommandList>
                            <CommandItem
                              value="all"
                              onSelect={(currentValue) => {
                                setSelectedCliente(currentValue === selectedCliente ? "all" : "all")
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
                                <Check
                                  className={cn("mr-2 h-4 w-4", selectedCliente === cliente ? "opacity-100" : "opacity-0")}
                                />
                                {cliente}
                              </CommandItem>
                            ))}
                          </CommandList>
                        </CommandGroup>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-0.5">
                  <Label htmlFor="vendedor-filter" className="text-[10px] lg:text-xs">
                    Vendedor
                  </Label>
                  <Select value={selectedVendedor} onValueChange={setSelectedVendedor}>
                    <SelectTrigger id="vendedor-filter" className="bg-white h-6 lg:h-7 text-[10px] lg:text-xs">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {vendedorOptions.map((vendedor) => (
                        <SelectItem key={vendedor} value={vendedor}>
                          {vendedor}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Update starts here */}
                <div className="space-y-0.5">
                  <Label htmlFor="oc-filter" className="text-[10px] lg:text-xs">
                    OC
                  </Label>
                  <MultiSelect
                    options={ocOptions}
                    selected={selectedOCs}
                    onChange={setSelectedOCs}
                    placeholder="Todas"
                    className="bg-white h-6 lg:h-7 text-[10px] lg:text-xs"
                  />
                </div>
                {/* Update ends here */}

                {/* Empty column to align with first row (4 columns total) */}
                <div />
              </div>
              {/* End of Second Row */}
            </CardContent>
          </Card>

          {/* Capacidad Vehículo - Right side */}
          {vehiculo && vehicleCapacity > 0 && (
            <Card className="w-64 flex-shrink-0">
              <CardHeader className="pb-1 py-1.5">
                <CardTitle className="text-xs lg:text-sm">Capacidad Vehículo</CardTitle>
              </CardHeader>
              <CardContent className="pb-1.5 pt-1">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Peso Cargado:</span>
                    <span className="font-semibold">{totalWeightTons.toFixed(3)} ton</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Capacidad:</span>
                    <span className="font-semibold">{vehicleCapacity.toFixed(3)} ton</span>
                  </div>
                  <div className="space-y-0.5">
                    <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-3 transition-all duration-300 ${getCapacityColor()}`}
                        style={{ width: `${Math.min(capacityPercentage, 100)}%` }}
                      />
                    </div>
                    <div className="text-center text-[10px] font-medium">{capacityPercentage.toFixed(1)}%</div>
                  </div>
                  {isOverCapacity && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-1">
                      <p className="text-[9px] lg:text-[10px] text-red-800 font-medium">⚠️ Capacidad superada</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-5 gap-2 lg:gap-3 h-[calc(100vh-13rem)] lg:h-[calc(100vh-14rem)] overflow-hidden">
          {/* Column 1-2: Listado de pedidos (2 column width) */}
          <Card className="flex flex-col overflow-hidden col-span-2">
            <CardHeader className="pb-1.5 pt-2 flex-shrink-0">
              <CardTitle className="text-xs lg:text-sm">Listado de Pedidos</CardTitle>
            </CardHeader>

            <CardContent className="space-y-1.5 overflow-y-auto flex-1 p-1.5">
              {loading && (
                <div className="flex justify-center items-center h-full">
                  <Loader2 className="h-6 w-6 lg:h-8 lg:w-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {!loading && orders.length === 0 && (
                <div className="flex justify-center items-center h-full text-muted-foreground text-[10px] lg:text-xs">
                  <p>No hay pedidos disponibles con los filtros seleccionados</p>
                </div>
              )}

              {!loading && orders.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-8 text-[9px] lg:text-[10px] p-1">Sel.</TableHead>
                        <TableHead className="font-semibold text-[9px] lg:text-[10px] p-1">Pedido</TableHead>
                        <TableHead className="font-semibold text-[9px] lg:text-[10px] p-1">Cliente</TableHead>
                        <TableHead className="font-semibold text-[9px] lg:text-[10px] p-1">Destino</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order) => (
                        <TableRow key={order.idpedido}>
                          <TableCell className="p-1">
                            <Checkbox
                              id={`order-${order.idpedido}`}
                              checked={selectedOrders.includes(order.idpedido)}
                              onCheckedChange={(checked) => handleOrderSelection(order.idpedido, checked as boolean)}
                              className="h-3 w-3"
                            />
                          </TableCell>
                          <TableCell className="text-[9px] lg:text-[10px] p-1">
                            {order.pedido || order.idpedido}
                            {order.orden_de_compra && ` / ${order.orden_de_compra}`}
                          </TableCell>
                          <TableCell className="text-[9px] lg:text-[10px] p-1">{order.cliente}</TableCell>
                          <TableCell className="text-[9px] lg:text-[10px] p-1">{order.destino}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Column 3-5: Pedidos seleccionados (3 columns width) */}
          <Card className="flex flex-col overflow-hidden col-span-3">
            <CardHeader className="pb-1.5 pt-2 space-y-1 flex-shrink-0">
              <div className="flex flex-col gap-1.5">
                <CardTitle className="text-xs lg:text-sm">Pedidos Seleccionados</CardTitle>
                <Button
                  onClick={handleGenerateLoadOrder}
                  disabled={selectedOrders.length === 0 || isGenerating}
                  className="bg-cyan-500 hover:bg-cyan-600 h-6 lg:h-7 text-[10px] lg:text-xs w-full"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      Generando...
                    </>
                  ) : (
                    "Generar Orden"
                  )}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-2 overflow-y-auto flex-1 p-1.5">
              {selectedOrders.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-[10px] lg:text-xs">
                  No hay pedidos seleccionados
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <h3 className="text-[10px] lg:text-xs font-semibold text-muted-foreground px-1">
                      Detalle de Pedidos
                    </h3>
                    <Accordion type="multiple" className="space-y-1.5">
                      {selectedOrdersData.map((orderData) => (
                        <AccordionItem
                          key={orderData.idpedido}
                          value={`order-${orderData.idpedido}`}
                          className="border border-muted rounded-md"
                        >
                          <Card className="border-0">
                            <CardHeader className="pb-1 pt-1.5 px-2">
                              <div className="flex items-center justify-between gap-2">
                                <AccordionTrigger className="flex-1 hover:no-underline py-2 px-3 hover:bg-blue-600 text-white transition-colors [&[data-state=open]>svg]:rotate-180 [&>svg]:text-white bg-cyan-500 rounded-sm">
                                  <div className="flex flex-col items-start gap-1 flex-1">
                                    <div className="text-xs lg:text-sm font-semibold">
                                      Pedido: {orderData.pedido || orderData.idpedido}
                                    </div>
                                    <div className="space-y-0.5 text-[10px] lg:text-xs text-blue-100 text-left">
                                      <p>
                                        Cliente: {orderData.cliente} | Destino: {orderData.destino}
                                      </p>
                                      {orderData.orden_de_compra && <p>OC: {orderData.orden_de_compra}</p>}
                                    </div>
                                  </div>
                                </AccordionTrigger>
                                {/* </CHANGE> */}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleOrderSelection(orderData.idpedido, false)
                                  }}
                                  className="h-5 w-5 p-0 hover:bg-destructive/10"
                                >
                                  <X className="h-3 w-3 text-destructive" />
                                </Button>
                              </div>
                            </CardHeader>
                            <AccordionContent>
                              <CardContent className="pt-1.5 px-2 pb-2">
                                <div className="space-y-1">
                                  {orderDetails[orderData.idpedido]?.map((detail, idx) => {
                                    const lineKey = `${orderData.idpedido}-${detail.transid}` // Use transid for unique line key
                                    const maxToLoad = detail.unidadespendientes
                                    const unitsToLoad = unitsToLoadMap[lineKey] ?? maxToLoad
                                    const pesoUnitarioKg = detail.peso_unitkg || 0
                                    const pesoTotalKg = pesoUnitarioKg * unitsToLoad
                                    const pesoTotalTons = pesoTotalKg / 1000

                                    return (
                                      <div key={detail.transid} className="border-t pt-1 space-y-0.5">
                                        <div className="flex items-center justify-between gap-1">
                                          <div className="flex-1 min-w-0">
                                            <p className="font-medium text-[9px] lg:text-[10px] truncate">
                                              {detail.producto}
                                            </p>
                                            <p className="text-[8px] lg:text-[9px] text-muted-foreground">
                                              Pendientes: {maxToLoad} | Peso: {pesoUnitarioKg.toFixed(3)} kg/und
                                            </p>
                                          </div>
                                          {/* CHANGED: Removed +/- buttons, only input field for direct editing */}
                                          <div className="flex items-center gap-1">
                                            <Input
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
                                              className="w-14 h-6 text-center text-[9px] px-1"
                                            />
                                          </div>
                                        </div>
                                        {unitsToLoad > 0 && (
                                          <p className="text-[8px] lg:text-[9px] text-cyan-600 font-medium">
                                            Peso total: {pesoTotalTons.toFixed(3)} ton
                                          </p>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              </CardContent>
                            </AccordionContent>
                          </Card>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>

                  <div className="border-t-2 pt-2">
                    <h3 className="text-[10px] lg:text-xs font-semibold text-muted-foreground px-1 mb-1.5">
                      Resumen por Producto
                    </h3>
                    <Card className="border-2 border-cyan-500/30 bg-cyan-50/30">
                      <CardContent className="p-2">
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-cyan-100/50">
                                <TableHead className="text-[9px] lg:text-[10px] font-semibold p-1 flex-1">Producto</TableHead>
                                <TableHead className="text-[8px] lg:text-[9px] font-semibold p-0.5 text-right w-16">
                                  Total Unds
                                </TableHead>
                                <TableHead className="text-[8px] lg:text-[9px] font-semibold p-0.5 text-right w-16">
                                  Inv. Disp.
                                </TableHead>
                                <TableHead className="text-[8px] lg:text-[9px] font-semibold p-0.5 text-right w-16">
                                  Diferencia
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {getProductsSummary().map((item, index) => {
                                const diferencia = item.invDisp - item.totalUnidadesDespachadas
                                const hasIssue = diferencia < 0

                                return (
                                  <TableRow
                                    key={index}
                                    className={hasIssue ? "bg-red-50" : index % 2 === 0 ? "bg-white" : "bg-gray-50"}
                                  >
                                    <TableCell className="text-[9px] lg:text-[10px] p-1 flex-1">{item.producto}</TableCell>
                                    <TableCell className="text-[8px] lg:text-[9px] p-0.5 text-right font-medium w-16">
                                      {item.totalUnidadesDespachadas}
                                    </TableCell>
                                    <TableCell className="text-[8px] lg:text-[9px] p-0.5 text-right w-16">
                                      {item.invDisp}
                                    </TableCell>
                                    <TableCell
                                      className={`text-[8px] lg:text-[9px] p-0.5 text-right font-semibold w-16 ${
                                        hasIssue ? "text-red-600" : "text-green-600"
                                      }`}
                                    >
                                      {diferencia}
                                      {hasIssue && " ⚠️"}
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </div>
                        {hasInventoryIssues() && (
                          <div className="mt-2 p-1.5 bg-red-100 border border-red-300 rounded text-[9px] lg:text-[10px] text-red-800">
                            <p className="font-semibold">⚠️ Alerta de Inventario</p>
                            <p>Algunos productos tienen cantidades solicitadas mayores al inventario disponible.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Line Closure Dialog */}
      <Dialog open={showLineClosureDialog} onOpenChange={setShowLineClosureDialog}>
        <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base md:text-lg">Decisión sobre líneas parciales</DialogTitle>
            <DialogDescription className="text-xs md:text-sm">
              Las siguientes líneas tienen cantidades menores a las solicitadas. ¿Desea cerrar estas líneas o
              mantenerlas abiertas para futuros despachos?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="overflow-x-auto -mx-2 md:mx-0">
              <div className="min-w-[500px] md:min-w-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Pedido</TableHead>
                      <TableHead className="text-xs">Producto</TableHead>
                      <TableHead className="text-right text-xs">Cant. Pedida</TableHead>
                      <TableHead className="text-right text-xs">Cant. a Despachar</TableHead>
                      <TableHead className="text-center text-xs">¿Cerrar línea?</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingLineClosures.map((line) => {
                      const lineKey = `${line.idpedido}-${line.transid}`
                      const isClosed = lineClosureDecisions[lineKey] ?? false

                      return (
                        <TableRow key={line.transid}>
                          <TableCell className="text-xs">{line.idpedido}</TableCell>
                          <TableCell className="text-xs">{line.producto}</TableCell>
                          <TableCell className="text-right text-xs">{line.cantPedida}</TableCell>
                          <TableCell className="text-right text-xs">{line.cantDesp}</TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              id={`close-${lineKey}`}
                              checked={isClosed}
                              onCheckedChange={() => toggleLineClosureDecision(lineKey)}
                              className="h-4 w-4"
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelLineClosures}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmLineClosures}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { GenerateLoadOrdersComponent as GenerateLoadOrders }
export default GenerateLoadOrdersComponent
