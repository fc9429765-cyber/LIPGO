"use server"

/**
 * PREFACTURA DE PRODUCCIÓN (Gestión Financiera › Facturación).
 *
 * Convierte en DOCUMENTO COBRABLE lo que hoy solo se veía como análisis. Cubre
 * los dos proyectos que se facturan por producción, cada uno con su fuente:
 *
 *   · AVIMOL (id 2) — tonelaje de tolva clasificado en Salvado / Estibado PT
 *     (con sus variantes de festivo) MÁS las horas extra por puesto.
 *     NO se reimplementa el cálculo: se llama a `getConciliacionAvimol`, que ya
 *     está validado contra el negocio, y aquí solo se AGREGA su salida. Así el
 *     documento no puede desviarse de la conciliación — si algún día cambia una
 *     regla de cobro, cambia en un solo lugar.
 *
 *   · INDUPAN (id 1) — órdenes de `cabeceraoc` con `tipooperacion` Tolva o
 *     Tolva f, cobradas por `pesovascula` × tarifa. Aquí sí hay consulta propia
 *     porque la fuente es distinta (en Avimol la tolva vive en `invtrans`).
 *
 * CICLO DE VIDA: comparte la tabla `prefacturas` con el Cuadro de Control,
 * discriminada por `origen = 'produccion'` (ver scripts/100_add_prefactura_produccion.sql).
 * Se reutiliza porque el ciclo borrador -> aprobada y el soporte congelado son
 * idénticos; duplicar la tabla sería duplicar ese código.
 *
 * NO calcula IVA ni retenciones: igual que la prefactura existente, esto es
 * base neta. El IVA y el retefuente los suma Solicitar Facturas al emitir.
 */

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { segundoFactorPendiente } from "@/lib/seguridad-servidor"
import { exigirModulo, autorizarAccion, motivoSinAccion } from "@/lib/puerta-modulo"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { getConciliacionAvimol, type AlertaAvimol } from "@/lib/conciliacion-avimol-actions"
import { getReversosPorIdempresa } from "@/lib/transacciones-codigo-actions"
import type { Advertencia } from "@/lib/facturacion-control-actions"
// Las constantes viven en un módulo aparte: este archivo es "use server" y ahí
// solo se pueden exportar funciones async. Ver lib/prefactura-produccion-constants.ts.
import {
  PROYECTOS_PRODUCCION,
  AVIMOL_ID as AVIMOL,
  INDUPAN_ID as INDUPAN,
} from "@/lib/prefactura-produccion-constants"

const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""))
  return Number.isFinite(n) ? n : 0
}

const normOp = (s: any) => String(s ?? "").trim().toUpperCase()

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Una línea del RESUMEN de la prefactura (lo que ve y firma el cliente). */
export interface LineaResumen {
  concepto: string // "Salvado", "Estibado PT Festivo", "Tolva f", o el puesto
  tipo: "produccion" | "hora_extra"
  cantidad: number // toneladas o horas, según `unidad`
  unidad: "t" | "h"
  tarifa: number
  total: number
  /** true = no había tarifa vigente para ese concepto -> la línea vale $0 y se
   *  pinta en rojo. Sin esta marca el cero se sumaría en silencio. */
  sinTarifa: boolean
}

/** Una línea del SOPORTE (anexo que respalda la factura). Sirve para los dos
 *  proyectos; los campos que no aplican van en null. */
export interface SoporteProduccion {
  fecha: string
  concepto: string // la operación cobrada
  detalle: string // producto (Avimol) u orden de cargue (Indupan)
  referencia: string | null // orden de cargue, cuando aplica
  bultos: number | null
  kg: number | null
  cantidad: number
  unidad: "t" | "h"
  tarifa: number
  valor: number
  /** Lote de producción (AAAAMMDD) que respalda esta línea -- Indupan/Tolva
   *  únicamente. `fecha` ya sale de este lote (no de una orden), pero se deja
   *  el código crudo visible para que el anexo sea auditable. null en Avimol
   *  (no cambia; ese proyecto no factura por lote individual). */
  lote: string | null
}

export interface PrefacturaProduccionData {
  idempresa: number
  proyecto: string
  rango: { desde: string; hasta: string }
  produccion: LineaResumen[]
  horasExtra: LineaResumen[]
  soporte: SoporteProduccion[]
  totalProduccion: number
  totalHorasExtra: number
  total: number
  totalToneladas: number
  alertas: AlertaAvimol[]
  /** Prefacturas YA APROBADAS que se cruzan con este período. Es el análogo del
   *  anti-doble-cobro del Cuadro de Control: allá el semáforo lo da
   *  `cabeceraoc.facturasiigo` por orden, pero aquí la producción no tiene
   *  marca de "ya facturado" por registro, así que la señal es el solape. */
  solapes: Array<{ id: number; periodo: string; total: number; aprobadoPor: string | null }>
}

