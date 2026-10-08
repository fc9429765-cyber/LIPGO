"use server"

/**
 * Server actions de "Asignación de apoyo en cargue" (Compensación).
 *
 * Picking/Packing solo permiten asignar personal de los puestos operativos de
 * cargue (`PUESTOS_PICKING`, lib/picking-actions.ts). Este módulo aparte deja
 * AGREGAR (nunca reemplazar) personas de fuera de ese grupo — típicamente
 * personal de turno fijo (`especialidad=true`) — a una orden de Cargue o
 * Descargue ya existente, para que también entren en el reparto de toneladas
 * de esa orden vía `cabeceraoc.auxiliares`.
 *
 * El reparto por persona replica EXACTAMENTE el de `pagonomina`
 * (peso_base_calculo ÷ cantidad_auxiliares × tarifa vigente en
 * `tarifaspersonal`), mismo patrón que lib/ajuste-proyeccion-actions.ts.
 *
 * Cada persona agregada desde aquí queda registrada en
 * `apoyo_cargue_asignaciones` (scripts/127_add_apoyo_cargue.sql) — es el rastro
 * que usa la vista `pagonomina` para permitirle el bono de toneladas a un
 * especialidad=true SOLO ese día/orden, sin relajar la regla en general.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaId } from "@/lib/company-filter"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { getColombiaDateTime } from "@/lib/date-utils"
import { estadoQuincena } from "@/lib/quincena-abierta"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const num = (v: any) => Number(v || 0)

/** Réplica de `peso_base_calculo` de 053_pagonomina_reemplazo.sql (líneas 85-87). */
function pesoBaseCalculo(idempresa: number, tipooperacion: string, pesovascula: number, pesoorden: number): number {
  const cedis = idempresa === 3 || idempresa === 4
  if (cedis && tipooperacion === "Descargue") {
    if (pesovascula <= 0) return pesoorden
    const norm = pesoorden > 0 && pesovascula / pesoorden > 50 ? pesovascula / 1000 : pesovascula
    if (pesoorden > 0) {
      const r = norm / pesoorden
      if (r < 0.1 || r > 10) return pesoorden
    }
    return norm
  }
  if (cedis) return pesoorden
  return pesovascula
}

function esEspecialidad(v: any): boolean {
  return v === true || String(v).toLowerCase() === "true"
}

