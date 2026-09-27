"use server"

/**
 * Servicios Adicionales (Turnos/Horas Extra aprobados en Operación LIP >
 * Aprobar Turnos) facturables a Harinera Indupan (idempresa=1).
 *
 * Modelado en el MISMO patrón de negocio que ya usa Conciliación Avimol
 * (lib/conciliacion-avimol-actions.ts) para su segundo concepto facturable,
 * reusando sus funciones puras de vigencia/tarifa (exportadas desde ahí, sin
 * copiarlas). Deliberadamente NO se toca ni se reescribe ese archivo: la
 * lógica de turnos/horas-extra de Avimol está entrelazada con su costeo
 * interno (pago base, recargos, márgenes), y ese módulo ya está validado
 * contra el negocio en producción.
 *
 * Reglas (idénticas a Avimol, salvo la excepción anotada):
 *   · TURNOS: se cobra lo SOLICITADO Y APROBADO (`solicitudesturnos`,
 *     tipo='Turnos'), no lo ejecutado. `cobraturno` y la tarifa (con festivo)
 *     salen de `tarifasfacturacionturnos`.
 *   · HORAS EXTRA: se cobran solo las horas EJECUTADAS (`pagonomina`) que
 *     además fueron SOLICITADAS (`solicitudesturnos`, tipo='Horas Extra').
 *     A diferencia de Avimol, aquí NO hay excepción de "puestos que siempre
 *     cobran su extra" (`PUESTOS_HE_PRODUCCION`): esa regla nace del modelo
 *     asimétrico de producción de Avimol (Salvado/Estibado PT), que no tiene
 *     equivalente en Indupan.
 *   · Puesto no reconocido contra el maestro, `cobraturno='NO'`, o sin tarifa
 *     vigente → NO se cobra y se reporta (nunca se adivina un cobro).
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { normalizarPuesto, resolverPuesto } from "@/lib/puestos-turno-alias"
import { tarifaHoraExtraVigente, filaTurnoVigente, tarifaTurnoVigente, cobraTurno } from "@/lib/tarifas-turno-shared"
import { CONCEPTO_HORA_EXTRA, CONCEPTO_TURNO } from "@/lib/facturacion-produccion-conceptos"
import type { SoporteLinea, ConceptoProduccion, UnidadCobro } from "@/lib/facturacion-control-actions"

const INDUPAN_IDEMPRESA = 1
const INDUPAN_OWNER = "Harinera Indupan"

const num = (v: any) => Number(v || 0)

export async function calcularServiciosAdicionalesIndupan(
  desde: string,
  hasta: string,
): Promise<{ soporte: SoporteLinea[]; conceptos: ConceptoProduccion[]; alertas: string[] }> {
  const alertas: string[] = []
  const soporte: SoporteLinea[] = []
  try {
    const admin: any = await getSupabaseAdmin()

    // Solicitudes aprobadas de Indupan en el rango, separadas por tipo. Si no
    // hay ninguna, no hace falta ni consultar pagonomina/tarifas.
    const solicitudes: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("solicitudesturnos")
        .select("fecharequerida, puesto, cantidad, tipo")
        .eq("idempresa", INDUPAN_IDEMPRESA)
        .eq("estado", "aprobado")
        .gte("fecharequerida", desde)
        .lte("fecharequerida", hasta)
        // Orden único y estable para paginar (ver lib/orden-paginacion.ts).
        .order("id")
        .range(off, off + 999)
      if (error) return { soporte: [], conceptos: [], alertas: [`Error consultando solicitudesturnos de Indupan: ${error.message}`] }
      if (!data || data.length === 0) break
      solicitudes.push(...data)
      if (data.length < 1000) break
    }
    if (solicitudes.length === 0) return { soporte: [], conceptos: [], alertas: [] }

    const turnosAprobados: Array<{ fecha: string; puesto: string; personas: number }> = []
    const solicitadasHEPorFechaPuesto = new Map<string, number>()
    for (const s of solicitudes) {
      const fecha = String(s.fecharequerida).slice(0, 10)
      const tipo = String(s.tipo || "").trim().toUpperCase()
      if (tipo === "HORAS EXTRA") {
        const key = `${fecha}|${String(s.puesto || "").trim().toUpperCase()}`
        solicitadasHEPorFechaPuesto.set(key, (solicitadasHEPorFechaPuesto.get(key) || 0) + num(s.cantidad))
      } else if (tipo === "TURNOS") {
        turnosAprobados.push({ fecha, puesto: String(s.puesto || "").trim(), personas: num(s.cantidad) })
      }
    }

    // Festivos del rango (domingo o fecha en la tabla) -- mismo criterio que Avimol.
    const festivos = new Set<string>()
    {
      const { data } = await admin.from("festivos").select("fecha").gte("fecha", desde).lte("fecha", hasta)
      for (const f of data || []) festivos.add(String(f.fecha).slice(0, 10))
    }
    const esFestivoFecha = (fecha: string): boolean => {
      const [y, m, d] = fecha.split("-").map(Number)
      if (new Date(y, m - 1, d).getDay() === 0) return true
      return festivos.has(fecha)
    }

    // Maestro de tarifas (global, mismo que consulta Avimol).
    const { data: tarifasHE } = await admin
      .from("tarifasfacturacionturnos")
      .select("puesto, tarifahoraextra, tarifaturno, tarifaturnofestivo, cobraturno, fechainicio, fechafin")
    const catalogoPuestos = Array.from(
      new Set((tarifasHE || []).map((t: any) => String(t.puesto || "").trim()).filter(Boolean)),
    ) as string[]

    // Horas extra EJECUTADAS por (fecha, puesto), desde pagonomina -- solo si
    // hay alguna solicitud de tipo Horas Extra en el rango.
    const hePorFechaPuesto = new Map<
      string,
      { fecha: string; puesto: string; hed: number; hedf: number; hen: number; hef: number; hn: number }
    >()
    if (solicitadasHEPorFechaPuesto.size > 0) {
      for (let off = 0; ; off += 1000) {
        const { data, error } = await admin
          .rpc("pagonomina_rango", { p_desde: desde, p_hasta: hasta })
          // `persona` va en el select porque es columna de orden (PostgREST no
          // deja ordenar una función rpc por una columna no seleccionada).
          .select("fecha, persona, actividad_registrada, horas_hed, horas_hedf, horas_hen, horas_hef, horas_hn")
          .eq("idempresa", INDUPAN_IDEMPRESA)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("persona")
          .order("fecha")
          .range(off, off + 999)
        if (error) {
          alertas.push(`Error consultando pagonomina de Indupan: ${error.message}`)
          break
        }
        if (!data || data.length === 0) break
        for (const r of data) {
          const fecha = String(r.fecha).slice(0, 10)
          const puesto = String(r.actividad_registrada || "").trim()
          const hed = num(r.horas_hed)
          const hedf = num(r.horas_hedf)
          const hen = num(r.horas_hen)
          const hef = num(r.horas_hef)
          const hn = num(r.horas_hn)
          if (!puesto || hed + hedf + hen + hef + hn <= 0) continue
          const key = `${fecha}|${puesto.toUpperCase()}`
          const acc = hePorFechaPuesto.get(key) || { fecha, puesto, hed: 0, hedf: 0, hen: 0, hef: 0, hn: 0 }
          acc.hed += hed
          acc.hedf += hedf
          acc.hen += hen
          acc.hef += hef
          acc.hn += hn
          hePorFechaPuesto.set(key, acc)
        }
        if (data.length < 1000) break
      }
    }

    const conceptosMap = new Map<string, { unidad: UnidadCobro; cantidad: number; valor: number; tarifa: number }>()
    const acumConcepto = (concepto: string, unidad: UnidadCobro, cantidad: number, valor: number, tarifa: number) => {
      const e = conceptosMap.get(concepto) || { unidad, cantidad: 0, valor: 0, tarifa: 0 }
      e.cantidad += cantidad
      e.valor += valor
      if (tarifa > 0) e.tarifa = tarifa
      conceptosMap.set(concepto, e)
    }

    // HORAS EXTRA facturables: solo lo solicitado Y ejecutado.
    const sinTarifaHE = new Set<string>()
    for (const acc of hePorFechaPuesto.values()) {
      const horas = acc.hed + acc.hedf + acc.hen + acc.hef + acc.hn
      const solicitadas = solicitadasHEPorFechaPuesto.get(`${acc.fecha}|${acc.puesto.toUpperCase()}`) || 0
      if (solicitadas <= 0) {
        if (horas > 0) {
          alertas.push(
            `${acc.puesto} · ${acc.fecha}: se ejecutaron ${horas.toFixed(2)} h extra pero NO hay solicitud aprobada ` +
              `(Servicios Adicionales, tipo "Horas Extra") -- no se cobran.`,
          )
        }
        continue
      }
      const tarifa = tarifaHoraExtraVigente(tarifasHE || [], acc.puesto, acc.fecha)
      if (tarifa === 0) {
        sinTarifaHE.add(`${acc.puesto}|${acc.fecha}`)
        continue
      }
      const cobro = horas * tarifa
      const concepto = `${CONCEPTO_HORA_EXTRA} · ${acc.puesto}`
      acumConcepto(concepto, "h", horas, cobro, tarifa)
      soporte.push({
        owner: INDUPAN_OWNER,
        operacion: concepto,
        servicio: "Hora extra",
        fecha: acc.fecha,
        numeroorden: "—",
        placa: null,
        cliente: null,
        producto: `HED ${acc.hed} · HEDF ${acc.hedf} · HEN ${acc.hen} · HEF ${acc.hef} · HN ${acc.hn}`,
        toneladas: Number(horas.toFixed(2)),
        tarifa,
        valor: Math.round(cobro),
        unidad: "h",
        grupoAnexo: "Servicios Adicionales",
      })
      if (horas > solicitadas) {
        alertas.push(
          `${acc.puesto} · ${acc.fecha}: se ejecutaron ${horas.toFixed(2)} h extra pero el proyecto solicitó ` +
            `${solicitadas.toFixed(2)} h (exceso de ${(horas - solicitadas).toFixed(2)} h).`,
        )
      }
    }
    for (const k of sinTarifaHE) {
      const [p, f] = k.split("|")
      alertas.push(`Sin tarifa de hora extra vigente en tarifasfacturacionturnos para el puesto "${p}" el ${f} -- esas horas se facturan en $0.`)
    }

    // TURNOS facturables: se cobra lo solicitado Y aprobado, no lo ejecutado.
    const acc2 = new Map<string, { fecha: string; texto: string; personas: number }>()
    for (const s of turnosAprobados) {
      if (s.personas <= 0) continue
      const k = `${s.fecha}|${normalizarPuesto(s.puesto)}`
      const a = acc2.get(k) || { fecha: s.fecha, texto: s.puesto, personas: 0 }
      a.personas += s.personas
      acc2.set(k, a)
    }
    const noReconocidos = new Map<string, { personas: number; fechas: Set<string> }>()
    const noCobrables = new Map<string, number>()
    const sinTarifaTurno = new Set<string>()
    for (const a of acc2.values()) {
      const { puesto, via } = resolverPuesto(a.texto, catalogoPuestos)
      if (!puesto) {
        const n = noReconocidos.get(a.texto) || { personas: 0, fechas: new Set<string>() }
        n.personas += a.personas
        n.fechas.add(a.fecha)
        noReconocidos.set(a.texto, n)
        continue
      }
      const fila = filaTurnoVigente(tarifasHE || [], puesto, a.fecha)
      if (!cobraTurno(fila)) {
        noCobrables.set(puesto, (noCobrables.get(puesto) || 0) + a.personas)
        continue
      }
      const tarifa = tarifaTurnoVigente(fila, esFestivoFecha(a.fecha))
      if (tarifa <= 0) {
        sinTarifaTurno.add(`${puesto}|${a.fecha}`)
        continue
      }
      const cobro = a.personas * tarifa
      const concepto = `${CONCEPTO_TURNO} · ${puesto}`
      acumConcepto(concepto, "turno", a.personas, cobro, tarifa)
      soporte.push({
        owner: INDUPAN_OWNER,
        operacion: concepto,
        servicio: "Turno",
        fecha: a.fecha,
        numeroorden: "—",
        placa: null,
        cliente: null,
        producto: `${a.personas} turno(s) aprobado(s)` + (via === "alias" ? ` · solicitado como "${a.texto}"` : ""),
        toneladas: a.personas,
        tarifa,
        valor: Math.round(cobro),
        unidad: "turno",
        grupoAnexo: "Servicios Adicionales",
      })
    }
    for (const [texto, n] of noReconocidos) {
      const fechas = Array.from(n.fechas).sort()
      alertas.push(
        `Solicitud de turno con puesto "${texto}" (${n.personas} persona(s), ${fechas[0]}${fechas.length > 1 ? ` … ${fechas[fechas.length - 1]}` : ""}): ` +
          `no corresponde a ningún puesto de tarifasfacturacionturnos, así que NO se cobró.`,
      )
    }
    for (const [puesto, personas] of noCobrables) {
      alertas.push(`${puesto}: ${personas} turno(s) aprobado(s) NO se cobran porque el maestro tiene cobraturno = NO.`)
    }
    for (const k of sinTarifaTurno) {
      const [p, f] = k.split("|")
      alertas.push(`Sin tarifa de turno vigente en tarifasfacturacionturnos para "${p}" el ${f} -- ese turno se factura en $0.`)
    }

    const conceptos: ConceptoProduccion[] = []
    for (const [concepto, c] of conceptosMap) {
      if (c.cantidad <= 0) continue
      conceptos.push({
        concepto,
        unidad: c.unidad,
        cantidad: Number(c.cantidad.toFixed(c.unidad === "h" ? 2 : 3)),
        valor: Math.round(c.valor),
        tarifa: c.cantidad > 0 ? Math.round((c.valor / c.cantidad) * 100) / 100 : c.tarifa,
      })
    }
    conceptos.sort((a, b) => a.concepto.localeCompare(b.concepto, "es"))

    return { soporte, conceptos, alertas }
  } catch (e: any) {
    return { soporte: [], conceptos: [], alertas: [`Error al calcular Servicios Adicionales de Indupan: ${e?.message || e}`] }
  }
}
