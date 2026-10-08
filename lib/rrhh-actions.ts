"use server"

import { createClient } from "@/lib/supabase-server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { cargoCanonico } from "@/lib/headcount-cargos"
import { motivoSinAccion } from "@/lib/puerta-modulo"

// COLABORADORES - Fetch from headcount table filtered by empresa
export async function getColaboradoresFromHeadcount(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  const empresaId = selectedEmpresaId || await getCurrentEmpresaIdForInsert()

  const { data, error } = await supabase
    .from("headcount")
    .select("id, nombre, identificacion")
    .eq("idempresa", empresaId)
    .order("nombre", { ascending: true })

  if (error) {
    console.error("[v0] Error fetching colaboradores from headcount:", error)
    return { success: false, data: [] }
  }

  return { success: true, data: data || [] }
}

// COLABORADORES - Original from colaboradores table
export async function getColaboradores() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("colaboradores")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching colaboradores:", error)
    return { success: false, data: [] }
  }

  return { success: true, data: data || [] }
}

export async function createColaborador(colaborador: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Colaboradores", "Head Count"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("colaboradores")
    .insert([colaborador])
    .select()

  if (error) {
    console.error("[v0] Error creating colaborador:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function updateColaborador(id: string, updates: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Colaboradores", "Head Count"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("colaboradores")
    .update(updates)
    .eq("id", id)
    .select()

  if (error) {
    console.error("[v0] Error updating colaborador:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function deleteColaborador(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Colaboradores", "Head Count"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { error } = await supabase.from("colaboradores").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting colaborador:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}

// =====================================================================
// COLABORADORES (Gestion Humana) - tabla `colaboradores_th`
// Registro en 2 partes: hoja de vida + informacion del contrato.
// Estas acciones son independientes de las de arriba (que usan la tabla
// `colaboradores` y son compartidas por otros modulos).
// =====================================================================

// Lista los colaboradores de la empresa actual (o la seleccionada).
export async function getColaboradoresTH(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())

  const { data, error } = await supabase
    .from("colaboradores_th")
    .select("*")
    .eq("idempresa", empresaId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching colaboradores_th:", error)
    return { success: false, data: [], message: error.message }
  }

  return { success: true, data: data || [] }
}

// Mapea los campos de un colaborador (colaboradores_th) a las columnas
// correspondientes de la tabla headcount. Solo se incluyen las columnas que
// headcount entiende; el resto queda en colaboradores_th.
function mapColaboradorToHeadcount(colaborador: Record<string, any>) {
  const nombre = [
    colaborador.primer_nombre,
    colaborador.segundo_nombre,
    colaborador.primer_apellido,
    colaborador.segundo_apellido,
  ]
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
    .join(" ")

  const sueldo =
    colaborador.sueldo === "" || colaborador.sueldo == null ? null : Number(colaborador.sueldo)

  return {
    // La identificacion del headcount usa el numero de documento de la hoja
    // de vida (o el numero de identificacion del contrato como respaldo).
    identificacion: (colaborador.numero_documento || colaborador.numero_identificacion || "").toString(),
    nombre: nombre || (colaborador.nombre_empleado ?? "").toString(),
    estado: colaborador.estado || "activo",
    correo: colaborador.correo_electronico || null,
    celular: colaborador.numero_celular || colaborador.numero_telefono_celular || null,
    fechainicio: colaborador.fecha_inicio_contrato || null,
    salario: Number.isNaN(sueldo as number) ? null : sueldo,
    // `cargo` NO va aqui a proposito — ver `cargoParaAlta` abajo.
    //
    // Este mapa se usa TAMBIEN para ACTUALIZAR el espejo de headcount, y hasta
    // ahora incluia el cargo: cada vez que alguien guardaba al colaborador en
    // TH, el cargo elegido en Head Count quedaba pisado por el del catalogo de
    // TH, que es otro y mucho mas largo ("COORDINADOR SST", "COORDINADORA SST").
    // El cargo de Head Count solo se elige en Head Count.
  }
}

/**
 * Cargo con el que NACE un registro nuevo de headcount creado desde TH.
 *
 * Solo se siembra si el cargo del colaborador corresponde a uno de los tres
 * validos (ver lib/headcount-cargos.ts); cualquier otra cosa entra en null para
 * que Head Count lo defina. En una ACTUALIZACION no se usa: ahi el cargo no se
 * toca nunca.
 */
function cargoParaAlta(colaborador: Record<string, any>): string | null {
  return cargoCanonico(colaborador?.cargo)
}

// Crea o actualiza el registro espejo en headcount para un colaborador.
// Devuelve el id de headcount (o null si fallo). No interrumpe el flujo
// principal: si headcount falla, el colaborador igual queda guardado.
async function syncHeadcountForColaborador(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: number,
  colaborador: Record<string, any>,
  existingHeadcountId?: number | null,
): Promise<number | null> {
  const hcFields = mapColaboradorToHeadcount(colaborador)
  try {
    // 1) Si ya hay un vinculo, actualizamos ese registro.
    if (existingHeadcountId) {
      const { data, error } = await supabase
        .from("headcount")
        .update(hcFields)
        .eq("id", existingHeadcountId)
        .select("id")
        .single()
      if (error) throw error
      return data?.id ?? existingHeadcountId
    }

    // 2) Sin vinculo: si ya existe alguien con esa identificacion en la
    //    empresa, lo reutilizamos (evita duplicados); si no, lo creamos.
    if (hcFields.identificacion) {
      const { data: existing } = await supabase
        .from("headcount")
        .select("id")
        .eq("idempresa", empresaId)
        .eq("identificacion", hcFields.identificacion)
        .maybeSingle()
      if (existing?.id) {
        await supabase.from("headcount").update(hcFields).eq("id", existing.id)
        return existing.id
      }
    }

    const { data, error } = await supabase
      .from("headcount")
      // El cargo solo se siembra en el ALTA, y solo si es uno de los validos.
      .insert({ ...hcFields, cargo: cargoParaAlta(colaborador), idempresa: empresaId })
      .select("id")
      .single()
    if (error) throw error
    return data?.id ?? null
  } catch (err: any) {
    console.error("[v0] Error sincronizando headcount para colaborador:", err?.message || err)
    return null
  }
}

// Crea un colaborador. Inyecta idempresa de forma segura en el servidor y
// crea (o reutiliza) su registro espejo en headcount.
export async function createColaboradorTH(colaborador: Record<string, any>, selectedEmpresaId?: number) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Colaboradores", "Head Count"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

  // Primero sincronizamos headcount para obtener el vinculo.
  const headcountId = await syncHeadcountForColaborador(supabase, empresaId, colaborador, null)

  const { data, error } = await supabase
    .from("colaboradores_th")
    .insert([{ ...colaborador, idempresa: empresaId, headcount_id: headcountId }])
    .select()

  if (error) {
    console.error("[v0] Error creating colaborador_th:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

// Actualiza un colaborador. No permite cambiar idempresa. Mantiene el
// registro de headcount sincronizado.
export async function updateColaboradorTH(id: string, updates: Record<string, any>) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Colaboradores", "Head Count"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const { idempresa, id: _ignore, ...rest } = updates

  // Recuperamos el vinculo y la empresa actual del colaborador.
  const { data: current } = await supabase
    .from("colaboradores_th")
    .select("headcount_id, idempresa")
    .eq("id", id)
    .maybeSingle()

  const empresaId = current?.idempresa || (await getCurrentEmpresaIdForInsert())
  const headcountId = await syncHeadcountForColaborador(
    supabase,
    empresaId,
    { ...rest },
    current?.headcount_id ?? null,
  )

  const { data, error } = await supabase
    .from("colaboradores_th")
    .update({ ...rest, headcount_id: headcountId ?? current?.headcount_id ?? null })
    .eq("id", id)
    .select()

  if (error) {
    console.error("[v0] Error updating colaborador_th:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function deleteColaboradorTH(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Colaboradores", "Head Count"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  // Elimina tambien el registro espejo de headcount, si existe.
  const { data: current } = await supabase
    .from("colaboradores_th")
    .select("headcount_id")
    .eq("id", id)
    .maybeSingle()

  if (current?.headcount_id) {
    const { error: hcError } = await supabase.from("headcount").delete().eq("id", current.headcount_id)
    if (hcError) {
      console.error("[v0] Error eliminando headcount vinculado:", hcError.message)
    }
  }

  const { error } = await supabase.from("colaboradores_th").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting colaborador_th:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}

// CONTRATOS
export async function getContratos(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  const empresaId = selectedEmpresaId || await getCurrentEmpresaIdForInsert()

  // Get all colaborador identificaciones belonging to this empresa via headcount
  const { data: headcountData, error: headcountError } = await supabase
    .from("headcount")
    .select("identificacion")
    .eq("idempresa", empresaId)

  if (headcountError) {
    console.error("[v0] Error fetching headcount for filter:", headcountError)
    return { success: false, data: [] }
  }

  const identificaciones = (headcountData || []).map((h: any) => h.identificacion)

  if (identificaciones.length === 0) {
    return { success: true, data: [] }
  }

  const { data, error } = await supabase
    .from("contratos")
    .select("*")
    .in("colaborador_id", identificaciones)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching contratos:", error)
    return { success: false, data: [] }
  }

  return { success: true, data: data || [] }
}

export async function createContrato(contrato: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Contratos"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  // GATE de aptitud médica: el examen es requisito de contratación. Solo se puede
  // vincular con un examen VIGENTE APTO. Si el examen es NO APTO o queda PENDIENTE
  // (p. ej. aplazado para manipular alimentos, o sin concepto definitivo), se bloquea:
  // la persona debe repetir el examen y subir uno nuevo APTO como constancia.
  // Resiliente: si la tabla no existe o la persona no tiene NINGÚN examen (legado),
  // no se aplica el gate para no romper renovaciones de antiguos.
  try {
    const ced = String(contrato.colaborador_id || "").trim()
    if (ced) {
      const admin: any = await getSupabaseAdmin()
      const { data: ex } = await admin
        .from("examenes_medicos")
        .select("apto,nombre")
        .eq("cedula", ced)
        .order("created_at", { ascending: false })
        .limit(1)
      const vigente = (ex || [])[0] as any
      if (vigente && vigente.apto !== true) {
        const motivo =
          vigente.apto === false
            ? "es NO APTO"
            : "está PENDIENTE (aplazado / examen sin concepto apto)"
        return {
          success: false,
          message:
            `Contratación bloqueada: el examen médico de esta persona ${motivo}. ` +
            "No puede vincularse hasta contar con un examen médico APTO (debe repetirlo y subir la constancia).",
        }
      }
    }
  } catch {
    /* tabla de exámenes aún no disponible → no se aplica el gate */
  }

  // GATE de antecedentes: si la persona fue RECHAZADA en la verificación de
  // antecedentes, se bloquea la contratación. Resiliente: si la columna/tabla
  // no existe o no hay registro, no se aplica.
  try {
    const ced = String(contrato.colaborador_id || "").trim()
    if (ced) {
      const admin: any = await getSupabaseAdmin()
      const { data: ant } = await admin
        .from("antecedentes")
        .select("estado")
        .eq("cedula", ced)
        .order("created_at", { ascending: false })
        .limit(1)
      const a = (ant || [])[0] as any
      if (a && a.estado === "rechazado") {
        return {
          success: false,
          message:
            "Contratación bloqueada: la persona fue RECHAZADA en la verificación de antecedentes. " +
            "No puede vincularse hasta que su antecedente sea aceptado.",
        }
      }
    }
  } catch {
    /* columna/tabla de antecedentes aún no disponible → no se aplica el gate */
  }

  const sanitized = {
    colaborador_id: contrato.colaborador_id,
    fecha_inicio: contrato.fecha_inicio || null,
    fecha_fin: contrato.fecha_fin || null,
    fechaenvio: contrato.fechaenvio || null,
    fechafirma: contrato.fechafirma || null,
    tipo_contrato: contrato.tipo_contrato,
    cargo: contrato.cargo || null,
    salario_base: contrato.salario_base ? Number(contrato.salario_base) : null,
    estado: contrato.estado || "creado",
    url_documento: contrato.url_documento || null,
  }

  const { data, error } = await supabase
    .from("contratos")
    .insert([sanitized])
    .select()

  if (error) {
    console.error("[v0] Error creating contrato:", error)
    return { success: false, message: error.message }
  }

  // Al CONTRATAR: llevar el PDF de antecedentes al EXPEDIENTE (headcount.antecedentes),
  // reutilizando la URL pública ya guardada (no copia el archivo). No pisa si el
  // expediente ya tiene el documento. No crítico: si falla, no interrumpe el contrato.
  try {
    const ced = String(contrato.colaborador_id || "").trim()
    if (ced) {
      const admin: any = await getSupabaseAdmin()
      const empresaId = await getCurrentEmpresaIdForInsert()
      const { data: ant } = await admin
        .from("antecedentes")
        .select("compliance_pdf_url,policia_url")
        .eq("idempresa", empresaId)
        .eq("cedula", ced)
        .order("created_at", { ascending: false })
        .limit(1)
      const a = (ant || [])[0] as any
      const url = a?.compliance_pdf_url || a?.policia_url
      if (url) {
        const { data: hc } = await admin
          .from("headcount")
          .select("id,antecedentes")
          .eq("idempresa", empresaId)
          .eq("identificacion", ced)
          .limit(1)
        const person = (hc || [])[0] as any
        if (person && !person.antecedentes) {
          await admin.from("headcount").update({ antecedentes: url }).eq("id", person.id)
        }
      }
    }
  } catch {
    /* propagación al expediente no crítica */
  }

  return { success: true, data: data?.[0] }
}

export async function updateContrato(id: string, updates: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Contratos"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const sanitized: Record<string, any> = {}
  if ("estado" in updates) sanitized.estado = updates.estado
  if ("colaborador_id" in updates) sanitized.colaborador_id = updates.colaborador_id
  if ("fecha_inicio" in updates) sanitized.fecha_inicio = updates.fecha_inicio || null
  if ("fecha_fin" in updates) sanitized.fecha_fin = updates.fecha_fin || null
  if ("fechaenvio" in updates) sanitized.fechaenvio = updates.fechaenvio || null
  if ("fechafirma" in updates) sanitized.fechafirma = updates.fechafirma || null
  if ("tipo_contrato" in updates) sanitized.tipo_contrato = updates.tipo_contrato
  if ("cargo" in updates) sanitized.cargo = updates.cargo || null
  if ("salario_base" in updates) sanitized.salario_base = updates.salario_base ? Number(updates.salario_base) : null
  if ("url_documento" in updates) sanitized.url_documento = updates.url_documento || null
  if ("causaretiro" in updates) sanitized.causaretiro = updates.causaretiro || null

  const { data, error } = await supabase
    .from("contratos")
    .update(sanitized)
    .eq("id", id)
    .select()

  if (error) {
    console.error("[v0] Error updating contrato:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function deleteContrato(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Contratos"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { error } = await supabase.from("contratos").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting contrato:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}

// DOTACION EPP
export async function getDotacionEPP(selectedEmpresaId?: number | null) {
  const supabase = await createClient()
  const empresaId = selectedEmpresaId || await getCurrentEmpresaIdForInsert()

  // Get all colaborador identificaciones belonging to this empresa via headcount.
  // El formulario guarda colaborador_id = headcount.identificacion, asi que
  // debemos filtrar la dotacion por identificacion (no por el id de fila).
  const { data: headcountData, error: headcountError } = await supabase
    .from("headcount")
    .select("identificacion")
    .eq("idempresa", empresaId)

  if (headcountError) {
    console.error("[v0] Error fetching headcount for dotacion filter:", headcountError)
    return { success: false, data: [] }
  }

  const colaboradorIds = (headcountData || [])
    .map((h: any) => h.identificacion?.toString())
    .filter(Boolean)

  if (colaboradorIds.length === 0) {
    return { success: true, data: [] }
  }

  const { data, error } = await supabase
    .from("dotacion_epp")
    .select("*")
    .in("colaborador_id", colaboradorIds)
    .order("fecha_entrega", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching dotacion_epp:", error)
    return { success: false, data: [] }
  }

  return { success: true, data: data || [] }
}

export async function createDotacionEPP(dotacion: any, selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Dotación EPP"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const empresaId = selectedEmpresaId || await getCurrentEmpresaIdForInsert()

  const { data, error } = await supabase
    .from("dotacion_epp")
    .insert([{ ...dotacion, idempresa: empresaId }])
    .select()

  if (error) {
    console.error("[v0] Error creating dotacion_epp:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function updateDotacionEPP(id: string, updates: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Dotación EPP"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("dotacion_epp")
    .update(updates)
    .eq("id", id)
    .select()

  if (error) {
    console.error("[v0] Error updating dotacion_epp:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function deleteDotacionEPP(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Dotación EPP"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { error } = await supabase.from("dotacion_epp").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting dotacion_epp:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}

// CAPACITACIONES
export async function getCapacitaciones(selectedEmpresaId?: number | null) {
  const supabase = await createClient()

  // Las capacitaciones se filtran por la empresa seleccionada. Si se
  // provee `selectedEmpresaId`, solo se devuelven las capacitaciones
  // cuyo `idempresa` coincide. Si no se provee, se devuelve el listado
  // completo (p.ej. contextos administrativos sin empresa fijada).
  let query = supabase
    .from("capacitaciones")
    .select("*")
    .order("fecha", { ascending: false })

  if (selectedEmpresaId != null) {
    query = query.eq("idempresa", selectedEmpresaId)
  }

  const { data, error } = await query

  if (error) {
    console.error("[v0] Error fetching capacitaciones:", error)
    return { success: false, data: [] }
  }

  return { success: true, data: data || [] }
}

export async function createCapacitacion(capacitacion: any, selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Capacitaciones"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  // Si el caller envia explicitamente `idempresa` en el payload (ej.
  // selector de empresa en el formulario de Capacitaciones), lo
  // respetamos y lo dejamos como fuente de verdad. Si no viene,
  // caemos al `selectedEmpresaId` del contexto y por ultimo al de la
  // sesion actual.
  const empresaIdFromPayload =
    typeof capacitacion?.idempresa === "number"
      ? capacitacion.idempresa
      : null
  const empresaId =
    empresaIdFromPayload ??
    selectedEmpresaId ??
    (await getCurrentEmpresaIdForInsert())

  const { idempresa: _ignored, ...rest } = capacitacion || {}
  const { data, error } = await supabase
    .from("capacitaciones")
    .insert([{ ...rest, idempresa: empresaId }])
    .select()

  if (error) {
    console.error("[v0] Error creating capacitacion:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function updateCapacitacion(id: string, updates: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Capacitaciones"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("capacitaciones")
    .update(updates)
    .eq("id", id)
    .select()

  if (error) {
    console.error("[v0] Error updating capacitacion:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function deleteCapacitacion(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Capacitaciones"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { error } = await supabase
    .from("capacitaciones")
    .delete()
    .eq("id", id)

  if (error) {
    console.error("[v0] Error deleting capacitacion:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}

// CAPACITACIONES ASISTENCIA
//
// Devuelve los conteos necesarios para mostrar el badge
// "asistentes / headcount total" en el listado de capacitaciones:
//   - headcountTotal: total de colaboradores en `headcount` cuyo
//     `nombre` NO contenga "AUXILIAR" ni "PRUEBA" (case-insensitive).
//     Es transversal a todas las empresas/proyectos porque el modulo
//     de capacitaciones se trata como global.
//   - asistenciaPorCapacitacion: mapa { capacitacionId -> count } con
//     la cantidad DISTINCT de colaboradores que registraron asistencia
//     para esa capacitacion. Usamos DISTINCT por colaborador_id para
//     evitar contar dos veces si un mismo registro se duplico.
export async function getAsistenciaCapacitacionesResumen(selectedEmpresaId?: number | null) {
  const supabase = await createClient()

  // El headcount (denominador del contador de asistencia) se toma solo
  // de la empresa seleccionada (o la de la sesion como fallback).
  const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

  // Headcount filtrado. Aplicamos el filtro post-fetch porque
  // "AUXILIAR" / "PRUEBA" pueden aparecer en cualquier parte del
  // nombre, no solo al inicio.
  let headsQuery = supabase.from("headcount").select("id, nombre")
  if (empresaId) {
    headsQuery = headsQuery.eq("idempresa", empresaId)
  }
  const { data: heads, error: headErr } = await headsQuery
  if (headErr) {
    console.error("[v0] Error fetching headcount resumen:", headErr)
    return {
      success: false,
      headcountTotal: 0,
      asistenciaPorCapacitacion: {} as Record<string, number>,
    }
  }
  const excluir = (txt: string | null | undefined) => {
    const t = (txt || "").toUpperCase()
    return t.includes("AUXILIAR") || t.includes("PRUEBA")
  }
  const headcountTotal = (heads || []).filter((h) => !excluir(h.nombre)).length

  // Conteo de asistencia por capacitacion. Trae todas las filas y
  // agrupa en memoria con un Set por capacitacion para asegurar que
  // se cuente cada colaborador una sola vez.
  const { data: asistencias, error: asErr } = await supabase
    .from("capacitaciones_asistencia")
    .select("capacitacion_id, colaborador_id")
  if (asErr) {
    console.error("[v0] Error fetching asistencias resumen:", asErr)
    return {
      success: false,
      headcountTotal,
      asistenciaPorCapacitacion: {} as Record<string, number>,
    }
  }
  const acc: Record<string, Set<string>> = {}
  for (const a of asistencias || []) {
    const cid = String(a.capacitacion_id || "")
    const colab = String(a.colaborador_id || "")
    if (!cid || !colab) continue
    if (!acc[cid]) acc[cid] = new Set()
    acc[cid].add(colab)
  }
  const asistenciaPorCapacitacion: Record<string, number> = {}
  for (const k of Object.keys(acc)) {
    asistenciaPorCapacitacion[k] = acc[k].size
  }

  return { success: true, headcountTotal, asistenciaPorCapacitacion }
}

export async function getCapacitacionesAsistencia(
  capacitacionId?: string,
  selectedEmpresaId?: number | null,
) {
  const supabase = await createClient()

  // Filtramos el listado por la empresa de la sesion (o la seleccionada)
  // para que solo se muestre la asistencia registrada bajo esa empresa.
  const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

  let query = supabase
    .from("capacitaciones_asistencia")
    .select("*")
    .order("created_at", { ascending: false })

  if (capacitacionId) {
    query = query.eq("capacitacion_id", capacitacionId)
  }

  if (empresaId) {
    query = query.eq("idempresa", empresaId)
  }

  const { data, error } = await query

  if (error) {
    console.error("[v0] Error fetching capacitaciones_asistencia:", error)
    return { success: false, data: [] }
  }

  return { success: true, data: data || [] }
}

export async function createCapacitacionAsistencia(asistencia: any, selectedEmpresaId?: number | null) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Asistencia a Capacitaciones", "Gestión de Capacitaciones"], "crear")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  // Registramos siempre el `idempresa` de la empresa donde se hizo el
  // registro. Si el payload trae explicitamente `idempresa`, lo
  // respetamos; si no, usamos el `selectedEmpresaId` del contexto y por
  // ultimo el de la sesion actual.
  const empresaIdFromPayload =
    typeof asistencia?.idempresa === "number" ? asistencia.idempresa : null
  const empresaId =
    empresaIdFromPayload ??
    selectedEmpresaId ??
    (await getCurrentEmpresaIdForInsert())

  const { idempresa: _ignored, ...rest } = asistencia || {}

  const { data, error } = await supabase
    .from("capacitaciones_asistencia")
    .insert([{ ...rest, idempresa: empresaId }])
    .select()

  if (error) {
    console.error("[v0] Error creating capacitacion_asistencia:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function updateCapacitacionAsistencia(id: string, updates: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Asistencia a Capacitaciones", "Gestión de Capacitaciones"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("capacitaciones_asistencia")
    .update(updates)
    .eq("id", id)
    .select()

  if (error) {
    console.error("[v0] Error updating capacitacion_asistencia:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function deleteCapacitacionAsistencia(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Asistencia a Capacitaciones", "Gestión de Capacitaciones"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { error } = await supabase
    .from("capacitaciones_asistencia")
    .delete()
    .eq("id", id)

  if (error) {
    console.error("[v0] Error deleting capacitacion_asistencia:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}

// PLANILLA DE ASISTENCIA A CAPACITACION
//
// Genera un PDF (carta) con el encabezado de la capacitacion y una
// tabla con los colaboradores que tienen registro en
// `capacitaciones_asistencia` para esa capacitacion. Al frente de
// cada nombre se embebe la imagen de la firma (PNG) que vive en
// `archivos/firmas/...`. Devolvemos el PDF como base64 para que el
// cliente lo decodifique y dispare la descarga sin tener que crear
// otro endpoint REST.
// Datos que el usuario diligencia manualmente en el dialogo previo
// a la descarga (no estan en la tabla `capacitaciones`).
export interface PlanillaAsistenciaInputs {
  horaInicial?: string
  horaFinal?: string
  objetivo?: string
  cedulaInstructor?: string
  // Marcadores tipo checkbox del formato SST-FO-11
  tipo?: "Charla" | "Capacitacion" | "Entrenamiento" | "Otro"
  modalidad?: "Interna" | "Externa"
}

export async function generarPlanillaAsistenciaCapacitacion(
  capacitacionId: string,
  inputs: PlanillaAsistenciaInputs = {},
  selectedEmpresaId?: number | null,
): Promise<{
  success: boolean
  fileName?: string
  base64?: string
  url?: string
  error?: string
}> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Asistencia a Capacitaciones", "Gestión de Capacitaciones"], "exportar", "Planilla de asistencia")
  if (motivoAccion) return { success: false, error: motivoAccion }
  console.log("[v0] generarPlanillaAsistenciaCapacitacion inputs:", JSON.stringify(inputs))
  try {
    const supabase = await createClient()

    // 1) Capacitacion
    const { data: cap, error: capErr } = await supabase
      .from("capacitaciones")
      .select("*")
      .eq("id", capacitacionId)
      .single()
    if (capErr || !cap) {
      return {
        success: false,
        error: capErr?.message || "Capacitacion no encontrada",
      }
    }

    // 2) Asistencia + nombre del colaborador. Hacemos las consultas
    //    por separado porque `capacitaciones_asistencia` no tiene FK
    //    declarada hacia `headcount` y un join de Postgrest fallaria.
    // Resolvemos la empresa de la sesion (o la seleccionada) y filtramos
    // la asistencia para que la planilla solo incluya a las personas
    // registradas bajo esa empresa.
    const empresaId = selectedEmpresaId ?? (await getCurrentEmpresaIdForInsert())

    let asistenciaQuery = supabase
      .from("capacitaciones_asistencia")
      .select("*")
      .eq("capacitacion_id", capacitacionId)
    if (empresaId) {
      asistenciaQuery = asistenciaQuery.eq("idempresa", empresaId)
    }
    const { data: asistencias, error: asErr } = await asistenciaQuery
    if (asErr) {
      return { success: false, error: asErr.message }
    }

    const colabIds = Array.from(
      new Set((asistencias || []).map((a: any) => a.colaborador_id).filter(Boolean)),
    )
    let colabsMap = new Map<string, { nombre: string; identificacion: string }>()
    if (colabIds.length) {
      // El campo `colaborador_id` en `capacitaciones_asistencia` puede
      // contener el UUID (`id`) o la cedula (`identificacion`) del
      // colaborador, dependiendo de como se registro. Buscamos por
      // ambos criterios para cubrir las dos posibilidades.
      const { data: headsById } = await supabase
        .from("headcount")
        .select("id, nombre, identificacion")
        .in("id", colabIds as any)
      for (const h of headsById || []) {
        colabsMap.set(String(h.id), {
          nombre: h.nombre || "",
          identificacion: String(h.identificacion || ""),
        })
      }
      // Si no encontramos por id, intentamos por identificacion
      // (cedula). Esto cubre el caso donde `colaborador_id` es la
      // cedula en lugar del UUID.
      const missingIds = colabIds.filter((cid) => !colabsMap.has(String(cid)))
      if (missingIds.length) {
        const { data: headsByCedula } = await supabase
          .from("headcount")
          .select("id, nombre, identificacion")
          .in("identificacion", missingIds as any)
        for (const h of headsByCedula || []) {
          // Mapeamos usando la cedula como key porque asi viene en
          // `colaborador_id` para estos registros.
          colabsMap.set(String(h.identificacion), {
            nombre: h.nombre || "",
            identificacion: String(h.identificacion || ""),
          })
        }
      }
    }

    // 3) PDF con pdf-lib (mismo enfoque del Certificado Laboral).
    //    Importamos en runtime para no inflar el bundle de otras
    //    actions que comparten este modulo.
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")
    const pdfDoc = await PDFDocument.create()
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    // Cargar el logo LIP desde el bucket "archivos" carpeta "logos"
    // (logo_lip.png). Lo bajamos via Supabase Storage usando el mismo
    // cliente server. Si la descarga falla (archivo movido, permisos)
    // dejamos `logoImg` en null y se omite el dibujo, sin tumbar el
    // PDF entero. Probamos primero PNG y caemos a JPG como fallback
    // por si alguien sube el logo en otro formato bajo el mismo
    // nombre.
    let logoImg: any = null
    try {
      const supabaseLogo = await createClient()
      const { data: logoBlob, error: logoErr } = await supabaseLogo.storage
        .from("archivos")
        .download("logos/logo_lip.png")
      if (logoErr) {
        console.log("[v0] planilla logo download error:", logoErr.message)
      } else if (logoBlob) {
        const arrBuf = await logoBlob.arrayBuffer()
        const bytes = new Uint8Array(arrBuf)
        try {
          logoImg = await pdfDoc.embedPng(bytes)
        } catch {
          try {
            logoImg = await pdfDoc.embedJpg(bytes)
          } catch (e) {
            console.log("[v0] planilla logo embed error:", (e as any)?.message)
          }
        }
      }
    } catch (e) {
      console.log("[v0] planilla logo unexpected error:", (e as any)?.message)
    }

    // Helper: descarga la imagen de firma desde su URL publica y la
    // embebe en el PDF. Devuelve null si la URL no responde para no
    // tumbar la generacion completa por una firma rota.
    const cacheFirmas = new Map<string, any>()
    const embedFirma = async (url: string | null | undefined) => {
      if (!url) return null
      if (cacheFirmas.has(url)) return cacheFirmas.get(url)
      try {
        const r = await fetch(url)
        if (!r.ok) return null
        const buf = new Uint8Array(await r.arrayBuffer())
        // El SignaturePad guarda PNG; aun asi, intentamos JPG como
        // fallback por si alguna imagen vino de otro flujo.
        let img: any = null
        try {
          img = await pdfDoc.embedPng(buf)
        } catch {
          try {
            img = await pdfDoc.embedJpg(buf)
          } catch {
            img = null
          }
        }
        cacheFirmas.set(url, img)
        return img
      } catch {
        return null
      }
    }

    // Layout
    const PAGE_W = 612
    const PAGE_H = 792
    const margin = 40
    const contentW = PAGE_W - margin * 2

    let page = pdfDoc.addPage([PAGE_W, PAGE_H])
    let cursorY = PAGE_H - margin

    const drawText = (
      text: string,
      x: number,
      y: number,
      opts: { size?: number; bold?: boolean; color?: any } = {},
    ) => {
      const size = opts.size ?? 10
      page.drawText(text, {
        x,
        y,
        size,
        font: opts.bold ? fontBold : fontReg,
        color: opts.color ?? rgb(0, 0, 0),
      })
    }

    // Helper: corta un string al ancho dado en pt para que no se
    // salga de la celda. Agrega "..." si tuvo que recortar.
    const truncate = (text: string, maxWidth: number, size = 10, bold = false) => {
      const font = bold ? fontBold : fontReg
      if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
      let out = text
      while (out.length > 1 && font.widthOfTextAtSize(out + "...", size) > maxWidth) {
        out = out.slice(0, -1)
      }
      return out + "..."
    }

    // ---- Encabezado SST-FO-11 ----
    // Reproducimos la grilla oficial del formato "LISTADO DE
    // ASISTENCIA" con celdas dibujadas a mano (rectangulos +
    // textos). Los campos `Hora inicial`, `Hora final`, `Objetivo`
    // y `C.C.` del capacitador llegan via `inputs` porque no
    // existen en la tabla `capacitaciones`.
    const drawCell = (
      x: number,
      y: number,
      w: number,
      h: number,
      opts: { fill?: any; border?: any } = {},
    ) => {
      if (opts.fill) {
        page.drawRectangle({ x, y, width: w, height: h, color: opts.fill })
      }
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: opts.border ?? rgb(0, 0, 0),
        borderWidth: 0.7,
      })
    }
    // Helper: dibuja `text` dentro de la celda (x,y,w,h). `y` es la
    // ESQUINA INFERIOR de la celda (igual que pdf-lib). Si
    // `labelTop` viene en true, ponemos el texto pegado arriba a
    // la izquierda (estilo "Temas:", "Objetivo:"); si viene en
    // false, lo centramos verticalmente.
    const drawCellText = (
      text: string,
      x: number,
      y: number,
      w: number,
      h: number,
      opts: {
        size?: number
        bold?: boolean
        align?: "left" | "center"
        labelTop?: boolean
        padX?: number
      } = {},
    ) => {
      const size = opts.size ?? 9
      const font = opts.bold ? fontBold : fontReg
      const padX = opts.padX ?? 4
      const safe = truncate(text, w - padX * 2, size, !!opts.bold)
      const textW = font.widthOfTextAtSize(safe, size)
      const tx =
        opts.align === "center" ? x + (w - textW) / 2 : x + padX
      const ty = opts.labelTop ? y + h - size - 3 : y + (h - size) / 2 + 1
      page.drawText(safe, { x: tx, y: ty, size, font, color: rgb(0, 0, 0) })
    }

    // Bloque superior tipo grid 8 columnas. Calculamos anchos
    // proporcionales al ancho de contenido para que la planilla
    // escale si cambia el margen.
    const headerTop = cursorY
    const logoW = contentW * 0.18
    const titleW = contentW - logoW

    // Fila 1: titulo "SEGURIDAD Y SALUD EN EL TRABAJO" (logo a la
    //         izquierda ocupa 3 filas verticalmente).
    const rowH1 = 22
    const rowH2 = 22
    const rowH3 = 18
    const rowH4 = 22
    const logoH = rowH1 + rowH2 + rowH3 + rowH4
    drawCell(margin, headerTop - logoH, logoW, logoH)
    // Embebemos el logo LipGoBG.png si se cargo correctamente; de lo
    // contrario dejamos la celda vacia (el borde ya se dibujo).
    if (logoImg) {
      const imgRatio = logoImg.width / logoImg.height
      const padLogo = 6
      let drawLogoW = logoW - padLogo * 2
      let drawLogoH = drawLogoW / imgRatio
      if (drawLogoH > logoH - padLogo * 2) {
        drawLogoH = logoH - padLogo * 2
        drawLogoW = drawLogoH * imgRatio
      }
      const logoX = margin + (logoW - drawLogoW) / 2
      const logoY = headerTop - logoH + (logoH - drawLogoH) / 2
      page.drawImage(logoImg, {
        x: logoX,
        y: logoY,
        width: drawLogoW,
        height: drawLogoH,
      })
    }

    drawCell(margin + logoW, headerTop - rowH1, titleW, rowH1)
    drawCellText(
      "SEGURIDAD Y SALUD EN EL TRABAJO",
      margin + logoW,
      headerTop - rowH1,
      titleW,
      rowH1,
      { align: "center", bold: true, size: 11 },
    )
    drawCell(margin + logoW, headerTop - rowH1 - rowH2, titleW, rowH2)
    drawCellText(
      "LISTADO DE ASISTENCIA",
      margin + logoW,
      headerTop - rowH1 - rowH2,
      titleW,
      rowH2,
      { align: "center", bold: true, size: 11 },
    )

    // Fila 3: Codigo / Version / Fecha / Pagina (4 columnas)
    const metaY = headerTop - rowH1 - rowH2 - rowH3
    const metaCellW = titleW / 4
    const metaLabels = ["Codigo:", "Version", "Fecha", "Pagina"]
    for (let i = 0; i < 4; i++) {
      drawCell(margin + logoW + metaCellW * i, metaY, metaCellW, rowH3, {
        fill: rgb(0.95, 0.95, 0.95),
      })
      drawCellText(
        metaLabels[i],
        margin + logoW + metaCellW * i,
        metaY,
        metaCellW,
        rowH3,
        { align: "center", bold: true, size: 9 },
      )
    }

    // Fila 4: valores meta
    const metaValY = headerTop - rowH1 - rowH2 - rowH3 - rowH4
    const today = new Date()
    const dd = String(today.getDate()).padStart(2, "0")
    const mm = String(today.getMonth() + 1).padStart(2, "0")
    const yyyy = today.getFullYear()
    const metaValues = ["SST- FO-11", "1", `${dd}/${mm}/${yyyy}`, "1 de 1"]
    for (let i = 0; i < 4; i++) {
      drawCell(margin + logoW + metaCellW * i, metaValY, metaCellW, rowH4)
      drawCellText(
        metaValues[i],
        margin + logoW + metaCellW * i,
        metaValY,
        metaCellW,
        rowH4,
        { align: "center", size: 9 },
      )
    }

    // Bloque de campos editables. Cada fila es una celda completa
    // que ocupa el ancho de contenido (excepto las que se dividen
    // en sub-columnas: Fecha+Hora inicial+Hora final, y
    // Capacitador+C.C.+Firma).
    let y = metaValY - 2

    // Temas: una sola celda
    const fldH = 24
    y -= fldH
    drawCell(margin, y, contentW, fldH)
    drawCellText("Temas:", margin, y, contentW, fldH, {
      bold: true,
      size: 9,
      labelTop: true,
    })
    drawCellText(
      String(cap.tema || ""),
      margin + 50,
      y,
      contentW - 50,
      fldH,
      { size: 10, labelTop: true },
    )

    // Fecha | Hora inicial | Hora final
    y -= fldH
    const tercio = contentW / 3
    drawCell(margin, y, tercio, fldH)
    drawCell(margin + tercio, y, tercio, fldH)
    drawCell(margin + tercio * 2, y, tercio, fldH)
    drawCellText("Fecha:", margin, y, tercio, fldH, {
      bold: true,
      size: 9,
      labelTop: true,
    })
    drawCellText(String(cap.fecha || ""), margin + 50, y, tercio - 50, fldH, {
      size: 10,
      labelTop: true,
    })
    drawCellText("Hora inicial:", margin + tercio, y, tercio, fldH, {
      bold: true,
      size: 9,
      labelTop: true,
    })
    drawCellText(
      String(inputs.horaInicial || ""),
      margin + tercio + 70,
      y,
      tercio - 70,
      fldH,
      { size: 10, labelTop: true },
    )
    drawCellText("Hora final:", margin + tercio * 2, y, tercio, fldH, {
      bold: true,
      size: 9,
      labelTop: true,
    })
    drawCellText(
      String(inputs.horaFinal || ""),
      margin + tercio * 2 + 65,
      y,
      tercio - 65,
      fldH,
      { size: 10, labelTop: true },
    )

    // Objetivo (mas alto para texto largo)
    const objH = 36
    y -= objH
    drawCell(margin, y, contentW, objH)
    drawCellText("Objetivo:", margin, y, contentW, objH, {
      bold: true,
      size: 9,
      labelTop: true,
    })
    // Word-wrap manual del objetivo (puede ser largo).
    const objText = String(inputs.objetivo || "")
    if (objText) {
      const innerW = contentW - 60
      const words = objText.replace(/\s+/g, " ").split(" ")
      const lines: string[] = []
      let cur = ""
      for (const w of words) {
        const cand = cur ? `${cur} ${w}` : w
        if (fontReg.widthOfTextAtSize(cand, 9) > innerW && cur) {
          lines.push(cur)
          cur = w
        } else {
          cur = cand
        }
      }
      if (cur) lines.push(cur)
      const maxLines = Math.floor((objH - 4) / 11)
      lines.slice(0, maxLines).forEach((line, idx) => {
        page.drawText(line, {
          x: margin + 55,
          y: y + objH - 12 - idx * 11,
          size: 9,
          font: fontReg,
          color: rgb(0, 0, 0),
        })
      })
    }

    // Capacitador | C.C. | Firma
    y -= fldH
    const capW = contentW * 0.5
    const ccW = contentW * 0.25
    const firmaTitleW = contentW - capW - ccW
    drawCell(margin, y, capW, fldH)
    drawCell(margin + capW, y, ccW, fldH)
    drawCell(margin + capW + ccW, y, firmaTitleW, fldH)
    drawCellText("Capacitador:", margin, y, capW, fldH, {
      bold: true,
      size: 9,
      labelTop: true,
    })
    drawCellText(
      String(cap.instructor || ""),
      margin + 75,
      y,
      capW - 75,
      fldH,
      { size: 10, labelTop: true },
    )
    drawCellText("C.C.", margin + capW, y, ccW, fldH, {
      bold: true,
      size: 9,
      labelTop: true,
    })
    drawCellText(
      String(inputs.cedulaInstructor || ""),
      margin + capW + 35,
      y,
      ccW - 35,
      fldH,
      { size: 10, labelTop: true },
    )
    drawCellText(
      "Firma:",
      margin + capW + ccW,
      y,
      firmaTitleW,
      fldH,
      { bold: true, size: 9, labelTop: true },
    )

    // Tipo (Charla/Capacitacion/...) e Interna/Externa
    y -= fldH
    const tipoW = contentW * 0.65
    const modW = contentW - tipoW
    drawCell(margin, y, tipoW, fldH)
    drawCell(margin + tipoW, y, modW, fldH)
    const mark = (selected: boolean) => (selected ? "(X)" : "( )")
    const tipoStr =
      `Charla ${mark(inputs.tipo === "Charla")}     ` +
      `Capacitacion ${mark(inputs.tipo === "Capacitacion")}     ` +
      `Entrenamiento ${mark(inputs.tipo === "Entrenamiento")}     ` +
      `Otro ${mark(inputs.tipo === "Otro")}`
    drawCellText(tipoStr, margin, y, tipoW, fldH, {
      size: 9,
      labelTop: false,
    })
    const modStr =
      `Interna ${mark(inputs.modalidad === "Interna")}     ` +
      `Externa ${mark(inputs.modalidad === "Externa")}`
    drawCellText(modStr, margin + tipoW, y, modW, fldH, {
      size: 9,
      labelTop: false,
      align: "center",
    })

    cursorY = y - 10

    // ---- Tabla ----
    // Columnas: # | Cedula | Nombre | Asistio | Resultado | Firma
    const colX = {
      idx: margin,
      cedula: margin + 26,
      nombre: margin + 100,
      asistio: margin + 290,
      resultado: margin + 340,
      firma: margin + 410,
    }
    const firmaW = PAGE_W - margin - colX.firma // ancho disponible
    const rowH = 38

    const drawTableHeader = () => {
      // Fondo gris suave en la cabecera
      page.drawRectangle({
        x: margin,
        y: cursorY - 16,
        width: contentW,
        height: 20,
        color: rgb(0.93, 0.93, 0.93),
      })
      drawText("#", colX.idx + 4, cursorY - 10, { size: 10, bold: true })
      drawText("Cedula", colX.cedula, cursorY - 10, { size: 10, bold: true })
      drawText("Nombre", colX.nombre, cursorY - 10, { size: 10, bold: true })
      drawText("Asistio", colX.asistio, cursorY - 10, { size: 10, bold: true })
      drawText("Resultado", colX.resultado, cursorY - 10, { size: 10, bold: true })
      drawText("Firma", colX.firma, cursorY - 10, { size: 10, bold: true })
      cursorY -= 22
    }

    drawTableHeader()

    if (!asistencias || asistencias.length === 0) {
      drawText("No hay registros de asistencia para esta capacitacion.", margin, cursorY - 14, {
        size: 10,
      })
    } else {
      let i = 1
      for (const a of asistencias) {
        // Salto de pagina si no cabe la siguiente fila completa
        if (cursorY - rowH < margin + 20) {
          page = pdfDoc.addPage([PAGE_W, PAGE_H])
          cursorY = PAGE_H - margin
          drawTableHeader()
        }

        const rowTop = cursorY
        const rowBottom = cursorY - rowH

        // Borde inferior de la fila
        page.drawLine({
          start: { x: margin, y: rowBottom },
          end: { x: margin + contentW, y: rowBottom },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        })

        const colab = colabsMap.get(String(a.colaborador_id))
        const textY = rowTop - 14

        drawText(String(i), colX.idx + 4, textY, { size: 10 })
        drawText(
          truncate(colab?.identificacion || "-", colX.nombre - colX.cedula - 4),
          colX.cedula,
          textY,
          { size: 10 },
        )
        drawText(
          truncate(colab?.nombre || "-", colX.asistio - colX.nombre - 4),
          colX.nombre,
          textY,
          { size: 10 },
        )
        drawText(a.asistio ? "Si" : "No", colX.asistio + 4, textY, { size: 10 })
        drawText(
          truncate(String(a.resultado || "-"), colX.firma - colX.resultado - 4),
          colX.resultado,
          textY,
          { size: 10 },
        )

        // Firma: la imagen ocupa la celda manteniendo aspect ratio
        const img = await embedFirma(a.firmaurl)
        if (img) {
          const maxW = firmaW - 6
          const maxH = rowH - 6
          const ratio = img.width / img.height
          let drawW = maxW
          let drawH = drawW / ratio
          if (drawH > maxH) {
            drawH = maxH
            drawW = drawH * ratio
          }
          page.drawImage(img, {
            x: colX.firma + 3,
            y: rowBottom + (rowH - drawH) / 2,
            width: drawW,
            height: drawH,
          })
        } else {
          // Linea para firma manual cuando no hay firma digital
          page.drawLine({
            start: { x: colX.firma + 4, y: rowBottom + 8 },
            end: { x: PAGE_W - margin - 4, y: rowBottom + 8 },
            thickness: 0.5,
            color: rgb(0, 0, 0),
          })
        }

        cursorY -= rowH
        i++
      }
    }

    const pdfBytes = await pdfDoc.save()
    const base64 = Buffer.from(pdfBytes).toString("base64")

    const safeTema = (cap.tema || "Capacitacion")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    const fileName = `Planilla_Asistencia_${safeTema || "Capacitacion"}.pdf`

    // Subimos la planilla al Storage de Supabase (bucket "archivos",
    // carpeta "planillas") y guardamos su URL publica en el campo
    // `planilla` de la tabla `capacitaciones`. Asi, una vez generada,
    // el modulo de Gestion solo consulta la URL sin regenerar el PDF.
    let url: string | undefined
    try {
      const supabaseAdmin = await getSupabaseAdmin()
      const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" })
      const storagePath = `planillas/${capacitacionId}_${Date.now()}.pdf`
      const { error: uploadError } = await supabaseAdmin.storage
        .from("archivos")
        .upload(storagePath, pdfBlob, {
          contentType: "application/pdf",
          upsert: true,
        })
      if (uploadError) {
        console.log("[v0] planilla upload error:", uploadError.message)
      } else {
        const {
          data: { publicUrl },
        } = supabaseAdmin.storage.from("archivos").getPublicUrl(storagePath)
        url = publicUrl

        const { error: updateError } = await supabase
          .from("capacitaciones")
          .update({ planilla: publicUrl })
          .eq("id", capacitacionId)
        if (updateError) {
          console.log("[v0] planilla update capacitaciones error:", updateError.message)
        }
      }
    } catch (e: any) {
      console.log("[v0] planilla storage unexpected error:", e?.message)
    }

    return { success: true, fileName, base64, url }
  } catch (err: any) {
    console.error("[v0] generarPlanillaAsistenciaCapacitacion catch:", err)
    return { success: false, error: err?.message || "Error generando planilla" }
  }
}

// VACANTES
export async function getVacantes(filters?: {
  estado?: string
  cargo?: string
  ciudad?: string
  turno?: string
}) {
  const supabase = await createClient()
  const empresaId = await getCurrentEmpresaIdForInsert()

  let query = supabase
    .from("vacantes")
    .select("*")
    .eq("idempresa", empresaId)
    .order("created_at", { ascending: false })

  if (filters?.estado) {
    query = query.eq("estado", filters.estado)
  }
  if (filters?.cargo) {
    query = query.eq("cargo", filters.cargo)
  }
  if (filters?.ciudad) {
    query = query.eq("ciudad", filters.ciudad)
  }
  if (filters?.turno) {
    query = query.eq("turno", filters.turno)
  }

  const { data, error } = await query

  if (error) {
    console.error("[v0] Error fetching vacantes:", error)
    return { success: false, data: [] }
  }

  return { success: true, data: data || [] }
}

export async function createVacante(vacante: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Solicitud de Personal", "Gestión de Solicitudes"], "crear", "Solicitar personal")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()
  const empresaId = await getCurrentEmpresaIdForInsert()

  // Get the empresa (project) name
  const { data: empresaData, error: empresaError } = await supabase
    .from("owners")
    .select("nombre")
    .eq("id", empresaId)
    .maybeSingle()

  if (empresaError) {
    console.error("[v0] Error fetching empresa name:", empresaError)
    return { success: false, message: "Error al obtener el nombre de la empresa" }
  }

  const proyectoName = empresaData?.nombre || `Empresa ${empresaId}`

  const { data, error } = await supabase
    .from("vacantes")
    .insert([{ ...vacante, idempresa: empresaId, proyecto: proyectoName }])
    .select()

  if (error) {
    console.error("[v0] Error creating vacante:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function updateVacante(id: string, updates: any) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Solicitudes", "Solicitud de Personal"], "editar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("vacantes")
    .update(updates)
    .eq("id", id)
    .select()

  if (error) {
    console.error("[v0] Error updating vacante:", error)
    return { success: false, message: error.message }
  }

  return { success: true, data: data?.[0] }
}

export async function deleteVacante(id: string) {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Solicitudes"], "eliminar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  const supabase = await createClient()

  const { error } = await supabase.from("vacantes").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting vacante:", error)
    return { success: false, message: error.message }
  }

  return { success: true }
}

/**
 * Doble aprobacion de una Solicitud de Personal (vacante).
 *
 * Cada rol valida su propia columna:
 *   - RRHH       -> `aprobacion_rrhh`
 *   - Operaciones-> `aprobacion_operaciones`
 *
 * Reglas:
 *   - Aprobar: marca el rol en 'aprobado'. Si tras el update ambas
 *     aprobaciones quedan en 'aprobado', el `estado` global pasa a 'aprobado'.
 *   - Rechazar: marca el rol en 'rechazado', pone `estado` en 'rechazado' y
 *     guarda el motivo. Obligatorio el motivo.
 */
export async function gestionarAprobacionVacante(
  id: string,
  tipoAprobador: "RRHH" | "Operaciones",
  accion: "aprobar" | "rechazar",
  motivo?: string,
): Promise<{ success: boolean; nuevoEstado?: string; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Gestión de Solicitudes", "Aprobación de Solicitudes de Personal"], "aprobar")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!id) return { success: false, message: "Solicitud invalida" }
    if (tipoAprobador !== "RRHH" && tipoAprobador !== "Operaciones") {
      return { success: false, message: "Tipo de aprobador invalido" }
    }
    if (accion === "rechazar" && (!motivo || !motivo.trim())) {
      return { success: false, message: "El motivo de rechazo es obligatorio" }
    }

    const supabase = await createClient()
    const colField = tipoAprobador === "RRHH" ? "aprobacion_rrhh" : "aprobacion_operaciones"

    if (accion === "rechazar") {
      const { error } = await supabase
        .from("vacantes")
        .update({ [colField]: "rechazado", estado: "rechazado", motivo_rechazo: motivo!.trim() })
        .eq("id", id)
      if (error) return { success: false, message: error.message }
      return { success: true, nuevoEstado: "rechazado" }
    }

    // Aprobar este rol. Limpiamos motivo por si venia de un rechazo previo.
    const { error: updErr } = await supabase
      .from("vacantes")
      .update({ [colField]: "aprobado", motivo_rechazo: null })
      .eq("id", id)
    if (updErr) return { success: false, message: updErr.message }

    // Releer para evaluar la regla de aprobacion conjunta.
    const { data: refrescado, error: reErr } = await supabase
      .from("vacantes")
      .select("aprobacion_rrhh, aprobacion_operaciones, estado")
      .eq("id", id)
      .maybeSingle()
    if (reErr) return { success: false, message: reErr.message }

    const rrhhOk = refrescado?.aprobacion_rrhh === "aprobado"
    const opsOk = refrescado?.aprobacion_operaciones === "aprobado"

    if (rrhhOk && opsOk && refrescado?.estado !== "aprobado") {
      const { error: globalErr } = await supabase
        .from("vacantes")
        .update({ estado: "aprobado" })
        .eq("id", id)
      if (globalErr) return { success: false, message: globalErr.message }
      return { success: true, nuevoEstado: "aprobado" }
    }

    // Si una de las aprobaciones aun falta y el estado venia 'rechazado',
    // lo devolvemos a 'en_revision' para reflejar que esta en curso.
    if (refrescado?.estado === "rechazado") {
      await supabase.from("vacantes").update({ estado: "en_revision" }).eq("id", id)
      return { success: true, nuevoEstado: "en_revision" }
    }

    return { success: true, nuevoEstado: refrescado?.estado || "en_revision" }
  } catch (err: any) {
    return { success: false, message: err?.message || "Error desconocido" }
  }
}

export async function getProyectos() {
  const supabase = await createClient()

  try {
    console.log("[v0] Fetching proyectos from owners table...")
    const { data, error } = await supabase
      .from("owners")
      .select("id, nombre")
      .order("nombre", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching proyectos from owners:", error)
      return { success: false, data: [] }
    }

    console.log("[v0] Fetched", data?.length || 0, "proyectos from owners table")
    return { success: true, data: data || [] }
  } catch (error) {
    console.error("[v0] Unexpected error fetching proyectos:", error)
    return { success: false, data: [] }
  }
}
