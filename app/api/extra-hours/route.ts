import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase-server"
import { exigirAccionApi } from "@/lib/puerta-api"

/**
 * GET /api/extra-hours?empresaId=X&fecha=YYYY-MM-DD
 *
 * Módulo "Aprobación horas Éxtra".
 *
 * Devuelve los registros de `registroasistencia` marcados como
 * especialidad ("true") para la empresa y fecha indicadas, y los cruza
 * contra la tabla `solicitud_horas_extras` (la programación de horas
 * extra) para determinar si cada hora extra ejecutada estaba
 * efectivamente programada.
 *
 * El cruce se hace por:
 *   registroasistencia.fecha   <-> solicitud_horas_extras.fecharequerida
 *   registroasistencia.idempresa <-> solicitud_horas_extras.idempresa
 *   registroasistencia.nombre  <-> solicitud_horas_extras.nombre_empleado
 *
 * Cuando un registro de asistencia con horas extra NO encuentra una
 * solicitud programada que coincida, se marca con `programada = false`
 * para que el front muestre la alerta "Hora extra no programada".
 */

// Normaliza nombres para un match robusto (sin importar mayúsculas ni
// espacios sobrantes), ya que las dos tablas pueden tener el nombre
// escrito con ligeras diferencias de formato.
function normalizar(valor: unknown): string {
  return String(valor ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

// Determina si un campo de hora extra (hed/hedf/hen/hef/hn) tiene un
// valor "real". Se considera vacío: null, undefined, cadena vacía o un
// valor que numéricamente sea 0. Solo basta con que UNO de estos
// campos tenga valor para que el registro deba traerse.
function tieneValor(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false
  const texto = String(valor).trim()
  if (texto === "") return false
  return Number(texto) !== 0
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    const fechaParam = searchParams.get("fecha")

    if (!empresaId) {
      return NextResponse.json({ error: "empresaId es requerido" }, { status: 400 })
    }

    // Fecha por defecto: hoy en zona horaria de Colombia.
    const colombiaDate = new Date().toLocaleString("en-US", {
      timeZone: "America/Bogota",
    })
    const fecha = fechaParam || new Date(colombiaDate).toISOString().split("T")[0]

    const supabase = await createServerClient()

    // 1) Registros de asistencia (horas extra ejecutadas) de especialidad.
    const { data: asistencia, error: asistenciaError } = await supabase
      .from("registroasistencia")
      .select(
        "id, fecha, nombre, identificacion, puesto, hed, hedf, hen, hef, hn, horaentradaprogramada, horasalidaprogramada, horaingreso, horasalida, aprobado",
      )
      .eq("especialidad", "true")
      .eq("fecha", fecha)
      .eq("idempresa", empresaId)
      // Al menos uno de los campos de horas extra debe ser no nulo.
      // (El filtro fino de "vacío"/0/"" se aplica luego en JS, ya que
      // estas columnas pueden contener cadenas vacías además de null.)
      .or("hed.not.is.null,hedf.not.is.null,hen.not.is.null,hef.not.is.null,hn.not.is.null")
      .order("id", { ascending: true })

    if (asistenciaError) {
      console.error("[v0] Error fetching registroasistencia:", asistenciaError)
      return NextResponse.json({ error: "Error al obtener registros" }, { status: 500 })
    }

    // 2) Programación de horas extra para esa empresa/fecha. Cada fila es UNA
    // persona con las horas que le tocaron del reparto que hizo la aprobación
    // del coordinador (ver lib/solicitud-turnos-actions.ts).
    const { data: solicitudes, error: solicitudesError } = await supabase
      .from("solicitud_horas_extras")
      .select("fecharequerida, idempresa, nombre_empleado, identificacion_empleado, cantidad")
      .eq("fecharequerida", fecha)
      .eq("idempresa", empresaId)

    if (solicitudesError) {
      // No abortamos: si falla la consulta de programación, simplemente
      // todos los registros quedarán como "no programada". Dejamos log
      // para diagnóstico.
      console.error("[v0] Error fetching solicitud_horas_extras:", solicitudesError)
    }

    // Indexamos la programación para un cruce O(1). Se indexa por CEDULA y,
    // como respaldo, por nombre normalizado: la cédula es la llave confiable,
    // pero las filas creadas antes de que se empezara a guardar no la tienen.
    const programadasPorCedula = new Map<string, number>()
    const programadasPorNombre = new Map<string, number>()
    for (const s of solicitudes || []) {
      const cantidad = Number((s as any).cantidad) || 0
      // Si hay varias solicitudes para el mismo empleado, acumulamos.
      const cedula = normalizar((s as any).identificacion_empleado)
      if (cedula) {
        programadasPorCedula.set(cedula, (programadasPorCedula.get(cedula) || 0) + cantidad)
      } else {
        const nombre = normalizar((s as any).nombre_empleado)
        programadasPorNombre.set(nombre, (programadasPorNombre.get(nombre) || 0) + cantidad)
      }
    }

    // 3) Filtramos para quedarnos solo con registros donde AL MENOS uno
    // de los campos de horas extra (hed, hedf, hen, hef, hn) tenga un
    // valor real. Si todos están vacíos/0, el registro se descarta.
    const asistenciaConHoras = (asistencia || []).filter(
      (r: any) =>
        tieneValor(r.hed) ||
        tieneValor(r.hedf) ||
        tieneValor(r.hen) ||
        tieneValor(r.hef) ||
        tieneValor(r.hn),
    )

    // 4) Cruzamos cada registro de asistencia contra la programación.
    const registros = asistenciaConHoras.map((r: any) => {
      const totalEjecutadas =
        (Number(r.hed) || 0) +
        (Number(r.hedf) || 0) +
        (Number(r.hen) || 0) +
        (Number(r.hef) || 0) +
        (Number(r.hn) || 0)

      // Cruce por cédula primero (llave confiable); si esa persona no aparece
      // por cédula, se intenta por nombre para no perder la programación
      // creada antes de que se guardara la cédula.
      const cedula = normalizar(r.identificacion)
      const nombre = normalizar(r.nombre)
      const porCedula = cedula ? programadasPorCedula.get(cedula) : undefined
      const porNombre = programadasPorNombre.get(nombre)
      const cantidadProgramada = porCedula ?? porNombre ?? 0

      // "Hora extra no programada": el empleado ejecutó horas extra pero
      // no existe una solicitud programada que lo respalde.
      const programada = porCedula !== undefined || porNombre !== undefined

      return {
        ...r,
        totalEjecutadas,
        cantidadProgramada,
        programada,
      }
    })

    return NextResponse.json({ fecha, registros })
  } catch (error) {
    console.error("[v0] Error in GET /api/extra-hours:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const puerta = await exigirAccionApi(["Asignación horas extra"], "aprobar")
  if (puerta) return puerta
  try {
    const body = await request.json()
    const { id, hed, hedf, hen, hef, hn, aprobado } = body

    if (!id) {
      return NextResponse.json({ error: "ID es requerido" }, { status: 400 })
    }

    const supabase = await createServerClient()

    const updateData: any = {}
    if (hed !== undefined) updateData.hed = hed
    if (hedf !== undefined) updateData.hedf = hedf
    if (hen !== undefined) updateData.hen = hen
    if (hef !== undefined) updateData.hef = hef
    if (hn !== undefined) updateData.hn = hn
    if (aprobado !== undefined) updateData.aprobado = aprobado

    // Marca que estas horas las fijo una persona a mano.
    //
    // SIN ESTO EL AJUSTE MANUAL NO FUNCIONA. El trigger de registroasistencia es
    // BEFORE UPDATE FOR EACH ROW: se dispara con este mismo update, recalcula
    // desde los cuatro tiempos --que no cambiaron-- y sobrescribe el valor
    // recien escrito antes de guardarlo. Con la bandera, el trigger sale sin
    // tocar nada. Se limpia sola si mas adelante cambia la marcacion.
    //
    // Solo se marca cuando se tocan las HORAS: aprobar o rechazar no es un
    // ajuste manual del calculo.
    const tocaHoras =
      hed !== undefined || hedf !== undefined || hen !== undefined || hef !== undefined || hn !== undefined
    if (tocaHoras) updateData.extras_manual = true

    const { error } = await supabase.from("registroasistencia").update(updateData).eq("id", id)

    if (error) {
      console.error("[v0] Error updating extra hours:", error)
      return NextResponse.json({ error: "Error al actualizar registro" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in PATCH /api/extra-hours:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
