"use server"

import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { revalidatePath } from "next/cache"
import { getCurrentEmpresaId, getEmpresaIdFieldName, shouldFilterByEmpresa } from "@/lib/company-filter"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { getCurrentUser } from "@/lib/auth-actions"
import { tieneModulo } from "@/lib/puerta-modulo"
import { motivoSinAccion } from "@/lib/puerta-modulo"
import type { Verbo } from "@/lib/permisos-verbos"

// LISTA BLANCA DE TABLAS (Fase 0, 2026-10-07).
//
// Estas acciones reciben el nombre de la tabla desde el navegador. Sin lista,
// `createConfigRecord("permisos_usuarios", {...})` o
// `deleteConfigRecord("autorizacion_claves", "id", 1)` eran llamadas válidas
// para cualquiera con sesión: el CRUD genérico de Configuración era una puerta
// de servicio a TODA la base. Ahora solo se aceptan las tablas de los maestros,
// cada una con su llave primaria real (la que manda el cliente debe coincidir)
// y con los módulos del menú que la editan; se exige tener al menos uno.
//
// `cabeceraoc` entra solo para LEER (Báscula la consulta con fetchConfigData);
// no tiene escrituras aquí. `perfil_acceso_empresas`, que config-definitions
// expone como "Accesos de Usuario", queda fuera a propósito: se administra
// desde Autorizaciones, nunca por el CRUD genérico.
const TABLAS_CONFIG: Record<string, { modulos: string[]; pk: string; soloLectura?: boolean }> = {
  almacenes: { modulos: ["Bodegas"], pk: "id" },
  bodegas: { modulos: ["Sucursales", "Bodegas"], pk: "idbodega" },
  categorias: { modulos: ["Categorías"], pk: "id" },
  subcategorias: { modulos: ["Sub Categorías"], pk: "id" },
  clientes: { modulos: ["Clientes"], pk: "id" },
  condicionespago: { modulos: ["Condiciones Pago"], pk: "idcondicion" },
  destinos: { modulos: ["Destinos"], pk: "id" },
  grupos: { modulos: ["Grupos"], pk: "id" },
  medio: { modulos: ["Medios"], pk: "id" },
  productos: { modulos: ["Productos"], pk: "id" },
  tipodespacho: { modulos: ["Tipos Despacho"], pk: "idtipodespacho" },
  vendedores: { modulos: ["Vendedores"], pk: "idvendedor" },
  transportes: { modulos: ["Transportadoras"], pk: "id" },
  tiposvehiculos: { modulos: ["Tipos de Vehiculos"], pk: "id" },
  locations: { modulos: ["Localizaciones"], pk: "id" },
  citasvehiculos: { modulos: ["Ver Vehículos"], pk: "id" },
  proveedores: { modulos: ["Gestión de proveedores"], pk: "id" },
  materiales: { modulos: ["Creación de materiales"], pk: "id" },
  tarifas: { modulos: ["Tarifas"], pk: "id" },
  tarifasoperacion: { modulos: ["Tarifas"], pk: "id" },
  tarifaspersonal: { modulos: ["Tarifas"], pk: "id" },
  tarifasturnos: { modulos: ["Tarifas"], pk: "id" },
  tarifasfacturacionturnos: { modulos: ["Tarifas"], pk: "id" },
  cabeceraoc: { modulos: ["Báscula"], pk: "id", soloLectura: true },
}

/** Verbo del catálogo de políticas que corresponde a cada escritura del CRUD. */
type VerboCrud = Extract<Verbo, "crear" | "editar" | "eliminar">

/**
 * Lista blanca + permiso. Devuelve el motivo si no se puede, `null` si sí.
 * Lecturas: sesión y tabla permitida. Escrituras: además el módulo de la
 * pantalla y, desde la Fase 2, la acción (`<llave>__crear/editar/eliminar`).
 */
async function puertaConfig(tableName: string, verbo: VerboCrud | "ver", primaryKey?: string): Promise<string | null> {
  const def = TABLAS_CONFIG[tableName]
  if (!def) return "Tabla no permitida."
  if (primaryKey !== undefined && primaryKey !== def.pk) return "Llave primaria no válida para esta tabla."
  if (verbo === "ver") {
    const user = await getCurrentUser().catch(() => null)
    return user ? null : "Sesión requerida."
  }
  if (def.soloLectura) return "Esta tabla no se edita desde Configuración."
  if (!(await tieneModulo(def.modulos))) return `Sin permiso para ${def.modulos[0]}.`
  return motivoSinAccion(def.modulos, verbo)
}

