"use server"

/**
 * Server actions del modulo "Liquidación Tolva del día" (Producción).
 *
 * Automatiza el último paso manual del flujo "Aprobación de ingreso de
 * producción → Continuar a Tolva" (production-entries-view.tsx + tolva.tsx):
 * toma las toneladas APROBADAS del día (invtrans, tipomov='Entrada',
 * status='Aprobado') y las reparte por TURNO (1/2, ver
 * registroasistencia.turno + programacion-turnos-actions.ts) según la hora
 * real de `creado`, y genera la orden de Tolva/Tolva f en cabeceraoc +
 * detalleoc con un click ("Registrar Tolva"), replicando EXACTAMENTE la
 * fórmula y el shape de `saveTolva` (lib/orders-actions.tsx:2783-2951) para
 * que el pago (pagonomina) y el cobro (facturacion) — que ya explotan
 * cabeceraoc.auxiliares / detalleoc.toneladas por tarifaspersonal /
 * tarifasoperacion — salgan idénticos a como saldrían si se hubiera hecho
 * a mano.
 *
 * Reglas de agrupación (confirmadas con el negocio):
 *  - Solo entran ingresos YA APROBADOS (status='Aprobado').
 *  - Solo entran ingresos con `creadopor = 'LOGO'` — ver CREADOPOR_TOLVA.
 *  - El DÍA de un ingreso = invtrans.fechaprod (fecha real de producción).
 *  - Dentro de ese día, el TURNO se determina por `invtrans.horaprod` — la
 *    HORA REAL DE PRODUCCIÓN, capturada en el formulario de Ingreso de
 *    Producción — cayendo en la ventana [horaInicio, horaFin) del Turno 1 o
 *    Turno 2 configurados en `horario_tolva` (botón "Horario de Tolva" en
 *    Programación de turnos) — ventana COMPARTIDA por día+empresa,
 *    independiente del horaentradaprogramada/horasalidaprogramada normal de
 *    cada persona (que sigue siendo para asistencia/horas extra).
 *  - La fecha en que se REGISTRÓ el ingreso (`creado`) ya NO influye. Antes
 *    sí: si `creado` caía en otro día que `fechaprod` el ingreso se marcaba
 *    "atrasado" y no se asignaba a ningún turno, así que la producción de un
 *    día registrada al día siguiente desaparecía de la liquidación y la
 *    pantalla exigía una "revisión manual" que no ofrecía cómo resolver.
 *  - Los ingresos anteriores a `horaprod` no la tienen; para esos se cae a la
 *    hora de `creado` (ya sin mirar la fecha) y se marcan como hora ESTIMADA.
 *  - Si la hora cae fuera de ambas ventanas (o no hay horario_tolva
 *    configurado ese día), el ingreso queda "sin turno" — requiere revisión.
 *  - `ordentolva IS NULL` excluye ingresos que YA se metieron a una Tolva
 *    (a mano o por este módulo), evitando duplicar si se vuelve a abrir
 *    la pantalla.
 *  - Las personas asignadas a cada turno salen de `registroasistencia.turno`
 *    (1/2, puesto="Auxiliar Mixto") — solo se usa el NOMBRE, no su horario
 *    individual.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getHorarioTolva } from "@/lib/horario-tolva-actions"
import { getReversosPorIdempresa } from "@/lib/transacciones-codigo-actions"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const ORIGEN_INGRESO_PRODUCCION = "%ingreso producci%"

/**
 * Excluye la produccion PROPIA de Harinera (genera inventario pero no se
 * liquida ni se factura).
 *
 * OJO con la forma: en Postgres `tipo_produccion <> 'Harinera'` es NULL para
 * las filas nulas, que quedarían EXCLUIDAS por error — y NULL es justamente el
 * valor de todo lo historico y de todo lo que sube el LOGO. Por eso el `is.null`
 * explicito.
 */
