"use server"

/**
 * Cambio de PUESTO del día desde "Tabla Asistencia".
 *
 * Hasta ahora el puesto del día era inmutable: `register-shifts` rechaza
 * reasignar una fila ya procesada y "Programación de turnos" rechaza el
 * duplicado. Pero en la operación sí pasa —alguien de turno fijo se pasa a
 * cargue y descargue a media jornada— y no había forma de reflejarlo, así que
 * esa persona nunca aparecía en los selectores de Picking/Packing.
 *
 * QUÉ TOCA ESTE CAMBIO, y por eso exige un motivo escrito:
 *
 *   · `registroasistencia.puesto` — es lo que leen los selectores de
 *     Picking/Packing (ver PUESTOS_PICKING en lib/picking-actions.ts).
 *   · `registroasistencia.especialidad` y `.horasturno` — cambian cómo
 *     `pagonomina` liquida ese día.
 *   · `asignacionpersonal` — alimenta el "personal del día" de los dashboards.
 *
 * NO TOCA `horaingreso`: la regla de que solo aparece en Picking/Packing quien
 * confirmó llegada se mantiene intacta. Reasignar a alguien que aún no ha
 * marcado NO lo hace aparecer; aparecerá cuando marque.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/** Mínimo del motivo. Corto no explica nada y el registro pierde su razón de ser. */
const MOTIVO_MIN = 10

export interface ReasignarPuestoInput {
  identificacion: string
  nombre: string
  idempresa: number
  /** Puesto destino, tal como aparece en las listas de Tabla Asistencia. */
  puestoNuevo: string
  motivo: string
}

/**
 * `horasturno` según el puesto, replicando `/api/attendance/register-shifts`:
 * "Salvado" cumple 10 h y el resto de especialidades 8 h. En Operaciones se
 * deja null para no ensuciar el campo con un valor que no aplica.
 */
function horasTurnoPara(esEspecialidad: boolean, puesto: string): number | null {
  if (!esEspecialidad) return null
  return puesto.trim().toLowerCase() === "salvado" ? 10 : 8
}

/**
 * ¿El puesto es de ESPECIALIDAD? Se resuelve EN EL SERVIDOR contra
 * `tarifasturnos`, que es el maestro — nunca desde la lista del componente.
 *
 * Es la misma decisión que toma `lib/programacion-turnos-actions.ts`, y por la
 * misma razón que documenta allí: si la bandera viniera del cliente se podría
 * marcar como especialidad un puesto que en el maestro no lo es. Y esa bandera
 * no es cosmética — decide si `pagonomina` liquida el día por base de turno o
 * por destajo.
 *
 * El catálogo de puestos es transversal, así que NO se filtra por empresa: un
 * puesto cuya tarifa se creó bajo otra empresa igual debe resolver bien.
 *
 * Devuelve `null` cuando el puesto no existe en el maestro; el caller decide.
 */
