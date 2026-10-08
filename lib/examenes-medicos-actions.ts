"use server"

import { createClient } from "@/lib/supabase-client"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { cargoCanonico } from "@/lib/headcount-cargos"
import { motivoSinAccion } from "@/lib/puerta-modulo"

export interface ExamenMedico {
  id: string
  idempresa: number
  entrevista_id: string | null
  hoja_vida_id: string | null
  cedula: string | null
  nombre: string
  tipo_examen: string | null
  resultado: string | null
  fecha_examen: string | null
  observaciones: string | null
  archivo_url: string
  archivo_nombre: string
  created_at: string
  // Aptitud, costo y trazabilidad (ver scripts/043_create_examenes_aptitud.sql).
  apto: boolean | null // null=pendiente · true=apto · false=no apto
  costo: number | null
  promovido: boolean | null
  fuente: string | null
  vigente: boolean | null
  // Estado de la persona en Head Count (enriquecido por cédula): "Activo" | "Inactivo"
  // | null (candidato aún no vinculado). No se persiste: se resuelve en vivo.
  estado_persona?: string | null
}

// Lista los examenes medicos de la empresa seleccionada (o la de sesion).
export async function getExamenesMedicos(selectedEmpresaId?: number | null) {
  // Lectura con service role (server action): la tabla es nueva y la app usa el
  // cliente de servidor para verla, sin depender de permisos/políticas de la BD.
  const supabase: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

  const { data, error } = await supabase
    .from("examenes_medicos")
    .select("*")
    .eq("idempresa", empresaId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching examenes_medicos:", error)
    return { success: false, data: [] as ExamenMedico[], message: error.message }
  }

  // Enriquecer con el estado de la persona en Head Count (Activo/Inactivo) por cédula.
  // Global por cédula (sin filtrar por empresa): así una persona trasladada a otro
  // proyecto conserva su estado real y no aparece como "Candidato".
  const { data: hc } = await supabase
    .from("headcount")
    .select("identificacion,estado")
  // Normaliza el estado a "Activo" / "Inactivo" exacto (tolerante a mayúsculas/espacios)
  // para que el filtro de la tabla compare de forma confiable.
  const normEstado = (s: any): string | null => {
    const t = String(s || "").trim().toLowerCase()
    if (!t) return null
    if (t.startsWith("inactiv")) return "Inactivo"
    if (t.startsWith("activ")) return "Activo"
    return String(s).trim()
  }
  const estadoPorCedula = new Map<string, string | null>()
  for (const p of hc ?? []) {
    const ced = String((p as any).identificacion || "").trim()
    if (ced) estadoPorCedula.set(ced, normEstado((p as any).estado))
  }
  const enriquecidos = (data || []).map((e: any) => ({
    ...e,
    estado_persona: e.cedula ? estadoPorCedula.get(String(e.cedula).trim()) ?? null : null,
  }))

  return { success: true, data: enriquecidos as ExamenMedico[] }
}

// Resumen de aptitud para KPIs: aprobados vs reprobados + costo asumido por LIP
// en los exámenes con resultado NEGATIVO (no apto). Solo cuenta el examen VIGENTE
// por cédula para no inflar (el histórico se conserva pero no se recuenta).
export async function getResumenExamenes(selectedEmpresaId?: number | null) {
  const supabase: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

  const { data, error } = await supabase
    .from("examenes_medicos")
    .select("cedula,nombre,apto,costo,vigente,created_at")
    .eq("idempresa", empresaId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error resumen examenes:", error)
    return {
      success: false,
      data: { total: 0, aptos: 0, noAptos: 0, pendientes: 0, costoNegativos: 0, costoTotal: 0, tasaAprobacion: 0 },
    }
  }

  const rows = (data || []) as any[]
  // Vigente por cédula = el más reciente (ya viene ordenado desc). Los sin cédula cuentan sueltos.
  const vistoCedula = new Set<string>()
  let aptos = 0, noAptos = 0, pendientes = 0, costoNegativos = 0, costoTotal = 0
  for (const r of rows) {
    const ced = (r.cedula || "").trim()
    if (ced) {
      if (vistoCedula.has(ced)) continue // ya contamos el vigente de esta cédula
      vistoCedula.add(ced)
    }
    const c = Number(r.costo) || 0
    costoTotal += c
    if (r.apto === true) aptos++
    else if (r.apto === false) { noAptos++; costoNegativos += c }
    else pendientes++
  }
  const decididos = aptos + noAptos
  const tasaAprobacion = decididos > 0 ? Math.round((aptos / decididos) * 1000) / 10 : 0
  return {
    success: true,
    data: {
      total: aptos + noAptos + pendientes,
      aptos,
      noAptos,
      pendientes,
      costoNegativos: Math.round(costoNegativos),
      costoTotal: Math.round(costoTotal),
      tasaAprobacion,
    },
  }
}

