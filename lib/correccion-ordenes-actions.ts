"use server"

// CORRECCIÓN DE ÓRDENES (Gestión Financiera) — permite a Facturación buscar
// una orden por número y corregir cabeceraoc/detalleoc directamente desde la
// app, en vez de que un administrador la edite a mano en Supabase. Cada
// escritura pasa por getSupabaseAdmin() (no getSupabaseAdminAsSystem), para
// que el trigger genérico fn_auditoria() registre el actor real y qué campos
// cambiaron. El "por qué" de cada corrección (que el trigger no captura) se
// guarda aparte, en texto libre, en ordenes_correcciones — sin catálogo de
// códigos: a diferencia de los movimientos de inventario, las correcciones de
// orden son demasiado variadas para forzarlas en categorías fijas.

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { autorizarAccion } from "@/lib/puerta-modulo"

export interface OrdenCorreccionCabecera {
  id: number
  ordendecargue: string
  idempresa: number | null
  // Contexto de solo lectura — se muestran para orientar, no son editables
  // desde este módulo (los gestiona el flujo real de facturación).
  tipooperacion: string | null
  fechaorden: string | null
  estadofactura: string | null
  facturasiigo: string | null
  // Editables.
  pesovascula: number | null
  pesoorden: number | null
  placa: string | null
  conductor: string | null
  celular: string | null
  transporte: string | null
  cliente: string | null
  fechacargue: string | null
  auxiliares: string | null
  muelle: number | null
  tipo_pago: string | null
}

export interface OrdenCorreccionLinea {
  id: number | null // null = línea nueva, aún no existe en detalleoc
  producto: string
  cantidad: number
  toneladas: number
}

export interface CabeceraEditable {
  pesovascula: number | null
  pesoorden: number | null
  placa: string | null
  conductor: string | null
  celular: string | null
  transporte: string | null
  cliente: string | null
  fechacargue: string | null
  auxiliares: string | null
  muelle: number | null
  tipo_pago: string | null
}

export interface GuardarCorreccionOrdenPayload {
  ordenId: number
  ordendecargue: string
  motivo: string
  cabecera: CabeceraEditable
  lineas: OrdenCorreccionLinea[]
  lineasEliminadasIds: number[]
}

