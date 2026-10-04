"use server"

// Centro de Coordinación (Operación LIP): pantalla única del coordinador que
// une la gestión hoy dispersa entre Picking (Cargue), Packing (Descargue/
// Distribución) y el control de muelles/SLA/ritmo. NO reimplementa esas
// acciones: llama a las mismas funciones de picking-actions.ts/
// packing-actions.ts/orders-actions.tsx que ya usan esas pantallas, para que
// nunca diverjan. Lo nuevo aquí es el `muelle` REAL (antes simulado en
// control-toneladas-actions.ts) y la vista unificada de los 3 tipos de
// operación con SLA/ritmo/proyección ya construidos.

import { createClient } from "@/lib/supabase-client"
import { notificarConductor } from "@/lib/notificacion-conductor-actions"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getColombiaDateTime, getColombiaTime } from "@/lib/date-utils"
import { pesoBaseCalculo, excluirAvimolDistribucion } from "@/lib/nomina-calculo-utils"
import { getSlaCargueMin, esNombreSubproducto, esModoCargaRequerido, type TipologiaProducto } from "@/lib/sla-acordados"
import { esProductoPorUnidad } from "@/lib/facturacion-billed-party"
import { idsOrdenPorUnidad } from "@/lib/ordenes-por-unidad"
import { reportarInterno } from "@/lib/reporte-interno-actions"
import {
  TON_MES_CARGUE_DESCARGUE,
  DIAS_OPERACION_MES,
  duracionHoras,
  esPuestoCargueDescargue,
} from "@/lib/meta-productividad-utils"
import { cargarMuellesEmpresa, getMuellesEmpresaSync } from "@/lib/muelles-empresa"
import { generatePickingPDF, getCarguDescarguePersonnel } from "@/lib/picking-actions"
import { generatePackingPDF, getPackingItems } from "@/lib/packing-actions"
// Las pausas viven en picking-actions porque nacieron ahí, pero son de la
// ORDEN (tabla `pausas`), no exclusivas de Cargue — mismo criterio que ya
// usa components/packing.tsx.
import { getOrdenesPausadas } from "@/lib/picking-actions"

const num = (v: any) => Number(v || 0)
const round1 = (v: number) => Math.round(v * 10) / 10
const round2 = (v: number) => Math.round(v * 100) / 100

export type TipoOperacion = "Cargue" | "Descargue" | "Distribucion"

export interface OrdenOperativa {
  orderId: number
  ordendecargue: string
  tipooperacion: TipoOperacion
  cliente: string
  placa: string | null
  conductor: string | null
  muelle: number | null
  auxiliares: string[]
  facturar: boolean | null
  /** Modo de pago elegido: 'individual' respeta `auxiliares` tal cual; 'global' se recalcula al cerrar. Obligatorio antes de cerrar. */
  tipoPago: "global" | "individual" | null
  pesoorden: number
  pesovascula: number | null
  iniciocargue: string | null
  fincargue: string | null
  tipovehiculo: string | null
  /** citasvehiculos.capacidad — capacidad real del vehículo (t), null si no hay cita asociada. */
  capacidadVehiculo: number | null
  slaMin: number | null
  pausado: boolean
  lineasTotal: number
  /** null = este tipo de operación no tiene estado por línea (Descargue/Distribución usan detalleoc a granel). */
  lineasAprobadas: number | null
  minutosTranscurridos: number | null
  slaVencido: boolean
  /** true = aún dentro del SLA pero le queda poco margen (≤20%) — aviso temprano antes de vencer. */
  slaEnRiesgo: boolean
  estado: "alistando" | "cargando" | "pausado"
  /** true = quedó abierta de un día anterior (no es del día consultado) — la orden sigue mostrándose hasta que cierre, pero se marca para que el coordinador entienda por qué aparece. */
  rezagada: boolean
  /**
   * true = Descargue de un producto que se factura POR UNIDAD (hoy: Huevos,
   * ver esProductoPorUnidad), en ID2. Ese personal se paga aparte, no por
   * destajo de esta orden — se puede concluir sin auxiliares ni tipo de
   * pago, igual que ya pasa con Distribución sin facturar. Confirmado por
   * el usuario 2026-08-28.
   */
  esDescargueHuevos: boolean
  /** "Estibado" o "Arrume" (negro/desarrume) — ver setModoCargaOrden. null hasta que el coordinador elija. */
  modoCarga: "Estibado" | "Arrume" | null
  /** true = esta orden debe elegir modoCarga antes de poder cerrarse (Cargue en ID1/ID2, ver esModoCargaRequerido). */
  requiereModoCarga: boolean
}

export interface MuelleSlot {
  muelle: number
  orden: OrdenOperativa | null
}

export interface CentroCoordinacionKpis {
  cargadoHoyTon: number
  metaTonDia: number
  ritmoTonHora: number
  capacidadTonHora: number
  slaCumplimientoPct: number | null
  ordenesEnRiesgo: number
  ordenesActivas: number
  personalEnPiso: number
  personalAsignado: number
  personalDisponible: number
  muellesOcupados: number
  muellesTotal: number
  proyeccionHoraFinCola: string | null
  /** Toneladas cerradas AYER a esta misma hora (mismo corte de reloj) — comparación "vs. ayer". */
  cargadoAyerMismaHoraTon: number
  /** % de diferencia hoy vs ayer a esta hora; null si ayer no tuvo nada que comparar. */
  vsAyerPct: number | null
  /** Meta ton/hora POR TRABAJADOR — insumo para la sugerencia "reforzar con auxiliar" (cuánto sube el ritmo al agregar 1 más). */
  metaPorHoraTrabajador: number
  /** Lo que ya se debería haber cargado a esta hora, según horas de personal realmente trabajadas — mismo cálculo que "Avance en Vivo". */
  metaEsperadaAhoraTon: number
  estadoTurno: "adelantado" | "cerca" | "atrasado" | "sin_datos"
  /** Tiempo promedio de cargue/descargue HOY (fincargue - iniciocargue, en min) — mismo cálculo que el indicador BSC "lip_tiempo_cargue", acotado al día. Null si ninguna orden de hoy tiene ambos datos aún. */
  tiempoCargueProedioMin: number | null
  /** Órdenes de hoy usadas para el promedio de arriba (para mostrar "X órdenes" como base). */
  tiempoCargueBaseOrdenes: number
  /**
   * Minutos promedio entre que se CREA la orden de cargue (`horaorden`) y que
   * se le ASIGNAN LOS LOTES (`horalote`), hoy.
   *
   * Es tiempo muerto: la orden ya existe pero no se puede empezar a alistar
   * hasta que alguien le asigne los lotes. Lo pidió la operación porque es
   * donde sienten que se pierde el turno esperando.
   *
   * Solo aplica a CARGUE: descargue y distribución no pasan por asignación de
   * lotes. Null si ninguna orden de cargue de hoy tiene las dos horas.
   */
  esperaLotesPromedioMin: number | null
  /** Órdenes de cargue de hoy usadas para ese promedio. */
  esperaLotesBaseOrdenes: number
  /** La espera más larga de hoy, con su orden. Es la que duele, no el promedio. */
  esperaLotesPeor: { ordendecargue: string; minutos: number } | null
  /** Órdenes de cargue de hoy que AÚN no tienen lotes asignados. */
  esperaLotesPendientes: number
  /**
   * El detalle orden por orden, para el desglose que se abre al tocar la
   * tarjeta. Viene con los KPIs y no en una consulta aparte porque las órdenes
   * del día ya están cargadas: pedirlas de nuevo seria una ida al servidor por
   * datos que ya están en memoria.
   *
   * `minutos` es null cuando la orden todavia NO tiene lotes; en ese caso
   * `esperandoMin` dice cuanto lleva esperando hasta ahora. Son dos cosas
   * distintas: una es una espera que ya termino, la otra sigue corriendo.
   */
  esperaLotesDetalle: EsperaLoteDetalle[]
}

