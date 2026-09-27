"use server"

/**
 * CIERRE FINANCIERO POR PROYECTO — lo PAGADO contra lo FACTURADO, por día y
 * acumulado del mes, proceso por proceso.
 *
 * Responde tres preguntas que el Cuadro no respondía junto:
 *   1. ¿Cuánto se cobró y cuánto se pagó HOY y en lo corrido del mes, en ESTE
 *      proyecto? (amarrado al selector del módulo, no al global)
 *   2. ¿Cada proceso está pagando y facturando lo que le corresponde? El cargue
 *      paga toneladas y factura toneladas; el Estibado PT paga turnos y factura
 *      producción; los turnos adicionales se cobran según la solicitud aprobada.
 *   3. ¿Qué está facturado de verdad (factura Siigo), qué está en trámite y qué
 *      nadie ha gestionado — y hace cuántos días?
 *
 * EL VALOR SE REUSA, NO SE RECALCULA:
 *   · Órdenes → `getValoresNetosOrden` (el mismo cálculo del Cuadro/Prefactura,
 *     con báscula prorrateada). Cierre y Cuadro tienen que cuadrar entre sí.
 *   · Producción, turnos y horas extra de Avimol → `getConciliacionAvimol`
 *     (turnos = lo SOLICITADO Y APROBADO respetando `cobraturno`; horas extra =
 *     las 5 clases sin el −0,66 obsoleto).
 *   · Costo → `pagonomina` paginada: `total_liquidado_dia` MÁS el bono de
 *     destajo `MAX(0, Σ bonif_prestacional)` por persona y quincena — el mismo
 *     neteo del archivo plano, de parafiscales y del estado de resultados.
 *     Sumar solo `total_liquidado_dia` subestima el costo.
 *
 * La atribución de cada peso pagado a su proceso vive declarada en
 * lib/cierre-financiero-procesos.ts.
 *
 * Es un LECTOR: no escribe nada.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getValoresNetosOrden } from "@/lib/facturacion-control-actions"
import { getConciliacionAvimol } from "@/lib/conciliacion-avimol-actions"
import { getAccessibleEmpresesFromPermisos } from "@/lib/orders-actions"
import { medioPagoEsperado, medioPagoEsperadoSinAmbiguedad, medioPagoInconsistente } from "@/lib/facturacion-medio-pago"
import { produccionDelProyecto, serviciosAdicionalesDelProyecto } from "@/lib/facturacion-produccion-conceptos"
import { calcularServiciosAdicionalesIndupan } from "@/lib/servicios-adicionales-indupan-actions"
import {
  ETIQUETA_PROCESO,
  ORDEN_PROCESOS,
  REGLA_PROCESO,
  procesoDeActividad,
  type ProcesoCierre,
} from "@/lib/cierre-financiero-procesos"
import { GESTION_LIPGO_DESDE } from "@/lib/facturacion-constantes"
import { getParafiscales } from "@/lib/parafiscales-actions"

const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()

/** Hoy en Bogotá. `new Date().toISOString()` daría el día equivocado de noche. */
function hoyBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
}

/** Resta días a una fecha ISO sin tocar zonas horarias. */
function restarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - dias)
  return dt.toISOString().slice(0, 10)
}

/** Días entre dos fechas ISO (b − a). */
function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number)
  const [yb, mb, db] = b.split("-").map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000)
}

/** Soporte de pago cargado — mismo parseo tolerante del cierre del día:
 *  `cabeceraoc.comprobante` es TEXT con JSON.stringify(string[]) pero el
 *  histórico guarda URLs sueltas. */
function tieneSoporte(comprobante: unknown): boolean {
  const s = String(comprobante ?? "").trim()
  if (s === "" || s === "[]" || s === "null") return false
  if (s.startsWith("[")) {
    try {
      return (JSON.parse(s) as unknown[]).length > 0
    } catch {
      return true
    }
  }
  return true
}

const tieneFacturaSiigo = (v: unknown) => String(v ?? "").trim() !== ""

/** REGLA CANÓNICA de "¿facturado de verdad?" — copia de
 *  facturacion-control-actions.ts:categoriaDeFactura (interna de un módulo
 *  "use server": no puede exportarse por no ser async). Manda `facturasiigo`,
 *  no `estadofactura`. */
type CategoriaFactura = "facturado" | "en_proceso" | "sin_gestionar"
function categoriaDeFactura(facturasiigo: unknown, estado: unknown): CategoriaFactura {
  if (String(facturasiigo ?? "").trim() !== "") return "facturado"
  const e = String(estado ?? "").trim()
  if (e !== "" && !/pendiente/i.test(e)) return "en_proceso"
  return "sin_gestionar"
}

// ---------------------------------------------------------------------------
// Tipos de la respuesta
// ---------------------------------------------------------------------------

export interface DetalleProceso {
  nombre: string
  cobroDia: number
  cobroMes: number
  costoDia: number
  costoMes: number
}

export interface LineaProceso {
  proceso: ProcesoCierre
  etiqueta: string
  comoPaga: string
  comoFactura: string
  cobroDia: number
  cobroMes: number
  costoOpDia: number
  costoOpMes: number
  costoAdDia: number
  costoAdMes: number
  /** null en los procesos que por definición no facturan (festivo/sin registro):
   *  su costo resta en el TOTAL, no en un margen propio que no significa nada. */
  margenDia: number | null
  margenMes: number | null
  detalle: DetalleProceso[]
}

