"use server"

// SEGURIDAD · etapa 2 (2026-10-03). Lecturas y escrituras FINANCIERAS y de NÓMINA que antes
// hacía el navegador directo contra Supabase (rol `authenticated`, saltándose los permisos por
// módulo de la app). Ahora pasan por aquí: sesión obligatoria + permiso del módulo que las usa
// (MODULE_PERMISSION_MAP, el mismo de PermissionGuard) + service role en el servidor. Con eso el
// SQL 221 puede quitar a `authenticated` el acceso directo a estas tablas, vistas y funciones.
// Las consultas son IDÉNTICAS a las que hacían los componentes (mismos filtros, mismo orden):
// los números no cambian. Paginado en bloques de 1000 (PostgREST corta en 1000 sin avisar).

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getCurrentUser, getUserProfile } from "@/lib/auth-actions"
import { exigirSegundoFactorSiActivo } from "@/lib/seguridad-servidor"
import { checkModulePermission } from "@/lib/permissions-actions"
import { aplicarOrdenEstable } from "@/lib/orden-paginacion"
import { registrarErrorServidor } from "@/lib/errores-servidor"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const PAGE = 1000
const MAX_ROWS = 300_000

type Fila = Record<string, any>

/** Sesión obligatoria y permiso de AL MENOS uno de los módulos indicados (los mismos nombres del menú). */
async function exigir(modulos: string[]): Promise<void> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) throw new Error("Sesión requerida.")
  for (const m of modulos) {
    if (await checkModulePermission(m)) {
      // Segundo factor (2026-10-05): lo financiero es solo de LIP; si la cuenta tiene el
      // segundo factor activado, esta sesión debe haberlo verificado. Quien no lo tiene
      // activado sigue igual que hoy; ningún permiso cambia.
      await exigirSegundoFactorSiActivo(`finanzas:${m}`)
      return
    }
  }
  throw new Error(`Sin permiso para ${modulos[0]}.`)
}