export interface EsperaLoteDetalle {
  ordendecargue: string
  cliente: string
  placa: string | null
  horaorden: string | null
  horalote: string | null
  /** Minutos que espero, si ya tiene lotes. */
  minutos: number | null
  /** Minutos que lleva esperando, si todavia NO tiene lotes. */
  esperandoMin: number | null
  cerrada: boolean
}

export interface ColaPatioItem {
  placa: string
  tipovehiculo: string | null
  horallegada: string | null
}

export interface SugerenciaTurno {
  muelle: number
  placa: string
  tipovehiculo: string | null
}

export interface CentroCoordinacionData {
  idempresa: number
  fecha: string
  horaActual: string
  kpis: CentroCoordinacionKpis
  muelles: MuelleSlot[]
  colaSinMuelle: OrdenOperativa[]
  colaPatio: ColaPatioItem[]
  personalDisponibleLista: { id: number; nombreempleado: string }[]
  /** Próximo vehículo de patio sugerido para el primer muelle libre (mismo tipo si hay match, si no el más antiguo). */
  sugerenciaProximoTurno: SugerenciaTurno | null
  /** Ya está cargando (iniciocargue puesto) pero sin muelle asignado — alerta inmediata, sin esperar los 15 min. */
  alertaCargandoSinMuelle: OrdenOperativa[]
  /** Asignaciones que el sistema acaba de hacer solo en ESTA consulta (≥15 min sin muelle + libre disponible) — para avisar una sola vez en el cliente. */
  autoAsignaciones: { ordendecargue: string; placa: string | null; muelle: number }[]
  /** Total de órdenes de HOY por tipo (abiertas + cerradas) — para los chips de filtro, que no deben bajar cuando una orden cierra. */
  conteoTipoHoy: Record<TipoOperacion, number>
  /**
   * Órdenes de Cargue ACTIVAS ahora mismo en modo "Arrume" (ID1/ID2). El
   * propio vehículo en Arrume no tarda más (la cuadrilla extra lo compensa —
   * validado con datos reales 2026-08-29), pero SÍ le quita personal a los
   * demás muelles del mismo día — hasta +45% más lento en casos reales. Sirve
   * solo de aviso; no cambia ningún SLA ni proyección (ver [[lipgo-modo-carga-arrume-estibado]]).
   */
  arrumeActivo: OrdenOperativa[]
}

/** SLA de respaldo (minutos) cuando no se pudo determinar el tipo de vehículo. */
const SLA_FALLBACK_MIN = 60

function fmtHoraDesdeMin(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60) % 24
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

async function fechaHoyColombia(): Promise<string> {
  const dt: any = await getColombiaDateTime()
  return dt.toLocaleDateString("en-CA")
}

