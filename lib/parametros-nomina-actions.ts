"use server"

// Server actions del cuadro de mando de nómina: lee/guarda los parámetros legales
// por año en parametros_legales_anio (misma tabla que usa SST/ausentismos; ver
// scripts/051_extend_parametros_nomina.sql). Usa service role, patrón de tarifas-actions.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { PARAMS_NOMINA_DEFAULTS, type ParametrosNomina, type VigenciaParametros } from "@/lib/parametros-nomina"
import { autorizarAccion } from "@/lib/puerta-modulo"

// ---------------------------------------------------------------------------
// PARÁMETROS POR VIGENCIA (intervalos de fecha) — `parametros_legales_vigencia`.
// Es la fuente que usa la vista pagonomina: para cada turno toma la fila con el
// mayor `fecha_desde <= fecha`. Permite programar los cambios legales de mitad de
// año (jornada 16-jul, recargo dominical 16-jul y sus derivados hedf/hef/noct.dom).
// ---------------------------------------------------------------------------

function rowToVigencia(r: any): VigenciaParametros {
  return {
    fechaDesde: String(r.fecha_desde).slice(0, 10),
    smlv: Number(r.smlv) || 0,
    auxilio: Number(r.auxilio_transporte) || 0,
    diasCalendario: r.dias_calendario != null ? Number(r.dias_calendario) : PARAMS_NOMINA_DEFAULTS.diasCalendario,
    jornadaHoras: r.jornada_horas != null ? Number(r.jornada_horas) : PARAMS_NOMINA_DEFAULTS.jornadaHoras,
    pctHed: r.pct_hed != null ? Number(r.pct_hed) : PARAMS_NOMINA_DEFAULTS.pctHed,
    pctHen: r.pct_hen != null ? Number(r.pct_hen) : PARAMS_NOMINA_DEFAULTS.pctHen,
    pctHn: r.pct_hn != null ? Number(r.pct_hn) : PARAMS_NOMINA_DEFAULTS.pctHn,
    pctRecargoDominical:
      r.pct_recargo_dominical != null ? Number(r.pct_recargo_dominical) : PARAMS_NOMINA_DEFAULTS.pctRecargoDominical,
    pctHedf: r.pct_hedf != null ? Number(r.pct_hedf) : PARAMS_NOMINA_DEFAULTS.pctHedf,
    pctHef: r.pct_hef != null ? Number(r.pct_hef) : PARAMS_NOMINA_DEFAULTS.pctHef,
    pctRecargoNocturnoDominical:
      r.pct_recargo_nocturno_dominical != null
        ? Number(r.pct_recargo_nocturno_dominical)
        : PARAMS_NOMINA_DEFAULTS.pctRecargoNocturnoDominical,
    pctPagoIncapacidad:
      r.pct_pago_incapacidad != null ? Number(r.pct_pago_incapacidad) : PARAMS_NOMINA_DEFAULTS.pctPagoIncapacidad,
  }
}

/** Lista todas las vigencias, ordenadas por fecha_desde (más reciente primero). */
export async function getVigenciasParametros(): Promise<{
  success: boolean
  data?: VigenciaParametros[]
  message?: string
}> {
  try {
    const admin: any = await getSupabaseAdmin()
    const { data, error } = await admin
      .from("parametros_legales_vigencia")
      .select("*")
      .order("fecha_desde", { ascending: false })
    if (error) return { success: false, message: error.message }
    return { success: true, data: (data || []).map(rowToVigencia) }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al leer las vigencias." }
  }
}

/**
 * Guarda (upsert por fecha_desde) una vigencia. Además sincroniza SMLV/auxilio (y el
 * resto) a `parametros_legales_anio` del AÑO de esa fecha, para que los consumidores
 * que siguen leyendo por año (parafiscales, ausentismos, liquidaciones) queden al día.
 */
export async function guardarVigenciaParametros(v: VigenciaParametros, clave?: string): Promise<{ success: boolean; message?: string }> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Liquidaciones", "configurar", { clave: clave ?? "", idempresa: null, referencia: `vigencia parámetros ${v?.fechaDesde}` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  if (!v?.fechaDesde || !/^\d{4}-\d{2}-\d{2}$/.test(v.fechaDesde))
    return { success: false, message: "Fecha de vigencia inválida (use AAAA-MM-DD)." }
  try {
    const admin: any = await getSupabaseAdmin()
    const payload = {
      smlv: v.smlv,
      auxilio_transporte: v.auxilio,
      dias_calendario: v.diasCalendario,
      jornada_horas: v.jornadaHoras,
      pct_hed: v.pctHed,
      pct_hen: v.pctHen,
      pct_hn: v.pctHn,
      pct_recargo_dominical: v.pctRecargoDominical,
      pct_hedf: v.pctHedf,
      pct_hef: v.pctHef,
      pct_recargo_nocturno_dominical: v.pctRecargoNocturnoDominical,
      pct_pago_incapacidad: v.pctPagoIncapacidad,
      actualizado_at: new Date().toISOString(),
    }
    const { error } = await admin
      .from("parametros_legales_vigencia")
      .upsert({ fecha_desde: v.fechaDesde, ...payload }, { onConflict: "fecha_desde" })
    if (error) return { success: false, message: error.message }
    // Sincronizar el año (no bloquea si falla; parametros_legales_anio es solo para los legados).
    const anio = Number(v.fechaDesde.slice(0, 4))
    try {
      await admin.from("parametros_legales_anio").upsert({ anio, ...payload }, { onConflict: "anio" })
    } catch {
      /* legacy sync best-effort */
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar la vigencia." }
  }
}

