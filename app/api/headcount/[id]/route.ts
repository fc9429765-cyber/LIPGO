import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase-server"
import { exigirAccionApi } from "@/lib/puerta-api"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const puerta = await exigirAccionApi(["Head Count", "Gestión de Colaboradores"], "editar")
  if (puerta) return puerta
  try {
    const { id: idParam } = await params
    const body = await request.json()
    const id = Number.parseInt(idParam)

    const supabase = createServerClient()

    // Route each single-field update to its own sanitized object,
    // otherwise perform a full profile update.
    let sanitized: Record<string, unknown>

    if (Object.keys(body).length === 1 && "estado" in body) {
      sanitized = { estado: body.estado }
    } else if (Object.keys(body).length === 1 && "idempresa" in body) {
      sanitized = { idempresa: Number(body.idempresa) }
    } else {
      sanitized = {
        identificacion: body.identificacion,
        nombre: body.nombre,
        correo: body.correo || null,
        celular: body.celular || null,
        contratosiigo: body.contratosiigo || null,
        cargo: body.cargo || null,
        fechainicio: body.fechainicio || null,
        fecha_retiro: body.fecha_retiro || null,
        salario: body.salario ? Number(body.salario) : null,
        // Coercion estricta a boolean (mismo patron que el POST).
        aplicaplano: !!body.aplicaplano,
        admin: !!body.admin,
        // Seguridad Social (PILA) -- ver scripts/170_add_pila_fields_headcount.sql.
        ciudad: body.ciudad || null,
        administradora_pension: body.administradora_pension || null,
        administradora_salud: body.administradora_salud || null,
        administradora_caja: body.administradora_caja || null,
        tipo_cotizante: body.tipo_cotizante || null,
        subtipo_cotizante: body.subtipo_cotizante || null,
        centro_trabajo: body.centro_trabajo || null,
        actividad_economica: body.actividad_economica || null,
      }
    }

    const { data, error } = await supabase.from("headcount").update(sanitized).eq("id", id).select().single()

    if (error) {
      console.error("[v0] Error updating headcount person:", error)
      return NextResponse.json({ error: "Error al actualizar el registro de personal", detail: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in PATCH /api/headcount/[id]:", error)
    return NextResponse.json({ error: "Error al actualizar el registro de personal" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const puerta = await exigirAccionApi(["Head Count", "Gestión de Colaboradores"], "eliminar")
  if (puerta) return puerta
  try {
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    console.log("[v0] Deleting headcount person:", id)

    const supabase = createServerClient()

    const { error } = await supabase.from("headcount").delete().eq("id", id)

    if (error) {
      console.error("[v0] Error deleting headcount person:", error)
      return NextResponse.json({ error: "Error al eliminar el registro de personal" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in DELETE /api/headcount/[id]:", error)
    return NextResponse.json({ error: "Error al eliminar el registro de personal" }, { status: 500 })
  }
}
