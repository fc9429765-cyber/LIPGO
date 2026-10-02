"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import {
  AlertTriangle,
  CheckCircle2,
  Search,
  ClipboardList,
  Building2,
  UserCheck,
  History,
  Eye,
  FileDown,
  Users,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import {
  getAllEvaluacionesDetalladas,
  getColaboradoresConUltimaEvaluacion,
  getEvaluacionById,
  type ColaboradorConEvaluacion,
  type EvaluacionConColaborador,
} from "@/lib/evaluaciones-desempeno-actions"
import { FormularioEvaluacion } from "@/components/rrhh/formulario-evaluacion"
import { EvaluacionDetalleDialog } from "@/components/rrhh/evaluacion-detalle-dialog"
import { generarPdfEvaluacion } from "@/lib/pdf-evaluacion"

/**
 * Dashboard de Evaluaciones de Desempeno.
 *
 * Organizado en dos pestanas:
 *  1. Colaboradores: listado del headcount de la empresa activa con estado de su ultima
 *     evaluacion y boton para evaluar.
 *  2. Historial: tabla global de todas las evaluaciones hechas, con fecha, evaluador,
 *     puntaje y acciones "Ver detalle" y "PDF".
 *
 * Regla de "Al dia" vs "Pendiente": ultima evaluacion dentro de los ultimos 30 dias.
 */
