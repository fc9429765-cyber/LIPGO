"use client"

// Submódulo "Liquidaciones": personas retiradas CON contrato (nº SIIGO),
// separadas por cliente. Muestra la nómina PENDIENTE de pago y las PRESTACIONES
// SOCIALES (prima, cesantías, intereses, vacaciones) como columnas, con % de ley
// editables. Por persona: "Pagado hasta", marcar Liquidada/Pendiente, adjuntar
// soporte. Detalle expandible + export a Excel.

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Loader2,
  Download,
  ChevronDown,
  ChevronRight,
  UserMinus,
  CheckCircle2,
  Clock,
  Upload,
  FileText,
  Save,
  SlidersHorizontal,
  Scale,
  RefreshCw,
  BadgeCheck,
  AlertTriangle,
  Plus,
  Trash2,
  Search,
  Filter,
  RotateCcw,
  CheckSquare,
  Landmark,
} from "lucide-react"
import {
  getLiquidaciones,
  guardarEstadoLiquidacion,
  guardarEstadoLiquidacionMasivo,
  guardarPagadoHasta,
  guardarParametrosPrestaciones,
  guardarValoresRealesLiquidacion,
  guardarMotivoRetiro,
  agregarDeduccionLiquidacion,
  eliminarDeduccionLiquidacion,
  subirSoporteLiquidacion,
  type LiquidacionPersona,
  type ParametrosPrestaciones,
  type EstadoLiquidacion,
} from "@/lib/liquidaciones-actions"
import { useClaveAccion } from "@/components/clave-accion-provider"

const MOTIVOS_RETIRO = [
  "Voluntario",
  "Justa Causa",
  "Sin Justa Causa",
  "Periodo de Prueba",
  "Terminación Justa Causa Periodo de Prueba",
] as const

const CONCEPTOS_DEDUCCION = [
  "Préstamo",
  "Anticipo de nómina",
  "Otros descuentos autorizados",
  "Licencia no remunerada",
  "Otro",
] as const

const money = (n: number) =>
  "$" + (Number(n) || 0).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PARAMS_DEFAULT: ParametrosPrestaciones = {
  pctPrima: 8.33,
  pctCesantias: 8.33,
  pctInteresesCesantias: 12,
  pctVacaciones: 4.17,
  incluyeAux: true,
}

// Cuadro de control -- mismo lenguaje visual que components/cuadro-control-nomina.tsx
// (franja de severidad + badge), adaptado a las tarjetas de Liquidaciones.
type SeveridadKpi = "ok" | "warn" | "crit"
const SEVERIDAD_TOKENS: Record<SeveridadKpi, { accent: string; icon: string; badgeBg: string; badgeText: string }> = {
  ok: { accent: "before:bg-emerald-500", icon: "text-emerald-600 dark:text-emerald-400", badgeBg: "bg-emerald-500/10 dark:bg-emerald-500/15", badgeText: "text-emerald-700 dark:text-emerald-400" },
  warn: { accent: "before:bg-amber-500", icon: "text-amber-600 dark:text-amber-400", badgeBg: "bg-amber-500/10 dark:bg-amber-500/15", badgeText: "text-amber-700 dark:text-amber-400" },
  crit: { accent: "before:bg-rose-500", icon: "text-rose-600 dark:text-rose-400", badgeBg: "bg-rose-500/10 dark:bg-rose-500/15", badgeText: "text-rose-700 dark:text-rose-400" },
}
function TarjetaKpi({
  icon: Icon,
  titulo,
  valor,
  subtitulo,
  severidad,
  chip,
}: {
  icon: React.ElementType
  titulo: string
  valor: string
  subtitulo: string
  severidad: SeveridadKpi
  chip?: string
}) {
  const t = SEVERIDAD_TOKENS[severidad]
  return (
    <div className={`relative overflow-hidden rounded-lg border border-border bg-card p-3 before:absolute before:inset-y-0 before:left-0 before:w-1 ${t.accent}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className={`h-3.5 w-3.5 ${t.icon}`} /> {titulo}
        </div>
        {chip && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${t.badgeBg} ${t.badgeText}`}>{chip}</span>}
      </div>
      <div className="mt-1.5 text-lg font-bold tabular-nums tracking-tight">{valor}</div>
      <div className="text-[11px] text-muted-foreground">{subtitulo}</div>
    </div>
  )
}

