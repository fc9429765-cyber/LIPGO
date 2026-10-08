"use server"

/**
 * LA BANDEJA DEL COORDINADOR LIP: lo que el ciclo de facturación le envió a SU proyecto
 * y está esperando su firma.
 *
 * Por qué existe aparte del módulo «Ciclo de Facturación»: ese módulo vive en Gestión
 * Financiera, detrás del permiso del módulo y de la clave financiera. El coordinador de
 * un proyecto no tiene —ni debe necesitar— ninguna de las dos para subir un anexo firmado
 * por su cliente. Su sitio de trabajo es Solicitar Facturas, y ahí es donde esta bandeja
 * se muestra (components/facturacion/bandeja-anexos-coordinador.tsx).
 *
 * NO cambia ningún permiso. La pantalla se compuerta por el permiso que el coordinador
 * ya tiene (Solicitar Facturas) y el alcance sale del perfil de autorización
 * «Coordinador LIP» que ya tiene asignado por proyecto. Quien tenga el permiso global del
 * ciclo (`ciclo_facturacion_coordinador`) sigue viendo todo, como hasta hoy.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"
import { getUserPermissions } from "@/lib/permissions-actions"
import { getAccessibleEmpresesFromPermisos } from "@/lib/orders-actions"
import { CORTE_CICLO_SIIGO, ownerDePrefactura, proyectoEntregado } from "@/lib/ciclo-facturacion-shared"
import {
  diasEsperando,
  eventoDelCoordinador,
  papelDelPaso,
  proyectosComoCoordinadorLip,
  puedeActuarComoCoordinador,
  tareaDelCoordinador,
  type AsignacionPerfil,
} from "@/lib/ciclo-facturacion-bandeja"
import { registrarErrorServidor } from "@/lib/errores-servidor"

export interface ItemBandejaCoordinador {
  prefacturaId: number
  idempresa: number
  proyecto: string
  owner: string
  periodo_desde: string | null
  periodo_hasta: string | null
  total: number
  estado_ciclo: string
  /** Qué tiene que hacer, en sus palabras. */
  tarea: string
  /** Evento que registra al subir el documento firmado. */
  evento: "anexo_firmado" | "factura_firmada"
  /** El documento que le llegó (anexo o factura), para verlo antes de firmarlo. */
  documentoUrl: string | null
  documentoNombre: string | null
  /** Desde cuándo está en este paso, y cuántos días lleva. */
  desde: string | null
  diasEsperando: number | null
  /** Cuántos pasos de los cinco lleva recorridos (para pintarlo). */
  advertencias: { tipo: string; detalle: string }[]
}

/** Perfiles de autorización del usuario en sesión, en la forma que entiende el módulo puro. */
async function perfilesDelUsuario(sb: any, usuarioId: string): Promise<AsignacionPerfil[]> {
  const { data } = await sb
    .from("autorizacion_usuario_perfiles")
    .select("idempresa, autorizacion_perfiles!inner(nombre, activo)")
    .eq("usuario_id", usuarioId)
  return (data ?? []).map((r: any) => ({
    perfil: String(r.autorizacion_perfiles?.nombre ?? ""),
    idempresa: r.idempresa == null ? null : Number(r.idempresa),
    activo: r.autorizacion_perfiles?.activo !== false,
  }))
}

/**
 * En qué proyectos el usuario en sesión actúa como coordinador del ciclo: los suyos por
 * perfil «Coordinador LIP» y, si tiene el permiso global, todos los que puede abrir.
 * Nunca incluye un proyecto entregado.
 */
export async function getMisProyectosComoCoordinador(): Promise<{ success: boolean; data: number[]; global: boolean; message?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, data: [], global: false, message: "Sin sesión." }
    const sb: any = await getSupabaseAdmin()
    const permisos = await getUserPermissions()
    const global = !!permisos?.ciclo_facturacion_coordinador
    const accesibles = (await getAccessibleEmpresesFromPermisos()).map((e) => Number(e.id))
    if (global) return { success: true, data: accesibles.filter((e) => !proyectoEntregado(e)), global: true }
    const perfiles = await perfilesDelUsuario(sb, user.id)
    return { success: true, data: proyectosComoCoordinadorLip(perfiles, accesibles), global: false }
  } catch (e: any) {
    void registrarErrorServidor("bandeja-facturacion.getMisProyectosComoCoordinador", e)
    return { success: false, data: [], global: false, message: e?.message || "No se pudo leer el alcance." }
  }
}

