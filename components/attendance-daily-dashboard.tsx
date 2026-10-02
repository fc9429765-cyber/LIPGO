"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2, RefreshCw, CalendarDays, ChevronDown, ChevronUp, Pencil, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { useAuth } from "@/components/auth-provider"
import { supabase } from "@/lib/supabase"
import { isLate } from "@/lib/asistencia-catalogos"
import { clasificarDiaCotizacion } from "@/lib/parafiscales"
import { categoriaDeNovedad } from "@/lib/ausentismo-categorias"
import { EditNovedadDialog, type RegistroParaEditarNovedad } from "@/components/attendance/edit-novedad-dialog"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

interface DashboardRecord {
  id: number
  fecha: string
  nombre: string
  identificacion: string
  puesto: string | null
  asistencia: string | null
  hed: number | null
  hedf: number | null
  hen: number | null
  hef: number | null
  hn: number | null
  especialidad: string | null
  horaingreso: string | null
  horaentradaprogramada: string | null
}

interface MiniRecord {
  fecha: string
  puesto: string | null
  asistencia: string | null
  identificacion: string
  nombre: string
}

type Estado = "a_tiempo" | "tarde" | "ausentismo" | "licencia" | "vacaciones" | "descanso" | "retiro" | "sin_reportar"

const ESTADO_TXT: Record<Estado, { label: string; text: string; bg: string; dot: string }> = {
  a_tiempo: { label: "A tiempo", text: "text-emerald-600", bg: "bg-emerald-500", dot: "bg-emerald-500" },
  tarde: { label: "Tarde", text: "text-amber-600", bg: "bg-amber-500", dot: "bg-amber-500" },
  ausentismo: { label: "Ausentismo", text: "text-violet-600", bg: "bg-violet-500", dot: "bg-violet-500" },
  licencia: { label: "Licencia remunerada", text: "text-indigo-600", bg: "bg-indigo-500", dot: "bg-indigo-500" },
  vacaciones: { label: "Vacaciones", text: "text-sky-600", bg: "bg-sky-500", dot: "bg-sky-500" },
  descanso: { label: "Descanso", text: "text-slate-500", bg: "bg-slate-400", dot: "bg-slate-400" },
  retiro: { label: "Retiro", text: "text-zinc-600", bg: "bg-zinc-500", dot: "bg-zinc-500" },
  sin_reportar: { label: "No presentado", text: "text-rose-600", bg: "bg-rose-500", dot: "bg-rose-500" },
}

const ESTADO_FILTROS: { value: "todos" | Estado; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "a_tiempo", label: "A tiempo" },
  { value: "tarde", label: "Tarde" },
  { value: "ausentismo", label: "Ausentismo" },
  { value: "licencia", label: "Licencia remunerada" },
  { value: "vacaciones", label: "Vacaciones" },
  { value: "descanso", label: "Descanso" },
  { value: "retiro", label: "Retiro" },
  { value: "sin_reportar", label: "No presentado" },
]

const iniciales = (nombre: string) =>
  nombre
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()

// Ausentismo REAL = SOLO incapacidad (EG/AT) o licencia NO remunerada -- la
// regla de negocio ya definida y documentada en lib/ausentismo-categorias.ts
// (la misma que usa el módulo Ausentismos/Recobro), NO clasificarDiaCotizacion
// (esa es para parafiscales/nómina, un concepto relacionado pero distinto:
// ahí licencia remunerada SÍ es "no trabajado", pero para efectos de
// ausentismo NO cuenta como falta -- es un derecho remunerado, no un
// problema de asistencia). Vacaciones y Retiro son estados propios;
// "Descanso"/"Descanso compensatorio domingo anterior" no son una ausencia.
const clasificar = (r: DashboardRecord): Estado => {
  if (r.asistencia) {
    if (categoriaDeNovedad(r.asistencia)) return "ausentismo"
    const tipo = clasificarDiaCotizacion(r.asistencia)
    if (tipo === "VAC") return "vacaciones"
    if (tipo === "RETIRO") return "retiro"
    if (tipo === "LICR") return "licencia"
    return "descanso" // TRAB con novedad: Descanso / Descanso compensatorio domingo anterior
  }
  if (r.puesto === null) return "sin_reportar"
  return isLate(r.horaingreso, r.horaentradaprogramada) ? "tarde" : "a_tiempo"
}

