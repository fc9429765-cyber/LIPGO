"use server"

// Revisión de nómina (Gestión Humana › Nómina): arma, para un colaborador y una
// quincena, el CUADRO DEFINITIVO del nuevo modelo de liquidación:
//   A) Liquidación diaria — cada día trabajado paga su BASE; el turno suma recargos.
//   B) Resumen de quincena — base garantizada + ingreso por turno + bono neto de
//      destajo (excedente de toneladas neteado por quincena, todo prestacional).
//   C) Archivo plano → Siigo — las novedades tal como salen (bono + horas extra + días).
// Es un LECTOR de las vistas `pagonomina` y `archivoplano` (fuente de verdad). No
// escribe nada. Mismo patrón que parafiscales-actions / liquidaciones-actions.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { pesoBaseCalculo, excluirAvimolDistribucion, liquidable, normalizeName } from "@/lib/nomina-calculo-utils"
import { getHcYHorasRealPorDia } from "@/lib/meta-productividad-actions"
import { TON_MES_CARGUE_DESCARGUE, DIAS_OPERACION_MES, duracionHorasNetas, esPuestoCargueDescargue } from "@/lib/meta-productividad-utils"
import { motivoSinAccion } from "@/lib/puerta-modulo"

export interface ColaboradorRef {
  persona: string
  identificacion: string
  empresa: number | null
  estado: string
}

export interface DiaRevision {
  fecha: string
  dow: string
  tipo: string
  actividad: string
  novedad: string
  toneladas: number
  pagoProduccion: number
  base: number
  recargos: number
  domingo: number
  excedente: number // destajo con signo (prod - base); 0 si no es destajo
  /** Bono de apoyo en cargue (especialidad=true CON tonelaje real ese día,
   *  ver `bonif_prestacional` en pagonomina) -- SIEMPRE de signo positivo, se
   *  paga completo sin restar la base del turno. Ya sumaba al "Neto de la
   *  quincena" pero no se exponía por día -- por eso la pantalla mostraba el
   *  turno pagado normal y el tonelaje movido, pero NINGÚN valor en la fila
   *  del día para esa plata, aunque sí estuviera contada en el total.
   *  Confirmado con caso real 2026-09-14 (JUAN DEIVER ROSADO ARAGON,
   *  ARMANDO CESAR RODRIGUEZ MANJARREZ, ROBERTO ENRIQUE HOYOS VIDEZ, orden
   *  AVI202609088900). */
  bonoApoyoCargue: number
  total: number
  esDestajo: boolean
  anomalia: boolean // Cargue/Descargue con 0 toneladas (a corregir)
  meta: number // meta INDIVIDUAL de ese día = ton/hora real del proyecto × horas programadas de esta persona ese día (0 si no hay datos)
  cumpleMeta: boolean // solo destajo: toneladas >= meta
  hcDia: number // HC real (pagonomina): trabajadores que movieron toneladas ese día en el proyecto
  hcAsistenciaDia: number // HC real (registroasistencia): auxiliares de Cargue/Distribución con asistencia real ese día
  /** El 15 o el último día del mes (desde el piso 2026-08-15): su excedente NO
   * entra al neto de ESTA quincena — queda diferido a la siguiente vía Ajuste
   * Nómina Anterior. Mismo criterio que 059_archivoplano_reemplazo.sql
   * ("EXCLUIR EL DÍA DE CIERRE"). */
  diaCierre: boolean
}

export interface MetaResumen {
  configurada: boolean
  metaReferencia: number // promedio de la meta INDIVIDUAL diaria (ton/hora real del proyecto × horas de esta persona) en los días de destajo
  diasDestajo: number
  diasCumple: number
  diasBajo: number
  toneladasMovidas: number
  toneladasMeta: number // meta acumulada del período (Σ meta de los días de destajo)
  promedioDia: number
  pctCumplimiento: number // días que cumplió la meta / días de destajo
  hcConfigurado: number // HC real de asistencia promedio (registroasistencia, pool Cargue/Distribución) — ya NO es un valor "configurado"
  hcPromedioReal: number // head count real promedio (trabajadores que asistieron a destajo)
}

export interface ResumenRevision {
  baseGarantizada: number
  ingresoTurno: number
  recargoDominical: number
  netoDestajo: number
  bono: number
  perdida: number
  /** Bonos del módulo Bonos (43/50/66). No cotizan al IBC, pero sí se pagan. */
  bonosNoPrestacionales: number
  /** Excedente (con signo) del día de cierre de ESTA quincena (0 si no aplica
   * o si esta quincena todavía no llegó a su día de cierre). Ya NO está
   * dentro de `netoDestajo`/`bono`: se paga el día pleno ese día y este valor
   * queda diferido a la quincena SIGUIENTE vía Ajuste Nómina Anterior. */
  excedenteDiaCierre: number
  /** Ajuste Nómina Anterior APROBADO que APLICA a esta quincena (viene del
   * día de cierre de la quincena ANTERIOR). Ya está sumado dentro de `bono`/
   * `perdida` (antes del piso $0) — se muestra aparte para que sea visible
   * de dónde sale la diferencia contra el tonelaje puro de esta quincena. */
  ajusteNominaAnterior: number
  total: number
  diasDestajo: number
  diasAltos: number
  diasBajos: number
  anomalias: number
}

export interface PlanoRevision {
  nombrenovedad: string
  tiponovedad: string
  cantidadvalor: number
  nominaproyectada: number
  fechainicio: string | null
}

// --- Simulación del pago en SIIGO (cruce contra el Total quincena de LIPgo) ---
export interface ConceptoSiigo {
  concepto: string
  tipo: string // "Base" | "Valor" | "Horas" | "Dias"
  cantidad: number
  unidad: string // "días" | "h" | ""
  factor: string // cómo lo valora Siigo (×1,25 / paga 66,67% / valor directo…)
  valor: number // efecto NETO en el pago (los días descontados van en negativo)
}

export interface CruceComponente {
  nombre: string
  lipgo: number
  siigo: number
}

export interface SimulacionSiigo {
  disponible: boolean
  jornada: number
  hod: number // valor hora ordinaria = salario / (30 × jornada vigente)
  baseQuincenal: number // 15 días × salario/30 (convención 30 días de Siigo)
  conceptos: ConceptoSiigo[]
  totalSiigo: number
  totalLipgo: number
  diferencia: number // totalSiigo − totalLipgo
  cuadra: boolean
  componentes: CruceComponente[]
  explicaciones: string[]
}

export interface RevisionNominaData {
  colaborador: {
    persona: string
    identificacion: string
    salario: number
    baseDia: number
    empresa: number | null
    contratosiigo: string
  }
  quincena: { anio: number; mes: number; num: number; desde: string; hasta: string }
  dias: DiaRevision[]
  resumen: ResumenRevision
  metaResumen: MetaResumen
  plano: PlanoRevision[]
  siigo: SimulacionSiigo
}

const DOW = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"]
const num = (v: any) => Number(v || 0)
const fin = (anio: number, mes: number) => new Date(anio, mes, 0).getDate()

// El 15 y el último día del mes son el día de cierre de su quincena (desde el
// piso 2026-08-15): ese día se paga el "día pleno" (ver 053_pagonomina_reemplazo.sql)
// y su excedente de destajo NO entra al neto de ESTA quincena — queda diferido a
// la SIGUIENTE vía Ajuste Nómina Anterior. MISMO criterio, MISMA fecha de piso,
// que `agrupado_quincena.total_bono_nomina` en 059_archivoplano_reemplazo.sql — si se
// toca uno, tocar el otro.
const PISO_EXCLUSION_DIA_CIERRE = "2026-08-15"
function esDiaCierre(fechaISO: string): boolean {
  if (fechaISO < PISO_EXCLUSION_DIA_CIERRE) return false
  const d = new Date(fechaISO + "T12:00:00Z")
  const dia = d.getUTCDate()
  if (dia === 15) return true
  const ultimoDiaMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  return dia === ultimoDiaMes
}

