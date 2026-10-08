"use server"

import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { numeroALetrasPesos, formatearPesos } from "@/lib/numero-a-letras"
import { getColombiaDate } from "@/lib/date-utils"
import {
  cumpleAnticipacionPermiso,
  mensajeAnticipacionPermiso,
} from "@/lib/permisos-anticipacion"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/**
 * Registro de solicitud_trabajadores con datos del colaborador (JOIN headcount).
 * Refleja los campos esperados en la tabla `solicitudes_trabajadores`. Si en la
 * base de datos alguno falta, Supabase devolvera null y la UI lo tolera.
 */
export interface SolicitudTrabajador {
  id: string
  colaborador_id: number
  colaborador_nombre: string
  colaborador_cargo: string | null
  colaborador_identificacion: string | null
  tipo: "certificado" | "anticipo" | "permiso"
  estado: "pendiente" | "aprobada" | "rechazada" | "completada"
  created_at: string
  // Campos especificos por tipo
  monto: number | null
  motivo_rechazo: string | null
  soporte_url: string | null
  url_documento_final: string | null
  fecha_inicio_permiso: string | null
  fecha_fin_permiso: string | null
  tipo_permiso: string | null
  comentarios: string | null
  // Doble flujo de aprobacion para permisos: cada rol (GH / Coordinacion)
  // tiene su propio campo. El estado global pasa a 'aprobada' solo cuando
  // ambos estan en 'aprobado'. Cualquiera de los dos en 'rechazado' fuerza
  // estado global 'rechazada'. Para tipos distintos a 'permiso' siempre son null.
  permiso_aprobacion_gh: "pendiente" | "aprobado" | "rechazado" | null
  permiso_aprobacion_coord: "pendiente" | "aprobado" | "rechazado" | null
}

/**
 * Normaliza filas de `solicitudes_trabajadores` uniendolas en memoria con el
 * mapa de headcount (id -> datos basicos). Evita depender del JOIN embebido
 * de PostgREST, que requiere FK registrada en el schema cache.
 */
function normalizeRows(
  rows: any[],
  headcountMap: Map<number, { nombre: string; cargo: string | null; identificacion: string | null }>,
): SolicitudTrabajador[] {
  return (rows || []).map((r) => {
    const hc = headcountMap.get(r.colaborador_id)
    return {
      id: String(r.id),
      colaborador_id: r.colaborador_id,
      colaborador_nombre: hc?.nombre || "(sin nombre)",
      colaborador_cargo: hc?.cargo || null,
      colaborador_identificacion: hc?.identificacion || null,
      tipo: r.tipo,
      estado: r.estado,
      // En la BD la fecha de creacion es `fecha_solicitud`; en las queries se
      // usa `created_at:fecha_solicitud` (alias PostgREST) por lo que aqui ya
      // llega como `r.created_at`. Se mantienen fallbacks por seguridad.
      created_at: r.created_at ?? r.fecha_solicitud ?? null,
      monto: r.monto ?? null,
      motivo_rechazo: r.motivo_rechazo ?? null,
      soporte_url: r.soporte_url ?? null,
      url_documento_final: r.url_documento_final ?? null,
      fecha_inicio_permiso: r.fecha_inicio_permiso ?? null,
      fecha_fin_permiso: r.fecha_fin_permiso ?? null,
      tipo_permiso: r.tipo_permiso ?? null,
      comentarios: r.comentarios ?? null,
      permiso_aprobacion_gh: (r.permiso_aprobacion_gh as any) ?? null,
      permiso_aprobacion_coord: (r.permiso_aprobacion_coord as any) ?? null,
    }
  })
}

/**
 * Lista TODAS las solicitudes del sistema con datos del colaborador.
 *
 * NOTA: Esta vista de Gestion de Solicitudes NO filtra por empresa por pedido
 * explicito del cliente — el equipo central de RRHH debe ver y gestionar las
 * solicitudes de todas las empresas en un unico tablero. El parametro
 * `selectedEmpresaId` se mantiene en la firma solo por compatibilidad con los
 * callers existentes, pero se ignora.
 *
 * Estrategia en 2 pasos (sin JOIN embebido de PostgREST):
 *  1. Traer todas las solicitudes.
 *  2. Traer headcount solo de los `colaborador_id` referenciados para armar
 *     el mapa de nombres/cargos/identificaciones.
 */