/** Elimina una vigencia por su fecha_desde. */
export async function eliminarVigenciaParametros(fechaDesde: string, clave?: string): Promise<{ success: boolean; message?: string }> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Liquidaciones", "configurar", { clave: clave ?? "", idempresa: null, referencia: `eliminar vigencia ${fechaDesde}` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin.from("parametros_legales_vigencia").delete().eq("fecha_desde", fechaDesde)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al eliminar la vigencia." }
  }
}

// Mapea la fila cruda de la tabla a ParametrosNomina, aplicando defaults si una
// columna viniera nula (p.ej. filas viejas antes de correr la migración).
function rowToParametros(anio: number, r: any | null): ParametrosNomina {
  return {
    anio,
    smlv: Number(r?.smlv) || 0,
    auxilio: Number(r?.auxilio_transporte) || 0,
    diasCalendario: r?.dias_calendario != null ? Number(r.dias_calendario) : PARAMS_NOMINA_DEFAULTS.diasCalendario,
    jornadaHoras: r?.jornada_horas != null ? Number(r.jornada_horas) : PARAMS_NOMINA_DEFAULTS.jornadaHoras,
    pctHed: r?.pct_hed != null ? Number(r.pct_hed) : PARAMS_NOMINA_DEFAULTS.pctHed,
    pctHen: r?.pct_hen != null ? Number(r.pct_hen) : PARAMS_NOMINA_DEFAULTS.pctHen,
    pctHn: r?.pct_hn != null ? Number(r.pct_hn) : PARAMS_NOMINA_DEFAULTS.pctHn,
    pctRecargoDominical:
      r?.pct_recargo_dominical != null ? Number(r.pct_recargo_dominical) : PARAMS_NOMINA_DEFAULTS.pctRecargoDominical,
    pctHedf: r?.pct_hedf != null ? Number(r.pct_hedf) : PARAMS_NOMINA_DEFAULTS.pctHedf,
    pctHef: r?.pct_hef != null ? Number(r.pct_hef) : PARAMS_NOMINA_DEFAULTS.pctHef,
    pctRecargoNocturnoDominical:
      r?.pct_recargo_nocturno_dominical != null
        ? Number(r.pct_recargo_nocturno_dominical)
        : PARAMS_NOMINA_DEFAULTS.pctRecargoNocturnoDominical,
    pctPagoIncapacidad:
      r?.pct_pago_incapacidad != null ? Number(r.pct_pago_incapacidad) : PARAMS_NOMINA_DEFAULTS.pctPagoIncapacidad,
  }
}

// Lee los parámetros del año. Si no existe la fila, devuelve defaults (con SMLV/aux
// en 0 para que el usuario los cargue). success=true igual, con `existe` para la UI.
export async function getParametrosNomina(
  anio: number,
): Promise<{ success: boolean; data?: ParametrosNomina; existe?: boolean; message?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()
    const { data, error } = await admin
      .from("parametros_legales_anio")
      .select("*")
      .eq("anio", anio)
      .maybeSingle()
    if (error) return { success: false, message: error.message }
    return { success: true, data: rowToParametros(anio, data), existe: !!data }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al leer los parámetros." }
  }
}

// Guarda (upsert por anio) SOLO las columnas del cuadro de mando. No toca
// dias_cargo_empleador / pct_pago_incapacidad (los usa SST/ausentismos).
export async function guardarParametrosNomina(
  p: ParametrosNomina,
  clave?: string,
): Promise<{ success: boolean; message?: string }> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Liquidaciones", "configurar", { clave: clave ?? "", idempresa: null, referencia: `parámetros de nómina ${p?.anio}` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  if (!p?.anio) return { success: false, message: "Año inválido." }
  try {
    const admin: any = await getSupabaseAdmin()
    const payload = {
      anio: p.anio,
      smlv: p.smlv,
      auxilio_transporte: p.auxilio,
      dias_calendario: p.diasCalendario,
      jornada_horas: p.jornadaHoras,
      pct_hed: p.pctHed,
      pct_hen: p.pctHen,
      pct_hn: p.pctHn,
      pct_recargo_dominical: p.pctRecargoDominical,
      pct_hedf: p.pctHedf,
      pct_hef: p.pctHef,
      pct_recargo_nocturno_dominical: p.pctRecargoNocturnoDominical,
      actualizado_at: new Date().toISOString(),
    }
    const { error } = await admin
      .from("parametros_legales_anio")
      .upsert(payload, { onConflict: "anio" })
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar los parámetros." }
  }
}
