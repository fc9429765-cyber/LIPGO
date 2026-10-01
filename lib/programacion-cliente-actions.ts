"use server"

// PROGRAMACIÓN DEL CLIENTE — server actions.
//
// El cliente (o el coordinador LIP por él) registra, antes de las 5:00 p. m.,
// la programación de vehículos de MAÑANA: cantidad · tipo de vehículo · destino
// o ruta (· producto). Cada envío es una VERSIÓN; la última es la vigente.
// El cumplimiento cruza la versión vigente de cada día contra los vehículos
// que llegaron a portería ese día (citasvehiculos.fechallegada), por tipo de
// vehículo (decisión de gerencia 2026-10-01: por tipo, sin destino, porque el
// destino no se registra en portería).
//
// Seguridad: se verifica que la empresa pedida esté entre las accesibles del
// usuario (perfil_acceso_empresas, igual que buscar-registros). Nada financiero.
// Tabla y permiso: scripts/211_programacion_cliente.sql.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUser, getUserProfile } from "@/lib/auth-actions"
import { HORA_LIMITE, type CatalogosProgramacion, type CumplimientoResumen, type LineaProgramacion, type ProgramacionCliente, type ProgramacionResumenDia } from "@/lib/programacion-cliente-tipos"
import { calcularCumplimiento, sumarDias, type CitaResumen } from "@/lib/programacion-cliente-calculo"

type Resp<T> = { success: true; data: T } | { success: false; message: string }

const TABLA = "programacion_cliente"
const MSG_SIN_TABLA = "Falta correr el script SQL 211 (tabla programacion_cliente)."

function hoyBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

const esFechaISO = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)

function mensajeError(e: any): string {
  const m = String(e?.message ?? e ?? "")
  if (e?.code === "42P01" || /programacion_cliente.*does not exist|relation .* does not exist/i.test(m)) return MSG_SIN_TABLA
  return m || "Error inesperado"
}

/** Perfil de la sesión si la empresa pedida está entre sus accesibles. */
async function perfilConAcceso(sb: any, empresaId: number): Promise<{ id: string; usuario: string | null; empresa_id: number | null } | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const profile: any = await getUserProfile(user.id)
  if (!profile?.id) return null
  const { data, error } = await sb.from("perfil_acceso_empresas").select("empresa_id").eq("profile_id", profile.id)
  if (error) return null
  const ids: number[] = (data ?? []).map((r: any) => Number(r.empresa_id))
  const permitido = ids.length === 0 ? Number(profile.empresa_id) === empresaId : ids.includes(empresaId)
  return permitido ? { id: String(profile.id), usuario: profile.usuario ?? null, empresa_id: profile.empresa_id ?? null } : null
}

function filaAProgramacion(r: any): ProgramacionCliente {
  const lineas: LineaProgramacion[] = Array.isArray(r.lineas)
    ? r.lineas.map((l: any) => ({
        tipovehiculo: String(l?.tipovehiculo ?? ""),
        destino: String(l?.destino ?? ""),
        producto: l?.producto ? String(l.producto) : undefined,
        cantidad: Number(l?.cantidad) || 0,
        observaciones: l?.observaciones ? String(l.observaciones) : undefined,
      }))
    : []
  return {
    id: Number(r.id),
    idempresa: Number(r.idempresa),
    fechaOperacion: String(r.fecha_operacion).slice(0, 10),
    version: Number(r.version) || 1,
    vigente: !!r.vigente,
    lineas,
    totalVehiculos: Number(r.total_vehiculos) || lineas.reduce((s, l) => s + l.cantidad, 0),
    observaciones: r.observaciones ?? null,
    enviadaEn: String(r.enviada_en),
    aTiempo: !!r.a_tiempo,
    enviadaPorUsuario: r.enviada_por_usuario ?? null,
    enviadaPorEmpresa: r.enviada_por_empresa == null ? null : Number(r.enviada_por_empresa),
  }
}

/** Programaciones vigentes de una empresa entre dos fechas (paginado por llave única). */
async function programacionesVigentes(sb: any, empresaId: number, desde: string, hasta: string): Promise<ProgramacionCliente[]> {
  const out: ProgramacionCliente[] = []
  const PAG = 500
  for (let desdeFila = 0; ; desdeFila += PAG) {
    const { data, error } = await sb
      .from(TABLA)
      .select("*")
      .eq("idempresa", empresaId)
      .eq("vigente", true)
      .gte("fecha_operacion", desde)
      .lte("fecha_operacion", hasta)
      .order("id", { ascending: true })
      .range(desdeFila, desdeFila + PAG - 1)
    if (error) throw error
    for (const r of data ?? []) out.push(filaAProgramacion(r))
    if (!data || data.length < PAG) break
  }
  return out
}

