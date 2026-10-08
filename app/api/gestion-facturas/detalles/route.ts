import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { parseColombianNumber } from "@/lib/parse-colombian-number"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const numeroOrden = searchParams.get("numeroOrden")
    const empresaIdParam = searchParams.get("empresaId")

    if (!numeroOrden) {
      return NextResponse.json({ success: false, error: "numeroOrden es requerido" }, { status: 400 })
    }

    const supabase = await getSupabaseAdmin()
    const empresaId = empresaIdParam ? parseInt(empresaIdParam, 10) : null

    // Para empresas 1 y 2: usar MAX(peso_bascula) como peso y MAX(tarifa) para calcular valor
    // Para el resto de empresas: mantener el calculo actual (valor_a_facturar de la tabla)
    if (empresaId === 1 || empresaId === 2) {
      // Traer todos los registros de la orden para calcular MAX manualmente
      // (Supabase JS no soporta agregaciones tipo MAX directamente)
      // La columna real en la tabla `facturacion` es `pesobascula`
      // (sin guion bajo). Se usa alias para mantener el nombre interno.
      const { data: rawData, error } = await supabase
        .from("facturacion")
        .select("producto, toneladas, subcategoria, tarifa, valor_a_facturar, peso_bascula:pesobascula")
        .eq("numeroorden", numeroOrden)

      if (error) {
        console.error("Error fetching detalles facturacion:", error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }

      if (!rawData || rawData.length === 0) {
        return NextResponse.json({ success: true, data: [] })
      }

      // Calcular MAX(peso_bascula) y MAX(tarifa) sobre todos los registros.
      // Usamos parseColombianNumber para manejar formatos como "1.500" (=1500),
      // "1.234,56" (=1234.56), "$ 850.000" (=850000), etc.
      let maxPesoBascula = 0
      let maxTarifa = 0

      for (const row of rawData) {
        const pesoBascula = parseColombianNumber(row.peso_bascula)
        const tarifaNum = parseColombianNumber(row.tarifa)
        if (pesoBascula > maxPesoBascula) maxPesoBascula = pesoBascula
        if (tarifaNum > maxTarifa) maxTarifa = tarifaNum
      }

      // Calcular valor a facturar: MAX(peso_bascula) * MAX(tarifa)
      const valorCalculado = maxPesoBascula * maxTarifa

      // Agrupar por producto/subcategoria pero devolver el valor calculado
      // Para simplificar, devolvemos un unico registro consolidado con el calculo
      // o si prefieres mantener la estructura, agrupamos por producto
      const grouped = new Map<string, { producto: string; subcategoria: string; toneladas: number }>()
      for (const row of rawData) {
        const key = `${row.producto || ""}|${row.subcategoria || ""}`
        const toneladas = parseColombianNumber(row.toneladas)
        if (!grouped.has(key)) {
          grouped.set(key, {
            producto: row.producto || "",
            subcategoria: row.subcategoria || "",
            toneladas,
          })
        } else {
          const existing = grouped.get(key)!
          existing.toneladas += toneladas
        }
      }

      // Para empresas 1 y 2 el valor a facturar NO se desglosa por producto:
      // es un unico valor global = MAX(peso_bascula) * MAX(tarifa). Se deja
      // `valor_a_facturar = 0` en cada fila para que la tabla del detalle no
      // muestre sumas incorrectas, y se expone `totalCalculado` a nivel
      // superior para que el componente lo use como subtotal directamente.
      const result = Array.from(grouped.values()).map((g) => ({
        producto: g.producto,
        toneladas: g.toneladas,
        subcategoria: g.subcategoria,
        tarifa: maxTarifa,
        valor_a_facturar: 0,
        peso_bascula_max: maxPesoBascula,
        tarifa_max: maxTarifa,
      }))

      return NextResponse.json({
        success: true,
        data: result,
        // Total explicito a usar como subtotal en la UI (empresas 1 y 2)
        totalCalculado: valorCalculado,
        meta: {
          empresaId,
          calculoEspecial: true,
          maxPesoBascula,
          maxTarifa,
          valorCalculado,
        },
      })
    }

    // Calculo normal para otras empresas
    const { data, error } = await supabase
      .from("facturacion")
      .select("producto, toneladas, subcategoria, tarifa, valor_a_facturar")
      .eq("numeroorden", numeroOrden)

    if (error) {
      console.error("Error fetching detalles facturacion:", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data || [] })
  } catch (error) {
    console.error("Error in gestion-facturas/detalles API:", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
