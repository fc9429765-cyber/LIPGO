"use server"

/**
 * Server actions del modulo "Programación de turnos" (RRHH Lip).
 *
 * Reglas clave:
 *
 *  1. El listado de personas siempre se trae de `headcount` filtrando
 *     por `idempresa` y `estado = 'Activo'`. Solo exponemos `id`,
 *     `nombre` e `identificacion` porque eso es lo unico que la UI
 *     necesita para programar turnos.
 *
 *  2. El catalogo de puestos viene de `tarifasturnos`. Cada puesto
 *     puede aparecer en varias filas con distintas vigencias; aqui
 *     agrupamos por `puesto` y nos quedamos con el `especialidad` mas
 *     reciente. (Antes usabamos `aplicaton` como proxy, pero esa
 *     columna refleja "se paga por tonelada", no es lo mismo que
 *     "especialidad". A partir de ahora la fuente de verdad para la
 *     bandera de especialidad es la propia columna `especialidad` de
 *     `tarifasturnos`.)
 *
 *  3. Al programar, se inserta una fila por persona en
 *     `registroasistencia`. Hay DOS modos:
 *
 *      a) "Turno" (modo por defecto): se persisten `puesto`,
 *         `horaentradaprogramada` y `especialidad` (texto
 *         "true"/"false" derivado de `tarifasturnos.especialidad`).
 *
 *      b) "Novedad": la programacion no implica un turno operativo
 *         sino una ausencia/justificacion (vacaciones, incapacidad,
 *         descanso compensatorio, retiro, etc.). En este caso
 *         `puesto`, `horaentradaprogramada` y `especialidad` se
 *         dejan en `NULL` y la novedad se persiste en el campo
 *         `asistencia` con el MISMO texto que usa el modulo
 *         "Novedades de Personal", para que los modulos aguas abajo
 *         (nomina, dashboards, exportes) la reconozcan sin
 *         tratamiento adicional.
 *
 *     Antes de insertar verificamos duplicados (misma identificacion
 *     + misma fecha en la misma empresa) para no pisar registros
 *     existentes y devolvemos los conflictos al cliente.
 *
 *  4. El `empresaId` lo pasa el cliente como parametro (igual que
 *     en `turnos-actions.ts`). Esto permite usar el mismo provider
 *     de auth (`useAuth().selectedEmpresaId`) que el resto de la
 *     app, evitando el desfase con `getCurrentEmpresaIdForInsert`
 *     (que depende de la sesion de Supabase Auth y normalmente cae
 *     al fallback 1).
 *
 *  5. Usamos `getSupabaseAdmin()` (service role) para que las
 *     consultas no se vean filtradas por RLS — el control de acceso
 *     ya lo aplica el `PermissionGuard` en el cliente y la
 *     restriccion `idempresa` en cada query.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirAccion } from "@/lib/puerta-modulo"

export interface ActiveHeadcountPerson {
  id: number
  nombre: string
  identificacion: string
}

export interface PuestoOption {
  /** Nombre del puesto (clave funcional). */
  puesto: string
  /**
   * Si el puesto se considera "especialidad" (origen: columna
   * `especialidad` boolean en `tarifasturnos`). Se mapea
   * directamente al campo `especialidad` de `registroasistencia`,
   * que es TEXT — la conversion bool → texto se hace en el insert.
   */
  especialidad: boolean
}

