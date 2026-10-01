"use client"

// BUSCADOR GLOBAL "Buscar o ir a…" (Ctrl/⌘+K) — paleta de comandos.
//
// Encuentra áreas, pantallas (hubs), pestañas y módulos por nombre nuevo,
// nombre viejo (alias), y por LO QUE HACE cada módulo (texto de la guía de
// Aprendizaje: resumen, "puedes", funcionalidades). Búsqueda sin tildes ni
// mayúsculas, por palabras sueltas, con puntaje. Solo muestra lo que el
// usuario tiene permitido (mismo filtro que la barra lateral). Secciones:
// Recientes · Favoritos · Módulos · Acciones. Se abre con Ctrl/⌘+K o con el
// evento `lipgo:open-palette` (botón de la barra superior, cajón móvil).

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Command as CommandPrimitive } from "cmdk"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useAuth } from "@/components/auth-provider"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { useNavegacionPersonal } from "@/hooks/use-navegacion-personal"
import { filterGroupsByPermissions, type GroupKey, type Module } from "@/lib/dashboard-data"
import { ALIAS_MODULO, TINT_GRUPO, colorDeEntrada, etiquetaDeGrupo, etiquetaDeTab, grupoDeModulo, hubDe, plegarEnHubs, type Hub } from "@/lib/navegacion"
import { APRENDIZAJE_POR_MODULO } from "@/lib/aprendizaje-content"
import { buscarRegistros, type RegistroEncontrado, type TipoRegistro } from "@/lib/buscar-registros-actions"
import { Building2, Clock, Home, LogOut, Sparkles, Star, StarOff, Truck, UserRound, type LucideIcon } from "lucide-react"

/** Módulo hoja que abre cada tipo de registro; solo se busca si el usuario lo ve. */
const MODULO_POR_TIPO: Record<TipoRegistro, string> = { orden: "Gestión de Ordenes", persona: "Head Count" }
const ESTILO_REGISTRO: Record<TipoRegistro, { icon: LucideIcon; color: string; destino: string }> = {
  orden: { icon: Truck, color: "#2563eb", destino: "Gestión de Órdenes" },
  persona: { icon: UserRound, color: "#7c3aed", destino: "Head Count" },
}

const normalizar = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

interface ItemBusqueda {
  id: string
  tipo: "modulo" | "hub" | "grupo" | "accion"
  titulo: string
  subtitulo: string
  icon: LucideIcon
  color: string
  /** Claves fuertes normalizadas (nombre, etiqueta, alias, pestañas). */
  claves: string[]
  /** Todo el texto buscable normalizado. */
  texto: string
  /** Módulo hoja asociado (para recientes/favoritos). */
  modulo?: string
  run: () => void
}

interface BuscadorGlobalProps {
  onNavigate: (modulo: string) => void
  onOpenGroup: (key: string) => void
  onInicio: () => void
  moduloActual: string | null
  /** true si el botón flotante de LIPbot está montado (fuera de Inicio). */
  lipbotMontado: boolean
}

