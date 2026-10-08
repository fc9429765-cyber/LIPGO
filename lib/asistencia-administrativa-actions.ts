"use server"

// Submódulo "Asistencia Administrativa" (Relaciones Laborales y Ausentismo):
// permite a Gestión Humana registrar o corregir asistencia/novedades para
// CUALQUIER fecha (pasada o futura) -- algo que ningún otro flujo permite hoy
// (Registro de Asistencia y Tabla Asistencia solo escriben el día de hoy;
// Novedades de Personal y el Visor solo pueden UPDATE de filas que ya
// existan, nunca crean una fila donde no hay ninguna).
//
// Disparador real: 7 personas operativas activas de Head Count con CERO
// filas en `registroasistencia` durante agosto-2026 -- nadie registró su
// turno ese mes, así que `pagonomina`/`archivoplano` nunca tuvieron nada que
// exportar a Siigo para ellas. El mismo mecanismo sirve, hacia adelante,
// para llevar la asistencia diaria del personal ADMINISTRATIVO
// (headcount.admin=true), que hoy no pasa por ningún flujo de turnos.
//
// Por qué basta con escribir bien `registroasistencia`: el calendario de
// `pagonomina` se construye sobre `lista_empleados` = DISTINCT nombre_auxiliar
// (cabeceraoc) UNION DISTINCT registroasistencia.nombre (ver
// scripts/053_pagonomina_reemplazo.sql, CTE `lista_empleados`). Quien no tenga
// NINGUNA fila en `registroasistencia` no existe para la vista -- no es que
// sus días paguen $0, es que no entran al UNION. En cuanto tenga una sola
// fila, pagonomina/archivoplano la calculan igual que a cualquier operativo,
// sin tocar esas vistas.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { procesarNovedadRetiro } from "@/lib/retiro-actions"
import { sincronizarBorradorAusentismo } from "@/lib/ausentismos-actions"
import {
  ESPECIALIDADES_OPTIONS,
  horasTurnoParaEspecialidad,
  type NovedadDia,
} from "@/lib/asistencia-catalogos"
import { motivoSinAccion } from "@/lib/puerta-modulo"

export interface PersonaAsistenciaAdmin {
  identificacion: string
  nombre: string
  cargo: string | null
  estado: string | null
  admin: boolean
}

/** Personal operativo Y administrativo del proyecto activo (mismo criterio que app/api/headcount/route.ts). */
export async function getPersonasAsistenciaAdministrativa(
  empresaId: number,
): Promise<{ success: boolean; data: PersonaAsistenciaAdmin[]; message?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()
    // Dos consultas separadas (mismo patrón ya probado en
    // app/api/headcount/route.ts) en vez de un solo .or() con and/or
    // anidados -- más verboso, pero evita inventar sintaxis PostgREST no
    // probada en este repo.
    const cols = "identificacion, nombre, cargo, estado, admin, idempresa"
    const [operativos, administrativos] = await Promise.all([
      admin.from("headcount").select(cols).eq("idempresa", empresaId).not("admin", "is", true),
      admin.from("headcount").select(cols).eq("admin", true).or(`idempresa.eq.${empresaId},idempresa.is.null`),
    ])
    if (operativos.error) return { success: false, data: [], message: operativos.error.message }
    if (administrativos.error) return { success: false, data: [], message: administrativos.error.message }
    const data = [...(operativos.data || []), ...(administrativos.data || [])]

    const personas = (data || [])
      .filter((h: any) => {
        const nombre = String(h.nombre || "").trim()
        return nombre && !/prueba/i.test(nombre) && !/sin auxiliar/i.test(nombre)
      })
      .map((h: any) => ({
        identificacion: String(h.identificacion || "").trim(),
        nombre: String(h.nombre || "").trim(),
        cargo: h.cargo ?? null,
        estado: h.estado ?? null,
        admin: h.admin === true,
      }))
      .sort((a: PersonaAsistenciaAdmin, b: PersonaAsistenciaAdmin) => {
        const aActivo = String(a.estado || "").toUpperCase() === "ACTIVO"
        const bActivo = String(b.estado || "").toUpperCase() === "ACTIVO"
        if (aActivo !== bActivo) return aActivo ? -1 : 1
        return a.nombre.localeCompare(b.nombre)
      })
    return { success: true, data: personas }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al cargar el personal." }
  }
}

export interface EstadoHoyAdministrativo extends PersonaAsistenciaAdmin {
  tieneHoy: boolean
}

