"use server"

/**
 * Server actions de "Ajuste Nómina Anterior" (Compensación › Revisión de nómina;
 * antes "Ajuste de Proyecciones" — renombrado, ya no se proyecta nada a mano).
 *
 * MODELO VIGENTE (desde el cierre del 2026-08-15): ya NO se proyecta nada a mano. El último
 * día de cada quincena (el 15, o el último día del mes) a quien gana por
 * destajo se le paga el "día pleno" — un día de base fija (salario/30, o el
 * mínimo $58.364 si no tiene salario propio), igual que a cualquier otro día,
 * SIN mirar el tonelaje — porque cuando se genera y envía la nómina, las
 * órdenes de ese día casi nunca han cerrado todavía.
 *
 * Este módulo cruza, el día siguiente al pago (el 16 y el 1º):
 *     valor_real   (SOLO órdenes reales de cargue/descargue/distribución de
 *                   ESE día, ya cerradas, en plata según tarifaspersonal)
 *   − valor_pagado (el día pleno que se le pagó de base: salario/30 o $58.364)
 *   = diferencia -> se paga o se descuenta en la quincena SIGUIENTE.
 *
 * El reparto por persona replica EXACTAMENTE el de `pagonomina`
 * (peso_base_calculo ÷ cantidad_auxiliares), para que la comparación sea 1:1.
 * Solo aplica a quien gana por TONELADAS ese día (quien aparece en los
 * auxiliares de una orden real) — el personal de turno no entra aquí.
 *
 * Los ajustes nacen 'pendiente'; solo al aprobarse salen al archivo plano.
 *
 * Histórico: hasta 2026-08-30 este cruce comparaba contra una proyección
 * manual (`cabeceraoc.tipooperacion = 'proyeccion'`) que el negocio dejó de
 * usar. Los ajustes ya generados/aprobados con el modelo viejo no se tocan.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { aplicarOrdenEstable } from "@/lib/orden-paginacion"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import {
  NOVEDAD_AJUSTE_INGRESO,
  NOVEDAD_AJUSTE_DEDUCCION,
  rangoQuincena,
  quincenaSiguiente,
  type EstadoAjuste,
} from "@/lib/ajuste-proyeccion-constants"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const num = (v: any) => Number(v || 0)

/** Réplica de `peso_base_calculo` de 053_pagonomina_reemplazo.sql. */
function pesoBaseCalculo(idempresa: number, tipooperacion: string, pesovascula: number, pesoorden: number): number {
  const cedis = idempresa === 3 || idempresa === 4
  if (cedis && tipooperacion === "Descargue") {
    if (pesovascula <= 0) return pesoorden
    const norm = pesoorden > 0 && pesovascula / pesoorden > 50 ? pesovascula / 1000 : pesovascula
    if (pesoorden > 0) {
      const r = norm / pesoorden
      if (r < 0.1 || r > 10) return pesoorden
    }
    return norm
  }
  if (cedis) return pesoorden
  return pesovascula
}

/**
 * AVIMOL (idempresa=2): la Distribución NO se paga por destajo — el clon
 * automático "+D" hereda los mismos `auxiliares` de su Cargue madre, así que
 * sin esta exclusión esas personas cobrarían su tonelaje de Cargue Y OTRA VEZ
 * el de la Distribución clon (doble conteo). Ya está cubierta aparte por las
 * 300 t fijas de facturación (lib/cargos-fijos-actions.ts) — concepto de
 * FACTURACIÓN, no de nómina. Mismo criterio que scripts/053_pagonomina_reemplazo.sql
 * (CTE `transformacion`); si se toca uno, tocar el otro.
 */
function excluirAvimolDistribucion(idempresa: number, tipooperacion: string): boolean {
  return idempresa === 2 && tipooperacion === "Distribucion"
}

