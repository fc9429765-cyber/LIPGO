"use server"

/**
 * Ficha del trabajador (Programación de turnos → Programar el día).
 *
 * Se abre con un clic en el nombre de cualquier fila de "Personal activo".
 * Combina, SOLO bajo demanda (no se precarga para toda la lista), dos fuentes
 * que ya existen y se muestran en otras pantallas:
 *
 *  - Resumen: mismo cálculo que "Control de Toneladas" (toneladas, % de
 *    meta) + horas extra reales de los últimos 7 días de `pagonomina`.
 *  - Quincena: misma grilla persona × día de "Vista de quincena → Detalle
 *    por persona" (qué puesto tuvo cada día), filtrada a esta persona.
 *
 * No inventa ningún cálculo nuevo -- reusa `getControlToneladas` y
 * `getProgramacionQuincena` tal cual, para que nunca diverja de lo que esas
 * pantallas ya muestran.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getControlToneladas } from "@/lib/control-toneladas-actions"
import { getProgramacionQuincena } from "@/lib/programacion-quincena-actions"
import type { CeldaAsignacion } from "@/lib/programacion-quincena-tipos"
import { normalizeName } from "@/lib/nomina-calculo-utils"

export interface ResumenTrabajador {
  tonAcumulada: number
  pctCumplimiento: number
  metaDia: number
  diasTrabajados: number
  /** Suma de horas_hed+hedf+hen+hef+hn (CANTIDAD de horas, no pesos) de los últimos 7 días. */
  horasExtraSemana: number
}

export interface DiaFichaTrabajador {
  fecha: string
  diaMes: number
  diaSemana: string
  puesto: string | null
  horaEntrada: string | null
  horaSalida: string | null
  novedad: string | null
}

export interface FichaTrabajador {
  identificacion: string
  nombre: string
  cargo: string | null
  resumen: ResumenTrabajador
  quincena: {
    etiqueta: string
    dias: DiaFichaTrabajador[]
  }
}

const p2 = (n: number) => String(n).padStart(2, "0")

/**
 * Suma horas_hed/hedf/hen/hef/hn (CANTIDAD de horas) de `pagonomina` en los
 * últimos 7 días antes de `fechaRef`.
 *
 * OJO: `pagonomina` tiene DOS familias de columnas para lo mismo -- `hed`,
 * `hedf`, ... son el VALOR en pesos ya liquidado (ver
 * `lib/revision-nomina-actions.ts:456`), mientras que `horas_hed`,
 * `horas_hedf`, ... son la CANTIDAD de horas (ver
 * `lib/conciliacion-avimol-actions.ts:576-581`). Para "horas extra
 * acumuladas" como criterio de rotación se necesita la cantidad, no el
 * valor -- por eso aquí se leen las columnas `horas_*`.
 */
async function getHorasExtraRecientes(admin: any, persona: string, fechaRef: string): Promise<number> {
  const ref = new Date(`${fechaRef}T00:00:00`)
  const desde = new Date(ref)
  desde.setDate(desde.getDate() - 7)
  const fmtDate = (dt: Date) => `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`

  const { data } = await admin
    .rpc("pagonomina_rango", { p_desde: fmtDate(desde), p_hasta: fmtDate(ref) })
    .select("horas_hed, horas_hedf, horas_hen, horas_hef, horas_hn")
    .eq("persona", persona)
    .gte("fecha", fmtDate(desde))
    .lte("fecha", fmtDate(ref))

  let total = 0
  for (const r of data ?? []) {
    total +=
      Number(r.horas_hed || 0) +
      Number(r.horas_hedf || 0) +
      Number(r.horas_hen || 0) +
      Number(r.horas_hef || 0) +
      Number(r.horas_hn || 0)
  }
  return Math.round(total * 10) / 10
}

export async function getFichaTrabajador(
  empresaId: number,
  identificacion: string,
  fecha: string,
): Promise<{ success: boolean; data?: FichaTrabajador; message?: string }> {
  if (!empresaId) return { success: false, message: "Empresa no seleccionada." }
  if (!identificacion) return { success: false, message: "Identificación requerida." }
  if (!fecha) return { success: false, message: "Fecha requerida." }

  const admin: any = await getSupabaseAdmin()

  const { data: hc, error: hcError } = await admin
    .from("headcount")
    .select("nombre, identificacion, cargo")
    .eq("idempresa", empresaId)
    .eq("identificacion", identificacion)
    .maybeSingle()
  if (hcError) return { success: false, message: hcError.message }
  if (!hc) return { success: false, message: "No se encontró el trabajador en Head Count." }
  const nombre = String(hc.nombre || "").trim()

  const [y, m, d] = fecha.split("-").map(Number)
  const anio = y
  const mes = m
  const quincena: 1 | 2 = d <= 15 ? 1 : 2

  // Ventana "mes en curso" para Control de Toneladas (mismo mes de la fecha objetivo).
  const ultimoDia = new Date(anio, mes, 0).getDate()
  const desdeMes = `${anio}-${p2(mes)}-01`
  const hastaMes = `${anio}-${p2(mes)}-${p2(ultimoDia)}`

  const [toneladasRes, quincenaRes, horasExtraSemana] = await Promise.all([
    getControlToneladas(empresaId, desdeMes, hastaMes),
    getProgramacionQuincena(empresaId, anio, mes, quincena),
    getHorasExtraRecientes(admin, nombre, fecha),
  ])

  let resumen: ResumenTrabajador = {
    tonAcumulada: 0,
    pctCumplimiento: 0,
    metaDia: 0,
    diasTrabajados: 0,
    horasExtraSemana,
  }
  if (toneladasRes.success && toneladasRes.data) {
    const t = toneladasRes.data.trabajadores.find((x) => normalizeName(x.persona) === normalizeName(nombre))
    if (t) {
      resumen = {
        tonAcumulada: t.tonAcumulada,
        pctCumplimiento: t.pctCumplimiento,
        metaDia: t.metaDia,
        diasTrabajados: t.diasTrabajados,
        horasExtraSemana,
      }
    }
  }

  let quincenaDias: DiaFichaTrabajador[] = []
  let etiqueta = ""
  if (quincenaRes.success && quincenaRes.data) {
    etiqueta = quincenaRes.data.quincena.etiqueta
    const fp = quincenaRes.data.personas.find((p) => p.identificacion === identificacion)
    quincenaDias = quincenaRes.data.dias.map((diaQ) => {
      const celda: CeldaAsignacion | undefined = fp?.dias[diaQ.fecha]
      return {
        fecha: diaQ.fecha,
        diaMes: diaQ.diaMes,
        diaSemana: diaQ.diaSemana,
        puesto: celda?.puesto ?? null,
        horaEntrada: celda?.horaEntrada ?? null,
        horaSalida: celda?.horaSalida ?? null,
        novedad: celda?.novedad ?? null,
      }
    })
  }

  return {
    success: true,
    data: {
      identificacion,
      nombre,
      cargo: hc.cargo ?? null,
      resumen,
      quincena: { etiqueta, dias: quincenaDias },
    },
  }
}
