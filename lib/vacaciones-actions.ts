"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { registrarErrorServidor } from "@/lib/errores-servidor"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { diasHabilesEntre, type VacacionResumen, type SolicitudVacaciones } from "@/lib/vacaciones-types"

// Días hábiles de vacaciones que se causan por año de servicio (ley colombiana).
const DIAS_VAC_ANIO = 15
const MS_DIA = 86400000

function hoyISO(): string {
  const b = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }))
  return `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, "0")}-${String(b.getDate()).padStart(2, "0")}`
}

const norm = (c: any) => String(c ?? "").trim().replace(/\.0+$/, "").replace(/\D/g, "")

// Festivos (Colombia) como set de fechas ISO en un rango, para descontarlos de los
// días hábiles de vacaciones. Tabla `festivos` { id, fecha }.
async function festivosSet(sb: any, desde: string, hasta: string): Promise<Set<string>> {
  const { data } = await sb.from("festivos").select("fecha").gte("fecha", desde).lte("fecha", hasta)
  return new Set((data ?? []).map((r: any) => String(r.fecha).slice(0, 10)))
}

// Lista de festivos (fechas ISO) para que la UI calcule los días hábiles en vivo.
export async function getFestivos(): Promise<string[]> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data } = await sb.from("festivos").select("fecha")
    return (data ?? []).map((r: any) => String(r.fecha).slice(0, 10))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// RESUMEN de vacaciones por trabajador ACTIVO: causados / disfrutados / saldo.
// ---------------------------------------------------------------------------
export async function getVacacionesResumen(empresaId?: number | null): Promise<VacacionResumen[]> {
  try {
    const sb: any = await getSupabaseAdmin()
    const emp = empresaId || (await getCurrentEmpresaIdForInsert())
    if (!emp) return []

    // 1) Trabajadores activos (con fecha de ingreso y salario).
    const { data: hc } = await sb
      .from("headcount")
      .select("identificacion,nombre,cargo,salario,fechainicio,estado")
      .eq("idempresa", emp)
    const activos = (hc ?? []).filter((h: any) => String(h.estado || "").toLowerCase().includes("activ"))

    // Respaldo de fecha de ingreso desde contratos (si headcount no la trae).
    const { data: con } = await sb
      .from("contratos")
      .select("colaborador_id,fecha_inicio")
      .eq("idempresa", emp)
      .not("fecha_inicio", "is", null)
    const ingresoContrato = new Map<string, string>()
    for (const c of con ?? []) {
      const k = norm(c.colaborador_id)
      if (k && !ingresoContrato.has(k)) ingresoContrato.set(k, String(c.fecha_inicio).slice(0, 10))
    }

    // 2) Días DISFRUTADOS: novedad "vacaciones" en el control diario (por cédula).
    const disfrutadosPorCed: Record<string, number> = {}
    let from = 0
    while (true) {
      const { data } = await sb
        .from("registroasistencia")
        .select("identificacion,fecha")
        .eq("idempresa", emp)
        .ilike("asistencia", "%vacacion%")
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(from, from + 999)
      for (const r of data ?? []) {
        const k = norm(r.identificacion)
        disfrutadosPorCed[k] = (disfrutadosPorCed[k] || 0) + 1
      }
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 200000) break
    }

    // 3) Días LIQUIDADOS (compensados en dinero) por cédula.
    const { data: liq } = await sb
      .from("vacaciones_liquidaciones")
      .select("cedula,dias")
      .eq("idempresa", emp)
    const liquidadosPorCed: Record<string, number> = {}
    for (const l of liq ?? []) liquidadosPorCed[norm(l.cedula)] = (liquidadosPorCed[norm(l.cedula)] || 0) + (Number(l.dias) || 0)

    // 4) Días PROGRAMADOS: solicitudes APROBADAS con fin a futuro (aún no tomadas).
    const hoy = hoyISO()
    const { data: sol } = await sb
      .from("vacaciones_solicitudes")
      .select("cedula,dias_habiles,fecha_fin,estado")
      .eq("idempresa", emp)
      .eq("estado", "APROBADA")
      .gte("fecha_fin", hoy)
    const programadosPorCed: Record<string, number> = {}
    for (const s of sol ?? []) programadosPorCed[norm(s.cedula)] = (programadosPorCed[norm(s.cedula)] || 0) + (Number(s.dias_habiles) || 0)

    const hoyMs = new Date(`${hoy}T00:00:00`).getTime()
    const out: VacacionResumen[] = []
    for (const h of activos) {
      const ced = norm(h.identificacion)
      const ingreso = (h.fechainicio && String(h.fechainicio).slice(0, 10)) || ingresoContrato.get(ced) || null
      let causados = 0
      let anios = 0
      if (ingreso) {
        const ingMs = new Date(`${ingreso}T00:00:00`).getTime()
        if (!Number.isNaN(ingMs) && ingMs <= hoyMs) {
          const dias = (hoyMs - ingMs) / MS_DIA
          anios = Math.round((dias / 365.25) * 100) / 100
          causados = Math.round((dias / 365.25) * DIAS_VAC_ANIO * 10) / 10
        }
      }
      const disfrutados = disfrutadosPorCed[ced] || 0
      const liquidados = liquidadosPorCed[ced] || 0
      const programados = programadosPorCed[ced] || 0
      const saldo = Math.round((causados - disfrutados - liquidados) * 10) / 10
      const salario = Number(h.salario) || 0
      const valorDia = Math.round(salario / 30)
      const alerta: VacacionResumen["alerta"] = saldo >= 30 ? "crit" : saldo > 15 ? "warn" : "ok"
      out.push({
        cedula: h.identificacion,
        nombre: h.nombre || h.identificacion,
        cargo: h.cargo || null,
        fecha_ingreso: ingreso,
        anios,
        causados,
        disfrutados,
        liquidados,
        programados,
        saldo,
        valor_dia: valorDia,
        valor_saldo: Math.round(Math.max(0, saldo) * valorDia),
        alerta,
      })
    }
    // Mayor acumulación primero (para priorizar programación de vacaciones).
    out.sort((a, b) => b.saldo - a.saldo)
    return out
  } catch (err) {
    console.error("[v0] getVacacionesResumen:", err)
    return []
  }
}