export interface OrdenPendiente {
  numeroorden: string
  proyecto: string
  fecha: string | null
  dias: number
  categoria: CategoriaFactura
  valor: number
}

export interface TramoAntiguedad {
  tramo: string
  ordenes: number
  valor: number
}

export interface EstadoFacturas {
  /** Sobre las órdenes procesadas de los últimos 90 días hasta la fecha del cierre. */
  facturado: { ordenes: number; valor: number }
  enProceso: { ordenes: number; valor: number }
  sinGestionar: { ordenes: number; valor: number }
  antiguedad: TramoAntiguedad[]
  maxDiasSinFactura: number
  pendientes: OrdenPendiente[] // las más viejas primero, tope 80
}

export interface AlertaCierre {
  tipo:
    | "margen_negativo"
    | "sin_registro"
    | "medio_pago_no_cuadra"
    | "sin_medio_pago"
    | "tercero_sin_respaldo"
    | "no_facturable_con_pago"
    | "orden_en_cero"
    | "fuera_del_plano"
    | "conciliacion_avimol"
    | "servicios_adicionales_indupan"
  nivel: "rojo" | "ambar"
  titulo: string
  valor: number
  cantidad: number
  detalle: string[] // líneas listas para mostrar, tope 40
}

export interface PuntoSerie {
  fecha: string
  cobro: number
  costo: number
  cobroAcum: number
  costoAcum: number
}

export interface CierreProyecto {
  idempresa: number
  proyecto: string
  cobroDia: number
  cobroMes: number
  costoDia: number
  costoMes: number
  margenDia: number
  margenMes: number
  margenPctMes: number | null
  /** Costo con la carga prestacional del estado de resultados (21,83% + 18,44%),
   *  para poder atar contra el P&L. El margen principal es contra la nómina
   *  directa (caja), que es la regla de alarma que pidió gerencia. */
  costoProvisionadoMes: number
  margenProvisionadoMes: number
  procesos: LineaProceso[]
  serie: PuntoSerie[]
  facturas: EstadoFacturas
  alertas: AlertaCierre[]
  notas: string[]
}

export interface CierreFinanciero {
  fecha: string
  desde: string // primer día del mes de `fecha`
  esHoy: boolean
  alcance: "proyecto" | "todos"
  proyectos: CierreProyecto[]
  total: CierreProyecto | null // solo cuando hay más de un proyecto
}

// ---------------------------------------------------------------------------
// Acumuladores
// ---------------------------------------------------------------------------

type Bucket = {
  cobroDia: number
  cobroMes: number
  costoOpDia: number
  costoOpMes: number
  costoAdDia: number
  costoAdMes: number
  detalle: Map<string, DetalleProceso>
}

const bucketVacio = (): Bucket => ({
  cobroDia: 0,
  cobroMes: 0,
  costoOpDia: 0,
  costoOpMes: 0,
  costoAdDia: 0,
  costoAdMes: 0,
  detalle: new Map(),
})

function detalleDe(b: Bucket, nombre: string): DetalleProceso {
  let d = b.detalle.get(nombre)
  if (!d) {
    d = { nombre, cobroDia: 0, cobroMes: 0, costoDia: 0, costoMes: 0 }
    b.detalle.set(nombre, d)
  }
  return d
}

// Factor de prestaciones sociales del estado de resultados (use-costo-nomina.ts):
// 21,83% (cesantías 8,33 + intereses 1 + prima 8,33 + vacaciones 4,17). Se
// replica para que las dos pantallas aten -- sigue siendo una PROVISIÓN
// contable estimada para personal activo (no hay un "real" para algo que aún
// no se causa; ver Fase 3b en la memoria de este cierre).
const FACTOR_PRESTACIONES = 1.2183

// Seguridad social YA NO es un % plano (era 18,44% aquí) -- se reemplazó por
// el aporte patronal REAL de Parafiscales (pensión+ARL+caja+salud patronal+
// SENA+ICBF), prorrateado a los días transcurridos del mes si `fecha` no es
// fin de mes. Confirmado por el usuario 2026-09-07: "el costo de nómina debe
// ser el real, como se pagó". Ver `calcularSegSocialRealMes` más abajo.
async function calcularSegSocialRealMes(idempresa: number, desde: string, fecha: string): Promise<number> {
  const anio = Number(desde.slice(0, 4))
  const mes = Number(desde.slice(5, 7))
  const diasMes = new Date(anio, mes, 0).getDate()
  const diaFecha = Number(fecha.slice(8, 10))
  const fraccion = Math.min(1, Math.max(0, diaFecha / diasMes))
  const r = await getParafiscales(idempresa, anio, mes)
  if (!r.success || !r.resumen) return 0
  return r.resumen.totalEmpresa * fraccion
}

// ---------------------------------------------------------------------------
// El cálculo de UN proyecto
// ---------------------------------------------------------------------------