export async function getCentroCoordinacion(
  idempresa: number,
  fecha?: string,
): Promise<{ success: boolean; data?: CentroCoordinacionData; message?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()
    const fechaConsulta = fecha || (await fechaHoyColombia())

    const horaActual = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date())
    const [hNow, mNow] = horaActual.split(":").map(Number)
    const minAhora = hNow * 60 + (mNow || 0)

    const metaTonDia = (TON_MES_CARGUE_DESCARGUE[idempresa] || 0) / DIAS_OPERACION_MES
    await cargarMuellesEmpresa()
    const muelleNumeros = getMuellesEmpresaSync(idempresa)
    const N = muelleNumeros.length || 1

    // 1) Headcount real de hoy (mismo criterio que Avance en Vivo).
    const { data: filas } = await admin
      .from("registroasistencia")
      .select("nombre, puesto, horaingreso, horaentradaprogramada, horasalidaprogramada")
      .eq("idempresa", idempresa)
      .eq("fecha", fechaConsulta)
      .not("puesto", "is", null)
      .not("horaingreso", "is", null)

    let headcountReal = 0
    let horasProgramadasTotales = 0
    let horasTranscurridas = 0
    let minEntradaMasTemprana: number | null = null
    for (const r of filas || []) {
      if (!esPuestoCargueDescargue(idempresa, r.puesto)) continue
      if (String(r.nombre || "").trim().toUpperCase() === "SIN AUXILIAR") continue
      headcountReal += 1
      if (!r.horaentradaprogramada) continue
      const [he, me] = String(r.horaentradaprogramada).split(":").map(Number)
      const minEntrada = he * 60 + (me || 0)
      if (minEntradaMasTemprana === null || minEntrada < minEntradaMasTemprana) minEntradaMasTemprana = minEntrada
      let minSalidaProgramada = minEntrada
      if (r.horasalidaprogramada) {
        const horasGross = duracionHoras(String(r.horaentradaprogramada), String(r.horasalidaprogramada))
        minSalidaProgramada = horasGross * 60 + minEntrada
        horasProgramadasTotales += Math.max(0, horasGross - 1)
      }
      const minTope = Math.min(minAhora, minSalidaProgramada)
      if (minTope > minEntrada) horasTranscurridas += (minTope - minEntrada) / 60
    }
    const metaPorHora = horasProgramadasTotales > 0 ? metaTonDia / horasProgramadasTotales : 0
    const capacidadTonHora = headcountReal * metaPorHora
    const horasCalendarioTranscurridas =
      minEntradaMasTemprana !== null ? Math.max(0, (minAhora - minEntradaMasTemprana) / 60) : 0

    // 2) Órdenes de hoy (los 3 tipos, se filtra por UI si aplica — el
    //    KPI siempre suma los 3 porque los muelles son compartidos) MÁS
    //    cualquier orden de un día anterior que haya quedado abierta
    //    (fincargue null): a veces una orden se crea un día para cargar al
    //    siguiente, o simplemente queda pendiente — antes, al cambiar el
    //    día, esa orden dejaba de consultarse aquí y se volvía invisible
    //    para el coordinador hasta que alguien la cerrara desde otro lado.
    //    Ahora se sigue mostrando (muelle/cola/parte de turno) hasta que
    //    cierra de verdad. Los indicadores que miden específicamente "hoy"
    //    (conteoTipoHoy, cargadoHoyTon, tiempo de cargue) se filtran aparte
    //    por fechacargue === fechaConsulta para no mezclarse con lo atrasado.
    const { data: ordenesRaw } = await admin
      .from("cabeceraoc")
      .select(
        "id, ordendecargue, tipooperacion, muelle, auxiliares, facturar, pesoorden, pesovascula, horaorden, iniciocargue, fincargue, placa, conductor, horalote, tipo_pago, modo_carga, fechacargue",
      )
      .eq("idempresa", idempresa)
      .or(`fechacargue.eq.${fechaConsulta},and(fechacargue.lt.${fechaConsulta},fincargue.is.null)`)

    const todasOrdenes = ordenesRaw || []

    // Conteo del día por tipo de operación — a diferencia de "muelles
    // ocupados ahora", este cuenta TODAS las órdenes de hoy (abiertas y ya
    // cerradas), así que no baja cuando una orden cierra y libera su
    // muelle. Es lo que deben reflejar los chips de filtro. Se excluyen acá
    // las rezagadas de días anteriores: no son actividad de "hoy".
    const conteoTipoHoy = { Cargue: 0, Descargue: 0, Distribucion: 0 } as Record<TipoOperacion, number>
    for (const o of todasOrdenes) {
      if (o.fechacargue !== fechaConsulta) continue
      const t = String(o.tipooperacion || "").trim() as TipoOperacion
      if (t in conteoTipoHoy) conteoTipoHoy[t] += 1
    }

    // Cargue requiere vehículo (placa) Y lote asignados para empezar a
    // operarse — mismo filtro real que ya usa Picking para lote
    // (getPendingLoadOrders: .not("horalote","is",null)). En la práctica el
    // lote, al aprobarse, ya exige que la placa esté asignada (ver
    // lib/batch-actions.ts), pero se encontró al menos una orden real con
    // horalote seteado y placa NULL (dato viejo, previo a que esa regla
    // quedara firme) que sí quedaba asignable a muelle sin vehículo — por
    // eso se exige `placa` explícitamente además de `horalote`, no se confía
    // en que uno implique el otro. Descargue/Distribución no tienen ese gate
    // en Packing, así que acá tampoco se les agrega uno nuevo.
    const ordenesActivasRaw = todasOrdenes.filter(
      (o: any) => !o.fincargue && (o.tipooperacion !== "Cargue" || (o.horalote && o.placa)),
    )
    const orderIdsActivas = ordenesActivasRaw.map((o: any) => o.id)
    const ordendecargueCargueActivas = ordenesActivasRaw
      .filter((o: any) => o.tipooperacion === "Cargue")
      .map((o: any) => o.ordendecargue)

    // 3) Cliente + conteo de líneas por orden (detalleoc, 1 sola consulta para todas).
    // De paso, si ALGUNA línea es subproducto (mogolla/salvado/harina de
    // tercera), toda la orden se mide contra el SLA "SUB" (más largo) en vez
    // de "PT" — antes se pedía "PT" siempre, sin mirar el producto real.
    const clientePorOrden = new Map<number, string>()
    const lineasDetalleocPorOrden = new Map<number, number>()
    const esSubproductoPorOrden = new Set<number>()
    // Huevos (y cualquier producto por unidad, ver esProductoPorUnidad): ese
    // personal se paga aparte — la orden se puede concluir sin auxiliares ni
    // tipo de pago. Se resuelve por subcategoría del producto (no por el
    // nombre), consultando `productos` para los nombres que aparecieron en
    // el detalle de las órdenes activas.
    const esPorUnidadPorOrden = new Set<number>()
    // Tipología dentro de PT (Bulto vs Pasta/Pacas livianas ≤15kg/unidad) —
    // solo para el ajuste fino de SLA (ver SLA_PT_POR_TIPOLOGIA). Se clasifica
    // por MAYORÍA de tonelaje real de la orden entre líneas no-subproducto
    // (misma metodología validada con un año de datos reales, 2026-08-29).
    const tipologiaPorOrden = new Map<number, TipologiaProducto>()
    if (orderIdsActivas.length > 0) {
      const { data: detalles } = await admin
        .from("detalleoc")
        .select("idorden, cliente, producto, toneladas")
        .in("idorden", orderIdsActivas)
      const productosPorOrdenTmp = new Map<number, Set<string>>()
      const tonPorOrdenTmp = new Map<number, { bulto: number; pasta: number }>()
      for (const d of detalles || []) {
        if (!clientePorOrden.has(d.idorden)) clientePorOrden.set(d.idorden, d.cliente || "Sin cliente")
        lineasDetalleocPorOrden.set(d.idorden, (lineasDetalleocPorOrden.get(d.idorden) || 0) + 1)
        if (esNombreSubproducto(d.producto)) esSubproductoPorOrden.add(d.idorden)
        const prod = String(d.producto || "").trim()
        if (prod) {
          if (!productosPorOrdenTmp.has(d.idorden)) productosPorOrdenTmp.set(d.idorden, new Set())
          productosPorOrdenTmp.get(d.idorden)!.add(prod)
        }
      }
      const nombresProductos = Array.from(new Set(Array.from(productosPorOrdenTmp.values()).flatMap((s) => Array.from(s))))
      if (nombresProductos.length > 0) {
        const { data: prods } = await admin
          .from("productos")
          .select("nombre, subcategoria, categoria, peso_unitkg")
          .in("nombre", nombresProductos)
        const subcategoriaPorNombre = new Map<string, string | null>()
        const categoriaPorNombre = new Map<string, string | null>()
        const pesoPorNombre = new Map<string, number>()
        for (const p of prods || []) {
          const n = String(p.nombre || "").trim()
          subcategoriaPorNombre.set(n, p.subcategoria)
          categoriaPorNombre.set(n, p.categoria)
          pesoPorNombre.set(n, Number(p.peso_unitkg) || 0)
        }
        for (const [idorden, prodsOrden] of productosPorOrdenTmp) {
          for (const prod of prodsOrden) {
            if (esProductoPorUnidad(subcategoriaPorNombre.get(prod))) {
              esPorUnidadPorOrden.add(idorden)
              break
            }
          }
        }
        for (const d of detalles || []) {
          if (esNombreSubproducto(d.producto)) continue // el SUB no entra a esta clasificación
          const prod = String(d.producto || "").trim()
          const ton = Number(d.toneladas) || 0
          if (!prod || ton <= 0) continue
          const cat = categoriaPorNombre.get(prod)
          const peso = pesoPorNombre.get(prod) || 0
          const esPasta = (cat === "PASTAS" || cat === "PACAS") && peso > 0 && peso <= 15
          const acc = tonPorOrdenTmp.get(d.idorden) || { bulto: 0, pasta: 0 }
          if (esPasta) acc.pasta += ton
          else acc.bulto += ton
          tonPorOrdenTmp.set(d.idorden, acc)
        }
        for (const [idorden, acc] of tonPorOrdenTmp) {
          tipologiaPorOrden.set(idorden, acc.pasta > acc.bulto ? "PASTA" : "BULTO")
        }
      }
    }

    // 4) Líneas de invtrans (Cargue): total y aprobadas por ordendecargue.
    const lineasInvtransPorOrden = new Map<string, { total: number; aprobadas: number }>()
    if (ordendecargueCargueActivas.length > 0) {
      const { data: filasInv } = await admin
        .from("invtrans")
        .select("ocargue, status")
        .in("ocargue", ordendecargueCargueActivas)
      for (const f of filasInv || []) {
        const acc = lineasInvtransPorOrden.get(f.ocargue) || { total: 0, aprobadas: 0 }
        acc.total += 1
        if (String(f.status || "").toLowerCase() === "aprobado") acc.aprobadas += 1
        lineasInvtransPorOrden.set(f.ocargue, acc)
      }
    }

    // 5) Tipo y capacidad de vehículo por orden (citasvehiculos, para el SLA
    //    acordado y para la barra de toneladas contra la capacidad real).
    const { data: citasHoy } = await admin
      .from("citasvehiculos")
      .select("placa, tipovehiculo, capacidad, ocargue, horallegada")
      .eq("idempresa", idempresa)
      .eq("fechallegada", fechaConsulta)
    const tipoPorOrden = new Map<string, string>(
      (citasHoy || []).filter((c: any) => c.ocargue).map((c: any) => [String(c.ocargue), c.tipovehiculo]),
    )
    const tipoPorPlaca = new Map<string, string>((citasHoy || []).map((c: any) => [String(c.placa), c.tipovehiculo]))
    const capacidadPorOrden = new Map<string, number>(
      (citasHoy || []).filter((c: any) => c.ocargue && c.capacidad).map((c: any) => [String(c.ocargue), num(c.capacidad)]),
    )
    const capacidadPorPlaca = new Map<string, number>(
      (citasHoy || []).filter((c: any) => c.capacidad).map((c: any) => [String(c.placa), num(c.capacidad)]),
    )

    // 6) Pausas activas.
    const ordenesPausadas = new Set(await getOrdenesPausadas())

    // 7) Armar OrdenOperativa por cada orden activa.
    // Huevos / Empaque MP (por unidad) también fuera de "cargado hoy": su peso
    // son unidades (regla compartida en lib/ordenes-por-unidad.ts). El set de
    // activas (`esPorUnidadPorOrden`) no cubre las ya cerradas de hoy.
    const porUnidadCerradas = await idsOrdenPorUnidad(admin, todasOrdenes.filter((o: any) => o.fincargue).map((o: any) => o.id))
    let cargadoHoyTon = 0
    for (const o of todasOrdenes) {
      if (!o.fincargue) continue
      const tipo = String(o.tipooperacion || "").trim()
      if (tipo === "proyeccion") continue // residuo de un módulo manual descontinuado en jul-2026, nunca tonelaje real
      if (excluirAvimolDistribucion(idempresa, tipo)) continue
      if (porUnidadCerradas.has(Number(o.id)) || esPorUnidadPorOrden.has(o.id)) continue
      const { peso } = pesoBaseCalculo(idempresa, tipo, num(o.pesovascula), num(o.pesoorden))
      if (peso > 0) cargadoHoyTon += peso
    }

    // 7b) Tiempo de cargue/descargue promedio de HOY — mismo cálculo que el
    // indicador BSC "lip_tiempo_cargue" (fincargue - iniciocargue en min,
    // acotado a 0-600 para descartar datos basura), pero acotado al día en
    // vez del periodo del BSC — consistente con que el resto de esta
    // pantalla es en vivo/diario.
    const aMinDia = (s: string) => {
      const [h, m, sec] = String(s).split(":").map(Number)
      return h * 60 + (m || 0) + (sec || 0) / 60
    }
    const duracionesHoy = todasOrdenes
      .filter((o: any) => o.iniciocargue && o.fincargue)
      .map((o: any) => aMinDia(o.fincargue) - aMinDia(o.iniciocargue))
      .filter((d: number) => d > 0 && d < 600)
    const tiempoCargueProedioMin =
      duracionesHoy.length > 0 ? Math.round(duracionesHoy.reduce((s: number, d: number) => s + d, 0) / duracionesHoy.length) : null
    const tiempoCargueBaseOrdenes = duracionesHoy.length

    // 7c) ESPERA POR ASIGNACIÓN DE LOTES — de que nace la orden a que le
    // asignan los lotes. Es tiempo en el que la orden existe pero no se puede
    // alistar. Lo pidió la operación: es donde sienten que se pierde el turno.
    //
    // Solo CARGUE: descargue y distribución no pasan por asignación de lotes.
    // Se descartan las que crucen medianoche o den negativo (dato basura): son
    // horas del día, sin fecha, así que una resta negativa no es una espera.
    const ordenesCargueHoy = todasOrdenes.filter(
      (o: any) => String(o.tipooperacion || "").trim() === "Cargue",
    )
    const esperasLotes = ordenesCargueHoy
      .filter((o: any) => o.horaorden && o.horalote)
      .map((o: any) => ({
        ordendecargue: String(o.ordendecargue),
        minutos: Math.round(aMinDia(o.horalote) - aMinDia(o.horaorden)),
      }))
      .filter((e: any) => e.minutos >= 0 && e.minutos < 600)
    const esperaLotesPromedioMin =
      esperasLotes.length > 0
        ? Math.round(esperasLotes.reduce((s: number, e: any) => s + e.minutos, 0) / esperasLotes.length)
        : null
    const esperaLotesBaseOrdenes = esperasLotes.length
    const esperaLotesPeor =
      esperasLotes.length > 0
        ? esperasLotes.reduce((peor: any, e: any) => (e.minutos > peor.minutos ? e : peor))
        : null
    const esperaLotesPendientes = ordenesCargueHoy.filter((o: any) => !o.horalote && !o.fincargue).length

    // Detalle orden por orden para el desglose de la tarjeta. Se ordena por la
    // espera mas larga primero: es el orden en que sirve mirarlo, no el
    // cronologico. Las que siguen esperando van arriba de todo, porque son las
    // unicas sobre las que todavia se puede hacer algo.
    const ahoraDt: any = await getColombiaDateTime()
    const ahoraMin = ahoraDt.getHours() * 60 + ahoraDt.getMinutes()
    const esperaLotesDetalle: EsperaLoteDetalle[] = ordenesCargueHoy
      .map((o: any) => {
        const tieneLotes = !!o.horalote
        const minutos =
          tieneLotes && o.horaorden ? Math.round(aMinDia(o.horalote) - aMinDia(o.horaorden)) : null
        const bruto = !tieneLotes && o.horaorden ? Math.round(ahoraMin - aMinDia(o.horaorden)) : null
        return {
          ordendecargue: String(o.ordendecargue),
          cliente: clientePorOrden.get(o.id) || "Sin cliente",
          placa: o.placa ? String(o.placa).trim() : null,
          horaorden: o.horaorden || null,
          horalote: o.horalote || null,
          minutos: minutos != null && minutos >= 0 && minutos < 600 ? minutos : null,
          esperandoMin: bruto != null && bruto >= 0 && bruto < 600 ? bruto : null,
          cerrada: !!o.fincargue,
        }
      })
      .sort((a: EsperaLoteDetalle, b: EsperaLoteDetalle) => {
        // Primero las que siguen esperando, de mayor a menor; despues las ya
        // resueltas, tambien de mayor a menor.
        const aVivo = a.horalote ? 0 : 1
        const bVivo = b.horalote ? 0 : 1
        if (aVivo !== bVivo) return bVivo - aVivo
        return (b.esperandoMin ?? b.minutos ?? -1) - (a.esperandoMin ?? a.minutos ?? -1)
      })

    const armar = (o: any): OrdenOperativa => {
      const tipo = String(o.tipooperacion || "").trim() as TipoOperacion
      const placa = o.placa ? String(o.placa).trim() : null
      const tipovehiculo = tipoPorOrden.get(String(o.ordendecargue)) || (placa ? tipoPorPlaca.get(placa) : null) || null
      const capacidadVehiculo =
        capacidadPorOrden.get(String(o.ordendecargue)) ?? (placa ? capacidadPorPlaca.get(placa) : undefined) ?? null
      const slaMin =
        getSlaCargueMin(
          tipovehiculo,
          esSubproductoPorOrden.has(o.id) ? "SUB" : "PT",
          idempresa,
          tipologiaPorOrden.get(o.id),
        ) || SLA_FALLBACK_MIN
      const auxiliares = String(o.auxiliares || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
      const pausado = ordenesPausadas.has(o.ordendecargue)
      let minutosTranscurridos: number | null = null
      let slaVencido = false
      let slaEnRiesgo = false
      if (o.iniciocargue) {
        const [ih, im] = String(o.iniciocargue).split(":").map(Number)
        const minInicio = ih * 60 + (im || 0)
        minutosTranscurridos = Math.max(0, minAhora - minInicio)
        slaVencido = slaMin != null && minutosTranscurridos > slaMin
        // Aviso temprano: sin vencer todavía, pero ya se consumió ≥80% del SLA.
        slaEnRiesgo = !slaVencido && slaMin != null && minutosTranscurridos >= slaMin * 0.8
      }
      const lineasInv = tipo === "Cargue" ? lineasInvtransPorOrden.get(o.ordendecargue) : null
      return {
        orderId: o.id,
        ordendecargue: o.ordendecargue,
        tipooperacion: tipo,
        cliente: clientePorOrden.get(o.id) || "Sin cliente",
        placa,
        conductor: o.conductor || null,
        muelle: o.muelle ?? null,
        auxiliares,
        facturar: o.facturar ?? null,
        tipoPago: o.tipo_pago ?? null,
        pesoorden: num(o.pesoorden),
        pesovascula: o.pesovascula != null ? num(o.pesovascula) : null,
        iniciocargue: o.iniciocargue || null,
        fincargue: o.fincargue || null,
        tipovehiculo,
        capacidadVehiculo,
        slaMin,
        pausado,
        lineasTotal: lineasInv ? lineasInv.total : lineasDetalleocPorOrden.get(o.id) || 0,
        lineasAprobadas: lineasInv ? lineasInv.aprobadas : null,
        minutosTranscurridos,
        slaVencido,
        slaEnRiesgo,
        estado: pausado ? "pausado" : o.iniciocargue ? "cargando" : "alistando",
        rezagada: o.fechacargue !== fechaConsulta,
        esDescargueHuevos: idempresa === 2 && tipo === "Descargue" && esPorUnidadPorOrden.has(o.id),
        modoCarga: o.modo_carga ?? null,
        requiereModoCarga: esModoCargaRequerido(idempresa, tipo),
      }
    }

    // Los muelles son un recurso físico compartido por los 3 tipos de
    // operación: NUNCA se filtran por tipo acá — un muelle ocupado por un
    // Descargue debe seguir viéndose ocupado aunque el coordinador esté
    // mirando el filtro "Cargue". El filtro de tipo es solo una ayuda visual
    // en el cliente (resaltar/atenuar), nunca esconde ocupación real.
    const ordenesOperativas: OrdenOperativa[] = ordenesActivasRaw.map(armar)

    // 8) Muelles: ocupación REAL (cabeceraoc.muelle) + cola sin muelle asignado.
    // Los números de muelle vienen de `muelles_empresa` (administrable) y no son
    // necesariamente contiguos 1..N (se puede desactivar uno puntual) — por eso
    // se busca por número real, no por aritmética de índice.
    const muelles: MuelleSlot[] = muelleNumeros.length > 0
      ? muelleNumeros.map((m) => ({ muelle: m, orden: null }))
      : Array.from({ length: N }, (_, i) => ({ muelle: i + 1, orden: null }))
    const muellePorNumero = new Map(muelles.map((slot) => [slot.muelle, slot]))
    // El clon de Distribución automática ("+D") es el MISMO vehículo y la
    // MISMA orden física que su madre de Cargue — solo existe para
    // facturación/trazabilidad (generarDistribucionAutomatica en
    // orders-actions.tsx). No representa un vehículo adicional esperando
    // muelle: se excluye de la asignación de muelle (grid + cola sin
    // muelle + auto-asignación), pero conserva su funcionamiento normal en
    // todo lo demás (KPIs, conteo por tipo, Packing, nómina, historial).
    const esClonDistribucion = (o: OrdenOperativa) => o.tipooperacion === "Distribucion" && o.ordendecargue.endsWith("D")
    let colaSinMuelle: OrdenOperativa[] = []
    for (const o of ordenesOperativas) {
      if (esClonDistribucion(o)) continue
      const slot = o.muelle != null ? muellePorNumero.get(o.muelle) : undefined
      if (slot) {
        slot.orden = o
      } else {
        colaSinMuelle.push(o)
      }
    }
    colaSinMuelle.sort((a, b) => a.ordendecargue.localeCompare(b.ordendecargue))

    // 8b) Auto-asignación de muelle: una orden ya "cargando" (iniciocargue
    // puesto, sin pasar por Centro de Coordinación) sin muelle asignado es
    // una situación real mientras el módulo no reemplaza a Picking/Packing —
    // se alerta de inmediato (`alertaCargandoSinMuelle`, cualquier minuto) y,
    // si pasan ≥15 min sin que el coordinador la asigne a mano, el sistema le
    // asigna el primer muelle libre que encuentre en ese momento. Si no hay
    // ninguno libre, se reintenta en el próximo refresco (cada 60s) hasta que
    // se libere uno — nunca se deja de intentar.
    const autoAsignaciones: { ordendecargue: string; placa: string | null; muelle: number }[] = []
    const candidatasAutoAsignar = colaSinMuelle.filter(
      (o) => o.estado === "cargando" && o.minutosTranscurridos != null && o.minutosTranscurridos >= 15,
    )
    for (const o of candidatasAutoAsignar) {
      const idxLibre = muelles.findIndex((m) => m.orden === null)
      if (idxLibre === -1) break // no quedan muelles libres ahora mismo
      const muelleLibre = muelles[idxLibre].muelle
      const resultado = await asignarOrdenAMuelle(o.orderId, muelleLibre)
      if (resultado.success) {
        o.muelle = muelleLibre
        muelles[idxLibre].orden = o
        autoAsignaciones.push({ ordendecargue: o.ordendecargue, placa: o.placa, muelle: muelleLibre })
      }
    }
    if (autoAsignaciones.length > 0) {
      colaSinMuelle = colaSinMuelle.filter((o) => o.muelle == null)
    }
    const alertaCargandoSinMuelle = colaSinMuelle.filter((o) => o.estado === "cargando")

    // 9) Proyección de cierre: earliest-available-machine sobre los muelles
    //    REALES. Los ocupados calculan su fin desde iniciocargue+SLA (si aún
    //    no inician, se estima desde AHORA — no se conoce cuándo arrancarán).
    //    La cola sin muelle se reparte en el que se desocupe primero.
    const muelleLibreDesde: number[] = new Array(N).fill(minAhora)
    muelles.forEach((slot, i) => {
      const o = slot.orden
      if (!o) return
      const minInicio = o.iniciocargue
        ? (() => {
            const [ih, im] = String(o.iniciocargue).split(":").map(Number)
            return ih * 60 + (im || 0)
          })()
        : minAhora
      muelleLibreDesde[i] = Math.max(minInicio + (o.slaMin || SLA_FALLBACK_MIN), minAhora)
    })
    colaSinMuelle.forEach((o) => {
      let idx = 0
      for (let i = 1; i < N; i++) if (muelleLibreDesde[i] < muelleLibreDesde[idx]) idx = i
      const inicio = Math.max(muelleLibreDesde[idx], minAhora)
      muelleLibreDesde[idx] = inicio + (o.slaMin || SLA_FALLBACK_MIN)
    })
    const pendientesTotal = ordenesOperativas.length
    const minCierreProyectado = muelleLibreDesde.length > 0 ? Math.max(...muelleLibreDesde) : minAhora
    const proyeccionHoraFinCola =
      pendientesTotal > 0 && minCierreProyectado < 24 * 60 && minCierreProyectado > minAhora
        ? fmtHoraDesdeMin(minCierreProyectado)
        : null

    // 10) SLA de cumplimiento: % de órdenes EN CARGUE (ya iniciadas) que
    //     siguen dentro de su SLA acordado.
    const enCargue = ordenesOperativas.filter((o) => o.iniciocargue)
    const enRiesgo = enCargue.filter((o) => o.slaVencido)
    const slaCumplimientoPct = enCargue.length > 0 ? round1(((enCargue.length - enRiesgo.length) / enCargue.length) * 100) : null

    // 9b) Semáforo del turno — mismo criterio que "Avance en Vivo": compara
    //     lo cargado contra lo que ya se debería haber cargado a esta hora
    //     según las horas de personal realmente trabajadas.
    const metaEsperadaAhoraTon = metaPorHora * horasTranscurridas
    const tonFaltante = Math.max(0, metaTonDia - cargadoHoyTon)
    let estadoTurno: CentroCoordinacionKpis["estadoTurno"] = "sin_datos"
    if (headcountReal > 0 && horasTranscurridas > 0) {
      if (tonFaltante <= 0 || cargadoHoyTon >= metaEsperadaAhoraTon) estadoTurno = "adelantado"
      else if (cargadoHoyTon >= metaEsperadaAhoraTon * 0.85) estadoTurno = "cerca"
      else estadoTurno = "atrasado"
    }

    // 11) Personal: asignado (únicos en órdenes activas) vs disponible (mismo
    //     universo que ya usa Picking/Packing).
    const personalAsignadoSet = new Set<string>()
    for (const o of ordenesOperativas) for (const a of o.auxiliares) personalAsignadoSet.add(a.toUpperCase())
    const personalDisponibleRes = await getCarguDescarguePersonnel(idempresa)
    const personalDisponibleLista = personalDisponibleRes.success ? personalDisponibleRes.data : []

    // 12) Cola de patio: vehículos con cita hoy que aún no tienen orden de cargue vinculada.
    const colaPatio: ColaPatioItem[] = (citasHoy || [])
      .filter((c: any) => !c.ocargue)
      .map((c: any) => ({ placa: c.placa, tipovehiculo: c.tipovehiculo || null, horallegada: c.horallegada || null }))
      .sort((a: ColaPatioItem, b: ColaPatioItem) => (a.horallegada || "").localeCompare(b.horallegada || ""))

    const muellesOcupados = muelles.filter((m) => m.orden !== null).length

    // 13) Sugerencia de siguiente turno: primer muelle libre + vehículo de
    //     patio más antiguo (preferimos coincidencia de tipo de vehículo con
    //     el último atendido en ese muelle si se puede saber; si no, el más
    //     antiguo en cola).
    let sugerenciaProximoTurno: SugerenciaTurno | null = null
    const primerMuelleLibre = muelles.find((m) => !m.orden)
    if (primerMuelleLibre && colaPatio.length > 0) {
      const primero = colaPatio[0]
      sugerenciaProximoTurno = { muelle: primerMuelleLibre.muelle, placa: primero.placa, tipovehiculo: primero.tipovehiculo }
    }

    // 14) Comparación vs. ayer a la misma hora — mismo corte de reloj, para
    //     que el número sea comparable (no el total del día completo de ayer).
    const ayer = new Date(`${fechaConsulta}T00:00:00`)
    ayer.setDate(ayer.getDate() - 1)
    const fechaAyer = ayer.toISOString().slice(0, 10)
    const { data: ordenesAyer } = await admin
      .from("cabeceraoc")
      .select("tipooperacion, pesovascula, pesoorden, fincargue")
      .eq("idempresa", idempresa)
      .eq("fechacargue", fechaAyer)
      .not("fincargue", "is", null)
      .neq("tipooperacion", "proyeccion")
      .lte("fincargue", horaActual)
    let cargadoAyerMismaHoraTon = 0
    for (const o of ordenesAyer || []) {
      const tipo = String(o.tipooperacion || "").trim()
      if (excluirAvimolDistribucion(idempresa, tipo)) continue
      const { peso } = pesoBaseCalculo(idempresa, tipo, num(o.pesovascula), num(o.pesoorden))
      if (peso > 0) cargadoAyerMismaHoraTon += peso
    }
    const vsAyerPct = cargadoAyerMismaHoraTon > 0 ? round1(((cargadoHoyTon - cargadoAyerMismaHoraTon) / cargadoAyerMismaHoraTon) * 100) : null

    // 15) Aviso de Arrume activo: órdenes de Cargue en curso ahora mismo con
    // modoCarga === "Arrume" — puro aviso de contención de personal para el
    // resto de los muelles, no afecta ningún cálculo de SLA/proyección.
    const arrumeActivo = ordenesOperativas.filter((o) => o.modoCarga === "Arrume")

    return {
      success: true,
      data: {
        idempresa,
        fecha: fechaConsulta,
        horaActual,
        kpis: {
          cargadoHoyTon: round1(cargadoHoyTon),
          metaTonDia: round1(metaTonDia),
          ritmoTonHora: round2(horasCalendarioTranscurridas > 0.25 ? cargadoHoyTon / horasCalendarioTranscurridas : 0),
          capacidadTonHora: round2(capacidadTonHora),
          slaCumplimientoPct,
          ordenesEnRiesgo: enRiesgo.length,
          ordenesActivas: ordenesOperativas.length,
          personalEnPiso: headcountReal,
          personalAsignado: personalAsignadoSet.size,
          personalDisponible: personalDisponibleLista.length,
          muellesOcupados,
          muellesTotal: N,
          proyeccionHoraFinCola,
          cargadoAyerMismaHoraTon: round1(cargadoAyerMismaHoraTon),
          vsAyerPct,
          metaPorHoraTrabajador: round2(metaPorHora),
          metaEsperadaAhoraTon: round1(metaEsperadaAhoraTon),
          estadoTurno,
          tiempoCargueProedioMin,
          tiempoCargueBaseOrdenes,
          esperaLotesPromedioMin,
          esperaLotesBaseOrdenes,
          esperaLotesPeor,
          esperaLotesPendientes,
          esperaLotesDetalle,
        },
        muelles,
        colaSinMuelle,
        colaPatio,
        personalDisponibleLista,
        sugerenciaProximoTurno,
        alertaCargandoSinMuelle,
        autoAsignaciones,
        conteoTipoHoy,
        arrumeActivo,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al cargar el Centro de Coordinación." }
  }
}

// ---------------------------------------------------------------------------
// Parte de turno — resumen para entregarle al siguiente coordinador. Reusa
// getCentroCoordinacion (no duplica sus cálculos) y solo agrega el conteo de
// órdenes cerradas hoy + la lista de pendientes armada desde los mismos datos.
// ---------------------------------------------------------------------------

export interface HistorialOrdenTurno {
  ordendecargue: string
  tipooperacion: TipoOperacion
  cliente: string
  placa: string | null
  muelle: number | null
  estado: "cerrada" | "en_curso"
  horaCierre: string | null
  /** Trazabilidad real (auxiliares_real) — quién asignó de verdad el coordinador, no se pierde aunque la orden haya cerrado en pago Global. */
  personalReal: string[]
  /** true = quedó abierta de un día anterior al consultado. */
  rezagada: boolean
  /** "Estibado"/"Arrume" si la orden lo requería y ya se eligió; null si no aplica o aún no se elige. */
  modoCarga: "Estibado" | "Arrume" | null
}

export interface ParteDeTurno {
  cargadoHoyTon: number
  ordenesCerradas: number
  ordenesEnCurso: number
  /** Vencidas EN ESTE MOMENTO entre las activas — no es un acumulado histórico del día completo. */
  slaVencidosAhora: number
  personalEnPiso: number
  pendientes: string[]
  /** Historial completo del día (abiertas + cerradas) con su personal real asignado, más reciente primero. */
  historial: HistorialOrdenTurno[]
}

export async function getParteDeTurno(
  idempresa: number,
  fecha?: string,
): Promise<{ success: boolean; data?: ParteDeTurno; message?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()
    const fechaConsulta = fecha || (await fechaHoyColombia())

    const base = await getCentroCoordinacion(idempresa, fechaConsulta)
    if (!base.success || !base.data) return { success: false, message: base.message }

    const { data: cerradas } = await admin
      .from("cabeceraoc")
      .select("id")
      .eq("idempresa", idempresa)
      .eq("fechacargue", fechaConsulta)
      .not("fincargue", "is", null)

    // Historial del día completo (abiertas + cerradas), con su personal real
    // asignado — a diferencia del tablero de muelles, que solo muestra las
    // abiertas y las pierde de vista apenas cierran. Incluye también las
    // rezagadas de días anteriores que sigan abiertas (mismo criterio que
    // getCentroCoordinacion): el siguiente turno debe verlas en el parte,
    // no que desaparezcan por el cambio de día.
    const { data: todasHoy } = await admin
      .from("cabeceraoc")
      .select("id, ordendecargue, tipooperacion, placa, muelle, fincargue, auxiliares, auxiliares_real, modo_carga, fechacargue")
      .eq("idempresa", idempresa)
      .or(`fechacargue.eq.${fechaConsulta},and(fechacargue.lt.${fechaConsulta},fincargue.is.null)`)
      .in("tipooperacion", ["Cargue", "Descargue", "Distribucion"])
      .order("id", { ascending: false })

    const idsHoy = (todasHoy || []).map((o: any) => o.id)
    const clientePorOrdenHoy = new Map<number, string>()
    if (idsHoy.length > 0) {
      const { data: detallesHoy } = await admin.from("detalleoc").select("idorden, cliente").in("idorden", idsHoy)
      for (const d of detallesHoy || []) {
        if (!clientePorOrdenHoy.has(d.idorden)) clientePorOrdenHoy.set(d.idorden, d.cliente || "Sin cliente")
      }
    }

    const historial: HistorialOrdenTurno[] = (todasHoy || []).map((o: any) => ({
      ordendecargue: o.ordendecargue,
      tipooperacion: String(o.tipooperacion || "").trim() as TipoOperacion,
      cliente: clientePorOrdenHoy.get(o.id) || "Sin cliente",
      placa: o.placa || null,
      muelle: o.muelle ?? null,
      estado: o.fincargue ? "cerrada" : "en_curso",
      horaCierre: o.fincargue || null,
      personalReal: String(o.auxiliares_real || o.auxiliares || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
      rezagada: o.fechacargue !== fechaConsulta,
      modoCarga: o.modo_carga ?? null,
    }))

    const pendientes: string[] = []
    for (const slot of base.data.muelles) {
      const o = slot.orden
      if (!o) continue
      if (o.pausado) {
        pendientes.push(`Muelle ${slot.muelle} (${o.cliente}, ${o.placa || "sin placa"}) en pausa — falta reanudar y cerrar.`)
      } else if (o.slaVencido && o.auxiliares.length === 0) {
        pendientes.push(`Muelle ${slot.muelle} (${o.cliente}, ${o.placa || "sin placa"}) sin personal asignado, SLA vencido.`)
      } else if (o.slaVencido) {
        pendientes.push(`Muelle ${slot.muelle} (${o.cliente}, ${o.placa || "sin placa"}) con SLA vencido.`)
      }
    }
    if (base.data.colaSinMuelle.length > 0) {
      pendientes.push(`${base.data.colaSinMuelle.length} orden(es) esperando muelle libre.`)
    }
    for (const o of base.data.alertaCargandoSinMuelle) {
      pendientes.push(`${o.cliente} (${o.placa || "sin placa"}) está cargando sin muelle asignado — asignar cuanto antes.`)
    }

    return {
      success: true,
      data: {
        cargadoHoyTon: base.data.kpis.cargadoHoyTon,
        ordenesCerradas: cerradas?.length || 0,
        ordenesEnCurso: base.data.kpis.ordenesActivas,
        slaVencidosAhora: base.data.kpis.ordenesEnRiesgo,
        personalEnPiso: base.data.kpis.personalEnPiso,
        pendientes,
        historial,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al calcular el parte de turno." }
  }
}

// ---------------------------------------------------------------------------
// Acciones — asignar muelle e iniciar orden. Reutilizan generatePickingPDF /
// generatePackingPDF (las mismas que usan Picking y Packing) para el documento.
//
// EL INICIO DE LA OPERACION LO MARCA SOLO `asignarOrdenAMuelle`. Ni el PDF de
// Picking ni el de Packing escriben ya `iniciocargue`: antes los tres podian
// hacerlo y la hora dependia de cual se ejecutara primero, asi que la misma
// orden quedaba con un inicio distinto segun por donde se operara.
// ---------------------------------------------------------------------------

/**
 * Asigna una orden a un muelle y, con eso, ARRANCA EL RELOJ DE LA OPERACIÓN.
 *
 * Asignar el muelle es el momento real en que la operación empieza: el vehículo
 * deja de esperar en patio y ocupa un puesto. Por eso aquí se escribe también
 * `cabeceraoc.iniciocargue`. Antes solo se escribía al generar el PDF de
 * Picking/Packing, así que entre que el vehículo tomaba el muelle y alguien
 * generaba ese documento la orden figuraba como "alistando" y el SLA no corría
 * — tiempo real de muelle que no quedaba medido en ninguna parte.
 *
 * NO SE PISA una hora ya existente. Si la orden ya venía con `iniciocargue`
 * — porque el PDF se generó primero, o porque se la mueve de un muelle a otro —
 * manda la primera hora. Reasignar de muelle no puede reiniciar el cronómetro:
 * el SLA, el tiempo de cargue promedio y el estado de la orden se miden desde
 * ahí, y volver a ponerlo en cero borraría el tiempo ya transcurrido.
 *
 * Aplica a los tres tipos de operación (Cargue, Descargue y Distribución):
 * `iniciocargue` es el campo que ambos flujos —Picking y Packing— ya usan para
 * marcar el inicio, y dejar uno solo de ellos fuera haría que un descargue en
 * muelle quedara indefinidamente en "alistando".
 */
export async function asignarOrdenAMuelle(
  orderId: number,
  muelle: number,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient()

  const { data: orderRow, error: fetchErr } = await supabase
    .from("cabeceraoc")
    .select("id, idempresa, muelle, fincargue, iniciocargue")
    .eq("id", orderId)
    .single()
  if (fetchErr || !orderRow) return { success: false, message: "No se encontró la orden" }
  if (orderRow.fincargue) return { success: false, message: "La orden ya está cerrada" }

  await cargarMuellesEmpresa()
  const muellesActivos = getMuellesEmpresaSync(orderRow.idempresa)
  if (!Number.isFinite(muelle) || !muellesActivos.includes(muelle)) {
    return { success: false, message: `Muelle inválido (activos: ${muellesActivos.join(", ") || "ninguno configurado"})` }
  }

  const { data: ocupante } = await supabase
    .from("cabeceraoc")
    .select("id")
    .eq("idempresa", orderRow.idempresa)
    .eq("muelle", muelle)
    .is("fincargue", null)
    .neq("id", orderId)
    .limit(1)
    .maybeSingle()
  if (ocupante) return { success: false, message: `El muelle ${muelle} ya está ocupado` }

  // El reloj arranca aquí, salvo que ya estuviera corriendo.
  const cambios: { muelle: number; iniciocargue?: string } = { muelle }
  let arrancoElReloj = false
  if (!orderRow.iniciocargue) {
    cambios.iniciocargue = await getColombiaTime()
    arrancoElReloj = true
  }

  const { error } = await supabase.from("cabeceraoc").update(cambios).eq("id", orderId)
  if (error) return { success: false, message: error.message }

  // Aviso al conductor. Va DESPUES del update y sin await bloqueante sobre el
  // resultado: si la mensajeria falla, el muelle ya quedo asignado y el
  // coordinador no puede quedarse esperando. `notificarConductor` nunca lanza.
  try {
    await notificarConductor("muelle_asignado", orderId)
    // El reporte interno va aparte del aviso al conductor: son mensajes
    // distintos a destinatarios distintos, y que uno falle no debe cancelar el
    // otro.
    await reportarInterno("muelle_asignado", orderId)
  } catch (e: any) {
    console.error("[v0] aviso muelle_asignado:", e?.message ?? e)
  }

  return {
    success: true,
    message: arrancoElReloj
      ? `Orden asignada al muelle ${muelle} — inicio de cargue ${cambios.iniciocargue}`
      : `Orden asignada al muelle ${muelle}`,
  }
}

/**
 * Libera el muelle. NO borra `iniciocargue`: la operación sí empezó, y borrar
 * esa hora perdería un hecho que ya ocurrió y falsearía el tiempo de cargue.
 */
export async function liberarMuelle(orderId: number): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from("cabeceraoc").update({ muelle: null }).eq("id", orderId)
  if (error) return { success: false, message: error.message }
  return { success: true, message: "Muelle liberado" }
}

export async function iniciarOrdenEnMuelle(
  orderId: number,
  muelle: number,
  orderData: { ordendecargue: string; cliente: string; placa: string; conductor: string; tipooperacion: TipoOperacion },
): Promise<{ success: boolean; message?: string; url?: string }> {
  const asigna = await asignarOrdenAMuelle(orderId, muelle)
  if (!asigna.success) return asigna

  if (orderData.tipooperacion === "Cargue") {
    const r = await generatePickingPDF(orderId, orderData.ordendecargue, orderData.cliente, orderData.placa, orderData.conductor)
    if (!r.success) return { success: false, message: r.error || r.message }
    return { success: true, message: "Cargue iniciado", url: r.url }
  }

  const r = await generatePackingPDF(orderId, orderData.ordendecargue, orderData.cliente, orderData.placa, orderData.conductor)
  if (!r.success) return { success: false, message: r.error }
  // El inicio ya quedó marcado por `asignarOrdenAMuelle`, arriba. Aquí solo se
  // genera el documento.
  return { success: true, message: "Orden iniciada", url: r.pdfUrl }
}

// ---------------------------------------------------------------------------
// Hoja del muelle — detalle expandible bajo cada fila. Carga bajo demanda
// (solo cuando el coordinador expande), no en el refresco de 60s.
// ---------------------------------------------------------------------------

export interface LineaOrden {
  id: number
  producto: string
  cantidad: number
  status?: string | null
}

export interface HojaMuelle {
  orderId: number
  ordendecargue: string
  tipooperacion: TipoOperacion
  cliente: string
  placa: string | null
  conductor: string | null
  auxiliares: { nombre: string; tonAsignada: number; tonPorHora: number }[]
  lineas: LineaOrden[]
  trazabilidad: { evento: string; hora: string | null }[]
  fotospicking: string[]
  evidenciaPreoperacional: { fotos: string[]; fecha: string | null } | null
  vehiculosAtendidosHoy: { ordendecargue: string; placa: string | null; fincargue: string | null; pesovascula: number | null }[]
}

export async function getHojaDelMuelle(orderId: number): Promise<{ success: boolean; data?: HojaMuelle; message?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()

    const { data: o, error } = await admin
      .from("cabeceraoc")
      .select(
        "id, idempresa, ordendecargue, tipooperacion, muelle, placa, conductor, auxiliares, auxiliares_real, pesoorden, pesovascula, fechacargue, horaorden, horalote, horavehiculo, horasanitario, pesajeinicial, iniciocargue, pesajefinal, fincargue, fotospicking, tiquetebascula",
      )
      .eq("id", orderId)
      .single()
    if (error || !o) return { success: false, message: "No se encontró la orden" }

    const tipo = String(o.tipooperacion || "").trim() as TipoOperacion

    const { data: detalle } = await admin.from("detalleoc").select("cliente").eq("idorden", orderId).limit(1).maybeSingle()

    let lineas: LineaOrden[] = []
    if (tipo === "Cargue") {
      const { data: inv } = await admin
        .from("invtrans")
        .select("id, nombreproducto, cantidad, status")
        .eq("ocargue", o.ordendecargue)
      lineas = (inv || []).map((r: any) => ({ id: r.id, producto: r.nombreproducto, cantidad: num(r.cantidad), status: r.status || null }))
    } else {
      const pk = await getPackingItems(o.ordendecargue)
      lineas = (pk.data || []).map((r: any) => ({ id: r.id, producto: r.producto, cantidad: num(r.cantidad), status: null }))
    }

    // Trazabilidad de quién trabajó realmente el vehículo: `auxiliares_real`
    // nunca se sobrescribe en pago 'global' (a diferencia de `auxiliares`,
    // que sí se recalcula al cerrar) — se usa esa como fuente aquí. Si la
    // orden es de antes de este campo, cae a `auxiliares`.
    const auxiliaresNombres = String(o.auxiliares_real || o.auxiliares || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)
    const { peso: tonOrden } = pesoBaseCalculo(o.idempresa, tipo, num(o.pesovascula), num(o.pesoorden))
    let horasDesdeInicio = 0
    if (o.iniciocargue) {
      const horaActual = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Bogota",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date())
      const [hNow, mNow] = horaActual.split(":").map(Number)
      const [ih, im] = String(o.iniciocargue).split(":").map(Number)
      horasDesdeInicio = Math.max(0, (hNow * 60 + (mNow || 0) - (ih * 60 + (im || 0))) / 60)
    }
    const auxiliares = auxiliaresNombres.map((nombre) => {
      const tonAsignada = auxiliaresNombres.length > 0 ? tonOrden / auxiliaresNombres.length : 0
      return {
        nombre,
        tonAsignada: round2(tonAsignada),
        tonPorHora: round2(horasDesdeInicio > 0 ? tonAsignada / horasDesdeInicio : 0),
      }
    })

    // La trazabilidad ahora arranca en la CREACIÓN de la orden y muestra la
    // asignación de lotes. Faltaban las dos, y son justo el tramo donde la
    // operación reporta que se pierde tiempo: la orden ya existe pero no se
    // puede alistar hasta que alguien le asigne los lotes.
    const trazabilidad = [
      { evento: "Creación de la orden", hora: o.horaorden || null },
      { evento: "Asignación de lotes", hora: o.horalote || null },
      { evento: "Llegada", hora: o.horavehiculo || null },
      { evento: "Registro/inspección", hora: o.horasanitario || null },
      { evento: "Pesaje inicial", hora: o.pesajeinicial || null },
      { evento: "Inicio de cargue", hora: o.iniciocargue || null },
      { evento: "Pesaje final", hora: o.pesajefinal || null },
      { evento: "Cierre", hora: o.fincargue || null },
    ]

    let fotospicking: string[] = []
    try {
      fotospicking = o.fotospicking ? JSON.parse(o.fotospicking) : []
    } catch {
      fotospicking = []
    }

    let evidenciaPreoperacional: HojaMuelle["evidenciaPreoperacional"] = null
    if (o.placa) {
      const { data: insp } = await admin
        .from("inspeccion_sanitaria_vehiculos")
        .select("fotos, fecha")
        .eq("id_empresa", o.idempresa)
        .eq("placa_vehiculo", o.placa)
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (insp) evidenciaPreoperacional = { fotos: insp.fotos || [], fecha: insp.fecha || null }
    }

    const { data: atendidosHoy } = await admin
      .from("cabeceraoc")
      .select("ordendecargue, placa, fincargue, pesovascula")
      .eq("idempresa", o.idempresa)
      .eq("fechacargue", o.fechacargue)
      .eq("muelle", o.muelle)
      .not("fincargue", "is", null)
      .order("fincargue", { ascending: false })
      .limit(10)

    return {
      success: true,
      data: {
        orderId: o.id,
        ordendecargue: o.ordendecargue,
        tipooperacion: tipo,
        cliente: detalle?.cliente || "Sin cliente",
        placa: o.placa || null,
        conductor: o.conductor || null,
        auxiliares,
        lineas,
        trazabilidad,
        fotospicking,
        evidenciaPreoperacional,
        vehiculosAtendidosHoy: atendidosHoy || [],
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al cargar la hoja del muelle." }
  }
}

// El "Confirmar Picking" por excepción desde Centro de Coordinación
// (marcarPickingConfirmadoPorExcepcion) se retiró el 2026-10-02 por decisión
// de la gerencia: las líneas "por descontar" solo se aprueban desde Picking,
// verificando lote y cantidad. El coordinador llega allá con "Ir a Picking".
