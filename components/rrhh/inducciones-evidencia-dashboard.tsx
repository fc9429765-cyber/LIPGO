"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle, CheckCircle2, Search, BookOpen, ClipboardList, FileText, Loader2, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  getEvidenciaInducciones,
  guardarEvidenciaInduccion,
  eliminarIntentoEvaluacion,
  type IntentoInduccion,
} from "@/lib/inducciones-actions"
import { generarPdfInduccion } from "@/lib/pdf-induccion"
import { useAuth } from "@/components/auth-provider"

/**
 * Dashboard de Evidencia de Inducciones.
 *
 * Lista todos los intentos de evaluacion de inducciones (tabla
 * capacitaciones_evaluacion_intentos) con el nombre/cedula del trabajador
 * y el titulo/codigo SIG de la induccion. Incluye buscador por
 * nombre/cedula/induccion y contadores de total y aprobadas.
 */
export default function InduccionesEvidenciaDashboard() {
  const { selectedEmpresaId } = useAuth()
  const [intentos, setIntentos] = useState<IntentoInduccion[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [generandoId, setGenerandoId] = useState<string | null>(null)
  // Intento marcado para eliminar (abre el dialogo de confirmacion) y estado de borrado.
  const [intentoAEliminar, setIntentoAEliminar] = useState<IntentoInduccion | null>(null)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  const { toast } = useToast()

  // Elimina el intento: borra el resultado del trabajador y reabre la induccion.
  const confirmarEliminar = async () => {
    const i = intentoAEliminar
    if (!i) return
    setEliminandoId(i.id)
    const result = await eliminarIntentoEvaluacion(i.id)
    if (result.success) {
      setIntentos((prev) => prev.filter((x) => x.id !== i.id))
      toast({
        title: "Evaluación eliminada",
        description: "Se eliminó el resultado y la inducción quedó abierta nuevamente para diligenciar.",
      })
    } else {
      toast({ title: "Error al eliminar", description: result.error || "Error desconocido", variant: "destructive" })
    }
    setEliminandoId(null)
    setIntentoAEliminar(null)
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const result = await getEvidenciaInducciones(selectedEmpresaId ?? undefined)
      if (!cancelled) {
        setIntentos(result.success ? result.data : [])
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedEmpresaId])

  // Genera el PDF de evidencia, lo sube al storage, persiste su URL en la
  // evaluacion y lo abre en una nueva pestana.
  const generarDocumento = async (i: IntentoInduccion) => {
    setGenerandoId(i.id)
    console.log("[v0] generarDocumento: inicio", {
      id: i.id,
      evaluacion_id: i.evaluacion_id,
      firma_url: i.firma_url,
    })
    try {
      let blob: Blob
      try {
        blob = await generarPdfInduccion({
          tema: i.induccion_titulo,
          codigoSig: i.induccion_codigo_sig,
          trabajadorNombre: i.trabajador_nombre,
          trabajadorDocumento: i.trabajador_identificacion,
          puntaje: i.puntaje,
          total: i.total,
          aprobado: i.aprobado,
          fecha: i.fecha ? new Date(i.fecha) : new Date(),
          firmaUrl: i.firma_url,
        })
      } catch (pdfErr: any) {
        console.error("[v0] generarDocumento: error generando PDF", pdfErr)
        throw new Error("No se pudo generar el PDF: " + (pdfErr?.message || "error desconocido"))
      }
      console.log("[v0] generarDocumento: PDF generado", { size: blob.size })

      const fd = new FormData()
      fd.append("file", new File([blob], "evidencia_induccion.pdf", { type: "application/pdf" }))
      fd.append("folder", "inducciones")
      const resp = await fetch("/api/upload-pdf", { method: "POST", body: fd })
      // La respuesta puede no ser JSON (ej. error 413 "Request Entity Too Large"
      // del servidor devuelve texto plano). Leemos como texto y parseamos con
      // cuidado para que el error real se muestre en vez de romper en .json().
      const raw = await resp.text()
      let json: any = {}
      try {
        json = raw ? JSON.parse(raw) : {}
      } catch {
        json = { error: raw }
      }
      console.log("[v0] generarDocumento: respuesta upload", { ok: resp.ok, status: resp.status, json })
      if (!resp.ok || !json.url) {
        const detalle =
          resp.status === 413
            ? "El documento es demasiado grande para subirlo."
            : json.error || raw || `Error ${resp.status} al subir el documento`
        throw new Error(detalle)
      }

      // Si hay evaluacion_id, persistimos la URL en la evaluacion para que quede
      // disponible para revision. Si NO lo hay, el documento igual se genera y
      // se abre: no bloqueamos la generacion por no poder vincularlo.
      if (i.evaluacion_id) {
        const guardado = await guardarEvidenciaInduccion(i.evaluacion_id, json.url)
        console.log("[v0] generarDocumento: resultado guardado", guardado)
        if (guardado.success) {
          setIntentos((prev) =>
            prev.map((x) =>
              x.evaluacion_id === i.evaluacion_id ? { ...x, evidencia_url: json.url } : x,
            ),
          )
          toast({ title: "Documento generado", description: "La evidencia se guardó correctamente." })
        } else {
          // El PDF se generó y subió, pero no se pudo vincular a la evaluación.
          toast({
            title: "Documento generado",
            description:
              "Se generó el documento, pero no se pudo guardar para revisión: " + (guardado.error || ""),
            variant: "destructive",
          })
        }
      } else {
        toast({
          title: "Documento generado",
          description: "El documento se generó. No tiene evaluación asociada para guardarlo en revisión.",
        })
      }

      // Abrimos el documento. window.open puede ser bloqueado por el navegador
      // tras una operación asíncrona; en ese caso avisamos para usar el botón Ver.
      const win = window.open(json.url, "_blank", "noopener,noreferrer")
      if (!win) {
        toast({
          title: "Apertura bloqueada",
          description: "El navegador bloqueó la apertura automática. Usa el botón Ver para abrirla.",
        })
      }
    } catch (err: any) {
      console.error("[v0] generarDocumento: error", err)
      toast({ title: "Error al generar", description: err?.message || "Error desconocido", variant: "destructive" })
    } finally {
      setGenerandoId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return intentos
    return intentos.filter(
      (i) =>
        i.trabajador_nombre?.toLowerCase().includes(q) ||
        i.trabajador_identificacion?.toLowerCase().includes(q) ||
        i.induccion_titulo?.toLowerCase().includes(q) ||
        i.induccion_codigo_sig?.toLowerCase().includes(q),
    )
  }, [intentos, searchTerm])

  const metricas = useMemo(() => {
    const total = intentos.length
    const aprobadas = intentos.filter((i) => i.aprobado).length
    return { total, aprobadas }
  }, [intentos])

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">Evidencia de Inducciones</h2>
          <p className="text-xs md:text-sm text-muted-foreground">
            Registro de intentos de evaluacion de inducciones por trabajador
          </p>
        </div>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 md:max-w-md">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription>Total intentos</CardDescription>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metricas.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription>Aprobadas</CardDescription>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">{metricas.aprobadas}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabla de evidencias */}
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle className="text-base md:text-lg flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Intentos de Inducciones
              </CardTitle>
              <CardDescription>Todos los intentos registrados, mas recientes primero</CardDescription>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, cedula o induccion..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner className="h-6 w-6 text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Cargando evidencias...</span>
            </div>
          ) : filtered.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookOpen className="h-6 w-6" />
                </EmptyMedia>
                <EmptyTitle>
                  {intentos.length === 0 ? "Sin evidencias" : "Sin resultados"}
                </EmptyTitle>
                <EmptyDescription>
                  {intentos.length === 0
                    ? "Aun no hay intentos de evaluacion de inducciones registrados."
                    : "Intenta con otro termino de busqueda."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trabajador</TableHead>
                    <TableHead>Cedula</TableHead>
                    <TableHead>Induccion</TableHead>
                    <TableHead>Puntaje</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Documento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.trabajador_nombre}</TableCell>
                      <TableCell className="text-sm">{i.trabajador_identificacion || "-"}</TableCell>
                      <TableCell className="text-sm">
                        <div>{i.induccion_titulo}</div>
                        {i.induccion_codigo_sig && (
                          <div className="text-xs text-muted-foreground">{i.induccion_codigo_sig}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {i.puntaje} / {i.total}
                      </TableCell>
                      <TableCell>
                        {i.aprobado ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100 gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Aprobado
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            No aprobado
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatFecha(i.fecha)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {i.evidencia_url && (
                            <a
                              href={i.evidencia_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                            >
                              <FileText className="h-3 w-3" />
                              Ver
                            </a>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={generandoId === i.id}
                            onClick={() => generarDocumento(i)}
                          >
                            {generandoId === i.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" />
                            )}
                            Generar documento
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-destructive hover:text-destructive"
                            disabled={eliminandoId === i.id}
                            onClick={() => setIntentoAEliminar(i)}
                            title="Eliminar evaluación y reabrir para diligenciar"
                          >
                            {eliminandoId === i.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmacion de eliminacion de evaluacion */}
      <AlertDialog open={!!intentoAEliminar} onOpenChange={(open) => !open && setIntentoAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta evaluación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el resultado de{" "}
              <span className="font-semibold">{intentoAEliminar?.trabajador_nombre}</span> en la inducción{" "}
              <span className="font-semibold">{intentoAEliminar?.induccion_titulo}</span>. La inducción quedará
              abierta nuevamente para que el trabajador la diligencie. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarEliminar}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function formatFecha(fecha: string | null): string {
  if (!fecha) return "-"
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric" })
}
