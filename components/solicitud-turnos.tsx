"use client"

import { useState, useRef, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { Loader2, Plus, Trash2, Pen, Eraser, FileSignature, Send, History, ArrowLeft, FileSpreadsheet, FileText, X } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { createSolicitudTurnos, getSolicitudesTurnos, getPuestosFacturacion } from "@/lib/solicitud-turnos-actions"
import { Badge } from "@/components/ui/badge"
// XLSX se usa para exportar el historial filtrado a Excel. Ya esta
// instalado en otros modulos del proyecto (ApprovalHistory, etc.).

interface LineaSolicitud {
  id: string
  puesto: string
  fecharequerida: string
  cantidad: number
  // Nuevo: define si la línea corresponde a "Turnos" u "Horas Extra".
  // Se persiste en la columna `tipo` de solicitudesturnos. Se deja como
  // string para convivir con updateLinea(field, value: string | number).
  tipo: string
}

interface SolicitudTurno {
  id: number
  fechasolicitud: string
  idempresa: number
  puesto: string
  fecharequerida: string
  nombresolicitante: string
  estado: string
  nombreaprobo: string | null
  cantidad: number
  firmasolicitante: string | null
  firmaaprobo: string | null
  usuariosolicitud: string | null
  // Tipo de servicio adicional (Turnos / Horas Extra).
  tipo: string | null
  // URL al PDF generado al momento de la aprobacion. Se persiste en
  // la columna `pdfaprobacion` de solicitudesturnos (ver script
  // scripts/007_add-pdfaprobacion-column.sql). Es null para solicitudes
  // pendientes / rechazadas.
  pdfaprobacion: string | null
}

export function SolicitudTurnos() {
  const { selectedEmpresaId, profile } = useAuth()
  const [nombresolicitante, setNombresolicitante] = useState("")
  const [lineas, setLineas] = useState<LineaSolicitud[]>([
    { id: crypto.randomUUID(), puesto: "", fecharequerida: "", cantidad: 1, tipo: "Turnos" }
  ])
  const [saving, setSaving] = useState(false)
  
  // View mode: "form" or "history"
  const [viewMode, setViewMode] = useState<"form" | "history">("form")
  const [historial, setHistorial] = useState<SolicitudTurno[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  // Filtros del historial: rango de fechas aplicado sobre
  // `fechasolicitud`. Si alguno esta vacio se ignora ese lado del
  // rango, permitiendo filtros abiertos ("desde X" o "hasta Y").
  const [filterFechaDesde, setFilterFechaDesde] = useState("")
  const [filterFechaHasta, setFilterFechaHasta] = useState("")
  // Filtros del resto de columnas del historial -- uno por columna,
  // para poder acotar la tabla por cualquiera de ellas de forma
  // independiente (se combinan todos con AND).
  const [filterSolicitante, setFilterSolicitante] = useState("")
  const [filterTipo, setFilterTipo] = useState("")
  const [filterPuesto, setFilterPuesto] = useState("")
  const [filterServicioDesde, setFilterServicioDesde] = useState("")
  const [filterServicioHasta, setFilterServicioHasta] = useState("")
  const [filterCantidadMin, setFilterCantidadMin] = useState("")
  const [filterEstado, setFilterEstado] = useState("")
  const [filterAprobadoPor, setFilterAprobadoPor] = useState("")
  const [filterSoloConPdf, setFilterSoloConPdf] = useState(false)
  // Visor inline para el PDF de aprobacion. Mostramos el archivo en
  // un <iframe> dentro de un Dialog para no obligar al usuario a
  // abrir una pestaña externa (mejor experiencia en pantallas TV).
  const [selectedPdf, setSelectedPdf] = useState<{ url: string; title: string } | null>(null)
  
  // Signature
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)

  // Catálogo de puestos (maestro `tarifasfacturacionturnos`). El puesto ya no
  // se escribe libre: se elige de aquí para que la solicitud pueda cruzarse
  // después contra lo que se le FACTURA al cliente por horas extra.
  const [puestos, setPuestos] = useState<string[]>([])
  const [loadingPuestos, setLoadingPuestos] = useState(true)

  // Pre-fill nombre solicitante from profile
  useEffect(() => {
    if (profile?.nombre) {
      setNombresolicitante(profile.nombre)
    }
  }, [profile])

  useEffect(() => {
    getPuestosFacturacion()
      .then((r) => {
        if (r.success) setPuestos(r.data)
        else
          toast({
            title: "No se pudieron cargar los puestos",
            description: r.message,
            variant: "destructive",
          })
      })
      .finally(() => setLoadingPuestos(false))
  }, [])

  const loadHistorial = async () => {
    setLoadingHistory(true)
    const result = await getSolicitudesTurnos(selectedEmpresaId)
    if (result.success) {
      setHistorial(result.data)
    }
    setLoadingHistory(false)
  }

  // Si el usuario cambia la empresa en el filtro dinamico mientras
  // tiene abierto el historial, recargamos para que el listado
  // refleje solo las solicitudes de la empresa seleccionada. Sin esto
  // el historial quedaba pegado a la empresa que estaba activa cuando
  // se abrio la vista por primera vez.
  useEffect(() => {
    if (viewMode === "history") {
      loadHistorial()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const handleViewHistory = () => {
    setViewMode("history")
    loadHistorial()
  }

  // Historial filtrado por rango de fechas (campo `fechasolicitud`).
  // Comparamos strings directamente porque la columna esta en formato
  // ISO YYYY-MM-DD, que es ordenable lexicograficamente; asi evitamos
  // crear Date() y problemas de zona horaria.
  const filteredHistorial = historial.filter((s) => {
    const fecha = s.fechasolicitud
    if (!fecha) return false
    if (filterFechaDesde && fecha < filterFechaDesde) return false
    if (filterFechaHasta && fecha > filterFechaHasta) return false
    if (filterSolicitante && !s.nombresolicitante?.toLowerCase().includes(filterSolicitante.toLowerCase())) return false
    if (filterTipo && (s.tipo || "Turnos") !== filterTipo) return false
    if (filterPuesto && s.puesto !== filterPuesto) return false
    if (filterServicioDesde && (!s.fecharequerida || s.fecharequerida < filterServicioDesde)) return false
    if (filterServicioHasta && (!s.fecharequerida || s.fecharequerida > filterServicioHasta)) return false
    if (filterCantidadMin && s.cantidad < Number(filterCantidadMin)) return false
    if (filterEstado && s.estado?.toLowerCase() !== filterEstado.toLowerCase()) return false
    if (filterAprobadoPor && !(s.nombreaprobo || "").toLowerCase().includes(filterAprobadoPor.toLowerCase())) return false
    if (filterSoloConPdf && !s.pdfaprobacion) return false
    return true
  })

  // Descarga del Excel del resultado filtrado. Exportamos columnas
  // legibles (nombres en castellano) para que el archivo pueda
  // compartirse fuera de la app sin necesidad de mapeo adicional.
  // Incluimos la URL del PDF de aprobacion como columna (texto plano)
  // para que el receptor pueda abrirlo desde Excel.
  const handleDownloadExcel = async () => {
    const XLSX = await import("xlsx")
    if (filteredHistorial.length === 0) {
      toast({
        title: "Sin datos",
        description: "No hay solicitudes para exportar con los filtros aplicados",
      })
      return
    }
    const rows = filteredHistorial.map((s) => ({
      "Fecha Solicitud": s.fechasolicitud,
      Solicitante: s.nombresolicitante,
      Tipo: s.tipo || "Turnos",
      Puesto: s.puesto,
      "Fecha de Servicio": s.fecharequerida,
      Cantidad: s.cantidad,
      Estado: s.estado,
      "Aprobado Por": s.nombreaprobo || "",
      "PDF Aprobación": s.pdfaprobacion || "",
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Servicios Adicionales")
    const fecha = new Date().toISOString().split("T")[0]
    const filename = `servicios_adicionales_${fecha}.xlsx`
    XLSX.writeFile(wb, filename)
    toast({
      title: "Éxito",
      description: `Archivo ${filename} descargado exitosamente`,
    })
  }

  const clearFilters = () => {
    setFilterFechaDesde("")
    setFilterFechaHasta("")
    setFilterSolicitante("")
    setFilterTipo("")
    setFilterPuesto("")
    setFilterServicioDesde("")
    setFilterServicioHasta("")
    setFilterCantidadMin("")
    setFilterEstado("")
    setFilterAprobadoPor("")
    setFilterSoloConPdf(false)
  }

  const hayFiltrosActivos =
    !!filterFechaDesde || !!filterFechaHasta || !!filterSolicitante || !!filterTipo || !!filterPuesto ||
    !!filterServicioDesde || !!filterServicioHasta || !!filterCantidadMin || !!filterEstado || !!filterAprobadoPor ||
    filterSoloConPdf

  const getEstadoBadge = (estado: string) => {
    switch (estado?.toLowerCase()) {
      case "aprobado":
        return <Badge className="bg-green-500 hover:bg-green-600">Aprobado</Badge>
      case "rechazado":
        return <Badge variant="destructive">Rechazado</Badge>
      case "pendiente":
      default:
        return <Badge variant="secondary">Pendiente</Badge>
    }
  }

  const addLinea = () => {
    setLineas([...lineas, { id: crypto.randomUUID(), puesto: "", fecharequerida: "", cantidad: 1, tipo: "Turnos" }])
  }

  const removeLinea = (id: string) => {
    if (lineas.length > 1) {
      setLineas(lineas.filter(l => l.id !== id))
    }
  }

  const updateLinea = (id: string, field: keyof LineaSolicitud, value: string | number) => {
    setLineas(lineas.map(l => l.id === id ? { ...l, [field]: value } : l))
  }

  // Signature drawing functions
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    setIsDrawing(true)
    const rect = canvas.getBoundingClientRect()
    let x, y
    if ("touches" in e) {
      x = e.touches[0].clientX - rect.left
      y = e.touches[0].clientY - rect.top
    } else {
      x = e.clientX - rect.left
      y = e.clientY - rect.top
    }
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    let x, y
    if ("touches" in e) {
      x = e.touches[0].clientX - rect.left
      y = e.touches[0].clientY - rect.top
    } else {
      x = e.clientX - rect.left
      y = e.clientY - rect.top
    }
    ctx.lineTo(x, y)
    ctx.strokeStyle = "#000"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.stroke()
    setHasSignature(true)
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  const initCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#000000"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    setSignatureDataUrl(null)
  }

  const confirmSignature = () => {
    const canvas = canvasRef.current
    if (canvas && hasSignature) {
      const dataUrl = canvas.toDataURL("image/png")
      setSignatureDataUrl(dataUrl)
      console.log("[v0] Signature confirmed and saved as dataURL")
    }
    setSignatureDialogOpen(false)
  }

  // Initialize canvas when dialog opens
  useEffect(() => {
    if (signatureDialogOpen) {
      // Small delay to ensure canvas is rendered
      setTimeout(() => {
        initCanvas()
      }, 100)
    }
  }, [signatureDialogOpen])

  const handleSubmit = async () => {
    // Validations
    if (!nombresolicitante.trim()) {
      toast({ title: "Error", description: "Ingrese el nombre del solicitante", variant: "destructive" })
      return
    }

    const lineasValidas = lineas.filter(l => l.puesto.trim() && l.fecharequerida && l.cantidad > 0)
    if (lineasValidas.length === 0) {
      toast({ title: "Error", description: "Agregue al menos un puesto con fecha y cantidad", variant: "destructive" })
      return
    }

    if (!hasSignature || !signatureDataUrl) {
      toast({ title: "Error", description: "Debe firmar la solicitud", variant: "destructive" })
      return
    }

    setSaving(true)
    try {
      // Upload signature - convert dataURL to blob
      let firmaUrl: string | null = null
      if (signatureDataUrl) {
        console.log("[v0] Converting signature dataURL to blob...")
        // Convert base64 dataURL to blob
        const base64Data = signatureDataUrl.split(",")[1]
        const byteCharacters = atob(base64Data)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: "image/png" })
        
        console.log("[v0] Blob created, size:", blob.size)
        
        const formDataUpload = new FormData()
        formDataUpload.append("file", blob, `firma_solicitud_${Date.now()}.png`)
        
        console.log("[v0] Uploading signature to /api/upload-signature...")
        const uploadRes = await fetch("/api/upload-signature", {
          method: "POST",
          body: formDataUpload,
        })
        
        console.log("[v0] Upload response status:", uploadRes.status)
        
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json()
          firmaUrl = uploadData.url
          console.log("[v0] Signature uploaded successfully:", firmaUrl)
        } else {
          const errorText = await uploadRes.text()
          console.error("[v0] Failed to upload signature:", errorText)
        }
      }

      // Create one record per line
      const result = await createSolicitudTurnos({
        nombresolicitante: nombresolicitante.trim(),
        lineas: lineasValidas,
        firmasolicitante: firmaUrl,
        idempresa: selectedEmpresaId,
      })

      if (result.success) {
        toast({ title: "Solicitud enviada", description: `Se crearon ${lineasValidas.length} solicitud(es) de turno` })
        // Reset form
        setNombresolicitante(profile?.nombre || "")
        setLineas([{ id: crypto.randomUUID(), puesto: "", fecharequerida: "", cantidad: 1, tipo: "Turnos" }])
        setHasSignature(false)
        setSignatureDataUrl(null)
      } else {
        toast({ title: "Error", description: result.message || "Error al crear la solicitud", variant: "destructive" })
      }
    } catch (error) {
      console.error("[v0] Error creating solicitud:", error)
      toast({ title: "Error", description: "Error al procesar la solicitud", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5" />
              {viewMode === "form" ? "Servicios Adicionales" : "Historial de Solicitudes"}
            </CardTitle>
            {viewMode === "form" ? (
              <Button variant="outline" onClick={handleViewHistory}>
                <History className="h-4 w-4 mr-2" />
                Ver Historial
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setViewMode("form")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver al Formulario
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {viewMode === "form" ? (
            <>
          {/* Nombre del solicitante */}
          <div className="space-y-2">
            <Label htmlFor="nombresolicitante">Nombre del Solicitante</Label>
            <Input
              id="nombresolicitante"
              value={nombresolicitante}
              onChange={(e) => setNombresolicitante(e.target.value)}
              placeholder="Ingrese su nombre completo"
            />
          </div>

          {/* Lineas de solicitud */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Puestos Solicitados</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLinea}>
                <Plus className="h-4 w-4 mr-1" />
                Agregar línea
              </Button>
            </div>

            {!loadingPuestos && puestos.length === 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                No hay puestos configurados en <strong>Financiera › Tarifas › Tarifas de Facturación Turnos</strong>.
                El puesto de la solicitud se toma de ahí para poder cruzarla después contra lo que se le factura al
                cliente, así que hay que crear al menos uno antes de solicitar.
              </div>
            )}

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[25%]">Tipo de Servicio</TableHead>
                    <TableHead className="w-[30%]">Puesto</TableHead>
                    <TableHead className="w-[20%]">Fecha de Servicio</TableHead>
                    <TableHead className="w-[15%]">Cantidad</TableHead>
                    <TableHead className="w-[10%]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineas.map((linea) => (
                    <TableRow key={linea.id}>
                      <TableCell>
                        <Select
                          value={linea.tipo}
                          onValueChange={(value) => updateLinea(linea.id, "tipo", value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccione tipo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Turnos">Turnos</SelectItem>
                            <SelectItem value="Horas Extra">Horas Extra</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={linea.puesto}
                          onValueChange={(value) => updateLinea(linea.id, "puesto", value)}
                          disabled={loadingPuestos || puestos.length === 0}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                loadingPuestos
                                  ? "Cargando puestos…"
                                  : puestos.length === 0
                                    ? "Sin puestos configurados"
                                    : "Selecciona el puesto"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {puestos.map((p) => (
                              <SelectItem key={p} value={p}>
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <DatePickerField
                          value={linea.fecharequerida}
                          onChange={(value) => updateLinea(linea.id, "fecharequerida", value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          value={linea.cantidad}
                          onChange={(e) => updateLinea(linea.id, "cantidad", parseInt(e.target.value) || 1)}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLinea(linea.id)}
                          disabled={lineas.length === 1}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Firma digital */}
          <div className="space-y-2">
            <Label>Firma del Solicitante</Label>
            {signatureDataUrl ? (
              <div className="space-y-2">
                <div className="border rounded-md p-2 bg-white">
                  <img 
                    src={signatureDataUrl} 
                    alt="Firma del solicitante" 
                    className="max-h-32 mx-auto"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSignatureDialogOpen(true)}
                  className="w-full"
                >
                  <Pen className="h-4 w-4 mr-2" />
                  Modificar firma
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setSignatureDialogOpen(true)}
                className="w-full"
              >
                <Pen className="h-4 w-4 mr-2" />
                Firmar solicitud
              </Button>
            )}
          </div>

          {/* Submit button */}
          <Button 
            onClick={handleSubmit} 
            disabled={saving} 
            className="w-full"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enviando solicitud...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Enviar Solicitud
              </>
            )}
          </Button>
            </>
          ) : (
            /* History View */
            <div className="space-y-4">
              {/* Barra de filtros y exportacion -- un control por columna
                  del historial, todos combinados con AND. Grid responsivo
                  para no desbordar con 9 controles. */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="filter-fecha-desde" className="text-xs">
                      Fecha solicitud desde
                    </Label>
                    <DatePickerField
                      id="filter-fecha-desde"
                      value={filterFechaDesde}
                      onChange={setFilterFechaDesde}
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="filter-fecha-hasta" className="text-xs">
                      Fecha solicitud hasta
                    </Label>
                    <DatePickerField
                      id="filter-fecha-hasta"
                      value={filterFechaHasta}
                      onChange={setFilterFechaHasta}
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="filter-solicitante" className="text-xs">
                      Solicitante
                    </Label>
                    <Input
                      id="filter-solicitante"
                      value={filterSolicitante}
                      onChange={(e) => setFilterSolicitante(e.target.value)}
                      placeholder="Buscar solicitante"
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Tipo</Label>
                    <Select value={filterTipo || "todos"} onValueChange={(v) => setFilterTipo(v === "todos" ? "" : v)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos los tipos</SelectItem>
                        <SelectItem value="Turnos">Turnos</SelectItem>
                        <SelectItem value="Horas Extra">Horas Extra</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Puesto</Label>
                    <Select value={filterPuesto || "todos"} onValueChange={(v) => setFilterPuesto(v === "todos" ? "" : v)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos los puestos</SelectItem>
                        {puestos.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="filter-servicio-desde" className="text-xs">
                      Fecha de servicio desde
                    </Label>
                    <DatePickerField
                      id="filter-servicio-desde"
                      value={filterServicioDesde}
                      onChange={setFilterServicioDesde}
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="filter-servicio-hasta" className="text-xs">
                      Fecha de servicio hasta
                    </Label>
                    <DatePickerField
                      id="filter-servicio-hasta"
                      value={filterServicioHasta}
                      onChange={setFilterServicioHasta}
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="filter-cantidad-min" className="text-xs">
                      Cantidad mínima
                    </Label>
                    <Input
                      id="filter-cantidad-min"
                      type="number"
                      min={0}
                      value={filterCantidadMin}
                      onChange={(e) => setFilterCantidadMin(e.target.value)}
                      placeholder="Ej: 5"
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Estado</Label>
                    <Select value={filterEstado || "todos"} onValueChange={(v) => setFilterEstado(v === "todos" ? "" : v)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos los estados</SelectItem>
                        <SelectItem value="pendiente">Pendiente</SelectItem>
                        <SelectItem value="aprobado">Aprobado</SelectItem>
                        <SelectItem value="rechazado">Rechazado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="filter-aprobado-por" className="text-xs">
                      Aprobado por
                    </Label>
                    <Input
                      id="filter-aprobado-por"
                      value={filterAprobadoPor}
                      onChange={(e) => setFilterAprobadoPor(e.target.value)}
                      placeholder="Buscar aprobador"
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col justify-end gap-1 pb-1.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterSoloConPdf}
                        onChange={(e) => setFilterSoloConPdf(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      Solo con PDF de aprobación
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {hayFiltrosActivos && (
                    <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="h-9">
                      <X className="h-4 w-4 mr-1" />
                      Limpiar filtros
                    </Button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {filteredHistorial.length} de {historial.length} solicitudes
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadExcel}
                      disabled={filteredHistorial.length === 0}
                    >
                      <FileSpreadsheet className="h-4 w-4 mr-1" />
                      Descargar Excel
                    </Button>
                  </div>
                </div>
              </div>

              {loadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  Cargando historial...
                </div>
              ) : historial.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No hay solicitudes registradas
                </div>
              ) : filteredHistorial.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No hay solicitudes con los filtros seleccionados
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha Solicitud</TableHead>
                        <TableHead>Solicitante</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Puesto</TableHead>
                        <TableHead>Fecha de Servicio</TableHead>
                        <TableHead>Cantidad</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Aprobado Por</TableHead>
                        <TableHead>PDF Aprobación</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredHistorial.map((solicitud) => (
                        <TableRow key={solicitud.id}>
                          <TableCell>{solicitud.fechasolicitud}</TableCell>
                          <TableCell>{solicitud.nombresolicitante}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{solicitud.tipo || "Turnos"}</Badge>
                          </TableCell>
                          <TableCell>{solicitud.puesto}</TableCell>
                          <TableCell>{solicitud.fecharequerida}</TableCell>
                          <TableCell>{solicitud.cantidad}</TableCell>
                          <TableCell>{getEstadoBadge(solicitud.estado)}</TableCell>
                          <TableCell>{solicitud.nombreaprobo || "-"}</TableCell>
                          <TableCell>
                            {solicitud.pdfaprobacion ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setSelectedPdf({
                                    url: solicitud.pdfaprobacion!,
                                    title: `PDF Aprobación · Solicitud #${solicitud.id}`,
                                  })
                                }
                              >
                                <FileText className="h-4 w-4 mr-1" />
                                Ver PDF
                              </Button>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* PDF Aprobacion Viewer Dialog. Renderizamos el archivo con un
          <iframe> para visualizarlo inline. Si el navegador del usuario
          no permite mostrar el PDF inline (cabeceras del bucket o tipos
          MIME), ofrecemos un boton "Abrir en pestaña nueva" como
          fallback para no dejar al usuario sin acceso al documento. */}
      <Dialog open={!!selectedPdf} onOpenChange={() => setSelectedPdf(null)}>
        <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {selectedPdf?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 border rounded-lg overflow-hidden bg-muted">
            {selectedPdf && (
              <iframe
                src={selectedPdf.url}
                title={selectedPdf.title}
                className="w-full h-full"
              />
            )}
          </div>
          <DialogFooter>
            {selectedPdf && (
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(selectedPdf.url, "_blank", "noopener,noreferrer")}
              >
                Abrir en pestaña nueva
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signature Drawing Dialog */}
      <Dialog open={signatureDialogOpen} onOpenChange={setSignatureDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Firma Digital</DialogTitle>
            <DialogDescription>
              Dibuje su firma en el recuadro usando el mouse o el dedo en dispositivos táctiles.
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg bg-white p-2">
            <canvas
              ref={canvasRef}
              width={350}
              height={150}
              className="border border-dashed border-gray-300 rounded cursor-crosshair touch-none w-full"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          </div>
          <DialogFooter className="flex gap-2">
            <Button type="button" variant="outline" onClick={clearSignature}>
              <Eraser className="h-4 w-4 mr-1" />
              Borrar
            </Button>
            <Button type="button" onClick={confirmSignature} disabled={!hasSignature}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
