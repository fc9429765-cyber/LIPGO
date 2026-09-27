// Tipos y constantes de "Movimiento por código" (SIN "use server": un módulo
// server-action solo puede exportar funciones async — patrón del proyecto,
// ver ESTADO_PROYECTO_SIG.md §9).

export interface CatalogoTransaccion {
  codigo: string
  nombre: string
  clase: string | null
  descripcion: string | null
  origen_lipgo: string | null
  afecta_stock: boolean | null
}

// Qué campos habilita cada código (la esencia SAP del rediseño: escribes el
// código y el formulario muestra SOLO lo de ese movimiento).
export interface FieldSet {
  requiereClave: boolean // códigos de corrección → clave del responsable
  origen: "conStock" | "libre" | "cuarentena" | null // cómo se elige producto/lote origen
  destino: "ubicacion" | "loteProductoUbicacion" | "cuarentena" | null
  referencia: "entrada" | "salida" | "reproceso" | "traslado" | "ocargueOpcional" | null // buscar movimiento original
  cantidadContra: "stock" | "reversible" | null
}

export const FIELDSETS: Record<string, FieldSet> = {
  // Movimientos normales (sin clave — igual que el formulario clásico)
  "101": { requiereClave: false, origen: "libre", destino: null, referencia: null, cantidadContra: null },
  "561": { requiereClave: false, origen: "libre", destino: null, referencia: null, cantidadContra: null },
  "653": { requiereClave: false, origen: "libre", destino: null, referencia: "ocargueOpcional", cantidadContra: null },
  "601": { requiereClave: false, origen: "conStock", destino: null, referencia: null, cantidadContra: "stock" },
  "551": { requiereClave: false, origen: "conStock", destino: null, referencia: null, cantidadContra: "stock" },
  "311": { requiereClave: false, origen: "conStock", destino: "ubicacion", referencia: null, cantidadContra: "stock" },
  // Ajustes (sin clave, igual que hoy en el formulario clásico)
  "701": { requiereClave: false, origen: "libre", destino: null, referencia: null, cantidadContra: null },
  "702": { requiereClave: false, origen: "conStock", destino: null, referencia: null, cantidadContra: "stock" },
  // Correcciones (CON clave del responsable)
  "309": { requiereClave: true, origen: "conStock", destino: "loteProductoUbicacion", referencia: null, cantidadContra: "stock" },
  "102": { requiereClave: true, origen: null, destino: null, referencia: "entrada", cantidadContra: "reversible" },
  "602": { requiereClave: true, origen: null, destino: null, referencia: "salida", cantidadContra: "reversible" },
  "552": { requiereClave: true, origen: null, destino: null, referencia: "reproceso", cantidadContra: "reversible" },
  "312": { requiereClave: true, origen: null, destino: null, referencia: "traslado", cantidadContra: "reversible" },
  "344": { requiereClave: true, origen: "conStock", destino: "cuarentena", referencia: null, cantidadContra: "stock" },
  "343": { requiereClave: true, origen: "cuarentena", destino: "ubicacion", referencia: null, cantidadContra: "stock" },
}

export const CODIGOS_CORRECCION = Object.keys(FIELDSETS).filter((c) => FIELDSETS[c].requiereClave)

// ---------------------------------------------------------------------------
// Clasificación para reportes de Kardex/Panel de Inventario (lib/sig-actions.ts:
// getKardexInventario, getMovimientosProducto, getPanelInventarioLIP,
// getCuadreDiario). Esos reportes nacieron ANTES de que existiera esta
// nomenclatura por código y clasifican cada invtrans adivinando por texto de
// `origen`/`tipomov` — heurístico que nunca conoció 309/311/312/344/343 (los
// crea ejecutarTransaccionPorCodigo con origen="transaccion manual", que no
// calza con ningún patrón de texto) y por eso caían al catch-all "ajuste",
// mostrando un ingreso/salida "701/702" que nunca ocurrió. `cod_movimiento` sí
// queda bien guardado en la fila (verificado con datos reales, ID3 PT FIDEO
// 250*24PQ) — el fix es que los reportes lo LEAN en vez de adivinar.
export const CODIGOS_TRASLADO_NETO_CERO = ["309", "311", "312", "344", "343"]

export function esCodigoTrasladoNetoCero(codMovimiento: unknown): boolean {
  return CODIGOS_TRASLADO_NETO_CERO.includes(String(codMovimiento ?? "").trim())
}

