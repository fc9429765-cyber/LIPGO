"use server"

// Efecto automático de la novedad "Retiro": da de baja al trabajador. Se invoca
// desde donde se marque la novedad (Visor de Asistencia y Novedades de Personal).
// Escribe en headcount Y en colaboradores_th para que la sync unidireccional
// (colaboradores → headcount) no revierta el estado, y para que el filtro de
// vínculo de pagonomina (por fecha_fin_contrato) excluya los días posteriores.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// Calca la detección de ausentismos-actions.ts: "retiro" por substring.
// Local (no exportable: un archivo "use server" solo exporta funciones async).
function esNovedadRetiro(asistencia?: string | null): boolean {
  return String(asistencia || "").toLowerCase().includes("retiro")
}

export async function procesarNovedadRetiro(params: {
  identificacion?: string | null
  fecha?: string | null
  asistencia?: string | null
  idempresa?: number | null
}): Promise<{ success: boolean; aplicado?: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Tabla Asistencia", "Novedades de personal", "Visor"], "editar", "Novedad de retiro")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const { identificacion, fecha, asistencia, idempresa } = params
  if (!esNovedadRetiro(asistencia)) return { success: true, aplicado: false }
  const cedula = String(identificacion || "").trim()
  if (!cedula) return { success: false, message: "Falta la identificación para procesar el retiro." }

  const fechaRetiro = fecha || new Date().toISOString().split("T")[0]

  try {
    const admin: any = await getSupabaseAdmin()

    // 1) headcount: baja (Inactivo) + fecha de retiro + fuera del plano.
    let hq = admin
      .from("headcount")
      .update({ estado: "Inactivo", fecha_retiro: fechaRetiro, aplicaplano: false })
      .eq("identificacion", cedula)
    if (idempresa) hq = hq.eq("idempresa", idempresa)
    const { error: hErr } = await hq
    if (hErr) return { success: false, message: hErr.message }

    // 2) colaboradores_th (fuente de verdad de la sync): estado + fin de contrato.
    //    Evita que un guardado posterior del colaborador revierta el estado, y
    //    alimenta el filtro de vínculo de pagonomina.
    await admin
      .from("colaboradores_th")
      .update({ estado: "inactivo", fecha_fin_contrato: fechaRetiro })
      .eq("numero_documento", cedula)

    return { success: true, aplicado: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al procesar el retiro." }
  }
}
