// Cálculo puro del cumplimiento de la programación del cliente (sin base de
// datos, sin "use server"): lo usan la server action y las pruebas.

import type { CumplimientoDia, CumplimientoResumen, CumplimientoTipo, LineaProgramacion, ProgramacionCliente } from "./programacion-cliente-tipos"

/** "Doble troque" ≡ "Dobletroque" ≡ "DOBLETROQUE": sin tildes, espacios ni mayúsculas. */
export const normalizarTipo = (s: string | null | undefined): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")

const pad = (n: number) => String(n).padStart(2, "0")

/** Suma `n` días a una fecha 'YYYY-MM-DD' (aritmética UTC, sin zona horaria). */
export function sumarDias(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Fechas 'YYYY-MM-DD' de `desde` a `hasta`, ambas incluidas (máx. 370). */
export function diasEntre(desde: string, hasta: string): string[] {
  const out: string[] = []
  let f = desde.slice(0, 10)
  const h = hasta.slice(0, 10)
  while (f <= h && out.length < 370) {
    out.push(f)
    f = sumarDias(f, 1)
  }
  return out
}

/** 0 = domingo … 6 = sábado, para una fecha 'YYYY-MM-DD'. */
export function diaSemana(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export interface CitaResumen {
  /** 'YYYY-MM-DD' de llegada. */
  fecha: string
  tipovehiculo: string | null
}

const redondear1 = (x: number) => Math.round(x * 10) / 10

/**
 * Cruza, día a día, lo programado (líneas de la versión vigente) contra los
 * vehículos que llegaron a portería, por tipo de vehículo.
 *
 *   cumplidos      = Σ min(programados, llegaron) por tipo
 *   noLlegaron     = Σ max(programados − llegaron, 0)
 *   noProgramados  = Σ max(llegaron − programados, 0)
 *   porcentaje     = cumplidos / programados (null si no hubo programación)
 */
export function calcularCumplimiento(
  desde: string,
  hasta: string,
  programaciones: ProgramacionCliente[],
  citas: CitaResumen[],
): CumplimientoResumen {
  const progPorDia = new Map<string, ProgramacionCliente>()
  for (const p of programaciones) if (p.vigente) progPorDia.set(p.fechaOperacion.slice(0, 10), p)

  const citasPorDia = new Map<string, Map<string, { nombre: string; n: number }>>()
  for (const c of citas) {
    const f = c.fecha.slice(0, 10)
    const k = normalizarTipo(c.tipovehiculo) || "sintipo"
    if (!citasPorDia.has(f)) citasPorDia.set(f, new Map())
    const m = citasPorDia.get(f)!
    const e = m.get(k) ?? { nombre: (c.tipovehiculo ?? "").trim() || "Sin tipo", n: 0 }
    e.n++
    m.set(k, e)
  }

  const dias: CumplimientoDia[] = []
  for (const fecha of diasEntre(desde, hasta)) {
    const p = progPorDia.get(fecha) ?? null
    const reales = citasPorDia.get(fecha) ?? new Map<string, { nombre: string; n: number }>()
    const lineas: LineaProgramacion[] = p?.lineas ?? []
    if (!p && reales.size === 0) continue // día sin operación ni programación (p. ej. domingo)

    const progPorTipo = new Map<string, { nombre: string; n: number }>()
    for (const l of lineas) {
      const k = normalizarTipo(l.tipovehiculo) || "sintipo"
      const e = progPorTipo.get(k) ?? { nombre: l.tipovehiculo?.trim() || "Sin tipo", n: 0 }
      e.n += Math.max(0, Number(l.cantidad) || 0)
      progPorTipo.set(k, e)
    }

    const claves = new Set<string>([...progPorTipo.keys(), ...reales.keys()])
    const porTipo: CumplimientoTipo[] = []
    let programados = 0
    let llegaron = 0
    let cumplidos = 0
    let noLlegaron = 0
    let noProgramados = 0
    for (const k of claves) {
      const pr = progPorTipo.get(k)?.n ?? 0
      const re = reales.get(k)?.n ?? 0
      const cu = Math.min(pr, re)
      porTipo.push({
        tipovehiculo: progPorTipo.get(k)?.nombre ?? reales.get(k)?.nombre ?? k,
        programados: pr,
        llegaron: re,
        cumplidos: cu,
        noLlegaron: Math.max(pr - re, 0),
        noProgramados: Math.max(re - pr, 0),
      })
      programados += pr
      llegaron += re
      cumplidos += cu
      noLlegaron += Math.max(pr - re, 0)
      noProgramados += Math.max(re - pr, 0)
    }
    porTipo.sort((a, b) => b.programados - a.programados || b.llegaron - a.llegaron || a.tipovehiculo.localeCompare(b.tipovehiculo))

    dias.push({
      fecha,
      tieneProgramacion: !!p,
      aTiempo: p ? p.aTiempo : null,
      enviadaEn: p?.enviadaEn ?? null,
      enviadaPorUsuario: p?.enviadaPorUsuario ?? null,
      version: p?.version ?? null,
      programados,
      llegaron,
      cumplidos,
      noLlegaron,
      noProgramados,
      porcentaje: programados > 0 ? redondear1((cumplidos / programados) * 100) : null,
      porTipo,
      lineas,
    })
  }

  const conProg = dias.filter((d) => d.tieneProgramacion)
  const programados = conProg.reduce((s, d) => s + d.programados, 0)
  const cumplidos = conProg.reduce((s, d) => s + d.cumplidos, 0)
  return {
    desde,
    hasta,
    dias,
    diasOperados: dias.length,
    diasConProgramacion: conProg.length,
    diasATiempo: conProg.filter((d) => d.aTiempo).length,
    diasSinProgramacion: dias.filter((d) => !d.tieneProgramacion && d.llegaron > 0).length,
    programados,
    llegaron: dias.reduce((s, d) => s + d.llegaron, 0),
    cumplidos,
    noLlegaron: conProg.reduce((s, d) => s + d.noLlegaron, 0),
    noProgramados: dias.reduce((s, d) => s + d.noProgramados, 0),
    porcentaje: programados > 0 ? redondear1((cumplidos / programados) * 100) : null,
  }
}
