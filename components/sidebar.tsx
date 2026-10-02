"use client"

import {
  Home,
  Package,
  FileText,
  Search,
  LayoutDashboard,
  Settings,
  Menu,
  X,
  Truck,
  ChevronDown,
  Users,
  Wallet,
  BadgeCheck,
  Layers,
  ShieldCheck,
  Banknote,
  GraduationCap,
} from "lucide-react"
import Image from "next/image"
import type { GroupKey, Module, Subgroup } from "@/lib/dashboard-data"
import { getUserModulesCached } from "@/lib/user-modules-client-cache"
import { groups } from "@/lib/dashboard-data"
import { colorDeEntrada, hubDe, plegarEnHubs, type EntradaMenu } from "@/lib/navegacion"
import { useState, useEffect, useMemo, type CSSProperties } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

interface SidebarProps {
  selectedGroup: GroupKey | null
  selectedModule: string | null
  onSelectGroup: (group: GroupKey | null) => void
  onSelectModule: (module: string | null) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

interface UserModulesResponse {
  protectedModules: string[]
  allowedModules: string[]
}

/**
 * Actor del héroe ADAPTATIVO: el glifo animado cambia según el módulo/área
 * seleccionada, para que la "Torre de Control" hable el idioma del dominio
 * (Gestión Humana → personas, Finanzas → dinero, Despachos → camión…). El color
 * lo hereda por CSS (`var(--hero)`) desde el contenedor del héroe. Sin grupo
 * (Inicio) muestra el camión de marca. Solo presentación: no toca lógica.
 */
function HeroActor({ groupKey }: { groupKey: GroupKey | null }) {
  switch (groupKey) {
    case "rrhh": // Gestión Humana → persona
      return (
        <>
          <circle cx="11" cy="3.6" r="2.7" className="hero-light" />
          <path d="M11 6.6 c-3 0-5 2-5 5 v3 h10 v-3 c0-3-2-5-5-5 z" className="hero-light" />
          <path d="M9 8.4 l2 2 2-2" className="hero-accent-stroke" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )
    case "financiera": // Financiera → moneda $
      return (
        <>
          <circle cx="12" cy="9" r="7" className="hero-light" />
          <circle cx="12" cy="9" r="7" fill="none" className="hero-accent-stroke" strokeWidth="1.3" />
          <text x="12" y="12.4" textAnchor="middle" fontSize="9" fontWeight="800" fontFamily="ui-sans-serif,system-ui,sans-serif" className="hero-accent">$</text>
        </>
      )
    case "compensacion": // Compensación → billetera (nómina/liquidaciones/pago)
      return (
        <>
          <rect x="4" y="5.5" width="14" height="10" rx="2" className="hero-light" />
          <path d="M4 8.6 h14" className="hero-lightstroke" strokeWidth="1.1" />
          <circle cx="14.6" cy="11.4" r="1.5" className="hero-accent" />
        </>
      )
    case "inventarios": // Inventarios → caja isométrica
      return (
        <>
          <path d="M12 3 l7.5 3.7 v6.6 l-7.5 3.7 -7.5-3.7 v-6.6 z" className="hero-light" />
          <path d="M4.5 6.7 l7.5 3.7 7.5-3.7 M12 10.4 v8" fill="none" className="hero-accent-stroke" strokeWidth="1.1" strokeLinejoin="round" />
        </>
      )
    case "pedidos": // Pedidos → carrito
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4 h2.6 l2 8 h8.6 l2-6 h-11.8" className="hero-lightstroke" strokeWidth="1.6" />
          <circle cx="9" cy="14.6" r="1.5" className="hero-accent" fill="currentColor" />
          <circle cx="15.6" cy="14.6" r="1.5" className="hero-accent" fill="currentColor" />
        </g>
      )
    case "produccion": // Producción (incluye Materiales · MRP) → engranaje girando
      return (
        <g className="lipgo-gear">
          <g className="hero-lightstroke" strokeWidth="2.3" strokeLinecap="round">
            <line x1="11" y1="2.4" x2="11" y2="4.6" />
            <line x1="11" y1="13.4" x2="11" y2="15.6" />
            <line x1="4.4" y1="9" x2="6.6" y2="9" />
            <line x1="15.4" y1="9" x2="17.6" y2="9" />
            <line x1="6.3" y1="4.3" x2="7.9" y2="5.9" />
            <line x1="14.1" y1="12.1" x2="15.7" y2="13.7" />
            <line x1="15.7" y1="4.3" x2="14.1" y2="5.9" />
            <line x1="7.9" y1="12.1" x2="6.3" y2="13.7" />
          </g>
          <circle cx="11" cy="9" r="4.1" className="hero-light" />
          <circle cx="11" cy="9" r="1.9" fill="#0b2138" className="hero-accent-stroke" strokeWidth="1.2" />
        </g>
      )
    case "configuracion": // Configuración → controles / sliders
      return (
        <g strokeLinecap="round">
          <line x1="4" y1="5" x2="18" y2="5" className="hero-lightstroke" strokeWidth="1.5" />
          <line x1="4" y1="9" x2="18" y2="9" className="hero-lightstroke" strokeWidth="1.5" />
          <line x1="4" y1="13" x2="18" y2="13" className="hero-lightstroke" strokeWidth="1.5" />
          <circle cx="9" cy="5" r="2" className="hero-accent" />
          <circle cx="14" cy="9" r="2" className="hero-accent" />
          <circle cx="7" cy="13" r="2" className="hero-accent" />
        </g>
      )
    case "certificaciones_lip": // Certificaciones → escudo con check
      return (
        <>
          <path d="M11 2.4 l6 2.1 v4 c0 4-3 6.6-6 8.1 c-3-1.5-6-4.1-6-8.1 v-4 z" className="hero-light" />
          <path d="M8 8.9 l2.2 2.2 4-4.3" fill="none" className="hero-accent-stroke" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )
    case "sst": // SST → casco de seguridad
      return (
        <>
          <path d="M4.5 13.5 h13 v1.8 h-13 z" className="hero-light" />
          <path d="M6 13.5 c0-4.4 2.4-6.7 5-6.7 s5 2.3 5 6.7 z" className="hero-light" />
          <rect x="10.2" y="4.6" width="1.6" height="3" rx="0.6" className="hero-accent" />
          <path d="M8 11 h6" className="hero-accent-stroke" strokeWidth="1.2" strokeLinecap="round" />
        </>
      )
    case "lip": // LIP → energía / rayo
      return (
        <>
          <path d="M13 2 L6 10 h4 l-2 6 8-9 h-4 z" className="hero-accent" />
          <path d="M13 2 L6 10 h4 l-2 6 8-9 h-4 z" fill="none" className="hero-lightstroke" strokeWidth="0.8" strokeLinejoin="round" />
        </>
      )
    case "integral": // Gestión Integral → barras / indicadores
      return (
        <>
          <rect x="4" y="9" width="3.2" height="6" rx="0.6" className="hero-light" />
          <rect x="9.4" y="6" width="3.2" height="9" rx="0.6" className="hero-light" />
          <rect x="14.8" y="3" width="3.2" height="12" rx="0.6" className="hero-accent" />
        </>
      )
    case "despachos": // Despachos → camión (motivo de marca)
    default: // Inicio / sin grupo → camión logístico
      return (
        <>
          <rect x="6" y="4" width="13" height="9" rx="1.5" className="hero-light" />
          <path d="M19 7h5l3 3v3h-8z" className="hero-accent" />
          <circle cx="10.5" cy="14.3" r="1.7" fill="#0b2138" className="hero-lightstroke" strokeWidth="1" />
          <circle cx="23" cy="14.3" r="1.7" fill="#0b2138" className="hero-lightstroke" strokeWidth="1" />
        </>
      )
  }
}

