import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { exigirSesionApi } from "@/lib/puerta-api"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Devuelve la fecha actual en zona horaria America/Bogota como
 * `YYYY-MM-DD`. Misma logica que `getColombiaDate` en
 * `lib/dashboard-actions.ts` para mantener consistencia entre la
 * tabla de Operaciones del Dia y esta alerta.
 */
function getColombiaDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

/**
 * Extrae solo la parte de fecha (YYYY-MM-DD) tolerando formatos
 * mezclados (DATE plano vs TIMESTAMP) que conviven en
 * `dashboardoperaciones.fechacargue`.
 */
function extractIsoDate(value: string | null | undefined): string | null {
  if (!value) return null
  const s = String(value).trim()
  if (s.length >= 10) return s.substring(0, 10)
  return null
}

/**
 * Verifica si un campo de tiempo (columna TIME en Postgres) tiene un
 * valor real cargado por el usuario. No basta con `!= null` porque
 * algunos defaults guardan `"00:00:00"` y eso debe tratarse como
 * "sin valor" para la alerta de cierre de operaciones.
 */
function hasTimeValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  const s = String(v).trim()
  if (s === "") return false
  if (s === "00:00:00" || s === "00:00") return false
  return true
}

/**
 * Alerta para "Operaciones del Dia": vehiculos cuya fila del dia no
 * tiene `iniciocargue` (Ini.Op) o no tiene `fincargue` (Fin.Op).
 *
 * Cambios:
 * - Antes la query no filtraba por fecha y mezclaba ordenes
 *   historicas, lo que disolvia las del dia actual en el `slice(0,
 *   50)` y hacia que la alerta no apareciera para casos visibles en
 *   el dashboard de hoy. Ahora replicamos el patron del dashboard
 *   (`getDashboardOperacionesData`): filtramos en JS por la parte de
 *   fecha de `fechacargue` para tolerar formatos mezclados.
 * - El check de "valor presente" ahora ignora `"00:00:00"`, que es
 *   el default que algunas filas guardan en la columna TIME y que
 *   antes hacia que `fincargue` pareciera "lleno" cuando en realidad
 *   nunca se cerro la operacion.
 */
export async function GET(request: Request) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    if (!empresaId) return NextResponse.json({ alerts: [] })

    const fechaFiltro = searchParams.get("fecha") || getColombiaDate()

    // FILTRO DE FECHA EN SQL — mismo bug que tenían las tarjetas del dashboard:
    // sin él se pedía toda la historia de la empresa, Supabase cortaba en 1000
    // filas y devolvía las más antiguas, así que las órdenes del día quedaban
    // fuera y la alerta no se disparaba. Rango [fecha, fecha+1) para tolerar
    // DATE y TIMESTAMP; el filtro en JS de abajo queda como red de seguridad.
    const finDia = new Date(`${fechaFiltro}T00:00:00Z`)
    finDia.setUTCDate(finDia.getUTCDate() + 1)
    const fechaSiguiente = finDia.toISOString().slice(0, 10)

    const { data, error } = await supabase
      .from("dashboardoperaciones")
      .select(
        "ordendecargue, cliente, placa, tipooperacion, iniciocargue, fincargue, estado, fechacargue",
      )
      .eq("idempresa", parseInt(empresaId, 10))
      .gte("fechacargue", fechaFiltro)
      .lt("fechacargue", fechaSiguiente)

    if (error) {
      console.error("[v0] operaciones-dia-alerts error:", error)
      return NextResponse.json({ alerts: [] })
    }

    // 1) Filtrar al dia operativo (mismo criterio que el dashboard).
    const delDia = (data ?? []).filter(
      (op) => extractIsoDate(op.fechacargue) === fechaFiltro,
    )

    // 2) Quedan los vehiculos a los que les falte Ini.Op o Fin.Op.
    const alerts = delDia
      .filter(
        (op) => !hasTimeValue(op.iniciocargue) || !hasTimeValue(op.fincargue),
      )
      .map((op) => {
        const faltaIni = !hasTimeValue(op.iniciocargue)
        const faltaFin = !hasTimeValue(op.fincargue)
        let motivo = ""
        if (faltaIni && faltaFin) motivo = "Sin Ini.Op y Fin.Op"
        else if (faltaIni) motivo = "Sin Ini.Op"
        else motivo = "Sin Fin.Op"
        return {
          ordendecargue: op.ordendecargue ?? "",
          cliente: op.cliente ?? "Sin cliente",
          placa: op.placa ?? "",
          tipooperacion: op.tipooperacion ?? "",
          estado: op.estado ?? "",
          faltaIni,
          faltaFin,
          motivo,
        }
      })

    return NextResponse.json({ alerts })
  } catch (err) {
    console.error("[v0] operaciones-dia-alerts unhandled:", err)
    return NextResponse.json({ alerts: [] })
  }
}
