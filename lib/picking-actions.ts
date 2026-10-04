"use server"

import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getColombiaDateTime, getColombiaTime } from "@/lib/date-utils"
import { getCurrentEmpresaIdForInsert, getCurrentEmpresaId } from "@/lib/company-filter"
import { normalizeName } from "@/lib/nomina-calculo-utils"
import { getHorarioTolva, type HorarioTolvaDia } from "@/lib/horario-tolva-actions"
import { esProductoPorUnidad } from "@/lib/facturacion-billed-party"
import {
  decidirConfirmacion,
  esLoteAlterno,
  esPorDescontar,
  itemsPorProcesar,
  textoYaVerificada,
  type FilaSalida,
} from "@/lib/picking-estado"

export interface PendingLoadOrder {
  id: number
  ordendecargue: string
  cliente: string
  placa: string
  conductor: string
  fechaorden?: string
  fechacargue?: string
  iniciocargue?: string
  fotospicking?: string | null
  doccargue?: string | null // Added doccargue field to check if PDF already generated
  horapicking?: string | null // Added horapicking field to check if picking already done
  /**
   * Personal asignado a la orden (string CSV con los nombres
   * concatenados). Lo usamos como "marcador" del paso de asignacion
   * en la nueva secuencia: PDF -> Personal -> Fotos. Si esta vacio o
   * null significa que aun no se asigno personal.
   */
  auxiliares?: string | null
  /**
   * Hora en que se cerro la orden. Antes se escribia al asignar
   * personal pero ahora la responsabilidad es del cargue de fotos
   * (ultimo paso del nuevo flujo). Lo exponemos para poder deshabilitar
   * acciones cuando la orden ya esta cerrada.
   */
  fincargue?: string | null
  /**
   * ¿Se factura este cargue? Se decide en Picking. Encendido por defecto
   * (`null`/`true`); se DESMARCA cuando el personal que carga NO es de LIP (el
   * vehículo trae los suyos) → `false` = ese cargue no aparece en Gestión de Facturas.
   */
  facturar?: boolean | null
  /**
   * Modo de pago elegido para esta orden: 'individual' respeta `auxiliares`
   * tal cual lo asignó el coordinador; 'global' hace que el sistema calcule
   * y sobrescriba `auxiliares` al cerrar. Obligatorio antes de poder cerrar
   * (aplicado server-side en /api/upload-picking-photos, no solo en la UI).
   */
  tipo_pago?: "global" | "individual" | null
}

export interface PersonnelEmployee {
  id: number
  nombreempleado: string
}

export interface PickingItem {
  id: number
  nombreproducto: string
  lote: string
  location: string
  cantidad: number
  stock_disp?: number
  stock_restante?: number
  status?: string
  codproducto?: string
  /**
   * true cuando ese producto/lote/location tiene existencias en estibas con QR.
   * Solo alimenta un AVISO en la UI: descontar sin escanear deja la salida sin
   * `qrestiba` y el stock intacto en la estiba, pero no se impide.
   */
  tieneStockQR?: boolean
}

export interface QRPalletInfo {
  idqr: number
  codproducto: string
  nombreproducto: string
  lote: string
  location: string
  stock_total: number
}

// ---------------------------------------------------------------------------
// Inventario en estibas con QR
// ---------------------------------------------------------------------------

/** Clave normalizada producto|lote|location para cruzar contra las estibas. */
function claveQR(cod: unknown, lote: unknown, loc: unknown): string {
  return [cod, lote, loc]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .join("|")
}

/**
 * Devuelve las claves producto|lote|location que TIENEN stock en estibas
 * identificadas con QR.
 *
 * Para que sirve: si el stock de una linea de picking vive en estibas con QR y
 * se descuenta SIN escanear, la salida queda sin `qrestiba` y el inventario por
 * estiba no se mueve — o sea, la estiba conserva un stock que fisicamente ya
 * salio. Ese descuadre es el que este chequeo evita.
 *
 * FALLA-ABIERTO a proposito: si la consulta a la vista falla, se devuelve un
 * set vacio y el picking NO se bloquea. Bloquear toda la operacion por un fallo
 * de lectura seria peor que el descuadre que se intenta prevenir; queda el log
 * para diagnosticarlo.
 */
async function clavesConStockQR(
  supabase: any,
  filas: { codproducto?: string | null; lote?: string | null; location?: string | null }[],
): Promise<Set<string>> {
  const codigos = Array.from(
    new Set(filas.map((f) => String(f.codproducto ?? "").trim()).filter(Boolean)),
  )
  if (codigos.length === 0) return new Set()

  const { data, error } = await supabase
    .from("view_inventario_por_estiba")
    .select("codproducto, lote, location, stock_total")
    .in("codproducto", codigos)

  if (error) {
    console.error("[v0] Error consultando inventario por estiba:", error)
    return new Set()
  }

  const claves = new Set<string>()
  for (const r of data || []) {
    if ((Number(r.stock_total) || 0) <= 0) continue
    claves.add(claveQR(r.codproducto, r.lote, r.location))
  }
  return claves
}

export async function searchPalletByQR(qrCode: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("view_inventario_por_estiba")
    .select("codproducto, nombreproducto, lote, location, stock_total")
    .eq("idqr", qrCode)

  if (error) {
    console.error("[v0] Error searching pallet by QR:", error)
    return { success: false, data: null, message: error.message }
  }

  if (!data || data.length === 0) {
    return { success: false, data: null, message: "No se encontró información para este código QR" }
  }

  return {
    success: true,
    data: data.map((item) => ({
      idqr: Number.parseInt(qrCode),
      ...item,
    })),
    message: "Información de estiba encontrada",
  }
}

export async function registerQRPickingMovements(
  qrMovements: Array<{
    idqr: number
    codproducto: string
    nombreproducto: string
    lote: string
    cantidad: number
    location: string
  }>,
) {
  const supabase = await createClient()

  try {
    // Insert records into qrestibadetalle
    const detailRecords = qrMovements.map((movement) => ({
      idqr: movement.idqr,
      codproducto: movement.codproducto,
      nombreproducto: movement.nombreproducto,
      lote: movement.lote,
      cantidad: movement.cantidad,
      location: movement.location,
      tipomov: "salida",
    }))

    const { error } = await supabase.from("qrestibadetalle").insert(detailRecords)

    if (error) {
      console.error("[v0] Error registering QR picking movements:", error)
      return { success: false, message: error.message }
    }

    console.log("[v0] QR picking movements registered successfully")
    return { success: true, message: "Movimientos de QR registrados exitosamente" }
  } catch (error: any) {
    console.error("[v0] Error in registerQRPickingMovements:", error)
    return { success: false, message: error.message || "Error al registrar movimientos de QR" }
  }
}

export async function getPendingLoadOrders(selectedEmpresaId?: number | null) {
  const supabase = await createClient()

  const empresaId = selectedEmpresaId || await getCurrentEmpresaId()

  if (!empresaId) {
    console.error("[v0] No empresa ID found for current user")
    return { success: false, data: [], message: "No se encontró información de empresa" }
  }

  const { data, error } = await supabase
    .from("cabeceraoc")
    .select(
      "id, ordendecargue, placa, conductor, fechaorden, fechacargue, iniciocargue, fotospicking, doccargue, horapicking, auxiliares, fincargue, facturar, tipo_pago",
    )
    .eq("idempresa", empresaId) // Filter by empresa from session
    .eq("tipooperacion", "Cargue") // Only show Cargue operations
    .is("fincargue", null) // Solo pendientes; al finalizar el proceso desaparece (igual que todas)
    // Solo exige lote (vehículo + lote) — Picking es una actividad de
    // bodega que se hace ANTES de que llegue el vehículo, independiente de
    // a qué muelle se asigne después. El muelle es una decisión del
    // coordinador en Centro de Coordinación, en otro momento; no debe
    // bloquear que el montacarguista haga Picking/PDF apenas haya lote.
    .not("horalote", "is", null)
    .order("ordendecargue", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching pending load orders:", error)
    return { success: false, data: [], message: error.message }
  }

  // Get unique clientes from detalleoc for each order
  const ordersWithClients = await Promise.all(
    (data || []).map(async (order) => {
      const { data: detailData } = await supabase
        .from("detalleoc")
        .select("cliente")
        .eq("idorden", order.id)
        .limit(1)
        .single()

      return {
        ...order,
        cliente: detailData?.cliente || "Sin cliente",
      }
    }),
  )

  return { success: true, data: ordersWithClients, message: "Órdenes cargadas exitosamente" }
}

