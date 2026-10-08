import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase-server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { procesarNovedadRetiro } from "@/lib/retiro-actions"
import { sincronizarBorradorAusentismo } from "@/lib/ausentismos-actions"
import { exigirAccionApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const empresaId = searchParams.get("empresaId")
    const dateParam = searchParams.get("date")

    if (!empresaId) {
      return NextResponse.json({ error: "empresaId es requerido" }, { status: 400 })
    }

    const supabase = await createServerClient()

    // Get the date to filter by (from parameter or today)
    let filterDate = dateParam

    if (!filterDate) {
      const today = new Date().toLocaleString("en-US", {
        timeZone: "America/Bogota",
      })
      const colombiaDate = new Date(today)
      filterDate = colombiaDate.toISOString().split("T")[0]
    }

    console.log("[v0] Fetching personnel notices for date:", filterDate)

    // Traemos los registros de `registroasistencia` que aun NO tienen
    // codigo de novedad asignado (`asistencia IS NULL`) y que ademas
    // NO tienen `puesto` asignado (`puesto IS NULL`). La regla de
    // negocio es: si la persona ya tiene puesto para ese dia, no debe
    // aparecer en el listado de novedades pendientes — independiente
    // de si esta marcada como Presente o Ausente en `asistencia`.
    //
    // Tambien filtramos `especialidad = false` para excluir turnos de
    // especialidad que no necesitan novedad (su puesto y especialidad
    // ya los definen).
    const { data, error } = await supabase
      .from("registroasistencia")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("fecha", filterDate)
      .eq("especialidad", false)
      .is("asistencia", null)
      .is("puesto", null)

    if (error) {
      console.error("[v0] Error fetching personnel notices:", error)
      return NextResponse.json({ error: "Error al cargar las novedades" }, { status: 500 })
    }

    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    console.error("[v0] Error in GET /api/personnel-notices:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const puerta = await exigirAccionApi(["Novedades de personal", "Tabla Asistencia"], "crear")
  if (puerta) return puerta
  try {
    const body = await request.json()
    const { records, dateRange, empresaId } = body

    if (!records || !Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: "No hay registros para procesar" }, { status: 400 })
    }

    const supabaseAdmin = await getSupabaseAdmin()

    // Get today's date in Colombia timezone
    const today = new Date().toLocaleString("en-US", {
      timeZone: "America/Bogota",
    })
    const colombiaDate = new Date(today)
    const todayDate = colombiaDate.toISOString().split("T")[0]

    // Update today's records.
    //
    // Ademas de asentar el codigo de novedad en `asistencia`, limpiamos
    // `puesto` y `horasturno` por dos razones:
    //   1) Si la fila habia sido pre-asignada con un puesto y al final
    //      la persona quedo Ausente, el puesto deja de aplicar; mantenerlo
    //      distorsionaria los dashboards y los reportes operativos.
    //   2) Cierra la fila en un estado coherente para metricas: una
    //      novedad valida es {puesto = null, asistencia = <codigo>}.
    //
    // `especialidad` la forzamos a false porque una novedad no es un
    // turno de especialidad; si la fila quedo con `true` por un flujo
    // previo, lo corregimos aqui.
    const updatePromises = records.map((record: any) =>
      supabaseAdmin
        .from("registroasistencia")
        .update({
          asistencia: record.asistencia,
          puesto: null,
          horasturno: null,
          especialidad: false,
        })
        .eq("id", record.id),
    )

    const updateResults = await Promise.all(updatePromises)

    // Check for errors in updates
    const updateErrors = updateResults.filter((result) => result.error)
    if (updateErrors.length > 0) {
      console.error("[v0] Error updating records:", updateErrors)
      return NextResponse.json({ error: "Error al actualizar los registros" }, { status: 500 })
    }

    // Efecto automático: cada registro marcado como "Retiro" da de baja al
    // trabajador (Inactivo + fecha de retiro + fuera del plano). La fecha de
    // retiro es la de la novedad (record.fecha) o, si no viene, hoy (Colombia).
    for (const record of records) {
      if (String(record.asistencia || "").toLowerCase().includes("retiro")) {
        await procesarNovedadRetiro({
          identificacion: record.identificacion,
          fecha: record.fecha || todayDate,
          asistencia: record.asistencia,
          idempresa: empresaId,
        })
      }
    }

    // If dateRange is provided, create future records
    if (dateRange && dateRange.startDate && dateRange.endDate) {
      const startDate = new Date(dateRange.startDate)
      const endDate = new Date(dateRange.endDate)
      
      // Set end date to end of day (23:59:59) to include the entire last day
      endDate.setHours(23, 59, 59, 999)

      // Only create records for dates after today
      const tomorrow = new Date(colombiaDate)
      tomorrow.setDate(tomorrow.getDate() + 1)

      if (endDate > colombiaDate) {
        const futureRecords = []

        // Create records for each person and each date in range. NO fijamos `id`:
        // registroasistencia.id es SERIAL y Postgres lo asigna vía la secuencia.
        // Fijar el id a mano (max+1) NO avanza la secuencia y colisiona con los
        // inserts que usan nextval (turnos, programación) y con guardados simultáneos.
        for (const record of records) {
          const currentDate = new Date(Math.max(tomorrow.getTime(), startDate.getTime()))

          while (currentDate.toISOString().split("T")[0] <= endDate.toISOString().split("T")[0]) {
            const dateStr = currentDate.toISOString().split("T")[0]

            console.log("[v0] Creating future record - nombre:", record.nombre, "identificacion:", record.identificacion)

            // Contrato de "fila de novedad" en `registroasistencia`:
            //   { asistencia: <codigo>, puesto: null, horasturno: null,
            //     especialidad: false }
            //
            // Lo aplicamos identico al UPDATE de la fila del dia
            // seleccionado para que, sin importar si la fecha es la
            // actual o una futura, una novedad SIEMPRE quede con el
            // puesto en null. Esto evita estados ambiguos donde la
            // persona aparece con codigo de novedad pero todavia con
            // un puesto previo, que distorsiona los reportes y rompe
            // las reglas de "Procesado" del modulo Tabla Asistencia.
            futureRecords.push({
              idempresa: empresaId,
              fecha: dateStr,
              nombre: record.nombre,
              identificacion: record.identificacion,
              asistencia: record.asistencia,
              puesto: null,
              horasturno: null,
              especialidad: false,
            })

            currentDate.setDate(currentDate.getDate() + 1)
          }
        }

        if (futureRecords.length > 0) {
          const { error: insertError } = await supabaseAdmin.from("registroasistencia").insert(futureRecords)

          if (insertError) {
            console.error("[v0] Error inserting future records:", insertError)
            return NextResponse.json({ error: "Error al crear registros futuros" }, { status: 500 })
          }
        }
      }
    }

    // Puente automático: reconciliar los borradores de ausentismo de las personas
    // afectadas (incapacidad/licencia → crea/actualiza borrador; vacaciones/otros →
    // no aplica). Idempotente; una novedad de N días converge a UN episodio.
    try {
      const ids = Array.from(new Set(records.map((r: any) => r.identificacion).filter(Boolean)))
      const refDates = new Set<string>()
      for (const r of records) refDates.add(String(r.fecha || todayDate).slice(0, 10))
      if (dateRange?.startDate) refDates.add(new Date(dateRange.startDate).toISOString().slice(0, 10))
      if (dateRange?.endDate) refDates.add(new Date(dateRange.endDate).toISOString().slice(0, 10))
      const fechas = Array.from(refDates)
      await Promise.all(
        ids.flatMap((id: any) => fechas.map((f) => sincronizarBorradorAusentismo(Number(empresaId), String(id), f))),
      )
    } catch (e) {
      console.error("[v0] sync borrador ausentismo (personnel-notices):", e)
    }

    return NextResponse.json({
      success: true,
      message: "Novedades registradas exitosamente",
    })
  } catch (error) {
    console.error("[v0] Error in POST /api/personnel-notices:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
