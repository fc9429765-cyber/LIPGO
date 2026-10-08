"use server"

import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// Valores validos para la columna `tipo` de capacitaciones. Los tres se
// gestionan en este modulo y se muestran en el portal del trabajador.
const TIPOS_CAPACITACION = ["induccion", "capacitacion", "re_induccion"]

/**
 * Evidencia de Inducciones - server actions
 *
 * Esquema real en Supabase:
 *  - capacitaciones_evaluacion_intentos:
 *      id              uuid PK
 *      evaluacion_id   uuid FK -> capacitaciones_evaluaciones(id)
 *      capacitacion_id uuid FK -> capacitaciones(id)
 *      headcount_id    bigint FK -> headcount(id)
 *      fecha           timestamptz
 *      puntaje         integer
 *      total           integer
 *      aprobado        boolean
 *      ...
 *  - headcount: id (bigint), nombre, identificacion
 *  - capacitaciones_evaluaciones: id (uuid), titulo, codigo_sig
 *
 * Las FKs estan declaradas, por lo que PostgREST permite resolver los
 * joins anidados directamente en el select.
 */

export interface IntentoInduccion {
  id: string
  fecha: string | null
  puntaje: number
  total: number
  aprobado: boolean
  // ID de headcount, para agrupar el historial por trabajador.
  trabajador_id: number | null
  trabajador_nombre: string
  trabajador_identificacion: string | null
  induccion_titulo: string
  induccion_codigo_sig: string | null
  // Datos para generar el documento de evidencia (PDF):
  evaluacion_id: string | null
  // Firma digital registrada por el trabajador (bucket de firmas).
  firma_url: string | null
  // URL del documento de evidencia ya generado (si existe).
  evidencia_url: string | null
}

/**
 * Devuelve todos los intentos de evaluacion de inducciones con los datos
 * del trabajador (headcount) y de la induccion (capacitaciones_evaluaciones),
 * ordenados por fecha descendente (mas recientes primero).
 */
export async function getEvidenciaInducciones(selectedEmpresaId?: number | null): Promise<{
  success: boolean
  data: IntentoInduccion[]
  error?: string
}> {
  try {
    const supabase = await createClient()
    // Solo se muestran los trabajadores de la empresa seleccionada (o la de
    // sesion). El filtro se aplica sobre headcount.idempresa usando un join
    // interno (!inner) para que descarte los intentos de otras empresas.
    const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

    const { data, error } = await supabase
      .from("capacitaciones_evaluacion_intentos")
      .select(
        "id, fecha, puntaje, total, aprobado, evaluacion_id, headcount_id, headcount:headcount_id!inner ( nombre, identificacion, idempresa ), evaluacion:evaluacion_id ( titulo, codigo_sig, urlfirma, evidencia )",
      )
      .eq("headcount.idempresa", empresaId)
      .order("fecha", { ascending: false })

    if (error) {
      console.error("[v0] Error fetching evidencia inducciones:", error)
      return { success: false, data: [], error: error.message }
    }

    const rows = (data || []).map((r: any) => {
      const hc = Array.isArray(r.headcount) ? r.headcount[0] : r.headcount
      const ev = Array.isArray(r.evaluacion) ? r.evaluacion[0] : r.evaluacion
      return {
        id: r.id,
        fecha: r.fecha ?? null,
        puntaje: Number(r.puntaje) || 0,
        total: Number(r.total) || 0,
        aprobado: Boolean(r.aprobado),
        trabajador_id: r.headcount_id != null ? Number(r.headcount_id) : null,
        trabajador_nombre: hc?.nombre || "(sin nombre)",
        trabajador_identificacion: hc?.identificacion ?? null,
        induccion_titulo: ev?.titulo || "(sin titulo)",
        induccion_codigo_sig: ev?.codigo_sig ?? null,
        evaluacion_id: r.evaluacion_id ?? null,
        firma_url: ev?.urlfirma ?? null,
        evidencia_url: ev?.evidencia ?? null,
      }
    })

    return { success: true, data: rows }
  } catch (err: any) {
    console.error("[v0] getEvidenciaInducciones exception:", err)
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Guarda la URL del documento de evidencia (PDF) generado para una induccion
 * en el campo `evidencia` de capacitaciones_evaluaciones.
 */
export async function guardarEvidenciaInduccion(
  evaluacionId: string,
  evidenciaUrl: string,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Evidencia de Inducciones", "Inducciones"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!evaluacionId || !evidenciaUrl) {
    return { success: false, error: "Datos incompletos" }
  }
  try {
    // Usamos el cliente admin (service role) para evitar que las politicas RLS
    // bloqueen el guardado: el PDF ya se sube con service role en /api/upload-pdf,
    // pero antes este UPDATE usaba la sesion del usuario y para algunos roles
    // fallaba silenciosamente, dejando la evidencia sin persistir.
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("capacitaciones_evaluaciones")
      .update({ evidencia: evidenciaUrl })
      .eq("id", evaluacionId)
      .select("id")
    if (error) {
      console.error("[v0] guardarEvidenciaInduccion update error:", error)
      return { success: false, error: error.message }
    }
    // Verificamos que efectivamente se actualizo una fila (el id puede no existir).
    if (!data || data.length === 0) {
      return { success: false, error: "No se encontro la evaluacion para guardar la evidencia" }
    }
    return { success: true }
  } catch (err: any) {
    console.error("[v0] guardarEvidenciaInduccion exception:", err)
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Elimina un intento de evaluacion de induccion. Esto borra el resultado del
 * trabajador y deja la induccion abierta nuevamente para que la diligencie:
 *  1) Borra las respuestas del intento (capacitaciones_evaluacion_respuestas).
 *  2) Borra el intento (capacitaciones_evaluacion_intentos).
 *  3) Borra la asistencia/resultado del trabajador para esa capacitacion.
 *  4) Marca la capacitacion como NO ejecutada (ya no la completaron todos).
 * Usa el cliente admin para evitar bloqueos por RLS.
 */
