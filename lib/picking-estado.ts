// NÚCLEO PURO de la confirmación del picking: decidir si una orden ya quedó verificada,
// si hay que reanudar una confirmación que se quedó a medias, o si está sin empezar.
// Sin acceso a la base, para poder probarlo solo.
//
// EL FLUJO (gerencia, 2026-10-04): "la verificación se realiza cuando están haciendo el
// picking; el trabajador valida cada línea, cada producto, y al final confirma; solo hasta
// ese momento cambia el estado de por descontar a aprobado en invtrans". Y: "el trabajador
// no puede verificar una línea y dejar las otras, debe verificar todo de una vez".
//
// POR QUÉ ESTE MÓDULO. La confirmación no es una transacción: es una secuencia de llamadas
// (insertar las salidas por estiba, borrar la fila original, aprobar las alternas, marcar la
// hora). Si se interrumpe a la mitad, la orden queda con unas líneas aprobadas y otras en
// "por descontar". El candado del 4-oct, que responde "ya estaba verificada" al ver UNA
// salida aprobada, convertía ese estado a medias en algo permanente: el reintento decía
// "listo" y las líneas que faltaban no se aprobaban nunca. Esas sobras además bloquean el
// Conteo total del mes, que se niega cuando hay salidas por descontar.
//
// Medido el 2026-10-04: 0 filas "por descontar" en las 32.345 de invtrans y 0 órdenes a
// medias, así que esto cierra un riesgo latente, no un daño existente.

/** Estado en el que la asignación de lotes deja una salida, antes del picking. */
export const STATUS_POR_DESCONTAR = "por descontar"
/** Lote alterno: también está pendiente, pero puede quedar sin usar legítimamente. */
export const STATUS_LOTE_ALTERNO = "Lote alterno"

export interface FilaSalida {
  id: number
  status: string | null
  nombreproducto?: string | null
  lote?: string | null
  cantidad?: number | null
  creado?: string | null
  creadopor?: string | null
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase()

export const esAprobada = (f: FilaSalida) => norm(f.status).startsWith("apr")
export const esPorDescontar = (f: FilaSalida) => norm(f.status) === STATUS_POR_DESCONTAR
export const esLoteAlterno = (f: FilaSalida) => norm(f.status) === norm(STATUS_LOTE_ALTERNO)

export type AccionConfirmacion = "ya_verificada" | "reanudar" | "procesar"

export interface DecisionConfirmacion {
  accion: AccionConfirmacion
  aprobadas: number
  /** Pendientes que SÍ entran en esta confirmación: lo que falta por aprobar. */
  porDescontar: number
  /** Pendientes que NO entran: reservas de la asignación, no son un error. */
  reservas: number
  alternosPendientes: number
  /** La primera salida aprobada, para decirle al trabajador cuándo y quién verificó. */
  primeraAprobada: FilaSalida | null
  /** Lo que falta por aprobar, en texto, para el mensaje. */
  pendientesTexto: string
}

/**
 * Decide qué hacer con una confirmación, a partir de las salidas que la orden tiene HOY.
 *
 *  · `ya_verificada` — hay aprobadas y no falta nada de ESTA confirmación. Se responde ÉXITO
 *    para que el trabajador deje de reintentar (reintentar fue lo que causó el doble despacho).
 *  · `reanudar` — hay aprobadas Y una línea de esta confirmación sigue por descontar: la
 *    anterior se quedó a medias. Se termina lo que falta; NUNCA se responde "ya está".
 *  · `procesar` — no hay nada aprobado: confirmación normal.
 *
 * `idsEnviados` son las filas que el trabajador verificó ahora. Una fila "por descontar"
 * que no esté ahí es una RESERVA de la asignación de lotes (gerencia, 2026-10-04: la
 * asignación deja el producto en stock y separado para que otra orden no lo tome; asignar
 * no es despachar, el que saca del inventario es el picking). No se cuenta como falta.
 */
export function decidirConfirmacion(filas: FilaSalida[], idsEnviados?: Set<number>): DecisionConfirmacion {
  const aprobadas = filas.filter(esAprobada)
  const pendientes = filas.filter(esPorDescontar)
  const propia = (f: FilaSalida) => !idsEnviados || idsEnviados.has(Number(f.id))
  const porDescontar = pendientes.filter(propia)
  const reservas = pendientes.filter((f) => !propia(f))
  const alternos = filas.filter(esLoteAlterno)
  const primeraAprobada =
    [...aprobadas].sort((a, b) => String(a.creado ?? "").localeCompare(String(b.creado ?? "")))[0] ?? null
  const pendientesTexto = porDescontar
    .map((f) => `${f.nombreproducto ?? "producto"}${f.lote ? ` lote ${f.lote}` : ""}${f.cantidad ? ` (${f.cantidad})` : ""}`)
    .join(", ")

  let accion: AccionConfirmacion = "procesar"
  if (aprobadas.length > 0) accion = porDescontar.length > 0 ? "reanudar" : "ya_verificada"

  return {
    accion,
    aprobadas: aprobadas.length,
    porDescontar: porDescontar.length,
    reservas: reservas.length,
    alternosPendientes: alternos.length,
    primeraAprobada,
    pendientesTexto,
  }
}

/**
 * Al reanudar, solo se procesan los items cuya fila TODAVÍA existe: las que ya se
 * procesaron desaparecieron (la división borra la original) o ya están aprobadas.
 */
export function itemsPorProcesar<T extends { id: number; alternoScans?: { alternoId: number }[]; alternoSimple?: { alternoId: number }[] }>(
  items: T[],
  pendientes: Set<number>,
): T[] {
  return items.filter((it) => {
    if (pendientes.has(it.id)) return true
    // La línea principal ya se procesó, pero puede faltar un alterno suyo.
    const ids = [...(it.alternoScans ?? []).map((a) => a.alternoId), ...(it.alternoSimple ?? []).map((a) => a.alternoId)]
    return ids.some((id) => pendientes.has(id))
  })
}

/** Mensaje de la orden que ya estaba verificada. */
export function textoYaVerificada(d: DecisionConfirmacion): string {
  const f = d.primeraAprobada
  const cuando = String(f?.creado ?? "").slice(0, 16).replace("T", " ")
  const quien = f?.creadopor ? ` por ${f.creadopor}` : ""
  return `Esta orden ya quedó verificada${cuando ? ` el ${cuando}` : ""}${quien}. No se despachó nada de más.`
}
