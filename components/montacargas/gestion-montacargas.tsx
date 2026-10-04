"use client"

// PRODUCCIÓN › Gestión de Montacargas.
//
// Maestro de equipos, etiquetas QR, hoja de vida y bitácora de mantenimiento.
// Los datos y las reglas viven en lib/montacargas-actions.ts.
//
// El módulo respeta el selector global de proyecto: cada montacarga pertenece
// a un ID. La hoja de vida cruza además las inspecciones preoperacionales del
// equipo, que se identifican con texto libre (ver lib/montacargas-alias.ts).

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Forklift,
  Loader2,
  Pencil,
  Plus,
  QrCode,
  Wrench,
} from "lucide-react"
import {
  listMontacargas,
  listPendientes,
  getHojaDeVida,
  crearMontacarga,
  actualizarMontacarga,
  type Montacarga,
  type HojaDeVida,
} from "@/lib/montacargas-actions"
import { RegistroActividad, ETIQUETA_TIPO } from "@/components/montacargas/registro-actividad"
import { SelectorEquipoQR } from "@/components/montacargas/selector-equipo-qr"
import { QrEtiquetas } from "@/components/montacargas/qr-etiquetas"

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO")

const TONO_PREVENTIVO: Record<string, string> = {
  vencido: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  proximo: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  al_dia: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  sin_programar: "bg-muted text-muted-foreground",
}
const ETIQUETA_PREVENTIVO: Record<string, string> = {
  vencido: "Vencido",
  proximo: "Próximo",
  al_dia: "Al día",
  sin_programar: "Sin programar",
}

const FORM_VACIO = {
  identificacion: "", alias: "", marca: "", modelo: "", serie: "", anio: "", sede: "",
  capacidad_kg: "", tipo_energia: "", altura_elevacion_mm: "", tipo_llanta: "", fecha_ingreso: "",
  estado: "operativo", horometro_actual: "", frecuencia_preventivo_horas: "", frecuencia_preventivo_dias: "",
  observaciones: "",
}

