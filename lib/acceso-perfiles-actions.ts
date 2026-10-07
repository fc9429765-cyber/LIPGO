"use server"

// PERFILES — LA PARTE DE ACCESO
//
// Desde el 2026-10-07 el perfil es UNO solo: `autorizacion_perfiles` (el
// puesto del script 203) con lo que autoriza con clave Y con lo que abre:
// empresas, owners y módulos (hijas `acceso_perfil_*`, script 252). Este
// archivo administra la parte de acceso y se apoya en `autorizaciones-actions`
// para la cabecera del perfil, los procesos y la asignación, que siguen
// siendo de ese módulo (con su candado financiero y su bitácora).
//
// CÓMO SE APLICA. Veintiún módulos leen las tres tablas de siempre
// (perfil_acceso_empresas, perfil_acceso_owners, permisos_usuarios) y no se
// toca ninguno. El perfil es la FUENTE y `recalcularAccesoUsuario` escribe el
// acceso efectivo en esas tablas. Lo que el administrador marcó a mano se
// respeta: el recálculo solo retira lo que un perfil trajo y ya ningún perfil
// activo trae, y eso lo sabe gracias a `acceso_perfil_materializado`.
//
// OJO con los nombres: `perfil_acceso_*` (singular, viejo) es acceso POR
// USUARIO; `acceso_perfil_*` (nuevo) es lo que trae cada PERFIL.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { exigirAdministradorUsuarios } from "@/lib/seguridad-servidor"
import { updateUserPermissions } from "@/lib/permissions-actions"
import { adminGuardarPerfil, adminSincronizarPerfilesUsuario } from "@/lib/autorizaciones-actions"
import { CLAVES_PERMISO } from "@/lib/permisos-claves"
import type { UserPermissions } from "@/lib/permissions-map"
import type {
  CambiosAcceso,
  PerfilAcceso,
  PerfilAccesoInput,
  PlantillaAcceso,
  ResultadoRecalculo,
  UsuarioDePerfil,
} from "@/lib/acceso-perfiles-tipos"

const PERFILES = "autorizacion_perfiles"
const ASIGNACION = "autorizacion_usuario_perfiles"

const FALTA_MIGRACION =
  "Las tablas de perfiles no están al día: hay que correr scripts/252_perfiles_unificados.sql."

function tablaInexistente(e: any): boolean {
  return e?.code === "42P01" || /relation .* does not exist/i.test(String(e?.message ?? ""))
}

function mensajeDe(e: any): string {
  if (tablaInexistente(e)) return FALTA_MIGRACION
  if (e?.code === "23505") return "Ya existe un perfil con ese nombre."
  return e?.message ?? String(e)
}

