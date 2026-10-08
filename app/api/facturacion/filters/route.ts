import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"
import { exigirSesionApi } from "@/lib/puerta-api"

export async function GET(request: Request) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const supabase = await createClient()

    const sortStr = (arr: any[]) => arr.filter(Boolean).sort((a, b) => (a > b ? 1 : a < b ? -1 : 0))
    const getUnique = (data: any[] | null, field: string) => {
      if (!data) return []
      return sortStr([...new Set(data.map((item) => item[field]).filter(Boolean))])
    }

    // Valores de filtro DISTINCT del lado de BD (vista facturacion_filtros) para NO
    // toparse en 1000 filas y perder opciones de alta cardinalidad (placa/transporte).
    // Si la vista aún no existe, se cae a los selects acotados de antes (no rompe).
    let owners: any[] = []
    let playas: any[] = []
    let subcategorias: any[] = []
    let transportes: any[] = []
    const distinctRes = await supabase.from("facturacion_filtros").select("tipo, valor")
    if (!distinctRes.error && distinctRes.data) {
      const byTipo = (t: string) => sortStr(distinctRes.data!.filter((r: any) => r.tipo === t).map((r: any) => r.valor))
      owners = byTipo("owner")
      playas = byTipo("placa")
      subcategorias = byTipo("subcategoria")
      transportes = byTipo("transporte")
    } else {
      const [ownersRes, playasRes, subcategoriasRes, transportesRes] = await Promise.all([
        supabase.from("facturacion").select("owner").not("owner", "is", null),
        supabase.from("facturacion").select("placa").not("placa", "is", null),
        supabase.from("facturacion").select("subcategoria").not("subcategoria", "is", null),
        supabase.from("facturacion").select("transporte").not("transporte", "is", null),
      ])
      owners = getUnique(ownersRes.data, "owner")
      playas = getUnique(playasRes.data, "placa")
      subcategorias = getUnique(subcategoriasRes.data, "subcategoria")
      transportes = getUnique(transportesRes.data, "transporte")
    }

    // Empresas (catálogo completo + las presentes en facturación) y puestos (baja
    // cardinalidad: sus valores distintos aparecen dentro del muestreo).
    const [empresasRes, todasEmpresas, puestosRes] = await Promise.all([
      supabase.from("facturacion").select("idempresa").not("idempresa", "is", null),
      supabase.from("empresas").select("id, nombre"),
      supabase.from("facturacionturnos").select("puesto").not("puesto", "is", null),
    ])

    const facturacionEmpresas = getUnique(empresasRes.data || [], "idempresa")
    const allEmpresas = todasEmpresas.data || []

    const empresasMap = new Map<number, string>()
    allEmpresas.forEach((emp: any) => {
      empresasMap.set(emp.id, emp.nombre)
    })
    facturacionEmpresas.forEach((id: number) => {
      if (!empresasMap.has(id)) {
        empresasMap.set(id, `Empresa ${id}`)
      }
    })

    const empresasFormatted = Array.from(empresasMap.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.id - b.id)

    const tiposOperacionHardcoded = ["Cargue", "Descargue", "Tolva", "Tolva f", "Distribucion"]

    const filters = {
      owners,
      playas,
      subcategorias,
      empresas: empresasFormatted,
      transportes,
      tiposOperacion: tiposOperacionHardcoded,
      puestos: getUnique(puestosRes.data || [], "puesto"),
    }

    return NextResponse.json(filters)
  } catch (error) {
    console.error("[v0] Error fetching filter options:", error)
    return NextResponse.json(
      {
        owners: [],
        playas: [],
        subcategorias: [],
        empresas: [],
        transportes: [],
        tiposOperacion: [],
        puestos: [],
      },
      { status: 200 },
    )
  }
}
