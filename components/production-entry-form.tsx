"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { getProductsWithCodes } from "@/lib/inventory-actions"
import { registerProductionEntries } from "@/lib/inventory-actions"
import type { ProductWithCode } from "@/lib/inventory-actions"
import { Building2, PackagePlus, Plus, Trash2 } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface ProductLine {
  id: string
  id_producto: number
  producto: string
  codigo_producto: string
  lote: string
  cantidad: string
  observaciones: string
  fechavencimiento: string
  fechaproduccion: string
  // Hora REAL de produccion del lote ("HH:MM"). Es lo que usa Liquidación
  // Tolva para repartir las toneladas entre Turno 1 y Turno 2. No se deduce de
  // la hora de registro: si la produccion de un dia se registra al dia
  // siguiente, esa hora no tiene nada que ver con el turno que la produjo.
  horaproduccion: string
}

export function ProductionEntryForm() {
  const { toast } = useToast()
  // Filtro dinamico de empresa desde la barra superior
  const { selectedEmpresaId, selectedEmpresaNombre, profile } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [products, setProducts] = useState<ProductWithCode[]>([])
  const [productoComboOpen, setProductoComboOpen] = useState(false)

  const [productLines, setProductLines] = useState<ProductLine[]>([])

  const [loteInputMode, setLoteInputMode] = useState<"date" | "manual">("date")
  const [loteDate, setLoteDate] = useState("")

  const [currentLine, setCurrentLine] = useState({
    id_producto: 0,
    producto: "",
    codigo_producto: "",
    lote: generateLote(),
    cantidad: "",
    observaciones: "",
    fechavencimiento: "",
    fechaproduccion: "",
    horaproduccion: "",
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const productsData = await getProductsWithCodes()
    setProducts(productsData)
  }

  function generateLote() {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    return `${year}${month}${day}`
  }

  const handleLoteDateChange = (dateString: string) => {
    setLoteDate(dateString)
    if (dateString) {
      const formattedLote = dateString.replace(/-/g, "")
      setCurrentLine({ ...currentLine, lote: formattedLote })
    }
  }

  const handleLoteInputModeChange = (mode: "date" | "manual") => {
    setLoteInputMode(mode)
    if (mode === "date") {
      const today = new Date()
      const todayString = today.toISOString().split("T")[0]
      setLoteDate(todayString)
      setCurrentLine({ ...currentLine, lote: generateLote() })
    } else {
      setLoteDate("")
    }
  }

  const handleProductChange = (productName: string) => {
    const product = products.find((p) => p.nombre === productName)

    let calculatedExpirationDate = ""
    if (product?.vidautildias) {
      const today = new Date()
      today.setDate(today.getDate() + product.vidautildias)
      calculatedExpirationDate = today.toISOString().split("T")[0]
    }

    setCurrentLine({
      ...currentLine,
      producto: productName,
      id_producto: product?.id || 0,
      codigo_producto: product?.codigo || "",
      fechavencimiento: calculatedExpirationDate,
    })
  }

  const handleAddLine = () => {
    if (!currentLine.producto || !currentLine.cantidad) {
      toast({
        title: "Error",
        description: "Por favor completa los campos obligatorios: Producto y Cantidad",
        variant: "destructive",
      })
      return
    }

    const newLine: ProductLine = {
      id: Date.now().toString(),
      id_producto: currentLine.id_producto,
      producto: currentLine.producto,
      codigo_producto: currentLine.codigo_producto,
      lote: currentLine.lote,
      cantidad: currentLine.cantidad,
      observaciones: currentLine.observaciones,
      fechavencimiento: currentLine.fechavencimiento,
      fechaproduccion: currentLine.fechaproduccion,
      horaproduccion: currentLine.horaproduccion,
    }

    setProductLines([...productLines, newLine])

    const newLote = generateLote()
    setCurrentLine({
      id_producto: 0,
      producto: "",
      codigo_producto: "",
      lote: newLote,
      cantidad: "",
      observaciones: "",
      fechavencimiento: "",
      fechaproduccion: "",
      horaproduccion: "",
    })

    if (loteInputMode === "date") {
      const today = new Date().toISOString().split("T")[0]
      setLoteDate(today)
    }

    toast({
      title: "Línea agregada",
      description: "La línea de producto se agregó correctamente",
    })
  }

  const handleRemoveLine = (lineId: string) => {
    setProductLines(productLines.filter((line) => line.id !== lineId))
    toast({
      title: "Línea eliminada",
      description: "La línea de producto se eliminó correctamente",
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (productLines.length === 0) {
      toast({
        title: "Error",
        description: "Debes agregar al menos una línea de producto",
        variant: "destructive",
      })
      return
    }

    // Validar que haya una empresa seleccionada en el filtro dinamico de la barra superior
    if (!selectedEmpresaId) {
      toast({
        title: "Empresa no seleccionada",
        description: "Selecciona una empresa en el filtro de la barra superior antes de registrar el ingreso.",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)

    const entries = productLines.map((line) => ({
      id_producto: line.id_producto,
      codigo_producto: line.codigo_producto,
      producto: line.producto,
      lote: line.lote,
      cantidad: Number.parseFloat(line.cantidad),
      observaciones: line.observaciones,
      fechavencimiento: line.fechavencimiento || null,
      fechaproduccion: line.fechaproduccion || null,
      horaproduccion: line.horaproduccion || null,
    }))

    // Pasar el id de empresa del filtro dinamico para que el ingreso quede asociado a la empresa correcta
    const result = await registerProductionEntries(entries, selectedEmpresaId)

    setIsLoading(false)

    if (result.success) {
      toast({
        title: "Ingreso Exitoso",
        description: `Se registraron ${productLines.length} línea(s) de producción correctamente.`,
      })

      if (result.pdfUrl) {
        const link = document.createElement("a")
        link.href = result.pdfUrl
        link.download = `ingreso_produccion_${Date.now()}.pdf`
        link.target = "_blank"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }

      setProductLines([])
      const newLote = generateLote()
      setCurrentLine({
        id_producto: 0,
        producto: "",
        codigo_producto: "",
        lote: newLote,
        cantidad: "",
        observaciones: "",
        fechavencimiento: "",
        fechaproduccion: "",
        horaproduccion: "",
      })

      if (loteInputMode === "date") {
        const today = new Date().toISOString().split("T")[0]
        setLoteDate(today)
      }
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
  }

  // Nombre de empresa a mostrar: prioriza el filtro dinamico, cae al de la sesion del usuario
  const empresaActivaNombre = selectedEmpresaNombre || profile?.empresa_nombre || null

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">Ingreso de Producción</h2>
          <p className="text-xs md:text-sm text-muted-foreground">Registra entradas de productos desde producción</p>
        </div>
        {/* Indicador visual de la empresa activa proveniente del filtro dinamico de la barra superior */}
        {selectedEmpresaId ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs md:text-sm">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Empresa activa:</span>
            <span className="font-semibold text-foreground">{empresaActivaNombre || `ID ${selectedEmpresaId}`}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs md:text-sm text-amber-900">
            <Building2 className="h-4 w-4" />
            <span>Selecciona una empresa en la barra superior para registrar ingresos</span>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <PackagePlus className="h-4 w-4 md:h-5 md:w-5" />
            Agregar Línea de Producto
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Completa los campos y agrega líneas de productos para el ingreso
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 md:space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-3 md:gap-4">
              <div className="space-y-2 sm:col-span-2 lg:col-span-1 xl:col-span-2">
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
                    >
                      {currentLine.producto || "Seleccionar producto"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" side="bottom" sideOffset={4}>
                    <Command>
                      <CommandInput placeholder="Buscar producto..." className="h-9" />
                      <CommandList>
                        <CommandEmpty>No se encontraron productos.</CommandEmpty>
                        <CommandGroup>
                          {products.map((product) => (
                            <CommandItem
                              key={product.id}
                              value={product.nombre}
                              onSelect={(value) => {
                                handleProductChange(value)
                                setProductoComboOpen(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  currentLine.producto === product.nombre ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {product.nombre}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="codigo_producto" className="text-xs md:text-sm">
                  Código
                </Label>
                <Input
                  id="codigo_producto"
                  value={currentLine.codigo_producto}
                  disabled
                  className="bg-muted h-8 md:h-9 text-xs md:text-sm"
                  placeholder="Automático"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lote_mode" className="text-xs md:text-sm">
                  Tipo de Lote
                </Label>
                <Select
                  value={loteInputMode}
                  onValueChange={(value: "date" | "manual") => handleLoteInputModeChange(value)}
                >
                  <SelectTrigger id="lote_mode" className="h-8 md:h-9 text-xs md:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date" className="text-xs md:text-sm">
                      Por Fecha
                    </SelectItem>
                    <SelectItem value="manual" className="text-xs md:text-sm">
                      Manual
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lote" className="text-xs md:text-sm">
                  Lote
                </Label>
                {loteInputMode === "date" ? (
                  <Input
                    id="lote"
                    type="date"
                    value={loteDate}
                    onChange={(e) => handleLoteDateChange(e.target.value)}
                    className="h-8 md:h-9 text-xs md:text-sm"
                  />
                ) : (
                  <Input
                    id="lote"
                    type="text"
                    value={currentLine.lote}
                    onChange={(e) => setCurrentLine({ ...currentLine, lote: e.target.value })}
                    placeholder="Ingrese lote"
                    className="h-8 md:h-9 text-xs md:text-sm"
                  />
                )}
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
                  value={currentLine.cantidad}
                  onChange={(e) => setCurrentLine({ ...currentLine, cantidad: e.target.value })}
                  placeholder="0.00"
                  className="h-8 md:h-9 text-xs md:text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fechaproduccion" className="text-xs md:text-sm">
                  Fecha de Producción
                </Label>
                <Input
                  id="fechaproduccion"
                  type="date"
                  value={currentLine.fechaproduccion}
                  onChange={(e) => setCurrentLine({ ...currentLine, fechaproduccion: e.target.value })}
                  className="h-8 md:h-9 text-xs md:text-sm"
                />
              </div>

              {/* Hora REAL de produccion. Es lo que Liquidación Tolva usa para
                  saber si el lote es de Turno 1 o Turno 2. NO se autocompleta
                  con la hora actual a proposito: cuando la produccion de ayer
                  se registra hoy, la hora actual no tiene relacion con el turno
                  que la produjo, y un valor puesto solo pasaria inadvertido. */}
              <div className="space-y-2">
                <Label htmlFor="horaproduccion" className="text-xs md:text-sm">
                  Hora de Producción
                </Label>
                <Input
                  id="horaproduccion"
                  type="time"
                  value={currentLine.horaproduccion}
                  onChange={(e) => setCurrentLine({ ...currentLine, horaproduccion: e.target.value })}
                  className="h-8 md:h-9 text-xs md:text-sm"
                />
                <p className="text-[10px] leading-tight text-muted-foreground">
                  Define el turno en Liquidación Tolva.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:gap-4">
              <div className="space-y-2">
                <Label htmlFor="observaciones" className="text-xs md:text-sm">
                  Observaciones
                </Label>
                <Input
                  id="observaciones"
                  type="text"
                  value={currentLine.observaciones}
                  onChange={(e) => setCurrentLine({ ...currentLine, observaciones: e.target.value })}
                  placeholder="Ingrese observaciones (opcional)"
                  className="h-8 md:h-9 text-xs md:text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={handleAddLine}
                variant="outline"
                size="sm"
                className="md:size-lg text-xs md:text-sm h-8 md:h-10 bg-transparent"
              >
                <Plus className="h-3 w-3 md:h-4 md:w-4 mr-2" />
                Agregar Línea
              </Button>
            </div>

            {productLines.length > 0 && (
              <div className="space-y-3 md:space-y-4">
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs md:text-sm">Producto</TableHead>
                        <TableHead className="text-xs md:text-sm">Código</TableHead>
                        <TableHead className="text-xs md:text-sm">Lote</TableHead>
                        <TableHead className="text-right text-xs md:text-sm">Cantidad</TableHead>
                        <TableHead className="text-xs md:text-sm">Fecha Prod.</TableHead>
                        <TableHead className="text-xs md:text-sm">Hora Prod.</TableHead>
                        <TableHead className="text-xs md:text-sm">Fecha Venc.</TableHead>
                        <TableHead className="text-xs md:text-sm">Observaciones</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productLines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-medium text-xs md:text-sm">{line.producto}</TableCell>
                          <TableCell className="text-xs md:text-sm">{line.codigo_producto}</TableCell>
                          <TableCell className="text-xs md:text-sm">{line.lote}</TableCell>
                          <TableCell className="text-right text-xs md:text-sm">{line.cantidad}</TableCell>
                          <TableCell className="text-xs md:text-sm">
                            {line.fechaproduccion ? new Date(line.fechaproduccion).toLocaleDateString("es-CO") : "-"}
                          </TableCell>
                          <TableCell className="text-xs md:text-sm">
                            {line.horaproduccion || "-"}
                          </TableCell>
                          <TableCell className="text-xs md:text-sm">
                            {line.fechavencimiento ? new Date(line.fechavencimiento).toLocaleDateString("es-CO") : "-"}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs md:text-sm" title={line.observaciones}>
                            {line.observaciones || "-"}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveLine(line.id)}
                              className="h-7 w-7 md:h-8 md:w-8"
                            >
                              <Trash2 className="h-3 w-3 md:h-4 md:w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 bg-muted p-3 md:p-4 rounded-lg">
                  <div className="text-xs md:text-sm font-medium">
                    Total de líneas: <span className="text-base md:text-lg">{productLines.length}</span>
                  </div>
                  <Button
                    onClick={handleSubmit}
                    disabled={isLoading}
                    size="sm"
                    className="md:size-lg text-xs md:text-sm h-8 md:h-10 w-full md:w-auto"
                  >
                    {isLoading ? "Registrando..." : "Registrar Ingreso"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