const EXCLUIR_HARINERA = "tipo_produccion.is.null,tipo_produccion.neq.Harinera"
const PUESTO_AUXILIAR_MIXTO = "Auxiliar Mixto"

/**
 * La Tolva se liquida SOLO sobre la produccion que reporta el LOGO.
 *
 * Ese valor lo escribe el trigger `fn_sync_produccion_to_invtrans` (ver
 * scripts/125_fix_trigger_produccion_fechaprod.sql), que lo tiene fijo en 'LOGO'
 * para TODA fila que nazca de la tabla `produccion` — tanto la que sube el LOGO
 * como la que registra LIPGO por QR. Es decir: esto NO deja fuera la produccion
 * de LIPGO por QR.
 *
 * Lo que SI deja fuera son los ingresos capturados a mano en el formulario de
 * "Ingreso de Producción" (`registerProductionEntry` /
 * `registerMultipleProductionEntries` en lib/inventory-actions.ts), que guardan
 * el NOMBRE DEL USUARIO en `creadopor`. Esos siguen entrando a inventario y se
 * siguen viendo en "Aprobación de ingreso de producción"; solo dejan de
 * liquidarse como Tolva.
 *
 * OJO CON LA EMPRESA: el trigger tambien tiene fijo `idempresa = 1`, asi que no
 * existe fila con `creadopor='LOGO'` para otra empresa. Con el selector en una
 * empresa distinta de la 1 este modulo queda vacio POR DISEÑO.
 *
 * Comparacion EXACTA (`eq`) a proposito: es un valor que escribe el trigger, no
 * algo que teclee un usuario.
 */
const CREADOPOR_TOLVA = "LOGO"

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface TurnoVentanaInterna {
  horaInicio: string | null
  horaFin: string | null
  personas: string[]
}

export interface LineaProducto {
  idproducto: number | null
  codproducto: string
  nombreproducto: string
  cantidad: number
  toneladas: number
}

export interface IngresoPendienteRevision {
  id: number
  codproducto: string
  nombreproducto: string
  cantidad: number
  creado: string
  fechaprod: string
  /**
   * Ya no existe el motivo "atrasado": que el ingreso se haya REGISTRADO otro
   * dia dejo de descartarlo, porque el turno se decide con la hora real de
   * produccion (`horaprod`) y no con la de registro.
   */
  motivo: "sin_turno"
  /** Hora que se uso para intentar ubicarlo, "HH:MM". */
  horaUsada: string
  /** true cuando la hora salio de `creado` porque el ingreso no tiene `horaprod`. */
  horaEstimada: boolean
}

export interface TurnoPreview {
  turno: 1 | 2
  horaInicio: string | null
  horaFin: string | null
  personas: string[]
  lineas: LineaProducto[]
  totalToneladas: number
  invtransIds: number[]
}

export interface LiquidacionTolvaDia {
  fecha: string
  idempresa: number
  tipoOperacion: "Tolva" | "Tolva f"
  turnos: TurnoPreview[]
  pendientes: IngresoPendienteRevision[]
}

// ---------------------------------------------------------------------------
// Helpers de fecha/hora (America/Bogota)
// ---------------------------------------------------------------------------

/**
 * Fecha y minutos LITERALES de un timestamp: los digitos tal como vienen, sin
 * convertir de zona.
 *
 * Es lo que hay que usar con `produccion.fecha_hora` —y con el `creado` que el
 * trigger copia de ahi—, porque esa columna NO guarda UTC real sino la HORA DE
 * PARED DE COLOMBIA ETIQUETADA COMO UTC: `2026-08-05 13:25:40+00` significa la
 * 1:25 de la tarde en Colombia, no las 8:25. Convertirla restaria cinco horas
 * que nunca tuvo. Ver `bogotaWallAsUtcMs` en components/produccion/control-piso.tsx,
 * el modulo construido sobre esa tabla, que aplica el mismo criterio.
 */
function partesLiterales(iso: string): { fecha: string; minutos: number } | null {
  const m = String(iso ?? "").match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return null
  return { fecha: m[1], minutos: Number(m[2]) * 60 + Number(m[3]) }
}

