"use server"

import { readFile } from "fs/promises"
import path from "path"
import { read, utils } from "xlsx"
import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import diagnosticos from "@/lib/diagnosticos-cie10.json"
import {
  categoriaDeNovedad,
  esCategoriaMedica,
  tipoEventoDeCategoria,
  etiquetaCategoria,
  diasActivosEnPeriodo,
  type CategoriaAusentismo,
} from "@/lib/ausentismo-categorias"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// Archivo fuente SST-MAT-06 guardado en el proyecto.
const EXCEL_RELATIVE_PATH =
  "data/SST-MAT-06-ANLISIS-ESTADSTICO-DE-AUSENTISMO-LABORAL-POR-ENFERMEDAD-GENERAL-Y-ACCIDENTE-LABORAL-1-e34ae6.xlsx"
// Marca para reconocer (y poder reemplazar) las filas importadas del Excel.
const IMPORT_MARK = "Importado de SST-MAT-06"

export interface Diagnostico {
  codigo: string
  descripcion: string
}

export interface Ausentismo {
  id: string
  idempresa: number
  mes: string | null
  nombre_colaborador: string
  cedula: string | null
  cargo: string | null
  area: string | null
  estado_colaborador: string | null
  centro_trabajo: string | null
  // tipo_evento solo aplica a las MÉDICAS (EG/AT); NULL en licencias.
  tipo_evento: "EG" | "AT" | null
  eps: string | null
  fecha_inicial: string | null
  fecha_final: string | null
  dias_incapacidad: number | null
  prorroga: number | null
  total_dias_incapacidad: number | null
  dias_empresa: number | null
  dias_eps: number | null
  codigo_diagnostico: string | null
  descripcion_diagnostico: string | null
  parte_cuerpo: string | null
  estadistica: string | null
  requiere_revision_sst: boolean
  salario_base: number | null
  salario_base_dia: number | null
  costos_empresa: number | null
  costos_eps: number | null
  costos_arl?: number | null
  total_salario_pagado: number | null
  observaciones: string | null
  // Seguimiento del recobro (submódulo Recobro de Incapacidades, SQL 27).
  estado_recobro?: string | null
  valor_recobrado?: number | null
  fecha_radicado_recobro?: string | null
  obs_recobro?: string | null
  // Soportes de gestión del recobro (SQL 28): correo a EPS/ARL y comprobante de pago.
  soporte_radicado_url?: string | null
  soporte_pago_url?: string | null
  // Puente automático + gestión SST (SQL 52).
  categoria?: string | null // CategoriaAusentismo (amplia: médicas + licencias)
  estado_registro?: string | null // 'BORRADOR' | 'COMPLETO'
  origen?: string | null // 'CONTROL_DIARIO' | 'MANUAL' | 'IMPORT'
  soporte_incapacidad_url?: string | null // documento clínico (1er eslabón del recobro)
  created_at: string
}

// TRUE cuando el codigo CIE-10 empieza por "M" (sistema osteomuscular):
// estos casos deben ir en rojo para revision del profesional de SST.
function requiereRevisionSST(codigo?: string | null) {
  return !!codigo && codigo.trim().toUpperCase().startsWith("M")
}

// ---------------------------------------------------------------------------
// PUENTE automático Visor/Control diario → Ausentismos (borrador). SQL 52.
// Cuando en el Visor se marca una novedad de ausentismo (incapacidad EG/AT o una
// licencia), se crea/actualiza AUTOMÁTICAMENTE un BORRADOR en `ausentismosst` para
// que el analista SST lo complete y suba el soporte. Idempotente (upsert por
// episodio); nunca pisa filas COMPLETO/MANUAL/IMPORT. Las vacaciones NO entran.
// ---------------------------------------------------------------------------

const _diaMs = 86400000
const difDias = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / _diaMs)
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

interface EpisodioAus {
  cedula: string
  cat: CategoriaAusentismo
  nombre: string
  ini: string
  fin: string
  dias: number
}

// Agrupa novedades ya clasificadas en episodios por (cédula + categoría) y días
// contiguos (gap ≤ 4). Misma lógica que el backfill masivo.
function construirEpisodiosCategoria(
  rows: { fecha: string; nombre?: string | null; identificacion: string; cat: CategoriaAusentismo }[],
): EpisodioAus[] {
  const porKey: Record<string, typeof rows> = {}
  for (const r of rows) {
    if (!r.fecha) continue
    const k = `${normCedula(r.identificacion)}|${r.cat}`
    ;(porKey[k] = porKey[k] || []).push(r)
  }
  const eps: EpisodioAus[] = []
  for (const k of Object.keys(porKey)) {
    const lista = porKey[k].slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    let ep: EpisodioAus | null = null
    for (const x of lista) {
      if (ep && difDias(ep.fin, x.fecha) <= 4) {
        ep.fin = x.fecha
        ep.dias++
      } else {
        if (ep) eps.push(ep)
        ep = { cedula: String(x.identificacion), cat: x.cat, nombre: x.nombre ?? String(x.identificacion), ini: x.fecha, fin: x.fecha, dias: 1 }
      }
    }
    if (ep) eps.push(ep)
  }
  return eps
}

interface CtxCostos {
  centro: string | null
  cargo: string | null
  salario: number
  smlv: number
  diasEmpleador: number
}

async function contextoCostosAusentismo(sb: any, empresaId: number, cedula: string, anio: string): Promise<CtxCostos> {
  const [{ data: emp }, { data: hc }, { data: par }] = await Promise.all([
    sb.from("empresas").select("nombre").eq("id", empresaId).maybeSingle(),
    sb.from("headcount").select("cargo,salario").eq("idempresa", empresaId).eq("identificacion", cedula).maybeSingle(),
    sb.from("parametros_legales_anio").select("smlv,dias_cargo_empleador").eq("anio", Number(anio)).maybeSingle(),
  ])
  return {
    centro: emp?.nombre ?? null,
    cargo: hc?.cargo ?? null,
    salario: Number(hc?.salario) || 0,
    smlv: Number(par?.smlv) || 1423500,
    diasEmpleador: Number(par?.dias_cargo_empleador ?? 2),
  }
}

