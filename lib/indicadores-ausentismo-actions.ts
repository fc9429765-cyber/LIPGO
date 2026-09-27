"use server"

// ---------------------------------------------------------------------------
// INDICADORES DE AUSENTISMO DEL PERIODO
//
// Reusa el criterio canónico del Panel de Gestión Humana:
//   índice = días perdidos / días-persona ESPERADOS
//
// El denominador son los días que la gente estuvo VINCULADA en el periodo
// (cruzando `fechainicio` y `fecha_retiro` con el rango), no las filas de
// asistencia. Con filas, alguien con dos turnos el mismo día contaría doble y
// el porcentaje podría pasar del 100%.
//
// Qué cuenta como ausentismo lo decide `categoriaDeNovedad`: incapacidades
// (EG/AT) y licencias no remuneradas. Vacaciones y descansos NO son ausentismo
// --son derechos programados-- y mezclarlos inflaría el indicador.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { categoriaDeNovedad, diasActivosEnPeriodo } from "@/lib/ausentismo-categorias"
import { metaDeNovedad } from "@/lib/novedades-catalogo"
import type {
  CausaAusentismo,
  IndicadoresAusentismoData,
  ReincidenciaPersona,
} from "@/lib/indicadores-ausentismo-tipos"

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** Color por categoría de ausentismo, para las barras. */
const COLOR_CATEGORIA: Record<string, string> = {
  ENFERMEDAD_GENERAL: "#0ea5e9",
  ACCIDENTE_LABORAL: "#06b6d4",
  NO_REMUNERADA: "#f97316",
}