/** Línea tal como queda CONGELADA en la tabla al guardar. */
export interface PrefacturaProduccionGuardada {
  id: number
  idempresa: number
  proyecto: string | null
  periodo_desde: string | null
  periodo_hasta: string | null
  lineas: LineaResumen[]
  soporte: SoporteProduccion[]
  total: number
  toneladas: number
  estado: "borrador" | "aprobada"
  usuario: string | null
  observacion: string | null
  aprobado_por: string | null
  aprobado_en: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

const nombreProyecto = (idempresa: number) =>
  PROYECTOS_PRODUCCION.find((p) => p.idempresa === idempresa)?.nombre || `Proyecto ${idempresa}`

/**
 * AVIMOL — se agrega la salida de la conciliación, sin recalcular nada.
 * `dias[].productos[]` ya trae la operación resuelta (con festivo) y la tarifa
 * vigente aplicada; `dias[].detalleHorasExtra[]` trae las horas por puesto.
 */
async function armarAvimol(desde: string, hasta: string) {
  const r = await getConciliacionAvimol(desde, hasta)
  if (!r.success || !r.data) throw new Error(r.message || "No se pudo leer la conciliación de Avimol.")

  const prodPorOp = new Map<string, { cantidad: number; total: number; tarifa: number; sinTarifa: boolean }>()
  const hePorPuesto = new Map<string, { cantidad: number; total: number; tarifa: number; sinTarifa: boolean }>()
  const soporte: SoporteProduccion[] = []

  for (const d of r.data.dias) {
    for (const p of d.productos) {
      if (p.toneladas <= 0) continue
      const g = prodPorOp.get(p.operacion) || { cantidad: 0, total: 0, tarifa: 0, sinTarifa: false }
      g.cantidad += p.toneladas
      g.total += p.cobro
      if (p.tarifa > 0) g.tarifa = p.tarifa
      else g.sinTarifa = true
      prodPorOp.set(p.operacion, g)
      soporte.push({
        fecha: d.fecha,
        concepto: p.operacion,
        detalle: p.nombreproducto,
        referencia: null,
        bultos: p.bultos,
        kg: p.kg,
        cantidad: p.toneladas,
        unidad: "t",
        tarifa: p.tarifa,
        valor: p.cobro,
        lote: null, // Avimol no factura por lote individual -- sin cambio de comportamiento.
      })
    }
    for (const h of d.detalleHorasExtra) {
      if (h.horas <= 0) continue
      const g = hePorPuesto.get(h.puesto) || { cantidad: 0, total: 0, tarifa: 0, sinTarifa: false }
      g.cantidad += h.horas
      g.total += h.cobro
      if (h.tarifa > 0) g.tarifa = h.tarifa
      else g.sinTarifa = true
      hePorPuesto.set(h.puesto, g)
      soporte.push({
        fecha: d.fecha,
        concepto: `Hora extra · ${h.puesto}`,
        detalle: `HED ${h.hed} · HEDF ${h.hedf} · HEN ${h.hen} · HEF ${h.hef} · HN ${h.hn}`,
        referencia: null,
        bultos: null,
        kg: null,
        cantidad: h.horas,
        unidad: "h",
        lote: null,
        tarifa: h.tarifa,
        valor: h.cobro,
      })
    }
  }

  const aLinea = (
    m: Map<string, { cantidad: number; total: number; tarifa: number; sinTarifa: boolean }>,
    tipo: "produccion" | "hora_extra",
    unidad: "t" | "h",
  ): LineaResumen[] =>
    Array.from(m.entries())
      .map(([concepto, g]) => ({
        concepto,
        tipo,
        cantidad: Number(g.cantidad.toFixed(3)),
        unidad,
        // Tarifa EFECTIVA del grupo: si en el período hubo cambio de vigencia,
        // total/cantidad refleja la mezcla real mejor que una tarifa suelta.
        // Redondeo a centavos, no a peso entero.
        tarifa: g.cantidad > 0 ? Math.round((g.total / g.cantidad) * 100) / 100 : g.tarifa,
        total: Math.round(g.total),
        sinTarifa: g.sinTarifa,
      }))
      .sort((a, b) => a.concepto.localeCompare(b.concepto, "es"))

  return {
    produccion: aLinea(prodPorOp, "produccion", "t"),
    horasExtra: aLinea(hePorPuesto, "hora_extra", "h"),
    soporte,
    alertas: r.data.alertas,
  }
}

/** Parseo lote (AAAAMMDD) -> fecha ISO. Mismo guard que
 *  lib/conciliacion-avimol-actions.ts:88-98 (el lote se puede escribir a
 *  mano, así que puede no ser una fecha válida). */
function loteAFechaIndupan(lote: any): string | null {
  const s = String(lote || "").trim()
  if (!/^\d{8}$/.test(s)) return null
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(4, 6))
  const d = Number(s.slice(6, 8))
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d)
  if (isNaN(dt.getTime()) || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

/** Mismo comodín que liquidacion-tolva-actions.ts / conciliacion-avimol-actions.ts
 *  — tolera la tilde de "producción". */
const ORIGEN_INGRESO_PRODUCCION_INDUPAN = "%ingreso producci%"

/** Días de diferencia entre dos 'YYYY-MM-DD'. `null`/vacío -> Infinity (no se puede comparar, se alerta). */
function diasEntreFechas(a: string | null, b: string | null): number {
  if (!a || !b) return Infinity
  const ma = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a)
  const mb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b)
  if (!ma || !mb) return Infinity
  const da = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]))
  const db = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]))
  return Math.abs(da - db) / 86400000
}

/**
 * Un turno real puede cruzar medianoche (el lote cierra al día siguiente de
 * cuando arrancó) -- eso difiere como mucho 1 día. Cualquier cosa por encima
 * de esto ya no es un cruce de turno, es un error de digitación en el lote
 * (año/día/mes mal escrito): un lote de producción real nunca cae semanas,
 * meses o años lejos de su `fechaprod` real.
 */
const TOLERANCIA_LOTE_FECHAPROD_DIAS = 2

/**
 * INDUPAN — producción de Tolva / Tolva f.
 *
 * FUENTE: Aprobación de Ingreso de Producción (`invtrans`, tipomov='Entrada',
 * status='Aprobado', origen='ingreso producción') — NO `cabeceraoc.pesovascula`.
 * Para Tolva ese campo nunca fue una báscula real: Liquidación Tolva lo llena
 * con el mismo total que ya viene de aquí (lib/liquidacion-tolva-actions.ts),
 * así que ir a la fuente es más preciso, no menos.
 *
 * SEGREGACIÓN: por fecha del LOTE (AAAAMMDD), no por la orden de Liquidación
 * Tolva que recogió la producción. El cliente (Harinera Indupan) hace corte
 * ~3:00pm: una misma orden de liquidación (y un mismo día calendario) puede
 * traer producción de DOS lotes/fechas distintas (turno que cruza el corte).
 * Mismo patrón ya validado en Avimol (lib/conciliacion-avimol-actions.ts,
 * armarAvimol) — aquí se replica exactamente para Indupan/Tolva.
 *
 * Tolva vs Tolva f: domingo de la fecha del LOTE (mismo criterio que
 * `tipoOperacionTolva` en lib/liquidacion-tolva-actions.ts).
 */
/**
 * PUERTA DE PERMISO (2026-10-07). Una server action es una URL: cualquiera con sesión
 * puede llamarla aunque la pantalla esté escondida para él. Aquí se exige el MISMO módulo
 * que la pantalla ya exige para mostrarse, así que quien puede ver Prefactura de Producción
 * pasa igual que siempre, y quien no, nunca debió poder llamarla.
 *
 * Va en el accesor al cliente porque TODAS las acciones de este archivo pasan por él, y
 * porque sus `catch` ya devuelven `e.message`: el motivo le llega limpio al usuario.
 *
 * Comprobado antes de ponerla: el único que importa este archivo es
 * `components/prefactura-produccion.tsx`, su propia pantalla. No rompe a nadie más.
 */