// Costo por defecto del examen (configurable por empresa en rrhh_config).
export async function getCostoExamenDefault(selectedEmpresaId?: number | null): Promise<number> {
  const supabase: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  const { data } = await supabase
    .from("rrhh_config")
    .select("costo_examen_default")
    .eq("idempresa", empresaId)
    .maybeSingle()
  return Number((data as any)?.costo_examen_default) || 0
}

// Guarda el costo por defecto del examen para la empresa (upsert).
export async function setCostoExamenDefault(valor: number, selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Examenes Médicos"], "configurar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const admin: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return { success: false, message: "Sin empresa seleccionada." }
  const { error } = await admin
    .from("rrhh_config")
    .upsert({ idempresa: empresaId, costo_examen_default: Number(valor) || 0, updated_at: new Date().toISOString() }, { onConflict: "idempresa" })
  if (error) return { success: false, message: error.message }
  return { success: true }
}

// ---------------------------------------------------------------------
// REGISTRAR CONCEPTO DE APTITUD — es el filtro de contratación.
//   apto=true  → hoja de vida "aceptado" + se PROMUEVE a Head Count (sube todos
//                los documentos del candidato por cédula).
//   apto=false → hoja de vida "rechazado"; NO entra a Head Count; queda el costo
//                del examen negativo para el reporte de costos asumidos por LIP.
// El histórico se conserva: al fijar un examen vigente, los anteriores de la misma
// cédula pasan a vigente=false (los resultados persisten en el tiempo).
// ---------------------------------------------------------------------
export async function registrarConceptoExamen(payload: {
  id: string
  apto: boolean
  costo?: number | null
  resultado?: string | null
  tipo_examen?: string | null
  fecha_examen?: string | null
  observaciones?: string | null
}) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Examenes Médicos"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const admin: any = await getSupabaseAdmin()
  const { id, apto } = payload
  if (!id) return { success: false, message: "Falta el examen." }

  const { data: ex, error: eGet } = await admin
    .from("examenes_medicos")
    .select("id,idempresa,cedula,nombre,hoja_vida_id")
    .eq("id", id)
    .maybeSingle()
  if (eGet || !ex) return { success: false, message: eGet?.message || "Examen no encontrado." }

  const empresaId = ex.idempresa as number
  const cedula = (ex.cedula || "").trim()

  // El vigente es este; los otros de la misma cédula dejan de ser vigentes (histórico).
  if (cedula) {
    await admin.from("examenes_medicos").update({ vigente: false }).eq("idempresa", empresaId).eq("cedula", cedula)
  }

  const upd: Record<string, any> = {
    apto,
    resultado: payload.resultado?.trim() || (apto ? "Apto" : "No apto"),
    vigente: true,
  }
  if (payload.costo != null) upd.costo = Number(payload.costo) || 0
  if (payload.tipo_examen != null) upd.tipo_examen = payload.tipo_examen.trim() || null
  if (payload.fecha_examen != null) upd.fecha_examen = payload.fecha_examen || null
  if (payload.observaciones != null) upd.observaciones = payload.observaciones.trim() || null

  const { error: eUpd } = await admin.from("examenes_medicos").update(upd).eq("id", id)
  if (eUpd) return { success: false, message: eUpd.message }

  // Retroalimentar Hoja de Vida por cédula (aceptado / rechazado).
  let promovido = false
  let headcountMsg = ""
  if (cedula) {
    await admin
      .from("hojas_de_vida")
      .update({ estado: apto ? "aceptado" : "rechazado" })
      .eq("idempresa", empresaId)
      .eq("cedula", cedula)

    if (apto) {
      const prom = await promoverAHeadCount(cedula, empresaId)
      promovido = prom.success
      headcountMsg = prom.message || ""
      if (prom.success) await admin.from("examenes_medicos").update({ promovido: true }).eq("id", id)
    }
  }

  return {
    success: true,
    apto,
    promovido,
    message: apto
      ? (promovido ? `Apto — documentos subidos a Head Count. ${headcountMsg}` : "Apto registrado.")
      : "No apto — hoja de vida rechazada, contratación bloqueada.",
  }
}

