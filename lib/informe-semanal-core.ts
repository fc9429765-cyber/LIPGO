import "server-only"

// Informe semanal de gerencia — armado y envío (solo servidor). Lo llama el cron de los lunes
// (/api/cron/informe-semanal) y el botón "Enviarme ahora" del panel Indicadores. Reglas puras
// en lib/informe-semanal.ts; valores del BSC frescos (getIndicadoresValores con fresco:true,
// la misma fuente del portal y de las alertas); pendientes de getPendientesPorPantalla.
// La lectura en prosa la escribe Claude SOLO con las cifras del informe; si cita una cifra que
// no está en los datos, se descarta y va la lectura determinista ("nada ilustrativo, todo real").

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getIndicadoresValores } from "@/lib/sig-actions"
import { getPendientesPorPantalla } from "@/lib/pendientes-pantalla-actions"
import { enviarCorreo } from "@/lib/email"
import { hoyBogotaISO, restarDiasISO } from "@/lib/periodo-listados"
import { etiquetaRango, lunesDe } from "@/lib/periodo-rango"
import { etiquetaDeModulo } from "@/lib/navegacion"
import { INDICADOR_INFORME, asuntoInforme, construirDatosInforme, htmlInforme, narrativaDeterminista, validarNarrativa, type DatosInforme } from "@/lib/informe-semanal"

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.lipgo.app").replace(/\/$/, "")
const MODEL = "claude-haiku-4-5"

export type ModoInforme = "cerrada" | "en_curso"

/** Semana del informe: la cerrada (lunes a domingo anteriores) o la en curso (lunes a hoy). */
export function semanaDelInforme(hoy: string, modo: ModoInforme) {
  const lunes = lunesDe(hoy)
  if (modo === "en_curso") return { desde: lunes, hasta: hoy, prevDesde: restarDiasISO(lunes, 7), prevHasta: restarDiasISO(lunes, 1) }
  return { desde: restarDiasISO(lunes, 7), hasta: restarDiasISO(lunes, 1), prevDesde: restarDiasISO(lunes, 14), prevHasta: restarDiasISO(lunes, 8) }
}

async function nombreEmpresa(sb: any, empresaId: number): Promise<string> {
  const { data } = await sb.from("empresas").select("nombre").eq("id", empresaId).maybeSingle()
  return data?.nombre ? String(data.nombre) : `ID ${empresaId}`
}

export async function armarInforme(sb: any, empresaId: number, hoy: string, modo: ModoInforme): Promise<DatosInforme> {
  const s = semanaDelInforme(hoy, modo)
  const [nombre, semana, previa, pend] = await Promise.all([
    nombreEmpresa(sb, empresaId),
    getIndicadoresValores(empresaId, s.desde, s.hasta, { fresco: true }).catch(() => null),
    getIndicadoresValores(empresaId, s.prevDesde, s.prevHasta, { fresco: true }).catch(() => null),
    getPendientesPorPantalla(empresaId).catch(() => null),
  ])
  const v = (r: any) => (r?.success && r.valores ? r.valores : {})
  const pendientes = (pend?.success && pend.data ? pend.data : []).map((p) => ({ texto: p.texto, modulo: etiquetaDeModulo(p.modulo), nivel: p.nivel }))
  return construirDatosInforme({
    empresaNombre: nombre,
    rango: etiquetaRango(s.desde, s.hasta),
    rangoPrevio: etiquetaRango(s.prevDesde, s.prevHasta),
    semana: v(semana),
    previa: v(previa),
    pendientes,
  })
}

