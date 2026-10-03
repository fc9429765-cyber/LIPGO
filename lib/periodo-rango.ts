// Períodos del Dashboard de pedidos (código puro: lo usan componentes y acciones).
// Un solo selector gobierna toda la pantalla; cada preset se traduce a un rango
// [desde, hasta] en fechas ISO de Bogotá.

import { diasEntre, sumarDiasISO } from "@/lib/pedidos-estado"

export type PresetPeriodo = "semana" | "quincena" | "mes" | "mes_anterior" | "90" | "rango"

export const PRESETS_PERIODO: { valor: PresetPeriodo; etiqueta: string }[] = [
  { valor: "semana", etiqueta: "Esta semana" },
  { valor: "quincena", etiqueta: "Quincena" },
  { valor: "mes", etiqueta: "Este mes" },
  { valor: "mes_anterior", etiqueta: "Mes anterior" },
  { valor: "90", etiqueta: "Últimos 90 días" },
  { valor: "rango", etiqueta: "Rango" },
]

/** Máximo de días que acepta el dashboard en un rango libre. */
export const MAX_DIAS_RANGO = 370

const finDeMes = (anio: number, mes1a12: number) => new Date(Date.UTC(anio, mes1a12, 0)).toISOString().slice(0, 10)
const pad = (n: number) => String(n).padStart(2, "0")

/** Lunes de la semana de una fecha ISO. */
export function lunesDe(fechaISO: string): string {
  const d = new Date(`${fechaISO}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  return sumarDiasISO(fechaISO, -dow)
}

export function rangoDe(preset: PresetPeriodo, hoyISO: string): { desde: string; hasta: string } {
  const [y, m, d] = hoyISO.split("-").map(Number)
  switch (preset) {
    case "semana": {
      const lunes = lunesDe(hoyISO)
      return { desde: lunes, hasta: sumarDiasISO(lunes, 6) }
    }
    case "quincena":
      return d <= 15 ? { desde: `${y}-${pad(m)}-01`, hasta: `${y}-${pad(m)}-15` } : { desde: `${y}-${pad(m)}-16`, hasta: finDeMes(y, m) }
    case "mes":
      return { desde: `${y}-${pad(m)}-01`, hasta: finDeMes(y, m) }
    case "mes_anterior": {
      const ya = m === 1 ? y - 1 : y
      const ma = m === 1 ? 12 : m - 1
      return { desde: `${ya}-${pad(ma)}-01`, hasta: finDeMes(ya, ma) }
    }
    case "90":
      return { desde: sumarDiasISO(hoyISO, -89), hasta: hoyISO }
    default:
      return { desde: `${y}-${pad(m)}-01`, hasta: hoyISO }
  }
}

/** Valida un rango libre; devuelve el error o null. */
export function validarRango(desde: string, hasta: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return "Fechas inválidas."
  if (hasta < desde) return "La fecha final es anterior a la inicial."
  if (diasEntre(hasta, desde) + 1 > MAX_DIAS_RANGO) return `El rango no puede superar ${MAX_DIAS_RANGO} días.`
  return null
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

/** "1 – 30 sep 2026" · "28 sep – 4 oct 2026". */
export function etiquetaRango(desde: string, hasta: string): string {
  const [y1, m1, d1] = desde.split("-").map(Number)
  const [y2, m2, d2] = hasta.split("-").map(Number)
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${MESES[m1 - 1]} ${y1}`
  if (y1 === y2) return `${d1} ${MESES[m1 - 1]} – ${d2} ${MESES[m2 - 1]} ${y1}`
  return `${d1} ${MESES[m1 - 1]} ${y1} – ${d2} ${MESES[m2 - 1]} ${y2}`
}

/** "YYYY-MM" → "sep 2026". */
export function etiquetaMes(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  return `${MESES[m - 1]} ${y}`
}
