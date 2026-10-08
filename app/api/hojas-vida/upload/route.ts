import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { exigirSesionApi } from "@/lib/puerta-api"

// Sube una hoja de vida a Supabase Storage (bucket "archivos", mismo que usan
// los documentos de headcount) y guarda sus metadatos en Supabase.
export async function POST(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const nombreCandidato = (formData.get("nombre_candidato") as string) || ""
    const cedula = (formData.get("cedula") as string) || ""
    const cargoAspirado = (formData.get("cargo_aspirado") as string) || ""
    const correo = (formData.get("correo") as string) || ""
    const telefono = (formData.get("telefono") as string) || ""
    const notas = (formData.get("notas") as string) || ""

    if (!file) {
      return NextResponse.json({ error: "No se adjunto ningun archivo" }, { status: 400 })
    }
    if (!nombreCandidato.trim()) {
      return NextResponse.json({ error: "El nombre del candidato es obligatorio" }, { status: 400 })
    }

    // Empresa seleccionada dinamicamente desde la parte superior (si viene);
    // si no, usamos la empresa de sesion como respaldo.
    const empresaIdRaw = (formData.get("empresaId") as string) || ""
    const empresaIdFromClient = empresaIdRaw ? Number(empresaIdRaw) : null
    const empresaId =
      empresaIdFromClient && !Number.isNaN(empresaIdFromClient)
        ? empresaIdFromClient
        : await getCurrentEmpresaIdForInsert()

    // Ruta unica dentro del bucket: hojas-vida/<empresa>/<timestamp>-<archivo>
    const safeName = file.name.replace(/[^\w.\-]+/g, "_")
    const filePath = `hojas-vida/${empresaId}/${Date.now()}-${safeName}`

    const supabaseAdmin = await getSupabaseAdmin()
    const { error: uploadError } = await supabaseAdmin.storage.from("archivos").upload(filePath, file)
    if (uploadError) {
      console.error("[v0] Error subiendo hoja de vida a Storage:", uploadError)
      return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
    const archivoUrl = urlData.publicUrl

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("hojas_de_vida")
      .insert({
        idempresa: empresaId,
        nombre_candidato: nombreCandidato.trim(),
        cedula: cedula.trim() || null,
        cargo_aspirado: cargoAspirado.trim() || null,
        correo: correo.trim() || null,
        telefono: telefono.trim() || null,
        notas: notas.trim() || null,
        archivo_url: archivoUrl,
        archivo_nombre: file.name,
        archivo_tipo: file.type || null,
        archivo_tamano: file.size || null,
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Error guardando metadatos de hoja de vida:", error)
      return NextResponse.json({ error: "Error al guardar la hoja de vida" }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error en POST /api/hojas-vida/upload:", error)
    return NextResponse.json({ error: "Error al cargar la hoja de vida" }, { status: 500 })
  }
}
