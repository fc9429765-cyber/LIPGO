"use server"

// PENDIENTES POR PANTALLA — distintivos vivos del portal de área ("6 sin cerrar",
// "5 por aprobar"). Una sola llamada ligera (solo conteos, head requests) por
// empresa, con las MISMAS fuentes y criterios que ya usan Operación del día y
// los avisos de la barra superior; no calcula nada por una vía propia.
// Devuelve conteos por NOMBRE DE MÓDULO hoja; el portal los agrega por hub.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { diaSemana, sumarDias } from "@/lib/programacion-cliente-calculo"

export interface PendientePantalla {
  /** `name` del módulo hoja al que lleva. */
  modulo: string
  cantidad: number
  /** Texto corto para el distintivo: "6 sin cerrar". */
  texto: string
  /** alto = bloquea el día; medio = hay que gestionar. */
  nivel: "alto" | "medio"
}

function hoyColombia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`

export async function getPendientesPorPantalla(
  empresaId: number | null | undefined,
): Promise<{ success: boolean; data?: PendientePantalla[]; message?: string }> {
  if (!empresaId) return { success: true, data: [] }
  try {
    const sb: any = await getSupabaseAdmin()
    const hoy = hoyColombia()
    const cuenta = async (q: any): Promise<number> => {
      try {
        const { count, error } = await q
        if (error) return 0
        return count || 0
      } catch {
        return 0
      }
    }
    const head = (tabla: string) => sb.from(tabla).select("*", { count: "exact", head: true })

    // Programación del cliente para MAÑANA (SQL 211): solo cuenta como pendiente
    // si la empresa ya usa el módulo (tiene alguna programación), desde el
    // mediodía, y si mañana no es domingo.
    const manana = sumarDias(hoy, 1)
    const horaBogota = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "numeric", hour12: false }).format(new Date()))
    const mananaDomingo = diaSemana(manana) === 0

    const [sinCerrar, turnos, enPatio, sinMarcar, ausBorrador, ajustesInv, requisiciones, usaProgramacion, programacionManana] = await Promise.all([
      cuenta(head("cabeceraoc").eq("idempresa", empresaId).not("iniciocargue", "is", null).is("fincargue", null)),
      cuenta(head("solicitudesturnos").eq("idempresa", empresaId).eq("estado", "pendiente")),
      cuenta(head("citasvehiculos").eq("idempresa", empresaId).is("estatus", null).gte("fechallegada", hoy)),
      cuenta(head("registroasistencia").eq("idempresa", empresaId).eq("fecha", hoy).not("puesto", "is", null).is("horaingreso", null).is("asistencia", null)),
      cuenta(head("ausentismosst").eq("idempresa", empresaId).eq("estado_registro", "BORRADOR")),
      cuenta(head("inv_ajustes_pendientes").eq("idempresa", empresaId).eq("estado", "pendiente")),
      cuenta(head("vacantes").eq("idempresa", empresaId).eq("estado", "en_revision")),
      cuenta(head("programacion_cliente").eq("idempresa", empresaId)),
      cuenta(head("programacion_cliente").eq("idempresa", empresaId).eq("fecha_operacion", manana).eq("vigente", true)),
    ])

    const out: PendientePantalla[] = []
    if (usaProgramacion > 0 && programacionManana === 0 && horaBogota >= 12 && !mananaDomingo) {
      out.push({ modulo: "Programación del cliente", cantidad: 1, texto: "sin programación para mañana", nivel: horaBogota >= 17 ? "alto" : "medio" })
    }
    if (sinCerrar) out.push({ modulo: "Centro de Coordinación", cantidad: sinCerrar, texto: plural(sinCerrar, "vehículo sin cerrar", "vehículos sin cerrar"), nivel: "alto" })
    if (turnos) out.push({ modulo: "Aprobar Turnos", cantidad: turnos, texto: plural(turnos, "turno por aprobar", "turnos por aprobar"), nivel: "medio" })
    if (enPatio) out.push({ modulo: "Registrar Vehículos", cantidad: enPatio, texto: plural(enPatio, "vehículo en patio", "vehículos en patio"), nivel: "medio" })
    if (sinMarcar) out.push({ modulo: "Tabla Asistencia", cantidad: sinMarcar, texto: plural(sinMarcar, "persona sin marcar", "personas sin marcar"), nivel: sinMarcar > 3 ? "alto" : "medio" })
    if (ausBorrador) out.push({ modulo: "Novedades de personal", cantidad: ausBorrador, texto: plural(ausBorrador, "ausentismo sin completar", "ausentismos sin completar"), nivel: "medio" })
    if (ajustesInv) out.push({ modulo: "Transacciones de Inventario", cantidad: ajustesInv, texto: plural(ajustesInv, "ajuste por aprobar", "ajustes por aprobar"), nivel: "medio" })
    if (requisiciones) out.push({ modulo: "Aprobación de Solicitudes de Personal", cantidad: requisiciones, texto: plural(requisiciones, "requisición en revisión", "requisiciones en revisión"), nivel: "medio" })
    return { success: true, data: out }
  } catch (e: any) {
    console.error("[v0] getPendientesPorPantalla:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron leer los pendientes." }
  }
}
