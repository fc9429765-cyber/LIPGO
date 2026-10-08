"use server"

// ---------------------------------------------------------------------------
// NOVEDADES DEL PERIODO — lo que se ha reportado en la quincena, con su efecto
// real en la nómina.
//
// EL IMPACTO EN PESOS NO SE ESTIMA: se lee de `pagonomina`, que es la vista que
// liquida. Su grano es (persona, fecha), y como cada novedad ocupa exactamente
// un día de una persona, el `total_liquidado_dia` de ese día ES el efecto de esa
// novedad. Replicar la fórmula acá daría un número que podría no coincidir con
// lo que se paga, y en una pantalla de nómina eso es peor que no mostrarlo.
//
// El signo se calcula contra lo que esa persona habría ganado un día normal:
//   impacto = lo liquidado con la novedad − el valor de un día trabajado
// Así una incapacidad pagada al 100% sale en 0 (no cuesta), una licencia no
// remunerada sale en negativo (deja de pagarse el día) y un festivo trabajado
// sale en positivo.
//
// `pagonomina` es una VISTA que recalcula al consultarse: se lee SIEMPRE desde
// el servidor con service role, nunca desde el navegador (hay un timeout
// documentado, code 57014).
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { motivoSinAccion } from "@/lib/puerta-modulo"
import { procesarNovedadRetiro } from "@/lib/retiro-actions"
import { sincronizarBorradorAusentismo } from "@/lib/ausentismos-actions"
import { metaDeNovedad } from "@/lib/novedades-catalogo"
import { categoriaDeNovedad } from "@/lib/ausentismo-categorias"
import type { NovedadPeriodo, NovedadesPeriodoData } from "@/lib/novedades-periodo-tipos"

