// NÚCLEO PURO de las COMPROBACIONES DE CONVERGENCIA: que las cifras de la app cuadren entre sí
// todos los días, sin depender de que alguien las revise a mano.
//
// Gerencia (2026-10-05): "¿estás validando la veracidad de la información, que todos los
// datos converjan y sea una información veraz y confiable?". Hasta hoy esa validación la hice
// a mano, cuando tocaba un módulo. Esto la deja corriendo sola: cada check cruza dos fuentes
// que DEBEN coincidir y, si no coinciden, avisa el mismo día.
//
// Reglas del negocio que se vigilan (todas dichas por gerencia en octubre de 2026):
//   · "Nunca puede salir más de lo que dice la orden de cargue."
//   · "Un pedido no puede despachar más de lo que se creó."
//   · "Una orden se confirma una sola vez; la misma estiba no sale dos veces."
//   · La asignación reserva ("por descontar") y el picking despacha: una reserva vieja o una
//     orden a medias es un síntoma, no un estado normal.
//   · Un monitoreo que no puede leer su tabla no puede decir "todo bien".

export type EstadoCheck = "ok" | "alerta" | "critico" | "sin_datos"

export interface ResultadoCheck {
  clave: string
  titulo: string
  /** Qué regla protege, en una frase. */
  regla: string
  estado: EstadoCheck
  /** Cantidad de casos encontrados (0 = cuadra). */
  casos: number
  /** Hasta 10 ejemplos legibles, para poder ir directo al dato. */
  ejemplos: string[]
  /** Por qué no se pudo comprobar, cuando estado = sin_datos. */
  motivo?: string
}

export interface ResumenConvergencia {
  total: number
  ok: number
  alertas: number
  criticos: number
  sinDatos: number
  checks: ResultadoCheck[]
}

export function resumirChecks(checks: ResultadoCheck[]): ResumenConvergencia {
  const r: ResumenConvergencia = { total: checks.length, ok: 0, alertas: 0, criticos: 0, sinDatos: 0, checks }
  for (const c of checks) {
    if (c.estado === "ok") r.ok++
    else if (c.estado === "alerta") r.alertas++
    else if (c.estado === "critico") r.criticos++
    else r.sinDatos++
  }
  return r
}

/** Hay que avisar si algo no cuadra o si algo no se pudo comprobar. */
export const hayQueAvisar = (r: ResumenConvergencia) => r.criticos > 0 || r.alertas > 0 || r.sinDatos > 0

/** Construye un resultado a partir de una lista de casos: 0 casos = ok. */
export function resultadoDe(
  base: { clave: string; titulo: string; regla: string; gravedad: "alerta" | "critico" },
  casos: string[],
): ResultadoCheck {
  return {
    clave: base.clave,
    titulo: base.titulo,
    regla: base.regla,
    estado: casos.length === 0 ? "ok" : base.gravedad,
    casos: casos.length,
    ejemplos: casos.slice(0, 10),
  }
}

export function sinDatos(base: { clave: string; titulo: string; regla: string }, motivo: string): ResultadoCheck {
  return { clave: base.clave, titulo: base.titulo, regla: base.regla, estado: "sin_datos", casos: 0, ejemplos: [], motivo }
}

export function asuntoConvergencia(r: ResumenConvergencia, fecha: string): string {
  if (!hayQueAvisar(r)) return `LIPgo · convergencia: todo cuadra · ${fecha}`
  const partes: string[] = []
  if (r.criticos) partes.push(`${r.criticos} ${r.criticos === 1 ? "crítico" : "críticos"}`)
  if (r.alertas) partes.push(`${r.alertas} ${r.alertas === 1 ? "alerta" : "alertas"}`)
  if (r.sinDatos) partes.push(`${r.sinDatos} sin comprobar`)
  return `LIPgo · convergencia: ${partes.join(", ")} · ${fecha}`
}

const ETIQUETA: Record<EstadoCheck, string> = { ok: "cuadra", alerta: "ALERTA", critico: "CRÍTICO", sin_datos: "SIN COMPROBAR" }

export function lineasConvergencia(r: ResumenConvergencia): string[] {
  const out: string[] = [`${r.total} comprobaciones · ${r.ok} cuadran · ${r.alertas} alertas · ${r.criticos} críticos · ${r.sinDatos} sin comprobar`]
  const orden: Record<EstadoCheck, number> = { critico: 0, alerta: 1, sin_datos: 2, ok: 3 }
  for (const c of [...r.checks].sort((a, b) => orden[a.estado] - orden[b.estado])) {
    out.push(`[${ETIQUETA[c.estado]}] ${c.titulo}${c.estado === "ok" ? "" : c.estado === "sin_datos" ? ` — ${c.motivo ?? "sin motivo"}` : ` — ${c.casos} ${c.casos === 1 ? "caso" : "casos"}`}`)
    for (const e of c.ejemplos.slice(0, 5)) out.push(`    · ${e}`)
  }
  return out
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string)
const COLOR: Record<EstadoCheck, string> = { ok: "#1E8449", alerta: "#B7791F", critico: "#C0392B", sin_datos: "#64748b" }

export function htmlConvergencia(r: ResumenConvergencia, fecha: string, pie: string): string {
  const orden: Record<EstadoCheck, number> = { critico: 0, alerta: 1, sin_datos: 2, ok: 3 }
  const filas = [...r.checks]
    .sort((a, b) => orden[a.estado] - orden[b.estado])
    .map(
      (c) => `<tr style="border-top:1px solid #e2e8f0">
  <td style="padding:8px 10px;white-space:nowrap"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${COLOR[c.estado]};color:#fff;font-size:12px;font-weight:700">${ETIQUETA[c.estado]}</span></td>
  <td style="padding:8px 10px">
    <div style="font-weight:600">${esc(c.titulo)}${c.estado !== "ok" && c.estado !== "sin_datos" ? ` · ${c.casos} ${c.casos === 1 ? "caso" : "casos"}` : ""}</div>
    <div style="color:#64748b;font-size:12px">${esc(c.regla)}</div>
    ${c.estado === "sin_datos" ? `<div style="color:#475569;font-size:13px">${esc(c.motivo ?? "")}</div>` : ""}
    ${c.ejemplos.length ? `<ul style="margin:6px 0 0;padding-left:18px;color:#334155;font-size:13px">${c.ejemplos.slice(0, 6).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
  </td>
</tr>`,
    )
    .join("")
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;color:#0f172a">
  <h2 style="margin:0 0 4px;font-size:18px;color:#0D3B6E">Convergencia de datos · ${esc(fecha)}</h2>
  <p style="margin:0 0 14px;color:#475569;font-size:14px">${r.total} comprobaciones · ${r.ok} cuadran · ${r.alertas} alertas · ${r.criticos} críticos · ${r.sinDatos} sin comprobar</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px"><tbody>${filas}</tbody></table>
  <p style="margin:14px 0 0;color:#64748b;font-size:12px">${esc(pie)}</p>
</div>`
}