// Supabase topa toda respuesta en 1000 filas aunque se pida más: para leer el
// proyecto completo (todas las personas × todos los días) hay que paginar con
// .range hasta agotar. `makeQuery(from,to)` arma la consulta con su .range.
async function fetchAllRows(makeQuery: (from: number, to: number) => any): Promise<any[]> {
  const PAGE = 1000
  let offset = 0
  const all: any[] = []
  for (;;) {
    const { data, error } = await makeQuery(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }
  return all
}

// `liquidable`: ¿esta persona entra a la Revisión de nómina? Misma regla del
// negocio que filtra el ARCHIVO PLANO (ver scripts/059_archivoplano_reemplazo.sql):
// RETIRADOS fuera (su nómina pendiente se paga por Liquidaciones) y SIN CONTRATO
// fuera (sin `contratosiigo` no hay vínculo al que cargarle la novedad en Siigo).
// Movida a `lib/nomina-calculo-utils.ts` (compartida con Control de Toneladas).

/** Parte una lista larga en lotes, para no reventar la URL de un `.in(...)`. */
function enLotes<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/**
 * Colaboradores para el selector (Head Count, activos primero).
 * `idempresa` = el SELECTOR GLOBAL: cada id es un centro de costo, así que al
 * filtrar por él salen solo los colaboradores amarrados a ese proyecto — que es
 * exactamente el universo con el que se cruza el plano contra Siigo.
 */
export async function getColaboradores(
  idempresa?: number | null,
): Promise<{ success: boolean; data: ColaboradorRef[]; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Revisión de nómina", "Gestión de Contratos", "Nominapersonal"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion, data: [] }
  try {
    const admin: any = await getSupabaseAdmin()
    let q = admin
      .from("headcount")
      .select("nombre, identificacion, idempresa, estado, contratosiigo, fecha_retiro")
      .order("estado", { ascending: true })
      .order("nombre", { ascending: true })
    if (idempresa != null) q = q.eq("idempresa", idempresa)
    const { data, error } = await q
    if (error) return { success: false, data: [], message: error.message }
    const vistos = new Set<string>()
    const out: ColaboradorRef[] = []
    for (const r of data || []) {
      const persona = String(r.nombre || "").trim()
      if (!persona || /prueba/i.test(persona)) continue
      if (!liquidable(r)) continue
      if (vistos.has(persona)) continue
      vistos.add(persona)
      out.push({
        persona,
        identificacion: String(r.identificacion || "").trim(),
        empresa: r.idempresa != null ? Number(r.idempresa) : null,
        estado: String(r.estado || "").trim() || "—",
      })
    }
    return { success: true, data: out }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al leer colaboradores." }
  }
}

/** Columnas de `pagonomina` que necesita el cuadro (una sola definición). */
const PN_COLS =
  "fecha, persona, idempresa, idempresaliquidacion, actividad_registrada, novedad_reportada, especialidad, toneladas, pago_produccion, base_dia, bonif_prestacional, bonif_no_prestacional, hed, hedf, hen, hef, hn, pago_domingo, recargodominical, total_liquidado_dia"

/**
 * Contexto del cálculo que NO depende del colaborador (metas del proyecto, HC
 * real por día, vigencia legal de la quincena). Se arma UNA vez y se reutiliza,
 * de modo que el consolidado por proyecto corra EXACTAMENTE la misma lógica que
 * la revisión individual — sin duplicarla ni dejarla derivar.
 */
interface CtxRevision {
  anio: number
  mes: number
  quincena: 1 | 2
  desde: string
  hasta: string
  /** ton/hora del proyecto ese día — "fecha|idempresa" (ver lib/meta-productividad-actions.ts). */
  metaPorHoraPorDia: Map<string, number>
  /** Horas programadas NETAS de esa persona ese día — "idempresa|fecha|nombreNormalizado". */
  horasPersonaPorDia: Map<string, number>
  /** Headcount real de asistencia (registroasistencia) del pool Cargue/Distribución — "fecha|idempresa". */
  hcAsistenciaPorDia: Map<string, number>
  hcReal: (fecha: string, emp: number) => number
  vig: any | null
  /** Ajuste Nómina Anterior APROBADO que aplica a ESTA quincena (positivo o
   * negativo) — "idempresa|identificacion". MISMA llave y MISMO criterio que
   * `ajustes_aplicables` en 059_archivoplano_reemplazo.sql: sin esto, el "Neto de
   * la quincena" de esta pantalla no incluye el ajuste que SÍ ya está fundido
   * en la novedad 52- que le llega a Siigo. */
  ajustesAplicables: Map<string, number>
}

/** Rango [desde, hasta] de la quincena, en ISO. */
function rangoQ(anio: number, mes: number, quincena: 1 | 2) {
  const diaIni = quincena === 1 ? 1 : 16
  const diaFin = quincena === 1 ? 15 : fin(anio, mes)
  const p = (n: number) => String(n).padStart(2, "0")
  return { desde: `${anio}-${p(mes)}-${p(diaIni)}`, hasta: `${anio}-${p(mes)}-${p(diaFin)}` }
}

async function armarContexto(
  admin: any,
  anio: number,
  mes: number,
  quincena: 1 | 2,
  desde: string,
  hasta: string,
  proyectos: Set<number>,
): Promise<CtxRevision> {
  // Meta DINÁMICA ton/trabajador/hora por (fecha, proyecto) — real, a partir
  // del headcount con asistencia real de ese día (ver
  // lib/meta-productividad-actions.ts — mismo módulo que ya usa Control de
  // Toneladas, para que ambos indicadores NUNCA diverjan entre sí).
  const proyectosArr = Array.from(proyectos)
  const hcHorasPorDia = await getHcYHorasRealPorDia(proyectosArr, desde, hasta)
  const metaPorHoraPorDia = new Map<string, number>()
  const hcAsistenciaPorDia = new Map<string, number>()
  for (const [key, { headcount, horasTotales }] of hcHorasPorDia) {
    const emp = Number(key.split("|")[1])
    const metaTonDia = (TON_MES_CARGUE_DESCARGUE[emp] || 0) / DIAS_OPERACION_MES
    metaPorHoraPorDia.set(key, horasTotales > 0 ? metaTonDia / horasTotales : 0)
    hcAsistenciaPorDia.set(key, headcount)
  }

  // Horas programadas NETAS de CADA persona ese día — para que la meta
  // individual sea proporcional a SUS horas, no un número plano igual para
  // todos (alguien con turno de 6h no se compara contra quien tiene 11h).
  const horasPersonaPorDia = new Map<string, number>()
  if (proyectosArr.length > 0) {
    const asistRows = await fetchAllRows((f, t) =>
      admin
        .from("registroasistencia")
        .select("nombre, idempresa, fecha, puesto, horaentradaprogramada, horasalidaprogramada")
        .in("idempresa", proyectosArr)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(f, t),
    )
    for (const r of asistRows) {
      if (!esPuestoCargueDescargue(Number(r.idempresa), r.puesto)) continue
      if (!r.horaentradaprogramada || !r.horasalidaprogramada) continue
      const key = `${Number(r.idempresa)}|${String(r.fecha).slice(0, 10)}|${normalizeName(r.nombre)}`
      if (!horasPersonaPorDia.has(key)) {
        horasPersonaPorDia.set(key, duracionHorasNetas(String(r.horaentradaprogramada), String(r.horasalidaprogramada)))
      }
    }
  }

  // HC REAL por día: trabajadores que movieron toneladas ese día en el proyecto
  // (asistencia ya ratificada en pagonomina). El HC varía a diario según el volumen.
  // PAGINADO: un proyecto entero en 15 días supera fácil el tope de 1000 filas de
  // Supabase, y sin paginar el HC real saldría corto en silencio.
  const hcPorFechaEmp = new Map<string, Set<string>>()
  if (proyectos.size > 0) {
    const hcRows = await fetchAllRows((f, t) =>
      admin
        .rpc("pagonomina_rango", { p_desde: desde, p_hasta: hasta })
        .select("fecha, persona, idempresaliquidacion, especialidad")
        .in("idempresaliquidacion", Array.from(proyectos))
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .gt("toneladas", 0)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("fecha", { ascending: true })
        .order("persona")
        .range(f, t),
    )
    for (const r of hcRows) {
      if (r.especialidad === true || String(r.especialidad) === "true") continue
      const key = String(r.fecha).slice(0, 10) + "|" + Number(r.idempresaliquidacion)
      if (!hcPorFechaEmp.has(key)) hcPorFechaEmp.set(key, new Set())
      hcPorFechaEmp.get(key)!.add(String(r.persona || "").trim())
    }
  }

  // Vigencia legal aplicable a la quincena (los cortes legales rigen el 16-jul,
  // que coincide con el inicio de la 2ª quincena → una sola vigencia por quincena).
  const { data: vig } = await admin
    .from("parametros_legales_vigencia")
    .select("*")
    .lte("fecha_desde", desde)
    .order("fecha_desde", { ascending: false })
    .limit(1)
    .maybeSingle()

  // Ajuste Nómina Anterior APROBADO que aplica a ESTA quincena. MISMO join
  // (idempresa + identificacion TRIM) y MISMA suma que `ajustes_aplicables`
  // en 059_archivoplano_reemplazo.sql — para que esta pantalla reconcilie exacto
  // contra lo que de verdad viaja a Siigo.
  const { data: ajustesRows } = await admin
    .from("ajustes_proyeccion")
    .select("idempresa, identificacion, valor_ajuste")
    .eq("estado", "aprobado")
    .eq("anio_aplica", anio)
    .eq("mes_aplica", mes)
    .eq("quincena_aplica", quincena)
  const ajustesAplicables = new Map<string, number>()
  for (const a of ajustesRows || []) {
    const ident = String(a.identificacion || "").trim()
    if (!ident) continue
    const key = `${Number(a.idempresa)}|${ident}`
    ajustesAplicables.set(key, (ajustesAplicables.get(key) || 0) + num(a.valor_ajuste))
  }

  return {
    anio,
    mes,
    quincena,
    desde,
    hasta,
    metaPorHoraPorDia,
    horasPersonaPorDia,
    hcAsistenciaPorDia,
    hcReal: (fecha: string, emp: number) => hcPorFechaEmp.get(fecha + "|" + emp)?.size || 0,
    vig: vig || null,
    ajustesAplicables,
  }
}

/**
 * Cuadro completo (A/B/C/D) de UNA persona, a partir de datos ya leídos.
 * Función pura: la usan tanto la vista individual como el consolidado por
 * proyecto, así que el cruce con Siigo es idéntico en ambos casos.
 */
function armarPersona(
  persona: string,
  hc: any | null,
  filas: any[],
  planoRows: any[],
  ctx: CtxRevision,
): RevisionNominaData {
  const { anio, mes, quincena, desde, hasta, metaPorHoraPorDia, horasPersonaPorDia, hcAsistenciaPorDia, hcReal, ajustesAplicables } =
    ctx
  const identificacion = String(hc?.identificacion || "").trim()
  const salario = num(hc?.salario)
  const baseDia = salario > 0 ? salario / 30 : 58364

  // Bloque A/B/C/D — se conserva tal cual estaba en la versión de una sola
  // persona (misma lógica ya validada contra Siigo); lo único que cambió es de
  // dónde llegan los datos: antes los leía aquí, ahora se los pasa el llamador.
  {
    const dias: DiaRevision[] = []
    let baseGar = 0,
      ingTurno = 0,
      recDom = 0,
      neto = 0,
      excedenteDiaCierre = 0,
      diasDestajo = 0,
      diasAltos = 0,
      diasBajos = 0,
      anomalias = 0,
      diasCumpleMeta = 0,
      toneladasMovidas = 0,
      toneladasMeta = 0,
      // Dominical partido para el cruce Siigo: el domingo TRABAJADO va como novedad
      // (08/25) en el plano; el descanso dominical va DENTRO de la base quincenal.
      domTrabajado = 0,
      domDescanso = 0,
      // Bonos NO prestacionales (módulo Compensación › Bonos). NO vienen dentro
      // de total_liquidado_dia (no cotizan al IBC), pero SÍ se le pagan al
      // trabajador vía el archivo plano, así que suman al Total quincena.
      bonosNoPrest = 0,
      empresa: number | null = hc?.idempresa != null ? Number(hc.idempresa) : null

    for (const r of filas || []) {
      const d = new Date(String(r.fecha).slice(0, 10) + "T12:00:00Z")
      const ton = num(r.toneladas)
      const prod = num(r.pago_produccion)
      const base = num(r.base_dia)
      const esp = r.especialidad === true || String(r.especialidad) === "true"
      const nov = String(r.novedad_reportada || "").trim()
      const act = String(r.actividad_registrada || "").trim()
      const recargos = num(r.hed) + num(r.hedf) + num(r.hen) + num(r.hef) + num(r.hn)
      const domingo = num(r.pago_domingo) + num(r.recargodominical)
      const total = num(r.total_liquidado_dia)
      const esDestajo = ton > 0 && !esp
      const esFestivo = /festivo/i.test(act)
      const anomalia = /cargue|descargue/i.test(act) && ton === 0 && !esp && base > 0 && nov === "" && !esFestivo
      const excedente = esDestajo ? prod - base : 0

      let tipo: string
      if (esDestajo) tipo = "Destajo"
      else if (esp) tipo = "Turno"
      else if (esFestivo) tipo = "Festivo"
      else if (nov) tipo = "Novedad"
      else if (total > 0) tipo = "Descanso"
      else tipo = "Sin registro"

      // Proyecto del día (idempresaliquidacion = donde se movió el tonelaje).
      const empDia =
        r.idempresaliquidacion != null ? Number(r.idempresaliquidacion) : r.idempresa != null ? Number(r.idempresa) : 0
      const fechaStr = String(r.fecha).slice(0, 10)
      const diaCierre = esDiaCierre(fechaStr)
      // Meta INDIVIDUAL de ese día = ton/hora real del proyecto ese día × las
      // horas programadas de ESTA persona ese día (0 si no hay programación,
      // no un número plano igual para todos — ver lib/meta-productividad-actions.ts).
      const metaPorHoraDia = empDia ? metaPorHoraPorDia.get(`${fechaStr}|${empDia}`) || 0 : 0
      const horasPersonaEseDia = empDia ? horasPersonaPorDia.get(`${empDia}|${fechaStr}|${normalizeName(persona)}`) || 0 : 0
      const metaDia = metaPorHoraDia * horasPersonaEseDia
      const cumpleMeta = esDestajo && metaDia > 0 ? ton >= metaDia : false
      const hcDia = esDestajo ? hcReal(fechaStr, empDia) : 0
      const hcAsistenciaDia = esDestajo && empDia ? hcAsistenciaPorDia.get(`${fechaStr}|${empDia}`) || 0 : 0

      // Descomposición del total del día: base = total − recargos − dominical
      const basePortion = Math.max(0, total - recargos - domingo)
      if (total > 0) baseGar += basePortion
      ingTurno += recargos
      recDom += domingo
      if (domingo > 0) {
        if (esDestajo || esp) domTrabajado += domingo
        else domDescanso += domingo
      }
      // Apoyo en cargue (especialidad=true CON tonelaje real ese día): la vista
      // `pagonomina` (scripts/053_pagonomina_reemplazo.sql:659,872) ya deja
      // `bonif_prestacional` en $0 salvo que haya un apoyo real registrado en
      // `apoyo_cargue_asignaciones` -- ese dinero SÍ viaja al archivo plano
      // (novedad 52) aunque la persona sea de turno fijo. No se suma a
      // `esDestajo`/`tipo`/HC (esas clasificaciones siguen viendo a la persona
      // como "Turno", que es correcto operativamente) pero SÍ debe sumar al
      // "Neto de la quincena" que ve RRHH, o esta pantalla mostraría menos de
      // lo que realmente se paga. Confirmado 2026-09-07 con el caso real de
      // Luis Antonio De Leon García (apoyo en cargue, agosto-2026).
      const bonoApoyoCargue = esp ? Number(r.bonif_prestacional || 0) : 0
      if (esDestajo || bonoApoyoCargue !== 0) {
        // EXCLUIR EL DÍA DE CIERRE del neto de ESTA quincena — igual que
        // 059_archivoplano_reemplazo.sql: ese día ya se pagó a día pleno, y su
        // excedente queda diferido a la quincena SIGUIENTE (Ajuste Nómina
        // Anterior). Sin esto, el "Neto de la quincena" de esta pantalla no
        // cuadraba con lo que de verdad viaja al archivo plano.
        const excedenteTotal = excedente + bonoApoyoCargue
        if (diaCierre) excedenteDiaCierre += excedenteTotal
        else neto += excedenteTotal
        if (esDestajo) diasDestajo += 1
        if (excedenteTotal >= 0) diasAltos += 1
        else diasBajos += 1
        toneladasMovidas += ton
        if (metaDia > 0) {
          toneladasMeta += metaDia
          if (cumpleMeta) diasCumpleMeta += 1
        }
      }
      if (anomalia) anomalias += 1
      bonosNoPrest += num(r.bonif_no_prestacional)
      if (empresa == null && r.idempresa != null) empresa = Number(r.idempresa)

      dias.push({
        fecha: String(r.fecha).slice(0, 10),
        dow: DOW[d.getUTCDay()],
        tipo,
        actividad: act,
        novedad: nov,
        toneladas: ton,
        pagoProduccion: prod,
        base: basePortion,
        recargos,
        domingo,
        excedente,
        bonoApoyoCargue,
        total,
        esDestajo,
        anomalia,
        meta: metaDia,
        cumpleMeta,
        hcDia,
        hcAsistenciaDia,
        diaCierre,
      })
    }

    // Resumen de cumplimiento de META (productividad). La meta ya no es un
    // número plano por proyecto: varía cada día según el personal real y sus
    // horas — la "meta de referencia" que se muestra es el PROMEDIO de la
    // meta individual de los días con destajo (mismo criterio que
    // promedioDia, que también promedia lo real).
    const diasConMetaArr = dias.filter((x) => x.esDestajo && x.meta > 0)
    const diasConMeta = diasConMetaArr.length
    const metaReferencia = diasConMeta > 0 ? diasConMetaArr.reduce((a, x) => a + x.meta, 0) / diasConMeta : 0
    const diasDestajoArr = dias.filter((x) => x.esDestajo && x.hcDia > 0)
    const hcPromedioReal =
      diasDestajoArr.length > 0 ? diasDestajoArr.reduce((a, x) => a + x.hcDia, 0) / diasDestajoArr.length : 0
    const diasAsistArr = dias.filter((x) => x.esDestajo && x.hcAsistenciaDia > 0)
    const hcAsistenciaPromedio =
      diasAsistArr.length > 0 ? diasAsistArr.reduce((a, x) => a + x.hcAsistenciaDia, 0) / diasAsistArr.length : 0
    const metaResumen: MetaResumen = {
      configurada: metaReferencia > 0 || diasConMeta > 0,
      metaReferencia,
      diasDestajo,
      diasCumple: diasCumpleMeta,
      diasBajo: Math.max(0, diasConMeta - diasCumpleMeta),
      toneladasMovidas,
      toneladasMeta,
      promedioDia: diasDestajo > 0 ? toneladasMovidas / diasDestajo : 0,
      pctCumplimiento: diasConMeta > 0 ? (diasCumpleMeta / diasConMeta) * 100 : 0,
      hcConfigurado: Math.round(hcAsistenciaPromedio * 10) / 10,
      hcPromedioReal,
    }

    // Ajuste Nómina Anterior aprobado que APLICA a esta quincena (viene del
    // día de cierre de la quincena ANTERIOR) — se suma ANTES del piso $0,
    // exactamente como `agrupado_quincena.total_bono_nomina` en
    // 059_archivoplano_reemplazo.sql. Sin esto, "Neto de la quincena" no incluye
    // lo que YA está fundido en la novedad 52- que le llega a Siigo.
    const ajusteNominaAnterior = empresa != null ? ajustesAplicables.get(`${empresa}|${identificacion}`) || 0 : 0
    const netoConAjuste = neto + ajusteNominaAnterior
    const bono = Math.max(0, netoConAjuste)
    const perdida = Math.max(0, -netoConAjuste)
    const resumen: ResumenRevision = {
      baseGarantizada: baseGar,
      ingresoTurno: ingTurno,
      recargoDominical: recDom,
      netoDestajo: neto,
      bono,
      perdida,
      bonosNoPrestacionales: bonosNoPrest,
      excedenteDiaCierre,
      ajusteNominaAnterior,
      total: baseGar + ingTurno + recDom + bono + bonosNoPrest,
      diasDestajo,
      diasAltos,
      diasBajos,
      anomalias,
    }

    // C) Archivo plano (novedades a Siigo) para ese id + mes + quincena.
    // Las filas ya vienen leídas y filtradas por el llamador (`planoRows`).
    const plano: PlanoRevision[] = (planoRows || []).map((p: any) => ({
      nombrenovedad: String(p.nombrenovedad || ""),
      tiponovedad: String(p.tiponovedad || ""),
      cantidadvalor: num(p.cantidadvalor),
      nominaproyectada: num(p.nominaproyectada),
      fechainicio: p.fechainicio || null,
    }))

    // D) SIMULACIÓN SIIGO — replica el proceso de liquidación de Siigo al ingerir el
    // archivo plano, para CRUZARLO contra el Total quincena de LIPgo:
    //   1. Base quincenal automática = salario/2 (15 días × salario/30, convención 30
    //      días; Siigo la paga sola desde el contrato — el plano NO la envía).
    //   2. Novedades tipo "Valor" (52-Bono de productividad) → suman directo.
    //   3. Novedades tipo "Horas" → horas × HOD × factor del concepto, con HOD =
    //      salario/(30×jornada) y los % de la vigencia legal de la quincena (los
    //      mismos con los que LIPgo calculó las horas: hed 25, hedf, hen 75, hef,
    //      hn 35, dominical). 08 = hora extra recargo dominical o festivo,
    //      misma familia que 07/10/11/12 (×(1+pct)); 25 = solo el recargo
    //      dominical (×pct), sin la hora base.
    //   4. Novedades tipo "Dias" → Siigo descuenta el día de la base y paga el
    //      concepto a su %: 13-Incap 100% (neto 0), 15-Incap 66,67% (neto −33,33%),
    //      14-Incap 50% (neto −50%), 38-Lic. no remunerada (neto −100%),
    //      31-Vacaciones y licencias remuneradas (neto 0).
    let siigo: SimulacionSiigo = {
      disponible: false,
      jornada: 0,
      hod: 0,
      baseQuincenal: 0,
      conceptos: [],
      totalSiigo: 0,
      totalLipgo: Math.round(resumen.total),
      diferencia: 0,
      cuadra: false,
      componentes: [],
      explicaciones: [],
    }
    // Solo se simula a quien la nómina EFECTIVAMENTE liquida en la quincena.
    // Sin `dias.length > 0` se le asignaba una base quincenal fantasma de 15
    // días a cualquiera con salario en Head Count — incluidos los RETIRADOS,
    // que `pagonomina` y `archivoplano` ya excluyen y cuya liquidación va por el
    // módulo Liquidaciones, no por el plano. Eso inventaba un descuadre del
    // tamaño de medio salario por cada retirado (en Indupan eran $4,4 millones
    // de diferencia falsa).
    if (salario > 0 && dias.length > 0) {
      // Vigencia legal aplicable a la quincena (ya resuelta en el contexto: los
      // cortes legales rigen el 16-jul, que coincide con el inicio de la 2ª
      // quincena → una sola vigencia por quincena).
      const vig = ctx.vig
      const jornada = vig?.jornada_horas != null ? Number(vig.jornada_horas) : 7
      const pct = {
        hed: vig?.pct_hed != null ? Number(vig.pct_hed) : 25,
        hen: vig?.pct_hen != null ? Number(vig.pct_hen) : 75,
        hn: vig?.pct_hn != null ? Number(vig.pct_hn) : 35,
        dom: vig?.pct_recargo_dominical != null ? Number(vig.pct_recargo_dominical) : 90,
        hedf: vig?.pct_hedf != null ? Number(vig.pct_hedf) : 115,
        hef: vig?.pct_hef != null ? Number(vig.pct_hef) : 165,
      }
      const hod = salario / (30 * jornada)
      const baseDiaSim = salario / 30
      // Base quincenal de Siigo = 15 días (convención de mes de 30)... PERO
      // PRORRATEADA si la persona ingresó DENTRO de la quincena: Siigo paga
      // desde la fecha de contratación, no el periodo completo. Sin esto, a un
      // ingreso de mitad de quincena se le atribuían los 15 días y salía un
      // descuadre del tamaño de los días que aún no era empleado (caso real:
      // ANDRÉS FELIPE ESCORCIA y OTONIEL MURILLO, ingreso 27-jul, ~$642.000
      // cada uno). Mismo criterio con el que `pagonomina` corta por
      // headcount.fechainicio.
      const ingreso = hc?.fechainicio ? String(hc.fechainicio).slice(0, 10) : ""
      let diasBase = 15
      if (ingreso && ingreso > desde) {
        const tope = ingreso > hasta ? hasta : ingreso
        const diasFuera = Math.round((Date.parse(tope) - Date.parse(desde)) / 86400000)
        diasBase = Math.max(0, 15 - diasFuera)
      }
      const baseQuincenal = Math.round(diasBase * baseDiaSim)
      const fmtX = (m: number) =>
        "×" + m.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

      // Agrupar las novedades del plano por concepto (los días vienen 1 fila/día).
      const agg = new Map<string, { tipo: string; cant: number }>()
      for (const p of plano) {
        const g = agg.get(p.nombrenovedad) || { tipo: p.tiponovedad, cant: 0 }
        g.cant += p.cantidadvalor
        agg.set(p.nombrenovedad, g)
      }

      const conceptos: ConceptoSiigo[] = [
        {
          concepto:
            diasBase < 15
              ? `Salario básico de la quincena (contrato, prorrateado desde el ingreso ${ingreso})`
              : "Salario básico de la quincena (contrato)",
          tipo: "Base",
          cantidad: diasBase,
          unidad: "días",
          factor: "salario/30",
          valor: baseQuincenal,
        },
      ]
      for (const [nom, g] of agg) {
        // Novedades de VALOR directo: el bono de productividad y los bonos del
        // módulo Compensación › Bonos (43 ocasionales / 50 no prestacional /
        // 66 aux. movilidad). Sin listarlos aquí caerían fuera de todas las
        // ramas y se ignorarían en silencio, descuadrando el cruce.
        //
        // El bono de productividad se acepta con SUS DOS códigos: 52 desde la
        // quincena del 16-jul-2026 y 71 antes (ver 059_archivoplano_reemplazo.sql).
        // Reconocer solo el nuevo dejaría sin bono el cruce de toda quincena
        // anterior, que es justo donde uno va a revisar el histórico.
        if (
          nom.startsWith("52") ||
          nom.startsWith("71") ||
          nom.startsWith("43") ||
          nom.startsWith("50") ||
          nom.startsWith("66")
        ) {
          conceptos.push({
            concepto: nom,
            tipo: "Valor",
            cantidad: 1,
            unidad: "",
            factor: "valor directo",
            valor: Math.round(g.cant),
          })
        } else if (g.tipo === "Horas") {
          let mult = 1
          if (nom.startsWith("10")) mult = 1 + pct.hed / 100
          else if (nom.startsWith("07")) mult = 1 + pct.hedf / 100
          else if (nom.startsWith("11")) mult = 1 + pct.hen / 100
          else if (nom.startsWith("12")) mult = 1 + pct.hef / 100
          else if (nom.startsWith("26")) mult = pct.hn / 100
          else if (nom.startsWith("08")) mult = 1 + pct.dom / 100 // hora extra recargo dominical/festivo, misma familia que 07/10/11/12
          else if (nom.startsWith("25")) mult = pct.dom / 100 // solo el recargo
          conceptos.push({
            concepto: nom,
            tipo: "Horas",
            cantidad: g.cant,
            unidad: "h",
            factor: fmtX(mult),
            valor: Math.round(g.cant * hod * mult),
          })
        } else if (g.tipo === "Dias") {
          // Efecto NETO en el pago: Siigo descuenta el día y paga el concepto a su %.
          // INCAPACIDAD SIEMPRE AL 100% (2026-09-08, confirmado por el usuario + verificado
          // con datos reales de Siigo, caso IVAN ANDRES CASTRO BELTRAN): el "66%"/"50%" del
          // nombre de la novedad es solo la clasificación legal, no el neto real -- mismo
          // criterio que 053_pagonomina_reemplazo.sql. Solo la licencia no remunerada (38) sí
          // descuenta el día de verdad.
          let netoDia = 0
          let nota = "pagada 100% (sin efecto neto)"
          if (nom.startsWith("38")) {
            netoDia = -baseDiaSim
            nota = nom.includes("Suspensión") ? "suspensión temporal de contrato (descuenta el día)" : "no remunerada (descuenta el día)"
          }
          conceptos.push({
            concepto: nom,
            tipo: "Dias",
            cantidad: g.cant,
            unidad: "día(s)",
            factor: nota,
            valor: Math.round(netoDia * g.cant),
          })
        }
      }
      const totalSiigo = conceptos.reduce((a, c) => a + c.valor, 0)
      const sumC = (f: (c: ConceptoSiigo) => boolean) => conceptos.filter(f).reduce((a, c) => a + c.valor, 0)

      // Cruce por componente: en LIPgo el descanso dominical se suma a la base (en
      // Siigo vive dentro de los 15 días); el dominical TRABAJADO cruza contra 08/25.
      const componentes: CruceComponente[] = [
        {
          nombre: "Base (días de salario)",
          lipgo: Math.round(baseGar + domDescanso),
          siigo: baseQuincenal + sumC((c) => c.tipo === "Dias"),
        },
        {
          nombre: "Horas extra / recargos",
          lipgo: Math.round(ingTurno),
          siigo: sumC((c) => c.tipo === "Horas" && !c.concepto.startsWith("08") && !c.concepto.startsWith("25")),
        },
        {
          nombre: "Dominical trabajado (08/25)",
          lipgo: Math.round(domTrabajado),
          siigo: sumC((c) => c.concepto.startsWith("08") || c.concepto.startsWith("25")),
        },
        {
          // 52 desde la quincena del 16-jul-2026; 71 en las anteriores.
          nombre: "Bono productividad (52)",
          lipgo: Math.round(bono),
          siigo: sumC((c) => c.concepto.startsWith("52") || c.concepto.startsWith("71")),
        },
        {
          // Bonos del módulo Compensación › Bonos. No cotizan al IBC, pero se
          // pagan por el plano: cruzan contra bonif_no_prestacional de pagonomina.
          nombre: "Bonos no prestacionales (43/50/66)",
          lipgo: Math.round(bonosNoPrest),
          siigo: sumC(
            (c) => c.concepto.startsWith("43") || c.concepto.startsWith("50") || c.concepto.startsWith("66"),
          ),
        },
      ]

      const totalLipgo = Math.round(resumen.total)
      const diferencia = totalSiigo - totalLipgo
      const cuadra = Math.abs(diferencia) <= 2000 // tolerancia de redondeo (horas a 2 decimales)

      // Explicaciones de la diferencia (las causas estructurales conocidas).
      const explicaciones: string[] = []
      const diasRango = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1
      const hoyISO = new Date().toISOString().slice(0, 10)
      if (hoyISO < hasta)
        explicaciones.push(
          `Quincena EN CURSO: LIPgo lleva ${dias.length} de ${diasRango} días con datos; Siigo liquida la quincena completa (15 días de base). La diferencia se cierra al terminar la quincena.`,
        )
      if (diasRango !== 15)
        explicaciones.push(
          `La quincena tiene ${diasRango} días de calendario y Siigo paga 15 (convención 30 días): diferencia estructural de ${Math.abs(diasRango - 15)} día(s) de base ≈ $${Math.round(Math.abs(diasRango - 15) * baseDiaSim).toLocaleString("es-CO")} ${diasRango > 15 ? "que LIPgo liquida de más (día 31)" : "que Siigo paga de más (febrero)"}.`,
        )
      const diasSinPago = dias.filter((x) => x.total === 0).length
      if (diasSinPago > 0)
        explicaciones.push(
          `${diasSinPago} día(s) SIN pago en LIPgo (sin registro / falta) que la base quincenal de Siigo SÍ paga (+$${Math.round(diasSinPago * baseDiaSim).toLocaleString("es-CO")} en Siigo). Si son faltas reales, deben reportarse en Siigo como novedad de ausencia.`,
        )
      if (cuadra)
        explicaciones.push(
          "Diferencia dentro de la tolerancia de redondeo (±$2.000): el pago de Siigo coincide con el cálculo de LIPgo.",
        )

      siigo = {
        disponible: true,
        jornada,
        hod,
        baseQuincenal,
        conceptos,
        totalSiigo,
        totalLipgo,
        diferencia,
        cuadra,
        componentes,
        explicaciones,
      }
    }

    return {
      colaborador: {
        persona,
        identificacion,
        salario,
        baseDia,
        empresa,
        contratosiigo: String(hc?.contratosiigo || "").trim(),
      },
      quincena: { anio, mes, num: quincena, desde, hasta },
      dias,
      resumen,
      metaResumen,
      plano,
      siigo,
    }
  }
}

/** Cuadro completo (A/B/C/D) de un colaborador para una quincena. */
export async function getRevisionNomina(
  persona: string,
  anio: number,
  mes: number,
  quincena: 1 | 2,
): Promise<{ success: boolean; data?: RevisionNominaData; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Revisión de nómina"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!persona) return { success: false, message: "Selecciona un colaborador." }
    const admin: any = await getSupabaseAdmin()
    const { desde, hasta } = rangoQ(anio, mes, quincena)

    // Ficha del colaborador (Head Count)
    const { data: hc } = await admin
      .from("headcount")
      .select("nombre, identificacion, salario, idempresa, contratosiigo, fechainicio")
      .eq("nombre", persona)
      .limit(1)
      .maybeSingle()

    // A) Días de la quincena (pagonomina — modelo nuevo ya liquida base por día)
    const { data: filas, error: errPn } = await admin
      .rpc("pagonomina_rango", { p_desde: desde, p_hasta: hasta })
      .select(PN_COLS)
      .eq("persona", persona)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
    if (errPn) return { success: false, message: errPn.message }

    // C) Archivo plano de esa cédula para el mes + quincena
    const identificacion = String(hc?.identificacion || "").trim()
    let planoRows: any[] = []
    if (identificacion) {
      const { data: pl } = await admin
        .rpc("archivoplano_periodo", { p_anio: anio, p_mes: mes })
        .select("nombrenovedad, tiponovedad, cantidadvalor, nominaproyectada, fechainicio, quincena, mes")
        .eq("identificacionempleado", identificacion)
        .eq("mes", String(mes).padStart(2, "0"))
        .eq("quincena", quincena)
      planoRows = pl || []
    }

    const proyectos = new Set<number>()
    for (const r of filas || []) {
      const esp = r.especialidad === true || String(r.especialidad) === "true"
      if (num(r.toneladas) > 0 && !esp && r.idempresaliquidacion != null) proyectos.add(Number(r.idempresaliquidacion))
    }
    const ctx = await armarContexto(admin, anio, mes, quincena, desde, hasta, proyectos)

    return { success: true, data: armarPersona(persona, hc, filas || [], planoRows, ctx) }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al armar la revisión de nómina." }
  }
}