// Construye la fila-borrador de un episodio. Las médicas calculan costos (recobro);
// las licencias van con costos en 0 y tipo_evento NULL (no recobrables).
function filaBorradorEpisodio(ep: EpisodioAus, ctx: CtxCostos, empresaId: number): Record<string, any> {
  const med = esCategoriaMedica(ep.cat)
  const esAT = ep.cat === "ACCIDENTE_LABORAL"
  const salarioBase = med ? Math.max(ctx.salario, ctx.smlv) : 0
  const salarioDia = med ? Math.round(salarioBase / 30) : 0
  const diasEmp = med && !esAT ? Math.min(ep.dias, ctx.diasEmpleador) : 0
  const diasEps = med && !esAT ? Math.max(0, ep.dias - ctx.diasEmpleador) : 0
  const m = Number(String(ep.ini).slice(5, 7))
  return {
    idempresa: empresaId,
    mes: MESES_NOMBRE[m] ?? null,
    nombre_colaborador: ep.nombre,
    cedula: ep.cedula,
    cargo: ctx.cargo,
    centro_trabajo: ctx.centro,
    categoria: ep.cat,
    tipo_evento: tipoEventoDeCategoria(ep.cat), // NULL para licencias
    fecha_inicial: ep.ini,
    fecha_final: ep.fin,
    dias_incapacidad: ep.dias,
    total_dias_incapacidad: ep.dias,
    dias_empresa: diasEmp,
    dias_eps: diasEps,
    salario_base: salarioBase || null,
    salario_base_dia: salarioDia || null,
    costos_empresa: Math.round(diasEmp * salarioDia),
    costos_eps: Math.round(diasEps * salarioDia),
    costos_arl: esAT ? Math.round(ep.dias * salarioDia) : 0,
    requiere_revision_sst: false,
    estado_registro: "BORRADOR",
    origen: "CONTROL_DIARIO",
    observaciones: `[Borrador desde control diario · ${etiquetaCategoria(ep.cat)}] completar y adjuntar soporte`,
  }
}

// Reconcilia los borradores de UNA persona alrededor de `fechaRef` (ventana ±31d).
// Se llama tras guardar una novedad en el Visor / Novedades de Personal.
export async function sincronizarBorradorAusentismo(
  empresaId: number,
  cedula: string,
  fechaRef: string,
): Promise<{ created: number; updated: number; deleted: number; skipped: number; error?: string }> {
  // Sin puerta propia: es un efecto derivado de registrar una novedad (Novedades de
  // personal, personnel-notices); la puerta va en la acción que la dispara.
  const base = { created: 0, updated: 0, deleted: 0, skipped: 0 }
  try {
    if (!empresaId || !cedula || !fechaRef) return base
    const sb: any = await getSupabaseAdmin()
    const ced = normCedula(cedula)
    const ref = new Date(`${String(fechaRef).slice(0, 10)}T00:00:00`)
    if (Number.isNaN(ref.getTime())) return base
    // Ventana de ACCIÓN (±31d): sobre qué episodios se crea/reconcilia un borrador.
    const desde = isoDate(new Date(ref.getTime() - 31 * _diaMs))
    const hasta = isoDate(new Date(ref.getTime() + 31 * _diaMs))
    // Ventana AMPLIA (±180d) SOLO para reconstruir/cotejar, no para actuar:
    //  · reconstruye el episodio COMPLETO aunque fechaRef caiga al inicio o al fin de
    //    una incapacidad larga → su fecha_inicial es ESTABLE (mismo borrador desde
    //    ambos extremos, sin duplicar aunque el guardado dispare inicio y fin a la vez).
    //  · trae filas ya existentes que SOLAPEN por intervalo aunque empiecen antes de la
    //    ventana → no se crea un borrador paralelo a un COMPLETO/MANUAL/IMPORT previo.
    const scanDesde = isoDate(new Date(ref.getTime() - 180 * _diaMs))
    const scanHasta = isoDate(new Date(ref.getTime() + 180 * _diaMs))

    // Solape de dos intervalos con tolerancia de 4 días (continuidad de episodio).
    const solapa = (aIni: string, aFin: string, bIni: string, bFin: string) =>
      !(difDias(aFin, bIni) > 4 || difDias(bFin, aIni) > 4)

    // 1) Novedades del control diario en la ventana AMPLIA → clasificar y armar
    //    episodios completos; se ACTÚA solo sobre los que solapan la ventana de acción.
    const { data: raRows } = await sb
      .from("registroasistencia")
      .select("fecha,nombre,identificacion,asistencia")
      .eq("idempresa", empresaId)
      .gte("fecha", scanDesde)
      .lte("fecha", scanHasta)
      .not("asistencia", "is", null)
    const clasificadas = (raRows ?? [])
      .filter((r: any) => normCedula(r.identificacion) === ced)
      .map((r: any) => ({ ...r, cat: categoriaDeNovedad(r.asistencia) }))
      .filter((r: any) => r.cat) as { fecha: string; nombre?: string; identificacion: string; cat: CategoriaAusentismo }[]
    const episodios = construirEpisodiosCategoria(clasificadas).filter((ep) =>
      solapa(ep.ini, ep.fin, desde, hasta),
    )

    // 2) Filas existentes que SOLAPEN por intervalo (no solo por fecha_inicial dentro
    //    de la ventana): fecha_inicial ≤ scanHasta Y (fecha_final ≥ scanDesde o sin cierre).
    const { data: exRows } = await sb
      .from("ausentismosst")
      .select("id,cedula,fecha_inicial,fecha_final,origen,estado_registro")
      .eq("idempresa", empresaId)
      .lte("fecha_inicial", scanHasta)
      .or(`fecha_final.gte.${scanDesde},fecha_final.is.null`)
    const existentes = (exRows ?? []).filter((r: any) => normCedula(r.cedula) === ced)
    const esBorradorPuente = (r: any) => r.origen === "CONTROL_DIARIO" && r.estado_registro === "BORRADOR"
    const noBorrador = existentes.filter((r: any) => !esBorradorPuente(r))
    const borradores = existentes.filter(esBorradorPuente)

    const ctx = await contextoCostosAusentismo(sb, empresaId, cedula, String(fechaRef).slice(0, 4))
    const borradoresUsados = new Set<string>()
    let { created, updated, deleted, skipped } = base

    for (const ep of episodios) {
      // Si el analista ya lo registró (COMPLETO/MANUAL/IMPORT) → no crear paralelo.
      if (noBorrador.some((r: any) => solapa(ep.ini, ep.fin, r.fecha_inicial, r.fecha_final || r.fecha_inicial))) {
        skipped++
        continue
      }
      const fila = filaBorradorEpisodio(ep, ctx, empresaId)
      const b = borradores.find((r: any) => !borradoresUsados.has(r.id) && solapa(ep.ini, ep.fin, r.fecha_inicial, r.fecha_final || r.fecha_inicial))
      if (b) {
        borradoresUsados.add(b.id)
        await sb.from("ausentismosst").update(fila).eq("id", b.id)
        updated++
      } else {
        const { error } = await sb.from("ausentismosst").insert(fila)
        if (!error) created++
      }
    }

    // 3) Limpieza: borradores del puente en la ventana que ya no tienen episodio
    // que los respalde (p. ej. la novedad se cambió a "Descanso") → eliminar.
    for (const b of borradores) {
      if (borradoresUsados.has(b.id)) continue
      // Solo se limpian borradores del puente dentro de la ventana de ACCIÓN; los
      // traídos por la ventana amplia (de otros episodios) no se tocan aquí.
      if (!solapa(b.fecha_inicial, b.fecha_final || b.fecha_inicial, desde, hasta)) continue
      await sb.from("ausentismosst").delete().eq("id", b.id)
      deleted++
    }

    return { created, updated, deleted, skipped }
  } catch (err: any) {
    return { ...base, error: err?.message || "Error" }
  }
}

