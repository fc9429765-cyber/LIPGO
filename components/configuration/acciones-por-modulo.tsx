"use client"

// PERMISOS POR MÓDULO en la pestaña Autoriza del perfil, con el MISMO formato que
// la lista «Con clave personal»: grupos del menú, y dentro de cada uno una fila
// por permiso con casilla, nombre, código y descripción, y «Todo / Nada» por grupo.
//
// Pedido de gerencia (2026-10-08): todo lo que un perfil puede hacer debe verse en
// Autoriza y con un solo formato. Por cada pantalla salen tres clases de fila:
//   · VER la pantalla (la llave del módulo; es la misma casilla de Módulos),
//   · cada ACCIÓN silenciosa (columna `<llave>__<verbo>`),
//   · cada acción CON CLAVE (toggle del proceso en el perfil; mismo estado que la
//     lista de abajo, así que marcarla aquí es marcarla allá).
//
// Mismo árbol del menú (PERMISSION_TREE): un módulo nuevo aparece aquí solo.

import { useMemo, useState } from "react"
import { KeyRound, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { PERMISSION_TREE, type PermItem } from "@/lib/permisos-arbol"

type Fila =
  | { tipo: "ver"; id: string; key: string; nombre: string; codigo: string; desc: string; llave: string }
  | { tipo: "accion"; id: string; key: string; nombre: string; codigo: string; desc: string; llave: string }
  | { tipo: "clave"; id: string; procesos: string[]; nombre: string; codigo: string; desc: string; llave: string }

type Grupo = { titulo: string; filas: Fila[] }

function filasDe(p: PermItem, seccion: string | null): Fila[] {
  const llave = p.key as string
  const out: Fila[] = [{ tipo: "ver", id: `ver:${llave}`, key: llave, nombre: `Ver ${p.label}`, codigo: llave, desc: seccion ? `${seccion} · abre la pantalla` : "abre la pantalla", llave }]
  for (const a of p.acciones) {
    const comparte = a.modulos.length > 1 ? ` · aplica también a ${a.modulos.filter((m) => m !== p.label).join(", ")}` : ""
    out.push({ tipo: "accion", id: `acc:${a.key}:${llave}`, key: a.key, nombre: `${a.label} · ${p.label}`, codigo: a.key, desc: `acción dentro de la pantalla${comparte}`, llave })
  }
  for (const c of p.conClave) {
    const codes = Array.isArray(c.proceso) ? [...c.proceso] : [c.proceso]
    out.push({ tipo: "clave", id: `cla:${codes.join("+")}:${llave}`, procesos: codes, nombre: `${c.label} · ${p.label}`, codigo: codes.join(" / "), desc: "con clave personal", llave })
  }
  return out
}

const GRUPOS: Grupo[] = PERMISSION_TREE.map((g) => {
  const filas: Fila[] = []
  const vistas = new Set<string>()
  for (const s of g.sections) {
    for (const p of s.permissions) {
      const llave = p.key as string
      if (vistas.has(llave)) continue
      vistas.add(llave)
      filas.push(...filasDe(p, s.title))
    }
  }
  return { titulo: g.title, filas }
}).filter((g) => g.filas.length > 0)

export function AccionesPorModulo({
  seleccion,
  procesos,
  procesosDisponibles,
  onToggle,
  onToggleVarios,
  onToggleProceso,
}: {
  /** Claves marcadas del perfil: llaves de módulo y claves de acción `<llave>__<verbo>`. */
  seleccion: string[]
  /** Códigos de proceso (con clave) que el perfil otorga. */
  procesos: string[]
  /** Códigos que existen en la base; los demás salen como «falta SQL 262». */
  procesosDisponibles: ReadonlySet<string>
  onToggle: (key: string, on: boolean) => void
  onToggleVarios: (keys: string[], on: boolean) => void
  onToggleProceso: (codigo: string, on: boolean) => void
}) {
  const [q, setQ] = useState("")
  const [abiertos, setAbiertos] = useState<string[]>([])
  const marcados = useMemo(() => new Set(seleccion), [seleccion])
  const procSet = useMemo(() => new Set(procesos), [procesos])

  const grupos = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return GRUPOS
    return GRUPOS.map((g) => ({
      ...g,
      filas: g.filas.filter((f) => f.nombre.toLowerCase().includes(t) || f.codigo.toLowerCase().includes(t) || g.titulo.toLowerCase().includes(t)),
    })).filter((g) => g.filas.length > 0)
  }, [q])

  const marcada = (f: Fila) => (f.tipo === "clave" ? f.procesos.some((c) => procSet.has(c)) : marcados.has(f.key))
  const total = useMemo(() => GRUPOS.reduce((n, g) => n + g.filas.length, 0), [])
  const totalMarcadas = useMemo(() => GRUPOS.reduce((n, g) => n + g.filas.filter(marcada).length, 0), [marcados, procSet]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFila = (f: Fila, on: boolean) => {
    if (f.tipo === "clave") {
      for (const c of f.procesos) if (procesosDisponibles.has(c)) onToggleProceso(c, on)
      return
    }
    if (f.tipo === "ver") {
      // Quitar la pantalla apaga sus acciones; ponerla, las enciende todas (nadie pierde nada).
      const acciones = GRUPOS.flatMap((g) => g.filas).filter((x): x is Extract<Fila, { tipo: "accion" }> => x.tipo === "accion" && x.llave === f.llave).map((x) => x.key)
      onToggleVarios([f.key, ...acciones], on)
      return
    }
    // Una acción exige ver la pantalla: marcarla enciende también la llave del módulo.
    if (on && !marcados.has(f.llave)) onToggleVarios([f.llave, f.key], true)
    else onToggle(f.key, on)
  }

  const todoGrupo = (g: Grupo, on: boolean) => {
    const keys = g.filas.filter((f): f is Exclude<Fila, { tipo: "clave" }> => f.tipo !== "clave").map((f) => f.key)
    onToggleVarios(keys, on)
    for (const f of g.filas) if (f.tipo === "clave") for (const c of f.procesos) if (procesosDisponibles.has(c)) onToggleProceso(c, on)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar módulo, acción o código…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {totalMarcadas} de {total} permisos
        </span>
      </div>

      {grupos.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Nada coincide con «{q}».</p>
      ) : (
        <Accordion type="multiple" value={q.trim() ? grupos.map((g) => g.titulo) : abiertos} onValueChange={setAbiertos} className="space-y-3">
          {grupos.map((g) => {
            const n = g.filas.filter(marcada).length
            return (
              <AccordionItem key={g.titulo} value={g.titulo} className="rounded-xl border border-border/60 bg-card px-2.5">
                <AccordionTrigger className="py-2.5 hover:no-underline">
                  <div className="flex flex-1 items-center justify-between pr-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.titulo}</p>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {n}/{g.filas.length}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-1.5 pb-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => todoGrupo(g, true)}>
                      Todo
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => todoGrupo(g, false)}>
                      Nada
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                    {g.filas.map((f) => {
                      const checked = marcada(f)
                      const pendiente = f.tipo === "clave" && !f.procesos.some((c) => procesosDisponibles.has(c))
                      const sinVer = f.tipo === "accion" && !marcados.has(f.llave)
                      return (
                        <label
                          key={f.id}
                          className={`flex items-start gap-2 rounded p-1.5 text-sm cursor-pointer hover:bg-accent/50 ${checked ? "bg-primary/5" : ""} ${pendiente ? "opacity-60" : ""}`}
                          title={pendiente ? "Todavía no existe en la base: corre scripts/262_permisos_acciones.sql" : sinVer ? "Marcarla también enciende «Ver» de la pantalla" : undefined}
                        >
                          <Checkbox className="mt-0.5" checked={checked} disabled={pendiente} onCheckedChange={(c) => toggleFila(f, !!c)} />
                          <span className="min-w-0">
                            <span className={`block leading-tight ${checked ? "font-medium" : ""}`}>
                              {f.tipo === "clave" && <KeyRound className="mr-1 inline h-3 w-3 text-amber-700" />}
                              {f.nombre}
                              {pendiente && <span className="ml-1.5 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase text-amber-800">falta SQL 262</span>}
                            </span>
                            <span className="block text-[10px] text-muted-foreground">
                              <span className="font-mono">{f.codigo}</span> · {f.desc}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </div>
  )
}