export async function eliminarIntentoEvaluacion(
  intentoId: string,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Evidencia de Inducciones", "Inducciones"], "eliminar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!intentoId) return { success: false, error: "Falta el id del intento" }
  try {
    const supabase = await getSupabaseAdmin()

    // Obtenemos el intento para conocer la capacitacion y el trabajador.
    const { data: intento, error: findErr } = await supabase
      .from("capacitaciones_evaluacion_intentos")
      .select("id, capacitacion_id, headcount_id")
      .eq("id", intentoId)
      .maybeSingle()
    if (findErr) {
      console.error("[v0] eliminarIntentoEvaluacion find error:", findErr)
      return { success: false, error: findErr.message }
    }
    if (!intento) return { success: false, error: "No se encontro el intento a eliminar" }

    // 1) Borrar el detalle de respuestas del intento.
    const { error: respErr } = await supabase
      .from("capacitaciones_evaluacion_respuestas")
      .delete()
      .eq("intento_id", intentoId)
    if (respErr) {
      console.error("[v0] eliminarIntentoEvaluacion respuestas error:", respErr)
      return { success: false, error: respErr.message }
    }

    // 2) Borrar el intento.
    const { error: intentoErr } = await supabase
      .from("capacitaciones_evaluacion_intentos")
      .delete()
      .eq("id", intentoId)
    if (intentoErr) {
      console.error("[v0] eliminarIntentoEvaluacion intento error:", intentoErr)
      return { success: false, error: intentoErr.message }
    }

    // 3) Borrar la asistencia/resultado del trabajador para esa capacitacion,
    //    de modo que quede "pendiente" nuevamente.
    if ((intento as any).capacitacion_id && (intento as any).headcount_id != null) {
      const { error: asisErr } = await supabase
        .from("capacitaciones_asistencia")
        .delete()
        .eq("capacitacion_id", (intento as any).capacitacion_id)
        .eq("headcount_id", (intento as any).headcount_id)
      if (asisErr) {
        // No abortamos: el resultado principal (intento) ya se elimino.
        console.error("[v0] eliminarIntentoEvaluacion asistencia error:", asisErr)
      }
    }

    // 4) La capacitacion ya no esta completada por todos: marcar no ejecutada.
    if ((intento as any).capacitacion_id) {
      await supabase
        .from("capacitaciones")
        .update({ ejecutada: false })
        .eq("id", (intento as any).capacitacion_id)
    }

    return { success: true }
  } catch (err: any) {
    console.error("[v0] eliminarIntentoEvaluacion exception:", err)
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/* =========================================================================
 * Modulo de administracion de Inducciones (RRHH)
 *
 * Las inducciones se almacenan en `capacitaciones` con tipo='induccion'.
 * Cada induccion tiene UNA fila en `capacitaciones_evaluaciones` y N
 * `capacitaciones_evaluacion_preguntas`.
 * ========================================================================= */

export interface PreguntaAdmin {
  id?: string
  orden: number
  enunciado: string
  // 'mcq' = opcion multiple (opciones {a,b,c}); 'vf' = verdadero/falso
  tipo: "mcq" | "vf"
  opciones: Record<string, string> | null
  respuesta_correcta: string
}

// Estado de una induccion:
// - "sin_programar": no tiene trabajadores asignados ni esta ejecutada.
// - "programada": tiene trabajadores asignados pero aun no la diligencian todos.
// - "ejecutada": el 100% de los asignados diligencio el cuestionario (automatico)
//   o se marco manualmente.
export type EstadoInduccion = "sin_programar" | "programada" | "ejecutada"

export interface InduccionAdmin {
  id: string
  tema: string
  descripcion: string | null
  codigo_sig: string | null
  material_url: string | null
  obligatoria: boolean
  activa: boolean
  idempresa: number | null
  // Fecha de programacion (ultimo dia del mes/anio programado).
  fecha: string | null
  // Si ya fue ejecutada: solo entonces aparece en el portal del trabajador.
  ejecutada: boolean
  // Indica que la induccion es para personal administrativo. Al programar se
  // mostrara todo el headcount administrativo, sin filtrar por empresa.
  admin: boolean
  // Tipo de capacitacion: 'induccion' | 'capacitacion' | 're_induccion'.
  tipo: string
  // IDs de headcount a los que se les impartio la induccion.
  trabajadores: number[]
  // Cuantos de los asignados ya diligenciaron el cuestionario.
  completados: number
  estado: EstadoInduccion
  evaluacion_id: string | null
  evaluacion_titulo: string | null
  puntaje_aprobacion: number
  total_preguntas: number
}

/** Parsea el campo `trabajadores` (texto separado por comas) a IDs numericos. */
function parseTrabajadores(raw: string | null | undefined): number[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n))
}

/** Deriva el estado a partir de ejecutada + lista de trabajadores. */
function derivarEstado(ejecutada: boolean, trabajadores: number[]): EstadoInduccion {
  if (ejecutada) return "ejecutada"
  if (trabajadores.length > 0) return "programada"
  return "sin_programar"
}

/**
 * Lista las inducciones (capacitaciones tipo='induccion') de una empresa,
 * incluyendo metadata de su evaluacion asociada. Si `idempresa` es null se
 * devuelven todas (modo global / superadmin).
 */
