"use server"

/**
 * CICLO DE FACTURACIÓN (Gestión Financiera › Facturación).
 *
 * Flujo documental que arranca en los anexos que ya genera la Prefactura de
 * Cuadro de Control (tabla `prefacturas`, origen `cuadro_control` -- ÚNICA
 * fuente de anexos para los 4 proyectos, confirmado por el usuario
 * 2026-09-11: ya incluye la tolva de Indupan/Avimol como una fila más del
 * resumen, agrupada por owner igual que Cargue/Descargue. El origen
 * `produccion`, viejo, solo queda para el historial ya guardado con ese
 * origen -- la generación (manual o automática) ya no lo usa):
 *
 *   pendiente_anexo -> pendiente_firma_anexo -> pendiente_factura ->
 *   pendiente_firma_factura -> pendiente_cierre -> cerrado
 *
 * Cada paso lo da una persona distinta (sin un rol de usuario real en el
 * sistema, se usan 2 permisos booleanos: `ciclo_facturacion_jefe` para
 * enviar anexo/factura/cerrar, `ciclo_facturacion_coordinador` para subir los
 * documentos ya firmados por el cliente). `prefactura_ciclo_eventos` es un
 * log APPEND-ONLY: nunca se borra ni se sobreescribe, así que una corrección
 * queda registrada (no oculta) -- el evento más reciente de cada tipo es el
 * vigente.
 *
 * Al CERRAR (marcarCierre) arranca la cartera/cobro: se calcula
 * `dias_plazo`/`fecha_vencimiento` según `condiciones_pago_owner`, y desde ahí
 * `registrarPago` lleva el saldo. Ver scripts/165_add_ciclo_facturacion.sql.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { segundoFactorPendiente } from "@/lib/seguridad-servidor"
import { getAccessibleEmpresesFromPermisos } from "@/lib/orders-actions"
import {
  getPrefactura,
  getControlFacturacion,
  guardarPrefactura,
  buscarSolapesCuadroControl,
  type Advertencia,
  type SoporteLinea,
  type UnidadCobro,
} from "@/lib/facturacion-control-actions"
import { valorListoParaAnexo, tonListoParaAnexo } from "@/lib/facturacion-control-shared"
import { ownerDePrefactura, fechaAyerColombiaISO } from "@/lib/ciclo-facturacion-shared"
import { getUserPermissions } from "@/lib/permissions-actions"

export type EstadoCiclo =
  | "pendiente_anexo"
  | "pendiente_firma_anexo"
  | "pendiente_factura"
  | "pendiente_firma_factura"
  | "pendiente_cierre"
  | "cerrado"

export type EstadoCobro = "pendiente" | "parcial" | "pagada"

export type TipoEventoCiclo =
  | "anexo_enviado"
  | "anexo_firmado"
  | "factura_enviada"
  | "factura_firmada"
  | "cierre"
  | "correccion_solicitada"

/** Etapas que sí producen un archivo y avanzan el ciclo (todas menos cierre/corrección). */
export type EtapaDocumento = "anexo_enviado" | "anexo_firmado" | "factura_enviada" | "factura_firmada"

/** Etapa que se puede corregir (las 4 documentales + el cierre). */
export type EtapaCorregible = EtapaDocumento | "cierre"

export interface EventoCiclo {
  id: number
  evento: TipoEventoCiclo
  archivo_url: string | null
  archivo_nombre: string | null
  usuario: string
  nota: string | null
  created_at: string
}

export interface PrefacturaCiclo {
  id: number
  origen: "cuadro_control" | "produccion"
  idempresa: number
  proyecto: string | null
  owner: string
  ownerMezclado: boolean // true si lineas trae más de un owner distinto -- revisar manualmente
  periodo_desde: string | null
  periodo_hasta: string | null
  total: number
  estado_ciclo: EstadoCiclo
  ciclo_actualizado_en: string | null
  ultimoEvento: EventoCiclo | null
  // Cartera (solo tiene sentido una vez cerrado)
  estado_cobro: EstadoCobro
  valor_pagado: number
  saldo: number
  dias_plazo: number | null
  fecha_vencimiento: string | null
  diasVencida: number | null // positivo = vencida hace N días; negativo = faltan N días; null = sin cerrar aún
  // Advertencias detectadas al generar (sin tarifa/sin gestionar/pago no cuadra/
  // avisos de producción) -- se llenan sobre todo cuando la prefactura se
  // generó SOLA (cron), para que el Jefe la revise después.
  advertencias: { tipo: string; detalle: string }[]
}

export interface PagoPrefactura {
  id: number
  fecha: string
  valor: number
  observacion: string | null
  usuario: string | null
  created_at: string
}

const TRANSICION: Record<EtapaDocumento, { requiere: EstadoCiclo; siguiente: EstadoCiclo }> = {
  anexo_enviado: { requiere: "pendiente_anexo", siguiente: "pendiente_firma_anexo" },
  anexo_firmado: { requiere: "pendiente_firma_anexo", siguiente: "pendiente_factura" },
  factura_enviada: { requiere: "pendiente_factura", siguiente: "pendiente_firma_factura" },
  factura_firmada: { requiere: "pendiente_firma_factura", siguiente: "pendiente_cierre" },
}

/** A qué estado_ciclo se regresa al corregir cada etapa (reabre esa etapa para volver a subir el archivo correcto). */
const ESTADO_ANTERIOR: Record<EtapaCorregible, EstadoCiclo> = {
  anexo_enviado: "pendiente_anexo",
  anexo_firmado: "pendiente_firma_anexo",
  factura_enviada: "pendiente_factura",
  factura_firmada: "pendiente_firma_factura",
  cierre: "pendiente_cierre",
}

// ---------------------------------------------------------------------------
// Blindaje SERVER-SIDE de "cada quien tiene su pedazo" -- hasta ahora los
// botones de acción solo se ESCONDÍAN en la UI si el rol no coincidía
// (`necesitaMiAccion`/`puedoActuar` en components/ciclo-facturacion.tsx), sin
// que el server action verificara nada -- mismo hueco ya identificado y
// corregido antes en otro módulo de este proyecto ("Facturar por orden":
// "blindaje server-side, no confiar solo en el disabled de la UI"). Ahora
// cada escritura verifica el permiso REAL de quien llama (sesión del
// servidor, `getUserPermissions()` -- no un booleano que mande el cliente).
const ROL_POR_ESTADO: Record<EstadoCiclo, "jefe" | "coordinador" | null> = {
  pendiente_anexo: "jefe",
  pendiente_firma_anexo: "coordinador",
  pendiente_factura: "jefe",
  pendiente_firma_factura: "coordinador",
  pendiente_cierre: "jefe",
  cerrado: null,
}

