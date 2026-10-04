"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
// `Table` (componente) se omite intencionalmente: introduce un wrapper
// interno con `overflow-x-auto` que rompe `position: sticky` del thead.
// Ver comentario en el JSX abajo.
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Boxes, Download, Search, Check, ChevronsUpDown } from "lucide-react"
import { Cifra, EstadoVacio, Eyebrow } from "@/components/ui/lipgo"
import { useToast } from "@/hooks/use-toast"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  getInventoryBalanceDetails,
  getLocations,
  exportInventoryDetailsToExcel,
  type InventoryBalanceDetail,
  type Location,
} from "@/lib/inventory-actions"
import { getCategoriasForFilter, getSubcategoriasForFilter, getProductosForFilter } from "@/lib/config-actions"

export function InventoryBalanceDetails() {
  const { selectedEmpresaId } = useAuth()
  const [balances, setBalances] = useState<InventoryBalanceDetail[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [categorias, setCategorias] = useState<Array<{ nombre: string }>>([])
  const [subcategorias, setSubcategorias] = useState<Array<{ nombre: string }>>([])
  const [productos, setProductos] = useState<Array<{ nombre: string }>>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [productFilter, setProductFilter] = useState("all")
  const [productSearchOpen, setProductSearchOpen] = useState(false)
  const [productSearchValue, setProductSearchValue] = useState("")
  const [locationFilter, setLocationFilter] = useState("all")
  const [categoriaFilter, setCategoriaFilter] = useState("all")
  const [subcategoriaFilter, setSubcategoriaFilter] = useState("all")
  const { toast } = useToast()

  useEffect(() => {
    if (selectedEmpresaId) {
      loadLocations()
      loadCategorias()
      loadProductos()
      loadBalances()
    }
  }, [selectedEmpresaId])

  useEffect(() => {
    console.log("[v0] Filters changed, reloading balances...")
    console.log("[v0] Product filter:", productFilter)
    console.log("[v0] Categoria filter:", categoriaFilter)
    console.log("[v0] Subcategoria filter:", subcategoriaFilter)
    console.log("[v0] Location filter:", locationFilter)
    loadBalances()
  }, [categoriaFilter, subcategoriaFilter, locationFilter, productFilter]) // Added productFilter to dependencies

  const loadCategorias = async () => {
    try {
      const data = await getCategoriasForFilter()
      setCategorias(data)
    } catch (error) {
      console.error("[v0] Error loading categorias:", error)
    }
  }

  const loadProductos = async () => {
    try {
      const data = await getProductosForFilter(selectedEmpresaId ?? undefined)
      setProductos(data)
    } catch (error) {
      console.error("[v0] Error loading productos:", error)
    }
  }

  useEffect(() => {
    const loadSubcategorias = async () => {
      if (categoriaFilter === "all") {
        setSubcategorias([])
        setSubcategoriaFilter("all")
        return
      }

      try {
        const data = await getSubcategoriasForFilter(categoriaFilter)
        setSubcategorias(data)
      } catch (error) {
        console.error("[v0] Error loading subcategorias:", error)
      }
    }

    loadSubcategorias()
  }, [categoriaFilter])

  const loadLocations = async () => {
    const data = await getLocations(undefined, selectedEmpresaId ?? undefined)
    setLocations(data)
  }

  const loadBalances = async () => {
    setLoading(true)
    const productFilterValue = productFilter === "all" ? "" : productFilter
    const data = await getInventoryBalanceDetails(
      productFilterValue,
      locationFilter,
      categoriaFilter,
      subcategoriaFilter,
      selectedEmpresaId,
    )
    setBalances(data)
    setLoading(false)
  }

  const handleFilter = () => {
    console.log("[v0] Manual filter button clicked")
    loadBalances()
  }

  const handleExportToExcel = async () => {
    setExporting(true)
    try {
      const productFilterValue = productFilter === "all" ? "" : productFilter
      const result = await exportInventoryDetailsToExcel(
        productFilterValue,
        locationFilter,
        categoriaFilter,
        subcategoriaFilter,
        selectedEmpresaId,
      )

      if (!result.success || !result.data || !result.filename) {
        toast({
          title: "Error",
          description: result.error || "No se pudo generar el archivo Excel",
          variant: "destructive",
        })
        return
      }

      const link = document.createElement("a")
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.data}`
      link.download = result.filename
      link.click()

      toast({
        title: "Exportación Exitosa",
        description: "El archivo Excel se ha descargado correctamente",
      })
    } catch (error) {
      console.error("[v0] Error exporting to Excel:", error)
      toast({
        title: "Error",
        description: "Error al exportar los datos a Excel",
        variant: "destructive",
      })
    } finally {
      setExporting(false)
    }
  }

  const stockFinalTotal = balances.reduce((s, b) => s + (Number(b.stock_actual) || 0), 0)
  const skusDistintos = new Set(balances.map((b) => b.idproducto)).size
  const lotesVencidos = balances.filter((b) => (b.edad_dias ?? 0) > 180).length

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-acento-tinte text-acento">
            <Boxes className="h-5 w-5" />
          </span>
          <div>
            <Eyebrow>Almacenamiento</Eyebrow>
            <h1 className="text-lg font-semibold leading-tight">Saldos de Inventario</h1>
          </div>
        </div>
        <Button onClick={handleExportToExcel} disabled={exporting} variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          {exporting ? "Exportando..." : "Exportar a Excel"}
        </Button>
      </div>

      {/* Franja de cifras reales */}
      {!loading && balances.length > 0 && (
        <div className="lg-card grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-3 sm:px-5">
          <Cifra label="Líneas" valor={balances.length.toLocaleString("es-CO")} unidad="producto · lote · ubicación" tamano="compacta" />
          <Cifra label="SKU distintos" valor={skusDistintos.toLocaleString("es-CO")} unidad="productos" tamano="compacta" />
          <Cifra label="Stock final" valor={stockFinalTotal.toLocaleString("es-CO")} unidad={lotesVencidos > 0 ? `${lotesVencidos} lotes > 180 días` : "sin lotes viejos"} tono={lotesVencidos > 0 ? "atencion" : "ok"} tamano="compacta" className="col-span-2 sm:col-span-1" />
        </div>
      )}

      <div className="lg-card">
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Eyebrow>Filtros</Eyebrow>
        </div>
        <div className="px-4 py-4 sm:px-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="productFilter">Nombre del Producto</Label>
              <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={productSearchOpen}
                    className="w-full justify-between bg-transparent"
                  >
                    {productFilter === "all"
                      ? "Seleccionar producto..."
                      : productos.find((p) => p.nombre === productFilter)?.nombre || "Seleccionar producto..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Buscar producto..."
                      value={productSearchValue}
                      onValueChange={setProductSearchValue}
                    />
                    <CommandList>
                      <CommandEmpty>No se encontraron productos.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="all"
                          onSelect={() => {
                            setProductFilter("all")
                            setProductSearchOpen(false)
                            setProductSearchValue("")
                          }}
                        >
                          <Check
                            className={cn("mr-2 h-4 w-4", productFilter === "all" ? "opacity-100" : "opacity-0")}
                          />
                          Todos los productos
                        </CommandItem>
                        {productos
                          .filter((p) =>
                            p.nombre.toLowerCase().includes(productSearchValue.toLowerCase()),
                          )
                          .map((producto) => (
                            <CommandItem
                              key={producto.nombre}
                              value={producto.nombre}
                              onSelect={() => {
                                setProductFilter(producto.nombre)
                                setProductSearchOpen(false)
                                setProductSearchValue("")
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  productFilter === producto.nombre ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {producto.nombre}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label htmlFor="locationFilter">Localización</Label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger id="locationFilter">
                  <SelectValue placeholder="Todas las localizaciones" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.codigo} value={loc.codigo}>
                      {loc.codigo} - {loc.Descripción}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="categoriaFilter">Categoría</Label>
              <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
                <SelectTrigger id="categoriaFilter">
                  <SelectValue placeholder="Todas las categorías" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {categorias.map((cat) => (
                    <SelectItem key={cat.nombre} value={cat.nombre}>
                      {cat.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subcategoriaFilter">Sub Categoría</Label>
              <Select
                value={subcategoriaFilter}
                onValueChange={setSubcategoriaFilter}
                disabled={categoriaFilter === "all"}
              >
                <SelectTrigger id="subcategoriaFilter">
                  <SelectValue placeholder="Todas las subcategorías" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {subcategorias.map((subcat) => (
                    <SelectItem key={subcat.nombre} value={subcat.nombre}>
                      {subcat.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleFilter} className="w-full gap-2">
                <Search className="h-4 w-4" />
                Buscar
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="lg-card">
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Eyebrow>Detalle de inventario</Eyebrow>
        </div>
        <div className="px-4 py-4 sm:px-5">
          {/* CAUSA RAIZ del bug de sticky: el componente <Table> de shadcn
              envuelve internamente la <table> en un
              <div data-slot="table-container" class="relative w-full overflow-x-auto">.
              Ese wrapper interno es UN scroll container; cualquier
              `position: sticky` aplicado a los <th> se ancla a el (que NO
              tiene scroll vertical), no al contenedor externo, por lo que
              el encabezado nunca se queda fijo al hacer scroll.
              Solucion: saltarse el componente <Table> y usar <table> HTML
              nativo dentro de un unico div con scroll vertical. Mantenemos
              <TableHeader>, <TableHead>, <TableRow>, <TableBody>,
              <TableCell> porque son simples etiquetas semanticas con
              estilos shadcn (no introducen wrappers extra). */}
          {!loading && balances.length === 0 ? (
            <EstadoVacio
              icono={<Boxes className="h-5 w-5" />}
              titulo="Sin registros con este filtro"
              texto="Ajusta o limpia los filtros para ver el saldo de inventario."
            />
          ) : (
          <div className="max-h-[600px] overflow-auto border rounded-lg relative">
            <table className="lg-num w-full caption-bottom text-sm border-separate border-spacing-0">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap">ID Producto</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap">Código Producto</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap">Nombre Producto</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap">Categoría</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap">Sub Categoría</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap">Lote</TableHead>
                  {/* Edad = días desde la fecha que codifica el lote (YYYYMMDD).
                      "—" cuando el lote no tiene ese formato. */}
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap text-right">
                    Edad (días)
                  </TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap">Localización</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap text-right">Stock Disponible</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap text-right">Stock Reservado</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b whitespace-nowrap text-right">Stock Final</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="animate-pulse text-center py-8 text-muted-foreground">
                      Cargando…
                    </TableCell>
                  </TableRow>
                ) : (
                  balances.map((balance, index) => (
                    <TableRow key={index}>
                      <TableCell>{balance.idproducto}</TableCell>
                      <TableCell>{balance.codproducto}</TableCell>
                      <TableCell className="font-medium">{balance.nombreproducto}</TableCell>
                      <TableCell>{balance.categoria}</TableCell>
                      <TableCell>{balance.subcategoria}</TableCell>
                      <TableCell>{balance.lote}</TableCell>
                      <TableCell className={cn("text-right", (balance.edad_dias ?? 0) > 180 && "font-semibold text-atencion-fg")}>
                        {balance.edad_dias == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          balance.edad_dias.toLocaleString("es-CO")
                        )}
                      </TableCell>
                      <TableCell>{balance.location}</TableCell>
                      <TableCell className="text-right font-medium">{balance.stock_disp.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">{balance.stock_res.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-semibold">{balance.stock_actual.toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
