"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/components/ui/use-toast"
import { reportarErrorApp } from "@/lib/errores-app"
import { Factory, ClipboardList, Send, Users, CalendarClock, MessageSquare, AlertCircle, CheckCircle2, History, Truck, Settings2 } from "lucide-react"
// La configuracion y las pruebas de WhatsApp viven AQUI: es el mismo canal que
// usa este modulo para enviar, y tenerlas en dos sitios distintos hacia que
// nadie supiera cual era la fuente de verdad.
import WhatsappConfig from "@/components/configuration/whatsapp-config"
import WhatsappGrupos from "@/components/configuration/whatsapp-grupos"
import NotificacionConductor from "@/components/rrhh/notificacion-conductor"
import ReporteInterno from "@/components/rrhh/reporte-interno"
import CierreProduccion from "@/components/rrhh/cierre-produccion"

const TEAL = "#00b4cc"

interface Destinatario {
  documento: string
  nombre: string
  cargo: string | null
  celular: string | null
  celularValido: boolean
  puesto?: string | null
  fecha?: string | null
  placa?: string | null
  horario?: string | null
  horaEntrada?: string | null
  horaSalida?: string | null
  fuenteCelular?: "headcount" | "hoja_vida"
}

type TipoEnvio = "alerta" | "turno" | "conductor"

interface RegistroHistorial {
  id: string
  tipo: string
  destinatario_nombre: string | null
  destinatario_celular: string | null
  mensaje: string | null
  estado: string
  created_at: string
}

const PLANTILLA_ALERTA_DEFAULT =
  "Hola {nombre}, te informamos desde LIP: "
const PLANTILLA_TURNO_DEFAULT =
  "Hola {nombre}, tu programacion para el {fecha}: puesto {puesto}, horario {horario}. LIP."
const PLANTILLA_CONDUCTOR_DEFAULT =
  "Hola {nombre} (placa {placa}), le informamos desde LIP: "

const PLANTILLAS: Record<TipoEnvio, string> = {
  alerta: PLANTILLA_ALERTA_DEFAULT,
  turno: PLANTILLA_TURNO_DEFAULT,
  conductor: PLANTILLA_CONDUCTOR_DEFAULT,
}

