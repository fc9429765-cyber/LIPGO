import "server-only"

// Alertas del BSC — evaluación y envío (solo servidor). Lo llama el cron diario
// (/api/cron/alertas-bsc) y la acción "Enviarme una prueba". Reglas puras en
// lib/alertas-bsc.ts; valores en vivo de getIndicadoresValores (misma fuente del BSC,
// del portal y de los dashboards). Tablas: SQL 218.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getIndicadoresValores } from "@/lib/sig-actions"
import { enviarCorreo } from "@/lib/email"
import { KPI_DEFS, kpiSev, pantallaDeIndicador } from "@/lib/kpis-area"
import { debeAvisar, htmlAviso, redactarAviso, type UmbralAlerta } from "@/lib/alertas-bsc"
import { hoyBogotaISO } from "@/lib/periodo-listados"
import { inicioDeMes } from "@/lib/pedidos-estado"
import { etiquetaRango } from "@/lib/periodo-rango"
import { grupoDeModulo } from "@/lib/navegacion"
import { urlDeEstado } from "@/lib/navegacion-url"

export interface Suscripcion {
  id: number
  usuario_id: string
  usuario: string | null
  correo: string
  indicador: string
  empresa_id: number | null
  umbral: UmbralAlerta
  canal: string
  activo: boolean
}

export interface ResultadoEvaluacion {
  evaluadas: number
  enviadas: number
  simuladas: number
  omitidas: { suscripcion: number; indicador: string; razon: string }[]
  errores: { suscripcion: number; indicador: string; error: string }[]
}

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.lipgo.app").replace(/\/$/, "")
const TRANSVERSALES = new Set(["sst", "certificaciones_lip"])

export function enlaceDeIndicador(key: string): string | null {
  const { modulo, grupo } = pantallaDeIndicador(key)
  if (modulo) {
    const g = grupoDeModulo(modulo)
    if (g) return `${BASE_URL}/${urlDeEstado({ group: g, module: modulo })}`
  }
  if (grupo) return `${BASE_URL}/?g=${encodeURIComponent(grupo)}`
  return null
}

async function nombresEmpresas(sb: any): Promise<Map<number, string>> {
  const { data } = await sb.from("empresas").select("id, nombre")
  return new Map((data ?? []).map((e: any) => [Number(e.id), String(e.nombre)]))
}

/**
 * Evalúa las suscripciones activas (todas, o las de un usuario/indicador/proyecto) contra
 * los valores del mes en curso y envía los avisos que correspondan.
 *  - `forzar`: ignora umbral y repetición del día (botón "Enviarme una prueba").
 *  - `simular`: no envía ni registra como enviado; devuelve qué haría.
 */
