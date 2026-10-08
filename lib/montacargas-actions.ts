"use server"

/**
 * GESTIÓN DE MONTACARGAS (Producción).
 *
 * Maestro de equipos + bitácora de mantenimiento + hoja de vida. Se apoya en
 * `sst_equipos` y `sst_mantenimientos`, que ya existían para esto (ver
 * scripts/104_create_gestion_montacargas.sql), ampliadas con QR, horómetro,
 * programación de preventivos y el ciclo abierto → cerrado.
 *
 * DOS EJES DE ESTADO que conviene no confundir:
 *   · `estado`         — condición del equipo / del cronograma SST.
 *   · `estado_gestion` — ¿la falla ya se resolvió? abierto | cerrado.
 * El segundo es el que pidió el negocio y el que hace gestionable el módulo:
 * un correctivo nace abierto y alguien lo cierra después con lo que hizo.
 *
 * El QR codifica una URL a /equipo/{codigo_qr}, no el id: así el celular la
 * abre con la cámara nativa y el código no es adivinable.
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { resolverEquipo } from "@/lib/montacargas-alias"
import { motivoSinAccion } from "@/lib/puerta-modulo"

const MODULO = "Gestión de Montacargas"

const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}
const nOrNull = (v: any) => {
  const s = String(v ?? "").trim()
  if (s === "") return null
  const n = Number(s.replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}
const txt = (v: any) => {
  const s = String(v ?? "").trim()
  return s === "" ? null : s
}

/** Hoy en Bogotá. `toISOString()` daría el día equivocado de noche. */
function hoyBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
}

