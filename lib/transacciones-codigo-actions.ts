"use server"

/**
 * Motor de "Movimiento por código" (estilo SAP): el usuario escribe el código
 * de la transacción y el sistema habilita los campos de ESE movimiento,
 * valida, postea a `invtrans` (status aprobado, origen "transaccion manual",
 * cod_movimiento explícito — el trigger de BD recalcula saldos) y deja el
 * registro completo en `inv_correcciones_log` (quién, cuándo, qué, por qué,
 * ids generados) — revisable sin tocar invtrans. Los códigos de CORRECCIÓN
 * exigen además la clave del responsable (`inv_clave_movimiento`).
 *
 * Reutiliza los patrones sancionados del módulo (registerInventoryTransaction /
 * registerProductTransfer / postCorreccionInvtrans) sin modificarlos.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUsuarioForInsert } from "@/lib/company-filter"
import { getColombiaDateTime } from "@/lib/inventory-actions"
import {
  FIELDSETS,
  CODIGOS_REQUIEREN_APROBACION,
  CODIGOS_MAL_USADOS_PARA_CALIDAD,
  esMotivoDeCalidad,
  MENSAJE_REDIRECCION_CALIDAD,
  type CatalogoTransaccion,
  type MovimientoOriginal,
  type EjecutarPayload,
  type CorreccionLogRow,
  type AjustePendiente,
} from "@/lib/transacciones-codigo"

// ---------------------------------------------------------------------------
// Catálogo (nomenclatura) — columna real: codigo_sap (verificado 2026-08-08)
// ---------------------------------------------------------------------------

export async function getCatalogoTransacciones(): Promise<{
  success: boolean
  data: CatalogoTransaccion[]
  error?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("sig_tipos_movimiento")
      .select("*")
      .eq("activo", true)
      .order("orden", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    const rows: CatalogoTransaccion[] = (data ?? []).map((t: any) => ({
      codigo: String(t.codigo_sap ?? t.codigo ?? ""),
      nombre: t.nombre,
      clase: t.clase ?? null,
      descripcion: t.descripcion ?? null,
      origen_lipgo: t.origen_lipgo ?? null,
      afecta_stock: t.afecta_stock ?? null,
    }))
    return { success: true, data: rows.filter((r) => r.codigo) }
  } catch (e: any) {
    return { success: false, data: [], error: e?.message || "Error al leer el catálogo." }
  }
}

// ---------------------------------------------------------------------------
// Clave del responsable (solo códigos de corrección)
// ---------------------------------------------------------------------------

async function resolverClave(sb: any, clave: string): Promise<{ ok: boolean; responsable?: string; error?: string }> {
  const limpia = String(clave || "").trim()
  if (!limpia) return { ok: false, error: "Este código requiere la clave del responsable." }
  const { data, error } = await sb
    .from("inv_clave_movimiento")
    .select("responsable")
    .eq("clave", limpia)
    .eq("activo", true)
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: "Clave incorrecta o inactiva." }
  return { ok: true, responsable: data.responsable }
}

// ---------------------------------------------------------------------------
// Buscar movimiento original (reversos 102/602/552/312) — SOLO LECTURA
// ---------------------------------------------------------------------------

const MARKER_REV = (id: number) => `[rev#${id}]`
const MARKER_REV_RE = /\[rev#(\d+)\]/

/**
 * Cuánto se reversó de CADA `invtrans.id` de una empresa, vía "Movimiento por
 * código" (102/602/552/312 — corrección, referencia el original con
 * `[rev#<id>]` en observaciones, nunca edita/borra la fila original).
 *
 * Reusar esto es obligatorio en cualquier lectura de `invtrans` que alimente
 * pago (nómina), cobro (facturación) o auditoría (entrega vs. facturado) --
 * de lo contrario un ingreso ya anulado por Gerencia General se sigue
 * cobrando/pagando como si fuera real. Bug real encontrado 2026-09-21 en
 * `armarIndupan` (lib/prefactura-produccion-actions.ts): 42t reversadas que
 * seguían contando en la prefactura de Tolva.
 *
 * Solo una consulta por empresa (no por fila) -- el volumen de reversos es
 * bajo (decenas, no miles), así que se trae todo y se resuelve en memoria.
 */
export async function getReversosPorIdempresa(idempresa: number): Promise<Map<number, number>> {
  const reversadoPorId = new Map<number, number>()
  if (!idempresa) return reversadoPorId
  const sb: any = await getSupabaseAdmin()
  const { data } = await sb
    .from("invtrans")
    .select("cantidad, observaciones")
    .eq("idempresa", idempresa)
    .ilike("observaciones", "%[rev#%")
  for (const r of data || []) {
    const m = MARKER_REV_RE.exec(String(r.observaciones || ""))
    if (!m) continue
    const idOriginal = Number(m[1])
    const prev = reversadoPorId.get(idOriginal) ?? 0
    reversadoPorId.set(idOriginal, prev + Math.abs(Number(r.cantidad) || 0))
  }
  return reversadoPorId
}