function ultimoDiaDe(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate()
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** Cédula sin puntos ni espacios, para cruzar entre tablas. */
function normCedula(v: unknown): string {
  return String(v ?? "").replace(/[^\dkK]/g, "").trim()
}

async function traerTodo(construir: (d: number, h: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let off = 0; off < 60000; off += 1000) {
    const { data, error } = await construir(off, off + 999)
    if (error) throw new Error(error.message)
    const lote = data ?? []
    out.push(...lote)
    if (lote.length < 1000) break
  }
  return out
}

export async function getNovedadesPeriodo(
  empresaId: number | null | undefined,
  anio: number,
  mes: number,
  quincena: 1 | 2,
): Promise<{ success: boolean; data?: NovedadesPeriodoData; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Novedades de personal", "Tabla Asistencia"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!empresaId) return { success: false, message: "Selecciona una empresa en el selector de arriba." }

  const p = (n: number) => String(n).padStart(2, "0")
  const diaIni = quincena === 1 ? 1 : 16
  const diaFin = quincena === 1 ? 15 : ultimoDiaDe(anio, mes)
  const desde = `${anio}-${p(mes)}-${p(diaIni)}`
  const hasta = `${anio}-${p(mes)}-${p(diaFin)}`
  const avisos: string[] = []

  try {
    const sb: any = await getSupabaseAdmin()

    // --- LAS NOVEDADES REPORTADAS ----------------------------------------
    let filas: any[] = []
    try {
      filas = await traerTodo((d, h) =>
        sb
          .from("registroasistencia")
          .select("id, fecha, nombre, identificacion, asistencia, puesto")
          .eq("idempresa", empresaId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .not("asistencia", "is", null)
          .order("fecha", { ascending: false })
          .range(d, h),
      )
      filas = filas.filter((r) => !/prueba/i.test(String(r.nombre ?? "")))
    } catch (e: any) {
      return { success: false, message: e?.message || "No se pudieron leer las novedades." }
    }

    // --- IMPACTO REAL, DESDE pagonomina -----------------------------------
    // Clave (persona|fecha). `persona` en pagonomina es el nombre, no la cédula.
    const liquidado = new Map<string, { total: number; base: number }>()
    let hayPagonomina = false
    try {
      const pn = await traerTodo((d, h) =>
        sb
          .rpc("pagonomina_rango", { p_desde: desde, p_hasta: hasta })
          .select("fecha, persona, novedad_reportada, base_dia, total_liquidado_dia")
          .eq("idempresa", empresaId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("persona")
          .order("fecha")
          .range(d, h),
      )
      hayPagonomina = true
      for (const r of pn) {
        const k = `${String(r.persona ?? "").trim().toLowerCase()}|${String(r.fecha).slice(0, 10)}`
        liquidado.set(k, {
          total: Number(r.total_liquidado_dia) || 0,
          base: Number(r.base_dia) || 0,
        })
      }
    } catch (e: any) {
      // La vista puede tardar. Se avisa y las filas salen sin impacto, en vez
      // de mostrar un estimado que la nómina no respalda.
      avisos.push("El impacto en pesos no se pudo calcular ahora: la vista de nómina tardó en responder.")
      console.error("[v0] getNovedadesPeriodo pagonomina:", e?.message ?? e)
    }

    // Valor de un día normal por persona: la mediana de lo liquidado en los
    // días SIN novedad de esa misma quincena. Se usa la mediana y no el
    // promedio porque un solo día atípico (un festivo, un domingo) desplazaría
    // la referencia y todos los impactos saldrían torcidos.
    const diasNormales = new Map<string, number[]>()
    if (hayPagonomina) {
      const conNovedad = new Set(
        filas.map((r) => `${String(r.nombre ?? "").trim().toLowerCase()}|${String(r.fecha).slice(0, 10)}`),
      )
      for (const [k, v] of liquidado) {
        if (conNovedad.has(k)) continue
        const persona = k.split("|")[0]
        if (v.total <= 0) continue
        diasNormales.set(persona, [...(diasNormales.get(persona) ?? []), v.total])
      }
    }
    const diaNormalDe = (persona: string): number | null => {
      const xs = diasNormales.get(persona)
      if (!xs?.length) return null
      const ord = [...xs].sort((a, b) => a - b)
      return ord[Math.floor(ord.length / 2)]
    }

    // --- ACCIDENTES DE TRABAJO EN TRÁMITE ---------------------------------
    // No hay llave directa entre la novedad y el expediente: hay que
    // reconstruir por cédula + rango de fechas del ausentismo, y de ahí al
    // incidente. Se hace una sola vez y se indexa.
    const enTramiteArl = new Map<string, boolean>()
    try {
      const [ausRes, incRes] = await Promise.all([
        sb.from("ausentismosst").select("id, cedula, fecha_inicial, fecha_final, tipo_evento").eq("tipo_evento", "AT"),
        sb.from("sst_incidentes").select("ausentismo_id, reportado_arl, cierre_arl"),
      ])
      const tramitePorAus = new Map<string, boolean>()
      for (const i of incRes.data ?? []) {
        if (!i.ausentismo_id) continue
        // "En trámite" = ya se reportó a la ARL y el expediente sigue abierto.
        tramitePorAus.set(String(i.ausentismo_id), !!i.reportado_arl && i.cierre_arl !== true)
      }
      for (const a of ausRes.data ?? []) {
        if (!tramitePorAus.get(String(a.id))) continue
        const ced = normCedula(a.cedula)
        const ini = String(a.fecha_inicial ?? "").slice(0, 10)
        const fin = String(a.fecha_final ?? ini).slice(0, 10)
        if (!ced || !ini) continue
        // Se marca cada día del episodio: así la fila de novedad de ese día
        // encuentra su estado sin volver a consultar.
        for (let d = new Date(`${ini}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
          const iso = d.toISOString().slice(0, 10)
          enTramiteArl.set(`${ced}|${iso}`, true)
          if (iso >= fin) break
        }
      }
    } catch (e: any) {
      console.error("[v0] getNovedadesPeriodo ARL:", e?.message ?? e)
    }

    // --- ARMAR LAS FILAS --------------------------------------------------
    const novedades: NovedadPeriodo[] = filas.map((r) => {
      const persona = String(r.nombre ?? "").trim().toLowerCase()
      const fecha = String(r.fecha).slice(0, 10)
      const meta = metaDeNovedad(r.asistencia)
      const liq = liquidado.get(`${persona}|${fecha}`)
      const normal = diaNormalDe(persona)

      // Impacto = lo liquidado ese día − lo que habría ganado un día normal.
      // Sin referencia (persona sin días normales en la quincena) no se
      // inventa: queda en null y la tabla muestra un guion.
      const impacto = liq != null && normal != null ? Math.round(liq.total - normal) : null

      const ced = normCedula(r.identificacion)
      const arl = meta?.sigla === "AT" && enTramiteArl.get(`${ced}|${fecha}`) === true

      return {
        id: Number(r.id),
        fecha,
        trabajador: r.nombre ?? "",
        identificacion: String(r.identificacion ?? ""),
        valor: r.asistencia,
        sigla: meta?.sigla ?? "OTR",
        etiqueta: meta?.etiqueta ?? String(r.asistencia),
        color: meta?.color ?? "#64748b",
        categoria: categoriaDeNovedad(r.asistencia),
        pagaElDia: meta?.pagaElDia ?? false,
        bloqueaDominical: meta?.bloqueaDominical ?? false,
        // No hay aprobación de novedades del día: se escriben y quedan
        // vigentes. El estado refleja eso, no un flujo que no existe.
        estado: arl ? "en_tramite_arl" : "registrada",
        impacto,
        liquidadoDia: liq?.total ?? null,
      }
    })

    // Agrupar días consecutivos de la misma persona con la misma novedad: una
    // incapacidad de 3 días es UN evento, no tres renglones.
    const agrupadas: NovedadPeriodo[] = []
    const porClave = new Map<string, NovedadPeriodo[]>()
    for (const n of novedades) {
      const k = `${n.identificacion}|${n.valor}`
      porClave.set(k, [...(porClave.get(k) ?? []), n])
    }
    for (const grupo of porClave.values()) {
      grupo.sort((a, b) => a.fecha.localeCompare(b.fecha))
      let bloque: NovedadPeriodo[] = []
      const cerrar = () => {
        if (!bloque.length) return
        const primero = bloque[0]
        const ultimo = bloque[bloque.length - 1]
        const conImpacto = bloque.filter((x) => x.impacto != null)
        agrupadas.push({
          ...primero,
          fechaFin: ultimo.fecha,
          dias: bloque.length,
          ids: bloque.map((x) => x.id),
          impacto: conImpacto.length ? conImpacto.reduce((s, x) => s + (x.impacto ?? 0), 0) : null,
        })
        bloque = []
      }
      for (const n of grupo) {
        if (!bloque.length) { bloque = [n]; continue }
        const prev = bloque[bloque.length - 1].fecha
        const sig = new Date(`${prev}T12:00:00Z`)
        sig.setUTCDate(sig.getUTCDate() + 1)
        if (sig.toISOString().slice(0, 10) === n.fecha) bloque.push(n)
        else { cerrar(); bloque = [n] }
      }
      cerrar()
    }
    agrupadas.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.trabajador.localeCompare(b.trabajador))

    const conImpacto = agrupadas.filter((n) => n.impacto != null)
    return {
      success: true,
      data: {
        quincena: {
          anio, mes, numero: quincena, desde, hasta,
          etiqueta: `${diaIni} – ${diaFin} de ${MESES[mes - 1]}`,
        },
        novedades: agrupadas,
        totales: {
          eventos: agrupadas.length,
          dias: agrupadas.reduce((s, n) => s + (n.dias ?? 1), 0),
          enTramiteArl: agrupadas.filter((n) => n.estado === "en_tramite_arl").length,
          impactoNeto: conImpacto.length ? conImpacto.reduce((s, n) => s + (n.impacto ?? 0), 0) : null,
        },
        avisos,
      },
    }
  } catch (e: any) {
    console.error("[v0] getNovedadesPeriodo excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron cargar las novedades." }
  }
}

/**
 * Registra una novedad para una persona en un día o en un rango.
 *
 * POR QUE NO SE LLAMA A /api/personnel-notices DESDE LA PANTALLA
 * Ese endpoint espera filas que YA existen: hace `.update().eq("id", record.id)`.
 * Si se le manda `id: null` --el caso normal cuando la persona no tiene fila ese
 * día-- el update no encuentra nada, NO falla, y la novedad se pierde en
 * silencio. Por eso acá se resuelve la fila primero (update-or-insert por
 * fecha), igual que hace `aprobarSolicitudVacaciones`.
 *
 * Los efectos colaterales SI se reusan tal cual:
 *  · procesarNovedadRetiro      — inactiva a la persona en headcount
 *  · sincronizarBorradorAusentismo — crea el borrador de ausentismo SST
 * Reimplementarlos sería tener dos caminos que se contradicen.
 */
export async function registrarNovedad(payload: {
  empresaId: number
  identificacion: string
  nombre: string
  valor: string
  fechaDesde: string
  fechaHasta?: string | null
}): Promise<{ success: boolean; dias?: number; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Novedades de personal", "Tabla Asistencia"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const { empresaId, identificacion, nombre, valor, fechaDesde } = payload
  if (!empresaId) return { success: false, message: "Falta la empresa." }
  if (!identificacion || !nombre) return { success: false, message: "Falta el trabajador." }
  if (!valor) return { success: false, message: "Falta el tipo de novedad." }
  if (!fechaDesde) return { success: false, message: "Falta la fecha." }

  const hasta = payload.fechaHasta && payload.fechaHasta >= fechaDesde ? payload.fechaHasta : fechaDesde
  if (hasta < fechaDesde) return { success: false, message: "La fecha final es anterior a la inicial." }

  // Los días del rango, sin pasar por Date local (evita el corrimiento UTC que
  // en Colombia puede restar un día).
  const dias: string[] = []
  for (let f = fechaDesde; f <= hasta; ) {
    dias.push(f)
    const [a, m, d] = f.split("-").map(Number)
    f = new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10)
    if (dias.length > 400) break // guarda contra un rango absurdo
  }

  try {
    const sb: any = await getSupabaseAdmin()

    // Filas que ya existen en esas fechas, para actualizar en vez de duplicar.
    const { data: existentes } = await sb
      .from("registroasistencia")
      .select("id, fecha")
      .eq("idempresa", empresaId)
      .eq("identificacion", identificacion)
      .gte("fecha", fechaDesde)
      .lte("fecha", hasta)

    const idPorFecha = new Map<string, number>()
    for (const e of existentes ?? []) idPorFecha.set(String(e.fecha).slice(0, 10), Number(e.id))

    // Contrato de una fila de novedad: sin puesto, sin horas, especialidad en
    // false. Dejar `puesto` con valor haría ambiguo el estado en Tabla
    // Asistencia.
    const nuevos: any[] = []
    for (const f of dias) {
      const id = idPorFecha.get(f)
      if (id) {
        const { error } = await sb
          .from("registroasistencia")
          .update({ asistencia: valor, puesto: null, horasturno: null, especialidad: false })
          .eq("id", id)
        if (error) return { success: false, message: error.message }
      } else {
        nuevos.push({
          idempresa: empresaId,
          fecha: f,
          nombre,
          identificacion,
          asistencia: valor,
          puesto: null,
          horasturno: null,
          especialidad: false,
        })
      }
    }
    if (nuevos.length) {
      // Sin fijar `id`: la columna es SERIAL y fijarla a mano no avanza la
      // secuencia, lo que después choca con la programación de turnos.
      const { error } = await sb.from("registroasistencia").insert(nuevos)
      if (error) return { success: false, message: error.message }
    }

    // Retiro: da de baja a la persona. Se hace una sola vez, con el primer día.
    if (valor.toLowerCase().includes("retiro")) {
      try {
        await procesarNovedadRetiro({
          identificacion,
          fecha: fechaDesde,
          asistencia: valor,
          idempresa: empresaId,
        })
      } catch (e: any) {
        console.error("[v0] registrarNovedad retiro:", e?.message ?? e)
      }
    }

    // Puente a Ausentismos. Solo actúa sobre incapacidades y licencias no
    // remuneradas; las demás novedades las ignora por su cuenta.
    try {
      await Promise.all(
        dias.map((f) => sincronizarBorradorAusentismo(Number(empresaId), String(identificacion), f)),
      )
    } catch (e: any) {
      console.error("[v0] registrarNovedad ausentismo:", e?.message ?? e)
    }

    return { success: true, dias: dias.length }
  } catch (e: any) {
    console.error("[v0] registrarNovedad excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo registrar la novedad." }
  }
}

/**
 * Cambia la novedad de UN registro de asistencia (Tabla Asistencia, Novedades,
 * Visor). Antes components/attendance/edit-novedad-dialog.tsx lo escribía
 * directo desde el navegador (Fase 3, 2026-10-07).
 */
export async function actualizarNovedadAsistencia(id: number, novedad: string | null): Promise<{ success: boolean; message?: string }> {
  const motivoAccion = await motivoSinAccion(["Tabla Asistencia", "Novedades de personal", "Visor"], "editar", "Editar novedad del día")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("registroasistencia").update({ asistencia: novedad || null }).eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo actualizar la novedad." }
  }
}