async function verificarPermisoCiclo(rol: "jefe" | "coordinador"): Promise<string | null> {
  const permisos = await getUserPermissions()
  const tienePermiso = rol === "jefe" ? permisos?.ciclo_facturacion_jefe : permisos?.ciclo_facturacion_coordinador
  if (!tienePermiso) {
    return `No tienes el permiso de ${rol === "jefe" ? "Jefe de Facturación" : "Coordinador"} en Ciclo de Facturación -- este paso no te corresponde.`
  }
  // Segundo factor (2026-10-05): si la cuenta lo tiene activado, esta sesión debe haberlo
  // verificado. Quien no lo tiene activado sigue igual que hoy; ningún permiso cambia.
  return segundoFactorPendiente(`ciclo-facturacion:${rol}`)
}

const LABEL_ETAPA: Record<EtapaCorregible, string> = {
  anexo_enviado: "Anexo enviado",
  anexo_firmado: "Anexo firmado",
  factura_enviada: "Factura enviada",
  factura_firmada: "Factura firmada",
  cierre: "Cierre",
}

function diasEntre(desde: string, hasta: string): number {
  const a = new Date(desde + "T00:00:00")
  const b = new Date(hasta + "T00:00:00")
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export async function listarCicloFacturacion(filtros?: {
  idempresa?: number | null
  estado_ciclo?: EstadoCiclo | null
  estado_cobro?: EstadoCobro | null
  // Histórico real (igual que Cuadro de Control de Facturación): sin rango,
  // trae TODO lo accesible; con rango, solo las prefacturas cuyo período
  // toca ese rango (comparación de solapamiento, no de igualdad exacta).
  periodo_desde?: string | null
  periodo_hasta?: string | null
}): Promise<{ success: boolean; data: PrefacturaCiclo[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const accesibles = await getAccessibleEmpresesFromPermisos()
    const idsAccesibles = accesibles.map((e) => e.id)
    if (idsAccesibles.length === 0) return { success: true, data: [] }

    let query = sb
      .from("prefacturas")
      .select(
        "id, origen, idempresa, proyecto, periodo_desde, periodo_hasta, total, lineas, estado_ciclo, ciclo_actualizado_en, estado_cobro, valor_pagado, dias_plazo, fecha_vencimiento, advertencias",
      )
      .eq("estado", "aprobada")
      .in("idempresa", idsAccesibles)
      .order("ciclo_actualizado_en", { ascending: true, nullsFirst: true })

    if (filtros?.idempresa) query = query.eq("idempresa", filtros.idempresa)
    if (filtros?.estado_ciclo) query = query.eq("estado_ciclo", filtros.estado_ciclo)
    if (filtros?.estado_cobro) query = query.eq("estado_cobro", filtros.estado_cobro)
    if (filtros?.periodo_desde) query = query.gte("periodo_hasta", filtros.periodo_desde)
    if (filtros?.periodo_hasta) query = query.lte("periodo_desde", filtros.periodo_hasta)

    const { data, error } = await query
    if (error) return { success: false, data: [], message: error.message }

    const ids = (data || []).map((r: any) => r.id)
    const ultimosPorPrefactura = new Map<number, EventoCiclo>()
    if (ids.length > 0) {
      const { data: eventos } = await sb
        .from("prefactura_ciclo_eventos")
        .select("id, prefactura_id, evento, archivo_url, archivo_nombre, usuario, nota, created_at")
        .in("prefactura_id", ids)
        .order("created_at", { ascending: true })
      for (const e of eventos || []) {
        ultimosPorPrefactura.set(e.prefactura_id, e) // el último en iterar (orden asc) queda como el más reciente
      }
    }

    const hoy = new Date().toISOString().slice(0, 10)
    const out: PrefacturaCiclo[] = (data || []).map((r: any) => {
      const { owner, ownerMezclado } = ownerDePrefactura(r.lineas)
      const total = Number(r.total || 0)
      const valorPagado = Number(r.valor_pagado || 0)
      return {
        id: r.id,
        origen: r.origen,
        idempresa: r.idempresa,
        proyecto: r.proyecto,
        owner,
        ownerMezclado,
        periodo_desde: r.periodo_desde,
        periodo_hasta: r.periodo_hasta,
        total,
        estado_ciclo: r.estado_ciclo,
        ciclo_actualizado_en: r.ciclo_actualizado_en,
        ultimoEvento: ultimosPorPrefactura.get(r.id) || null,
        estado_cobro: r.estado_cobro,
        valor_pagado: valorPagado,
        saldo: Math.max(0, total - valorPagado),
        dias_plazo: r.dias_plazo,
        fecha_vencimiento: r.fecha_vencimiento,
        diasVencida: r.fecha_vencimiento ? diasEntre(r.fecha_vencimiento, hoy) : null,
        advertencias: r.advertencias || [],
      }
    })

    return { success: true, data: out }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al listar el ciclo de facturación." }
  }
}

export async function getEventosCiclo(prefacturaId: number): Promise<{ success: boolean; data: EventoCiclo[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("prefactura_ciclo_eventos")
      .select("id, evento, archivo_url, archivo_nombre, usuario, nota, created_at")
      .eq("prefactura_id", prefacturaId)
      .order("created_at", { ascending: true })
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: data || [] }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer el historial." }
  }
}

// ---------------------------------------------------------------------------
// Escritura -- avance del ciclo
// ---------------------------------------------------------------------------

