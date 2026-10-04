"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { useAuth } from "@/components/auth-provider"
import { getParos, type ParoComentario } from "@/lib/paros-actions"
import { getHorarioTolva, getHorarioTolvaPorFecha } from "@/lib/horario-tolva-actions"
import { detectarParosEnVentana, utcDateStr } from "@/lib/paros-produccion"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Award,
  Boxes,
  Calendar,
  Download,
  FileText,
  Frown,
  Gauge,
  Layers,
  MapPin,
  Meh,
  Package2,
  Radio,
  Search,
  Smile,
  Target,
  Timer,
  TrendingUp,
  TriangleAlert,
  Warehouse,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

// Fila cruda de `produccion` (usada por las pestanias Mensual/Anual que
// agregan en cliente sobre la tabla base).
interface ProduccionRow {
  id: number
  fecha_hora: string
  producto: number
  bodega: number | null
  localizacion: number | null
  tipo_empaque: string | null
  lote: number | null
  bultos_procesados: number | null
  averias: number | null
}

// Vista `vw_produccion_dashboard`: una fila por registro, ya enriquecida
// en PostgreSQL con el nombre del producto, el intervalo de 10 min, los
// minutos transcurridos desde el registro anterior y la bandera de parada.
interface VwDashboardRow {
  id: number
  fecha_hora: string
  producto_nombre: string | null
  tipo_empaque: string | null
  lote: number | null
  bultos_procesados: number | null
  averias: number | null
  intervalo_10m: string | null
  minutos_desde_anterior: number | null
  alerta_parada: boolean | null
}

// Vista `vw_produccion_agrupada_10m`: una fila por cubeta de 10 min, ya
// agregada en SQL. Alimenta los KPIs y el grafico de la linea de tiempo.
interface VwAgrupada10mRow {
  intervalo: string
  total_bultos: number | null
  total_averias: number | null
  total_estibas: number | null
  bultos_arrume: number | null
}

// `historial_intervalos`: lectura cada 2 min del contador de la maquina.
// `bultos_dia_acumulado` = contador acumulado del dia; `produccion_2min` =
// unidades producidas en ese intervalo (0 = maquina parada).
interface HistorialRow {
  fecha_hora: string
  bultos_dia_acumulado: number | null
  produccion_2min: number | null
}

// Mostramos la hora EXACTA almacenada en los timestamptz sin convertir a
// la zona de Colombia: formateamos en UTC para que los digitos coincidan
// con los del valor guardado (sin restar las 5 horas).
const HORA_FMT = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
})

// Umbral de parada de linea (minutos). Por encima, el cronometro de
// inactividad entra en estado critico (rojo).
const DOWNTIME_THRESHOLD_MIN = 45

// Turno POR DEFECTO (respaldo). El turno real del dia se lee de
// registroasistencia (puesto "Auxiliar Mixto") y es dinamico.
const DEFAULT_SHIFT_START_HOUR = 6
const DEFAULT_SHIFT_END_HOUR = 20

// Cada celda de cobertura = 1 intervalo de 2 min del contador de la maquina.
const BUCKET_MIN = 2

// Hora (literal) en la que arranca el eje X del grafico de velocidad. Coincide
// con el inicio del turno por defecto (DEFAULT_SHIFT_START_HOUR).
/** "HH:MM" (o "HH:MM:SS") -> minutos desde medianoche. null si no parsea. */
function horaAMinutos(t: string | null | undefined): number | null {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** Minutos desde medianoche -> "HH:MM". */
function minutosAHora(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`
}

// Reglas de ritmo: meta de bultos por hora y meta de velocidad por
// intervalo de 2 min (unidades producidas en cada lectura del contador).
const META_POR_HORA = 240
const META_2MIN = 10

// Colores (variables CSS del tema) para los estados de pacing.
const PACE_COLOR: Record<"good" | "warn" | "bad", string> = {
  good: "var(--chart-3)",
  warn: "var(--chart-4)",
  bad: "var(--destructive)",
}

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]
const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

// Paleta para el Product Mix (pie chart), tomada de los tokens de marca.
const PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-secondary)",
  "var(--color-primary)",
  "var(--color-destructive)",
]

// Fecha (YYYY-MM-DD) del dia actual en UTC. La usamos para el filtro
// "hoy" porque mostramos la hora literal del timestamptz (en UTC), de
// modo que el limite del dia coincida con los digitos que se ven.
// `utcDateStr` ya NO se define aqui: vive en lib/paros-produccion.ts y se
// importa arriba. Habia dos copias con criterios DISTINTOS --esta en hora de
// Colombia, la otra en UTC-- y Reporte de Paros usaba la otra: despues de las
// 19:00 los dos modulos creian estar en dias diferentes.

// Dado un YYYY-MM-DD devuelve el dia siguiente en el mismo formato.
// Lo usamos para construir el limite superior [desde, hasta) del filtro
// por dia sin depender de la zona horaria local.
function nextDateStr(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(next)
}

// Convierte un instante real a milisegundos en el marco del eje, que usa
// la "hora literal" (UTC). Tomamos la hora de pared de Bogota y la
// reinterpretamos como UTC para que el corte de "ahora" coincida con la
// hora visible y las cubetas futuras no se pinten como parada.
function bogotaWallAsUtcMs(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  // "24" puede aparecer a medianoche en algunos motores; lo normalizamos.
  const hour = get("hour") === "24" ? "00" : get("hour")
  return Date.parse(
    `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}Z`,
  )
}

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

// Formatea minutos como "Xh YYm" (o "Ym" si es menos de una hora).
function fmtMinutos(min: number) {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${pad2(m % 60)}m` : `${m}m`
}

// Parseo robusto de un timestamptz de Supabase a Date (instante UTC).
// Normaliza variantes que algunos navegadores no parsean bien:
//  - separador con espacio en lugar de "T" ("2026-06-08 14:30:00+00")
//  - offset corto de 2 digitos ("+00" / "-05" -> "+00:00" / "-05:00")
// Si el valor no trae zona horaria, se asume UTC.
function parseTs(value: string): Date {
  if (!value) return new Date(NaN)
  let s = value.trim().replace(" ", "T")
  const tzMatch = s.match(/([+-]\d{2}(:?\d{2})?|Z)$/)
  if (!tzMatch) {
    s = `${s}Z`
  } else if (/[+-]\d{2}$/.test(s)) {
    s = `${s}:00`
  }
  return new Date(s)
}

// Rango [inicio, fin) en zona Bogota para un mes dado (mes 0-11).
function monthRange(year: number, month: number) {
  const start = `${year}-${pad2(month + 1)}-01T00:00:00-05:00`
  const ny = month === 11 ? year + 1 : year
  const nm = month === 11 ? 0 : month + 1
  const end = `${ny}-${pad2(nm + 1)}-01T00:00:00-05:00`
  return { start, end }
}

// Rango [inicio, fin) en zona Bogota para un anio completo.
function yearRange(year: number) {
  return {
    start: `${year}-01-01T00:00:00-05:00`,
    end: `${year + 1}-01-01T00:00:00-05:00`,
  }
}

function isEstiba(t: string | null) {
  return (t || "").trim().toLowerCase() === "estiba"
}
function isArrume(t: string | null) {
  return (t || "").trim().toLowerCase() === "arrume"
}

// Dia del mes (1-31) en zona Bogota desde un timestamp.
function bogotaDay(iso: string) {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    day: "2-digit",
  }).format(parseTs(iso))
  return Number(s)
}

// Mes (0-11) en zona Bogota desde un timestamp.
function bogotaMonth(iso: string) {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    month: "2-digit",
  }).format(parseTs(iso))
  return Number(s) - 1
}

// Estilo comun del tooltip de Recharts usando los tokens de marca.
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--color-popover-foreground)",
}

