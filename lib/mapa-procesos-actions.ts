"use server"

// Documentos del Mapa de Procesos.
//
// Escriben en `sig_documentos`, el MISMO maestro que alimenta el Listado
// Maestro de Documentos del Dashboard SIG. No hay tabla aparte a propósito: con
// dos listados, la pregunta de auditoría "¿cuáles son los documentos del SGI?"
// tendría dos respuestas que con el tiempo se contradicen.
//
// El archivo va al bucket "archivos", el mismo de `soportes_documentales`.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { SIG_EMPRESA_LIP } from "@/lib/sig-types"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { puedeAbrirProceso } from "@/lib/permisos-mapa-actions"
// Los tipos y constantes viven en su propio archivo: este es `"use server"` y
// aqui SOLO se pueden exportar funciones async.
import {
  MAX_MB_DOCUMENTO,
  type CategoriaDoc,
  type DocumentoProceso,
  type GuardarDocumentoInput,
} from "@/lib/mapa-procesos-tipos"
import { motivoSinAccion } from "@/lib/puerta-modulo"

interface Resultado<T = undefined> {
  success: boolean
  data?: T
  message?: string
}

const MSG_FALTA_MIGRACION =
  "Falta correr scripts/sig/58_mapa_procesos_documentos.sql en la base para poder cargar documentos desde el mapa."

/** Distingue "falta la migración" del resto de errores, para no mostrar el crudo. */
function faltaMigracion(msg: string | undefined): boolean {
  const t = String(msg ?? "").toLowerCase()
  return (
    t.includes("categoria") ||
    t.includes("proceso_id") ||
    t.includes("archivo_url") ||
    t.includes("does not exist") ||
    t.includes("schema cache")
  )
}

function filaADocumento(r: any): DocumentoProceso {
  return {
    id: String(r.id),
    codigo: r.codigo ?? "",
    nombre: r.nombre ?? "",
    version: r.version ?? "",
    categoria: (r.categoria ?? null) as CategoriaDoc | null,
    procesoId: r.proceso_id ?? null,
    archivoUrl: r.archivo_url ?? null,
    archivoNombre: r.archivo_nombre ?? null,
    estado: r.estado ?? null,
    subidoPor: r.subido_por ?? null,
    actualizadoAt: r.actualizado_at ?? null,
  }
}

/**
 * Documentos de UN proceso, de las tres categorías.
 *
 * Los devuelve todos juntos y la pantalla los reparte por pestaña: son pocos
 * por proceso, y así cambiar de pestaña no dispara otra consulta.
 */
export async function getDocumentosDeProceso(
  procesoId: string,
): Promise<Resultado<DocumentoProceso[]>> {
  if (!procesoId) return { success: false, message: "No se indicó el proceso." }

  // Esta es la comprobación que cuenta. Que el botón del mapa no abra es
  // comodidad para quien mira la pantalla, pero un server action es un
  // endpoint: se puede llamar sin pasar por el botón. Sin esto, el permiso por
  // proceso sería decorativo.
  if (!(await puedeAbrirProceso(procesoId))) {
    return { success: false, message: "No tienes permiso para ver los documentos de este proceso." }
  }

  try {
    const admin: any = await getSupabaseAdmin()
    const { data, error } = await admin
      .from("sig_documentos")
      .select(
        "id, codigo, nombre, version, tipo, proceso, categoria, proceso_id, archivo_url, archivo_nombre, estado, subido_por, actualizado_at, eliminado",
      )
      .eq("proceso_id", procesoId)
      .order("categoria", { ascending: true })
      .order("codigo", { ascending: true })

    if (error) {
      console.error("[v0] getDocumentosDeProceso:", error.message)
      return { success: false, message: faltaMigracion(error.message) ? MSG_FALTA_MIGRACION : error.message }
    }

    // Los retirados se filtran acá y no en el select: si la columna todavía no
    // existe --falta la migración-- un filtro en la consulta la haría fallar
    // entera en vez de devolver la lista.
    const vivos = (data ?? []).filter((r: any) => r.eliminado !== true)
    return { success: true, data: vivos.map(filaADocumento) }
  } catch (e: any) {
    console.error("[v0] getDocumentosDeProceso excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron leer los documentos." }
  }
}