/**
 * Estado de HOY (o la fecha dada) para el personal administrativo activo:
 * quién ya tiene fila en `registroasistencia` y quién falta. Pensado para
 * que el registro sea DIARIO (a pedido del usuario) y no se acumule para
 * fin de mes -- da visibilidad de "quién falta marcar hoy" de un vistazo.
 */
export async function getEstadoHoyAdministrativos(
  empresaId: number,
  fecha?: string,
): Promise<{ success: boolean; data: EstadoHoyAdministrativo[]; message?: string }> {
  try {
    const fechaRef = fecha || new Date().toISOString().slice(0, 10)
    const personasRes = await getPersonasAsistenciaAdministrativa(empresaId)
    if (!personasRes.success) return { success: false, data: [], message: personasRes.message }
    const administrativos = personasRes.data.filter(
      (p) => p.admin && String(p.estado || "").toUpperCase() === "ACTIVO",
    )
    if (administrativos.length === 0) return { success: true, data: [] }

    const admin: any = await getSupabaseAdmin()
    const { data: filasHoy, error } = await admin
      .from("registroasistencia")
      .select("identificacion")
      .eq("idempresa", empresaId)
      .eq("fecha", fechaRef)
      .in("identificacion", administrativos.map((p) => p.identificacion))
    if (error) return { success: false, data: [], message: error.message }
    const conFila = new Set((filasHoy || []).map((r: any) => String(r.identificacion).trim()))

    const resultado = administrativos
      .map((p) => ({ ...p, tieneHoy: conFila.has(p.identificacion) }))
      .sort((a, b) => Number(a.tieneHoy) - Number(b.tieneHoy) || a.nombre.localeCompare(b.nombre))
    return { success: true, data: resultado }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al calcular el estado de hoy." }
  }
}

export interface FilaHistorialAsistencia {
  id: number
  fecha: string
  puesto: string | null
  asistencia: string | null
  especialidad: boolean
  horasturno: number | null
}

/** Historial de UNA persona (no de toda la empresa). Por defecto, últimos 90 días. */
export async function getHistorialAsistenciaPersona(
  empresaId: number,
  identificacion: string,
  desde?: string,
  hasta?: string,
): Promise<{ success: boolean; data: FilaHistorialAsistencia[]; message?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()
    const hastaReal = hasta || new Date().toISOString().slice(0, 10)
    const desdeReal = desde || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data, error } = await admin
      .from("registroasistencia")
      .select("id, fecha, puesto, asistencia, especialidad, horasturno")
      .eq("idempresa", empresaId)
      .eq("identificacion", identificacion)
      .gte("fecha", desdeReal)
      .lte("fecha", hastaReal)
      .order("fecha", { ascending: false })
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: data || [] }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al cargar el historial." }
  }
}

export interface UpsertAsistenciaInput {
  empresaId: number
  identificacion: string
  nombre: string
  fechaInicio: string // YYYY-MM-DD
  fechaFin?: string // default = fechaInicio (día único)
  tipo: "TRABAJADO" | "NOVEDAD"
  novedad?: NovedadDia // requerido si tipo === "NOVEDAD"
  puesto?: string // requerido si tipo === "TRABAJADO" y esAdministrativo=false
  esAdministrativo: boolean

  // --- Horas extra del día (solo operativo, tipo=TRABAJADO, día ÚNICO -- las
  // horas extra varían día a día, no tiene sentido aplicar el mismo valor a
  // todo un rango). Cierra un hueco real: "Asignación horas extra"
  // (app/api/extra-hours/route.ts) solo puede ACTUALIZAR una fila que ya
  // exista (nunca crea una donde no hay ninguna) y solo cubre puestos de
  // especialidad -- si el día no existía en absoluto (el caso que este
  // módulo resuelve), no había forma de registrarle horas extra en ningún
  // lado.
  //
  // DOS CAMINOS, no se mezclan:
  //  (a) Horario real (horaIngreso/horaSalida + programada) -- SOLO puestos
  //      de especialidad: el trigger `trg_calcular_horas_extras`
  //      (scripts/sig/57_politica_horas_extra.sql) calcula hed/hedf solo
  //      ÉL, con la MISMA política que usa el flujo normal de campo. No se
  //      tocan hed/hedf a mano aquí -- el trigger los sobreescribe en el
  //      INSERT/UPDATE.
  //  (b) Horas manuales (hed/hedf/hen/hef/hn directos) -- para puestos SIN
  //      especialidad (el trigger no aplica) o cuando ya se conoce el
  //      número exacto sin reconstruir el horario. Se marca
  //      `extras_manual=true` para que el trigger NO las recalcule/pise.
  horaIngreso?: string // "HH:MM"
  horaSalida?: string
  horaEntradaProgramada?: string
  horaSalidaProgramada?: string
  hed?: number
  hedf?: number
  hen?: number
  hef?: number
  hn?: number
  // Refleja `registroasistencia.aprobado`: SOLO cuenta para nómina
  // (pagonomina exige aprobado='aprobado') si se marca explícito aquí --
  // por diseño, nunca se auto-aprueba. Mismo control de negocio que ya
  // existe en "Asignación horas extra", ahora también disponible para
  // correcciones retroactivas.
  aprobarHorasExtra?: boolean
}

