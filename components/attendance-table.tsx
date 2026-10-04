"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Cifra, Esqueleto, Eyebrow } from "@/components/ui/lipgo"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { useAuth } from "@/components/auth-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Clock, Users, Save, AlertTriangle, Repeat, Bot, CalendarDays } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { reasignarPuestoDelDia } from "@/lib/reasignacion-puesto-actions"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OPERACIONES_OPTIONS, ESPECIALIDADES_OPTIONS, isLate, timeToMinutes } from "@/lib/asistencia-catalogos"
import { PoliticasHorasExtra } from "@/components/attendance/politicas-horas-extra"

interface AttendanceRecord {
  identificacion: string
  nombre: string
  // Hora de entrada programada (registroasistencia.horaentradaprogramada).
  // Puede llegar como "HH:MM" o "HH:MM:SS". Es null si la persona no
  // tenia un turno programado para hoy.
  horaProgramada: string | null
  horaLlegada: string | null
  // `horaSalida` proviene de `registroasistencia.horasalida` para el
  // dia de hoy. Es null mientras el operador no haya marcado la
  // salida en el modulo de Registro de Asistencia.
  horaSalida: string | null
  // Valores actuales de `registroasistencia` para el dia. Pueden ser
  // null si la persona aun no ha sido procesada o si la fila aun no
  // ha cerrado el codigo de novedad.
  puesto: string | null
  asistencia: string | null
  alreadyAssigned: boolean // Added to track if already assigned today
  // Fotos capturadas automáticamente por la cámara al marcar ingreso/salida.
  fotoIngreso: string | null
  fotoSalida: string | null
  // true si `horasalida` la cerró el cron de las 11pm (registroasistencia.
  // horafinauto) porque la persona no marcó salida ese día — no es una
  // marcación real.
  horaFinAuto: boolean
}

/**
 * Devuelve la hora actual en Colombia (zona America/Bogota) expresada
 * como minutos desde las 00:00. Lo construimos desde Intl.DateTimeFormat
 * en lugar de `Date.getHours()` para que sea correcto sin importar la
 * zona horaria del navegador (un usuario podria estar conectado desde
 * otra TZ pero la regla de negocio se evalua siempre con hora local
 * Colombia).
 */
function getColombiaMinutes(): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date())
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
    // Intl puede devolver "24" como hora a medianoche en algunos
    // entornos; lo normalizamos a 0 para no exceder 24*60.
    return ((h % 24) * 60) + m
  } catch {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  }
}