/** Cuántos documentos tiene cada proceso, para mostrarlo en el mapa. */
export async function getConteoDocumentosPorProceso(): Promise<Resultado<Record<string, number>>> {
  try {
    const admin: any = await getSupabaseAdmin()
    const { data, error } = await admin
      .from("sig_documentos")
      .select("proceso_id, eliminado")
      .not("proceso_id", "is", null)

    if (error) {
      // Sin migración no hay conteo, pero el mapa debe seguir viéndose: se
      // devuelve vacío en vez de un error que rompa la pantalla entera.
      console.error("[v0] getConteoDocumentosPorProceso:", error.message)
      return { success: true, data: {} }
    }

    const out: Record<string, number> = {}
    for (const r of data ?? []) {
      if (r.eliminado === true) continue
      const k = String(r.proceso_id)
      out[k] = (out[k] ?? 0) + 1
    }
    return { success: true, data: out }
  } catch {
    return { success: true, data: {} }
  }
}

/** Nombre de archivo seguro para el bucket. Mismo criterio que soportes-actions. */
const safe = (s: string) => (s || "").replace(/[^a-zA-Z0-9._-]/g, "_")

/**
 * Sube el adjunto de un documento y devuelve su URL.
 *
 * Va al bucket "archivos", el mismo de `soportes_documentales`, bajo su propia
 * carpeta para que se pueda distinguir de un vistazo qué subió el mapa.
 */
export async function subirArchivoDocumento(
  file: File,
  procesoId: string,
  categoria: CategoriaDoc,
): Promise<Resultado<{ url: string; nombre: string }>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Mapa de Procesos"], "crear", "Subir documento")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!file) return { success: false, message: "No se seleccionó ningún archivo." }
  // Escribir en un proceso exige el mismo permiso que leerlo: sin esto, quien
  // no puede abrir la ficha podría igual subirle o cambiarle documentos.
  if (!(await puedeAbrirProceso(procesoId))) {
    return { success: false, message: "No tienes permiso para modificar este proceso." }
  }

  if (file.size > MAX_MB_DOCUMENTO * 1024 * 1024) {
    return {
      success: false,
      message: `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo son ${MAX_MB_DOCUMENTO} MB.`,
    }
  }

  try {
    const admin: any = await getSupabaseAdmin()
    const ext = file.name.split(".").pop() || "bin"
    const ruta = `sig/mapa-procesos/${safe(procesoId)}/${safe(categoria)}_${Date.now()}.${ext}`

    const up = await admin.storage
      .from("archivos")
      .upload(ruta, file, { contentType: file.type || undefined, upsert: true })
    if (up.error) {
      console.error("[v0] subirArchivoDocumento:", up.error.message)
      return { success: false, message: up.error.message }
    }

    const { data } = admin.storage.from("archivos").getPublicUrl(ruta)
    return { success: true, data: { url: data.publicUrl, nombre: file.name } }
  } catch (e: any) {
    console.error("[v0] subirArchivoDocumento excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo subir el archivo." }
  }
}


/**
 * Crea o actualiza un documento del proceso.
 *
 * Esta es la PRIMERA pantalla del sistema que escribe en `sig_documentos`: hasta
 * ahora el maestro solo se leía. Por eso se validan los campos acá y no se
 * confía en que la tabla los rechace.
 */
