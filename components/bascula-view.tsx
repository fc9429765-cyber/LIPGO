"use client"

// Sistema visual LIPgo (2026-10-03, fase 8): cabecera con Eyebrow, franja de cifras reales
// (registros · peso báscula del rango), tarjetas en celular, Esqueleto de carga y EstadoVacio.
// Solo visual: ninguna consulta, filtro ni acción cambia.

import { useState, useEffect } from "react"
import { fetchConfigData } from "@/lib/config-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Scale, Search, Loader2, Download, Eye } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/components/auth-provider"
import { BasculaOrderDetailsDialog } from "@/components/bascula-order-details-dialog"
import { Cifra, Esqueleto, EstadoVacio, Eyebrow } from "@/components/ui/lipgo"

const NUM = new Intl.NumberFormat("es-CO")
const KG = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 })

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

  const pesoTotalKg = filteredData.reduce((s, r) => s + (Number(r.pesovascula) || 0), 0)
  const sinPesar = filteredData.filter((r) => !r.pesovascula).length

  return (
    <div className="space-y-4 p-2 sm:p-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-acento-tinte text-acento">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <Eyebrow>Portería y vehículos</Eyebrow>
            <h1 className="text-lg font-semibold leading-tight">Báscula</h1>
          </div>
        </div>
        <Button onClick={handleExportToExcel} disabled={exporting || filteredData.length === 0} size="sm" variant="outline">
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Exportar a Excel
        </Button>
      </div>

      {/* Franja de cifras reales */}
      {!loading && (
        <div className="lg-card grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-3 sm:px-5">
          <Cifra label="Registros" valor={NUM.format(filteredData.length)} unidad={startDate || endDate ? "en el rango" : "en total"} tamano="compacta" />
          <Cifra label="Peso báscula" valor={KG.format(pesoTotalKg)} unidad="kg" tamano="compacta" />
          <Cifra label="Sin pesar" valor={NUM.format(sinPesar)} unidad="pendientes" tono={sinPesar > 0 ? "atencion" : "ok"} tamano="compacta" className="col-span-2 sm:col-span-1" />
        </div>
      )}

      {/* Filtros */}
      <div className="lg-card flex flex-wrap items-end gap-4 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 max-w-sm text-sm"
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
              className="h-8 text-sm"
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
              className="h-8 text-sm"
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

      {/* Carga */}
      {loading && (
        <div className="lg-card p-5">
          <Esqueleto lineas={5} />
        </div>
      )}

      {/* Vacío */}
      {!loading && filteredData.length === 0 && (
        <div className="lg-card">
          <EstadoVacio
            icono={<Scale className="h-5 w-5" />}
            titulo="Sin registros de báscula"
            texto={searchTerm || startDate || endDate ? "No hay resultados con el filtro actual. Ajústalo o límpialo para ver todos los registros." : "Cuando un vehículo pase por báscula, su peso aparecerá aquí."}
          />
        </div>
      )}

      {/* Tabla (escritorio) */}
      {!loading && filteredData.length > 0 && (
        <div className="lg-card hidden overflow-hidden sm:block">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs whitespace-nowrap font-semibold">Orden de Cargue</TableHead>
                  <TableHead className="text-xs whitespace-nowrap font-semibold">Fecha Orden</TableHead>
                  <TableHead className="text-xs whitespace-nowrap font-semibold">Fecha Cargue</TableHead>
                  <TableHead className="text-xs whitespace-nowrap font-semibold">Placa</TableHead>
                  <TableHead className="lg-num text-xs whitespace-nowrap font-semibold text-right">Peso Orden (kg)</TableHead>
                  <TableHead className="lg-num text-xs whitespace-nowrap font-semibold text-right">Peso Báscula (kg)</TableHead>
                  <TableHead className="text-xs whitespace-nowrap font-semibold">Tiquete Báscula</TableHead>
                  <TableHead className="text-xs whitespace-nowrap font-semibold w-16 text-center">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="lg-num text-xs whitespace-nowrap font-medium">{row.ordendecargue}</TableCell>
                    <TableCell className="lg-num text-xs whitespace-nowrap">{row.fechaorden}</TableCell>
                    <TableCell className="lg-num text-xs whitespace-nowrap">{row.fechacargue}</TableCell>
                    <TableCell className="lg-num text-xs whitespace-nowrap">{row.placa}</TableCell>
                    <TableCell className="lg-num text-xs whitespace-nowrap text-right">{row.pesoorden ? KG.format(Number(row.pesoorden)) : "—"}</TableCell>
                    <TableCell className="lg-num text-xs whitespace-nowrap text-right font-semibold">{row.pesovascula ? KG.format(Number(row.pesovascula)) : "—"}</TableCell>
                    <TableCell className="lg-num text-xs whitespace-nowrap">{row.tiquetebascula}</TableCell>
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
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Tarjetas (celular) */}
      {!loading && filteredData.length > 0 && (
        <div className="flex flex-col gap-2.5 sm:hidden">
          {filteredData.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => openDetails(row.ordendecargue, row.placa)}
              disabled={!row.ordendecargue}
              className="lg-card flex w-full flex-col gap-1.5 px-4 py-3.5 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="lg-num text-sm font-semibold">{row.ordendecargue || "—"}</span>
                <span className="lg-num text-sm font-bold">{row.pesovascula ? `${KG.format(Number(row.pesovascula))} kg` : "Sin pesar"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="lg-num">{row.placa || "—"}</span>
                <span className="lg-num">{row.fechacargue || row.fechaorden || "—"}</span>
                {row.tiquetebascula && <span className="lg-num">Tiquete {row.tiquetebascula}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <BasculaOrderDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        ordendecargue={selectedOrden}
        placa={selectedPlaca}
      />
    </div>
  )
}
