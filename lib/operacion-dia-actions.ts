"use server"

// ---------------------------------------------------------------------------
// OPERACIÓN DEL DÍA — panel ejecutivo del coordinador.
//
// Todo sale de las MISMAS fuentes que ya alimentan los módulos existentes; no
// se calcula nada por una vía propia. Lo que este panel hace es reunirlas en
// una sola pantalla filtrada por empresa.
//
// Reglas del proyecto que se respetan aquí (cada una costó un bug en su día):
//  · Administrativos fuera: `not("admin","is",true)`, NO `neq(true)`. `admin`
//    es nullable y en Postgres `admin <> true` descarta los NULL, que son la
//    mayoría de los operativos.
//  · Cuentas de prueba fuera: hay auxiliares "PRUEBA" activos a propósito.
//  · Deduplicar por persona-día: Auxiliar Mixto tiene 2 filas el mismo día
//    (turno 1 y 2) y sin deduplicar se infla el conteo de personas.
//  · Paginar: Supabase corta en 1000 filas aunque se pida `.limit(10000)`.
//  · `empresaId` SIEMPRE explícito. `getCurrentEmpresaIdForInsert()` cae al
//    fallback 1 cuando no hay sesión, y eso mostraría datos de otra empresa.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getHorarioTolva } from "@/lib/horario-tolva-actions"
import { getDespachoKpis, getVehiculosNoProcesados } from "@/lib/pedidos-kpis-actions"
import { getControlToneladas } from "@/lib/control-toneladas-actions"
import { codigosOrdenPorUnidad } from "@/lib/ordenes-por-unidad"
import { getProgramacionResumenDia } from "@/lib/programacion-cliente-actions"
import { sumarDias } from "@/lib/programacion-cliente-calculo"
import { TON_MES_CARGUE_DESCARGUE, DIAS_OPERACION_MES } from "@/lib/meta-productividad-utils"
import type {
  CoberturaTurno,
  ItemBandeja,
  OperacionDiaData,
  OperacionHoy,
  RequisicionResumen,
} from "@/lib/operacion-dia-tipos"

/** Último día del mes. `${anio}-${mes}-31` revienta en meses de 30 (error 22008). */
function ultimoDiaDe(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate()
}

