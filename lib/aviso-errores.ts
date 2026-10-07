// NÚCLEO PURO del aviso diario de errores de la app. Sin base de datos ni correo, para
// poder probarlo solo.
//
// POR QUÉ. El 2026-10-03 se montó el registro de errores (`app_errores`, SQL 217) y el
// 2026-10-04 se comprobó de extremo a extremo que funciona. Pero una tabla de errores que
// nadie lee no sirve de nada: hay que avisar. Esto agrupa lo del día y arma el correo.
//
// Regla: si no hay errores, NO se manda correo. Un aviso diario que casi siempre dice "todo
// bien" se deja de leer, y el día que importa pasa desapercibido.

export interface ErrorRegistrado {
  id: number
  creado: string | null
  origen: string | null
  mensaje: string | null
  modulo: string | null
  url: string | null
  usuario: string | null
  empresa_id: number | null
  version: string | null
  entorno: string | null
}

export interface GrupoError {
  /** Mensaje representativo (el del más reciente). */
  mensaje: string
  modulo: string
  origen: string
  veces: number
  /** Usuarios distintos afectados, sin repetir. */
  usuarios: string[]
  primera: string | null
  ultima: string | null
  versiones: string[]
  url: string | null
}

export interface ResumenErrores {
  total: number
  grupos: GrupoError[]
  /** Cuántos vienen del servidor y cuántos del navegador. */
  porOrigen: { origen: string; veces: number }[]
  usuariosAfectados: number
}

const t = (v: unknown) => String(v ?? "").trim()

/**
 * Normaliza un mensaje para agrupar errores que son el mismo problema: quita ids, fechas,
 * UUID y números largos, que cambian en cada ocurrencia.
 */
export function huellaMensaje(mensaje: unknown): string {
  return t(mensaje)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    // Desfase de despliegue (registros reales del 4 y 5 de octubre): el nombre del archivo JS,
    // el id del despliegue y el id de la acción cambian en cada versión, pero el problema es
    // uno solo. Sin esto, 7 errores salían como 6 "puntos distintos" en el aviso.
    .replace(/\/_next\/static\/chunks\/\S+/g, "<archivo>")
    .replace(/\bdpl_[A-Za-z0-9]+/g, "<despliegue>")
    // Los ids de Server Action de Next tienen 42 hex (comprobado con los registros reales):
    // se acepta un rango amplio para no depender de ese detalle.
    .replace(/"[0-9a-f]{32,64}"/gi, "<accion>")
    .replace(/from module \d+/g, "from module <n>")
    .replace(/\b\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?\b/g, "<fecha>")
    // Se borran los números de CUATRO cifras o más (ids de pedido, de orden, de fila).
    // Los de tres NO: son los códigos de movimiento del inventario (601 salida, 702 salida
    // de material, 101 entrada, 343/344 cuarentena) y los de HTTP, y confundir un 601 con un
    // 702 sería juntar dos problemas distintos en el mismo aviso.
    .replace(/\b\d{4,}\b/g, "<n>")
    .slice(0, 300)
    .toLowerCase()
}

/** Agrupa los errores del período por problema, de más frecuente a menos. */
export function agruparErrores(filas: ErrorRegistrado[]): ResumenErrores {
  const porHuella = new Map<string, GrupoError & { _orden: number }>()
  const usuarios = new Set<string>()
  const origenes = new Map<string, number>()

  for (const f of filas) {
    const huella = `${t(f.modulo)}|${huellaMensaje(f.mensaje)}`
    const u = t(f.usuario)
    if (u) usuarios.add(u)
    const o = t(f.origen) || "desconocido"
    origenes.set(o, (origenes.get(o) ?? 0) + 1)

    const g = porHuella.get(huella)
    if (!g) {
      porHuella.set(huella, {
        mensaje: t(f.mensaje).slice(0, 300),
        modulo: t(f.modulo) || "sin módulo",
        origen: o,
        veces: 1,
        usuarios: u ? [u] : [],
        primera: f.creado ?? null,
        ultima: f.creado ?? null,
        versiones: t(f.version) ? [t(f.version)] : [],
        url: t(f.url) || null,
        _orden: 0,
      })
      continue
    }
    g.veces++
    if (u && !g.usuarios.includes(u)) g.usuarios.push(u)
    const v = t(f.version)
    if (v && !g.versiones.includes(v)) g.versiones.push(v)
    const c = f.creado ?? null
    if (c && (!g.primera || c < g.primera)) g.primera = c
    if (c && (!g.ultima || c > g.ultima)) {
      g.ultima = c
      g.mensaje = t(f.mensaje).slice(0, 300)
      g.url = t(f.url) || g.url
    }
  }

  const grupos = [...porHuella.values()]
    .map(({ _orden, ...g }) => g)
    .sort((a, b) => b.veces - a.veces || a.modulo.localeCompare(b.modulo))

  return {
    total: filas.length,
    grupos,
    porOrigen: [...origenes.entries()].map(([origen, veces]) => ({ origen, veces })).sort((a, b) => b.veces - a.veces),
    usuariosAfectados: usuarios.size,
  }
}