// ---------------------------------------------------------------------
// PROMOVER A HEAD COUNT — cuando el examen es APTO, sube al maestro (headcount)
// todos los documentos del candidato reunidos por cédula: hoja de vida,
// antecedentes y examen médico, más los datos básicos (nombre/cargo/correo/celular).
// Idempotente por (idempresa, identificación): si ya está, completa lo que falte;
// si no, lo crea como personal activo. NO toca a los antiguos ya vinculados.
// ---------------------------------------------------------------------
export async function promoverAHeadCount(cedula: string, empresaId: number) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Examenes Médicos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const admin: any = await getSupabaseAdmin()
  const ced = (cedula || "").trim()
  if (!ced || !empresaId) return { success: false, message: "Falta cédula o empresa." }

  // Reunir el expediente del candidato por cédula.
  const [{ data: hv }, { data: ant }, { data: exs }] = await Promise.all([
    admin.from("hojas_de_vida").select("nombre_candidato,cargo_aspirado,correo,telefono,archivo_url").eq("idempresa", empresaId).eq("cedula", ced).order("created_at", { ascending: false }).limit(1),
    admin.from("antecedentes").select("nombre,policia_url").eq("idempresa", empresaId).eq("cedula", ced).order("created_at", { ascending: false }).limit(1),
    admin.from("examenes_medicos").select("nombre,archivo_url,apto,created_at").eq("idempresa", empresaId).eq("cedula", ced).eq("apto", true).order("created_at", { ascending: false }).limit(1),
  ])
  const hoja = (hv || [])[0]
  const antec = (ant || [])[0]
  const examen = (exs || [])[0]
  const nombre = hoja?.nombre_candidato || antec?.nombre || examen?.nombre || null

  // Documentos disponibles → columnas de headcount.
  const docs: Record<string, any> = {}
  if (hoja?.archivo_url) docs.hoja_de_vida = hoja.archivo_url
  if (antec?.policia_url) docs.antecedentes = antec.policia_url
  if (examen?.archivo_url) docs.examenes_ing = examen.archivo_url

  const { data: existente } = await admin
    .from("headcount")
    .select("id,hoja_de_vida,antecedentes,examenes_ing")
    .eq("idempresa", empresaId)
    .eq("identificacion", ced)
    .maybeSingle()

  if (existente) {
    // Completar solo lo que falte (no pisar documentos ya cargados).
    const patch: Record<string, any> = {}
    if (!existente.hoja_de_vida && docs.hoja_de_vida) patch.hoja_de_vida = docs.hoja_de_vida
    if (!existente.antecedentes && docs.antecedentes) patch.antecedentes = docs.antecedentes
    if (!existente.examenes_ing && docs.examenes_ing) patch.examenes_ing = docs.examenes_ing
    if (Object.keys(patch).length) {
      const { error } = await admin.from("headcount").update(patch).eq("id", existente.id)
      if (error) return { success: false, message: error.message }
      return { success: true, message: `Expediente completado en Head Count (${Object.keys(patch).length} doc).` }
    }
    return { success: true, message: "Ya estaba en Head Count con su expediente." }
  }

  // Crear el registro en Head Count (nuevo vinculado).
  const nuevo: Record<string, any> = {
    idempresa: empresaId,
    identificacion: ced,
    nombre: nombre || ced,
    estado: "activo",
    // Solo si corresponde a uno de los cargos validos de Head Count. Antes se
    // sembraba `cargo_aspirado` tal cual —texto libre que escribe el aspirante
    // en su hoja de vida—, asi que el registro nacia con un cargo fuera del
    // listado. Ver lib/headcount-cargos.ts.
    cargo: cargoCanonico(hoja?.cargo_aspirado),
    correo: hoja?.correo || null,
    celular: hoja?.telefono || null,
    ...docs,
  }
  const { error } = await admin.from("headcount").insert(nuevo)
  if (error) return { success: false, message: error.message }
  return { success: true, message: "Persona vinculada a Head Count con su expediente." }
}