/** Fecha (YYYY-MM-DD) y minutos-desde-medianoche de un ISO timestamp, en hora de Bogotá. */
function bogotaParts(iso: string): { fecha: string; minutos: number } {
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00"
  return {
    fecha: `${get("year")}-${get("month")}-${get("day")}`,
    minutos: Number(get("hour")) * 60 + Number(get("minute")),
  }
}

/** "HH:MM" o "HH:MM:SS" -> minutos desde medianoche. */
function horaAMinutos(t: string | null | undefined): number | null {
  if (!t) return null
  const m = String(t).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Inverso de `horaAMinutos`: 485 -> "08:05". Para mostrar la hora usada. */
function minutosAHora(minutos: number): string {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/** ¿`minutos` cae dentro de [inicio,fin)? Soporta ventanas que cruzan medianoche. */
function dentroDeVentana(minutos: number, inicio: number, fin: number): boolean {
  if (fin > inicio) return minutos >= inicio && minutos < fin
  if (fin < inicio) return minutos >= inicio || minutos < fin
  return false
}

/** Domingo (Ley) -> "Tolva f"; el resto -> "Tolva". Mismo criterio que `saveTolva`. */
function tipoOperacionTolva(fechaISO: string): "Tolva" | "Tolva f" {
  const [y, m, d] = fechaISO.split("-").map(Number)
  if (!y || !m || !d) return "Tolva"
  return new Date(y, m - 1, d).getDay() === 0 ? "Tolva f" : "Tolva"
}

// ---------------------------------------------------------------------------
// Preview del día
// ---------------------------------------------------------------------------

export async function getLiquidacionTolvaDia(
  fecha: string,
  idempresa: number,
): Promise<{ success: boolean; data?: LiquidacionTolvaDia; message?: string }> {
  if (!fecha || !idempresa) return { success: false, message: "Fecha y empresa son requeridas." }
  try {
    const admin: any = await getSupabaseAdmin()

    // 1) Ventana COMPARTIDA de Turno 1 / Turno 2 (horario_tolva, botón "Horario
    //    de Tolva" en Programación de turnos) — independiente del horario
    //    normal de cada persona. Las PERSONAS de cada turno sí salen de
    //    registroasistencia.turno (solo el nombre, no su horaentrada/salida).
    const horarioRes = await getHorarioTolva(idempresa, fecha)
    if (!horarioRes.success || !horarioRes.data) return { success: false, message: horarioRes.message }
    const horario = horarioRes.data

    const { data: prog, error: errProg } = await admin
      .from("registroasistencia")
      .select("nombre, turno")
      .eq("fecha", fecha)
      .eq("idempresa", idempresa)
      .eq("puesto", PUESTO_AUXILIAR_MIXTO)
      .in("turno", [1, 2])
    if (errProg) return { success: false, message: errProg.message }

    const ventanas = new Map<number, TurnoVentanaInterna>([
      [1, { horaInicio: horario.turno1.horaInicio, horaFin: horario.turno1.horaFin, personas: [] }],
      [2, { horaInicio: horario.turno2.horaInicio, horaFin: horario.turno2.horaFin, personas: [] }],
    ])
    for (const r of prog || []) {
      const t = Number(r.turno)
      if (t !== 1 && t !== 2) continue
      const v = ventanas.get(t)!
      const nombre = String(r.nombre || "").trim()
      if (nombre && !v.personas.includes(nombre)) v.personas.push(nombre)
    }

    // 2) Ingresos APROBADOS de ese día sin Tolva asignada.
    //
    // Se aceptan DOS formas de pertenecer al día:
    //   a) `fechaprod = fecha` — lo normal.
    //   b) `fechaprod IS NULL` pero `creado` cae dentro del día en hora Colombia.
    //
    // El (b) existe porque la produccion que sube el LOGO nacia SIN `fechaprod`:
    // el trigger `fn_sync_produccion_to_invtrans` no escribia esa columna (ver
    // scripts/125_fix_trigger_produccion_fechaprod.sql, que ya lo corrige de raiz).
    // Sin este respaldo, toda la produccion historica del LOGO queda invisible
    // aqui aunque este aprobada.
    //
    // El rango de `creado` se arma con los digitos LITERALES del timestamp, sin
    // desfase de zona. Las filas del LOGO llegan con `creado = produccion.fecha_hora`,
    // que NO guarda UTC real sino la HORA DE PARED DE COLOMBIA ETIQUETADA COMO UTC
    // (documentado en components/produccion/control-piso.tsx, ver
    // `bogotaWallAsUtcMs`). Restarle 5 horas mandaria la produccion al turno
    // equivocado y, la de antes de las 05:00, al dia anterior.
    const finDia = new Date(`${fecha}T00:00:00Z`)
    finDia.setUTCDate(finDia.getUTCDate() + 1)
    const diaSiguiente = finDia.toISOString().slice(0, 10)
    const creadoDesde = `${fecha}T00:00:00Z`
    const creadoHasta = `${diaSiguiente}T00:00:00Z`

    // Un solo `.or()` en la consulta: dos llamadas generan parametros `or=`
    // repetidos y PostgREST los resuelve de forma ambigua. El `or` se reserva
    // para la FECHA —que es lo que acota el volumen— y la exclusion de Harinera
    // se aplica abajo en JS, donde ademas se lee mas claro.
    const { data: crudos, error: errIng } = await admin
      .from("invtrans")
      .select("id, idproducto, codproducto, nombreproducto, cantidad, creado, fechaprod, horaprod, tipo_produccion")
      .eq("tipomov", "Entrada")
      .eq("status", "Aprobado")
      .eq("idempresa", idempresa)
      // Solo la produccion que viene de la tabla `produccion` (LOGO + QR de
      // LIPGO). Los ingresos tecleados a mano no se liquidan. Ver CREADOPOR_TOLVA.
      .eq("creadopor", CREADOPOR_TOLVA)
      .or(
        `fechaprod.eq.${fecha},and(fechaprod.is.null,creado.gte.${creadoDesde},creado.lt.${creadoHasta})`,
      )
      .ilike("origen", ORIGEN_INGRESO_PRODUCCION)
      .is("ordentolva", null)
    if (errIng) return { success: false, message: errIng.message }

    // La produccion PROPIA de Harinera genera inventario pero no se liquida ni
    // se factura. `null` = LIP (todo lo historico y lo que sube el LOGO).
    // Ademas, red de seguridad para la rama (b): que la fecha LITERAL de
    // `creado` sea de verdad la del dia pedido (ver `partesLiterales`).
    const ingresos = (crudos ?? []).filter((r: any) => {
      if (r.tipo_produccion === "Harinera") return false
      if (r.fechaprod) return true
      return partesLiterales(r.creado)?.fecha === fecha
    })

    // 3) Pesos por producto (peso_unitkg) para la conversión bultos->toneladas
    //    (misma fórmula exacta que saveTolva: cantidad × peso_unitkg / 1000).
    const idsProducto = Array.from(
      new Set((ingresos || []).map((r: any) => r.idproducto).filter((x: any) => x != null)),
    )
    const pesoPorProducto = new Map<number, number>()
    if (idsProducto.length > 0) {
      const { data: productos } = await admin.from("productos").select("id, peso_unitkg").in("id", idsProducto)
      for (const p of productos || []) pesoPorProducto.set(Number(p.id), Number(p.peso_unitkg) || 0)
    }

    // 3b) Reversos ("Transacciones por Código"): un ingreso mal digitado se
    // corrige con un movimiento aparte que referencia al original con
    // `[rev#<id>]` en observaciones -- la fila original NUNCA se edita ni se
    // borra. Sin descontar esto aquí, un ingreso ya anulado por Gerencia
    // General se agrupa en un turno igual y se termina PAGANDO como si fuera
    // producción real (mismo hueco encontrado y corregido 2026-09-21 en la
    // prefactura de facturación, lib/prefactura-produccion-actions.ts).
    const reversadoPorId = await getReversosPorIdempresa(idempresa)

    // 4) Clasificar cada ingreso: turno 1 / turno 2 / sin_turno.
    const pendientes: IngresoPendienteRevision[] = []
    const porTurno = new Map<number, { lineas: Map<string, LineaProducto>; ids: number[] }>([
      [1, { lineas: new Map(), ids: [] }],
      [2, { lineas: new Map(), ids: [] }],
    ])

    for (const r of ingresos || []) {
      const cantidad = Math.max(0, (Number(r.cantidad) || 0) - (reversadoPorId.get(Number(r.id)) ?? 0))
      if (cantidad <= 0) continue

      // El turno se decide con la HORA REAL DE PRODUCCION (`horaprod`), que se
      // captura en el formulario de Ingreso de Producción. La fecha en que se
      // REGISTRO el ingreso ya no importa: antes, si `creado` caia en otro dia
      // que `fechaprod`, el ingreso se marcaba "atrasado" y desaparecia de la
      // liquidacion — la produccion de un dia registrada al dia siguiente no
      // se podia liquidar y la pantalla no ofrecia como resolverlo.
      //
      // Los ingresos anteriores a este cambio no tienen `horaprod`; para esos
      // se cae a la hora de `creado` (ya sin mirar la fecha) y se marcan como
      // hora ESTIMADA, para que se puedan verificar en vez de bloquear.
      const minutosProd = horaAMinutos(r.horaprod)
      const horaEstimada = minutosProd == null
      // La hora de respaldo se lee LITERAL de `creado` (ver `partesLiterales`):
      // en las filas del LOGO esos digitos ya son hora de Colombia.
      const minutos = horaEstimada ? partesLiterales(r.creado)?.minutos ?? 0 : minutosProd!

      let turnoAsignado: number | null = null
      for (const t of [1, 2]) {
        const v = ventanas.get(t)!
        const ini = horaAMinutos(v.horaInicio)
        const fin = horaAMinutos(v.horaFin)
        if (ini == null || fin == null) continue
        if (dentroDeVentana(minutos, ini, fin)) {
          turnoAsignado = t
          break
        }
      }
      if (turnoAsignado == null) {
        pendientes.push({
          id: r.id,
          codproducto: r.codproducto,
          nombreproducto: r.nombreproducto,
          cantidad,
          creado: r.creado,
          fechaprod: r.fechaprod,
          motivo: "sin_turno",
          horaUsada: minutosAHora(minutos),
          horaEstimada,
        })
        continue
      }
      const bucket = porTurno.get(turnoAsignado)!
      bucket.ids.push(r.id)
      const key = `${r.idproducto}|${r.codproducto}`
      const pesoUnit = r.idproducto != null ? pesoPorProducto.get(Number(r.idproducto)) || 0 : 0
      const existente = bucket.lineas.get(key)
      if (existente) {
        existente.cantidad += cantidad
        existente.toneladas += (cantidad * pesoUnit) / 1000
      } else {
        bucket.lineas.set(key, {
          idproducto: r.idproducto != null ? Number(r.idproducto) : null,
          codproducto: r.codproducto,
          nombreproducto: r.nombreproducto,
          cantidad,
          toneladas: (cantidad * pesoUnit) / 1000,
        })
      }
    }

    const turnos: TurnoPreview[] = [1, 2].map((t) => {
      const v = ventanas.get(t)!
      const bucket = porTurno.get(t)!
      const lineas = Array.from(bucket.lineas.values())
      return {
        turno: t as 1 | 2,
        horaInicio: v.horaInicio,
        horaFin: v.horaFin,
        personas: v.personas,
        lineas,
        totalToneladas: lineas.reduce((a, l) => a + l.toneladas, 0),
        invtransIds: bucket.ids,
      }
    })

    return {
      success: true,
      data: {
        fecha,
        idempresa,
        tipoOperacion: tipoOperacionTolva(fecha),
        turnos,
        pendientes,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al armar la liquidación de tolva." }
  }
}

// ---------------------------------------------------------------------------
// Registrar Tolva del turno
// ---------------------------------------------------------------------------

export async function registrarTolvaTurno(
  fecha: string,
  idempresa: number,
  turno: 1 | 2,
): Promise<{ success: boolean; message?: string; id?: number; ordendecargue?: string; toneladas?: number }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Liquidación Tolva del día"], "cerrar", "Liquidar turno")
  if (motivoAccion) return { success: false, message: motivoAccion }
  if (!fecha || !idempresa || !turno) return { success: false, message: "Datos incompletos." }
  try {
    const admin: any = await getSupabaseAdmin()

    // Recalcula el preview (no confía en lo que el cliente tenía en pantalla,
    // para evitar condiciones de carrera con nuevas aprobaciones/turnos).
    //
    // Los "pendientes" (ingresos cuya hora cae fuera de ambas ventanas de
    // turno) YA NO bloquean el registro: quedan fuera de este turno y de
    // este día hasta que se revisen aparte, pero no deben impedir liquidar
    // la producción que sí está verificada y sí cayó en su ventana.
    const preview = await getLiquidacionTolvaDia(fecha, idempresa)
    if (!preview.success || !preview.data) return { success: false, message: preview.message }
    const turnoData = preview.data.turnos.find((t) => t.turno === turno)
    if (!turnoData || turnoData.lineas.length === 0) {
      return { success: false, message: "No hay ingresos aprobados para este turno." }
    }

    const tipoOperacion = preview.data.tipoOperacion

    const { data: lastHeader, error: errHeader } = await admin
      .from("cabeceraoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (errHeader) return { success: false, message: errHeader.message }
    const nextId = lastHeader ? (lastHeader.id || 0) + 1 : 1

    const auxiliaresStr = turnoData.personas.join(", ")
    const totalToneladas = turnoData.totalToneladas
    const horaFin = `${turnoData.horaFin || "23:59"}:00`

    const { error: errInsertHeader } = await admin.from("cabeceraoc").insert({
      id: nextId,
      idempresa,
      ordendecargue: `Tolva${nextId}`,
      fechaorden: fecha,
      tipooperacion: tipoOperacion,
      auxiliares: auxiliaresStr,
      status: "finalizado",
      pesoorden: totalToneladas,
      pesovascula: totalToneladas,
      fechacargue: fecha,
      fincargue: horaFin,
      horalote: horaFin,
    })
    if (errInsertHeader) return { success: false, message: `Error al crear cabecera: ${errInsertHeader.message}` }

    const { data: lastDetail, error: errDetail } = await admin
      .from("detalleoc")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (errDetail) return { success: false, message: errDetail.message }
    let nextDetailId = lastDetail ? (lastDetail.id || 0) + 1 : 1

    const detalles = turnoData.lineas.map((l) => ({
      id: nextDetailId++,
      idorden: nextId,
      numeroorden: `Tolva${nextId}`,
      producto: l.nombreproducto,
      cantidad: l.cantidad,
      toneladas: l.toneladas,
    }))
    if (detalles.length > 0) {
      const { error: errInsertDetalle } = await admin.from("detalleoc").insert(detalles)
      if (errInsertDetalle) return { success: false, message: `Error al crear detalles: ${errInsertDetalle.message}` }
    }

    if (turnoData.invtransIds.length > 0) {
      const { error: errUpdate } = await admin
        .from("invtrans")
        .update({ ordentolva: `Tolva${nextId}` })
        .in("id", turnoData.invtransIds)
      if (errUpdate) {
        return {
          success: true,
          id: nextId,
          ordendecargue: `Tolva${nextId}`,
          toneladas: totalToneladas,
          message: `Tolva creada, pero falló vincular ingresos: ${errUpdate.message}`,
        }
      }
    }

    return { success: true, id: nextId, ordendecargue: `Tolva${nextId}`, toneladas: totalToneladas }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al registrar la tolva." }
  }
}

// ---------------------------------------------------------------------------
// Auditoría: pago (nómina) vs cobro (facturación) vs entrega real (invtrans)
// ---------------------------------------------------------------------------

// Tolerancia de redondeo (bultos→toneladas, varios productos) antes de marcar
// una fecha como discrepancia real entre lo entregado y lo facturado.
const TOLERANCIA_TONELADAS = 0.05

export interface AuditoriaTolvaDia {
  fecha: string
  entregaToneladas: number
  facturadoToneladas: number
  diferenciaToneladas: number // entrega − facturado (con signo)
  discrepancia: boolean
  pago: number
  cobro: number
  ordenesSinPersonal: number
}

export async function getAuditoriaTolva(
  desde: string,
  hasta: string,
  idempresa: number,
): Promise<{ success: boolean; data: AuditoriaTolvaDia[]; message?: string }> {
  if (!desde || !hasta || !idempresa)
    return { success: false, data: [], message: "Rango de fechas y empresa son requeridos." }
  try {
    const admin: any = await getSupabaseAdmin()

    // 1) Entrega real: invtrans aprobados del rango, agrupados por fechaprod.
    const { data: ingresos, error: errIng } = await admin
      .from("invtrans")
      .select("id, idproducto, cantidad, fechaprod")
      .eq("tipomov", "Entrada")
      .eq("status", "Aprobado")
      .eq("idempresa", idempresa)
      // Mismo filtro que el preview. Sin esto, un ingreso capturado a mano
      // aparecería para siempre como diferencia entre lo aprobado y lo
      // facturado, porque este modulo ya no le crea orden de Tolva.
      .eq("creadopor", CREADOPOR_TOLVA)
      .gte("fechaprod", desde)
      .lte("fechaprod", hasta)
      .ilike("origen", ORIGEN_INGRESO_PRODUCCION)
      // Misma exclusion que el preview. Sin esto la produccion de Harinera
      // aparecería para siempre como diferencia entre lo aprobado y lo
      // facturado, porque nunca va a tener una orden de Tolva.
      .or(EXCLUIR_HARINERA)
    if (errIng) return { success: false, data: [], message: errIng.message }

    const idsProducto = Array.from(
      new Set((ingresos || []).map((r: any) => r.idproducto).filter((x: any) => x != null)),
    )
    const pesoPorProducto = new Map<number, number>()
    if (idsProducto.length > 0) {
      const { data: productos } = await admin.from("productos").select("id, peso_unitkg").in("id", idsProducto)
      for (const p of productos || []) pesoPorProducto.set(Number(p.id), Number(p.peso_unitkg) || 0)
    }
    // Reversos: la "entrega real" no puede incluir lo que Gerencia General ya
    // anuló por un error de digitación -- mismo hueco y mismo fix que en
    // getLiquidacionTolvaDia / lib/prefactura-produccion-actions.ts.
    const reversadoPorId = await getReversosPorIdempresa(idempresa)
    const entregaPorFecha = new Map<string, number>()
    for (const r of ingresos || []) {
      const peso = r.idproducto != null ? pesoPorProducto.get(Number(r.idproducto)) || 0 : 0
      const cantidad = Math.max(0, (Number(r.cantidad) || 0) - (reversadoPorId.get(Number(r.id)) ?? 0))
      const ton = (cantidad * peso) / 1000
      const f = String(r.fechaprod).slice(0, 10)
      entregaPorFecha.set(f, (entregaPorFecha.get(f) || 0) + ton)
    }

    // 2) Órdenes de Tolva/Tolva f del rango (pago + cobro nacen de aquí).
    const { data: ordenes, error: errOrd } = await admin
      .from("cabeceraoc")
      .select("id, fechaorden, tipooperacion, auxiliares, pesoorden, pesovascula")
      .eq("idempresa", idempresa)
      .in("tipooperacion", ["Tolva", "Tolva f"])
      .gte("fechaorden", desde)
      .lte("fechaorden", hasta)
    if (errOrd) return { success: false, data: [], message: errOrd.message }

    const idsOrden = (ordenes || []).map((o: any) => o.id)
    const toneladasPorOrden = new Map<number, number>()
    if (idsOrden.length > 0) {
      const { data: detalles } = await admin.from("detalleoc").select("idorden, toneladas").in("idorden", idsOrden)
      for (const d of detalles || []) {
        toneladasPorOrden.set(
          Number(d.idorden),
          (toneladasPorOrden.get(Number(d.idorden)) || 0) + (Number(d.toneladas) || 0),
        )
      }
    }

    const { data: tarifasPersonal } = await admin
      .from("tarifaspersonal")
      .select("operacion, tarifa, fechaini, fechafin")
      .eq("empresaid", idempresa)
      .in("operacion", ["Tolva", "Tolva f"])
    const { data: tarifasOperacion } = await admin
      .from("tarifasoperacion")
      .select("operacion, tarifa, fechainicio, fechafin")
      .eq("empresaid", idempresa)
      .in("operacion", ["Tolva", "Tolva f"])

    function tarifaVigente(tarifas: any[], operacion: string, fecha: string, colDesde: string, colHasta: string): number {
      const fila = (tarifas || []).find(
        (t) => t.operacion === operacion && String(t[colDesde]).slice(0, 10) <= fecha && String(t[colHasta]).slice(0, 10) >= fecha,
      )
      return fila ? Number(fila.tarifa) || 0 : 0
    }

    const porFecha = new Map<string, AuditoriaTolvaDia>()
    const getRow = (f: string): AuditoriaTolvaDia => {
      if (!porFecha.has(f))
        porFecha.set(f, {
          fecha: f,
          entregaToneladas: 0,
          facturadoToneladas: 0,
          diferenciaToneladas: 0,
          discrepancia: false,
          pago: 0,
          cobro: 0,
          ordenesSinPersonal: 0,
        })
      return porFecha.get(f)!
    }
    for (const [f, ton] of entregaPorFecha) getRow(f).entregaToneladas += ton

    for (const o of ordenes || []) {
      const f = String(o.fechaorden).slice(0, 10)
      const row = getRow(f)
      const toneladas = toneladasPorOrden.get(Number(o.id)) ?? (Number(o.pesovascula) || Number(o.pesoorden) || 0)
      const tieneAuxiliares = String(o.auxiliares || "").trim().length > 0
      const tarifaPago = tarifaVigente(tarifasPersonal || [], o.tipooperacion, f, "fechaini", "fechafin")
      const tarifaCobro = tarifaVigente(tarifasOperacion || [], o.tipooperacion, f, "fechainicio", "fechafin")
      row.pago += tieneAuxiliares ? toneladas * tarifaPago : 0
      row.cobro += toneladas * tarifaCobro
      // Toneladas FACTURADAS = mismas toneladas de detalleoc que valorizan el
      // cobro (Σ detalleoc.toneladas de las órdenes Tolva/Tolva f del día) —
      // es la comparación pedida: lo entregado (invtrans) vs. lo facturado.
      row.facturadoToneladas += toneladas
      if (!tieneAuxiliares) row.ordenesSinPersonal += 1
    }

    // Diferencia + alerta de discrepancia (entrega vs. facturado), con
    // tolerancia de redondeo por conversión bultos→toneladas.
    for (const row of porFecha.values()) {
      row.diferenciaToneladas = row.entregaToneladas - row.facturadoToneladas
      row.discrepancia = Math.abs(row.diferenciaToneladas) > TOLERANCIA_TONELADAS
    }

    const data = Array.from(porFecha.values()).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    return { success: true, data }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al calcular la auditoría." }
  }
}