export async function getLoadOrderProducts(orderId: number, ordenCargue: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("invtrans")
    .select("nombreproducto, location, lote, cantidad")
    .eq("ocargue", ordenCargue)
    .order("nombreproducto", { ascending: true })

  if (error) {
    console.error("[v0] Error fetching load order products:", error)
    return { success: false, data: [], message: error.message }
  }

  return { success: true, data: data || [], message: "Productos cargados exitosamente" }
}

export async function getCarguDescarguePersonnel(empresaId?: number | null) {
  const supabase = await createClient()

  let finalEmpresaId = empresaId
  if (!finalEmpresaId) {
    finalEmpresaId = await getCurrentEmpresaId()
  }

  const colombiaDate = await getColombiaDateTime()
  const todayDate = colombiaDate.toLocaleDateString("en-CA") // Format: YYYY-MM-DD

  // Personal disponible para Picking / Packing del dia.
  //
  // Fuente directa: `registroasistencia`. Anteriormente se leia de
  // `asignacionpersonal`, pero en la practica esa tabla no se esta
  // poblando para todos los flujos (lo que dejaba a Picking sin
  // personal disponible). `registroasistencia` SI se escribe siempre
  // que el supervisor guarda turnos en "Tabla Asistencia / Registro
  // de Asistencia".
  //
  // Filtros:
  //   1) `fecha = hoy (Bogota)`.
  //   2) `puesto IN (...)` con los puestos operativos que pueden
  //      apoyar el alistamiento, segun requerimiento de negocio.
  //   3) Se excluyen filas que tienen `asistencia` (codigo de novedad)
  //      porque corresponden a Ausentes; un Ausente no debe aparecer
  //      como personal disponible aun si quedo un `puesto` historico.
  //   4) `horaingreso IS NOT NULL`: "Programacion de turnos" precrea la
  //      fila del dia con `puesto` + `horaentradaprogramada` (la hora
  //      PROGRAMADA) pero SIN `horaingreso` — la persona todavia no ha
  //      confirmado que llego (ni por camara en el kiosko de asistencia,
  //      ni porque el supervisor la marco presente en Tabla Asistencia,
  //      que es lo unico que escribe `horaingreso`). Sin este filtro,
  //      alguien programado pero que nunca se presento aparecia igual
  //      como disponible para asignar a una orden. Verificado con datos
  //      reales: 2026-08-06 tenia 41 candidatos, 1 sin horaingreso.
  //   4b) `horasalida IS NULL`: si ya marco salida real (checkout del dia),
  //      ya no esta en el proyecto — no puede seguir apareciendo como
  //      disponible aunque su `horasalidaprogramada` todavia no llegue.
  //      Aplica a los 4 proyectos. Confirmado por el usuario 2026-08-29.
  //   5) Puesto distinto de "Cargue/Descargue" con turno en curso: si la
  //      persona esta programada hoy en Tolva Bulto/Tolva Planchador/
  //      Auxiliar Mixto, esta cumpliendo esa actividad (que en el caso de
  //      Auxiliar Mixto incluye tolva Y cargue dentro del mismo turno
  //      programado) y NO debe ofrecerse para que el coordinador la
  //      asigne aparte hasta que su turno programado termine
  //      (`horasalidaprogramada`). Se compara contra la hora PROGRAMADA,
  //      no contra una marcacion real de salida (esa no siempre existe
  //      mientras el turno esta en curso). Si no quedo registrada
  //      `horasalidaprogramada` no se puede aplicar la regla y la persona
  //      se deja disponible (comportamiento previo), como corresponde a
  //      un dato incompleto y no a una regla de negocio.
  //
  // Mapeo de columnas para mantener el contrato `{ id, nombreempleado }`
  // que el componente Picking ya consume:
  //   - `id`             <- `registroasistencia.id`
  //   - `nombreempleado` <- `registroasistencia.nombre`
  // "Auxiliar Mixto" es el nombre de puesto mixto (tolva + cargue) en ID1.
  // En ID2 el mismo concepto de tolva se registra con otros nombres de
  // puesto — "Estibado PT" y "Salvado" — y funcionan igual: ocupados solo
  // durante SU ventana de tolva, disponibles para cargue fuera de ella.
  // Confirmado por el usuario 2026-08-29. NO se agregan para otros IDs (ese
  // mismo puesto no representa lo mismo ahí — ver PUESTOS_MIXTOS_TOLVA).
  const PUESTOS_MIXTOS_TOLVA = finalEmpresaId === 2 ? ["Auxiliar Mixto", "Estibado PT", "Salvado"] : ["Auxiliar Mixto"]
  const PUESTOS_PICKING = ["Cargue/Descargue", "Tolva Bulto", "Tolva Planchador", ...PUESTOS_MIXTOS_TOLVA]

  let query = supabase
    .from("registroasistencia")
    .select("id, nombre, puesto, horasalidaprogramada, turno")
    .in("puesto", PUESTOS_PICKING)
    .eq("fecha", todayDate)
    .is("asistencia", null) // Excluye Ausentes con codigo de novedad
    .not("horaingreso", "is", null) // Excluye programados que no han confirmado llegada
    .is("horasalida", null) // Excluye a quien ya marco salida real: ya salio del proyecto hoy
    .order("nombre", { ascending: true })

  if (finalEmpresaId) {
    query = query.eq("idempresa", finalEmpresaId)
  }

  const { data, error } = await query

  if (error) {
    console.error("[v0] Error fetching personnel:", error)
    return { success: false, data: [], message: error.message }
  }

  const horaActual = colombiaDate.toTimeString().slice(0, 5) // "HH:MM"

  // Horario de Tolva del día (compartido por TURNO, no por persona — tabla
  // `horario_tolva`, ver lib/horario-tolva-actions.ts). El Auxiliar Mixto solo
  // está ocupado en tolva DENTRO de esa ventana; fuera de ella (antes de que
  // empiece o después de que termine) está disponible para cargue. Antes se
  // comparaba contra `horasalidaprogramada` de la persona (fin de TODO su
  // turno de asistencia, ej. 20:00 en turno 2) — la trataba como ocupada
  // desde que entra hasta esa hora, aunque la tolva real de su turno sea
  // mucho más corta. Caso real detectado 2026-08-27, ID1: turno 2 entra ~9am
  // pero su tolva es 13:00-20:00 — de 9 a 13 debía estar disponible y no
  // aparecía.
  let horarioTolvaHoy: HorarioTolvaDia | null = null
  if (finalEmpresaId) {
    const hr = await getHorarioTolva(finalEmpresaId, todayDate)
    if (hr.success && hr.data) horarioTolvaHoy = hr.data
  }

  // 6) Ya asignado en una orden ACTIVA de HOY (mismo muelle sin cerrar,
  //    fechacargue = hoy): se descuenta de disponibles mientras dure ese
  //    proceso. Antes esto solo aplicaba a pago 'individual' — porque en
  //    'global' el coordinador necesitaba poder teclear a la misma gente en
  //    varias órdenes para forzar el reparto parejo. Eso ya no hace falta:
  //    en 'global' el sistema calcula y escribe el roster solo, al cerrar
  //    (ver computarRosterPagoGlobal) — la asignación manual en Centro de
  //    Coordinación ahora es SIEMPRE la asignación real por muelle
  //    (trazabilidad), sin importar el modo de pago, así que debe
  //    comportarse igual en los dos modos: exclusiva mientras el muelle
  //    siga abierto.
  //
  //    Filtro por `fechacargue = hoy`: un vehículo puede no terminar hoy y
  //    cerrar mañana (ej. una mula de descargue larga que cruza medianoche)
  //    — eso puede pasar. Mientras esa orden siga con `fechacargue` de hoy
  //    sigue bloqueando a su personal (está en pleno proceso). Pero si su
  //    `fechacargue` ya no es hoy (quedó rezagada de un día anterior, o fue
  //    programada para un día siguiente), no debe seguir consumiendo el HC
  //    del día actual — ese personal ya tiene asistencia de HOY y debe
  //    quedar disponible para asignarse a otro servicio de hoy. Caso real
  //    detectado 2026-08-27, ID4: orden de descargue con fechacargue de
  //    mañana dejaba sin candidatos a "Personal disponible" todo el día.
  const asignadosActivos = new Set<string>()
  if (finalEmpresaId) {
    const { data: activas } = await supabase
      .from("cabeceraoc")
      .select("auxiliares")
      .eq("idempresa", finalEmpresaId)
      .eq("fechacargue", todayDate)
      .is("fincargue", null)
    for (const o of activas ?? []) {
      for (const n of String(o.auxiliares || "").split(",")) {
        const t = n.trim()
        if (t) asignadosActivos.add(normalizeName(t))
      }
    }
  }

  const disponiblesAhora = (data ?? []).filter((r) => {
    if (asignadosActivos.has(normalizeName(r.nombre))) return false
    if (r.puesto === "Cargue/Descargue") return true
    if (PUESTOS_MIXTOS_TOLVA.includes(r.puesto) && horarioTolvaHoy) {
      const ventana = Number(r.turno) === 2 ? horarioTolvaHoy.turno2 : horarioTolvaHoy.turno1
      if (ventana.horaInicio && ventana.horaFin) {
        const dentroDeTolva = horaActual >= ventana.horaInicio && horaActual < ventana.horaFin
        return !dentroDeTolva
      }
    }
    // Respaldo: Tolva Bulto/Planchador (su turno completo ES tolva) o
    // cualquier puesto mixto de tolva (PUESTOS_MIXTOS_TOLVA) sin Horario de
    // Tolva configurado ese día — mismo criterio de siempre contra su
    // propio turno de asistencia.
    const horaSalidaProgramada = (r.horasalidaprogramada || "").toString().slice(0, 5)
    if (!horaSalidaProgramada) return true // sin dato programado: se deja como antes
    return horaActual >= horaSalidaProgramada // solo disponible cuando termina su turno programado
  })

  // Adaptamos el shape al contrato esperado por el componente
  // (`nombreempleado` en vez de `nombre`).
  const mapped = disponiblesAhora.map((r) => ({
    id: r.id,
    nombreempleado: r.nombre,
  }))

  return {
    success: true,
    data: mapped,
    message: "Personal cargado exitosamente",
  }
}

