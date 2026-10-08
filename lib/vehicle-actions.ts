"use server"

import { createClient } from "@/lib/supabase-client"
import { getColombiaDate, getColombiaTime } from "@/lib/date-utils"
import { generateAndUploadLoadOrderPDF } from "@/lib/pdf-actions"
import { generarDistribucionAutomatica, autoGenerarDescarguesCedi } from "@/lib/orders-actions"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { getCurrentUser, getUserProfile } from "@/lib/auth-actions"
import { motivoSinAccion } from "@/lib/puerta-modulo"

/**
 * Obtiene los IDs de empresa accesibles para el usuario actual desde
 * perfil_acceso_empresas (igual que en orders-actions). Si el usuario no
 * tiene accesos configurados, cae a su empresa de perfil.
 */
async function getUserAccessibleEmpresas(): Promise<number[]> {
  const supabase = await createClient()
  try {
    const user = await getCurrentUser()
    if (!user) return [await getCurrentEmpresaIdForInsert()]

    const profile = await getUserProfile(user.id)
    if (!profile || !profile.id) return [await getCurrentEmpresaIdForInsert()]

    const { data: accesoData, error } = await supabase
      .from("perfil_acceso_empresas")
      .select("empresa_id")
      .eq("profile_id", profile.id)

    if (error) {
      console.error("[v0] Error fetching accessible empresas (vehicles):", error)
      return [await getCurrentEmpresaIdForInsert()]
    }

    const empresaIds = accesoData?.map((item: any) => item.empresa_id as number) || []
    if (empresaIds.length === 0) return [await getCurrentEmpresaIdForInsert()]
    return empresaIds
  } catch (error) {
    console.error("[v0] Error in getUserAccessibleEmpresas (vehicles):", error)
    return [await getCurrentEmpresaIdForInsert()]
  }
}

export async function checkPlacaExists(placa: string): Promise<{ exists: boolean; error?: string }> {
  try {
    const supabase = await createClient()

    console.log("[v0] Checking if placa exists with open status (all empresas):", placa)

    const { data, error } = await supabase
      .from("citasvehiculos")
      .select("id")
      .eq("placa", placa)
      .is("estatus", null)
      .maybeSingle()

    if (error) {
      console.error("[v0] Error checking placa:", error)
      return { exists: false, error: error.message }
    }

    const exists = !!data
    console.log("[v0] Placa check result - exists:", exists)
    return { exists }
  } catch (error) {
    console.error("[v0] Error in checkPlacaExists:", error)
    return { exists: false, error: "Error al verificar la placa" }
  }
}

export async function registerVehicleAppointment(data: {
  placa: string
  nombre_conductor: string
  telefono?: string
  transporte?: string
  tipo_vehiculo?: string
  tipo_producto?: string
  capacidad?: number
  tipo_despacho?: string
  selectedEmpresaId?: number
}) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Registrar Vehículos"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    // Check if placa already exists with open status
    const { exists, error: checkError } = await checkPlacaExists(data.placa)

    if (checkError) {
      console.error("[v0] Error checking placa:", checkError)
      return { success: false, error: checkError }
    }

    if (exists) {
      console.log("[v0] Placa already has an open record:", data.placa)
      return {
        success: false,
        error: "Esta placa ya cuenta con un registro abierto actualmente",
      }
    }

    const supabase = await createClient()

    const empresaId = data.selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    const horallegada = await getColombiaTime()
    const fechallegada = await getColombiaDate()

    const { error } = await supabase.from("citasvehiculos").insert([
      {
        idempresa: empresaId, // Use dynamic empresa ID
        placa: data.placa,
        nombreconductor: data.nombre_conductor,
        telefono: data.telefono || null,
        transporte: data.transporte || null,
        tipovehiculo: data.tipo_vehiculo || null,
        tipoproducto: data.tipo_producto || null,
        horallegada: horallegada,
        fechallegada: fechallegada,
        capacidad: data.capacidad || null,
        tipodespacho: data.tipo_despacho || null,
      },
    ])

    if (error) {
      console.error("[v0] Error inserting vehicle appointment:", error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("[v0] Error in registerVehicleAppointment:", error)
    return { success: false, error: "Error al registrar la cita" }
  }
}

export async function getVehiclesFromCitas(selectedEmpresaId?: number | null) {
  try {
    const supabase = await createClient()

    // Empresas accesibles segun los permisos de Accesos de Usuario.
    const accessibleEmpresas = await getUserAccessibleEmpresas()

    let query = supabase
      .from("citasvehiculos")
      .select("placa, nombreconductor, capacidad, transporte")
      .is("estatus", null)
      .order("placa", { ascending: true })

    // Si se pasa una empresa especifica Y el usuario tiene acceso, filtra solo
    // por esa empresa; de lo contrario filtra por TODAS las empresas accesibles.
    if (selectedEmpresaId && accessibleEmpresas.includes(selectedEmpresaId)) {
      query = query.eq("idempresa", selectedEmpresaId)
    } else {
      query = query.in("idempresa", accessibleEmpresas)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching vehicles:", error)
      return { success: false, error: error.message, data: [] }
    }

    console.log(
      "[v0] Fetched",
      data?.length || 0,
      "vehicles for empresas",
      accessibleEmpresas,
      "selectedEmpresaId:",
      selectedEmpresaId,
    )
    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Error in getVehiclesFromCitas:", error)
    return { success: false, error: "Error al obtener vehículos", data: [] }
  }
}

