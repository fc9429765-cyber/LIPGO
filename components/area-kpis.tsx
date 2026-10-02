"use client"

import { useState } from "react"
import { AREA_KPIS, KPI_DEFS, formatKpi, kpiSev, type KpiSev } from "@/lib/kpis-area"
import type { GroupKey } from "@/lib/dashboard-data"
import { BscIndicadorModal } from "@/components/indicadores/bsc-indicador-modal"

const SEV_COLOR: Record<KpiSev, string> = {
  good: "#12a06a",
  warn: "#c8871a",
  crit: "#d1443f",
  none: "#00b4cc",
}

export interface ValorBsc {
  valor: number
  base?: string
}

/**
 * KPIs del ÁREA leídos del BSC, POR SUBMÓDULO. Ya NO consulta datos: recibe
 * `valores` y `loading` del padre (modules-view), que hace UNA sola lectura de
 * `getIndicadoresValores` por empresa/grupo. Así los KPIs mostrados y las
 * "tareas del día" de la IA salen de la MISMA fuente y siempre coinciden.
 * Cada grupo muestra su propio set (AREA_KPIS[groupKey]); si no tiene mapeo,
 * no renderiza nada.
 */
export function AreaKpis({
  groupKey,
  valores,
  loading,
  compacto = false,
}: {
  groupKey: GroupKey
  valores: Record<string, ValorBsc>
  loading: boolean
  /** Una sola línea de chips (portal de área rediseñado 2026-09-30) en vez de tarjetas grandes. */
  compacto?: boolean
}) {
  const [ver, setVer] = useState<string | null>(null)
  const keys = AREA_KPIS[groupKey] ?? []
  if (keys.length === 0) return null

  if (compacto) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Indicadores del área</span>
        {keys.map((k) => {
          const def = KPI_DEFS[k]
          if (!def) return null
          const v = valores[k]
          const sinDatos = (k === "sat_cliente" || k === "sat_conductor") && v?.base === "0 encuestas"
          const sev = v && !sinDatos ? kpiSev(def, v.valor) : "none"
          const color = SEV_COLOR[sev]
          const valor = loading && !v ? "…" : sinDatos ? "sin datos" : v ? formatKpi(def, v.valor) : "—"
          return (
            <button
              key={k}
              type="button"
              onClick={() => setVer(k)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2 pr-2.5 text-[12px] leading-none shadow-sm transition-colors hover:bg-accent"
              title={`${def.nombre}: ${valor}${def.meta != null ? ` · meta ${formatKpi(def, def.meta)}` : ""} · ver detalle`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: v && !sinDatos ? color : "var(--border)" }} aria-hidden="true" />
              <span className="truncate text-muted-foreground">{def.nombre}</span>
              <span className="shrink-0 font-bold tabular-nums" style={{ color: v && !sinDatos ? color : undefined }}>{valor}</span>
              {def.meta != null && <span className="hidden text-[10.5px] text-muted-foreground lg:inline">· meta {formatKpi(def, def.meta)}</span>}
            </button>
          )
        })}
        {ver && <BscIndicadorModal codigo={ver} def={KPI_DEFS[ver]} actual={valores[ver]?.valor ?? null} onClose={() => setVer(null)} />}
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Indicadores del área
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal"
          style={{ color: "#7b57c9", background: "color-mix(in srgb, #7b57c9 14%, transparent)" }}
        >
          ✨ del Tablero BSC
        </span>
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5">
        {keys.map((k) => {
          const def = KPI_DEFS[k]
          if (!def) return null
          const v = valores[k]
          // sat_cliente/sat_conductor caen a 0% cuando todavía no hay NINGUNA
          // encuesta real (no es que la satisfacción sea mala) -- mostrar "Sin
          // datos" en vez de "0%" para no leerse como una falla operativa.
          const sinDatos = (k === "sat_cliente" || k === "sat_conductor") && v?.base === "0 encuestas"
          const sev = v && !sinDatos ? kpiSev(def, v.valor) : "none"
          const color = SEV_COLOR[sev]
          return (
            <button
              key={k}
              type="button"
              onClick={() => setVer(k)}
              className="rounded-2xl border border-border bg-card p-3.5 text-left transition-shadow hover:shadow-md"
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                <span
                  className="h-[7px] w-[7px] flex-none rounded-full"
                  style={{ background: v && !sinDatos ? color : "var(--border)" }}
                />
                <span className="truncate">{def.nombre}</span>
              </div>
              <div
                className="mt-2 lg-num text-2xl font-bold tracking-tight"
                style={{ color: v && !sinDatos ? color : "var(--muted-foreground)" }}
              >
                {loading && !v ? "…" : sinDatos ? "Sin datos" : v ? formatKpi(def, v.valor) : "—"}
              </div>
              <div className="mt-1 flex items-center justify-between gap-1 truncate text-[10.5px] text-muted-foreground/80">
                <span className="truncate">{sinDatos ? "aún no hay encuestas" : def.meta != null ? `meta ${formatKpi(def, def.meta)}` : v?.base || " "}</span>
                <span className="shrink-0 text-primary/70">ver 3D →</span>
              </div>
            </button>
          )
        })}
      </div>

      {ver && <BscIndicadorModal codigo={ver} def={KPI_DEFS[ver]} actual={valores[ver]?.valor ?? null} onClose={() => setVer(null)} />}
    </div>
  )
}
