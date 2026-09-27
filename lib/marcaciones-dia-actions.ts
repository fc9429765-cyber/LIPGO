"use server"

// ---------------------------------------------------------------------------
// MARCACIONES DEL DÍA — lo que acompaña a la tablet de portería.
//
// Cruza dos cosas que ya existen:
//   · `asistencia`          — la marcación REAL del kiosco
//   · `registroasistencia`  — el turno PROGRAMADO y la novedad del día
//
// De ese cruce salen las tres cifras que importan en portería: quién llegó a
// tiempo, quién llegó tarde y quién no se presentó.
//
// LA MARCACIÓN REAL VIVE EN `asistencia`, no en `registroasistencia.horaingreso`.
// Ese campo es un sync best-effort: si se programa a alguien DESPUÉS de que
// marcó, queda vacío para siempre. Usarlo haría aparecer como no presentada a
// gente que sí entró.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { isLate, minutosTarde } from "@/lib/asistencia-catalogos"
import type { EstadoMarcacion, MarcacionDia, MarcacionesDiaData } from "@/lib/marcaciones-dia-tipos"

/** Hoy en hora de Colombia. En UTC, después de las 19:00 ya sería mañana. */
function hoyColombia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

/** "HH:MM" a partir de lo que guarde la columna (puede traer segundos). */
function hhmm(v: unknown): string | null {
  const s = String(v ?? "").trim()
  if (!s) return null
  const m = s.match(/(\d{1,2}):(\d{2})/)
  if (!m) return null
  return `${m[1].padStart(2, "0")}:${m[2]}`
}

async function traerTodo(construir: (d: number, h: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let off = 0; off < 20000; off += 1000) {
    const { data, error } = await construir(off, off + 999)
    if (error) throw new Error(error.message)
    const lote = data ?? []
    out.push(...lote)
    if (lote.length < 1000) break
  }
  return out
}

/**
 * Marcaciones del día con su estado contra el turno programado.
 */
