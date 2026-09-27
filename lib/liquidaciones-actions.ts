"use server"

// Submódulo Liquidaciones: personas RETIRADAS (headcount.estado Inactivo) CON
// contrato (número SIIGO), separado por CLIENTE (headcount.idempresa). Muestra:
//   - Nómina PENDIENTE de pago (desde pagonomina, posterior a "pagado_hasta" y
//     hasta la fecha de retiro).
//   - PRESTACIONES SOCIALES (prima, cesantías, intereses, vacaciones) calculadas
//     sobre el devengado del período de causación, con % de parametros_prestaciones.
// Estado (pendiente/liquidada), soporte y "pagado_hasta" viven en liquidaciones_retiro.
//
// Base de prestaciones = devengado (salario + extras + recargos) + Auxilio de
// Transporte (parametros_legales_anio.auxilio_transporte), EXCEPTO vacaciones que
// excluye el auxilio. Períodos de causación derivados de la fecha de retiro:
//   - Cesantías / intereses / vacaciones: desde el 1-ene del año del retiro.
//   - Prima: desde 1-ene (si retiro en 1er semestre) o 1-jul (si 2do semestre).

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { clasificarDiaCotizacion } from "@/lib/parafiscales"

// Corte de la reversión "nómina pendiente vuelve a pagarse por el plano"
// (2026-09-08, pedido explícito del usuario): antes, al retirarse alguien se
// excluía TODA su nómina pendiente del archivo plano y se cobraba junto con
// la liquidación (ver 059_archivoplano_reemplazo.sql). Ahora la nómina de los
// días trabajados hasta el retiro debe seguir saliendo en el plano de la
// quincena (nómina normal) "mientras se organiza el pago de la liquidación";
// Liquidaciones queda solo para las OTRAS acreencias (cesantías, intereses,
// prima, vacaciones, indemnización). Cambio SOLO HACIA ADELANTE (confirmado
// por el usuario): los retiros YA procesados (fecha_retiro < este corte) no
// se tocan -- su nómina pendiente sigue sumando al total de Liquidaciones,
// exactamente como antes. El MISMO corte gobierna la vista SQL `archivoplano`
// (ver scripts/059_archivoplano_reemplazo.sql, WHERE de `base_datos` y las otras
// 3 ramas que unen contra headcount) -- si se mueve aquí, hay que moverlo
// también allá (son 4 lugares en ese archivo, documentados con la misma
// nota "si se cambia una, cambiar las 4").
const NOMINA_PENDIENTE_EN_PLANO_DESDE = "2026-09-09"

export type EstadoLiquidacion = "pendiente" | "liquidada"

export interface ParametrosPrestaciones {
  pctPrima: number
  pctCesantias: number
  pctInteresesCesantias: number
  pctVacaciones: number
  incluyeAux: boolean
}

const PRESTACIONES_DEFAULT: ParametrosPrestaciones = {
  pctPrima: 8.33,
  pctCesantias: 8.33,
  pctInteresesCesantias: 12,
  pctVacaciones: 4.17,
  incluyeAux: true,
}

export interface LiquidacionNovedad {
  fecha: string
  actividad_registrada: string | null
  novedad_reportada: string | null
  base_dia: number
  hed: number
  hedf: number
  hen: number
  hef: number
  hn: number
  pago_domingo: number
  recargodominical: number
  total_liquidado_dia: number
}

export interface DeduccionLiquidacion {
  id: string
  concepto: string
  valor: number
  observacion: string | null
}

export interface LiquidacionPersona {
  persona: string
  identificacion: string
  idempresa: number | null
  fecha_retiro: string | null
  pagado_hasta: string | null
  motivo_retiro: string | null
  dias: number
  total: number // nómina pendiente (informativa si nominaPagadaPorPlano)
  // true = esta persona se retiró bajo la regla NUEVA (fecha_retiro >=
  // NOMINA_PENDIENTE_EN_PLANO_DESDE): su nómina pendiente ("total") se paga
  // por el archivo plano de la quincena, NO por esta liquidación -- se
  // muestra solo como referencia, sin sumar a total_liquidacion.
  nominaPagadaPorPlano: boolean
  // Gaps encontrados reconciliando contra Siigo (caso real Yair de Jesús Truyol
  // Caballero, 2026-09-08): Siigo prorratea el auxilio de transporte y descuenta
  // 4% salud + 4% pensión sobre CADA nómina, incluida la pendiente de un retiro;
  // LIPgo no calculaba ninguno de los dos. Ambos en $0 si nominaPagadaPorPlano
  // (esa nómina la paga el plano, que ya lo resuelve).
  auxilioTransportePendiente: number
  deduccionLeyPendiente: number // 4% salud + 4% pensión sobre `total` (el IBC, sin el auxilio)
  prima: number
  cesantias: number
  intereses: number
  vacaciones: number
  indemnizacion: number
  prestaciones: number // suma de las 4 prestaciones + indemnización
  deducciones: number // suma de los items registrados
  deduccion_items: DeduccionLiquidacion[]
  total_liquidacion: number // prestaciones − deducciones (+ nómina pendiente SOLO si nominaPagadaPorPlano es false)
  estado: EstadoLiquidacion
  soporte_url: string | null
  soporte_nombre: string | null
  novedades: LiquidacionNovedad[]
  // Valor REAL guardado (histórico), si existe -- para mostrar en pantalla
  // cuál de las prestaciones viene de la fórmula y cuál de un valor
  // confirmado manualmente.
  cesantias_real: number | null
  intereses_real: number | null
  prima_real: number | null
  vacaciones_real: number | null
  indemnizacion_real: number | null
}

