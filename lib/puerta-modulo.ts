import "server-only"

// PUERTAS DE PERMISO EN EL SERVIDOR: por MÓDULO y por ACCIÓN.
//
// POR QUÉ HACEN FALTA
//
// Una server action es una URL: cualquiera con sesión puede llamarla, aunque la pantalla
// que la usa esté escondida para él. El `<PermissionGuard>` de la interfaz decide qué se
// PINTA, no qué se puede EJECUTAR. Si la acción no vuelve a preguntar por el permiso, el
// candado está solo en la puerta de vidrio.
//
// Ya pasó: hasta el 2026-10-05, `updateUserPermissions` corría con rol de servicio sin
// verificar a quien llamaba, así que cualquiera con sesión podía darse a sí mismo Estado
// de Resultados o Gestión de Usuarios.
//
// DOS NIVELES (plan de políticas por acción, 2026-10-07; catálogo en lib/politicas-modulos.ts)
//
//   · MÓDULO  → `exigirModulo(["Cargos Fijos"])`: tener la llave de la pantalla.
//   · ACCIÓN  → `exigirAccion("Clientes", "crear")`: además, la columna
//               `config_clientes__crear`. Son las acciones SILENCIOSAS: el servidor
//               las exige sin pedir nada.
//   · CON CLAVE → `autorizarAccion("Gestionar pedidos", "anular", { clave })`: la
//               acción es sensible; se valida la clave personal y el perfil
//               (lib/autorizaciones-core.ts). Llamar `exigirAccion` sobre un verbo
//               con clave es un error de programación y lanza `ErrorAccionConClave`.
//
// MODO AVISO. Mientras `autorizacion_config.politicas_acciones_modo` sea 'aviso' (el valor
// con que nace en el SQL 262), un usuario que tiene el módulo pero NO la acción pasa igual
// y queda una fila en `autorizacion_log` con resultado 'aviso_accion'. Así se despliegan
// las puertas sin bloquear a nadie; cuando el log lleva días en cero se cambia a 'bloquear'
// con un UPDATE, sin desplegar. Una columna de acción que todavía NO EXISTE (el 262 sin
// correr) se trata como permitida: el catálogo no puede quitar lo que la base aún no sabe.
//
// ANTES DE PONERLE PUERTA A UN ARCHIVO, CLASIFICA SUS CONSUMIDORES. Es la lección del
// incidente del SQL 221 (4-oct): cerrar `headcount` sin mirar quién la consultaba dejó a
// ID2 sin poder marcar asistencia. Busca quién importa el archivo y comprueba desde qué
// pantallas se llega; si son varias, el módulo de todas va en la lista.
//
// SEGUNDO FACTOR: si la cuenta lo tiene activado, esta sesión debe haberlo verificado.
// Quien no lo tiene activado sigue igual que hoy; ningún permiso cambia.

import { cache } from "react"
import { getCurrentUser } from "@/lib/auth-actions"
import { checkModulePermission, getUserPermissions } from "@/lib/permissions-actions"
import { exigirSegundoFactorSiActivo } from "@/lib/seguridad-servidor"
import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { autorizar } from "@/lib/autorizaciones-core"
import type { ResultadoAutorizacion } from "@/lib/autorizaciones"
import { SEPARADOR_ACCION, type Verbo } from "@/lib/permisos-verbos"
import { etiquetaAccion, llaveDeModulo, nivelDe, procesoDeAccion } from "@/lib/politicas-modulos"

/**
 * Deja pasar si la persona en sesión tiene AL MENOS UNO de los módulos. Si no, lanza.
 *
 * @param modulos  Nombres EXACTOS del menú, tal como aparecen en `MODULE_PERMISSION_MAP`.
 * @param etiqueta Qué se estaba haciendo, para el rastro del segundo factor.
 */
export async function exigirModulo(modulos: string[], etiqueta?: string): Promise<void> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) throw new Error("Sesión requerida.")
  for (const m of modulos) {
    if (await checkModulePermission(m)) {
      await exigirSegundoFactorSiActivo(etiqueta ?? `modulo:${m}`)
      return
    }
  }
  throw new Error(`Sin permiso para ${modulos[0]}.`)
}

