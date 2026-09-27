// Periodo por defecto de los LISTADOS grandes (pedidos, órdenes de cargue).
//
// Por qué existe: Supabase corta cada consulta en 1.000 filas sin avisar, y estas
// pantallas cargaban "toda la historia" (9.000-12.000 filas) que en realidad
// llegaba recortada a las 1.000 más recientes. Traer todo el historial paginado
// en cada apertura tampoco es la salida (megas al navegador). Solución: un
// periodo explícito, visible en la pantalla, con "últimos 90 días" por defecto
// y la opción de ampliar hasta "Todo el historial" cuando de verdad se necesita;
// dentro del periodo elegido se pagina completo (nada se recorta).
//
// Es código puro (sin "use server"): lo usan componentes cliente y acciones.

export type PeriodoListado = "90" | "180" | "365" | "todo"

export const PERIODOS_LISTADO: { valor: PeriodoListado; etiqueta: string }[] = [
  { valor: "90", etiqueta: "Últimos 90 días" },
  { valor: "180", etiqueta: "Últimos 6 meses" },
  { valor: "365", etiqueta: "Último año" },
  { valor: "todo", etiqueta: "Todo el historial" },
]

export const PERIODO_LISTADO_DEFECTO: PeriodoListado = "90"

/** Hoy en Bogotá como 'YYYY-MM-DD' (vale en navegador y servidor). */
export function hoyBogotaISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
}

/** Resta días a una fecha 'YYYY-MM-DD' (aritmética en UTC, sin efectos de zona). */
export function restarDiasISO(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - dias)
  return dt.toISOString().slice(0, 10)
}

/** Fecha 'desde' del periodo; `null` = sin límite (todo el historial). */
export function desdeDePeriodo(periodo: PeriodoListado, hoyISO: string = hoyBogotaISO()): string | null {
  if (periodo === "todo") return null
  return restarDiasISO(hoyISO, Number(periodo))
}
