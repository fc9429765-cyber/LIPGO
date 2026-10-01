"use server"

// Server actions del Sistema Integrado de Gestion (SIG).
// Lee/escribe la matriz integrada (sig_normas, sig_requisitos,
// sig_requisito_norma) y la cobertura documental (sig_documento_cobertura),
// que se apoya en el repositorio existente soportes_documentales.
//
// Convenciones LIP: createClient de @/lib/supabase-client; empresa via
// getCurrentEmpresaIdForInsert/resolveEmpresaId (nunca LIP=0); lectura en
// pasos sin joins embebidos de PostgREST (como en soportes-actions).

// Usamos el cliente admin (service role) porque las tablas sig_* tienen RLS
// y el rol anon no puede leerlas; la autorizacion del modulo ya se controla
// con los permisos (sig_matriz / sig_iso*). Mismo patron que permissions-actions.
import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { getResumenISO, type EstadoISO } from "@/lib/iso9001-actions"
import { getMatrizEstandares } from "@/lib/sst-auditoria-actions"
import { computar0312 } from "@/lib/sst-types"
import { COORDINADORES_PROYECTO, AREA_OPERACIONES } from "@/lib/coordinadores-proyecto"
import type {
  SigNorma,
  SigRequisito,
  SigRequisitoNorma,
  SigCobertura,
  SigCeldaNorma,
  SigMatrizRow,
  SigModuloCobertura,
  SigAvanceNorma,
  SigEstadoCobertura,
  SigObjetivoCobertura,
  SigDocumento,
  SigDocVersion,
  SigTipoCambio,
  SigAspectoAmbiental,
  SigObjetivo,
  SigRequisitoLegal,
  SigDofa,
  SigProceso,
  SigNcCatalogo,
  SigNoConformidad,
  SigIndicador,
  SigIndicadorValor,
  SigProcesoInteraccion,
  SigInventarioCuadre,
  SigInventarioCuadreDetalle,
  SigInventarioAjuste,
  SigInventarioCierreMes,
  SigInventarioActaCruce,
  SigInventarioActaCruceDetalle,
  SigSatisfaccion,
  SigPQRSF,
  SigTipoMovimiento,
} from "@/lib/sig-types"
import { SIG_EMPRESA_LIP, SIG_CLIENTES_LIP } from "@/lib/sig-types"
import { getMetaDiaForEmpresa } from "@/lib/empresa-meta-dia"
import { getSlaCargueMin, esNombreSubproducto, PLANTA_ACORDADA, factorTiempoSitio } from "@/lib/sla-acordados"
import { esCodigoTrasladoNetoCero, nombreMovimientoPorCodigo } from "@/lib/transacciones-codigo"
import { excluirNoFacturable } from "@/lib/facturas-exclusiones"
import { categoriaDeNovedad, diasActivosEnPeriodo, diasAusenciaDistintos } from "@/lib/ausentismo-categorias"
import { codigosOrdenPorUnidad } from "@/lib/ordenes-por-unidad"

// Mapea el estado del Centro de Evidencia ISO 9001 al estado de la matriz SIG.
function isoEstadoASig(e: EstadoISO): SigEstadoCobertura {
  if (e === "cumple") return "aprobado"
  if (e === "parcial" || e === "documental") return "cargado"
  return "pendiente"
}

// El SIG es ÚNICO de LIP: TODA su data vive bajo el alcance LIP (SIG_EMPRESA_LIP),
// independiente del cliente seleccionado en la app. El parámetro fromClient se
// mantiene por compatibilidad de firma pero se ignora a propósito. El cliente/sitio
// donde ocurre una NC (o se mide un indicador) se etiqueta aparte con proyecto_id.
async function resolveEmpresaId(_fromClient?: number | null): Promise<number> {
  return SIG_EMPRESA_LIP
}