export default function EvaluacionesDashboard() {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const { toast } = useToast()

  // Pestana activa
  const [tab, setTab] = useState<"colaboradores" | "historial">("colaboradores")

  // Bloque Colaboradores
  const [colaboradores, setColaboradores] = useState<ColaboradorConEvaluacion[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [evaluandoId, setEvaluandoId] = useState<number | null>(null)

  // Bloque Historial
  const [evaluaciones, setEvaluaciones] = useState<EvaluacionConColaborador[]>([])
  const [loadingHistorial, setLoadingHistorial] = useState(true)
  const [historialSearch, setHistorialSearch] = useState("")

  // Dialogo de detalle + regeneracion PDF (ids UUID -> string)
  const [detalleEvaluacionId, setDetalleEvaluacionId] = useState<string | null>(null)
  const [detalleColaborador, setDetalleColaborador] = useState<{
    nombre: string
    cargo: string | null
    evaluador: string | null
  } | null>(null)
  const [regenerandoId, setRegenerandoId] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    const result = await getColaboradoresConUltimaEvaluacion(selectedEmpresaId)
    setColaboradores(result.success ? result.data : [])
    setLoading(false)
  }

  const loadHistorial = async () => {
    setLoadingHistorial(true)
    const result = await getAllEvaluacionesDetalladas(selectedEmpresaId)
    setEvaluaciones(result.success ? result.data : [])
    setLoadingHistorial(false)
  }

  useEffect(() => {
    loadData()
    loadHistorial()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  // Filtro del listado de colaboradores
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return colaboradores
    return colaboradores.filter(
      (c) =>
        c.nombre?.toLowerCase().includes(q) ||
        c.cargo?.toLowerCase().includes(q) ||
        c.identificacion?.toLowerCase().includes(q),
    )
  }, [colaboradores, searchTerm])

  // Filtro del historial
  const filteredHistorial = useMemo(() => {
    const q = historialSearch.trim().toLowerCase()
    if (!q) return evaluaciones
    return evaluaciones.filter(
      (e) =>
        e.colaborador_nombre?.toLowerCase().includes(q) ||
        e.colaborador_cargo?.toLowerCase().includes(q) ||
        e.colaborador_identificacion?.toLowerCase().includes(q) ||
        e.evaluador_nombre?.toLowerCase().includes(q),
    )
  }, [evaluaciones, historialSearch])

  const metricas = useMemo(() => {
    const total = colaboradores.length
    let alDia = 0
    let pendientes = 0
    for (const c of colaboradores) {
      if (getEstadoEvaluacion(c.ultima_evaluacion, c.fecha_inicio).isAlDia) alDia++
      else pendientes++
    }
    return { total, alDia, pendientes, evaluadas: evaluaciones.length }
  }, [colaboradores, evaluaciones])

  const handleVerDetalle = (ev: EvaluacionConColaborador) => {
    setDetalleColaborador({
      nombre: ev.colaborador_nombre,
      cargo: ev.colaborador_cargo,
      evaluador: ev.evaluador_nombre ?? null,
    })
    setDetalleEvaluacionId(ev.id)
  }

  const handleRegenerarPdf = async (ev: EvaluacionConColaborador) => {
    setRegenerandoId(ev.id)
    const res = await getEvaluacionById(ev.id)
    if (!res.success || !res.data) {
      toast({
        title: "No se pudo regenerar el PDF",
        description: res.error || "Error desconocido",
        variant: "destructive",
      })
      setRegenerandoId(null)
      return
    }
    try {
      const d = res.data
      await generarPdfEvaluacion({
        colaboradorNombre: ev.colaborador_nombre,
        colaboradorCargo: ev.colaborador_cargo,
        fecha: new Date(d.created_at),
        p1_seguridad_normas: d.p1_seguridad_normas,
        p2_seguridad_conducta: d.p2_seguridad_conducta,
        p3_productividad_metas: d.p3_productividad_metas,
        p4_productividad_ritmo: d.p4_productividad_ritmo,
        p5_calidad_mercancia: d.p5_calidad_mercancia,
        p6_calidad_precision: d.p6_calidad_precision,
        p7_disciplina_puntualidad: d.p7_disciplina_puntualidad,
        p8_disciplina_asistencia: d.p8_disciplina_asistencia,
        p9_disciplina_instrucciones: d.p9_disciplina_instrucciones,
        p10_actitud_equipo: d.p10_actitud_equipo,
        p11_actitud_disposicion: d.p11_actitud_disposicion,
        p12_actitud_proactividad: d.p12_actitud_proactividad,
        comentarios_adicionales: d.comentarios_adicionales,
        firma_coordinador: d.firma_coordinador,
        puntaje_total: Number(d.puntaje_total) || 0,
        porcentaje_riesgo: Number(d.porcentaje_riesgo) || 0,
      })
      toast({ title: "PDF generado", description: "El documento se descargo correctamente." })
    } catch (err: any) {
      toast({
        title: "Error al generar PDF",
        description: err?.message || "Error desconocido",
        variant: "destructive",
      })
    } finally {
      setRegenerandoId(null)
    }
  }

  const empresaActivaNombre = selectedEmpresaNombre || null

  // Si se esta evaluando a alguien, mostrar el formulario en lugar del dashboard
  if (evaluandoId !== null) {
    return (
      <FormularioEvaluacion
        colaboradorId={evaluandoId}
        onBack={() => {
          setEvaluandoId(null)
          loadData()
          loadHistorial()
        }}
      />
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">Evaluaciones de Desempeno</h2>
          <p className="text-xs md:text-sm text-muted-foreground">
            Seguimiento y evaluacion periodica del desempeno de colaboradores
          </p>
        </div>
        {selectedEmpresaId ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs md:text-sm">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Empresa activa:</span>
            <span className="font-semibold text-foreground">
              {empresaActivaNombre || `ID ${selectedEmpresaId}`}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs md:text-sm text-amber-900">
            <Building2 className="h-4 w-4" />
            <span>Selecciona una empresa en la barra superior</span>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription>Colaboradores</CardDescription>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metricas.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription>Al dia</CardDescription>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">{metricas.alDia}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription>Pendientes</CardDescription>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">{metricas.pendientes}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription>Evaluaciones</CardDescription>
            <History className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-indigo-700">{metricas.evaluadas}</div>
          </CardContent>
        </Card>
      </div>

      {/* Pestanas: Colaboradores / Historial */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "colaboradores" | "historial")}>
        <TabsList className="grid w-full grid-cols-2 md:w-auto md:inline-grid">
          <TabsTrigger value="colaboradores" className="gap-2">
            <Users className="h-4 w-4" />
            Colaboradores
          </TabsTrigger>
          <TabsTrigger value="historial" className="gap-2">
            <History className="h-4 w-4" />
            Historial
          </TabsTrigger>
        </TabsList>

        {/* Pestana Colaboradores */}
        <TabsContent value="colaboradores" className="mt-4">
          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <CardTitle className="text-base md:text-lg">Colaboradores</CardTitle>
                  <CardDescription>
                    Haz click en &quot;Evaluar&quot; para registrar una nueva evaluacion
                  </CardDescription>
                </div>
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nombre, cargo o cedula..."
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
                  <span className="ml-2 text-sm text-muted-foreground">
                    Cargando colaboradores...
                  </span>
                </div>
              ) : filtered.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ClipboardList className="h-6 w-6" />
                    </EmptyMedia>
                    <EmptyTitle>
                      {colaboradores.length === 0 ? "Sin colaboradores" : "Sin resultados"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {colaboradores.length === 0
                        ? "No hay colaboradores registrados para esta empresa en el headcount."
                        : "Intenta con otro termino de busqueda."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Colaborador</TableHead>
                        <TableHead>Cargo</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Ultima evaluacion</TableHead>
                        <TableHead>Proxima evaluacion</TableHead>
                        <TableHead>Estado evaluacion</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((c) => {
                        const estadoEval = getEstadoEvaluacion(c.ultima_evaluacion, c.fecha_inicio)
                        return (
                          <TableRow key={c.id}>
                            <TableCell>
                              <div className="font-medium">{c.nombre || "-"}</div>
                              {c.identificacion && (
                                <div className="text-xs text-muted-foreground">
                                  CC {c.identificacion}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{c.cargo || "-"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs font-normal">
                                {c.estado || "-"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {c.ultima_evaluacion ? formatFecha(c.ultima_evaluacion) : "Sin evaluar"}
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {estadoEval.proximaEvaluacion ? (
                                <span
                                  className={
                                    estadoEval.vencida ? "font-medium text-red-700" : "text-foreground"
                                  }
                                >
                                  {formatFechaDate(estadoEval.proximaEvaluacion)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Sin fecha de ingreso</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {estadoEval.isAlDia ? (
                                <Badge className="bg-green-100 text-green-800 hover:bg-green-100 gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Al dia
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {c.ultima_evaluacion ? "Vencida" : "Pendiente"}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" onClick={() => setEvaluandoId(c.id)}>
                                Evaluar
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pestana Historial */}
        <TabsContent value="historial" className="mt-4">
          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <CardTitle className="text-base md:text-lg flex items-center gap-2">
                    <History className="h-5 w-5 text-indigo-600" />
                    Historial de Evaluaciones
                  </CardTitle>
                  <CardDescription>
                    Todas las evaluaciones registradas para la empresa activa
                  </CardDescription>
                </div>
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por colaborador, cargo o evaluador..."
                    value={historialSearch}
                    onChange={(e) => setHistorialSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingHistorial ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner className="h-6 w-6 text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Cargando historial...
                  </span>
                </div>
              ) : filteredHistorial.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <History className="h-6 w-6" />
                    </EmptyMedia>
                    <EmptyTitle>
                      {evaluaciones.length === 0 ? "Aun no hay evaluaciones" : "Sin resultados"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {evaluaciones.length === 0
                        ? "Cuando registres la primera evaluacion aparecera aqui."
                        : "Intenta con otro termino de busqueda."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Colaborador</TableHead>
                        <TableHead>Cargo</TableHead>
                        <TableHead>Evaluador</TableHead>
                        <TableHead>Puntaje</TableHead>
                        <TableHead>% Riesgo</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredHistorial.map((ev) => {
                        const riesgo = Number(ev.porcentaje_riesgo ?? 0)
                        const riesgoClass =
                          riesgo >= 60
                            ? "bg-red-100 text-red-700"
                            : riesgo >= 30
                              ? "bg-amber-100 text-amber-800"
                              : "bg-green-100 text-green-800"
                        return (
                          <TableRow key={ev.id}>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatFechaHora(ev.created_at)}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{ev.colaborador_nombre}</div>
                              {ev.colaborador_identificacion && (
                                <div className="text-xs text-muted-foreground">
                                  CC {ev.colaborador_identificacion}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {ev.colaborador_cargo || "-"}
                            </TableCell>
                            <TableCell className="text-sm">
                              {ev.evaluador_nombre || "-"}
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              {Number(ev.puntaje_total ?? 0)} / 60
                            </TableCell>
                            <TableCell>
                              <Badge className={`${riesgoClass} hover:${riesgoClass}`}>
                                {riesgo}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleVerDetalle(ev)}
                                >
                                  <Eye className="h-3.5 w-3.5 mr-1" />
                                  Ver detalle
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleRegenerarPdf(ev)}
                                  disabled={regenerandoId === ev.id}
                                >
                                  {regenerandoId === ev.id ? (
                                    <Spinner className="h-3.5 w-3.5 mr-1" />
                                  ) : (
                                    <FileDown className="h-3.5 w-3.5 mr-1" />
                                  )}
                                  PDF
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogo de detalle */}
      <EvaluacionDetalleDialog
        open={detalleEvaluacionId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDetalleEvaluacionId(null)
            setDetalleColaborador(null)
          }
        }}
        evaluacionId={detalleEvaluacionId}
        colaboradorNombre={detalleColaborador?.nombre}
        colaboradorCargo={detalleColaborador?.cargo}
        evaluador={detalleColaborador?.evaluador}
      />
    </div>
  )
}

/**
 * Calcula el estado de evaluacion de un colaborador segun la politica:
 *   - Primera evaluacion: fecha de ingreso (fechainicio) + 1 mes.
 *   - Evaluaciones siguientes: ultima evaluacion + 1 anio.
 *
 * Devuelve la fecha de la PROXIMA evaluacion esperada y si el colaborador
 * esta "al dia" (la proxima evaluacion aun no ha vencido).
 *
 * Casos borde:
 *   - Sin ingreso ni evaluacion => no podemos calcular: vencido/pendiente.
 *   - Con ingreso pero sin evaluacion => proxima = ingreso + 1 mes.
 *   - Con evaluacion => proxima = ultima evaluacion + 1 anio.
 */
function getEstadoEvaluacion(
  ultimaEvaluacion: string | null,
  fechaInicio?: string | null,
): { isAlDia: boolean; proximaEvaluacion: Date | null; vencida: boolean } {
  const hoy = new Date()

  let proxima: Date | null = null
  if (ultimaEvaluacion) {
    // Ya tiene al menos una evaluacion: la proxima es un anio despues.
    proxima = new Date(ultimaEvaluacion)
    proxima.setFullYear(proxima.getFullYear() + 1)
  } else if (fechaInicio) {
    // Aun no se evalua: la primera es un mes despues del ingreso.
    proxima = new Date(fechaInicio)
    proxima.setMonth(proxima.getMonth() + 1)
  }

  // Sin datos suficientes para calcular => se considera pendiente/vencida.
  if (!proxima || isNaN(proxima.getTime())) {
    return { isAlDia: false, proximaEvaluacion: null, vencida: true }
  }

  const vencida = proxima.getTime() < hoy.getTime()
  return { isAlDia: !vencida, proximaEvaluacion: proxima, vencida }
}

function formatFecha(iso: string): string {
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

/** Formatea un objeto Date (p.ej. la proxima evaluacion calculada). */
function formatFechaDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d)
  } catch {
    return ""
  }
}

function formatFechaHora(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
