// EL ÁRBOL DE PERMISOS QUE DIBUJAN LAS PANTALLAS
//
// Se construye desde `groups` (el menú) y MODULE_PERMISSION_MAP, así que la
// pantalla refleja SIEMPRE los mismos grupos, subgrupos y módulos que ve el
// usuario en el sidebar, sin listas paralelas que se desincronicen.
//
// Vivía dentro de components/configuration/user-permissions-management.tsx.
// Se saca aquí porque ahora lo dibujan DOS pantallas --Gestión de Usuarios y
// Perfiles de acceso-- y un árbol duplicado es la clase de cosa que se
// desincroniza en silencio.

import { groups } from "@/lib/dashboard-data"
import { MODULE_PERMISSION_MAP, type UserPermissions } from "@/lib/permissions-map"
import { EXTRA_PERMS_POR_SUBGRUPO } from "@/lib/permisos-claves"
import { accionesPorClave, procesosPorClave, type AccionDeClave, type ProcesoDeClave } from "@/lib/politicas-modulos"

const ACCIONES = accionesPorClave()
const PROCESOS = procesosPorClave()

export type PermItem = {
  key: keyof UserPermissions
  label: string
  /** Acciones silenciosas de la llave (columnas `<llave>__<verbo>`), unión de las pantallas que la comparten. */
  acciones: AccionDeClave[]
  /** Acciones con clave de la llave (se otorgan como procesos en Autoriza). */
  conClave: ProcesoDeClave[]
}
export type PermSection = { title: string | null; permissions: PermItem[] }
export type PermGroup = { title: string; sections: PermSection[] }

function collectPerms(modules: { name: string; label?: string }[]): PermItem[] {
  const seen = new Set<string>()
  const out: PermItem[] = []
  for (const m of modules) {
    const key = MODULE_PERMISSION_MAP[m.name] as keyof UserPermissions | undefined
    if (!key) continue
    if (seen.has(key as string)) continue
    seen.add(key as string)
    out.push({ key, label: m.label ?? m.name, acciones: ACCIONES.get(key as string) ?? [], conClave: PROCESOS.get(key as string) ?? [] })
  }
  return out
}

export const PERMISSION_TREE: PermGroup[] = groups
  .map((g) => {
    const sections: PermSection[] = []
    if (g.modules?.length) {
      const perms = collectPerms(g.modules)
      if (perms.length) sections.push({ title: null, permissions: perms })
    }
    for (const sg of g.subgroups ?? []) {
      const extra: PermItem[] = (EXTRA_PERMS_POR_SUBGRUPO[sg.title] ?? []).map((x) => ({
        key: x.key as keyof UserPermissions,
        label: x.label,
        acciones: [],
        conClave: [],
      }))
      const perms = [...collectPerms(sg.modules), ...extra]
      if (perms.length) sections.push({ title: sg.title, permissions: perms })
    }
    return { title: g.title, sections }
  })
  .filter((g) => g.sections.length > 0)

/** Las claves del árbol, planas y en el orden en que se dibujan. Con `conAcciones`, cada módulo va seguido de sus acciones. */
export function clavesDelArbol(opts?: { conAcciones?: boolean }): string[] {
  return PERMISSION_TREE.flatMap((g) =>
    g.sections.flatMap((s) => s.permissions.flatMap((p) => clavesDeItem(p, opts?.conAcciones === true))),
  )
}

/** La llave del módulo y, si se pide, sus claves de acción. */
export function clavesDeItem(p: PermItem, conAcciones: boolean): string[] {
  return conAcciones ? [p.key as string, ...p.acciones.map((a) => a.key)] : [p.key as string]
}

/**
 * Filtra el árbol por texto: coincide con la etiqueta del permiso, el título
 * del subgrupo o el del grupo. Devuelve el mismo árbol si no hay búsqueda.
 */
export function filtrarArbol(q: string): PermGroup[] {
  const t = q.trim().toLowerCase()
  if (!t) return PERMISSION_TREE
  return PERMISSION_TREE.map((g) => {
    const sections = g.sections
      .map((s) => ({
        ...s,
        permissions: s.permissions.filter(
          (p) =>
            p.label.toLowerCase().includes(t) ||
            (s.title ?? "").toLowerCase().includes(t) ||
            g.title.toLowerCase().includes(t) ||
            p.acciones.some((a) => a.label.toLowerCase().includes(t)) ||
            p.conClave.some((c) => c.label.toLowerCase().includes(t)),
        ),
      }))
      .filter((s) => s.permissions.length > 0)
    return { ...g, sections }
  }).filter((g) => g.sections.length > 0)
}
