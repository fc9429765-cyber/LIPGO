"use server"

// Cuadro de Mando de Facturación (pestaña dentro de Solicitar Facturas).
// FUENTE DE VERDAD: las órdenes de servicio procesadas (cabeceraoc con fincargue
// y facturar != false). Se cruzan con lo que YA se facturó (estadofactura) para
// garantizar que todo lo procesado se facture — y detectar lo que quedó sin gestionar.
// El valor a facturar por OWNER sale de la vista `facturacion` (tarifa × toneladas,
// misma fuente que la facturación real). El cobro de cartera (que el cliente pague)
// es el paso siguiente y NO se cruza aquí.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { segundoFactorPendiente } from "@/lib/seguridad-servidor"
import { esPlacaDistribucion, cargarPlacasDistribucion, ownerDeLinea, esVehiculoPropioAgrupable } from "@/lib/distribucion-placas"
import { PLACAS_EXCLUIDAS_FACTURAS } from "@/lib/facturas-exclusiones"
import { getConciliacionAvimol } from "@/lib/conciliacion-avimol-actions"
import {
  produccionDelProyecto,
  vigenciaProduccion,
  separarFiltroOperaciones,
  serviciosAdicionalesDelProyecto,
  CONCEPTO_HORA_EXTRA,
  CONCEPTO_TURNO,
  OP_PRODUCCION,
} from "@/lib/facturacion-produccion-conceptos"
import { calcularServiciosAdicionalesIndupan } from "@/lib/servicios-adicionales-indupan-actions"
import {
  medioPagoEsperado,
  medioPagoInconsistente,
  proyectoConReglaMedioPago,
  type MedioPago,
} from "@/lib/facturacion-medio-pago"
import { cargueSoloPlacaPropia } from "@/lib/facturacion-cargue-propio"
import { facturadoAOwner, esProductoPorUnidad } from "@/lib/facturacion-billed-party"

export type CategoriaFactura = "facturado" | "en_proceso" | "sin_gestionar"

/**
 * Unidad en la que se cobra una línea. La columna de cantidad del documento es
 * una sola, así que sin esto las horas y los turnos se sumarían al tonelaje.
 *   "t" = toneladas · "h" = horas extra · "turno" = personas-turno · "u" = unidad
 */
export type UnidadCobro = "t" | "h" | "turno" | "u"

