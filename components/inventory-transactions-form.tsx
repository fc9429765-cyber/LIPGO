"use client"

import type React from "react"
import { Camera, Check, ChevronsUpDown } from "lucide-react"
import { Scan, AlertCircle, ArrowRightLeft } from "lucide-react"
import { getCurrentStock, registerQRPalletFromTransaction, getStockFromSaldoInvDetalle, getProductByName } from "@/lib/inventory-actions"
import { CODIGOS_REQUIEREN_APROBACION } from "@/lib/transacciones-codigo"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useToast } from "@/hooks/use-toast"
import {
  getProductsWithCodes,
  getBatches,
  getLocations,
  getLocationsByProductAndBatch,
  getWarehouses,
  registerInventoryTransaction,
  searchInventoryByQR,
  getLocationsByWarehouse,
  getProductosFromSaldoInvDetalleByLocation,
  getLotesFromSaldoInvDetalleByLocationAndProduct,
} from "@/lib/inventory-actions"
import { QRCameraScanner } from "./qr-camera-scanner"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/auth-provider"

export interface InventoryTransaction {
  id_producto: number
  codigo_producto: string
  producto: string
  lote: string
  localizacion: string
  almacen: string // Changed from number to string to store almacen name
  cantidad: number
  tipo_movimiento: "Entrada" | "Salida" | "Reproceso"
  observaciones?: string
}