function listaFechas(desde: string, hasta: string): string[] {
  const out: string[] = []
  let cur = new Date(`${desde}T00:00:00Z`)
  const fin = new Date(`${hasta}T00:00:00Z`)
  while (cur.getTime() <= fin.getTime()) {
    out.push(cur.toISOString().slice(0, 10))
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000)
  }
  return out
}

/**
 * Upsert central: por cada fecha del rango, busca fila existente por
 * (idempresa, identificacion, fecha) -> UPDATE si existe, o acumula para
 * INSERT en bloque SIN fijar `id` si no existe (la secuencia de Postgres lo
 * asigna -- mismo patrón que lib/vacaciones-actions.ts `aprobarSolicitudVacaciones`).
 * Sin restricción de "solo futuro" ni "solo hoy", a diferencia de todos los
 * demás flujos que escriben `registroasistencia`.
 */
export async function upsertAsistenciaDia(
  input: UpsertAsistenciaInput,
): Promise<{ success: boolean; diasAfectados?: number; diasOmitidos?: string[]; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Asistencia Administrativa"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const { empresaId, identificacion, nombre, tipo, esAdministrativo } = input
  if (!empresaId || !identificacion || !nombre || !input.fechaInicio) {
    return { success: false, message: "Datos incompletos." }
  }
  if (tipo === "NOVEDAD" && !input.novedad) {
    return { success: false, message: "Falta seleccionar la novedad." }
  }
  if (tipo === "TRABAJADO" && !esAdministrativo && !input.puesto) {
    return { success: false, message: "Falta seleccionar el puesto." }
  }

  const esRetiro = tipo === "NOVEDAD" && String(input.novedad || "").toLowerCase().includes("retiro")
  const tieneHorarioReal = !!(input.horaIngreso || input.horaSalida)
  const tieneHorasManuales = [input.hed, input.hedf, input.hen, input.hef, input.hn].some((v) => v != null)
  // Salvaguarda defensiva: "Retiro" nunca aplica a un rango (ambigüedad de
  // cuál fecha queda como fecha_retiro final), y las horas extra tampoco
  // (varían día a día, sea por horario real o manuales) -- la UI ya impide
  // ambos casos, esto blinda la server action si se llama de otro lado.
  let fechaFin = input.fechaFin || input.fechaInicio
  if (esRetiro || tieneHorarioReal || tieneHorasManuales) fechaFin = input.fechaInicio
  const fechas = listaFechas(input.fechaInicio, fechaFin)

  try {
    const admin: any = await getSupabaseAdmin()

    let filaBase: Record<string, any>
    if (tipo === "NOVEDAD") {
      filaBase = { asistencia: input.novedad, puesto: null, horasturno: null, especialidad: false }
    } else if (esAdministrativo) {
      // "Descanso" (no un puesto real) -- BUG REAL encontrado y corregido
      // 2026-09-09: marcar el día con un `puesto` no-null (como se hacía
      // antes con PUESTO_ADMINISTRATIVO) activa `asistio_ok`/"trabajo
      // efectivo" en pagonomina, y en domingos/festivos eso disparaba el
      // recargo dominical a tarifa completa (×1,9) POR ENCIMA del
      // salario/30 -- sobrepago real confirmado en 7 personas reales de
      // agosto-2026 antes de revertirlo. "Descanso" da exactamente
      // valor_diario_ley (salario/30) todos los días, sin recargo
      // dominical/festivo, y sigue clasificando como TRAB
      // (clasificarDiaCotizacion) para parafiscales/aux. de transporte.
      filaBase = { asistencia: "Descanso", puesto: null, horasturno: null, especialidad: false }
    } else {
      const esEspecialidad = (ESPECIALIDADES_OPTIONS as readonly string[]).includes(input.puesto!)
      filaBase = {
        asistencia: null,
        puesto: input.puesto,
        especialidad: esEspecialidad,
        horasturno: esEspecialidad ? horasTurnoParaEspecialidad(input.puesto) : null,
      }
      // Solo se incluyen los campos que el usuario realmente diligenció --
      // en un UPDATE, omitir un campo lo deja intacto (no borra horas extra
      // que ya existieran por otra vía, ej. Asignación horas extra).
      //
      // (a) Horario real: se deja que el TRIGGER `trg_calcular_horas_extras`
      // calcule hed/hedf -- NO se fijan aquí a mano. Solo aplica de verdad
      // si el puesto es de especialidad (el trigger lo exige); en un puesto
      // sin especialidad estas horas quedan guardadas pero el trigger no
      // las usa (no hay política de horas extra para puestos normales).
      if (input.horaIngreso) filaBase.horaingreso = input.horaIngreso
      if (input.horaSalida) filaBase.horasalida = input.horaSalida
      if (input.horaEntradaProgramada) filaBase.horaentradaprogramada = input.horaEntradaProgramada
      if (input.horaSalidaProgramada) filaBase.horasalidaprogramada = input.horaSalidaProgramada
      // (b) Horas manuales: directo a hed/hedf/hen/hef/hn, con
      // extras_manual=true para que el trigger no las recalcule/pise en un
      // guardado posterior (ver comentario del trigger: "ajuste manual: no
      // se tocan").
      if (tieneHorasManuales) {
        filaBase.extras_manual = true
        if (input.hed != null) filaBase.hed = input.hed
        if (input.hedf != null) filaBase.hedf = input.hedf
        if (input.hen != null) filaBase.hen = input.hen
        if (input.hef != null) filaBase.hef = input.hef
        if (input.hn != null) filaBase.hn = input.hn
      }
      // Aprobación: nunca automática. Solo se fija si el usuario la marcó
      // explícitamente -- pagonomina exige aprobado='aprobado' para contar
      // las horas extra en nómina (mismo control que ya existe en
      // "Asignación horas extra").
      if (input.aprobarHorasExtra) filaBase.aprobado = "aprobado"
    }

    const { data: existentes, error: exErr } = await admin
      .from("registroasistencia")
      .select("id, fecha")
      .eq("idempresa", empresaId)
      .eq("identificacion", identificacion)
      .in("fecha", fechas)
    if (exErr) return { success: false, message: exErr.message }

    const filasPorFecha = new Map<string, number[]>()
    for (const r of existentes || []) {
      const f = String(r.fecha).slice(0, 10)
      const arr = filasPorFecha.get(f) || []
      arr.push(r.id)
      filasPorFecha.set(f, arr)
    }

    const diasOmitidos: string[] = []
    const nuevos: any[] = []
    let diasAfectados = 0

    for (const fecha of fechas) {
      const ids = filasPorFecha.get(fecha)
      if (ids && ids.length > 1) {
        // Multi-turno (columna `turno`): no se decide por cuál fila -- se
        // omite y se corrige aparte desde Tabla Asistencia/Visor.
        diasOmitidos.push(fecha)
        continue
      }
      if (ids && ids.length === 1) {
        const { error } = await admin.from("registroasistencia").update(filaBase).eq("id", ids[0])
        if (error) return { success: false, message: error.message }
      } else {
        nuevos.push({ idempresa: empresaId, fecha, nombre, identificacion, ...filaBase })
      }
      diasAfectados++
    }

    if (nuevos.length > 0) {
      const { error: insErr } = await admin.from("registroasistencia").insert(nuevos)
      if (insErr) return { success: false, message: insErr.message }
    }

    if (esRetiro) {
      await procesarNovedadRetiro({
        identificacion,
        fecha: input.fechaInicio,
        asistencia: input.novedad,
        idempresa: empresaId,
      })
    }

    // Reconciliar borradores de ausentismo (mismo patrón que
    // app/api/personnel-notices/route.ts): basta con los dos extremos del
    // rango, la ventana de sincronización ya cubre ±31/180 días.
    const refFechas = Array.from(new Set([input.fechaInicio, fechaFin]))
    await Promise.all(refFechas.map((f) => sincronizarBorradorAusentismo(empresaId, identificacion, f)))

    return { success: true, diasAfectados, diasOmitidos: diasOmitidos.length ? diasOmitidos : undefined }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar la asistencia." }
  }
}