const diasEntre = (desde: string, hasta: string) =>
  Math.floor((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

export type ActionResult<T = unknown> = { success: boolean; data?: T; error?: string }

// SIN `export`: este archivo es "use server" y ahí solo se pueden exportar
// funciones async. Exportar el array rompe el arranque de la app entera con
// "A 'use server' file can only export async functions, found object" —
// y el error aparece en OTRO módulo, así que cuesta rastrearlo.
// El tipo sí se exporta: los tipos se borran al compilar.
const TIPOS_ACTIVIDAD = ["preventivo", "correctivo", "revision", "falla_reportada"] as const
export type TipoActividad = (typeof TIPOS_ACTIVIDAD)[number]

export interface Montacarga {
  id: number
  idempresa: number
  codigo_qr: string
  identificacion: string
  alias: string | null
  tipo: string
  sede: string | null
  marca: string | null
  modelo: string | null
  serie: string | null
  anio: number | null
  capacidad_kg: number | null
  tipo_energia: string | null
  altura_elevacion_mm: number | null
  tipo_llanta: string | null
  fecha_ingreso: string | null
  estado: string
  activo: boolean
  observaciones: string | null
  horometro_actual: number | null
  frecuencia_preventivo_horas: number | null
  frecuencia_preventivo_dias: number | null
  horometro_ultimo_preventivo: number | null
  fecha_ultimo_preventivo: string | null
  /** Calculado: cómo va su preventivo. */
  preventivo: {
    estado: "al_dia" | "proximo" | "vencido" | "sin_programar"
    detalle: string
    horasRestantes: number | null
    diasRestantes: number | null
  }
  /** Calculado: cuántas fallas siguen sin resolver. */
  abiertos: number
}

export interface Actividad {
  id: number
  idempresa: number
  equipo_id: number
  tipo: string
  descripcion: string | null
  fecha_ejecucion: string | null
  fecha_programada: string | null
  proveedor: string | null
  costo: number | null
  horometro: number | null
  estado_gestion: string
  reportado_por: string | null
  cerrado_por: string | null
  cerrado_en: string | null
  solucion: string | null
  repuestos: string | null
  created_at: string
  /** Fotos del hallazgo y del cierre, desde soportes_documentales. */
  fotos: Array<{ url: string; nombre: string | null; momento: string }>
}

// ---------------------------------------------------------------------------
// Cálculo del preventivo
// ---------------------------------------------------------------------------

/**
 * Vence lo que ocurra PRIMERO: las horas de uso o los días. Un montacarga se
 * controla por horómetro, pero uno poco usado igual necesita su revisión
 * periódica, y al revés.
 */
function calcularPreventivo(e: any): Montacarga["preventivo"] {
  const fh = nOrNull(e.frecuencia_preventivo_horas)
  const fd = nOrNull(e.frecuencia_preventivo_dias)
  if (!fh && !fd) {
    return { estado: "sin_programar", detalle: "Sin frecuencia definida", horasRestantes: null, diasRestantes: null }
  }

  let horasRestantes: number | null = null
  if (fh) {
    const actual = nOrNull(e.horometro_actual)
    const ultimo = nOrNull(e.horometro_ultimo_preventivo)
    // Sin lectura de horómetro no se puede decir nada por horas; se cae al
    // eje de días en vez de inventar un vencimiento.
    if (actual != null) horasRestantes = fh - (actual - (ultimo ?? 0))
  }

  let diasRestantes: number | null = null
  if (fd) {
    const ultimo = txt(e.fecha_ultimo_preventivo)
    diasRestantes = ultimo ? fd - diasEntre(ultimo, hoyBogota()) : -1 // nunca se le hizo → vencido
  }

  const candidatos = [horasRestantes, diasRestantes].filter((x): x is number => x != null)
  if (!candidatos.length) {
    return {
      estado: "sin_programar",
      detalle: "Falta la lectura del horómetro para poder calcularlo",
      horasRestantes,
      diasRestantes,
    }
  }

  const partes: string[] = []
  if (horasRestantes != null)
    partes.push(horasRestantes < 0 ? `${Math.abs(horasRestantes)} h pasadas` : `faltan ${horasRestantes} h`)
  if (diasRestantes != null)
    partes.push(diasRestantes < 0 ? `${Math.abs(diasRestantes)} días pasados` : `faltan ${diasRestantes} días`)
  const detalle = partes.join(" · ")

  const peor = Math.min(...candidatos)
  if (peor < 0) return { estado: "vencido", detalle, horasRestantes, diasRestantes }
  // "Próximo" = dentro del último 15 % de la frecuencia, o a 7 días.
  const umbralH = fh ? Math.max(1, Math.round(fh * 0.15)) : Infinity
  const cercaH = horasRestantes != null && horasRestantes <= umbralH
  const cercaD = diasRestantes != null && diasRestantes <= 7
  if (cercaH || cercaD) return { estado: "proximo", detalle, horasRestantes, diasRestantes }
  return { estado: "al_dia", detalle, horasRestantes, diasRestantes }
}

// ---------------------------------------------------------------------------
// Maestro de equipos
// ---------------------------------------------------------------------------

export async function listMontacargas(idempresa: number, incluirInactivos = false): Promise<ActionResult<Montacarga[]>> {
  if (!idempresa) return { success: false, error: "Selecciona un proyecto." }
  try {
    const sb: any = await getSupabaseAdmin()
    let q = sb.from("sst_equipos").select("*").eq("idempresa", idempresa).eq("tipo", "montacargas")
    if (!incluirInactivos) q = q.eq("activo", true)
    const { data, error } = await q.order("identificacion", { ascending: true })
    if (error) return { success: false, error: error.message }

    const ids = (data || []).map((e: any) => Number(e.id))
    const abiertosPorEquipo = new Map<number, number>()
    if (ids.length) {
      const { data: ab } = await sb
        .from("sst_mantenimientos")
        .select("equipo_id")
        .in("equipo_id", ids)
        .eq("estado_gestion", "abierto")
      for (const r of ab || []) {
        const k = Number(r.equipo_id)
        abiertosPorEquipo.set(k, (abiertosPorEquipo.get(k) || 0) + 1)
      }
    }

    return {
      success: true,
      data: (data || []).map((e: any) => ({
        ...e,
        preventivo: calcularPreventivo(e),
        abiertos: abiertosPorEquipo.get(Number(e.id)) || 0,
      })) as Montacarga[],
    }
  } catch (e: any) {
    console.error("[v0] listMontacargas error:", e)
    return { success: false, error: e?.message || "Error al listar los montacargas." }
  }
}

/** Busca por el token del QR. NO filtra por empresa: el QR viene del equipo
 *  físico y el usuario puede tener el selector en otro proyecto. */
export async function getMontacargaPorQR(codigo: string): Promise<ActionResult<Montacarga>> {
  const c = String(codigo || "").trim()
  if (!c) return { success: false, error: "Código inválido." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb.from("sst_equipos").select("*").eq("codigo_qr", c).maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "No existe un equipo con ese código. ¿El QR es de otro sistema?" }
    const { count } = await sb
      .from("sst_mantenimientos")
      .select("id", { count: "exact", head: true })
      .eq("equipo_id", data.id)
      .eq("estado_gestion", "abierto")
    return { success: true, data: { ...data, preventivo: calcularPreventivo(data), abiertos: count || 0 } as Montacarga }
  } catch (e: any) {
    console.error("[v0] getMontacargaPorQR error:", e)
    return { success: false, error: e?.message || "Error al leer el equipo." }
  }
}

export async function crearMontacarga(idempresa: number, input: Record<string, any>): Promise<ActionResult<{ id: number }>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Montacargas"], "crear")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!idempresa) return { success: false, error: "Selecciona un proyecto." }
  if (!(await checkModulePermission(MODULO))) return { success: false, error: "No tienes permiso para este módulo." }
  const identificacion = txt(input.identificacion)
  if (!identificacion) return { success: false, error: "La identificación (placa o serie interna) es obligatoria." }
  try {
    const sb: any = await getSupabaseAdmin()
    // Dos equipos con la misma identificación en el mismo proyecto harían
    // imposible el cruce con el preoperacional.
    const { data: ya } = await sb
      .from("sst_equipos")
      .select("id")
      .eq("idempresa", idempresa)
      .eq("tipo", "montacargas")
      .ilike("identificacion", identificacion)
      .maybeSingle()
    if (ya) return { success: false, error: `Ya existe un montacarga con la identificación "${identificacion}".` }

    const { data, error } = await sb
      .from("sst_equipos")
      .insert({
        idempresa,
        tipo: "montacargas",
        identificacion,
        alias: txt(input.alias),
        sede: txt(input.sede),
        marca: txt(input.marca),
        modelo: txt(input.modelo),
        serie: txt(input.serie),
        anio: nOrNull(input.anio),
        capacidad_kg: nOrNull(input.capacidad_kg),
        tipo_energia: txt(input.tipo_energia),
        altura_elevacion_mm: nOrNull(input.altura_elevacion_mm),
        tipo_llanta: txt(input.tipo_llanta),
        fecha_ingreso: txt(input.fecha_ingreso),
        estado: txt(input.estado) || "operativo",
        observaciones: txt(input.observaciones),
        horometro_actual: nOrNull(input.horometro_actual),
        frecuencia_preventivo_horas: nOrNull(input.frecuencia_preventivo_horas),
        frecuencia_preventivo_dias: nOrNull(input.frecuencia_preventivo_dias),
        activo: true,
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, data: { id: Number(data.id) } }
  } catch (e: any) {
    console.error("[v0] crearMontacarga error:", e)
    return { success: false, error: e?.message || "Error al crear el montacarga." }
  }
}

export async function actualizarMontacarga(
  idempresa: number,
  id: number,
  input: Record<string, any>,
): Promise<ActionResult> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Montacargas"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!idempresa || !id) return { success: false, error: "Faltan datos." }
  if (!(await checkModulePermission(MODULO))) return { success: false, error: "No tienes permiso para este módulo." }
  try {
    const sb: any = await getSupabaseAdmin()
    const patch: Record<string, any> = {}
    // Solo lo que venga: así el formulario puede mandar parciales sin borrar
    // lo que no editó.
    const textos = ["identificacion", "alias", "sede", "marca", "modelo", "serie", "tipo_energia", "tipo_llanta", "fecha_ingreso", "estado", "observaciones"]
    for (const k of textos) if (k in input) patch[k] = txt(input[k])
    const numeros = ["anio", "capacidad_kg", "altura_elevacion_mm", "horometro_actual", "frecuencia_preventivo_horas", "frecuencia_preventivo_dias"]
    for (const k of numeros) if (k in input) patch[k] = nOrNull(input[k])
    if ("activo" in input) patch.activo = !!input.activo
    if (!Object.keys(patch).length) return { success: true }

    // Doble filtro: defensa en profundidad para que un id de otro proyecto no
    // se pueda editar aunque se manipule la petición.
    const { error } = await sb.from("sst_equipos").update(patch).eq("id", id).eq("idempresa", idempresa)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (e: any) {
    console.error("[v0] actualizarMontacarga error:", e)
    return { success: false, error: e?.message || "Error al actualizar." }
  }
}

/** Baja LÓGICA: el equipo desaparece de los listados pero conserva su hoja de
 *  vida. Borrarlo dejaría mantenimientos huérfanos. */
export async function darDeBajaMontacarga(idempresa: number, id: number, motivo?: string): Promise<ActionResult> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Montacargas"], "eliminar", "Dar de baja")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!idempresa || !id) return { success: false, error: "Faltan datos." }
  if (!(await checkModulePermission(MODULO))) return { success: false, error: "No tienes permiso para este módulo." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb
      .from("sst_equipos")
      .update({ activo: false, estado: "baja", observaciones: txt(motivo) })
      .eq("id", id)
      .eq("idempresa", idempresa)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message || "Error al dar de baja." }
  }
}

