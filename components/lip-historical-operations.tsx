"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Chip, Cifra, Esqueleto, Progreso, type Tono } from "@/components/ui/lipgo"
import { cn } from "@/lib/utils"
import {
  Loader2, ChevronLeft, ChevronRight, RefreshCw, TrendingUp, TrendingDown,
  Truck, Target, Users, TicketCheck, ArrowUpRight, ArrowDownRight, Minus,
  AlertTriangle, Trophy, BarChart3,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, Area, AreaChart, ComposedChart, ReferenceLine, Cell, PieChart, Pie,
} from "recharts"

interface MetaDiaRecord {
  fecha: string; idempresa: number; tipo_producto: string; tipooperacion: string
  total_viajes: number; total_toneladas: number; meta_dia: number
}
interface ToneladaDiaRecord {
  fecha: string; operador: string; proyecto_id: number; tipo_producto: string
  tipooperacion: string; cantidad_auxiliares: number; toneladas_producto: number
}

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
const BAR_PAIRS: [string, string][] = [["#3b82f6", "#93c5fd"], ["#10b981", "#6ee7b7"], ["#f59e0b", "#fcd34d"], ["#f43f5e", "#fda4af"]]

// Clases estáticas (Tailwind no genera clases armadas en tiempo de ejecución).
const ICONO_TONO: Record<Tono, string> = {
  ok: "bg-ok-bg text-ok-fg",
  atencion: "bg-atencion-bg text-atencion-fg",
  critico: "bg-critico-bg text-critico-fg",
  info: "bg-info-bg text-info-fg",
  neutro: "bg-muted text-foreground",
}