export function BuscadorGlobal({ onNavigate, onOpenGroup, onInicio, moduloActual, lipbotMontado }: BuscadorGlobalProps) {
  const router = useRouter()
  const { accessibleEmpresas, selectedEmpresaId, selectedEmpresaNombre, setSelectedEmpresaId, signOut } = useAuth()
  const { loaded, allowedModules, isModuleVisible } = useModulePermissions()
  const { favoritos, recientes, esFavorito, toggleFavorito } = useNavegacionPersonal()
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState("")
  // Registros (órdenes por número/placa, personas por nombre/cédula) del
  // proyecto activo: se consultan al servidor con retardo de 250 ms.
  const [registros, setRegistros] = useState<RegistroEncontrado[]>([])
  const [buscandoRegistros, setBuscandoRegistros] = useState(false)

  // Abrir/cerrar: Ctrl/⌘+K y evento global.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setAbierto((o) => !o)
      }
    }
    const onAbrir = () => setAbierto(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener("lipgo:open-palette", onAbrir)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("lipgo:open-palette", onAbrir)
    }
  }, [])
  useEffect(() => {
    if (!abierto) setQ("")
  }, [abierto])

  const cerrarY = useCallback((fn: () => void) => {
    setAbierto(false)
    // Deja que el diálogo cierre antes de cambiar de pantalla (evita foco atrapado).
    setTimeout(fn, 0)
  }, [])

  // ---- Índice: áreas, hubs, pestañas y módulos visibles --------------------
  const indice = useMemo<ItemBusqueda[]>(() => {
    const visibles = filterGroupsByPermissions(isModuleVisible, loaded, allowedModules)
    const aliasPorDestino = new Map<string, string[]>()
    for (const [viejo, nuevo] of Object.entries(ALIAS_MODULO)) {
      if (!aliasPorDestino.has(nuevo)) aliasPorDestino.set(nuevo, [])
      aliasPorDestino.get(nuevo)!.push(viejo)
    }
    const items: ItemBusqueda[] = []
    const textoGuia = (name: string) => {
      const g = APRENDIZAJE_POR_MODULO[name]
      if (!g) return ""
      return [g.resumen, g.proposito, ...(g.puedes ?? []), ...(g.funcionalidades ?? []).map((f) => f.nombre)].join(" ")
    }
    const itemModulo = (gk: GroupKey, m: Module, hub: Hub | null, subgrupo?: string): ItemBusqueda => {
      const etiqueta = m.label ?? m.name
      const claves = [m.name, etiqueta, ...(aliasPorDestino.get(m.name) ?? []), ...(hub ? [etiquetaDeTab(hub, m.name)] : [])].map(normalizar)
      const sub = hub ? `${etiquetaDeGrupo(gk)} › ${hub.title}` : `${etiquetaDeGrupo(gk)}${subgrupo ? ` · ${subgrupo}` : ""}`
      return {
        id: `mod:${gk}:${m.name}`,
        tipo: "modulo",
        titulo: hub ? etiquetaDeTab(hub, m.name) : etiqueta,
        subtitulo: sub,
        icon: m.icon,
        color: hub ? colorDeEntrada(gk, { hubKey: hub.key }) : colorDeEntrada(gk, { modulo: m.name }),
        claves,
        texto: normalizar([...claves, sub, textoGuia(m.name)].join(" ")),
        modulo: m.name,
        run: () => onNavigate(m.name),
      }
    }
    for (const g of visibles) {
      const etiquetaG = etiquetaDeGrupo(g.key)
      items.push({
        id: `grp:${g.key}`,
        tipo: "grupo",
        titulo: etiquetaG,
        subtitulo: "Área",
        icon: g.icon,
        color: TINT_GRUPO[g.key] ?? "#5b6b7f",
        claves: [normalizar(etiquetaG), normalizar(g.title)],
        texto: normalizar(`${etiquetaG} ${g.title} area`),
        run: () => onOpenGroup(g.key),
      })
      const listas: { modules: Module[]; subgrupo?: string }[] = [
        ...(g.modules ? [{ modules: g.modules }] : []),
        ...(g.subgroups ?? []).map((sg) => ({ modules: sg.modules, subgrupo: sg.title })),
      ]
      for (const lista of listas) {
        for (const e of plegarEnHubs(g.key, lista.modules)) {
          if (e.tipo === "hub") {
            const tabs = e.tabs.map((t) => etiquetaDeTab(e.hub, t.name))
            const claves = [e.hub.title, ...tabs].map(normalizar)
            items.push({
              id: `hub:${g.key}:${e.hub.key}`,
              tipo: "hub",
              titulo: e.hub.title,
              subtitulo: `${etiquetaG} · ${tabs.join(" · ")}`,
              icon: e.hub.icon,
              color: colorDeEntrada(g.key, { hubKey: e.hub.key }),
              claves,
              texto: normalizar([...claves, etiquetaG, e.hub.descripcion ?? "", ...e.tabs.map((t) => textoGuia(t.name))].join(" ")),
              modulo: e.tabs[0]?.name,
              run: () => e.tabs[0] && onNavigate(e.tabs[0].name),
            })
            for (const t of e.tabs) items.push(itemModulo(g.key, t, e.hub))
          } else {
            items.push(itemModulo(g.key, e.modulo, null, lista.subgrupo))
          }
        }
      }
    }
    return items
  }, [loaded, allowedModules, isModuleVisible, onNavigate, onOpenGroup])

  // ---- Acciones ------------------------------------------------------------
  const acciones = useMemo<ItemBusqueda[]>(() => {
    const out: ItemBusqueda[] = []
    out.push({ id: "act:inicio", tipo: "accion", titulo: "Ir a Inicio", subtitulo: "Acción", icon: Home, color: "#5b6b7f", claves: ["inicio", "home"], texto: "ir a inicio home portada", run: onInicio })
    if (accessibleEmpresas.length > 1) {
      for (const e of accessibleEmpresas) {
        if (e.id === selectedEmpresaId) continue
        const t = `Cambiar a ${e.id} · ${e.nombre}`
        out.push({ id: `act:emp:${e.id}`, tipo: "accion", titulo: t, subtitulo: "Proyecto", icon: Building2, color: "#2f9b64", claves: [normalizar(t), normalizar(e.nombre), `id${e.id}`], texto: normalizar(`cambiar proyecto empresa ${e.id} ${e.nombre}`), run: () => setSelectedEmpresaId(e.id) })
      }
    }
    if (moduloActual && grupoDeModulo(moduloActual)) {
      const fav = esFavorito(moduloActual)
      const t = fav ? `Quitar de favoritos: ${moduloActual}` : `Marcar favorito: ${moduloActual}`
      out.push({ id: "act:fav", tipo: "accion", titulo: t, subtitulo: "Acción", icon: fav ? StarOff : Star, color: "#c9a227", claves: ["favorito", "favoritos"], texto: normalizar(`favorito ${moduloActual}`), run: () => toggleFavorito(moduloActual) })
    }
    out.push({
      id: "act:salir",
      tipo: "accion",
      titulo: "Cerrar sesión",
      subtitulo: "Acción",
      icon: LogOut,
      color: "#d1443f",
      claves: ["cerrar sesion", "salir", "logout"],
      texto: "cerrar sesion salir logout",
      run: () => {
        signOut().then(() => router.push("/login"))
      },
    })
    return out
  }, [accessibleEmpresas, selectedEmpresaId, setSelectedEmpresaId, moduloActual, esFavorito, toggleFavorito, signOut, router, onInicio])

  // ---- Puntaje -------------------------------------------------------------
  const nq = normalizar(q).trim()
  const tokens = nq.split(/\s+/).filter(Boolean)
  const favSet = useMemo(() => new Set(favoritos), [favoritos])
  const recSet = useMemo(() => new Set(recientes.map((r) => r.modulo)), [recientes])

  const puntuar = (it: ItemBusqueda): number => {
    if (tokens.length === 0) return 0
    let total = 0
    for (const t of tokens) {
      if (!it.texto.includes(t)) return 0 // todos los tokens deben estar
      let s = 10
      if (it.claves.some((c) => c.startsWith(t))) s = 100
      else if (it.claves.some((c) => c.split(/[\s/·()-]+/).some((w) => w.startsWith(t)))) s = 80
      else if (normalizar(it.titulo).includes(t)) s = 50
      else if (normalizar(it.subtitulo).includes(t)) s = 25
      total += s
    }
    if (it.modulo && favSet.has(it.modulo)) total += 15
    if (it.modulo && recSet.has(it.modulo)) total += 10
    if (it.tipo === "hub") total += 5
    return total
  }

  const resultados = useMemo(() => {
    if (tokens.length === 0) return { modulos: [] as ItemBusqueda[], acciones: acciones.slice(0, 6) }
    const mods = indice.map((it) => ({ it, s: puntuar(it) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.it)
    const acts = acciones.map((it) => ({ it, s: puntuar(it) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it)
    return { modulos: mods, acciones: acts }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nq, indice, acciones, favSet, recSet])

  const porModulo = useMemo(() => {
    const m = new Map<string, ItemBusqueda>()
    for (const it of indice) if (it.tipo === "modulo" && it.modulo && !m.has(it.modulo)) m.set(it.modulo, it)
    return m
  }, [indice])

  // ---- Registros: órdenes y personas ---------------------------------------
  // Solo los tipos cuyo módulo destino puede ver el usuario; se dispara con 3+
  // caracteres (o 2+ dígitos: número de orden) para no consultar por cada tecla.
  const tiposVisibles = useMemo<TipoRegistro[]>(
    () => (loaded ? (Object.keys(MODULO_POR_TIPO) as TipoRegistro[]).filter((t) => isModuleVisible(MODULO_POR_TIPO[t])) : []),
    [loaded, isModuleVisible],
  )
  // Clave de texto: `isModuleVisible` cambia de identidad en cada render y un
  // arreglo nuevo en las dependencias relanzaría la consulta en bucle.
  const tiposClave = tiposVisibles.join(",")
  const buscaRegistros = abierto && !!selectedEmpresaId && tiposClave.length > 0 && (nq.length >= 3 || /^\d{2,}$/.test(nq))
  useEffect(() => {
    if (!buscaRegistros) {
      setRegistros([])
      setBuscandoRegistros(false)
      return
    }
    let vivo = true
    const t = setTimeout(() => {
      setBuscandoRegistros(true)
      buscarRegistros(selectedEmpresaId, q.trim(), tiposClave.split(",").filter(Boolean) as TipoRegistro[])
        .then((r) => {
          if (vivo) setRegistros(r.success ? r.data : [])
        })
        .catch(() => {
          if (vivo) setRegistros([])
        })
        .finally(() => {
          if (vivo) setBuscandoRegistros(false)
        })
    }, 250)
    return () => {
      vivo = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaRegistros, nq, selectedEmpresaId, tiposClave])

  const abrirRegistro = (r: RegistroEncontrado) => {
    cerrarY(() => window.dispatchEvent(new CustomEvent("lipgo:abrir-registro", { detail: r })))
  }
  const itemsRecientes = tokens.length ? [] : recientes.map((r) => porModulo.get(r.modulo)).filter((x): x is ItemBusqueda => !!x).slice(0, 5)
  const itemsFavoritos = tokens.length ? [] : favoritos.map((f) => porModulo.get(f)).filter((x): x is ItemBusqueda => !!x).slice(0, 8)

  const preguntarLipbot = () => {
    const pregunta = q.trim()
    cerrarY(() => {
      if (lipbotMontado) window.dispatchEvent(new CustomEvent("lipgo:lipbot-ask", { detail: pregunta }))
      else onNavigate("Asistente IA")
    })
  }

  const Fila = ({ it }: { it: ItemBusqueda }) => {
    const Icon = it.icon
    return (
      <CommandItem value={it.id} onSelect={() => cerrarY(it.run)} className="gap-3 py-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${it.color} 14%, #fff)`, color: it.color, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${it.color} 22%, transparent)` }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{it.titulo}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{it.subtitulo}</span>
        </span>
        {it.modulo && favSet.has(it.modulo) && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
        {it.tipo === "hub" && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">pantalla</span>}
      </CommandItem>
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogHeader className="sr-only">
        <DialogTitle>Buscar o ir a</DialogTitle>
        <DialogDescription>Busca pantallas, módulos y acciones de LIPgo</DialogDescription>
      </DialogHeader>
      <DialogContent className="top-[10%] translate-y-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <CommandPrimitive
          shouldFilter={false}
          className="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground"
          onKeyDown={(e) => {
            if (e.key === "Enter" && tokens.length > 0 && resultados.modulos.length === 0 && resultados.acciones.length === 0 && registros.length === 0) {
              e.preventDefault()
              preguntarLipbot()
            }
          }}
        >
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={
              tiposVisibles.length > 0
                ? "Buscar pantalla, orden, placa, persona o acción… (por ejemplo: báscula, 12345, ABC123, Pérez)"
                : "Buscar pantalla, módulo o acción… (por ejemplo: báscula, turnos, cuarentena)"
            }
            className="h-12 text-sm"
          />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>
              <div className="space-y-1 px-2">
                <p>Nada con ese nombre.</p>
                <button type="button" onClick={preguntarLipbot} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <Sparkles className="h-3.5 w-3.5" /> Preguntarle a LIPbot: «{q.trim()}»
                </button>
              </div>
            </CommandEmpty>
            {itemsRecientes.length > 0 && (
              <CommandGroup heading="Recientes">
                {itemsRecientes.map((it) => (
                  <Fila key={`rec:${it.id}`} it={it} />
                ))}
              </CommandGroup>
            )}
            {itemsFavoritos.length > 0 && (
              <CommandGroup heading="Favoritos">
                {itemsFavoritos.map((it) => (
                  <Fila key={`fav:${it.id}`} it={it} />
                ))}
              </CommandGroup>
            )}
            {resultados.modulos.length > 0 && (
              <CommandGroup heading="Pantallas y módulos">
                {resultados.modulos.map((it) => (
                  <Fila key={it.id} it={it} />
                ))}
              </CommandGroup>
            )}
            {registros.length > 0 && (
              <CommandGroup heading={`Registros · ${selectedEmpresaNombre || `ID ${selectedEmpresaId}`}`}>
                {registros.map((r) => {
                  const est = ESTILO_REGISTRO[r.tipo]
                  const Icon = est.icon
                  return (
                    <CommandItem key={r.id} value={`reg:${r.id}`} onSelect={() => abrirRegistro(r)} className="gap-3 py-2">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: `color-mix(in srgb, ${est.color} 14%, #fff)`, color: est.color, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${est.color} 22%, transparent)` }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{r.titulo}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {r.subtitulo} · abre {est.destino}
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{r.tipo === "orden" ? "orden" : "persona"}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {buscandoRegistros && registros.length === 0 && (
              <div className="px-3 py-1.5 text-[11px] text-muted-foreground">Buscando órdenes y personas en el proyecto…</div>
            )}
            {tokens.length > 0 && (
              <CommandGroup heading="LIPbot">
                <CommandItem value="act:lipbot" onSelect={preguntarLipbot} className="gap-3 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">Preguntarle a LIPbot: «{q.trim()}»</span>
                    <span className="block text-[11px] text-muted-foreground">Consulta datos, navega o ejecuta por ti</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {resultados.acciones.length > 0 && (
              <CommandGroup heading="Acciones">
                {resultados.acciones.map((it) => (
                  <Fila key={it.id} it={it} />
                ))}
              </CommandGroup>
            )}
            {tokens.length === 0 && itemsRecientes.length === 0 && itemsFavoritos.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-muted-foreground">
                <Clock className="mr-1 inline h-3 w-3" /> Aquí aparecerán tus pantallas recientes y favoritas. Escribe para buscar.
              </div>
            )}
          </CommandList>
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
            <span>↑↓ moverse · ↵ abrir · Esc cerrar</span>
            <span>Ctrl K buscar · Ctrl J LIPbot</span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  )
}