// ---------------------------------------------------------------------
// APTITUD POR CÉDULA — para el gate de contratación. Devuelve el estado del
// examen VIGENTE de la persona: 'apto' | 'no_apto' | 'pendiente' | 'sin_examen'.
// ---------------------------------------------------------------------
export async function getAptitudPorCedula(cedula: string, selectedEmpresaId?: number | null) {
  const supabase: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  const ced = (cedula || "").trim()
  if (!ced) return "sin_examen" as const
  const { data } = await supabase
    .from("examenes_medicos")
    .select("apto,vigente,created_at")
    .eq("idempresa", empresaId)
    .eq("cedula", ced)
    .order("created_at", { ascending: false })
    .limit(1)
  const row = (data || [])[0] as any
  if (!row) return "sin_examen" as const
  if (row.apto === true) return "apto" as const
  if (row.apto === false) return "no_apto" as const
  return "pendiente" as const
}

// ---------------------------------------------------------------------
// IMPORTAR HISTÓRICO desde Head Count — los antiguos ya vinculados tienen su
// examen de ingreso en headcount.examenes_ing. Esto lo trae al submódulo como
// examen APTO histórico (fuente 'headcount'), sin re-subir, para que el record
// de aptitud quede completo. Idempotente por cédula (no duplica).
// ---------------------------------------------------------------------
export async function importarExamenesDesdeHeadcount(selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Examenes Médicos"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const admin: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return { success: false, creados: 0, message: "Sin empresa seleccionada." }

  // Los antiguos ya vinculados en Head Count ya pasaron sus exámenes → se importan
  // como APTO histórico. IMPORTANTE: para exámenes, la persona pertenece a su proyecto
  // de MATRÍCULA (donde se creó su hoja de vida), NO al proyecto actual del headcount
  // (que puede cambiar por un traslado, temporal para nómina). Por eso el examen se
  // ancla a la empresa de la hoja de vida; si no tiene hoja, a la del headcount.
  const [{ data: allHc, error: eHc }, { data: allHv }, { data: exist }] = await Promise.all([
    admin.from("headcount").select("identificacion,nombre,idempresa,examenes_ing,cert_eva_med"),
    admin.from("hojas_de_vida").select("cedula,nombre_candidato,idempresa,created_at").order("created_at", { ascending: true }),
    admin.from("examenes_medicos").select("cedula").eq("fuente", "headcount"), // dedup GLOBAL por cédula
  ])
  if (eHc) return { success: false, creados: 0, message: eHc.message }

  // Matrícula por cédula = empresa de la hoja de vida (la primera creada).
  const matriculaPorCedula = new Map<string, number>()
  for (const h of allHv ?? []) {
    const ced = String(h.cedula || "").trim()
    if (ced && !matriculaPorCedula.has(ced)) matriculaPorCedula.set(ced, h.idempresa)
  }
  // Documento y datos por cédula desde el headcount (esté en el proyecto que esté).
  const hcPorCedula = new Map<string, any>()
  for (const c of allHc ?? []) {
    const ced = String(c.identificacion || "").trim()
    if (ced && !hcPorCedula.has(ced)) hcPorCedula.set(ced, c)
  }
  const yaImportadas = new Set<string>()
  for (const e of exist ?? []) if (e.cedula) yaImportadas.add(String(e.cedula).trim())

  // Población de esta empresa = personas cuya MATRÍCULA es esta empresa:
  //   (a) tienen hoja de vida en esta empresa, o
  //   (b) están en headcount de esta empresa y no tienen hoja en ninguna (matrícula = actual).
  const cedulasEmpresa = new Set<string>()
  for (const [ced, emp] of matriculaPorCedula) if (emp === empresaId) cedulasEmpresa.add(ced)
  for (const c of allHc ?? []) {
    const ced = String(c.identificacion || "").trim()
    if (ced && c.idempresa === empresaId && !matriculaPorCedula.has(ced)) cedulasEmpresa.add(ced)
  }

  const nuevas: any[] = []
  for (const ced of cedulasEmpresa) {
    if (yaImportadas.has(ced)) continue
    const c = hcPorCedula.get(ced)
    if (!c) continue // matriculado sin registro en headcount aún (no hay examen que importar)
    const url = (c.examenes_ing && String(c.examenes_ing).trim()) || (c.cert_eva_med && String(c.cert_eva_med).trim()) || ""
    nuevas.push({
      idempresa: empresaId, // ancla a la MATRÍCULA, no al proyecto actual del headcount
      cedula: ced,
      nombre: c.nombre || ced,
      tipo_examen: "Ingreso",
      resultado: "Apto",
      apto: true,
      promovido: true,
      fuente: "headcount",
      vigente: true,
      costo: 0,
      archivo_url: url,
      archivo_nombre: url ? "Examen de ingreso (Head Count)" : "Apto histórico (sin documento)",
    })
  }
  if (nuevas.length) {
    const { error: eIns } = await admin.from("examenes_medicos").insert(nuevas)
    if (eIns) return { success: false, creados: 0, message: eIns.message }
  }
  return { success: true, creados: nuevas.length }
}