/** Trae TODAS las filas de una consulta paginando con .range(); `armar` recibe (from, to). */
async function todas<T = Fila>(armar: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = []
  let offset = 0
  while (offset < MAX_ROWS) {
    const { data, error } = await armar(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    out.push(...page)
    if (page.length < PAGE) break
    offset += PAGE
  }
  return out
}

const ESTADO_RESULTADOS = ["Estado de Resultados"]
const NOMINA = ["Nominapersonal"]
const GASTOS = ["Dashboard Gastos", "Registrar Gasto"]
const PERSONAL_BASICO = ["Tolva", "Ver Tolva", "Liquidación Tolva del día", "Novedades de personal", "Estado de Resultados", "Nominapersonal"]

// ---------------------------------------------------------------- Estado de Resultados

/** facturacion: filas de toneladas del período (fechacargue en [desde, hastaExclusivo)). */
export async function leerFacturacionRango(ids: number[], desde: string, hastaExclusivo: string): Promise<Fila[]> {
  await exigir(ESTADO_RESULTADOS)
  const sb: any = await getSupabaseAdminAsSystem()
  return todas((from, to) =>
    aplicarOrdenEstable(
      sb.from("facturacion").select("valor_a_facturar, tipooperacion, owner, toneladas, transporte, idempresa, placa, subcategoria").in("idempresa", ids).gte("fechacargue", desde).lt("fechacargue", hastaExclusivo),
      "facturacion",
    ).range(from, to),
  )
}

/** Vista facturacionturnos: (facturacion_total, puesto) del período, por ids. */
export async function leerFacturacionTurnosRango(ids: number[], desde: string, hasta: string): Promise<Fila[]> {
  await exigir(ESTADO_RESULTADOS)
  const sb: any = await getSupabaseAdminAsSystem()
  return todas((from, to) =>
    aplicarOrdenEstable(sb.from("facturacionturnos").select("facturacion_total, puesto").in("idempresa", ids).gte("fecha", desde).lte("fecha", hasta), "facturacionturnos").range(from, to),
  )
}

/** cargos_fijos_generados por tipo ('ingreso' | 'gasto'); tolerante a que la tabla no exista. */
export async function leerCargosFijosGenerados(ids: number[], tipo: "ingreso" | "gasto", desde: string, hasta: string): Promise<Fila[]> {
  await exigir(ESTADO_RESULTADOS)
  const sb: any = await getSupabaseAdminAsSystem()
  try {
    return await todas((from, to) =>
      aplicarOrdenEstable(sb.from("cargos_fijos_generados").select("valor, concepto").in("idempresa", ids).eq("tipo", tipo).gte("periodo", desde).lte("periodo", hasta), "cargos_fijos_generados").range(from, to),
    )
  } catch (e: any) {
    console.warn("[estado-resultados] cargos_fijos_generados no disponible todavía:", e?.message ?? e)
    return []
  }
}

/** gastos (categoria, monto) del período; la tabla usa id_empresa y fecha DATE. */
export async function leerGastosRango(ids: number[], desde: string, hasta: string): Promise<Fila[]> {
  await exigir([...ESTADO_RESULTADOS, ...GASTOS])
  const sb: any = await getSupabaseAdminAsSystem()
  return todas((from, to) => sb.from("gastos").select("categoria, monto").in("id_empresa", ids).gte("fecha", desde).lte("fecha", hasta).order("id").range(from, to))
}

/** prestaciones_activos_pagos pagadas que cubren completo [desde, hasta] para el concepto. */
export async function leerPrestacionesPagadas(ids: number[], concepto: string, desde: string, hasta: string): Promise<Fila[]> {
  await exigir(ESTADO_RESULTADOS)
  const sb: any = await getSupabaseAdminAsSystem()
  const { data, error } = await sb
    .from("prestaciones_activos_pagos")
    .select("idempresa, periodo_desde, periodo_hasta, valor_real, valor_calculado, estado")
    .eq("concepto", concepto)
    .eq("estado", "pagada")
    .in("idempresa", ids)
    .lte("periodo_desde", desde)
    .gte("periodo_hasta", hasta)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Nombres del personal RETIRADO (headcount.estado = 'Inactivo'), sin filtro de empresa (como siempre). */
export async function leerNombresRetirados(): Promise<string[]> {
  await exigir([...ESTADO_RESULTADOS, ...NOMINA])
  const sb: any = await getSupabaseAdminAsSystem()
  const filas = await todas<{ nombre: string | null }>((from, to) => sb.from("headcount").select("nombre").eq("estado", "Inactivo").order("id").range(from, to))
  return filas.map((h) => String(h.nombre ?? ""))
}

/** ajustes_proyeccion aprobados de las empresas. */
export async function leerAjustesProyeccionAprobados(ids: number[]): Promise<Fila[]> {
  await exigir(ESTADO_RESULTADOS)
  const sb: any = await getSupabaseAdminAsSystem()
  return todas((from, to) => sb.from("ajustes_proyeccion").select("persona, idempresa, valor_ajuste, anio_aplica, mes_aplica, quincena_aplica").eq("estado", "aprobado").in("idempresa", ids).order("id").range(from, to))
}

/** bonos_nomina aprobados (no prestacionales) del período. */
export async function leerBonosNominaAprobados(ids: number[], desde: string, hasta: string): Promise<Fila[]> {
  await exigir(ESTADO_RESULTADOS)
  const sb: any = await getSupabaseAdminAsSystem()
  return todas((from, to) => sb.from("bonos_nomina").select("nombre, valor").eq("estado", "aprobado").in("idempresa", ids).gte("fecha", desde).lte("fecha", hasta).order("id").range(from, to))
}

// ---------------------------------------------------------------- Nómina (pagonomina_rango)

/**
 * Función pagonomina_rango(p_desde, p_hasta) filtrada por idempresaliquidacion (empresa CONTRATANTE
 * de la liquidación), con los filtros opcionales de fecha y el orden estable que usa cada pantalla.
 *  - Estado de Resultados: columnas de costo, orden (persona, fecha).
 *  - Nominapersonal › Ver Liquidación: todas las columnas de la tabla, orden (fecha desc, persona).
 */
export async function leerPagonominaRango(input: {
  ids: number[]
  pDesde: string
  pHasta: string
  fechaDesde?: string | null
  fechaHasta?: string | null
  columnas: string
  orden: "persona_fecha" | "fecha_desc_persona"
}): Promise<Fila[]> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Nominapersonal", "Acumulados LIPgo", "Parafiscales", "Liquidaciones", "Revisión de nómina"], "ver")
  if (motivoAccion) throw new Error(motivoAccion)
  await exigir([...ESTADO_RESULTADOS, ...NOMINA])
  const sb: any = await getSupabaseAdminAsSystem()
  const leerTramo = (pDesde: string, pHasta: string) =>
    todas((from, to) => {
      let q = sb.rpc("pagonomina_rango", { p_desde: pDesde, p_hasta: pHasta }).select(input.columnas).in("idempresaliquidacion", input.ids)
      if (input.fechaDesde) q = q.gte("fecha", input.fechaDesde)
      if (input.fechaHasta) q = q.lte("fecha", input.fechaHasta)
      q = input.orden === "persona_fecha" ? q.order("persona").order("fecha") : q.order("fecha", { ascending: false }).order("persona")
      return q.range(from, to)
    })
  // RENDIMIENTO (2026-10-03): pagonomina_rango se recalcula completa en CADA página de 1.000
  // filas (un mes ~1,2 s; nueve meses ~5,8 s por página). Un rango largo se parte por mes,
  // hasta 4 en paralelo, y se reordena igual que la consulta original. Si el rango es
  // enorme (fecha vacía → "2000-01-01") se deja una sola consulta, como antes.
  const tramos = tramosMensuales(input.pDesde, input.pHasta)
  const partes = tramos.length > 1 && tramos.length <= 36 ? await enParaleloFin(tramos, 4, (t) => leerTramo(t.desde, t.hasta)) : [await leerTramo(input.pDesde, input.pHasta)]
  const filas = partes.flat()
  if (partes.length > 1) {
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    filas.sort((a, b) =>
      input.orden === "persona_fecha"
        ? cmp(String(a.persona ?? ""), String(b.persona ?? "")) || cmp(String(a.fecha ?? ""), String(b.fecha ?? ""))
        : cmp(String(b.fecha ?? ""), String(a.fecha ?? "")) || cmp(String(a.persona ?? ""), String(b.persona ?? "")),
    )
  }
  return filas
}

/** Divide [desde, hasta] (YYYY-MM-DD) en tramos por mes calendario, recortados al rango. */
function tramosMensuales(desde: string, hasta: string): { desde: string; hasta: string }[] {
  const out: { desde: string; hasta: string }[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) return [{ desde, hasta }]
  let y = Number(desde.slice(0, 4))
  let m = Number(desde.slice(5, 7))
  for (let i = 0; i < 400; i++) {
    const ini = `${y}-${String(m).padStart(2, "0")}-01`
    const fin = `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`
    if (ini > hasta) break
    out.push({ desde: ini < desde ? desde : ini, hasta: fin > hasta ? hasta : fin })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out.length ? out : [{ desde, hasta }]
}

async function enParaleloFin<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let siguiente = 0
  const trabajador = async () => {
    for (;;) {
      const i = siguiente++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador))
  return out
}

/** Vista toneladasauxiliarespago: todas las filas de la empresa (orden fechacargue desc, persona). */
export async function leerToneladasAuxiliaresPago(empresaId: number): Promise<Fila[]> {
  await exigir(NOMINA)
  const sb: any = await getSupabaseAdminAsSystem()
  return todas((from, to) => sb.from("toneladasauxiliarespago").select("*").eq("idempresa", empresaId).order("fechacargue", { ascending: false }).order("persona").range(from, to))
}

/** toneladasauxiliares: todas las filas de la empresa (orden fechacargue desc, igual que la pantalla). */
export async function leerToneladasAuxiliares(empresaId: number): Promise<Fila[]> {
  await exigir(NOMINA)
  const sb: any = await getSupabaseAdminAsSystem()
  return todas((from, to) => sb.from("toneladasauxiliares").select("*").eq("idempresa", empresaId).order("fechacargue", { ascending: false }).range(from, to))
}

// ---------------------------------------------------------------- Personal (solo datos básicos)

export interface PersonaBasica {
  id: number
  identificacion: string
  nombre: string
  cargo: string | null
}

/** headcount reducido a id, identificación, nombre y cargo (nada salarial), por empresa. */
export async function leerPersonalBasico(empresaId: number, soloActivos: boolean): Promise<PersonaBasica[]> {
  await exigir(PERSONAL_BASICO)
  const sb: any = await getSupabaseAdminAsSystem()
  const filas = await todas<Fila>((from, to) => {
    let q = sb.from("headcount").select("id, identificacion, nombre, cargo").eq("idempresa", empresaId)
    if (soloActivos) q = q.eq("estado", "Activo")
    return q.order("nombre", { ascending: true }).order("id").range(from, to)
  })
  return filas.map((r) => ({ id: Number(r.id), identificacion: String(r.identificacion ?? "").trim(), nombre: String(r.nombre ?? ""), cargo: r.cargo ?? null }))
}

// ---------------------------------------------------------------- Gastos

export async function leerGastos(input: { idEmpresa: number; desde: string; hasta: string; categoria?: string | null; buscar?: string | null }): Promise<Fila[]> {
  await exigir(GASTOS)
  const sb: any = await getSupabaseAdminAsSystem()
  let q = sb.from("gastos").select("*").eq("id_empresa", input.idEmpresa).gte("fecha", input.desde).lte("fecha", input.hasta).order("fecha", { ascending: false }).order("id", { ascending: false }).limit(100)
  if (input.categoria && input.categoria !== "Todas") q = q.eq("categoria", input.categoria)
  const b = String(input.buscar ?? "").trim()
  if (b) q = q.ilike("descripcion", `%${b}%`)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function registrarGasto(input: { idEmpresa: number; fecha: string; categoria: string; monto: number; descripcion: string; urlSoporte: string | null }): Promise<{ success: true } | { success: false; message: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Registrar Gasto"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    await exigir(["Registrar Gasto"])
    const user = await getCurrentUser()
    const profile: any = user ? await getUserProfile(user.id).catch(() => null) : null
    const monto = Number(input.monto)
    if (!Number.isFinite(monto) || monto <= 0) return { success: false, message: "El monto debe ser mayor que cero." }
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("gastos").insert({
      id_empresa: input.idEmpresa,
      fecha: input.fecha,
      categoria: input.categoria,
      monto,
      descripcion: String(input.descripcion ?? "").trim(),
      url_soporte: input.urlSoporte,
      registrado_por: user?.id ?? null,
      creado_por: profile?.usuario ?? user?.email ?? user?.id ?? null,
    })
    if (error) return { success: false, message: `Error al registrar el gasto: ${error.message}` }
    return { success: true }
  } catch (e: any) {
    void registrarErrorServidor("gastos.registrarGasto", e, { idEmpresa: input?.idEmpresa })
    return { success: false, message: e?.message || "No se pudo registrar el gasto." }
  }
}