const unicos = <T,>(xs: T[]) => [...new Set(xs)]

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export async function listarPerfilesAcceso(): Promise<{
  success: boolean
  data: PerfilAcceso[]
  /** Usuarios distintos que tienen al menos un perfil. */
  usuariosCubiertos: number
  faltaMigracion?: boolean
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: cab, error } = await sb
      .from(PERFILES)
      .select("*")
      .order("activo", { ascending: false })
      .order("nombre", { ascending: true })
    if (error) throw error

    // Cinco consultas chicas y se arma en memoria: son catálogos de decenas de
    // filas, no vale la pena un join que PostgREST haría más frágil.
    const [{ data: emp, error: eEmp }, { data: own }, { data: per }, { data: pro }, { data: usu }] = await Promise.all([
      sb.from("acceso_perfil_empresas").select("perfil_id, empresa_id"),
      sb.from("acceso_perfil_owners").select("perfil_id, owner"),
      sb.from("acceso_perfil_permisos").select("perfil_id, permiso"),
      sb.from("autorizacion_perfil_procesos").select("perfil_id, proceso"),
      sb.from(ASIGNACION).select("perfil_id, usuario_id"),
    ])
    if (eEmp) throw eEmp

    const agrupar = <T,>(rows: any[] | null, pick: (r: any) => T) => {
      const m = new Map<number, T[]>()
      for (const r of rows ?? []) {
        const k = Number(r.perfil_id)
        m.set(k, [...(m.get(k) ?? []), pick(r)])
      }
      return m
    }
    const E = agrupar(emp, (r) => Number(r.empresa_id))
    const O = agrupar(own, (r) => String(r.owner))
    const P = agrupar(per, (r) => String(r.permiso))
    const PR = agrupar(pro, (r) => String(r.proceso))
    const U = agrupar(usu, (r) => String(r.usuario_id))

    const data: PerfilAcceso[] = (cab ?? []).map((c: any) => ({
      id: Number(c.id),
      nombre: c.nombre,
      descripcion: c.descripcion ?? null,
      activo: c.activo !== false,
      created_at: c.created_at,
      updated_at: c.updated_at ?? null,
      empresas: E.get(Number(c.id)) ?? [],
      owners: O.get(Number(c.id)) ?? [],
      permisos: P.get(Number(c.id)) ?? [],
      procesos: PR.get(Number(c.id)) ?? [],
      // La asignación puede tener varias filas por usuario (una por alcance).
      usuarios: unicos(U.get(Number(c.id)) ?? []).length,
    }))

    const usuariosCubiertos = new Set((usu ?? []).map((r: any) => String(r.usuario_id))).size
    return { success: true, data, usuariosCubiertos }
  } catch (e: any) {
    if (tablaInexistente(e)) return { success: true, data: [], usuariosCubiertos: 0, faltaMigracion: true }
    console.error("[acceso-perfiles] listar:", e?.message ?? e)
    return { success: false, data: [], usuariosCubiertos: 0, message: mensajeDe(e) }
  }
}

/** Perfiles (ids distintos) que tiene un usuario, con cualquier alcance. */
export async function getPerfilesDeUsuario(profileId: string): Promise<number[]> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb.from(ASIGNACION).select("perfil_id").eq("usuario_id", profileId)
    if (error) throw error
    return unicos((data ?? []).map((r: any) => Number(r.perfil_id)))
  } catch (e: any) {
    if (!tablaInexistente(e)) console.error("[acceso-perfiles] perfiles de usuario:", e?.message ?? e)
    return []
  }
}

export async function usuariosDePerfil(perfilId: number): Promise<UsuarioDePerfil[]> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: asig, error } = await sb.from(ASIGNACION).select("usuario_id").eq("perfil_id", perfilId)
    if (error) throw error
    const ids = unicos((asig ?? []).map((r: any) => String(r.usuario_id)))
    if (ids.length === 0) return []
    const { data: prof } = await sb.from("profiles").select("id, usuario").in("id", ids).order("usuario")
    return (prof ?? []).map((p: any) => ({ id: String(p.id), usuario: String(p.usuario ?? "") }))
  } catch (e: any) {
    if (!tablaInexistente(e)) console.error("[acceso-perfiles] usuarios de perfil:", e?.message ?? e)
    return []
  }
}

/** Todos los usuarios, para arrancar un perfil "a partir de" uno de ellos. */
export async function usuariosParaPlantilla(): Promise<UsuarioDePerfil[]> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data } = await sb.from("profiles").select("id, usuario").order("usuario")
    return (data ?? []).map((p: any) => ({ id: String(p.id), usuario: String(p.usuario ?? "") }))
  } catch {
    return []
  }
}

/**
 * Lo que un usuario tiene HOY, para usarlo como punto de partida de un perfil.
 *
 * Es la forma rápida de ordenar lo existente: se abre al coordinador que ya
 * está bien configurado, se crea el perfil "a partir de él", y de ahí en
 * adelante los nuevos coordinadores reciben el perfil en vez de 140 clics.
 */
