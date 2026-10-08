import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesionApi } from "@/lib/puerta-api"

// Render dinamico: la asistencia cambia varias veces durante el dia
// (registros nuevos, novedades, asignaciones), un cache stale daria
// alertas falsas o desactualizadas.
export const dynamic = "force-dynamic"
export const revalidate = 0

// Considera null/undefined/empty como "sin valor". Igual criterio que
// /api/attendance/table/route.ts para mantener consistencia.
function hasValue(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== ""
}

/**
 * Devuelve dos listas de alertas para la TopBar:
 *
 *  - `pendientes`: personas activas del headcount cuya fila del dia NO
 *    esta procesada. La regla coincide con /api/attendance/table:
 *      Presente (tiene `asistencia.hora`):
 *        procesado <=> registroasistencia tiene `puesto` o `asistencia`
 *        no vacios.
 *      Ausente (sin `asistencia.hora`):
 *        procesado <=> registroasistencia tiene `asistencia` (codigo
 *        de novedad) no vacio.
 *
 *  - `sinSalida`: personas que tienen `hora` (llegaron) pero su fila
 *    de `registroasistencia` no tiene `horasalida`. Solo aplica para
 *    personas presentes — un Ausente con novedad nunca deberia tener
 *    salida.
 */
export async function GET(request: Request) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    if (!empresaId) {
      return NextResponse.json({ pendientes: [], sinSalida: [] })
    }

    const supabaseAdmin = await getSupabaseAdmin()

    // Fecha actual en zona Bogota -> YYYY-MM-DD
    const colombiaDate = new Date()
      .toLocaleString("en-CA", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .split(",")[0]

    // 1) Headcount activos, SIN administrativos: no marcan turno, asi que
    //    alertar por su "inasistencia" seria una alarma permanente y falsa.
    const { data: headcount, error: hcErr } = await supabaseAdmin
      .from("headcount")
      .select("identificacion, nombre")
      .eq("idempresa", empresaId)
      .eq("estado", "Activo")
      .not("admin", "is", true)
      .order("nombre", { ascending: true })

    if (hcErr) {
      console.error("[v0] asistencia-alerts headcount error:", hcErr)
      return NextResponse.json({ pendientes: [], sinSalida: [] })
    }

    // 2) Asistencia del dia
    const { data: asistencia, error: asErr } = await supabaseAdmin
      .from("asistencia")
      .select("identificacion, hora")
      .eq("idempresa", empresaId)
      .eq("fecha", colombiaDate)

    if (asErr) {
      console.error("[v0] asistencia-alerts asistencia error:", asErr)
    }

    // 3) registroasistencia del dia (puesto / asistencia / horasalida)
    const { data: registros, error: regErr } = await supabaseAdmin
      .from("registroasistencia")
      .select("identificacion, nombre, puesto, asistencia, horasalida")
      .eq("idempresa", empresaId)
      .eq("fecha", colombiaDate)

    if (regErr) {
      console.error("[v0] asistencia-alerts registro error:", regErr)
    }

    const horaPorId = new Map<string, string | null>()
    for (const r of asistencia ?? []) {
      horaPorId.set(r.identificacion as string, (r.hora as string) ?? null)
    }

    // Llave compuesta identificacion+nombre normalizada (mismo
    // criterio que /api/attendance/table)
    const normalizeName = (n: string | null) => (n ?? "").trim().toLowerCase()
    const shiftKey = (id: string, n: string | null) =>
      `${(id ?? "").trim()}|${normalizeName(n)}`

    const shiftMap = new Map<
      string,
      {
        puesto: string | null
        asistencia: string | null
        horasalida: string | null
      }
    >()
    for (const s of registros ?? []) {
      shiftMap.set(shiftKey(s.identificacion as string, s.nombre as string), {
        puesto: s.puesto as string | null,
        asistencia: s.asistencia as string | null,
        horasalida: s.horasalida as string | null,
      })
    }

    const pendientes: { identificacion: string; nombre: string }[] = []
    const sinSalida: {
      identificacion: string
      nombre: string
      horaLlegada: string
    }[] = []

    for (const p of headcount ?? []) {
      const id = p.identificacion as string
      const nombre = (p.nombre as string) ?? ""
      const hora = horaPorId.get(id) ?? null
      const isPresent = hasValue(hora)
      const shift = shiftMap.get(shiftKey(id, nombre))

      const procesado = shift
        ? isPresent
          ? hasValue(shift.puesto) || hasValue(shift.asistencia)
          : hasValue(shift.asistencia)
        : false

      if (!procesado) {
        pendientes.push({ identificacion: id, nombre })
      }

      // Solo presentes pueden tener "sin salida"
      if (isPresent && !hasValue(shift?.horasalida)) {
        sinSalida.push({
          identificacion: id,
          nombre,
          horaLlegada: hora as string,
        })
      }
    }

    return NextResponse.json({ pendientes, sinSalida })
  } catch (err) {
    console.error("[v0] asistencia-alerts unhandled error:", err)
    return NextResponse.json({ pendientes: [], sinSalida: [] })
  }
}
