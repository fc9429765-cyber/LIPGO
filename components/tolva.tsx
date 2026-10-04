"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Check, ChevronsUpDown, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/use-toast"
import { createClient } from "@/lib/supabase-client"
import { leerPersonalBasico } from "@/lib/finanzas-lectura-actions"
import { Calendar } from "@/components/ui/calendar"
import { useAuth } from "@/components/auth-provider"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import { saveTolva, updateTolva } from "@/lib/orders-actions"

interface Product {
  id: number
  nombre: string
  peso_unitkg?: number
}

interface Employee {
  id: number
  nombreempleado: string
}

interface TolvaLine {
  id: string
  producto: Product | null
  cantidad: number
  pesoUnitkg: number
  pesoTotal: number
}

interface TolvaData {
  fechaFabricacion: string
  lote: string
  productos: TolvaLine[]
  empleados: Employee[]
}

/**
 * Permite pre-cargar lineas de producto cuando se abre la Tolva desde otro
 * modulo (por ejemplo, al crear una orden de Tolva a partir de ingresos de
 * produccion seleccionados). Para cada linea el componente resuelve el
 * producto contra el maestro cargado y calcula peso unitario / peso total.
 */
export interface PrefilledTolvaLine {
  productId?: number
  productName: string
  cantidad: number
}

interface Props {
  editingTolvaId?: number
  prefilledLines?: PrefilledTolvaLine[]
  /**
   * Lote pre-calculado por el padre (por ejemplo, tomado de los ingresos de
   * produccion seleccionados). Solo se usa cuando `prefilledLines` viene con
   * datos y no se esta editando una tolva existente.
   */
  prefilledLote?: string
  /**
   * Fecha de fabricacion pre-calculada (YYYY-MM-DD). Sigue las mismas reglas
   * de aplicacion que `prefilledLote`.
   */
  prefilledFechaFabricacion?: string
  /**
   * Modo solo-lectura: todos los campos del encabezado y la tabla de
   * productos quedan bloqueados (no se puede editar fecha, lote, agregar o
   * eliminar lineas ni modificar cantidades). Unicamente se permite asignar
   * personal y guardar. Se usa al crear una Tolva desde el modulo Ver
   * Ingresos de Produccion, donde los datos ya estan aprobados.
   */
  readonly?: boolean
  onClose?: () => void
  /**
   * Se invoca tras crear exitosamente una nueva Tolva. Recibe el `id`
   * generado en `cabeceraoc` y el `ordendecargue` asociado (formato
   * `Tolva{id}`). Permite al componente padre enlazar registros externos
   * (por ejemplo, filas de `invtrans`) a la orden recien creada.
   */
  onSaved?: (info: { id: number; ordendecargue: string }) => void | Promise<void>
}