export async function evaluarYEnviarAlertas(opts: { usuarioId?: string | null; indicador?: string | null; empresaId?: number | null; forzar?: boolean; simular?: boolean } = {}): Promise<ResultadoEvaluacion> {
  const sb: any = await getSupabaseAdminAsSystem()
  const res: ResultadoEvaluacion = { evaluadas: 0, enviadas: 0, simuladas: 0, omitidas: [], errores: [] }
  // El informe semanal usa la misma tabla con indicador 'informe_semanal' y tiene su propio cron.
  let q = sb.from("alerta_suscripciones").select("*").eq("activo", true).neq("indicador", "informe_semanal").order("id")
  if (opts.usuarioId) q = q.eq("usuario_id", opts.usuarioId)
  if (opts.indicador) q = q.eq("indicador", opts.indicador)
  if (opts.empresaId != null) q = q.eq("empresa_id", opts.empresaId)
  const { data: susc, error } = await q
  if (error) throw new Error(`alerta_suscripciones: ${error.message} (¿falta correr el SQL 218?)`)
  const lista: Suscripcion[] = susc ?? []
  if (lista.length === 0) return res

  const hoy = hoyBogotaISO()
  const desde = inicioDeMes(hoy)
  const periodo = etiquetaRango(desde, hoy)
  const empresas = await nombresEmpresas(sb)
  const inicioDia = `${hoy}T00:00:00-05:00`
  const valoresPorScope = new Map<string, Record<string, { valor: number; base?: string }>>()
  const valoresDe = async (scope: number | null) => {
    const k = String(scope ?? "lip")
    if (!valoresPorScope.has(k)) {
      // `fresco`: una alerta nunca debe salir de una caché vencida (ver getIndicadoresValores).
      const r: any = await getIndicadoresValores(scope, desde, hoy, { fresco: true })
      valoresPorScope.set(k, r?.success && r.valores ? r.valores : {})
    }
    return valoresPorScope.get(k)!
  }

  for (const s of lista) {
    res.evaluadas++
    const def = KPI_DEFS[s.indicador]
    if (!def) {
      res.omitidas.push({ suscripcion: s.id, indicador: s.indicador, razon: "indicador desconocido" })
      continue
    }
    if (def.meta == null && !opts.forzar) {
      res.omitidas.push({ suscripcion: s.id, indicador: s.indicador, razon: "indicador informativo (sin meta)" })
      continue
    }
    const { grupo, modulo } = pantallaDeIndicador(s.indicador)
    const g = modulo ? grupoDeModulo(modulo) : grupo
    const scope = g && TRANSVERSALES.has(g) ? null : s.empresa_id
    const valores = await valoresDe(scope)
    const v = valores[s.indicador]
    if (!v || typeof v.valor !== "number" || !Number.isFinite(v.valor)) {
      res.omitidas.push({ suscripcion: s.id, indicador: s.indicador, razon: "sin lectura del indicador" })
      continue
    }
    const sev = kpiSev(def, v.valor)
    if (!opts.forzar && !debeAvisar(sev, s.umbral)) {
      res.omitidas.push({ suscripcion: s.id, indicador: s.indicador, razon: `en rango (${sev})` })
      continue
    }
    if (!opts.forzar) {
      const { count } = await sb.from("alerta_envios").select("id", { count: "exact", head: true }).eq("suscripcion_id", s.id).eq("severidad", sev).eq("estado", "enviado").gte("created_at", inicioDia)
      if ((count ?? 0) > 0) {
        res.omitidas.push({ suscripcion: s.id, indicador: s.indicador, razon: "ya avisado hoy" })
        continue
      }
    }
    const empresaNombre = scope == null ? "LIP (todos los proyectos)" : empresas.get(scope) ?? `ID ${scope}`
    const aviso = redactarAviso(def, v.valor, v.base, empresaNombre, periodo)
    const enlace = enlaceDeIndicador(s.indicador)
    const pie = `Recibes este aviso porque te suscribiste al indicador "${def.nombre}" en LIPgo › Indicadores. Para cambiar el umbral o cancelar, abre el panel Indicadores de la pantalla y toca la campana.${opts.forzar ? " Este es un envío de prueba solicitado por ti." : ""}`
    const fila = { suscripcion_id: s.id, usuario_id: s.usuario_id, correo: s.correo, indicador: s.indicador, empresa_id: s.empresa_id, severidad: opts.forzar ? "prueba" : sev, valor: v.valor, meta: def.meta ?? null, periodo: `${desde}..${hoy}`, canal: "correo" }
    if (opts.simular) {
      res.simuladas++
      continue
    }
    const envio = await enviarCorreo({ to: s.correo, subject: aviso.asunto, html: htmlAviso(aviso, enlace, pie), text: [aviso.titulo, ...aviso.lineas, enlace ?? ""].join("\n") })
    if (envio.ok) {
      res.enviadas++
      await sb.from("alerta_envios").insert({ ...fila, estado: "enviado", detalle: null })
    } else {
      const err = envio.error ?? "Error desconocido al enviar el correo."
      res.errores.push({ suscripcion: s.id, indicador: s.indicador, error: err })
      await sb.from("alerta_envios").insert({ ...fila, estado: "error", detalle: err.slice(0, 500) })
    }
  }
  return res
}
