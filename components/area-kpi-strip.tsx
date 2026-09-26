"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { useSubmoduloFiltro } from "@/components/submodulo-filtro-context"
import { KpiCard } from "@/components/orders/dashboard-pedidos/kpi-card"
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

// Memo en el cliente por (grupo, submódulo, empresa, período): al navegar entre
// submódulos del mismo grupo la tira se pinta al instante desde memoria en vez
// de volver a llamar al servidor (y sin volver a mostrar el skeleton). Si el
// valor venció se muestra el anterior mientras se refresca en segundo plano.
const KPI_MEMO_TTL_MS = 10 * 60 * 1000
const kpiMemo = new Map<string, { items: AreaKpiItem[]; titulo: string | null; exp: number }>()

function Skeleton({ n }: { n: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-[74px] animate-pulse rounded-xl border border-border/60 bg-muted/40" />
      ))}
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
      <div className="mb-5 space-y-1">
        <div className="text-sm font-semibold text-foreground">{titulo}</div>
        <Skeleton n={4} />
      </div>
    )
  }
  if (!items || items.length === 0) return null

  return (
    <div className="mb-5 space-y-1">
      <div className="text-sm font-semibold text-foreground">{titulo}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {items.map((it, i) => {
          const Icon = ICONS[it.icon] || AlertTriangle
          return (
            <KpiCard key={i} label={it.label} value={it.value} subtext={it.subtext} icon={Icon} variant={it.variant} />
          )
        })}
      </div>
    </div>
  )
}
