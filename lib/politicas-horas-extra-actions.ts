"use server"

// Políticas de horas extra: lectura, guardado y recálculo retroactivo.
//
// El cálculo NO vive aquí: vive en la función SQL `calcular_extras_con_politica`
// (scripts/sig/57_politica_horas_extra.sql), que es la que usa el trigger. Este
// archivo solo administra la configuración y orquesta el recálculo llamando a
// ESA misma función, para que la previsualización no pueda mentir sobre lo que
// hará el UPDATE.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { createClient } from "@/lib/supabase-client"
import {
  POLITICA_DEFAULTS,
  PUESTO_TODOS,
  type PoliticaHorasExtra,
  type RedondeoModo,
} from "@/lib/politicas-horas-extra"
import { autorizarAccion } from "@/lib/puerta-modulo"

/** Contrato uniforme, como el resto de acciones del proyecto. Nunca lanza. */
interface Resultado<T = undefined> {
  success: boolean
  data?: T
  message?: string
}

function filaAPolitica(r: any): PoliticaHorasExtra {
  return {
    id: Number(r.id),
    puesto: r.puesto ?? PUESTO_TODOS,
    fechaDesde: String(r.fecha_desde ?? "").slice(0, 10),
    diaSemana: r.dia_semana == null ? null : Number(r.dia_semana),
    umbralHoras: Number(r.umbral_horas ?? POLITICA_DEFAULTS.umbralHoras),
    horasDescanso: Number(r.horas_descanso ?? POLITICA_DEFAULTS.horasDescanso),
    descansoDesdeHoras: r.descanso_desde_horas == null ? null : Number(r.descanso_desde_horas),
    toleranciaSalidaMin: Number(r.tolerancia_salida_min ?? POLITICA_DEFAULTS.toleranciaSalidaMin),
    minimoExtraHoras: Number(r.minimo_extra_horas ?? 0),
    topeExtraTurnoHoras: r.tope_extra_turno_horas == null ? null : Number(r.tope_extra_turno_horas),
    redondeoModo: (r.redondeo_modo ?? "truncar") as RedondeoModo,
    redondeoBloqueMin: r.redondeo_bloque_min == null ? null : Number(r.redondeo_bloque_min),
    ventanaNocturnaDesde: r.ventana_nocturna_desde ?? null,
    ventanaNocturnaHasta: r.ventana_nocturna_hasta ?? null,
    activa: r.activa !== false,
    nota: r.nota ?? null,
    actualizadoAt: r.actualizado_at ?? null,
  }
}

/** Mensaje claro cuando falta correr el script 57, en vez del error crudo. */
function faltaMigracion(msg: string | undefined): boolean {
  const t = String(msg ?? "").toLowerCase()
  return t.includes("politica_horas_extra") || t.includes("does not exist") || t.includes("schema cache")
}

const MSG_FALTA_MIGRACION =
  "Falta correr scripts/sig/57_politica_horas_extra.sql en la base para poder usar las políticas de horas extra."

/** Todas las políticas, de la más reciente a la más antigua. */
export async function getPoliticasHorasExtra(): Promise<Resultado<PoliticaHorasExtra[]>> {
  try {
    const admin: any = await getSupabaseAdmin()
    const { data, error } = await admin
      .from("politica_horas_extra")
      .select("*")
      .order("puesto", { ascending: true })
      .order("fecha_desde", { ascending: false })
      .order("dia_semana", { ascending: true, nullsFirst: true })

    if (error) {
      console.error("[v0] getPoliticasHorasExtra:", error.message)
      return { success: false, message: faltaMigracion(error.message) ? MSG_FALTA_MIGRACION : error.message }
    }
    return { success: true, data: (data ?? []).map(filaAPolitica) }
  } catch (e: any) {
    console.error("[v0] getPoliticasHorasExtra excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron leer las políticas." }
  }
}

/**
 * Crea o actualiza una política.
 *
 * El upsert va contra el índice único que corresponda: hay dos índices parciales
 * distintos según si `dia_semana` viene o no (en Postgres NULL <> NULL, así que
 * un solo índice no cubre ambos casos). Por eso se resuelve primero si la fila
 * ya existe y se hace update o insert en consecuencia, en vez de un upsert
 * genérico que no sabría a qué índice apuntar.
 */
