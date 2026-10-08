"use server"

// ---------------------------------------------------------------------------
// PROGRAMACIÓN DEL PERSONAL POR QUINCENA
//
// Lee la quincena completa de `registroasistencia` y la presenta como una
// grilla persona × día, más la cobertura por puesto y los equipos.
//
// LO QUE ESTO **NO** HACE
//  · No liquida. Las horas que muestra son las PROGRAMADAS; lo que se paga sale
//    del trigger sobre registroasistencia y de la vista pagonomina.
//  · No calcula horas nocturnas para nómina. El estimado nocturno es de
//    pantalla: hen/hef/hn los consume la nómina y la facturación, hoy valen 0
//    porque el trigger solo escribe hed/hedf, y poblarlos sube ambas de golpe.
//  · No valida el límite semanal: el sistema no calcula la jornada real.
//
// Escribir aquí es PRODUCCIÓN INMEDIATA: insertar en registroasistencia dispara
// el trigger de horas extra y la fila entra a nómina y facturación. No hay
// borrador. Por eso las escrituras piden confirmación explícita en la pantalla.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getPuestosFromTarifas } from "@/lib/programacion-turnos-actions"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import type {
  CeldaCobertura,
  DiaQuincena,
  FilaCobertura,
  FilaPersona,
  ProgramacionQuincenaData,
  HorarioActividad,
} from "@/lib/programacion-quincena-tipos"
import { aMinutos, fmtMinutos, minutosTurno, minutosNocturnos, agruparHorariosPorPuesto } from "@/lib/horarios-actividad-utils"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const DIAS_SEMANA = ["do", "lu", "ma", "mi", "ju", "vi", "sá"]

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

function ultimoDiaDe(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate()
}

function faltaTabla(msg: string | undefined): boolean {
  const m = String(msg ?? "").toLowerCase()
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("relation")
}

/** Todas las filas, paginando: Supabase corta en 1000. */
async function traerTodo(construir: (d: number, h: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let off = 0; off < 60000; off += 1000) {
    const { data, error } = await construir(off, off + 999)
    if (error) throw new Error(error.message)
    const lote = data ?? []
    out.push(...lote)
    if (lote.length < 1000) break
  }
  return out
}

/**
 * Toda la quincena en una llamada.
 *
 * Si falta el script de esta entrega, devuelve `faltaMigracion: true` y la
 * pantalla lo dice en vez de mostrar una grilla vacía como si no hubiera gente.
 */