// ---------------------------------------------------------------------------
// SOLICITUDES de vacaciones (flujo solicitud → aprobación).
// ---------------------------------------------------------------------------
export async function getSolicitudesVacaciones(empresaId?: number | null): Promise<SolicitudVacaciones[]> {
  try {
    const sb: any = await getSupabaseAdmin()
    const emp = empresaId || (await getCurrentEmpresaIdForInsert())
    if (!emp) return []
    const { data } = await sb
      .from("vacaciones_solicitudes")
      .select("*")
      .eq("idempresa", emp)
      .order("created_at", { ascending: false })
    return (data ?? []) as SolicitudVacaciones[]
  } catch (err) {
    console.error("[v0] getSolicitudesVacaciones:", err)
    return []
  }
}

export async function crearSolicitudVacaciones(
  input: { cedula: string; nombre?: string; cargo?: string; fecha_inicio: string; fecha_fin: string; observaciones?: string },
  empresaId?: number | null,
) {
  try {
    const sb: any = await getSupabaseAdmin()
    const emp = empresaId || (await getCurrentEmpresaIdForInsert())
    if (!emp) return { success: false, message: "Sin empresa seleccionada" }
    if (!input.cedula || !input.fecha_inicio || !input.fecha_fin) return { success: false, message: "Faltan datos" }
    const fest = await festivosSet(sb, input.fecha_inicio, input.fecha_fin)
    const dias = diasHabilesEntre(input.fecha_inicio, input.fecha_fin, fest).length
    if (dias <= 0) return { success: false, message: "El rango no tiene días hábiles" }
    const { error } = await sb.from("vacaciones_solicitudes").insert({
      idempresa: emp,
      cedula: input.cedula,
      nombre: input.nombre || null,
      cargo: input.cargo || null,
      fecha_inicio: input.fecha_inicio,
      fecha_fin: input.fecha_fin,
      dias_habiles: dias,
      estado: "PENDIENTE",
      observaciones: input.observaciones || null,
    })
    if (error) return { success: false, message: error.message }
    return { success: true, dias }
  } catch (err: any) {
    void registrarErrorServidor("nomina.crearSolicitudVacaciones", err)
    return { success: false, message: err?.message || "Error" }
  }
}