export async function guardarPoliticaHorasExtra(
  p: PoliticaHorasExtra,
  clave?: string,
): Promise<Resultado<PoliticaHorasExtra>> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Tabla Asistencia", "configurar", { clave: clave ?? "", idempresa: null, referencia: `política horas extra ${p?.puesto}` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  const puesto = String(p?.puesto ?? "").trim()
  if (!puesto) return { success: false, message: "Indica a qué puesto aplica la política." }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p?.fechaDesde ?? ""))) {
    return { success: false, message: "La fecha de vigencia debe tener el formato AAAA-MM-DD." }
  }
  if (p.diaSemana != null && (p.diaSemana < 1 || p.diaSemana > 7)) {
    return { success: false, message: "El día de la semana debe estar entre 1 (lunes) y 7 (domingo)." }
  }
  if (!(Number(p.umbralHoras) >= 0) || !(Number(p.horasDescanso) >= 0)) {
    return { success: false, message: "El umbral y el descanso no pueden ser negativos." }
  }
  if (!(Number(p.toleranciaSalidaMin) >= 0)) {
    return { success: false, message: "La tolerancia no puede ser negativa." }
  }
  if (p.redondeoModo === "bloque" && !(Number(p.redondeoBloqueMin) > 0)) {
    return { success: false, message: "Con redondeo por bloques hay que indicar de cuántos minutos es el bloque." }
  }

  const payload = {
    puesto,
    fecha_desde: p.fechaDesde,
    dia_semana: p.diaSemana,
    umbral_horas: Number(p.umbralHoras),
    horas_descanso: Number(p.horasDescanso),
    descanso_desde_horas: p.descansoDesdeHoras == null ? null : Number(p.descansoDesdeHoras),
    tolerancia_salida_min: Number(p.toleranciaSalidaMin),
    minimo_extra_horas: Number(p.minimoExtraHoras ?? 0),
    tope_extra_turno_horas: p.topeExtraTurnoHoras == null ? null : Number(p.topeExtraTurnoHoras),
    redondeo_modo: p.redondeoModo,
    redondeo_bloque_min: p.redondeoModo === "bloque" ? Number(p.redondeoBloqueMin) : null,
    activa: p.activa !== false,
    nota: p.nota?.trim() || null,
    actualizado_at: new Date().toISOString(),
  }

  try {
    const admin: any = await getSupabaseAdmin()

    // La fila se identifica por las TRES columnas, no por el id que venga del
    // cliente: asi una excepcion nunca puede terminar pisando la base.
    //
    // `dia_semana` se compara con `is null` y no con `eq` porque en Postgres
    // NULL <> NULL: un `.eq("dia_semana", null)` no encontraria la fila base y
    // se crearia un duplicado en lugar de actualizarla.
    let existente = admin
      .from("politica_horas_extra")
      .select("id, dia_semana")
      .eq("puesto", puesto)
      .eq("fecha_desde", p.fechaDesde)
    existente = p.diaSemana == null
      ? existente.is("dia_semana", null)
      : existente.eq("dia_semana", p.diaSemana)

    const { data: previa, error: eBuscar } = await existente.maybeSingle()
    if (eBuscar) {
      console.error("[v0] guardarPoliticaHorasExtra búsqueda:", eBuscar.message)
      return { success: false, message: faltaMigracion(eBuscar.message) ? MSG_FALTA_MIGRACION : eBuscar.message }
    }

    // Guarda de ultimo momento. Si la fila encontrada no es del mismo dia que se
    // esta guardando, algo esta mal en la consulta y escribir ahi pisaria una
    // politica que no es. Mejor fallar que corromper en silencio.
    const previaDia = previa ? ((previa as any).dia_semana ?? null) : null
    if (previa && previaDia !== p.diaSemana) {
      console.error(
        "[v0] guardarPoliticaHorasExtra: la fila hallada no coincide en dia_semana",
        { buscado: p.diaSemana, hallado: previaDia },
      )
      return {
        success: false,
        message: "No se guardo: la politica encontrada no corresponde al dia indicado.",
      }
    }

    const q = previa?.id
      ? admin.from("politica_horas_extra").update(payload).eq("id", previa.id).select("*").single()
      : admin.from("politica_horas_extra").insert(payload).select("*").single()

    const { data, error } = await q
    if (error) {
      console.error("[v0] guardarPoliticaHorasExtra:", error.message)
      return { success: false, message: faltaMigracion(error.message) ? MSG_FALTA_MIGRACION : error.message }
    }
    return { success: true, data: filaAPolitica(data) }
  } catch (e: any) {
    console.error("[v0] guardarPoliticaHorasExtra excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo guardar la política." }
  }
}