export function GestionMontacargas() {
  const { selectedEmpresaId } = useAuth() as any
  const { toast } = useToast()
  const [equipos, setEquipos] = useState<Montacarga[]>([])
  const [pendientes, setPendientes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState("equipos")

  const [dialogEquipo, setDialogEquipo] = useState(false)
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...FORM_VACIO })
  const [guardando, setGuardando] = useState(false)

  const [seleccionado, setSeleccionado] = useState<number | null>(null)
  const [hoja, setHoja] = useState<HojaDeVida | null>(null)
  const [cargandoHoja, setCargandoHoja] = useState(false)

  const [registrarEn, setRegistrarEn] = useState<number | null>(null)
  const [cerrarActividadId, setCerrarActividadId] = useState<{ id: number; equipoId: number } | null>(null)

  /**
   * Equipo ya identificado por QR dentro del dialogo abierto.
   *
   * Desde el escritorio ya no basta con elegir el montacarga de la lista: hay
   * que leer su QR (o digitar el codigo de la etiqueta) para confirmar que
   * quien registra esta frente a la maquina. Mientras esto sea null, el dialogo
   * muestra la compuerta en vez del formulario.
   */
  const [equipoConfirmado, setEquipoConfirmado] = useState<Montacarga | null>(null)

  /**
   * Datos del equipo contra el que se debe validar el QR leido.
   *
   * Si el equipo no esta en la lista cargada — pasa con un pendiente de un
   * equipo inactivo o de otro proyecto — igual se valida por id, solo que sin
   * nombre bonito. Lo que NO puede pasar es que se deje de validar: devolver
   * undefined haria que el selector aceptara cualquier QR.
   */
  const equipoDe = useCallback(
    (id: number | null | undefined) => {
      if (id == null) return undefined
      const e = equipos.find((x) => x.id === id)
      return { id, identificacion: e?.identificacion ?? `equipo #${id}` }
    },
    [equipos],
  )

  /** Cierra cualquiera de los dos dialogos y descarta la identificacion previa. */
  const cerrarDialogos = useCallback(() => {
    setRegistrarEn(null)
    setCerrarActividadId(null)
    setEquipoConfirmado(null)
  }, [])

  const cargar = useCallback(async () => {
    if (!selectedEmpresaId) {
      setEquipos([])
      setPendientes([])
      setLoading(false)
      return
    }
    setLoading(true)
    const [a, b] = await Promise.all([listMontacargas(selectedEmpresaId), listPendientes(selectedEmpresaId)])
    if (a.success) setEquipos(a.data || [])
    else toast({ title: "Error", description: a.error, variant: "destructive" })
    if (b.success) setPendientes(b.data || [])
    setLoading(false)
  }, [selectedEmpresaId, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const cargarHoja = useCallback(
    async (equipoId: number) => {
      if (!selectedEmpresaId) return
      setCargandoHoja(true)
      const r = await getHojaDeVida(selectedEmpresaId, equipoId)
      setHoja(r.success ? r.data! : null)
      if (!r.success) toast({ title: "Error", description: r.error, variant: "destructive" })
      setCargandoHoja(false)
    },
    [selectedEmpresaId, toast],
  )

  useEffect(() => {
    if (seleccionado) cargarHoja(seleccionado)
    else setHoja(null)
  }, [seleccionado, cargarHoja])

  const abrirNuevo = () => {
    setEditandoId(null)
    setForm({ ...FORM_VACIO })
    setDialogEquipo(true)
  }
  const abrirEditar = (e: Montacarga) => {
    setEditandoId(e.id)
    setForm({
      identificacion: e.identificacion ?? "", alias: e.alias ?? "", marca: e.marca ?? "", modelo: e.modelo ?? "",
      serie: e.serie ?? "", anio: e.anio?.toString() ?? "", sede: e.sede ?? "",
      capacidad_kg: e.capacidad_kg?.toString() ?? "", tipo_energia: e.tipo_energia ?? "",
      altura_elevacion_mm: e.altura_elevacion_mm?.toString() ?? "", tipo_llanta: e.tipo_llanta ?? "",
      fecha_ingreso: e.fecha_ingreso ?? "", estado: e.estado ?? "operativo",
      horometro_actual: e.horometro_actual?.toString() ?? "",
      frecuencia_preventivo_horas: e.frecuencia_preventivo_horas?.toString() ?? "",
      frecuencia_preventivo_dias: e.frecuencia_preventivo_dias?.toString() ?? "",
      observaciones: e.observaciones ?? "",
    })
    setDialogEquipo(true)
  }

  const guardarEquipo = async () => {
    if (!selectedEmpresaId) return
    setGuardando(true)
    const r = editandoId
      ? await actualizarMontacarga(selectedEmpresaId, editandoId, form)
      : await crearMontacarga(selectedEmpresaId, form)
    setGuardando(false)
    if (r.success) {
      toast({ title: editandoId ? "Montacarga actualizado" : "Montacarga creado" })
      setDialogEquipo(false)
      cargar()
      if (editandoId && seleccionado === editandoId) cargarHoja(editandoId)
    } else {
      toast({ title: "No se pudo guardar", description: r.error, variant: "destructive" })
    }
  }

  const vencidos = useMemo(() => equipos.filter((e) => e.preventivo.estado === "vencido"), [equipos])
  const proximos = useMemo(() => equipos.filter((e) => e.preventivo.estado === "proximo"), [equipos])
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  if (!selectedEmpresaId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Selecciona un proyecto para ver sus montacargas.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Forklift className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Gestión de Montacargas</h1>
            <p className="text-sm text-muted-foreground">
              Equipos, códigos QR, hoja de vida y bitácora de mantenimiento.
            </p>
          </div>
        </div>
        <Button onClick={abrirNuevo}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo montacarga
        </Button>
      </div>

      {/* Lo que urge, arriba y sin tener que entrar a ninguna pestaña. */}
      {(vencidos.length > 0 || pendientes.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {pendientes.length > 0 && (
            <Card className="border-red-300 bg-red-50/50 dark:bg-red-950/15">
              <CardContent className="flex items-center gap-3 p-4">
                <Wrench className="h-5 w-5 text-red-600" />
                <div>
                  <div className="text-lg font-bold text-red-700 dark:text-red-400">{pendientes.length}</div>
                  <div className="text-xs text-muted-foreground">
                    falla(s) sin resolver · la más vieja del {String(pendientes[0]?.created_at ?? "").slice(0, 10)}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {vencidos.length > 0 && (
            <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/15">
              <CardContent className="flex items-center gap-3 p-4">
                <CalendarClock className="h-5 w-5 text-amber-600" />
                <div>
                  <div className="text-lg font-bold text-amber-700 dark:text-amber-400">{vencidos.length}</div>
                  <div className="text-xs text-muted-foreground">
                    equipo(s) con el preventivo vencido: {vencidos.map((e) => e.identificacion).join(", ")}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="equipos">Equipos ({equipos.length})</TabsTrigger>
          <TabsTrigger value="hoja">Hoja de vida</TabsTrigger>
          <TabsTrigger value="pendientes">Pendientes ({pendientes.length})</TabsTrigger>
          <TabsTrigger value="preventivos">Preventivos</TabsTrigger>
          <TabsTrigger value="qr">Etiquetas QR</TabsTrigger>
        </TabsList>

        {/* ------------------------------ EQUIPOS ------------------------------ */}
        <TabsContent value="equipos" className="mt-4">
          <Card>
            <CardContent className="overflow-x-auto p-0">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Cargando…
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Identificación</TableHead>
                      <TableHead>Marca / modelo</TableHead>
                      <TableHead>Energía</TableHead>
                      <TableHead className="text-right">Horómetro</TableHead>
                      <TableHead>Preventivo</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {equipos.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <div className="font-medium">{e.identificacion}</div>
                          {e.alias && <div className="text-xs text-muted-foreground">{e.alias}</div>}
                        </TableCell>
                        <TableCell className="text-xs">{[e.marca, e.modelo].filter(Boolean).join(" ") || "—"}</TableCell>
                        <TableCell className="text-xs">{e.tipo_energia || "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {e.horometro_actual != null ? `${e.horometro_actual} h` : "—"}
                        </TableCell>
                        <TableCell>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${TONO_PREVENTIVO[e.preventivo.estado]}`}>
                            {ETIQUETA_PREVENTIVO[e.preventivo.estado]}
                          </span>
                          <div className="text-[10px] text-muted-foreground">{e.preventivo.detalle}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {e.estado}
                          {e.abiertos > 0 && (
                            <Badge variant="outline" className="ml-1 border-red-300 text-[10px] text-red-600">
                              {e.abiertos} pendiente(s)
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { setSeleccionado(e.id); setTab("hoja") }}>
                              <ClipboardList className="mr-1 h-3 w-3" /> Hoja
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setRegistrarEn(e.id)}>
                              <Wrench className="mr-1 h-3 w-3" /> Registrar
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => abrirEditar(e)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {equipos.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                          Aún no hay montacargas en este proyecto. Créalos con el botón de arriba.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------- HOJA DE VIDA ----------------------------- */}
        <TabsContent value="hoja" className="mt-4">
          <div className="grid gap-4 md:grid-cols-[280px_1fr]">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Equipos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 p-2">
                {equipos.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setSeleccionado(e.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted ${seleccionado === e.id ? "bg-muted font-medium" : ""}`}
                  >
                    <Forklift className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {e.identificacion}
                      {e.alias && <span className="text-xs text-muted-foreground"> · {e.alias}</span>}
                    </span>
                    {e.abiertos > 0 && <span className="text-[10px] font-semibold text-red-600">{e.abiertos}</span>}
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                {equipos.length === 0 && <p className="p-3 text-xs text-muted-foreground">Sin equipos.</p>}
              </CardContent>
            </Card>

            <div className="space-y-4">
              {!seleccionado ? (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-muted-foreground">
                    Elige un montacarga a la izquierda para ver su hoja de vida.
                  </CardContent>
                </Card>
              ) : cargandoHoja ? (
                <Card>
                  <CardContent className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" /> Armando la hoja de vida…
                  </CardContent>
                </Card>
              ) : hoja ? (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        {hoja.equipo.identificacion}
                        {hoja.equipo.alias && <span className="ml-2 text-sm font-normal text-muted-foreground">{hoja.equipo.alias}</span>}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                      <Dato l="Marca / modelo" v={[hoja.equipo.marca, hoja.equipo.modelo].filter(Boolean).join(" ") || "—"} />
                      <Dato l="Serie" v={hoja.equipo.serie || "—"} />
                      <Dato l="Año" v={hoja.equipo.anio?.toString() || "—"} />
                      <Dato l="Capacidad" v={hoja.equipo.capacidad_kg ? `${hoja.equipo.capacidad_kg} kg` : "—"} />
                      <Dato l="Energía" v={hoja.equipo.tipo_energia || "—"} />
                      <Dato l="Llanta" v={hoja.equipo.tipo_llanta || "—"} />
                      <Dato l="Horómetro" v={hoja.equipo.horometro_actual != null ? `${hoja.equipo.horometro_actual} h` : "—"} />
                      <Dato l="Preventivo" v={`${ETIQUETA_PREVENTIVO[hoja.equipo.preventivo.estado]} · ${hoja.equipo.preventivo.detalle}`} />
                      <Dato l="Costo acumulado" v={`${money(hoja.costos.total)} (último año ${money(hoja.costos.ultimoAnio)})`} />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm">Bitácora ({hoja.actividades.length})</CardTitle>
                      <Button size="sm" variant="outline" onClick={() => setRegistrarEn(hoja.equipo.id)}>
                        <Wrench className="mr-1.5 h-3.5 w-3.5" /> Registrar actividad
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {hoja.actividades.map((a) => (
                        <div key={a.id} className={`rounded-lg border p-3 ${a.estado_gestion === "abierto" ? "border-red-300 bg-red-50/40 dark:bg-red-950/10" : ""}`}>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold">{ETIQUETA_TIPO[a.tipo] || a.tipo}</span>
                            <span className="text-muted-foreground">{String(a.fecha_ejecucion ?? a.created_at).slice(0, 10)}</span>
                            {a.estado_gestion === "abierto" ? (
                              <Badge variant="outline" className="border-red-300 text-[10px] text-red-600">PENDIENTE</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">cerrado</Badge>
                            )}
                            {a.horometro != null && <span className="text-muted-foreground">{a.horometro} h</span>}
                            {a.costo != null && a.costo > 0 && <span className="font-medium">{money(a.costo)}</span>}
                          </div>
                          <p className="mt-1 text-sm">{a.descripcion}</p>
                          {a.solucion && (
                            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
                              <strong>Solución:</strong> {a.solucion}
                              {a.repuestos && <span className="text-muted-foreground"> · repuestos: {a.repuestos}</span>}
                            </p>
                          )}
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Reportó {a.reportado_por || "—"}
                            {a.cerrado_por && ` · cerró ${a.cerrado_por}`}
                          </div>
                          {a.fotos.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {a.fotos.map((f) => (
                                <a key={f.url} href={f.url} target="_blank" rel="noreferrer" title={f.momento}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={f.url} alt={f.momento} className="h-16 w-16 rounded border object-cover" />
                                </a>
                              ))}
                            </div>
                          )}
                          {a.estado_gestion === "abierto" && (
                            <Button size="sm" className="mt-2 h-8" onClick={() => setCerrarActividadId({ id: a.id, equipoId: hoja.equipo.id })}>
                              Cerrar pendiente
                            </Button>
                          )}
                        </div>
                      ))}
                      {hoja.actividades.length === 0 && (
                        <p className="py-6 text-center text-sm text-muted-foreground">Sin actividades registradas.</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Preoperacionales ({hoja.preoperacionales.length})</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Inspecciones diarias atribuidas a este equipo. Un hallazgo es un ítem marcado como no conforme.
                      </p>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="max-h-64 overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Fecha</TableHead>
                              <TableHead>Turno</TableHead>
                              <TableHead>Operador</TableHead>
                              <TableHead className="text-right">Hallazgos</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {hoja.preoperacionales.slice(0, 60).map((p) => (
                              <TableRow key={p.id}>
                                <TableCell className="text-xs tabular-nums">{p.fecha}</TableCell>
                                <TableCell className="text-xs">{p.turno ?? "—"}</TableCell>
                                <TableCell className="text-xs">{p.operador ?? "—"}</TableCell>
                                <TableCell className={`text-right text-xs font-semibold ${p.hallazgos > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                                  {p.hallazgos}
                                </TableCell>
                              </TableRow>
                            ))}
                            {hoja.preoperacionales.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={4} className="h-16 text-center text-xs text-muted-foreground">
                                  Sin inspecciones atribuidas a este equipo.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      {/* Se reporta lo que no se pudo atribuir en vez de adivinar:
                          atribuir mal ensuciaría la hoja de vida sin que se note. */}
                      {hoja.preoperacionalesSinCasar.length > 0 && (
                        <div className="border-t bg-amber-50/60 p-3 text-xs dark:bg-amber-950/15">
                          <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {hoja.preoperacionalesSinCasar.length} identificación(es) del preoperacional sin equipo
                          </div>
                          <p className="mb-1 text-muted-foreground">
                            Esas inspecciones no se atribuyeron a ningún montacarga porque su placa no coincide con
                            ninguna del maestro. Corrige la placa en el equipo o declara la equivalencia en
                            lib/montacargas-alias.ts.
                          </p>
                          <ul className="ml-4 list-disc">
                            {hoja.preoperacionalesSinCasar.slice(0, 8).map((x) => (
                              <li key={x.texto}>
                                <code>{x.texto}</code> — {x.inspecciones} inspección(es)
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </div>
          </div>
        </TabsContent>

        {/* ----------------------------- PENDIENTES ----------------------------- */}
        <TabsContent value="pendientes" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Fallas sin resolver</CardTitle>
              <p className="text-xs text-muted-foreground">De la más vieja a la más reciente: arriba está lo que más urge.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendientes.map((a) => (
                <div key={a.id} className="rounded-lg border border-red-300 bg-red-50/40 p-3 dark:bg-red-950/10">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">{a.equipo}</span>
                    <Badge variant="outline" className="text-[10px]">{ETIQUETA_TIPO[a.tipo] || a.tipo}</Badge>
                    <span className="text-muted-foreground">desde {String(a.created_at).slice(0, 10)}</span>
                  </div>
                  <p className="mt-1 text-sm">{a.descripcion}</p>
                  <div className="mt-1 text-[11px] text-muted-foreground">Reportó {a.reportado_por || "—"}</div>
                  <Button size="sm" className="mt-2 h-8" onClick={() => setCerrarActividadId({ id: a.id, equipoId: a.equipo_id })}>
                    Cerrar pendiente
                  </Button>
                </div>
              ))}
              {pendientes.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay fallas pendientes. Todo el parque está al día.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------- PREVENTIVOS ----------------------------- */}
        <TabsContent value="preventivos" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Programación de preventivos</CardTitle>
              <p className="text-xs text-muted-foreground">
                Vence lo que ocurra primero: las horas de uso o los días. Un equipo sin frecuencia definida no se
                controla — configúrasela desde el botón de editar.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipo</TableHead>
                    <TableHead>Frecuencia</TableHead>
                    <TableHead className="text-right">Horómetro</TableHead>
                    <TableHead>Último preventivo</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...vencidos, ...proximos, ...equipos.filter((e) => !["vencido", "proximo"].includes(e.preventivo.estado))].map((e) => (
                    <TableRow key={e.id} className={e.preventivo.estado === "vencido" ? "bg-red-50/60 dark:bg-red-950/15" : ""}>
                      <TableCell className="font-medium">{e.identificacion}</TableCell>
                      <TableCell className="text-xs">
                        {[
                          e.frecuencia_preventivo_horas ? `cada ${e.frecuencia_preventivo_horas} h` : null,
                          e.frecuencia_preventivo_dias ? `cada ${e.frecuencia_preventivo_dias} días` : null,
                        ].filter(Boolean).join(" · ") || "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {e.horometro_actual != null ? `${e.horometro_actual} h` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{e.fecha_ultimo_preventivo || "nunca"}</TableCell>
                      <TableCell>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${TONO_PREVENTIVO[e.preventivo.estado]}`}>
                          {ETIQUETA_PREVENTIVO[e.preventivo.estado]}
                        </span>
                        <div className="text-[10px] text-muted-foreground">{e.preventivo.detalle}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------- QR ------------------------------- */}
        <TabsContent value="qr" className="mt-4">
          <QrEtiquetas equipos={equipos} proyecto={`Proyecto ${selectedEmpresaId}`} />
        </TabsContent>
      </Tabs>

      {/* ------------------------------ DIÁLOGOS ------------------------------ */}
      <Dialog open={dialogEquipo} onOpenChange={setDialogEquipo}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editandoId ? "Editar montacarga" : "Nuevo montacarga"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo l="Identificación (placa o serie interna) *" v={form.identificacion} on={(v) => set("identificacion", v)} />
            <Campo l="Alias" v={form.alias} on={(v) => set("alias", v)} ph="Ej.: Yale #1" />
            <Campo l="Marca" v={form.marca} on={(v) => set("marca", v)} />
            <Campo l="Modelo" v={form.modelo} on={(v) => set("modelo", v)} />
            <Campo l="Serie" v={form.serie} on={(v) => set("serie", v)} />
            <Campo l="Año" v={form.anio} on={(v) => set("anio", v)} tipo="number" />
            <Campo l="Sede" v={form.sede} on={(v) => set("sede", v)} />
            <Campo l="Capacidad (kg)" v={form.capacidad_kg} on={(v) => set("capacidad_kg", v)} tipo="number" />
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de energía</Label>
              <Select value={form.tipo_energia || undefined} onValueChange={(v) => set("tipo_energia", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gas">Gas</SelectItem>
                  <SelectItem value="electrico">Eléctrico</SelectItem>
                  <SelectItem value="diesel">Diésel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Campo l="Altura de elevación (mm)" v={form.altura_elevacion_mm} on={(v) => set("altura_elevacion_mm", v)} tipo="number" />
            <Campo l="Tipo de llanta" v={form.tipo_llanta} on={(v) => set("tipo_llanta", v)} />
            <Campo l="Fecha de ingreso" v={form.fecha_ingreso} on={(v) => set("fecha_ingreso", v)} tipo="date" />
            <div className="space-y-1.5">
              <Label className="text-xs">Estado</Label>
              <Select value={form.estado} onValueChange={(v) => set("estado", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operativo">Operativo</SelectItem>
                  <SelectItem value="fuera_servicio">Fuera de servicio</SelectItem>
                  <SelectItem value="baja">De baja</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Campo l="Horómetro actual" v={form.horometro_actual} on={(v) => set("horometro_actual", v)} tipo="number" />
            <Campo l="Preventivo cada (horas)" v={form.frecuencia_preventivo_horas} on={(v) => set("frecuencia_preventivo_horas", v)} tipo="number" />
            <Campo l="Preventivo cada (días)" v={form.frecuencia_preventivo_dias} on={(v) => set("frecuencia_preventivo_dias", v)} tipo="number" />
            <div className="sm:col-span-2">
              <Campo l="Observaciones" v={form.observaciones} on={(v) => set("observaciones", v)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogEquipo(false)}>Cancelar</Button>
            <Button onClick={guardarEquipo} disabled={guardando || !form.identificacion.trim()}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={registrarEn != null} onOpenChange={(o) => !o && cerrarDialogos()}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar actividad</DialogTitle>
          </DialogHeader>
          {registrarEn != null && !equipoConfirmado && (
            <SelectorEquipoQR
              equipoEsperado={equipoDe(registrarEn)}
              onConfirmado={setEquipoConfirmado}
              onCancelar={cerrarDialogos}
            />
          )}
          {registrarEn != null && equipoConfirmado && (
            <RegistroActividad
              // Se usa el proyecto DEL EQUIPO identificado, no el del selector
              // superior: el QR viene de la maquina y manda sobre el filtro.
              idempresa={equipoConfirmado.idempresa}
              equipoId={equipoConfirmado.id}
              modo="registrar"
              onListo={() => { cerrarDialogos(); cargar(); if (seleccionado) cargarHoja(seleccionado) }}
              onCancelar={cerrarDialogos}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={cerrarActividadId != null} onOpenChange={(o) => !o && cerrarDialogos()}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cerrar pendiente</DialogTitle>
          </DialogHeader>
          {/* Cerrar un pendiente tambien escribe en la bitacora y supone haber
              intervenido la maquina, asi que pide el QR igual que el registro. */}
          {cerrarActividadId && !equipoConfirmado && (
            <SelectorEquipoQR
              equipoEsperado={equipoDe(cerrarActividadId.equipoId)}
              onConfirmado={setEquipoConfirmado}
              onCancelar={cerrarDialogos}
            />
          )}
          {cerrarActividadId && equipoConfirmado && (
            <RegistroActividad
              idempresa={equipoConfirmado.idempresa}
              equipoId={equipoConfirmado.id}
              actividadId={cerrarActividadId.id}
              modo="cerrar"
              onListo={() => { cerrarDialogos(); cargar(); if (seleccionado) cargarHoja(seleccionado) }}
              onCancelar={cerrarDialogos}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Dato({ l, v }: { l: string; v: string }) {
  return (
    <div>
      <div className="lg-eyebrow">{l}</div>
      <div className="text-sm">{v}</div>
    </div>
  )
}

function Campo({ l, v, on, tipo = "text", ph }: { l: string; v: string; on: (v: string) => void; tipo?: string; ph?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{l}</Label>
      <Input type={tipo} value={v} onChange={(e) => on(e.target.value)} placeholder={ph} />
    </div>
  )
}

export default GestionMontacargas
