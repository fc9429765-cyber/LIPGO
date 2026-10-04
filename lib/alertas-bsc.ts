// Alertas del BSC — reglas PURAS (sin Supabase, sin "use server"): cuándo avisar y cómo
// se redacta el aviso. Las usan lib/alertas-bsc-core.ts (cron y pruebas) y las pruebas.

import { formatKpi, kpiSev, type KpiDef, type KpiSev } from "@/lib/kpis-area"

export type UmbralAlerta = "atencion" | "critico"

export const UMBRALES: { valor: UmbralAlerta; etiqueta: string; descripcion: string }[] = [
  { valor: "atencion", etiqueta: "Fuera de meta", descripcion: "Avisa en cuanto el indicador deja de cumplir la meta (amarillo o rojo)." },
  { valor: "critico", etiqueta: "Solo crítico", descripcion: "Avisa solo cuando está muy por debajo de la meta (rojo)." },
]

/** Si un indicador con esa severidad debe avisar según el umbral de la suscripción. */
export function debeAvisar(sev: KpiSev, umbral: UmbralAlerta): boolean {
  if (sev === "good" || sev === "none") return false
  if (umbral === "critico") return sev === "crit"
  return sev === "warn" || sev === "crit"
}

export interface AvisoAlerta {
  asunto: string
  titulo: string
  lineas: string[]
  severidad: KpiSev
}

/** Valor del indicador en formato colombiano (coma decimal, una cifra), con su unidad. */
export function formatearValor(def: KpiDef, valor: number): string {
  if (!Number.isFinite(valor)) return "sin lectura"
  const n = Math.round(valor * 10) / 10
  const txt = n.toLocaleString("es-CO", { maximumFractionDigits: 1 })
  return formatKpi(def, 0).replace(/^0/, txt).replace("%", " %")
}

/** Redacta el aviso de un indicador para un proyecto (texto plano; el HTML se arma encima). */
export function redactarAviso(def: KpiDef, valor: number, base: string | null | undefined, empresaNombre: string, periodo: string): AvisoAlerta {
  const sev = kpiSev(def, valor)
  const meta = def.meta != null ? formatearValor(def, def.meta) : "sin meta"
  const estado = sev === "crit" ? "CRÍTICO" : sev === "warn" ? "fuera de meta" : "en meta"
  const sentido = def.higherBetter === false ? "menor es mejor" : "mayor es mejor"
  return {
    severidad: sev,
    asunto: `LIPgo · ${def.nombre} ${estado} en ${empresaNombre}`,
    titulo: `${def.nombre}: ${formatearValor(def, valor)} frente a meta ${meta}`,
    lineas: [
      `Proyecto: ${empresaNombre}`,
      `Período: ${periodo}`,
      `Valor: ${formatearValor(def, valor)} · Meta: ${meta} (${sentido})`,
      ...(base ? [`Detalle: ${base}`] : []),
      `Estado: ${estado}`,
    ],
  }
}

/** HTML sobrio del correo (sin imágenes, legible en cualquier cliente). */
export function htmlAviso(aviso: AvisoAlerta, enlace: string | null, pie: string): string {
  const color = aviso.severidad === "crit" ? "#991B1B" : aviso.severidad === "warn" ? "#9A3412" : "#166534"
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F6F8;font-family:Segoe UI,Arial,sans-serif;color:#0B1220">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #E3E8EE;border-radius:14px;padding:24px">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0F766E;font-weight:600">LIPgo · Alerta del BSC</p>
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.25;color:${color}">${esc(aviso.titulo)}</h1>
<ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:1.6">${aviso.lineas.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
${enlace ? `<p style="margin:0 0 18px"><a href="${enlace}" style="display:inline-block;background:#0F766E;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:10px">Abrir en LIPgo</a></p>` : ""}
<p style="margin:0;font-size:12px;color:#5B6B7F;line-height:1.5">${esc(pie)}</p>
</div></body></html>`
}
