// Registro de HUBS de navegación (pantallas con pestañas) y utilidades de
// navegación. Cliente-seguro, sin "use server".
//
// Principio (reorg 2026-09-30): `lib/dashboard-data.ts` sigue siendo el registro
// PLANO de módulos hoja — lo leen 11 consumidores, dos del lado servidor
// (lib/permisos-financieros.ts y el prompt de LIPbot) y el chequeo
// scripts/check-aprendizaje.mjs. Por eso los hubs viven AQUÍ, aparte, y solo
// REFERENCIAN nombres de módulos existentes. Un hub nunca es un módulo: no tiene
// permiso propio, no tiene KPIs ni guía; cada pestaña conserva los suyos.
//
// El estado de navegación (`selectedModule` en app/page.tsx) sigue siendo el
// módulo HOJA; el hub se deriva con `hubDe()` y nunca se guarda. Así todo lo que
// consume `selectedModule` (KPIs, guía, LIPbot, eventos, ErrorBoundary) sigue
// funcionando sin cambios.

import { groups, type GroupKey, type Module } from "@/lib/dashboard-data"
import { ClipboardCheck, LayoutDashboard, LayoutGrid, QrCode, Scale, Truck, Users, type LucideIcon } from "lucide-react"

export interface HubTab {
  /** `name` EXACTO de un módulo existente (clave de ruteo/permiso/KPI/guía). Nunca se renombra. */
  module: string
  /** Texto corto de la pestaña. Por defecto, el label del módulo o su name. */
  label?: string
}

export interface Hub {
  /** Única en toda la app, con prefijo del grupo (p. ej. "lip_centro"). Va en la URL. */
  key: string
  group: GroupKey
  title: string
  icon: LucideIcon
  /** Todas las pestañas deben pertenecer a UN mismo subgrupo (o a la lista directa) de `group`. */
  tabs: HubTab[]
}

/** Entrada ya "plegada" para pintar en barra lateral, portal de grupo o buscador. */
export type EntradaMenu =
  | { tipo: "modulo"; modulo: Module }
  | { tipo: "hub"; hub: Hub; tabs: Module[] }

// ---------------------------------------------------------------------------
// Hubs por área. Se llenan por fases (piloto 2026-09-30: Operación LIP y
// Recepción y Despacho). Cada `module` es un `name` real de dashboard-data.
// ---------------------------------------------------------------------------
export const HUBS: Hub[] = [
  // ===== Operación LIP =====
  {
    key: "lip_dia",
    group: "lip",
    title: "Operación del día",
    icon: LayoutDashboard,
    tabs: [
      { module: "Operación del día", label: "Resumen del día" },
      { module: "Panel LIP Operación", label: "Tablero del coordinador" },
      { module: "Dashboard Operaciones LIP", label: "Dashboard de operaciones" },
      { module: "Bitácora", label: "Bitácora" },
    ],
  },
  {
    key: "lip_centro",
    group: "lip",
    title: "Centro de Coordinación",
    icon: LayoutGrid,
    tabs: [
      { module: "Centro de Coordinación", label: "Muelles y órdenes" },
      { module: "Picking", label: "Picking" },
      { module: "Packing", label: "Packing" },
      { module: "Ver Picking/Packing", label: "Historial" },
      { module: "Calificación del Conductor", label: "Calificar conductor" },
    ],
  },
  {
    key: "lip_personal",
    group: "lip",
    title: "Personal del día",
    icon: Users,
    tabs: [
      { module: "Programación de turnos", label: "Programación" },
      { module: "Registro de asistencia", label: "Registro de asistencia" },
      { module: "Aprobar Turnos", label: "Aprobar turnos" },
      { module: "Solicitud de Personal", label: "Solicitud de personal" },
      { module: "Notificaciones al Personal", label: "Notificaciones" },
    ],
  },
  {
    key: "lip_toneladas",
    group: "lip",
    title: "Toneladas y productividad",
    icon: Scale,
    tabs: [
      { module: "Control de Toneladas", label: "Control de toneladas" },
      { module: "Productividad de Auxiliares", label: "Productividad de auxiliares" },
    ],
  },
  {
    key: "lip_estibas",
    group: "lip",
    title: "Estibas QR",
    icon: QrCode,
    tabs: [
      { module: "Registro de QR estibas", label: "Registrar" },
      { module: "Lectura de QR estibas", label: "Leer" },
      { module: "Inventario por Estiba", label: "Inventario por estiba" },
    ],
  },
  // ===== Recepción y Despacho =====
  {
    key: "desp_ordenes",
    group: "despachos",
    title: "Órdenes",
    icon: Truck,
    tabs: [
      { module: "Generar Órdenes de Cargue", label: "Cargue" },
      { module: "Generar Órdenes de Descargue", label: "Descargue" },
      { module: "Generar Orden de Distribución", label: "Distribución" },
      { module: "Gestión de Ordenes", label: "Gestión de órdenes" },
    ],
  },
  {
    key: "desp_porteria",
    group: "despachos",
    title: "Portería y vehículos",
    icon: ClipboardCheck,
    tabs: [
      { module: "Registrar Vehículos", label: "Registrar" },
      { module: "Ver Vehículos", label: "Ver vehículos" },
      { module: "Registro sanitario", label: "Registro sanitario" },
      { module: "Ver historial de Inspección", label: "Historial de inspección" },
    ],
  },
  {
    key: "desp_bascula",
    group: "despachos",
    title: "Báscula",
    icon: Scale,
    tabs: [
      { module: "Báscula", label: "Pesar" },
      { module: "Historial Báscula", label: "Historial" },
    ],
  },
]

