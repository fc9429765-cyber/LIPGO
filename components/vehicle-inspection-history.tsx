"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { History, Download, FilterX, ImageIcon, CheckCircle2, XCircle, PenLine } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  getVehicleInspections,
  type VehicleInspectionRecord,
} from "@/lib/vehicle-inspection-actions"
import { useAuth } from "@/components/auth-provider"

// Criterios: clave de columna + etiqueta visible (para exportar y resumir).
const CRITERIOS = [
  { key: "documentos_vehiculo", label: "Documentos del Vehiculo" },
  { key: "bpms_transportador", label: "BPM's de Transportador" },
  { key: "paredes_ok", label: "Paredes" },
  { key: "piso_ok", label: "Piso" },
  { key: "estibas_ok", label: "Estibas" },
  { key: "techo_carpa_ok", label: "Techo / Carpa" },
  { key: "ausencia_plagas", label: "Ausencia de Plagas" },
  { key: "ausencia_quimicos", label: "Ausencia de Sustancias Quimicas" },
] as const

function formatFecha(iso: string | null): string {
  if (!iso) return "-"
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function VehicleInspectionHistory() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const [registros, setRegistros] = useState<VehicleInspectionRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros de rango de fecha (YYYY-MM-DD). Vacios = sin limite.
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  // Galeria de fotos del registro seleccionado (dialog).
  const [fotosActivas, setFotosActivas] = useState<{ placa: string; fotos: string[] } | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const res = await getVehicleInspections({
      desde: desde || undefined,
      hasta: hasta || undefined,
      selectedEmpresaId: selectedEmpresaId ?? undefined,
    })
    if (res.success) {
      setRegistros(res.data)
    } else {
      toast({ title: "Error", description: res.error || "No se pudo cargar el historial.", variant: "destructive" })
    }
    setLoading(false)
  }, [desde, hasta, toast, selectedEmpresaId])

  useEffect(() => {
    cargar()
  }, [cargar])

  const hayFiltro = desde !== "" || hasta !== ""

  const limpiarFiltros = () => {
    setDesde("")
    setHasta("")
  }

  // Cuenta de criterios cumplidos por registro (para resumen rapido).
  const cumplidos = (r: VehicleInspectionRecord) =>
    CRITERIOS.reduce((acc, c) => acc + (r[c.key] ? 1 : 0), 0)

  const totalFotos = useMemo(
    () => registros.reduce((acc, r) => acc + (r.fotos?.length || 0), 0),
    [registros],
  )

  /**
   * Exporta los registros visibles a un archivo .xlsx real (SheetJS) con
   * cada campo en su propia columna. Los criterios se exportan como
   * "Si"/"No" y se incluye el conteo de fotos.
   */
  const exportarExcel = async () => {
    const XLSX = await import("xlsx")
    const data = registros.map((r) => ({
      Fecha: formatFecha(r.fecha),
      "Hora Ingreso": r.hora_ingreso ?? "",
      Actividad: r.actividad ?? "",
      Transportador: r.transportador ?? "",
      Placa: r.placa_vehiculo ?? "",
      Responsable: r.responsable ?? "",
      ...Object.fromEntries(CRITERIOS.map((c) => [c.label, r[c.key] ? "Si" : "No"])),
      Observaciones: (r.observaciones ?? "").replace(/\r?\n/g, " "),
      "N° Fotos": r.fotos?.length || 0,
      "Tiene Firma": r.firma ? "Si" : "No",
    }))

    const worksheet = XLSX.utils.json_to_sheet(data)
    worksheet["!cols"] = [
      { wch: 12 }, // Fecha
      { wch: 12 }, // Hora
      { wch: 22 }, // Actividad
      { wch: 22 }, // Transportador
      { wch: 12 }, // Placa
      { wch: 22 }, // Responsable
      ...CRITERIOS.map(() => ({ wch: 14 })),
      { wch: 40 }, // Observaciones
      { wch: 9 }, // N Fotos
      { wch: 11 }, // Firma
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inspecciones")

    const rango = hayFiltro ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : ""
    XLSX.writeFile(workbook, `inspecciones_vehiculos${rango}.xlsx`)
  }

  return (
    <div className="space-y-4">
      {/* Filtros + exportar */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-primary">
            <History className="h-5 w-5" />
            Historial de Inspecciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="desde" className="text-xs font-medium text-muted-foreground">
                  Desde
                </Label>
                <DatePickerField
                  id="desde"
                  value={desde}
                  maxDate={hasta || undefined}
                  onChange={setDesde}
                  className="w-full sm:w-44"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hasta" className="text-xs font-medium text-muted-foreground">
                  Hasta
                </Label>
                <DatePickerField
                  id="hasta"
                  value={hasta}
                  minDate={desde || undefined}
                  onChange={setHasta}
                  className="w-full sm:w-44"
                />
              </div>
              {hayFiltro && (
                <Button variant="ghost" onClick={limpiarFiltros} className="gap-2 text-muted-foreground">
                  <FilterX className="h-4 w-4" />
                  Limpiar
                </Button>
              )}
            </div>
            <Button
              variant="outline"
              onClick={exportarExcel}
              disabled={registros.length === 0}
              className="gap-2 bg-transparent"
            >
              <Download className="h-4 w-4" />
              Exportar a Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6" />
            </div>
          ) : registros.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <History className="h-8 w-8" />
              <p className="text-sm">
                {hayFiltro
                  ? "No hay inspecciones en el rango seleccionado."
                  : "Aun no hay inspecciones registradas."}
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Placa</TableHead>
                      <TableHead>Transportador</TableHead>
                      <TableHead>Responsable</TableHead>
                      <TableHead className="text-center">Criterios</TableHead>
                      <TableHead className="text-center">Firma</TableHead>
                      <TableHead className="text-center">Fotos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registros.map((r) => {
                      const ok = cumplidos(r)
                      const todoOk = ok === CRITERIOS.length
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap font-medium">
                            {formatFecha(r.fecha)}
                            {r.hora_ingreso && (
                              <span className="block text-xs text-muted-foreground">{r.hora_ingreso}</span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{r.placa_vehiculo || "-"}</TableCell>
                          <TableCell className="text-sm">{r.transportador || "-"}</TableCell>
                          <TableCell className="text-sm">{r.responsable || "-"}</TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={
                                todoOk
                                  ? "border-green-600/40 text-green-700"
                                  : "border-amber-600/40 text-amber-700"
                              }
                            >
                              {todoOk ? (
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                              ) : (
                                <XCircle className="mr-1 h-3 w-3" />
                              )}
                              {ok}/{CRITERIOS.length}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {r.firma ? (
                              <a
                                href={r.firma}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center text-primary hover:underline"
                                aria-label="Ver firma"
                              >
                                <PenLine className="h-4 w-4" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {r.fotos && r.fotos.length > 0 ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 bg-transparent"
                                onClick={() =>
                                  setFotosActivas({ placa: r.placa_vehiculo || "Vehiculo", fotos: r.fotos! })
                                }
                              >
                                <ImageIcon className="h-3.5 w-3.5" />
                                {r.fotos.length}
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {registros.length} inspeccion{registros.length === 1 ? "" : "es"} · {totalFotos} foto
                {totalFotos === 1 ? "" : "s"} en total.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dialog galeria de fotos */}
      <Dialog open={fotosActivas !== null} onOpenChange={(open) => !open && setFotosActivas(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-primary" />
              Fotos · {fotosActivas?.placa}
            </DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-auto sm:grid-cols-3">
            {fotosActivas?.fotos.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block aspect-square overflow-hidden rounded-lg border border-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url || "/placeholder.svg"}
                  alt={`Evidencia ${i + 1}`}
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                  crossOrigin="anonymous"
                />
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
