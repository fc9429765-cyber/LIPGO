"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Package, MapPin, AlertCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { PalletTransferForm } from "@/components/pallet-transfer-form"
import {
  getLocationsFromSaldoInvDetalle,
  getAllLocationsFromSaldoInvDetalle,
  getProductsFromSaldoInvDetalle,
  getLotesFromSaldoInvDetalle,
  getStockFromSaldoInvDetalle,
  registerProductTransfer,
  getProductosFromSaldoInvDetalleByLocation,
  getLotesFromSaldoInvDetalleByLocationAndProduct,
  getProductByName,
  getDestinationLocationsFromLocationsTable,
} from "@/lib/inventory-actions"
import { useAuth } from "@/components/auth-provider"

export function ProductTransferForm() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const [origenLocations, setOrigenLocations] = useState<string[]>([])
  const [destinoLocations, setDestinoLocations] = useState<string[]>([])
  const [productos, setProductos] = useState<string[]>([])
  const [lotes, setLotes] = useState<string[]>([])

  const [origenLocation, setOrigenLocation] = useState("")
  const [destinoLocation, setDestinoLocation] = useState("")
  const [selectedProduct, setSelectedProduct] = useState("")
  const [selectedProductId, setSelectedProductId] = useState(0)
  const [selectedProductCode, setSelectedProductCode] = useState("")
  const [lote, setLote] = useState("")
  const [cantidad, setCantidad] = useState("")
  const [inventarioDisponible, setInventarioDisponible] = useState(0)
  const [loading, setLoading] = useState(false)
  const [cantidadError, setCantidadError] = useState("")

  useEffect(() => {
    loadOrigenLocations()
    loadDestinoLocations()
  }, [selectedEmpresaId])

  // Load products when origen location changes
  useEffect(() => {
    if (origenLocation) {
      loadProductosByLocation()
    } else {
      setProductos([])
      setSelectedProduct("")
      setSelectedProductId(0)
      setSelectedProductCode("")
    }
  }, [origenLocation])

  useEffect(() => {
    if (origenLocation && selectedProduct) {
      loadLotesByLocationAndProduct()
    } else {
      setLotes([])
      setLote("")
      setInventarioDisponible(0)
    }
  }, [origenLocation, selectedProduct])

  useEffect(() => {
    if (origenLocation && selectedProduct && lote) {
      loadStockActual()
    } else {
      setInventarioDisponible(0)
    }
  }, [origenLocation, selectedProduct, lote])

  useEffect(() => {
    if (cantidad && inventarioDisponible > 0) {
      const cantidadNum = Number.parseFloat(cantidad)
      if (cantidadNum > inventarioDisponible) {
        setCantidadError(
          `No es posible trasladar una cantidad superior al inventario disponible (${inventarioDisponible.toFixed(2)})`,
        )
      } else if (cantidadNum <= 0) {
        setCantidadError("La cantidad debe ser mayor a 0")
      } else {
        setCantidadError("")
      }
    } else {
      setCantidadError("")
    }
  }, [cantidad, inventarioDisponible])

  const loadOrigenLocations = async () => {
    try {
      console.log("[v0] Loading origen locations from saldoinvdetalle (with stock filter)...")
      const data = await getLocationsFromSaldoInvDetalle(undefined, selectedEmpresaId ?? undefined)
      console.log("[v0] Origen locations loaded:", data)
      setOrigenLocations(data)
    } catch (error) {
      console.error("[v0] Error loading origen locations:", error)
      toast({
        title: "Error",
        description: "Error al cargar las localizaciones de origen",
        variant: "destructive",
      })
    }
  }

  const loadDestinoLocations = async () => {
    try {
      console.log("[v0] Loading destino locations from locations table...")
      const data = await getDestinationLocationsFromLocationsTable(selectedEmpresaId ?? undefined)
      console.log("[v0] Destino locations loaded from locations table:", data)
      setDestinoLocations(data)
    } catch (error) {
      console.error("[v0] Error loading destino locations:", error)
      toast({
        title: "Error",
        description: "Error al cargar las localizaciones de destino",
        variant: "destructive",
      })
    }
  }

  const loadProductosByLocation = async () => {
    try {
      console.log("[v0] Loading products from saldoinvdetalle by location:", origenLocation)
      const data = await getProductosFromSaldoInvDetalleByLocation(origenLocation, false, selectedEmpresaId)
      console.log("[v0] Products loaded for location:", data)
      setProductos(data)
      setSelectedProduct("")
      setSelectedProductId(0)
      setSelectedProductCode("")
      setLote("")
      setLotes([])
    } catch (error) {
      console.error("[v0] Error loading productos by location:", error)
      toast({
        title: "Error",
        description: "Error al cargar los productos",
        variant: "destructive",
      })
    }
  }

  const loadLotesByLocationAndProduct = async () => {
    try {
      setLoading(true)
      console.log("[v0] Loading lotes with location:", origenLocation, "product:", selectedProduct)
      const data = await getLotesFromSaldoInvDetalleByLocationAndProduct(origenLocation, selectedProduct, false, selectedEmpresaId)
      console.log("[v0] Lotes loaded:", data)
      setLotes(data)
      setLote("")
      setInventarioDisponible(0)
    } catch (error) {
      console.error("[v0] Error loading lotes:", error)
      toast({
        title: "Error",
        description: "Error al cargar los lotes",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const loadStockActual = async () => {
    try {
      console.log("[v0] Loading stock with product:", selectedProduct, "lote:", lote, "location:", origenLocation)
      const stock = await getStockFromSaldoInvDetalle(selectedProduct, lote, origenLocation)
      console.log("[v0] Stock loaded:", stock)
      setInventarioDisponible(stock ?? 0)
    } catch (error) {
      console.error("[v0] Error loading stock:", error)
      toast({
        title: "Error",
        description: "Error al cargar el inventario disponible",
        variant: "destructive",
      })
    }
  }

  const handleProductSelect = async (productName: string) => {
    console.log("[v0] Product selected:", productName)
    setSelectedProduct(productName)
    
    // Buscar el producto en la tabla productos para obtener id y codigo
    const product = await getProductByName(productName)
    
    if (product) {
      console.log("[v0] Product found with ID:", product.id, "and codigo:", product.codigo)
      setSelectedProductId(product.id)
      setSelectedProductCode(product.codigo)
    } else {
      console.log("[v0] Product not found in productos table, using defaults")
      setSelectedProductId(0)
      setSelectedProductCode("")
    }
  }

  const handleSubmit = async () => {
    if (
      !origenLocation ||
      !destinoLocation ||
      !selectedProduct ||
      !lote ||
      !cantidad ||
      Number.parseFloat(cantidad) <= 0
    ) {
      toast({
        title: "Error",
        description: "Por favor complete todos los campos",
        variant: "destructive",
      })
      return
    }

    if (Number.parseFloat(cantidad) > inventarioDisponible) {
      toast({
        title: "Cantidad Inválida",
        description: `No puede trasladar una cantidad superior al inventario disponible. Inventario disponible: ${inventarioDisponible.toFixed(2)}, Cantidad solicitada: ${cantidad}`,
        variant: "destructive",
      })
      return
    }

    if (origenLocation === destinoLocation) {
      toast({
        title: "Error",
        description: "La localización origen y destino deben ser diferentes",
        variant: "destructive",
      })
      return
    }

    try {
      setLoading(true)

      const result = await registerProductTransfer(
        origenLocation,
        destinoLocation,
        selectedProduct,
        lote,
        Number.parseFloat(cantidad),
        selectedEmpresaId ?? undefined,
      )

      if (!result.success) {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Traslado registrado",
        description: result.message,
      })

      await Promise.all([loadOrigenLocations(), loadDestinoLocations()])

      setCantidadError("")
      setOrigenLocation("")
      setDestinoLocation("")
      setSelectedProduct("")
      setSelectedProductId(0)
      setSelectedProductCode("")
      setLote("")
      setCantidad("")
      setInventarioDisponible(0)
      setLotes([])
      setProductos([])
    } catch (error) {
      console.error("[v0] Error in handleSubmit:", error)
      toast({
        title: "Error",
        description: "Error al registrar el traslado",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Traslados de Producto</h1>
      </div>

      <Tabs defaultValue="localizaciones" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="localizaciones" className="text-xs md:text-sm">
            Traslado de localizaciones
          </TabsTrigger>
          <TabsTrigger value="estibas" className="text-xs md:text-sm">
            Traslado entre estibas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="localizaciones" className="mt-4 md:mt-6">
          <Card>
            <CardContent className="pt-4 md:pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
            {/* Origen Section */}
            <div className="space-y-3 md:space-y-4">
              <div className="flex items-center gap-2 mb-3 md:mb-4">
                <Package className="h-4 w-4 md:h-5 md:w-5 text-cyan-500" />
                <h2 className="text-base md:text-lg font-semibold">Origen</h2>
              </div>

              <div className="space-y-2">
                <Label htmlFor="origen-location" className="text-xs md:text-sm">
                  Localización
                </Label>
                <Select value={origenLocation} onValueChange={setOrigenLocation}>
                  <SelectTrigger id="origen-location" className="h-8 md:h-9 text-xs md:text-sm">
                    <SelectValue placeholder="Seleccione una localización..." />
                  </SelectTrigger>
                  <SelectContent>
                    {origenLocations.map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="producto" className="text-xs md:text-sm">
                  Producto
                </Label>
                <Select value={selectedProduct} onValueChange={handleProductSelect}>
                  <SelectTrigger id="producto" className="h-8 md:h-9 text-xs md:text-sm">
                    <SelectValue placeholder="Seleccione un producto..." />
                  </SelectTrigger>
                  <SelectContent>
                    {productos.map((prod) => (
                      <SelectItem key={prod} value={prod}>
                        {prod}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lote" className="text-xs md:text-sm">
                  Lote
                </Label>
                <Select value={lote} onValueChange={setLote} disabled={!origenLocation || !selectedProduct || loading}>
                  <SelectTrigger id="lote" className="h-8 md:h-9 text-xs md:text-sm">
                    <SelectValue placeholder={loading ? "Cargando lotes..." : "Seleccione un lote..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {lotes.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No hay lotes disponibles
                      </SelectItem>
                    ) : (
                      lotes.map((loteItem) => (
                        <SelectItem key={loteItem} value={loteItem}>
                          {loteItem}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cantidad" className="text-xs md:text-sm">
                  Cantidad a Trasladar
                </Label>
                <Input
                  id="cantidad"
                  type="number"
                  step="0.01"
                  min="0"
                  max={inventarioDisponible}
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  className={`text-right h-8 md:h-9 text-xs md:text-sm ${cantidadError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                  placeholder="0.00"
                />
                {cantidadError && (
                  <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-md p-2">
                    <AlertCircle className="h-3 w-3 md:h-4 md:w-4 mt-0.5 flex-shrink-0" />
                    <span className="font-medium">{cantidadError}</span>
                  </div>
                )}
              </div>

              <div className="bg-cyan-50 border border-cyan-200 rounded-md p-2 md:p-3">
                <div className="flex items-center gap-2 text-cyan-700 text-xs md:text-sm">
                  <span className="font-medium">Inventario Disponible:</span>
                  <span className="font-bold">{inventarioDisponible.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Destino Section */}
            <div className="space-y-3 md:space-y-4">
              <div className="flex items-center gap-2 mb-3 md:mb-4">
                <MapPin className="h-4 w-4 md:h-5 md:w-5 text-cyan-500" />
                <h2 className="text-base md:text-lg font-semibold">Destino</h2>
              </div>

              <div className="space-y-2">
                <Label htmlFor="destino-location" className="text-xs md:text-sm">
                  Localización
                </Label>
                <Select value={destinoLocation} onValueChange={setDestinoLocation}>
                  <SelectTrigger id="destino-location" className="h-8 md:h-9 text-xs md:text-sm">
                    <SelectValue placeholder="Seleccione una localización..." />
                  </SelectTrigger>
                  <SelectContent>
                    {destinoLocations.map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-center mt-6 md:mt-8">
            <Button
              onClick={handleSubmit}
              className="bg-cyan-500 hover:bg-cyan-600 text-white px-6 md:px-8 h-8 md:h-9 text-xs md:text-sm w-full md:w-auto"
              disabled={loading || !!cantidadError}
            >
              Registrar Traslado
            </Button>
          </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="estibas" className="mt-4 md:mt-6">
          <PalletTransferForm />
        </TabsContent>
      </Tabs>
    </div>
  )
}
