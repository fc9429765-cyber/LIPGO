import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { excluirPlacasFacturas, excluirNoFacturable } from "@/lib/facturas-exclusiones"
import * as XLSX from "xlsx"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
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

    // Construimos la consulta (con TODOS los filtros) en una función para poder
    // PAGINAR: PostgREST topa cada respuesta en 1000 filas, así que un único request
    // truncaría el Excel en silencio (y contradiría el total mostrado en pantalla).
    // Iteramos por páginas de 1000 hasta agotar los datos.
    const makeQuery = () => {
      let query = supabase
        .from("cabeceraoc")
        .select("id, ordendecargue, fechaorden, placa, transporte, tipooperacion, pesoorden, tiquetebascula, pesovascula, fechacargue, estadofactura, mediopago, valorpago, iva, comprobante, cuentatransferencia, retefuente, cliente")
        .neq("tipooperacion", "proyeccion")
        .order("id", { ascending: false })
      // Órdenes marcadas como NO facturables (personal de carga no-LIP): fuera del cobro.
      query = excluirNoFacturable(query)
      if (empresaId) {
        const emp = parseInt(empresaId, 10)
        query = query.eq("idempresa", emp)
        // Placas que LIP no atiende en el cargue de este proyecto: se excluyen.
        query = excluirPlacasFacturas(query, emp)
      }
      if (search) {
        query = query.or(`ordendecargue.ilike.%${search}%,placa.ilike.%${search}%,transporte.ilike.%${search}%`)
      }
      if (ordenFilter) query = query.ilike("ordendecargue", `%${ordenFilter}%`)
      if (fechaCargueDesde) query = query.gte("fechacargue", fechaCargueDesde)
      if (fechaCargueHasta) query = query.lte("fechacargue", fechaCargueHasta)
      if (placaFilter) query = query.ilike("placa", `%${placaFilter}%`)
      if (transporteFilter && transporteFilter !== "all") query = query.ilike("transporte", `%${transporteFilter}%`)
      if (estadoFilter && estadoFilter !== "all") {
        if (estadoFilter === "pendiente") query = query.is("estadofactura", null)
        else if (estadoFilter === "facturado") query = query.eq("estadofactura", "Facturado - por validar")
        else if (estadoFilter === "credito") query = query.eq("estadofactura", "A credito")
        else if (estadoFilter === "validado") query = query.ilike("estadofactura", "%validado%")
      }
      if (tipoOperacionFilter && tipoOperacionFilter !== "all") query = query.eq("tipooperacion", tipoOperacionFilter)
      if (medioPagoFilter && medioPagoFilter !== "all") query = query.eq("mediopago", medioPagoFilter)
      if (cuentaFilter && cuentaFilter !== "all") query = query.eq("cuentatransferencia", cuentaFilter)
      return query
    }

    const PAGE = 1000
    const data: any[] = []
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await makeQuery().range(from, from + PAGE - 1)
      if (error) {
        console.error("Error fetching data for export:", error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      if (!page || page.length === 0) break
      data.push(...page)
      if (page.length < PAGE) break
    }

    if (data.length === 0) {
      return NextResponse.json({ success: false, error: "No hay datos para exportar" }, { status: 400 })
    }

    // Format data for Excel
    const excelData = data.map((item) => ({
      "ID": item.id,
      "Orden de Cargue": item.ordendecargue,
      "Fecha Orden": item.fechaorden ? new Date(item.fechaorden).toLocaleDateString("es-CO") : "",
      "Fecha Cargue": item.fechacargue ? new Date(item.fechacargue).toLocaleDateString("es-CO") : "",
      "Placa": item.placa,
      "Transporte": item.transporte,
      "Tipo Operacion": item.tipooperacion,
      "Peso Orden": item.pesoorden,
      "Tiquete Bascula": item.tiquetebascula,
      "Peso Bascula": item.pesovascula,
      "Cliente": item.cliente || "",
      "Estado Factura": item.estadofactura || "Pendiente por procesar",
      "Medio de Pago": item.mediopago || "",
      "Cuenta Transferencia": item.cuentatransferencia || "",
      "Valor Pago": item.valorpago || 0,
      "IVA": item.iva || 0,
      "Retefuente": item.retefuente || 0,
    }))

    // Create Excel workbook
    const worksheet = XLSX.utils.json_to_sheet(excelData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Gestion Facturas")

    // Generate buffer
    const excelBuffer = XLSX.write(workbook, { type: "base64", bookType: "xlsx" })
    const today = new Date().toISOString().split("T")[0]
    const filename = `Gestion_Facturas_${today}.xlsx`

    return NextResponse.json({
      success: true,
      data: excelBuffer,
      filename: filename,
    })
  } catch (error) {
    console.error("Error exporting to Excel:", error)
    return NextResponse.json({ success: false, error: "Error al generar el archivo Excel" }, { status: 500 })
  }
}
