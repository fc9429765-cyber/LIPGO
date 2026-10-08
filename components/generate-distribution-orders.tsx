"use client"

import { CommandEmpty } from "@/components/ui/command"
import { useAuth } from "@/components/auth-provider"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandList, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/use-toast"
import { Loader2, Plus, X } from "lucide-react"
import { createClient } from "@/lib/supabase-client"
import { generateDistributionOrder } from "@/lib/orders-actions"
import { getVehiclesForDistribution } from "@/lib/vehicle-actions"
import { Chip, EstadoVacio, Eyebrow } from "@/components/ui/lipgo"
import { Truck } from "lucide-react"

interface Vehicle {
  id: number
  placa: string
  nombreconductor: string
  transporte: string
}

interface Transport {
  id: number
  nombretransporte: string
}

interface Product {
  id: number
  nombre: string
  peso_unitkg?: number
  pesobruto?: number
}

interface DistributionOrderLine {
  id: string
  producto: Product | null
  cantidad: number
  pesoUnitkg: number
  pesoTotal: number
  pesoBrutoUnit: number
  pesoBrutoTotal: number
}

interface DistributionOrderData {
  fechaDistribucion: string
  placaVehiculo: string
  transporte: Transport | null
  tiquete: string
  numeroOrden: string
  pesoBascula: number
  lineas: DistributionOrderLine[]
}