// ---------------------------------------------------------------------------
// Bitácora
// ---------------------------------------------------------------------------

async function fotosDeActividades(sb: any, ids: number[]) {
  const porActividad = new Map<number, Actividad["fotos"]>()
  if (!ids.length) return porActividad
  const { data } = await sb
    .from("soportes_documentales")
    .select("referencia_id, archivo_url, archivo_nombre, observacion, created_at")
    .eq("referencia_tipo", "mantenimiento_montacarga")
    .in("referencia_id", ids.map(String))
    .order("created_at", { ascending: true })
  for (const s of data || []) {
    const k = Number(s.referencia_id)
    const arr = porActividad.get(k) || []
    arr.push({ url: s.archivo_url, nombre: s.archivo_nombre ?? null, momento: s.observacion || "hallazgo" })
    porActividad.set(k, arr)
  }
  return porActividad
}

export async function listBitacora(equipoId: number): Promise<ActionResult<Actividad[]>> {
  if (!equipoId) return { success: false, error: "Equipo inválido." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("sst_mantenimientos")
      .select("*")
      .eq("equipo_id", equipoId)
      .order("created_at", { ascending: false })
    if (error) return { success: false, error: error.message }
    const fotos = await fotosDeActividades(sb, (data || []).map((a: any) => Number(a.id)))
    return {
      success: true,
      data: (data || []).map((a: any) => ({ ...a, fotos: fotos.get(Number(a.id)) || [] })) as Actividad[],
    }
  } catch (e: any) {
    console.error("[v0] listBitacora error:", e)
    return { success: false, error: e?.message || "Error al leer la bitácora." }
  }
}