/**
 * Roster de "Pago Global": nombres ELEGIBLES presentes ese día para
 * idempresa/fecha, deduplicados, listos para escribir en `auxiliares`.
 *
 * NO reutiliza `getCarguDescarguePersonnel` (esa sirve para "disponible
 * para asignar ahora" — trae Tolva Bulto/Planchador, que nunca deben
 * cobrar cargue) ni `esPuestoCargueDescargue` de meta-productividad-utils.ts
 * tal cual está (esa solo agrupa Auxiliar Mixto con ID1, y aquí aplica en
 * los 4 proyectos — es una regla propia de nómina, no se toca la de meta).
 *
 * Elegibilidad:
 *   - Puesto "Cargue/Descargue" → siempre elegible.
 *   - Puesto "Auxiliar Mixto" → elegible solo si está FUERA de la ventana del
 *     Horario de Tolva de su turno (`horario_tolva`, ver
 *     lib/horario-tolva-actions.ts) — antes de que empiece o después de que
 *     termine. Si ese día no hay Horario de Tolva configurado, respaldo con
 *     `horasalidaprogramada` (fin de su turno completo) — mismo
 *     campo/lógica que ya usa `getCarguDescarguePersonnel` para "Personal
 *     disponible".
 *   - Cualquier otro puesto → no elegible.
 *
 * Deduplica por nombre normalizado: una persona puede tener 2 filas el
 * mismo día (turno 1/2, típico de Auxiliar Mixto) — sin deduplicar
 * quedaría 2 veces en el CSV y `cantidad_auxiliares` la contaría doble,
 * pagándole el doble de su parte real a costa de los demás.
 */
export async function computarRosterPagoGlobal(idempresa: number, fecha: string): Promise<string[]> {
  const supabase = await getSupabaseAdmin()
  const { data, error } = await supabase
    .from("registroasistencia")
    .select("nombre, puesto, horasalidaprogramada, turno")
    .eq("idempresa", idempresa)
    .eq("fecha", fecha)
    .is("asistencia", null)
    .not("horaingreso", "is", null)

  if (error) {
    console.error("[v0] Error computando roster de pago global:", error)
    return []
  }

  const colombiaDate = await getColombiaDateTime()
  const horaActual = colombiaDate.toTimeString().slice(0, 5)

  let horarioTolvaHoy: HorarioTolvaDia | null = null
  const hr = await getHorarioTolva(idempresa, fecha)
  if (hr.success && hr.data) horarioTolvaHoy = hr.data

  const vistos = new Set<string>()
  const roster: string[] = []
  for (const r of data ?? []) {
    const puesto = String(r.puesto || "").trim()
    let elegible = false
    if (puesto === "Cargue/Descargue") {
      elegible = true
    } else if (puesto === "Auxiliar Mixto") {
      const ventana = horarioTolvaHoy && (Number(r.turno) === 2 ? horarioTolvaHoy.turno2 : horarioTolvaHoy.turno1)
      if (ventana && ventana.horaInicio && ventana.horaFin) {
        elegible = !(horaActual >= ventana.horaInicio && horaActual < ventana.horaFin)
      } else {
        const horaSalidaProgramada = (r.horasalidaprogramada || "").toString().slice(0, 5)
        elegible = !horaSalidaProgramada || horaActual >= horaSalidaProgramada
      }
    }
    if (!elegible) continue

    const nombre = String(r.nombre || "").trim()
    if (!nombre) continue
    // "SIN AUXILIAR" es un marcador (no una persona real) que se usa para
    // cerrar órdenes sin ayudante de LIP — no debe entrar al reparto de
    // pago Global, ni sumar ni restar.
    if (nombre.toUpperCase() === "SIN AUXILIAR") continue
    const key = normalizeName(nombre)
    if (vistos.has(key)) continue
    vistos.add(key)
    roster.push(nombre)
  }
  return roster
}

/**
 * true si esta orden es un DESCARGUE en ID2 (Avimol) de un producto que se
 * factura por UNIDAD (hoy: Huevos, ver esProductoPorUnidad en
 * facturacion-billed-party.ts). Ese personal se paga aparte (puesto
 * "Cargue/Descargue Huevos"), no por destajo de esta orden puntual — no
 * exige tipo de pago ni personal asignado para poder cerrarla.
 *
 * Confirmado por el usuario 2026-08-28. Alcance ESTRICTO a propósito: SOLO
 * Descargue (no Cargue/Distribución) + ID2 + producto por unidad — hoy ese
 * descargue solo existe en ID2. El resto de descargues (cualquier otro
 * producto, cualquier otro proyecto) sigue exigiendo tipo de pago y
 * personal exactamente igual que hoy — no tocar esa parte.
 */
export async function esDescargueSinPersonalRequerido(
  supabase: any,
  orderId: number,
  idempresa: number | string | null | undefined,
  tipooperacion: string | null | undefined,
): Promise<boolean> {
  if (Number(idempresa) !== 2 || tipooperacion !== "Descargue") return false
  const { data: detalle } = await supabase.from("detalleoc").select("producto").eq("idorden", orderId)
  const nombres = [...new Set((detalle ?? []).map((d: any) => String(d.producto || "").trim()).filter(Boolean))]
  if (nombres.length === 0) return false
  const { data: prods } = await supabase.from("productos").select("subcategoria").in("nombre", nombres)
  return (prods ?? []).some((p: any) => esProductoPorUnidad(p.subcategoria))
}

/** Elige el modo de pago de la orden. Obligatorio antes de poder cerrarla (ver upload-picking-photos/route.ts). */
export async function setTipoPagoOrden(
  orderId: number,
  tipoPago: "global" | "individual",
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient()
  const { data: orderRow } = await supabase.from("cabeceraoc").select("fincargue").eq("id", orderId).single()
  if (orderRow?.fincargue) return { success: false, message: "La orden ya está cerrada" }
  const { error } = await supabase.from("cabeceraoc").update({ tipo_pago: tipoPago }).eq("id", orderId)
  if (error) return { success: false, message: error.message }
  return { success: true, message: tipoPago === "global" ? "Pago Global seleccionado" : "Pago Individual seleccionado" }
}

