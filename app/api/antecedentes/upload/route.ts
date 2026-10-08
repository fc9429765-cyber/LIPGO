import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { exigirAccionApi } from "@/lib/puerta-api"

// Sube los certificados de antecedentes (Policia, Procuraduria, Contraloria)
// a Supabase Storage (bucket "archivos") y guarda sus metadatos asociados al
// candidato/trabajador (empresa, hoja de vida, cedula, nombre).
export async function POST(request: NextRequest) {
  const puerta = await exigirAccionApi(["Antecedentes", "Gestión de Solicitudes"], "editar")
  if (puerta) return puerta
  try {
    const formData = await request.formData()

    const hojaVidaId = (formData.get("hoja_vida_id") as string) || ""
    const cedula = (formData.get("cedula") as string) || ""
    const nombre = (formData.get("nombre") as string) || ""

    if (!nombre.trim()) {
      return NextResponse.json({ error: "Debe seleccionar un candidato" }, { status: 400 })
    }

    const policia = formData.get("policia") as File | null
    const procuraduria = formData.get("procuraduria") as File | null
    const contraloria = formData.get("contraloria") as File | null

    if (!policia && !procuraduria && !contraloria) {
      return NextResponse.json({ error: "Adjunte al menos un certificado" }, { status: 400 })
    }

    // Empresa seleccionada dinamicamente desde la parte superior (si viene);
    // si no, usamos la empresa de sesion como respaldo.
    const empresaIdRaw = (formData.get("empresaId") as string) || ""
    const empresaIdFromClient = empresaIdRaw ? Number(empresaIdRaw) : null
    const empresaId =
      empresaIdFromClient && !Number.isNaN(empresaIdFromClient)
        ? empresaIdFromClient
        : await getCurrentEmpresaIdForInsert()

    const supabaseAdmin = await getSupabaseAdmin()
    const folderKey = (cedula.trim() || nombre.trim()).replace(/[^\w.\-]+/g, "_")

    // Sube un archivo y devuelve { url, nombre } o null si no hay archivo.
    const subir = async (file: File | null, tipo: string) => {
      if (!file) return { url: null as string | null, nombre: null as string | null }
      const safeName = file.name.replace(/[^\w.\-]+/g, "_")
      const filePath = `antecedentes/${empresaId}/${folderKey}/${tipo}-${Date.now()}-${safeName}`
      const { error: uploadError } = await supabaseAdmin.storage.from("archivos").upload(filePath, file)
      if (uploadError) {
        throw new Error(`No se pudo subir el certificado de ${tipo}: ${uploadError.message}`)
      }
      const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
      return { url: urlData.publicUrl, nombre: file.name }
    }

    const pol = await subir(policia, "policia")
    const proc = await subir(procuraduria, "procuraduria")
    const cont = await subir(contraloria, "contraloria")

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("antecedentes")
      .insert({
        idempresa: empresaId,
        hoja_vida_id: hojaVidaId || null,
        cedula: cedula.trim() || null,
        nombre: nombre.trim(),
        policia_url: pol.url,
        policia_nombre: pol.nombre,
        procuraduria_url: proc.url,
        procuraduria_nombre: proc.nombre,
        contraloria_url: cont.url,
        contraloria_nombre: cont.nombre,
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Error guardando metadatos de antecedentes:", error)
      return NextResponse.json({ error: "Error al guardar los antecedentes" }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    console.error("[v0] Error en POST /api/antecedentes/upload:", error)
    return NextResponse.json(
      { error: error?.message || "Error al cargar los antecedentes" },
      { status: 500 },
    )
  }
}
