"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Scale,
  ClipboardList,
  Truck,
  ParkingCircle,
  Package2,
  CheckCircle2,
  BarChart3,
  Calendar,
  RotateCcw,
  Megaphone,
  Activity,
  AlertCircle,
  Timer,
  Users,
  Gauge,
  Target,
  Zap,
  Minimize2,
  Tv,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Calendar as CalendarWidget } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useAuth } from "@/components/auth-provider"
import {
  getDashboardOperacionesData,
  getDashboardOperacionesStats,
  type DashboardOperacionesData,
  type DashboardOperacionesStats,
} from "@/lib/dashboard-actions"

/**
 * Vista clasica del Dashboard de Operaciones (pestana "Operacion del Dia").
 * Este componente es una extraccion 1:1 del contenido que antes vivia en
 * `dashboard-operacion.tsx`. El contenedor ahora maneja las pestanas
 * "Operacion del Dia" y "Dashboard Gerencia".
 */
/**
 * Fecha actual en timezone Colombia (America/Bogota) en formato
 * `YYYY-MM-DD`, calculada en el cliente. La duplicamos aqui (existe un
 * helper async equivalente en `lib/date-utils.ts`) para evitar pasar
 * por un round-trip al server solo para inicializar el estado del
 * date input.
 */
function getColombiaTodayClient(): string {
  const now = new Date()
  const localized = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))
  const y = localized.getFullYear()
  const m = String(localized.getMonth() + 1).padStart(2, "0")
  const d = String(localized.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export default function DashboardOperacionDia() {
  const { selectedEmpresaId } = useAuth()
  const [dashboardData, setDashboardData] = useState<DashboardOperacionesData[]>([])
  const [stats, setStats] = useState<DashboardOperacionesStats | null>(null)
  const [loading, setLoading] = useState(true)
  // Fecha activa del dashboard. Por defecto el dia de hoy (Colombia);
  // el usuario puede elegir cualquier otra fecha desde el input del
  // header y los server actions filtraran `fechacargue` por ese valor.
  const [selectedDate, setSelectedDate] = useState<string>(() => getColombiaTodayClient())

  // Modo TV: oculta sidebar y header (breadcrumb) montando el
  // dashboard como un overlay `fixed inset-0` sobre toda la pantalla.
  // Si el navegador soporta la Fullscreen API tambien se solicita
  // para llenar el monitor por completo. El estado vive aqui (no
  // en `app/page.tsx`) para mantener la feature autocontenida.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [tvMode, setTvMode] = useState(false)

  const today = getColombiaTodayClient()
  const isToday = selectedDate === today

  // Sincroniza la Fullscreen API real del navegador con el estado
  // local. Se intenta entrar/salir cuando el usuario pulsa el toggle,
  // y se escucha `fullscreenchange` para reaccionar si el usuario
  // sale con ESC (ahi reseteamos `tvMode` a false).
  useEffect(() => {
    const target = rootRef.current
    if (!target) return
    if (tvMode) {
      const req = (target.requestFullscreen ||
        (target as unknown as { webkitRequestFullscreen?: () => Promise<void> })
          .webkitRequestFullscreen) as (() => Promise<void>) | undefined
      if (req) {
        req.call(target).catch(() => {
          // Algunos navegadores rechazan si no hay user gesture en el
          // contexto correcto; en ese caso seguimos en overlay sin
          // fullscreen real, que ya cubre toda la ventana.
        })
      }
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    }
  }, [tvMode])

  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) setTvMode((prev) => (prev ? false : prev))
    }
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  // ESC tambien sale del modo TV cuando el usuario no esta en
  // fullscreen real (overlay puro).
  useEffect(() => {
    if (!tvMode) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setTvMode(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tvMode])

  const loadData = async (empresaId: number, fecha: string) => {
    try {
      setLoading(true)
      const [dataResult, statsResult] = await Promise.all([
        getDashboardOperacionesData(empresaId, fecha),
        getDashboardOperacionesStats(empresaId, fecha),
      ])

      if (dataResult.success && dataResult.data) {
        setDashboardData(dataResult.data)
      }

      if (statsResult.success && statsResult.data) {
        setStats(statsResult.data)
      }
    } catch (error) {
      console.error("Error loading dashboard data:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedEmpresaId) {
      loadData(selectedEmpresaId, selectedDate)
      // Solo refrescamos automaticamente cuando se esta viendo el dia
      // de hoy: para fechas pasadas no tiene sentido el polling.
      if (selectedDate === today) {
        const interval = setInterval(() => loadData(selectedEmpresaId, selectedDate), 120000)
        return () => clearInterval(interval)
      }
    }
  }, [selectedEmpresaId, selectedDate, today])

  const formatTime = (timeString: string | null) => {
    if (!timeString) return "-"
    const parts = timeString.split(":")
    if (parts.length >= 2) {
      return `${parts[0]}:${parts[1]}`
    }
    return timeString
  }

  /**
   * Duracion en minutos -> "1h 05m" o "45m". Una duracion no se lee igual que
   * una hora del dia: "01:05" en la columna de paro se confundiria con la una
   * de la manana.
   */
  const formatDuracion = (minutos: number | null | undefined) => {
    const m = Math.max(0, Math.round(Number(minutos) || 0))
    if (m === 0) return "-"
    const h = Math.floor(m / 60)
    return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`
  }

  /**
   * Agrupa las ordenes por la hora declarada en `horalote` (H.Lote) y
   * suma las toneladas programadas (`pesoorden`) en cada bucket
   * horario, restringiendo el rango a la jornada operativa 06:00 - 18:00
   * (13 buckets). Se renderiza como barras horizontales para encajar en
   * una tarjeta angosta del row superior.
   *
   * Antes este memo agrupaba por `horaorden` (H.Orden), pero el negocio
   * pidio cambiar a `horalote` porque esa es la hora a la que el lote
   * realmente debe estar listo en planta — refleja mejor la "carga de
   * trabajo programada por franja horaria" que es el objetivo del
   * grafico.
   *
   * - `horalote` viene en formato "HH:MM:SS" (PostgreSQL TIME).
   * - Filas fuera de la franja 6-18 se ignoran porque el negocio opera
   *   solo en ese rango y la tarjeta es compacta.
   * - Marcamos `esPico` el bucket con mayor volumen para resaltarlo en
   *   un color contrastante.
   */
  const HORA_INICIO = 6
  const HORA_FIN = 18

  const programacionPorHora = useMemo(() => {
    const total = HORA_FIN - HORA_INICIO + 1
    const buckets = Array.from({ length: total }, (_, i) => {
      const h = HORA_INICIO + i
      return {
        hora: h,
        label: `${String(h).padStart(2, "0")}:00`,
        toneladas: 0,
        ordenes: 0,
      }
    })

    for (const row of dashboardData) {
      if (!row.horalote) continue
      const h = Number.parseInt(row.horalote.slice(0, 2), 10)
      if (Number.isNaN(h) || h < HORA_INICIO || h > HORA_FIN) continue
      const idx = h - HORA_INICIO
      // Huevos (y cualquier producto por unidad) no se mide en toneladas —
      // su `pesoorden` es un valor nominal (cantidad × peso_unitkg) sin
      // significado real de peso. Sigue contando como orden, solo no suma
      // al tonelaje de la franja horaria. Confirmado 2026-08-28.
      if (!row.es_por_unidad) buckets[idx].toneladas += row.pesoorden || 0
      buckets[idx].ordenes += 1
    }

    const max = buckets.reduce((m, b) => Math.max(m, b.toneladas), 0)
    return buckets.map((b) => ({ ...b, esPico: b.toneladas > 0 && b.toneladas === max }))
  }, [dashboardData])

  const totalProgramadoTon = useMemo(
    () => programacionPorHora.reduce((s, b) => s + b.toneladas, 0),
    [programacionPorHora],
  )

  const getStatusColor = (estado: string | null) => {
    if (!estado) return "bg-slate-100 text-slate-700"
    const estadoNormalized = estado.trim()
    if (estadoNormalized === "Fin Operación") return "bg-green-100 text-green-700"
    if (estadoNormalized === "Finalizado LIP") return "bg-blue-600 text-white"
    if (estadoNormalized === "En proceso") return "bg-blue-100 text-blue-700"
    if (estadoNormalized === "En cola") return "bg-yellow-100 text-yellow-700"
    if (estadoNormalized === "Sin lote" || estadoNormalized === "Por Pesar") return "bg-red-100 text-red-700"
    return "bg-slate-100 text-slate-700"
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-xl text-muted-foreground">Cargando dashboard...</div>
      </div>
    )
  }

  // Fecha legible para el badge "Mostrando ..." al lado del selector.
  // Usamos Intl con timezone Colombia para que el dia 1ro siga
  // mostrandose como "1 ene" aunque el navegador este en otro huso.
  const fechaLegible = (() => {
    const [y, m, d] = selectedDate.split("-").map(Number)
    if (!y || !m || !d) return selectedDate
    return new Date(y, m - 1, d).toLocaleDateString("es-CO", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  })()

  return (
    <div
      ref={rootRef}
      className={
        tvMode
          ? "fixed inset-0 z-[60] bg-background overflow-auto"
          : "w-full"
      }
    >
      {/* En modo TV reducimos aun mas paddings y gaps para sacar el
          maximo provecho del espacio del monitor. En modo normal
          tambien se mantiene compacto pero con un poco mas de aire. */}
      <div
        className={
          tvMode
            ? "w-full mx-auto space-y-1.5 px-2 py-1.5"
            : "w-full mx-auto space-y-2 px-1.5 py-1.5"
        }
      >
        {/* Barra superior compacta: selector de fecha minimo + ticker
            estilo aeropuerto que va anunciando informacion operativa
            relevante (vehiculos en patio, ordenes en proceso, etc.).
            Reemplaza la antigua tarjeta grande de fecha para no
            desperdiciar el alto del primer fold. */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-sm">
          {/* Selector de fecha compacto */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Calendar className="h-3.5 w-3.5 text-blue-600" aria-hidden />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-[130px] justify-start px-2 text-[11px] font-normal"
                  aria-label="Seleccionar fecha de operación"
                >
                  {format(parseISO(selectedDate), "dd/MM/yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarWidget
                  mode="single"
                  selected={parseISO(selectedDate)}
                  onSelect={(date) => date && setSelectedDate(format(date, "yyyy-MM-dd"))}
                  disabled={{ after: parseISO(today) }}
                  locale={es}
                />
              </PopoverContent>
            </Popover>
            {!isToday && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedDate(today)}
                className="h-7 gap-1 text-[11px] px-2"
              >
                <RotateCcw className="h-3 w-3" />
                Hoy
              </Button>
            )}
            {isToday ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                En vivo
              </span>
            ) : (
              <span className="inline-flex items-center text-[10px] font-medium text-amber-700">
                Histórico
              </span>
            )}
          </div>

          {/* Separador vertical fino */}
          <div className="h-5 w-px bg-slate-200 shrink-0" aria-hidden />

          {/* Ticker — anuncia info clave en bucle */}
          <DashboardTicker stats={stats} fechaLegible={fechaLegible} isToday={isToday} />

          {/* Toggle de modo TV / Pantalla completa.
              Oculta sidebar + breadcrumb y solicita Fullscreen API
              para que el dashboard llene un monitor sin distracciones.
              ESC o el mismo boton revierten al modo normal. */}
          <div className="h-5 w-px bg-slate-200 shrink-0" aria-hidden />
          <Button
            type="button"
            size="sm"
            variant={tvMode ? "default" : "outline"}
            onClick={() => setTvMode((v) => !v)}
            className={`h-7 gap-1 text-[11px] px-2 shrink-0 ${
              tvMode ? "bg-slate-900 text-white hover:bg-slate-800" : ""
            }`}
            title={tvMode ? "Salir de modo TV (ESC)" : "Modo TV / Pantalla completa"}
            aria-pressed={tvMode}
          >
            {tvMode ? (
              <>
                <Minimize2 className="h-3 w-3" />
                Salir
              </>
            ) : (
              <>
                <Tv className="h-3 w-3" />
                TV
              </>
            )}
          </Button>
        </div>

        {/* Fila hero: medidor de Cumplimiento Toneladas (izquierda,
            ocupa 2/3) + KPI tile de Toneladas (derecha, 1/3). La
            lectura ejecutiva inmediata es "meta -> ejecutado" y
            queremos que ambos KPIs vivan en la misma franja superior. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <div className="lg:col-span-2">
            <CumplimientoToneladasCard
              meta={stats?.metaToneladasDia ?? 0}
              programado={stats?.toneladasProgramadas ?? 0}
              ejecutado={stats?.totalToneladasDia ?? 0}
            />
          </div>
          <div className="lg:col-span-1">
            <ToneladasKpiCard stats={stats} />
          </div>
        </div>

        {/* "Pulso Operativo" — KPIs ejecutivos del dia.
            Órdenes y Personal son los dos focos restantes (la card
            "Pendientes por Cargar" se retiro de esta vista para
            descongestionar la lectura ejecutiva). */}
        <div className="space-y-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-1">
            Pulso operativo
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <OrdenesKpiCard stats={stats} />
            <PersonalKpiCard stats={stats} />
          </div>
        </div>

        {/* "Vista de Mando" — paneles operativos detallados:
            Vehículos en patio · Clientes en proceso · Programación. */}
        <div className="space-y-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-1">
            Vista de mando
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            <VehiculosEnPatioPanel stats={stats} />
            <ClientesEnProcesoPanel stats={stats} formatTime={formatTime} />
            <ProgramacionHoraPanel
              programacionPorHora={programacionPorHora}
              totalProgramadoTon={totalProgramadoTon}
            />
          </div>
        </div>

        <Card className="shadow-lg border-2 border-slate-200 rounded-2xl mx-1">
          <CardHeader className="py-2 px-4 bg-gradient-to-r from-slate-100 to-slate-50 border-b-2 border-slate-200">
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Package2 className="h-5 w-5 text-slate-600" />
              Detalle de Operaciones
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Cliente
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Orden
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Placa
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Tipo Op.
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Peso
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      H.Veh
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      H.San
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      H.Ord
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Pes.Ini
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      H.Lote
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Ini.Op
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Fin.Op
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Pes.Fin
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      T.Proc
                    </TableHead>
                    <TableHead
                      className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1"
                      title="Tiempo total que la orden estuvo pausada, sumando todas sus pausas"
                    >
                      T.Paro
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold text-slate-700 whitespace-nowrap py-1 px-1">
                      Estado
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboardData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={16} className="text-center py-4 text-sm text-slate-500">
                        No hay datos disponibles
                      </TableCell>
                    </TableRow>
                  ) : (
                    dashboardData.map((row, index) => (
                      <TableRow key={index} className="hover:bg-slate-50">
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">{row.cliente || "-"}</TableCell>
                        <TableCell className="text-[10px] font-semibold text-slate-900 whitespace-nowrap py-1 px-1">
                          {row.ordendecargue || "-"}
                        </TableCell>
                        <TableCell className="text-[10px] font-mono whitespace-nowrap py-1 px-1">
                          {row.placa || "-"}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {row.tipooperacion || "-"}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {row.pesoorden?.toFixed(2) || "-"}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {formatTime(row.horavehiculo)}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {formatTime(row.horasanitario)}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {formatTime(row.horaorden)}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {row.pesajeinicial || "-"}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {formatTime(row.horalote) || "-"}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {formatTime(row.iniciocargue)}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {formatTime(row.fincargue)}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {row.pesajefinal || "-"}
                        </TableCell>
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {row.tiempo_en_proceso || "-"}
                        </TableCell>
                        {/* Tiempo de paro: suma de todas las pausas de la orden.
                            Se resalta cuando hubo paro para que salte a la vista,
                            y se avisa si quedo una pausa sin cerrar, porque en
                            ese caso el total esta incompleto. */}
                        <TableCell className="text-[10px] whitespace-nowrap py-1 px-1">
                          {row.tiempo_paro_min > 0 || row.paro_abierto ? (
                            <span
                              className={`inline-flex items-center gap-1 font-medium ${
                                row.paro_abierto ? "text-red-600" : "text-amber-700"
                              }`}
                              title={
                                row.paro_abierto
                                  ? `${row.paros} pausa(s); una sigue abierta, el total puede crecer`
                                  : `${row.paros} pausa(s)`
                              }
                            >
                              {formatDuracion(row.tiempo_paro_min)}
                              {row.paros > 1 && (
                                <span className="text-[9px] text-slate-500">({row.paros})</span>
                              )}
                              {row.paro_abierto && <span className="text-[9px]">•</span>}
                            </span>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-1 px-1">
                          <span
                            className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium ${getStatusColor(row.estado)}`}
                          >
                            {row.estado || "-"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f5f9;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #fb923c;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #f97316;
        }
      `}</style>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────
 * DashboardTicker
 *
 * Tira de mensajes con desplazamiento horizontal continuo, estilo
 * panel de aeropuerto. Sustituye al antiguo card grande de "Fecha de
 * operacion" para liberar espacio en el primer fold y a la vez
 * comunicar de un vistazo lo que esta pasando en planta.
 *
 * Mensajes derivados:
 *   - encabezado del dia (fecha + estado en vivo / historico)
 *   - vehiculos en patio (placa + hora de llegada)
 *   - clientes en proceso (con bandera roja si > 60 min)
 *   - kpis del dia: ordenes en cola, en proceso, programadas
 *
 * El track se duplica para que el loop CSS sea continuo, sin saltos.
 * Los datos vivos (vehiculos / clientes) solo se muestran cuando la
 * fecha activa es hoy, asegurando que el ticker no anuncie info
 * obsoleta en vista historica.
 * ────────────────────────────────────────────────────────────────── */
function DashboardTicker({
  stats,
  fechaLegible,
  isToday,
}: {
  stats: DashboardOperacionesStats | null
  fechaLegible: string
  isToday: boolean
}) {
  const messages = useMemo(() => {
    const items: Array<{
      icon: typeof Truck
      tone: "blue" | "orange" | "red" | "green" | "slate"
      text: string
    }> = []

    // Encabezado: siempre presente para que el ticker tenga contenido
    // util incluso cuando la operacion del dia aun no comienza.
    items.push({
      icon: Megaphone,
      tone: "blue",
      text: isToday
        ? `Operación del día — ${fechaLegible}`
        : `Vista histórica — ${fechaLegible}`,
    })

    if (!stats) {
      items.push({
        icon: Activity,
        tone: "slate",
        text: "Cargando información operativa...",
      })
      return items
    }

    // KPIs del dia
    if (stats.toneladasProgramadas > 0) {
      items.push({
        icon: Scale,
        tone: "blue",
        text: `${stats.toneladasProgramadas.toFixed(1)} toneladas programadas para hoy`,
      })
    }
    if (stats.ordenesEnProceso > 0) {
      items.push({
        icon: Activity,
        tone: "green",
        text: `${stats.ordenesEnProceso} ${
          stats.ordenesEnProceso === 1 ? "orden activa" : "órdenes activas"
        } en proceso`,
      })
    }
    if (stats.ordenesEnCola > 0) {
      items.push({
        icon: ClipboardList,
        tone: "orange",
        text: `${stats.ordenesEnCola} ${
          stats.ordenesEnCola === 1 ? "orden esperando" : "órdenes esperando"
        } en cola`,
      })
    }

    // Vehiculos en patio (solo cuando la vista es de hoy — para fechas
    // historicas el server devuelve array vacio y aqui ni iteramos).
    for (const v of stats.vehiculosEnPatio) {
      if (!v.placa) continue
      items.push({
        icon: Truck,
        tone: "orange",
        text: `Vehículo ${v.placa} en patio${
          v.horallegada ? ` desde las ${v.horallegada}` : ""
        }`,
      })
    }

    // Clientes en proceso. Marcamos en rojo (con icono distinto) los
    // que llevan mas de 1 hora — eso es justamente el caso de uso que
    // pidio el negocio para que el ticker funcione como un alerta.
    for (const c of stats.clientesEnProceso) {
      const minutos = parseTiempoEnMinutos(c.tiempo_en_proceso)
      const esLargo = minutos !== null && minutos > 60
      items.push({
        icon: esLargo ? AlertCircle : Timer,
        tone: esLargo ? "red" : "blue",
        text: `${c.cliente || "Cliente"} en proceso · ${
          c.tiempo_en_proceso || "tiempo desconocido"
        }${esLargo ? " · revisar demora" : ""}`,
      })
    }

    if (items.length === 1) {
      // Solo quedo el encabezado: damos un mensaje de fondo para que el
      // ticker no se vea vacio.
      items.push({
        icon: CheckCircle2,
        tone: "slate",
        text: isToday
          ? "Sin actividad operativa registrada en este momento"
          : "Sin actividad registrada para esta fecha",
      })
    }

    return items
  }, [stats, fechaLegible, isToday])

  // Duplicamos para conseguir un loop sin "salto" al volver al inicio.
  // El keyframe se desplaza exactamente -50% (la mitad del track), de
  // modo que el segundo bloque queda alineado con el primero al
  // reiniciar.
  const loop = useMemo(() => [...messages, ...messages], [messages])

  // ──────────────────────────────────────────────────────────────────
  // Velocidad constante (px/segundo), no proporcional al numero de
  // mensajes. Antes calculabamos la duracion como `messages.length *
  // 0.5`, pero el ancho real del track depende del LARGO DE CADA
  // MENSAJE — y cada empresa tiene mensajes distintos — por eso la
  // velocidad visual variaba entre empresas. La solucion correcta es:
  //
  //   duration = (ancho_real_del_track * 0.5) / pixelesPorSegundo
  //
  // Multiplicamos por 0.5 porque el keyframe desplaza exactamente la
  // mitad del track (el contenido esta duplicado para conseguir el
  // loop sin salto), por lo que en un ciclo recorre la mitad del ancho.
  //
  // `SPEED_PX_PER_SEC` es la perilla unica para ajustar la velocidad
  // global del ticker. Reducido (40 px/s ~ lectura comoda en pantalla
  // TV) por requerimiento de negocio: el ticker se sentia rapido.
  // ──────────────────────────────────────────────────────────────────
  const SPEED_PX_PER_SEC = 40
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [durationSec, setDurationSec] = useState<number>(20)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return

    const recompute = () => {
      const width = el.scrollWidth
      if (width <= 0) return
      // El track contiene el contenido duplicado. El keyframe va de 0 a
      // -50%, asi que el "viaje" efectivo es width/2 px.
      const travel = width / 2
      const next = travel / SPEED_PX_PER_SEC
      // Piso de 8s para evitar animaciones epilepticas si por algun
      // motivo el contenido es muy corto.
      setDurationSec(Math.max(8, next))
    }

    recompute()

    // Recalculamos cuando el contenido cambia de tamaño (fuentes
    // cargan, idioma cambia, layout responsive, etc.).
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loop])

  const toneClass: Record<string, string> = {
    blue: "text-blue-600",
    orange: "text-orange-500",
    red: "text-red-600",
    green: "text-emerald-600",
    slate: "text-slate-500",
  }

  return (
    <div
      className="relative flex-1 min-w-0 overflow-hidden group"
      role="status"
      aria-live="polite"
      aria-label="Información operativa en tiempo real"
    >
      {/* Fades laterales para que el texto entre/salga suavemente */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent z-10" />

      <div
        ref={trackRef}
        className="flex whitespace-nowrap will-change-transform group-hover:[animation-play-state:paused]"
        style={{
          animation: `dashboard-ticker ${durationSec}s linear infinite`,
        }}
      >
        {loop.map((m, i) => {
          const Icon = m.icon
          return (
            <span
              key={`${i}-${m.text}`}
              className="inline-flex items-center gap-2 px-4 text-[12px] font-medium text-slate-700"
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${toneClass[m.tone]}`} aria-hidden />
              <span>{m.text}</span>
              <span className="text-slate-300 mx-2" aria-hidden>
                •
              </span>
            </span>
          )
        })}
      </div>

      <style>{`
        @keyframes dashboard-ticker {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-50%, 0, 0); }
        }
      `}</style>
    </div>
  )
}

/**
 * Convierte un string de tiempo en MINUTOS totales, tolerante a varios
 * formatos posibles que la vista `dashboardoperaciones` puede emitir
 * para `tiempo_en_proceso`:
 *   - "01:23:45" / "01:23"
 *   - "1h 23m" / "1h" / "23m"
 *   - numero suelto (asumimos minutos)
 * Devuelve `null` si no se puede parsear (en cuyo caso el ticker no
 * marca el mensaje en rojo).
 */
function parseTiempoEnMinutos(value: string | null | undefined): number | null {
  if (!value) return null
  const v = value.trim().toLowerCase()

  // Formato HH:MM[:SS]
  const colon = v.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (colon) {
    const h = Number(colon[1])
    const m = Number(colon[2])
    return h * 60 + m
  }

  // Formato "1h 23m" / "1h" / "23m"
  const hMatch = v.match(/(\d+)\s*h/)
  const mMatch = v.match(/(\d+)\s*m/)
  if (hMatch || mMatch) {
    const h = hMatch ? Number(hMatch[1]) : 0
    const m = mMatch ? Number(mMatch[1]) : 0
    return h * 60 + m
  }

  // Numero suelto = minutos
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/* ──────────────────────────────────────────────────────────────────
 * CumplimientoToneladasCard
 *
 * Tarjeta-medidor con la triple comparacion del dia:
 *   1) Meta — objetivo de la empresa (vista `metadia`).
 *   2) Programado — lo que el cliente tiene en orden (suma `pesoorden`).
 *   3) Ejecutado — lo realmente procesado (`pesoorden` de finalizados).
 *
 * Las tres metricas se renderizan como mini-medidores horizontales
 * proporcionales al valor maximo entre las tres (no solo a la meta),
 * asi nunca queda una barra "saturada" cuando el programado/ejecutado
 * supera la meta. Cada medidor calcula ademas el porcentaje vs meta
 * para que el supervisor lea directamente el cumplimiento.
 *
 * Layout: 4 zonas en flex/grid responsive
 *   - resumen lateral (icono + score global)
 *   - 3 medidores apilados verticalmente
 * ─────────────────────────��──────────────────────────────────────── */
/* ───────────���────────────���─────────────────────────────────────────
 * CumplimientoToneladasCard — vista gerencial
 *
 * Tres elementos pensados para lectura ejecutiva:
 *
 * 1. Gauge radial (donut) con el KPI titular: "% de la meta ejecutado".
 *    Es la metrica de bottom-line para gerencia (ya esta hecho?). El
 *    color cambia por umbral (rojo < 50%, ambar 50-74, azul 75-99,
 *    verde >=100). Al centro la cifra grande con su pill de estado.
 *
 * 2. KPI tiles para Meta, Programado y Ejecutado con deltas
 *    contextuales (Programado vs Meta, Ejecutado vs Programado),
 *    asi el gerente identifica donde se esta perdiendo desempeno.
 *
 * 3. Barra segmentada de descomposicion de la meta en tres tramos:
 *      - Ejecutado (verde): toneladas ya entregadas
 *      - Pendiente programado (ambar): toneladas comprometidas
 *        pero aun no ejecutadas (riesgo operativo)
 *      - Sin programar (gris): toneladas faltantes para la meta
 *        que ningun cliente ha tomado todavia (riesgo comercial)
 *    Esta visualizacion responde a la pregunta "¿el gap es de
 *    ejecucion o de programacion?" sin hacer cuentas.
 * ────────────────────────────────────────────────────────────────── */
function CumplimientoToneladasCard({
  meta,
  programado,
  ejecutado,
}: {
  meta: number
  programado: number
  ejecutado: number
}) {
  // Cumplimiento titular: ejecutado / meta. Se hace cap visual en
  // 100 para no romper el gauge cuando se sobrepasa la meta, pero
  // el numero crudo se usa en los KPIs comparativos.
  const pctEjecutadoMetaRaw = meta > 0 ? (ejecutado / meta) * 100 : 0
  const pctEjecutadoMeta = Math.min(100, pctEjecutadoMetaRaw)
  const pctProgramadoMeta = meta > 0 ? Math.min(100, (programado / meta) * 100) : 0
  const pctEjecutadoProgramado =
    programado > 0 ? Math.min(100, (ejecutado / programado) * 100) : 0

  // Decomposicion de la meta para la barra inferior (todo en
  // toneladas; las tres partes suman exactamente `meta` cuando la
  // operacion esta dentro del objetivo). Para gerencia, los tres
  // tramos cuentan tres historias distintas:
  //   - ejecutadoEnMeta   -> "esta hecho"
  //   - pendientePrograma -> "comprometido pero NO ejecutado"
  //   - sinProgramar      -> "ni siquiera fue tomado"
  const ejecutadoEnMeta = Math.max(0, Math.min(ejecutado, meta))
  const programadoEnMeta = Math.max(0, Math.min(programado, meta))
  const pendienteProgramado = Math.max(0, programadoEnMeta - ejecutadoEnMeta)
  const sinProgramar = Math.max(0, meta - programadoEnMeta)

  // Sobre-programacion / sobre-ejecucion (cuando programado o
  // ejecutado superan la meta). Para gerencia es relevante: indica
  // cliente sobredemandando o un dia con back-orders.
  const sobreProgramado = Math.max(0, programado - meta)
  const sobreEjecutado = Math.max(0, ejecutado - meta)

  // Estado de la operacion para el pill principal.
  type Status = "cumplida" | "en-curso" | "en-riesgo" | "critico" | "sin-meta"
  const status: Status =
    meta <= 0
      ? "sin-meta"
      : pctEjecutadoMetaRaw >= 100
        ? "cumplida"
        : pctEjecutadoMetaRaw >= 75
          ? "en-curso"
          : pctEjecutadoMetaRaw >= 50
            ? "en-riesgo"
            : "critico"

  const statusMap: Record<
    Status,
    { label: string; pill: string; ring: string; bgIcon: string; iconColor: string }
  > = {
    cumplida: {
      label: "Meta cumplida",
      pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
      ring: "stroke-emerald-500",
      bgIcon: "bg-emerald-100",
      iconColor: "text-emerald-600",
    },
    "en-curso": {
      label: "En curso",
      pill: "bg-blue-50 text-blue-700 border-blue-200",
      ring: "stroke-blue-500",
      bgIcon: "bg-blue-100",
      iconColor: "text-blue-600",
    },
    "en-riesgo": {
      label: "En riesgo",
      pill: "bg-amber-50 text-amber-800 border-amber-200",
      ring: "stroke-amber-500",
      bgIcon: "bg-amber-100",
      iconColor: "text-amber-600",
    },
    critico: {
      label: "Crítico",
      pill: "bg-red-50 text-red-700 border-red-200",
      ring: "stroke-red-500",
      bgIcon: "bg-red-100",
      iconColor: "text-red-600",
    },
    "sin-meta": {
      label: "Sin meta",
      pill: "bg-slate-100 text-slate-600 border-slate-200",
      ring: "stroke-slate-400",
      bgIcon: "bg-slate-100",
      iconColor: "text-slate-500",
    },
  }
  const s = statusMap[status]

  // Donut SVG: dos arcos sobre un circulo de radio R. La longitud
  // total del trazo es 2*PI*R; usamos `strokeDasharray` para pintar
  // solo el porcentaje deseado y rotamos -90deg para que el inicio
  // sea arriba.
  const R = 42
  const C = 2 * Math.PI * R
  const dashEjecutado = (Math.min(100, pctEjecutadoMeta) / 100) * C
  // Indicador secundario: arco delgado interior que muestra
  // programado vs meta, asi el gerente compara ambos en el mismo
  // grafico.
  const Rinner = 32
  const Cinner = 2 * Math.PI * Rinner
  const dashProgramado = (Math.min(100, pctProgramadoMeta) / 100) * Cinner

  // Helpers de formato.
  const fmtTon = (n: number) => `${n.toFixed(1)} t`
  const fmtPct = (n: number) => `${Math.round(n)}%`
  const fmtDelta = (n: number) =>
    `${n >= 0 ? "+" : ""}${n.toFixed(1)} t`

  // Tile KPI helper.
  type KpiTone = "blue" | "amber" | "emerald"
  const kpiTone: Record<
    KpiTone,
    { ring: string; iconBg: string; iconColor: string; barFill: string }
  > = {
    blue: {
      ring: "border-blue-200",
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      barFill: "bg-blue-500",
    },
    amber: {
      ring: "border-amber-200",
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      barFill: "bg-amber-500",
    },
    emerald: {
      ring: "border-emerald-200",
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      barFill: "bg-emerald-500",
    },
  }

  return (
    <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md border border-slate-200 rounded-xl h-full">
      <CardContent className="p-2 h-full flex flex-col gap-1.5">
        {/* Encabezado compacto */}
        <div className="flex items-center gap-1.5">
          <div className={`${s.bgIcon} p-1 rounded-md`}>
            <Gauge className={`h-3.5 w-3.5 ${s.iconColor}`} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-bold text-slate-800 leading-tight">
              Cumplimiento Toneladas
            </h3>
            <p className="text-[9px] text-slate-500 leading-tight">
              Vista ejecutiva — meta, programa y entrega del día
            </p>
          </div>
          <span
            className={`inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded border ${s.pill}`}
          >
            {s.label}
          </span>
        </div>

        {/* Cuerpo principal: gauge + KPIs */}
        <div className="flex-1 flex flex-col md:flex-row items-stretch gap-2">
          {/* Gauge radial titular (mas compacto) */}
          <div className="flex md:flex-col items-center justify-center gap-2 md:gap-1 md:w-[110px] md:shrink-0">
            <div className="relative w-[96px] h-[96px]">
              <svg
                viewBox="0 0 100 100"
                className="w-full h-full -rotate-90"
                aria-hidden
              >
                {/* Track exterior */}
                <circle
                  cx="50"
                  cy="50"
                  r={R}
                  fill="none"
                  className="stroke-slate-100"
                  strokeWidth={9}
                />
                {/* Arco ejecutado */}
                <circle
                  cx="50"
                  cy="50"
                  r={R}
                  fill="none"
                  strokeWidth={9}
                  strokeLinecap="round"
                  className={`${s.ring} transition-[stroke-dasharray] duration-700 ease-out`}
                  strokeDasharray={`${dashEjecutado} ${C}`}
                />
                {/* Track interior */}
                <circle
                  cx="50"
                  cy="50"
                  r={Rinner}
                  fill="none"
                  className="stroke-slate-100"
                  strokeWidth={5}
                />
                {/* Arco programado (referencia secundaria) */}
                <circle
                  cx="50"
                  cy="50"
                  r={Rinner}
                  fill="none"
                  strokeWidth={5}
                  strokeLinecap="round"
                  className="stroke-amber-400 transition-[stroke-dasharray] duration-700 ease-out"
                  strokeDasharray={`${dashProgramado} ${Cinner}`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-lg font-bold tabular-nums leading-none text-slate-900">
                  {fmtPct(pctEjecutadoMetaRaw)}
                </span>
                <span className="text-[9px] font-medium text-slate-500 mt-0.5">
                  ejec / meta
                </span>
              </div>
            </div>
            {/* Leyenda compacta del gauge */}
            <div className="flex md:flex-row md:flex-wrap items-center gap-1.5 md:justify-center">
              <span className="inline-flex items-center gap-1 text-[9px] text-slate-600">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${s.iconColor.replace(
                    "text-",
                    "bg-",
                  )}`}
                />
                Ejecutado
              </span>
              <span className="inline-flex items-center gap-1 text-[9px] text-slate-600">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                Programado
              </span>
            </div>
          </div>

          {/* KPIs comparativos compactos */}
          <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-1.5 content-center">
            {/* Meta */}
            <div
              className={`rounded-lg border ${kpiTone.blue.ring} bg-white/70 p-1.5 flex flex-col gap-0.5`}
            >
              <div className="flex items-center gap-1">
                <div className={`${kpiTone.blue.iconBg} p-0.5 rounded`}>
                  <Target
                    className={`h-2.5 w-2.5 ${kpiTone.blue.iconColor}`}
                    aria-hidden
                  />
                </div>
                <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-wide">
                  Meta
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-slate-900 tabular-nums leading-none">
                  {meta.toFixed(1)}
                </span>
                <span className="text-[9px] font-medium text-slate-500">t</span>
              </div>
              <span className="text-[9px] text-slate-500 leading-tight">
                Objetivo del día
              </span>
            </div>

            {/* Programado */}
            <div
              className={`rounded-lg border ${kpiTone.amber.ring} bg-white/70 p-1.5 flex flex-col gap-0.5`}
            >
              <div className="flex items-center gap-1">
                <div className={`${kpiTone.amber.iconBg} p-0.5 rounded`}>
                  <ClipboardList
                    className={`h-2.5 w-2.5 ${kpiTone.amber.iconColor}`}
                    aria-hidden
                  />
                </div>
                <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-wide">
                  Programado
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-slate-900 tabular-nums leading-none">
                  {programado.toFixed(1)}
                </span>
                <span className="text-[9px] font-medium text-slate-500">t</span>
              </div>
              {meta > 0 ? (
                <div className="flex items-center gap-1 text-[9px]">
                  <span
                    className={`font-bold tabular-nums ${
                      programado >= meta ? "text-emerald-600" : "text-amber-700"
                    }`}
                  >
                    {fmtPct(pctProgramadoMeta)}
                  </span>
                  <span className="text-slate-500">vs meta</span>
                  <span className="text-slate-400 tabular-nums ml-auto">
                    {fmtDelta(programado - meta)}
                  </span>
                </div>
              ) : (
                <span className="text-[9px] text-slate-400">Sin referencia</span>
              )}
            </div>

            {/* Ejecutado */}
            <div
              className={`rounded-lg border ${kpiTone.emerald.ring} bg-white/70 p-1.5 flex flex-col gap-0.5`}
            >
              <div className="flex items-center gap-1">
                <div className={`${kpiTone.emerald.iconBg} p-0.5 rounded`}>
                  <Zap
                    className={`h-2.5 w-2.5 ${kpiTone.emerald.iconColor}`}
                    aria-hidden
                  />
                </div>
                <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-wide">
                  Ejecutado
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-slate-900 tabular-nums leading-none">
                  {ejecutado.toFixed(1)}
                </span>
                <span className="text-[9px] font-medium text-slate-500">t</span>
              </div>
              {programado > 0 ? (
                <div className="flex items-center gap-1 text-[9px]">
                  <span
                    className={`font-bold tabular-nums ${
                      ejecutado >= programado ? "text-emerald-600" : "text-amber-700"
                    }`}
                  >
                    {fmtPct(pctEjecutadoProgramado)}
                  </span>
                  <span className="text-slate-500">vs prog.</span>
                  <span className="text-slate-400 tabular-nums ml-auto">
                    {fmtDelta(ejecutado - programado)}
                  </span>
                </div>
              ) : (
                <span className="text-[9px] text-slate-400">Sin programación</span>
              )}
            </div>
          </div>
        </div>

        {/* Barra segmentada compacta — descomposicion de la meta */}
        {meta > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9px] text-slate-500">
              <span className="font-semibold uppercase tracking-wide">
                Descomposición de la meta
              </span>
              <span className="tabular-nums">
                {fmtTon(ejecutadoEnMeta)} ejec · {fmtTon(pendienteProgramado)} pend ·{" "}
                {fmtTon(sinProgramar)} s/prog
              </span>
            </div>
            <div className="relative w-full h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-700 ease-out"
                style={{ width: `${(ejecutadoEnMeta / meta) * 100}%` }}
                title={`Ejecutado: ${fmtTon(ejecutadoEnMeta)}`}
              />
              <div
                className="h-full bg-amber-400 transition-[width] duration-700 ease-out"
                style={{ width: `${(pendienteProgramado / meta) * 100}%` }}
                title={`Pendiente programado: ${fmtTon(pendienteProgramado)}`}
              />
            </div>
            {/* Leyenda compacta */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-slate-600">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" />
                Ejecutado
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm bg-amber-400" />
                Pendiente prog.
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm bg-slate-200 border border-slate-300" />
                Sin programar
              </span>
              {(sobreProgramado > 0 || sobreEjecutado > 0) && (
                <span className="ml-auto inline-flex items-center gap-1 text-blue-700 font-medium">
                  {sobreEjecutado > 0
                    ? `+${fmtTon(sobreEjecutado)} sobre meta`
                    : `+${fmtTon(sobreProgramado)} sobreprog`}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ──────────────────────────────────────────────────────────────────
 * Bloque "Pulso Operativo" — KPI tiles
 *
 * Toneladas (en la franja superior junto al gauge), Órdenes y Personal
 * (en la fila de pulso operativo) comparten un patron de diseno comun,
 * alineado con la CumplimientoToneladasCard:
 *   - Card compacta con gradient sutil + border + rounded-xl
 *   - Header: icon dentro de bg coloreado + titulo + status pill
 *   - Hero: cifra tabular-nums (text-xl extrabold) con sufijo
 *   - Cuerpo: contexto comparativo (deltas, breakdown, segmented bar)
 * ────────────────────────────────────────────────────────────────── */

function ToneladasKpiCard({ stats }: { stats: DashboardOperacionesStats | null }) {
  const cargadas = stats?.tonsCargadas ?? 0
  const descargadas = stats?.tonsDescargadas ?? 0
  const distribucion = stats?.tonsDistribucion ?? 0
  const totalDia = stats?.totalToneladasDia ?? 0
  const programadas = stats?.toneladasProgramadas ?? 0

  // Cumplimiento operativo: % de las toneladas comprometidas que ya
  // se ejecutaron. Es la lectura ejecutiva mas directa para esta tile.
  const pctEjecutado = programadas > 0 ? Math.min(100, (totalDia / programadas) * 100) : 0
  const delta = totalDia - programadas
  const pillTone =
    programadas <= 0
      ? "bg-slate-100 text-slate-600 border-slate-200"
      : pctEjecutado >= 100
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : pctEjecutado >= 75
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : pctEjecutado >= 50
            ? "bg-amber-50 text-amber-800 border-amber-200"
            : "bg-red-50 text-red-700 border-red-200"
  const pillLabel =
    programadas <= 0
      ? "Sin programación"
      : pctEjecutado >= 100
        ? "Cumplido"
        : `${Math.round(pctEjecutado)}% ejecutado`

  // Tres canales (Cargadas / Descargadas / Distribución) como mini
  // barras proporcionales al total — comunica de un vistazo el mix
  // operativo del dia sin necesidad de leer numeros pequenos.
  const denomMix = Math.max(cargadas + descargadas + distribucion, 1)
  const canales: Array<{ label: string; value: number; color: string }> = [
    { label: "Cargadas", value: cargadas, color: "bg-blue-500" },
    { label: "Descargadas", value: descargadas, color: "bg-sky-400" },
    { label: "Distribución", value: distribucion, color: "bg-cyan-500" },
  ]

  return (
    <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md border border-slate-200 rounded-xl h-full">
      <CardContent className="p-2 h-full flex flex-col gap-1.5">
        {/* Header compacto */}
        <div className="flex items-center gap-1.5">
          <div className="bg-blue-100 p-1 rounded-md">
            <Scale className="h-3.5 w-3.5 text-blue-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-bold text-slate-800 leading-tight">
              Toneladas
            </h3>
            <p className="text-[9px] text-slate-500 leading-tight">
              Movimiento total del día
            </p>
          </div>
          <span
            className={`inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded border ${pillTone}`}
          >
            {pillLabel}
          </span>
        </div>

        {/* Hero compacto */}
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold tabular-nums leading-none text-slate-900">
            {totalDia.toFixed(1)}
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            t ejecutadas
          </span>
          {programadas > 0 && (
            <span
              className={`ml-auto text-[9px] font-bold tabular-nums ${
                delta >= 0 ? "text-emerald-600" : "text-amber-700"
              }`}
            >
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(1)} vs prog.
            </span>
          )}
        </div>

        {/* Mix operativo */}
        <div className="flex flex-col gap-1 flex-1 justify-end">
          {canales.map((c) => {
            const pct = (c.value / denomMix) * 100
            return (
              <div key={c.label} className="flex items-center gap-1.5">
                <span className="text-[9px] text-slate-600 w-[68px] shrink-0">
                  {c.label}
                </span>
                <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden min-w-0">
                  <div
                    className={`h-full ${c.color} transition-[width] duration-500 ease-out`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[9px] font-bold tabular-nums text-slate-900 w-[36px] text-right shrink-0">
                  {c.value.toFixed(1)}
                </span>
              </div>
            )
          })}
          <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-slate-200">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
              Programadas
            </span>
            <span className="text-[11px] font-bold tabular-nums text-slate-700">
              {programadas.toFixed(1)}
              <span className="text-[9px] font-medium text-slate-500 ml-0.5">
                t
              </span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OrdenesKpiCard({ stats }: { stats: DashboardOperacionesStats | null }) {
  const porAsignar = stats?.ordenesPorAsignar ?? 0
  const porPesar = stats?.ordenesPorPesar ?? 0
  const enCola = stats?.ordenesEnCola ?? 0
  const enProceso = stats?.ordenesEnProceso ?? 0
  const finalizadas = stats?.ordenesFinalizadas ?? 0
  const totalDia = stats?.totalOrdenesDia ?? 0

  // Cumplimiento de ordenes: finalizadas / total. Esta es la lectura
  // gerencial: ¿que % del trabajo del dia esta cerrado?
  const pctFinalizadas = totalDia > 0 ? Math.round((finalizadas / totalDia) * 100) : 0
  const enRiesgo = porAsignar + porPesar // ordenes que aun no entran a la cola
  const pillTone =
    totalDia <= 0
      ? "bg-slate-100 text-slate-600 border-slate-200"
      : enRiesgo > 0
        ? "bg-red-50 text-red-700 border-red-200"
        : enCola > 0 || enProceso > 0
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-emerald-50 text-emerald-700 border-emerald-200"
  const pillLabel =
    totalDia <= 0
      ? "Sin órdenes"
      : enRiesgo > 0
        ? `${enRiesgo} sin lote/pesar`
        : pctFinalizadas >= 100
          ? "Cerrado"
          : "En curso"

  // Barra segmentada: descomposicion del total por estado, con
  // colores que comunican semantica (rojo=riesgo, ambar=espera,
  // azul=activo, verde=cerrado).
  type Seg = { key: string; label: string; value: number; color: string; pillBg: string; pillText: string }
  const segs: Seg[] = [
    { key: "sin-lote", label: "Sin lote", value: porAsignar, color: "bg-red-500", pillBg: "bg-red-50", pillText: "text-red-700" },
    { key: "por-pesar", label: "Por pesar", value: porPesar, color: "bg-orange-500", pillBg: "bg-orange-50", pillText: "text-orange-700" },
    { key: "cola", label: "En cola", value: enCola, color: "bg-amber-400", pillBg: "bg-amber-50", pillText: "text-amber-800" },
    { key: "proceso", label: "En proceso", value: enProceso, color: "bg-blue-500", pillBg: "bg-blue-50", pillText: "text-blue-700" },
    { key: "finalizadas", label: "Finalizadas", value: finalizadas, color: "bg-emerald-500", pillBg: "bg-emerald-50", pillText: "text-emerald-700" },
  ]
  const denom = Math.max(totalDia, 1)

  return (
    <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md border border-slate-200 rounded-xl h-full">
      <CardContent className="p-2 h-full flex flex-col gap-1.5">
        {/* Header compacto */}
        <div className="flex items-center gap-1.5">
          <div className="bg-purple-100 p-1 rounded-md">
            <ClipboardList className="h-3.5 w-3.5 text-purple-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-bold text-slate-800 leading-tight">
              Órdenes
            </h3>
            <p className="text-[9px] text-slate-500 leading-tight">
              Estado del flujo del día
            </p>
          </div>
          <span
            className={`inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded border ${pillTone}`}
          >
            {pillLabel}
          </span>
        </div>

        {/* Hero compacto */}
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold tabular-nums leading-none text-slate-900">
            {totalDia}
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            {totalDia === 1 ? "orden" : "órdenes"}
          </span>
          {totalDia > 0 && (
            <span className="ml-auto text-[9px] font-bold tabular-nums text-emerald-700">
              {pctFinalizadas}% cerrado
            </span>
          )}
        </div>

        {/* Barra segmentada compacta */}
        <div className="space-y-1 flex-1 flex flex-col justify-end">
          <div className="relative w-full h-2 rounded-full bg-slate-100 overflow-hidden flex">
            {segs.map((s) => (
              <div
                key={s.key}
                className={`h-full ${s.color} transition-[width] duration-500 ease-out`}
                style={{ width: `${(s.value / denom) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))}
          </div>
          {/* Chips con conteo */}
          <div className="grid grid-cols-5 gap-0.5">
            {segs.map((s) => (
              <div
                key={s.key}
                className={`flex flex-col items-center justify-center px-1 py-0.5 rounded ${s.pillBg}`}
                title={s.label}
              >
                <span
                  className={`text-[12px] font-bold tabular-nums leading-none ${s.pillText}`}
                >
                  {s.value}
                </span>
                <span className="text-[8px] text-slate-600 mt-0.5 truncate max-w-full">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PersonalKpiCard({ stats }: { stats: DashboardOperacionesStats | null }) {
  const total = stats?.personalDelDia?.total ?? 0
  const filas = stats?.personalDelDia?.porAsignacion ?? []
  const denom = Math.max(total, 1)

  // Top 4 asignaciones por volumen — el resto se agrupa en "Otros"
  // para que la tarjeta nunca pierda la legibilidad por exceso de
  // filas. Un gerente normalmente decide con el top.
  const sorted = [...filas].sort((a, b) => b.total - a.total)
  const top = sorted.slice(0, 4)
  const restoTotal = sorted.slice(4).reduce((s, r) => s + r.total, 0)
  const display = restoTotal > 0
    ? [...top, { asignacion: "Otros", total: restoTotal }]
    : top

  // Paleta secuencial verde para reforzar la identidad de "personal"
  // y diferenciarla de la barra de ordenes.
  const palette = ["bg-emerald-600", "bg-emerald-500", "bg-emerald-400", "bg-teal-400", "bg-slate-400"]

  const pillTone =
    total <= 0
      ? "bg-slate-100 text-slate-600 border-slate-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200"
  const pillLabel = total <= 0 ? "Sin asignaciones" : `${filas.length} grupos`

  return (
    <Card className="bg-gradient-to-br from-white to-emerald-50 shadow-md border border-emerald-200 rounded-xl h-full">
      <CardContent className="p-2 h-full flex flex-col gap-1.5">
        {/* Header compacto */}
        <div className="flex items-center gap-1.5">
          <div className="bg-emerald-100 p-1 rounded-md">
            <Users className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-bold text-slate-800 leading-tight">
              Personal
            </h3>
            <p className="text-[9px] text-slate-500 leading-tight">
              Asignaciones operativas
            </p>
          </div>
          <span
            className={`inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded border ${pillTone}`}
          >
            {pillLabel}
          </span>
        </div>

        {/* Hero compacto */}
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold tabular-nums leading-none text-slate-900">
            {total}
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            {total === 1 ? "persona" : "personas"} asignadas
          </span>
        </div>

        {/* Top asignaciones */}
        <div className="flex flex-col gap-1 flex-1 justify-end">
          {display.length > 0 ? (
            display.map((row, i) => {
              const pct = (row.total / denom) * 100
              return (
                <div
                  key={`${row.asignacion}-${i}`}
                  className="flex items-center gap-1.5"
                >
                  <span
                    className="text-[9px] text-slate-700 w-[80px] shrink-0 truncate font-medium"
                    title={row.asignacion}
                  >
                    {row.asignacion}
                  </span>
                  <div className="flex-1 h-1 rounded-full bg-emerald-100 overflow-hidden min-w-0">
                    <div
                      className={`h-full ${palette[i] ?? "bg-emerald-400"} transition-[width] duration-500 ease-out`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-bold tabular-nums text-slate-900 w-[24px] text-right shrink-0">
                    {row.total}
                  </span>
                </div>
              )
            })
          ) : (
            <div className="flex items-center justify-center text-[9px] text-slate-400 py-2">
              Sin personal asignado
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ──────────────────────────────────────────────────────────────────
 * Bloque "Vista de Mando" — paneles operativos detallados
 * Mismo lenguaje visual que los KPI tiles, pero con listas y un
 * grafico para responder al "como va cada cosa ahora mismo".
 * ────────────────────────────────────────────────────────────────── */

function VehiculosEnPatioPanel({
  stats,
}: {
  stats: DashboardOperacionesStats | null
}) {
  const items = stats?.vehiculosEnPatio ?? []
  const total = items.length
  return (
    <Card className="bg-gradient-to-br from-white to-orange-50 shadow-lg border-2 border-orange-200 rounded-2xl h-full">
      <CardContent className="p-2.5 h-full flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="bg-orange-100 p-1.5 rounded-lg">
            <ParkingCircle className="h-4 w-4 text-orange-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-800 leading-tight">Vehículos en patio</h3>
            <p className="text-[10px] text-slate-500 leading-tight">A la espera de operación</p>
          </div>
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-orange-50 text-orange-700 border-orange-200">
            {total} {total === 1 ? "unidad" : "unidades"}
          </span>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="lg-num text-2xl font-bold leading-none text-slate-900">
            {total}
          </span>
          <span className="text-xs text-slate-500 font-medium">en cola de atención</span>
        </div>

        <div className="flex-1 min-h-[74px] max-h-[160px] overflow-y-auto custom-scrollbar pr-1 space-y-1.5">
          {items.length > 0 ? (
            items.map((v, i) => (
              <div
                key={`${v.placa}-${i}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-orange-100 bg-white/70 px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Truck className="h-3.5 w-3.5 text-orange-600 shrink-0" aria-hidden />
                  <span className="font-mono font-bold text-xs text-slate-900 truncate">
                    {v.placa || "—"}
                  </span>
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-slate-700 shrink-0">
                  {v.horallegada || "—"}
                </span>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-center gap-1">
              <ParkingCircle className="h-6 w-6 text-orange-300" aria-hidden />
              <span className="text-[11px] font-semibold text-slate-600">Patio libre</span>
              <span className="text-[10px] text-slate-500">Sin vehículos esperando</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ClientesEnProcesoPanel({
  stats,
  formatTime,
}: {
  stats: DashboardOperacionesStats | null
  formatTime: (s: string | null) => string
}) {
  const items = stats?.clientesEnProceso ?? []
  const total = items.length

  // Identificamos demoras (> 60 min) para escalar el badge a alerta;
  // es la senal mas relevante para gerencia en este panel.
  const enDemora = items.reduce((acc, c) => {
    const min = parseTiempoEnMinutos(c.tiempo_en_proceso)
    return min !== null && min > 60 ? acc + 1 : acc
  }, 0)
  const pillTone =
    enDemora > 0
      ? "bg-red-50 text-red-700 border-red-200"
      : total > 0
        ? "bg-blue-50 text-blue-700 border-blue-200"
        : "bg-slate-100 text-slate-600 border-slate-200"
  const pillLabel =
    enDemora > 0
      ? `${enDemora} con demora`
      : total > 0
        ? "Tiempo OK"
        : "Sin operación"

  return (
    <Card className="bg-gradient-to-br from-white to-blue-50 shadow-lg border-2 border-blue-200 rounded-2xl h-full">
      <CardContent className="p-2.5 h-full flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="bg-blue-100 p-1.5 rounded-lg">
            <CheckCircle2 className="h-4 w-4 text-blue-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-800 leading-tight">Clientes en proceso</h3>
            <p className="text-[10px] text-slate-500 leading-tight">Operaciones activas en planta</p>
          </div>
          <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md border ${pillTone}`}>
            {pillLabel}
          </span>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="lg-num text-2xl font-bold leading-none text-slate-900">
            {total}
          </span>
          <span className="text-xs text-slate-500 font-medium">
            {total === 1 ? "cliente activo" : "clientes activos"}
          </span>
        </div>

        <div className="flex-1 min-h-[74px] max-h-[160px] overflow-y-auto custom-scrollbar pr-1 space-y-1.5">
          {items.length > 0 ? (
            items.map((c, i) => {
              const min = parseTiempoEnMinutos(c.tiempo_en_proceso)
              const esLargo = min !== null && min > 60
              return (
                <div
                  key={`${c.cliente}-${i}`}
                  className={`rounded-lg border px-2.5 py-1.5 ${
                    esLargo ? "border-red-200 bg-red-50" : "border-blue-100 bg-white/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-xs font-bold text-slate-900 truncate" title={c.cliente}>
                      {c.cliente || "Cliente"}
                    </span>
                    {esLargo && (
                      <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" aria-hidden />
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <Timer className="h-3 w-3" aria-hidden />
                      Inicio {formatTime(c.iniciocargue)}
                    </span>
                    <span
                      className={`font-bold tabular-nums ${
                        esLargo ? "text-red-600" : "text-slate-700"
                      }`}
                    >
                      {formatTime(c.tiempo_en_proceso)}
                    </span>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-center gap-1">
              <CheckCircle2 className="h-6 w-6 text-blue-300" aria-hidden />
              <span className="text-[11px] font-semibold text-slate-600">Sin operaciones activas</span>
              <span className="text-[10px] text-slate-500">No hay clientes siendo atendidos</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ProgramacionHoraPanel({
  programacionPorHora,
  totalProgramadoTon,
}: {
  programacionPorHora: Array<{
    hora: number
    label: string
    toneladas: number
    ordenes: number
    esPico: boolean
  }>
  totalProgramadoTon: number
}) {
  const horaPico = programacionPorHora.find((b) => b.esPico)
  return (
    <Card className="bg-gradient-to-br from-white to-slate-50 shadow-lg border-2 border-slate-200 rounded-2xl h-full">
      <CardContent className="p-2.5 h-full flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="bg-blue-100 p-1.5 rounded-lg">
            <BarChart3 className="h-4 w-4 text-blue-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-800 leading-tight">Programación por hora</h3>
            <p className="text-[10px] text-slate-500 leading-tight">Carga horaria 06:00 — 18:00</p>
          </div>
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-blue-50 text-blue-700 border-blue-200">
            {totalProgramadoTon.toFixed(1)} t
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="lg-num text-2xl font-bold leading-none text-slate-900">
            {totalProgramadoTon.toFixed(1)}
          </span>
          <span className="text-xs text-slate-500 font-medium">t programadas</span>
          {horaPico && (
            <span className="ml-auto text-[10px] font-semibold text-orange-600">
              Pico {horaPico.label} · {horaPico.toneladas.toFixed(1)} t
            </span>
          )}
        </div>

        {totalProgramadoTon === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 min-h-[140px] text-slate-400 gap-1">
            <BarChart3 className="h-6 w-6 opacity-50" aria-hidden />
            <span className="text-[11px]">Sin programación</span>
          </div>
        ) : (
          <div className="flex-1 min-h-[160px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={programacionPorHora}
                layout="vertical"
                margin={{ top: 0, right: 28, left: 0, bottom: 0 }}
                barCategoryGap="15%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                  hide
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "#475569" }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: "rgba(59, 130, 246, 0.08)" }}
                  contentStyle={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    fontSize: 10,
                    padding: "4px 8px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  }}
                  labelFormatter={(label) => `Hora ${label}`}
                  formatter={(value: number, _name, item) => {
                    const ord = (item?.payload as { ordenes?: number })?.ordenes ?? 0
                    return [
                      `${value.toFixed(1)} t · ${ord} ${ord === 1 ? "orden" : "órdenes"}`,
                      "Programado",
                    ]
                  }}
                />
                <Bar
                  dataKey="toneladas"
                  radius={[0, 3, 3, 0]}
                  label={{
                    position: "right",
                    fill: "#475569",
                    fontSize: 9,
                    formatter: (value: number) => (value > 0 ? value.toFixed(1) : ""),
                  }}
                >
                  {programacionPorHora.map((entry) => (
                    <Cell key={entry.hora} fill={entry.esPico ? "#f97316" : "#3b82f6"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 border-t border-slate-200 pt-1.5">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-[#3b82f6]" />
            Toneladas
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-[#f97316]" />
            Hora pico
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