async function cierreDeProyecto(
  sb: any,
  idempresa: number,
  proyecto: string,
  fecha: string,
  desde: string,
): Promise<CierreProyecto> {
  const notas: string[] = []
  const alertas: AlertaCierre[] = []
  const buckets = new Map<ProcesoCierre, Bucket>()
  const bucket = (p: ProcesoCierre) => {
    let b = buckets.get(p)
    if (!b) {
      b = bucketVacio()
      buckets.set(p, b)
    }
    return b
  }
  const serieMap = new Map<string, { cobro: number; costo: number }>()
  const punto = (f: string) => {
    let s = serieMap.get(f)
    if (!s) {
      s = { cobro: 0, costo: 0 }
      serieMap.set(f, s)
    }
    return s
  }

  // -------------------------------------------------------------------------
  // 1) ÓRDENES: del mes para el cobro, y 90 días hacia atrás para el estado de
  //    facturación (la cartera pendiente no se corta en el día 1 del mes).
  //    Piso GESTION_LIPGO_DESDE: lo anterior a jul-2026 ya se facturó en Siigo
  //    manualmente (confirmado por gerencia) — no debe seguir apareciendo como
  //    "sin gestionar" solo porque los 90 días rodantes alcanzan a tocarlo.
  // -------------------------------------------------------------------------
  const desde90 = restarDias(fecha, 90) > GESTION_LIPGO_DESDE ? restarDias(fecha, 90) : GESTION_LIPGO_DESDE
  const ordenes: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("cabeceraoc")
      .select(
        "ordendecargue, fechacargue, tipooperacion, placa, transporte, mediopago, estadofactura, facturasiigo, comprobante, fincargue, facturar",
      )
      .eq("idempresa", idempresa)
      .gte("fechacargue", desde90)
      .lte("fechacargue", fecha)
      .neq("tipooperacion", "proyeccion")
      .range(off, off + 999)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    ordenes.push(...data)
    if (data.length < 1000) break
  }

  const procesadas = ordenes.filter((o) => o.fincargue && o.facturar !== false)
  const noFacturables = ordenes.filter(
    (o) => o.fincargue && o.facturar === false && String(o.fechacargue ?? "").slice(0, 10) >= desde,
  )

  // Valor neto por orden — el MISMO cálculo del Cuadro. Una sola llamada.
  const valorDe = new Map<string, number>()
  {
    const nums = [...procesadas, ...noFacturables].map((o) => String(o.ordendecargue || "").trim()).filter(Boolean)
    if (nums.length) {
      const r = await getValoresNetosOrden(idempresa, nums)
      if (r.success) for (const [on, v] of Object.entries(r.data)) valorDe.set(on, num(v))
      else notas.push(`No se pudo valorar las órdenes: ${r.message || "error desconocido"}.`)
    }
  }

  // Vigencia de producción por órdenes (la tolva de Indupan cuenta como
  // producción desde su fecha; antes suma como operación, igual que en la
  // prefactura).
  const cfgProd = produccionDelProyecto(idempresa)
  const desdeProdOrdenes = cfgProd?.fuente === "ordenes" ? cfgProd.desde : null

  const alDetalleMes = (d: DetalleProceso, esDia: boolean, cobro: number) => {
    d.cobroMes += cobro
    if (esDia) d.cobroDia += cobro
  }

  // Cobro de órdenes del mes, clasificado a su proceso.
  const detalleMedioPago: string[] = []
  let valorMedioPago = 0
  const detalleSinMedio: string[] = []
  let valorSinMedio = 0
  const detalleTercero: string[] = []
  let valorTercero = 0
  const detalleEnCero: string[] = []
  let enCero = 0

  for (const o of procesadas) {
    const f = String(o.fechacargue ?? "").slice(0, 10)
    if (f < desde) continue // las viejas solo participan del estado de facturación
    const on = String(o.ordendecargue || "").trim()
    const valor = valorDe.get(on) || 0
    const esDia = f === fecha
    const op = norm(o.tipooperacion)

    let proceso: ProcesoCierre = "destajo"
    let nombre = "Cargue"
    if (op === "DESCARGUE") nombre = "Descargue"
    else if (op === "DISTRIBUCION") nombre = "Distribución"
    else if (op.startsWith("TOLVA")) {
      nombre = "Tolva (órdenes)"
      if (desdeProdOrdenes && f >= desdeProdOrdenes) proceso = "produccion"
    } else if (op !== "CARGUE") nombre = String(o.tipooperacion ?? "").trim() || "(sin operación)"

    const b = bucket(proceso)
    b.cobroMes += valor
    if (esDia) b.cobroDia += valor
    alDetalleMes(detalleDe(b, nombre), esDia, valor)
    punto(f).cobro += valor

    // Controles de la orden (mes)
    const ctx = { placa: o.placa, operacion: o.tipooperacion }
    if (medioPagoInconsistente(idempresa, o.transporte, o.mediopago, ctx)) {
      valorMedioPago += valor
      detalleMedioPago.push(
        `${on} · ${String(o.placa ?? "").trim() || "sin placa"} · ${String(o.transporte ?? "").trim()} debe ser ${medioPagoEsperado(idempresa, o.transporte, ctx)} y quedó ${String(o.mediopago).trim()}`,
      )
    }
    // "Sin medio de pago" SOLO cuando ni el dato ni la regla INCONDICIONAL lo
    // definen. Indupan/Funza y el resto de Avimol son fijos por regla, así que
    // un campo vacío ahí no es un pendiente. Avimol-Zamudio SÍ depende de la
    // placa (12 excepciones): sin el dato, no se asume — sigue como pendiente.
    if (!medioPagoEsperadoSinAmbiguedad(idempresa, o.transporte, ctx) && String(o.mediopago ?? "").trim() === "") {
      valorSinMedio += valor
      detalleSinMedio.push(`${on} · ${f} · sin medio de pago registrado y sin regla que lo defina`)
    }
    if (norm(o.transporte) === "TERCEROS" && idempresa === 2) {
      const sinSoporte = !tieneSoporte(o.comprobante)
      const sinFactura = !tieneFacturaSiigo(o.facturasiigo)
      if (sinSoporte || sinFactura) {
        valorTercero += valor
        const falta = [sinSoporte ? "sin soporte de pago" : null, sinFactura ? "sin factura Siigo" : null]
          .filter(Boolean)
          .join(" y ")
        detalleTercero.push(`${on} · ${f} · ${falta}`)
      }
    }
    if (valor <= 0) {
      enCero++
      detalleEnCero.push(`${on} · ${f} · ${String(o.tipooperacion ?? "").trim()} valorada en $0 (¿sin tarifa en el maestro?)`)
    }
  }

  // -------------------------------------------------------------------------
  // 2) PRODUCCIÓN / TURNOS / HORAS EXTRA de Avimol — mismo motor de la
  //    conciliación, día a día.
  // -------------------------------------------------------------------------
  if (cfgProd?.fuente === "conciliacion") {
    const conc = await getConciliacionAvimol(desde, fecha)
    if (conc.success && conc.data) {
      for (const d of conc.data.dias) {
        const esDia = d.fecha === fecha
        const bp = bucket("produccion")
        bp.cobroMes += d.cobroProduccion
        if (esDia) bp.cobroDia += d.cobroProduccion
        for (const p of d.productos) alDetalleMes(detalleDe(bp, p.operacion), esDia, p.cobro)

        const bt = bucket("turnos")
        bt.cobroMes += d.cobroTurnos
        if (esDia) bt.cobroDia += d.cobroTurnos
        for (const t of d.detalleTurnos) if (t.cobro > 0) alDetalleMes(detalleDe(bt, `Turno · ${t.puesto}`), esDia, t.cobro)

        const bh = bucket("horas_extra")
        bh.cobroMes += d.cobroHorasExtra
        if (esDia) bh.cobroDia += d.cobroHorasExtra
        for (const h of d.detalleHorasExtra) if (h.cobro > 0) alDetalleMes(detalleDe(bh, `Hora extra · ${h.puesto}`), esDia, h.cobro)

        const s = punto(d.fecha)
        s.cobro += d.cobroTotal
      }
      if (conc.data.alertas.length) {
        alertas.push({
          tipo: "conciliacion_avimol",
          nivel: "ambar",
          titulo: "Avisos de la conciliación de Avimol (producción, turnos y horas extra)",
          valor: 0,
          cantidad: conc.data.alertas.length,
          detalle: conc.data.alertas.slice(0, 40).map((a) => a.detalle),
        })
      }
    } else {
      notas.push(`No se pudo calcular la producción de la conciliación: ${conc.message || "error desconocido"}.`)
    }
  } else if (serviciosAdicionalesDelProyecto(idempresa)) {
    // SERVICIOS ADICIONALES (Turnos/Horas Extra aprobados) de un proyecto sin
    // el circuito de conciliación de Avimol -- hoy solo Indupan. Mismo motor
    // que la Prefactura (calcularServiciosAdicionalesIndupan), para que el
    // Cierre Financiero no diverja de lo realmente facturado. Reemplaza la
    // vista legacy `facturacionturnos` (que factura por EJECUCIÓN) para este
    // proyecto -- no se leen las dos, o el cobro quedaría duplicado/desfasado.
    const servAd = await calcularServiciosAdicionalesIndupan(desde, fecha)
    for (const l of servAd.soporte) {
      if (!l.fecha || l.valor <= 0) continue
      const esDia = l.fecha === fecha
      const bucketNombre = l.servicio === "Turno" ? "turnos" : "horas_extra"
      const b = bucket(bucketNombre)
      b.cobroMes += l.valor
      if (esDia) b.cobroDia += l.valor
      alDetalleMes(detalleDe(b, l.operacion), esDia, l.valor)
      punto(l.fecha).cobro += l.valor
    }
    if (servAd.alertas.length) {
      alertas.push({
        tipo: "servicios_adicionales_indupan",
        nivel: "ambar",
        titulo: "Avisos de Servicios Adicionales (turnos/horas extra aprobados)",
        valor: 0,
        cantidad: servAd.alertas.length,
        detalle: servAd.alertas.slice(0, 40),
      })
    }
  } else {
    // TURNOS ADICIONALES fuera de Avimol y de proyectos con Servicios
    // Adicionales propio (Funza, Medellín): se facturan por la vista
    // `facturacionturnos` (Distribución Turno, etc.), no por solicitud
    // aprobada -- ahí todavía no hay forma de resolver a qué Owner facturar
    // (ver lib/facturacion-produccion-conceptos.ts). Sin este bloque el costo
    // del turno se veía en la nómina y su cobro nunca se buscaba: el proceso
    // salía pagando sin facturar nada.
    let filasHT: Array<{ fecha: string; puesto: string; total: number }> = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb
        .from("facturacionturnos")
        .select("fecha, puesto, facturacion_total")
        .eq("idempresa", idempresa)
        .gte("fecha", desde)
        .lte("fecha", fecha)
        .range(off, off + 999)
      if (error) {
        notas.push(`No se pudo leer la facturación de turnos: ${error.message}.`)
        break
      }
      if (!data || data.length === 0) break
      for (const r of data) {
        filasHT.push({ fecha: String(r.fecha).slice(0, 10), puesto: String(r.puesto ?? "").trim(), total: num(r.facturacion_total) })
      }
      if (data.length < 1000) break
    }
    for (const r of filasHT) {
      if (r.total <= 0) continue
      const esDia = r.fecha === fecha
      const bt = bucket("turnos")
      bt.cobroMes += r.total
      if (esDia) bt.cobroDia += r.total
      alDetalleMes(detalleDe(bt, r.puesto || "(sin puesto)"), esDia, r.total)
      punto(r.fecha).cobro += r.total
    }
  }

  // -------------------------------------------------------------------------
  // 3) COSTO — pagonomina del mes, paginada. Cada fila se parte en dos: los
  //    recargos van al proceso "horas_extra" (ahí es donde se cobran) y el
  //    resto al proceso de su actividad. El bono de destajo se agrega por
  //    quincena con el MISMO neteo del archivo plano y se reparte entre los
  //    días con tonelaje de la persona, proporcional a su producción.
  // -------------------------------------------------------------------------
  const filasNomina: Array<{
    fecha: string
    persona: string
    actividad: string | null
    total: number
    recargos: number
    bonif: number
    pagoProd: number
    liq: number
  }> = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .rpc("pagonomina_rango", { p_desde: desde, p_hasta: fecha })
      .select(
        "fecha, persona, actividad_registrada, total_liquidado_dia, total_recargos, bonif_prestacional, pago_produccion, idempresa, idempresaliquidacion",
      )
      .eq("idempresa", idempresa)
      .gte("fecha", desde)
      .lte("fecha", fecha)
      // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
      .order("persona")
      .order("fecha")
      .range(off, off + 999)
    if (error) {
      notas.push(`No se pudo leer la nómina: ${error.message}. El cierre muestra solo el cobro.`)
      break
    }
    if (!data || data.length === 0) break
    for (const r of data) {
      filasNomina.push({
        fecha: String(r.fecha).slice(0, 10),
        persona: String(r.persona ?? "").trim(),
        actividad: r.actividad_registrada ?? null,
        total: num(r.total_liquidado_dia),
        recargos: num(r.total_recargos),
        bonif: num(r.bonif_prestacional),
        pagoProd: num(r.pago_produccion),
        liq: num(r.idempresaliquidacion),
      })
    }
    if (data.length < 1000) break
  }

  // Head Count: administrativo vs operativo + los filtros del archivo plano.
  const hc = new Map<string, { admin: boolean; estado: string; identificacion: string; contratosiigo: string }>()
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("headcount")
      .select("nombre, admin, estado, identificacion, contratosiigo")
      .range(off, off + 999)
    if (error) break
    if (!data || data.length === 0) break
    for (const r of data) {
      const k = String(r.nombre ?? "").trim()
      if (!k) continue
      hc.set(k, {
        admin: r.admin === true,
        estado: norm(r.estado),
        identificacion: String(r.identificacion ?? "").trim(),
        contratosiigo: String(r.contratosiigo ?? "").trim(),
      })
    }
    if (data.length < 1000) break
  }
  const hayAdmins = [...hc.values()].some((h) => h.admin)
  if (!hayAdmins) {
    notas.push(
      "Nadie está marcado como administrativo en Head Count, así que la columna administrativa va en $0. " +
        "Al marcar los administrativos, el cierre los separa solo.",
    )
  }

  const quincenaDe = (f: string) => `${f.slice(0, 7)}-${Number(f.slice(8, 10)) <= 15 ? "Q1" : "Q2"}`

  // Bono por persona+quincena: MAX(0, Σ bonif_prestacional) — el neteo canónico.
  // SOLO DESDE LA QUINCENA DEL 16-JUL-2026 (confirmado en el archivo plano):
  // antes la columna trae el excedente histórico que nunca se pagó como bono.
  const BONO_DESDE = "2026-07-16"
  const bonoQ = new Map<string, { bono: number; prodTotal: number }>()
  for (const r of filasNomina) {
    if (r.fecha < BONO_DESDE) continue
    const k = `${r.persona}|${quincenaDe(r.fecha)}`
    const b = bonoQ.get(k) || { bono: 0, prodTotal: 0 }
    b.bono += r.bonif
    if (r.pagoProd > 0) b.prodTotal += r.pagoProd
    bonoQ.set(k, b)
  }

  let costoSinRegistroMes = 0
  const fueraPlano = new Map<string, { motivo: string; valor: number }>()
  let pagadoEnOtroId = 0

  for (const r of filasNomina) {
    const esDia = r.fecha === fecha
    const h = hc.get(r.persona)
    const esAdmin = h?.admin === true
    const proceso = procesoDeActividad(r.actividad)

    // Recargos → horas extra; el resto → el proceso de la actividad.
    const recargos = Math.min(r.recargos, r.total)
    const resto = r.total - recargos

    const cargar = (p: ProcesoCierre, v: number, nombreDet: string) => {
      if (v === 0) return
      const b = bucket(p)
      b.costoOpMes += esAdmin ? 0 : v
      b.costoAdMes += esAdmin ? v : 0
      if (esDia) {
        b.costoOpDia += esAdmin ? 0 : v
        b.costoAdDia += esAdmin ? v : 0
      }
      const d = detalleDe(b, nombreDet)
      d.costoMes += v
      if (esDia) d.costoDia += v
      punto(r.fecha).costo += v
    }

    const nombreAct = String(r.actividad ?? "Sin Registro").trim() || "Sin Registro"
    cargar(proceso, resto, nombreAct)
    cargar("horas_extra", recargos, `Recargos · ${nombreAct}`)

    // Bono del destajo repartido al día, proporcional a su producción.
    const q = bonoQ.get(`${r.persona}|${quincenaDe(r.fecha)}`)
    if (q && q.bono > 0 && r.pagoProd > 0 && q.prodTotal > 0) {
      cargar("destajo", (q.bono * r.pagoProd) / q.prodTotal, "Bono de destajo (excedente)")
    }

    if (proceso === "sin_registro") costoSinRegistroMes += r.total

    // Lo que se paga aquí pero se LIQUIDA en otro proyecto (personal prestado).
    if (r.liq && r.liq !== idempresa && r.total > 0) pagadoEnOtroId += r.total

    // Personas que el archivo plano descarta: se liquidan pero NUNCA viajan a Siigo.
    if (r.total > 0) {
      let motivo: string | null = null
      if (!h) motivo = "no cruza con Head Count por nombre"
      else if (h.estado === "INACTIVO") motivo = "está INACTIVO en Head Count"
      else if (!h.identificacion) motivo = "sin cédula en Head Count"
      else if (!h.contratosiigo) motivo = "sin contrato Siigo"
      if (motivo) {
        const e = fueraPlano.get(r.persona) || { motivo, valor: 0 }
        e.valor += r.total
        fueraPlano.set(r.persona, e)
      }
    }
  }

  if (pagadoEnOtroId > 0) {
    notas.push(
      `$${Math.round(pagadoEnOtroId).toLocaleString("es-CO")} de esta nómina se liquida en OTRO proyecto ` +
        `(personal prestado): el estado de resultados lo carga allá.`,
    )
  }

  // Órdenes NO facturables que igual generaron pago de destajo (pagonomina no
  // filtra `facturar`): se pagó y se renunció al cobro.
  if (noFacturables.length) {
    const valor = noFacturables.reduce((a, o) => a + (valorDe.get(String(o.ordendecargue || "").trim()) || 0), 0)
    alertas.push({
      tipo: "no_facturable_con_pago",
      nivel: "ambar",
      titulo: "Órdenes marcadas NO facturables en el mes — el destajo se pagó igual",
      valor,
      cantidad: noFacturables.length,
      detalle: noFacturables
        .slice(0, 40)
        .map(
          (o) =>
            `${String(o.ordendecargue).trim()} · ${String(o.fechacargue).slice(0, 10)} · dejó de cobrarse $${Math.round(
              valorDe.get(String(o.ordendecargue || "").trim()) || 0,
            ).toLocaleString("es-CO")}`,
        ),
    })
  }

  // -------------------------------------------------------------------------
  // 4) GESTIÓN DE FACTURAS — 90 días de órdenes procesadas, con antigüedad.
  // -------------------------------------------------------------------------
  const facturas: EstadoFacturas = {
    facturado: { ordenes: 0, valor: 0 },
    enProceso: { ordenes: 0, valor: 0 },
    sinGestionar: { ordenes: 0, valor: 0 },
    antiguedad: [
      { tramo: "0-15 días", ordenes: 0, valor: 0 },
      { tramo: "16-30 días", ordenes: 0, valor: 0 },
      { tramo: "31-60 días", ordenes: 0, valor: 0 },
      { tramo: "61-90 días", ordenes: 0, valor: 0 },
    ],
    maxDiasSinFactura: 0,
    pendientes: [],
  }
  const pendientes: OrdenPendiente[] = []
  for (const o of procesadas) {
    const on = String(o.ordendecargue || "").trim()
    const valor = valorDe.get(on) || 0
    const cat = categoriaDeFactura(o.facturasiigo, o.estadofactura)
    const destino = cat === "facturado" ? facturas.facturado : cat === "en_proceso" ? facturas.enProceso : facturas.sinGestionar
    destino.ordenes++
    destino.valor += valor
    if (cat !== "facturado") {
      const f = String(o.fechacargue ?? "").slice(0, 10)
      const dias = f ? diasEntre(f, fecha) : 0
      const tramo = dias <= 15 ? 0 : dias <= 30 ? 1 : dias <= 60 ? 2 : 3
      facturas.antiguedad[tramo].ordenes++
      facturas.antiguedad[tramo].valor += valor
      if (dias > facturas.maxDiasSinFactura) facturas.maxDiasSinFactura = dias
      pendientes.push({ numeroorden: on, proyecto, fecha: f || null, dias, categoria: cat, valor })
    }
  }
  pendientes.sort((a, b) => b.dias - a.dias || b.valor - a.valor)
  facturas.pendientes = pendientes.slice(0, 80)

  // -------------------------------------------------------------------------
  // 5) Alertas restantes + armado final.
  // -------------------------------------------------------------------------
  if (costoSinRegistroMes > 0) {
    alertas.push({
      tipo: "sin_registro",
      nivel: "rojo",
      titulo: "Nómina pagada SIN registro de actividad — no se puede cobrar a ningún proceso",
      valor: costoSinRegistroMes,
      cantidad: 0,
      detalle: [
        "Días liquidados cuya actividad nadie registró en asistencia. Es plata que sale sin proceso que la respalde.",
      ],
    })
  }
  if (detalleMedioPago.length) {
    alertas.push({
      tipo: "medio_pago_no_cuadra",
      nivel: "rojo",
      titulo: "Medio de pago que contradice la regla del proyecto",
      valor: valorMedioPago,
      cantidad: detalleMedioPago.length,
      detalle: detalleMedioPago.slice(0, 40),
    })
  }
  if (detalleSinMedio.length) {
    alertas.push({
      tipo: "sin_medio_pago",
      nivel: "ambar",
      titulo: "Órdenes sin medio de pago registrado",
      valor: valorSinMedio,
      cantidad: detalleSinMedio.length,
      detalle: detalleSinMedio.slice(0, 40),
    })
  }
  if (detalleTercero.length) {
    alertas.push({
      tipo: "tercero_sin_respaldo",
      nivel: "rojo",
      titulo: "TERCEROS (contado) sin soporte de pago o sin factura Siigo",
      valor: valorTercero,
      cantidad: detalleTercero.length,
      detalle: detalleTercero.slice(0, 40),
    })
  }
  if (enCero > 0) {
    alertas.push({
      tipo: "orden_en_cero",
      nivel: "ambar",
      titulo: "Órdenes procesadas valoradas en $0",
      valor: 0,
      cantidad: enCero,
      detalle: detalleEnCero.slice(0, 40),
    })
  }
  if (fueraPlano.size) {
    let valor = 0
    const detalle: string[] = []
    for (const [persona, e] of fueraPlano) {
      valor += e.valor
      detalle.push(`${persona} · ${e.motivo} · $${Math.round(e.valor).toLocaleString("es-CO")} en el mes`)
    }
    alertas.push({
      tipo: "fuera_del_plano",
      nivel: "ambar",
      titulo: "Personal liquidado que el archivo plano descarta (no viaja a Siigo)",
      valor,
      cantidad: fueraPlano.size,
      detalle: detalle.slice(0, 40),
    })
  }

  // Procesos en orden fijo, solo los que tienen algo.
  const procesos: LineaProceso[] = []
  for (const p of ORDEN_PROCESOS) {
    const b = buckets.get(p)
    if (!b) continue
    const costoDia = b.costoOpDia + b.costoAdDia
    const costoMes = b.costoOpMes + b.costoAdMes
    if (b.cobroMes === 0 && costoMes === 0) continue
    const sinMargen = p === "festivo" || p === "sin_registro"
    procesos.push({
      proceso: p,
      etiqueta: ETIQUETA_PROCESO[p],
      comoPaga: REGLA_PROCESO[p].paga,
      comoFactura: REGLA_PROCESO[p].factura,
      cobroDia: Math.round(b.cobroDia),
      cobroMes: Math.round(b.cobroMes),
      costoOpDia: Math.round(b.costoOpDia),
      costoOpMes: Math.round(b.costoOpMes),
      costoAdDia: Math.round(b.costoAdDia),
      costoAdMes: Math.round(b.costoAdMes),
      margenDia: sinMargen ? null : Math.round(b.cobroDia - costoDia),
      margenMes: sinMargen ? null : Math.round(b.cobroMes - costoMes),
      detalle: [...b.detalle.values()]
        .map((d) => ({
          nombre: d.nombre,
          cobroDia: Math.round(d.cobroDia),
          cobroMes: Math.round(d.cobroMes),
          costoDia: Math.round(d.costoDia),
          costoMes: Math.round(d.costoMes),
        }))
        .sort((a, c) => c.cobroMes + c.costoMes - (a.cobroMes + a.costoMes)),
    })
  }

  // Serie ordenada + acumulados.
  const serie: PuntoSerie[] = [...serieMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([f, s]) => ({ fecha: f, cobro: Math.round(s.cobro), costo: Math.round(s.costo), cobroAcum: 0, costoAcum: 0 }))
  let ca = 0
  let co = 0
  for (const s of serie) {
    ca += s.cobro
    co += s.costo
    s.cobroAcum = ca
    s.costoAcum = co
  }

  const cobroDia = procesos.reduce((a, p) => a + p.cobroDia, 0)
  const cobroMes = procesos.reduce((a, p) => a + p.cobroMes, 0)
  const costoDia = procesos.reduce((a, p) => a + p.costoOpDia + p.costoAdDia, 0)
  const costoMes = procesos.reduce((a, p) => a + p.costoOpMes + p.costoAdMes, 0)

  if (cobroDia - costoDia < 0 && (cobroDia > 0 || costoDia > 0)) {
    alertas.unshift({
      tipo: "margen_negativo",
      nivel: "rojo",
      titulo: `HOY se está pagando más de lo que se cobra (margen $${Math.round(cobroDia - costoDia).toLocaleString("es-CO")})`,
      valor: costoDia - cobroDia,
      cantidad: 0,
      detalle: [],
    })
  }

  const segSocialRealMes = await calcularSegSocialRealMes(idempresa, desde, fecha)
  const costoProvisionadoMes = Math.round(costoMes * FACTOR_PRESTACIONES + segSocialRealMes)

  return {
    idempresa,
    proyecto,
    cobroDia: Math.round(cobroDia),
    cobroMes: Math.round(cobroMes),
    costoDia: Math.round(costoDia),
    costoMes: Math.round(costoMes),
    margenDia: Math.round(cobroDia - costoDia),
    margenMes: Math.round(cobroMes - costoMes),
    margenPctMes: cobroMes > 0 ? Math.round(((cobroMes - costoMes) / cobroMes) * 100) : null,
    costoProvisionadoMes,
    margenProvisionadoMes: Math.round(cobroMes - costoProvisionadoMes),
    procesos,
    serie,
    facturas,
    alertas,
    notas,
  }
}

