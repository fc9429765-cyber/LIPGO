"use server"

// Repositorio central de soportes documentales. Sube al bucket "archivos" y
// registra el archivo en soportes_documentales (append-only: conserva el historial).

import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import type { SoporteRow, SoporteMeta } from "@/lib/soportes-types"
import { motivoSinAccion } from "@/lib/puerta-modulo"

async function resolveEmpresaId(fromClient?: number | null): Promise<number | null> {
  if (fromClient && !Number.isNaN(fromClient)) return fromClient
  return await getCurrentEmpresaIdForInsert()
}
const safe = (s: string) => (s || "").replace(/[^a-zA-Z0-9._-]/g, "_")

/**
 * Quita de un listado los soportes retirados.
 *
 * Se filtra en memoria y no con un `.eq("eliminado", false)` a proposito: si la
 * columna todavia no existe --el script 55 no se ha corrido-- un filtro en la
 * consulta la haria fallar entera y el modulo se quedaria sin soportes. Asi, lo
 * peor que pasa es que sigan viendose todos, que es como funcionaba antes.
 */
function sinEliminados(data: unknown): SoporteRow[] {
  return ((data ?? []) as SoporteRow[]).filter((r) => (r as any).eliminado !== true)
}

// Lista el historial de soportes de una referencia (último primero).
export async function listSoportes(
  referenciaTipo: string,
  referenciaId: string,
  empresaIdFromClient?: number | null,
): Promise<SoporteRow[]> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []
  const { data, error } = await supabase
    .from("soportes_documentales")
    .select("*")
    // SST transversal (LIP): no se filtra por el ID del cliente.
    .eq("referencia_tipo", referenciaTipo)
    .eq("referencia_id", referenciaId)
    .order("created_at", { ascending: false })
  if (error) {
    console.error("[v0] listSoportes:", error.message)
    return []
  }
  return sinEliminados(data)
}

// Lista todos los soportes de un módulo (para el repositorio/auditoría).
export async function listSoportesByModulo(
  modulo: string,
  empresaIdFromClient?: number | null,
): Promise<SoporteRow[]> {
  const supabase = await createClient()
  const empresaId = await resolveEmpresaId(empresaIdFromClient)
  if (!empresaId) return []
  const { data, error } = await supabase
    .from("soportes_documentales")
    .select("*")
    // SST transversal (LIP): no se filtra por el ID del cliente.
    .eq("modulo", modulo)
    .order("created_at", { ascending: false })
  if (error) {
    console.error("[v0] listSoportesByModulo:", error.message)
    return []
  }
  return sinEliminados(data)
}

// Sube el archivo y lo registra. Marca los anteriores de la misma referencia
// como histórico (vigente=false) y deja el nuevo como vigente.
export async function subirYRegistrarSoporte(
  file: File,
  meta: SoporteMeta,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; url?: string; id?: number; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Repositorio de Soportes", "Matriz de Estándares", "Auditoría 0312", "IPEVR", "Plan de Mejoramiento", "Investigación AT", "Investigaciones Realizadas", "Cargos Fijos", "Matriz Integrada SIG", "Repositorio por Norma SIG"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    if (!empresaId) return { success: false, message: "No se pudo resolver la empresa." }

    const supabaseAdmin = await getSupabaseAdmin()
    const ext = file.name.split(".").pop() || "bin"
    const fileName = `${safe(meta.referenciaTipo)}_${safe(meta.referenciaId)}_${Date.now()}.${ext}`
    const filePath = `soportes/${safe(meta.modulo)}/${fileName}`
    const up = await supabaseAdmin.storage
      .from("archivos")
      .upload(filePath, file, { contentType: file.type || undefined, upsert: true })
    if (up.error) {
      console.error("[v0] subirYRegistrarSoporte upload:", up.error.message)
      return { success: false, message: up.error.message }
    }
    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
    const url = urlData.publicUrl

    const supabase = await createClient()
    await supabase
      .from("soportes_documentales")
      .update({ vigente: false })
      // SST transversal (LIP): la vigencia se maneja a nivel LIP, no por cliente.
      .eq("referencia_tipo", meta.referenciaTipo)
      .eq("referencia_id", meta.referenciaId)

    const ins = await supabase
      .from("soportes_documentales")
      .insert([
        {
          idempresa: empresaId,
          norma: meta.norma,
          modulo: meta.modulo,
          referencia_tipo: meta.referenciaTipo,
          referencia_id: meta.referenciaId,
          referencia_desc: meta.referenciaDesc ?? null,
          archivo_url: url,
          archivo_nombre: file.name,
          tipo_archivo: file.type || ext,
          tamano: file.size,
          subido_por: meta.subidoPor ?? null,
          observacion: meta.observacion ?? null,
          vigente: true,
        },
      ])
      .select("id")
      .single()
    if (ins.error) {
      console.error("[v0] subirYRegistrarSoporte insert:", ins.error.message)
      return { success: false, message: ins.error.message }
    }
    return { success: true, url, id: (ins.data as any)?.id }
  } catch (e: any) {
    console.error("[v0] subirYRegistrarSoporte:", e?.message ?? e)
    return { success: false, message: e?.message ?? "Error inesperado al subir el soporte." }
  }
}