async function resolverEspecialidad(admin: any, puesto: string): Promise<boolean | null> {
  const { data, error } = await admin
    .from("tarifasturnos")
    .select("puesto, especialidad, fechaini")
    .eq("puesto", puesto)
    .order("fechaini", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data.especialidad === true
}

export async function reasignarPuestoDelDia(
  input: ReasignarPuestoInput,
): Promise<{ success: boolean; message: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Tabla Asistencia"], "editar", "Reasignar puesto")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const identificacion = String(input?.identificacion ?? "").trim()
  const puestoNuevo = String(input?.puestoNuevo ?? "").trim()
  const motivo = String(input?.motivo ?? "").trim()
  const { idempresa } = input ?? ({} as ReasignarPuestoInput)

  if (!identificacion || !idempresa) return { success: false, message: "Datos incompletos." }
  if (!puestoNuevo) return { success: false, message: "Selecciona el puesto nuevo." }
  if (motivo.length < MOTIVO_MIN) {
    return {
      success: false,
      message: `Escribe el motivo del cambio (mínimo ${MOTIVO_MIN} caracteres).`,
    }
  }

  try {
    const admin: any = await getSupabaseAdmin()

    const fecha = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())

    // Fila del día. Se busca por (empresa, identificación, fecha), la misma
    // llave con la que la crea Tabla Asistencia.
    const { data: fila, error: errBuscar } = await admin
      .from("registroasistencia")
      .select("id, puesto, asistencia, nombre")
      .eq("idempresa", idempresa)
      .eq("identificacion", identificacion)
      .eq("fecha", fecha)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (errBuscar) return { success: false, message: errBuscar.message }
    if (!fila) {
      return {
        success: false,
        message: "Esta persona no tiene asignación registrada hoy; asígnala primero.",
      }
    }
    // Una fila con novedad (incapacidad, permiso…) no representa a alguien
    // trabajando: cambiarle el puesto la volveria liquidable por error.
    if (String(fila.asistencia ?? "").trim() !== "") {
      return {
        success: false,
        message: `Esta persona tiene la novedad "${fila.asistencia}" registrada hoy. Quita la novedad antes de asignarle un puesto.`,
      }
    }
    const puestoAnterior = String(fila.puesto ?? "").trim()
    if (puestoAnterior === puestoNuevo) {
      return { success: false, message: "Ya tiene ese puesto asignado." }
    }

    const usuario = await getCurrentUsuarioForInsert()

    // La bandera se resuelve contra `tarifasturnos`, no contra la lista del
    // componente. Si el puesto no esta en el maestro se asume NO especialidad
    // —misma convencion que programacion-turnos— pero se avisa en la respuesta:
    // es una decision que afecta la liquidacion y no debe pasar inadvertida.
    const especialidadMaestro = await resolverEspecialidad(admin, puestoNuevo)
    const esEspecialidad = especialidadMaestro === true
    const tipoNuevo: "operaciones" | "especialidades" = esEspecialidad
      ? "especialidades"
      : "operaciones"

    // 1) El puesto y lo que se deriva de él.
    //
    // `especialidad` se escribe como TEXTO "true"/"false": la columna de
    // `registroasistencia` es TEXT y `pagonomina` la compara contra
    // `'true'::text`. Mandar un booleano dependeria de la coercion de PostgREST.
    const { error: errUpdate } = await admin
      .from("registroasistencia")
      .update({
        puesto: puestoNuevo,
        especialidad: esEspecialidad ? "true" : "false",
        horasturno: horasTurnoPara(esEspecialidad, puestoNuevo),
      })
      .eq("id", fila.id)

    if (errUpdate) return { success: false, message: `No se pudo cambiar el puesto: ${errUpdate.message}` }

    // 2) El rastro. Va DESPUÉS del update para no registrar un cambio que no
    //    ocurrió; si falla se avisa, pero el puesto ya quedó cambiado.
    const { error: errLog } = await admin.from("reasignacion_puesto_log").insert({
      fecha,
      idempresa,
      identificacion,
      nombre: input.nombre || fila.nombre || null,
      puesto_anterior: puestoAnterior || null,
      puesto_nuevo: puestoNuevo,
      tipo_nuevo: tipoNuevo,
      motivo,
      usuario: usuario || null,
    })

    // 3) `asignacionpersonal` alimenta el "personal del día" de los dashboards
    //    y solo lleva fila para Operaciones (así lo hace register-shifts). Se
    //    borra la del día y se recrea solo si el puesto nuevo es de Operaciones;
    //    de lo contrario el dashboard seguiría mostrando la asignación vieja.
    await admin
      .from("asignacionpersonal")
      .delete()
      .eq("fecha", fecha)
      .eq("idempleado", identificacion)
      .eq("idempresa", idempresa)

    if (tipoNuevo === "operaciones") {
      const { data: ultimo } = await admin
        .from("asignacionpersonal")
        .select("id")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextId = ultimo ? Number(ultimo.id) + 1 : 1
      const { error: errAsig } = await admin.from("asignacionpersonal").insert({
        id: nextId,
        fecha,
        idempleado: identificacion,
        nombreempleado: input.nombre || fila.nombre || identificacion,
        asignacion: puestoNuevo,
        idempresa,
      })
      if (errAsig) console.error("[v0] reasignarPuesto asignacionpersonal:", errAsig)
    }

    if (errLog) {
      console.error("[v0] reasignarPuesto log:", errLog)
      return {
        success: true,
        message: `Puesto cambiado a ${puestoNuevo}, pero NO se pudo guardar el motivo: ${errLog.message}`,
      }
    }

    const base = puestoAnterior
      ? `Puesto cambiado de ${puestoAnterior} a ${puestoNuevo}`
      : `Puesto asignado: ${puestoNuevo}`
    const nota =
      especialidadMaestro === null
        ? ` — OJO: "${puestoNuevo}" no está en tarifasturnos, así que se registró como NO especialidad. Verifica el maestro de puestos.`
        : esEspecialidad
          ? " (especialidad: sí)."
          : " (especialidad: no)."
    return { success: true, message: base + nota }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al cambiar el puesto." }
  }
}
