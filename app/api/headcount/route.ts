import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase-server"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { exigirAccionApi } from "@/lib/puerta-api"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const selectedEmpresaId = searchParams.get("empresaId")
    const adminOnly = searchParams.get("admin") === "true"

    const supabase = createServerClient()

    const empresaId = selectedEmpresaId
      ? parseInt(selectedEmpresaId, 10)
      : await getCurrentEmpresaIdForInsert()

    let query = supabase.from("headcount").select("*").order("id", { ascending: false })

    if (adminOnly) {
      // El administrativo tambien pertenece a un proyecto.
      //
      // Antes se listaban TODOS los `admin=true` sin filtrar por empresa, pero
      // el alta ya guardaba `idempresa` (ver el POST de abajo): la persona
      // quedaba amarrada a un proyecto y aun asi aparecia en todos. Ahora se
      // filtra igual que el operativo.
      //
      // Se incluyen ademas los que tengan `idempresa` en NULL --la columna lo
      // permite y hay registros viejos asi--. Si se omitieran, esa gente
      // desapareceria de todas las pestañas sin que nadie se entere; asi
      // aparecen en todos los proyectos, marcados como "sin proyecto", hasta
      // que alguien los traslade.
      query = query.eq("admin", true).or(`idempresa.eq.${empresaId},idempresa.is.null`)
    } else {
      // Operativo = del proyecto y NO administrativo.
      //
      // El `not("admin", "is", true)` hace falta explicitamente: `admin` es
      // nullable y en Postgres `admin <> true` descarta los NULL, que son la
      // mayoria de los operativos --nadie les puso la bandera en false--. Con
      // `not is true` entran los false Y los null, que es lo correcto.
      //
      // Antes esto no hacia falta porque los administrativos vivian en su
      // propia lista sin filtro de empresa; al amarrarlos al proyecto pasaron
      // a cumplir tambien la condicion de esta rama y salian en las dos.
      query = query.eq("idempresa", empresaId).not("admin", "is", true)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching headcount:", error)
      return NextResponse.json({ error: "Error al obtener la lista de personal" }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in GET /api/headcount:", error)
    return NextResponse.json({ error: "Error al obtener la lista de personal" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const puerta = await exigirAccionApi(["Head Count", "Gestión de Colaboradores"], "crear")
  if (puerta) return puerta
  try {
    const body = await request.json()

    const supabase = createServerClient()
    const empresaId = body.empresaId ? parseInt(body.empresaId, 10) : await getCurrentEmpresaIdForInsert()

    const { data, error } = await supabase
      .from("headcount")
      .insert({
        identificacion: body.identificacion,
        nombre: body.nombre,
        correo: body.correo || null,
        celular: body.celular || null,
        contratosiigo: body.contratosiigo || null,
        cargo: body.cargo || null,
        fechainicio: body.fechainicio || null,
        fecha_retiro: body.fecha_retiro || null,
        salario: body.salario ? Number(body.salario) : null,
        // Coercion estricta: `!!body.aplicaplano` garantiza boolean true/false
        // aunque el cliente envie undefined / null / "true" / 0, etc.
        aplicaplano: !!body.aplicaplano,
        // Personal administrativo. En la pestaña de administrativos siempre
        // llega true; en la pestaña normal queda false.
        admin: !!body.admin,
        idempresa: empresaId,
        estado: "Inactivo",
        // Seguridad Social (PILA) -- ver scripts/170_add_pila_fields_headcount.sql.
        ciudad: body.ciudad || null,
        administradora_pension: body.administradora_pension || null,
        administradora_salud: body.administradora_salud || null,
        administradora_caja: body.administradora_caja || null,
        tipo_cotizante: body.tipo_cotizante || null,
        subtipo_cotizante: body.subtipo_cotizante || null,
        centro_trabajo: body.centro_trabajo || null,
        actividad_economica: body.actividad_economica || null,
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Error creating headcount person:", error)
      return NextResponse.json({ error: "Error al crear el registro de personal", detail: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in POST /api/headcount:", error)
    return NextResponse.json({ error: "Error al crear el registro de personal" }, { status: 500 })
  }
}
