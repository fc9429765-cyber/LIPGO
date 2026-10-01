"use client"

import type { CSSProperties } from "react"
import { groups, filterGroupsByPermissions } from "@/lib/dashboard-data"
import type { GroupKey } from "@/lib/dashboard-data"
import { ArrowRight } from "lucide-react"
import { useModulePermissions } from "@/hooks/use-module-permissions"

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

function countModules(group: (typeof groups)[number]): number {
  const direct = group.modules?.length ?? 0
  const sub = group.subgroups?.reduce((acc, sg) => acc + sg.modules.length, 0) ?? 0
  return direct + sub
}

export function ModuleCards({ onSelectGroup }: ModuleCardsProps) {
  const { loaded, allowedModules, isModuleVisible } = useModulePermissions()
  const visibleGroups = filterGroupsByPermissions(isModuleVisible, loaded, allowedModules)

  return (
    <div>
      <style>{`
        .apps-grid{ --r:18px; }
        .app-tile{ position:relative; display:flex; flex-direction:column; gap:12px; border-radius:var(--r);
          background:var(--card,#fff); border:1px solid #e7edf4; padding:16px; text-align:left; cursor:pointer; overflow:hidden;
          transition:transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
        /* Halo de color que aflora en hover (esquina superior derecha) */
        .app-tile::after{ content:""; position:absolute; top:-40%; right:-30%; width:140px; height:140px; border-radius:50%;
          background:radial-gradient(closest-side, color-mix(in srgb, var(--tint) 28%, transparent), transparent);
          opacity:.35; transition:opacity .25s, transform .25s; pointer-events:none; }
        /* Hairline de color que se ilumina en hover */
        .app-tile::before{ content:""; position:absolute; inset:0; border-radius:var(--r); padding:1.3px; pointer-events:none;
          background:linear-gradient(135deg, color-mix(in srgb, var(--tint) 70%, transparent), transparent 62%);
          -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude;
          opacity:0; transition:opacity .2s; }
        .app-tile:hover{ transform:translateY(-3px); border-color:transparent;
          box-shadow:0 18px 38px color-mix(in srgb, var(--tint) 26%, transparent), 0 6px 14px rgba(20,42,68,.06); }
        .app-tile:hover::before{ opacity:1; }
        .app-tile:hover::after{ opacity:.6; transform:scale(1.15); }
        .app-ico{ position:relative; z-index:1; width:46px; height:46px; border-radius:14px; display:flex; align-items:center; justify-content:center;
          background:color-mix(in srgb, var(--tint) 14%, #fff); color:var(--tint); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--tint) 22%, transparent);
          transition:transform .2s, background .2s, color .2s, box-shadow .2s; }
        .app-tile:hover .app-ico{ transform:scale(1.06) rotate(-3deg); color:#fff;
          background:linear-gradient(135deg, var(--tint), color-mix(in srgb, var(--tint) 62%, #000));
          box-shadow:0 10px 22px color-mix(in srgb, var(--tint) 42%, transparent); }
        .app-name{ position:relative; z-index:1; font-size:15px; font-weight:800; line-height:1.15; color:#132a44; letter-spacing:-.01em; }
        .app-foot{ position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between; }
        .app-count{ font-size:11.5px; color:#7387a0; font-weight:500; }
        .app-enter{ display:inline-flex; align-items:center; gap:3px; font-size:11.5px; font-weight:800; color:var(--tint);
          opacity:0; transform:translateX(-6px); transition:opacity .2s, transform .2s; }
        .app-tile:hover .app-enter{ opacity:1; transform:none; }
        @media (prefers-reduced-motion:reduce){ .app-tile, .app-tile *{ transition:none !important; } .app-tile:hover{ transform:none } }
      `}</style>

      <div className="mb-3 flex items-baseline gap-2 sm:mb-5">
        <h2 className="text-sm font-extrabold tracking-tight text-foreground sm:text-lg">Aplicaciones</h2>
        <span className="text-xs text-muted-foreground">· elige un módulo para entrar</span>
      </div>

      <div className="apps-grid grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {visibleGroups.map((group) => {
          const Icon = group.icon
          const tint = TINT[group.key] ?? "#5b6b7f"
          const count = countModules(group)
          return (
            <button
              key={group.key}
              onClick={() => onSelectGroup(group.key as GroupKey)}
              className="app-tile"
              style={{ "--tint": tint } as CSSProperties}
            >
              <span className="app-ico">
                <Icon className="h-[22px] w-[22px]" />
              </span>
              <span className="app-name">{group.title}</span>
              <span className="app-foot">
                <span className="app-count">{count} módulos</span>
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