/** Nombre + código para mostrar, priorizando el código real de la fila sobre cualquier adivinanza por texto. */
export function nombreMovimientoPorCodigo(codMovimiento: unknown): string | null {
  const cod = String(codMovimiento ?? "").trim()
  if (!cod) return null
  const guia = GUIA_TRANSACCIONES.find((g) => g.codigo === cod)
  return guia ? `${guia.nombre} (${cod})` : `Movimiento (${cod})`
}

export interface MovimientoOriginal {
  id: number
  tipomov: string
  codproducto: string | null
  nombreproducto: string | null
  lote: string | null
  location: string | null
  cantidad: number
  ocargue: string | null
  origen: string | null
  creado: string | null
  creadopor: string | null
  cod_movimiento: string | null
  reversado: number // suma de reversos previos
  reversible: number // cantidad - reversado
}

export interface EjecutarPayload {
  codigo: string
  selectedEmpresaId: number
  clave?: string | null // requerida en códigos de corrección
  motivo?: string | null
  // Origen (movimientos con producto/lote/ubicación directos)
  almacen?: string | null
  location?: string | null
  producto?: string | null
  lote?: string | null
  cantidad?: number
  // Destino (309/311/312/344/343)
  locationDestino?: string | null
  loteDestino?: string | null
  productoDestino?: string | null
  // Referencia (reversos 102/602/552/312 · 653 opcional)
  refInvtransId?: number | null
  ocargueRef?: string | null
  // Interno: solo lo pone `aprobarAjustePendiente` al reejecutar un payload YA
  // aprobado por Gerencia. Nunca lo envía la UI. Ver CODIGOS_REQUIEREN_APROBACION.
  __aprobado?: boolean
}

// Códigos que NO se aplican de inmediato: son salida sin orden de cargue y sin
// ser una categoría reconocida (avería/reproceso = 551, que queda sin cambio).
// Quedan "pendiente" en inv_ajustes_pendientes hasta que Gerencia los apruebe
// con la clave de inv_clave_aprobacion_ajustes (SQL 62, incidente 2026-09-23:
// Descargue duplicado en Cedi Funza + ajuste 702 que lo tapó sin resolverlo).
export const CODIGOS_REQUIEREN_APROBACION = new Set(["601", "702"])

export interface AjustePendiente {
  id: number
  idempresa: number
  codigo: "601" | "702"
  payload: EjecutarPayload
  producto: string | null
  lote: string | null
  location: string | null
  cantidad: number
  motivo: string | null
  solicitado_por: string
  estado: "pendiente" | "aprobado" | "rechazado"
  aprobado_por: string | null
  aprobado_en: string | null
  motivo_rechazo: string | null
  invtrans_ids: number[] | null
  created_at: string
  /** Stock ACTUAL del lote en esa ubicación al listar (lo calcula
   *  getAjustesPendientes): si es menor que `cantidad`, el ajuste ya no aplica
   *  tal cual -- el producto salió por otro movimiento después de pedirlo. */
  stock_actual?: number
}

// ---------------------------------------------------------------------------
// CAPACITACIÓN — fuente ÚNICA de la guía por transacción. La consume:
//   1) La pestaña "Guía" del módulo (para el que pida ayuda en pantalla).
//   2) LIPbot (se inyecta compacta en su system prompt para que direccione
//      cada transacción a quien la vaya a realizar).
// Lenguaje de OPERACIÓN, no técnico (regla de confidencialidad de LIPbot).
// ---------------------------------------------------------------------------

export interface GuiaTransaccion {
  codigo: string
  nombre: string
  cuandoUsar: string
  pasos: string[]
  ejemplo: string
  advertencia?: string
}