/** Actividades abiertas de todo el proyecto — es la vista de pendientes. */
export async function listPendientes(idempresa: number): Promise<ActionResult<Array<Actividad & { equipo: string }>>> {
  if (!idempresa) return { success: false, error: "Selecciona un proyecto." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("sst_mantenimientos")
      .select("*")
      .eq("idempresa", idempresa)
      .eq("estado_gestion", "abierto")
      .order("created_at", { ascending: true }) // lo más viejo primero: es lo que más urge
    if (error) return { success: false, error: error.message }
    const ids = [...new Set((data || []).map((a: any) => Number(a.equipo_id)).filter(Boolean))]
    const nombres = new Map<number, string>()
    if (ids.length) {
      const { data: eq } = await sb.from("sst_equipos").select("id, identificacion, alias").in("id", ids)
      for (const e of eq || []) nombres.set(Number(e.id), e.alias ? `${e.identificacion} (${e.alias})` : e.identificacion)
    }
    const fotos = await fotosDeActividades(sb, (data || []).map((a: any) => Number(a.id)))
    return {
      success: true,
      data: (data || []).map((a: any) => ({
        ...a,
        fotos: fotos.get(Number(a.id)) || [],
        equipo: nombres.get(Number(a.equipo_id)) || "(equipo desconocido)",
      })),
    }
  } catch (e: any) {
    return { success: false, error: e?.message || "Error al leer los pendientes." }
  }
}