export function Tolva({
  editingTolvaId,
  prefilledLines,
  prefilledLote,
  prefilledFechaFabricacion,
  readonly = false,
  onClose,
  onSaved,
}: Props) {
  const { selectedEmpresaId } = useAuth()
  // En modo readonly + prefilled inicializamos la fecha y el lote con los
  // valores derivados del padre para que la UI los muestre desde el primer
  // render (antes de que termine loadData / loadTolvaData).
  const [tolvaData, setTolvaData] = useState<TolvaData>({
    fechaFabricacion: prefilledFechaFabricacion || new Date().toISOString().split("T")[0],
    lote: prefilledLote || "",
    productos: [],
    empleados: [],
  })
  const [products, setProducts] = useState<Product[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openProductCombobox, setOpenProductCombobox] = useState<Record<string, boolean>>({})
  const [openEmployeeCombobox, setOpenEmployeeCombobox] = useState(false)

  useEffect(() => {
    loadData()
    if (editingTolvaId) {
      loadTolvaData(editingTolvaId)
    }
  }, [selectedEmpresaId, editingTolvaId])

  const loadData = async () => {
    try {
      setLoading(true)
      const supabase = await createClient()

      // Fetch products
      const { data: productosData, error: productError } = await supabase
        .from("productos")
        .select("id, nombre, peso_unitkg")

      if (!productError && productosData) {
        setProducts(productosData as Product[])

        // Si llegaron lineas pre-cargadas desde otro modulo y NO estamos
        // editando una tolva existente, inicializamos la tabla de productos
        // resolviendo cada linea contra el maestro recien cargado.
        if (prefilledLines && prefilledLines.length > 0 && !editingTolvaId) {
          const initialProductos: TolvaLine[] = prefilledLines.map((line) => {
            const match = (productosData as Product[]).find(
              (p) =>
                (line.productId !== undefined && p.id === line.productId) ||
                p.nombre.trim().toLowerCase() === line.productName.trim().toLowerCase(),
            )
            const resolvedProduct: Product = match || {
              id: line.productId ?? 0,
              nombre: line.productName,
              peso_unitkg: 0,
            }
            const pesoUnitkg = resolvedProduct.peso_unitkg || 0
            return {
              id: Math.random().toString(36).substr(2, 9),
              producto: resolvedProduct,
              cantidad: line.cantidad,
              pesoUnitkg,
              pesoTotal: line.cantidad * pesoUnitkg,
            }
          })
          // Preservamos la fecha y el lote ya seteados por el padre.
          setTolvaData((prev) => ({ ...prev, productos: initialProductos }))
        }
      }

      // Personal de la empresa (solo id y nombre) vía servidor: el navegador ya no
      // consulta `headcount` directo (SEGURIDAD 2026-10-03).
      try {
        const employeesData = selectedEmpresaId != null ? await leerPersonalBasico(selectedEmpresaId, false) : []
        setEmployees(employeesData.map((emp) => ({ id: emp.id, nombreempleado: emp.nombre })) as Employee[])
      } catch (e) {
        console.error("[v0] Tolva: personal no disponible:", e)
      }
    } catch (error) {
      console.error("[v0] Error loading tolva data:", error)
      toast({
        title: "Error",
        description: "Error al cargar datos",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const loadTolvaData = async (tolvaId: number) => {
    try {
      console.log("[v0] Loading tolva data for ID:", tolvaId, "Available products:", products.length)

      const supabase = await createClient()

      // Fetch tolva header
      const { data: headerData, error: headerError } = await supabase
        .from("cabeceraoc")
        .select("*")
        .eq("id", tolvaId)
        .single()

      if (headerError || !headerData) {
        console.error("[v0] Error loading tolva header:", headerError)
        return
      }

      // Fetch tolva details
      const { data: detailsData, error: detailsError } = await supabase
        .from("detalleoc")
        .select("*")
        .eq("idorden", tolvaId)

      if (detailsError) {
        console.error("[v0] Error loading tolva details:", detailsError)
        return
      }

      console.log("[v0] Tolva details loaded:", detailsData)

      // Parse empleados
      const empleados = headerData.auxiliares
        ? headerData.auxiliares.split(",").map((name: string) => {
            const employee = employees.find((e) => e.nombreempleado === name.trim())
            return employee || { id: 0, nombreempleado: name.trim() }
          })
        : []

      // Parse productos from details - ensure we have complete product data
      const productos = detailsData
        ? detailsData.map((detail) => {
            console.log("[v0] Processing detail product:", detail.producto)
            
            // First try to find by name in the loaded products
            let product = products.find((p) => p.nombre === detail.producto)
            
            // If not found, create a minimal product object with the name
            if (!product) {
              console.log("[v0] Product not found in loaded products, creating minimal object")
              product = { 
                id: Math.random() * 10000, 
                nombre: detail.producto, 
                peso_unitkg: (detail.toneladas * 1000) / detail.cantidad // Calculate from stored toneladas and cantidad
              }
            }
            
            console.log("[v0] Final product object:", product)
            const pesoUnitkg = product.peso_unitkg || 0
            const pesoTotal = detail.cantidad * pesoUnitkg
            
            return {
              id: detail.id.toString(),
              producto: product,
              cantidad: detail.cantidad,
              pesoUnitkg: pesoUnitkg,
              pesoTotal: pesoTotal,
            }
          })
        : []

      console.log("[v0] Parsed productos:", productos)

      setTolvaData({
        fechaFabricacion: headerData.fechaorden.split("T")[0],
        lote: headerData.ordendecargue,
        productos,
        empleados,
      })
    } catch (error) {
      console.error("[v0] Error loading tolva data:", error)
      toast({
        title: "Error",
        description: "Error al cargar la tolva",
        variant: "destructive",
      })
    }
  }

  const addProductLine = () => {
    const newLine: TolvaLine = {
      id: Math.random().toString(36).substr(2, 9),
      producto: null,
      cantidad: 0,
      pesoUnitkg: 0,
      pesoTotal: 0,
    }

    setTolvaData((prev) => ({
      ...prev,
      productos: [...prev.productos, newLine],
    }))
  }

  const updateProductLine = (lineId: string, producto: Product) => {
    setTolvaData((prev) => ({
      ...prev,
      productos: prev.productos.map((line) => {
        if (line.id === lineId) {
          const newPesoUnitkg = producto.peso_unitkg || 0
          const newPesoTotal = line.cantidad * newPesoUnitkg
          return {
            ...line,
            producto,
            pesoUnitkg: newPesoUnitkg,
            pesoTotal: newPesoTotal,
          }
        }
        return line
      }),
    }))
  }

  const updateQuantity = (lineId: string, cantidad: number) => {
    setTolvaData((prev) => ({
      ...prev,
      productos: prev.productos.map((line) => {
        if (line.id === lineId) {
          const newPesoTotal = cantidad * line.pesoUnitkg
          return {
            ...line,
            cantidad,
            pesoTotal: newPesoTotal,
          }
        }
        return line
      }),
    }))
  }

  const removeProductLine = (lineId: string) => {
    setTolvaData((prev) => ({
      ...prev,
      productos: prev.productos.filter((line) => line.id !== lineId),
    }))
  }

  const toggleEmployee = (employee: Employee) => {
    setTolvaData((prev) => {
      const isSelected = prev.empleados.some((e) => e.id === employee.id)
      if (isSelected) {
        return {
          ...prev,
          empleados: prev.empleados.filter((e) => e.id !== employee.id),
        }
      } else {
        return {
          ...prev,
          empleados: [...prev.empleados, employee],
        }
      }
    })
  }

  const getTotalPeso = () => {
    return tolvaData.productos.reduce((sum, line) => sum + line.pesoTotal, 0)
  }

  const handleSaveTolva = async () => {
    if (!tolvaData.fechaFabricacion) {
      toast({
        title: "Error",
        description: "Por favor ingrese la fecha de fabricación",
        variant: "destructive",
      })
      return
    }

    if (!tolvaData.lote.trim()) {
      toast({
        title: "Error",
        description: "Por favor ingrese el lote",
        variant: "destructive",
      })
      return
    }

    if (tolvaData.productos.length === 0) {
      toast({
        title: "Error",
        description: "Por favor agregue al menos un producto",
        variant: "destructive",
      })
      return
    }

    if (tolvaData.empleados.length === 0) {
      toast({
        title: "Error",
        description: "Por favor seleccione al menos un empleado",
        variant: "destructive",
      })
      return
    }

    const productosConCantidad = tolvaData.productos.filter((p) => p.cantidad > 0 && p.producto)

    if (productosConCantidad.length === 0) {
      toast({
        title: "Error",
        description: "Por favor agregue productos con cantidad mayor a cero",
        variant: "destructive",
      })
      return
    }

    try {
      setSaving(true)

      if (editingTolvaId) {
        // Update existing tolva
        const result = await updateTolva(editingTolvaId, {
          fechaFabricacion: tolvaData.fechaFabricacion,
          lote: tolvaData.lote,
          empleados: tolvaData.empleados,
          productos: productosConCantidad.map((p) => ({
            id: p.id,
            producto: p.producto as any,
            cantidad: p.cantidad,
          })),
        })

        if (result.success) {
          toast({
            title: "Éxito",
            description: "Tolva actualizada correctamente",
          })
          onClose?.()
        } else {
          toast({
            title: "Error",
            description: result.message,
            variant: "destructive",
          })
        }
      } else {
        // Create new tolva
        const result = await saveTolva({
          selectedEmpresaId: selectedEmpresaId ?? undefined,
          fechaFabricacion: tolvaData.fechaFabricacion,
          lote: tolvaData.lote,
          empleados: tolvaData.empleados,
          productos: productosConCantidad.map((p) => ({
            id: p.id,
            producto: p.producto as any,
            cantidad: p.cantidad,
          })),
        })

        if (result.success) {
          toast({
            title: "Éxito",
            description: result.message,
          })

          // Notificar al padre el numero de orden generado (ordendecargue).
          // `saveTolva` usa la convencion `Tolva${nextId}` al insertar en cabeceraoc.
          if (onSaved && typeof result.id === "number") {
            try {
              await onSaved({ id: result.id, ordendecargue: `Tolva${result.id}` })
            } catch (cbError) {
              console.error("[v0] Error in onSaved callback:", cbError)
            }
          }

          // Reset form
          setTolvaData({
            fechaFabricacion: new Date().toISOString().split("T")[0],
            lote: "",
            productos: [],
            empleados: [],
          })
        } else {
          toast({
            title: "Error",
            description: result.message,
            variant: "destructive",
          })
        }
      }
    } catch (error) {
      console.error("[v0] Error saving tolva:", error)
      toast({
        title: "Error",
        description: "Error al guardar la tolva",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">Cargando datos...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Registrar Tolva</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Encabezado */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fechaFabricacion">Fecha de Fabricación</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="fechaFabricacion"
                    type="button"
                    variant="outline"
                    disabled={readonly}
                    className="w-full justify-start font-normal"
                  >
                    {format(parseISO(tolvaData.fechaFabricacion), "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={parseISO(tolvaData.fechaFabricacion)}
                    onSelect={(date) =>
                      date &&
                      setTolvaData((prev) => ({
                        ...prev,
                        fechaFabricacion: format(date, "yyyy-MM-dd"),
                      }))
                    }
                    locale={es}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lote">Lote</Label>
              <Input
                id="lote"
                placeholder="Ingrese el lote"
                value={tolvaData.lote}
                onChange={(e) =>
                  setTolvaData((prev) => ({
                    ...prev,
                    lote: e.target.value,
                  }))
                }
                disabled={readonly}
                readOnly={readonly}
              />
            </div>

            <div className="space-y-2">
              <Label>Peso Total (Kg)</Label>
              <Input type="text" value={getTotalPeso().toFixed(2)} disabled />
            </div>
          </div>

          {/* Selección de personal */}
          <div className="space-y-2">
            <Label>Personal Asignado</Label>
            <Popover open={openEmployeeCombobox} onOpenChange={setOpenEmployeeCombobox}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between bg-transparent">
                  {tolvaData.empleados.length > 0
                    ? `${tolvaData.empleados.length} empleado(s) seleccionado(s)`
                    : "Seleccionar personal"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <Command>
                  <CommandInput placeholder="Buscar personal..." />
                  <CommandEmpty>No se encontró personal.</CommandEmpty>
                  <CommandList>
                    <CommandGroup>
                      {employees.map((employee) => (
                        <CommandItem
                          key={employee.id}
                          value={employee.nombreempleado}
                          onSelect={() => {
                            toggleEmployee(employee)
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              tolvaData.empleados.some((e) => e.id === employee.id)
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          {employee.nombreempleado}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {tolvaData.empleados.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {tolvaData.empleados.map((employee) => (
                  <div
                    key={employee.id}
                    className="flex items-center gap-2 bg-muted px-3 py-1 rounded-full text-sm"
                  >
                    <span>{employee.nombreempleado}</span>
                    <button
                      onClick={() => toggleEmployee(employee)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tabla de productos */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Productos</h3>
              {!readonly && (
                <Button onClick={addProductLine} size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Producto
                </Button>
              )}
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Peso Unitario (Kg)</TableHead>
                    <TableHead>Peso Total (Kg)</TableHead>
                    <TableHead>Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tolvaData.productos.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
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
                            <Button
                              variant="outline"
                              role="combobox"
                              disabled={readonly}
                              className={cn(
                                "w-full justify-between",
                                !line.producto && "text-muted-foreground",
                                readonly && "disabled:opacity-100 disabled:cursor-default",
                              )}
                            >
                              {line.producto ? line.producto.nombre : "Seleccionar producto..."}
                              {!readonly && <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-full p-0">
                            <Command>
                              <CommandInput placeholder="Buscar producto..." />
                              <CommandEmpty>No se encontró producto.</CommandEmpty>
                              <CommandList>
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
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          line.producto?.id === product.id ? "opacity-100" : "opacity-0"
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
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={line.cantidad}
                          onChange={(e) => updateQuantity(line.id, parseFloat(e.target.value) || 0)}
                          className="w-24"
                          disabled={readonly}
                          readOnly={readonly}
                        />
                      </TableCell>
                      <TableCell className="text-right">{line.pesoUnitkg.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{line.pesoTotal.toFixed(2)}</TableCell>
                      <TableCell>
                        {!readonly && (
                          <Button
                            onClick={() => removeProductLine(line.id)}
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {tolvaData.productos.length === 0 && (
              <p className="text-center text-muted-foreground py-8">No hay productos agregados</p>
            )}
          </div>

          {/* Botón guardar */}
          <div className="flex justify-end gap-2">
            {!readonly && (
              <Button variant="outline" onClick={() => setTolvaData({
                fechaFabricacion: new Date().toISOString().split("T")[0],
                lote: "",
                productos: [],
                empleados: [],
              })}>
                Limpiar
              </Button>
            )}
            <Button onClick={handleSaveTolva} disabled={saving}>
              {saving ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin">⌛</span>
                  {/* Label coherente con cada flujo:
                      - readonly + editingTolvaId: editando empleados de una tolva existente.
                      - readonly sin editingTolvaId: creacion desde Ingresos de Produccion (asignar).
                      - sin readonly: flujo normal de creacion / edicion libre. */}
                  {readonly && editingTolvaId
                    ? "Guardando cambios..."
                    : readonly
                      ? "Asignando..."
                      : "Guardando..."}
                </>
              ) : readonly && editingTolvaId ? (
                "Guardar cambios"
              ) : readonly ? (
                "Asignar"
              ) : (
                "Guardar Tolva"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