export async function getProgramacionQuincena(
  empresaId: number | null | undefined,
  anio: number,
  mes: number,
  quincena: 1 | 2,
): Promise<{ success: boolean; data?: ProgramacionQuincenaData; message?: string }> {
  if (!empresaId) return { success: false, message: "Selecciona una empresa en el selector de arriba." }

  const p = (n: number) => String(n).padStart(2, "0")
  const diaIni = quincena === 1 ? 1 : 16
  const diaFin = quincena === 1 ? 15 : ultimoDiaDe(anio, mes)
  const desde = `${anio}-${p(mes)}-${p(diaIni)}`
  const hasta = `${anio}-${p(mes)}-${p(diaFin)}`
  const avisos: string[] = []

  try {
    const sb: any = await getSupabaseAdmin()

    // faltaMigracion se detecta más abajo, en la primera tabla de
    // scripts/176_*.sql que se lea (equipos_trabajo) -- los horarios ya no
    // dependen de esa migración, pero equipos/patrones/cobertura sí.
    let faltaMigracion = false

    // --- DÍAS DE LA QUINCENA, CON FESTIVOS --------------------------------
    const festivos = new Set<string>()
    try {
      const { data } = await sb.from("festivos").select("fecha").gte("fecha", desde).lte("fecha", hasta)
      for (const f of data ?? []) festivos.add(String(f.fecha).slice(0, 10))
    } catch {
      avisos.push("No se pudieron leer los festivos: la grilla marcará solo los domingos.")
    }

    const dias: DiaQuincena[] = []
    for (let d = diaIni; d <= diaFin; d++) {
      const fecha = `${anio}-${p(mes)}-${p(d)}`
      // Se construye a mediodía UTC: con T00:00:00Z, en UTC-5 el día retrocede.
      const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay()
      dias.push({
        fecha,
        diaMes: d,
        diaSemana: DIAS_SEMANA[dow],
        esDomingo: dow === 0,
        esFestivo: festivos.has(fecha),
      })
    }

    // --- PERSONAL ACTIVO --------------------------------------------------
    // Se incluye al administrativo: la maqueta tiene un turno AD y hoy el
    // selector de programación lo excluye. Se marca con su cargo para que se
    // vea quién es quién.
    let personasBase: any[] = []
    try {
      personasBase = await traerTodo((d, h) =>
        sb
          .from("headcount")
          .select("identificacion, nombre, cargo, admin")
          .eq("idempresa", empresaId)
          .eq("estado", "Activo")
          .order("nombre", { ascending: true })
          .range(d, h),
      )
      personasBase = personasBase.filter((r) => !/prueba/i.test(String(r.nombre ?? "")))
    } catch (e: any) {
      avisos.push("No se pudo leer el personal activo.")
      console.error("[v0] getProgramacionQuincena headcount:", e?.message ?? e)
    }

    // --- EQUIPOS ----------------------------------------------------------
    const equipoPorIdent = new Map<string, { id: number; nombre: string }>()
    const equipos: ProgramacionQuincenaData["equipos"] = []
    const patrones: ProgramacionQuincenaData["patrones"] = []
    if (!faltaMigracion) {
      try {
        const [eqRes, patRes, intRes] = await Promise.all([
          sb.from("equipos_trabajo").select("id, nombre, area, color, patron_id").eq("idempresa", empresaId).eq("activo", true),
          sb.from("patrones_rotacion").select("id, nombre, descripcion, secuencia, horas_semana").eq("idempresa", empresaId).eq("activo", true).order("nombre"),
          sb.from("equipos_integrantes").select("equipo_id, identificacion"),
        ])
        if (eqRes.error && faltaTabla(eqRes.error.message)) faltaMigracion = true
        const patMap = new Map<number, any>((patRes.data ?? []).map((x: any) => [Number(x.id), x]))
        for (const x of patRes.data ?? []) {
          patrones.push({
            id: Number(x.id),
            nombre: x.nombre,
            descripcion: x.descripcion ?? null,
            secuencia: (x.secuencia ?? []) as string[],
            horasSemana: x.horas_semana == null ? null : Number(x.horas_semana),
          })
        }
        const porEquipo = new Map<number, number>()
        for (const i of intRes.data ?? []) {
          porEquipo.set(Number(i.equipo_id), (porEquipo.get(Number(i.equipo_id)) ?? 0) + 1)
        }
        for (const e of eqRes.data ?? []) {
          const pat = e.patron_id ? patMap.get(Number(e.patron_id)) : null
          equipos.push({
            id: Number(e.id),
            nombre: e.nombre,
            area: e.area ?? null,
            color: e.color ?? null,
            patronId: e.patron_id ? Number(e.patron_id) : null,
            patronNombre: pat?.nombre ?? null,
            integrantes: porEquipo.get(Number(e.id)) ?? 0,
            horasSemana: pat?.horas_semana == null ? null : Number(pat.horas_semana),
          })
        }
        const idsEmpresa = new Set(equipos.map((e) => e.id))
        for (const i of intRes.data ?? []) {
          const eid = Number(i.equipo_id)
          if (!idsEmpresa.has(eid)) continue
          const eq = equipos.find((e) => e.id === eid)
          if (eq) equipoPorIdent.set(String(i.identificacion).trim(), { id: eq.id, nombre: eq.nombre })
        }
      } catch (e: any) {
        console.error("[v0] getProgramacionQuincena equipos:", e?.message ?? e)
      }
    }

    // --- LO PROGRAMADO EN LA QUINCENA -------------------------------------
    let filasRA: any[] = []
    try {
      filasRA = await traerTodo((d, h) =>
        sb
          .from("registroasistencia")
          .select(
            "id, fecha, nombre, identificacion, puesto, asistencia, horaentradaprogramada, horasalidaprogramada, horaingreso, horasalida, especialidad, hed, hedf, turno",
          )
          .eq("idempresa", empresaId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      )
    } catch (e: any) {
      avisos.push("No se pudo leer la programación de la quincena.")
      console.error("[v0] getProgramacionQuincena registroasistencia:", e?.message ?? e)
    }

    // Horarios REALES en uso esta quincena, agrupados por puesto -- lo que
    // el coordinador de verdad programó, no un catálogo fijo que se
    // desactualiza. Reemplaza toda resolución de "código de turno".
    const horariosReales: HorarioActividad[] = agruparHorariosPorPuesto(
      filasRA
        .filter((r: any) => r.puesto != null && r.asistencia == null)
        .map((r: any) => ({
          puesto: r.puesto,
          horaEntrada: r.horaentradaprogramada ? fmtMinutos(aMinutos(r.horaentradaprogramada)!) : null,
          horaSalida: r.horasalidaprogramada ? fmtMinutos(aMinutos(r.horasalidaprogramada)!) : null,
        })),
    )

    const personas: FilaPersona[] = personasBase.map((per) => {
      const ident = String(per.identificacion ?? "").trim()
      const eq = equipoPorIdent.get(ident) ?? null
      return {
        identificacion: ident,
        nombre: per.nombre ?? "",
        cargo: per.cargo ?? null,
        equipoId: eq?.id ?? null,
        equipoNombre: eq?.nombre ?? null,
        dias: {},
        horasQuincena: 0,
        diasConTurno: 0,
      }
    })
    const porIdent = new Map(personas.map((x) => [x.identificacion, x]))

    let horasProgramadas = 0
    let horasNocturnasEstimadas = 0
    let diasProgramados = 0

    for (const r of filasRA) {
      const ident = String(r.identificacion ?? "").trim()
      const fila = porIdent.get(ident)
      if (!fila) continue // alguien ya retirado, o de otra empresa
      const fecha = String(r.fecha).slice(0, 10)
      const ini = aMinutos(r.horaentradaprogramada)
      const fin = aMinutos(r.horasalidaprogramada)

      const aplicaExtra = String(r.especialidad ?? "").trim().toLowerCase() === "true"
      fila.dias[fecha] = {
        id: Number(r.id),
        puesto: r.puesto ?? null,
        horaEntrada: ini != null ? fmtMinutos(ini) : null,
        horaSalida: fin != null ? fmtMinutos(fin) : null,
        novedad: r.asistencia ?? null,
        marco: !!r.horaingreso,
        horasExtra: aplicaExtra
          ? {
              aplica: true,
              cerrado: !!r.horasalida,
              ordinaria: Number(r.hed) || 0,
              festiva: Number(r.hedf) || 0,
            }
          : { aplica: false, cerrado: !!r.horasalida, ordinaria: 0, festiva: 0 },
      }

      if (r.puesto != null && r.asistencia == null) {
        fila.diasConTurno++
        diasProgramados++
        // Horas siempre EN VIVO del horario real de la fila. Nunca se asume 8.
        const hs = ini != null && fin != null ? Math.round((minutosTurno(ini, fin) / 60) * 10) / 10 : 0
        fila.horasQuincena += hs
        horasProgramadas += hs
        horasNocturnasEstimadas += ini != null && fin != null ? Math.round((minutosNocturnos(ini, fin) / 60) * 10) / 10 : 0
      }
    }

    for (const x of personas) x.horasQuincena = Math.round(x.horasQuincena * 10) / 10

    // --- COBERTURA: REQUERIDO VS ASIGNADO ---------------------------------
    // Catalogo de puestos: el mismo que ofrece la programacion diaria.
    let puestos: string[] = []
    try {
      const catalogo = await getPuestosFromTarifas(empresaId)
      puestos = Array.from(new Set(catalogo.map((p: any) => String(p.puesto || "").trim())))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "es"))
    } catch (e: any) {
      avisos.push("No se pudo leer el catálogo de puestos.")
      console.error("[v0] getProgramacionQuincena puestos:", e?.message ?? e)
    }

    const cobertura: FilaCobertura[] = []
    if (!faltaMigracion) {
      try {
        const { data: dem } = await sb
          .from("demanda_puesto")
          .select("puesto, hora_inicio, fecha, requeridos")
          .eq("idempresa", empresaId)

        // Base (fecha null) + excepciones por día.
        const base = new Map<string, number>()
        const excep = new Map<string, number>()
        for (const d of dem ?? []) {
          if (!d.hora_inicio) continue // demanda vieja sin migrar (turno_codigo) -- se ignora, no se adivina
          const k = `${d.puesto}|${d.hora_inicio}`
          if (d.fecha == null) base.set(k, Number(d.requeridos) || 0)
          else excep.set(`${k}|${String(d.fecha).slice(0, 10)}`, Number(d.requeridos) || 0)
        }

        // Asignados reales por (puesto, hora de entrada, fecha) -- ya no
        // depende de reconocer un código de turno fijo: CUALQUIER horario
        // real que el coordinador use cuenta para la cobertura.
        const asignados = new Map<string, number>()
        for (const r of filasRA) {
          if (r.puesto == null || r.asistencia != null) continue
          const ini = aMinutos(r.horaentradaprogramada)
          if (ini == null) continue
          const k = `${r.puesto}|${fmtMinutos(ini)}|${String(r.fecha).slice(0, 10)}`
          asignados.set(k, (asignados.get(k) ?? 0) + 1)
        }

        for (const [k, req] of base) {
          const [puesto, horaInicio] = k.split("|")
          const celdas: CeldaCobertura[] = dias.map((d) => {
            const requeridos = excep.get(`${k}|${d.fecha}`) ?? req
            const asig = asignados.get(`${puesto}|${horaInicio}|${d.fecha}`) ?? 0
            let estado: CeldaCobertura["estado"] = "sin_demanda"
            if (requeridos > 0) {
              estado = asig >= requeridos ? "cubierto" : asig === 0 ? "deficit" : asig >= requeridos * 0.85 ? "parcial" : "deficit"
            }
            return { fecha: d.fecha, requeridos, asignados: asig, estado }
          })
          cobertura.push({
            puesto,
            horaInicio,
            requeridosBase: req,
            dias: celdas,
          })
        }
        cobertura.sort((a, b) => a.puesto.localeCompare(b.puesto) || a.horaInicio.localeCompare(b.horaInicio))
      } catch (e: any) {
        console.error("[v0] getProgramacionQuincena demanda:", e?.message ?? e)
      }
    }

    return {
      success: true,
      data: {
        quincena: {
          anio, mes, numero: quincena, desde, hasta,
          etiqueta: `${diaIni} – ${diaFin} de ${MESES[mes - 1]}`,
        },
        dias,
        horariosReales,
        personas,
        equipos,
        patrones,
        cobertura,
        puestos,
        totales: {
          personas: personas.length,
          diasProgramados,
          horasProgramadas: Math.round(horasProgramadas * 10) / 10,
          horasNocturnasEstimadas: Math.round(horasNocturnasEstimadas * 10) / 10,
        },
        avisos,
        faltaMigracion,
      },
    }
  } catch (e: any) {
    console.error("[v0] getProgramacionQuincena excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo cargar la programación." }
  }
}

