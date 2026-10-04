"use client"

// FRAMEWORK GENÉRICO DE INDICADORES (reutilizable en toda la app).
// `IndicadorViewer` es una vista 3D/futurista de UN indicador, PRESENTACIÓN PURA:
// no hace fetch ni sabe de SST/BSC. Recibe `IndicadorDatos` (ficha + serie +
// consolidado + comparativo) y pinta gauge, tendencia, interanual, ficha técnica
// y análisis. Cualquier módulo (SST, BSC, tiras KPI…) lo alimenta con su data.

import { useEffect, useState } from "react"
import { X, TrendingDown, TrendingUp, Minus, Download, Loader2 } from "lucide-react"
import { generarFichaIndicadorPDF } from "@/lib/indicador-pdf-actions"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts"

export type Sentido = "menor" | "mayor"

// Modelo ÚNICO de ficha técnica (exigencia de la norma / gobierno de indicadores).
export interface FichaIndicador {
  codigo: string
  nombre: string
  area?: string | null
  numeral?: string | null // p. ej. numeral 0312, cláusula ISO…
  definicion?: string | null
  formula?: string | null
  interpretacion?: string | null
  fuente?: string | null
  periodicidad?: string | null
  responsable?: string | null
  unidad?: string | null
  meta: number | null
  sentido: Sentido
}

export interface SeriePunto {
  etiqueta: string // "Ene", "2025-01"…
  valor: number | null
}

export interface IndicadorDatos {
  ficha: FichaIndicador
  serie: SeriePunto[] // tendencia (mensual)
  actual: number | null // valor consolidado del período mostrado
  anterior?: number | null // valor del período anterior (interanual)
  periodo?: string // etiqueta del período actual (p. ej. "2026")
  periodoAnterior?: string
  analisis?: string | null
}

// ¿En meta? según sentido.
export function enMeta(valor: number | null, meta: number | null, sentido: Sentido): boolean | null {
  if (valor == null || meta == null) return null
  return sentido === "menor" ? valor <= meta : valor >= meta
}

// Cumplimiento 0..1 de la meta (para el gauge).
export function cumplimientoMeta(valor: number | null, meta: number | null, sentido: Sentido): number {
  if (valor == null || meta == null) return 0
  if (sentido === "menor") return meta === 0 ? (valor === 0 ? 1 : 0) : Math.max(0, Math.min(1, meta / (valor || 1)))
  return meta === 0 ? 1 : Math.max(0, Math.min(1, valor / meta))
}

// Color de identidad por ÁREA (barra superior). No sustituye al semáforo —
// solo ayuda a ubicar de un vistazo a qué área pertenece el indicador.
const AREA_COLORS: Record<string, string> = {
  sst: "#38bdf8", // Seguridad y Salud
  humana: "#a78bfa", // Gestión Humana
  financ: "#34d399", // Financiera
  operac: "#22d3ee", // Operación LIP
  despach: "#22d3ee",
  inventar: "#fbbf24", // Almacenamiento
  almacen: "#fbbf24",
  sig: "#818cf8", // SIG / Calidad
  pedido: "#f472b6",
}
function colorArea(area?: string | null): string {
  const a = String(area || "").toLowerCase()
  const k = Object.keys(AREA_COLORS).find((x) => a.includes(x))
  return k ? AREA_COLORS[k] : "#60a5fa"
}