export async function fetchConfigData(tableName: string, selectedEmpresaId?: number) {
  const motivo = await puertaConfig(tableName, "ver")
  if (motivo) return { success: false, error: motivo }
  const supabase = await createClient()
  // Use selectedEmpresaId if provided, otherwise fall back to current user's empresa_id
  const empresaId = selectedEmpresaId ?? await getCurrentEmpresaId()

  try {
    if (tableName === "bodegas" || tableName === "sucursales") {
      let bodegasQuery = supabase
        .from("bodegas")
        .select("idbodega, nombrebodega, direccion, ciudad, activo, clienteid")
        .order("idbodega", { ascending: true })

      let clientesQuery = supabase.from("clientes").select("id, nombre")

      if (empresaId) {
        bodegasQuery = bodegasQuery.eq("idempresa", empresaId)
        clientesQuery = clientesQuery.eq("id_empresa", empresaId)
      }

      const [bodegasResult, clientesResult] = await Promise.all([bodegasQuery, clientesQuery])

      if (bodegasResult.error) throw bodegasResult.error
      if (clientesResult.error) throw clientesResult.error

      // Create a map of clientes for quick lookup
      const clientesMap = new Map(clientesResult.data?.map((cliente: any) => [cliente.id, cliente.nombre]) || [])

      // Transform data to include cliente name
      const transformedData = bodegasResult.data?.map((row: any) => ({
        idbodega: row.idbodega,
        cliente: clientesMap.get(row.clienteid) || "Sin cliente",
        nombrebodega: row.nombrebodega,
        direccion: row.direccion,
        ciudad: row.ciudad,
        activo: row.activo,
        clienteid: row.clienteid,
      }))

      return { success: true, data: transformedData }
    }

    if (tableName === "subcategorias") {
      const [subcategoriasResult, categoriasResult] = await Promise.all([
        supabase
          .from("subcategorias")
          .select("id, categoriaid, nombre, activo")
          .order("categoriaid", { ascending: true }),
        supabase.from("categorias").select("id, nombre"),
      ])

      if (subcategoriasResult.error) throw subcategoriasResult.error
      if (categoriasResult.error) throw categoriasResult.error

      // Create a map of categorias for quick lookup
      const categoriasMap = new Map(categoriasResult.data?.map((cat: any) => [cat.id, cat.nombre]) || [])

      // Transform data to include categoria name
      const transformedData = subcategoriasResult.data?.map((row: any) => ({
        id: row.id,
        categoriaid: row.categoriaid,
        categoria: categoriasMap.get(row.categoriaid) || "Sin categoría",
        nombre: row.nombre,
        activo: row.activo,
      }))

      return { success: true, data: transformedData }
    }

    if (tableName === "citasvehiculos") {
      let query = supabase
        .from(tableName)
        .select("*")
        .order("id", { ascending: false })

      if (empresaId) {
        query = query.eq("idempresa", empresaId)
      }

      const { data, error } = await query

      if (error) throw error
      console.log("[v0] Fetched", data?.length || 0, `citasvehiculos for empresa ${empresaId}`)
      return { success: true, data }
    }

    if (tableName === "cabeceraoc") {
      let cabeceraocQuery = supabase.from(tableName).select("*").order("id", { ascending: false })

      if (empresaId) {
        cabeceraocQuery = cabeceraocQuery.eq("idempresa", empresaId)
      }

      const { data, error } = await cabeceraocQuery

      if (error) throw error
      return { success: true, data }
    }

    if (tableName === "locations") {
      let locationsQuery = supabase
        .from("locations")
        .select('id, idempresa, codigo, nombre, "Descripción", bodega, capacidad, activo')
        .order("id", { ascending: true })

      let almacenesQuery = supabase.from("almacenes").select("id, nombre")

      if (empresaId) {
        locationsQuery = locationsQuery.eq("idempresa", empresaId)
        almacenesQuery = almacenesQuery.eq("idempresa", empresaId)
      }

      const [locationsResult, almacenesResult] = await Promise.all([locationsQuery, almacenesQuery])

      if (locationsResult.error) throw locationsResult.error
      if (almacenesResult.error) throw almacenesResult.error

      // Create a map of almacenes for quick lookup
      const almacenesMap = new Map(almacenesResult.data?.map((almacen: any) => [almacen.id, almacen.nombre]) || [])

      const transformedData = locationsResult.data?.map((row: any) => ({
        id: row.id,
        idempresa: row.idempresa,
        codigo: row.codigo,
        nombre: row.nombre,
        Descripción: row.Descripción, // Keep the capital D to match the field name
        bodega: row.bodega, // Store ID directly in bodega field
        capacidad: row.capacidad, // Add capacidad field
        activo: row.activo,
      }))

      return { success: true, data: transformedData }
    }

    if (tableName === "productos") {
      let query = supabase.from("productos").select("*").order("activo", { ascending: false })

      if (empresaId && empresaId !== 3) {
        query = query.eq("id_empresa", empresaId)
        console.log(`[v0] Filtering productos by id_empresa: ${empresaId}`)
      } else if (empresaId === 3) {
        console.log("[v0] Empresa ID is 3, showing all productos without filter")
      }

      const { data, error } = await query

      if (error) throw error

      // Return data as-is since categoria and subcategoria are already stored as text names
      return { success: true, data }
    }

    if (tableName === "tarifas") {
      const [tarifasResult, ownersResult] = await Promise.all([
        supabase
          .from("tarifas")
          .select("id, nombre, inicio, fin, descripcion, unidad, valor, idempresa")
          .order("id", { ascending: true }),
        supabase.from("owners").select("id, nombre"),
      ])

      if (tarifasResult.error) throw tarifasResult.error
      if (ownersResult.error) throw ownersResult.error

      // Create a map of owners for quick lookup
      const ownersMap = new Map(ownersResult.data?.map((owner: any) => [owner.id, owner.nombre]) || [])

      // Transform data to include owner name
      const transformedData = tarifasResult.data?.map((row: any) => ({
        id: row.id,
        nombre: row.nombre,
        inicio: row.inicio,
        fin: row.fin,
        descripcion: row.descripcion,
        unidad: row.unidad,
        valor: row.valor,
        idempresa: row.idempresa,
        empresa: ownersMap.get(row.idempresa) || "Sin empresa",
      }))

      return { success: true, data: transformedData }
    }

    if (tableName === "clientes") {
      let clientesQuery = supabase
        .from("clientes")
        .select("*")
        .order("nombre", { ascending: true })
        .range(0, 10000)

      if (empresaId) {
        clientesQuery = clientesQuery.eq("id_empresa", empresaId)
      }

      const { data, error } = await clientesQuery

      if (error) throw error
      console.log("[v0] Fetched", data?.length || 0, `clientes for empresa ${empresaId}`)
      return { success: true, data }
    }

    // Tarifas: estas tablas NO tienen columna `activo`; se ordenan por id. El
    // filtro por empresa se aplica según EMPRESA_ID_FIELDS/EXCLUDED_TABLES
    // (tarifasfacturacionturnos es global → no se filtra).
    if (["tarifasoperacion", "tarifaspersonal", "tarifasturnos", "tarifasfacturacionturnos"].includes(tableName)) {
      let tq = supabase.from(tableName).select("*").order("id", { ascending: true }).range(0, 10000)
      if (empresaId && (await shouldFilterByEmpresa(tableName))) {
        const f = await getEmpresaIdFieldName(tableName)
        if (f) tq = tq.eq(f, empresaId)
      }
      const { data, error } = await tq
      if (error) throw error
      return { success: true, data }
    }

    let query = supabase.from(tableName).select("*", { count: "exact" }).order("activo", { ascending: false }).range(0, 10000)

    if (empresaId && (await shouldFilterByEmpresa(tableName))) {
      const empresaFieldName = await getEmpresaIdFieldName(tableName)
      if (empresaFieldName) {
        query = query.eq(empresaFieldName, empresaId)
      }
    }

    const { data, error } = await query

    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error(`Error fetching data from ${tableName}:`, error)
    return { success: false, error: "Failed to fetch data" }
  }
}