// ---------------------------------------------------------------------------
// CONSOLIDADO POR PROYECTO — "Todos los colaboradores"
// Mismo cuadro, pero para TODO el centro de costo a la vez: es lo que permite
// cruzar el archivo plano COMPLETO de LIPgo contra Siigo de una sola pasada, en
// vez de persona por persona. El universo son los colaboradores del Head Count
// amarrados al id del selector global (cada id ES un centro de costo), y de cada
// uno se toman TODOS sus días — trabaje donde trabaje —, porque Siigo lo liquida
// por su contrato, no por dónde movió el tonelaje.
// Corre `armarPersona` (la misma función de la vista individual) sobre cada uno,
// así que el cruce con Siigo es idéntico; aquí solo se suma y se ordena por Δ.
// ---------------------------------------------------------------------------

export interface PersonaProyectoRow {
  persona: string
  identificacion: string
  estado: string
  salario: number
  /** LIPgo */
  baseGarantizada: number
  ingresoTurno: number
  recargoDominical: number
  bono: number
  perdida: number
  bonosNoPrestacionales: number
  totalLipgo: number
  /** Siigo (simulado desde el archivo plano) */
  baseQuincenal: number
  totalSiigo: number
  diferencia: number
  cuadra: boolean
  simulable: boolean // hay salario en Head Count (sin él no se puede simular Siigo)
  /** Señales para priorizar la revisión */
  diasLiquidados: number
  diasSinPago: number
  anomalias: number
  novedadesPlano: number
  componentes: CruceComponente[]
}

