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
import {
  Activity,
  ArrowRightLeft,
  BarChart3,
  ClipboardCheck,
  FileCheck,
  LayoutDashboard,
  LayoutGrid,
  Package,
  PackagePlus,
  QrCode,
  Scale,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"

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
  /** Color propio de la pantalla (barra de pestañas, tarjeta, ícono). Si falta, se asigna de la paleta. */
  color?: string
  /** Una frase: para qué sirve la pantalla (portal de área y buscador). */
  descripcion?: string
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
    color: "#0d9488",
    descripcion: "Cómo va el día en la planta: personal, pendientes, vehículos, toneladas y cierre.",
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
    color: "#2563eb",
    descripcion: "Muelles en vivo, asignar personal e iniciar y cerrar cada vehículo.",
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
    color: "#db2777",
    descripcion: "Programar turnos, registrar asistencia, aprobar turnos y pedir personal.",
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
    color: "#d97706",
    descripcion: "Quién carga de verdad: toneladas por auxiliar, ranking y real contra pagado.",
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
    color: "#7c3aed",
    descripcion: "Etiquetar, leer y consultar estibas por código QR.",
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
    color: "#2563eb",
    descripcion: "Crear órdenes de cargue, descargue y distribución, y gestionarlas.",
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
    color: "#059669",
    descripcion: "Citas y llegada de vehículos, inspección sanitaria y su historial.",
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
    color: "#d97706",
    descripcion: "Pesar vehículos y revisar el historial de pesajes.",
    tabs: [
      { module: "Báscula", label: "Pesar" },
      { module: "Historial Báscula", label: "Historial" },
    ],
  },
  // ===== Pedidos y solicitudes (Fase 4) =====
  {
    key: "ped_pedidos",
    group: "pedidos",
    title: "Pedidos",
    icon: PackagePlus,
    color: "#2563eb",
    descripcion: "Registrar los pedidos del cliente, gestionarlos y ver su cumplimiento.",
    tabs: [
      { module: "Entrada de pedidos", label: "Entrada" },
      { module: "Gestionar pedidos", label: "Gestionar" },
      { module: "Dashboard Pedidos", label: "Dashboard" },
    ],
  },
  // ===== Almacenamiento (Fase 4) =====
  {
    key: "inv_movimientos",
    group: "inventarios",
    title: "Movimientos",
    icon: ArrowRightLeft,
    color: "#0d9488",
    descripcion: "Entradas, salidas, traslados y correcciones de inventario por código.",
    tabs: [
      { module: "Transacciones de Inventario", label: "Transacciones" },
      { module: "Gestión de transacciones", label: "Gestión" },
      { module: "Traslados de producto", label: "Traslados" },
    ],
  },
  {
    key: "inv_saldos",
    group: "inventarios",
    title: "Saldos",
    icon: BarChart3,
    color: "#2563eb",
    descripcion: "Qué hay en bodega: por lote, por producto y ocupación de las localizaciones.",
    tabs: [
      { module: "Saldos de inventario", label: "Por lote" },
      { module: "Saldos por producto", label: "Por producto" },
      { module: "Capacidad Bodega", label: "Capacidad de bodega" },
    ],
  },
  {
    key: "inv_exactitud",
    group: "inventarios",
    title: "Exactitud y cierre",
    icon: ClipboardCheck,
    color: "#d97706",
    descripcion: "Exactitud del inventario, cuadre de cierre mensual y auditoría.",
    tabs: [
      { module: "Panel LIP Inventario", label: "Exactitud" },
      { module: "Cuadre de Inventario", label: "Cuadre mensual" },
      { module: "Auditoría de Inventario", label: "Auditoría" },
    ],
  },
  {
    key: "inv_lotes",
    group: "inventarios",
    title: "Lotes",
    icon: FileCheck,
    color: "#7c3aed",
    descripcion: "Asignar lotes a las órdenes de cargue y consultar el historial.",
    tabs: [
      { module: "Asignación de Lotes", label: "Asignar" },
      { module: "Historial de lotes", label: "Historial" },
    ],
  },
  // ===== Producción (Fase 4) =====
  {
    key: "prod_ingresos",
    group: "produccion",
    title: "Ingresos de producción",
    icon: PackagePlus,
    color: "#059669",
    descripcion: "Registrar lo producido, revisarlo, aprobarlo y ver el historial.",
    tabs: [
      { module: "Ingreso de Producción", label: "Registrar" },
      { module: "Ver ingresos de producción", label: "Ver ingresos" },
      { module: "Aprobación de ingreso de producción", label: "Aprobar" },
      { module: "Historial Aprobaciones", label: "Historial" },
    ],
  },
  {
    key: "prod_tolva",
    group: "produccion",
    title: "Tolva",
    icon: Wallet,
    color: "#d97706",
    descripcion: "Liquidar la tolva del día y consultar sus órdenes.",
    tabs: [
      { module: "Liquidación Tolva del día", label: "Liquidación del día" },
      { module: "Tolva", label: "Orden de tolva" },
      { module: "Ver Tolva", label: "Ver tolva" },
    ],
  },
  {
    key: "prod_piso",
    group: "produccion",
    title: "Control de piso",
    icon: Activity,
    color: "#dc2626",
    descripcion: "Ritmo de producción en vivo y registro de paros.",
    tabs: [
      { module: "Dashboard de Producción", label: "Dashboard" },
      { module: "Reporte de Paros", label: "Paros" },
    ],
  },
]