export interface AjusteLinea {
  id?: number
  idempresa: number
  fechaProyectada: string
  persona: string
  identificacion: string | null
  /** Histórico (modelo viejo): siempre 0 con el modelo de día pleno. */
  tonProyectada: number
  /** Histórico (modelo viejo): siempre null con el modelo de día pleno. */
  horaCorte: string | null
  /** Toneladas reales del día de cierre (informativo — el pagado ya no es tonelaje). */
  tonReal: number
  valorPagado: number
  valorReal: number
  valorAjuste: number
  novedadSiigo: string
  estado?: EstadoAjuste
  aprobadoPor?: string | null
  observacion?: string | null
}

export interface CruceProyeccionData {
  quincena: { anio: number; mes: number; num: number; desde: string; hasta: string }
  aplicaEn: { anio: number; mes: number; quincena: number }
  /** El único día de cierre de la quincena (el 15, o el último día del mes). */
  fechaCierre: string
  resumen: {
    personas: number
    tonReal: number
    valorPagado: number
    valorReal: number
    valorAFavorTrabajador: number
    valorAFavorEmpresa: number
    neto: number
    yaRegistrados: number
    /** Toneladas de Distribución en Avimol el día de cierre — ya excluidas del destajo, solo informativo. */
    tonDistribucionAvimolExcluida: number
  }
  lineas: AjusteLinea[]
  /** Nadie ganó por destajo el día de cierre: no hay nada que ajustar. */
  sinMovimiento: boolean
}