export async function plantillaDesdeUsuario(
  profileId: string,
): Promise<{ success: boolean; data?: PlantillaAcceso; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const [{ data: emp }, { data: own }, { data: per }, { data: asig }] = await Promise.all([
      sb.from("perfil_acceso_empresas").select("empresa_id").eq("profile_id", profileId),
      sb.from("perfil_acceso_owners").select("owner").eq("profile_id", profileId),
      sb.from("permisos_usuarios").select("*").eq("usuario_id", profileId).maybeSingle(),
      sb.from(ASIGNACION).select("perfil_id").eq("usuario_id", profileId),
    ])
    const permisos = per
      ? Object.entries(per)
          .filter(([k, v]) => v === true && CLAVES_PERMISO.has(k))
          .map(([k]) => k)
      : []
    // Lo que autoriza hoy: la unión de los procesos de sus perfiles.
    const perfiles = unicos((asig ?? []).map((r: any) => Number(r.perfil_id)))
    let procesos: string[] = []
    if (perfiles.length) {
      const { data: pp } = await sb.from("autorizacion_perfil_procesos").select("proceso").in("perfil_id", perfiles)
      procesos = unicos((pp ?? []).map((r: any) => String(r.proceso)))
    }
    return {
      success: true,
      data: {
        empresas: (emp ?? []).map((r: any) => Number(r.empresa_id)),
        owners: (own ?? []).map((r: any) => String(r.owner)),
        permisos,
        procesos,
      },
    }
  } catch (e: any) {
    return { success: false, message: mensajeDe(e) }
  }
}

/**
 * Qué parte del acceso de un usuario la puso un perfil.
 *
 * La pantalla lo usa para marcar cada casilla que vino de un perfil. Sin esa
 * marca no se distingue lo del perfil de lo manual, y desmarcar algo del
 * perfil "no hace nada" --el próximo recálculo lo devuelve-- sin que se
 * entienda por qué.
 */
export async function getAccesoMaterializadoUsuario(
  profileId: string,
): Promise<{ empresas: number[]; owners: string[]; permisos: string[] }> {
  const vacio = { empresas: [] as number[], owners: [] as string[], permisos: [] as string[] }
  if (!profileId) return vacio
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("acceso_perfil_materializado")
      .select("tipo, valor")
      .eq("profile_id", profileId)
    if (error) throw error
    const out = { empresas: [] as number[], owners: [] as string[], permisos: [] as string[] }
    for (const r of data ?? []) {
      if (r.tipo === "empresa") out.empresas.push(Number(r.valor))
      else if (r.tipo === "owner") out.owners.push(String(r.valor))
      else if (r.tipo === "permiso") out.permisos.push(String(r.valor))
    }
    return out
  } catch (e: any) {
    if (!tablaInexistente(e)) console.error("[acceso-perfiles] materializado de usuario:", e?.message ?? e)
    return vacio
  }
}

// ---------------------------------------------------------------------------
// El alcance de la clave sigue a las empresas del perfil
// ---------------------------------------------------------------------------

async function empresasPorPerfil(sb: any, perfilIds: number[]): Promise<Map<number, number[]>> {
  const m = new Map<number, number[]>()
  if (!perfilIds.length) return m
  const { data } = await sb.from("acceso_perfil_empresas").select("perfil_id, empresa_id").in("perfil_id", perfilIds)
  for (const r of data ?? []) {
    const k = Number(r.perfil_id)
    m.set(k, [...(m.get(k) ?? []), Number(r.empresa_id)])
  }
  return m
}

/**
 * Deja la asignación del usuario coherente con `perfilIds`: una fila por
 * empresa de cada perfil (o "todos" si el perfil no define empresas). Pasa
 * por `adminSincronizarPerfilesUsuario`, que es quien escribe esa tabla con
 * el candado financiero y la bitácora de autorizaciones.
 */
async function sincronizarAsignacion(
  sb: any,
  profileId: string,
  perfilIds: number[],
): Promise<{ success: boolean; message?: string; agregados: number; retirados: number }> {
  const ids = unicos(perfilIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))
  const emp = await empresasPorPerfil(sb, ids)
  const r = await adminSincronizarPerfilesUsuario(
    profileId,
    ids.map((perfilId) => ({ perfilId, empresas: emp.get(perfilId) ?? [] })),
  )
  return { success: r.success, message: r.message, agregados: r.agregados ?? 0, retirados: r.retirados ?? 0 }
}