const SYSTEM_IA = [
  "Eres el analista de gerencia de LIPgo, la plataforma de operación logística de LIP SAS (Colombia).",
  "Recibes un JSON con los indicadores del BSC de un proyecto para una semana, la semana anterior, la meta, el semáforo y los pendientes de hoy.",
  "Escribe en español, para el gerente general de LIP y el gerente del proyecto, una lectura ejecutiva.",
  "Reglas estrictas: usa ÚNICAMENTE las cifras que aparecen en el JSON, tal como vienen escritas; no inventes, no estimes y no recalcules porcentajes ni diferencias.",
  "Prioriza lo crítico, luego lo que retrocedió, luego lo que mejoró. Si un indicador está 'sin lectura', dilo sin especular la causa.",
  "Máximo 6 frases cortas y hasta 3 acciones concretas para esta semana, cada acción empieza con un verbo en infinitivo y va precedida de '- '.",
  "Sin saludos, sin despedidas, sin títulos, sin adjetivos vacíos. Una frase por línea.",
].join(" ")

/** Lectura de la IA validada contra las cifras. null si no hay API key, falla o inventa cifras. */
export async function lecturaIA(d: DatosInforme): Promise<string[] | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const datos = {
    proyecto: d.empresaNombre,
    semana: d.rango,
    semanaAnterior: d.rangoPrevio,
    resumen: { enMeta: d.enMeta, fueraDeMeta: d.fueraDeMeta, criticos: d.criticos, sinLectura: d.sinLectura },
    indicadores: d.filas.map((f) => ({
      area: f.area,
      indicador: f.nombre,
      semana: f.valorTxt,
      semanaAnterior: f.previoTxt,
      meta: f.metaTxt,
      sentido: f.meta == null ? "informativo" : f.menorMejor ? "menor es mejor" : "mayor es mejor",
      estado: f.sev === "crit" ? "crítico" : f.sev === "warn" ? "fuera de meta" : f.sev === "good" ? "en meta" : f.meta == null ? "informativo" : "sin lectura",
      detalle: f.base ?? undefined,
    })),
    pendientesHoy: d.pendientes.map((p) => `${p.texto} (${p.modulo})`),
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: SYSTEM_IA, messages: [{ role: "user", content: JSON.stringify(datos) }] }),
    })
    if (!res.ok) {
      console.error("[informe-semanal] IA", res.status, (await res.text()).slice(0, 200))
      return null
    }
    const j: any = await res.json()
    const texto: string = (j?.content ?? []).map((c: any) => (c?.type === "text" ? c.text : "")).join("\n").trim()
    if (!texto) return null
    const inventada = validarNarrativa(texto, d)
    if (inventada) {
      console.warn(`[informe-semanal] lectura IA descartada: cifra "${inventada}" no está en los datos`)
      return null
    }
    const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean)
    return lineas.length ? lineas.slice(0, 10) : null
  } catch (e: any) {
    console.error("[informe-semanal] IA error:", e?.message ?? e)
    return null
  }
}

export interface ResultadoInformes {
  evaluadas: number
  enviadas: number
  simuladas: number
  omitidas: { suscripcion: number | null; empresa: number; razon: string }[]
  errores: { suscripcion: number | null; empresa: number; error: string }[]
}

async function componer(sb: any, empresaId: number, hoy: string, modo: ModoInforme, cache: Map<number, Promise<{ datos: DatosInforme; lectura: string[]; fuente: "ia" | "determinista" }>>) {
  if (!cache.has(empresaId)) {
    cache.set(
      empresaId,
      (async () => {
        const datos = await armarInforme(sb, empresaId, hoy, modo)
        const ia = await lecturaIA(datos)
        return { datos, lectura: ia ?? narrativaDeterminista(datos), fuente: (ia ? "ia" : "determinista") as "ia" | "determinista" }
      })(),
    )
  }
  return cache.get(empresaId)!
}