async function paginar(sb: any, tabla: string, cols: string, filtros: (q: any) => any): Promise<any[]> {
  const out: any[] = []
  for (let off = 0; ; off += 1000) {
    // Orden único y estable para paginar (ver lib/orden-paginacion.ts).
    const { data, error } = await filtros(aplicarOrdenEstable(sb.from(tabla).select(cols), tabla).range(off, off + 999))
    if (error) throw new Error(`${tabla}: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

/**
 * Calcula el cruce de la quincena. NO escribe nada: es la vista previa que se
 * revisa antes de generar los ajustes.
 */
export async function getCruceProyeccion(
  anio: number,
  mes: number,
  quincena: 1 | 2,
  empresa: number, // 0 = todas
): Promise<{ success: boolean; data?: CruceProyeccionData; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { desde, hasta } = rangoQuincena(anio, mes, quincena)
    const emps = [1, 2, 3, 4, 6].includes(empresa) ? [empresa] : null
    // El día de cierre es SIEMPRE el último de la quincena (el 15, o el
    // último día del mes) — ya no se detecta desde una proyección manual.
    const fechaCierre = hasta
    const aplicaEn = quincenaSiguiente(anio, mes, quincena)

    // 1) Órdenes REALES cerradas ese único día (mismo universo que pagonomina:
    //    fincargue no nulo). Se descarta `tipooperacion='proyeccion'` por si
    //    queda alguna fila vieja del modelo manual — ya no cuenta como real.
    const ordenes = await paginar(
      sb,
      "cabeceraoc",
      "id, idempresa, ordendecargue, fechacargue, tipooperacion, pesovascula, pesoorden, auxiliares",
      (q: any) => {
        let x = q.eq("fechacargue", fechaCierre).not("fincargue", "is", null)
        if (emps) x = x.in("idempresa", emps)
        return x
      },
    )

    // 2) Tarifas de destajo vigentes (mismo join que pagonomina).
    const tarifas = await paginar(sb, "tarifaspersonal", "empresaid, operacion, tarifa, fechaini, fechafin", (q: any) => q)
    const tarifaDe = (empresaId: number, operacion: string, fecha: string): number => {
      for (const t of tarifas) {
        if (Number(t.empresaid) !== empresaId) continue
        if (String(t.operacion) !== operacion) continue
        if (String(t.fechaini).slice(0, 10) <= fecha && fecha <= String(t.fechafin).slice(0, 10)) return num(t.tarifa)
      }
      return 0
    }

    // 3) REAL por persona ese día: reparto idéntico al de pagonomina
    //    (peso ÷ cantidad de auxiliares), convertido a plata con la tarifa
    //    vigente. Excluye Avimol+Distribución (ver excluirAvimolDistribucion)
    //    para que "real" no incluya algo que pagonomina tampoco paga.
    const realTon = new Map<string, number>()
    const realVal = new Map<string, number>()
    const empresaDe = new Map<string, number>()
    let tonDistribucionAvimolExcluida = 0
    for (const o of ordenes) {
      const tipo = String(o.tipooperacion || "").trim()
      if (tipo === "proyeccion") continue
      const emp = Number(o.idempresa)
      const aux = String(o.auxiliares || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const peso = pesoBaseCalculo(emp, tipo, num(o.pesovascula), num(o.pesoorden))
      if (excluirAvimolDistribucion(emp, tipo)) {
        if (peso > 0) tonDistribucionAvimolExcluida += peso
        continue
      }
      if (aux.length === 0 || peso <= 0) continue
      const porPersona = peso / aux.length
      const tarifa = tarifaDe(emp, tipo, fechaCierre)
      for (const p of aux) {
        const k = p.toUpperCase()
        realTon.set(k, (realTon.get(k) || 0) + porPersona)
        realVal.set(k, (realVal.get(k) || 0) + porPersona * tarifa)
        if (!empresaDe.has(k)) empresaDe.set(k, emp)
      }
    }

    // 4) PAGADO = "día pleno" (salario/30, o $58.364 si no tiene salario
    //    propio) — el mismo `valor_diario_ley` que usa pagonomina para
    //    cualquier día. Ya no depende de una proyección ni de una hora de
    //    corte: es un valor fijo, igual para todos los que ganan por
    //    destajo, solo aplica a quien tuvo tonelaje real ese día (arriba).
    const hc = await paginar(sb, "headcount", "nombre, identificacion, salario", (q: any) => q)
    const salarioDe = new Map<string, number>()
    const cedulaDe = new Map<string, string>()
    for (const h of hc) {
      const k = String(h.nombre || "").trim().toUpperCase()
      if (!k) continue
      if (!salarioDe.has(k)) salarioDe.set(k, num(h.salario))
      const c = String(h.identificacion || "").trim()
      if (c && !cedulaDe.has(k)) cedulaDe.set(k, c)
    }
    const DIA_PLENO_MINIMO = 58364
    const diaPlenoDe = (personaUpper: string): number => {
      const salario = salarioDe.get(personaUpper) || 0
      return salario > 0 ? salario / 30 : DIA_PLENO_MINIMO
    }

    // 5) Nombre "bonito" tal como viene de cabeceraoc.auxiliares.
    const nombreReal = new Map<string, string>()
    for (const o of ordenes) {
      for (const p of String(o.auxiliares || "").split(",")) {
        const t = p.trim()
        if (t && !nombreReal.has(t.toUpperCase())) nombreReal.set(t.toUpperCase(), t)
      }
    }

    // 6) Armar las líneas: solo quien tuvo tonelaje real ese día (sin eso no
    //    hay nada que comparar contra el día pleno).
    const lineas: AjusteLinea[] = []
    for (const personaUpper of realTon.keys()) {
      const persona = nombreReal.get(personaUpper) || personaUpper
      if (/prueba/i.test(persona)) continue // pagonomina nunca les paga
      const tonReal = realTon.get(personaUpper) || 0
      const valorReal = realVal.get(personaUpper) || 0
      const valorPagado = diaPlenoDe(personaUpper)
      const valorAjuste = valorReal - valorPagado
      if (Math.abs(valorAjuste) < 1) continue // menos de $1: ruido de redondeo
      lineas.push({
        idempresa: empresaDe.get(personaUpper) || 0,
        fechaProyectada: fechaCierre,
        persona,
        identificacion: cedulaDe.get(personaUpper) || null,
        tonProyectada: 0,
        horaCorte: null,
        tonReal,
        valorPagado,
        valorReal,
        valorAjuste,
        novedadSiigo: valorAjuste >= 0 ? NOVEDAD_AJUSTE_INGRESO : NOVEDAD_AJUSTE_DEDUCCION,
      })
    }
    lineas.sort((a, b) => Math.abs(b.valorAjuste) - Math.abs(a.valorAjuste))

    // 7) ¿Cuántos ya están registrados? (para no re-generar a ciegas)
    const { data: yaReg } = await sb
      .from("ajustes_proyeccion")
      .select("id", { count: "exact" })
      .eq("fecha_proyectada", fechaCierre)

    const aFavorTrab = lineas.filter((l) => l.valorAjuste > 0).reduce((a, l) => a + l.valorAjuste, 0)
    const aFavorEmp = lineas.filter((l) => l.valorAjuste < 0).reduce((a, l) => a + l.valorAjuste, 0)

    return {
      success: true,
      data: {
        quincena: { anio, mes, num: quincena, desde, hasta },
        aplicaEn,
        fechaCierre,
        resumen: {
          personas: lineas.length,
          tonReal: lineas.reduce((a, l) => a + l.tonReal, 0),
          valorPagado: lineas.reduce((a, l) => a + l.valorPagado, 0),
          valorReal: lineas.reduce((a, l) => a + l.valorReal, 0),
          valorAFavorTrabajador: aFavorTrab,
          valorAFavorEmpresa: aFavorEmp,
          neto: aFavorTrab + aFavorEmp,
          yaRegistrados: (yaReg || []).length,
          tonDistribucionAvimolExcluida,
        },
        lineas,
        sinMovimiento: lineas.length === 0,
      },
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al calcular el cruce del día pleno." }
  }
}

/** Persiste el cruce como ajustes PENDIENTES (upsert: re-correr no duplica). */
/**
 * Piso de vigencia del modelo de día pleno: antes de esta fecha, el día de
 * cierre TODAVÍA manda su excedente de destajo dentro de la MISMA quincena
 * (archivoplano no lo excluye todavía — ver scripts/059_archivoplano_reemplazo.sql,
 * "EXCLUIR EL DÍA DE CIERRE"). Generar un ajuste diferido para un día anterior
 * a este piso pagaría esa diferencia DOS VECES: una de una vez (novedad 52 de
 * esa quincena) y otra fundida en el 52- de la quincena siguiente (ver
 * `ajustes_aplicables` en 059_archivoplano_reemplazo.sql). No mover sin correr
 * antes esa migración Y confirmar que ya está desplegada.
 */
const PISO_VIGENCIA_DIA_PLENO = "2026-08-15"

export async function generarAjustes(
  anio: number,
  mes: number,
  quincena: 1 | 2,
  empresa: number,
): Promise<{ success: boolean; creados?: number; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Proyecciones"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    const cruce = await getCruceProyeccion(anio, mes, quincena, empresa)
    if (!cruce.success || !cruce.data) return { success: false, message: cruce.message }
    if (cruce.data.fechaCierre < PISO_VIGENCIA_DIA_PLENO) {
      return {
        success: false,
        message: `El día de cierre (${cruce.data.fechaCierre}) es anterior al ${PISO_VIGENCIA_DIA_PLENO}: ese día todavía envía su excedente de destajo en la misma quincena, así que generar este ajuste lo pagaría dos veces. Este cruce solo aplica desde cierres del ${PISO_VIGENCIA_DIA_PLENO} en adelante.`,
      }
    }
    if (cruce.data.lineas.length === 0) return { success: false, message: "No hay diferencias que ajustar." }

    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert()
    const ap = cruce.data.aplicaEn

    const filas = cruce.data.lineas.map((l) => ({
      idempresa: l.idempresa,
      fecha_proyectada: l.fechaProyectada,
      anio,
      mes,
      quincena,
      persona: l.persona,
      identificacion: l.identificacion,
      ton_proyectada: l.tonProyectada,
      hora_corte: l.horaCorte,
      ton_pagada: 0,
      ton_real: l.tonReal,
      diferencia_ton: 0,
      valor_pagado: l.valorPagado,
      valor_real: l.valorReal,
      valor_ajuste: l.valorAjuste,
      novedad_siigo: l.novedadSiigo,
      anio_aplica: ap.anio,
      mes_aplica: ap.mes,
      quincena_aplica: ap.quincena,
      estado: "pendiente",
      creado_por: usuario,
    }))

    // Upsert por (idempresa, fecha_proyectada, persona): si el cruce se vuelve
    // a correr porque llegaron más órdenes, se ACTUALIZA el ajuste en vez de
    // crear uno nuevo — si no, se pagaría dos veces la misma diferencia.
    const { error } = await sb
      .from("ajustes_proyeccion")
      .upsert(filas, { onConflict: "idempresa,fecha_proyectada,persona" })
    if (error) return { success: false, message: error.message }
    return { success: true, creados: filas.length }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al generar los ajustes." }
  }
}

export interface AjusteRow extends AjusteLinea {
  id: number
  anio: number
  mes: number
  quincena: number
  anioAplica: number
  mesAplica: number
  quincenaAplica: number
  estado: EstadoAjuste
  creadoPor: string | null
  creado: string | null
  aprobadoPor: string | null
  aprobadoEn: string | null
}

export async function getAjustes(filtros: {
  anio?: number
  mes?: number
  quincena?: 1 | 2
  estado?: EstadoAjuste | "todos"
}): Promise<{ success: boolean; data: AjusteRow[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()
    const rows = await paginar(sb, "ajustes_proyeccion", "*", (q: any) => {
      let x = q.order("fecha_proyectada", { ascending: false })
      if (filtros.anio) x = x.eq("anio", filtros.anio)
      if (filtros.mes) x = x.eq("mes", filtros.mes)
      if (filtros.quincena) x = x.eq("quincena", filtros.quincena)
      if (filtros.estado && filtros.estado !== "todos") x = x.eq("estado", filtros.estado)
      return x
    })
    return {
      success: true,
      data: rows.map((r: any) => ({
        id: Number(r.id),
        idempresa: Number(r.idempresa),
        fechaProyectada: String(r.fecha_proyectada).slice(0, 10),
        anio: Number(r.anio),
        mes: Number(r.mes),
        quincena: Number(r.quincena),
        persona: String(r.persona || ""),
        identificacion: r.identificacion || null,
        tonProyectada: num(r.ton_proyectada),
        horaCorte: r.hora_corte || null,
        tonReal: num(r.ton_real),
        valorPagado: num(r.valor_pagado),
        valorReal: num(r.valor_real),
        valorAjuste: num(r.valor_ajuste),
        novedadSiigo: String(r.novedad_siigo || ""),
        anioAplica: Number(r.anio_aplica),
        mesAplica: Number(r.mes_aplica),
        quincenaAplica: Number(r.quincena_aplica),
        estado: String(r.estado || "pendiente") as EstadoAjuste,
        creadoPor: r.creado_por || null,
        creado: r.creado || null,
        aprobadoPor: r.aprobado_por || null,
        aprobadoEn: r.aprobado_en || null,
        observacion: r.observacion || null,
      })),
    }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al listar los ajustes." }
  }
}

/** Aprueba ajustes: desde aquí SÍ salen al archivo plano. */
export async function aprobarAjustes(ids: number[]): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Proyecciones"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!ids?.length) return { success: false, message: "Selecciona al menos un ajuste." }
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert()
    const { error } = await sb
      .from("ajustes_proyeccion")
      .update({ estado: "aprobado", aprobado_por: usuario, aprobado_en: new Date().toISOString() })
      .in("id", ids)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al aprobar." }
  }
}

export async function rechazarAjustes(ids: number[], motivo: string): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Proyecciones"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!ids?.length) return { success: false, message: "Selecciona al menos un ajuste." }
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert()
    const { error } = await sb
      .from("ajustes_proyeccion")
      .update({
        estado: "rechazado",
        aprobado_por: usuario,
        aprobado_en: new Date().toISOString(),
        observacion: String(motivo || "").trim() || null,
      })
      .in("id", ids)
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al rechazar." }
  }
}