export async function getVehiclesForBascula(selectedEmpresaId?: number) {
  try {
    const supabase = await createClient()

    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    const { data, error } = await supabase
      .from("citasvehiculos")
      .select("id, placa, nombreconductor, horapesoinicial")
      .eq("idempresa", empresaId)
      .is("estatus", null)
      .is("horapesoinicial", null)
      .order("placa", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching vehicles for bascula:", error)
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Error in getVehiclesForBascula:", error)
    return { success: false, error: "Error al obtener vehículos", data: [] }
  }
}

export async function updateVehicleWeighingTime(vehicleId: number, horaInicio: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Báscula"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()

    const { error } = await supabase.from("citasvehiculos").update({ horapesoinicial: horaInicio }).eq("id", vehicleId)

    if (error) {
      console.error("[v0] Error updating vehicle weighing time:", error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("[v0] Error in updateVehicleWeighingTime:", error)
    return { success: false, error: "Error al actualizar hora de pesaje" }
  }
}

export async function getVehiclesForSanitaryWithoutOrder(selectedEmpresaId?: number) {
  try {
    const supabase = await createClient()

    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    const { data, error } = await supabase
      .from("citasvehiculos")
      .select("id, placa, nombreconductor, telefono, tipoproducto, horapesoinicial, horaregistro")
      .eq("idempresa", empresaId)
      .is("estatus", null)
      .is("horaregistro", null)

    if (error) {
      console.error("[v0] Error fetching vehicles for sanitary without order:", error)
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Error in getVehiclesForSanitaryWithoutOrder:", error)
    return { success: false, error: "Error al obtener vehículos", data: [] }
  }
}

export async function updateVehicleSanitaryTime(vehicleId: number, horaRegistro: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Registro sanitario"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()

    const { error } = await supabase.from("citasvehiculos").update({ horaregistro: horaRegistro }).eq("id", vehicleId)

    if (error) {
      console.error("[v0] Error updating vehicle sanitary time:", error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error("[v0] Error in updateVehicleSanitaryTime:", error)
    return { success: false, error: "Error al actualizar hora de registro sanitario" }
  }
}

export async function getAvailableVehiclesForAssignment(selectedEmpresaId?: number) {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    const { data, error } = await supabase
      .from("citasvehiculos")
      .select("id, placa, nombreconductor, telefono, tipoproducto, horapesoinicial, horaregistro")
      .eq("idempresa", empresaId)
      .is("estatus", null)
      .order("placa", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching available vehicles:", error)
      return { success: false, error: error.message, data: [] }
    }

    console.log(
      "[v0] Fetched",
      data?.length || 0,
      `available vehicles for empresa ${empresaId} in load order assignment`,
    )
    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Error in getAvailableVehiclesForAssignment:", error)
    return { success: false, error: "Error al obtener vehículos disponibles", data: [] }
  }
}

export async function getVehiclesForDistribution(selectedEmpresaId?: number) {
  try {
    const supabase = await createClient()
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    const { data, error } = await supabase
      .from("citasvehiculos")
      .select("id, placa, nombreconductor, transporte")
      .eq("idempresa", empresaId)
      .is("estatus", null)
      .order("placa", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching vehicles for distribution:", error)
      return { success: false, error: error.message, data: [] }
    }

    console.log("[v0] Fetched", data?.length || 0, `vehicles for distribution for empresa ${empresaId}`)
    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Error in getVehiclesForDistribution:", error)
    return { success: false, error: "Error al obtener vehículos", data: [] }
  }
}

export async function updateVehicleStatusToProcesado(placa: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ver Vehículos", "Generar Órdenes de Descargue", "Generar Órdenes de Cargue"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()
    const empresaId = await getCurrentEmpresaIdForInsert()

    const { error } = await supabase
      .from("citasvehiculos")
      .update({ estatus: "Procesado" })
      .eq("placa", placa)
      .eq("idempresa", empresaId)
      .is("estatus", null)

    if (error) {
      console.error("[v0] Error updating vehicle status:", error)
      return { success: false, error: error.message }
    }

    console.log("[v0] Vehicle status updated to Procesado for placa:", placa)
    return { success: true }
  } catch (error) {
    console.error("[v0] Error in updateVehicleStatusToProcesado:", error)
    return { success: false, error: "Error al actualizar estado del vehículo" }
  }
}

export async function assignVehicleToLoadOrder(orderId: number, vehicleId: number) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Generar Órdenes de Cargue", "Ver Vehículos"], "crear", "Asignar vehículo")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const supabase = await createClient()

    const { data: vehicleData, error: vehicleError } = await supabase
      .from("citasvehiculos")
      .select("placa, nombreconductor, telefono, tipoproducto, horapesoinicial, horaregistro, horallegada, transporte")
      .eq("id", vehicleId)
      .single()

    if (vehicleError || !vehicleData) {
      console.error("[v0] Error fetching vehicle data:", vehicleError)
      return { success: false, error: "Error al obtener datos del vehículo" }
    }

    const { data: orderData, error: orderError } = await supabase
      .from("cabeceraoc")
      .select("ordendecargue, fechaorden, horaorden, observaciones, transporte, fechacargue, pesoorden")
      .eq("id", orderId)
      .single()

    if (orderError || !orderData) {
      console.error("[v0] Error fetching order data:", orderError)
      return { success: false, error: "Error al obtener datos de la orden" }
    }

    const { error: updateError } = await supabase
      .from("cabeceraoc")
      .update({
        placa: vehicleData.placa,
        conductor: vehicleData.nombreconductor,
        celular: vehicleData.telefono,
        tipoproducto: vehicleData.tipoproducto,
        pesajeinicial: vehicleData.horapesoinicial,
        horasanitario: vehicleData.horaregistro,
        horavehiculo: vehicleData.horallegada,
        transporte: vehicleData.transporte, // Add transporte from vehicle
      })
      .eq("id", orderId)

    if (updateError) {
      console.error("[v0] Error updating load order:", updateError)
      return { success: false, error: updateError.message }
    }

    // DISTRIBUCIÓN AUTOMÁTICA (+D): la placa ya quedó fijada en la orden. Si es un
    // vehículo propio de distribución se genera el clon (mismo número + "D"). Se hace
    // AQUÍ (apenas se asigna la placa) para garantizar que corra aunque falle un paso
    // posterior (PDF/estado del vehículo). Idempotente y falla-seguro.
    let distribucionOrderCode: string | null = null
    try {
      distribucionOrderCode = await generarDistribucionAutomatica(supabase, orderId)
    } catch (distErr) {
      console.error("[v0] Excepción en distribución automática al asignar vehículo:", distErr)
    }

    // DESCARGUE AUTOMÁTICO EN CEDI DESTINO (Avimol/Indupan → id3/id4). No depende de la
    // placa; se basa en el destino del detalle. Idempotente (dedup por ordenorigen).
    try {
      await autoGenerarDescarguesCedi(supabase, orderId)
    } catch (cediErr) {
      console.error("[v0] Excepción en descargue automático a CEDI al asignar vehículo:", cediErr)
    }

    const { data: detailsData, error: detailsError } = await supabase
      .from("detalleoc")
      .select("producto, cantidad, toneladas, cliente")
      .eq("idorden", orderId)

    if (detailsError) {
      console.error("[v0] Error fetching order details:", detailsError)
      return { success: false, error: "Error al obtener detalles de la orden" }
    }

    const { data: pedidoData } = await supabase
      .from("pedidoscabecera")
      .select("destino")
      .eq("ocargue", orderData.ordendecargue)
      .limit(1)
      .single()

    console.log("[v0] Regenerating PDF with vehicle information...")
    const pdfData = {
      fechaHora: `${orderData.fechaorden} ${orderData.horaorden}`,
      placa: vehicleData.placa,
      conductor: vehicleData.nombreconductor,
      transporte: vehicleData.transporte || orderData.transporte || "",
      destino: pedidoData?.destino || "",
      observaciones: orderData.observaciones || "",
      products: (detailsData || []).map((detail: any) => ({
        cliente: detail.cliente,
        destino: pedidoData?.destino || "",
        producto: detail.producto,
        cantidad: detail.cantidad,
        pesoKgs: detail.toneladas * 1000,
        lote: "",
        novedad: "",
      })),
      totalUnidades: (detailsData || []).reduce((sum: number, d: any) => sum + (d.cantidad || 0), 0),
      totalPeso: orderData.pesoorden || 0,
    }

    const pdfResult = await generateAndUploadLoadOrderPDF(pdfData, orderId, orderData.ordendecargue)

    if (pdfResult.success && pdfResult.url) {
      const { error: pdfUpdateError } = await supabase
        .from("cabeceraoc")
        .update({ pdfoc: pdfResult.url })
        .eq("id", orderId)

      if (pdfUpdateError) {
        console.error("[v0] Error updating PDF URL:", pdfUpdateError)
      } else {
        console.log("[v0] PDF regenerated and URL updated successfully")
      }
    }

    const { error: statusError } = await supabase
      .from("citasvehiculos")
      .update({
        estatus: "Procesado",
        ocargue: orderData.ordendecargue,
      })
      .eq("id", vehicleId)

    if (statusError) {
      console.error("[v0] Error updating vehicle status:", statusError)
      return { success: false, error: statusError.message }
    }

    return { success: true, distribucionOrderCode }
  } catch (error) {
    console.error("[v0] Error in assignVehicleToLoadOrder:", error)
    return { success: false, error: "Error al asignar vehículo" }
  }
}