// INDEMNIZACIÓN por despido SIN JUSTA CAUSA -- Ley 789/2002 art. 28 (modifica
// CST art. 64). Solo aplica cuando el motivo del retiro es "sin justa causa"
// (renuncia voluntaria, justa causa o terminación de período de prueba NO
// generan indemnización). Salario ≤10 SMLMV: 30 días si el vínculo es ≤1 año;
// 30 + 20 días por cada año adicional (proporcional) si es >1 año. Salario
// >10 SMLMV: 20 días / 20 + 15 por año adicional. Días de vínculo con
// convención /360 (igual que el resto del módulo, ej. intereses de cesantías).
function calcularIndemnizacion(
  motivoRetiro: string | null,
  salarioMensual: number,
  smlv: number,
  fechainicio: string | null,
  fechaRetiro: string,
): number {
  if (!/sin\s+justa\s+causa/i.test(String(motivoRetiro || ""))) return 0
  if (!fechainicio) return 0
  const diasVinculo = Math.max(0, Math.round((Date.parse(fechaRetiro) - Date.parse(fechainicio)) / 86_400_000))
  const anios = diasVinculo / 360
  const salarioDia = salarioMensual / 30
  const superaDiezSmlmv = smlv > 0 && salarioMensual > 10 * smlv
  const diasBase = superaDiezSmlmv ? 20 : 30
  const diasPorAnioAdicional = superaDiezSmlmv ? 15 : 20
  const diasIndemnizacion = anios <= 1 ? diasBase : diasBase + diasPorAnioAdicional * (anios - 1)
  return diasIndemnizacion * salarioDia
}

async function leerParametrosPrestaciones(admin: any): Promise<ParametrosPrestaciones> {
  const { data } = await admin.from("parametros_prestaciones").select("*").eq("id", 1).maybeSingle()
  if (!data) return PRESTACIONES_DEFAULT
  return {
    pctPrima: Number(data.pct_prima ?? PRESTACIONES_DEFAULT.pctPrima),
    pctCesantias: Number(data.pct_cesantias ?? PRESTACIONES_DEFAULT.pctCesantias),
    pctInteresesCesantias: Number(data.pct_intereses_cesantias ?? PRESTACIONES_DEFAULT.pctInteresesCesantias),
    pctVacaciones: Number(data.pct_vacaciones ?? PRESTACIONES_DEFAULT.pctVacaciones),
    incluyeAux: data.incluye_aux !== false,
  }
}

// "Pagado hasta" por defecto = corte de la última quincena YA pagada (el pago es
// quincenal: 1–15 y 16–fin). Así la nómina pendiente es solo la quincena en curso.
//   - retiro después del 15 → pagada la 1a quincena → pendiente 16..retiro.
//   - retiro el 15 o antes  → pagado hasta fin del mes anterior → pendiente 1..retiro.
function defaultPagadoHasta(fechaRetiro: string): string {
  const y = Number(fechaRetiro.slice(0, 4))
  const m = Number(fechaRetiro.slice(5, 7))
  const d = Number(fechaRetiro.slice(8, 10))
  if (d > 15) return `${fechaRetiro.slice(0, 7)}-15`
  const prev = new Date(Date.UTC(y, m - 1, 0)) // último día del mes anterior
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(prev.getUTCDate()).padStart(2, "0")
  return `${prev.getUTCFullYear()}-${mm}-${dd}`
}

// Suma el devengado REAL (total_liquidado_dia) y cuenta los días con registro
// dentro de [desde, hasta]. Se usan los datos reales de LIPgo; el único relleno
// (los 4 primeros días de enero que no existen en el sistema) se maneja aparte.
//
// "Sin Registro" SIN motivo (novedad_reportada vacía) y en $0: verificado con
// datos reales 2026-09-07 (Omar Villar, Jesús De La Hoz -- ambos cargo
// "Cargue/Descargue", pago por tonelada) que esto es un hueco de captura de
// actividad, NO una ausencia real -- a diferencia de "Sin Registro" con un
// motivo real (13-Incapacidad, 38-Licencia no remunerada), que sí debe seguir
// en $0. Se rellena con el salario básico del día (el piso garantizado,
// incluso para quien trabaja al destajo). Confirmado que NO aplica cuando ya
// hay un total_liquidado_dia real (turno con "Sin Registro" pagado completo,
// ej. Luis Ángel Arrieta, cargo "Distribución Turno" -- no se toca, ya paga
// bien).
//
// Bono de destajo (`bonif_prestacional`, novedad "52-Bonificación Por
// Productividad"): confirmado por el usuario (2026-09-07) que SÍ es base de
// prestaciones (cesantías/intereses/prima/vacaciones) -- coincide con el
// comentario canónico de lib/revision-nomina-actions.ts ("bono neto de
// destajo... TODO prestacional") -- pero solo para quien trabaja al DESTAJO
// (toneladas>0 y no "especialidad"/turno, mismo criterio `esDestajo` de ese
// archivo) y solo DESDE el 1-jul-2026 (antes de esa fecha el bono no era base
// de prestaciones). Se acumula por QUINCENA con piso $0 antes de sumarlo,
// igual que `excPendiente` más abajo para la nómina pendiente -- así un mes
// con días buenos y malos mezclados no resta plata ya "asegurada" por el piso
// diario.
const BONO_DESTAJO_PRESTACIONAL_DESDE = "2026-07-01"