export async function registrarEventoCiclo(
  prefacturaId: number,
  evento: EtapaDocumento,
  archivos: { url: string; nombre: string }[],
  usuario: string,
  /** true SOLO para la llamada interna del cron (app/api/cron/anexos-
   *  pendientes/route.ts), que ya se autentica aparte con CRON_SECRET antes
   *  de llegar aquí y no tiene sesión de usuario -- nunca lo pase la UI. */
  origenSistema = false,
): Promise<{ success: boolean; message?: string }> {
  if (!archivos.length) return { success: false, message: "Adjunta al menos un archivo." }
  try {
    if (!origenSistema) {
      const rolRequerido = evento === "anexo_enviado" || evento === "factura_enviada" ? "jefe" : "coordinador"
      const errPermiso = await verificarPermisoCiclo(rolRequerido)
      if (errPermiso) return { success: false, message: errPermiso }
    }
    const sb: any = await getSupabaseAdmin()
    const { data: pref, error: errPref } = await sb
      .from("prefacturas")
      .select("id, estado, estado_ciclo")
      .eq("id", prefacturaId)
      .maybeSingle()
    if (errPref) return { success: false, message: errPref.message }
    if (!pref) return { success: false, message: "Prefactura no encontrada." }
    if (pref.estado !== "aprobada") return { success: false, message: "Esta prefactura todavía no está aprobada." }

    const transicion = TRANSICION[evento]
    if (pref.estado_ciclo !== transicion.requiere) {
      return {
        success: false,
        message: `Esta prefactura está en "${pref.estado_ciclo}", no en "${transicion.requiere}" -- no se puede registrar "${evento}" ahora.`,
      }
    }

    const filas = archivos.map((a) => ({
      prefactura_id: prefacturaId,
      evento,
      archivo_url: a.url,
      archivo_nombre: a.nombre,
      usuario,
    }))
    const { error: errIns } = await sb.from("prefactura_ciclo_eventos").insert(filas)
    if (errIns) return { success: false, message: errIns.message }

    const { error: errUpd } = await sb
      .from("prefacturas")
      .update({ estado_ciclo: transicion.siguiente, ciclo_actualizado_en: new Date().toISOString() })
      .eq("id", prefacturaId)
    if (errUpd) return { success: false, message: errUpd.message }

    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al registrar el evento." }
  }
}

export async function solicitarCorreccion(
  prefacturaId: number,
  etapa: EtapaCorregible,
  nota: string,
  usuario: string,
): Promise<{ success: boolean; message?: string }> {
  if (!nota?.trim()) return { success: false, message: "Escribe el motivo de la corrección." }
  try {
    // Solo puede corregir SU PROPIA acción -- quien mandó el anexo/factura
    // (o cerró) es quien puede pedir rehacerla, no el otro rol.
    const rolQueLaHizo = ROL_POR_ESTADO[ESTADO_ANTERIOR[etapa]]
    if (rolQueLaHizo) {
      const errPermiso = await verificarPermisoCiclo(rolQueLaHizo)
      if (errPermiso) return { success: false, message: errPermiso }
    }
    const sb: any = await getSupabaseAdmin()
    const { data: pref, error: errPref } = await sb
      .from("prefacturas")
      .select("id, estado_ciclo")
      .eq("id", prefacturaId)
      .maybeSingle()
    if (errPref) return { success: false, message: errPref.message }
    if (!pref) return { success: false, message: "Prefactura no encontrada." }

    if (etapa === "cierre") {
      const { count, error: errPagos } = await sb
        .from("prefactura_pagos")
        .select("id", { count: "exact", head: true })
        .eq("prefactura_id", prefacturaId)
      if (errPagos) return { success: false, message: errPagos.message }
      if ((count || 0) > 0) {
        return {
          success: false,
          message: "No se puede corregir el cierre: ya hay pagos registrados sobre esta factura. Revisa los pagos primero.",
        }
      }
    }

    const { error: errIns } = await sb.from("prefactura_ciclo_eventos").insert({
      prefactura_id: prefacturaId,
      evento: "correccion_solicitada",
      usuario,
      nota: `[${LABEL_ETAPA[etapa]}] ${nota.trim()}`,
    })
    if (errIns) return { success: false, message: errIns.message }

    const updatePayload: Record<string, unknown> = {
      estado_ciclo: ESTADO_ANTERIOR[etapa],
      ciclo_actualizado_en: new Date().toISOString(),
    }
    if (etapa === "cierre") {
      updatePayload.estado_cobro = "pendiente"
      updatePayload.dias_plazo = null
      updatePayload.fecha_vencimiento = null
      updatePayload.valor_pagado = 0
      updatePayload.fecha_ultimo_pago = null
    }

    const { error: errUpd } = await sb.from("prefacturas").update(updatePayload).eq("id", prefacturaId)
    if (errUpd) return { success: false, message: errUpd.message }

    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al solicitar la corrección." }
  }
}

export async function marcarCierre(prefacturaId: number, usuario: string): Promise<{ success: boolean; message?: string }> {
  try {
    const errPermiso = await verificarPermisoCiclo("jefe") // pendiente_cierre -> cerrado siempre es del Jefe.
    if (errPermiso) return { success: false, message: errPermiso }
    const sb: any = await getSupabaseAdmin()
    const { data: pref, error: errPref } = await sb
      .from("prefacturas")
      .select("id, estado_ciclo, lineas")
      .eq("id", prefacturaId)
      .maybeSingle()
    if (errPref) return { success: false, message: errPref.message }
    if (!pref) return { success: false, message: "Prefactura no encontrada." }
    if (pref.estado_ciclo !== "pendiente_cierre") {
      return { success: false, message: `Esta prefactura está en "${pref.estado_ciclo}", no está lista para cerrar todavía.` }
    }

    const { owner } = ownerDePrefactura(pref.lineas)
    const { data: cond } = await sb
      .from("condiciones_pago_owner")
      .select("dias_plazo")
      .eq("owner", owner)
      .maybeSingle()
    const diasPlazo = cond?.dias_plazo ?? 30
    if (!cond) {
      // Siembra silenciosa: para que el owner aparezca en la pantalla de
      // configuración con su default, en vez de quedar invisible.
      await sb.from("condiciones_pago_owner").upsert({ owner, dias_plazo: 30 }, { onConflict: "owner" })
    }

    const hoy = new Date()
    const vencimiento = new Date(hoy)
    vencimiento.setDate(vencimiento.getDate() + diasPlazo)
    const fechaVencimiento = vencimiento.toISOString().slice(0, 10)

    const { error: errIns } = await sb.from("prefactura_ciclo_eventos").insert({
      prefactura_id: prefacturaId,
      evento: "cierre",
      usuario,
    })
    if (errIns) return { success: false, message: errIns.message }

    const { error: errUpd } = await sb
      .from("prefacturas")
      .update({
        estado_ciclo: "cerrado",
        ciclo_actualizado_en: new Date().toISOString(),
        dias_plazo: diasPlazo,
        fecha_vencimiento: fechaVencimiento,
      })
      .eq("id", prefacturaId)
    if (errUpd) return { success: false, message: errUpd.message }

    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al cerrar la facturación." }
  }
}

