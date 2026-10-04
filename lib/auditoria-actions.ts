"use server"

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import type { AuditoriaFiltro, AuditoriaResumenFila, AuditoriaRow } from "@/lib/auditoria-types"

const MODULO = "Bitácora de Auditoría"
/** Colombia no tiene horario de verano: el día de la bitácora es fijo a UTC-5. */
const TZ_OFFSET = "-05:00"
const tsDesde = (d: string) => `${d}T00:00:00.000${TZ_OFFSET}`
const tsHasta = (d: string) => `${d}T23:59:59.999${TZ_OFFSET}`

// Sanea el término de búsqueda para el filtro `.or()` de PostgREST (donde `,`,
// `(`, `)` y `*` son sintaxis). Deja solo el texto a buscar.
function saneaBusqueda(s: string): string {
  return s.replace(/[,()*%]/g, " ").trim()
}

function aplicarFiltros(q: any, f: AuditoriaFiltro) {
  if (f.desde) q = q.gte("ts", tsDesde(f.desde))
  if (f.hasta) q = q.lte("ts", tsHasta(f.hasta))
  if (f.idempresa) q = q.eq("idempresa", f.idempresa)
  if (f.actorId) q = f.actorId === "__sistema__" ? q.is("actor_id", null) : q.eq("actor_id", f.actorId)
  if (f.modulo) q = q.eq("modulo", f.modulo)
  if (f.tabla) q = q.eq("tabla", f.tabla)
  if (f.operacion) q = q.eq("operacion", f.operacion)
  if (f.busqueda) {
    const b = saneaBusqueda(f.busqueda)
    if (b) q = q.or(`descripcion.ilike.*${b}*,registro_id.ilike.*${b}*,actor_nombre.ilike.*${b}*,tabla.ilike.*${b}*`)
  }
  return q
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
    q = aplicarFiltros(q, f)
    q = q.range(page * size, page * size + size - 1)

    const { data, count, error } = await q
    if (error) return { rows: [], total: 0, error: error.message }
    return { rows: (data ?? []) as AuditoriaRow[], total: count ?? 0 }
  } catch (err: any) {
    return { rows: [], total: 0, error: err?.message || "Error" }
  }
}

/**
 * Resumen "quién hizo qué": conteo por usuario × módulo × tabla × acción con
 * los mismos filtros de la pantalla. Usa la función SQL `auditoria_resumen`
 * (scripts/208_auditoria_resumen.sql); si aún no existe, agrega en servidor
 * leyendo por páginas de 1.000 (tope de PostgREST) hasta `TOPE_FALLBACK` filas.
 */
const TOPE_FALLBACK = 20000
export async function getAuditoriaResumen(
  f: AuditoriaFiltro,
): Promise<{ filas: AuditoriaResumenFila[]; parcial: boolean; error?: string }> {
  try {
    if (!(await checkModulePermission(MODULO))) return { filas: [], parcial: false, error: "No autorizado" }
    const sb = await getSupabaseAdminAsSystem()
    const b = f.busqueda ? saneaBusqueda(f.busqueda) : ""
    const rpc = await sb.rpc("auditoria_resumen", {
      p_desde: f.desde ? tsDesde(f.desde) : null,
      p_hasta: f.hasta ? tsHasta(f.hasta) : null,
      p_idempresa: f.idempresa ?? null,
      p_actor_id: f.actorId && f.actorId !== "__sistema__" ? f.actorId : null,
      p_solo_sistema: f.actorId === "__sistema__",
      p_modulo: f.modulo ?? null,
      p_operacion: f.operacion ?? null,
      p_busqueda: b || null,
    })
    if (!rpc.error) {
      const filas = ((rpc.data ?? []) as any[]).map((r) => ({ ...r, n: Number(r.n) })) as AuditoriaResumenFila[]
      // PostgREST corta la respuesta del RPC en 1.000 filas: con filtros
      // normales hay decenas de grupos, pero sin ningún filtro puede superarlo.
      return { filas, parcial: filas.length >= 1000 }
    }
    // Función ausente (PGRST202) → agregación en servidor. Cualquier otro error
    // (p. ej. statement timeout) se informa: repetir la lectura completa sería
    // igual de lento.
    if (rpc.error.code !== "PGRST202" && !/could not find the function/i.test(rpc.error.message)) {
      return { filas: [], parcial: false, error: rpc.error.message }
    }

    // Fallback sin la función SQL: agregación en servidor por páginas.
    const acc = new Map<string, AuditoriaResumenFila>()
    let leidas = 0
    let parcial = false
    for (let from = 0; ; from += 1000) {
      let q = sb.from("auditoria").select("actor_id, actor_nombre, idempresa, modulo, tabla, operacion, ts").order("ts").order("id")
      q = aplicarFiltros(q, f).range(from, from + 999)
      const { data, error } = await q
      if (error) return { filas: [], parcial: false, error: error.message }
      for (const r of (data ?? []) as any[]) {
        const modulo = r.modulo || r.tabla
        const k = `${r.actor_id ?? ""}|${r.actor_nombre}|${r.idempresa ?? ""}|${modulo}|${r.tabla}|${r.operacion}`
        const fila = acc.get(k)
        if (fila) {
          fila.n += 1
          if (r.ts < fila.primero) fila.primero = r.ts
          if (r.ts > fila.ultimo) fila.ultimo = r.ts
        } else {
          acc.set(k, { actor_id: r.actor_id, actor_nombre: r.actor_nombre, idempresa: r.idempresa, modulo, tabla: r.tabla, operacion: r.operacion, n: 1, primero: r.ts, ultimo: r.ts })
        }
      }
      leidas += data?.length ?? 0
      if (!data || data.length < 1000) break
      if (leidas >= TOPE_FALLBACK) {
        parcial = true
        break
      }
    }
    const filas = [...acc.values()].sort((a, b2) => a.actor_nombre.localeCompare(b2.actor_nombre) || a.modulo.localeCompare(b2.modulo) || a.operacion.localeCompare(b2.operacion))
    return { filas, parcial }
  } catch (err: any) {
    return { filas: [], parcial: false, error: err?.message || "Error" }
  }
}

/** Filas completas para exportar a Excel (paginado con orden único; tope 5.000). */
const TOPE_EXPORT = 5000
export async function getAuditoriaExport(
  f: AuditoriaFiltro,
): Promise<{ rows: AuditoriaRow[]; truncado: boolean; error?: string }> {
  try {
    if (!(await checkModulePermission(MODULO))) return { rows: [], truncado: false, error: "No autorizado" }
    const sb = await getSupabaseAdminAsSystem()
    const rows: AuditoriaRow[] = []
    for (let from = 0; from < TOPE_EXPORT; from += 1000) {
      let q = sb.from("auditoria").select("*").order("ts", { ascending: false }).order("id", { ascending: false })
      q = aplicarFiltros(q, f).range(from, Math.min(from + 999, TOPE_EXPORT - 1))
      const { data, error } = await q
      if (error) return { rows: [], truncado: false, error: error.message }
      rows.push(...((data ?? []) as AuditoriaRow[]))
      if (!data || data.length < 1000) return { rows, truncado: false }
    }
    return { rows, truncado: true }
  } catch (err: any) {
    return { rows: [], truncado: false, error: err?.message || "Error" }
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
