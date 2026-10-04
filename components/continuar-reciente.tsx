"use client"

// "Continuar donde ibas" (Inicio): las últimas pantallas abiertas y las
// favoritas del usuario, como chips. Solo muestra lo que el usuario puede ver.

import { Clock, Star } from "lucide-react"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { useNavegacionPersonal } from "@/hooks/use-navegacion-personal"
import { colorDeEntrada, etiquetaDeGrupo, etiquetaDeModulo, grupoDeModulo, hubDe, moduloPorNombre } from "@/lib/navegacion"

export function ContinuarReciente({ onNavigate }: { onNavigate: (modulo: string) => void }) {
  const { isModuleVisible } = useModulePermissions()
  const { recientes, favoritos } = useNavegacionPersonal()

  const visible = (m: string) => grupoDeModulo(m) !== null && isModuleVisible(m)
  const rec = recientes.map((r) => r.modulo).filter(visible).slice(0, 4)
  const fav = favoritos.filter(visible).filter((m) => !rec.includes(m)).slice(0, 4)
  if (rec.length === 0 && fav.length === 0) return null

  const Chip = ({ m, icono }: { m: string; icono: "reciente" | "favorito" }) => {
    const gk = grupoDeModulo(m)!
    const hub = hubDe(gk, m)
    const mod = moduloPorNombre(m)
    const Icon = hub ? hub.icon : mod?.icon
    const tint = hub ? colorDeEntrada(gk, { hubKey: hub.key }) : colorDeEntrada(gk, { modulo: m })
    const titulo = hub ? `${hub.title} › ${etiquetaDeModulo(m)}` : etiquetaDeModulo(m)
    return (
      <button
        type="button"
        onClick={() => onNavigate(m)}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card py-1 pl-1.5 pr-3 text-xs shadow-sm transition-colors hover:bg-accent"
        title={`${etiquetaDeGrupo(gk)} › ${titulo}`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${tint} 14%, #fff)`, color: tint }}>
          {Icon ? <Icon className="h-3.5 w-3.5" /> : icono === "favorito" ? <Star className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
        </span>
        <span className="truncate font-medium text-foreground">{titulo}</span>
        <span className="hidden truncate text-[10.5px] text-muted-foreground sm:inline">· {etiquetaDeGrupo(gk)}</span>
        {icono === "favorito" && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
      </button>
    )
  }

  return (
    <div className="mb-4 sm:mb-5">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-bold tracking-tight text-foreground">Continuar donde ibas</h2>
        <span className="text-xs text-muted-foreground">· recientes y favoritos · Ctrl K para buscar</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {rec.map((m) => (
          <Chip key={`r:${m}`} m={m} icono="reciente" />
        ))}
        {fav.map((m) => (
          <Chip key={`f:${m}`} m={m} icono="favorito" />
        ))}
      </div>
    </div>
  )
}