// ---------------------------------------------------------------------
// REVALIDAR APTITUD LEYENDO EL DOCUMENTO — recorre los exámenes con documento
// de la empresa, lee el "Concepto de aptitud" con Claude (visión) y actualiza la
// bandera apto + el resultado con el concepto real. No dispara promoción/rechazo
// (es una revalidación de histórico); solo corrige la clasificación.
// ---------------------------------------------------------------------
export async function revalidarExamenesDesdeDocumento(selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Examenes Médicos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const { leerConceptoAptitudDesdeUrl } = await import("@/lib/examenes-ocr")
  const admin: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return { success: false, leidos: 0, aptos: 0, noAptos: 0, sinConcepto: 0, message: "Sin empresa seleccionada." }

  const { data: exs, error } = await admin
    .from("examenes_medicos")
    .select("id,archivo_url,cedula,nombre")
    .eq("idempresa", empresaId)
    .not("archivo_url", "is", null)
    .neq("archivo_url", "")
  if (error) return { success: false, leidos: 0, aptos: 0, noAptos: 0, sinConcepto: 0, message: error.message }

  let leidos = 0, aptos = 0, noAptos = 0, sinConcepto = 0
  for (const e of exs ?? []) {
    const { concepto, apto } = await leerConceptoAptitudDesdeUrl(e.archivo_url)
    if (!concepto && apto === null) { sinConcepto++; continue }
    leidos++
    if (apto === true) aptos++
    else if (apto === false) noAptos++
    else sinConcepto++
    const upd: Record<string, any> = {}
    if (concepto) upd.resultado = concepto
    if (apto !== null) upd.apto = apto
    if (Object.keys(upd).length) await admin.from("examenes_medicos").update(upd).eq("id", e.id)
  }
  return { success: true, leidos, aptos, noAptos, sinConcepto }
}

// ---------------------------------------------------------------------
// EXÁMENES PERIÓDICOS — quién debe hacerse el examen médico periódico (anual).
// Base: fecha de ingreso (headcount.fechainicio; respaldo contratos.fecha_inicio).
// Próximo periódico = ingreso + 1 año. Si ya pasó → VENCIDO (alerta). Se calcula el
// costo con la línea "Médico ingreso/periódico/retiro" por sede para provisionar.
// ---------------------------------------------------------------------
// Costo del examen médico PERIÓDICO por sede (solo la línea "Médico ingreso/
// periódico/retiro" de TARIFAS LIP - CIUDADES 2026), no el paquete completo.
// Estos son los valores POR DEFECTO; el costo real es configurable por empresa
// en rrhh_config.costo_periodico (ver getCostoPeriodico / setCostoPeriodico).
const COSTO_PERIODICO: Record<number, number> = {
  1: 28000, // Harinera Indupan · Bogotá
  2: 29000, // Avimol · Barranquilla
  3: 35000, // Cedi Funza
  4: 35000, // Cedi Medellín
  5: 0, // Demogistics · no aplica
}

// Costo periódico configurable por empresa. Resiliente: si la columna aún no existe
// (falta correr el SQL), cae al valor por defecto de COSTO_PERIODICO.
export async function getCostoPeriodico(selectedEmpresaId?: number | null): Promise<number> {
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  try {
    const { data, error } = await sb.from("rrhh_config").select("costo_periodico").eq("idempresa", empresaId).maybeSingle()
    if (!error && data && data.costo_periodico !== null && data.costo_periodico !== undefined) {
      return Number(data.costo_periodico) || 0
    }
  } catch { /* columna aún no creada → default */ }
  return COSTO_PERIODICO[Number(empresaId)] ?? 0
}

