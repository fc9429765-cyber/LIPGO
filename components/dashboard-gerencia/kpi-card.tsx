"use client"

import type { LucideIcon } from "lucide-react"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCountUp, formatAnimatedNumber } from "./use-count-up"

/**
 * Paleta semantica interna del dashboard ejecutivo.
 * Se alinea con los tokens de LIPGO (cian #5bc0de como primary) y usa
 * el resto como acentos semanticos legibles sobre fondo claro (#F4F7FC).
 */
export type KpiAccent = "cyan" | "emerald" | "amber" | "rose" | "violet" | "sky" | "teal"

export interface KpiCardProps {
  /** Icono de lucide-react mostrado en la esquina superior izquierda. */
  icon: LucideIcon
  /** Etiqueta corta debajo del valor principal (ej. "Vehiculos Recibidos"). */
  label: string
  /**
   * Valor principal grande. Puede ser numero o texto ya formateado.
   * Si se pasa como `number`, se anima con count-up automatico. Si se pasa
   * como `string` se muestra tal cual (util para "24" custom, "1.2k", etc).
   * Para animar un valor porcentual se recomienda pasar `value={94.7}` y
   * `unit="%"` — el card usara `useCountUp` y preservara decimales con
   * `decimals`.
   */
  value: string | number
  /** Sufijo o unidad mostrada al lado del valor (%, t, etc.). */
  unit?: string
  /**
   * Numero de decimales a preservar en la animacion count-up. Solo aplica
   * cuando `value` es numerico. Default 0.
   */
  decimals?: number
  /** Variacion numerica (positiva/negativa/cero). Se formatea como `+12%`. */
  trend?: number
  /**
   * Texto explicativo del trend (ej. "vs. ayer", "Meta 95%"). Si no se provee,
   * se muestra un micro-copy generico.
   */
  trendHint?: string
  /**
   * Forzar el tono del badge de trend. Por defecto se infiere del signo:
   *  - positivo -> verde
   *  - negativo -> rojo
   *  - cero     -> slate
   * En algunos KPIs un "up" es malo (ej. Alertas), en esos casos se pasa
   * `invertTrend` para invertir la logica de color.
   */
  invertTrend?: boolean
  /** Acento principal del card (icono + borde tenue). */
  accent?: KpiAccent
  /** Clase adicional por si el consumidor quiere ajustar el grid span. */
  className?: string
}

/**
 * Mapeo acento -> clases Tailwind. Tema claro LIPGO: tintes pastel
 * sobre card blanca, texto oscuro para contraste AA.
 */
const ACCENT_CLASSES: Record<
  KpiAccent,
  { iconBg: string; iconFg: string; iconBorder: string; ring: string; glow: string }
> = {
  cyan: {
    iconBg: "bg-[#5bc0de]/15",
    iconFg: "text-[#0aa1c4]",
    iconBorder: "border-[#5bc0de]/40",
    ring: "ring-[#5bc0de]/30",
    glow: "before:bg-[#5bc0de]/20",
  },
  emerald: {
    iconBg: "bg-emerald-100",
    iconFg: "text-emerald-700",
    iconBorder: "border-emerald-300",
    ring: "ring-emerald-300/60",
    glow: "before:bg-emerald-200/40",
  },
  amber: {
    iconBg: "bg-amber-100",
    iconFg: "text-amber-700",
    iconBorder: "border-amber-300",
    ring: "ring-amber-300/60",
    glow: "before:bg-amber-200/40",
  },
  rose: {
    iconBg: "bg-rose-100",
    iconFg: "text-rose-700",
    iconBorder: "border-rose-300",
    ring: "ring-rose-300/60",
    glow: "before:bg-rose-200/40",
  },
  violet: {
    iconBg: "bg-violet-100",
    iconFg: "text-violet-700",
    iconBorder: "border-violet-300",
    ring: "ring-violet-300/60",
    glow: "before:bg-violet-200/40",
  },
  sky: {
    iconBg: "bg-sky-100",
    iconFg: "text-sky-700",
    iconBorder: "border-sky-300",
    ring: "ring-sky-300/60",
    glow: "before:bg-sky-200/40",
  },
  teal: {
    iconBg: "bg-teal-100",
    iconFg: "text-teal-700",
    iconBorder: "border-teal-300",
    ring: "ring-teal-300/60",
    glow: "before:bg-teal-200/40",
  },
}