export function AttendanceDailyDashboard() {
  const { selectedEmpresaId } = useAuth()
  const [data, setData] = useState<DashboardRecord[]>([])
  const [last7Data, setLast7Data] = useState<MiniRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [todayDate, setTodayDate] = useState("")
  const [headcountTotal, setHeadcountTotal] = useState(0)
  const [selectedDate, setSelectedDate] = useState("")
  const [realtimeOk, setRealtimeOk] = useState(false)
  const [verAnalisis, setVerAnalisis] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<"todos" | Estado>("todos")
  const [editing, setEditing] = useState<RegistroParaEditarNovedad | null>(null)

  const getTodayColombia = () =>
    new Date()
      .toLocaleString("en-CA", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .split(",")[0]

  const loadData = useCallback(
    async (dateOverride?: string) => {
      if (!selectedEmpresaId) return
      setLoading(true)
      try {
        const dateParam = dateOverride !== undefined ? dateOverride : selectedDate || ""
        const url = `/api/attendance/dashboard?empresaId=${selectedEmpresaId}&mode=daily${dateParam ? `&date=${dateParam}` : ""}`
        const res = await fetch(url)
        const json = await res.json()
        setData(json.data || [])
        setLast7Data(json.last7Data || [])
        setTodayDate(json.date || "")
        setHeadcountTotal(json.headcountTotal || 0)
      } catch (e) {
        console.error("Error loading daily dashboard:", e)
      } finally {
        setLoading(false)
      }
    },
    [selectedEmpresaId, selectedDate],
  )

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate)
    loadData(newDate)
  }

  const handleGoToToday = () => {
    setSelectedDate("")
    loadData("")
  }

  const isToday = !selectedDate || selectedDate === getTodayColombia()

  // Realtime: cualquier cambio en registroasistencia (mismo patrón que
  // components/produccion/control-piso.tsx) recarga el día -- solo tiene
  // sentido mirando HOY, un día pasado no cambia.
  useEffect(() => {
    if (!isToday) {
      setRealtimeOk(false)
      return
    }
    const channel = supabase
      .channel("visor-asistencia-diario")
      .on("postgres_changes", { event: "*", schema: "public", table: "registroasistencia" }, () => {
        loadData()
      })
      .subscribe((status: string) => setRealtimeOk(status === "SUBSCRIBED"))
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData, isToday])

  const stats = useMemo(() => {
    let aTiempo = 0
    let tarde = 0
    let ausentismo = 0
    let licencia = 0
    let vacaciones = 0
    let descanso = 0
    let retiro = 0
    let sinReportar = 0
    for (const r of data) {
      const c = clasificar(r)
      if (c === "a_tiempo") aTiempo++
      else if (c === "tarde") tarde++
      else if (c === "ausentismo") ausentismo++
      else if (c === "licencia") licencia++
      else if (c === "vacaciones") vacaciones++
      else if (c === "descanso") descanso++
      else if (c === "retiro") retiro++
      else sinReportar++
    }
    const cerradas = aTiempo + tarde
    const pctCumplimiento = cerradas > 0 ? Math.round((aTiempo / cerradas) * 100) : 0
    return { total: data.length, aTiempo, tarde, ausentismo, licencia, vacaciones, descanso, retiro, sinReportar, pctCumplimiento }
  }, [data])

  const marcaciones = useMemo(() => {
    return [...data]
      .map((r) => ({ ...r, estado: clasificar(r) }))
      .sort((a, b) => {
        if (!a.horaingreso && !b.horaingreso) return a.nombre.localeCompare(b.nombre)
        if (!a.horaingreso) return 1
        if (!b.horaingreso) return -1
        return a.horaingreso.localeCompare(b.horaingreso)
      })
  }, [data])

  const marcacionesFiltradas = useMemo(
    () => (filtroEstado === "todos" ? marcaciones : marcaciones.filter((r) => r.estado === filtroEstado)),
    [marcaciones, filtroEstado],
  )

  const porPuesto = useMemo(() => {
    const map: Record<string, { puesto: string; aTiempo: number; tarde: number }> = {}
    for (const r of data) {
      if (!r.puesto) continue
      if (!map[r.puesto]) map[r.puesto] = { puesto: r.puesto, aTiempo: 0, tarde: 0 }
      if (isLate(r.horaingreso, r.horaentradaprogramada)) map[r.puesto].tarde++
      else map[r.puesto].aTiempo++
    }
    return Object.values(map)
      .map((g) => {
        const count = g.aTiempo + g.tarde
        const pct = count > 0 ? Math.round((g.aTiempo / count) * 100) : 0
        return { ...g, count, pct }
      })
      .sort((a, b) => b.count - a.count)
  }, [data])

  const ausentismoAcumulado = useMemo(() => {
    const map: Record<string, { identificacion: string; nombre: string; faltas: number; motivos: Set<string> }> = {}
    for (const r of last7Data) {
      if (!r.asistencia) continue
      // Solo ausentismo REAL (incapacidad/licencia NO remunerada) -- vacaciones,
      // retiro, licencia remunerada y "Descanso"/"Descanso compensatorio" no
      // son faltas (lib/ausentismo-categorias.ts).
      if (!categoriaDeNovedad(r.asistencia)) continue
      const k = r.identificacion
      if (!map[k]) map[k] = { identificacion: k, nombre: r.nombre, faltas: 0, motivos: new Set() }
      map[k].faltas++
      map[k].motivos.add(r.asistencia)
    }
    return Object.values(map)
      .map((p) => ({ ...p, motivos: [...p.motivos] }))
      .sort((a, b) => b.faltas - a.faltas)
      .slice(0, 6)
  }, [last7Data])

  const horasExtraHoy = useMemo(() => {
    return data
      .map((r) => ({
        nombre: r.nombre,
        puesto: r.puesto,
        total: (r.hed || 0) + (r.hedf || 0) + (r.hen || 0) + (r.hef || 0) + (r.hn || 0),
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [data])

  const totalHE = useMemo(() => horasExtraHoy.reduce((s, r) => s + r.total, 0), [horasExtraHoy])

  const last7Trend = useMemo(() => {
    const map: Record<string, { date: string; turnos: number; aTiempo: number }> = {}
    for (const r of last7Data) {
      if (!map[r.fecha]) map[r.fecha] = { date: r.fecha, turnos: 0, aTiempo: 0 }
      map[r.fecha].turnos += 1
      if (r.puesto !== null && !r.asistencia) map[r.fecha].aTiempo += 1
    }
    return Object.values(map)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        label: d.date.split("-")[2],
        pct: d.turnos > 0 ? Math.round((d.aTiempo / d.turnos) * 100) : 0,
      }))
  }, [last7Data])

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ""
    const [y, m, d] = dateStr.split("-").map(Number)
    return new Date(y, m - 1, d).toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
  }

  const notasAutomaticas = useMemo(() => {
    const notas: { tono: "warn" | "ok"; texto: string }[] = []
    if (stats.tarde > 0) {
      notas.push({
        tono: "warn",
        texto: `${stats.tarde} llegada(s) tarde registradas hoy: quedan con hora en ámbar y trazabilidad para el supervisor.`,
      })
    }
    if (stats.sinReportar > 0) {
      notas.push({
        tono: "warn",
        texto: `${stats.sinReportar} persona(s) programada(s) sin marcar hoy — requieren reemplazo o justificar la novedad.`,
      })
    }
    if (stats.ausentismo > 0) {
      const pctHc = headcountTotal > 0 ? Math.round((stats.ausentismo / headcountTotal) * 100) : null
      notas.push({
        tono: "warn",
        texto: `${stats.ausentismo} ausentismo(s) justificado(s) hoy${pctHc !== null ? ` (${stats.ausentismo} de ${headcountTotal} en Head Count, ${pctHc}%)` : ""} — ya sincronizados con Ausentismos.`,
      })
    }
    notas.push({
      tono: "ok",
      texto: "Las horas fuera del puesto asignado no generan hora extra sin aprobación previa (regla vigente en pagonomina).",
    })
    return notas
  }, [stats, headcountTotal])

  if (loading && data.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">Dashboard {isToday ? "del Día" : ""}</h2>
          <p className="text-sm text-muted-foreground capitalize">{formatDate(todayDate)}</p>
        </div>
        <div className="flex items-center gap-2">
          {isToday && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${realtimeOk ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
              {realtimeOk ? "en vivo" : "conectando…"}
            </span>
          )}
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <DatePickerField value={selectedDate} onChange={handleDateChange} className="h-8 w-40 text-xs" maxDate={getTodayColombia()} />
          </div>
          {!isToday && (
            <Button variant="outline" size="sm" onClick={handleGoToToday} className="gap-1 text-xs h-8">
              Hoy
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => loadData()} className="gap-1 h-8">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground -mt-3">
        Vista operativa — el personal administrativo se gestiona en <strong>Asistencia Administrativa</strong> (Compensación) y no
        aparece aquí.
        {headcountTotal > 0 && (
          <>
            {" "}
            · Head Count activo de este proyecto: <strong className="tabular-nums">{headcountTotal}</strong>
            {stats.ausentismo > 0 && (
              <>
                {" "}
                · Ausentismo:{" "}
                <strong className="tabular-nums">
                  {stats.ausentismo} de {headcountTotal} ({Math.round((stats.ausentismo / headcountTotal) * 100)}%)
                </strong>
              </>
            )}
          </>
        )}
      </p>

      {isToday && stats.sinReportar > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <p className="text-[13px] text-rose-700 dark:text-rose-400">
            <strong>{stats.sinReportar}</strong> {stats.sinReportar === 1 ? "persona programada no ha marcado" : "personas programadas no han marcado"}{" "}
            hoy — revisa "Marcaciones de hoy" (filtro "No presentado").
          </p>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Marcaciones hoy</p>
            <p className="text-2xl font-bold mt-1 tabular-nums">{stats.total}</p>
            <p className="text-[11px] text-muted-foreground mt-1">turnos y novedades del día · solo operativos</p>
          </CardContent>
        </Card>
        <Card className="border-b-4 border-b-emerald-500">
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">A tiempo</p>
            <p className="text-2xl font-bold mt-1 tabular-nums text-emerald-600">{stats.aTiempo}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{stats.pctCumplimiento}% de cumplimiento</p>
          </CardContent>
        </Card>
        <Card className="border-b-4 border-b-amber-500">
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Llegadas tarde</p>
            <p className="text-2xl font-bold mt-1 tabular-nums text-amber-600">{stats.tarde}</p>
            <p className="text-[11px] text-muted-foreground mt-1">generan novedad automática</p>
          </CardContent>
        </Card>
        <Card className={stats.sinReportar > 0 ? "border-b-4 border-b-rose-500" : "border-b-4 border-b-emerald-500"}>
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">No presentados</p>
            <p className={`text-2xl font-bold mt-1 tabular-nums ${stats.sinReportar > 0 ? "text-rose-600" : "text-emerald-600"}`}>
              {stats.sinReportar}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {stats.sinReportar > 0 ? "requieren reemplazo" : "nadie sin justificar hoy"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Columna izquierda */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2 space-y-2">
              <CardTitle className="text-sm">Marcaciones de hoy</CardTitle>
              <div className="flex flex-wrap gap-1.5">
                {ESTADO_FILTROS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFiltroEstado(f.value)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                      filtroEstado === f.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
                {marcacionesFiltradas.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    {marcaciones.length === 0 ? "No hay turnos programados para esta fecha." : "Nadie en este estado."}
                  </div>
                ) : (
                  marcacionesFiltradas.map((r) => {
                    const e = ESTADO_TXT[r.estado]
                    return (
                      <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-bold shrink-0">
                          {iniciales(r.nombre)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium truncate">{r.nombre}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {r.asistencia || r.puesto || "Sin puesto hoy"}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[13px] font-semibold tabular-nums">{r.horaingreso ? r.horaingreso.slice(0, 5) : "—"}</p>
                          <p className={`text-[11px] font-bold ${e.text}`}>{e.label}</p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          title="Registrar novedad"
                          onClick={() =>
                            setEditing({ id: r.id, identificacion: r.identificacion, fecha: r.fecha, nombre: r.nombre, asistencia: r.asistencia })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {ausentismoAcumulado.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Ausentismo acumulado · últimos 7 días</CardTitle>
                <CardDescription className="text-xs">Solo operativos, no cuenta días sin ausentismo real</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {ausentismoAcumulado.map((p, i) => (
                    <button
                      key={i}
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("lipgo:ver-ausentismos-persona", { detail: { identificacion: p.identificacion } }),
                        )
                      }
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/50 transition-colors"
                      title="Ver en Ausentismos"
                    >
                      <div className="h-5 w-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate">{p.nombre}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{p.motivos.join(" · ")}</p>
                      </div>
                      <span className="text-[10.5px] font-bold text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-full shrink-0">
                        {p.faltas}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Columna derecha */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Asistencia por puesto</CardTitle>
              <CardDescription className="text-xs">Cantidad de personal asignado hoy y su cumplimiento</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {porPuesto.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Sin puestos asignados hoy.</div>
              ) : (
                <div className="divide-y divide-border">
                  {porPuesto.map((g) => (
                    <div key={g.puesto} className="px-4 py-2.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[12.5px] font-semibold">{g.puesto}</span>
                        <span className="text-[10px] font-semibold text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                          {g.count} {g.count === 1 ? "persona" : "personas"}
                        </span>
                        <span className="flex-1" />
                        <span
                          className={`text-base font-bold tabular-nums ${g.pct >= 90 ? "text-emerald-600" : g.pct >= 75 ? "text-amber-600" : "text-rose-600"}`}
                        >
                          {g.pct}%
                        </span>
                      </div>
                      <div className="flex gap-0.5 mt-2">
                        {Array.from({ length: g.aTiempo }).map((_, i) => (
                          <div key={`a${i}`} className="flex-1 h-5 rounded bg-emerald-500/85" />
                        ))}
                        {Array.from({ length: g.tarde }).map((_, i) => (
                          <div key={`t${i}`} className="flex-1 h-5 rounded bg-amber-500/85" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="px-4 py-2 bg-muted/50 text-[10.5px] text-muted-foreground rounded-b-lg">
                Verde a tiempo · ámbar tarde
              </div>
            </CardContent>
          </Card>

          {horasExtraHoy.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Horas extra del día</CardTitle>
                <CardDescription className="text-xs">Solo aparece quien registró horas extra hoy</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {horasExtraHoy.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2">
                      <span className="text-[9px] font-bold text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
                        {r.puesto || "—"}
                      </span>
                      <p className="text-[12px] font-medium flex-1 truncate">{r.nombre}</p>
                      <span className="text-[11px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full tabular-nums shrink-0">
                        {r.total.toFixed(2)} h
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 bg-muted/50 text-[10.5px] text-muted-foreground rounded-b-lg">
                  Total del día: {totalHE.toFixed(1)} h
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Novedades detectadas automáticamente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {notasAutomaticas.map((n, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span
                    className={`h-4 w-4 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5 ${
                      n.tono === "warn" ? "bg-amber-500/15 text-amber-600" : "bg-emerald-500/15 text-emerald-600"
                    }`}
                  >
                    {n.tono === "warn" ? "!" : "✓"}
                  </span>
                  <p className="text-[12px] flex-1">{n.texto}</p>
                </div>
              ))}
              <p className="text-[10.5px] text-muted-foreground pt-2 border-t border-border mt-1">
                Cada diferencia entre lo programado y lo registrado queda anotada para revisión del supervisor.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Análisis histórico, plegable */}
      <div>
        <button
          onClick={() => setVerAnalisis((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {verAnalisis ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Ver análisis histórico
        </button>
        {verAnalisis && (
          <Card className="mt-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Tendencia de Asistencia · Últimos 7 Días</CardTitle>
              <CardDescription className="text-xs">Porcentaje de a tiempo/asistencia diaria</CardDescription>
            </CardHeader>
            <CardContent>
              {last7Trend.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={last7Trend}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <Tooltip labelFormatter={(v) => `Día ${v}`} formatter={(val: number) => [`${val}%`, "% Asistencia"]} />
                    <Line
                      type="monotone"
                      dataKey="pct"
                      name="% Asistencia"
                      stroke="hsl(200, 70%, 50%)"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: "hsl(200, 70%, 50%)" }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Sin datos suficientes</div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <EditNovedadDialog
        empresaId={selectedEmpresaId}
        registro={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => loadData()}
      />
    </div>
  )
}
