// Mapeo ÁREA (grupo del menú) → indicadores del BSC que le corresponden, y
// la definición de presentación de cada indicador (nombre, formato, meta).
// Las CLAVES coinciden con las que produce `getIndicadoresValores` (sig-actions).
// Es config pura (client-safe): NO consulta datos.

export interface KpiDef {
  nombre: string
  fmt: "pct" | "num" | "ton" | "min"
  meta?: number
  /** true = más alto es mejor (default); false = más bajo es mejor. */
  higherBetter?: boolean
}

export const KPI_DEFS: Record<string, KpiDef> = {
  // Metas SINCRONIZADAS con el BSC (sig_indicadores, LIP 100) — clase mundial 3PL.
  // Fuente oficial de la meta = sig_indicadores; estas tiras deben mostrar lo mismo.
  sla_tiempos: { nombre: "SLA de tiempos", fmt: "pct", meta: 98, higherBetter: true },
  sla_global: { nombre: "Nivel de servicio", fmt: "pct", meta: 98, higherBetter: true },
  desp_cumplimiento: { nombre: "Cumplim. de cargues", fmt: "pct", meta: 99, higherBetter: true },
  desp_ciclo_cerrado: { nombre: "Ciclo cerrado", fmt: "pct", meta: 98, higherBetter: true },
  desp_meta_ton: { nombre: "Cumpl. meta toneladas", fmt: "pct", meta: 100, higherBetter: true },
  desp_ordenes: { nombre: "Órdenes", fmt: "num" },
  desp_toneladas: { nombre: "Toneladas", fmt: "ton" },
  vehiculos_atendidos: { nombre: "Vehículos atendidos", fmt: "num" },
  // Vehículos registrados en portería (citasvehiculos) que nadie cerró ni eliminó (estatus
  // nulo): foto de hoy, sin período. Gerencia 2026-10-03: "45 sin procesar y no sucede
  // nada; esto debe ser una alerta". Meta 0 → cualquier pendiente pinta en rojo y avisa.
  veh_sin_procesar: { nombre: "Vehículos sin procesar", fmt: "num", meta: 0, higherBetter: false },
  lip_tiempo_cargue: { nombre: "Tiempo de cargue", fmt: "min", higherBetter: false },
  lip_evidencia: { nombre: "Evidencia de cargue", fmt: "pct", meta: 98, higherBetter: true },
  lip_facturacion: { nombre: "Facturación gestionada", fmt: "pct", meta: 98, higherBetter: true },
  inv_exactitud: { nombre: "Exactitud de inventario", fmt: "pct", meta: 99.5, higherBetter: true },
  inv_rechazos: { nombre: "Rechazos", fmt: "num", higherBetter: false },
  gh_activos: { nombre: "Colaboradores activos", fmt: "num" },
  gh_ausentismo: { nombre: "Ausentismo médico", fmt: "pct", meta: 3, higherBetter: false },
  gh_cobertura: { nombre: "Cobertura de planta", fmt: "pct", meta: 100, higherBetter: true },
  gh_recobro: { nombre: "Recobro de incapacidades", fmt: "pct", meta: 95, higherBetter: true },
  sat_conductor: { nombre: "Satisfacción conductor", fmt: "pct", meta: 90, higherBetter: true },
  sat_cliente: { nombre: "Satisfacción cliente", fmt: "pct", meta: 90, higherBetter: true },
  // SST (BSC del área): SG-SST 0312, accidentalidad y IPEVR.
  // 0312 se mantiene en 86% (umbral "aceptable" Res. 0312 Art. 28) — fuente oficial
  // sig_indicadores (IND-SST-0312). Si se sube a meta interna, cambiar en AMBOS lados.
  sgsst_0312: { nombre: "Cumplimiento SG-SST 0312", fmt: "pct", meta: 86, higherBetter: true },
  sst_at_count: { nombre: "Accidentes de trabajo", fmt: "num", meta: 0, higherBetter: false },
  sst_at_dias: { nombre: "Días perdidos por AT", fmt: "num", meta: 0, higherBetter: false },
  sst_ipevr_cumpl: { nombre: "Intervención de peligros (IPEVR)", fmt: "pct", meta: 95, higherBetter: true },
  sst_frecuencia: { nombre: "Frecuencia de accidentalidad", fmt: "num", meta: 9, higherBetter: false },
  // Indicadores adicionales (misma fuente en vivo, metas sincronizadas con el BSC).
  inv_eri: { nombre: "Exactitud inventario físico (ERI)", fmt: "pct", meta: 99.5, higherBetter: true },
  gh_formacion: { nombre: "Formación aprobada", fmt: "pct", meta: 95, higherBetter: true },
  nc_cerradas: { nombre: "NC cerradas a tiempo", fmt: "pct", meta: 95, higherBetter: true },
  legal_cumplimiento: { nombre: "Cumplimiento legal", fmt: "pct", meta: 100, higherBetter: true },
  sig_implementacion: { nombre: "Implementación del SIG", fmt: "pct", meta: 100, higherBetter: true },
  // Pedidos del cliente (BSC IND-PED-01..05, SQL 216). Fuente única de cálculo:
  // lib/pedidos-indicadores.ts (la misma de Gestionar pedidos y del Dashboard).
  ped_a_tiempo: { nombre: "Pedidos a tiempo", fmt: "pct", meta: 95, higherBetter: true },
  ped_atrasados: { nombre: "Pedidos atrasados hoy", fmt: "num", meta: 0, higherBetter: false },
  ped_completos: { nombre: "Entregas completas", fmt: "pct", meta: 98, higherBetter: true },
  ped_pendientes: { nombre: "Pendientes del período", fmt: "num", higherBetter: false },
  ped_mismo_dia: { nombre: "Pedidos del mismo día", fmt: "pct", higherBetter: false },
}