export interface ProgramacionTurnoInput {
  /** Identificacion del trabajador (string para preservar ceros a la izquierda). */
  identificacion: string
  /** Nombre del trabajador. Se persiste tal cual para reportes. */
  nombre: string
  /**
   * Puesto seleccionado. Debe coincidir con un valor de
   * `tarifasturnos.puesto`. Se ignora cuando `novedad` viene definido
   * (modo novedad). En ese caso se persiste como NULL.
   */
  puesto?: string
  /**
   * Hora de entrada en formato "HH:MM" o "HH:MM:SS". Se ignora en
   * modo novedad y queda en NULL.
   */
  horaentradaprogramada?: string
  /**
   * Hora de salida en formato "HH:MM" o "HH:MM:SS". Se persiste en
   * `registroasistencia.horasalidaprogramada`. Se ignora en modo
   * novedad y queda en NULL.
   */
  horasalidaprogramada?: string
  /**
   * Si viene definido, activa el modo NOVEDAD: se persiste el texto
   * en `asistencia` y `puesto` / `horaentradaprogramada` /
   * `especialidad` quedan en NULL. Debe ser una cadena no vacia que
   * coincida con las opciones del modulo "Novedades de Personal".
   */
  novedad?: string
  /**
   * Turno del dia para puestos con doble jornada (hoy: "Auxiliar
   * Mixto"). 1 o 2; `undefined`/`null` para el resto de puestos (una
   * sola jornada, comportamiento identico al de siempre). Permite que
   * la MISMA persona tenga 2 filas el mismo dia -- una por turno --
   * sin romper el chequeo de duplicados (ver `programarTurnos`).
   * Ignorado en modo NOVEDAD (siempre persiste como NULL).
   */
  turno?: 1 | 2
}

export interface ProgramacionResultado {
  /** Filas efectivamente insertadas en `registroasistencia`. */
  insertados: number
  /**
   * Identificaciones que ya tenian registro para la fecha y por eso
   * fueron ignoradas. La UI las muestra como advertencia.
   */
  duplicados: string[]
}

export interface ProgramacionExistenteRow {
  id: number
  fecha: string
  nombre: string
  identificacion: string
  puesto: string | null
  horaentradaprogramada: string | null
  horasalidaprogramada: string | null
  /**
   * Texto persistido en `registroasistencia.especialidad`. Convencion:
   *   - `"true"`  → puesto especialidad
   *   - `"false"` → puesto NO especialidad
   *   - `null`    → registros sin definir (incluye programaciones de
   *     novedad, donde el campo se deja en NULL intencionalmente)
   * El consumidor debe comparar contra `"true"` (no usar truthy, ya
   * que `"false"` tambien es truthy en JS).
   */
  especialidad: string | null
  /**
   * Contenido del campo `asistencia`. En programaciones de turno
   * suele estar en NULL (la asistencia real se registra en otro
   * momento). En programaciones de NOVEDAD aqui queda guardado el
   * texto de la novedad (p.ej. "Descanso", "Retiro", "31- Vacaciones
   * disfrutadas") y es la señal para que la UI muestre la fila como
   * novedad en lugar de turno.
   */
  asistencia: string | null
  /** Turno del dia (1/2) para puestos con doble jornada; `null` = jornada unica. */
  turno: number | null
}

/**
 * Devuelve el listado de personas activas de la empresa indicada,
 * ordenadas alfabeticamente por nombre.
 */
export async function getActiveHeadcountForScheduling(
  empresaId: number,
): Promise<ActiveHeadcountPerson[]> {
  if (!empresaId) return []

  const supabase = await getSupabaseAdmin()
  // Se excluye al personal administrativo: no se le programan turnos, y
  // ofrecerlo en el selector solo permite crearle una fila de asistencia que
  // despues nadie sabe por que existe. Ver la nota de
  // app/api/attendance/table/route.ts sobre `not is true` y los null.
  const { data, error } = await supabase
    .from("headcount")
    .select("id, nombre, identificacion")
    .eq("idempresa", empresaId)
    .eq("estado", "Activo")
    .not("admin", "is", true)
    .order("nombre", { ascending: true })

  if (error) {
    console.error("[v0] Error fetching active headcount:", error)
    throw new Error(`Error al obtener el personal activo: ${error.message}`)
  }

  return (data || []).map((p) => ({
    id: Number(p.id),
    nombre: (p.nombre || "").toString(),
    identificacion: (p.identificacion || "").toString(),
  }))
}