// Marca un ausentismo como COMPLETO (validado por el analista).
export async function marcarAusentismoCompleto(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ausentismos"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  const sb = await createClient()
  const { error } = await sb.from("ausentismosst").update({ estado_registro: "COMPLETO" }).eq("id", id)
  return error ? { success: false, message: error.message } : { success: true }
}

// Persiste la URL del soporte clínico de la incapacidad (1er eslabón del recobro).
export async function setSoporteIncapacidad(id: string, url: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ausentismos", "Recobro de Incapacidades"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  const sb = await createClient()
  const { error } = await sb.from("ausentismosst").update({ soporte_incapacidad_url: url }).eq("id", id)
  return error ? { success: false, message: error.message } : { success: true }
}

// Busca diagnosticos CIE-10 por codigo o descripcion (server-side para no
// enviar el catalogo completo de ~12.4k filas al cliente).
export async function searchDiagnosticos(query: string): Promise<Diagnostico[]> {
  const q = query.trim().toUpperCase()
  if (q.length < 2) return []
  const list = diagnosticos as Diagnostico[]
  // Priorizamos: 1) codigo que empieza por lo digitado, 2) codigo que lo
  // contiene, 3) coincidencia por descripcion. Asi, al digitar el codigo de la
  // incapacidad aparecen primero los diagnosticos de ese codigo.
  const startsCode: Diagnostico[] = []
  const includesCode: Diagnostico[] = []
  const byDesc: Diagnostico[] = []
  for (const d of list) {
    const cod = d.codigo.toUpperCase()
    if (cod.startsWith(q)) startsCode.push(d)
    else if (cod.includes(q)) includesCode.push(d)
    else if (d.descripcion.toUpperCase().includes(q)) byDesc.push(d)
  }
  return [...startsCode, ...includesCode, ...byDesc].slice(0, 30)
}

// Colaborador del Head Count usado para autocompletar el formulario de
// ausentismo. El "centro de trabajo" corresponde al proyecto/empresa.
export interface HeadcountColaborador {
  identificacion: string
  nombre: string
  cargo: string | null
  estado: string | null
  centro_trabajo: string | null
}

// Trae el personal del modulo Head Count (Gestion Humana) de la empresa
// seleccionada, incluyendo el nombre de la empresa como centro de trabajo.
export async function getHeadcountColaboradores(
  empresaIdFromClient?: number | null,
): Promise<HeadcountColaborador[]> {
  const supabase = await createClient()
  const empresaId =
    empresaIdFromClient && !Number.isNaN(empresaIdFromClient)
      ? empresaIdFromClient
      : await getCurrentEmpresaIdForInsert()

  if (!empresaId) return []

  // Nombre de la empresa = centro de trabajo / proyecto del colaborador.
  const { data: empresa } = await supabase
    .from("empresas")
    .select("nombre")
    .eq("id", empresaId)
    .maybeSingle()
  const centroTrabajo = empresa?.nombre ?? null

  const { data, error } = await supabase
    .from("headcount")
    .select("identificacion, nombre, cargo, estado")
    .eq("idempresa", empresaId)
    .order("nombre", { ascending: true })

  if (error) {
    console.error("[v0] Error fetching headcount colaboradores:", error)
    return []
  }

  return (data ?? []).map((p: any) => ({
    identificacion: p.identificacion,
    nombre: p.nombre,
    cargo: p.cargo ?? null,
    estado: p.estado ?? null,
    centro_trabajo: centroTrabajo,
  }))
}

// ---------------------------------------------------------------------------
// Análisis de ausentismo desde el CONTROL DIARIO (registroasistencia) — la
// fuente de verdad de los 4 proyectos (Visor / Tabla de asistencia /
// Programación de turnos). Distingue ausentismo médico (incapacidad) de otras
// novedades y de personal NO programado, y permite analizar causas, códigos
// más repetidos, reincidentes y meses con mayor ausentismo.
// ---------------------------------------------------------------------------
export interface AnalisisAusentismo {
  resumen: {
    programados: number
    presentes: number
    incapacidadTurnos: number // incapacidad médica (13/14/15/16)
    faltaNoMedica: number // licencia no remunerada (faltó, no es por salud ni planeada)
    planeadas: number // vacaciones, descanso, licencias remuneradas, maternidad, luto
    noProgramados: number // sin turno asignado
    pctAusentismo: number // incapacidad médica / días-persona esperados según headcount (IND-GH-02)
    pctCapacidadRespuesta: number // incapacidad médica / turnos programados (control diario) -- indicador operativo aparte, no se elimina
  }
  porCodigo: { codigo: string; turnos: number; esIncapacidad: boolean }[]
  reincidentes: { identificacion: string; nombre: string; incapacidades: number; novedades: number }[]
  porMes: { mes: string; incapacidad: number; novedades: number; programados: number }[]
  anios: string[]
  // Detalle de cada evento/novedad (para el drill-down de las tarjetas).
  eventos: { fecha: string; nombre: string; identificacion: string; codigo: string; tipo: string }[]
}

