"use client"

import { useEffect, useState, type CSSProperties } from "react"
import { filterGroupsByPermissions, type GroupKey, type Module } from "@/lib/dashboard-data"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { TINT } from "@/components/module-cards"
import { AreaKpis, type ValorBsc } from "@/components/area-kpis"
import { PedidosKpiStrip } from "@/components/orders/pedidos-kpi-strip"
import { DespachoKpiStrip } from "@/components/orders/despacho-kpi-strip"
import { VehiculosNoProcesadosCard } from "@/components/vehiculos-no-procesados-card"
import { useAuth } from "@/components/auth-provider"
import { getIndicadoresValores } from "@/lib/sig-actions"
import { AREA_KPIS } from "@/lib/kpis-area"
import { colorDeEntrada, plegarEnHubs, type EntradaMenu } from "@/lib/navegacion"

interface ModulesViewProps {
  groupKey: GroupKey
  onBack: () => void
  onSelectModule: (moduleName: string) => void
  /** Navegación robusta (grupo + módulo) para el asistente IA. */
  onNavigate?: (moduleName: string) => void
  /** Abrir un módulo principal (grupo) para el asistente IA. */
  onOpenGroup?: (key: string) => void
}

const TEAL = "#00b4cc"

function monthRange() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-${day}` }
}


// Tarjeta de submódulo VIVA: mismo lenguaje que el launcher de Inicio. Toma el
// color de dominio del grupo (`--tint`) y, en hover, florece — glow del color,
// leve lift, el tile del ícono se enciende a degradado y aparece una flecha de
// "abrir". Coherente, distintiva y con affordance clara de que es clickeable.
function ModuleCard({
  module,
  onSelect,
  tint,
}: {
  module: Module
  onSelect: (name: string) => void
  tint: string
}) {
  const Icon = module.icon
  return (
    <button
      onClick={() => onSelect(module.name)}
      className="mod-card"
      style={{ "--tint": tint } as CSSProperties}
    >
      <span className="mod-ico">
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <span className="mod-name">{module.label ?? module.name}</span>
      <ArrowRight className="mod-arrow h-4 w-4" />
    </button>
  )
}

// Tarjeta de HUB (pantalla con pestañas): mismo lenguaje visual que la de
// módulo, con el conteo de pestañas visibles para el usuario. Abre la primera.
function HubCard({
  entrada,
  onSelect,
  tint,
}: {
  entrada: Extract<EntradaMenu, { tipo: "hub" }>
  onSelect: (name: string) => void
  tint: string
}) {
  const Icon = entrada.hub.icon
  const n = entrada.tabs.length
  return (
    <button
      onClick={() => entrada.tabs[0] && onSelect(entrada.tabs[0].name)}
      className="mod-card"
      style={{ "--tint": tint } as CSSProperties}
      title={entrada.tabs.map((t) => t.label ?? t.name).join(" · ")}
    >
      <span className="mod-ico">
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <span className="mod-name">
        {entrada.hub.title}
        <span className="mt-0.5 block text-[10.5px] font-medium text-muted-foreground">
          {n} pestaña{n !== 1 ? "s" : ""}
        </span>
      </span>
      <ArrowRight className="mod-arrow h-4 w-4" />
    </button>
  )
}

// Cada tarjeta lleva su propio color (distinto de sus vecinas) para que se
// distingan de un vistazo; el color del área queda para la cabecera.
function renderEntradas(entradas: EntradaMenu[], onSelect: (name: string) => void, groupKey: GroupKey) {
  return entradas.map((e) =>
    e.tipo === "hub" ? (
      <HubCard key={`hub:${e.hub.key}`} entrada={e} onSelect={onSelect} tint={colorDeEntrada(groupKey, { hubKey: e.hub.key })} />
    ) : (
      <ModuleCard key={e.modulo.name} module={e.modulo} onSelect={onSelect} tint={colorDeEntrada(groupKey, { modulo: e.modulo.name })} />
    ),
  )
}

export function ModulesView({ groupKey, onBack, onSelectModule }: ModulesViewProps) {
  const { selectedEmpresaId } = useAuth()
  const [valores, setValores] = useState<Record<string, ValorBsc>>({})
  const [loading, setLoading] = useState(true)

  // Mismo filtro de permisos que Inicio (module-cards) y el sidebar: si el
  // usuario no tiene acceso a un submódulo, no debe verlo listado aquí.
  const { loaded, allowedModules, isModuleVisible } = useModulePermissions()
  const group = filterGroupsByPermissions(isModuleVisible, loaded, allowedModules).find((g) => g.key === groupKey)

  // UNA sola lectura del BSC por empresa/grupo (+ refresco cada 3 min). Alimenta
  // los KPIs del área Y las tareas del día del submódulo, así siempre coinciden.
  useEffect(() => {
    const keys = AREA_KPIS[groupKey] ?? []
    // SST y SIG/Certificaciones son TRANSVERSALES a LIP → agregado LIP (scope null),
    // idéntico en todos los IDs. El resto reacciona a la empresa seleccionada.
    const transversal = groupKey === "sst" || groupKey === "certificaciones_lip"
    if (keys.length === 0 || (!selectedEmpresaId && !transversal)) {
      setValores({})
      setLoading(false)
      return
    }
    let cancel = false
    const load = async () => {
      try {
        const { desde, hasta } = monthRange()
        // Mismo alcance que las tiras de submódulo (area-kpis-rapidas): así la
        // portada y cada submódulo muestran EXACTAMENTE la misma cifra del BSC.
        const scope = transversal ? null : selectedEmpresaId
        const r = await getIndicadoresValores(scope, desde, hasta)
        if (!cancel && r.success) setValores(r.valores as Record<string, ValorBsc>)
      } catch {
        // silencioso
      } finally {
        if (!cancel) setLoading(false)
      }
    }
    setLoading(true)
    load()
    const interval = setInterval(load, 180000)
    return () => {
      cancel = true
      clearInterval(interval)
    }
  }, [groupKey, selectedEmpresaId])

  if (!group) return null

  const GroupIcon = group.icon
  const tint = TINT[groupKey] ?? TEAL
  // Entradas ya plegadas en hubs (un hub = una tarjeta con N pestañas).
  const entradasDirectas = group.modules ? plegarEnHubs(groupKey, group.modules) : []
  const entradasSub = (group.subgroups ?? []).map((sg) => ({ title: sg.title, entradas: plegarEnHubs(groupKey, sg.modules) }))
  const totalModules = entradasDirectas.length + entradasSub.reduce((acc, s) => acc + s.entradas.length, 0)

  return (
    <div className="space-y-5" style={{ "--tint": tint } as CSSProperties}>
      <style>{`
        .mod-card{ position:relative; display:flex; align-items:center; gap:11px; border-radius:14px;
          background:var(--card,#fff); border:1px solid #e7edf4; padding:11px 12px; text-align:left; cursor:pointer; overflow:hidden;
          transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
        /* Hairline de color que se enciende en hover */
        .mod-card::before{ content:""; position:absolute; inset:0; border-radius:14px; padding:1.2px; pointer-events:none;
          background:linear-gradient(135deg, color-mix(in srgb, var(--tint) 68%, transparent), transparent 60%);
          -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude;
          opacity:0; transition:opacity .16s; }
        .mod-card:hover{ transform:translateY(-2px); border-color:transparent;
          box-shadow:0 12px 26px color-mix(in srgb, var(--tint) 22%, transparent), 0 4px 10px rgba(20,42,68,.05); }
        .mod-card:hover::before{ opacity:1; }
        .mod-ico{ position:relative; z-index:1; width:34px; height:34px; flex:none; border-radius:10px;
          display:flex; align-items:center; justify-content:center;
          background:color-mix(in srgb, var(--tint) 14%, #fff); color:var(--tint);
          box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--tint) 20%, transparent);
          transition:transform .16s, background .16s, color .16s, box-shadow .16s; }
        .mod-card:hover .mod-ico{ transform:scale(1.06); color:#fff;
          background:linear-gradient(135deg, var(--tint), color-mix(in srgb, var(--tint) 62%, #000));
          box-shadow:0 6px 14px color-mix(in srgb, var(--tint) 40%, transparent); }
        .mod-name{ position:relative; z-index:1; flex:1; min-width:0; font-size:13px; font-weight:700;
          line-height:1.15; color:#132a44; letter-spacing:-.01em; }
        .mod-arrow{ position:relative; z-index:1; flex:none; color:var(--tint); opacity:0;
          transform:translateX(-5px); transition:opacity .16s, transform .16s; }
        .mod-card:hover .mod-arrow{ opacity:1; transform:none; }
        @media (prefers-reduced-motion:reduce){ .mod-card, .mod-card *{ transition:none !important; } .mod-card:hover{ transform:none } }
      `}</style>
      {/* Header compacto */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Volver"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl"
          style={{
            background: `color-mix(in srgb, ${tint} 15%, #fff)`,
            color: tint,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint} 22%, transparent)`,
          }}
        >
          <GroupIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight text-foreground sm:text-2xl">{group.title}</h1>
          <p className="text-[13px] text-muted-foreground">
            Selecciona una pantalla para continuar · {totalModules} pantalla{totalModules !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* KPIs del área. Para Pedidos/Despacho se muestran los KPIs de gestión del
          cliente alineados a objetivos (vencidos, por vencer, vehículos por cerrar)
          en vez de solo conteos básicos. El resto de grupos usa el set del BSC. */}
      {groupKey === "pedidos" ? (
        <div className="space-y-1">
          <div className="text-sm font-semibold text-foreground">Cumplimiento de entregas</div>
          <PedidosKpiStrip />
        </div>
      ) : groupKey === "despachos" ? (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-foreground">Operación y despacho del día</div>
          <DespachoKpiStrip />
          <VehiculosNoProcesadosCard />
        </div>
      ) : (
        // Indicadores del BSC del área (módulo madre), período = mes actual, con
        // enlaces "ver 3D". Los indicadores por SUBMÓDULO los pinta ModuleKpiHeader
        // al entrar a cada submódulo (no se duplican aquí en la portada).
        <AreaKpis groupKey={groupKey} valores={valores} loading={loading} />
      )}

      {/* Módulos directos (y hubs) */}
      {entradasDirectas.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {renderEntradas(entradasDirectas, onSelectModule, groupKey)}
        </div>
      )}

      {/* Subgrupos */}
      {entradasSub.map((sg) => (
        <div key={sg.title} className="space-y-2.5">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{sg.title}</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {renderEntradas(sg.entradas, onSelectModule, groupKey)}
          </div>
        </div>
      ))}
    </div>
  )
}