export async function getNextId(tableName: string, primaryKey: string) {
  const motivo = await puertaConfig(tableName, "ver", primaryKey)
  if (motivo) return { success: false, error: motivo }
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from(tableName)
      .select(primaryKey)
      .order(primaryKey, { ascending: false })
      .limit(1)

    if (error) throw error

    if (!data || data.length === 0) {
      return { success: true, nextId: 1 }
    }

    const maxId = (data[0] as any)[primaryKey]
    return { success: true, nextId: maxId + 1 }
  } catch (error) {
    console.error(`Error getting next ID from ${tableName}:`, error)
    return { success: false, error: "Failed to get next ID" }
  }
}

export async function createConfigRecord(tableName: string, data: any, selectedEmpresaId?: number) {
  const motivo = await puertaConfig(tableName, "crear")
  if (motivo) return { success: false, error: motivo }
  // Con actor: así la auditoría (trigger fn_auditoria) sabe quién creó la fila.
  // Antes se escribía con el singleton de servicio y quedaba como "sistema".
  const supabase = await getSupabaseAdmin()

  try {
    const empresaFieldName = await getEmpresaIdFieldName(tableName)
    if (empresaFieldName && (await shouldFilterByEmpresa(tableName))) {
      data[empresaFieldName] = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())
    }

    const { data: createdData, error } = await supabase.from(tableName).insert(data).select()

    if (error) throw error

    revalidatePath("/")
    return { success: true, data: createdData?.[0] }
  } catch (error) {
    console.error(`Error creating record in ${tableName}:`, error)
    return { success: false, error: "Failed to create record" }
  }
}

