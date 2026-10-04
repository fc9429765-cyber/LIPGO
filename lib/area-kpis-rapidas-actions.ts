"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentEmpresaIdForInsert } from "@/lib/user-context"
import { AREA_KPI_TITULOS, type AreaKpiItem, type AreaKpiVariant } from "@/lib/area-kpis-util"
import { KPI_DEFS, formatKpi, kpiSev, kpiIcon, kpisParaModulo } from "@/lib/kpis-area"
import { getIndicadoresValores } from "@/lib/sig-actions"
import { codigosOrdenPorUnidad } from "@/lib/ordenes-por-unidad"

// Tira de INDICADORES del BSC por módulo/submódulo (valor real + meta + semáforo):
// el módulo madre muestra sus indicadores GERENCIALES; cada submódulo el indicador
// del ÁREA que alimenta. Fuente de valores: getIndicadoresValores (BSC, cacheado).
// El ícono es una CLAVE (string) que el cliente mapea a lucide. Algunos submódulos
// de Gestión Humana conservan su tira propia (resumen operativo) en getSubmoduloKpis.

function hoyBogota(): string {
  const b = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }))
  return `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, "0")}-${String(b.getDate()).padStart(2, "0")}`
}

const MESES_KPI = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

// Último día REAL del mes (28-31). Nunca usar día 31 fijo: para meses cortos
// (feb/abr/jun/sep/nov) genera fechas inexistentes ('2026-04-31') que Postgres
// rechaza contra columnas `date` → la consulta falla y los KPIs quedan en 0.
function finDeMes(anio: string | number, mes: number): string {
  const last = new Date(Number(anio), mes, 0).getDate() // día 0 del mes+1 = último del mes
  return `${anio}-${String(mes).padStart(2, "0")}-${String(last).padStart(2, "0")}`
}

export async function getAreaKpisRapidas(
  groupKey: string,
  selectedEmpresaId?: number | null,
  userId?: string,
  moduleName?: string | null,
  anioFiltro?: string | null,
  mesFiltro?: string | null,
  desdeFiltro?: string | null,
  hastaFiltro?: string | null,
): Promise<{ items: AreaKpiItem[]; titulo?: string }> {
  const sb: any = await getSupabaseAdmin()
  const empresaId = selectedEmpresaId || (await getCurrentEmpresaIdForInsert())
  if (!empresaId || !AREA_KPI_TITULOS[groupKey]) return { items: [] }

  // --- KPIs propios del SUBMÓDULO (no la tira general del área madre) ---------
  // Cada submódulo muestra SUS datos (según los SLA del BSC del módulo). La tira
  // general del grupo se conserva para la portada del módulo madre. Si el
  // submódulo actual tiene tira propia, se resuelve y se devuelve aquí.
  const subKpis = await getSubmoduloKpis(sb, moduleName, empresaId, anioFiltro, mesFiltro, desdeFiltro, hastaFiltro)
  if (subKpis) return subKpis

  // Indicadores del BSC para este módulo/submódulo. El módulo madre muestra sus
  // indicadores gerenciales (AREA_KPIS[grupo]); si es un submódulo con mapeo
  // propio, sus indicadores de área. Config pura en kpis-area.ts.
  const keys = kpisParaModulo(groupKey, moduleName)
  if (!keys.length) return { items: [] }

  // Alcance: SST y SIG/Certificaciones son TRANSVERSALES a LIP → agregado LIP
  // (proyectoId = null). El resto reacciona al proyecto/empresa seleccionado.
  const scope = groupKey === "sst" || groupKey === "certificaciones_lip" ? null : (empresaId as number)

  // Período (alineado con la portada del área, AreaKpis → monthRange):
  //  - filtro de MES explícito (p. ej. Ausentismos) → ese mes.
  //  - filtro de AÑO explícito sin mes → todo el año.
  //  - sin filtro → MES EN CURSO (para que los números coincidan con la portada).
  const hoy = hoyBogota()
  const anio = anioFiltro && anioFiltro !== "todos" ? anioFiltro : hoy.slice(0, 4)
  const mesN = mesFiltro ? MESES_KPI.indexOf(mesFiltro) + 1 : 0
  let desde: string
  let hasta: string
  if (mesN >= 1) {
    desde = `${anio}-${String(mesN).padStart(2, "0")}-01`
    hasta = finDeMes(anio, mesN)
  } else if (anioFiltro && anioFiltro !== "todos") {
    desde = `${anio}-01-01`
    hasta = `${anio}-12-31`
  } else {
    desde = `${anio}-${hoy.slice(5, 7)}-01`
    hasta = hoy
  }

  let valores: Record<string, { valor: number; base?: string }> = {}
  try {
    const r: any = await getIndicadoresValores(scope, desde, hasta)
    if (r?.success && r.valores) valores = r.valores
  } catch {
    /* fail-safe: sin valores → tarjetas en "—" (nunca rompe el header) */
  }

  const items: AreaKpiItem[] = []
  for (const key of keys) {
    const def = KPI_DEFS[key]
    if (!def) continue
    const v = valores[key]
    const has = v && typeof v.valor === "number" && Number.isFinite(v.valor)
    const value = has ? formatKpi(def, v.valor) : "—"
    const sev = has ? kpiSev(def, v.valor) : "none"
    const variant: AreaKpiVariant =
      sev === "good" ? "success" : sev === "warn" ? "warning" : sev === "crit" ? "danger" : "primary"
    const metaTxt = def.meta != null ? `meta ${formatKpi(def, def.meta)}` : ""
    const subtext = (v && v.base) || metaTxt || def.nombre
    items.push({ label: def.nombre, value, subtext, variant, icon: kpiIcon(key) })
  }

  return { items }
}