/** Fecha de hoy en Colombia (America/Bogota), formato "YYYY-MM-DD". */
function getColombiaDateString(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

interface ShiftAssignment {
  identificacion: string
  nombre: string
  type: "operaciones" | "especialidades" | "novedad" | null
  puesto: string | null
}

/**
 * Las dos pestañas del módulo.
 *
 * `defaultValue` y no un valor controlado a proposito: asi cambiar de pestaña
 * no remonta la tabla de asistencia ni vuelve a pedir los datos del dia.
 */
export default function AttendanceTable() {
  return (
    <Tabs defaultValue="asistencia" className="p-6 space-y-4">
      <TabsList>
        <TabsTrigger value="asistencia" className="gap-1.5">
          <Users className="h-4 w-4" />
          Asistencia del día
        </TabsTrigger>
        <TabsTrigger value="politicas" className="gap-1.5">
          <Clock className="h-4 w-4" />
          Políticas de horas extra
        </TabsTrigger>
      </TabsList>

      <TabsContent value="asistencia">
        <TablaAsistenciaDiaria />
      </TabsContent>

      <TabsContent value="politicas">
        <PoliticasHorasExtra />
      </TabsContent>
    </Tabs>
  )
}

function TablaAsistenciaDiaria() {
  const { selectedEmpresaId } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [shiftAssignments, setShiftAssignments] = useState<Map<string, ShiftAssignment>>(new Map())

  // Filtro de fecha: por defecto hoy (Colombia). Ver días anteriores es
  // SOLO LECTURA — asignar turnos/novedades siempre escribe en el día de
  // hoy (app/api/attendance/register-shifts), así que con otra fecha
  // seleccionada se deshabilitan los checkboxes para no confundir al
  // coordinador con un cambio que en realidad cayó en otro día.
  const [fecha, setFecha] = useState<string>(() => getColombiaDateString())
  const esHoy = fecha === getColombiaDateString()

  // Cambio de puesto de una persona YA asignada hoy. Exige motivo escrito
  // porque el puesto decide quién puede asignarse en Picking/Packing y cómo
  // liquida `pagonomina` ese día (ver lib/reasignacion-puesto-actions.ts).
  const [reasignar, setReasignar] = useState<{
    record: AttendanceRecord
    puesto: string
    motivo: string
  } | null>(null)
  const [reasignando, setReasignando] = useState(false)

  // Hora actual en Colombia (America/Bogota) expresada como minutos
  // desde 00:00. Se usa para marcar con la alerta "Registrar novedad"
  // a las personas que ya pasaron su hora programada de entrada y
  // siguen ausentes con puesto asignado. Refrescamos cada 60s para
  // que la marca aparezca sola sin necesidad de recargar.
  const [nowColMinutes, setNowColMinutes] = useState<number>(() =>
    getColombiaMinutes(),
  )
  useEffect(() => {
    const id = setInterval(() => setNowColMinutes(getColombiaMinutes()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (selectedEmpresaId) {
      fetchAttendanceData()
    }
  }, [selectedEmpresaId, fecha])

  const fetchAttendanceData = async () => {
    try {
      setLoading(true)
      setError(null)

      // `cache: "no-store"` y el cache-buster en la URL evitan que el
      // navegador o un middleware sirvan una respuesta vieja en la que
      // un Ausente todavia aparecia como "Procesado". La tabla es muy
      // sensible a estado en tiempo real (asistencia, novedades), asi
      // que siempre vamos a origen.
      const response = await fetch(
        `/api/attendance/table?empresaId=${selectedEmpresaId}&fecha=${fecha}&t=${Date.now()}`,
        { cache: "no-store" },
      )
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Error al cargar los datos")
      }

      setRecords(result.data || [])
    } catch (err) {
      console.error("[v0] Error fetching attendance table:", err)
      setError(err instanceof Error ? err.message : "Error al cargar los datos de asistencia")
    } finally {
      setLoading(false)
    }
  }

  const handleCheckboxChange = (
    identificacion: string,
    nombre: string,
    type: "operaciones" | "especialidades" | "novedad",
    isPresent: boolean,
  ) => {
    if (!isPresent && type !== "novedad") {
      toast({
        title: "No permitido",
        description: "Las personas ausentes solo pueden tener novedades registradas",
        variant: "destructive",
      })
      return
    }

    if (isPresent && type === "novedad") {
      toast({
        title: "No permitido",
        description: "Las personas presentes no pueden tener novedades registradas",
        variant: "destructive",
      })
      return
    }

    setShiftAssignments((prev) => {
      const newMap = new Map(prev)
      const current = newMap.get(identificacion)

      // Toggle off if clicking the same type
      if (current?.type === type) {
        newMap.delete(identificacion)
      } else {
        // Set new type
        newMap.set(identificacion, {
          identificacion,
          nombre,
          type,
          puesto: null,
        })
      }

      return newMap
    })
  }

  const handlePuestoChange = (identificacion: string, puesto: string) => {
    setShiftAssignments((prev) => {
      const newMap = new Map(prev)
      const current = newMap.get(identificacion)

      if (current) {
        newMap.set(identificacion, {
          ...current,
          puesto,
        })
      }

      return newMap
    })
  }

  const confirmarReasignacion = async () => {
    if (!reasignar || !selectedEmpresaId) return
    const { record, puesto, motivo } = reasignar
    setReasignando(true)
    const r = await reasignarPuestoDelDia({
      identificacion: record.identificacion,
      nombre: record.nombre,
      idempresa: selectedEmpresaId,
      puestoNuevo: puesto,
      // El grupo NO se manda desde aquí: el server lo resuelve contra
      // `tarifasturnos`, que es el maestro. Estas listas son solo para armar el
      // desplegable y pueden desalinearse del maestro; la bandera `especialidad`
      // decide cómo se liquida el día, así que no puede salir del cliente.
      motivo,
    })
    setReasignando(false)
    if (r.success) {
      toast({ title: "Puesto cambiado", description: r.message })
      setReasignar(null)
      await fetchAttendanceData()
    } else {
      toast({ title: "No se pudo cambiar", description: r.message, variant: "destructive" })
    }
  }

  const handleRegisterShifts = async () => {
    const shiftsToRegister = Array.from(shiftAssignments.values()).filter((shift) => {
      // For operaciones and especialidades, puesto must be selected
      if (shift.type === "operaciones" || shift.type === "especialidades") {
        return shift.puesto !== null
      }
      // For novedad, no puesto needed
      return shift.type === "novedad"
    })

    if (shiftsToRegister.length === 0) {
      toast({
        title: "Error",
        description: "No hay turnos válidos para registrar",
        variant: "destructive",
      })
      return
    }

    try {
      setSaving(true)

      const response = await fetch("/api/attendance/register-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shifts: shiftsToRegister,
          empresaId: selectedEmpresaId,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Error al registrar los turnos")
      }

      toast({
        title: "Éxito",
        description: result.message || "Turnos registrados correctamente",
      })

      // Clear selections and refresh data
      setShiftAssignments(new Map())
      await fetchAttendanceData()
    } catch (err) {
      console.error("[v0] Error registering shifts:", err)
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Error al registrar los turnos",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const presentCount = records.filter((r) => r.horaLlegada).length
  const absentCount = records.filter((r) => !r.horaLlegada).length
  const selectedCount = shiftAssignments.size

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Personal · {esHoy ? "hoy" : "día anterior (solo lectura)"}</Eyebrow>
          <h1 className="text-xl font-bold leading-tight tracking-tight sm:text-2xl">Tabla de Asistencia</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {esHoy ? "Registro de asistencia del día de hoy" : "Consulta de un día anterior (solo lectura)"}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" /> Fecha
            </Label>
            <DatePickerField
              value={fecha}
              maxDate={getColombiaDateString()}
              onChange={(value) => value && setFecha(value)}
              className="h-9 w-[160px] text-sm"
            />
          </div>
          {!esHoy && (
            <Button variant="outline" size="sm" onClick={() => setFecha(getColombiaDateString())}>
              Hoy
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex flex-col gap-4" aria-busy aria-label="Cargando asistencia">
          <div className="lg-card grid grid-cols-3 gap-6 p-5">
            <Esqueleto lineas={3} />
            <Esqueleto lineas={3} />
            <Esqueleto lineas={3} />
          </div>
          <div className="lg-card p-5"><Esqueleto lineas={8} /></div>
        </div>
      ) : (
        <>
      {/* Resumen del día: mismos conteos de siempre, en la franja de cifras. */}
      <section className="lg-card grid grid-cols-3 gap-x-4 gap-y-4 p-4 sm:p-5">
        <Cifra label="Total personal" valor={records.length} sub={<span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> activos del proyecto</span>} />
        <Cifra
          label="Presentes"
          valor={presentCount}
          tono={records.length > 0 && presentCount / records.length >= 0.95 ? "ok" : presentCount > 0 ? "atencion" : "neutro"}
          progreso={records.length > 0 ? (presentCount / records.length) * 100 : undefined}
          sub={records.length > 0 ? `${Math.round((presentCount / records.length) * 100)} % del personal` : "sin personal cargado"}
        />
        <Cifra label="Ausentes" valor={absentCount} tono={absentCount > 0 ? "critico" : "ok"} sub={<span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> sin marcar hoy</span>} />
      </section>

      {/* Attendance Table */}
      <Card>
        <CardHeader>
          <CardTitle>Registro de Asistencia</CardTitle>
          <CardDescription>Lista del personal activo y su hora de llegada</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Tabla densa: bajamos el tamano global a `text-xs` y
              reducimos padding horizontal/vertical para que las 10
              columnas quepan sin scroll horizontal en pantallas de
              1366px+. Los headers usan `text-[11px] uppercase` para
              comprimir su ancho sin perder jerarquia visual. Las
              celdas tienen `whitespace-nowrap` por defecto para que
              "Hora de Llegada", "Hora Programada", etc. no rompan en
              dos lineas. La columna Nombre permite wrap (override mas
              abajo) porque suele ser la unica con texto largo. */}
          <div className="rounded-md border max-h-[600px] overflow-y-auto text-xs [&_th]:py-1.5 [&_td]:py-1.5 [&_th]:px-2 [&_td]:px-2 [&_th]:text-[11px] [&_th]:uppercase [&_th]:tracking-wide [&_th]:font-semibold [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
            <Table>
              <TableHeader>
                <TableRow>
                  {/* Titulos abreviados para reducir ancho. "Identif."
                      en lugar de "Identificacion", "Programada" /
                      "Llegada" / "Salida" sin el prefijo "Hora de" — la
                      columna de horas es obvia por contexto y formato. */}
                  <TableHead>Identif.</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Programada</TableHead>
                  <TableHead>Llegada</TableHead>
                  <TableHead>Salida</TableHead>
                  <TableHead className="text-center">Fotos</TableHead>
                  <TableHead>Puesto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-center">Operac.</TableHead>
                  <TableHead className="text-center">Especialid.</TableHead>
                  <TableHead className="text-center">Novedad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                      No hay registros de personal activo
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((record) => {
                    const assignment = shiftAssignments.get(record.identificacion)
                    const isPresent = !!record.horaLlegada
                    const isAssigned = record.alreadyAssigned

                    return (
                      <TableRow
                        key={record.identificacion}
                        className={isAssigned ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}
                      >
                        <TableCell className="font-medium tabular-nums">{record.identificacion}</TableCell>
                        {/* `whitespace-normal` revierte el `nowrap`
                            global del wrapper para esta columna, que
                            es la unica con texto potencialmente largo
                            (nombres con varios apellidos). La badge
                            "Programado" baja a `text-[10px]` y padding
                            reducido para ocupar menos. */}
                        <TableCell className="whitespace-normal min-w-[160px]">
                          <div className="flex flex-wrap items-center gap-1">
                            <span>{record.nombre}</span>
                            {isAssigned && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 leading-4"
                              >
                                Programado
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {record.horaProgramada ? (
                            // Hora programada (sin colorear) — sirve de
                            // referencia para comparar con la hora de
                            // llegada. Recortamos los segundos si vienen
                            // (algunas filas legacy traen "HH:MM:SS")
                            // para que sea visualmente consistente con
                            // la columna de llegada.
                            <span className="text-foreground font-medium tabular-nums">
                              {record.horaProgramada.slice(0, 5)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {record.horaLlegada ? (
                            // Llegada tarde: hora en rojo + badge
                            // compacto "Tarde" (texto recortado para
                            // no estirar la columna). Mostramos solo
                            // HH:MM aunque venga "HH:MM:SS" — los
                            // segundos no aportan en una vista densa.
                            isLate(record.horaLlegada, record.horaProgramada) ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-red-600 font-semibold tabular-nums">
                                  {record.horaLlegada.slice(0, 5)}
                                </span>
                                <Badge
                                  variant="destructive"
                                  className="text-[9px] uppercase tracking-wide px-1 py-0 leading-4"
                                >
                                  Tarde
                                </Badge>
                              </div>
                            ) : (
                              <span className="text-green-600 font-medium tabular-nums">
                                {record.horaLlegada.slice(0, 5)}
                              </span>
                            )
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {record.horaSalida ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-blue-600 font-medium tabular-nums">
                                {record.horaSalida.slice(0, 5)}
                              </span>
                              {record.horaFinAuto && (
                                <Badge
                                  variant="outline"
                                  className="gap-0.5 text-[9px] uppercase tracking-wide px-1 py-0 leading-4 text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-700"
                                  title="No marcó salida: el sistema la cerró automáticamente a las 11pm con la hora programada"
                                >
                                  <Bot className="h-2.5 w-2.5" /> Auto
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        {/* Fotos automáticas de ingreso (verde) y salida (azul). Click = ampliar. */}
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            {record.fotoIngreso ? (
                              <a href={record.fotoIngreso} target="_blank" rel="noreferrer" title="Foto de ingreso">
                                <img src={record.fotoIngreso} alt="ingreso" className="h-8 w-8 rounded-full object-cover ring-2 ring-green-500" />
                              </a>
                            ) : (
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground ring-1 ring-border">in</span>
                            )}
                            {record.fotoSalida ? (
                              <a href={record.fotoSalida} target="_blank" rel="noreferrer" title="Foto de salida">
                                <img src={record.fotoSalida} alt="salida" className="h-8 w-8 rounded-full object-cover ring-2 ring-blue-500" />
                              </a>
                            ) : (
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground ring-1 ring-border">out</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {record.puesto ? (
                            <div className="flex items-center gap-1">
                              {/* Badge outline mas compacta (text-[10px],
                                  padding reducido) para no inflar el ancho
                                  de la columna cuando el puesto es largo. */}
                              <Badge
                                variant="outline"
                                className="font-medium text-[10px] px-1.5 py-0 leading-4"
                              >
                                {record.puesto}
                              </Badge>
                              {/* Cambiar el puesto del día. Solo tiene sentido
                                  sobre alguien ya asignado y sin novedad: una
                                  novedad significa que no está trabajando. Solo
                                  para hoy: reasignarPuestoDelDia opera sobre el
                                  día actual, no sobre el que se está consultando. */}
                              {!record.asistencia && esHoy && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                                  title="Cambiar puesto (exige motivo)"
                                  onClick={() =>
                                    setReasignar({ record, puesto: "", motivo: "" })
                                  }
                                >
                                  <Repeat className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isPresent ? (
                            <Badge
                              variant="default"
                              className="bg-green-600 text-[10px] px-1.5 py-0 leading-4"
                            >
                              Presente
                            </Badge>
                          ) : (
                            (() => {
                              // Alerta "Registrar novedad": aplica a personas
                              // que tienen puesto asignado, estan AUSENTES y
                              // cuya hora programada es mayor a la hora
                              // actual en Colombia (es decir, todavia no
                              // llega su turno pero el sistema ya las
                              // detecto como ausentes — el supervisor debe
                              // registrar la novedad por anticipado). Si la
                              // hora programada ya paso, no mostramos esta
                              // alerta porque se cubre con el flujo normal
                              // del modulo de Novedades de Personal.
                              const programadaMin = timeToMinutes(record.horaProgramada)
                              const debeRegistrarNovedad =
                                !!record.puesto &&
                                Number.isFinite(programadaMin) &&
                                programadaMin > nowColMinutes
                              return (
                                <div className="flex flex-col items-start gap-1">
                                  <Badge
                                    variant="destructive"
                                    className="text-[10px] px-1.5 py-0 leading-4"
                                  >
                                    Ausente
                                  </Badge>
                                  {debeRegistrarNovedad && (
                                    <Badge
                                      className="gap-1 bg-amber-500 hover:bg-amber-500 text-white text-[10px] px-1.5 py-0 leading-4 animate-pulse"
                                    >
                                      <AlertTriangle className="h-3 w-3" />
                                      Registrar novedad
                                    </Badge>
                                  )}
                                </div>
                              )
                            })()
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-center gap-2">
                            <Checkbox
                              checked={assignment?.type === "operaciones"}
                              onCheckedChange={() =>
                                handleCheckboxChange(record.identificacion, record.nombre, "operaciones", isPresent)
                              }
                              disabled={isAssigned || !isPresent || !esHoy}
                              // Tamano y contraste reforzados para que las
                              // celdas Operaciones / Especialidades / Novedad
                              // sean facilmente clickeables en una tabla
                              // densa y se distingan del fondo aun en filas
                              // alternadas. Borde mas grueso + tonalidad
                              // slate fuerte y tick blanco al marcar.
                              className="h-5 w-5 border-2 border-slate-400 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-700 data-[state=checked]:text-white shadow-sm transition-colors"
                            />
                            {assignment?.type === "operaciones" && (
                              <Select
                                value={assignment.puesto || ""}
                                onValueChange={(value) => handlePuestoChange(record.identificacion, value)}
                              >
                                {/* Trigger compacto (h-7, text-xs,
                                    140px) para no estirar la columna
                                    en la version densa. */}
                                <SelectTrigger className="w-[140px] h-7 text-xs">
                                  <SelectValue placeholder="Seleccionar" />
                                </SelectTrigger>
                                <SelectContent>
                                  {OPERACIONES_OPTIONS.map((op) => (
                                    <SelectItem key={op} value={op} className="text-xs">
                                      {op}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-center gap-2">
                            <Checkbox
                              checked={assignment?.type === "especialidades"}
                              onCheckedChange={() =>
                                handleCheckboxChange(record.identificacion, record.nombre, "especialidades", isPresent)
                              }
                              disabled={isAssigned || !isPresent || !esHoy}
                              className="h-5 w-5 border-2 border-slate-400 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-700 data-[state=checked]:text-white shadow-sm transition-colors"
                            />
                            {assignment?.type === "especialidades" && (
                              <Select
                                value={assignment.puesto || ""}
                                onValueChange={(value) => handlePuestoChange(record.identificacion, value)}
                              >
                                <SelectTrigger className="w-[140px] h-7 text-xs">
                                  <SelectValue placeholder="Seleccionar" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ESPECIALIDADES_OPTIONS.map((esp) => (
                                    <SelectItem key={esp} value={esp} className="text-xs">
                                      {esp}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={assignment?.type === "novedad"}
                            onCheckedChange={() =>
                              handleCheckboxChange(record.identificacion, record.nombre, "novedad", isPresent)
                            }
                            disabled={isAssigned || isPresent || !esHoy}
                            // Para "Novedad" usamos el mismo tamano y borde
                            // pero un acento ambar al marcar, que comunica
                            // mejor su semantica de excepcion vs. asignacion.
                            className="h-5 w-5 border-2 border-slate-400 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-600 data-[state=checked]:text-white shadow-sm transition-colors"
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {esHoy && records.length > 0 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{selectedCount} turno(s) seleccionado(s)</p>
              <Button onClick={handleRegisterShifts} disabled={saving || selectedCount === 0}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Registrando...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Registrar Cambios
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
        </>
      )}

      {/* Cambio de puesto del día. El motivo es obligatorio: el puesto decide
          quién puede asignarse en Picking/Packing y cómo liquida la nómina ese
          día, así que el cambio tiene que quedar justificado y trazado. */}
      <Dialog open={!!reasignar} onOpenChange={(open) => !open && setReasignar(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar puesto del día</DialogTitle>
            <DialogDescription>
              {reasignar?.record.nombre} · actualmente en{" "}
              <strong>{reasignar?.record.puesto}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Puesto nuevo</Label>
              <Select
                value={reasignar?.puesto || ""}
                onValueChange={(v) => setReasignar((p) => (p ? { ...p, puesto: v } : p))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona el puesto" />
                </SelectTrigger>
                <SelectContent>
                  {[...OPERACIONES_OPTIONS, ...ESPECIALIDADES_OPTIONS]
                    .filter((p) => p !== reasignar?.record.puesto)
                    .map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Motivo del cambio</Label>
              <Textarea
                value={reasignar?.motivo || ""}
                onChange={(e) => setReasignar((p) => (p ? { ...p, motivo: e.target.value } : p))}
                placeholder="Por qué se reasigna a esta persona"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Mínimo 10 caracteres. Queda registrado con tu usuario y la hora.
              </p>
            </div>

            {/* La persona sin llegada confirmada NO aparece en Picking/Packing
                aunque se le cambie el puesto. Se avisa aquí para que nadie
                interprete el cambio como un fallo del sistema. */}
            {reasignar && !reasignar.record.horaLlegada && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Esta persona aún no ha marcado su llegada, así que no aparecerá en los
                selectores de Picking y Packing hasta que lo haga. El cambio de puesto sí
                queda guardado.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReasignar(null)} disabled={reasignando}>
              Cancelar
            </Button>
            <Button
              onClick={confirmarReasignacion}
              disabled={
                reasignando ||
                !reasignar?.puesto ||
                (reasignar?.motivo.trim().length ?? 0) < 10
              }
            >
              {reasignando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                "Cambiar puesto"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
