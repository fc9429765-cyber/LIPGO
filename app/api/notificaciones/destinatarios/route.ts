import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { normalizarCelularCO } from "@/lib/whatsapp"
import { exigirSesionApi } from "@/lib/puerta-api"

// La programacion cambia durante el dia; no cachear.
export const dynamic = "force-dynamic"
export const revalidate = 0

// Un destinatario listo para enviar: persona + celular + (opcional) el
// puesto/turno del dia si se pidio modo "turno".
export interface Destinatario {
  documento: string
  nombre: string
  cargo: string | null
  celular: string | null
  celularValido: boolean
  // Solo en modo turno:
  puesto?: string | null
  fecha?: string | null
  // Horario programado del turno (de Programación de Turnos → registroasistencia).
  horaEntrada?: string | null
  horaSalida?: string | null
  horario?: string | null
  // Solo en modo conductor:
  placa?: string | null
  // De donde salio el celular: 'headcount' (fuente principal) o
  // 'hoja_vida' (respaldo por nombre desde hojas_de_vida).
  fuenteCelular?: "headcount" | "hoja_vida"
}

// Normaliza un nombre para comparar: minusculas, sin acentos, espacios
// colapsados. Sirve para cruzar personal (headcount) con el banco de
// hojas de vida cuando falta el celular.
function normNombre(n: string | null | undefined): string {
  return String(n ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * GET /api/notificaciones/destinatarios?empresaId=1&tipo=alerta
 * GET /api/notificaciones/destinatarios?empresaId=1&tipo=turno&fecha=2026-07-04
 *
 *  - tipo=alerta (default): todo el personal ACTIVO de la empresa desde
 *    `headcount` (el roster real con celular).
 *  - tipo=turno: solo los que tienen PUESTO asignado para `fecha` en
 *    registroasistencia (la programacion de turnos), cruzados por cedula
 *    con `headcount` para traer el celular.
 *  - tipo=conductor: conductores que registraron su vehiculo (citasvehiculos)
 *    en la fecha dada. Su celular es `telefono`; se identifican por placa.
 *
 * NOTA: la fuente del celular del personal es `headcount` (no
 * colaboradores_th, que es el onboarding de GH y esta casi vacio).
 * `headcount.estado` usa 'Activo'/'Inactivo' (con mayuscula).
 */
export async function GET(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const { searchParams } = new URL(request.url)
    const empresaId = searchParams.get("empresaId")
    const tipo = searchParams.get("tipo") || "alerta"
    const fecha = searchParams.get("fecha")

    if (!empresaId) {
      return NextResponse.json({ error: "empresaId es requerido" }, { status: 400 })
    }

    const supabase = await getSupabaseAdmin()

    // Fecha objetivo (Bogota) reutilizada por turno y conductor.
    const filterDate =
      fecha ||
      new Date()
        .toLocaleString("en-CA", {
          timeZone: "America/Bogota",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })

    // ---- MODO CONDUCTOR: conductores de citasvehiculos ----
    // Los conductores dejan sus datos (nombre, telefono, placa) al
    // registrar el vehiculo. Traemos los del dia `filterDate` (por
    // `fechallegada`) y deduplicamos por placa+telefono.
    if (tipo === "conductor") {
      const desde = filterDate + "T00:00:00"
      const hasta = filterDate + "T23:59:59"
      const { data: citas, error: errCitas } = await supabase
        .from("citasvehiculos")
        .select("placa, nombreconductor, telefono, fechallegada, idempresa")
        .eq("idempresa", Number(empresaId))
        .gte("fechallegada", desde)
        .lte("fechallegada", hasta)
        .order("fechallegada", { ascending: false })

      if (errCitas) {
        console.error("[notificaciones] error citasvehiculos:", errCitas)
        return NextResponse.json({ error: "Error al cargar los conductores" }, { status: 500 })
      }

      // Deduplicar: un conductor puede registrar varios vehiculos el
      // mismo dia; clave placa+telefono para no enviar repetido.
      const vistos = new Set<string>()
      const destinatarios: Destinatario[] = []
      for (const c of citas ?? []) {
        const tel = c.telefono ? String(c.telefono).trim() : ""
        const placa = c.placa ? String(c.placa).trim() : ""
        const clave = placa + "|" + tel
        if (vistos.has(clave)) continue
        vistos.add(clave)
        const celNorm = normalizarCelularCO(tel)
        destinatarios.push({
          documento: placa || clave, // identificador estable del destinatario
          nombre: String(c.nombreconductor ?? "").trim() || "(sin nombre)",
          cargo: "Conductor",
          celular: tel || null,
          celularValido: celNorm !== null,
          placa: placa || null,
          fecha: filterDate,
        })
      }
      destinatarios.sort((a, b) => a.nombre.localeCompare(b.nombre))
      return NextResponse.json({ destinatarios, fecha: filterDate })
    }

    // Base: personal ACTIVO de la empresa desde headcount (roster real
    // con celular). estado usa 'Activo' con mayuscula.
    const { data: personal, error: errPersonal } = await supabase
      .from("headcount")
      .select("identificacion, nombre, cargo, celular, estado, idempresa")
      .eq("idempresa", Number(empresaId))
      .eq("estado", "Activo")

    if (errPersonal) {
      console.error("[notificaciones] error headcount:", errPersonal)
      return NextResponse.json({ error: "Error al cargar el personal" }, { status: 500 })
    }

    // Mapa cedula -> persona para el cruce con turnos.
    const porDoc = new Map<string, Record<string, any>>()
    for (const p of personal ?? []) {
      if (p.identificacion) porDoc.set(String(p.identificacion).trim(), p)
    }

    // ---- RESPALDO por hojas_de_vida ----
    // Cuando headcount no tiene celular valido, intentamos rescatarlo del
    // banco de hojas de vida (misma empresa) cruzando por NOMBRE. Solo se
    // usa si la coincidencia es UNICA (un unico candidato con ese nombre
    // y un unico telefono valido); si el nombre es ambiguo, NO se adivina.
    const { data: hojas } = await supabase
      .from("hojas_de_vida")
      .select("nombre_candidato, telefono, idempresa")
      .eq("idempresa", Number(empresaId))

    // nombre normalizado -> conjunto de telefonos validos distintos.
    const telsPorNombre = new Map<string, Set<string>>()
    for (const h of hojas ?? []) {
      const tel = normalizarCelularCO(h.telefono)
      if (!tel) continue
      const key = normNombre(h.nombre_candidato)
      if (!key) continue
      if (!telsPorNombre.has(key)) telsPorNombre.set(key, new Set())
      telsPorNombre.get(key)!.add(tel)
    }

    // Resuelve el celular de una persona: primero headcount; si no hay
    // valido, respaldo inequivoco por hojas_de_vida.
    function resolverCelular(nombre: string | null | undefined, celHeadcount: string | null | undefined) {
      const celHc = normalizarCelularCO(celHeadcount)
      if (celHc) {
        return { celular: celHeadcount ?? null, celularValido: true, fuenteCelular: "headcount" as const }
      }
      const tels = telsPorNombre.get(normNombre(nombre))
      if (tels && tels.size === 1) {
        const unico = [...tels][0]
        return { celular: unico, celularValido: true, fuenteCelular: "hoja_vida" as const }
      }
      return { celular: celHeadcount ?? null, celularValido: false, fuenteCelular: "headcount" as const }
    }

    // ---- MODO ALERTA: todo el personal activo ----
    if (tipo !== "turno") {
      const destinatarios: Destinatario[] = (personal ?? []).map((p) => {
        const r = resolverCelular(p.nombre, p.celular)
        return {
          documento: String(p.identificacion ?? ""),
          nombre: String(p.nombre ?? "").trim(),
          cargo: p.cargo ?? null,
          celular: r.celular,
          celularValido: r.celularValido,
          fuenteCelular: r.fuenteCelular,
        }
      })
      destinatarios.sort((a, b) => a.nombre.localeCompare(b.nombre))
      return NextResponse.json({ destinatarios })
    }

    // ---- MODO TURNO: solo los programados para la fecha ----
    // El horario programado (horaentradaprogramada / horasalidaprogramada) lo escribe
    // el módulo "Programación de Turnos" en registroasistencia.
    const { data: turnos, error: errTurnos } = await supabase
      .from("registroasistencia")
      .select("identificacion, nombre, puesto, fecha, idempresa, horaentradaprogramada, horasalidaprogramada")
      .eq("idempresa", Number(empresaId))
      .eq("fecha", filterDate)
      .not("puesto", "is", null)

    if (errTurnos) {
      console.error("[notificaciones] error registroasistencia:", errTurnos)
      return NextResponse.json({ error: "Error al cargar la programacion" }, { status: 500 })
    }

    // "06:00:00" → "06:00" (quita los segundos para el mensaje).
    const hhmm = (t: any): string | null => {
      const s = String(t ?? "").trim()
      if (!s) return null
      const m = s.match(/^(\d{1,2}):(\d{2})/)
      return m ? `${m[1].padStart(2, "0")}:${m[2]}` : s
    }

    const destinatarios: Destinatario[] = (turnos ?? []).map((t) => {
      const doc = String(t.identificacion ?? "").trim()
      const persona = porDoc.get(doc)
      const nombre = persona ? String(persona.nombre ?? "").trim() : String(t.nombre ?? "")
      const r = resolverCelular(nombre, persona?.celular ?? null)
      const he = hhmm(t.horaentradaprogramada)
      const hs = hhmm(t.horasalidaprogramada)
      const horario = he && hs ? `${he} a ${hs}` : he || hs || null
      return {
        documento: doc,
        nombre,
        cargo: persona?.cargo ?? null,
        celular: r.celular,
        celularValido: r.celularValido,
        fuenteCelular: r.fuenteCelular,
        puesto: t.puesto ?? null,
        fecha: t.fecha ?? filterDate,
        horaEntrada: he,
        horaSalida: hs,
        horario,
      }
    })
    destinatarios.sort((a, b) => a.nombre.localeCompare(b.nombre))

    return NextResponse.json({ destinatarios, fecha: filterDate })
  } catch (error) {
    console.error("[notificaciones] error destinatarios:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