/**
 * Trae los puestos unicos de `tarifasturnos`.
 *
 * NOTA: a diferencia del resto de queries del modulo, esta NO se
 * filtra por `idempresa`. El catalogo de puestos es transversal:
 * queremos que el usuario pueda programar a personal de su empresa
 * en cualquier puesto definido en `tarifasturnos`, aunque la
 * vigencia de tarifa haya sido creada bajo otra empresa. El
 * parametro `empresaId` se conserva por compatibilidad con la firma
 * y por si en el futuro se decide volver a restringir.
 *
 * Si un puesto aparece en varias filas (cambios de tarifa con
 * vigencia distinta o entre empresas) tomamos el `especialidad` de
 * la fila con `fechaini` mas reciente.
 */
export async function getPuestosFromTarifas(
  _empresaId?: number,
): Promise<PuestoOption[]> {
  const supabase = await getSupabaseAdmin()
  const { data, error } = await supabase
    .from("tarifasturnos")
    .select("puesto, especialidad, fechaini")
    .order("fechaini", { ascending: false, nullsFirst: false })

  if (error) {
    console.error("[v0] Error fetching puestos:", error)
    throw new Error(`Error al obtener los puestos: ${error.message}`)
  }

  // Agrupamos por puesto preservando solo el primer `especialidad`
  // que veamos (el listado viene ordenado por fechaini desc, asi que
  // ese es el mas reciente). Los puestos vacios/nulos se descartan.
  const map = new Map<string, PuestoOption>()
  for (const row of data || []) {
    const puesto = (row.puesto || "").toString().trim()
    if (!puesto) continue
    if (!map.has(puesto)) {
      map.set(puesto, {
        puesto,
        especialidad: row.especialidad === true,
      })
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.puesto.localeCompare(b.puesto, "es", { sensitivity: "base" }),
  )
}

/**
 * Inserta en `registroasistencia` un lote de programaciones para una
 * misma fecha. Soporta dos modos por item:
 *
 *  - Modo TURNO (sin `novedad`): se resuelve `especialidad` desde
 *    `tarifasturnos.especialidad` (bool → texto "true"/"false") y se
 *    persisten `puesto` + `horaentradaprogramada`.
 *  - Modo NOVEDAD (`novedad` definido): `puesto`,
 *    `horaentradaprogramada` y `especialidad` quedan en NULL, y el
 *    texto de la novedad se persiste en `asistencia`.
 *
 * En ambos casos filtramos duplicados (identificacion + fecha +
 * idempresa) antes del insert para no pisar registros existentes.
 */
export async function programarTurnos(
  empresaId: number,
  fecha: string,
  programaciones: ProgramacionTurnoInput[],
): Promise<ProgramacionResultado> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Programación de turnos"], "crear", "Programar turnos")
  if (!empresaId) throw new Error("Empresa no seleccionada")
  if (!fecha) throw new Error("La fecha es requerida")
  if (!programaciones || programaciones.length === 0) {
    return { insertados: 0, duplicados: [] }
  }

  const supabaseAdmin = await getSupabaseAdmin()

  // 1) Cache `especialidad` por puesto desde tarifasturnos para que
  //    la bandera se determine en el server (no en el cliente). Asi
  //    no podemos mandar `especialidad: true` para un puesto que en
  //    realidad NO es especialidad.
  // Solo recolectamos puestos para items en modo TURNO. Los items
  // en modo NOVEDAD (con `novedad` definido) no necesitan resolver
  // especialidad porque persistiran `especialidad: null`.
  const puestosUnicos = Array.from(
    new Set(
      programaciones
        .filter((p) => !p.novedad && p.puesto)
        .map((p) => p.puesto as string),
    ),
  )

  const especialidadByPuesto = new Map<string, boolean>()
  if (puestosUnicos.length > 0) {
    // Coherente con `getPuestosFromTarifas`: el catalogo de puestos
    // es transversal y NO se restringe por empresa, asi que la
    // resolucion del flag `especialidad` tampoco. De lo contrario un
    // puesto visible en el dropdown podria llegar al insert con
    // `especialidad: false` solo porque su tarifa fue creada bajo
    // otra empresa.
    const { data: tarifas, error: tarifasError } = await supabaseAdmin
      .from("tarifasturnos")
      .select("puesto, especialidad, fechaini")
      .in("puesto", puestosUnicos)
      .order("fechaini", { ascending: false, nullsFirst: false })

    if (tarifasError) {
      console.error("[v0] Error fetching tarifas for scheduling:", tarifasError)
      throw new Error("Error al consultar puestos en tarifasturnos")
    }

    for (const t of tarifas || []) {
      const key = (t.puesto || "").toString().trim()
      if (!key || especialidadByPuesto.has(key)) continue
      especialidadByPuesto.set(key, t.especialidad === true)
    }
  }

  // 2) Detectar duplicados: misma fecha + misma cedula + misma empresa + MISMO
  //    TURNO. `turno` es NULL para todos los puestos salvo Auxiliar Mixto con
  //    doble jornada: 2 filas para la MISMA persona/dia solo coexisten si el
  //    turno difiere (1 vs 2). Cuando ambos lados tienen turno=null (el 100%
  //    de los puestos hoy) esto es EXACTAMENTE el chequeo de siempre: 1 fila
  //    por persona/dia.
  const identificaciones = programaciones.map((p) => p.identificacion)
  const { data: existing } = await supabaseAdmin
    .from("registroasistencia")
    .select("identificacion, turno")
    .eq("fecha", fecha)
    .eq("idempresa", empresaId)
    .in("identificacion", identificaciones)

  const claveExistente = new Set(
    (existing || []).map(
      (r) => `${(r.identificacion || "").toString()}|${r.turno ?? "null"}`,
    ),
  )

  const yaProgramados = new Set<string>()

  // 2b) MARCACION YA REGISTRADA de esas personas ese dia (tabla `asistencia`).
  //
  // Programar a futuro es el caso normal y ahi no hay marcacion: la fila nace
  // sin `horaingreso` y se llena cuando la persona marque
  // (/api/attendance/register). Pero programar EL MISMO DIA, despues de que la
  // persona ya marco, dejaba la fila con `horaingreso` VACIA PARA SIEMPRE:
  // el endpoint de marcacion ya paso y no vuelve, y aqui no se consultaba.
  //
  // Sintoma: en Tabla Asistencia se ve la hora de llegada —que sale de
  // `asistencia`— pero en `registroasistencia` la persona aparece sin hora.
  const { data: marcaciones } = await supabaseAdmin
    .from("asistencia")
    .select("identificacion, hora, foto_ingreso")
    .eq("fecha", fecha)
    .eq("idempresa", empresaId)
    .in("identificacion", identificaciones)

  const marcacionPorIdent = new Map<string, { hora: string | null; foto: string | null }>()
  for (const m of marcaciones || []) {
    marcacionPorIdent.set(String(m.identificacion), {
      hora: (m as any).hora ?? null,
      foto: (m as any).foto_ingreso ?? null,
    })
  }

  const records = programaciones
    .filter((p) => {
      // Modo NOVEDAD siempre usa turno=null (una novedad reemplaza el dia
      // completo, no es especifica de un turno).
      const turnoKey = (p.novedad || "").trim() ? "null" : (p.turno ?? "null")
      const clave = `${p.identificacion}|${turnoKey}`
      if (claveExistente.has(clave)) {
        yaProgramados.add(p.identificacion)
        return false
      }
      return true
    })
    .map((p) => {
      // Modo NOVEDAD: puesto / hora / especialidad / turno quedan en NULL y
      // la novedad va en `asistencia`. Trimm/normalizamos por si el
      // cliente mando espacios.
      const novedadTexto = (p.novedad || "").trim()
      if (novedadTexto) {
        return {
          fecha,
          nombre: p.nombre,
          identificacion: p.identificacion,
          puesto: null,
          horaentradaprogramada: null,
          horasalidaprogramada: null,
          asistencia: novedadTexto,
          especialidad: null,
          turno: null,
          idempresa: empresaId,
        }
      }

      // Modo TURNO: persistimos puesto + hora + especialidad (TEXT) + turno
      // (1/2 solo para puestos con doble jornada; null para el resto).
      // Persistimos cadenas explicitas ("true"/"false") para que sea
      // facil consultar/filtrar por SQL sin depender de truthiness
      // de strings en JS.
      // Si la persona YA marco hoy, la fila nace con su hora y su foto reales.
      // Si no ha marcado quedan en null, que es lo correcto: aun no ha llegado
      // y `/api/attendance/register` las escribira cuando marque.
      const marcacion = marcacionPorIdent.get(p.identificacion)

      return {
        fecha,
        nombre: p.nombre,
        identificacion: p.identificacion,
        puesto: p.puesto || null,
        horaentradaprogramada: p.horaentradaprogramada || null,
        horasalidaprogramada: p.horasalidaprogramada || null,
        horaingreso: marcacion?.hora ?? null,
        foto_ingreso: marcacion?.foto ?? null,
        asistencia: null,
        especialidad:
          p.puesto && especialidadByPuesto.get(p.puesto) === true
            ? "true"
            : "false",
        turno: p.turno ?? null,
        idempresa: empresaId,
      }
    })

  if (records.length === 0) {
    return { insertados: 0, duplicados: Array.from(yaProgramados) }
  }

  const { error: insertError } = await supabaseAdmin
    .from("registroasistencia")
    .insert(records)

  if (insertError) {
    console.error("[v0] Error inserting programaciones:", insertError)
    throw new Error(`Error al programar turnos: ${insertError.message}`)
  }

  return {
    insertados: records.length,
    duplicados: Array.from(yaProgramados),
  }
}

