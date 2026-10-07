"use client"

// Panel LIP · Operación de cargue/descargue — dashboard de la GESTIÓN DE LIP
// como operador de outsourcing (no del cliente). Enfoque ISO 9001 8.5/8.6/9.1.
// Tres focos: (A) servicio LIP, (B) personas que prestan el servicio,
// (C) valor agregado de LIPgo (trazabilidad y soportes). Filtrable por
// cliente/sitio y periodo. Datos reales de cabeceraoc/headcount/registroasistencia.

import { useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useToast } from "@/hooks/use-toast"
import { SST_TOKENS } from "@/components/sst/sst-utils"
import { SigHeader, SigFilterBar, SigField, SigKpi, SigSection, SigDatePicker } from "@/components/sst/sig-ui"
import { Chip, Cifra, Esqueleto, Eyebrow, Punto, TEXTO_TONO, type Tono } from "@/components/ui/lipgo"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/auth-provider"
import { getPanelOperacionLIP } from "@/lib/sig-actions"
import { Loader2, Truck, Users, ShieldCheck, Camera, Clock, Package, Timer, Smile, Target, Gauge, Receipt, FileWarning, ChevronDown } from "lucide-react"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  LabelList,
} from "recharts"

// ---- Solo presentación (gerencia 2026-10-05: cero cambios de comportamiento). Las mismas piezas de
// siempre (KPI, grupo del scorecard, chips de rango, tabla colapsable) con las primitivas del sistema
// visual LIPgo. Textos, datos y filtros idénticos. ----

const TONO_ESTADO: Record<string, Tono> = { ok: "ok", warn: "atencion", bad: "critico", nd: "neutro" }
// Clases estáticas (Tailwind no genera clases armadas en tiempo de ejecución).
const ICONO_TONO: Record<Tono, string> = {
  ok: "bg-ok-bg text-ok-fg",
  atencion: "bg-atencion-bg text-atencion-fg",
  critico: "bg-critico-bg text-critico-fg",
  info: "bg-info-bg text-info-fg",
  neutro: "bg-muted text-foreground",
}

// Tono a partir de un color del semáforo SST (los cálculos siguen devolviendo el color de siempre).
function tonoDeColor(color: string): Tono {
  if (color === SST_TOKENS.ok) return "ok"
  if (color === SST_TOKENS.warn) return "atencion"
  if (color === SST_TOKENS.bad) return "critico"
  return "neutro"
}

function KPI({
  label,
  valor,
  unidad,
  Icon,
  color,
  sub,
}: {
  label: string
  valor: number | string
  unidad?: string
  Icon: any
  color: string
  sub?: string
}) {
  const tono = tonoDeColor(color)
  return (
    <div className="lg-card flex items-start gap-3 p-4">
      <span className={cn("mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", ICONO_TONO[tono])}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <Cifra tamano="compacta" label={label} valor={typeof valor === "number" ? valor.toLocaleString("es-CO") : valor} unidad={unidad} tono={tono} sub={sub} className="min-w-0" />
    </div>
  )
}

// Grupo del scorecard: encabezado + filas (indicador · resultado · meta · estado).
function FragmentGrupo({
  grupo,
  items,
  COL,
  EST_LABEL,
}: {
  grupo: string
  items: any[]
  COL: Record<string, string>
  EST_LABEL: Record<string, string>
}) {
  void COL
  const unid = (v: number, u: string) => (u === "%" ? `${v.toLocaleString("es-CO")}%` : `${v.toLocaleString("es-CO")} ${u}`)
  return (
    <>
      <tr className="bg-muted/40">
        <td colSpan={4} className="lg-eyebrow px-3 py-1.5">
          {grupo}
        </td>
      </tr>
      {items.map((it) => (
        <tr key={it.label} className="border-b border-border last:border-0">
          <td className="px-3 py-2">{it.label}</td>
          <td className={cn("lg-num px-3 py-2 text-right font-semibold", TEXTO_TONO[TONO_ESTADO[it.estado] ?? "neutro"])}>{unid(it.valor, it.unidad)}</td>
          <td className="lg-num px-3 py-2 text-right text-muted-foreground">{it.sentido === "menor" ? "≤ " : "≥ "}{unid(it.meta, it.unidad)}</td>
          <td className="px-3 py-2 text-center">
            <Chip tono={TONO_ESTADO[it.estado] ?? "neutro"}>{EST_LABEL[it.estado]}</Chip>
          </td>
        </tr>
      ))}
    </>
  )
}