// Qué indicadores muestra cada grupo del menú (por su `key`). Curados a los MÁS
// IMPORTANTES de cada área según el análisis de clase mundial (3PL): resultado de
// servicio + eficiencia + calidad. Todas las metas salen de KPI_DEFS (sincronizadas
// con el BSC/sig_indicadores). Máx ~5 por área para que la tira sea legible.
export const AREA_KPIS: Record<string, string[]> = {
  // Gerencia / vista integral: los resultados estratégicos de LIP.
  integral: ["sla_global", "sat_cliente", "desp_cumplimiento", "desp_meta_ton", "sgsst_0312"],
  // Pedidos del cliente: cumplimiento de la promesa, atraso de hoy, completitud y anticipación.
  pedidos: ["ped_a_tiempo", "ped_atrasados", "ped_completos", "ped_mismo_dia"],
  // Operaciones (Cargue/Descargue): servicio, cumplimiento, calidad, volumen.
  despachos: ["veh_sin_procesar", "desp_cumplimiento", "sla_tiempos", "lip_evidencia", "desp_meta_ton", "sat_conductor"],
  // Almacenamiento e Inventarios: exactitud world-class.
  inventarios: ["inv_eri", "inv_exactitud", "inv_rechazos"],
  produccion: ["desp_meta_ton", "desp_toneladas"],
  // Operación LIP (SLA de servicio de outsourcing).
  lip: ["sla_tiempos", "desp_cumplimiento", "lip_evidencia", "lip_tiempo_cargue", "lip_facturacion"],
  financiera: ["lip_facturacion"],
  // Gestión Humana: rotación/ausentismo/cobertura/recobro/formación.
  rrhh: ["gh_ausentismo", "gh_cobertura", "gh_recobro", "gh_formacion"],
  // SIG / Certificaciones (transversal, ISO 9001·14001·45001).
  certificaciones_lip: ["sgsst_0312", "sig_implementacion", "nc_cerradas", "legal_cumplimiento", "sat_cliente"],
  // SST: cumplimiento SG-SST + accidentalidad + intervención de peligros.
  sst: ["sgsst_0312", "sst_ipevr_cumpl", "sst_frecuencia", "sst_at_count", "sst_at_dias"],
  // mrp / configuracion: sin indicadores de área en el BSC → no muestran KPIs.
}

