// Informe semanal de gerencia — reglas PURAS (sin "use server", sin Supabase, sin red).
// Programa de nivel mundial, paso 5 (gerencia 2026-10-03: "todo orientado al resultado; el
// BSC es la matriz integradora"). Cada lunes el gerente recibe, por proyecto, la semana
// cerrada: cada indicador del BSC con su valor, el de la semana anterior, la meta y el
// semáforo, lo que hoy requiere acción, y una lectura breve escrita por la IA SOLO con esos
// números (si la IA inventa una cifra, se descarta y se usa la lectura determinista).
// Lo envía lib/informe-semanal-core.ts; la pantalla lo activa desde el panel Indicadores.

import { AREA_KPIS, KPI_DEFS, kpiSev, type KpiDef, type KpiSev } from "@/lib/kpis-area"
import { formatearValor } from "@/lib/alertas-bsc"

export const INDICADOR_INFORME = "informe_semanal"
const TRANSVERSALES = new Set(["sst", "certificaciones_lip"])

export interface FilaInforme {
  key: string
  area: string
  nombre: string
  valor: number | null
  previo: number | null
  meta: number | null
  menorMejor: boolean
  sev: KpiSev
  /** Cambio frente a la semana anterior en la unidad del indicador (null si falta alguno). */
  delta: number | null
  /** true si el cambio va en la dirección correcta. */
  mejora: boolean | null
  base: string | null
  valorTxt: string
  previoTxt: string
  metaTxt: string
}

export interface PendienteInforme {
  texto: string
  modulo: string
  nivel: "alto" | "medio"
}

export interface DatosInforme {
  empresaNombre: string
  rango: string
  rangoPrevio: string
  filas: FilaInforme[]
  pendientes: PendienteInforme[]
  /** Conteo rápido para el asunto y la cabecera. */
  enMeta: number
  fueraDeMeta: number
  criticos: number
  sinLectura: number
}

type Valores = Record<string, { valor: number; base?: string } | undefined>

/** Claves del BSC que entran en el informe de un PROYECTO (todas las áreas no transversales), sin repetir. */
export function clavesInformeProyecto(): { key: string; area: string }[] {
  const out: { key: string; area: string }[] = []
  const vistas = new Set<string>()
  for (const [area, keys] of Object.entries(AREA_KPIS)) {
    if (TRANSVERSALES.has(area)) continue
    for (const k of keys) {
      if (vistas.has(k) || !KPI_DEFS[k]) continue
      vistas.add(k)
      out.push({ key: k, area })
    }
  }
  return out
}

function num(v: { valor: number } | undefined): number | null {
  return v && typeof v.valor === "number" && Number.isFinite(v.valor) ? Math.round(v.valor * 10) / 10 : null
}

export function construirDatosInforme(input: {
  empresaNombre: string
  rango: string
  rangoPrevio: string
  semana: Valores
  previa: Valores
  pendientes: PendienteInforme[]
  claves?: { key: string; area: string }[]
}): DatosInforme {
  const claves = input.claves ?? clavesInformeProyecto()
  const filas: FilaInforme[] = claves.map(({ key, area }) => {
    const def: KpiDef = KPI_DEFS[key]
    const valor = num(input.semana[key])
    const previo = num(input.previa[key])
    const sinDatos = (key === "sat_cliente" || key === "sat_conductor") && input.semana[key]?.base === "0 encuestas"
    const sev: KpiSev = valor != null && !sinDatos ? kpiSev(def, valor) : "none"
    const menorMejor = def.higherBetter === false
    const delta = valor != null && previo != null ? Math.round((valor - previo) * 10) / 10 : null
    const mejora = delta == null || delta === 0 ? null : menorMejor ? delta < 0 : delta > 0
    return {
      key,
      area,
      nombre: def.nombre,
      valor: sinDatos ? null : valor,
      previo,
      meta: def.meta ?? null,
      menorMejor,
      sev,
      delta,
      mejora,
      base: input.semana[key]?.base ?? null,
      valorTxt: sinDatos ? "sin datos" : valor != null ? formatearValor(def, valor) : "sin lectura",
      previoTxt: previo != null ? formatearValor(def, previo) : "—",
      metaTxt: def.meta != null ? formatearValor(def, def.meta) : "—",
    }
  })
  const enMeta = filas.filter((f) => f.sev === "good").length
  const criticos = filas.filter((f) => f.sev === "crit").length
  const fueraDeMeta = filas.filter((f) => f.sev === "warn").length + criticos
  const sinLectura = filas.filter((f) => f.meta != null && f.valorTxt === "sin lectura").length
  return { empresaNombre: input.empresaNombre, rango: input.rango, rangoPrevio: input.rangoPrevio, filas, pendientes: input.pendientes, enMeta, fueraDeMeta, criticos, sinLectura }
}