export async function getSolicitudesTrabajadores(
  _selectedEmpresaId?: number | null,
): Promise<{ success: boolean; data: SolicitudTrabajador[]; error?: string }> {
  try {
    const supabase = await createClient()

    // 1) TODAS las solicitudes (sin filtro de empresa).
    //
    // Esquema real de `solicitudes_trabajadores`:
    //   - fecha de creacion = `fecha_solicitud` (no `created_at`)
    //   - url del soporte   = `url_soporte`     (no `soporte_url`)
    //
    // Usamos aliases de PostgREST (`alias:columna_real`) para mantener estable
    // el tipo `SolicitudTrabajador` y la UI sin renombrar todo el dominio.
    const { data, error } = await supabase
      .from("solicitudes_trabajadores")
      .select(
        "id, colaborador_id, tipo, estado, created_at:fecha_solicitud, monto, motivo_rechazo, soporte_url:url_soporte, url_documento_final, fecha_inicio_permiso, fecha_fin_permiso, tipo_permiso, comentarios, permiso_aprobacion_gh, permiso_aprobacion_coord",
      )
      .order("fecha_solicitud", { ascending: false })

    if (error) {
      return { success: false, data: [], error: error.message }
    }

    const rows = data || []
    if (rows.length === 0) {
      return { success: true, data: [] }
    }

    // 2) Headcount solo para los colaboradores referenciados
    const colabIds = Array.from(new Set(rows.map((r: any) => r.colaborador_id))).filter(
      (v) => v !== null && v !== undefined,
    )

    const headcountMap = new Map<
      number,
      { nombre: string; cargo: string | null; identificacion: string | null }
    >()

    if (colabIds.length > 0) {
      const { data: hcData, error: hcError } = await supabase
        .from("headcount")
        .select("id, nombre, cargo, identificacion")
        .in("id", colabIds)
      if (hcError) {
        return { success: false, data: [], error: hcError.message }
      }
      for (const h of hcData || []) {
        headcountMap.set(h.id, {
          nombre: h.nombre,
          cargo: h.cargo ?? null,
          identificacion: h.identificacion ?? null,
        })
      }
    }

    return { success: true, data: normalizeRows(rows, headcountMap) }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Aprueba una solicitud (anticipo o permiso). El empleado debera firmar en el portal
 * para que la solicitud pase a `completada`.
 *
 * `fecha_aprobacion` queda registrada aqui: es la fecha que usa la vista
 * `archivoplano` para calcular la quincena del anticipo (novedad
 * "56-Dcto. Anticipo de Nomina-Deduccion" en Siigo), no `fecha_solicitud`
 * (alguien puede pedir el 14 y aprobarse el 17, cambiando de quincena).
 */
export async function aprobarSolicitud(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Solicitudes", "Aprobación de Solicitudes de Personal"], "aprobar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()
    const fechaAprobacion = await getColombiaDate()
    const { error } = await supabase
      .from("solicitudes_trabajadores")
      .update({ estado: "aprobada", motivo_rechazo: null, fecha_aprobacion: fechaAprobacion })
      .eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Rechaza una solicitud guardando el motivo.
 */
export async function rechazarSolicitud(
  id: string,
  motivo: string,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Solicitudes", "Aprobación de Solicitudes de Personal"], "anular", "Rechazar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    if (!motivo || !motivo.trim()) {
      return { success: false, error: "El motivo de rechazo es obligatorio" }
    }
    const supabase = await createClient()
    const { error } = await supabase
      .from("solicitudes_trabajadores")
      .update({ estado: "rechazada", motivo_rechazo: motivo.trim() })
      .eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Elimina por completo una solicitud de la tabla `solicitudes_trabajadores`.
 *
 * A diferencia de `rechazarSolicitud` (que solo cambia el estado a
 * "rechazada"), esta accion borra fisicamente la fila. La usamos cuando
 * el equipo de RRHH necesita limpiar solicitudes creadas por error o
 * duplicadas que no deben quedar visibles ni en el historial del
 * portal del trabajador.
 *
 * El borrado es idempotente: si el id no existe, Supabase no devuelve
 * error y simplemente no afecta filas.
 */
export async function eliminarSolicitud(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Solicitudes"], "eliminar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    if (!id) {
      return { success: false, error: "Id de solicitud requerido" }
    }
    const supabase = await createClient()
    const { error } = await supabase
      .from("solicitudes_trabajadores")
      .delete()
      .eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Gestiona la aprobacion/rechazo de una solicitud de tipo `permiso` por uno
 * de los dos roles validadores: GH (Gestion Humana) o Coord (Coordinacion).
 *
 * Reglas de negocio:
 *  - Aprobacion individual: actualiza el campo del rol correspondiente
 *    (`permiso_aprobacion_gh` o `permiso_aprobacion_coord`) a `'aprobado'`,
 *    SIN tocar el estado global.
 *  - Regla critica: si despues del update ambos campos quedan en
 *    `'aprobado'`, automaticamente se actualiza el `estado` global a
 *    `'aprobada'`.
 *  - Rechazo: cualquiera de los dos roles puede rechazar. Se marca su
 *    campo en `'rechazado'`, se setea el `estado` global a `'rechazada'`
 *    y se persiste el motivo en `motivo_rechazo`.
 *
 * @param solicitudId    Id de la solicitud (debe ser tipo='permiso').
 * @param tipoAprobador  'GH' o 'Coord'.
 * @param accion         'aprobar' o 'rechazar'.
 * @param motivo         Motivo de rechazo. Obligatorio cuando accion='rechazar'.
 */
export async function gestionarAprobacionPermiso(
  solicitudId: string,
  tipoAprobador: "GH" | "Coord",
  accion: "aprobar" | "rechazar",
  motivo?: string,
): Promise<{ success: boolean; nuevoEstadoGlobal?: string; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Solicitudes", "Aprobación de Solicitudes de Personal"], "aprobar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    if (!solicitudId) return { success: false, error: "Solicitud invalida" }
    if (tipoAprobador !== "GH" && tipoAprobador !== "Coord") {
      return { success: false, error: "Tipo de aprobador invalido" }
    }
    if (accion !== "aprobar" && accion !== "rechazar") {
      return { success: false, error: "Accion invalida" }
    }
    if (accion === "rechazar" && (!motivo || !motivo.trim())) {
      return { success: false, error: "El motivo de rechazo es obligatorio" }
    }

    const supabase = await createClient()

    // Validar que la solicitud exista y sea de tipo permiso
    const { data: actual, error: fetchErr } = await supabase
      .from("solicitudes_trabajadores")
      .select("id, tipo, estado, permiso_aprobacion_gh, permiso_aprobacion_coord")
      .eq("id", solicitudId)
      .maybeSingle()
    if (fetchErr) return { success: false, error: fetchErr.message }
    if (!actual) return { success: false, error: "Solicitud no encontrada" }
    if (actual.tipo !== "permiso") {
      return { success: false, error: "La solicitud no es de tipo permiso" }
    }

    const colField =
      tipoAprobador === "GH" ? "permiso_aprobacion_gh" : "permiso_aprobacion_coord"

    if (accion === "rechazar") {
      // Rechazo: marca el rol que rechazo en 'rechazado' + estado global
      // 'rechazada' + motivo. No tocamos el campo del otro rol porque
      // queremos preservar la trazabilidad de quien rechazo.
      const { error: updErr } = await supabase
        .from("solicitudes_trabajadores")
        .update({
          [colField]: "rechazado",
          estado: "rechazada",
          motivo_rechazo: motivo!.trim(),
        })
        .eq("id", solicitudId)
      if (updErr) return { success: false, error: updErr.message }
      return { success: true, nuevoEstadoGlobal: "rechazada" }
    }

    // Aprobacion: marca este rol como 'aprobado'. Limpiamos motivo_rechazo
    // por si la solicitud venia de un rechazo previo y se esta retomando.
    const { error: updErr } = await supabase
      .from("solicitudes_trabajadores")
      .update({ [colField]: "aprobado", motivo_rechazo: null })
      .eq("id", solicitudId)
    if (updErr) return { success: false, error: updErr.message }

    // Re-leer para evaluar la regla critica de aprobacion conjunta.
    const { data: refrescado, error: reErr } = await supabase
      .from("solicitudes_trabajadores")
      .select("permiso_aprobacion_gh, permiso_aprobacion_coord, estado")
      .eq("id", solicitudId)
      .maybeSingle()
    if (reErr) return { success: false, error: reErr.message }

    const ghOk = refrescado?.permiso_aprobacion_gh === "aprobado"
    const coordOk = refrescado?.permiso_aprobacion_coord === "aprobado"

    if (ghOk && coordOk && refrescado?.estado !== "aprobada") {
      const { error: globalErr } = await supabase
        .from("solicitudes_trabajadores")
        .update({ estado: "aprobada" })
        .eq("id", solicitudId)
      if (globalErr) return { success: false, error: globalErr.message }
      return { success: true, nuevoEstadoGlobal: "aprobada" }
    }

    return {
      success: true,
      nuevoEstadoGlobal: refrescado?.estado || actual.estado,
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Helper interno: construye un `headcountMap` con una sola entrada para el
 * colaborador dado (usado por las actions del Portal del Trabajador, donde ya
 * sabemos el id y no necesitamos listar toda la empresa).
 */
async function buildHeadcountMapForColaborador(colaboradorId: number) {
  const supabase = await createClient()
  const { data: hc } = await supabase
    .from("headcount")
    .select("id, nombre, cargo, identificacion")
    .eq("id", colaboradorId)
    .maybeSingle()
  const map = new Map<
    number,
    { nombre: string; cargo: string | null; identificacion: string | null }
  >()
  if (hc) {
    map.set(hc.id, {
      nombre: hc.nombre,
      cargo: hc.cargo ?? null,
      identificacion: hc.identificacion ?? null,
    })
  }
  return { supabase, map }
}

/**
 * Lista las solicitudes de certificado de un colaborador, ordenadas por fecha
 * descendente. Se usa desde el Portal del Trabajador para mostrar el estado
 * de cada certificado y habilitar la descarga cuando esta listo.
 */
export async function getCertificadosPorColaborador(
  colaboradorId: number,
): Promise<{ success: boolean; data: SolicitudTrabajador[]; error?: string }> {
  try {
    const { supabase, map } = await buildHeadcountMapForColaborador(colaboradorId)
    const { data, error } = await supabase
      .from("solicitudes_trabajadores")
      .select(
        "id, colaborador_id, tipo, estado, created_at:fecha_solicitud, monto, motivo_rechazo, soporte_url:url_soporte, url_documento_final, fecha_inicio_permiso, fecha_fin_permiso, tipo_permiso, comentarios, permiso_aprobacion_gh, permiso_aprobacion_coord",
      )
      .eq("colaborador_id", colaboradorId)
      .eq("tipo", "certificado")
      .order("fecha_solicitud", { ascending: false })

    if (error) {
      return { success: false, data: [], error: error.message }
    }
    return { success: true, data: normalizeRows(data || [], map) }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Marca un certificado como completado guardando la URL del PDF generado.
 */
export async function completarCertificado(
  id: string,
  documentoUrl: string,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Solicitudes"], "editar", "Completar certificado")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("solicitudes_trabajadores")
      .update({ estado: "completada", url_documento_final: documentoUrl })
      .eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/* -------------------------------------------------------------------------
 * Generacion automatica de Certificados Laborales (.docx)
 * ------------------------------------------------------------------------- */

/**
 * Devuelve la fecha actual de Bogota desglosada en partes utiles para el
 * certificado: dia (numerico), mes (en espanol) y anio.
 */
function fechaActualParaCertificado(): { dia: string; mes: string; anio: string } {
  const meses = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ]
  // Forzamos zona horaria America/Bogota usando Intl, pero como no esta
  // disponible en todos los runtimes para getters separados, derivamos a
  // partir de toLocaleString con formato controlado.
  const ahora = new Date()
  const fmt = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(ahora)

  const dia = fmt.find((p) => p.type === "day")?.value ?? String(ahora.getDate())
  const mesNum = parseInt(
    fmt.find((p) => p.type === "month")?.value ?? String(ahora.getMonth() + 1),
    10,
  )
  const anio = fmt.find((p) => p.type === "year")?.value ?? String(ahora.getFullYear())

  return {
    dia,
    mes: meses[Math.max(0, Math.min(11, mesNum - 1))],
    anio,
  }
}

/**
 * Formatea una fecha ISO/string como "DD de MES de YYYY" en espanol.
 * Tolera valores nulos o invalidos devolviendo un guion.
 */
function formatFechaLargaEspanol(fecha: string | null | undefined): string {
  if (!fecha) return "-"
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return String(fecha)
  const meses = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ]
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`
}

/**
 * Genera el certificado laboral en formato .docx para una solicitud aprobada.
 *
 * Pasos:
 *  1. Carga la solicitud + datos del headcount (nombre, identificacion, cargo,
 *     fechainicio, salario).
 *  2. Descarga la plantilla `plantillas/certificado_base.docx` desde Supabase
 *     Storage.
 *  3. Llena los placeholders con docxtemplater (nombre, cedula, cargo,
 *     fecha_inicio, salario_numero, salario_letras, auxilio_numero,
 *     auxilio_letras, dia, mes, anio).
 *  4. Sube el .docx al bucket `certificados` con nombre `solicitud_<id>.docx`
 *     (upsert) y marca la solicitud como `completada` con la URL publica.
 *  5. Devuelve el archivo en base64 al cliente para que dispare la descarga
 *     automatica con el nombre `Certificado_<NombreEmpleado>.docx`.
 *
 * @param solicitudId  Id de la fila en `solicitudes_trabajadores` (tipo='certificado').
 * @param auxilioMonto Valor del auxilio de transporte (en pesos). Por defecto 249.095.
 */
export async function generarCertificadoLaboralWord(
  solicitudId: string,
  auxilioMonto: number = 249095,
): Promise<{
  success: boolean
  fileName?: string
  base64?: string
  publicUrl?: string
  error?: string
}> {
  console.log("[v0] generarCertificadoLaboralWord invocado, solicitudId:", solicitudId)
  try {
    if (!solicitudId) {
      return { success: false, error: "Solicitud invalida" }
    }
    const supabase = await createClient()

    // 1) Solicitud
    const { data: solicitud, error: solErr } = await supabase
      .from("solicitudes_trabajadores")
      .select("id, colaborador_id, tipo, estado")
      .eq("id", solicitudId)
      .maybeSingle()

    if (solErr) return { success: false, error: solErr.message }
    if (!solicitud) return { success: false, error: "Solicitud no encontrada" }
    if (solicitud.tipo !== "certificado") {
      return { success: false, error: "La solicitud no es de tipo certificado" }
    }

    // 2) Datos del colaborador (incluyendo salario y fechainicio)
    const { data: colab, error: colabErr } = await supabase
      .from("headcount")
      .select("id, nombre, identificacion, cargo, fechainicio, salario")
      .eq("id", solicitud.colaborador_id)
      .maybeSingle()

    if (colabErr) return { success: false, error: colabErr.message }
    if (!colab) return { success: false, error: "Colaborador no encontrado" }

    // 3) Generar el PDF tomando como base la plantilla oficial en
    //    `plantillas/certificado_base.pdf`. La plantilla ya trae el
    //    fondo corporativo, el membrete y la firma escaneada del
    //    representante legal; nosotros solo dibujamos encima los
    //    datos variables del empleado para no perder nada de ese
    //    formato visual. Esta tecnica funciona en runtime serverless
    //    sin binarios nativos (a diferencia de convertir docx -> pdf
    //    con LibreOffice) y produce un PDF identico a la plantilla.
    const storageAdmin = await getSupabaseAdmin()

    const salarioNum = Number(colab.salario) || 0
    const auxilioNum = Number(auxilioMonto) || 0
    const fechaActual = fechaActualParaCertificado()

    const salarioStr = `${formatearPesos(salarioNum)} (${numeroALetrasPesos(salarioNum)})`
    const auxilioStr = `${formatearPesos(auxilioNum)} (${numeroALetrasPesos(auxilioNum)})`
    const fechaInicioStr = formatFechaLargaEspanol(colab.fechainicio as any)
    const fechaExpedicion = `${fechaActual.dia} de ${fechaActual.mes} de ${fechaActual.anio}`

    // 3.1) Descargar plantilla PDF del bucket `plantillas`. Se
    //      espera que el cliente haya subido `certificado_base.pdf`
    //      (la version PDF del Word original con fondo y firma).
    const { data: tplBlob, error: tplErr } = await storageAdmin.storage
      .from("plantillas")
      .download("certificado_base.pdf")
    if (tplErr || !tplBlob) {
      return {
        success: false,
        error:
          `No se pudo descargar la plantilla certificado_base.pdf del bucket plantillas: ` +
          (tplErr?.message || "blob vacio"),
      }
    }
    const tplBuffer = Buffer.from(await tplBlob.arrayBuffer())

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")
    const pdfDoc = await PDFDocument.load(tplBuffer)
    const fontRegular = await pdfDoc.embedFont(StandardFonts.TimesRoman)
    const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)

    // Trabajamos sobre la primera pagina (carta tipica). Si la
    // plantilla cambia a varias paginas, este indice se ajusta.
    const page = pdfDoc.getPages()[0]
    const { width: pageWidth, height: pageHeight } = page.getSize()
    const margin = 72
    const contentWidth = pageWidth - margin * 2

    // Posicion vertical donde empieza a escribirse el cuerpo del
    // certificado. La plantilla suele tener un encabezado (logo,
    // titulo "CERTIFICACION LABORAL") en el tercio superior, asi que
    // arrancamos a ~38% desde arriba para que el texto caiga en el
    // area en blanco. Si quedara muy alto/bajo respecto a la
    // plantilla, se ajusta este unico valor.
    // Ajuste: subimos el inicio del texto 3 lineas (size 12 +
    // lineGap 6 = 18pt cada una, ~54pt en total) porque la
    // version anterior dejaba el bloque demasiado pegado a la
    // firma de la plantilla.
    let cursorY = pageHeight * 0.62 + 54

    // Helper: dibuja texto con word-wrap automatico al ancho de
    // contenido. Soporta saltos manuales con `\n`, alineacion
    // centrada o izquierda y un line-gap configurable. Reescribe
    // hacia abajo a partir de `cursorY`.
    const drawWrappedText = (
      text: string,
      options: {
        size?: number
        bold?: boolean
        align?: "left" | "center" | "justify"
        lineGap?: number
      } = {},
    ) => {
      const size = options.size ?? 12
      const font = options.bold ? fontBold : fontRegular
      const lineGap = options.lineGap ?? 6
      const paragraphs = text.split("\n")
      for (const paragraph of paragraphs) {
        const words = paragraph.replace(/\s+/g, " ").trim().split(" ")
        const lines: string[] = []
        let current = ""
        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word
          if (font.widthOfTextAtSize(candidate, size) > contentWidth && current) {
            lines.push(current)
            current = word
          } else {
            current = candidate
          }
        }
        if (current) lines.push(current)
        for (const line of lines) {
          const x =
            options.align === "center"
              ? margin + (contentWidth - font.widthOfTextAtSize(line, size)) / 2
              : margin
          page.drawText(line, { x, y: cursorY, size, font, color: rgb(0, 0, 0) })
          cursorY -= size + lineGap
        }
      }
    }

    const spacer = (h: number) => {
      cursorY -= h
    }

    // Cuerpo dinamico: respetamos el mismo texto que ya manejaba
    // RRHH, solo le insertamos los datos del colaborador. La
    // plantilla aporta el resto (titulo "CERTIFICACION LABORAL",
    // logo, firma, pie de pagina).
    const cuerpo =
      `Que el(la) senor(a) ${colab.nombre || ""} identificado(a) con Cedula ` +
      `de Ciudadania numero ${colab.identificacion || ""}, labora en nuestra ` +
      `compania desde el ${fechaInicioStr}, mediante un contrato por obra o ` +
      `labor, desempenando el cargo de ${colab.cargo || ""}, devengando un ` +
      `salario basico mensual de ${salarioStr} y un Auxilio de Transporte ` +
      `Legal de ${auxilioStr}.`
    drawWrappedText(cuerpo, { size: 12 })
    spacer(14)

    drawWrappedText(
      `Se expide esta constancia a solicitud del interesado a los ${fechaExpedicion}.`,
      { size: 12 },
    )

    const pdfBytes = await pdfDoc.save()
    const outBuffer = Buffer.from(pdfBytes)

    // 4) Subir al bucket `certificados` con upsert y devolver URL
    //    publica. El bucket puede tener RLS, por eso usamos el
    //    cliente admin.
    const storagePath = `solicitud_${solicitudId}.pdf`
    const { error: upErr } = await storageAdmin.storage
      .from("certificados")
      .upload(storagePath, outBuffer, {
        cacheControl: "3600",
        contentType: "application/pdf",
        upsert: true,
      })

    if (upErr) {
      return { success: false, error: `Error al subir documento: ${upErr.message}` }
    }

    const { data: urlData } = storageAdmin.storage
      .from("certificados")
      .getPublicUrl(storagePath)
    const publicUrl = urlData?.publicUrl
    if (!publicUrl) {
      return { success: false, error: "No se pudo obtener la URL publica" }
    }

    // 5) Marcar solicitud como completada y guardar la URL final
    const { error: updErr } = await supabase
      .from("solicitudes_trabajadores")
      .update({ estado: "completada", url_documento_final: publicUrl })
      .eq("id", solicitudId)
    if (updErr) {
      return { success: false, error: `Error al actualizar solicitud: ${updErr.message}` }
    }

    // 6) Nombre amigable para la descarga (PDF)
    const safeNombre = (colab.nombre || "Empleado")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    const fileName = `Certificado_${safeNombre || "Empleado"}.pdf`

    return {
      success: true,
      fileName,
      base64: outBuffer.toString("base64"),
      publicUrl,
    }
  } catch (err: any) {
    console.log(
      "[v0] generarCertificadoLaboralWord catch:",
      err?.message,
      err?.stack,
    )
    return {
      success: false,
      error: err?.message || "Error generando certificado",
    }
  }
}

/* -------------------------------------------------------------------------
 * Server Actions invocadas desde el Portal del Trabajador
 * ------------------------------------------------------------------------- */

/**
 * Crea una solicitud de CERTIFICADO laboral en estado 'pendiente'.
 * La revisara el equipo de RRHH desde Gestion de Solicitudes.
 */
export async function createSolicitudCertificado(
  colaboradorId: number,
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!colaboradorId) {
      return { success: false, error: "Colaborador invalido" }
    }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("solicitudes_trabajadores")
      .insert({
        colaborador_id: colaboradorId,
        tipo: "certificado",
        estado: "pendiente",
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: String(data?.id) }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Crea una solicitud de ANTICIPO. Valida que el monto sea un positivo menor o
 * igual a 300.000 COP. La aprobacion final es manual desde RRHH.
 */
export async function createSolicitudAnticipo(
  colaboradorId: number,
  monto: number,
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!colaboradorId) return { success: false, error: "Colaborador invalido" }
    if (!Number.isFinite(monto) || monto <= 0) {
      return { success: false, error: "El monto debe ser mayor a cero" }
    }
    if (monto > 300000) {
      return { success: false, error: "El monto maximo permitido es 300.000" }
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("solicitudes_trabajadores")
      .insert({
        colaborador_id: colaboradorId,
        tipo: "anticipo",
        estado: "pendiente",
        monto,
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: String(data?.id) }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Crea una solicitud de PERMISO. Valida la anticipacion minima —3 dias de
 * calendario CONTANDO HOY, ver lib/permisos-anticipacion.ts— y que
 * fecha_fin >= fecha_inicio.
 */
export async function createSolicitudPermiso(
  colaboradorId: number,
  payload: {
    tipo_permiso: string
    fecha_inicio: string // YYYY-MM-DD
    fecha_fin: string // YYYY-MM-DD
    comentarios: string
  },
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!colaboradorId) return { success: false, error: "Colaborador invalido" }
    const { tipo_permiso, fecha_inicio, fecha_fin, comentarios } = payload

    if (!tipo_permiso) return { success: false, error: "Selecciona un tipo de permiso" }
    if (!fecha_inicio || !fecha_fin) {
      return { success: false, error: "Las fechas son obligatorias" }
    }
    // Las fechas se comparan como texto YYYY-MM-DD: en ese formato el orden
    // alfabetico es el cronologico, asi que no hace falta construir `Date` — y
    // se evita el desfase de un dia al parsear una fecha sin hora, que en el
    // servidor (UTC) es un error facil de cometer.
    const esFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim())
    if (!esFecha(fecha_inicio) || !esFecha(fecha_fin)) {
      return { success: false, error: "Fechas invalidas" }
    }
    // Validacion critica. Misma funcion que usa el formulario del portal, para
    // que cliente y servidor no puedan discrepar sobre que fecha es valida.
    if (!cumpleAnticipacionPermiso(fecha_inicio)) {
      return { success: false, error: mensajeAnticipacionPermiso() }
    }
    if (fecha_fin < fecha_inicio) {
      return { success: false, error: "La fecha fin no puede ser anterior al inicio" }
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("solicitudes_trabajadores")
      .insert({
        colaborador_id: colaboradorId,
        tipo: "permiso",
        estado: "pendiente",
        tipo_permiso,
        fecha_inicio_permiso: fecha_inicio,
        fecha_fin_permiso: fecha_fin,
        comentarios: comentarios?.trim() || null,
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: String(data?.id) }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Sube la firma del anticipo aprobado por parte del trabajador y marca la
 * solicitud como `completada`.
 *
 * Acepta tanto:
 *  - Un escaneo del documento firmado (PDF / JPG / PNG).
 *  - Una imagen PNG generada en el cliente desde un canvas de firma digital.
 *
 * Pasos:
 *  1. Valida que la solicitud exista, sea de tipo 'anticipo' y este 'aprobada'.
 *  2. Decodifica el archivo (base64 -> Buffer) y lo sube al bucket
 *     `evidencias-anticipos` con la ruta `solicitud_<id>.<ext>` (upsert).
 *  3. Obtiene la URL publica.
 *  4. Actualiza la solicitud a `estado='completada'` con `url_documento_final`.
 *
 * @param solicitudId   Id de la fila en `solicitudes_trabajadores`.
 * @param fileBase64    Contenido del archivo en base64 (sin prefijo data:).
 * @param fileName      Nombre original (se usa solo para inferir extension).
 * @param contentType   MIME type real del archivo (image/png, application/pdf, etc).
 */
export async function subirFirmaAnticipo(
  solicitudId: string,
  fileBase64: string,
  fileName: string,
  contentType: string,
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  try {
    if (!solicitudId) return { success: false, error: "Solicitud invalida" }
    if (!fileBase64) return { success: false, error: "Archivo vacio" }

    const supabase = await createClient()

    // 1) Validar que la solicitud exista y este aprobada
    const { data: solicitud, error: solErr } = await supabase
      .from("solicitudes_trabajadores")
      .select("id, tipo, estado")
      .eq("id", solicitudId)
      .maybeSingle()

    if (solErr) return { success: false, error: solErr.message }
    if (!solicitud) return { success: false, error: "Solicitud no encontrada" }
    if (solicitud.tipo !== "anticipo") {
      return { success: false, error: "La solicitud no es de tipo anticipo" }
    }
    if (solicitud.estado !== "aprobada") {
      return {
        success: false,
        error: "La firma solo se puede subir cuando el anticipo esta aprobado",
      }
    }

    // 2) Decodificar y subir
    const buffer = Buffer.from(fileBase64, "base64")
    // Determinar extension: priorizamos contentType, caemos al nombre original
    const extByMime: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "application/pdf": "pdf",
    }
    let ext = extByMime[contentType.toLowerCase()] || ""
    if (!ext) {
      const dot = (fileName || "").lastIndexOf(".")
      ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "bin"
    }
    const storagePath = `solicitud_${solicitudId}.${ext}`

    // Bucket `firmas`: almacena los documentos firmados por el
    // trabajador para anticipos aprobados. Antes apuntabamos a
    // `evidencias-anticipos` pero ese bucket no existe en la
    // instancia de Supabase del cliente y el upload fallaba con
    // "Bucket not found". Usamos el cliente admin (service role)
    // porque el bucket puede tener RLS y la sesion del trabajador
    // (cliente normal) no necesariamente tiene permiso de write.
    const storageAdmin = await getSupabaseAdmin()
    const { error: upErr } = await storageAdmin.storage
      .from("firmas")
      .upload(storagePath, buffer, {
        cacheControl: "3600",
        contentType: contentType || "application/octet-stream",
        upsert: true,
      })

    if (upErr) {
      return { success: false, error: `Error al subir firma: ${upErr.message}` }
    }

    // 3) URL publica
    const { data: urlData } = storageAdmin.storage
      .from("firmas")
      .getPublicUrl(storagePath)
    const publicUrl = urlData?.publicUrl
    if (!publicUrl) {
      return { success: false, error: "No se pudo obtener la URL publica" }
    }

    // 4) Marcar como completada
    const { error: updErr } = await supabase
      .from("solicitudes_trabajadores")
      .update({ estado: "completada", url_documento_final: publicUrl })
      .eq("id", solicitudId)
    if (updErr) {
      return { success: false, error: `Error al actualizar solicitud: ${updErr.message}` }
    }

    return { success: true, publicUrl }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Genera el PDF de "Autorizacion de descuento de anticipo de nomina" para
 * un anticipo aprobado. Reemplaza el flujo anterior donde RRHH subia un
 * documento manualmente: ahora el sistema arma el PDF a partir de los
 * datos de la solicitud + la firma que el trabajador ya cargo en el
 * bucket `firmas` (ver `subirFirmaAnticipo`), siguiendo la plantilla de
 * texto definida por GH.
 *
 * Pasos:
 *  1. Valida que la solicitud sea anticipo y este aprobada/completada.
 *  2. Lee `nombre`/`identificacion` del colaborador.
 *  3. Descarga la imagen de firma desde `firmas/solicitud_<id>.<png|jpg>`.
 *     Si no existe se aborta con un error claro -> el trabajador debe
 *     firmar primero desde el portal.
 *  4. Genera el PDF con pdf-lib (tamano carta) y embebe la firma como
 *     imagen al pie del documento.
 *  5. Sube el PDF al bucket `anticipos` particionado por anio/mes y
 *     persiste la URL publica en `url_soporte`.
 *
 * Mantenemos el nombre `subirEvidenciaAnticipo` para no romper los
 * imports existentes en `components/rrhh/gestion-solicitudes.tsx`,
 * aunque el comportamiento real ahora sea "generarYSubirAutorizacion".
 *
 * @param solicitudId  Id de la fila en `solicitudes_trabajadores`.
 * @param cuotas       Numero de cuotas quincenales del descuento (>=1).
 *                     Lo ingresa RRHH al momento de generar el documento.
 */
export async function subirEvidenciaAnticipo(
  solicitudId: string,
  cuotas: number,
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  try {
    if (!solicitudId) return { success: false, error: "Solicitud invalida" }
    if (!Number.isFinite(cuotas) || cuotas < 1) {
      return { success: false, error: "El numero de cuotas debe ser mayor o igual a 1" }
    }
    const cuotasInt = Math.floor(cuotas)

    const supabase = await createClient()
    const storageAdmin = await getSupabaseAdmin()

    // 1) Validar la solicitud
    const { data: solicitud, error: solErr } = await supabase
      .from("solicitudes_trabajadores")
      .select("id, colaborador_id, tipo, estado, fecha_solicitud, monto")
      .eq("id", solicitudId)
      .maybeSingle()

    if (solErr) return { success: false, error: solErr.message }
    if (!solicitud) return { success: false, error: "Solicitud no encontrada" }
    if (solicitud.tipo !== "anticipo") {
      return { success: false, error: "La solicitud no es de tipo anticipo" }
    }
    if (solicitud.estado !== "aprobada" && solicitud.estado !== "completada") {
      return {
        success: false,
        error:
          "Solo se puede generar el documento en anticipos aprobados o completados",
      }
    }

    // 2) Datos del colaborador
    const { data: colab } = await supabase
      .from("headcount")
      .select("nombre, identificacion")
      .eq("id", solicitud.colaborador_id)
      .maybeSingle()

    const nombreEmpleado = colab?.nombre || "Empleado"
    const cedulaEmpleado = colab?.identificacion || ""

    // 3) Descargar firma desde el bucket `firmas`. La extension puede
    //    ser png/jpg/jpeg segun como haya cargado el trabajador, asi
    //    que probamos en orden y nos quedamos con la primera disponible.
    //    Si la firma fue subida como PDF no la podemos embeber como
    //    imagen y se rechaza con un mensaje claro para que GH solicite
    //    una imagen.
    const firmaCandidates: { ext: string; mime: "png" | "jpg" }[] = [
      { ext: "png", mime: "png" },
      { ext: "jpg", mime: "jpg" },
      { ext: "jpeg", mime: "jpg" },
    ]
    let firmaBytes: Uint8Array | null = null
    let firmaMime: "png" | "jpg" = "png"
    for (const c of firmaCandidates) {
      const { data: blob, error: dlErr } = await storageAdmin.storage
        .from("firmas")
        .download(`solicitud_${solicitudId}.${c.ext}`)
      if (!dlErr && blob) {
        firmaBytes = new Uint8Array(await blob.arrayBuffer())
        firmaMime = c.mime
        break
      }
    }
    if (!firmaBytes) {
      return {
        success: false,
        error:
          "No se encontro la firma del trabajador. El empleado debe firmar primero desde su portal.",
      }
    }

    // 4) Construir PDF
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([612, 792]) // tamano carta
    const fontRegular = await pdfDoc.embedFont(StandardFonts.TimesRoman)
    const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)

    const margin = 72
    const contentWidth = 612 - margin * 2
    let cursorY = 792 - margin

    const drawWrappedText = (
      text: string,
      options: {
        size?: number
        bold?: boolean
        align?: "left" | "center"
        lineGap?: number
      } = {},
    ) => {
      const size = options.size ?? 12
      const font = options.bold ? fontBold : fontRegular
      const lineGap = options.lineGap ?? 6
      const paragraphs = text.split("\n")
      for (const paragraph of paragraphs) {
        const words = paragraph.replace(/\s+/g, " ").trim().split(" ")
        const lines: string[] = []
        let current = ""
        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word
          if (font.widthOfTextAtSize(candidate, size) > contentWidth && current) {
            lines.push(current)
            current = word
          } else {
            current = candidate
          }
        }
        if (current) lines.push(current)
        for (const line of lines) {
          const x =
            options.align === "center"
              ? margin + (contentWidth - font.widthOfTextAtSize(line, size)) / 2
              : margin
          page.drawText(line, { x, y: cursorY, size, font, color: rgb(0, 0, 0) })
          cursorY -= size + lineGap
        }
      }
    }

    const spacer = (h: number) => {
      cursorY -= h
    }

    // Fecha de generacion: dd de <mes> de aaaa en espanol
    const fechaGen = fechaActualParaCertificado()
    const fechaGenStr = `${fechaGen.dia} de ${fechaGen.mes} de ${fechaGen.anio}`

    // Valor del adelanto en numero + letras
    const montoNum = Number(solicitud.monto) || 0
    const valorAdelantoStr = `${formatearPesos(montoNum)} (${numeroALetrasPesos(montoNum)})`

    drawWrappedText(`Bogota, ${fechaGenStr}`, { size: 12 })
    spacer(18)
    drawWrappedText("Sres.", { size: 12 })
    drawWrappedText("LIP PROGRESSIVE INTEGRAL LOGISTICS S.A.S", {
      size: 12,
      bold: true,
    })
    drawWrappedText("Dpto. Gestion Humana", { size: 12 })
    spacer(20)
    drawWrappedText("AUTORIZACION DE DESCUENTO ANTICIPO DE NOMINA", {
      size: 13,
      bold: true,
      align: "center",
    })
    spacer(18)

    const cuotasLabel = cuotasInt === 1 ? "cuota" : "cuotas"
    const cuerpo =
      `Yo ${nombreEmpleado}, Identificado(a) como aparece al pie de mi firma, ` +
      `autorizo a ustedes para que, de mi salario, bonificaciones, ` +
      `prestaciones u otros emolumentos a que tenga derecho aun en el evento ` +
      `de encontrarme en vacaciones, sea descontado el valor ${valorAdelantoStr} ` +
      `de ${cuotasInt} ${cuotasLabel} quincenal(es) del valor en el cual soy deudor.`
    drawWrappedText(cuerpo, { size: 12 })
    spacer(10)

    drawWrappedText(
      "Igualmente autorizo me sea descontado el saldo de mi salario, " +
        "bonificaciones, prestaciones u otros emolumentos a que tenga derecho " +
        "que pudiera quedar pendiente en caso de culminacion del vinculo laboral.",
      { size: 12 },
    )
    spacer(10)
    drawWrappedText(
      "Lo anterior, doy constancia a la autorizacion con la firma al pie de este documento.",
      { size: 12 },
    )
    spacer(20)
    drawWrappedText("Atentamente,", { size: 12 })
    spacer(20)

    // Embeber la firma. Calculamos un alto fijo (~70pt) y dejamos el
    // ancho proporcional para no deformar la imagen, con un tope de
    // ancho del area de contenido por si la firma es muy panoramica.
    const firmaImg =
      firmaMime === "png"
        ? await pdfDoc.embedPng(firmaBytes)
        : await pdfDoc.embedJpg(firmaBytes)
    const targetHeight = 70
    const aspect = firmaImg.width / firmaImg.height
    let firmaH = targetHeight
    let firmaW = targetHeight * aspect
    if (firmaW > contentWidth * 0.6) {
      firmaW = contentWidth * 0.6
      firmaH = firmaW / aspect
    }
    page.drawImage(firmaImg, {
      x: margin,
      y: cursorY - firmaH,
      width: firmaW,
      height: firmaH,
    })
    cursorY -= firmaH + 6

    // Linea + datos al pie de la firma
    page.drawLine({
      start: { x: margin, y: cursorY },
      end: { x: margin + 240, y: cursorY },
      thickness: 1,
      color: rgb(0, 0, 0),
    })
    cursorY -= 16
    drawWrappedText(nombreEmpleado, { size: 11, bold: true })
    if (cedulaEmpleado) {
      drawWrappedText(`C.C. ${cedulaEmpleado}`, { size: 10 })
    }

    const pdfBytes = await pdfDoc.save()
    const buffer = Buffer.from(pdfBytes)

    // 5) Guardar el PDF generado. Originalmente apuntabamos al bucket
    //    `anticipos` pero ese bucket no existe en la instancia de
    //    Supabase del cliente y el upload responde HTTP 400
    //    ("Bucket not found"), por eso al presionar "Generar
    //    documento" la action fallaba sin que el usuario lo notara.
    //    Reutilizamos el bucket `firmas` (que ya esta creado y se
    //    usa para almacenar la firma cruda) bajo el prefijo
    //    `autorizaciones/<anio>/<mes>/...` para mantener el
    //    documento generado separado de las firmas individuales.
    const safeName = nombreEmpleado
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")

    const fechaRef = solicitud.fecha_solicitud
      ? new Date(solicitud.fecha_solicitud as any)
      : new Date()
    const mesesEs = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ]
    const anio = fechaRef.getFullYear()
    const mes = mesesEs[fechaRef.getMonth()]
    const idSuffix = String(solicitudId).slice(0, 8)
    const storagePath = `autorizaciones/${anio}/${mes}/${safeName || "empleado"}_${idSuffix}.pdf`

    const { error: upErr } = await storageAdmin.storage
      .from("firmas")
      .upload(storagePath, buffer, {
        cacheControl: "3600",
        contentType: "application/pdf",
        upsert: true,
      })
    if (upErr) {
      return {
        success: false,
        error: `Error al subir documento: ${upErr.message}`,
      }
    }

    const { data: urlData } = storageAdmin.storage
      .from("firmas")
      .getPublicUrl(storagePath)
    const publicUrl = urlData?.publicUrl
    if (!publicUrl) {
      return { success: false, error: "No se pudo obtener la URL publica" }
    }

    // 6) Persistir url_soporte (no cambiamos `estado`)
    const { error: updErr } = await supabase
      .from("solicitudes_trabajadores")
      .update({ url_soporte: publicUrl })
      .eq("id", solicitudId)
    if (updErr) {
      return {
        success: false,
        error: `Error al actualizar solicitud: ${updErr.message}`,
      }
    }

    return { success: true, publicUrl }
  } catch (err: any) {
    console.log("[v0] subirEvidenciaAnticipo error:", err?.message)
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Lista los anticipos de un colaborador (orden descendente por fecha).
 */
export async function getAnticiposPorColaborador(
  colaboradorId: number,
): Promise<{ success: boolean; data: SolicitudTrabajador[]; error?: string }> {
  try {
    const { supabase, map } = await buildHeadcountMapForColaborador(colaboradorId)
    const { data, error } = await supabase
      .from("solicitudes_trabajadores")
      .select(
        "id, colaborador_id, tipo, estado, created_at:fecha_solicitud, monto, motivo_rechazo, soporte_url:url_soporte, url_documento_final, fecha_inicio_permiso, fecha_fin_permiso, tipo_permiso, comentarios, permiso_aprobacion_gh, permiso_aprobacion_coord",
      )
      .eq("colaborador_id", colaboradorId)
      .eq("tipo", "anticipo")
      .order("fecha_solicitud", { ascending: false })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: normalizeRows(data || [], map) }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Lista los permisos de un colaborador (orden descendente por fecha).
 */
export async function getPermisosPorColaborador(
  colaboradorId: number,
): Promise<{ success: boolean; data: SolicitudTrabajador[]; error?: string }> {
  try {
    const { supabase, map } = await buildHeadcountMapForColaborador(colaboradorId)
    const { data, error } = await supabase
      .from("solicitudes_trabajadores")
      .select(
        "id, colaborador_id, tipo, estado, created_at:fecha_solicitud, monto, motivo_rechazo, soporte_url:url_soporte, url_documento_final, fecha_inicio_permiso, fecha_fin_permiso, tipo_permiso, comentarios, permiso_aprobacion_gh, permiso_aprobacion_coord",
      )
      .eq("colaborador_id", colaboradorId)
      .eq("tipo", "permiso")
      .order("fecha_solicitud", { ascending: false })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: normalizeRows(data || [], map) }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}
