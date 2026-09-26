"use client"

import { useState, useEffect } from "react"
import {
  getBatchHistory,
  getBatchHistoryFilters,
  getOrdenesForAnnulment,
  annulBatchAssignment,
  type BatchHistoryRecord,
} from "@/lib/batch-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { RefreshCw, FileDown, Loader2, XCircle, FileText, Check, ChevronsUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"

export function BatchHistory() {
  const [records, setRecords] = useState<BatchHistoryRecord[]>([])
  const [filteredRecords, setFilteredRecords] = useState<BatchHistoryRecord[]>([])
  const [clientes, setClientes] = useState<string[]>([])
  const [productos, setProductos] = useState<string[]>([])
  const [placas, setPlacas] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const [annulDialogOpen, setAnnulDialogOpen] = useState(false)
  const [ordenesDisponibles, setOrdenesDisponibles] = useState<string[]>([])
  const [selectedOrdenAnular, setSelectedOrdenAnular] = useState<string>("")
  const [ordenSearch, setOrdenSearch] = useState<string>("")
  const [filteredOrdenes, setFilteredOrdenes] = useState<string[]>([])
  const [selectedCliente, setSelectedCliente] = useState<string>("all")
  const [clienteComboOpen, setClienteComboOpen] = useState(false)
  const [selectedProducto, setSelectedProducto] = useState<string>("all")
  const [selectedPlaca, setSelectedPlaca] = useState<string>("all")
  const [fechaDesde, setFechaDesde] = useState<string | null>(null)
  const [fechaHasta, setFechaHasta] = useState<string | null>(null)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)

  useEffect(() => {
    loadData()
  }, [selectedEmpresaId])

  useEffect(() => {
    applyFilters()
  }, [records, selectedCliente, selectedProducto, selectedPlaca, fechaDesde, fechaHasta])

  const loadData = async () => {
    setLoading(true)
    const [historyData, filtersData] = await Promise.all([
      getBatchHistory(selectedEmpresaId), 
      getBatchHistoryFilters(selectedEmpresaId)
    ])

    setRecords(historyData)
    setClientes(filtersData.clientes)
    setProductos(filtersData.productos)
    setPlacas(filtersData.placas)
    setLoading(false)
  }

  const loadOrdenesForAnnulment = async () => {
    const ordenes = await getOrdenesForAnnulment()
    setOrdenesDisponibles(ordenes)
    setFilteredOrdenes(ordenes)
  }

  const handleOrdenSearch = (searchValue: string) => {
    setOrdenSearch(searchValue)
    setSelectedOrdenAnular(searchValue)

    if (searchValue === "") {
      setFilteredOrdenes(ordenesDisponibles)
    } else {
      const filtered = ordenesDisponibles.filter((orden) => orden.toLowerCase().includes(searchValue.toLowerCase()))
      setFilteredOrdenes(filtered)
    }
  }

  const handleAnularAsignacion = async () => {
    if (!selectedOrdenAnular) {
      toast({
        title: "Error",
        description: "Debe seleccionar una orden de cargue",
        variant: "destructive",
      })
      return
    }

    setProcessing(true)
    const result = await annulBatchAssignment(selectedOrdenAnular)

    if (result.success) {
      toast({
        title: "Éxito",
        description: result.message,
      })
      await loadData()
      setAnnulDialogOpen(false)
      setSelectedOrdenAnular("")
      setOrdenSearch("")
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
    setProcessing(false)
  }

  const handleOpenAnnulDialog = async () => {
    await loadOrdenesForAnnulment()
    setOrdenSearch("")
    setSelectedOrdenAnular("")
    setAnnulDialogOpen(true)
  }

  const applyFilters = () => {
    let filtered = [...records]

    // Filter by cliente
    if (selectedCliente !== "all") {
      filtered = filtered.filter((record) => record.cliente === selectedCliente)
    }

    // Filter by producto
    if (selectedProducto !== "all") {
      filtered = filtered.filter((record) => record.producto === selectedProducto)
    }

    // Filter by placa
    if (selectedPlaca !== "all") {
      filtered = filtered.filter((record) => record.placa === selectedPlaca)
    }

    // Filter by date range
    if (fechaDesde) {
      filtered = filtered.filter((record) => record.fecha >= fechaDesde)
    }
    if (fechaHasta) {
      filtered = filtered.filter((record) => record.fecha <= fechaHasta)
    }

    setFilteredRecords(filtered)
    setCurrentPage(1) // Reset to first page when filters change
  }

  // Pagination calculations
  const totalPages = Math.ceil(filteredRecords.length / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex)

  const goToPage = (page: number) => {
    setCurrentPage(Math.min(Math.max(1, page), totalPages))
  }

  const handleExportToExcel = async () => {
    const XLSX = await import("xlsx")
    const exportData = filteredRecords.map((record) => ({
      Fecha: record.fecha,
      Cliente: record.cliente,
      Producto: record.producto,
      Lote: record.lote,
      Location: record.location,
      Cantidad: record.cantidad,
      "Orden de Cargue": record.ordendecargue,
      Placa: record.placa,
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Historial de Lotes")

    const today = new Date().toISOString().split("T")[0]
    XLSX.writeFile(wb, `historial_lotes_${today}.xlsx`)
  }

  const handleDownloadPDF = (pdfUrl: string | null, recordId: number) => {
    if (!pdfUrl) {
      toast({
        title: "Advertencia",
        description: "Este registro no tiene un PDF asociado",
        variant: "destructive",
      })
      return
    }

    const link = document.createElement("a")
    link.href = pdfUrl
    link.target = "_blank"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    toast({
      title: "Éxito",
      description: "PDF descargado exitosamente",
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Historial de Lotes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={handleOpenAnnulDialog} variant="destructive">
              <XCircle className="h-4 w-4 mr-2" />
              Anular asignaciones de ordenes
            </Button>
          </div>

          {/* Filters */}
          <div className="space-y-4">
            {/* Date Range Filters */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Fecha Desde</label>
                <Input type="date" value={fechaDesde || ""} onChange={(e) => setFechaDesde(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Fecha Hasta</label>
                <Input type="date" value={fechaHasta || ""} onChange={(e) => setFechaHasta(e.target.value)} />
              </div>
            </div>

            {/* Select Filters */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <div>
                <label className="text-sm font-medium mb-2 block">Cliente</label>
                <Popover open={clienteComboOpen} onOpenChange={setClienteComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={clienteComboOpen}
                      className="min-w-[200px] justify-between"
                    >
                      {selectedCliente === "all"
                        ? "Todos"
                        : clientes.find((c) => c === selectedCliente) || "Todos"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="min-w-[200px] p-0">
                    <Command>
                      <CommandInput placeholder="Buscar cliente..." />
                      <CommandList>
                        <CommandEmpty>No se encontro cliente.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="all"
                            onSelect={() => {
                              setSelectedCliente("all")
                              setClienteComboOpen(false)
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedCliente === "all" ? "opacity-100" : "opacity-0")} />
                            Todos
                          </CommandItem>
                          {clientes.map((cliente, index) => (
                            <CommandItem
                              key={`cliente-${index}-${cliente}`}
                              value={cliente}
                              onSelect={() => {
                                setSelectedCliente(cliente)
                                setClienteComboOpen(false)
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", selectedCliente === cliente ? "opacity-100" : "opacity-0")} />
                              {cliente}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Producto</label>
                <Select value={selectedProducto} onValueChange={setSelectedProducto}>
                  <SelectTrigger className="min-w-[200px]">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {productos.map((producto) => (
                      <SelectItem key={producto} value={producto}>
                        {producto}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Placa</label>
                <Select value={selectedPlaca} onValueChange={setSelectedPlaca}>
                  <SelectTrigger className="min-w-[200px]">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {placas.map((placa) => (
                      <SelectItem key={placa} value={placa}>
                        {placa}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end">
              <Button onClick={loadData} variant="outline" disabled={loading}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Actualizar
              </Button>
              <Button onClick={handleExportToExcel} variant="default">
                <FileDown className="h-4 w-4 mr-2" />
                Exportar a Excel
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="max-h-[600px] overflow-y-auto overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Orden de Cargue</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead className="text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      Cargando...
                    </TableCell>
                  </TableRow>
                ) : paginatedRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No hay registros disponibles
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{record.fecha}</TableCell>
                      <TableCell>{record.cliente}</TableCell>
                      <TableCell>{record.producto}</TableCell>
                      <TableCell>{record.lote}</TableCell>
                      <TableCell>{record.location}</TableCell>
                      <TableCell className="text-right">{record.cantidad}</TableCell>
                      <TableCell>{record.ordendecargue}</TableCell>
                      <TableCell>{record.placa ?? "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownloadPDF(record.pdf, record.id)}
                          title="Descargar PDF"
                        >
                          <FileText className="h-4 w-4 text-purple-700" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {!loading && filteredRecords.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Registros por pagina:</span>
                <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                  <SelectTrigger className="w-20 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="250">250</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="1000">1000</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="text-sm text-muted-foreground">
                Mostrando {startIndex + 1}-{Math.min(endIndex, filteredRecords.length)} de {filteredRecords.length} registros
                {filteredRecords.length !== records.length && ` (${records.length} total)`}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(1)}
                  disabled={currentPage === 1}
                  title="Primera pagina"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  title="Pagina anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <div className="flex items-center gap-1 px-2">
                  <span className="text-sm">Pagina</span>
                  <Input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={currentPage}
                    onChange={(e) => goToPage(Number(e.target.value))}
                    className="w-16 h-8 text-center"
                  />
                  <span className="text-sm">de {totalPages}</span>
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  title="Pagina siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(totalPages)}
                  disabled={currentPage === totalPages}
                  title="Ultima pagina"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={annulDialogOpen} onOpenChange={setAnnulDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular Asignaciones de Ordenes</DialogTitle>
            <DialogDescription>
              Selecciona una orden de cargue para anular todas sus asignaciones de lotes
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Orden de Cargue</Label>
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Escribe para buscar la orden de cargue..."
                  value={ordenSearch}
                  onChange={(e) => handleOrdenSearch(e.target.value)}
                  className="w-full"
                />
                {ordenSearch && filteredOrdenes.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto bg-white border rounded-md shadow-lg">
                    {filteredOrdenes.map((orden) => (
                      <div
                        key={orden}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                        onClick={() => {
                          setSelectedOrdenAnular(orden)
                          setOrdenSearch(orden)
                          setFilteredOrdenes([])
                        }}
                      >
                        {orden}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedOrdenAnular && (
                <div className="text-sm text-muted-foreground">
                  Orden seleccionada: <span className="font-medium">{selectedOrdenAnular}</span>
                </div>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              Esta acción eliminará todas las líneas asociadas a esta orden de cargue y limpiará el campo horalote en
              cabeceraoc.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnulDialogOpen(false)} disabled={processing}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleAnularAsignacion} disabled={processing}>
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
              Anular Asignación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