/**
 * Aplica la MISMA política a varios puestos de una vez.
 *
 * Con veinte y pico de puestos, configurarlos uno a uno no solo es tedioso: es
 * la forma segura de que terminen desalineados sin que nadie lo note. Aquí se
 * guarda la misma regla en todos, y se informa qué pasó con cada uno.
 *
 * NO se detiene en el primer error: si un puesto falla, sigue con los demás y
 * lo reporta al final. Frenar a la mitad dejaría unos puestos configurados y
 * otros no, que es justo el estado inconsistente que esto viene a evitar.
 */
export async function guardarPoliticaEnPuestos(
  plantilla: PoliticaHorasExtra,
  puestos: string[],
  clave?: string,
): Promise<Resultado<{ guardados: string[]; fallidos: Array<{ puesto: string; motivo: string }> }>> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Tabla Asistencia", "configurar", { clave: clave ?? "", idempresa: null, referencia: `política horas extra en ${puestos?.length ?? 0} puestos` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  const lista = [...new Set((puestos ?? []).map((p) => String(p ?? "").trim()).filter(Boolean))]
  if (lista.length === 0) return { success: false, message: "Selecciona al menos un puesto." }

  const guardados: string[] = []
  const fallidos: Array<{ puesto: string; motivo: string }> = []

  for (const puesto of lista) {
    const res = await guardarPoliticaHorasExtra({ ...plantilla, id: undefined, puesto })
    if (res.success) guardados.push(puesto)
    else fallidos.push({ puesto, motivo: res.message ?? "Error desconocido" })
  }

  if (guardados.length === 0) {
    return {
      success: false,
      message: fallidos[0]?.motivo ?? "No se pudo guardar la política en ningún puesto.",
    }
  }

  return { success: true, data: { guardados, fallidos } }
}

/**
 * Elimina una política.
 *
 * La fila general ('*' con día base) no se puede borrar: es el punto de retorno
 * de todos los puestos sin regla propia. Sin ella, cualquier puesto sin política
 * caería al COALESCE de la función SQL — funcionaría, pero la pantalla mostraría
 * un vacío que nadie sabría interpretar.
 */
export async function eliminarPoliticaHorasExtra(id: number, clave?: string): Promise<Resultado> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Tabla Asistencia", "configurar", { clave: clave ?? "", idempresa: null, referencia: `eliminar política horas extra ${id}` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  if (!id) return { success: false, message: "No se indicó qué política eliminar." }
  try {
    const admin: any = await getSupabaseAdmin()

    const { data: fila } = await admin
      .from("politica_horas_extra")
      .select("puesto, dia_semana")
      .eq("id", id)
      .maybeSingle()

    if (fila && fila.puesto === PUESTO_TODOS && fila.dia_semana == null) {
      return {
        success: false,
        message:
          "No se puede eliminar la política general: es la que aplica a todos los puestos sin regla propia. Ajusta sus valores en vez de borrarla.",
      }
    }

    const { error } = await admin.from("politica_horas_extra").delete().eq("id", id)
    if (error) {
      console.error("[v0] eliminarPoliticaHorasExtra:", error.message)
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    console.error("[v0] eliminarPoliticaHorasExtra excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo eliminar la política." }
  }
}

/* =========================================================================
 * RECÁLCULO RETROACTIVO
 * ========================================================================= */

export interface FilaRecalculo {
  id: number
  fecha: string
  nombre: string
  identificacion: string
  puesto: string | null
  aprobado: string
  extrasManual: boolean
  hedActual: number
  hedfActual: number
  hedNuevo: number
  hedfNuevo: number
  delta: number
}