export async function rechazarSolicitudVacaciones(id: string, motivo?: string) {
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb
      .from("vacaciones_solicitudes")
      .update({ estado: "RECHAZADA", motivo_rechazo: motivo || null })
      .eq("id", id)
    return error ? { success: false, message: error.message } : { success: true }
  } catch (err: any) {
    void registrarErrorServidor("nomina.crearSolicitudVacaciones", err)
    return { success: false, message: err?.message || "Error" }
  }
}

// Aprobar: marca la solicitud APROBADA y ESCRIBE la novedad "Vacaciones" en el
// control diario (registroasistencia) por cada día hábil → así se refleja en el
// control diario y la nómina, y cuenta como día disfrutado en el saldo.
export async function aprobarSolicitudVacaciones(id: string, aprobadoPor?: string) {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: s } = await sb.from("vacaciones_solicitudes").select("*").eq("id", id).maybeSingle()
    if (!s) return { success: false, message: "Solicitud no encontrada" }

    const ini = String(s.fecha_inicio).slice(0, 10)
    const fin = String(s.fecha_fin).slice(0, 10)
    const fest = await festivosSet(sb, ini, fin)
    const dias = diasHabilesEntre(ini, fin, fest)
    const NOVEDAD = "31- Vacaciones disfrutadas"

    // Filas ya existentes de esa persona en el rango (para no duplicar).
    const { data: exist } = await sb
      .from("registroasistencia")
      .select("id,fecha")
      .eq("idempresa", s.idempresa)
      .eq("identificacion", s.cedula)
      .gte("fecha", dias[0])
      .lte("fecha", dias[dias.length - 1])
    const idPorFecha = new Map<string, number>()
    for (const r of exist ?? []) idPorFecha.set(String(r.fecha).slice(0, 10), r.id)

    // Actualiza las que existan; inserta las que falten SIN fijar `id`: la columna
    // es SERIAL PRIMARY KEY y Postgres asigna el id vía la secuencia. Fijar el id a
    // mano (max+1) NO avanza la secuencia y colisiona con los caminos que sí usan
    // nextval (register-shifts, programación de turnos) y entre aprobaciones simultáneas.
    const nuevos: any[] = []
    for (const f of dias) {
      const rid = idPorFecha.get(f)
      if (rid) {
        await sb
          .from("registroasistencia")
          .update({ asistencia: NOVEDAD, puesto: null, horasturno: null, especialidad: false })
          .eq("id", rid)
      } else {
        nuevos.push({
          idempresa: s.idempresa,
          fecha: f,
          nombre: s.nombre || s.cedula,
          identificacion: s.cedula,
          asistencia: NOVEDAD,
          puesto: null,
          horasturno: null,
          especialidad: false,
        })
      }
    }
    if (nuevos.length) {
      const { error: insErr } = await sb.from("registroasistencia").insert(nuevos)
      if (insErr) return { success: false, message: insErr.message }
    }

    const { error } = await sb
      .from("vacaciones_solicitudes")
      .update({ estado: "APROBADA", aprobado_por: aprobadoPor || null, fecha_aprobacion: new Date().toISOString() })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true, dias: dias.length }
  } catch (err: any) {
    void registrarErrorServidor("nomina.aprobarSolicitudVacaciones", err)
    return { success: false, message: err?.message || "Error" }
  }
}

// Registrar una liquidación en dinero de saldo de vacaciones (p. ej. al retiro).
export async function registrarLiquidacionVacaciones(
  input: { cedula: string; nombre?: string; dias: number; valor_dia: number; observaciones?: string },
  empresaId?: number | null,
) {
  try {
    const sb: any = await getSupabaseAdmin()
    const emp = empresaId || (await getCurrentEmpresaIdForInsert())
    if (!emp) return { success: false, message: "Sin empresa seleccionada" }
    if (!input.cedula || !input.dias || input.dias <= 0) return { success: false, message: "Datos inválidos" }
    const total = Math.round(input.dias * (Number(input.valor_dia) || 0))
    const { error } = await sb.from("vacaciones_liquidaciones").insert({
      idempresa: emp,
      cedula: input.cedula,
      nombre: input.nombre || null,
      dias: input.dias,
      valor_dia: input.valor_dia || 0,
      valor_total: total,
      observaciones: input.observaciones || null,
    })
    if (error) return { success: false, message: error.message }
    return { success: true, total }
  } catch (err: any) {
    void registrarErrorServidor("nomina.registrarLiquidacionVacaciones", err)
    return { success: false, message: err?.message || "Error" }
  }
}
