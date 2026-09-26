"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ChevronDown } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { ChevronLeft, DollarSign, Weight, ChevronRight, Download, Clock } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getConciliacionAvimol } from "@/lib/conciliacion-avimol-actions"
import { calcularServiciosAdicionalesIndupan } from "@/lib/servicios-adicionales-indupan-actions"

interface FacturacionRecord {
  fechaorden: string
  fechacargue: string
  cliente: string
  numeroorden: string
  tiquetebascula: string
  placa: string
  producto: string
  pesobascula: number
  toneladas: number
  owner: string
  subcategoria: string
  idempresa: number
  transporte: string
  tipooperacion: string
  tarifa: number
  valor_a_facturar: number
}

interface FacturacionTurnoRecord {
  fecha: string
  nombre: string
  puesto: string
  hed: number
  tarifaturno: number
  tarifahoraextra: number
  valorextra: number
  facturacion_total: number
  costo_total: number
  utilidad: number
  idempresa: number
}

interface Filters {
  fechaDesde: string
  fechaHasta: string
  owner: string
  placa: string
  subcategoria: string
  idempresa: string
  transporte: string
  tipooperacion: string[]
}

interface TurnosFilters {
  fechaDesde: string
  fechaHasta: string
  puesto: string
  idempresa: string
}