export const hayErroresQueAvisar = (r: ResumenErrores) => r.total > 0

export function asuntoErrores(r: ResumenErrores, fecha: string): string {
  if (r.total === 0) return `LIPgo · sin errores el ${fecha}`
  const n = r.grupos.length
  return `LIPgo · ${r.total} ${r.total === 1 ? "error" : "errores"} en ${n} ${n === 1 ? "punto" : "puntos"} · ${fecha}`
}

const hora = (v: string | null) => (v ? String(v).slice(11, 16) : "—")

/** Texto plano, para el cuerpo alterno y para los registros. */
export function lineasErrores(r: ResumenErrores): string[] {
  const out: string[] = []
  out.push(`${r.total} errores · ${r.grupos.length} puntos distintos · ${r.usuariosAfectados} usuarios afectados`)
  out.push(r.porOrigen.map((o) => `${o.origen}: ${o.veces}`).join(" · "))
  for (const g of r.grupos) {
    out.push(`[${g.veces}x] ${g.modulo} — ${g.mensaje}`)
    out.push(`    de ${hora(g.primera)} a ${hora(g.ultima)}${g.usuarios.length ? ` · ${g.usuarios.join(", ")}` : ""}${g.versiones.length ? ` · version ${g.versiones.join(", ")}` : ""}`)
  }
  return out
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string)

export function htmlErrores(r: ResumenErrores, fecha: string, pie: string): string {
  const filas = r.grupos
    .map(
      (g) => `<tr style="border-top:1px solid #e2e8f0">
  <td style="padding:8px 10px;text-align:right;font-weight:700;color:#0D3B6E">${g.veces}</td>
  <td style="padding:8px 10px">
    <div style="font-weight:600">${esc(g.modulo)}</div>
    <div style="color:#475569;font-size:13px">${esc(g.mensaje)}</div>
    <div style="color:#64748b;font-size:12px">${esc(g.origen)} · de ${hora(g.primera)} a ${hora(g.ultima)}${g.usuarios.length ? ` · ${esc(g.usuarios.join(", "))}` : ""}${g.versiones.length ? ` · versión ${esc(g.versiones.join(", "))}` : ""}</div>
  </td>
</tr>`,
    )
    .join("")

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;color:#0f172a">
  <h2 style="margin:0 0 4px;font-size:18px;color:#0D3B6E">Errores de la app · ${esc(fecha)}</h2>
  <p style="margin:0 0 14px;color:#475569;font-size:14px">
    ${r.total} ${r.total === 1 ? "error" : "errores"} en ${r.grupos.length} ${r.grupos.length === 1 ? "punto" : "puntos"} distintos${r.usuariosAfectados > 0 ? ` · ${r.usuariosAfectados} ${r.usuariosAfectados === 1 ? "usuario" : "usuarios"} afectados` : ""}.
    ${esc(r.porOrigen.map((o) => `${o.origen}: ${o.veces}`).join(" · "))}
  </p>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <thead><tr style="background:#f1f5f9;text-align:left">
      <th style="padding:8px 10px;text-align:right">Veces</th><th style="padding:8px 10px">Qué falló</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <p style="margin:14px 0 0;color:#64748b;font-size:12px">${esc(pie)}</p>
</div>`
}
