"use client"

// PORTAL DE ÁREA (segundo nivel): rediseño 2026-09-30 ("clase mundial").
//
// Antes: indicadores grandes arriba y tarjetas mudas abajo. Ahora:
//  1. Encabezado con contexto vivo (planta, fecha y lo que requiere acción hoy).
//  2. Las PANTALLAS primero, como mosaicos que hablan: color propio, para qué
//     sirve, sus pestañas como chips para saltar directo, distintivo vivo con
//     pendientes ("6 vehículos sin cerrar") y estrella de favorito.
//  3. Indicadores del área en UNA línea de chips, al final.
// Los pendientes salen de `getPendientesPorPantalla` (mismas fuentes que
// Operación del día y los avisos de la barra); no hay lógica nueva de negocio.

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { filterGroupsByPermissions, type GroupKey, type Module } from "@/lib/dashboard-data"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { useNavegacionPersonal } from "@/hooks/use-navegacion-personal"
import { ArrowLeft, ArrowRight, Star } from "lucide-react"
import { TINT } from "@/components/module-cards"
import { AreaKpis, type ValorBsc } from "@/components/area-kpis"
import { PedidosKpiStrip } from "@/components/orders/pedidos-kpi-strip"
import { DespachoKpiStrip } from "@/components/orders/despacho-kpi-strip"
import { VehiculosNoProcesadosCard } from "@/components/vehiculos-no-procesados-card"
import { useAuth } from "@/components/auth-provider"
import { getIndicadoresValores } from "@/lib/sig-actions"
import { AREA_KPIS } from "@/lib/kpis-area"
import { colorDeEntrada, etiquetaDeGrupo, etiquetaDeTab, plegarEnHubs, type EntradaMenu } from "@/lib/navegacion"
import { APRENDIZAJE_POR_MODULO } from "@/lib/aprendizaje-content"
import { getPendientesPorPantalla, type PendientePantalla } from "@/lib/pendientes-pantalla-actions"

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

function fechaLarga(): string {
  const f = new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" })
  return f.charAt(0).toUpperCase() + f.slice(1)
}

/** Mosaico de una pantalla (hub) o de un módulo suelto. */
function Mosaico({
  entrada,
  groupKey,
  pendientes,
  esFavorito,
  onToggleFavorito,
  onSelect,
}: {
  entrada: EntradaMenu
  groupKey: GroupKey
  pendientes: PendientePantalla[]
  esFavorito: (m: string) => boolean
  onToggleFavorito: (m: string) => void
  onSelect: (name: string) => void
}) {
  const esHub = entrada.tipo === "hub"
  const titulo = esHub ? entrada.hub.title : entrada.modulo.label ?? entrada.modulo.name
  const Icon = esHub ? entrada.hub.icon : entrada.modulo.icon
  const tint = esHub ? colorDeEntrada(groupKey, { hubKey: entrada.hub.key }) : colorDeEntrada(groupKey, { modulo: entrada.modulo.name })
  const destino = esHub ? entrada.tabs[0]?.name : entrada.modulo.name
  const descripcion = esHub ? entrada.hub.descripcion : APRENDIZAJE_POR_MODULO[entrada.modulo.name]?.resumen
  const modulos = esHub ? entrada.tabs.map((t) => t.name) : [entrada.modulo.name]
  const pend = pendientes.filter((p) => modulos.includes(p.modulo))
  const fav = destino ? esFavorito(destino) : false
  const hayAlto = pend.some((p) => p.nivel === "alto")

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => destino && onSelect(destino)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && destino) {
          e.preventDefault()
          onSelect(destino)
        }
      }}
      className="mosaico group"
      style={{ "--tint": tint } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span className="mos-ico">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="mos-title">{titulo}</h3>
            {destino && (
              <button
                type="button"
                aria-label={fav ? "Quitar de favoritos" : "Marcar como favorito"}
                title={fav ? "Quitar de favoritos" : "Marcar como favorito"}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFavorito(destino)
                }}
                className={`mos-star ${fav ? "is-fav" : ""}`}
              >
                <Star className="h-4 w-4" />
              </button>
            )}
          </div>
          {descripcion && <p className="mos-desc">{descripcion}</p>}
        </div>
      </div>

      {esHub && entrada.tabs.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {entrada.tabs.map((t) => {
            const p = pend.find((x) => x.modulo === t.name)
            return (
              <button
                key={t.name}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(t.name)
                }}
                className={`mos-tab ${p ? (p.nivel === "alto" ? "is-alto" : "is-medio") : ""}`}
                title={p ? p.texto : `Abrir ${etiquetaDeTab(entrada.hub, t.name)}`}
              >
                {etiquetaDeTab(entrada.hub, t.name)}
                {p && <span className="mos-tab-n">{p.cantidad}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        {pend.length > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(pend[0].modulo)
            }}
            className={`mos-badge ${hayAlto ? "is-alto" : "is-medio"}`}
            title={pend.map((p) => p.texto).join(" · ")}
          >
            <span className="mos-dot" />
            {pend[0].texto}
            {pend.length > 1 && <span className="opacity-70">+{pend.length - 1}</span>}
          </button>
        ) : (
          <span className="text-[10.5px] text-muted-foreground/70">{esHub ? `${entrada.tabs.length} pestaña${entrada.tabs.length === 1 ? "" : "s"}` : "Sin pendientes"}</span>
        )}
        <span className="mos-enter">
          Abrir <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  )
}

