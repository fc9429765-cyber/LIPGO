"use client"

// ACCIONES POR MÓDULO, en la pestaña Autoriza del perfil.
//
// Pedido de gerencia (2026-10-08): todo lo que un perfil puede HACER debe
// verse en un solo sitio, Autoriza. Antes los chips de acción estaban debajo
// de cada módulo en la pestaña Módulos y nadie los encontraba. Ahora Módulos
// dice qué pantallas se VEN y Autoriza dice qué se puede hacer dentro: las
// acciones silenciosas (chips que se marcan) y las que piden clave personal
// (los procesos, abajo).
//
// Mismo árbol del menú (PERMISSION_TREE) para que un módulo nuevo aparezca
// solo; se omiten las pantallas de solo lectura (sin acciones declaradas).

import { useMemo, useState } from "react"
import { KeyRound, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ChipsAcciones, accionesDeLlave } from "@/components/configuration/chips-acciones"
import { PERMISSION_TREE, type PermGroup, type PermItem } from "@/lib/permisos-arbol"
import { esClaveAccion } from "@/lib/permisos-verbos"

function tieneAcciones(p: PermItem): boolean {
  return p.acciones.length > 0 || p.conClave.length > 0
}

/** Solo los módulos con acciones, agrupados como el menú. */
const ARBOL_ACCIONES: PermGroup[] = PERMISSION_TREE.map((g) => ({
  ...g,
  sections: g.sections
    .map((s) => ({ ...s, permissions: s.permissions.filter(tieneAcciones) }))
    .filter((s) => s.permissions.length > 0),
})).filter((g) => g.sections.length > 0)

export function AccionesPorModulo({
  seleccion,
  procesos,
  onToggle,
  onToggleVarios,
}: {
  /** Claves marcadas del perfil: llaves de módulo y claves de acción `<llave>__<verbo>`. */
  seleccion: string[]
  /** Códigos de proceso (con clave) que el perfil ya otorga; marca los chips con candado. */
  procesos: string[]
  onToggle: (key: string, on: boolean) => void
  onToggleVarios: (keys: string[], on: boolean) => void
}) {
  const [q, setQ] = useState("")
  const [abiertos, setAbiertos] = useState<string[]>([])
  const marcados = useMemo(() => new Set(seleccion), [seleccion])
  const procesosSet = useMemo(() => new Set(procesos), [procesos])

  const arbol = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return ARBOL_ACCIONES
    return ARBOL_ACCIONES.map((g) => ({
      ...g,
      sections: g.sections
        .map((s) => ({
          ...s,
          permissions: s.permissions.filter(
            (p) =>
              p.label.toLowerCase().includes(t) ||
              g.title.toLowerCase().includes(t) ||
              (s.title ?? "").toLowerCase().includes(t) ||
              p.acciones.some((a) => a.label.toLowerCase().includes(t)) ||
              p.conClave.some((c) => c.label.toLowerCase().includes(t)),
          ),
        }))
        .filter((s) => s.permissions.length > 0),
    })).filter((g) => g.sections.length > 0)
  }, [q])

  const totalAcciones = useMemo(() => ARBOL_ACCIONES.flatMap((g) => g.sections.flatMap((s) => s.permissions.flatMap((p) => p.acciones))).length, [])
  const accionesMarcadas = seleccion.filter((k) => esClaveAccion(k)).length

  const accionesDeGrupo = (g: PermGroup) => g.sections.flatMap((s) => s.permissions.flatMap((p) => p.acciones.map((a) => a.key)))
  const modulosDeGrupo = (g: PermGroup) => g.sections.flatMap((s) => s.permissions.map((p) => p.key as string))

  // Marcar un módulo desde aquí enciende todas sus acciones; quitarlo las apaga.
  const toggleModulo = (k: string, on: boolean) => onToggleVarios([k, ...accionesDeLlave(k)], on)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar módulo o acción…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {accionesMarcadas} de {totalAcciones} acciones
        </span>
      </div>

      {arbol.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Nada coincide con «{q}».</p>
      ) : (
        <Accordion type="multiple" value={q.trim() ? arbol.map((g) => g.title) : abiertos} onValueChange={setAbiertos} className="space-y-2">
          {arbol.map((g) => {
            const accs = accionesDeGrupo(g)
            const activas = accs.filter((k) => marcados.has(k)).length
            return (
              <AccordionItem
                key={g.title}
                value={g.title}
                className="rounded-xl border border-border/60 bg-card px-3 transition-colors data-[state=open]:border-primary/30 data-[state=open]:shadow-sm"
              >
                <AccordionTrigger className="py-3 hover:no-underline">
                  <div className="flex flex-1 items-center gap-2 pr-2">
                    <span className="text-sm font-semibold">{g.title}</span>
                    <Badge
                      variant="outline"
                      className={`ml-auto h-5 px-1.5 text-[11px] tabular-nums ${
                        activas === accs.length && accs.length > 0
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : activas > 0
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : ""
                      }`}
                    >
                      {activas}/{accs.length} acciones
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-3">
                  <div className="flex gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onToggleVarios([...modulosDeGrupo(g), ...accs], true)}>
                      Todo el grupo
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onToggleVarios(accs, false)}>
                      Sin acciones
                    </Button>
                  </div>
                  {g.sections.map((s, i) => (
                    <div key={s.title ?? `s${i}`} className="space-y-1">
                      {s.title && <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.title}</p>}
                      <div className="space-y-1 border-l-2 border-border pl-3">
                        {s.permissions.map((p) => {
                          const k = p.key as string
                          const ve = marcados.has(k)
                          const conClaveOtorgados = p.conClave.filter((c) =>
                            (Array.isArray(c.proceso) ? c.proceso : [c.proceso]).some((code) => procesosSet.has(code)),
                          ).length
                          return (
                            <div key={k} className={`rounded-md p-1.5 ${ve ? "bg-primary/5" : "hover:bg-accent/40"}`}>
                              <div className="flex items-center gap-2">
                                <Checkbox checked={ve} onCheckedChange={(c) => toggleModulo(k, !!c)} title="Ver la pantalla (es la casilla de Módulos)" />
                                <span className={`truncate text-sm ${ve ? "font-medium" : "text-muted-foreground"}`}>{p.label}</span>
                                {p.conClave.length > 0 && (
                                  <span
                                    className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-amber-800"
                                    title="Acciones con clave personal: se otorgan abajo, en «Con clave personal»"
                                  >
                                    <KeyRound className="h-3 w-3" /> {conClaveOtorgados}/{p.conClave.length}
                                  </span>
                                )}
                              </div>
                              <ChipsAcciones llave={k} marcados={marcados} verActivo={ve} onToggle={onToggle} compacto />
                              {!ve && (
                                <p className="pl-6 text-[10px] text-muted-foreground">Marca la casilla para que este perfil vea la pantalla y pueda tener acciones en ella.</p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </div>
  )
}
