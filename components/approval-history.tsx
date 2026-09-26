"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Search, FileDown, FileText } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { getBatchHistory, getBatchHistoryFilters, type BatchHistoryRecord } from "@/lib/batch-actions"
import { useAuth } from "@/components/auth-provider"

export function ApprovalHistory() {
  const { selectedEmpresaId } = useAuth()
  const [records, setRecords] = useState<BatchHistoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const [filterOptions, setFilterOptions] = useState({
    clientes: [] as string[],
    productos: [] as string[],
  })

  const [filters, setFilters] = useState({
    cliente: "",
    producto: "",
    fechaDesde: "",
    fechaHasta: "",
  })

  useEffect(() => {
    if (selectedEmpresaId) {
      loadFilterOptions()
      loadData()
    }
  }, [selectedEmpresaId])

  const loadFilterOptions = async () => {
    const options = await getBatchHistoryFilters(selectedEmpresaId)
    setFilterOptions(options)
  }

  const loadData = async () => {
    setLoading(true)
    const data = await getBatchHistory(selectedEmpresaId)
    setRecords(data)
    setLoading(false)
  }

  const applyFilters = async () => {
    await loadData()
  }

  const clearFilters = () => {
    setFilters({
      cliente: "",
      producto: "",
      fechaDesde: "",
      fechaHasta: "",
    })
  }

  const exportToExcel = async () => {
    const XLSX = await import("xlsx")
    const exportData = records.map((record) => ({
      ID: record.id,
      Fecha: record.fecha ? new Date(record.fecha).toLocaleDateString() : "",
      Cliente: record.cliente,
      Producto: record.producto,
      Lote: record.lote,
      Localización: record.location,
      Cantidad: record.cantidad,
      "Orden de Cargue": record.ordendecargue,
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Historial Lotes")

    const fecha = new Date().toISOString().split("T")[0]
    const filename = `historial_lotes_${fecha}.xlsx`

    XLSX.writeFile(wb, filename)

    toast({
      title: "Éxito",
      description: `Archivo ${filename} descargado exitosamente`,
    })
  }

  const filteredRecords = records.filter((record) => {
    if (filters.cliente && !record.cliente?.toLowerCase().includes(filters.cliente.toLowerCase())) return false
    if (filters.producto && !record.producto?.toLowerCase().includes(filters.producto.toLowerCase())) return false
    if (filters.fechaDesde && record.fecha && new Date(record.fecha) < new Date(filters.fechaDesde)) return false
    if (filters.fechaHasta && record.fecha && new Date(record.fecha) > new Date(filters.fechaHasta)) return false
    return true
  })

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
          <CardTitle>Historial Aprobaciones</CardTitle>
          <CardDescription>Visualiza el historial de lotes aprobados por orden de cargue</CardDescription>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select value={filters.cliente} onValueChange={(value) => setFilters({ ...filters, cliente: value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todos los clientes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los clientes</SelectItem>
                    {filterOptions.clientes.map((cliente) => (
                      <SelectItem key={cliente} value={cliente}>
                        {cliente}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Producto</Label>
                <Select value={filters.producto} onValueChange={(value) => setFilters({ ...filters, producto: value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todos los productos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los productos</SelectItem>
                    {filterOptions.productos.map((producto) => (
                      <SelectItem key={producto} value={producto}>
                        {producto}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Fecha Desde</Label>
                <DatePickerField
                  value={filters.fechaDesde}
                  onChange={(value) => setFilters({ ...filters, fechaDesde: value })}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label>Fecha Hasta</Label>
                <DatePickerField
                  value={filters.fechaHasta}
                  onChange={(value) => setFilters({ ...filters, fechaHasta: value })}
                  className="w-full"
                />
              </div>

              <div className="flex items-end gap-2 md:col-span-2">
                <Button onClick={applyFilters} className="flex-1">
                  <Search className="h-4 w-4 mr-2" />
                  Aplicar
                </Button>
                <Button variant="outline" onClick={clearFilters} className="flex-1 bg-transparent">
                  Limpiar
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-md border overflow-x-auto max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Localización</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Orden de Cargue</TableHead>
                  <TableHead>PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      No hay registros de aprobaciones
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{record.id}</TableCell>
                      <TableCell>{record.fecha ? new Date(record.fecha).toLocaleDateString() : "-"}</TableCell>
                      <TableCell>{record.cliente}</TableCell>
                      <TableCell>{record.producto}</TableCell>
                      <TableCell>{record.lote}</TableCell>
                      <TableCell>{record.location}</TableCell>
                      <TableCell>{record.cantidad}</TableCell>
                      <TableCell>{record.ordendecargue}</TableCell>
                      <TableCell>
                        {record.pdf ? (
                          <button
                            onClick={() => window.open(record.pdf as string, "_blank")}
                            className="text-fuchsia-500 hover:text-fuchsia-600 transition-colors"
                            title="Ver PDF"
                          >
                            <FileText className="h-5 w-5" />
                          </button>
                        ) : (
                          "-"
                        )}
                      </TableCell>
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
