"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileText, Loader2, ImageIcon } from "lucide-react"
import { getSanitaryRegistryHistory } from "@/lib/orders-actions"
import { useAuth } from "@/components/auth-provider"
import { Chip, Esqueleto, EstadoVacio, Eyebrow } from "@/components/ui/lipgo"

interface SanitaryRecord {
  id: number
  ordencargue: string | null
  placa: string
  conductor: string
  producto: string
  carpas: string
  limpieza: string
  olores: string
  plastico: string
  fumigacion: string
  plaguicida: string | null
  observaciones: string | null
  fumigador: string
  auxiliar: string
  aprobacion: string
  foto: string | null
  pdf: string | null
  fecha: string | null
  horaregistro: string | null
}

export function SanitaryInspectionHistory() {
  const { selectedEmpresaId } = useAuth()
  const [records, setRecords] = useState<SanitaryRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (selectedEmpresaId) {
      loadHistory()
    }
  }, [selectedEmpresaId])

  const loadHistory = async () => {
    setLoading(true)
    const result = await getSanitaryRegistryHistory(selectedEmpresaId)
    if (result.success) {
      setRecords(result.data)
    }
    setLoading(false)
  }

  const handleViewPhoto = (photoUrl: string | null) => {
    if (photoUrl) {
      window.open(photoUrl, "_blank")
    }
  }

  const handleViewPDF = (pdfUrl: string | null) => {
    if (pdfUrl) {
      window.open(pdfUrl, "_blank")
    }
  }

  // ---- Solo presentación (gerencia 2026-10-05): misma consulta, mismas columnas y mismas palabras;
  // cambia la tipografía, los chips Sí/No y la cabecera. ----
  const siNo = (v: string) => (v === "Si" ? <Chip tono="ok">Sí</Chip> : <Chip tono="critico">{v || "No"}</Chip>)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Recepción y Despacho · Portería y vehículos</Eyebrow>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Historial de inspección sanitaria</h1>
          <p className="lg-num text-sm text-muted-foreground">{loading ? "Cargando…" : `${records.length.toLocaleString("es-CO")} inspecciones registradas en este proyecto`}</p>
        </div>
      </div>

      <section className="lg-card overflow-hidden" aria-label="Inspecciones sanitarias">
        {loading ? (
          <div className="p-4"><Esqueleto lineas={6} /></div>
        ) : records.length === 0 ? (
          <div className="p-4"><EstadoVacio titulo="No hay registros de inspección todavía" /></div>
        ) : (
          <div className="max-h-[640px] overflow-x-auto overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Hora registro</TableHead>
                  <TableHead>Orden cargue</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Conductor</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Carpas</TableHead>
                  <TableHead>Limpieza</TableHead>
                  <TableHead>Olores</TableHead>
                  <TableHead>Plástico</TableHead>
                  <TableHead>Fumigación</TableHead>
                  <TableHead>Plaguicida</TableHead>
                  <TableHead>Observaciones</TableHead>
                  <TableHead>Fumigador</TableHead>
                  <TableHead>Auxiliar</TableHead>
                  <TableHead>Aprobación</TableHead>
                  <TableHead>Foto</TableHead>
                  <TableHead>PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="lg-num font-medium">{record.id}</TableCell>
                    <TableCell className="lg-num whitespace-nowrap">{record.fecha || "—"}</TableCell>
                    <TableCell className="lg-num whitespace-nowrap">{record.horaregistro || "—"}</TableCell>
                    <TableCell className="lg-num whitespace-nowrap">{record.ordencargue || "—"}</TableCell>
                    <TableCell className="lg-num">{record.placa}</TableCell>
                    <TableCell className="whitespace-nowrap">{record.conductor}</TableCell>
                    <TableCell className="whitespace-nowrap">{record.producto}</TableCell>
                    <TableCell>{siNo(record.carpas)}</TableCell>
                    <TableCell>{siNo(record.limpieza)}</TableCell>
                    <TableCell>{siNo(record.olores)}</TableCell>
                    <TableCell>{siNo(record.plastico)}</TableCell>
                    <TableCell>{siNo(record.fumigacion)}</TableCell>
                    <TableCell>{record.plaguicida || "—"}</TableCell>
                    <TableCell className="max-w-xs truncate" title={record.observaciones || undefined}>{record.observaciones || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{record.fumigador}</TableCell>
                    <TableCell className="whitespace-nowrap">{record.auxiliar}</TableCell>
                    <TableCell>{record.aprobacion === "aprobado" ? <Chip tono="ok">Aprobado</Chip> : <Chip tono="critico">{record.aprobacion || "—"}</Chip>}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleViewPhoto(record.foto)} disabled={!record.foto} title={record.foto ? "Ver foto" : "No hay foto disponible"} aria-label={record.foto ? "Ver foto" : "No hay foto disponible"}>
                        <ImageIcon className="h-4 w-4" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleViewPDF(record.pdf)} disabled={!record.pdf} title={record.pdf ? "Ver PDF" : "No hay PDF disponible"} aria-label={record.pdf ? "Ver PDF" : "No hay PDF disponible"}>
                        <FileText className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