function hoyBogota(): string {
  return new Date().toLocaleString("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function renderPreview(plantilla: string, d?: Destinatario): string {
  const base: Partial<Destinatario> =
    d ?? { nombre: "Juan Perez", puesto: "Cargue", fecha: hoyBogota(), placa: "ABC123", horario: "06:00 a 15:00", horaEntrada: "06:00", horaSalida: "15:00" }
  return plantilla
    .replace(/\{nombre\}/gi, base.nombre ?? "")
    .replace(/\{puesto\}/gi, base.puesto ?? "")
    .replace(/\{fecha\}/gi, base.fecha ?? "")
    .replace(/\{placa\}/gi, base.placa ?? "")
    .replace(/\{horario\}/gi, base.horario ?? "")
    .replace(/\{hora_entrada\}/gi, base.horaEntrada ?? "")
    .replace(/\{hora_salida\}/gi, base.horaSalida ?? "")
    .trim()
}

const ESTADO_BADGE: Record<string, { label: string; className: string }> = {
  simulado: { label: "Simulado", className: "bg-amber-100 text-amber-800 border-amber-200" },
  enviado: { label: "Enviado", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  entregado: { label: "Entregado", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  leido: { label: "Leido", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  error: { label: "Error", className: "bg-red-100 text-red-800 border-red-200" },
  sin_celular: { label: "Sin celular", className: "bg-slate-100 text-slate-600 border-slate-200" },
}

export default function NotificacionesPersonal() {
  const { selectedEmpresaId, selectedEmpresaNombre, user } = useAuth()
  const { toast } = useToast()

  const [tipo, setTipo] = useState<TipoEnvio>("alerta")
  const [fecha, setFecha] = useState<string>(hoyBogota())
  const [mensaje, setMensaje] = useState<string>(PLANTILLA_ALERTA_DEFAULT)
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([])
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(false)
  // Motivo del fallo al cargar la lista. Null = la consulta respondio bien (aunque venga vacia).
  const [falloCarga, setFalloCarga] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [historial, setHistorial] = useState<RegistroHistorial[]>([])
  const [cargandoHist, setCargandoHist] = useState(false)

  // Cambiar de tipo repone la plantilla sugerida.
  const cambiarTipo = (t: TipoEnvio) => {
    setTipo(t)
    setMensaje(PLANTILLAS[t])
  }

  // Turno y conductor usan la fecha para acotar el listado.
  const usaFecha = tipo === "turno" || tipo === "conductor"

  /*
   * UNA LISTA VACIA Y UNA CONSULTA CAIDA NO SON LO MISMO (2026-10-07).
   *
   * Hasta hoy esto no miraba `res.ok`: si la ruta respondia 403 o 500, el `?? []` dejaba la
   * lista vacia y la pantalla decia "No hay personal programado para esa fecha". El
   * coordinador leia que no habia nadie a quien avisar, el boton de enviar quedaba
   * deshabilitado, y no quedaba rastro en ninguna parte: ni en `notificaciones_enviadas`
   * (no se envio) ni en `app_errores` (nadie reportaba). Asi se perdio una tarde de
   * diagnostico con el coordinador de ID1.
   *
   * Ahora un fallo se distingue, se dice en pantalla con su causa y queda registrado.
   */
  const cargarDestinatarios = useCallback(async () => {
    if (!selectedEmpresaId) return
    setCargando(true)
    setFalloCarga(null)
    try {
      const params = new URLSearchParams({ empresaId: String(selectedEmpresaId), tipo })
      if (tipo === "turno" || tipo === "conductor") params.set("fecha", fecha)
      const res = await fetch(`/api/notificaciones/destinatarios?${params.toString()}`)
      const json = await res.json().catch(() => ({}) as Record<string, unknown>)
      if (!res.ok) {
        const motivo = String((json as any)?.error ?? `El servidor respondio ${res.status}`)
        setDestinatarios([])
        setSeleccion(new Set())
        setFalloCarga(motivo)
        reportarErrorApp({
          origen: "cliente",
          mensaje: `Notificaciones al Personal: no se pudo cargar la lista (${res.status}): ${motivo}`,
          extra: { empresaId: selectedEmpresaId, tipo, fecha: tipo === "alerta" ? null : fecha, estado: res.status },
        })
        toast({ title: "No se pudo cargar el personal", description: motivo, variant: "destructive" })
        return
      }
      const lista: Destinatario[] = (json as any).destinatarios ?? []
      setDestinatarios(lista)
      // Preseleccionar solo los que tienen celular valido.
      setSeleccion(new Set(lista.filter((d) => d.celularValido).map((d) => d.documento)))
    } catch (e: any) {
      const motivo = e?.message ? String(e.message) : "No se pudo conectar"
      setDestinatarios([])
      setSeleccion(new Set())
      setFalloCarga(motivo)
      reportarErrorApp({
        origen: "cliente",
        mensaje: `Notificaciones al Personal: no se pudo cargar la lista: ${motivo}`,
        extra: { empresaId: selectedEmpresaId, tipo, fecha: tipo === "alerta" ? null : fecha },
      })
      toast({ title: "Error", description: "No se pudo cargar el personal", variant: "destructive" })
    } finally {
      setCargando(false)
    }
  }, [selectedEmpresaId, tipo, fecha, toast])

  useEffect(() => {
    cargarDestinatarios()
  }, [cargarDestinatarios])

  const cargarHistorial = useCallback(async () => {
    if (!selectedEmpresaId) return
    setCargandoHist(true)
    try {
      const res = await fetch(`/api/notificaciones?empresaId=${selectedEmpresaId}&limit=200`)
      const json = await res.json()
      setHistorial(json.data ?? [])
    } catch {
      toast({ title: "Error", description: "No se pudo cargar el historial", variant: "destructive" })
    } finally {
      setCargandoHist(false)
    }
  }, [selectedEmpresaId, toast])

  const seleccionValida = useMemo(
    () => destinatarios.filter((d) => seleccion.has(d.documento) && d.celularValido),
    [destinatarios, seleccion],
  )
  const conCelular = useMemo(() => destinatarios.filter((d) => d.celularValido), [destinatarios])
  const sinCelular = destinatarios.length - conCelular.length

  const toggle = (doc: string) => {
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(doc)) next.delete(doc)
      else next.add(doc)
      return next
    })
  }
  const seleccionarTodos = () => setSeleccion(new Set(conCelular.map((d) => d.documento)))
  const limpiarSeleccion = () => setSeleccion(new Set())

  const previewDest = seleccionValida[0]

  const enviar = async () => {
    if (!selectedEmpresaId) return
    if (seleccionValida.length === 0) {
      toast({ title: "Sin destinatarios", description: "Selecciona al menos una persona con celular valido", variant: "destructive" })
      return
    }
    if (!mensaje.trim()) {
      toast({ title: "Mensaje vacio", description: "Escribe el mensaje a enviar", variant: "destructive" })
      return
    }
    setEnviando(true)
    try {
      const payload = {
        empresaId: selectedEmpresaId,
        tipo,
        mensaje,
        createdBy: user?.email ?? null,
        destinatarios: seleccionValida.map((d) => ({
          documento: d.documento,
          nombre: d.nombre,
          celular: d.celular,
          puesto: d.puesto ?? null,
          placa: d.placa ?? null,
          fecha: d.fecha ?? (usaFecha ? fecha : null),
          horario: d.horario ?? null,
          horaEntrada: d.horaEntrada ?? null,
          horaSalida: d.horaSalida ?? null,
        })),
      }
      const res = await fetch("/api/notificaciones/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}) as Record<string, unknown>)
      if (!res.ok) {
        const motivo = String((json as any)?.error ?? `El servidor respondio ${res.status}`)
        reportarErrorApp({
          origen: "cliente",
          mensaje: `Notificaciones al Personal: el envio fue rechazado (${res.status}): ${motivo}`,
          extra: { empresaId: selectedEmpresaId, tipo, destinatarios: seleccionValida.length, estado: res.status },
        })
        toast({ title: "Error al enviar", description: motivo, variant: "destructive" })
        return
      }
      const modo = json.simulado ? "simulados (modo prueba)" : "enviados"
      toast({
        title: json.simulado ? "Envio simulado" : "Envio realizado",
        description: `${json.total} mensajes procesados · ${json.simulado ? json.simulados : json.enviados} ${modo}${json.errores ? ` · ${json.errores} con error` : ""}${json.sinCelular ? ` · ${json.sinCelular} sin celular` : ""}`,
      })
    } catch (e: any) {
      // Un envio que se cae sin rastro es un envio que nadie puede diagnosticar despues.
      reportarErrorApp({
        origen: "cliente",
        mensaje: `Notificaciones al Personal: el envio no se completo: ${e?.message ? String(e.message) : "sin mensaje"}`,
        stack: e?.stack ?? null,
        extra: { empresaId: selectedEmpresaId, tipo, destinatarios: seleccionValida.length },
      })
      toast({ title: "Error", description: "No se pudo completar el envio", variant: "destructive" })
    } finally {
      setEnviando(false)
    }
  }

  if (!selectedEmpresaId) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        Selecciona una empresa en el selector superior para gestionar notificaciones.
      </div>
    )
  }

  return (
    <div className="space-y-4 p-1">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <Send className="h-5 w-5" style={{ color: TEAL }} />
          Notificaciones al Personal
        </h2>
        <p className="text-sm text-muted-foreground">
          Envia alertas, programacion de turnos e informacion a conductores por WhatsApp —{" "}
          <span className="font-medium">{selectedEmpresaNombre ?? "la empresa"}</span>.
        </p>
      </div>

      <Tabs defaultValue="enviar" onValueChange={(v) => v === "historial" && cargarHistorial()}>
        <TabsList>
          <TabsTrigger value="enviar" className="gap-1.5">
            <MessageSquare className="h-4 w-4" /> Enviar
          </TabsTrigger>
          <TabsTrigger value="historial" className="gap-1.5">
            <History className="h-4 w-4" /> Historial
          </TabsTrigger>
          <TabsTrigger value="conductor" className="gap-1.5">
            <Truck className="h-4 w-4" /> Notificación conductor
          </TabsTrigger>
          <TabsTrigger value="interno" className="gap-1.5">
            <ClipboardList className="h-4 w-4" /> Reporte interno
          </TabsTrigger>
          <TabsTrigger value="produccion" className="gap-1.5">
            <Factory className="h-4 w-4" /> Cierre de producción
          </TabsTrigger>
          <TabsTrigger value="conexion" className="gap-1.5">
            <Settings2 className="h-4 w-4" /> Conexión y pruebas
          </TabsTrigger>
        </TabsList>

        {/* ---------------- ENVIAR ---------------- */}
        <TabsContent value="enviar" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Columna izquierda: mensaje */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">1 · Que enviar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant={tipo === "alerta" ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    style={tipo === "alerta" ? { backgroundColor: TEAL } : undefined}
                    onClick={() => cambiarTipo("alerta")}
                  >
                    <AlertCircle className="h-4 w-4" /> Alerta
                  </Button>
                  <Button
                    variant={tipo === "turno" ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    style={tipo === "turno" ? { backgroundColor: TEAL } : undefined}
                    onClick={() => cambiarTipo("turno")}
                  >
                    <CalendarClock className="h-4 w-4" /> Turnos
                  </Button>
                  <Button
                    variant={tipo === "conductor" ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    style={tipo === "conductor" ? { backgroundColor: TEAL } : undefined}
                    onClick={() => cambiarTipo("conductor")}
                  >
                    <Truck className="h-4 w-4" /> Conductores
                  </Button>
                </div>

                {usaFecha && (
                  <div className="space-y-1.5">
                    <Label htmlFor="fecha">
                      {tipo === "turno" ? "Fecha de la programacion" : "Fecha de llegada del vehiculo"}
                    </Label>
                    <DatePickerField id="fecha" value={fecha} onChange={setFecha} />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="mensaje">Mensaje</Label>
                  <Textarea
                    id="mensaje"
                    value={mensaje}
                    onChange={(e) => setMensaje(e.target.value)}
                    rows={5}
                    placeholder="Escribe el mensaje..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Usa <code className="rounded bg-muted px-1">{"{nombre}"}</code>
                    {tipo === "turno" && (
                      <>
                        , <code className="rounded bg-muted px-1">{"{puesto}"}</code>,{" "}
                        <code className="rounded bg-muted px-1">{"{fecha}"}</code>,{" "}
                        <code className="rounded bg-muted px-1">{"{horario}"}</code>
                      </>
                    )}
                    {tipo === "conductor" && (
                      <>
                        , <code className="rounded bg-muted px-1">{"{placa}"}</code>
                      </>
                    )}{" "}
                    y se reemplazan por los datos de cada {tipo === "conductor" ? "conductor" : "persona"}.
                  </p>
                </div>

                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Vista previa {previewDest ? `(${previewDest.nombre})` : "(ejemplo)"}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{renderPreview(mensaje, previewDest)}</p>
                </div>
              </CardContent>
            </Card>

            {/* Columna derecha: destinatarios */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">2 · A quien</CardTitle>
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3.5 w-3.5" /> {seleccionValida.length} seleccionados
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-xs">
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={seleccionarTodos}>
                    Todos con celular
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={limpiarSeleccion}>
                    Ninguno
                  </Button>
                  {sinCelular > 0 && (
                    <span className="ml-auto text-amber-600">{sinCelular} sin celular valido</span>
                  )}
                </div>

                <ScrollArea className="h-[340px] rounded-md border">
                  {cargando ? (
                    <div className="p-4 text-sm text-muted-foreground">Cargando personal...</div>
                  ) : falloCarga ? (
                    // No decir "no hay nadie" cuando lo que paso es que la consulta fallo.
                    <div className="space-y-2 p-4 text-sm">
                      <p className="font-medium text-destructive">No se pudo consultar el personal.</p>
                      <p className="text-muted-foreground">{falloCarga}</p>
                      <p className="text-xs text-muted-foreground">
                        Esto no significa que no haya personal programado: la consulta no respondio. Queda registrado
                        para revisarlo.
                      </p>
                      <Button variant="outline" size="sm" onClick={cargarDestinatarios}>
                        Volver a intentar
                      </Button>
                    </div>
                  ) : destinatarios.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      {tipo === "turno"
                        ? "No hay personal programado para esa fecha."
                        : tipo === "conductor"
                          ? "No hay conductores registrados en esa fecha."
                          : "No hay personal activo en esta empresa."}
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {destinatarios.map((d) => (
                        <li key={d.documento + (d.puesto ?? "")} className="flex items-center gap-3 px-3 py-2">
                          <Checkbox
                            checked={seleccion.has(d.documento)}
                            disabled={!d.celularValido}
                            onCheckedChange={() => toggle(d.documento)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{d.nombre}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {d.cargo ?? "—"}
                              {tipo === "turno" && d.puesto ? ` · Puesto: ${d.puesto}` : ""}
                              {tipo === "turno" && d.horario ? ` · Horario: ${d.horario}` : ""}
                              {tipo === "conductor" && d.placa ? ` · Placa: ${d.placa}` : ""}
                            </p>
                          </div>
                          {d.celularValido ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              {d.celular}
                              {d.fuenteCelular === "hoja_vida" && (
                                <Badge
                                  variant="outline"
                                  className="border-sky-200 bg-sky-50 px-1 py-0 text-[10px] text-sky-700"
                                  title="Número tomado del banco de hojas de vida (headcount no lo tenía)"
                                >
                                  H. Vida
                                </Badge>
                              )}
                            </span>
                          ) : (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                              sin celular
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>

                <Button
                  className="w-full gap-2"
                  style={{ backgroundColor: TEAL }}
                  disabled={enviando || seleccionValida.length === 0}
                  onClick={enviar}
                >
                  <Send className="h-4 w-4" />
                  {enviando ? "Enviando..." : `Enviar a ${seleccionValida.length} personas`}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Si WhatsApp aun no esta activado, el envio se registra en modo prueba (no consume ni sale de la app).
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------------- HISTORIAL ---------------- */}
        <TabsContent value="historial" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Envios recientes</CardTitle>
            </CardHeader>
            <CardContent>
              {cargandoHist ? (
                <div className="p-4 text-sm text-muted-foreground">Cargando historial...</div>
              ) : historial.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Aun no hay envios registrados.</div>
              ) : (
                <ScrollArea className="h-[420px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="px-2 py-2">Fecha</th>
                        <th className="px-2 py-2">Persona</th>
                        <th className="px-2 py-2">Tipo</th>
                        <th className="px-2 py-2">Mensaje</th>
                        <th className="px-2 py-2">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.map((h) => {
                        const badge = ESTADO_BADGE[h.estado] ?? {
                          label: h.estado,
                          className: "bg-slate-100 text-slate-600 border-slate-200",
                        }
                        return (
                          <tr key={h.id} className="border-b align-top">
                            <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">
                              {new Date(h.created_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })}
                            </td>
                            <td className="px-2 py-2">
                              <div className="font-medium">{h.destinatario_nombre ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">{h.destinatario_celular ?? ""}</div>
                            </td>
                            <td className="px-2 py-2 capitalize">{h.tipo}</td>
                            <td className="max-w-[280px] px-2 py-2 text-xs text-muted-foreground">
                              <span className="line-clamp-2">{h.mensaje}</span>
                            </td>
                            <td className="px-2 py-2">
                              <Badge variant="outline" className={badge.className}>
                                {h.estado === "enviado" || h.estado === "entregado" || h.estado === "leido" ? (
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                ) : null}
                                {badge.label}
                              </Badge>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {/* ---------------- NOTIFICACIÓN CONDUCTOR ---------------- */}
        <TabsContent value="conductor" className="mt-4">
          <NotificacionConductor />
        </TabsContent>

        {/* ---------------- CONEXIÓN Y PRUEBAS ---------------- */}
        {/* ---------------- REPORTE INTERNO ---------------- */}
        <TabsContent value="interno" className="mt-4">
          <ReporteInterno />
        </TabsContent>

        {/* ---------------- CIERRE DE PRODUCCIÓN ---------------- */}
        <TabsContent value="produccion" className="mt-4">
          <CierreProduccion />
        </TabsContent>

        <TabsContent value="conexion" className="mt-4 space-y-6">
          <WhatsappConfig />
          {/* La prueba de grupos vive aquí y no en su propia pestaña: es una
              prueba de la plataforma, no un flujo de la operación. */}
          <WhatsappGrupos />
        </TabsContent>
      </Tabs>
    </div>
  )
}