export interface PreviewRecalculo {
  filas: FilaRecalculo[]
  totalEvaluadas: number
  totalCambian: number
  horasGanadas: number
  horasPerdidas: number
  /** Cambian Y están aprobadas: mueven nómina ya liquidada. */
  cambianAprobadas: number
  /** Cambian Y tienen ajuste manual: pisan una decisión humana. */
  cambianManuales: number
  /** Huella de lo que se mostró. Se exige igual al confirmar. */
  token: string
  truncado: boolean
}

interface FiltroRecalculo {
  desde: string
  hasta: string
  empresaId: number
  puesto?: string | null
  incluirAprobadas?: boolean
  incluirManuales?: boolean
}

const LIMITE_PREVIEW = 2000

const esAprobado = (v: unknown) => String(v ?? "").trim().toLowerCase() === "aprobado"

/** Huella simple del preview: si los datos cambian entre ver y confirmar, no coincide. */
function calcularToken(filas: FilaRecalculo[]): string {
  const base = filas
    .map((f) => `${f.id}:${f.hedActual}:${f.hedfActual}:${f.hedNuevo}:${f.hedfNuevo}`)
    .join("|")
  let h = 0
  for (let i = 0; i < base.length; i++) {
    h = (h * 31 + base.charCodeAt(i)) | 0
  }
  return `${filas.length}-${h.toString(36)}`
}

/**
 * Qué cambiaría si se recalculara. NO ESCRIBE NADA.
 *
 * Llama a la MISMA función SQL que usará el UPDATE, así que lo que se ve aquí es
 * literalmente lo que va a pasar.
 */
export async function previsualizarRecalculoExtras(
  filtro: FiltroRecalculo,
): Promise<Resultado<PreviewRecalculo>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filtro?.desde ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(filtro?.hasta ?? "")) {
    return { success: false, message: "Indica un rango de fechas válido (AAAA-MM-DD)." }
  }
  if (filtro.desde > filtro.hasta) {
    return { success: false, message: "La fecha inicial no puede ser posterior a la final." }
  }
  if (!filtro.empresaId) return { success: false, message: "No se pudo determinar el proyecto." }

  try {
    const admin: any = await getSupabaseAdmin()

    let q = admin
      .from("registroasistencia")
      .select(
        "id, fecha, nombre, identificacion, puesto, aprobado, extras_manual, hed, hedf, horaingreso, horasalida, horaentradaprogramada, horasalidaprogramada",
      )
      .eq("idempresa", filtro.empresaId)
      .gte("fecha", filtro.desde)
      .lte("fecha", filtro.hasta)
      .eq("especialidad", "true")
      .not("horaingreso", "is", null)
      .not("horasalida", "is", null)
      .not("horaentradaprogramada", "is", null)
      .not("horasalidaprogramada", "is", null)
      .order("fecha", { ascending: true })
      .limit(LIMITE_PREVIEW + 1)

    if (filtro.puesto) q = q.eq("puesto", filtro.puesto)

    const { data, error } = await q
    if (error) {
      console.error("[v0] previsualizarRecalculoExtras:", error.message)
      return { success: false, message: error.message }
    }

    const crudas = (data ?? []) as any[]
    const truncado = crudas.length > LIMITE_PREVIEW
    const candidatas = truncado ? crudas.slice(0, LIMITE_PREVIEW) : crudas

    // El cálculo lo hace la BASE, no este proceso: es la misma función del
    // trigger. Se pide en un solo viaje con una RPC por lote.
    const nuevos = await calcularEnLote(admin, candidatas)

    const filas: FilaRecalculo[] = []
    let horasGanadas = 0
    let horasPerdidas = 0
    let cambianAprobadas = 0
    let cambianManuales = 0

    for (const r of candidatas) {
      const nuevo = nuevos.get(Number(r.id))
      if (nuevo == null) continue

      const aprobado = esAprobado(r.aprobado)
      const manual = r.extras_manual === true

      // Los filtros de seguridad se aplican ACÁ, no en la consulta: así el
      // usuario ve cuántas filas quedaron fuera y por qué.
      if (aprobado && !filtro.incluirAprobadas) continue
      if (manual && !filtro.incluirManuales) continue

      const esFestivoODomingo = (Number(r.hedf) || 0) > 0 && (Number(r.hed) || 0) === 0
      const hedActual = Number(r.hed) || 0
      const hedfActual = Number(r.hedf) || 0
      // La clasificación (hed vs hedf) no cambia con la política; solo la
      // cantidad. Se conserva el lado en el que ya estaba.
      const vaAFestiva = esFestivoODomingo || (hedfActual > 0 && hedActual === 0)
      const hedNuevo = vaAFestiva ? 0 : nuevo
      const hedfNuevo = vaAFestiva ? nuevo : 0

      const delta = hedNuevo + hedfNuevo - (hedActual + hedfActual)
      if (Math.abs(delta) < 0.005) continue

      if (delta > 0) horasGanadas += delta
      else horasPerdidas += Math.abs(delta)
      if (aprobado) cambianAprobadas++
      if (manual) cambianManuales++

      filas.push({
        id: Number(r.id),
        fecha: String(r.fecha).slice(0, 10),
        nombre: r.nombre ?? "",
        identificacion: r.identificacion ?? "",
        puesto: r.puesto ?? null,
        aprobado: String(r.aprobado ?? ""),
        extrasManual: manual,
        hedActual,
        hedfActual,
        hedNuevo: Math.round(hedNuevo * 100) / 100,
        hedfNuevo: Math.round(hedfNuevo * 100) / 100,
        delta: Math.round(delta * 100) / 100,
      })
    }

    return {
      success: true,
      data: {
        filas,
        totalEvaluadas: candidatas.length,
        totalCambian: filas.length,
        horasGanadas: Math.round(horasGanadas * 100) / 100,
        horasPerdidas: Math.round(horasPerdidas * 100) / 100,
        cambianAprobadas,
        cambianManuales,
        token: calcularToken(filas),
        truncado,
      },
    }
  } catch (e: any) {
    console.error("[v0] previsualizarRecalculoExtras excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo previsualizar el recálculo." }
  }
}