export async function buscarMovimientoOriginal(params: {
  selectedEmpresaId: number
  tipo: "entrada" | "salida" | "reproceso" | "traslado"
  codproducto?: string | null
  producto?: string | null
  lote?: string | null
  ocargue?: string | null
  invtransId?: number | null
}): Promise<{ success: boolean; data: MovimientoOriginal[]; error?: string }> {
  try {
    if (!params.selectedEmpresaId) return { success: false, data: [], error: "Selecciona un proyecto en el selector global." }
    const sb: any = await getSupabaseAdmin()
    let q = sb
      .from("invtrans")
      .select("id,tipomov,codproducto,nombreproducto,lote,location,cantidad,ocargue,origen,creado,creadopor,cod_movimiento,status")
      .eq("idempresa", params.selectedEmpresaId)
    if (params.invtransId) {
      q = q.eq("id", params.invtransId)
    } else {
      if (params.tipo === "entrada") q = q.eq("tipomov", "Entrada")
      else if (params.tipo === "salida") q = q.eq("tipomov", "Salida")
      else if (params.tipo === "reproceso") q = q.eq("tipomov", "Reproceso")
      else if (params.tipo === "traslado") q = q.ilike("origen", "%traslado entre localizaciones%").eq("tipomov", "Entrada")
      if (params.codproducto?.trim()) q = q.eq("codproducto", params.codproducto.trim())
      if (params.producto?.trim()) q = q.ilike("nombreproducto", `%${params.producto.trim()}%`)
      if (params.lote?.trim()) q = q.eq("lote", params.lote.trim())
      if (params.ocargue?.trim()) q = q.eq("ocargue", params.ocargue.trim())
    }
    const { data, error } = await q.order("id", { ascending: false }).limit(30)
    if (error) return { success: false, data: [], error: error.message }

    const filas = (data ?? []).filter((r: any) => String(r.status || "").toLowerCase().startsWith("aprob"))
    // Reversos previos de cada candidato (marcador [rev#id] en observaciones).
    const resultado: MovimientoOriginal[] = []
    for (const r of filas) {
      const { data: revs } = await sb
        .from("invtrans")
        .select("cantidad")
        .eq("idempresa", params.selectedEmpresaId)
        .ilike("observaciones", `%${MARKER_REV(Number(r.id))}%`)
      const reversado = (revs ?? []).reduce((s: number, x: any) => s + Math.abs(Number(x.cantidad) || 0), 0)
      const cantidad = Math.abs(Number(r.cantidad) || 0)
      resultado.push({
        id: Number(r.id),
        tipomov: r.tipomov,
        codproducto: r.codproducto ?? null,
        nombreproducto: r.nombreproducto ?? null,
        lote: r.lote ?? null,
        location: r.location ?? null,
        cantidad,
        ocargue: r.ocargue ?? null,
        origen: r.origen ?? null,
        creado: r.creado ?? null,
        creadopor: r.creadopor ?? null,
        cod_movimiento: r.cod_movimiento ?? null,
        reversado,
        reversible: Math.max(0, Math.round((cantidad - reversado) * 100) / 100),
      })
    }
    return { success: true, data: resultado }
  } catch (e: any) {
    return { success: false, data: [], error: e?.message || "Error al buscar el movimiento original." }
  }
}

// ---------------------------------------------------------------------------
// Helpers internos del motor
// ---------------------------------------------------------------------------

async function stockDeLote(sb: any, empresaId: number, producto: string, lote: string, location: string): Promise<number> {
  const { data } = await sb
    .from("saldoinvdetalle")
    .select("stock_actual")
    .eq("idempresa", empresaId)
    .eq("nombreproducto", producto)
    .eq("lote", lote)
    .eq("location", location)
  return (data ?? []).reduce((s: number, r: any) => s + (Number(r.stock_actual) || 0), 0)
}

async function detalleProducto(sb: any, empresaId: number, nombre: string): Promise<{ id: number; codigo: string } | null> {
  const { data } = await sb.from("productos").select("id,codigo").eq("nombre", nombre).limit(1).maybeSingle()
  if (data?.id) return { id: Number(data.id), codigo: String(data.codigo ?? "") }
  // Fallback: resolver desde saldoinvdetalle (mismo criterio que el módulo clásico).
  const { data: s } = await sb
    .from("saldoinvdetalle")
    .select("idproducto,codproducto")
    .eq("idempresa", empresaId)
    .eq("nombreproducto", nombre)
    .limit(1)
    .maybeSingle()
  if (s) return { id: Number(s.idproducto) || 0, codigo: String(s.codproducto ?? "") }
  return null
}

async function ubicacionCuarentena(sb: any, empresaId: number): Promise<string | null> {
  const { data } = await sb
    .from("locations")
    .select("codigo")
    .eq("idempresa", empresaId)
    .ilike("codigo", "%CUARENTENA%")
    .limit(1)
    .maybeSingle()
  return data?.codigo ?? null
}

// ---------------------------------------------------------------------------
// Ejecutar la transacción
// ---------------------------------------------------------------------------