export async function getAnalisisAusentismoDiario(
  empresaIdFromClient?: number | null,
  anio?: string | null,
  mes?: string | null,
): Promise<AnalisisAusentismo> {
  const supabase = await createClient()
  // Si viene un cliente, ese; si no, los 4 proyectos SIG (análisis consolidado).
  const clientes: number[] = empresaIdFromClient && !Number.isNaN(empresaIdFromClient) ? [empresaIdFromClient] : [1, 2, 3, 4]

  // Traer TODO el control diario del/los proyecto(s) (paginado). El filtro de
  // año/mes se aplica en código para poder ofrecer los años disponibles.
  const rows: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from("registroasistencia").select("fecha,nombre,identificacion,puesto,asistencia").in("idempresa", clientes).order("id").range(from, from + 999)
    if (error) { console.error("[v0] getAnalisisAusentismoDiario:", error.message); break }
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
    from += 1000
    if (from > 200000) break
  }

  // Administrativos NUNCA salen en este análisis (usuario 2026-09-14): no son
  // de interés para medir ausentismo; su asistencia solo alimenta pago/PILA.
  const { data: hcAdmin } = await supabase
    .from("headcount")
    .select("identificacion")
    .eq("admin", true)
    .or(clientes.map((c) => `idempresa.eq.${c}`).concat("idempresa.is.null").join(","))
  const identificacionesAdmin = new Set((hcAdmin ?? []).map((h: any) => String(h.identificacion || "").trim()))
  const filasSinAdmin = identificacionesAdmin.size > 0
    ? rows.filter((r) => !identificacionesAdmin.has(String(r.identificacion || "").trim()))
    : rows

  // Headcount OPERATIVO (no admin) del/los proyecto(s), con fechas de vínculo --
  // denominador REAL del ausentismo: días que la persona estuvo vinculada
  // (fechainicio/fecha_retiro) dentro del período, no filas de control diario
  // (alguien activo sin ninguna fila ese día antes no entraba al denominador).
  const { data: hcOperativo } = await supabase
    .from("headcount")
    .select("identificacion,nombre,fechainicio,fecha_retiro")
    .in("idempresa", clientes)
    .not("admin", "is", true)
  const hcOperativoReal = (hcOperativo ?? []).filter((h: any) => !/prueba/i.test(String(h.nombre || "")))

  // La novedad evidencia el tipo: incapacidad (salud) vs falta no médica
  // (licencia no remunerada) vs planeada (vacaciones/descanso/licencias) vs retiro.
  const esIncap = (a: any) => String(a || "").toLowerCase().includes("incapacidad")
  const esFaltaNoMedica = (a: any) => String(a || "").toLowerCase().includes("no remunerada")
  const esRetiro = (a: any) => String(a || "").toLowerCase().includes("retiro")
  const tipoDe = (a: any) => esIncap(a) ? "incapacidad" : esFaltaNoMedica(a) ? "falta" : esRetiro(a) ? "retiro" : "planeada"

  // Años disponibles (de todo el set) y filtro año/mes en código.
  const anios = Array.from(new Set(filasSinAdmin.map((r) => String(r.fecha ?? "").slice(0, 4)).filter(Boolean))).sort().reverse()
  const filtradas = filasSinAdmin.filter((r) => {
    const f = String(r.fecha ?? "")
    if (anio && f.slice(0, 4) !== anio) return false
    if (mes && f.slice(5, 7) !== mes) return false
    return true
  })

  // Período efectivo para el denominador de días-persona (mismo criterio del
  // resto de indicadores de ausentismo). Si no se eligió año (vista "Todos",
  // estado inicial) y sí mes, se asume el año en curso -- si no, el mes
  // seleccionado se ignoraba para el denominador (quedaba en "todo el
  // histórico") aunque `filtradas` sí acotaba el numerador a ese mes.
  const anioPer = anio || (mes ? "2026" : "")
  const desdePer = anioPer && mes ? `${anioPer}-${mes}-01` : anioPer ? `${anioPer}-01-01` : "2026-01-01"
  const hastaPer = anioPer && mes
    ? new Date(Date.UTC(Number(anioPer), Number(mes), 0)).toISOString().slice(0, 10)
    : anioPer ? `${anioPer}-12-31` : new Date().toISOString().slice(0, 10)
  const personalDiasEsperados = hcOperativoReal.reduce(
    (s: number, h: any) => s + diasActivosEnPeriodo(h.fechainicio, h.fecha_retiro, desdePer, hastaPer),
    0,
  )

  let programados = 0, presentes = 0, incapacidadTurnos = 0, faltaNoMedica = 0, planeadas = 0, noProgramados = 0
  const codigos: Record<string, { turnos: number; inc: boolean }> = {}
  const personas: Record<string, { nombre: string; inc: number; nov: number }> = {}
  const meses: Record<string, { inc: number; nov: number; prog: number }> = {}
  const eventos: { fecha: string; nombre: string; identificacion: string; codigo: string; tipo: string }[] = []
  // Días distintos (identificacion+fecha) con incapacidad -- numerador del
  // ausentismo REAL, misma unidad que el denominador (días-persona). Una
  // persona con 2 filas el mismo día (ej. Auxiliar Mixto turno 1+2) no debe
  // contar la ausencia dos veces. `incapacidadTurnos` (filas) se conserva
  // igual para el detalle/drill-down y para pctCapacidadRespuesta.
  const diasIncapacidadSet = new Set<string>()

  for (const r of filtradas) {
    const tieneNovedad = r.asistencia !== null && r.asistencia !== ""
    const programado = r.puesto !== null || tieneNovedad
    const mesK = String(r.fecha ?? "").slice(0, 7)
    if (mesK && !meses[mesK]) meses[mesK] = { inc: 0, nov: 0, prog: 0 }
    if (programado) { programados++; if (mesK) meses[mesK].prog++ }
    if (!tieneNovedad && r.puesto !== null) presentes++
    if (!tieneNovedad && r.puesto === null) noProgramados++
    if (tieneNovedad) {
      const cod = String(r.asistencia)
      const inc = esIncap(cod)
      if (inc) { incapacidadTurnos++; diasIncapacidadSet.add(`${String(r.identificacion || "").trim()}|${String(r.fecha || "")}`) }
      else if (esFaltaNoMedica(cod)) faltaNoMedica++
      else if (!esRetiro(cod)) planeadas++ // vacaciones/descanso/licencias; retiro = baja, no cuenta
      if (!codigos[cod]) codigos[cod] = { turnos: 0, inc }
      codigos[cod].turnos++
      const id = String(r.identificacion ?? "?")
      if (!personas[id]) personas[id] = { nombre: r.nombre ?? id, inc: 0, nov: 0 }
      personas[id].nov++
      if (inc) personas[id].inc++
      if (mesK) { meses[mesK].nov++; if (inc) meses[mesK].inc++ }
      eventos.push({ fecha: r.fecha, nombre: r.nombre ?? id, identificacion: id, codigo: cod, tipo: tipoDe(cod) })
    }
  }

  return {
    resumen: {
      programados, presentes, incapacidadTurnos, faltaNoMedica, planeadas, noProgramados,
      pctAusentismo: personalDiasEsperados > 0 ? Math.round((diasIncapacidadSet.size / personalDiasEsperados) * 1000) / 10 : 0,
      pctCapacidadRespuesta: programados > 0 ? Math.round((incapacidadTurnos / programados) * 1000) / 10 : 0,
    },
    porCodigo: Object.entries(codigos).map(([codigo, v]) => ({ codigo, turnos: v.turnos, esIncapacidad: v.inc })).sort((a, b) => b.turnos - a.turnos),
    reincidentes: Object.entries(personas).map(([identificacion, v]) => ({ identificacion, nombre: v.nombre, incapacidades: v.inc, novedades: v.nov }))
      .sort((a, b) => b.incapacidades - a.incapacidades || b.novedades - a.novedades).slice(0, 12),
    porMes: Object.entries(meses).map(([mes, v]) => ({ mes, incapacidad: v.inc, novedades: v.nov, programados: v.prog })).sort((a, b) => a.mes.localeCompare(b.mes)),
    anios,
    eventos: eventos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))),
  }
}