/** Soporte (anexo) congelado de la prefactura -- para previsualizarlo sin salir del módulo. */
export async function getSoporteDePrefactura(prefacturaId: number): Promise<{ success: boolean; data: SoporteLinea[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb.from("prefacturas").select("soporte").eq("id", prefacturaId).maybeSingle()
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: (data?.soporte as SoporteLinea[]) || [] }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer el soporte." }
  }
}

// ---------------------------------------------------------------------------
// Cartera / cobro (solo aplica una vez cerrado)
// ---------------------------------------------------------------------------

export async function registrarPago(
  prefacturaId: number,
  pago: { fecha: string; valor: number; observacion?: string; usuario: string },
): Promise<{ success: boolean; message?: string }> {
  // Segundo factor (2026-10-05): solo detiene a quien lo tiene activado y no lo verificó.
  const segundoFactor = await segundoFactorPendiente("ciclo-facturacion:registrarPago")
  if (segundoFactor) return { success: false, message: segundoFactor }
  if (!(pago.valor > 0)) return { success: false, message: "El valor del pago debe ser mayor a 0." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: pref, error: errPref } = await sb
      .from("prefacturas")
      .select("id, estado_ciclo, total, valor_pagado")
      .eq("id", prefacturaId)
      .maybeSingle()
    if (errPref) return { success: false, message: errPref.message }
    if (!pref) return { success: false, message: "Prefactura no encontrada." }
    if (pref.estado_ciclo !== "cerrado") return { success: false, message: "Esta factura todavía no está cerrada -- no se puede registrar cobro." }

    const total = Number(pref.total || 0)
    const pagadoActual = Number(pref.valor_pagado || 0)
    // Tolerancia de 1 peso por redondeo -- no bloquea un pago que cuadra el saldo justo.
    if (pagadoActual + pago.valor > total + 1) {
      return {
        success: false,
        message: `Ese pago (${pago.valor.toLocaleString("es-CO")}) deja el saldo en negativo -- el pendiente es ${(total - pagadoActual).toLocaleString("es-CO")}.`,
      }
    }

    const { error: errIns } = await sb.from("prefactura_pagos").insert({
      prefactura_id: prefacturaId,
      fecha: pago.fecha,
      valor: pago.valor,
      observacion: pago.observacion || null,
      usuario: pago.usuario,
    })
    if (errIns) return { success: false, message: errIns.message }

    const { data: pagos } = await sb.from("prefactura_pagos").select("fecha, valor").eq("prefactura_id", prefacturaId)
    const valorPagado = (pagos || []).reduce((s: number, p: any) => s + Number(p.valor || 0), 0)
    const fechaUltimoPago = (pagos || []).reduce((max: string | null, p: any) => (!max || p.fecha > max ? p.fecha : max), null as string | null)
    const estadoCobro: EstadoCobro = valorPagado >= total - 1 ? "pagada" : valorPagado > 0 ? "parcial" : "pendiente"

    const { error: errUpd } = await sb
      .from("prefacturas")
      .update({ valor_pagado: valorPagado, estado_cobro: estadoCobro, fecha_ultimo_pago: fechaUltimoPago })
      .eq("id", prefacturaId)
    if (errUpd) return { success: false, message: errUpd.message }

    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al registrar el pago." }
  }
}

export async function getPagosDe(prefacturaId: number): Promise<{ success: boolean; data: PagoPrefactura[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("prefactura_pagos")
      .select("id, fecha, valor, observacion, usuario, created_at")
      .eq("prefactura_id", prefacturaId)
      .order("fecha", { ascending: false })
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: data || [] }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer los pagos." }
  }
}

export async function getCondicionesPagoOwner(): Promise<{ success: boolean; data: { owner: string; dias_plazo: number }[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb.from("condiciones_pago_owner").select("owner, dias_plazo").order("owner")
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: data || [] }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer las condiciones de pago." }
  }
}

export interface CondicionEnvioAnexo {
  idempresa: number
  proyecto: string
  frecuencia: "diario" | "semanal"
  dia_semana: number | null // 0=domingo..6=sábado
}

/** Frecuencia de envío automático de anexos, POR PROYECTO -- usada por el cron semanal (app/api/cron/anexos-pendientes/route.ts). Trae los 4 proyectos (SIG_CLIENTES_LIP) con su config guardada, o el default (semanal, lunes) si no tienen fila propia. */
export async function getCondicionesEnvioAnexo(): Promise<{ success: boolean; data: CondicionEnvioAnexo[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: empresas, error: errEmp } = await sb.from("empresas_permisos").select("id, nombre").in("id", [1, 2, 3, 4]).order("id")
    if (errEmp) return { success: false, data: [], message: errEmp.message }
    const { data: condiciones, error: errCond } = await sb.from("condiciones_envio_anexo").select("idempresa, frecuencia, dia_semana")
    if (errCond) return { success: false, data: [], message: errCond.message }
    const porEmpresa = new Map<number, { frecuencia: string; dia_semana: number | null }>()
    for (const c of condiciones || []) porEmpresa.set(c.idempresa, c)
    const out: CondicionEnvioAnexo[] = (empresas || []).map((e: any) => {
      const c = porEmpresa.get(e.id)
      return {
        idempresa: e.id,
        proyecto: e.nombre,
        frecuencia: (c?.frecuencia as "diario" | "semanal") || "semanal",
        dia_semana: c ? c.dia_semana : 1,
      }
    })
    return { success: true, data: out }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer la frecuencia de envío." }
  }
}

export async function actualizarCondicionEnvioAnexo(
  idempresa: number,
  frecuencia: "diario" | "semanal",
  dia_semana: number | null,
): Promise<{ success: boolean; message?: string }> {
  const segundoFactor = await segundoFactorPendiente("ciclo-facturacion:condicionEnvioAnexo")
  if (segundoFactor) return { success: false, message: segundoFactor }
  if (!idempresa) return { success: false, message: "Falta el proyecto." }
  if (frecuencia === "semanal" && (dia_semana === null || dia_semana < 0 || dia_semana > 6)) {
    return { success: false, message: "Selecciona un día de la semana válido." }
  }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb
      .from("condiciones_envio_anexo")
      .upsert({ idempresa, frecuencia, dia_semana: frecuencia === "diario" ? null : dia_semana }, { onConflict: "idempresa" })
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar la frecuencia de envío." }
  }
}