/*
 * REGISTRA UN ARCHIVO QUE EL NAVEGADOR YA SUBIÓ A STORAGE.
 *
 * `subirYRegistrarSoporte` manda el archivo entero a través del Server
 * Action, y ahí el tope no lo pone LIPgo: lo pone la plataforma. Vercel corta
 * el cuerpo de la petición mucho antes de los 50 MB que declara
 * `next.config.mjs`, y el usuario ve un fallo sin explicación con un escaneo
 * grande -- justo lo que pasa en Investigación de AT, donde los soportes son
 * expedientes escaneados.
 *
 * Con la subida directa el archivo va del navegador a Supabase Storage sin
 * pasar por Vercel, así que el límite deja de existir: solo queda el del
 * bucket. Por aquí llega únicamente la URL y los datos del archivo, que son
 * unos cientos de bytes.
 *
 * `storagePath` es la ruta real dentro del bucket: se guarda para poder
 * borrar el archivo si el registro falla, y así no dejar huérfanos.
 */
export async function registrarSoporteSubido(
  datos: {
    storagePath: string
    url: string
    nombre: string
    tipo: string
    tamano: number
  },
  meta: SoporteMeta,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; url?: string; id?: number; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Repositorio de Soportes", "Matriz de Estándares", "Auditoría 0312", "IPEVR", "Plan de Mejoramiento", "Investigación AT", "Investigaciones Realizadas", "Cargos Fijos", "Matriz Integrada SIG", "Repositorio por Norma SIG"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    if (!empresaId) return { success: false, message: "No se pudo resolver la empresa." }

    /*
     * La ruta se comprueba antes de registrarla. Sin esto, cualquiera podría
     * llamar a esta acción con una URL arbitraria y dejarla guardada como si
     * fuera un soporte: el archivo no estaría en nuestro bucket y el registro
     * apuntaría a cualquier parte.
     */
    if (!datos.storagePath.startsWith("soportes/")) {
      return { success: false, message: "Ruta de archivo no válida." }
    }

    const supabase = await createClient()
    await supabase
      .from("soportes_documentales")
      .update({ vigente: false })
      // SST transversal (LIP): la vigencia se maneja a nivel LIP, no por cliente.
      .eq("referencia_tipo", meta.referenciaTipo)
      .eq("referencia_id", meta.referenciaId)

    const ins = await supabase
      .from("soportes_documentales")
      .insert([
        {
          idempresa: empresaId,
          norma: meta.norma,
          modulo: meta.modulo,
          referencia_tipo: meta.referenciaTipo,
          referencia_id: meta.referenciaId,
          referencia_desc: meta.referenciaDesc ?? null,
          archivo_url: datos.url,
          archivo_nombre: datos.nombre,
          tipo_archivo: datos.tipo || datos.nombre.split(".").pop() || "bin",
          tamano: datos.tamano,
          subido_por: meta.subidoPor ?? null,
          observacion: meta.observacion ?? null,
          vigente: true,
        },
      ])
      .select("id")
      .single()

    if (ins.error) {
      console.error("[v0] registrarSoporteSubido insert:", ins.error.message)
      /*
       * El archivo ya está en Storage pero el registro falló: se retira, o
       * quedaría ocupando espacio sin que ninguna pantalla pueda mostrarlo ni
       * nadie sepa que existe.
       */
      try {
        const admin = await getSupabaseAdmin()
        await admin.storage.from("archivos").remove([datos.storagePath])
      } catch (e: any) {
        console.error("[v0] registrarSoporteSubido limpieza:", e?.message ?? e)
      }
      return { success: false, message: ins.error.message }
    }

    return { success: true, url: datos.url, id: (ins.data as any)?.id }
  } catch (e: any) {
    console.error("[v0] registrarSoporteSubido:", e?.message ?? e)
    return { success: false, message: e?.message ?? "Error inesperado al registrar el soporte." }
  }
}

