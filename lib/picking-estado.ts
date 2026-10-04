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

// ───────────────────────── Validación previa (todo o nada de verdad) ─────────────────────────
//
// Gerencia (2026-10-04): "al final del picking está el botón de confirmar verificación, que
// garantiza que se verifique todo y salga, salvo una diferencia por daño".
//
// Para que esa promesa sea TOTAL hay que revisar todas las líneas ANTES de escribir la
// primera. Hasta hoy la revisión de CUARENTENA vivía dentro del bucle, así que se evaluaba
// cuando le llegaba el turno a esa línea: si la estiba bloqueada era la tercera, las dos
// primeras ya habían salido y la confirmación abortaba a medias. Calidad puede bloquear un
// palé DESPUÉS de la asignación y ANTES del picking (344 bloquear / 343 liberar), así que el
// caso es real. Revisando antes, una estiba bloqueada aborta sin que salga nada.

export interface FilaParaValidar extends FilaSalida {
  location?: string | null
  ocargue?: string | null
}

export interface Reparo {
  tipo: "no_existe" | "cuarentena" | "otra_orden"
  id: number
  producto?: string | null
  lote?: string | null
  location?: string | null
  ocargue?: string | null
}

/** ¿Está esa ubicación bloqueada por calidad? Misma regla que usaba el bucle. */
export const esCuarentena = (location: unknown) => /CUARENTENA/i.test(String(location ?? ""))

/**
 * Revisa de una sola vez todas las filas que la confirmación va a tocar.
 * `idsRequeridos` son los ids enviados que deben existir y estar despachables.
 * Devuelve los reparos; si viene vacío, se puede escribir con tranquilidad.
 */
export function validarAntesDeEscribir(filas: FilaParaValidar[], idsRequeridos: number[], ordenCargue?: string): Reparo[] {
  const porId = new Map<number, FilaParaValidar>(filas.map((f) => [Number(f.id), f]))
  const reparos: Reparo[] = []
  for (const id of idsRequeridos) {
    const f = porId.get(Number(id))
    if (!f) {
      reparos.push({ tipo: "no_existe", id: Number(id) })
      continue
    }
    // Ninguna confirmación puede tocar filas de OTRA orden de cargue. Si la pantalla quedó
    // abierta con datos viejos, es mejor detenerse que aprobar el despacho de otro vehículo.
    if (ordenCargue && String(f.ocargue ?? "").trim() !== String(ordenCargue).trim()) {
      reparos.push({ tipo: "otra_orden", id: Number(f.id), producto: f.nombreproducto, ocargue: f.ocargue })
      continue
    }
    // Una fila ya aprobada no se revisa: su despacho ya ocurrió.
    if (esAprobada(f)) continue
    if (esCuarentena(f.location)) {
      reparos.push({ tipo: "cuarentena", id: Number(f.id), producto: f.nombreproducto, lote: f.lote, location: f.location })
    }
  }
  return reparos
}

/** Mensaje único para el trabajador, explicando qué hay que arreglar antes de confirmar. */
export function textoReparos(reparos: Reparo[]): string {
  const cuarentena = reparos.filter((r) => r.tipo === "cuarentena")
  const faltan = reparos.filter((r) => r.tipo === "no_existe")
  const partes: string[] = []
  if (cuarentena.length > 0) {
    const lista = cuarentena.map((r) => `${r.producto ?? "producto"}${r.lote ? ` lote ${r.lote}` : ""}`).join(", ")
    partes.push(
      `${cuarentena.length === 1 ? "Una estiba está" : `${cuarentena.length} estibas están`} BLOQUEADAS en CUARENTENA por calidad y no se pueden despachar: ${lista}. Si calidad ya las aprobó, libéralas con el código 343 en Transacciones de Inventario.`,
    )
  }
  if (faltan.length > 0) {
    partes.push(
      `${faltan.length === 1 ? "Una línea de la asignación ya no existe" : `${faltan.length} líneas de la asignación ya no existen`}. Vuelve a abrir la orden para recargar la lista.`,
    )
  }
  const ajenas = reparos.filter((r) => r.tipo === "otra_orden")
  if (ajenas.length > 0) {
    partes.push(
      `${ajenas.length === 1 ? "Una línea pertenece" : `${ajenas.length} líneas pertenecen`} a otra orden de cargue (${[...new Set(ajenas.map((r) => r.ocargue ?? "sin orden"))].join(", ")}). Cierra la pantalla y vuelve a abrir la orden.`,
    )
  }
  return `No se despachó nada. ${partes.join(" ")}`
}

/** Mensaje de la orden que ya estaba verificada. */
export function textoYaVerificada(d: DecisionConfirmacion): string {
  const f = d.primeraAprobada
  const cuando = String(f?.creado ?? "").slice(0, 16).replace("T", " ")
  const quien = f?.creadopor ? ` por ${f.creadopor}` : ""
  return `Esta orden ya quedó verificada${cuando ? ` el ${cuando}` : ""}${quien}. No se despachó nada de más.`
}