// Ajustes históricos reales de Siigo (2026-09-08): el cálculo de LIPgo para el
// bono de destajo, aunque correcto en la fórmula, no siempre coincide peso a
// peso con lo que Siigo reportó en una quincena YA OCURRIDA (redondeos,
// ajustes manuales de RRHH, etc.). Reconciliado contra los Acumulados reales
// de Siigo -- ver tabla `ajustes_historicos_siigo` y memoria de sesión. Cuando
// existe un valor real para una quincena, REEMPLAZA el calculado (no se suma
// encima): Siigo es la fuente de verdad para lo que ya pasó.
function claveAjusteHistorico(identificacion: string, anio: number, mes: number, quincena: 1 | 2): string {
  return `${identificacion}|${anio}-${mes}-Q${quincena}`
}

function sumaPeriodo(
  rows: any[],
  desde: string,
  hasta: string,
  salarioDia: number,
  identificacion?: string,
  ajustesHistoricos?: Map<string, number>,
): { dev: number; dias: number; diasAux: number } {
  let dev = 0
  let dias = 0
  // Días que SÍ generan auxilio de transporte -- SOLO "Sueldo" (TRAB en la
  // clasificación de Parafiscales: vacío/Descanso/festivo/jornada normal).
  // Confirmado con datos reales de Siigo (2026-09-08): incapacidad, vacaciones
  // disfrutadas y licencia no remunerada NUNCA generan auxilio, aunque el día
  // sí se pague. Caso real: IVAN ANDRES CASTRO BELTRAN (7 Sueldo + 7 Incapacidad
  // + 1 Licencia no remunerada = 15 días de quincena) -- el auxilio de Siigo
  // fue EXACTO a 7 días (solo Sueldo). ALBERTO JUNIOR ACOSTA FERRER (4 Sueldo +
  // 11 Vacaciones disfrutadas) -- auxilio exacto a 4 días. Antes esta función
  // contaba TODOS los días del período por igual, inflando el auxilio prorrateado
  // de cualquiera con incapacidad/vacaciones/licencia en la ventana.
  let diasAux = 0
  const bonoPorQuincena = new Map<string, number>()
  for (const r of rows) {
    const f = String(r.fecha)
    if (f >= desde && f <= hasta) {
      const sinRegistroSinMotivo =
        String(r.actividad_registrada || "") === "Sin Registro" &&
        !String(r.novedad_reportada || "").trim() &&
        Number(r.total_liquidado_dia || 0) === 0
      dev += sinRegistroSinMotivo ? salarioDia : Number(r.total_liquidado_dia || 0)
      dias += 1
      if (clasificarDiaCotizacion(r.novedad_reportada) === "TRAB") diasAux += 1
      if (f >= BONO_DESTAJO_PRESTACIONAL_DESDE) {
        // Ya NO se excluye especialidad=true: la vista `pagonomina` (scripts/
        // 053_pagonomina_reemplazo.sql:659,872) ya deja `bonif_prestacional` en $0
        // para un día de especialidad=true SIN apoyo en cargue real (toneladas
        // sin asignación en apoyo_cargue_asignaciones) -- filtrar de nuevo por
        // `!especialidad` aquí duplicaba la exclusión y de paso le quitaba a la
        // persona el apoyo en cargue que Siigo SÍ le paga real (novedad 52).
        // Confirmado 2026-09-07 con el caso real de Luis Antonio De Leon García.
        const esDestajo = Number(r.toneladas || 0) > 0
        if (esDestajo) {
          const clave = f.slice(0, 7) + (Number(f.slice(8, 10)) <= 15 ? "-Q1" : "-Q2")
          bonoPorQuincena.set(clave, (bonoPorQuincena.get(clave) || 0) + Number(r.bonif_prestacional || 0))
        }
      }
    }
  }
  for (const [clave, calculado] of bonoPorQuincena) {
    let real = calculado
    if (identificacion && ajustesHistoricos) {
      const [anioQ, mesQ, qTxt] = clave.split("-")
      const key = claveAjusteHistorico(identificacion, Number(anioQ), Number(mesQ), qTxt === "Q1" ? 1 : 2)
      const override = ajustesHistoricos.get(key)
      if (override != null) real = override
    }
    dev += Math.max(0, real)
  }
  return { dev, dias, diasAux }
}