function hoyBogota(): string {
  const b = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }))
  return `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, "0")}-${String(b.getDate()).padStart(2, "0")}`
}

/** Rango [1-15] o [16-fin de mes] de la fecha dada, recortado a "hoy" si la quincena está en curso. */
function rangoQuincenaActual(hoy: string): { desde: string; hasta: string } {
  const [anioStr, mesStr, diaStr] = hoy.split("-")
  const anio = Number(anioStr)
  const mes = Number(mesStr)
  const dia = Number(diaStr)
  const p = (n: number) => String(n).padStart(2, "0")
  if (dia <= 15) {
    return { desde: `${anio}-${p(mes)}-01`, hasta: `${anio}-${p(mes)}-15` }
  }
  const ultimoDia = new Date(anio, mes, 0).getDate() // día 0 del mes siguiente = último día de este mes
  return { desde: `${anio}-${p(mes)}-16`, hasta: `${anio}-${p(mes)}-${p(Math.min(ultimoDia, dia))}` }
}

export interface ResultadoCompletarQuincena {
  success: boolean
  message?: string
  periodo?: { desde: string; hasta: string }
  personasCompletadas: number
  diasCompletados: number
  detalle: { nombre: string; dias: string[] }[]
}

/**
 * Completa, SOLO para el personal ADMINISTRATIVO (headcount.admin=true) del
 * proyecto, los días de la quincena EN CURSO (1-15 o 16-fin de mes, recortada
 * a hoy) que NO tengan NINGUNA fila en `registroasistencia` -- los marca
 * exactamente con el MISMO mecanismo que ya usa esta pantalla para marcar un
 * día individual como trabajado (`upsertAsistenciaDia`, tipo="TRABAJADO",
 * esAdministrativo=true -- ver el comentario del bug de 2026-09-09 ahí
 * mismo: paga el día completo sin disparar recargo dominical/festivo).
 *
 * NUNCA toca un día que YA tenga una fila -- se identifican los huecos
 * primero y solo se llaman uno por uno (nunca con el rango completo, que
 * SÍ actualizaría filas existentes -- ver upsertAsistenciaDia). Pedido del
 * usuario 2026-09-14: "marcar toda la quincena a los administrativos con
 * asistencia todos los días, los días que hagan falta".
 */