// Marca un soporte como histórico (no borra el archivo; conserva la trazabilidad).
export async function anularSoporte(id: number): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Repositorio de Soportes"], "anular")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const { error } = await supabase.from("soportes_documentales").update({ vigente: false }).eq("id", id)
  return error ? { success: false, message: error.message } : { success: true }
}

/**
 * Quita un soporte del repositorio: el que se subio por error, o al estandar
 * equivocado.
 *
 * NO es lo mismo que `anularSoporte`. Marcar `vigente = false` significa "esto
 * valio y fue reemplazado", y el archivo se sigue mostrando como evidencia
 * historica en el Repositorio de Soportes y en el Repositorio Universal. Un
 * archivo subido por error no es un historico: no debe figurar en ninguna de
 * las dos vistas.
 *
 * Tampoco borra la fila ni el archivo del bucket. Esto es evidencia de un
 * SG-SST que se audita: un hueco sin explicacion es peor que un registro
 * retirado con su motivo. Por eso el motivo es OBLIGATORIO --dentro de un anio
 * nadie se acuerda de si fue un error o una maniobra-- y por eso la eliminacion
 * se puede deshacer (ver scripts/sig/55_soportes_eliminados.sql).
 *
 * Si el retirado era el vigente, el ultimo que quede vivo vuelve a ser vigente:
 * de lo contrario la referencia quedaria con historicos y sin version valida.
 */
export async function eliminarSoporte(
  id: number,
  motivo: string,
): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Repositorio de Soportes", "Matriz de Estándares", "Auditoría 0312", "IPEVR", "Plan de Mejoramiento", "Investigación AT", "Investigaciones Realizadas", "Matriz Integrada SIG", "Repositorio por Norma SIG"], "editar", "Quitar soporte")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!id) return { success: false, message: "No se indicó qué soporte quitar." }
  if (!motivo || !motivo.trim()) {
    return { success: false, message: "Indica por qué se quita el soporte." }
  }

  const supabase = await createClient()

  const { data: soporte, error: eLeer } = await supabase
    .from("soportes_documentales")
    .select("id, referencia_tipo, referencia_id, vigente, archivo_nombre")
    .eq("id", id)
    .maybeSingle()
  if (eLeer) {
    console.error("[v0] eliminarSoporte lectura:", eLeer.message)
    return { success: false, message: eLeer.message }
  }
  if (!soporte) return { success: false, message: "Ese soporte ya no existe." }

  const { error } = await supabase
    .from("soportes_documentales")
    .update({
      eliminado: true,
      eliminado_en: new Date().toISOString(),
      eliminado_motivo: motivo.trim(),
      // Deja de ser la version valida en cualquier caso: un archivo retirado no
      // puede seguir siendo el vigente de su referencia.
      vigente: false,
    })
    .eq("id", id)

  if (error) {
    console.error("[v0] eliminarSoporte:", error.message)
    // Mensaje util en vez del error crudo de Postgres cuando falta la migracion.
    if ((error.message || "").toLowerCase().includes("eliminado")) {
      return {
        success: false,
        message:
          "Falta correr scripts/sig/55_soportes_eliminados.sql en la base para poder quitar soportes.",
      }
    }
    return { success: false, message: error.message }
  }

  // Si el que se fue era el vigente, asciende el mas reciente que siga vivo.
  if ((soporte as any).vigente) {
    const { data: quedan } = await supabase
      .from("soportes_documentales")
      .select("id, eliminado")
      .eq("referencia_tipo", (soporte as any).referencia_tipo)
      .eq("referencia_id", (soporte as any).referencia_id)
      .order("created_at", { ascending: false })

    const sucesor = ((quedan ?? []) as any[]).find((r) => r.id !== id && r.eliminado !== true)
    if (sucesor) {
      await supabase.from("soportes_documentales").update({ vigente: true }).eq("id", sucesor.id)
    }
  }

  return { success: true }
}
