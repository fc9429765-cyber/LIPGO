"use server"

import { createClient } from "@/lib/supabase-client"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { exigirAccion } from "@/lib/puerta-modulo"

export interface Product {
  id: number
  nombre: string
}

export interface Material {
  id: number
  codigo: string
  nombre: string
  tipo: string
  undmedida: string
}

export interface MaterialExplosion {
  id: number
  idempresa: number
  producto: string
  idproducto: number
  material: string
  codmat: string
  idmaterial: number
  tipomaterial: string
  consumo: number
  unidad: string
}

export interface MaterialExplosionWithDetails extends MaterialExplosion {
  productName?: string
  materialName?: string
}

export async function getProducts() {
  const supabase = await createClient()

  const { data, error } = await supabase.from("productos").select("id, nombre").eq("activo", true).order("nombre")

  if (error) throw new Error(`Error fetching products: ${error.message}`)
  return data as Product[]
}

export async function getMaterials() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("materiales")
    .select("id, codigo, nombre, tipo, undmedida")
    .eq("activo", true)
    .order("nombre")

  if (error) throw new Error(`Error fetching materials: ${error.message}`)
  return data as Material[]
}

export async function getExplosionsByProduct(productId: number) {
  const supabase = await createClient()

  const { data, error } = await supabase.from("mrpexplosion").select("*").eq("idproducto", productId).order("material")

  if (error) throw new Error(`Error fetching explosions: ${error.message}`)
  return data as MaterialExplosion[]
}

export async function getAllExplosions() {
  const supabase = await createClient()

  const { data, error } = await supabase.from("mrpexplosion").select("*").order("producto", { ascending: true })

  if (error) throw new Error(`Error fetching all explosions: ${error.message}`)
  return data as MaterialExplosion[]
}

export async function createMaterialExplosion(
  productId: number,
  productName: string,
  materials: Array<{
    materialId: number
    materialName: string
    materialCode: string
    materialType: string
    materialUnit: string
    consumo: number
  }>,
  selectedEmpresaId?: number,
) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Explosión de materiales"], "crear")
  const supabase = await createClient()

  const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

  const explosions = materials.map((material) => ({
    idempresa: empresaId, // Use dynamic empresa ID
    producto: productName,
    idproducto: productId,
    material: material.materialName,
    codmat: material.materialCode,
    idmaterial: material.materialId,
    tipomaterial: material.materialType,
    consumo: material.consumo,
    unidad: material.materialUnit,
  }))

  const { error } = await supabase.from("mrpexplosion").insert(explosions)

  if (error) throw new Error(`Error creating explosion: ${error.message}`)
}

export async function deleteMaterialExplosion(id: number) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Explosión de materiales"], "eliminar")
  const supabase = await createClient()

  const { error } = await supabase.from("mrpexplosion").delete().eq("id", id)

  if (error) throw new Error(`Error deleting explosion: ${error.message}`)
}

export async function updateMaterialExplosion(id: number, consumo: number) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  await exigirAccion(["Explosión de materiales"], "editar")
  const supabase = await createClient()

  const { error } = await supabase.from("mrpexplosion").update({ consumo }).eq("id", id)

  if (error) throw new Error(`Error updating explosion: ${error.message}`)
}
