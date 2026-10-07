import "server-only"

// Corre las comprobaciones de convergencia (lib/convergencia-checks.ts) y, si algo no cuadra
// o no se pudo comprobar, avisa a gerencia por correo y deja cada hallazgo en app_errores
// (origen "convergencia"), para que también salga en el aviso diario de errores.
//
// Si TODO cuadra, no se manda correo (igual que los demás avisos): un correo que casi siempre
// dice "todo bien" se deja de leer. El resultado completo siempre queda en la respuesta del
// cron y en alerta_envios cuando se envía.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { enviarCorreo } from "@/lib/email"
import { asuntoConvergencia, hayQueAvisar, htmlConvergencia, lineasConvergencia, resumirChecks, type ResumenConvergencia } from "@/lib/convergencia"
import { correrChecks } from "@/lib/convergencia-checks"

const CORREO_GERENCIA = "gerenciageneral@lip-sas.com"
const INDICADOR = "convergencia"
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.lipgo.app"

const fechaLegible = (d: Date) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long" }).format(d)

export interface ResultadoConvergencia {
  fecha: string
  total: number
  /** Comprobaciones que cuadran. (Se llama `cuadran` y no `ok` porque la respuesta del cron ya usa `ok` como estado HTTP.) */
  cuadran: number
  alertas: number
  criticos: number
  sinDatos: number
  enviado: boolean
  motivo?: string
  lineas: string[]
}

export async function revisarYAvisarConvergencia(opts: { forzar?: boolean; simular?: boolean } = {}): Promise<ResultadoConvergencia> {
  const sb: any = await getSupabaseAdminAsSystem()
  const resumen: ResumenConvergencia = resumirChecks(await correrChecks(sb))
  const fecha = fechaLegible(new Date())
  const base: ResultadoConvergencia = {
    fecha,
    total: resumen.total,
    cuadran: resumen.ok,
    alertas: resumen.alertas,
    criticos: resumen.criticos,
    sinDatos: resumen.sinDatos,
    enviado: false,
    lineas: lineasConvergencia(resumen),
  }

  // Cada hallazgo queda en app_errores para que el aviso diario de errores lo muestre también
  // y para tener historial de cuándo empezó a fallar cada cosa. Nunca rompe la revisión.
  if (!opts.simular) {
    for (const c of resumen.checks) {
      if (c.estado === "ok") continue
      await sb
        .from("app_errores")
        .insert({
          origen: "convergencia",
          mensaje: `${c.estado === "sin_datos" ? "SIN COMPROBAR" : c.estado.toUpperCase()} · ${c.titulo}${c.estado === "sin_datos" ? ` · ${c.motivo ?? ""}` : ` · ${c.casos} casos`}`.slice(0, 2000),
          modulo: `convergencia.${c.clave}`.slice(0, 120),
          version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
          entorno: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
          extra: { regla: c.regla, ejemplos: c.ejemplos.slice(0, 10), casos: c.casos },
        })
        .then(
          () => {},
          () => {},
        )
    }
  }

  if (!hayQueAvisar(resumen) && !opts.forzar) return { ...base, motivo: "todo cuadra" }
  if (opts.simular) return { ...base, motivo: "simulación: no se envió" }

  const asunto = hayQueAvisar(resumen) ? asuntoConvergencia(resumen, fecha) : `LIPgo · convergencia: todo cuadra (envío de prueba) · ${fecha}`
  const pie =
    "Cada madrugada se cruzan las cifras entre sí: órdenes de cargue contra salidas de inventario, pedidos contra el libro de órdenes, reservas y saldos. Si todo cuadra, no llega ningún correo."
  const envio = await enviarCorreo({
    to: CORREO_GERENCIA,
    subject: asunto,
    html: htmlConvergencia(resumen, fecha, `${pie} ${BASE_URL}`),
    text: [asunto, ...lineasConvergencia(resumen)].join("\n"),
  })

  await sb
    .from("alerta_envios")
    .insert({
      suscripcion_id: null,
      usuario_id: null,
      correo: CORREO_GERENCIA,
      indicador: INDICADOR,
      empresa_id: null,
      severidad: resumen.criticos > 0 ? "crit" : "warn",
      valor: resumen.criticos + resumen.alertas + resumen.sinDatos,
      meta: 0,
      periodo: new Date().toISOString().slice(0, 10),
      canal: "correo",
      estado: envio.ok ? "enviado" : "error",
      detalle: (envio.ok ? lineasConvergencia(resumen).join(" | ") : (envio.error ?? "")).slice(0, 500),
    })
    .then(
      () => {},
      () => {},
    )

  return { ...base, enviado: envio.ok, motivo: envio.ok ? undefined : envio.error }
}