export async function getLiquidaciones(
  idempresa: number,
): Promise<{ success: boolean; data: LiquidacionPersona[]; params?: ParametrosPrestaciones; message?: string }> {
  if (!idempresa) return { success: false, data: [], message: "Selecciona una empresa." }
  try {
    const admin: any = await getSupabaseAdmin()

    // 1) Retirados (Inactivo) del cliente seleccionado.
    const { data: retirados, error: rErr } = await admin
      .from("headcount")
      .select("identificacion, nombre, fecha_retiro, idempresa, contratosiigo, salario, fechainicio, motivo_retiro")
      .eq("idempresa", idempresa)
      .ilike("estado", "inactivo")
    if (rErr) return { success: false, data: [], message: rErr.message }
    if (!retirados || retirados.length === 0) return { success: true, data: [] }

    const infoPorNombre = new Map<
      string,
      {
        identificacion: string
        fecha_retiro: string | null
        idempresa: number | null
        contratosiigo: string
        salario: number
        fechainicio: string | null
        motivo_retiro: string | null
      }
    >()
    for (const r of retirados) {
      const nombre = String(r.nombre || "").trim()
      if (!nombre) continue
      infoPorNombre.set(nombre, {
        identificacion: String(r.identificacion || "").trim(),
        fecha_retiro: r.fecha_retiro ?? null,
        idempresa: r.idempresa ?? null,
        contratosiigo: String(r.contratosiigo || "").trim(),
        salario: Number(r.salario) || 0,
        fechainicio: r.fechainicio ?? null,
        motivo_retiro: r.motivo_retiro ?? null,
      })
    }

    // 2) Solo con contrato = número de contrato SIIGO (fuente de verdad).
    for (const [nombre, info] of Array.from(infoPorNombre.entries())) {
      if (info.contratosiigo === "") infoPorNombre.delete(nombre)
    }
    const nombres = Array.from(infoPorNombre.keys())
    if (nombres.length === 0) return { success: true, data: [], params: await leerParametrosPrestaciones(admin) }

    // 3) Parámetros de prestaciones + auxilio de transporte por año.
    const pp = await leerParametrosPrestaciones(admin)
    const auxPorAnio = new Map<number, number>()
    const smlvPorAnio = new Map<number, number>()
    const { data: paramsAnio } = await admin.from("parametros_legales_anio").select("anio, auxilio_transporte, smlv")
    for (const a of paramsAnio || []) {
      auxPorAnio.set(Number(a.anio), Number(a.auxilio_transporte || 0))
      smlvPorAnio.set(Number(a.anio), Number(a.smlv || 0))
    }

    // 4) Estado/soporte/pagado_hasta guardado + valores REALES (histórico).
    // Si una persona ya liquidada tiene guardado el valor real de una
    // prestación (porque lo que pagó Siigo no coincide con la fórmula --
    // huecos de datos históricos, ajustes manuales de RRHH), ese valor real
    // GANA sobre el cálculo en vivo. Confirmado por el usuario 2026-09-07.
    const estadoPorCedula = new Map<
      string,
      {
        estado: EstadoLiquidacion
        soporte_url: string | null
        soporte_nombre: string | null
        pagado_hasta: string | null
        cesantias_real: number | null
        intereses_real: number | null
        prima_real: number | null
        vacaciones_real: number | null
        indemnizacion_real: number | null
      }
    >()
    const { data: estados } = await admin
      .from("liquidaciones_retiro")
      .select(
        "identificacion, estado, soporte_url, soporte_nombre, pagado_hasta, cesantias_real, intereses_real, prima_real, vacaciones_real, indemnizacion_real",
      )
      .eq("idempresa", idempresa)
    for (const e of estados || []) {
      estadoPorCedula.set(String(e.identificacion || "").trim(), {
        estado: e.estado === "liquidada" ? "liquidada" : "pendiente",
        soporte_url: e.soporte_url ?? null,
        soporte_nombre: e.soporte_nombre ?? null,
        pagado_hasta: e.pagado_hasta ?? null,
        cesantias_real: e.cesantias_real ?? null,
        intereses_real: e.intereses_real ?? null,
        prima_real: e.prima_real ?? null,
        vacaciones_real: e.vacaciones_real ?? null,
        indemnizacion_real: e.indemnizacion_real ?? null,
      })
    }

    // 4b) Deducciones registradas caso-por-caso (préstamos, anticipos, otros
    // descuentos autorizados) -- no calculables por fórmula.
    const cedulas = Array.from(infoPorNombre.values()).map((i) => i.identificacion)
    const deduccionesPorCedula = new Map<string, DeduccionLiquidacion[]>()
    if (cedulas.length > 0) {
      const { data: deducciones } = await admin
        .from("liquidaciones_retiro_deducciones")
        .select("id, identificacion, concepto, valor, observacion")
        .eq("idempresa", idempresa)
        .in("identificacion", cedulas)
      for (const d of deducciones || []) {
        const cedula = String(d.identificacion || "").trim()
        const arr = deduccionesPorCedula.get(cedula) || []
        arr.push({ id: d.id, concepto: d.concepto, valor: Number(d.valor) || 0, observacion: d.observacion ?? null })
        deduccionesPorCedula.set(cedula, arr)
      }
    }

    // 5) TODAS las novedades de pagonomina de esos retirados (para prestaciones y
    //    pendientes). Paginado.
    //    Se queda en la VISTA a propósito: necesita la historia completa de cada
    //    retirado (sin rango), así que `pagonomina_rango` no le ahorra nada.
    const cols =
      "fecha, persona, actividad_registrada, novedad_reportada, base_dia, hed, hedf, hen, hef, hn, pago_domingo, recargodominical, bonif_prestacional, total_liquidado_dia, especialidad, toneladas"
    let all: any[] = []
    const pageSize = 1000
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const { data, error } = await admin
        .from("pagonomina")
        .select(cols)
        .in("persona", nombres)
        .order("fecha", { ascending: false })
        .range(offset, offset + pageSize - 1)
      if (error) return { success: false, data: [], message: error.message }
      if (!data || data.length === 0) hasMore = false
      else {
        all = all.concat(data)
        if (data.length < pageSize) hasMore = false
        else offset += pageSize
      }
    }

    // Agrupar filas por persona (solo hasta su fecha de retiro).
    const rowsPorNombre = new Map<string, any[]>()
    for (const row of all) {
      const nombre = String(row.persona || "").trim()
      const info = infoPorNombre.get(nombre)
      if (!info) continue
      if (info.fecha_retiro && String(row.fecha) > info.fecha_retiro) continue
      const arr = rowsPorNombre.get(nombre) || []
      arr.push(row)
      rowsPorNombre.set(nombre, arr)
    }

    // 5.5) Ajustes históricos reales de Siigo (bono de destajo, ver `sumaPeriodo`
    // y memoria de sesión 2026-09-08) -- por cédula, para las personas de este
    // proyecto. Cuando existe, reemplaza el cálculo de LIPgo para esa quincena.
    const ajustesHistoricos = new Map<string, number>()
    if (cedulas.length > 0) {
      const { data: ajustes } = await admin
        .from("ajustes_historicos_siigo")
        .select("identificacion, anio, mes, quincena, valor_siigo_real")
        .in("identificacion", cedulas)
        .eq("concepto", "bono_destajo")
      for (const a of ajustes || []) {
        ajustesHistoricos.set(
          claveAjusteHistorico(String(a.identificacion).trim(), a.anio, a.mes, a.quincena as 1 | 2),
          Number(a.valor_siigo_real) || 0,
        )
      }
    }

    // 6) Construir cada persona: pendiente + prestaciones.
    const data: LiquidacionPersona[] = []
    for (const [nombre, info] of infoPorNombre) {
      const est = estadoPorCedula.get(info.identificacion)
      // "Pagado hasta": el guardado manualmente, o por defecto el corte de la
      // última quincena pagada (para que la nómina pendiente sea solo la quincena).
      const pagado_hasta =
        (est?.pagado_hasta ?? null) || (info.fecha_retiro ? defaultPagadoHasta(info.fecha_retiro) : null)
      const rows = rowsPorNombre.get(nombre) || []

      // Nómina PENDIENTE: fecha > pagado_hasta (y <= retiro, ya filtrado).
      const novedades: LiquidacionNovedad[] = []
      let total = 0
      // Bono de productividad de la quincena PENDIENTE (excedente de destajo neto,
      // piso 0 por quincena). Se suma al total además de las bases diarias.
      const excPendiente = new Map<string, number>()
      // Días de la nómina pendiente que SÍ generan auxilio de transporte -- ver
      // criterio completo en `sumaPeriodo` (solo "Sueldo"/TRAB, nunca incapacidad,
      // vacaciones o licencia no remunerada, confirmado con datos reales de Siigo).
      let diasAuxPendiente = 0
      for (const r of rows) {
        if (pagado_hasta && String(r.fecha) <= pagado_hasta) continue
        if (clasificarDiaCotizacion(r.novedad_reportada) === "TRAB") diasAuxPendiente += 1
        const nov: LiquidacionNovedad = {
          fecha: r.fecha,
          actividad_registrada: r.actividad_registrada ?? null,
          novedad_reportada: r.novedad_reportada ?? null,
          base_dia: Number(r.base_dia || 0),
          hed: Number(r.hed || 0),
          hedf: Number(r.hedf || 0),
          hen: Number(r.hen || 0),
          hef: Number(r.hef || 0),
          hn: Number(r.hn || 0),
          pago_domingo: Number(r.pago_domingo || 0),
          recargodominical: Number(r.recargodominical || 0),
          total_liquidado_dia: Number(r.total_liquidado_dia || 0),
        }
        novedades.push(nov)
        total += nov.total_liquidado_dia
        const f = String(r.fecha)
        const clave = f.slice(0, 7) + (Number(f.slice(8, 10)) <= 15 ? "-Q1" : "-Q2")
        excPendiente.set(clave, (excPendiente.get(clave) || 0) + Number(r.bonif_prestacional || 0))
      }
      for (const v of excPendiente.values()) total += Math.max(0, v)

      // PRESTACIONES sobre el devengado del período de causación.
      let prima = 0
      let cesantias = 0
      let intereses = 0
      let vacaciones = 0
      let indemnizacion = 0
      if (info.fecha_retiro) {
        const anio = Number(info.fecha_retiro.slice(0, 4))
        indemnizacion = calcularIndemnizacion(
          info.motivo_retiro,
          info.salario || smlvPorAnio.get(anio) || 0,
          smlvPorAnio.get(anio) || 0,
          info.fechainicio,
          info.fecha_retiro,
        )
        const cesDesde = `${anio}-01-01`
        // Si el vínculo empezó DENTRO del año del retiro, las ventanas de
        // causación arrancan en la fecha real de ingreso, no en enero-1 -- de
        // lo contrario `pagonomina` trae filas "Sin Registro" (piso $0) desde
        // enero para CUALQUIER persona del roster, sin importar cuándo entró,
        // e inflan/deflactan el conteo de días (auxilio prorrateado de más,
        // promedio diario de vacaciones de menos) aunque no aporten devengado.
        // Verificado con datos reales 2026-09-07 (Carlos Pacheco, Jesús Escalona:
        // pagonomina con filas desde enero pese a haber ingresado en junio).
        const cesDesdeReal =
          info.fechainicio && String(info.fechainicio) > cesDesde ? String(info.fechainicio) : cesDesde
        const auxMensual = auxPorAnio.get(anio) ?? 0
        const salarioMensual = info.salario || smlvPorAnio.get(anio) || 0
        const salarioDia = salarioMensual / 30
        const ce = sumaPeriodo(rows, cesDesdeReal, info.fecha_retiro, salarioDia, info.identificacion, ajustesHistoricos)

        // Relleno SOLO de los primeros días de enero que no existen en el sistema
        // (hasta 4), y únicamente si el trabajador venía del año anterior (tiene
        // registros antes del 1-ene). Cada día = 1 día de salario básico.
        let fillDias = 0
        // "Venía del año anterior": tiene registros antes del 1-ene, o su fecha de
        // inicio de contrato es anterior al año del retiro.
        const veniaAnioAnterior =
          rows.some((r: any) => String(r.fecha) < cesDesde) ||
          (!!info.fechainicio && String(info.fechainicio) < cesDesde)
        if (veniaAnioAnterior) {
          const primerDelAnio = rows
            .map((r: any) => String(r.fecha))
            .filter((fx: string) => fx >= cesDesde)
            .sort()[0]
          if (primerDelAnio) fillDias = Math.max(0, Math.min(Number(primerDelAnio.slice(8, 10)) - 1, 4))
        }
        const fillMonto = fillDias * salarioDia
        const diasCes = ce.dias + fillDias
        // El relleno de enero asume un día de trabajo normal (salario básico), así
        // que también cuenta para el auxilio -- igual criterio que `diasCes`.
        const diasAuxCes = ce.diasAux + fillDias

        const auxPropCes = (auxMensual / 30) * diasAuxCes
        // Base de cesantías = devengado (incluye el bono de destajo desde
        // julio-2026, ver sumaPeriodo) + relleno enero + auxilio.
        const baseCes = ce.dev + fillMonto + (pp.incluyeAux ? auxPropCes : 0)
        cesantias = baseCes * (pp.pctCesantias / 100)
        intereses = cesantias * (pp.pctInteresesCesantias / 100) * (diasCes / 360)

        // PRIMA — estrictamente proporcional por ley (CST art. 306, Ley 1788 de
        // 2016): 8.33% del devengado + auxilio de transporte del período de
        // causación del semestre en curso. 1er semestre: desde 1-ene (o la fecha
        // de ingreso si es posterior) hasta el retiro. 2do semestre: desde 1-jul
        // (o la fecha de ingreso si es posterior) hasta el retiro. Sin
        // excepciones por fecha de retiro -- confirmado por el usuario
        // 2026-09-07: "nosotros pagamos las primas de acuerdo a la ley... lo que
        // hacemos EN OCASIONES es proyectar del 15 al 30 para pagar a un
        // trabajador" -- es decir, cualquier adelanto/proyección es una práctica
        // operativa puntual (no todas las liquidaciones), y NO una regla legal
        // que la fórmula deba asumir para todo el mundo. Cuando esa práctica
        // puntual haga que el pago real de Siigo no coincida con este cálculo,
        // se registra el valor REAL en pantalla (prima_real) en vez de
        // convertirlo en una excepción de la fórmula.
        const primaEnSemestre2 = info.fecha_retiro >= `${anio}-07-01`
        const primaDesdeBase = primaEnSemestre2 ? `${anio}-07-01` : cesDesde
        const primaDesde =
          info.fechainicio && String(info.fechainicio) > primaDesdeBase ? String(info.fechainicio) : primaDesdeBase
        const pr = sumaPeriodo(rows, primaDesde, info.fecha_retiro, salarioDia, info.identificacion, ajustesHistoricos)
        prima = (pr.dev + (pp.incluyeAux ? (auxMensual / 30) * pr.diasAux : 0)) * (pp.pctPrima / 100)

        // Vacaciones: se ACUMULAN de forma continua durante TODO el vínculo (no se
        // reinician cada año). Días causados = pctVacaciones × días de vínculo (≈15/año,
        // desde la fecha de ingreso) MENOS los días ya disfrutados. Se paga lo
        // pendiente al salario básico/día. Ej: si ya disfrutó su año pero siguió
        // laborando, quedan las pocas causadas después.
        // `diasVinculo` para alguien que YA venía de antes del 1-ene usa la fecha
        // real de ingreso (así no se reinicia la acumulación cada año). Para quien
        // ingresó DENTRO del año del retiro, se reutiliza `diasCes` (ya calculado
        // arriba a partir de `cesDesdeReal`) en vez de restar fechas -- restar
        // fechas rompía con ingreso=retiro el mismo día (diferencia de fechas = 0,
        // pero sí hay 1 día causado). Verificado con datos reales 2026-09-07
        // (varias personas con ingreso y retiro el mismo día, ej. Felipe Pérez
        // Vega, Juan David Gámez Tatis).
        const diasVinculo = veniaAnioAnterior
          ? Math.max(
              0,
              Math.round((Date.parse(info.fecha_retiro) - Date.parse(String(info.fechainicio))) / 86_400_000),
            )
          : diasCes
        const vacCausadasDias = (pp.pctVacaciones / 100) * diasVinculo
        // Misma clasificación de novedades que Parafiscales (`clasificarDiaCotizacion`)
        // -- una sola fuente de verdad para qué es un día de vacaciones, en vez de
        // dos regex mantenidos por separado que podrían divergir con un futuro
        // código de novedad.
        const diasDisfrutados = rows.filter(
          (r: any) => clasificarDiaCotizacion(r.novedad_reportada) === "VAC",
        ).length
        // Los días pendientes se pagan al SALARIO DIARIO BÁSICO (salarioMensual/30),
        // no al promedio real devengado -- verificado con datos reales 2026-09-07
        // (Carlos Pacheco: usar el promedio real devengado daba $128.989 vs. real
        // $160.094; con salario básico da ~$163.062, a menos de un día de tenencia
        // de diferencia). Coincide con el criterio general de LIPgo para "básico
        // por día" (`salarioDia`, usado igual en la prima/cesantías de gente recién
        // ingresada) en vez de un promedio calculado sobre horas extra/destajo.
        vacaciones = Math.max(0, vacCausadasDias - diasDisfrutados) * salarioDia
      }

      // Valor REAL guardado (histórico) gana sobre el cálculo en vivo, campo
      // por campo -- ver comentario en el punto 4 más arriba.
      if (est?.cesantias_real != null) cesantias = est.cesantias_real
      if (est?.intereses_real != null) intereses = est.intereses_real
      if (est?.prima_real != null) prima = est.prima_real
      if (est?.vacaciones_real != null) vacaciones = est.vacaciones_real
      if (est?.indemnizacion_real != null) indemnizacion = est.indemnizacion_real

      const prestaciones = prima + cesantias + intereses + vacaciones + indemnizacion
      const deduccion_items = deduccionesPorCedula.get(info.identificacion) || []
      const deducciones = deduccion_items.reduce((s, d) => s + d.valor, 0)
      const nominaPagadaPorPlano = !!info.fecha_retiro && info.fecha_retiro >= NOMINA_PENDIENTE_EN_PLANO_DESDE

      // Auxilio de transporte prorrateado + deducciones de ley sobre la nómina
      // PENDIENTE (no sobre prestaciones -- esas no cotizan). Prorrateo por días
      // de nómina pendiente (`novedades.length`), mismo criterio que el resto del
      // módulo. Solo bajo la regla vieja: con la nueva, el plano ya los resuelve.
      const anioNominaPendiente = info.fecha_retiro ? Number(info.fecha_retiro.slice(0, 4)) : null
      const auxMensualPendiente = anioNominaPendiente ? auxPorAnio.get(anioNominaPendiente) ?? 0 : 0
      const auxilioTransportePendiente = nominaPagadaPorPlano ? 0 : (auxMensualPendiente / 30) * diasAuxPendiente
      const deduccionLeyPendiente = nominaPagadaPorPlano ? 0 : total * 0.08

      data.push({
        persona: nombre,
        identificacion: info.identificacion,
        idempresa: info.idempresa,
        fecha_retiro: info.fecha_retiro,
        pagado_hasta,
        motivo_retiro: info.motivo_retiro,
        dias: novedades.length,
        total,
        nominaPagadaPorPlano,
        auxilioTransportePendiente,
        deduccionLeyPendiente,
        prima,
        cesantias,
        intereses,
        vacaciones,
        indemnizacion,
        prestaciones,
        deducciones,
        deduccion_items,
        total_liquidacion:
          (nominaPagadaPorPlano ? 0 : total + auxilioTransportePendiente) +
          prestaciones -
          deducciones -
          deduccionLeyPendiente,
        estado: est?.estado ?? "pendiente",
        soporte_url: est?.soporte_url ?? null,
        soporte_nombre: est?.soporte_nombre ?? null,
        novedades,
        cesantias_real: est?.cesantias_real ?? null,
        intereses_real: est?.intereses_real ?? null,
        prima_real: est?.prima_real ?? null,
        vacaciones_real: est?.vacaciones_real ?? null,
        indemnizacion_real: est?.indemnizacion_real ?? null,
      })
    }

    data.sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === "pendiente" ? -1 : 1
      return String(b.fecha_retiro || "").localeCompare(String(a.fecha_retiro || ""))
    })
    return { success: true, data, params: pp }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al cargar las liquidaciones." }
  }
}