export async function guardarDocumentoProceso(
  input: GuardarDocumentoInput,
): Promise<Resultado<DocumentoProceso>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Mapa de Procesos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const codigo = String(input?.codigo ?? "").trim()
  const nombre = String(input?.nombre ?? "").trim()
  const version = String(input?.version ?? "").trim()

  if (!input?.procesoId) return { success: false, message: "No se indicó el proceso." }
  // Escribir en un proceso exige el mismo permiso que leerlo: sin esto, quien
  // no puede abrir la ficha podría igual subirle o cambiarle documentos.
  if (!(await puedeAbrirProceso(input.procesoId))) {
    return { success: false, message: "No tienes permiso para modificar este proceso." }
  }

  if (!input?.categoria) return { success: false, message: "Indica si es formato, información documentada o registro." }
  if (!codigo) return { success: false, message: "El código del documento es obligatorio." }
  if (!nombre) return { success: false, message: "El nombre del documento es obligatorio." }
  if (!version) return { success: false, message: "La versión es obligatoria." }

  try {
    const admin: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)

    const payload: Record<string, unknown> = {
      codigo,
      nombre,
      version,
      categoria: input.categoria,
      proceso_id: input.procesoId,
      actualizado_at: new Date().toISOString(),
    }
    // El adjunto solo se toca si viene: al editar solo el nombre o la versión,
    // omitirlo dejaría el documento sin archivo.
    if (input.archivoUrl !== undefined) payload.archivo_url = input.archivoUrl
    if (input.archivoNombre !== undefined) payload.archivo_nombre = input.archivoNombre
    if (usuario) payload.subido_por = usuario

    const q = input.id
      ? admin.from("sig_documentos").update(payload).eq("id", input.id).select("*").single()
      : admin.from("sig_documentos").insert(payload).select("*").single()

    const { data, error } = await q
    if (error) {
      console.error("[v0] guardarDocumentoProceso:", error.message)
      return { success: false, message: faltaMigracion(error.message) ? MSG_FALTA_MIGRACION : error.message }
    }
    return { success: true, data: filaADocumento(data) }
  } catch (e: any) {
    console.error("[v0] guardarDocumentoProceso excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo guardar el documento." }
  }
}

/* =========================================================================
 * ENLACE CON LA MATRIZ INTEGRADA
 *
 * Un documento del mapa se asocia a uno o varios numerales de la norma. El
 * enlace NO se inventa aquí: se reutiliza `sig_documento_cobertura`, que es la
 * misma tabla que ya usa la Matriz Integrada para saber qué documento cubre
 * cada requisito.
 *
 * Por eso la conexión funciona en los dos sentidos sin trabajo extra: al
 * vincular desde el mapa, la Matriz Integrada muestra ese documento en la celda
 * del numeral, porque lee la misma fila.
 * ========================================================================= */

export interface NumeralVinculado {
  /** id de la fila de cobertura, para poder desvincular. */
  coberturaId: number
  requisitoId: number
  normaId: number
  numeral: string
  normaCodigo: string
  tituloRequisito: string | null
}

/** A qué numerales de la matriz está asociado un documento. */
export async function getNumeralesDeDocumento(
  documentoId: string,
): Promise<Resultado<NumeralVinculado[]>> {
  if (!documentoId) return { success: false, message: "No se indicó el documento." }
  try {
    const admin: any = await getSupabaseAdmin()
    // La referencia al documento viaja en `observacion` con prefijo "doc:".
    // Es la convención que ya usa vincularDocumentoAObjetivos en sig-actions.
    const ref = `doc:${documentoId}`

    const [covRes, reqRes, normRes] = await Promise.all([
      admin
        .from("sig_documento_cobertura")
        .select("id, requisito_id, norma_id")
        .eq("idempresa", SIG_EMPRESA_LIP)
        .eq("observacion", ref),
      admin.from("sig_requisitos").select("id, numeral, tema"),
      admin.from("sig_normas").select("id, codigo"),
    ])

    if (covRes.error) {
      console.error("[v0] getNumeralesDeDocumento:", covRes.error.message)
      return { success: false, message: covRes.error.message }
    }

    const reqMap = new Map<number, { numeral: string; tema: string | null }>(
      (reqRes.data ?? []).map((r: any) => [r.id, { numeral: r.numeral, tema: r.tema ?? null }]),
    )
    const normMap = new Map<number, string>((normRes.data ?? []).map((n: any) => [n.id, n.codigo]))

    const out: NumeralVinculado[] = (covRes.data ?? []).map((c: any) => {
      const r = reqMap.get(c.requisito_id)
      return {
        coberturaId: Number(c.id),
        requisitoId: Number(c.requisito_id),
        normaId: Number(c.norma_id),
        numeral: r?.numeral ?? String(c.requisito_id),
        normaCodigo: normMap.get(c.norma_id) ?? "",
        tituloRequisito: r?.tema ?? null,
      }
    })

    // Por numeral y luego por norma: así el mismo requisito de tres normas
    // queda junto en la lista.
    out.sort((a, b) => a.numeral.localeCompare(b.numeral, "es", { numeric: true }) || a.normaCodigo.localeCompare(b.normaCodigo))
    return { success: true, data: out }
  } catch (e: any) {
    console.error("[v0] getNumeralesDeDocumento excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron leer los numerales." }
  }
}