/**
 * Elige el modo de carga (Estibado o Arrume negro) de la orden. Obligatorio
 * antes de cerrar SOLO en Cargue de ID1/ID2 (ver esModoCargaRequerido en
 * upload-picking-photos/route.ts) — es donde existe la práctica real de
 * arrume negro. Confirmado por el usuario 2026-08-29.
 */
export async function setModoCargaOrden(
  orderId: number,
  modoCarga: "Estibado" | "Arrume",
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient()
  const { data: orderRow } = await supabase.from("cabeceraoc").select("fincargue").eq("id", orderId).single()
  if (orderRow?.fincargue) return { success: false, message: "La orden ya está cerrada" }
  const { error } = await supabase.from("cabeceraoc").update({ modo_carga: modoCarga }).eq("id", orderId)
  if (error) return { success: false, message: error.message }
  return { success: true, message: modoCarga === "Estibado" ? "Estibado seleccionado" : "Arrume seleccionado" }
}

export async function assignPersonnelToOrder(
  orderId: number,
  employeeNames: string[],
  auxiliaresText: string,
  currentUserName: string,
  orderData: PendingLoadOrder,
) {
  const supabase = await createClient()
  const supabaseAdmin = await getSupabaseAdmin()

  // Una Distribución ("+D" o manual) marcada "No Facturar" no debe llevar
  // auxiliares (si no se factura, no se paga la entrega — ver
  // esDistribucionNoFacturable en components/packing.tsx). El botón ya
  // queda deshabilitado en la UI, pero eso es solo comodidad visual: se
  // vuelve a consultar el estado REAL en la base (no lo que mandó el
  // cliente) para que esta acción nunca pueda asignar personal a una orden
  // así, sin importar por dónde se llame.
  const { data: ordenActual } = await supabase
    .from("cabeceraoc")
    .select("tipooperacion, facturar")
    .eq("id", orderId)
    .maybeSingle()
  if (ordenActual?.tipooperacion === "Distribucion" && ordenActual.facturar === false) {
    return {
      success: false,
      message: "Esta distribución está marcada 'No Facturar' — no lleva auxiliares.",
    }
  }

  // Join employee names with commas
  const auxiliares = employeeNames.join(",")

  // En el nuevo flujo, la asignacion de personal NO cierra la orden.
  // El cierre (fincargue) lo dispara el paso final de cargue de
  // fotos. Aqui solo persistimos el listado de auxiliares para que
  // sirva de "checkpoint" entre PDF -> Personal -> Fotos.
  //
  // `auxiliares_real` es la trazabilidad de quién asignó de verdad el
  // coordinador (cargue/descargue de ESE vehículo) — se guarda siempre
  // junto con `auxiliares`, pero a diferencia de ese campo, NUNCA se
  // sobrescribe al cerrar en pago 'global' (ver
  // app/api/upload-picking-photos/route.ts). No participa en nómina.
  const { error } = await supabase
    .from("cabeceraoc")
    .update({
      auxiliares,
      auxiliares_real: auxiliares,
    })
    .eq("id", orderId)

  if (error) {
    console.error("[v0] Error assigning personnel:", error)
    return { success: false, message: error.message }
  }

  const { data: orderInfo, error: fetchError } = await supabase
    .from("cabeceraoc")
    .select("doccargue, fotospicking")
    .eq("id", orderId)
    .single()

  if (fetchError || !orderInfo?.doccargue) {
    console.error("[v0] Error fetching PDF URL or PDF doesn't exist:", fetchError)
    return { success: true, message: "Personal asignado exitosamente (PDF no actualizado)" }
  }

  try {
    // Dynamic import to avoid build issues with fflate/Worker
    const { default: jsPDF } = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")
    
    const doc = new jsPDF({ format: "letter" }) as any

    // Get products from invtrans
    const { data: products, error: productsError } = await supabase
      .from("invtrans")
      .select("nombreproducto, location, lote, cantidad")
      .eq("ocargue", orderData.ordendecargue)
      .order("nombreproducto", { ascending: true })

    if (productsError) {
      console.error("[v0] Error fetching products for PDF:", productsError)
      return { success: true, message: "Personal asignado exitosamente (PDF no actualizado)" }
    }

    // Header
    doc.setFontSize(18)
    doc.setFont(undefined, "bold")
    doc.text("ORDEN DE PICKING", 105, 20, { align: "center" })

    // Date and time
    const colombiaTime = await getColombiaDateTime()
    const fechaHora = colombiaTime.toLocaleString("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })

    doc.setFontSize(10)
    doc.setFont(undefined, "normal")
    doc.text(`Fecha y Hora: ${fechaHora}`, 15, 35)

    // Order info section
    let y = 45
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 30, "F")

    doc.setFontSize(10)
    doc.setFont(undefined, "bold")
    doc.text("Orden de Cargue:", 20, y + 7)
    doc.setFont(undefined, "normal")
    doc.text(String(orderData.ordendecargue || ""), 70, y + 7)

    doc.setFont(undefined, "bold")
    doc.text("Cliente:", 20, y + 14)
    doc.setFont(undefined, "normal")
    doc.text(String(orderData.cliente || ""), 70, y + 14)

    doc.setFont(undefined, "bold")
    doc.text("Placa:", 20, y + 21)
    doc.setFont(undefined, "normal")
    doc.text(String(orderData.placa || ""), 70, y + 21)

    doc.setFont(undefined, "bold")
    doc.text("Conductor:", 110, y + 21)
    doc.setFont(undefined, "normal")
    doc.text(String(orderData.conductor || ""), 145, y + 21)

    // Products table
    y = 80
    doc.setTextColor(0, 0, 0)

    const tableData = (products || []).map((product: any) => [
      String(product.nombreproducto || ""),
      String(product.location || ""),
      String(product.lote || ""),
      String(product.cantidad || 0),
    ])

    autoTable(doc, {
      startY: y,
      head: [["Producto", "Location", "Lote", "Cantidad"]],
      body: tableData,
      theme: "grid",
      headStyles: {
        fillColor: [44, 82, 130],
        textColor: 255,
        fontStyle: "bold",
        fontSize: 10,
      },
      bodyStyles: {
        fontSize: 9,
      },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 35 },
        2: { cellWidth: 35 },
        3: { cellWidth: 30, halign: "center" },
      },
      margin: { left: 15, right: 15 },
    })

    const finalY = (doc as any).lastAutoTable.finalY + 10

    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)

    const auxiliaresList = auxiliares.split(",")
    const auxiliaresHeight = 20 + auxiliaresList.length * 5

    doc.rect(15, finalY, 180, auxiliaresHeight, "F")

    doc.setFontSize(10)
    doc.setFont(undefined, "bold")
    doc.text("Auxiliares:", 20, finalY + 7)
    doc.setFont(undefined, "normal")

    auxiliaresList.forEach((aux, index) => {
      doc.text(aux.trim(), 70, finalY + 7 + index * 5)
    })

    doc.setFont(undefined, "bold")
    doc.text("Usuario:", 20, finalY + 12 + auxiliaresList.length * 5)
    doc.setFont(undefined, "normal")
    doc.text(String(currentUserName || ""), 70, finalY + 12 + auxiliaresList.length * 5)

    // Footer on first page
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(7)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    if (orderInfo.fotospicking) {
      try {
        const photoUrls = JSON.parse(orderInfo.fotospicking) as string[]

        if (photoUrls && photoUrls.length > 0) {
          // Add new page for photos
          doc.addPage()

          // Title for photo evidence
          doc.setTextColor(0, 0, 0)
          doc.setFontSize(16)
          doc.setFont(undefined, "bold")
          doc.text("Evidencias fotográficas", 105, 20, { align: "center" })

          // Grid configuration: 4 columns x 5 rows = 20 photos per page
          const cols = 4
          const rows = 5
          const photosPerPage = cols * rows
          const photoWidth = 45 // Width of each photo
          const photoHeight = 45 // Height of each photo
          const marginX = 15
          const marginY = 35
          const gapX = 5
          const gapY = 5

          for (let i = 0; i < photoUrls.length; i++) {
            const pageIndex = Math.floor(i / photosPerPage)
            const photoIndexInPage = i % photosPerPage

            // Add new page if needed (not for first photo page)
            if (photoIndexInPage === 0 && i > 0) {
              doc.addPage()
              doc.setTextColor(0, 0, 0)
              doc.setFontSize(16)
              doc.setFont(undefined, "bold")
              doc.text("Evidencias fotográficas (cont.)", 105, 20, { align: "center" })
            }

            const col = photoIndexInPage % cols
            const row = Math.floor(photoIndexInPage / cols)

            const x = marginX + col * (photoWidth + gapX)
            const y = marginY + row * (photoHeight + gapY)

            try {
              console.log("[v0] Loading image", i + 1, "from URL:", photoUrls[i])
              const base64Image = await urlToBase64(photoUrls[i])
              doc.addImage(base64Image, "JPEG", x, y, photoWidth, photoHeight)
              console.log("[v0] Successfully added image", i + 1, "to PDF")
            } catch (imgError) {
              console.error(`[v0] Error adding image ${i + 1} to PDF:`, imgError)
              // Draw placeholder rectangle if image fails
              doc.setDrawColor(200, 200, 200)
              doc.rect(x, y, photoWidth, photoHeight)
              doc.setFontSize(8)
              doc.setTextColor(150, 150, 150)
              doc.text("Imagen no disponible", x + photoWidth / 2, y + photoHeight / 2, { align: "center" })
            }
          }

          console.log(
            `[v0] Added ${photoUrls.length} photos to PDF across ${Math.ceil(photoUrls.length / photosPerPage)} page(s)`,
          )
        }
      } catch (photoError) {
        console.error("[v0] Error processing photos for PDF:", photoError)
        // Continue without photos if there's an error
      }
    }

    // Generate PDF blob
    const pdfBlob = doc.output("blob")
    const fileName = `picking_${orderData.ordendecargue}_${Date.now()}.pdf`

    // Upload new PDF (overwrite)
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(`doccargue/${fileName}`, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (uploadError) {
      console.error("[v0] Error uploading updated PDF:", uploadError)
      return { success: true, message: "Personal asignado exitosamente (PDF no actualizado)" }
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from("archivos").getPublicUrl(`doccargue/${fileName}`)

    // Update doccargue with new PDF URL
    const { error: updatePdfError } = await supabase
      .from("cabeceraoc")
      .update({ doccargue: publicUrl })
      .eq("id", orderId)

    if (updatePdfError) {
      console.error("[v0] Error updating PDF URL:", updatePdfError)
    }

    console.log("[v0] PDF updated with auxiliares information and photo evidence")
  } catch (pdfError) {
    console.error("[v0] Error updating PDF:", pdfError)
    // Don't fail the whole operation if PDF update fails
  }

  return { success: true, message: "Personal asignado exitosamente y PDF actualizado" }
}