export interface CondicionGeneracionPrefactura {
  idempresa: number
  proyecto: string
  frecuencia: "diario" | "semanal" | "cortes"
  dia_semana: number | null // 0=domingo..6=sábado -- solo aplica si frecuencia="semanal"
  /** Días del mes (1-31) en los que el Jefe quiere un corte -- ej. [8,16,25].
   *  Cada valor es el ÚLTIMO día incluido en su período; el cron dispara al
   *  día siguiente (mismo patrón que "semanal": dispara lunes, cubre hasta
   *  el domingo) y recorta contra el último día real del mes, así que un
   *  corte en 31 también sirve como "fin de mes" en meses más cortos. Se
   *  repite todos los meses sin volver a configurarse. Solo aplica si
   *  frecuencia="cortes". */
  dias_corte: number[]
  activo: boolean
  /** Fecha desde la que factura la PRIMERA prefactura automática de este
   *  proyecto, si nunca ha tenido ninguna (ver Fase A del cron). Decisión
   *  explícita del Jefe, una sola vez por proyecto -- de ahí en adelante el
   *  período sigue solo, contiguo. Sin esto Y sin historial previo, el cron
   *  no genera nada (nunca adivina una fecha de arranque). */
  fecha_inicio: string | null
}

/** Frecuencia de GENERACIÓN automática de la prefactura, POR PROYECTO -- usada
 *  por el cron diario (app/api/cron/anexos-pendientes/route.ts, Fase A).
 *  Separada a propósito de `condiciones_envio_anexo` (esa es solo para el
 *  envío de un anexo de una prefactura que YA existe): generar el documento
 *  desde cero es una decisión más delicada, así que sin fila propia el
 *  default es `activo=false` -- cada proyecto se prende a mano, nunca por
 *  omisión. */
export async function getCondicionesGeneracionPrefactura(): Promise<{ success: boolean; data: CondicionGeneracionPrefactura[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: empresas, error: errEmp } = await sb.from("empresas_permisos").select("id, nombre").in("id", [1, 2, 3, 4]).order("id")
    if (errEmp) return { success: false, data: [], message: errEmp.message }
    const { data: condiciones, error: errCond } = await sb.from("condiciones_generacion_prefactura").select("idempresa, frecuencia, dia_semana, dias_corte, activo, fecha_inicio")
    if (errCond) return { success: false, data: [], message: errCond.message }
    const porEmpresa = new Map<number, { frecuencia: string; dia_semana: number | null; dias_corte: number[] | null; activo: boolean; fecha_inicio: string | null }>()
    for (const c of condiciones || []) porEmpresa.set(c.idempresa, c)
    const out: CondicionGeneracionPrefactura[] = (empresas || []).map((e: any) => {
      const c = porEmpresa.get(e.id)
      return {
        idempresa: e.id,
        proyecto: e.nombre,
        frecuencia: (c?.frecuencia as "diario" | "semanal" | "cortes") || "semanal",
        dia_semana: c ? c.dia_semana : 1,
        dias_corte: c?.dias_corte ?? [],
        activo: c?.activo === true,
        fecha_inicio: c?.fecha_inicio ?? null,
      }
    })
    return { success: true, data: out }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer la frecuencia de generación." }
  }
}

export async function actualizarCondicionGeneracionPrefactura(
  idempresa: number,
  frecuencia: "diario" | "semanal" | "cortes",
  dia_semana: number | null,
  activo: boolean,
  fecha_inicio: string | null,
  dias_corte: number[] | null = null,
): Promise<{ success: boolean; message?: string }> {
  const segundoFactor = await segundoFactorPendiente("ciclo-facturacion:condicionGeneracionPrefactura")
  if (segundoFactor) return { success: false, message: segundoFactor }
  if (!idempresa) return { success: false, message: "Falta el proyecto." }
  if (frecuencia === "semanal" && (dia_semana === null || dia_semana < 0 || dia_semana > 6)) {
    return { success: false, message: "Selecciona un día de la semana válido." }
  }
  const diasCorteLimpios = Array.from(new Set((dias_corte || []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31))).sort((a, b) => a - b)
  if (frecuencia === "cortes" && diasCorteLimpios.length === 0) {
    return { success: false, message: "Agrega al menos un día de corte (1-31)." }
  }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb
      .from("condiciones_generacion_prefactura")
      .upsert(
        {
          idempresa,
          frecuencia,
          dia_semana: frecuencia === "semanal" ? dia_semana : null,
          dias_corte: frecuencia === "cortes" ? diasCorteLimpios : null,
          activo,
          fecha_inicio: fecha_inicio || null,
        },
        { onConflict: "idempresa" },
      )
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar la frecuencia de generación." }
  }
}

const esTon = (u?: UnidadCobro) => u !== "h" && u !== "turno" && u !== "u"

