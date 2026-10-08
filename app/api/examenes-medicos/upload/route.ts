import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { registrarConceptoExamen } from "@/lib/examenes-medicos-actions"
import { normalizarAptitud } from "@/lib/examenes-utils"
import { leerConceptoAptitud } from "@/lib/examenes-ocr"
import { exigirAccionApi } from "@/lib/puerta-api"

// Sube el documento del examen medico de un empleado APTO (de la entrevista)
// a Supabase Storage (bucket "archivos") y guarda sus metadatos.
export async function POST(request: NextRequest) {
  const puerta = await exigirAccionApi(["Examenes Médicos"], "editar")
  if (puerta) return puerta
  try {
    const formData = await request.formData()

    const entrevistaId = (formData.get("entrevista_id") as string) || ""
    const hojaVidaId = (formData.get("hoja_vida_id") as string) || ""
    const cedula = (formData.get("cedula") as string) || ""
    const nombre = (formData.get("nombre") as string) || ""
    const tipoExamen = (formData.get("tipo_examen") as string) || ""
    const resultado = (formData.get("resultado") as string) || ""
    const fechaExamen = (formData.get("fecha_examen") as string) || ""
    const observaciones = (formData.get("observaciones") as string) || ""
    const costoRaw = (formData.get("costo") as string) || ""
    const costo = costoRaw ? Number(costoRaw) || 0 : 0

    if (!nombre.trim()) {
      return NextResponse.json({ error: "Debe seleccionar un empleado" }, { status: 400 })
    }

    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "Adjunte el documento del examen médico" }, { status: 400 })
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
    const safeName = file.name.replace(/[^\w.\-]+/g, "_")
    const filePath = `examenes-medicos/${empresaId}/${folderKey}/${Date.now()}-${safeName}`

    const { error: uploadError } = await supabaseAdmin.storage.from("archivos").upload(filePath, file)
    if (uploadError) {
      console.error("[v0] Error subiendo examen medico a Storage:", uploadError)
      return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)

    // LECTURA AUTOMÁTICA DEL CONCEPTO: siempre se lee el documento para clasificar
    // apto/no apto por su "Concepto de aptitud". El resultado manual (si vino) es solo
    // respaldo cuando no se logra leer el concepto.
    let apto: boolean | null = normalizarAptitud(resultado)
    let resultadoFinal = resultado.trim()
    let obsFinal = observaciones.trim()
    try {
      const mt = (file.type || "").toLowerCase() || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "")
      const b64 = Buffer.from(await file.arrayBuffer()).toString("base64")
      const { concepto, apto: aptoDoc } = await leerConceptoAptitud(b64, mt || "application/pdf")
      if (concepto) {
        resultadoFinal = concepto // el concepto leído manda sobre el texto manual
        if (aptoDoc !== null) apto = aptoDoc
        obsFinal = obsFinal
          ? `${obsFinal} · Concepto leído automáticamente: "${concepto}"`
          : `Concepto leído automáticamente: "${concepto}"`
      }
    } catch { /* si falla la lectura, se usa el resultado manual */ }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("examenes_medicos")
      .insert({
        idempresa: empresaId,
        entrevista_id: entrevistaId || null,
        hoja_vida_id: hojaVidaId || null,
        cedula: cedula.trim() || null,
        nombre: nombre.trim(),
        tipo_examen: tipoExamen.trim() || null,
        resultado: resultadoFinal || null,
        fecha_examen: fechaExamen || null,
        observaciones: obsFinal || null,
        archivo_url: urlData.publicUrl,
        archivo_nombre: file.name,
        apto,
        costo,
        fuente: "candidato",
        vigente: true,
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Error guardando metadatos de examen medico:", error)
      return NextResponse.json({ error: "Error al guardar el examen médico" }, { status: 500 })
    }

    // Si ya viene dictaminado (apto/no apto), disparar los efectos: retroalimentar
    // la hoja de vida y, si es APTO, promover el expediente a Head Count.
    let promocion: any = null
    if (apto !== null && data?.id) {
      const r = await registrarConceptoExamen({ id: data.id, apto, costo, resultado: resultadoFinal })
      promocion = { apto, promovido: r.promovido, message: r.message }
    }

    return NextResponse.json({ success: true, data, promocion })
  } catch (error: any) {
    console.error("[v0] Error en POST /api/examenes-medicos/upload:", error)
    return NextResponse.json(
      { error: error?.message || "Error al cargar el examen médico" },
      { status: 500 },
    )
  }
}