export async function getPickingItems(ordenCargue: string, selectedEmpresaId?: number) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("invtrans")
    .select("id, nombreproducto, lote, location, cantidad, status, codproducto")
    .eq("ocargue", ordenCargue)
    .order("nombreproducto", { ascending: true })

  if (error) {
    console.error("[v0] Error fetching picking items:", error)
    return { success: false, data: [], alternos: [], message: error.message }
  }

  const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

  // Helper para enriquecer cada fila con su stock disponible.
  const withStock = async (item: any) => {
    const { data: stockData } = await supabase
      .from("saldoinvdetalle")
      .select("stock_disp")
      .eq("nombreproducto", item.nombreproducto)
      .eq("lote", item.lote)
      .eq("location", item.location)
      .eq("idempresa", empresaId)
      .maybeSingle()

    const stock_disp = stockData?.stock_disp || 0
    return { ...item, stock_disp, stock_restante: stock_disp - item.cantidad }
  }

  // Las filas con status "Lote alterno" NO se muestran en la lista normal de
  // picking; se devuelven aparte para usarlas solo cuando falte inventario.
  const normalRows = (data || []).filter((r) => r.status !== "Lote alterno")
  const alternoRows = (data || []).filter((r) => r.status === "Lote alterno")

  const itemsWithStock = await Promise.all(normalRows.map(withStock))
  const alternosWithStock = await Promise.all(alternoRows.map(withStock))

  // `tieneStockQR`: esa combinacion producto/lote/location tiene existencias en
  // estibas identificadas. La UI lo usa solo para AVISAR: el picking sin QR
  // sigue permitido (ver `clavesConStockQR` y la nota en `confirmPicking`).
  const conQR = await clavesConStockQR(supabase, [...itemsWithStock, ...alternosWithStock])
  const marcar = (item: any) => ({
    ...item,
    tieneStockQR: conQR.has(claveQR(item.codproducto, item.lote, item.location)),
  })

  return {
    success: true,
    data: itemsWithStock.map(marcar),
    alternos: alternosWithStock.map(marcar),
    message: "Productos cargados exitosamente",
  }
}

