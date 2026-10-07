"use server"

// PERFILES DE ACCESO
//
// Un perfil es un paquete con nombre de empresas + owners + permisos de
// módulo. Se asigna a usuarios y el usuario queda con todo eso.
//
// CÓMO SE APLICA. Veintiún módulos leen las tres tablas de siempre
// (perfil_acceso_empresas, perfil_acceso_owners, permisos_usuarios) y no se
// toca ninguno. El perfil es la FUENTE y `recalcularAccesoUsuario` escribe el
// acceso efectivo en esas tablas. Lo que el administrador marcó a mano se
// respeta: el recálculo solo retira lo que un perfil trajo y ya ningún perfil
// activo trae, y eso lo sabe gracias a `acceso_perfil_materializado`.
//
// OJO con los nombres: `perfil_acceso_*` (singular, viejo) es acceso POR
// USUARIO; `acceso_perfil*` (nuevo) es el PERFIL como plantilla.
//
// Ver scripts/247_acceso_perfiles.sql.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { exigirAdministradorUsuarios } from "@/lib/seguridad-servidor"
import { updateUserPermissions } from "@/lib/permissions-actions"
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

const FALTA_MIGRACION =
  "Las tablas de perfiles de acceso no existen todavía: hay que correr scripts/247_acceso_perfiles.sql."

function tablaInexistente(e: any): boolean {
  return e?.code === "42P01" || /relation .* does not exist/i.test(String(e?.message ?? ""))
}

function mensajeDe(e: any): string {
  if (tablaInexistente(e)) return FALTA_MIGRACION
  if (e?.code === "23505") return "Ya existe un perfil con ese nombre."
  return e?.message ?? String(e)
}

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
      .from("acceso_perfiles")
      .select("*")
      .order("activo", { ascending: false })
      .order("nombre", { ascending: true })
    if (error) throw error

    // Cuatro consultas chicas y se arma en memoria: son catálogos de decenas
    // de filas, no vale la pena un join que PostgREST haría más frágil.
    const [{ data: emp }, { data: own }, { data: per }, { data: usu }] = await Promise.all([
      sb.from("acceso_perfil_empresas").select("perfil_id, empresa_id"),
      sb.from("acceso_perfil_owners").select("perfil_id, owner"),
      sb.from("acceso_perfil_permisos").select("perfil_id, permiso"),
      sb.from("acceso_perfil_usuarios").select("perfil_id, profile_id"),
    ])

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
    const U = agrupar(usu, (r) => String(r.profile_id))

    const data: PerfilAcceso[] = (cab ?? []).map((c: any) => ({
      id: Number(c.id),
      nombre: c.nombre,
      descripcion: c.descripcion ?? null,
      activo: c.activo !== false,
      created_at: c.created_at,
      updated_at: c.updated_at,
      empresas: E.get(Number(c.id)) ?? [],
      owners: O.get(Number(c.id)) ?? [],
      permisos: P.get(Number(c.id)) ?? [],
      usuarios: (U.get(Number(c.id)) ?? []).length,
    }))

    const usuariosCubiertos = new Set((usu ?? []).map((r: any) => String(r.profile_id))).size
    return { success: true, data, usuariosCubiertos }
  } catch (e: any) {
    if (tablaInexistente(e)) return { success: true, data: [], usuariosCubiertos: 0, faltaMigracion: true }
    console.error("[acceso-perfiles] listar:", e?.message ?? e)
    return { success: false, data: [], usuariosCubiertos: 0, message: mensajeDe(e) }
  }
}

export async function getPerfilesDeUsuario(profileId: string): Promise<number[]> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb.from("acceso_perfil_usuarios").select("perfil_id").eq("profile_id", profileId)
    if (error) throw error
    return (data ?? []).map((r: any) => Number(r.perfil_id))
  } catch (e: any) {
    if (!tablaInexistente(e)) console.error("[acceso-perfiles] perfiles de usuario:", e?.message ?? e)
    return []
  }
}

