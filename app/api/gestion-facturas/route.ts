import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { parseColombianNumber } from "@/lib/parse-colombian-number"
import { excluirPlacasFacturas, excluirNoFacturable } from "@/lib/facturas-exclusiones"
import { exigirSesionApi, exigirModuloApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    const page = parseInt(searchParams.get("page") || "1", 10)
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10)
    const search = searchParams.get("search") || ""
    
    // Filter params
    const ordenFilter = searchParams.get("orden") || ""
    const fechaCargueDesde = searchParams.get("fechaCargueDesde") || ""
    const fechaCargueHasta = searchParams.get("fechaCargueHasta") || ""
    const placaFilter = searchParams.get("placa") || ""
    const transporteFilter = searchParams.get("transporte") || ""
    const estadoFilter = searchParams.get("estado") || ""
    const tipoOperacionFilter = searchParams.get("tipoOperacion") || ""
    const medioPagoFilter = searchParams.get("medioPago") || ""
    const cuentaFilter = searchParams.get("cuenta") || ""

    const supabase = await getSupabaseAdmin()

    // Calculate offset
    const offset = (page - 1) * pageSize

    // Helper function to apply filters to a query. `q: any` porque la cadena
    // .eq()/.or()/.ilike() devuelve un FilterBuilder distinto del QueryBuilder
    // inicial y la reasignación no tipa. Type-only, no cambia el runtime.
    const applyFilters = (q: any) => {
      // Órdenes marcadas como NO facturables (personal de carga no-LIP): fuera del cobro.
      q = excluirNoFacturable(q)
      if (empresaId) {
        const emp = parseInt(empresaId, 10)
        q = q.eq("idempresa", emp)
        // Placas que LIP no atiende en el cargue de este proyecto: se excluyen.
        q = excluirPlacasFacturas(q, emp)
      }
      if (search) {
        q = q.or(`ordendecargue.ilike.%${search}%,placa.ilike.%${search}%,transporte.ilike.%${search}%`)
      }
      if (ordenFilter) {
        q = q.ilike("ordendecargue", `%${ordenFilter}%`)
      }
      if (fechaCargueDesde) {
        q = q.gte("fechacargue", fechaCargueDesde)
      }
      if (fechaCargueHasta) {
        q = q.lte("fechacargue", fechaCargueHasta)
      }
      if (placaFilter) {
        q = q.ilike("placa", `%${placaFilter}%`)
      }
      if (transporteFilter && transporteFilter !== "all") {
        q = q.ilike("transporte", `%${transporteFilter}%`)
      }
      if (estadoFilter && estadoFilter !== "all") {
        if (estadoFilter === "pendiente") {
          q = q.is("estadofactura", null)
        } else if (estadoFilter === "sf_pago_confirmado") {
          q = q.eq("estadofactura", "SF - Pago confirmado")
        } else if (estadoFilter === "sf_cerrado") {
          q = q.eq("estadofactura", "SF - Cerrado")
        } else if (estadoFilter === "cf_solicitada") {
          q = q.eq("estadofactura", "CF - Factura solicitada")
        } else if (estadoFilter === "cf_cerrado") {
          q = q.eq("estadofactura", "CF - Cerrado")
        } else if (estadoFilter === "facturado") {
          q = q.eq("estadofactura", "Facturado - por validar")
        } else if (estadoFilter === "credito") {
          q = q.eq("estadofactura", "A credito")
        } else if (estadoFilter === "validado") {
          q = q.ilike("estadofactura", "%validado%")
        }
      }
      if (tipoOperacionFilter && tipoOperacionFilter !== "all") {
        q = q.eq("tipooperacion", tipoOperacionFilter)
      }
      if (medioPagoFilter && medioPagoFilter !== "all") {
        q = q.eq("mediopago", medioPagoFilter)
      }
      if (cuentaFilter && cuentaFilter !== "all") {
        q = q.eq("cuentatransferencia", cuentaFilter)
      }
      return q
    }

    // First get total count
    let countQuery = supabase
      .from("cabeceraoc")
      .select("id", { count: "exact", head: true })
      .neq("tipooperacion", "proyeccion")

    countQuery = applyFilters(countQuery)

    const { count, error: countError } = await countQuery

    if (countError) {
      console.error("Error counting ordenes:", countError)
      return NextResponse.json({ success: false, error: countError.message }, { status: 500 })
    }

    // Then get paginated data
    let query = supabase
      .from("cabeceraoc")
      .select("id, ordendecargue, fechaorden, placa, transporte, tipooperacion, pesoorden, tiquetebascula, pesovascula, fechacargue, estadofactura, mediopago, valorpago, iva, comprobante, cuentatransferencia, retefuente, idempresa, facturasiigo, cliente, observacionesfactura")
      .neq("tipooperacion", "proyeccion")
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1)

    query = applyFilters(query)

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching ordenes:", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    let enriched = data || []

    // Regla especial empresas 1 y 2: en el listado, la columna "Peso Orden"
    // mantiene el valor ORIGINAL de `cabeceraoc.pesoorden` (sin override).
    // Solo se calcula el campo auxiliar `valor_a_facturar_calculado` usando
    // MAX(peso_bascula) * MAX(tarifa) de la tabla `facturacion`, para la
    // columna "Valor a Facturar" del listado y el subtotal del detalle.
    const empresaIdNum = empresaId ? parseInt(empresaId, 10) : null
    if ((empresaIdNum === 1 || empresaIdNum === 2) && enriched.length > 0) {
      const numerosOrden = enriched
        .map((o: any) => o.ordendecargue)
        .filter((n: any) => n !== null && n !== undefined && n !== "")

      if (numerosOrden.length > 0) {
        // La columna real en la tabla `facturacion` se llama `pesobascula`
        // (sin guion bajo). La aliamos a `peso_bascula` para no tocar el
        // codigo de parseo ni los consumidores.
        const { data: facturacionRows, error: facturacionError } = await supabase
          .from("facturacion")
          .select("numeroorden, peso_bascula:pesobascula, tarifa")
          .in("numeroorden", numerosOrden)

        if (facturacionError) {
          console.error("[v0] Error fetching facturacion for listing:", facturacionError)
          // No bloquear la respuesta: devolver datos sin override
        } else {
          // Mapa: numeroorden -> { maxPeso, maxTarifa }
          const agg = new Map<string, { maxPeso: number; maxTarifa: number }>()
          for (const row of facturacionRows || []) {
            const key = String(row.numeroorden)
            const peso = parseColombianNumber((row as any).peso_bascula)
            const tarifa = parseColombianNumber(row.tarifa)
            const existing = agg.get(key)
            if (!existing) {
              agg.set(key, { maxPeso: peso, maxTarifa: tarifa })
            } else {
              if (peso > existing.maxPeso) existing.maxPeso = peso
              if (tarifa > existing.maxTarifa) existing.maxTarifa = tarifa
            }
          }

          // Adjuntar SOLO el valor calculado (peso * tarifa).
          // NO se sobreescribe `pesoorden`: la columna "Peso Orden" del
          // listado debe seguir mostrando el valor original de cabeceraoc.
          enriched = enriched.map((o: any) => {
            const info = agg.get(String(o.ordendecargue))
            if (!info) return o
            return {
              ...o,
              valor_a_facturar_calculado: info.maxPeso * info.maxTarifa,
            }
          })
        }
      }
    }

    const totalPages = Math.ceil((count || 0) / pageSize)

    return NextResponse.json({
      success: true,
      data: enriched,
      pagination: {
        page,
        pageSize,
        totalCount: count || 0,
        totalPages
      }
    })
  } catch (error) {
    console.error("[v0] Error in gestion-facturas API:", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const puerta = await exigirModuloApi(["Solicitar Facturas", "Cuadro de Control Facturación"])
  if (puerta) return puerta
  try {
    const body = await request.json()
    const { orderId, mediopago, valorpago, iva, comprobante, cuentatransferencia, retefuente, estadofactura, cliente, observacionesfactura } = body

    if (!orderId) {
      return NextResponse.json({ success: false, error: "orderId es requerido" }, { status: 400 })
    }

    const supabase = await getSupabaseAdmin()

    // Use provided estadofactura if set (e.g., "A credito"), otherwise default to "Facturado - por validar"
    const finalEstadoFactura = estadofactura || "Facturado - por validar"

    // Build update object
    const updateData: Record<string, unknown> = {
      mediopago,
      valorpago,
      iva,
      comprobante,
      cuentatransferencia,
      retefuente,
      estadofactura: finalEstadoFactura
    }

    // Only include cliente if provided
    if (cliente !== undefined) {
      updateData.cliente = cliente
    }

    // Observaciones del coordinador al registrar facturacion (ambos flujos).
    // Se persiste en cabeceraoc.observacionesfactura.
    if (observacionesfactura !== undefined) {
      updateData.observacionesfactura = observacionesfactura
    }

    const { data, error } = await supabase
      .from("cabeceraoc")
      .update(updateData)
      .eq("id", orderId)
      .select()
      .single()

    if (error) {
      console.error("[v0] Error updating factura:", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error in gestion-facturas PUT:", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const puerta = await exigirModuloApi(["Solicitar Facturas", "Cuadro de Control Facturación"])
  if (puerta) return puerta
  try {
    const body = await request.json()
    const { orderId, estadofactura, cliente, iva, retefuente, valorpago, cuentatransferencia, facturasiigo } = body

    if (!orderId) {
      return NextResponse.json({ success: false, error: "orderId es requerido" }, { status: 400 })
    }

    if (!estadofactura) {
      return NextResponse.json({ success: false, error: "estadofactura es requerido" }, { status: 400 })
    }

    const supabase = await getSupabaseAdmin()

    // Build update object with editable fields
    const updateData: Record<string, unknown> = { estadofactura }
    
    if (cliente !== undefined) {
      updateData.cliente = cliente
    }
    if (iva !== undefined) {
      updateData.iva = iva
    }
    if (retefuente !== undefined) {
      updateData.retefuente = retefuente
    }
    // Permitir actualizar valorpago al cerrar facturacion (flujo CON FACTURA)
    if (valorpago !== undefined) {
      updateData.valorpago = valorpago
    }
    // Permitir seleccionar cuenta de transferencia al cerrar facturacion
    // (aplica tambien para Credito cuando se elige en Procesar Factura)
    if (cuentatransferencia !== undefined) {
      updateData.cuentatransferencia = cuentatransferencia
    }
    // Permite LIMPIAR la factura Siigo (facturasiigo: null) al eliminarla desde
    // Solicitar Facturas (acción protegida por contraseña).
    if (facturasiigo !== undefined) {
      updateData.facturasiigo = facturasiigo
    }

    const { data, error } = await supabase
      .from("cabeceraoc")
      .update(updateData)
      .eq("id", orderId)
      .select()
      .single()

    if (error) {
      console.error("Error updating estado factura:", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("Error in gestion-facturas PATCH:", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