/** Etiqueta corta del área para barra lateral, miga de pan y buscador. */
export const ETIQUETA_GRUPO: Record<GroupKey, string> = {
  integral: "Torre de Control",
  pedidos: "Pedidos y solicitudes",
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

// ---------------------------------------------------------------------------
// Color por ENTRADA (pantalla/módulo), distinto entre vecinas de la misma área
// (gerencia 2026-09-30: "deben tener color diferente para que sepan que son
// diferentes"). Se asigna sobre la lista COMPLETA del área (sin filtrar por
// permisos) para que sea estable entre usuarios y pantallas; los hubs pueden
// fijar el suyo con `color`.
// ---------------------------------------------------------------------------
export const PALETA_ENTRADAS = [
  "#2563eb", "#0d9488", "#d97706", "#7c3aed", "#dc2626", "#059669", "#db2777",
  "#0891b2", "#ea580c", "#4f46e5", "#65a30d", "#9333ea", "#b45309", "#0284c7",
]

const COLOR_POR_ENTRADA: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const g of groups) {
    const listas = [...(g.modules ? [g.modules] : []), ...(g.subgroups ?? []).map((s) => s.modules)]
    const entradas = listas.flatMap((lista) => plegarEnHubs(g.key, lista))
    // 1) Los hubs con color fijo lo reservan primero, para que ningún módulo
    //    de la misma área reciba ese mismo color de la paleta.
    const usados = new Set<string>()
    for (const e of entradas) if (e.tipo === "hub" && e.hub.color) usados.add(e.hub.color)
    // 2) El resto toma, en orden, el primer color de la paleta aún libre en el
    //    área; si el área tiene más entradas que colores, se reinicia.
    let cursor = 0
    const siguienteLibre = () => {
      for (let k = 0; k < PALETA_ENTRADAS.length; k++) {
        const c = PALETA_ENTRADAS[(cursor + k) % PALETA_ENTRADAS.length]
        if (!usados.has(c)) {
          cursor = (cursor + k + 1) % PALETA_ENTRADAS.length
          usados.add(c)
          if (usados.size >= PALETA_ENTRADAS.length) usados.clear()
          return c
        }
      }
      usados.clear()
      return PALETA_ENTRADAS[cursor++ % PALETA_ENTRADAS.length]
    }
    for (const e of entradas) {
      if (e.tipo === "hub") m.set(`${g.key}|hub:${e.hub.key}`, e.hub.color ?? siguienteLibre())
      else m.set(`${g.key}|mod:${e.modulo.name}`, siguienteLibre())
    }
  }
  return m
})()

/** Color de un hub o módulo dentro de su área (cae al color del área si no está). */
export function colorDeEntrada(groupKey: GroupKey, entrada: { hubKey?: string; modulo?: string }): string {
  const k = entrada.hubKey ? `${groupKey}|hub:${entrada.hubKey}` : `${groupKey}|mod:${entrada.modulo ?? ""}`
  return COLOR_POR_ENTRADA.get(k) ?? TINT_GRUPO[groupKey] ?? "#0e9c9c"
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