/**
 * Lista las programaciones existentes para una fecha, filtradas por
 * la empresa indicada. Sirve como vista de control para que el
 * supervisor vea quienes ya estan programados ese dia.
 */
export async function getProgramacionesByDate(
  empresaId: number,
  fecha: string,
): Promise<ProgramacionExistenteRow[]> {
  if (!empresaId || !fecha) return []

  const supabase = await getSupabaseAdmin()
  const { data, error } = await supabase
    .from("registroasistencia")
    .select(
      "id, fecha, nombre, identificacion, puesto, horaentradaprogramada, horasalidaprogramada, especialidad, asistencia, turno",
    )
    .eq("idempresa", empresaId)
    .eq("fecha", fecha)
    .order("nombre", { ascending: true })

  if (error) {
    console.error("[v0] Error fetching programaciones:", error)
    throw new Error(`Error al consultar la programación: ${error.message}`)
  }

  return (data || []) as ProgramacionExistenteRow[]
}

/**
 * Elimina una programacion individual. Verifica el `idempresa` para
 * que un usuario no pueda borrar registros de otra empresa, aun
 * pasando un `id` ajeno por accidente.
 */
export async function deleteProgramacion(
  empresaId: number,
  id: number,
): Promise<{ success: boolean }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Programación de turnos"], "eliminar")
  if (!empresaId) throw new Error("Empresa no seleccionada")
  if (!id) throw new Error("ID de la programación es requerido")

  const supabaseAdmin = await getSupabaseAdmin()
  const { error } = await supabaseAdmin
    .from("registroasistencia")
    .delete()
    .eq("id", id)
    .eq("idempresa", empresaId)

  if (error) {
    console.error("[v0] Error deleting programacion:", error)
    throw new Error("Error al eliminar la programación")
  }

  return { success: true }
}