function sumarDias(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
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

export async function getIndicadoresAusentismo(
  empresaId: number | null | undefined,
  desde: string,
  hasta: string,
): Promise<{ success: boolean; data?: IndicadoresAusentismoData; message?: string }> {
  if (!empresaId) return { success: false, message: "Selecciona una empresa en el selector de arriba." }
  if (!desde || !hasta) return { success: false, message: "Falta el rango de fechas." }

  const avisos: string[] = []

  try {
    const sb: any = await getSupabaseAdmin()

    // --- HEADCOUNT: el denominador y los salarios ------------------------
    let personas: any[] = []
    try {
      personas = await traerTodo((d, h) =>
        sb
          .from("headcount")
          .select("identificacion, nombre, salario, fechainicio, fecha_retiro, admin")
          .eq("idempresa", empresaId)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      )
      personas = personas.filter((p) => !/prueba/i.test(String(p.nombre ?? "")))
    } catch (e: any) {
      avisos.push("No se pudo leer el personal: el índice no se puede calcular.")
      console.error("[v0] getIndicadoresAusentismo headcount:", e?.message ?? e)
    }

    // Días-persona esperados: solo operativos. El administrativo no marca
    // turno, así que meterlo en el denominador diluiría el indicador.
    let diasEsperados = 0
    const salarioPorIdent = new Map<string, number>()
    for (const p of personas) {
      if (p.admin === true) continue
      const ident = String(p.identificacion ?? "").trim()
      diasEsperados += diasActivosEnPeriodo(p.fechainicio, p.fecha_retiro, desde, hasta)
      const s = Number(p.salario) || 0
      if (s > 0) salarioPorIdent.set(ident, s)
    }

    // Identificaciones administrativas, aparte de `personas` (que está scoped
    // a esta empresa): `admin` es project-agnostic -- hay administrativos con
    // idempresa NULL que no saldrían en `personas` pero sí tienen filas reales
    // de registroasistencia en esta empresa.
    const identificacionesAdmin = new Set<string>()
    try {
      const filasAdmin = await traerTodo((d, h) =>
        sb
          .from("headcount")
          .select("identificacion")
          .eq("admin", true)
          .or(`idempresa.eq.${empresaId},idempresa.is.null`)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      )
      for (const p of filasAdmin) identificacionesAdmin.add(String(p.identificacion ?? "").trim())
    } catch (e: any) {
      console.error("[v0] getIndicadoresAusentismo headcount admin:", e?.message ?? e)
    }

    // --- LAS AUSENCIAS ----------------------------------------------------
    // Administrativos fuera: el denominador (diasEsperados, arriba) ya los
    // excluye -- sin este filtro aquí, sus novedades (incapacidad, licencia)
    // inflarían el numerador (diasPerdidos/causas/reincidencia) mientras el
    // denominador se queda solo con operativos, dando un índice inflado.
    let filas: any[] = []
    try {
      filas = await traerTodo((d, h) =>
        sb
          .from("registroasistencia")
          .select("identificacion, nombre, fecha, asistencia")
          .eq("idempresa", empresaId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .not("asistencia", "is", null)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      )
      filas = filas.filter(
        (r) => !/prueba/i.test(String(r.nombre ?? "")) && !identificacionesAdmin.has(String(r.identificacion ?? "").trim()),
      )
    } catch (e: any) {
      avisos.push("No se pudieron leer las novedades del periodo.")
      console.error("[v0] getIndicadoresAusentismo registroasistencia:", e?.message ?? e)
    }

    // Solo lo que ES ausentismo, deduplicado por persona-día: una persona con
    // dos turnos el mismo día es UN día perdido, no dos.
    const porPersonaDia = new Map<string, { ident: string; nombre: string; fecha: string; novedad: string }>()
    for (const r of filas) {
      if (!categoriaDeNovedad(r.asistencia)) continue
      const ident = String(r.identificacion ?? "").trim()
      const fecha = String(r.fecha).slice(0, 10)
      porPersonaDia.set(`${ident}|${fecha}`, {
        ident,
        nombre: r.nombre ?? "",
        fecha,
        novedad: r.asistencia,
      })
    }
    const ausencias = [...porPersonaDia.values()]
    const diasPerdidos = ausencias.length

    // --- CAUSAS -----------------------------------------------------------
    // Se agrupa por la novedad concreta --no por categoría-- porque "permiso no
    // remunerado" y "suspensión" pesan distinto para quien lee el indicador,
    // aunque ambas sean NO_REMUNERADA.
    const porCausa = new Map<string, { etiqueta: string; dias: number; color: string }>()
    for (const a of ausencias) {
      const meta = metaDeNovedad(a.novedad)
      const cat = categoriaDeNovedad(a.novedad)
      const clave = meta?.etiqueta ?? a.novedad
      const acc = porCausa.get(clave) ?? {
        etiqueta: clave,
        dias: 0,
        color: COLOR_CATEGORIA[cat ?? ""] ?? meta?.color ?? "#64748b",
      }
      acc.dias++
      porCausa.set(clave, acc)
    }
    const causas: CausaAusentismo[] = [...porCausa.entries()]
      .map(([id, v]) => ({
        id,
        etiqueta: v.etiqueta,
        dias: v.dias,
        pct: diasPerdidos > 0 ? Math.round((v.dias / diasPerdidos) * 100) : 0,
        color: v.color,
      }))
      .sort((a, b) => b.dias - a.dias)

    // --- EVENTOS: días consecutivos de la misma persona = UN evento -------
    const porPersona = new Map<string, typeof ausencias>()
    for (const a of ausencias) {
      porPersona.set(a.ident, [...(porPersona.get(a.ident) ?? []), a])
    }

    let eventos = 0
    const reincidencia: ReincidenciaPersona[] = []
    for (const [ident, lista] of porPersona) {
      lista.sort((x, y) => x.fecha.localeCompare(y.fecha))
      let eventosPersona = 0
      let anterior: string | null = null
      const diasPorCausa = new Map<string, number>()
      for (const a of lista) {
        if (anterior == null || a.fecha !== sumarDias(anterior, 1)) eventosPersona++
        anterior = a.fecha
        const et = metaDeNovedad(a.novedad)?.etiqueta ?? a.novedad
        diasPorCausa.set(et, (diasPorCausa.get(et) ?? 0) + 1)
      }
      eventos += eventosPersona

      const top = [...diasPorCausa.entries()].sort((x, y) => y[1] - x[1])[0]
      const cat = categoriaDeNovedad(lista[0].novedad)
      // Solo interesa quien tiene MÁS DE UN evento: uno solo no es reincidencia.
      if (eventosPersona > 1) {
        reincidencia.push({
          identificacion: ident,
          nombre: lista[0].nombre,
          eventos: eventosPersona,
          dias: lista.length,
          predominante: top?.[0] ?? "",
          predominanteColor: COLOR_CATEGORIA[cat ?? ""] ?? "#64748b",
        })
      }
    }
    reincidencia.sort((a, b) => b.eventos - a.eventos || b.dias - a.dias)

    // --- COSTO ------------------------------------------------------------
    // Día perdido = salario / 30, el mismo `valor_diario_ley` que usa la
    // nómina. Solo cuenta a quien tiene salario registrado: estimarle uno a
    // quien no lo tiene daría una cifra que nadie puede auditar.
    let costo = 0
    let conSalario = 0
    const sinSalarioSet = new Set<string>()
    for (const a of ausencias) {
      const s = salarioPorIdent.get(a.ident)
      if (!s) {
        sinSalarioSet.add(a.ident)
        continue
      }
      costo += s / 30
      conSalario++
    }
    if (sinSalarioSet.size > 0) {
      avisos.push(
        `${sinSalarioSet.size} persona(s) con ausencias no tienen salario registrado en Head Count: sus días no entran al costo.`,
      )
    }

    const [anio, mes] = desde.split("-").map(Number)

    return {
      success: true,
      data: {
        periodo: {
          desde,
          hasta,
          etiqueta: `${Number(desde.slice(8))} – ${Number(hasta.slice(8))} de ${MESES[mes - 1]} ${anio}`,
        },
        indice: diasEsperados > 0 ? Math.round((diasPerdidos / diasEsperados) * 1000) / 10 : null,
        diasEsperados,
        diasPerdidos,
        costo: conSalario > 0 ? Math.round(costo) : null,
        sinSalario: sinSalarioSet.size,
        severidad: eventos > 0 ? Math.round((diasPerdidos / eventos) * 10) / 10 : null,
        eventos,
        causas,
        reincidencia: reincidencia.slice(0, 15),
        avisos,
      },
    }
  } catch (e: any) {
    console.error("[v0] getIndicadoresAusentismo excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudieron calcular los indicadores." }
  }
}