export async function generatePickingPDF(
  orderId: number,
  ordenCargue: string,
  cliente: string,
  placa: string,
  conductor: string,
) {
  try {
    if (!ordenCargue || !cliente || !placa || !conductor) {
      console.error("[v0] Missing required parameters for PDF generation:", {
        ordenCargue,
        cliente,
        placa,
        conductor,
      })
      return { success: false, error: "Faltan parámetros requeridos para generar el PDF" }
    }

    console.log("[v0] Starting picking PDF generation for order:", ordenCargue)

    const supabase = await createClient()
    const supabaseAdmin = await getSupabaseAdmin()

    // Esta función ahora se dispara desde DOS lugares que pueden competir
    // mientras conviven el botón "Generar PDF" de Picking y la asignación de
    // muelle en Centro de Coordinación: si la orden YA tiene doccargue, no se
    // regenera nada — se devuelve el PDF existente tal cual. El inicio de la
    // operación no se toca aquí: lo marca la asignación del muelle.
    const { data: ordenActual } = await supabase
      .from("cabeceraoc")
      .select("doccargue")
      .eq("id", orderId)
      .maybeSingle()
    if (ordenActual?.doccargue) {
      return { success: true, url: ordenActual.doccargue }
    }

    // Get products from invtrans
    const productsResult = await getLoadOrderProducts(orderId, ordenCargue)
    if (!productsResult.success) {
      return { success: false, error: "Error al cargar los productos" }
    }

    // Dynamic import to avoid build issues with fflate/Worker
    const { default: jsPDF } = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")

    const doc = new jsPDF({ format: "letter" }) as any

    // Header
    doc.setFontSize(18)
    doc.setFont(undefined, "bold")
    doc.text("ORDEN DE PICKING", 105, 20, { align: "center" })

    // Date and time
    const colombiaTime = await getColombiaDateTime()
    const fechaHora = colombiaTime.toLocaleString("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })

    doc.setFontSize(10)
    doc.setFont(undefined, "normal")
    doc.text(`Fecha y Hora: ${fechaHora}`, 15, 35)

    // Order info section
    let y = 45
    doc.setFillColor(44, 82, 130)
    doc.setTextColor(255, 255, 255)
    doc.rect(15, y, 180, 30, "F")

    doc.setFontSize(10)
    doc.setFont(undefined, "bold")
    doc.text("Orden de Cargue:", 20, y + 7)
    doc.setFont(undefined, "normal")
    doc.text(String(ordenCargue || ""), 70, y + 7)

    doc.setFont(undefined, "bold")
    doc.text("Cliente:", 20, y + 14)
    doc.setFont(undefined, "normal")
    doc.text(String(cliente || ""), 70, y + 14)

    doc.setFont(undefined, "bold")
    doc.text("Placa:", 20, y + 21)
    doc.setFont(undefined, "normal")
    doc.text(String(placa || ""), 70, y + 21)

    doc.setFont(undefined, "bold")
    doc.text("Conductor:", 110, y + 21)
    doc.setFont(undefined, "normal")
    doc.text(String(conductor || ""), 145, y + 21)

    // Products table
    y = 80
    doc.setTextColor(0, 0, 0)

    const tableData = productsResult.data.map((product: any) => [
      String(product.nombreproducto || ""),
      String(product.location || ""),
      String(product.lote || ""),
      String(product.cantidad || 0),
    ])

    autoTable(doc, {
      startY: y,
      head: [["Producto", "Location", "Lote", "Cantidad"]],
      body: tableData,
      theme: "grid",
      headStyles: {
        fillColor: [44, 82, 130],
        textColor: 255,
        fontStyle: "bold",
        fontSize: 10,
      },
      bodyStyles: {
        fontSize: 9,
      },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 35 },
        2: { cellWidth: 35 },
        3: { cellWidth: 30, halign: "center" },
      },
      margin: { left: 15, right: 15 },
    })

    // Footer
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(7)
    doc.text("Generado por LipGo V3.0", 105, 270, { align: "center" })

    console.log("[v0] Picking PDF generated, creating blob...")

    // Generate PDF blob
    const pdfBlob = doc.output("blob")
    const fileName = `picking_${ordenCargue}_${Date.now()}.pdf`

    console.log("[v0] Uploading PDF to storage...")

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("archivos")
      .upload(`doccargue/${fileName}`, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (uploadError) {
      console.error("[v0] Error uploading picking PDF:", uploadError)
      return { success: false, error: uploadError.message }
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from("archivos").getPublicUrl(`doccargue/${fileName}`)

    console.log("[v0] Picking PDF uploaded successfully:", publicUrl)

    // Generar el PDF de Picking YA NO marca el inicio de la operación.
    //
    // El inicio lo marca UNA sola cosa: asignar el muelle
    // (`asignarOrdenAMuelle` en lib/centro-coordinacion-actions.ts). Antes había
    // tres caminos que podían escribir `iniciocargue` y el valor dependía de
    // cuál se ejecutara primero, así que la misma orden podía quedar con una
    // hora distinta según por dónde la operaran. Aquí solo se guarda el
    // documento.
    const { error: updateError } = await supabase
      .from("cabeceraoc")
      .update({ doccargue: publicUrl })
      .eq("id", orderId)

    if (updateError) {
      console.error("[v0] Error updating cabeceraoc:", updateError)
      // Don't fail the whole operation if the update fails
    }

    console.log("[v0] Updated doccargue to:", publicUrl)

    return {
      success: true,
      url: publicUrl,
      message: "PDF de picking generado exitosamente",
    }
  } catch (error) {
    console.error("[v0] Error generating picking PDF:", error)
    return { success: false, error: "Error al generar el PDF de picking" }
  }
}

export async function confirmPicking(
  orderId: number,
  ordenCargue: string,
  items: {
    id: number
    cantidad: number
    // Si el item se verificó por QR, contiene una entrada por cada
    // estiba (QR) escaneada con la cantidad descontada de cada una y las
    // averías reportadas en esa estiba.
    qrScans?: { idqr: number; cantidad: number; averias?: number }[]
    // Estibas escaneadas desde el inventario marcado como "Lote alterno".
    // Cada una indica de qué fila de invtrans alterna proviene (alternoId).
    alternoScans?: { idqr: number; cantidad: number; averias?: number; alternoId: number }[]
    // Modo SIMPLE (sin QR): averías reportadas sobre el lote principal.
    averias?: number
    // Modo SIMPLE (sin QR): selecciones de lote alterno con su cantidad y averías.
    alternoSimple?: { alternoId: number; cantidad: number; averias?: number }[]
  }[],
) {
  const supabase = await createClient()

  // ===================================================================================
  // CANDADO 1 · Una orden ya verificada NO se vuelve a procesar, pero una confirmación
  //             que se quedó A MEDIAS SÍ se termina.
  //
  // Gerencia 2026-10-04, tras el caso de la orden IND202608047608: con intermitencia de
  // red el trabajador no ve el cierre, vuelve a confirmar, y al llegar la conexión el
  // servidor procesa dos veces → DOBLE DESPACHO (salieron 70 bultos cuando la estiba
  // tenía 35). El picking es "todo o nada": una orden se confirma UNA sola vez.
  //
  // Pero la confirmación NO es una transacción: es una secuencia de llamadas. Si se corta
  // a la mitad, la orden queda con unas líneas aprobadas y otras en "por descontar". La
  // primera versión de este candado bastaba con ver UNA aprobada para responder "ya está",
  // y eso dejaba esas sobras atascadas para siempre: nadie las aprobaba y además bloquean
  // el Conteo total del mes, que se niega cuando hay salidas por descontar.
  //
  // Ahora se distingue: nada pendiente → ÉXITO (el trabajador deja de reintentar, que es
  // lo que disparó el problema); con pendientes → se REANUDA y se termina lo que falta.
  // La decisión y sus pruebas viven en lib/picking-estado.ts.
  // ===================================================================================
  // Qué filas de invtrans verificó el trabajador en ESTA confirmación. Hace falta más
  // abajo: una fila "por descontar" que NADIE verificó es una RESERVA legítima de la
  // asignación de lotes (separa el producto para que otra orden no lo tome; asignar no es
  // despachar), y no puede tratarse como un error.
  const idsEnviados = new Set<number>()
  for (const it of items) {
    idsEnviados.add(Number(it.id))
    for (const a of it.alternoScans ?? []) idsEnviados.add(Number(a.alternoId))
    for (const a of it.alternoSimple ?? []) idsEnviados.add(Number(a.alternoId))
  }

  let reanudando = false
  let pendientesId = new Set<number>()
  {
    const { data: salidas } = await supabase
      .from("invtrans")
      .select("id, status, nombreproducto, lote, cantidad, creado, creadopor")
      .eq("ocargue", ordenCargue)
      .eq("tipomov", "Salida")
      // En la base conviven "orden de cargue", "Orden de cargue" y "Orden de Cargue" (datos
      // viejos). Con igualdad exacta el candado se saltaba esas filas, asi que ilike.
      .ilike("origen", "orden de cargue")
      .order("id", { ascending: true })

    const d = decidirConfirmacion((salidas ?? []) as FilaSalida[], idsEnviados)
    if (d.reservas > 0) {
      console.log(`[picking] ${ordenCargue}: ${d.reservas} líneas asignadas quedan reservadas (asignar no es despachar).`)
    }
    if (d.accion === "ya_verificada") {
      console.log("[picking] confirmación repetida ignorada para", ordenCargue, "— ya verificada")
      return { success: true, yaEstabaVerificada: true, message: textoYaVerificada(d) }
    }
    if (d.accion === "reanudar") {
      reanudando = true
      pendientesId = new Set((salidas ?? []).filter((f: any) => esPorDescontar(f) || esLoteAlterno(f)).map((f: any) => Number(f.id)))
      console.warn(
        `[picking] ${ordenCargue}: confirmación A MEDIAS (${d.aprobadas} aprobadas, ${d.porDescontar} por descontar). Se reanuda y se termina: ${d.pendientesTexto}`,
      )
      items = itemsPorProcesar(items, pendientesId)
    }
  }

  // ===================================================================================
  // CANDADO 2 · La misma estiba (QR) no puede ir dos veces en el mismo envío.
  //
  // En el caso de agosto la lista llegó con el QR 960 repetido (la pantalla lo agregó dos
  // veces durante los reintentos) y se insertaron DOS salidas idénticas en el mismo
  // microsegundo. Una estiba física no puede salir dos veces: se descarta la repetición.
  // ===================================================================================
  const estibasVistas = new Set<number>()
  const sinRepetir = <T extends { idqr: number }>(scans: T[] | undefined): T[] | undefined => {
    if (!scans?.length) return scans
    const out: T[] = []
    for (const s of scans) {
      if (estibasVistas.has(s.idqr)) {
        console.warn(`[picking] estiba QR ${s.idqr} repetida en la confirmación de ${ordenCargue}: se ignora la repetición`)
        continue
      }
      estibasVistas.add(s.idqr)
      out.push(s)
    }
    return out
  }
  items = items.map((item) => ({
    ...item,
    qrScans: sinRepetir(item.qrScans),
    alternoScans: sinRepetir(item.alternoScans),
  }))

  // Helper: inserta una ENTRADA con status "Averia" copiando los datos de una
  // fila de invtrans existente, con la cantidad de averías indicada.
  // IDEMPOTENTE: si al reanudar esa avería ya se registró, no se duplica.
  const insertAveriaForRow = async (rowId: number, averias: number) => {
    if (!averias || averias <= 0) return
    const { data: row, error } = await supabase.from("invtrans").select("*").eq("id", rowId).single()
    if (error || !row) {
      console.error("[v0] Error fetching invtrans row for averia:", error)
      throw error || new Error("No se encontró la línea de invtrans para registrar la avería")
    }
    const { id: _id, ...rest } = row as Record<string, any>
    if (reanudando) {
      const { data: yaHay } = await supabase
        .from("invtrans")
        .select("id")
        .eq("ocargue", ordenCargue)
        .eq("tipomov", "Entrada")
        .eq("status", "Averia")
        .eq("nombreproducto", rest.nombreproducto)
        .eq("lote", rest.lote)
        .eq("cantidad", averias)
        .limit(1)
      if ((yaHay ?? []).length > 0) {
        console.warn(`[picking] avería ya registrada para ${rest.nombreproducto} lote ${rest.lote} (${averias}): no se duplica`)
        return
      }
    }
    const { error: insErr } = await supabase
      .from("invtrans")
      .insert([{ ...rest, cantidad: averias, tipomov: "Entrada", status: "Averia" }])
    if (insErr) {
      console.error("[v0] Error inserting averia row:", insErr)
      throw insErr
    }
  }

  // Helper: divide una fila de invtrans (original/alterna) en una línea
  // aprobada por cada estiba escaneada y, por cada avería reportada, crea
  // una ENTRADA con status "Averia". Finalmente elimina la fila original.
  const splitRowByScans = async (
    rowId: number,
    scans: { idqr: number; cantidad: number; averias?: number }[],
  ) => {
    const { data: originalRow, error: fetchError } = await supabase
      .from("invtrans")
      .select("*")
      .eq("id", rowId)
      .single()

    if (fetchError || !originalRow) {
      console.error("[v0] Error fetching invtrans row to split:", fetchError)
      throw fetchError || new Error("No se encontró la línea de invtrans a dividir")
    }

    const { id: _id, ...rest } = originalRow as Record<string, any>

    // STOCK BLOQUEADO (calidad, 2026-09-27): una estiba en CUARENTENA sigue en
    // el inventario pero NO se despacha. Se libera con 343 (clave de la
    // gerencia del proyecto) o se desecha con 555 -- nunca sale por picking.
    if (/CUARENTENA/i.test(String(rest.location ?? ""))) {
      throw new Error(
        `La estiba del lote ${rest.lote ?? ""} está BLOQUEADA en CUARENTENA (calidad) y no se puede despachar. Si calidad ya la aprobó, libérala primero con el código 343 en Transacciones de Inventario.`,
      )
    }

    // AL REANUDAR, no se vuelve a sacar una estiba que ya salió.
    //
    // Este es el riesgo que abre la reanudación: si la confirmación anterior insertó las
    // salidas y murió ANTES de borrar la fila original, la fila sigue en "por descontar" y
    // al reanudar se dividiría otra vez → DOBLE DESPACHO, justo lo que cerramos en agosto.
    // Una estiba (QR) es un palé físico: si ya tiene salida aprobada en esta orden, no se
    // inserta de nuevo; solo se termina lo que faltaba (borrar la original).
    let scansPorInsertar = scans
    if (reanudando && scans.length > 0) {
      const { data: yaSalieron } = await supabase
        .from("invtrans")
        .select("qrestiba")
        .eq("ocargue", ordenCargue)
        .eq("tipomov", "Salida")
        .ilike("status", "apr%")
        .in("qrestiba", scans.map((s) => s.idqr))
      const hechas = new Set((yaSalieron ?? []).map((r: any) => Number(r.qrestiba)))
      if (hechas.size > 0) {
        scansPorInsertar = scans.filter((s) => !hechas.has(s.idqr))
        console.warn(
          `[picking] ${ordenCargue}: las estibas ${[...hechas].join(", ")} ya tenían salida aprobada; no se vuelven a despachar. Se completa el cierre de la línea.`,
        )
      }
    }

    // Salida aprobada por estiba: la cantidad es el total escaneado (incluye
    // lo que luego se descuenta como avería, según la regla de negocio).
    const salidaRows = scansPorInsertar.map((scan) => ({
      ...rest,
      cantidad: scan.cantidad,
      qrestiba: scan.idqr,
      tipomov: "Salida",
      status: "aprobado",
    }))

    // Entradas por avería: una por cada estiba con averías > 0 (solo de las que se insertan).
    const averiaRows = scansPorInsertar
      .filter((scan) => (scan.averias || 0) > 0)
      .map((scan) => ({
        ...rest,
        cantidad: scan.averias,
        qrestiba: scan.idqr,
        tipomov: "Entrada",
        status: "Averia",
      }))

    const rowsToInsert = [...salidaRows, ...averiaRows]
    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabase.from("invtrans").insert(rowsToInsert)
      if (insertError) {
        console.error("[v0] Error inserting split invtrans rows:", insertError)
        throw insertError
      }
    }

    const { error: deleteError } = await supabase.from("invtrans").delete().eq("id", rowId)
    if (deleteError) {
      console.error("[v0] Error deleting original invtrans row:", deleteError)
      throw deleteError
    }
  }

  try {
    // NOTA: aqui existio un BLOQUEO que rechazaba la confirmacion cuando una
    // linea se descontaba sin QR y su stock vivia en estibas identificadas. Se
    // retiro por decision de operacion: el picking sin QR vuelve a permitirse
    // aunque el producto tenga estibas con QR.
    //
    // El riesgo que cubria sigue existiendo: esa salida queda sin `qrestiba` y
    // el inventario por estiba no se mueve, asi que la estiba conserva un stock
    // que fisicamente ya salio. Lo que queda es el AVISO en la UI
    // (`tieneStockQR`), que informa pero no impide.

    for (const item of items) {
      const hasNormal = !!(item.qrScans && item.qrScans.length > 0)
      const hasQRAlterno = !!(item.alternoScans && item.alternoScans.length > 0)
      const hasSimpleAlterno = !!(item.alternoSimple && item.alternoSimple.length > 0)

      if (hasNormal) {
        // VERIFICACIÓN POR QR: reemplazamos la línea original por una línea de
        // salida aprobada por cada QR escaneado (+ entradas por avería).
        await splitRowByScans(item.id, item.qrScans!)
      } else if (hasQRAlterno) {
        // Sólo se usó lote alterno por QR (sin estibas normales): la línea
        // original se cubre completamente con el alterno, por lo que se elimina.
        const { error: deleteError } = await supabase.from("invtrans").delete().eq("id", item.id)
        if (deleteError) {
          console.error("[v0] Error deleting original invtrans row (alterno-only):", deleteError)
          throw deleteError
        }
      } else {
        // VERIFICACIÓN SIMPLE (sin QR): se aprueba la línea con la cantidad
        // escogida (salida) y, si hubo averías sobre el lote principal, se
        // registra una ENTRADA con status "Averia".
        const { error: updateError } = await supabase
          .from("invtrans")
          .update({
            cantidad: item.cantidad,
            status: "aprobado",
          })
          .eq("id", item.id)

        if (updateError) {
          console.error("[v0] Error updating invtrans:", updateError)
          throw updateError
        }

        await insertAveriaForRow(item.id, item.averias || 0)
      }

      // LOTE ALTERNO POR QR: cada fila alterna se divide igual que la normal
      // (estibas aprobadas + averías) y se elimina la fila alterna original.
      if (hasQRAlterno) {
        const byAlternoId = new Map<number, { idqr: number; cantidad: number; averias?: number }[]>()
        for (const scan of item.alternoScans!) {
          const list = byAlternoId.get(scan.alternoId) || []
          list.push({ idqr: scan.idqr, cantidad: scan.cantidad, averias: scan.averias })
          byAlternoId.set(scan.alternoId, list)
        }
        for (const [alternoId, scans] of byAlternoId) {
          await splitRowByScans(alternoId, scans)
        }
      }

      // LOTE ALTERNO SIMPLE (sin QR): cada selección aprueba la fila alterna
      // con la cantidad usada (salida) y registra su entrada por avería.
      if (hasSimpleAlterno) {
        for (const sel of item.alternoSimple!) {
          const { error: updErr } = await supabase
            .from("invtrans")
            .update({ cantidad: sel.cantidad, status: "aprobado", tipomov: "Salida" })
            .eq("id", sel.alternoId)
          if (updErr) {
            console.error("[v0] Error approving simple alterno row:", updErr)
            throw updErr
          }
          await insertAveriaForRow(sel.alternoId, sel.averias || 0)
        }
      }
    }

    // Register horapicking only when confirming
    const currentTime = await getColombiaTime()
    const { error: horaError } = await supabase
      .from("cabeceraoc")
      .update({ horapicking: currentTime })
      .eq("id", orderId)

    if (horaError) {
      console.error("[v0] Error registering horapicking on confirm:", horaError)
      throw horaError
    }

    // ===============================================================================
    // INVARIANTE DE CIERRE. El picking es todo o nada: lo que el trabajador verificó en
    // esta confirmación tiene que quedar aprobado. Si una de ESAS líneas sigue en "por
    // descontar", la confirmación se cortó a la mitad y hay que decirlo, no responder
    // éxito: esas sobras bloquean el Conteo total del mes y alguien podría aprobarlas
    // después, despachando de más. Al volver a confirmar, el candado 1 reanuda y termina.
    //
    // OJO (gerencia, 2026-10-04): una fila "por descontar" que NADIE verificó NO es un
    // error. La asignación de lotes deja el producto en stock y separado a propósito, para
    // que otra orden de cargue no lo tome; asignar un lote no significa que se despachó.
    // El que saca del inventario es el picking. Esa lógica se respeta: solo se revisan las
    // líneas que entraron en esta confirmación.
    // ===============================================================================
    const { data: despues } = await supabase
      .from("invtrans")
      .select("id, status, nombreproducto, lote, cantidad")
      .eq("ocargue", ordenCargue)
      .eq("tipomov", "Salida")
      // En la base conviven "orden de cargue", "Orden de cargue" y "Orden de Cargue" (datos
      // viejos). Con igualdad exacta el candado se saltaba esas filas, asi que ilike.
      .ilike("origen", "orden de cargue")
    const pendientesDespues = ((despues ?? []) as FilaSalida[]).filter(esPorDescontar)
    const sobras = pendientesDespues.filter((f) => idsEnviados.has(Number(f.id)))
    const reservas = pendientesDespues.filter((f) => !idsEnviados.has(Number(f.id)))
    if (reservas.length > 0) {
      console.log(
        `[picking] ${ordenCargue}: ${reservas.length} líneas asignadas siguen reservadas (no entraron en esta verificación). Es normal: la asignación separa el producto, el despacho lo hace el picking.`,
      )
    }
    if (sobras.length > 0) {
      const detalle = sobras.map((f) => `${f.nombreproducto ?? "producto"}${f.lote ? ` lote ${f.lote}` : ""}`).join(", ")
      console.error(`[picking] ${ordenCargue}: quedaron ${sobras.length} líneas verificadas sin aprobar: ${detalle}`)
      return {
        success: false,
        message: `La verificación quedó incompleta: ${sobras.length} ${sobras.length === 1 ? "línea que verificaste sigue" : "líneas que verificaste siguen"} sin aprobar (${detalle}). Vuelve a confirmar para terminarla; no se despachó nada de más.`,
      }
    }

    console.log(
      `[v0] Picking confirmed successfully for order: ${ordenCargue} with horapicking: ${currentTime}${reanudando ? " (se reanudó una confirmación a medias)" : ""}`,
    )

    return {
      success: true,
      message: reanudando ? "Picking confirmado: se terminó una verificación que había quedado a medias." : "Picking confirmado exitosamente",
    }
  } catch (error: any) {
    console.error("[v0] Error confirming picking:", error)
    return { success: false, message: error.message || "Error al confirmar el picking" }
  }
}