// Parámetros legales por año (SMLV, auxilio) — base del cálculo de costos.
export interface ParametroAnio { anio: number; smlv: number; auxilio_transporte: number; dias_cargo_empleador: number; pct_pago_incapacidad: number }

export async function getParametrosLegalesAnio(): Promise<ParametroAnio[]> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase.from("parametros_legales_anio").select("*").order("anio", { ascending: false })
    if (error) return []
    return (data ?? []) as ParametroAnio[]
  } catch { return [] }
}

export async function upsertParametroLegalAnio(
  anio: number, smlv: number, auxilio_transporte: number,
): Promise<{ success: boolean; error?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ausentismos"], "configurar", "Parámetros legales")
  if (motivoAccion) return { success: false, error: motivoAccion }
  try {
    if (!anio || !smlv) return { success: false, error: "Año y SMLV son obligatorios" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("parametros_legales_anio")
      .upsert({ anio, smlv, auxilio_transporte: auxilio_transporte || 0, actualizado_at: new Date().toISOString() }, { onConflict: "anio" })
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) { return { success: false, error: err?.message || "Error" } }
}

/**
 * PUENTE (backfill de una vez): genera BORRADORES en ausentismosst a partir de
 * las incapacidades del control diario (registroasistencia), agrupando días
 * consecutivos en episodios. Solo procesa MESES INCOMPLETOS: omite los meses que
 * ya tienen registros en ausentismosst (no duplica ni toca lo cargado). El
 * analista luego completa diagnóstico/AT-EG/costos. Por proyecto.
 */
export interface BorradorAusentismoResult {
  creados: number
  episodios: number
  mesesOmitidos: string[]
  error?: string
}
const MESES_NOMBRE = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

export async function generarBorradoresAusentismoDesdeControl(
  empresaId: number,
  anio: string,
  mes?: string | null,
): Promise<BorradorAusentismoResult> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ausentismos"], "crear")
  if (motivoAccion) return { creados: 0, episodios: 0, mesesOmitidos: [], error: motivoAccion }
  try {
    if (!empresaId) return { creados: 0, episodios: 0, mesesOmitidos: [], error: "Selecciona un cliente/sitio en el selector global" }
    if (!anio) return { creados: 0, episodios: 0, mesesOmitidos: [], error: "Indica el año" }
    const supabase: any = await getSupabaseAdmin()

    const { data: emp } = await supabase.from("empresas").select("nombre").eq("id", empresaId).maybeSingle()
    const centro = emp?.nombre ?? null
    const { data: hc } = await supabase.from("headcount").select("identificacion,cargo,salario").eq("idempresa", empresaId)
    const cargoById: Record<string, string> = {}
    const salarioById: Record<string, number> = {}
    for (const h of hc ?? []) { cargoById[String(h.identificacion)] = h.cargo; salarioById[String(h.identificacion)] = Number(h.salario) || 0 }
    // Parámetros legales del año (SMLV) para el cálculo de costos.
    const { data: par } = await supabase.from("parametros_legales_anio").select("*").eq("anio", Number(anio)).maybeSingle()
    const smlv = Number(par?.smlv) || 1423500
    const diasEmpleador = Number(par?.dias_cargo_empleador ?? 2)

    // Incapacidades del control diario (año + mes opcional).
    const rows: any[] = []
    let from = 0
    while (true) {
      let q = supabase.from("registroasistencia").select("fecha,nombre,identificacion,asistencia").eq("idempresa", empresaId)
        .ilike("asistencia", "%incapacidad%").gte("fecha", `${anio}-01-01`).lte("fecha", `${anio}-12-31`).order("id").range(from, from + 999)
      const { data, error } = await q
      if (error) return { creados: 0, episodios: 0, mesesOmitidos: [], error: error.message }
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 60000) break
    }
    const enScope = mes ? rows.filter((r) => String(r.fecha).slice(5, 7) === mes) : rows

    // Meses ya cargados en ausentismosst (se omiten = "meses completos").
    const { data: existentes } = await supabase.from("ausentismosst").select("fecha_inicial").eq("idempresa", empresaId)
    const mesesCargados = new Set((existentes ?? []).map((e: any) => String(e.fecha_inicial ?? "").slice(0, 7)).filter(Boolean))

    // Agrupar por persona en episodios (días contiguos, gap <= 4 días).
    const porPersona: Record<string, any[]> = {}
    for (const r of enScope) { const id = String(r.identificacion ?? "?"); (porPersona[id] = porPersona[id] || []).push(r) }
    const dif = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
    const episodios: any[] = []
    for (const id of Object.keys(porPersona)) {
      const lista = porPersona[id].filter((x) => x.fecha).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      let ep: any = null
      for (const x of lista) {
        if (ep && dif(ep.fin, x.fecha) <= 4) { ep.fin = x.fecha; ep.dias++ }
        else { if (ep) episodios.push(ep); ep = { id, nombre: x.nombre ?? id, codigo: x.asistencia, ini: x.fecha, fin: x.fecha, dias: 1 } }
      }
      if (ep) episodios.push(ep)
    }

    // Construir borradores, omitiendo meses ya cargados.
    const mesesOmitidosSet = new Set<string>()
    const filas = episodios.filter((ep) => {
      const ym = String(ep.ini).slice(0, 7)
      if (mesesCargados.has(ym)) { mesesOmitidosSet.add(ym); return false }
      return true
    }).map((ep) => {
      const m = Number(String(ep.ini).slice(5, 7))
      const esAT = String(ep.codigo).toLowerCase().includes("profesional")
      // Costo sugerido con el SMLV del año. Base salarial = salario real del
      // colaborador (headcount), con piso en el SMLV. EG: días 1-2 a cargo del
      // empleador y el resto a cargo de la EPS, ambos al 100% (LIP paga la EG al 100%
      // y la EPS la reconoce al 100%). AT: lo asume la ARL al 100%.
      const salarioBase = Math.max(salarioById[ep.id] || 0, smlv)
      const salarioDia = Math.round(salarioBase / 30)
      const diasEmp = esAT ? 0 : Math.min(ep.dias, diasEmpleador)
      const diasEps = esAT ? 0 : Math.max(0, ep.dias - diasEmpleador)
      const costosEmpresa = Math.round(diasEmp * salarioDia)
      const costosEps = Math.round(diasEps * salarioDia)
      // AT: a cargo de la ARL al 100% del salario (para el análisis SST de costos).
      const costosArl = esAT ? Math.round(ep.dias * salarioDia) : 0
      return {
        idempresa: empresaId,
        mes: MESES_NOMBRE[m] ?? null,
        nombre_colaborador: ep.nombre,
        cedula: ep.id,
        cargo: cargoById[ep.id] ?? null,
        centro_trabajo: centro,
        categoria: esAT ? "ACCIDENTE_LABORAL" : "ENFERMEDAD_GENERAL",
        tipo_evento: esAT ? "AT" : "EG",
        fecha_inicial: ep.ini,
        fecha_final: ep.fin,
        dias_incapacidad: ep.dias,
        total_dias_incapacidad: ep.dias,
        dias_empresa: diasEmp,
        dias_eps: diasEps,
        salario_base: salarioBase,
        salario_base_dia: salarioDia,
        costos_empresa: costosEmpresa,
        costos_eps: costosEps,
        costos_arl: costosArl,
        requiere_revision_sst: false,
        estado_registro: "BORRADOR",
        origen: "CONTROL_DIARIO",
        observaciones: `[Borrador desde control diario · SMLV ${anio}] completar diagnóstico/AT-EG; costo estimado`,
      }
    })

    if (filas.length > 0) {
      const { error } = await supabase.from("ausentismosst").insert(filas)
      if (error) return { creados: 0, episodios: episodios.length, mesesOmitidos: [...mesesOmitidosSet], error: error.message }
    }
    return { creados: filas.length, episodios: episodios.length, mesesOmitidos: [...mesesOmitidosSet].sort() }
  } catch (err: any) {
    return { creados: 0, episodios: 0, mesesOmitidos: [], error: err?.message || "Error desconocido" }
  }
}