export function InventoryTransactionsForm() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [allLocations, setAllLocations] = useState<string[]>([])
  const [productosByLocation, setProductosByLocation] = useState<string[]>([])
  const [lotesByLocationAndProduct, setLotesByLocationAndProduct] = useState<string[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [availableBatches, setAvailableBatches] = useState<string[]>([])
  const [currentStock, setCurrentStock] = useState<number | null>(null)
  const [loadingStock, setLoadingStock] = useState(false)
  const [warehouses, setWarehouses] = useState<{ id: number; nombre: string }[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<number | null>(null)
  const [productoComboOpen, setProductoComboOpen] = useState(false)

  const [transactionMode, setTransactionMode] = useState<"sin-qr" | "con-qr">("sin-qr")
  const [qrCode, setQrCode] = useState("")
  const [qrInventoryData, setQrInventoryData] = useState<any[]>([])
  const [showNewPalletOption, setShowNewPalletOption] = useState(false)
  const [isSearchingQR, setIsSearchingQR] = useState(false)
  const [isQRCameraOpen, setIsQRCameraOpen] = useState(false)

  const [formData, setFormData] = useState({
    id_producto: 0,
    producto: "",
    codigo_producto: "",
    lote: "",
    localizacion: "",
    cantidad: "",
    tipo_movimiento: "",
    cod_movimiento: "", // código de nomenclatura del movimiento
    observaciones: "",
  })

  // Conceptos de la nomenclatura según el tipo de movimiento (código LIPgo).
  const CONCEPTOS: Record<string, { c: string; l: string }[]> = {
    Entrada: [
      { c: "701", l: "Sobrante / Ajuste + (701)" },
      { c: "101", l: "Recepción / Devolución (101)" },
      { c: "561", l: "Inventario inicial (561)" },
    ],
    Salida: [
      { c: "702", l: "Faltante / Ajuste − (702)" },
      { c: "601", l: "Despacho (601)" },
    ],
    Reproceso: [{ c: "551", l: "Merma / Reproceso (551)" }],
  }
  const codigoPorDefecto = (tipo: string) => (tipo === "Entrada" ? "701" : tipo === "Salida" ? "702" : tipo === "Reproceso" ? "551" : "")
  // 601/702 requieren aprobación de Gerencia y NO se registran por este
  // formulario (el servidor también los rechaza): se solicitan en la pestaña
  // "Movimiento por código" y quedan en "Aprobaciones pendientes".
  const codigoActual = formData.cod_movimiento || codigoPorDefecto(formData.tipo_movimiento)
  const requiereAprobacionGerencia = CODIGOS_REQUIEREN_APROBACION.has(codigoActual)

  useEffect(() => {
    loadData()
  }, [selectedEmpresaId])

  // Al cambiar de empresa: limpiar bodega, localizaciones y selecciones dependientes.
  useEffect(() => {
    setAllLocations([])
    setFormData((prev) => ({ ...prev, localizacion: "", producto: "", id_producto: 0, codigo_producto: "", lote: "" }))
    setSelectedWarehouse(null)
    setCurrentStock(null)
  }, [selectedEmpresaId])

  // Las localizaciones dependen de la BODEGA (almacén) elegida: solo se muestran
  // las localizaciones amarradas a esa bodega que además tienen saldo.
  useEffect(() => {
    const loadLocationsForWarehouse = async () => {
      if (!selectedWarehouse) {
        setAllLocations([])
        return
      }
      const locations = await getLocationsByWarehouse(selectedWarehouse, selectedEmpresaId)
      setAllLocations(locations)
    }
    loadLocationsForWarehouse()
    // Al cambiar de bodega, limpiar localización/producto/lote.
    setFormData((prev) => ({ ...prev, localizacion: "", producto: "", id_producto: 0, codigo_producto: "", lote: "" }))
    setCurrentStock(null)
  }, [selectedWarehouse, selectedEmpresaId])

  // When location changes (or el tipo de movimiento cambia), recargar
  // los productos de esa localizacion. Para Salida/Reproceso pasamos
  // `onlyWithStock=true` para que el dropdown solo liste productos con
  // stock_disp > 0 (los unicos con los que tiene sentido ejecutar esos
  // movimientos). Para Entrada pasamos false (todos los productos del
  // location, incluso con stock 0).
  useEffect(() => {
    const loadProductsForLocation = async () => {
      if (formData.localizacion) {
        const onlyWithStock =
          formData.tipo_movimiento === "Salida" ||
          formData.tipo_movimiento === "Reproceso"
        const productos = await getProductosFromSaldoInvDetalleByLocation(
          formData.localizacion,
          onlyWithStock,
          selectedEmpresaId,
        )
        setProductosByLocation(productos)
        // Reset producto and lote when location changes
        setFormData((prev) => ({ ...prev, producto: "", id_producto: 0, codigo_producto: "", lote: "" }))
      } else {
        setProductosByLocation([])
      }
    }
    loadProductsForLocation()
  }, [formData.localizacion, formData.tipo_movimiento, selectedEmpresaId])

  // When location and product change (o el tipo de movimiento cambia),
  // recargar los lotes. Mismo criterio que arriba: filtramos por
  // stock_disp > 0 solo para Salida/Reproceso.
  useEffect(() => {
    const loadLotesForLocationAndProduct = async () => {
      if (formData.localizacion && formData.producto) {
        const onlyWithStock =
          formData.tipo_movimiento === "Salida" ||
          formData.tipo_movimiento === "Reproceso"
        const lotes = await getLotesFromSaldoInvDetalleByLocationAndProduct(
          formData.localizacion,
          formData.producto,
          onlyWithStock,
          selectedEmpresaId,
        )
        setLotesByLocationAndProduct(lotes)
        // Reset lote when product changes
        setFormData((prev) => ({ ...prev, lote: "" }))
      } else {
        setLotesByLocationAndProduct([])
      }
    }
    loadLotesForLocationAndProduct()
  }, [formData.localizacion, formData.producto, formData.tipo_movimiento, selectedEmpresaId])

  useEffect(() => {
    const fetchCurrentStock = async () => {
      if (formData.producto && formData.lote && formData.localizacion) {
        setLoadingStock(true)
        const stock = await getStockFromSaldoInvDetalle(formData.producto, formData.lote, formData.localizacion)
        setCurrentStock(stock)
        setLoadingStock(false)
      } else {
        setCurrentStock(null)
      }
    }

    fetchCurrentStock()
  }, [formData.producto, formData.lote, formData.localizacion])

  // NOTA: Aqui existia un useEffect heredado del flujo anterior
  // (warehouse -> producto -> lote -> localizacion) que al cambiar el
  // lote consultaba `getLocationsByProductAndBatch()` y reseteaba la
  // localizacion si no coincidia con el resultado.
  //
  // BUG: el Select de Localizacion ahora se alimenta de `allLocations`
  // (strings desde saldoinvdetalle), mientras que ese effect comparaba
  // contra objetos `{codigo, ...}` con formato distinto, por lo que el
  // `.some(...)` daba siempre false y se borraba la localizacion en
  // cuanto el usuario elegia un lote.
  //
  // El flujo actual es localizacion -> producto -> lote (alimentado
  // desde saldoinvdetalle), asi que ese effect quedo obsoleto y se
  // elimina por completo. La validacion de stock en handleSubmit
  // sigue garantizando integridad antes de registrar la transaccion.

  const loadData = async () => {
    const [warehousesData, productsData] = await Promise.all([
      getWarehouses(selectedEmpresaId),
      getProductsWithCodes(),
    ])
    setWarehouses(warehousesData)
    setProducts(productsData)
  }

  const loadLocations = async (warehouseId: number) => {
    const locationsData = await getLocations(warehouseId, selectedEmpresaId ?? undefined)
    setLocations(locationsData)
  }

  const loadBatches = async (productId: number) => {
    const batches = await getBatches(productId)
    setAvailableBatches(batches)
    setFormData((prev) => ({ ...prev, lote: "" }))
  }

  const handleProductChange = async (productName: string) => {
    console.log("[v0] Changing product to:", productName)
    // Buscar el producto en la tabla de productos por nombre
    const product = await getProductByName(productName)
    
    if (product) {
      console.log("[v0] Product found with ID:", product.id, "and codigo:", product.codigo)
      setFormData({
        ...formData,
        producto: productName,
        id_producto: product.id,
        codigo_producto: product.codigo,
        lote: "",
      })
    } else {
      console.log("[v0] Product not found, setting with defaults")
      setFormData({
        ...formData,
        producto: productName,
        id_producto: 0,
        codigo_producto: "",
        lote: "",
      })
    }
  }

  const handleQRSearch = async () => {
    if (!qrCode.trim()) {
      toast({
        title: "Error",
        description: "Por favor ingresa un código QR",
        variant: "destructive",
      })
      return
    }

    setIsSearchingQR(true)
    const result = await searchInventoryByQR(qrCode.trim())
    setIsSearchingQR(false)

    if (!result.success) {
      toast({
        title: "Error",
        description: result.error || "Error al buscar el inventario",
        variant: "destructive",
      })
      return
    }

    if (result.hasData && result.data.length > 0) {
      setQrInventoryData(result.data)
      setShowNewPalletOption(false)
      toast({
        title: "QR Encontrado",
        description: `Se encontraron ${result.data.length} registro(s) para este QR`,
      })
    } else {
      setQrInventoryData([])
      setShowNewPalletOption(true)
      toast({
        title: "QR No Encontrado",
        description: "No se encontró inventario para este QR. Puedes registrar una nueva estiba.",
      })
    }
  }

  const handleSelectQRInventoryLine = (line: any) => {
    const product = products.find((p) => p.codigo === line.codproducto)
    setFormData({
      ...formData,
      id_producto: line.idproducto || product?.id || 0,
      producto: line.nombreproducto,
      codigo_producto: line.codproducto,
      lote: line.lote,
      localizacion: line.location,
    })
    setCurrentStock(line.stock_total || 0)
  }

  const handleModeChange = (mode: "sin-qr" | "con-qr") => {
    setTransactionMode(mode)
    setQrCode("")
    setQrInventoryData([])
    setShowNewPalletOption(false)
    setFormData({
      id_producto: 0,
      producto: "",
      codigo_producto: "",
      lote: "",
      localizacion: "",
      cantidad: "",
      tipo_movimiento: "",
      cod_movimiento: "",
      observaciones: "",
    })
    setCurrentStock(null)
  }

  const handleQRCameraScan = (code: string) => {
    setQrCode(code)
    setIsQRCameraOpen(false)
    setTimeout(async () => {
      if (!code.trim()) return

      setIsSearchingQR(true)
      const result = await searchInventoryByQR(code.trim())
      setIsSearchingQR(false)

      if (!result.success) {
        toast({
          title: "Error",
          description: result.error || "Error al buscar el inventario",
          variant: "destructive",
        })
        return
      }

      if (result.hasData && result.data.length > 0) {
        setQrInventoryData(result.data)
        setShowNewPalletOption(false)
        toast({
          title: "QR Encontrado",
          description: `Se encontraron ${result.data.length} registro(s) para este QR`,
        })
      } else {
        setQrInventoryData([])
        setShowNewPalletOption(true)
        toast({
          title: "QR No Encontrado",
          description: "No se encontró inventario para este QR. Puedes registrar una nueva estiba.",
        })
      }
    }, 100)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // For Entrada, lote y localizacion are optional. For Salida and Reproceso, they're required
    const isEntrada = formData.tipo_movimiento === "Entrada"
    
    if (
      !formData.producto ||
      !formData.cantidad ||
      !formData.tipo_movimiento ||
      (!isEntrada && !formData.localizacion) ||
      (!isEntrada && !formData.lote)
    ) {
      toast({
        title: "Error",
        description: "Por favor completa todos los campos requeridos",
        variant: "destructive",
      })
      return
    }

    if (!isEntrada && (formData.tipo_movimiento === "Salida" || formData.tipo_movimiento === "Reproceso")) {
      // Ensure batch is selected for these movement types
      if (!formData.lote) {
        toast({
          title: "Error",
          description: "Debe seleccionar un lote para movimientos de Salida o Reproceso",
          variant: "destructive",
        })
        return
      }

      // Fetch current stock if not already loaded
      let stockToValidate = currentStock
      if (stockToValidate === null) {
        console.log("[v0] Fetching current stock for validation")
        stockToValidate = await getCurrentStock(formData.codigo_producto, formData.lote, formData.localizacion)
        setCurrentStock(stockToValidate)
      }

      console.log("[v0] Validating quantity against stock:", {
        quantity: formData.cantidad,
        currentStock: stockToValidate,
      })

      const quantity = Number.parseFloat(formData.cantidad)

      // If stock is null or 0, don't allow the transaction
      if (stockToValidate === null || stockToValidate === 0) {
        toast({
          title: "Error de Inventario",
          description: `No hay inventario disponible para este producto, lote y localización. No se puede registrar una ${formData.tipo_movimiento.toLowerCase()}.`,
          variant: "destructive",
        })
        return
      }

      // Check if quantity exceeds available stock
      if (quantity > stockToValidate) {
        console.log("[v0] Validation failed: quantity exceeds stock")
        toast({
          title: "Error de Inventario",
          description: `La cantidad a ${formData.tipo_movimiento.toLowerCase()} (${quantity}) supera el inventario disponible (${stockToValidate}). No se pueden generar saldos negativos.`,
          variant: "destructive",
        })
        return
      }
    }

    setIsLoading(true)

    console.log("[v0] Submitting transaction:", formData)

    const warehouseNombre = warehouses.find((w) => w.id === selectedWarehouse)?.nombre || ""

    const result = await registerInventoryTransaction({
      id_producto: formData.id_producto,
      codigo_producto: formData.codigo_producto,
      producto: formData.producto,
      lote: formData.lote,
      localizacion: formData.localizacion,
      almacen: warehouseNombre, // Send warehouse name instead of ID
      cantidad: Number.parseFloat(formData.cantidad),
      tipo_movimiento: formData.tipo_movimiento as "Entrada" | "Salida" | "Reproceso",
      observaciones: formData.observaciones,
      cod_movimiento: formData.cod_movimiento || codigoPorDefecto(formData.tipo_movimiento) || null,
      selectedEmpresaId: selectedEmpresaId ?? undefined,
    })

    console.log("[v0] Transaction result:", result)

    if (result.success && transactionMode === "con-qr" && showNewPalletOption && qrCode.trim()) {
      const product = products.find((p) => p.id === formData.id_producto)
      let fechaVencimiento: string | null = null

      if (product && product.vidautildias) {
        const today = new Date()
        today.setDate(today.getDate() + product.vidautildias)
        fechaVencimiento = today.toISOString().split("T")[0]
      }

      const qrResult = await registerQRPalletFromTransaction({
        qrId: qrCode.trim(),
        idproducto: formData.id_producto,
        nombreproducto: formData.producto,
        codproducto: formData.codigo_producto,
        lote: formData.lote,
        cantidad: Number.parseFloat(formData.cantidad),
        localizacion: formData.localizacion,
        bodega: warehouseNombre,
        tipoMovimiento: formData.tipo_movimiento,
        fechaVencimiento: fechaVencimiento,
      })

      if (!qrResult.success) {
        console.error("[v0] Error registering QR pallet:", qrResult.error)
      }
    }

    setIsLoading(false)

    if (result.success) {
      console.log("[v0] Showing success toast")
      toast({
        title: "Transacción Exitosa",
        description: `La transacción de ${formData.tipo_movimiento.toLowerCase()} se ha registrado correctamente. ${formData.cantidad} unidades de ${formData.producto}.`,
      })
      setFormData({
        id_producto: 0,
        producto: "",
        codigo_producto: "",
        lote: "",
        localizacion: "",
        cantidad: "",
        tipo_movimiento: "",
        cod_movimiento: "",
        observaciones: "",
      })
      setCurrentStock(null)
      setQrCode("")
      setQrInventoryData([])
      setShowNewPalletOption(false)
    } else {
      console.log("[v0] Showing error toast:", result.message)
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
  }

  return (
    <div className="container mx-auto p-4 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">Transacciones de Inventario</h2>
          <p className="text-muted-foreground text-xs md:text-sm">Registra entradas y salidas de inventario</p>
        </div>
      </div>

      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <ArrowRightLeft className="h-4 w-4 md:h-5 md:w-5" />
            Nueva Transacción
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Completa los campos para registrar un movimiento de inventario
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
            <Card className="border-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Modo de Transacción</CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={transactionMode}
                  onValueChange={(value: "sin-qr" | "con-qr") => handleModeChange(value)}
                  className="flex flex-row gap-6"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="sin-qr" id="sin-qr" />
                    <Label htmlFor="sin-qr" className="cursor-pointer">
                      Sin QR
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="con-qr" id="con-qr" />
                    <Label htmlFor="con-qr" className="cursor-pointer">
                      Con QR
                    </Label>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {transactionMode === "con-qr" && (
              <Card className="border-primary/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Scan className="h-4 w-4" />
                    Código QR
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Escanear o escribir código QR"
                      value={qrCode}
                      onChange={(e) => setQrCode(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setIsQRCameraOpen(true)}
                      title="Escanear con cámara"
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                    <Button type="button" onClick={handleQRSearch} disabled={isSearchingQR}>
                      {isSearchingQR ? "Buscando..." : "Buscar"}
                    </Button>
                  </div>

                  {qrInventoryData.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">Inventario disponible en esta estiba:</Label>
                      <div className="border rounded-md overflow-hidden">
                        <div className="max-h-60 overflow-y-auto">
                          {qrInventoryData.map((line, index) => (
                            <div
                              key={index}
                              className="p-3 border-b hover:bg-accent cursor-pointer"
                              onClick={() => handleSelectQRInventoryLine(line)}
                            >
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                                <div>
                                  <span className="font-semibold">Código:</span> {line.codproducto}
                                </div>
                                <div>
                                  <span className="font-semibold">Producto:</span> {line.nombreproducto}
                                </div>
                                <div>
                                  <span className="font-semibold">Lote:</span> {line.lote}
                                </div>
                                <div>
                                  <span className="font-semibold">Ubicación:</span> {line.location}
                                </div>
                                <div>
                                  <span className="font-semibold">Stock:</span>{" "}
                                  <Badge variant="outline">{line.stock_total || 0}</Badge>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {showNewPalletOption && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        No se encontró inventario para este QR. Puedes continuar para registrar una nueva estiba.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <Label htmlFor="almacen" className="text-xs md:text-sm">
                  Almacén <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={selectedWarehouse?.toString() || ""}
                  onValueChange={(value) => setSelectedWarehouse(Number(value))}
                >
                  <SelectTrigger id="almacen" className="h-8 md:h-9 text-xs md:text-sm">
                    <SelectValue placeholder="Seleccionar almacén" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id.toString()}>
                        {warehouse.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tipo_movimiento" className="text-xs md:text-sm">
                  Tipo de Movimiento <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.tipo_movimiento}
                  onValueChange={(value) => setFormData({ ...formData, tipo_movimiento: value, lote: "", cod_movimiento: codigoPorDefecto(value) })}
                >
                  <SelectTrigger id="tipo_movimiento" className="h-8 md:h-9 text-xs md:text-sm">
                    <SelectValue placeholder="Seleccionar tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Entrada">Entrada</SelectItem>
                    <SelectItem value="Salida">Salida</SelectItem>
                    <SelectItem value="Reproceso">Reproceso</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Concepto / código de nomenclatura (lo nuevo). Queda en invtrans.cod_movimiento. */}
              {formData.tipo_movimiento && (
                <div className="space-y-2">
                  <Label htmlFor="cod_movimiento" className="text-xs md:text-sm">
                    Concepto del movimiento (nomenclatura)
                  </Label>
                  <Select
                    value={formData.cod_movimiento || codigoPorDefecto(formData.tipo_movimiento)}
                    onValueChange={(value) => setFormData({ ...formData, cod_movimiento: value })}
                  >
                    <SelectTrigger id="cod_movimiento" className="h-8 md:h-9 text-xs md:text-sm">
                      <SelectValue placeholder="Seleccionar concepto" />
                    </SelectTrigger>
                    <SelectContent>
                      {(CONCEPTOS[formData.tipo_movimiento] || []).map((o) => (
                        <SelectItem key={o.c} value={o.c}>{o.l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Código que identifica el movimiento en el inventario: <b>{formData.cod_movimiento || codigoPorDefecto(formData.tipo_movimiento) || "—"}</b>
                  </p>
                  {requiereAprobacionGerencia && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] md:text-xs text-amber-800">
                      El concepto <b>{codigoActual}</b> requiere aprobación de Gerencia y no se puede registrar desde este formulario. Solicítalo en la
                      pestaña <b>Movimiento por código</b>: queda en <b>Aprobaciones pendientes</b> hasta que Gerencia lo apruebe con su clave. Si es una
                      devolución, merma o despacho con orden, elige el concepto que corresponde.
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="localizacion" className="text-xs md:text-sm">
                  Localización {formData.tipo_movimiento !== "Entrada" && <span className="text-destructive">*</span>}
                </Label>
                <Select
                  value={formData.localizacion}
                  onValueChange={(value) => setFormData({ ...formData, localizacion: value })}
                  disabled={formData.tipo_movimiento === "" }
                >
                  <SelectTrigger id="localizacion" className="h-8 md:h-9 text-xs md:text-sm">
                    <SelectValue placeholder="Seleccionar localización" />
                  </SelectTrigger>
                  <SelectContent>
                    {allLocations.map((location) => (
                      <SelectItem key={location} value={location}>
                        {location}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="producto" className="text-xs md:text-sm">
                  Producto <span className="text-destructive">*</span>
                </Label>
                <Popover open={productoComboOpen} onOpenChange={setProductoComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={productoComboOpen}
                      className="w-full justify-between h-8 md:h-9 text-xs md:text-sm bg-transparent"
                      disabled={!formData.localizacion && formData.tipo_movimiento !== "Entrada"}
                    >
                      {formData.producto || (formData.localizacion || formData.tipo_movimiento === "Entrada" ? "Seleccionar producto" : "Primero selecciona localización")}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start" side="bottom" sideOffset={4}>
                    <Command>
                      <CommandInput placeholder="Buscar producto..." className="h-9" />
                      <CommandList>
                        <CommandEmpty>No se encontró el producto.</CommandEmpty>
                        <CommandGroup>
                          {(formData.tipo_movimiento === "Entrada" ? products : productosByLocation).map((producto) => (
                            <CommandItem
                              key={typeof producto === "string" ? producto : producto.nombre}
                              value={typeof producto === "string" ? producto : producto.nombre}
                              onSelect={(currentValue) => {
                                handleProductChange(currentValue === formData.producto ? "" : currentValue)
                                setProductoComboOpen(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  formData.producto === (typeof producto === "string" ? producto : producto.nombre) ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {typeof producto === "string" ? producto : producto.nombre}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lote" className="text-xs md:text-sm">
                  Lote {formData.tipo_movimiento !== "Entrada" && <span className="text-destructive">*</span>}
                </Label>
                {formData.tipo_movimiento === "Entrada" ? (
                  // For Entrada, allow manual input
                  <Input
                    id="lote"
                    value={formData.lote}
                    onChange={(e) => setFormData({ ...formData, lote: e.target.value })}
                    placeholder="Ingresa el lote"
                    className="h-8 md:h-9 text-xs md:text-sm"
                  />
                ) : (
                  // For Salida and Reproceso, use dropdown
                  <Select
                    value={formData.lote}
                    onValueChange={(value) => setFormData({ ...formData, lote: value })}
                    disabled={!formData.localizacion || !formData.producto || lotesByLocationAndProduct.length === 0}
                  >
                    <SelectTrigger id="lote" className="h-8 md:h-9 text-xs md:text-sm">
                      <SelectValue
                        placeholder={
                          !formData.localizacion
                            ? "Selecciona localización"
                            : !formData.producto
                              ? "Selecciona producto"
                              : lotesByLocationAndProduct.length === 0
                                ? "No hay lotes disponibles"
                                : "Seleccionar lote"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {lotesByLocationAndProduct.map((lote) => (
                        <SelectItem key={lote} value={lote}>
                          {lote}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="codigo_producto" className="text-xs md:text-sm">
                  Código Producto
                </Label>
                <Input
                  id="codigo_producto"
                  value={formData.codigo_producto}
                  disabled
                  className="bg-muted h-8 md:h-9 text-xs md:text-sm"
                  placeholder="Se completa automáticamente"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cantidad" className="text-xs md:text-sm">
                  Cantidad <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cantidad"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cantidad}
                  onChange={(e) => setFormData({ ...formData, cantidad: e.target.value })}
                  placeholder="0.00"
                  className="h-8 md:h-9 text-xs md:text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="inventario_actual" className="text-xs md:text-sm">
                  Inventario Actual
                </Label>
                <Input
                  id="inventario_actual"
                  value={
                    loadingStock
                      ? "Cargando..."
                      : currentStock !== null
                        ? currentStock.toFixed(2)
                        : formData.codigo_producto && formData.lote && formData.localizacion
                          ? "0.00"
                          : "Seleccione localización, producto y lote"
                  }
                  disabled
                  className={`bg-muted h-8 md:h-9 text-xs md:text-sm ${currentStock !== null && currentStock > 0 ? "text-green-600 font-semibold" : currentStock === 0 ? "text-red-600 font-semibold" : ""}`}
                  placeholder="Inventario disponible"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="observaciones" className="text-xs md:text-sm">
                Observaciones
              </Label>
              <Textarea
                id="observaciones"
                value={formData.observaciones}
                onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                placeholder="Ingrese observaciones adicionales (opcional)"
                className="h-8 md:h-9 text-xs md:text-sm"
              />
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={isLoading || requiereAprobacionGerencia}
                size="lg"
                className="w-full md:w-auto h-8 md:h-10 text-xs md:text-sm"
              >
                {isLoading ? "Registrando..." : requiereAprobacionGerencia ? "Requiere aprobación de Gerencia" : "Registrar Transacción"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <QRCameraScanner isOpen={isQRCameraOpen} onClose={() => setIsQRCameraOpen(false)} onScan={handleQRCameraScan} />
    </div>
  )
}
