"use client"

import { useState, useEffect } from "react"
import { fetchConfigData } from "@/lib/config-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Loader2, Download, Eye } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/components/auth-provider"
import { BasculaOrderDetailsDialog } from "@/components/bascula-order-details-dialog"

export function BasculaView() {
  const { selectedEmpresaId } = useAuth()
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [exporting, setExporting] = useState(false)

  // Detalle de productos por orden (modal).
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedOrden, setSelectedOrden] = useState<string | null>(null)
  const [selectedPlaca, setSelectedPlaca] = useState<string | null>(null)

  const openDetails = (ordendecargue: string, placa?: string | null) => {
    setSelectedOrden(ordendecargue)
    setSelectedPlaca(placa ?? null)
    setDetailsOpen(true)
  }

  useEffect(() => {
    if (selectedEmpresaId) {
      loadData()
    }
  }, [selectedEmpresaId])

  const loadData = async () => {
    setLoading(true)
    const result = await fetchConfigData("cabeceraoc", selectedEmpresaId ?? undefined)
    if (result.success) {
      setData(result.data || [])
    } else {
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos.",
        variant: "destructive",
      })
    }
    setLoading(false)
  }

  const handleExportToExcel = async () => {
    const XLSX = await import("xlsx")
    setExporting(true)
    try {
      const dataToExport = filteredData.map((row) => ({
        "Orden de Cargue": row.ordendecargue || "",
        "Fecha Orden": row.fechaorden || "",
        "Fecha Cargue": row.fechacargue || "",
        Placa: row.placa || "",
        "Peso Orden (kg)": row.pesoorden || "",
        "Peso Báscula (kg)": row.pesovascula || "",
        "Tiquete Báscula": row.tiquetebascula || "",
      }))

      const worksheet = XLSX.utils.json_to_sheet(dataToExport)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, "Báscula")

      const fileName = `bascula_${new Date().toISOString().split("T")[0]}.xlsx`
      XLSX.writeFile(workbook, fileName)

      toast({
        title: "Éxito",
        description: "Datos exportados correctamente a Excel.",
      })
    } catch (error) {
      console.error("[v0] Error exporting to Excel:", error)
      toast({
        title: "Error",
        description: "No se pudo exportar a Excel.",
        variant: "destructive",
      })
    } finally {
      setExporting(false)
    }
  }

  const filteredData = data.filter((item) => {
    const matchesSearch = Object.values(item).some((val) =>
      String(val).toLowerCase().includes(searchTerm.toLowerCase()),
    )

    let matchesDateRange = true
    if (startDate || endDate) {
      const itemDate = item.fechaorden ? new Date(item.fechaorden) : null
      if (itemDate) {
        if (startDate && new Date(startDate) > itemDate) {
          matchesDateRange = false
        }
        if (endDate && new Date(endDate) < itemDate) {
          matchesDateRange = false
        }
      } else {
        matchesDateRange = false
      }
    }

    return matchesSearch && matchesDateRange
  })

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Ver Báscula</h2>
        <Button onClick={handleExportToExcel} disabled={exporting || filteredData.length === 0} size="sm">
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Exportar a Excel
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex items-center space-x-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm h-8 text-sm bg-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="space-y-1">
            <Label htmlFor="startDate" className="text-xs">
              Fecha desde
            </Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 text-sm bg-white"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="endDate" className="text-xs">
              Fecha hasta
            </Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 text-sm bg-white"
            />
          </div>

          {(startDate || endDate) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStartDate("")
                setEndDate("")
              }}
              className="mt-5"
            >
              Limpiar
            </Button>
          )}
        </div>
      </div>

      <div className="w-full overflow-x-auto rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs whitespace-nowrap font-semibold">Orden de Cargue</TableHead>
              <TableHead className="text-xs whitespace-nowrap font-semibold">Fecha Orden</TableHead>
              <TableHead className="text-xs whitespace-nowrap font-semibold">Fecha Cargue</TableHead>
              <TableHead className="text-xs whitespace-nowrap font-semibold">Placa</TableHead>
              <TableHead className="text-xs whitespace-nowrap font-semibold">Peso Orden (kg)</TableHead>
              <TableHead className="text-xs whitespace-nowrap font-semibold">Peso Báscula (kg)</TableHead>
              <TableHead className="text-xs whitespace-nowrap font-semibold">Tiquete Báscula</TableHead>
              <TableHead className="text-xs whitespace-nowrap font-semibold w-16 text-center">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-xs">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-xs">
                  No se encontraron registros.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs whitespace-nowrap">{row.ordendecargue}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{row.fechaorden}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{row.fechacargue}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{row.placa}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{row.pesoorden}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{row.pesovascula}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{row.tiquetebascula}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openDetails(row.ordendecargue, row.placa)}
                      title="Ver detalle de productos y lotes"
                      disabled={!row.ordendecargue}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <BasculaOrderDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        ordendecargue={selectedOrden}
        placa={selectedPlaca}
      />
    </div>
  )
}
