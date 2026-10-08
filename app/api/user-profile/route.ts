import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { exigirSesionApi } from "@/lib/puerta-api"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId")

    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 })
    }

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, usuario, empresa_id")
      .eq("id", userId)
      .single()

    if (profileError || !profiles) {
      console.error("[v0 API] Profile error:", profileError)
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresas")
      .select("id, nombre")
      .eq("id", profiles.empresa_id)
      .single()

    if (empresaError || !empresa) {
      console.error("[v0 API] Empresa error:", empresaError)
      return NextResponse.json({ error: "Empresa not found" }, { status: 404 })
    }

    return NextResponse.json({
      id: profiles.id,
      usuario: profiles.usuario,
      empresa_id: profiles.empresa_id,
      empresa_nombre: empresa.nombre,
    })
  } catch (error) {
    console.error("[v0 API] Error in user-profile route:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