// ---- Filtro por periodo (chips) para acortar las tablas de gestión ----
type Rango = "7" | "30" | "mes" | "todo"
const RANGOS: { key: Rango; label: string }[] = [
  { key: "7", label: "7 días" },
  { key: "30", label: "30 días" },
  { key: "mes", label: "Este mes" },
  { key: "todo", label: "Todo" },
]

// Filtro puro por fecha ISO (YYYY-MM-DD…) según el rango. `hoyISO` y `limite7/30`
// se calculan una vez en el componente para no crear Date en cada fila.
function dentroDeRango(fechaISO: any, rango: Rango, hoyISO: string, limite7: string, limite30: string): boolean {
  if (rango === "todo") return true
  const f = String(fechaISO || "").slice(0, 10)
  if (!f) return false
  if (rango === "mes") return f.slice(0, 7) === hoyISO.slice(0, 7)
  return f >= (rango === "7" ? limite7 : limite30)
}

function RangoChips({ value, onChange }: { value: Rango; onChange: (r: Rango) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1.5" role="group" aria-label="Periodo">
      {RANGOS.map((r) => {
        const active = r.key === value
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onChange(r.key)}
            aria-pressed={active}
            className={cn("inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted")}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}

// Card colapsable para las tablas largas: cabecera con título + badge + resumen,
// contenido con el filtro de periodo y la tabla ya filtrada. Colapsada por
// defecto para no extender la vista (no se elimina nada, solo se organiza).
function TablaColapsable({
  title,
  badgeClosed,
  badgeOpen,
  resumen,
  filtro,
  defaultOpen = false,
  children,
}: {
  title: string
  badgeClosed: string
  badgeOpen: string
  resumen?: React.ReactNode
  filtro: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="lg-card mt-4 overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40" aria-expanded={open}>
            <span className="text-sm font-semibold">{title}</span>
            <span className="flex items-center gap-3">
              {resumen && <span className="hidden text-xs text-muted-foreground sm:inline">{resumen}</span>}
              <Chip tono="info">{open ? badgeOpen : badgeClosed}</Chip>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }} />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border px-4 pb-4 pt-3">
            <div className="mb-3">{filtro}</div>
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}


export function PanelOperacionLIP() {
  const { toast } = useToast()
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [desde, setDesde] = useState<string>("")
  const [hasta, setHasta] = useState<string>("")

  useEffect(() => {
    let cancel = false
    setLoading(true)
    // El proyecto lo define el SELECTOR GLOBAL (conector) de la app.
    getPanelOperacionLIP(selectedEmpresaId ?? null, desde || null, hasta || null).then((r) => {
      if (cancel) return
      if (r.success) setData(r.data)
      else toast({ title: "No se pudo cargar el panel", description: r.error })
      setLoading(false)
    })
    return () => {
      cancel = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId, desde, hasta])

  const s = data?.servicioLIP
  const p = data?.personas
  const va = data?.valorAgregado
  const sla = data?.sla
  const satConductor = data?.satConductor ?? 0
  const fact = data?.facturacion

  // Filtro por periodo (cliente) para las dos tablas de gestión, sin tocar la carga.
  const [rangoFuera, setRangoFuera] = useState<Rango>("todo")
  const [rangoPend, setRangoPend] = useState<Rango>("todo")
  const { hoyISO, limite7, limite30 } = useMemo(() => {
    const hoy = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const menos = (n: number) => {
      const d = new Date(hoy)
      d.setDate(d.getDate() - n)
      return iso(d)
    }
    return { hoyISO: iso(hoy), limite7: menos(7), limite30: menos(30) }
  }, [])
  const fueraFiltradas = useMemo(
    () => (sla?.fuera ?? []).filter((f: any) => dentroDeRango(f.fecha, rangoFuera, hoyISO, limite7, limite30)),
    [sla, rangoFuera, hoyISO, limite7, limite30],
  )
  const pendFiltradas = useMemo(
    () => (fact?.pendientes ?? []).filter((o: any) => dentroDeRango(o.fecha, rangoPend, hoyISO, limite7, limite30)),
    [fact, rangoPend, hoyISO, limite7, limite30],
  )
  // Tipo de vehículo con peor cumplimiento de SLA (donde el coordinador debe actuar).
  const peorTipoSla = useMemo(() => {
    const arr = sla?.porTipo ?? []
    if (!arr.length) return null
    const min = arr.reduce((m: any, t: any) => (t.cumplimiento < m.cumplimiento ? t : m), arr[0])
    return min.cumplimiento < 90 ? min.tipo : null
  }, [sla])

  const colorPct = (v: number, meta: number) => (v >= meta ? SST_TOKENS.ok : v >= meta * 0.85 ? SST_TOKENS.warn : SST_TOKENS.bad)
  const fmtCOP = (v: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v || 0)

  const soportes = useMemo(
    () =>
      va
        ? [
            { k: "Soporte de orden (PDF)", v: va.pdfOrden, sub: "% órdenes con PDF de la orden" },
            { k: "Soporte de picking (PDF)", v: va.pdfPicking, sub: "% órdenes con documento de cargue" },
            { k: "Evidencia fotográfica", v: va.evidenciaFoto, sub: "% órdenes con fotos del cargue" },
            { k: "Ciclo registrado en LIPgo", v: va.cicloRegistrado, sub: "% órdenes con ciclo finalizado" },
          ]
        : [],
    [va],
  )

  // ---- Scorecard del coordinador: indicadores que dependen de él, vs meta ----
  // Agrupa SLA/servicio + partes interesadas (conductor) + equipo. Una sola
  // vista para analizar el desempeño con semáforo y cumplimiento global.
  const scorecard = useMemo(() => {
    if (!data) return null
    // `base` = false cuando el indicador no tiene datos para medirse (p. ej. sin
    // órdenes → sin tiempo de cargue, o sin calificaciones → sin satisfacción):
    // se marca "sin dato" y NO cuenta en el cumplimiento global (evita 100% falso).
    type Item = { grupo: string; label: string; valor: number; meta: number; unidad: string; sentido: "mayor" | "menor"; base?: boolean }
    const items: Item[] = [
      { grupo: "Servicio · SLA y operación", label: "SLA de tiempos por vehículo", valor: sla?.pct ?? 0, meta: 90, unidad: "%", sentido: "mayor" },
      { grupo: "Servicio · SLA y operación", label: "Cumplimiento de cargues (LIP)", valor: s.cumplimiento, meta: 98, unidad: "%", sentido: "mayor" },
      { grupo: "Servicio · SLA y operación", label: "Cumplimiento de meta de toneladas", valor: s.cumplimientoMeta, meta: 95, unidad: "%", sentido: "mayor" },
      { grupo: "Servicio · SLA y operación", label: "Tiempo de cargue", valor: s.tiempoCargue, meta: 60, unidad: "min", sentido: "menor", base: s.tiempoCargue > 0 },
      { grupo: "Servicio · SLA y operación", label: "Evidencia fotográfica", valor: s.evidencia, meta: 95, unidad: "%", sentido: "mayor" },
      { grupo: "Partes interesadas · Conductor", label: "Satisfacción del conductor", valor: satConductor, meta: 85, unidad: "%", sentido: "mayor", base: (data.coberturaCalificacion ?? 0) > 0 },
      { grupo: "Partes interesadas · Conductor", label: "Cobertura de calificación", valor: data.coberturaCalificacion ?? 0, meta: 80, unidad: "%", sentido: "mayor" },
      { grupo: "Equipo que presta el servicio", label: "Cumplimiento de jornada", valor: p.asistencia, meta: 95, unidad: "%", sentido: "mayor" },
      { grupo: "Equipo que presta el servicio", label: "Cobertura de planta", valor: p.coberturaPlanta ?? 0, meta: 100, unidad: "%", sentido: "mayor" },
      { grupo: "Equipo que presta el servicio", label: "Ausentismo médico", valor: p.ausentismo ?? 0, meta: 3, unidad: "%", sentido: "menor" },
      { grupo: "Facturación (gestión del coordinador)", label: "Gestión de facturación (solicitud)", valor: fact?.pct ?? 0, meta: 95, unidad: "%", sentido: "mayor" },
    ]
    const estadoDe = (it: Item): "ok" | "warn" | "bad" | "nd" =>
      it.base === false
        ? "nd"
        : it.sentido === "mayor"
        ? it.valor >= it.meta ? "ok" : it.valor >= it.meta * 0.85 ? "warn" : "bad"
        : it.valor <= it.meta ? "ok" : it.valor <= it.meta * 1.3 ? "warn" : "bad"
    const logroDe = (it: Item) => {
      const r = it.sentido === "mayor" ? (it.meta ? it.valor / it.meta : 0) : it.valor ? it.meta / it.valor : 1
      return Math.max(0, Math.min(1, r))
    }
    const conEstado = items.map((it) => ({ ...it, estado: estadoDe(it), logro: logroDe(it) }))
    // El cumplimiento global promedia SOLO los indicadores con dato (excluye "nd").
    const medibles = conEstado.filter((it) => it.estado !== "nd")
    const global = medibles.length ? Math.round((medibles.reduce((a, it) => a + it.logro, 0) / medibles.length) * 1000) / 10 : 0
    const enMeta = conEstado.filter((it) => it.estado === "ok").length
    const grupos = Array.from(new Set(conEstado.map((it) => it.grupo)))
    return { items: conEstado, global, enMeta, total: medibles.length, grupos }
  }, [data, s, p, sla, satConductor])

  const COL = { ok: SST_TOKENS.ok, warn: SST_TOKENS.warn, bad: SST_TOKENS.bad, nd: "#94a3b8" }
  const EST_LABEL = { ok: "En meta", warn: "Cerca", bad: "Fuera", nd: "Sin dato" }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      {/* Cabecera (mismo título y subtítulo de siempre) */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Operación del día · Tablero del coordinador</Eyebrow>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Tablero del Coordinador</h1>
          <p className="text-sm text-muted-foreground">Tu desempeño del servicio contra las metas de LIP: SLA, objetivos y facturación — por proyecto/sitio (ISO 9001 8.5 · 8.6 · 9.1)</p>
        </div>
      </div>

      <div className="lg-card p-3">
        <SigFilterBar cliente={selectedEmpresaNombre}>
          <SigField label="Desde">
            <SigDatePicker value={desde} onChange={setDesde} />
          </SigField>
          <SigField label="Hasta">
            <SigDatePicker value={hasta} onChange={setHasta} />
          </SigField>
          {(desde || hasta) && (
            <Button variant="ghost" size="sm" onClick={() => { setDesde(""); setHasta("") }}>Limpiar</Button>
          )}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        </SigFilterBar>
      </div>

      {!data ? (
        <div className="flex flex-col gap-4" aria-busy aria-label="Cargando el tablero">
          <div className="lg-card p-5"><Esqueleto lineas={4} /></div>
          <div className="grid gap-4 lg:grid-cols-2"><div className="lg-card p-5"><Esqueleto lineas={5} /></div><div className="lg-card p-5"><Esqueleto lineas={5} /></div></div>
        </div>
      ) : (
        <>
          {/* (A) TABLERO ÚNICO DEL COORDINADOR — scorecard vs metas (BSC + SLA) */}
          {scorecard && (
            <section aria-label="Tablero del coordinador">
              <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
                <Target className="h-4 w-4 text-primary" aria-hidden />
                Tablero del coordinador · desempeño vs metas (SLA + BSC + partes interesadas)
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Una sola vista: cumplimiento global y cada indicador que depende del coordinador contra su meta, con semáforo. Baja al detalle de SLA para actuar.
              </p>
              <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                {/* Cumplimiento global */}
                <div className="lg-card flex flex-col justify-center gap-3 p-5">
                  <Cifra
                    label="Cumplimiento global"
                    valor={`${scorecard.global}`}
                    unidad="%"
                    tono={scorecard.global >= 90 ? "ok" : scorecard.global >= 75 ? "atencion" : "critico"}
                    progreso={Math.max(0, Math.min(100, scorecard.global))}
                    chips={<Chip tono="info">{scorecard.enMeta}/{scorecard.total} indicadores en meta</Chip>}
                    sub={`${s.ordenes} órdenes · ${s.toneladas.toLocaleString("es-CO")} ton en el periodo`}
                  />
                </div>

                {/* Scorecard agrupado */}
                <div className="lg-card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="lg-eyebrow border-b border-border text-left">
                        <th className="px-3 py-2">Indicador</th>
                        <th className="px-3 py-2 text-right">Resultado</th>
                        <th className="px-3 py-2 text-right">Meta</th>
                        <th className="px-3 py-2 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scorecard.grupos.map((g) => (
                        <FragmentGrupo key={g} grupo={g} items={scorecard.items.filter((it) => it.grupo === g)} COL={COL} EST_LABEL={EST_LABEL} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                "Ausentismo médico" mide ausencias reales vs el headcount vinculado en el periodo (no cuenta en meta si no hay personal en headcount).
                Capacidad de respuesta del equipo (programado vs real del control diario, informativo, no forma parte del cumplimiento global):{" "}
                <strong>{p.capacidadRespuesta ?? 0}%</strong>.
              </p>
            </section>
          )}

          {/* (A.2) CUMPLIMIENTO DE SLA DE TIEMPOS POR VEHÍCULO */}
          {sla && sla.total > 0 && (
            <section aria-label="Cumplimiento de SLA">
              <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
                <Timer className="h-4 w-4 text-primary" aria-hidden />
                Cumplimiento de SLA de tiempos por vehículo
              </h2>
              <p className="mb-2 text-xs text-muted-foreground">
                Tiempo efectivo de cargue (inicio → fin) vs el tiempo acordado por tipo de vehículo. Aquí el coordinador identifica dónde se incumple el SLA y actúa.
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Tabla por tipo de vehículo */}
                <div className="lg-card p-4">
                  <SigSection title="Real vs SLA acordado por tipo de vehículo" />
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="lg-eyebrow border-b border-border text-left">
                          <th className="px-2 py-2">Vehículo</th>
                          <th className="px-2 py-2 text-right">Real (min)</th>
                          <th className="px-2 py-2 text-right">SLA (min)</th>
                          <th className="px-2 py-2 text-right">Cumple</th>
                          <th className="px-2 py-2 text-right">Fuera</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sla.porTipo.map((t: any) => {
                          const critico = t.tipo === peorTipoSla
                          return (
                            <tr key={t.tipo} className={cn("border-b border-border last:border-0", critico && "bg-critico-bg/50")}>
                              <td className="px-2 py-2 font-medium">{critico ? <span className="flex items-center gap-1.5"><Punto tono="critico" />{t.tipo}</span> : t.tipo}</td>
                              <td className={cn("lg-num px-2 py-2 text-right", t.real <= t.sla ? "text-ok-fg" : "text-critico-fg")}>{t.real}</td>
                              <td className="lg-num px-2 py-2 text-right text-muted-foreground">{t.sla}</td>
                              <td className="px-2 py-2 text-right"><Chip tono={tonoDeColor(colorPct(t.cumplimiento, 90))}>{t.cumplimiento}%</Chip></td>
                              <td className="lg-num px-2 py-2 text-right">{t.fuera}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Evolución mensual del % SLA */}
                <div className="lg-card p-4">
                  <SigSection title="Evolución del % de cumplimiento de SLA" />
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={sla.porMes} margin={{ top: 14, right: 8, left: -8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="slaFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={SST_TOKENS.teal} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={SST_TOKENS.teal} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#0d3b6e14" />
                      <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={38} />
                      <Tooltip formatter={(v: number) => [`${v}%`, "Cumplimiento SLA"]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                      <ReferenceLine y={90} stroke={SST_TOKENS.warn} strokeDasharray="4 4" label={{ value: "Meta 90%", position: "right", fontSize: 10, fill: SST_TOKENS.warn }} />
                      <Area type="monotone" dataKey="cumplimiento" name="% SLA" stroke={SST_TOKENS.teal} strokeWidth={2.5} fill="url(#slaFill)" dot={{ r: 3, fill: SST_TOKENS.teal }} activeDot={{ r: 5 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Órdenes fuera de SLA (para gestionar) — colapsable + filtro por periodo */}
              {sla.fuera.length > 0 && (
                <TablaColapsable
                  title="Órdenes fuera de SLA (mayor exceso primero)"
                  badgeClosed={`${sla.fuera.length} órdenes`}
                  badgeOpen={`${fueraFiltradas.length} de ${sla.fuera.length}`}
                  resumen={`peor exceso +${sla.fuera[0]?.exceso ?? 0} min`}
                  filtro={<RangoChips value={rangoFuera} onChange={setRangoFuera} />}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="lg-eyebrow border-b border-border text-left">
                          <th className="px-2 py-2">Fecha</th>
                          <th className="px-2 py-2">Vehículo</th>
                          <th className="px-2 py-2 text-right">Real (min)</th>
                          <th className="px-2 py-2 text-right">SLA (min)</th>
                          <th className="px-2 py-2 text-right">Exceso (min)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fueraFiltradas.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-2 py-6 text-center text-sm text-muted-foreground">Sin órdenes fuera de SLA en el periodo seleccionado.</td>
                          </tr>
                        ) : (
                          fueraFiltradas.map((f: any, i: number) => (
                            <tr key={i} className="border-b border-border last:border-0">
                              <td className="lg-num px-2 py-2">{f.fecha}</td>
                              <td className="px-2 py-2">{f.tipo}</td>
                              <td className="lg-num px-2 py-2 text-right">{f.real}</td>
                              <td className="lg-num px-2 py-2 text-right text-muted-foreground">{f.sla}</td>
                              <td className="px-2 py-2 text-right"><Chip tono="critico">+{f.exceso}</Chip></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </TablaColapsable>
              )}
            </section>
          )}

          {/* (A.3) FACTURACIÓN PENDIENTE POR SOLICITAR */}
          {fact && (
            <section aria-label="Facturación pendiente por solicitar">
              <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
                <Receipt className="h-4 w-4 text-primary" aria-hidden />
                Facturación pendiente por solicitar
              </h2>
              <p className="mb-2 text-xs text-muted-foreground">
                Operaciones que <strong>aún no has solicitado facturar</strong>. Al solicitarlas pasan a la parte financiera. Gestiónalas a tiempo: lo pendiente afecta el flujo de caja de LIP.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KPI label="Valor pendiente por facturar" valor={fmtCOP(fact.valorPendiente)} Icon={Receipt} color={fact.valorPendiente > 0 ? SST_TOKENS.warn : SST_TOKENS.ok} sub={`${fact.pendientesCount} órdenes`} />
                <KPI label="En riesgo (> 8 días)" valor={fmtCOP(fact.valorRiesgo)} Icon={FileWarning} color={fact.valorRiesgo > 0 ? SST_TOKENS.bad : SST_TOKENS.ok} sub="sin solicitar a tiempo" />
                <KPI label="Mayor atraso" valor={fact.diasMax} unidad="días" Icon={Clock} color={fact.diasMax > 8 ? SST_TOKENS.bad : fact.diasMax > 4 ? SST_TOKENS.warn : SST_TOKENS.ok} />
                <KPI label="Gestión de facturación" valor={fact.pct} unidad="%" Icon={ShieldCheck} color={colorPct(fact.pct, 95)} sub="meta 95% · solicitadas/total" />
              </div>

              {fact.pendientes.length > 0 && (
                <TablaColapsable
                  title="Órdenes pendientes por solicitar (mayor atraso primero)"
                  badgeClosed={`${fact.pendientesCount} órdenes`}
                  badgeOpen={`${pendFiltradas.length} de ${fact.pendientes.length}`}
                  resumen={`mayor atraso ${fact.pendientes[0]?.dias ?? 0} días`}
                  filtro={<RangoChips value={rangoPend} onChange={setRangoPend} />}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="lg-eyebrow border-b border-border text-left">
                          <th className="px-2 py-2">Orden</th>
                          <th className="px-2 py-2">Fecha cargue</th>
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Placa</th>
                          <th className="px-2 py-2 text-right">Toneladas</th>
                          <th className="px-2 py-2 text-right">Valor</th>
                          <th className="px-2 py-2 text-right">Días</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendFiltradas.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-2 py-6 text-center text-sm text-muted-foreground">Sin órdenes pendientes en el periodo seleccionado.</td>
                          </tr>
                        ) : (
                          pendFiltradas.map((o: any) => (
                            <tr key={o.orden} className="border-b border-border transition-colors last:border-0 hover:bg-muted/40">
                              <td className="lg-num px-2 py-2 font-medium">{o.orden}</td>
                              <td className="lg-num px-2 py-2">{o.fecha || "—"}</td>
                              <td className="px-2 py-2">{o.cliente || "—"}</td>
                              <td className="lg-num px-2 py-2">{o.placa || "—"}</td>
                              <td className="lg-num px-2 py-2 text-right">{Number(o.toneladas).toLocaleString("es-CO")}</td>
                              <td className="lg-num px-2 py-2 text-right font-semibold">{fmtCOP(o.valor)}</td>
                              <td className="px-2 py-2 text-right"><Chip tono={o.dias > 8 ? "critico" : o.dias > 4 ? "atencion" : "ok"}>{o.dias}</Chip></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </TablaColapsable>
              )}
            </section>
          )}

          {/* (B) PERSONAS QUE PRESTAN EL SERVICIO */}
          <section aria-label="Talento que presta el servicio">
            <h2 className="mb-2 text-[15px] font-semibold">
              Talento que presta el servicio
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KPI label="Colaboradores activos" valor={p.activos} Icon={Users} color={SST_TOKENS.navy} />
              <KPI label="Cumplimiento de jornada" valor={p.asistencia} unidad="%" Icon={Users} color={colorPct(p.asistencia, 95)} sub={`asistencia ${p.asistenciaBase}`} />
              <KPI label="Rotación" valor={p.rotacion} unidad="%" Icon={Users} color={p.rotacion <= 10 ? SST_TOKENS.ok : SST_TOKENS.warn} sub={`${p.inactivos} inactivos`} />
              <KPI label="Personal vinculado" valor={p.activos + p.inactivos} Icon={Users} color={SST_TOKENS.navy} sub="histórico" />
            </div>
          </section>

          {/* (C) VALOR AGREGADO LIPgo */}
          <section aria-label="Valor agregado LIPgo">
            <h2 className="mb-1 text-[15px] font-semibold">
              Valor agregado LIPgo (trazabilidad y soportes)
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Cada subproceso queda soportado en LIPgo: orden, picking, evidencia y ciclo — control y trazabilidad para el cliente ante cualquier reclamación.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {soportes.map((x) => (
                <KPI key={x.k} label={x.k} valor={x.v} unidad="%" Icon={ShieldCheck} color={colorPct(x.v, 90)} sub={x.sub} />
              ))}
            </div>
          </section>

          {/* GRÁFICAS */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lg-card p-4">
              <SigSection title="Órdenes y toneladas por mes" />
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={data.porMes} margin={{ top: 14, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tonBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SST_TOKENS.teal} stopOpacity={0.9} />
                      <stop offset="100%" stopColor={SST_TOKENS.teal} stopOpacity={0.5} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#0d3b6e14" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={42} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip formatter={(v: number, n) => [Number(v).toLocaleString("es-CO"), n]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="toneladas" name="Toneladas" fill="url(#tonBar)" radius={[5, 5, 0, 0]} barSize={26} />
                  <Line yAxisId="r" type="monotone" dataKey="ordenes" name="Órdenes" stroke={SST_TOKENS.navy} strokeWidth={2.5} dot={{ r: 3, fill: SST_TOKENS.navy }} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="lg-card p-4">
              <SigSection title="Operaciones por tipo" />
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.porTipo} layout="vertical" margin={{ top: 8, right: 28, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="opBar" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={SST_TOKENS.navy} stopOpacity={0.85} />
                      <stop offset="100%" stopColor={SST_TOKENS.teal} stopOpacity={0.85} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#0d3b6e14" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="tipo" width={96} tick={{ fontSize: 11, fill: "#0A2540" }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "#0d3b6e08" }} formatter={(v: number) => [Number(v).toLocaleString("es-CO"), "Órdenes"]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Bar dataKey="ordenes" name="Órdenes" fill="url(#opBar)" radius={[0, 5, 5, 0]} barSize={22}>
                    <LabelList dataKey="ordenes" position="right" style={{ fontSize: 11, fill: "#0A2540", fontWeight: 600 }} formatter={(v: number) => Number(v).toLocaleString("es-CO")} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {data.verTodos && data.porCliente.length > 0 && (
            <div className="lg-card p-4">
              <SigSection title="Operación por cliente / sitio" />
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="lg-eyebrow border-b border-border text-left">
                      <th className="px-3 py-2">Cliente / sitio</th>
                      <th className="px-3 py-2 text-right">Órdenes</th>
                      <th className="px-3 py-2 text-right">Toneladas</th>
                      <th className="px-3 py-2 text-right">Cumplimiento LIP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porCliente.map((c: any) => (
                      <tr key={c.cliente} className="border-b border-border transition-colors last:border-0 hover:bg-muted/40">
                        <td className="px-3 py-2 font-medium">{c.cliente}</td>
                        <td className="lg-num px-3 py-2 text-right">{Number(c.ordenes).toLocaleString("es-CO")}</td>
                        <td className="lg-num px-3 py-2 text-right">{Number(c.toneladas).toLocaleString("es-CO")}</td>
                        <td className="px-3 py-2 text-right"><Chip tono={tonoDeColor(colorPct(c.cumplimiento, 98))}>{c.cumplimiento}%</Chip></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
