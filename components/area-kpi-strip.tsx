"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { useSubmoduloFiltro } from "@/components/submodulo-filtro-context"
import { getAreaKpisRapidas } from "@/lib/area-kpis-rapidas-actions"
import { tituloAreaKpis, type AreaKpiItem } from "@/lib/area-kpis-util"
import {
  AlertTriangle,
  Clock,
  PackageOpen,
  Lock,
  Truck,
  Car,
  Receipt,
  Stethoscope,
  FileText,
  Activity,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"

const ICONS: Record<string, LucideIcon> = {
  alert: AlertTriangle,
  clock: Clock,
  package: PackageOpen,
  lock: Lock,
  truck: Truck,
  car: Car,
  receipt: Receipt,
  stethoscope: Stethoscope,
  file: FileText,
  activity: Activity,
  shield: ShieldCheck,
}

// Color del semáforo por variante (mismo criterio que las tarjetas KPI).
const COLOR_VARIANTE: Record<string, string> = {
  primary: "#0891b2",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
}

// Memo en el cliente por (grupo, submódulo, empresa, período): al navegar entre
// submódulos del mismo grupo la tira se pinta al instante desde memoria en vez
// de volver a llamar al servidor (y sin volver a mostrar el skeleton). Si el
// valor venció se muestra el anterior mientras se refresca en segundo plano.
const KPI_MEMO_TTL_MS = 10 * 60 * 1000
const kpiMemo = new Map<string, { items: AreaKpiItem[]; titulo: string | null; exp: number }>()

function Skeleton({ n }: { n: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-7 w-36 animate-pulse rounded-full border border-border/60 bg-muted/40" />
      ))}
    </div>
  )
}

/**
 * Chip compacto de indicador (rediseño 2026-09-30, gerencia: "las tarjetas son
 * muy grandes y bajan mucho la página"). Una sola línea: semáforo + ícono +
 * nombre + valor; el detalle va en el título (hover) y a la derecha en pantallas
 * anchas. Ocupa ~30 px de alto en vez de ~74 por fila de tarjetas.
 */
function Chip({ it }: { it: AreaKpiItem }) {
  const Icon = ICONS[it.icon] || AlertTriangle
  const color = COLOR_VARIANTE[it.variant] ?? COLOR_VARIANTE.primary
  return (
    <div
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2 pr-2.5 text-[12px] leading-none shadow-sm"
      title={it.subtext ? `${it.label}: ${it.value} · ${it.subtext}` : `${it.label}: ${it.value}`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
      <span className="truncate text-muted-foreground">{it.label}</span>
      <span className="shrink-0 font-bold tabular-nums text-foreground">{it.value}</span>
      {it.subtext && <span className="hidden max-w-[180px] truncate text-[10.5px] text-muted-foreground xl:inline">· {it.subtext}</span>}
    </div>
  )
}

// Tira de KPIs "a revisar". Si se pasa `moduleName` y ese submódulo tiene tira
// propia, muestra sus datos (según el BSC del módulo); si no, la tira general
// del grupo (portada del módulo madre). Rápida (conteos) + skeleton.
export function AreaKpiStrip({ groupKey, moduleName }: { groupKey: string; moduleName?: string | null }) {
  const { selectedEmpresaId, profile } = useAuth()
  // Filtro año/mes publicado por el submódulo (p. ej. Ausentismos): la tira
  // reacciona a él además del selector global.
  const { filtro } = useSubmoduloFiltro()
  const [items, setItems] = useState<AreaKpiItem[] | null>(null)
  const [tituloResp, setTituloResp] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const tituloGrupo = tituloAreaKpis(groupKey)

  useEffect(() => {
    if (!tituloGrupo) {
      setItems([])
      setLoading(false)
      return
    }
    let cancel = false
    const clave = [groupKey, moduleName ?? "", selectedEmpresaId ?? "", profile?.id ?? "", filtro.anio ?? "", filtro.mes ?? "", filtro.desde ?? "", filtro.hasta ?? ""].join("|")
    const memo = kpiMemo.get(clave)
    if (memo) {
      setItems(memo.items)
      setTituloResp(memo.titulo)
      setLoading(false)
      if (memo.exp > Date.now()) return
    } else {
      setLoading(true)
    }
    getAreaKpisRapidas(groupKey, selectedEmpresaId, profile?.id, moduleName, filtro.anio, filtro.mes, filtro.desde, filtro.hasta)
      .then((r) => {
        kpiMemo.set(clave, { items: r.items, titulo: r.titulo ?? null, exp: Date.now() + KPI_MEMO_TTL_MS })
        if (!cancel) { setItems(r.items); setTituloResp(r.titulo ?? null) }
      })
      .catch(() => { if (!cancel && !memo) { setItems([]); setTituloResp(null) } })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [groupKey, moduleName, selectedEmpresaId, profile?.id, tituloGrupo, filtro.anio, filtro.mes, filtro.desde, filtro.hasta])

  const titulo = tituloResp ?? tituloGrupo

  if (!tituloGrupo) return null
  if (loading && !items) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{titulo}</span>
        <Skeleton n={4} />
      </div>
    )
  }
  if (!items || items.length === 0) return null

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{titulo}</span>
      {items.map((it, i) => (
        <Chip key={i} it={it} />
      ))}
    </div>
  )
}