export async function buscarOrdenParaCorreccion(ordendecargue: string): Promise<{
  success: boolean
  message?: string
  data?: { cabecera: OrdenCorreccionCabecera; lineas: OrdenCorreccionLinea[] }
}> {
  const numero = ordendecargue?.trim()
  if (!numero) return { success: false, message: "Ingresa un número de orden." }

  try {
    const sb = await getSupabaseAdmin()
    const { data: cabecera, error: e1 } = await sb
      .from("cabeceraoc")
      .select(
        "id, ordendecargue, idempresa, tipooperacion, fechaorden, estadofactura, facturasiigo, pesovascula, pesoorden, placa, conductor, celular, transporte, cliente, fechacargue, auxiliares, muelle, tipo_pago",
      )
      .eq("ordendecargue", numero)
      .maybeSingle()
    if (e1) return { success: false, message: e1.message }
    if (!cabecera) return { success: false, message: "No se encontró ninguna orden con ese número." }

    const { data: lineas, error: e2 } = await sb
      .from("detalleoc")
      .select("id, producto, cantidad, toneladas")
      .eq("idorden", cabecera.id)
      .order("id")
    if (e2) return { success: false, message: e2.message }

    return {
      success: true,
      data: {
        cabecera: cabecera as OrdenCorreccionCabecera,
        lineas: (lineas ?? []).map((l: any) => ({
          id: l.id,
          producto: l.producto ?? "",
          cantidad: Number(l.cantidad) || 0,
          toneladas: Number(l.toneladas) || 0,
        })),
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al buscar la orden." }
  }
}

function validarPayload(payload: GuardarCorreccionOrdenPayload): string | null {
  if (!payload.motivo?.trim()) return "El motivo de la corrección es obligatorio."
  if (!payload.ordenId || payload.ordenId <= 0) return "Orden inválida."
  if (!payload.cabecera.placa?.trim()) return "La placa no puede quedar vacía."
  if (payload.cabecera.pesovascula != null && payload.cabecera.pesovascula < 0) return "El peso de báscula no puede ser negativo."
  if (payload.cabecera.pesoorden != null && payload.cabecera.pesoorden < 0) return "El peso de orden no puede ser negativo."
  if (payload.cabecera.muelle != null && (!Number.isInteger(payload.cabecera.muelle) || payload.cabecera.muelle <= 0)) {
    return "El muelle debe ser un número entero positivo."
  }
  if (!payload.lineas || payload.lineas.length === 0) return "La orden debe tener al menos una línea de producto."
  for (const l of payload.lineas) {
    if (!l.producto?.trim()) return "Todas las líneas deben tener un producto."
    if (!(l.cantidad > 0)) return "La cantidad de cada línea debe ser mayor a 0."
    if (l.toneladas < 0) return "Las toneladas no pueden ser negativas."
  }
  return null
}

export async function guardarCorreccionOrden(
  payload: GuardarCorreccionOrdenPayload,
  clave?: string,
): Promise<{ success: boolean; message?: string }> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Corrección de Órdenes", "editar", { clave: clave ?? "", idempresa: (await (await getSupabaseAdminAsSystem()).from("cabeceraoc").select("idempresa").eq("ordendecargue", payload?.ordendecargue).maybeSingle()).data?.idempresa ?? null, referencia: `corregir orden ${payload?.ordendecargue}` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  const errorValidacion = validarPayload(payload)
  if (errorValidacion) return { success: false, message: errorValidacion }

  try {
    const sb = await getSupabaseAdmin()

    const { data: cabeceraActual, error: eLookup } = await sb
      .from("cabeceraoc")
      .select("id, idempresa")
      .eq("id", payload.ordenId)
      .maybeSingle()
    if (eLookup) return { success: false, message: eLookup.message }
    if (!cabeceraActual) return { success: false, message: "La orden ya no existe." }

    const { error: eUpdate } = await sb.from("cabeceraoc").update(payload.cabecera).eq("id", payload.ordenId)
    if (eUpdate) return { success: false, message: "No se pudo actualizar la orden: " + eUpdate.message }

    if (payload.lineasEliminadasIds?.length) {
      const { error: eDelete } = await sb
        .from("detalleoc")
        .delete()
        .in("id", payload.lineasEliminadasIds)
        .eq("idorden", payload.ordenId)
      if (eDelete) return { success: false, message: "La cabecera se guardó, pero no se pudieron eliminar algunas líneas: " + eDelete.message }
    }

    const lineasExistentes = payload.lineas.filter((l) => l.id != null)
    for (const l of lineasExistentes) {
      const { error: eLine } = await sb
        .from("detalleoc")
        .update({ producto: l.producto.trim(), cantidad: l.cantidad, toneladas: l.toneladas })
        .eq("id", l.id)
      if (eLine) return { success: false, message: "La cabecera se guardó, pero no se pudo actualizar una línea: " + eLine.message }
    }

    const lineasNuevas = payload.lineas.filter((l) => l.id == null)
    if (lineasNuevas.length > 0) {
      const { data: ultimo, error: eLast } = await sb
        .from("detalleoc")
        .select("id")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (eLast) return { success: false, message: "La cabecera se guardó, pero no se pudieron agregar líneas nuevas: " + eLast.message }
      let nextId = (ultimo?.id ?? 0) + 1
      const filas = lineasNuevas.map((l) => ({
        id: nextId++,
        idorden: payload.ordenId,
        numeroorden: payload.ordendecargue,
        producto: l.producto.trim(),
        cantidad: l.cantidad,
        toneladas: l.toneladas,
        cliente: "",
        lote: null,
      }))
      const { error: eInsert } = await sb.from("detalleoc").insert(filas)
      if (eInsert) return { success: false, message: "La cabecera se guardó, pero no se pudieron agregar líneas nuevas: " + eInsert.message }
    }

    const usuario = await getCurrentUsuarioForInsert()
    const { error: eMotivo } = await sb.from("ordenes_correcciones").insert({
      idempresa: cabeceraActual.idempresa,
      idorden: payload.ordenId,
      ordendecargue: payload.ordendecargue,
      motivo: payload.motivo.trim(),
      realizado_por: usuario,
    })
    if (eMotivo) {
      return { success: true, message: "Corrección aplicada, pero no se pudo registrar el motivo: " + eMotivo.message }
    }

    return { success: true, message: "Corrección guardada." }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar la corrección." }
  }
}
