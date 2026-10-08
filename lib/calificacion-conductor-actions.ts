"use server"

// Calificación del servicio por el CONDUCTOR (en caliente, al fin de cargue).
// Fuente de verdad: LIPgo. Las calificaciones se guardan en sig_satisfaccion
// (tipo='conductor', canal='kiosko') para que alimenten DIRECTO el indicador
// del BSC (IND-G-02) por proyecto y gerencial. La habilitación = órdenes con
// fincargue marcado (servicio finalizado).

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { SIG_CLIENTES_LIP } from "@/lib/sig-types"
import { getSlaCargueMin, esNombreSubproducto } from "@/lib/sla-acordados"
import { getUserPermissions } from "@/lib/permissions-actions"
import {
  EMOJI_A_CALIF,
  CALIFICACION_INICIO,
  slaACalifConductor,
  slaPctACalifCliente,
  type CargueCalificable,
  type AnalisisCalificacion,
} from "@/lib/calificacion-conductor"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)
// Minutos desde "HH:mm:ss" (mismo patrón que sig-actions).
const aMin = (s: string) => {
  const [h, m, sec] = String(s).split(":").map(Number)
  return h * 60 + m + (sec || 0) / 60
}

// Supabase limita a 1000 filas por respuesta (aunque se pida más): para leer
// tablas grandes se pagina con .range hasta agotar. `makeQuery(from,to)` debe
// construir la consulta con .order estable + .range(from,to).
async function fetchAllRows(makeQuery: (from: number, to: number) => any): Promise<any[]> {
  const PAGE = 1000
  let offset = 0
  const all: any[] = []
  for (;;) {
    const { data, error } = await makeQuery(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }
  return all
}
const satDe = (cals: number[]) =>
  cals.length ? Math.round((cals.reduce((a, b) => a + b, 0) / cals.length / 5) * 1000) / 10 : 0

export async function getAnalisisCalificacionConductor(
  empresaId?: number | null,
  desde?: string | null,
  hasta?: string | null,
): Promise<{ success: boolean; data?: AnalisisCalificacion; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = empresaId ? [empresaId] : SIG_CLIENTES_LIP
    const nombres: Record<number, string> = {}
    {
      const { data: emps } = await supabase.from("empresas").select("id,nombre").in("id", clientes)
      for (const e of emps ?? []) nombres[e.id] = e.nombre
    }

    // Cargues finalizados (fincargue marcado) = habilitados para calificar.
    // Paginado: Supabase topa en 1000 filas por respuesta.
    const cargues = await fetchAllRows((f, t) => {
      let q = supabase
        .from("cabeceraoc")
        .select("idempresa,ordendecargue,fechaorden,conductor,placa,fincargue")
        .in("idempresa", clientes)
        .not("fincargue", "is", null)
        .order("ordendecargue", { ascending: true })
        .range(f, t)
      if (desde) q = q.gte("fechaorden", desde)
      if (hasta) q = q.lte("fechaorden", hasta)
      return q
    })

    // Datos del conductor: vienen del registro del vehículo (citasvehiculos),
    // vinculados a la orden por `ocargue`. Fuente de verdad del conductor/placa.
    const citas = await fetchAllRows((f, t) =>
      supabase
        .from("citasvehiculos")
        .select("ocargue,nombreconductor,placa")
        .in("idempresa", clientes)
        .order("id", { ascending: true })
        .range(f, t),
    )
    const citaPorOc: Record<string, { conductor?: string | null; placa?: string | null }> = {}
    for (const c of citas) if (c.ocargue) citaPorOc[String(c.ocargue)] = { conductor: c.nombreconductor, placa: c.placa }

    // Calificaciones ya registradas (por orden) — paginado.
    const califs = await fetchAllRows((f, t) =>
      supabase
        .from("sig_satisfaccion")
        .select("ref_orden,calificacion")
        .eq("tipo", "conductor")
        .not("ref_orden", "is", null)
        .in("proyecto_id", clientes)
        .order("id", { ascending: true })
        .range(f, t),
    )
    const calPorOrden: Record<string, number> = {}
    for (const c of califs) if (c.ref_orden) calPorOrden[String(c.ref_orden)] = Number(c.calificacion) || 0

    const filas: CargueCalificable[] = cargues.map((r: any) => {
      const cita = citaPorOc[String(r.ordendecargue)] || {}
      return {
        ref_orden: String(r.ordendecargue),
        proyecto_id: r.idempresa,
        proyecto: nombres[r.idempresa] || `Empresa ${r.idempresa}`,
        conductor: r.conductor || cita.conductor || null,
        placa: r.placa || cita.placa || null,
        fecha: r.fechaorden,
        calificacion: calPorOrden[String(r.ordendecargue)] ?? null,
        // Anterior al corte → historial: no se califica en línea (badge "Histórico").
        historico: String(r.fechaorden || "") < CALIFICACION_INICIO,
      }
    })

    const calificadas = filas.filter((f) => f.calificacion != null)
    const cals = calificadas.map((f) => f.calificacion as number)
    const feliz = cals.filter((c) => c >= 4).length
    const regular = cals.filter((c) => c === 3).length
    const mala = cals.filter((c) => c <= 2).length

    // Por proyecto (cuando se ven todos).
    const proyMap: Record<number, { cals: number[]; fin: number }> = {}
    for (const f of filas) {
      proyMap[f.proyecto_id] = proyMap[f.proyecto_id] || { cals: [], fin: 0 }
      proyMap[f.proyecto_id].fin++
      if (f.calificacion != null) proyMap[f.proyecto_id].cals.push(f.calificacion)
    }
    const porProyecto = Object.entries(proyMap)
      .map(([id, v]) => ({
        proyecto: nombres[Number(id)] || `Empresa ${id}`,
        satisfaccion: satDe(v.cals),
        calificados: v.cals.length,
        cobertura: pct(v.cals.length, v.fin),
      }))
      .sort((a, b) => b.satisfaccion - a.satisfaccion)

    // Por mes (de las calificadas).
    const mesMap: Record<string, number[]> = {}
    for (const f of calificadas) {
      const k = String(f.fecha || "").slice(0, 7)
      if (!k) continue
      mesMap[k] = mesMap[k] || []
      mesMap[k].push(f.calificacion as number)
    }
    const porMes = Object.entries(mesMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([mes, v]) => ({ mes, satisfaccion: satDe(v), n: v.length }))

    const pendientes = filas
      .filter((f) => f.calificacion == null)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      .slice(0, 300)

    return {
      success: true,
      data: {
        resumen: {
          finalizados: filas.length,
          calificados: calificadas.length,
          pendientes: filas.length - calificadas.length,
          cobertura: pct(calificadas.length, filas.length),
          satisfaccion: satDe(cals),
          feliz,
          regular,
          mala,
        },
        pendientes,
        porProyecto,
        porMes,
        verTodos: !empresaId,
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function registrarCalificacionConductor(input: {
  proyectoId: number
  refOrden: string
  placa?: string | null
  conductor?: string | null
  emoji: "feliz" | "regular" | "mala"
  comentario?: string | null
}): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Calificación del Conductor"], "crear", "Calificar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    if (!input.proyectoId) return { success: false, error: "Falta el proyecto" }
    if (!input.refOrden) return { success: false, error: "Falta la orden de cargue" }
    const supabase: any = await getSupabaseAdmin()

    // Corte: la calificación en línea solo aplica del 15-jul-2026 en adelante.
    // Las órdenes anteriores son historial (se pueblan por SLA, no en vivo).
    const { data: ord } = await supabase
      .from("cabeceraoc")
      .select("fechaorden")
      .eq("ordendecargue", input.refOrden)
      .maybeSingle()
    if (ord?.fechaorden && String(ord.fechaorden) < CALIFICACION_INICIO) {
      return { success: false, error: "Orden histórica: no se califica en línea (usar histórico automático por SLA)." }
    }

    const hoy = new Date().toISOString().slice(0, 10)
    const fila = {
      proyecto_id: input.proyectoId,
      tipo: "conductor",
      fecha: hoy,
      encuestado: input.conductor || input.placa || "Conductor",
      placa: input.placa || null,
      ref_orden: input.refOrden,
      calificacion: EMOJI_A_CALIF[input.emoji],
      recomendaria: input.emoji === "feliz",
      comentario: input.comentario || null,
      canal: "kiosko",
      activo: true,
    }
    // Una calificación por orden (puede recalificarse). Upsert MANUAL por
    // ref_orden: el índice único es PARCIAL, así que ON CONFLICT no aplica.
    const { data: existente } = await supabase
      .from("sig_satisfaccion")
      .select("id")
      .eq("ref_orden", input.refOrden)
      .maybeSingle()
    const { error } = existente?.id
      ? await supabase.from("sig_satisfaccion").update(fila).eq("id", existente.id)
      : await supabase.from("sig_satisfaccion").insert(fila)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// HISTÓRICO AUTOMÁTICO (solo admin · reversible)
// Puebla sig_satisfaccion para el periodo ANTERIOR al corte (CALIFICACION_INICIO)
// a partir de datos reales de SLA, para tener información/tendencia desde ya:
//   · Conductor: una calificación por orden finalizada, según su SLA de tiempos.
//   · Cliente: una calificación por (cliente, mes), según el % de SLA del mes.
// Todo lo generado se marca canal='historico' → identificable y borrable.
// ---------------------------------------------------------------------------
export async function generarHistoricoCalificaciones(opts?: {
  empresaId?: number | null
  tipos?: ("conductor" | "cliente")[]
}): Promise<{
  success: boolean
  error?: string
  conductor?: { creadas: number; omitidas: number }
  cliente?: { creadas: number }
}> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Calificación del Conductor"], "configurar", "Generar histórico")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const perms = await getUserPermissions()
    if (!perms?.gestion_usuarios) return { success: false, error: "Solo un administrador puede generar el histórico." }

    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = opts?.empresaId ? [opts.empresaId] : SIG_CLIENTES_LIP
    const tipos = opts?.tipos ?? ["conductor", "cliente"]

    // Tipo de vehículo + datos de conductor por orden (citasvehiculos.ocargue).
    const citas = await fetchAllRows((f, t) =>
      supabase
        .from("citasvehiculos")
        .select("ocargue,tipovehiculo,nombreconductor,placa")
        .in("idempresa", clientes)
        .order("id", { ascending: true })
        .range(f, t),
    )
    const tipoPorOc: Record<string, string> = {}
    const citaPorOc: Record<string, { conductor?: string | null; placa?: string | null }> = {}
    for (const c of citas) {
      if (!c.ocargue) continue
      tipoPorOc[String(c.ocargue)] = c.tipovehiculo
      citaPorOc[String(c.ocargue)] = { conductor: c.nombreconductor, placa: c.placa }
    }

    // Órdenes finalizadas ANTERIORES al corte (paginado: pueden ser miles).
    const rows = await fetchAllRows((f, t) =>
      supabase
        .from("cabeceraoc")
        .select("idempresa,ordendecargue,fechaorden,conductor,placa,iniciocargue,fincargue")
        .in("idempresa", clientes)
        .not("fincargue", "is", null)
        .lt("fechaorden", CALIFICACION_INICIO)
        .order("ordendecargue", { ascending: true })
        .range(f, t),
    )

    // Subproducto (mogolla/salvado/harina de tercera): mismo criterio que
    // Centro de Coordinación/BSC — sin esto, esas órdenes se median contra
    // el tiempo (más corto) de Producto Terminado.
    const ordenesSlaCodigos = Array.from(new Set(rows.map((r: any) => String(r.ordendecargue))))
    const esSubproductoPorOc = new Set<string>()
    for (let i = 0; i < ordenesSlaCodigos.length; i += 500) {
      const chunk = ordenesSlaCodigos.slice(i, i + 500)
      const detChunk = await fetchAllRows((f, t) =>
        supabase.from("detalleoc").select("numeroorden, producto").in("numeroorden", chunk).order("id").range(f, t),
      )
      for (const d of detChunk) if (esNombreSubproducto(d.producto)) esSubproductoPorOc.add(String(d.numeroorden))
    }
    const productoDeOrden = (ref: string) => (esSubproductoPorOc.has(ref) ? "SUB" : "PT")

    const conductor = { creadas: 0, omitidas: 0 }
    const cliente = { creadas: 0 }

    // ---- Conductor: una fila por orden con SLA calculable ----
    if (tipos.includes("conductor")) {
      const ex = await fetchAllRows((f, t) =>
        supabase
          .from("sig_satisfaccion")
          .select("ref_orden")
          .eq("tipo", "conductor")
          .not("ref_orden", "is", null)
          .in("proyecto_id", clientes)
          .order("id", { ascending: true })
          .range(f, t),
      )
      const yaCal = new Set(ex.map((r: any) => String(r.ref_orden)))
      const nuevas: any[] = []
      for (const r of rows) {
        const ref = String(r.ordendecargue)
        if (yaCal.has(ref)) continue // nunca pisa una calificación existente
        if (!r.iniciocargue || !r.fincargue) { conductor.omitidas++; continue }
        const max = getSlaCargueMin(tipoPorOc[ref], productoDeOrden(ref), r.idempresa)
        if (!max) { conductor.omitidas++; continue } // sin SLA calculable → no se infla
        const real = aMin(r.fincargue) - aMin(r.iniciocargue)
        if (real <= 0 || real > 600) { conductor.omitidas++; continue }
        const cal = slaACalifConductor(real, max)
        const cita = citaPorOc[ref] || {}
        nuevas.push({
          proyecto_id: r.idempresa,
          tipo: "conductor",
          fecha: r.fechaorden,
          periodo: String(r.fechaorden || "").slice(0, 7),
          encuestado: r.conductor || cita.conductor || r.placa || cita.placa || "Conductor",
          placa: r.placa || cita.placa || null,
          ref_orden: ref,
          calificacion: cal,
          recomendaria: cal >= 4,
          comentario: null,
          canal: "historico",
          responsable: "sistema (SLA)",
          activo: true,
        })
        yaCal.add(ref)
      }
      for (let i = 0; i < nuevas.length; i += 500) {
        const chunk = nuevas.slice(i, i + 500)
        const { error } = await supabase.from("sig_satisfaccion").insert(chunk)
        if (error) return { success: false, error: error.message }
        conductor.creadas += chunk.length
      }
    }

    // ---- Cliente: una fila por (cliente, mes) según el % de SLA del mes ----
    if (tipos.includes("cliente")) {
      const mesMap: Record<string, { ok: number; n: number; emp: number; mes: string }> = {}
      for (const r of rows) {
        if (!r.iniciocargue || !r.fincargue) continue
        const max = getSlaCargueMin(tipoPorOc[String(r.ordendecargue)], productoDeOrden(String(r.ordendecargue)), r.idempresa)
        if (!max) continue
        const real = aMin(r.fincargue) - aMin(r.iniciocargue)
        if (real <= 0 || real > 600) continue
        const mes = String(r.fechaorden || "").slice(0, 7)
        if (!mes) continue
        const key = `${r.idempresa}|${mes}`
        mesMap[key] = mesMap[key] || { ok: 0, n: 0, emp: r.idempresa, mes }
        mesMap[key].n++
        if (real <= max) mesMap[key].ok++
      }
      const exC = await fetchAllRows((f, t) =>
        supabase
          .from("sig_satisfaccion")
          .select("proyecto_id,periodo")
          .eq("tipo", "cliente")
          .eq("canal", "historico")
          .in("proyecto_id", clientes)
          .order("id", { ascending: true })
          .range(f, t),
      )
      const yaCli = new Set(exC.map((r: any) => `${r.proyecto_id}|${r.periodo}`))
      // Último día del mes; julio se recorta al día previo al corte (1–14).
      const finDeMes = (mes: string) => {
        if (mes === CALIFICACION_INICIO.slice(0, 7)) return "2026-07-14"
        const [y, m] = mes.split("-").map(Number)
        return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
      }
      const nuevasC: any[] = []
      for (const k of Object.keys(mesMap)) {
        const v = mesMap[k]
        if (yaCli.has(`${v.emp}|${v.mes}`)) continue
        const slaPct = v.n ? (v.ok / v.n) * 100 : 0
        nuevasC.push({
          proyecto_id: v.emp,
          tipo: "cliente",
          fecha: finDeMes(v.mes),
          periodo: v.mes,
          encuestado: "Cliente (proxy SLA)",
          calificacion: slaPctACalifCliente(slaPct),
          recomendaria: slaPct >= 90,
          comentario: `Derivado del ${Math.round(slaPct * 10) / 10}% de cumplimiento de SLA del mes`,
          canal: "historico",
          responsable: "sistema (SLA)",
          activo: true,
        })
      }
      for (let i = 0; i < nuevasC.length; i += 500) {
        const chunk = nuevasC.slice(i, i + 500)
        const { error } = await supabase.from("sig_satisfaccion").insert(chunk)
        if (error) return { success: false, error: error.message }
        cliente.creadas += chunk.length
      }
    }

    return { success: true, conductor, cliente }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// Borra SOLO lo generado automáticamente (canal='historico'); permite regenerar.
export async function limpiarHistoricoCalificaciones(opts?: {
  empresaId?: number | null
  tipos?: ("conductor" | "cliente")[]
}): Promise<{ success: boolean; error?: string; borradas?: number }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Calificación del Conductor"], "configurar", "Limpiar histórico")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    const perms = await getUserPermissions()
    if (!perms?.gestion_usuarios) return { success: false, error: "Solo un administrador puede limpiar el histórico." }

    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = opts?.empresaId ? [opts.empresaId] : SIG_CLIENTES_LIP
    const tipos = opts?.tipos ?? ["conductor", "cliente"]
    const { error, count } = await supabase
      .from("sig_satisfaccion")
      .delete({ count: "exact" })
      .eq("canal", "historico")
      .in("proyecto_id", clientes)
      .in("tipo", tipos)
    if (error) return { success: false, error: error.message }
    return { success: true, borradas: count || 0 }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}