// SUBMÓDULO → indicador(es) del BSC que ESE submódulo alimenta (su aporte al
// indicador gerencial del área). Cada tarjeta del submódulo muestra el indicador
// del área al que contribuye (valor real + meta + semáforo). Los submódulos que
// NO estén aquí caen al set del módulo madre (AREA_KPIS del grupo). Máx ~4.
export const SUBMODULO_KPIS: Record<string, string[]> = {
  // --- Recepción y Despacho ---
  "Generar Órdenes de Cargue": ["desp_ordenes", "desp_cumplimiento"],
  "Generar Órdenes de Descargue": ["desp_ordenes"],
  "Generar Orden de Distribución": ["desp_ordenes", "lip_facturacion"],
  "Gestión de Ordenes": ["veh_sin_procesar", "desp_cumplimiento", "sla_tiempos"],
  "Dashboard Despachos/Recepción": ["veh_sin_procesar", "desp_cumplimiento", "sla_tiempos", "desp_meta_ton", "vehiculos_atendidos"],
  "Recepción de Traslado": ["inv_exactitud"],
  "Registrar Vehículos": ["veh_sin_procesar", "vehiculos_atendidos"],
  "Ver Vehículos": ["veh_sin_procesar", "vehiculos_atendidos"],
  "Registro sanitario": ["vehiculos_atendidos"],
  "Ver historial de Inspección": ["vehiculos_atendidos"],
  Báscula: ["desp_toneladas"],
  "Historial Báscula": ["desp_toneladas"],
  // --- Pedidos ---
  "Entrada de pedidos": ["ped_mismo_dia", "ped_a_tiempo"],
  "Gestionar pedidos": ["ped_atrasados", "ped_a_tiempo", "ped_completos", "ped_pendientes"],
  "Dashboard Pedidos": ["ped_a_tiempo", "ped_atrasados", "ped_completos", "ped_pendientes", "ped_mismo_dia"],
  "Programación del cliente": ["ped_a_tiempo", "ped_atrasados"],
  "Gestión integral de pedidos": ["sla_global"],
  // --- Almacenamiento ---
  "Transacciones de Inventario": ["inv_exactitud"],
  "Saldos de inventario": ["inv_exactitud"],
  "Saldos por producto": ["inv_exactitud"],
  "Traslados de producto": ["inv_exactitud"],
  "Gestión de transacciones": ["inv_exactitud", "inv_rechazos"],
  "Capacidad Bodega": ["inv_exactitud"],
  "Montacargas y personal día": ["desp_toneladas"],
  "Panel LIP Inventario": ["inv_eri", "inv_exactitud"],
  "Cuadre de Inventario": ["inv_eri"],
  "Auditoría de Inventario": ["inv_eri", "inv_exactitud"],
  "Asignación de Lotes": ["inv_exactitud"],
  "Historial de lotes": ["inv_exactitud"],
  // --- Producción ---
  "Ingreso de Producción": ["desp_toneladas"],
  "Aprobación de ingreso de producción": ["desp_toneladas"],
  "Dashboard de Producción": ["desp_meta_ton", "desp_toneladas"],
  // --- Operación LIP ---
  Picking: ["lip_evidencia", "lip_tiempo_cargue"],
  Packing: ["lip_tiempo_cargue"],
  // Centro de Coordinación ya trae sus propios KPIs en la pantalla (incluye
  // "Tiempo de cargue" del día) — no repetir la tira genérica, para dejar
  // más espacio vertical al tablero de muelles.
  "Centro de Coordinación": [],
  // Productividad de Auxiliares trae sus propios indicadores (por tipo de
  // operación y por auxiliar); los del área saturaban la pantalla sin relación.
  "Productividad de Auxiliares": [],
  "Ver Picking/Packing": ["lip_evidencia"],
  "Registro de QR estibas": ["inv_exactitud"],
  "Lectura de QR estibas": ["inv_exactitud"],
  "Inventario por Estiba": ["inv_exactitud"],
  "Solicitar Facturas": ["lip_facturacion"],
  "Satisfacción y PQRSF": ["sat_cliente"],
  "Calificación del Conductor": ["sat_conductor"],
  "Registro de asistencia": ["gh_cobertura"],
  "Programación de turnos": ["gh_cobertura"],
  "Aprobar Turnos": ["gh_cobertura"],
  "Solicitud de Personal": ["gh_cobertura"],
  "Notificaciones al Personal": ["gh_cobertura"],
  // --- Financiera ---
  "Indicador de Facturación por Proyectos": ["lip_facturacion"],
  "Facturación Proyectos": ["lip_facturacion"],
  "Cuadro de Control Facturación": ["lip_facturacion"],
  // --- Gestión Humana ---
  "Head Count": ["gh_activos", "gh_cobertura"],
  "Gestión de Colaboradores": ["gh_activos"],
  "Carpetas de Trabajadores": ["gh_activos"],
  "Panel LIP Gestión Humana": ["gh_ausentismo", "gh_cobertura", "gh_recobro"],
  "Novedades de personal": ["gh_ausentismo"],
  Inducciones: ["gh_formacion"],
  "Evidencia de Inducciones": ["gh_formacion"],
  "Gestión de Capacitaciones": ["gh_formacion"],
  "Asistencia a Capacitaciones": ["gh_formacion"],
  "Evaluaciones de Desempeño": ["gh_formacion"],
  "Tabla Asistencia": ["gh_cobertura"],
  Visor: ["gh_cobertura"],
  "Gestión de Solicitudes": ["gh_cobertura"],
  "Aprobación de Solicitudes de Personal": ["gh_cobertura"],
  "Hojas de Vida": ["gh_cobertura"],
  Antecedentes: ["gh_cobertura"],
  Entrevistas: ["gh_cobertura"],
  "Gestión de Contratos": ["gh_activos"],
  // --- SIG / Certificaciones ---
  "No Conformidades SIG": ["nc_cerradas"],
  "Aspectos e Impactos ISO 14001": ["legal_cumplimiento"],
  "Matriz Legal Ambiental": ["legal_cumplimiento"],
  "Centro de Evidencia ISO 9001": ["sig_implementacion"],
  "Repositorio ISO 9001": ["sig_implementacion"],
  // --- SST ---
  "Auditoría 0312": ["sgsst_0312"],
  "Matriz de Estándares": ["sgsst_0312"],
  "Repositorio de Soportes": ["sgsst_0312"],
  "Plan de Mejoramiento": ["sgsst_0312"],
  IPEVR: ["sst_ipevr_cumpl"],
  "Investigación AT": ["sst_at_count", "sst_frecuencia"],
  "Alertas de AT": ["sst_at_count"],
  "Investigaciones Realizadas": ["sst_at_count"],
  MEDEVAC: ["sst_at_count"],
  "Comunicación SST": ["sgsst_0312"],
  "Gestión del Cambio": ["sgsst_0312"],
  "Actividades y Comités": ["sgsst_0312"],
}

