"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { autorizarAccion } from "@/lib/puerta-modulo"

// Metadatos por tabla de tarifas: PK, columnas de vigencia (varían por tabla),
// columna de empresa (para filtrar el listado) y una etiqueta legible.
const TARIFA_META: Record<
  string,
  { pk: string; ini: string; fin: string; empresaCol?: string; etiqueta: (r: any) => string }
> = {
  tarifasoperacion: {
    pk: "id",
    ini: "fechainicio",
    fin: "fechafin",
    empresaCol: "empresaid",
    etiqueta: (r) => `${r.operacion || "—"}${r.producto ? ` · ${r.producto}` : ""} · $${r.tarifa ?? ""}`,
  },
  tarifaspersonal: {
    pk: "id",
    ini: "fechaini",
    fin: "fechafin",
    empresaCol: "empresaid",
    etiqueta: (r) => `${r.operacion || "—"} · $${r.tarifa ?? ""}`,
  },
  tarifasturnos: {
    pk: "id",
    ini: "fechaini",
    fin: "fechafin",
    empresaCol: "idempresa",
    etiqueta: (r) => `${r.puesto || "—"} · base $${r.base ?? ""}`,
  },
  tarifasfacturacionturnos: {
    pk: "id",
    ini: "fechainicio",
    fin: "fechafin",
    // Global: no se filtra por empresa (su idempresa está casi sin asignar).
    etiqueta: (r) => `${r.puesto || "—"} · turno $${r.tarifaturno ?? ""}`,
  },
}

export interface TarifaItem {
  id: number | string
  etiqueta: string
  fechaIni: string | null
  fechaFin: string | null
}

// Lista las tarifas de una tabla (para el selector de duplicación), filtradas
// por empresa cuando corresponde.
export async function listarTarifas(
  tableName: string,
  empresaId?: number | null,
): Promise<{ success: boolean; data: TarifaItem[]; message?: string }> {
  const m = TARIFA_META[tableName]
  if (!m) return { success: false, data: [], message: "Tabla de tarifas no soportada." }
  try {
    const admin: any = await getSupabaseAdmin()
    let q = admin.from(tableName).select("*").order(m.pk, { ascending: true }).limit(2000)
    if (m.empresaCol && empresaId) q = q.eq(m.empresaCol, empresaId)
    const { data, error } = await q
    if (error) return { success: false, data: [], message: error.message }
    const items: TarifaItem[] = (data || []).map((r: any) => ({
      id: r[m.pk],
      etiqueta: m.etiqueta(r),
      fechaIni: r[m.ini] ?? null,
      fechaFin: r[m.fin] ?? null,
    }))
    return { success: true, data: items }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al listar tarifas." }
  }
}

// Duplica las tarifas seleccionadas con un NUEVO rango de vigencia. Copia todas
// las columnas salvo la PK (se autogenera) y reemplaza las fechas de vigencia.
// No modifica las originales. Conserva la empresa de cada tarifa.
export async function duplicarTarifas(params: {
  tableName: string
  ids: (number | string)[]
  nuevaFechaIni: string
  nuevaFechaFin: string
},
  clave?: string,
): Promise<{ success: boolean; creadas?: number; message?: string }> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Tarifas", "configurar", { clave: clave ?? "", idempresa: null, referencia: `duplicar tarifas ${params?.tableName}` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  const m = TARIFA_META[params.tableName]
  if (!m) return { success: false, message: "Tabla de tarifas no soportada." }
  if (!params.ids?.length) return { success: false, message: "Selecciona al menos una tarifa." }
  if (!params.nuevaFechaIni || !params.nuevaFechaFin)
    return { success: false, message: "Indica el nuevo rango de fechas." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { data: rows, error } = await admin.from(params.tableName).select("*").in(m.pk, params.ids)
    if (error) return { success: false, message: error.message }
    if (!rows?.length) return { success: false, message: "No se encontraron las tarifas seleccionadas." }
    const nuevos = rows.map((r: any) => {
      const copia: any = { ...r }
      delete copia[m.pk]
      copia[m.ini] = params.nuevaFechaIni
      copia[m.fin] = params.nuevaFechaFin
      return copia
    })
    const { error: insErr } = await admin.from(params.tableName).insert(nuevos)
    if (insErr) return { success: false, message: insErr.message }
    return { success: true, creadas: nuevos.length }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al duplicar." }
  }
}