export async function updateConfigRecord(tableName: string, primaryKey: string, id: any, data: any) {
  const motivo = await puertaConfig(tableName, "editar", primaryKey)
  if (motivo) return { success: false, error: motivo }
  const supabase = await getSupabaseAdmin()

  try {
    const { error } = await supabase.from(tableName).update(data).eq(primaryKey, id)

    if (error) throw error

    revalidatePath("/")
    return { success: true }
  } catch (error) {
    console.error(`Error updating record in ${tableName}:`, error)
    return { success: false, error: "Failed to update record" }
  }
}

export async function deleteConfigRecord(tableName: string, primaryKey: string, id: any) {
  const motivo = await puertaConfig(tableName, "eliminar", primaryKey)
  if (motivo) return { success: false, error: motivo }
  const supabase = await getSupabaseAdmin()

  try {
    // Ver Vehículos: solo se borra una cita SIN orden de cargue. La regla
    // vivía en el navegador (generic-crud-table.tsx) y aquí no se comprobaba.
    if (tableName === "citasvehiculos") {
      const { data: cita } = await supabase.from("citasvehiculos").select("ocargue").eq(primaryKey, id).maybeSingle()
      const oc = String(cita?.ocargue ?? "").trim()
      if (oc) return { success: false, error: `Este vehículo tiene la Orden de Cargue ${oc} asignada. Elimine primero la OC.` }
    }
    const { error } = await supabase.from(tableName).delete().eq(primaryKey, id)

    if (error) throw error

    revalidatePath("/")
    return { success: true }
  } catch (error) {
    console.error(`Error deleting record from ${tableName}:`, error)
    return { success: false, error: "Failed to delete record" }
  }
}

export async function fetchCategorias() {
  const supabase = await createClient()

  try {
    console.log("[v0] Fetching categorias...")

    const { data, error } = await supabase
      .from("categorias")
      .select("id, nombre, activo")
      .order("nombre", { ascending: true })

    console.log("[v0] Categorias data:", data)
    console.log("[v0] Categorias error:", error)

    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error("Error fetching categorias:", error)
    return { success: false, error: "Failed to fetch categorias" }
  }
}

export async function fetchSubcategorias(categoriaid?: number) {
  const supabase = await createClient()

  try {
    let query = supabase
      .from("subcategorias")
      .select("id, categoriaid, nombre, activo")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (categoriaid !== undefined) {
      query = query.eq("categoriaid", categoriaid)
    }

    const { data, error } = await query

    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error("Error fetching subcategorias:", error)
    return { success: false, error: "Failed to fetch subcategorias" }
  }
}

export async function fetchClientes(selectedEmpresaId?: number) {
  const supabase = await createClient()
  const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaId())

  try {
    let query = supabase.from("clientes").select("id, nombre").eq("activo", true).order("nombre", { ascending: true })

    if (empresaId) {
      query = query.eq("id_empresa", empresaId)
    }

    const { data, error } = await query

    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error("Error fetching clientes:", error)
    return { success: false, error: "Failed to fetch clientes" }
  }
}

export async function fetchTransportes() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("transportes")
      .select("id, nombretransporte")
      .order("nombretransporte", { ascending: true })

    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error("Error fetching transportes:", error)
    return { success: false, error: "Failed to fetch transportes" }
  }
}

export async function fetchTiposVehiculos() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("tiposvehiculos")
      .select("id, nombretipo")
      .eq("activo", true)
      .order("nombretipo", { ascending: true })

    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error("Error fetching tipos vehiculos:", error)
    return { success: false, error: "Failed to fetch tipos vehiculos" }
  }
}