export const GUIA_TRANSACCIONES: GuiaTransaccion[] = [
  {
    codigo: "101",
    nombre: "Recepción / Devolución",
    cuandoUsar: "Ingreso manual de mercancía: recepción que no entró por el flujo normal o una devolución interna.",
    pasos: ["Escribe 101", "Elige ubicación y producto (catálogo completo)", "Digita el lote (AAAAMMDD) y la cantidad", "Revisa el resumen y ejecuta"],
    ejemplo: "Llegaron 50 bultos que no quedaron registrados en el descargue → 101 los ingresa al lote y ubicación correctos.",
  },
  {
    codigo: "561",
    nombre: "Inventario inicial",
    cuandoUsar: "Cargar el inventario de apertura de un producto que nunca ha existido en el sistema (montajes, productos nuevos).",
    pasos: ["Escribe 561", "Elige ubicación y producto", "Digita lote y cantidad inicial", "Ejecuta"],
    ejemplo: "Un producto nuevo del cliente entra a operación con 200 unidades ya en bodega → 561 crea su saldo de arranque.",
    advertencia: "No usarlo para corregir saldos de productos que ya se mueven — para eso están 701/702 o los reversos.",
  },
  {
    codigo: "601",
    nombre: "Despacho manual",
    cuandoUsar: "Salida manual que no pasó por una orden de cargue (caso excepcional).",
    pasos: ["Escribe 601", "Elige ubicación, producto y lote CON stock", "Digita la cantidad (no puede superar el stock del lote)", "Ejecuta"],
    ejemplo: "Se entregó producto por una contingencia sin orden en el sistema → 601 registra la salida con su lote real.",
    advertencia: "Los despachos normales SIEMPRE deben salir por la orden de cargue (Asignación de Lotes), no por aquí.",
  },
  {
    codigo: "551",
    nombre: "Merma / Reproceso",
    cuandoUsar: "Producto averiado o enviado a reproceso: sale del inventario como merma.",
    pasos: ["Escribe 551", "Elige ubicación, producto y lote con stock", "Digita la cantidad averiada", "Ejecuta"],
    ejemplo: "12 bultos rotos en manipulación → 551 los saca como merma del lote correcto.",
  },
  {
    codigo: "701",
    nombre: "Sobrante (ajuste +)",
    cuandoUsar: "El conteo físico encontró MÁS producto del que dice el sistema.",
    pasos: ["Escribe 701", "Elige ubicación y producto", "Digita lote y la cantidad sobrante", "Ejecuta"],
    ejemplo: "El conteo cíclico encontró 10 unidades de más → 701 las suma al lote donde aparecieron.",
  },
  {
    codigo: "702",
    nombre: "Faltante (ajuste −)",
    cuandoUsar: "El conteo físico encontró MENOS producto del que dice el sistema.",
    pasos: ["Escribe 702", "Elige ubicación, producto y lote con stock", "Digita la cantidad faltante", "Ejecuta"],
    ejemplo: "Faltan 5 unidades en el conteo → 702 las descuenta del lote donde faltaron.",
  },
  {
    codigo: "311",
    nombre: "Traslado de ubicación",
    cuandoUsar: "Mover producto de una ubicación a otra dentro de la misma bodega. No cambia el total del inventario.",
    pasos: ["Escribe 311", "Elige ubicación origen, producto y lote con stock", "Digita cantidad y la ubicación destino", "Ejecuta"],
    ejemplo: "Reubicar 30 bultos de A6 a A8 → 311 con destino A8.",
  },
  {
    codigo: "653",
    nombre: "Devolución de cliente",
    cuandoUsar: "El cliente devuelve producto que ya se le había despachado (distinto de la recepción 101).",
    pasos: ["Escribe 653", "Elige ubicación, producto, lote y cantidad devuelta", "Si la conoces, referencia la orden de cargue con la que salió", "Ejecuta"],
    ejemplo: "El cliente devuelve 20 bultos del despacho de ayer → 653 los reingresa dejando la referencia de la orden.",
  },
  {
    codigo: "309",
    nombre: "Corrección de lote / reclasificación",
    cuandoUsar: "Se digitó el LOTE equivocado (o el producto o la ubicación) y hay que pasar la cantidad al correcto. No cambia el total.",
    pasos: ["Escribe 309 (pide clave del responsable)", "Elige ORIGEN: ubicación, producto y lote equivocado (con stock)", "Digita el lote correcto (y/o producto/ubicación correctos)", "Cantidad, motivo, clave → ejecuta"],
    ejemplo: "500 unidades quedaron en el lote 20260722 pero eran del 20260724 → 309 las pasa al lote correcto.",
    advertencia: "Es la corrección que antes se hacía directo en la base de datos — ahora queda trazada con quién y por qué.",
  },
  {
    codigo: "102",
    nombre: "Reverso de ingreso",
    cuandoUsar: "Un INGRESO se digitó mal (doble, con cantidad de más, o no debió existir): se anula total o parcialmente.",
    pasos: ["Escribe 102 (pide clave)", "Busca el ingreso original (# de movimiento, producto, lote u orden)", "Elígelo — el sistema muestra cuánto queda reversible", "Cantidad a reversar, motivo, clave → ejecuta"],
    ejemplo: "Se ingresó dos veces la misma producción de 1.000 → 102 reversa el ingreso duplicado completo.",
    advertencia: "Nunca se puede reversar más de lo que entró originalmente (el sistema lo controla).",
  },
  {
    codigo: "602",
    nombre: "Reverso de salida",
    cuandoUsar: "Una SALIDA se digitó mal (doble o con cantidad de más): se anula total o parcialmente y el producto vuelve al lote.",
    pasos: ["Escribe 602 (pide clave)", "Busca la salida original", "Elígela y revisa el reversible", "Cantidad, motivo, clave → ejecuta"],
    ejemplo: "Una orden quedó con la salida digitada dos veces → 602 reversa la duplicada y el lote queda cuadrado.",
  },
  {
    codigo: "552",
    nombre: "Reverso de merma",
    cuandoUsar: "Una merma/reproceso se registró por error: el producto vuelve al inventario.",
    pasos: ["Escribe 552 (pide clave)", "Busca la merma original", "Elígela", "Cantidad, motivo, clave → ejecuta"],
    ejemplo: "Se marcó como avería un producto que estaba bueno → 552 lo devuelve al lote.",
  },
  {
    codigo: "312",
    nombre: "Reverso de traslado",
    cuandoUsar: "Un traslado de ubicación (311) se hizo por error: la cantidad regresa a donde estaba.",
    pasos: ["Escribe 312 (pide clave)", "Busca el traslado original (la entrada a la ubicación destino)", "Elígelo", "Ubicación a la que regresa, motivo, clave → ejecuta"],
    ejemplo: "Se trasladó a V13 lo que debía quedarse en V26 → 312 lo devuelve a V26.",
  },
  {
    codigo: "344",
    nombre: "Bloqueo / cuarentena",
    cuandoUsar: "Retener producto (calidad, vencimiento, revisión) sin sacarlo del inventario: se mueve a la ubicación CUARENTENA.",
    pasos: ["Escribe 344 (pide clave)", "Elige ubicación, producto y lote a retener", "Cantidad, motivo, clave → ejecuta (el destino CUARENTENA es automático)"],
    ejemplo: "Un lote con empaque dudoso queda retenido mientras calidad lo revisa → 344.",
    advertencia: "Requiere que exista una ubicación llamada CUARENTENA en Configuración; si no existe, el sistema lo indica.",
  },
  {
    codigo: "343",
    nombre: "Desbloqueo",
    cuandoUsar: "Liberar producto retenido: regresa de CUARENTENA a una ubicación normal.",
    pasos: ["Escribe 343 (pide clave)", "Elige el producto y lote retenido (la ubicación CUARENTENA es automática)", "Ubicación destino, cantidad, motivo, clave → ejecuta"],
    ejemplo: "Calidad aprobó el lote retenido → 343 lo devuelve a su ubicación de picking.",
  },
]