export function GenerateDistributionOrders() {
  const { selectedEmpresaId } = useAuth()
  const [transports, setTransports] = useState<Transport[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [openProductCombobox, setOpenProductCombobox] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [orderData, setOrderData] = useState<DistributionOrderData>({
    fechaDistribucion: new Date().toISOString().split("T")[0],
    placaVehiculo: "",
    transporte: null,
    tiquete: "",
    numeroOrden: "",
    pesoBascula: 0,
    lineas: [],
  })

  // Fetch transports and products when empresa changes
  useEffect(() => {
    if (selectedEmpresaId) {
      loadTransportsAndProducts()
    }
  }, [selectedEmpresaId])

  const loadTransportsAndProducts = async () => {
    try {
      setLoading(true)
      const supabase = await createClient()

      // Fetch transports
      const { data: transportesData, error: transportError } = await supabase
        .from("transportes")
        .select("id, nombretransporte")

      if (!transportError && transportesData) {
        setTransports(transportesData as Transport[])
      }

      // Fetch products
      const { data: productosData, error: productError } = await supabase
        .from("productos")
        .select("id, nombre, peso_unitkg, pesobruto")

      if (!productError && productosData) {
        setProducts(productosData as Product[])
      }

      // Fetch vehicles for distribution from citasvehiculos
      const vehiclesResult = await getVehiclesForDistribution(selectedEmpresaId ?? undefined)
      if (vehiclesResult.success && vehiclesResult.data) {
        setVehicles(vehiclesResult.data as Vehicle[])
      }

      if (transportError || productError) {
        console.error("[v0] Error loading data:", transportError, productError)
        toast({
          title: "Error",
          description: "Error al cargar transportes y productos",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("[v0] Error loading transports and products:", error)
      toast({
        title: "Error",
        description: "Error al cargar transportes y productos",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const addProductLine = () => {
    const newLine: DistributionOrderLine = {
      id: Math.random().toString(36).substr(2, 9),
      producto: null,
      cantidad: 0,
      pesoUnitkg: 0,
      pesoTotal: 0,
      pesoBrutoUnit: 0,
      pesoBrutoTotal: 0,
    }

    setOrderData((prev) => ({
      ...prev,
      lineas: [...prev.lineas, newLine],
    }))
  }

  const removeProductLine = (lineId: string) => {
    setOrderData((prev) => ({
      ...prev,
      lineas: prev.lineas.filter((line) => line.id !== lineId),
    }))
  }

  const updateProductLine = (lineId: string, producto: Product) => {
    setOrderData((prev) => ({
      ...prev,
      lineas: prev.lineas.map((line) => {
        if (line.id === lineId) {
          const newPesoUnitkg = producto.peso_unitkg || 0
          const newPesoBrutoUnit = producto.pesobruto || 0
          const newPesoTotal = line.cantidad * newPesoUnitkg
          const newPesoBrutoTotal = line.cantidad * newPesoBrutoUnit
          return {
            ...line,
            producto,
            pesoUnitkg: newPesoUnitkg,
            pesoTotal: newPesoTotal,
            pesoBrutoUnit: newPesoBrutoUnit,
            pesoBrutoTotal: newPesoBrutoTotal,
          }
        }
        return line
      }),
    }))
  }

  const updateQuantity = (lineId: string, cantidad: number) => {
    setOrderData((prev) => ({
      ...prev,
      lineas: prev.lineas.map((line) => {
        if (line.id === lineId) {
          const newPesoTotal = cantidad * line.pesoUnitkg
          const newPesoBrutoTotal = cantidad * line.pesoBrutoUnit
          return {
            ...line,
            cantidad,
            pesoTotal: newPesoTotal,
            pesoBrutoTotal: newPesoBrutoTotal,
          }
        }
        return line
      }),
    }))
  }

  const getTotalPesoBruto = () => {
    return orderData.lineas.reduce((sum, line) => sum + line.pesoBrutoTotal, 0)
  }

  const getTotalPeso = () => {
    return orderData.lineas.reduce((sum, line) => sum + line.pesoTotal, 0)
  }

  const handleSaveOrder = async () => {
    if (!orderData.placaVehiculo.trim()) {
      toast({
        title: "Error",
        description: "Por favor ingrese la placa del vehículo",
        variant: "destructive",
      })
      return
    }

    if (!orderData.transporte) {
      toast({
        title: "Error",
        description: "Por favor seleccione un transporte",
        variant: "destructive",
      })
      return
    }

    if (orderData.lineas.length === 0) {
      toast({
        title: "Error",
        description: "Por favor agregue al menos un producto a la orden",
        variant: "destructive",
      })
      return
    }

    const lineasConProducto = orderData.lineas.filter((line) => line.producto && line.cantidad > 0)

    if (lineasConProducto.length === 0) {
      toast({
        title: "Error",
        description: "Por favor agregue productos con cantidad mayor a cero",
        variant: "destructive",
      })
      return
    }

    try {
      setSaving(true)

      const result = await generateDistributionOrder({
        selectedEmpresaId: selectedEmpresaId ?? undefined,
        fechaDistribucion: orderData.fechaDistribucion,
        placa: orderData.placaVehiculo,
        transporte: orderData.transporte!.nombretransporte,
        tiquete: orderData.tiquete,
        numeroOrden: orderData.numeroOrden,
        pesoBascula: orderData.pesoBascula,
        lineas: lineasConProducto.map((line) => ({
          id: line.id,
          producto: line.producto as any,
          cantidad: line.cantidad,
          pesoBrutoTotal: line.pesoBrutoTotal,
        })),
        pesoTotalOrden: getTotalPeso(),
        pesoBrutoTotalOrden: getTotalPesoBruto(),
      })

      if (result.success) {
        toast({
          title: "Éxito",
          description: result.message,
        })

        // Reset form
        setOrderData({
          fechaDistribucion: new Date().toISOString().split("T")[0],
          placaVehiculo: "",
          transporte: null,
          tiquete: "",
          numeroOrden: "",
          pesoBascula: 0,
          lineas: [],
        })

        // Reload vehicles to remove the processed one from the list
        const vehiclesResult = await getVehiclesForDistribution(selectedEmpresaId ?? undefined)
        if (vehiclesResult.success && vehiclesResult.data) {
          setVehicles(vehiclesResult.data as Vehicle[])
        }
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("[v0] Error saving distribution order:", error)
      toast({
        title: "Error",
        description: "Error al guardar la orden",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // ---- Solo presentación (gerencia 2026-10-05): el estado, las validaciones y generateDistributionOrder
  // quedan como estaban. Aquí solo cambia cómo se ve la pantalla. El total se sigue mostrando en toneladas. ----
  const lineasValidas = orderData.lineas.filter((l) => l.producto && l.cantidad > 0).length
  const vehiculoSeleccionado = vehicles.find((v) => v.placa === orderData.placaVehiculo) ?? null
  const botonGuardar = (
    <Button onClick={handleSaveOrder} disabled={saving} className="gap-1.5">
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
      {saving ? "Guardando…" : lineasValidas > 0 ? `Guardar orden · ${lineasValidas} ${lineasValidas === 1 ? "producto" : "productos"} · ${(getTotalPeso() / 1000).toFixed(3)} t` : "Guardar orden de distribución"}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Recepción y Despacho · Órdenes · Distribución</Eyebrow>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Generar orden de distribución</h1>
          <p className="lg-num text-sm text-muted-foreground">
            {loading ? "Cargando…" : `${vehicles.length} ${vehicles.length === 1 ? "vehículo disponible" : "vehículos disponibles"} · ${products.length} productos en el catálogo`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.history.back()}>Cancelar</Button>
          <div className="hidden sm:block">{botonGuardar}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* PASO 1 · Vehículo y documento */}
        <section className="lg-card lg:col-span-5" aria-label="Paso 1: vehículo y documento">
          <div className="px-4 pt-4 pb-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
              Vehículo y documento
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fecha-distribucion" className="text-xs">Fecha de distribución</Label>
              <DatePickerField
                id="fecha-distribucion"
                value={orderData.fechaDistribucion}
                onChange={(value) =>
                  setOrderData((prev) => ({
                    ...prev,
                    fechaDistribucion: value,
                  }))
                }
                className="h-9 bg-background text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="placa-vehiculo" className="text-xs">Vehículo · de las citas en portería</Label>
              <Select
                value={orderData.placaVehiculo}
                onValueChange={(value) => {
                  const selectedVehicle = vehicles.find((v) => v.placa === value)
                  setOrderData((prev) => ({
                    ...prev,
                    placaVehiculo: value,
                    // Auto-fill transport if vehicle has one
                    transporte: selectedVehicle?.transporte
                      ? transports.find((t) => t.nombretransporte === selectedVehicle.transporte) || prev.transporte
                      : prev.transporte,
                  }))
                }}
              >
                <SelectTrigger id="placa-vehiculo" className="h-9 bg-background text-sm">
                  <SelectValue placeholder={vehicles.length === 0 ? "No hay vehículos disponibles" : "Seleccionar placa"} />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.length === 0 ? (
                    <SelectItem value="_empty" disabled>No hay vehículos disponibles</SelectItem>
                  ) : (
                    vehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.placa}>
                        <span className="lg-num">{vehicle.placa}</span> · {vehicle.nombreconductor || "sin conductor"}
                        {vehicle.transporte ? ` · ${vehicle.transporte}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {vehiculoSeleccionado && (
                <p className="text-xs text-muted-foreground">Conductor: {vehiculoSeleccionado.nombreconductor || "sin nombre registrado en la cita"}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="transporte" className="text-xs">Transporte</Label>
              <Select
                value={orderData.transporte?.id.toString() || ""}
                onValueChange={(value) => {
                  const selected = transports.find((t) => t.id.toString() === value)
                  setOrderData((prev) => ({ ...prev, transporte: selected || null }))
                }}
              >
                <SelectTrigger id="transporte" className="h-9 bg-background text-sm"><SelectValue placeholder="Seleccionar empresa" /></SelectTrigger>
                <SelectContent>
                  {transports.map((transport) => (
                    <SelectItem key={transport.id} value={transport.id.toString()}>{transport.nombretransporte}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="tiquete" className="text-xs">Tiquete</Label>
              <Input
                id="tiquete"
                placeholder="Número de tiquete"
                value={orderData.tiquete}
                onChange={(e) =>
                  setOrderData((prev) => ({
                    ...prev,
                    tiquete: e.target.value,
                  }))
                }
                className="h-9 bg-background text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="numero-orden" className="text-xs">Número de orden</Label>
              <Input
                id="numero-orden"
                placeholder="Si viene del cliente; si no, se genera"
                value={orderData.numeroOrden}
                onChange={(e) =>
                  setOrderData((prev) => ({
                    ...prev,
                    numeroOrden: e.target.value,
                  }))
                }
                className="h-9 bg-background text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="peso-bascula" className="text-xs">Peso báscula (toneladas)</Label>
              <Input
                id="peso-bascula"
                type="number"
                step="0.001"
                placeholder="0,000"
                value={orderData.pesoBascula === 0 ? "" : orderData.pesoBascula}
                onChange={(e) =>
                  setOrderData((prev) => ({
                    ...prev,
                    pesoBascula: e.target.value ? parseFloat(e.target.value) : 0,
                  }))
                }
                className="lg-num h-9 bg-background text-sm"
              />
            </div>
          </div>
        </section>

        {/* PASO 2 · Productos que se distribuyen */}
        <section className="lg-card lg:col-span-7" aria-label="Paso 2: productos">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
              Productos
            </h2>
            <Button onClick={addProductLine} size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Agregar producto
            </Button>
          </div>

          {orderData.lineas.length === 0 ? (
            <div className="px-4 pb-4">
              <EstadoVacio titulo="Todavía no hay productos en la orden" texto="Agrega una línea por producto: nombre y cantidad. El peso se calcula solo." accion={<Button onClick={addProductLine} size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" />Agregar producto</Button>} />
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="w-28 text-right">Cantidad</TableHead>
                    <TableHead className="hidden w-24 text-right sm:table-cell">kg c/u</TableHead>
                    <TableHead className="w-28 text-right">Peso (kg)</TableHead>
                    <TableHead className="w-10"><span className="sr-only">Quitar</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderData.lineas.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="min-w-[220px]">
                        <Popover
                          open={openProductCombobox[line.id] || false}
                          onOpenChange={(open) =>
                            setOpenProductCombobox((prev) => ({
                              ...prev,
                              [line.id]: open,
                            }))
                          }
                        >
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className={cn("h-9 w-full justify-between bg-background text-sm font-normal", !line.producto && "text-muted-foreground")}>
                              <span className="truncate">{line.producto ? line.producto.nombre : "Seleccionar producto…"}</span>
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[320px] p-0">
                            <Command>
                              <CommandInput placeholder="Buscar producto..." />
                              <CommandList>
                                <CommandEmpty>No se encontró producto.</CommandEmpty>
                                <CommandGroup>
                                  {products.map((product) => (
                                    <CommandItem
                                      value={product.nombre}
                                      key={product.id}
                                      onSelect={() => {
                                        updateProductLine(line.id, product)
                                        setOpenProductCombobox((prev) => ({
                                          ...prev,
                                          [line.id]: false,
                                        }))
                                      }}
                                    >
                                      <Check className={cn("mr-2 h-4 w-4", line.producto?.id === product.id ? "opacity-100" : "opacity-0")} />
                                      {product.nombre}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                      <TableCell>
                        <Label htmlFor={`cant-${line.id}`} className="sr-only">Cantidad</Label>
                        <Input id={`cant-${line.id}`} type="number" min="0" step="0.01" value={line.cantidad || ""} onChange={(e) => updateQuantity(line.id, parseFloat(e.target.value) || 0)} className="lg-num h-9 bg-background text-right text-sm" />
                      </TableCell>
                      <TableCell className="lg-num hidden text-right text-sm text-muted-foreground sm:table-cell">{line.pesoUnitkg.toFixed(2)}</TableCell>
                      <TableCell className="lg-num text-right font-semibold">{line.pesoTotal.toLocaleString("es-CO", { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell>
                        <Button onClick={() => removeProductLine(line.id)} size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Quitar esta línea">
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Total: la suma del detalle (peso_unitkg del catálogo) viene en kg por línea, pero se muestra y registra en toneladas. */}
          {orderData.lineas.length > 0 && (
            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border px-4 py-3">
              <div className="flex flex-wrap gap-2">
                <Chip tono="neutro">{orderData.lineas.length} {orderData.lineas.length === 1 ? "línea" : "líneas"}</Chip>
                {lineasValidas < orderData.lineas.length && <Chip tono="atencion">{orderData.lineas.length - lineasValidas} sin producto o sin cantidad</Chip>}
                {orderData.pesoBascula > 0 && <Chip tono="info">báscula {orderData.pesoBascula.toLocaleString("es-CO", { maximumFractionDigits: 3 })} t</Chip>}
              </div>
              <div className="text-right">
                <p className="lg-eyebrow">Peso total de la orden</p>
                <p className="lg-num text-2xl font-bold leading-tight">{(getTotalPeso() / 1000).toFixed(3)} <span className="text-sm font-medium text-muted-foreground">t</span></p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <Button variant="outline" onClick={() => window.history.back()}>Cancelar</Button>
            {botonGuardar}
          </div>
        </section>
      </div>
    </div>
  )
}