export async function fetchTiposDespacho() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("tipodespacho")
      .select("idtipodespacho, nombretipodespacho")
      .eq("activo", true)
      .order("nombretipodespacho", { ascending: true })

    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error("Error fetching tipos despacho:", error)
    return { success: false, error: "Failed to fetch tipos despacho" }
  }
}

export async function getBodegasForSelect() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("bodegas")
      .select("nombrebodega")
      .eq("activo", true)
      .order("nombrebodega", { ascending: true })

    if (error) throw error

    // Transform to match expected format with 'nombre' field
    const transformedData =
      data?.map((bodega: any) => ({
        nombre: bodega.nombrebodega,
      })) || []

    return transformedData
  } catch (error) {
    console.error("Error fetching bodegas:", error)
    return []
  }
}

export async function getCategoriasForSelect() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("categorias")
      .select("nombre")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error("Error fetching categorias:", error)
    return []
  }
}

export async function getProductosForSelect() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("productos")
      .select("nombre, categoria")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error("Error fetching productos:", error)
    return []
  }
}

export async function getCategoriasForFilter() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("categorias")
      .select("nombre")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error("Error fetching categorias for filter:", error)
    return []
  }
}

export async function getSubcategoriasForFilter(categoriaNombre: string) {
  const supabase = await createClient()

  try {
    // First get the categoria ID
    const { data: categoriaData, error: categoriaError } = await supabase
      .from("categorias")
      .select("id")
      .eq("nombre", categoriaNombre)
      .eq("activo", true)
      .maybeSingle()

    if (categoriaError || !categoriaData) {
      console.error("Error fetching categoria ID:", categoriaError)
      return []
    }

    // Then get subcategorias for that categoria
    const { data, error } = await supabase
      .from("subcategorias")
      .select("nombre")
      .eq("categoriaid", categoriaData.id)
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error("Error fetching subcategorias for filter:", error)
    return []
  }
}

export async function fetchDestinos() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("destinos")
      .select("id, nombre, departamento")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) throw error

    return { success: true, data }
  } catch (error) {
    console.error("Error fetching destinos:", error)
    return { success: false, error: "Failed to fetch destinos" }
  }
}

export async function getProductosForFilter(selectedEmpresaId?: number) {
  const supabase = await createClient()
  const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

  try {
    let query = supabase
      .from("productos")
      .select("nombre")
      .eq("activo", true)
      .eq("id_empresa", empresaId)
      .order("nombre", { ascending: true })

    const { data, error } = await query

    if (error) throw error
    console.log("[v0] Fetched productos for empresa", empresaId, ":", data?.length || 0)
    return data || []
  } catch (error) {
    console.error("Error fetching productos for filter:", error)
    return []
  }
}

export async function fetchAlmacenes() {
  const supabase = await createClient()
  const empresaId = await getCurrentEmpresaId()

  try {
    let query = supabase.from("almacenes").select("id, nombre").order("nombre", { ascending: true })

    if (empresaId) {
      query = query.eq("idempresa", empresaId)
    }

    const { data, error } = await query

    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error("Error fetching almacenes:", error)
    return { success: false, error: "Failed to fetch almacenes" }
  }
}

export async function fetchVehicleTypeCapacity(vehicleTypeName: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("tiposvehiculos")
      .select("capacidad")
      .eq("nombretipo", vehicleTypeName)
      .single()

    if (error) throw error
    return { success: true, capacidad: data?.capacidad || null }
  } catch (error) {
    console.error("Error fetching vehicle type capacity:", error)
    return { success: false, capacidad: null }
  }
}

export async function getSubcategoriasByCategoriaName(categoriaNombre: string) {
  const supabase = await createClient()

  try {
    // First get the categoria ID
    const { data: categoriaData, error: categoriaError } = await supabase
      .from("categorias")
      .select("id")
      .eq("nombre", categoriaNombre)
      .eq("activo", true)
      .maybeSingle()

    if (categoriaError || !categoriaData) {
      console.error("Error fetching categoria ID:", categoriaError)
      return { success: false, data: [] }
    }

    // Then get subcategorias for that categoria
    const { data, error } = await supabase
      .from("subcategorias")
      .select("nombre")
      .eq("categoriaid", categoriaData.id)
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) throw error
    return { success: true, data: data || [] }
  } catch (error) {
    console.error("Error fetching subcategorias:", error)
    return { success: false, data: [] }
  }
}
