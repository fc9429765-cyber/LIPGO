"use client"

// MOSAICO DE ÁREAS del Inicio. Cada área ("app") con su color de dominio, cuántas
// pantallas tiene y, en vivo, cuántos pendientes hay en ella hoy (misma fuente
// que los portales y la barra de pestañas: getPendientesPorPantalla). Así el
// Inicio dice dónde hay trabajo, no solo cuántos módulos existen.

import { useEffect, useState, type CSSProperties } from "react"
import { groups, filterGroupsByPermissions } from "@/lib/dashboard-data"
import type { GroupKey } from "@/lib/dashboard-data"
import { ArrowRight } from "lucide-react"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { useAuth } from "@/components/auth-provider"
import { etiquetaDeGrupo, grupoDeModulo, plegarEnHubs } from "@/lib/navegacion"
import { getPendientesPorPantalla, type PendientePantalla } from "@/lib/pendientes-pantalla-actions"

interface ModuleCardsProps {
  onSelectGroup: (group: GroupKey) => void
  onSelectModule?: (module: string) => void
}

// Color de dominio por grupo (mismos tonos que el sidebar). Cada "app" tiene
// identidad visual propia; ese color es el ACENTO vivo del tile.
export const TINT: Record<string, string> = {
  integral: "#5b6b7f",
  pedidos: "#4f63c4",
  despachos: "#1f8fb0",
  inventarios: "#0e9c9c",
  produccion: "#c56a2a",
  lip: "#7b57c9",
  financiera: "#2f9b64",
  rrhh: "#c65893",
  compensacion: "#c9a227",
  certificaciones_lip: "#c8492f",
  sst: "#d84a3e",
  configuracion: "#6b7683",
}

/** Pantallas (hubs + módulos sueltos) visibles del área. */
function countPantallas(group: (typeof groups)[number]): number {
  const directas = group.modules ? plegarEnHubs(group.key, group.modules).length : 0
  const sub = group.subgroups?.reduce((acc, sg) => acc + plegarEnHubs(group.key, sg.modules).length, 0) ?? 0
  return directas + sub
}

export function ModuleCards({ onSelectGroup, onSelectModule }: ModuleCardsProps) {
  const { loaded, allowedModules, isModuleVisible } = useModulePermissions()
  const { selectedEmpresaId } = useAuth()
  const visibleGroups = filterGroupsByPermissions(isModuleVisible, loaded, allowedModules)

  // Pendientes vivos por área (conteos ligeros, refresco cada 2 min).
  const [pendientes, setPendientes] = useState<PendientePantalla[]>([])
  useEffect(() => {
    let cancel = false
    const load = () =>
      getPendientesPorPantalla(selectedEmpresaId ?? null)
        .then((r) => {
          if (!cancel) setPendientes(r.success && r.data ? r.data : [])
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 120000)
    return () => {
      cancel = true
      clearInterval(id)
    }
  }, [selectedEmpresaId])

  const pendPorGrupo = new Map<string, PendientePantalla[]>()
  for (const p of pendientes) {
    if (!isModuleVisible(p.modulo)) continue
    const gk = grupoDeModulo(p.modulo)
    if (!gk) continue
    if (!pendPorGrupo.has(gk)) pendPorGrupo.set(gk, [])
    pendPorGrupo.get(gk)!.push(p)
  }

  return (
    <div>
      <style>{`
        .apps-grid{ --r:16px; }
        .app-tile{ position:relative; display:flex; flex-direction:column; gap:12px; border-radius:var(--r);
          background:var(--card,#fff); border:1px solid var(--border,#E3E8EE); padding:16px; text-align:left; cursor:pointer; overflow:hidden;
          transition:transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
        /* Pulido profesional (2026-10-02): sin halos ni elevación; el hover es un
           borde del color del área y el ícono se rellena. */
        .app-tile:hover, .app-tile:focus-visible{ border-color:color-mix(in srgb, var(--tint) 55%, transparent); outline:none;
          box-shadow:0 1px 2px rgba(11,18,32,.04), 0 0 0 1px color-mix(in srgb, var(--tint) 25%, transparent); }
        .app-ico{ position:relative; z-index:1; width:44px; height:44px; border-radius:13px; display:flex; align-items:center; justify-content:center;
          background:color-mix(in srgb, var(--tint) 14%, #fff); color:var(--tint);
          transition:background .15s, color .15s; }
        .app-tile:hover .app-ico{ color:#fff; background:var(--tint); }
        .app-name{ position:relative; z-index:1; font-size:15px; font-weight:700; line-height:1.15; color:var(--foreground,#0B1220); letter-spacing:-.01em; }
        .app-foot{ position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:22px; }
        .app-count{ font-size:11.5px; color:var(--muted-foreground,#5B6B7F); font-weight:500; font-variant-numeric:tabular-nums; }
        .app-pend{ display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:2px 9px 2px 7px; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; }
        .app-pend.is-medio{ background:#FFF7ED; color:#9A3412; border:1px solid #FED7AA; }
        .app-pend.is-alto{ background:#FEF2F2; color:#991B1B; border:1px solid #FECACA; }
        .app-pend i{ width:7px; height:7px; border-radius:999px; background:currentColor; }
        .app-enter{ display:inline-flex; align-items:center; gap:3px; font-size:11.5px; font-weight:700; color:var(--tint);
          opacity:0; transform:translateX(-6px); transition:opacity .2s, transform .2s; }
        .app-tile:hover .app-enter, .app-tile:focus-visible .app-enter{ opacity:1; transform:none; }
        @media (prefers-reduced-motion:reduce){ .app-tile, .app-tile *{ transition:none !important; } .app-tile:hover{ transform:none } }
      `}</style>

      <div className="mb-3 flex items-baseline gap-2 sm:mb-4">
        <h2 className="text-sm font-bold tracking-tight text-foreground sm:text-lg">Áreas</h2>
        <span className="text-xs text-muted-foreground">· elige una para entrar · el punto marca dónde hay pendientes hoy</span>
      </div>

      <div className="apps-grid grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {visibleGroups.map((group) => {
          const Icon = group.icon
          const tint = TINT[group.key] ?? "#5b6b7f"
          const pantallas = countPantallas(group)
          const pend = pendPorGrupo.get(group.key) ?? []
          const total = pend.reduce((s, p) => s + p.cantidad, 0)
          const alto = pend.some((p) => p.nivel === "alto")
          const primero = pend.sort((a, b) => (a.nivel === b.nivel ? b.cantidad - a.cantidad : a.nivel === "alto" ? -1 : 1))[0]
          return (
            <button
              key={group.key}
              onClick={() => onSelectGroup(group.key as GroupKey)}
              className="app-tile"
              style={{ "--tint": tint } as CSSProperties}
              title={pend.length ? pend.map((p) => p.texto).join(" · ") : undefined}
            >
              <span className="app-ico">
                <Icon className="h-[22px] w-[22px]" />
              </span>
              <span className="app-name">{etiquetaDeGrupo(group.key)}</span>
              <span className="app-foot">
                {pend.length > 0 && primero ? (
                  <span
                    role="link"
                    className={`app-pend ${alto ? "is-alto" : "is-medio"}`}
                    onClick={(e) => {
                      if (!onSelectModule) return
                      e.stopPropagation()
                      onSelectModule(primero.modulo)
                    }}
                  >
                    <i aria-hidden /> {total} pendiente{total === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="app-count">{pantallas} pantalla{pantallas === 1 ? "" : "s"}</span>
                )}
                <span className="app-enter">
                  Entrar <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
