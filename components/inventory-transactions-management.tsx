"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
// `Table` (componente) se omite intencionalmente: introduce un wrapper
// interno con `overflow-x-auto` que rompe `position: sticky` del thead.
// Ver comentario en el JSX abajo.
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Search, FileDown } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import {
  getAllInventoryTransactions,
  getLocations,
  getProductsWithCodes,
  type InventoryTransactionRecord,
  type Location,
  type ProductWithCode,
} from "@/lib/inventory-actions"

export function InventoryTransactionsManagement() {
  const { selectedEmpresaId } = useAuth()
  const [transactions, setTransactions] = useState<InventoryTransactionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [locations, setLocations] = useState<Location[]>([])
  const [products, setProducts] = useState<ProductWithCode[]>([])
  const { toast } = useToast()

  const [filters, setFilters] = useState({
    producto: "",
    location: "",
    tipomov: "",
    status: "",
    origen: "",
    creadopor: "",
    fecha: "",
  })

  useEffect(() => {
    loadData()
  }, [selectedEmpresaId])

  const loadData = async () => {
    setLoading(true)
    const [transData, locData, prodData] = await Promise.all([
      getAllInventoryTransactions({ ...filters, idempresa: selectedEmpresaId }),
      getLocations(undefined, selectedEmpresaId ?? undefined),
      getProductsWithCodes(),
    ])
    setTransactions(transData)
    setLocations(locData)
    setProducts(prodData)
    setLoading(false)
  }

  const applyFilters = async () => {
    await loadData()
  }

  const clearFilters = () => {
    setFilters({
      producto: "",
      location: "",
      tipomov: "",
      status: "",
      origen: "",
      creadopor: "",
      fecha: "",
    })
  }

  const exportToExcel = async () => {
    const XLSX = await import("xlsx")
    // Prepare data for export
    const exportData = transactions.map((transaction) => ({
      ID: transaction.id,
      Código: transaction.codproducto,
      Producto: transaction.nombreproducto,
      Lote: transaction.lote,
      Localización: transaction.location,
      Cantidad: transaction.cantidad,
      "Tipo Movimiento": transaction.tipomov,
      "Cód. Mov.": transaction.cod_movimiento || "-",
      Status: transaction.status || "-",
      Origen: transaction.origen,
      "Creado por": transaction.creadopor,
      Fecha: new Date(transaction.creado).toLocaleDateString(),
    }))

    // Create worksheet
    const ws = XLSX.utils.json_to_sheet(exportData)

    // Create workbook
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Transacciones")

    // Generate filename with current date
    const fecha = new Date().toISOString().split("T")[0]
    const filename = `transacciones_inventario_${fecha}.xlsx`

    // Download file
    XLSX.writeFile(wb, filename)

    toast({
      title: "Éxito",
      description: `Archivo ${filename} descargado exitosamente`,
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Gestión de Transacciones</CardTitle>
          <CardDescription>Visualiza todas las transacciones de inventario</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Filtros</h3>
              <Button onClick={exportToExcel} variant="outline">
                <FileDown className="h-4 w-4 mr-2" />
                Exportar a Excel
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-xs sm:text-sm">Producto</Label>
                <Input
                  placeholder="Buscar producto..."
                  value={filters.producto}
                  onChange={(e) => setFilters({ ...filters, producto: e.target.value })}
                  className="h-8 sm:h-9 text-xs sm:text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs sm:text-sm">Localización</Label>
                <Select value={filters.location} onValueChange={(val) => setFilters({ ...filters, location: val })}>
                  <SelectTrigger className="h-8 sm:h-9 text-xs sm:text-sm w-full">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {locations.map((loc) => (
                      <SelectItem key={loc.codigo} value={loc.codigo}>
                        {loc.codigo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs sm:text-sm">Tipo de Movimiento</Label>
                <Select value={filters.tipomov} onValueChange={(val) => setFilters({ ...filters, tipomov: val })}>
                  <SelectTrigger className="h-8 sm:h-9 text-xs sm:text-sm w-full">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="Entrada">Entrada</SelectItem>
                    <SelectItem value="Salida">Salida</SelectItem>
                    <SelectItem value="Reproceso">Reproceso</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs sm:text-sm">Status</Label>
                <Select value={filters.status} onValueChange={(val) => setFilters({ ...filters, status: val })}>
                  <SelectTrigger className="h-8 sm:h-9 text-xs sm:text-sm w-full">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="null">Sin status</SelectItem>
                    <SelectItem value="aprobado">Aprobado</SelectItem>
                    <SelectItem value="rechazado">Rechazado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs sm:text-sm">Origen</Label>
                <Input
                  placeholder="Buscar origen..."
                  value={filters.origen}
                  onChange={(e) => setFilters({ ...filters, origen: e.target.value })}
                  className="h-8 sm:h-9 text-xs sm:text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs sm:text-sm">Creado por</Label>
                <Input
                  placeholder="Buscar usuario..."
                  value={filters.creadopor}
                  onChange={(e) => setFilters({ ...filters, creadopor: e.target.value })}
                  className="h-8 sm:h-9 text-xs sm:text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs sm:text-sm">Fecha</Label>
                <DatePickerField
                  value={filters.fecha}
                  onChange={(value) => setFilters({ ...filters, fecha: value })}
                  className="h-8 sm:h-9 text-xs sm:text-sm"
                />
              </div>

              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
                <Button onClick={applyFilters} className="flex-1 h-8 sm:h-9 text-xs sm:text-sm">
                  <Search className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  Aplicar
                </Button>
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  className="flex-1 h-8 sm:h-9 text-xs sm:text-sm bg-transparent"
                >
                  Limpiar
                </Button>
              </div>
            </div>
          </div>

          {/* Mismo fix de sticky que en "Saldos de inventario": el componente
              <Table> de shadcn envuelve la <table> en un div interno con
              `overflow-x-auto`, lo que crea un scroll container al que se
              ancla `position: sticky` de los <th> (sin scroll vertical
              propio), por lo que el thead nunca se queda fijo. Solucion:
              usar <table> HTML nativo con las clases visuales equivalentes
              dentro de un unico div con scroll vertical+horizontal. Se
              mantienen <TableHeader>, <TableHead>, etc. (etiquetas HTML
              con estilos shadcn, sin wrappers extras). */}
          <div className="rounded-md border overflow-auto max-h-[600px] relative">
            <table className="w-full caption-bottom text-sm border-separate border-spacing-0">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">ID</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Código</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Producto</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Lote</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Localización</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Cantidad</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Tipo Mov.</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Cód. Mov.</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Status</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Origen</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Creado por</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-muted border-b text-xs sm:text-sm whitespace-nowrap">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground text-xs sm:text-sm">
                      No hay transacciones registradas
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="text-xs sm:text-sm">{transaction.id}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{transaction.codproducto}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{transaction.nombreproducto}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{transaction.lote}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{transaction.location}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{transaction.cantidad}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{transaction.tipomov}</TableCell>
                      <TableCell className="text-xs sm:text-sm font-medium">{transaction.cod_movimiento || "-"}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{transaction.status || "-"}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{transaction.origen}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{transaction.creadopor}</TableCell>
                      <TableCell className="text-xs sm:text-sm">
                        {new Date(transaction.creado).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