async function clienteConPermiso(): Promise<any> {
  await exigirModulo(["Prefactura de Producción"], "prefactura-produccion")
  return await getSupabaseAdmin()
}

async function armarIndupan(desde: string, hasta: string) {
  const admin: any = await clienteConPermiso()

  const { data: tarifas, error: errT } = await admin
    .from("tarifasoperacion")
    .select("operacion, tarifa, fechainicio, fechafin")
    .eq("empresaid", INDUPAN)
  if (errT) throw new Error(errT.message)

  // Tarifa vigente por (operación, fecha). `tarifasoperacion` usa
  // `fechainicio`/`fechafin` —no `fechaini`— y su columna `tarifa` es TEXT.
  // Se compara normalizado porque la tarifa está escrita "Tolva f".
  const tarifaVigente = (operacion: string, fecha: string): number => {
    const fila = (tarifas || []).find(
      (t: any) =>
        normOp(t.operacion) === normOp(operacion) &&
        String(t.fechainicio).slice(0, 10) <= fecha &&
        String(t.fechafin).slice(0, 10) >= fecha,
    )
    return fila ? num(fila.tarifa) : 0
  }

  const alertas: AlertaAvimol[] = []

  // Confirmado con el negocio 2026-09-16: estos productos pasan por Aprobación
  // de Ingreso de Producción pero NO son Tolva -- son subproducto de la
  // molienda propia de Indupan (mogolla, salvado, harina de tercera) y una
  // marca de otro cliente toll-milled en la planta ("La Nieve" en libras).
  // EXCLUSIÓN TEMPORAL "hasta nueva orden" -- si el negocio confirma que sí
  // se deben facturar, quitar este filtro (no la lógica de arriba).
  const PRODUCTOS_NO_TOLVA_INDUPAN = new Set(["Mogolla Kg.", "PT LA NIEVE 25LB", "Harina de Tercera", "Salvado Kg."])

  // Ingresos aprobados, filtrados por LOTE (AAAAMMDD ordena igual lexicográfica
  // que cronológicamente, así que el rango se filtra directo en la BD y de
  // paso deja fuera los lotes que no son fecha).
  const loteDesde = desde.replace(/-/g, "")
  const loteHasta = hasta.replace(/-/g, "")
  const ingresosCrudos: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await admin
      .from("invtrans")
      .select("id, idproducto, nombreproducto, cantidad, lote, fechaprod, creadopor, tipo_produccion, observaciones, ordentolva")
      .eq("idempresa", INDUPAN)
      .eq("tipomov", "Entrada")
      .eq("status", "Aprobado")
      .ilike("origen", ORIGEN_INGRESO_PRODUCCION_INDUPAN)
      .gte("lote", loteDesde)
      .lte("lote", loteHasta)
      // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
      .order("id")
      .range(off, off + 999)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    ingresosCrudos.push(...data)
    if (data.length < 1000) break
  }
  // Probado y REVERTIDO 2026-09-21: se intentó quitar el filtro de
  // `creadopor` (por si el LOGO no trabaja algún día y el Coordinador captura
  // a mano) -- verificado con datos reales que NO hubo ningún ingreso manual
  // creado el domingo 13-sep en cuestión (0 filas), así que esa hipótesis
  // puntual no aplicó aquí. Y al quitar el filtro en general, el total SUBIÓ
  // muy por encima del Excel del cliente (de 897t a 1036t, +153t) porque se
  // colaron entradas manuales que SÍ son ajenas a Tolva -- ej. 34,1t el
  // 01-sep (`creadopor="Coordinador Indupan"`, sin fechaprod que lo
  // delatara), el mismo patrón de "devolución/descargue" que confirmó el
  // negocio en agosto. Se mantiene el filtro `creadopor === "LOGO"`.
  //
  // Lo que SÍ quedó corregido de raíz por separado (no dependía de esto):
  // reversos (código 102, ver `reversadoPorId` abajo) y reclasificaciones de
  // lote (código 309, ver `deltaLoteProducto` abajo) -- esos son
  // correcciones REALES sobre producción que YA era del LOGO, así que se
  // incluyen sin importar quién las autorizó.
  const ingresos = ingresosCrudos.filter(
    (r: any) =>
      r.creadopor === "LOGO" &&
      r.tipo_produccion !== "Harinera" &&
      !PRODUCTOS_NO_TOLVA_INDUPAN.has(String(r.nombreproducto || "")),
  )

  // Reversos ("Transacciones por Código", lib/transacciones-codigo-actions.ts):
  // un ingreso mal digitado se corrige con un movimiento aparte (tipomov
  // Salida, origen "transaccion manual") que referencia al original con el
  // marcador `[rev#<id>]` en observaciones -- NUNCA se edita/borra la fila
  // original. `ingresos` (arriba) exige tipomov=Entrada + origen "ingreso
  // producción" + creadopor=LOGO, así que un reverso de este tipo es
  // invisible para ese filtro y el ingreso original se seguía cobrando de
  // más aunque ya estuviera anulado por Gerencia General.
  // BUG REAL encontrado 2026-09-21: 840 bultos (42t, ~$428.022) de "Indupan
  // Panificacion 50 Kg." (invtrans #31046, lote 20260913) reversados el
  // 2026-09-14 ("error en ingreso") seguían contando en la prefactura.
  const reversadoPorId = await getReversosPorIdempresa(INDUPAN)

  // Reclasificaciones de lote (código 309) -- se necesita ANTES de las
  // alertas de "lote_invalido" de más abajo (no solo para sumar el ajuste al
  // cobro): un ingreso con el lote mal digitado que YA fue corregido por el
  // Coordinador con este mecanismo NO debe seguir apareciendo como alerta --
  // la corrección ya resolvió esa cantidad, aunque la fila original (con el
  // lote viejo) nunca se edita. Sin este chequeo, las alertas volvían a
  // aparecer eternamente para producción que ya se había arreglado, incluso
  // el mismo día que se corrigió.
  // BUG REAL encontrado 2026-09-21 (reportado por el usuario): tras corregir
  // los typos de lote "20200910"/"20261209" vía código 309, las 92 filas
  // originales seguían disparando `lote_invalido` como si nada se hubiera
  // resuelto.
  const { data: reclaCruda } = await admin
    .from("invtrans")
    .select("id, idproducto, nombreproducto, cantidad, lote, tipomov, status, tipo_produccion, ordentolva")
    .eq("idempresa", INDUPAN)
    .eq("cod_movimiento", "309")
  const filasReclaResueltas = (reclaCruda || []).filter(
    (r: any) =>
      String(r.status || "").toLowerCase().startsWith("aprob") &&
      r.tipomov === "Salida" &&
      r.tipo_produccion !== "Harinera" &&
      !PRODUCTOS_NO_TOLVA_INDUPAN.has(String(r.nombreproducto || "")),
  )
  // Cuánto se sacó de CADA (lote, producto) vía una reclasificación -- esa
  // cantidad ya no cuenta como "sin resolver" en el lote de origen, sin
  // importar cuál fila puntual del LOGO la originó (son unidades fungibles
  // del mismo producto).
  const resueltoPorLoteProducto = new Map<string, number>()
  for (const r of filasReclaResueltas) {
    const k = `${r.lote}|${r.nombreproducto}`
    resueltoPorLoteProducto.set(k, (resueltoPorLoteProducto.get(k) ?? 0) + num(r.cantidad))
  }
  /** Consume del cupo ya resuelto por reclasificación; true = no alertar. */
  function yaResueltoPorReclasificacion(lote: string, nombreproducto: string, cantidad: number): boolean {
    const k = `${lote}|${nombreproducto}`
    const disponible = resueltoPorLoteProducto.get(k) ?? 0
    if (disponible >= cantidad) {
      resueltoPorLoteProducto.set(k, disponible - cantidad)
      return true
    }
    return false
  }

  // Ingresos aprobados del rango cuyo LOTE no es una fecha parseable, O cuyo
  // LOTE parsea a una fecha pero muy distinta de `fechaprod`: el filtro de
  // arriba (por rango de LOTE) los deja fuera en los dos casos, así que se
  // buscan por `fechaprod` para que no queden invisibles (no suman al cobro,
  // solo se alertan). Misma exclusión de productos que `ingresos` -- ya NO
  // se filtra por `creadopor` (ver comentario arriba).
  //
  // BUG REAL encontrado y corregido 2026-09-21: un lote como "20200910" (año
  // 2020 en vez de 2026, digitado a mano por error) o "20261209" (día/mes
  // invertidos, debía ser "20260912") SÍ parsea como fecha válida -- no
  // disparaba ninguna alerta, la producción real simplemente desaparecía del
  // rango sin que nadie se enterara (87t + 68t reales, ya facturables,
  // encontradas en Sept 2026 antes de este fix). Un lote de producción real
  // nunca cae años de diferencia de su `fechaprod` -- eso "estaría vencido",
  // como lo resumió el usuario -- así que cualquier diferencia mayor a
  // `TOLERANCIA_LOTE_FECHAPROD_DIAS` es casi con certeza un typo, no un turno
  // legítimo que cruza medianoche (eso como mucho difiere 1 día). Mismo
  // filtro `creadopor = LOGO` que `ingresos` -- una devolución/descargue
  // manual con lote roto nunca se iba a facturar de todas formas, así que
  // alertarla solo sería ruido.
  {
    const { data } = await admin
      .from("invtrans")
      .select("id, nombreproducto, lote, fechaprod, creadopor, tipo_produccion")
      .eq("idempresa", INDUPAN)
      .eq("tipomov", "Entrada")
      .eq("status", "Aprobado")
      .ilike("origen", ORIGEN_INGRESO_PRODUCCION_INDUPAN)
      .eq("creadopor", "LOGO")
      .gte("fechaprod", desde)
      .lte("fechaprod", hasta)
      // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
      .order("id")
      .range(0, 999)
    for (const r of data || []) {
      if (r.tipo_produccion === "Harinera") continue
      if (PRODUCTOS_NO_TOLVA_INDUPAN.has(String(r.nombreproducto || ""))) continue
      if (yaResueltoPorReclasificacion(String(r.lote ?? ""), String(r.nombreproducto || ""), num(r.cantidad))) continue
      const fechaLote = loteAFechaIndupan(r.lote)
      const fechaProd = String(r.fechaprod ?? "").slice(0, 10)
      if (fechaLote === null) {
        alertas.push({
          tipo: "lote_invalido",
          detalle: `Ingreso #${r.id} (${r.nombreproducto || "sin producto"}) con lote "${r.lote ?? ""}" no es una fecha AAAAMMDD — no se factura. Producción: ${fechaProd || "—"}.`,
        })
      } else if (diasEntreFechas(fechaLote, fechaProd) > TOLERANCIA_LOTE_FECHAPROD_DIAS) {
        alertas.push({
          tipo: "lote_invalido",
          detalle: `Ingreso #${r.id} (${r.nombreproducto || "sin producto"}) con lote "${r.lote}" (léase como ${fechaLote}) no coincide con la fecha real de producción (${fechaProd || "—"}) — parece un error de digitación en el lote, no se factura hasta corregirlo.`,
        })
      }
    }
  }

  // Peso unitario por producto (kg/bulto) — el producto se maneja en BULTOS
  // y se nombra en kilos ("Indupan Especial 50 Kg."), pero la TARIFA es por
  // TONELADA.
  const idsProducto = Array.from(
    new Set(ingresos.map((r: any) => r.idproducto).filter((x: any) => x != null).map((x: any) => Number(x))),
  )
  const pesoPorProducto = new Map<number, number>()
  for (let i = 0; i < idsProducto.length; i += 100) {
    const chunk = idsProducto.slice(i, i + 100)
    const { data } = await admin.from("productos").select("id, peso_unitkg").in("id", chunk)
    for (const p of data || []) pesoPorProducto.set(Number(p.id), num(p.peso_unitkg))
  }

  // Tarifa REAL de la orden (cabeceraoc.tipooperacion), cuando el ingreso ya
  // tiene turno asignado (`ordentolva`). El cierre de lote NO siempre cae
  // exacto en el cambio de tarifa (normal->festiva): un lote puede seguir
  // abierto ya entrado el festivo, o cerrar recién iniciado el festivo antes
  // de que se le asigne el turno del día siguiente. Cuando ya existe una
  // orden real, esa clasificación es la que decidió el coordinador al
  // cerrar el turno -- manda sobre volver a adivinarla desde la fecha del
  // lote. Solo se usa "domingo de la fecha del lote" cuando todavía NO hay
  // orden (producción sin liquidar aún).
  // BUG REAL encontrado 2026-09-21 (confirmado por el usuario con el
  // archivo del cliente): ingreso #31051 (261 bultos, "Indupan Panificacion
  // 50 Kg.") con lote "20260913" (domingo) pertenece a la orden real
  // Tolva9160, ya registrada como tipooperacion='Tolva' (normal,
  // fechacargue 2026-09-14) -- se estaba cobrando a tarifa festiva una
  // producción que el propio sistema ya había clasificado como normal.
  const ordenesEnIngresos = Array.from(new Set(ingresos.map((r: any) => r.ordentolva).filter(Boolean)))
  const tarifaPorOrden = new Map<string, "Tolva" | "Tolva f">()
  for (let i = 0; i < ordenesEnIngresos.length; i += 100) {
    const chunk = ordenesEnIngresos.slice(i, i + 100)
    const { data } = await admin
      .from("cabeceraoc")
      .select("ordendecargue, tipooperacion")
      .in("ordendecargue", chunk)
      .in("tipooperacion", ["Tolva", "Tolva f"])
    for (const o of data || []) tarifaPorOrden.set(String(o.ordendecargue), o.tipooperacion)
  }

  // Reclasificaciones de lote ("Movimiento por código 309" -- Salida del
  // lote viejo + Entrada al lote correcto, neta cero en inventario, para
  // RENOMBRAR el lote de un ingreso ya aprobado). Van SIEMPRE con
  // creadopor="Coordinador Indupan" (`origen`="transaccion manual"), así
  // que `ingresos` (arriba, exige creadopor=LOGO) las excluye por completo
  // -- pero no son devoluciones ni descargues, son producción REAL de LOGO
  // a la que solo se le corrigió el lote. Sin este ajuste, la corrección
  // queda sin efecto: el ingreso original de LOGO se sigue cobrando bajo su
  // lote VIEJO (equivocado) y el lote NUEVO (correcto) nunca ve esa
  // cantidad -- justo lo que pasó con 508 bultos (25,4t) de "Indupan
  // Panificacion 50 Kg." movidos del 12 al 13-sep-2026 (Tolva normal ->
  // Tolva f), encontrado y corregido 2026-09-21 a partir de un caso
  // reportado por el cliente.
  //
  // Sin filtro de lote en la consulta (como en `reversadoPorId`): un solo
  // movimiento puede mover producción DESDE un lote de OTRO período HACIA
  // uno de este período (o viceversa), y solo importa si el lote resultante
  // cae en el rango pedido -- eso se filtra más abajo, por fila, no aquí.
  const deltaLoteProducto = new Map<
    string,
    { ton: number; bultos: number; kg: number; lote: string; nombreproducto: string; ordentolva: string | null }
  >()
  {
    // Reusa `reclaCruda` (ya traído arriba para `resueltoPorLoteProducto`) --
    // una sola consulta a `cod_movimiento='309'` para las dos cosas, no dos.
    // Esta necesita `ordentolva` además de lo ya filtrado, así que vuelve a
    // filtrar sobre los mismos datos crudos en vez de re-consultar.
    const filasRecla = (reclaCruda || []).filter(
      (r: any) =>
        String(r.status || "").toLowerCase().startsWith("aprob") &&
        r.tipo_produccion !== "Harinera" &&
        !PRODUCTOS_NO_TOLVA_INDUPAN.has(String(r.nombreproducto || "")),
    )
    const idsProductoRecla = Array.from(
      new Set(filasRecla.map((r: any) => r.idproducto).filter((x: any) => x != null).map((x: any) => Number(x))),
    )
    for (let i = 0; i < idsProductoRecla.length; i += 100) {
      const chunk = idsProductoRecla.slice(i, i + 100)
      const { data } = await admin.from("productos").select("id, peso_unitkg").in("id", chunk)
      for (const p of data || []) if (!pesoPorProducto.has(Number(p.id))) pesoPorProducto.set(Number(p.id), num(p.peso_unitkg))
    }
    for (const r of filasRecla) {
      const fecha = loteAFechaIndupan(r.lote)
      if (!fecha || fecha < desde || fecha > hasta) continue // solo lotes de ESTE período
      const peso = r.idproducto != null ? pesoPorProducto.get(Number(r.idproducto)) || 0 : 0
      const bultos = num(r.cantidad)
      const kg = bultos * peso
      const ton = kg / 1000
      if (ton <= 0) continue
      const signo = r.tipomov === "Salida" ? -1 : r.tipomov === "Entrada" ? 1 : 0
      if (signo === 0) continue
      const k = `${r.lote}|${r.nombreproducto}`
      const acc = deltaLoteProducto.get(k) || { ton: 0, bultos: 0, kg: 0, lote: r.lote, nombreproducto: r.nombreproducto, ordentolva: null }
      acc.ton += signo * ton
      acc.bultos += signo * bultos
      acc.kg += signo * kg
      if (r.tipomov === "Entrada" && r.ordentolva) acc.ordentolva = r.ordentolva
      deltaLoteProducto.set(k, acc)
    }
  }

  const porOp = new Map<string, { cantidad: number; total: number; tarifa: number; sinTarifa: boolean }>()
  // Agregado por (lote, producto): cada ingreso individual es UNA lectura de
  // báscula/QR (puede haber decenas por lote), así que sin agregar aquí el
  // soporte queda con filas repetidas idénticas -- mismo patrón de
  // `dia.productos` en conciliacion-avimol-actions.ts (líneas ~520-530).
  const porLoteProducto = new Map<string, SoporteProduccion>()
  const sinTarifaSet = new Set<string>()

  for (const r of ingresos) {
    const fecha = loteAFechaIndupan(r.lote)
    if (!fecha) {
      alertas.push({
        tipo: "lote_invalido",
        detalle: `Ingreso #${r.id} (${r.nombreproducto || "sin producto"}) con lote "${r.lote ?? ""}" no parseable — excluido del cobro.`,
      })
      continue
    }
    // Guardarraíl contra ingresos con fecha real muy distinta a su lote (ver
    // comentario arriba, caso real de agosto). Solo aplica si trae
    // `fechaprod` -- muchas filas reales del LOGO no la tienen (ver
    // lib/liquidacion-tolva-actions.ts).
    if (
      r.fechaprod &&
      diasEntreFechas(fecha, String(r.fechaprod).slice(0, 10)) > TOLERANCIA_LOTE_FECHAPROD_DIAS &&
      !yaResueltoPorReclasificacion(String(r.lote ?? ""), String(r.nombreproducto || ""), num(r.cantidad))
    ) {
      alertas.push({
        tipo: "lote_invalido",
        detalle: `Ingreso #${r.id} (${r.nombreproducto || "sin producto"}) con lote "${r.lote}" (léase como ${fecha}) no coincide con su fecha real de producción (${String(r.fechaprod).slice(0, 10)}) — excluido del cobro.`,
      })
      continue
    }

    const peso = r.idproducto != null ? pesoPorProducto.get(Number(r.idproducto)) || 0 : 0
    // Si el ingreso fue reversado (total o parcialmente) por un código de
    // corrección, se descuenta lo reversado -- no se factura lo que
    // Gerencia General ya anuló.
    const bultos = Math.max(0, num(r.cantidad) - (reversadoPorId.get(Number(r.id)) ?? 0))
    const kg = bultos * peso
    const ton = kg / 1000
    if (ton <= 0) continue

    const [y, m, d] = fecha.split("-").map(Number)
    const esDomingo = new Date(y, m - 1, d).getDay() === 0
    const opTarifa = tarifaPorOrden.get(String(r.ordentolva)) ?? (esDomingo ? "Tolva f" : "Tolva")

    const tarifa = tarifaVigente(opTarifa, fecha)
    if (tarifa === 0) sinTarifaSet.add(`${opTarifa}|${fecha}`)
    const valor = ton * tarifa

    const g = porOp.get(opTarifa) || { cantidad: 0, total: 0, tarifa: 0, sinTarifa: false }
    g.cantidad += ton
    g.total += valor
    if (tarifa > 0) g.tarifa = tarifa
    else g.sinTarifa = true
    porOp.set(opTarifa, g)

    const nombre = String(r.nombreproducto || "(sin producto)")
    // BUG REAL encontrado y corregido 2026-09-21: la clave de agrupación no
    // incluía la tarifa (`opTarifa`) -- un mismo (lote, producto) puede tener
    // AMBAS tarifas mezcladas ahora que la tarifa real de la orden manda
    // sobre "domingo de la fecha del lote" (ver arriba): parte de la
    // producción de un lote de domingo puede ser realmente "Tolva" (turno
    // normal que se cerró tarde) y otra parte "Tolva f". Sin la tarifa en la
    // clave, ambas porciones se fusionaban en una sola línea del soporte que
    // mostraba la tarifa de la PRIMERA fila procesada -- el $ total seguía
    // siendo correcto (se sigue sumando por fila, antes de fusionar), pero
    // el anexo mostraba una tarifa que no correspondía a todo ese renglón.
    const k = `${r.lote}|${nombre}|${opTarifa}`
    const existente = porLoteProducto.get(k)
    if (existente) {
      existente.bultos = (existente.bultos ?? 0) + bultos
      existente.kg = (existente.kg ?? 0) + kg
      existente.cantidad += ton
      existente.valor += valor
    } else {
      porLoteProducto.set(k, {
        fecha,
        concepto: opTarifa,
        detalle: nombre,
        referencia: null, // ya no hay una "orden" por línea -- se factura por lote, ver `lote`
        bultos,
        kg,
        cantidad: ton,
        unidad: "t",
        tarifa,
        valor,
        lote: r.lote,
      })
    }
  }

  // Aplicar las reclasificaciones de lote (código 309) sobre los totales ya
  // armados: el lote de origen pierde la cantidad movida, el lote destino la
  // gana -- si el destino no tenía ninguna fila propia todavía (todo su
  // aporte vino de la reclasificación), se crea aquí.
  for (const d of deltaLoteProducto.values()) {
    if (Math.abs(d.ton) < 0.0005) continue
    const fechaLote = `${d.lote.slice(0, 4)}-${d.lote.slice(4, 6)}-${d.lote.slice(6, 8)}`
    const [y, m, dd] = fechaLote.split("-").map(Number)
    const esDomingo = new Date(y, m - 1, dd).getDay() === 0
    const opTarifa = (d.ordentolva && tarifaPorOrden.get(d.ordentolva)) ?? (esDomingo ? "Tolva f" : "Tolva")
    const tarifa = tarifaVigente(opTarifa, fechaLote)
    const valor = d.ton * tarifa

    const g = porOp.get(opTarifa) || { cantidad: 0, total: 0, tarifa: 0, sinTarifa: false }
    g.cantidad += d.ton
    g.total += valor
    if (tarifa > 0) g.tarifa = tarifa
    porOp.set(opTarifa, g)

    const k = `${d.lote}|${d.nombreproducto}`
    const existente = porLoteProducto.get(k)
    if (existente) {
      existente.bultos = (existente.bultos ?? 0) + d.bultos
      existente.kg = (existente.kg ?? 0) + d.kg
      existente.cantidad += d.ton
      existente.valor += valor
    } else if (d.ton > 0) {
      porLoteProducto.set(k, {
        fecha: fechaLote,
        concepto: opTarifa,
        detalle: d.nombreproducto,
        referencia: "reclasificación de lote (código 309)",
        bultos: d.bultos,
        kg: d.kg,
        cantidad: d.ton,
        unidad: "t",
        tarifa,
        valor,
        lote: d.lote,
      })
    }
  }

  const soporte: SoporteProduccion[] = Array.from(porLoteProducto.values()).map((s) => ({
    ...s,
    bultos: s.bultos != null ? Number(s.bultos.toFixed(0)) : null,
    kg: s.kg != null ? Number(s.kg.toFixed(1)) : null,
    cantidad: Number(s.cantidad.toFixed(3)),
    valor: Math.round(s.valor),
  }))

  for (const k of sinTarifaSet) {
    const [op, f] = k.split("|")
    alertas.push({ tipo: "sin_tarifa", detalle: `${f} · ${op}: sin tarifa vigente en tarifasoperacion (se cobra $0)` })
  }

  const produccion: LineaResumen[] = Array.from(porOp.entries())
    .map(([concepto, g]) => ({
      concepto,
      tipo: "produccion" as const,
      cantidad: Number(g.cantidad.toFixed(3)),
      unidad: "t" as const,
      tarifa: g.cantidad > 0 ? Math.round((g.total / g.cantidad) * 100) / 100 : g.tarifa,
      total: Math.round(g.total),
      sinTarifa: g.sinTarifa,
    }))
    .sort((a, b) => a.concepto.localeCompare(b.concepto, "es"))

  return { produccion, horasExtra: [] as LineaResumen[], soporte, alertas }
}