/**
 * Pide a la base el cálculo de cada fila con la función del trigger.
 *
 * Se usa una vista SQL puntual vía `rpc` si existe; si no, se cae a calcular
 * fila por fila con la función expuesta. En ambos casos el número lo produce
 * Postgres, no este proceso: replicar la fórmula acá sería la tercera copia.
 */
async function calcularEnLote(admin: any, filas: any[]): Promise<Map<number, number>> {
  const salida = new Map<number, number>()
  if (filas.length === 0) return salida

  const ids = filas.map((f) => Number(f.id))
  const { data, error } = await admin.rpc("calcular_extras_lote", { p_ids: ids })

  if (!error && Array.isArray(data)) {
    for (const r of data) salida.set(Number(r.id), Number(r.horas_extra) || 0)
    return salida
  }

  // Sin la RPC no se adivina el resultado: se avisa. Calcularlo aquí sería
  // duplicar la fórmula y arriesgar que la previsualización mienta.
  console.error("[v0] calcular_extras_lote no disponible:", error?.message)
  throw new Error(
    "Falta la función calcular_extras_lote en la base. Corre scripts/sig/57_politica_horas_extra.sql completo.",
  )
}

/**
 * Aplica el recálculo. Respalda antes y solo toca los `id` que el usuario vio.
 */
