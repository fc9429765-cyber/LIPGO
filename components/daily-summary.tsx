"use client"

import { Truck, TrendingUp } from "lucide-react"
import { useEffect, useState } from "react"
import { getDailySummaryStats } from "@/lib/dashboard-summary-actions"
import { getMetaDiaForEmpresa } from "@/lib/empresa-meta-dia"
import { useAuth } from "@/components/auth-provider"

interface DailySummaryStats {
  ordenesHoy: number
  pedidosHoy: number
  toneladasMovidas: number
}

export function DailySummary() {
  const { selectedEmpresaId } = useAuth()
  const [stats, setStats] = useState<DailySummaryStats>({
    ordenesHoy: 0,
    pedidosHoy: 0,
    toneladasMovidas: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!selectedEmpresaId) return

    const loadStats = async () => {
      setLoading(true)
      try {
        const result = await getDailySummaryStats(selectedEmpresaId ?? undefined)
        if (result.success && result.data) {
          setStats(result.data)
        }
      } catch (error) {
        console.error("Error loading daily summary:", error)
      } finally {
        setLoading(false)
      }
    }

    loadStats()
    const interval = setInterval(loadStats, 300000)
    return () => clearInterval(interval)
  }, [selectedEmpresaId])

  // Meta de toneladas del día, POR EMPRESA (cambia con el selector global).
  const meta = getMetaDiaForEmpresa(selectedEmpresaId)
  const ton = stats.toneladasMovidas
  const pct = meta > 0 ? Math.min(100, Math.round((ton / meta) * 100)) : null

  // Anillo de meta.
  const R = 22
  const CIRC = 2 * Math.PI * R
  const dashoffset = pct === null ? CIRC : CIRC * (1 - pct / 100)
  const ringColor = pct === null ? "#00b4cc" : pct >= 85 ? "#12a06a" : pct >= 60 ? "#c8871a" : "#d1443f"

  return (
    <div className="mb-6 sm:mb-8">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground sm:mb-4">Pulso operativo</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {/* Órdenes */}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-2.5 flex items-center gap-3">
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
              style={{ backgroundColor: "#1f8fb026", color: "#1f8fb0" }}
            >
              <Truck className="h-[18px] w-[18px]" />
            </span>
            <span className="text-3xl font-extrabold tabular-nums tracking-tight" style={{ color: "#1f8fb0" }}>
              {loading ? "…" : stats.ordenesHoy}
            </span>
            <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Órdenes
            </span>
          </div>
          <p className="text-[13px] leading-snug text-muted-foreground">
            <b className="text-foreground">{loading ? "…" : `${ton} t`}</b> despachadas hoy en este proyecto.
          </p>
        </div>

        {/* Toneladas con MEDIDOR DE META (por empresa) */}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Toneladas · meta {meta ? `${meta} t` : "—"}
          </div>
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 58 58" className="h-[58px] w-[58px] flex-none">
              <circle cx="29" cy="29" r={R} fill="none" stroke="var(--border)" strokeWidth="7" />
              <circle
                cx="29"
                cy="29"
                r={R}
                fill="none"
                stroke={ringColor}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={dashoffset}
                style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dashoffset .6s ease" }}
              />
              <text x="29" y="33" textAnchor="middle" className="fill-foreground" style={{ font: "800 14px sans-serif" }}>
                {pct === null ? "—" : `${pct}%`}
              </text>
            </svg>
            <div>
              <div className="lg-num text-2xl font-bold tracking-tight text-foreground">
                {loading ? "…" : ton}
                <span className="ml-0.5 text-sm font-bold text-muted-foreground">t</span>
              </div>
              <div className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {pct === null ? "Sin meta asignada." : pct >= 100 ? "Meta cumplida ✓" : `${pct}% de la meta del día.`}
              </div>
            </div>
          </div>
        </div>

        {/* Pedidos */}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-2.5 flex items-center gap-3">
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
              style={{ backgroundColor: "#2f9b6426", color: "#2f9b64" }}
            >
              <TrendingUp className="h-[18px] w-[18px]" />
            </span>
            <span className="text-3xl font-extrabold tabular-nums tracking-tight" style={{ color: "#2f9b64" }}>
              {loading ? "…" : stats.pedidosHoy}
            </span>
            <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Pedidos
            </span>
          </div>
          <p className="text-[13px] leading-snug text-muted-foreground">Pedidos programados hoy en este proyecto.</p>
        </div>
      </div>
    </div>
  )
}
