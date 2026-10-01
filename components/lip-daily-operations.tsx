"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useAuth } from "@/components/auth-provider"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Loader2, CalendarDays, RefreshCw, TrendingUp, TrendingDown, Minus,
  Truck, Target, Users, TicketCheck, AlertTriangle, Trophy, ArrowUpRight, ArrowDownRight,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadialBarChart, RadialBar, PieChart, Pie, Cell, Area, AreaChart, ReferenceLine,
} from "recharts"

interface MetaDiaRecord {
  fecha: string; idempresa: number; tipo_producto: string; tipooperacion: string
  total_viajes: number; total_toneladas: number; meta_dia: number
}
interface ToneladaDiaRecord {
  fecha: string; operador: string; proyecto_id: number; tipo_producto: string
  tipooperacion: string; cantidad_auxiliares: number; toneladas_producto: number
}
interface Last7Record { fecha: string; total_toneladas: number; meta_dia: number }

const COLORS = {
  primary: "#3b82f6",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  violet: "#8b5cf6",
  cyan: "#06b6d4",
  slate: "#64748b",
  indigo: "#6366f1",
}
const PIE_COLORS = [COLORS.primary, COLORS.emerald, COLORS.amber, COLORS.rose, COLORS.violet, COLORS.cyan]

function DeltaBadge({ current, previous, suffix = "" }: { current: number; previous: number; suffix?: string }) {
  if (previous === 0) return null
  const delta = current - previous
  const pct = ((delta / previous) * 100).toFixed(1)
  const isUp = delta > 0
  const isNeutral = delta === 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isNeutral ? "bg-muted text-muted-foreground" : isUp ? "bg-emerald-500/15 text-emerald-600" : "bg-rose-500/15 text-rose-600"}`}>
      {isNeutral ? <Minus className="h-2.5 w-2.5" /> : isUp ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
      {isNeutral ? "0%" : `${isUp ? "+" : ""}${pct}%`}{suffix}
    </span>
  )
}

export function LipDailyOperations() {
  const { selectedEmpresaId } = useAuth()
  const [metaDia, setMetaDia] = useState<MetaDiaRecord[]>([])
  const [metaPrev, setMetaPrev] = useState<MetaDiaRecord[]>([])
  const [tonDia, setTonDia] = useState<ToneladaDiaRecord[]>([])
  const [tonPrev, setTonPrev] = useState<ToneladaDiaRecord[]>([])
  const [last7, setLast7] = useState<Last7Record[]>([])
  // Huevos / Empaque MP: por unidad, aparte de las toneladas (tarjeta pequeña).
  const [porUnidad, setPorUnidad] = useState<{ viajes: number; unidades: number; productos: string[] }>({ viajes: 0, unidades: 0, productos: [] })
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState("")
  const [currentDate, setCurrentDate] = useState("")
  const [filterProducto, setFilterProducto] = useState("all")
  const [filterOperacion, setFilterOperacion] = useState("all")

  const getTodayColombia = () =>
    new Date().toLocaleString("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).split(",")[0]

  // Normalize PascalCase aliases from metadia view to lowercase
  const normalizeMeta = (rows: any[]): MetaDiaRecord[] =>
    (rows || []).map((r: any) => ({
      fecha: r["Fecha"] || r.fecha || "",
      idempresa: Number(r["IdEmpresa"] || r.idempresa || 0),
      tipo_producto: r["Tipo de Producto"] || r.tipo_producto || "",
      tipooperacion: r["Tipo de Operacion"] || r.tipooperacion || "",
      total_viajes: Number(r["Total Viajes/Tickets"] || r.total_viajes || 0),
      total_toneladas: Number(r["Total Toneladas Procesadas"] || r.total_toneladas || 0),
      meta_dia: Number(r["Meta Dia"] || r.meta_dia || 0),
    }))

  const normalizeLast7 = (rows: any[]): Last7Record[] =>
    (rows || []).map((r: any) => ({
      fecha: r["Fecha"] || r.fecha || "",
      total_toneladas: Number(r["Total Toneladas Procesadas"] || r.total_toneladas || 0),
      meta_dia: Number(r["Meta Dia"] || r.meta_dia || 0),
    }))

  // Normalize PascalCase aliases from operaciones_desglosadas view to lowercase
  const normalizeTon = (rows: any[]): ToneladaDiaRecord[] =>
    (rows || []).map((r: any) => ({
      fecha: r["Fecha"] || r.fecha || "",
      operador: r["Operador"] || r.operador || "",
      proyecto_id: r["ID Proyecto"] || r.proyecto_id || 0,
      tipo_producto: r["Tipo de Producto"] || r.tipo_producto || "",
      tipooperacion: r["Tipo de Operacion"] || r.tipooperacion || "",
      cantidad_auxiliares: Number(r["Cantidad Auxiliares en Operacion"] || r.cantidad_auxiliares || 0),
      toneladas_producto: Number(r["Toneladas Cargadas"] || r.toneladas_producto || 0),
    }))

  const loadData = async (dateOverride?: string) => {
    if (!selectedEmpresaId) return
    setLoading(true)
    try {
      const d = dateOverride !== undefined ? dateOverride : selectedDate || ""
      const url = `/api/lip-dashboard?empresaId=${selectedEmpresaId}&mode=daily${d ? `&date=${d}` : ""}`
      const res = await fetch(url)
      const json = await res.json()
      setMetaDia(normalizeMeta(json.metaDia))
      setMetaPrev(normalizeMeta(json.metaDiaPrev))
      setTonDia(normalizeTon(json.toneladasDia))
      setTonPrev(normalizeTon(json.toneladasDiaPrev))
      setLast7(normalizeLast7(json.last7Meta))
      setPorUnidad(json.porUnidad ?? { viajes: 0, unidades: 0, productos: [] })
      setCurrentDate(json.date || "")
    } catch (e) {
      console.error("[v0] LIP daily error:", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [selectedEmpresaId])
  const handleDateChange = (v: string) => { setSelectedDate(v); loadData(v) }
  const handleToday = () => { setSelectedDate(""); loadData("") }
  const isToday = !selectedDate || selectedDate === getTodayColombia()

  // Filtered data
  const filteredMeta = useMemo(() =>
    metaDia.filter(r =>
      (filterProducto === "all" || r.tipo_producto === filterProducto) &&
      (filterOperacion === "all" || r.tipooperacion === filterOperacion)
    ), [metaDia, filterProducto, filterOperacion])

  const filteredTon = useMemo(() =>
    tonDia.filter(r =>
      (filterProducto === "all" || r.tipo_producto === filterProducto) &&
      (filterOperacion === "all" || r.tipooperacion === filterOperacion)
    ), [tonDia, filterProducto, filterOperacion])

  const filteredMetaPrev = useMemo(() =>
    metaPrev.filter(r =>
      (filterProducto === "all" || r.tipo_producto === filterProducto) &&
      (filterOperacion === "all" || r.tipooperacion === filterOperacion)
    ), [metaPrev, filterProducto, filterOperacion])

  const filteredTonPrev = useMemo(() =>
    tonPrev.filter(r =>
      (filterProducto === "all" || r.tipo_producto === filterProducto) &&
      (filterOperacion === "all" || r.tipooperacion === filterOperacion)
    ), [tonPrev, filterProducto, filterOperacion])

  // Unique filter options
  const productos = useMemo(() => [...new Set(metaDia.map(r => r.tipo_producto))].filter(Boolean), [metaDia])
  const operaciones = useMemo(() => [...new Set(metaDia.map(r => r.tipooperacion))].filter(Boolean), [metaDia])

  // KPIs
  const totalTon = useMemo(() => filteredMeta.reduce((s, r) => s + (Number(r.total_toneladas) || 0), 0), [filteredMeta])
  const totalMeta = useMemo(() => filteredMeta.reduce((s, r) => s + (Number(r.meta_dia) || 0), 0), [filteredMeta])
  const avgCumplimiento = useMemo(() => {
    if (totalMeta === 0) return 0
    return Math.round((totalTon / totalMeta) * 100)
  }, [totalTon, totalMeta])
  const totalViajes = useMemo(() => filteredMeta.reduce((s, r) => s + (Number(r.total_viajes) || 0), 0), [filteredMeta])
  const totalOperadores = useMemo(() => new Set(filteredTon.map(r => r.operador)).size, [filteredTon])

  // Previous KPIs
  const prevTon = useMemo(() => filteredMetaPrev.reduce((s, r) => s + (Number(r.total_toneladas) || 0), 0), [filteredMetaPrev])
  const prevMeta = useMemo(() => filteredMetaPrev.reduce((s, r) => s + (Number(r.meta_dia) || 0), 0), [filteredMetaPrev])
  const prevCumplimiento = useMemo(() => prevMeta === 0 ? 0 : Math.round((prevTon / prevMeta) * 100), [prevTon, prevMeta])
  const prevViajes = useMemo(() => filteredMetaPrev.reduce((s, r) => s + (Number(r.total_viajes) || 0), 0), [filteredMetaPrev])
  const prevOperadores = useMemo(() => new Set(filteredTonPrev.map(r => r.operador)).size, [filteredTonPrev])

  // Fulfillment bar chart data (meta vs actual by product + operation)
  const fulfillmentBars = useMemo(() => {
    const groups: Record<string, { label: string; actual: number; meta: number }> = {}
    filteredMeta.forEach(r => {
      const key = `${r.tipo_producto} - ${r.tipooperacion}`
      if (!groups[key]) groups[key] = { label: key, actual: 0, meta: 0 }
      groups[key].actual += Number(r.total_toneladas) || 0
      groups[key].meta += Number(r.meta_dia) || 0
    })
    return Object.values(groups).map(g => ({ ...g, actual: +g.actual.toFixed(2), meta: +g.meta.toFixed(2) }))
  }, [filteredMeta])

  // Radial gauges per operation type
  const radialData = useMemo(() => {
    const groups: Record<string, { name: string; tons: number; meta: number }> = {}
    filteredMeta.forEach(r => {
      const k = r.tipooperacion
      if (!groups[k]) groups[k] = { name: k, tons: 0, meta: 0 }
      groups[k].tons += Number(r.total_toneladas) || 0
      groups[k].meta += Number(r.meta_dia) || 0
    })
    return Object.values(groups).map((g, i) => ({
      name: g.name,
      value: g.meta > 0 ? Math.min(Math.round((g.tons / g.meta) * 100), 150) : 0,
      fill: PIE_COLORS[i % PIE_COLORS.length],
      tons: +g.tons.toFixed(2),
      meta: +g.meta.toFixed(2),
    }))
  }, [filteredMeta])

  // Operator leaderboard - SUM of "Toneladas Cargadas" per operator regardless of operation type
  const operatorLeaderboard = useMemo(() => {
    // Use tonDia (unfiltered by operation) to get ALL operations per operator
    const source = filterProducto === "all" ? tonDia : tonDia.filter(r => r.tipo_producto === filterProducto)
    const ops: Record<string, { operador: string; viajes: number; toneladas: number; operaciones: Set<string> }> = {}
    source.forEach(r => {
      const key = r.operador
      if (!ops[key]) ops[key] = { operador: r.operador, viajes: 0, toneladas: 0, operaciones: new Set() }
      ops[key].viajes += 1
      ops[key].toneladas += Number(r.toneladas_producto) || 0
      ops[key].operaciones.add(r.tipooperacion)
    })
    return Object.values(ops)
      .map(o => ({ operador: o.operador, viajes: o.viajes, toneladas: +o.toneladas.toFixed(2), operaciones: [...o.operaciones].join(", ") }))
      .sort((a, b) => b.toneladas - a.toneladas)
  }, [tonDia, filterProducto])

  // Low performers
  const lowPerformers = useMemo(() => {
    if (operatorLeaderboard.length < 3) return []
    const threshold = operatorLeaderboard.reduce((s, o) => s + o.toneladas, 0) / operatorLeaderboard.length * 0.5
    return operatorLeaderboard.filter(o => o.toneladas < threshold).slice(-5).reverse()
  }, [operatorLeaderboard])

  // Top 3 performers
  const topPerformers = useMemo(() => operatorLeaderboard.slice(0, 3), [operatorLeaderboard])

  // Tonnage distribution by product (pie)
  const productPie = useMemo(() => {
    const groups: Record<string, number> = {}
    filteredMeta.forEach(r => { groups[r.tipo_producto] = (groups[r.tipo_producto] || 0) + (Number(r.total_toneladas) || 0) })
    return Object.entries(groups).map(([name, value]) => ({ name, value: +value.toFixed(2) }))
  }, [filteredMeta])

  // Sparkline last 7 days
  const sparklineData = useMemo(() => {
    const byDate: Record<string, { fecha: string; tons: number; meta: number }> = {}
    last7.forEach(r => {
      if (!byDate[r.fecha]) byDate[r.fecha] = { fecha: r.fecha, tons: 0, meta: 0 }
      byDate[r.fecha].tons += Number(r.total_toneladas) || 0
      byDate[r.fecha].meta += Number(r.meta_dia) || 0
    })
    return Object.values(byDate).sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map(d => ({ ...d, cumplimiento: d.meta > 0 ? Math.round((d.tons / d.meta) * 100) : 0, label: d.fecha.slice(5) }))
  }, [last7])

  // Max tonnage for leaderboard progress bar
  const maxTon = useMemo(() => Math.max(...operatorLeaderboard.map(o => o.toneladas), 1), [operatorLeaderboard])

  const formatDate = (d: string) => {
    if (!d) return ""
    const [y, m, dy] = d.split("-")
    const dt = new Date(+y, +m - 1, +dy)
    return dt.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">Operacion del Dia</h2>
          <p className="text-sm text-muted-foreground capitalize">{formatDate(currentDate)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterProducto} onValueChange={setFilterProducto}>
            <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Producto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los Productos</SelectItem>
              {productos.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterOperacion} onValueChange={setFilterOperacion}>
            <SelectTrigger className="h-8 text-xs w-[150px]"><SelectValue placeholder="Operacion" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las Ops.</SelectItem>
              {operaciones.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <DatePickerField value={selectedDate} onChange={handleDateChange} className="h-8 w-40 text-xs" maxDate={getTodayColombia()} />
          </div>
          {!isToday && <Button variant="outline" size="sm" onClick={handleToday} className="h-8 text-xs">Hoy</Button>}
          <Button variant="outline" size="sm" onClick={() => loadData()} className="h-8"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: "Toneladas Procesadas", value: totalTon.toFixed(1), prev: prevTon, icon: Truck, color: "text-blue-500", bg: "bg-blue-500/10" },
          { title: "Cumplimiento Global", value: `${avgCumplimiento}%`, prev: prevCumplimiento, icon: Target, color: avgCumplimiento >= 100 ? "text-emerald-500" : avgCumplimiento >= 80 ? "text-amber-500" : "text-rose-500", bg: avgCumplimiento >= 100 ? "bg-emerald-500/10" : avgCumplimiento >= 80 ? "bg-amber-500/10" : "bg-rose-500/10" },
          { title: "Operadores Activos", value: totalOperadores.toString(), prev: prevOperadores, icon: Users, color: "text-violet-500", bg: "bg-violet-500/10" },
          { title: "Viajes / Tickets", value: totalViajes.toString(), prev: prevViajes, icon: TicketCheck, color: "text-cyan-500", bg: "bg-cyan-500/10" },
        ].map((kpi, i) => (
          <Card key={i} className="relative overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.title}</p>
                  <p className="text-2xl font-bold tracking-tight">{kpi.value}</p>
                  <DeltaBadge current={typeof kpi.prev === "number" && kpi.title === "Cumplimiento Global" ? avgCumplimiento : Number(kpi.value.replace("%", "").replace(",", ""))} previous={kpi.prev as number} suffix=" vs ayer" />
                </div>
                <div className={`${kpi.bg} ${kpi.color} p-2.5 rounded-xl`}>
                  <kpi.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Por unidad (Huevos / Empaque MP): no son el core del ID y no son
          toneladas. Tarjeta pequeña, aparte, para que no contaminen nada. */}
      {porUnidad.viajes > 0 && (
        <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-semibold">{porUnidad.productos.join(" / ") || "Por unidad"}</span>
          <span>{porUnidad.viajes} descargue{porUnidad.viajes === 1 ? "" : "s"}</span>
          <span>{porUnidad.unidades.toLocaleString("es-CO")} unidades</span>
          <span className="text-amber-700/80 dark:text-amber-300/80">se cobran y pagan por unidad · no suman toneladas</span>
        </div>
      )}

      {/* Sparkline + Alerts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 7-day trend */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Tendencia 7 Dias - Cumplimiento %</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            {sparklineData.length > 0 ? (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={sparklineData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ReferenceLine y={100} stroke="#10b981" strokeDasharray="5 5" label={{ value: "Meta 100%", position: "right", fontSize: 9, fill: "#10b981" }} />
                  <Tooltip formatter={(v: number) => [`${v}%`, "Cumplimiento"]} contentStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="cumplimiento" stroke="#3b82f6" fill="url(#sparkGrad)" strokeWidth={2} dot={{ r: 3, fill: "#3b82f6" }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <p className="text-xs text-muted-foreground text-center py-8">Sin datos de tendencia</p>}
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card className="border-rose-200 dark:border-rose-900/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <CardTitle className="text-sm font-semibold text-rose-600 dark:text-rose-400">Alertas de Rendimiento</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {lowPerformers.length > 0 ? lowPerformers.map((p, i) => (
              <div key={i} className="flex items-center justify-between bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                <div>
                  <p className="text-xs font-semibold">{p.operador}</p>
                  <p className="text-[10px] text-muted-foreground">{p.operaciones}</p>
                </div>
                <Badge variant="destructive" className="text-[10px]">{p.toneladas} ton</Badge>
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="bg-emerald-500/10 p-2 rounded-full mb-2"><TrendingUp className="h-5 w-5 text-emerald-500" /></div>
                <p className="text-xs text-muted-foreground">Sin alertas. Todos rinden bien.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Fulfillment Bars + Radial Gauges + Product Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar chart: Actual vs Meta */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Toneladas vs Meta por Producto / Operacion</CardTitle>
          </CardHeader>
          <CardContent>
            {fulfillmentBars.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={fulfillmentBars} margin={{ top: 5, right: 10, left: -10, bottom: 40 }} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="actual" name="Toneladas" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="meta" name="Meta" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-xs text-muted-foreground text-center py-12">Sin datos</p>}
          </CardContent>
        </Card>

        {/* Product Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Distribucion por Producto</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {productPie.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={productPie} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 9 }}>
                      {productPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`${v.toFixed(2)} ton`, ""]} contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-2 mt-1 justify-center">
                  {productPie.map((p, i) => (
                    <span key={i} className="flex items-center gap-1 text-[10px]">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      {p.name}
                    </span>
                  ))}
                </div>
              </>
            ) : <p className="text-xs text-muted-foreground text-center py-12">Sin datos</p>}
          </CardContent>
        </Card>
      </div>

      {/* Radial Gauges per Operation */}
      {radialData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Cumplimiento por Tipo de Operacion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {radialData.map((g, i) => (
                <div key={i} className="flex flex-col items-center">
                  <ResponsiveContainer width={120} height={120}>
                    <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" startAngle={180} endAngle={0} data={[{ value: g.value, fill: g.fill }]} barSize={10}>
                      <RadialBar background={{ fill: "#f1f5f9" }} dataKey="value" cornerRadius={5} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <p className="text-lg font-bold -mt-6" style={{ color: g.fill }}>{g.value}%</p>
                  <p className="text-[11px] font-medium text-muted-foreground mt-1">{g.name}</p>
                  <p className="text-[10px] text-muted-foreground">{g.tons} / {g.meta} ton</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Performers */}
      {topPerformers.length > 0 && (
        <Card className="border-emerald-200 dark:border-emerald-900/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm font-semibold">Top Operadores del Dia</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {topPerformers.map((p, i) => (
                <div key={i} className={`flex items-center gap-3 p-3 rounded-xl ${i === 0 ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40" : "bg-muted/50 border"}`}>
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${i === 0 ? "bg-amber-500 text-white" : i === 1 ? "bg-slate-400 text-white" : "bg-orange-400 text-white"}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.operador}</p>
                    <p className="text-[10px] text-muted-foreground">{p.operaciones} - {p.viajes} viajes</p>
                  </div>
                  <Badge className={`text-[11px] ${i === 0 ? "bg-amber-500 hover:bg-amber-600" : "bg-primary"}`}>{p.toneladas} ton</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Operator Leaderboard Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Productividad por Operador</CardTitle>
          <CardDescription className="text-xs">{operatorLeaderboard.length} operadores activos</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] w-8">#</TableHead>
                  <TableHead className="text-[11px]">Operador</TableHead>
                  <TableHead className="text-[11px]">Operaciones</TableHead>
                  <TableHead className="text-[11px] text-center">Viajes</TableHead>
                  <TableHead className="text-[11px] text-right">Toneladas</TableHead>
                  <TableHead className="text-[11px] w-[140px]">Rendimiento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operatorLeaderboard.length > 0 ? operatorLeaderboard.map((op, i) => (
                  <TableRow key={i} className="hover:bg-muted/50">
                    <TableCell className="text-xs font-semibold text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-xs font-medium">{op.operador}</TableCell>
                    <TableCell className="text-xs">{op.operaciones}</TableCell>
                    <TableCell className="text-xs text-center">{op.viajes}</TableCell>
                    <TableCell className="text-xs text-right font-semibold">{op.toneladas}</TableCell>
                    <TableCell>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${Math.min((op.toneladas / maxTon) * 100, 100)}%`,
                            backgroundColor: op.toneladas / maxTon > 0.7 ? COLORS.emerald : op.toneladas / maxTon > 0.4 ? COLORS.amber : COLORS.rose
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">Sin datos de operadores</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