// Ícono (nombre lucide, ver ICONS en area-kpi-strip) por indicador.
const KPI_ICON: Record<string, string> = {
  sla_tiempos: "shield", sla_global: "shield", desp_cumplimiento: "shield",
  desp_ciclo_cerrado: "shield", sig_implementacion: "shield", nc_cerradas: "shield",
  legal_cumplimiento: "shield", sgsst_0312: "shield", sst_ipevr_cumpl: "shield",
  desp_meta_ton: "package", desp_toneladas: "package", desp_ordenes: "package",
  inv_exactitud: "package", inv_eri: "package", inv_rechazos: "lock",
  vehiculos_atendidos: "truck", veh_sin_procesar: "car", lip_tiempo_cargue: "clock", lip_evidencia: "file",
  lip_facturacion: "receipt", gh_recobro: "receipt",
  gh_activos: "activity", gh_cobertura: "activity", sat_cliente: "activity", sat_conductor: "activity",
  gh_ausentismo: "alert", sst_at_count: "alert", sst_at_dias: "alert", sst_frecuencia: "alert",
  gh_formacion: "file",
  ped_a_tiempo: "shield", ped_atrasados: "alert", ped_completos: "package", ped_pendientes: "clock", ped_mismo_dia: "clock",
}

export function kpiIcon(key: string): string {
  return KPI_ICON[key] || "activity"
}

/** Pantalla donde se actúa sobre un indicador: la primera que lo declara en SUBMODULO_KPIS,
 *  o el portal del primer grupo que lo lista en AREA_KPIS. Para los enlaces de las alertas. */
