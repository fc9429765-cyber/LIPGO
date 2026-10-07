import "server-only"

// Lee los errores de app_errores del último día y, si hay alguno, avisa a gerencia por
// correo. El agrupado y el armado del correo son puros y viven en lib/aviso-errores.ts.
//
// POR QUÉ. El 2026-10-03 se montó el registro (`app_errores`, SQL 217) y el 2026-10-04 se
// comprobó de extremo a extremo que funciona. Pero una tabla de errores que nadie lee no
// sirve: si a un coordinador le falla un despacho, alguien tiene que saberlo el mismo día.
//
// Si no hay errores NO se manda correo: un aviso que casi siempre dice "todo bien" se deja
// de leer y el día que importa pasa desapercibido.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { enviarCorreo } from "@/lib/email"
import { agruparErrores, asuntoErrores, hayErroresQueAvisar, htmlErrores, lineasErrores, type ErrorRegistrado, type ResumenErrores } from "@/lib/aviso-errores"

const CORREO_GERENCIA = "gerenciageneral@lip-sas.com"
const INDICADOR = "errores_app"
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.lipgo.app"

const fechaLegible = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long" }).format(new Date(iso))

export interface ResultadoAvisoErrores {
  desde: string
  total: number
  puntos: number
  enviado: boolean
  motivo?: string
  /** Para la respuesta del cron: qué se encontró, sin el correo. */
  lineas: string[]
}

/** Lee los errores desde `desdeISO` (por defecto, las últimas 24 horas). */
export async function leerErrores(desdeISO?: string): Promise<{ desde: string; resumen: ResumenErrores }> {
  const desde = desdeISO ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const sb: any = await getSupabaseAdminAsSystem()
  const filas: ErrorRegistrado[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("app_errores")
      // OJO: la columna de fecha se llama `created_at` (SQL 217). El 2026-10-05 esta consulta
      // decía `creado`, fallaba en silencio y el aviso diario leía "0 errores" mientras había 7
      // reales. Un monitoreo que falla callado es peor que ninguno: por eso ahora, si la
      // lectura falla, se registra como error del propio cron y no se da por "sin errores".
      .select("id, created_at, origen, mensaje, modulo, url, usuario, empresa_id, version, entorno")
      .gte("created_at", desde)
      .order("id", { ascending: true })
      .range(from, from + 999)
    if (error) {
      // NUNCA tratar un fallo de lectura como "sin errores": se lanza, el cron lo registra
      // en app_errores y responde 500, que sí se ve.
      throw new Error(`No se pudo leer app_errores: ${error.message}`)
    }
    filas.push(...((data ?? []) as any[]).map((r) => ({ ...r, creado: r.created_at ?? null }) as ErrorRegistrado))
    if (!data || data.length < 1000) break
  }
  return { desde, resumen: agruparErrores(filas) }
}

/** Revisa y, si hay errores, avisa a gerencia. `forzar` envía aunque no haya (prueba). */
export async function revisarYAvisarErrores(opts: { forzar?: boolean; simular?: boolean; desde?: string } = {}): Promise<ResultadoAvisoErrores> {
  const { desde, resumen } = await leerErrores(opts.desde)
  const base: ResultadoAvisoErrores = {
    desde,
    total: resumen.total,
    puntos: resumen.grupos.length,
    enviado: false,
    lineas: lineasErrores(resumen),
  }
  if (!hayErroresQueAvisar(resumen) && !opts.forzar) return { ...base, motivo: "sin errores" }
  if (opts.simular) return { ...base, motivo: "simulación: no se envió" }

  const fecha = fechaLegible(desde)
  const asunto = hayErroresQueAvisar(resumen) ? asuntoErrores(resumen, fecha) : "LIPgo · Errores: ninguno (envío de prueba)"
  const pie =
    "Se revisa todos los días; si no hay errores, no llega ningún correo. Cada error trae el módulo, la versión desplegada y los usuarios afectados, para poder reproducirlo."
  const envio = await enviarCorreo({
    to: CORREO_GERENCIA,
    subject: asunto,
    html: htmlErrores(resumen, fecha, `${pie} ${BASE_URL}`),
    text: [asunto, ...lineasErrores(resumen)].join("\n"),
  })

  const sb: any = await getSupabaseAdminAsSystem()
  await sb
    .from("alerta_envios")
    .insert({
      suscripcion_id: null,
      usuario_id: null,
      correo: CORREO_GERENCIA,
      indicador: INDICADOR,
      empresa_id: null,
      severidad: resumen.total >= 10 ? "crit" : "warn",
      valor: resumen.total,
      meta: 0,
      periodo: desde.slice(0, 10),
      canal: "correo",
      estado: envio.ok ? "enviado" : "error",
      detalle: (envio.ok ? lineasErrores(resumen).join(" | ") : (envio.error ?? "")).slice(0, 500),
    })
    .then(
      () => {},
      () => {},
    )

  return { ...base, enviado: envio.ok, motivo: envio.ok ? undefined : envio.error }
}
