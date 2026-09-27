"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentUser, getUserProfile } from "@/lib/auth-actions"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import type {
  DashboardPedidosData,
  PedidoCabecera,
  PedidoDetalle,
} from "@/components/orders/dashboard-pedidos/types"

/**
 * Server action especifico del Dashboard Pedidos.
 *
 * Devuelve dos arrays con TODOS los registros de pedidoscabecera y
 * pedidosdetalle filtrados por las empresas accesibles al usuario
 * (perfil_acceso_empresas) y, si aplica, por sus owners
 * (perfil_acceso_owners). Los calculos puros se hacen en el cliente.
 *
 * Cambios recientes:
 *   - Paginacion real: hacemos loop de paginas de 1000 hasta agotar el
 *     resultado, en vez de un unico `.range(0, 49_999)`. Esto elimina el
 *     limite practico de 1000 que tenia Supabase por default y permite
 *     analizar el historico completo (no solo los ultimos 1000 pedidos).
 *   - El filtro de empresa seleccionada en la UI se coerciona a Number
 *     antes del `.includes`, porque `useAuth().selectedEmpresaId`
 *     puede venir como string desde el contexto.
 *   - Hard-cap de seguridad para que un bug en BD no genere un fetch
 *     infinito: HARD_CAP detiene la paginacion a las 500.000 filas.
 */

// Tamaño de pagina por consulta. Supabase impone un limite por defecto
// de 1000 filas por SELECT; sobre eso hay que paginar con `.range()`.
const PAGE_SIZE = 1000

// Tamaño de chunk para `.in("idpedido", [...])`. Listas demasiado largas
// degradan el plan, asi que partimos en grupos de 1000 ids.
const IDPEDIDO_CHUNK = 1000

// Hard-cap defensivo: si por alguna razon la paginacion no termina en
// las primeras 500k filas, cortamos para evitar fetch infinito.
const HARD_CAP = 500_000

async function getAccessibleEmpresas(): Promise<number[]> {
  const supabase = await createClient()
  try {
    const user = await getCurrentUser()
    if (!user) return [1]
    const profile = await getUserProfile(user.id)
    if (!profile?.id) return [1]

    const { data, error } = await supabase
      .from("perfil_acceso_empresas")
      .select("empresa_id")
      .eq("profile_id", profile.id)

    if (error || !data) {
      const fallback = await getCurrentEmpresaIdForInsert()
      return [fallback]
    }
    const ids = data
      .map((r: any) => Number(r.empresa_id))
      .filter((n) => Number.isFinite(n))
    if (ids.length === 0) {
      const fallback = await getCurrentEmpresaIdForInsert()
      return [fallback]
    }
    return ids
  } catch {
    return [1]
  }
}

async function getAccessibleOwners(): Promise<string[]> {
  const supabase = await createClient()
  try {
    const user = await getCurrentUser()
    if (!user) return []
    const profile = await getUserProfile(user.id)
    if (!profile?.id) return []

    const { data, error } = await supabase
      .from("perfil_acceso_owners")
      .select("owner")
      .eq("profile_id", profile.id)

    if (error || !data) return []
    return data.map((r: any) => r.owner)
  } catch {
    return []
  }
}

/**
 * Fetcher generico paginado. Recibe un builder de query (sin .range,
 * sin .order final) y va trayendo paginas de PAGE_SIZE hasta que la
 * respuesta sea menor a una pagina (lo que indica que se agoto). Asi
 * elimina el techo de 1000 filas del default de Supabase.
 *
 * IMPORTANTE: el builder DEBE aplicar el mismo .order() en cada
 * iteracion para que la paginacion sea estable.
 */