export async function savePickingPhotos(orderId: number, photoUrls: string[]) {
  const supabase = await createClient()

  // Create JSON array of strings
  const photosJson = JSON.stringify(photoUrls)

  const { error } = await supabase.from("cabeceraoc").update({ fotospicking: photosJson }).eq("id", orderId)

  if (error) {
    console.error("[v0] Error saving picking photos:", error)
    return { success: false, message: error.message }
  }

  return { success: true, message: "Fotos guardadas exitosamente" }
}

export async function registerHoraPicking(orderId: number) {
  const supabase = await createClient()
  const currentTime = await getColombiaTime()

  const { error } = await supabase.from("cabeceraoc").update({ horapicking: currentTime }).eq("id", orderId)

  if (error) {
    console.error("[v0] Error registering horapicking:", error)
    return { success: false, message: error.message }
  }

  return { success: true, message: "Hora de picking registrada exitosamente" }
}

/**
 * Pausa el proceso de cargue de una orden. Crea una nueva linea en la tabla
 * `pausas` con el numero de orden y la hora de inicio del paro (hora Colombia).
 * Solo deberia llamarse cuando la orden ya tiene iniciocargue.
 *
 * NO se escribe `activo`: es una COLUMNA GENERADA en la base y Postgres rechaza
 * el INSERT con "cannot insert a non-default value into column activo". La
 * columna se agrego despues de escribirse esta funcion y el codigo seguia
 * mandandola, asi que el boton Pausar fallaba siempre.
 *
 * El estado lo lleva `fin`: la pausa esta activa mientras `fin` sea null, y
 * `reanudarOrden` la cierra escribiendo la hora. La base deriva `activo` de ahi.
 */
