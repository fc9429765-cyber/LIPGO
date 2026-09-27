"use server"

/**
 * CIERRE DE FACTURACIÓN DEL DÍA (pestaña y tira del Cuadro de Control).
 *
 * El Cuadro responde "¿se facturó todo lo procesado?" por proyecto y por
 * período. Lo que faltaba era ver EL DÍA en vivo y, sobre todo, cazar a tiempo
 * el riesgo que más duele: un TERCERO atendido que se fue sin dejar soporte de
 * pago. TERCEROS paga de contado sin excepción, así que ese vehículo ya salió
 * con la carga y sin respaldo.
 *
 * Es CROSS-PROYECTO a propósito: suma todas las empresas a las que el usuario
 * tiene acceso, sin depender del selector del módulo. Un cierre de gerencia que
 * obligue a cambiar de proyecto para saber el total del día no sirve.
 *
 * EL VALOR SE REUSA, NO SE RECALCULA. En el repo hay dos formas de valorar una
 * orden: la vista `facturacion` (que usa getFacturacionPorProyecto en
 * sig-actions) y el recálculo con `tarifaDeServicio` que hace el Cuadro. Aquí
 * se usa `getValoresNetosOrden`, que es la segunda, porque el usuario va a
 * comparar este cierre contra el módulo que lo contiene y tienen que cuadrar.
 *
 * Es un LECTOR: no escribe nada.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getValoresNetosOrden } from "@/lib/facturacion-control-actions"
import { getAccessibleEmpresesFromPermisos } from "@/lib/orders-actions"
import {
  medioPagoEsperado,
  medioPagoEsperadoSinAmbiguedad,
  medioPagoInconsistente,
  type MedioPago,
} from "@/lib/facturacion-medio-pago"

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

/**
 * ¿La orden tiene soporte de pago cargado?
 *
 * `cabeceraoc.comprobante` es TEXT con `JSON.stringify(string[])`, pero los
 * registros viejos guardan UNA URL suelta sin envolver (por eso el parseo
 * tolerante de components/gestion-facturas.tsx). Un `JSON.parse` a secas
 * marcaría como "sin soporte" a media historia.
 */
function tieneSoporte(comprobante: unknown): boolean {
  const s = String(comprobante ?? "").trim()
  if (s === "" || s === "[]" || s === "null") return false
  if (s.startsWith("[")) {
    try {
      return (JSON.parse(s) as unknown[]).length > 0
    } catch {
      return true // no parsea pero tiene contenido: se le da el beneficio de la duda
    }
  }
  return true // URL suelta del histórico
}

const tieneFacturaSiigo = (v: unknown) => String(v ?? "").trim() !== ""

export type CondicionPago = "Contado" | "Crédito" | "sin definir"

/** Una orden señalada por una alerta, con lo mínimo para ir a buscarla. */
export interface OrdenAlertada {
  numeroorden: string
  idempresa: number
  proyecto: string
  placa: string | null
  transporte: string | null
  valor: number
  /** Qué le falta, en palabras, para no tener que adivinar mirando columnas. */
  motivo: string
}

export interface BloqueAlerta {
  ordenes: number
  valor: number
  detalle: OrdenAlertada[]
}

export interface LineaProyecto {
  idempresa: number
  proyecto: string
  ordenes: number
  cobro: number
  contado: number
  credito: number
  sinDefinir: number
  costo: number
  margen: number
}

export interface LineaTransporte {
  idempresa: number
  proyecto: string
  transporte: string
  ordenes: number
  cobro: number
  contado: number
  credito: number
  sinDefinir: number
  /** Condición que le corresponde según la regla del proyecto, si la hay. */
  esperado: MedioPago | null
  /** Órdenes de esta línea cuyo medio de pago contradice esa regla. */
  inconsistentes: number
}

export interface CierreDiario {
  fecha: string
  /** El día 31 no paga base salarial: solo novedades y destajo. Sin advertirlo
   *  el margen de ese día se ve inflado. */
  esDia31: boolean
  totales: {
    ordenes: number
    cobro: number
    contado: number
    credito: number
    sinDefinir: number
    costo: number
    margen: number
  }
  porProyecto: LineaProyecto[]
  porTransporte: LineaTransporte[]
  alertas: {
    tercero_sin_respaldo: BloqueAlerta
    sin_medio_pago: BloqueAlerta
    pago_no_cuadra: BloqueAlerta
  }
}

const vacio = (): BloqueAlerta => ({ ordenes: 0, valor: 0, detalle: [] })

