// NÚCLEO PURO del control "un pedido puede salir en varias órdenes de cargue".
// Sin "use server" y sin acceso a la base: aquí viven las reglas y se prueban solas.
//
// Regla de gerencia (2026-10-04): "un pedido creado no puede despachar más de lo que se
// creó; menos sí, porque se permiten entregas parciales" y "un pedido puede salir en
// varias órdenes cuando envían parciales y debes llevar el control del mismo".
//
// El libro auxiliar es `pedidodetalle_ocargue` (SQL 226): una fila por (línea, orden) con
// las unidades que esa orden tomó de esa línea. Lo cargado de una línea es la SUMA de sus
// filas, nunca el último valor escrito. Antes del 2026-10-04 la segunda orden sobrescribía
// a la primera: 59 líneas de 56 pedidos dejaron de contar 18.129 unidades que sí salieron.

/** Una fila del libro auxiliar. */
export interface CargueDeLinea {
  ocargue: string
  unidades: number
  creadoEn?: string | null
}

export const TOLERANCIA = 0.01

const n0 = (v: unknown) => Number(v) || 0

/** Lo cargado de una línea = suma de lo que tomó cada orden. */
export function totalCargado(filas: CargueDeLinea[]): number {
  return filas.reduce((s, f) => s + n0(f.unidades), 0)
}

/** Lo que tomaron las OTRAS órdenes (todas menos la que se está guardando). */
export function cargadoPorOtrasOrdenes(filas: CargueDeLinea[], ocargue: string): number {
  return totalCargado(filas.filter((f) => f.ocargue !== ocargue))
}

/**
 * Cuánto quedaría cargado en la línea al guardar `unidades` en `ocargue`.
 * Reemplaza lo que esa misma orden tenía (volver a guardar la orden no duplica)
 * y SUMA lo de las demás.
 */
export function cargadoTrasGuardar(filas: CargueDeLinea[], ocargue: string, unidades: number): number {
  return cargadoPorOtrasOrdenes(filas, ocargue) + Math.max(0, n0(unidades))
}

/** Cuántas unidades de la línea quedan sin despachar. Nunca negativo. */
export function faltantePorDespachar(pedidas: number, cargadas: number): number {
  return Math.max(0, n0(pedidas) - n0(cargadas))
}

/**
 * ¿Este cargue haría que la línea despache MÁS de lo pedido? Es la regla dura: el pedido
 * es el documento con el que el cliente autoriza, y no se puede cargar por encima.
 */
export function excedeLoPedido(pedidas: number, filas: CargueDeLinea[], ocargue: string, unidades: number): boolean {
  return cargadoTrasGuardar(filas, ocargue, unidades) > n0(pedidas) + TOLERANCIA
}

/**
 * Estado de la línea después de un cargue. `cerrarAunqueFalte` es la decisión manual que
 * toma quien genera la orden cuando sabe que el resto ya no va a salir.
 */
export function estadoDeLinea(pedidas: number, cargadas: number, cerrarAunqueFalte: boolean): "cerrado" | "parcial" {
  if (faltantePorDespachar(pedidas, cargadas) <= TOLERANCIA) return "cerrado"
  return cerrarAunqueFalte ? "cerrado" : "parcial"
}

/** Cómo queda una línea cuando se ELIMINA una de sus órdenes de cargue. */
export interface LineaTrasReverso {
  /** null = la línea vuelve a estar sin cargar (comportamiento de siempre). */
  cargadas: number | null
  /** La orden que queda como referencia de la línea, o null si no queda ninguna. */
  ocargue: string | null
  estado: "cerrado" | "parcial" | null
  /** true = la línea todavía salió en otra orden, así que NO se puede borrar su rastro. */
  quedanOtrasOrdenes: boolean
}

/**
 * Reverso de UNA orden. `filas` son las del libro auxiliar de esa línea ANTES de borrar.
 * Si la línea solo salió en esa orden, queda exactamente como la dejaba el reverso de
 * siempre (todo en nulo). Si salió en varias, conserva lo de las otras y apunta a la más
 * reciente de ellas.
 */
