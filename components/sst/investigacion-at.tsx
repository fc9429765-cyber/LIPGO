"use client"

// Investigación de Accidentes / Incidentes — formato ORIGINAL de LIP (SST-FOR-21).
// Calca las 6 páginas del formato de LIP (base FURAT) + Ishikawa (4 ramas) + plan
// de acción F/M/I + testigos + retroalimentación + firmas. Exporta a PDF con logo.
// Alimenta sst_incidentes (+ sst_incidente_acciones + sst_incidente_testigos).

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { SST_TOKENS } from "@/components/sst/sst-utils"
import { SoportesDocumentales } from "@/components/sst/soportes-documentales"
import { listSoportes, eliminarSoporte } from "@/lib/soportes-actions"
import { subirSoporteDirecto } from "@/lib/subir-soporte-directo"
import type { SoporteRow } from "@/lib/soportes-types"
import { EspinaPescado, CuadrosCausas } from "@/components/sst/espina-pescado"
import type { IshikawaData, CuadrosCausasData } from "@/components/sst/espina-pescado"
import {
  listIncidentes,
  saveIncidente,
  updateIncidente,
  actualizarIncidenteCompleto,
  listAcciones,
  listTestigos,
} from "@/lib/sst-incidentes-actions"
import type { IncidenteRow, IncidenteAccionRow, IncidenteTestigoRow } from "@/lib/sst-evidencia-types"
import {
  FileText,
  Eye,
  Loader2,
  Pencil,
  X,
  ShieldCheck,
  Upload,
  ExternalLink,
  Trash2,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// ---- Datos FIJOS del empleador LIP (encabezado del formato, no se digitan) ----
const EMPLEADOR_LIP = {
  razon_social: "LIP PROGRESSIVE INTEGRAL LOGISTICS SAS",
  tipo_id: "NIT",
  nit: "901725963-8",
  direccion: "CL 4 B 20 A 66 BRR CALLEJAS",
  departamento: "CESAR",
  municipio: "VALLEDUPAR",
  telefono: "",
  email: "gerenciageneral@lip-sas.com",
  actividad:
    "MANIPULACIÓN DE CARGA, INCLUYE LA CARGA Y DESCARGA DE MERCANCÍAS Y EQUIPAJE POR ESTIBADORES, COTEROS, PALETIZADORES, EXCEPTO CARGUE Y DESCARGUE DE EMBARCACIONES AÉREAS, MARÍTIMAS Y/O FLUVIALES.",
}
// Centro de trabajo por proyecto (selector global)
const CENTROS: Record<number, { nombre: string; direccion: string; municipio: string }> = {
  1: { nombre: "H. INDUPAN", direccion: "CR 22 # 14 - 12", municipio: "BOGOTÁ D.C" },
  2: { nombre: "AVIMOL (LA INSUPERABLE)", direccion: "", municipio: "" },
  3: { nombre: "CEDI FUNZA", direccion: "", municipio: "FUNZA" },
  4: { nombre: "CEDI MEDELLÍN", direccion: "", municipio: "MEDELLÍN" },
}

const SN: [string, string][] = [["true", "Sí"], ["false", "No"]]
const TIPOS: [string, string][] = [
  ["incidente", "Incidente"],
  ["accidente", "Accidente de trabajo"],
  ["enfermedad_laboral", "Enfermedad laboral"],
]
const GRAVEDAD: [string, string][] = [["leve", "Leve"], ["grave", "Grave"], ["mortal", "Mortal"]]
const ESTADOS: [string, string][] = [
  ["reportado", "Reportado"],
  ["en_investigacion", "En investigación"],
  ["cerrado", "Cerrado"],
]
const VINCULACION: [string, string][] = [
  ["planta", "Planta"],
  ["mision", "Misión"],
  ["contratista", "Contratista"],
  ["independiente", "Independiente"],
  ["dependiente", "Dependiente"],
  ["aprendiz", "Aprendiz"],
]
const JORNADA: [string, string][] = [["normal", "Normal"], ["extra", "Extra"]]
const JORNADA_HAB: [string, string][] = [
  ["diurno", "Diurno"],
  ["nocturno", "Nocturno"],
  ["mixto", "Mixto"],
  ["turnos", "Por turnos"],
]
const SEXO: [string, string][] = [["M", "Masculino"], ["F", "Femenino"]]
const DOC_TIPO: [string, string][] = [
  ["CC", "Cédula de ciudadanía"],
  ["CE", "Cédula de extranjería"],
  ["TI", "Tarjeta de identidad"],
  ["PA", "Pasaporte"],
  ["PEP", "PEP / PPT"],
]
const DIA_SEMANA: [string, string][] = [
  ["lunes", "Lunes"], ["martes", "Martes"], ["miercoles", "Miércoles"], ["jueves", "Jueves"],
  ["viernes", "Viernes"], ["sabado", "Sábado"], ["domingo", "Domingo"],
]
const ZONA: [string, string][] = [["urbana", "Urbana"], ["rural", "Rural"]]
const DENTRO_FUERA: [string, string][] = [["dentro", "Dentro de la empresa"], ["fuera", "Fuera de la empresa"]]
const AUS_TIPO: [string, string][] = [["inicial", "Inicial"], ["prorroga", "Prórroga"]]
const TIPO_ACC: [string, string][] = [
  ["propios_trabajo", "Propios del Trabajo"],
  ["violencia", "Violencia"],
  ["transito", "Tránsito"],
  ["deportivo", "Deportivo"],
  ["recreativo", "Recreativo o Cultural"],
]
// Catálogos FURAT completos (value = etiqueta, se guarda y se imprime tal cual)
const LUGAR: [string, string][] = [
  ["1. Almacenes o depósitos", "1. Almacenes o depósitos"],
  ["2. Áreas de producción", "2. Áreas de producción"],
  ["3. Áreas recreativas o deportivas", "3. Áreas recreativas o deportivas"],
  ["4. Corredores o pasillos", "4. Corredores o pasillos"],
  ["5. Escaleras", "5. Escaleras"],
  ["6. Parqueaderos o áreas de circulación vehicular", "6. Parqueaderos o áreas de circulación vehicular"],
  ["7. Oficinas", "7. Oficinas"],
  ["8. Otras áreas comunes", "8. Otras áreas comunes"],
]
const LESION: [string, string][] = [
  ["1. Fractura", "1. Fractura"],
  ["2. Luxación", "2. Luxación"],
  ["3. Torcedura, esguince, desgarro muscular, hernia o laceración de tendón sin herida", "3. Torcedura / esguince / desgarro / hernia"],
  ["4. Conmoción o trauma interno", "4. Conmoción o trauma interno"],
  ["5. Amputación o enucleación", "5. Amputación o enucleación"],
  ["6. Herida", "6. Herida"],
  ["7. Trauma superficial (rasguño, punción, pinchazo, cuerpo extraño en ojo)", "7. Trauma superficial"],
  ["8. Golpe, contusión o aplastamiento", "8. Golpe, contusión o aplastamiento"],
  ["9. Quemadura", "9. Quemadura"],
  ["10. Envenenamiento o intoxicación aguda o alergia", "10. Envenenamiento / intoxicación / alergia"],
  ["11. Efecto del tiempo, del clima u otro del ambiente", "11. Efecto del tiempo / clima / ambiente"],
  ["12. Asfixia", "12. Asfixia"],
  ["13. Efecto de la electricidad", "13. Efecto de la electricidad"],
  ["14. Efecto nocivo de la radiación", "14. Efecto nocivo de la radiación"],
  ["15. Lesiones múltiples", "15. Lesiones múltiples"],
  ["16. Otro", "16. Otro (especificar)"],
]
const PARTE: [string, string][] = [
  ["1. Cabeza", "1. Cabeza"],
  ["2. Ojo", "2. Ojo"],
  ["3. Cuello", "3. Cuello"],
  ["4. Tronco (espalda, columna vertebral, médula espinal, pelvis)", "4. Tronco (espalda / columna / pelvis)"],
  ["5. Tórax", "5. Tórax"],
  ["6. Abdomen", "6. Abdomen"],
  ["7. Miembros superiores", "7. Miembros superiores"],
  ["8. Manos (dedos, muñeca o puño)", "8. Manos (dedos, muñeca o puño)"],
  ["9. Miembros inferiores", "9. Miembros inferiores"],
  ["10. Pies", "10. Pies"],
  ["12. Ubicaciones múltiples", "12. Ubicaciones múltiples"],
  ["13. Lesiones generales u otras", "13. Lesiones generales u otras"],
]
const AGENTE: [string, string][] = [
  ["1. Máquinas y/o equipos", "1. Máquinas y/o equipos"],
  ["2. Medios de transporte", "2. Medios de transporte"],
  ["3. Aparatos", "3. Aparatos"],
  ["4. Herramientas, implementos o utensilios", "4. Herramientas / implementos / utensilios"],
  ["5. Materiales o sustancias", "5. Materiales o sustancias"],
  ["6. Radiaciones", "6. Radiaciones"],
  ["7. Ambiente de trabajo (superficies, muebles, tejados, etc.)", "7. Ambiente de trabajo"],
  ["8. Otros agentes no clasificados", "8. Otros agentes no clasificados"],
  ["9. Animales (vivos o productos animales)", "9. Animales"],
  ["10. Agentes no clasificados por falta de datos", "10. No clasificado por falta de datos"],
]
const MECANISMO: [string, string][] = [
  ["1. Caída de personas", "1. Caída de personas"],
  ["2. Caída de objetos", "2. Caída de objetos"],
  ["3. Pisadas, choques o golpes", "3. Pisadas, choques o golpes"],
  ["4. Atrapamientos", "4. Atrapamientos"],
  ["5. Sobreesfuerzo, esfuerzo excesivo o falso movimiento", "5. Sobreesfuerzo / falso movimiento"],
  ["6. Exposición o contacto con temperatura extrema", "6. Contacto con temperatura extrema"],
  ["7. Exposición o contacto con la electricidad", "7. Contacto con la electricidad"],
  ["8. Exposición o contacto con sustancias nocivas, radiaciones o salpicaduras", "8. Contacto con sustancias nocivas"],
  ["9. Golpes por o contra objetos", "9. Golpes por o contra objetos"],
  ["10. Otros", "10. Otros (especificar)"],
]
const CONTROL: [string, string][] = [["fuente", "Fuente (F)"], ["medio", "Medio (M)"], ["individuo", "Individuo (I)"]]

const BOOL_KEYS = [
  "labor_habitual", "causo_muerte", "testigos_presenciaron", "reportado_arl", "reportado_mintrabajo",
  "primeros_auxilios", "remitido_centro_salud", "hospitalizado", "requirio_transporte",
]

// Ishikawa con las 4 ramas del formato LIP
function ishikawaLIP(): IshikawaData {
  return {
    efecto: "",
    categorias: [
      { nombre: "Factores personales", causas: [] },
      { nombre: "Factores del trabajo", causas: [] },
      { nombre: "Actos inseguros", causas: [] },
      { nombre: "Condiciones inseguras", causas: [] },
    ],
  }
}

const vacioAccion = () => ({
  plan: "",
  tipo_control: "fuente",
  fecha_implementacion: "",
  responsable_ejecucion: "",
  fecha_verificacion: "",
  responsable_verificacion: "",
  observacion: "",
  estado: "pendiente",
})
const vacioTestigo = () => ({ nombre: "", documento: "", version: "" })
const firmasVacias = () => ({
  jefe_inmediato: { nombre: "", cargo: "Jefe inmediato / Coordinador de operación", cc: "" },
  coordinador_sst: { nombre: "Michael Josías Castro Alejo", cargo: "Coordinador SST", cc: "" },
  integrante_copasst: { nombre: "", cargo: "Integrante del COPASST", cc: "" },
  responsable_sgsst: { nombre: "Michael Josías Castro Alejo", cargo: "Responsable SG-SST", cc: "" },
  reviso: { nombre: "", cargo: "SST - Coordinador de operaciones", cc: "" },
  cerro: { nombre: "", cargo: "Responsable del SG-SST", cc: "" },
  representante_legal: { nombre: "Jeffrey Joel Jiménez Rodríguez", cargo: "Representante Legal", cc: "" },
})

const vacio = (empresaId?: number | null) => {
  const c = (empresaId && CENTROS[empresaId]) || { nombre: "", direccion: "", municipio: "" }
  return {
    tipo: "accidente",
    gravedad: "leve",
    fecha_reporte: new Date().toISOString().slice(0, 10),
    // clasificación
    centro_trabajo: c.nombre,
    centro_direccion: c.direccion,
    centro_municipio: c.municipio,
    centro_departamento: "",
    centro_telefono: "",
    centro_zona: "urbana",
    codigo_actividad: "",
    // persona
    trabajador: "",
    documento_tipo: "CC",
    documento_numero: "",
    fecha_nacimiento: "",
    sexo: "M",
    eps: "",
    eps_codigo: "",
    arl: "",
    arl_codigo: "",
    afp: "",
    afp_codigo: "",
    telefono: "",
    fax: "",
    direccion_trabajador: "",
    cargo: "",
    ocupacion_habitual: "",
    codigo_ocupacion: "",
    tipo_vinculacion: "planta",
    fecha_ingreso: "",
    antiguedad_dias: 0,
    antiguedad_meses: 0,
    antiguedad_anios: 0,
    salario: 0,
    jornada_habitual: "diurno",
    funciones_asignadas: "",
    epp_portado: "",
    // evento
    fecha_evento: new Date().toISOString().slice(0, 10),
    hora_evento: "",
    dia_semana: "",
    tiempo_laborado_previo: "",
    jornada_evento: "normal",
    labor_habitual: "true",
    tipo_accidente: "propios_trabajo",
    dentro_fuera_empresa: "dentro",
    departamento_evento: "",
    municipio_evento: "",
    zona_evento: "urbana",
    area_ocurrencia: "",
    lugar_ocurrencia: LUGAR[1][0],
    lugar_otro: "",
    tipo_lesion: LESION[7][0],
    tipo_lesion_otro: "",
    parte_cuerpo: PARTE[0][0],
    agente_accidente: AGENTE[6][0],
    agente_otro: "",
    mecanismo: MECANISMO[3][0],
    mecanismo_otro: "",
    descripcion: "",
    // manejo
    causo_muerte: "false",
    primeros_auxilios: "false",
    remitido_centro_salud: "false",
    centro_salud: "",
    hospitalizado: "false",
    requirio_transporte: "false",
    // ausentismo
    ausentismo_tipo: "inicial",
    ausentismo_fecha_inicial: "",
    ausentismo_fecha_final: "",
    dias_incapacidad_inicial: 0,
    dias_prorroga: 0,
    dias_incapacidad: 0,
    cie10_codigo: "",
    cie10_diagnostico: "",
    // reporte legal
    testigos_presenciaron: "false",
    reportado_arl: "false",
    fecha_reporte_arl: "",
    furat_radicado: "",
    reportado_mintrabajo: "false",
    // investigación
    equipo_investigador: "",
    fecha_investigacion: "",
    ishikawa: ishikawaLIP(),
    causa_actos_inseguros: "",
    causa_condiciones_inseguras: "",
    causa_factores_personales: "",
    causa_factores_trabajo: "",
    observaciones_investigadores: "",
    // retroalimentación
    divulgacion_leccion: "",
    charla_seguridad: "",
    retroalimentacion: "",
    // firmas + cierre
    firmas: firmasVacias(),
    estado: "reportado",
    fecha_cierre: "",
  } as Record<string, any>
}

const labelOf = (o: [string, string][], v: any) => o.find(([k]) => k === String(v))?.[1] ?? (v ?? "")

/** Opcion + su detalle cuando es "Otro": "10. Otro (especificar) — se resbaló". */
const conOtro = (valor: any, otro: any) => {
  const v = String(valor ?? "")
  const o = String(otro ?? "").trim()
  return o ? `${v} — ${o}` : v
}

/**
 * ¿La opcion elegida es una de "Otro / especificar"?
 *
 * El formato pone una linea en blanco al lado de esas opciones. Aqui se usa
 * para mostrar el campo de texto SOLO cuando hace falta: pedirlo siempre seria
 * ruido en las otras quince opciones de cada lista.
 */
const esOtro = (v: any) => {
  const t = String(v ?? "").toLowerCase()
  return t.includes("otro") || t.includes("no clasificado")
}

/**
 * Pasa una fila de la base al formulario, para poder editarla.
 *
 * Los si/no viajan en el formulario como TEXTO ("true"/"false") porque los
 * pinta un <Select>, pero en la base son boolean: hay que devolverlos a texto
 * o el selector sale vacio y al guardar se perderia la respuesta. Lo mismo con
 * los null, que en un <Input> controlado lo dejan sin controlar.
 */
function desdeFila(r: IncidenteRow): Record<string, any> {
  const f: Record<string, any> = { ...vacio(null), ...(r as any) }
  BOOL_KEYS.forEach((k) => {
    const v = (r as any)[k]
    f[k] = v === true ? "true" : v === false ? "false" : ""
  })
  for (const k of Object.keys(f)) if (f[k] === null || f[k] === undefined) f[k] = ""
  f.ishikawa = (r as any).ishikawa || ishikawaLIP()
  f.firmas = (r as any).firmas || firmasVacias()
  // `cierre_arl` es NOT NULL en la base. La normalizacion de arriba dejaria ""
  // si la columna aun no existe, y al guardar se enviaria null y el update
  // fallaria; aqui se fuerza a boolean.
  f.cierre_arl = (r as any).cierre_arl === true
  return f
}

const desdeAccion = (a: IncidenteAccionRow) => ({
  plan: a.plan ?? "",
  tipo_control: a.tipo_control ?? "fuente",
  fecha_implementacion: a.fecha_implementacion ?? "",
  responsable_ejecucion: a.responsable_ejecucion ?? "",
  fecha_verificacion: a.fecha_verificacion ?? "",
  responsable_verificacion: a.responsable_verificacion ?? "",
  observacion: a.observacion ?? "",
  estado: a.estado ?? "pendiente",
})

const desdeTestigo = (t: IncidenteTestigoRow) => ({
  nombre: t.nombre ?? "",
  documento: t.documento ?? "",
  version: t.version ?? "",
  cargo: (t as any).cargo ?? "",
})

/** "SÍ" / "NO" para los campos si-no, que en el formulario viajan como texto
 *  ("true"/"false") y en la base como boolean. */
const siNo = (v: any) => (v === true || v === "true" ? "SÍ" : v === false || v === "false" ? "NO" : (v ?? ""))

const ROLES_FIRMA: [string, string][] = [
  ["jefe_inmediato", "Jefe inmediato / Coord. operación"],
  ["coordinador_sst", "Coordinador SST"],
  ["integrante_copasst", "Integrante COPASST"],
  ["responsable_sgsst", "Responsable SG-SST"],
  ["reviso", "Revisó"],
  ["cerro", "Cerró"],
  ["representante_legal", "Representante legal"],
]

export interface SeccionInforme {
  k: string
  titulo: string
  filas: [string, string][]
}

/**
 * Las seis secciones del SST-FOR-21, en el orden del formato.
 *
 * Se definen UNA sola vez porque las usan dos cosas: el PDF que se descarga y
 * la ventana de detalle del historial. Si cada una armara su propia lista, con
 * el tiempo el papel y la pantalla terminarian diciendo cosas distintas del
 * mismo evento, que en una investigacion de accidente es justo lo que no puede
 * pasar.
 */
function seccionesInforme(data: Record<string, any>): SeccionInforme[] {
  const ish = (data.ishikawa as IshikawaData) || null
  return [
    {
      k: "empleador",
      titulo: "1. IDENTIFICACIÓN DEL EMPLEADOR / CONTRATANTE",
      filas: [
        ["Razón social", EMPLEADOR_LIP.razon_social],
        ["Tipo id / NIT", `${EMPLEADOR_LIP.tipo_id} · ${EMPLEADOR_LIP.nit}`],
        ["Dirección", `${EMPLEADOR_LIP.direccion} · ${EMPLEADOR_LIP.municipio} (${EMPLEADOR_LIP.departamento})`],
        ["Correo", EMPLEADOR_LIP.email],
        ["Actividad económica", EMPLEADOR_LIP.actividad],
        ["Centro de trabajo", data.centro_trabajo ?? ""],
        [
          "Dirección / Municipio / Depto. del centro",
          `${data.centro_direccion ?? ""} · ${data.centro_municipio ?? ""} · ${data.centro_departamento ?? ""}`,
        ],
        [
          "Teléfono / Zona del centro",
          `${data.centro_telefono ?? ""} · ${labelOf(ZONA, data.centro_zona)}`,
        ],
        ["Clasificación / Severidad", `${labelOf(TIPOS, data.tipo)} · ${labelOf(GRAVEDAD, data.gravedad)}`],
        ["Fecha de reporte", data.fecha_reporte ?? ""],
      ],
    },
    {
      k: "persona",
      titulo: "2. INFORMACIÓN DE LA PERSONA",
      filas: [
        ["Nombres y apellidos", data.trabajador ?? ""],
        ["Documento", `${data.documento_tipo ?? ""} ${data.documento_numero ?? ""}`],
        ["Fecha nacimiento / Sexo", `${data.fecha_nacimiento ?? ""} · ${labelOf(SEXO, data.sexo)}`],
        [
          "Teléfono / Fax / Dirección",
          `${data.telefono ?? ""} · ${data.fax ?? ""} · ${data.direccion_trabajador ?? ""}`,
        ],
        [
          "EPS / ARL / AFP",
          `${data.eps ?? ""} (cód ${data.eps_codigo ?? ""}) · ${data.arl ?? ""} (cód ${data.arl_codigo ?? ""}) · ${data.afp ?? ""} (cód ${data.afp_codigo ?? ""})`,
        ],
        ["Cargo / Ocupación", `${data.cargo ?? ""} · ${data.ocupacion_habitual ?? ""} (cód ${data.codigo_ocupacion ?? ""})`],
        ["Vinculación", labelOf(VINCULACION, data.tipo_vinculacion)],
        [
          "Ingreso / Antigüedad en el cargo",
          `${data.fecha_ingreso ?? ""} · ${data.antiguedad_dias ?? 0} días, ${data.antiguedad_meses ?? 0} meses, ${data.antiguedad_anios ?? 0} años`,
        ],
        ["Salario / Jornada habitual", `$${(Number(data.salario) || 0).toLocaleString("es-CO")} · ${labelOf(JORNADA_HAB, data.jornada_habitual)}`],
        ["Funciones asignadas", data.funciones_asignadas ?? ""],
        ["EPP y dotación", data.epp_portado ?? ""],
      ],
    },
    {
      k: "evento",
      titulo: "3. INFORMACIÓN SOBRE EL ACCIDENTE / INCIDENTE",
      filas: [
        ["Fecha / Día / Hora", `${data.fecha_evento ?? ""} · ${labelOf(DIA_SEMANA, data.dia_semana)} · ${data.hora_evento ?? ""}`],
        ["Jornada / T. laborado previo", `${labelOf(JORNADA, data.jornada_evento)} · ${data.tiempo_laborado_previo ?? ""}`],
        ["¿Labor habitual? / Tipo", `${siNo(data.labor_habitual)} · ${labelOf(TIPO_ACC, data.tipo_accidente)}`],
        ["Ocurrió", `${labelOf(DENTRO_FUERA, data.dentro_fuera_empresa)} · ${data.departamento_evento ?? ""} ${data.municipio_evento ?? ""} (${labelOf(ZONA, data.zona_evento)})`],
        ["Área / Lugar", `${data.area_ocurrencia ?? ""} · ${conOtro(data.lugar_ocurrencia, data.lugar_otro)}`],
        ["Tipo de lesión", conOtro(data.tipo_lesion, data.tipo_lesion_otro)],
        ["Parte del cuerpo", data.parte_cuerpo ?? ""],
        ["Agente", conOtro(data.agente_accidente, data.agente_otro)],
        ["Mecanismo / forma", conOtro(data.mecanismo, data.mecanismo_otro)],
        ["Descripción", data.descripcion ?? ""],
      ],
    },
    {
      k: "manejo",
      titulo: "4. MANEJO Y AUSENTISMO",
      filas: [
        ["¿Causó muerte?", siNo(data.causo_muerte)],
        ["Primeros auxilios / Remitido", `${siNo(data.primeros_auxilios)} · ${siNo(data.remitido_centro_salud)} ${data.centro_salud ? "(" + data.centro_salud + ")" : ""}`],
        ["Hospitalizado / Transporte", `${siNo(data.hospitalizado)} · ${siNo(data.requirio_transporte)}`],
        ["Ausentismo", `${labelOf(AUS_TIPO, data.ausentismo_tipo)} · ${data.ausentismo_fecha_inicial ?? ""} → ${data.ausentismo_fecha_final ?? ""}`],
        ["Días inicial / prórroga / total", `${data.dias_incapacidad_inicial ?? 0} · ${data.dias_prorroga ?? 0} · ${data.dias_incapacidad ?? 0}`],
        ["CIE-10", `${data.cie10_codigo ?? ""} ${data.cie10_diagnostico ?? ""}`],
        ["Reporte legal", `ARL: ${siNo(data.reportado_arl)} (${data.fecha_reporte_arl ?? ""}) · FURAT: ${data.furat_radicado ?? ""} · MinTrabajo: ${siNo(data.reportado_mintrabajo)}`],
        // El cierre del expediente ARL es distinto del cierre de la
        // investigacion interna, por eso va aparte y no junto a `fecha_cierre`.
        ["Cierre expediente ARL", `${siNo(data.cierre_arl)}${data.fecha_cierre_arl ? " · " + data.fecha_cierre_arl : ""}`],
      ],
    },
    {
      k: "causas",
      titulo: "5. ANÁLISIS DE CAUSAS (Ishikawa · causalidad)",
      filas: [
        ["Efecto analizado", ish?.efecto ?? ""],
        ["Causas inmediatas – Actos inseguros", data.causa_actos_inseguros ?? ""],
        ["Causas inmediatas – Condiciones inseguras", data.causa_condiciones_inseguras ?? ""],
        ["Causas básicas – Factores personales", data.causa_factores_personales ?? ""],
        ["Causas básicas – Factores del trabajo", data.causa_factores_trabajo ?? ""],
        ["Observaciones investigadores", data.observaciones_investigadores ?? ""],
        ["Equipo investigador / Fecha", `${data.equipo_investigador ?? ""} · ${data.fecha_investigacion ?? ""}`],
      ],
    },
    {
      k: "retro",
      titulo: "6. RETROALIMENTACIÓN Y LECCIÓN APRENDIDA",
      filas: [
        ["Divulgación / lección aprendida", data.divulgacion_leccion ?? ""],
        ["Charla de seguridad", data.charla_seguridad ?? ""],
        ["Retroalimentación", data.retroalimentacion ?? ""],
        ["Estado del caso / Cierre", `${labelOf(ESTADOS, data.estado)} · ${data.fecha_cierre ?? ""}`],
      ],
    },
  ]
}

/** Texto comparable: sin mayusculas y sin tildes, para que buscar "zuniga"
 *  encuentre "Zúñiga". */
const comparable = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

/** Valor del desplegable "Todos": Radix no admite un SelectItem vacio. */
const TODOS = "__todos__"

/** Alto de la fila de encabezado; la de filtros se ancla justo debajo. */
const ALTO_ENCABEZADO = 34

/**
 * Tipo de referencia con el que se guarda el archivo de cierre de la ARL.
 *
 * Va al MISMO repositorio central que los demas soportes
 * (`soportes_documentales`, bucket "archivos") y no a un almacen aparte: asi el
 * documento sale en el repositorio de evidencias y en las auditorias sin que
 * haya que acordarse de un segundo lugar donde buscarlo.
 *
 * Pero con su propio `referencia_tipo`, distinto del "incidente" que usa la
 * columna Soportes. Si compartieran tipo, subir un soporte cualquiera dejaria
 * el cierre de la ARL marcado como historico, y al reves: son dos cosas
 * distintas y cada una lleva su propia version vigente.
 */
const REF_CIERRE_ARL = "incidente_cierre_arl"

type ColHistorial = {
  k: string
  l: string
  min: string
  filtro: "texto" | "lista" | "ninguno"
  centrado?: boolean
  ph?: string
}

// Una entrada por columna del historial. De aqui salen el encabezado, la fila
// de filtros y el filtrado, para que no puedan desalinearse entre si.
const COLUMNAS_HISTORIAL: ColHistorial[] = [
  { k: "fecha", l: "Fecha", min: "7.5rem", filtro: "texto", ph: "AAAA-MM-DD" },
  { k: "tipo", l: "Tipo", min: "10rem", filtro: "lista" },
  { k: "trabajador", l: "Trabajador", min: "15rem", filtro: "texto", ph: "Nombre…" },
  { k: "gravedad", l: "Gravedad", min: "7.5rem", filtro: "lista", centrado: true },
  { k: "dias", l: "Días", min: "5.5rem", filtro: "texto", centrado: true, ph: "N.º" },
  { k: "investigacion", l: "Investigación", min: "12rem", filtro: "lista" },
  { k: "estado", l: "Estado", min: "11rem", filtro: "lista" },
  { k: "pdf", l: "PDF", min: "8.5rem", filtro: "ninguno", centrado: true },
  { k: "soportes", l: "Soportes", min: "17rem", filtro: "ninguno" },
  { k: "cierre_arl", l: "Cierre ARL", min: "9rem", filtro: "lista", centrado: true },
  { k: "archivo_cierre", l: "Archivo de cierre ARL", min: "16rem", filtro: "ninguno" },
]

/** Dias entre el evento y la investigacion. null = todavia sin investigar. */
function diasInvestigacion(r: IncidenteRow): number | null {
  if (!r.fecha_investigacion) return null
  return Math.round(
    (new Date(r.fecha_investigacion).getTime() - new Date(r.fecha_evento).getTime()) / 86400000,
  )
}

/** La Res. 1401/2007 da 15 dias para investigar. */
function estadoInvestigacion(r: IncidenteRow): "Pendiente" | "En plazo" | "Fuera de plazo" {
  const d = diasInvestigacion(r)
  if (d === null) return "Pendiente"
  return d <= 15 ? "En plazo" : "Fuera de plazo"
}

/** Texto por el que se filtra cada columna. Es el MISMO que se ve en pantalla:
 *  si difirieran, filtrar por lo que uno lee no traeria la fila. */
function valorHistorial(r: IncidenteRow, k: string): string {
  switch (k) {
    // No hay columna "anio" en la tabla: este caso lo usa el filtro global,
    // que necesita leer el año de cada fila igual que las columnas.
    case "anio":
      // Se corta la cadena en vez de pasarla por Date: 'YYYY-MM-DD' se
      // interpreta en UTC y en Colombia un 1 de enero se leeria como 31 de
      // diciembre del anio anterior.
      return String(r.fecha_evento ?? "").slice(0, 4)
    case "fecha":
      return r.fecha_evento ?? ""
    case "tipo":
      return labelOf(TIPOS, r.tipo)
    case "trabajador":
      return r.trabajador ?? r.cargo ?? ""
    case "gravedad":
      return r.gravedad ?? ""
    case "dias":
      return String(r.dias_incapacidad ?? 0)
    case "investigacion":
      return estadoInvestigacion(r)
    case "estado":
      return labelOf(ESTADOS, r.estado)
    case "cierre_arl":
      return r.cierre_arl ? "Cerrado" : "Abierto"
    default:
      return ""
  }
}

/** Orden con el que se muestran las opciones de los desplegables que tienen un
 *  orden natural. Alfabetico dejaria "Fuera de plazo" antes que "Pendiente". */
const ORDEN_OPCIONES: Record<string, string[]> = {
  tipo: TIPOS.map(([, l]) => l),
  gravedad: GRAVEDAD.map(([v]) => v),
  investigacion: ["Pendiente", "En plazo", "Fuera de plazo"],
  estado: ESTADOS.map(([, l]) => l),
  cierre_arl: ["Abierto", "Cerrado"],
}

async function loadLogo(): Promise<string | null> {
  try {
    const r = await fetch("/lip-logo.png")
    const b = await r.blob()
    return await new Promise((res) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result as string)
      fr.onerror = () => res(null)
      fr.readAsDataURL(b)
    })
  } catch {
    return null
  }
}