export async function pausarOrden(ordenCargue: string) {
  const supabase = await createClient()

  // Idempotente: si la orden YA tiene una pausa abierta (doble clic, red
  // lenta, dos pestañas) no se inserta otra fila -- eso es lo que dejaba
  // pausas duplicadas para la misma orden y luego una de ellas quedaba
  // huérfana porque `reanudarOrden` solo cierra la más reciente.
  const { data: existente, error: findError } = await supabase
    .from("pausas")
    .select("id")
    .eq("ordendecargue", ordenCargue)
    .is("fin", null)
    .limit(1)

  if (findError) {
    console.error("[v0] Error al verificar pausa existente:", findError)
    return { success: false, message: findError.message }
  }
  if (existente && existente.length > 0) {
    return { success: true, message: "El cargue ya estaba en pausa" }
  }

  const inicio = await getColombiaTime()
  const { error } = await supabase.from("pausas").insert([
    {
      ordendecargue: ordenCargue,
      inicio,
    },
  ])

  if (error) {
    console.error("[v0] Error al pausar la orden:", error)
    return { success: false, message: error.message }
  }

  return { success: true, message: "Cargue pausado" }
}

/**
 * Reanuda el proceso de cargue de una orden. Busca la linea de pausa abierta
 * (sin `fin`) de la orden y le escribe la hora de fin del paro.
 */
export async function reanudarOrden(ordenCargue: string) {
  const supabase = await createClient()
  const fin = await getColombiaTime()

  // Buscar TODAS las pausas activas de la orden (sin `fin`), no solo la mas
  // reciente -- una orden nunca deberia tener mas de una pausa abierta a la
  // vez (ver pausarOrden, ahora idempotente), pero si por datos previos a ese
  // fix quedo mas de una huerfana, "Reanudar" debe cerrarlas TODAS de una vez
  // en vez de dejar la orden bloqueada tras un solo clic.
  //
  // Se filtra SOLO por `fin is null`, no por `activo`. `activo` es una columna
  // GENERADA por la base a partir de otras: filtrar por ella ata este codigo a
  // una expresion que no esta versionada aqui y que puede cambiar sin aviso.
  // "Pausa abierta = pausa sin hora de fin" es la verdad del dominio, y es la
  // unica columna de estado que esta funcion escribe.
  const { data: pausas, error: findError } = await supabase
    .from("pausas")
    .select("id")
    .eq("ordendecargue", ordenCargue)
    .is("fin", null)

  if (findError) {
    console.error("[v0] Error al buscar la pausa activa:", findError)
    return { success: false, message: findError.message }
  }

  if (!pausas || pausas.length === 0) {
    return { success: false, message: "No se encontró una pausa activa para esta orden" }
  }

  const { error: updateError } = await supabase
    .from("pausas")
    .update({ fin })
    .in("id", pausas.map((p: { id: number }) => p.id))

  if (updateError) {
    console.error("[v0] Error al reanudar la orden:", updateError)
    return { success: false, message: updateError.message }
  }

  return { success: true, message: "Cargue reanudado" }
}

/**
 * Devuelve los numeros de orden (ordendecargue) que tienen una pausa abierta
 * (aun sin `fin`). Sirve para que la UI muestre "Reanudar" en vez de "Pausar"
 * en esas ordenes. Mismo criterio que `reanudarOrden`: el estado lo marca
 * `fin`, no la columna generada `activo`.
 */
export async function getOrdenesPausadas(): Promise<string[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("pausas")
    .select("ordendecargue")
    .is("fin", null)

  if (error) {
    console.error("[v0] Error al obtener ordenes pausadas:", error)
    return []
  }

  return (data || []).map((p: { ordendecargue: string }) => p.ordendecargue)
}

async function urlToBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.error("[v0] Error converting URL to base64:", error)
    throw error
  }
}
