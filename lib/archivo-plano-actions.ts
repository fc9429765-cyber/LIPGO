"use server"

/**
 * Lectura del ARCHIVO PLANO (Nómina personal › pestaña "Archivo plano").
 *
 * POR QUÉ EXISTE ESTE ARCHIVO — la pestaña consultaba `archivoplano` DESDE EL
 * NAVEGADOR y se caía siempre con:
 *
 *     code 57014 — "canceling statement due to statement timeout"
 *
 * `archivoplano` se construye sobre `pagonomina`, que arma un calendario
 * persona×día y lo cruza contra headcount, tarifas y parámetros legales. Es una
 * consulta cara, y Supabase le da a los roles del navegador (`anon` /
 * `authenticated`) un `statement_timeout` corto — del orden de 8 segundos —
 * mientras que el rol de servicio tiene un margen mucho mayor. De ahí que en el
 * editor SQL de Supabase los datos SÍ se vieran: ese editor no consulta con el
 * rol del navegador.
 *
 * Los otros SIETE módulos que leen `pagonomina` (revisión de nómina, cierre
 * financiero, parafiscales, liquidaciones, conciliación Avimol, análisis
 * financiero, cierre diario) ya lo hacen desde el servidor con
 * `getSupabaseAdmin`. Esta pestaña era la excepción, y por eso era la que
 * fallaba.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { autorizarAccion } from "@/lib/puerta-modulo"

export interface FilaArchivoPlano {
  identificacionempleado: string | null
  nombreempleado: string | null
  contratoempleado: string | null
  nombrenovedad: string | null
  tiponovedad: string | null
  cantidadvalor: number | null
  nominaproyectada: number | null
  fechainicio: string | null
  fechafin: string | null
  diasnohabiles: number | null
  mes: string | null
  quincena: number | null
}

const COLUMNAS =
  "identificacionempleado, nombreempleado, contratoempleado, nombrenovedad, tiponovedad, cantidadvalor, nominaproyectada, fechainicio, fechafin, diasnohabiles, mes, quincena"

/** Año al que pertenece el mes elegido en la pestaña (que no pide año): la
 * ocurrencia MÁS RECIENTE de ese mes en hora de Bogotá. En enero-2027, "12"
 * es diciembre-2026. Antes la vista se filtraba solo por `mes`, así que
 * mezclaba el mismo mes de años distintos en cuanto hubiera más de un año. */
function anioDelMes(mes: number): number {
  const [anioHoy, mesHoy] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number)
  return mes <= mesHoy ? anioHoy : anioHoy - 1
}

/**
 * Trae el archivo plano de una empresa, opcionalmente acotado a un mes y una
 * quincena.
 *
 * El mes se compara como "8" Y como "08": la columna es TEXT y puede venir de un
 * `to_char(...,'MM')`, así que el filtro no debería depender de ese detalle.
 */
export async function getArchivoPlano(
  idempresa: number,
  mes?: string | null,
  quincena?: string | null,
  clave?: string,
): Promise<{ success: boolean; data: FilaArchivoPlano[]; message?: string }> {
  // Acción CON CLAVE (nom_archivo_plano): el archivo plano es lo que se carga al banco.
  // En modo aviso pasa sin clave y deja rastro; en bloquear la pantalla pide la clave.
  const autorizacionAccion = await autorizarAccion("Nominapersonal", "exportar", { clave: clave ?? "", idempresa: idempresa || null, referencia: `archivo plano ${mes ?? ""} ${quincena ?? ""}`.trim() })
  if (!autorizacionAccion.ok) return { success: false, data: [], message: autorizacionAccion.error || "Sin autorización." }
  if (!idempresa) return { success: false, data: [], message: "Selecciona una empresa." }

  try {
    const admin: any = await getSupabaseAdmin()

    const filas: FilaArchivoPlano[] = []
    const pageSize = 1000

    const m = String(mes ?? "").trim()
    const n = m ? Number(m) : null

    for (let offset = 0; ; offset += pageSize) {
      // Con mes: `archivoplano_periodo` (scripts/201) calcula SOLO ese mes —
      // mismo plano que la vista, verificado fila por fila — en vez de armar
      // toda la historia y filtrar después. Sin mes ("Todos"): la vista
      // completa, como antes; es la única forma de ver todo el histórico.
      let q = (n ? admin.rpc("archivoplano_periodo", { p_anio: anioDelMes(n), p_mes: n }) : admin.from("archivoplano"))
        .select(COLUMNAS)
        .eq("idempresa", idempresa)

      if (n) q = q.in("mes", [String(n), String(n).padStart(2, "0")])
      const qn = String(quincena ?? "").trim()
      if (qn) q = q.eq("quincena", Number(qn))

      // Tercer criterio = cédula (el mismo con el que la vista ordena sus filas):
      // sin él, el orden dentro de una quincena quedaba al azar del motor y
      // podía cambiar entre una consulta y otra.
      const { data, error } = await q
        .order("mes", { ascending: false })
        .order("quincena", { ascending: false })
        .order("identificacionempleado", { ascending: true })
        // ...y novedad + fecha: una persona tiene varias filas por quincena, y
        // sin orden único la paginación puede duplicar/perder filas en los
        // cortes de página (ver lib/liquidaciones-actions.ts).
        .order("nombrenovedad")
        .order("fechainicio")
        .range(offset, offset + pageSize - 1)

      if (error) {
        console.error("[v0] getArchivoPlano error:", error.message, error.code)
        return {
          success: false,
          data: [],
          message: [error.message, error.code ? `(${error.code})` : null].filter(Boolean).join(" "),
        }
      }
      if (!data || data.length === 0) break
      filas.push(...(data as FilaArchivoPlano[]))
      if (data.length < pageSize) break
    }

    return { success: true, data: filas }
  } catch (e: any) {
    console.error("[v0] getArchivoPlano exception:", e?.message)
    return { success: false, data: [], message: e?.message || "Error al cargar el archivo plano." }
  }
}