/**
 * Igual que `exigirModulo`, pero devuelve un `false` en vez de lanzar. Para acciones que ya
 * contestan `{ success: false, message }` y no quieren que una excepción llegue cruda a la
 * pantalla: en producción Next enmascara los errores lanzados en server actions y el
 * usuario vería un genérico en vez del motivo.
 */
export async function tieneModulo(modulos: string[]): Promise<boolean> {
  try {
    await exigirModulo(modulos)
    return true
  } catch {
    return false
  }
}

// ───────────────────────── acciones ─────────────────────────

/** Se lanza cuando el código exige como silenciosa una acción que el catálogo declara con clave. */
export class ErrorAccionConClave extends Error {
  readonly codigo = "ACCION_CON_CLAVE"
  constructor(modulo: string, verbo: string) {
    super(`"${modulo}" › ${verbo} es una acción con clave: usa autorizarAccion, no exigirAccion.`)
    this.name = "ErrorAccionConClave"
  }
}

export type ModoPoliticas = "aviso" | "bloquear"
export const CONFIG_MODO_POLITICAS = "politicas_acciones_modo"

/** Modo vigente (una lectura por request). Sin fila, sin tabla o con error → 'aviso': nunca se bloquea por un despliegue adelantado. */
const leerModoPoliticas = cache(async (): Promise<ModoPoliticas> => {
  try {
    const sb: any = await getSupabaseAdminAsSystem()
    const { data, error } = await sb.from("autorizacion_config").select("valor").eq("clave", CONFIG_MODO_POLITICAS).maybeSingle()
    if (error) return "aviso"
    return String(data?.valor ?? "").trim() === "bloquear" ? "bloquear" : "aviso"
  } catch {
    return "aviso"
  }
})

export async function modoPoliticas(): Promise<ModoPoliticas> {
  return leerModoPoliticas()
}

const columnasAvisadas = new Set<string>()

type Evaluacion =
  | { ok: true }
  | { ok: false; motivo: string }

/**
 * ¿Puede el usuario en sesión hacer `verbo` en alguno de `modulos`? Regla: tener la
 * llave del módulo (`ver`) y, si `verbo ≠ ver`, la columna `<llave>__<verbo>`. Una
 * acción no declarada en el catálogo NIEGA (es un error del catálogo y se ve en
 * desarrollo). En modo aviso, "módulo sí, acción no" deja rastro y pasa.
 */
async function evaluarAccion(modulos: string[], verbo: Verbo | "ver", etiqueta?: string): Promise<Evaluacion> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { ok: false, motivo: "Sesión requerida." }
  const perms = (await getUserPermissions()) as Record<string, unknown> | null
  if (!perms) return { ok: false, motivo: `Sin permiso para ${modulos[0]}.` }

  // Módulos que el usuario VE pero en los que le falta la acción (columna en false).
  const sinAccion: { modulo: string; columna: string }[] = []

  for (const modulo of modulos) {
    const llave = llaveDeModulo(modulo)
    if (!llave || perms[llave] !== true) continue
    if (verbo === "ver") return { ok: true }

    const nivel = nivelDe(modulo, verbo)
    if (nivel === "clave") throw new ErrorAccionConClave(modulo, verbo)
    if (nivel === null) {
      console.warn(`[politicas] "${modulo}" no declara la acción "${verbo}"; se niega.`)
      continue
    }
    const columna = `${llave}${SEPARADOR_ACCION}${verbo}`
    const valor = perms[columna]
    if (valor === true) return { ok: true }
    if (valor === undefined) {
      // La columna aún no existe en la base (SQL 262 sin correr): el catálogo no
      // puede quitar lo que la base no sabe. Se avisa una vez por proceso.
      if (!columnasAvisadas.has(columna)) {
        columnasAvisadas.add(columna)
        console.warn(`[politicas] la columna ${columna} no existe en permisos_usuarios; se permite. Falta correr el SQL 262.`)
      }
      return { ok: true }
    }
    sinAccion.push({ modulo, columna })
  }

  if (!sinAccion.length) return { ok: false, motivo: `Sin permiso para ${modulos[0]}.` }

  const { modulo, columna } = sinAccion[0]
  const texto = etiqueta ?? etiquetaAccion(modulo, verbo as Verbo)
  if ((await leerModoPoliticas()) === "aviso") {
    void registrarAviso(user.id, user.email ?? null, columna, texto, modulo, verbo as Verbo)
    return { ok: true }
  }
  return { ok: false, motivo: `Sin permiso para ${texto.toLowerCase()} en ${modulo}.` }
}