export async function ejecutarTransaccionPorCodigo(payload: EjecutarPayload): Promise<{
  success: boolean
  message: string
  invtransIds?: number[]
  logId?: number
}> {
  try {
    // Blindaje 2026-09-23 (incidente Descargue duplicado + 702 que lo tapó,
    // Cedi Funza): 601/702 son salida sin orden de cargue y sin ser una
    // categoría reconocida (551 Merma/Reproceso sí lo es) -- nunca se aplican
    // directo. `__aprobado` solo lo pone `aprobarAjustePendiente`, después de
    // verificar la clave de Gerencia; la UI y cualquier otro llamador deben
    // usar `solicitarAjustePendiente` para estos dos códigos.
    if (CODIGOS_REQUIEREN_APROBACION.has(payload.codigo) && !payload.__aprobado) {
      return {
        success: false,
        message: `El código ${payload.codigo} requiere aprobación de Gerencia antes de aplicarse. Usa "Solicitar aprobación" en vez de "Ejecutar" -- quedará pendiente hasta que se apruebe.`,
      }
    }
    const fs = FIELDSETS[payload.codigo]
    if (!fs) return { success: false, message: `Código ${payload.codigo} no soportado.` }
    const empresaId = Number(payload.selectedEmpresaId)
    if (!empresaId) return { success: false, message: "Selecciona un proyecto en el selector global." }
    const cantidad = Math.abs(Number(payload.cantidad) || 0)
    if (!cantidad) return { success: false, message: "Indica la cantidad." }
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert()
    const ahora = await getColombiaDateTime()

    // Clave del responsable (solo códigos de corrección).
    let autorizadoPor: string | null = null
    if (fs.requiereClave) {
      const r = await resolverClave(sb, payload.clave || "")
      if (!r.ok) return { success: false, message: r.error || "Clave inválida." }
      autorizadoPor = r.responsable || null
      if (!String(payload.motivo || "").trim()) return { success: false, message: "Indica el motivo de la corrección." }
    }
    // Clave de la GERENCIA DEL PROYECTO (decisiones de calidad: 343 liberar).
    if (fs.claveGerenciaProyecto) {
      const r = await resolverClaveGerenciaProyecto(sb, empresaId, payload.clave || "")
      if (!r.ok) return { success: false, message: r.error || "Clave inválida." }
      autorizadoPor = r.responsable || null
      if (!String(payload.motivo || "").trim()) return { success: false, message: "Indica el motivo (qué decidió calidad)." }
    }

    // Referencia (reversos): validar reversible restante.
    let ref: MovimientoOriginal | null = null
    if (fs.referencia && fs.referencia !== "ocargueOpcional") {
      if (!payload.refInvtransId) return { success: false, message: "Selecciona el movimiento original a reversar." }
      const b = await buscarMovimientoOriginal({ selectedEmpresaId: empresaId, tipo: fs.referencia, invtransId: payload.refInvtransId })
      if (!b.success || !b.data.length) return { success: false, message: "No se encontró el movimiento original." }
      ref = b.data[0]
      if (cantidad > ref.reversible) {
        return { success: false, message: `Solo quedan ${ref.reversible} unidades reversibles de ese movimiento (original ${ref.cantidad}, ya reversadas ${ref.reversado}).` }
      }
    }

    // Resolver producto/lote/ubicación efectivos.
    let producto = payload.producto?.trim() || ""
    let lote = payload.lote?.trim() || ""
    let location = payload.location?.trim() || ""
    if (ref) {
      producto = ref.nombreproducto || producto
      lote = ref.lote || lote
      location = ref.location || location
    }
    if (!producto || !lote || !location) return { success: false, message: "Faltan producto, lote o ubicación." }

    // Validar stock del lote origen cuando el movimiento consume stock.
    if (fs.cantidadContra === "stock") {
      const stock = await stockDeLote(sb, empresaId, producto, lote, location)
      if (cantidad > stock) return { success: false, message: `La cantidad (${cantidad}) supera el stock del lote en esa ubicación (${stock}).` }
    }

    // Cuarentena (344 destino / 343 origen).
    let cuarentena: string | null = null
    if (fs.destino === "cuarentena" || fs.origen === "cuarentena") {
      cuarentena = await ubicacionCuarentena(sb, empresaId)
      if (!cuarentena) {
        return { success: false, message: "No existe una ubicación CUARENTENA en este proyecto. Créala en Configuración › ubicaciones y vuelve a intentar." }
      }
      if (fs.origen === "cuarentena") location = cuarentena
    }

    const prodInfo = await detalleProducto(sb, empresaId, producto)
    const productoDestino = payload.productoDestino?.trim() || producto
    const prodDestinoInfo = productoDestino === producto ? prodInfo : await detalleProducto(sb, empresaId, productoDestino)
    if (!prodInfo) return { success: false, message: `Producto "${producto}" no encontrado.` }
    if (!prodDestinoInfo) return { success: false, message: `Producto destino "${productoDestino}" no encontrado.` }

    // Armar la(s) fila(s) de invtrans según el código.
    const { data: maxRow } = await sb.from("invtrans").select("id").order("id", { ascending: false }).limit(1).maybeSingle()
    let nextId = maxRow ? Number(maxRow.id) + 1 : 1
    const motivoTxt = String(payload.motivo || "").trim()
    const obsBase = [
      `Movimiento por código ${payload.codigo}`,
      motivoTxt ? `· ${motivoTxt}` : "",
      autorizadoPor ? `· autoriza: ${autorizadoPor}` : "",
      ref ? `· reversa invtrans #${ref.id} ${MARKER_REV(ref.id)}` : "",
      payload.ocargueRef?.trim() ? `· ref orden ${payload.ocargueRef.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" ")

    const base = (extra: any) => ({
      id: nextId++,
      idempresa: empresaId,
      idproducto: prodInfo.id,
      codproducto: prodInfo.codigo,
      nombreproducto: producto,
      lote,
      location,
      cantidad,
      status: "aprobado",
      origen: "transaccion manual",
      observaciones: obsBase,
      cod_movimiento: payload.codigo,
      creadopor: usuario,
      creado: ahora,
      ...extra,
    })

    const filas: any[] = []
    let logDestino: { producto?: string; codproducto?: string; lote?: string; location?: string } = {}

    switch (payload.codigo) {
      case "101":
      case "561":
      case "653":
      case "701":
        filas.push(base({ tipomov: "Entrada" }))
        break
      case "601":
      case "702":
      case "555": // desecho por calidad: salida definitiva desde CUARENTENA (location ya resuelta arriba)
        filas.push(base({ tipomov: "Salida" }))
        break
      case "551":
        filas.push(base({ tipomov: "Reproceso" }))
        break
      case "102": // reverso de entrada → salida
        filas.push(base({ tipomov: "Salida" }))
        break
      case "602": // reverso de salida → entrada
      case "552": // reverso de merma → entrada
        filas.push(base({ tipomov: "Entrada" }))
        break
      case "311":
      case "312":
      case "344":
      case "343": {
        // Par neto 0: salida de la ubicación origen + entrada a la destino.
        const locDest = payload.codigo === "344" ? cuarentena! : payload.locationDestino?.trim() || ""
        if (!locDest) return { success: false, message: "Indica la ubicación destino." }
        if (locDest === location) return { success: false, message: "La ubicación destino debe ser distinta a la de origen." }
        if (payload.codigo === "312") {
          // El reversible ya se validó contra el traslado original; además el
          // stock debe seguir físicamente en la ubicación a la que llegó.
          const stock = await stockDeLote(sb, empresaId, producto, lote, location)
          if (cantidad > stock) return { success: false, message: `La cantidad (${cantidad}) supera el stock actual del lote en ${location} (${stock}).` }
        }
        filas.push(base({ tipomov: "Salida" }))
        filas.push(base({ tipomov: "Entrada", location: locDest }))
        logDestino = { lote, location: locDest, producto, codproducto: prodInfo.codigo }
        break
      }
      case "309": {
        // Reclasificación: salida del lote/producto/ubicación equivocado +
        // entrada al correcto. Permite cambiar lote, producto y/o ubicación.
        const loteDest = payload.loteDestino?.trim() || lote
        const locDest = payload.locationDestino?.trim() || location
        if (loteDest === lote && locDest === location && productoDestino === producto) {
          return { success: false, message: "El destino es idéntico al origen — no hay nada que corregir." }
        }
        filas.push(base({ tipomov: "Salida" }))
        filas.push(
          base({
            tipomov: "Entrada",
            lote: loteDest,
            location: locDest,
            nombreproducto: productoDestino,
            codproducto: prodDestinoInfo.codigo,
            idproducto: prodDestinoInfo.id,
          }),
        )
        logDestino = { lote: loteDest, location: locDest, producto: productoDestino, codproducto: prodDestinoInfo.codigo }
        break
      }
      default:
        return { success: false, message: `Código ${payload.codigo} no soportado.` }
    }

    const { error: errIns } = await sb.from("invtrans").insert(filas)
    if (errIns) return { success: false, message: `No se pudo registrar el movimiento: ${errIns.message}` }
    const invtransIds = filas.map((f) => Number(f.id))

    // Reprocesos: 551 registra; 552 compensa (best-effort, tabla secundaria).
    if (payload.codigo === "551") {
      try {
        await sb.from("reprocesos").insert([{ idempresa: empresaId, lote, producto, codproducto: prodInfo.codigo, cantidad, creado: ahora, creadopor: usuario }])
      } catch { /* tabla opcional */ }
    }
    if (payload.codigo === "552") {
      try {
        await sb.from("reprocesos").insert([{ idempresa: empresaId, lote, producto, codproducto: prodInfo.codigo, cantidad: -cantidad, creado: ahora, creadopor: usuario }])
      } catch { /* tabla opcional */ }
    }

    // Registro revisable (inv_correcciones_log) — TODO movimiento de esta
    // pantalla queda aquí, con los ids de invtrans como evidencia.
    const { data: logRow, error: errLog } = await sb
      .from("inv_correcciones_log")
      .insert({
        idempresa: empresaId,
        codigo: payload.codigo,
        ref_invtrans_id: ref?.id ?? null,
        codproducto: prodInfo.codigo,
        producto,
        lote_origen: lote,
        location_origen: location,
        codproducto_destino: logDestino.codproducto ?? null,
        producto_destino: logDestino.producto ?? null,
        lote_destino: logDestino.lote ?? null,
        location_destino: logDestino.location ?? null,
        cantidad,
        motivo: motivoTxt || null,
        realizado_por: usuario,
        autorizado_por: autorizadoPor,
        invtrans_ids: invtransIds,
      })
      .select("id")
      .single()
    if (errLog) {
      // El movimiento YA quedó en invtrans (y en la bitácora de auditoría) —
      // se reporta el problema del log sin ocultar el éxito del movimiento.
      return { success: true, message: `Movimiento registrado (invtrans ${invtransIds.join(", ")}), pero el registro del historial falló: ${errLog.message}. ¿Corriste el SQL 52?`, invtransIds }
    }

    return { success: true, message: `Movimiento ${payload.codigo} registrado.`, invtransIds, logId: logRow?.id }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al ejecutar la transacción." }
  }
}

// ---------------------------------------------------------------------------
// Aprobación de Gerencia para 601/702 (SQL 62). Clave DEDICADA en
// inv_clave_aprobacion_ajustes -- distinta de inv_clave_movimiento (esa es
// "quién ejecuta" una corrección; esta es "quién autoriza" la solicitud de
// otra persona, un control más guardado a propósito).
// ---------------------------------------------------------------------------

// Clave de la GERENCIA DEL PROYECTO (inv_clave_gerencia_proyecto, SQL 202):
// quien decide sobre el inventario de un proyecto es su propia gerencia
// (Indupan, Avimol, cada Cedi), no la gerencia general de LIPgo.
async function resolverClaveGerenciaProyecto(sb: any, empresaId: number, clave: string): Promise<{ ok: boolean; responsable?: string; error?: string }> {
  const limpia = String(clave || "").trim()
  if (!limpia) return { ok: false, error: "Ingresa la clave de la gerencia del proyecto." }
  const { data, error } = await sb
    .from("inv_clave_gerencia_proyecto")
    .select("responsable")
    .eq("idempresa", empresaId)
    .eq("clave", limpia)
    .eq("activo", true)
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: "Clave incorrecta: debe ser la de la gerencia de ESTE proyecto (o estar inactiva)." }
  return { ok: true, responsable: data.responsable }
}

// Aprobación de un ajuste pendiente (601/702/555): vale la clave de la gerencia
// DEL PROYECTO al que pertenece el ajuste y, como respaldo, la clave general
// de inv_clave_aprobacion_ajustes (SQL 62).
async function resolverClaveAprobacion(sb: any, clave: string, empresaId: number): Promise<{ ok: boolean; responsable?: string; error?: string }> {
  const limpia = String(clave || "").trim()
  if (!limpia) return { ok: false, error: "Ingresa la clave de aprobación (gerencia del proyecto)." }
  const proyecto = await resolverClaveGerenciaProyecto(sb, empresaId, limpia)
  if (proyecto.ok) return proyecto
  const { data, error } = await sb
    .from("inv_clave_aprobacion_ajustes")
    .select("responsable")
    .eq("clave", limpia)
    .eq("activo", true)
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: "Clave de aprobación incorrecta o inactiva (debe ser la de la gerencia de este proyecto)." }
  return { ok: true, responsable: data.responsable }
}

/**
 * Punto de entrada de la UI para 601/702 (nunca `ejecutarTransaccionPorCodigo`
 * directo -- esa función los rechaza salvo que vengan ya aprobados). Valida
 * lo mínimo para darle feedback inmediato al coordinador (empresa, cantidad,
 * producto/lote/ubicación, stock suficiente) y deja la solicitud en
 * `inv_ajustes_pendientes`. NO toca invtrans ni el stock -- eso solo pasa en
 * `aprobarAjustePendiente`.
 */
export async function solicitarAjustePendiente(payload: EjecutarPayload): Promise<{
  success: boolean
  message: string
  id?: number
}> {
  try {
    if (!CODIGOS_REQUIEREN_APROBACION.has(payload.codigo)) {
      return { success: false, message: `El código ${payload.codigo} no requiere aprobación -- usa "Ejecutar" directamente.` }
    }
    const empresaId = Number(payload.selectedEmpresaId)
    if (!empresaId) return { success: false, message: "Selecciona un proyecto en el selector global." }
    const cantidad = Math.abs(Number(payload.cantidad) || 0)
    if (!cantidad) return { success: false, message: "Indica la cantidad." }
    const producto = payload.producto?.trim() || ""
    const lote = payload.lote?.trim() || ""
    let location = payload.location?.trim() || ""
    if (!String(payload.motivo || "").trim()) return { success: false, message: "Indica el motivo del ajuste." }

    // CALIDAD (2026-09-27): un 702 (faltante de conteo) o un 601 (despacho sin
    // orden) con un motivo que describe contaminación, vencimiento, plaga, etc.
    // es el código EQUIVOCADO -- ese producto no se saca, se bloquea (344) y
    // luego se libera (343) o se desecha (555). Se rechaza y se redirige.
    if (CODIGOS_MAL_USADOS_PARA_CALIDAD.has(payload.codigo) && esMotivoDeCalidad(payload.motivo)) {
      return { success: false, message: MENSAJE_REDIRECCION_CALIDAD }
    }

    const sb: any = await getSupabaseAdmin()
    // 555 sale SOLO desde CUARENTENA: la ubicación es automática.
    if (FIELDSETS[payload.codigo]?.origen === "cuarentena") {
      const cuarentena = await ubicacionCuarentena(sb, empresaId)
      if (!cuarentena) return { success: false, message: "No existe una ubicación CUARENTENA en este proyecto (la crea scripts/202_cuarentena_calidad.sql)." }
      location = cuarentena
    }
    if (!producto || !lote || !location) return { success: false, message: "Faltan producto, lote o ubicación." }
    const stock = await stockDeLote(sb, empresaId, producto, lote, location)
    if (cantidad > stock) return { success: false, message: `La cantidad (${cantidad}) supera el stock del lote en esa ubicación (${stock}).` }

    const usuario = await getCurrentUsuarioForInsert()
    const { data, error } = await sb
      .from("inv_ajustes_pendientes")
      .insert({
        idempresa: empresaId,
        codigo: payload.codigo,
        payload,
        producto,
        lote,
        location,
        cantidad,
        motivo: String(payload.motivo || "").trim(),
        solicitado_por: usuario,
        estado: "pendiente",
      })
      .select("id")
      .single()
    if (error) return { success: false, message: error.message }
    return { success: true, message: `Solicitud enviada a Gerencia para aprobación (código ${payload.codigo}). No se aplicó todavía.`, id: data?.id }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al enviar la solicitud." }
  }
}

/** Lista de solicitudes 601/702 para la pantalla de aprobación de Gerencia. */
export async function getAjustesPendientes(filtros?: {
  selectedEmpresaId?: number | null
  estado?: "pendiente" | "aprobado" | "rechazado"
}): Promise<{ success: boolean; data: AjustePendiente[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    let q = sb.from("inv_ajustes_pendientes").select("*").order("created_at", { ascending: false })
    if (filtros?.selectedEmpresaId) q = q.eq("idempresa", filtros.selectedEmpresaId)
    q = q.eq("estado", filtros?.estado ?? "pendiente")
    const { data, error } = await q
    if (error) return { success: false, data: [], message: error.message }
    const filas = (data ?? []) as AjustePendiente[]
    // Stock ACTUAL de cada lote/ubicación, para que Gerencia vea de entrada si
    // el ajuste aún aplica. Caso real 26-sep: se pidió sacar 120 und por 702,
    // el producto salió por otra vía antes de la aprobación y al aprobar el
    // stock ya era 0 -- sin esta columna solo se veía al fallar.
    for (const f of filas) {
      try {
        f.stock_actual = await stockDeLote(sb, Number(f.idempresa), String(f.producto ?? ""), String(f.lote ?? ""), String(f.location ?? ""))
      } catch {
        f.stock_actual = undefined
      }
    }
    return { success: true, data: filas }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al listar las solicitudes." }
  }
}

export interface StockCuarentenaRow {
  producto: string
  codproducto: string | null
  lote: string
  stock_actual: number
  /** Fecha del último bloqueo (344) de ese producto/lote; null si no se encontró. */
  bloqueado_desde: string | null
  dias_bloqueado: number | null
  motivo_bloqueo: string | null
}

/** Stock BLOQUEADO por calidad (ubicación CUARENTENA) del proyecto: qué hay,
 * desde cuándo y por qué. Lo que aparece aquí sigue siendo inventario, pero no
 * está disponible; sale con 343 (liberar) o 555 (desecho aprobado). */
export async function getStockCuarentena(idempresa: number): Promise<{ success: boolean; data: StockCuarentenaRow[]; ubicacion: string | null; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const cuarentena = await ubicacionCuarentena(sb, idempresa)
    if (!cuarentena) return { success: true, data: [], ubicacion: null, message: "Este proyecto no tiene ubicación CUARENTENA (la crea scripts/202_cuarentena_calidad.sql)." }
    const { data: saldos, error } = await sb
      .from("saldoinvdetalle")
      .select("nombreproducto, codproducto, lote, stock_actual")
      .eq("idempresa", idempresa)
      .eq("location", cuarentena)
      .gt("stock_actual", 0)
      .order("nombreproducto")
      .order("lote")
    if (error) return { success: false, data: [], ubicacion: cuarentena, message: error.message }
    // Último bloqueo (entrada 344 a CUARENTENA) por producto+lote, para saber
    // desde cuándo está retenido y el motivo con que se bloqueó.
    const { data: bloqueos } = await sb
      .from("invtrans")
      .select("nombreproducto, lote, creado, observaciones")
      .eq("idempresa", idempresa)
      .eq("location", cuarentena)
      .eq("tipomov", "Entrada")
      .eq("cod_movimiento", "344")
      .order("creado", { ascending: false })
      .limit(1000)
    const ultimo = new Map<string, { creado: string; motivo: string | null }>()
    for (const b of bloqueos ?? []) {
      const k = `${b.nombreproducto}|${b.lote}`
      if (!ultimo.has(k)) ultimo.set(k, { creado: b.creado, motivo: b.observaciones ?? null })
    }
    const hoy = Date.now()
    const data: StockCuarentenaRow[] = (saldos ?? []).map((s: any) => {
      const u = ultimo.get(`${s.nombreproducto}|${s.lote}`)
      const desde = u?.creado ?? null
      return {
        producto: s.nombreproducto,
        codproducto: s.codproducto ?? null,
        lote: s.lote,
        stock_actual: Number(s.stock_actual) || 0,
        bloqueado_desde: desde,
        dias_bloqueado: desde ? Math.max(0, Math.floor((hoy - new Date(desde).getTime()) / 86_400_000)) : null,
        motivo_bloqueo: u?.motivo ?? null,
      }
    })
    return { success: true, data, ubicacion: cuarentena }
  } catch (e: any) {
    return { success: false, data: [], ubicacion: null, message: e?.message || "Error al leer la cuarentena." }
  }
}

/** Gerencia aprueba: verifica la clave y RECIÉN AHÍ ejecuta el ajuste real (reusa ejecutarTransaccionPorCodigo con el payload guardado, sin reinterpretarlo). */
export async function aprobarAjustePendiente(id: number, claveAprobacion: string): Promise<{
  success: boolean
  message: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: pendiente, error: errGet } = await sb.from("inv_ajustes_pendientes").select("*").eq("id", id).maybeSingle()
    if (errGet) return { success: false, message: errGet.message }
    if (!pendiente) return { success: false, message: "La solicitud no existe." }
    if (pendiente.estado !== "pendiente") return { success: false, message: `Esta solicitud ya quedó "${pendiente.estado}" -- no se puede volver a aprobar.` }
    // La clave se valida contra el PROYECTO del ajuste (su gerencia), con la
    // clave general como respaldo.
    const auth = await resolverClaveAprobacion(sb, claveAprobacion, Number(pendiente.idempresa))
    if (!auth.ok) return { success: false, message: auth.error || "Clave inválida." }

    const resultado = await ejecutarTransaccionPorCodigo({ ...pendiente.payload, __aprobado: true })
    if (!resultado.success) {
      // No se marca aprobado si la ejecución real falló (ej. el stock cambió
      // entre la solicitud y la aprobación) -- queda pendiente para reintentar.
      return {
        success: false,
        message: `La aprobación no se pudo aplicar: ${resultado.message} El producto pudo haber salido por otro movimiento después de la solicitud (revisa "Consulta de movimientos" de ese lote); si el ajuste ya no aplica, recházalo indicando el motivo.`,
      }
    }

    await sb
      .from("inv_ajustes_pendientes")
      .update({
        estado: "aprobado",
        aprobado_por: auth.responsable,
        aprobado_en: new Date().toISOString(),
        invtrans_ids: resultado.invtransIds ?? null,
        log_id: resultado.logId ?? null,
      })
      .eq("id", id)

    return { success: true, message: `Aprobado por ${auth.responsable}. ${resultado.message}` }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al aprobar la solicitud." }
  }
}

/** Gerencia rechaza: la solicitud queda cerrada, NUNCA toca invtrans/stock. */
export async function rechazarAjustePendiente(id: number, claveAprobacion: string, motivoRechazo: string): Promise<{
  success: boolean
  message: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    if (!String(motivoRechazo || "").trim()) return { success: false, message: "Indica el motivo del rechazo." }

    const { data: pendiente, error: errGet } = await sb.from("inv_ajustes_pendientes").select("id, estado, idempresa").eq("id", id).maybeSingle()
    if (errGet) return { success: false, message: errGet.message }
    if (!pendiente) return { success: false, message: "La solicitud no existe." }
    if (pendiente.estado !== "pendiente") return { success: false, message: `Esta solicitud ya quedó "${pendiente.estado}".` }
    // Clave de la gerencia DEL PROYECTO del ajuste (o la general como respaldo).
    const auth = await resolverClaveAprobacion(sb, claveAprobacion, Number(pendiente.idempresa))
    if (!auth.ok) return { success: false, message: auth.error || "Clave inválida." }

    const { error } = await sb
      .from("inv_ajustes_pendientes")
      .update({
        estado: "rechazado",
        aprobado_por: auth.responsable,
        aprobado_en: new Date().toISOString(),
        motivo_rechazo: String(motivoRechazo).trim(),
      })
      .eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true, message: `Solicitud rechazada por ${auth.responsable}.` }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al rechazar la solicitud." }
  }
}

// ---------------------------------------------------------------------------
// Consulta de movimientos (cualquier movimiento de invtrans, desde–hasta en
// HORA COLOMBIA, toda la información, exportable a Excel desde la UI).
// SOLO LECTURA — no toca invtrans.
// ---------------------------------------------------------------------------

export async function getConsultaMovimientos(filtros: {
  selectedEmpresaId: number
  desde: string // YYYY-MM-DD (día calendario Colombia)
  hasta: string // YYYY-MM-DD
  producto?: string | null
  lote?: string | null
  location?: string | null
  tipomov?: string | null
  codigo?: string | null
  usuario?: string | null
}): Promise<{ success: boolean; data: any[]; truncado: boolean; error?: string }> {
  try {
    if (!filtros.selectedEmpresaId) return { success: false, data: [], truncado: false, error: "Selecciona un proyecto en el selector global." }
    if (!filtros.desde || !filtros.hasta) return { success: false, data: [], truncado: false, error: "Indica el rango de fechas (desde y hasta)." }
    const sb: any = await getSupabaseAdmin()
    // Día calendario de Colombia (UTC-5): el día D arranca a las D T05:00Z y
    // termina a las (D+1) T04:59:59Z.
    const desdeUtc = `${filtros.desde}T05:00:00Z`
    const hastaD = new Date(`${filtros.hasta}T00:00:00Z`)
    hastaD.setUTCDate(hastaD.getUTCDate() + 1)
    const hastaUtc = `${hastaD.toISOString().slice(0, 10)}T04:59:59Z`

    const filas: any[] = []
    let from = 0
    const MAX = 5000
    while (true) {
      let q = sb
        .from("invtrans")
        .select("id, codproducto, nombreproducto, lote, location, almacen, cantidad, tipomov, cod_movimiento, status, origen, ocargue, observaciones, creadopor, creado, pdf")
        .eq("idempresa", filtros.selectedEmpresaId)
        .gte("creado", desdeUtc)
        .lte("creado", hastaUtc)
      if (filtros.producto?.trim()) q = q.or(`nombreproducto.ilike.%${filtros.producto.trim()}%,codproducto.ilike.%${filtros.producto.trim()}%`)
      if (filtros.lote?.trim()) q = q.eq("lote", filtros.lote.trim())
      if (filtros.location?.trim()) q = q.eq("location", filtros.location.trim())
      if (filtros.tipomov?.trim()) q = q.eq("tipomov", filtros.tipomov.trim())
      if (filtros.codigo?.trim()) q = q.eq("cod_movimiento", filtros.codigo.trim())
      if (filtros.usuario?.trim()) q = q.ilike("creadopor", `%${filtros.usuario.trim()}%`)
      const { data, error } = await q.order("id", { ascending: false }).range(from, from + 999)
      if (error) return { success: false, data: [], truncado: false, error: error.message }
      filas.push(...(data ?? []))
      if (!data || data.length < 1000 || filas.length >= MAX) break
      from += 1000
    }
    return { success: true, data: filas.slice(0, MAX), truncado: filas.length >= MAX }
  } catch (e: any) {
    return { success: false, data: [], truncado: false, error: e?.message || "Error en la consulta." }
  }
}

// ---------------------------------------------------------------------------
// Productos del proyecto (para los filtros de consulta): SOLO los del ID
// elegido en el selector global, con nombre y código.
// ---------------------------------------------------------------------------

export async function getProductosDeEmpresa(
  selectedEmpresaId: number,
): Promise<{ success: boolean; data: { nombre: string; codigo: string }[]; error?: string }> {
  try {
    if (!selectedEmpresaId) return { success: true, data: [] }
    const sb: any = await getSupabaseAdmin()
    const vistos = new Map<string, string>()
    let from = 0
    while (true) {
      const { data, error } = await sb
        .from("saldoinvdetalle")
        .select("nombreproducto,codproducto")
        .eq("idempresa", selectedEmpresaId)
        .order("codproducto", { ascending: true })
        .range(from, from + 999)
      if (error) return { success: false, data: [], error: error.message }
      for (const r of data ?? []) {
        if (r.nombreproducto && !vistos.has(r.nombreproducto)) vistos.set(r.nombreproducto, r.codproducto ?? "")
      }
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 60000) break
    }
    const filas = Array.from(vistos.entries())
      .map(([nombre, codigo]) => ({ nombre, codigo }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
    return { success: true, data: filas }
  } catch (e: any) {
    return { success: false, data: [], error: e?.message || "Error al leer los productos." }
  }
}

// ---------------------------------------------------------------------------
// Historial de correcciones (pestaña de revisión, solo lectura)
// ---------------------------------------------------------------------------

export async function getHistorialCorrecciones(filtros: {
  selectedEmpresaId: number
  codigo?: string | null
  producto?: string | null
  usuario?: string | null
  desde?: string | null
  hasta?: string | null
}): Promise<{ success: boolean; data: CorreccionLogRow[]; error?: string }> {
  try {
    if (!filtros.selectedEmpresaId) return { success: false, data: [], error: "Selecciona un proyecto en el selector global." }
    const sb: any = await getSupabaseAdmin()
    let q = sb.from("inv_correcciones_log").select("*").eq("idempresa", filtros.selectedEmpresaId)
    if (filtros.codigo?.trim()) q = q.eq("codigo", filtros.codigo.trim())
    if (filtros.producto?.trim()) q = q.or(`producto.ilike.%${filtros.producto.trim()}%,codproducto.ilike.%${filtros.producto.trim()}%`)
    if (filtros.usuario?.trim()) q = q.ilike("realizado_por", `%${filtros.usuario.trim()}%`)
    if (filtros.desde) q = q.gte("created_at", filtros.desde)
    if (filtros.hasta) q = q.lte("created_at", `${filtros.hasta}T23:59:59`)
    const { data, error } = await q.order("id", { ascending: false }).limit(500)
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as CorreccionLogRow[] }
  } catch (e: any) {
    return { success: false, data: [], error: e?.message || "Error al leer el historial." }
  }
}