export function pantallaDeIndicador(key: string): { modulo: string | null; grupo: string | null } {
  for (const [modulo, keys] of Object.entries(SUBMODULO_KPIS)) if (keys.includes(key)) return { modulo, grupo: null }
  for (const [grupo, keys] of Object.entries(AREA_KPIS)) if (keys.includes(key)) return { modulo: null, grupo }
  return { modulo: null, grupo: null }
}

// Indicadores a mostrar para un módulo/submódulo: el set del submódulo si existe,
// si no el del módulo madre (grupo). Vacío = no hay indicadores (mrp/configuración).
export function kpisParaModulo(groupKey: string | null | undefined, moduleName: string | null | undefined): string[] {
  if (moduleName && SUBMODULO_KPIS[moduleName]) return SUBMODULO_KPIS[moduleName]
  if (groupKey && AREA_KPIS[groupKey]) return AREA_KPIS[groupKey]
  return []
}

// Preguntas SUGERIDAS propias de cada área (grupo del menú). Cada una está
// alineada a datos que LIPbot puede consultar/gestionar EN ESE módulo, para no
// mostrar sugerencias fuera de contexto (ej. no ofrecer "pedidos" en RRHH).
export const AREA_SUGERENCIAS: Record<string, string[]> = {
  integral: ["¿Cómo va el SLA global hoy?", "¿Cumplimos la meta de toneladas?", "¿Qué requiere mi atención hoy?"],
  pedidos: ["¿Cuántos pedidos hay este mes?", "¿Cuánto suman los pedidos del mes?", "¿Qué pedidos están pendientes?"],
  despachos: ["¿Cuántas toneladas cargué hoy?", "¿Cuántos cargues siguen sin cerrar?", "¿Cuántos vehículos se atendieron hoy?"],
  inventarios: ["¿Qué stock hay disponible?", "¿Cómo va la exactitud de inventario?", "¿Cuántos registros de inventario hay?"],
  produccion: ["¿Cuántas toneladas se produjeron este mes?", "¿Cómo va la meta de producción?"],
  lip: ["¿Cómo va el SLA de tiempos?", "¿Cuántos cargues sin cerrar hoy?", "¿Cuántas toneladas cargué este mes?"],
  financiera: ["¿Qué facturas hay por solicitar?", "¿Cuánto suman los gastos del mes?", "Registrar un gasto"],
  rrhh: ["¿Cuántos colaboradores activos hay?", "Registrar una novedad a un trabajador", "¿Cómo va el ausentismo del mes?"],
  certificaciones_lip: ["¿Cómo va la satisfacción del cliente?", "¿Cómo va la satisfacción del conductor?"],
  sst: ["¿Cómo va el cumplimiento del SG-SST 0312?", "¿Cuántos accidentes de trabajo hay?", "¿Cómo va la intervención de peligros (IPEVR)?"],
  configuracion: ["Crear un cliente nuevo", "Registrar un producto", "Editar un destino"],
}

// Sugerencias genéricas (Inicio / sin grupo específico).
const SUGERENCIAS_GENERICAS = [
  "¿Qué requiere mi atención hoy?",
  "¿Cuántas toneladas cargué este mes?",
  "¿Cuántos pedidos hay este mes?",
]

/** Sugerencias para un grupo del menú; si no hay mapeo, usa las genéricas. */
export function sugerenciasDe(groupKey?: string): string[] {
  if (groupKey && AREA_SUGERENCIAS[groupKey]) return AREA_SUGERENCIAS[groupKey]
  return SUGERENCIAS_GENERICAS
}

export function formatKpi(def: KpiDef, valor: number): string {
  switch (def.fmt) {
    case "pct":
      return `${valor}%`
    case "ton":
      return `${valor} t`
    case "min":
      return `${valor} min`
    default:
      return `${valor}`
  }
}

export type KpiSev = "good" | "warn" | "crit" | "none"

export function kpiSev(def: KpiDef, valor: number): KpiSev {
  if (def.meta == null) return "none"
  const higher = def.higherBetter !== false
  if (higher) {
    if (valor >= def.meta) return "good"
    if (valor >= def.meta * 0.9) return "warn"
    return "crit"
  }
  // menor es mejor (ausentismo, tiempo de cargue, rechazos)
  if (valor <= def.meta) return "good"
  if (valor <= def.meta * 1.2) return "warn"
  return "crit"
}