export interface NovedadPlanoAgg {
  nombrenovedad: string
  tiponovedad: string
  personas: number
  cantidadvalor: number
}

export interface RevisionProyectoData {
  empresa: number | null
  quincena: { anio: number; mes: number; num: number; desde: string; hasta: string }
  personas: PersonaProyectoRow[]
  resumen: {
    nPersonas: number
    nConDatos: number
    nCuadran: number
    nDescuadran: number
    nSinSalario: number
    nSinPlano: number
    totalLipgo: number
    totalSiigo: number
    diferencia: number
    baseGarantizada: number
    ingresoTurno: number
    recargoDominical: number
    bono: number
    perdida: number
    bonosNoPrestacionales: number
    anomalias: number
    diasSinPago: number
  }
  componentes: CruceComponente[]
  plano: NovedadPlanoAgg[]
}

export async function getRevisionNominaProyecto(
  idempresa: number | null,
  anio: number,
  mes: number,
  quincena: 1 | 2,
): Promise<{ success: boolean; data?: RevisionProyectoData; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Revisión de nómina"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const admin: any = await getSupabaseAdmin()
    const { desde, hasta } = rangoQ(anio, mes, quincena)

    // 1) Universo = Head Count del proyecto (centro de costo del selector global).
    let qhc = admin.from("headcount").select("nombre, identificacion, salario, idempresa, contratosiigo, estado, fechainicio, fecha_retiro")
    if (idempresa != null) qhc = qhc.eq("idempresa", idempresa)
    const { data: hcRows, error: errHc } = await qhc
    if (errHc) return { success: false, message: errHc.message }

    const hcPorPersona = new Map<string, any>()
    for (const r of hcRows || []) {
      const p = String(r.nombre || "").trim()
      if (!p || /prueba/i.test(p)) continue
      // RETIRADOS y SIN CONTRATO fuera — misma regla que filtra el archivo
      // plano, para que el cruce compare exactamente el mismo universo que
      // viaja a Siigo. Ver `liquidable`.
      if (!liquidable(r)) continue
      if (!hcPorPersona.has(p)) hcPorPersona.set(p, r)
    }
    const personas = Array.from(hcPorPersona.keys())
    if (personas.length === 0)
      return {
        success: false,
        message:
          idempresa != null
            ? `No hay colaboradores en el Head Count del proyecto ${idempresa}.`
            : "No hay colaboradores en el Head Count.",
      }

    // 2) pagonomina de todos ellos (por lotes para no reventar la URL del .in,
    //    y paginado dentro de cada lote por el tope de 1000 filas de Supabase).
    const filasTodas: any[] = []
    for (const lote of enLotes(personas, 50)) {
      const rows = await fetchAllRows((f, t) =>
        admin
          .rpc("pagonomina_rango", { p_desde: desde, p_hasta: hasta })
          .select(PN_COLS)
          .in("persona", lote)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("persona", { ascending: true })
          .order("fecha", { ascending: true })
          .range(f, t),
      )
      filasTodas.push(...rows)
    }
    const filasPorPersona = new Map<string, any[]>()
    for (const r of filasTodas) {
      const p = String(r.persona || "").trim()
      if (!filasPorPersona.has(p)) filasPorPersona.set(p, [])
      filasPorPersona.get(p)!.push(r)
    }

    // 3) archivoplano de todas las cédulas del universo.
    const cedulas = personas.map((p) => String(hcPorPersona.get(p)?.identificacion || "").trim()).filter(Boolean)
    const planoTodo: any[] = []
    for (const lote of enLotes(Array.from(new Set(cedulas)), 50)) {
      const rows = await fetchAllRows((f, t) =>
        admin
          .rpc("archivoplano_periodo", { p_anio: anio, p_mes: mes })
          .select("identificacionempleado, nombrenovedad, tiponovedad, cantidadvalor, nominaproyectada, fechainicio, quincena, mes")
          .in("identificacionempleado", lote)
          .eq("mes", String(mes).padStart(2, "0"))
          .eq("quincena", quincena)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts):
          // una persona tiene varias novedades por quincena.
          .order("identificacionempleado", { ascending: true })
          .order("nombrenovedad")
          .order("fechainicio")
          .range(f, t),
      )
      planoTodo.push(...rows)
    }
    const planoPorCedula = new Map<string, any[]>()
    for (const r of planoTodo) {
      const c = String(r.identificacionempleado || "").trim()
      if (!planoPorCedula.has(c)) planoPorCedula.set(c, [])
      planoPorCedula.get(c)!.push(r)
    }

    // 4) Contexto compartido (metas + HC real + vigencia) y cálculo por persona.
    const proyectos = new Set<number>()
    for (const r of filasTodas) {
      const esp = r.especialidad === true || String(r.especialidad) === "true"
      if (num(r.toneladas) > 0 && !esp && r.idempresaliquidacion != null) proyectos.add(Number(r.idempresaliquidacion))
    }
    const ctx = await armarContexto(admin, anio, mes, quincena, desde, hasta, proyectos)

    const out: PersonaProyectoRow[] = []
    const compAcum = new Map<string, { lipgo: number; siigo: number; orden: number }>()
    const novAgg = new Map<string, { tipo: string; cant: number; personas: Set<string> }>()
    const res = {
      nPersonas: personas.length,
      nConDatos: 0,
      nCuadran: 0,
      nDescuadran: 0,
      nSinSalario: 0,
      nSinPlano: 0,
      totalLipgo: 0,
      totalSiigo: 0,
      diferencia: 0,
      baseGarantizada: 0,
      ingresoTurno: 0,
      recargoDominical: 0,
      bono: 0,
      perdida: 0,
      bonosNoPrestacionales: 0,
      anomalias: 0,
      diasSinPago: 0,
    }

    for (const persona of personas) {
      const hc = hcPorPersona.get(persona)
      const ced = String(hc?.identificacion || "").trim()
      const filas = filasPorPersona.get(persona) || []
      const planoRows = ced ? planoPorCedula.get(ced) || [] : []
      const d = armarPersona(persona, hc, filas, planoRows, ctx)
      const r = d.resumen
      const s = d.siigo
      const diasSinPago = d.dias.filter((x) => x.total === 0).length

      out.push({
        persona,
        identificacion: ced,
        estado: String(hc?.estado || "").trim() || "—",
        salario: d.colaborador.salario,
        baseGarantizada: r.baseGarantizada,
        ingresoTurno: r.ingresoTurno,
        recargoDominical: r.recargoDominical,
        bono: r.bono,
        perdida: r.perdida,
        bonosNoPrestacionales: r.bonosNoPrestacionales,
        totalLipgo: r.total,
        baseQuincenal: s.baseQuincenal,
        totalSiigo: s.totalSiigo,
        diferencia: s.disponible ? s.diferencia : 0,
        cuadra: s.disponible ? s.cuadra : false,
        simulable: s.disponible,
        diasLiquidados: d.dias.length,
        diasSinPago,
        anomalias: r.anomalias,
        novedadesPlano: d.plano.length,
        componentes: s.componentes,
      })

      if (d.dias.length > 0) res.nConDatos += 1
      if (!s.disponible) res.nSinSalario += 1
      else if (s.cuadra) res.nCuadran += 1
      else res.nDescuadran += 1
      if (d.plano.length === 0) res.nSinPlano += 1
      res.totalLipgo += r.total
      res.totalSiigo += s.disponible ? s.totalSiigo : 0
      res.baseGarantizada += r.baseGarantizada
      res.ingresoTurno += r.ingresoTurno
      res.recargoDominical += r.recargoDominical
      res.bono += r.bono
      res.perdida += r.perdida
      res.bonosNoPrestacionales += r.bonosNoPrestacionales
      res.anomalias += r.anomalias
      res.diasSinPago += diasSinPago

      // Cruce por componente, acumulado del proyecto (mismo desglose que la vista
      // individual, para poder ver DÓNDE nace la diferencia total).
      s.componentes.forEach((c, i) => {
        const g = compAcum.get(c.nombre) || { lipgo: 0, siigo: 0, orden: i }
        g.lipgo += c.lipgo
        g.siigo += c.siigo
        compAcum.set(c.nombre, g)
      })
      for (const p of d.plano) {
        const g = novAgg.get(p.nombrenovedad) || { tipo: p.tiponovedad, cant: 0, personas: new Set<string>() }
        g.cant += p.cantidadvalor
        g.personas.add(persona)
        novAgg.set(p.nombrenovedad, g)
      }
    }

    res.diferencia = res.totalSiigo - res.totalLipgo

    // Orden de revisión: primero los que más descuadran (|Δ| desc), y dentro de
    // los que cuadran, por total. Es la lista de trabajo, no un directorio.
    out.sort((a, b) => {
      const da = a.simulable ? Math.abs(a.diferencia) : -1
      const db = b.simulable ? Math.abs(b.diferencia) : -1
      if (db !== da) return db - da
      return b.totalLipgo - a.totalLipgo
    })

    const componentes: CruceComponente[] = Array.from(compAcum.entries())
      .sort((a, b) => a[1].orden - b[1].orden)
      .map(([nombre, g]) => ({ nombre, lipgo: Math.round(g.lipgo), siigo: Math.round(g.siigo) }))

    const plano: NovedadPlanoAgg[] = Array.from(novAgg.entries())
      .map(([nombrenovedad, g]) => ({
        nombrenovedad,
        tiponovedad: g.tipo,
        personas: g.personas.size,
        cantidadvalor: g.cant,
      }))
      .sort((a, b) => a.nombrenovedad.localeCompare(b.nombrenovedad, "es"))

    return {
      success: true,
      data: {
        empresa: idempresa,
        quincena: { anio, mes, num: quincena, desde, hasta },
        personas: out,
        resumen: res,
        componentes,
        plano,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al armar el consolidado del proyecto." }
  }
}

