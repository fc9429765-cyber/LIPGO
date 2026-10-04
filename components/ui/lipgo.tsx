"use client"

// PRIMITIVAS DEL SISTEMA VISUAL LIPgo (2026-10-02).
//
// Reglas que comparten todos los módulos, en componentes pequeños:
//   Eyebrow     etiqueta de contexto en mayúsculas sobre un título o cifra
//   Cifra       una cifra protagonista (40 px) con unidad, sub-línea y barra
//   Chip        estado en píldora: ok · atención · crítico · info · neutro
//   Punto       severidad por un punto de color (nunca fondos enteros)
//   Seccion     tarjeta con cabecera (eyebrow + título + acción) y cuerpo
//   FilaAccion  renglón de bandeja: punto · texto · botón
//   Progreso    barra fina hacia una meta
//   Esqueleto   carga con la forma final, no una rueda
//   EstadoVacio "todo al día" con el siguiente paso
// Los colores salen de los tokens de app/globals.css (--color-ok-*, etc.).

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type Tono = "ok" | "atencion" | "critico" | "info" | "neutro"

const CHIP: Record<Tono, string> = {
  ok: "border-ok-bd bg-ok-bg text-ok-fg",
  atencion: "border-atencion-bd bg-atencion-bg text-atencion-fg",
  critico: "border-critico-bd bg-critico-bg text-critico-fg",
  info: "border-info-bd bg-info-bg text-info-fg",
  neutro: "border-slate-200 bg-slate-100 text-slate-700",
}

const PUNTO: Record<Tono, string> = {
  ok: "bg-acento shadow-[0_0_0_4px_#CCFBF1]",
  atencion: "bg-amber-600 shadow-[0_0_0_4px_#FFEDD5]",
  critico: "bg-red-700 shadow-[0_0_0_4px_#FEE2E2]",
  info: "bg-blue-700 shadow-[0_0_0_4px_#DBEAFE]",
  neutro: "bg-slate-400 shadow-[0_0_0_4px_#F1F5F9]",
}

/** Color de texto de una cifra según su tono. */
export const TEXTO_TONO: Record<Tono, string> = {
  ok: "text-ok-fg",
  atencion: "text-atencion-fg",
  critico: "text-critico-fg",
  info: "text-info-fg",
  neutro: "text-foreground",
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("lg-eyebrow", className)}>{children}</p>
}

export function Chip({ tono = "neutro", children, className, title }: { tono?: Tono; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("lg-num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", CHIP[tono], className)}>
      {children}
    </span>
  )
}

export function Punto({ tono, className }: { tono: Tono; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", PUNTO[tono], className)} />
}

export function Progreso({ pct, tono, className }: { pct: number; tono?: Tono; className?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  const color = tono === "atencion" ? "bg-amber-500" : tono === "critico" ? "bg-red-600" : tono === "info" ? "bg-blue-600" : "bg-acento"
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${p}%` }} />
    </div>
  )
}

export function Cifra({
  label,
  valor,
  unidad,
  sub,
  tono = "neutro",
  progreso,
  chips,
  className,
  tamano = "grande",
}: {
  label: ReactNode
  valor: ReactNode
  unidad?: ReactNode
  sub?: ReactNode
  tono?: Tono
  /** 0–100: pinta una barra bajo la cifra. */
  progreso?: number
  chips?: ReactNode
  className?: string
  tamano?: "grande" | "compacta"
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Eyebrow>{label}</Eyebrow>
      <div className="flex items-baseline gap-2">
        <span className={cn("lg-num font-bold leading-none tracking-tight", tamano === "grande" ? "text-[34px] sm:text-[38px]" : "text-2xl", TEXTO_TONO[tono])}>{valor}</span>
        {unidad && <span className="lg-num truncate text-sm text-muted-foreground">{unidad}</span>}
      </div>
      {progreso != null && <Progreso pct={progreso} tono={tono === "neutro" ? undefined : tono} className="mt-1" />}
      {chips && <div className="flex flex-wrap gap-1.5">{chips}</div>}
      {sub && <div className="lg-num text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export function Seccion({
  eyebrow,
  titulo,
  accion,
  children,
  className,
  sinPadding,
}: {
  eyebrow?: ReactNode
  titulo: ReactNode
  accion?: ReactNode
  children: ReactNode
  className?: string
  /** El cuerpo lo maneja el hijo (listas con divisores). */
  sinPadding?: boolean
}) {
  return (
    <section className={cn("lg-card overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h2 className="truncate text-[15px] font-bold leading-tight sm:text-base">{titulo}</h2>
        </div>
        {accion && <div className="flex shrink-0 items-center gap-2">{accion}</div>}
      </div>
      <div className={sinPadding ? undefined : "px-4 py-4 sm:px-5"}>{children}</div>
    </section>
  )
}

export function FilaAccion({
  tono,
  titulo,
  detalle,
  boton,
  onClick,
  children,
}: {
  tono: Tono
  titulo: ReactNode
  detalle?: ReactNode
  boton?: ReactNode
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3.5">
        <Punto tono={tono} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{titulo}</p>
          {detalle && <p className="lg-num mt-0.5 text-xs text-muted-foreground">{detalle}</p>}
        </div>
        {boton && onClick && (
          <button
            type="button"
            onClick={onClick}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[10px] border border-input bg-background px-3 text-xs font-semibold transition-colors hover:bg-accent"
          >
            {boton}
          </button>
        )}
      </div>
      {children && <div className="mt-2 pl-[22px]">{children}</div>}
    </li>
  )
}

export function Esqueleto({ lineas = 3, className }: { lineas?: number; className?: string }) {
  const anchos = ["40%", "65%", "85%", "55%", "72%", "48%"]
  return (
    <div className={cn("flex animate-pulse flex-col gap-2.5", className)} aria-hidden>
      {Array.from({ length: lineas }).map((_, i) => (
        <span key={i} className={cn("block rounded-md bg-muted", i === 1 ? "h-7" : "h-3")} style={{ width: anchos[i % anchos.length] }} />
      ))}
    </div>
  )
}

export function EstadoVacio({ icono, titulo, texto, accion, className }: { icono?: ReactNode; titulo: ReactNode; texto?: ReactNode; accion?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center", className)}>
      {icono && <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ok-bg text-ok-fg">{icono}</span>}
      <p className="text-sm font-semibold">{titulo}</p>
      {texto && <p className="max-w-sm text-xs text-muted-foreground">{texto}</p>}
      {accion && <div className="mt-1">{accion}</div>}
    </div>
  )
}