export default function Liquidaciones() {
  const { selectedEmpresaId } = useAuth()
  const { conClave } = useClaveAccion()
  const { toast } = useToast()
  const [data, setData] = useState<LiquidacionPersona[]>([])
  const [params, setParams] = useState<ParametrosPrestaciones>(PARAMS_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [savingParams, setSavingParams] = useState(false)
  const [showParams, setShowParams] = useState(false)
  const [showNomenclatura, setShowNomenclatura] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [realesEdit, setRealesEdit] = useState<
    Record<string, { cesantias: string; intereses: string; prima: string; vacaciones: string; indemnizacion: string }>
  >({})
  const [deduccionForm, setDeduccionForm] = useState<
    Record<string, { concepto: string; valor: string; observacion: string }>
  >({})
  // Filtros/buscador (100% client-side: `data` ya trae TODO el retirado de
  // este proyecto, no hace falta ida al servidor por cada cambio de filtro).
  const [filtroTexto, setFiltroTexto] = useState("")
  const [filtroDesde, setFiltroDesde] = useState("")
  const [filtroHasta, setFiltroHasta] = useState("")
  const [filtroEstado, setFiltroEstado] = useState<"todos" | EstadoLiquidacion>("todos")
  // Selección para el marcado masivo -- solo sobre lo que el filtro deja ver.
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [marcandoMasivo, setMarcandoMasivo] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadTarget = useRef<LiquidacionPersona | null>(null)

  const cargar = useCallback(async () => {
    if (!selectedEmpresaId) {
      setData([])
      setLoading(false)
      return
    }
    setLoading(true)
    const r = await getLiquidaciones(selectedEmpresaId)
    if (r.success) {
      setData(r.data)
      if (r.params) setParams(r.params)
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
    setLoading(false)
  }, [selectedEmpresaId, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const toggle = (p: LiquidacionPersona) => {
    setRealesEdit((prev) =>
      prev[p.identificacion]
        ? prev
        : {
            ...prev,
            [p.identificacion]: {
              cesantias: p.cesantias_real != null ? String(p.cesantias_real) : "",
              intereses: p.intereses_real != null ? String(p.intereses_real) : "",
              prima: p.prima_real != null ? String(p.prima_real) : "",
              vacaciones: p.vacaciones_real != null ? String(p.vacaciones_real) : "",
              indemnizacion: p.indemnizacion_real != null ? String(p.indemnizacion_real) : "",
            },
          },
    )
    setExpanded((prev) => {
      const next = new Set(prev)
      const persona = p.persona
      next.has(persona) ? next.delete(persona) : next.add(persona)
      return next
    })
  }

  // Cuadro de control: SIEMPRE sobre el total del proyecto (no sobre lo
  // filtrado) -- es el estado real a vigilar, independiente de qué se esté
  // buscando en la tabla en ese momento.
  const kpis = useMemo(() => {
    const pendientes = data.filter((p) => p.estado === "pendiente")
    const liquidadas = data.filter((p) => p.estado === "liquidada")
    const hoy = Date.now()
    const DIAS_ALERTA = 30
    const pendientesVencidas = pendientes.filter((p) => {
      if (!p.fecha_retiro) return false
      const dias = (hoy - Date.parse(p.fecha_retiro)) / 86_400_000
      return dias > DIAS_ALERTA
    })
    return {
      retirados: data.length,
      pendientes: pendientes.length,
      liquidadas: liquidadas.length,
      totalNomina: pendientes.reduce((s, p) => s + p.total, 0),
      totalPrestaciones: pendientes.reduce((s, p) => s + p.prestaciones, 0),
      totalLiquidar: pendientes.reduce((s, p) => s + p.total_liquidacion, 0),
      totalLiquidado: liquidadas.reduce((s, p) => s + p.total_liquidacion, 0),
      vencidas: pendientesVencidas.length,
    }
  }, [data])

  // Tabla/selección: sobre lo FILTRADO. Búsqueda por nombre/cédula, rango de
  // fecha de retiro, estado -- lo que pidió el usuario ("no tiene ningún
  // filtro, ni buscador").
  const dataFiltrada = useMemo(() => {
    const texto = filtroTexto.trim().toLowerCase()
    return data.filter((p) => {
      if (texto && !p.persona.toLowerCase().includes(texto) && !p.identificacion.includes(texto)) return false
      if (filtroDesde && (!p.fecha_retiro || p.fecha_retiro < filtroDesde)) return false
      if (filtroHasta && (!p.fecha_retiro || p.fecha_retiro > filtroHasta)) return false
      if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false
      return true
    })
  }, [data, filtroTexto, filtroDesde, filtroHasta, filtroEstado])

  const hayFiltrosActivos = !!(filtroTexto || filtroDesde || filtroHasta || filtroEstado !== "todos")
  const limpiarFiltros = () => {
    setFiltroTexto("")
    setFiltroDesde("")
    setFiltroHasta("")
    setFiltroEstado("todos")
  }

  const toggleSeleccion = (identificacion: string) =>
    setSeleccionadas((prev) => {
      const next = new Set(prev)
      next.has(identificacion) ? next.delete(identificacion) : next.add(identificacion)
      return next
    })
  const todasFiltradasSeleccionadas =
    dataFiltrada.length > 0 && dataFiltrada.every((p) => seleccionadas.has(p.identificacion))
  const toggleSeleccionarTodas = () =>
    setSeleccionadas((prev) => {
      if (todasFiltradasSeleccionadas) {
        const next = new Set(prev)
        dataFiltrada.forEach((p) => next.delete(p.identificacion))
        return next
      }
      const next = new Set(prev)
      dataFiltrada.forEach((p) => next.add(p.identificacion))
      return next
    })

  const marcarSeleccionadasComoPagadas = async () => {
    const items = dataFiltrada.filter((p) => seleccionadas.has(p.identificacion) && p.estado !== "liquidada")
    if (items.length === 0) {
      toast({ title: "Nada por marcar", description: "Las seleccionadas ya están liquidadas o no hay ninguna marcada." })
      return
    }
    setMarcandoMasivo(true)
    const r = await conClave("Liquidaciones", "aprobar", (clave) => guardarEstadoLiquidacionMasivo(
      items.map((p) => ({
        idempresa: p.idempresa,
        identificacion: p.identificacion,
        persona: p.persona,
        fecha_retiro: p.fecha_retiro,
        total: p.total_liquidacion,
      })),
      "liquidada", clave))
    setMarcandoMasivo(false)
    if (r.success) {
      toast({ title: "Actualizado", description: `${r.actualizadas} liquidación(es) marcada(s) como pagadas.` })
      setSeleccionadas(new Set())
      await cargar()
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const guardarParams = async () => {
    setSavingParams(true)
    const r = await conClave("Liquidaciones", "configurar", (clave) => guardarParametrosPrestaciones(params, clave))
    setSavingParams(false)
    if (r.success) {
      toast({ title: "Parámetros guardados", description: "Se recalcularon las prestaciones." })
      await cargar()
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const cambiarEstado = async (p: LiquidacionPersona) => {
    setBusy(p.identificacion)
    const nuevo = p.estado === "liquidada" ? "pendiente" : "liquidada"
    const r = await conClave("Liquidaciones", "aprobar", (clave) => guardarEstadoLiquidacion({
      idempresa: p.idempresa,
      identificacion: p.identificacion,
      persona: p.persona,
      fecha_retiro: p.fecha_retiro,
      total: p.total_liquidacion,
      estado: nuevo,
    }, clave))
    setBusy(null)
    if (r.success) {
      setData((prev) => prev.map((x) => (x.identificacion === p.identificacion ? { ...x, estado: nuevo } : x)))
      toast({ title: "Actualizado", description: `Marcada como ${nuevo}.` })
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const cambiarPagadoHasta = async (p: LiquidacionPersona, value: string) => {
    setBusy(p.identificacion)
    const r = await guardarPagadoHasta({
      idempresa: p.idempresa,
      identificacion: p.identificacion,
      persona: p.persona,
      fecha_retiro: p.fecha_retiro,
      pagado_hasta: value || null,
    })
    setBusy(null)
    if (r.success) {
      await cargar()
      toast({ title: "Actualizado", description: value ? `Pagado hasta ${value}.` : "Se borró la fecha de pago." })
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const setReal = (
    identificacion: string,
    campo: "cesantias" | "intereses" | "prima" | "vacaciones" | "indemnizacion",
    value: string,
  ) => setRealesEdit((prev) => ({ ...prev, [identificacion]: { ...prev[identificacion], [campo]: value } }))

  const guardarReales = async (p: LiquidacionPersona) => {
    const edit = realesEdit[p.identificacion]
    if (!edit) return
    const num = (s: string) => (s.trim() === "" ? null : Number(s))
    setBusy(p.identificacion)
    const r = await guardarValoresRealesLiquidacion({
      idempresa: p.idempresa,
      identificacion: p.identificacion,
      persona: p.persona,
      fecha_retiro: p.fecha_retiro,
      cesantias_real: num(edit.cesantias),
      intereses_real: num(edit.intereses),
      prima_real: num(edit.prima),
      vacaciones_real: num(edit.vacaciones),
      indemnizacion_real: num(edit.indemnizacion),
    })
    setBusy(null)
    if (r.success) {
      await cargar()
      toast({ title: "Guardado", description: "Se actualizaron los valores reales de la liquidación." })
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const cambiarMotivo = async (p: LiquidacionPersona, motivo: string) => {
    setBusy(p.identificacion)
    const r = await guardarMotivoRetiro({ identificacion: p.identificacion, motivo_retiro: motivo || null })
    setBusy(null)
    if (r.success) {
      await cargar()
      toast({ title: "Actualizado", description: motivo ? `Motivo: ${motivo}.` : "Se borró el motivo de retiro." })
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const agregarDeduccion = async (p: LiquidacionPersona) => {
    const f = deduccionForm[p.identificacion]
    const valor = Number(f?.valor)
    if (!f?.concepto || !valor || valor <= 0) {
      toast({ title: "Datos incompletos", description: "Elige un concepto e ingresa un valor mayor a 0.", variant: "destructive" })
      return
    }
    setBusy(p.identificacion)
    const r = await agregarDeduccionLiquidacion({
      idempresa: p.idempresa,
      identificacion: p.identificacion,
      persona: p.persona,
      concepto: f.concepto,
      valor,
      observacion: f.observacion || null,
    })
    setBusy(null)
    if (r.success) {
      setDeduccionForm((prev) => ({ ...prev, [p.identificacion]: { concepto: "", valor: "", observacion: "" } }))
      await cargar()
      toast({ title: "Deducción agregada", description: `${f.concepto}: ${money(valor)}` })
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const quitarDeduccion = async (p: LiquidacionPersona, id: string) => {
    setBusy(p.identificacion)
    const r = await eliminarDeduccionLiquidacion(id)
    setBusy(null)
    if (r.success) {
      await cargar()
      toast({ title: "Eliminada", description: "Se quitó la deducción." })
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const pedirSoporte = (p: LiquidacionPersona) => {
    uploadTarget.current = p
    fileInputRef.current?.click()
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const p = uploadTarget.current
    e.target.value = ""
    if (!file || !p) return
    setBusy(p.identificacion)
    const fd = new FormData()
    fd.append("file", file)
    fd.append("idempresa", String(p.idempresa ?? ""))
    fd.append("identificacion", p.identificacion)
    fd.append("persona", p.persona)
    fd.append("fecha_retiro", p.fecha_retiro || "")
    const r = await subirSoporteLiquidacion(fd)
    setBusy(null)
    if (r.success && r.url) {
      setData((prev) =>
        prev.map((x) => (x.identificacion === p.identificacion ? { ...x, soporte_url: r.url!, soporte_nombre: file.name } : x)),
      )
      toast({ title: "Soporte adjuntado", description: file.name })
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const exportar = async () => {
    const XLSX = await import("xlsx")
    try {
      const headers = [
        "Persona",
        "Identificación",
        "Fecha retiro",
        "Motivo retiro",
        "Estado",
        "Nómina pendiente",
        "Aux. transporte pendiente",
        "Deducción ley pendiente",
        "Prima",
        "Cesantías",
        "Intereses cesantías",
        "Vacaciones",
        "Indemnización",
        "Total prestaciones",
        "Deducciones",
        "Total a pagar",
        "Soporte",
      ]
      const rows = dataFiltrada.map((p) => [
        p.persona,
        p.identificacion,
        p.fecha_retiro || "",
        p.motivo_retiro || "",
        p.estado,
        p.total,
        p.auxilioTransportePendiente,
        p.deduccionLeyPendiente,
        p.prima,
        p.cesantias,
        p.intereses,
        p.vacaciones,
        p.indemnizacion,
        p.prestaciones,
        p.deducciones,
        p.total_liquidacion,
        p.soporte_url || "",
      ])
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Liquidaciones")
      ws["!cols"] = [26, 15, 12, 22, 11, 16, 16, 16, 14, 14, 16, 14, 16, 16, 14, 16, 40].map((wch) => ({ wch }))
      XLSX.writeFile(wb, `liquidaciones-${new Date().toISOString().split("T")[0]}.xlsx`)
      toast({ title: "Éxito", description: "Archivo exportado correctamente" })
    } catch {
      toast({ title: "Error", description: "Error al exportar archivo", variant: "destructive" })
    }
  }

  const setP = (k: keyof ParametrosPrestaciones, v: number | boolean) => setParams((prev) => ({ ...prev, [k]: v }))

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={onFileChange} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserMinus className="h-5 w-5 text-primary" /> Liquidaciones de personal retirado
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={cargar} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowNomenclatura((s) => !s)}>
              <Scale className="mr-2 h-4 w-4" /> Nomenclatura legal
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowParams((s) => !s)}>
              <SlidersHorizontal className="mr-2 h-4 w-4" /> Parámetros de ley
            </Button>
            <Button size="sm" variant="outline" onClick={exportar} disabled={loading || dataFiltrada.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Exportar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Retirados <strong>con contrato</strong> (nº SIIGO) y su liquidación: <strong>prestaciones sociales</strong>{" "}
            (prima, cesantías, intereses, vacaciones, indemnización si aplica) sobre el devengado del período de
            causación. Desde el 9-sep-2026, la <strong>nómina pendiente</strong> (posterior a "Pagado hasta") de un
            retiro nuevo se paga por el <strong>archivo plano</strong> de la quincena, no por esta liquidación — se
            sigue mostrando aquí solo como referencia (retiros de antes de esa fecha no cambian).
          </p>

          {/* Parámetros de ley (prestaciones) */}
          {showParams && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <SlidersHorizontal className="h-4 w-4 text-primary" /> Porcentajes de prestaciones (ley colombiana)
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                  { k: "pctPrima" as const, l: "Prima %" },
                  { k: "pctCesantias" as const, l: "Cesantías %" },
                  { k: "pctInteresesCesantias" as const, l: "Interés ces. % (anual)" },
                  { k: "pctVacaciones" as const, l: "Vacaciones %" },
                ].map((f) => (
                  <div key={f.k} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{f.l}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={params[f.k] as number}
                      onChange={(e) => setP(f.k, Number(e.target.value))}
                    />
                  </div>
                ))}
                <div className="flex items-end">
                  <Button size="sm" onClick={guardarParams} disabled={savingParams}>
                    {savingParams ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Guardar
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Base = devengado (base por día + <strong>bono de productividad</strong> de destajo, neto por quincena) +
                extras + recargos + auxilio de transporte. El bono de productividad es salario para prestaciones.{" "}
                <strong>Vacaciones</strong> (CST art. 192) va sobre el <strong>salario ordinario</strong> (incluye el
                bono; excluye horas extras, trabajo dominical/festivo y el auxilio). Causación: cesantías/vacaciones
                desde 1-ene del año del retiro; prima desde 1-ene o 1-jul según el semestre. Ver{" "}
                <strong>Nomenclatura legal</strong> para el detalle.
              </p>
            </div>
          )}

          {/* Hoja de NOMENCLATURA LEGAL — base normativa de cada concepto (siempre prima la ley) */}
          {showNomenclatura && (
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Scale className="h-4 w-4 text-primary" /> Nomenclatura legal de la liquidación
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                Fundamento normativo de cada concepto (Código Sustantivo del Trabajo — Ministerio de Trabajo de
                Colombia). <strong>Siempre prima la ley.</strong>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Concepto</th>
                      <th className="px-2 py-1.5 font-medium">Norma</th>
                      <th className="px-2 py-1.5 font-medium">Base de cálculo</th>
                      <th className="px-2 py-1.5 font-medium">Fórmula / criterio</th>
                    </tr>
                  </thead>
                  <tbody className="align-top">
                    {[
                      {
                        c: "Nómina pendiente (informativa)",
                        n: "Pago quincenal (1–15 / 16–fin)",
                        b: "Devengado real de LIPgo (tarifa por tonelada / turno)",
                        f: "Novedades posteriores a “Pagado hasta” y hasta la fecha de retiro. Desde el 9-sep-2026 se paga por el archivo plano de la quincena en un retiro nuevo (NO suma al total de esta liquidación); en un retiro de antes de esa fecha, sigue sumando como siempre.",
                      },
                      {
                        c: "Aux. transporte y deducción de ley (nómina pendiente)",
                        n: "Ley 15 de 1959 · Art. 204/205 Ley 100 de 1993",
                        b: "Auxilio de transporte del año, prorrateado por día · 4% salud + 4% pensión sobre la nómina pendiente (sin el auxilio)",
                        f: "Solo aplica en retiros de antes del 9-sep-2026 (la nómina pendiente sigue sumando en esta liquidación). Replica lo que Siigo ya hace automático en cada ciclo — confirmado con el caso real de Yair de Jesús Truyol Caballero.",
                      },
                      {
                        c: "Prima de servicios",
                        n: "CST art. 306 · Ley 1788 de 2016",
                        b: "Salario + auxilio de transporte",
                        f: "1 mes de salario por año (15 días/semestre), proporcional al período causado del semestre en curso (desde 1-ene o 1-jul, o la fecha de ingreso si es posterior).",
                      },
                      {
                        c: "Cesantías",
                        n: "CST art. 249 · Ley 50 de 1990",
                        b: "Salario + extras + recargos + auxilio de transporte",
                        f: "1 mes de salario por año, proporcional (devengado × 8.33%). Se causan desde el 1-ene del año del retiro.",
                      },
                      {
                        c: "Intereses a las cesantías",
                        n: "Ley 52 de 1975",
                        b: "Valor de las cesantías del período",
                        f: "12% anual sobre las cesantías, proporcional al tiempo (× días/360).",
                      },
                      {
                        c: "Vacaciones",
                        n: "CST art. 186 · 189 · 192",
                        b: "Salario ORDINARIO (excluye horas extras, trabajo dominical/festivo y auxilio de transporte)",
                        f: "15 días hábiles por año, compensables en dinero al retiro, proporcional a los días laborados de TODO el vínculo, menos los días ya disfrutados.",
                      },
                    ].map((r) => (
                      <tr key={r.c} className="border-b border-border/50">
                        <td className="px-2 py-2 font-medium text-foreground">{r.c}</td>
                        <td className="px-2 py-2 text-muted-foreground">{r.n}</td>
                        <td className="px-2 py-2 text-muted-foreground">{r.b}</td>
                        <td className="px-2 py-2 text-muted-foreground">{r.f}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>
                  <strong>Incapacidades EPS/ARL</strong> y <strong>descansos/festivos</strong> se reconocen como 1 día de
                  salario (ya vienen en el devengado de LIPgo).
                </li>
                <li>
                  Los <strong>4 primeros días de enero</strong> (que no existen en el sistema) se rellenan a 1 día de
                  salario básico, solo para quienes ingresaron en 2025.
                </li>
                <li>
                  Auxilio de transporte y SMLV vigentes por año (tabla <em>parametros_legales_anio</em>); porcentajes de
                  prestaciones editables en “Parámetros de ley”.
                </li>
              </ul>
            </div>
          )}

          {/* Cuadro de control */}
          <div className="space-y-2">
            {kpis.vencidas > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-rose-500/5 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {kpis.vencidas} pendiente(s) con más de 30 días desde el retiro sin liquidar
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <TarjetaKpi
                icon={UserMinus}
                titulo="Retirados"
                valor={String(kpis.retirados)}
                subtitulo="con contrato SIIGO"
                severidad="ok"
              />
              <TarjetaKpi
                icon={Clock}
                titulo="Pendientes"
                valor={`${kpis.pendientes} · ${money(kpis.totalLiquidar)}`}
                subtitulo="por liquidar"
                severidad={kpis.vencidas > 0 ? "crit" : kpis.pendientes > 0 ? "warn" : "ok"}
                chip={kpis.vencidas > 0 ? `${kpis.vencidas} VENCIDAS` : undefined}
              />
              <TarjetaKpi
                icon={CheckCircle2}
                titulo="Liquidadas"
                valor={`${kpis.liquidadas} · ${money(kpis.totalLiquidado)}`}
                subtitulo="ya pagadas"
                severidad="ok"
              />
              <TarjetaKpi
                icon={Landmark}
                titulo="Nómina pend. (informativa)"
                valor={money(kpis.totalNomina)}
                subtitulo="de los pendientes -- ver regla del plano"
                severidad="ok"
              />
            </div>
          </div>

          {/* Filtros / buscador */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="min-w-[200px] flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">Buscar (nombre o cédula)</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filtroTexto}
                  onChange={(e) => setFiltroTexto(e.target.value)}
                  placeholder="Ej. Juan Pérez o 1004504508"
                  className="h-9 pl-7 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Retiro desde</Label>
              <DatePickerField value={filtroDesde} onChange={setFiltroDesde} className="h-9 w-[150px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Retiro hasta</Label>
              <DatePickerField value={filtroHasta} onChange={setFiltroHasta} className="h-9 w-[150px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Estado</Label>
              <select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value as "todos" | EstadoLiquidacion)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="todos">Todos</option>
                <option value="pendiente">Pendiente</option>
                <option value="liquidada">Liquidada</option>
              </select>
            </div>
            {hayFiltrosActivos && (
              <Button size="sm" variant="outline" onClick={limpiarFiltros} className="h-9">
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Limpiar
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              {dataFiltrada.length} de {data.length} mostrados
            </div>
          </div>

          {/* Marcado masivo -- solo visible con algo seleccionado */}
          {seleccionadas.size > 0 && (
            <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-xs font-medium">{seleccionadas.size} seleccionada(s)</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setSeleccionadas(new Set())}>
                  Deseleccionar todo
                </Button>
                <Button size="sm" onClick={marcarSeleccionadasComoPagadas} disabled={marcandoMasivo}>
                  {marcandoMasivo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckSquare className="mr-1.5 h-3.5 w-3.5" />}
                  Marcar seleccionadas como pagadas
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-primary"
                      checked={todasFiltradasSeleccionadas}
                      onChange={toggleSeleccionarTodas}
                      aria-label="Seleccionar todo lo filtrado"
                    />
                  </TableHead>
                  <TableHead className="w-8" />
                  <TableHead>Persona</TableHead>
                  <TableHead>Cédula</TableHead>
                  <TableHead>Retiro</TableHead>
                  <TableHead className="text-right">Nómina pend.</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                  <TableHead className="text-right">Cesantías</TableHead>
                  <TableHead className="text-right">Intereses</TableHead>
                  <TableHead className="text-right">Vacaciones</TableHead>
                  <TableHead className="text-right">Indemnización</TableHead>
                  <TableHead className="text-right">Total a pagar</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataFiltrada.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={14} className="py-8 text-center text-sm text-muted-foreground">
                      {data.length === 0
                        ? "No hay personal retirado con contrato para esta empresa."
                        : "Ningún registro coincide con el filtro."}
                    </TableCell>
                  </TableRow>
                ) : (
                  dataFiltrada.map((p) => (
                    <Fragment key={p.identificacion || p.persona}>
                      <TableRow>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={seleccionadas.has(p.identificacion)}
                            onChange={() => toggleSeleccion(p.identificacion)}
                            aria-label={`Seleccionar ${p.persona}`}
                          />
                        </TableCell>
                        <TableCell className="cursor-pointer" onClick={() => toggle(p)}>
                          {expanded.has(p.persona) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-medium">{p.persona}</TableCell>
                        <TableCell className="font-mono text-xs">{p.identificacion}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span>{p.fecha_retiro || "—"}</span>
                            {p.motivo_retiro && (
                              <span
                                className={`inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-sans font-medium ${
                                  /sin\s+justa\s+causa/i.test(p.motivo_retiro)
                                    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {/sin\s+justa\s+causa/i.test(p.motivo_retiro) && <AlertTriangle className="h-2.5 w-2.5" />}
                                {p.motivo_retiro}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className={p.nominaPagadaPorPlano ? "text-muted-foreground line-through decoration-1" : ""}>
                              {money(p.total)}
                            </span>
                            {p.nominaPagadaPorPlano && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-400">
                                <Landmark className="h-2.5 w-2.5" /> cubierta por el plano
                              </span>
                            )}
                            {!p.nominaPagadaPorPlano && (p.auxilioTransportePendiente > 0 || p.deduccionLeyPendiente > 0) && (
                              <span
                                className="text-[9px] font-medium text-muted-foreground"
                                title="Auxilio de transporte prorrateado y descuentos de ley (4% salud + 4% pensión) sobre la nómina pendiente, igual que Siigo"
                              >
                                +{money(p.auxilioTransportePendiente)} aux · −{money(p.deduccionLeyPendiente)} ley
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="inline-flex items-center gap-1 justify-end">
                            {p.prima_real != null && (
                              <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Valor real confirmado" />
                            )}
                            {money(p.prima)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="inline-flex items-center gap-1 justify-end">
                            {p.cesantias_real != null && (
                              <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Valor real confirmado" />
                            )}
                            {money(p.cesantias)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="inline-flex items-center gap-1 justify-end">
                            {p.intereses_real != null && (
                              <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Valor real confirmado" />
                            )}
                            {money(p.intereses)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="inline-flex items-center gap-1 justify-end">
                            {p.vacaciones_real != null && (
                              <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Valor real confirmado" />
                            )}
                            {money(p.vacaciones)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="inline-flex items-center gap-1 justify-end">
                            {p.indemnizacion_real != null && (
                              <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Valor real confirmado" />
                            )}
                            {p.indemnizacion > 0 ? (
                              <span className="font-medium text-red-600 dark:text-red-400">{money(p.indemnizacion)}</span>
                            ) : (
                              money(p.indemnizacion)
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(p.total_liquidacion)}</TableCell>
                        <TableCell>
                          {p.estado === "liquidada" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Liquidada
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                              <Clock className="h-3 w-3" /> Pendiente
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            {p.soporte_url && (
                              <a
                                href={p.soporte_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                title={p.soporte_nombre || "Soporte"}
                              >
                                <FileText className="h-3.5 w-3.5" /> Ver
                              </a>
                            )}
                            <Button size="sm" variant="outline" disabled={busy === p.identificacion} onClick={() => pedirSoporte(p)}>
                              {busy === p.identificacion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                            </Button>
                            <Button
                              size="sm"
                              variant={p.estado === "liquidada" ? "outline" : "default"}
                              disabled={busy === p.identificacion}
                              onClick={() => cambiarEstado(p)}
                            >
                              {p.estado === "liquidada" ? "Reabrir" : "Liquidar"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded.has(p.persona) && (
                        <TableRow>
                          <TableCell colSpan={14} className="bg-muted/30 p-0">
                            <div className="space-y-2 p-3">
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="text-muted-foreground">Pagado hasta:</span>
                                <DatePickerField
                                  className="h-8 w-40"
                                  value={p.pagado_hasta || ""}
                                  maxDate={p.fecha_retiro || undefined}
                                  disabled={busy === p.identificacion}
                                  onChange={(value) => cambiarPagadoHasta(p, value)}
                                />
                                <span className="text-xs text-muted-foreground">
                                  Novedades <strong>posteriores</strong> a esta fecha (nómina pendiente), hasta el retiro.
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="text-muted-foreground">Motivo de retiro:</span>
                                <Select
                                  value={p.motivo_retiro || ""}
                                  onValueChange={(value) => cambiarMotivo(p, value)}
                                  disabled={busy === p.identificacion}
                                >
                                  <SelectTrigger className="h-8 w-64">
                                    <SelectValue placeholder="Sin especificar" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {MOTIVOS_RETIRO.map((m) => (
                                      <SelectItem key={m} value={m}>
                                        {m}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <span className="text-xs text-muted-foreground">
                                  La indemnización (Ley 789/2002) solo aplica cuando el motivo es{" "}
                                  <strong>Sin Justa Causa</strong>.
                                </span>
                              </div>

                              <div className="rounded-md border border-border bg-background p-2">
                                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                                  <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
                                  Valor real confirmado (opcional) — si lo pagado en Siigo no coincide con el cálculo,
                                  ingrésalo aquí y prevalece sobre la fórmula.
                                </div>
                                <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                                  {[
                                    { k: "cesantias" as const, l: "Cesantías" },
                                    { k: "intereses" as const, l: "Intereses" },
                                    { k: "prima" as const, l: "Prima" },
                                    { k: "vacaciones" as const, l: "Vacaciones" },
                                    { k: "indemnizacion" as const, l: "Indemnización" },
                                  ].map((f) => (
                                    <div key={f.k} className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">{f.l}</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="Fórmula"
                                        className="h-8"
                                        value={realesEdit[p.identificacion]?.[f.k] ?? ""}
                                        onChange={(e) => setReal(p.identificacion, f.k, e.target.value)}
                                      />
                                    </div>
                                  ))}
                                  <div className="flex items-end">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busy === p.identificacion}
                                      onClick={() => guardarReales(p)}
                                    >
                                      {busy === p.identificacion ? (
                                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Save className="mr-2 h-3.5 w-3.5" />
                                      )}
                                      Guardar
                                    </Button>
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-md border border-border bg-background p-2">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                                    <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                                    Deducciones (préstamos, anticipos, otros descuentos autorizados)
                                  </div>
                                  {p.deducciones > 0 && (
                                    <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                                      Total: −{money(p.deducciones)}
                                    </span>
                                  )}
                                </div>
                                {p.deduccion_items.length > 0 && (
                                  <div className="mb-2 space-y-1">
                                    {p.deduccion_items.map((d) => (
                                      <div
                                        key={d.id}
                                        className="flex items-center justify-between gap-2 rounded border border-border/60 bg-muted/30 px-2 py-1 text-xs"
                                      >
                                        <div>
                                          <span className="font-medium">{d.concepto}</span>
                                          {d.observacion && <span className="ml-1 text-muted-foreground">— {d.observacion}</span>}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="tabular-nums text-red-600 dark:text-red-400">−{money(d.valor)}</span>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 p-0"
                                            disabled={busy === p.identificacion}
                                            onClick={() => quitarDeduccion(p, d.id)}
                                          >
                                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                                  <div className="space-y-1 md:col-span-2">
                                    <Label className="text-xs text-muted-foreground">Concepto</Label>
                                    <Select
                                      value={deduccionForm[p.identificacion]?.concepto || ""}
                                      onValueChange={(value) =>
                                        setDeduccionForm((prev) => ({
                                          ...prev,
                                          [p.identificacion]: { ...prev[p.identificacion], concepto: value, valor: prev[p.identificacion]?.valor || "", observacion: prev[p.identificacion]?.observacion || "" },
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue placeholder="Elegir concepto" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {CONCEPTOS_DEDUCCION.map((c) => (
                                          <SelectItem key={c} value={c}>
                                            {c}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Valor</Label>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      className="h-8"
                                      value={deduccionForm[p.identificacion]?.valor || ""}
                                      onChange={(e) =>
                                        setDeduccionForm((prev) => ({
                                          ...prev,
                                          [p.identificacion]: { ...prev[p.identificacion], concepto: prev[p.identificacion]?.concepto || "", valor: e.target.value, observacion: prev[p.identificacion]?.observacion || "" },
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Observación (opcional)</Label>
                                    <Input
                                      className="h-8"
                                      value={deduccionForm[p.identificacion]?.observacion || ""}
                                      onChange={(e) =>
                                        setDeduccionForm((prev) => ({
                                          ...prev,
                                          [p.identificacion]: { ...prev[p.identificacion], concepto: prev[p.identificacion]?.concepto || "", valor: prev[p.identificacion]?.valor || "", observacion: e.target.value },
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="flex items-end">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busy === p.identificacion}
                                      onClick={() => agregarDeduccion(p)}
                                    >
                                      {busy === p.identificacion ? (
                                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Plus className="mr-2 h-3.5 w-3.5" />
                                      )}
                                      Agregar
                                    </Button>
                                  </div>
                                </div>
                              </div>

                              {p.novedades.length === 0 ? (
                                <div className="text-sm text-muted-foreground">Sin novedades de nómina pendientes.</div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead className="text-left text-muted-foreground">
                                      <tr>
                                        <th className="px-2 py-1">Fecha</th>
                                        <th className="px-2 py-1">Novedad</th>
                                        <th className="px-2 py-1 text-right">Base día</th>
                                        <th className="px-2 py-1 text-right">Extras+recargos</th>
                                        <th className="px-2 py-1 text-right">Total día</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {p.novedades.map((n, i) => (
                                        <tr key={i} className="border-t border-border/50">
                                          <td className="whitespace-nowrap px-2 py-1 font-mono">{n.fecha}</td>
                                          <td className="px-2 py-1">{n.novedad_reportada || n.actividad_registrada || "—"}</td>
                                          <td className="px-2 py-1 text-right tabular-nums">{money(n.base_dia)}</td>
                                          <td className="px-2 py-1 text-right tabular-nums">
                                            {money(n.hed + n.hedf + n.hen + n.hef + n.hn + n.pago_domingo + n.recargodominical)}
                                          </td>
                                          <td className="px-2 py-1 text-right font-medium tabular-nums">{money(n.total_liquidado_dia)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