// Cantidad real (detalleoc.cantidad) de las líneas por UNIDAD (ver
// esProductoPorUnidad) de un lote de órdenes. Se consulta aparte porque la
// vista `facturacion` no expone `cantidad` en su salida — solo toneladas.
// Clave `${numeroorden}|||${producto}` (un mismo número de orden puede traer
// más de un producto).
async function cantidadesPorUnidad(
  sb: any,
  pares: { numeroorden: string; producto: string | null }[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const numeros = [...new Set(pares.map((p) => p.numeroorden).filter(Boolean))]
  if (!numeros.length) return map
  for (let i = 0; i < numeros.length; i += 200) {
    const chunk = numeros.slice(i, i + 200)
    const { data } = await sb.from("detalleoc").select("numeroorden, producto, cantidad").in("numeroorden", chunk)
    for (const d of data || []) {
      const k = `${String(d.numeroorden || "").trim()}|||${String(d.producto || "").trim()}`
      map.set(k, (map.get(k) || 0) + num(d.cantidad))
    }
  }
  return map
}

// Determinante REAL de "¿se facturó?": existe la FACTURA DE SIIGO (`facturasiigo`).
// Sin factura Siigo → NO facturado (verde), aunque el estado sea "Factura solicitada"
// (eso es solo el trámite del coordinador → ámbar). Con factura Siigo → facturado (rojo).
function categoriaDeFactura(
  facturasiigo: string | null | undefined,
  estado: string | null | undefined,
): CategoriaFactura {
  if (String(facturasiigo ?? "").trim() !== "") return "facturado"
  const e = String(estado ?? "").trim()
  if (e !== "" && !/pendiente/i.test(e)) return "en_proceso" // solicitada, sin Siigo aún
  return "sin_gestionar" // por facturar
}

export interface ControlFacturaFila {
  numeroorden: string
  fecha: string | null
  placa: string | null
  tiquete: string | null
  tipooperacion: string | null
  cliente: string | null
  /** Producto de la primera línea de detalle de la orden×owner (representativo;
   *  si la orden mezcla productos para el mismo owner, no se desglosan aparte). */
  producto: string | null
  owner: string
  /** Quién mueve la carga. En Avimol determina la condición de pago. */
  transporte: string | null
  mediopago: string | null
  /** Lo que le corresponde a ese transporte (null si el proyecto no tiene regla). */
  medioPagoEsperado: MedioPago | null
  /** El medio de pago registrado contradice la regla del transporte. */
  medioPagoInconsistente: boolean
  toneladas: number // CANTIDAD facturable: peso báscula (id 1/2), peso orden/detalle (id 3/4) o UNIDADES si `unidad` = "u"
  fuente_peso: "bascula" | "orden"
  tarifa: number | null
  valor_a_facturar: number // total = cantidad × tarifa
  sin_tarifa: boolean
  /** true = esta línea SÍ tiene tarifa configurada, pero no se factura por
   *  tonelada porque va cubierta por el fijo mensual (placa propia Avimol) --
   *  `tarifa` queda null y `valor_a_facturar` en 0 A PROPÓSITO. Sin esta bandera,
   *  la UI no puede distinguir "cubierto por fijo" de "sin tarifa real". */
  cubierto_por_fijo: boolean
  estadofactura: string | null
  categoria: CategoriaFactura
  valorpago: number | null
  /** Unidad de `toneladas`. "u" = producto que se cobra por unidad (ver
   *  esProductoPorUnidad), no por peso — la báscula no le aplica. */
  unidad: UnidadCobro
}

export interface ResumenOwner {
  owner: string
  operacion: string // separa Cargue / Descargue / Distribucion dentro del owner
  ordenes: number
  toneladas: number
  valor_a_facturar: number
  val_facturado: number
  val_en_proceso: number
  val_sin_gestionar: number
  /** Dónde suma. "produccion" = concepto de producción del proyecto. Ver
   *  lib/facturacion-produccion-conceptos.ts. */
  bloque: "operacion" | "produccion"
  /** Unidad de `toneladas`: "h" en las horas extra. */
  unidad: UnidadCobro
  /** Transporte del grupo. Solo se separa por transporte en los proyectos con
   *  regla de medio de pago (hoy Avimol); en los demás va null. */
  transporte: string | null
  /** Condición de pago que le corresponde a ese transporte. */
  medioPagoEsperado: MedioPago | null
  /** Órdenes del grupo cuyo medio de pago contradice la regla. */
  ordenesInconsistentes: number
}

export interface ControlFacturacion {
  filas: ControlFacturaFila[]
  porOwner: ResumenOwner[]
  totales: {
    ordenes: number
    toneladas: number
    valor_a_facturar: number
    val_facturado: number
    val_en_proceso: number
    val_sin_gestionar: number
    ordenes_sin_gestionar: number
    ordenes_sin_tarifa: number
    /** Órdenes cuyo medio de pago contradice la regla del transporte. */
    ordenes_medio_pago: number
    /** Cuánto del valor a facturar es PRODUCCIÓN. Se muestra aparte porque no
     *  tiene semáforo: no hay orden ni factura Siigo detrás, así que meterlo en
     *  "sin gestionar" dispararía una alarma falsa. */
    val_produccion: number
  }
  operaciones: string[] // operaciones REALES del proyecto (para el filtro), sin depender del filtro aplicado
  /** Explicación y estado de la producción del proyecto, para la pestaña de resumen. */
  produccionNota: string | null
  produccionAviso: string | null
  produccionAlertas: string[]
}

export interface FiltrosControl {
  desde?: string | null
  hasta?: string | null
  owner?: string | null
  tipooperaciones?: string[] | null // multi-selección de operaciones (vacío/null = todas)
  categoria?: CategoriaFactura | null
  cliente?: string | null
  placa?: string | null
}

const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

// Peso de báscula del tiquete para el DESCARGUE de cedis (id3/4) = FUENTE DE VERDAD.
// Se NORMALIZA a TONELADAS (la unidad estándar del sistema): el campo `pesovascula`
// viene capturado a mano por el coordinador y a veces está en KILOS (~34000) en vez
// de toneladas (~34); si es ~1000× el detalle, se divide entre 1000. Guarda de
// seguridad: si tras normalizar sigue absurdo vs el detalle (dato corrupto), se
// devuelve 0 para caer al peso del detalle (nunca facturar un valor disparatado).
function basculaTiqueteDescargue(pesovascula: number, detalle: number): number {
  if (pesovascula <= 0) return 0
  let p = pesovascula
  if (detalle > 0 && p / detalle > 50) p = p / 1000 // venía en kilos → toneladas
  if (detalle > 0) {
    const ratio = p / detalle
    if (ratio < 0.1 || ratio > 10) return 0 // corrupto → usar detalle
  }
  return p
}

export type Servicio =
  | "Cargue/Descargue propio"
  | "Cargue recoge en bodega"
  | "Descargue"
  | "Susanita"

// Clasifica una orden en el SERVICIO de la prefactura (mapeo confirmado):
//   · Susanita           = cliente Tostaditos Susanita (cualquier operación).
//   · Descargue          = operación Descargue.
//   · Propio             = la PLACA DE DISTRIBUCIÓN del proyecto (vehículo propio),
//                          operaciones Cargue/Distribución.
//   · Recoge en bodega   = Cargue con transporte TERCEROS (el cliente recoge).
function servicioDe(
  empresa: number,
  operacion: string | null,
  transporte: string | null,
  cliente: string | null,
  placa: string | null,
): Servicio {
  const op = String(operacion ?? "").trim().toLowerCase()
  const tr = String(transporte ?? "").trim().toUpperCase()
  const cl = String(cliente ?? "").toUpperCase()
  // Susanita se identifica por el TRANSPORTE "SUSANITA" (el cliente suele venir vacío)
  // o por el nombre del cliente. La vista ya le pone owner=AVIMOL y tarifa 31.544.
  if (cl.includes("SUSANITA") || tr === "SUSANITA") return "Susanita"
  // La PLACA DE DISTRIBUCIÓN (vehículo propio) manda: "Cargue Y Descargue propio"
  // agrupa todas sus operaciones (cargue, distribución y descargue).
  if (esPlacaDistribucion(empresa, placa)) return "Cargue/Descargue propio"
  if (op === "descargue") return "Descargue"
  if (tr === "TERCEROS") return "Cargue recoge en bodega"
  return "Cargue recoge en bodega" // fallback (cargue de tercero)
}

// Tarifas de una empresa POR (operación, OWNER, SUBCATEGORÍA de producto), leídas de
// `tarifasoperacion`. La tarifa varía por owner (empresafactura) Y por producto/subcategoría
// (ej. en Avimol Cargue de PT=15.099 y de sub-producto Mogolla=19.416; en Funza Cargue
// Molinos=17.318 vs AVIMOL/Indupan=14.844). Todo sale de la tabla, sin hardcodear.
export interface TarifasEmpresa {
  exact: Map<string, number | null> // `${op}|||${ownerK}|||${subcatK}` → tarifa (null = ambiguo, ver setUnanime)
  porOpSubcat: Map<string, number | null> // `${op}|||${subcatK}` → misma tarifa sin importar owner (ej. ID2: un solo owner real, "Terceros/Zamudio" deben cobrar igual)
  porOpOwner: Map<string, number | null> // `${op}|||${ownerK}` → fallback si no hay subcat
  porOp: Map<string, number | null> // `${op}` → fallback general
  susanita: number
}

// Normaliza un nombre de owner/empresafactura para casar la vista con tarifasoperacion.
function ownerKey(s: string | null | undefined): string {
  return String(s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// La vista `facturacion` reporta el owner de un producto propio de ID1 como
// "INDUPAN" (nombre corto, mapeado desde productos.id_empresa), pero
// `tarifasoperacion.empresafactura` usa el nombre comercial "Harinera
// Indupan" -- son la MISMA empresa facturadora, pero como texto NUNCA
// calzaban. Sin este alias, cualquier línea de Cargue/Descargue/Distribución
// de producto propio de INDUPAN no encontraba tarifa exacta NI por
// (operación+owner) y caía al fallback global `porOp` (el máximo de
// CUALQUIER owner para esa operación) -- confirmado con datos reales
// 2026-09-08: 773 líneas de Cargue "INDUPAN|Producto Terminado" facturando a
// $18.400 (tarifa real de Mogolla, el máximo del proyecto) en vez de su
// tarifa real, $12.650.
const OWNER_ALIAS: Record<string, string> = { INDUPAN: "HARINERA INDUPAN" }
function ownerKeyFactura(s: string | null | undefined): string {
  const k = ownerKey(s)
  return OWNER_ALIAS[k] || k
}

// Normaliza la SUBCATEGORÍA a la categoría de tarifa. Los SUB-PRODUCTOS (Mogolla,
// Salvado, Harina de Tercera) comparten la misma tarifa "Mogolla Kg." (confirmado por
// el usuario); lo demás (Producto Terminado, etc.) queda con su nombre normalizado.
function subcatKey(s: string | null | undefined): string {
  const k = ownerKey(s)
  if (k.includes("MOGOLLA") || k.includes("SALVADO") || k.includes("TERCERA")) return "MOGOLLA KG."
  return k
}

// EMPAQUE (Papel, Polipropileno): no tiene tarifa propia en `tarifasoperacion` --
// confirmado por el usuario 2026-09-05, solo suma PESO a la orden, cobra la MISMA
// tarifa del producto real que empaca (nunca el fallback "tarifa más alta").
function esEmpaque(s: string | null | undefined): boolean {
  const k = subcatKey(s)
  return k === "PAPEL" || k === "POLIPROPILENO" || k.includes("EMPAQUE")
}

async function tarifasDeEmpresa(sb: any, idempresa: number): Promise<TarifasEmpresa> {
  const t: TarifasEmpresa = { exact: new Map(), porOpSubcat: new Map(), porOpOwner: new Map(), porOp: new Map(), susanita: 0 }
  // Si dos filas de tarifasoperacion caen en la MISMA llave con valores
  // DISTINTOS, no hay forma segura de adivinar cuál aplica -- se marca la
  // llave como AMBIGUA (null) en vez de tomar el máximo a ciegas (ese
  // Math.max silencioso fue justo lo que facturó Cargue de Producto
  // Terminado de ID1 a la tarifa de Mogolla, ver
  // lipgo-tarifa-indupan-mogolla-fallback). Una llave ambigua nunca se usa
  // como tarifa: lookupTarifa cae al siguiente nivel (?? la ignora igual que
  // "no encontrada"), y si TODOS los niveles son ambiguos/vacíos devuelve 0
  // -- visible como "sin tarifa", nunca un número plausible pero incorrecto.
  // Cuando la llave tiene un SOLO valor real (el caso normal, ej. una sola
  // tarifa de Tolva para todo el proyecto) el resultado es idéntico a antes.
  const setUnanime = (m: Map<string, number | null>, k: string, v: number) => {
    if (!m.has(k)) { m.set(k, v); return }
    if (m.get(k) !== v) m.set(k, null)
  }
  const { data: tar } = await sb
    .from("tarifasoperacion")
    .select("operacion, empresafactura, producto, tarifa")
    .eq("empresaid", idempresa)
  for (const r of tar || []) {
    const op = String(r.operacion ?? "").trim().toLowerCase()
    const owner = ownerKeyFactura(r.empresafactura)
    const subcat = subcatKey(r.producto) // el JOIN de la vista es t.producto = subcategoría del producto
    const v = num(r.tarifa)
    if (!op || v <= 0) continue
    // Descargue SUSANITA es una tarifa especial por cliente, no por owner/producto.
    if (op === "descargue" && owner === "SUSANITA") { t.susanita = Math.max(t.susanita, v); continue }
    setUnanime(t.exact, `${op}|||${owner}|||${subcat}`, v)
    // `porOpSubcat` ignora el owner a propósito: cuando un proyecto solo tiene
    // UN owner real configurado (ej. ID2 = AVIMOL), el owner del PRODUCTO que
    // trae la vista puede venir distinto (Molinos del Atlántico, o remapeado a
    // Terceros/Zamudio por transporte) sin que eso cambie la tarifa -- "es la
    // misma tarifa" (confirmado por el usuario 2026-09-08). Si el proyecto SÍ
    // tiene tarifas distintas por owner (ej. ID3: Molinos $17.318 vs AVIMOL
    // $14.844), esta llave queda ambigua y no se usa -- no se adivina.
    setUnanime(t.porOpSubcat, `${op}|||${subcat}`, v)
    setUnanime(t.porOpOwner, `${op}|||${owner}`, v)
    setUnanime(t.porOp, op, v)
  }
  return t
}

// Tarifa por (operación, owner, subcategoría) con fallback: exacta → (op+producto,
// sin owner) → (op+owner, sin producto) → (op). Cada nivel solo se usa si es
// UNÁNIME para esa llave (ver setUnanime) -- nunca se adivina entre valores
// reales distintos.
function lookupTarifa(operacion: string | null, owner: string, subcategoria: string | null, t: TarifasEmpresa): number {
  const op = String(operacion ?? "").trim().toLowerCase()
  const ok = ownerKeyFactura(owner)
  const sk = subcatKey(subcategoria)
  return (
    t.exact.get(`${op}|||${ok}|||${sk}`) ??
    t.porOpSubcat.get(`${op}|||${sk}`) ??
    t.porOpOwner.get(`${op}|||${ok}`) ??
    t.porOp.get(op) ??
    0
  )
}

// Tarifa de UNA línea por (operación REAL, OWNER, SUBCATEGORÍA del producto), todo desde la tabla:
//   · Susanita (cliente/transporte SUSANITA) → Descargue SUSANITA.
//   · Recoge en bodega SOLO en cedis (Cargue + transporte TERCEROS, placa no propia) → tarifa de DESCARGUE.
//   · Todo lo demás (Cargue/Descargue/Distribucion/Tolva…) → tarifa de SU operación, por owner y subcategoría.
function tarifaDeServicio(
  idempresa: number,
  operacion: string | null,
  transporte: string | null,
  cliente: string | null,
  placa: string | null,
  owner: string,
  subcategoria: string | null,
  tarifas: TarifasEmpresa,
): number {
  const op = String(operacion ?? "").trim().toLowerCase()
  const tr = String(transporte ?? "").trim().toUpperCase()
  const cl = String(cliente ?? "").toUpperCase()
  if (cl.includes("SUSANITA") || tr === "SUSANITA") return tarifas.susanita || lookupTarifa("descargue", owner, subcategoria, tarifas)
  // "Recoge en bodega" (Cargue TERCEROS cobrado a tarifa de DESCARGUE) es regla SOLO de
  // Medellín (id4). En Funza (id3) y demás, un Cargue usa la tarifa de CARGUE normal.
  if (idempresa === 4 && op === "cargue" && tr === "TERCEROS" && !esPlacaDistribucion(idempresa, placa)) {
    return lookupTarifa("descargue", owner, subcategoria, tarifas) // recoge en bodega (Medellín)
  }
  return lookupTarifa(op, owner, subcategoria, tarifas)
}

export interface PrefacturaLinea {
  fechaorden: string | null
  fechacargue: string | null
  cliente: string | null
  numeroorden: string
  tiquete: string | null
  placa: string | null
  producto: string | null
  pesobascula: number
  toneladas: number
  owner: string
  subcategoria: string | null
  idempresa: number
  transporte: string | null
  tipooperacion: string | null
  /** Agrupador del RESUMEN (y su detalle). Igual a `tipooperacion`, SALVO en el
   *  vehículo propio con owner forzado (ver OWNER_DE_PLACA_PROPIA/esPlacaDistribucion):
   *  su Cargue y su Distribución se unifican en un solo grupo, porque se facturan
   *  juntos a un único cliente con tarifa propia — el resto de cargues (ej. "cliente
   *  recoge", terceros) NO entra aquí y sigue por operación como siempre. */
  grupoResumen: string
  tarifa: string | number | null
  valor_a_facturar: number
  servicio: string
  tarifaServicio: number // tarifa REAL del servicio (la que factura la prefactura)
  valorServicio: number // toneladas × tarifaServicio (para que el soporte cuadre con el resumen)
  estadofactura: string | null
  categoria: CategoriaFactura // semáforo: sin_gestionar=por facturar · en_proceso · facturado
  /** Medio de pago de la orden (Contado/Crédito) -- para distinguir, dentro
   *  de "en_proceso", lo que el Coordinador validó como CRÉDITO real (ver
   *  valorListoParaAnexo) de los ~casos de Contado que por error de flujo
   *  también quedan en "CF - Factura solicitada". */
  mediopago: string | null
  /** Unidad de `toneladas`/`valorServicio`. "u" = por unidad (ver esProductoPorUnidad). */
  unidad: UnidadCobro
}
export interface PrefacturaResumen {
  owner: string
  operacion: string // TIPO DE OPERACIÓN (Cargue / Descargue / Distribucion)
  toneladas: number
  tarifa: number // tarifa efectiva del grupo (valor/ton), refleja tarifas por owner
  valor: number // suma del valor por línea (tarifa real por owner/operación)
  // Desglose por estado de factura (para el semáforo y no facturar doble):
  tonPorFacturar: number
  valorPorFacturar: number // solo lo NO gestionado (verde)
  tonEnProceso: number
  valorEnProceso: number // factura solicitada / a crédito (ámbar)
  tonFacturado: number
  valorFacturado: number // ya facturado — NO volver a facturar (rojo)
  /** Subconjunto de "en_proceso": el Coordinador YA validó la orden en
   *  Solicitar Facturas (estadofactura="CF - Factura solicitada") Y es
   *  Crédito real (no Contado por error de flujo). Esto -- NO
   *  `valorPorFacturar` -- es lo que Ciclo de Facturación debe usar para
   *  bloque "operación" (ver valorListoParaAnexo/tonListoParaAnexo):
   *  confirmado por el usuario 2026-09-14, "la solicitud de facturas a
   *  crédito es la que arma el cuadro control que a su vez alimenta el
   *  ciclo de facturación, sin estos anexos no se puede cobrar". */
  tonValidadoCredito: number
  valorValidadoCredito: number
  /** DE DÓNDE SALE EL DATO. "ordenes" = una orden de cargue procesada (tiene
   *  semáforo de factura Siigo y detalle por orden). "produccion" = concepto
   *  sin orden detrás (tolva de Avimol, horas extra): no tiene marca de
   *  facturado, así que entra completo como POR FACTURAR y su respaldo es el
   *  día a día. Ver lib/facturacion-produccion-conceptos.ts. */
  fuente: "ordenes" | "produccion"
  /** EN QUÉ BLOQUE SUMA en el documento. Es distinto de `fuente`: la tolva de
   *  Indupan sale de una orden (`fuente: "ordenes"`, conserva su semáforo y su
   *  reparto por owner) pero desde su fecha de vigencia se cuenta como
   *  producción. Reclasificar la MISMA línea —en vez de recalcularla— es lo que
   *  hace imposible cobrarla dos veces. */
  bloque: "operacion" | "produccion"
  /** Unidad de `toneladas`: toneladas o HORAS (horas extra). Sin esto las horas
   *  se sumarían al tonelaje del documento. */
  unidad: UnidadCobro
}

export interface Prefactura {
  origen: PrefacturaLinea[]
  resumen: PrefacturaResumen[]
  totalValor: number
  totalToneladas: number
  /** Soporte de las líneas de producción (las de órdenes se arman desde `origen`). */
  soporteProduccion: SoporteLinea[]
  /** Explicación de cómo se factura la producción de ESTE proyecto. */
  produccionNota: string | null
  /** Avisos del cálculo de producción (sin tarifa, sin solicitud de horas extra,
   *  rango incompleto…). Se muestran para que nadie facture a ciegas. */
  produccionAlertas: string[]
  /** Desde cuándo los conceptos de este proyecto cuentan como producción. */
  produccionDesde: string | null
  /** Si el período facturado cae dentro de esa vigencia. */
  produccionVigencia: "si" | "no" | "parcial"
  /** Regla de a quién se le factura cada línea en este proyecto (Avimol: cada
   *  transportadora paga lo suyo). null en los proyectos donde no aplica.
   *
   *  Reemplaza a `exclusionCarguePlaca`, que reportaba al margen —y solo en
   *  agregado— el cargue de Zamudio/Terceros. Ahora esas líneas están DENTRO del
   *  documento, a nombre de quien las paga y con su detalle orden por orden. */
  notaFacturadoA: string | null
}

// ---------- Prefacturas GUARDADAS (borrador/aprobada) ----------
export interface PrefacturaLineaGuardada {
  owner: string
  servicio: string
  toneladas: number
  tarifa: number
  total: number
  /** Presentes solo en las prefacturas nuevas; las guardadas antes de incluir la
   *  producción no los traen y se leen como "ordenes"/"t". */
  fuente?: "ordenes" | "produccion"
  unidad?: UnidadCobro
}
// Línea del SOPORTE (anexo) congelado: detalle de órdenes que respalda la factura.
export interface SoporteLinea {
  owner: string
  operacion: string
  servicio: string
  fecha: string | null
  numeroorden: string
  placa: string | null
  cliente: string | null
  producto: string | null
  toneladas: number
  tarifa: number
  valor: number
  /** "h" en las horas extra. Ausente = toneladas (soportes anteriores). */
  unidad?: UnidadCobro
  /** Tiquete de báscula. Ausente en producción (no nace de una orden) y en
   *  soportes guardados antes de agregarse este campo. */
  tiquete?: string | null
  /** Bucket del ANEXO, separado de `operacion` (que sigue siendo la clave del
   *  resumen/factura, granular por puesto). Cuando está presente, el anexo
   *  (pantalla/Excel/PDF) agrupa por este valor en vez de por `operacion` --
   *  así "Turno · Pacas" y "Hora extra · Cosedor" caen en un solo bloque
   *  "Servicios Adicionales" sin fusionar sus tarifas en el resumen. Ausente
   *  = se agrupa por `operacion` como siempre (tonelaje, Huevos, Empaque MP). */
  grupoAnexo?: string
}
export interface PrefacturaGuardada {
  id: number
  idempresa: number
  proyecto: string | null
  periodo_desde: string | null
  periodo_hasta: string | null
  lineas: PrefacturaLineaGuardada[]
  soporte: SoporteLinea[]
  total: number
  toneladas: number
  estado: "borrador" | "aprobada"
  usuario: string | null
  observacion: string | null
  created_at: string
}

/** Una advertencia detectada al momento de generar (sin tarifa, sin gestionar,
 *  pago que no cuadra, avisos de producción) -- se persiste tal cual en
 *  `prefacturas.advertencias` para que, cuando la generación es automática
 *  (cron, nadie mirando la pantalla), el Jefe pueda revisarlas después en vez
 *  de perderlas. */
export interface Advertencia {
  tipo: string
  detalle: string
}

export async function guardarPrefactura(payload: {
  idempresa: number
  proyecto?: string | null
  periodo_desde?: string | null
  periodo_hasta?: string | null
  lineas: PrefacturaLineaGuardada[]
  soporte?: SoporteLinea[] // detalle de órdenes que respalda la factura (congelado)
  total: number
  toneladas: number
  usuario?: string | null
  observacion?: string | null
  advertencias?: Advertencia[]
}): Promise<{ success: boolean; id?: number; message?: string }> {
  // Segundo factor (2026-10-05): solo detiene a quien lo tiene activado y no lo verificó.
  const segundoFactor = await segundoFactorPendiente("facturacion:guardarPrefactura")
  if (segundoFactor) return { success: false, message: segundoFactor }
  if (!payload?.idempresa) return { success: false, message: "Falta el proyecto." }
  if (!payload.lineas?.length) return { success: false, message: "La prefactura no tiene líneas seleccionadas." }
  try {
    const sb: any = await getSupabaseAdmin()
    const owners = Array.from(new Set(payload.lineas.map((l) => String(l?.owner || "").trim()).filter(Boolean)))
    const { data, error } = await sb
      .from("prefacturas")
      .insert({
        idempresa: payload.idempresa,
        proyecto: payload.proyecto ?? null,
        // Solo se guarda si es un ÚNICO owner -- si la prefactura mezcla
        // varios (caso manual, "ownerMezclado"), se deja NULL en vez de
        // guardar el primero cualquiera: un NULL avisa "no consultable por
        // owner", un valor guardado a medias sería peor (parecería de un
        // solo cliente sin serlo). Ver scripts/172_add_owner_prefacturas.sql.
        owner: owners.length === 1 ? owners[0] : null,
        periodo_desde: payload.periodo_desde || null,
        periodo_hasta: payload.periodo_hasta || null,
        lineas: payload.lineas,
        soporte: payload.soporte ?? [],
        total: payload.total,
        toneladas: payload.toneladas,
        // Se crea YA APROBADA: no existe un paso interno de "aprobar la
        // prefactura" en el negocio -- generarla (con la fecha/periodo)
        // ya construye el anexo y arranca el Ciclo de Facturación. La
        // única aprobación real del proceso es la del CLIENTE firmando el
        // anexo (evento "anexo_firmado" del ciclo), no un clic interno de
        // LIPGO. "borrador"/"Reabrir" siguen existiendo solo como vía de
        // corrección si algo quedó mal, no como paso obligatorio.
        estado: "aprobada",
        aprobado_por: payload.usuario ?? null,
        aprobado_en: new Date().toISOString(),
        estado_ciclo: "pendiente_anexo",
        ciclo_actualizado_en: new Date().toISOString(),
        usuario: payload.usuario ?? null,
        observacion: payload.observacion ?? null,
        advertencias: payload.advertencias ?? [],
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (error) return { success: false, message: error.message }
    return { success: true, id: data?.id }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar la prefactura." }
  }
}

/** Igual que `buscarSolapes` de Prefactura de Producción (mismo test de
 *  solape), pero para el origen `cuadro_control` -- no existía porque el
 *  Cuadro de Control siempre generaba a mano, con una persona mirando la
 *  pantalla que naturalmente no repetía un período ya facturado. La
 *  generación automática no tiene ese ojo humano, así que necesita su
 *  propia verificación antes de guardar.
 *
 *  `owner`: un mismo proyecto factura a varios clientes reales que
 *  comparten el sitio (ej. Indupan: INDUPAN/AVIMOL/Molinos del Atlántico)
 *  -- el solape es POR OWNER, no por proyecto completo (2 owners distintos
 *  SÍ pueden tener períodos que se crucen, cada uno con su propio anexo). */
export async function buscarSolapesCuadroControl(idempresa: number, desde: string, hasta: string, owner?: string) {
  const sb: any = await getSupabaseAdmin()
  let query = sb
    .from("prefacturas")
    .select("id, periodo_desde, periodo_hasta, total, aprobado_por")
    .eq("idempresa", idempresa)
    .eq("origen", "cuadro_control")
    .eq("estado", "aprobada")
  if (owner) query = query.eq("owner", owner)
  const { data } = await query
  return (data || [])
    .filter((p: any) => {
      const d = String(p.periodo_desde || "").slice(0, 10)
      const h = String(p.periodo_hasta || "").slice(0, 10)
      if (!d || !h) return false
      return d <= hasta && h >= desde
    })
    .map((p: any) => ({ id: p.id, periodo: `${p.periodo_desde} a ${p.periodo_hasta}`, total: p.total, aprobadoPor: p.aprobado_por }))
}

export async function listarPrefacturas(
  idempresa: number,
): Promise<{ success: boolean; data: PrefacturaGuardada[]; message?: string }> {
  if (!idempresa) return { success: true, data: [] }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("prefacturas")
      .select("*")
      .eq("idempresa", idempresa)
      .order("created_at", { ascending: false })
      .limit(100)
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: (data || []) as PrefacturaGuardada[] }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al listar prefacturas." }
  }
}

export async function cambiarEstadoPrefactura(
  id: number,
  estado: "borrador" | "aprobada",
  opciones?: { usuario?: string; forzar?: boolean },
): Promise<{ success: boolean; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()

    // Reabrir a borrador: si el Ciclo de Facturación ya avanzó (ya se envió
    // un anexo, o más), reabrir para editar los datos invalidaría un
    // documento que puede ya estar firmado por el cliente -- se bloquea salvo
    // que se fuerce explícitamente.
    if (estado === "borrador" && !opciones?.forzar) {
      const { data: actual } = await sb.from("prefacturas").select("estado_ciclo").eq("id", id).maybeSingle()
      if (actual && actual.estado_ciclo && actual.estado_ciclo !== "pendiente_anexo") {
        return {
          success: false,
          message:
            "Esta prefactura ya tiene avance en el Ciclo de Facturación (anexo enviado o más) -- reabrirla para editar " +
            "invalidaría un documento que puede estar firmado por el cliente. Vuelve a intentar confirmando explícitamente si de verdad quieres forzarlo.",
        }
      }
    }

    const updatePayload: Record<string, unknown> = { estado, updated_at: new Date().toISOString() }
    if (estado === "aprobada") {
      updatePayload.aprobado_por = opciones?.usuario ?? null
      updatePayload.aprobado_en = new Date().toISOString()
      updatePayload.estado_ciclo = "pendiente_anexo"
      updatePayload.ciclo_actualizado_en = new Date().toISOString()
    }

    const { error } = await sb.from("prefacturas").update(updatePayload).eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al cambiar el estado." }
  }
}

export async function eliminarPrefactura(id: number): Promise<{ success: boolean; message?: string }> {
  // Segundo factor (2026-10-05): solo detiene a quien lo tiene activado y no lo verificó.
  const segundoFactor = await segundoFactorPendiente("facturacion:eliminarPrefactura")
  if (segundoFactor) return { success: false, message: segundoFactor }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("prefacturas").delete().eq("id", id).eq("estado", "borrador")
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al eliminar." }
  }
}

/**
 * PRODUCCIÓN sin orden detrás (hoy: Avimol). Devuelve los conceptos agregados y
 * su soporte día a día. Vive aquí, en una sola función, para que el Cuadro y la
 * Prefactura NO puedan mostrar cifras distintas de lo mismo.
 *
 * No reimplementa el cálculo: consume `getConciliacionAvimol`, que ya está
 * validado contra el negocio y resuelve festivos, vigencias y horas extra.
 */
export interface ConceptoProduccion {
  concepto: string
  unidad: UnidadCobro
  cantidad: number
  valor: number
  tarifa: number
}
async function calcularProduccion(
  cfg: { owner: string },
  desde: string,
  hasta: string,
): Promise<{ conceptos: ConceptoProduccion[]; soporte: SoporteLinea[]; alertas: string[] }> {
  const alertas: string[] = []
  const soporte: SoporteLinea[] = []
  const conc = await getConciliacionAvimol(desde, hasta)
  if (!conc.success || !conc.data) {
    return { conceptos: [], soporte, alertas: [`No se pudo calcular la producción: ${conc.message || "error desconocido"}.`] }
  }

  type Acum = { cantidad: number; valor: number; tarifa: number }
  const porConcepto = new Map<string, { unidad: UnidadCobro; a: Acum }>()
  const acum = (concepto: string, unidad: UnidadCobro, cantidad: number, valor: number, tarifa: number) => {
    const e = porConcepto.get(concepto) || { unidad, a: { cantidad: 0, valor: 0, tarifa: 0 } }
    e.a.cantidad += cantidad
    e.a.valor += valor
    if (tarifa > 0) e.a.tarifa = tarifa
    porConcepto.set(concepto, e)
  }

  for (const d of conc.data.dias) {
    for (const p of d.productos) {
      if (p.toneladas <= 0) continue
      acum(p.operacion, "t", p.toneladas, p.cobro, p.tarifa)
      soporte.push({
        owner: cfg.owner,
        operacion: p.operacion,
        servicio: "Producción",
        fecha: d.fecha,
        numeroorden: "—", // la producción no tiene orden de cargue
        placa: null,
        cliente: null,
        producto: p.nombreproducto,
        toneladas: Number(p.toneladas.toFixed(3)),
        tarifa: p.tarifa,
        valor: Math.round(p.cobro),
        unidad: "t",
      })
    }
    for (const h of d.detalleHorasExtra) {
      if (h.horas <= 0) continue
      const concepto = `${CONCEPTO_HORA_EXTRA} · ${h.puesto}`
      acum(concepto, "h", h.horas, h.cobro, h.tarifa)
      soporte.push({
        owner: cfg.owner,
        operacion: concepto,
        servicio: "Hora extra",
        fecha: d.fecha,
        numeroorden: "—",
        placa: null,
        cliente: null,
        producto: `HED ${h.hed} · HEDF ${h.hedf} · HEN ${h.hen} · HEF ${h.hef} · HN ${h.hn}`,
        toneladas: Number(h.horas.toFixed(2)),
        tarifa: h.tarifa,
        valor: Math.round(h.cobro),
        unidad: "h",
        // Anexo consolidado (pedido explícito 2026-09-10): todos los puestos
        // de Turno/Hora Extra caen en UN solo bloque "Servicios Adicionales"
        // en vez de uno por puesto. `operacion` (arriba) sigue granular por
        // puesto para el resumen/factura -- esto solo cambia cómo se agrupa
        // el anexo visual/Excel/PDF.
        grupoAnexo: "Servicios Adicionales",
      })
    }
    // TURNOS solicitados y aprobados. Solo los que se pudieron valorizar: los
    // que no (puesto sin resolver, o cobraturno = NO) viajan como alerta, no
    // como una línea en $0 que ensuciaría la factura del cliente.
    for (const tr of d.detalleTurnos) {
      if (tr.cobro <= 0) continue
      const concepto = `${CONCEPTO_TURNO} · ${tr.puesto}`
      acum(concepto, "turno", tr.personas, tr.cobro, tr.tarifa)
      soporte.push({
        owner: cfg.owner,
        operacion: concepto,
        servicio: "Turno",
        fecha: d.fecha,
        numeroorden: "—",
        placa: null,
        cliente: null,
        // Se deja constancia del texto original cuando hubo que traducirlo:
        // así el anexo permite auditar por qué se cobró ese puesto.
        producto:
          `${tr.personas} turno(s) aprobado(s)` +
          (tr.via === "alias" ? ` · solicitado como "${tr.puestoSolicitado}"` : ""),
        toneladas: tr.personas,
        tarifa: tr.tarifa,
        valor: Math.round(tr.cobro),
        unidad: "turno",
        grupoAnexo: "Servicios Adicionales",
      })
    }
  }

  const conceptos: ConceptoProduccion[] = []
  for (const [concepto, { unidad, a }] of porConcepto) {
    if (a.cantidad <= 0) continue
    if (a.tarifa <= 0 && a.valor <= 0) {
      alertas.push(`"${concepto}" no tiene tarifa vigente en el maestro: se cobraría $0.`)
    }
    conceptos.push({
      concepto,
      unidad,
      cantidad: Number(a.cantidad.toFixed(unidad === "h" ? 2 : 3)),
      valor: Math.round(a.valor),
      // Tarifa EFECTIVA del grupo: si en el período cambió la vigencia,
      // valor/cantidad refleja la mezcla real mejor que una tarifa suelta.
      // Redondeo a centavos, no a peso entero (ver mismo fix en el resumen
      // por owner×servicio, más arriba en este archivo).
      tarifa: a.cantidad > 0 ? Math.round((a.valor / a.cantidad) * 100) / 100 : a.tarifa,
    })
  }
  conceptos.sort((x, y) => x.concepto.localeCompare(y.concepto, "es"))
  for (const al of conc.data.alertas) alertas.push(al.detalle)
  return { conceptos, soporte, alertas }
}

/**
 * Arma la PREFACTURA de un proyecto (idempresa) para un rango: la TABLA ORIGEN
 * (líneas de la vista `facturacion`, owner ya resuelto) + un resumen por
 * owner×servicio. Solo órdenes procesadas. Base para el anexo/soporte de factura.
 */
export async function getPrefactura(
  idempresa: number,
  filtros: { desde?: string | null; hasta?: string | null; tipooperaciones?: string[] | null } = {},
): Promise<{ success: boolean; data?: Prefactura; message?: string }> {
  if (!idempresa) return { success: false, message: "Selecciona un proyecto/empresa." }
  try {
    const sb: any = await getSupabaseAdmin()
    await cargarPlacasDistribucion() // caché de placas de distribución para servicioDe/tarifaDe

    // Tarifas por servicio desde tarifasoperacion (Cargue, Descargue, Descargue SUSANITA).
    const tarifas = await tarifasDeEmpresa(sb, idempresa)

    // Placas que NO atiende LIP (excepto cuando cargan a Susanita). Ej. WMP446 en id 4.
    const placasExcluidas = new Set((PLACAS_EXCLUIDAS_FACTURAS[idempresa] || []).map((p) => p.toUpperCase()))

    // A QUIÉN SE LE FACTURA CADA LÍNEA (Avimol): el cargue/descargue/distribución
    // de vehículos de TERCEROS y de ZAMUDIO no se le factura al proyecto, se le
    // cobra a ellos; el de placa propia va cubierto por el fijo mensual (valor 0).
    //
    // Antes eso se resolvía APARTANDO las líneas de cargue cuya placa no fuera de
    // Avimol y reportándolas como un agregado al margen del documento. El efecto
    // era que Zamudio y Terceros NO existían como owners en la prefactura —solo
    // salía Avimol— y no había forma de ver su detalle orden por orden ni de
    // exportarlo, aunque el CUADRO sí los mostraba: los dos módulos leían las
    // mismas líneas y reportaban owners distintos.
    //
    // Ahora se usa `facturadoAOwner`, el mismo criterio del cuadro y del análisis
    // financiero (ver lib/facturacion-billed-party.ts), así que cada línea queda a
    // nombre de quien la paga y arrastra su detalle completo.
    const cfgCargue = cargueSoloPlacaPropia(idempresa)

    // Filtro multi-operación (vacío = todas). "Producción" viaja como un chip
    // más pero no es un tipooperacion, así que se separa de las operaciones.
    const cfgFiltro = produccionDelProyecto(idempresa)
    const { opSet, incluirProduccion, soloProduccion, hayFiltro: hayFiltroOps } = separarFiltroOperaciones(
      cfgFiltro,
      filtros.tipooperaciones,
    )

    // Procesadas del proyecto (fuente de verdad) + ESTADO DE FACTURA por orden.
    // El estado dice qué ya se gestionó (para el semáforo y NO facturar doble): en
    // Medellín los descargues ya se facturan a las transportadoras y quedan con estado.
    const procesadas = new Set<string>()
    const estadoPorOrden = new Map<string, { estado: string | null; facturasiigo: string | null; pesovascula: number; mediopago: string | null }>()
    for (let offset = 0; ; offset += 1000) {
      // Mismo rango de fechas que se aplica luego a la vista `facturacion`:
      // antes se recorría TODA la historia de la empresa (4 páginas en ID1)
      // solo para armar este mapa, aunque el período pedido fuera un mes.
      let q = sb
        .from("cabeceraoc")
        .select("ordendecargue, fincargue, facturar, tipooperacion, estadofactura, facturasiigo, pesovascula, mediopago")
        .eq("idempresa", idempresa)
        .neq("tipooperacion", "proyeccion")
      if (filtros.desde) q = q.gte("fechacargue", filtros.desde)
      if (filtros.hasta) q = q.lte("fechacargue", filtros.hasta)
      const { data, error } = await q.order("id").range(offset, offset + 999)
      if (error) return { success: false, message: error.message }
      if (!data || data.length === 0) break
      for (const o of data) {
        const on = String(o.ordendecargue || "").trim()
        // Un mismo `ordendecargue` puede tener MÁS DE UN `cabeceraoc` (ej. un
        // descargue manual de terceros con dos pesajes/tiquetes bajo el mismo
        // número de orden): sumar `pesovascula` en vez de sobreescribir, o el
        // peso del segundo tiquete se pierde y la línea queda sub-facturada.
        const previo = estadoPorOrden.get(on)
        estadoPorOrden.set(on, {
          estado: o.estadofactura ?? previo?.estado ?? null,
          facturasiigo: o.facturasiigo ?? previo?.facturasiigo ?? null,
          pesovascula: (previo?.pesovascula ?? 0) + num(o.pesovascula),
          mediopago: o.mediopago ?? previo?.mediopago ?? null,
        })
        if (o.fincargue && o.facturar !== false) procesadas.add(on)
      }
      if (data.length < 1000) break
    }

    // EMPAQUE (Papel, Polipropileno): no tiene tarifa propia en `tarifasoperacion`
    // -- sin este paso, `tarifaDeServicio` caía al fallback "tarifa más alta
    // configurada" del owner/operación. Se calcula primero el total de PRODUCTO
    // real (sin empaque) por orden×owner, para tarifar el empaque a esa misma
    // tarifa efectiva (mismo criterio y mismo bug que getControlFacturacion).
    const productoTonPorOrdenOwner = new Map<string, number>()
    const productoValorPorOrdenOwner = new Map<string, number>()
    for (let offset = 0; ; offset += 1000) {
      let q = sb
        .from("facturacion")
        .select("numeroorden, cliente, placa, owner, subcategoria, toneladas, transporte, tipooperacion")
        .eq("idempresa", idempresa)
      if (filtros.desde) q = q.gte("fechacargue", filtros.desde)
      if (filtros.hasta) q = q.lte("fechacargue", filtros.hasta)
      const { data, error } = await q.order("numeroorden").order("producto").order("toneladas").order("cantidad").order("tiquetebascula").range(offset, offset + 999)
      if (error) return { success: false, message: error.message }
      if (!data || data.length === 0) break
      for (const r of data) {
        const on = String(r.numeroorden || "").trim()
        if (!procesadas.has(on)) continue
        if (esEmpaque(r.subcategoria)) continue
        const placa = String(r.placa ?? "").trim().toUpperCase()
        const cl = String(r.cliente ?? "").toUpperCase()
        if (placasExcluidas.has(placa) && !cl.includes("SUSANITA")) continue
        const servicioPre = servicioDe(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa)
        if (soloProduccion) continue
        if (hayFiltroOps && servicioPre !== "Susanita" && !opSet.has(String(r.tipooperacion ?? "").trim().toLowerCase())) continue
        const owner = ownerDeLinea(idempresa, r.placa, String(r.owner || "SIN OWNER"), r.tipooperacion)
        const ton = num(r.toneladas)
        const tarifa = tarifaDeServicio(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa, owner, r.subcategoria, tarifas)
        const kProd = `${on}|||${owner}`
        productoTonPorOrdenOwner.set(kProd, (productoTonPorOrdenOwner.get(kProd) || 0) + ton)
        productoValorPorOrdenOwner.set(kProd, (productoValorPorOrdenOwner.get(kProd) || 0) + ton * tarifa)
      }
      if (data.length < 1000) break
    }

    // Líneas de la vista facturacion (TABLA ORIGEN).
    const origen: PrefacturaLinea[] = []
    for (let offset = 0; ; offset += 1000) {
      let q = sb
        .from("facturacion")
        .select("fechaorden, fechacargue, cliente, numeroorden, tiquetebascula, placa, producto, pesobascula, toneladas, owner, subcategoria, idempresa, transporte, tipooperacion, tarifa, valor_a_facturar")
        .eq("idempresa", idempresa)
      if (filtros.desde) q = q.gte("fechacargue", filtros.desde)
      if (filtros.hasta) q = q.lte("fechacargue", filtros.hasta)
      const { data, error } = await q.order("numeroorden").order("producto").order("toneladas").order("cantidad").order("tiquetebascula").range(offset, offset + 999)
      if (error) return { success: false, message: error.message }
      if (!data || data.length === 0) break
      const cantMap = await cantidadesPorUnidad(
        sb,
        data.filter((r: any) => esProductoPorUnidad(r.subcategoria)).map((r: any) => ({ numeroorden: r.numeroorden, producto: r.producto })),
      )
      for (const r of data) {
        const on = String(r.numeroorden || "").trim()
        if (!procesadas.has(on)) continue
        const placa = String(r.placa ?? "").trim().toUpperCase()
        const cl = String(r.cliente ?? "").toUpperCase()
        // WMP446 (u otras excluidas) NO las atiende LIP, SALVO cuando cargan a Susanita.
        if (placasExcluidas.has(placa) && !cl.includes("SUSANITA")) continue
        const servicio = servicioDe(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa)
        // Filtro multi-operación. Si solo se marcó "Producción" no entra NINGUNA
        // orden (ni Susanita); si hay operaciones marcadas, Susanita se conserva
        // siempre porque es la factura del owner.
        if (soloProduccion) continue
        if (hayFiltroOps && servicio !== "Susanita" && !opSet.has(String(r.tipooperacion ?? "").trim().toLowerCase())) continue
        // Owner por el id_empresa del PRODUCTO (dueño real), incluido el propio.
        // SALVO en id4: el vehículo propio (LWY393) factura TODO su viaje al
        // owner del proyecto sin importar el producto (ver ownerDeLinea).
        const owner = ownerDeLinea(idempresa, r.placa, String(r.owner || "SIN OWNER"), r.tipooperacion)
        const est = estadoPorOrden.get(on)
        const estadofactura = est?.estado ?? null
        let tServicio: number
        if (esEmpaque(r.subcategoria)) {
          const kEmp = `${on}|||${owner}`
          const tonProducto = productoTonPorOrdenOwner.get(kEmp) || 0
          const valorProducto = productoValorPorOrdenOwner.get(kEmp) || 0
          tServicio = tonProducto > 0 ? valorProducto / tonProducto : tarifaDeServicio(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa, owner, r.subcategoria, tarifas)
        } else {
          tServicio = tarifaDeServicio(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa, owner, r.subcategoria, tarifas)
        }
        // Quién PAGA esta línea. La tarifa se busca con el owner del PRODUCTO
        // (que es como está montada `tarifasoperacion`); la reasignación es de
        // destinatario, no de tarifa. Con `cubiertoPorFijo` el movimiento cuenta
        // en toneladas pero sale en 0 — igual que en el cuadro.
        const fa = facturadoAOwner(idempresa, owner, r.tipooperacion, r.transporte, r.subcategoria, r.placa)
        const tarifaFacturada = fa.cubiertoPorFijo ? 0 : tServicio
        // Huevos (y cualquier producto por unidad): se cobra la CANTIDAD digitada
        // en la orden (detalleoc.cantidad), no el peso. La báscula no le aplica.
        const porUnidad = esProductoPorUnidad(r.subcategoria)
        const cantidadFacturable = porUnidad
          ? cantMap.get(`${on}|||${String(r.producto || "").trim()}`) || 0
          : num(r.toneladas)
        // Unifica Cargue+Distribución del vehículo propio (id3/LWY354, id4/LWY393)
        // en un mismo grupo de resumen — se mide junto, con su propia tarifa.
        // Otros cargues (ej. "cliente recoge"/terceros) NO entran aquí y siguen
        // por operación. Ver esVehiculoPropioAgrupable: agrupar el viaje es
        // independiente de a quién se factura (ese es OWNER_DE_PLACA_PROPIA).
        const opNorm = String(r.tipooperacion ?? "").trim().toLowerCase()
        const esVehiculoPropioConRegla = esVehiculoPropioAgrupable(idempresa, r.placa, r.tipooperacion, owner)
        const grupoResumen = esVehiculoPropioConRegla
          ? "Cargue + Distribución (vehículo propio)"
          : r.tipooperacion || "(sin operación)"
        // ID3/ID4 no tienen báscula física: el "Tiquete Báscula" de Cargue y
        // Distribución no es un dato real (no hay tiquete que digitar). Se
        // muestra el número de la propia orden en su lugar. Descargue NO se
        // toca: ahí el tiquete sí es real (manual para terceros, o heredado
        // del clon cross-empresa desde la planta) y debe respetarse.
        const esCedi = idempresa === 3 || idempresa === 4
        const tiquete = esCedi && (opNorm === "cargue" || opNorm === "distribucion") ? on : r.tiquetebascula ?? null
        const linea: PrefacturaLinea = {
          fechaorden: r.fechaorden ?? null,
          fechacargue: r.fechacargue ?? null,
          cliente: r.cliente ?? null,
          numeroorden: on,
          tiquete,
          placa: r.placa ?? null,
          producto: r.producto ?? null,
          pesobascula: num(r.pesobascula),
          toneladas: cantidadFacturable,
          owner: fa.owner,
          subcategoria: r.subcategoria ?? null,
          idempresa: Number(r.idempresa),
          transporte: r.transporte ?? null,
          tipooperacion: r.tipooperacion ?? null,
          grupoResumen,
          tarifa: r.tarifa ?? null,
          // La vista SQL calcula valor_a_facturar = tarifa × toneladas (peso); para
          // productos por unidad ese número no sirve, se recalcula aquí con la
          // cantidad real.
          valor_a_facturar: porUnidad ? cantidadFacturable * tServicio : num(r.valor_a_facturar),
          servicio,
          tarifaServicio: tarifaFacturada,
          valorServicio: cantidadFacturable * tarifaFacturada,
          estadofactura,
          categoria: categoriaDeFactura(est?.facturasiigo, estadofactura),
          mediopago: est?.mediopago ?? null,
          unidad: porUnidad ? "u" : "t",
        }
        origen.push(linea)
      }
      if (data.length < 1000) break
    }

    // PLANTAS (id 1/2, con báscula): el peso a facturar es el de BÁSCULA (tiquete),
    // prorrateado entre owners por su participación en el detalle. Se escala toneladas
    // y valor de cada línea por (pesovascula / Σ detalle de la orden). Σ por owner = báscula.
    if (idempresa === 1 || idempresa === 2) {
      // Todas las líneas van en `origen`, incluidas las de Zamudio/Terceros: el
      // prorrateo por báscula tiene que verlas juntas o el reparto por owner no
      // sumaría el peso del tiquete. Los productos por UNIDAD (Huevos) quedan
      // fuera: su "toneladas" es cantidad, no peso, y la báscula no le aplica.
      const todas = origen.filter((l) => l.unidad !== "u")
      const totalDetOrden = new Map<string, number>()
      for (const l of todas) totalDetOrden.set(l.numeroorden, (totalDetOrden.get(l.numeroorden) || 0) + l.toneladas)
      for (const l of todas) {
        const P = estadoPorOrden.get(l.numeroorden)?.pesovascula ?? 0
        const totalDet = totalDetOrden.get(l.numeroorden) || 0
        if (P > 0 && totalDet > 0) {
          const scale = P / totalDet
          l.toneladas = l.toneladas * scale
          l.valorServicio = l.valorServicio * scale
        }
      }
    } else if (idempresa === 3 || idempresa === 4) {
      // CEDIS (sin báscula): SOLO el DESCARGUE se prorratea por el peso del tiquete
      // (pesovascula digitado del origen). Cargue/Distribución siguen con el detalle.
      const esDesc = (l: PrefacturaLinea) => l.unidad !== "u" && String(l.tipooperacion).trim().toLowerCase() === "descargue"
      const totalDetOrden = new Map<string, number>()
      for (const l of origen) if (esDesc(l)) totalDetOrden.set(l.numeroorden, (totalDetOrden.get(l.numeroorden) || 0) + l.toneladas)
      for (const l of origen) {
        if (!esDesc(l)) continue
        const totalDet = totalDetOrden.get(l.numeroorden) || 0
        const P = basculaTiqueteDescargue(estadoPorOrden.get(l.numeroorden)?.pesovascula ?? 0, totalDet)
        if (P > 0 && totalDet > 0) {
          const scale = P / totalDet
          l.toneladas = l.toneladas * scale
          l.valorServicio = l.valorServicio * scale
        }
      }
    }

    // Resumen por owner × servicio, facturado a la TARIFA DEL SERVICIO (no la de la línea).
    // Se desglosa por ESTADO para el semáforo: por facturar (verde) / en proceso (ámbar)
    // / facturado (rojo, NO volver a facturar).
    const map = new Map<string, PrefacturaResumen>()
    let totalToneladas = 0
    for (const l of origen) {
      const op = l.grupoResumen
      // La unidad entra en la clave: un producto por UNIDAD (Huevos) nunca se
      // mezcla con el tonelaje normal de la misma operación/owner, o el "valor
      // / toneladas" del grupo (línea 901) saldría absurdo.
      const k = `${l.owner}|||${op}|||${l.unidad}`
      const r =
        map.get(k) ||
        {
          owner: l.owner, operacion: op, toneladas: 0, tarifa: l.tarifaServicio, valor: 0,
          tonPorFacturar: 0, valorPorFacturar: 0, tonEnProceso: 0, valorEnProceso: 0,
          tonFacturado: 0, valorFacturado: 0, tonValidadoCredito: 0, valorValidadoCredito: 0,
          fuente: "ordenes" as const, bloque: "operacion" as const, unidad: l.unidad,
        }
      // Valor POR LÍNEA (ya calculado con la tarifa del owner/operación real).
      const v = l.valorServicio
      r.toneladas += l.toneladas
      r.valor += v
      if (l.categoria === "facturado") {
        r.tonFacturado += l.toneladas
        r.valorFacturado += v
      } else if (l.categoria === "en_proceso") {
        r.tonEnProceso += l.toneladas
        r.valorEnProceso += v
        if (l.estadofactura === "CF - Factura solicitada" && l.mediopago === "Crédito") {
          r.tonValidadoCredito += l.toneladas
          r.valorValidadoCredito += v
        }
      } else {
        r.tonPorFacturar += l.toneladas
        r.valorPorFacturar += v
      }
      map.set(k, r)
      if (l.unidad === "t") totalToneladas += l.toneladas
    }
    let totalValor = 0
    for (const r of map.values()) {
      // Tarifa EFECTIVA del grupo (valor/ton) — refleja tarifas por owner/operación.
      // Redondeo a CENTAVOS, no a peso entero -- una tarifa por unidad (Huevos,
      // $2,95) quedaba en $3 al redondear a entero, aunque todo el grupo
      // comparta exactamente esa misma tarifa.
      r.tarifa = r.toneladas > 0 ? Math.round((r.valor / r.toneladas) * 100) / 100 : r.tarifa
      totalValor += r.valor
    }
    const resumen = Array.from(map.values()).sort(
      (a, b) => a.owner.localeCompare(b.owner) || a.operacion.localeCompare(b.operacion),
    )

    // ---------------------------------------------------------------------
    // PRODUCCIÓN. Cada proyecto declara sus conceptos, de dónde salen y desde
    // cuándo cuentan (lib/facturacion-produccion-conceptos.ts). Hay dos casos y
    // NINGUNO puede duplicar plata:
    //
    //   A) El concepto ya viene de una orden (Indupan: Tolva / Tolva f) → se
    //      RECLASIFICA la misma línea al bloque de producción. Mismo valor,
    //      mismo semáforo, mismo reparto por owner: es una etiqueta, no una
    //      suma. Recalcularlo aparte sí duplicaría, y además perdería el
    //      reparto (parte de esa tolva es de AVIMOL y de Molinos).
    //
    //   B) El concepto no tiene orden detrás (Avimol: tolva de `invtrans` y
    //      horas extra de nómina) → hay que AGREGARLO, porque la vista
    //      `facturacion` no lo ve y sin él la factura sale incompleta.
    // ---------------------------------------------------------------------
    const cfg = produccionDelProyecto(idempresa)
    const produccionAlertas: string[] = []
    const soporteProduccion: SoporteLinea[] = []
    // VIGENCIA: el corte por fecha es el seguro contra el traslape con lo ya
    // facturado. Un período anterior a la vigencia se factura exactamente como
    // se venía facturando, así que regenerar una prefactura vieja da el mismo
    // documento que se revisó en su momento.
    const vigencia = vigenciaProduccion(cfg, filtros.desde, filtros.hasta)
    if (cfg && vigencia === "parcial") {
      produccionAlertas.push(
        `El rango se monta sobre el ${cfg.desde}, fecha desde la que ${cfg.conceptos.join(" / ")} se cuentan como ` +
          `producción. Se dejó la presentación anterior para no partir un concepto en dos. Factura hasta el ` +
          `${cfg.desde} por un lado y desde el ${cfg.desde} por otro.`,
      )
    }

    // Caso A — el concepto YA viene de una orden (Indupan: Tolva / Tolva f).
    // No se recalcula ni se agrega nada: se RECLASIFICA la misma línea al
    // bloque de producción a partir de su vigencia. El valor, el semáforo y el
    // reparto por owner quedan intactos, y por eso no puede haber doble cobro.
    if (cfg && cfg.fuente === "ordenes" && vigencia === "si") {
      const conceptosK = new Set(cfg.conceptos.map((c) => ownerKey(c)))
      let reclasificadas = 0
      for (const r of resumen) {
        if (conceptosK.has(ownerKey(r.operacion))) {
          r.bloque = "produccion"
          reclasificadas++
        }
      }
      if (reclasificadas === 0 && filtros.desde) {
        produccionAlertas.push(
          `No hubo movimiento de ${cfg.conceptos.join(" / ")} en el período: el bloque de producción va en $0.`,
        )
      }
    }

    // Caso B — el concepto NO tiene orden detrás (Avimol) y hay que traerlo.
    if (cfg && cfg.fuente === "conciliacion" && vigencia === "si") {
      if (!filtros.desde || !filtros.hasta) {
        produccionAlertas.push(
          "Define el rango Desde/Hasta y vuelve a generar: sin período no se puede calcular la producción, " +
            "y la prefactura quedaría solo con las órdenes de cargue.",
        )
      } else if (!incluirProduccion) {
        produccionAlertas.push(
          'El filtro de Operación no incluye "Producción", así que no se sumó. Márcala junto a las demás ' +
            "operaciones (o no marques ninguna) para facturar el período completo.",
        )
      } else {
        const prod = await calcularProduccion(cfg, filtros.desde, filtros.hasta)
        soporteProduccion.push(...prod.soporte)
        produccionAlertas.push(...prod.alertas)

        // GUARDA ANTI-DOBLE-COBRO: si el concepto YA vino como operación de una
        // orden (alguien creó `cabeceraoc` con tipooperacion "Salvado"), no se
        // agrega — se avisa. Es la única forma de que este bloque duplique plata.
        const yaEnOrdenes = new Set(resumen.map((r) => `${ownerKey(r.owner)}|||${ownerKey(r.operacion)}`))
        for (const c of prod.conceptos) {
          if (yaEnOrdenes.has(`${ownerKey(cfg.owner)}|||${ownerKey(c.concepto)}`)) {
            produccionAlertas.push(
              `"${c.concepto}" ya viene como operación de órdenes de cargue: NO se sumó aparte para no cobrarlo dos veces.`,
            )
            continue
          }
          resumen.push({
            owner: cfg.owner,
            operacion: c.concepto,
            toneladas: c.cantidad,
            tarifa: c.tarifa,
            valor: c.valor,
            // La producción no tiene factura Siigo por registro: entra completa
            // como POR FACTURAR (verde). El anti-doble-cobro aquí es el período.
            tonPorFacturar: c.cantidad,
            valorPorFacturar: c.valor,
            tonEnProceso: 0,
            valorEnProceso: 0,
            tonFacturado: 0,
            valorFacturado: 0,
            tonValidadoCredito: 0,
            valorValidadoCredito: 0,
            fuente: "produccion",
            bloque: "produccion",
            unidad: c.unidad,
          })
          totalValor += c.valor
          if (c.unidad === "t") totalToneladas += c.cantidad
        }
      }
      resumen.sort((a, b) => a.owner.localeCompare(b.owner) || a.operacion.localeCompare(b.operacion))
    }

    // Caso C — SERVICIOS ADICIONALES (Turnos/Horas Extra aprobados) de un
    // proyecto que no tiene el circuito de "conciliación" de Avimol. Mismo
    // contrato SoporteLinea/ConceptoProduccion, mismo anti-doble-cobro. Ver
    // lib/servicios-adicionales-indupan-actions.ts y
    // lib/facturacion-produccion-conceptos.ts (SERVICIOS_ADICIONALES_POR_PROYECTO).
    const cfgServAd = serviciosAdicionalesDelProyecto(idempresa)
    if (cfgServAd) {
      if (!filtros.desde || !filtros.hasta) {
        produccionAlertas.push(
          "Define el rango Desde/Hasta y vuelve a generar: sin período no se pueden calcular los Servicios " +
            "Adicionales (turnos/horas extra aprobados), y la prefactura quedaría solo con las órdenes de cargue.",
        )
      } else {
        const servAd = await calcularServiciosAdicionalesIndupan(filtros.desde, filtros.hasta)
        soporteProduccion.push(...servAd.soporte)
        produccionAlertas.push(...servAd.alertas)
        const yaEnOrdenes = new Set(resumen.map((r) => `${ownerKey(r.owner)}|||${ownerKey(r.operacion)}`))
        for (const c of servAd.conceptos) {
          if (yaEnOrdenes.has(`${ownerKey(cfgServAd.owner)}|||${ownerKey(c.concepto)}`)) {
            produccionAlertas.push(
              `"${c.concepto}" ya viene como operación de órdenes de cargue: NO se sumó aparte para no cobrarlo dos veces.`,
            )
            continue
          }
          resumen.push({
            owner: cfgServAd.owner,
            operacion: c.concepto,
            toneladas: c.cantidad,
            tarifa: c.tarifa,
            valor: c.valor,
            tonPorFacturar: c.cantidad,
            valorPorFacturar: c.valor,
            tonEnProceso: 0,
            valorEnProceso: 0,
            tonFacturado: 0,
            valorFacturado: 0,
            tonValidadoCredito: 0,
            valorValidadoCredito: 0,
            fuente: "produccion",
            bloque: "produccion",
            unidad: c.unidad,
          })
          totalValor += c.valor
          if (c.unidad === "t") totalToneladas += c.cantidad
        }
        resumen.sort((a, b) => a.owner.localeCompare(b.owner) || a.operacion.localeCompare(b.operacion))
      }
    }

    // Nota de a quién se le factura cada línea. Ya no hace falta reportar un
    // agregado "de lo que quedó fuera": nada queda fuera. Zamudio y Terceros son
    // owners del documento —con su detalle orden por orden y su subtotal— y lo de
    // placa propia aparece en toneladas con valor 0.
    const notaFacturadoA = cfgCargue ? cfgCargue.nota : null

    return {
      success: true,
      data: {
        origen,
        resumen,
        totalValor,
        totalToneladas,
        soporteProduccion,
        produccionNota: cfg?.nota ?? null,
        produccionAlertas,
        produccionDesde: cfg?.desde ?? null,
        produccionVigencia: vigencia,
        notaFacturadoA,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al armar la prefactura." }
  }
}

/**
 * Cruce del cuadro para UNA empresa/ID (owner del proyecto). Trae la vista
 * `facturacion` (valor por owner) de esa empresa y le cruza el `estadofactura` de
 * `cabeceraoc` para clasificar cada orden. `idempresa` null no se soporta: la
 * facturación es por proyecto seleccionado.
 */
export async function getControlFacturacion(
  idempresa: number,
  filtros: FiltrosControl = {},
): Promise<{ success: boolean; data?: ControlFacturacion; message?: string }> {
  if (!idempresa) return { success: false, message: "Selecciona un proyecto/empresa." }
  try {
    const sb: any = await getSupabaseAdmin()
    await cargarPlacasDistribucion() // caché de placas de distribución para servicioDe/tarifaDe

    // Tarifas POR SERVICIO (misma valoración que la prefactura) y placas que LIP no
    // atiende (WMP446), para que "lo que se debe facturar" sea REAL y consistente.
    const tarifas = await tarifasDeEmpresa(sb, idempresa)
    const placasExcluidas = new Set((PLACAS_EXCLUIDAS_FACTURAS[idempresa] || []).map((p) => p.toUpperCase()))

    // 1) Estado + vínculo de las órdenes de la empresa (fuente de verdad).
    //    Solo procesadas (fincargue) y facturables (facturar != false).
    const estadoPorOrden = new Map<
      string,
      { estado: string | null; facturasiigo: string | null; valorpago: number | null; pesovascula: number; mediopago: string | null }
    >()
    const procesadas = new Set<string>()
    // Operaciones REALES del proyecto (para poblar el filtro con lo que sí existe).
    const operacionesSet = new Set<string>()
    {
      const pageSize = 1000
      for (let offset = 0; ; offset += pageSize) {
        // Mismo rango de fechas que se aplica luego a la vista `facturacion`
        // (ver getPrefactura): sin esto se recorría toda la historia por empresa.
        let q = sb
          .from("cabeceraoc")
          .select("ordendecargue, estadofactura, facturasiigo, valorpago, fincargue, facturar, tipooperacion, pesovascula, mediopago")
          .eq("idempresa", idempresa)
          .neq("tipooperacion", "proyeccion")
        if (filtros.desde) q = q.gte("fechacargue", filtros.desde)
        if (filtros.hasta) q = q.lte("fechacargue", filtros.hasta)
        const { data, error } = await q.order("id").range(offset, offset + pageSize - 1)
        if (error) return { success: false, message: error.message }
        if (!data || data.length === 0) break
        for (const o of data) {
          const on = String(o.ordendecargue || "").trim()
          if (!on) continue
          // Un mismo `ordendecargue` puede tener MÁS DE UN `cabeceraoc` (ej. un
          // descargue manual de terceros con dos pesajes/tiquetes bajo el mismo
          // número de orden): sumar `pesovascula` en vez de sobreescribir, o el
          // peso del segundo tiquete se pierde y la línea queda sub-facturada.
          const previo = estadoPorOrden.get(on)
          estadoPorOrden.set(on, {
            estado: o.estadofactura ?? previo?.estado ?? null,
            facturasiigo: o.facturasiigo ?? previo?.facturasiigo ?? null,
            valorpago: o.valorpago ?? previo?.valorpago ?? null,
            pesovascula: (previo?.pesovascula ?? 0) + num(o.pesovascula),
            mediopago: o.mediopago ?? previo?.mediopago ?? null,
          })
          const procesada = o.fincargue && o.facturar !== false
          if (procesada) procesadas.add(on)
          const op = String(o.tipooperacion ?? "").trim()
          if (procesada && op) operacionesSet.add(op)
        }
        if (data.length < pageSize) break
      }
    }
    const operaciones = Array.from(operacionesSet).sort((a, b) => a.localeCompare(b))

    // 2) Líneas de la vista `facturacion` de la empresa (valor por owner).
    let facturas: any[] = []
    {
      const pageSize = 1000
      for (let offset = 0; ; offset += pageSize) {
        let q = sb
          .from("facturacion")
          .select("numeroorden, fechacargue, fechaorden, placa, tiquetebascula, cliente, producto, subcategoria, toneladas, owner, transporte, tipooperacion, tarifa, valor_a_facturar")
          .eq("idempresa", idempresa)
        if (filtros.desde) q = q.gte("fechacargue", filtros.desde)
        if (filtros.hasta) q = q.lte("fechacargue", filtros.hasta)
        // El filtro de OWNER NO va en SQL. La vista `facturacion` trae el owner
        // del PRODUCTO, pero el que se muestra —y el que ofrece el desplegable—
        // puede estar reasignado: en Avimol una linea de Zamudio se factura a
        // "Zamudio" y una de terceros a "Terceros" (ver `facturadoAOwner`), y
        // esos valores NO existen en la vista. Filtrar aqui devolvia CERO filas
        // al elegirlos. Se filtra mas abajo, sobre el owner ya resuelto.
        if (filtros.placa) q = q.ilike("placa", `%${filtros.placa}%`)
        if (filtros.cliente) q = q.ilike("cliente", `%${filtros.cliente}%`)
        const { data, error } = await q.order("numeroorden").order("producto").order("toneladas").order("cantidad").order("tiquetebascula").range(offset, offset + pageSize - 1)
        if (error) return { success: false, message: error.message }
        if (!data || data.length === 0) break
        facturas = facturas.concat(data)
        if (data.length < pageSize) break
      }
    }

    // 3) Agregar por ORDEN+OWNER. Toneladas por el id_empresa del PRODUCTO (dueño real);
    //    valor = Σ(toneladas × tarifa por operación/owner). En PLANTAS (id 1/2, con báscula)
    //    el peso a facturar es el de BÁSCULA (pesovascula, el del tiquete): se PRORRATEA
    //    entre los owners según su participación en el detalle (Σ pesos por owner = báscula).
    //    En CEDIS (sin báscula) se usa el peso del detalle de la orden.
    const esBascula = idempresa === 1 || idempresa === 2

    // WMP446 (u otras excluidas) NO las atiende LIP, SALVO cuando cargan a Susanita.
    const esExcluida = (r: any) => {
      const placa = String(r.placa ?? "").trim().toUpperCase()
      const cl = String(r.cliente ?? "").toUpperCase()
      return placasExcluidas.has(placa) && !cl.includes("SUSANITA")
    }
    // Filtro multi-operación (en código para conservar Susanita aunque se excluya
    // Descargue). "Producción" viaja como un chip más pero no es un tipooperacion.
    const cfgFiltro = produccionDelProyecto(idempresa)
    const { opSet, incluirProduccion, soloProduccion, hayFiltro: hayFiltroOps } = separarFiltroOperaciones(
      cfgFiltro,
      filtros.tipooperaciones,
    )
    const filtraOperacion = (r: any, servicio: Servicio | null) => {
      if (!hayFiltroOps) return false // sin filtro → no descarta
      if (soloProduccion) return true // solo producción → fuera todas las órdenes
      if (servicio === "Susanita") return false // Susanita se conserva siempre (factura del owner)
      return !opSet.has(String(r.tipooperacion ?? "").trim().toLowerCase())
    }

    const key = (o: string, w: string) => `${o}|||${w}`
    type Acc = {
      on: string
      owner: string
      op: string
      tonDet: number
      valorDet: number
      sinTarifa: boolean
      r: any
      /** Huevos (y cualquier producto por unidad): cantidad real digitada (detalleoc.cantidad). */
      cantidadDet: number
      porUnidad: boolean
    }
    const accMap = new Map<string, Acc>()
    // Denominador del prorrateo de báscula = Σ toneladas del detalle COMPLETO de la orden
    // (TODOS los owners), INDEPENDIENTE de los filtros de owner/placa/cliente. Si esos
    // filtros están activos, `facturas` viene recortado y el denominador quedaría parcial
    // -> inflaría el peso/valor del owner filtrado en plantas id1/2. Cuando hay filtro se
    // relee el detalle completo (mismo empresa+rango) SOLO para el denominador; la
    // presentación (accMap/filas) sigue filtrada. NO afecta getPrefactura (lo que se factura).
    // `filtros.owner` ya no entra aqui: al filtrarse sobre el owner resuelto (y no
    // en SQL), `facturas` llega COMPLETO y el denominador no queda parcial.
    const hayFiltroDetalle = !!(filtros.placa || filtros.cliente)
    let detalleParaDenominador = facturas
    if (hayFiltroDetalle) {
      detalleParaDenominador = []
      for (let offset = 0; ; offset += 1000) {
        let q = sb
          .from("facturacion")
          .select("numeroorden, toneladas, tipooperacion, transporte, cliente, placa")
          .eq("idempresa", idempresa)
        if (filtros.desde) q = q.gte("fechacargue", filtros.desde)
        if (filtros.hasta) q = q.lte("fechacargue", filtros.hasta)
        const { data, error } = await q.order("numeroorden").order("producto").order("toneladas").order("cantidad").order("tiquetebascula").range(offset, offset + 999)
        if (error) return { success: false, message: error.message }
        if (!data || data.length === 0) break
        detalleParaDenominador = detalleParaDenominador.concat(data)
        if (data.length < 1000) break
      }
    }
    const ordenTotalDet = new Map<string, number>() // Σ toneladas del detalle por orden (todos los owners)
    for (const r of detalleParaDenominador) {
      const on = String(r.numeroorden || "").trim()
      if (!on || !procesadas.has(on)) continue
      if (esExcluida(r)) continue
      const servicio = servicioDe(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa)
      if (filtraOperacion(r, servicio)) continue
      ordenTotalDet.set(on, (ordenTotalDet.get(on) || 0) + num(r.toneladas))
    }

    const cantMapControl = await cantidadesPorUnidad(
      sb,
      facturas.filter((r) => esProductoPorUnidad(r.subcategoria)).map((r) => ({ numeroorden: r.numeroorden, producto: r.producto })),
    )
    // El EMPAQUE (Papel, Polipropileno) no tiene tarifa propia en `tarifasoperacion`
    // -- sin este paso, `lookupTarifa` caía al fallback "tarifa más alta configurada"
    // para ese owner/operación (ej. Mogolla $19.416), encareciendo cualquier orden
    // que llevara un poco de empaque de más. Se calcula primero el total de
    // PRODUCTO real (sin empaque) por orden×owner, para tarifar el empaque a esa
    // MISMA tarifa efectiva (confirmado por el usuario: el empaque solo suma peso,
    // no cambia la tarifa).
    const productoTonPorOrdenOwner = new Map<string, number>()
    const productoValorPorOrdenOwner = new Map<string, number>()
    for (const r of facturas) {
      const on = String(r.numeroorden || "").trim()
      if (!on || !procesadas.has(on)) continue
      if (esExcluida(r)) continue
      if (esEmpaque(r.subcategoria)) continue
      const servicio = servicioDe(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa)
      if (filtraOperacion(r, servicio)) continue
      const owner = ownerDeLinea(idempresa, r.placa, String(r.owner || "SIN OWNER"), r.tipooperacion)
      const ton = num(r.toneladas)
      const tarifa = tarifaDeServicio(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa, owner, r.subcategoria, tarifas)
      const k = key(on, owner)
      productoTonPorOrdenOwner.set(k, (productoTonPorOrdenOwner.get(k) || 0) + ton)
      productoValorPorOrdenOwner.set(k, (productoValorPorOrdenOwner.get(k) || 0) + ton * tarifa)
    }
    for (const r of facturas) {
      const on = String(r.numeroorden || "").trim()
      if (!on || !procesadas.has(on)) continue
      if (esExcluida(r)) continue
      const servicio = servicioDe(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa)
      if (filtraOperacion(r, servicio)) continue
      const owner = ownerDeLinea(idempresa, r.placa, String(r.owner || "SIN OWNER"), r.tipooperacion)
      const ton = num(r.toneladas)
      let tarifa: number
      if (esEmpaque(r.subcategoria)) {
        const kEmp = key(on, owner)
        const tonProducto = productoTonPorOrdenOwner.get(kEmp) || 0
        const valorProducto = productoValorPorOrdenOwner.get(kEmp) || 0
        // Sin producto real en la misma orden (caso raro, empaque suelto): se
        // cae al cálculo normal en vez de dejarlo sin tarifa.
        tarifa = tonProducto > 0 ? valorProducto / tonProducto : tarifaDeServicio(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa, owner, r.subcategoria, tarifas)
      } else {
        tarifa = tarifaDeServicio(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa, owner, r.subcategoria, tarifas)
      }
      const sinTarifa = tarifa <= 0
      // Huevos (y cualquier producto por unidad): se cobra la CANTIDAD digitada,
      // no el peso. Ver esProductoPorUnidad.
      const porUnidad = esProductoPorUnidad(r.subcategoria)
      const cantidad = porUnidad ? cantMapControl.get(`${on}|||${String(r.producto || "").trim()}`) || 0 : 0
      const valorLinea = (porUnidad ? cantidad : ton) * tarifa
      const k = key(on, owner)
      const a = accMap.get(k)
      if (a) {
        a.tonDet += ton
        a.cantidadDet += cantidad
        a.valorDet += valorLinea
        a.sinTarifa = a.sinTarifa && sinTarifa
        a.porUnidad = a.porUnidad || porUnidad
      } else {
        accMap.set(k, { on, owner, op: r.tipooperacion || "", tonDet: ton, cantidadDet: cantidad, valorDet: valorLinea, sinTarifa, r, porUnidad })
      }
    }

    const filasMap = new Map<string, ControlFacturaFila>()
    for (const [k, a] of accMap) {
      const est = estadoPorOrden.get(a.on)
      // Huevos (y cualquier producto por unidad): "toneladas" es en realidad la
      // cantidad digitada — la báscula no le aplica, se cobra tal cual.
      let toneladas = a.porUnidad ? a.cantidadDet : a.tonDet
      let valor = a.valorDet
      let fuente: "bascula" | "orden" = "orden"
      // Plantas id1/2: SIEMPRE báscula. Cedis id3/4 (sin báscula): SOLO el DESCARGUE
      // se prorratea por el peso del tiquete (pesovascula digitado del origen), para que
      // el valor cuadre con lo realmente descargado; Cargue/Distribución de cedis siguen
      // con el peso del detalle. Fallback: si no hay pesovascula (P<=0) usa el detalle.
      const esDescargueCedi =
        (idempresa === 3 || idempresa === 4) && String(a.op).trim().toLowerCase() === "descargue"
      if (!a.porUnidad && (esBascula || esDescargueCedi)) {
        const totalDet = ordenTotalDet.get(a.on) || 0
        // Cedis: báscula del tiquete NORMALIZADA a toneladas (con guarda). Plantas: cruda.
        const P = esDescargueCedi
          ? basculaTiqueteDescargue(est?.pesovascula ?? 0, totalDet)
          : est?.pesovascula ?? 0
        if (P > 0 && totalDet > 0) {
          const scale = P / totalDet // reparte el peso de báscula por participación del detalle
          toneladas = a.tonDet * scale
          valor = a.valorDet * scale
          fuente = "bascula"
        }
      }
      // Avimol (id2): Cargue/Descargue/Distribución con placa propia (transporte
      // AVIMOL) no se factura por tonelada — va cubierto por el fijo de 600
      // ton/mes; con transporte Zamudio/Terceros se factura a esa transportadora,
      // no a Avimol. Ver lib/facturacion-billed-party.ts. Huevos queda exento de
      // esta regla (siempre se factura a Avimol, sin importar el transporte).
      const fa = facturadoAOwner(idempresa, a.owner, a.op, a.r.transporte, a.r.subcategoria, a.r.placa)
      if (fa.cubiertoPorFijo) valor = 0
      // Filtro de OWNER sobre el owner YA RESUELTO (`fa.owner`), que es el que
      // se muestra en pantalla y el que alimenta el desplegable. Antes se
      // filtraba en SQL contra el owner del producto, asi que elegir "Terceros"
      // o "Zamudio" no devolvia nada.
      if (filtros.owner && ownerKey(fa.owner) !== ownerKey(filtros.owner)) continue
      // Mismo criterio que getPrefactura: ID3/ID4 no tienen báscula física, así
      // que el tiquete de Cargue/Distribución no es un dato real — se muestra el
      // número de la propia orden. Descargue no se toca (tiquete real, manual o
      // heredado del clon cross-empresa).
      const opNormFila = String(a.op).trim().toLowerCase()
      const esCargueODistribucionCedi =
        (idempresa === 3 || idempresa === 4) && (opNormFila === "cargue" || opNormFila === "distribucion")
      filasMap.set(k, {
        numeroorden: a.on,
        fecha: a.r.fechacargue ?? a.r.fechaorden ?? null,
        placa: a.r.placa ?? null,
        tiquete: esCargueODistribucionCedi ? a.on : a.r.tiquetebascula ?? null,
        tipooperacion: a.op || null,
        cliente: a.r.cliente ?? null,
        producto: a.r.producto ?? null,
        owner: fa.owner,
        transporte: a.r.transporte ?? null,
        mediopago: est?.mediopago ?? null,
        medioPagoEsperado: medioPagoEsperado(idempresa, a.r.transporte, { placa: a.r.placa, operacion: a.op }),
        medioPagoInconsistente: medioPagoInconsistente(idempresa, a.r.transporte, est?.mediopago, {
          placa: a.r.placa,
          operacion: a.op,
        }),
        toneladas,
        fuente_peso: fuente,
        tarifa: a.sinTarifa || toneladas <= 0 || fa.cubiertoPorFijo ? null : Math.round((valor / toneladas) * 100) / 100,
        valor_a_facturar: valor,
        sin_tarifa: a.sinTarifa,
        cubierto_por_fijo: fa.cubiertoPorFijo,
        estadofactura: est?.estado ?? null,
        categoria: categoriaDeFactura(est?.facturasiigo, est?.estado),
        valorpago: est?.valorpago ?? null,
        unidad: a.porUnidad ? "u" : "t",
      })
    }

    let filas = Array.from(filasMap.values())
    if (filtros.categoria) filas = filas.filter((f) => f.categoria === filtros.categoria)

    // 4) Resumen por owner + totales.
    const ownerMap = new Map<string, ResumenOwner>()
    const ordenesSet = new Set<string>()
    const ordenesSinGestionar = new Set<string>()
    const ordenesSinTarifa = new Set<string>()
    // Órdenes cuyo medio de pago contradice la regla del transporte (Avimol).
    const ordenesMedioPago = new Set<string>()
    const t = {
      ordenes: 0, toneladas: 0, valor_a_facturar: 0,
      val_facturado: 0, val_en_proceso: 0, val_sin_gestionar: 0,
      ordenes_sin_gestionar: 0, ordenes_sin_tarifa: 0, val_produccion: 0, ordenes_medio_pago: 0,
    }
    // Resumen por OWNER × TIPO DE OPERACIÓN (un owner puede tener Cargue, Descargue,
    // Distribución y se muestran separados). En los proyectos donde el TRANSPORTE
    // decide la condición de pago (Avimol) se abre además por transporte: sin eso
    // el cargue de terceros (contado) y el de Zamudio (crédito) quedarían sumados
    // en una sola línea y no habría cómo distinguirlos.
    const separaTransporte = proyectoConReglaMedioPago(idempresa)
    const transporteDe = (f: ControlFacturaFila) =>
      separaTransporte ? String(f.transporte ?? "").trim() || "(sin transporte)" : null
    // La unidad entra en la clave: un producto por UNIDAD (Huevos) nunca se
    // mezcla con el tonelaje de la misma operación/owner/transporte, o el
    // "toneladas" del grupo sumaría cantidad de unidades con peso real.
    const grupoKey = (owner: string, op: string, tr: string | null, unidad: UnidadCobro) =>
      (tr === null ? `${owner}|||${op}` : `${owner}|||${op}|||${tr}`) + `|||${unidad}`
    const ordenesInconsistentesPorGrupo = new Map<string, Set<string>>()
    for (const f of filas) {
      ordenesSet.add(f.numeroorden)
      if (f.categoria === "sin_gestionar") ordenesSinGestionar.add(f.numeroorden)
      if (f.sin_tarifa) ordenesSinTarifa.add(f.numeroorden)
      if (f.medioPagoInconsistente) ordenesMedioPago.add(f.numeroorden)
      const op = f.tipooperacion || "(sin operación)"
      const tr = transporteDe(f)
      const gk = grupoKey(f.owner, op, tr, f.unidad)
      const o = ownerMap.get(gk) || {
        owner: f.owner, operacion: op, ordenes: 0, toneladas: 0, valor_a_facturar: 0,
        val_facturado: 0, val_en_proceso: 0, val_sin_gestionar: 0,
        bloque: "operacion" as const, unidad: f.unidad,
        transporte: tr, medioPagoEsperado: f.medioPagoEsperado, ordenesInconsistentes: 0,
      }
      o.toneladas += f.toneladas
      o.valor_a_facturar += f.valor_a_facturar
      if (f.categoria === "facturado") o.val_facturado += f.valor_a_facturar
      else if (f.categoria === "en_proceso") o.val_en_proceso += f.valor_a_facturar
      else o.val_sin_gestionar += f.valor_a_facturar
      ownerMap.set(gk, o)
      if (f.medioPagoInconsistente) {
        const s = ordenesInconsistentesPorGrupo.get(gk) || new Set<string>()
        s.add(f.numeroorden)
        ordenesInconsistentesPorGrupo.set(gk, s)
      }
      if (f.unidad === "t") t.toneladas += f.toneladas
      t.valor_a_facturar += f.valor_a_facturar
      if (f.categoria === "facturado") t.val_facturado += f.valor_a_facturar
      else if (f.categoria === "en_proceso") t.val_en_proceso += f.valor_a_facturar
      else t.val_sin_gestionar += f.valor_a_facturar
    }
    // órdenes distintas por grupo
    const ordenesPorGrupo = new Map<string, Set<string>>()
    for (const f of filas) {
      const gk = grupoKey(f.owner, f.tipooperacion || "(sin operación)", transporteDe(f), f.unidad)
      const s = ordenesPorGrupo.get(gk) || new Set<string>()
      s.add(f.numeroorden)
      ordenesPorGrupo.set(gk, s)
    }
    for (const [gk, o] of ownerMap) {
      o.ordenes = ordenesPorGrupo.get(gk)?.size || 0
      o.ordenesInconsistentes = ordenesInconsistentesPorGrupo.get(gk)?.size || 0
    }

    t.ordenes = ordenesSet.size
    t.ordenes_sin_gestionar = ordenesSinGestionar.size
    t.ordenes_sin_tarifa = ordenesSinTarifa.size
    t.ordenes_medio_pago = ordenesMedioPago.size

    const porOwnerBase: ResumenOwner[] = Array.from(ownerMap.values())

    // -------------------------------------------------------------------
    // PRODUCCIÓN en el resumen. Sin esto el módulo miente por omisión: se abre
    // Avimol, se ve Cargue/Descargue/Distribución y parece que eso es todo lo
    // que se le factura, cuando la tolva y las horas extra son ~$39M al mes.
    // Mismo cálculo que la prefactura (`calcularProduccion`), para que las dos
    // pestañas no puedan mostrar cifras distintas.
    // -------------------------------------------------------------------
    const cfg = cfgFiltro
    const vigencia = vigenciaProduccion(cfg, filtros.desde, filtros.hasta)
    let produccionAviso: string | null = null
    const produccionAlertas: string[] = []

    if (cfg && cfg.fuente === "ordenes" && vigencia === "si") {
      // La tolva de Indupan ya está en `porOwner`: solo se etiqueta.
      const conceptosK = new Set(cfg.conceptos.map((c) => ownerKey(c)))
      for (const o of porOwnerBase) {
        if (conceptosK.has(ownerKey(o.operacion))) {
          o.bloque = "produccion"
          t.val_produccion += o.valor_a_facturar
        }
      }
    } else if (cfg && cfg.fuente === "conciliacion") {
      if (!filtros.desde || !filtros.hasta) {
        produccionAviso =
          `La producción de ${cfg.conceptos.slice(0, 4).join(", ")} y las horas extra NO están incluidas todavía: ` +
          `se calculan por período. Pon un rango en Desde/Hasta y dale Aplicar para verlas aquí.`
      } else if (vigencia !== "si") {
        produccionAviso = `El período es anterior al ${cfg.desde}: la producción no se cuenta.`
      } else {
        // Si un filtro deja al owner fuera, no tiene sentido agregarle producción.
        const ownerVisible = !filtros.owner || ownerKey(filtros.owner) === ownerKey(cfg.owner)
        if (!ownerVisible) {
          produccionAviso =
            `El filtro de Owner deja fuera a ${cfg.owner}, que es quien factura la producción, así que no se sumó.`
        } else if (!incluirProduccion) {
          produccionAviso =
            'El filtro de Operación no incluye "Producción", así que no se sumó. Márcala junto a las demás ' +
            "operaciones (o no marques ninguna) para ver la facturación completa del proyecto."
        } else {
          const prod = await calcularProduccion(cfg, filtros.desde, filtros.hasta)
          produccionAlertas.push(...prod.alertas)
          const yaEnOrdenes = new Set(porOwnerBase.map((o) => `${ownerKey(o.owner)}|||${ownerKey(o.operacion)}`))
          for (const c of prod.conceptos) {
            if (yaEnOrdenes.has(`${ownerKey(cfg.owner)}|||${ownerKey(c.concepto)}`)) continue
            porOwnerBase.push({
              owner: cfg.owner,
              operacion: c.concepto,
              ordenes: 0, // la producción no se mide en órdenes
              toneladas: c.cantidad,
              valor_a_facturar: c.valor,
              // Sin semáforo: no hay factura Siigo por registro. Dejarlo en
              // "sin gestionar" pintaría de rojo una alarma que no existe.
              val_facturado: 0,
              val_en_proceso: 0,
              val_sin_gestionar: 0,
              bloque: "produccion",
              unidad: c.unidad,
              // La producción no nace de una orden: no tiene transporte y no le
              // aplica la regla de condición de pago.
              transporte: null,
              medioPagoEsperado: null,
              ordenesInconsistentes: 0,
            })
            t.valor_a_facturar += c.valor
            t.val_produccion += c.valor
            if (c.unidad === "t") t.toneladas += c.cantidad
          }
        }
      }
    }

    // SERVICIOS ADICIONALES (Turnos/Horas Extra aprobados) de un proyecto que
    // no tiene el circuito de "conciliación" de Avimol -- mismo patrón que el
    // bloque de arriba, independiente de `cfg`/`cfgFiltro` (un proyecto puede
    // tener producción-por-orden Y servicios adicionales a la vez).
    const cfgServAd = serviciosAdicionalesDelProyecto(idempresa)
    if (cfgServAd) {
      if (!filtros.desde || !filtros.hasta) {
        produccionAviso =
          (produccionAviso ? `${produccionAviso} ` : "") +
          "Los Servicios Adicionales (turnos/horas extra aprobados) NO están incluidos todavía: se calculan por " +
          "período. Pon un rango en Desde/Hasta y dale Aplicar para verlos aquí."
      } else {
        const servAd = await calcularServiciosAdicionalesIndupan(filtros.desde, filtros.hasta)
        produccionAlertas.push(...servAd.alertas)
        const yaEnOrdenes = new Set(porOwnerBase.map((o) => `${ownerKey(o.owner)}|||${ownerKey(o.operacion)}`))
        for (const c of servAd.conceptos) {
          if (yaEnOrdenes.has(`${ownerKey(cfgServAd.owner)}|||${ownerKey(c.concepto)}`)) continue
          porOwnerBase.push({
            owner: cfgServAd.owner,
            operacion: c.concepto,
            ordenes: 0,
            toneladas: c.cantidad,
            valor_a_facturar: c.valor,
            val_facturado: 0,
            val_en_proceso: 0,
            val_sin_gestionar: 0,
            bloque: "produccion",
            unidad: c.unidad,
            transporte: null,
            medioPagoEsperado: null,
            ordenesInconsistentes: 0,
          })
          t.valor_a_facturar += c.valor
          t.val_produccion += c.valor
          if (c.unidad === "t") t.toneladas += c.cantidad
        }
      }
    }

    const porOwner = porOwnerBase.sort(
      (a, b) =>
        a.owner.localeCompare(b.owner) ||
        // La producción va después del movimiento de órdenes dentro del owner.
        (a.bloque === b.bloque ? 0 : a.bloque === "produccion" ? 1 : -1) ||
        a.operacion.localeCompare(b.operacion),
    )
    filas.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))

    return {
      success: true,
      data: {
        filas,
        porOwner,
        totales: t,
        // "Producción" se ofrece como un chip más del filtro de Operación, para
        // poder aislarla igual que Cargue o Descargue. Solo en los proyectos que
        // facturan por producción: en los demás sería un chip que no filtra nada.
        operaciones: cfg ? [...operaciones, OP_PRODUCCION] : operaciones,
        produccionNota: cfg?.nota ?? null,
        produccionAviso,
        produccionAlertas,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al calcular el control de facturación." }
  }
}

/**
 * Mapa empresa→placas activas de "Placas de Distribución" (tabla `distribucion_placas`),
 * serializable, para que un hook CLIENTE (que no puede usar el cliente admin de Supabase)
 * pueda hidratar el caché de `lib/distribucion-placas.ts` con `hidratarCachePlacas()` y
 * así ver la tabla real -- no el DEFAULT hardcodeado -- al llamar `facturadoAOwner()`.
 */
export async function getMapaPlacasDistribucion(): Promise<Record<number, string[]>> {
  return await cargarPlacasDistribucion()
}

/**
 * Valor NETO por orden (mismo cálculo del cuadro/prefactura: cada operación × tarifa por
 * owner/id_empresa/subcategoría; báscula prorrateada en plantas). LIGERO: solo calcula
 * las órdenes que se le pasan (la página visible de Solicitar Facturas). Base antes de
 * IVA/retefuente (la factura de Siigo suma esos). Devuelve { ordendecargue: valorNeto }.
 */
export async function getValoresNetosOrden(
  idempresa: number,
  ordenes: string[],
): Promise<{ success: boolean; data: Record<string, number>; message?: string }> {
  if (!idempresa || !ordenes?.length) return { success: true, data: {} }
  try {
    const sb: any = await getSupabaseAdmin()
    await cargarPlacasDistribucion() // caché de placas de distribución para tarifaDeServicio
    const tarifas = await tarifasDeEmpresa(sb, idempresa)
    const placasExcluidas = new Set((PLACAS_EXCLUIDAS_FACTURAS[idempresa] || []).map((p) => p.toUpperCase()))
    const esBascula = idempresa === 1 || idempresa === 2
    const nums = [...new Set(ordenes.map((o) => String(o || "").trim()).filter(Boolean))]
    const chunks: string[][] = []
    for (let i = 0; i < nums.length; i += 200) chunks.push(nums.slice(i, i + 200))

    // Peso de báscula + tipo por orden. Plantas id1/2 prorratean todo; cedis id3/4 SOLO
    // el descargue (por el pesovascula del tiquete), consistente con el Cuadro/Prefactura.
    const pesoV = new Map<string, number>()
    const tipoOrden = new Map<string, string>()
    const esCedi = idempresa === 3 || idempresa === 4
    if (esBascula || esCedi) {
      for (const chunk of chunks) {
        const { data } = await sb
          .from("cabeceraoc")
          .select("ordendecargue, pesovascula, tipooperacion")
          .eq("idempresa", idempresa)
          .in("ordendecargue", chunk)
          .neq("tipooperacion", "proyeccion")
        for (const o of data || []) {
          const on = String(o.ordendecargue || "").trim()
          // Un mismo `ordendecargue` puede tener MÁS DE UN `cabeceraoc` (ej. un
          // descargue manual de terceros con dos pesajes/tiquetes bajo el mismo
          // número de orden): sumar `pesovascula` en vez de sobreescribir, o el
          // peso del segundo tiquete se pierde y "Valor Neto Orden" queda corto.
          pesoV.set(on, (pesoV.get(on) || 0) + num(o.pesovascula))
          tipoOrden.set(on, String(o.tipooperacion ?? "").trim().toLowerCase())
        }
      }
    }

    // EMPAQUE (Papel, Polipropileno): no tiene tarifa propia -- sin esto,
    // tarifaDeServicio caía al fallback "tarifa más alta configurada". Total de
    // PRODUCTO real (sin empaque) por orden, para tarifar el empaque a esa
    // misma tarifa efectiva (mismo criterio que getControlFacturacion/getPrefactura).
    const productoTonPorOrden = new Map<string, number>()
    const productoValorPorOrden = new Map<string, number>()
    for (const chunk of chunks) {
      const { data } = await sb
        .from("facturacion")
        .select("numeroorden, owner, subcategoria, toneladas, tipooperacion, transporte, placa, cliente")
        .eq("idempresa", idempresa)
        .in("numeroorden", chunk)
      for (const r of data || []) {
        const on = String(r.numeroorden || "").trim()
        if (esEmpaque(r.subcategoria)) continue
        const placa = String(r.placa ?? "").trim().toUpperCase()
        const cl = String(r.cliente ?? "").toUpperCase()
        if (placasExcluidas.has(placa) && !cl.includes("SUSANITA")) continue
        const owner = ownerDeLinea(idempresa, r.placa, String(r.owner || "SIN OWNER"), r.tipooperacion)
        const ton = num(r.toneladas)
        const tarifa = tarifaDeServicio(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa, owner, r.subcategoria, tarifas)
        productoTonPorOrden.set(on, (productoTonPorOrden.get(on) || 0) + ton)
        productoValorPorOrden.set(on, (productoValorPorOrden.get(on) || 0) + ton * tarifa)
      }
    }

    // Líneas de la vista SOLO de esas órdenes.
    const valorAcc = new Map<string, number>()
    const totalDet = new Map<string, number>()
    // Órdenes con al menos una línea por UNIDAD (Huevos): quedan fuera del
    // prorrateo por báscula (su "toneladas" es cantidad, no peso).
    const ordenesPorUnidad = new Set<string>()
    for (const chunk of chunks) {
      const { data } = await sb
        .from("facturacion")
        .select("numeroorden, owner, subcategoria, producto, toneladas, tipooperacion, transporte, placa, cliente")
        .eq("idempresa", idempresa)
        .in("numeroorden", chunk)
      const cantMap = await cantidadesPorUnidad(
        sb,
        (data || []).filter((r: any) => esProductoPorUnidad(r.subcategoria)).map((r: any) => ({ numeroorden: r.numeroorden, producto: r.producto })),
      )
      for (const r of data || []) {
        const on = String(r.numeroorden || "").trim()
        const placa = String(r.placa ?? "").trim().toUpperCase()
        const cl = String(r.cliente ?? "").toUpperCase()
        if (placasExcluidas.has(placa) && !cl.includes("SUSANITA")) continue // WMP446 salvo Susanita
        const owner = ownerDeLinea(idempresa, r.placa, String(r.owner || "SIN OWNER"), r.tipooperacion)
        const ton = num(r.toneladas)
        let tarifa: number
        if (esEmpaque(r.subcategoria)) {
          const tonProducto = productoTonPorOrden.get(on) || 0
          const valorProducto = productoValorPorOrden.get(on) || 0
          tarifa = tonProducto > 0 ? valorProducto / tonProducto : tarifaDeServicio(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa, owner, r.subcategoria, tarifas)
        } else {
          tarifa = tarifaDeServicio(idempresa, r.tipooperacion, r.transporte, r.cliente, r.placa, owner, r.subcategoria, tarifas)
        }
        // Avimol (id2) placa propia: cubierto por el fijo, no se factura por
        // tonelada — pero SÍ cuenta en totalDet (denominador del prorrateo de
        // báscula de la orden). Ver lib/facturacion-billed-party.ts. Huevos
        // queda exento (siempre se factura a Avimol, sin importar el transporte).
        const fa = facturadoAOwner(idempresa, owner, r.tipooperacion, r.transporte, r.subcategoria, r.placa)
        const porUnidad = esProductoPorUnidad(r.subcategoria)
        if (porUnidad) ordenesPorUnidad.add(on)
        const cantidad = porUnidad ? cantMap.get(`${on}|||${String(r.producto || "").trim()}`) || 0 : 0
        valorAcc.set(on, (valorAcc.get(on) || 0) + (fa.cubiertoPorFijo ? 0 : (porUnidad ? cantidad : ton) * tarifa))
        totalDet.set(on, (totalDet.get(on) || 0) + ton)
      }
    }

    const map: Record<string, number> = {}
    for (const [on, valor] of valorAcc) {
      let v = valor
      const esDescCedi = esCedi && tipoOrden.get(on) === "descargue"
      if (!ordenesPorUnidad.has(on) && (esBascula || esDescCedi)) {
        const td = totalDet.get(on) || 0
        // Cedis descargue: báscula del tiquete normalizada a toneladas (con guarda).
        const P = esDescCedi ? basculaTiqueteDescargue(pesoV.get(on) || 0, td) : pesoV.get(on) || 0
        if (P > 0 && td > 0) v = valor * (P / td) // prorratea el valor al peso de báscula
      }
      map[on] = Math.round(v)
    }
    return { success: true, data: map }
  } catch (e: any) {
    return { success: false, data: {}, message: e?.message || "Error al calcular valores netos." }
  }
}