// Estado agregado de una celda (requisito x norma) a partir de sus coberturas.
function estadoAgregado(aplica: boolean, coberturas: SigCobertura[]): SigEstadoCobertura {
  if (!aplica) return "no_aplica"
  if (coberturas.some((c) => c.estado === "aprobado")) return "aprobado"
  if (coberturas.some((c) => c.estado === "cargado" || !!c.soporte_id)) return "cargado"
  if (coberturas.some((c) => c.estado === "no_aplica")) return "no_aplica"
  return "pendiente"
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export async function getNormas(): Promise<{ success: boolean; data: SigNorma[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("sig_normas")
      .select("id, codigo, nombre, descripcion, color, orden, activo")
      .eq("activo", true)
      .order("orden", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigNorma[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Trae las 4 tablas base y arma la matriz integrada general en memoria:
 * un numeral por fila con una celda por norma (texto + aplica + coberturas).
 */
export async function getMatrizIntegrada(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; normas: SigNorma[]; rows: SigMatrizRow[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    if (!empresaId) return { success: false, normas: [], rows: [], error: "No se pudo resolver la empresa." }

    const [normasRes, reqRes, rnRes, covRes] = await Promise.all([
      supabase
        .from("sig_normas")
        .select("id, codigo, nombre, descripcion, color, orden, activo")
        .eq("activo", true)
        .order("orden", { ascending: true }),
      supabase
        .from("sig_requisitos")
        .select("id, numeral, tema, es_comun, evidencia_comun_sugerida, orden, activo")
        .eq("activo", true)
        .order("orden", { ascending: true }),
      supabase.from("sig_requisito_norma").select("id, requisito_id, norma_id, texto, aplica, peso"),
      supabase
        // "*" para tolerar que la columna documento_id aun no exista (script 04
        // opcional): si falta, simplemente no viene y la enriquecemos como null.
        .from("sig_documento_cobertura")
        .select("*")
        .eq("idempresa", empresaId),
    ])

    // Modulos de LIPgo que sustentan numerales (script 59). Si la tabla aun no
    // existe, la matriz sigue funcionando exactamente como antes: es la misma
    // degradacion suave que se aplica al Centro de Evidencia ISO 9001.
    const modulosPorReq = new Map<number, SigModuloCobertura[]>()
    try {
      const { data: mods } = await supabase
        .from("sig_requisito_modulo")
        .select("id, requisito_id, norma_id, modulo, tabla, nota")
        .eq("idempresa", empresaId)
        .eq("activo", true)

      if (mods?.length) {
        // Conteo de registros vivos por tabla, en paralelo y una sola vez por
        // tabla aunque la sustente en varios numerales. Mismo patron que
        // lib/sst-auditoria-actions.ts para la Resolucion 0312.
        //
        // `head: true` no trae filas, solo el conteo: no importa que la tabla
        // tenga datos sensibles ni cuantas filas tenga.
        const tablas = Array.from(
          new Set((mods as any[]).map((m) => m.tabla).filter((t: any): t is string => !!t)),
        )
        const conteo = new Map<string, number | null>()
        await Promise.all(
          tablas.map(async (tabla) => {
            try {
              const { count, error } = await supabase
                .from(tabla)
                .select("*", { count: "exact", head: true })
              // null (no 0) cuando falla: "no se pudo contar" y "esta vacio"
              // son cosas distintas y la UI las muestra distinto.
              conteo.set(tabla, error ? null : count ?? 0)
            } catch {
              conteo.set(tabla, null)
            }
          }),
        )

        for (const m of mods as any[]) {
          const arr = modulosPorReq.get(m.requisito_id) ?? []
          arr.push({
            id: Number(m.id),
            requisito_id: Number(m.requisito_id),
            norma_id: m.norma_id == null ? null : Number(m.norma_id),
            modulo: m.modulo,
            tabla: m.tabla ?? null,
            nota: m.nota ?? null,
            registros: m.tabla ? conteo.get(m.tabla) ?? null : null,
          })
          modulosPorReq.set(m.requisito_id, arr)
        }
      }
    } catch (e) {
      console.error("[v0] getMatrizIntegrada: no se pudieron leer los modulos:", (e as any)?.message)
    }

    const firstErr = normasRes.error || reqRes.error || rnRes.error || covRes.error
    if (firstErr) return { success: false, normas: [], rows: [], error: firstErr.message }

    const normas = (normasRes.data ?? []) as SigNorma[]
    const requisitos = (reqRes.data ?? []) as SigRequisito[]
    const rn = (rnRes.data ?? []) as SigRequisitoNorma[]
    const cov = (covRes.data ?? []) as SigCobertura[]

    // Enriquecer coberturas con el documento real (sig_documentos). La referencia
    // al documento se guarda en `observacion` con prefijo "doc:<uuid>" para no
    // depender de un cambio de tipo de columna (documento_id quedo como bigint en
    // la BD y sig_documentos.id es uuid). Ver vincularDocumentoAObjetivos.
    const parseDocRef = (obs: string | null): string | null =>
      obs && obs.startsWith("doc:") ? obs.slice(4) : null
    const docIds = Array.from(new Set(cov.map((c) => parseDocRef(c.observacion)).filter((v): v is string => !!v)))
    if (docIds.length > 0) {
      const { data: docs } = await supabase
        .from("sig_documentos")
        .select("id, codigo, nombre, tipo, proceso, version, estado, soporte, proceso_id, categoria")
        .in("id", docIds)
      const docMap = new Map<string, SigDocumento>()
      for (const d of (docs ?? []) as SigDocumento[]) docMap.set(d.id, d)
      for (const c of cov) {
        const did = parseDocRef(c.observacion)
        c.documento_id = did
        c.documento = did ? docMap.get(did) ?? null : null
      }
    }

    // Cableado ISO 9001: traemos el Centro de Evidencia (iso_clausulas con
    // estado auto+manual) y lo indexamos por numeral. Si falla, la columna
    // ISO 9001 simplemente cae a cobertura propia (degradacion suave).
    const isoPorNumeral = new Map<string, { estado: EstadoISO; valor: string | null }>()
    try {
      const resumen = await getResumenISO()
      for (const c of resumen.clausulas) {
        if (c.numero) isoPorNumeral.set(String(c.numero).trim(), { estado: c.estado, valor: c.valor })
        if (c.codigo_sig) isoPorNumeral.set(String(c.codigo_sig).trim(), { estado: c.estado, valor: c.valor })
      }
    } catch (e) {
      console.error("[v0] getMatrizIntegrada: no se pudo leer ISO 9001:", (e as any)?.message)
    }
    const normaIso9001Id = normas.find((n) => n.codigo === "ISO9001")?.id ?? null

    // Indices para armar en O(n).
    const rnByReqNorma = new Map<string, SigRequisitoNorma>()
    for (const r of rn) rnByReqNorma.set(`${r.requisito_id}:${r.norma_id}`, r)
    const covByReqNorma = new Map<string, SigCobertura[]>()
    for (const c of cov) {
      const k = `${c.requisito_id}:${c.norma_id}`
      const arr = covByReqNorma.get(k) ?? []
      arr.push(c)
      covByReqNorma.set(k, arr)
    }

    const rows: SigMatrizRow[] = requisitos.map((req) => {
      const celdas: SigCeldaNorma[] = normas.map((n) => {
        const detalle = rnByReqNorma.get(`${req.id}:${n.id}`)
        const aplica = detalle ? detalle.aplica : false
        const coberturas = covByReqNorma.get(`${req.id}:${n.id}`) ?? []

        // Modulos que sustentan este numeral EN ESTA NORMA: los que declaran
        // esta norma explicitamente y los comodin (norma_id null), que aplican
        // a todas. Se adjuntan siempre, incluso cuando la fuente termina siendo
        // otra: el auditor quiere ver el modulo aunque el estado venga de ISO.
        const modulos = (modulosPorReq.get(req.id) ?? []).filter(
          (m) => m.norma_id == null || m.norma_id === n.id,
        )

        // PRECEDENCIA DE FUENTES (explicita, no accidental):
        //   1. iso9001  — el Centro de Evidencia ya calcula contra datos reales
        //                 del ERP; es la medicion mas fuerte que existe.
        //   2. modulo   — hay un modulo declarado que sustenta el numeral.
        //   3. matriz   — cobertura propia: documentos subidos + estado manual.
        //
        // Si es la columna ISO 9001 y existe la clausula en el Centro de
        // Evidencia para este numeral, el estado proviene de alli (real).
        const iso = n.id === normaIso9001Id ? isoPorNumeral.get(req.numeral.trim()) : undefined
        if (iso && aplica) {
          return {
            norma_id: n.id,
            codigo: n.codigo,
            texto: detalle?.texto ?? null,
            aplica,
            peso: detalle?.peso ?? 1,
            coberturas,
            modulos,
            estado: isoEstadoASig(iso.estado),
            fuente: "iso9001" as const,
            valorFuente: iso.valor,
          }
        }

        // Sustentado por un modulo de LIPgo.
        if (modulos.length > 0 && aplica) {
          // Un modulo DECLARADO pero VACIO no es evidencia: ante un auditor no
          // sirve decir "existe la pantalla" si no tiene un solo registro. Por
          // eso solo cuenta como cargado cuando hay registros vivos.
          //
          // Cuando no se pudo contar (registros null, p. ej. la tabla no
          // existe) tampoco se afirma cobertura: se prefiere quedar corto antes
          // que reportar un cumplimiento que nadie verifico.
          const vivos = modulos.reduce((acc, m) => acc + (m.registros ?? 0), 0)
          const conConteo = modulos.some((m) => m.registros != null)
          const porModulo: SigEstadoCobertura = vivos > 0 ? "cargado" : "pendiente"

          // Declarar un modulo NUNCA puede restar evidencia ya existente: si la
          // celda ya tenia un documento aprobado --o cargado, y el modulo esta
          // vacio-- ese estado se conserva. Se toma el mas fuerte de los dos,
          // no el del modulo. Sin esto, mapear un modulo vacio a un numeral que
          // ya tenia soportes lo bajaria a pendiente y borraria trabajo hecho.
          const propio = estadoAgregado(aplica, coberturas)
          const RANGO: Record<SigEstadoCobertura, number> = {
            no_aplica: 0,
            pendiente: 1,
            cargado: 2,
            aprobado: 3,
          }
          const estado = RANGO[propio] >= RANGO[porModulo] ? propio : porModulo

          return {
            norma_id: n.id,
            codigo: n.codigo,
            texto: detalle?.texto ?? null,
            aplica,
            peso: detalle?.peso ?? 1,
            coberturas,
            modulos,
            estado,
            fuente: "modulo" as const,
            valorFuente: conConteo
              ? `${vivos} registro${vivos === 1 ? "" : "s"}`
              : "sin conteo disponible",
          }
        }

        return {
          norma_id: n.id,
          codigo: n.codigo,
          texto: detalle?.texto ?? null,
          aplica,
          peso: detalle?.peso ?? 1,
          coberturas,
          modulos,
          estado: estadoAgregado(aplica, coberturas),
          fuente: "matriz" as const,
        }
      })
      return { requisito: req, celdas }
    })

    return { success: true, normas, rows }
  } catch (err: any) {
    return { success: false, normas: [], rows: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Vista de una sola norma (por codigo): solo numerales que aplican, con su
 * texto, estado y coberturas. Para las pestanas individuales del modulo.
 */
export async function getRequisitosPorNorma(
  codigo: string,
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; norma: SigNorma | null; rows: SigMatrizRow[]; error?: string }> {
  try {
    const full = await getMatrizIntegrada(empresaIdFromClient)
    if (!full.success) return { success: false, norma: null, rows: [], error: full.error }
    const norma = full.normas.find((n) => n.codigo === codigo) ?? null
    if (!norma) return { success: false, norma: null, rows: [], error: `Norma ${codigo} no encontrada` }
    const rows = full.rows
      .map((r) => ({ requisito: r.requisito, celdas: r.celdas.filter((c) => c.norma_id === norma.id) }))
      .filter((r) => r.celdas.length > 0 && r.celdas[0].aplica)
    return { success: true, norma, rows }
  } catch (err: any) {
    return { success: false, norma: null, rows: [], error: err?.message || "Error desconocido" }
  }
}

/** Resumen de avance por norma (para el tablero del auditor). */
export async function getAvancePorNorma(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigAvanceNorma[]; error?: string }> {
  try {
    const full = await getMatrizIntegrada(empresaIdFromClient)
    if (!full.success) return { success: false, data: [], error: full.error }

    const data: SigAvanceNorma[] = full.normas.map((n) => {
      let total = 0
      let cargados = 0
      let aprobados = 0
      for (const row of full.rows) {
        const celda = row.celdas.find((c) => c.norma_id === n.id)
        if (!celda || !celda.aplica) continue
        total += 1
        if (celda.estado === "aprobado") {
          aprobados += 1
          cargados += 1
        } else if (celda.estado === "cargado") {
          cargados += 1
        }
      }
      return {
        norma_id: n.id,
        codigo: n.codigo,
        nombre: n.nombre,
        color: n.color,
        total_aplica: total,
        cargados,
        aprobados,
        pct: total > 0 ? Math.round((aprobados / total) * 100) : 0,
      }
    })
    return { success: true, data }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/**
 * Inserta o actualiza una cobertura (requisito x norma) para la empresa.
 * Clave natural: (idempresa, requisito_id, norma_id, soporte_id).
 */
/* =========================================================================
 * MODULOS QUE SUSTENTAN NUMERALES (script 59)
 *
 * Un numeral puede estar cubierto por un MODULO de LIPgo en vez de un archivo.
 * Ver el encabezado de scripts/sig/59_requisito_modulo.sql.
 * ========================================================================= */

/**
 * Tablas de respaldo permitidas para contar registros vivos.
 *
 * ES UNA LISTA CERRADA A PROPOSITO. El nombre de tabla se usa para construir
 * una consulta, asi que aceptarlo desde el cliente dejaria que cualquiera
 * apuntara el conteo a `usuarios`, `pagonomina` o cualquier tabla con datos
 * personales. El conteo solo devuelve un numero, pero ese numero ya es
 * informacion que nadie pidio exponer.
 *
 * Para habilitar una tabla nueva se agrega aqui, revisando que sea del SIG.
 */
const TABLAS_MODULO_PERMITIDAS = new Set<string>([
  "sig_contexto_dofa",
  "sig_objetivos",
  "sig_no_conformidades",
  "sig_indicadores",
  "sig_aspectos_ambientales",
  "sig_requisitos_legales",
  "sig_satisfaccion",
  "sig_pqrsf",
  "sig_documentos",
  "sst_ipevr",
  "sst_incidentes",
  "sst_gestion_cambio",
  "sst_plan_mejora",
  "sst_indicadores",
  "sst_autoevaluaciones",
  "sst_perfil_sociodemografico",
  "sst_comunicaciones",
  "sst_autorreportes",
  "sst_pqrsf",
])

/** Tablas que la interfaz puede ofrecer, ordenadas. */
export async function getTablasModuloPermitidas(): Promise<string[]> {
  return Array.from(TABLAS_MODULO_PERMITIDAS).sort()
}

/** Modulos declarados para un requisito (todas las normas). */
export async function getModulosDeRequisito(
  requisitoId: number,
): Promise<{ success: boolean; data: SigModuloCobertura[]; error?: string }> {
  if (!requisitoId) return { success: false, data: [], error: "Falta el requisito." }
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("sig_requisito_modulo")
      .select("id, requisito_id, norma_id, modulo, tabla, nota")
      .eq("idempresa", SIG_EMPRESA_LIP)
      .eq("requisito_id", requisitoId)
      .eq("activo", true)
      .order("modulo", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    const filas: SigModuloCobertura[] = (data ?? []).map((m: any) => ({
      id: Number(m.id),
      requisito_id: Number(m.requisito_id),
      norma_id: m.norma_id == null ? null : Number(m.norma_id),
      modulo: m.modulo,
      tabla: m.tabla ?? null,
      nota: m.nota ?? null,
      registros: null, // el conteo lo hace getMatrizIntegrada; aqui no hace falta
    }))
    return { success: true, data: filas }
  } catch (e: any) {
    return { success: false, data: [], error: e?.message || "No se pudieron leer los modulos." }
  }
}

/**
 * Declara que un modulo sustenta un numeral.
 *
 * `normaId` en null = aplica a todas las normas donde el requisito aplique,
 * que es lo habitual: el modulo DOFA sustenta el 4.1 de las tres normas.
 */
export async function vincularModuloARequisito(payload: {
  requisitoId: number
  normaId?: number | null
  modulo: string
  tabla?: string | null
  nota?: string | null
  actualizadoPor?: string | null
}): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    const modulo = payload.modulo?.trim()
    if (!payload.requisitoId) return { success: false, error: "Falta el requisito." }
    if (!modulo) return { success: false, error: "Falta el modulo." }

    // La tabla se valida contra la lista cerrada: nunca se confia en el cliente.
    const tabla = payload.tabla?.trim() || null
    if (tabla && !TABLAS_MODULO_PERMITIDAS.has(tabla)) {
      return { success: false, error: `La tabla "${tabla}" no esta habilitada para conteo.` }
    }

    const supabase: any = await getSupabaseAdmin()

    // Evita duplicar el mismo modulo en el mismo (requisito, norma). Se hace en
    // codigo ademas de los indices unicos parciales del script 59 para poder
    // devolver un mensaje claro en vez de un error de constraint.
    let q = supabase
      .from("sig_requisito_modulo")
      .select("id")
      .eq("idempresa", SIG_EMPRESA_LIP)
      .eq("requisito_id", payload.requisitoId)
      .eq("modulo", modulo)
    // Postgres: NULL <> NULL, asi que un .eq(null) no encuentra las filas
    // comodin. Hay que usar .is() para esas.
    q = payload.normaId == null ? q.is("norma_id", null) : q.eq("norma_id", payload.normaId)
    const { data: ya } = await q.maybeSingle()
    if (ya?.id) return { success: true, id: Number(ya.id) }

    const { data, error } = await supabase
      .from("sig_requisito_modulo")
      .insert({
        idempresa: SIG_EMPRESA_LIP,
        requisito_id: payload.requisitoId,
        norma_id: payload.normaId ?? null,
        modulo,
        tabla,
        nota: payload.nota?.trim() || null,
        actualizado_por: payload.actualizadoPor ?? null,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: Number(data.id) }
  } catch (e: any) {
    return { success: false, error: e?.message || "No se pudo vincular el modulo." }
  }
}

/** Quita la declaracion de que un modulo sustenta un numeral. */
export async function desvincularModuloDeRequisito(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  if (!id) return { success: false, error: "Falta el registro." }
  try {
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_requisito_modulo").delete().eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message || "No se pudo quitar el modulo." }
  }
}

export async function upsertCobertura(
  payload: {
    requisitoId: number
    normaId: number
    soporteId?: number | null
    estado?: SigEstadoCobertura
    observacion?: string | null
    actualizadoPor?: string | null
  },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    const { requisitoId, normaId } = payload
    if (!requisitoId || !normaId) return { success: false, error: "requisito y norma son obligatorios" }
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    if (!empresaId) return { success: false, error: "No se pudo resolver la empresa." }

    const supabase: any = await getSupabaseAdmin()
    const row = {
      idempresa: empresaId,
      requisito_id: requisitoId,
      norma_id: normaId,
      soporte_id: payload.soporteId ?? null,
      estado: payload.estado ?? (payload.soporteId ? "cargado" : "pendiente"),
      observacion: payload.observacion ?? null,
      actualizado_por: payload.actualizadoPor ?? null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase
      .from("sig_documento_cobertura")
      .upsert(row, { onConflict: "idempresa,requisito_id,norma_id,soporte_id" })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Ajusta el peso de un requisito DENTRO DE UNA NORMA (sig_requisito_norma.peso).
 * Mismo rol que sst_estandar_items.peso en la 0312: alimenta el % ponderado
 * de avance de esa norma (ver `avance` en matriz-integrada-sig.tsx). No toca
 * ninguna cobertura ni estado -- solo el peso.
 */
export async function actualizarPesoRequisitoNorma(
  requisitoId: number,
  normaId: number,
  peso: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!requisitoId || !normaId) return { success: false, error: "requisito y norma son obligatorios" }
    if (!Number.isFinite(peso) || peso < 0) return { success: false, error: "El peso debe ser un número positivo." }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase
      .from("sig_requisito_norma")
      .update({ peso })
      .eq("requisito_id", requisitoId)
      .eq("norma_id", normaId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Vincula UN soporte ya existente (soportes_documentales.id) a VARIOS pares
 * (requisito, norma) de una sola vez: este es el corazon del "documento
 * compartido" entre normas del SIG.
 */
export async function vincularSoporteAObjetivos(
  soporteId: number,
  objetivos: SigObjetivoCobertura[],
  opts?: { estado?: SigEstadoCobertura; observacion?: string | null; actualizadoPor?: string | null },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; insertados: number; error?: string }> {
  try {
    if (!soporteId) return { success: false, insertados: 0, error: "soporteId requerido" }
    if (!objetivos?.length) return { success: false, insertados: 0, error: "Selecciona al menos un requisito/norma" }
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    if (!empresaId) return { success: false, insertados: 0, error: "No se pudo resolver la empresa." }

    const supabase: any = await getSupabaseAdmin()
    const now = new Date().toISOString()
    const rows = objetivos.map((o) => ({
      idempresa: empresaId,
      requisito_id: o.requisitoId,
      norma_id: o.normaId,
      soporte_id: soporteId,
      estado: opts?.estado ?? "cargado",
      observacion: opts?.observacion ?? null,
      actualizado_por: opts?.actualizadoPor ?? null,
      updated_at: now,
    }))
    const { data, error } = await supabase
      .from("sig_documento_cobertura")
      .upsert(rows, { onConflict: "idempresa,requisito_id,norma_id,soporte_id" })
      .select("id")
    if (error) return { success: false, insertados: 0, error: error.message }
    return { success: true, insertados: (data ?? []).length }
  } catch (err: any) {
    return { success: false, insertados: 0, error: err?.message || "Error desconocido" }
  }
}

/** Cambia el estado de una cobertura (p.ej. aprobar evidencia desde el panel del auditor). */
export async function setEstadoCobertura(
  id: number,
  estado: SigEstadoCobertura,
  actualizadoPor?: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase
      .from("sig_documento_cobertura")
      .update({ estado, actualizado_por: actualizadoPor ?? null, updated_at: new Date().toISOString() })
      .eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/** Elimina una cobertura (no toca el soporte fisico ni el documento maestro). */
export async function eliminarCobertura(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_documento_cobertura").delete().eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Documentos del SIG (maestro sig_documentos, 94 reales)
// ---------------------------------------------------------------------------

/** Lista documentos del maestro para el selector (con busqueda opcional). */
export async function getDocumentos(
  filtro?: string,
): Promise<{ success: boolean; data: SigDocumento[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    let query = supabase
      .from("sig_documentos")
      .select("id, codigo, nombre, tipo, proceso, version, estado, soporte, proceso_id, categoria")
      .order("codigo", { ascending: true })
    if (filtro && filtro.trim()) {
      const f = filtro.trim().replace(/[%,]/g, "")
      query = query.or(`codigo.ilike.%${f}%,nombre.ilike.%${f}%,proceso.ilike.%${f}%`)
    }
    const { data, error } = await query.limit(500)
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigDocumento[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Vincula un documento del maestro (sig_documentos) a uno o varios pares
 * (requisito, norma): este es el "documento compartido" entre normas del SIG.
 * Usa delete+insert por par para no duplicar el mismo documento en la misma celda.
 */
export async function vincularDocumentoAObjetivos(
  documentoId: string,
  objetivos: SigObjetivoCobertura[],
  opts?: { estado?: SigEstadoCobertura; observacion?: string | null; actualizadoPor?: string | null },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; vinculados: number; error?: string }> {
  try {
    if (!documentoId) return { success: false, vinculados: 0, error: "documentoId requerido" }
    if (!objetivos?.length) return { success: false, vinculados: 0, error: "Selecciona al menos un requisito/norma" }
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    if (!empresaId) return { success: false, vinculados: 0, error: "No se pudo resolver la empresa." }

    const supabase: any = await getSupabaseAdmin()
    const now = new Date().toISOString()
    const ref = `doc:${documentoId}`
    let vinculados = 0
    for (const o of objetivos) {
      // Evita duplicar el mismo documento en el mismo (requisito, norma).
      await supabase
        .from("sig_documento_cobertura")
        .delete()
        .eq("idempresa", empresaId)
        .eq("requisito_id", o.requisitoId)
        .eq("norma_id", o.normaId)
        .eq("observacion", ref)
      const { error } = await supabase.from("sig_documento_cobertura").insert({
        idempresa: empresaId,
        requisito_id: o.requisitoId,
        norma_id: o.normaId,
        soporte_id: null,
        // La lectura sigue siendo por `observacion` (es la convencion que ya
        // usa getMatrizIntegrada), pero la columna documento_id existe con su
        // indice desde el script 04 y quedaba siempre en null. Se puebla para
        // que la referencia este tambien en un campo tipado y consultable.
        documento_id: documentoId,
        estado: opts?.estado ?? "cargado",
        observacion: ref, // referencia al documento (doc:<uuid>)
        actualizado_por: opts?.actualizadoPor ?? null,
        updated_at: now,
      })
      if (!error) vinculados += 1
    }
    return { success: true, vinculados }
  } catch (err: any) {
    return { success: false, vinculados: 0, error: err?.message || "Error desconocido" }
  }
}

/**
 * Repositorio documental por norma: lista los documentos del maestro
 * (sig_documentos) que estan vinculados a la norma dada (via cobertura),
 * con los numerales que cubre cada uno. Es la vista "que documentos
 * sustentan esta norma" para el auditor.
 */
export async function getDocumentosPorNorma(
  codigo: string,
  empresaIdFromClient?: number | null,
): Promise<{
  success: boolean
  norma: SigNorma | null
  data: { documento: SigDocumento; numerales: string[] }[]
  error?: string
}> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    if (!empresaId) return { success: false, norma: null, data: [], error: "No se pudo resolver la empresa." }

    const { data: norma } = await supabase
      .from("sig_normas")
      .select("id, codigo, nombre, descripcion, color, orden, activo")
      .eq("codigo", codigo)
      .maybeSingle()
    if (!norma) return { success: false, norma: null, data: [], error: `Norma ${codigo} no encontrada` }

    const { data: cov } = await supabase
      .from("sig_documento_cobertura")
      .select("requisito_id, observacion")
      .eq("idempresa", empresaId)
      .eq("norma_id", norma.id)

    const parse = (o: string | null) => (o && o.startsWith("doc:") ? o.slice(4) : null)
    const rows = (cov ?? [])
      .map((c: any) => ({ docId: parse(c.observacion), reqId: c.requisito_id }))
      .filter((r: any) => r.docId)
    if (!rows.length) return { success: true, norma: norma as SigNorma, data: [] }

    const docIds = Array.from(new Set(rows.map((r: any) => r.docId)))
    const reqIds = Array.from(new Set(rows.map((r: any) => r.reqId)))
    const [docsRes, reqsRes] = await Promise.all([
      supabase.from("sig_documentos").select("id, codigo, nombre, tipo, proceso, version, estado, soporte, proceso_id, categoria").in("id", docIds),
      supabase.from("sig_requisitos").select("id, numeral").in("id", reqIds),
    ])
    const docMap = new Map<string, SigDocumento>((docsRes.data ?? []).map((d: any) => [d.id, d]))
    const reqMap = new Map<number, string>((reqsRes.data ?? []).map((r: any) => [r.id, r.numeral]))

    const byDoc = new Map<string, { documento: SigDocumento; numerales: Set<string> }>()
    for (const r of rows) {
      const doc = docMap.get(r.docId)
      if (!doc) continue
      const e = byDoc.get(r.docId) ?? { documento: doc, numerales: new Set<string>() }
      const num = reqMap.get(r.reqId)
      if (num) e.numerales.add(num)
      byDoc.set(r.docId, e)
    }
    const data = Array.from(byDoc.values())
      .map((e) => ({ documento: e.documento, numerales: Array.from(e.numerales).sort() }))
      .sort((a, b) => (a.documento.codigo || "").localeCompare(b.documento.codigo || ""))
    return { success: true, norma: norma as SigNorma, data }
  } catch (err: any) {
    return { success: false, norma: null, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Listado Maestro: TODOS los documentos del SIG con las normas y numerales que
 * cubren (según cobertura) y su última versión registrada. Vista global para
 * el auditor (ISO 7.5 — control de la información documentada).
 */
export async function getListadoMaestro(empresaIdFromClient?: number | null): Promise<{
  success: boolean
  data: {
    documento: SigDocumento
    normas: string[]
    numerales: string[]
    ultimaVersion: SigDocVersion | null
  }[]
  error?: string
}> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)

    const [docsRes, normasRes, reqRes, covRes, verRes] = await Promise.all([
      supabase.from("sig_documentos").select("id, codigo, nombre, tipo, proceso, version, estado, soporte, proceso_id, categoria"),
      supabase.from("sig_normas").select("id, codigo"),
      supabase.from("sig_requisitos").select("id, numeral"),
      supabase
        .from("sig_documento_cobertura")
        .select("requisito_id, norma_id, observacion")
        .eq("idempresa", empresaId),
      supabase
        .from("sig_documento_versiones")
        .select("*")
        .order("created_at", { ascending: false }),
    ])

    const normaMap = new Map<number, string>((normasRes.data ?? []).map((n: any) => [n.id, n.codigo]))
    const reqMap = new Map<number, string>((reqRes.data ?? []).map((r: any) => [r.id, r.numeral]))
    const parse = (o: string | null) => (o && o.startsWith("doc:") ? o.slice(4) : null)

    // docId -> { normas:Set, numerales:Set }
    const cobByDoc = new Map<string, { normas: Set<string>; numerales: Set<string> }>()
    for (const c of covRes.data ?? []) {
      const did = parse(c.observacion)
      if (!did) continue
      const e = cobByDoc.get(did) ?? { normas: new Set<string>(), numerales: new Set<string>() }
      const nc = normaMap.get(c.norma_id)
      if (nc) e.normas.add(nc)
      const num = reqMap.get(c.requisito_id)
      if (num) e.numerales.add(num)
      cobByDoc.set(did, e)
    }

    // docId -> ultima version (la primera por orden desc)
    const verByDoc = new Map<string, SigDocVersion>()
    for (const v of (verRes.data ?? []) as SigDocVersion[]) {
      if (v.documento_id && !verByDoc.has(v.documento_id)) verByDoc.set(v.documento_id, v)
    }

    const data = ((docsRes.data ?? []) as SigDocumento[])
      .map((d) => {
        const cob = cobByDoc.get(d.id)
        return {
          documento: d,
          normas: cob ? Array.from(cob.normas).sort() : [],
          numerales: cob ? Array.from(cob.numerales).sort() : [],
          ultimaVersion: verByDoc.get(d.id) ?? null,
        }
      })
      .sort((a, b) => (a.documento.codigo || "").localeCompare(b.documento.codigo || ""))

    return { success: true, data }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// ISO 14001 — Aspectos e impactos ambientales (numeral 6.1.2)
// ---------------------------------------------------------------------------

/** Lista la matriz de aspectos e impactos ambientales de la empresa. */
export async function getAspectosAmbientales(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigAspectoAmbiental[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const { data, error } = await supabase
      .from("sig_aspectos_ambientales")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("id", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigAspectoAmbiental[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/** Crea o actualiza un aspecto ambiental. Si trae id → update; si no → insert. */
export async function upsertAspectoAmbiental(
  payload: {
    id?: number
    actividad: string
    aspecto: string
    impacto?: string | null
    tipo_recurso?: string | null
    condicion?: string | null
    cumplimiento_legal?: boolean
    frecuencia?: number
    severidad?: number
    alcance?: number
    significancia?: string
    control?: string | null
    responsable?: string | null
  },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!payload.actividad?.trim() || !payload.aspecto?.trim()) {
      return { success: false, error: "Actividad y aspecto son obligatorios" }
    }
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const fila = {
      actividad: payload.actividad.trim(),
      aspecto: payload.aspecto.trim(),
      impacto: payload.impacto ?? null,
      tipo_recurso: payload.tipo_recurso ?? null,
      condicion: payload.condicion ?? "normal",
      cumplimiento_legal: payload.cumplimiento_legal ?? true,
      frecuencia: payload.frecuencia ?? 3,
      severidad: payload.severidad ?? 3,
      alcance: payload.alcance ?? 3,
      significancia: payload.significancia ?? "no_significativo",
      control: payload.control ?? null,
      responsable: payload.responsable ?? null,
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_aspectos_ambientales").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_aspectos_ambientales")
      .insert({ ...fila, idempresa: empresaId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Indicador ambiental de DIGITALIZACIÓN (ahorro de papel) — objetivo ISO 14001
 * (6.2) y diferenciador de LIP: procesos en LIPgo en vez de papel. Cuenta en
 * vivo los registros digitales y estima hojas/resmas/kg de papel ahorrados.
 */
export async function getIndicadorDigitalizacion(): Promise<{
  success: boolean
  registros: number
  hojas: number
  resmas: number
  kg: number
  desglose: { label: string; count: number }[]
  error?: string
}> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const fuentes: { tabla: string; label: string }[] = [
      { tabla: "registroasistencia", label: "Registros de asistencia / turnos" },
      { tabla: "registrosanitario", label: "Registros sanitarios" },
      { tabla: "solicitudes_trabajadores", label: "Solicitudes (certificados, anticipos, permisos)" },
      { tabla: "capacitaciones_evaluacion_intentos", label: "Evaluaciones de capacitación" },
      { tabla: "capacitaciones", label: "Capacitaciones" },
      { tabla: "sig_documentos", label: "Documentos del SIG controlados digitalmente" },
    ]
    const desglose: { label: string; count: number }[] = []
    for (const f of fuentes) {
      const { count, error } = await supabase.from(f.tabla).select("*", { count: "exact", head: true })
      if (!error) desglose.push({ label: f.label, count: count ?? 0 })
    }
    const registros = desglose.reduce((s, d) => s + d.count, 0)
    const hojas = registros // 1 hoja por registro (estimación conservadora)
    const resmas = Math.round(hojas / 500)
    const kg = Math.round((hojas * 5) / 1000) // ~5 g por hoja A4
    return { success: true, registros, hojas, resmas, kg, desglose }
  } catch (err: any) {
    return { success: false, registros: 0, hojas: 0, resmas: 0, kg: 0, desglose: [], error: err?.message || "Error" }
  }
}

// ---------------------------------------------------------------------------
// Análisis de Contexto / DOFA (sig_contexto_dofa, numeral 4.1)
// ---------------------------------------------------------------------------

export async function getContextoDofa(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigDofa[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const { data, error } = await supabase
      .from("sig_contexto_dofa")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("cuadrante", { ascending: true })
      .order("orden", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigDofa[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function upsertDofa(
  payload: { id?: number; cuadrante: string; origen?: string | null; descripcion: string; orden?: number },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!payload.descripcion?.trim()) return { success: false, error: "La descripción es obligatoria" }
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const externo = payload.cuadrante === "oportunidad" || payload.cuadrante === "amenaza"
    const fila = {
      cuadrante: payload.cuadrante,
      origen: payload.origen ?? (externo ? "externo" : "interno"),
      descripcion: payload.descripcion.trim(),
      orden: payload.orden ?? 99,
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_contexto_dofa").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_contexto_dofa")
      .insert({ ...fila, idempresa: empresaId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarDofa(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_contexto_dofa").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Matriz Legal (sig_requisitos_legales, numeral 6.1.3)
// ---------------------------------------------------------------------------

export async function getRequisitosLegales(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigRequisitoLegal[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const { data, error } = await supabase
      .from("sig_requisitos_legales")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("id", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigRequisitoLegal[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function upsertRequisitoLegal(
  payload: {
    id?: number
    norma_codigo?: string
    tipo_norma?: string | null
    identificacion: string
    titulo?: string | null
    requisito?: string | null
    como_cumple?: string | null
    cumple?: string
    responsable?: string | null
  },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!payload.identificacion?.trim()) return { success: false, error: "La identificación de la norma es obligatoria" }
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const fila = {
      norma_codigo: payload.norma_codigo ?? "ISO14001",
      tipo_norma: payload.tipo_norma ?? null,
      identificacion: payload.identificacion.trim(),
      titulo: payload.titulo ?? null,
      requisito: payload.requisito ?? null,
      como_cumple: payload.como_cumple ?? null,
      cumple: payload.cumple ?? "cumple",
      responsable: payload.responsable ?? null,
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_requisitos_legales").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_requisitos_legales")
      .insert({ ...fila, idempresa: empresaId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarRequisitoLegal(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_requisitos_legales").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Objetivos y Metas del SIG (sig_objetivos, numeral 6.2)
// ---------------------------------------------------------------------------

export async function getObjetivos(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigObjetivo[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const { data, error } = await supabase
      .from("sig_objetivos")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("id", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigObjetivo[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function upsertObjetivo(
  payload: {
    id?: number
    norma_codigo: string
    objetivo: string
    meta?: string | null
    indicador?: string | null
    unidad?: string | null
    linea_base?: string | null
    valor_actual?: string | null
    responsable?: string | null
    estado?: string
  },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!payload.objetivo?.trim()) return { success: false, error: "El objetivo es obligatorio" }
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const fila = {
      norma_codigo: payload.norma_codigo,
      objetivo: payload.objetivo.trim(),
      meta: payload.meta ?? null,
      indicador: payload.indicador ?? null,
      unidad: payload.unidad ?? null,
      linea_base: payload.linea_base ?? null,
      valor_actual: payload.valor_actual ?? null,
      responsable: payload.responsable ?? null,
      estado: payload.estado ?? "en_curso",
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_objetivos").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_objetivos")
      .insert({ ...fila, idempresa: empresaId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarObjetivo(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_objetivos").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/** Elimina (desactiva) un aspecto ambiental. */
export async function eliminarAspectoAmbiental(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_aspectos_ambientales").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Control de cambios documentales (sig_documento_versiones, ISO 7.5.3)
// ---------------------------------------------------------------------------

/** Lista la bitácora de versiones de un documento (más reciente primero). */
export async function getVersionesDocumento(
  documentoId: string,
): Promise<{ success: boolean; data: SigDocVersion[]; error?: string }> {
  try {
    if (!documentoId) return { success: false, data: [], error: "documentoId requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("sig_documento_versiones")
      .select("*")
      .eq("documento_id", documentoId)
      .order("created_at", { ascending: false })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigDocVersion[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/** Registra un cambio/versión de un documento en la bitácora. */
export async function registrarCambioDocumento(
  payload: {
    documentoId: string
    documentoCodigo?: string | null
    version: string
    versionAnterior?: string | null
    tipo: SigTipoCambio
    motivo?: string | null
    descripcionCambio?: string | null
    responsable?: string | null
  },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!payload.documentoId) return { success: false, error: "documentoId requerido" }
    if (!payload.version?.trim()) return { success: false, error: "La versión es obligatoria" }
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("sig_documento_versiones")
      .insert({
        idempresa: empresaId,
        documento_id: payload.documentoId,
        documento_codigo: payload.documentoCodigo ?? null,
        version: payload.version.trim(),
        version_anterior: payload.versionAnterior ?? null,
        tipo: payload.tipo,
        motivo: payload.motivo ?? null,
        descripcion_cambio: payload.descripcionCambio ?? null,
        responsable: payload.responsable ?? null,
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Referencia SG-SST 0312 -> ISO 45001
// ---------------------------------------------------------------------------

/**
 * Avance GLOBAL del SG-SST (Res. 0312) de la empresa, reutilizando la matriz
 * de 60 estandares. Sirve como REFERENCIA del estado de ISO 45001 en el SIG
 * (no se mapea numeral-a-numeral porque el 0312 no sigue el Anexo SL).
 * % = suma de pesos cumplidos / 100 (cumple y no_aplica suman; no_cumple = 0).
 */
export async function getAvance0312(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; pct: number; error?: string }> {
  try {
    const data = await getMatrizEstandares(empresaIdFromClient)
    // Cálculo compartido (Art. 27) — misma fuente que la Matriz de 60 y la Auditoría.
    const { pct } = computar0312(data.items, data.respuestas)
    return { success: true, pct: Math.round(pct * 10) / 10 }
  } catch (err: any) {
    return { success: false, pct: 0, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// EVALUACIÓN DE DESEMPEÑO POR ÁREA (despliegue del BSC a nivel LIP).
// Cada indicador pesa dentro de su área (Σ = 100). La nota del área = Σ(cumplimiento ×
// peso) → evalúa a la cabeza de área. Es el despliegue ISO 9001 6.2.1 de los objetivos.
// La BSC gerencial/ eficacia del SIG siguen siendo GLOBALES (LIP 100), no por proyecto.
// ---------------------------------------------------------------------------
export interface IndicadorEval {
  codigo: string
  nombre: string
  perspectiva: string | null
  meta: number | null
  sentido: string | null
  valor: number | null
  base: string | null
  peso: number
  cumplimiento: number | null // 0-100 (topado en 100); null = informativo (sin meta/valor)
  aporte: number // cumplimiento × peso / 100 (puntos que aporta a la nota del área)
}
export interface AreaEval {
  area: string
  responsable: string | null
  nota: number // 0-100, ponderada por los pesos de los indicadores con meta
  pesoTotal: number
  indicadores: IndicadorEval[]
}

// Cumplimiento 0-100 de un indicador según su meta y sentido (topado en 100%).
function cumplimientoIndicador(valor: number | null, meta: number | null, sentido: string | null): number | null {
  if (valor == null || meta == null) return null
  const v = Number(valor), m = Number(meta)
  if (Number.isNaN(v) || Number.isNaN(m)) return null
  if (sentido === "menor_mejor") {
    if (m === 0) return v <= 0 ? 100 : 0 // meta cero (ej. 0 accidentes): se cumple solo en 0
    return v <= m ? 100 : Math.max(0, (m / v) * 100)
  }
  // mayor_mejor (default)
  if (m === 0) return 100
  return Math.min(100, (v / m) * 100)
}

export async function getEvaluacionAreas(): Promise<{ success: boolean; areas: AreaEval[]; global: number; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    // Catálogo ÚNICO de LIP (100). La evaluación es GLOBAL, no por proyecto.
    const baseSel = "codigo,nombre,area,responsable,meta,sentido,calculo_auto,valor_manual,perspectiva,orden"
    const q = (sel: string) =>
      supabase.from("sig_indicadores").select(sel).eq("idempresa", 100).eq("activo", true)
        .order("area", { ascending: true }).order("orden", { ascending: true })
    // Se intenta leer la columna `peso`; si aún no existe (falta correr el SQL), se cae a
    // pesos iguales calculados en memoria (el módulo funciona igual).
    let res = await q(baseSel + ",peso")
    if (res.error && /peso/i.test(res.error.message || "")) res = await q(baseSel)
    if (res.error) return { success: false, areas: [], global: 0, error: res.error.message }
    const inds: any[] = res.data ?? []

    // Valores REALES en vivo (misma fuente que la BSC), a nivel LIP GLOBAL: null =
    // agrega los clientes/sitios SIG (1-4). OJO: NO usar 100 (es el id del catálogo SIG,
    // sin datos operativos; la operación vive en idempresa 1-4).
    const vres = await getIndicadoresValores(null)
    const valores: Record<string, any> = vres.success ? vres.valores : {}

    const porArea = new Map<string, AreaEval>()
    for (const it of inds ?? []) {
      const area = it.area || "(sin área)"
      const liveVal = it.calculo_auto ? valores[it.calculo_auto]?.valor ?? null : null
      const valor = liveVal != null ? Number(liveVal) : it.valor_manual != null ? Number(it.valor_manual) : null
      const base = it.calculo_auto ? valores[it.calculo_auto]?.base ?? null : null
      const peso = Number(it.peso) || 0
      const cumplimiento = cumplimientoIndicador(valor, it.meta, it.sentido)
      const aporte = cumplimiento != null ? (cumplimiento * peso) / 100 : 0
      const ind: IndicadorEval = {
        codigo: it.codigo, nombre: it.nombre, perspectiva: it.perspectiva, meta: it.meta, sentido: it.sentido,
        valor, base, peso, cumplimiento, aporte,
      }
      if (!porArea.has(area)) porArea.set(area, { area, responsable: it.responsable ?? null, nota: 0, pesoTotal: 0, indicadores: [] })
      const a = porArea.get(area)!
      a.indicadores.push(ind)
      if (!a.responsable && it.responsable) a.responsable = it.responsable
    }

    // Nota por área = Σ(cumplimiento × peso) / Σ(peso de indicadores medibles).
    const areas: AreaEval[] = []
    for (const a of porArea.values()) {
      const conMeta = a.indicadores.filter((i) => i.cumplimiento != null)
      // FALLBACK: si el área aún no tiene pesos configurados (suman 0 o falta el SQL),
      // se reparte 100% en partes iguales entre los indicadores medibles (en memoria).
      if (conMeta.length > 0 && conMeta.reduce((s, i) => s + i.peso, 0) <= 0) {
        const w = Math.round((100 / conMeta.length) * 100) / 100
        conMeta.forEach((i) => { i.peso = w })
      }
      const medibles = a.indicadores.filter((i) => i.cumplimiento != null && i.peso > 0)
      const pesoTotal = medibles.reduce((s, i) => s + i.peso, 0)
      medibles.forEach((i) => { i.aporte = ((i.cumplimiento as number) * i.peso) / 100 })
      const nota = pesoTotal > 0 ? medibles.reduce((s, i) => s + (i.cumplimiento as number) * i.peso, 0) / pesoTotal : 0
      a.pesoTotal = Math.round(pesoTotal * 100) / 100
      a.nota = Math.round(nota * 10) / 10
      areas.push(a)
    }
    areas.sort((x, y) => x.area.localeCompare(y.area))
    // Global LIP = promedio de las notas de las áreas con indicadores medibles.
    const conNota = areas.filter((a) => a.pesoTotal > 0)
    const global = conNota.length ? Math.round((conNota.reduce((s, a) => s + a.nota, 0) / conNota.length) * 10) / 10 : 0
    return { success: true, areas, global }
  } catch (err: any) {
    return { success: false, areas: [], global: 0, error: err?.message || "Error desconocido" }
  }
}

// Guarda los pesos de los indicadores de un área. Valida que sumen ~100 (tolerancia 0.5).
export async function guardarPesosArea(
  area: string,
  pesos: { codigo: string; peso: number }[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const suma = pesos.reduce((s, p) => s + (Number(p.peso) || 0), 0)
    if (Math.abs(suma - 100) > 0.5) return { success: false, error: `Los pesos del área deben sumar 100% (actual: ${Math.round(suma * 10) / 10}%).` }
    const supabase: any = await getSupabaseAdmin()
    for (const p of pesos) {
      const { error } = await supabase
        .from("sig_indicadores")
        .update({ peso: Number(p.peso) || 0 })
        .eq("idempresa", 100)
        .eq("codigo", p.codigo)
      if (error) return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// EVALUACIÓN DE COORDINADORES POR PROYECTO. La Gerencia de Operaciones responde por el
// resultado GLOBAL; cada COORDINADOR por su proyecto (ID de empresa). Se toman los
// indicadores medibles del área Operaciones y se calculan POR PROYECTO con los valores
// en vivo de ese idempresa (getIndicadoresValores(id)). Misma ponderación, distinto
// alcance → nota por coordinador. Es el drill-down operativo del despliegue en cascada.
export interface CoordinadorEval {
  idempresa: number
  proyecto: string
  coordinador: string
  nota: number
  pesoTotal: number
  indicadores: IndicadorEval[]
}
export async function getEvaluacionCoordinadores(): Promise<{ success: boolean; coordinadores: CoordinadorEval[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const baseSel = "codigo,nombre,meta,sentido,calculo_auto,perspectiva,orden"
    const q = (sel: string) =>
      supabase.from("sig_indicadores").select(sel).eq("idempresa", 100).eq("activo", true).eq("area", AREA_OPERACIONES).order("orden")
    let res = await q(baseSel + ",peso")
    if (res.error && /peso/i.test(res.error.message || "")) res = await q(baseSel)
    if (res.error) return { success: false, coordinadores: [], error: res.error.message }
    // Solo indicadores medibles (con meta) y automáticos (calculables por proyecto).
    const inds: any[] = (res.data ?? []).filter((i: any) => i.meta != null && i.calculo_auto)
    // Si aún no hay pesos, reparto igual entre los medibles.
    if (inds.length && inds.reduce((s, i) => s + (Number(i.peso) || 0), 0) <= 0) {
      const w = Math.round((100 / inds.length) * 100) / 100
      inds.forEach((i) => (i.peso = w))
    }

    const coordinadores: CoordinadorEval[] = []
    for (const c of COORDINADORES_PROYECTO) {
      const vres = await getIndicadoresValores(c.idempresa)
      const vals: Record<string, any> = vres.success ? vres.valores : {}
      const indicadores: IndicadorEval[] = inds.map((it) => {
        const liveVal = vals[it.calculo_auto]?.valor ?? null
        const valor = liveVal != null ? Number(liveVal) : null
        const peso = Number(it.peso) || 0
        // META POR SITIO: el "tiempo de cargue" se relaja en los CEDIs (+15%/+35%),
        // según el acuerdo (los CEDIs replican el SLA de las plantas con más tiempo).
        const meta =
          it.calculo_auto === "lip_tiempo_cargue" && it.meta != null
            ? Math.round(Number(it.meta) * factorTiempoSitio(c.idempresa))
            : it.meta
        const cumplimiento = cumplimientoIndicador(valor, meta, it.sentido)
        return {
          codigo: it.codigo, nombre: it.nombre, perspectiva: it.perspectiva, meta, sentido: it.sentido,
          valor, base: vals[it.calculo_auto]?.base ?? null, peso, cumplimiento,
          aporte: cumplimiento != null ? (cumplimiento * peso) / 100 : 0,
        }
      })
      const medibles = indicadores.filter((i) => i.cumplimiento != null && i.peso > 0)
      const pesoTotal = medibles.reduce((s, i) => s + i.peso, 0)
      const nota = pesoTotal > 0 ? medibles.reduce((s, i) => s + (i.cumplimiento as number) * i.peso, 0) / pesoTotal : 0
      coordinadores.push({
        idempresa: c.idempresa, proyecto: c.proyecto, coordinador: c.coordinador,
        nota: Math.round(nota * 10) / 10, pesoTotal: Math.round(pesoTotal * 100) / 100, indicadores,
      })
    }
    return { success: true, coordinadores }
  } catch (err: any) {
    return { success: false, coordinadores: [], error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Mapa de Procesos (sig_procesos)
// ---------------------------------------------------------------------------

export async function getProcesos(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigProceso[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const { data, error } = await supabase
      .from("sig_procesos")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("orden", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigProceso[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Catálogo de no conformes potenciales por proceso (sig_nc_catalogo, 6.1)
// ---------------------------------------------------------------------------

export async function getNcCatalogo(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigNcCatalogo[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const { data, error } = await supabase
      .from("sig_nc_catalogo")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("proceso_codigo", { ascending: true })
      .order("orden", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigNcCatalogo[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function upsertNcCatalogo(
  payload: {
    id?: number
    proceso_codigo: string
    etapa?: string | null
    descripcion: string
    tipo?: string | null
    afecta_cliente?: boolean | null
    requisito_iso?: string | null
    deteccion?: string | null
    accion?: string | null
    orden?: number | null
  },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!payload.proceso_codigo) return { success: false, error: "El proceso es obligatorio" }
    if (!payload.descripcion?.trim()) return { success: false, error: "La descripción es obligatoria" }
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const fila = {
      proceso_codigo: payload.proceso_codigo,
      etapa: payload.etapa ?? null,
      descripcion: payload.descripcion.trim(),
      tipo: payload.tipo ?? "interno",
      afecta_cliente: payload.afecta_cliente ?? false,
      requisito_iso: payload.requisito_iso ?? null,
      deteccion: payload.deteccion ?? null,
      accion: payload.accion ?? null,
      orden: payload.orden ?? 99,
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_nc_catalogo").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_nc_catalogo")
      .insert({ ...fila, idempresa: empresaId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarNcCatalogo(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_nc_catalogo").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Registro de no conformidades (sig_no_conformidades, ISO 9001 10.2 / 8.7)
// ---------------------------------------------------------------------------

export async function getNoConformidades(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigNoConformidad[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const { data, error } = await supabase
      .from("sig_no_conformidades")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("fecha", { ascending: false })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigNoConformidad[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function upsertNoConformidad(
  payload: {
    id?: number
    codigo?: string | null
    proceso_codigo?: string | null
    proyecto_id?: number | null
    catalogo_id?: number | null
    fecha?: string | null
    origen?: string | null
    descripcion: string
    tipo?: string | null
    afecta_cliente?: boolean | null
    requisito_incumplido?: string | null
    correccion?: string | null
    causa_raiz?: string | null
    accion_correctiva?: string | null
    responsable?: string | null
    fecha_compromiso?: string | null
    fecha_cierre?: string | null
    estado?: string | null
    eficacia?: string | null
  },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!payload.descripcion?.trim()) return { success: false, error: "La descripción es obligatoria" }
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const fila: any = {
      codigo: payload.codigo ?? null,
      proceso_codigo: payload.proceso_codigo ?? null,
      proyecto_id: payload.proyecto_id ?? null,
      catalogo_id: payload.catalogo_id ?? null,
      fecha: payload.fecha ?? null,
      origen: payload.origen ?? "proceso",
      descripcion: payload.descripcion.trim(),
      tipo: payload.tipo ?? "interno",
      afecta_cliente: payload.afecta_cliente ?? false,
      requisito_incumplido: payload.requisito_incumplido ?? null,
      correccion: payload.correccion ?? null,
      causa_raiz: payload.causa_raiz ?? null,
      accion_correctiva: payload.accion_correctiva ?? null,
      responsable: payload.responsable ?? null,
      fecha_compromiso: payload.fecha_compromiso ?? null,
      fecha_cierre: payload.fecha_cierre ?? null,
      estado: payload.estado ?? "abierta",
      eficacia: payload.eficacia ?? "pendiente",
      updated_at: new Date().toISOString(),
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_no_conformidades").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_no_conformidades")
      .insert({ ...fila, idempresa: empresaId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarNoConformidad(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_no_conformidades").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Indicadores de gestión (sig_indicadores, ISO 9001 9.1) + cálculo en vivo
// ---------------------------------------------------------------------------

export async function getIndicadores(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigIndicador[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const { data, error } = await supabase
      .from("sig_indicadores")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("orden", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigIndicador[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function upsertIndicador(
  payload: {
    id?: number
    codigo: string
    proceso_codigo?: string | null
    nombre: string
    tipo?: string | null
    parte_interesada?: string | null
    formula?: string | null
    fuente?: string | null
    calculo_auto?: string | null
    unidad?: string | null
    meta?: number | null
    sentido?: string | null
    frecuencia?: string | null
    responsable?: string | null
    valor_manual?: number | null
    orden?: number | null
    perspectiva?: string | null
    area?: string | null
    finalidad?: string | null
    cliente_interno?: string | null
    cliente_externo?: string | null
    contribucion?: string | null
    objetivo_id?: number | null
  },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!payload.codigo?.trim()) return { success: false, error: "El código es obligatorio" }
    if (!payload.nombre?.trim()) return { success: false, error: "El nombre es obligatorio" }
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const fila: any = {
      codigo: payload.codigo.trim(),
      proceso_codigo: payload.proceso_codigo ?? null,
      nombre: payload.nombre.trim(),
      tipo: payload.tipo ?? "resultado",
      parte_interesada: payload.parte_interesada ?? null,
      formula: payload.formula ?? null,
      fuente: payload.fuente ?? "manual",
      calculo_auto: payload.calculo_auto ?? null,
      unidad: payload.unidad ?? null,
      meta: payload.meta ?? null,
      sentido: payload.sentido ?? null,
      frecuencia: payload.frecuencia ?? null,
      responsable: payload.responsable ?? null,
      valor_manual: payload.valor_manual ?? null,
      orden: payload.orden ?? 99,
      perspectiva: payload.perspectiva ?? null,
      area: payload.area ?? null,
      finalidad: payload.finalidad ?? null,
      cliente_interno: payload.cliente_interno ?? null,
      cliente_externo: payload.cliente_externo ?? null,
      contribucion: payload.contribucion ?? null,
      objetivo_id: payload.objetivo_id ?? null,
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_indicadores").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_indicadores")
      .insert({ ...fila, idempresa: empresaId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarIndicador(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_indicadores").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Calcula EN VIVO los indicadores automáticos desde datos reales de LIPgo,
 * filtrando por cliente/sitio (proyectoId; null = todos los clientes) y un
 * rango de fechas opcional. Devuelve un mapa clave (calculo_auto) -> valor.
 * Es lo que hace que el tablero 9.1 muestre "resultados por sitio".
 */
// Cache en memoria del BSC: el cálculo es pesado (~30 indicadores en vivo, ~10s).
// Se cachea por empresa+fechas para que ni la portada ni las tiras de KPIs del
// encabezado (presentes en CADA submódulo) lo recalculen en cada navegación.
const _ivCache = new Map<string, { value: any; exp: number }>()
// Llamadas en vuelo por clave: dedupe para que varios montajes simultáneos NO
// disparen varios cálculos pesados en paralelo (comparten la misma promesa).
type IvRes = { success: boolean; valores: Record<string, SigIndicadorValor>; error?: string }
const _ivInflight = new Map<string, Promise<IvRes>>()
const IV_TTL_MS = 10 * 60 * 1000 // 10 minutos

// Caché PERSISTENTE (tabla sig_indicadores_cache, scripts/199): la de memoria
// vive solo en la instancia que la calculó, y en Vercel las instancias arrancan
// frías con frecuencia, así que el usuario pagaba el cálculo (~49 consultas,
// ~13 s) al abrir casi cualquier submódulo. Con la tabla, cualquier instancia
// sirve el último valor al instante; si venció, lo sirve igual y refresca en bg.
const IV_TABLA = "sig_indicadores_cache"

async function _ivLeerPersistente(clave: string): Promise<{ value: IvRes; computedAt: number } | null> {
  try {
    const sb = await getSupabaseAdminAsSystem()
    const { data } = await sb.from(IV_TABLA).select("valores, computed_at").eq("clave", clave).maybeSingle()
    if (!data?.valores) return null
    return { value: { success: true, valores: data.valores }, computedAt: new Date(data.computed_at).getTime() }
  } catch {
    return null
  }
}

async function _ivGuardarPersistente(clave: string, r: IvRes): Promise<void> {
  try {
    const sb = await getSupabaseAdminAsSystem()
    await sb.from(IV_TABLA).upsert({ clave, valores: r.valores, computed_at: new Date().toISOString() }, { onConflict: "clave" })
  } catch {
    // best-effort: si la tabla no existe aún, la caché en memoria sigue funcionando
  }
}

// Fachada con caché + dedupe + stale-while-revalidate: la PRIMERA vez por
// (proyecto, periodo) se calcula en frío (única espera de ~10s); las siguientes
// son INSTANTÁNEAS, y si el valor venció se sirve el último bueno y se refresca en
// segundo plano SIN esperar. Así el encabezado de KPIs nunca bloquea la navegación.
export async function getIndicadoresValores(
  proyectoId?: number | null,
  desde?: string | null,
  hasta?: string | null,
): Promise<IvRes> {
  const _ivKey = `${proyectoId ?? "all"}|${desde ?? ""}|${hasta ?? ""}`
  const _ivHit = _ivCache.get(_ivKey)
  if (_ivHit && _ivHit.exp > Date.now()) return _ivHit.value // fresco → instantáneo
  const refrescar = (): Promise<IvRes> => {
    const enVuelo = _ivInflight.get(_ivKey)
    if (enVuelo) return enVuelo
    const p = _computeIndicadoresValores(proyectoId, desde, hasta)
      .then((r) => {
        if (r.success) {
          _ivCache.set(_ivKey, { value: r, exp: Date.now() + IV_TTL_MS })
          void _ivGuardarPersistente(_ivKey, r)
        }
        return r
      })
      .catch((err: any): IvRes => ({ success: false, valores: {}, error: err?.message || "Error" }))
      .finally(() => _ivInflight.delete(_ivKey))
    _ivInflight.set(_ivKey, p)
    return p
  }
  // Vencido pero con valor previo → servir stale al instante y refrescar en bg.
  if (_ivHit) {
    void refrescar()
    return _ivHit.value
  }
  // Frío en ESTA instancia: antes de calcular, mirar la caché persistente
  // compartida entre instancias. Fresca → instantáneo; vencida → se sirve y
  // se refresca en segundo plano (mismo criterio que la de memoria).
  const persistido = await _ivLeerPersistente(_ivKey)
  if (persistido) {
    const expira = persistido.computedAt + IV_TTL_MS
    _ivCache.set(_ivKey, { value: persistido.value, exp: expira })
    if (expira <= Date.now()) void refrescar()
    return persistido.value
  }
  // Frío en todas partes (nunca calculado para este alcance) → única espera.
  return refrescar()
}

async function _computeIndicadoresValores(
  proyectoId?: number | null,
  desde?: string | null,
  hasta?: string | null,
): Promise<IvRes> {
  try {
    const supabase: any = await getSupabaseAdmin()
    // IDs de cliente sobre los que se calcula (solo clientes ACTIVOS del SIG).
    const clientes: number[] = proyectoId ? [proyectoId] : SIG_CLIENTES_LIP

    const contar = async (tabla: string, build: (q: any) => any): Promise<number> => {
      let q = supabase.from(tabla).select("*", { count: "exact", head: true }).in("idempresa", clientes)
      q = build(q)
      const { count, error } = await q
      if (error) return 0
      return count || 0
    }

    // --- Cargue/Descargue (cabeceraoc) ---
    const filtroFechaOrden = (q: any) => {
      if (desde) q = q.gte("fechaorden", desde)
      if (hasta) q = q.lte("fechaorden", hasta)
      return q
    }
    const totOrdenes = await contar("cabeceraoc", filtroFechaOrden)
    // El desempeño de LIP se mide por SU tramo: `fincargue` (cargue finalizado
    // por LIP). No se usa status='finalizado' como medida de LIP porque ese
    // estado lo activa el pesaje final del cliente (paso de la operación del
    // cliente dentro de LIPgo, valor agregado, fuera del alcance del servicio).
    const finalizadasLIP = await contar("cabeceraoc", (q: any) => filtroFechaOrden(q).not("fincargue", "is", null))
    // Ciclo completo registrado en LIPgo (valor agregado: trazabilidad para el cliente).
    const cicloCerrado = await contar("cabeceraoc", (q: any) => filtroFechaOrden(q).ilike("status", "finalizado"))
    // Evidencia fotográfica del cargue (control/trazabilidad de LIP).
    const conEvidencia = await contar("cabeceraoc", (q: any) => filtroFechaOrden(q).not("fotospicking", "is", null))

    // Lee TODAS las filas paginando (Supabase topa en 1000), degradando a [] ante error
    // (mismo criterio que el bloque de registroasistencia de más abajo) para no tumbar el
    // cálculo del BSC. cabeceraoc supera 1000 órdenes históricas por proyecto, así que sin
    // paginar estos indicadores (toneladas, tiempo de cargue, SLA) y las citas se calculaban
    // sobre un subconjunto viejo -> se calificaba a jefes de área con datos truncados.
    const pagAll = async (make: (from: number, to: number) => any): Promise<any[]> => {
      const acc: any[] = []
      for (let f = 0; ; f += 1000) {
        const { data } = await make(f, f + 999)
        acc.push(...(data ?? []))
        if (!data || data.length < 1000) break
        if (f > 500000) break
      }
      return acc
    }

    // Toneladas (suma en memoria: pesovascula) + meta del periodo por sede.
    // "proyeccion" excluido (2026-09-08): residuo de un módulo manual
    // descontinuado en jul-2026, nunca fue tonelaje real (ver
    // scripts/053_pagonomina_reemplazo.sql). "Tolva"/"Tolva f" excluido
    // (2026-09-15): es PRODUCCIÓN (solo ID1), no Cargue/Descargue/
    // Distribución -- tiene su propio indicador OEE y su propia meta
    // (EMPRESA_META_DIA_TON ya excluye Tolva, ver lib/empresa-meta-dia.ts);
    // sin esto el % de cumplimiento de meta de tonelaje quedaba inflado.
    const tonRows = await pagAll((from, to) =>
      filtroFechaOrden(
        supabase
          .from("cabeceraoc")
          .select("pesovascula,idempresa,fechaorden,ordendecargue")
          .in("idempresa", clientes)
          .neq("tipooperacion", "proyeccion")
          .neq("tipooperacion", "Tolva")
          .neq("tipooperacion", "Tolva f"),
      )
        .order("id", { ascending: true })
        .range(from, to),
    )
    // Huevos / Empaque MP (por unidad, Avimol): su "peso" son unidades, no
    // toneladas -- fuera del indicador (lib/ordenes-por-unidad.ts, 2026-09-30).
    const porUnidadTon = await codigosOrdenPorUnidad(supabase, (tonRows ?? []).map((r: any) => r.ordendecargue))
    const toneladas = (tonRows ?? [])
      .filter((r: any) => !porUnidadTon.has(String(r.ordendecargue ?? "").trim()))
      .reduce((s: number, r: any) => s + (Number(r.pesovascula) || 0), 0)
    // Cumplimiento de meta de tonelaje = ton / (meta_día por sede × días operativos).
    const diasPorCliente: Record<number, Set<string>> = {}
    for (const r of tonRows ?? []) {
      const id = Number(r.idempresa)
      if (!diasPorCliente[id]) diasPorCliente[id] = new Set()
      if (r.fechaorden) diasPorCliente[id].add(String(r.fechaorden))
    }
    let metaPeriodo = 0
    for (const id of Object.keys(diasPorCliente)) metaPeriodo += getMetaDiaForEmpresa(Number(id)) * diasPorCliente[Number(id)].size
    const cumplimientoMetaTon = metaPeriodo > 0 ? Math.round((toneladas / metaPeriodo) * 1000) / 10 : 0

    // Tiempo de cargue LIP (iniciocargue -> fincargue), promedio en minutos.
    const durRows = await pagAll((from, to) =>
      filtroFechaOrden(
        supabase
          .from("cabeceraoc")
          .select("iniciocargue,fincargue")
          .in("idempresa", clientes)
          .not("iniciocargue", "is", null)
          .not("fincargue", "is", null),
      )
        .order("id", { ascending: true })
        .range(from, to),
    )
    const aMin = (s: string) => {
      const [h, m, sec] = String(s).split(":").map(Number)
      return h * 60 + m + (sec || 0) / 60
    }
    const durs = (durRows ?? [])
      .map((r: any) => aMin(r.fincargue) - aMin(r.iniciocargue))
      .filter((d: number) => d > 0 && d < 600)
    const tiempoCargue = durs.length ? Math.round(durs.reduce((s: number, d: number) => s + d, 0) / durs.length) : 0

    // --- Vehículos / conductores (citasvehiculos, fechallegada) ---
    const vehiculos = await contar("citasvehiculos", (q: any) => {
      if (desde) q = q.gte("fechallegada", desde)
      if (hasta) q = q.lte("fechallegada", hasta)
      return q
    })

    // --- Inventario (invtrans): exactitud y rechazos (sin filtro de fecha: creado suele venir nulo) ---
    const totInv = await contar("invtrans", (q: any) => q)
    const aprobInv = await contar("invtrans", (q: any) => q.ilike("status", "aprobado"))
    const rechInv = await contar("invtrans", (q: any) => q.ilike("status", "rechazado"))

    // --- Gestión humana (headcount): colaboradores activos ---
    const activos = await contar("headcount", (q: any) => q.ilike("estado", "activo"))

    // --- Satisfacción (sig_satisfaccion): promedio 1-5 → % ---
    const avgSat = async (tipo: string): Promise<{ v: number; n: number }> => {
      // Paginado: ya hay más de 1.000 calificaciones y Supabase corta ahí en
      // silencio (el promedio salía sobre las primeras 1.000).
      const data = await pagAll((from, to) =>
        supabase.from("sig_satisfaccion").select("calificacion").eq("activo", true).eq("tipo", tipo).in("proyecto_id", clientes).order("id").range(from, to),
      )
      const vals = (data ?? []).map((r: any) => Number(r.calificacion) || 0).filter((x: number) => x > 0)
      const avg = vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0
      return { v: Math.round((avg / 5) * 1000) / 10, n: vals.length }
    }
    // El conductor es la parte interesada que recibe el servicio directo de
    // LIP (cargue/descargue) -- para efectos de este indicador ES el cliente,
    // por eso "Satisfacción del cliente" toma la misma encuesta real del
    // conductor (kiosko). El tipo 'cliente' en sig_satisfaccion queda como
    // mecanismo aparte (proxy histórico por SLA, admin), no como fuente viva.
    const satCon = await avgSat("conductor")
    const satCli = satCon

    // --- SLA de tiempos de cargue (Acuerdos de Servicio) ---
    // % de despachos cuyo tiempo efectivo (fincargue−iniciocargue) está dentro
    // del tiempo acordado para su tipo de vehículo. Tipo de vehículo desde
    // citasvehiculos (ocargue = cabeceraoc.ordendecargue).
    const slaRows = await pagAll((from, to) =>
      filtroFechaOrden(
        supabase
          .from("cabeceraoc")
          .select("ordendecargue,iniciocargue,fincargue,idempresa")
          .in("idempresa", clientes)
          .not("iniciocargue", "is", null)
          .not("fincargue", "is", null),
      )
        .order("id", { ascending: true })
        .range(from, to),
    )
    // Mapa ocargue -> tipovehiculo. Orden por ocargue (estable para armar el mapa).
    const citas = await pagAll((from, to) =>
      supabase
        .from("citasvehiculos")
        .select("ocargue,tipovehiculo")
        .in("idempresa", clientes)
        .order("ocargue", { ascending: true })
        .range(from, to),
    )
    const tipoPorOc: Record<string, string> = {}
    for (const c of citas ?? []) if (c.ocargue) tipoPorOc[String(c.ocargue)] = c.tipovehiculo
    // Subproducto (mogolla/salvado/harina de tercera): sin esto, esas órdenes
    // se median contra el tiempo (más corto) de Producto Terminado — mismo
    // criterio que Centro de Coordinación (esNombreSubproducto por producto
    // de detalleoc). Se pagina en lotes de 500 por el `.in()` (slaRows puede
    // superar los 1000 registros históricos, ver lipgo-supabase-1000-rows).
    const ordenesSlaCodigos = Array.from(new Set((slaRows ?? []).map((r: any) => String(r.ordendecargue))))
    const esSubproductoPorOc = new Set<string>()
    // Lotes de 200 órdenes Y paginado: con 500 órdenes por lote el detalle
    // superaba las 1.000 líneas y Supabase cortaba ahí en silencio, así que
    // parte de los subproductos no se detectaban y su SLA se medía mal.
    for (let i = 0; i < ordenesSlaCodigos.length; i += 200) {
      const chunk = ordenesSlaCodigos.slice(i, i + 200)
      const detChunk = await pagAll((from, to) =>
        supabase.from("detalleoc").select("numeroorden, producto").in("numeroorden", chunk).order("id").range(from, to),
      )
      for (const d of detChunk ?? []) if (esNombreSubproducto(d.producto)) esSubproductoPorOc.add(String(d.numeroorden))
    }
    let slaOk = 0, slaTot = 0
    for (const r of slaRows ?? []) {
      const tv = tipoPorOc[String(r.ordendecargue)]
      // SLA de tiempo AJUSTADO POR SITIO (CEDIs +15%/+35% sobre el tiempo base).
      const producto = esSubproductoPorOc.has(String(r.ordendecargue)) ? "SUB" : "PT"
      const max = getSlaCargueMin(tv, producto, (r as any).idempresa)
      if (!max) continue
      const real = aMin(r.fincargue) - aMin(r.iniciocargue)
      if (real <= 0 || real > 600) continue
      slaTot++
      if (real <= max) slaOk++
    }
    const slaTiempos = slaTot > 0 ? Math.round((slaOk / slaTot) * 1000) / 10 : 0

    // --- Cobertura de personal vs planta acordada ---
    let plantaAcordada = 0
    for (const id of clientes) plantaAcordada += PLANTA_ACORDADA[id]?.total || 0
    const ghCobertura = plantaAcordada > 0 ? Math.round((activos / plantaAcordada) * 1000) / 10 : 0

    // --- Ausentismo (registroasistencia + headcount): control diario por proyecto ---
    // Ausentismo REAL = ausencias (incapacidad o licencia no remunerada,
    // misma regla de lib/ausentismo-categorias.ts) / días-persona ESPERADOS
    // según headcount (fechainicio/fecha_retiro cruzados con el período) --
    // no el conteo de filas que alcanzaron a tener en registroasistencia
    // ese período (alguien activo sin ninguna fila ese día no entraba antes
    // ni al numerador ni al denominador). En paralelo se conserva
    // "capacidad de respuesta" (programado vs real del control diario):
    // mide qué tanto el personal PROGRAMADO ese día realmente respondió --
    // un indicador operativo distinto del ausentismo real, no se elimina.
    // Administrativos (headcount.admin) y cuentas de prueba ("PRUEBA" en el
    // nombre) se excluyen de ambos -- no son de interés para medición.
    const asisRows: any[] = []
    let aFrom = 0
    while (true) {
      let qa = supabase
        .from("registroasistencia")
        .select("fecha,puesto,asistencia,nombre,identificacion")
        .in("idempresa", clientes)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("id")
        .range(aFrom, aFrom + 999)
      if (desde) qa = qa.gte("fecha", desde)
      if (hasta) qa = qa.lte("fecha", hasta)
      const { data } = await qa
      asisRows.push(...(data ?? []))
      if (!data || data.length < 1000) break
      aFrom += 1000
      if (aFrom > 120000) break
    }
    const { data: hcAusRows } = await supabase
      .from("headcount")
      .select("identificacion,nombre,admin,fechainicio,fecha_retiro,idempresa")
      .or(clientes.map((c) => `idempresa.eq.${c}`).concat("idempresa.is.null").join(","))
    const hcAusReales = (hcAusRows ?? []).filter((h: any) => !/prueba/i.test(String(h.nombre || "")))
    const identificacionesAdminGH = new Set(
      hcAusReales.filter((h: any) => h.admin === true).map((h: any) => String(h.identificacion || "").trim()),
    )
    const asisRowsReales = asisRows.filter(
      (r) => !/prueba/i.test(String(r.nombre || "")) && !identificacionesAdminGH.has(String(r.identificacion || "").trim()),
    )
    const turnosProgramados = asisRowsReales.filter((r) => r.puesto !== null || r.asistencia !== null).length
    // Turnos (filas) para "capacidad de respuesta"; días-persona distintos
    // para el ausentismo real (misma unidad que el denominador -- ver
    // diasAusenciaDistintos, evita que una persona con 2 filas el mismo día
    // -- ej. Auxiliar Mixto turno 1+2 -- cuente la ausencia dos veces).
    const turnosAusencia = asisRowsReales.filter((r) => !!categoriaDeNovedad(r.asistencia)).length
    const diasAusencia = diasAusenciaDistintos(asisRowsReales)
    const ghCapacidadRespuesta = turnosProgramados > 0 ? Math.round((turnosAusencia / turnosProgramados) * 1000) / 10 : 0
    // Período efectivo del denominador de días-persona: si no viene desde/hasta
    // (vista "todo el histórico"), se acota desde 2026 -- cuando arranca la
    // operación en LIPgo (headcount/registroasistencia no tienen datos antes).
    const desdeGH = desde || "2026-01-01"
    const hastaGH = hasta || new Date().toISOString().slice(0, 10)
    const personalDiasEsperados = hcAusReales
      .filter((h: any) => h.admin !== true && h.idempresa !== null && clientes.includes(Number(h.idempresa)))
      .reduce((s: number, h: any) => s + diasActivosEnPeriodo(h.fechainicio, h.fecha_retiro, desdeGH, hastaGH), 0)
    const ghAusentismo = personalDiasEsperados > 0 ? Math.round((diasAusencia / personalDiasEsperados) * 1000) / 10 : 0

    // --- Recobro de incapacidades (ausentismosst): % de recuperación ---
    // Recobrable = costos_eps (EG día 3+) + costos_arl (AT 100%); recuperado =
    // valor_recobrado (o el recobrable si el estado es RECOBRADO). El indicador
    // mide la eficiencia de la gestión de cobro ante EPS/ARL (recurso de la
    // empresa que se pierde si no se recobra a tiempo).
    let qRec = supabase
      .from("ausentismosst")
      .select("tipo_evento,total_dias_incapacidad,costos_eps,costos_arl,salario_base_dia,salario_base,estado_recobro,valor_recobrado,fecha_inicial")
      .in("idempresa", clientes)
    if (desde) qRec = qRec.gte("fecha_inicial", desde)
    if (hasta) qRec = qRec.lte("fecha_inicial", hasta)
    const { data: recRows } = await qRec
    let recobrableTot = 0
    let recuperadoTot = 0
    for (const a of recRows ?? []) {
      const dias = Number(a.total_dias_incapacidad) || 0
      const diaVal = Number(a.salario_base_dia) || (Number(a.salario_base) || 0) / 30
      const esAT = a.tipo_evento === "AT"
      const recobrable = esAT
        ? Number(a.costos_arl) || Math.round(dias * diaVal)
        : Number(a.costos_eps) || Math.round(Math.max(dias - 2, 0) * diaVal * 0.6667)
      if (recobrable <= 0) continue
      recobrableTot += recobrable
      recuperadoTot += Number(a.valor_recobrado) || (String(a.estado_recobro) === "RECOBRADO" ? recobrable : 0)
    }
    const ghRecobro = recobrableTot > 0 ? Math.round((recuperadoTot / recobrableTot) * 1000) / 10 : 0

    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)
    // Nivel de servicio global = promedio de los componentes de servicio medibles.
    const compGlobal = [pct(finalizadasLIP, totOrdenes), cumplimientoMetaTon, slaTiempos].filter((x) => x > 0)
    const slaGlobal = compGlobal.length ? Math.round((compGlobal.reduce((a, b) => a + b, 0) / compGlobal.length) * 10) / 10 : 0

    // Gestión de facturación (operaciones): % de operaciones ya gestionadas
    // (solicitud de factura hecha por el coordinador) vs total facturable. Las
    // pendientes (estadofactura null) son las que el coordinador aún no solicita.
    // Piso = MES ACTUAL (o `desde` si se filtró): el backlog de meses pasados se
    // considera cerrado y NO distorsiona el indicador ni el BSC de la empresa.
    const mesIniFact = (() => {
      const h = new Date()
      return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`
    })()
    const factDesde = desde || mesIniFact
    const filtroFact = (q: any) => {
      q = q.gte("fechaorden", factDesde)
      if (hasta) q = q.lte("fechaorden", hasta)
      q = q.not("tipooperacion", "ilike", "proyeccion").not("tipooperacion", "ilike", "tolva")
      // Ordenes marcadas "no facturar" (facturar=false) quedan fuera del universo:
      // nunca se les va a pedir factura, así que no deben contar ni como pendientes
      // ni como parte del total (dañarían el % hacia abajo para siempre).
      return excluirNoFacturable(q)
    }
    const factTot = await contar("cabeceraoc", filtroFact)
    const factPend = await contar("cabeceraoc", (q: any) => filtroFact(q).is("estadofactura", null))
    const lipFacturacion = pct(factTot - factPend, factTot)

    // --- SG-SST 0312: % EN VIVO (Res. 0312 Art. 27), MISMA fuente que la Matriz de 60
    // Estándares y la Auditoría 0312. Antes leía el `puntaje_total` denormalizado de
    // sst_autoevaluaciones, que quedaba desactualizado frente a las respuestas (BSC 86
    // vs matriz 91.5). Ahora los tres muestran el mismo número. ---
    const av0312 = await getAvance0312(100)
    const sgsst0312 = av0312.success ? av0312.pct : 0

    // --- NC cerradas a tiempo (SIG · LIP): cerradas dentro de compromiso / total ---
    let ncCerradas = 100
    try {
      const { data: nc } = await supabase
        .from("sig_no_conformidades")
        .select("estado,fecha_cierre,fecha_compromiso,activo")
      const act = (nc ?? []).filter((n: any) => n.activo !== false)
      if (act.length) {
        const okc = act.filter((n: any) => {
          const cerrada = n.estado && String(n.estado).toLowerCase().includes("cerr")
          if (!cerrada || !n.fecha_cierre) return false
          return !n.fecha_compromiso || String(n.fecha_cierre) <= String(n.fecha_compromiso)
        }).length
        ncCerradas = Math.round((okc / act.length) * 100)
      }
    } catch {}

    // --- Formación: capacitaciones ejecutadas / total (por proyecto/periodo) ---
    let ghFormacion = 0
    try {
      let qCap = supabase.from("capacitaciones").select("ejecutada,fecha,idempresa").in("idempresa", clientes)
      if (desde) qCap = qCap.gte("fecha", desde)
      if (hasta) qCap = qCap.lte("fecha", hasta)
      const { data: caps } = await qCap
      const tot = (caps ?? []).length
      const ej = (caps ?? []).filter((c: any) => c.ejecutada === true).length
      ghFormacion = tot > 0 ? Math.round((ej / tot) * 100) : 0
    } catch {}

    // --- Implementación del SIG (avance real de la matriz integrada, alcance LIP) ---
    let sigImplementacion = 0
    try {
      const [{ data: rnI }, { data: covI }] = await Promise.all([
        supabase.from("sig_requisito_norma").select("requisito_id,norma_id,aplica"),
        supabase.from("sig_documento_cobertura").select("requisito_id,norma_id,estado,soporte_id").eq("idempresa", SIG_EMPRESA_LIP),
      ])
      const covMap = new Map<string, any[]>()
      for (const c of covI ?? []) {
        const k = `${c.requisito_id}:${c.norma_id}`
        if (!covMap.has(k)) covMap.set(k, [])
        covMap.get(k)!.push(c)
      }
      let totalReq = 0
      let avance = 0
      for (const r of rnI ?? []) {
        if (!r.aplica) continue
        totalReq++
        const cs = covMap.get(`${r.requisito_id}:${r.norma_id}`) ?? []
        const aprob = cs.some((c: any) => c.estado === "aprobado")
        const carg = cs.some((c: any) => c.estado === "cargado" || c.soporte_id)
        avance += aprob ? 1 : carg ? 0.5 : 0
      }
      sigImplementacion = totalReq > 0 ? Math.round((avance / totalReq) * 100) : 0
    } catch {}

    // --- SST: accidentalidad (# AT, de las investigaciones formales) ---
    let sstAtCount = 0
    try {
      let qAt = supabase.from("sst_incidentes").select("fecha_evento,idempresa").in("idempresa", clientes)
      if (desde) qAt = qAt.gte("fecha_evento", desde)
      if (hasta) qAt = qAt.lte("fecha_evento", hasta)
      const { data: ats } = await qAt
      sstAtCount = (ats ?? []).length
    } catch {}

    // --- SST: días perdidos por AT (severidad). Los días viven en ausentismosst
    // (registro SST-MAT-06), donde el AT trae total_dias_incapacidad y costos_arl. ---
    let sstAtDias = 0
    try {
      let qAus = supabase
        .from("ausentismosst")
        .select("tipo_evento,total_dias_incapacidad,costos_arl,fecha_inicial,idempresa")
        .in("idempresa", clientes)
      if (desde) qAus = qAus.gte("fecha_inicial", desde)
      if (hasta) qAus = qAus.lte("fecha_inicial", hasta)
      const { data: aus } = await qAus
      sstAtDias = (aus ?? [])
        .filter((r: any) => String(r.tipo_evento || "").toUpperCase().includes("AT") || Number(r.costos_arl) > 0)
        .reduce((s: number, r: any) => s + (Number(r.total_dias_incapacidad) || 0), 0)
    } catch {}

    // --- Cumplimiento legal (matriz de requisitos legales del SIG, alcance LIP) ---
    let legalCumpl = 0
    try {
      const { data: leg } = await supabase.from("sig_requisitos_legales").select("cumple")
      const aplican = (leg ?? []).filter((l: any) => l.cumple !== "no_aplica")
      if (aplican.length) {
        const s = aplican.reduce(
          (acc: number, l: any) => acc + (l.cumple === "cumple" ? 1 : l.cumple === "parcial" ? 0.5 : 0),
          0,
        )
        legalCumpl = Math.round((s / aplican.length) * 100)
      }
    } catch {}

    // --- IPEVR: % promedio de cumplimiento de intervención de peligros (por sitio) ---
    let sstIpevr = 0
    try {
      const { data: ip } = await supabase.from("sst_ipevr").select("gc_pct_cumplimiento,idempresa").in("idempresa", clientes)
      const vals = (ip ?? []).map((r: any) => Number(r.gc_pct_cumplimiento)).filter((n: number) => !Number.isNaN(n))
      sstIpevr = vals.length ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : 0
    } catch {}

    // --- LIPgo: digitalización/trazabilidad de la operación (invtrans + órdenes) ---
    let lipgoRegistros = totOrdenes
    try {
      const { count: invC } = await supabase.from("invtrans").select("*", { count: "exact", head: true }).in("idempresa", clientes)
      lipgoRegistros = (invC || 0) + totOrdenes
    } catch {}

    // --- ERI: exactitud del inventario físico (Almacén) — AUTOMÁTICO por el CRUCE MENSUAL ---
    // No es un conteo manual: sale de conciliar el libro (ingresos por aprobación de
    // producción + descargue/devolución; salidas SOLO por órdenes de cargue + reproceso)
    // contra el stock vivo (saldoinvdetalle = verdad física). El faltante de kardex frente
    // al físico es la inexactitud → ERI = 1 − |faltante| / físico. Cuadra 100% si no hay
    // diferencias sin explicar. Reutiliza getConciliacionMensualInventario (una por sitio).
    let invEri = 100
    let eriBase = "sin lotes para conciliar"
    try {
      let exactosTot = 0
      let evaluadosTot = 0
      let lotesRevisarTot = 0
      for (const cli of clientes) {
        const r = await getConciliacionMensualInventario(cli, null)
        if (r.success && r.data?.resumen) {
          exactosTot += Number(r.data.resumen.lotesExactos) || 0
          evaluadosTot += Number(r.data.resumen.lotesEvaluados) || 0
          lotesRevisarTot += Number(r.data.resumen.lotesRevisar) || 0
        }
      }
      if (evaluadosTot > 0) {
        // ERI consolidado = Σ lotes exactos / Σ lotes evaluados (no promedio de sitios).
        invEri = Math.round((exactosTot / evaluadosTot) * 1000) / 10
        const desc = evaluadosTot - exactosTot
        eriBase = desc > 0
          ? `${exactosTot}/${evaluadosTot} lotes exactos · ${desc} con diferencia (${lotesRevisarTot} a revisar)`
          : `${exactosTot}/${evaluadosTot} lotes exactos`
      }
    } catch {}

    // Indicadores de MEDICIÓN del SG-SST (0312, numerales 3.3.1-3.3.6) + extras,
    // desde sst_indicadores (LIP=100). Se toma el consolidado del año más reciente
    // (periodo sin guion = anual, p. ej. "2025"/"2026").
    const sstIndVal: Record<string, number | null> = {}
    const sstIndBase: Record<string, string> = {}
    try {
      const { data: si } = await supabase
        .from("sst_indicadores")
        .select("tipo, valor, periodo")
        .eq("idempresa", 100)
        .not("periodo", "like", "%-%")
        .order("periodo", { ascending: false })
      const vistos = new Set<string>()
      for (const r of si ?? []) {
        if (vistos.has(r.tipo)) continue
        vistos.add(r.tipo)
        sstIndVal[r.tipo] = r.valor
        sstIndBase[r.tipo] = `consolidado ${r.periodo}`
      }
    } catch {}
    const sstI = (tipo: string): SigIndicadorValor => ({
      valor: sstIndVal[tipo] ?? 0,
      base: sstIndBase[tipo] ?? "sin datos",
    })

    const valores: Record<string, SigIndicadorValor> = {
      // Cumplimiento SG-SST (Resolución 0312) — avance real de los 60 estándares.
      sgsst_0312: { valor: Math.round(sgsst0312 * 10) / 10, base: "Autoevaluación 0312 (Art. 27)" },
      // Indicadores de medición 0312 (numerales 3.3.1-3.3.6) + extras (sst_indicadores).
      sst_severidad: sstI("severidad_at"),
      sst_frecuencia: sstI("frecuencia_at"),
      sst_mortalidad: sstI("mortalidad_at"),
      sst_prevalencia: sstI("prevalencia_el"),
      sst_incidencia: sstI("incidencia_el"),
      sst_ausentismo_med: sstI("ausentismo"),
      sst_investigaciones: sstI("investigaciones"),
      sst_rotacion: sstI("rotacion_personal"),
      // Desempeño de LIP = cargues finalizados por LIP (fincargue).
      desp_cumplimiento: { valor: pct(finalizadasLIP, totOrdenes), base: `${finalizadasLIP}/${totOrdenes}` },
      // Valor agregado: ciclo completo registrado en LIPgo (trazabilidad para el cliente).
      desp_ciclo_cerrado: { valor: pct(cicloCerrado, totOrdenes), base: `${cicloCerrado}/${totOrdenes}` },
      lip_evidencia: { valor: pct(conEvidencia, totOrdenes), base: `${conEvidencia}/${totOrdenes}` },
      lip_tiempo_cargue: { valor: tiempoCargue, base: `${durs.length} órdenes` },
      desp_ordenes: { valor: totOrdenes, base: "" },
      desp_toneladas: { valor: Math.round(toneladas * 10) / 10, base: "" },
      desp_meta_ton: { valor: cumplimientoMetaTon, base: `${Math.round(toneladas)}/${Math.round(metaPeriodo)} ton` },
      sla_tiempos: { valor: slaTiempos, base: `${slaOk}/${slaTot} dentro de SLA` },
      gh_cobertura: { valor: ghCobertura, base: plantaAcordada > 0 ? `${activos}/${plantaAcordada} planta` : "planta no definida" },
      gh_ausentismo: { valor: ghAusentismo, base: personalDiasEsperados > 0 ? `${diasAusencia}/${personalDiasEsperados} días-persona` : "sin headcount en el período" },
      gh_capacidad_respuesta: { valor: ghCapacidadRespuesta, base: turnosProgramados > 0 ? `${turnosAusencia}/${turnosProgramados} turnos` : "sin registros" },
      gh_recobro: { valor: ghRecobro, base: recobrableTot > 0 ? `$${recuperadoTot.toLocaleString("es-CO")} de $${recobrableTot.toLocaleString("es-CO")}` : "sin recobros" },
      sla_global: { valor: slaGlobal, base: "promedio de servicio" },
      lip_facturacion: { valor: lipFacturacion, base: `${factTot - factPend}/${factTot} gestionadas` },
      vehiculos_atendidos: { valor: vehiculos, base: "" },
      inv_exactitud: { valor: pct(aprobInv, totInv), base: `${aprobInv}/${totInv}` },
      inv_rechazos: { valor: rechInv, base: "" },
      // ERI físico del almacén — automático por el cruce mensual (libro vs stock vivo).
      inv_eri: { valor: invEri, base: eriBase },
      gh_activos: { valor: activos, base: "" },
      sat_cliente: { valor: satCli.v, base: `${satCli.n} encuestas` },
      sat_conductor: { valor: satCon.v, base: `${satCon.n} encuestas` },
      // --- Nuevos cableados por área (BSC) ---
      nc_cerradas: { valor: ncCerradas, base: "NC cerradas dentro del compromiso" },
      gh_formacion: { valor: ghFormacion, base: "capacitaciones ejecutadas" },
      sig_implementacion: { valor: sigImplementacion, base: "avance de la matriz integrada" },
      sst_at_count: { valor: sstAtCount, base: "accidentes de trabajo (periodo)" },
      sst_at_dias: { valor: sstAtDias, base: "días perdidos por AT" },
      sst_ipevr_cumpl: { valor: sstIpevr, base: "cumplimiento de controles IPEVR" },
      lipgo_registros: { valor: lipgoRegistros, base: "operaciones digitalizadas en LIPgo" },
      legal_cumplimiento: { valor: legalCumpl, base: "requisitos legales cumplidos" },
    }
    return { success: true, valores }
  } catch (err: any) {
    return { success: false, valores: {}, error: err?.message || "Error desconocido" }
  }
}

// Clientes/sitios ACTIVOS del SIG (para selectores). Excluye prueba/inactivos.
export async function getClientesLIP(): Promise<{ id: number; nombre: string }[]> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("empresas")
      .select("id,nombre")
      .in("id", SIG_CLIENTES_LIP)
      .order("nombre", { ascending: true })
    if (error) return []
    return (data ?? []) as { id: number; nombre: string }[]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Saldo REAL de un producto — fuente ÚNICA reutilizada por getKardexInventario,
// getPanelInventarioLIP y getMovimientosProducto, para que las 3 pantallas de
// inventario SIEMPRE muestren el mismo número para el mismo producto (pedido
// explícito del usuario: "saldo detalle, saldo por producto e inventario
// global deben estar alineados"). Es saldo inicial (o el último cierre físico
// real congelado en `sig_inventario_cierre_mes.fisico_snapshot`) + ingresos −
// salidas, tal cual quedaron registrados en invtrans — NUNCA se fuerza a
// coincidir con `saldoinvdetalle` (ese es un número aparte, mantenido por su
// cuenta); si el cálculo puro no cuadra con él, esa diferencia es información
// real que hay que investigar, no ocultar. `stockVivoFallback` solo se usa
// para el back-solve del arranque cuando el producto no tiene ningún cierre
// físico real (ninguna ancla) — único caso sin otra verdad de referencia.
// ---------------------------------------------------------------------------
interface FilaInvtransParaSaldo {
  tipomov: string
  cantidad: any
  status: any
  creado: any
  cod_movimiento: any
}

function calcularSaldoReal<T extends FilaInvtransParaSaldo>(
  filasProducto: T[],
  anclasProducto: Array<{ mes: string; valor: number }>,
  stockVivoFallback: number,
): { porFila: Map<T, { antes: number; despues: number }>; saldoFinal: number } {
  const aprobado = (r: T) => String(r.status || "").toLowerCase().startsWith("aprob")
  const mesDeFila = (r: T) => (r.creado ? fechaColombiaDe(r.creado).slice(0, 7) : null)
  const cronologico = [...filasProducto].sort((a, b) => String(a.creado || "").localeCompare(String(b.creado || "")))
  const anclasOrdenadas = [...anclasProducto].sort((a, b) => a.mes.localeCompare(b.mes))
  // Mismo criterio EXACTO que ya usa `getOrCrearActaCruce` para calcular este
  // mismo `fisico_snapshot`: una Entrada fechada el mismo día del corte
  // (primer día del mes que abre la ancla) es "algo que ya existía al corte"
  // — el archivo real la cuenta como parte de la apertura, NO como
  // movimiento nuevo. Si el recorrido la vuelve a sumar aparte, queda
  // contada DOBLE contra la ancla (esto explica huecos grandes en el saldo
  // corrido — verificado con datos reales: PT000037 tenía un hueco de 1006,
  // exacto al tamaño de un ingreso del día del corte).
  const corteDeAncla = new Set(
    anclasOrdenadas.map((a) => {
      const [y, m] = a.mes.split("-").map(Number)
      const d = new Date(y, m, 1) // día 1 del mes SIGUIENTE al de la ancla
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    }),
  )
  const yaContadaEnAncla = (r: T) => r.tipomov === "Entrada" && r.creado && corteDeAncla.has(fechaColombiaDe(r.creado))
  // Para cada ancla, el índice de la ÚLTIMA fila con mes DENTRO O ANTES del
  // mes anclado. OJO con el significado de `mes` en esta tabla:
  // `sig_inventario_cierre_mes.mes` etiqueta el mes que se está CERRANDO
  // (verificado con datos reales: mes="2026-07" trae el físico de fin de
  // julio = apertura de agosto) — es lo OPUESTO a `sig_inventario_acta_cruce`
  // (esa etiqueta el mes que se está ABRIENDO). Por eso aquí el corte es
  // "<=" (incluye las filas del propio mes cerrado) y no "<".
  const idxDeAncla: number[] = anclasOrdenadas.map((a) => {
    let idx = -1
    for (let i = 0; i < cronologico.length; i++) {
      const m = mesDeFila(cronologico[i])
      if (m && m <= a.mes) idx = i
    }
    return idx
  })
  const netoCero = (r: T) => esCodigoTrasladoNetoCero(r.cod_movimiento)
  const sumaDeltas = cronologico.reduce((s, r) => {
    if (!aprobado(r) || yaContadaEnAncla(r) || netoCero(r)) return s
    const c = Math.abs(Number(r.cantidad) || 0)
    return s + (r.tipomov === "Entrada" ? c : -c)
  }, 0)
  let saldoAcumulado = 0
  for (let k = 0; k < anclasOrdenadas.length; k++) if (idxDeAncla[k] === -1) saldoAcumulado = stockVivoFallback - sumaDeltas
  if (!anclasOrdenadas.length) saldoAcumulado = stockVivoFallback - sumaDeltas

  const porFila = new Map<T, { antes: number; despues: number }>()
  for (let i = 0; i < cronologico.length; i++) {
    const r = cronologico[i]
    const antes = saldoAcumulado
    if (aprobado(r) && !yaContadaEnAncla(r) && !netoCero(r)) {
      const c = Math.abs(Number(r.cantidad) || 0)
      saldoAcumulado += r.tipomov === "Entrada" ? c : -c
    }
    for (let k = 0; k < anclasOrdenadas.length; k++) if (idxDeAncla[k] === i) saldoAcumulado = anclasOrdenadas[k].valor
    porFila.set(r, { antes: Math.round(antes), despues: Math.round(saldoAcumulado) })
  }
  const saldoFinal = cronologico.length > 0 ? porFila.get(cronologico[cronologico.length - 1])!.despues : Math.round(saldoAcumulado)
  return { porFila, saldoFinal }
}

// ---------------------------------------------------------------------------
// Panel LIP · Inventario — Exactitud y merma (ISO 9001 8.5.1). Cuadre
// entradas/salidas + eventos de pérdida (lo que se cobra a LIP), por año y mes,
// por cliente/sitio. Fuente: invtrans + reprocesos (todo en LIPgo).
// ---------------------------------------------------------------------------
export async function getPanelInventarioLIP(
  proyectoId?: number | null,
  anio?: string | null,
  mes?: string | null,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = proyectoId ? [proyectoId] : SIG_CLIENTES_LIP

    // AÑOS DISPONIBLES — consulta aparte, LIVIANA (2 filas: la más vieja y la
    // más nueva), independiente del rango acotado de abajo. Antes salía de
    // recorrer TODO `inv` ya cargado — con el acote por año/mes de más abajo,
    // `inv` ya no trae otros años para poder armar la lista. No asume que
    // cada año tenga movimiento (falla hacia mostrar el rango completo, no
    // hacia ocultar años).
    let aniosDisponibles: string[] = []
    try {
      // `.not("creado", "is", null)` + `nullsFirst` explícito en los dos: en
      // Postgres los NULL van PRIMERO en orden DESCENDENTE por defecto — sin
      // esto, si existe una sola fila con `creado` vacío, la consulta "más
      // reciente" la agarra a ELLA en vez de la fecha real más nueva
      // (encontrado al verificar: devolvía `null` en vez de la fecha de hoy).
      const [{ data: masVieja }, { data: masNueva }] = await Promise.all([
        supabase.from("invtrans").select("creado").in("idempresa", clientes).not("creado", "is", null).order("creado", { ascending: true, nullsFirst: false }).limit(1),
        supabase.from("invtrans").select("creado").in("idempresa", clientes).not("creado", "is", null).order("creado", { ascending: false, nullsFirst: false }).limit(1),
      ])
      const anioMin = masVieja?.[0]?.creado ? Number(fechaColombiaDe(masVieja[0].creado).slice(0, 4)) : null
      const anioMax = masNueva?.[0]?.creado ? Number(fechaColombiaDe(masNueva[0].creado).slice(0, 4)) : null
      if (anioMin && anioMax) {
        for (let y = anioMax; y >= anioMin; y--) aniosDisponibles.push(String(y))
      }
    } catch { /* sin datos todavía, o error puntual — el fallback de abajo (años vistos en `inv`) sigue cubriendo */ }

    // Traer movimientos (paginado; solo columnas necesarias). ACOTADO por
    // año/mes cuando vienen dados (el caso normal ahora — el componente ya
    // no arranca en "todo el año"): antes traía SIEMPRE el histórico
    // COMPLETO de invtrans de hasta 4 proyectos (hasta 60.000 filas / 60
    // idas y vueltas) y descartaba en el navegador lo que no era del
    // periodo elegido — eso es lo que hacía lento el panel, sobre todo
    // según crece el histórico. El acote usa un margen de 1 día a cada
    // lado (zona horaria: `creado` es UTC, Colombia es UTC-5) y el filtro
    // EXACTO por Colombia sigue siendo el mismo de siempre en JS más abajo
    // (`yr(r.creado)`/`mo(r.creado)`) — el acote solo reduce cuánto se trae,
    // no cambia qué cuenta como parte del periodo.
    let rangoDesde: string | null = null
    let rangoHasta: string | null = null
    if (anio) {
      const y = Number(anio)
      if (mes) {
        const m = Number(mes)
        const desde = new Date(Date.UTC(y, m - 1, 1))
        desde.setUTCDate(desde.getUTCDate() - 1)
        const hasta = new Date(Date.UTC(y, m, 1))
        hasta.setUTCDate(hasta.getUTCDate() + 1)
        rangoDesde = desde.toISOString()
        rangoHasta = hasta.toISOString()
      } else {
        rangoDesde = new Date(Date.UTC(y - 1, 11, 31)).toISOString()
        rangoHasta = new Date(Date.UTC(y + 1, 0, 2)).toISOString()
      }
    }
    const inv: any[] = []
    let fromIdx = 0
    while (true) {
      let q = supabase
        .from("invtrans")
        .select("idempresa,tipomov,origen,status,cantidad,creado,codproducto,nombreproducto,cod_movimiento")
        .in("idempresa", clientes)
      if (rangoDesde) q = q.gte("creado", rangoDesde)
      if (rangoHasta) q = q.lt("creado", rangoHasta)
      const { data, error } = await q
        .order("id", { ascending: true }) // paginación determinista: sin ORDER BY, .range() salta/duplica filas
        .range(fromIdx, fromIdx + 999)
      if (error) return { success: false, error: error.message }
      inv.push(...(data ?? []))
      if (!data || data.length < 1000) break
      fromIdx += 1000
      if (fromIdx > 60000) break // tope de seguridad
    }

    // Anclas físicas reales (fisico_snapshot) — se traen ANTES del segundo
    // fetch de invtrans porque el saldo real (más abajo) necesita saber desde
    // qué mes acotar sin perder ninguna ancla. Movido más arriba desde donde
    // estaba (justo antes de usarlo) por esta misma razón.
    const anclasPorEmpresaProductoGlobal: Record<number, Record<string, Array<{ mes: string; valor: number }>>> = {}
    let anclaMesMin: string | null = null
    try {
      const { data: cierresGlobal } = await supabase
        .from("sig_inventario_cierre_mes")
        .select("proyecto_id, mes, fisico_snapshot")
        .in("proyecto_id", clientes)
        .not("fisico_snapshot", "is", null)
      for (const c of cierresGlobal ?? []) {
        const porEmp = (anclasPorEmpresaProductoGlobal[c.proyecto_id] ||= {})
        for (const [cod, valor] of Object.entries(c.fisico_snapshot || {})) {
          if (valor === undefined || valor === null) continue
          ;(porEmp[cod] ||= []).push({ mes: c.mes, valor: Number(valor) })
        }
        if (!anclaMesMin || c.mes < anclaMesMin) anclaMesMin = c.mes
      }
    } catch { /* tabla aún no creada o sin cierres con físico */ }

    // Movimientos PARA EL CÁLCULO DE SALDO REAL — fetch APARTE de `inv`
    // (arriba, acotado al mes elegido por el usuario). `calcularSaldoReal`
    // necesita, para cada producto, ver los movimientos desde su última
    // ancla física real hasta HOY (no solo los del mes que se está viendo) —
    // igual que getKardexInventario/getMovimientosProducto, que por eso NUNCA
    // acotan por año/mes para este cálculo (ver su comentario). Si `inv` se
    // usara aquí (como quedó en el primer intento del fix de rendimiento),
    // el saldo se "resetea" a ciegas al valor crudo de `saldoinvdetalle`
    // cada vez que la ancla queda fuera de la ventana filtrada — verificado
    // con datos reales: hasta 5.405 unidades de diferencia en un proyecto.
    // Se acota SOLO por la ancla más antigua encontrada (no por `rangoDesde`
    // del filtro de pantalla) y SIN límite superior (hasta hoy) — sigue
    // siendo mucho menos que el histórico completo.
    const invParaSaldo: any[] = []
    {
      const saldoDesde = anclaMesMin ? new Date(Date.UTC(Number(anclaMesMin.slice(0, 4)), Number(anclaMesMin.slice(5, 7)) - 1, 1)).toISOString() : null
      let fIdx = 0
      while (true) {
        let q = supabase
          .from("invtrans")
          .select("idempresa,tipomov,status,cantidad,creado,codproducto,cod_movimiento")
          .in("idempresa", clientes)
        if (saldoDesde) q = q.gte("creado", saldoDesde)
        const { data, error } = await q.order("id", { ascending: true }).range(fIdx, fIdx + 999)
        if (error) return { success: false, error: error.message }
        invParaSaldo.push(...(data ?? []))
        if (!data || data.length < 1000) break
        fIdx += 1000
        if (fIdx > 60000) break
      }
    }

    // Reprocesos (daños en proceso).
    const { data: repro } = await supabase
      .from("reprocesos")
      .select("cantidad,creado")
      .in("idempresa", clientes)

    // Saldos físicos actuales (saldoinvdetalle) — solo respaldo del arranque
    // en `calcularSaldoReal` (productos sin ningún cierre físico real
    // todavía) y para contar SKUs con stock.
    const saldosRows: any[] = []
    let sFrom = 0
    while (true) {
      const { data } = await supabase.from("saldoinvdetalle").select("codproducto,stock_actual").in("idempresa", clientes).order("codproducto").order("lote").order("location").range(sFrom, sFrom + 999)
      saldosRows.push(...(data ?? []))
      if (!data || data.length < 1000) break
      sFrom += 1000
      if (sFrom > 60000) break
    }
    const stockVivoPorProducto: Record<string, number> = {}
    for (const r of saldosRows) stockVivoPorProducto[r.codproducto] = (stockVivoPorProducto[r.codproducto] || 0) + (Number(r.stock_actual) || 0)
    const skusConStock = new Set(saldosRows.filter((r) => (Number(r.stock_actual) || 0) > 0).map((r) => r.codproducto)).size

    // Saldo físico GLOBAL = suma del saldo REAL de cada producto
    // (`calcularSaldoReal`, la misma fuente que ya usan Kardex y el detalle
    // por producto) — no la suma cruda de `saldoinvdetalle` — para que el
    // total del Panel esté siempre alineado con esas dos pantallas (pedido
    // explícito del usuario). Usa `invParaSaldo` (desde la ancla más
    // antigua, sin acotar por el mes elegido en pantalla) — ver más arriba.
    const filasPorProductoGlobal: Record<string, any[]> = {}
    const idempresaPorProductoGlobal: Record<string, number> = {}
    for (const r of invParaSaldo) {
      const cod = r.codproducto || "(sin código)"
      ;(filasPorProductoGlobal[cod] ||= []).push(r)
      if (idempresaPorProductoGlobal[cod] === undefined) idempresaPorProductoGlobal[cod] = r.idempresa
    }
    let saldoFisico = 0
    for (const cod of Object.keys(filasPorProductoGlobal)) {
      const idemp = idempresaPorProductoGlobal[cod]
      const anclas = anclasPorEmpresaProductoGlobal[idemp]?.[cod] ?? []
      const { saldoFinal } = calcularSaldoReal(filasPorProductoGlobal[cod], anclas, stockVivoPorProducto[cod] || 0)
      saldoFisico += saldoFinal
    }

    const yr = (s: any) => (s ? fechaColombiaDe(s).slice(0, 4) : null)
    const mo = (s: any) => (s ? fechaColombiaDe(s).slice(5, 7) : null)
    const has = (v: any, t: string) => String(v || "").toLowerCase().includes(t)
    // Años disponibles — de la consulta liviana MIN/MAX de arriba
    // (`aniosDisponibles`), no de `inv` (que ahora viene acotado al
    // periodo elegido y ya no trae otros años). Fallback a los años vistos
    // en `inv` si esa consulta no encontró nada (proyecto nuevo sin
    // histórico, o algún error puntual).
    const aniosSetFallback = new Set<string>()
    for (const r of inv) if (yr(r.creado)) aniosSetFallback.add(yr(r.creado)!)
    const anios = aniosDisponibles.length ? aniosDisponibles : Array.from(aniosSetFallback).sort().reverse()
    const anioSel = anio || anios[0] || String(new Date().getFullYear())

    // ---- Clasificación por TIPO DE MOVIMIENTO (nomenclatura LIPgo) ----
    // Códigos de referencia (ver catálogo sig_tipos_movimiento):
    //   recepcion (101 producción/recepción/descargue), despacho (601 cargue),
    //   traslado_interno (311 ubicación↔ubicación), ajuste (701/702 diferencia de
    //   inventario físico), inicial (561 carga inicial),
    //   merma (551 reproceso = merma de proceso, NO se cobra a LIP).
    const tipoMov = (r: any): string => {
      // Prioriza el código real (309/311/312/344/343 = pareja neta 0) sobre
      // el heurístico de texto — antes esas correcciones (origen="transaccion
      // manual", no calza ningún patrón) caían en "ajuste" como si fueran un
      // ingreso/salida real, cuando no cambian el total del inventario.
      if (esCodigoTrasladoNetoCero(r.cod_movimiento)) return "traslado_interno"
      if (r.tipomov === "Reproceso" || has(r.origen, "reproceso")) return "merma"
      if (has(r.origen, "inicial")) return "inicial"
      if (has(r.origen, "traslado entre localizaciones")) return "traslado_interno"
      if (r.tipomov === "Entrada" && (has(r.origen, "producc") || has(r.origen, "aprob") || has(r.origen, "descarg") || has(r.origen, "logo"))) return "recepcion"
      if (r.tipomov === "Salida" && has(r.origen, "orden de cargue")) return "despacho"
      return "ajuste" // transacción manual / ajuste de inventario / bodega general
    }

    const totMov: Record<string, number> = { recepcion: 0, despacho: 0, traslado_interno: 0, ajuste: 0, inicial: 0, merma: 0 }
    const meses: Record<string, { recepcion: number; despacho: number }> = {}
    for (let i = 1; i <= 12; i++) meses[String(i).padStart(2, "0")] = { recepcion: 0, despacho: 0 }
    const salPorProd: Record<string, { producto: string; salidas: number }> = {} // para top movers / ABC
    const skusActivosSet = new Set<string>()
    for (const r of inv) {
      // Un ingreso SIN aprobar no es inventario todavía — no debe sumar en
      // ningún total de movimientos de esta pantalla (ver
      // getKardexInventario/getMovimientosProducto, mismo criterio).
      if (!String(r.status || "").toLowerCase().startsWith("aprob")) continue
      if (yr(r.creado) !== anioSel) continue
      const c = Number(r.cantidad) || 0
      const t = tipoMov(r)
      const m = mo(r.creado)
      if (m && meses[m]) {
        if (t === "recepcion") meses[m].recepcion += c
        else if (t === "despacho") meses[m].despacho += c
      }
      if (!mes || m === mes) {
        totMov[t] = (totMov[t] || 0) + c
        if (r.codproducto) skusActivosSet.add(r.codproducto)
        if (t === "despacho" && r.codproducto) {
          const cod = r.codproducto
          if (!salPorProd[cod]) salPorProd[cod] = { producto: r.nombreproducto || cod, salidas: 0 }
          salPorProd[cod].salidas += c
        }
      }
    }
    for (const r of repro ?? []) {
      if (yr(r.creado) !== anioSel) continue
      if (mes && mo(r.creado) !== mes) continue
      totMov.merma += Number(r.cantidad) || 0
    }
    const movimientosAnio = totMov.recepcion + totMov.despacho + totMov.traslado_interno + totMov.ajuste

    // ---- ANALÍTICA AVANZADA ----
    const prods = Object.entries(salPorProd).map(([cod, v]) => ({ cod, producto: v.producto, salidas: Math.round(v.salidas) })).sort((a, b) => b.salidas - a.salidas)
    const topMovers = prods.slice(0, 8)
    const totalSalidasProd = prods.reduce((s, p) => s + p.salidas, 0)
    // Clasificación ABC (Pareto sobre salidas): A≤80% acumulado, B≤95%, C resto.
    let acum = 0
    const abc = { A: 0, B: 0, C: 0 }
    for (const p of prods) {
      acum += p.salidas
      const pct = totalSalidasProd > 0 ? acum / totalSalidasProd : 1
      if (pct <= 0.8) abc.A++
      else if (pct <= 0.95) abc.B++
      else abc.C++
    }
    const periodoDias = mes ? 30 : 365
    const rotacion = saldoFisico > 0 ? Math.round((totMov.despacho / saldoFisico) * 100) / 100 : 0
    const diasInventario = totMov.despacho > 0 ? Math.round(saldoFisico / (totMov.despacho / periodoDias)) : 0
    const skusActivos = skusActivosSet.size
    const skusSinMovimiento = Math.max(0, skusConStock - skusActivos)

    // ---- ERI (Exactitud del Registro de Inventario): físico vs libro por conteo ----
    // Faltante (diferencia negativa, mov. 701/702) = lo ÚNICO que se cobra a LIP.
    // La merma de proceso (551 reproceso) NO se cobra. Resiliente si no existe la tabla.
    let faltante = 0, sobrante = 0, itemsContados = 0, itemsConDif = 0
    try {
      const { data: aj } = await supabase.from("sig_inventario_ajuste").select("cantidad,tipo").eq("activo", true).in("proyecto_id", clientes)
      for (const r of aj ?? []) {
        const c = Number(r.cantidad) || 0
        if (r.tipo === "faltante") faltante += Math.abs(c)
        else if (r.tipo === "sobrante") sobrante += Math.abs(c)
        else if (c < 0) faltante += Math.abs(c)
        else if (c > 0) sobrante += c
      }
      const { data: cuad } = await supabase.from("sig_inventario_cuadre").select("items,items_con_diferencia").eq("activo", true).in("proyecto_id", clientes)
      for (const r of cuad ?? []) { itemsContados += Number(r.items) || 0; itemsConDif += Number(r.items_con_diferencia) || 0 }
    } catch { /* tablas de cuadre aún no creadas */ }
    // ERI: 1) si hay conteos físicos reales, % de ítems sin diferencia (máxima fidelidad);
    //      2) si no, ERI AUTOMÁTICO del CRUCE MENSUAL (lotes exactos / evaluados) — misma
    //         verdad que la BSC (IND-AI-03), no un 100% inflado por tabla de cuadre vacía.
    let eri: number
    if (itemsContados > 0) {
      eri = Math.round((1 - itemsConDif / itemsContados) * 1000) / 10
    } else {
      let exCruce = 0, evCruce = 0
      try {
        for (const cli of clientes) {
          const rc = await getConciliacionMensualInventario(cli, null)
          if (rc.success && rc.data?.resumen) {
            exCruce += Number(rc.data.resumen.lotesExactos) || 0
            evCruce += Number(rc.data.resumen.lotesEvaluados) || 0
          }
        }
      } catch { /* si el cruce falla, se usa la inferencia por faltante */ }
      eri = evCruce > 0
        ? Math.round((exCruce / evCruce) * 1000) / 10
        : (saldoFisico > 0 ? Math.round((1 - faltante / saldoFisico) * 1000) / 10 : 100)
    }

    const NOMBRE_MES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    const porMes = Object.entries(meses)
      .filter(([, v]) => v.recepcion || v.despacho)
      .map(([k, v]) => ({ mes: NOMBRE_MES[Number(k)], recepcion: Math.round(v.recepcion), despacho: Math.round(v.despacho) }))

    const movimientos = [
      { tipo: "Recepción (101)", cant: Math.round(totMov.recepcion) },
      { tipo: "Despacho / cargue (601)", cant: Math.round(totMov.despacho) },
      { tipo: "Traslado interno (311)", cant: Math.round(totMov.traslado_interno) },
      { tipo: "Ajuste de inventario (701/702)", cant: Math.round(totMov.ajuste) },
      { tipo: "Inventario inicial (561)", cant: Math.round(totMov.inicial) },
      { tipo: "Merma / reproceso (551)", cant: Math.round(totMov.merma) },
    ]

    return {
      success: true,
      data: {
        anios,
        anio: anioSel,
        kpis: {
          eri,                                  // exactitud de registro (ERI)
          faltante: Math.round(faltante),       // mov. 701/702 negativo → se cobra a LIP
          sobrante: Math.round(sobrante),
          saldoFisico: Math.round(saldoFisico), // stock libro (perpetuo)
          movimientos: Math.round(movimientosAnio),
          itemsContados,
          mermaProceso: Math.round(totMov.merma), // 551: NO se cobra a LIP
          rotacion,                              // veces (despacho / stock)
          diasInventario,                        // días de cobertura
          skusActivos,
          skusConStock,
          skusSinMovimiento,
        },
        movimientos,
        topMovers,
        abc,
        porMes,
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// Cuadre diario: saldo inicial del día + ingresos − salidas = saldo final (running).
export async function getCuadreDiario(
  proyectoId?: number | null,
  anio?: string | null,
  mes?: string | null,
): Promise<{ success: boolean; data: any[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = proyectoId ? [proyectoId] : SIG_CLIENTES_LIP
    const has = (v: any, t: string) => String(v || "").toLowerCase().includes(t)
    const inv: any[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase.from("invtrans").select("tipomov,origen,cantidad,creado,cod_movimiento,status").in("idempresa", clientes).order("id", { ascending: true }).range(from, from + 999)
      if (error) return { success: false, data: [], error: error.message }
      inv.push(...(data ?? []))
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 60000) break
    }
    // Agrupar por día — DÍA CALENDARIO DE COLOMBIA (invtrans.creado está en
    // UTC, 5h adelante: un movimiento de las 8pm caía en el día siguiente y
    // el cuadre diario se veía "atrasado").
    const byDay: Record<string, { ingresos: number; salidas: number; otros: number }> = {}
    for (const r of inv) {
      // Un ingreso SIN aprobar no es inventario todavía — no debe mover el
      // cuadre diario (mismo criterio que Kardex/Panel).
      if (!String(r.status || "").toLowerCase().startsWith("aprob")) continue
      const d = r.creado ? fechaColombiaDe(r.creado) : ""
      if (!d) continue
      // 309/311/312/344/343 son pareja neta 0 igual que el traslado clásico
      // (texto "traslado entre localizaciones") — sin esto, una corrección de
      // lote/ubicación aparecía moviendo el saldo del día cuando no debía.
      if (esCodigoTrasladoNetoCero(r.cod_movimiento) || has(r.origen, "traslado entre localizaciones")) continue // interno: no afecta
      const c = Number(r.cantidad) || 0
      byDay[d] = byDay[d] || { ingresos: 0, salidas: 0, otros: 0 }
      if (r.tipomov === "Entrada" && (has(r.origen, "producc") || has(r.origen, "aprob") || has(r.origen, "descarg") || has(r.origen, "logo"))) byDay[d].ingresos += c
      else if (r.tipomov === "Salida" && has(r.origen, "orden de cargue")) byDay[d].salidas += c
      else if (r.tipomov === "Reproceso" || has(r.origen, "reproceso")) byDay[d].otros -= c
      else if (has(r.origen, "inicial")) byDay[d].otros += c
      else byDay[d].otros += r.tipomov === "Salida" ? -c : c // ajuste manual
    }
    // Running balance por fecha ascendente
    const dias = Object.keys(byDay).sort()
    let saldo = 0
    const todas = dias.map((d) => {
      const v = byDay[d]
      const inicial = saldo
      const net = v.ingresos - v.salidas + v.otros
      saldo = inicial + net
      return {
        fecha: d,
        saldoInicial: Math.round(inicial),
        ingresos: Math.round(v.ingresos),
        salidas: Math.round(v.salidas),
        otros: Math.round(v.otros),
        saldoFinal: Math.round(saldo),
      }
    })
    // Filtrar a año/mes para mostrar
    const filas = todas.filter((r) => (!anio || r.fecha.slice(0, 4) === anio) && (!mes || r.fecha.slice(5, 7) === mes)).reverse()
    return { success: true, data: filas }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

// Preservación / FIFO: antigüedad del stock y productos próximos a vencer (8.5.4).
export async function getPreservacionInventario(
  proyectoId?: number | null,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = proyectoId ? [proyectoId] : SIG_CLIENTES_LIP
    // Saldos con stock
    const saldos: any[] = []
    let sFrom = 0
    while (true) {
      const { data } = await supabase.from("saldoinvdetalle").select("codproducto,nombreproducto,lote,stock_actual").in("idempresa", clientes).order("codproducto").order("lote").order("location").range(sFrom, sFrom + 999)
      saldos.push(...(data ?? []))
      if (!data || data.length < 1000) break
      sFrom += 1000
      if (sFrom > 60000) break
    }
    // Vida útil por producto (productos.vidautildias)
    const vida: Record<string, number> = {}
    try {
      const { data: prods } = await supabase.from("productos").select("codigo,vidautildias")
      for (const p of prods ?? []) if (p.vidautildias) vida[p.codigo] = Number(p.vidautildias)
    } catch { /* sin tabla productos */ }

    const hoy = new Date()
    const parseLote = (l: any): Date | null => {
      const s = String(l || "")
      if (/^\d{8}$/.test(s)) { const d = new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))); return isNaN(d.getTime()) ? null : d }
      return null
    }
    let vencidos = 0, proximos = 0, ok = 0, sumDias = 0, nConDias = 0
    const filas = saldos
      .filter((r) => (Number(r.stock_actual) || 0) > 0)
      .map((r) => {
        const fp = parseLote(r.lote)
        const dias = fp ? Math.floor((hoy.getTime() - fp.getTime()) / 86400000) : null
        const vu = vida[r.codproducto] || 0
        let estado = "sin_vida"
        if (vu > 0 && dias != null) {
          if (dias >= vu) { estado = "vencido"; vencidos++ }
          else if (dias >= vu * 0.7) { estado = "proximo"; proximos++ }
          else { estado = "ok"; ok++ }
        }
        if (dias != null) { sumDias += dias; nConDias++ }
        return { codproducto: r.codproducto, producto: r.nombreproducto, lote: r.lote, stock: Math.round(Number(r.stock_actual) || 0), dias, vidautil: vu || null, estado }
      })
      .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))
    return {
      success: true,
      data: {
        filas,
        resumen: { vencidos, proximos, ok, total: filas.length, antiguedadProm: nConDias ? Math.round(sumDias / nConDias) : 0 },
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// Catálogo de tipos de movimiento (nomenclatura LIPgo).
export async function getTiposMovimiento(): Promise<{ success: boolean; data: SigTipoMovimiento[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase.from("sig_tipos_movimiento").select("*").eq("activo", true).order("orden", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigTipoMovimiento[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

// Drill-down del Kardex: movimientos de UN producto con sus soportes PDF
// (ingreso/aprobación = invtrans.pdf; orden de cargue = cabeceraoc.pdfoc/doccargue).
export async function getMovimientosProducto(
  codproducto: string,
  proyectoId?: number | null,
  anio?: string | null,
  mes?: string | null,
): Promise<{ success: boolean; data: any[]; saldoInicialPeriodo?: number; saldoFinalPeriodo?: number; error?: string }> {
  try {
    if (!codproducto) return { success: true, data: [] }
    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = proyectoId ? [proyectoId] : SIG_CLIENTES_LIP
    const has = (v: any, t: string) => String(v || "").toLowerCase().includes(t)
    // Fecha CALENDARIO en hora Colombia (invtrans.creado está en UTC, 5h
    // adelante) — un movimiento de las 8pm cae en el día/mes real de
    // Colombia, no en el que marca el timestamp UTC crudo.
    const yr = (s: any) => (s ? fechaColombiaDe(s).slice(0, 4) : null)
    const mo = (s: any) => (s ? fechaColombiaDe(s).slice(5, 7) : null)
    const { data: rows, error } = await supabase
      .from("invtrans")
      .select("idempresa,tipomov,origen,cantidad,creado,creadopor,ocargue,pdf,status,lote,location,cod_movimiento")
      .eq("codproducto", codproducto)
      .in("idempresa", clientes)
      .limit(5000)
    if (error) return { success: false, data: [], error: error.message }

    // 309/311/312/344/343 NUNCA afectan el saldo, sin excepción — es la
    // función misma del código (reclasificar/trasladar/bloquear), no un
    // ingreso ni una salida real. Aunque un 309 pueda cambiar de producto
    // (no solo lote/ubicación), un caso real (ID3, PT000080 recibiendo 212
    // "de" PT000021) resultó ser justo eso: una corrección de lotes hecha
    // por error, sin respaldo físico — el usuario confirmó que el físico
    // real de PT000080 es 3.868, no 4.079. Tratar el cruce de producto como
    // "ingreso real" habría escondido ese error dentro del cálculo en vez
    // de dejarlo visible para corregirlo donde corresponde: la transacción
    // puntual, no el reporte.
    const netoCeroProducto = (r: any) => esCodigoTrasladoNetoCero(r.cod_movimiento)

    // Saldo corrido — ÚNICO para todo el producto, en un solo hilo
    // cronológico (ya NO se fragmenta por lote/ubicación). Un lote o un
    // traslado entre ubicaciones ya no "corta" el saldo que va quedando —
    // se sigue viendo cuál lote/ubicación fue cada movimiento (columnas de
    // la tabla) y el soporte PDF de cada orden, pero el número que importa
    // (cuánto queda) es uno solo, de comienzo a fin.
    const { data: saldoRows } = await supabase
      .from("saldoinvdetalle")
      .select("stock_actual")
      .eq("codproducto", codproducto)
      .in("idempresa", clientes)
    const stockVivo = (saldoRows ?? []).reduce((s: number, r: any) => s + (Number(r.stock_actual) || 0), 0)

    // Ancla física real POR PRODUCTO: si el cierre mensual ya congeló la
    // apertura de un mes con archivo real (getOrCrearActaCruce /
    // guardarCierreMesInventario), ESE número es la verdad para todo el
    // producto — no la suma cruda del kardex (que puede arrastrar errores de
    // digitación). Solo aplica con un proyecto puntual seleccionado.
    let anclasProducto: Array<{ mes: string; valor: number }> = []
    if (proyectoId) {
      try {
        const { data: cierres } = await supabase
          .from("sig_inventario_cierre_mes")
          .select("mes, fisico_snapshot")
          .eq("proyecto_id", proyectoId)
          .not("fisico_snapshot", "is", null)
        anclasProducto = (cierres ?? [])
          .map((c: any) => ({ mes: c.mes, valor: c.fisico_snapshot?.[codproducto] }))
          .filter((a: any) => a.valor !== undefined && a.valor !== null)
          .map((a: any) => ({ mes: a.mes, valor: Number(a.valor) }))
          .sort((a: any, b: any) => String(a.mes).localeCompare(String(b.mes)))
      } catch { /* tabla aún no creada o sin cierres con físico */ }
    }
    const anclaPorMes = new Map(anclasProducto.map((a) => [a.mes, a.valor]))

    // Saldo REAL — mismo cálculo que usan getKardexInventario y
    // getPanelInventarioLIP (`calcularSaldoReal`), para que las 3 pantallas
    // muestren siempre el MISMO número por producto: saldo inicial (o el
    // último cierre físico real) + ingresos − salidas, tal cual quedaron
    // registrados — NUNCA forzado a coincidir con `saldoinvdetalle` (ese es
    // un número aparte). Forzarlo escondía diferencias reales: casos reales
    // encontrados así (ID3, PT HARINA PREC MAIZ 24LB: 9 unidades de
    // diferencia; PT FIDEO 250*24PQ: 212 por una reclasificación errónea) —
    // si el cálculo puro no cuadra con el stock vivo, esa diferencia es
    // información real que hay que investigar, no ocultar. `stockVivo` solo
    // se usa como respaldo del arranque cuando el producto no tiene ningún
    // cierre físico real (ninguna ancla).
    const { porFila: saldosPorFila } = calcularSaldoReal(rows ?? [], anclasProducto, stockVivo)
    const cronologico = [...(rows ?? [])].sort((a: any, b: any) => String(a.creado || "").localeCompare(String(b.creado || "")))

    // Un ingreso SIN aprobar (ej. el auto-descargue antes de que alguien lo
    // confirme con su ubicación/lote/cantidad real) no es inventario todavía
    // — ya tiene su propio lugar para gestionarse (Producción › Aprobación
    // de ingreso). No debe mezclarse con el Kardex/inventario confirmado:
    // se excluye del listado por completo (ya estaba excluido del saldo,
    // ahora tampoco aparece como fila).
    const aprobadoParaListado = (r: any) => String(r.status || "").toLowerCase().startsWith("aprob")
    const movs = (rows ?? []).filter(
      (r: any) => aprobadoParaListado(r) && (!anio || yr(r.creado) === anio) && (!mes || mo(r.creado) === mes),
    )

    // Resolver PDFs de las órdenes de cargue
    const ocargues = Array.from(new Set(movs.map((r: any) => r.ocargue).filter(Boolean)))
    const pdfPorOC: Record<string, { pdfoc: string | null; doccargue: string | null }> = {}
    if (ocargues.length > 0) {
      const { data: cab } = await supabase.from("cabeceraoc").select("ordendecargue,pdfoc,doccargue").in("ordendecargue", ocargues)
      for (const c of cab ?? []) pdfPorOC[c.ordendecargue] = { pdfoc: c.pdfoc, doccargue: c.doccargue }
    }
    // Prioriza el código REAL de la fila (cod_movimiento, verificado que
    // queda bien guardado por ejecutarTransaccionPorCodigo y por el trigger
    // de BD) sobre adivinar por texto de `origen` — el heurístico de abajo
    // solo sirve de respaldo si la fila no trae código (muy anterior a la
    // columna). Antes toda corrección 309/311/312/344/343 (que graba
    // origen="transaccion manual", sin match en el heurístico) se mostraba
    // como "Ajuste (701/702)" aunque nunca fue un ajuste real.
    const label = (r: any): string => {
      const porCodigo = nombreMovimientoPorCodigo(r.cod_movimiento)
      if (porCodigo) return porCodigo
      if (r.tipomov === "Reproceso" || has(r.origen, "reproceso")) return "Merma/Reproceso (551)"
      if (has(r.origen, "inicial")) return "Inventario inicial (561)"
      if (has(r.origen, "traslado entre localizaciones")) return "Traslado interno (311)"
      if (r.tipomov === "Entrada" && (has(r.origen, "producc") || has(r.origen, "aprob") || has(r.origen, "descarg") || has(r.origen, "logo"))) return "Recepción (101)"
      if (r.tipomov === "Salida" && has(r.origen, "orden de cargue")) return "Despacho (601)"
      return "Ajuste (701/702)"
    }
    const data = movs
      .map((r: any) => {
        const saldo = saldosPorFila.get(r)
        return {
          fecha: r.creado,
          tipo: label(r),
          codigo: r.cod_movimiento || null,
          // Traslado de ubicación / reclasificación DENTRO del mismo producto
          // (309/311/312/344/343): no es un ingreso ni una salida real (no
          // cambia el total, solo reubica) — el frontend usa esta bandera
          // para NO pintar la cantidad en las columnas de Ingreso/Salida.
          // Si el 309 reclasificó hacia OTRO producto, para ESTE producto sí
          // es un ingreso/salida real (mueve su saldo) y debe pintarse.
          netoCero: netoCeroProducto(r),
          tipomov: r.tipomov,
          cantidad: Number(r.cantidad) || 0,
          status: r.status,
          afectaSaldo: String(r.status || "").toLowerCase().startsWith("aprob"),
          saldoAntes: saldo?.antes ?? null,
          saldoDespues: saldo?.despues ?? null,
          usuario: r.creadopor || null, // quién realizó el movimiento (auditoría)
          lote: r.lote,
          location: r.location,
          ocargue: r.ocargue,
          pdf: r.pdf || null, // soporte de ingreso/aprobación si existe
          pdfoc: r.ocargue ? pdfPorOC[r.ocargue]?.pdfoc ?? null : null, // orden de cargue
          doccargue: r.ocargue ? pdfPorOC[r.ocargue]?.doccargue ?? null : null, // picking
        }
      })
      .sort((a: any, b: any) => String(b.fecha || "").localeCompare(String(a.fecha || "")))

    // Bordes del periodo visible (para el resumen "empecé con X, quedo con Y").
    // Se extraen del MISMO array cronológico (único, ascendente) usado para
    // calcular saldosPorFila — no de `data` (reordenada desc por fecha, donde
    // empates de fecha pueden quedar en otro orden y desalinear el borde).
    const cronologicoFiltrado = cronologico.filter((r: any) => (!anio || yr(r.creado) === anio) && (!mes || mo(r.creado) === mes))

    // Un borde solo se expone como número si está RESPALDADO por una verdad
    // física real — no basta con "hay un mes seleccionado" (eso fue el bug:
    // julio mostraba un "empezó con 1.985" back-solveado del kardex crudo,
    // sin ningún cierre físico detrás, solo porque había un mes elegido).
    // Verificado = el cierre/apertura de ESE mes coincide con un cierre
    // congelado real (`fisico_snapshot`), o el borde es HOY (stock vivo,
    // siempre verdad). Reutiliza `anclaPorMes` (ya calculado arriba para el
    // saldo corrido — mismo dato, un solo cálculo).
    const mesSeleccionado = anio && mes ? `${anio}-${String(mes).padStart(2, "0")}` : null
    let mesAnteriorKey: string | null = null
    if (mesSeleccionado) {
      const d = new Date(Number(anio), Number(mes) - 1, 1)
      d.setMonth(d.getMonth() - 1)
      mesAnteriorKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    }

    // Estos bordes son el AGREGADO del producto completo para el resumen
    // "empecé con X, quedo con Y" (mismo `anclaPorMes` de arriba — un solo
    // cálculo, ya no hay mapa por lote que reconciliar aparte). El borde de
    // HOY es el resultado PURO del cálculo (inicial/ancla + ingresos −
    // salidas), el mismo que ya se ve en la última fila de la tabla — no
    // `stockVivo` directo, que es un número aparte y puede diferir si hay
    // algo por reconciliar (ver nota en el cálculo del saldo corrido).
    const finalEsHoy = !mesSeleccionado || (cronologicoFiltrado.length > 0 && cronologico.length > 0 && cronologicoFiltrado[cronologicoFiltrado.length - 1] === cronologico[cronologico.length - 1])
    const finalVerificado = finalEsHoy || (mesSeleccionado ? anclaPorMes.has(mesSeleccionado) : false)
    const saldoCalculadoHoy = cronologico.length > 0 ? saldosPorFila.get(cronologico[cronologico.length - 1])?.despues : undefined
    const saldoFinalPeriodo = !finalVerificado
      ? undefined
      : finalEsHoy
        ? saldoCalculadoHoy
        : anclaPorMes.get(mesSeleccionado!)

    const inicialVerificado = !!(mesAnteriorKey && anclaPorMes.has(mesAnteriorKey))
    const saldoInicialPeriodo = inicialVerificado ? anclaPorMes.get(mesAnteriorKey!) : undefined

    return { success: true, data, saldoInicialPeriodo, saldoFinalPeriodo }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Kardex / Inventario Detalle: movimiento total de cada producto (ingreso→salida).
// Movimiento total por producto (ingreso → salida), agregado por código.
// ---------------------------------------------------------------------------
export async function getKardexInventario(
  proyectoId?: number | null,
  anio?: string | null,
  mes?: string | null,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = proyectoId ? [proyectoId] : SIG_CLIENTES_LIP
    const has = (v: any, t: string) => String(v || "").toLowerCase().includes(t)
    const yr = (s: any) => (s ? fechaColombiaDe(s).slice(0, 4) : null)
    const mo = (s: any) => (s ? fechaColombiaDe(s).slice(5, 7) : null)

    // Movimientos (paginado)
    const inv: any[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from("invtrans")
        .select("idempresa,codproducto,nombreproducto,tipomov,origen,cantidad,creado,cod_movimiento,status")
        .in("idempresa", clientes)
        .order("id", { ascending: true }) // paginación determinista
        .range(from, from + 999)
      if (error) return { success: false, error: error.message }
      inv.push(...(data ?? []))
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 60000) break
    }

    // Saldo actual por producto (saldoinvdetalle) — solo se usa como
    // respaldo del arranque en `calcularSaldoReal` (productos sin ningún
    // cierre físico real todavía), NUNCA como el "Saldo" mostrado.
    const saldos: Record<string, number> = {}
    let sFrom = 0
    while (true) {
      const { data } = await supabase.from("saldoinvdetalle").select("codproducto,stock_actual").in("idempresa", clientes).order("codproducto").order("lote").order("location").range(sFrom, sFrom + 999)
      for (const r of data ?? []) saldos[r.codproducto] = (saldos[r.codproducto] || 0) + (Number(r.stock_actual) || 0)
      if (!data || data.length < 1000) break
      sFrom += 1000
      if (sFrom > 60000) break
    }

    // Anclas físicas reales por (empresa, producto) — mismo mecanismo que
    // getMovimientosProducto, para que el "Saldo" de esta tabla sea EXACTO
    // al de esa pantalla de detalle.
    const anclasPorEmpresaProducto: Record<number, Record<string, Array<{ mes: string; valor: number }>>> = {}
    try {
      const { data: cierres } = await supabase
        .from("sig_inventario_cierre_mes")
        .select("proyecto_id, mes, fisico_snapshot")
        .in("proyecto_id", clientes)
        .not("fisico_snapshot", "is", null)
      for (const c of cierres ?? []) {
        const porEmp = (anclasPorEmpresaProducto[c.proyecto_id] ||= {})
        for (const [cod, valor] of Object.entries(c.fisico_snapshot || {})) {
          if (valor === undefined || valor === null) continue
          ;(porEmp[cod] ||= []).push({ mes: c.mes, valor: Number(valor) })
        }
      }
    } catch { /* tabla aún no creada o sin cierres con físico */ }

    // Filas completas por producto (SIN filtrar por año/mes — el saldo real
    // necesita la historia entera, igual que getMovimientosProducto; el
    // filtro de periodo solo aplica a los buckets de entradas/salidas/etc.
    // que se muestran para ESE mes).
    const filasPorProducto: Record<string, any[]> = {}
    const idempresaPorProducto: Record<string, number> = {}
    for (const r of inv) {
      const cod = r.codproducto || "(sin código)"
      ;(filasPorProducto[cod] ||= []).push(r)
      if (idempresaPorProducto[cod] === undefined) idempresaPorProducto[cod] = r.idempresa
    }

    const map: Record<string, any> = {}
    for (const r of inv) {
      // Un ingreso SIN aprobar (ej. el auto-descargue antes de que alguien lo
      // confirme con su ubicación/lote/cantidad real) no es inventario
      // todavía — no debe sumar en Entradas/Salidas/Ajustes/etc. de esta
      // tabla resumen (ya tiene su propio lugar: Producción › Aprobación de
      // ingreso).
      if (!String(r.status || "").toLowerCase().startsWith("aprob")) continue
      if (anio && yr(r.creado) !== anio) continue
      if (mes && mo(r.creado) !== mes) continue
      const cod = r.codproducto || "(sin código)"
      if (!map[cod]) map[cod] = { codproducto: cod, producto: r.nombreproducto || "", entradas: 0, salidas: 0, ajustes: 0, traslados: 0, merma: 0 }
      const c = Number(r.cantidad) || 0
      if (r.nombreproducto && !map[cod].producto) map[cod].producto = r.nombreproducto
      // Prioriza el código real (309/311/312/344/343 = pareja neta 0, NO es
      // un ajuste real) sobre el heurístico de texto — ver
      // esCodigoTrasladoNetoCero en lib/transacciones-codigo.ts. La función
      // de estos códigos es siempre "reclasificar/trasladar" (nunca
      // "ajuste", el catch-all de 701/702) — por eso van SIEMPRE a
      // "Traslados" en esta tabla resumen. El "Saldo" de esta tabla se
      // calcula aparte con `calcularSaldoReal` (más abajo) — la misma
      // función que usa getMovimientosProducto — para que ambas pantallas
      // muestren siempre el mismo número.
      if (esCodigoTrasladoNetoCero(r.cod_movimiento)) map[cod].traslados += c
      else if (r.tipomov === "Reproceso" || has(r.origen, "reproceso")) map[cod].merma += c
      else if (has(r.origen, "traslado entre localizaciones")) map[cod].traslados += c
      else if (r.tipomov === "Entrada" && (has(r.origen, "producc") || has(r.origen, "aprob") || has(r.origen, "descarg") || has(r.origen, "logo"))) map[cod].entradas += c
      else if (r.tipomov === "Salida" && has(r.origen, "orden de cargue")) map[cod].salidas += c
      else map[cod].ajustes += r.tipomov === "Salida" ? -c : c
    }
    // Saldo inicial del mes (por producto), SOLO cuando se pide un mes/año/
    // proyecto puntual (si no, "inicio de mes" no tiene un único significado).
    // Sale del físico congelado del mes ANTERIOR (`sig_inventario_cierre_mes`,
    // mismo mecanismo que Conciliación Mensual) — así el Kardex arranca el mes
    // con el mismo número que la conciliación, y de ahí en adelante los
    // movimientos siguen exactamente igual que siempre.
    let saldoInicialPorProducto: Record<string, number> | null = null
    if (proyectoId && anio && mes) {
      const d = new Date(Number(anio), Number(mes) - 1, 1)
      d.setMonth(d.getMonth() - 1)
      const mesAnteriorKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      try {
        const { data: cierreAnterior } = await supabase
          .from("sig_inventario_cierre_mes")
          .select("fisico_snapshot")
          .eq("proyecto_id", proyectoId)
          .eq("mes", mesAnteriorKey)
          .maybeSingle()
        if (cierreAnterior?.fisico_snapshot) saldoInicialPorProducto = cierreAnterior.fisico_snapshot
      } catch { /* tabla aún no creada o sin cierre ese mes */ }
    }

    const filas = Object.values(map)
      .map((p: any) => {
        const idemp = idempresaPorProducto[p.codproducto]
        const anclasProducto = anclasPorEmpresaProducto[idemp]?.[p.codproducto] ?? []
        const { saldoFinal } = calcularSaldoReal(filasPorProducto[p.codproducto] ?? [], anclasProducto, saldos[p.codproducto] || 0)
        return {
          ...p,
          entradas: Math.round(p.entradas),
          salidas: Math.round(p.salidas),
          ajustes: Math.round(p.ajustes),
          merma: Math.round(p.merma),
          saldo: saldoFinal,
          saldoInicial: saldoInicialPorProducto ? Math.round(saldoInicialPorProducto[p.codproducto] ?? 0) : null,
        }
      })
      .sort((a: any, b: any) => (a.producto || "").localeCompare(b.producto || ""))

    return { success: true, data: { filas } }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Cuadre / Conteo Físico de Inventario + Ajustes. Por cliente/sitio.
// Persiste lo que el módulo "Auditoría de Inventario" calcula en memoria.
// ---------------------------------------------------------------------------

export async function getCuadres(
  proyectoId: number,
): Promise<{ success: boolean; data: SigInventarioCuadre[]; error?: string }> {
  try {
    if (!proyectoId) return { success: true, data: [] }
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("sig_inventario_cuadre")
      .select("*")
      .eq("proyecto_id", proyectoId)
      .eq("activo", true)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigInventarioCuadre[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function getCuadreDetalle(
  cuadreId: number,
): Promise<{ success: boolean; data: SigInventarioCuadreDetalle[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("sig_inventario_cuadre_detalle")
      .select("*")
      .eq("cuadre_id", cuadreId)
      .order("producto", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigInventarioCuadreDetalle[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/** Crea un documento de conteo cargando el stock en sistema (saldoinvdetalle). */
export async function crearCuadre(
  proyectoId: number,
  payload: {
    fecha?: string
    tipo?: string
    almacen?: string | null
    responsable?: string | null
    creado_por?: string | null
    // Conteo cíclico de UN producto en vez de todo el inventario. A diferencia
    // del conteo total (que solo siembra stock != 0), aquí SÍ se incluyen las
    // ubicaciones en 0 — el usuario eligió a propósito verificar ese producto.
    codproductoUnico?: string | null
  },
): Promise<{ success: boolean; id?: number; items?: number; error?: string }> {
  try {
    if (!proyectoId) return { success: false, error: "Selecciona un cliente/sitio" }
    const supabase: any = await getSupabaseAdmin()

    // Conteo TOTAL (cierre de mes, sin producto único): el "sistema" contra
    // el que se cuenta debe ser el inventario CONGELADO del día anterior
    // (sin movimientos del día en curso mezclados) — no el stock vivo del
    // momento exacto en que se crea el conteo. Mismo mecanismo (y mismo
    // helper) que ya usa Acta de Cruce para su corte de apertura de mes.
    // El conteo CÍCLICO (verificación puntual de un producto) sigue usando
    // stock vivo — es otro caso de uso, confirmado explícitamente por el
    // usuario (2026-09-01): "entiendo tu lógica para el cíclico que es otra
    // cosa y es con el inventario en vivo".
    const esConteoTotalCompleto = (payload.tipo ?? "total") === "total" && !payload.codproductoUnico
    let lineasBase: Array<{ codproducto: string; nombreproducto: string | null; lote: string | null; location: string | null; stock_actual: number }>
    if (esConteoTotalCompleto) {
      const corte = payload.fecha || fechaColombiaDe(new Date().toISOString())
      const { porLote } = await calcularStockAlCorte(supabase, proyectoId, corte)
      lineasBase = Object.values(porLote)
        .filter((r) => r.valor !== 0)
        .map((r) => ({ codproducto: r.codproducto, nombreproducto: r.producto || null, lote: r.lote || null, location: r.location || null, stock_actual: r.valor }))
    } else {
      // Cargar saldos VIVOS del sistema (paginado) — cíclico o producto único.
      const saldos: any[] = []
      let from = 0
      while (true) {
        let q = supabase
          .from("saldoinvdetalle")
          .select("codproducto,nombreproducto,lote,location,stock_actual")
          .eq("idempresa", proyectoId)
        if (payload.codproductoUnico) q = q.eq("codproducto", payload.codproductoUnico)
        const { data, error } = await q.order("codproducto").order("lote").order("location").range(from, from + 999)
        if (error) return { success: false, error: error.message }
        saldos.push(...(data ?? []))
        if (!data || data.length < 1000) break
        from += 1000
        if (from > 60000) break
      }
      lineasBase = payload.codproductoUnico ? saldos : saldos.filter((r) => (Number(r.stock_actual) || 0) !== 0)
    }
    const totalSistema = lineasBase.reduce((s, r) => s + (Number(r.stock_actual) || 0), 0)

    const { data: cab, error: errCab } = await supabase
      .from("sig_inventario_cuadre")
      .insert({
        proyecto_id: proyectoId,
        fecha: payload.fecha ?? null,
        tipo: payload.tipo ?? "total",
        almacen: payload.almacen ?? null,
        responsable: payload.responsable ?? null,
        estado: "borrador",
        total_sistema: Math.round(totalSistema * 100) / 100,
        total_conteo: Math.round(totalSistema * 100) / 100, // inicia = sistema (sin diferencia)
        total_diferencia: 0,
        items: lineasBase.length,
        items_con_diferencia: 0,
        creado_por: payload.creado_por ?? null,
      })
      .select("id")
      .single()
    if (errCab) return { success: false, error: errCab.message }
    const cuadreId = (cab as any).id

    if (lineasBase.length > 0) {
      const detalle = lineasBase.map((r) => {
        const sistema = Number(r.stock_actual) || 0
        return {
          cuadre_id: cuadreId,
          codproducto: r.codproducto ?? null,
          producto: r.nombreproducto ?? null,
          lote: r.lote ?? null,
          location: r.location ?? null,
          sistema,
          conteo: sistema, // sin contar todavía → sin diferencia
          diferencia: 0,
        }
      })
      // Insertar en lotes de 500.
      for (let i = 0; i < detalle.length; i += 500) {
        const { error: errDet } = await supabase.from("sig_inventario_cuadre_detalle").insert(detalle.slice(i, i + 500))
        if (errDet) return { success: false, error: errDet.message }
      }
    }
    return { success: true, id: cuadreId, items: lineasBase.length }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/** Guarda el conteo físico (reemplaza el detalle) y recalcula totales. */
export async function guardarConteoCuadre(
  cuadreId: number,
  lineas: { codproducto?: string | null; producto?: string | null; lote?: string | null; location?: string | null; sistema: number; conteo: number; observacion?: string | null }[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const filas = lineas.map((l) => {
      const sistema = Number(l.sistema) || 0
      const conteo = Number(l.conteo) || 0
      return {
        cuadre_id: cuadreId,
        codproducto: l.codproducto ?? null,
        producto: l.producto ?? null,
        lote: l.lote ?? null,
        location: l.location ?? null,
        sistema,
        conteo,
        diferencia: Math.round((conteo - sistema) * 100) / 100,
        observacion: l.observacion ?? null,
      }
    })
    await supabase.from("sig_inventario_cuadre_detalle").delete().eq("cuadre_id", cuadreId)
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await supabase.from("sig_inventario_cuadre_detalle").insert(filas.slice(i, i + 500))
      if (error) return { success: false, error: error.message }
    }
    const totalSistema = filas.reduce((s, r) => s + r.sistema, 0)
    const totalConteo = filas.reduce((s, r) => s + r.conteo, 0)
    const totalDif = filas.reduce((s, r) => s + r.diferencia, 0)
    const conDif = filas.filter((r) => r.diferencia !== 0).length
    await supabase
      .from("sig_inventario_cuadre")
      .update({
        total_sistema: Math.round(totalSistema * 100) / 100,
        total_conteo: Math.round(totalConteo * 100) / 100,
        total_diferencia: Math.round(totalDif * 100) / 100,
        items: filas.length,
        items_con_diferencia: conDif,
        estado: "contado",
        updated_at: new Date().toISOString(),
      })
      .eq("id", cuadreId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Guarda UNA sola línea de conteo (upsert por cuadre_id+codproducto+lote+
 * location) — a diferencia de `guardarConteoCuadre` (borra todo el detalle y
 * lo reinserta completo), esto permite que varias personas cuenten el mismo
 * documento AL TIEMPO sin pisarse: cada quien guarda solo la línea que
 * acaba de contar, con su nombre y hora (`contado_por`/`contado_en`).
 * Recalcula los totales de la cabecera desde TODO el detalle actual.
 */
export async function guardarLineaConteoCuadre(
  cuadreId: number,
  linea: { codproducto?: string | null; producto?: string | null; lote?: string | null; location?: string | null; sistema: number; conteo: number; observacion?: string | null },
  contadoPor: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const sistema = Number(linea.sistema) || 0
    const conteo = Number(linea.conteo) || 0
    const fila = {
      cuadre_id: cuadreId,
      codproducto: linea.codproducto ?? null,
      producto: linea.producto ?? null,
      lote: linea.lote ?? "",
      location: linea.location ?? "",
      sistema,
      conteo,
      diferencia: Math.round((conteo - sistema) * 100) / 100,
      observacion: linea.observacion ?? null,
      contado_por: contadoPor,
      contado_en: new Date().toISOString(),
    }
    const { error } = await supabase
      .from("sig_inventario_cuadre_detalle")
      .upsert(fila, { onConflict: "cuadre_id,codproducto,lote,location" })
    if (error) return { success: false, error: error.message }

    // Recalcula los totales de la cabecera desde el detalle completo (no
    // solo esta línea) — mismo criterio de siempre, ahora tras un upsert.
    const { data: todas } = await supabase.from("sig_inventario_cuadre_detalle").select("sistema,conteo,diferencia").eq("cuadre_id", cuadreId)
    const filas = todas ?? []
    const totalSistema = filas.reduce((s: number, r: any) => s + (Number(r.sistema) || 0), 0)
    const totalConteo = filas.reduce((s: number, r: any) => s + (Number(r.conteo) || 0), 0)
    const totalDif = filas.reduce((s: number, r: any) => s + (Number(r.diferencia) || 0), 0)
    const conDif = filas.filter((r: any) => Number(r.diferencia) !== 0).length
    await supabase
      .from("sig_inventario_cuadre")
      .update({
        total_sistema: Math.round(totalSistema * 100) / 100,
        total_conteo: Math.round(totalConteo * 100) / 100,
        total_diferencia: Math.round(totalDif * 100) / 100,
        items: filas.length,
        items_con_diferencia: conDif,
        estado: "contado",
        updated_at: new Date().toISOString(),
      })
      .eq("id", cuadreId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function cerrarCuadre(cuadreId: number, estado: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase
      .from("sig_inventario_cuadre")
      .update({ estado, updated_at: new Date().toISOString() })
      .eq("id", cuadreId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/** Registra la firma del cliente en el acta de revisión de inventario (auditoría). */
export async function firmarCuadre(
  cuadreId: number,
  payload: {
    cliente_firmante?: string | null
    cliente_cargo?: string | null
    fecha_firma?: string | null
    acta_observaciones?: string | null
    // Imagen real de la firma (pad) — igual patrón que Acta de Cruce / Acta
    // de Cierre Mensual. Opcional: si no llega, queda como antes (solo texto).
    firma_url?: string | null
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const fila: any = {
      cliente_firmante: payload.cliente_firmante ?? null,
      cliente_cargo: payload.cliente_cargo ?? null,
      fecha_firma: payload.fecha_firma ?? null,
      acta_observaciones: payload.acta_observaciones ?? null,
      firmado: !!(payload.cliente_firmante && payload.cliente_firmante.trim()),
      updated_at: new Date().toISOString(),
    }
    if (payload.firma_url != null) fila.firma_url = payload.firma_url
    const { error } = await supabase.from("sig_inventario_cuadre").update(fila).eq("id", cuadreId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Busca el conteo físico (Cuadre y Correcciones, tipo "total") YA CERRADO O
 * APROBADO de un proyecto/mes, para que el cierre mensual de Conciliación lo
 * use como "físico congelado" — el enlace real con el mes siguiente
 * (`getOrCrearActaCruce`/`getKardexInventario` leen `fisico_snapshot` de
 * `sig_inventario_cierre_mes`). Antes esto SOLO se llenaba con un script
 * puntual corrido a mano (ver scripts/sig/ESTADO_PROYECTO_SIG.md §6j); con
 * esto, si YA se hizo el conteo físico de fin de mes en esta pantalla, el
 * botón normal de "Generar Acta" de Conciliación Mensual lo recoge solo.
 * Si hay varios cuadres cerrados ese mes, usa el más reciente.
 */
export async function getConteoFisicoDelMes(
  proyectoId: number,
  mes: string, // 'YYYY-MM'
): Promise<{ success: boolean; data: { cuadreId: number; fisicoCongelado: number; fisicoSnapshot: Record<string, number> } | null; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const desde = `${mes}-01`
    const hastaD = new Date(`${mes}-01T00:00:00Z`)
    hastaD.setUTCMonth(hastaD.getUTCMonth() + 1)
    const hasta = hastaD.toISOString().slice(0, 10)
    const { data: cuadre } = await supabase
      .from("sig_inventario_cuadre")
      .select("id")
      .eq("proyecto_id", proyectoId)
      .eq("tipo", "total")
      .eq("activo", true)
      .in("estado", ["cerrado", "aprobado"])
      .gte("fecha", desde)
      .lt("fecha", hasta)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!cuadre?.id) return { success: true, data: null }
    const { data: det } = await supabase.from("sig_inventario_cuadre_detalle").select("codproducto, conteo").eq("cuadre_id", cuadre.id)
    const fisicoSnapshot: Record<string, number> = {}
    let fisicoCongelado = 0
    for (const d of det ?? []) {
      const cod = d.codproducto || "(sin código)"
      const c = Number(d.conteo) || 0
      fisicoSnapshot[cod] = (fisicoSnapshot[cod] || 0) + c
      fisicoCongelado += c
    }
    return { success: true, data: { cuadreId: cuadre.id, fisicoCongelado: Math.round(fisicoCongelado * 100) / 100, fisicoSnapshot } }
  } catch (err: any) {
    return { success: false, data: null, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarCuadre(cuadreId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_inventario_cuadre").update({ activo: false }).eq("id", cuadreId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/** Genera ajustes contabilizados desde las diferencias de un cuadre. */
export async function generarAjustesCuadre(cuadreId: number): Promise<{ success: boolean; creados?: number; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data: cab } = await supabase.from("sig_inventario_cuadre").select("proyecto_id,fecha,responsable,estado").eq("id", cuadreId).single()
    // Idempotente: si ya no esta en "contado" (ya se generaron ajustes antes,
    // dejandolo en "cerrado"), no repetir -- un doble clic o una carrera de red
    // (el boton solo deberia desaparecer DESPUES de que este mismo await
    // resuelva) creaba un segundo lote identico de ajustes, que se aprobaban
    // los DOS al cerrar el mes, duplicando el movimiento real de inventario.
    // Encontrado con datos reales 2026-09-01: 13 correcciones se volvieron 26.
    if ((cab as any)?.estado !== "contado") return { success: true, creados: 0 }
    const { data: det } = await supabase.from("sig_inventario_cuadre_detalle").select("*").eq("cuadre_id", cuadreId)
    const conDif = (det ?? []).filter((d: any) => Number(d.diferencia) !== 0)
    if (conDif.length === 0) return { success: true, creados: 0 }
    // La correccion pertenece al MES QUE SE ESTA CERRANDO, no al dia del
    // conteo (`cab.fecha` es el corte -- el primer dia del periodo nuevo,
    // igual que en calcularStockAlCorte). Un conteo total con fecha
    // "2026-09-01" cierra agosto, asi que sus correcciones deben fecharse
    // "2026-08-31" -- si no, Conciliacion Mensual (que agrupa por la fecha
    // real de creado cuando no hay orden de cargue) las cuenta en el mes
    // siguiente. Encontrado con datos reales 2026-09-01, ID3, cuadre #8.
    let fechaCorreccion: string | null = (cab as any)?.fecha ?? null
    if (fechaCorreccion) {
      const d = new Date(`${fechaCorreccion}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() - 1)
      fechaCorreccion = d.toISOString().slice(0, 10)
    }
    // direccion/cod_movimiento faltaban aqui (solo se ponian en el alta MANUAL
    // de "Registrar correccion") -- sin direccion, postCorreccionInvtrans lee
    // `ajuste.direccion === "salida"` como false para CUALQUIER ajuste sin
    // direccion, y postea TODO como Entrada: un faltante habria sumado stock
    // en vez de restarlo. Encontrado y corregido antes de que existiera ni un
    // solo ajuste real generado por este camino (verificado 2026-09-01).
    const filas = conDif.map((d: any) => {
      const esFaltante = Number(d.diferencia) < 0
      return {
        proyecto_id: (cab as any)?.proyecto_id ?? null,
        cuadre_id: cuadreId,
        fecha: fechaCorreccion,
        codproducto: d.codproducto,
        producto: d.producto,
        lote: d.lote,
        location: d.location ?? null,
        direccion: esFaltante ? "salida" : "ingreso",
        cod_movimiento: esFaltante ? "702" : "701",
        cantidad: d.diferencia,
        tipo: esFaltante ? "faltante" : "sobrante",
        motivo: "Ajuste por conteo físico (cuadre)",
        responsable: (cab as any)?.responsable ?? null,
        estado: "registrado",
      }
    })
    const { error } = await supabase.from("sig_inventario_ajuste").insert(filas)
    if (error) return { success: false, error: error.message }
    await supabase.from("sig_inventario_cuadre").update({ estado: "cerrado", updated_at: new Date().toISOString() }).eq("id", cuadreId)
    return { success: true, creados: filas.length }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function getAjustesInventario(
  proyectoId: number,
): Promise<{ success: boolean; data: SigInventarioAjuste[]; error?: string }> {
  try {
    if (!proyectoId) return { success: true, data: [] }
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("sig_inventario_ajuste")
      .select("*")
      .eq("proyecto_id", proyectoId)
      .eq("activo", true)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigInventarioAjuste[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function registrarAjusteInventario(
  proyectoId: number,
  payload: {
    id?: number
    fecha?: string | null
    codproducto?: string | null
    producto?: string | null
    lote?: string | null
    location?: string | null
    direccion?: string | null
    cod_movimiento?: string | null
    cantidad: number
    tipo: string
    motivo?: string | null
    responsable?: string | null
    soporte?: string | null
    estado?: string
  },
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!proyectoId) return { success: false, error: "Selecciona un cliente/sitio" }
    const supabase: any = await getSupabaseAdmin()
    // La dirección (ingreso/salida) define el signo: salida = − (descuenta stock).
    const dir = payload.direccion ?? (payload.cantidad < 0 ? "salida" : "ingreso")
    const cant = dir === "salida" ? -Math.abs(payload.cantidad ?? 0) : Math.abs(payload.cantidad ?? 0)
    const fila: any = {
      fecha: payload.fecha ?? null,
      codproducto: payload.codproducto ?? null,
      producto: payload.producto ?? null,
      lote: payload.lote ?? null,
      location: payload.location ?? null,
      direccion: dir,
      cod_movimiento: payload.cod_movimiento ?? null,
      cantidad: cant,
      tipo: payload.tipo ?? "correccion",
      motivo: payload.motivo ?? null,
      responsable: payload.responsable ?? null,
      soporte: payload.soporte ?? null,
      estado: payload.estado ?? "registrado",
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_inventario_ajuste").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_inventario_ajuste")
      .insert({ ...fila, proyecto_id: proyectoId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarAjusteInventario(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_inventario_ajuste").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// Hora de Colombia (UTC-5) en ISO — para invtrans.creado, igual que la operación.
function colombiaNowISO(): string {
  const now = new Date()
  return new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" })).toISOString()
}

/**
 * Postea una corrección como MOVIMIENTO REAL en invtrans (igual que la
 * operación: el trigger de la base recalcula saldoinvdetalle e invglobal).
 * Faltante/avería = Salida; sobrante/devolución = Entrada. Mueve stock.
 * Devuelve el id del movimiento generado (o null si no se pudo).
 */
async function postCorreccionInvtrans(
  supabase: any,
  ajuste: any,
  actor: string,
): Promise<{ id: number | null; error?: string }> {
  try {
    const proyectoId = Number(ajuste.proyecto_id)
    if (!proyectoId) return { id: null, error: "Sin cliente/sitio" }
    // Idempotencia: si ya existe el movimiento de ESTA corrección (marcador
    // [aj#id] en observaciones), no se vuelve a postear (evita duplicados aun
    // si no se pudo guardar invtrans_id).
    const marker = `[aj#${ajuste.id}]`
    const { data: yaExiste } = await supabase.from("invtrans").select("id").ilike("observaciones", `%${marker}%`).limit(1).maybeSingle()
    if (yaExiste?.id) return { id: Number(yaExiste.id) }
    // Siguiente id (mismo patrón que registerInventoryTransaction).
    const { data: maxRow } = await supabase.from("invtrans").select("id").order("id", { ascending: false }).limit(1).maybeSingle()
    const nextId = maxRow ? Number(maxRow.id) + 1 : 1
    // idproducto (productos.codigo) — best effort.
    let idproducto = 0
    try {
      const { data: p } = await supabase.from("productos").select("id").eq("codigo", ajuste.codproducto).maybeSingle()
      if (p?.id) idproducto = Number(p.id)
    } catch { /* sin match */ }
    // almacén del location (locations.bodega → almacenes.nombre) — best effort.
    let almacen: string | null = null
    try {
      const { data: loc } = await supabase.from("locations").select("bodega").eq("codigo", ajuste.location).maybeSingle()
      if (loc?.bodega) { const { data: alm } = await supabase.from("almacenes").select("nombre").eq("id", loc.bodega).maybeSingle(); almacen = alm?.nombre ?? null }
    } catch { /* sin almacén */ }
    // Avería = merma de proceso (Reproceso); faltante = Salida; sobrante/devolución = Entrada.
    const tipomov = ajuste.tipo === "averia" ? "Reproceso" : ajuste.direccion === "salida" ? "Salida" : "Entrada"
    const cantidad = Math.abs(Number(ajuste.cantidad) || 0)
    const insert: any = {
      id: nextId,
      idempresa: proyectoId,
      idproducto,
      codproducto: ajuste.codproducto ?? null,
      nombreproducto: ajuste.producto ?? null,
      lote: ajuste.lote ?? null,
      location: ajuste.location ?? null,
      almacen,
      cantidad,
      tipomov,
      status: "aprobado",
      origen: "transaccion manual", // mismo origen que la operación → trigger ajusta saldo
      observaciones: `Corrección de inventario${ajuste.cuadre_id ? ` · cuadre #${ajuste.cuadre_id}` : ""} · ${ajuste.tipo}${ajuste.motivo ? " · " + ajuste.motivo : ""} ${marker}`,
      cod_movimiento: ajuste.cod_movimiento ?? null,
      creadopor: actor,
      // Si el ajuste trae `fecha` (del conteo que lo genero, o del formulario
      // manual), la correccion pertenece a ESE dia -- no al momento real en
      // que se aprueba/postea. Sin esto, cerrar hoy un conteo que cierra
      // AGOSTO mandaba la correccion a septiembre en Conciliacion Mensual
      // (que agrupa por la fecha real de creado cuando no hay orden de
      // cargue) -- encontrado con datos reales 2026-09-01, ID3, cuadre #8:
      // las 13 averias/faltantes/sobrantes del cierre de agosto aparecian en
      // cero en la fila de agosto, todas contadas en septiembre por error.
      creado: ajuste.fecha ? new Date(`${ajuste.fecha}T15:00:00Z`).toISOString() : colombiaNowISO(),
    }
    const { error } = await supabase.from("invtrans").insert([insert])
    if (error) return { id: null, error: error.message }
    // Reproceso (avería) también se refleja en la tabla reprocesos (merma de proceso).
    if (tipomov === "Reproceso") {
      try {
        await supabase.from("reprocesos").insert([{ idempresa: proyectoId, lote: ajuste.lote, producto: ajuste.producto, codproducto: ajuste.codproducto, cantidad, creado: colombiaNowISO(), creadopor: actor }])
      } catch { /* tabla opcional */ }
    }
    return { id: nextId }
  } catch (err: any) {
    return { id: null, error: err?.message || "Error al postear el movimiento" }
  }
}

// Marca la corrección como aprobada. Si la columna invtrans_id aún no existe
// (SQL 19 sin la última versión), hace fallback sin ella para no fallar.
async function marcarAjusteAprobado(
  supabase: any,
  id: number,
  aprobadoPor: string,
  invtransId: number | null,
): Promise<{ error?: string }> {
  const base = { estado: "aprobado", aprobado_por: aprobadoPor, aprobado_fecha: new Date().toISOString() }
  const r1 = await supabase.from("sig_inventario_ajuste").update({ ...base, invtrans_id: invtransId }).eq("id", id)
  if (!r1.error) return {}
  // Reintento sin invtrans_id (columna ausente). La idempotencia la cubre el marcador.
  const r2 = await supabase.from("sig_inventario_ajuste").update(base).eq("id", id)
  if (r2.error) return { error: r2.error.message }
  return {}
}

/**
 * Aprueba una corrección: registra quién/cuándo y POSTEA el movimiento real
 * en invtrans (mueve stock). Idempotente: si ya tiene invtrans_id, no re-postea.
 */
export async function aprobarAjusteInventario(
  id: number,
  aprobadoPor: string,
): Promise<{ success: boolean; invtransId?: number | null; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data: aj } = await supabase.from("sig_inventario_ajuste").select("*").eq("id", id).single()
    if (!aj) return { success: false, error: "Corrección no encontrada" }
    let invtransId: number | null = aj.invtrans_id ?? null
    if (!invtransId) {
      const r = await postCorreccionInvtrans(supabase, aj, aprobadoPor)
      if (r.error) return { success: false, error: `No se pudo mover el stock: ${r.error}` }
      invtransId = r.id
    }
    const ok = await marcarAjusteAprobado(supabase, id, aprobadoPor, invtransId)
    if (ok.error) return { success: false, error: ok.error }
    return { success: true, invtransId }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Cierre mensual del cuadre: aprueba y postea a invtrans TODAS las correcciones
 * pendientes del cuadre (mueve stock → físico = sistema) y marca el cuadre como
 * aprobado. El Acta firmada por el cliente es el soporte del cierre.
 */
export async function cerrarMesCuadre(
  cuadreId: number,
  actor: string,
): Promise<{ success: boolean; posteados?: number; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data: ajustes } = await supabase
      .from("sig_inventario_ajuste")
      .select("*")
      .eq("cuadre_id", cuadreId)
      .eq("activo", true)
    let posteados = 0
    for (const aj of ajustes ?? []) {
      if (aj.invtrans_id) continue // ya posteado
      const r = await postCorreccionInvtrans(supabase, aj, actor)
      if (r.error) return { success: false, posteados, error: `Corrección ${aj.id}: ${r.error}` }
      await marcarAjusteAprobado(supabase, aj.id, actor, r.id)
      posteados++
    }
    await supabase.from("sig_inventario_cuadre").update({ estado: "aprobado", updated_at: new Date().toISOString() }).eq("id", cuadreId)
    return { success: true, posteados }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Catálogo de productos con stock del cliente (saldoinvdetalle) para PRECARGAR
 * el formulario de ajuste: el usuario digita el código y aparece el producto,
 * con sus lotes y ubicaciones reales (respeta la configuración de LIPgo).
 */
export async function getProductosInventario(
  proyectoId: number,
): Promise<{
  success: boolean
  data: Array<{
    codproducto: string
    nombreproducto: string
    stock: number
    lotes: string[]
    locations: string[]
    porUbicacion: Array<{ lote: string; location: string; stock: number }>
  }>
  error?: string
}> {
  try {
    if (!proyectoId) return { success: true, data: [] }
    const supabase: any = await getSupabaseAdmin()
    const rows: any[] = []
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await supabase
        .from("saldoinvdetalle")
        .select("codproducto,nombreproducto,lote,location,stock_actual")
        .eq("idempresa", proyectoId)
        .order("codproducto")
        .order("lote")
        .order("location")
        .range(from, from + 999)
      if (error) return { success: false, data: [], error: error.message }
      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < 1000) break
    }
    const map: Record<string, any> = {}
    for (const r of rows) {
      const cod = String(r.codproducto ?? "").trim()
      if (!cod) continue
      if (!map[cod]) map[cod] = { codproducto: cod, nombreproducto: r.nombreproducto ?? "", stock: 0, lotes: new Set<string>(), locations: new Set<string>(), porUbicacion: [] as any[] }
      const m = map[cod]
      const s = Number(r.stock_actual) || 0
      m.stock += s
      if (r.lote) m.lotes.add(String(r.lote))
      if (r.location) m.locations.add(String(r.location))
      if (!m.nombreproducto && r.nombreproducto) m.nombreproducto = r.nombreproducto
      m.porUbicacion.push({ lote: r.lote ?? "", location: r.location ?? "", stock: s })
    }
    const data = Object.values(map)
      .map((m: any) => ({
        codproducto: m.codproducto,
        nombreproducto: m.nombreproducto,
        stock: Math.round(m.stock * 100) / 100,
        lotes: Array.from(m.lotes).sort() as string[],
        locations: Array.from(m.locations).sort() as string[],
        porUbicacion: m.porUbicacion,
      }))
      .sort((a: any, b: any) => a.nombreproducto.localeCompare(b.nombreproducto))
    return { success: true, data }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Satisfacción del cliente y partes interesadas + PQRSF (ISO 9001 9.1.2)
// ---------------------------------------------------------------------------

export async function getSatisfaccion(
  proyectoId?: number | null,
  tipo?: string | null,
): Promise<{ success: boolean; data: SigSatisfaccion[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    let q = supabase.from("sig_satisfaccion").select("*").eq("activo", true)
    if (proyectoId) q = q.eq("proyecto_id", proyectoId)
    else q = q.in("proyecto_id", SIG_CLIENTES_LIP)
    if (tipo) q = q.eq("tipo", tipo)
    const { data, error } = await q.order("fecha", { ascending: false }).order("id", { ascending: false })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigSatisfaccion[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function upsertSatisfaccion(
  proyectoId: number,
  payload: Partial<SigSatisfaccion> & { tipo: string; calificacion: number },
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!proyectoId) return { success: false, error: "Selecciona un cliente/sitio" }
    const supabase: any = await getSupabaseAdmin()
    const fila: any = {
      tipo: payload.tipo ?? "cliente",
      fecha: payload.fecha ?? null,
      periodo: payload.periodo ?? null,
      encuestado: payload.encuestado ?? null,
      calificacion: payload.calificacion ?? null,
      oportunidad: payload.oportunidad ?? null,
      calidad: payload.calidad ?? null,
      comunicacion: payload.comunicacion ?? null,
      recomendaria: payload.recomendaria ?? null,
      comentario: payload.comentario ?? null,
      canal: payload.canal ?? null,
      responsable: payload.responsable ?? null,
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_satisfaccion").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_satisfaccion")
      .insert({ ...fila, proyecto_id: proyectoId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarSatisfaccion(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_satisfaccion").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function getPQRSF(
  proyectoId?: number | null,
): Promise<{ success: boolean; data: SigPQRSF[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    let q = supabase.from("sig_pqrsf").select("*").eq("activo", true)
    if (proyectoId) q = q.eq("proyecto_id", proyectoId)
    else q = q.in("proyecto_id", SIG_CLIENTES_LIP)
    const { data, error } = await q.order("fecha", { ascending: false }).order("id", { ascending: false })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigPQRSF[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function upsertPQRSF(
  proyectoId: number,
  payload: Partial<SigPQRSF> & { tipo: string; descripcion: string },
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!proyectoId) return { success: false, error: "Selecciona un cliente/sitio" }
    if (!payload.descripcion?.trim()) return { success: false, error: "La descripción es obligatoria" }
    const supabase: any = await getSupabaseAdmin()
    // Días de respuesta si hay fecha y cierre.
    let dias: number | null = payload.dias_respuesta ?? null
    if (payload.fecha && payload.fecha_cierre) {
      const d = Math.round((new Date(payload.fecha_cierre).getTime() - new Date(payload.fecha).getTime()) / 86400000)
      if (!Number.isNaN(d)) dias = d
    }
    const fila: any = {
      fecha: payload.fecha ?? null,
      tipo: payload.tipo ?? "queja",
      parte_interesada: payload.parte_interesada ?? "cliente",
      canal: payload.canal ?? null,
      descripcion: payload.descripcion.trim(),
      responsable: payload.responsable ?? null,
      estado: payload.estado ?? "abierta",
      respuesta: payload.respuesta ?? null,
      fecha_compromiso: payload.fecha_compromiso ?? null,
      fecha_cierre: payload.fecha_cierre ?? null,
      dias_respuesta: dias,
      genera_nc: payload.genera_nc ?? false,
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_pqrsf").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_pqrsf")
      .insert({ ...fila, proyecto_id: proyectoId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarPQRSF(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_pqrsf").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Panel LIP · Gestión Humana — talento que presta el servicio. Armónico con
// las 3 normas: ISO 9001 (7.1.2 personas / 7.2 competencia / 7.3 conciencia),
// ISO 45001 (accidentalidad/ausentismo), ISO 14001 (formación ambiental).
// Por cliente/sitio. Fuente: headcount, registroasistencia, ausentismosst,
// capacitaciones_evaluacion_intentos.
// ---------------------------------------------------------------------------
export async function getPanelGestionHumanaLIP(
  proyectoId?: number | null,
  anio?: string | null,
  mes?: string | null, // "01".."12" (opcional)
  dia?: string | null, // "01".."31" (opcional, dentro del mes)
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = proyectoId ? [proyectoId] : SIG_CLIENTES_LIP
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)
    // Filtro de periodo por año/mes/día sobre fechas ISO (YYYY-MM-DD).
    const enPeriodo = (f: any) => {
      const s = String(f || "")
      if (anio && s.slice(0, 4) !== anio) return false
      if (mes && s.slice(5, 7) !== mes) return false
      if (dia && s.slice(8, 10) !== dia) return false
      return true
    }

    // --- Talento (headcount) ---
    const { data: hc } = await supabase
      .from("headcount")
      .select("id,idempresa,cargo,estado,contrato,examenes_ing,afiliacion_arl")
      .in("idempresa", clientes)
    const hcRows: any[] = hc ?? []
    const activos = hcRows.filter((r) => String(r.estado || "").toLowerCase() === "activo")
    const inactivos = hcRows.length - activos.length
    const idoneos = activos.filter((r) => r.contrato && r.examenes_ing && r.afiliacion_arl).length

    // --- Formación / toma de conciencia (intentos de evaluación, vía headcount) ---
    const hcIds = hcRows.map((r) => r.id)
    let aprob = 0, totalInt = 0
    const capacitadosSet = new Set<number>()
    if (hcIds.length > 0) {
      const { data: intentos } = await supabase
        .from("capacitaciones_evaluacion_intentos")
        .select("headcount_id,aprobado,fecha")
        .in("headcount_id", hcIds)
      for (const it of intentos ?? []) {
        if (!enPeriodo(it.fecha)) continue
        totalInt++
        if (it.aprobado) { aprob++; capacitadosSet.add(it.headcount_id) }
      }
    }

    // --- Asistencia diaria (registroasistencia) = fuente de verdad ---
    // Cubre los 4 proyectos. De aquí salen jornada, ausentismo y retiros.
    // Rango de fechas según año/mes/día (para acotar la consulta). Con año fijo:
    // mes+día = un día; solo mes = todo el mes; solo año = todo el año.
    // BUG CRÍTICO corregido (2026-09-15): `${anio}-${mes}-31` como límite fijo
    // rompía CUALQUIER mes de 30 días (abril/junio/septiembre/noviembre) --
    // `fecha` es columna `date` real en Postgres, "2026-09-31" no es una fecha
    // válida y el `.lte()` fallaba con error 22008 (out of range), la consulta
    // devolvía null y el panel quedaba en blanco para todo ese mes. Se usa el
    // último día REAL del mes (día 0 del mes siguiente).
    const ultimoDiaDe = (a: string, m: string) => new Date(Number(a), Number(m), 0).getDate()
    let rDesde: string | null = null, rHasta: string | null = null
    if (anio) {
      if (mes && dia) { rDesde = `${anio}-${mes}-${dia}`; rHasta = `${anio}-${mes}-${dia}` }
      else if (mes) { rDesde = `${anio}-${mes}-01`; rHasta = `${anio}-${mes}-${String(ultimoDiaDe(anio, mes)).padStart(2, "0")}` }
      else { rDesde = `${anio}-01-01`; rHasta = `${anio}-12-31` }
    }
    const asisAll: any[] = []
    let aFrom = 0
    while (true) {
      let q = supabase.from("registroasistencia").select("fecha,puesto,asistencia,identificacion,nombre").in("idempresa", clientes).order("id").range(aFrom, aFrom + 999)
      if (rDesde && rHasta) q = q.gte("fecha", rDesde).lte("fecha", rHasta)
      const { data } = await q
      asisAll.push(...(data ?? []))
      if (!data || data.length < 1000) break
      aFrom += 1000
      if (aFrom > 120000) break
    }
    // Ausentismo REAL (headcount): admin excluido + denominador por días
    // vinculados (fechainicio/fecha_retiro), misma regla de sig-actions
    // getIndicadoresValores. El cálculo "programado vs real" (registroasistencia)
    // se conserva aparte como "capacidad de respuesta" -- indicador operativo
    // distinto, no se elimina.
    const { data: hcAusHc } = await supabase
      .from("headcount")
      .select("identificacion,nombre,admin,fechainicio,fecha_retiro,idempresa")
      .or(clientes.map((c) => `idempresa.eq.${c}`).concat("idempresa.is.null").join(","))
    const hcAusReales = (hcAusHc ?? []).filter((h: any) => !/prueba/i.test(String(h.nombre || "")))
    const identificacionesAdminGH = new Set(
      hcAusReales.filter((h: any) => h.admin === true).map((h: any) => String(h.identificacion || "").trim()),
    )

    // Filtro de período en memoria (cubre mes/día aunque no haya rango de consulta).
    // Excluye administrativos y cuentas de prueba ("PRUEBA" en el nombre, activas
    // en headcount para pruebas manuales). Ausentismo = incapacidad (EG/AT) +
    // licencia no remunerada -- lib/ausentismo-categorias.ts, la misma regla del
    // módulo Ausentismos/Recobro (antes esta vista solo contaba "incapacidad").
    const asisRows = asisAll.filter(
      (r) =>
        enPeriodo(r.fecha) &&
        !/prueba/i.test(String(r.nombre || "")) &&
        !identificacionesAdminGH.has(String(r.identificacion || "").trim()),
    )
    const asisProgramados = asisRows.filter((r) => r.puesto !== null || r.asistencia !== null).length
    const asisPresentes = asisRows.filter((r) => r.asistencia === null && r.puesto !== null).length
    // Turnos (filas) para "capacidad de respuesta" -- conserva la fórmula
    // original tal cual. Días-persona distintos para el ausentismo real
    // (numerador y denominador en la misma unidad -- ver diasAusenciaDistintos).
    const asisAusenciasTurnos = asisRows.filter((r) => !!categoriaDeNovedad(r.asistencia)).length
    const asisAusenciasDias = diasAusenciaDistintos(asisRows)
    // Retiros = PERSONAS distintas con novedad "Retiro" (incluye apoyo de picos,
    // no solo salidas definitivas). Se reporta como conteo, no como % de rotación.
    const retiros = new Set(asisRows.filter((r) => String(r.asistencia || "").toLowerCase().includes("retiro")).map((r) => r.identificacion)).size
    const asisTotal = asisProgramados
    // Días-persona esperados (denominador real del ausentismo). Mismo
    // criterio de rango que rDesde/rHasta arriba, PERO si no se eligió año
    // (vista "Todos" del filtro, el estado inicial) y sí mes/día, se asume
    // el año en curso -- si no, rDesde/rHasta quedan null (ver el `if(anio)`
    // de arriba) y el denominador se diluía con TODO el histórico aunque el
    // usuario solo pidió ver un mes puntual (numerador sí quedaba acotado al
    // mes vía `enPeriodo`, denominador no -- ausentismo salía artificialmente bajo).
    const anioGH = anio || (mes || dia ? "2026" : "")
    let rDesdeGH: string, rHastaGH: string
    if (anioGH) {
      if (mes && dia) { rDesdeGH = `${anioGH}-${mes}-${dia}`; rHastaGH = `${anioGH}-${mes}-${dia}` }
      else if (mes) { rDesdeGH = `${anioGH}-${mes}-01`; rHastaGH = `${anioGH}-${mes}-${String(ultimoDiaDe(anioGH, mes)).padStart(2, "0")}` }
      else { rDesdeGH = `${anioGH}-01-01`; rHastaGH = `${anioGH}-12-31` }
    } else {
      rDesdeGH = "2026-01-01"
      rHastaGH = new Date().toISOString().slice(0, 10)
    }
    const personalDiasEsperados = hcAusReales
      .filter((h: any) => h.admin !== true && h.idempresa !== null && clientes.includes(Number(h.idempresa)))
      .reduce((s: number, h: any) => s + diasActivosEnPeriodo(h.fechainicio, h.fecha_retiro, rDesdeGH, rHastaGH), 0)
    // Planta acordada (base de cobertura).
    let plantaGH = 0
    for (const id of clientes) plantaGH += PLANTA_ACORDADA[id]?.total || 0

    // --- Accidentalidad / ausentismo (ausentismosst) ---
    const { data: au } = await supabase
      .from("ausentismosst")
      .select("tipo_evento,total_dias_incapacidad,costos_empresa,fecha_inicial,requiere_revision_sst")
      .in("idempresa", clientes)
    let diasAT = 0, casosAT = 0, diasEG = 0, casosEG = 0, costos = 0, osteomuscular = 0
    for (const r of au ?? []) {
      if (!enPeriodo(r.fecha_inicial)) continue
      const dias = Number(r.total_dias_incapacidad) || 0
      costos += Number(r.costos_empresa) || 0
      if (r.requiere_revision_sst) osteomuscular++
      // Los DÍAS de AT sí suman todas las filas (la prórroga aumenta días); el CONTEO de
      // AT NO se cuenta aquí (una misma lesión genera varias filas por prórroga).
      if (r.tipo_evento === "AT") { diasAT += dias }
      else { diasEG += dias; casosEG++ }
    }
    // casosAT = ACCIDENTES REALES = investigaciones (una investigación por AT en
    // `sst_incidentes`). Así las prórrogas (filas extra en ausentismosst) no inflan el conteo.
    {
      const { data: inc } = await supabase.from("sst_incidentes").select("fecha_evento").in("idempresa", clientes)
      for (const r of inc ?? []) if (enPeriodo(r.fecha_evento)) casosAT++
    }

    // Distribución headcount por cargo (top).
    const cargos: Record<string, number> = {}
    for (const r of activos) { const c = r.cargo || "(sin cargo)"; cargos[c] = (cargos[c] || 0) + 1 }
    const porCargo = Object.entries(cargos).map(([cargo, n]) => ({ cargo, n })).sort((a, b) => b.n - a.n).slice(0, 8)

    return {
      success: true,
      data: {
        talento: {
          activos: activos.length,
          inactivos, // incluye retiros definitivos + personal de apoyo para picos
          vinculados: hcRows.length,
          planta: plantaGH,
          // Cobertura de planta = activos vs planta acordada (métrica confiable).
          cobertura: plantaGH > 0 ? pct(activos.length, plantaGH) : 0,
          // Retiros = personas distintas con novedad "Retiro" en el periodo (conteo).
          retiros,
          // Ausentismo REAL = ausencias / días-persona esperados según headcount
          // (fechainicio/fecha_retiro cruzados con el período), no filas de
          // registroasistencia. "Capacidad de respuesta" (programado vs real del
          // control diario) queda aparte, es un indicador operativo distinto.
          ausentismo: pct(asisAusenciasDias, personalDiasEsperados),
          capacidadRespuesta: pct(asisAusenciasTurnos, asisProgramados),
          ausencias: asisAusenciasTurnos,
          idoneidad: pct(idoneos, activos.length),
          idoneos,
        },
        formacion: {
          aprobadas: pct(aprob, totalInt),
          intentos: totalInt,
          colaboradoresCapacitados: capacitadosSet.size,
          coberturaFormacion: pct(capacitadosSet.size, activos.length),
        },
        jornada: { cumplimiento: pct(asisPresentes, asisTotal), presentes: asisPresentes, total: asisTotal },
        sst: { casosAT, diasAT, casosEG, diasEG, costos: Math.round(costos), osteomuscular },
        porCargo,
        ausentismoPorTipo: [
          { tipo: "Accidente trabajo (AT)", dias: diasAT, casos: casosAT },
          { tipo: "Enfermedad general (EG)", dias: diasEG, casos: casosEG },
        ],
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Mapa de Interacción del Proceso (sig_proceso_interaccion) — guía auditor
// ---------------------------------------------------------------------------

export async function getProcesoInteraccion(
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; data: SigProcesoInteraccion[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const { data, error } = await supabase
      .from("sig_proceso_interaccion")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("orden", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigProcesoInteraccion[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

export async function upsertProcesoInteraccion(
  payload: {
    id?: number
    orden: number
    fase: string
    paso: string
    responsable?: string | null
    es_valor_agregado?: boolean | null
    accion_lipgo?: string | null
    modulo_lipgo?: string | null
    evidencia?: string | null
    campo_dato?: string | null
    norma_iso?: string | null
  },
  empresaIdFromClient?: number | null,
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    if (!payload.fase?.trim() || !payload.paso?.trim())
      return { success: false, error: "Fase y paso son obligatorios" }
    const supabase: any = await getSupabaseAdmin()
    const empresaId = await resolveEmpresaId(empresaIdFromClient)
    const fila: any = {
      orden: payload.orden ?? 99,
      fase: payload.fase.trim(),
      paso: payload.paso.trim(),
      responsable: payload.responsable ?? "lip",
      es_valor_agregado: payload.es_valor_agregado ?? false,
      accion_lipgo: payload.accion_lipgo ?? null,
      modulo_lipgo: payload.modulo_lipgo ?? null,
      evidencia: payload.evidencia ?? null,
      campo_dato: payload.campo_dato ?? null,
      norma_iso: payload.norma_iso ?? null,
    }
    if (payload.id) {
      const { error } = await supabase.from("sig_proceso_interaccion").update(fila).eq("id", payload.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: payload.id }
    }
    const { data, error } = await supabase
      .from("sig_proceso_interaccion")
      .insert({ ...fila, idempresa: empresaId, activo: true })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: (data as any)?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function eliminarProcesoInteraccion(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) return { success: false, error: "id requerido" }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase.from("sig_proceso_interaccion").update({ activo: false }).eq("id", id)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Panel LIP · Operación de cargue/descargue (dashboard de gestión de LIP como
// operador, NO del cliente). Enfoque ISO 9001 8.5/8.6/9.1. Filtrable por
// cliente/sitio y periodo. Tres focos: (A) servicio LIP, (B) personas que
// prestan el servicio, (C) valor agregado de LIPgo (trazabilidad/soportes).
// ---------------------------------------------------------------------------
export async function getPanelOperacionLIP(
  proyectoId?: number | null,
  desde?: string | null,
  hasta?: string | null,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = proyectoId ? [proyectoId] : SIG_CLIENTES_LIP
    const nombres: Record<number, string> = {}
    {
      const { data: emps } = await supabase.from("empresas").select("id,nombre").in("id", clientes)
      for (const e of emps ?? []) nombres[e.id] = e.nombre
    }

    // Lee TODAS las filas paginando (Supabase topa en 1000 SIEMPRE, incluso pidiendo
    // `.limit(10000)` explícito — verificado con Avimol: 1.702 órdenes reales, la
    // consulta con `.limit(10000)` solo traía 1.000). Mismo patrón que
    // `_computeIndicadoresValores` más arriba en este archivo.
    const pagAll = async (make: (from: number, to: number) => any): Promise<any[]> => {
      const acc: any[] = []
      for (let f = 0; ; f += 1000) {
        const { data } = await make(f, f + 999)
        acc.push(...(data ?? []))
        if (!data || data.length < 1000) break
        if (f > 500000) break
      }
      return acc
    }

    // --- Órdenes (cabeceraoc): traer columnas necesarias y agregar en memoria ---
    // "proyeccion" excluido (2026-09-08): residuo de un módulo manual
    // descontinuado en jul-2026, nunca fue una orden real de cliente (ver
    // scripts/053_pagonomina_reemplazo.sql) — sin esto inflaba tanto el tonelaje
    // como los conteos de órdenes/evidencia/ciclo de este panel.
    const rows: any[] = await pagAll((from, to) => {
      let q = supabase
        .from("cabeceraoc")
        .select("idempresa,fechaorden,tipooperacion,pesovascula,iniciocargue,fincargue,fotospicking,pdfoc,doccargue,status,ordendecargue,estadofactura,fechacargue,placa,cliente,transporte,facturar")
        .in("idempresa", clientes)
        .neq("tipooperacion", "proyeccion")
      if (desde) q = q.gte("fechaorden", desde)
      if (hasta) q = q.lte("fechaorden", hasta)
      return q.order("id", { ascending: true }).range(from, to)
    })

    const aMin = (s: string) => {
      const [h, m, sec] = String(s).split(":").map(Number)
      return h * 60 + m + (sec || 0) / 60
    }
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)

    const tot = rows.length
    const finc = rows.filter((r) => r.fincargue).length
    const evid = rows.filter((r) => r.fotospicking && String(r.fotospicking).length > 2).length
    const ciclo = rows.filter((r) => r.status && String(r.status).toLowerCase() === "finalizado").length
    const pdfO = rows.filter((r) => r.pdfoc).length
    const pdfP = rows.filter((r) => r.doccargue).length
    // Tolva ("Tolva"/"Tolva f", solo ID1) es PRODUCCIÓN reclasificada, no
    // Cargue/Descargue/Distribución a cliente -- tiene su propia meta
    // (EMPRESA_META_DIA_TON ya la excluye) y su propio indicador OEE.
    // Se excluye SOLO del tonelaje/cumplimiento de meta -- conteos de
    // órdenes, SLA, evidencia y facturación pendiente siguen igual (no es
    // lo que se reportó mezclado).
    // ...y también fuera los productos POR UNIDAD (Huevos / Empaque MP en
    // Avimol): su "peso" son unidades (lib/ordenes-por-unidad.ts, 2026-09-30).
    const porUnidadPanel = await codigosOrdenPorUnidad(supabase, rows.map((r) => r.ordendecargue))
    const rowsTon = rows.filter(
      (r) => r.tipooperacion !== "Tolva" && r.tipooperacion !== "Tolva f" && !porUnidadPanel.has(String(r.ordendecargue ?? "").trim()),
    )
    const ton = rowsTon.reduce((s, r) => s + (Number(r.pesovascula) || 0), 0)
    const durs = rows
      .filter((r) => r.iniciocargue && r.fincargue)
      .map((r) => aMin(r.fincargue) - aMin(r.iniciocargue))
      .filter((d) => d > 0 && d < 600)
    const tiempo = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0

    // Cumplimiento de META de tonelaje (vs EMPRESA_META_DIA_TON × días operativos por cliente).
    const diasPorCliente: Record<number, Set<string>> = {}
    for (const r of rowsTon) {
      const id = r.idempresa
      if (!diasPorCliente[id]) diasPorCliente[id] = new Set()
      if (r.fechaorden) diasPorCliente[id].add(String(r.fechaorden))
    }
    let metaPeriodo = 0
    for (const id of Object.keys(diasPorCliente)) {
      metaPeriodo += getMetaDiaForEmpresa(Number(id)) * diasPorCliente[Number(id)].size
    }
    const cumplimientoMeta = metaPeriodo > 0 ? Math.round((ton / metaPeriodo) * 1000) / 10 : 0

    // Series por mes (últimos 12) -- ordenes de TODAS, toneladas SIN Tolva.
    const mes: Record<string, { ordenes: number; toneladas: number }> = {}
    for (const r of rows) {
      const k = String(r.fechaorden || "").slice(0, 7)
      if (!k) continue
      mes[k] = mes[k] || { ordenes: 0, toneladas: 0 }
      mes[k].ordenes++
    }
    for (const r of rowsTon) {
      const k = String(r.fechaorden || "").slice(0, 7)
      if (!k) continue
      mes[k] = mes[k] || { ordenes: 0, toneladas: 0 }
      mes[k].toneladas += Number(r.pesovascula) || 0
    }
    const porMes = Object.entries(mes)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([m, v]) => ({ mes: m, ordenes: v.ordenes, toneladas: Math.round(v.toneladas) }))

    // Por tipo de operación
    const tipo: Record<string, number> = {}
    for (const r of rows) {
      const t = r.tipooperacion || "(sin tipo)"
      tipo[t] = (tipo[t] || 0) + 1
    }
    const porTipo = Object.entries(tipo)
      .map(([t, n]) => ({ tipo: t, ordenes: n }))
      .sort((a, b) => b.ordenes - a.ordenes)

    // Por cliente (solo cuando se ven todos)
    let porCliente: any[] = []
    if (!proyectoId) {
      const cl: Record<number, { ordenes: number; toneladas: number; finc: number }> = {}
      for (const r of rows) {
        const id = r.idempresa
        cl[id] = cl[id] || { ordenes: 0, toneladas: 0, finc: 0 }
        cl[id].ordenes++
        if (r.fincargue) cl[id].finc++
      }
      for (const r of rowsTon) {
        const id = r.idempresa
        cl[id] = cl[id] || { ordenes: 0, toneladas: 0, finc: 0 }
        cl[id].toneladas += Number(r.pesovascula) || 0
      }
      porCliente = Object.entries(cl)
        .map(([id, v]) => ({
          cliente: nombres[Number(id)] || `Empresa ${id}`,
          ordenes: v.ordenes,
          toneladas: Math.round(v.toneladas),
          cumplimiento: pct(v.finc, v.ordenes),
        }))
        .sort((a, b) => b.ordenes - a.ordenes)
    }

    // (B) Personas que prestan el servicio (gestión propia de LIP)
    const headCount = async (build: (q: any) => any): Promise<number> => {
      let qq = supabase.from("headcount").select("*", { count: "exact", head: true }).in("idempresa", clientes)
      qq = build(qq)
      const { count } = await qq
      return count || 0
    }
    const activos = await headCount((qq: any) => qq.ilike("estado", "activo"))
    const inactivos = await headCount((qq: any) => qq.not("estado", "ilike", "activo"))

    // Asistencia del periodo (cumplimiento de jornada) + ausentismo real del
    // equipo, UNA sola lectura de registroasistencia + headcount para ambos --
    // antes eran dos consultas separadas y la de "cumplimiento de jornada" no
    // excluía administrativos como sí lo hacía la de ausentismo, así que
    // Descansos/novedades de personal administrativo se colaban en un
    // indicador que es solo operativo. Administrativos excluidos de TODO lo
    // de aquí abajo (asisTotal, asisPresentes y turnosProgramadosOp).
    const asisAusRows: any[] = []
    {
      let aFrom2 = 0
      while (true) {
        let qa = supabase
          .from("registroasistencia")
          .select("fecha,puesto,asistencia,identificacion,nombre")
          .in("idempresa", clientes)
          .not("nombre", "ilike", "%prueba%")
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(aFrom2, aFrom2 + 999)
        if (desde) qa = qa.gte("fecha", desde)
        if (hasta) qa = qa.lte("fecha", hasta)
        const { data } = await qa
        asisAusRows.push(...(data ?? []))
        if (!data || data.length < 1000) break
        aFrom2 += 1000
        if (aFrom2 > 120000) break
      }
    }
    const { data: hcAusHcOp } = await supabase
      .from("headcount")
      .select("identificacion,nombre,admin,fechainicio,fecha_retiro,idempresa")
      .or(clientes.map((c) => `idempresa.eq.${c}`).concat("idempresa.is.null").join(","))
    const hcAusRealesOp = (hcAusHcOp ?? []).filter((h: any) => !/prueba/i.test(String(h.nombre || "")))
    const identificacionesAdminOp = new Set(
      hcAusRealesOp.filter((h: any) => h.admin === true).map((h: any) => String(h.identificacion || "").trim()),
    )
    const asisAusRealesOp = asisAusRows.filter((r) => !identificacionesAdminOp.has(String(r.identificacion || "").trim()))
    const asisTotal = asisAusRealesOp.length
    const asisPresentes = asisAusRealesOp.filter((r) => r.asistencia === null).length

    // --- SLA de tiempos por vehículo (Acuerdos de Servicio acordados) ---
    // Tiempo efectivo (fincargue−iniciocargue) vs el SLA acordado para el tipo
    // de vehículo. Tipo desde citasvehiculos (ocargue = cabeceraoc.ordendecargue).
    // Paginado: Avimol solo tiene 1.537 citas y ya topaba las 1.000 por defecto,
    // dejando sin tipo de vehículo (y por lo tanto sin SLA) a las órdenes cuya cita
    // caía fuera de la primera página — el "SLA en 0" reportado para Avimol.
    const citasSla = await pagAll((from, to) =>
      supabase
        .from("citasvehiculos")
        .select("ocargue,tipovehiculo")
        .in("idempresa", clientes)
        .order("ocargue", { ascending: true })
        .range(from, to),
    )
    const tipoPorOc: Record<string, string> = {}
    for (const c of citasSla ?? []) if (c.ocargue) tipoPorOc[String(c.ocargue)] = c.tipovehiculo
    // Subproducto (mogolla/salvado/harina de tercera): mismo criterio que
    // _computeIndicadoresValores (el BSC) y Centro de Coordinación — sin
    // esto, esas órdenes se median contra el tiempo (más corto) de PT.
    const ordenesSlaCodigosPanel = Array.from(
      new Set(rows.filter((r) => r.iniciocargue && r.fincargue).map((r) => String(r.ordendecargue))),
    )
    const esSubproductoPorOcPanel = new Set<string>()
    // Lotes de 200 órdenes Y paginado (misma razón que en getIndicadoresValores:
    // con 500 el detalle superaba las 1.000 líneas y se truncaba en silencio).
    for (let i = 0; i < ordenesSlaCodigosPanel.length; i += 200) {
      const chunk = ordenesSlaCodigosPanel.slice(i, i + 200)
      const detChunk = await pagAll((from, to) =>
        supabase.from("detalleoc").select("numeroorden, producto").in("numeroorden", chunk).order("id").range(from, to),
      )
      for (const d of detChunk ?? []) if (esNombreSubproducto(d.producto)) esSubproductoPorOcPanel.add(String(d.numeroorden))
    }
    const slaTipoMap: Record<string, { sumaReal: number; n: number; ok: number; sla: number }> = {}
    const slaMesMap: Record<string, { ok: number; n: number }> = {}
    const fueraDeSla: any[] = []
    let slaOk = 0
    let slaTot = 0
    for (const r of rows) {
      if (!r.iniciocargue || !r.fincargue) continue
      const tv = tipoPorOc[String(r.ordendecargue)]
      // SLA ajustado por sitio (CEDIs +15%/+35%), igual que _computeIndicadoresValores
      // (el BSC): antes no se pasaba `r.idempresa` y el panel medía a los CEDIs con el
      // tiempo base de planta, sin el ajuste acordado — más estricto de lo real.
      const productoPanel = esSubproductoPorOcPanel.has(String(r.ordendecargue)) ? "SUB" : "PT"
      const max = getSlaCargueMin(tv, productoPanel, r.idempresa)
      if (!max) continue
      const real = aMin(r.fincargue) - aMin(r.iniciocargue)
      if (real <= 0 || real > 600) continue
      slaTot++
      const cumple = real <= max
      if (cumple) slaOk++
      const tkey = tv || "(sin tipo)"
      slaTipoMap[tkey] = slaTipoMap[tkey] || { sumaReal: 0, n: 0, ok: 0, sla: max }
      slaTipoMap[tkey].sumaReal += real
      slaTipoMap[tkey].n++
      if (cumple) slaTipoMap[tkey].ok++
      const mk = String(r.fechaorden || "").slice(0, 7)
      if (mk) {
        slaMesMap[mk] = slaMesMap[mk] || { ok: 0, n: 0 }
        slaMesMap[mk].n++
        if (cumple) slaMesMap[mk].ok++
      }
      if (!cumple) fueraDeSla.push({ fecha: r.fechaorden, tipo: tkey, real: Math.round(real), sla: max, exceso: Math.round(real - max) })
    }
    const slaPorTipo = Object.entries(slaTipoMap)
      .map(([tipo, v]) => ({ tipo, sla: v.sla, real: Math.round(v.sumaReal / v.n), total: v.n, fuera: v.n - v.ok, cumplimiento: pct(v.ok, v.n) }))
      .sort((a, b) => b.total - a.total)
    const slaPorMes = Object.entries(slaMesMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([mes, v]) => ({ mes, cumplimiento: pct(v.ok, v.n) }))
    fueraDeSla.sort((a, b) => b.exceso - a.exceso)

    // Satisfacción del conductor (parte interesada que gestiona el coordinador).
    const { data: satRows } = await supabase
      .from("sig_satisfaccion")
      .select("calificacion")
      .eq("activo", true)
      .eq("tipo", "conductor")
      .in("proyecto_id", clientes)
    const satVals = (satRows ?? []).map((r: any) => Number(r.calificacion) || 0).filter((x: number) => x > 0)
    const satConductor = satVals.length ? Math.round((satVals.reduce((a: number, b: number) => a + b, 0) / satVals.length / 5) * 1000) / 10 : 0

    // Cobertura de calificación = cargues finalizados calificados (objetivo del coordinador).
    const finalizados = rows.filter((r) => r.fincargue).length
    const { data: califRows } = await supabase
      .from("sig_satisfaccion")
      .select("ref_orden")
      .eq("tipo", "conductor")
      .not("ref_orden", "is", null)
      .in("proyecto_id", clientes)
    const ordenesCalif = new Set((califRows ?? []).map((c: any) => String(c.ref_orden)))
    const calificados = rows.filter((r) => r.fincargue && ordenesCalif.has(String(r.ordendecargue))).length
    const coberturaCalificacion = pct(calificados, finalizados)

    // Cobertura de planta (activos vs planta acordada de los clientes en alcance).
    let plantaAcordada = 0
    for (const id of clientes) plantaAcordada += PLANTA_ACORDADA[id]?.total || 0
    const coberturaPlanta = plantaAcordada > 0 ? pct(activos, plantaAcordada) : 0

    // Ausentismo REAL del equipo: incapacidad EG/AT + licencia no remunerada
    // (lib/ausentismo-categorias.ts, fuente única) / días-persona ESPERADOS
    // según headcount (fechainicio/fecha_retiro cruzados con el período) --
    // no un conteo de filas de registroasistencia. "Capacidad de respuesta"
    // (programado vs real del control diario) se conserva aparte, es un
    // indicador operativo distinto. Reusa asisAusRealesOp (ya fetcheado y sin
    // administrativos, ver el bloque de "cumplimiento de jornada" arriba).
    const turnosProgramadosOp = asisAusRealesOp.filter((r) => r.puesto !== null || r.asistencia !== null).length
    // Turnos (filas) para "capacidad de respuesta"; días-persona distintos
    // para el ausentismo real (misma unidad que el denominador).
    const ausIncapTurnos = asisAusRealesOp.filter((r) => !!categoriaDeNovedad(r.asistencia)).length
    const ausIncapDias = diasAusenciaDistintos(asisAusRealesOp)
    const capacidadRespuesta = pct(ausIncapTurnos, turnosProgramadosOp)
    const desdeGHOp = desde || "2026-01-01"
    const hastaGHOp = hasta || new Date().toISOString().slice(0, 10)
    const personalDiasEsperadosOp = hcAusRealesOp
      .filter((h: any) => h.admin !== true && h.idempresa !== null && clientes.includes(Number(h.idempresa)))
      .reduce((s: number, h: any) => s + diasActivosEnPeriodo(h.fechainicio, h.fecha_retiro, desdeGHOp, hastaGHOp), 0)
    const ausentismo = pct(ausIncapDias, personalDiasEsperadosOp)

    // --- Facturación PENDIENTE POR SOLICITAR (responsabilidad del coordinador) ---
    // Solo las órdenes que el coordinador AÚN NO solicitó facturar (estadofactura
    // null). Cuando solicita (CF)/confirma pago (SF) pasa a la parte financiera.
    // No aplica a proyecciones ni tolva. Valor desde la tabla facturacion
    // (empresas 1-2: MAX peso × MAX tarifa; resto: suma valor_a_facturar).
    const esFacturable = (t: any) => {
      const x = String(t || "").toLowerCase()
      return x && x !== "proyeccion" && x !== "tolva"
    }
    // Solo "este mes en adelante": el backlog de meses pasados se considera
    // cerrado/cumplido y no se cuenta como pendiente vigente. Si el usuario
    // elige un rango con el filtro (desde), se respeta ese rango.
    const mesIniFact = (() => {
      const h = new Date()
      return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`
    })()
    const factFloor = desde || mesIniFact
    const opsFacturables = rows.filter(
      (r) =>
        esFacturable(r.tipooperacion) &&
        r.facturar !== false && // "no facturar" (Picking/Packing) nunca se va a solicitar: fuera del universo
        String(r.fechacargue || r.fechaorden || "").slice(0, 10) >= factFloor,
    )
    const gestionadas = opsFacturables.filter((r) => r.estadofactura).length
    const facturacionPct = pct(gestionadas, opsFacturables.length)
    const pendRows = opsFacturables.filter((r) => !r.estadofactura)
    const pendIds = Array.from(new Set(pendRows.map((r) => String(r.ordendecargue)).filter(Boolean)))
    const valorPorOrden: Record<string, number> = {}
    if (pendIds.length) {
      const { data: fact } = await supabase
        .from("facturacion")
        .select("numeroorden, pesobascula, tarifa, valor_a_facturar, idempresa")
        .in("numeroorden", pendIds)
      const byOrden: Record<string, any[]> = {}
      for (const f of fact ?? []) {
        const k = String(f.numeroorden)
        if (!byOrden[k]) byOrden[k] = []
        byOrden[k].push(f)
      }
      for (const [oc, fs] of Object.entries(byOrden)) {
        const emp = Number(fs[0].idempresa)
        const v =
          emp === 1 || emp === 2
            ? Math.max(...fs.map((x) => Number(x.pesobascula) || 0)) * Math.max(...fs.map((x) => Number(x.tarifa) || 0))
            : fs.reduce((s, x) => s + (Number(x.valor_a_facturar) || 0), 0)
        valorPorOrden[oc] = Math.round(v)
      }
    }
    // "Hoy" en día calendario de COLOMBIA (en UTC, de 7pm a medianoche ya
    // sería "mañana" y los días de pendiente saldrían inflados en 1).
    const hoyTs = Date.parse(fechaColombiaDe(new Date().toISOString()))
    const pendientesFact = pendRows
      .map((r) => {
        const fc = r.fechacargue || r.fechaorden
        const dias = fc ? Math.max(0, Math.floor((hoyTs - Date.parse(String(fc).slice(0, 10))) / 86400000)) : 0
        return {
          orden: r.ordendecargue,
          fecha: fc,
          placa: r.placa || null,
          cliente: r.cliente || null,
          transporte: r.transporte || null,
          toneladas: Math.round((Number(r.pesovascula) || 0) * 10) / 10,
          valor: valorPorOrden[String(r.ordendecargue)] || 0,
          dias,
        }
      })
      .sort((a, b) => b.dias - a.dias)
    const valorPendiente = pendientesFact.reduce((s, p) => s + p.valor, 0)
    const valorRiesgo = pendientesFact.filter((p) => p.dias > 8).reduce((s, p) => s + p.valor, 0)
    const diasMax = pendientesFact.reduce((m, p) => Math.max(m, p.dias), 0)

    return {
      success: true,
      data: {
        servicioLIP: {
          ordenes: tot,
          toneladas: Math.round(ton * 10) / 10,
          cumplimiento: pct(finc, tot),
          tiempoCargue: tiempo,
          evidencia: pct(evid, tot),
          productividad: rowsTon.length > 0 ? Math.round((ton / rowsTon.length) * 100) / 100 : 0, // ton/orden (sin Tolva)
          cumplimientoMeta,                       // % ejecutado vs meta de tonelaje
          metaPeriodo: Math.round(metaPeriodo),   // meta del periodo (ton)
        },
        personas: {
          activos,
          inactivos,
          rotacion: pct(inactivos, activos + inactivos),
          asistencia: pct(asisPresentes, asisTotal),
          asistenciaBase: `${asisPresentes}/${asisTotal}`,
          coberturaPlanta,
          plantaAcordada,
          ausentismo,
          capacidadRespuesta,
        },
        valorAgregado: {
          pdfOrden: pct(pdfO, tot),
          pdfPicking: pct(pdfP, tot),
          evidenciaFoto: pct(evid, tot),
          cicloRegistrado: pct(ciclo, tot),
        },
        sla: {
          pct: slaTot > 0 ? pct(slaOk, slaTot) : 0,
          total: slaTot,
          ok: slaOk,
          porTipo: slaPorTipo,
          porMes: slaPorMes,
          fuera: fueraDeSla.slice(0, 20),
        },
        satConductor,
        coberturaCalificacion,
        calificados,
        finalizados,
        facturacion: {
          pct: facturacionPct, // % de operaciones ya gestionadas (solicitadas) por el coordinador
          pendientesCount: pendientesFact.length,
          valorPendiente,
          valorRiesgo, // pendiente con > 8 días sin solicitar
          diasMax,
          pendientes: pendientesFact.slice(0, 50),
        },
        porMes,
        porTipo,
        porCliente,
        verTodos: !proyectoId,
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Indicador de FACTURACIÓN POR PROYECTOS (módulo Gestión Financiera).
 * Compara los 4 proyectos: % de gestión de facturación (solicitadas/total),
 * pendientes por solicitar y valor pendiente. Piso = mes actual (o `desde`):
 * el backlog histórico se considera cerrado y no distorsiona el indicador.
 */
export async function getFacturacionPorProyecto(
  desde?: string | null,
  hasta?: string | null,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const clientes = SIG_CLIENTES_LIP
    const nombres: Record<number, string> = {}
    {
      const { data: emps } = await supabase.from("empresas").select("id,nombre").in("id", clientes)
      for (const e of emps ?? []) nombres[e.id] = e.nombre
    }
    const mesIni = (() => {
      const h = new Date()
      return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`
    })()
    const floor = desde || mesIni
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)

    let q = supabase
      .from("cabeceraoc")
      .select("idempresa, ordendecargue, estadofactura, tipooperacion, fechacargue, fechaorden, pesovascula, facturar")
      .in("idempresa", clientes)
      .gte("fechaorden", floor)
      .limit(20000)
    if (hasta) q = q.lte("fechaorden", hasta)
    const { data: rows, error } = await q
    if (error) return { success: false, error: error.message }
    const esFact = (t: any) => {
      const x = String(t || "").toLowerCase()
      return x && x !== "proyeccion" && x !== "tolva"
    }
    // "no facturar" (Picking/Packing) nunca se va a solicitar: fuera del universo.
    const facturables = (rows ?? []).filter((r: any) => esFact(r.tipooperacion) && r.facturar !== false)
    const pend = facturables.filter((r: any) => !r.estadofactura)
    const pendIds = Array.from(new Set(pend.map((r: any) => String(r.ordendecargue)).filter(Boolean)))
    const valorPorOrden: Record<string, number> = {}
    for (let i = 0; i < pendIds.length; i += 400) {
      const chunk = pendIds.slice(i, i + 400)
      const { data: fact } = await supabase
        .from("facturacion")
        .select("numeroorden, pesobascula, tarifa, valor_a_facturar, idempresa")
        .in("numeroorden", chunk)
      const byO: Record<string, any[]> = {}
      for (const f of fact ?? []) {
        const k = String(f.numeroorden)
        if (!byO[k]) byO[k] = []
        byO[k].push(f)
      }
      for (const [oc, fs] of Object.entries(byO)) {
        const emp = Number(fs[0].idempresa)
        const v =
          emp === 1 || emp === 2
            ? Math.max(...fs.map((x) => Number(x.pesobascula) || 0)) * Math.max(...fs.map((x) => Number(x.tarifa) || 0))
            : fs.reduce((s, x) => s + (Number(x.valor_a_facturar) || 0), 0)
        valorPorOrden[oc] = Math.round(v)
      }
    }
    // "Hoy" en día calendario de COLOMBIA (mismo criterio que pendientesFact).
    const hoyTs = Date.parse(fechaColombiaDe(new Date().toISOString()))
    const map: Record<number, any> = {}
    for (const r of facturables) {
      const id = r.idempresa
      if (!map[id]) map[id] = { idempresa: id, proyecto: nombres[id] || `Empresa ${id}`, facturables: 0, pendientes: 0, valorPendiente: 0, valorRiesgo: 0, diasMax: 0 }
      const m = map[id]
      m.facturables++
      if (!r.estadofactura) {
        m.pendientes++
        const v = valorPorOrden[String(r.ordendecargue)] || 0
        m.valorPendiente += v
        const fc = r.fechacargue || r.fechaorden
        const dias = fc ? Math.max(0, Math.floor((hoyTs - Date.parse(String(fc).slice(0, 10))) / 86400000)) : 0
        if (dias > 8) m.valorRiesgo += v
        if (dias > m.diasMax) m.diasMax = dias
      }
    }
    const proyectos = clientes.map((id) => {
      const m = map[id] || { idempresa: id, proyecto: nombres[id] || `Empresa ${id}`, facturables: 0, pendientes: 0, valorPendiente: 0, valorRiesgo: 0, diasMax: 0 }
      return { ...m, pct: pct(m.facturables - m.pendientes, m.facturables) }
    })
    const totFact = proyectos.reduce((s, p) => s + p.facturables, 0)
    const totPend = proyectos.reduce((s, p) => s + p.pendientes, 0)
    const totales = {
      facturables: totFact,
      pendientes: totPend,
      valorPendiente: proyectos.reduce((s, p) => s + p.valorPendiente, 0),
      valorRiesgo: proyectos.reduce((s, p) => s + p.valorRiesgo, 0),
      pct: pct(totFact - totPend, totFact),
    }
    const periodoLabel = new Date().toLocaleDateString("es-CO", { month: "long", year: "numeric" })
    return { success: true, data: { proyectos, totales, periodoLabel } }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * CONCILIACIÓN MENSUAL de inventario (depuración mes a mes).
 * Mes tomado del CÓDIGO de la orden. Modelo:
 *   INGRESOS = producción/descargue + devolución.
 *   SALIDAS  = cargue (601) + merma/reproceso (551).
 * Cierres persistidos en sig_inventario_cierre_mes + PDF en Storage.
 */
const RE_ORDEN = /^(?:dis-)?[a-z]+(\d{4})(\d{2})(\d{2})\d+[a-z]?$/i
export async function getConciliacionMensualInventario(
  empresaId?: number | null,
  anio?: string | null,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    if (!empresaId) {
      return { success: false, error: "Seleccione un cliente/sitio en el selector global (un proyecto a la vez)." }
    }
    const supabase: any = await getSupabaseAdmin()
    const clientes: number[] = [empresaId]
    const has = (v: any, t: string) => String(v || "").toLowerCase().includes(t)

    // Traer invtrans del/los proyecto(s) (paginado). El inventario y los despachos
    // se llevan POR LOTE, así que traemos producto+lote para el cuadre físico.
    const inv: any[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from("invtrans")
        .select("idempresa, idproducto, nombreproducto, codproducto, lote, tipomov, origen, cantidad, creado, ocargue, ordentolva, cod_movimiento, status, location")
        .in("idempresa", clientes)
        .order("id", { ascending: true }) // paginación determinista: sin ORDER BY, .range() salta/duplica filas — causa REAL de los "ajustes irreales" (confirmado 2026-08-08: marzo ID1 contaba 48.675 de cargue cuando lo real es 90.480)
        .range(from, from + 999)
      if (error) return { success: false, error: error.message }
      inv.push(...(data ?? []))
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 100000) break
    }

    // Saldo VIVO por (producto, lote) — es la VERDAD física (lo confirma el conteo).
    const saldosRows: any[] = []
    {
      let sf = 0
      while (true) {
        const { data } = await supabase.from("saldoinvdetalle").select("idproducto, nombreproducto, codproducto, categoria, subcategoria, lote, stock_actual").in("idempresa", clientes).order("codproducto").order("lote").order("location").range(sf, sf + 999)
        saldosRows.push(...(data ?? []))
        if (!data || data.length < 1000) break
        sf += 1000
        if (sf > 100000) break
      }
    }

    // La conciliación es SOLO de Producto Terminado + Sub Producto (así lo maneja
    // el cliente). El EMPAQUE y la MATERIA PRIMA NO entran (se concilian aparte).
    const catDe: Record<string, string> = {}
    const codDe: Record<string, string> = {}
    const nomDe: Record<string, string> = {}
    for (const r of saldosRows) {
      catDe[r.idproducto] = `${r.categoria || ""} / ${r.subcategoria || ""}`.toUpperCase()
      codDe[r.idproducto] = String(r.codproducto || "").toUpperCase()
      if (r.nombreproducto) nomDe[r.idproducto] = String(r.nombreproducto).toUpperCase()
    }
    for (const r of inv) {
      if (codDe[r.idproducto] === undefined) codDe[r.idproducto] = String(r.codproducto || "").toUpperCase()
      if (nomDe[r.idproducto] === undefined && r.nombreproducto) nomDe[r.idproducto] = String(r.nombreproducto).toUpperCase()
    }
    const incluir = (idp: any): boolean => {
      // Regla del cliente: los productos que DICEN "EMP" (empaque) NO entran al cruce,
      // aunque estén mal categorizados como PT. Prevalece el nombre/código.
      const nm = nomDe[idp] || ""
      if (nm.startsWith("EMP") || nm.startsWith("MP ")) return false
      const cs = catDe[idp]
      if (cs !== undefined) {
        if (cs.includes("EMPAQUE") || cs.includes("MATERIA PRIMA")) return false
        return cs.includes("PRODUCTO TERMINADO") || cs.includes("SUB PRODUCTO")
      }
      const p = codDe[idp] || "" // sin saldo/categoría → por prefijo del código
      if (p.startsWith("EMP") || p.startsWith("MP")) return false
      return p.startsWith("PT") || p.startsWith("SP")
    }

    const stockActual = saldosRows.reduce((s, r) => s + (incluir(r.idproducto) ? Number(r.stock_actual) || 0 : 0), 0)

    const mesDe = (oc: any, creado: any): string | null => {
      const m = RE_ORDEN.exec(String(oc || "").trim())
      if (m) return `${m[1]}-${m[2]}`
      // Fallback (sin código de orden estándar, ej. ajustes manuales): hora
      // Colombia real, no el timestamp UTC crudo (5h adelante).
      return creado ? fechaColombiaDe(creado).slice(0, 7) : null
    }

    // ============================================================
    // A) ROLL MENSUAL OPERACIONAL
    //    Apertura del periodo = Inventario Inicial (cód 561).
    //    Cada mes: saldo inicial + ingresos − despachos = saldo final,
    //    y ese saldo final es el inicial del mes siguiente.
    //    Ingresos = producción/recepción + devoluciones.
    //    SALIDAS = SOLO órdenes de cargue (601). Bodega/reproceso/ajustes
    //    NO interfieren en el roll (se sacan al cuadre físico/lista a revisar).
    //    Traslados internos, tolva y proyección se excluyen.
    // ============================================================
    const aniosSet = new Set<string>()
    let invInicial = 0
    const map: Record<string, any> = {}
    for (const r of inv) {
      if (!incluir(r.idproducto)) continue // solo Producto Terminado + Sub Producto
      const st = String(r.status || "").toLowerCase()
      if (!st.startsWith("aprob")) continue // SOLO lo aprobado (fuera: rechazado, por descontar, lote alterno)
      if (String(r.location || "") === "AJUSTE-SIG") continue // remanente de ajustes (obsoleto)
      const tieneOC = !!(r.ocargue && String(r.ocargue).trim())
      // lote paralelo/alterno SIN orden de cargue: no es una salida real
      if ((st.includes("altern") || st.includes("paralel") || has(r.origen, "altern") || has(r.origen, "paralel")) && !tieneOC) continue
      const c = Math.abs(Number(r.cantidad) || 0)
      const esInicial = r.cod_movimiento === "561" || has(r.origen, "inventario inicial")
      if (esInicial) { invInicial += c; continue } // apertura, no es flujo del mes
      // 309 (reclasificación de lote/producto/ubicación), 311 (traslado),
      // 312 (reverso de traslado), 344/343 (bloqueo/desbloqueo a cuarentena):
      // parejas salida+entrada neto 0, SIEMPRE — es la función misma del
      // código, nunca un ingreso/salida real, sin excepción aunque un 309
      // cambie de producto (un caso real así resultó ser un error de
      // digitación sin respaldo físico, confirmado por el usuario — no algo
      // que el reporte deba tratar como ingreso genuino). Antes solo se
      // excluía 311 por texto ("traslado entre localizaciones") — el resto,
      // creado por "Transacciones por Código" con origen="transaccion
      // manual", caía al catch-all de `esDev` de abajo y se contaba como una
      // devolución fantasma (verificado con datos reales: ID3, PT FIDEO
      // 250*24PQ).
      if (esCodigoTrasladoNetoCero(r.cod_movimiento) || has(r.origen, "traslado entre localizaciones")) continue // neto 0
      if (r.ordentolva || has(r.ocargue, "tolva") || has(r.ocargue, "proyec") || has(r.origen, "tolva") || has(r.origen, "proyec")) continue
      const mk = mesDe(r.ocargue, r.creado)
      if (!mk) continue
      const yyyy = mk.slice(0, 4)
      aniosSet.add(yyyy)
      if (anio && yyyy !== anio) continue
      if (!map[mk]) map[mk] = { mes: mk, produccion: 0, devolucion: 0, cargue: 0, merma: 0, ajuste: 0 }
      const a = map[mk]
      // Regla del cliente (2026-08-08): TODA salida CON orden de cargue es un
      // despacho real — incluye las "BODEGA GENERAL" de la migración de ID1
      // (traen orden IND2026xx aunque quedaron con cod 702).
      const esCargue =
        r.tipomov === "Salida" &&
        (r.cod_movimiento === "601" || has(r.origen, "orden de cargue") || (has(r.origen, "bodega general") && !!(r.ocargue && String(r.ocargue).trim())))
      // MERMA = lo ENVIADO a reproceso / avería (tipomov 'Reproceso', mov 551 salida).
      // El "ingreso por reproceso" (tipomov Entrada) NO es merma: es el retorno → ingreso.
      const esMerma = r.tipomov === "Reproceso"
      const esIngRepro = r.tipomov === "Entrada" && has(r.origen, "reproceso") // retorno de reproceso
      const esProd = r.cod_movimiento === "101" || (r.tipomov === "Entrada" && (has(r.origen, "producc") || has(r.origen, "aprob") || has(r.origen, "descarg") || has(r.origen, "logo")))
      // Antes CUALQUIER entrada manual sin otro match cabía aquí (catch-all
      // "tipomov Entrada && transaccion manual") — eso conflaba con 653
      // (devolución real) a cualquier otro código nuevo de "Transacciones
      // por Código" (ej. 701, que además se revisaba DESPUÉS de esDev en
      // este if/else-if, así que un 701 real terminaba contado como
      // devolución). Ahora solo 653 (su código explícito) y el retorno de
      // reproceso cuentan como devolución.
      const esDev = r.cod_movimiento === "653" || esIngRepro || has(r.origen, "devoluc")
      const esAjuste = r.cod_movimiento === "701" || r.cod_movimiento === "702"
      if (esCargue) a.cargue += c
      else if (esMerma) a.merma += c
      else if (esProd) a.produccion += c
      else if (esDev) a.devolucion += c
      // AJUSTE CON SIGNO: una salida 702 RESTA inventario (antes sumaba en
      // valor absoluto y una salida de ajuste inflaba la cadena — bug real).
      else if (esAjuste) a.ajuste += r.tipomov === "Salida" ? -c : c
    }

    // ============================================================
    // B) CUADRE FÍSICO LOTE POR LOTE (se calcula ANTES del roll para poder
    //    atribuir la diferencia libro-vs-físico a su mes por la fecha del lote).
    //    El inventario y los despachos se llevan POR LOTE (lote = AAAAMMDD).
    //    diferencia > 0 = el kardex tiene MÁS que el físico. Según el proyecto
    //    esa diferencia es MERMA DE PROCESO (p.ej. Avimol) o error a corregir.
    // ============================================================
    const book: Record<string, number> = {}
    const nombre: Record<string, string> = {}
    const loteDe: Record<string, string> = {}
    for (const r of inv) {
      if (!incluir(r.idproducto)) continue
      const st = String(r.status || "").toLowerCase()
      if (!st.startsWith("aprob")) continue // SOLO lo aprobado (fuera: rechazado, por descontar, lote alterno)
      if (String(r.location || "") === "AJUSTE-SIG") continue // remanente de ajustes (obsoleto)
      const tieneOC = !!(r.ocargue && String(r.ocargue).trim())
      // lote paralelo/alterno SIN orden de cargue: no es una salida real
      if (r.tipomov !== "Entrada" && (st.includes("altern") || st.includes("paralel") || has(r.origen, "altern") || has(r.origen, "paralel")) && !tieneOC) continue
      const k = `${r.idproducto}|${r.lote}`
      const c = Math.abs(Number(r.cantidad) || 0)
      book[k] = (book[k] || 0) + (r.tipomov === "Entrada" ? c : -c)
      if (r.nombreproducto) nombre[k] = r.nombreproducto
      loteDe[k] = String(r.lote ?? "")
    }
    const saldoLote: Record<string, number> = {}
    for (const r of saldosRows) {
      if (!incluir(r.idproducto)) continue
      const k = `${r.idproducto}|${r.lote}`
      saldoLote[k] = (saldoLote[k] || 0) + (Number(r.stock_actual) || 0)
      if (!nombre[k] && r.nombreproducto) nombre[k] = r.nombreproducto
      if (loteDe[k] === undefined) loteDe[k] = String(r.lote ?? "")
    }
    const loteMes = (lote: string): string | null => {
      const m = /^(\d{4})(\d{2})/.exec(String(lote || ""))
      return m && m[2] >= "01" && m[2] <= "12" ? `${m[1]}-${m[2]}` : null
    }
    const keys = new Set([...Object.keys(book), ...Object.keys(saldoLote)])
    let sobrante = 0
    let faltante = 0
    let lotesEvaluados = 0 // (producto|lote) con actividad — universo del ERI
    let lotesExactos = 0   // lotes cuyo libro cuadra EXACTO con el físico (d = 0)
    const difMes: Record<string, number> = {} // diferencia física atribuida por mes del lote
    const revisar: any[] = []
    for (const k of keys) {
      // El stock físico no puede ser negativo: un libro negativo (p.ej. reproceso
      // registrado sobre un lote ya en 0) es un artefacto → se pisa en 0, igual que la vista.
      const libroLote = Math.max(0, Math.round(book[k] || 0))
      const d = libroLote - Math.round(saldoLote[k] || 0)
      lotesEvaluados++
      if (d === 0) lotesExactos++
      if (d > 0) sobrante += d
      else faltante += d
      const lm = loteMes(loteDe[k] || "")
      if (lm) difMes[lm] = (difMes[lm] || 0) + d
      if (Math.abs(d) > 100) revisar.push({ producto: nombre[k] || "?", lote: loteDe[k] || "", libro: libroLote, saldo: Math.round(saldoLote[k] || 0), diferencia: d })
    }
    // ERI (Exactitud del Registro de Inventario) = lotes exactos / lotes evaluados.
    // Es la exactitud física estándar de la norma: automática por el cruce mensual.
    const eri = lotesEvaluados > 0 ? Math.round((lotesExactos / lotesEvaluados) * 1000) / 10 : 100
    revisar.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia))

    // Cierres guardados (acta + físico congelado). Se trae ANTES del roll
    // porque un mes con `fisico_congelado` reemplaza el ajuste lote-a-lote en
    // vivo (ver abajo) — necesario para que meses YA CERRADOS no seteen se
    // recalculen contra `saldoinvdetalle` de HOY (esa mezcla de fechas es la
    // causa de que el cuadre de un mes cerrado "se mueva" con la operación de
    // los días siguientes; confirmado 2026-08-08 con datos reales de ID3).
    let cierresPrevios: SigInventarioCierreMes[] = []
    try {
      const { data: cData } = await supabase
        .from("sig_inventario_cierre_mes")
        .select("*")
        .eq("proyecto_id", empresaId)
        .order("mes")
      cierresPrevios = (cData ?? []) as SigInventarioCierreMes[]
    } catch { /* tabla aún no creada */ }
    const cierrePorMes: Record<string, SigInventarioCierreMes> = {}
    for (const c of cierresPrevios) cierrePorMes[c.mes] = c

    // ============================================================
    // A) ROLL MENSUAL — cierre de un mes = inicial del siguiente.
    //    Apertura = Inventario Inicial (561). Reconoce la MERMA DE PROCESO
    //    (diferencia libro-vs-físico por lote, mesProc) para que el saldo
    //    conciliado cuadre EXACTO contra el stock vivo (la verdad física).
    //    Si el mes tiene `fisico_congelado` (acta cerrada con físico real
    //    capturado ESE día), se usa ese valor como saldoFinal en vez del
    //    ajuste lote-a-lote en vivo — el resto de meses (incl. el actual)
    //    sigue exactamente igual que antes.
    // ============================================================
    const meses = Object.values(map).sort((x: any, y: any) => x.mes.localeCompare(y.mes))
    let saldo = Math.round(invInicial)
    const filas = meses.map((a: any) => {
      const ingresos = a.produccion + a.devolucion
      // Los AJUSTES REALES de la app (701/702, transacción manual) SÍ entran
      // a la cadena del mes — son los únicos ajustes legítimos ("solo lo que
      // esté en la app", regla del cliente 2026-08-08). Antes quedaban fuera
      // del roll y aparecían como residuo falso en "Ajuste/Depuración".
      const ajusteReal = Math.round(a.ajuste || 0)
      const congelado = cierrePorMes[a.mes]?.fisico_congelado
      const saldoInicial = saldo
      let mermaProceso: number, reproceso: number, merma: number, salidas: number, saldoFinal: number
      if (congelado !== null && congelado !== undefined) {
        // Físico real de ese mes (capturado ese día) manda: se resuelve la
        // merma de proceso como residuo, igual que el plug del mes en curso
        // contra stock vivo (líneas más abajo), pero anclado al congelado.
        reproceso = Math.round(a.merma)
        saldoFinal = Math.round(congelado)
        salidas = Math.round(saldoInicial + ingresos + ajusteReal - saldoFinal)
        merma = salidas - Math.round(a.cargue)
        mermaProceso = merma - reproceso
      } else {
        mermaProceso = Math.round(difMes[a.mes] || 0) // cuadre físico del mes (por lote, en vivo)
        reproceso = Math.round(a.merma)               // reproceso/avería registrado (551)
        merma = reproceso + mermaProceso              // merma total = reproceso + cuadre
        salidas = a.cargue + merma
        saldoFinal = saldoInicial + ingresos + ajusteReal - salidas
      }
      saldo = saldoFinal
      return {
        mes: a.mes,
        saldoInicial: Math.round(saldoInicial),
        ingresos: Math.round(ingresos),
        recepcion: Math.round(a.produccion),
        produccion: Math.round(a.produccion),
        devolucion: Math.round(a.devolucion),
        cargue: Math.round(a.cargue),
        reproceso,
        mermaProceso,
        merma: Math.round(merma),
        salidas: Math.round(salidas),
        saldoFinal: Math.round(saldoFinal),
        faltante: 0,
        ajuste: Math.round(a.ajuste),
        documento_url: null as string | null,
        cierre_id: null as number | null,
        estadoCierre: null as string | null,
      }
    })
    // APERTURA DE MIGRACIÓN: si el PRIMER mes está congelado y quedó con
    // residuo, ese residuo es exactamente "lo que no se subió en la
    // migración" (regla del cliente) — se absorbe en la APERTURA del
    // periodo (inventario inicial efectivo), no como ajuste del mes. Solo si
    // la apertura resultante no queda negativa (guarda anti-imposibles).
    let invInicialEfectivo = Math.round(invInicial)
    let aperturaAjustada = false
    if (filas.length) {
      const f0 = filas[0]
      const congelado0 = cierrePorMes[f0.mes]?.fisico_congelado
      if (congelado0 !== null && congelado0 !== undefined && f0.mermaProceso !== 0) {
        const aperturaNecesaria = Math.round(invInicial - f0.mermaProceso)
        if (aperturaNecesaria >= 0) {
          const delta = f0.mermaProceso
          f0.saldoInicial = aperturaNecesaria
          f0.salidas -= delta
          f0.merma -= delta
          f0.mermaProceso = 0
          invInicialEfectivo = aperturaNecesaria
          aperturaAjustada = true
        }
      }
    }

    // Cuadre exacto contra el físico: el residual (lotes sin fecha, 702/otros,
    // redondeos) se lleva al último mes como merma de proceso → saldo final = stock vivo.
    if (filas.length) {
      const last = filas[filas.length - 1]
      const residual = Math.round(last.saldoFinal - stockActual)
      if (residual !== 0) {
        last.mermaProceso += residual
        last.merma += residual
        last.salidas += residual
        last.saldoFinal -= residual
      }
    }
    const saldoTeorico = filas.length ? filas[filas.length - 1].saldoFinal : Math.round(invInicial)
    const mermaProcesoTotal = filas.reduce((s: number, f: any) => s + (f.mermaProceso || 0), 0)
    // MERMA = lo enviado a reproceso / avería (tipomov 'Reproceso'). El cuadre
    // libro-vs-físico (mermaProceso) es depuración/ajuste, hoy ~0.
    const reprocesoTotal = filas.reduce((s: number, f: any) => s + (f.reproceso || 0), 0)
    // La tarjeta muestra la ACUMULACIÓN del MES EN CURSO (se cierra mes a mes).
    // Mes calendario de COLOMBIA (en UTC, de 7pm a medianoche del último día
    // del mes ya sería "el mes siguiente").
    const mesEnCurso = fechaColombiaDe(new Date().toISOString()).slice(0, 7)
    const filaMesEnCurso = filas.find((f: any) => f.mes === mesEnCurso) || (filas.length ? filas[filas.length - 1] : null)

    const resumen = {
      invInicial: invInicialEfectivo, // apertura efectiva (incluye lo no subido en la migración si aplicó)
      invInicial561: Math.round(invInicial), // lo digitado como 561 (referencia)
      aperturaAjustada, // true = la apertura absorbió la diferencia de migración
      saldoTeorico,                                        // = stock vivo tras conciliar
      saldoVivo: Math.round(stockActual),
      diferencia: Math.round(saldoTeorico - stockActual),  // ~0 tras conciliar
      reproceso: Math.round(reprocesoTotal),               // reproceso/avería acumulado del año (referencia)
      mermaMesEnCurso: Math.round(filaMesEnCurso?.reproceso || 0), // merma del mes en curso (tarjeta)
      mesMerma: filaMesEnCurso?.mes || null,
      mermaProceso: Math.round(mermaProcesoTotal),         // cuadre físico por lote / depuración (acumulado del año)
      ajusteMesEnCurso: Math.round(filaMesEnCurso?.mermaProceso || 0), // ajuste/depuración SOLO del mes en curso (tarjeta)
      sobranteKardex: Math.round(sobrante),
      faltanteKardex: Math.round(Math.abs(faltante)),
      lotesRevisar: revisar.length,
      lotesEvaluados,   // universo del ERI (lotes con actividad)
      lotesExactos,     // lotes que cuadran exacto libro-vs-físico
      eri,              // Exactitud del Registro de Inventario (%)
    }

    // `cierresPrevios`/`cierrePorMes` ya se trajeron ANTES del roll (arriba)
    // para poder aplicar el físico congelado; se reutilizan aquí solo para
    // anotar documento_url/cierre_id/estado en cada fila.
    const cierres = cierresPrevios
    for (const f of filas) {
      const c = cierrePorMes[f.mes]
      if (c) {
        f.documento_url = c.documento_url
        f.cierre_id = c.id
        f.estadoCierre = c.estado
      }
    }

    const anios = Array.from(aniosSet).sort().reverse()
    return { success: true, data: { filas, resumen, revisar: revisar.slice(0, 100), anios, anio: anio || anios[0] || null, stockActual: Math.round(stockActual), cierres } }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/** Persiste el cierre mensual tras generar/subir el acta PDF. */
export async function guardarCierreMesInventario(payload: {
  proyecto_id: number
  mes: string
  saldo_inicial: number
  ingresos: number
  cargue: number
  merma: number
  salidas: number
  saldo_final: number
  faltante: number
  ajuste: number
  produccion: number
  devolucion: number
  documento_url?: string | null
  cerrado_por?: string | null
  observaciones?: string | null
  firmante?: string | null
  firmante_cargo?: string | null
  firma_url?: string | null
  // Físico congelado (conteo real capturado ese día) — ver "Físico congelado al
  // cierre" en getConciliacionMensualInventario/getKardexInventario. Opcional:
  // sin esto, el mes se recalcula en vivo como siempre.
  fisico_congelado?: number | null
  fisico_snapshot?: Record<string, number> | null
}): Promise<{ success: boolean; data?: SigInventarioCierreMes; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const mesActual = fechaColombiaDe(new Date().toISOString()).slice(0, 7)
    const estado = payload.mes < mesActual ? "conciliado" : "pendiente"
    const fila: any = {
      proyecto_id: payload.proyecto_id,
      mes: payload.mes,
      estado,
      saldo_inicial: payload.saldo_inicial,
      ingresos: payload.ingresos,
      cargue: payload.cargue,
      merma: payload.merma,
      salidas: payload.salidas,
      saldo_final: payload.saldo_final,
      faltante: payload.faltante,
      ajuste: payload.ajuste,
      produccion: payload.produccion,
      devolucion: payload.devolucion,
      documento_url: payload.documento_url ?? null,
      cerrado_por: payload.cerrado_por ?? null,
      observaciones: payload.observaciones ?? null,
      updated_at: new Date().toISOString(),
    }
    if (payload.fisico_congelado != null) fila.fisico_congelado = payload.fisico_congelado
    if (payload.fisico_snapshot != null) fila.fisico_snapshot = payload.fisico_snapshot
    // Firma digital (opcional): nombre, cargo, imagen y fecha de firma.
    if (payload.firmante != null) fila.firmante = payload.firmante
    if (payload.firmante_cargo != null) fila.firmante_cargo = payload.firmante_cargo
    if (payload.firma_url != null) {
      fila.firma_url = payload.firma_url
      fila.fecha_firma = fechaColombiaDe(new Date().toISOString())
    }
    const { data, error } = await supabase
      .from("sig_inventario_cierre_mes")
      .upsert(fila, { onConflict: "proyecto_id,mes" })
      .select("*")
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, data: data as SigInventarioCierreMes }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// ---------------------------------------------------------------------------
// Acta de Cruce de Inventario (apertura de mes, congelado real). Tabla
// dedicada y separada del Cuadre mensual (decisión del cliente 2026-08-08):
// deja constancia, POR LOTE Y UBICACIÓN (el nivel relevante para poder
// corregir y donde vive la trazabilidad real), del inventario con el que
// ABRE un mes (hoy agosto/2026) — stock vivo de hoy retrocedido por los
// movimientos aprobados desde el corte, LOTE POR LOTE (sin repartir/escalar
// un total inventado: el kardex ya lleva trazabilidad real por lote mes a
// mes). El agregado por producto que usa el Kardex/actas de cierre
// (`sig_inventario_cierre_mes.fisico_snapshot`) se recalcula desde esta
// suma real de lotes al crear el cruce, quedando sincronizado con ella. Esta
// tabla ALIMENTA y puede AJUSTAR invtrans (y por lo tanto todas las tablas
// de inventario que dependen de él): las correcciones NO se editan aquí
// directo, pasan por `sig_inventario_ajuste` (el ÚNICO formulario
// sancionado para mover inventario, mismo que usa "Cuadre y Correcciones" —
// regla firme del proyecto: "un solo formulario para mover/ajustar
// inventario, no dos") y quedan enlazadas aquí (`invtrans_id`) como
// evidencia de la corrección.
// ---------------------------------------------------------------------------

function mesAnteriorDe(mes: string): string {
  const [y, m] = mes.split("-").map(Number)
  const d = new Date(y, m - 1, 1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

// `invtrans.creado` se guarda en UTC. Colombia es UTC-5: una transacción
// registrada a las 8pm del 31-jul (hora Colombia) queda como "2026-08-01"
// en UTC. Comparar por el string crudo de `creado` clasifica mal esas
// transacciones como "del día del corte" cuando en realidad son del día
// anterior — causó un hueco real en la Acta de Cruce de ID2 (confirmado
// con datos reales 2026-08-08). Toda comparación de fecha-calendario contra
// el corte debe pasar por esta función, no por `String(creado).slice(0,10)`.
function fechaColombiaDe(iso: string): string {
  if (!iso) return ""
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
}

// ---------------------------------------------------------------------------
// Stock por (producto, lote, ubicación) retrocedido hasta un CORTE dado
// ('YYYY-MM-DD', hora Colombia) — misma lógica exacta que ya usaba
// getOrCrearActaCruce (extraída aquí para reutilizarla también en
// crearCuadre: un "Conteo total" de cierre de mes necesita el mismo
// congelado del día anterior, no el stock vivo del momento en que se crea
// — si ya se movió algo del día en curso antes de crear el conteo, ese
// movimiento no debe mezclarse con lo que se va a comparar contra el
// físico. El conteo cíclico SÍ sigue usando stock vivo — es otro caso de
// uso (verificación puntual, no cierre de mes) — ver crearCuadre.
// ---------------------------------------------------------------------------
export async function calcularStockAlCorte(
  supabase: any,
  proyectoId: number,
  corte: string, // 'YYYY-MM-DD' — primer día SIN incluir (el corte retrocede hasta el final del día anterior)
): Promise<{
  porLote: Record<string, { codproducto: string; producto: string; lote: string; location: string; valor: number }>
  nombrePorCod: Record<string, string>
}> {
  // Stock vivo de HOY, por (producto, lote, ubicación).
  // PAGINACIÓN CON ORDEN EXPLÍCITO: sin ORDER BY, las páginas de .range()
  // pueden duplicar/saltar filas entre corridas (no determinista) —
  // detectado con datos reales 2026-08-08.
  const stockHoy: Record<string, { codproducto: string; producto: string; lote: string; location: string; valor: number }> = {}
  const nombrePorCod: Record<string, string> = {}
  let from = 0
  while (true) {
    const { data } = await supabase
      .from("saldoinvdetalle")
      .select("codproducto,nombreproducto,lote,location,stock_actual")
      .eq("idempresa", proyectoId)
      .order("codproducto", { ascending: true })
      .order("lote", { ascending: true })
      .order("location", { ascending: true })
      .range(from, from + 999)
    for (const r of data ?? []) {
      const lote = r.lote ?? ""
      const location = r.location ?? ""
      const key = `${r.codproducto}||${lote}||${location}`
      if (!stockHoy[key]) stockHoy[key] = { codproducto: r.codproducto, producto: r.nombreproducto ?? "", lote, location, valor: 0 }
      stockHoy[key].valor += Number(r.stock_actual) || 0
      if (r.nombreproducto && !nombrePorCod[r.codproducto]) nombrePorCod[r.codproducto] = r.nombreproducto
    }
    if (!data || data.length < 1000) break
    from += 1000
    if (from > 60000) break
  }

  // Movimientos APROBADOS desde el corte (a retroceder). El día del corte es
  // el propio inventario físico ("a primera hora"): una ENTRADA fechada ese
  // mismo día (HORA COLOMBIA) es el registro en sistema de algo que ya
  // existía al corte — se trata como apertura, no se retrocede. Una SALIDA
  // siempre es movimiento real. Se trae con 1 día de margen (UTC) por huso
  // horario y se filtra la fecha real en JS con fechaColombiaDe.
  const corteConsulta = new Date(`${corte}T00:00:00Z`)
  corteConsulta.setUTCDate(corteConsulta.getUTCDate() - 1)
  const deltaCorte: Record<string, number> = {}
  let from2 = 0
  while (true) {
    const { data } = await supabase
      .from("invtrans")
      .select("id,codproducto,lote,location,tipomov,cantidad,status,creado")
      .eq("idempresa", proyectoId)
      .gte("creado", corteConsulta.toISOString())
      .order("id", { ascending: true }) // paginación determinista
      .range(from2, from2 + 999)
    for (const r of data ?? []) {
      if (!String(r.status || "").toLowerCase().startsWith("aprob")) continue
      const fechaLocal = fechaColombiaDe(r.creado)
      if (fechaLocal < corte) continue // cayó en el margen de 1 día, es anterior al corte real
      const esEntradaDelDiaDelCorte = r.tipomov === "Entrada" && fechaLocal === corte
      if (esEntradaDelDiaDelCorte) continue
      const key = `${r.codproducto}||${r.lote ?? ""}||${r.location ?? ""}`
      const c = Math.abs(Number(r.cantidad) || 0)
      deltaCorte[key] = (deltaCorte[key] || 0) + (r.tipomov === "Entrada" ? c : -c)
    }
    if (!data || data.length < 1000) break
    from2 += 1000
    if (from2 > 60000) break
  }

  // Valor real por lote: stock vivo de hoy retrocedido por lo movido desde
  // el corte. SIN inventar — nada de repartir/escalar un total a los lotes.
  // Se pisa en 0 si da negativo (el físico no puede ser negativo).
  const keys = new Set([...Object.keys(stockHoy), ...Object.keys(deltaCorte)])
  const porLote: Record<string, { codproducto: string; producto: string; lote: string; location: string; valor: number }> = {}
  for (const key of keys) {
    const [cod, lote, location] = key.split("||")
    const base = stockHoy[key]?.valor ?? 0
    const valor = Math.max(0, Math.round((base - (deltaCorte[key] || 0)) * 100) / 100)
    porLote[key] = { codproducto: stockHoy[key]?.codproducto ?? cod, producto: stockHoy[key]?.producto || nombrePorCod[cod] || "", lote, location, valor }
  }
  return { porLote, nombrePorCod }
}

/** Trae el acta de cruce del mes; si no existe, la crea (por lote/ubicación) desde el físico congelado del mes anterior. */
export async function getOrCrearActaCruce(
  proyectoId: number,
  mes: string, // '2026-08' — mes que ABRE con este cruce
): Promise<{ success: boolean; acta?: SigInventarioActaCruce; detalle?: SigInventarioActaCruceDetalle[]; error?: string }> {
  try {
    if (!proyectoId) return { success: false, error: "Selecciona un cliente/sitio" }
    const supabase: any = await getSupabaseAdmin()
    const { data: existente } = await supabase
      .from("sig_inventario_acta_cruce")
      .select("*")
      .eq("proyecto_id", proyectoId)
      .eq("mes", mes)
      .maybeSingle()

    if (existente) {
      const { data: det } = await supabase
        .from("sig_inventario_acta_cruce_detalle")
        .select("*")
        .eq("acta_id", existente.id)
        .order("producto", { ascending: true })
        .order("lote", { ascending: true })
      return { success: true, acta: existente as SigInventarioActaCruce, detalle: (det ?? []) as SigInventarioActaCruceDetalle[] }
    }

    // No existe: se crea desde el físico congelado del mes ANTERIOR (su
    // cierre = la apertura de `mes`). Sin congelado, no hay cruce que armar.
    const mesAnterior = mesAnteriorDe(mes)
    const { data: cierre } = await supabase
      .from("sig_inventario_cierre_mes")
      .select("id, fisico_snapshot, fisico_congelado, cerrado_por")
      .eq("proyecto_id", proyectoId)
      .eq("mes", mesAnterior)
      .maybeSingle()
    const aggregadoVerificado: Record<string, number> = cierre?.fisico_snapshot ?? {}
    if (!Object.keys(aggregadoVerificado).length) {
      return { success: false, error: `No hay físico congelado de ${mesAnterior} para este proyecto todavía.` }
    }
    // "sin archivo físico externo" (ID1/ID2/ID4 calculados) contiene la
    // palabra "archivo" — se descarta explícitamente antes de buscarla.
    const cerradoPorTxt = String(cierre?.cerrado_por || "")
    const origen = !/sin archivo/i.test(cerradoPorTxt) && /archivo/i.test(cerradoPorTxt) ? "archivo_fisico" : "calculado"
    const corte = `${mes}-01`

    // Stock retrocedido al corte, por (producto, lote, ubicación) — mismo
    // helper que usa crearCuadre para el "Conteo total" de cierre de mes.
    const { porLote, nombrePorCod } = await calcularStockAlCorte(supabase, proyectoId, corte)

    const { data: nueva, error: errIns } = await supabase
      .from("sig_inventario_acta_cruce")
      .insert({ proyecto_id: proyectoId, mes, fecha_corte: corte, origen, estado: "borrador" })
      .select("*")
      .single()
    if (errIns) return { success: false, error: errIns.message }

    const filas = Object.entries(porLote)
      .map(([key, info]) => {
        const [cod, lote, location] = key.split("||")
        return {
          acta_id: nueva.id,
          codproducto: info.codproducto ?? cod,
          producto: info.producto || nombrePorCod[cod] || null,
          lote: lote || "",
          location: location || "",
          sistema_original: info.valor,
          fisico_actual: info.valor,
          diferencia: 0,
        }
      })
      .filter((f) => f.sistema_original !== 0) // sin actividad ni saldo — no hay nada que cruzar en ese lote

    // Cuando hay archivo físico real, ESE total por producto manda (ya
    // verificado — no se recalcula ni se pisa). El desglose por lote es la
    // mejor referencia posible desde el kardex; si no cuadra exacto con el
    // archivo, la diferencia queda como una línea aparte, VISIBLE ("(sin
    // ubicar por lote)") — nunca repartida/escalada entre los lotes reales
    // (eso ya se probó y el cliente lo rechazó explícitamente).
    if (origen === "archivo_fisico") {
      const agregadoCalculado: Record<string, number> = {}
      for (const f of filas) agregadoCalculado[f.codproducto] = Math.round(((agregadoCalculado[f.codproducto] ?? 0) + f.sistema_original) * 100) / 100
      for (const cod of Object.keys(aggregadoVerificado)) {
        const verificado = Math.round((Number(aggregadoVerificado[cod]) || 0) * 100) / 100
        const calculado = agregadoCalculado[cod] ?? 0
        const gap = Math.round((verificado - calculado) * 100) / 100
        if (gap !== 0) {
          filas.push({
            acta_id: nueva.id,
            codproducto: cod,
            producto: nombrePorCod[cod] || null,
            lote: "(archivo real, sin ubicar por lote)",
            location: "(sin ubicar)",
            sistema_original: gap,
            fisico_actual: gap,
            diferencia: 0,
          })
        }
      }
    }

    for (let i = 0; i < filas.length; i += 500) {
      const { error: errDet } = await supabase.from("sig_inventario_acta_cruce_detalle").insert(filas.slice(i, i + 500))
      if (errDet) return { success: false, error: errDet.message }
    }

    // El agregado por producto (suma real de sus lotes, ya reconciliada
    // contra el archivo cuando existe) reemplaza el que tenía el acta de
    // cierre del mes anterior — la trazabilidad por lote manda, la cifra del
    // cierre queda sincronizada con ella (pedido del cliente: "esto también
    // debe estar en las actas de cierre"). Con archivo real, el total no
    // cambia (la línea "sin ubicar" ya lo compensa) — se re-escribe igual
    // para mantener limpio el mismo mecanismo en ambos casos.
    const agregadoPorProducto: Record<string, number> = {}
    for (const f of filas) agregadoPorProducto[f.codproducto] = Math.round(((agregadoPorProducto[f.codproducto] ?? 0) + f.sistema_original) * 100) / 100
    // `fisico_congelado` (el TOTAL) es lo que lee getConciliacionMensualInventario
    // para "saldoFinal"/"Ajuste y depuración" — si solo se actualiza
    // fisico_snapshot (el detalle por producto) sin este total, Conciliación
    // Mensual sigue mostrando el ajuste viejo aunque el detalle ya esté
    // corregido (bug real encontrado 2026-08-08 con datos de ID2). Con
    // archivo real (ID3), el total NUNCA se toca — es el verificado; solo se
    // recalcula para proyectos calculados (sin archivo externo que proteger).
    const totalCongelado =
      origen === "archivo_fisico"
        ? Number(cierre?.fisico_congelado) || 0
        : Math.round(Object.values(agregadoPorProducto).reduce((s, v) => s + v, 0) * 100) / 100
    const cierreId = cierre?.id
    if (cierreId) {
      await supabase
        .from("sig_inventario_cierre_mes")
        .update({ fisico_snapshot: agregadoPorProducto, fisico_congelado: totalCongelado, updated_at: new Date().toISOString() })
        .eq("id", cierreId)
    }

    return { success: true, acta: nueva as SigInventarioActaCruce, detalle: filas as any }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function getActaCruceDetalle(
  actaId: number,
): Promise<{ success: boolean; data: SigInventarioActaCruceDetalle[]; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("sig_inventario_acta_cruce_detalle")
      .select("*")
      .eq("acta_id", actaId)
      .order("producto", { ascending: true })
      .order("lote", { ascending: true })
    if (error) return { success: false, data: [], error: error.message }
    return { success: true, data: (data ?? []) as SigInventarioActaCruceDetalle[] }
  } catch (err: any) {
    return { success: false, data: [], error: err?.message || "Error desconocido" }
  }
}

/**
 * Corrige UNA línea (producto+lote+ubicación) del acta de cruce. NO edita el
 * valor directo: registra y aprueba una corrección real por el ÚNICO camino
 * sancionado (`registrarAjusteInventario` → `aprobarAjusteInventario` →
 * invtrans, mismo mecanismo del Cuadre mensual), y deja la línea del acta
 * como evidencia (fisico_actual/diferencia/invtrans_id). También recalcula
 * el agregado del producto (suma de TODOS sus lotes en esta acta) y lo
 * actualiza en `fisico_snapshot` para que el Kardex
 * (getKardexInventario/getMovimientosProducto) siga vigente.
 */
export async function corregirLineaActaCruce(
  detalleId: number,
  payload: { nuevoValor: number; location?: string | null; lote?: string | null; motivo: string; actor: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data: det } = await supabase
      .from("sig_inventario_acta_cruce_detalle")
      .select("*, sig_inventario_acta_cruce(proyecto_id, mes)")
      .eq("id", detalleId)
      .single()
    if (!det) return { success: false, error: "Línea no encontrada" }
    const acta = det.sig_inventario_acta_cruce
    if (!acta) return { success: false, error: "Acta no encontrada" }

    const location = (payload.location?.trim() || det.location || "").trim()
    if (!location) return { success: false, error: "Indica la ubicación donde queda la corrección" }
    const lote = (payload.lote?.trim() || det.lote || "").trim() || null

    const diferencia = Math.round((Number(payload.nuevoValor) - Number(det.sistema_original)) * 100) / 100
    if (diferencia === 0) return { success: false, error: "El valor no cambió — nada que corregir" }

    // 1) Registra la corrección por el formulario sancionado.
    const direccion = diferencia < 0 ? "salida" : "ingreso"
    const reg = await registrarAjusteInventario(acta.proyecto_id, {
      fecha: fechaColombiaDe(new Date().toISOString()),
      codproducto: det.codproducto,
      producto: det.producto,
      location,
      lote,
      direccion,
      cantidad: Math.abs(diferencia),
      tipo: "correccion",
      motivo: `Acta de Cruce ${acta.mes} — ${payload.motivo}`.trim(),
      responsable: payload.actor,
    })
    if (!reg.success || !reg.id) return { success: false, error: reg.error || "No se pudo registrar la corrección" }

    // 2) Aprueba de inmediato (postea a invtrans, mueve el stock real).
    const r = await aprobarAjusteInventario(reg.id, payload.actor)
    if (!r.success) return { success: false, error: r.error }

    // 3) Deja la línea del acta como evidencia.
    const { error: errUpd } = await supabase
      .from("sig_inventario_acta_cruce_detalle")
      .update({
        fisico_actual: payload.nuevoValor,
        diferencia,
        corregido: true,
        motivo_correccion: payload.motivo,
        invtrans_id: r.invtransId ?? null,
        corregido_por: payload.actor,
        corregido_fecha: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", detalleId)
    if (errUpd) return { success: false, error: errUpd.message }

    // 4) Recalcula el agregado del producto (todos sus lotes en esta acta) y
    // mantiene el ancla del Kardex al día.
    const { data: filasProducto } = await supabase
      .from("sig_inventario_acta_cruce_detalle")
      .select("fisico_actual")
      .eq("acta_id", acta.id)
      .eq("codproducto", det.codproducto)
    const nuevoAgregado = (filasProducto ?? []).reduce((s: number, f: any) => s + (Number(f.fisico_actual) || 0), 0)

    const { data: cierre } = await supabase
      .from("sig_inventario_cierre_mes")
      .select("id, fisico_snapshot, fisico_congelado")
      .eq("proyecto_id", acta.proyecto_id)
      .eq("mes", mesAnteriorDe(acta.mes))
      .maybeSingle()
    if (cierre) {
      const snap = { ...(cierre.fisico_snapshot ?? {}) }
      const anterior = Number(snap[det.codproducto]) || 0
      snap[det.codproducto] = Math.round(nuevoAgregado * 100) / 100
      // El TOTAL también se ajusta por la misma diferencia — es el que lee
      // getConciliacionMensualInventario (Ajuste y depuración).
      const totalNuevo = Math.round(((Number(cierre.fisico_congelado) || 0) - anterior + snap[det.codproducto]) * 100) / 100
      await supabase.from("sig_inventario_cierre_mes").update({ fisico_snapshot: snap, fisico_congelado: totalNuevo, updated_at: new Date().toISOString() }).eq("id", cierre.id)
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

export async function firmarActaCruce(
  actaId: number,
  payload: { firmante: string; firmante_cargo?: string | null; firma_url?: string | null; observaciones?: string | null },
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase
      .from("sig_inventario_acta_cruce")
      .update({
        estado: "firmado",
        firmante: payload.firmante,
        firmante_cargo: payload.firmante_cargo ?? null,
        firma_url: payload.firma_url ?? null,
        fecha_firma: fechaColombiaDe(new Date().toISOString()),
        observaciones: payload.observaciones ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", actaId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Conciliación PEDIDOS (cargados) vs SALIDAS (invtrans) — lee la vista
 * v_pedidos_vs_salidas (script 47) y arma resumen + filas ordenadas
 * (discrepancias primero). Detecta pedidos sin salida, salidas sin pedido
 * y cantidades distintas. Todo el histórico del proyecto (sin filtro de mes).
 */
export async function getConciliacionPedidosVsSalidas(
  empresaId?: number | null,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    if (!empresaId) {
      return { success: false, error: "Seleccione un cliente/sitio en el selector global (un proyecto a la vez)." }
    }
    const supabase: any = await getSupabaseAdmin()

    const filas: any[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from("v_pedidos_vs_salidas")
        .select("idempresa, idempresa_pedido, idempresa_salida, empresa_distinta, ocargue, producto, ped_unidades, ped_cargadas, salida_qty, diferencia, pendiente_despacho, pedido_cerrado, estado_pedido, salida_con_lote, estado_alerta")
        .eq("idempresa", empresaId)
        // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
        .order("ocargue")
        .order("producto")
        .order("idempresa_pedido")
        .order("idempresa_salida")
        .range(from, from + 999)
      if (error) return { success: false, error: error.message }
      filas.push(...(data ?? []))
      if (!data || data.length < 1000) break
      from += 1000
      if (from > 100000) break
    }

    // Se EXCLUYEN del análisis los "pedidos sin salida" y las "salidas sin pedido":
    // son artefactos del MONTAJE inicial de la información (no discrepancias reales de
    // inventario) y no deben afectar la conciliación ni sus totales (cargadas/salidas/
    // diferencia neta). La única discrepancia real sigue siendo CANTIDAD_DIFERENTE.
    const filasAnalizadas = filas.filter(
      (f: any) => f.estado_alerta !== "PEDIDO_SIN_SALIDA" && f.estado_alerta !== "SALIDA_SIN_PEDIDO",
    )

    const resumen = {
      total: filasAnalizadas.length,
      ok: 0,
      cantidadDiferente: 0,
      pedidoSinSalida: 0,
      salidaSinPedido: 0,
      pendienteDespacho: 0,
      totalCargadas: 0,
      totalSalidas: 0,
      diferenciaNeta: 0,
      conAlerta: 0,
      empresaDistinta: 0,
    }
    for (const f of filasAnalizadas) {
      resumen.totalCargadas += Number(f.ped_cargadas) || 0
      resumen.totalSalidas += Number(f.salida_qty) || 0
      resumen.diferenciaNeta += Number(f.diferencia) || 0
      if (f.empresa_distinta) resumen.empresaDistinta++
      switch (f.estado_alerta) {
        case "OK": resumen.ok++; break
        case "CANTIDAD_DIFERENTE": resumen.cantidadDiferente++; break
        case "PEDIDO_SIN_SALIDA": resumen.pedidoSinSalida++; break
        case "SALIDA_SIN_PEDIDO": resumen.salidaSinPedido++; break
        case "PENDIENTE_DESPACHO": resumen.pendienteDespacho++; break
      }
    }
    // ÚNICA discrepancia real de inventario = CANTIDAD_DIFERENTE (lo cargado ≠ lo
    // que salió del inventario). Lo demás es informativo:
    //   - PEDIDO_SIN_SALIDA  = pedido con cargue pero sin salida aprobada → el
    //     producto NO ha salido, el inventario está intacto → por ejecutar/despachar.
    //   - SALIDA_SIN_PEDIDO  = salió con proceso completo; el pedido fue borrado.
    //   - PENDIENTE_DESPACHO = parcial aún por despachar.
    resumen.conAlerta = resumen.cantidadDiferente
    resumen.totalCargadas = Math.round(resumen.totalCargadas)
    resumen.totalSalidas = Math.round(resumen.totalSalidas)
    resumen.diferenciaNeta = Math.round(resumen.diferenciaNeta)

    // Discrepancias primero; dentro, por magnitud de diferencia.
    const orden: Record<string, number> = { CANTIDAD_DIFERENTE: 0, PENDIENTE_DESPACHO: 1, OK: 2 }
    filasAnalizadas.sort((a, b) => {
      const oa = orden[a.estado_alerta] ?? 9
      const ob = orden[b.estado_alerta] ?? 9
      if (oa !== ob) return oa - ob
      return Math.abs(Number(b.diferencia) || 0) - Math.abs(Number(a.diferencia) || 0)
    })

    return { success: true, data: { filas: filasAnalizadas, resumen } }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Auditoría directa de una orden de cargue: trae las filas CRUDAS de
 * pedidosdetalle (con estado de cabecera) e invtrans para ese ocargue,
 * en TODAS las empresas (el cruce ignora empresa). Sirve para investigar
 * una discrepancia lote/línea por lote/línea.
 */
export async function getAuditoriaOrdenPedidoSalida(
  ocargue?: string | null,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const oc = String(ocargue || "").trim()
    if (!oc) return { success: false, error: "Falta la orden de cargue." }
    const supabase: any = await getSupabaseAdmin()

    const [pedRes, itRes] = await Promise.all([
      supabase
        .from("pedidosdetalle")
        .select("idpedido, transid, id_empresa, producto, unidades, unidadescargadas, unidades_cargadas, estado, ocargue")
        .eq("ocargue", oc),
      supabase
        .from("invtrans")
        .select("id, idempresa, nombreproducto, codproducto, lote, cantidad, tipomov, status, origen, location, cod_movimiento, creado")
        .eq("ocargue", oc)
        .order("creado", { ascending: true }),
    ])
    if (pedRes.error) return { success: false, error: pedRes.error.message }
    if (itRes.error) return { success: false, error: itRes.error.message }

    const pedidos = (pedRes.data ?? []).map((r: any) => ({
      ...r,
      cargadas: Number(r.unidadescargadas ?? r.unidades_cargadas ?? 0) || 0,
    }))

    // Estado de cabecera para cada pedido (para ver anulados/estado global).
    const idped = Array.from(new Set(pedidos.map((p: any) => p.idpedido).filter((x: any) => x != null)))
    const cabEstado: Record<number, string> = {}
    if (idped.length) {
      const { data: cab } = await supabase.from("pedidoscabecera").select("idpedido, estado, cliente").in("idpedido", idped)
      for (const c of cab ?? []) cabEstado[c.idpedido] = c.estado
    }
    for (const p of pedidos) (p as any).estado_cabecera = cabEstado[p.idpedido] ?? null

    const salidas = (itRes.data ?? []).filter((r: any) => r.tipomov === "Salida")
    const otras = (itRes.data ?? []).filter((r: any) => r.tipomov !== "Salida")

    return { success: true, data: { ocargue: oc, pedidos, salidas, otras } }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

/**
 * Cuadre manual: actualiza cantidades del PEDIDO en la fuente (pedidosdetalle)
 * para conciliar una orden. SOLO toca pedidosdetalle (unidades / unidadescargadas),
 * que es dato comercial y NO afecta el físico (saldoinvdetalle).
 *
 * IMPORTANTE: por decisión del negocio, este módulo NO modifica invtrans ni el
 * inventario de ningún proyecto. Las salidas son de solo lectura.
 */
export async function guardarCuadreManualPedidoSalida(payload: {
  pedidos?: { transid: number; cargadas?: number; unidades?: number }[]
  actor?: string | null
}): Promise<{ success: boolean; error?: string; data?: { pedidos: number } }> {
  try {
    const supabase: any = await getSupabaseAdmin()
    let pOk = 0

    for (const p of payload.pedidos ?? []) {
      if (p == null || p.transid == null) continue
      const upd: any = {}
      if (Number.isFinite(p.cargadas as any) && (p.cargadas as number) >= 0) upd.unidadescargadas = Math.round(p.cargadas as number)
      if (Number.isFinite(p.unidades as any) && (p.unidades as number) >= 0) upd.unidades = Math.round(p.unidades as number)
      if (Object.keys(upd).length === 0) continue
      const { error } = await supabase
        .from("pedidosdetalle")
        .update(upd)
        .eq("transid", p.transid)
      if (error) return { success: false, error: `Pedido transid ${p.transid}: ${error.message}` }
      pOk++
    }

    return { success: true, data: { pedidos: pOk } }
  } catch (err: any) {
    return { success: false, error: err?.message || "Error desconocido" }
  }
}

// =====================================================================
// SERIE HISTÓRICA DE INDICADORES DEL BSC (para la tendencia del viewer)
// =====================================================================

// Congela (snapshot) el valor de TODOS los indicadores del BSC para un mes,
// calculándolos con getIndicadoresValores sobre el rango de ese mes. Idempotente
// (upsert por idempresa+codigo+periodo). Pensado para correr al cierre de cada mes
// (cron) o para backfill de meses ya transcurridos.
export async function snapshotIndicadoresHistorico(
  anio: number,
  mes: number,
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const mm = String(mes).padStart(2, "0")
    const desde = `${anio}-${mm}-01`
    const hasta = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10) // último día del mes
    // null → consolida los proyectos/clientes [1,2,3,4] (BSC de LIP), igual que la
    // portada. Con 100 no hay datos operativos (cargues/asistencia viven en 1-4).
    const r = await getIndicadoresValores(null, desde, hasta)
    if (!r.success) return { success: false, count: 0, error: r.error }
    const periodo = `${anio}-${mm}`
    const rows = Object.entries(r.valores).map(([codigo, v]) => ({
      idempresa: 100,
      codigo,
      periodo,
      valor: Number.isFinite(v.valor) ? v.valor : null,
      base: v.base ?? null,
    }))
    if (rows.length === 0) return { success: true, count: 0 }
    const supabase: any = await getSupabaseAdmin()
    const { error } = await supabase
      .from("indicador_historico")
      .upsert(rows, { onConflict: "idempresa,codigo,periodo" })
    if (error) return { success: false, count: 0, error: error.message }
    return { success: true, count: rows.length }
  } catch (err: any) {
    return { success: false, count: 0, error: err?.message || "Error" }
  }
}

// Ficha (de sig_indicadores) + serie mensual (de indicador_historico) de UN
// indicador del BSC, para alimentar el viewer 3D genérico.
export async function getBscIndicadorDetalle(
  codigo: string,
  anio: string,
): Promise<{
  ficha: {
    nombre: string | null
    formula: string | null
    fuente: string | null
    periodicidad: string | null
    responsable: string | null
    interpretacion: string | null
    unidad: string | null
    meta: number | null
    sentido: "menor" | "mayor"
    area: string | null
  } | null
  serie: { etiqueta: string; valor: number | null }[]
}> {
  const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
  try {
    const supabase: any = await getSupabaseAdmin()
    const { data: sig } = await supabase
      .from("sig_indicadores")
      .select("nombre, formula, fuente, frecuencia, responsable, finalidad, unidad, meta, sentido, area")
      .eq("idempresa", 100)
      .eq("calculo_auto", codigo)
      .maybeSingle()
    const { data: hist } = await supabase
      .from("indicador_historico")
      .select("periodo, valor")
      .eq("idempresa", 100)
      .eq("codigo", codigo)
      .like("periodo", `${anio}-%`)
    const mens: (number | null)[] = Array(12).fill(null)
    for (const h of hist ?? []) {
      const m = String(h.periodo).match(new RegExp(`^${anio}-(\\d{2})$`))
      if (m) mens[Number(m[1]) - 1] = h.valor
    }
    const ficha = sig
      ? {
          nombre: sig.nombre ?? null,
          formula: sig.formula ?? null,
          fuente: sig.fuente ?? null,
          periodicidad: sig.frecuencia ?? null,
          responsable: sig.responsable ?? null,
          interpretacion: sig.finalidad ?? null,
          unidad: sig.unidad ?? null,
          meta: sig.meta ?? null,
          sentido: (String(sig.sentido || "").startsWith("mayor") ? "mayor" : "menor") as "menor" | "mayor",
          area: sig.area ?? null,
        }
      : null
    return { ficha, serie: MESES.map((m, i) => ({ etiqueta: m, valor: mens[i] })) }
  } catch {
    return { ficha: null, serie: [] }
  }
}
