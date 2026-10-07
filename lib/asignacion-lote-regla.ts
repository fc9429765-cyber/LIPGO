// LA ORDEN DE CARGUE MANDA. Regla pura, sin base de datos, para poder probarla sola.
//
// Proceso acordado con gerencia (2026-10-07): llega el pedido → con el pedido se genera la
// orden de cargue → la orden llega a Asignación de Lote con SU cantidad → se asigna el lote
// SIN poder modificar la cantidad, y NUNCA por encima → el Picking solo verifica producto,
// cantidad, ubicación y lote para cumplir la asignación. Puede salir MENOS (merma, y queda
// como pendiente), nunca MÁS, y nunca un producto que la orden no incluía.
//
// POR QUÉ ESTO VIVE EN EL SERVIDOR. Hasta el 2026-10-07 la regla se aplicaba solo en el
// navegador y solo contra la cantidad que la pantalla tenía en memoria. Dos incidentes reales
// en ID3, el mismo defecto por lados opuestos:
//   · 30-sep: la asignación de MOL202609309719 se guardó con las líneas de MOL202609309720
//     (número viejo en memoria, canasta nueva). Se blindó el NÚMERO.
//   · 6-oct: la asignación de MOL202610069899 (4 líneas, 330 und) se guardó con la canasta de
//     MOL202610069896 (23 líneas, 1.011 und). Número correcto, canasta vieja: 1.011 unidades
//     salieron DOS VECES de ID3 y la validación del navegador pasó perfecto, porque comparó
//     la canasta de la 9896 contra las cantidades de la 9896.
// La pantalla puede quedar desfasada; el servidor no. Aquí no hay carrera posible.

/** Compara nombres de producto sin que la mayúscula ni los espacios de más cambien el juicio. */
export function normalizarProducto(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
}

const n0 = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Tolerancia para no pelear por centésimas en cantidades decimales. */
const EPS = 0.001

export interface LineaAutorizada {
  /** `detalleoc.producto` */
  producto: string
  /** `detalleoc.cantidad`. Una orden puede repetir el mismo producto en varias líneas: se suman. */
  cantidad: number
}

export interface LineaAsignada {
  producto: string
  cantidad: number
  lote?: string | null
  location?: string | null
  /**
   * "Lote alterno": lote de sustitución que se marca cuando el stock firme se agotó y la línea
   * quedó corta. NO cuenta para el techo de "nunca por encima".
   *
   * POR QUÉ SE EXCLUYE, y no es un descuido. El 2026-10-04 se intentó sumar el alterno al techo
   * y hubo que revertirlo porque bloqueaba cargues legítimos (commit fee073a revertido por
   * 1167bd9). Medido el 2026-10-07 sobre toda la base: existe UN solo movimiento con este
   * status, la orden IND202606226011 de ID5, y ahí firme 150 + alterno 20 pasa de las 150
   * autorizadas. Sumarlo habría rechazado esa asignación.
   * Lo que sí se exige al alterno es que su producto ESTÉ en la orden: un lote de sustitución
   * sustituye un producto de la orden, nunca introduce uno nuevo.
   */
  esAlterno?: boolean
}

export type MotivoRechazo = "fuera_de_la_orden" | "mas_que_la_orden"

export interface DiferenciaAsignacion {
  producto: string
  autorizado: number
  asignado: number
  exceso: number
  motivo: MotivoRechazo
}

export interface ResultadoValidacion {
  ok: boolean
  diferencias: DiferenciaAsignacion[]
  /** Listo para mostrarle al operario. Vacío cuando `ok`. */
  mensaje: string
}

const NUM = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 3 })

/**
 * Suma por producto y confronta. Devuelve ok solo si TODO lo asignado está en la orden y
 * ningún producto supera lo que la orden autorizó. Asignar menos está permitido.
 */
export function validarAsignacionContraOrden(
  autorizadas: LineaAutorizada[],
  asignadas: LineaAsignada[],
): ResultadoValidacion {
  const autorizado = new Map<string, number>()
  for (const l of autorizadas) {
    const k = normalizarProducto(l.producto)
    if (!k) continue
    autorizado.set(k, (autorizado.get(k) ?? 0) + n0(l.cantidad))
  }

  // Dos sumas por producto, a propósito:
  //  · `total` incluye el lote alterno y sirve para saber QUÉ productos se asignaron.
  //  · `firme` excluye el alterno y es la única que se compara contra el techo de la orden.
  const asignado = new Map<string, { total: number; firme: number; nombre: string }>()
  for (const l of asignadas) {
    const k = normalizarProducto(l.producto)
    if (!k) continue
    const prev = asignado.get(k)
    const cant = n0(l.cantidad)
    asignado.set(k, {
      total: (prev?.total ?? 0) + cant,
      firme: (prev?.firme ?? 0) + (l.esAlterno === true ? 0 : cant),
      nombre: prev?.nombre ?? String(l.producto).trim(),
    })
  }

  // Una orden sin detalle no puede autorizar nada. Guardar ahí sería inventar la autorización.
  if (autorizado.size === 0) {
    return {
      ok: false,
      diferencias: [...asignado.entries()].map(([k, v]) => ({
        producto: v.nombre || k,
        autorizado: 0,
        asignado: v.total,
        exceso: v.total,
        motivo: "fuera_de_la_orden" as const,
      })),
      mensaje:
        "Esta orden de cargue no tiene productos autorizados en su detalle, así que no se puede asignar nada contra ella. " +
        "Verifique que eligió la orden correcta y que la orden se generó desde su pedido.",
    }
  }

  const diferencias: DiferenciaAsignacion[] = []
  for (const [k, v] of asignado) {
    const aut = autorizado.get(k)
    // Un producto que la orden no incluye se rechaza SIEMPRE, también si viene como alterno:
    // un lote de sustitución sustituye algo de la orden, no agrega un producto nuevo.
    if (aut === undefined) {
      diferencias.push({ producto: v.nombre || k, autorizado: 0, asignado: v.total, exceso: v.total, motivo: "fuera_de_la_orden" })
      continue
    }
    // El techo se mide contra el FIRME. Ver `esAlterno` arriba para el por qué.
    if (v.firme > aut + EPS) {
      diferencias.push({ producto: v.nombre || k, autorizado: aut, asignado: v.firme, exceso: v.firme - aut, motivo: "mas_que_la_orden" })
    }
  }

  if (diferencias.length === 0) return { ok: true, diferencias: [], mensaje: "" }

  const fuera = diferencias.filter((d) => d.motivo === "fuera_de_la_orden")
  const demas = diferencias.filter((d) => d.motivo === "mas_que_la_orden")
  const partes: string[] = []
  if (fuera.length) {
    partes.push(
      `${fuera.length} producto(s) que la orden NO incluye: ` +
        fuera.map((d) => `${d.producto} (${NUM(d.asignado)})`).join(", "),
    )
  }
  if (demas.length) {
    partes.push(
      `${demas.length} producto(s) por encima de lo autorizado: ` +
        demas.map((d) => `${d.producto} (autoriza ${NUM(d.autorizado)}, asignó ${NUM(d.asignado)})`).join(", "),
    )
  }

  return {
    ok: false,
    diferencias,
    mensaje:
      "No se guardó nada: la asignación no corresponde a esta orden de cargue. " +
      partes.join(". ") +
      ". La orden de cargue manda: puede salir menos que la orden, nunca más y nunca un producto que no esté en ella. " +
      "Si la pantalla quedó con los productos de otra orden, vuelva a elegir la orden y espere a que cargue el inventario.",
  }
}
