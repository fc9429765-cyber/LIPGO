"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Download, Search } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { getCategoriasForFilter, getSubcategoriasForFilter, getProductosForFilter } from "@/lib/config-actions"
import {
  getInventoryBalanceGlobal,
  exportInventoryGlobalToExcel,
  type InventoryBalanceGlobal as InventoryBalanceGlobalType,
} from "@/lib/inventory-actions"
import { useAuth } from "@/components/auth-provider" // Added useAuth import

export function InventoryBalanceGlobal() {
  const { selectedEmpresaId } = useAuth()
  const [balances, setBalances] = useState<InventoryBalanceGlobalType[]>([])
  const [categorias, setCategorias] = useState<Array<{ nombre: string }>>([])
  const [subcategorias, setSubcategorias] = useState<Array<{ nombre: string }>>([])
  const [productos, setProductos] = useState<Array<{ nombre: string }>>([]) // Added productos state
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [categoriaFilter, setCategoriaFilter] = useState("all")
  const [subcategoriaFilter, setSubcategoriaFilter] = useState("all")
  const [productoFilter, setProductoFilter] = useState("all") // Added product filter state
  const { toast } = useToast()

  useEffect(() => {
    if (selectedEmpresaId) {
      loadCategorias()
      loadProductos()
      loadBalances()
    }
  }, [selectedEmpresaId])

  useEffect(() => {
    console.log("[v0] Filters changed in global, reloading balances...")
    console.log("[v0] Categoria filter:", categoriaFilter)
    console.log("[v0] Subcategoria filter:", subcategoriaFilter)
    console.log("[v0] Producto filter:", productoFilter)
    loadBalances()
  }, [categoriaFilter, subcategoriaFilter, productoFilter])

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

  const loadBalances = async () => {
    setLoading(true)
    const data = await getInventoryBalanceGlobal(
      categoriaFilter,
      subcategoriaFilter,
      productoFilter,
      selectedEmpresaId,
    )
    setBalances(data)
    setLoading(false)
  }

  const handleFilter = () => {
    console.log("[v0] Manual filter button clicked in global")
    loadBalances()
  }

  const handleExportToExcel = async () => {
    setExporting(true)
    try {
      // Pasamos al server action los mismos filtros activos en la
      // vista — incluyendo el `selectedEmpresaId` proveniente del
      // filtro dinamico de la barra superior — para que el archivo
      // descargado contenga exclusivamente los datos de la empresa
      // que el usuario tiene seleccionada.
      const result = await exportInventoryGlobalToExcel(
        categoriaFilter,
        subcategoriaFilter,
        productoFilter,
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Saldos por Producto</h2>
        <Button onClick={handleExportToExcel} disabled={exporting} className="gap-2">
          <Download className="h-4 w-4" />
          {exporting ? "Exportando..." : "Exportar a Excel"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="productoFilter">Nombre del Producto</Label>
              <Select value={productoFilter} onValueChange={setProductoFilter}>
                <SelectTrigger id="productoFilter">
                  <SelectValue placeholder="Todos los productos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {productos.map((prod) => (
                    <SelectItem key={prod.nombre} value={prod.nombre}>
                      {prod.nombre}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventario Global por Producto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[600px] overflow-y-auto border rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-muted z-10">
                <TableRow>
                  <TableHead>ID Producto</TableHead>
                  <TableHead>Código Producto</TableHead>
                  <TableHead>Nombre Producto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Sub Categoría</TableHead>
                  <TableHead className="text-right">Stock Disponible</TableHead>
                  <TableHead className="text-right">Stock Reservado</TableHead>
                  <TableHead className="text-right">Stock Final</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Cargando...
                    </TableCell>
                  </TableRow>
                ) : balances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No se encontraron registros
                    </TableCell>
                  </TableRow>
                ) : (
                  balances.map((balance, index) => (
                    <TableRow key={index}>
                      <TableCell>{balance.idproducto}</TableCell>
                      <TableCell>{balance.codproducto}</TableCell>
                      <TableCell>{balance.nombreproducto}</TableCell>
                      <TableCell>{balance.categoria}</TableCell>
                      <TableCell>{balance.subcategoria}</TableCell>
                      <TableCell className="text-right font-medium">{balance.stock_disp.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">{balance.stock_res.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">{balance.stock_global.toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