export async function registrarActividad(input: {
  idempresa: number
  equipoId: number
  tipo: TipoActividad
  descripcion: string
  horometro?: string | number | null
  proveedor?: string | null
  costo?: string | number | null
  fotos?: Array<{ url: string; nombre?: string | null }>
}): Promise<ActionResult<{ id: number }>> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Montacargas"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!input?.equipoId || !input?.idempresa) return { success: false, error: "Faltan datos del equipo." }
  if (!(await checkModulePermission(MODULO))) return { success: false, error: "No tienes permiso para este módulo." }
  if (!txt(input.descripcion)) return { success: false, error: "Describe qué se encontró o qué se hizo." }
  if (!TIPOS_ACTIVIDAD.includes(input.tipo)) return { success: false, error: "Tipo de actividad inválido." }

  try {
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert()
    const hoy = hoyBogota()
    // Un correctivo o una falla nacen ABIERTOS: son un pendiente hasta que
    // alguien los resuelva. Un preventivo o una revisión se registran hechos.
    const abre = input.tipo === "correctivo" || input.tipo === "falla_reportada"

    const { data, error } = await sb
      .from("sst_mantenimientos")
      .insert({
        idempresa: input.idempresa,
        equipo_id: input.equipoId,
        tipo: input.tipo,
        descripcion: txt(input.descripcion),
        fecha_ejecucion: abre ? null : hoy,
        proveedor: txt(input.proveedor),
        costo: nOrNull(input.costo),
        horometro: nOrNull(input.horometro),
        estado_gestion: abre ? "abierto" : "cerrado",
        reportado_por: usuario,
        cerrado_por: abre ? null : usuario,
        cerrado_en: abre ? null : new Date().toISOString(),
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    const actividadId = Number(data.id)

    await guardarFotos(sb, input.idempresa, input.equipoId, actividadId, input.fotos, "hallazgo")

    // La lectura del horómetro actualiza el equipo, y un preventivo reinicia
    // su contador: sin esto el próximo vencimiento se calcularía mal.
    const patch: Record<string, any> = {}
    const h = nOrNull(input.horometro)
    if (h != null) patch.horometro_actual = h
    if (input.tipo === "preventivo") {
      patch.fecha_ultimo_preventivo = hoy
      if (h != null) patch.horometro_ultimo_preventivo = h
    }
    if (Object.keys(patch).length) await sb.from("sst_equipos").update(patch).eq("id", input.equipoId)

    return { success: true, data: { id: actividadId } }
  } catch (e: any) {
    console.error("[v0] registrarActividad error:", e)
    return { success: false, error: e?.message || "Error al registrar la actividad." }
  }
}

export async function cerrarActividad(input: {
  idempresa: number
  actividadId: number
  equipoId: number
  solucion: string
  costo?: string | number | null
  repuestos?: string | null
  proveedor?: string | null
  fotos?: Array<{ url: string; nombre?: string | null }>
}): Promise<ActionResult> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Montacargas"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!input?.actividadId) return { success: false, error: "Actividad inválida." }
  if (!(await checkModulePermission(MODULO))) return { success: false, error: "No tienes permiso para este módulo." }
  if (!txt(input.solucion)) return { success: false, error: "Describe qué se hizo para resolverlo." }
  try {
    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert()
    const patch: Record<string, any> = {
      estado_gestion: "cerrado",
      solucion: txt(input.solucion),
      repuestos: txt(input.repuestos),
      cerrado_por: usuario,
      cerrado_en: new Date().toISOString(),
      fecha_ejecucion: hoyBogota(),
    }
    if (input.costo != null && String(input.costo).trim() !== "") patch.costo = nOrNull(input.costo)
    if (txt(input.proveedor)) patch.proveedor = txt(input.proveedor)

    // Solo se cierra lo que está abierto: evita re-cerrar y pisar el rastro.
    const { data, error } = await sb
      .from("sst_mantenimientos")
      .update(patch)
      .eq("id", input.actividadId)
      .eq("idempresa", input.idempresa)
      .eq("estado_gestion", "abierto")
      .select("id")
    if (error) return { success: false, error: error.message }
    if (!data?.length) return { success: false, error: "No se encontró como pendiente (¿ya estaba cerrada?)." }

    await guardarFotos(sb, input.idempresa, input.equipoId, input.actividadId, input.fotos, "solución")
    return { success: true }
  } catch (e: any) {
    console.error("[v0] cerrarActividad error:", e)
    return { success: false, error: e?.message || "Error al cerrar la actividad." }
  }
}