export function asuntoInforme(d: DatosInforme): string {
  const estado = d.criticos > 0 ? `${d.criticos} en rojo` : d.fueraDeMeta > 0 ? `${d.fueraDeMeta} fuera de meta` : "todo en meta"
  return `LIPgo · Informe semanal ${d.empresaNombre} · ${d.rango} · ${estado}`
}

/** Lectura ejecutiva sin IA: hechos, en orden de gravedad. Siempre disponible. */
export function narrativaDeterminista(d: DatosInforme): string[] {
  const lineas: string[] = []
  const conMeta = d.filas.filter((f) => f.meta != null && f.valor != null)
  const rojos = conMeta.filter((f) => f.sev === "crit")
  const amarillos = conMeta.filter((f) => f.sev === "warn")
  const verdes = conMeta.filter((f) => f.sev === "good")
  lineas.push(`${d.empresaNombre}, semana ${d.rango}: ${verdes.length} indicador${verdes.length === 1 ? "" : "es"} en meta, ${amarillos.length} fuera de meta y ${rojos.length} crítico${rojos.length === 1 ? "" : "s"}.`)
  for (const f of rojos) lineas.push(`${f.nombre} está en ${f.valorTxt} frente a una meta de ${f.metaTxt}${f.previo != null ? ` (semana anterior ${f.previoTxt})` : ""}.`)
  for (const f of amarillos) lineas.push(`${f.nombre} quedó en ${f.valorTxt}, cerca de la meta de ${f.metaTxt}.`)
  const mejoras = conMeta.filter((f) => f.mejora === true && f.delta != null)
  const retrocesos = conMeta.filter((f) => f.mejora === false && f.delta != null)
  if (mejoras.length) lineas.push(`Mejoraron frente a la semana anterior: ${mejoras.map((f) => `${f.nombre} (${f.previoTxt} → ${f.valorTxt})`).join(", ")}.`)
  if (retrocesos.length) lineas.push(`Retrocedieron: ${retrocesos.map((f) => `${f.nombre} (${f.previoTxt} → ${f.valorTxt})`).join(", ")}.`)
  if (d.pendientes.length) lineas.push(`Hoy requiere acción: ${d.pendientes.map((p) => p.texto).join("; ")}.`)
  if (d.sinLectura) lineas.push(`${d.sinLectura} indicador${d.sinLectura === 1 ? "" : "es"} sin lectura en la semana (sin operación registrada para calcularlo).`)
  return lineas
}

/** Todas las cifras que la IA puede usar (como texto normalizado con coma o punto). */
export function cifrasPermitidas(d: DatosInforme): Set<string> {
  const out = new Set<string>()
  const add = (n: number | null) => {
    if (n == null || !Number.isFinite(n)) return
    for (const v of [n, Math.round(n), Math.round(n * 10) / 10]) {
      out.add(String(v))
      out.add(String(v).replace(".", ","))
    }
  }
  for (const f of d.filas) {
    add(f.valor)
    add(f.previo)
    add(f.meta)
    add(f.delta)
    if (f.delta != null) add(Math.abs(f.delta))
    for (const m of (f.base ?? "").matchAll(/\d+(?:[.,]\d+)?/g)) out.add(m[0].replace(",", "."))
  }
  for (const p of d.pendientes) for (const m of p.texto.matchAll(/\d+/g)) out.add(m[0])
  add(d.enMeta)
  add(d.fueraDeMeta)
  add(d.criticos)
  add(d.sinLectura)
  add(d.filas.length)
  for (const m of `${d.rango} ${d.rangoPrevio}`.matchAll(/\d+/g)) out.add(m[0])
  return out
}

/**
 * La lectura de la IA solo puede citar cifras que estén en los datos. Devuelve null si pasa,
 * o la primera cifra inventada. Se toleran los años de 4 cifras y los ordinales de lista.
 */
export function validarNarrativa(texto: string, d: DatosInforme): string | null {
  const permitidas = cifrasPermitidas(d)
  for (const m of texto.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const raw = m[0]
    if (/^\d{4}$/.test(raw) && Number(raw) >= 2000 && Number(raw) <= 2100) continue
    // "1.250" / "1,250" con separador de miles → el entero 1250.
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(raw)) {
      if (permitidas.has(raw.replace(/[.,]/g, ""))) continue
      return raw
    }
    const norm = raw.replace(",", ".")
    const n = Number(norm)
    if (permitidas.has(raw) || permitidas.has(norm) || (Number.isFinite(n) && permitidas.has(String(n)))) continue
    // "1." / "2." de una lista numerada.
    const despues = texto.slice((m.index ?? 0) + raw.length, (m.index ?? 0) + raw.length + 1)
    if (/^\d$/.test(raw) && despues === "." ) continue
    return raw
  }
  return null
}

