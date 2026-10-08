import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"
import { exigirSesionApi, exigirAccionApi } from "@/lib/puerta-api"

export async function GET(request: Request) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const idempresa = searchParams.get("idempresa")
    
    console.log("[v0] Citas-vehiculos API called with idempresa:", idempresa)

    const supabase = await createClient()

    // Fetch vehicle appointments with empty status filtered by company
    let query = supabase
      .from("citasvehiculos")
      .select("*")
      .is("estatus", null)
      .order("fechallegada", { ascending: false })

    if (idempresa) {
      query = query.eq("idempresa", parseInt(idempresa))
      console.log("[v0] Filtering by idempresa:", parseInt(idempresa))
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error fetching vehicle appointments:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[v0] Found vehicle appointments:", data?.length || 0)
    console.log("[v0] Vehicle appointments data:", data)

    return NextResponse.json(data || [])
  } catch (error) {
    console.error("[v0] Unexpected error in vehicle appointments API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const puerta = await exigirAccionApi(["Generar Órdenes de Descargue", "Generar Órdenes de Cargue", "Ver Vehículos"], "editar")
  if (puerta) return puerta
  try {
    const body = await request.json()
    const { id, estatus, ocargue } = body

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 })
    }

    const supabase = await createClient()

    // ocargue guarda la orden (cargue o descargue) en la que se procesó esta
    // cita -- mismo campo/patrón que ya usan assignVehicleToLoadOrder y
    // generateLoadOrder para cargue; opcional para no romper llamadas viejas
    // que solo mandan estatus.
    const update: { estatus: string; ocargue?: string } = { estatus }
    if (ocargue !== undefined) update.ocargue = ocargue

    const { data, error } = await supabase
      .from("citasvehiculos")
      .update(update)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      console.error("[v0] Error updating vehicle appointment status:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Unexpected error updating vehicle appointment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