// ---------------------------------------------------------------------------
// El recálculo: del perfil a las tablas que los módulos leen
// ---------------------------------------------------------------------------

/**
 * Recalcula el acceso efectivo de un usuario a partir de sus perfiles ACTIVOS
 * y lo escribe en las tres tablas de siempre.
 *
 * La regla, por cada tipo (empresas, owners, permisos):
 *   · se RETIRA lo que un perfil trajo la última vez y ya ningún perfil activo
 *     trae (está en materializado y no en lo derivado);
 *   · se AGREGA lo que los perfiles traen y el usuario aún no tiene;
 *   · lo que ya tenía a mano y un perfil también trae NO se anota como del
 *     perfil, así que si el perfil se quita, se conserva.
 *
 * Deliberadamente no bloquea por permiso: la llaman acciones que ya lo
 * exigieron, y también hace falta tras borrar un perfil.
 */
export async function recalcularAccesoUsuario(
  profileId: string,
): Promise<{ success: boolean; message?: string; cambios?: CambiosAcceso }> {
  if (!profileId) return { success: false, message: "Usuario no especificado." }
  try {
    const sb: any = await getSupabaseAdmin()

    // 1) Sus perfiles activos. Uno inactivo sigue asignado pero no aporta.
    const { data: asig, error: eA } = await sb.from(ASIGNACION).select("perfil_id").eq("usuario_id", profileId)
    if (eA) throw eA
    const ids = unicos((asig ?? []).map((r: any) => Number(r.perfil_id)))
    let activos: number[] = []
    if (ids.length) {
      const { data: per } = await sb.from(PERFILES).select("id").in("id", ids).eq("activo", true)
      activos = (per ?? []).map((r: any) => Number(r.id))
    }

    // 2) Lo que esos perfiles traen (unión).
    const derivE = new Set<number>()
    const derivO = new Set<string>()
    const derivP = new Set<string>()
    if (activos.length) {
      const [{ data: e, error: eE }, { data: o }, { data: p }] = await Promise.all([
        sb.from("acceso_perfil_empresas").select("empresa_id").in("perfil_id", activos),
        sb.from("acceso_perfil_owners").select("owner").in("perfil_id", activos),
        sb.from("acceso_perfil_permisos").select("permiso").in("perfil_id", activos),
      ])
      if (eE) throw eE
      for (const r of e ?? []) derivE.add(Number(r.empresa_id))
      for (const r of o ?? []) derivO.add(String(r.owner))
      for (const r of p ?? []) if (CLAVES_PERMISO.has(String(r.permiso))) derivP.add(String(r.permiso))
    }

    // 3) Lo que los perfiles trajeron la última vez, y lo que el usuario tiene hoy.
    const [{ data: mat, error: eM }, { data: eCur }, { data: oCur }, { data: pCur }] = await Promise.all([
      sb.from("acceso_perfil_materializado").select("tipo, valor").eq("profile_id", profileId),
      sb.from("perfil_acceso_empresas").select("empresa_id").eq("profile_id", profileId),
      sb.from("perfil_acceso_owners").select("owner").eq("profile_id", profileId),
      sb.from("permisos_usuarios").select("*").eq("usuario_id", profileId).maybeSingle(),
    ])
    if (eM) throw eM
    const prevE = new Set<number>(), prevO = new Set<string>(), prevP = new Set<string>()
    for (const r of mat ?? []) {
      if (r.tipo === "empresa") prevE.add(Number(r.valor))
      else if (r.tipo === "owner") prevO.add(String(r.valor))
      else if (r.tipo === "permiso") prevP.add(String(r.valor))
    }
    const curE = new Set<number>((eCur ?? []).map((r: any) => Number(r.empresa_id)))
    const curO = new Set<string>((oCur ?? []).map((r: any) => String(r.owner)))
    const curP = new Set<string>(
      pCur ? Object.entries(pCur).filter(([k, v]) => v === true && CLAVES_PERMISO.has(k)).map(([k]) => k) : [],
    )

    // 4) Qué retirar, qué agregar, y qué anotar como traído por perfiles.
    const plan = <T,>(prev: Set<T>, deriv: Set<T>, cur: Set<T>) => {
      const quitar = [...prev].filter((x) => !deriv.has(x))
      const curDespues = new Set([...cur].filter((x) => !quitar.includes(x)))
      const agregar = [...deriv].filter((x) => !curDespues.has(x))
      const nuevoMat = unicos([...[...prev].filter((x) => deriv.has(x)), ...agregar])
      return { quitar, agregar, nuevoMat }
    }
    const pE = plan(prevE, derivE, curE)
    const pO = plan(prevO, derivO, curO)
    const pP = plan(prevP, derivP, curP)

    // 5) Aplicar. Primero se retira, después se agrega.
    if (pE.quitar.length) {
      const { error } = await sb.from("perfil_acceso_empresas").delete().eq("profile_id", profileId).in("empresa_id", pE.quitar)
      if (error) throw error
    }
    if (pE.agregar.length) {
      const { error } = await sb.from("perfil_acceso_empresas").insert(pE.agregar.map((empresa_id) => ({ profile_id: profileId, empresa_id })))
      if (error) throw error
    }
    if (pO.quitar.length) {
      const { error } = await sb.from("perfil_acceso_owners").delete().eq("profile_id", profileId).in("owner", pO.quitar)
      if (error) throw error
    }
    if (pO.agregar.length) {
      const { error } = await sb.from("perfil_acceso_owners").insert(pO.agregar.map((owner) => ({ profile_id: profileId, owner })))
      if (error) throw error
    }
    if (pP.quitar.length || pP.agregar.length) {
      // Se pasa por `updateUserPermissions` y no se escribe directo: es el
      // único escritor de permisos_usuarios y ya maneja el "no existe la fila".
      const cambios: Partial<UserPermissions> = {}
      for (const k of pP.quitar) (cambios as any)[k] = false
      for (const k of pP.agregar) (cambios as any)[k] = true
      const r = await updateUserPermissions(profileId, cambios)
      if (!r.success) throw new Error(r.error ?? "No se pudieron escribir los permisos de módulo.")
    }

    // 6) La memoria de lo que vino de perfiles, reemplazada entera.
    const { error: eDel } = await sb.from("acceso_perfil_materializado").delete().eq("profile_id", profileId)
    if (eDel) throw eDel
    const filas = [
      ...pE.nuevoMat.map((v) => ({ profile_id: profileId, tipo: "empresa", valor: String(v) })),
      ...pO.nuevoMat.map((v) => ({ profile_id: profileId, tipo: "owner", valor: v })),
      ...pP.nuevoMat.map((v) => ({ profile_id: profileId, tipo: "permiso", valor: v })),
    ]
    if (filas.length) {
      const { error } = await sb.from("acceso_perfil_materializado").insert(filas)
      if (error) throw error
    }

    return {
      success: true,
      cambios: {
        empresas: { agregadas: pE.agregar.length, retiradas: pE.quitar.length },
        owners: { agregadas: pO.agregar.length, retiradas: pO.quitar.length },
        permisos: { agregados: pP.agregar.length, retirados: pP.quitar.length },
      },
    }
  } catch (e: any) {
    console.error("[acceso-perfiles] recalcular", profileId, e?.message ?? e)
    return { success: false, message: mensajeDe(e) }
  }
}

