"use client"
import { useState, useEffect } from "react"
import { updateOrder, getOrderDetails, reemplazarDetallesPedido } from "@/lib/orders-actions"
import {
  getVendedores,
  getClientes,
  getBodegasByCliente,
  getCondicionesPago,
  getTiposDespacho,
  getCategorias,
  getProductos,
  getProductWeight,
  type Bodega,
  type Cliente,
} from "@/lib/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"

interface OrderEditDialogProps {
  isOpen: boolean
  onClose: () => void
  order: any
  onSave: () => void
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
  peso: number
}

export function OrderEditDialog({ isOpen, onClose, order, onSave }: OrderEditDialogProps) {
  // Proyecto activo del selector global — mismo criterio que order-entry-form.tsx,
  // sin esto getClientes() caia a la empresa del PERFIL del usuario.
  const { selectedEmpresaId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Header fields
  const [fechaPedido, setFechaPedido] = useState("")
  const [fechaProgramada, setFechaProgramada] = useState("")
  const [selectedVendedor, setSelectedVendedor] = useState("")
  const [empresa, setEmpresa] = useState("")
  const [selectedCliente, setSelectedCliente] = useState("")
  const [selectedClienteId, setSelectedClienteId] = useState<number | null>(null)
  const [selectedBodega, setSelectedBodega] = useState("")
  const [destino, setDestino] = useState("")
  const [direccion, setDireccion] = useState("")
  const [condicionPago, setCondicionPago] = useState("")
  const [tipoDespacho, setTipoDespacho] = useState("")
  const [ordenCompra, setOrdenCompra] = useState("")
  const [nPedido, setNPedido] = useState("")
  const [observaciones, setObservaciones] = useState("")

  // Discount settings
  const [aplicarDescuentoIVA, setAplicarDescuentoIVA] = useState(false)
  const [aplicarDescuentoPP, setAplicarDescuentoPP] = useState(false)
  const [descuentoPPPercent, setDescuentoPPPercent] = useState<number | string>("")

  // Product lines
  const [products, setProducts] = useState<ProductLine[]>([])

  // Dropdown data
  const [vendedores, setVendedores] = useState<{ nombre: string }[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [condicionesPagoList, setCondicionesPagoList] = useState<{ nombrecondicion: string }[]>([])
  const [tiposDespachoList, setTiposDespachoList] = useState<{ nombretipodespacho: string }[]>([])
  const [categorias, setCategorias] = useState<{ nombre: string }[]>([])
  const [allProductos, setAllProductos] = useState<{ nombre: string; categoria: string; peso_unitkg?: number }[]>([])

  useEffect(() => {
    if (isOpen && order) {
      loadData()
    }
  }, [isOpen, order, selectedEmpresaId])

  const loadData = async () => {
    setLoading(true)
    try {
      // Load all dropdowns in parallel
      const [vendedoresData, clientesData, condicionesData, tiposData, categoriasData, productosData, detailsResult] =
        await Promise.all([
          getVendedores(),
          getClientes(selectedEmpresaId ?? undefined),
          getCondicionesPago(),
          getTiposDespacho(),
          getCategorias(),
          getProductos(),
          getOrderDetails(order.idpedido),
        ])

      setVendedores(vendedoresData)
      setClientes(clientesData)
      setCondicionesPagoList(condicionesData)
      setTiposDespachoList(tiposData)
      setCategorias(categoriasData)
      setAllProductos(productosData)

      // Load header data
      setFechaPedido(order.fecha || "")
      setFechaProgramada(order.fecha_programada || "")
      setSelectedVendedor(order.vendedor || "")
      setEmpresa(order.empresa || "")
      setSelectedCliente(order.cliente || "")
      setDestino(order.destino || "")
      setDireccion(order.direccion || "")
      setCondicionPago(order.condicion_pago || "")
      setTipoDespacho(order.tipo_despacho || "")
      setOrdenCompra(order.orden_de_compra || "")
      setNPedido(order.pedido || "")

      // Find cliente ID
      const clienteFound = clientesData.find((c) => c.nombre === order.cliente)
      if (clienteFound) {
        setSelectedClienteId(clienteFound.id)
        const bodegasData = await getBodegasByCliente(clienteFound.id)
        setBodegas(bodegasData)
      }

      // Detect discount settings from order data
      if (order.descuentoiva && order.descuentoiva > 0) {
        setAplicarDescuentoIVA(true)
      }
      if (order.descuentopp && order.descuentopp > 0) {
        setAplicarDescuentoPP(true)
        // Try to calculate percent from details if available
        if (detailsResult.success && detailsResult.data && detailsResult.data.length > 0) {
          const firstDetail = detailsResult.data[0]
          if (firstDetail.total_linea && firstDetail.total_linea > 0) {
            const percent = (firstDetail.descuentopp / firstDetail.total_linea) * 100
            setDescuentoPPPercent(percent.toFixed(2))
          }
        }
      }

      // Load product lines from details
      if (detailsResult.success && detailsResult.data) {
        const loadedProducts: ProductLine[] = detailsResult.data.map((detail: any) => ({
          id: detail.transid.toString(),
          transid: detail.transid,
          categoria: detail.categoria || "",
          producto: detail.producto || "",
          cantidad: detail.unidades || 0,
          precioUnitario: detail.precio_und || 0,
          totalLinea: detail.total_linea || 0,
          descuentoIVA: detail.iva || 0,
          descuentoPP: detail.descuentopp || 0,
          subtotal: detail.subtotal || 0,
          peso: detail.peso || 0,
        }))
        setProducts(loadedProducts)
      }
    } catch (error) {
      console.error("Error loading order data:", error)
      toast({
        title: "Error",
        description: "No se pudo cargar la información del pedido.",
        variant: "destructive",
      })
    }
    setLoading(false)
  }

  useEffect(() => {
    if (selectedClienteId) {
      loadBodegas()
    } else {
      setBodegas([])
      setSelectedBodega("")
    }
  }, [selectedClienteId])

  const loadBodegas = async () => {
    if (!selectedClienteId) return
    const bodegasData = await getBodegasByCliente(selectedClienteId)
    setBodegas(bodegasData)
  }

  useEffect(() => {
    if (selectedBodega) {
      const bodega = bodegas.find((b) => b.nombrebodega === selectedBodega)
      if (bodega) {
        setDestino(bodega.ciudad)
        setDireccion(bodega.direccion)
      }
    }
  }, [selectedBodega, bodegas])

  const calculateRowValues = (product: ProductLine) => {
    const totalLinea = (product.cantidad || 0) * (product.precioUnitario || 0)
    const descuentoIVA = aplicarDescuentoIVA ? totalLinea * 0.05 : 0
    const ppPercent = typeof descuentoPPPercent === "number" ? descuentoPPPercent : Number(descuentoPPPercent) || 0
    const descuentoPP = aplicarDescuentoPP && ppPercent > 0 ? totalLinea * (ppPercent / 100) : 0
    const subtotal = totalLinea - descuentoIVA - descuentoPP

    return { totalLinea, descuentoIVA, descuentoPP, subtotal }
  }

  const calculateTotals = () => {
    let totalOrden = 0
    let descuentoIVATotal = 0
    let descuentoPPTotal = 0
    let totalPagar = 0
    let pesoTotal = 0

    products.forEach((product) => {
      const { totalLinea, descuentoIVA, descuentoPP, subtotal } = calculateRowValues(product)
      totalOrden += totalLinea
      descuentoIVATotal += descuentoIVA
      descuentoPPTotal += descuentoPP
      totalPagar += subtotal
      pesoTotal += product.peso || 0
    })

    return { totalOrden, descuentoIVATotal, descuentoPPTotal, totalPagar, pesoTotal }
  }

  const totals = calculateTotals()

  const addProductLine = () => {
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
      peso: 0,
    }
    setProducts([...products, newProduct])
  }

  const removeProductLine = (id: string) => {
    setProducts(products.filter((p) => p.id !== id))
  }

  const updateProductLine = async (id: string, field: keyof ProductLine, value: any) => {
    const updatedProducts = [...products]
    const index = updatedProducts.findIndex((p) => p.id === id)
    if (index === -1) return

    updatedProducts[index] = { ...updatedProducts[index], [field]: value }

    // If producto changed, fetch peso
    if (field === "producto") {
      const peso_unitkg = await getProductWeight(value)
      updatedProducts[index].peso = peso_unitkg * (updatedProducts[index].cantidad || 0)

      // Auto-fill category
      const productoData = allProductos.find((p) => p.nombre === value)
      if (productoData) {
        updatedProducts[index].categoria = productoData.categoria
      }
    }

    // If cantidad changed, recalculate peso
    if (field === "cantidad") {
      const peso_unitkg = await getProductWeight(updatedProducts[index].producto)
      updatedProducts[index].peso = peso_unitkg * (value || 0)
    }

    // Recalculate values
    const calculated = calculateRowValues(updatedProducts[index])
    updatedProducts[index].totalLinea = calculated.totalLinea
    updatedProducts[index].descuentoIVA = calculated.descuentoIVA
    updatedProducts[index].descuentoPP = calculated.descuentoPP
    updatedProducts[index].subtotal = calculated.subtotal

    setProducts(updatedProducts)
  }

  useEffect(() => {
    const updatedProducts = products.map((product) => {
      const calculated = calculateRowValues(product)
      return {
        ...product,
        totalLinea: calculated.totalLinea,
        descuentoIVA: calculated.descuentoIVA,
        descuentoPP: calculated.descuentoPP,
        subtotal: calculated.subtotal,
      }
    })
    setProducts(updatedProducts)
  }, [aplicarDescuentoIVA, aplicarDescuentoPP, descuentoPPPercent])

  const getFilteredProducts = (categoria: string) => {
    return allProductos.filter((p) => p.categoria === categoria).map((p) => p.nombre)
  }

  const handleSave = async () => {
    if (!selectedVendedor || !selectedCliente || !empresa) {
      toast({
        title: "Error",
        description: "Por favor complete los campos requeridos: Vendedor, Cliente, Empresa.",
        variant: "destructive",
      })
      return
    }

    if (products.length === 0) {
      toast({
        title: "Error",
        description: "Debe agregar al menos un producto.",
        variant: "destructive",
      })
      return
    }

    setSaving(true)
    try {
      // Update header
      const headerData = {
        fecha: fechaPedido,
        fecha_programada: fechaProgramada,
        vendedor: selectedVendedor,
        cliente: selectedCliente,
        destino,
        direccion,
        empresa,
        medio: selectedBodega,
        condicion_pago: condicionPago,
        tipo_despacho: tipoDespacho,
        orden_de_compra: ordenCompra,
        pedido: nPedido,
        total_linea: totals.totalOrden,
        descuentoiva: totals.descuentoIVATotal,
        descuentopp: totals.descuentoPPTotal,
        total_pagar: totals.totalPagar,
      }

      const headerResult = await updateOrder(order.idpedido, headerData)

      if (!headerResult.success) {
        throw new Error("Error al actualizar cabecera")
      }

      // Las líneas se reemplazan en el servidor, con puerta (Gestionar pedidos › editar).
      // Antes este diálogo borraba e insertaba pedidosdetalle desde el navegador.
      const det = await reemplazarDetallesPedido(
        order.idpedido,
        products.map((product) => ({
          producto: product.producto,
          unidades: product.cantidad,
          precio_und: product.precioUnitario,
          total_linea: product.totalLinea,
          iva: product.descuentoIVA,
          descuentopp: product.descuentoPP,
          subtotal: product.subtotal,
          peso: product.peso,
          categoria: product.categoria,
        })),
      )
      if (!det.success) {
        throw new Error(det.message || "Error al guardar las líneas del pedido")
      }

      toast({
        title: "Éxito",
        description: "Pedido actualizado correctamente.",
      })
      onSave()
      onClose()
    } catch (error: any) {
      console.error("Error saving order:", error)
      toast({
        title: "Error",
        description: error.message || "No se pudo actualizar el pedido.",
        variant: "destructive",
      })
    }
    setSaving(false)
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(
      val || 0,
    )
  }

  if (loading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-7xl max-h-[90vh]">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Pedido #{order?.idpedido}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Header Fields */}
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-sm">Información del Pedido</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-[10px]">
                  Fecha del Pedido <span className="text-red-500">*</span>
                </Label>
                <DatePickerField
                  value={fechaPedido}
                  onChange={setFechaPedido}
                  className="text-[10px] h-7"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">
                  Fecha Programada <span className="text-red-500">*</span>
                </Label>
                <DatePickerField
                  value={fechaProgramada}
                  onChange={setFechaProgramada}
                  className="text-[10px] h-7"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">
                  Vendedor <span className="text-red-500">*</span>
                </Label>
                <Select value={selectedVendedor} onValueChange={setSelectedVendedor}>
                  <SelectTrigger className="text-[10px] h-7 w-full truncate">
                    <SelectValue placeholder="Seleccione vendedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendedores.map((v) => (
                      <SelectItem key={v.nombre} value={v.nombre} className="text-xs">
                        {v.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">
                  Empresa <span className="text-red-500">*</span>
                </Label>
                <Select value={empresa} onValueChange={setEmpresa}>
                  <SelectTrigger className="text-[10px] h-7 w-full truncate">
                    <SelectValue placeholder="Seleccione empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="indupan" className="text-xs">
                      Indupan
                    </SelectItem>
                    <SelectItem value="frigomeat" className="text-xs">
                      Frigomeat
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">
                  Cliente <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={selectedCliente}
                  onValueChange={(val) => {
                    setSelectedCliente(val)
                    const cliente = clientes.find((c) => c.nombre === val)
                    setSelectedClienteId(cliente?.id || null)
                  }}
                >
                  <SelectTrigger className="text-[10px] h-7 w-full truncate">
                    <SelectValue placeholder="Seleccione cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientes.map((c) => (
                      <SelectItem key={c.id} value={c.nombre} className="text-xs">
                        {c.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">
                  Sucursal <span className="text-red-500">*</span>
                </Label>
                <Select value={selectedBodega} onValueChange={setSelectedBodega} disabled={!selectedClienteId}>
                  <SelectTrigger className="text-[10px] h-7 w-full truncate">
                    <SelectValue placeholder="Seleccione sucursal" />
                  </SelectTrigger>
                  <SelectContent>
                    {bodegas.map((b) => (
                      <SelectItem key={b.idbodega} value={b.nombrebodega} className="text-xs">
                        {b.nombrebodega}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">Destino</Label>
                <Input
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                  placeholder="Campo Automático"
                  className="text-[10px] h-7"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">Dirección</Label>
                <Input
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  placeholder="Campo Automático"
                  className="text-[10px] h-7"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">Condición de Pago</Label>
                <Select value={condicionPago} onValueChange={setCondicionPago}>
                  <SelectTrigger className="text-[10px] h-7 w-full truncate">
                    <SelectValue placeholder="Seleccione condición" />
                  </SelectTrigger>
                  <SelectContent>
                    {condicionesPagoList.map((c) => (
                      <SelectItem key={c.nombrecondicion} value={c.nombrecondicion} className="text-xs">
                        {c.nombrecondicion}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">Tipo de Despacho</Label>
                <Select value={tipoDespacho} onValueChange={setTipoDespacho}>
                  <SelectTrigger className="text-[10px] h-7 w-full truncate">
                    <SelectValue placeholder="Seleccione tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {tiposDespachoList.map((t) => (
                      <SelectItem key={t.nombretipodespacho} value={t.nombretipodespacho} className="text-xs">
                        {t.nombretipodespacho}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">Orden de Compra</Label>
                <Input
                  value={ordenCompra}
                  onChange={(e) => setOrdenCompra(e.target.value)}
                  className="text-[10px] h-7"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">N° Pedido</Label>
                <Input value={nPedido} onChange={(e) => setNPedido(e.target.value)} className="text-[10px] h-7" />
              </div>
            </div>
          </div>

          {/* Discount Settings */}
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-sm">Configuración de Descuentos</h3>
            <div className="flex items-center gap-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="descuentoIVA"
                  checked={aplicarDescuentoIVA}
                  onCheckedChange={(checked) => setAplicarDescuentoIVA(checked as boolean)}
                />
                <Label htmlFor="descuentoIVA" className="text-xs cursor-pointer">
                  Aplicar Descuento IVA (5%)
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="descuentoPP"
                  checked={aplicarDescuentoPP}
                  onCheckedChange={(checked) => setAplicarDescuentoPP(checked as boolean)}
                />
                <Label htmlFor="descuentoPP" className="text-xs cursor-pointer">
                  Aplicar Descuento Pronto Pago
                </Label>
              </div>

              {aplicarDescuentoPP && (
                <div className="flex items-center space-x-2">
                  <Label className="text-xs">Porcentaje:</Label>
                  <Input
                    type="number"
                    value={descuentoPPPercent}
                    onChange={(e) => setDescuentoPPPercent(e.target.value)}
                    className="w-20 h-7 text-xs"
                    placeholder="0"
                  />
                  <span className="text-xs">%</span>
                </div>
              )}
            </div>
          </div>

          {/* Product Lines */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Productos</h3>
              <Button size="sm" variant="outline" onClick={addProductLine} className="h-7 text-xs bg-transparent">
                <Plus className="h-3 w-3 mr-1" />
                Agregar Producto
              </Button>
            </div>

            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-32">Categoría</TableHead>
                    <TableHead className="text-xs w-48">Producto</TableHead>
                    <TableHead className="text-xs w-24">Cantidad</TableHead>
                    <TableHead className="text-xs w-32">Precio Unit.</TableHead>
                    <TableHead className="text-xs w-32">Total Línea</TableHead>
                    <TableHead className="text-xs w-32">Desc. IVA</TableHead>
                    <TableHead className="text-xs w-32">Desc. PP</TableHead>
                    <TableHead className="text-xs w-32">Subtotal</TableHead>
                    <TableHead className="text-xs w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <Select
                          value={product.categoria}
                          onValueChange={(val) => updateProductLine(product.id, "categoria", val)}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Categoría" />
                          </SelectTrigger>
                          <SelectContent>
                            {categorias.map((c) => (
                              <SelectItem key={c.nombre} value={c.nombre} className="text-xs">
                                {c.nombre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={product.producto}
                          onValueChange={(val) => updateProductLine(product.id, "producto", val)}
                          disabled={!product.categoria}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Producto" />
                          </SelectTrigger>
                          <SelectContent>
                            {getFilteredProducts(product.categoria).map((p) => (
                              <SelectItem key={p} value={p} className="text-xs">
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={product.cantidad || ""}
                          onChange={(e) => updateProductLine(product.id, "cantidad", Number(e.target.value))}
                          className="h-7 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={product.precioUnitario || ""}
                          onChange={(e) => updateProductLine(product.id, "precioUnitario", Number(e.target.value))}
                          className="h-7 text-xs"
                        />
                      </TableCell>
                      <TableCell className="text-xs">{formatCurrency(product.totalLinea)}</TableCell>
                      <TableCell className="text-xs">{formatCurrency(product.descuentoIVA)}</TableCell>
                      <TableCell className="text-xs">{formatCurrency(product.descuentoPP)}</TableCell>
                      <TableCell className="text-xs font-semibold">{formatCurrency(product.subtotal)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeProductLine(product.id)}
                          className="h-7 w-7 p-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Totals */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <div className="text-xs text-gray-600">Total Orden</div>
                <div className="font-semibold">{formatCurrency(totals.totalOrden)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Descuento IVA</div>
                <div className="font-semibold">{formatCurrency(totals.descuentoIVATotal)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Descuento PP</div>
                <div className="font-semibold">{formatCurrency(totals.descuentoPPTotal)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Total a Pagar</div>
                <div className="font-bold text-lg">{formatCurrency(totals.totalPagar)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Kg Despacho</div>
                <div className="font-semibold">{totals.pesoTotal.toLocaleString("es-CO")} kg</div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Guardar Cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
