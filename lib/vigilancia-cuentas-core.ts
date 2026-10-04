import "server-only"

// Vigilancia de accesos — detección y envío (solo servidor).
//
// Gerencia 2026-10-04, tras encontrar la cuenta "test@test.com" con 179 módulos (incluido
// Estado de Resultados) creada por alguien y olvidada: "cada vez que se cree una cuenta de
// estas yo lo sepa, pues esta información sí es solo de gerencia".
//
// Avisa de dos cosas, solo a gerencia:
//   1. CUENTAS NUEVAS en el sistema de acceso, vengan de Gestión de Usuarios o de la consola
//      de Supabase (por eso se consulta el sistema de acceso directo y no una tabla de la app:
//      así no hay forma de crear una cuenta sin que aparezca aquí).
//   2. CAMBIOS DE PERMISOS SENSIBLES (financieros o de control de accesos), leídos de la
//      bitácora de auditoría, con quién lo hizo y a quién se lo dio.
//
// Lo corre un cron diario; también se puede pedir a mano. Reglas puras en lib/vigilancia-cuentas.ts.

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { enviarCorreo } from "@/lib/email"
import { PERMISOS_SENSIBLES, asuntoVigilancia, hayAlgoQueAvisar, htmlVigilancia, lineasVigilancia, type CambioPermiso, type CuentaNueva, type Hallazgos } from "@/lib/vigilancia-cuentas"

/** Buzón de gerencia (confirmado por el usuario el 2026-10-04). Las cuentas @lipgo.app no reciben correo. */
const CORREO_GERENCIA = "gerenciageneral@lip-sas.com"
const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://www.lipgo.app").replace(/\/$/, "")
const INDICADOR = "vigilancia_cuentas"

function fechaLegible(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
}

/** Reúne lo ocurrido desde `desdeISO` (por defecto, las últimas 25 horas). */
export async function revisarAccesos(desdeISO?: string): Promise<Hallazgos> {
  const sb: any = await getSupabaseAdminAsSystem()
  const desde = desdeISO ?? new Date(Date.now() - 25 * 3600 * 1000).toISOString()

  // --- 1) Cuentas nuevas en el sistema de acceso ---------------------------------------
  const cuentasNuevas: CuentaNueva[] = []
  try {
    const admin: any = await getSupabaseAdmin()
    const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const usuarios: any[] = lista?.users ?? []
    const recientes = usuarios.filter((u) => u.created_at && u.created_at >= desde)
    if (recientes.length) {
      const ids = recientes.map((u) => u.id)
      const { data: profs } = await sb.from("profiles").select("id, usuario").in("id", ids)
      const { data: perms } = await sb.from("permisos_usuarios").select("*").in("usuario_id", ids)
      const perfilDe = new Map((profs ?? []).map((p: any) => [p.id, p.usuario]))
      const permDe = new Map((perms ?? []).map((p: any) => [p.usuario_id, p]))
      for (const u of recientes) {
        const p: any = permDe.get(u.id)
        const activos = p ? Object.entries(p).filter(([, v]) => v === true).map(([k]) => k) : []
        cuentasNuevas.push({
          correo: String(u.email ?? "(sin correo)"),
          nombre: (perfilDe.get(u.id) as string) ?? null,
          creada: fechaLegible(u.created_at),
          permisos: activos.length,
          sensibles: activos.filter((k) => PERMISOS_SENSIBLES[k]).map((k) => PERMISOS_SENSIBLES[k]),
          sinPerfil: !perfilDe.has(u.id),
        })
      }
    }
  } catch (e: any) {
    console.error("[vigilancia-cuentas] no se pudo leer el sistema de acceso:", e?.message ?? e)
  }

  // --- 2) Cambios de permisos sensibles (bitácora de auditoría) -------------------------
  const cambios: CambioPermiso[] = []
  try {
    const { data: filas } = await sb
      .from("auditoria")
      .select("ts, actor_nombre, operacion, registro_id, antes, despues")
      .eq("tabla", "permisos_usuarios")
      .gte("ts", desde)
      .order("ts", { ascending: false })
      .limit(200)
    // Para nombrar a la cuenta afectada a partir del id de la fila de permisos.
    const idsFila = (filas ?? []).map((f: any) => Number(f.registro_id)).filter((n: number) => Number.isFinite(n))
    const afectadoDe = new Map<number, string>()
    if (idsFila.length) {
      const { data: pu } = await sb.from("permisos_usuarios").select("id, usuario_id").in("id", idsFila)
      const usuarioIds = (pu ?? []).map((r: any) => r.usuario_id)
      const { data: profs } = usuarioIds.length ? await sb.from("profiles").select("id, usuario").in("id", usuarioIds) : { data: [] }
      const nombreDe = new Map((profs ?? []).map((p: any) => [p.id, p.usuario]))
      for (const r of pu ?? []) afectadoDe.set(Number(r.id), (nombreDe.get(r.usuario_id) as string) ?? String(r.usuario_id).slice(0, 8))
    }
    for (const f of filas ?? []) {
      const antes = (f.antes ?? {}) as Record<string, unknown>
      const despues = (f.despues ?? {}) as Record<string, unknown>
      const otorgados: string[] = []
      const retirados: string[] = []
      for (const clave of Object.keys(PERMISOS_SENSIBLES)) {
        const a = antes[clave] === true
        const d = despues[clave] === true
        if (!a && d) otorgados.push(PERMISOS_SENSIBLES[clave])
        if (a && !d) retirados.push(PERMISOS_SENSIBLES[clave])
      }
      if (otorgados.length === 0 && retirados.length === 0) continue
      cambios.push({
        cuando: fechaLegible(f.ts),
        actor: String(f.actor_nombre ?? "sistema"),
        afectado: afectadoDe.get(Number(f.registro_id)) ?? `fila ${f.registro_id}`,
        otorgados,
        retirados,
      })
    }
  } catch (e: any) {
    console.error("[vigilancia-cuentas] no se pudo leer la bitácora:", e?.message ?? e)
  }

  return { desde: fechaLegible(desde), cuentasNuevas, cambios }
}