async function usuariosIdsDePerfil(sb: any, perfilId: number): Promise<string[]> {
  const { data } = await sb.from(ASIGNACION).select("usuario_id").eq("perfil_id", perfilId)
  return unicos((data ?? []).map((r: any) => String(r.usuario_id)))
}

// ---------------------------------------------------------------------------
// Escritura de perfiles
// ---------------------------------------------------------------------------

/**
 * Guarda el perfil entero: cabecera y procesos por `adminGuardarPerfil` (que
 * aplica el candado financiero y deja bitácora), y la parte de acceso aquí.
 *
 * Si el perfil define empresas, la asignación de quienes lo tienen se vuelve
 * a alinear --una fila por empresa-- y luego se recalcula su acceso. Así el
 * cambio llega ahora, no la próxima vez que alguien toque a cada usuario.
 */
export async function guardarPerfilAcceso(
  input: PerfilAccesoInput,
): Promise<{ success: boolean; id?: number; message?: string; recalculo?: ResultadoRecalculo }> {
  const motivo = await exigirAdministradorUsuarios("acceso-perfiles.guardar")
  if (motivo) return { success: false, message: motivo }

  const nombre = String(input.nombre ?? "").trim()
  if (!nombre) return { success: false, message: "El perfil necesita un nombre." }
  const empresas = unicos((input.empresas ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))
  const owners = unicos((input.owners ?? []).map((o) => String(o ?? "").trim()).filter(Boolean))
  const permisos = unicos((input.permisos ?? []).map(String))
  const procesos = unicos((input.procesos ?? []).map((p) => String(p ?? "").trim()).filter(Boolean))
  // Una clave que no exista como columna haría fallar el recálculo de TODOS
  // los usuarios del perfil, así que se rechaza aquí, con nombre.
  const desconocidos = permisos.filter((k) => !CLAVES_PERMISO.has(k))
  if (desconocidos.length) {
    return { success: false, message: `Permisos que no existen en el sistema: ${desconocidos.join(", ")}.` }
  }

  try {
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)

    // Cabecera + procesos: por el camino de autorizaciones, que ya sabe de
    // nombres repetidos y de lo financiero.
    const cab = await adminGuardarPerfil({
      id: input.id ?? null,
      nombre,
      descripcion: input.descripcion?.trim() || null,
      activo: input.activo !== false,
      procesos,
    })
    if (!cab.success || !cab.id) return { success: false, message: cab.message ?? "No se pudo guardar el perfil." }
    const id = Number(cab.id)
    await sb
      .from(PERFILES)
      .update({ updated_at: new Date().toISOString(), ...(input.id ? {} : { creado_por: usuario ?? null }) })
      .eq("id", id)

    // Los hijos de acceso se reemplazan enteros: es más simple de razonar que
    // un diff y son listas cortas.
    const borrar = await Promise.all([
      sb.from("acceso_perfil_empresas").delete().eq("perfil_id", id),
      sb.from("acceso_perfil_owners").delete().eq("perfil_id", id),
      sb.from("acceso_perfil_permisos").delete().eq("perfil_id", id),
    ])
    for (const b of borrar) if (b.error) throw b.error
    if (empresas.length) {
      const { error } = await sb.from("acceso_perfil_empresas").insert(empresas.map((empresa_id) => ({ perfil_id: id, empresa_id })))
      if (error) throw error
    }
    if (owners.length) {
      const { error } = await sb.from("acceso_perfil_owners").insert(owners.map((owner) => ({ perfil_id: id, owner })))
      if (error) throw error
    }
    if (permisos.length) {
      const { error } = await sb.from("acceso_perfil_permisos").insert(permisos.map((permiso) => ({ perfil_id: id, permiso })))
      if (error) throw error
    }

    // Quienes lo tienen reciben el cambio ahora. En serie: son pocos y así un
    // fallo se atribuye a uno.
    const ids = await usuariosIdsDePerfil(sb, id)
    const errores: string[] = []
    for (const uid of ids) {
      if (empresas.length) {
        const s = await sincronizarAsignacion(sb, uid, await getPerfilesDeUsuario(uid))
        if (!s.success) errores.push(`${uid}: ${s.message}`)
      }
      const r = await recalcularAccesoUsuario(uid)
      if (!r.success) errores.push(`${uid}: ${r.message}`)
    }
    return { success: true, id, recalculo: { usuarios: ids.length, errores } }
  } catch (e: any) {
    console.error("[acceso-perfiles] guardar:", e?.message ?? e)
    return { success: false, message: mensajeDe(e) }
  }
}