export default function ControlPiso() {
  // Diccionario de productos compartido por las pestanias Mensual/Anual
  // (que agregan sobre la tabla base `produccion`). La pestania En Vivo
  // ya recibe el nombre desde la vista SQL.
  const [productos, setProductos] = useState<Record<number, string>>({})

  useEffect(() => {
    let active = true
    supabase
      .from("productos")
      .select("id, nombre")
      .then(({ data }) => {
        if (!active) return
        const dict: Record<number, string> = {}
        for (const p of (data as { id: number; nombre: string }[]) || []) {
          dict[p.id] = p.nombre
        }
        setProductos(dict)
      })
    return () => {
      active = false
    }
  }, [])

  const nombreProducto = (id: number) => productos[id] || `Producto ${id}`

  return (
    <div className="min-h-full bg-background p-4 text-foreground md:p-6">
      <div className="space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-3 lg-card p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/30">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-card-foreground">Dashboard de Producción</h1>
              <p className="text-sm text-muted-foreground">
                Disponibilidad operativa y ritmo de planta en tiempo real
              </p>
            </div>
          </div>
        </header>

        <Tabs defaultValue="vivo" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-muted md:w-auto md:inline-grid">
            <TabsTrigger value="vivo" className="data-[state=active]:bg-card data-[state=active]:text-primary">
              En Vivo
            </TabsTrigger>
            <TabsTrigger value="mensual" className="data-[state=active]:bg-card data-[state=active]:text-primary">
              Resumen Mensual
            </TabsTrigger>
            <TabsTrigger value="anual" className="data-[state=active]:bg-card data-[state=active]:text-primary">
              Resumen Anual
            </TabsTrigger>
            <TabsTrigger value="reporte" className="data-[state=active]:bg-card data-[state=active]:text-primary">
              Reporte
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vivo" className="mt-6">
            <LiveTab />
          </TabsContent>
          <TabsContent value="mensual" className="mt-6">
            <MonthlyTab nombreProducto={nombreProducto} />
          </TabsContent>
          <TabsContent value="anual" className="mt-6">
            <AnnualTab nombreProducto={nombreProducto} />
          </TabsContent>
          <TabsContent value="reporte" className="mt-6">
            <ReportTab nombreProducto={nombreProducto} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* TAB 1: EN VIVO (HOY) — alimentado por vistas SQL                    */
/* ------------------------------------------------------------------ */

function LiveTab() {
  const [dashRows, setDashRows] = useState<VwDashboardRow[]>([])
  const [aggRows, setAggRows] = useState<VwAgrupada10mRow[]>([])
  const [histRows, setHistRows] = useState<HistorialRow[]>([])
  const [loading, setLoading] = useState(true)
  const [realtimeOk, setRealtimeOk] = useState(false)
  // Dia seleccionado (YYYY-MM-DD en hora literal/UTC). Por defecto HOY.
  // Permite navegar hacia atras para ver el tablero de dias anteriores.
  const [selectedDate, setSelectedDate] = useState<string>(() => utcDateStr())
  const isToday = selectedDate === utcDateStr()
  // Reloj de alta frecuencia (cada segundo) para los cronometros vivos.
  const [now, setNow] = useState<Date>(() => new Date())
  // Turno DINAMICO leido de registroasistencia (puesto "Auxiliar Mixto").
  // Respaldo a los defaults si el dia no tiene turno programado valido.
  const [shiftStart, setShiftStart] = useState<number>(DEFAULT_SHIFT_START_HOUR)
  const [shiftEnd, setShiftEnd] = useState<number>(DEFAULT_SHIFT_END_HOUR)
  // Si los turnos programados del dia existen de verdad o si shiftStart/shiftEnd
  // se quedaron en el valor por defecto. Sirve para decirle al usuario de donde
  // salio la ventana con la que se estan calculando sus numeros.
  const [hayTurnoProgramado, setHayTurnoProgramado] = useState(false)
  // Paros comentados (desde el módulo Reporte de Paros) para reflejarlos aquí.
  const { selectedEmpresaId } = useAuth()
  const [parosComentados, setParosComentados] = useState<Record<string, ParoComentario>>({})
  // Horario de Tolva del dia, tomado de lo que se configura en Programacion de
  // turnos. Es la PRIMERA opcion para la ventana del tablero (ver `ventana`).
  //
  // Guarda tambien POR QUE no se pudo usar cuando ese es el caso: antes solo
  // guardaba la ventana o null, y "no hay horario configurado" tapaba por igual
  // tres situaciones muy distintas -- que de verdad no exista, que exista bajo
  // otro proyecto, o que la consulta haya fallado. Sin esa distincion, el
  // tablero calculaba contra un rango supuesto sin manera de saberlo.
  const [tolva, setTolva] = useState<{
    ventana: { desdeMin: number; hastaMin: number } | null
    estado: "cargando" | "ok" | "sin-configurar" | "incompleto" | "ambiguo" | "error"
    detalle?: string
  }>({ ventana: null, estado: "cargando" })
  const ventanaTolva = tolva.ventana

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Trae el dia seleccionado desde ambas vistas. Reutilizable: el realtime
  // la invoca para re-leer los datos ya calculados por PostgreSQL tras cada
  // INSERT (solo relevante cuando se mira HOY).
  const loadViews = useCallback(async () => {
    try {
      const desde = `${selectedDate}T00:00:00Z`
      const hasta = `${nextDateStr(selectedDate)}T00:00:00Z`
      const [dashRes, aggRes] = await Promise.all([
        supabase
          .from("vw_produccion_dashboard")
          .select(
            "id, fecha_hora, producto_nombre, tipo_empaque, lote, bultos_procesados, averias, intervalo_10m, minutos_desde_anterior, alerta_parada",
          )
          .gte("fecha_hora", desde)
          .lt("fecha_hora", hasta)
          .order("fecha_hora", { ascending: true }),
        supabase
          .from("vw_produccion_agrupada_10m")
          .select("intervalo, total_bultos, total_averias, total_estibas, bultos_arrume")
          .gte("intervalo", desde)
          .lt("intervalo", hasta)
          .order("intervalo", { ascending: true }),
      ])
      if (dashRes.error) console.log("[v0] Control Piso vw_dashboard error:", dashRes.error.message)
      if (aggRes.error) console.log("[v0] Control Piso vw_agrupada error:", aggRes.error.message)
      setDashRows(((dashRes.data as VwDashboardRow[]) || []).filter(Boolean))
      setAggRows(((aggRes.data as VwAgrupada10mRow[]) || []).filter(Boolean))
    } catch (e: any) {
      console.log("[v0] Control Piso loadViews exception:", e?.message)
    }
  }, [selectedDate])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      await loadViews()
      if (active) setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [loadViews])

  // Contador de la maquina cada 2 min (historial_intervalos). El rango se arma
  // en HORA LITERAL (UTC), igual que se almacena fecha_hora (hora de pared de
  // Colombia etiquetada como UTC). Así capturamos exactamente el día calendario
  // sin arrastrar registros de la madrugada del día siguiente.
  const loadHistorial = useCallback(async () => {
    try {
      const desde = `${selectedDate}T00:00:00Z`
      const hasta = `${nextDateStr(selectedDate)}T00:00:00Z`
      const { data, error } = await supabase
        .from("historial_intervalos")
        .select("fecha_hora, bultos_dia_acumulado, produccion_2min")
        .gte("fecha_hora", desde)
        .lt("fecha_hora", hasta)
        .order("fecha_hora", { ascending: true })
      if (error) console.log("[v0] Control Piso historial error:", error.message)
      setHistRows(((data as HistorialRow[]) || []).filter(Boolean))
    } catch (e: any) {
      console.log("[v0] Control Piso historial exception:", e?.message)
    }
  }, [selectedDate])

  useEffect(() => {
    let active = true
    loadHistorial()
    // Solo refresca en vivo (cada 30 s) cuando se mira HOY.
    if (!isToday) {
      return () => {
        active = false
      }
    }
    const t = setInterval(() => {
      if (active) loadHistorial()
    }, 30000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [loadHistorial, isToday])

  // HORARIO DE TOLVA del día (Programación de turnos → "Horario de Tolva").
  //
  // Lee el Horario de Tolva del día: arranca en la hora de INICIO del Turno 1 y
  // termina en la hora de FIN más tardía entre Turno 1 y Turno 2. Es la jornada
  // real de la tolva, definida por quien programa los turnos.
  //
  // Se busca primero por el proyecto seleccionado. Si ahí no hay nada —o si no
  // hay proyecto seleccionado— se busca el horario de esa FECHA en cualquier
  // proyecto: el horario se guarda por (fecha, empresa, turno), así que
  // configurarlo con un proyecto y mirar el tablero con otro dejaba la jornada
  // sin acotar en silencio. Si varios proyectos tienen horario ese día no se
  // adivina: se avisa y se pide elegir.
  useEffect(() => {
    let active = true
    setTolva({ ventana: null, estado: "cargando" })

    /** Convierte turno1/turno2 en la ventana, o dice por qué no pudo. */
    const aVentana = (d: { turno1: { horaInicio: string | null; horaFin: string | null }; turno2: { horaInicio: string | null; horaFin: string | null } }) => {
      // Si el Turno 1 no está configurado se usa el inicio del Turno 2: es
      // preferible acotar por lo que sí se definió a ignorar el horario entero.
      const desdeMin = horaAMinutos(d.turno1.horaInicio) ?? horaAMinutos(d.turno2.horaInicio)
      const fines = [horaAMinutos(d.turno1.horaFin), horaAMinutos(d.turno2.horaFin)].filter(
        (m): m is number => m != null,
      )
      const hastaMin = fines.length > 0 ? Math.max(...fines) : null
      if (desdeMin == null || hastaMin == null) return null
      if (hastaMin <= desdeMin) return null
      return { desdeMin, hastaMin }
    }

    ;(async () => {
      if (selectedEmpresaId) {
        const r = await getHorarioTolva(selectedEmpresaId, selectedDate)
        if (!active) return
        if (r.success && r.data) {
          const v = aVentana(r.data)
          if (v) {
            setTolva({ ventana: v, estado: "ok" })
            return
          }
          // Hay fila(s) pero sin horas utilizables (o fin antes que inicio).
          const algo = r.data.turno1.horaInicio || r.data.turno1.horaFin || r.data.turno2.horaInicio || r.data.turno2.horaFin
          if (algo) {
            setTolva({ ventana: null, estado: "incompleto" })
            return
          }
        } else if (!r.success) {
          setTolva({ ventana: null, estado: "error", detalle: r.message })
          return
        }
      }

      // Sin proyecto, o el proyecto seleccionado no tiene horario ese día.
      const f = await getHorarioTolvaPorFecha(selectedDate)
      if (!active) return
      if (f.estado === "ok" && f.data) {
        const v = aVentana(f.data)
        if (v) {
          setTolva({
            ventana: v,
            estado: "ok",
            detalle: selectedEmpresaId ? `configurado en el proyecto ${f.data.idempresa}` : undefined,
          })
          return
        }
        setTolva({ ventana: null, estado: "incompleto" })
        return
      }
      if (f.estado === "ambiguo") {
        setTolva({
          ventana: null,
          estado: "ambiguo",
          detalle: `hay horario en los proyectos ${(f.empresas ?? []).join(", ")}`,
        })
        return
      }
      if (f.estado === "error") {
        setTolva({ ventana: null, estado: "error", detalle: f.message })
        return
      }
      setTolva({ ventana: null, estado: "sin-configurar" })
    })()

    return () => {
      active = false
    }
  }, [selectedDate, selectedEmpresaId])

  // Paros comentados del día (Reporte de Paros) para reflejarlos en la cobertura.
  useEffect(() => {
    let active = true
    getParos(selectedEmpresaId ?? null, selectedDate).then((r) => {
      if (!active) return
      const map: Record<string, ParoComentario> = {}
      if (r.success) for (const c of r.data) map[c.inicio] = c
      setParosComentados(map)
    })
    return () => {
      active = false
    }
  }, [selectedDate, selectedEmpresaId])

  // Turno dinamico: ventana de cobertura del dia con puesto "Auxiliar Mixto".
  // Con Turno 1 + Turno 2 (registroasistencia.turno) puede haber varias filas
  // el mismo dia, cada una con su propio horario -> se toma el MINIMO de
  // horaentradaprogramada y el MAXIMO de horasalidaprogramada entre TODAS las
  // filas del dia (antes solo se leia la primera fila, quedando ciego al 2do
  // turno). Si no hay filas o son invalidas, se usan los defaults (6-20).
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from("registroasistencia")
          .select("horaentradaprogramada, horasalidaprogramada")
          .eq("fecha", selectedDate)
          .eq("puesto", "Auxiliar Mixto")
        if (!active) return
        const parseHora = (v: any): number | null => {
          const m = String(v ?? "").match(/^(\d{1,2}):/)
          if (!m) return null
          const h = Number(m[1])
          return h >= 0 && h <= 23 ? h : null
        }
        let ini: number | null = null
        let fin: number | null = null
        if (!error) {
          for (const row of data ?? []) {
            const i = parseHora(row?.horaentradaprogramada)
            const f = parseHora(row?.horasalidaprogramada)
            if (i != null) ini = ini == null ? i : Math.min(ini, i)
            if (f != null) fin = fin == null ? f : Math.max(fin, f)
          }
        }
        if (ini != null && fin != null && fin > ini) {
          setShiftStart(ini)
          setShiftEnd(fin)
          setHayTurnoProgramado(true)
        } else {
          setShiftStart(DEFAULT_SHIFT_START_HOUR)
          setShiftEnd(DEFAULT_SHIFT_END_HOUR)
          setHayTurnoProgramado(false)
        }
      } catch (e: any) {
        console.log("[v0] Control Piso turno exception:", e?.message)
      }
    })()
    return () => {
      active = false
    }
  }, [selectedDate])

  // Realtime: ante un INSERT en la tabla base, re-leemos las vistas y el
  // historial. Solo tiene sentido cuando se mira HOY.
  useEffect(() => {
    if (!isToday) {
      setRealtimeOk(false)
      return
    }
    const channel = supabase
      .channel("control-piso-produccion")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "produccion" },
        () => {
          loadViews()
          loadHistorial()
        },
      )
      .subscribe((status) => {
        setRealtimeOk(status === "SUBSCRIBED")
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadViews, loadHistorial, isToday])

  // LA VENTANA DEL DIA. Es el unico rango de tiempo del tablero: de aqui salen
  // la velocidad cada 2 min, la cobertura, el cumplimiento hora a hora, la meta
  // dinamica, los paros, la disponibilidad y el OEE.
  //
  // Manda el HORARIO DE TOLVA: desde la hora de inicio del Turno 1 hasta la
  // hora de fin del Turno 2. Es la jornada real de la tolva, y es lo que hace
  // que la disponibilidad y el OEE midan la operacion y no las horas en que la
  // planta simplemente estaba cerrada -- el contador registra las 24 horas, asi
  // que sin acotar, cada hora sin turno entra al calculo como tiempo parado.
  //
  // Si el dia no tiene horario de tolva configurado se cae a los turnos
  // programados del personal, y si tampoco los hay, al horario por defecto.
  const ventana = useMemo(() => {
    if (ventanaTolva) {
      return { desdeMin: ventanaTolva.desdeMin, hastaMin: ventanaTolva.hastaMin, origen: "tolva" as const }
    }
    return {
      desdeMin: shiftStart * 60,
      hastaMin: shiftEnd * 60,
      origen: hayTurnoProgramado ? ("turnos" as const) : ("defecto" as const),
    }
  }, [ventanaTolva, shiftStart, shiftEnd, hayTurnoProgramado])

  // Horas de la ventana, con decimales: una jornada 06:30-17:45 son 11,25 h, no
  // 11 ni 12. La meta del dia se calcula sobre esto.
  const horasTurno = Math.max((ventana.hastaMin - ventana.desdeMin) / 60, 0)
  const metaDia = META_POR_HORA * horasTurno

  /** Instante (ms) de un minuto de la ventana dentro del dia seleccionado. */
  const msDelDia = useCallback(
    (min: number) =>
      Date.parse(`${selectedDate}T${pad2(Math.floor(min / 60))}:${pad2(min % 60)}:00Z`),
    [selectedDate],
  )

  const ventanaTexto = `${minutosAHora(ventana.desdeMin)} – ${minutosAHora(ventana.hastaMin)}`

  // KPIs del dia: suma de la vista agrupada de 10 min.
  const metrics = useMemo(() => {
    let totalBultos = 0
    let estibas = 0
    let arrume = 0
    let averias = 0
    for (const a of aggRows) {
      totalBultos += a.total_bultos || 0
      estibas += a.total_estibas || 0
      arrume += a.bultos_arrume || 0
      averias += a.total_averias || 0
    }
    return { totalBultos, estibas, arrume, averias }
  }, [aggRows])

  // Ultimo registro del contador (para el estado de maquina en vivo).
  const ultimoHist = histRows.length ? histRows[histRows.length - 1] : null
  // Total producido del dia: el contador `bultos_dia_acumulado` sube durante el
  // dia y se REINICIA a 0 al cierre, por lo que NO se puede usar el ULTIMO
  // registro (al ver un dia ya cerrado quedaria en 0 y el rendimiento/OEE en 0).
  // Usamos el MAXIMO del dia (el pico = total producido); si no hay historial,
  // caemos a la suma de la vista agrupada.
  const maxAcumHist = histRows.reduce((m, h) => Math.max(m, h.bultos_dia_acumulado || 0), 0)
  const totalBultosDisplay = maxAcumHist > 0 ? maxAcumHist : metrics.totalBultos

  // Cronometro de inactividad: tiempo transcurrido desde el ultimo
  // registro (max fecha_hora) hasta el reloj actual, en min + seg.
  const inactividad = useMemo(() => {
    if (dashRows.length === 0) {
      return { hayDatos: false, totalSeg: 0, min: 0, seg: 0, ultimo: null as Date | null }
    }
    const ultimo = parseTs(dashRows[dashRows.length - 1].fecha_hora)
    // `fecha_hora` se guarda como hora de pared de Bogota etiquetada como UTC,
    // por lo que comparamos contra la hora de pared actual de Bogota (tambien
    // reinterpretada como UTC) para evitar el desfase del offset horario.
    const totalSeg = Math.max(0, Math.floor((bogotaWallAsUtcMs(now) - ultimo.getTime()) / 1000))
    return { hayDatos: true, totalSeg, min: Math.floor(totalSeg / 60), seg: totalSeg % 60, ultimo }
  }, [dashRows, now])

  // Estado de la maquina (solo HOY y con historial): PARADA cuando el ultimo
  // intervalo de 2 min produjo 0. El cronometro corre desde ese instante real.
  const maquina = useMemo(() => {
    if (!isToday || !ultimoHist) return null
    const parada = (ultimoHist.produccion_2min || 0) === 0
    const instante = parseTs(ultimoHist.fecha_hora)
    const totalSeg = Math.max(0, Math.floor((bogotaWallAsUtcMs(now) - instante.getTime()) / 1000))
    return {
      parada,
      estado: parada ? "PARADA" : "PRODUCIENDO",
      min: Math.floor(totalSeg / 60),
      seg: totalSeg % 60,
      ultima: instante,
    }
  }, [isToday, ultimoHist, now])

  // Resumen del dia agregado por producto: total de bultos, averias y
  // desglose de bultos segun empaque (Estiba vs Arrume). Ordenado de
  // mayor a menor por bultos procesados.
  const productResumen = useMemo(() => {
    const map = new Map<
      string,
      { producto: string; bultos: number; averias: number; estiba: number; arrume: number }
    >()
    for (const r of dashRows) {
      const nombre = r.producto_nombre || "Sin nombre"
      const cur =
        map.get(nombre) || { producto: nombre, bultos: 0, averias: 0, estiba: 0, arrume: 0 }
      const bultos = r.bultos_procesados || 0
      cur.bultos += bultos
      cur.averias += r.averias || 0
      if (isEstiba(r.tipo_empaque)) cur.estiba += bultos
      else cur.arrume += bultos
      map.set(nombre, cur)
    }
    return [...map.values()].sort((a, b) => b.bultos - a.bultos)
  }, [dashRows])

  // Meta dinamica (pacing): horas transcurridas de la JORNADA DE TOLVA x meta
  // por hora. Los procesados usan el acumulado del contador cuando esta
  // disponible.
  const pacing = useMemo(() => {
    const inicio = msDelDia(ventana.desdeMin)
    const nowMs = isToday ? bogotaWallAsUtcMs(now) : msDelDia(ventana.hastaMin)
    const horasTranscurridas = Math.min(Math.max((nowMs - inicio) / 3_600_000, 0), horasTurno)
    const metaActual = Math.round(horasTranscurridas * META_POR_HORA)
    const procesados = totalBultosDisplay
    const pct = metaActual > 0 ? (procesados / metaActual) * 100 : procesados > 0 ? 100 : 0
    const estado: "good" | "warn" | "bad" = pct >= 95 ? "good" : pct >= 80 ? "warn" : "bad"
    return { metaActual, procesados, pct, estado, horasTranscurridas }
  }, [now, totalBultosDisplay, isToday, msDelDia, ventana, horasTurno])

  // Cumplimiento hora a hora: fuente primaria el historial (produccion_2min
  // por hora literal); si no hay historial, respaldo a la vista agrupada.
  const hourly = useMemo(() => {
    // Se muestran las horas que TOCA la ventana. Si la jornada arranca 06:30, la
    // barra de las 06 existe pero solo acumula lo producido de 06:30 en
    // adelante: se cuenta por minuto exacto, no por hora completa.
    const primeraHora = Math.floor(ventana.desdeMin / 60)
    const ultimaHora = Math.ceil(ventana.hastaMin / 60)
    const dentro = (d: Date) => {
      const m = d.getUTCHours() * 60 + d.getUTCMinutes()
      return m >= ventana.desdeMin && m <= ventana.hastaMin
    }
    const buckets = new Map<number, number>()
    for (let h = primeraHora; h < ultimaHora; h++) buckets.set(h, 0)
    if (histRows.length > 0) {
      for (const h of histRows) {
        const d = parseTs(h.fecha_hora)
        if (!dentro(d)) continue
        const hora = d.getUTCHours()
        if (buckets.has(hora)) buckets.set(hora, (buckets.get(hora) || 0) + (h.produccion_2min || 0))
      }
    } else {
      for (const a of aggRows) {
        const d = parseTs(a.intervalo)
        if (!dentro(d)) continue
        const hora = d.getUTCHours()
        if (buckets.has(hora)) buckets.set(hora, (buckets.get(hora) || 0) + (a.total_bultos || 0))
      }
    }
    return [...buckets.entries()].map(([h, bultos]) => ({ hora: `${pad2(h)}:00`, bultos }))
  }, [histRows, aggRows, ventana])

  // Cobertura del turno: una celda por cubeta de 2 min dentro de la JORNADA DE
  // TOLVA. Fuente: el contador (historial_intervalos) sumado por bucket
  // con el instante literal. Corte de "ahora" = instante del ultimo registro
  // (o fin de turno en dias pasados). Verde = produjo, rojo = parada, gris =
  // aun por venir.
  const coverage = useMemo(() => {
    const bucketMs = BUCKET_MIN * 60000
    const prodPorBucket = new Map<number, number>()
    for (const h of histRows) {
      const t = parseTs(h.fecha_hora).getTime()
      const start = t - (t % bucketMs)
      prodPorBucket.set(start, (prodPorBucket.get(start) || 0) + (h.produccion_2min || 0))
    }
    const base = msDelDia(ventana.desdeMin)
    // `ceil` y no `floor`: con una ventana que no es multiplo de 2 min, redondear
    // hacia abajo dejaria el ultimo tramo sin celda y la disponibilidad saldria
    // mejor de lo real. Es preferible que el ultimo minuto se mire de mas.
    const totalBuckets = Math.max(0, Math.ceil((ventana.hastaMin - ventana.desdeMin) / BUCKET_MIN))
    const ultimoInst = histRows.length
      ? parseTs(histRows[histRows.length - 1].fecha_hora).getTime()
      : null
    const nowMs = isToday ? ultimoInst ?? bogotaWallAsUtcMs(now) : msDelDia(ventana.hastaMin)
    const cells: { start: number; label: string; status: "active" | "down" | "future" }[] = []
    for (let i = 0; i < totalBuckets; i++) {
      const start = base + i * bucketMs
      let status: "active" | "down" | "future"
      if (start > nowMs) status = "future"
      else if ((prodPorBucket.get(start) || 0) > 0) status = "active"
      else status = "down"
      cells.push({ start, label: HORA_FMT.format(new Date(start)), status })
    }
    return cells
  }, [histRows, now, isToday, msDelDia, ventana])

  // Overlay de paros comentados: marca de tiempo (bucket) → justificada + motivo.
  const { comentadoStarts, motivoPorStart } = useMemo(() => {
    const starts = new Set<number>()
    const motivos = new Map<number, string>()
    const bucketMs = BUCKET_MIN * 60000
    for (const c of Object.values(parosComentados)) {
      if (!c.motivo || !c.inicio || !c.fin) continue
      const ini = parseTs(c.inicio).getTime()
      const fin = parseTs(c.fin).getTime()
      for (let t = ini; t < fin; t += bucketMs) {
        starts.add(t)
        motivos.set(t, c.motivo)
      }
    }
    return { comentadoStarts: starts, motivoPorStart: motivos }
  }, [parosComentados])

  // Consolidado de paros del turno: cuantos son, cuantos estan justificados y
  // --sobre todo-- CUANTOS MINUTOS pesa cada grupo.
  //
  // El conteo de paros solo no dice nada: veinte microparos de 2 min y un paro
  // de 40 son "20 vs 1" pero pesan lo mismo. Lo que se responde ante gerencia
  // es cuanto tiempo de maquina se perdio y que parte de ese tiempo nadie
  // explico.
  //
  // "Sin justificar" = franja detectada por el contador que NO tiene un
  // comentario con motivo en paros_produccion. Se cruza por `inicioISO`, que es
  // la clave de la franja.
  const parosResumen = useMemo(() => {
    const ultimoInst = histRows.length ? parseTs(histRows[histRows.length - 1].fecha_hora).getTime() : null
    const nowMs = isToday ? ultimoInst ?? bogotaWallAsUtcMs(now) : msDelDia(ventana.hastaMin)
    const lista = detectarParosEnVentana(
      histRows, selectedDate, ventana.desdeMin, ventana.hastaMin, nowMs,
    )

    let comentados = 0
    let minutosTotal = 0
    let minutosComentados = 0
    // Minutos justificados agrupados por categoria, para saber en que se va el
    // tiempo y no solo cuanto se va.
    const porCategoria = new Map<string, { minutos: number; conteo: number }>()
    // El paro sin justificar mas largo: es el que primero hay que explicar.
    let mayorSinJustificar: { inicio: string; fin: string; minutos: number } | null = null

    for (const p of lista) {
      minutosTotal += p.minutos
      const c = parosComentados[p.inicioISO]
      if (c?.motivo) {
        comentados++
        minutosComentados += p.minutos
        const cat = (c.categoria || "Sin categoría").trim() || "Sin categoría"
        const acc = porCategoria.get(cat) ?? { minutos: 0, conteo: 0 }
        acc.minutos += p.minutos
        acc.conteo++
        porCategoria.set(cat, acc)
      } else if (!mayorSinJustificar || p.minutos > mayorSinJustificar.minutos) {
        mayorSinJustificar = { inicio: p.inicio, fin: p.fin, minutos: p.minutos }
      }
    }

    const minutosSinJustificar = minutosTotal - minutosComentados
    return {
      total: lista.length,
      comentados,
      sinComentar: lista.length - comentados,
      minutosTotal,
      minutosComentados,
      minutosSinJustificar,
      // Cuanto del tiempo perdido quedo sin explicacion. Es el numero que
      // importa: 200 minutos de paro con el 90% justificado es una operacion
      // bajo control; con el 10%, no.
      pctSinJustificar: minutosTotal > 0 ? Math.round((minutosSinJustificar / minutosTotal) * 100) : 0,
      porCategoria: [...porCategoria.entries()]
        .map(([categoria, v]) => ({ categoria, ...v }))
        .sort((a, b) => b.minutos - a.minutos),
      mayorSinJustificar,
    }
  }, [histRows, now, isToday, selectedDate, msDelDia, ventana, parosComentados])

  // Velocidad de produccion: un punto por lectura de 2 min del contador, dentro
  // de la MISMA ventana que usa todo el tablero (ver `ventana`): del inicio del
  // Turno 1 al fin del Turno 2 segun el Horario de Tolva.
  //
  // El acote existe porque el contador registra las 24 HORAS: sin el, el eje X
  // nace a las 00:00 y la jornada real queda comprimida contra el borde derecho.
  //
  // `fueraDeVentana` cuenta las lecturas CON PRODUCCION que quedaron afuera. No
  // se ocultan en silencio: la pantalla lo advierte, porque produccion fuera del
  // horario de tolva es justo lo que alguien querria saber.
  //
  // Los contadores de "intervalos en meta" se calculan sobre lo que se GRAFICA,
  // para que el ratio no cargue los ceros de las horas sin turno.
  const velocidad = useMemo(() => {
    const minutosLiteral = (h: HistorialRow) => {
      const d = parseTs(h.fecha_hora)
      return d.getUTCHours() * 60 + d.getUTCMinutes()
    }
    const dentro = (m: number) => m >= ventana.desdeMin && m <= ventana.hastaMin

    const puntos = histRows
      .filter((h) => dentro(minutosLiteral(h)))
      .map((h) => ({
        hora: HORA_FMT.format(parseTs(h.fecha_hora)),
        unidades: h.produccion_2min || 0,
      }))
    const fueraDeVentana = histRows.filter(
      (h) => (h.produccion_2min || 0) > 0 && !dentro(minutosLiteral(h)),
    ).length
    const cumplidos = puntos.filter((p) => p.unidades >= META_2MIN).length
    return { puntos, cumplidos, total: puntos.length, fueraDeVentana }
  }, [histRows, ventana])

  // Disponibilidad = tiempo trabajando vs parado (cada celda = 2 min).
  const disponibilidad = useMemo(() => {
    let activas = 0
    let down = 0
    for (const c of coverage) {
      if (c.status === "active") activas++
      else if (c.status === "down") down++
    }
    const minTrabajando = activas * BUCKET_MIN
    const minParada = down * BUCKET_MIN
    const minProgramado = minTrabajando + minParada
    const pct = minProgramado > 0 ? (minTrabajando / minProgramado) * 100 : 0
    const estado: "good" | "warn" | "bad" = pct >= 90 ? "good" : pct >= 75 ? "warn" : "bad"
    return { minTrabajando, minParada, minProgramado, pct, estado }
  }, [coverage])

  // OEE = Disponibilidad x Rendimiento x Calidad.
  const oee = useMemo(() => {
    const disp = disponibilidad.pct
    const rend = Math.min(pacing.pct, 100)
    const calidad =
      metrics.totalBultos + metrics.averias > 0
        ? (metrics.totalBultos / (metrics.totalBultos + metrics.averias)) * 100
        : 100
    const valor = (disp / 100) * (rend / 100) * (calidad / 100) * 100
    const cara: "happy" | "neutral" | "angry" = valor >= 80 ? "happy" : valor >= 60 ? "neutral" : "angry"
    const estado: "good" | "warn" | "bad" = valor >= 80 ? "good" : valor >= 60 ? "warn" : "bad"
    return { disp, rend, calidad, valor, cara, estado }
  }, [disponibilidad.pct, pacing.pct, metrics.totalBultos, metrics.averias])

  const relojTexto = new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Bogota",
  }).format(now)

  const inactCritico = maquina ? maquina.parada : inactividad.min >= DOWNTIME_THRESHOLD_MIN

  // De donde salio la ventana. Se dice una sola vez y arriba porque afecta a
  // TODOS los numeros de la pantalla, no a un grafico suelto: si el dia no
  // tiene Horario de Tolva, la disponibilidad y el OEE se estan midiendo contra
  // un rango supuesto y quien lee el tablero tiene que saberlo.
  const origenVentana = (() => {
    if (ventana.origen === "tolva") {
      return {
        texto: tolva.detalle
          ? `según el Horario de Tolva del día (${tolva.detalle})`
          : "según el Horario de Tolva del día",
        alerta: false,
      }
    }
    // No se está usando el Horario de Tolva: hay que decir exactamente por qué,
    // porque cada motivo se arregla en un lugar distinto.
    const porQue =
      tolva.estado === "cargando" ? "leyendo el Horario de Tolva…"
      : tolva.estado === "ambiguo" ? `no se pudo elegir el Horario de Tolva: ${tolva.detalle}. Selecciona un proyecto arriba`
      : tolva.estado === "incompleto" ? "el Horario de Tolva del día está incompleto: falta la hora de inicio o de fin"
      : tolva.estado === "error" ? `no se pudo leer el Horario de Tolva (${tolva.detalle ?? "error"})`
      : "el día no tiene Horario de Tolva configurado"
    const base =
      ventana.origen === "turnos"
        ? "calculado con los turnos programados del personal"
        : "calculado con el horario por defecto"
    return { texto: `${base} — ${porQue}`, alerta: tolva.estado !== "cargando" }
  })()

  return (
    <div className="space-y-6">
      {/* Selector de fecha + estado realtime + reloj */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <label htmlFor="fecha-dia" className="text-sm font-medium text-card-foreground">
            Día:
          </label>
          <input
            id="fecha-dia"
            type="date"
            value={selectedDate}
            max={utcDateStr()}
            onChange={(e) => setSelectedDate(e.target.value || utcDateStr())}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-card-foreground outline-none focus:ring-2 focus:ring-primary"
          />
          {!isToday && (
            <button
              type="button"
              onClick={() => setSelectedDate(utcDateStr())}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-muted"
            >
              Volver a Hoy
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          {isToday ? (
            <>
              <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
                <Radio
                  className={`h-3.5 w-3.5 ${realtimeOk ? "animate-pulse text-chart-3" : "text-muted-foreground"}`}
                />
                <span className="text-xs font-medium text-card-foreground">
                  {realtimeOk ? "IoT Edge: SEÑAL ACTIVA" : "Conectando..."}
                </span>
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-primary">{relojTexto}</div>
            </>
          ) : (
            <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Vista histórica
            </span>
          )}
        </div>
      </div>

      {/* La ventana con la que se calcula TODO lo de abajo. */}
      <div
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs ${
          origenVentana.alerta
            ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
            : "border-border bg-muted/40 text-muted-foreground"
        }`}
      >
        <Timer className="h-3.5 w-3.5 shrink-0" />
        <span>
          Jornada de la tolva: <strong className="font-mono">{ventanaTexto}</strong>{" "}
          ({horasTurno.toLocaleString("es-CO", { maximumFractionDigits: 2 })} h)
        </span>
        <span className="opacity-80">· {origenVentana.texto}</span>
        <span className="opacity-80">
          · Velocidad, cobertura, cumplimiento, paros, disponibilidad y OEE se calculan solo dentro
          de este rango.
        </span>
      </div>

      {/* Franja OEE en vivo (solo HOY): estado de maquina + KPIs embebidos */}
      {isToday && (
        <section
          className={`overflow-hidden rounded-xl border ${
            inactCritico
              ? "border-destructive/60"
              : maquina && !maquina.parada
                ? "border-chart-3/50"
                : "border-border"
          }`}
        >
          <div
            className={`flex flex-col items-center justify-between gap-3 p-5 sm:flex-row ${
              inactCritico
                ? "bg-destructive/10"
                : maquina && !maquina.parada
                  ? "bg-chart-3/10"
                  : "bg-card"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-lg ring-1 ${
                  inactCritico
                    ? "bg-destructive/15 text-destructive ring-destructive/40"
                    : "bg-chart-3/15 text-chart-3 ring-chart-3/40"
                }`}
              >
                <Timer className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Estado de Máquina
                </p>
                <p className="text-sm text-muted-foreground">
                  {maquina
                    ? `Última actualización: ${HORA_FMT.format(maquina.ultima)}`
                    : loading
                      ? "Cargando señal de máquina..."
                      : "Sin señal de máquina hoy"}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-center sm:items-end">
              <span
                className={`text-2xl font-bold sm:text-4xl ${
                  inactCritico
                    ? "animate-pulse text-destructive"
                    : maquina && !maquina.parada
                      ? "text-chart-3"
                      : "text-muted-foreground"
                }`}
              >
                {maquina ? maquina.estado : "—"}
              </span>
              {maquina && (
                <span className="font-mono text-sm tabular-nums text-muted-foreground">
                  {maquina.min} min, {pad2(maquina.seg)} seg sin cambios
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
            <KpiTile
              title="Total Bultos"
              value={totalBultosDisplay.toLocaleString("es-CO")}
              sub="Throughput acumulado hoy"
              icon={<Boxes className="h-5 w-5" />}
              accent="info"
            />
            <KpiTile
              title="Estibas Despachadas"
              value={metrics.estibas.toLocaleString("es-CO")}
              sub="Registros tipo Estiba"
              icon={<Layers className="h-5 w-5" />}
              accent="info"
            />
            <KpiTile
              title="Bultos en Arrume"
              value={metrics.arrume.toLocaleString("es-CO")}
              sub="Unidades sin estibar"
              icon={<Package2 className="h-5 w-5" />}
              accent="info"
            />
            <KpiTile
              title="Total Averías"
              value={metrics.averias.toLocaleString("es-CO")}
              sub="Unidades con defecto"
              icon={<AlertTriangle className="h-5 w-5" />}
              accent={metrics.averias > 0 ? "bad" : "good"}
            />
          </div>
        </section>
      )}

      {/* KPIs para vista historica (dias pasados, sin banner en vivo) */}
      {!isToday && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            title="Total Bultos"
            value={totalBultosDisplay.toLocaleString("es-CO")}
            sub="Throughput del día"
            icon={<Boxes className="h-5 w-5" />}
            accent="info"
          />
          <KpiCard
            title="Estibas Despachadas"
            value={metrics.estibas.toLocaleString("es-CO")}
            sub="Registros tipo Estiba"
            icon={<Layers className="h-5 w-5" />}
            accent="info"
          />
          <KpiCard
            title="Bultos en Arrume"
            value={metrics.arrume.toLocaleString("es-CO")}
            sub="Unidades sin estibar"
            icon={<Package2 className="h-5 w-5" />}
            accent="info"
          />
          <KpiCard
            title="Total Averías"
            value={metrics.averias.toLocaleString("es-CO")}
            sub="Unidades con defecto"
            icon={<AlertTriangle className="h-5 w-5" />}
            accent={metrics.averias > 0 ? "bad" : "good"}
          />
        </div>
      )}

      {/* Tarjeta OEE global (Disponibilidad x Rendimiento x Calidad) */}
      <section
        className={`rounded-xl border p-5 ${
          oee.estado === "good"
            ? "border-chart-3/40 bg-chart-3/10"
            : oee.estado === "warn"
              ? "border-chart-4/40 bg-chart-4/10"
              : "border-destructive/40 bg-destructive/10"
        }`}
      >
        <div className="grid grid-cols-1 items-center gap-5 lg:grid-cols-2">
          <div className="flex items-center gap-4">
            {oee.cara === "happy" ? (
              <Smile className="h-16 w-16 text-chart-3" aria-hidden="true" />
            ) : oee.cara === "neutral" ? (
              <Meh className="h-16 w-16 text-chart-4" aria-hidden="true" />
            ) : (
              <Frown className="h-16 w-16 text-destructive" aria-hidden="true" />
            )}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Eficiencia General (OEE)
              </p>
              <p className="text-5xl font-bold tabular-nums sm:text-6xl" style={{ color: PACE_COLOR[oee.estado] }}>
                {oee.valor.toFixed(1)}
                <span className="text-2xl">%</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {oee.valor >= 80
                  ? "Excelente: por encima del 80%"
                  : oee.valor >= 60
                    ? "Aceptable: entre 60% y 80%"
                    : "Crítico: por debajo del 60%"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <OeeFactor label="Disponibilidad" value={oee.disp} icon={<Gauge className="h-3.5 w-3.5" />} />
            <OeeFactor label="Rendimiento" value={oee.rend} icon={<Target className="h-3.5 w-3.5" />} />
            <OeeFactor label="Calidad" value={oee.calidad} icon={<Award className="h-3.5 w-3.5" />} />
          </div>
        </div>
      </section>

      {/* Disponibilidad de maquina */}
      <section className="lg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-card-foreground">
            Disponibilidad de Máquina ({ventanaTexto})
          </h2>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="shrink-0 text-center sm:w-40">
            <span className="text-4xl font-bold tabular-nums" style={{ color: PACE_COLOR[disponibilidad.estado] }}>
              {disponibilidad.pct.toFixed(1)}%
            </span>
            <p className="text-xs text-muted-foreground">del tiempo programado</p>
          </div>
          <div className="flex-1">
            <div className="flex h-6 w-full overflow-hidden rounded-md bg-muted">
              <div className="h-full bg-chart-3" style={{ width: `${disponibilidad.pct}%` }} title="Trabajando" />
              <div className="h-full flex-1 bg-destructive" title="Parada" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Trabajando</p>
                <p className="font-mono text-sm font-semibold text-chart-3">{fmtMinutos(disponibilidad.minTrabajando)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Parada</p>
                <p className="font-mono text-sm font-semibold text-destructive">{fmtMinutos(disponibilidad.minParada)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tiempo programado</p>
                <p className="font-mono text-sm font-semibold text-card-foreground">{fmtMinutos(disponibilidad.minProgramado)}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Velocidad de produccion cada 2 min (historial_intervalos) */}
      <section className="lg-card p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-card-foreground">
              Velocidad de Producción cada 2 min ({ventanaTexto})
            </h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {velocidad.cumplidos.toLocaleString("es-CO")}/{velocidad.total.toLocaleString("es-CO")} intervalos en meta
          </span>
        </div>

        {/* Producción fuera de la ventana del turno. No se oculta en silencio:
            que la máquina produzca fuera del horario programado es justo lo que
            alguien necesita saber. */}
        {velocidad.fueraDeVentana > 0 && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            Hay <strong>{velocidad.fueraDeVentana.toLocaleString("es-CO")}</strong> lectura(s) con
            producción fuera del horario programado, que no se grafican. Revisa el Horario de Tolva
            del día en Programación de turnos si la jornada real fue otra.
          </div>
        )}
        {loading ? (
          <EmptyState loading text="" />
        ) : velocidad.total === 0 ? (
          <EmptyState loading={false} text="Sin lecturas del contador para este día" />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={velocidad.puntos} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="hora" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} minTickGap={24} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [`${v.toLocaleString("es-CO")} u`, "Producción 2 min"]}
                />
                <ReferenceLine
                  y={META_2MIN}
                  stroke="var(--primary)"
                  strokeDasharray="4 4"
                  label={{ value: `Meta ${META_2MIN}/2min`, position: "insideTopRight", fill: "var(--primary)", fontSize: 11 }}
                />
                <Line type="monotone" dataKey="unidades" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Cobertura del turno cada 2 min (barra continua, sin gaps) */}
      <section className="lg-card p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-card-foreground">
              Cobertura del Turno cada 2 min ({ventanaTexto})
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-chart-3" /> Trabajando
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-chart-4" /> Justificada
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-destructive" /> Sin justificar
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-muted" /> Pendiente
            </span>
          </div>
        </div>
        <div className="flex h-7 w-full overflow-hidden rounded-sm">
          {coverage.map((c) => {
            const justificada = c.status === "down" && comentadoStarts.has(c.start)
            return (
              <div
                key={c.start}
                title={`${c.label} — ${
                  c.status === "active"
                    ? "Trabajando"
                    : c.status === "down"
                      ? justificada
                        ? `Justificada: ${motivoPorStart.get(c.start) || ""}`
                        : "Máquina parada (sin justificar)"
                      : "Pendiente"
                }`}
                className={`h-full min-w-0 flex-1 ${
                  c.status === "active"
                    ? "bg-chart-3"
                    : c.status === "down"
                      ? justificada
                        ? "bg-chart-4"
                        : "bg-destructive"
                      : "bg-muted"
                }`}
              />
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
          <span>{minutosAHora(ventana.desdeMin)}</span>
          {parosResumen.total > 0 && (
            <span className="font-sans text-xs">
              <strong className="text-foreground">{parosResumen.total}</strong> paros ·{" "}
              <strong className="text-foreground">{fmtMinutos(parosResumen.minutosTotal)}</strong> ·{" "}
              <strong className="text-chart-4">{parosResumen.comentados}</strong> justificados ·{" "}
              <strong className="text-destructive">{parosResumen.sinComentar}</strong> sin justificar
            </span>
          )}
          <span>{minutosAHora(ventana.hastaMin)}</span>
        </div>

        {/* CONSOLIDADO DE PAROS
            Los conteos solos engañan: veinte microparos de 2 min y un paro de
            40 son "20 vs 1" pero cuestan lo mismo. Lo que se responde ante
            gerencia es cuanto tiempo de maquina se perdio y que parte de ese
            tiempo nadie explico. */}
        {parosResumen.total > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/30 p-2">
                <p className="lg-eyebrow">
                  Paro total
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {fmtMinutos(parosResumen.minutosTotal)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {parosResumen.total} {parosResumen.total === 1 ? "franja" : "franjas"}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-2">
                <p className="lg-eyebrow">
                  Justificado
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-chart-4">
                  {fmtMinutos(parosResumen.minutosComentados)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {parosResumen.comentados} con motivo
                </p>
              </div>

              <div
                className={`rounded-lg border p-2 ${
                  parosResumen.minutosSinJustificar > 0
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border bg-muted/30"
                }`}
              >
                <p className="lg-eyebrow">
                  Sin justificar
                </p>
                <p
                  className={`mt-0.5 text-lg font-semibold tabular-nums ${
                    parosResumen.minutosSinJustificar > 0 ? "text-destructive" : "text-foreground"
                  }`}
                >
                  {fmtMinutos(parosResumen.minutosSinJustificar)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {parosResumen.sinComentar} sin motivo
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-2">
                <p className="lg-eyebrow">
                  % sin explicar
                </p>
                <p
                  className={`mt-0.5 text-lg font-semibold tabular-nums ${
                    parosResumen.pctSinJustificar > 0 ? "text-destructive" : "text-chart-4"
                  }`}
                >
                  {parosResumen.pctSinJustificar}%
                </p>
                <p className="text-[10px] text-muted-foreground">del tiempo parado</p>
              </div>
            </div>

            {/* El paro sin justificar mas largo: por donde empezar a preguntar. */}
            {parosResumen.mayorSinJustificar && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                El más largo sin justificar:{" "}
                <strong className="text-destructive">
                  {fmtMinutos(parosResumen.mayorSinJustificar.minutos)}
                </strong>{" "}
                entre {parosResumen.mayorSinJustificar.inicio} y{" "}
                {parosResumen.mayorSinJustificar.fin}.
              </p>
            )}

            {/* En que se va el tiempo que SI esta justificado. */}
            {parosResumen.porCategoria.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 lg-eyebrow">
                  Justificado por categoría
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {parosResumen.porCategoria.map((c) => (
                    <span
                      key={c.categoria}
                      className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px]"
                      title={`${c.conteo} ${c.conteo === 1 ? "paro" : "paros"}`}
                    >
                      {c.categoria}
                      <strong className="tabular-nums text-foreground">
                        {fmtMinutos(c.minutos)}
                      </strong>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-2 text-[10px] text-muted-foreground">
              Un paro es una franja de 2 minutos o más sin registro del contador, dentro del
              horario de tolva. Se justifica desde «Reporte de Paros».
            </p>
          </div>
        )}
      </section>

      {/* Rendimiento dinamico (donut) + cumplimiento hora a hora */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Donut de rendimiento actual */}
        <section className="lg-card p-4 lg:col-span-1">
          <div className="mb-2 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-card-foreground">Rendimiento Actual</h2>
          </div>
          <div className="relative mx-auto h-52 w-full max-w-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: "logro", value: Math.min(pacing.pct, 100) },
                    { name: "resto", value: Math.max(100 - pacing.pct, 0) },
                  ]}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={92}
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  isAnimationActive={false}
                >
                  <Cell fill={PACE_COLOR[pacing.estado]} />
                  <Cell fill="var(--muted)" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="text-4xl font-bold tabular-nums"
                style={{ color: PACE_COLOR[pacing.estado] }}
              >
                {Math.round(pacing.pct)}%
              </span>
              <span className="text-xs text-muted-foreground">de la meta actual</span>
            </div>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Procesados</span>
              <span className="font-mono font-semibold text-card-foreground">
                {pacing.procesados.toLocaleString("es-CO")}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Meta Actual</span>
              <span className="font-mono font-semibold text-card-foreground">
                {pacing.metaActual.toLocaleString("es-CO")}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Target className="h-3.5 w-3.5" /> Meta Final del Día
              </span>
              <span className="font-mono font-semibold text-primary">
                {metaDia.toLocaleString("es-CO")}
              </span>
            </div>
          </div>
        </section>

        {/* Cumplimiento hora a hora */}
        <section className="lg-card p-4 lg:col-span-2">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-card-foreground">
                Cumplimiento Hora a Hora ({ventanaTexto})
              </h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-chart-3" /> {"≥240"}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-chart-4" /> 200-239
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-destructive" /> {"<200"}
              </span>
            </div>
          </div>
          {loading ? (
            <EmptyState loading text="" />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} barCategoryGap="20%" margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="hora" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v.toLocaleString("es-CO")} bultos`, "Procesado"]}
                  />
                  <ReferenceLine
                    y={META_POR_HORA}
                    stroke="var(--primary)"
                    strokeDasharray="4 4"
                    label={{
                      value: `Meta: ${META_POR_HORA}/hr`,
                      position: "insideTopRight",
                      fill: "var(--primary)",
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="bultos" radius={[3, 3, 0, 0]}>
                    {hourly.map((d) => (
                      <Cell
                        key={d.hora}
                        fill={
                          d.bultos >= META_POR_HORA
                            ? "var(--chart-3)"
                            : d.bultos >= 200
                              ? "var(--chart-4)"
                              : "var(--destructive)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* Resumen del dia por producto */}
      <section className="overflow-hidden lg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="relative flex h-2.5 w-2.5">
            {realtimeOk && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chart-3 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${realtimeOk ? "bg-chart-3" : "bg-muted-foreground"}`}
            />
          </span>
          <h2 className="text-sm font-semibold text-card-foreground">Producción del Día por Producto</h2>
        </div>
        {productResumen.length === 0 ? (
          <div className="p-6">
            <EmptyState loading={loading} text="Sin producción registrada hoy" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Producto</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total Bultos</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <Layers className="h-3 w-3 text-primary" /> Estiba
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <Boxes className="h-3 w-3 text-chart-4" /> Arrume
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">Averías</th>
                </tr>
              </thead>
              <tbody>
                {productResumen.map((p) => {
                  const conAveria = p.averias > 0
                  return (
                    <tr
                      key={p.producto}
                      className={`border-b border-border/60 last:border-0 ${
                        conAveria ? "bg-chart-4/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-card-foreground">{p.producto}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-card-foreground">
                        {p.bultos.toLocaleString("es-CO")}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-primary">
                        {p.estiba.toLocaleString("es-CO")}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-chart-4">
                        {p.arrume.toLocaleString("es-CO")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {conAveria ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-chart-4/15 px-2 py-0.5 font-mono text-xs font-semibold text-chart-4 ring-1 ring-chart-4/30">
                            <TriangleAlert className="h-3 w-3" />
                            {p.averias.toLocaleString("es-CO")}
                          </span>
                        ) : (
                          <span className="font-mono text-muted-foreground">0</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50 text-sm font-semibold">
                  <td className="px-4 py-3 text-card-foreground">Total ({productResumen.length})</td>
                  <td className="px-4 py-3 text-right font-mono text-card-foreground">
                    {productResumen.reduce((s, p) => s + p.bultos, 0).toLocaleString("es-CO")}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-primary">
                    {productResumen.reduce((s, p) => s + p.estiba, 0).toLocaleString("es-CO")}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-chart-4">
                    {productResumen.reduce((s, p) => s + p.arrume, 0).toLocaleString("es-CO")}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-chart-4">
                    {productResumen.reduce((s, p) => s + p.averias, 0).toLocaleString("es-CO")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* TAB 2: RESUMEN MENSUAL                                              */
/* ------------------------------------------------------------------ */

function MonthlyTab({ nombreProducto }: { nombreProducto: (id: number) => string }) {
  const today = new Date()
  const [year, setYear] = useState<number>(today.getFullYear())
  const [month, setMonth] = useState<number>(today.getMonth())
  const [rows, setRows] = useState<ProduccionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      try {
        const { start, end } = monthRange(year, month)
        // Paginado: `produccion` es una fila por registro/estiba y un mes de alto
        // volumen supera 1000 filas; sin paginar, los KPIs y la tendencia diaria se
        // subcontaban. Orden estable (fecha_hora, id).
        const data = await fetchAllRows((from, to) =>
          supabase
            .from("produccion")
            .select("id, fecha_hora, producto, tipo_empaque, bultos_procesados, averias")
            .gte("fecha_hora", start)
            .lt("fecha_hora", end)
            .order("fecha_hora", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        )
        if (!active) return
        setRows((data as ProduccionRow[]).filter(Boolean))
      } catch (e: any) {
        console.log("[v0] Control Piso mensual exception:", e?.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [year, month])

  const kpis = useMemo(() => {
    let procesados = 0
    let averias = 0
    let estibasCount = 0
    let arrumeBultos = 0
    for (const r of rows) {
      procesados += r.bultos_procesados || 0
      averias += r.averias || 0
      if (isEstiba(r.tipo_empaque)) estibasCount += 1
      else if (isArrume(r.tipo_empaque)) arrumeBultos += r.bultos_procesados || 0
    }
    const tasaDesperdicio = procesados > 0 ? (averias / procesados) * 100 : 0
    return { procesados, averias, estibasCount, arrumeBultos, tasaDesperdicio }
  }, [rows])

  // Tendencia diaria: cubeta por dia del mes (1..diasEnMes).
  const daily = useMemo(() => {
    const diasEnMes = new Date(year, month + 1, 0).getDate()
    const buckets = Array.from({ length: diasEnMes }, (_, i) => ({
      dia: i + 1,
      procesados: 0,
      averias: 0,
    }))
    for (const r of rows) {
      const d = bogotaDay(r.fecha_hora)
      if (d >= 1 && d <= diasEnMes) {
        buckets[d - 1].procesados += r.bultos_procesados || 0
        buckets[d - 1].averias += r.averias || 0
      }
    }
    return buckets
  }, [rows, year, month])

  // Top 5 productos con mas averias.
  const topDefectos = useMemo(() => {
    const map = new Map<number, { producto: number; averias: number; procesados: number }>()
    for (const r of rows) {
      const cur = map.get(r.producto) || { producto: r.producto, averias: 0, procesados: 0 }
      cur.averias += r.averias || 0
      cur.procesados += r.bultos_procesados || 0
      map.set(r.producto, cur)
    }
    return Array.from(map.values())
      .filter((x) => x.averias > 0)
      .sort((a, b) => b.averias - a.averias)
      .slice(0, 5)
  }, [rows])

  const years = useMemo(() => {
    const y = today.getFullYear()
    return [y, y - 1, y - 2, y - 3]
  }, [today])

  return (
    <div className="space-y-6">
      {/* Selector de mes/anio */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="font-medium">Periodo:</span>
        </div>
        <DarkSelect value={String(month)} onChange={(v) => setMonth(Number(v))}>
          {MESES.map((m, i) => (
            <option key={i} value={i}>
              {m}
            </option>
          ))}
        </DarkSelect>
        <DarkSelect value={String(year)} onChange={(v) => setYear(Number(v))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </DarkSelect>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          title="Total Bultos del Mes"
          value={kpis.procesados.toLocaleString("es-CO")}
          sub="Throughput acumulado"
          icon={<Boxes className="h-5 w-5" />}
          accent="info"
        />
        <KpiCard
          title="Tasa de Desperdicio"
          value={`${kpis.tasaDesperdicio.toFixed(1)}%`}
          sub={`${kpis.averias.toLocaleString("es-CO")} averías`}
          icon={<AlertOctagon className="h-5 w-5" />}
          accent={kpis.tasaDesperdicio > 5 ? "bad" : kpis.averias > 0 ? "warn" : "good"}
        />
        <KpiCard
          title="Estibas Armadas"
          value={kpis.estibasCount.toLocaleString("es-CO")}
          sub="Registros tipo Estiba"
          icon={<Layers className="h-5 w-5" />}
          accent="info"
        />
        <KpiCard
          title="Bultos en Arrume"
          value={kpis.arrumeBultos.toLocaleString("es-CO")}
          sub="Suma de bultos en Arrume"
          icon={<Package2 className="h-5 w-5" />}
          accent="info"
        />
      </div>

      {/* Tendencia diaria */}
      <section className="lg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">
          Tendencia Diaria — {MESES[month]} {year} (Bultos vs Averías)
        </h2>
        {loading ? (
          <EmptyState loading text="" />
        ) : kpis.procesados === 0 ? (
          <EmptyState loading={false} text="Sin producción en el periodo seleccionado" />
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="gradProc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradAver" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-destructive)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-destructive)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="dia" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={{ color: "var(--color-popover-foreground)" }}
                  labelFormatter={(l) => `Día ${l}`}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-muted-foreground)" }} />
                <Area
                  type="monotone"
                  dataKey="procesados"
                  name="Bultos"
                  stroke="var(--color-chart-1)"
                  fill="url(#gradProc)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="averias"
                  name="Averías"
                  stroke="var(--color-destructive)"
                  fill="url(#gradAver)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Top productos con averias */}
      <section className="overflow-hidden lg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <AlertOctagon className="h-4 w-4 text-destructive" />
          <h2 className="text-sm font-semibold text-card-foreground">
            Top 5 Productos con Más Averías (Cuellos de Botella)
          </h2>
        </div>
        {topDefectos.length === 0 ? (
          <div className="p-6">
            <EmptyState loading={loading} text="Sin averías registradas en el periodo" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-4 py-2.5 font-medium">Producto</th>
                  <th className="px-4 py-2.5 text-right font-medium">Averías</th>
                  <th className="px-4 py-2.5 text-right font-medium">Bultos</th>
                  <th className="px-4 py-2.5 text-right font-medium">% Avería</th>
                </tr>
              </thead>
              <tbody>
                {topDefectos.map((d, i) => {
                  const pct = d.procesados > 0 ? (d.averias / d.procesados) * 100 : 0
                  return (
                    <tr key={d.producto} className="border-b border-border/60 last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2.5 text-card-foreground">{nombreProducto(d.producto)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-destructive">
                        {d.averias.toLocaleString("es-CO")}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground">
                        {d.procesados.toLocaleString("es-CO")}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-chart-4">{pct.toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* TAB 3: RESUMEN ANUAL                                                */
/* ------------------------------------------------------------------ */

function AnnualTab({ nombreProducto }: { nombreProducto: (id: number) => string }) {
  const today = new Date()
  const [year, setYear] = useState<number>(today.getFullYear())
  const [rows, setRows] = useState<ProduccionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      try {
        const { start, end } = yearRange(year)
        // Paginado: un año de `produccion` supera holgadamente 1000 filas; sin paginar
        // llegaban solo ene/feb y la agregación anual (Unidades, Desperdicio YTD, Mejor
        // Mes, Mix) quedaba gravemente subcontada. Orden estable (fecha_hora, id).
        const data = await fetchAllRows((from, to) =>
          supabase
            .from("produccion")
            .select("id, fecha_hora, producto, tipo_empaque, bultos_procesados, averias")
            .gte("fecha_hora", start)
            .lt("fecha_hora", end)
            .order("fecha_hora", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        )
        if (!active) return
        setRows((data as ProduccionRow[]).filter(Boolean))
      } catch (e: any) {
        console.log("[v0] Control Piso anual exception:", e?.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [year])

  // Agregado por mes (0-11): procesados y tasa de desperdicio.
  const monthly = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      mesIdx: i,
      mes: MESES_CORTO[i],
      procesados: 0,
      averias: 0,
      desperdicio: 0,
    }))
    for (const r of rows) {
      const m = bogotaMonth(r.fecha_hora)
      if (m >= 0 && m <= 11) {
        buckets[m].procesados += r.bultos_procesados || 0
        buckets[m].averias += r.averias || 0
      }
    }
    for (const b of buckets) {
      b.desperdicio = b.procesados > 0 ? Number(((b.averias / b.procesados) * 100).toFixed(1)) : 0
    }
    return buckets
  }, [rows])

  const kpis = useMemo(() => {
    let procesados = 0
    let averias = 0
    let estibasCount = 0
    let arrumeBultos = 0
    for (const r of rows) {
      procesados += r.bultos_procesados || 0
      averias += r.averias || 0
      if (isEstiba(r.tipo_empaque)) estibasCount += 1
      else if (isArrume(r.tipo_empaque)) arrumeBultos += r.bultos_procesados || 0
    }
    const tasaDesperdicio = procesados > 0 ? (averias / procesados) * 100 : 0
    // Mejor mes por unidades producidas.
    let mejorMes = "—"
    let mejorVal = -1
    for (const b of monthly) {
      if (b.procesados > mejorVal) {
        mejorVal = b.procesados
        mejorMes = b.procesados > 0 ? MESES[b.mesIdx] : "—"
      }
    }
    return { procesados, averias, tasaDesperdicio, estibasCount, arrumeBultos, mejorMes, mejorVal }
  }, [rows, monthly])

  // Product mix: distribucion de bultos procesados por producto.
  const productMix = useMemo(() => {
    const map = new Map<number, number>()
    for (const r of rows) {
      map.set(r.producto, (map.get(r.producto) || 0) + (r.bultos_procesados || 0))
    }
    const arr = Array.from(map.entries())
      .map(([producto, value]) => ({ name: nombreProducto(producto), value }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
    // Agrupar la cola en "Otros" si hay muchos productos.
    if (arr.length > 7) {
      const top = arr.slice(0, 7)
      const otros = arr.slice(7).reduce((s, x) => s + x.value, 0)
      top.push({ name: "Otros", value: otros })
      return top
    }
    return arr
  }, [rows, nombreProducto])

  const years = useMemo(() => {
    const y = today.getFullYear()
    return [y, y - 1, y - 2, y - 3]
  }, [today])

  const hayDatos = kpis.procesados > 0

  return (
    <div className="space-y-6">
      {/* Selector de anio */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="font-medium">Año:</span>
        </div>
        <DarkSelect value={String(year)} onChange={(v) => setYear(Number(v))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </DarkSelect>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          title="Unidades Producidas"
          value={kpis.procesados.toLocaleString("es-CO")}
          sub="Total bultos YTD"
          icon={<TrendingUp className="h-5 w-5" />}
          accent="info"
        />
        <KpiCard
          title="Desperdicio YTD"
          value={`${kpis.tasaDesperdicio.toFixed(1)}%`}
          sub={`${kpis.averias.toLocaleString("es-CO")} averías`}
          icon={<AlertTriangle className="h-5 w-5" />}
          accent={kpis.tasaDesperdicio > 5 ? "bad" : kpis.averias > 0 ? "warn" : "good"}
        />
        <KpiCard
          title="Mejor Mes"
          value={kpis.mejorMes}
          sub={kpis.mejorVal > 0 ? `${kpis.mejorVal.toLocaleString("es-CO")} bultos` : "Sin datos"}
          icon={<Award className="h-5 w-5" />}
          accent="good"
        />
        <KpiCard
          title="Estibas vs Arrume"
          value={`${kpis.estibasCount.toLocaleString("es-CO")} / ${kpis.arrumeBultos.toLocaleString("es-CO")}`}
          sub="Estibas (count) / Arrume (bultos)"
          icon={<Layers className="h-5 w-5" />}
          accent="info"
        />
      </div>

      {/* Tendencia mensual (line) */}
      <section className="lg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">
          Tendencia Mensual {year} (Unidades y Desperdicio %)
        </h2>
        {loading ? (
          <EmptyState loading text="" />
        ) : !hayDatos ? (
          <EmptyState loading={false} text="Sin producción en el año seleccionado" />
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="mes" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis yAxisId="left" stroke="var(--color-chart-1)" fontSize={12} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="var(--color-destructive)"
                  fontSize={12}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={{ color: "var(--color-popover-foreground)" }}
                  formatter={(value: any, name: any) =>
                    name === "Desperdicio %" ? [`${value}%`, name] : [Number(value).toLocaleString("es-CO"), name]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-muted-foreground)" }} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="procesados"
                  name="Unidades Procesadas"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="desperdicio"
                  name="Desperdicio %"
                  stroke="var(--color-destructive)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Product mix (pie) */}
      <section className="lg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">Mix de Producción por Producto ({year})</h2>
        {loading ? (
          <EmptyState loading text="" />
        ) : productMix.length === 0 ? (
          <EmptyState loading={false} text="Sin producción en el año seleccionado" />
        ) : (
          <div className="h-96 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={productMix}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={130}
                  innerRadius={60}
                  paddingAngle={2}
                  label={(entry: any) => `${entry.name}`}
                  labelLine={false}
                >
                  {productMix.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="var(--color-card)" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value: any) => [`${Number(value).toLocaleString("es-CO")} bultos`, "Producción"]}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-muted-foreground)" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* TAB 4: REPORTE — consulta directa a `produccion` con joins         */
/* ------------------------------------------------------------------ */

// Fila enriquecida de la tabla base `produccion`. Los nombres de
// producto, bodega y localizacion se resuelven en cliente con los
// diccionarios cargados desde sus tablas maestras (joins logicos).
interface ReporteRow {
  id: number
  fecha_hora: string
  producto: number
  bodega: number
  localizacion: number
  tipo_empaque: string | null
  lote: number | null
  bultos_procesados: number | null
  cantidad_meta: number | null
  averias: number | null
}

function ReportTab({ nombreProducto }: { nombreProducto: (id: number) => string }) {
  // Rango por defecto: ultimos 7 dias (en fecha literal UTC).
  const hoy = utcDateStr()
  const hace7 = useMemo(() => {
    const [y, m, d] = hoy.split("-").map(Number)
    const past = new Date(Date.UTC(y, m - 1, d - 6))
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(past)
  }, [hoy])

  const [desde, setDesde] = useState<string>(hace7)
  const [hasta, setHasta] = useState<string>(hoy)
  const [rows, setRows] = useState<ReporteRow[]>([])
  const [bodegas, setBodegas] = useState<Record<number, string>>({})
  const [locs, setLocs] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [consultado, setConsultado] = useState(false)

  // Catalogos para los joins logicos (bodega y localizacion). El de
  // productos lo provee el padre via `nombreProducto`.
  useEffect(() => {
    let active = true
    Promise.all([
      supabase.from("bodegas").select("idbodega, nombrebodega"),
      supabase.from("locations").select("id, nombre, codigo"),
    ]).then(([bRes, lRes]) => {
      if (!active) return
      const bDict: Record<number, string> = {}
      for (const b of (bRes.data as { idbodega: number; nombrebodega: string }[]) || []) {
        bDict[b.idbodega] = b.nombrebodega
      }
      const lDict: Record<number, string> = {}
      for (const l of (lRes.data as { id: number; nombre: string; codigo: string }[]) || []) {
        lDict[l.id] = l.nombre || l.codigo || `Loc ${l.id}`
      }
      setBodegas(bDict)
      setLocs(lDict)
    })
    return () => {
      active = false
    }
  }, [])

  const consultar = useCallback(async () => {
    setLoading(true)
    setConsultado(true)
    try {
      // Rango [desde 00:00, dia_siguiente_de_hasta 00:00) en hora literal UTC.
      const desdeISO = `${desde}T00:00:00Z`
      const hastaISO = `${nextDateStr(hasta)}T00:00:00Z`
      // Paginado: un rango amplio supera 1000 filas; sin paginar, los KPIs del reporte
      // y el CSV exportado salían truncados (y el CSV aparentaba estar completo).
      // Orden estable (fecha_hora desc, id desc).
      const data = await fetchAllRows((from, to) =>
        supabase
          .from("produccion")
          .select(
            "id, fecha_hora, producto, bodega, localizacion, tipo_empaque, lote, bultos_procesados, cantidad_meta, averias",
          )
          .gte("fecha_hora", desdeISO)
          .lt("fecha_hora", hastaISO)
          .order("fecha_hora", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      )
      setRows((data as ReporteRow[]).filter(Boolean))
    } catch (e: any) {
      console.log("[v0] Control Piso reporte exception:", e?.message)
    } finally {
      setLoading(false)
    }
  }, [desde, hasta])

  // Primera carga automatica con el rango por defecto.
  useEffect(() => {
    consultar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nombreBodega = (id: number) => bodegas[id] || `Bodega ${id}`
  const nombreLoc = (id: number) => locs[id] || `Loc ${id}`

  // Totales del rango consultado.
  const totales = useMemo(() => {
    let bultos = 0
    let averias = 0
    let meta = 0
    for (const r of rows) {
      bultos += r.bultos_procesados || 0
      averias += r.averias || 0
      meta += r.cantidad_meta || 0
    }
    const cumplimiento = meta > 0 ? (bultos / meta) * 100 : 0
    return { registros: rows.length, bultos, averias, meta, cumplimiento }
  }, [rows])

  const fmtFechaHora = (iso: string) =>
    new Intl.DateTimeFormat("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(parseTs(iso))

  // Exporta las filas visibles a CSV (con nombres resueltos).
  const exportCSV = useCallback(() => {
    const headers = [
      "ID",
      "Fecha y Hora",
      "Producto",
      "Bodega",
      "Localizacion",
      "Tipo Empaque",
      "Lote",
      "Bultos Procesados",
      "Cantidad Meta",
      "Averias",
    ]
    const lines = rows.map((r) =>
      [
        r.id,
        fmtFechaHora(r.fecha_hora),
        nombreProducto(r.producto),
        nombreBodega(r.bodega),
        nombreLoc(r.localizacion),
        r.tipo_empaque ?? "",
        r.lote ?? "",
        r.bultos_procesados ?? 0,
        r.cantidad_meta ?? 0,
        r.averias ?? 0,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    )
    const csv = [headers.join(","), ...lines].join("\n")
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `reporte_produccion_${desde}_a_${hasta}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [rows, desde, hasta, bodegas, locs])

  return (
    <div className="space-y-6">
      {/* Filtros del reporte */}
      <section className="lg-card p-4">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-card-foreground">Reporte de Producción</h2>
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="space-y-1.5">
            <label htmlFor="rep-desde" className="block text-xs font-medium text-muted-foreground">
              Desde
            </label>
            <input
              id="rep-desde"
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-card-foreground outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rep-hasta" className="block text-xs font-medium text-muted-foreground">
              Hasta
            </label>
            <input
              id="rep-hasta"
              type="date"
              value={hasta}
              min={desde}
              max={hoy}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-card-foreground outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={consultar}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              <Search className="h-4 w-4" />
              {loading ? "Consultando..." : "Consultar"}
            </button>
            <button
              type="button"
              onClick={exportCSV}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-1.5 text-sm font-medium text-card-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
          </div>
        </div>
      </section>

      {/* KPIs del rango */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          title="Total Registros"
          value={totales.registros.toLocaleString("es-CO")}
          sub="Filas en el rango"
          icon={<FileText className="h-5 w-5" />}
          accent="info"
        />
        <KpiCard
          title="Total Bultos"
          value={totales.bultos.toLocaleString("es-CO")}
          sub={`Meta: ${totales.meta.toLocaleString("es-CO")}`}
          icon={<Boxes className="h-5 w-5" />}
          accent="neutral"
        />
        <KpiCard
          title="Cumplimiento"
          value={`${totales.cumplimiento.toFixed(1)}%`}
          sub="Bultos vs meta"
          icon={<Target className="h-5 w-5" />}
          accent={totales.cumplimiento >= 95 ? "good" : totales.cumplimiento >= 80 ? "warn" : "bad"}
        />
        <KpiCard
          title="Total Averías"
          value={totales.averias.toLocaleString("es-CO")}
          sub="En el rango"
          icon={<TriangleAlert className="h-5 w-5" />}
          accent={totales.averias > 0 ? "bad" : "good"}
        />
      </div>

      {/* Tabla de detalle */}
      <section className="overflow-hidden lg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-card-foreground">
            Detalle de Registros{" "}
            <span className="font-normal text-muted-foreground">
              ({desde} a {hasta})
            </span>
          </h3>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            loading={loading}
            text={consultado ? "Sin registros para el rango seleccionado" : "Selecciona un rango y consulta"}
          />
        ) : (
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Fecha y Hora</th>
                  <th className="px-3 py-2 font-medium">Producto</th>
                  <th className="px-3 py-2 font-medium">Bodega</th>
                  <th className="px-3 py-2 font-medium">Localización</th>
                  <th className="px-3 py-2 font-medium">Empaque</th>
                  <th className="px-3 py-2 font-medium">Lote</th>
                  <th className="px-3 py-2 text-right font-medium">Bultos</th>
                  <th className="px-3 py-2 text-right font-medium">Meta</th>
                  <th className="px-3 py-2 text-right font-medium">Averías</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/50">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.id}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-card-foreground">
                      {fmtFechaHora(r.fecha_hora)}
                    </td>
                    <td className="px-3 py-2 text-card-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Package2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {nombreProducto(r.producto)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-card-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Warehouse className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {nombreBodega(r.bodega)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-card-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {nombreLoc(r.localizacion)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-card-foreground">{r.tipo_empaque || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.lote ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-card-foreground">
                      {(r.bultos_procesados ?? 0).toLocaleString("es-CO")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {(r.cantidad_meta ?? 0).toLocaleString("es-CO")}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        (r.averias ?? 0) > 0 ? "font-medium text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {(r.averias ?? 0).toLocaleString("es-CO")}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 border-t-2 border-border bg-muted">
                <tr className="font-semibold text-card-foreground">
                  <td className="px-3 py-2" colSpan={7}>
                    Totales ({totales.registros} registros)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{totales.bultos.toLocaleString("es-CO")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totales.meta.toLocaleString("es-CO")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totales.averias.toLocaleString("es-CO")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* COMPONENTES AUXILIARES                                              */
/* ------------------------------------------------------------------ */

function DarkSelect({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-input bg-card px-3 py-1.5 text-sm font-medium text-card-foreground outline-none ring-ring/40 transition-colors hover:border-ring focus:ring-2"
    >
      {children}
    </select>
  )
}

function KpiCard({
  title,
  value,
  sub,
  icon,
  accent = "neutral",
}: {
  title: string
  value: string
  sub?: string
  icon: React.ReactNode
  accent?: "neutral" | "good" | "warn" | "bad" | "info"
}) {
  const accentClass =
    accent === "good"
      ? "text-chart-3"
      : accent === "warn"
        ? "text-chart-4"
        : accent === "bad"
          ? "text-destructive"
          : accent === "info"
            ? "text-primary"
            : "text-card-foreground"
  const ring =
    accent === "good"
      ? "ring-chart-3/30 bg-chart-3/10"
      : accent === "warn"
        ? "ring-chart-4/30 bg-chart-4/10"
        : accent === "bad"
          ? "ring-destructive/30 bg-destructive/10"
          : accent === "info"
            ? "ring-primary/30 bg-primary/10"
            : "ring-border bg-muted"
  return (
    <div className="lg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${ring} ${accentClass}`}>
          {icon}
        </div>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${accentClass}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// Variante de KpiCard SIN borde, para vivir dentro de un grid `gap-px bg-border`
// (la rejilla dibuja las lineas divisorias). Misma jerarquia visual.
function KpiTile({
  title,
  value,
  sub,
  icon,
  accent = "neutral",
}: {
  title: string
  value: string
  sub?: string
  icon: React.ReactNode
  accent?: "neutral" | "good" | "warn" | "bad" | "info"
}) {
  const accentClass =
    accent === "good"
      ? "text-chart-3"
      : accent === "warn"
        ? "text-chart-4"
        : accent === "bad"
          ? "text-destructive"
          : accent === "info"
            ? "text-primary"
            : "text-card-foreground"
  const ring =
    accent === "good"
      ? "ring-chart-3/30 bg-chart-3/10"
      : accent === "warn"
        ? "ring-chart-4/30 bg-chart-4/10"
        : accent === "bad"
          ? "ring-destructive/30 bg-destructive/10"
          : accent === "info"
            ? "ring-primary/30 bg-primary/10"
            : "ring-border bg-muted"
  return (
    <div className="bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${ring} ${accentClass}`}>
          {icon}
        </div>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${accentClass}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// Factor del OEE: etiqueta + % + mini barra de progreso coloreada por umbral.
function OeeFactor({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  const color = value >= 90 ? "var(--chart-3)" : value >= 75 ? "var(--chart-4)" : "var(--destructive)"
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-mono text-sm font-bold tabular-nums" style={{ color }}>
          {value.toFixed(1)}%
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%`, background: color }}
        />
      </div>
    </div>
  )
}

function EmptyState({ loading, text }: { loading: boolean; text: string }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
      <Package2 className="h-8 w-8 opacity-40" />
      {loading ? "Cargando..." : text}
    </div>
  )
}