export interface ResultadoVigilancia {
  revisadoDesde: string
  cuentasNuevas: number
  cambios: number
  enviado: boolean
  motivo?: string
}

/** Revisa y, si hay algo, avisa a gerencia por correo. `forzar` envía aunque no haya nada (prueba). */
export async function revisarYAvisar(opts: { forzar?: boolean; simular?: boolean } = {}): Promise<ResultadoVigilancia> {
  const h = await revisarAccesos()
  const base: ResultadoVigilancia = { revisadoDesde: h.desde, cuentasNuevas: h.cuentasNuevas.length, cambios: h.cambios.length, enviado: false }
  if (!hayAlgoQueAvisar(h) && !opts.forzar) return { ...base, motivo: "sin novedades" }
  if (opts.simular) return { ...base, motivo: "simulación: no se envió" }

  const asunto = hayAlgoQueAvisar(h) ? asuntoVigilancia(h) : "LIPgo · Accesos: sin novedades (envío de prueba)"
  const pie = "Recibes este aviso porque la información de accesos y permisos financieros es solo de gerencia. Se revisa todos los días; si no hay cuentas nuevas ni cambios sensibles, no llega ningún correo."
  const envio = await enviarCorreo({
    to: CORREO_GERENCIA,
    subject: asunto,
    html: htmlVigilancia(h, `${BASE_URL}/?g=configuracion`, pie),
    text: [asunto, ...lineasVigilancia(h)].join("\n"),
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
      severidad: h.cuentasNuevas.some((c) => c.sensibles.length) || h.cambios.some((c) => c.otorgados.length) ? "crit" : "warn",
      valor: h.cuentasNuevas.length + h.cambios.length,
      meta: 0,
      periodo: h.desde,
      canal: "correo",
      estado: envio.ok ? "enviado" : "error",
      detalle: envio.ok ? lineasVigilancia(h).join(" | ").slice(0, 500) : (envio.error ?? "").slice(0, 500),
    })
    .then(() => {}, () => {})
  return { ...base, enviado: envio.ok, motivo: envio.ok ? undefined : envio.error }
}