export async function eliminarPerfilAcceso(
  id: number,
): Promise<{ success: boolean; message?: string; recalculo?: ResultadoRecalculo }> {
  const motivo = await exigirAdministradorUsuarios("acceso-perfiles.eliminar")
  if (motivo) return { success: false, message: motivo }
  try {
    const sb: any = await getSupabaseAdmin()
    // Los usuarios se leen ANTES de borrar: el cascade se lleva la asignación
    // y después ya no habría forma de saber a quién recalcular.
    const ids = await usuariosIdsDePerfil(sb, id)
    const { error } = await sb.from(PERFILES).delete().eq("id", id)
    if (error) throw error
    const errores: string[] = []
    for (const uid of ids) {
      const r = await recalcularAccesoUsuario(uid)
      if (!r.success) errores.push(`${uid}: ${r.message}`)
    }
    return { success: true, recalculo: { usuarios: ids.length, errores } }
  } catch (e: any) {
    console.error("[acceso-perfiles] eliminar:", e?.message ?? e)
    return { success: false, message: mensajeDe(e) }
  }
}

// ---------------------------------------------------------------------------
// Asignación
// ---------------------------------------------------------------------------

/**
 * Deja al usuario exactamente con los perfiles indicados y recalcula su
 * acceso. Devuelve qué cambió para que la pantalla lo cuente.
 */