export async function ejecutarRecalculoExtras(input: {
  filtro: FiltroRecalculo
  ids: number[]
  token: string
  motivo: string
}): Promise<Resultado<{ actualizadas: number; loteId: string }>> {
  const ids = (input?.ids ?? []).map(Number).filter(Number.isFinite)
  if (ids.length === 0) return { success: false, message: "No hay filas seleccionadas para recalcular." }
  if (!input?.motivo?.trim()) return { success: false, message: "Indica por qué se recalcula." }

  try {
    // Se vuelve a previsualizar y se compara la huella: si algo cambió entre
    // que el usuario miró y confirmó, se aborta en vez de escribir sobre datos
    // que ya no son los que vio.
    const verificacion = await previsualizarRecalculoExtras(input.filtro)
    if (!verificacion.success || !verificacion.data) {
      return { success: false, message: verificacion.message || "No se pudo verificar el recálculo." }
    }
    if (verificacion.data.token !== input.token) {
      return {
        success: false,
        message:
          "Los datos cambiaron desde que viste la previsualización. Vuelve a previsualizar antes de confirmar.",
      }
    }

    const permitidos = new Set(verificacion.data.filas.map((f) => f.id))
    const aplicar = verificacion.data.filas.filter((f) => permitidos.has(f.id) && ids.includes(f.id))
    if (aplicar.length === 0) return { success: false, message: "Ninguna de las filas seleccionadas cambia." }

    const admin: any = await getSupabaseAdmin()
    const loteId = crypto.randomUUID()

    // 1) Respaldo ANTES de tocar nada.
    const { data: previas, error: eLeer } = await admin
      .from("registroasistencia")
      .select("id, fecha, nombre, identificacion, puesto, aprobado, hed, hedf, hen, hef, hn")
      .in("id", aplicar.map((f) => f.id))
    if (eLeer) return { success: false, message: `No se pudo respaldar: ${eLeer.message}` }

    const respaldo = (previas ?? []).map((r: any) => ({
      lote_id: loteId,
      registro_id: r.id,
      fecha: r.fecha,
      nombre: r.nombre,
      identificacion: r.identificacion,
      puesto: r.puesto,
      aprobado: String(r.aprobado ?? ""),
      hed: r.hed,
      hedf: r.hedf,
      hen: r.hen,
      hef: r.hef,
      hn: r.hn,
      motivo: input.motivo.trim(),
    }))

    const { error: eResp } = await admin.from("respaldo_recalculo_extras").insert(respaldo)
    if (eResp) return { success: false, message: `No se pudo respaldar: ${eResp.message}` }

    // 2) Aplicar. Una por una: son pocas y así un fallo no deja el lote a medias
    //    sin saber dónde quedó.
    let actualizadas = 0
    for (const f of aplicar) {
      const { error } = await admin
        .from("registroasistencia")
        .update({ hed: f.hedNuevo, hedf: f.hedfNuevo })
        .eq("id", f.id)
      if (error) {
        console.error("[v0] ejecutarRecalculoExtras fila", f.id, error.message)
        continue
      }
      actualizadas++
    }

    return { success: true, data: { actualizadas, loteId } }
  } catch (e: any) {
    console.error("[v0] ejecutarRecalculoExtras excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo ejecutar el recálculo." }
  }
}

/** Una fila real de asistencia, para cargarla en el simulador. */
export async function getEjemploAsistencia(input: {
  empresaId: number
  puesto?: string | null
  fecha?: string | null
}): Promise<Resultado<{ fecha: string; nombre: string; horaIngreso: string; horaEntradaProgramada: string; horaSalida: string; horaSalidaProgramada: string; puesto: string | null }>> {
  try {
    const supabase: any = await createClient()
    let q = supabase
      .from("registroasistencia")
      .select("fecha, nombre, puesto, horaingreso, horasalida, horaentradaprogramada, horasalidaprogramada")
      .eq("idempresa", input.empresaId)
      .eq("especialidad", "true")
      .not("horaingreso", "is", null)
      .not("horasalida", "is", null)
      .not("horaentradaprogramada", "is", null)
      .not("horasalidaprogramada", "is", null)
      .order("fecha", { ascending: false })
      .limit(1)

    if (input.puesto) q = q.eq("puesto", input.puesto)
    if (input.fecha) q = q.eq("fecha", input.fecha)

    const { data, error } = await q.maybeSingle()
    if (error) return { success: false, message: error.message }
    if (!data) return { success: false, message: "No se encontró una asistencia con esos criterios." }

    return {
      success: true,
      data: {
        fecha: String(data.fecha).slice(0, 10),
        nombre: data.nombre ?? "",
        puesto: data.puesto ?? null,
        horaIngreso: String(data.horaingreso ?? "").slice(0, 5),
        horaEntradaProgramada: String(data.horaentradaprogramada ?? "").slice(0, 5),
        horaSalida: String(data.horasalida ?? "").slice(0, 5),
        horaSalidaProgramada: String(data.horasalidaprogramada ?? "").slice(0, 5),
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo cargar el ejemplo." }
  }
}