export function FacturacionProyectos() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()
  const [activeTab, setActiveTab] = useState("toneladas")
  
  // Toneladas states
  const [data, setData] = useState<FacturacionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [pendingFilters, setPendingFilters] = useState<Filters>({
    fechaDesde: "",
    fechaHasta: "",
    owner: "",
    placa: "",
    subcategoria: "",
    idempresa: "",
    transporte: "",
    tipooperacion: [],
  })
  const [filters, setFilters] = useState<Filters>({
    fechaDesde: "",
    fechaHasta: "",
    owner: "",
    placa: "",
    subcategoria: "",
    idempresa: "",
    transporte: "",
    tipooperacion: [],
  })

  // Turnos states
  const [turnosData, setTurnosData] = useState<FacturacionTurnoRecord[]>([])
  const [turnosLoading, setTurnosLoading] = useState(false)
  const [turnosCurrentPage, setTurnosCurrentPage] = useState(1)
  const [pendingTurnosFilters, setPendingTurnosFilters] = useState<TurnosFilters>({
    fechaDesde: "",
    fechaHasta: "",
    puesto: "",
    idempresa: "",
  })
  const [turnosFilters, setTurnosFilters] = useState<TurnosFilters>({
    fechaDesde: "",
    fechaHasta: "",
    puesto: "",
    idempresa: "",
  })

  // Dropdown options
  const [owners, setOwners] = useState<string[]>([])
  const [playas, setPlayas] = useState<string[]>([])
  const [subcategorias, setSubcategorias] = useState<string[]>([])
  const [empresas, setEmpresas] = useState<{ id: number; nombre: string }[]>([])
  const [transportes, setTransportes] = useState<string[]>([])
  const [tiposOperacion, setTiposOperacion] = useState<string[]>([])
  const [puestos, setPuestos] = useState<string[]>([])

  const recordsPerPage = 500 // Changed from 1000 to ensure pagination is visible even with 1000+ records

  // Fetch data
  useEffect(() => {
    if (selectedEmpresaId) {
      fetchData()
      fetchFilterOptions()
    }
  }, [selectedEmpresaId])

  // Fetch turnos data when tab changes or empresa changes
  useEffect(() => {
    if (activeTab === "turnos" && selectedEmpresaId) {
      fetchTurnosData()
    }
  }, [activeTab, selectedEmpresaId])

  // Comparación lado a lado (pedido explícito): "Facturación de turnos" (arriba)
  // lee la vista legacy `facturacionturnos`, que factura por EJECUCIÓN. En
  // Avimol e Indupan lo que se factura REALMENTE es lo SOLICITADO Y APROBADO
  // (Servicios Adicionales) -- mismo motor que la Prefactura, para que ambas
  // cifras salgan comparables sin tocar la tabla/columnas de arriba.
  const [facturadoSolicitud, setFacturadoSolicitud] = useState<{ valor: number; registros: number } | null>(null)
  const [facturadoSolicitudLoading, setFacturadoSolicitudLoading] = useState(false)
  useEffect(() => {
    if (activeTab !== "turnos" || (selectedEmpresaId !== 1 && selectedEmpresaId !== 2)) {
      setFacturadoSolicitud(null)
      return
    }
    if (!turnosFilters.fechaDesde || !turnosFilters.fechaHasta) {
      setFacturadoSolicitud(null)
      return
    }
    let cancelado = false
    setFacturadoSolicitudLoading(true)
    ;(async () => {
      try {
        if (selectedEmpresaId === 2) {
          const res = await getConciliacionAvimol(turnosFilters.fechaDesde, turnosFilters.fechaHasta)
          if (!cancelado && res.success && res.data) {
            setFacturadoSolicitud({
              valor: res.data.resumen.cobroTurnos + res.data.resumen.cobroHorasExtra,
              registros: res.data.resumen.turnosCobrados,
            })
          }
        } else {
          const res = await calcularServiciosAdicionalesIndupan(turnosFilters.fechaDesde, turnosFilters.fechaHasta)
          if (!cancelado) {
            setFacturadoSolicitud({
              valor: res.conceptos.reduce((sum, c) => sum + c.valor, 0),
              registros: res.soporte.length,
            })
          }
        }
      } catch (error) {
        console.error("[v0] Error cargando Servicios Adicionales (facturado por solicitud):", error)
      } finally {
        if (!cancelado) setFacturadoSolicitudLoading(false)
      }
    })()
    return () => {
      cancelado = true
    }
  }, [activeTab, selectedEmpresaId, turnosFilters.fechaDesde, turnosFilters.fechaHasta])

  // `empresaIdOverride` permite que el filtro "Empresa" del panel (independiente
  // del selector global) dispare una recarga real para ese proyecto — antes
  // solo filtraba en cliente sobre datos ya acotados al selector global, lo
  // que dejaba la tabla vacía si se elegía otro proyecto.
  const fetchData = async (empresaIdOverride?: number | null): Promise<FacturacionRecord[]> => {
    try {
      setLoading(true)
      const empresaObjetivo = empresaIdOverride ?? selectedEmpresaId
      const response = await fetch(`/api/facturacion?empresaId=${empresaObjetivo}`)
      if (!response.ok) throw new Error("Failed to fetch data")
      const result = await response.json()
      console.log("[v0] Facturacion: Loaded", result.length, "records from API for empresa", empresaObjetivo)
      setData(result || [])
      return result || []
    } catch (error) {
      console.error("[v0] Error fetching data:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos de facturación",
        variant: "destructive",
      })
      return []
    } finally {
      setLoading(false)
    }
  }

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch("/api/facturacion/filters")
      if (!response.ok) throw new Error("Failed to fetch filters")
      const result = await response.json()
      setOwners(result.owners || [])
      setPlayas(result.playas || [])
      setSubcategorias(result.subcategorias || [])
      // Hardcode empresas to always show Empresa 1, 2, 3, and 4
      setEmpresas([
        { id: 1, nombre: "Empresa 1" },
        { id: 2, nombre: "Empresa 2" },
        { id: 3, nombre: "Empresa 3" },
        { id: 4, nombre: "Empresa 4" },
      ])
      setTransportes(result.transportes || [])
      setTiposOperacion(result.tiposOperacion || [])
      setPuestos(result.puestos || [])
    } catch (error) {
      console.error("Error fetching filters:", error)
    }
  }

  const fetchTurnosData = async (empresaIdOverride?: number | null): Promise<FacturacionTurnoRecord[]> => {
    try {
      setTurnosLoading(true)
      const empresaObjetivo = empresaIdOverride ?? selectedEmpresaId
      const response = await fetch(`/api/facturacion/turnos?empresaId=${empresaObjetivo}`)
      if (!response.ok) throw new Error("Failed to fetch turnos data")
      const result = await response.json()
      console.log("[v0] Facturacion Turnos: Loaded", result.length, "records from API for empresa", empresaObjetivo)
      setTurnosData(result || [])
      return result || []
    } catch (error) {
      console.error("[v0] Error fetching turnos data:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos de facturación de turnos",
        variant: "destructive",
      })
      return []
    } finally {
      setTurnosLoading(false)
    }
  }

  // Filter data
  const filteredData = data.filter((record) => {
    const fechaFiltro = record.fechacargue || record.fechaorden
    if (filters.fechaDesde && new Date(fechaFiltro) < new Date(filters.fechaDesde)) return false
    if (filters.fechaHasta && new Date(fechaFiltro) > new Date(filters.fechaHasta)) return false
    if (filters.owner && record.owner !== filters.owner) return false
    if (filters.placa && record.placa !== filters.placa) return false
    if (filters.subcategoria && record.subcategoria !== filters.subcategoria) return false
    if (filters.idempresa && record.idempresa.toString() !== filters.idempresa) return false
    if (filters.transporte && record.transporte !== filters.transporte) return false
    if (filters.tipooperacion.length > 0 && !filters.tipooperacion.includes(record.tipooperacion)) return false
    return true
  })

  // Calculate totals
  const totalValor = filteredData.reduce((sum, record) => sum + (Number(record.valor_a_facturar) || 0), 0)
  const totalToneladas = filteredData.reduce((sum, record) => sum + (Number(record.toneladas) || 0), 0)

  // Pagination
  const totalPages = Math.ceil(filteredData.length / recordsPerPage)
  const paginatedData = filteredData.slice((currentPage - 1) * recordsPerPage, currentPage * recordsPerPage)

  // Filter turnos data
  const filteredTurnosData = turnosData.filter((record) => {
    if (turnosFilters.fechaDesde && new Date(record.fecha) < new Date(turnosFilters.fechaDesde)) return false
    if (turnosFilters.fechaHasta && new Date(record.fecha) > new Date(turnosFilters.fechaHasta)) return false
    if (turnosFilters.puesto && record.puesto !== turnosFilters.puesto) return false
    if (turnosFilters.idempresa && record.idempresa.toString() !== turnosFilters.idempresa) return false
    return true
  })

  // Calculate turnos totals
  const totalFacturacionFinal = filteredTurnosData.reduce((sum, record) => sum + (Number(record.facturacion_total) || 0), 0)
  const totalCostoTotal = filteredTurnosData.reduce((sum, record) => sum + (Number(record.costo_total) || 0), 0)
  const totalUtilidad = filteredTurnosData.reduce((sum, record) => sum + (Number(record.utilidad) || 0), 0)

  // Turnos pagination
  const turnosTotalPages = Math.ceil(filteredTurnosData.length / recordsPerPage)
  const paginatedTurnosData = filteredTurnosData.slice((turnosCurrentPage - 1) * recordsPerPage, turnosCurrentPage * recordsPerPage)

  const handleFilterChange = (key: keyof Filters, value: string) => {
    setPendingFilters((prev) => ({ ...prev, [key]: value }))
  }

  const applyFilters = async () => {
    // Si el proyecto elegido en el filtro difiere del ya cargado, recarga de
    // verdad desde el servidor para ESE proyecto — antes solo filtraba en
    // cliente sobre datos ya acotados al selector global (dejaba la tabla
    // vacía al elegir otro proyecto).
    const empresaObjetivo = pendingFilters.idempresa ? Number(pendingFilters.idempresa) : selectedEmpresaId
    const baseData =
      pendingFilters.idempresa && Number(pendingFilters.idempresa) !== selectedEmpresaId
        ? await fetchData(empresaObjetivo)
        : data
    // Calculate filtered data with new filters to show accurate count
    const newFilteredData = baseData.filter((record) => {
      const fechaFiltro = record.fechacargue || record.fechaorden
      if (pendingFilters.fechaDesde && new Date(fechaFiltro) < new Date(pendingFilters.fechaDesde)) return false
      if (pendingFilters.fechaHasta && new Date(fechaFiltro) > new Date(pendingFilters.fechaHasta)) return false
      if (pendingFilters.owner && record.owner !== pendingFilters.owner) return false
      if (pendingFilters.placa && record.placa !== pendingFilters.placa) return false
      if (pendingFilters.subcategoria && record.subcategoria !== pendingFilters.subcategoria) return false
      if (pendingFilters.idempresa && record.idempresa.toString() !== pendingFilters.idempresa) return false
      if (pendingFilters.transporte && record.transporte !== pendingFilters.transporte) return false
      if (pendingFilters.tipooperacion.length > 0 && !pendingFilters.tipooperacion.includes(record.tipooperacion)) return false
      return true
    })

    setFilters(pendingFilters)
    setCurrentPage(1)
    console.log("[v0] Facturacion: Applied filters. Total data records:", data.length, "Filtered records:", newFilteredData.length)
    toast({
      title: "Filtros aplicados",
      description: `Se encontraron ${newFilteredData.length} registros con los filtros seleccionados`,
    })
  }

  const clearFilters = () => {
    setPendingFilters({
      fechaDesde: "",
      fechaHasta: "",
      owner: "",
      placa: "",
      subcategoria: "",
      idempresa: "",
      transporte: "",
      tipooperacion: [],
    })
    setFilters({
      fechaDesde: "",
      fechaHasta: "",
      owner: "",
      placa: "",
      subcategoria: "",
      idempresa: "",
      transporte: "",
      tipooperacion: [],
    })
    setCurrentPage(1)
  }

  const handleTurnosFilterChange = (key: keyof TurnosFilters, value: string) => {
    setPendingTurnosFilters((prev) => ({ ...prev, [key]: value }))
  }

  const applyTurnosFilters = async () => {
    // Mismo criterio que applyFilters: si se eligió un proyecto distinto al ya
    // cargado, recarga de verdad desde el servidor en vez de filtrar en
    // cliente sobre datos ya acotados al selector global.
    const empresaObjetivo = pendingTurnosFilters.idempresa ? Number(pendingTurnosFilters.idempresa) : selectedEmpresaId
    const baseTurnosData =
      pendingTurnosFilters.idempresa && Number(pendingTurnosFilters.idempresa) !== selectedEmpresaId
        ? await fetchTurnosData(empresaObjetivo)
        : turnosData
    const newFilteredData = baseTurnosData.filter((record) => {
      if (pendingTurnosFilters.fechaDesde && new Date(record.fecha) < new Date(pendingTurnosFilters.fechaDesde)) return false
      if (pendingTurnosFilters.fechaHasta && new Date(record.fecha) > new Date(pendingTurnosFilters.fechaHasta)) return false
      if (pendingTurnosFilters.puesto && record.puesto !== pendingTurnosFilters.puesto) return false
      if (pendingTurnosFilters.idempresa && record.idempresa.toString() !== pendingTurnosFilters.idempresa) return false
      return true
    })

    setTurnosFilters(pendingTurnosFilters)
    setTurnosCurrentPage(1)
    console.log("[v0] Facturacion Turnos: Applied filters. Total data records:", turnosData.length, "Filtered records:", newFilteredData.length)
    toast({
      title: "Filtros aplicados",
      description: `Se encontraron ${newFilteredData.length} registros con los filtros seleccionados`,
    })
  }

  const clearTurnosFilters = () => {
    setPendingTurnosFilters({
      fechaDesde: "",
      fechaHasta: "",
      puesto: "",
      idempresa: "",
    })
    setTurnosFilters({
      fechaDesde: "",
      fechaHasta: "",
      puesto: "",
      idempresa: "",
    })
    setTurnosCurrentPage(1)
  }

  const exportTurnosToExcel = async () => {
    const XLSX = await import("xlsx")
    if (filteredTurnosData.length === 0) {
      toast({
        title: "Advertencia",
        description: "No hay datos para exportar con los filtros aplicados",
        variant: "destructive",
      })
      return
    }

    // Helper to format date without timezone shift
    const formatDateForExport = (dateStr: string | null | undefined): string => {
      if (!dateStr) return ""
      // Parse as local date to avoid timezone shift (YYYY-MM-DD -> DD/MM/YYYY)
      const [year, month, day] = dateStr.split("T")[0].split("-")
      return `${day}/${month}/${year}`
    }

    // Prepare data for export with formatted values
    const exportData: any[] = filteredTurnosData.map((record) => ({
      "Fecha": formatDateForExport(record.fecha),
      "Nombre": record.nombre || "",
      "Puesto": record.puesto || "",
      "HED": (record.hed ?? 0).toFixed(2),
      "Tarifa Turno": Number(record.tarifaturno ?? 0),
      "Tarifa Hora Extra": Number(record.tarifahoraextra ?? 0),
      "Valor Extra": Number(record.valorextra ?? 0),
      "Facturación Final": Number(record.facturacion_total ?? 0),
      "Costo Total": Number(record.costo_total ?? 0),
      "Utilidad": Number(record.utilidad ?? 0),
      "Empresa": record.idempresa || "",
    }))

    // Add summary row
    exportData.push({
      "Fecha": "",
      "Nombre": "",
      "Puesto": "",
      "HED": "",
      "Tarifa Turno": "",
      "Tarifa Hora Extra": "",
      "Valor Extra": "TOTAL",
      "Facturación Final": Number(totalFacturacionFinal),
      "Costo Total": Number(totalCostoTotal),
      "Utilidad": Number(totalUtilidad),
      "Empresa": "",
    })

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(exportData)

    // Set column widths
    const columnWidths = [
      { wch: 12 }, // Fecha
      { wch: 25 }, // Nombre
      { wch: 20 }, // Puesto
      { wch: 10 }, // HED
      { wch: 15 }, // Tarifa Turno
      { wch: 18 }, // Tarifa Hora Extra
      { wch: 15 }, // Valor Extra
      { wch: 18 }, // Facturación Final
      { wch: 10 }, // Empresa
    ]
    ws["!cols"] = columnWidths

    // Create workbook and export
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Facturación Turnos")
    
    // Generate filename with current date
    const fecha = new Date().toLocaleDateString("es-CO").replace(/\//g, "-")
    XLSX.writeFile(wb, `Facturacion_Turnos_${fecha}.xlsx`)

    toast({
      title: "Exportación exitosa",
      description: `Se exportaron ${filteredTurnosData.length} registros a Excel`,
    })
  }

  const exportToExcel = async () => {
    const XLSX = await import("xlsx")
    if (filteredData.length === 0) {
      toast({
        title: "Advertencia",
        description: "No hay datos para exportar con los filtros aplicados",
        variant: "destructive",
      })
      return
    }

    // Helper to format date without timezone shift
    const formatDateForExport = (dateStr: string | null | undefined): string => {
      if (!dateStr) return ""
      // Parse as local date to avoid timezone shift (YYYY-MM-DD -> DD/MM/YYYY)
      const [year, month, day] = dateStr.split("T")[0].split("-")
      return `${day}/${month}/${year}`
    }

    // Prepare data for export with formatted values
    const exportData: any[] = filteredData.map((record) => ({
      "Fecha Orden": formatDateForExport(record.fechaorden),
      "Fecha Cargue": formatDateForExport(record.fechacargue),
      "Cliente": record.cliente || "",
      "N° Orden": record.numeroorden,
      "Tiquete Báscula": record.tiquetebascula,
      Placa: record.placa,
      Producto: record.producto,
      "Peso Báscula": record.pesobascula?.toFixed(2) || "0.00",
      Toneladas: record.toneladas,
      Owner: record.owner,
      Subcategoría: record.subcategoria,
      Empresa: record.idempresa,
      Transporte: record.transporte,
      "Tipo Operación": record.tipooperacion,
      Tarifa: Number(record.tarifa),
      "Valor a Facturar": Number(record.valor_a_facturar),
    }))

    // Add summary row
    exportData.push({
      "Fecha Orden": "",
      "Fecha Cargue": "",
      "Cliente": "",
      "N° Orden": "",
      "Tiquete Báscula": "",
      Placa: "",
      Producto: "TOTAL",
      Toneladas: totalToneladas,
      Owner: "",
      Subcategoría: "",
      Empresa: "",
      Transporte: "",
      "Tipo Operación": "",
      Tarifa: "",
      "Valor a Facturar": Number(totalValor),
    })

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(exportData)

    // Set column widths
    const columnWidths = [
      { wch: 12 }, // Fecha Orden
      { wch: 12 }, // Fecha Cargue
      { wch: 20 }, // Cliente
      { wch: 12 }, // N° Orden
      { wch: 15 }, // Tiquete Báscula
      { wch: 10 }, // Placa
      { wch: 15 }, // Producto
      { wch: 12 }, // Peso Báscula
      { wch: 10 }, // Toneladas
      { wch: 12 }, // Owner
      { wch: 15 }, // Subcategoría
      { wch: 8 },  // Empresa
      { wch: 12 }, // Transporte
      { wch: 15 }, // Tipo Operación
      { wch: 10 }, // Tarifa
      { wch: 15 }, // Valor a Facturar
    ]
    ws["!cols"] = columnWidths

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Facturación")

    // Generate filename with current date
    const now = new Date()
    const filename = `Facturacion_${now.toISOString().split("T")[0]}.xlsx`

    XLSX.writeFile(wb, filename)

    toast({
      title: "Éxito",
      description: `Se exportaron ${filteredData.length} registros a Excel`,
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Cargando datos...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 h-full overflow-y-auto p-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="toneladas" className="flex items-center gap-2">
            <Weight className="h-4 w-4" />
            Facturación Toneladas
          </TabsTrigger>
          <TabsTrigger value="turnos" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Facturación Turnos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="toneladas" className="space-y-4 mt-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <DollarSign className="h-4 w-4" />
              Valor Total a Facturar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${Number(totalValor).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-xs text-muted-foreground">{filteredData.length} registros</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Weight className="h-4 w-4" />
              Total Toneladas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalToneladas.toFixed(2)} ton</p>
            <p className="text-xs text-muted-foreground">{filteredData.length} registros</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="fechaDesde" className="text-xs">
                Fecha Cargue Desde
              </Label>
              <DatePickerField
                id="fechaDesde"
                value={pendingFilters.fechaDesde}
                onChange={(value) => handleFilterChange("fechaDesde", value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fechaHasta" className="text-xs">
                Fecha Cargue Hasta
              </Label>
              <DatePickerField
                id="fechaHasta"
                value={pendingFilters.fechaHasta}
                onChange={(value) => handleFilterChange("fechaHasta", value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Other Filters */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Owner */}
            <div className="space-y-1">
              <Label htmlFor="owner" className="text-xs">
                Owner
              </Label>
              <Select value={pendingFilters.owner} onValueChange={(value) => handleFilterChange("owner", value)}>
                <SelectTrigger id="owner" className="h-8 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((owner) => (
                    <SelectItem key={owner} value={owner}>
                      {owner}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Placa */}
            <div className="space-y-1">
              <Label htmlFor="placa" className="text-xs">
                Placa
              </Label>
              <Select value={pendingFilters.placa} onValueChange={(value) => handleFilterChange("placa", value)}>
                <SelectTrigger id="placa" className="h-8 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {playas.map((placa) => (
                    <SelectItem key={placa} value={placa}>
                      {placa}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Subcategoria */}
            <div className="space-y-1">
              <Label htmlFor="subcategoria" className="text-xs">
                Subcategoría
              </Label>
              <Select value={pendingFilters.subcategoria} onValueChange={(value) => handleFilterChange("subcategoria", value)}>
                <SelectTrigger id="subcategoria" className="h-8 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {subcategorias.map((sub) => (
                    <SelectItem key={sub} value={sub}>
                      {sub}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Empresa */}
            <div className="space-y-1">
              <Label htmlFor="empresa" className="text-xs">
                Empresa
              </Label>
              <Select value={pendingFilters.idempresa} onValueChange={(value) => handleFilterChange("idempresa", value)}>
                <SelectTrigger id="empresa" className="h-8 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map((empresa) => (
                    <SelectItem key={empresa.id} value={empresa.id.toString()}>
                      {empresa.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Transporte */}
            <div className="space-y-1">
              <Label htmlFor="transporte" className="text-xs">
                Transporte
              </Label>
              <Select value={pendingFilters.transporte} onValueChange={(value) => handleFilterChange("transporte", value)}>
                <SelectTrigger id="transporte" className="h-8 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {transportes.map((trans) => (
                    <SelectItem key={trans} value={trans}>
                      {trans}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tipo Operación - multiselect */}
            <div className="space-y-1">
              <Label className="text-xs">Tipo Operación</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-8 w-full justify-between text-xs font-normal px-2 bg-transparent"
                  >
                    <span className="truncate">
                      {pendingFilters.tipooperacion.length === 0
                        ? "Todos"
                        : pendingFilters.tipooperacion.length === 1
                        ? pendingFilters.tipooperacion[0]
                        : `${pendingFilters.tipooperacion.length} seleccionados`}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-50 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-2" align="start">
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {tiposOperacion.map((tipo) => (
                      <div key={tipo} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer"
                        onClick={() => {
                          const current = pendingFilters.tipooperacion
                          const updated = current.includes(tipo)
                            ? current.filter((t) => t !== tipo)
                            : [...current, tipo]
                          setPendingFilters((prev) => ({ ...prev, tipooperacion: updated }))
                        }}
                      >
                        <Checkbox
                          id={`tipo-${tipo}`}
                          checked={pendingFilters.tipooperacion.includes(tipo)}
                          onCheckedChange={(checked) => {
                            const current = pendingFilters.tipooperacion
                            const updated = checked
                              ? [...current, tipo]
                              : current.filter((t) => t !== tipo)
                            setPendingFilters((prev) => ({ ...prev, tipooperacion: updated }))
                          }}
                        />
                        <label htmlFor={`tipo-${tipo}`} className="text-xs cursor-pointer select-none flex-1">
                          {tipo}
                        </label>
                      </div>
                    ))}
                  </div>
                  {pendingFilters.tipooperacion.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2 h-7 text-xs"
                      onClick={() => setPendingFilters((prev) => ({ ...prev, tipooperacion: [] }))}
                    >
                      Limpiar selección
                    </Button>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={applyFilters} className="flex-1">
              Aplicar Filtros
            </Button>
            <Button onClick={clearFilters} variant="outline" className="flex-1 bg-transparent">
              Limpiar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table with Pagination */}
      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">
            Registros ({filteredData.length.toLocaleString("es-CO")})
            {totalPages > 1 && ` - Página ${currentPage} de ${totalPages}`}
          </CardTitle>
          <Button
            onClick={exportToExcel}
            variant="outline"
            size="sm"
            className="gap-2 bg-transparent"
            disabled={filteredData.length === 0}
          >
            <Download className="h-4 w-4" />
            Exportar a Excel
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto max-h-96">
          <div className="border rounded-md">
            <Table>
              <TableHeader className="sticky top-0 bg-muted">
                <TableRow>
                  <TableHead className="text-xs">Fecha Orden</TableHead>
                  <TableHead className="text-xs">Fecha Cargue</TableHead>
                  <TableHead className="text-xs">Cliente</TableHead>
                  <TableHead className="text-xs">Nº Orden</TableHead>
                  <TableHead className="text-xs">Tiquete Báscula</TableHead>
                  <TableHead className="text-xs">Placa</TableHead>
                <TableHead className="text-xs">Producto</TableHead>
                <TableHead className="text-xs text-right">Peso Báscula</TableHead>
                <TableHead className="text-xs text-right">Toneladas</TableHead>
                  <TableHead className="text-xs">Owner</TableHead>
                  <TableHead className="text-xs">Subcategoría</TableHead>
                  <TableHead className="text-xs">Empresa</TableHead>
                  <TableHead className="text-xs">Transporte</TableHead>
                  <TableHead className="text-xs">Tipo Operación</TableHead>
                  <TableHead className="text-xs text-right">Tarifa</TableHead>
                  <TableHead className="text-xs text-right">Valor a Facturar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedData.length > 0 ? (
                  paginatedData.map((record, idx) => {
                    // Parse date correctly to avoid timezone issues
                    // Extract just the date portion if it's a timestamp
                    const dateString = (record.fechaorden as any) instanceof Date
                      ? (record.fechaorden as any).toISOString().split('T')[0]
                      : typeof record.fechaorden === 'string'
                      ? record.fechaorden.split(' ')[0]
                      : new Date(record.fechaorden).toISOString().split('T')[0]
                    
                    const [year, month, day] = dateString.split('-')
                    const displayDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day)).toLocaleDateString("es-CO")

                    return (
                      <TableRow key={`ton-${idx}`} className="hover:bg-muted/50">
                        <TableCell className="text-xs">{displayDate}</TableCell>
                        <TableCell className="text-xs">
                          {record.fechacargue ? (() => {
                            const cargueStr = typeof record.fechacargue === 'string'
                              ? record.fechacargue.split(' ')[0]
                              : new Date(record.fechacargue).toISOString().split('T')[0]
                            const [cy, cm, cd] = cargueStr.split('-')
                            return new Date(parseInt(cy), parseInt(cm) - 1, parseInt(cd)).toLocaleDateString("es-CO")
                          })() : ""}
                        </TableCell>
                        <TableCell className="text-xs">{record.cliente || ""}</TableCell>
                        <TableCell className="text-xs">{record.numeroorden}</TableCell>
                        <TableCell className="text-xs">{record.tiquetebascula}</TableCell>
                        <TableCell className="text-xs font-medium">{record.placa}</TableCell>
              <TableCell className="text-xs">{record.producto}</TableCell>
              <TableCell className="text-xs text-right">{record.pesobascula?.toFixed(2) || "0.00"}</TableCell>
              <TableCell className="text-xs text-right">{record.toneladas.toFixed(3)}</TableCell>
                        <TableCell className="text-xs">{record.owner}</TableCell>
                        <TableCell className="text-xs">{record.subcategoria}</TableCell>
                        <TableCell className="text-xs">{record.idempresa}</TableCell>
                        <TableCell className="text-xs">{record.transporte}</TableCell>
                        <TableCell className="text-xs">{record.tipooperacion}</TableCell>
                        <TableCell className="text-xs text-right">${record.tarifa.toLocaleString("es-CO", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">
                          ${record.valor_a_facturar.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={15} className="text-center text-xs text-muted-foreground py-8">
                      No hay registros que coincidan con los filtros
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t gap-4">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Primera
              </Button>
              <Button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Página</span>
              <Input
                type="number"
                min={1}
                max={totalPages}
                value={currentPage}
                onChange={(e) => {
                  const page = Math.min(Math.max(Number(e.target.value) || 1, 1), totalPages)
                  setCurrentPage(page)
                }}
                className="h-8 w-16 text-xs text-center"
              />
              <span className="text-xs text-muted-foreground">de {totalPages}</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                Última
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
        </TabsContent>

        <TabsContent value="turnos" className="space-y-4 mt-4">
          {(selectedEmpresaId === 1 || selectedEmpresaId === 2) && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-200">
              <p>
                Esta tabla factura por <strong>EJECUCIÓN</strong> (turno/hora extra trabajado). En este proyecto, lo que
                REALMENTE se factura al cliente es lo <strong>SOLICITADO Y APROBADO</strong> en Servicios Adicionales
                (mismo motor que la Prefactura) -- compara con la tarjeta "Facturado por Solicitud" abajo. Selecciona un
                rango Desde/Hasta para calcularla.
              </p>
            </div>
          )}
          {/* Turnos Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <DollarSign className="h-4 w-4" />
                  Valor Total Facturación (por ejecución)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${Number(totalFacturacionFinal).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground">{filteredTurnosData.length} registros</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <DollarSign className="h-4 w-4" />
                  Costo Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${Number(totalCostoTotal).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground">{filteredTurnosData.length} registros</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <DollarSign className="h-4 w-4" />
                  Utilidad
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${Number(totalUtilidad).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground">{filteredTurnosData.length} registros</p>
              </CardContent>
            </Card>
          </div>

          {(selectedEmpresaId === 1 || selectedEmpresaId === 2) && (
            <div className="grid gap-4 md:grid-cols-1">
              <Card className="border-primary/30">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <DollarSign className="h-4 w-4" />
                    Facturado por Solicitud (Servicios Adicionales -- lo REAL)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!turnosFilters.fechaDesde || !turnosFilters.fechaHasta ? (
                    <p className="text-xs text-muted-foreground">Selecciona un rango Desde/Hasta abajo para calcularlo.</p>
                  ) : facturadoSolicitudLoading ? (
                    <p className="text-xs text-muted-foreground">Calculando…</p>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-primary">
                        ${Number(facturadoSolicitud?.valor ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {facturadoSolicitud?.registros ?? 0} línea(s) solicitadas y aprobadas -- turnos/horas extra
                        solicitados en Operación LIP, cruzados contra el maestro de tarifas.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Turnos Filters Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Filtros de Búsqueda</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm">Fecha Desde</Label>
                  <DatePickerField
                    value={pendingTurnosFilters.fechaDesde}
                    onChange={(value) => handleTurnosFilterChange("fechaDesde", value)}
                    className="text-sm h-9"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Fecha Hasta</Label>
                  <DatePickerField
                    value={pendingTurnosFilters.fechaHasta}
                    onChange={(value) => handleTurnosFilterChange("fechaHasta", value)}
                    className="text-sm h-9"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Puesto</Label>
                  <Select
                    value={pendingTurnosFilters.puesto}
                    onValueChange={(value) => handleTurnosFilterChange("puesto", value)}
                  >
                    <SelectTrigger className="text-sm h-9">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      {puestos.map((puesto) => (
                        <SelectItem key={puesto} value={puesto}>
                          {puesto}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Empresa</Label>
                  <Select
                    value={pendingTurnosFilters.idempresa}
                    onValueChange={(value) => handleTurnosFilterChange("idempresa", value)}
                  >
                    <SelectTrigger className="text-sm h-9">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas</SelectItem>
                      {empresas.map((empresa) => (
                        <SelectItem key={empresa.id} value={empresa.id.toString()}>
                          {empresa.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={applyTurnosFilters} size="sm">
                  Aplicar Filtros
                </Button>
                <Button onClick={clearTurnosFilters} variant="outline" size="sm">
                  Limpiar Filtros
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Turnos Data Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-sm">
                Registros ({filteredTurnosData.length.toLocaleString("es-CO")})
                {turnosTotalPages > 1 && ` - Página ${turnosCurrentPage} de ${turnosTotalPages}`}
              </CardTitle>
              <Button
                onClick={exportTurnosToExcel}
                variant="outline"
                size="sm"
                className="gap-2 bg-transparent"
                disabled={filteredTurnosData.length === 0}
              >
                <Download className="h-4 w-4" />
                Exportar a Excel
              </Button>
            </CardHeader>
            <CardContent className="p-4">
              <div className="border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted">
                    <TableRow>
                      <TableHead className="text-xs">Fecha</TableHead>
                      <TableHead className="text-xs">Nombre</TableHead>
                      <TableHead className="text-xs">Puesto</TableHead>
                      <TableHead className="text-xs text-right">HED</TableHead>
                      <TableHead className="text-xs text-right">Tarifa Turno</TableHead>
                      <TableHead className="text-xs text-right">Tarifa Hora Extra</TableHead>
                      <TableHead className="text-xs text-right">Valor Extra</TableHead>
                      <TableHead className="text-xs text-right">Facturación Final</TableHead>
                      <TableHead className="text-xs text-right">Costo Total</TableHead>
                      <TableHead className="text-xs text-right">Utilidad</TableHead>
                      <TableHead className="text-xs">Empresa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {turnosLoading ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center text-xs text-muted-foreground py-8">
                          Cargando datos...
                        </TableCell>
                      </TableRow>
                    ) : paginatedTurnosData.length > 0 ? (
                      paginatedTurnosData.map((record, idx) => {
                        const dateString = (record.fecha as any) instanceof Date
                          ? (record.fecha as any).toISOString().split('T')[0]
                          : typeof record.fecha === 'string'
                          ? record.fecha.split(' ')[0]
                          : new Date(record.fecha).toISOString().split('T')[0]
                        
                        const [year, month, day] = dateString.split('-')
                        const displayDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day)).toLocaleDateString("es-CO")

                        return (
                          <TableRow key={`turno-${idx}`} className="hover:bg-muted/50">
                            <TableCell className="text-xs">{displayDate}</TableCell>
                            <TableCell className="text-xs">{record.nombre || "-"}</TableCell>
                            <TableCell className="text-xs">{record.puesto || "-"}</TableCell>
                            <TableCell className="text-xs text-right">{(record.hed ?? 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(record.tarifaturno ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-xs text-right">${(record.tarifahoraextra ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-xs text-right">${(record.valorextra ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-xs text-right font-semibold">
                              ${(record.facturacion_total ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              ${(record.costo_total ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              ${(record.utilidad ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-xs">{record.idempresa || "-"}</TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center text-xs text-muted-foreground py-8">
                          No hay registros que coincidan con los filtros
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>

            {/* Turnos Pagination Controls */}
            {turnosTotalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t gap-4">
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setTurnosCurrentPage(1)}
                    disabled={turnosCurrentPage === 1}
                    variant="outline"
                    size="sm"
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Primera
                  </Button>
                  <Button
                    onClick={() => setTurnosCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={turnosCurrentPage === 1}
                    variant="outline"
                    size="sm"
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Página</span>
                  <Input
                    type="number"
                    min={1}
                    max={turnosTotalPages}
                    value={turnosCurrentPage}
                    onChange={(e) => {
                      const page = parseInt(e.target.value)
                      if (page >= 1 && page <= turnosTotalPages) {
                        setTurnosCurrentPage(page)
                      }
                    }}
                    className="h-8 w-16 text-xs text-center"
                  />
                  <span className="text-xs text-muted-foreground">de {turnosTotalPages}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setTurnosCurrentPage((prev) => Math.min(prev + 1, turnosTotalPages))}
                    disabled={turnosCurrentPage === turnosTotalPages}
                    variant="outline"
                    size="sm"
                    className="gap-1"
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => setTurnosCurrentPage(turnosTotalPages)}
                    disabled={turnosCurrentPage === turnosTotalPages}
                    variant="outline"
                    size="sm"
                    className="gap-1"
                  >
                    Última
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