// ---------------------------------------------------------------------------
// CONCILIACIÓN PESO ↔ PAGO ↔ FACTURACIÓN (quincena, LIP completo: id 1-4)
// Garantiza que lo PAGADO al personal cuadre con lo FACTURABLE. La fuente de
// verdad del peso cambia por proyecto — MISMO criterio que `peso_base_calculo`
// en 053_pagonomina_reemplazo.sql (no se reinventa, se replica 1:1):
//   - Plantas con báscula física (Indupan=1, Avimol=2): SIEMPRE pesovascula,
//     cualquier operación.
//   - CEDIS (Cedi Funza=3, Cedi Medellín=4) en Descargue: báscula del tiquete
//     normalizada (÷1000 si viene en kg), con fallback a pesoorden si no hay
//     báscula o el dato es corrupto (fuera de rango 0.1×–10× el pesoorden).
//   - CEDIS en el resto de operaciones (Cargue, etc.): pesoorden (peso
//     declarado por los productos de la orden).
// Universo = mismas órdenes que liquida pagonomina (fincargue no vacío),
// EXCLUYENDO los clones de Distribución (+D): heredan pesovascula/pesoorden
// de la orden madre (ya se pesó/declaró ahí) — incluirlos duplicaría el
// tonelaje. Reparte igual que pagonomina (peso base ÷ n auxiliares ×
// tarifaspersonal) y cruza contra la vista real, exponiendo:
//   - diferencia peso PRODUCTO (Σ detalleoc.toneladas) vs peso BASE por
//     orden, con el factor de prorrateo (prevalece el peso base/fuente
//     de verdad de cada proyecto);
//   - órdenes sin auxiliares (facturables pero sin nadie a quien pagar —
//     puede ser vehículo no atendido por personal propio de LIP);
//   - órdenes sin tarifa vigente (reparten toneladas pero pagan $0 — se paga
//     solo donde hay tarifa asignada, p. ej. ID 4 sí, otros ID pueden no);
//   - órdenes marcadas NO facturar (pagan nómina sin ingreso);
//   - auxiliares que no cruzan con Head Count (nombre huérfano);
//   - Δ por colaborador entre este cálculo y pagonomina (vínculo/retiro/fechas).
// ---------------------------------------------------------------------------

