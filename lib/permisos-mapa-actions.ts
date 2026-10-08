"use server"

// ---------------------------------------------------------------------------
// PERMISOS POR PROCESO DEL MAPA DE PROCESOS
//
// Quién puede abrir la ficha de cada proceso. Es una capa DENTRO del módulo:
// el permiso `sig_matriz` sigue decidiendo si se ve el mapa; esto decide, para
// quien ya lo ve, a qué procesos puede entrar.
//
// LA AUSENCIA DE FILA ES LA NEGACIÓN. No hay un booleano "puede/no puede": o
// existe la fila (usuario, proceso) o no hay acceso. Revocar es borrar, y no
// quedan filas en false que después haya que interpretar.
//
// LA COMPROBACIÓN QUE CUENTA ES LA DEL SERVIDOR. Que el botón no abra es
// comodidad para quien mira la pantalla; un server action es un endpoint y
// alguien puede llamarlo sin pasar por el botón. Por eso `puedeAbrirProceso`
// se usa dentro de las acciones que leen documentos, no solo en la UI.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"
import { exigirAdministradorUsuarios } from "@/lib/seguridad-servidor"

function faltaTabla(msg: string | undefined): boolean {
  const m = String(msg ?? "").toLowerCase()
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("relation")
}

/** El usuario de la sesión. null si no hay. */
async function usuarioActual(): Promise<string | null> {
  try {
    const u = await getCurrentUser()
    return u?.id ?? null
  } catch {
    return null
  }
}

/**
 * Procesos que el usuario de la sesión puede abrir.
 *
 * Devuelve `todos: true` cuando la tabla todavía no existe --el script 189 sin
 * correr--. Es deliberado: sin ese respaldo, desplegar esto antes del script
 * dejaría el mapa inservible para todo el mundo, sin ningún mensaje que diga
 * por qué. Se abre, no se cierra, porque el módulo ya está protegido por
 * `sig_matriz` y nadie gana acceso que no tuviera.
 */
export async function getMisProcesosPermitidos(): Promise<{
  success: boolean
  procesos: string[]
  todos: boolean
  message?: string
}> {
  try {
    const userId = await usuarioActual()
    if (!userId) return { success: true, procesos: [], todos: false }

    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("permisos_mapa_procesos")
      .select("proceso_id")
      .eq("usuario_id", userId)

    if (error) {
      if (faltaTabla(error.message)) return { success: true, procesos: [], todos: true }
      return { success: false, procesos: [], todos: false, message: error.message }
    }

    return {
      success: true,
      procesos: (data ?? []).map((r: any) => String(r.proceso_id)),
      todos: false,
    }
  } catch (e: any) {
    return { success: false, procesos: [], todos: false, message: e?.message }
  }
}

/**
 * ¿Puede el usuario de la sesión abrir este proceso?
 *
 * La usan los server actions que devuelven documentos. Sin esto, el control
 * sería solo visual: las acciones son endpoints y no preguntan quién llama.
 */
export async function puedeAbrirProceso(procesoId: string): Promise<boolean> {
  const r = await getMisProcesosPermitidos()
  if (!r.success) return false
  if (r.todos) return true
  return r.procesos.includes(procesoId)
}

/** Los procesos de UN usuario, para la pantalla de permisos. */
export async function getProcesosDeUsuario(
  usuarioId: string,
): Promise<{ success: boolean; procesos: string[]; faltaMigracion?: boolean; message?: string }> {
  // Los procesos de OTRO usuario solo los ve quien administra usuarios.
  const yo = await usuarioActual()
  if (yo !== usuarioId) {
    const motivo = await exigirAdministradorUsuarios("permisos-mapa.leer")
    if (motivo) return { success: false, procesos: [], message: motivo }
  }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("permisos_mapa_procesos")
      .select("proceso_id")
      .eq("usuario_id", usuarioId)

    if (error) {
      if (faltaTabla(error.message)) return { success: true, procesos: [], faltaMigracion: true }
      return { success: false, procesos: [], message: error.message }
    }
    return { success: true, procesos: (data ?? []).map((r: any) => String(r.proceso_id)) }
  } catch (e: any) {
    return { success: false, procesos: [], message: e?.message }
  }
}

/**
 * Reemplaza los procesos de un usuario por los de la lista.
 *
 * Se borra lo que sobra y se inserta lo que falta, en vez de borrar todo y
 * volver a insertar: así una lista idéntica no genera escrituras, y un fallo a
 * mitad no deja al usuario sin ningún acceso.
 */
export async function guardarProcesosDeUsuario(
  usuarioId: string,
  procesos: string[],
): Promise<{ success: boolean; message?: string }> {
  // Fase 0 (2026-10-07): esta acción escribía permisos sin preguntar quién
  // llamaba. Exige el módulo "Gestión de Usuarios", como el resto de la
  // administración de permisos.
  const motivo = await exigirAdministradorUsuarios("permisos-mapa.guardar")
  if (motivo) return { success: false, message: motivo }
  try {
    const sb: any = await getSupabaseAdmin()
    const quien = (await usuarioActual()) ?? "sistema"

    const { data: actuales, error: errLeer } = await sb
      .from("permisos_mapa_procesos")
      .select("proceso_id")
      .eq("usuario_id", usuarioId)

    if (errLeer) {
      if (faltaTabla(errLeer.message)) {
        return { success: false, message: "Falta correr scripts/189_permisos_mapa_procesos.sql." }
      }
      return { success: false, message: errLeer.message }
    }

    const tiene = new Set<string>((actuales ?? []).map((r: any) => String(r.proceso_id)))
    const quiere = new Set<string>(procesos)

    const sobran = [...tiene].filter((p) => !quiere.has(p))
    const faltan = [...quiere].filter((p) => !tiene.has(p))

    if (sobran.length) {
      const { error } = await sb
        .from("permisos_mapa_procesos")
        .delete()
        .eq("usuario_id", usuarioId)
        .in("proceso_id", sobran)
      if (error) return { success: false, message: error.message }
    }

    if (faltan.length) {
      const { error } = await sb.from("permisos_mapa_procesos").insert(
        faltan.map((p) => ({
          usuario_id: usuarioId,
          proceso_id: p,
          otorgado_por: quien,
        })),
      )
      if (error) return { success: false, message: error.message }
    }

    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudieron guardar los permisos." }
  }
}