function diaSiguienteISO(fechaISO: string): string {
  const d = new Date(fechaISO + "T00:00:00")
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

function diaAnteriorISO(fechaISO: string): string {
  const d = new Date(fechaISO + "T00:00:00")
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export interface ResultadoGeneracionOwner {
  owner: string
  success: boolean
  /** "generada" = se creó una prefactura real; el resto son razones de por qué NO se creó nada para ESE owner (no son errores del sistema, son el resultado esperado de la regla de negocio). */
  estado: "generada" | "al_dia" | "nada_que_facturar" | "solape" | "error"
  mensaje: string
  prefacturaId?: number
  periodo?: { desde: string; hasta: string }
}

export interface ResultadoGeneracionManual {
  success: boolean
  estado: "generada" | "parcial" | "sin_fecha_inicio" | "sin_pendientes" | "error"
  mensaje: string
  resultados: ResultadoGeneracionOwner[]
}

/**
 * Dispara la MISMA lógica de generación automática que el cron diario
 * (`app/api/cron/anexos-pendientes/route.ts`, Fase A), pero para UN proyecto,
 * AHORA MISMO, desde un clic en la UI -- sin depender de `CRON_SECRET` (esto
 * corre autenticado como server action, no como endpoint HTTP) ni de esperar
 * a que el cron programado corra mañana. Pensado para poder PROBAR la
 * automatización de un proyecto (botón "Generar ahora" en el panel) y ver el
 * resultado al instante, en vez de configurar algo a ciegas y no tener forma
 * de saber si funcionó.
 *
 * SIEMPRE por Cuadro de Control (`getPrefactura`) -- confirmado por el
 * usuario 2026-09-11: "todo se factura con los anexos que salen de Cuadro de
 * Control de Facturación". Ya no existe una rama aparte para Indupan/Avimol
 * ("Prefactura de Producción"): el resumen de Cuadro de Control YA incluye la
 * tolva de Indupan y la de Avimol como una fila más (bloque="produccion"),
 * agrupada por owner igual que Cargue/Descargue -- usar dos fuentes para lo
 * mismo era exactamente el bug que dejaba el Cargue de Indupan fuera del
 * ciclo (solo entraba la tolva vía la rama vieja).
 *
 * UN MISMO proyecto (idempresa) puede facturar a VARIOS clientes reales que
 * comparten el sitio físico (ej. Indupan: INDUPAN, AVIMOL, Molinos del
 * Atlántico) -- cada owner necesita su PROPIO anexo/firma/factura/cierre,
 * nunca mezclados en un solo documento. Por eso esta función arma UNA
 * prefactura POR OWNER (columna `owner` en `prefacturas`, ver
 * scripts/172_add_owner_prefacturas.sql), cada una con su propio período
 * contiguo independiente -- el owner A puede llevar facturado hasta el 5 y
 * el B hasta el 8, no tiene sentido compartir una sola fecha "desde".
 *
 * A propósito NO exige `condiciones_generacion_prefactura.activo=true` ni el
 * día de la semana configurado -- esas dos reglas son solo para decidir SI el
 * cron automático debe correr hoy; un clic manual ya es la decisión explícita
 * de la persona, así que se salta esas dos gates. SÍ respeta todo lo demás
 * (período contiguo, `fecha_inicio` como único arranque válido sin
 * inventar uno, solapes, "nada que facturar" -- las mismas protecciones
 * financieras del cron, ninguna se relaja).
 *
 * `rangoManual` (opcional): para proyectos NO diarios, el Jefe puede necesitar
 * generar un tramo puntual que no coincide con el período contiguo automático
 * (una excepción, un cierre anticipado) -- ver botón "Generar rango manual"
 * en la UI (usuario 2026-09-14: "para los proyectos que no son diarios debes
 * permitir realizarlo por rango de fecha"). Si se pasa, reemplaza el cálculo
 * automático de `desde`/`hasta` para TODOS los owners del proyecto, pero el
 * solape SIGUE revisándose igual (nunca se relaja esa protección) -- y si el
 * `desde` manual no coincide con el que habría calculado el período contiguo,
 * se guarda como advertencia (no bloquea) para que quede visible que puede
 * haber quedado un hueco sin facturar entre el corte anterior y este.
 */
export async function generarPrefacturaAhora(
  idempresa: number,
  usuario: string,
  rangoManual?: { desde: string; hasta: string },
): Promise<ResultadoGeneracionManual> {
  // Segundo factor (2026-10-05): solo detiene a quien lo tiene activado y no lo verificó.
  const segundoFactor = await segundoFactorPendiente("ciclo-facturacion:generarPrefacturaAhora")
  if (segundoFactor) return { success: false, estado: "error", mensaje: segundoFactor, resultados: [] }
  try {
    if (rangoManual && rangoManual.desde > rangoManual.hasta) {
      return { success: false, estado: "error", mensaje: "La fecha 'Desde' no puede ser posterior a 'Hasta'.", resultados: [] }
    }
    const sb: any = await getSupabaseAdmin()
    const { data: cond } = await sb
      .from("condiciones_generacion_prefactura")
      .select("fecha_inicio")
      .eq("idempresa", idempresa)
      .maybeSingle()
    const fechaInicioProyecto: string | null = cond?.fecha_inicio || null
    const hasta = rangoManual?.hasta || fechaAyerColombiaISO()

    // Última prefactura POR OWNER (no por proyecto) -- cada owner sigue su
    // propio período contiguo. Un owner sin prefactura previa arranca en
    // `fecha_inicio` (compartida a nivel de proyecto: sirve para el primer
    // arranque de TODOS sus owners reales, que en la práctica siempre
    // arrancan juntos la primera vez que se activa la automatización).
    const { data: previas } = await sb
      .from("prefacturas")
      .select("owner, periodo_hasta")
      .eq("idempresa", idempresa)
      .eq("origen", "cuadro_control")
      .eq("estado", "aprobada")
      .not("owner", "is", null)
      .order("periodo_hasta", { ascending: false })
    const ultimaPorOwner = new Map<string, string>()
    for (const p of previas || []) {
      if (!ultimaPorOwner.has(p.owner)) ultimaPorOwner.set(p.owner, p.periodo_hasta) // primera vista = la más reciente (ya viene ordenado desc)
    }

    // Descubrir TODOS los owners con algo pendiente: ventana amplia desde el
    // arranque más temprano posible (el owner más atrasado) hasta ayer -- o,
    // con rango manual, exactamente la ventana que pidió el Jefe. Si ni un
    // solo owner tiene historial NI hay fecha_inicio NI rango manual, no hay
    // desde dónde partir -- nunca se inventa un arranque.
    const desdeMasAntiguo = rangoManual
      ? rangoManual.desde
      : previas && previas.length > 0
        ? [...ultimaPorOwner.values()].map(diaSiguienteISO).sort()[0]
        : fechaInicioProyecto
    if (!desdeMasAntiguo) {
      return {
        success: false,
        estado: "sin_fecha_inicio",
        mensaje:
          "Este proyecto nunca ha tenido una prefactura y no tiene 'Fecha de inicio' guardada -- escríbela arriba y guarda antes de generar (es la única forma de decidir desde cuándo arranca, nunca se inventa una fecha).",
        resultados: [],
      }
    }
    if (desdeMasAntiguo > hasta) {
      return { success: true, estado: "sin_pendientes", mensaje: `Ya está al día -- no ha pasado un día completo por facturar (hasta ayer, ${hasta}).`, resultados: [] }
    }

    const descubrir = await getPrefactura(idempresa, { desde: desdeMasAntiguo, hasta })
    if (!descubrir.success || !descubrir.data) {
      return { success: false, estado: "error", mensaje: descubrir.message || "No se pudo calcular la prefactura.", resultados: [] }
    }
    const ownersConPendiente = Array.from(new Set(descubrir.data.resumen.filter((r) => valorListoParaAnexo(r) > 0).map((r) => r.owner))).sort()
    if (ownersConPendiente.length === 0) {
      return { success: true, estado: "sin_pendientes", mensaje: `No hay nada por facturar entre ${desdeMasAntiguo} y ${hasta}.`, resultados: [] }
    }

    const resultados: ResultadoGeneracionOwner[] = []
    for (const owner of ownersConPendiente) {
      const desdeAutomatico = ultimaPorOwner.has(owner) ? diaSiguienteISO(ultimaPorOwner.get(owner)!) : fechaInicioProyecto
      const desdeOwner = rangoManual ? rangoManual.desde : desdeAutomatico
      if (!desdeOwner) {
        // Owner nuevo, sin historial Y sin fecha_inicio -- no debería pasar
        // (fecha_inicio ya se validó arriba), pero por si acaso no se inventa nada.
        resultados.push({ owner, success: false, estado: "error", mensaje: "Sin fecha de arranque para este owner nuevo." })
        continue
      }
      if (desdeOwner > hasta) {
        resultados.push({ owner, success: true, estado: "al_dia", mensaje: `Ya está al día (próximo período empezaría en ${desdeOwner}).` })
        continue
      }

      const solapes = await buscarSolapesCuadroControl(idempresa, desdeOwner, hasta, owner)
      if (solapes.length > 0) {
        resultados.push({
          owner,
          success: false,
          estado: "solape",
          mensaje: `Ya hay prefactura(s) aprobada(s) que se cruzan con este período: ${solapes.map((s: any) => `#${s.id} ${s.periodo}`).join(", ")} -- no se generó para evitar cobrar dos veces.`,
        })
        continue
      }

      const [prefR, ctrlR] = await Promise.all([
        getPrefactura(idempresa, { desde: desdeOwner, hasta }),
        getControlFacturacion(idempresa, { desde: desdeOwner, hasta }),
      ])
      if (!prefR.success || !prefR.data) {
        resultados.push({ owner, success: false, estado: "error", mensaje: prefR.message || "No se pudo calcular la prefactura." })
        continue
      }
      const pref = prefR.data
      const lineas = pref.resumen
        .filter((r) => r.owner === owner && valorListoParaAnexo(r) > 0)
        .map((r) => ({
          owner: r.owner,
          servicio: r.operacion,
          toneladas: Number(tonListoParaAnexo(r).toFixed(3)),
          tarifa: r.tarifa,
          total: Math.round(valorListoParaAnexo(r)),
          fuente: r.fuente,
          unidad: r.unidad,
        }))
      if (lineas.length === 0) {
        resultados.push({ owner, success: true, estado: "nada_que_facturar", mensaje: `No hay nada por facturar entre ${desdeOwner} y ${hasta}.`, periodo: { desde: desdeOwner, hasta } })
        continue
      }
      // Bloque por grupo (owner|||operación|||unidad) -- necesario para saber,
      // línea por línea del detalle, si pertenece a un grupo "producción" (sin
      // validación por-orden, ej. Tolva) o "operación" (exige que el
      // Coordinador ya haya validado esa orden en Gestión de Facturas).
      const bloquePorGrupo = new Map(pref.resumen.map((r) => [`${r.owner}|||${r.operacion}|||${r.unidad}`, r.bloque]))
      const soporte = [
        ...pref.origen
          .filter((l) => {
            if (l.owner !== owner) return false
            const bloque = bloquePorGrupo.get(`${l.owner}|||${l.grupoResumen}|||${l.unidad}`)
            if (bloque === "produccion") return l.categoria !== "facturado"
            return l.estadofactura === "CF - Factura solicitada" && l.mediopago === "Crédito"
          })
          .map((l) => ({
            owner: l.owner,
            operacion: l.grupoResumen || "",
            servicio: l.servicio,
            fecha: l.fechacargue,
            numeroorden: l.numeroorden,
            placa: l.placa,
            cliente: l.cliente,
            producto: l.producto,
            toneladas: Number((l.toneladas || 0).toFixed(3)),
            tarifa: l.tarifaServicio,
            valor: Math.round(l.valorServicio),
            unidad: l.unidad,
            tiquete: l.tiquete,
          })),
        ...(pref.soporteProduccion || []).filter((l) => l.owner === owner),
      ].filter((l) => l.valor > 0)
      const total = Math.round(lineas.reduce((s, l) => s + l.total, 0))
      const toneladas = Number(lineas.reduce((s, l) => s + (esTon(l.unidad) ? l.toneladas : 0), 0).toFixed(3))
      const advertencias: Advertencia[] = []
      if (ctrlR.success && ctrlR.data) {
        const t = ctrlR.data.totales
        if (t.ordenes_sin_tarifa > 0) advertencias.push({ tipo: "sin_tarifa", detalle: `${t.ordenes_sin_tarifa} orden(es) sin tarifa vigente (se cobraron $0) -- todo el proyecto, revisar cuáles son de ${owner}` })
        if (t.ordenes_medio_pago > 0) advertencias.push({ tipo: "pago_no_cuadra", detalle: `${t.ordenes_medio_pago} orden(es) con medio de pago inconsistente -- todo el proyecto` })
        if (ctrlR.data.produccionAviso) advertencias.push({ tipo: "produccion_aviso", detalle: ctrlR.data.produccionAviso })
        for (const al of ctrlR.data.produccionAlertas || []) advertencias.push({ tipo: "produccion_alerta", detalle: al })
      }
      // Órdenes de este owner/período que el Coordinador AÚN no ha validado en
      // Gestión de Facturas -- se generó igual (con lo que sí está validado),
      // pero esto queda sin facturar hasta que se valide y entre en un
      // próximo corte. Solo bloque "operación" -- Tolva/producción no aplica.
      const sinGestionar = pref.resumen.filter((r) => r.owner === owner && r.bloque === "operacion" && r.valorPorFacturar > 0)
      if (sinGestionar.length > 0) {
        const valorSinGestionar = Math.round(sinGestionar.reduce((s, r) => s + r.valorPorFacturar, 0))
        const numOrdenes = new Set(
          pref.origen.filter((l) => l.owner === owner && l.categoria === "sin_gestionar").map((l) => l.numeroorden),
        ).size
        advertencias.push({
          tipo: "ordenes_sin_gestionar",
          detalle: `$${valorSinGestionar.toLocaleString("es-CO")} en ${numOrdenes} orden(es) de este período siguen sin validar por el Coordinador (Gestión de Facturas) y quedaron FUERA de este anexo.`,
        })
      }
      if (rangoManual && desdeAutomatico && desdeOwner !== desdeAutomatico) {
        advertencias.push({
          tipo: "rango_manual",
          detalle:
            desdeOwner > desdeAutomatico
              ? `Rango manual: este período arranca en ${desdeOwner}, pero el período contiguo esperado arrancaba en ${desdeAutomatico} -- revisa que ${desdeAutomatico} a ${diaAnteriorISO(desdeOwner)} no se quede sin facturar.`
              : `Rango manual: este período arranca en ${desdeOwner}, antes del período contiguo esperado (${desdeAutomatico}) -- confirma que no se solape con lo ya facturado.`,
        })
      }
      const r = await guardarPrefactura({
        idempresa,
        proyecto: owner,
        periodo_desde: desdeOwner,
        periodo_hasta: hasta,
        lineas,
        soporte,
        total,
        toneladas,
        usuario,
        advertencias,
      })
      if (!r.success || !r.id) {
        resultados.push({ owner, success: false, estado: "error", mensaje: r.message || "No se pudo guardar la prefactura." })
        continue
      }
      resultados.push({ owner, success: true, estado: "generada", mensaje: `Prefactura de ${owner} generada para ${desdeOwner} a ${hasta}.`, prefacturaId: r.id, periodo: { desde: desdeOwner, hasta } })
    }

    const generadas = resultados.filter((r) => r.estado === "generada").length
    const errores = resultados.filter((r) => !r.success).length
    const estadoGeneral: ResultadoGeneracionManual["estado"] = generadas > 0 ? (errores > 0 ? "parcial" : "generada") : errores > 0 ? "parcial" : "sin_pendientes"
    return {
      success: errores === 0,
      estado: estadoGeneral,
      mensaje: `${generadas} prefactura(s) generada(s) de ${resultados.length} owner(s) con actividad.`,
      resultados,
    }
  } catch (e: any) {
    return { success: false, estado: "error", mensaje: e?.message || "Error inesperado al generar la prefactura.", resultados: [] }
  }
}

export interface PendienteGestionOwner {
  owner: string
  valorSinGestionar: number
  ordenes: number
}
export interface ResultadoPendienteGestion {
  success: boolean
  message?: string
  periodo?: { desde: string; hasta: string }
  porOwner: PendienteGestionOwner[]
}

/**
 * Solo-lectura -- NO guarda nada. Para el período que le tocaría generar a
 * este proyecto AHORA MISMO (mismo cálculo de `desde` que usa
 * `generarPrefacturaAhora`), cuánto valor de bloque "operación" sigue SIN
 * validar por el Coordinador en Gestión de Facturas -- o sea, lo que
 * quedaría FUERA del próximo anexo si se generara ya. Pensado para el
 * aviso proactivo en la UI, pedido por el usuario 2026-09-14: "que informe
 * si se está quedando alguna de estas órdenes por fuera del corte por no
 * tener gestión de factura realizada por el coordinador".
 */
export async function previsualizarPendienteGestion(idempresa: number): Promise<ResultadoPendienteGestion> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: cond } = await sb
      .from("condiciones_generacion_prefactura")
      .select("fecha_inicio")
      .eq("idempresa", idempresa)
      .maybeSingle()
    const fechaInicioProyecto: string | null = cond?.fecha_inicio || null
    const hasta = fechaAyerColombiaISO()

    const { data: previas } = await sb
      .from("prefacturas")
      .select("owner, periodo_hasta")
      .eq("idempresa", idempresa)
      .eq("origen", "cuadro_control")
      .eq("estado", "aprobada")
      .not("owner", "is", null)
      .order("periodo_hasta", { ascending: false })
    const ultimaPorOwner = new Map<string, string>()
    for (const p of previas || []) {
      if (!ultimaPorOwner.has(p.owner)) ultimaPorOwner.set(p.owner, p.periodo_hasta)
    }
    const desdeMasAntiguo = previas && previas.length > 0 ? [...ultimaPorOwner.values()].map(diaSiguienteISO).sort()[0] : fechaInicioProyecto
    if (!desdeMasAntiguo || desdeMasAntiguo > hasta) {
      return { success: true, porOwner: [] }
    }

    const r = await getPrefactura(idempresa, { desde: desdeMasAntiguo, hasta })
    if (!r.success || !r.data) return { success: false, message: r.message, porOwner: [] }

    const porOwnerMap = new Map<string, { valor: number; ordenes: Set<string> }>()
    for (const row of r.data.resumen) {
      if (row.bloque !== "operacion" || row.valorPorFacturar <= 0) continue
      const acc = porOwnerMap.get(row.owner) || { valor: 0, ordenes: new Set<string>() }
      acc.valor += row.valorPorFacturar
      porOwnerMap.set(row.owner, acc)
    }
    for (const l of r.data.origen) {
      if (l.categoria === "sin_gestionar" && porOwnerMap.has(l.owner)) {
        porOwnerMap.get(l.owner)!.ordenes.add(l.numeroorden)
      }
    }
    const porOwner = Array.from(porOwnerMap.entries()).map(([owner, v]) => ({
      owner,
      valorSinGestionar: Math.round(v.valor),
      ordenes: v.ordenes.size,
    }))
    return { success: true, periodo: { desde: desdeMasAntiguo, hasta }, porOwner }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al calcular pendientes de gestión.", porOwner: [] }
  }
}

export async function actualizarCondicionPagoOwner(owner: string, dias_plazo: number): Promise<{ success: boolean; message?: string }> {
  const segundoFactor = await segundoFactorPendiente("ciclo-facturacion:condicionPagoOwner")
  if (segundoFactor) return { success: false, message: segundoFactor }
  if (!owner?.trim()) return { success: false, message: "Falta el owner." }
  if (!(dias_plazo > 0)) return { success: false, message: "Los días de plazo deben ser mayores a 0." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("condiciones_pago_owner").upsert({ owner: owner.trim(), dias_plazo }, { onConflict: "owner" })
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar la condición de pago." }
  }
}