// `pesoBaseCalculo` y `excluirAvimolDistribucion`: movidas a
// `lib/nomina-calculo-utils.ts` (compartidas con Control de Toneladas) —
// mismo comportamiento, ver ese archivo para el detalle de cada regla.

export interface OrdenConciliada {
  idorden: number
  orden: string
  fecha: string
  planta: number // 1=Indupan, 2=Avimol, 3=Cedi Funza, 4=Cedi Medellín
  tipooperacion: string
  fuente: "bascula" | "producto" // origen del peso base (ver pesoBaseCalculo)
  tonBase: number // peso base de cálculo — fuente de verdad de pago y cobro
  tonProducto: number // Σ detalleoc.toneladas (peso declarado por productos)
  factor: number // tonBase / tonProducto (prorrateo del detalle; 0 = no calculable)
  nAux: number
  auxiliares: string[]
  facturar: boolean
  tarifa: number
  valorPago: number // tonBase × tarifa (0 si no hay auxiliares)
  facturasiigo: string | null // señal REAL de "facturado" (igual criterio que categoriaDeFactura en facturacion-control-actions.ts)
  estadofactura: string | null
}

export interface DetalleOrdenColaborador {
  fecha: string
  orden: string
  tipooperacion: string
  planta: number
  tonOrden: number
  nAux: number
  tonPersona: number
  tarifa: number
  pago: number
}

export interface ColaboradorConciliado {
  persona: string
  enHeadcount: boolean
  salario: number // headcount.salario (mensual); 0 si no hay match
  baseDia: number // salario/30 (mismo fallback que getRevisionNomina: 58364 si no hay salario)
  ordenes: number
  tonAsignada: number
  valorPago: number
  tonPagonomina: number
  pagoPagonomina: number
  deltaTon: number // tonPagonomina − tonAsignada
  detalle: DetalleOrdenColaborador[]
}

export interface ConciliacionData {
  quincena: { anio: number; mes: number; num: number; desde: string; hasta: string }
  resumen: {
    ordenes: number
    ordenesBascula: number // con fuente="bascula" (pesaje físico real)
    tonBase: number // Σ peso base de cálculo (báscula en 1/2, producto/báscula normalizada en 3/4)
    tonProducto: number
    tonAsignada: number
    valorCalculado: number
    tonPagonomina: number
    pagoPagonomina: number
    tonSinAsignar: number
    ordenesSinAux: number
    ordenesSinTarifa: number
    ordenesNoFacturar: number
    tonNoFacturar: number
    ordenesConDiferencia: number
    difProductoBase: number // Σ (tonBase − tonProducto) en órdenes con pesaje físico
    auxiliaresHuerfanos: string[]
    // "Regla de oro: pago lo que facturo" (pedido 2026-09-23, incidente Cedi
    // Funza: Descargue duplicado pagó nómina de más y nunca se facturó de
    // verdad, tapado con un ajuste de inventario). Distinto de
    // ordenesNoFacturar (esa mira el flag `cabeceraoc.facturar`): esto
    // verifica la señal REAL de facturación (`cabeceraoc.facturasiigo` /
    // `estadofactura`, el mismo criterio de categoriaDeFactura del Cuadro de
    // Control -- corregido 2026-09-24, un primer intento miraba
    // `prefacturas.soporte`, que NO es confiable). Solo marca "sin_gestionar"
    // (nadie ha tocado el trámite de facturación) -- "en_proceso" no cuenta,
    // es trámite normal en curso. Excluye órdenes cuyos auxiliares son
    // 100% registros de prueba (nunca se pagó nada real).
    ordenesPagadasSinFacturar: number
    valorPagadasSinFacturar: number
  }
  ordenesConDiferencia: OrdenConciliada[]
  ordenesSinAux: OrdenConciliada[]
  ordenesSinTarifa: OrdenConciliada[]
  ordenesNoFacturar: OrdenConciliada[]
  ordenesPagadasSinFacturar: OrdenConciliada[]
  colaboradores: ColaboradorConciliado[]
}

// Corrección 2026-09-24 (el cliente detectó que el primer intento miraba el
// lugar equivocado): la membresía en `prefacturas.soporte` NO es la señal
// real de "facturado" -- hay órdenes con `facturasiigo` real (PDF de la
// factura ya adjunto) que nunca quedaron registradas dentro de ningún anexo
// guardado. Se replica aquí EXACTO el mismo criterio de 3 categorías que ya
// usa `categoriaDeFactura` en lib/facturacion-control-actions.ts para el
// Cuadro de Control (no se puede importar esa función sync directo -- ese
// archivo es "use server", solo exporta async):
//   - "facturado": ya tiene facturasiigo -- de verdad se cobró.
//   - "en_proceso": el coordinador ya la validó (estadofactura con algo
//     distinto de "pendiente"), solo falta que llegue el Siigo -- NO es una
//     fuga, es trámite normal en curso.
//   - "sin_gestionar": nadie ha tocado el trámite de facturación de esta
//     orden para NADA -- si además ya se pagó nómina, ESA es la fuga real.
function categoriaFacturaOrden(facturasiigo: string | null, estadofactura: string | null): "facturado" | "en_proceso" | "sin_gestionar" {
  if (String(facturasiigo ?? "").trim() !== "") return "facturado"
  const e = String(estadofactura ?? "").trim()
  if (e !== "" && !/pendiente/i.test(e)) return "en_proceso"
  return "sin_gestionar"
}