export async function getMarcacionesDia(
  empresaId: number | null | undefined,
  fechaSel?: string | null,
): Promise<{ success: boolean; data?: MarcacionesDiaData; message?: string }> {
  if (!empresaId) return { success: false, message: "Selecciona una empresa en el selector de arriba." }

  const fecha = fechaSel || hoyColombia()
  const avisos: string[] = []

  try {
    const sb: any = await getSupabaseAdmin()

    const [marcadas, programadas, personalAdmin] = await Promise.all([
      traerTodo((d, h) =>
        sb
          .from("asistencia")
          .select("identificacion, hora")
          .eq("idempresa", empresaId)
          .eq("fecha", fecha)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      ).catch((e: any) => {
        avisos.push("No se pudieron leer las marcaciones del kiosco.")
        console.error("[v0] getMarcacionesDia asistencia:", e?.message ?? e)
        return [] as any[]
      }),
      traerTodo((d, h) =>
        sb
          .from("registroasistencia")
          .select("identificacion, nombre, puesto, turno, asistencia, horaentradaprogramada")
          .eq("idempresa", empresaId)
          .eq("fecha", fecha)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      ).catch((e: any) => {
        avisos.push("No se pudo leer la programación del día.")
        console.error("[v0] getMarcacionesDia registroasistencia:", e?.message ?? e)
        return [] as any[]
      }),
      // Administrativos fuera: portería es una pantalla operativa, no de ellos.
      // `admin` es project-agnostic (hay administrativos con idempresa NULL),
      // de ahí el `.or` en vez de un simple `.eq`.
      traerTodo((d, h) =>
        sb
          .from("headcount")
          .select("identificacion")
          .eq("admin", true)
          .or(`idempresa.eq.${empresaId},idempresa.is.null`)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      ).catch((e: any) => {
        console.error("[v0] getMarcacionesDia headcount admin:", e?.message ?? e)
        return [] as any[]
      }),
    ])
    const idsAdmin = new Set(personalAdmin.map((r: any) => String(r.identificacion ?? "").trim()))

    // Primera marcación de cada persona: si alguien marca dos veces, la entrada
    // es la más temprana.
    const horaPorIdent = new Map<string, string>()
    for (const m of marcadas) {
      const id = String(m.identificacion ?? "").trim()
      const h = hhmm(m.hora)
      if (!id || !h) continue
      const ya = horaPorIdent.get(id)
      if (!ya || h < ya) horaPorIdent.set(id, h)
    }

    // Nombres: se toman de la programación, y si alguien marcó sin estar
    // programado se completa desde headcount.
    const vivas = programadas.filter(
      (r: any) => !/prueba/i.test(String(r.nombre ?? "")) && !idsAdmin.has(String(r.identificacion ?? "").trim()),
    )
    const nombrePorIdent = new Map<string, string>()
    for (const r of vivas) {
      const id = String(r.identificacion ?? "").trim()
      if (id && r.nombre) nombrePorIdent.set(id, r.nombre)
    }

    const sinNombre = [...horaPorIdent.keys()].filter((id) => !nombrePorIdent.has(id))
    if (sinNombre.length) {
      try {
        const { data } = await sb
          .from("headcount")
          .select("identificacion, nombre")
          .eq("idempresa", empresaId)
          .in("identificacion", sinNombre.slice(0, 200))
        for (const p of data ?? []) {
          const id = String(p.identificacion ?? "").trim()
          if (id && p.nombre) nombrePorIdent.set(id, p.nombre)
        }
      } catch (e: any) {
        console.error("[v0] getMarcacionesDia headcount:", e?.message ?? e)
      }
    }

    const marcaciones: MarcacionDia[] = []
    const turnosPresentes = new Set<string>()
    const yaVistos = new Set<string>()

    // 1) Todo lo programado: a tiempo, tarde, con novedad o no presentado.
    for (const r of vivas) {
      const id = String(r.identificacion ?? "").trim()
      if (!id) continue
      const clave = `${id}|${r.turno ?? "u"}`
      if (yaVistos.has(clave)) continue
      yaVistos.add(clave)

      const hora = horaPorIdent.get(id) ?? null
      const prog = hhmm(r.horaentradaprogramada)
      const novedad = r.asistencia ?? null
      if (r.turno != null) turnosPresentes.add(`T${r.turno}`)

      let estado: EstadoMarcacion
      let tarde = 0
      if (novedad) {
        // La ausencia está justificada: no es un "no presentado".
        estado = "sin_turno"
      } else if (!hora) {
        estado = "no_presentado"
      } else if (prog && isLate(hora, prog)) {
        estado = "tarde"
        tarde = minutosTarde(hora, prog)
      } else {
        estado = "a_tiempo"
      }

      marcaciones.push({
        identificacion: id,
        nombre: nombrePorIdent.get(id) ?? r.nombre ?? "",
        hora,
        horaProgramada: prog,
        puesto: r.puesto ?? null,
        turno: r.turno == null ? null : Number(r.turno),
        estado,
        minutosTarde: tarde,
        novedad,
      })
    }

    // 2) Quien marcó SIN estar programado. No se descarta: es justo lo que un
    //    supervisor querría ver. Administrativos sí se descartan aquí también.
    for (const [id, hora] of horaPorIdent) {
      if (idsAdmin.has(id)) continue
      if ([...yaVistos].some((k) => k.startsWith(`${id}|`))) continue
      marcaciones.push({
        identificacion: id,
        nombre: nombrePorIdent.get(id) ?? "",
        hora,
        horaProgramada: null,
        puesto: null,
        turno: null,
        estado: "sin_turno",
        minutosTarde: 0,
        novedad: null,
      })
    }

    // Orden: primero los que marcaron, por hora; al final los que no.
    marcaciones.sort((a, b) => {
      if (a.hora && b.hora) return a.hora.localeCompare(b.hora)
      if (a.hora) return -1
      if (b.hora) return 1
      return a.nombre.localeCompare(b.nombre)
    })

    const aTiempo = marcaciones.filter((m) => m.estado === "a_tiempo").length
    const tarde = marcaciones.filter((m) => m.estado === "tarde").length
    const noPresentados = marcaciones.filter((m) => m.estado === "no_presentado").length
    const conNovedad = marcaciones.filter((m) => m.novedad != null).length
    // Denominador del cumplimiento: los turnos que se esperaba cubrir. Las
    // ausencias justificadas quedan fuera; castigarlas mediría otra cosa.
    const programadosReales = aTiempo + tarde + noPresentados

    return {
      success: true,
      data: {
        fecha,
        marcaciones,
        resumen: {
          marcaron: marcaciones.filter((m) => m.hora != null).length,
          aTiempo,
          tarde,
          noPresentados,
          conNovedad,
          programados: programadosReales,
          pctCumplimiento:
            programadosReales > 0 ? Math.round((aTiempo / programadosReales) * 100) : null,
          turnos: [...turnosPresentes].sort(),
        },
        avisos,
      },
    }
  } catch (e: any) {
    console.error("[v0] getMarcacionesDia excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron cargar las marcaciones." }
  }
}