// Versión compacta para el system prompt de LIPbot (lenguaje de negocio,
// sin nombres técnicos — cumple la regla de confidencialidad del bot).
export function guiaCompactaParaLIPbot(): string {
  const lineas = GUIA_TRANSACCIONES.map((g) => {
    const clave = FIELDSETS[g.codigo]?.requiereClave ? " [requiere clave del responsable + motivo]" : ""
    return `    - ${g.codigo} ${g.nombre}${clave}: ${g.cuandoUsar}`
  }).join("\n")
  return `GUÍA DE TRANSACCIONES DE INVENTARIO (para direccionar al usuario):

    Las transacciones manuales y correcciones de inventario se hacen en: Almacenamiento → "Transacciones de Inventario" → pestaña "Movimiento por código". El usuario escribe el CÓDIGO y el sistema habilita los campos de ese movimiento. La nomenclatura completa está visible al lado derecho de esa pantalla. Se puede trabajar Sin QR (elegir ubicación/producto/lote manualmente) o Con QR (escanear la estiba y los campos se precargan) — conviven porque aún no todas las estibas tienen QR.
${lineas}
    - Los REVERSOS (102/602/552/312) piden buscar y elegir el movimiento original; el sistema muestra cuánto queda reversible y no deja pasar de ahí.
    - Todo movimiento queda registrado con quién lo hizo; las correcciones exigen además motivo y clave del responsable, y quedan en la pestaña "Historial de correcciones" (revisable y exportable).
    - La pestaña "Consulta de movimientos" permite ver cualquier movimiento por rango de fechas (desde–hasta) con exportación a Excel.
    - Si el usuario pregunta CÓMO corregir un lote, anular un ingreso/salida/merma, trasladar, bloquear producto o consultar movimientos: explícale el código correcto con sus pasos y ofrécele abrir el módulo "Transacciones de Inventario" (abrir_submodulo).`
}

export interface CorreccionLogRow {
  id: number
  idempresa: number
  codigo: string
  ref_invtrans_id: number | null
  codproducto: string | null
  producto: string | null
  lote_origen: string | null
  location_origen: string | null
  codproducto_destino: string | null
  producto_destino: string | null
  lote_destino: string | null
  location_destino: string | null
  cantidad: number
  motivo: string | null
  realizado_por: string
  autorizado_por: string | null
  invtrans_ids: number[] | null
  created_at: string
}