export async function listInduccionesAdmin(
  idempresa?: number | null,
): Promise<{ success: boolean; data: InduccionAdmin[]; error?: string }> {
  try {
    const supabase = await createClient()
    let query = supabase
      .from("capacitaciones")
      .select(
        "id, tema, descripcion, codigo_sig, material_url, obligatoria, activa, idempresa, fecha, ejecutada, admin, tipo, trabajadores, capacitaciones_evaluaciones ( id, titulo, puntaje_aprobacion, total_preguntas )",
      )
      .in("tipo", TIPOS_CAPACITACION)
      .order("fecha", { ascending: true, nullsFirst: false })

    // Mostramos unicamente las inducciones de la empresa seleccionada en el
    // filtro dinamico de empresa.
    if (idempresa != null) query = query.eq("idempresa", idempresa)

    const { data, error } = await query
    if (error) {
      console.error("[v0] listInduccionesAdmin error:", error)
      return { success: false, data: [], error: error.message }
    }

    // Para contar diligenciados, traemos todos los intentos de las evaluaciones
    // involucradas en una sola consulta y agrupamos por evaluacion -> headcount.
    const evaluacionIds = (data || [])
      .map((r: any) => {
        const ev = Array.isArray(r.capacitaciones_evaluaciones)
          ? r.capacitaciones_evaluaciones[0]
          : r.capacitaciones_evaluaciones
        return ev?.id
      })
      .filter(Boolean)

    const diligenciadosPorEval = new Map<string, Set<number>>()
    if (evaluacionIds.length > 0) {
      const { data: intentos } = await supabase
        .from("capacitaciones_evaluacion_intentos")
        .select("evaluacion_id, headcount_id")
        .in("evaluacion_id", evaluacionIds)
      for (const it of intentos || []) {
        if (!it.evaluacion_id || it.headcount_id == null) continue
        if (!diligenciadosPorEval.has(it.evaluacion_id)) {
          diligenciadosPorEval.set(it.evaluacion_id, new Set())
        }
        diligenciadosPorEval.get(it.evaluacion_id)!.add(Number(it.headcount_id))
      }
    }

    // IDs de inducciones que alcanzaron el 100% y deben quedar ejecutadas en BD.
    const autoEjecutarIds: string[] = []

    const rows: InduccionAdmin[] = (data || []).map((r: any) => {
      const ev = Array.isArray(r.capacitaciones_evaluaciones)
        ? r.capacitaciones_evaluaciones[0]
        : r.capacitaciones_evaluaciones
      const trabajadores = parseTrabajadores(r.trabajadores)
      const diligenciados = ev?.id ? diligenciadosPorEval.get(ev.id) : undefined
      // Solo contamos a los trabajadores asignados que ya diligenciaron.
      const completados = diligenciados
        ? trabajadores.filter((id) => diligenciados.has(id)).length
        : 0
      // El 100% de los asignados diligencio -> debe quedar ejecutada.
      const completoTodos = trabajadores.length > 0 && completados >= trabajadores.length
      const ejecutada = Boolean(r.ejecutada) || completoTodos
      // Si en BD aun no esta marcada pero ya completaron todos, la sincronizamos.
      if (completoTodos && !r.ejecutada) autoEjecutarIds.push(r.id)
      return {
        id: r.id,
        tema: r.tema || "(sin tema)",
        descripcion: r.descripcion ?? null,
        codigo_sig: r.codigo_sig ?? null,
        material_url: r.material_url ?? null,
        obligatoria: Boolean(r.obligatoria),
        activa: Boolean(r.activa),
        idempresa: r.idempresa ?? null,
        fecha: r.fecha ?? null,
        ejecutada,
        admin: Boolean(r.admin),
        tipo: r.tipo || "induccion",
        trabajadores,
        completados,
        estado: derivarEstado(ejecutada, trabajadores),
        evaluacion_id: ev?.id ?? null,
        evaluacion_titulo: ev?.titulo ?? null,
        puntaje_aprobacion: Number(ev?.puntaje_aprobacion) || 0,
        total_preguntas: Number(ev?.total_preguntas) || 0,
      }
    })

    // Persistir el cambio a ejecutada para las que ya completaron el 100%.
    if (autoEjecutarIds.length > 0) {
      await supabase
        .from("capacitaciones")
        .update({ ejecutada: true })
        .in("id", autoEjecutarIds)
    }

    return { success: true, data: rows }
  } catch (err: any) {
    console.error("[v0] listInduccionesAdmin exception:", err)
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Devuelve una induccion con su evaluacion y todas sus preguntas (incluyendo
 * la respuesta_correcta) para edicion en el panel de administracion.
 */
export async function getInduccionAdmin(capacitacionId: string): Promise<{
  success: boolean
  induccion: InduccionAdmin | null
  preguntas: PreguntaAdmin[]
  error?: string
}> {
  try {
    const supabase = await createClient()
    const { data: cap, error: capErr } = await supabase
      .from("capacitaciones")
      .select(
        "id, tema, descripcion, codigo_sig, material_url, obligatoria, activa, idempresa, fecha, ejecutada, admin, tipo, trabajadores, capacitaciones_evaluaciones ( id, titulo, puntaje_aprobacion, total_preguntas )",
      )
      .eq("id", capacitacionId)
      .single()

    if (capErr || !cap) {
      return { success: false, induccion: null, preguntas: [], error: capErr?.message }
    }

    const ev = Array.isArray((cap as any).capacitaciones_evaluaciones)
      ? (cap as any).capacitaciones_evaluaciones[0]
      : (cap as any).capacitaciones_evaluaciones

    let preguntas: PreguntaAdmin[] = []
    if (ev?.id) {
      const { data: pregs } = await supabase
        .from("capacitaciones_evaluacion_preguntas")
        .select("id, orden, enunciado, tipo, opciones, respuesta_correcta")
        .eq("evaluacion_id", ev.id)
        .order("orden", { ascending: true })
      preguntas = (pregs || []).map((p: any) => ({
        id: p.id,
        orden: Number(p.orden) || 0,
        enunciado: p.enunciado || "",
        tipo: p.tipo === "vf" ? "vf" : "mcq",
        opciones: p.opciones ?? null,
        respuesta_correcta: p.respuesta_correcta ?? "",
      }))
    }

    const induccion: InduccionAdmin = {
      id: (cap as any).id,
      tema: (cap as any).tema || "",
      descripcion: (cap as any).descripcion ?? null,
      codigo_sig: (cap as any).codigo_sig ?? null,
      material_url: (cap as any).material_url ?? null,
      obligatoria: Boolean((cap as any).obligatoria),
      activa: Boolean((cap as any).activa),
      idempresa: (cap as any).idempresa ?? null,
      fecha: (cap as any).fecha ?? null,
      ejecutada: Boolean((cap as any).ejecutada),
      admin: Boolean((cap as any).admin),
      tipo: (cap as any).tipo || "induccion",
      trabajadores: parseTrabajadores((cap as any).trabajadores),
      completados: 0,
      estado: derivarEstado(Boolean((cap as any).ejecutada), parseTrabajadores((cap as any).trabajadores)),
      evaluacion_id: ev?.id ?? null,
      evaluacion_titulo: ev?.titulo ?? null,
      puntaje_aprobacion: Number(ev?.puntaje_aprobacion) || 0,
      total_preguntas: Number(ev?.total_preguntas) || 0,
    }

    return { success: true, induccion, preguntas }
  } catch (err: any) {
    console.error("[v0] getInduccionAdmin exception:", err)
    return { success: false, induccion: null, preguntas: [], error: err?.message }
  }
}

interface GuardarInduccionInput {
  id?: string | null
  tema: string
  descripcion?: string | null
  codigo_sig?: string | null
  material_url?: string | null
  obligatoria?: boolean
  activa?: boolean
  idempresa?: number | null
  // Marca la induccion como administrativa (capacitaciones.admin).
  admin?: boolean
  // Tipo de capacitacion: 'induccion' | 'capacitacion' | 're_induccion'.
  tipo?: string | null
  // Programacion: mes (1-12) y anio. Se almacena en `fecha` como el ultimo
  // dia de ese mes. Si no se envian, `fecha` queda null.
  mes?: number | null
  anio?: number | null
  puntaje_aprobacion: number
  preguntas: PreguntaAdmin[]
}

/** Devuelve el ultimo dia del mes/anio como 'YYYY-MM-DD'. */
function ultimoDiaDelMes(anio: number, mes: number): string {
  // new Date(anio, mes, 0) -> dia 0 del mes siguiente = ultimo dia de `mes`.
  const d = new Date(anio, mes, 0)
  const mm = String(mes).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${anio}-${mm}-${dd}`
}

/**
 * Crea o actualiza una induccion completa: la fila en `capacitaciones`
 * (tipo='induccion'), su `capacitaciones_evaluaciones` y el set de
 * `capacitaciones_evaluacion_preguntas`. Las preguntas se reemplazan por
 * completo (borrar e insertar) para simplificar la edicion.
 */
export async function guardarInduccion(input: GuardarInduccionInput): Promise<{
  success: boolean
  capacitacionId?: string
  error?: string
}> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Inducciones"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()

    if (!input.tema?.trim()) {
      return { success: false, error: "El tema es obligatorio" }
    }

    // Fecha de programacion = ultimo dia del mes/anio (o null si no se programo).
    const fecha =
      input.mes && input.anio ? ultimoDiaDelMes(input.anio, input.mes) : null

    const capData = {
      tema: input.tema.trim(),
      descripcion: input.descripcion?.trim() || null,
      codigo_sig: input.codigo_sig?.trim() || null,
      material_url: input.material_url?.trim() || null,
      obligatoria: input.obligatoria ?? true,
      activa: input.activa ?? true,
      idempresa: input.idempresa ?? null,
      admin: input.admin ?? false,
      fecha,
      // Solo aceptamos un tipo valido; cualquier otro valor cae a 'induccion'.
      tipo: input.tipo && TIPOS_CAPACITACION.includes(input.tipo) ? input.tipo : "induccion",
    }

    let capacitacionId = input.id || null

    if (capacitacionId) {
      // En edicion NO tocamos `ejecutada`: se gestiona aparte con marcarEjecutada.
      const { error } = await supabase
        .from("capacitaciones")
        .update(capData)
        .eq("id", capacitacionId)
      if (error) return { success: false, error: error.message }
    } else {
      // Al crear, la induccion queda programada pero NO ejecutada (no visible
      // en el portal hasta que se marque como ejecutada).
      const { data, error } = await supabase
        .from("capacitaciones")
        .insert({ ...capData, ejecutada: false })
        .select("id")
        .single()
      if (error || !data) return { success: false, error: error?.message || "No se pudo crear" }
      capacitacionId = data.id
    }

    // Upsert de la evaluacion asociada (1:1 con la capacitacion).
    const { data: evExist } = await supabase
      .from("capacitaciones_evaluaciones")
      .select("id")
      .eq("capacitacion_id", capacitacionId)
      .maybeSingle()

    const evData = {
      capacitacion_id: capacitacionId,
      codigo_sig: capData.codigo_sig,
      titulo: input.tema.trim(),
      total_preguntas: input.preguntas.length,
      puntaje_aprobacion: input.puntaje_aprobacion,
      activa: true,
    }

    let evaluacionId = evExist?.id || null
    if (evaluacionId) {
      const { error } = await supabase
        .from("capacitaciones_evaluaciones")
        .update(evData)
        .eq("id", evaluacionId)
      if (error) return { success: false, error: error.message }
    } else {
      const { data, error } = await supabase
        .from("capacitaciones_evaluaciones")
        .insert(evData)
        .select("id")
        .single()
      if (error || !data) return { success: false, error: error?.message || "No se pudo crear la evaluacion" }
      evaluacionId = data.id
    }

    // Reemplazo total de preguntas: borrar las existentes e insertar el set nuevo.
    await supabase.from("capacitaciones_evaluacion_preguntas").delete().eq("evaluacion_id", evaluacionId)

    if (input.preguntas.length > 0) {
      const pregRows = input.preguntas.map((p, i) => ({
        evaluacion_id: evaluacionId,
        orden: p.orden || i + 1,
        enunciado: p.enunciado.trim(),
        tipo: p.tipo,
        opciones: p.tipo === "mcq" ? p.opciones : null,
        respuesta_correcta: p.respuesta_correcta.trim(),
      }))
      const { error } = await supabase.from("capacitaciones_evaluacion_preguntas").insert(pregRows)
      if (error) return { success: false, error: error.message }
    }

    return { success: true, capacitacionId: capacitacionId! }
  } catch (err: any) {
    console.error("[v0] guardarInduccion exception:", err)
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Duplica una induccion existente en otras empresas (proyectos). Copia la
 * definicion completa (tema, descripcion, codigo, material, obligatoria,
 * activa, admin, programacion mes/anio) y todas las preguntas de su
 * evaluacion, pero NO los trabajadores asignados (cada empresa tiene su propio
 * headcount). Cada copia queda como nueva induccion programada (no ejecutada).
 */
export async function duplicarInduccionEnEmpresas(
  capacitacionId: string,
  empresaIds: number[],
): Promise<{ success: boolean; creadas: number; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Inducciones"], "crear", "Duplicar inducción")
  if (motivoAccion) return { success: false, error: motivoAccion, creadas: 0 }
  try {
    if (!empresaIds || empresaIds.length === 0) {
      return { success: false, creadas: 0, error: "Debe seleccionar al menos una empresa" }
    }

    // Obtenemos la definicion y preguntas de la induccion origen.
    const { success, induccion, preguntas, error } = await getInduccionAdmin(capacitacionId)
    if (!success || !induccion) {
      return { success: false, creadas: 0, error: error || "No se encontro la induccion origen" }
    }

    // Derivamos mes/anio a partir de la fecha de programacion (si existe), para
    // que guardarInduccion vuelva a calcular el ultimo dia del mes.
    let mes: number | null = null
    let anio: number | null = null
    if (induccion.fecha) {
      const [y, m] = induccion.fecha.split("-")
      anio = Number(y) || null
      mes = Number(m) || null
    }

    const baseCodigo = induccion.codigo_sig?.trim() || null

    let creadas = 0
    let ultimoError: string | undefined
    for (const idempresa of empresaIds) {
      // No duplicar sobre la misma empresa de origen.
      if (idempresa === induccion.idempresa) continue

      // `capacitaciones.codigo_sig` tiene una restriccion UNICA global, por lo
      // que NO podemos reutilizar el mismo codigo en la copia. Generamos uno
      // unico por empresa destino (con sufijo de empresa + marca de tiempo
      // corta para evitar choques si se duplica varias veces). Si la induccion
      // origen no tiene codigo, dejamos null (Postgres permite multiples null).
      const codigoUnico = baseCodigo ? `${baseCodigo}-E${idempresa}-${Date.now().toString(36)}` : null

      const res = await guardarInduccion({
        id: null,
        tema: induccion.tema,
        descripcion: induccion.descripcion,
        codigo_sig: codigoUnico,
        material_url: induccion.material_url,
        obligatoria: induccion.obligatoria,
        activa: induccion.activa,
        idempresa,
        admin: induccion.admin,
        tipo: induccion.tipo,
        mes,
        anio,
        puntaje_aprobacion: induccion.puntaje_aprobacion,
        preguntas,
      })
      if (res.success) creadas++
      else {
        ultimoError = res.error
        console.error("[v0] duplicarInduccionEnEmpresas: fallo en empresa", idempresa, res.error)
      }
    }

    if (creadas === 0) {
      return { success: false, creadas: 0, error: ultimoError || "No se creo ninguna copia" }
    }
    return { success: true, creadas }
  } catch (err: any) {
    console.error("[v0] duplicarInduccionEnEmpresas exception:", err)
    return { success: false, creadas: 0, error: err?.message || "Error desconocido" }
  }
}

/**
 * Elimina una induccion y, en cascada manual, su evaluacion y preguntas.
 */
export async function eliminarInduccion(capacitacionId: string): Promise<{
  success: boolean
  error?: string
}> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Inducciones"], "eliminar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()
    const { data: ev } = await supabase
      .from("capacitaciones_evaluaciones")
      .select("id")
      .eq("capacitacion_id", capacitacionId)
      .maybeSingle()

    if (ev?.id) {
      await supabase.from("capacitaciones_evaluacion_preguntas").delete().eq("evaluacion_id", ev.id)
      await supabase.from("capacitaciones_evaluaciones").delete().eq("id", ev.id)
    }
    const { error } = await supabase.from("capacitaciones").delete().eq("id", capacitacionId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    console.error("[v0] eliminarInduccion exception:", err)
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Marca/desmarca una induccion como ejecutada manualmente. Normalmente el paso
 * a ejecutada es automatico cuando todos los trabajadores diligencian, pero se
 * permite el override manual.
 */
export async function marcarEjecutadaInduccion(
  capacitacionId: string,
  ejecutada: boolean,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Inducciones"], "cerrar", "Marcar ejecutada")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!capacitacionId) return { success: false, error: "ID requerido" }
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("capacitaciones")
      .update({ ejecutada })
      .eq("id", capacitacionId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    console.error("[v0] marcarEjecutadaInduccion exception:", err)
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export interface TrabajadorOpcion {
  id: number
  nombre: string
  identificacion: string | null
  cargo: string | null
  /** Estado en el head count tal cual esta guardado: "Activo", "Inactivo"... */
  estado: string | null
  /**
   * false cuando el trabajador YA NO sale en el listado normal --se retiro, o
   * quedo en otro proyecto-- y aparece unicamente porque sigue asignado a esta
   * induccion.
   *
   * Es la unica forma de poder quitarlo. Mientras no se listara, el que se iba
   * de la empresa quedaba asignado para siempre: el denominador de "15/16" no
   * bajaba nunca y la induccion no alcanzaba el 100% ni pasaba a ejecutada.
   */
  disponible: boolean
}

/**
 * Lista los trabajadores (headcount) para seleccionarlos al programar una
 * induccion. Si `admin` es true se devuelven los administrativos DEL PROYECTO
 * indicado --el administrativo tambien pertenece a un proyecto--; de lo
 * contrario, los operativos de esa misma empresa.
 *
 * Los administrativos sin proyecto (`idempresa` null) se incluyen siempre: hay
 * registros viejos asi y, de omitirlos, no se les podria programar nada.
 *
 * `asignados` son los IDs que la induccion ya tiene programados. Los que no
 * aparezcan en el listado normal se agregan igual, marcados `disponible: false`.
 * Sin eso no habia manera de reducir la cantidad de programados: al retirarse
 * una persona desaparecia del selector pero seguia contando en el denominador,
 * y "Programada 15/16" se quedaba asi indefinidamente.
 */
export async function listTrabajadoresEmpresa(
  idempresa?: number | null,
  admin?: boolean,
  asignados?: number[],
): Promise<{ success: boolean; data: TrabajadorOpcion[]; error?: string }> {
  try {
    const supabase = await createClient()
    // Solo se listan trabajadores activos para marcar el listado de asistencia.
    let query = supabase
      .from("headcount")
      .select("id, nombre, identificacion, cargo, estado")
      .eq("estado", "Activo")
      .order("nombre", { ascending: true })
    if (admin) {
      query = query.eq("admin", true)
      if (idempresa != null) query = query.or(`idempresa.eq.${idempresa},idempresa.is.null`)
    } else if (idempresa != null) {
      // Operativo = del proyecto y NO administrativo. Ver la nota de
      // lib/bonos-actions.ts sobre por que `not is true` y no `neq(true)`.
      query = query.eq("idempresa", idempresa).not("admin", "is", true)
    }

    const { data, error } = await query
    if (error) {
      console.error("[v0] listTrabajadoresEmpresa error:", error)
      return { success: false, data: [], error: error.message }
    }

    const mapear = (r: any, disponible: boolean): TrabajadorOpcion => ({
      id: Number(r.id),
      nombre: r.nombre || "(sin nombre)",
      identificacion: r.identificacion ?? null,
      cargo: r.cargo ?? null,
      estado: r.estado ?? null,
      disponible,
    })

    const filas: TrabajadorOpcion[] = (data || []).map((r: any) => mapear(r, true))

    // Los que siguen asignados pero ya no salieron arriba. Se consultan SIN los
    // filtros de estado y de empresa a proposito: son justamente los que se
    // salieron de ese filtro, y hay que poder verlos para desmarcarlos.
    const presentes = new Set(filas.map((t) => t.id))
    const faltantes = Array.from(
      new Set(
        (asignados || [])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && !presentes.has(n)),
      ),
    )

    if (faltantes.length > 0) {
      const { data: extra, error: errExtra } = await supabase
        .from("headcount")
        .select("id, nombre, identificacion, cargo, estado")
        .in("id", faltantes)
        .order("nombre", { ascending: true })
      if (errExtra) {
        console.error("[v0] listTrabajadoresEmpresa asignados fuera de listado:", errExtra)
      }
      for (const r of extra || []) filas.push(mapear(r, false))

      // Un ID asignado que ya ni existe en headcount. Se muestra igual, con el
      // numero por nombre: si se omitiera quedaria imposible de quitar.
      const hallados = new Set((extra || []).map((r: any) => Number(r.id)))
      for (const id of faltantes) {
        if (hallados.has(id)) continue
        filas.push({
          id,
          nombre: `Trabajador #${id}`,
          identificacion: null,
          cargo: null,
          estado: null,
          disponible: false,
        })
      }
    }

    return { success: true, data: filas }
  } catch (err: any) {
    console.error("[v0] listTrabajadoresEmpresa exception:", err)
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Programa una induccion: guarda la lista de trabajadores (IDs de headcount,
 * separados por coma) en el campo `trabajadores`. Al programar se reinicia
 * `ejecutada=false`; pasara a ejecutada automaticamente cuando el 100% de los
 * trabajadores diligencie el cuestionario.
 */
export async function programarInduccion(
  capacitacionId: string,
  headcountIds: number[],
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Inducciones"], "editar", "Programar inducción")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!capacitacionId) return { success: false, error: "ID requerido" }
  try {
    const supabase = await createClient()
    // De-duplicar y conservar orden.
    const unicos = Array.from(new Set(headcountIds.filter((n) => Number.isFinite(n))))
    const trabajadores = unicos.length > 0 ? unicos.join(",") : null

    const { error } = await supabase
      .from("capacitaciones")
      .update({ trabajadores, ejecutada: false })
      .eq("id", capacitacionId)
    if (error) return { success: false, error: error.message }

    // Si ya todos diligenciaron (caso raro al reprogramar), reevaluar.
    await verificarYAutoEjecutar(supabase, capacitacionId)
    return { success: true }
  } catch (err: any) {
    console.error("[v0] programarInduccion exception:", err)
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Verifica si todos los trabajadores asignados a una induccion ya diligenciaron
 * el cuestionario; de ser asi, marca la induccion como ejecutada=true.
 * Devuelve true si quedo (o ya estaba) ejecutada.
 */
async function verificarYAutoEjecutar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  capacitacionId: string,
): Promise<boolean> {
  const { data: cap } = await supabase
    .from("capacitaciones")
    .select("id, ejecutada, trabajadores, capacitaciones_evaluaciones ( id )")
    .eq("id", capacitacionId)
    .maybeSingle()
  if (!cap) return false

  const asignados = parseTrabajadores((cap as any).trabajadores)
  if (asignados.length === 0) return Boolean((cap as any).ejecutada)

  const ev = Array.isArray((cap as any).capacitaciones_evaluaciones)
    ? (cap as any).capacitaciones_evaluaciones[0]
    : (cap as any).capacitaciones_evaluaciones
  if (!ev?.id) return Boolean((cap as any).ejecutada)

  const { data: intentos } = await supabase
    .from("capacitaciones_evaluacion_intentos")
    .select("headcount_id")
    .eq("evaluacion_id", ev.id)
  const diligenciados = new Set((intentos || []).map((i: any) => Number(i.headcount_id)))

  const todos = asignados.every((id) => diligenciados.has(id))
  if (todos && !(cap as any).ejecutada) {
    await supabase.from("capacitaciones").update({ ejecutada: true }).eq("id", capacitacionId)
  }
  return todos
}

export interface IndicadorMes {
  mes: number
  // Etiqueta corta del mes (Ene, Feb, ...).
  label: string
  programadas: number
  ejecutadas: number
}

export interface IndicadorInducciones {
  anio: number
  meses: IndicadorMes[]
  totalProgramadas: number
  totalEjecutadas: number
  // Inducciones sin fecha de programacion (no entran en el desglose mensual).
  sinProgramar: number
}

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

/**
 * Indicador mes a mes para un anio dado: cuantas inducciones estan programadas
 * (tienen fecha en ese mes) vs cuantas de esas ya fueron ejecutadas.
 */
export async function getIndicadorInducciones(
  anio: number,
  idempresa?: number | null,
): Promise<{ success: boolean; data: IndicadorInducciones | null; error?: string }> {
  try {
    const supabase = await createClient()
    let query = supabase
      .from("capacitaciones")
      .select("id, fecha, ejecutada")
      .in("tipo", TIPOS_CAPACITACION)
    if (idempresa != null) query = query.eq("idempresa", idempresa)

    const { data, error } = await query
    if (error) {
      console.error("[v0] getIndicadorInducciones error:", error)
      return { success: false, data: null, error: error.message }
    }

    const meses: IndicadorMes[] = MESES_CORTOS.map((label, i) => ({
      mes: i + 1,
      label,
      programadas: 0,
      ejecutadas: 0,
    }))
    let totalProgramadas = 0
    let totalEjecutadas = 0
    let sinProgramar = 0

    for (const r of data || []) {
      if (!r.fecha) {
        sinProgramar += 1
        continue
      }
      // `fecha` es 'YYYY-MM-DD'. Parseamos sin desfase de zona horaria.
      const [y, m] = String(r.fecha).split("-").map((n) => parseInt(n, 10))
      if (y !== anio || !m || m < 1 || m > 12) continue
      const bucket = meses[m - 1]
      bucket.programadas += 1
      totalProgramadas += 1
      if (r.ejecutada) {
        bucket.ejecutadas += 1
        totalEjecutadas += 1
      }
    }

    return {
      success: true,
      data: { anio, meses, totalProgramadas, totalEjecutadas, sinProgramar },
    }
  } catch (err: any) {
    console.error("[v0] getIndicadorInducciones exception:", err)
    return { success: false, data: null, error: err?.message || "Error desconocido" }
  }
}

/* =========================================================================
 * Portal del Trabajador - presentacion y respuesta de inducciones
 * ========================================================================= */

export interface PreguntaPortal {
  id: string
  orden: number
  enunciado: string
  tipo: "mcq" | "vf"
  // Para 'mcq': {a,b,c}. Para 'vf': null (las opciones son Verdadero/Falso).
  opciones: Record<string, string> | null
}

export interface InduccionPortal {
  capacitacion: {
    id: string
    tema: string
    descripcion: string | null
    codigo_sig: string | null
    material_url: string | null
  }
  evaluacion: {
    id: string
    titulo: string
    total_preguntas: number
    puntaje_aprobacion: number
  } | null
  preguntas: PreguntaPortal[]
}

export interface InduccionResumen {
  id: string
  codigo_sig: string | null
  tema: string
  descripcion: string | null
  /**
   * Estado de ESTE trabajador en ESTA induccion, resuelto en el servidor.
   *
   * Va aqui y no se calcula en el portal a proposito. El portal lo cruzaba por
   * `codigo_sig`, que es opcional --y unico global, asi que la mayoria de las
   * inducciones se crean sin el-- y cuando venia vacio la tarjeta se quedaba
   * en "Pendiente" por mas veces que el trabajador aprobara. Aca el cruce va
   * por las llaves foraneas: capacitacion -> evaluacion -> intento, que es el
   * mismo camino por el que se guardo el intento y por lo tanto no puede
   * quedar desalineado.
   */
  intentos: number
  aprobada: boolean
  /** Del intento aprobado; si aun no aprueba, del de mejor nota. */
  mejor_puntaje: number | null
  mejor_total: number | null
  ultimo_intento: string | null
}

export interface ResultadoIntento {
  intento_id: string
  capacitacion_id: string | null
  evaluacion_titulo: string
  codigo_sig: string | null
  puntaje: number
  total: number
  aprobado: boolean
  fecha: string | null
}

/**
 * Lista las inducciones asignadas a un trabajador (esta incluido en el campo
 * `trabajadores`). Solo las inducciones a las que el trabajador fue programado
 * aparecen en su portal, sin importar si ya estan ejecutadas o no.
 */
export async function listInduccionesObligatorias(headcountId?: number): Promise<{
  success: boolean
  data: InduccionResumen[]
  error?: string
}> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("capacitaciones")
      .select("id, codigo_sig, tema, descripcion, trabajadores")
      .in("tipo", TIPOS_CAPACITACION)
      .not("trabajadores", "is", null)
      .order("codigo_sig", { ascending: true })

    if (error) {
      console.error("[v0] listInduccionesObligatorias error:", error)
      return { success: false, data: [], error: error.message }
    }

    // Filtrar en memoria: el trabajador debe estar en la lista de asignados.
    const filtradas = (data || []).filter((r: any) => {
      if (headcountId == null) return false
      return parseTrabajadores(r.trabajadores).includes(headcountId)
    })

    const estadoPorCapacitacion = await estadoDeInduccionesPorTrabajador(
      supabase,
      filtradas.map((r: any) => r.id),
      headcountId,
    )

    return {
      success: true,
      data: filtradas.map((r: any) => {
        const e = estadoPorCapacitacion.get(r.id)
        return {
          id: r.id,
          codigo_sig: r.codigo_sig ?? null,
          tema: r.tema || "(sin tema)",
          descripcion: r.descripcion ?? null,
          intentos: e?.intentos ?? 0,
          aprobada: e?.aprobada ?? false,
          mejor_puntaje: e?.puntaje ?? null,
          mejor_total: e?.total ?? null,
          ultimo_intento: e?.fecha ?? null,
        }
      }),
    }
  } catch (err: any) {
    console.error("[v0] listInduccionesObligatorias exception:", err)
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

interface EstadoIntentos {
  intentos: number
  aprobada: boolean
  puntaje: number | null
  total: number | null
  fecha: string | null
}

/**
 * Para cada capacitacion, como le fue a este trabajador.
 *
 * El recorrido es capacitacion -> capacitaciones_evaluaciones -> intentos, por
 * llave foranea. Es el mismo camino que usa `registrarIntentoEvaluacion` para
 * guardar, asi que lo que se lee aqui no puede discrepar de lo que se escribio.
 *
 * `evaluacion_id` es obligatorio en el intento; `capacitacion_id` se copia al
 * insertarlo y por eso se deja solo como respaldo, para registros viejos.
 */
async function estadoDeInduccionesPorTrabajador(
  supabase: Awaited<ReturnType<typeof createClient>>,
  capacitacionIds: string[],
  headcountId?: number,
): Promise<Map<string, EstadoIntentos>> {
  const estado = new Map<string, EstadoIntentos>()
  if (headcountId == null || capacitacionIds.length === 0) return estado

  const { data: evals, error: evErr } = await supabase
    .from("capacitaciones_evaluaciones")
    .select("id, capacitacion_id")
    .in("capacitacion_id", capacitacionIds)
  if (evErr) {
    console.error("[v0] estadoDeInduccionesPorTrabajador evaluaciones:", evErr)
    return estado
  }

  const capacitacionPorEvaluacion = new Map<string, string>()
  for (const e of evals || []) {
    if (e?.id && e?.capacitacion_id) capacitacionPorEvaluacion.set(e.id, e.capacitacion_id)
  }

  // Se traen TODOS los intentos del trabajador y no solo los de estas
  // evaluaciones: si a una induccion le reemplazaron la evaluacion, el intento
  // viejo todavia se puede reconocer por su `capacitacion_id`.
  const { data: intentos, error: iErr } = await supabase
    .from("capacitaciones_evaluacion_intentos")
    .select("evaluacion_id, capacitacion_id, puntaje, total, aprobado, fecha")
    .eq("headcount_id", headcountId)
    .order("fecha", { ascending: false })
  if (iErr) {
    console.error("[v0] estadoDeInduccionesPorTrabajador intentos:", iErr)
    return estado
  }

  for (const it of intentos || []) {
    const capId = capacitacionPorEvaluacion.get(it.evaluacion_id) ?? it.capacitacion_id ?? null
    if (!capId) continue

    const actual =
      estado.get(capId) ??
      ({ intentos: 0, aprobada: false, puntaje: null, total: null, fecha: null } as EstadoIntentos)

    actual.intentos += 1
    const aprobado = Boolean(it.aprobado)
    const puntaje = Number(it.puntaje) || 0

    // Se muestra el intento aprobado; mientras no haya, el de mejor nota. Los
    // intentos llegan del mas reciente al mas antiguo, asi que entre dos
    // aprobados se conserva el ultimo.
    const reemplaza =
      actual.puntaje == null ||
      (aprobado && !actual.aprobada) ||
      (!actual.aprobada && puntaje > actual.puntaje)
    if (reemplaza) {
      actual.puntaje = puntaje
      actual.total = Number(it.total) || 0
      actual.fecha = it.fecha ?? null
    }
    if (aprobado) actual.aprobada = true

    estado.set(capId, actual)
  }

  return estado
}

/**
 * Devuelve una induccion (por codigo_sig) con su evaluacion y preguntas para
 * presentar en el portal. NUNCA expone `respuesta_correcta`.
 */
export async function getInduccionConEvaluacion(codigoSig: string): Promise<{
  success: boolean
  data: InduccionPortal | null
  error?: string
}> {
  try {
    const supabase = await createClient()
    const { data: cap, error: capErr } = await supabase
      .from("capacitaciones")
      .select("id, tema, descripcion, codigo_sig, material_url")
      .in("tipo", TIPOS_CAPACITACION)
      .eq("activa", true)
      .eq("codigo_sig", codigoSig)
      .maybeSingle()

    if (capErr || !cap) {
      return { success: false, data: null, error: capErr?.message || "Induccion no encontrada" }
    }

    return await armarInduccionPortal(supabase, cap)
  } catch (err: any) {
    console.error("[v0] getInduccionConEvaluacion exception:", err)
    return { success: false, data: null, error: err?.message || "Error desconocido" }
  }
}

/**
 * Igual que getInduccionConEvaluacion pero resuelve por el id de la induccion.
 * Es la via robusta usada por el portal: el id es unico y siempre existe,
 * mientras que codigo_sig puede ser nulo o repetirse entre empresas (p. ej.
 * tras duplicar una induccion en varios proyectos).
 */
export async function getInduccionConEvaluacionPorId(id: string): Promise<{
  success: boolean
  data: InduccionPortal | null
  error?: string
}> {
  try {
    const supabase = await createClient()
    const { data: cap, error: capErr } = await supabase
      .from("capacitaciones")
      .select("id, tema, descripcion, codigo_sig, material_url")
      .in("tipo", TIPOS_CAPACITACION)
      .eq("id", id)
      .maybeSingle()

    if (capErr || !cap) {
      return { success: false, data: null, error: capErr?.message || "Induccion no encontrada" }
    }

    return await armarInduccionPortal(supabase, cap)
  } catch (err: any) {
    console.error("[v0] getInduccionConEvaluacionPorId exception:", err)
    return { success: false, data: null, error: err?.message || "Error desconocido" }
  }
}

/**
 * Helper compartido: a partir de una capacitacion (induccion) ya consultada,
 * arma su evaluacion + preguntas para el portal SIN exponer respuesta_correcta.
 */
async function armarInduccionPortal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cap: any,
): Promise<{ success: boolean; data: InduccionPortal | null; error?: string }> {
  try {

    const { data: ev } = await supabase
      .from("capacitaciones_evaluaciones")
      .select("id, titulo, total_preguntas, puntaje_aprobacion")
      .eq("capacitacion_id", (cap as any).id)
      .maybeSingle()

    let preguntas: PreguntaPortal[] = []
    if (ev?.id) {
      // Importante: NO seleccionamos respuesta_correcta para no filtrarla
      // al cliente. La calificacion ocurre solo en el servidor.
      const { data: pregs } = await supabase
        .from("capacitaciones_evaluacion_preguntas")
        .select("id, orden, enunciado, tipo, opciones")
        .eq("evaluacion_id", ev.id)
        .order("orden", { ascending: true })
      preguntas = (pregs || []).map((p: any) => ({
        id: p.id,
        orden: Number(p.orden) || 0,
        enunciado: p.enunciado || "",
        tipo: p.tipo === "vf" ? "vf" : "mcq",
        opciones: p.tipo === "vf" ? null : (p.opciones ?? null),
      }))
    }

    return {
      success: true,
      data: {
        capacitacion: {
          id: (cap as any).id,
          tema: (cap as any).tema || "",
          descripcion: (cap as any).descripcion ?? null,
          codigo_sig: (cap as any).codigo_sig ?? null,
          material_url: (cap as any).material_url ?? null,
        },
        evaluacion: ev
          ? {
              id: ev.id,
              titulo: ev.titulo || "",
              total_preguntas: Number(ev.total_preguntas) || preguntas.length,
              puntaje_aprobacion: Number(ev.puntaje_aprobacion) || 0,
            }
          : null,
        preguntas,
      },
    }
  } catch (err: any) {
    console.error("[v0] getInduccionConEvaluacion exception:", err)
    return { success: false, data: null, error: err?.message || "Error desconocido" }
  }
}

/**
 * Normaliza una respuesta para comparacion: minusculas y sin espacios extra.
 */
function normalizar(v: string): string {
  return (v || "").toString().trim().toLowerCase()
}

interface RegistrarIntentoInput {
  evaluacionId: string
  headcountId: number
  respuestas: { pregunta_id: string; respuesta: string }[]
  // URL de la firma digital del trabajador (ya subida al bucket de firmas).
  firmaUrl?: string | null
}

/**
 * Califica y registra un intento de evaluacion de induccion. Toda la logica
 * de calificacion (lectura de respuesta_correcta) ocurre SOLO en el servidor.
 * - 'vf': compara texto 'Verdadero'/'Falso'.
 * - 'mcq': compara la clave 'a'|'b'|'c'.
 * Inserta el intento + respuestas y hace upsert en capacitaciones_asistencia.
 */
export async function registrarIntentoEvaluacion(input: RegistrarIntentoInput): Promise<{
  success: boolean
  intento_id?: string
  puntaje?: number
  total?: number
  aprobado?: boolean
  error?: string
}> {
  try {
    const supabase = await createClient()
    const { evaluacionId, headcountId, respuestas, firmaUrl } = input

    // Datos de la evaluacion (capacitacion_id + umbral de aprobacion).
    const { data: ev, error: evErr } = await supabase
      .from("capacitaciones_evaluaciones")
      .select("id, capacitacion_id, puntaje_aprobacion, total_preguntas")
      .eq("id", evaluacionId)
      .single()
    if (evErr || !ev) return { success: false, error: evErr?.message || "Evaluacion no encontrada" }

    // Preguntas con respuesta_correcta - SOLO en el servidor.
    const { data: pregs, error: pErr } = await supabase
      .from("capacitaciones_evaluacion_preguntas")
      .select("id, tipo, respuesta_correcta")
      .eq("evaluacion_id", evaluacionId)
    if (pErr || !pregs) return { success: false, error: pErr?.message || "No hay preguntas" }

    const correctaPorId = new Map<string, { tipo: string; correcta: string }>()
    pregs.forEach((p: any) => {
      correctaPorId.set(p.id, { tipo: p.tipo, correcta: p.respuesta_correcta })
    })

    const total = pregs.length
    let puntaje = 0
    const respuestaRows: { pregunta_id: string; respuesta: string; es_correcta: boolean }[] = []

    for (const r of respuestas) {
      const meta = correctaPorId.get(r.pregunta_id)
      if (!meta) continue
      const esCorrecta = normalizar(r.respuesta) === normalizar(meta.correcta)
      if (esCorrecta) puntaje += 1
      respuestaRows.push({
        pregunta_id: r.pregunta_id,
        respuesta: r.respuesta,
        es_correcta: esCorrecta,
      })
    }

    const aprobado = puntaje >= (Number(ev.puntaje_aprobacion) || 0)

    // Insertar intento.
    const { data: intento, error: iErr } = await supabase
      .from("capacitaciones_evaluacion_intentos")
      .insert({
        evaluacion_id: evaluacionId,
        capacitacion_id: ev.capacitacion_id,
        headcount_id: headcountId,
        puntaje,
        total,
        aprobado,
      })
      .select("id")
      .single()
    if (iErr || !intento) return { success: false, error: iErr?.message || "No se pudo registrar el intento" }

    // Insertar detalle de respuestas.
    if (respuestaRows.length > 0) {
      await supabase.from("capacitaciones_evaluacion_respuestas").insert(
        respuestaRows.map((r) => ({ ...r, intento_id: intento.id })),
      )
    }

    // Upsert en asistencia para reflejar el resultado mas reciente.
    await supabase.from("capacitaciones_asistencia").upsert(
      {
        capacitacion_id: ev.capacitacion_id,
        headcount_id: headcountId,
        asistio: true,
        resultado: `${aprobado ? "Aprobo" : "Reprobo"} ${puntaje}/${total}`,
      },
      { onConflict: "capacitacion_id,headcount_id" },
    )

    // Persistir la firma digital del trabajador en la evaluacion.
    if (firmaUrl) {
      await supabase
        .from("capacitaciones_evaluaciones")
        .update({ urlfirma: firmaUrl })
        .eq("id", evaluacionId)
    }

    // Si con este intento ya todos los trabajadores asignados diligenciaron,
    // la induccion pasa a ejecutada automaticamente.
    if (ev.capacitacion_id) {
      await verificarYAutoEjecutar(supabase, ev.capacitacion_id)
    }

    return { success: true, intento_id: intento.id, puntaje, total, aprobado }
  } catch (err: any) {
    console.error("[v0] registrarIntentoEvaluacion exception:", err)
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Devuelve el historial de intentos de un trabajador (por headcount_id) con el
 * titulo y codigo de cada induccion, para mostrar estado Aprobada/Pendiente.
 */
export async function getResultadosPorHeadcount(headcountId: number): Promise<{
  success: boolean
  data: ResultadoIntento[]
  error?: string
}> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("capacitaciones_evaluacion_intentos")
      .select(
        "id, capacitacion_id, puntaje, total, aprobado, fecha, evaluacion:evaluacion_id ( titulo, codigo_sig )",
      )
      .eq("headcount_id", headcountId)
      .order("fecha", { ascending: false })

    if (error) {
      console.error("[v0] getResultadosPorHeadcount error:", error)
      return { success: false, data: [], error: error.message }
    }

    const rows: ResultadoIntento[] = (data || []).map((r: any) => {
      const ev = Array.isArray(r.evaluacion) ? r.evaluacion[0] : r.evaluacion
      return {
        intento_id: r.id,
        capacitacion_id: r.capacitacion_id ?? null,
        evaluacion_titulo: ev?.titulo || "(sin titulo)",
        codigo_sig: ev?.codigo_sig ?? null,
        puntaje: Number(r.puntaje) || 0,
        total: Number(r.total) || 0,
        aprobado: Boolean(r.aprobado),
        fecha: r.fecha ?? null,
      }
    })

    return { success: true, data: rows }
  } catch (err: any) {
    console.error("[v0] getResultadosPorHeadcount exception:", err)
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}