const COLOR_SEV: Record<KpiSev, string> = { good: "#166534", warn: "#9A3412", crit: "#991B1B", none: "#5B6B7F" }
const PUNTO_SEV: Record<KpiSev, string> = { good: "●", warn: "●", crit: "●", none: "○" }

export function htmlInforme(d: DatosInforme, lectura: string[], opts: { enlace: string | null; pie: string; fuenteLectura: "ia" | "determinista" }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const porArea = new Map<string, FilaInforme[]>()
  for (const f of d.filas) {
    if (!porArea.has(f.area)) porArea.set(f.area, [])
    porArea.get(f.area)!.push(f)
  }
  const nombreArea = (a: string) => ({ integral: "Gerencia", pedidos: "Pedidos", despachos: "Recepción y Despacho", inventarios: "Inventarios", produccion: "Producción", lip: "Operación LIP", financiera: "Financiera", rrhh: "Gestión humana" } as Record<string, string>)[a] ?? a
  const fila = (f: FilaInforme) => {
    const flecha = f.delta == null || f.delta === 0 ? "" : f.mejora ? " ▲" : " ▼"
    return `<tr>
<td style="padding:6px 8px;border-top:1px solid #EEF2F6;color:${COLOR_SEV[f.sev]};font-size:14px">${PUNTO_SEV[f.sev]}</td>
<td style="padding:6px 8px;border-top:1px solid #EEF2F6;font-size:13px">${esc(f.nombre)}${f.base ? `<div style="font-size:11px;color:#5B6B7F">${esc(f.base)}</div>` : ""}</td>
<td style="padding:6px 8px;border-top:1px solid #EEF2F6;font-size:14px;font-weight:700;text-align:right;color:${COLOR_SEV[f.sev]};white-space:nowrap">${esc(f.valorTxt)}${flecha}</td>
<td style="padding:6px 8px;border-top:1px solid #EEF2F6;font-size:12px;text-align:right;color:#5B6B7F;white-space:nowrap">${esc(f.previoTxt)}</td>
<td style="padding:6px 8px;border-top:1px solid #EEF2F6;font-size:12px;text-align:right;color:#5B6B7F;white-space:nowrap">${esc(f.metaTxt)}</td>
</tr>`
  }
  const tablas = [...porArea.entries()]
    .map(
      ([area, filas]) => `<p style="margin:18px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0F766E;font-weight:600">${esc(nombreArea(area))}</p>
<table style="width:100%;border-collapse:collapse;border:1px solid #E3E8EE;border-radius:10px;overflow:hidden">
<thead><tr style="background:#F4F6F8;font-size:11px;color:#5B6B7F;text-align:left"><th style="padding:6px 8px"></th><th style="padding:6px 8px">Indicador</th><th style="padding:6px 8px;text-align:right">Semana</th><th style="padding:6px 8px;text-align:right">Anterior</th><th style="padding:6px 8px;text-align:right">Meta</th></tr></thead>
<tbody>${filas.map(fila).join("")}</tbody></table>`,
    )
    .join("")
  const pendientes = d.pendientes.length
    ? `<p style="margin:18px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#991B1B;font-weight:600">Hoy requiere acción</p><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6">${d.pendientes.map((p) => `<li>${esc(p.texto)} <span style="color:#5B6B7F">· ${esc(p.modulo)}</span></li>`).join("")}</ul>`
    : ""
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F6F8;font-family:Segoe UI,Arial,sans-serif;color:#0B1220">
<div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #E3E8EE;border-radius:14px;padding:24px">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0F766E;font-weight:600">LIPgo · Informe semanal</p>
<h1 style="margin:0 0 4px;font-size:20px;line-height:1.25">${esc(d.empresaNombre)} · ${esc(d.rango)}</h1>
<p style="margin:0 0 14px;font-size:13px;color:#5B6B7F">${d.enMeta} en meta · ${d.fueraDeMeta} fuera de meta · ${d.criticos} crítico${d.criticos === 1 ? "" : "s"}${d.sinLectura ? ` · ${d.sinLectura} sin lectura` : ""}</p>
<div style="background:#F0FDFA;border:1px solid #CCFBF1;border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.6">
${lectura.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join("")}
<p style="margin:6px 0 0;font-size:11px;color:#5B6B7F">${opts.fuenteLectura === "ia" ? "Lectura redactada por la IA de LIPgo únicamente con las cifras de este informe." : "Lectura automática a partir de las cifras del informe."}</p>
</div>
${tablas}
${pendientes}
${opts.enlace ? `<p style="margin:20px 0 0"><a href="${opts.enlace}" style="display:inline-block;background:#0F766E;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:10px">Abrir LIPgo</a></p>` : ""}
<p style="margin:18px 0 0;font-size:12px;color:#5B6B7F;line-height:1.5">${esc(opts.pie)}</p>
</div></body></html>`
}