/** Vehículos llegados a portería entre dos fechas (paginado por llave única). */
async function citasEntre(sb: any, empresaId: number, desde: string, hasta: string): Promise<CitaResumen[]> {
  const out: CitaResumen[] = []
  const PAG = 1000
  for (let desdeFila = 0; ; desdeFila += PAG) {
    const { data, error } = await sb
      .from("citasvehiculos")
      .select("id, fechallegada, tipovehiculo")
      .eq("idempresa", empresaId)
      .gte("fechallegada", desde)
      .lte("fechallegada", `${hasta}T23:59:59`)
      .order("id", { ascending: true })
      .range(desdeFila, desdeFila + PAG - 1)
    if (error) throw error
    for (const c of data ?? []) {
      if (!c.fechallegada) continue
      out.push({ fecha: String(c.fechallegada).slice(0, 10), tipovehiculo: c.tipovehiculo ?? null })
    }
    if (!data || data.length < PAG) break
  }
  return out
}

export async function getCatalogosProgramacion(empresaId: number | null | undefined): Promise<Resp<CatalogosProgramacion>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  try {
    const sb: any = await getSupabaseAdmin()
    if (!(await perfilConAcceso(sb, empresaId))) return { success: false, message: "Sin acceso a la empresa." }

    const [tipos, prevs, citas] = await Promise.all([
      sb.from("tiposvehiculos").select("nombretipo, capacidad, activo").order("capacidad", { ascending: false }).limit(50),
      sb.from(TABLA).select("lineas").eq("idempresa", empresaId).order("id", { ascending: false }).limit(200),
      sb.from("citasvehiculos").select("tipoproducto").eq("idempresa", empresaId).gte("fechallegada", sumarDias(hoyBogota(), -120)).order("id", { ascending: false }).limit(2000),
    ])
    if (tipos.error) throw tipos.error
    // Si la tabla no existe todavía, los catálogos de tipos siguen sirviendo;
    // el guardado avisará con MSG_SIN_TABLA.
    const sinTabla = !!prevs.error && mensajeError(prevs.error) === MSG_SIN_TABLA
    if (prevs.error && !sinTabla) throw prevs.error

    const tiposVehiculo = (tipos.data ?? [])
      .filter((t: any) => t.activo === true || t.activo === "true" || t.activo == null)
      .map((t: any) => ({ nombre: String(t.nombretipo), capacidad: t.capacidad == null ? null : Number(t.capacidad) }))

    const destinos = new Map<string, number>()
    const productos = new Map<string, number>()
    for (const r of prevs.data ?? []) {
      for (const l of Array.isArray(r.lineas) ? r.lineas : []) {
        const d = String(l?.destino ?? "").trim()
        if (d) destinos.set(d, (destinos.get(d) ?? 0) + 1)
        const p = String(l?.producto ?? "").trim()
        if (p) productos.set(p, (productos.get(p) ?? 0) + 1)
      }
    }
    for (const c of citas.data ?? []) {
      const p = String(c.tipoproducto ?? "").trim()
      if (p) productos.set(p, (productos.get(p) ?? 0) + 1)
    }
    const porUso = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((e) => e[0]).slice(0, 40)

    return {
      success: true,
      data: { tiposVehiculo, destinos: porUso(destinos), productos: porUso(productos), usa: (prevs.data?.length ?? 0) > 0 },
    }
  } catch (e: any) {
    console.error("[programacion-cliente] catalogos:", e?.message ?? e)
    return { success: false, message: mensajeError(e) }
  }
}

export async function getProgramacion(
  empresaId: number | null | undefined,
  fecha: string,
): Promise<Resp<{ vigente: ProgramacionCliente | null; versiones: ProgramacionCliente[] }>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  if (!esFechaISO(fecha)) return { success: false, message: "Fecha inválida." }
  try {
    const sb: any = await getSupabaseAdmin()
    if (!(await perfilConAcceso(sb, empresaId))) return { success: false, message: "Sin acceso a la empresa." }
    const { data, error } = await sb.from(TABLA).select("*").eq("idempresa", empresaId).eq("fecha_operacion", fecha).order("version", { ascending: false }).limit(50)
    if (error) throw error
    const versiones: ProgramacionCliente[] = (data ?? []).map(filaAProgramacion)
    return { success: true, data: { vigente: versiones.find((v) => v.vigente) ?? null, versiones } }
  } catch (e: any) {
    console.error("[programacion-cliente] get:", e?.message ?? e)
    return { success: false, message: mensajeError(e) }
  }
}