export async function setCostoPeriodico(valor: number, selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Examenes Médicos"], "configurar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId) return { success: false, message: "Sin empresa seleccionada." }
  const { error } = await sb
    .from("rrhh_config")
    .upsert({ idempresa: empresaId, costo_periodico: Number(valor) || 0, updated_at: new Date().toISOString() }, { onConflict: "idempresa" })
  if (error) return { success: false, message: "Falta correr el SQL de costo periódico en Supabase. " + error.message }
  return { success: true }
}

export interface ExamenPeriodico {
  cedula: string
  nombre: string
  cargo: string | null
  estado: string | null
  fecha_ingreso: string
  proximo_periodico: string
  dias_restantes: number // negativo = vencido
  vencido: boolean
  costo: number
}

export async function getExamenesPeriodicos(selectedEmpresaId?: number | null) {
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  const costoUnit = await getCostoPeriodico(empresaId)

  // Personal ACTIVO de la empresa (los inactivos no requieren periódico).
  const { data: hc, error } = await sb
    .from("headcount")
    .select("identificacion,nombre,cargo,estado,fechainicio")
    .eq("idempresa", empresaId)
    .ilike("estado", "activo")
  if (error) {
    return { success: false, data: [] as ExamenPeriodico[], resumen: null, message: error.message }
  }

  // Respaldo de fecha de ingreso desde contratos (por cédula).
  const { data: con } = await sb.from("contratos").select("colaborador_id,fecha_inicio").eq("idempresa", empresaId).not("fecha_inicio", "is", null)
  const fechaContrato = new Map<string, string>()
  for (const c of con ?? []) {
    const ced = String(c.colaborador_id || "").trim()
    if (ced && !fechaContrato.has(ced)) fechaContrato.set(ced, c.fecha_inicio)
  }

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const MS_DIA = 86400000

  const filas: ExamenPeriodico[] = []
  let sinFecha = 0
  for (const p of hc ?? []) {
    const ced = String(p.identificacion || "").trim()
    const raw = (p.fechainicio && String(p.fechainicio).trim()) || fechaContrato.get(ced) || ""
    if (!raw) { sinFecha++; continue }
    const ingreso = new Date(String(raw).slice(0, 10) + "T00:00:00")
    if (isNaN(ingreso.getTime())) { sinFecha++; continue }
    // Próximo periódico = ingreso + 1 año (primer periódico anual).
    const prox = new Date(ingreso)
    prox.setFullYear(ingreso.getFullYear() + 1)
    const dias = Math.round((prox.getTime() - hoy.getTime()) / MS_DIA)
    filas.push({
      cedula: ced,
      nombre: p.nombre || ced,
      cargo: p.cargo || null,
      estado: p.estado || null,
      fecha_ingreso: String(raw).slice(0, 10),
      proximo_periodico: prox.toISOString().slice(0, 10),
      dias_restantes: dias,
      vencido: dias < 0,
      costo: costoUnit,
    })
  }
  filas.sort((a, b) => a.dias_restantes - b.dias_restantes)

  const vencidos = filas.filter((f) => f.vencido)
  const proximos30 = filas.filter((f) => !f.vencido && f.dias_restantes <= 30)
  const alerta = filas.filter((f) => f.dias_restantes <= 30) // vencidos + por vencer
  const resumen = {
    activos: filas.length,
    sinFecha,
    vencidos: vencidos.length,
    proximos30: proximos30.length,
    costoUnit,
    costoAlerta: alerta.reduce((s, f) => s + f.costo, 0), // a provisionar ya
    costoAnual: filas.reduce((s, f) => s + f.costo, 0), // provisión anual (todos)
  }
  return { success: true, data: filas, resumen }
}

// Elimina un examen medico (archivo en Storage + registro).
export async function deleteExamenMedico(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Examenes Médicos"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { data: current } = await supabase
    .from("examenes_medicos")
    .select("archivo_url")
    .eq("id", id)
    .maybeSingle()

  if (current?.archivo_url) {
    try {
      const marker = "/object/public/archivos/"
      const idx = current.archivo_url.indexOf(marker)
      if (idx !== -1) {
        const filePath = decodeURIComponent(current.archivo_url.slice(idx + marker.length))
        const supabaseAdmin = await getSupabaseAdmin()
        await supabaseAdmin.storage.from("archivos").remove([filePath])
      }
    } catch (err: any) {
      console.error("[v0] Error eliminando archivo de examen medico:", err?.message || err)
    }
  }

  const { error } = await supabase.from("examenes_medicos").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting examen_medico:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}