/** Envía el informe de un proyecto a un correo (botón "Enviarme ahora" o una suscripción del cron). */
export async function enviarInformeA(opts: { empresaId: number; correo: string; usuarioId?: string | null; suscripcionId?: number | null; modo: ModoInforme; simular?: boolean }): Promise<{ ok: boolean; error?: string; fuente?: "ia" | "determinista"; asunto?: string }> {
  const sb: any = await getSupabaseAdminAsSystem()
  const hoy = hoyBogotaISO()
  const { datos, lectura, fuente } = await componer(sb, opts.empresaId, hoy, opts.modo, new Map())
  const asunto = asuntoInforme(datos)
  if (opts.simular) return { ok: true, fuente, asunto }
  const s = semanaDelInforme(hoy, opts.modo)
  const pie = `Recibes este informe porque activaste "Informe semanal" para ${datos.empresaNombre} en LIPgo › Indicadores. Para cancelarlo, abre el panel Indicadores de cualquier pantalla del proyecto.${opts.modo === "en_curso" ? " Este envío es de la semana en curso, solicitado por ti." : ""}`
  const envio = await enviarCorreo({ to: opts.correo, subject: asunto, html: htmlInforme(datos, lectura, { enlace: BASE_URL, pie, fuenteLectura: fuente }), text: [asunto, ...lectura].join("\n") })
  const fila = { suscripcion_id: opts.suscripcionId ?? null, usuario_id: opts.usuarioId ?? null, correo: opts.correo, indicador: INDICADOR_INFORME, empresa_id: opts.empresaId, severidad: opts.modo === "en_curso" ? "prueba" : "informe", valor: datos.fueraDeMeta, meta: null, periodo: `${s.desde}..${s.hasta}`, canal: "correo" }
  if (envio.ok) {
    await sb.from("alerta_envios").insert({ ...fila, estado: "enviado", detalle: `lectura ${fuente}` })
    return { ok: true, fuente, asunto }
  }
  const err = envio.error ?? "Error desconocido al enviar el correo."
  await sb.from("alerta_envios").insert({ ...fila, estado: "error", detalle: err.slice(0, 500) })
  return { ok: false, error: err, fuente, asunto }
}

/** Cron de los lunes: un informe por suscripción activa (semana cerrada), una vez al día. */
export async function generarYEnviarInformes(opts: { simular?: boolean; forzar?: boolean } = {}): Promise<ResultadoInformes> {
  const sb: any = await getSupabaseAdminAsSystem()
  const res: ResultadoInformes = { evaluadas: 0, enviadas: 0, simuladas: 0, omitidas: [], errores: [] }
  const { data: susc, error } = await sb.from("alerta_suscripciones").select("*").eq("activo", true).eq("indicador", INDICADOR_INFORME).not("empresa_id", "is", null).order("id")
  if (error) throw new Error(`alerta_suscripciones: ${error.message}`)
  const lista: any[] = susc ?? []
  if (lista.length === 0) return res
  const hoy = hoyBogotaISO()
  const inicioDia = `${hoy}T00:00:00-05:00`
  const cache = new Map<number, Promise<{ datos: DatosInforme; lectura: string[]; fuente: "ia" | "determinista" }>>()
  for (const s of lista) {
    res.evaluadas++
    const empresaId = Number(s.empresa_id)
    if (!opts.forzar) {
      const { count } = await sb.from("alerta_envios").select("id", { count: "exact", head: true }).eq("suscripcion_id", s.id).eq("estado", "enviado").gte("created_at", inicioDia)
      if ((count ?? 0) > 0) {
        res.omitidas.push({ suscripcion: s.id, empresa: empresaId, razon: "ya enviado hoy" })
        continue
      }
    }
    try {
      if (opts.simular) {
        await componer(sb, empresaId, hoy, "cerrada", cache)
        res.simuladas++
        continue
      }
      const r = await enviarInformeA({ empresaId, correo: s.correo, usuarioId: s.usuario_id, suscripcionId: s.id, modo: "cerrada" })
      if (r.ok) res.enviadas++
      else res.errores.push({ suscripcion: s.id, empresa: empresaId, error: r.error ?? "error" })
    } catch (e: any) {
      res.errores.push({ suscripcion: s.id, empresa: empresaId, error: e?.message ?? String(e) })
    }
  }
  return res
}