// ---- Parámetros de prestaciones (tabla de porcentajes de ley) ----
export async function getParametrosPrestaciones(): Promise<{ success: boolean; data: ParametrosPrestaciones }> {
  try {
    const admin: any = await getSupabaseAdmin()
    return { success: true, data: await leerParametrosPrestaciones(admin) }
  } catch {
    return { success: true, data: PRESTACIONES_DEFAULT }
  }
}

export async function guardarParametrosPrestaciones(
  p: ParametrosPrestaciones,
): Promise<{ success: boolean; message?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin.from("parametros_prestaciones").upsert(
      {
        id: 1,
        pct_prima: p.pctPrima,
        pct_cesantias: p.pctCesantias,
        pct_intereses_cesantias: p.pctInteresesCesantias,
        pct_vacaciones: p.pctVacaciones,
        incluye_aux: p.incluyeAux,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar parámetros." }
  }
}

// ---- Estado / soporte / pagado_hasta ----
async function upsertLiquidacion(admin: any, fields: Record<string, unknown>) {
  return admin
    .from("liquidaciones_retiro")
    .upsert({ ...fields, updated_at: new Date().toISOString() }, { onConflict: "idempresa,identificacion" })
}

export async function guardarEstadoLiquidacion(payload: {
  idempresa: number | null
  identificacion: string
  persona: string
  fecha_retiro: string | null
  total: number
  estado: EstadoLiquidacion
}): Promise<{ success: boolean; message?: string }> {
  if (!payload?.identificacion) return { success: false, message: "Datos incompletos." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await upsertLiquidacion(admin, {
      idempresa: payload.idempresa,
      identificacion: payload.identificacion,
      persona: payload.persona,
      fecha_retiro: payload.fecha_retiro,
      total_liquidado: payload.total,
      estado: payload.estado,
      fecha_liquidacion: payload.estado === "liquidada" ? new Date().toISOString() : null,
    })
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar el estado." }
  }
}

// Marcado masivo (ej. "marcar seleccionadas como pagadas" desde un filtro por
// rango de fecha de retiro) -- mismo upsert de guardarEstadoLiquidacion, en
// un solo viaje a la base para todo el lote.
export async function guardarEstadoLiquidacionMasivo(
  items: Array<{
    idempresa: number | null
    identificacion: string
    persona: string
    fecha_retiro: string | null
    total: number
  }>,
  estado: EstadoLiquidacion,
): Promise<{ success: boolean; message?: string; actualizadas: number }> {
  if (!items?.length) return { success: false, message: "No hay liquidaciones seleccionadas.", actualizadas: 0 }
  try {
    const admin: any = await getSupabaseAdmin()
    const filas = items.map((p) => ({
      idempresa: p.idempresa,
      identificacion: p.identificacion,
      persona: p.persona,
      fecha_retiro: p.fecha_retiro,
      total_liquidado: p.total,
      estado,
      fecha_liquidacion: estado === "liquidada" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await admin.from("liquidaciones_retiro").upsert(filas, { onConflict: "idempresa,identificacion" })
    if (error) return { success: false, message: error.message, actualizadas: 0 }
    return { success: true, actualizadas: filas.length }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar el estado en lote.", actualizadas: 0 }
  }
}

// Valores REALES (histórico) de una prestación, cuando lo pagado en Siigo no
// coincide con la fórmula. Pasar null en un campo lo deja SIN valor real (el
// cálculo en vivo vuelve a aplicar para ese campo).
export async function guardarValoresRealesLiquidacion(payload: {
  idempresa: number | null
  identificacion: string
  persona: string
  fecha_retiro: string | null
  cesantias_real: number | null
  intereses_real: number | null
  prima_real: number | null
  vacaciones_real: number | null
  indemnizacion_real: number | null
}): Promise<{ success: boolean; message?: string }> {
  if (!payload?.identificacion) return { success: false, message: "Datos incompletos." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await upsertLiquidacion(admin, {
      idempresa: payload.idempresa,
      identificacion: payload.identificacion,
      persona: payload.persona,
      fecha_retiro: payload.fecha_retiro,
      cesantias_real: payload.cesantias_real,
      intereses_real: payload.intereses_real,
      prima_real: payload.prima_real,
      vacaciones_real: payload.vacaciones_real,
      indemnizacion_real: payload.indemnizacion_real,
    })
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar los valores reales." }
  }
}

export async function guardarPagadoHasta(payload: {
  idempresa: number | null
  identificacion: string
  persona: string
  fecha_retiro: string | null
  pagado_hasta: string | null
}): Promise<{ success: boolean; message?: string }> {
  if (!payload?.identificacion) return { success: false, message: "Datos incompletos." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await upsertLiquidacion(admin, {
      idempresa: payload.idempresa,
      identificacion: payload.identificacion,
      persona: payload.persona,
      fecha_retiro: payload.fecha_retiro,
      pagado_hasta: payload.pagado_hasta || null,
    })
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar la fecha." }
  }
}

// Motivo de retiro (headcount.motivo_retiro) -- de él depende si aplica
// indemnización (solo "Sin Justa Causa", ver calcularIndemnizacion).
export async function guardarMotivoRetiro(payload: {
  identificacion: string
  motivo_retiro: string | null
}): Promise<{ success: boolean; message?: string }> {
  if (!payload?.identificacion) return { success: false, message: "Datos incompletos." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin
      .from("headcount")
      .update({ motivo_retiro: payload.motivo_retiro || null })
      .eq("identificacion", payload.identificacion)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar el motivo de retiro." }
  }
}

// ---- Deducciones (caso por caso: préstamos, anticipos, otros descuentos) ----
export async function agregarDeduccionLiquidacion(payload: {
  idempresa: number | null
  identificacion: string
  persona: string
  concepto: string
  valor: number
  observacion: string | null
}): Promise<{ success: boolean; message?: string }> {
  if (!payload?.identificacion || !payload?.concepto) return { success: false, message: "Datos incompletos." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin.from("liquidaciones_retiro_deducciones").insert({
      idempresa: payload.idempresa,
      identificacion: payload.identificacion,
      persona: payload.persona,
      concepto: payload.concepto,
      valor: payload.valor,
      observacion: payload.observacion || null,
    })
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar la deducción." }
  }
}

export async function eliminarDeduccionLiquidacion(id: string): Promise<{ success: boolean; message?: string }> {
  if (!id) return { success: false, message: "Falta el identificador." }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin.from("liquidaciones_retiro_deducciones").delete().eq("id", id)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al eliminar la deducción." }
  }
}

export async function subirSoporteLiquidacion(
  formData: FormData,
): Promise<{ success: boolean; url?: string; message?: string }> {
  try {
    const file = formData.get("file") as File | null
    const idempresaRaw = Number(formData.get("idempresa"))
    const idempresa = Number.isFinite(idempresaRaw) && idempresaRaw > 0 ? idempresaRaw : null
    const identificacion = String(formData.get("identificacion") || "").trim()
    const persona = String(formData.get("persona") || "")
    const fecha_retiro = (formData.get("fecha_retiro") as string) || null
    if (!file || !identificacion) return { success: false, message: "Faltan datos o archivo." }

    const admin: any = await getSupabaseAdmin()
    const ext = (file.name.split(".").pop() || "pdf").toLowerCase()
    const filePath = `liquidaciones/${identificacion}_${Date.now()}.${ext}`

    const { error: upErr } = await admin.storage.from("archivos").upload(filePath, file, { upsert: true })
    if (upErr) return { success: false, message: upErr.message }

    const { data: urlData } = admin.storage.from("archivos").getPublicUrl(filePath)
    const url = urlData?.publicUrl as string

    const { error: dbErr } = await upsertLiquidacion(admin, {
      idempresa,
      identificacion,
      persona,
      fecha_retiro,
      soporte_url: url,
      soporte_nombre: file.name,
    })
    if (dbErr) return { success: false, message: dbErr.message }

    return { success: true, url }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al subir el soporte." }
  }
}
