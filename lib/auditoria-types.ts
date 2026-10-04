// Tipos de la Bitácora de Auditoría (fuera de "use server" para exportarlos).

export interface AuditoriaFiltro {
  desde?: string // ISO date (YYYY-MM-DD), día Bogotá
  hasta?: string
  /** Proyecto (selector global). undefined = todos. */
  idempresa?: number
  actorId?: string
  modulo?: string
  tabla?: string
  operacion?: "INSERT" | "UPDATE" | "DELETE"
  busqueda?: string
  page?: number // 0-based
  pageSize?: number // default 50, máx 200
}

export interface AuditoriaRow {
  id: number
  ts: string
  actor_id: string | null
  actor_nombre: string
  idempresa: number | null
  modulo: string | null
  tabla: string
  operacion: "INSERT" | "UPDATE" | "DELETE" | string
  registro_id: string | null
  descripcion: string | null
  antes: Record<string, any> | null
  despues: Record<string, any> | null
  campos_cambiados: string[] | null
}

/** Una fila del resumen "quién hizo qué" (usuario × módulo × tabla × acción). */
export interface AuditoriaResumenFila {
  actor_id: string | null
  actor_nombre: string
  idempresa: number | null
  modulo: string
  tabla: string
  operacion: string
  n: number
  primero: string
  ultimo: string
}

// Diff campo-a-campo para el modal (calculado en cliente desde antes/después).
export interface DiffCampo {
  campo: string
  antes: any
  despues: any
  estado: "igual" | "cambiado" | "agregado" | "eliminado"
}

export function calcularDiff(
  antes: Record<string, any> | null,
  despues: Record<string, any> | null,
  cambiados?: string[] | null,
): DiffCampo[] {
  const a = antes || {}
  const d = despues || {}
  const claves = Array.from(new Set([...Object.keys(a), ...Object.keys(d)])).sort()
  const setCambiados = cambiados ? new Set(cambiados) : null
  return claves.map((campo) => {
    const enA = campo in a
    const enD = campo in d
    const vA = a[campo]
    const vD = d[campo]
    let estado: DiffCampo["estado"] = "igual"
    if (enA && !enD) estado = "eliminado"
    else if (!enA && enD) estado = "agregado"
    else if (JSON.stringify(vA) !== JSON.stringify(vD)) estado = "cambiado"
    // Si el trigger marcó campos_cambiados, respétalo para el resaltado.
    if (setCambiados && setCambiados.has(campo) && estado === "igual") estado = "cambiado"
    return { campo, antes: vA, despues: vD, estado }
  })
}

// ---------------------------------------------------------------------------
// Lectura humana de una fila: a quién/qué registro tocó y qué cambió.
// ---------------------------------------------------------------------------

/** Campos que identifican el registro en las tablas del repo, en orden de preferencia. */
const CAMPOS_NOMBRE = [
  "nombre", "persona", "nombrecompleto", "nombre_completo", "auxiliar", "usuario", "correo",
  "ordendecargue", "numeroorden", "orden", "numero", "placa", "producto", "titulo", "descripcion",
  "codigo", "cliente", "empresa", "consecutivo",
]

/** Campos de sello de tiempo que no aportan al lector. */
const CAMPOS_RUIDO = new Set(["updated_at", "created_at", "actualizado_en", "modificado_en", "creado", "creado_en", "aprobado_en"])

/** Campos informativos para resumir un INSERT/DELETE (los que existan y no sean nulos). */
const CAMPOS_CLAVE = [
  "fecha", "fechacargue", "fechaorden", "puesto", "asistencia", "turno", "estado", "tipooperacion", "tipo",
  "placa", "cantidad", "toneladas", "peso", "pesovascula", "valor", "valor_ajuste", "valor_pagado", "quincena", "mes",
  "anio", "hed", "hen", "horasturno", "novedad", "motivo", "observacion", "codigo", "lote", "ubicacion",
]

export function valorCorto(v: any, max = 40): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "boolean") return v ? "sí" : "no"
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  let s = typeof v === "object" ? JSON.stringify(v) : String(v)
  if (/^https?:\/\//.test(s)) s = "(archivo)"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    try {
      s = new Date(s).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    } catch {}
  }
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

/** Nombre legible del registro afectado (persona, orden, placa…) o el id. */
export function nombreRegistro(r: Pick<AuditoriaRow, "antes" | "despues" | "registro_id">): string {
  const reg = r.despues ?? r.antes ?? {}
  for (const k of CAMPOS_NOMBRE) {
    const v = reg[k]
    if (typeof v === "string" && v.trim()) return v.trim()
    if (typeof v === "number" && k !== "codigo") return String(v)
  }
  return r.registro_id ? `#${r.registro_id}` : ""
}

/** Lista compacta "campo: antes → después" (UPDATE) o "campo=valor" (INSERT/DELETE). */
export function cambiosCompactos(r: Pick<AuditoriaRow, "operacion" | "antes" | "despues" | "campos_cambiados">, max = 4): string[] {
  if (r.operacion === "UPDATE") {
    const campos = (r.campos_cambiados ?? []).filter((c) => !CAMPOS_RUIDO.has(c))
    return campos.slice(0, max).map((c) => `${c}: ${valorCorto(r.antes?.[c])} → ${valorCorto(r.despues?.[c])}`).concat(campos.length > max ? [`+${campos.length - max} más`] : [])
  }
  const reg = r.operacion === "DELETE" ? r.antes : r.despues
  if (!reg) return []
  const out: string[] = []
  for (const k of CAMPOS_CLAVE) {
    if (out.length >= max) break
    const v = reg[k]
    if (v === null || v === undefined || v === "" || v === 0 || v === false) continue
    if (k === "asistencia" && typeof v === "string" && /^(true|false)$/i.test(v)) continue
    out.push(`${k}=${valorCorto(v, 30)}`)
  }
  return out
}
