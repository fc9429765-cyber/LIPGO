// Vigilancia de cuentas y permisos sensibles — reglas PURAS (sin servidor, sin base de datos).
//
// Gerencia 2026-10-04: "cada vez que se cree una cuenta de estas yo lo sepa, pues esta
// información sí es solo de gerencia". Esto define QUÉ se considera digno de aviso y cómo se
// redacta; el servidor que lo detecta y lo envía vive en lib/vigilancia-cuentas-core.ts.

/** Permisos que dan acceso a información financiera o al control de los accesos mismos. */
export const PERMISOS_SENSIBLES: Record<string, string> = {
  estadoresultados: "Estado de Resultados",
  gastos: "Gastos (registrar y dashboard)",
  cuadro_facturacion: "Cuadro de Control / Resumen de Facturación",
  ciclo_facturacion: "Ciclo de Facturación",
  prefactura_produccion: "Prefactura de Producción",
  conciliacion_avimol: "Conciliación Avimol",
  cargos_fijos: "Cargos Fijos",
  correccion_ordenes: "Corrección de Órdenes",
  tarifas: "Tarifas",
  nominapersonal: "Nómina de Personal",
  revision_nomina: "Revisión de nómina",
  acumulados_lipgo: "Acumulados LIPgo",
  parafiscales: "Parafiscales y Seguridad Social",
  liquidaciones: "Liquidaciones",
  bonos: "Bonos",
  vacaciones: "Vacaciones",
  gestion_usuarios: "Gestión de Usuarios",
  accesos_usuario: "Accesos de Usuario",
  autorizaciones_clave: "Autorizaciones por clave",
}

export interface CuentaNueva {
  correo: string
  nombre: string | null
  creada: string
  permisos: number
  sensibles: string[]
  /** true si existe en el acceso pero no tiene perfil en la app (no vería módulos, pero puede entrar). */
  sinPerfil: boolean
}

export interface CambioPermiso {
  cuando: string
  /** Quién hizo el cambio (de la bitácora de auditoría). */
  actor: string
  /** Cuenta afectada, si se pudo resolver. */
  afectado: string
  otorgados: string[]
  retirados: string[]
}

export interface Hallazgos {
  desde: string
  cuentasNuevas: CuentaNueva[]
  cambios: CambioPermiso[]
}

export function hayAlgoQueAvisar(h: Hallazgos): boolean {
  return h.cuentasNuevas.length > 0 || h.cambios.length > 0
}

export function asuntoVigilancia(h: Hallazgos): string {
  const partes: string[] = []
  if (h.cuentasNuevas.length) partes.push(`${h.cuentasNuevas.length} cuenta${h.cuentasNuevas.length === 1 ? "" : "s"} nueva${h.cuentasNuevas.length === 1 ? "" : "s"}`)
  if (h.cambios.length) partes.push(`${h.cambios.length} cambio${h.cambios.length === 1 ? "" : "s"} de permisos sensibles`)
  return `LIPgo · Accesos: ${partes.join(" y ")}`
}

/** Resumen en texto plano (también sirve de respaldo si el correo se ve sin formato). */
export function lineasVigilancia(h: Hallazgos): string[] {
  const out: string[] = []
  for (const c of h.cuentasNuevas) {
    const extra = c.sensibles.length ? ` · CON ACCESO A: ${c.sensibles.join(", ")}` : c.permisos === 0 ? " · sin módulos asignados todavía" : ` · ${c.permisos} módulos`
    out.push(`Cuenta nueva: ${c.correo}${c.nombre ? ` (${c.nombre})` : ""} creada el ${c.creada}${extra}${c.sinPerfil ? " · SIN PERFIL en la app" : ""}`)
  }
  for (const c of h.cambios) {
    const g = c.otorgados.length ? `dio acceso a ${c.otorgados.join(", ")}` : ""
    const r = c.retirados.length ? `quitó acceso a ${c.retirados.join(", ")}` : ""
    out.push(`Permisos: ${c.actor} ${[g, r].filter(Boolean).join(" y ")} en la cuenta ${c.afectado} (${c.cuando})`)
  }
  return out
}

export function htmlVigilancia(h: Hallazgos, enlace: string | null, pie: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const bloqueCuentas = h.cuentasNuevas.length
    ? `<p style="margin:18px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#991B1B;font-weight:600">Cuentas nuevas</p>
<table style="width:100%;border-collapse:collapse;border:1px solid #E3E8EE;border-radius:10px;overflow:hidden">
<thead><tr style="background:#F4F6F8;font-size:11px;color:#5B6B7F;text-align:left"><th style="padding:6px 8px">Cuenta</th><th style="padding:6px 8px">Creada</th><th style="padding:6px 8px">Acceso</th></tr></thead>
<tbody>${h.cuentasNuevas
        .map(
          (c) => `<tr>
<td style="padding:6px 8px;border-top:1px solid #EEF2F6;font-size:13px"><b>${esc(c.correo)}</b>${c.nombre ? `<div style="font-size:11px;color:#5B6B7F">${esc(c.nombre)}</div>` : ""}${c.sinPerfil ? `<div style="font-size:11px;color:#9A3412">sin perfil en la app</div>` : ""}</td>
<td style="padding:6px 8px;border-top:1px solid #EEF2F6;font-size:12px;white-space:nowrap">${esc(c.creada)}</td>
<td style="padding:6px 8px;border-top:1px solid #EEF2F6;font-size:12px">${c.sensibles.length ? `<span style="color:#991B1B;font-weight:600">${esc(c.sensibles.join(", "))}</span>` : c.permisos === 0 ? "sin módulos todavía" : `${c.permisos} módulos`}</td>
</tr>`,
        )
        .join("")}</tbody></table>`
    : ""
  const bloqueCambios = h.cambios.length
    ? `<p style="margin:18px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9A3412;font-weight:600">Cambios de permisos sensibles</p>
<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6">${h.cambios
        .map(
          (c) =>
            `<li><b>${esc(c.actor)}</b> ${c.otorgados.length ? `dio acceso a <b style="color:#991B1B">${esc(c.otorgados.join(", "))}</b>` : ""}${c.otorgados.length && c.retirados.length ? " y " : ""}${c.retirados.length ? `quitó acceso a ${esc(c.retirados.join(", "))}` : ""} en la cuenta <b>${esc(c.afectado)}</b> <span style="color:#5B6B7F">(${esc(c.cuando)})</span></li>`,
        )
        .join("")}</ul>`
    : ""
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F6F8;font-family:Segoe UI,Arial,sans-serif;color:#0B1220">
<div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #E3E8EE;border-radius:14px;padding:24px">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0F766E;font-weight:600">LIPgo · Vigilancia de accesos</p>
<h1 style="margin:0 0 4px;font-size:20px;line-height:1.25">${esc(asuntoVigilancia(h).replace("LIPgo · Accesos: ", ""))}</h1>
<p style="margin:0 0 14px;font-size:13px;color:#5B6B7F">Desde ${esc(h.desde)}. Solo se avisa de cuentas nuevas y de permisos sobre información financiera o sobre el control de accesos.</p>
${bloqueCuentas}
${bloqueCambios}
${enlace ? `<p style="margin:20px 0 0"><a href="${enlace}" style="display:inline-block;background:#0F766E;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:10px">Abrir Gestión de Usuarios</a></p>` : ""}
<p style="margin:18px 0 0;font-size:12px;color:#5B6B7F;line-height:1.5">${esc(pie)}</p>
</div></body></html>`
}