// ---------------------------------------------------------------------------
// Consolidado de varios proyectos
// ---------------------------------------------------------------------------

function consolidar(proyectos: CierreProyecto[]): CierreProyecto {
  const sum = (f: (p: CierreProyecto) => number) => proyectos.reduce((a, p) => a + f(p), 0)

  const procMap = new Map<ProcesoCierre, LineaProceso>()
  for (const p of proyectos) {
    for (const l of p.procesos) {
      const e = procMap.get(l.proceso)
      if (!e) {
        procMap.set(l.proceso, { ...l, detalle: l.detalle.map((d) => ({ ...d })) })
        continue
      }
      e.cobroDia += l.cobroDia
      e.cobroMes += l.cobroMes
      e.costoOpDia += l.costoOpDia
      e.costoOpMes += l.costoOpMes
      e.costoAdDia += l.costoAdDia
      e.costoAdMes += l.costoAdMes
      if (e.margenDia !== null && l.margenDia !== null) e.margenDia += l.margenDia
      if (e.margenMes !== null && l.margenMes !== null) e.margenMes += l.margenMes
      for (const d of l.detalle) {
        const ex = e.detalle.find((x) => x.nombre === d.nombre)
        if (ex) {
          ex.cobroDia += d.cobroDia
          ex.cobroMes += d.cobroMes
          ex.costoDia += d.costoDia
          ex.costoMes += d.costoMes
        } else e.detalle.push({ ...d })
      }
    }
  }

  const serieMap = new Map<string, PuntoSerie>()
  for (const p of proyectos) {
    for (const s of p.serie) {
      const e = serieMap.get(s.fecha)
      if (e) {
        e.cobro += s.cobro
        e.costo += s.costo
      } else serieMap.set(s.fecha, { ...s, cobroAcum: 0, costoAcum: 0 })
    }
  }
  const serie = [...serieMap.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
  let ca = 0
  let co = 0
  for (const s of serie) {
    ca += s.cobro
    co += s.costo
    s.cobroAcum = ca
    s.costoAcum = co
  }

  const facturas: EstadoFacturas = {
    facturado: { ordenes: sum((p) => p.facturas.facturado.ordenes), valor: sum((p) => p.facturas.facturado.valor) },
    enProceso: { ordenes: sum((p) => p.facturas.enProceso.ordenes), valor: sum((p) => p.facturas.enProceso.valor) },
    sinGestionar: { ordenes: sum((p) => p.facturas.sinGestionar.ordenes), valor: sum((p) => p.facturas.sinGestionar.valor) },
    antiguedad: [0, 1, 2, 3].map((i) => ({
      tramo: proyectos[0]?.facturas.antiguedad[i]?.tramo ?? "",
      ordenes: sum((p) => p.facturas.antiguedad[i]?.ordenes ?? 0),
      valor: sum((p) => p.facturas.antiguedad[i]?.valor ?? 0),
    })),
    maxDiasSinFactura: Math.max(0, ...proyectos.map((p) => p.facturas.maxDiasSinFactura)),
    pendientes: proyectos
      .flatMap((p) => p.facturas.pendientes)
      .sort((a, b) => b.dias - a.dias || b.valor - a.valor)
      .slice(0, 80),
  }

  const alertas = proyectos.flatMap((p) =>
    p.alertas.map((a) => ({ ...a, titulo: `[${p.proyecto}] ${a.titulo}` })),
  )
  const notas = proyectos.flatMap((p) => p.notas.map((n) => `[${p.proyecto}] ${n}`))

  const cobroDia = sum((p) => p.cobroDia)
  const cobroMes = sum((p) => p.cobroMes)
  const costoDia = sum((p) => p.costoDia)
  const costoMes = sum((p) => p.costoMes)
  const costoProvisionadoMes = sum((p) => p.costoProvisionadoMes)

  return {
    idempresa: 0,
    proyecto: "Todos los proyectos",
    cobroDia,
    cobroMes,
    costoDia,
    costoMes,
    margenDia: cobroDia - costoDia,
    margenMes: cobroMes - costoMes,
    margenPctMes: cobroMes > 0 ? Math.round(((cobroMes - costoMes) / cobroMes) * 100) : null,
    costoProvisionadoMes,
    margenProvisionadoMes: cobroMes - costoProvisionadoMes,
    procesos: ORDEN_PROCESOS.map((p) => procMap.get(p)).filter(Boolean) as LineaProceso[],
    serie,
    facturas,
    alertas,
    notas,
  }
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export async function getCierreFinanciero(
  empresaId: number | null,
  fecha?: string | null,
): Promise<{ success: boolean; data?: CierreFinanciero; message?: string }> {
  try {
    const hoy = hoyBogota()
    let dia = String(fecha ?? "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia > hoy) dia = hoy
    const desde = `${dia.slice(0, 7)}-01`

    const sb: any = await getSupabaseAdmin()
    const accesibles = await getAccessibleEmpresesFromPermisos()
    if (!accesibles.length) return { success: false, message: "No tienes proyectos accesibles." }

    const objetivo = empresaId
      ? accesibles.filter((e: any) => Number(e.id) === Number(empresaId))
      : accesibles
    if (!objetivo.length) return { success: false, message: "No tienes acceso a ese proyecto." }

    const proyectos: CierreProyecto[] = []
    for (const e of objetivo) {
      proyectos.push(await cierreDeProyecto(sb, Number(e.id), String(e.nombre), dia, desde))
    }

    return {
      success: true,
      data: {
        fecha: dia,
        desde,
        esHoy: dia === hoy,
        alcance: empresaId ? "proyecto" : "todos",
        proyectos,
        total: proyectos.length > 1 ? consolidar(proyectos) : null,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error calculando el cierre financiero." }
  }
}