/**
 * Las fotos van a `soportes_documentales`, la tabla polimórfica que ya existe
 * para esto. `observacion` distingue las del hallazgo de las del arreglo, que
 * es lo que hace legible la hoja de vida.
 *
 * NO se marca `vigente=false` a las anteriores (como sí hace
 * subirYRegistrarSoporte para documentos versionados): aquí todas las fotos
 * conviven, son evidencia acumulada, no versiones de un mismo papel.
 */
async function guardarFotos(
  sb: any,
  idempresa: number,
  equipoId: number,
  actividadId: number,
  fotos: Array<{ url: string; nombre?: string | null }> | undefined,
  momento: string,
) {
  const lista = (fotos || []).filter((f) => String(f?.url || "").trim())
  if (!lista.length) return
  await sb.from("soportes_documentales").insert(
    lista.map((f) => ({
      idempresa,
      norma: "Mantenimiento",
      modulo: "Gestión de Montacargas",
      referencia_tipo: "mantenimiento_montacarga",
      referencia_id: String(actividadId),
      referencia_desc: `Equipo ${equipoId} · ${momento}`,
      archivo_url: f.url,
      archivo_nombre: f.nombre ?? null,
      tipo_archivo: "image",
      observacion: momento,
      vigente: true,
    })),
  )
}

// ---------------------------------------------------------------------------
// Hoja de vida
// ---------------------------------------------------------------------------

export interface HojaDeVida {
  equipo: Montacarga
  actividades: Actividad[]
  documentos: Array<Record<string, any>>
  /** Inspecciones preoperacionales que se pudieron atribuir al equipo. */
  preoperacionales: Array<{ id: string; fecha: string; turno: string | null; operador: string | null; hallazgos: number; via: string }>
  /** Textos del preoperacional que NO se pudieron atribuir a ningún equipo.
   *  Se reportan en vez de adivinar: ver lib/montacargas-alias.ts. */
  preoperacionalesSinCasar: Array<{ texto: string; inspecciones: number }>
  costos: { total: number; ultimoAnio: number; porTipo: Array<{ tipo: string; costo: number; veces: number }> }
}