export function ModulesView({ groupKey, onBack, onSelectModule }: ModulesViewProps) {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const [valores, setValores] = useState<Record<string, ValorBsc>>({})
  const [loading, setLoading] = useState(true)
  const [pendientes, setPendientes] = useState<PendientePantalla[]>([])
  const { esFavorito, toggleFavorito } = useNavegacionPersonal()

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

  // Pendientes vivos por pantalla (conteos ligeros, refresco cada 2 min).
  useEffect(() => {
    let cancel = false
    const load = () =>
      getPendientesPorPantalla(selectedEmpresaId ?? null)
        .then((r) => {
          if (!cancel) setPendientes(r.success && r.data ? r.data : [])
        })
        .catch(() => {})
    load()
    const interval = setInterval(load, 120000)
    return () => {
      cancel = true
      clearInterval(interval)
    }
  }, [selectedEmpresaId])

  const entradasDirectas = useMemo(() => (group?.modules ? plegarEnHubs(groupKey, group.modules) : []), [group, groupKey])
  const entradasSub = useMemo(
    () => (group?.subgroups ?? []).map((sg) => ({ title: sg.title, entradas: plegarEnHubs(groupKey, sg.modules) })),
    [group, groupKey],
  )

  if (!group) return null

  const GroupIcon = group.icon
  const tint = TINT[groupKey] ?? TEAL
  const totalPantallas = entradasDirectas.length + entradasSub.reduce((acc, s) => acc + s.entradas.length, 0)
  // Pendientes que pertenecen a módulos de ESTA área, para el pulso del encabezado.
  const modulosArea = new Set<string>([
    ...entradasDirectas.flatMap((e) => (e.tipo === "hub" ? e.tabs.map((t) => t.name) : [e.modulo.name])),
    ...entradasSub.flatMap((s) => s.entradas.flatMap((e) => (e.tipo === "hub" ? e.tabs.map((t) => t.name) : [e.modulo.name]))),
  ])
  const pulso = pendientes.filter((p) => modulosArea.has(p.modulo)).sort((a, b) => (a.nivel === b.nivel ? b.cantidad - a.cantidad : a.nivel === "alto" ? -1 : 1))

  const render = (entradas: EntradaMenu[]) =>
    entradas.map((e) => (
      <Mosaico
        key={e.tipo === "hub" ? `hub:${e.hub.key}` : e.modulo.name}
        entrada={e}
        groupKey={groupKey}
        pendientes={pendientes}
        esFavorito={esFavorito}
        onToggleFavorito={toggleFavorito}
        onSelect={onSelectModule}
      />
    ))

  return (
    <div className="space-y-5" style={{ "--tint": tint } as CSSProperties}>
      <style>{`
        .mosaico{ position:relative; display:flex; flex-direction:column; border-radius:16px; background:var(--card,#fff);
          border:1px solid #e7edf4; padding:14px 14px 12px; text-align:left; cursor:pointer; overflow:hidden; outline:none;
          transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
        .mosaico::before{ content:""; position:absolute; inset:0; border-radius:16px; padding:1.2px; pointer-events:none;
          background:linear-gradient(135deg, color-mix(in srgb, var(--tint) 68%, transparent), transparent 60%);
          -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude;
          opacity:0; transition:opacity .16s; }
        .mosaico:hover, .mosaico:focus-visible{ transform:translateY(-2px); border-color:transparent;
          box-shadow:0 12px 26px color-mix(in srgb, var(--tint) 22%, transparent), 0 4px 10px rgba(20,42,68,.05); }
        .mosaico:hover::before, .mosaico:focus-visible::before{ opacity:1; }
        .mos-ico{ width:40px; height:40px; flex:none; border-radius:12px; display:flex; align-items:center; justify-content:center;
          background:color-mix(in srgb, var(--tint) 14%, #fff); color:var(--tint);
          box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--tint) 22%, transparent); transition:transform .16s, background .16s, color .16s; }
        .mosaico:hover .mos-ico{ transform:scale(1.06); color:#fff; background:linear-gradient(135deg, var(--tint), color-mix(in srgb, var(--tint) 62%, #000)); }
        .mos-title{ font-size:14.5px; font-weight:800; line-height:1.15; color:#132a44; letter-spacing:-.01em; }
        .mos-desc{ margin-top:3px; font-size:11.5px; line-height:1.35; color:#5f7390; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .mos-star{ flex:none; color:#c9d3df; border-radius:8px; padding:2px; transition:color .15s, transform .15s; }
        .mos-star:hover{ color:#f59e0b; transform:scale(1.1); }
        .mos-star.is-fav{ color:#f59e0b; } .mos-star.is-fav svg{ fill:#f59e0b; }
        .mos-tab{ display:inline-flex; align-items:center; gap:4px; border-radius:999px; border:1px solid #e7edf4; background:#f6f9fc;
          padding:3px 9px; font-size:11px; font-weight:600; color:#3d5168; transition:background .15s, color .15s, border-color .15s; }
        .mos-tab:hover{ background:color-mix(in srgb, var(--tint) 14%, #fff); color:var(--tint); border-color:color-mix(in srgb, var(--tint) 35%, transparent); }
        .mos-tab.is-medio{ border-color:#fcd34d; background:#fffbeb; color:#92400e; }
        .mos-tab.is-alto{ border-color:#fca5a5; background:#fef2f2; color:#991b1b; }
        .mos-tab-n{ border-radius:999px; padding:0 5px; font-size:10px; font-weight:800; background:currentColor; }
        .mos-tab-n{ color:#fff; } .mos-tab.is-medio .mos-tab-n{ background:#d97706; } .mos-tab.is-alto .mos-tab-n{ background:#dc2626; }
        .mos-badge{ display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:3px 9px 3px 7px; font-size:11px; font-weight:700; }
        .mos-badge.is-medio{ background:#fffbeb; color:#92400e; border:1px solid #fcd34d; }
        .mos-badge.is-alto{ background:#fef2f2; color:#991b1b; border:1px solid #fca5a5; }
        .mos-dot{ width:7px; height:7px; border-radius:999px; background:currentColor; }
        .mos-enter{ display:inline-flex; align-items:center; gap:3px; font-size:11.5px; font-weight:800; color:var(--tint);
          opacity:0; transform:translateX(-6px); transition:opacity .16s, transform .16s; }
        .mosaico:hover .mos-enter, .mosaico:focus-visible .mos-enter{ opacity:1; transform:none; }
        @media (prefers-reduced-motion:reduce){ .mosaico, .mosaico *{ transition:none !important; } .mosaico:hover{ transform:none } }
      `}</style>

      {/* Encabezado con contexto vivo */}
      <div className="flex flex-wrap items-start gap-3">
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
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight text-foreground sm:text-2xl">{etiquetaDeGrupo(groupKey)}</h1>
          <p className="text-[13px] text-muted-foreground">
            {selectedEmpresaNombre ?? "Todo LIP"} · {fechaLarga()} · {totalPantallas} pantalla{totalPantallas !== 1 ? "s" : ""}
          </p>
          {pulso.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
              <span className="font-semibold text-foreground">Hoy requiere acción:</span>
              {pulso.slice(0, 4).map((p) => (
                <button
                  key={p.modulo}
                  type="button"
                  onClick={() => onSelectModule(p.modulo)}
                  className={`rounded-full border px-2 py-0.5 font-medium transition-colors ${
                    p.nivel === "alto" ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100" : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  {p.texto}
                </button>
              ))}
            </p>
          )}
        </div>
      </div>

      {/* Pantallas primero */}
      {entradasDirectas.length > 0 && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{render(entradasDirectas)}</div>}
      {entradasSub.map((sg) => (
        <div key={sg.title} className="space-y-2.5">
          {(entradasSub.length > 1 || entradasDirectas.length > 0) && (
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{sg.title}</h2>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{render(sg.entradas)}</div>
        </div>
      ))}

      {/* Indicadores del área, al final y compactos. Pedidos y Despacho conservan
          sus tiras de gestión del cliente (alineadas a objetivos). */}
      {groupKey === "pedidos" ? (
        <div className="space-y-1">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Cumplimiento de entregas</div>
          <PedidosKpiStrip />
        </div>
      ) : groupKey === "despachos" ? (
        <div className="space-y-3">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Operación y despacho del día</div>
          <DespachoKpiStrip />
          <VehiculosNoProcesadosCard />
        </div>
      ) : (
        <AreaKpis groupKey={groupKey} valores={valores} loading={loading} compacto />
      )}
    </div>
  )
}