export interface OpcionNumeral {
  requisitoId: number
  normaId: number
  numeral: string
  normaCodigo: string
  titulo: string | null
}

/**
 * Numerales disponibles para asociar: los que APLICAN en cada norma.
 *
 * Se ofrece el par (requisito, norma) y no solo el numeral porque un mismo
 * requisito puede aplicar en las tres normas y el documento puede cubrir una,
 * dos o las tres. Es la misma unidad con la que trabaja la Matriz Integrada.
 */
export async function getNumeralesDisponibles(): Promise<Resultado<OpcionNumeral[]>> {
  try {
    const admin: any = await getSupabaseAdmin()
    const [reqRes, normRes, rnRes] = await Promise.all([
      admin.from("sig_requisitos").select("id, numeral, tema"),
      admin.from("sig_normas").select("id, codigo"),
      admin.from("sig_requisito_norma").select("requisito_id, norma_id, aplica"),
    ])

    if (reqRes.error || normRes.error || rnRes.error) {
      const msg = (reqRes.error || normRes.error || rnRes.error)?.message
      console.error("[v0] getNumeralesDisponibles:", msg)
      return { success: false, message: msg }
    }

    const reqMap = new Map<number, { numeral: string; tema: string | null }>(
      (reqRes.data ?? []).map((r: any) => [r.id, { numeral: r.numeral, tema: r.tema ?? null }]),
    )
    const normMap = new Map<number, string>((normRes.data ?? []).map((n: any) => [n.id, n.codigo]))

    const out: OpcionNumeral[] = []
    for (const rn of rnRes.data ?? []) {
      if (rn.aplica === false) continue
      const r = reqMap.get(rn.requisito_id)
      if (!r) continue
      out.push({
        requisitoId: Number(rn.requisito_id),
        normaId: Number(rn.norma_id),
        numeral: r.numeral,
        normaCodigo: normMap.get(rn.norma_id) ?? "",
        titulo: r.tema,
      })
    }

    out.sort((a, b) => a.numeral.localeCompare(b.numeral, "es", { numeric: true }) || a.normaCodigo.localeCompare(b.normaCodigo))
    return { success: true, data: out }
  } catch (e: any) {
    console.error("[v0] getNumeralesDisponibles excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron leer los numerales." }
  }
}

/** Quita la asociación entre un documento y un numeral. */
export async function desvincularNumeral(coberturaId: number): Promise<Resultado> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Mapa de Procesos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!coberturaId) return { success: false, message: "No se indicó qué asociación quitar." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin.from("sig_documento_cobertura").delete().eq("id", coberturaId)
    if (error) {
      console.error("[v0] desvincularNumeral:", error.message)
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo quitar la asociación." }
  }
}

/**
 * Retira un documento del listado. NO lo borra.
 *
 * Mismo criterio que los soportes documentales: esto es información documentada
 * de un sistema que se audita, y un documento que desaparece sin explicación es
 * peor que uno retirado con su motivo escrito.
 */
/* =========================================================================
 * DOCUMENTOS SIN CLASIFICAR
 *
 * El script 58 agregó `proceso_id` y `categoria` a `sig_documentos`, pero
 * DELIBERADAMENTE dejó en null los documentos que ya existían: adivinar a qué
 * proceso pertenece cada uno por coincidencia de texto sería inventar
 * clasificación documental, y en una auditoría eso no se sostiene.
 *
 * La consecuencia es que hoy esos documentos no aparecen en ningún proceso del
 * mapa. Siguen visibles en el Listado Maestro --no se perdió nada-- pero el
 * mapa se ve vacío aunque el SGI tenga documentos. Esto permite asignarlos
 * desde la pantalla, que es donde una persona puede decidirlo.
 * ========================================================================= */

export interface DocumentoSinClasificar {
  id: string
  codigo: string
  nombre: string
  version: string
  tipo: string | null
  /** El campo `proceso` de texto libre que ya traía el documento. Es la mejor
   *  pista para saber a qué proceso del mapa pertenece, pero NO se usa para
   *  asignar automáticamente: solo se muestra como ayuda. */
  procesoTexto: string | null
}

