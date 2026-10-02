"use client"

import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Hourglass,
  MapPin,
  Package,
  Truck,
  XCircle,
} from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { KpiCard } from "./kpi-card"
import { PeriodFilter, usePeriodFilter } from "./period-filter"
import {
  calcAlertasCumplimiento,
  calcCargaTrabajoPorFecha,
  calcCargaTrabajoResumen,
  getBogotaCurrentYearMonth,
  calcDelayDaysProm,
  calcLeadTimePorMes,
  calcLeadTimePromesaProm,
  calcLeadTimeRealProm,
  calcResumenEntregas,
  fmtCOP,
  fmtFloat1,
  fmtInt,
} from "./calculations"
import type {
  CargaTrabajoPedidoItem,
  CargaTrabajoPorFecha,
  CargaTrabajoResumen,
} from "./calculations"
import type { PedidoCabecera, PedidoDetalle } from "./types"

interface Props {
  cabecera: PedidoCabecera[]
  detalle: PedidoDetalle[]
}

/**
 * Tab 2: Tiempos y Cuellos de Botella.
 *
 * Estructura:
 *   - PeriodFilter (Año/Mes) afecta TODO el contenido de la tab.
 *   - Fila 1: 5 KPI cards.
 *   - Fila 2: LineChart "Tiempo de entrega mes a mes" (reemplaza el
 *     scatter de cartera) — promedio real vs promesa por mes.
 *   - Fila 3: Carga de Trabajo por fecha programada (stacked bar +
 *     KPIs) — toneladas y pedidos entregados vs pendientes por dia.
 *   - Fila 4: Tabla de alertas de cartera.
 */