/** Prefacturas APROBADAS del mismo proyecto y origen que se cruzan con el rango. */
async function buscarSolapes(idempresa: number, desde: string, hasta: string) {
  const admin: any = await clienteConPermiso()
  const { data } = await admin
    .from("prefacturas")
    .select("id, periodo_desde, periodo_hasta, total, aprobado_por")
    .eq("idempresa", idempresa)
    .eq("origen", "produccion")
    .eq("estado", "aprobada")
  // Dos períodos se cruzan si cada uno empieza antes de que el otro termine.
  return (data || [])
    .filter((p: any) => {
      const d = String(p.periodo_desde || "").slice(0, 10)
      const h = String(p.periodo_hasta || "").slice(0, 10)
      if (!d || !h) return false
      return d <= hasta && h >= desde
    })
    .map((p: any) => ({
      id: Number(p.id),
      periodo: `${String(p.periodo_desde).slice(0, 10)} a ${String(p.periodo_hasta).slice(0, 10)}`,
      total: num(p.total),
      aprobadoPor: p.aprobado_por || null,
    }))
}

export async function getPrefacturaProduccion(
  idempresa: number,
  desde: string,
  hasta: string,
): Promise<{ success: boolean; data?: PrefacturaProduccionData; message?: string }> {
  // Validaciones que el módulo original NO tiene y aquí sí importan: esto se le
  // cobra a un cliente, un rango mal puesto genera una factura mal armada.
  if (!idempresa) return { success: false, message: "Selecciona un proyecto." }
  if (!PROYECTOS_PRODUCCION.some((p) => p.idempresa === idempresa))
    return { success: false, message: "Ese proyecto no se factura por producción." }
  if (!desde || !hasta) return { success: false, message: "El rango de fechas es obligatorio." }
  if (desde > hasta) return { success: false, message: "La fecha 'desde' no puede ser mayor que 'hasta'." }

  try {
    const armado = idempresa === AVIMOL ? await armarAvimol(desde, hasta) : await armarIndupan(desde, hasta)
    const totalProduccion = armado.produccion.reduce((a, l) => a + l.total, 0)
    const totalHorasExtra = armado.horasExtra.reduce((a, l) => a + l.total, 0)
    const totalToneladas = armado.produccion.reduce((a, l) => a + l.cantidad, 0)

    return {
      success: true,
      data: {
        idempresa,
        proyecto: nombreProyecto(idempresa),
        rango: { desde, hasta },
        produccion: armado.produccion,
        horasExtra: armado.horasExtra,
        soporte: armado.soporte.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.concepto.localeCompare(b.concepto)),
        totalProduccion,
        totalHorasExtra,
        total: totalProduccion + totalHorasExtra,
        totalToneladas: Number(totalToneladas.toFixed(3)),
        alertas: armado.alertas,
        solapes: await buscarSolapes(idempresa, desde, hasta),
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al armar la prefactura de producción." }
  }
}

// ---------------------------------------------------------------------------
// Ciclo de vida (borrador -> aprobada)
// ---------------------------------------------------------------------------

export async function guardarPrefacturaProduccion(payload: {
  idempresa: number
  proyecto?: string | null
  periodo_desde: string
  periodo_hasta: string
  lineas: LineaResumen[]
  soporte?: SoporteProduccion[]
  total: number
  toneladas: number
  observacion?: string | null
  /** El usuario ya vio el aviso de solape y decidió continuar. */
  confirmarSolape?: boolean
  advertencias?: Advertencia[]
  /** Para llamadas sin sesión (cron): reemplaza a `getCurrentUsuarioForInsert()`,
   *  que sin sesión cae en "admin" -- con esto queda "sistema (cron diario)",
   *  igual que ya se ve en los eventos del Ciclo de Facturación. */
  usuarioOverride?: string
}): Promise<{ success: boolean; id?: number; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Prefactura de Producción"], "crear", "Crear prefactura")
  if (motivoAccion) return { success: false, message: motivoAccion }
  // Segundo factor (2026-10-05): solo detiene a quien lo tiene activado y no lo verificó.
  const segundoFactor = await segundoFactorPendiente("prefactura-produccion:guardar")
  if (segundoFactor) return { success: false, message: segundoFactor }
  if (!payload?.idempresa) return { success: false, message: "Falta el proyecto." }
  if (!payload.periodo_desde || !payload.periodo_hasta)
    return { success: false, message: "El rango de fechas es obligatorio." }
  if (payload.periodo_desde > payload.periodo_hasta)
    return { success: false, message: "La fecha 'desde' no puede ser mayor que 'hasta'." }
  if (!payload.lineas?.length)
    return { success: false, message: "La prefactura no tiene conceptos seleccionados." }
  if (!(payload.total > 0))
    return { success: false, message: "La prefactura suma $0: no hay nada que cobrar." }

  try {
    // ANTI-DOBLE-COBRO. En el Cuadro de Control el semáforo lo da
    // `cabeceraoc.facturasiigo` por orden; aquí la producción no tiene marca de
    // "ya facturado" por registro, así que la señal equivalente es que exista
    // una prefactura APROBADA cubriendo el mismo período.
    if (!payload.confirmarSolape) {
      const solapes = await buscarSolapes(payload.idempresa, payload.periodo_desde, payload.periodo_hasta)
      if (solapes.length > 0) {
        return {
          success: false,
          message: `Ya hay ${solapes.length} prefactura(s) APROBADA(S) que cubren este período (${solapes
            .map((s: { id: number; periodo: string }) => `#${s.id} ${s.periodo}`)
            .join(", ")}). Guardar esta cobraría dos veces lo mismo.`,
        }
      }
    }

    const admin: any = await clienteConPermiso()
    const usuario = payload.usuarioOverride || (await getCurrentUsuarioForInsert())
    const { data, error } = await admin
      .from("prefacturas")
      .insert({
        idempresa: payload.idempresa,
        origen: "produccion",
        proyecto: payload.proyecto ?? nombreProyecto(payload.idempresa),
        periodo_desde: payload.periodo_desde,
        periodo_hasta: payload.periodo_hasta,
        lineas: payload.lineas,
        // Soporte CONGELADO: foto fiel de lo que respalda la factura. Se excluyen
        // las líneas en cero, que solo ensucian el anexo.
        soporte: (payload.soporte ?? []).filter((l) => l.valor > 0),
        total: payload.total,
        toneladas: payload.toneladas,
        // Se crea YA APROBADA (antes: "borrador", nunca se creaba aprobada).
        // No existe un paso interno de "aprobar la prefactura" en el negocio
        // -- generarla con el periodo ya construye el anexo y arranca el
        // Ciclo de Facturación. La única aprobación real es la del CLIENTE
        // firmando el anexo (evento "anexo_firmado"), no un clic interno de
        // LIPGO. `buscarSolapes` sigue funcionando igual (y ahora atrapa el
        // doble cobro DESDE la creación, no solo al aprobar a mano).
        estado: "aprobada",
        aprobado_por: usuario,
        aprobado_en: new Date().toISOString(),
        estado_ciclo: "pendiente_anexo",
        ciclo_actualizado_en: new Date().toISOString(),
        usuario,
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

export async function listarPrefacturasProduccion(
  idempresa?: number | null,
): Promise<{ success: boolean; data: PrefacturaProduccionGuardada[]; message?: string }> {
  try {
    const admin: any = await clienteConPermiso()
    let q = admin
      .from("prefacturas")
      .select("*")
      .eq("origen", "produccion") // aisladas de las del Cuadro de Control
      .order("created_at", { ascending: false })
      .limit(200)
    if (idempresa) q = q.eq("idempresa", idempresa)
    const { data, error } = await q
    if (error) return { success: false, data: [], message: error.message }
    return { success: true, data: (data || []) as PrefacturaProduccionGuardada[] }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al listar prefacturas." }
  }
}

/** Aprobar deja el documento en firme, REGISTRA QUIÉN lo aprobó, y arranca el Ciclo de Facturación. */
export async function aprobarPrefacturaProduccion(id: number, clave?: string): Promise<{ success: boolean; message?: string }> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Prefactura de Producción", "aprobar", { clave: clave ?? "", idempresa: (await (await getSupabaseAdminAsSystem()).from("prefacturas").select("idempresa").eq("id", id).maybeSingle()).data?.idempresa ?? null, referencia: `aprobar prefactura producción ${id}` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  if (!id) return { success: false, message: "Prefactura inválida." }
  // Segundo factor (2026-10-05): solo detiene a quien lo tiene activado y no lo verificó.
  const segundoFactor = await segundoFactorPendiente("prefactura-produccion:aprobar")
  if (segundoFactor) return { success: false, message: segundoFactor }
  try {
    const admin: any = await clienteConPermiso()
    const usuario = await getCurrentUsuarioForInsert()
    const { data, error } = await admin
      .from("prefacturas")
      .update({
        estado: "aprobada",
        aprobado_por: usuario,
        aprobado_en: new Date().toISOString(),
        estado_ciclo: "pendiente_anexo",
        ciclo_actualizado_en: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("origen", "produccion")
      .eq("estado", "borrador") // no re-aprobar ni tocar una ya aprobada
      .select("id")
    if (error) return { success: false, message: error.message }
    if (!data?.length) return { success: false, message: "No se encontró como borrador (¿ya estaba aprobada?)." }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al aprobar." }
  }
}

/** Reabrir devuelve a borrador y limpia el rastro de aprobación. Bloqueado si el Ciclo de Facturación ya avanzó (anexo enviado o más), salvo que se fuerce. */
export async function reabrirPrefacturaProduccion(id: number, forzar?: boolean, clave?: string): Promise<{ success: boolean; message?: string }> {
  // Acción CON CLAVE (catálogo lib/politicas-modulos.ts). En modo aviso pasa sin
  // clave y deja rastro; en modo bloquear la pantalla debe pedir la clave personal.
  const autorizacionAccion = await autorizarAccion("Prefactura de Producción", "aprobar", { clave: clave ?? "", idempresa: (await (await getSupabaseAdminAsSystem()).from("prefacturas").select("idempresa").eq("id", id).maybeSingle()).data?.idempresa ?? null, referencia: `reabrir prefactura producción ${id}` })
  if (!autorizacionAccion.ok) return { success: false, message: autorizacionAccion.error || "Sin autorización." }
  if (!id) return { success: false, message: "Prefactura inválida." }
  try {
    const admin: any = await clienteConPermiso()
    if (!forzar) {
      const { data: actual } = await admin.from("prefacturas").select("estado_ciclo").eq("id", id).maybeSingle()
      if (actual && actual.estado_ciclo && actual.estado_ciclo !== "pendiente_anexo") {
        return {
          success: false,
          message:
            "Esta prefactura ya tiene avance en el Ciclo de Facturación (anexo enviado o más) -- reabrirla para editar " +
            "invalidaría un documento que puede estar firmado por el cliente.",
        }
      }
    }
    const { error } = await admin
      .from("prefacturas")
      .update({ estado: "borrador", aprobado_por: null, aprobado_en: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("origen", "produccion")
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al reabrir." }
  }
}

/** Solo se elimina un BORRADOR: una aprobada ya se le pasó al cliente. */
export async function eliminarPrefacturaProduccion(id: number): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Prefactura de Producción"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!id) return { success: false, message: "Prefactura inválida." }
  const segundoFactor = await segundoFactorPendiente("prefactura-produccion:eliminar")
  if (segundoFactor) return { success: false, message: segundoFactor }
  try {
    const admin: any = await clienteConPermiso()
    const { data, error } = await admin
      .from("prefacturas")
      .delete()
      .eq("id", id)
      .eq("origen", "produccion")
      .eq("estado", "borrador")
      .select("id")
    if (error) return { success: false, message: error.message }
    // El módulo original devuelve success aunque no borre nada (no-op silencioso).
    if (!data?.length)
      return { success: false, message: "No se eliminó: solo se pueden borrar prefacturas en estado borrador." }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al eliminar." }
  }
}