export function IndicadorViewer({ datos, onClose }: { datos: IndicadorDatos; onClose: () => void }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onEsc)
    return () => window.removeEventListener("keydown", onEsc)
  }, [onClose])

  const [exportando, setExportando] = useState(false)
  const exportarPDF = async () => {
    setExportando(true)
    try {
      const r = await generarFichaIndicadorPDF(datos)
      if (r.success && r.base64) {
        const bin = atob(r.base64)
        const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }))
        const a = document.createElement("a")
        a.href = url
        a.download = r.fileName || "ficha-indicador.pdf"
        a.click()
        URL.revokeObjectURL(url)
      }
    } finally {
      setExportando(false)
    }
  }

  const { ficha, serie, actual, anterior, periodo, periodoAnterior, analisis } = datos
  const sentido = ficha.sentido
  const ok = enMeta(actual, ficha.meta, sentido)
  const accent = ok == null ? "#38bdf8" : ok ? "#34d399" : "#fb7185" // cian / verde / rojo neón
  const delta = actual != null && anterior != null ? Math.round((actual - anterior) * 10) / 10 : null
  const mejora = delta == null ? null : sentido === "menor" ? delta < 0 : delta > 0
  const cumpl = cumplimientoMeta(actual, ficha.meta, sentido)
  const R = 52
  const C = 2 * Math.PI * R
  const chart = serie.map((p) => ({ mes: p.etiqueta, valor: p.valor }))
  const areaC = colorArea(ficha.area)

  return (
    <div className="indv-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <style>{`
        .indv-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
          background:radial-gradient(120% 120% at 50% 0%, rgba(10,22,40,.72), rgba(3,7,18,.86));
          backdrop-filter:blur(6px);animation:indv-fade .25s ease;padding:16px;overflow-y:auto;}
        @keyframes indv-fade{from{opacity:0}to{opacity:1}}
        .indv-panel{position:relative;width:min(760px,96vw);max-height:92vh;overflow-y:auto;border-radius:20px;
          color:#e6f3ff;background:linear-gradient(160deg,#0b1c33 0%,#0e2748 55%,#0a1930 100%);
          border:1px solid rgba(96,180,240,.35);
          box-shadow:0 0 0 1px rgba(120,200,255,.08), 0 30px 80px -20px rgba(0,0,0,.8), 0 0 60px -10px ${accent}55;
          transform:perspective(1400px) rotateX(6deg) translateY(8px) scale(.96);opacity:0;
          animation:indv-in .5s cubic-bezier(.16,1,.3,1) forwards;}
        @keyframes indv-in{to{transform:perspective(1400px) rotateX(0) translateY(0) scale(1);opacity:1}}
        .indv-grid{position:absolute;inset:0;border-radius:20px;pointer-events:none;opacity:.5;
          background-image:linear-gradient(rgba(120,200,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(120,200,255,.06) 1px,transparent 1px);
          background-size:26px 26px;mask-image:radial-gradient(80% 60% at 50% 0%,#000,transparent 75%);}
        .indv-glass{background:rgba(255,255,255,.05);border:1px solid rgba(150,210,255,.14);border-radius:14px;backdrop-filter:blur(4px);}
        .indv-chip{font-size:10px;font-weight:800;letter-spacing:.5px;padding:2px 8px;border-radius:999px;color:#04121f;}
        .indv-ring{filter:drop-shadow(0 0 8px ${accent}aa);}
        .indv-x{position:absolute;top:14px;right:14px;color:#bfe0f5;opacity:.8;transition:.15s;}
        .indv-x:hover{opacity:1;transform:rotate(90deg);}
      `}</style>

      <div className="indv-panel" onClick={(e) => e.stopPropagation()}>
        {/* Barra de identidad por área (no es el semáforo) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            background: `linear-gradient(90deg, ${areaC}, ${areaC}00 70%)`,
          }}
        />
        <div className="indv-grid" />
        <button type="button" className="indv-x" onClick={onClose} aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>

        <div className="relative p-6">
          {/* Encabezado */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="indv-chip" style={{ background: accent }}>
              {ficha.numeral ? ficha.numeral : ficha.area || "Indicador"}
            </span>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: areaC, boxShadow: `0 0 8px ${areaC}` }} />
            <span className="text-[11px] font-medium uppercase tracking-[.22em] text-sky-300/80">
              {ficha.area ? `${ficha.area} · ` : ""}
              {periodo ?? ""}
            </span>
            <button
              type="button"
              onClick={exportarPDF}
              disabled={exportando}
              className="ml-auto mr-6 inline-flex items-center gap-1 rounded-md border border-sky-400/30 bg-white/5 px-2 py-1 text-[11px] font-semibold text-sky-100 transition-colors hover:bg-white/10 disabled:opacity-60"
            >
              {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Ficha PDF
            </button>
          </div>
          <h2 className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight text-white" style={{ textWrap: "balance" } as any}>
            {ficha.nombre}
          </h2>

          {/* Gauge + valor */}
          <div className="mt-4 grid items-center gap-4 sm:grid-cols-[auto,1fr]">
            <div className="relative mx-auto h-36 w-36">
              <svg viewBox="0 0 120 120" className="indv-ring h-36 w-36 -rotate-90">
                <defs>
                  <linearGradient id={`indvgauge-${ficha.codigo}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={accent} stopOpacity={1} />
                  </linearGradient>
                </defs>
                <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(150,210,255,.12)" strokeWidth="8" />
                <circle
                  cx="60"
                  cy="60"
                  r={R}
                  fill="none"
                  stroke={`url(#indvgauge-${ficha.codigo})`}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - cumpl)}
                  style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.16,1,.3,1)" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[34px] font-bold leading-none tabular-nums tracking-tight" style={{ color: accent }}>
                  {actual ?? "—"}
                </span>
                <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-300/60">{ficha.unidad || ""}</span>
                {ficha.meta != null && (
                  <span className="mt-1 text-[10px] font-semibold text-sky-200/70">{Math.round(cumpl * 100)}% meta</span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md px-2 py-1 text-xs font-bold" style={{ background: `${accent}22`, color: accent }}>
                  {ok == null ? "SIN META" : ok ? "EN META" : "FUERA DE META"}
                </span>
                <span className="text-xs text-sky-200/80">
                  Meta: {ficha.meta ?? "—"} · {sentido === "menor" ? "menor es mejor" : "mayor es mejor"}
                </span>
              </div>
              {delta != null && (
                <div
                  className="flex items-center gap-1 text-sm font-semibold"
                  style={{ color: mejora ? "#34d399" : delta === 0 ? "#94a3b8" : "#fb7185" }}
                >
                  {mejora ? <TrendingDown className="h-4 w-4" /> : delta === 0 ? <Minus className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                  {delta > 0 ? "+" : ""}
                  {delta} vs {periodoAnterior ?? "anterior"} {anterior != null ? `(${anterior} → ${actual})` : ""}{" "}
                  {mejora ? "· mejora" : delta === 0 ? "" : "· empeora"}
                </div>
              )}
              {ficha.interpretacion && <p className="text-xs text-sky-200/70">{ficha.interpretacion}</p>}
            </div>
          </div>

          {/* Tendencia (neón) */}
          {chart.length > 0 && (
            <div className="indv-glass mt-5 h-52 p-3">
              <div className="mb-1 text-[11px] uppercase tracking-widest text-sky-300/70">Tendencia {periodo ?? ""}</div>
              <ResponsiveContainer width="100%" height="85%">
                <AreaChart data={chart} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id={`indvfill-${ficha.codigo}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={accent} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(150,210,255,.12)" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10, fill: "#9fc7e8" }} axisLine={{ stroke: "rgba(150,210,255,.2)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#9fc7e8" }} width={34} axisLine={{ stroke: "rgba(150,210,255,.2)" }} />
                  <Tooltip contentStyle={{ background: "#0b1c33", border: `1px solid ${accent}55`, borderRadius: 10, color: "#e6f3ff", fontSize: 12 }} formatter={(v: any) => [v, ficha.nombre]} />
                  {ficha.meta != null && (
                    <ReferenceLine y={ficha.meta} stroke="#fb7185" strokeDasharray="5 4" label={{ value: `Meta ${ficha.meta}`, fontSize: 10, fill: "#fb7185", position: "right" }} />
                  )}
                  <Area type="monotone" dataKey="valor" stroke={accent} strokeWidth={2.5} fill={`url(#indvfill-${ficha.codigo})`} dot={{ r: 3, fill: accent, stroke: "#04121f" }} isAnimationActive connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Ficha técnica (glass) */}
          <div className="indv-glass mt-4 p-4">
            <div className="mb-2 text-[11px] uppercase tracking-widest text-sky-300/70">Ficha técnica</div>
            <div className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              {ficha.definicion && <FT l="Definición" v={ficha.definicion} full />}
              {ficha.formula && <FT l="Fórmula" v={ficha.formula} />}
              {ficha.interpretacion && <FT l="Interpretación" v={ficha.interpretacion} />}
              {ficha.fuente && <FT l="Fuente" v={ficha.fuente} />}
              {ficha.periodicidad && <FT l="Periodicidad" v={ficha.periodicidad} />}
              {ficha.responsable && <FT l="Responsable" v={ficha.responsable} />}
              <FT l="Meta" v={`${ficha.meta ?? "—"} (${sentido === "menor" ? "menor es mejor" : "mayor es mejor"})`} />
            </div>
          </div>

          {analisis && (
            <div className="indv-glass mt-3 p-3 text-xs">
              <span className="font-semibold text-sky-100">Análisis: </span>
              <span className="text-sky-200/80">{analisis}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FT({ l, v, full }: { l: string; v: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <span className="font-semibold text-sky-100">{l}: </span>
      <span className="text-sky-200/75">{v}</span>
    </div>
  )
}