export function lineaTrasReverso(pedidas: number, filas: CargueDeLinea[], ocargueEliminada: string): LineaTrasReverso {
  const otras = filas.filter((f) => f.ocargue !== ocargueEliminada && n0(f.unidades) > 0)
  if (otras.length === 0) return { cargadas: null, ocargue: null, estado: null, quedanOtrasOrdenes: false }
  const cargadas = totalCargado(otras)
  const reciente = [...otras].sort((a, b) => String(b.creadoEn ?? "").localeCompare(String(a.creadoEn ?? "")))[0]
  return {
    cargadas,
    ocargue: reciente.ocargue,
    estado: faltantePorDespachar(pedidas, cargadas) <= TOLERANCIA ? "cerrado" : "parcial",
    quedanOtrasOrdenes: true,
  }
}

/** Resumen por orden para mostrar dentro de un pedido: qué orden se llevó qué. */
export interface OrdenDePedido {
  ocargue: string
  /** Unidades de ese pedido que se llevó esa orden. */
  unidades: number
  /** Líneas del pedido que entraron en esa orden. */
  lineas: number
  fecha: string | null
  placa: string | null
  conductor: string | null
}

/** Agrupa las filas del libro auxiliar de un pedido por orden de cargue. */
export function ordenesDelPedido(
  filas: (CargueDeLinea & { transid: number })[],
  datosOrden: Map<string, { fecha: string | null; placa: string | null; conductor: string | null }>,
): OrdenDePedido[] {
  const m = new Map<string, OrdenDePedido>()
  for (const f of filas) {
    const d = datosOrden.get(f.ocargue)
    const r =
      m.get(f.ocargue) ??
      ({ ocargue: f.ocargue, unidades: 0, lineas: 0, fecha: d?.fecha ?? null, placa: d?.placa ?? null, conductor: d?.conductor ?? null } as OrdenDePedido)
    r.unidades += n0(f.unidades)
    r.lineas += 1
    m.set(f.ocargue, r)
  }
  return [...m.values()].sort((a, b) => String(a.fecha ?? "").localeCompare(String(b.fecha ?? "")) || a.ocargue.localeCompare(b.ocargue))
}

export interface PedidoDeOrden {
  idpedido: number
  /** Unidades de ese pedido que se llevó la orden. */
  unidades: number
  /** Dónde vive el vínculo: el libro (SQL 226), la línea (`pedidosdetalle.ocargue`) o la cabecera. */
  fuente: "libro" | "linea" | "cabecera"
}

/**
 * Los pedidos que atendió UNA orden, mirando los tres sitios donde puede vivir el vínculo:
 *   · el libro auxiliar (`pedidodetalle_ocargue`): cuando un pedido sale en varias órdenes la
 *     línea solo recuerda UNA (`pedidosdetalle.ocargue`), y la otra orden aparecía en la vista
 *     360 como "sin pedido ligado" (7 órdenes de los últimos 14 días, 2 de ID1 y 5 de ID2,
 *     detectado por gerencia el 2026-10-05);
 *   · la línea (`pedidosdetalle.ocargue`), el caso normal antes del libro;
 *   · la cabecera (`pedidoscabecera.ocargue`): en ID3 hay órdenes ligadas solo ahí.
 * Las unidades son las que ESA orden se llevó: las del libro cuando el pedido tiene filas en el
 * libro; si no, las de las líneas que apuntan a la orden; solo cabecera = 0 (no se sabe).
 */
export function pedidosDeLaOrden(
  libro: { idpedido: number; unidades: number }[],
  lineas: { idpedido: number; unidades: number }[],
  cabeceras: number[],
): PedidoDeOrden[] {
  const m = new Map<number, PedidoDeOrden>()
  for (const f of libro) {
    const id = Number(f.idpedido)
    if (!id) continue // fila del libro cuya línea ya no existe: no hay pedido que mostrar
    const r = m.get(id) ?? { idpedido: id, unidades: 0, fuente: "libro" as const }
    r.unidades += n0(f.unidades)
    m.set(id, r)
  }
  for (const f of lineas) {
    const id = Number(f.idpedido)
    if (!id) continue
    const r = m.get(id)
    if (r?.fuente === "libro") continue // el libro ya dijo cuánto se llevó esta orden
    m.set(id, { idpedido: id, unidades: (r?.unidades ?? 0) + n0(f.unidades), fuente: "linea" })
  }
  for (const c of cabeceras) {
    const id = Number(c)
    if (!id || m.has(id)) continue
    m.set(id, { idpedido: id, unidades: 0, fuente: "cabecera" })
  }
  return [...m.values()].sort((a, b) => a.idpedido - b.idpedido)
}