export async function getHojaDeVida(idempresa: number, equipoId: number): Promise<ActionResult<HojaDeVida>> {
  if (!idempresa || !equipoId) return { success: false, error: "Faltan datos." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { data: eq, error: e1 } = await sb
      .from("sst_equipos")
      .select("*")
      .eq("id", equipoId)
      .eq("idempresa", idempresa)
      .maybeSingle()
    if (e1) return { success: false, error: e1.message }
    if (!eq) return { success: false, error: "El equipo no existe en este proyecto." }

    const bit = await listBitacora(equipoId)
    const actividades = bit.data || []

    const { data: docs } = await sb
      .from("montacargas_documentos")
      .select("*")
      .eq("equipo_id", equipoId)
      .eq("activo", true)
      .order("fecha_vencimiento", { ascending: true })

    // --- Cruce con el preoperacional (texto libre, ver montacargas-alias) ---
    const { data: todosEquipos } = await sb
      .from("sst_equipos")
      .select("identificacion")
      .eq("idempresa", idempresa)
      .eq("tipo", "montacargas")
    const identificaciones = (todosEquipos || []).map((x: any) => String(x.identificacion || "")).filter(Boolean)

    const inspecciones: any[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb
        .from("inspecciones_montacargas")
        .select("*")
        .eq("idempresa", idempresa)
        .order("fecha", { ascending: false })
        .range(off, off + 999)
      if (error) break
      if (!data || !data.length) break
      inspecciones.push(...data)
      if (data.length < 1000) break
    }

    const preoperacionales: HojaDeVida["preoperacionales"] = []
    const sinCasar = new Map<string, number>()
    // Campos booleanos de la inspección: los que vienen en false son hallazgos.
    const noBooleanos = new Set(["id", "created_at", "fecha", "turno", "referencia_montacargas", "placa", "nombre_operador", "desviacion_identificada", "idempresa", "firma"])
    for (const i of inspecciones) {
      const { identificacion, via } = resolverEquipo(i.placa, i.referencia_montacargas, identificaciones)
      if (identificacion == null) {
        const t = `placa="${String(i.placa ?? "").trim()}" ref="${String(i.referencia_montacargas ?? "").trim()}"`
        sinCasar.set(t, (sinCasar.get(t) || 0) + 1)
        continue
      }
      if (identificacion !== String(eq.identificacion)) continue
      let hallazgos = 0
      for (const [k, v] of Object.entries(i)) if (!noBooleanos.has(k) && v === false) hallazgos++
      preoperacionales.push({
        id: String(i.id),
        fecha: String(i.fecha ?? "").slice(0, 10),
        turno: i.turno ?? null,
        operador: i.nombre_operador ?? null,
        hallazgos,
        via: via || "exacto",
      })
    }

    // --- Costos ---
    const hace1 = `${Number(hoyBogota().slice(0, 4)) - 1}${hoyBogota().slice(4)}`
    const porTipo = new Map<string, { costo: number; veces: number }>()
    let total = 0
    let ultimoAnio = 0
    for (const a of actividades) {
      const c = num(a.costo)
      total += c
      if (String(a.fecha_ejecucion ?? a.created_at).slice(0, 10) >= hace1) ultimoAnio += c
      const g = porTipo.get(a.tipo) || { costo: 0, veces: 0 }
      g.costo += c
      g.veces++
      porTipo.set(a.tipo, g)
    }

    return {
      success: true,
      data: {
        equipo: { ...eq, preventivo: calcularPreventivo(eq), abiertos: actividades.filter((a) => a.estado_gestion === "abierto").length } as Montacarga,
        actividades,
        documentos: docs || [],
        preoperacionales,
        preoperacionalesSinCasar: Array.from(sinCasar.entries())
          .map(([texto, inspecciones]) => ({ texto, inspecciones }))
          .sort((a, b) => b.inspecciones - a.inspecciones),
        costos: {
          total,
          ultimoAnio,
          porTipo: Array.from(porTipo.entries())
            .map(([tipo, g]) => ({ tipo, ...g }))
            .sort((a, b) => b.costo - a.costo),
        },
      },
    }
  } catch (e: any) {
    console.error("[v0] getHojaDeVida error:", e)
    return { success: false, error: e?.message || "Error al armar la hoja de vida." }
  }
}

// ---------------------------------------------------------------------------
// Documentos con vencimiento
// ---------------------------------------------------------------------------

export async function guardarDocumento(input: {
  idempresa: number
  equipoId: number
  tipo: string
  numero?: string | null
  fecha_expedicion?: string | null
  fecha_vencimiento?: string | null
  archivo_url?: string | null
  archivo_nombre?: string | null
  observacion?: string | null
}): Promise<ActionResult> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Montacargas"], "editar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!input?.equipoId || !input?.idempresa) return { success: false, error: "Faltan datos." }
  if (!(await checkModulePermission(MODULO))) return { success: false, error: "No tienes permiso para este módulo." }
  if (!txt(input.tipo)) return { success: false, error: "Indica de qué documento se trata." }
  try {
    const sb: any = await getSupabaseAdmin()
    const { error } = await sb.from("montacargas_documentos").insert({
      idempresa: input.idempresa,
      equipo_id: input.equipoId,
      tipo: txt(input.tipo),
      numero: txt(input.numero),
      fecha_expedicion: txt(input.fecha_expedicion),
      fecha_vencimiento: txt(input.fecha_vencimiento),
      archivo_url: txt(input.archivo_url),
      archivo_nombre: txt(input.archivo_nombre),
      observacion: txt(input.observacion),
      activo: true,
    })
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message || "Error al guardar el documento." }
  }
}

export async function eliminarDocumento(idempresa: number, id: number): Promise<ActionResult> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Montacargas"], "eliminar")
  if (motivoAccion) return { success: false, error: motivoAccion }
  if (!idempresa || !id) return { success: false, error: "Faltan datos." }
  if (!(await checkModulePermission(MODULO))) return { success: false, error: "No tienes permiso para este módulo." }
  try {
    const sb: any = await getSupabaseAdmin()
    // Baja lógica: el documento vencido sigue siendo parte de la historia.
    const { error } = await sb.from("montacargas_documentos").update({ activo: false }).eq("id", id).eq("idempresa", idempresa)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message || "Error al eliminar." }
  }
}