async function fetchAllPaginated<T>(
  buildQuery: () => any,
): Promise<{ rows: T[]; error: any | null }> {
  const out: T[] = []
  let offset = 0
  while (offset < HARD_CAP) {
    const query = buildQuery().range(offset, offset + PAGE_SIZE - 1)
    const { data, error } = await query
    if (error) return { rows: out, error }
    if (!data || data.length === 0) break
    out.push(...(data as T[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return { rows: out, error: null }
}

export async function getDashboardPedidosData(
  selectedEmpresaId?: number | string | null,
): Promise<{ success: boolean; data?: DashboardPedidosData; message?: string }> {
  try {
    const supabase = await createClient()
    const accessibleEmpresas = await getAccessibleEmpresas()
    const accessibleOwners = await getAccessibleOwners()

    // Coercion segura: el contexto de auth puede entregar el id como
    // string ("5") y `accessibleEmpresas` es number[].
    const cleanedEmpresaId =
      selectedEmpresaId != null ? Number(selectedEmpresaId) : null
    const isValidSelected =
      cleanedEmpresaId !== null &&
      Number.isFinite(cleanedEmpresaId) &&
      accessibleEmpresas.includes(cleanedEmpresaId)

    // ---- 1. Cabecera (paginada) ----------------------------------------
    const { rows: cabeceraRaw, error: cabError } = await fetchAllPaginated<
      PedidoCabecera
    >(() => {
      let q = supabase
        .from("pedidoscabecera")
        .select("*")
        .order("idpedido", { ascending: false })

      if (isValidSelected) {
        q = q.eq("id_empresa", cleanedEmpresaId)
      } else {
        q = q.in("id_empresa", accessibleEmpresas)
      }
      if (accessibleOwners.length > 0) {
        q = q.in("empresafactura", accessibleOwners)
      }
      // Filtro de negocio: el dashboard NO debe contar pedidos
      // anulados. La columna `estado` puede tener variaciones de
      // mayusculas/minusculas y espacios ("Anulado", "ANULADO",
      // " anulado "), asi que usamos `ilike` con comodines en
      // negacion para cubrir cualquier forma. Las filas con
      // `estado IS NULL` se conservan: PostgREST filtra usando
      // logica trivaluada y `NULL ILIKE ...` es desconocido (no
      // verdadero) por lo que la negacion las excluye; por eso
      // anadimos el OR explicito sobre `estado.is.null` para
      // dejarlas pasar.
      q = q.or("estado.is.null,estado.not.ilike.%anulado%")
      return q
    })

    if (cabError) {
      console.error("[v0] dashboard-pedidos: cabecera error", cabError)
      return { success: false, message: cabError.message }
    }

    const cabecera = cabeceraRaw

    // ---- 2. Detalle (chunks por idpedido + paginacion por chunk) -------
    const empresaFilter = isValidSelected
      ? [cleanedEmpresaId as number]
      : accessibleEmpresas
    const idpedidos = cabecera.map((c) => c.idpedido).filter(Boolean)

    const detalle: PedidoDetalle[] = []
    for (let i = 0; i < idpedidos.length; i += IDPEDIDO_CHUNK) {
      const chunk = idpedidos.slice(i, i + IDPEDIDO_CHUNK)

      // Cada chunk se pagina internamente: un mismo set de 1000
      // idpedidos puede tener mucho mas de 1000 lineas de detalle, asi
      // que reusamos `fetchAllPaginated` aqui tambien.
      const { rows: chunkRows, error: detError } = await fetchAllPaginated<
        PedidoDetalle
      >(() =>
        supabase
          .from("pedidosdetalle")
          .select("*")
          .in("id_empresa", empresaFilter)
          .in("idpedido", chunk)
          .order("idpedido", { ascending: false })
          // Un pedido tiene varias líneas: desempate para que la paginación
          // sea estable (ver lib/orden-paginacion.ts).
          .order("producto")
          .order("transid"),
      )

      if (detError) {
        console.error("[v0] dashboard-pedidos: detalle error", detError)
        return { success: false, message: detError.message }
      }
      if (chunkRows.length > 0) detalle.push(...chunkRows)
    }

    return {
      success: true,
      data: { cabecera, detalle },
    }
  } catch (error: any) {
    console.error("[v0] dashboard-pedidos: unexpected error", error)
    return {
      success: false,
      message: error?.message || "Error inesperado al cargar el dashboard",
    }
  }
}