// KPIs propios de cada SUBMÓDULO (reflejan el resumen interno del submódulo, no
// la tira general del área madre). Devuelve null si el submódulo no tiene tira
// propia (entonces se cae a la tira general del grupo). Extensible: agregar aquí
// un caso por submódulo con sus datos según el BSC.
async function getSubmoduloKpis(
  sb: any,
  moduleName: string | null | undefined,
  empresaId: number,
  anioFiltro?: string | null,
  mesFiltro?: string | null,
  desdeFiltro?: string | null,
  hastaFiltro?: string | null,
): Promise<{ items: AreaKpiItem[]; titulo: string } | null> {
  if (!moduleName) return null

  // Historial Báscula / Báscula: toneladas (Σ cabeceraoc.pesovascula) del rango
  // desde/hasta seleccionado en la tabla (o mes en curso si no hay filtro) — el
  // MISMO periodo que el usuario está viendo, no el resumen general del grupo.
  if (moduleName === "Historial Báscula" || moduleName === "Báscula") {
    // Solo las PLANTAS (idempresa 1/2) tienen báscula física. Los CEDIS (3/4
    // y cualquier otra empresa) por ahora no la tienen: su peso se calcula
    // desde los productos de la orden, no desde un pesaje real — mismo
    // criterio que `esBascula` en facturacion-control-actions.ts.
    if (empresaId !== 1 && empresaId !== 2) {
      return {
        titulo: "Indicadores — Recepción y Despacho",
        items: [
          {
            label: "Toneladas",
            value: "—",
            subtext: "Este CEDI no cuenta con báscula física",
            variant: "warning",
            icon: "truck",
          },
        ],
      }
    }
    const hoy = hoyBogota()
    const desde = desdeFiltro || `${hoy.slice(0, 7)}-01`
    const hasta = hastaFiltro || hoy
    let toneladas = 0
    let cargues = 0
    try {
      let offset = 0
      const pageSize = 1000
      const filas: { ordendecargue: string | null; pesovascula: number | null }[] = []
      for (;;) {
        const { data, error } = await sb
          .from("cabeceraoc")
          .select("ordendecargue, pesovascula")
          .eq("idempresa", empresaId)
          .neq("tipooperacion", "proyeccion")
          .neq("tipooperacion", "Tolva")
          .neq("tipooperacion", "Tolva f")
          .gte("fechaorden", desde)
          .lte("fechaorden", hasta)
          // Orden único y estable para paginar (ver lib/liquidaciones-actions.ts).
          .order("id")
          .range(offset, offset + pageSize - 1)
        if (error) break
        filas.push(...((data || []) as any[]))
        if (!data || data.length < pageSize) break
        offset += pageSize
      }
      // Huevos / Empaque MP (por unidad) fuera: su "peso" son unidades.
      const porUnidad = await codigosOrdenPorUnidad(sb, filas.map((r) => r.ordendecargue))
      for (const r of filas) {
        if (porUnidad.has(String(r.ordendecargue ?? "").trim())) continue
        toneladas += Number(r.pesovascula) || 0
        cargues += 1
      }
    } catch {
      /* fail-safe: tarjeta en 0 sin romper el header */
    }
    const periodo = desdeFiltro || hastaFiltro ? `${desde} a ${hasta}` : `mes en curso (${desde} a ${hasta})`
    return {
      titulo: "Indicadores — Recepción y Despacho",
      items: [
        {
          label: "Toneladas",
          value: `${(Math.round(toneladas * 10) / 10).toLocaleString("es-CO")} t`,
          subtext: `${cargues} cargue(s) · ${periodo}`,
          variant: "primary",
          icon: "truck",
        },
      ],
    }
  }

  // Ausentismos (Gestión Humana): mismo resumen que muestra el submódulo —
  // casos, días perdidos, accidentes de trabajo y casos por revisar (SST) del
  // año en curso, por empresa/cliente.
  if (moduleName === "Ausentismos") {
    // Filtro AÑO/MES del submódulo (si el usuario filtró en la tabla); si no, el
    // año en curso. Así las tarjetas de arriba reaccionan al filtro de mes/año.
    const anio = anioFiltro && anioFiltro !== "todos" ? anioFiltro : hoyBogota().slice(0, 4)
    const mesNum = mesFiltro ? MESES_KPI.indexOf(mesFiltro) + 1 : 0 // 1-12; 0 = todos
    const desde = mesNum >= 1 ? `${anio}-${String(mesNum).padStart(2, "0")}-01` : `${anio}-01-01`
    const hasta = mesNum >= 1 ? finDeMes(anio, mesNum) : `${anio}-12-31`
    const periodo = mesNum >= 1 ? `${mesFiltro} ${anio}` : anio
    let rows: any[] = []
    try {
      const { data } = await sb
        .from("ausentismosst")
        .select("cedula, total_dias_incapacidad, tipo_evento, requiere_revision_sst, dias_incapacidad")
        .eq("idempresa", empresaId)
        .gte("fecha_inicial", desde)
        .lte("fecha_inicial", hasta)
      rows = data || []
    } catch {
      rows = []
    }
    // Administrativos NUNCA salen en este KPI (usuario 2026-09-14): no son de
    // interés para medir ausentismo; su asistencia solo alimenta pago/PILA.
    try {
      const { data: hcAdmin } = await sb
        .from("headcount")
        .select("identificacion")
        .eq("admin", true)
        .or(`idempresa.eq.${empresaId},idempresa.is.null`)
      const cedulasAdmin = new Set((hcAdmin || []).map((h: any) => String(h.identificacion || "").trim()))
      if (cedulasAdmin.size > 0) rows = rows.filter((r) => !cedulasAdmin.has(String(r.cedula || "").trim()))
    } catch {
      // Si falla la consulta de admin, no bloquea el KPI -- sigue con todos.
    }
    const casos = rows.length
    const dias = rows.reduce((s, r) => s + (Number(r.total_dias_incapacidad) || 0), 0)
    // Accidentes de trabajo = EVENTOS NUEVOS: filas AT con incapacidad inicial
    // (`dias_incapacidad` > 0). Las PRÓRROGAS puras (continuación del mismo AT;
    // `dias_incapacidad` = 0, días en `prorroga`) NO suman — antes inflaban el
    // conteo (Indupan 2026 sumaba 16 en vez de 5).
    const at = rows.filter((r) => r.tipo_evento === "AT" && (Number(r.dias_incapacidad) || 0) > 0).length
    const revSST = rows.filter((r) => r.requiere_revision_sst).length
    return {
      titulo: `Ausentismo — resumen ${periodo}`,
      items: [
        { label: "Casos", value: String(casos), subtext: `incapacidades ${periodo}`, variant: "primary", icon: "activity" },
        { label: "Días de ausentismo", value: dias.toLocaleString("es-CO"), subtext: `días perdidos ${periodo}`, variant: dias > 0 ? "warning" : "success", icon: "clock" },
        { label: "Accidentes de trabajo", value: String(at), subtext: `AT ${periodo}`, variant: at > 0 ? "danger" : "success", icon: "alert" },
        { label: "Por revisar SST", value: String(revSST), subtext: "osteomuscular / requiere revisión", variant: revSST > 0 ? "warning" : "success", icon: "shield" },
      ],
    }
  }

  // Recobro de Incapacidades: costo recuperable ante EPS (EG > 2 días) y ARL
  // (AT 100%). Refleja el resumen del submódulo: por radicar, en trámite,
  // recuperable pendiente y recobrado del año en curso.
  if (moduleName === "Recobro de Incapacidades") {
    const anio = hoyBogota().slice(0, 4)
    let rows: any[] = []
    try {
      const { data } = await sb
        .from("ausentismosst")
        .select("tipo_evento, estado_recobro, valor_recobrado, costos_arl, costos_eps")
        .eq("idempresa", empresaId)
        .gte("fecha_inicial", `${anio}-01-01`)
        .lte("fecha_inicial", `${anio}-12-31`)
      rows = data || []
    } catch {
      rows = []
    }
    let porRadicar = 0
    let enTramite = 0
    let recuperado = 0
    let pendiente = 0
    for (const a of rows) {
      const esAT = a.tipo_evento === "AT"
      const recobrable = Number(esAT ? a.costos_arl : a.costos_eps) || 0
      if (recobrable <= 0) continue // no genera recobro (EG ≤ 2 días)
      const est = String(a.estado_recobro || "PENDIENTE").toUpperCase()
      const rec = Number(a.valor_recobrado) || (est === "RECOBRADO" ? recobrable : 0)
      recuperado += rec
      if (est === "PENDIENTE") porRadicar++
      else if (est === "RADICADO") enTramite++
      if (est !== "RECOBRADO" && est !== "PERDIDO" && est !== "GLOSADO") pendiente += Math.max(0, recobrable - rec)
    }
    const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO")
    return {
      titulo: `Recobro de incapacidades — ${anio}`,
      items: [
        { label: "Por radicar", value: String(porRadicar), subtext: "recobrables pendientes", variant: porRadicar > 0 ? "warning" : "success", icon: "clock" },
        { label: "En trámite", value: String(enTramite), subtext: "radicados ante EPS/ARL", variant: "primary", icon: "file" },
        { label: "Recuperable pendiente", value: cop(pendiente), subtext: "por recobrar", variant: pendiente > 0 ? "warning" : "success", icon: "receipt" },
        { label: "Recobrado", value: cop(recuperado), subtext: `recuperado ${anio}`, variant: recuperado > 0 ? "success" : "primary", icon: "shield" },
      ],
    }
  }

  // Liquidaciones: personal retirado CON contrato (nº SIIGO) por liquidar. Refleja
  // los KPIs del submódulo: retirados con contrato, pendientes y liquidadas.
  if (moduleName === "Liquidaciones") {
    let conContrato = 0
    try {
      const { data } = await sb
        .from("headcount")
        .select("identificacion, contratosiigo")
        .eq("idempresa", empresaId)
        .ilike("estado", "inactivo")
      conContrato = (data || []).filter((r: any) => String(r.contratosiigo || "").trim() !== "").length
    } catch {
      conContrato = 0
    }
    let liquidadas = 0
    try {
      const { count } = await sb
        .from("liquidaciones_retiro")
        .select("*", { count: "exact", head: true })
        .eq("idempresa", empresaId)
        .eq("estado", "liquidada")
      liquidadas = count || 0
    } catch {
      liquidadas = 0
    }
    const pendientes = Math.max(0, conContrato - liquidadas)
    return {
      titulo: "Liquidaciones — personal retirado",
      items: [
        { label: "Retirados con contrato", value: String(conContrato), subtext: "por liquidar", variant: "primary", icon: "file" },
        { label: "Pendientes de liquidar", value: String(pendientes), subtext: "sin marcar liquidada", variant: pendientes > 0 ? "warning" : "success", icon: "clock" },
        { label: "Liquidadas", value: String(liquidadas), subtext: "finalizadas", variant: "success", icon: "shield" },
      ],
    }
  }

  return null
}