export async function usuariosDePerfil(perfilId: number): Promise<UsuarioDePerfil[]> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: asig, error } = await sb.from("acceso_perfil_usuarios").select("profile_id").eq("perfil_id", perfilId)
    if (error) throw error
    const ids = (asig ?? []).map((r: any) => String(r.profile_id))
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
export async function plantillaDesdeUsuario(profileId: string): Promise<{ success: boolean; data?: PlantillaAcceso; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const [{ data: emp }, { data: own }, { data: per }] = await Promise.all([
      sb.from("perfil_acceso_empresas").select("empresa_id").eq("profile_id", profileId),
      sb.from("perfil_acceso_owners").select("owner").eq("profile_id", profileId),
      sb.from("permisos_usuarios").select("*").eq("usuario_id", profileId).maybeSingle(),
    ])
    const permisos = per
      ? Object.entries(per)
          .filter(([k, v]) => v === true && CLAVES_PERMISO.has(k))
          .map(([k]) => k)
      : []
    return {
      success: true,
      data: {
        empresas: (emp ?? []).map((r: any) => Number(r.empresa_id)),
        owners: (own ?? []).map((r: any) => String(r.owner)),
        permisos,
      },
    }
  } catch (e: any) {
    return { success: false, message: mensajeDe(e) }
  }
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
    const { data: asig, error: eA } = await sb.from("acceso_perfil_usuarios").select("perfil_id").eq("profile_id", profileId)
    if (eA) throw eA
    const ids = (asig ?? []).map((r: any) => Number(r.perfil_id))
    let activos: number[] = []
    if (ids.length) {
      const { data: per } = await sb.from("acceso_perfiles").select("id").in("id", ids).eq("activo", true)
      activos = (per ?? []).map((r: any) => Number(r.id))
    }

    // 2) Lo que esos perfiles traen (unión).
    const derivE = new Set<number>()
    const derivO = new Set<string>()
    const derivP = new Set<string>()
    if (activos.length) {
      const [{ data: e }, { data: o }, { data: p }] = await Promise.all([
        sb.from("acceso_perfil_empresas").select("empresa_id").in("perfil_id", activos),
        sb.from("acceso_perfil_owners").select("owner").in("perfil_id", activos),
        sb.from("acceso_perfil_permisos").select("permiso").in("perfil_id", activos),
      ])
      for (const r of e ?? []) derivE.add(Number(r.empresa_id))
      for (const r of o ?? []) derivO.add(String(r.owner))
      for (const r of p ?? []) if (CLAVES_PERMISO.has(String(r.permiso))) derivP.add(String(r.permiso))
    }

    // 3) Lo que los perfiles trajeron la última vez, y lo que el usuario tiene hoy.
    const [{ data: mat }, { data: eCur }, { data: oCur }, { data: pCur }] = await Promise.all([
      sb.from("acceso_perfil_materializado").select("tipo, valor").eq("profile_id", profileId),
      sb.from("perfil_acceso_empresas").select("empresa_id").eq("profile_id", profileId),
      sb.from("perfil_acceso_owners").select("owner").eq("profile_id", profileId),
      sb.from("permisos_usuarios").select("*").eq("usuario_id", profileId).maybeSingle(),
    ])
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
      const nuevoMat = [...new Set([...[...prev].filter((x) => deriv.has(x)), ...agregar])]
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

async function recalcularUsuariosDePerfil(sb: any, perfilId: number): Promise<ResultadoRecalculo> {
  const { data } = await sb.from("acceso_perfil_usuarios").select("profile_id").eq("perfil_id", perfilId)
  const ids: string[] = (data ?? []).map((r: any) => String(r.profile_id))
  const errores: string[] = []
  // En serie a propósito: son pocos usuarios y así un fallo se atribuye a uno.
  for (const id of ids) {
    const r = await recalcularAccesoUsuario(id)
    if (!r.success) errores.push(`${id}: ${r.message}`)
  }
  return { usuarios: ids.length, errores }
}

// ---------------------------------------------------------------------------
// Escritura de perfiles
// ---------------------------------------------------------------------------

export async function guardarPerfilAcceso(
  input: PerfilAccesoInput,
): Promise<{ success: boolean; id?: number; message?: string; recalculo?: ResultadoRecalculo }> {
  const motivo = await exigirAdministradorUsuarios("acceso-perfiles.guardar")
  if (motivo) return { success: false, message: motivo }

  const nombre = String(input.nombre ?? "").trim()
  if (!nombre) return { success: false, message: "El perfil necesita un nombre." }
  const empresas = [...new Set((input.empresas ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  const owners = [...new Set((input.owners ?? []).map((o) => String(o ?? "").trim()).filter(Boolean))]
  const permisos = [...new Set((input.permisos ?? []).map(String))]
  // Una clave que no exista como columna haría fallar el recálculo de TODOS
  // los usuarios del perfil, así que se rechaza aquí, con nombre.
  const desconocidos = permisos.filter((k) => !CLAVES_PERMISO.has(k))
  if (desconocidos.length) {
    return { success: false, message: `Permisos que no existen en el sistema: ${desconocidos.join(", ")}.` }
  }

  try {
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)

    let id = input.id ?? null
    if (id) {
      const { error } = await sb
        .from("acceso_perfiles")
        .update({
          nombre,
          descripcion: input.descripcion?.trim() || null,
          activo: input.activo !== false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
      if (error) throw error
    } else {
      const { data, error } = await sb
        .from("acceso_perfiles")
        .insert({
          nombre,
          descripcion: input.descripcion?.trim() || null,
          activo: input.activo !== false,
          creado_por: usuario ?? null,
        })
        .select("id")
        .single()
      if (error) throw error
      id = Number(data.id)
    }

    // Los hijos se reemplazan enteros: es más simple de razonar que un diff y
    // son listas cortas.
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

    // Quien ya tiene el perfil recibe el cambio ahora, no la próxima vez que
    // alguien lo toque.
    const recalculo = await recalcularUsuariosDePerfil(sb, id!)
    return { success: true, id: id!, recalculo }
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
    const { data } = await sb.from("acceso_perfil_usuarios").select("profile_id").eq("perfil_id", id)
    const ids: string[] = (data ?? []).map((r: any) => String(r.profile_id))

    const { error } = await sb.from("acceso_perfiles").delete().eq("id", id)
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
// Asignación a usuarios
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
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)

    const pedidos = [...new Set((perfilIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    let validos: number[] = []
    if (pedidos.length) {
      const { data } = await sb.from("acceso_perfiles").select("id").in("id", pedidos)
      validos = (data ?? []).map((r: any) => Number(r.id))
    }

    const { error: eDel } = await sb.from("acceso_perfil_usuarios").delete().eq("profile_id", profileId)
    if (eDel) throw eDel
    if (validos.length) {
      const { error } = await sb
        .from("acceso_perfil_usuarios")
        .insert(validos.map((perfil_id) => ({ perfil_id, profile_id: profileId, asignado_por: usuario ?? null })))
      if (error) throw error
    }

    return await recalcularAccesoUsuario(profileId)
  } catch (e: any) {
    console.error("[acceso-perfiles] asignar:", e?.message ?? e)
    return { success: false, message: mensajeDe(e) }
  }
}