/** Rango de la quincena. Mismo criterio que revision-nomina-actions. */
function rangoQuincena(anio: number, mes: number, q: 1 | 2) {
  const p = (n: number) => String(n).padStart(2, "0")
  const diaIni = q === 1 ? 1 : 16
  const diaFin = q === 1 ? 15 : ultimoDiaDe(anio, mes)
  return { desde: `${anio}-${p(mes)}-${p(diaIni)}`, hasta: `${anio}-${p(mes)}-${p(diaFin)}` }
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** Hoy en hora de Colombia. En UTC, después de las 19:00 ya sería mañana. */
function hoyColombia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

const esPrueba = (nombre: unknown) => /prueba/i.test(String(nombre ?? ""))

/** Trae todas las filas paginando: Supabase corta en 1000 pase lo que pase. */
async function traerTodo(construir: (desde: number, hasta: number) => any): Promise<any[]> {
  const out: any[] = []
  const paso = 1000
  for (let off = 0; off < 50000; off += paso) {
    const { data, error } = await construir(off, off + paso - 1)
    if (error) throw new Error(error.message)
    const lote = data ?? []
    out.push(...lote)
    if (lote.length < paso) break
  }
  return out
}

/**
 * Todo lo que muestra el panel, en una sola llamada.
 *
 * Cada bloque va en su propio try: si una fuente falla, el panel muestra el
 * resto y lo dice en `avisos`. Un tablero directivo que enseña 0 cuando en
 * realidad no pudo leer el dato es peor que uno que admite el hueco.
 */
export async function getOperacionDia(
  empresaId: number | null | undefined,
  fechaSel?: string | null,
): Promise<{ success: boolean; data?: OperacionDiaData; message?: string }> {
  if (!empresaId) {
    return { success: false, message: "Selecciona una empresa en el selector de arriba." }
  }

  const fecha = fechaSel || hoyColombia()
  const [anio, mes, dia] = fecha.split("-").map(Number)
  const numero: 1 | 2 = dia <= 15 ? 1 : 2
  const { desde, hasta } = rangoQuincena(anio, mes, numero)
  const avisos: string[] = []

  try {
    const sb: any = await getSupabaseAdmin()

    // --- PERSONAL ACTIVO ---------------------------------------------------
    // Operativos activos de la empresa. Los administrativos no marcan turno,
    // así que no son parte de la operación del día.
    let personalActivo = 0
    try {
      const filas = await traerTodo((d, h) =>
        sb
          .from("headcount")
          .select("identificacion, nombre")
          .eq("idempresa", empresaId)
          .eq("estado", "Activo")
          .not("admin", "is", true)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      )
      personalActivo = filas.filter((r) => !esPrueba(r.nombre)).length
    } catch (e: any) {
      avisos.push("No se pudo leer el personal activo.")
      console.error("[v0] getOperacionDia headcount:", e?.message ?? e)
    }

    // Identificaciones administrativas: se descartan de TODO lo que sigue en
    // este panel (turnos de la quincena, cobertura de hoy) -- los administrativos
    // no marcan turno, no son parte de la operación del día. `admin` es
    // project-agnostic: hay administrativos con `idempresa IS NULL` (cruzan
    // varios proyectos), por eso el `.or` en vez de un simple `.eq`.
    let idsAdmin = new Set<string>()
    try {
      const filasAdmin = await traerTodo((d, h) =>
        sb
          .from("headcount")
          .select("identificacion")
          .eq("admin", true)
          .or(`idempresa.eq.${empresaId},idempresa.is.null`)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      )
      idsAdmin = new Set(filasAdmin.map((r) => String(r.identificacion ?? "").trim()))
    } catch (e: any) {
      console.error("[v0] getOperacionDia headcount admin:", e?.message ?? e)
    }

    // --- TURNOS DE LA QUINCENA --------------------------------------------
    // Un "turno programado" es una fila de registroasistencia con puesto (turno
    // operativo) o con asistencia (novedad del día). Mismo criterio que usa el
    // Panel de Gestión Humana.
    let turnosProgramadosQuincena = 0
    let cobertura = { programados: 0, cubiertos: 0, pct: 0, diasConDatos: 0 }
    try {
      const filas = await traerTodo((d, h) =>
        sb
          .from("registroasistencia")
          .select("fecha, identificacion, nombre, puesto, asistencia, turno, horaingreso")
          .eq("idempresa", empresaId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(d, h),
      )
      const vivas = filas.filter((r) => !esPrueba(r.nombre) && !idsAdmin.has(String(r.identificacion ?? "").trim()))
      const programadas = vivas.filter((r) => r.puesto != null || r.asistencia != null)
      turnosProgramadosQuincena = programadas.length

      // COBERTURA = turnos cubiertos / turnos programados, acumulado por día.
      // "Cubierto" = el turno se trabajó: tiene puesto y no tiene novedad. Una
      // fila con novedad estaba programada pero NO se cubrió; es justo lo que
      // el indicador debe castigar.
      const cubiertos = vivas.filter((r) => r.puesto != null && r.asistencia == null).length
      const dias = new Set(programadas.map((r) => r.fecha))
      cobertura = {
        programados: programadas.length,
        cubiertos,
        pct: programadas.length > 0 ? Math.round((cubiertos / programadas.length) * 100) : 0,
        diasConDatos: dias.size,
      }
    } catch (e: any) {
      avisos.push("No se pudieron leer los turnos de la quincena.")
      console.error("[v0] getOperacionDia turnos:", e?.message ?? e)
    }

    // --- COBERTURA DE HOY, POR TURNO --------------------------------------
    const turnosHoy: CoberturaTurno[] = []
    let totalHoy: CoberturaTurno = {
      turno: null, etiqueta: "Total", horario: "día completo",
      programados: 0, presentes: 0, sinMarcar: 0,
    }
    try {
      // La marcación real vive en `asistencia` (el kiosco).
      // `registroasistencia.horaingreso` es solo un sync best-effort: si se
      // programa a alguien DESPUÉS de que marcó, queda vacío para siempre.
      const [ra, kiosco] = await Promise.all([
        traerTodo((d, h) =>
          sb
            .from("registroasistencia")
            .select("identificacion, nombre, puesto, asistencia, turno")
            .eq("idempresa", empresaId)
            .eq("fecha", fecha)
            // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
            .order("id")
            .range(d, h),
        ),
        traerTodo((d, h) =>
          sb
            .from("asistencia")
            .select("identificacion")
            .eq("idempresa", empresaId)
            .eq("fecha", fecha)
            // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
            .order("id")
            .range(d, h),
        ),
      ])

      const marcaron = new Set(
        (kiosco ?? []).map((r: any) => String(r.identificacion ?? "").trim()),
      )
      const vivas = ra.filter(
        (r) =>
          !esPrueba(r.nombre) &&
          !idsAdmin.has(String(r.identificacion ?? "").trim()) &&
          (r.puesto != null || r.asistencia != null),
      )

      // Horario real de la empresa para ese día, si está configurado.
      const horarios: Record<string, string | null> = {}
      try {
        const ht = await getHorarioTolva(empresaId, fecha)
        const t1 = ht?.data?.turno1
        const t2 = ht?.data?.turno2
        if (t1?.horaInicio) horarios["1"] = `${t1.horaInicio}-${t1.horaFin}`
        if (t2?.horaInicio) horarios["2"] = `${t2.horaInicio}-${t2.horaFin}`
      } catch {
        // Sin horario configurado la tarjeta simplemente no muestra el rango.
      }

      const grupos = new Map<string, any[]>()
      for (const r of vivas) {
        const k = r.turno == null ? "u" : String(r.turno)
        grupos.set(k, [...(grupos.get(k) ?? []), r])
      }

      const armar = (clave: string, filas: any[]): CoberturaTurno => {
        const programados = filas.length
        const presentes = filas.filter(
          (r) => r.puesto != null && r.asistencia == null && marcaron.has(String(r.identificacion ?? "").trim()),
        ).length
        // "Sin marcar" son los que tenían turno y no aparecen en el kiosco.
        // Los que tienen novedad no cuentan: su ausencia ya está explicada.
        const sinMarcar = filas.filter(
          (r) => r.puesto != null && r.asistencia == null && !marcaron.has(String(r.identificacion ?? "").trim()),
        ).length
        return {
          turno: clave === "u" ? null : Number(clave),
          etiqueta: clave === "u" ? "Jornada única" : `Turno ${clave}`,
          horario: horarios[clave] ?? null,
          programados,
          presentes,
          sinMarcar,
        }
      }

      for (const clave of ["1", "2", "u"]) {
        const filas = grupos.get(clave)
        if (filas?.length) turnosHoy.push(armar(clave, filas))
      }

      // El total se cuenta por PERSONA, no por fila: quien tiene dos turnos el
      // mismo día es una sola persona en la operación.
      const porPersona = new Map<string, any[]>()
      for (const r of vivas) {
        const k = String(r.identificacion ?? "").trim()
        porPersona.set(k, [...(porPersona.get(k) ?? []), r])
      }
      let tp = 0, tpr = 0, tsm = 0
      for (const [ident, filas] of porPersona) {
        tp++
        const trabajaAlgo = filas.some((r) => r.puesto != null && r.asistencia == null)
        if (!trabajaAlgo) continue
        if (marcaron.has(ident)) tpr++
        else tsm++
      }
      totalHoy = {
        turno: null, etiqueta: "Total", horario: "día completo",
        programados: tp, presentes: tpr, sinMarcar: tsm,
      }
    } catch (e: any) {
      avisos.push("No se pudo leer la asistencia de hoy.")
      console.error("[v0] getOperacionDia asistencia:", e?.message ?? e)
    }

    // --- BANDEJA DEL DÍA ---------------------------------------------------
    const bandeja: ItemBandeja[] = []
    let novedadesAbiertas = 0
    let turnosPorAprobar = 0
    let ausentismosSinCompletar = 0

    // (a) Solicitudes de turnos y horas extra pendientes de aprobar.
    try {
      const { data } = await sb
        .from("solicitudesturnos")
        .select("id, tipo, cantidad, fecharequerida")
        .eq("idempresa", empresaId)
        .eq("estado", "pendiente")
      const n = (data ?? []).length
      turnosPorAprobar = n
      if (n > 0) {
        novedadesAbiertas += n
        bandeja.push({
          id: "turnos-pendientes",
          nivel: "medio",
          titulo: `${n} solicitud${n === 1 ? "" : "es"} de turnos u horas extra por aprobar`,
          detalle: "Mientras estén pendientes, esos turnos no entran a la programación.",
          moduloDestino: "Aprobar Turnos",
          textoBoton: "Aprobar",
        })
      }
    } catch (e: any) {
      console.error("[v0] getOperacionDia solicitudesturnos:", e?.message ?? e)
    }

    // (b) Personas que hoy marcaron o estaban programadas y siguen sin novedad
    //     asignada. Es lo que impide cerrar bien el día.
    if (totalHoy.sinMarcar > 0) {
      novedadesAbiertas += totalHoy.sinMarcar
      bandeja.push({
        id: "sin-marcar",
        nivel: totalHoy.sinMarcar > 3 ? "alto" : "medio",
        titulo: `${totalHoy.sinMarcar} persona${totalHoy.sinMarcar === 1 ? "" : "s"} sin marcar asistencia`,
        detalle: "Tenían turno programado y no registraron ingreso. Hay que marcar la novedad o confirmar la asistencia.",
        moduloDestino: "Tabla Asistencia",
        textoBoton: "Revisar",
      })
    }

    // (c) Incapacidades del control diario que quedaron en borrador.
    try {
      const { data } = await sb
        .from("ausentismosst")
        .select("id")
        .eq("idempresa", empresaId)
        .eq("estado_registro", "BORRADOR")
      const n = (data ?? []).length
      ausentismosSinCompletar = n
      if (n > 0) {
        novedadesAbiertas += n
        bandeja.push({
          id: "ausentismos-borrador",
          nivel: "medio",
          titulo: `${n} ausentismo${n === 1 ? "" : "s"} sin completar`,
          detalle: "Creados desde el control diario. Se completan registrando la novedad del trabajador.",
          // Lleva a Novedades de personal --no a Ausentismos-- porque es ahi
          // donde se registra la novedad que completa el borrador. Ausentismos
          // es la matriz de consulta, no el lugar donde se captura.
          moduloDestino: "Novedades de personal",
          textoBoton: "Completar",
        })
      }
    } catch (e: any) {
      // La columna estado_registro puede no existir en instalaciones viejas.
      console.error("[v0] getOperacionDia ausentismos:", e?.message ?? e)
    }

    // (d) Accidentes de trabajo recientes: lo más urgente que puede haber.
    try {
      const hace7 = new Date(Date.parse(`${fecha}T12:00:00Z`) - 7 * 86400000)
        .toISOString()
        .slice(0, 10)
      // OJO: los incidentes NO se filtran por empresa. SST es transversal a LIP
      // --misma información para todos los proyectos-- y así los lee hoy el
      // módulo de Investigación AT. Filtrar aquí escondería un accidente real.
      const { data } = await sb
        .from("sst_incidentes")
        .select("id, trabajador, fecha_evento, tipo, gravedad")
        .eq("tipo", "accidente")
        .gte("fecha_evento", hace7)
        .order("fecha_evento", { ascending: false })
        .limit(3)
      for (const inc of data ?? []) {
        const grave = inc.gravedad === "grave" || inc.gravedad === "mortal"
        bandeja.push({
          id: `at-${inc.id}`,
          nivel: "alto",
          titulo: `Accidente de trabajo — ${inc.trabajador ?? "sin nombre"}`,
          detalle: `${grave ? `Gravedad ${inc.gravedad}. ` : ""}Registrado el ${inc.fecha_evento}. Revisa la investigación y el reporte a la ARL.`,
          moduloDestino: "Investigación AT",
          textoBoton: "Ver caso",
        })
      }
    } catch (e: any) {
      console.error("[v0] getOperacionDia incidentes:", e?.message ?? e)
    }

    // --- REQUISICIONES DE PERSONAL ----------------------------------------
    // Se lee con empresaId EXPLÍCITO: getVacantes() usa
    // getCurrentEmpresaIdForInsert(), que cae al fallback 1 sin sesión.
    const requisiciones: RequisicionResumen[] = []
    try {
      const { data } = await sb
        .from("vacantes")
        .select("id, cargo, proyecto, headcount, estado, aprobacion_rrhh, aprobacion_operaciones")
        .eq("idempresa", empresaId)
        .order("created_at", { ascending: false })
        .limit(6)
      for (const v of data ?? []) {
        // Doble aprobación: RRHH + Operaciones. El estado global solo pasa a
        // aprobado cuando ambas lo están.
        const pasos = [v.aprobacion_rrhh, v.aprobacion_operaciones]
        const aprobadas = pasos.filter((p) => p === "aprobado").length
        const rechazada = pasos.some((p) => p === "rechazado") || v.estado === "rechazado"
        requisiciones.push({
          id: String(v.id),
          cargo: v.cargo ?? "Sin cargo",
          proyecto: v.proyecto ?? "",
          vacantes: Number(v.headcount) || 0,
          estado: rechazada ? "rechazado" : v.estado === "aprobado" ? "aprobado" : "en revisión",
          avance: rechazada
            ? "Rechazada"
            : aprobadas === 2
              ? "Aprobada por RRHH y Operaciones"
              : `${aprobadas} de 2 aprobaciones`,
          aprobadas,
          totalPasos: 2,
        })
      }
    } catch (e: any) {
      avisos.push("No se pudieron leer las solicitudes de personal.")
      console.error("[v0] getOperacionDia vacantes:", e?.message ?? e)
    }

    // --- VEHÍCULOS Y TONELADAS DE HOY ---------------------------------------
    // (Sustituye al pago de la quincena, 2026-09-30: el dinero de nómina no va
    // en el panel operativo; vive en Compensación.) Mismas fuentes que ya usan
    // Gestión de Órdenes, Vehículos por cerrar y Control de Toneladas.
    const operacionHoy: OperacionHoy = {
      ordenesHoy: 0,
      finalizadas: 0,
      sinCerrar: 0,
      enPatio: 0,
      toneladas: 0,
      metaTonDia: Math.round(((TON_MES_CARGUE_DESCARGUE[empresaId] || 0) / DIAS_OPERACION_MES) * 10) / 10,
      tiempoPromMin: null,
      auxiliares: [],
      porUnidad: { ordenes: 0, unidades: 0 },
      programacion: { usa: false, tiene: false, programados: 0, llegaron: 0, cumplidos: 0, porcentaje: null, aTiempo: null, enviadaEn: null, enviadaPorUsuario: null },
      vehiculosRegistrados: 0,
      porTipoVehiculo: [],
      porDespacho: [],
      sinCerrarDetalle: { placas: [], masAntiguoMin: null },
      disponible: false,
      mensaje: null,
    }
    // --- PROGRAMACIÓN DEL CLIENTE (SQL 211): hoy, para el chip de la tarjeta;
    // mañana, para el cierre del día. Nunca lanza (si falta la tabla, usa=false).
    const [progHoy, progManana] = await Promise.all([getProgramacionResumenDia(empresaId, fecha), getProgramacionResumenDia(empresaId, sumarDias(fecha, 1))])
    operacionHoy.programacion = progHoy
    try {
      const [kpis, patio, ton, hoyRaw, citasHoy, abiertas] = await Promise.all([
        getDespachoKpis(empresaId),
        getVehiculosNoProcesados(empresaId),
        getControlToneladas(empresaId, fecha, fecha),
        sb.from("cabeceraoc").select("ordendecargue, pesovascula, pesoorden").eq("idempresa", empresaId).eq("fechacargue", fecha).not("fincargue", "is", null).limit(500),
        // Vehículos registrados hoy en portería: por tipo y por tipo de despacho.
        sb.from("citasvehiculos").select("id, tipovehiculo, tipodespacho").eq("idempresa", empresaId).gte("fechallegada", fecha).lte("fechallegada", `${fecha}T23:59:59`).order("id", { ascending: true }).limit(1000),
        // Iniciados sin finalizar (de cualquier fecha), el más antiguo primero.
        sb.from("cabeceraoc").select("placa, fechacargue, iniciocargue").eq("idempresa", empresaId).not("iniciocargue", "is", null).is("fincargue", null).order("fechacargue", { ascending: true }).order("iniciocargue", { ascending: true }).limit(50),
      ])
      // Vehículos de hoy por tipo (Mula, Sencillo…) y por despacho (cargue propio, tercero, cliente recoge).
      const cuentaPor = (filas: any[], campo: string) => {
        const m = new Map<string, number>()
        for (const r of filas) {
          const k = String(r?.[campo] ?? "").trim() || "Sin dato"
          m.set(k, (m.get(k) ?? 0) + 1)
        }
        return [...m.entries()].map(([tipo, n]) => ({ tipo, n })).sort((a, b) => b.n - a.n || a.tipo.localeCompare(b.tipo))
      }
      const citas: any[] = citasHoy?.data ?? []
      operacionHoy.vehiculosRegistrados = citas.length
      operacionHoy.porTipoVehiculo = cuentaPor(citas, "tipovehiculo")
      operacionHoy.porDespacho = cuentaPor(citas, "tipodespacho")
      const abiertasFilas: any[] = abiertas?.data ?? []
      let masAntiguo: number | null = null
      for (const o of abiertasFilas) {
        const ts = Date.parse(`${String(o.fechacargue ?? "").slice(0, 10)}T${String(o.iniciocargue ?? "00:00:00").slice(0, 8)}-05:00`)
        if (!Number.isFinite(ts)) continue
        const min = Math.max(0, Math.round((Date.now() - ts) / 60000))
        if (masAntiguo == null || min > masAntiguo) masAntiguo = min
      }
      operacionHoy.sinCerrarDetalle = { placas: abiertasFilas.map((o) => String(o.placa ?? "")).filter(Boolean).slice(0, 6), masAntiguoMin: masAntiguo }
      // Huevos / Empaque MP de hoy: por unidad, aparte de las toneladas.
      const hoyOrds: any[] = hoyRaw?.data ?? []
      const setUnidad = await codigosOrdenPorUnidad(sb, hoyOrds.map((o) => o.ordendecargue))
      for (const o of hoyOrds) {
        if (!setUnidad.has(String(o.ordendecargue ?? "").trim())) continue
        operacionHoy.porUnidad.ordenes++
        operacionHoy.porUnidad.unidades += Number(o.pesovascula) || Number(o.pesoorden) || 0
      }
      operacionHoy.ordenesHoy = kpis.ordenesHoy
      operacionHoy.finalizadas = kpis.finalizadasHoy
      operacionHoy.sinCerrar = kpis.sinCerrar
      operacionHoy.tiempoPromMin = kpis.operacionesMedidas > 0 ? kpis.tiempoPromOperacion : null
      // Solo los que LLEGARON HOY y siguen sin procesar: el conteo total de
      // "no procesados" arrastra citas viejas (38 en Avimol el 30-sep) y no es
      // el patio de hoy.
      operacionHoy.enPatio = patio.vehiculos.filter((v) => String(v.fechallegada ?? "").startsWith(fecha)).length
      if (ton.success && ton.data) {
        operacionHoy.toneladas = Math.round(ton.data.totalToneladas * 10) / 10
        operacionHoy.auxiliares = ton.data.trabajadores
          .map((t) => ({ persona: t.persona, ton: Math.round(t.tonAcumulada * 10) / 10 }))
          .filter((t) => t.ton > 0)
          .sort((a, b) => b.ton - a.ton)
      } else if (ton.message) {
        operacionHoy.mensaje = ton.message
      }
      operacionHoy.disponible = true
    } catch (e: any) {
      operacionHoy.mensaje = e?.message || "No se pudo leer la operación de hoy."
      console.error("[v0] getOperacionDia operacionHoy:", e?.message ?? e)
    }

    // --- BANDEJA: lo de vehículos también es "requiere atención" (2026-10-02) --
    // Antes solo aparecía en las cifras y en el cierre; el coordinador debe
    // verlo en la bandeja con placas y tiempo, para actuar desde ahí.
    if (operacionHoy.disponible && operacionHoy.sinCerrar > 0) {
      const det = operacionHoy.sinCerrarDetalle
      const partes: string[] = []
      if (det.masAntiguoMin != null) {
        const m = det.masAntiguoMin
        partes.push(`el más antiguo lleva ${m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`} en proceso`)
      }
      if (det.placas.length) partes.push(det.placas.join(", ") + (operacionHoy.sinCerrar > det.placas.length ? "…" : ""))
      bandeja.push({
        id: "vehiculos-sin-cerrar",
        nivel: operacionHoy.sinCerrar >= 5 || (det.masAntiguoMin ?? 0) >= 180 ? "alto" : "medio",
        titulo: `${operacionHoy.sinCerrar} vehículo${operacionHoy.sinCerrar === 1 ? "" : "s"} iniciado${operacionHoy.sinCerrar === 1 ? "" : "s"} sin finalizar`,
        detalle: partes.join(" · ") || "Marca el fin de cargue en Centro de Coordinación",
        moduloDestino: "Centro de Coordinación",
        textoBoton: "Cerrar vehículos",
      })
    }
    if (operacionHoy.disponible && operacionHoy.enPatio > 0) {
      bandeja.push({
        id: "vehiculos-en-patio",
        nivel: operacionHoy.enPatio > 3 ? "medio" : "bajo",
        titulo: `${operacionHoy.enPatio} vehículo${operacionHoy.enPatio === 1 ? "" : "s"} en patio sin procesar`,
        detalle: "Llegaron hoy y siguen sin orden asignada",
        moduloDestino: "Registrar Vehículos",
        textoBoton: "Ver patio",
      })
    }

    // --- CIERRE DEL DÍA: ¿ya se escribió la bitácora de hoy? ----------------
    let bitacoraHoy = false
    try {
      const { count } = await sb
        .from("bitacora")
        .select("id", { count: "exact", head: true })
        .eq("idempresa", empresaId)
        .eq("fecha", fecha)
      bitacoraHoy = (count || 0) > 0
    } catch (e: any) {
      console.error("[v0] getOperacionDia bitacora:", e?.message ?? e)
    }

    return {
      success: true,
      data: {
        fecha,
        quincena: {
          anio, mes, numero, desde, hasta,
          etiqueta: `${numero === 1 ? "1 – 15" : `16 – ${ultimoDiaDe(anio, mes)}`} de ${MESES[mes - 1]}`,
        },
        personalActivo,
        turnosProgramadosQuincena,
        novedadesAbiertas,
        cobertura,
        hoy: { turnos: turnosHoy, total: totalHoy },
        bandeja: bandeja.sort((a, b) => {
          const orden = { alto: 0, medio: 1, bajo: 2 }
          return orden[a.nivel] - orden[b.nivel]
        }),
        requisiciones,
        operacionHoy,
        cierre: {
          vehiculosSinCerrar: operacionHoy.sinCerrar,
          sinMarcar: totalHoy.sinMarcar,
          turnosPorAprobar,
          ausentismosSinCompletar,
          bitacoraHoy,
          programacionManana: {
            usa: progManana.usa,
            recibida: progManana.tiene,
            aTiempo: progManana.aTiempo,
            enviadaEn: progManana.enviadaEn,
            enviadaPorUsuario: progManana.enviadaPorUsuario,
            programados: progManana.programados,
          },
        },
        avisos,
      },
    }
  } catch (e: any) {
    console.error("[v0] getOperacionDia excepción:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo cargar el panel." }
  }
}