function formatTrend(trend: number): string {
  const sign = trend > 0 ? "+" : ""
  // Redondear a 1 decimal si no es entero para evitar `12.0000000001`.
  const rounded = Number.isInteger(trend) ? trend : Math.round(trend * 10) / 10
  return `${sign}${rounded}%`
}

export function KpiCard({
  icon: Icon,
  label,
  value,
  unit,
  decimals = 0,
  trend,
  trendHint,
  invertTrend = false,
  accent = "cyan",
  className,
}: KpiCardProps) {
  const accentCls = ACCENT_CLASSES[accent]

  // Valor animado — solo si el consumidor paso un numero. Si paso un string
  // ya-formateado (ej. "1.2k") lo mostramos literal.
  const isNumeric = typeof value === "number" && Number.isFinite(value)
  const animated = useCountUp(isNumeric ? (value as number) : 0)
  const displayValue = isNumeric
    ? formatAnimatedNumber(animated, decimals)
    : (value as string)

  // Logica de color del trend:
  //  - positivo + !invert o negativo + invert => good (verde)
  //  - negativo + !invert o positivo + invert => bad (rojo)
  //  - cero / undefined                       => neutro
  let trendKind: "good" | "bad" | "neutral" = "neutral"
  if (typeof trend === "number" && trend !== 0) {
    const positive = trend > 0
    const good = invertTrend ? !positive : positive
    trendKind = good ? "good" : "bad"
  }

  const TrendIcon =
    typeof trend !== "number" || trend === 0
      ? Minus
      : (trend > 0 && !invertTrend) || (trend < 0 && invertTrend)
        ? TrendingUp
        : TrendingDown

  const trendColor =
    trendKind === "good"
      ? "text-emerald-600"
      : trendKind === "bad"
        ? "text-rose-600"
        : "text-muted-foreground"

  return (
    <div
      className={cn(
        // Card base: fondo blanco LIPGO, borde sutil, esquinas redondeadas.
        "relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
        // Glow decorativo en la esquina superior derecha.
        "before:absolute before:-top-10 before:-right-10 before:h-32 before:w-32 before:rounded-full before:blur-2xl before:opacity-70 before:pointer-events-none",
        accentCls.glow,
        // Ring tenue del acento al hacer hover.
        "transition-all duration-300 hover:shadow-md hover:ring-1",
        accentCls.ring,
        className,
      )}
    >
      <div className="relative p-4 md:p-5">
        {/* Fila superior: icono + trend */}
        <div className="flex items-start justify-between gap-2">
          <div
            className={cn(
              "h-10 w-10 rounded-xl border flex items-center justify-center",
              accentCls.iconBg,
              accentCls.iconBorder,
            )}
          >
            <Icon className={cn("h-5 w-5", accentCls.iconFg)} aria-hidden="true" />
          </div>

          {typeof trend === "number" && (
            <div className={cn("flex items-center gap-1 text-xs font-semibold", trendColor)}>
              <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{formatTrend(trend)}</span>
            </div>
          )}
        </div>

        {/* Valor principal — con count-up cuando es numerico */}
        <div className="mt-4 flex items-baseline gap-1.5">
          <span className="text-2xl md:text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {displayValue}
          </span>
          {unit && (
            <span className="text-sm font-medium text-muted-foreground">{unit}</span>
          )}
        </div>

        {/* Label y sub-texto */}
        <div className="mt-1">
          <p className="text-[11px] md:text-xs font-semibold text-foreground/80 leading-tight">
            {label}
          </p>
          {trendHint && (
            <p className="mt-0.5 text-[10px] text-muted-foreground leading-tight truncate">
              {trendHint}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