export async function getCierreDiario(
  fecha?: string | null,
  /** Con proyecto: el cierre se amarra al selector DEL MÓDULO (pedido de
   *  gerencia). Sin proyecto: suma todos los accesibles, como siempre. */
  empresaId?: number | null,
): Promise<{ success: boolean; data?: CierreDiario; message?: string }> {
  const dia = String(fecha || "").trim() || hoyBogota()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { success: false, message: "Fecha inválida." }

  try {
    const empresas = await getAccessibleEmpresesFromPermisos()
    if (!empresas.length) return { success: false, message: "No tienes proyectos asignados." }
    const alcance = empresaId ? empresas.filter((e) => Number(e.id) === Number(empresaId)) : empresas
    if (!alcance.length) return { success: false, message: "No tienes acceso a ese proyecto." }
    const nombreDe = new Map(alcance.map((e) => [Number(e.id), e.nombre]))
    const ids = alcance.map((e) => Number(e.id))

    const sb: any = await getSupabaseAdmin()

    // ---------------------------------------------------------------------
    // 1) Órdenes PROCESADAS del día. Mismo criterio que el resto del módulo:
    //    con `fincargue` y no marcadas `facturar = false`.
    // ---------------------------------------------------------------------
    const ordenes: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb
        .from("cabeceraoc")
        .select("ordendecargue, idempresa, placa, transporte, tipooperacion, mediopago, estadofactura, facturasiigo, comprobante, fincargue, facturar")
        .in("idempresa", ids)
        .eq("fechacargue", dia)
        .neq("tipooperacion", "proyeccion")
        .range(off, off + 999)
      if (error) return { success: false, message: error.message }
      if (!data || data.length === 0) break
      ordenes.push(...data)
      if (data.length < 1000) break
    }
    const procesadas = ordenes.filter((o) => o.fincargue && o.facturar !== false)

    // ---------------------------------------------------------------------
    // 2) Valor por orden, con el MISMO cálculo del Cuadro (una llamada por
    //    proyecto, porque las tarifas son por empresa).
    // ---------------------------------------------------------------------
    const valorDe = new Map<string, number>()
    for (const id of ids) {
      const suyas = procesadas
        .filter((o) => Number(o.idempresa) === id)
        .map((o) => String(o.ordendecargue || "").trim())
        .filter(Boolean)
      if (!suyas.length) continue
      const r = await getValoresNetosOrden(id, suyas)
      if (r.success) for (const [on, v] of Object.entries(r.data)) valorDe.set(on, num(v))
    }

    // ---------------------------------------------------------------------
    // 3) Costo de nómina del día, por proyecto. Se filtra a las empresas
    //    accesibles: `pagonomina` trae también idempresa 0 y 5 en $0, que solo
    //    ensuciarían el total.
    // ---------------------------------------------------------------------
    const costoDe = new Map<number, number>()
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb
        .rpc("pagonomina_rango", { p_desde: dia, p_hasta: dia })
        // `persona` va en el select porque es la columna de orden: sobre una
        // función rpc PostgREST rechaza ordenar por una columna no seleccionada.
        .select("idempresa, persona, total_liquidado_dia")
        .in("idempresa", ids)
        .eq("fecha", dia)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("persona")
        .range(off, off + 999)
      if (error) break // el costo es complementario: sin él el cierre sigue sirviendo
      if (!data || data.length === 0) break
      for (const r of data) {
        const id = Number(r.idempresa)
        costoDe.set(id, (costoDe.get(id) || 0) + num(r.total_liquidado_dia))
      }
      if (data.length < 1000) break
    }

    // ---------------------------------------------------------------------
    // 4) Agregar.
    // ---------------------------------------------------------------------
    const porProy = new Map<number, LineaProyecto>()
    const porTr = new Map<string, LineaTransporte>()
    const alertas = {
      tercero_sin_respaldo: vacio(),
      sin_medio_pago: vacio(),
      pago_no_cuadra: vacio(),
    }

    for (const o of procesadas) {
      const id = Number(o.idempresa)
      const proyecto = nombreDe.get(id) || `Empresa ${id}`
      const on = String(o.ordendecargue || "").trim()
      const valor = valorDe.get(on) || 0
      const transporte = String(o.transporte ?? "").trim() || "(sin transporte)"

      // Condición de pago: manda el DATO registrado; si falta, manda la REGLA
      // SOLO cuando es incondicional para ese ID (Indupan/Funza: todo crédito;
      // Avimol-TERCEROS/resto: fijo por transporte). Cada ID tiene su propia
      // lógica: en Avimol-ZAMUDIO la regla depende de la PLACA (12 excepciones
      // de contado), así que sin el dato NO se rellena a ciegas — sigue "sin
      // definir" y alerta, para que se confirme en vez de asumir.
      const ctxPago = { placa: o.placa, operacion: o.tipooperacion }
      const mp = norm(o.mediopago)
      const cond: CondicionPago = mp.startsWith("CR")
        ? "Crédito"
        : mp.startsWith("CONT")
          ? "Contado"
          : (medioPagoEsperadoSinAmbiguedad(id, o.transporte, ctxPago) ?? "sin definir")

      const p = porProy.get(id) || {
        idempresa: id, proyecto, ordenes: 0, cobro: 0, contado: 0, credito: 0, sinDefinir: 0,
        costo: costoDe.get(id) || 0, margen: 0,
      }
      p.ordenes++
      p.cobro += valor
      if (cond === "Contado") p.contado += valor
      else if (cond === "Crédito") p.credito += valor
      else p.sinDefinir += valor
      porProy.set(id, p)

      const kt = `${id}|||${transporte}`
      const t = porTr.get(kt) || {
        idempresa: id, proyecto, transporte, ordenes: 0, cobro: 0, contado: 0, credito: 0, sinDefinir: 0,
        esperado: medioPagoEsperado(id, o.transporte), inconsistentes: 0,
      }
      t.ordenes++
      t.cobro += valor
      if (cond === "Contado") t.contado += valor
      else if (cond === "Crédito") t.credito += valor
      else t.sinDefinir += valor

      const base = { numeroorden: on, idempresa: id, proyecto, placa: o.placa ?? null, transporte: o.transporte ?? null, valor }

      // ALERTA PRINCIPAL: el tercero es de contado, así que salir sin soporte
      // ni factura es plata expuesta.
      if (norm(o.transporte) === "TERCEROS") {
        const sinSoporte = !tieneSoporte(o.comprobante)
        const sinFactura = !tieneFacturaSiigo(o.facturasiigo)
        if (sinSoporte || sinFactura) {
          const falta = [sinSoporte ? "sin soporte de pago" : null, sinFactura ? "sin factura Siigo" : null]
            .filter(Boolean)
            .join(" y ")
          const sinGestion = String(o.estadofactura ?? "").trim() === ""
          alertas.tercero_sin_respaldo.detalle.push({
            ...base,
            motivo: sinGestion ? `${falta} · nunca pasó por Gestión de Facturas` : falta,
          })
          alertas.tercero_sin_respaldo.ordenes++
          alertas.tercero_sin_respaldo.valor += valor
        }
      }

      if (cond === "sin definir") {
        alertas.sin_medio_pago.detalle.push({ ...base, motivo: "sin medio de pago registrado y sin regla que lo defina" })
        alertas.sin_medio_pago.ordenes++
        alertas.sin_medio_pago.valor += valor
      }

      if (medioPagoInconsistente(id, o.transporte, o.mediopago, ctxPago)) {
        t.inconsistentes++
        alertas.pago_no_cuadra.detalle.push({
          ...base,
          motivo: `${transporte} debe ser ${medioPagoEsperado(id, o.transporte, ctxPago)} y quedó ${String(o.mediopago).trim()}`,
        })
        alertas.pago_no_cuadra.ordenes++
        alertas.pago_no_cuadra.valor += valor
      }

      porTr.set(kt, t)
    }

    // El costo entra por proyecto aunque ese día no haya tenido órdenes: si se
    // pagó nómina y no se facturó nada, ese margen negativo es justo el dato.
    for (const [id, costo] of costoDe) {
      if (porProy.has(id)) continue
      porProy.set(id, {
        idempresa: id, proyecto: nombreDe.get(id) || `Empresa ${id}`, ordenes: 0,
        cobro: 0, contado: 0, credito: 0, sinDefinir: 0, costo, margen: -costo,
      })
    }
    for (const p of porProy.values()) p.margen = p.cobro - p.costo

    const porProyecto = Array.from(porProy.values()).sort((a, b) => b.cobro - a.cobro || a.idempresa - b.idempresa)
    const porTransporte = Array.from(porTr.values()).sort(
      (a, b) => a.idempresa - b.idempresa || b.cobro - a.cobro || a.transporte.localeCompare(b.transporte),
    )

    const tot = porProyecto.reduce(
      (a, p) => ({
        ordenes: a.ordenes + p.ordenes,
        cobro: a.cobro + p.cobro,
        contado: a.contado + p.contado,
        credito: a.credito + p.credito,
        sinDefinir: a.sinDefinir + p.sinDefinir,
        costo: a.costo + p.costo,
        margen: 0,
      }),
      { ordenes: 0, cobro: 0, contado: 0, credito: 0, sinDefinir: 0, costo: 0, margen: 0 },
    )
    tot.margen = tot.cobro - tot.costo

    // El detalle se ordena por valor: lo caro primero, que es lo que hay que
    // perseguir antes de que termine el día.
    for (const b of Object.values(alertas)) b.detalle.sort((a, c) => c.valor - a.valor)

    return {
      success: true,
      data: {
        fecha: dia,
        esDia31: dia.slice(8, 10) === "31",
        totales: tot,
        porProyecto,
        porTransporte,
        alertas,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al armar el cierre del día." }
  }
}