// Normaliza una cédula/identificación para casar ausentismosst.cedula con headcount.identificacion
// (quita sufijo ".0" del Excel y deja solo dígitos).
function normCedula(c: string | null | undefined): string {
  return String(c ?? "").trim().replace(/\.0+$/, "").replace(/\D/g, "")
}

export async function getAusentismos(empresaId?: number | null): Promise<Ausentismo[]> {
  const supabase = await createClient()
  let query = supabase.from("ausentismosst").select("*").order("created_at", { ascending: false })
  if (empresaId) query = query.eq("idempresa", empresaId)

  const { data, error } = await query
  if (error) {
    console.error("[v0] Error fetching ausentismos:", error)
    return []
  }
  let rows = (data ?? []) as Ausentismo[]

  // ESTADO VIGENTE + VALOR DÍA del colaborador desde headcount (por identificación).
  //  - estado_colaborador queda CONGELADO al crear la fila; si la persona se retira
  //    después (novedad de retiro → headcount Inactivo), el módulo debe reflejar el retiro.
  //  - salario_base / salario_base_dia se completan con el salario del head count (piso
  //    SMLV del año) para VALORIZAR cada incapacidad = días × valor día. Es el mismo
  //    valor día que usa el cuadro de nómina (parafiscales/prestaciones): salario / 30.
  try {
    // SMLV por año (para el piso del salario base). El SMLV más reciente sirve de default.
    const smlvPorAnio = new Map<string, number>()
    let smlvDefault = 0
    const { data: pars } = await supabase.from("parametros_legales_anio").select("anio, smlv")
    for (const p of pars ?? []) {
      const s = Number(p.smlv) || 0
      smlvPorAnio.set(String(p.anio), s)
      if (s > smlvDefault) smlvDefault = s
    }
    if (!smlvDefault) smlvDefault = 1423500 // fallback 2026

    const estadoHc = new Map<string, string>()
    const salarioHc = new Map<string, number>()
    // Administrativos NUNCA salen en este módulo (usuario 2026-09-14): no son
    // de interés para medir ausentismo; su asistencia solo alimenta pago/PILA.
    const cedulasAdmin = new Set<string>()
    for (let off = 0; ; off += 1000) {
      const { data: hc } = await supabase
        .from("headcount")
        .select("identificacion, estado, fecha_retiro, salario, admin")
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(off, off + 999)
      if (!hc || hc.length === 0) break
      for (const h of hc) {
        const k = normCedula(h.identificacion)
        if (!k) continue
        const est = String(h.estado ?? "").toUpperCase()
        const retirado = est.includes("INACTIV") || est.includes("RETIR") || !!h.fecha_retiro
        estadoHc.set(k, retirado ? "RETIRADO" : "ACTIVO")
        const sal = Number(h.salario) || 0
        if (sal > 0) salarioHc.set(k, sal)
        if (h.admin === true) cedulasAdmin.add(k)
      }
      if (hc.length < 1000) break
    }
    if (cedulasAdmin.size > 0) rows = rows.filter((r) => !cedulasAdmin.has(normCedula(r.cedula)))
    const smlvActual = smlvDefault // SMLV vigente (año más reciente) = mínimo de hoy
    for (const r of rows) {
      const k = normCedula(r.cedula)
      if (!k) continue
      if (estadoHc.has(k)) r.estado_colaborador = estadoHc.get(k)!
      // Valor día por AÑO de la incapacidad. El head count solo guarda el salario
      // VIGENTE, así que:
      //   - Quien gana el mínimo (salario ≤ SMLV de hoy) se valoriza con el SMLV del
      //     AÑO de la incapacidad (2025 usa SMLV 2025; 2026 usa SMLV 2026).
      //   - Quien gana por encima del mínimo usa su salario (piso en el SMLV del año);
      //     no hay histórico de salario, se toma el vigente como mejor aproximación.
      const anioFila = String(r.fecha_inicial ?? "").slice(0, 4)
      const smlvAnio = smlvPorAnio.get(anioFila) || smlvDefault
      const salActual = salarioHc.get(k) || 0
      const salarioBase = salActual > smlvActual ? Math.max(salActual, smlvAnio) : smlvAnio
      if (salarioBase > 0) {
        r.salario_base = salarioBase
        // Valor día = salario / 30 (mismo divisor del cuadro de nómina).
        r.salario_base_dia = Math.round(salarioBase / 30)
      }
    }
  } catch (e) {
    console.error("[v0] Error sincronizando estado/valor día con headcount:", e)
  }

  return rows
}

