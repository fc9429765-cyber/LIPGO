"use client"

// CHIPS DE ACCIONES de un módulo en las pantallas de permisos (Perfiles y Usuarios).
//
// Debajo de la casilla "ver" de cada módulo, un chip por verbo del catálogo
// (lib/politicas-modulos.ts): los silenciosos se marcan y desmarcan (son
// columnas `<llave>__<verbo>` de permisos_usuarios); los "con clave" salen
// solo de lectura con un candado, porque esos se otorgan en la pestaña
// Autoriza como procesos del perfil.
//
// Los chips se deshabilitan si el módulo no está marcado: una acción sin su
// módulo no tiene sentido (el servidor exige las dos cosas).

import { KeyRound } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { accionesPorClave, procesosPorClave } from "@/lib/politicas-modulos"
import { cn } from "@/lib/utils"

const ACCIONES = accionesPorClave()
const PROCESOS = procesosPorClave()

/** Claves de acción (columnas) de una llave de módulo. */
export function accionesDeLlave(llave: string): string[] {
  return (ACCIONES.get(llave) ?? []).map((a) => a.key)
}

export function ChipsAcciones({
  llave,
  marcados,
  verActivo,
  onToggle,
  compacto = false,
}: {
  llave: string
  /** Claves (módulos y acciones) hoy marcadas. */
  marcados: ReadonlySet<string>
  /** Si el módulo (`ver`) está marcado. Sin él, los chips se deshabilitan. */
  verActivo: boolean
  onToggle: (key: string, on: boolean) => void
  compacto?: boolean
}) {
  const acciones = ACCIONES.get(llave) ?? []
  const procesos = PROCESOS.get(llave) ?? []
  if (!acciones.length && !procesos.length) return null

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("flex flex-wrap gap-1", compacto ? "pl-6" : "pl-6 pb-1")}>
        {acciones.map((a) => {
          const on = marcados.has(a.key)
          return (
            <Tooltip key={a.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={!verActivo}
                  onClick={() => onToggle(a.key, !on)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full border px-1.5 py-px text-[10px] leading-4 transition-colors",
                    on && verActivo
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/70 bg-background text-muted-foreground hover:bg-accent/60",
                    !verActivo && "cursor-not-allowed opacity-40",
                  )}
                >
                  {a.label}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-[11px]">
                <p>
                  <span className="font-mono">{a.key}</span>
                </p>
                <p className="text-muted-foreground">Aplica a: {a.modulos.join(", ")}</p>
              </TooltipContent>
            </Tooltip>
          )
        })}
        {procesos.map((p) => (
          <Tooltip key={`${llave}:${p.verbo}`}>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-0.5 rounded-full border border-amber-300/70 bg-amber-50 px-1.5 py-px text-[10px] leading-4 text-amber-800">
                <KeyRound className="h-2.5 w-2.5" /> {p.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[280px] text-[11px]">
              <p>Con clave personal. Se otorga en la pestaña Autoriza como proceso del perfil:</p>
              <p className="font-mono">{Array.isArray(p.proceso) ? p.proceso.join(" · ") : p.proceso}</p>
              <p className="text-muted-foreground">Aplica a: {p.modulos.join(", ")}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}