export async function completarQuincenaAdministrativos(empresaId: number): Promise<ResultadoCompletarQuincena> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Asistencia Administrativa"], "cerrar", "Completar quincena")
  if (motivoAccion) return { success: false, message: motivoAccion, personasCompletadas: 0, diasCompletados: 0, detalle: [] }
  if (!empresaId) return { success: false, message: "Falta el proyecto.", personasCompletadas: 0, diasCompletados: 0, detalle: [] }
  try {
    const personasR = await getPersonasAsistenciaAdministrativa(empresaId)
    if (!personasR.success) {
      return { success: false, message: personasR.message, personasCompletadas: 0, diasCompletados: 0, detalle: [] }
    }
    const administrativos = personasR.data.filter((p) => p.admin && String(p.estado || "").toUpperCase() === "ACTIVO")
    if (administrativos.length === 0) {
      return { success: true, personasCompletadas: 0, diasCompletados: 0, detalle: [] }
    }

    const { desde, hasta } = rangoQuincenaActual(hoyBogota())
    const fechas = listaFechas(desde, hasta)

    const admin: any = await getSupabaseAdmin()
    const detalle: { nombre: string; dias: string[] }[] = []
    let diasCompletados = 0

    for (const persona of administrativos) {
      const { data: existentes } = await admin
        .from("registroasistencia")
        .select("fecha")
        .eq("idempresa", empresaId)
        .eq("identificacion", persona.identificacion)
        .in("fecha", fechas)
      const fechasConRegistro = new Set((existentes || []).map((r: any) => String(r.fecha).slice(0, 10)))
      const faltantes = fechas.filter((f) => !fechasConRegistro.has(f))
      if (faltantes.length === 0) continue

      const diasOk: string[] = []
      for (const fecha of faltantes) {
        const r = await upsertAsistenciaDia({
          empresaId,
          identificacion: persona.identificacion,
          nombre: persona.nombre,
          fechaInicio: fecha,
          fechaFin: fecha,
          tipo: "TRABAJADO",
          esAdministrativo: true,
        })
        if (r.success) diasOk.push(fecha)
      }
      if (diasOk.length > 0) {
        detalle.push({ nombre: persona.nombre, dias: diasOk })
        diasCompletados += diasOk.length
      }
    }

    return { success: true, periodo: { desde, hasta }, personasCompletadas: detalle.length, diasCompletados, detalle }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al completar la quincena.", personasCompletadas: 0, diasCompletados: 0, detalle: [] }
  }
}