// AT REALES = investigaciones (sst_incidentes): una investigación por accidente. Las
// prórrogas son filas extra en ausentismosst pero NO son AT nuevos. Devuelve fecha del
// evento y estado (para contar por período y separar pendientes de cerradas).
export async function getIncidentesAT(
  empresaId?: number | null,
): Promise<{ fecha_evento: string | null; estado: string | null }[]> {
  const supabase = await createClient()
  let q = supabase.from("sst_incidentes").select("fecha_evento, estado")
  if (empresaId) q = q.eq("idempresa", empresaId)
  const { data, error } = await q
  if (error) {
    console.error("[v0] Error fetching incidentes AT:", error)
    return []
  }
  return (data ?? []) as { fecha_evento: string | null; estado: string | null }[]
}

export async function createAusentismo(
  data: Record<string, any>,
  empresaIdFromClient?: number | null,
) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ausentismos"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const empresaId =
    empresaIdFromClient && !Number.isNaN(empresaIdFromClient)
      ? empresaIdFromClient
      : await getCurrentEmpresaIdForInsert()

  const { id, created_at, idempresa, ...rest } = data

  const { data: inserted, error } = await supabase
    .from("ausentismosst")
    .insert({
      ...rest,
      idempresa: empresaId,
      requiere_revision_sst: requiereRevisionSST(rest.codigo_diagnostico),
      // Alta manual = fila validada por el analista.
      origen: rest.origen ?? "MANUAL",
      estado_registro: rest.estado_registro ?? "COMPLETO",
      categoria: rest.categoria ?? (rest.tipo_evento === "AT" ? "ACCIDENTE_LABORAL" : "ENFERMEDAD_GENERAL"),
    })
    .select()

  if (error) {
    console.error("[v0] Error creating ausentismo:", error)
    return { success: false, message: error.message }
  }
  return { success: true, data: inserted?.[0] as Ausentismo }
}

export async function updateAusentismo(id: string, updates: Record<string, any>) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ausentismos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const { idempresa, id: _ignore, created_at, ...rest } = updates

  const { data, error } = await supabase
    .from("ausentismosst")
    .update({
      ...rest,
      requiere_revision_sst: requiereRevisionSST(rest.codigo_diagnostico),
    })
    .eq("id", id)
    .select()

  if (error) {
    console.error("[v0] Error updating ausentismo:", error)
    return { success: false, message: error.message }
  }
  return { success: true, data: data?.[0] as Ausentismo }
}

export async function deleteAusentismo(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ausentismos"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const { error } = await supabase.from("ausentismosst").delete().eq("id", id)
  if (error) {
    console.error("[v0] Error deleting ausentismo:", error)
    return { success: false, message: error.message }
  }
  return { success: true }
}

// ----- Importacion desde el Excel SST-MAT-06 -----------------------------

function toISODate(v: any): string | null {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  if (!s) return null
  if (s.includes("T")) return s.slice(0, 10) // ISO con hora
  return s
}

function toInt(v: any): number {
  const n = Number.parseInt(String(v ?? "").replace(/[^\d.-]/g, ""), 10)
  return Number.isNaN(n) ? 0 : n
}

function toFloat(v: any): number {
  const n = Number.parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""))
  return Number.isNaN(n) ? 0 : n
}