/** Suma horas ENTERAS a una hora "HH:MM" (envuelve pasada medianoche). */
function sumarHoras(hora: string, horas: number): string {
  const [h, m] = hora.split(":").map(Number)
  const total = (h + horas) % 24
  return `${String(total).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export interface PersonaPago {
  persona: string
  toneladas: number
  pago: number
}

export interface OrdenApoyo {
  id: number
  ordendecargue: string
  tipooperacion: string
  placa: string | null
  fechacargue: string
  pesoBase: number
  tarifa: number
  auxiliares: string[]
  pagoActualPorPersona: PersonaPago[]
}

/** Órdenes de Cargue/Descargue de un día, con toneladas/auxiliares/pago actual por persona. */
export async function getOrdenesApoyoDelDia(
  fecha: string,
  idempresaOpcional?: number | null,
): Promise<{ success: boolean; data: OrdenApoyo[]; message?: string }> {
  try {
    const admin = await getSupabaseAdmin()
    const idempresa = idempresaOpcional ?? (await getCurrentEmpresaId())

    let q = admin
      .from("cabeceraoc")
      .select("id, ordendecargue, idempresa, tipooperacion, placa, fechacargue, pesovascula, pesoorden, auxiliares")
      .in("tipooperacion", ["Cargue", "Descargue"])
      .eq("fechacargue", fecha)
    if (idempresa) q = q.eq("idempresa", idempresa)
    const { data: ordenes, error } = await q.order("id", { ascending: false })
    if (error) throw new Error(error.message)

    const empresasEnJuego = Array.from(new Set((ordenes || []).map((o: any) => Number(o.idempresa))))
    const { data: tarifas } = await admin
      .from("tarifaspersonal")
      .select("empresaid, operacion, tarifa, fechaini, fechafin")
      .in("empresaid", empresasEnJuego.length ? empresasEnJuego : [0])

    const tarifaDe = (empresaId: number, operacion: string, fechaStr: string): number => {
      for (const t of tarifas || []) {
        if (Number(t.empresaid) !== empresaId) continue
        if (String(t.operacion) !== operacion) continue
        if (String(t.fechaini).slice(0, 10) <= fechaStr && fechaStr <= String(t.fechafin).slice(0, 10)) return num(t.tarifa)
      }
      return 0
    }

    const out: OrdenApoyo[] = (ordenes || []).map((o: any) => {
      const emp = Number(o.idempresa)
      const tipo = String(o.tipooperacion || "").trim()
      const fechaStr = String(o.fechacargue).slice(0, 10)
      const pesoBase = pesoBaseCalculo(emp, tipo, num(o.pesovascula), num(o.pesoorden))
      const aux = String(o.auxiliares || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
      const tarifa = tarifaDe(emp, tipo, fechaStr)
      const porPersona = aux.length > 0 ? pesoBase / aux.length : 0

      return {
        id: o.id,
        ordendecargue: o.ordendecargue,
        tipooperacion: tipo,
        placa: o.placa ?? null,
        fechacargue: fechaStr,
        pesoBase,
        tarifa,
        auxiliares: aux,
        pagoActualPorPersona: aux.map((persona: string) => ({
          persona,
          toneladas: porPersona,
          pago: porPersona * tarifa,
        })),
      }
    })

    return { success: true, data: out }
  } catch (e: any) {
    console.error("[apoyo-cargue] getOrdenesApoyoDelDia:", e)
    return { success: false, data: [], message: e?.message || "Error al cargar las órdenes" }
  }
}

export interface PersonalApoyoDisponible {
  id: number
  nombre: string
  puesto: string | null
  especialidad: boolean
}

/**
 * Personal presente ese día (registroasistencia), SIN restricción de puesto
 * — a diferencia de getCarguDescarguePersonnel (Picking/Packing), que solo
 * ofrece PUESTOS_PICKING. Aquí el objetivo es justamente poder ofrecer
 * también al personal de turno fijo (especialidad=true).
 *
 * Reglas de disponibilidad (confirmadas por el usuario 2026-09-07, mismo
 * criterio ya validado en lib/picking-actions.ts para Personal disponible):
 *   - Quien ya marcó salida (`horasalida`) ya no está en el proyecto: no
 *     disponible, sin importar la especialidad.
 *   - Si `especialidad=true` (puesto fijo/especializado), SOLO puede aparecer
 *     disponible para apoyar cargue una vez TERMINE su propio turno programado
 *     (`horasalidaprogramada`) -- de lo contrario estaría apoyando cargue
 *     mientras debería estar en su puesto de origen. Esta comparación de hora
 *     solo aplica si la fecha consultada es HOY (para una fecha pasada su
 *     turno ya terminó por definición; ver DatePickerField en el componente).
 *   - `especialidad=false` no tiene esa restricción de horario -- son puestos
 *     ya flexibles de cargue/descargue, igual que en Picking.
 */
export async function getPersonalApoyoDisponible(
  fecha: string,
  idempresaOpcional?: number | null,
): Promise<{ success: boolean; data: PersonalApoyoDisponible[]; message?: string }> {
  try {
    const admin = await getSupabaseAdmin()
    const idempresa = idempresaOpcional ?? (await getCurrentEmpresaId())

    let q = admin
      .from("registroasistencia")
      .select("id, nombre, identificacion, puesto, especialidad, horasalidaprogramada")
      .eq("fecha", fecha)
      .is("asistencia", null) // excluye Ausentes
      .not("horaingreso", "is", null) // excluye programados que no han confirmado llegada (ver picking-actions.ts)
      .is("horasalida", null) // excluye a quien ya marcó salida real: ya salió del proyecto hoy
      .order("nombre", { ascending: true })
    if (idempresa) q = q.eq("idempresa", idempresa)
    const { data, error } = await q
    if (error) throw new Error(error.message)

    // Horas Extra APROBADAS ese mismo día (Servicios Adicionales → Aprobar
    // Turnos) EXTIENDEN el turno programado -- sin esto, alguien con una
    // extensión aprobada aparecía "disponible para apoyo" desde su hora
    // original, mientras en realidad seguía comprometido en su propio
    // puesto. Cruce por cédula primero (más confiable), con caída a nombre
    // para solicitudes viejas sin cédula guardada (mismo criterio que
    // app/api/extra-hours/route.ts). Usuario 2026-09-14.
    const horasExtraPorPersona = new Map<string, number>()
    if ((data || []).some((r: any) => esEspecialidad(r.especialidad))) {
      const { data: extras } = await admin
        .from("solicitud_horas_extras")
        .select("nombre_empleado, identificacion_empleado, cantidad")
        .eq("fecharequerida", fecha)
        .eq("idempresa", idempresa)
      for (const ex of extras || []) {
        const key = String(ex.identificacion_empleado || "").trim() || `nombre:${String(ex.nombre_empleado || "").trim().toUpperCase()}`
        horasExtraPorPersona.set(key, (horasExtraPorPersona.get(key) || 0) + (Number(ex.cantidad) || 0))
      }
    }

    const colombiaDate = await getColombiaDateTime()
    const esHoy = fecha === colombiaDate.toLocaleDateString("en-CA")
    const horaActual = colombiaDate.toTimeString().slice(0, 5)

    const disponibles = (data || []).filter((r: any) => {
      if (!esEspecialidad(r.especialidad)) return true
      if (!esHoy) return true // fecha pasada: su turno ya terminó
      const horaSalidaProgramada = (r.horasalidaprogramada || "").toString().slice(0, 5)
      if (!horaSalidaProgramada) return true // sin dato programado: se deja disponible (dato incompleto, no regla de negocio)
      const cedula = String(r.identificacion || "").trim()
      const horasExtra =
        horasExtraPorPersona.get(cedula) ??
        horasExtraPorPersona.get(`nombre:${String(r.nombre || "").trim().toUpperCase()}`) ??
        0
      const horaEfectiva = horasExtra > 0 ? sumarHoras(horaSalidaProgramada, horasExtra) : horaSalidaProgramada
      return horaActual >= horaEfectiva
    })

    const out: PersonalApoyoDisponible[] = disponibles.map((r: any) => ({
      id: r.id,
      nombre: r.nombre,
      puesto: r.puesto ?? null,
      especialidad: esEspecialidad(r.especialidad),
    }))

    return { success: true, data: out }
  } catch (e: any) {
    console.error("[apoyo-cargue] getPersonalApoyoDisponible:", e)
    return { success: false, data: [], message: e?.message || "Error al cargar el personal" }
  }
}

export interface PreviewPersona {
  persona: string
  antes: number | null // null = persona nueva, no tenía pago antes
  despues: number
}

export interface PreviewApoyo {
  pesoBase: number
  tarifa: number
  cantidadAntes: number
  cantidadDespues: number
  personas: PreviewPersona[]
}

/** Previsualiza cómo queda el pago por persona de una orden si se agregan nombresNuevos. No escribe nada. */
export async function previsualizarApoyo(
  idorden: number,
  nombresNuevos: string[],
): Promise<{ success: boolean; data?: PreviewApoyo; message?: string }> {
  try {
    const admin = await getSupabaseAdmin()
    const { data: o, error } = await admin
      .from("cabeceraoc")
      .select("id, idempresa, tipooperacion, fechacargue, pesovascula, pesoorden, auxiliares")
      .eq("id", idorden)
      .single()
    if (error || !o) throw new Error(error?.message || "Orden no encontrada")

    const emp = Number(o.idempresa)
    const tipo = String(o.tipooperacion || "").trim()
    const fechaStr = String(o.fechacargue).slice(0, 10)
    const pesoBase = pesoBaseCalculo(emp, tipo, num(o.pesovascula), num(o.pesoorden))
    const actuales = String(o.auxiliares || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)
    const nuevosLimpios = Array.from(new Set(nombresNuevos.map((s) => s.trim()).filter(Boolean))).filter(
      (n) => !actuales.some((a) => a.toUpperCase() === n.toUpperCase()),
    )

    const { data: tarifas } = await admin
      .from("tarifaspersonal")
      .select("tarifa, fechaini, fechafin")
      .eq("empresaid", emp)
      .eq("operacion", tipo)
    let tarifa = 0
    for (const t of tarifas || []) {
      if (String(t.fechaini).slice(0, 10) <= fechaStr && fechaStr <= String(t.fechafin).slice(0, 10)) {
        tarifa = num(t.tarifa)
        break
      }
    }

    const cantidadAntes = actuales.length
    const cantidadDespues = actuales.length + nuevosLimpios.length
    const porPersonaAntes = cantidadAntes > 0 ? pesoBase / cantidadAntes : 0
    const porPersonaDespues = cantidadDespues > 0 ? pesoBase / cantidadDespues : 0

    const personas: PreviewPersona[] = [
      ...actuales.map((persona) => ({
        persona,
        antes: porPersonaAntes * tarifa,
        despues: porPersonaDespues * tarifa,
      })),
      ...nuevosLimpios.map((persona) => ({
        persona,
        antes: null,
        despues: porPersonaDespues * tarifa,
      })),
    ]

    return {
      success: true,
      data: { pesoBase, tarifa, cantidadAntes, cantidadDespues, personas },
    }
  } catch (e: any) {
    console.error("[apoyo-cargue] previsualizarApoyo:", e)
    return { success: false, message: e?.message || "Error al previsualizar" }
  }
}

/** Agrega (nunca reemplaza) personas a cabeceraoc.auxiliares y las rastrea en apoyo_cargue_asignaciones. */
export async function agregarApoyoAOrden(
  idorden: number,
  nombresNuevos: string[],
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Asignación de apoyo en cargue"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const admin = await getSupabaseAdmin()
    const usuarioActual = await getCurrentUsuarioForInsert()

    const { data: o, error } = await admin
      .from("cabeceraoc")
      .select("id, idempresa, fechacargue, auxiliares")
      .eq("id", idorden)
      .single()
    if (error || !o) throw new Error(error?.message || "Orden no encontrada")

    // Solo se corrige la quincena en curso: las anteriores ya se pagaron.
    const q = estadoQuincena(String(o.fechacargue).slice(0, 10))
    if (!q.abierta) return { success: false, message: q.motivo ?? "La quincena de esa orden ya está cerrada" }

    const actuales = String(o.auxiliares || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)
    const nuevosLimpios = Array.from(new Set(nombresNuevos.map((s) => s.trim()).filter(Boolean))).filter(
      (n) => !actuales.some((a) => a.toUpperCase() === n.toUpperCase()),
    )
    if (nuevosLimpios.length === 0) {
      return { success: false, message: "No hay personas nuevas para agregar" }
    }

    const combinados = [...actuales, ...nuevosLimpios]
    const { error: errUpd } = await admin
      .from("cabeceraoc")
      .update({ auxiliares: combinados.join(",") })
      .eq("id", idorden)
    if (errUpd) throw new Error(errUpd.message)

    const fecha = String(o.fechacargue).slice(0, 10)
    const filas = nuevosLimpios.map((persona) => ({
      idorden,
      idempresa: Number(o.idempresa),
      fecha,
      persona,
      asignado_por: usuarioActual,
    }))
    const { error: errIns } = await admin.from("apoyo_cargue_asignaciones").insert(filas)
    if (errIns) throw new Error(errIns.message)

    return { success: true }
  } catch (e: any) {
    console.error("[apoyo-cargue] agregarApoyoAOrden:", e)
    return { success: false, message: e?.message || "Error al agregar el apoyo" }
  }
}

/**
 * Saca a una persona del reparto de toneladas de una orden.
 *
 * Hasta el 2026-10-06 solo se podía sacar a quien este mismo módulo había
 * agregado. Por decisión de gerencia ahora también se puede sacar a un auxiliar
 * asignado en Picking/Packing — es lo que hacía falta para poder corregir de
 * verdad una quincena. Cada exclusión queda registrada en
 * `apoyo_cargue_exclusiones` (quién y cuándo), además del antes/después que el
 * trigger de auditoría ya guarda de `cabeceraoc.auxiliares`.
 */
export async function quitarApoyoDeOrden(idorden: number, persona: string): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Asignación de apoyo en cargue"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const admin = await getSupabaseAdmin()
    const usuarioActual = await getCurrentUsuarioForInsert()

    const { data: rastro } = await admin
      .from("apoyo_cargue_asignaciones")
      .select("id")
      .eq("idorden", idorden)
      .ilike("persona", persona)
      .limit(1)
    const veniaDeEsteModulo = !!rastro && rastro.length > 0

    const { data: o, error } = await admin
      .from("cabeceraoc")
      .select("id, idempresa, fechacargue, auxiliares")
      .eq("id", idorden)
      .single()
    if (error || !o) throw new Error(error?.message || "Orden no encontrada")

    // Solo se corrige la quincena en curso: las anteriores ya se pagaron.
    const q = estadoQuincena(String(o.fechacargue).slice(0, 10))
    if (!q.abierta) return { success: false, message: q.motivo ?? "La quincena de esa orden ya está cerrada" }

    const actuales = String(o.auxiliares || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)
    const restantes = actuales.filter((a) => a.toUpperCase() !== persona.trim().toUpperCase())
    if (restantes.length === actuales.length) {
      return { success: false, message: "Esa persona no está en el reparto de la orden" }
    }
    if (restantes.length === 0) {
      // Sin auxiliares el reparto se queda sin entre quién dividir las toneladas:
      // la orden quedaría con el pago en el aire. Debe quedar al menos uno.
      return { success: false, message: "No se puede dejar la orden sin ningún auxiliar" }
    }

    const { error: errUpd } = await admin
      .from("cabeceraoc")
      .update({ auxiliares: restantes.join(",") })
      .eq("id", idorden)
    if (errUpd) throw new Error(errUpd.message)

    if (veniaDeEsteModulo) {
      await admin.from("apoyo_cargue_asignaciones").delete().eq("idorden", idorden).ilike("persona", persona)
    }

    // Rastro de quién lo sacó. Best-effort: si la tabla todavía no existe
    // (scripts/239), la exclusión igual se aplica — el antes/después queda en
    // `auditoria` de todas formas.
    try {
      await admin.from("apoyo_cargue_exclusiones").insert([
        {
          idorden,
          idempresa: Number(o.idempresa) || null,
          fecha: String(o.fechacargue || "").slice(0, 10) || null,
          persona: persona.trim(),
          origen: veniaDeEsteModulo ? "apoyo" : "picking",
          quitado_por: usuarioActual,
        },
      ])
    } catch {
      /* la tabla de rastro es opcional */
    }

    return { success: true }
  } catch (e: any) {
    console.error("[apoyo-cargue] quitarApoyoDeOrden:", e)
    return { success: false, message: e?.message || "Error al quitar el apoyo" }
  }
}

/** Una persona con reporte de asistencia del día, lista para marcar o desmarcar. */
export interface CandidatoApoyo {
  id: number
  nombre: string
  puesto: string | null
  especialidad: boolean
  turno: string | null
  entradaProgramada: string | null
  salidaProgramada: string | null
  horaIngreso: string | null
  horaSalida: string | null
  novedad: string | null
  /** en_piso | ya_salio | no_llego | novedad */
  estado: "en_piso" | "ya_salio" | "no_llego" | "novedad"
  /** Ya está en el reparto de toneladas de la orden (`cabeceraoc.auxiliares`). */
  enLaOrden: boolean
  /** Entró por este módulo, así que desde aquí se puede sacar. */
  sePuedeQuitar: boolean
  /** Cumple las reglas para entrar al reparto. */
  sePuedeAgregar: boolean
  /** Por qué no se puede agregar (null si sí se puede). */
  motivo: string | null
}

export interface CandidatosApoyoDia {
  fecha: string
  /** Los auxiliares de cargue y descargue con asistencia reportada ese día. */
  cuadrilla: CandidatoApoyo[]
  /** Personal de otros puestos que YA terminó su turno y queda habilitado para apoyar. */
  habilitados: CandidatoApoyo[]
  /** De otros puestos, los que todavía están en su propio turno (solo para el contador). */
  enTurnoPropio: number
}

/**
 * Los dos listados con los que se arma el apoyo de una orden, los dos tomados del
 * REPORTE DE ASISTENCIA del día (`registroasistencia`) — nunca del maestro de
 * personal ni de la nómina:
 *
 *   1. `cuadrilla`   — los auxiliares de cargue y descargue de ese día, con el
 *      estado en que quedó cada uno (en piso, ya salió, no llegó, novedad).
 *   2. `habilitados` — personal de OTROS puestos cuyo turno programado ya terminó
 *      (`horasalidaprogramada`, extendida por las horas extra aprobadas), que por
 *      eso queda libre para apoyar cargue sin abandonar su puesto.
 *
 * Cada fila dice si ya está en la orden, si se puede agregar y, cuando no, por qué.
 * Las reglas de disponibilidad son las MISMAS de `getPersonalApoyoDisponible`
 * (acordadas con el usuario el 2026-09-07 y el 2026-09-14); la diferencia es que
 * aquí también se devuelve a quien NO se puede asignar, para que el coordinador vea
 * el cuadro completo del día en vez de una lista recortada sin explicación.
 */
export async function getCandidatosApoyoDia(
  fecha: string,
  idorden?: number | null,
  idempresaOpcional?: number | null,
): Promise<{ success: boolean; data: CandidatosApoyoDia | null; message?: string }> {
  try {
    const admin = await getSupabaseAdmin()
    const idempresa = idempresaOpcional ?? (await getCurrentEmpresaId())

    let q = admin
      .from("registroasistencia")
      .select("id, nombre, identificacion, puesto, especialidad, turno, horaentradaprogramada, horasalidaprogramada, horaingreso, horasalida, asistencia")
      .eq("fecha", fecha)
      .order("nombre", { ascending: true })
    if (idempresa) q = q.eq("idempresa", idempresa)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const filas = data || []

    // Quiénes están ya en el reparto de la orden, y cuáles de ellos entraron por aquí.
    const enLaOrden = new Set<string>()
    const porEsteModulo = new Set<string>()
    if (idorden) {
      const { data: o } = await admin.from("cabeceraoc").select("auxiliares").eq("id", idorden).single()
      for (const a of String(o?.auxiliares || "").split(",")) {
        const t = a.trim().toUpperCase()
        if (t) enLaOrden.add(t)
      }
      const { data: rastro } = await admin.from("apoyo_cargue_asignaciones").select("persona").eq("idorden", idorden)
      for (const r of rastro || []) porEsteModulo.add(String(r.persona || "").trim().toUpperCase())
    }

    // Horas extra aprobadas: extienden el turno propio, así que quien tiene una
    // extensión aprobada todavía NO queda habilitado para apoyar.
    const horasExtraPorPersona = new Map<string, number>()
    {
      const { data: extras } = await admin
        .from("solicitud_horas_extras")
        .select("nombre_empleado, identificacion_empleado, cantidad")
        .eq("fecharequerida", fecha)
        .eq("idempresa", idempresa)
      for (const ex of extras || []) {
        const key = String(ex.identificacion_empleado || "").trim() || `nombre:${String(ex.nombre_empleado || "").trim().toUpperCase()}`
        horasExtraPorPersona.set(key, (horasExtraPorPersona.get(key) || 0) + (Number(ex.cantidad) || 0))
      }
    }

    const colombiaDate = await getColombiaDateTime()
    const esHoy = fecha === colombiaDate.toLocaleDateString("en-CA")
    const horaActual = colombiaDate.toTimeString().slice(0, 5)
    const hora = (v: any) => {
      const s = String(v ?? "").trim()
      return s ? s.slice(0, 5) : null
    }
    const esCargue = (p: any) => {
      const t = String(p ?? "").toLowerCase()
      return t.includes("cargue") || t.includes("descargue")
    }
    /** Hora a la que de verdad queda libre: turno programado + horas extra aprobadas. */
    const horaLibre = (r: any): string | null => {
      const prog = hora(r.horasalidaprogramada)
      if (!prog) return null
      const cedula = String(r.identificacion || "").trim()
      const extra =
        horasExtraPorPersona.get(cedula) ??
        horasExtraPorPersona.get(`nombre:${String(r.nombre || "").trim().toUpperCase()}`) ??
        0
      return extra > 0 ? sumarHoras(prog, extra) : prog
    }

    const aCandidato = (r: any): CandidatoApoyo => {
      const novedad = r.asistencia ? String(r.asistencia) : null
      const horaIngreso = hora(r.horaingreso)
      const horaSalida = hora(r.horasalida)
      const nombreUp = String(r.nombre || "").trim().toUpperCase()
      const estado: CandidatoApoyo["estado"] = novedad ? "novedad" : horaSalida ? "ya_salio" : horaIngreso ? "en_piso" : "no_llego"

      // Reglas para poder entrar al reparto:
      //   * Con novedad del día (ausente) nunca: no trabajó.
      //   * Sin hora de ingreso nunca: no estuvo en el proyecto ese día.
      //   * "Ya marcó salida" y "sigue en su turno" solo aplican SI LA FECHA ES HOY:
      //     son reglas del momento (no se puede mandar a apoyar a quien ya se fue o
      //     a quien debería estar en su puesto). En un día pasado el apoyo se
      //     registra en retrospectiva y esas dos condiciones ya no significan nada
      //     — sin esto no se podía corregir ni un solo día anterior.
      let motivo: string | null = null
      if (novedad) motivo = "Novedad del día: " + novedad
      else if (!horaIngreso) motivo = "No registró llegada ese día"
      else if (esHoy && horaSalida) motivo = "Ya marcó salida a las " + horaSalida
      else if (esHoy && esEspecialidad(r.especialidad)) {
        const libre = horaLibre(r)
        if (libre && horaActual < libre) motivo = "Está en su turno hasta las " + libre
      }

      return {
        id: r.id,
        nombre: r.nombre,
        puesto: r.puesto ?? null,
        especialidad: esEspecialidad(r.especialidad),
        turno: r.turno ?? null,
        entradaProgramada: hora(r.horaentradaprogramada),
        salidaProgramada: hora(r.horasalidaprogramada),
        horaIngreso,
        horaSalida,
        novedad,
        estado,
        enLaOrden: enLaOrden.has(nombreUp),
        sePuedeQuitar: porEsteModulo.has(nombreUp),
        sePuedeAgregar: motivo === null,
        motivo,
      }
    }

    const cuadrilla: CandidatoApoyo[] = []
    const habilitados: CandidatoApoyo[] = []
    let enTurnoPropio = 0
    for (const r of filas) {
      const c = aCandidato(r)
      if (esCargue(r.puesto)) {
        cuadrilla.push(c)
        continue
      }
      // Otro puesto: solo entra a "habilitados" cuando ya cumplió su turno
      // (o si ya está en la orden, para poder sacarlo desde aquí).
      const libre = horaLibre(r)
      const cumplio = !esHoy || !libre || horaActual >= libre
      if (cumplio || c.enLaOrden) habilitados.push(c)
      else enTurnoPropio++
    }

    return { success: true, data: { fecha, cuadrilla, habilitados, enTurnoPropio } }
  } catch (e: any) {
    console.error("[apoyo-cargue] getCandidatosApoyoDia:", e)
    return { success: false, data: null, message: e?.message || "Error al cargar la asistencia del día" }
  }
}