export async function getConciliacionQuincena(
  anio: number,
  mes: number,
  quincena: 1 | 2,
  empresa: number, // 0 = todo LIP (1-4); o un id específico
): Promise<{ success: boolean; data?: ConciliacionData; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Revisión de nómina"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const admin: any = await getSupabaseAdmin()
    const emps = [1, 2, 3, 4].includes(empresa) ? [empresa] : [1, 2, 3, 4]

    const diaIni = quincena === 1 ? 1 : 16
    const diaFin = quincena === 1 ? 15 : fin(anio, mes)
    const desde = `${anio}-${String(mes).padStart(2, "0")}-${String(diaIni).padStart(2, "0")}`
    const hasta = `${anio}-${String(mes).padStart(2, "0")}-${String(diaFin).padStart(2, "0")}`

    // 1) Órdenes del periodo — MISMO universo que pagonomina: fincargue no vacío
    //    (la vista liquida por fechacargue). Paginado (tope Supabase 1000).
    //    "proyeccion" excluido (2026-09-08): residuo de un módulo manual
    //    descontinuado en jul-2026 (ver scripts/053_pagonomina_reemplazo.sql) —
    //    nunca fue tonelaje real, mismo criterio que la vista ya corregida.
    const ordenesRaw: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("cabeceraoc")
        .select("id, ordendecargue, fechacargue, idempresa, tipooperacion, pesovascula, pesoorden, auxiliares, facturar, facturasiigo, estadofactura")
        .in("idempresa", emps)
        .gte("fechacargue", desde)
        .lte("fechacargue", hasta)
        .not("fincargue", "is", null)
        .neq("tipooperacion", "proyeccion")
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      if (!data || data.length === 0) break
      ordenesRaw.push(...data)
      if (data.length < 1000) break
    }

    // 2) Detalle de productos (Σ toneladas por orden) — en lotes de ids.
    const tonProductoPorOrden = new Map<number, number>()
    const ids = ordenesRaw.map((o) => Number(o.id))
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      for (let off = 0; ; off += 1000) {
        const { data, error } = await admin
          .from("detalleoc")
          .select("idorden, toneladas")
          .in("idorden", chunk)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(off, off + 999)
        if (error) return { success: false, message: error.message }
        for (const d of data || []) {
          const k = Number(d.idorden)
          tonProductoPorOrden.set(k, (tonProductoPorOrden.get(k) || 0) + num(d.toneladas))
        }
        if (!data || data.length < 1000) break
      }
    }

    // 3) Tarifas de destajo vigentes (mismo join que pagonomina:
    //    empresaid + operacion + fechacargue entre fechaini/fechafin).
    const { data: tarifas, error: errTar } = await admin
      .from("tarifaspersonal")
      .select("empresaid, operacion, tarifa, fechaini, fechafin")
      .in("empresaid", emps)
    if (errTar) return { success: false, message: errTar.message }
    const tarifaDe = (planta: number, operacion: string, fecha: string): number => {
      for (const t of tarifas || []) {
        if (Number(t.empresaid) !== planta) continue
        if (String(t.operacion) !== operacion) continue
        if (String(t.fechaini) <= fecha && fecha <= String(t.fechafin)) return num(t.tarifa)
      }
      return 0
    }

    // 4) Head Count (para marcar auxiliares huérfanos por nombre y traer su
    //    salario base — misma fuente/fallback que usa getRevisionNomina).
    const nombresHc = new Set<string>()
    const salarioPorNombre = new Map<string, number>()
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin.from("headcount").select("nombre, salario").order("id").range(off, off + 999)
      if (error) break
      for (const h of data || []) {
        const key = String(h.nombre || "").trim().toUpperCase()
        nombresHc.add(key)
        if (!salarioPorNombre.has(key)) salarioPorNombre.set(key, num(h.salario))
      }
      if (!data || data.length < 1000) break
    }

    // 4b) Auxiliares de PRUEBA (hallazgo 2026-09-24, confirmado con el
    //     cliente): quedan registrados en headcount como placeholders de
    //     prueba (ej. "AUXILIAR PRUEBA AVIMOL 1", salario null) y NUNCA
    //     aparecen en pagonomina -- nunca se les pagó nada real. Si TODOS los
    //     auxiliares de una orden son de prueba, esa orden no pagó nómina de
    //     verdad y no debe contar en "pagadas sin facturar".
    const nombresPrueba = new Set<string>()
    for (const n of nombresHc) if (/\bPRUEBA\b/.test(n)) nombresPrueba.add(n)

    // 5) Procesar órdenes: reparto EXACTO de pagonomina (báscula ÷ n auxiliares).
    const ordenes: OrdenConciliada[] = []
    const porPersona = new Map<string, ColaboradorConciliado>()
    const huerfanos = new Set<string>()
    for (const o of ordenesRaw) {
      const planta = Number(o.idempresa)
      const tipo = String(o.tipooperacion || "").trim()
      if (excluirAvimolDistribucion(planta, tipo)) continue
      const fecha = String(o.fechacargue).slice(0, 10)
      const auxiliares = String(o.auxiliares || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const nAux = auxiliares.length
      // Peso base = MISMA fuente de verdad que usa pagonomina para pagar y
      // facturación para cobrar en cada proyecto (ver pesoBaseCalculo arriba).
      const { peso: tonBase, fuente } = pesoBaseCalculo(planta, tipo, num(o.pesovascula), num(o.pesoorden))
      const tonProducto = tonProductoPorOrden.get(Number(o.id)) || 0
      const tarifa = tarifaDe(planta, tipo, fecha)
      const valorPago = nAux > 0 ? tonBase * tarifa : 0

      const orden: OrdenConciliada = {
        idorden: Number(o.id),
        orden: String(o.ordendecargue || ""),
        fecha,
        planta,
        tipooperacion: tipo,
        fuente,
        tonBase,
        tonProducto,
        factor: tonProducto > 0 && tonBase > 0 ? tonBase / tonProducto : 0,
        nAux,
        auxiliares,
        facturar: o.facturar !== false,
        tarifa,
        valorPago,
        facturasiigo: o.facturasiigo ?? null,
        estadofactura: o.estadofactura ?? null,
      }
      ordenes.push(orden)

      // Reparto por persona (tonelaje ÷ n, igual que pagonomina).
      if (nAux > 0 && tonBase > 0) {
        const tonPersona = tonBase / nAux
        for (const p of auxiliares) {
          const key = p.toUpperCase()
          if (!nombresHc.has(key)) huerfanos.add(p)
          if (!porPersona.has(key)) {
            const salario = salarioPorNombre.get(key) || 0
            porPersona.set(key, {
              persona: p,
              enHeadcount: nombresHc.has(key),
              salario,
              baseDia: salario > 0 ? salario / 30 : 58364,
              ordenes: 0,
              tonAsignada: 0,
              valorPago: 0,
              tonPagonomina: 0,
              pagoPagonomina: 0,
              deltaTon: 0,
              detalle: [],
            })
          }
          const c = porPersona.get(key)!
          c.ordenes += 1
          c.tonAsignada += tonPersona
          c.valorPago += tonPersona * tarifa
          c.detalle.push({
            fecha,
            orden: orden.orden,
            tipooperacion: tipo,
            planta,
            tonOrden: tonBase,
            nAux,
            tonPersona,
            tarifa,
            pago: tonPersona * tarifa,
          })
        }
      }
    }

    // 6) Cruce contra la vista pagonomina REAL (lo que efectivamente liquida
    //    nómina, con sus filtros de vínculo/retiro/fecha). Referencia por persona.
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .rpc("pagonomina_rango", { p_desde: desde, p_hasta: hasta })
        // `fecha` va en el select porque es columna de orden (PostgREST no deja
        // ordenar una función rpc por una columna no seleccionada).
        .select("persona, fecha, toneladas, pago_produccion, idempresaliquidacion")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .gt("toneladas", 0)
        .in("idempresaliquidacion", emps)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("persona")
        .order("fecha")
        .range(off, off + 999)
      if (error) break
      for (const r of data || []) {
        const key = String(r.persona || "").trim().toUpperCase()
        const c = porPersona.get(key)
        if (c) {
          c.tonPagonomina += num(r.toneladas)
          c.pagoPagonomina += num(r.pago_produccion)
        }
      }
      if (!data || data.length < 1000) break
    }
    for (const c of porPersona.values()) c.deltaTon = c.tonPagonomina - c.tonAsignada

    // 7) Resumen y listados de alerta.
    const conAux = ordenes.filter((o) => o.nAux > 0)
    const sinAux = ordenes.filter((o) => o.nAux === 0 && o.tonBase > 0)
    const sinTarifa = ordenes.filter((o) => o.nAux > 0 && o.tonBase > 0 && o.tarifa === 0)
    const noFacturar = ordenes.filter((o) => !o.facturar)
    const conDif = ordenes
      .filter((o) => o.fuente === "bascula" && o.tonProducto > 0 && Math.abs(o.tonBase - o.tonProducto) > 0.05)
      .sort((a, b) => Math.abs(b.tonBase - b.tonProducto) - Math.abs(a.tonBase - a.tonProducto))

    // "Pago lo que facturo": de las órdenes que SÍ se pagaron (nAux > 0, con
    // auxiliares REALES -- ver exclusión de auxiliares de prueba abajo) y que
    // no están marcadas explícitamente NO facturar, marcar solo las que
    // quedaron en "sin_gestionar" -- nadie ha tocado NADA de su trámite de
    // facturación. Las que ya están "en_proceso" (coordinador ya las validó,
    // falta Siigo) NO son una fuga, es trámite normal en curso.
    // Margen de gracia: el trámite de facturación nunca es el mismo día --
    // sin esto, cualquier orden de ayer/hoy sale marcada como "fuga" solo por
    // ser reciente (confirmado 2026-09-24: las 5 de ID3 que salían eran TODAS
    // del día anterior). 5 días corridos de margen antes de considerar que
    // "ya debieron haberla tocado".
    const hoyColombia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
    const fechaLimite = new Date(hoyColombia)
    fechaLimite.setDate(fechaLimite.getDate() - 5)
    const fechaLimiteStr = fechaLimite.toISOString().slice(0, 10)

    const pagadasSinFacturar = ordenes.filter((o) => {
      if (o.nAux === 0 || !o.facturar) return false
      if (o.fecha > fechaLimiteStr) return false // muy reciente -- todavia no le toca su ciclo normal
      // Tolva/Tolva f (Indupan) se factura en BLOQUE por Prefactura de
      // Producción, no orden por orden -- confirmado 2026-09-24: de 377
      // órdenes Tolva históricas, solo 1 tiene facturasiigo puesto, y la
      // prefactura de producción ni siquiera guarda numeroorden en su
      // detalle. No hay señal confiable a nivel de ORDEN para este tipo; se
      // excluye para no generar falsos positivos sistemáticos.
      if (/^tolva/i.test(o.tipooperacion)) return false
      const hayAuxReal = o.auxiliares.some((a) => !nombresPrueba.has(a.trim().toUpperCase()))
      if (!hayAuxReal) return false // 100% auxiliares de prueba -- no se pagó nada real
      return categoriaFacturaOrden(o.facturasiigo, o.estadofactura) === "sin_gestionar"
    })

    const colaboradores = Array.from(porPersona.values()).sort((a, b) => b.tonAsignada - a.tonAsignada)
    for (const c of colaboradores) c.detalle.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))

    const tonBase = ordenes.reduce((a, o) => a + o.tonBase, 0)
    const data: ConciliacionData = {
      quincena: { anio, mes, num: quincena, desde, hasta },
      resumen: {
        ordenes: ordenes.length,
        ordenesBascula: ordenes.filter((o) => o.fuente === "bascula").length,
        tonBase,
        tonProducto: ordenes.reduce((a, o) => a + o.tonProducto, 0),
        tonAsignada: conAux.reduce((a, o) => a + o.tonBase, 0),
        valorCalculado: ordenes.reduce((a, o) => a + o.valorPago, 0),
        tonPagonomina: colaboradores.reduce((a, c) => a + c.tonPagonomina, 0),
        pagoPagonomina: colaboradores.reduce((a, c) => a + c.pagoPagonomina, 0),
        tonSinAsignar: sinAux.reduce((a, o) => a + o.tonBase, 0),
        ordenesSinAux: sinAux.length,
        ordenesSinTarifa: sinTarifa.length,
        ordenesNoFacturar: noFacturar.length,
        tonNoFacturar: noFacturar.reduce((a, o) => a + o.tonBase, 0),
        ordenesConDiferencia: conDif.length,
        difProductoBase: conDif.reduce((a, o) => a + (o.tonBase - o.tonProducto), 0),
        auxiliaresHuerfanos: Array.from(huerfanos).sort(),
        ordenesPagadasSinFacturar: pagadasSinFacturar.length,
        valorPagadasSinFacturar: pagadasSinFacturar.reduce((a, o) => a + o.valorPago, 0),
      },
      ordenesConDiferencia: conDif,
      ordenesSinAux: sinAux,
      ordenesSinTarifa: sinTarifa,
      ordenesNoFacturar: noFacturar,
      ordenesPagadasSinFacturar: pagadasSinFacturar,
      colaboradores,
    }
    return { success: true, data }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al armar la conciliación de la quincena." }
  }
}

// ---------------------------------------------------------------------------
// HC POR DÍA POR PROYECTO (ID) — base real de trabajadores con la que se opera
// cada día. Cuenta los trabajadores DISTINTOS que movieron toneladas (destajo)
// por fecha + proyecto (asistencia ya ratificada en pagonomina), y lo cruza con
// el HC planeado y la meta configurados. El HC varía a diario según el volumen.
// ---------------------------------------------------------------------------

export interface HcDiaProyecto {
  fecha: string
  dow: string
  idempresa: number
  proyecto: string
  hcReal: number
  toneladas: number
  hcConfig: number // HC real de asistencia ese día (registroasistencia) — ya NO es un valor "configurado", ver comentario abajo
  meta: number
  tonPorTrabajador: number // toneladas ÷ hcReal (promedio real por trabajador ese día)
}

const NOMBRE_PROYECTO: Record<number, string> = {
  1: "Harinera Indupan",
  2: "Avimol",
  3: "Cedi Funza",
  4: "Cedi Medellín",
}

export async function getHcPorDia(
  anio: number,
  mes: number,
): Promise<{ success: boolean; data: HcDiaProyecto[]; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Revisión de nómina"], "ver")
  if (motivoAccion) return { success: false, message: motivoAccion, data: [] }
  try {
    const admin: any = await getSupabaseAdmin()
    const desde = `${anio}-${String(mes).padStart(2, "0")}-01`
    const hasta = `${anio}-${String(mes).padStart(2, "0")}-${String(fin(anio, mes)).padStart(2, "0")}`

    // Meta DINÁMICA por (fecha, proyecto) — mismo módulo que armarContexto,
    // para no divergir. "hcConfig" pasa a ser el HC real de asistencia de
    // ese día (registroasistencia), y "meta" es el reparto del target del
    // día entre esos trabajadores reales (sin desglose por hora individual,
    // a diferencia de la meta persona-por-persona de armarPersona — esta
    // tabla es agregada por proyecto/día, no por persona).
    const idsProyecto = [1, 2, 3, 4]
    const hcHorasPorDia = await getHcYHorasRealPorDia(idsProyecto, desde, hasta)
    const metaObj = new Map<string, { proyecto: string; hc: number; meta: number }>()
    for (const [key, { headcount }] of hcHorasPorDia) {
      const emp = Number(key.split("|")[1])
      const metaTonDia = (TON_MES_CARGUE_DESCARGUE[emp] || 0) / DIAS_OPERACION_MES
      metaObj.set(key, { proyecto: NOMBRE_PROYECTO[emp] || `Proyecto ${emp}`, hc: headcount, meta: headcount > 0 ? metaTonDia / headcount : 0 })
    }

    // pagonomina del mes con toneladas (destajo). Paginado.
    const rows: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .rpc("pagonomina_rango", { p_desde: desde, p_hasta: hasta })
        .select("fecha, persona, idempresaliquidacion, especialidad, toneladas")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .gt("toneladas", 0)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("persona")
        .order("fecha")
        .range(off, off + 999)
      if (error) return { success: false, data: [], message: error.message }
      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < 1000) break
    }

    // Agrupar por fecha + proyecto: HC (distintos) + toneladas
    const grupo = new Map<string, { personas: Set<string>; ton: number; fecha: string; emp: number }>()
    for (const r of rows) {
      if (r.especialidad === true || String(r.especialidad) === "true") continue
      const emp = r.idempresaliquidacion != null ? Number(r.idempresaliquidacion) : 0
      const fecha = String(r.fecha).slice(0, 10)
      const key = fecha + "|" + emp
      if (!grupo.has(key)) grupo.set(key, { personas: new Set(), ton: 0, fecha, emp })
      const g = grupo.get(key)!
      g.personas.add(String(r.persona || "").trim())
      g.ton += num(r.toneladas)
    }

    const data: HcDiaProyecto[] = []
    for (const g of grupo.values()) {
      const cfg = metaObj.get(g.fecha + "|" + g.emp)
      const hcReal = g.personas.size
      const d = new Date(g.fecha + "T12:00:00Z")
      data.push({
        fecha: g.fecha,
        dow: DOW[d.getUTCDay()],
        idempresa: g.emp,
        proyecto: cfg?.proyecto || `Proyecto ${g.emp}`,
        hcReal,
        toneladas: g.ton,
        hcConfig: cfg?.hc || 0,
        meta: cfg?.meta || 0,
        tonPorTrabajador: hcReal > 0 ? g.ton / hcReal : 0,
      })
    }
    data.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.idempresa - b.idempresa))
    return { success: true, data }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al calcular el HC por día." }
  }
}

