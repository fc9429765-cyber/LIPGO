"use server"

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import type { AuditoriaFiltro, AuditoriaRow } from "@/lib/auditoria-types"

const MODULO = "Bitácora de Auditoría"

// Sanea el término de búsqueda para el filtro `.or()` de PostgREST (donde `,`,
// `(`, `)` y `*` son sintaxis). Deja solo el texto a buscar.
function saneaBusqueda(s: string): string {
  return s.replace(/[,()*%]/g, " ").trim()
}

export async function getAuditoria(
  f: AuditoriaFiltro,
): Promise<{ rows: AuditoriaRow[]; total: number; error?: string }> {
  try {
    if (!(await checkModulePermission(MODULO))) return { rows: [], total: 0, error: "No autorizado" }
    const sb = await getSupabaseAdminAsSystem()
    const page = Math.max(0, f.page ?? 0)
    const size = Math.min(200, Math.max(1, f.pageSize ?? 50))

    // `id` como desempate: varios eventos pueden compartir `ts` y sin llave única
    // la paginación puede repetir/perder filas (ver lib/orden-paginacion.ts).
    let q = sb
      .from("auditoria")
      .select("*", { count: "exact" })
      .order("ts", { ascending: false })
      .order("id", { ascending: false })
    if (f.desde) q = q.gte("ts", f.desde)
    if (f.hasta) q = q.lte("ts", `${f.hasta}T23:59:59.999`)
    if (f.actorId) q = f.actorId === "__sistema__" ? q.is("actor_id", null) : q.eq("actor_id", f.actorId)
    if (f.modulo) q = q.eq("modulo", f.modulo)
    if (f.tabla) q = q.eq("tabla", f.tabla)
    if (f.operacion) q = q.eq("operacion", f.operacion)
    if (f.busqueda) {
      const b = saneaBusqueda(f.busqueda)
      if (b) q = q.or(`descripcion.ilike.*${b}*,registro_id.ilike.*${b}*,actor_nombre.ilike.*${b}*,tabla.ilike.*${b}*`)
    }
    q = q.range(page * size, page * size + size - 1)

    const { data, count, error } = await q
    if (error) return { rows: [], total: 0, error: error.message }
    return { rows: (data ?? []) as AuditoriaRow[], total: count ?? 0 }
  } catch (err: any) {
    return { rows: [], total: 0, error: err?.message || "Error" }
  }
}

// Usuarios para el desplegable del filtro (todos los perfiles + 'sistema').
export async function getAuditoriaActores(): Promise<{ id: string; usuario: string }[]> {
  try {
    if (!(await checkModulePermission(MODULO))) return []
    const sb = await getSupabaseAdminAsSystem()
    const { data } = await sb.from("profiles").select("id, usuario").order("usuario", { ascending: true })
    const lista = (data ?? []).map((p: any) => ({ id: p.id as string, usuario: p.usuario as string }))
    return [{ id: "__sistema__", usuario: "Sistema / automático" }, ...lista]
  } catch {
    return []
  }
}

// Módulos presentes (catálogo + los que ya aparecen en la bitácora).
export async function getAuditoriaModulos(): Promise<string[]> {
  try {
    if (!(await checkModulePermission(MODULO))) return []
    const sb = await getSupabaseAdminAsSystem()
    // Módulos usados = DISTINCT server-side vía vista (auditoria_modulos_usados);
    // evita el tope de 1000 filas de PostgREST (un `.limit(2000)` igual se corta en
    // 1000 y omitiría módulos usados recientes). Si la vista aún no existe, cae a un
    // muestreo acotado para no romper el desplegable.
    const [{ data: cat }, distinctRes] = await Promise.all([
      sb.from("auditoria_modulos").select("modulo"),
      sb.from("auditoria_modulos_usados").select("modulo"),
    ])
    let usados = distinctRes.data as { modulo: string }[] | null
    if (distinctRes.error || !usados) {
      const { data: sample } = await sb.from("auditoria").select("modulo").not("modulo", "is", null).limit(1000)
      usados = (sample as any) ?? []
    }
    const set = new Set<string>()
    for (const r of cat ?? []) if (r.modulo) set.add(r.modulo)
    for (const r of usados ?? []) if (r.modulo) set.add(r.modulo)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}