function str(v: any): string | null {
  const s = String(v ?? "").trim()
  return s || null
}

// Importa las filas de las dos hojas de datos del Excel (Enfermedad General /
// Accidente de Transito, y Accidentes Laborales) para la empresa indicada.
// Reemplaza importaciones previas (filas marcadas) para que sea idempotente.
export async function importAusentismosFromExcel(empresaIdFromClient?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Ausentismos"], "crear", "Importar Excel")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const empresaId =
    empresaIdFromClient && !Number.isNaN(empresaIdFromClient)
      ? empresaIdFromClient
      : await getCurrentEmpresaIdForInsert()

  if (!empresaId) {
    return { success: false, message: "No hay empresa seleccionada." }
  }

  let workbook
  try {
    const buf = await readFile(path.join(process.cwd(), EXCEL_RELATIVE_PATH))
    workbook = read(buf, { cellDates: true })
  } catch (err: any) {
    console.error("[v0] Error reading Excel:", err?.message)
    return { success: false, message: "No se pudo leer el archivo Excel." }
  }

  const rows: Record<string, any>[] = []

  // Hoja 1: "Base de Datos E.G - A.C" (EG y AT, con EPS y desglose de costos).
  const egSheet = workbook.Sheets["Base de Datos E.G - A.C"]
  if (egSheet) {
    const data = utils.sheet_to_json<any[]>(egSheet, { header: 1, raw: false })
    for (let i = 5; i < data.length; i++) {
      const r = data[i]
      if (!r) continue
      const nombre = str(r[1])
      if (!nombre || nombre.toUpperCase().includes("NOMBRES Y APELLIDOS")) continue
      const tipo = (str(r[7]) || "EG").toUpperCase() === "AT" ? "AT" : "EG"
      rows.push({
        mes: str(r[0]),
        nombre_colaborador: nombre,
        cedula: str(r[2]),
        cargo: str(r[3]),
        area: str(r[4]),
        estado_colaborador: str(r[5]),
        centro_trabajo: str(r[6]),
        tipo_evento: tipo,
        eps: str(r[8]),
        fecha_inicial: toISODate(r[9]),
        fecha_final: toISODate(r[10]),
        dias_incapacidad: toInt(r[11]),
        prorroga: toInt(r[12]),
        total_dias_incapacidad: toInt(r[13]),
        dias_empresa: toInt(r[14]),
        dias_eps: toInt(r[15]),
        codigo_diagnostico: str(r[16]),
        descripcion_diagnostico: str(r[17]),
        parte_cuerpo: str(r[18]),
        estadistica: str(r[19]),
        salario_base: toFloat(r[20]),
        salario_base_dia: toFloat(r[21]),
        costos_empresa: toFloat(r[22]),
        costos_eps: toFloat(r[23]),
        total_salario_pagado: toFloat(r[24]),
      })
    }
  }

  // Hoja 2: "Base de Datos - AL" (Accidentes Laborales). Tiene celdas
  // combinadas: los datos del colaborador solo aparecen en la primera fila de
  // cada bloque, por lo que rellenamos hacia abajo (forward-fill).
  const alSheet = workbook.Sheets["Base de Datos - AL"]
  if (alSheet) {
    const data = utils.sheet_to_json<any[]>(alSheet, { header: 1, raw: false })
    let lastMes: string | null = null
    let lastNombre: string | null = null
    let lastCedula: string | null = null
    let lastCargo: string | null = null
    let lastArea: string | null = null
    let lastEstado: string | null = null
    let lastCentro: string | null = null
    let lastCentroMedico: string | null = null
    for (let i = 5; i < data.length; i++) {
      const r = data[i]
      if (!r) continue
      lastMes = str(r[0]) ?? lastMes
      lastNombre = str(r[1]) ?? lastNombre
      lastCedula = str(r[2]) ?? lastCedula
      lastCargo = str(r[3]) ?? lastCargo
      lastArea = str(r[4]) ?? lastArea
      lastEstado = str(r[5]) ?? lastEstado
      lastCentro = str(r[6]) ?? lastCentro
      lastCentroMedico = str(r[7]) ?? lastCentroMedico
      // Una fila valida del bloque tiene fechas o diagnostico.
      const fi = toISODate(r[8])
      const cod = str(r[13])
      if (!fi && !cod && !str(r[10])) continue
      if (!lastNombre) continue
      rows.push({
        mes: lastMes,
        nombre_colaborador: lastNombre,
        cedula: lastCedula,
        cargo: lastCargo,
        area: lastArea,
        estado_colaborador: lastEstado,
        centro_trabajo: lastCentro,
        tipo_evento: "AT",
        eps: lastCentroMedico,
        fecha_inicial: fi,
        fecha_final: toISODate(r[9]),
        dias_incapacidad: toInt(r[10]),
        prorroga: toInt(r[11]),
        total_dias_incapacidad: toInt(r[12]),
        dias_empresa: 0,
        dias_eps: 0,
        codigo_diagnostico: cod,
        descripcion_diagnostico: str(r[14]),
        parte_cuerpo: str(r[15]),
        estadistica: str(r[16]),
        salario_base: toFloat(r[17]),
        salario_base_dia: toFloat(r[18]),
        costos_empresa: 0,
        costos_eps: toFloat(r[19]),
        total_salario_pagado: toFloat(r[19]),
      })
    }
  }

  if (rows.length === 0) {
    return { success: false, message: "No se encontraron filas para importar en el Excel." }
  }

  // Reemplazo idempotente: elimina importaciones previas de esta empresa.
  await supabase
    .from("ausentismosst")
    .delete()
    .eq("idempresa", empresaId)
    .eq("observaciones", IMPORT_MARK)

  const payload = rows.map((r) => ({
    ...r,
    idempresa: empresaId,
    requiere_revision_sst: requiereRevisionSST(r.codigo_diagnostico),
    observaciones: IMPORT_MARK,
  }))

  const { error } = await supabase.from("ausentismosst").insert(payload)
  if (error) {
    console.error("[v0] Error importing ausentismos:", error)
    return { success: false, message: error.message }
  }

  return { success: true, count: payload.length }
}