export async function asignarPerfilesUsuario(
  profileId: string,
  perfilIds: number[],
): Promise<{ success: boolean; message?: string; cambios?: CambiosAcceso }> {
  const motivo = await exigirAdministradorUsuarios("acceso-perfiles.asignar")
  if (motivo) return { success: false, message: motivo }
  if (!profileId) return { success: false, message: "Usuario no especificado." }
  try {
    const sb: any = await getSupabaseAdmin()
    const s = await sincronizarAsignacion(sb, profileId, perfilIds)
    if (!s.success) return { success: false, message: s.message }
    return await recalcularAccesoUsuario(profileId)
  } catch (e: any) {
    console.error("[acceso-perfiles] asignar:", e?.message ?? e)
    return { success: false, message: mensajeDe(e) }
  }
}

/**
 * El otro sentido: deja el PERFIL exactamente con los usuarios indicados y
 * recalcula a cada uno que entró o salió. Existe porque la asignación se
 * decide desde dos lugares legítimos: mirando a la persona o mirando al
 * puesto.
 */
export async function asignarUsuariosAPerfil(
  perfilId: number,
  profileIds: string[],
): Promise<{ success: boolean; message?: string; agregados: number; retirados: number; errores: string[] }> {
  const vacio = { agregados: 0, retirados: 0, errores: [] as string[] }
  const motivo = await exigirAdministradorUsuarios("acceso-perfiles.asignar-usuarios")
  if (motivo) return { success: false, message: motivo, ...vacio }
  if (!perfilId) return { success: false, message: "Perfil no especificado.", ...vacio }
  try {
    const sb: any = await getSupabaseAdmin()
    const deseados = new Set((profileIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean))
    const actuales = new Set(await usuariosIdsDePerfil(sb, perfilId))
    const agregar = [...deseados].filter((id) => !actuales.has(id))
    const quitar = [...actuales].filter((id) => !deseados.has(id))

    const errores: string[] = []
    for (const uid of agregar) {
      const s = await sincronizarAsignacion(sb, uid, [...(await getPerfilesDeUsuario(uid)), perfilId])
      if (!s.success) {
        errores.push(`${uid}: ${s.message}`)
        continue
      }
      const r = await recalcularAccesoUsuario(uid)
      if (!r.success) errores.push(`${uid}: ${r.message}`)
    }
    for (const uid of quitar) {
      const s = await sincronizarAsignacion(sb, uid, (await getPerfilesDeUsuario(uid)).filter((p) => p !== perfilId))
      if (!s.success) {
        errores.push(`${uid}: ${s.message}`)
        continue
      }
      const r = await recalcularAccesoUsuario(uid)
      if (!r.success) errores.push(`${uid}: ${r.message}`)
    }
    return { success: true, agregados: agregar.length, retirados: quitar.length, errores }
  } catch (e: any) {
    console.error("[acceso-perfiles] asignar usuarios:", e?.message ?? e)
    return { success: false, message: mensajeDe(e), ...vacio }
  }
}