// ---------------------------------------------------------------------------
// AUXILIARES ↔ ASISTENCIA (quincena, LIP id 1-4) — verifica que quien cobró
// tonelaje en cabeceraoc.auxiliares realmente exista/asistió ese día. Las
// "4 fuentes" que pidió el negocio (Programación, Registro de asistencia,
// Tabla Asistencia, Visor de Asistencia) son en la práctica la MISMA tabla
// `registroasistencia` — solo cambia qué columna llena cada una y cuándo:
//   - Programación de turnos → horaentradaprogramada/horasalidaprogramada
//   - Registro de asistencia (kiosco, tabla `asistencia`) + Tabla Asistencia
//     (supervisor) → horaingreso/horasalida
//   - Visor de Asistencia → asistencia (código de novedad: incapacidad,
//     falta, etc.)
// "Asignación de personal" tampoco es un módulo aparte: es el diálogo
// "Asignar Personal" de Picking/Packing (`getCarguDescarguePersonnel` /
// `assignPersonnelToOrder` en lib/picking-actions.ts), que YA escribe
// directo en cabeceraoc.auxiliares tomando los nombres de registroasistencia
// del mismo día. Por eso el cruce real es solo: cabeceraoc.auxiliares (CSV
// de nombres, sin identificación) ↔ registroasistencia + asistencia del
// mismo (idempresa, fecha), por nombre normalizado (igual que hace
// app/api/attendance/table/route.ts) para recuperar la identificación.
// ---------------------------------------------------------------------------

export type ClasificacionAuxiliar = "ok" | "sin_marcar" | "con_novedad" | "sin_registro"

export interface DetalleAuxiliarDia {
  persona: string
  clasificacion: ClasificacionAuxiliar
  identificacion: string | null
  puesto: string | null
  horaProgramada: string | null
  horaIngreso: string | null
  novedad: string | null
  tonPersona: number
  ordenes: string[]
}

export interface DiaAuxiliar {
  fecha: string
  planta: number
  toneladas: number
  ordenes: number
  auxiliares: number
  ok: number
  sinMarcar: number
  conNovedad: number
  sinRegistro: number
  detalle: DetalleAuxiliarDia[]
}

export interface AsistenciaAuditoriaData {
  quincena: { anio: number; mes: number; num: number; desde: string; hasta: string }
  resumen: {
    toneladas: number
    ordenes: number
    auxiliaresDistintos: number
    ok: number
    sinMarcar: number
    conNovedad: number
    sinRegistro: number
  }
  dias: DiaAuxiliar[]
}

export async function getAuxiliaresVsAsistencia(
  anio: number,
  mes: number,
  quincena: 1 | 2,
  empresa: number, // 0 = todo LIP (1-4); o un id específico
): Promise<{ success: boolean; data?: AsistenciaAuditoriaData; message?: string }> {
  try {
    const admin: any = await getSupabaseAdmin()
    const emps = [1, 2, 3, 4].includes(empresa) ? [empresa] : [1, 2, 3, 4]

    const diaIni = quincena === 1 ? 1 : 16
    const diaFin = quincena === 1 ? 15 : fin(anio, mes)
    const desde = `${anio}-${String(mes).padStart(2, "0")}-${String(diaIni).padStart(2, "0")}`
    const hasta = `${anio}-${String(mes).padStart(2, "0")}-${String(diaFin).padStart(2, "0")}`

    // 1) Órdenes del periodo — mismo universo/criterio de peso que la
    //    conciliación báscula↔pago (pesoBaseCalculo), paginado. "proyeccion"
    //    excluido — ver comentario equivalente en getConciliacionQuincena arriba.
    const ordenesRaw: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("cabeceraoc")
        .select("id, ordendecargue, fechacargue, idempresa, tipooperacion, pesovascula, pesoorden, auxiliares")
        .in("idempresa", emps)
        .gte("fechacargue", desde)
        .lte("fechacargue", hasta)
        .not("fincargue", "is", null)
        .neq("tipooperacion", "proyeccion")
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      if (!data || data.length === 0) break
      ordenesRaw.push(...data)
      if (data.length < 1000) break
    }

    // 2) registroasistencia del periodo — Programación + Registro/Tabla
    //    Asistencia + Visor viven todos en esta tabla.
    const registro: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("registroasistencia")
        .select("identificacion, nombre, idempresa, fecha, puesto, horaentradaprogramada, horasalidaprogramada, horaingreso, horasalida, asistencia")
        .in("idempresa", emps)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      if (!data || data.length === 0) break
      registro.push(...data)
      if (data.length < 1000) break
    }

    // 3) asistencia (kiosco) del periodo — señal más confiable de "sí
    //    marcó ingreso" (registroasistencia.horaingreso es solo un sync
    //    best-effort, ver app/api/attendance/register/route.ts).
    const kiosco: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("asistencia")
        .select("identificacion, idempresa, fecha, hora")
        .in("idempresa", emps)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(off, off + 999)
      if (error) break
      if (!data || data.length === 0) break
      kiosco.push(...data)
      if (data.length < 1000) break
    }
    const kioscoSet = new Set<string>(kiosco.map((k) => `${Number(k.idempresa)}|${String(k.fecha).slice(0, 10)}|${String(k.identificacion || "").trim()}`))

    // 4) Mapa (idempresa|fecha|nombreNormalizado) -> estado agregado del
    //    día (OR entre filas si hay multi-turno).
    interface Estado {
      identificacion: string | null
      puesto: string | null
      horaProgramada: string | null
      horaIngreso: string | null
      novedad: string | null
      programado: boolean
      marcoAsistencia: boolean
    }
    const estadoMap = new Map<string, Estado>()
    for (const r of registro) {
      const fecha = String(r.fecha).slice(0, 10)
      const idempresa = Number(r.idempresa)
      const key = `${idempresa}|${fecha}|${normalizeName(r.nombre)}`
      const identificacion = String(r.identificacion || "").trim() || null
      const programado = !!(r.horaentradaprogramada || r.horasalidaprogramada)
      const marcoKiosco = identificacion ? kioscoSet.has(`${idempresa}|${fecha}|${identificacion}`) : false
      const marcoAsistencia = marcoKiosco || !!r.horaingreso
      const novedad = String(r.asistencia || "").trim() || null
      const prev = estadoMap.get(key)
      if (!prev) {
        estadoMap.set(key, {
          identificacion,
          puesto: r.puesto || null,
          horaProgramada: r.horaentradaprogramada || r.horasalidaprogramada || null,
          horaIngreso: r.horaingreso || null,
          novedad,
          programado,
          marcoAsistencia,
        })
      } else {
        prev.identificacion = prev.identificacion || identificacion
        prev.puesto = prev.puesto || r.puesto || null
        prev.horaProgramada = prev.horaProgramada || r.horaentradaprogramada || r.horasalidaprogramada || null
        prev.horaIngreso = prev.horaIngreso || r.horaingreso || null
        prev.novedad = prev.novedad || novedad
        prev.programado = prev.programado || programado
        prev.marcoAsistencia = prev.marcoAsistencia || marcoAsistencia
      }
    }

    // 5) Cruzar cada auxiliar de cada orden contra el mapa y agregar por
    //    (fecha, planta).
    const porDia = new Map<string, DiaAuxiliar>()
    for (const o of ordenesRaw) {
      const planta = Number(o.idempresa)
      const tipo = String(o.tipooperacion || "").trim()
      if (excluirAvimolDistribucion(planta, tipo)) continue
      const fecha = String(o.fechacargue).slice(0, 10)
      const auxiliares = String(o.auxiliares || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      if (auxiliares.length === 0) continue
      const { peso: tonBase } = pesoBaseCalculo(planta, tipo, num(o.pesovascula), num(o.pesoorden))
      if (tonBase <= 0) continue
      const tonPersona = tonBase / auxiliares.length

      const diaKey = `${fecha}|${planta}`
      if (!porDia.has(diaKey)) {
        porDia.set(diaKey, {
          fecha,
          planta,
          toneladas: 0,
          ordenes: 0,
          auxiliares: 0,
          ok: 0,
          sinMarcar: 0,
          conNovedad: 0,
          sinRegistro: 0,
          detalle: [],
        })
      }
      const dia = porDia.get(diaKey)!
      dia.ordenes += 1
      dia.toneladas += tonBase

      for (const p of auxiliares) {
        const estado = estadoMap.get(`${planta}|${fecha}|${normalizeName(p)}`)
        let clasificacion: ClasificacionAuxiliar
        if (!estado) clasificacion = "sin_registro"
        else if (estado.novedad) clasificacion = "con_novedad"
        else if (!estado.marcoAsistencia) clasificacion = "sin_marcar"
        else clasificacion = "ok"

        const existente = dia.detalle.find((d) => d.persona.toUpperCase() === p.toUpperCase())
        if (existente) {
          existente.tonPersona += tonPersona
          existente.ordenes.push(o.ordendecargue || "")
        } else {
          dia.detalle.push({
            persona: p,
            clasificacion,
            identificacion: estado?.identificacion || null,
            puesto: estado?.puesto || null,
            horaProgramada: estado?.horaProgramada || null,
            horaIngreso: estado?.horaIngreso || null,
            novedad: estado?.novedad || null,
            tonPersona,
            ordenes: [o.ordendecargue || ""],
          })
        }
      }
    }

    // 6) Totales por día (a partir del detalle ya deduplicado por persona).
    for (const dia of porDia.values()) {
      dia.auxiliares = dia.detalle.length
      for (const d of dia.detalle) {
        if (d.clasificacion === "ok") dia.ok += 1
        else if (d.clasificacion === "sin_marcar") dia.sinMarcar += 1
        else if (d.clasificacion === "con_novedad") dia.conNovedad += 1
        else dia.sinRegistro += 1
      }
      dia.detalle.sort((a, b) => {
        const ORDEN: Record<ClasificacionAuxiliar, number> = { sin_registro: 0, con_novedad: 1, sin_marcar: 2, ok: 3 }
        return ORDEN[a.clasificacion] - ORDEN[b.clasificacion] || a.persona.localeCompare(b.persona)
      })
    }

    const dias = Array.from(porDia.values()).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.planta - b.planta))

    const personasDistintas = new Set<string>()
    let ok = 0,
      sinMarcar = 0,
      conNovedad = 0,
      sinRegistro = 0
    for (const dia of dias) {
      for (const d of dia.detalle) {
        personasDistintas.add(normalizeName(d.persona) + "|" + dia.planta)
        if (d.clasificacion === "ok") ok += 1
        else if (d.clasificacion === "sin_marcar") sinMarcar += 1
        else if (d.clasificacion === "con_novedad") conNovedad += 1
        else sinRegistro += 1
      }
    }

    const data: AsistenciaAuditoriaData = {
      quincena: { anio, mes, num: quincena, desde, hasta },
      resumen: {
        toneladas: dias.reduce((a, d) => a + d.toneladas, 0),
        ordenes: dias.reduce((a, d) => a + d.ordenes, 0),
        auxiliaresDistintos: personasDistintas.size,
        ok,
        sinMarcar,
        conNovedad,
        sinRegistro,
      },
      dias,
    }
    return { success: true, data }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al armar el cruce de auxiliares vs. asistencia." }
  }
}