/** Documentos que todavía no están asignados a ningún proceso del mapa. */
export async function getDocumentosSinClasificar(): Promise<Resultado<DocumentoSinClasificar[]>> {
  try {
    const admin: any = await getSupabaseAdmin()
    const { data, error } = await admin
      .from("sig_documentos")
      .select("id, codigo, nombre, version, tipo, proceso, proceso_id, eliminado")
      // En Postgres NULL <> NULL: .eq("proceso_id", null) NO encontraría nada.
      // Tiene que ser .is(), que es justo el caso mayoritario acá.
      .is("proceso_id", null)
      .order("codigo", { ascending: true })

    if (error) {
      console.error("[v0] getDocumentosSinClasificar:", error.message)
      return { success: false, message: faltaMigracion(error.message) ? MSG_FALTA_MIGRACION : error.message }
    }

    const vivos = (data ?? []).filter((r: any) => r.eliminado !== true)
    return {
      success: true,
      data: vivos.map((r: any) => ({
        id: String(r.id),
        codigo: r.codigo ?? "",
        nombre: r.nombre ?? "",
        version: r.version ?? "",
        tipo: r.tipo ?? null,
        procesoTexto: r.proceso ?? null,
      })),
    }
  } catch (e: any) {
    console.error("[v0] getDocumentosSinClasificar excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron leer los documentos." }
  }
}

/**
 * Asigna documentos existentes a un proceso del mapa y a una de las tres
 * listas. No los mueve ni los copia: solo los clasifica, así que siguen siendo
 * los mismos documentos del Listado Maestro.
 */
export async function clasificarDocumentos(
  documentoIds: string[],
  procesoId: string,
  categoria: CategoriaDoc,
): Promise<Resultado<number>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Mapa de Procesos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!documentoIds?.length) return { success: false, message: "No se seleccionó ningún documento." }
  if (!procesoId) return { success: false, message: "No se indicó el proceso." }
  // Escribir en un proceso exige el mismo permiso que leerlo: sin esto, quien
  // no puede abrir la ficha podría igual subirle o cambiarle documentos.
  if (!(await puedeAbrirProceso(procesoId))) {
    return { success: false, message: "No tienes permiso para modificar este proceso." }
  }
  if (!["formato", "informacion", "registro"].includes(categoria)) {
    return { success: false, message: "Categoría no válida." }
  }
  try {
    const admin: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert()
    const { error } = await admin
      .from("sig_documentos")
      .update({
        proceso_id: procesoId,
        categoria,
        subido_por: usuario,
        actualizado_at: new Date().toISOString(),
      })
      .in("id", documentoIds)

    if (error) {
      console.error("[v0] clasificarDocumentos:", error.message)
      return { success: false, message: faltaMigracion(error.message) ? MSG_FALTA_MIGRACION : error.message }
    }
    return { success: true, data: documentoIds.length }
  } catch (e: any) {
    console.error("[v0] clasificarDocumentos excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron clasificar los documentos." }
  }
}

/**
 * Saca un documento del mapa sin borrarlo: vuelve a quedar sin clasificar.
 *
 * Es distinto de eliminarDocumentoProceso, que lo retira del SGI con motivo.
 * Acá el documento sigue vivo y visible en el Listado Maestro; solo deja de
 * estar colgado de ese proceso.
 */
export async function desclasificarDocumento(documentoId: string): Promise<Resultado> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Mapa de Procesos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!documentoId) return { success: false, message: "No se indicó el documento." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin
      .from("sig_documentos")
      .update({ proceso_id: null, categoria: null, actualizado_at: new Date().toISOString() })
      .eq("id", documentoId)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo quitar del proceso." }
  }
}

export async function eliminarDocumentoProceso(
  id: string,
  motivo: string,
): Promise<Resultado> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Mapa de Procesos"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!id) return { success: false, message: "No se indicó qué documento quitar." }
  if (!motivo?.trim()) return { success: false, message: "Indica por qué se quita el documento." }

  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin
      .from("sig_documentos")
      .update({
        eliminado: true,
        eliminado_motivo: motivo.trim(),
        eliminado_en: new Date().toISOString(),
      })
      .eq("id", id)

    if (error) {
      console.error("[v0] eliminarDocumentoProceso:", error.message)
      return { success: false, message: faltaMigracion(error.message) ? MSG_FALTA_MIGRACION : error.message }
    }
    return { success: true }
  } catch (e: any) {
    console.error("[v0] eliminarDocumentoProceso excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo quitar el documento." }
  }
}