/** Etiqueta corta del área para barra lateral, miga de pan y buscador. */
export const ETIQUETA_GRUPO: Record<GroupKey, string> = {
  integral: "Torre de Control",
  pedidos: "Pedidos",
  despachos: "Recepción y Despacho",
  inventarios: "Almacenamiento",
  mrp: "MRP · Materiales",
  produccion: "Producción",
  lip: "Operación LIP",
  financiera: "Gestión Financiera",
  rrhh: "Gestión Humana",
  compensacion: "Compensación",
  certificaciones_lip: "Certificaciones · SIG",
  sst: "Seguridad y Salud (SST)",
  configuracion: "Configuración",
  aprendizaje: "Aprendizaje",
}

export function etiquetaDeGrupo(key: GroupKey | null | undefined): string {
  if (!key) return "Inicio"
  return ETIQUETA_GRUPO[key] ?? groups.find((g) => g.key === key)?.title ?? key
}

// ---------------------------------------------------------------------------
// Alias: nombres antiguos/huérfanos que aún pueden llegar por evento, LIPbot o
// URL. Se resuelven SOLO en los puntos de entrada (navigateToModule, URL,
// buscador); las ramas de main-content con el nombre viejo se conservan.
// ---------------------------------------------------------------------------
export const ALIAS_MODULO: Record<string, string> = {
  "Ver Picking": "Ver Picking/Packing",
  "Ver Solicitudes de traslado": "Recepción de Traslado",
}

export function resolverAlias(name: string): string {
  return ALIAS_MODULO[name] ?? name
}

// ---------------------------------------------------------------------------
// Índices derivados
// ---------------------------------------------------------------------------
export const HUB_POR_KEY: Map<string, Hub> = new Map(HUBS.map((h) => [h.key, h]))

/** `${group}|${module}` → hub. Un módulo puede estar en dos grupos (Satisfacción y PQRSF). */
const HUB_POR_GRUPO_MODULO: Map<string, Hub> = new Map()
for (const h of HUBS) for (const t of h.tabs) HUB_POR_GRUPO_MODULO.set(`${h.group}|${t.module}`, h)

export function esHubKey(s: string | null | undefined): boolean {
  return !!s && HUB_POR_KEY.has(s)
}

/** Hub que contiene al módulo dentro del grupo dado (o null si es un módulo suelto). */
export function hubDe(groupKey: GroupKey | null | undefined, moduleName: string | null | undefined): Hub | null {
  if (!groupKey || !moduleName) return null
  return HUB_POR_GRUPO_MODULO.get(`${groupKey}|${moduleName}`) ?? null
}

/** Primera pestaña del hub visible para el usuario, o null si ninguna. */
export function primeraTabVisible(hub: Hub, visible: (name: string) => boolean): string | null {
  return hub.tabs.find((t) => visible(t.module))?.module ?? null
}

/** Grupo que contiene al módulo (mismo recorrido que app/page.tsx y module-kpi-header). */
export function grupoDeModulo(moduleName: string): GroupKey | null {
  for (const g of groups) {
    if (g.modules?.some((m) => m.name === moduleName)) return g.key
    if (g.subgroups?.some((sg) => sg.modules.some((m) => m.name === moduleName))) return g.key
  }
  return null
}

/** Módulo hoja por nombre (busca en todos los grupos). */
export function moduloPorNombre(moduleName: string): Module | null {
  for (const g of groups) {
    const d = g.modules?.find((m) => m.name === moduleName)
    if (d) return d
    for (const sg of g.subgroups ?? []) {
      const s = sg.modules.find((m) => m.name === moduleName)
      if (s) return s
    }
  }
  return null
}