export function InvestigacionAT({ selectedEmpresaId: propEmpresaId }: { selectedEmpresaId?: number | null }) {
  const { selectedEmpresaId: ctxEmpresaId } = useAuth()
  const empresaId = propEmpresaId ?? ctxEmpresaId ?? null
  const { toast } = useToast()
  const [tab, setTab] = useState("registrar")
  const [form, setForm] = useState<Record<string, any>>(() => vacio(empresaId))
  const [acciones, setAcciones] = useState<Record<string, any>[]>([vacioAccion()])
  const [testigos, setTestigos] = useState<Record<string, any>[]>([vacioTestigo()])
  const [rows, setRows] = useState<IncidenteRow[]>([])
  const [saving, setSaving] = useState(false)
  const [pdfId, setPdfId] = useState<number | "form" | null>(null)
  // Año en curso, para arrancar mostrando lo del periodo vigente.
  const [anio, setAnio] = useState<string>(TODOS)
  // Historial: un valor de filtro por columna (vacio o TODOS = sin filtrar).
  const [filtros, setFiltros] = useState<Record<string, string>>({})
  // Id de la investigacion que se esta editando. null = se esta creando una.
  const [editandoId, setEditandoId] = useState<number | null>(null)
  // Detalle (el ojo): la fila abierta con su plan de accion y sus testigos.
  const [detalle, setDetalle] = useState<IncidenteRow | null>(null)
  const [detalleAcciones, setDetalleAcciones] = useState<IncidenteAccionRow[]>([])
  const [detalleTestigos, setDetalleTestigos] = useState<IncidenteTestigoRow[]>([])
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [abriendoEdicion, setAbriendoEdicion] = useState<number | null>(null)
  const [cierreId, setCierreId] = useState<number | null>(null)
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))
  const setAcc = (i: number, k: string, v: any) => setAcciones((a) => a.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const setTes = (i: number, k: string, v: any) => setTestigos((a) => a.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const setFirma = (rol: string, k: string, v: any) =>
    setForm((f) => ({ ...f, firmas: { ...(f.firmas || {}), [rol]: { ...(f.firmas?.[rol] || {}), [k]: v } } }))

  async function cargar() {
    setRows(await listIncidentes(empresaId))
  }

  const setFiltro = (k: string, v: string) => setFiltros((prev) => ({ ...prev, [k]: v }))
  const limpiarFiltros = () => setFiltros({})

  // Años presentes en los datos, del mas reciente al mas antiguo: lo que se
  // consulta casi siempre es el año en curso, y asi queda de primero.
  const aniosDisponibles = useMemo(
    () =>
      [...new Set(rows.map((r) => valorHistorial(r, "anio")).filter(Boolean))].sort((a, b) =>
        b.localeCompare(a),
      ),
    [rows],
  )

  /**
   * Base de TODO el modulo una vez aplicado el año.
   *
   * Las tarjetas y la tabla salen de aqui, no de `rows`. Antes los indicadores
   * se calculaban sobre el total historico mientras la tabla mostraba otra
   * cosa: se leia "3 accidentes" con una sola fila a la vista, y los dos
   * numeros eran correctos por separado pero juntos no se podian explicar.
   */
  const filasDelAnio = useMemo(
    () => (anio === TODOS ? rows : rows.filter((r) => valorHistorial(r, "anio") === anio)),
    [rows, anio],
  )

  // Las opciones de cada desplegable se arman con lo que REALMENTE hay en los
  // datos, no con una lista fija: asi ninguna opcion devuelve cero filas.
  const opcionesPorColumna = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const c of COLUMNAS_HISTORIAL) {
      if (c.filtro !== "lista") continue
      const presentes = [...new Set(filasDelAnio.map((r) => valorHistorial(r, c.k)).filter(Boolean))]
      const orden = ORDEN_OPCIONES[c.k]
      if (orden) {
        m[c.k] = orden.filter((o) => presentes.includes(o))
      } else {
        m[c.k] = presentes.sort((a, b) => a.localeCompare(b, "es"))
      }
    }
    return m
  }, [filasDelAnio])

  const filtrosActivos = COLUMNAS_HISTORIAL.filter((c) => {
    const v = filtros[c.k] ?? ""
    if (c.filtro === "ninguno") return false
    return c.filtro === "lista" ? Boolean(v) && v !== TODOS : v.trim() !== ""
  })
  const hayFiltro = filtrosActivos.length > 0
  const resumenFiltros = filtrosActivos.map((c) => `${c.l}: ${filtros[c.k]}`).join(" · ")

  const filas = useMemo(() => {
    const activos = COLUMNAS_HISTORIAL.map((c) => ({ c, v: filtros[c.k] ?? "" })).filter(({ c, v }) =>
      c.filtro === "ninguno" ? false : c.filtro === "lista" ? Boolean(v) && v !== TODOS : v.trim() !== "",
    )
    if (activos.length === 0) return filasDelAnio
    return filasDelAnio.filter((r) =>
      activos.every(({ c, v }) =>
        // Los desplegables exigen coincidencia exacta; los de texto buscan por
        // fragmento, para poder escribir "sando" y encontrar "Sandoval".
        c.filtro === "lista"
          ? valorHistorial(r, c.k) === v
          : comparable(valorHistorial(r, c.k)).includes(comparable(v)),
      ),
    )
  }, [filasDelAnio, filtros])

  // ---- El ojo: ver la investigacion completa sin abrir el formulario ----
  async function abrirDetalle(r: IncidenteRow) {
    setDetalle(r)
    setDetalleAcciones([])
    setDetalleTestigos([])
    setCargandoDetalle(true)
    try {
      const [accs, tess] = await Promise.all([listAcciones(r.id!), listTestigos(r.id!)])
      setDetalleAcciones(accs)
      setDetalleTestigos(tess)
    } finally {
      setCargandoDetalle(false)
    }
  }

  // ---- Editar: trae la investigacion al formulario de Registrar ----
  async function editar(r: IncidenteRow) {
    if (!r.id) return
    setAbriendoEdicion(r.id)
    try {
      const [accs, tess] = await Promise.all([listAcciones(r.id), listTestigos(r.id)])
      setForm(desdeFila(r))
      setAcciones(accs.length ? accs.map(desdeAccion) : [vacioAccion()])
      setTestigos(tess.length ? tess.map(desdeTestigo) : [vacioTestigo()])
      setEditandoId(r.id)
      setDetalle(null)
      setTab("registrar")
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (e: any) {
      toast({ title: "No se pudo abrir para editar", description: e?.message })
    } finally {
      setAbriendoEdicion(null)
    }
  }

  function cancelarEdicion() {
    setForm(vacio(empresaId))
    setAcciones([vacioAccion()])
    setTestigos([vacioTestigo()])
    setEditandoId(null)
  }

  // ---- Cierre del expediente ARL ----
  async function marcarCierreArl(r: IncidenteRow, valor: boolean) {
    if (!r.id) return
    setCierreId(r.id)
    // La fecha se pone sola al marcar y se limpia al desmarcar. Pedirla aparte
    // solo lograria que quedara vacia, y es justo el dato que acredita ante una
    // auditoria cuando se cerro el expediente.
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" })
    const res = await updateIncidente(r.id, {
      cierre_arl: valor,
      fecha_cierre_arl: valor ? hoy : null,
    })
    setCierreId(null)
    if (!res.success) {
      toast({ title: "No se pudo actualizar el cierre ARL", description: res.message })
      return
    }
    toast({ title: valor ? "Expediente ARL marcado como cerrado" : "Cierre ARL desmarcado" })
    await cargar()
  }
  useEffect(() => {
    cargar()
    // al cambiar de proyecto, prellenar el centro de trabajo si aún es un form nuevo
    setForm((f) => {
      const c = (empresaId && CENTROS[empresaId]) || null
      if (c && !f.trabajador) return { ...f, centro_trabajo: c.nombre, centro_direccion: c.direccion, centro_municipio: c.municipio }
      return f
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  async function guardar() {
    setSaving(true)
    const payload: Record<string, any> = { ...form }
    BOOL_KEYS.forEach((k) => {
      payload[k] = payload[k] === "true"
    })
    Object.keys(payload).forEach((k) => {
      if (payload[k] === "") payload[k] = null
    })
    const accs = acciones.map((a) => {
      const c = { ...a }
      Object.keys(c).forEach((k) => {
        if (c[k] === "") c[k] = null
      })
      return c
    })
    const tess = testigos.filter((t) => (t.nombre || "").trim() || (t.documento || "").trim())
    // Editando se actualiza el registro que ya existe; si no, se crea uno
    // nuevo. Sin esta bifurcacion, corregir una investigacion creaba un
    // duplicado y el historial terminaba con el mismo accidente dos veces.
    const res = editandoId
      ? await actualizarIncidenteCompleto(
          editandoId,
          payload as Partial<IncidenteRow>,
          accs as Partial<IncidenteAccionRow>[],
          tess as Partial<IncidenteTestigoRow>[],
          empresaId,
        )
      : await saveIncidente(
          payload as Partial<IncidenteRow>,
          accs as Partial<IncidenteAccionRow>[],
          empresaId,
          tess as Partial<IncidenteTestigoRow>[],
        )
    setSaving(false)
    if (res.success) {
      toast({
        title: editandoId
          ? "Investigación actualizada (SST-FOR-21)"
          : "Investigación guardada (SST-FOR-21)",
      })
      setForm(vacio(empresaId))
      setAcciones([vacioAccion()])
      setTestigos([vacioTestigo()])
      setEditandoId(null)
      await cargar()
      setTab("historial")
    } else {
      toast({ title: "Error al guardar", description: res.message ?? "Intenta de nuevo." })
    }
  }

  // ---- PDF calcado del formato LIP ----
  async function generarPDF(data: Record<string, any>, accs: any[], tess: any[]) {
    const { default: jsPDF } = await import("jspdf")
    const autoTable = (await import("jspdf-autotable")).default
    const doc = new jsPDF({ unit: "pt", format: "letter" })
    const MW = doc.internal.pageSize.getWidth()
    const navy: [number, number, number] = [13, 59, 110]
    const logo = await loadLogo()
    if (logo) { try { doc.addImage(logo, "PNG", 40, 28, 96, 30) } catch {} }
    doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(...navy)
    doc.text("FORMATO DE INVESTIGACIÓN DE ACCIDENTE / INCIDENTE LABORAL", MW / 2, 40, { align: "center" })
    doc.setFontSize(8).setFont("helvetica", "normal").setTextColor(90)
    doc.text("Seguridad y Salud en el Trabajo · Código: SST-FOR-21 · Res. 1401/2007", MW / 2, 54, { align: "center" })
    doc.text(EMPLEADOR_LIP.razon_social + " · NIT " + EMPLEADOR_LIP.nit, MW - 40, 34, { align: "right" })

    const sec = (title: string, body: any[][]) =>
      autoTable(doc, {
        startY: (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 8 : 68,
        head: [[{ content: title, colSpan: 2 }]],
        body,
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 2, textColor: 20 },
        headStyles: { fillColor: navy, textColor: 255, fontStyle: "bold", fontSize: 8 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 150 } },
      })

    // Las secciones salen de `seccionesInforme`, la misma definicion que usa la
    // ventana de detalle del historial. Aqui solo se decide en que orden se
    // intercalan con las tablas de testigos, plan de accion y firmas.
    const secciones = seccionesInforme(data)
    const pintar = (k: string) => {
      const s = secciones.find((x) => x.k === k)
      if (s) sec(s.titulo, s.filas)
    }

    pintar("empleador")
    pintar("persona")
    pintar("evento")
    pintar("manejo")

    if (tess.length) {
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 8,
        head: [["TESTIGO", "CÉDULA", "VERSIÓN"]],
        body: tess.map((t) => [t.nombre ?? "", t.documento ?? "", t.version ?? ""]),
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: navy, textColor: 255, fontSize: 8 },
      })
    }

    pintar("causas")

    if (accs.length) {
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 8,
        head: [["MEDIDA DE INTERVENCIÓN", "CONTROL", "RESP. EJEC.", "F. IMPL.", "VERIFICA", "ESTADO"]],
        body: accs.map((a) => [
          a.plan ?? "", labelOf(CONTROL, a.tipo_control), a.responsable_ejecucion ?? "",
          a.fecha_implementacion ?? "", a.responsable_verificacion ?? "", a.estado ?? "",
        ]),
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: navy, textColor: 255, fontSize: 7.5 },
      })
    }

    pintar("retro")

    const fr = data.firmas || {}
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 8,
      head: [["ROL", "NOMBRE", "CARGO", "C.C."]],
      body: ROLES_FIRMA.map(([k, l]) => [l, fr[k]?.nombre ?? "", fr[k]?.cargo ?? "", fr[k]?.cc ?? ""]),
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: navy, textColor: 255, fontSize: 8 },
    })
    doc.save(`SST-FOR-21 investigacion ${(data.trabajador || "").trim() || data.fecha_evento || ""}.pdf`)
  }

  async function pdfDesdeHistorial(r: IncidenteRow) {
    setPdfId(r.id!)
    try {
      const [accs, tess] = await Promise.all([listAcciones(r.id!), listTestigos(r.id!)])
      await generarPDF(r as any, accs, tess)
    } catch (e: any) {
      toast({ title: "No se pudo generar el PDF", description: e?.message })
    } finally {
      setPdfId(null)
    }
  }

  // Los indicadores se calculan sobre el año elegido, no sobre el historico.
  const kpis = useMemo(() => {
    const c = (f: (r: IncidenteRow) => boolean) => filasDelAnio.filter(f).length
    const inv = filasDelAnio.filter((r) => r.tipo !== "incidente")
    const enPlazo = inv.filter(
      (r) =>
        r.fecha_investigacion &&
        (new Date(r.fecha_investigacion).getTime() - new Date(r.fecha_evento).getTime()) / 86400000 <= 15,
    ).length
    return {
      acc: c((r) => r.tipo === "accidente"),
      inc: c((r) => r.tipo === "incidente"),
      el: c((r) => r.tipo === "enfermedad_laboral"),
      graves: c((r) => r.gravedad === "grave"),
      mortales: c((r) => r.gravedad === "mortal"),
      dias: filasDelAnio.reduce((s, r) => s + (Number(r.dias_incapacidad) || 0), 0),
      pct: inv.length ? Math.round((100 * enPlazo) / inv.length) : 0,
    }
  }, [filasDelAnio])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold" style={{ color: SST_TOKENS.navy }}>
          Investigación de Accidentes / Incidentes (SST-FOR-21)
        </h2>
        <Badge variant="outline">Formato original LIP · Res. 1401/2007 · investigación ≤ 15 días</Badge>
      </div>

      {/* El año va ARRIBA de las tarjetas y no dentro de la tabla: manda sobre
          todo el modulo, y puesto aqui se lee como el encabezado de lo que
          muestran los indicadores. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium" style={{ color: SST_TOKENS.navy }}>
          Año:
        </span>
        <div className="w-40">
          <S
            v={anio}
            on={setAnio}
            o={[[TODOS, "Todos los años"], ...aniosDisponibles.map((a) => [a, a] as [string, string])]}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {anio === TODOS
            ? `Indicadores e historial sobre las ${rows.length} investigaciones registradas.`
            : `Indicadores e historial de ${anio}: ${filasDelAnio.length} de ${rows.length} investigaciones.`}
        </span>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-7">
        <Kpi t="Accidentes" v={kpis.acc} />
        <Kpi t="Incidentes" v={kpis.inc} />
        <Kpi t="Enf. laborales" v={kpis.el} />
        <Kpi t="AT graves" v={kpis.graves} c={SST_TOKENS.warn} />
        <Kpi t="AT mortales" v={kpis.mortales} c={SST_TOKENS.bad} />
        <Kpi t="Días perdidos" v={kpis.dias} />
        <Kpi t="Investig. ≤15d" v={`${kpis.pct}%`} c={SST_TOKENS.ok} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="registrar">Registrar</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="registrar">
          <Card className="p-4 space-y-6">
            {/* Sin este aviso no habria como saber que lo que se ve en pantalla
                es un registro existente y no uno nuevo: el formulario es el
                mismo y guardar sobrescribiria sin advertencia. */}
            {editandoId !== null && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm text-amber-900">
                  <span className="font-semibold">Estás editando una investigación ya registrada</span>
                  {form.trabajador ? ` · ${form.trabajador}` : ""}
                  {form.fecha_evento ? ` · ${form.fecha_evento}` : ""}. Al guardar se reemplazan sus
                  datos, su plan de acción y sus testigos.
                </p>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={cancelarEdicion}>
                  <X className="h-3.5 w-3.5" />
                  Cancelar edición
                </Button>
              </div>
            )}

            {/* Encabezado fijo LIP */}
            <div className="rounded-lg border p-3" style={{ background: SST_TOKENS.light }}>
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/lip-logo.png" alt="LIP" className="h-8" />
                <div className="text-xs" style={{ color: SST_TOKENS.ink }}>
                  <div className="font-bold">{EMPLEADOR_LIP.razon_social}</div>
                  <div>NIT {EMPLEADOR_LIP.nit} · {EMPLEADOR_LIP.direccion}, {EMPLEADOR_LIP.municipio} · {EMPLEADOR_LIP.email}</div>
                </div>
                <Badge variant="outline" className="ml-auto">SST-FOR-21</Badge>
              </div>
            </div>

            <Sec n="1. Clasificación y centro de trabajo">
              <G3>
                <F l="Tipo (clasificación del evento)"><S v={form.tipo} on={(v) => set("tipo", v)} o={TIPOS} /></F>
                <F l="Severidad del evento"><S v={form.gravedad} on={(v) => set("gravedad", v)} o={GRAVEDAD} /></F>
                <F l="Fecha de reporte"><DatePickerField value={form.fecha_reporte} onChange={(value) => set("fecha_reporte", value)} /></F>
                <F l="Centro de trabajo"><Input value={form.centro_trabajo} onChange={(e) => set("centro_trabajo", e.target.value)} /></F>
                <F l="Dirección centro"><Input value={form.centro_direccion} onChange={(e) => set("centro_direccion", e.target.value)} /></F>
                <F l="Departamento centro"><Input value={form.centro_departamento} onChange={(e) => set("centro_departamento", e.target.value)} /></F>
                <F l="Municipio centro"><Input value={form.centro_municipio} onChange={(e) => set("centro_municipio", e.target.value)} /></F>
                <F l="Teléfono centro"><Input value={form.centro_telefono} onChange={(e) => set("centro_telefono", e.target.value)} /></F>
                <F l="Zona del centro"><S v={form.centro_zona} on={(v) => set("centro_zona", v)} o={ZONA} /></F>
              </G3>
            </Sec>

            <Sec n="2. Información de la persona">
              <G3>
                <F l="Nombres y apellidos completos"><Input value={form.trabajador} onChange={(e) => set("trabajador", e.target.value)} /></F>
                <F l="Tipo de documento"><S v={form.documento_tipo} on={(v) => set("documento_tipo", v)} o={DOC_TIPO} /></F>
                <F l="N° de documento"><Input value={form.documento_numero} onChange={(e) => set("documento_numero", e.target.value)} /></F>
                <F l="Fecha de nacimiento"><DatePickerField value={form.fecha_nacimiento} onChange={(value) => set("fecha_nacimiento", value)} /></F>
                <F l="Sexo"><S v={form.sexo} on={(v) => set("sexo", v)} o={SEXO} /></F>
                <F l="Teléfono"><Input value={form.telefono} onChange={(e) => set("telefono", e.target.value)} /></F>
                <F l="Fax"><Input value={form.fax} onChange={(e) => set("fax", e.target.value)} /></F>
                <F l="Dirección de residencia"><Input value={form.direccion_trabajador} onChange={(e) => set("direccion_trabajador", e.target.value)} /></F>
                <F l="EPS"><Input value={form.eps} onChange={(e) => set("eps", e.target.value)} /></F>
                <F l="Código EPS"><Input value={form.eps_codigo} onChange={(e) => set("eps_codigo", e.target.value)} /></F>
                <F l="ARL"><Input value={form.arl} onChange={(e) => set("arl", e.target.value)} /></F>
                <F l="Código ARL"><Input value={form.arl_codigo} onChange={(e) => set("arl_codigo", e.target.value)} /></F>
                <F l="AFP"><Input value={form.afp} onChange={(e) => set("afp", e.target.value)} /></F>
                <F l="Código AFP"><Input value={form.afp_codigo} onChange={(e) => set("afp_codigo", e.target.value)} /></F>
                <F l="Cargo"><Input value={form.cargo} onChange={(e) => set("cargo", e.target.value)} /></F>
                <F l="Ocupación habitual"><Input value={form.ocupacion_habitual} onChange={(e) => set("ocupacion_habitual", e.target.value)} /></F>
                <F l="Código ocupación"><Input value={form.codigo_ocupacion} onChange={(e) => set("codigo_ocupacion", e.target.value)} /></F>
                <F l="Tipo de vinculación"><S v={form.tipo_vinculacion} on={(v) => set("tipo_vinculacion", v)} o={VINCULACION} /></F>
                <F l="Fecha de ingreso"><DatePickerField value={form.fecha_ingreso} onChange={(value) => set("fecha_ingreso", value)} /></F>
                <F l="Antigüedad — días"><Input type="number" value={form.antiguedad_dias} onChange={(e) => set("antiguedad_dias", Number(e.target.value))} /></F>
                <F l="Antigüedad — meses"><Input type="number" value={form.antiguedad_meses} onChange={(e) => set("antiguedad_meses", Number(e.target.value))} /></F>
                <F l="Antigüedad — años"><Input type="number" value={form.antiguedad_anios} onChange={(e) => set("antiguedad_anios", Number(e.target.value))} /></F>
                <F l="Salario / honorarios (mes)"><Input type="number" value={form.salario} onChange={(e) => set("salario", Number(e.target.value))} /></F>
                <F l="Jornada de trabajo habitual"><S v={form.jornada_habitual} on={(v) => set("jornada_habitual", v)} o={JORNADA_HAB} /></F>
              </G3>
              <F l="Funciones asignadas"><Textarea value={form.funciones_asignadas} onChange={(e) => set("funciones_asignadas", e.target.value)} /></F>
              <F l="EPP y dotación que portaba"><Input value={form.epp_portado} onChange={(e) => set("epp_portado", e.target.value)} /></F>
            </Sec>

            <Sec n="3. Información sobre el accidente / incidente">
              <G3>
                <F l="Fecha del evento"><DatePickerField value={form.fecha_evento} onChange={(value) => set("fecha_evento", value)} /></F>
                <F l="Día de la semana"><S v={form.dia_semana} on={(v) => set("dia_semana", v)} o={DIA_SEMANA} /></F>
                <F l="Hora (0–23) : minutos"><Input value={form.hora_evento} onChange={(e) => set("hora_evento", e.target.value)} placeholder="HH:MM" /></F>
                <F l="Tiempo laborado previo"><Input value={form.tiempo_laborado_previo} onChange={(e) => set("tiempo_laborado_previo", e.target.value)} placeholder="HH:MM" /></F>
                <F l="Jornada en que sucede"><S v={form.jornada_evento} on={(v) => set("jornada_evento", v)} o={JORNADA} /></F>
                <F l="¿Realizaba labor habitual?"><S v={form.labor_habitual} on={(v) => set("labor_habitual", v)} o={SN} /></F>
                <F l="Tipo de accidente"><S v={form.tipo_accidente} on={(v) => set("tipo_accidente", v)} o={TIPO_ACC} /></F>
                <F l="Se produjo"><S v={form.dentro_fuera_empresa} on={(v) => set("dentro_fuera_empresa", v)} o={DENTRO_FUERA} /></F>
                <F l="Departamento del accidente"><Input value={form.departamento_evento} onChange={(e) => set("departamento_evento", e.target.value)} /></F>
                <F l="Municipio del accidente"><Input value={form.municipio_evento} onChange={(e) => set("municipio_evento", e.target.value)} /></F>
                <F l="Zona"><S v={form.zona_evento} on={(v) => set("zona_evento", v)} o={ZONA} /></F>
                <F l="Área donde ocurrió"><Input value={form.area_ocurrencia} onChange={(e) => set("area_ocurrencia", e.target.value)} /></F>
                <F l="Lugar donde ocurrió"><S v={form.lugar_ocurrencia} on={(v) => set("lugar_ocurrencia", v)} o={LUGAR} /></F>
                {esOtro(form.lugar_ocurrencia) && (
                  <F l="¿Cuál lugar?"><Input value={form.lugar_otro} onChange={(e) => set("lugar_otro", e.target.value)} placeholder="Especifique" /></F>
                )}
              </G3>
              <G2>
                <F l="Tipo de lesión"><S v={form.tipo_lesion} on={(v) => set("tipo_lesion", v)} o={LESION} /></F>
                {esOtro(form.tipo_lesion) && (
                  <F l="¿Cuál lesión?"><Input value={form.tipo_lesion_otro} onChange={(e) => set("tipo_lesion_otro", e.target.value)} placeholder="Especifique" /></F>
                )}
                <F l="Parte del cuerpo afectada"><S v={form.parte_cuerpo} on={(v) => set("parte_cuerpo", v)} o={PARTE} /></F>
                <F l="Agente del accidente"><S v={form.agente_accidente} on={(v) => set("agente_accidente", v)} o={AGENTE} /></F>
                {esOtro(form.agente_accidente) && (
                  <F l="¿Cuál agente?"><Input value={form.agente_otro} onChange={(e) => set("agente_otro", e.target.value)} placeholder="Especifique" /></F>
                )}
                <F l="Mecanismo o forma del accidente"><S v={form.mecanismo} on={(v) => set("mecanismo", v)} o={MECANISMO} /></F>
                {esOtro(form.mecanismo) && (
                  <F l="¿Cuál mecanismo?"><Input value={form.mecanismo_otro} onChange={(e) => set("mecanismo_otro", e.target.value)} placeholder="Especifique" /></F>
                )}
              </G2>
              <F l="Descripción del accidente / incidente"><Textarea rows={4} value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} /></F>
            </Sec>

            <Sec n="4. Testigos">
              {testigos.map((t, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-12 items-end border rounded p-2">
                  <div className="md:col-span-4"><F l="Nombre del testigo"><Input value={t.nombre} onChange={(e) => setTes(i, "nombre", e.target.value)} /></F></div>
                  <div className="md:col-span-2"><F l="Cédula"><Input value={t.documento} onChange={(e) => setTes(i, "documento", e.target.value)} /></F></div>
                  <div className="md:col-span-5"><F l="Versión del testigo"><Input value={t.version} onChange={(e) => setTes(i, "version", e.target.value)} /></F></div>
                  <div className="md:col-span-1">
                    {testigos.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => setTestigos((x) => x.filter((_, j) => j !== i))}>Quitar</Button>
                    )}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setTestigos((x) => [...x, vacioTestigo()])}>+ Agregar testigo</Button>
            </Sec>

            <Sec n="5. Manejo del accidente y ausentismo">
              <G3>
                <F l="¿Causó la muerte?"><S v={form.causo_muerte} on={(v) => set("causo_muerte", v)} o={SN} /></F>
                <F l="¿Recibió primeros auxilios?"><S v={form.primeros_auxilios} on={(v) => set("primeros_auxilios", v)} o={SN} /></F>
                <F l="¿Remitido a centro de salud?"><S v={form.remitido_centro_salud} on={(v) => set("remitido_centro_salud", v)} o={SN} /></F>
                <F l="¿Cuál centro de salud?"><Input value={form.centro_salud} onChange={(e) => set("centro_salud", e.target.value)} /></F>
                <F l="¿Hospitalizado?"><S v={form.hospitalizado} on={(v) => set("hospitalizado", v)} o={SN} /></F>
                <F l="¿Requirió transporte?"><S v={form.requirio_transporte} on={(v) => set("requirio_transporte", v)} o={SN} /></F>
                <F l="Tipo de ausentismo"><S v={form.ausentismo_tipo} on={(v) => set("ausentismo_tipo", v)} o={AUS_TIPO} /></F>
                <F l="Fecha inicial"><DatePickerField value={form.ausentismo_fecha_inicial} onChange={(value) => set("ausentismo_fecha_inicial", value)} /></F>
                <F l="Fecha final"><DatePickerField value={form.ausentismo_fecha_final} onChange={(value) => set("ausentismo_fecha_final", value)} /></F>
                <F l="Días incapacidad inicial"><Input type="number" value={form.dias_incapacidad_inicial} onChange={(e) => set("dias_incapacidad_inicial", Number(e.target.value))} /></F>
                <F l="Días de prórroga"><Input type="number" value={form.dias_prorroga} onChange={(e) => set("dias_prorroga", Number(e.target.value))} /></F>
                <F l="Días de ausentismo total"><Input type="number" value={form.dias_incapacidad} onChange={(e) => set("dias_incapacidad", Number(e.target.value))} /></F>
                <F l="Código CIE-10"><Input value={form.cie10_codigo} onChange={(e) => set("cie10_codigo", e.target.value)} /></F>
                <F l="Diagnóstico CIE-10"><Input value={form.cie10_diagnostico} onChange={(e) => set("cie10_diagnostico", e.target.value)} /></F>
              </G3>
            </Sec>

            <Sec n="6. Reporte legal">
              <p className="text-xs p-2 rounded" style={{ background: "#FFF7E6", color: "#8a6d00" }}>
                AT grave o mortal: reportar a ARL/EPS y MinTrabajo dentro de 2 días hábiles.
              </p>
              <G3>
                <F l="¿Reportado a ARL?"><S v={form.reportado_arl} on={(v) => set("reportado_arl", v)} o={SN} /></F>
                <F l="Fecha reporte ARL"><DatePickerField value={form.fecha_reporte_arl} onChange={(value) => set("fecha_reporte_arl", value)} /></F>
                <F l="FURAT radicado"><Input value={form.furat_radicado} onChange={(e) => set("furat_radicado", e.target.value)} /></F>
                <F l="¿Reportado a MinTrabajo?"><S v={form.reportado_mintrabajo} on={(v) => set("reportado_mintrabajo", v)} o={SN} /></F>
              </G3>
            </Sec>

            <Sec n="7. Investigación — metodología y causas (≤ 15 días)">
              <F l="Equipo investigador">
                <Input value={form.equipo_investigador} onChange={(e) => set("equipo_investigador", e.target.value)} placeholder="Jefe inmediato, COPASST, resp. SST…" />
              </F>
              <div className="space-y-1">
                <label className="text-sm font-medium" style={{ color: SST_TOKENS.navy }}>
                  Metodología de investigación (espina de pescado · Ishikawa)
                </label>
                <EspinaPescado value={form.ishikawa as IshikawaData} onChange={(v) => set("ishikawa", v)} />
              </div>
              <CuadrosCausas
                value={{
                  actos_inseguros: form.causa_actos_inseguros ?? "",
                  condiciones_inseguras: form.causa_condiciones_inseguras ?? "",
                  factores_personales: form.causa_factores_personales ?? "",
                  factores_trabajo: form.causa_factores_trabajo ?? "",
                  observaciones: form.observaciones_investigadores ?? "",
                } as CuadrosCausasData}
                onChange={(patch) => {
                  if (patch.actos_inseguros !== undefined) set("causa_actos_inseguros", patch.actos_inseguros)
                  if (patch.condiciones_inseguras !== undefined) set("causa_condiciones_inseguras", patch.condiciones_inseguras)
                  if (patch.factores_personales !== undefined) set("causa_factores_personales", patch.factores_personales)
                  if (patch.factores_trabajo !== undefined) set("causa_factores_trabajo", patch.factores_trabajo)
                  if (patch.observaciones !== undefined) set("observaciones_investigadores", patch.observaciones)
                }}
              />
              <F l="Fecha de investigación"><DatePickerField value={form.fecha_investigacion} onChange={(value) => set("fecha_investigacion", value)} /></F>
            </Sec>

            <Sec n="8. Planes de acción (control Fuente / Medio / Individuo)">
              {acciones.map((a, i) => (
                <div key={i} className="border rounded p-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium" style={{ color: SST_TOKENS.ink }}>Acción {i + 1}</span>
                    {acciones.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => setAcciones((x) => x.filter((_, j) => j !== i))}>Quitar</Button>
                    )}
                  </div>
                  <F l="Medida de intervención necesaria"><Input value={a.plan} onChange={(e) => setAcc(i, "plan", e.target.value)} /></F>
                  <G3>
                    <F l="Tipo de control"><S v={a.tipo_control} on={(v) => setAcc(i, "tipo_control", v)} o={CONTROL} /></F>
                    <F l="Fecha implementación"><DatePickerField value={a.fecha_implementacion} onChange={(value) => setAcc(i, "fecha_implementacion", value)} /></F>
                    <F l="Responsable ejecución"><Input value={a.responsable_ejecucion} onChange={(e) => setAcc(i, "responsable_ejecucion", e.target.value)} /></F>
                    <F l="Fecha verificación"><DatePickerField value={a.fecha_verificacion} onChange={(value) => setAcc(i, "fecha_verificacion", value)} /></F>
                    <F l="Responsable verificación"><Input value={a.responsable_verificacion} onChange={(e) => setAcc(i, "responsable_verificacion", e.target.value)} /></F>
                    <F l="Estado">
                      <S v={a.estado} on={(v) => setAcc(i, "estado", v)} o={[["pendiente", "Pendiente"], ["implementado", "Implementado"], ["verificado", "Verificado"]]} />
                    </F>
                  </G3>
                  <F l="Observación"><Input value={a.observacion} onChange={(e) => setAcc(i, "observacion", e.target.value)} /></F>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setAcciones((x) => [...x, vacioAccion()])}>+ Agregar acción</Button>
            </Sec>

            <Sec n="9. Retroalimentación y lección aprendida">
              <F l="Divulgación del evento y lección aprendida"><Textarea value={form.divulgacion_leccion} onChange={(e) => set("divulgacion_leccion", e.target.value)} /></F>
              <G2>
                <F l="Charla de seguridad"><Input value={form.charla_seguridad} onChange={(e) => set("charla_seguridad", e.target.value)} /></F>
                <F l="Retroalimentación"><Input value={form.retroalimentacion} onChange={(e) => set("retroalimentacion", e.target.value)} /></F>
              </G2>
            </Sec>

            <Sec n="10. Firmas y responsables de revisión / cierre">
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ["jefe_inmediato", "Jefe inmediato / Coord. operación"],
                  ["coordinador_sst", "Coordinador SST"],
                  ["integrante_copasst", "Integrante del COPASST"],
                  ["responsable_sgsst", "Responsable SG-SST"],
                  ["reviso", "Revisó la investigación"],
                  ["cerro", "Cerró la investigación"],
                  ["representante_legal", "Representante legal"],
                ].map(([rol, lab]) => (
                  <div key={rol} className="border rounded p-2 space-y-1">
                    <p className="text-xs font-semibold" style={{ color: SST_TOKENS.navy }}>{lab}</p>
                    <div className="grid gap-2 md:grid-cols-3">
                      <Input placeholder="Nombre" value={form.firmas?.[rol]?.nombre ?? ""} onChange={(e) => setFirma(rol, "nombre", e.target.value)} />
                      <Input placeholder="Cargo" value={form.firmas?.[rol]?.cargo ?? ""} onChange={(e) => setFirma(rol, "cargo", e.target.value)} />
                      <Input placeholder="C.C." value={form.firmas?.[rol]?.cc ?? ""} onChange={(e) => setFirma(rol, "cc", e.target.value)} />
                    </div>
                  </div>
                ))}
              </div>
            </Sec>

            <G2>
              <F l="Estado del caso"><S v={form.estado} on={(v) => set("estado", v)} o={ESTADOS} /></F>
              <F l="Fecha de cierre"><DatePickerField value={form.fecha_cierre} onChange={(value) => set("fecha_cierre", value)} /></F>
            </G2>

            <div className="flex flex-wrap gap-2">
              <Button onClick={guardar} disabled={saving} style={{ background: SST_TOKENS.navy, color: "white" }}>
                {saving
                  ? "Guardando…"
                  : editandoId !== null
                    ? "Actualizar investigación"
                    : "Guardar investigación"}
              </Button>
              {editandoId !== null && (
                <Button variant="ghost" onClick={cancelarEdicion} disabled={saving}>
                  Cancelar edición
                </Button>
              )}
              <Button variant="outline" onClick={() => generarPDF(form, acciones, testigos)}>
                <FileText className="mr-1 h-4 w-4" /> Vista previa PDF (SST-FOR-21)
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="historial" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {filas.length === filasDelAnio.length
                ? `${filas.length} registro(s)`
                : `${filas.length} de ${filasDelAnio.length} registro(s)`}
              {anio !== TODOS ? ` · Año: ${anio}` : ""}
              {resumenFiltros ? ` · ${resumenFiltros}` : ""}
            </span>
            {hayFiltro && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={limpiarFiltros}
              >
                <X className="h-3 w-3" />
                Limpiar filtros
              </Button>
            )}
          </div>

          {/* La tabla se desplaza por dentro en los dos ejes en vez de estirar
              la pagina: el encabezado y la fila de filtros quedan fijos arriba,
              y Fecha y Acciones fijas a los lados, para no perder de vista de
              quien es cada fila ni los botones al correrse a la derecha. */}
          <Card className="p-0">
            <div className="relative max-h-[62vh] overflow-auto rounded-lg">
              <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    {COLUMNAS_HISTORIAL.map((c, idx) => (
                      <th
                        key={c.k}
                        className={`sticky top-0 whitespace-nowrap p-2 text-xs font-semibold ${
                          c.centrado ? "text-center" : "text-left"
                        } ${idx === 0 ? "left-0 z-30" : "z-20"}`}
                        style={{
                          background: SST_TOKENS.navy,
                          color: "white",
                          minWidth: c.min,
                          height: ALTO_ENCABEZADO,
                        }}
                      >
                        {c.l}
                      </th>
                    ))}
                    <th
                      className="sticky right-0 top-0 z-30 whitespace-nowrap p-2 text-center text-xs font-semibold"
                      style={{
                        background: SST_TOKENS.navy,
                        color: "white",
                        minWidth: "7.5rem",
                        height: ALTO_ENCABEZADO,
                      }}
                    >
                      Acciones
                    </th>
                  </tr>
                  {/* Un filtro por columna, justo debajo de su encabezado: se ve
                      de inmediato por que campo se esta filtrando. */}
                  <tr>
                    {COLUMNAS_HISTORIAL.map((c, idx) => (
                      <th
                        key={c.k}
                        className={`sticky border-b p-1 ${idx === 0 ? "left-0 z-30" : "z-20"}`}
                        style={{ background: "#eef2f7", minWidth: c.min, top: ALTO_ENCABEZADO }}
                      >
                        {c.filtro === "lista" ? (
                          <Select
                            value={filtros[c.k] ?? TODOS}
                            onValueChange={(v) => setFiltro(c.k, v)}
                          >
                            <SelectTrigger className="h-8 bg-white text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={TODOS}>Todos</SelectItem>
                              {(opcionesPorColumna[c.k] ?? []).map((o) => (
                                <SelectItem key={o} value={o}>
                                  {o}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : c.filtro === "texto" ? (
                          <Input
                            className="h-8 bg-white text-xs"
                            value={filtros[c.k] ?? ""}
                            onChange={(e) => setFiltro(c.k, e.target.value)}
                            placeholder={c.ph ?? "Buscar…"}
                          />
                        ) : null}
                      </th>
                    ))}
                    <th
                      className="sticky right-0 z-30 border-b p-1"
                      style={{ background: "#eef2f7", top: ALTO_ENCABEZADO }}
                    />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((r, i) => {
                    const dias = diasInvestigacion(r)
                    const plazo = estadoInvestigacion(r)
                    // El fondo se repite en las celdas fijas: sin esto se verian
                    // transparentes y el contenido pasaria por debajo.
                    const bg = i % 2 ? "#f7fafc" : "#ffffff"
                    return (
                      <tr key={r.id}>
                        <td
                          className="sticky left-0 z-10 whitespace-nowrap border-b p-2"
                          style={{ background: bg, minWidth: COLUMNAS_HISTORIAL[0].min }}
                        >
                          {r.fecha_evento}
                        </td>
                        <td className="border-b p-2" style={{ background: bg }}>
                          {labelOf(TIPOS, r.tipo)}
                        </td>
                        <td className="border-b p-2" style={{ background: bg }}>
                          {r.trabajador ?? r.cargo}
                        </td>
                        <td className="border-b p-2 text-center" style={{ background: bg }}>
                          <Badge
                            style={{
                              background:
                                r.gravedad === "mortal"
                                  ? SST_TOKENS.bad
                                  : r.gravedad === "grave"
                                    ? SST_TOKENS.warn
                                    : SST_TOKENS.ok,
                              color: "white",
                            }}
                          >
                            {r.gravedad}
                          </Badge>
                        </td>
                        <td className="border-b p-2 text-center" style={{ background: bg }}>
                          {r.dias_incapacidad ?? 0}
                        </td>
                        <td className="whitespace-nowrap border-b p-2" style={{ background: bg }}>
                          {dias === null ? (
                            <span className="text-muted-foreground">Pendiente</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <Badge
                                style={{
                                  background: plazo === "En plazo" ? SST_TOKENS.ok : SST_TOKENS.bad,
                                  color: "white",
                                }}
                              >
                                {dias} d
                              </Badge>
                              <span className="text-xs text-muted-foreground">{plazo}</span>
                            </span>
                          )}
                        </td>
                        <td className="border-b p-2" style={{ background: bg }}>
                          <S
                            v={r.estado}
                            small
                            on={async (v) => {
                              await updateIncidente(r.id!, { estado: v })
                              cargar()
                            }}
                            o={ESTADOS}
                          />
                        </td>
                        <td
                          className="whitespace-nowrap border-b p-2 text-center"
                          style={{ background: bg }}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-[11px]"
                            title="Descargar el documento (PDF no editable)"
                            disabled={pdfId === r.id}
                            onClick={() => pdfDesdeHistorial(r)}
                          >
                            {pdfId === r.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" />
                            )}{" "}
                            PDF
                          </Button>
                          {r.documento_editable_url && (
                            <a
                              href={r.documento_editable_url}
                              target="_blank"
                              rel="noreferrer"
                              title="Descargar original editable (Excel)"
                              className="ml-1 inline-flex items-center text-[11px] text-muted-foreground hover:underline"
                            >
                              <FileText className="h-3.5 w-3.5" /> Excel
                            </a>
                          )}
                        </td>
                        <td className="border-b p-2 align-top" style={{ background: bg }}>
                          <SoportesDocumentales
                            norma="SST 0312"
                            modulo="Investigación AT"
                            referenciaTipo="incidente"
                            referenciaId={r.id!}
                            referenciaDesc={`${String(r.tipo)} - ${r.trabajador ?? r.cargo ?? ""}`}
                            empresaId={empresaId}
                          />
                        </td>
                        <td className="border-b p-2 text-center" style={{ background: bg }}>
                          {/* El check marca que la ARL ya cerro el expediente.
                              No es lo mismo que el estado del caso: la
                              investigacion interna puede estar cerrada y el
                              expediente de la ARL seguir abierto. */}
                          <div className="flex flex-col items-center gap-1">
                            {cierreId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <Checkbox
                                checked={!!r.cierre_arl}
                                onCheckedChange={(v) => marcarCierreArl(r, v === true)}
                                aria-label="Cierre del expediente ARL"
                                title={
                                  r.cierre_arl
                                    ? "Expediente cerrado por la ARL"
                                    : "Marcar cuando la ARL cierre el expediente"
                                }
                              />
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {r.cierre_arl ? (r.fecha_cierre_arl ?? "Cerrado") : "Abierto"}
                            </span>
                          </div>
                        </td>
                        <td className="border-b p-2 align-top" style={{ background: bg }}>
                          <CierreArlArchivo
                            incidente={r}
                            empresaId={empresaId}
                            compacto
                            onCambio={cargar}
                          />
                        </td>
                        <td
                          className="sticky right-0 z-10 whitespace-nowrap border-b p-2 text-center"
                          style={{ background: bg }}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Ver los datos de la investigación"
                            onClick={() => abrirDetalle(r)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-1 h-7 w-7 p-0"
                            title="Editar la investigación"
                            disabled={abriendoEdicion === r.id}
                            onClick={() => editar(r)}
                          >
                            {abriendoEdicion === r.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                  {filas.length === 0 && (
                    <tr>
                      <td
                        colSpan={COLUMNAS_HISTORIAL.length + 1}
                        className="bg-white p-6 text-center text-muted-foreground"
                      >
                        {rows.length === 0
                          ? "Sin registros aún."
                          : filasDelAnio.length === 0
                            ? `Sin investigaciones registradas en ${anio}.`
                            : "Ningún registro coincide con los filtros."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* El ojo: la investigación completa sin entrar al formulario, para
          consultarla sin riesgo de modificarla sin querer. */}
      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" style={{ color: SST_TOKENS.navy }} />
              {detalle?.trabajador || detalle?.cargo || "Investigación"}
            </DialogTitle>
            <DialogDescription>
              {detalle
                ? `${labelOf(TIPOS, detalle.tipo)} · ${detalle.fecha_evento} · ${labelOf(ESTADOS, detalle.estado)}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {detalle && (
            <div className="space-y-3">
              <section className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    className="gap-1"
                    style={{
                      background: detalle.cierre_arl ? SST_TOKENS.ok : SST_TOKENS.warn,
                      color: "white",
                    }}
                  >
                    <ShieldCheck className="h-3 w-3" />
                    Expediente ARL{" "}
                    {detalle.cierre_arl
                      ? `cerrado${detalle.fecha_cierre_arl ? " · " + detalle.fecha_cierre_arl : ""}`
                      : "abierto"}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    Documento de cierre enviado por la ARL
                  </span>
                </div>
                <div className="mt-2">
                  <CierreArlArchivo incidente={detalle} empresaId={empresaId} onCambio={cargar} />
                </div>
              </section>

              {seccionesInforme(detalle as any).map((s) => (
                <section key={s.k} className="rounded-lg border">
                  <h4
                    className="px-3 py-2 text-xs font-semibold"
                    style={{ background: SST_TOKENS.light, color: SST_TOKENS.navy }}
                  >
                    {s.titulo}
                  </h4>
                  <dl className="divide-y">
                    {s.filas.map(([l, v]) => (
                      <div key={l} className="grid gap-0.5 px-3 py-1.5 sm:grid-cols-3">
                        <dt className="text-xs font-medium text-muted-foreground">{l}</dt>
                        <dd className="whitespace-pre-wrap break-words text-xs sm:col-span-2">
                          {String(v ?? "").trim() || "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}

              {cargandoDetalle ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <TablaDetalle
                    titulo="TESTIGOS"
                    cabeceras={["Testigo", "Cédula", "Versión"]}
                    filas={detalleTestigos.map((t) => [
                      t.nombre ?? "",
                      t.documento ?? "",
                      t.version ?? "",
                    ])}
                    vacio="Sin testigos registrados."
                  />
                  <TablaDetalle
                    titulo="PLAN DE ACCIÓN"
                    cabeceras={[
                      "Medida de intervención",
                      "Control",
                      "Resp. ejecución",
                      "F. impl.",
                      "Verifica",
                      "Estado",
                    ]}
                    filas={detalleAcciones.map((a) => [
                      a.plan ?? "",
                      labelOf(CONTROL, a.tipo_control),
                      a.responsable_ejecucion ?? "",
                      a.fecha_implementacion ?? "",
                      a.responsable_verificacion ?? "",
                      a.estado ?? "",
                    ])}
                    vacio="Sin plan de acción registrado."
                  />
                </>
              )}

              <TablaDetalle
                titulo="FIRMAS"
                cabeceras={["Rol", "Nombre", "Cargo", "C.C."]}
                filas={ROLES_FIRMA.map(([k, l]) => [
                  l,
                  (detalle.firmas as any)?.[k]?.nombre ?? "",
                  (detalle.firmas as any)?.[k]?.cargo ?? "",
                  (detalle.firmas as any)?.[k]?.cc ?? "",
                ])}
                vacio="Sin firmas registradas."
              />

              <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={pdfId === detalle.id}
                  onClick={() => pdfDesdeHistorial(detalle)}
                >
                  {pdfId === detalle.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  Descargar PDF
                </Button>
                <Button
                  className="gap-1.5"
                  style={{ background: SST_TOKENS.navy, color: "white" }}
                  disabled={abriendoEdicion === detalle.id}
                  onClick={() => editar(detalle)}
                >
                  {abriendoEdicion === detalle.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Pencil className="h-4 w-4" />
                  )}
                  Editar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Subir y consultar el archivo con el que la ARL cierra el expediente.
 *
 * Guarda en el repositorio central de soportes con `referencia_tipo`
 * REF_CIERRE_ARL, asi que conserva historial: si la ARL manda una version
 * corregida, la anterior queda como "historico" y no se pierde. Para un
 * expediente que puede tener que mostrarse anios despues, poder decir que hubo
 * un reemplazo y cual fue el anterior vale mas que ahorrarse una fila.
 *
 * `onCambio` avisa hacia arriba para refrescar el detalle sin recargar todo.
 */
function CierreArlArchivo({
  incidente,
  empresaId,
  compacto = false,
  onCambio,
}: {
  incidente: IncidenteRow
  empresaId?: number | null
  compacto?: boolean
  onCambio?: () => void
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState<SoporteRow[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [porQuitar, setPorQuitar] = useState<SoporteRow | null>(null)
  const [motivo, setMotivo] = useState("")
  const [quitando, setQuitando] = useState(false)
  const refId = String(incidente.id ?? "")

  async function cargar() {
    if (!refId) return
    setRows(await listSoportes(REF_CIERRE_ARL, refId, empresaId ?? null))
  }
  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId, empresaId])

  async function onFile(file: File) {
    /*
     * El archivo sube DIRECTO del navegador al almacenamiento, sin pasar por
     * el servidor, asi que el tope ya no es el del Server Action --que la
     * plataforma cortaba mucho antes de los 50 MB declarados-- sino el del
     * bucket.
     *
     * Se deja un tope alto por cordura: un expediente escaneado de mas de
     * 200 MB casi siempre es un error de digitalizacion (300 dpi a color en
     * vez de 150 en gris), y subirlo tarda tanto que el operador cree que la
     * pantalla se colgo.
     */
    if (file.size > 200 * 1024 * 1024) {
      toast({
        title: "Archivo muy grande",
        description:
          "El máximo son 200 MB. Si es un escaneo, revisa la resolución: a 150 dpi en escala de grises un expediente completo rara vez pasa de 30 MB.",
      })
      return
    }
    setSubiendo(true)
    try {
      const res = await subirSoporteDirecto(
        file,
        {
          norma: "SST 0312",
          modulo: "Investigación AT",
          referenciaTipo: REF_CIERRE_ARL,
          referenciaId: refId,
          referenciaDesc: `Cierre ARL · ${incidente.trabajador ?? incidente.cargo ?? ""} · ${incidente.fecha_evento ?? ""}`,
          observacion: "Documento de cierre del expediente enviado por la ARL",
        },
        empresaId ?? null,
      )
      if (res.success && res.url) {
        toast({
          title: "Cierre de expediente cargado",
          description: incidente.cierre_arl
            ? "Quedó como documento vigente; el anterior se conserva como histórico."
            : "Recuerda marcar el check de Cierre ARL para que el expediente deje de figurar como abierto.",
        })
        await cargar()
        onCambio?.()
      } else {
        toast({ title: "Error al subir", description: res.message || "No se pudo subir el archivo." })
      }
    } catch (e: any) {
      // Falla-segura: sin esto un error del Server Action deja el boton en
      // "Subiendo..." para siempre y el operador no sabe si quedo o no.
      console.error("[v0] cierre ARL subir:", e?.message ?? e)
      toast({
        title: "Error al subir",
        description: "No se pudo subir el archivo (revisa el tamaño y la conexión).",
      })
    } finally {
      setSubiendo(false)
    }
  }

  async function confirmarQuitar() {
    if (!porQuitar) return
    setQuitando(true)
    try {
      const res = await eliminarSoporte(porQuitar.id, motivo)
      if (res.success) {
        toast({
          title: "Documento retirado",
          description: "El archivo se conserva y la eliminación se puede revertir.",
        })
        setPorQuitar(null)
        setMotivo("")
        await cargar()
        onCambio?.()
      } else {
        toast({ title: "No se pudo quitar", description: res.message })
      }
    } catch (e: any) {
      console.error("[v0] cierre ARL quitar:", e?.message ?? e)
      toast({ title: "No se pudo quitar", description: "Inténtalo de nuevo." })
    } finally {
      setQuitando(false)
    }
  }

  const vigente = rows.find((r) => r.vigente) ?? null
  const historicos = rows.filter((r) => !r.vigente)

  return (
    <div className="space-y-1.5">
      <label
        className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
        style={{ color: SST_TOKENS.navy }}
        title="Subir el documento con el que la ARL cierra el expediente"
      >
        {subiendo ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        {subiendo ? "Subiendo…" : vigente ? "Reemplazar cierre" : "Subir cierre"}
        <input
          type="file"
          className="hidden"
          disabled={subiendo || !refId}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ""
          }}
        />
      </label>

      {vigente ? (
        <div className="space-y-0.5">
          <div className="flex items-start gap-1">
            <a
              href={vigente.archivo_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs underline"
              style={{ color: SST_TOKENS.teal }}
            >
              <FileText className="h-3 w-3 shrink-0" />
              {vigente.archivo_nombre ?? "documento"}
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              type="button"
              onClick={() => {
                setPorQuitar(vigente)
                setMotivo("")
              }}
              title="Quitar el documento de cierre"
              aria-label="Quitar el documento de cierre"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {(vigente.created_at ?? "").slice(0, 10)}
            {historicos.length > 0 ? ` · ${historicos.length} versión(es) anterior(es)` : ""}
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Sin documento de cierre.</p>
      )}

      {/* Las versiones anteriores solo se listan en el detalle: en la fila de la
          tabla ocuparian mas de lo que aportan. */}
      {porQuitar && (
        <Dialog open onOpenChange={(o) => !o && setPorQuitar(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                Quitar documento de cierre
              </DialogTitle>
              <DialogDescription>
                {porQuitar.archivo_nombre ?? "Este archivo"} dejará de aparecer como evidencia.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                El archivo <strong>no se borra</strong>: se conserva y la eliminación se puede
                revertir.
              </p>
              {porQuitar.vigente && historicos.length > 0 && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Es la versión vigente. Al quitarla, la anterior vuelve a quedar como vigente.
                </p>
              )}
              {porQuitar.vigente && historicos.length === 0 && incidente.cierre_arl && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Es el único documento de cierre y el expediente figura como cerrado. Revisa si
                  también hay que desmarcar el check de Cierre ARL.
                </p>
              )}
              <div className="space-y-1">
                <label className="text-xs font-medium">Motivo *</label>
                <Input
                  autoFocus
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej. La ARL envió el documento equivocado"
                />
                <p className="text-[11px] text-muted-foreground">
                  Queda guardado con la fecha. Dentro de un año es lo único que explica por qué no
                  está.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={() => setPorQuitar(null)} disabled={quitando}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={confirmarQuitar}
                disabled={quitando || !motivo.trim()}
                className="gap-1.5"
              >
                {quitando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Quitar documento
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {!compacto && historicos.length > 0 && (
        <ul className="space-y-0.5 border-t pt-1">
          {historicos.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 text-[11px]">
              <a
                href={h.archivo_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground underline"
              >
                {h.archivo_nombre ?? "documento"} <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-[10px] text-muted-foreground">
                {(h.created_at ?? "").slice(0, 10)} · histórico
              </span>
              <button
                type="button"
                onClick={() => {
                  setPorQuitar(h)
                  setMotivo("")
                }}
                title="Quitar esta versión"
                aria-label="Quitar esta versión"
                className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Tabla chica para las listas del detalle (testigos, plan de accion, firmas). */
function TablaDetalle({
  titulo,
  cabeceras,
  filas,
  vacio,
}: {
  titulo: string
  cabeceras: string[]
  filas: string[][]
  vacio: string
}) {
  return (
    <section className="rounded-lg border">
      <h4
        className="px-3 py-2 text-xs font-semibold"
        style={{ background: SST_TOKENS.light, color: SST_TOKENS.navy }}
      >
        {titulo}
      </h4>
      {filas.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">{vacio}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                {cabeceras.map((c) => (
                  <th key={c} className="p-2 text-left font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} className="border-b last:border-0">
                  {f.map((v, j) => (
                    <td key={j} className="p-2 align-top">
                      {String(v ?? "").trim() || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Kpi({ t, v, c }: { t: string; v: any; c?: string }) {
  return (
    <Card className="p-4">
      <div className="text-2xl font-bold" style={{ color: c ?? SST_TOKENS.navy }}>{v}</div>
      <div className="text-xs text-muted-foreground">{t}</div>
    </Card>
  )
}
function Sec({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: SST_TOKENS.navy }}>{n}</h3>
      {children}
    </section>
  )
}
function G3({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-3">{children}</div>
}
function G2({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2">{children}</div>
}
function F({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs" style={{ color: SST_TOKENS.ink }}>{l}</label>
      {children}
    </div>
  )
}
function S({ v, on, o, small }: { v: string; on: (v: string) => void; o: [string, string][]; small?: boolean }) {
  return (
    <Select value={v} onValueChange={on}>
      <SelectTrigger className={small ? "h-8" : ""}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {o.map(([val, lab]) => (
          <SelectItem key={val} value={val}>{lab}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default InvestigacionAT