export function TiemposCuellosTab({ cabecera, detalle }: Props) {
  // Pasamos `detalle` al hook de filtro asi cuando el usuario filtra
  // por anio/mes (sobre `pedidoscabecera.fecha`), tambien recortamos
  // las lineas de detalle por idpedido y la carga de trabajo refleja
  // SOLO los pedidos del periodo elegido.
  const filter = usePeriodFilter(cabecera, detalle)
  const cab = filter.filteredCabecera
  const det = filter.filteredDetalle

  const kpis = useMemo(() => {
    const resumen = calcResumenEntregas(cab)
    const evaluables = resumen.aTiempo + resumen.atrasados
    const cumplimientoPct =
      evaluables > 0 ? (resumen.aTiempo / evaluables) * 100 : 0
    const leadReal = calcLeadTimeRealProm(cab)
    const leadPromesa = calcLeadTimePromesaProm(cab)
    const delay = calcDelayDaysProm(cab)
    return {
      leadReal,
      leadPromesa,
      delta: leadReal - leadPromesa,
      delay,
      aTiempo: resumen.aTiempo,
      atrasados: resumen.atrasados,
      cumplimientoPct,
    }
  }, [cab])

  const leadTimePorMes = useMemo(() => calcLeadTimePorMes(cab), [cab])

  // Carga de trabajo: por DEFAULT muestra el mes actual (Bogota)
  // independientemente del filtro de periodo del resto de la tab,
  // pero ahora el usuario puede navegar a cualquier (anio, mes) via
  // selectores propios de la card para revisar carga de meses
  // anteriores o posteriores. Trabajamos sobre la data ORIGINAL
  // (`cabecera`/`detalle`), no sobre `cab`/`det`, para que el filtro
  // de periodo de la tab no enmascare meses no seleccionados ahi.
  const mesActual = useMemo(() => getBogotaCurrentYearMonth(), [])
  const [cargaYear, setCargaYear] = useState<number>(mesActual.year)
  const [cargaMonth, setCargaMonth] = useState<number>(mesActual.month)

  // Lista de años con `fecha_programada` (descendente). Si el año
  // actual no aparece en la data lo agregamos igual: el usuario
  // siempre debe poder ver el mes en curso aunque aun no haya
  // pedidos cargados.
  const cargaYearsDisponibles = useMemo(() => {
    const set = new Set<number>()
    for (const c of cabecera) {
      const fp = c.fecha_programada
      if (!fp) continue
      const y = Number(fp.slice(0, 4))
      if (Number.isFinite(y)) set.add(y)
    }
    set.add(mesActual.year)
    return Array.from(set).sort((a, b) => b - a)
  }, [cabecera, mesActual.year])

  // Prefijo "YYYY-MM" para filtrar `fecha_programada` con startsWith.
  const cargaPrefix = useMemo(
    () =>
      `${cargaYear.toString().padStart(4, "0")}-${cargaMonth.toString().padStart(2, "0")}`,
    [cargaYear, cargaMonth],
  )
  // Etiqueta humana ("Marzo 2025") derivada del par seleccionado.
  // Construimos un Date estable a mediodia UTC para evitar offset
  // que corra el dia al mes anterior en zonas horarias negativas.
  const cargaMesLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      month: "long",
      year: "numeric",
    })
    const d = new Date(`${cargaPrefix}-15T12:00:00Z`)
    return fmt.format(d).replace(/^./, (ch) => ch.toUpperCase())
  }, [cargaPrefix])

  const cargaEsMesActual =
    cargaYear === mesActual.year && cargaMonth === mesActual.month

  const cargaTrabajoCabecera = useMemo(() => {
    return cabecera.filter(
      (c) => c.fecha_programada?.slice(0, 7) === cargaPrefix,
    )
  }, [cabecera, cargaPrefix])
  const cargaTrabajoDetalle = useMemo(() => {
    if (cargaTrabajoCabecera.length === 0) return []
    const ids = new Set(cargaTrabajoCabecera.map((c) => c.idpedido))
    return detalle.filter((d) => ids.has(d.idpedido))
  }, [cargaTrabajoCabecera, detalle])
  const cargaTrabajo = useMemo(
    () => calcCargaTrabajoPorFecha(cargaTrabajoCabecera, cargaTrabajoDetalle),
    [cargaTrabajoCabecera, cargaTrabajoDetalle],
  )
  const cargaTrabajoResumen = useMemo(
    () => calcCargaTrabajoResumen(cargaTrabajo),
    [cargaTrabajo],
  )

  // Navegacion mes anterior / siguiente. Manejamos el rebase de
  // diciembre <-> enero ajustando el año automaticamente. No
  // restringimos a los años "disponibles" para que el usuario
  // pueda mirar meses sin data y ver el empty state apropiado.
  const irMesAnterior = () => {
    if (cargaMonth === 1) {
      setCargaMonth(12)
      setCargaYear((y) => y - 1)
    } else {
      setCargaMonth((m) => m - 1)
    }
  }
  const irMesSiguiente = () => {
    if (cargaMonth === 12) {
      setCargaMonth(1)
      setCargaYear((y) => y + 1)
    } else {
      setCargaMonth((m) => m + 1)
    }
  }
  const irHoy = () => {
    setCargaYear(mesActual.year)
    setCargaMonth(mesActual.month)
  }
  const alertasCumplimiento = useMemo(
    () => calcAlertasCumplimiento(cab),
    [cab],
  )
  // Resumen para los chips del header de la tabla.
  const cumplimientoStats = useMemo(() => {
    let atrasados = 0
    let venceHoy = 0
    let porVencer = 0
    for (const a of alertasCumplimiento) {
      if (a.estado === "Atrasado") atrasados++
      else if (a.estado === "Vence hoy") venceHoy++
      else porVencer++
    }
    return {
      atrasados,
      venceHoy,
      porVencer,
      total: alertasCumplimiento.length,
    }
  }, [alertasCumplimiento])

  // Promedio movil de los ultimos 3 meses para insight rapido.
  const ultimo3MesesPromedio = useMemo(() => {
    if (leadTimePorMes.length === 0) return 0
    const tail = leadTimePorMes.slice(-3)
    const sum = tail.reduce((acc, r) => acc + r.leadTimeReal, 0)
    return sum / tail.length
  }, [leadTimePorMes])

  return (
    <div className="space-y-4">
      {/* Filtro de periodo */}
      <PeriodFilter
        year={filter.year}
        month={filter.month}
        day={filter.day}
        setYear={filter.setYear}
        setMonth={filter.setMonth}
        setDay={filter.setDay}
        years={filter.years}
        days={filter.days}
        reset={filter.reset}
        isActive={filter.isActive}
        totalPedidos={filter.meta.totalPedidos}
        filteredPedidos={filter.meta.filteredPedidos}
      />

      {/* Fila 1: KPIs de tiempo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Lead Time Prometido"
          value={`${fmtFloat1(kpis.leadPromesa)} d`}
          icon={CalendarClock}
          variant="primary"
          subtext="fecha_programada − fecha"
        />
        <KpiCard
          label="Lead Time Real"
          value={`${fmtFloat1(kpis.leadReal)} d`}
          icon={Hourglass}
          variant={kpis.delta > 0 ? "warning" : "success"}
          subtext="fechaordencargue − fecha"
          footer={
            kpis.leadPromesa > 0 || kpis.leadReal > 0 ? (
              <p
                className={`text-[11px] font-medium ${
                  kpis.delta > 0
                    ? "text-destructive"
                    : "text-[var(--chart-3)]"
                }`}
              >
                {kpis.delta > 0 ? "▲" : "▼"} {fmtFloat1(Math.abs(kpis.delta))} d
                vs promesa
              </p>
            ) : null
          }
        />
        <KpiCard
          label="Pedidos a Tiempo"
          value={fmtInt(kpis.aTiempo)}
          icon={CheckCircle2}
          variant="success"
          subtext={`${fmtFloat1(kpis.cumplimientoPct)}% cumplimiento`}
        />
        <KpiCard
          label="Pedidos Atrasados"
          value={fmtInt(kpis.atrasados)}
          icon={XCircle}
          variant="danger"
          subtext="entrega > programada"
        />
        <KpiCard
          label="Retraso Promedio"
          value={kpis.delay > 0 ? `${fmtFloat1(kpis.delay)} d` : "—"}
          icon={AlertTriangle}
          variant="warning"
          subtext="solo pedidos atrasados"
        />
      </div>

      {/* Fila 2: Tiempo de entrega mes a mes (reemplaza el scatter) */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-[var(--chart-4)]" />
                Tiempo de Entrega Mes a Mes
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Días promedio que se tardan los pedidos por mes (creación →
                entrega real). Compara contra la promesa al cliente.
              </p>
            </div>
            {leadTimePorMes.length > 0 ? (
              <div className="flex flex-col items-end gap-0.5 shrink-0 rounded-md bg-muted/40 px-3 py-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Últ. 3 meses
                </span>
                <span className="text-sm font-bold tabular-nums">
                  {fmtFloat1(ultimo3MesesPromedio)} días
                </span>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {leadTimePorMes.length === 0 ? (
            <EmptyState text="No hay pedidos con fechas suficientes en el periodo seleccionado." />
          ) : (
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={leadTimePorMes}
                  margin={{ top: 8, right: 24, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}d`}
                  />
                  <Tooltip
                    cursor={{
                      stroke: "var(--border)",
                      strokeDasharray: "3 3",
                    }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload as {
                        label: string
                        leadTimeReal: number
                        leadTimePromesa: number
                        delay: number
                        pedidos: number
                      }
                      return (
                        <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm min-w-[180px]">
                          <p className="font-semibold mb-1">{label}</p>
                          <div className="grid gap-0.5">
                            <Row
                              color="var(--chart-3)"
                              label="Prometido"
                              value={`${fmtFloat1(p.leadTimePromesa)} días`}
                            />
                            <Row
                              color="var(--chart-5)"
                              label="Real"
                              value={`${fmtFloat1(p.leadTimeReal)} días`}
                            />
                            <Row
                              color={
                                p.delay > 0
                                  ? "var(--destructive)"
                                  : "var(--chart-3)"
                              }
                              label="Δ vs promesa"
                              value={`${p.delay > 0 ? "+" : ""}${fmtFloat1(
                                p.delay,
                              )} d`}
                            />
                            <div className="border-t border-border mt-1 pt-1 text-muted-foreground">
                              {fmtInt(p.pedidos)} pedidos
                            </div>
                          </div>
                        </div>
                      )
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                    formatter={(v) =>
                      v === "leadTimePromesa"
                        ? "Prometido"
                        : v === "leadTimeReal"
                          ? "Real"
                          : v
                    }
                  />
                  <ReferenceLine
                    y={ultimo3MesesPromedio}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    label={{
                      value: `Promedio ${fmtFloat1(ultimo3MesesPromedio)}d`,
                      position: "insideTopRight",
                      fill: "var(--muted-foreground)",
                      fontSize: 10,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="leadTimePromesa"
                    stroke="var(--chart-3)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "var(--chart-3)" }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="leadTimeReal"
                    stroke="var(--chart-5)"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "var(--chart-5)" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fila 3: Carga de Trabajo proyectada por fecha programada.
          Reemplaza al antiguo "Promesa vs Realidad" porque la lectura
          ejecutiva mas accionable para el equipo de logistica es saber
          cuantas toneladas y cuantos pedidos tienen que mover cada dia
          (entregados vs pendientes, con el rojo para atrasos). */}
      <CargaTrabajoCard
        rows={cargaTrabajo}
        resumen={cargaTrabajoResumen}
        mesLabel={cargaMesLabel}
        year={cargaYear}
        month={cargaMonth}
        years={cargaYearsDisponibles}
        onYearChange={setCargaYear}
        onMonthChange={setCargaMonth}
        onPrev={irMesAnterior}
        onNext={irMesSiguiente}
        onResetHoy={irHoy}
        esMesActual={cargaEsMesActual}
      />

      {/* Fila 4: Alertas de Cumplimiento */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Alertas de Cumplimiento
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Pedidos con <code className="rounded bg-muted px-1">fecha_programada</code>{" "}
                pendientes de entrega (sin{" "}
                <code className="rounded bg-muted px-1">fechaordencargue</code>). Atrasados
                primero.
              </p>
            </div>
            {cumplimientoStats.total > 0 ? (
              <div className="flex flex-wrap gap-2 shrink-0">
                <StatChip
                  label="Atrasados"
                  value={cumplimientoStats.atrasados}
                  tone="danger"
                />
                <StatChip
                  label="Vencen hoy"
                  value={cumplimientoStats.venceHoy}
                  tone="warning"
                />
                <StatChip
                  label="Por vencer"
                  value={cumplimientoStats.porVencer}
                  tone="muted"
                />
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {alertasCumplimiento.length === 0 ? (
            <EmptyState text="No hay pedidos pendientes de entrega con fecha programada." />
          ) : (
            <div className="rounded-md border max-h-[420px] overflow-auto relative">
              <table className="w-full caption-bottom text-sm border-separate border-spacing-0">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-20 bg-background border-b whitespace-nowrap">
                      ID Pedido
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b">
                      Cliente
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b whitespace-nowrap">
                      Fecha Pedido
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b whitespace-nowrap">
                      Fecha Promesa
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-right whitespace-nowrap">
                      Días en pipeline
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-right whitespace-nowrap">
                      Estado
                    </TableHead>
                    <TableHead className="sticky top-0 z-20 bg-background border-b text-right whitespace-nowrap">
                      Total a Pagar
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alertasCumplimiento.map((a) => (
                    <TableRow key={a.idpedido}>
                      <TableCell className="font-medium tabular-nums">
                        #{a.idpedido}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate" title={a.cliente}>
                        {a.cliente}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {a.fecha ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {a.fecha_programada}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {a.diasDesdeCreacion !== null
                          ? `${fmtInt(a.diasDesdeCreacion)} d`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <CumplimientoBadge
                          estado={a.estado}
                          dias={a.diasParaCumplir}
                        />
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtCOP(a.total_pagar)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Pequena fila color-label-valor para el tooltip del LineChart. */
function Row({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-muted-foreground">{label}</span>
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

/**
 * Chip compacto para el header de la tabla: dot de color + label + valor.
 * Usa los design tokens para que respete el theme y evita color hex
 * directo. `tone` mapea a `var(--destructive)` / `var(--chart-4)` /
 * `var(--muted-foreground)` segun la criticidad.
 */
function StatChip({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "danger" | "warning" | "muted"
}) {
  const dotColor =
    tone === "danger"
      ? "var(--destructive)"
      : tone === "warning"
        ? "var(--chart-4)"
        : "var(--muted-foreground)"
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px]">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: dotColor }}
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{fmtInt(value)}</span>
    </span>
  )
}

/**
 * Badge de estado para la columna "Estado" de la tabla.
 *   - Atrasado  -> destructive, "Atrasado N d"
 *   - Vence hoy -> warning,     "Vence hoy"
 *   - Por vencer-> success,     "Faltan N d"
 *
 * Usa colores derivados de tokens (--destructive, --chart-4, --chart-3)
 * con fondo `/15` para que el chip tenga contraste sin gritarse.
 */
function CumplimientoBadge({
  estado,
  dias,
}: {
  estado: "Atrasado" | "Vence hoy" | "Por vencer"
  dias: number
}) {
  let bg: string
  let fg: string
  let text: string
  if (estado === "Atrasado") {
    bg = "color-mix(in oklch, var(--destructive) 18%, transparent)"
    fg = "var(--destructive)"
    text = `Atrasado ${fmtInt(Math.abs(dias))} d`
  } else if (estado === "Vence hoy") {
    bg = "color-mix(in oklch, var(--chart-4) 18%, transparent)"
    fg = "var(--chart-4)"
    text = "Vence hoy"
  } else {
    bg = "color-mix(in oklch, var(--chart-3) 18%, transparent)"
    fg = "var(--chart-3)"
    text = `Faltan ${fmtInt(dias)} d`
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: bg, color: fg }}
    >
      {text}
    </span>
  )
}

/* ──────────────────────────────────────────────────────────────────
 * Carga de Trabajo por Fecha Programada
 *
 * Pensada como vista de planeacion para el equipo de logistica:
 *
 *   - Tira superior con 3 KPIs: Toneladas pendientes / Pedidos
 *     pendientes / Atrasados (cuando aplica). Da el foco en la
 *     primera mirada.
 *
 *   - Stacked BarChart (toneladas) por dia con dos series:
 *       · Entregadas (verde, var(--chart-3))
 *       · Pendientes (azul, var(--chart-4)) — pero si la fecha es
 *         pasada y aun tiene pendientes, las pintamos en rojo
 *         (var(--destructive)) usando <Cell> para escalar la senal
 *         de "atraso" sin tener que partir la serie.
 *
 *   - Tooltip explicito con conteo de pedidos por estado y suma de
 *     toneladas para que el lider de turno pueda planificar.
 *
 * Si no hay datos, mostramos un EmptyState con guia clara.
 * ────────────────────────────────────────────────────────────────── */
// Lista de meses para el navegador de la card "Carga de Trabajo".
// Local al componente para no chocar con la constante MESES de
// `period-filter.tsx` (cuyo formato podria diferir si cambia).
const MESES_CARGA = [
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
] as const

function CargaTrabajoCard({
  rows,
  resumen,
  mesLabel,
  year,
  month,
  years,
  onYearChange,
  onMonthChange,
  onPrev,
  onNext,
  onResetHoy,
  esMesActual,
}: {
  rows: CargaTrabajoPorFecha[]
  resumen: CargaTrabajoResumen
  mesLabel: string
  year: number
  month: number
  years: number[]
  onYearChange: (y: number) => void
  onMonthChange: (m: number) => void
  onPrev: () => void
  onNext: () => void
  onResetHoy: () => void
  esMesActual: boolean
}) {
  // Solo dias con carga POR HACER (pendientes o atrasadas). Los dias
  // completamente entregados se omiten porque no aportan informacion
  // accionable para el equipo de logistica: la pregunta es "que tengo
  // que mover", no "que ya moví".
  const diasVisibles = useMemo(
    () => rows.filter((r) => r.pedidosPendientes > 0),
    [rows],
  )

  const totalToneladas = useMemo(
    () => rows.reduce((acc, r) => acc + r.toneladasTotal, 0),
    [rows],
  )

  // Estado de expansion: la fecha del unico dia abierto a la vez. Asi
  // evitamos que la lista crezca indefinidamente cuando el usuario
  // abre varios dias y mantenemos la vista enfocada en uno.
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null)

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base flex-wrap">
              <CalendarRange className="h-4 w-4 text-[var(--chart-4)]" />
              Carga de Trabajo por Fecha Programada
              <span
                className="ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap"
                style={
                  esMesActual
                    ? {
                        backgroundColor:
                          "color-mix(in oklch, var(--chart-4) 14%, transparent)",
                        color: "var(--chart-4)",
                      }
                    : {
                        backgroundColor: "var(--muted)",
                        color: "var(--muted-foreground)",
                      }
                }
              >
                {mesLabel}
              </span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Pedidos agrupados por{" "}
              <code className="rounded bg-muted px-1">fecha_programada</code>.
              Toneladas{" "}
              <code className="rounded bg-muted px-1">Σ peso ÷ 1000</code>{" "}
              desde <code className="rounded bg-muted px-1">pedidosdetalle</code>.
              Usa los controles para revisar otros meses.
            </p>
          </div>

          {/* Navegador de periodo: flechas prev/next + selects de
              mes y año + boton "Hoy" para volver al mes en curso.
              Vive dentro de la card porque es un control especifico
              de "Carga de Trabajo" (no afecta a las otras cards de
              esta pestana). */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onPrev}
              aria-label="Mes anterior"
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Select
              value={String(month)}
              onValueChange={(v) => onMonthChange(Number(v))}
            >
              <SelectTrigger
                className="h-8 w-[130px] text-xs"
                aria-label="Seleccionar mes"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MESES_CARGA.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={String(year)}
              onValueChange={(v) => onYearChange(Number(v))}
            >
              <SelectTrigger
                className="h-8 w-[90px] text-xs"
                aria-label="Seleccionar año"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onNext}
              aria-label="Mes siguiente"
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            {!esMesActual ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onResetHoy}
                className="h-8 px-2 text-xs"
                title="Volver al mes en curso"
              >
                Hoy
              </Button>
            ) : null}
          </div>
        </div>

        {/* Hero stat: Toneladas pendientes — la pregunta principal del
            equipo de logistica ("¿cuanto tengo por mover este mes?")
            merece el numero mas grande y destacado. Los KPIs
            secundarios (pedidos / atrasados / total) se muestran como
            tiles compactas alrededor para dar contexto sin competir
            por la atencion. */}
        {rows.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <HeroPendientesTile
              toneladas={resumen.toneladasPendientes}
              pedidos={resumen.pedidosPendientes}
            />
            <SecondaryTile
              icon={<Truck className="h-3.5 w-3.5" />}
              label="Pedidos pendientes"
              value={fmtInt(resumen.pedidosPendientes)}
              hint={`${fmtInt(resumen.diasFuturoConPendientes)} ${resumen.diasFuturoConPendientes === 1 ? "día" : "días"} con carga`}
              tone="muted"
            />
            <SecondaryTile
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              label="Atrasados"
              value={
                resumen.pedidosAtrasados > 0
                  ? fmtInt(resumen.pedidosAtrasados)
                  : "0"
              }
              hint={
                resumen.pedidosAtrasados > 0
                  ? `${fmtFloat1(resumen.toneladasAtrasadas)} t por mover`
                  : "Sin atrasos"
              }
              tone={resumen.pedidosAtrasados > 0 ? "danger" : "muted"}
            />
            <SecondaryTile
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              label="Programación total"
              value={fmtInt(
                resumen.pedidosPendientes +
                  rows.reduce((acc, r) => acc + r.pedidosEntregados, 0),
              )}
              hint={`${fmtFloat1(rows.reduce((acc, r) => acc + r.toneladasTotal, 0))} t en ${mesLabel}`}
              tone="muted"
            />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <EmptyState
            text={`No hay pedidos con fecha_programada en ${mesLabel}.`}
          />
        ) : diasVisibles.length === 0 ? (
          // Caso "todo entregado": hay programacion del mes pero
          // ningun dia con pendientes/atrasadas. Es buena noticia, asi
          // que mostramos un mensaje afirmativo en vez del estado
          // generico de "sin datos".
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{
                backgroundColor:
                  "color-mix(in oklch, var(--chart-3) 18%, transparent)",
                color: "var(--chart-3)",
              }}
            >
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="text-sm font-semibold">
              Todo entregado en {mesLabel}
            </div>
            <div className="text-xs text-muted-foreground max-w-[280px]">
              No hay pedidos pendientes ni atrasados con fecha programada
              en este periodo. Excelente trabajo del equipo.
            </div>
          </div>
        ) : (
          <>
            {/* Grilla de tarjetas-dia. Cada card resume el dia y se
                puede expandir para ver el listado de pedidos con
                cliente/destino/toneladas. Solo un dia abierto a la
                vez para no saturar la vista. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {diasVisibles.map((d) => (
                <DiaCard
                  key={d.fecha}
                  dia={d}
                  expandido={diaAbierto === d.fecha}
                  onToggle={() =>
                    setDiaAbierto((prev) => (prev === d.fecha ? null : d.fecha))
                  }
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground border-t border-border/50 pt-2">
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: "var(--chart-4)" }}
                  />
                  Pendientes
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: "var(--destructive)" }}
                  />
                  Atrasadas
                </span>
                <span className="hidden sm:inline">
                  · Click en cualquier día para ver el listado de pedidos
                </span>
              </span>
              <span className="tabular-nums">
                {diasVisibles.length}{" "}
                {diasVisibles.length === 1 ? "día" : "días"} con carga
                pendiente · {fmtFloat1(resumen.toneladasPendientes)} t por
                procesar
                {totalToneladas > resumen.toneladasPendientes
                  ? ` · ${fmtFloat1(totalToneladas - resumen.toneladasPendientes)} t ya entregadas`
                  : ""}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Tile hero del header de "Carga de Trabajo": muestra las toneladas
 * pendientes del mes con un numero grande y dominante. Es la unica
 * pregunta que el equipo de logistica responde al primer vistazo.
 *
 * Usamos `--chart-4` (el mismo azul de la serie "Pendientes" del
 * grafico) para que el ojo lo asocie inmediatamente. Cuando hay 0
 * pendientes degradamos el tono a muted/verde para no llamar la
 * atencion sobre algo que ya esta resuelto.
 */
function HeroPendientesTile({
  toneladas,
  pedidos,
}: {
  toneladas: number
  pedidos: number
}) {
  const limpio = toneladas <= 0 && pedidos <= 0
  const accent = limpio ? "var(--chart-3)" : "var(--chart-4)"
  return (
    <div
      className="col-span-2 rounded-xl border p-3 flex items-center gap-3"
      style={{
        borderColor: `color-mix(in oklch, ${accent} 35%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${accent} 10%, transparent)`,
      }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
        style={{
          backgroundColor: `color-mix(in oklch, ${accent} 22%, transparent)`,
          color: accent,
        }}
      >
        <Package className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="lg-eyebrow">
          Toneladas pendientes
        </div>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span
            className="text-2xl font-bold tabular-nums leading-none"
            style={{ color: accent }}
          >
            {fmtFloat1(toneladas)}
          </span>
          <span
            className="text-sm font-semibold"
            style={{ color: accent }}
          >
            t
          </span>
          <span className="text-[11px] text-muted-foreground ml-1 truncate">
            · {fmtInt(pedidos)} {pedidos === 1 ? "pedido" : "pedidos"} por procesar
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Tile compacta para los KPIs secundarios del header. Mantiene el
 * mismo lenguaje visual que la hero pero con jerarquia inferior:
 * numero pequeno, una linea de hint debajo.
 */
function SecondaryTile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  tone: "muted" | "danger"
}) {
  const palette: Record<
    typeof tone,
    { bg: string; fg: string; border: string; iconBg: string }
  > = {
    muted: {
      bg: "var(--card)",
      fg: "var(--foreground)",
      border: "var(--border)",
      iconBg: "var(--muted)",
    },
    danger: {
      bg: "color-mix(in oklch, var(--destructive) 8%, transparent)",
      fg: "var(--destructive)",
      border: "color-mix(in oklch, var(--destructive) 35%, transparent)",
      iconBg: "color-mix(in oklch, var(--destructive) 18%, transparent)",
    },
  }
  const p = palette[tone]
  return (
    <div
      className="rounded-xl border p-2.5 flex items-center gap-2"
      style={{ backgroundColor: p.bg, borderColor: p.border }}
    >
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
        style={{ backgroundColor: p.iconBg, color: p.fg }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground truncate">
          {label}
        </div>
        <div
          className="text-base font-bold tabular-nums leading-tight"
          style={{ color: p.fg }}
        >
          {value}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          {hint}
        </div>
      </div>
    </div>
  )
}

/**
 * Tarjeta de UN dia. Diseño:
 *
 *   ┌────────────────────────────────────────────┐
 *   │ Lun 15 nov                  [Atrasado]     │  <- header tonificado
 *   │ ────────────────────────────────────────── │
 *   │  4.2 t                                     │  <- numero hero
 *   │  pendientes                                │
 *   │  ────                                      │
 *   │  3 pedidos por mover · 1 entregado         │
 *   │                                            │
 *   │  Ver pedidos              ▾                │  <- toggle
 *   └────────────────────────────────────────────┘
 *
 * Toda la card es clickable (button accesible) y al expandir muestra
 * la lista de pedidos del dia. Para mantenernos accesibles usamos
 * `aria-expanded` y `aria-controls`.
 *
 * Tono visual:
 *   - Atrasado  -> rojo (var(--destructive))
 *   - Hoy       -> azul (var(--chart-4)) destacado con ring
 *   - Futuro    -> azul (var(--chart-4))
 */
function DiaCard({
  dia,
  expandido,
  onToggle,
}: {
  dia: CargaTrabajoPorFecha
  expandido: boolean
  onToggle: () => void
}) {
  const accent = dia.esAtrasado
    ? "var(--destructive)"
    : "var(--chart-4)"
  const tag = dia.esAtrasado
    ? "Atrasado"
    : dia.esHoy
      ? "Hoy"
      : dia.esFuturo
        ? "Próximo"
        : "Pasado"

  const panelId = `dia-pedidos-${dia.fecha}`
  return (
    <div
      className={`rounded-xl border bg-card transition-shadow ${
        expandido ? "shadow-md" : "hover:shadow-sm"
      } ${dia.esHoy ? "ring-1" : ""}`}
      style={{
        borderColor: expandido
          ? `color-mix(in oklch, ${accent} 50%, transparent)`
          : "var(--border)",
        ...(dia.esHoy
          ? ({
              ["--tw-ring-color" as string]: accent,
            } as React.CSSProperties)
          : {}),
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expandido}
        aria-controls={panelId}
        className="w-full text-left p-3 flex flex-col gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-xl"
        style={{ ["--tw-ring-color" as string]: accent } as React.CSSProperties}
      >
        {/* Header: fecha + tag de estado */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-foreground truncate">
            {dia.label}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap"
            style={{
              backgroundColor: `color-mix(in oklch, ${accent} 14%, transparent)`,
              color: accent,
            }}
          >
            {tag}
          </span>
        </div>

        {/* Numero hero: toneladas pendientes */}
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-2xl font-bold tabular-nums leading-none"
            style={{ color: accent }}
          >
            {fmtFloat1(dia.toneladasPendientes)}
          </span>
          <span
            className="text-sm font-semibold"
            style={{ color: accent }}
          >
            t
          </span>
          <span className="lg-eyebrow ml-1">
            pendientes
          </span>
        </div>

        {/* Conteo + entregadas como texto secundario */}
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Truck className="h-3 w-3" />
            {fmtInt(dia.pedidosPendientes)}{" "}
            {dia.pedidosPendientes === 1 ? "pedido" : "pedidos"} por mover
          </span>
          {dia.pedidosEntregados > 0 ? (
            <span className="inline-flex items-center gap-1 text-[var(--chart-3)]">
              <CheckCircle2 className="h-3 w-3" />
              {fmtInt(dia.pedidosEntregados)} entregado
              {dia.pedidosEntregados === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {/* Toggle visual al pie */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50 mt-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {expandido ? "Ocultar pedidos" : "Ver pedidos"}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              expandido ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {expandido ? (
        <div id={panelId} className="border-t border-border/60">
          <PedidoLista pedidos={dia.pedidos} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Lista de pedidos para el dia expandido.
 *
 * Filas con: # pedido, cliente (lo mas importante), destino y
 * toneladas. Pintamos un punto a la izquierda con el color del
 * estado (azul=pendiente, verde=entregado, rojo=atrasado-implicito
 * cuando aplique a la card padre). Con scroll interno cuando la
 * lista crece para no romper el grid.
 */
function PedidoLista({
  pedidos,
}: {
  pedidos: CargaTrabajoPedidoItem[]
}) {
  if (pedidos.length === 0) {
    return (
      <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
        Sin pedidos para mostrar.
      </div>
    )
  }
  return (
    <ul className="max-h-[260px] overflow-auto divide-y divide-border/50">
      {pedidos.map((p) => {
        const dotColor = p.entregado
          ? "var(--chart-3)"
          : "var(--chart-4)"
        return (
          <li
            key={p.idpedido}
            className="px-3 py-2 flex items-start gap-2.5 text-xs"
          >
            <span
              className="mt-1 h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: dotColor }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground truncate">
                  {p.cliente?.trim() || "Cliente sin asignar"}
                </span>
                {p.entregado ? (
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
                    style={{
                      backgroundColor:
                        "color-mix(in oklch, var(--chart-3) 16%, transparent)",
                      color: "var(--chart-3)",
                    }}
                  >
                    Entregado
                  </span>
                ) : null}
              </div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="font-mono">
                  #{p.pedido?.trim() || p.idpedido}
                </span>
                {p.destino?.trim() ? (
                  <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
                    <MapPin className="h-3 w-3" />
                    <span className="truncate">{p.destino.trim()}</span>
                  </span>
                ) : null}
                {p.vendedor?.trim() ? (
                  <span className="truncate max-w-[140px]">
                    · {p.vendedor.trim()}
                  </span>
                ) : null}
              </div>
            </div>
            <div
              className="text-right tabular-nums shrink-0"
              style={{
                color: p.entregado
                  ? "var(--muted-foreground)"
                  : "var(--foreground)",
              }}
            >
              <div className="text-xs font-bold leading-none">
                {fmtFloat1(p.toneladas)}
                <span className="text-[9px] font-semibold ml-0.5">t</span>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