/** Crea o actualiza un turno con nombre. */
export async function guardarTurnoDef(payload: {
  empresaId: number
  id?: number
  codigo: string
  nombre: string
  horaInicio: string
  horaFin: string
  descansoMin: number
  color?: string | null
  esAdministrativo?: boolean
  orden?: number
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Programación de turnos"], "configurar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const sb: any = await getSupabaseAdmin()
    const fila = {
      idempresa: payload.empresaId,
      codigo: payload.codigo.trim().toUpperCase(),
      nombre: payload.nombre.trim(),
      hora_inicio: `${payload.horaInicio}:00`,
      hora_fin: `${payload.horaFin}:00`,
      descanso_min: Math.max(0, Number(payload.descansoMin) || 0),
      color: payload.color ?? null,
      es_administrativo: !!payload.esAdministrativo,
      orden: Number(payload.orden) || 0,
    }
    if (!fila.codigo || !fila.nombre) return { success: false, message: "Código y nombre son obligatorios." }

    const { error } = payload.id
      ? await sb.from("turnos_definicion").update(fila).eq("id", payload.id)
      : await sb.from("turnos_definicion").insert(fila)
    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/176_add_programacion_turnos_quincena.sql." }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo guardar el turno." }
  }
}

/** Define cuántas personas requiere un puesto a partir de una hora de entrada real. */
export async function guardarDemanda(payload: {
  empresaId: number
  puesto: string
  /** Hora de entrada real ("HH:MM") -- ya no un código de turno fijo. */
  horaInicio: string
  requeridos: number
  /** null = demanda base de todos los días. */
  fecha?: string | null
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Programación de turnos"], "configurar", "Demanda")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!payload.puesto?.trim() || !payload.horaInicio?.trim()) {
      return { success: false, message: "Falta el puesto o la hora de entrada." }
    }
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)
    const req = Math.max(0, Number(payload.requeridos) || 0)

    // En Postgres NULL <> NULL: un .eq("fecha", null) no encontraría la fila
    // base --el caso mayoritario-- y se duplicaría en cada guardado.
    let q = sb
      .from("demanda_puesto")
      .select("id")
      .eq("idempresa", payload.empresaId)
      .eq("puesto", payload.puesto.trim())
      .eq("hora_inicio", payload.horaInicio.trim())
    q = payload.fecha ? q.eq("fecha", payload.fecha) : q.is("fecha", null)
    const { data: ya } = await q.maybeSingle()

    const fila = {
      idempresa: payload.empresaId,
      puesto: payload.puesto.trim(),
      hora_inicio: payload.horaInicio.trim(),
      fecha: payload.fecha ?? null,
      requeridos: req,
      actualizado_por: usuario,
      updated_at: new Date().toISOString(),
    }
    const { error } = ya?.id
      ? await sb.from("demanda_puesto").update(fila).eq("id", ya.id)
      : await sb.from("demanda_puesto").insert(fila)
    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/176_add_programacion_turnos_quincena.sql." }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo guardar la demanda." }
  }
}

