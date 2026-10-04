"use server"

// BÚSQUEDA DE REGISTROS para el buscador global (Ctrl+K › sección "Registros"):
// órdenes de cargue (por número o placa) y personas (por nombre o cédula) del
// proyecto activo. Devuelve pocos resultados (máx. 6 por tipo), cada uno con el
// módulo hoja donde se abre YA FILTRADO (evento `lipgo:abrir-registro`, que
// atiende components/main-content.tsx).
//
// Seguridad: el cliente solo pide los tipos cuyos módulos puede ver (Gestión de
// Ordenes, Head Count) y aquí se verifica además que la empresa pedida esté entre
// las accesibles del usuario (perfil_acceso_empresas, igual que orders-actions).
// Nada financiero se busca aquí.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUser, getUserProfile } from "@/lib/auth-actions"
import type { PeriodoListado } from "@/lib/periodo-listados"

export type TipoRegistro = "orden" | "persona"

export interface RegistroEncontrado {
  tipo: TipoRegistro
  /** Identificador estable de la fila (para React). */
  id: string
  titulo: string
  subtitulo: string
  /** Módulo hoja (`name` de lib/dashboard-data.ts) donde se abre. */
  modulo: string
  /** Texto que recibe el filtro inicial del módulo (número de orden o cédula). */
  busqueda: string
  /** Órdenes: período de listado donde cae la orden (Gestión de Ordenes carga 90 días por defecto). */
  periodo?: PeriodoListado
  /** Personas: pestaña de Head Count donde está la persona. */
  tab?: "operativo" | "administrativo"
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
const fechaCorta = (s: string | null | undefined): string => {
  if (!s) return ""
  const [y, m, d] = String(s).slice(0, 10).split("-")
  const mes = MESES[Number(m) - 1]
  return mes && d ? `${d} ${mes}${y ? ` ${y.slice(2)}` : ""}` : String(s).slice(0, 10)
}

function hoyColombiaISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

/** Período de Gestión de Ordenes que incluye una orden con esa `fechaorden`. */
function periodoQueIncluye(fechaorden: string | null | undefined): PeriodoListado | undefined {
  if (!fechaorden) return "todo"
  const dias = Math.floor((Date.parse(hoyColombiaISO()) - Date.parse(String(fechaorden).slice(0, 10))) / 86_400_000)
  if (!Number.isFinite(dias) || dias < 0) return undefined
  if (dias <= 90) return undefined
  if (dias <= 180) return "180"
  if (dias <= 365) return "365"
  return "todo"
}

/** Quita comodines y separadores de PostgREST; acota el largo. */
const limpiar = (q: string) => String(q ?? "").trim().replace(/[%_,()\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40)

/** ¿La empresa pedida está entre las accesibles del usuario de la sesión? */
async function empresaPermitida(sb: any, empresaId: number): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  const profile: any = await getUserProfile(user.id)
  if (!profile?.id) return false
  const { data, error } = await sb.from("perfil_acceso_empresas").select("empresa_id").eq("profile_id", profile.id)
  if (error) return false
  const ids: number[] = (data ?? []).map((r: any) => Number(r.empresa_id))
  if (ids.length === 0) return Number(profile.empresa_id) === empresaId
  return ids.includes(empresaId)
}

export async function buscarRegistros(
  empresaId: number | null | undefined,
  q: string,
  tipos: TipoRegistro[],
): Promise<{ success: boolean; data: RegistroEncontrado[]; message?: string }> {
  const texto = limpiar(q)
  if (!empresaId || texto.length < 2 || !tipos?.length) return { success: true, data: [] }
  try {
    const sb: any = await getSupabaseAdmin()
    if (!(await empresaPermitida(sb, empresaId))) return { success: false, data: [], message: "Sin acceso a la empresa" }
    const patron = `%${texto}%`
    const out: RegistroEncontrado[] = []

    if (tipos.includes("orden")) {
      const cols = "ordendecargue, placa, tipooperacion, fechaorden, fechacargue, iniciocargue, fincargue, status"
      const [porNumero, porPlaca] = await Promise.all([
        sb.from("cabeceraoc").select(cols).eq("idempresa", empresaId).ilike("ordendecargue", patron).order("fechaorden", { ascending: false }).limit(6),
        sb.from("cabeceraoc").select(cols).eq("idempresa", empresaId).ilike("placa", patron).order("fechaorden", { ascending: false }).limit(6),
      ])
      const vistos = new Set<string>()
      const filas: any[] = [...(porNumero.data ?? []), ...(porPlaca.data ?? [])]
        .filter((o) => {
          const k = String(o.ordendecargue)
          if (vistos.has(k)) return false
          vistos.add(k)
          return true
        })
        .sort((a, b) => String(b.fechaorden ?? "").localeCompare(String(a.fechaorden ?? "")))
        .slice(0, 6)
      for (const o of filas) {
        // Mismo criterio que Gestión de Ordenes (getLoadOrders): `status`.
        const estado = o.status === "finalizado" || o.fincargue ? "Finalizada" : o.iniciocargue ? "En proceso" : "Pendiente"
        out.push({
          tipo: "orden",
          id: `orden:${o.ordendecargue}`,
          titulo: `Orden ${o.ordendecargue}${o.placa ? ` · ${o.placa}` : ""}`,
          subtitulo: [o.tipooperacion, estado, fechaCorta(o.fechacargue || o.fechaorden)].filter(Boolean).join(" · "),
          modulo: "Gestión de Ordenes",
          busqueda: String(o.ordendecargue),
          periodo: periodoQueIncluye(o.fechaorden),
        })
      }
    }

    if (tipos.includes("persona")) {
      const cols = "identificacion, nombre, cargo, estado, admin"
      const [porNombre, porCedula] = await Promise.all([
        sb.from("headcount").select(cols).eq("idempresa", empresaId).ilike("nombre", patron).limit(6),
        sb.from("headcount").select(cols).eq("idempresa", empresaId).ilike("identificacion", patron).limit(6),
      ])
      const vistos = new Set<string>()
      const filas: any[] = [...(porCedula.data ?? []), ...(porNombre.data ?? [])]
        .filter((p) => {
          const k = String(p.identificacion)
          if (vistos.has(k)) return false
          vistos.add(k)
          return true
        })
        // Activos primero, luego por nombre.
        .sort((a, b) => Number(b.estado === "Activo") - Number(a.estado === "Activo") || String(a.nombre ?? "").localeCompare(String(b.nombre ?? "")))
        .slice(0, 6)
      for (const p of filas) {
        out.push({
          tipo: "persona",
          id: `persona:${p.identificacion}`,
          titulo: String(p.nombre ?? p.identificacion),
          subtitulo: [`C.C. ${p.identificacion}`, p.cargo || "Sin cargo", p.estado || ""].filter(Boolean).join(" · "),
          modulo: "Head Count",
          busqueda: String(p.identificacion),
          tab: p.admin === true ? "administrativo" : "operativo",
        })
      }
    }

    return { success: true, data: out }
  } catch (e) {
    console.error("[buscarRegistros]", e)
    return { success: false, data: [], message: "No se pudo buscar" }
  }
}