/**
 * Lo que está esperando la firma del coordinador en sus proyectos. Mismo corte que el
 * módulo del ciclo (`CORTE_CICLO_SIIGO`): lo anterior se facturó por fuera.
 */
export async function listarBandejaCoordinador(): Promise<{ success: boolean; data: ItemBandejaCoordinador[]; proyectos: number[]; message?: string }> {
  try {
    const alcance = await getMisProyectosComoCoordinador()
    if (!alcance.success) return { success: false, data: [], proyectos: [], message: alcance.message }
    if (alcance.data.length === 0) return { success: true, data: [], proyectos: [] }

    const sb: any = await getSupabaseAdmin()
    const { data: filas, error } = await sb
      .from("prefacturas")
      .select("id, idempresa, proyecto, periodo_desde, periodo_hasta, total, lineas, estado_ciclo, ciclo_actualizado_en, created_at, advertencias")
      .eq("estado", "aprobada")
      .in("estado_ciclo", ["pendiente_firma_anexo", "pendiente_firma_factura"])
      .in("idempresa", alcance.data)
      .gte("periodo_hasta", CORTE_CICLO_SIIGO)
      .order("ciclo_actualizado_en", { ascending: true, nullsFirst: true })
    if (error) return { success: false, data: [], proyectos: alcance.data, message: error.message }

    const ids = (filas ?? []).map((f: any) => f.id)
    const ultimoDoc = new Map<number, { url: string; nombre: string | null }>()
    if (ids.length) {
      const { data: eventos } = await sb
        .from("prefactura_ciclo_eventos")
        .select("prefactura_id, archivo_url, archivo_nombre, created_at")
        .in("prefactura_id", ids)
        .not("archivo_url", "is", null)
        .order("created_at", { ascending: true })
      // Orden ascendente: el último en iterar es el más reciente.
      for (const e of eventos ?? []) ultimoDoc.set(e.prefactura_id, { url: e.archivo_url, nombre: e.archivo_nombre ?? null })
    }

    const { data: empresas } = await sb.from("empresas").select("id, nombre").in("id", alcance.data)
    const nombreEmpresa = new Map<number, string>((empresas ?? []).map((e: any) => [Number(e.id), String(e.nombre)]))

    const out: ItemBandejaCoordinador[] = []
    for (const f of filas ?? []) {
      if (papelDelPaso(f.estado_ciclo) !== "coordinador") continue
      const evento = eventoDelCoordinador(f.estado_ciclo)
      if (!evento) continue
      const { owner } = ownerDePrefactura(f.lineas)
      const doc = ultimoDoc.get(f.id)
      const desde = f.ciclo_actualizado_en ?? f.created_at ?? null
      out.push({
        prefacturaId: f.id,
        idempresa: Number(f.idempresa),
        proyecto: nombreEmpresa.get(Number(f.idempresa)) ?? f.proyecto ?? `Proyecto ${f.idempresa}`,
        owner,
        periodo_desde: f.periodo_desde,
        periodo_hasta: f.periodo_hasta,
        total: Number(f.total || 0),
        estado_ciclo: f.estado_ciclo,
        tarea: tareaDelCoordinador(f.estado_ciclo) ?? "",
        evento,
        documentoUrl: doc?.url ?? null,
        documentoNombre: doc?.nombre ?? null,
        desde,
        diasEsperando: diasEsperando(desde),
        advertencias: Array.isArray(f.advertencias) ? f.advertencias : [],
      })
    }
    return { success: true, data: out, proyectos: alcance.data }
  } catch (e: any) {
    void registrarErrorServidor("bandeja-facturacion.listarBandejaCoordinador", e)
    return { success: false, data: [], proyectos: [], message: e?.message || "No se pudo leer la bandeja." }
  }
}

/**
 * ¿Puede el usuario en sesión dar el paso del coordinador sobre una prefactura de
 * `idempresa`? Lo usa `registrarEventoCiclo` para no exigir el permiso global a quien
 * es coordinador LIP de ese proyecto.
 */
export async function puedoActuarComoCoordinadorEn(idempresa: number | null | undefined): Promise<boolean> {
  try {
    const user = await getCurrentUser()
    if (!user) return false
    const permisos = await getUserPermissions()
    const sb: any = await getSupabaseAdmin()
    const perfiles = await perfilesDelUsuario(sb, user.id)
    return puedeActuarComoCoordinador({ permisoGlobal: !!permisos?.ciclo_facturacion_coordinador, perfiles, idempresa })
  } catch (e: any) {
    void registrarErrorServidor("bandeja-facturacion.puedoActuarComoCoordinadorEn", e, { idempresa })
    return false
  }
}