/** Crea un equipo y le asigna integrantes. */
export async function guardarEquipo(payload: {
  empresaId: number
  id?: number
  nombre: string
  area?: string | null
  patronId?: number | null
  integrantes?: string[]
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Montacargas", "Programación de turnos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!payload.nombre?.trim()) return { success: false, message: "El equipo necesita un nombre." }
    const sb: any = await getSupabaseAdmin()
    const fila = {
      idempresa: payload.empresaId,
      nombre: payload.nombre.trim(),
      area: payload.area?.trim() || null,
      patron_id: payload.patronId ?? null,
    }

    let equipoId = payload.id
    if (equipoId) {
      const { error } = await sb.from("equipos_trabajo").update(fila).eq("id", equipoId)
      if (error) return { success: false, message: error.message }
    } else {
      const { data, error } = await sb.from("equipos_trabajo").insert(fila).select("id").single()
      if (error) {
        if (faltaTabla(error.message)) {
          return { success: false, message: "Falta correr scripts/176_add_programacion_turnos_quincena.sql." }
        }
        return { success: false, message: error.message }
      }
      equipoId = Number(data.id)
    }

    if (payload.integrantes) {
      // Se reemplaza la lista completa: es lo que espera quien edita el equipo.
      await sb.from("equipos_integrantes").delete().eq("equipo_id", equipoId)
      const nuevos = payload.integrantes
        .map((i) => String(i).trim())
        .filter(Boolean)
        .map((identificacion) => ({ equipo_id: equipoId, identificacion }))
      if (nuevos.length) {
        const { error } = await sb.from("equipos_integrantes").insert(nuevos)
        if (error) return { success: false, message: error.message }
      }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo guardar el equipo." }
  }
}

/** Quita un turno programado. Es la única marcha atrás que existe. */
export async function borrarAsignacion(
  empresaId: number,
  id: number,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Programación de turnos"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!empresaId || !id) return { success: false, message: "Falta la asignación." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("registroasistencia").delete().eq("id", id).eq("idempresa", empresaId)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo quitar." }
  }
}