function DeltaBadge({ current, previous, suffix = "" }: { current: number; previous: number; suffix?: string }) {
  if (previous === 0 && current === 0) return null
  const delta = previous === 0 ? 100 : ((current - previous) / previous) * 100
  const isUp = delta > 0
  const isNeutral = Math.abs(delta) < 0.5
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isNeutral ? "bg-muted text-muted-foreground" : isUp ? "bg-emerald-500/15 text-emerald-600" : "bg-rose-500/15 text-rose-600"}`}>
      {isNeutral ? <Minus className="h-2.5 w-2.5" /> : isUp ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
      {isNeutral ? "0%" : `${isUp ? "+" : ""}${delta.toFixed(1)}%`}{suffix}
    </span>
  )
}

export function LipHistoricalOperations() {
  const { selectedEmpresaId } = useAuth()
  const [metaDia, setMetaDia] = useState<MetaDiaRecord[]>([])
  const [metaPrev, setMetaPrev] = useState<MetaDiaRecord[]>([])
  const [tonDia, setTonDia] = useState<ToneladaDiaRecord[]>([])
  const [tonPrev, setTonPrev] = useState<ToneladaDiaRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(() => {
    const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`
  })
  const [filterProducto, setFilterProducto] = useState("all")
  const [filterOperacion, setFilterOperacion] = useState("all")

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

  const loadData = async (monthOverride?: string) => {
    if (!selectedEmpresaId) return
    setLoading(true)
    try {
      const m = monthOverride || currentMonth
      const res = await fetch(`/api/lip-dashboard?empresaId=${selectedEmpresaId}&mode=monthly&month=${m}`)
      const json = await res.json()
      setMetaDia(normalizeMeta(json.metaDia))
      setMetaPrev(normalizeMeta(json.metaDiaPrev))
      setTonDia(normalizeTon(json.toneladasDia))
      setTonPrev(normalizeTon(json.toneladasDiaPrev))
    } catch (e) {
      console.error("[v0] LIP historical error:", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [selectedEmpresaId])

  const navigateMonth = (dir: number) => {
    const [y, m] = currentMonth.split("-").map(Number)
    const d = new Date(y, m - 1 + dir, 1)
    const nm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    setCurrentMonth(nm)
    loadData(nm)
  }

  const monthLabel = useMemo(() => {
    const [y, m] = currentMonth.split("-").map(Number)
    return new Date(y, m - 1).toLocaleDateString("es-CO", { month: "long", year: "numeric" })
  }, [currentMonth])

  // Filtered data
  const fMeta = useMemo(() => metaDia.filter(r => (filterProducto === "all" || r.tipo_producto === filterProducto) && (filterOperacion === "all" || r.tipooperacion === filterOperacion)), [metaDia, filterProducto, filterOperacion])
  const fTon = useMemo(() => tonDia.filter(r => (filterProducto === "all" || r.tipo_producto === filterProducto) && (filterOperacion === "all" || r.tipooperacion === filterOperacion)), [tonDia, filterProducto, filterOperacion])
  const fMetaPrev = useMemo(() => metaPrev.filter(r => (filterProducto === "all" || r.tipo_producto === filterProducto) && (filterOperacion === "all" || r.tipooperacion === filterOperacion)), [metaPrev, filterProducto, filterOperacion])
  const fTonPrev = useMemo(() => tonPrev.filter(r => (filterProducto === "all" || r.tipo_producto === filterProducto) && (filterOperacion === "all" || r.tipooperacion === filterOperacion)), [tonPrev, filterProducto, filterOperacion])

  const productos = useMemo(() => [...new Set(metaDia.map(r => r.tipo_producto))].filter(Boolean), [metaDia])
  const operaciones = useMemo(() => [...new Set(metaDia.map(r => r.tipooperacion))].filter(Boolean), [metaDia])

  // --- KPIs ---
  const totalTon = useMemo(() => fMeta.reduce((s, r) => s + (Number(r.total_toneladas) || 0), 0), [fMeta])
  const totalMeta = useMemo(() => fMeta.reduce((s, r) => s + (Number(r.meta_dia) || 0), 0), [fMeta])
  const avgCumplimiento = useMemo(() => totalMeta === 0 ? 0 : Math.round((totalTon / totalMeta) * 100), [totalTon, totalMeta])
  const totalOperaciones = useMemo(() => fMeta.reduce((s, r) => s + (Number(r.total_viajes) || 0), 0), [fMeta])
  const totalOperadores = useMemo(() => new Set(fTon.map(r => r.operador)).size, [fTon])
  const diasActivos = useMemo(() => new Set(fMeta.map(r => r.fecha)).size, [fMeta])

  const prevTon = useMemo(() => fMetaPrev.reduce((s, r) => s + (Number(r.total_toneladas) || 0), 0), [fMetaPrev])
  const prevMeta = useMemo(() => fMetaPrev.reduce((s, r) => s + (Number(r.meta_dia) || 0), 0), [fMetaPrev])
  const prevCumplimiento = useMemo(() => prevMeta === 0 ? 0 : Math.round((prevTon / prevMeta) * 100), [prevTon, prevMeta])
  const prevOperaciones = useMemo(() => fMetaPrev.reduce((s, r) => s + (Number(r.total_viajes) || 0), 0), [fMetaPrev])
  const prevOperadores = useMemo(() => new Set(fTonPrev.map(r => r.operador)).size, [fTonPrev])

  // --- Daily cumplimiento trend ---
  const dailyCumplimiento = useMemo(() => {
    const byDate: Record<string, { fecha: string; tons: number; meta: number }> = {}
    fMeta.forEach(r => {
      if (!byDate[r.fecha]) byDate[r.fecha] = { fecha: r.fecha, tons: 0, meta: 0 }
      byDate[r.fecha].tons += Number(r.total_toneladas) || 0
      byDate[r.fecha].meta += Number(r.meta_dia) || 0
    })
    return Object.values(byDate).sort((a, b) => a.fecha.localeCompare(b.fecha)).map(d => ({
      fecha: d.fecha.slice(5),
      cumplimiento: d.meta > 0 ? Math.round((d.tons / d.meta) * 100) : 0,
      toneladas: +d.tons.toFixed(2),
      meta: +d.meta.toFixed(2),
    }))
  }, [fMeta])

  // --- Daily volume stacked by product ---
  const dailyVolumeByProduct = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {}
    fMeta.forEach(r => {
      if (!byDate[r.fecha]) byDate[r.fecha] = {}
      byDate[r.fecha][r.tipo_producto] = (byDate[r.fecha][r.tipo_producto] || 0) + (Number(r.total_toneladas) || 0)
    })
    const allProducts = [...new Set(fMeta.map(r => r.tipo_producto))].filter(Boolean)
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([fecha, prods]) => {
      const entry: Record<string, any> = { fecha: fecha.slice(5) }
      allProducts.forEach(p => { entry[p] = +(prods[p] || 0).toFixed(2) })
      return entry
    })
  }, [fMeta])
  const allProductKeys = useMemo(() => [...new Set(fMeta.map(r => r.tipo_producto))].filter(Boolean), [fMeta])

  // --- Cumplimiento by Tipo de Operacion AND Tipo de Producto (grouped bars) ---
  const cumplimientoByOpAndProduct = useMemo(() => {
    // Group: operacion > producto > { tons, meta }
    const groups: Record<string, Record<string, { tons: number; meta: number }>> = {}
    metaDia.forEach(r => {
      const op = r.tipooperacion || "N/A"
      const prod = r.tipo_producto || "N/A"
      if (!groups[op]) groups[op] = {}
      if (!groups[op][prod]) groups[op][prod] = { tons: 0, meta: 0 }
      groups[op][prod].tons += Number(r.total_toneladas) || 0
      groups[op][prod].meta += Number(r.meta_dia) || 0
    })
    // Build chart data: one bar group per operacion, bars for each producto (actual + meta)
    const allProds = [...new Set(metaDia.map(r => r.tipo_producto))].filter(Boolean)
    const chartData = Object.entries(groups).map(([op, prods]) => {
      const entry: Record<string, any> = { operacion: op }
      allProds.forEach(p => {
        const d = prods[p] || { tons: 0, meta: 0 }
        entry[`${p}_real`] = +d.tons.toFixed(2)
        entry[`${p}_meta`] = +d.meta.toFixed(2)
        entry[`${p}_cumpl`] = d.meta > 0 ? Math.round((d.tons / d.meta) * 100) : 0
      })
      return entry
    })
    return { data: chartData, products: allProds }
  }, [metaDia])

  // --- Cumplimiento by operation type (daily lines) ---
  const cumplimientoByOp = useMemo(() => {
    const ops = [...new Set(fMeta.map(r => r.tipooperacion))].filter(Boolean)
    const byDate: Record<string, Record<string, { tons: number; meta: number }>> = {}
    fMeta.forEach(r => {
      if (!byDate[r.fecha]) byDate[r.fecha] = {}
      if (!byDate[r.fecha][r.tipooperacion]) byDate[r.fecha][r.tipooperacion] = { tons: 0, meta: 0 }
      byDate[r.fecha][r.tipooperacion].tons += Number(r.total_toneladas) || 0
      byDate[r.fecha][r.tipooperacion].meta += Number(r.meta_dia) || 0
    })
    const chartData = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([fecha, opData]) => {
      const entry: Record<string, any> = { fecha: fecha.slice(5) }
      ops.forEach(op => {
        const d = opData[op]
        entry[op] = d && d.meta > 0 ? Math.round((d.tons / d.meta) * 100) : 0
      })
      return entry
    })
    return { data: chartData, ops }
  }, [fMeta])

  // --- Tonnage by operation (pie) ---
  const opPie = useMemo(() => {
    const groups: Record<string, number> = {}
    fMeta.forEach(r => { groups[r.tipooperacion] = (groups[r.tipooperacion] || 0) + (Number(r.total_toneladas) || 0) })
    return Object.entries(groups).map(([name, value]) => ({ name, value: +value.toFixed(2) }))
  }, [fMeta])

  // --- Operator rankings using SUM of Toneladas Cargadas from operaciones_desglosadas ---
  const operatorStats = useMemo(() => {
    // Use ALL tonDia (not filtered by operacion) to get total per operator
    const source = filterProducto === "all" ? tonDia : tonDia.filter(r => r.tipo_producto === filterProducto)
    const ops: Record<string, { operador: string; operaciones: number; toneladas: number; dias: Set<string>; tiposOp: Set<string> }> = {}
    source.forEach(r => {
      const k = r.operador
      if (!ops[k]) ops[k] = { operador: k, operaciones: 0, toneladas: 0, dias: new Set(), tiposOp: new Set() }
      ops[k].operaciones += 1
      ops[k].toneladas += Number(r.toneladas_producto) || 0
      ops[k].dias.add(r.fecha)
      ops[k].tiposOp.add(r.tipooperacion)
    })
    return Object.values(ops)
      .map(o => ({ operador: o.operador, operaciones: o.operaciones, toneladas: +o.toneladas.toFixed(2), dias: o.dias.size, promedio: +(o.toneladas / Math.max(o.dias.size, 1)).toFixed(2), tiposOp: [...o.tiposOp].join(", ") }))
      .sort((a, b) => b.toneladas - a.toneladas)
  }, [tonDia, filterProducto])

  const top5 = useMemo(() => operatorStats.slice(0, 5), [operatorStats])
  const bottom5 = useMemo(() => operatorStats.length > 5 ? operatorStats.slice(-5).reverse() : [], [operatorStats])
  const maxStatTon = useMemo(() => Math.max(...operatorStats.map(o => o.toneladas), 1), [operatorStats])

  // ---- Solo presentación (gerencia 2026-10-05: cero cambios de comportamiento). Mismos filtros, mismas
  // tarjetas (6), misma barra de cumplimiento, mismas gráficas, mismos rankings y la misma tabla. ----
  const tonoCumpl = (v: number): Tono => (v >= 100 ? "ok" : v >= 80 ? "atencion" : "critico")

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy aria-label="Cargando el histórico mensual">
        <div className="lg-card p-5"><Esqueleto lineas={3} /></div>
        <div className="grid gap-4 lg:grid-cols-2"><div className="lg-card p-5"><Esqueleto lineas={5} /></div><div className="lg-card p-5"><Esqueleto lineas={5} /></div></div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-lg font-semibold leading-tight">Historico Mensual</h2>
          <p className="text-sm capitalize text-muted-foreground">{monthLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterProducto} onValueChange={setFilterProducto}>
            <SelectTrigger className="h-9 w-[170px] bg-background text-sm"><SelectValue placeholder="Producto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los Productos</SelectItem>
              {productos.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterOperacion} onValueChange={setFilterOperacion}>
            <SelectTrigger className="h-9 w-[160px] bg-background text-sm"><SelectValue placeholder="Operacion" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las Ops.</SelectItem>
              {operaciones.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => navigateMonth(-1)} aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="w-36 text-center text-sm font-medium capitalize">{monthLabel}</span>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => navigateMonth(1)} aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadData()} className="h-9 gap-1.5" aria-label="Actualizar"><RefreshCw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Actualizar</span></Button>
        </div>
      </div>

      {/* KPI Cards - 6 cards including Meta del Mes */}
      <section className="lg-card grid grid-cols-2 gap-y-5 p-5 sm:gap-x-6 lg:grid-cols-6 lg:gap-y-0" aria-label="Cifras del mes">
        {[
          { title: "Toneladas Mes", value: totalTon.toFixed(1), prev: prevTon, icon: Truck, tono: "neutro" as Tono, subtitle: `Meta: ${totalMeta.toFixed(1)} ton` },
          { title: "Meta del Mes", value: totalMeta.toFixed(1), prev: prevMeta, icon: Target, tono: "info" as Tono, subtitle: `Faltan: ${Math.max(totalMeta - totalTon, 0).toFixed(1)} ton` },
          { title: "Cumplimiento", value: `${avgCumplimiento}%`, prev: prevCumplimiento, icon: Target, tono: tonoCumpl(avgCumplimiento), isCumplimiento: true, subtitle: `${totalTon.toFixed(1)} / ${totalMeta.toFixed(1)}` },
          { title: "Total Operaciones", value: totalOperaciones.toString(), prev: prevOperaciones, icon: TicketCheck, tono: "neutro" as Tono },
          { title: "Operadores", value: totalOperadores.toString(), prev: prevOperadores, icon: Users, tono: "neutro" as Tono },
          { title: "Dias Activos", value: diasActivos.toString(), prev: 0, icon: BarChart3, tono: "neutro" as Tono },
        ].map((kpi, i) => (
          <div key={i} className={cn("flex items-start gap-2.5", i < 5 && "lg:border-r lg:border-border lg:pr-4", i > 0 && "lg:pl-4")}>
            <span className={cn("mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", ICONO_TONO[kpi.tono])}>
              <kpi.icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <Cifra
              tamano="compacta"
              label={kpi.title}
              valor={kpi.value}
              tono={kpi.tono}
              sub={(kpi as any).subtitle}
              chips={kpi.prev !== 0 ? (
                <DeltaBadge
                  current={(kpi as any).isCumplimiento ? avgCumplimiento : Number(kpi.value.replace("%", "").replace(",", ""))}
                  previous={kpi.prev}
                  suffix=" vs mes ant."
                />
              ) : undefined}
              className="min-w-0"
            />
          </div>
        ))}
      </section>

      {/* Cumplimiento general progress bar */}
      <section className="lg-card p-4" aria-label="Cumplimiento general del mes">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Cumplimiento General del Mes</p>
          <Chip tono={tonoCumpl(avgCumplimiento)}>{totalTon.toFixed(1)} / {totalMeta.toFixed(1)} ton ({avgCumplimiento}%)</Chip>
        </div>
        <Progreso pct={Math.min(avgCumplimiento, 100)} tono={tonoCumpl(avgCumplimiento)} />
        <div className="mt-1 flex justify-between">
          <span className="lg-num text-[11px] text-muted-foreground">0 ton</span>
          <span className="lg-num text-[11px] text-muted-foreground">{totalMeta.toFixed(1)} ton (Meta)</span>
        </div>
      </section>

      {/* Cumplimiento: Bars for toneladas + Line for meta */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="lg-card" aria-label="Toneladas diarias vs meta">
          <div className="border-b border-border px-4 py-2.5">
            <h3 className="text-sm font-semibold">Toneladas Diarias vs Meta</h3>
            <p className="text-xs text-muted-foreground">Barras = toneladas reales, Linea = meta diaria. Verde si supera la meta, rojo si no.</p>
          </div>
          <div className="p-3">
            {dailyCumplimiento.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={dailyCumplimiento} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                    formatter={(v: number, name: string) => {
                      if (name === "toneladas") return [`${v.toFixed(2)} ton`, "Toneladas"]
                      if (name === "meta") return [`${v.toFixed(2)} ton`, "Meta Dia"]
                      return [`${v}%`, "Cumplimiento"]
                    }}
                    labelFormatter={(label) => `Dia: ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} formatter={(val: string) => val === "toneladas" ? "Toneladas Reales" : val === "meta" ? "Meta Dia" : val} />
                  <Bar dataKey="toneladas" barSize={16} radius={[3, 3, 0, 0]} name="toneladas">
                    {dailyCumplimiento.map((entry, i) => (
                      <Cell
                        key={`bar-${i}`}
                        fill={entry.toneladas >= entry.meta ? COLORS.emerald : COLORS.rose}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="meta"
                    stroke={COLORS.amber}
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                    dot={{ r: 3, fill: COLORS.amber, stroke: "#fff", strokeWidth: 1.5 }}
                    name="meta"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <p className="py-12 text-center text-xs text-muted-foreground">Sin datos</p>}
          </div>
        </section>

        <section className="lg-card" aria-label="Volumen diario por producto">
          <div className="border-b border-border px-4 py-2.5"><h3 className="text-sm font-semibold">Volumen Diario por Producto</h3></div>
          <div className="p-3">
            {dailyVolumeByProduct.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={dailyVolumeByProduct} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {allProductKeys.map((pk, i) => (
                    <Area key={pk} type="monotone" dataKey={pk} stackId="1" stroke={PIE_COLORS[i % PIE_COLORS.length]} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.4} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : <p className="py-12 text-center text-xs text-muted-foreground">Sin datos</p>}
          </div>
        </section>
      </div>

      {/* Cumplimiento by Tipo de Operacion y Tipo de Producto - grouped bars */}
      <section className="lg-card" aria-label="Cumplimiento por tipo de operación y producto">
        <div className="border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Cumplimiento por Tipo de Operacion y Producto</h3>
          <p className="text-xs text-muted-foreground">Toneladas reales vs meta del mes por cada combinacion</p>
        </div>
        <div className="p-3">
          {cumplimientoByOpAndProduct.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={cumplimientoByOpAndProduct.data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="operacion" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(value: number, name: string) => {
                    const label = name.endsWith("_real") ? `${name.replace("_real", "")} (Real)` : name.endsWith("_meta") ? `${name.replace("_meta", "")} (Meta)` : name
                    return [`${value.toFixed(2)} ton`, label]
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(value: string) => {
                    return value.endsWith("_real") ? `${value.replace("_real", "")} (Real)` : value.endsWith("_meta") ? `${value.replace("_meta", "")} (Meta)` : value
                  }}
                />
                {cumplimientoByOpAndProduct.products.map((p, i) => (
                  <Bar key={`${p}_meta`} dataKey={`${p}_meta`} fill={BAR_PAIRS[i % BAR_PAIRS.length][1]} barSize={30} radius={[2, 2, 0, 0]} />
                ))}
                {cumplimientoByOpAndProduct.products.map((p, i) => (
                  <Bar key={`${p}_real`} dataKey={`${p}_real`} fill={BAR_PAIRS[i % BAR_PAIRS.length][0]} barSize={30} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="py-12 text-center text-xs text-muted-foreground">Sin datos</p>}
          {/* Summary badges below the chart */}
          {cumplimientoByOpAndProduct.data.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {cumplimientoByOpAndProduct.data.map((row, ri) => (
                cumplimientoByOpAndProduct.products.map((p, pi) => {
                  const cumpl = (row as any)[`${p}_cumpl`] || 0
                  return (
                    <Chip key={`${ri}-${pi}`} tono={cumpl >= 100 ? "ok" : "neutro"}>
                      {row.operacion} / {p}: <b>{cumpl}%</b>
                    </Chip>
                  )
                })
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Cumplimiento by operation + Op Pie */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="lg-card lg:col-span-2" aria-label="Cumplimiento diario por tipo de operación">
          <div className="border-b border-border px-4 py-2.5"><h3 className="text-sm font-semibold">Cumplimiento Diario por Tipo de Operacion</h3></div>
          <div className="p-3">
            {cumplimientoByOp.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={cumplimientoByOp.data} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ReferenceLine y={100} stroke="#10b981" strokeDasharray="5 5" />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [`${v}%`, ""]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {cumplimientoByOp.ops.map((op, i) => (
                    <Line key={op} type="monotone" dataKey={op} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="py-12 text-center text-xs text-muted-foreground">Sin datos</p>}
          </div>
        </section>

        <section className="lg-card" aria-label="Toneladas por operación">
          <div className="border-b border-border px-4 py-2.5"><h3 className="text-sm font-semibold">Toneladas por Operacion</h3></div>
          <div className="flex flex-col items-center p-3">
            {opPie.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={opPie} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 9 }}>
                      {opPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`${v.toFixed(2)} ton`, ""]} contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-1 flex flex-wrap justify-center gap-3">
                  {opPie.map((p, i) => (
                    <span key={i} className="lg-num flex items-center gap-1 text-[11px]">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />{p.name}: {p.value.toFixed(1)} ton
                    </span>
                  ))}
                </div>
              </>
            ) : <p className="py-12 text-center text-xs text-muted-foreground">Sin datos</p>}
          </div>
        </section>
      </div>

      {/* Top 5 + Bottom 5 Operators */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="lg-card" aria-label="Top 5 operadores del mes">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Trophy className="h-4 w-4 text-atencion-fg" aria-hidden />
            <h3 className="text-sm font-semibold">Top 5 Operadores del Mes</h3>
          </div>
          <div className="flex flex-col gap-2 p-3">
            {top5.length > 0 ? top5.map((op, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold", i === 0 ? "bg-amber-500 text-white" : i === 1 ? "bg-slate-400 text-white" : i === 2 ? "bg-orange-400 text-white" : "bg-muted text-muted-foreground")}>{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{op.operador}</p>
                  <p className="text-[10px] text-muted-foreground">{op.tiposOp}</p>
                  <Progreso pct={(op.toneladas / maxStatTon) * 100} tono="ok" className="mt-1" />
                </div>
                <div className="text-right">
                  <p className="lg-num text-xs font-bold">{op.toneladas} ton</p>
                  <p className="lg-num text-[10px] text-muted-foreground">{op.dias}d | ~{op.promedio}/d</p>
                </div>
              </div>
            )) : <p className="py-6 text-center text-xs text-muted-foreground">Sin datos</p>}
          </div>
        </section>

        <section className="lg-card" aria-label="Operadores con menor rendimiento">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-critico-fg" aria-hidden />
            <h3 className="text-sm font-semibold">Operadores con Menor Rendimiento</h3>
          </div>
          <div className="flex flex-col gap-2 p-3">
            {bottom5.length > 0 ? bottom5.map((op, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-critico-bd bg-critico-bg px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{op.operador}</p>
                  <p className="text-[10px] text-muted-foreground">{op.tiposOp}</p>
                  <Progreso pct={(op.toneladas / maxStatTon) * 100} tono="critico" className="mt-1" />
                </div>
                <div className="text-right">
                  <Chip tono="critico">{op.toneladas} ton</Chip>
                  <p className="lg-num mt-0.5 text-[10px] text-muted-foreground">{op.dias}d | ~{op.promedio}/d</p>
                </div>
              </div>
            )) : <p className="py-6 text-center text-xs text-muted-foreground">Todos los operadores rinden bien</p>}
          </div>
        </section>
      </div>

      {/* Full Operator Table */}
      <section className="lg-card" aria-label="Detalle completo de operadores">
        <div className="border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Detalle Completo de Operadores</h3>
          <p className="text-xs text-muted-foreground">{operatorStats.length} operadores en el mes - Toneladas basadas en sumatoria de Toneladas Cargadas</p>
        </div>
        <div className="max-h-[400px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Operador</TableHead>
                <TableHead>Operaciones</TableHead>
                <TableHead className="text-center">Dias</TableHead>
                <TableHead className="text-center">Total Ops.</TableHead>
                <TableHead className="text-right">Toneladas</TableHead>
                <TableHead className="text-right">Promedio/Dia</TableHead>
                <TableHead className="w-[150px]">Rendimiento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operatorStats.length > 0 ? operatorStats.map((op, i) => (
                <TableRow key={i} className="hover:bg-muted/50">
                  <TableCell className="lg-num text-xs font-semibold text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="text-sm font-medium">{op.operador}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{op.tiposOp}</TableCell>
                  <TableCell className="lg-num text-center text-sm">{op.dias}</TableCell>
                  <TableCell className="lg-num text-center text-sm">{op.operaciones}</TableCell>
                  <TableCell className="lg-num text-right text-sm font-semibold">{op.toneladas}</TableCell>
                  <TableCell className="lg-num text-right text-sm">{op.promedio}</TableCell>
                  <TableCell>
                    <Progreso pct={Math.min((op.toneladas / maxStatTon) * 100, 100)} tono={op.toneladas / maxStatTon > 0.7 ? "ok" : op.toneladas / maxStatTon > 0.4 ? "atencion" : "critico"} />
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">Sin datos de operadores</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