/** Guarda una nueva VERSIÓN de la programación de `fecha` y la deja vigente. */
export async function guardarProgramacion(
  empresaId: number | null | undefined,
  fecha: string,
  lineas: LineaProgramacion[],
  observaciones?: string | null,
): Promise<Resp<ProgramacionCliente>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  if (!esFechaISO(fecha)) return { success: false, message: "Fecha inválida." }
  if (fecha < sumarDias(hoyBogota(), -31)) return { success: false, message: "No se puede programar una fecha de hace más de un mes." }
  if (!Array.isArray(lineas) || lineas.length === 0) return { success: false, message: "Agrega al menos una línea." }
  if (lineas.length > 60) return { success: false, message: "Máximo 60 líneas por programación." }

  const limpias: LineaProgramacion[] = []
  for (const l of lineas) {
    const tipovehiculo = String(l?.tipovehiculo ?? "").trim().slice(0, 60)
    const cantidad = Math.floor(Number(l?.cantidad))
    if (!tipovehiculo) return { success: false, message: "Cada línea necesita tipo de vehículo." }
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > 999) return { success: false, message: "La cantidad debe estar entre 1 y 999." }
    limpias.push({
      tipovehiculo,
      destino: String(l?.destino ?? "").trim().slice(0, 120),
      producto: String(l?.producto ?? "").trim().slice(0, 60) || undefined,
      cantidad,
      observaciones: String(l?.observaciones ?? "").trim().slice(0, 300) || undefined,
    })
  }

  try {
    const sb: any = await getSupabaseAdmin()
    const perfil = await perfilConAcceso(sb, empresaId)
    if (!perfil) return { success: false, message: "Sin acceso a la empresa." }

    // A tiempo = antes de las 17:00 (Bogotá, UTC−5 fijo) del día anterior.
    const limite = Date.parse(`${sumarDias(fecha, -1)}T${String(HORA_LIMITE).padStart(2, "0")}:00:00-05:00`)
    const aTiempo = Date.now() <= limite

    const { data: prev, error: ePrev } = await sb.from(TABLA).select("version").eq("idempresa", empresaId).eq("fecha_operacion", fecha).order("version", { ascending: false }).limit(1)
    if (ePrev) throw ePrev
    const version = (Number(prev?.[0]?.version) || 0) + 1

    const { error: eUpd } = await sb.from(TABLA).update({ vigente: false }).eq("idempresa", empresaId).eq("fecha_operacion", fecha).eq("vigente", true)
    if (eUpd) throw eUpd

    const { data, error } = await sb
      .from(TABLA)
      .insert({
        idempresa: empresaId,
        fecha_operacion: fecha,
        version,
        vigente: true,
        lineas: limpias,
        total_vehiculos: limpias.reduce((s, l) => s + l.cantidad, 0),
        observaciones: String(observaciones ?? "").trim().slice(0, 500) || null,
        enviada_en: new Date().toISOString(),
        a_tiempo: aTiempo,
        enviada_por: perfil.id,
        enviada_por_usuario: perfil.usuario,
        enviada_por_empresa: perfil.empresa_id,
      })
      .select("*")
      .single()
    if (error) throw error
    return { success: true, data: filaAProgramacion(data) }
  } catch (e: any) {
    console.error("[programacion-cliente] guardar:", e?.message ?? e)
    return { success: false, message: mensajeError(e) }
  }
}

export async function getCumplimientoProgramacion(
  empresaId: number | null | undefined,
  desde: string,
  hasta: string,
): Promise<Resp<CumplimientoResumen>> {
  if (!empresaId) return { success: false, message: "Selecciona un proyecto." }
  if (!esFechaISO(desde) || !esFechaISO(hasta) || desde > hasta) return { success: false, message: "Rango de fechas inválido." }
  if (hasta > sumarDias(desde, 120)) return { success: false, message: "El rango máximo es de 120 días." }
  try {
    const sb: any = await getSupabaseAdmin()
    if (!(await perfilConAcceso(sb, empresaId))) return { success: false, message: "Sin acceso a la empresa." }
    const [progs, citas] = await Promise.all([programacionesVigentes(sb, empresaId, desde, hasta), citasEntre(sb, empresaId, desde, hasta)])
    return { success: true, data: calcularCumplimiento(desde, hasta, progs, citas) }
  } catch (e: any) {
    console.error("[programacion-cliente] cumplimiento:", e?.message ?? e)
    return { success: false, message: mensajeError(e) }
  }
}

/**
 * Resumen corto de UN día para Operación del día (sin validar sesión: lo llama
 * otra server action que ya validó la empresa). Nunca lanza: si falta la tabla
 * devuelve `usa: false`.
 */
export async function getProgramacionResumenDia(empresaId: number, fecha: string): Promise<ProgramacionResumenDia> {
  const vacio: ProgramacionResumenDia = { usa: false, tiene: false, programados: 0, llegaron: 0, cumplidos: 0, porcentaje: null, aTiempo: null, enviadaEn: null, enviadaPorUsuario: null }
  if (!empresaId || !esFechaISO(fecha)) return vacio
  try {
    const sb: any = await getSupabaseAdmin()
    const { count, error } = await sb.from(TABLA).select("id", { count: "exact", head: true }).eq("idempresa", empresaId)
    if (error || !count) return vacio
    const [progs, citas] = await Promise.all([programacionesVigentes(sb, empresaId, fecha, fecha), citasEntre(sb, empresaId, fecha, fecha)])
    const r = calcularCumplimiento(fecha, fecha, progs, citas)
    const d = r.dias[0]
    if (!d) return { ...vacio, usa: true }
    return {
      usa: true,
      tiene: d.tieneProgramacion,
      programados: d.programados,
      llegaron: d.llegaron,
      cumplidos: d.cumplidos,
      porcentaje: d.porcentaje,
      aTiempo: d.aTiempo,
      enviadaEn: d.enviadaEn,
      enviadaPorUsuario: d.enviadaPorUsuario,
    }
  } catch {
    return vacio
  }
}