async function registrarAviso(usuarioId: string, usuario: string | null, columna: string, etiqueta: string, modulo: string, verbo: Verbo) {
  try {
    const sb: any = await getSupabaseAdmin()
    await sb.from("autorizacion_log").insert({
      usuario_id: usuarioId,
      usuario,
      proceso: columna,
      idempresa: null,
      resultado: "aviso_accion",
      referencia: etiqueta,
      detalle: { modulo, verbo, nota: "módulo sí, acción no; modo aviso" },
    })
  } catch (e) {
    console.error("[politicas] no se pudo registrar el aviso:", e)
  }
}

/**
 * Lanza si el usuario no puede hacer `verbo` en ninguno de `modulos`. Equivalente de
 * `exigirModulo` para acciones silenciosas.
 *
 *   await exigirAccion("Clientes", "crear")
 *   await exigirAccion(["Picking", "Packing"], "cerrar", "confirmar picking")
 */
export async function exigirAccion(modulos: string | string[], verbo: Verbo | "ver", etiqueta?: string): Promise<void> {
  const lista = Array.isArray(modulos) ? modulos : [modulos]
  const r = await evaluarAccion(lista, verbo, etiqueta)
  if (!r.ok) throw new Error(r.motivo)
  await exigirSegundoFactorSiActivo(etiqueta ?? `accion:${lista[0]}:${verbo}`)
}

/** `true`/`false` en vez de lanzar (como `tieneModulo`). */
export async function tieneAccion(modulos: string | string[], verbo: Verbo | "ver"): Promise<boolean> {
  try {
    await exigirAccion(modulos, verbo)
    return true
  } catch (e) {
    if (e instanceof ErrorAccionConClave) throw e
    return false
  }
}

/**
 * El motivo por el que no puede, o `null` si puede. Para acciones que responden
 * `{ success: false, message }` (el patrón de `exigirAdministradorUsuarios`).
 *
 *   const motivo = await motivoSinAccion("Bitácora", "eliminar")
 *   if (motivo) return { success: false, message: motivo }
 */
export async function motivoSinAccion(modulos: string | string[], verbo: Verbo | "ver", etiqueta?: string): Promise<string | null> {
  try {
    await exigirAccion(modulos, verbo, etiqueta)
    return null
  } catch (e: any) {
    if (e instanceof ErrorAccionConClave) throw e
    return e?.message || "Sin permiso."
  }
}

/**
 * Nivel B: la acción es CON CLAVE. Exige ver el módulo, resuelve el código de proceso del
 * catálogo y valida la clave personal + perfil con `autorizar`. Se llama DENTRO de la
 * server action del negocio, atómica con la escritura (como hoy en closePendingOrder).
 *
 * Cuando el catálogo declara varios códigos para el verbo (p. ej. aprobar un ajuste 601 o
 * 702), el llamador indica el concreto en `input.proceso`; debe ser uno de la lista.
 */
export async function autorizarAccion(
  modulo: string,
  verbo: Verbo,
  input: { clave: string; idempresa?: number | null; referencia?: string | null; proceso?: string },
): Promise<ResultadoAutorizacion> {
  const ver = await evaluarAccion([modulo], "ver")
  if (!ver.ok) return { ok: false, error: ver.motivo }

  const declarado = procesoDeAccion(modulo, verbo)
  if (!declarado) {
    return { ok: false, error: `"${modulo}" › ${verbo} no es una acción con clave en el catálogo.` }
  }
  let proceso: string
  if (Array.isArray(declarado)) {
    if (!input.proceso || !declarado.includes(input.proceso)) {
      return { ok: false, error: `Indica cuál proceso autorizar: ${declarado.join(", ")}.` }
    }
    proceso = input.proceso
  } else {
    proceso = declarado as string
  }
  return autorizar({
    proceso,
    idempresa: input.idempresa ?? null,
    clave: input.clave,
    referencia: input.referencia ?? `${modulo} › ${etiquetaAccion(modulo, verbo)}`,
  })
}