export function Sidebar({
  selectedGroup,
  selectedModule,
  onSelectGroup,
  onSelectModule,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<GroupKey>>(new Set())
  const [expandedSubgroups, setExpandedSubgroups] = useState<Set<string>>(new Set())
  // Texto del buscador de modulos del menu lateral.
  const [moduleSearch, setModuleSearch] = useState("")
  // Cajón móvil (Fase 3): se cierra solo al navegar.
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => {
    setDrawerOpen(false)
  }, [selectedGroup, selectedModule])

  // Permisos del usuario para filtrar el menu. Se cargan una sola vez al
  // montar el sidebar y se mantienen en memoria. Hasta que se reciba la
  // respuesta `permissionsLoaded` queda en false: durante esa ventana no
  // se aplica filtro (se muestran todos los grupos), evitando que el menu
  // aparezca vacio en el primer render. Como adicional barrera, el
  // `PermissionGuard` que envuelve cada modulo bloquea cualquier acceso
  // que se cuele por un click rapido durante esos milisegundos.
  const [protectedModules, setProtectedModules] = useState<Set<string>>(new Set())
  const [allowedModules, setAllowedModules] = useState<Set<string>>(new Set())
  const [permissionsLoaded, setPermissionsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadPermissions = async () => {
      try {
        // `no-store` obligatorio: sin esto el navegador puede servir una
        // respuesta cacheada y un permiso recién otorgado NO aparece en el
        // menú hasta un refresco fuerte. Mismo criterio que ya usan
        // useAsistenciaAlerts / useOperacionesDiaAlerts contra este endpoint.
        const data = await getUserModulesCached()
        if (cancelled) return
        setProtectedModules(new Set(data.protectedModules))
        setAllowedModules(new Set(data.allowedModules))
        setPermissionsLoaded(true)
      } catch (error) {
        console.error("[v0] Sidebar: error loading permissions:", error)
        if (!cancelled) setPermissionsLoaded(true)
      }
    }
    loadPermissions()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Decide si un modulo concreto debe verse en el menu.
   *  - Antes de cargar los permisos: se muestra (estado neutro).
   *  - Si el modulo NO esta protegido (no aparece en protectedModules):
   *    se muestra siempre.
   *  - Si esta protegido: se muestra solo si esta en allowedModules.
   */
  const isModuleVisible = (moduleName: string): boolean => {
    if (!permissionsLoaded) return true
    if (!protectedModules.has(moduleName)) return true
    return allowedModules.has(moduleName)
  }

  useEffect(() => {
    if (selectedGroup && selectedModule) {
      // When a module is selected, ensure only its group is expanded
      setExpandedGroups(new Set([selectedGroup]))
    }
  }, [selectedGroup, selectedModule])

  const toggleGroup = (key: GroupKey) => {
    const newExpanded = new Set<GroupKey>()
    if (!expandedGroups.has(key)) {
      newExpanded.add(key)
    }
    setExpandedGroups(newExpanded)
  }

  const toggleSubgroup = (groupKey: GroupKey, subgroupTitle: string) => {
    const key = `${groupKey}-${subgroupTitle}`
    const newExpanded = new Set(expandedSubgroups)
    if (newExpanded.has(key)) {
      newExpanded.delete(key)
    } else {
      newExpanded.add(key)
    }
    setExpandedSubgroups(newExpanded)
  }

  /**
   * Construye la lista efectiva de grupos a renderizar tras aplicar el
   * filtro de permisos. La logica:
   *   - En cada subgrupo se filtran sus modulos. Si queda vacio, el
   *     subgrupo se descarta.
   *   - En los modulos directos del grupo se aplica el mismo filtro.
   *   - Si el grupo se queda sin subgrupos visibles ni modulos directos,
   *     se descarta entero (no aparece en el sidebar).
   *
   * Memoizado por `permissionsLoaded` y los sets para no recomputar en
   * cada render mientras el usuario hace clicks.
   */
  const visibleGroups = useMemo(() => {
    return groups
      .map((group) => {
        const filteredSubgroups: Subgroup[] | undefined = group.subgroups
          ?.map((sg) => ({
            ...sg,
            modules: sg.modules.filter((m: Module) => isModuleVisible(m.name)),
          }))
          .filter((sg) => sg.modules.length > 0)

        const filteredModules: Module[] | undefined = group.modules?.filter(
          (m) => isModuleVisible(m.name),
        )

        const hasVisibleSubgroups = (filteredSubgroups?.length ?? 0) > 0
        const hasVisibleModules = (filteredModules?.length ?? 0) > 0
        if (!hasVisibleSubgroups && !hasVisibleModules) return null

        // Regla adicional: ocultar el GRUPO completo cuando el usuario
        // no tiene permiso sobre NINGUN modulo protegido del grupo.
        // Antes el grupo se mostraba si quedaba siquiera un modulo
        // visible (incluyendo modulos no protegidos como "Ingresos MP",
        // "Saldos de empaque", "Gestion de Colaboradores", etc.) lo
        // que dejaba ver categorias enteras a usuarios sin acceso real
        // a su contenido. Esta verificacion exige que al menos UN
        // modulo protegido permitido viva en el grupo. Mientras los
        // permisos aun no terminan de cargar, no aplicamos este filtro
        // (`permissionsLoaded` false) para evitar parpadeos.
        // Grupos exentos del filtro de modulo protegido: contienen solo
        // modulos no protegidos que deben verse para todos (Fase 1).
        // "aprendizaje" es la guia de usuario: su unico modulo no esta
        // protegido a proposito (debe verlo todo el mundo), asi que sin esta
        // exencion el filtro de "al menos un modulo protegido permitido"
        // ocultaria el grupo entero para todos.
        const GRUPOS_SIN_FILTRO_PROTEGIDO: GroupKey[] = ["certificaciones_lip", "aprendizaje"]
        if (permissionsLoaded && !GRUPOS_SIN_FILTRO_PROTEGIDO.includes(group.key)) {
          const allModulesInGroup = [
            ...(filteredModules ?? []),
            ...((filteredSubgroups ?? []).flatMap((sg) => sg.modules)),
          ]
          const hasAtLeastOneAllowedProtected = allModulesInGroup.some((m) =>
            allowedModules.has(m.name),
          )
          if (!hasAtLeastOneAllowedProtected) return null
        }

        return {
          ...group,
          subgroups: filteredSubgroups,
          modules: filteredModules,
        }
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoaded, allowedModules, protectedModules])

  // REORG (2026-07-03): menú ordenado por FLUJO OPERATIVO (entrada → almacén →
  // producción → salida → soporte → config). Los grupos "Vehículos", "Báscula" y
  // "Auditoría" se absorbieron en otros grupos; sus módulos y permisos se
  // conservan (viajan por el `name` del módulo).
  // REORG (2026-07-29): "Compensación" vuelve como grupo propio — reúne todo lo
  // que liquida/paga al colaborador (nómina, liquidaciones, parafiscales,
  // revisión de nómina, vacaciones), antes disperso dentro de Gestión Humana.
  const allMenuItems = [
    { key: null, label: "Inicio", icon: Home },
    { key: "integral" as GroupKey, label: "Torre de Control", icon: LayoutDashboard },
    { key: "pedidos" as GroupKey, label: "Pedidos y solicitudes", icon: FileText },
    { key: "despachos" as GroupKey, label: "Recepción y Despacho", icon: Truck },
    { key: "inventarios" as GroupKey, label: "Almacenamiento", icon: Package },
    { key: "produccion" as GroupKey, label: "Producción", icon: Package },
    { key: "lip" as GroupKey, label: "Operación LIP", icon: Users },
    { key: "financiera" as GroupKey, label: "Gestión Financiera", icon: Wallet },
    { key: "rrhh" as GroupKey, label: "Gestión Humana", icon: Users },
    { key: "compensacion" as GroupKey, label: "Compensación", icon: Banknote },
    { key: "certificaciones_lip" as GroupKey, label: "Certificaciones · SIG", icon: BadgeCheck },
    { key: "sst" as GroupKey, label: "Seguridad y Salud (SST)", icon: ShieldCheck },
    { key: "configuracion" as GroupKey, label: "Configuración", icon: Settings },
    // Guia de usuario: va de ultimo porque es soporte, no operacion.
    { key: "aprendizaje" as GroupKey, label: "Aprendizaje", icon: GraduationCap },
  ]

  // Filtra los items del menu superior para ocultar los grupos cuyos
  // modulos quedaron todos sin permiso. "Inicio" (key === null) siempre
  // se muestra: no es un grupo de modulos.
  const menuItems = allMenuItems.filter((item) => {
    if (item.key === null) return true
    return visibleGroups.some((g) => g.key === item.key)
  })

  // REORG visual (estilo Odoo): color de dominio por grupo para los íconos.
  const GROUP_TINT: Record<string, string> = {
    integral: "#9fb6cc",
    pedidos: "#8ea6f0",
    despachos: "#5fc8e6",
    inventarios: "#3fd7cf",
    produccion: "#e79a5c",
    lip: "#b199ee",
    financiera: "#5fd398",
    rrhh: "#ed94c2",
    compensacion: "#f0cf5c",
    certificaciones_lip: "#f0876a",
    sst: "#e0564e",
    configuracion: "#9aa6b3",
    aprendizaje: "#7fb2f0",
  }

  // Color del héroe = tinte del área activa (o cian de marca en Inicio). Alimenta
  // rutas, hub, glow y el actor temático vía la variable CSS --hero.
  const heroAccent = (selectedGroup ? GROUP_TINT[selectedGroup] : undefined) ?? "#00c2dc"

  // Lista plana de todos los modulos visibles, con su grupo, etiqueta del
  // grupo, subgrupo (si aplica) e icono. Sirve para el buscador.
  const allModulesFlat = useMemo(() => {
    const groupLabelByKey = new Map(allMenuItems.map((i) => [i.key, i.label]))
    const result: {
      groupKey: GroupKey
      groupLabel: string
      subgroupTitle?: string
      name: string
      label: string
      icon: Module["icon"]
    }[] = []
    for (const g of visibleGroups) {
      const groupLabel = (groupLabelByKey.get(g.key) as string) ?? g.title
      const pushModule = (m: Module, subgroupTitle?: string) => {
        // Si el módulo es una pestaña de un hub, el subtítulo muestra el hub
        // (así el usuario ve en qué pantalla queda).
        const hub = hubDe(g.key, m.name)
        result.push({
          groupKey: g.key,
          groupLabel,
          subgroupTitle: hub ? hub.title : subgroupTitle,
          name: m.name,
          label: m.label ?? m.name,
          icon: m.icon,
        })
      }
      g.subgroups?.forEach((sg) => sg.modules.forEach((m) => pushModule(m, sg.title)))
      g.modules?.forEach((m) => pushModule(m))
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleGroups])

  const normalizedSearch = moduleSearch.trim().toLowerCase()
  const searchResults =
    normalizedSearch.length > 0
      ? allModulesFlat.filter(
          (m) =>
            m.label.toLowerCase().includes(normalizedSearch) ||
            m.name.toLowerCase().includes(normalizedSearch) ||
            m.groupLabel.toLowerCase().includes(normalizedSearch) ||
            (m.subgroupTitle?.toLowerCase().includes(normalizedSearch) ?? false),
        )
      : []

  // Al elegir un modulo desde el buscador: navega, expande su grupo y limpia.
  const handleSelectFromSearch = (groupKey: GroupKey, moduleName: string) => {
    onSelectGroup(groupKey)
    onSelectModule(moduleName)
    setExpandedGroups(new Set([groupKey]))
    setModuleSearch("")
  }

  // Botón de una entrada del menú: módulo suelto o HUB (pantalla con pestañas,
  // lib/navegacion.ts). El hub abre su primera pestaña visible y queda activo
  // cuando el módulo seleccionado es cualquiera de sus pestañas. Las pestañas
  // NO se anidan en la barra (se ven dentro de la pantalla y en el buscador).
  const renderEntrada = (entrada: EntradaMenu, groupKey: GroupKey) => {
    const clases = (activo: boolean) => `
      flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs
      transition-all duration-200
      ${activo ? "text-foreground bg-accent/70 font-medium" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}
    `
    if (entrada.tipo === "hub") {
      const HubIcon = entrada.hub.icon
      const isHubActive = selectedGroup === groupKey && hubDe(selectedGroup, selectedModule)?.key === entrada.hub.key
      const primera = entrada.tabs[0]?.name
      return (
        <button
          key={`hub:${entrada.hub.key}`}
          onClick={() => {
            if (!primera) return
            onSelectGroup(groupKey)
            onSelectModule(primera)
          }}
          className={clases(isHubActive)}
          title={entrada.tabs.map((t) => t.label ?? t.name).join(" · ")}
        >
          <HubIcon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: colorDeEntrada(groupKey, { hubKey: entrada.hub.key }) }} />
          <span className="text-left whitespace-nowrap overflow-hidden text-ellipsis">{entrada.hub.title}</span>
          <span className="ml-auto flex-shrink-0 rounded-full bg-white/10 px-1.5 text-[9.5px] tabular-nums text-muted-foreground/80">
            {entrada.tabs.length}
          </span>
        </button>
      )
    }
    const module = entrada.modulo
    const ModuleIcon = module.icon
    const isModuleActive = selectedModule === module.name && selectedGroup === groupKey
    return (
      <button
        key={module.name}
        onClick={() => {
          onSelectGroup(groupKey)
          onSelectModule(module.name)
        }}
        className={clases(isModuleActive)}
      >
        <ModuleIcon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: colorDeEntrada(groupKey, { modulo: module.name }) }} />
        <span className="text-left whitespace-nowrap overflow-hidden text-ellipsis">{module.label ?? module.name}</span>
      </button>
    )
  }

  // Árbol del menú (áreas → subgrupos → pantallas). Lo usan la barra lateral de
  // escritorio (colapsable) y el cajón móvil (siempre expandido). Un solo
  // render para que nunca diverjan.
  const renderArbol = (colapsado: boolean) => (
    <>
          {/* Resultados del buscador: lista plana de modulos coincidentes */}
          {!colapsado && normalizedSearch.length > 0 ? (
            searchResults.length > 0 ? (
              searchResults.map((m) => {
                const ModuleIcon = m.icon
                const isModuleActive = selectedModule === m.name && selectedGroup === m.groupKey
                return (
                  <button
                    key={`${m.groupKey}-${m.name}`}
                    onClick={() => handleSelectFromSearch(m.groupKey, m.name)}
                    className={`
                      flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-xs
                      transition-all duration-200
                      ${
                        isModuleActive
                          ? "text-foreground bg-accent/70 font-medium"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      }
                    `}
                  >
                    <span className="flex items-center gap-2">
                      <ModuleIcon className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="text-left">{m.label}</span>
                    </span>
                    <span className="pl-5 text-[10px] text-muted-foreground/70">
                      {m.groupLabel}
                      {m.subgroupTitle ? ` · ${m.subgroupTitle}` : ""}
                    </span>
                  </button>
                )
              })
            ) : (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No se encontraron módulos
              </p>
            )
          ) : (
            menuItems.map((item) => {
            const Icon = item.icon
            const isGroupActive = selectedGroup === item.key
            const isExpanded = item.key ? expandedGroups.has(item.key) : false
            const group = item.key ? visibleGroups.find((g) => g.key === item.key) : null

            // Inicio button (no accordion)
            if (!item.key) {
              return (
                <button
                  key={item.label}
                  onClick={() => {
                    onSelectGroup(null)
                    onSelectModule(null)
                  }}
                  className={`
                    flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium
                    transition-all duration-200 relative
                    ${
                      isGroupActive
                        ? "text-foreground bg-accent"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }
                    ${colapsado ? "justify-center" : ""}
                  `}
                  title={colapsado ? item.label : undefined}
                >
                  {isGroupActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                  )}
                  <span className="lipgo-tile" style={{ color: "#9fb6cc" }}>
                    <Icon className="h-[15px] w-[15px]" />
                  </span>
                  {!colapsado && <span className="whitespace-nowrap">{item.label}</span>}
                </button>
              )
            }

            // Group accordion buttons
            return (
              <div key={item.label} className="space-y-1">
                <button
                  onClick={() => {
                    if (!colapsado) {
                      onSelectGroup(item.key!)
                      onSelectModule(null)
                      toggleGroup(item.key!)
                    }
                  }}
                  className={`
                    flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium
                    transition-all duration-200 relative
                    ${
                      isGroupActive
                        ? "text-foreground bg-accent"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }
                    ${colapsado ? "justify-center" : "justify-between"}
                  `}
                  title={colapsado ? item.label : undefined}
                >
                  <div className="flex items-center gap-3">
                    {isGroupActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                    )}
                    <span className="lipgo-tile" style={{ color: GROUP_TINT[item.key!] ?? "#9fb6cc" }}>
                      <Icon className="h-[15px] w-[15px]" />
                    </span>
                    {!colapsado && <span className="whitespace-nowrap">{item.label}</span>}
                  </div>
                  {!colapsado && (
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                    />
                  )}
                </button>

                {/* Module/Subgroup list - shown when expanded */}
                <div
                  className={`
                    ml-4 space-y-1 border-l border-border pl-2
                    overflow-hidden transition-all duration-300 ease-in-out
                    ${!colapsado && isExpanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"}
                  `}
                >
                  {!colapsado && group && (
                    <>
                      {group.subgroups
                        ? // Render subgroups
                          group.subgroups.map((subgroup) => {
                            const subgroupKey = `${item.key}-${subgroup.title}`
                            const isSubgroupExpanded = expandedSubgroups.has(subgroupKey)

                            return (
                              <div key={subgroup.title} className="space-y-1">
                                <button
                                  onClick={() => toggleSubgroup(item.key!, subgroup.title)}
                                  className={`
                                  flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium
                                  transition-all duration-200 justify-between
                                  text-muted-foreground hover:bg-accent/50 hover:text-foreground
                                `}
                                >
                                  <span className="text-left whitespace-nowrap">{subgroup.title}</span>
                                  <ChevronDown
                                    className={`h-3 w-3 transition-transform duration-200 flex-shrink-0 ${isSubgroupExpanded ? "rotate-180" : ""}`}
                                  />
                                </button>

                                {/* Subgroup modules */}
                                <div
                                  className={`
                                  ml-3 space-y-1 border-l border-border pl-2
                                  overflow-hidden transition-all duration-300 ease-in-out
                                  ${isSubgroupExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}
                                `}
                                >
                                  {plegarEnHubs(item.key!, subgroup.modules).map((e) => renderEntrada(e, item.key!))}
                                </div>
                              </div>
                            )
                          })
                        : // Render direct modules (for groups without subgroups)
                          plegarEnHubs(item.key!, group.modules ?? []).map((e) => renderEntrada(e, item.key!))}
                    </>
                  )}
                </div>
              </div>
            )
            })
          )}
    </>
  )

  return (
    <>
      {/* Rediseño "Torre de Control" (2026-07-03): re-skin OSCURO premium del
          sidebar redefiniendo las variables de tema SOLO dentro de .lipgo-sb
          (no cambia el resto de la app), + hero animado de logística. No toca
          permisos ni rutas. */}
      <style>{`
        /* Marca LIP (2026-10-02): el fondo oscuro es el verde azulado profundo
           del rombo del logo (#052e2b → #0b3b3a), no azul marino; el acento es
           el turquesa del logo (#00d4ce). */
        .lipgo-sb{
          --card:#06302e; --card-foreground:#ffffff; --foreground:#ffffff;
          --background:#0b3b3a; --muted-foreground:#cfe9e6;
          --accent:#115454; --accent-foreground:#ffffff;
          --border:#164a49; --input:#164a49; --primary:#00d4ce; --ring:#00d4ce;
          background-image:linear-gradient(180deg,#07302e,#041f1e);
        }
        /* Letras del menú en BLANCO con alto contraste (peticion de diseño). */
        .lipgo-sb nav button span{ color:#ffffff; }
        .lipgo-sb nav button{ color:#eafaf9; }
        .lipgo-sb .bg-primary{ box-shadow:0 0 12px rgba(0,212,206,.6); }
        .lipgo-hero-bg{ background:
          radial-gradient(120% 90% at 82% 0%, color-mix(in srgb, var(--hero,#00d4ce) 34%, transparent), transparent 58%),
          radial-gradient(95% 85% at 0% 100%, rgba(14,124,120,.45), transparent 55%);
          transition: background .5s ease; }
        .lipgo-tag{ font:600 10px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:.14em; text-transform:uppercase; color:#8ff0ec; display:flex; align-items:center; gap:6px; }
        .lipgo-live{ width:6px; height:6px; border-radius:50%; background:#37f5a0; box-shadow:0 0 8px #37f5a0; }
        /* El rombo REAL del logo (public/lipgo-icon.png), con un halo turquesa suave. */
        .lipgo-logo-img{ width:32px; height:32px; flex:none; filter:drop-shadow(0 0 10px rgba(0,212,206,.45)); }
        .lipgo-word{ font:800 19px/1 var(--font-plex),sans-serif; letter-spacing:-.02em; color:#fff; }
        .lipgo-word em{ font-style:normal; color:#21e3dd; }
        .lipgo-tile{ display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:8px; background:#0d4341; border:1px solid #176461; flex:none; }
        .lipgo-route{ stroke: color-mix(in srgb, var(--hero,#82c8eb) 58%, transparent); stroke-width:1.6; fill:none; stroke-linecap:round; stroke-dasharray:5 6; transition: stroke .5s ease; }
        .lipgo-route.b{ stroke: color-mix(in srgb, var(--hero,#82c8eb) 26%, transparent); }
        .lipgo-node{ fill:#cfeff8; } .lipgo-node.hub{ fill: var(--hero,#00c2dc); transition: fill .5s ease; }
        /* Actor temático del héroe (adaptativo por módulo). El color viene de --hero. */
        .hero-light{ fill:#dff2fb; } .hero-accent{ fill: var(--hero,#00c2dc); }
        .hero-lightstroke{ stroke:#dff2fb; } .hero-accent-stroke{ stroke: var(--hero,#00c2dc); }
        .lipgo-sect{ font:700 9.5px/1 sans-serif; letter-spacing:.16em; text-transform:uppercase; color:#8fc9c5; padding:13px 14px 5px; }
        @media (prefers-reduced-motion: no-preference){
          .lipgo-route{ animation: lipgo-flow 1.1s linear infinite; }
          .lipgo-actor{ animation: lipgo-run 6s ease-in-out infinite, lipgo-fadein .5s ease-out; }
          .lipgo-gear{ transform-box: fill-box; transform-origin: center; animation: lipgo-spin 3.4s linear infinite; }
          .lipgo-hub-ring{ animation: lipgo-ring 2.8s ease-out infinite; }
          .lipgo-live{ animation: lipgo-blink 1.8s ease-in-out infinite; }
        }
        @keyframes lipgo-flow{ to{ stroke-dashoffset:-22; } }
        @keyframes lipgo-run{ 0%{transform:translateX(4px)} 50%{transform:translateX(150px)} 100%{transform:translateX(4px)} }
        @keyframes lipgo-spin{ to{ transform: rotate(360deg); } }
        @keyframes lipgo-fadein{ from{ opacity:0 } to{ opacity:1 } }
        @keyframes lipgo-ring{ 0%{ r:3; opacity:.85 } 100%{ r:15; opacity:0 } }
        @keyframes lipgo-blink{ 0%,100%{opacity:1} 50%{opacity:.35} }
      `}</style>

      {/* Desktop Sidebar */}
      <aside
        className={`lipgo-sb hidden md:flex flex-col h-screen border-r border-border z-20 transition-all duration-300 ${collapsed ? "w-16 lg:w-20" : "w-56 lg:w-64"}`}
      >
        {/* Hero de marca — Torre de Control (red de operación animada) */}
        <div
          className={`relative flex-shrink-0 overflow-hidden border-b border-border ${collapsed ? "h-16 lg:h-20" : "h-32"}`}
          style={{ "--hero": heroAccent } as CSSProperties}
        >
          {!collapsed && (
            <>
              <div className="lipgo-hero-bg absolute inset-0" aria-hidden="true" />
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 264 128" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                <path className="lipgo-route b" d="M-10 40 C 60 40, 90 96, 170 96 S 260 60, 280 62" />
                <path className="lipgo-route" d="M-10 92 C 70 92, 95 44, 165 44 S 250 74, 280 30" />
                <circle className="lipgo-node hub" cx="165" cy="44" r="3.4" />
                <circle className="lipgo-hub-ring hero-accent-stroke" cx="165" cy="44" r="3" fill="none" strokeWidth="1.3" />
                <circle className="lipgo-node" cx="34" cy="86" r="2.6" />
                <circle className="lipgo-node" cx="238" cy="52" r="2.6" />
                <g transform="translate(0,72)">
                  {/* Actor adaptativo: cambia de glifo y color según el módulo activo.
                      key fuerza el remount para reproducir el fundido de entrada. */}
                  <g className="lipgo-actor" key={selectedGroup ?? "home"}>
                    <HeroActor groupKey={selectedGroup} />
                  </g>
                </g>
              </svg>
            </>
          )}
          <button
            onClick={onToggleCollapse}
            className="absolute right-2 top-2 z-10 rounded-lg p-1.5 transition-colors hover:bg-white/10"
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          >
            {collapsed ? (
              <Menu className="h-4 w-4 text-white/70" />
            ) : (
              <X className="h-4 w-4 text-white/70" />
            )}
          </button>
          {collapsed ? (
            <div className="flex h-full items-center justify-center">
              <Image src="/lipgo-icon.png" alt="LIPgo" width={32} height={32} className="lipgo-logo-img" priority />
            </div>
          ) : (
            <button
              onClick={() => {
                onSelectGroup(null)
                onSelectModule(null)
              }}
              className="absolute bottom-3 left-4 z-10 flex flex-col items-start gap-1.5 text-left"
            >
              <span className="flex items-center gap-2.5">
                <Image src="/lipgo-icon.png" alt="" width={32} height={32} className="lipgo-logo-img" priority />
                <span className="lipgo-word">LIP<em>GO</em></span>
              </span>
              <span className="lipgo-tag">
                <span className="lipgo-live" />
                Torre de Control · en vivo
              </span>
            </button>
          )}
        </div>

        {/* Buscador de modulos (solo visible cuando el sidebar esta expandido) */}
        {!collapsed && (
          <div className="px-2 lg:px-4 pt-2 lg:pt-4 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={moduleSearch}
                onChange={(e) => setModuleSearch(e.target.value)}
                placeholder="Buscar módulo..."
                aria-label="Buscar módulo"
                className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {moduleSearch && (
                <button
                  onClick={() => setModuleSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Module/Subgroup list - shown when expanded */}
        <nav className="flex-1 space-y-0.5 lg:space-y-1 p-2 lg:p-4 overflow-y-auto overflow-x-hidden">
          {renderArbol(collapsed)}
        </nav>
      </aside>

      {/* Cajón móvil (Fase 3, 2026-09-30): el menú COMPLETO en celular, con el
          buscador global arriba. Antes la barra inferior solo llegaba a 5 áreas
          y las pantallas eran inalcanzables desde el teléfono. */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="lipgo-sb z-[70] w-[86vw] max-w-sm gap-0 p-0 md:hidden [&>button]:text-white/70">
          <SheetHeader className="sr-only">
            <SheetTitle>Menú</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <div className="flex items-center border-b border-border px-3 py-3 pr-12">
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false)
                  onSelectGroup(null)
                  onSelectModule(null)
                }}
                className="flex items-center gap-2 text-left"
              >
                <Image src="/lipgo-icon.png" alt="" width={32} height={32} className="lipgo-logo-img" priority />
                <span className="lipgo-word">LIP<em>GO</em></span>
              </button>
            </div>
            <div className="px-3 pt-3">
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false)
                  setTimeout(() => window.dispatchEvent(new CustomEvent("lipgo:open-palette")), 150)
                }}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
              >
                <Search className="h-4 w-4" /> Buscar o ir a…
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-3">{renderArbol(false)}</nav>
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 safe-area-pb">
        <nav className="flex items-center justify-around px-1 py-1.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-muted-foreground transition-colors"
            aria-label="Abrir menú"
          >
            <Menu className="h-4 w-4 flex-shrink-0 sm:h-5 sm:w-5" />
            <span className="max-w-[60px] truncate text-[9px] font-medium sm:text-[10px]">Menú</span>
          </button>
          {menuItems.slice(0, 4).map((item) => {
            const Icon = item.icon
            const isActive = selectedGroup === item.key

            return (
              <button
                key={item.label}
                onClick={() => {
                  onSelectGroup(item.key)
                  onSelectModule(null)
                }}
                className={`
                  flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg min-w-0
                  transition-colors
                  ${isActive ? "text-primary" : "text-muted-foreground"}
                `}
              >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                <span className="text-[9px] sm:text-[10px] font-medium truncate max-w-[60px]">{item.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </>
  )
}