/** Texto que se pinta para un módulo (label si existe; si no, name). */
export function etiquetaDeModulo(moduleName: string): string {
  const m = moduloPorNombre(moduleName)
  return m?.label ?? m?.name ?? moduleName
}

/** Texto de la pestaña dentro de su hub (label de la pestaña > label del módulo > name). */
export function etiquetaDeTab(hub: Hub, moduleName: string): string {
  const t = hub.tabs.find((x) => x.module === moduleName)
  return t?.label ?? etiquetaDeModulo(moduleName)
}

/**
 * Convierte una lista de módulos YA filtrada por permisos (salida de
 * filterGroupsByPermissions o de visibleGroups del sidebar) en entradas de menú:
 * los módulos sueltos pasan tal cual; el primer módulo de un hub emite el hub con
 * SOLO sus pestañas presentes (en el orden declarado en el hub) y los demás
 * módulos de ese hub se omiten. Regla resultante: el hub se ve si al menos una
 * pestaña es visible; las pestañas sin permiso no aparecen.
 */
export function plegarEnHubs(groupKey: GroupKey, modules: Module[]): EntradaMenu[] {
  const presentes = new Map(modules.map((m) => [m.name, m]))
  const emitidos = new Set<string>()
  const out: EntradaMenu[] = []
  for (const m of modules) {
    const hub = HUB_POR_GRUPO_MODULO.get(`${groupKey}|${m.name}`)
    if (!hub) {
      out.push({ tipo: "modulo", modulo: m })
      continue
    }
    if (emitidos.has(hub.key)) continue
    emitidos.add(hub.key)
    const tabs = hub.tabs.map((t) => presentes.get(t.module)).filter((x): x is Module => !!x)
    out.push({ tipo: "hub", hub, tabs })
  }
  return out
}

/** Color de dominio por grupo (una sola paleta para Inicio, portal, barra y buscador). */
export const TINT_GRUPO: Record<string, string> = {
  integral: "#5b6b7f",
  pedidos: "#4f63c4",
  despachos: "#1f8fb0",
  inventarios: "#0e9c9c",
  mrp: "#b5852a",
  produccion: "#c56a2a",
  lip: "#7b57c9",
  financiera: "#2f9b64",
  rrhh: "#c65893",
  compensacion: "#c9a227",
  certificaciones_lip: "#c8492f",
  sst: "#d84a3e",
  configuracion: "#6b7683",
  aprendizaje: "#3b7dd8",
}

/**
 * Validación en desarrollo: cada pestaña debe existir en `groups[hub.group]`
 * dentro de un solo subgrupo (o la lista directa), un módulo no puede estar en
 * dos hubs del mismo grupo y las claves de hub deben ser únicas. Devuelve la
 * lista de problemas (vacía = todo bien).
 */
export function validarHubs(): string[] {
  const problemas: string[] = []
  const claves = new Set<string>()
  for (const h of HUBS) {
    if (claves.has(h.key)) problemas.push(`Hub duplicado: ${h.key}`)
    claves.add(h.key)
    const g = groups.find((x) => x.key === h.group)
    if (!g) {
      problemas.push(`Hub ${h.key}: grupo inexistente ${h.group}`)
      continue
    }
    const contenedores = new Set<string>()
    for (const t of h.tabs) {
      let hallado = false
      if (g.modules?.some((m) => m.name === t.module)) {
        hallado = true
        contenedores.add("(directo)")
      }
      for (const sg of g.subgroups ?? []) {
        if (sg.modules.some((m) => m.name === t.module)) {
          hallado = true
          contenedores.add(sg.title)
        }
      }
      if (!hallado) problemas.push(`Hub ${h.key}: la pestaña "${t.module}" no existe en el grupo ${h.group}`)
    }
    if (contenedores.size > 1) problemas.push(`Hub ${h.key}: pestañas en varios subgrupos (${[...contenedores].join(", ")})`)
  }
  const vistos = new Set<string>()
  for (const h of HUBS)
    for (const t of h.tabs) {
      const k = `${h.group}|${t.module}`
      if (vistos.has(k)) problemas.push(`"${t.module}" está en dos hubs del grupo ${h.group}`)
      vistos.add(k)
    }
  return problemas
}

if (process.env.NODE_ENV !== "production") {
  const p = validarHubs()
  if (p.length) console.error("[navegacion] hubs inválidos:\n  " + p.join("\n  "))
}
