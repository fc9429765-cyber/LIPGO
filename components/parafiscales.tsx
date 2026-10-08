"use client"

// Submódulo "Parafiscales" (Gestión Humana › Nómina): cuadro de control de los
// aportes que la empresa paga cada mes a los entes de control (planilla PILA).
// Resumen por entidad + detalle por persona, con los % de ley editables.
// El cálculo vive en lib/parafiscales.ts; aquí solo se presenta.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Loader2,
  Landmark,
  SlidersHorizontal,
  Save,
  Scale,
  HeartPulse,
  ShieldAlert,
  Home,
  GraduationCap,
  Baby,
  PiggyBank,
  AlertTriangle,
  CheckCircle2,
  Info,
  RotateCcw,
  RefreshCw,
  BadgeCheck,
  Pencil,
  X,
  Download,
} from "lucide-react"
import {
  getParafiscales,
  guardarParametrosParafiscales,
  guardarValorRealParafiscal,
  type ParafiscalPersona,
  type ResumenParafiscales,
} from "@/lib/parafiscales-actions"
import { generarArchivoCargaPila } from "@/lib/parafiscales-exportador-actions"
import PrestacionesActivos from "@/components/prestaciones-activos"
import CuadroControlNomina from "@/components/cuadro-control-nomina"
import {
  calcularAportes,
  validarParametros,
  CLASES_ARL,
  REFERENCIAS_LEY,
  PARAFISCALES_DEFAULT,
  type ClaseRiesgo,
  type ParametrosParafiscales,
} from "@/lib/parafiscales"
import { useClaveAccion } from "@/components/clave-accion-provider"

const money = (n: number) =>
  "$" + Math.round(Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

export default function Parafiscales() {
  const { selectedEmpresaId } = useAuth()
  const { conClave } = useClaveAccion()
  const { toast } = useToast()
  const hoy = new Date()
  // Seguridad Social y Parafiscales se pagan MES VENCIDO (la planilla PILA de
  // un mes se liquida y paga al mes siguiente) — por defecto se abre en el mes
  // anterior al actual, que es el que realmente hay que pagar hoy. El mes en
  // curso todavía no cierra (personal con novedades a mitad de mes, días que
  // aún no ocurren) y no es la cifra a girar.
  const mesVencido = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
  const [anio, setAnio] = useState(mesVencido.getFullYear())
  const [mes, setMes] = useState(mesVencido.getMonth() + 1)
  const [consolidado, setConsolidado] = useState(false)
  const [data, setData] = useState<ParafiscalPersona[]>([])
  const [resumen, setResumen] = useState<ResumenParafiscales | null>(null)
  const [params, setParams] = useState<ParametrosParafiscales>({ anio, ...PARAFISCALES_DEFAULT })
  const [smlv, setSmlv] = useState(0)
  const [auxMes, setAuxMes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [savingParams, setSavingParams] = useState(false)
  const [showParams, setShowParams] = useState(false)
  const [showNomenclatura, setShowNomenclatura] = useState(false)
  // Confirmación explícita cuando un parámetro se aparta del valor de ley vigente.
  const [confirmaReforma, setConfirmaReforma] = useState(false)
  // Valor REAL del IBC (lo radicado en Aportes en Línea), cuando difiere de la
  // fórmula en vivo -- mismo patrón que el "valor real" de Liquidaciones.
  const [editandoReal, setEditandoReal] = useState<string | null>(null)
  const [valorReal, setValorReal] = useState("")
  const [guardandoReal, setGuardandoReal] = useState<string | null>(null)
  const [descargandoCarga, setDescargandoCarga] = useState(false)

  const cargar = useCallback(async () => {
    if (!consolidado && !selectedEmpresaId) {
      setData([])
      setResumen(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const r = await getParafiscales(consolidado ? null : selectedEmpresaId, anio, mes)
    if (r.success) {
      setData(r.data)
      setResumen(r.resumen ?? null)
      if (r.params) setParams(r.params)
      if (r.smlv) setSmlv(r.smlv)
      if (r.auxilio != null) setAuxMes(r.auxilio)
    } else {
      setData([])
      setResumen(null)
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
    setLoading(false)
  }, [selectedEmpresaId, consolidado, anio, mes, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  // El periodo elegido es el mes en curso (todavía no cierra) o incluso un mes
  // futuro — en ninguno de los dos casos es la cifra a pagar hoy (mes vencido).
  const periodoNoCerrado = anio > hoy.getFullYear() || (anio === hoy.getFullYear() && mes >= hoy.getMonth() + 1)

  // Contraste contra la norma vigente: "error" bloquea el guardado; "aviso"
  // (apartarse del valor de ley) exige confirmar que responde a una reforma.
  const avisos = useMemo(() => validarParametros({ ...params, anio }), [params, anio])
  const errores = useMemo(() => avisos.filter((a) => a.nivel === "error"), [avisos])
  const desviaciones = useMemo(() => avisos.filter((a) => a.nivel === "aviso"), [avisos])
  const bloqueado = errores.length > 0 || (desviaciones.length > 0 && !confirmaReforma)

  const guardarParams = async () => {
    setSavingParams(true)
    const r = await conClave("Parafiscales", "configurar", (clave) => guardarParametrosParafiscales({ ...params, anio }, clave))
    setSavingParams(false)
    if (r.success) {
      toast({ title: "Parámetros guardados", description: `Año ${anio} actualizado. Se recalcularon los aportes.` })
      setConfirmaReforma(false)
      await cargar()
    } else toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
  }

  const restaurarLey = () => {
    setParams((prev) => ({ ...prev, ...PARAFISCALES_DEFAULT, anio }))
    setConfirmaReforma(false)
    toast({ title: "Valores de ley restaurados", description: "Revísalos y guarda para aplicarlos." })
  }

  const setP = (k: keyof ParametrosParafiscales, v: number | boolean | string) => {
    setParams((prev) => ({ ...prev, [k]: v }) as ParametrosParafiscales)
    setConfirmaReforma(false)
  }

  const abrirEdicionReal = (p: ParafiscalPersona) => {
    setEditandoReal(p.identificacion)
    setValorReal(p.ibcReal != null ? String(Math.round(p.ibcReal)) : "")
  }

  const guardarReal = async (p: ParafiscalPersona) => {
    const num = valorReal.trim() === "" ? null : Number(valorReal)
    if (num != null && !Number.isFinite(num)) {
      toast({ title: "Valor inválido", description: "Ingresa un número o deja el campo vacío.", variant: "destructive" })
      return
    }
    setGuardandoReal(p.identificacion)
    const r = await guardarValorRealParafiscal({
      idempresa: p.idempresa,
      identificacion: p.identificacion,
      persona: p.persona,
      anio,
      mes,
      ibcReal: num,
      diasReal: p.dias,
    })
    setGuardandoReal(null)
    if (r.success) {
      setEditandoReal(null)
      await cargar()
      toast({
        title: "Guardado",
        description: num != null ? "Se guardó el IBC real de Aportes en Línea." : "Se quitó el valor real (vuelve a la fórmula).",
      })
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const descargarArchivoCarga = async () => {
    setDescargandoCarga(true)
    const r = await generarArchivoCargaPila(anio, mes)
    setDescargandoCarga(false)
    if (!r.success || !r.base64) {
      toast({ title: "No se pudo generar el archivo", description: r.message, variant: "destructive" })
      return
    }
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = r.filename || `Planilla PILA ${mes}-${anio}.txt`
    a.click()
    URL.revokeObjectURL(url)
    if (r.excepciones && r.excepciones.length > 0) {
      toast({
        title: `Archivo generado -- ${r.excepciones.length} caso(s) para revisar`,
        description: r.excepciones.slice(0, 3).map((e) => `${e.persona}: ${e.motivo}`).join(" · "),
      })
    } else {
      toast({ title: "Archivo generado", description: "Revísalo antes de subirlo a Aportes en Línea." })
    }
  }

  // Preview en vivo: cómo queda un trabajador de SMLV con estos parámetros.
  const preview = useMemo(
    () =>
      smlv > 0
        ? calcularAportes(
            {
              salario: smlv,
              ibcTrabajado: smlv,
              diasTrabajados: 30,
              diasVacaciones: 0,
              diasIncapacidad: 0,
              diasAusentismo: 0,
              diasLicencia: 0,
              auxilio: auxMes,
              smlv,
              esAdmin: false,
            },
            { ...params, anio },
          )
        : null,
    [smlv, auxMes, params, anio],
  )

  // Tarjetas por ENTIDAD: lo que se gira a cada ente de control.
  const entidades = useMemo(() => {
    if (!resumen) return []
    const arlPct = data.length
      ? Array.from(new Set(data.map((p) => p.pctArl))).sort((a, b) => a - b).map((x) => `${x}%`).join(" / ")
      : "—"
    return [
      {
        k: "pension",
        nombre: "Pensión",
        icon: PiggyBank,
        pct: `${params.pctPensionEmpleador}%`,
        empresa: resumen.pensionEmpleador,
        empleado: resumen.pensionEmpleado,
        nota: `Empleador ${params.pctPensionEmpleador}% + trabajador ${params.pctPensionEmpleado}%`,
      },
      {
        k: "salud",
        nombre: "Salud (EPS)",
        icon: HeartPulse,
        pct: `${params.pctSaludEmpleador}%`,
        empresa: resumen.saludEmpleador,
        empleado: resumen.saludEmpleado,
        nota:
          resumen.saludEmpleador === 0
            ? `Empleador exonerado (art. 114-1) · trabajador ${params.pctSaludEmpleado}%`
            : `Empleador ${params.pctSaludEmpleador}% + trabajador ${params.pctSaludEmpleado}%`,
      },
      {
        k: "arl",
        nombre: "ARL",
        icon: ShieldAlert,
        pct: arlPct,
        empresa: resumen.arl,
        empleado: 0,
        nota: "100% empresa · según clase de riesgo · solo días trabajados",
      },
      {
        k: "caja",
        nombre: "Caja de Compensación",
        icon: Home,
        pct: `${params.pctCaja}%`,
        empresa: resumen.caja,
        empleado: 0,
        nota: "Obligatorio para todos · NO tiene exenciones",
      },
      {
        k: "sena",
        nombre: "SENA",
        icon: GraduationCap,
        pct: `${params.pctSena}%`,
        empresa: resumen.sena,
        empleado: 0,
        nota: resumen.sena === 0 ? "Exonerado (art. 114-1)" : "Causa: hay salarios ≥ 10 SMMLV",
      },
      {
        k: "icbf",
        nombre: "ICBF",
        icon: Baby,
        pct: `${params.pctIcbf}%`,
        empresa: resumen.icbf,
        empleado: 0,
        nota: resumen.icbf === 0 ? "Exonerado (art. 114-1)" : "Causa: hay salarios ≥ 10 SMMLV",
      },
    ]
  }, [resumen, params, data])

  return (
    <div className="space-y-4">
      <CuadroControlNomina parafiscalesResumen={resumen} parafiscalesPeriodoLabel={`${MESES[mes - 1]} ${anio}`} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-5 w-5 text-primary" /> Parafiscales y Seguridad Social
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="default" onClick={descargarArchivoCarga} disabled={descargandoCarga || loading}>
              {descargandoCarga ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Archivo de carga (Aportes en Línea)
            </Button>
            <Button size="sm" variant="outline" onClick={cargar} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowNomenclatura((s) => !s)}>
              <Scale className="mr-2 h-4 w-4" /> Nomenclatura legal
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowParams((s) => !s)}>
              <SlidersHorizontal className="mr-2 h-4 w-4" /> Parámetros de ley
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Aportes del mes a los <strong>entes de control</strong> (planilla PILA), calculados sobre el{" "}
            <strong>IBC real</strong> de cada trabajador (salario + extras + recargos + dominicales, sin auxilio de
            transporte). Aplica la <strong>exoneración del art. 114-1</strong> del Estatuto Tributario.
          </p>

          {/* Periodo */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Año</Label>
              <Input
                type="number"
                className="w-28"
                value={anio}
                onChange={(e) => setAnio(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Mes</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={mes}
                onChange={(e) => setMes(Number(e.target.value))}
              >
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex h-10 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={consolidado}
                onChange={(e) => setConsolidado(e.target.checked)}
              />
              Consolidado LIP (todos los clientes)
            </label>
            {smlv > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                SMLV {anio}: <strong>{money(smlv)}</strong> · umbral art. 114-1:{" "}
                <strong>{money(smlv * params.umbralExoneracionSmlv)}</strong>
              </span>
            )}
          </div>

          {periodoNoCerrado && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>{MESES[mes - 1]} {anio}</strong> todavía no cierra — Seguridad Social y Parafiscales se
                pagan <strong>mes vencido</strong>, así que esto NO es la cifra a girar hoy. Los días que faltan del
                mes aún no tienen novedades y el personal recién ingresado solo alcanza a mostrar sus días reales.
                Para la planilla PILA que hay que pagar ahora, usa el mes anterior (ya cerrado).
              </span>
            </div>
          )}

          {/* CUADRO DE MANDO: parámetros por año, contrastados contra la norma.
              Editable, pero cada valor muestra la norma que lo fija y su valor de
              ley; salirse del rango admisible bloquea el guardado y apartarse del
              valor de ley exige confirmar que responde a una reforma vigente. */}
          {showParams && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <SlidersHorizontal className="h-4 w-4 text-primary" /> Cuadro de mando de aportes · {anio}
                </div>
                <Button size="sm" variant="outline" onClick={restaurarLey}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Restaurar valores de ley
                </Button>
              </div>

              {/* Tarifas por ente de control */}
              <div className="overflow-x-auto rounded-md border border-border bg-background">
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Concepto</th>
                      <th className="px-3 py-2 font-medium">Ente de control</th>
                      <th className="px-3 py-2 font-medium">Norma que lo fija</th>
                      <th className="px-3 py-2 text-right font-medium">Valor de ley</th>
                      <th className="px-3 py-2 text-right font-medium">Valor aplicado</th>
                      <th className="px-3 py-2 text-center font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REFERENCIAS_LEY.map((ref) => {
                      const v = Number(params[ref.campo])
                      const err = errores.some((a) => a.campo === ref.campo)
                      const dif = desviaciones.some((a) => a.campo === ref.campo)
                      return (
                        <tr key={ref.campo} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-2 font-medium text-foreground">{ref.label}</td>
                          <td className="px-3 py-2 text-muted-foreground">{ref.ente}</td>
                          <td className="px-3 py-2 text-muted-foreground">{ref.norma}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {ref.valorLey}
                            {ref.unidad}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              step="0.001"
                              className={`ml-auto h-8 w-28 text-right tabular-nums ${
                                err ? "border-destructive focus-visible:ring-destructive" : ""
                              }`}
                              value={Number.isFinite(v) ? v : ""}
                              onChange={(e) => setP(ref.campo, Number(e.target.value))}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {err ? (
                              <span className="inline-flex items-center gap-1 text-destructive">
                                <AlertTriangle className="h-3.5 w-3.5" /> Fuera de rango
                              </span>
                            ) : dif ? (
                              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="h-3.5 w-3.5" /> Difiere de la ley
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Conforme
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Clase de riesgo ARL + base de parafiscales */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2 rounded-md border border-border bg-background p-3">
                  <div className="text-xs font-semibold">Clase de riesgo ARL · Decreto 1772/1994</div>
                  {[
                    { k: "claseArlOperativo" as const, l: "Personal operativo" },
                    { k: "claseArlAdmin" as const, l: "Personal administrativo" },
                  ].map((f) => (
                    <div key={f.k} className="flex items-center justify-between gap-2">
                      <Label className="text-xs text-muted-foreground">{f.l}</Label>
                      <select
                        className="h-8 w-64 rounded-md border border-input bg-background px-2 text-xs"
                        value={params[f.k] as ClaseRiesgo}
                        onChange={(e) => setP(f.k, e.target.value)}
                      >
                        {CLASES_ARL.map((c) => (
                          <option key={c.clase} value={c.clase}>
                            {c.clase} — {c.pct}% · {c.ejemplo}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    La clase la asigna la ARL según la actividad económica. Se aplica por tipo de personal: los
                    marcados como <strong>administrativos</strong> en Head Count usan la clase administrativa; el
                    resto, la operativa.
                  </p>
                </div>

                {/* Preview en vivo con estos parámetros */}
                <div className="space-y-2 rounded-md border border-border bg-background p-3">
                  <div className="text-xs font-semibold">
                    Preview · trabajador de SMLV, mes completo, clase {params.claseArlOperativo}
                  </div>
                  {preview ? (
                    <>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {[
                          ["IBC", preview.ibc],
                          ["Pensión", preview.pensionEmpleador],
                          ["Salud", preview.saludEmpleador],
                          ["ARL", preview.arl],
                          ["Caja", preview.caja],
                          ["SENA", preview.sena],
                          ["ICBF", preview.icbf],
                        ].map(([l, v]) => (
                          <div key={l as string} className="flex justify-between">
                            <span className="text-muted-foreground">{l as string}</span>
                            <span className="tabular-nums">{money(v as number)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-baseline justify-between border-t border-border pt-2">
                        <span className="text-xs text-muted-foreground">Costo empresa / trabajador / mes</span>
                        <span className="text-base font-bold tabular-nums text-primary">
                          {money(preview.totalEmpresa)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {preview.exonerado
                          ? "Exonerado del art. 114-1: no causa salud patronal, SENA ni ICBF."
                          : "No exonerado: causa salud patronal, SENA e ICBF."}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Carga el SMLV del año {anio} en el cuadro de mando de nómina para ver el preview.
                    </p>
                  )}
                  <label className="flex cursor-pointer items-center gap-2 border-t border-border pt-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={params.incluyeAuxParafiscales}
                      onChange={(e) => setP("incluyeAuxParafiscales", e.target.checked)}
                    />
                    Sumar el auxilio de transporte a la base de Caja/SENA/ICBF
                  </label>
                </div>
              </div>

              {/* Barandas: errores bloquean; desviaciones exigen confirmación */}
              {errores.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-destructive">
                    <AlertTriangle className="h-4 w-4" /> No se puede guardar: hay valores fuera de lo admisible
                  </div>
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-destructive">
                    {errores.map((a, i) => (
                      <li key={i}>{a.mensaje}</li>
                    ))}
                  </ul>
                </div>
              )}
              {errores.length === 0 && desviaciones.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" /> Estos valores se apartan de la norma vigente
                  </div>
                  <ul className="mb-2 list-inside list-disc space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                    {desviaciones.map((a, i) => (
                      <li key={i}>{a.mensaje}</li>
                    ))}
                  </ul>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={confirmaReforma}
                      onChange={(e) => setConfirmaReforma(e.target.checked)}
                    />
                    Confirmo que estos valores corresponden a una <strong>reforma legal vigente</strong> para {anio}.
                  </label>
                </div>
              )}
              {errores.length === 0 && desviaciones.length === 0 && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> Todos los parámetros están conforme a la norma vigente.
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button size="sm" onClick={guardarParams} disabled={savingParams || bloqueado}>
                  {savingParams ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Guardar parámetros {anio}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Los parámetros se guardan <strong>por año</strong>: cambiar el año de arriba edita ese año sin tocar
                  los anteriores.
                </span>
              </div>
            </div>
          )}

          {/* Nomenclatura legal */}
          {showNomenclatura && (
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Scale className="h-4 w-4 text-primary" /> Nomenclatura legal de los aportes
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                Fundamento normativo de cada aporte (Ministerio de Trabajo · Estatuto Tributario).{" "}
                <strong>Siempre prima la ley.</strong>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-xs">
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
                        c: "IBC (Ingreso Base de Cotización)",
                        n: "Ley 100 de 1993 art. 18 · CST art. 127 y 128",
                        b: "Salario básico + comisiones + horas extras + recargo nocturno + dominicales y festivos",
                        f: "NO incluye el auxilio de transporte (no es salario). Piso: 1 SMLV mensual, proporcional a los días cotizados. Tope: 25 SMLV.",
                      },
                      {
                        c: "Pensión",
                        n: "Ley 100 de 1993 art. 20",
                        b: "IBC",
                        f: "16% total: 12% a cargo de la EMPRESA + 4% a cargo del trabajador. No tiene exoneración.",
                      },
                      {
                        c: "Salud (EPS)",
                        n: "Ley 100 de 1993 art. 204 · E.T. art. 114-1",
                        b: "IBC",
                        f: "12,5% total: 8,5% empresa + 4% trabajador. La empresa está EXONERADA del 8,5% por los trabajadores que devenguen menos de 10 SMMLV. El 4% del trabajador siempre se retiene.",
                      },
                      {
                        c: "Riesgos Laborales (ARL)",
                        n: "Decreto 1772 de 1994 · Ley 1562 de 2012",
                        b: "IBC",
                        f: "100% a cargo de la EMPRESA, según la clase de riesgo: I 0,522% · II 1,044% · III 2,436% · IV 4,350% · V 6,960%.",
                      },
                      {
                        c: "Caja de Compensación Familiar",
                        n: "Ley 21 de 1982",
                        b: "IBC + auxilio de transporte",
                        f: "4% a cargo de la EMPRESA. Obligatorio para TODOS los trabajadores — no tiene exenciones.",
                      },
                      {
                        c: "SENA",
                        n: "Ley 21 de 1982 · E.T. art. 114-1",
                        b: "IBC + auxilio de transporte",
                        f: "2% a cargo de la EMPRESA. EXONERADO por los trabajadores que devenguen menos de 10 SMMLV.",
                      },
                      {
                        c: "ICBF",
                        n: "Ley 89 de 1988 · E.T. art. 114-1",
                        b: "IBC + auxilio de transporte",
                        f: "3% a cargo de la EMPRESA. EXONERADO por los trabajadores que devenguen menos de 10 SMMLV.",
                      },
                      {
                        c: "Auxilio de transporte",
                        n: "CST art. 128 · Ley 15 de 1959",
                        b: "—",
                        f: "Se paga a quien devengue hasta 2 SMMLV, proporcional a los días laborados. NO es base de salud, pensión ni ARL; sí se suma para Caja/SENA/ICBF.",
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
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Calculando los aportes del período…
          </CardContent>
        </Card>
      ) : !resumen || data.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {!consolidado && !selectedEmpresaId
              ? "Selecciona una empresa (o marca “Consolidado LIP”) para ver el cuadro."
              : `No hay nómina registrada en ${MESES[mes - 1]} de ${anio} para este alcance.`}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Resumen por ENTIDAD */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entidades.map((e) => {
              const Icon = e.icon
              const cero = e.empresa === 0
              return (
                <Card key={e.k} className={cero ? "opacity-70" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold">{e.nombre}</span>
                      </div>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{e.pct}</span>
                    </div>
                    <div className="mt-2 text-2xl font-bold tabular-nums">{money(e.empresa)}</div>
                    <div className="text-xs text-muted-foreground">a cargo de la empresa</div>
                    {e.empleado > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        + {money(e.empleado)} retenido al trabajador ={" "}
                        <strong>{money(e.empresa + e.empleado)}</strong> a girar
                      </div>
                    )}
                    <div className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">{e.nota}</div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Totales */}
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
              {[
                { l: "Trabajadores", v: String(resumen.personas), sub: `${resumen.exonerados} exonerados (114-1)` },
                { l: "IBC total del mes", v: money(resumen.ibc), sub: "base de cotización" },
                { l: "Aporte EMPRESA", v: money(resumen.totalEmpresa), sub: "costo real del empleador", fuerte: true },
                { l: "Retenido al trabajador", v: money(resumen.totalEmpleado), sub: "salud 4% + pensión 4%" },
                { l: "Total planilla PILA", v: money(resumen.totalPila), sub: "lo que se gira", fuerte: true },
              ].map((t) => (
                <div key={t.l}>
                  <div className="text-xs text-muted-foreground">{t.l}</div>
                  <div className={`text-xl font-bold tabular-nums ${t.fuerte ? "text-primary" : ""}`}>{t.v}</div>
                  <div className="text-xs text-muted-foreground">{t.sub}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Detalle por PERSONA */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Detalle por trabajador — {MESES[mes - 1]} {anio}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trabajador</TableHead>
                    <TableHead className="text-center">Días (trab · nov.)</TableHead>
                    <TableHead className="text-right">IBC total (real ✎)</TableHead>
                    <TableHead className="text-right">IBC salud</TableHead>
                    <TableHead className="text-right">IBC ARL</TableHead>
                    <TableHead className="text-right">Auxilio</TableHead>
                    <TableHead className="text-center">ARL</TableHead>
                    <TableHead className="text-right">Pensión (empresa)</TableHead>
                    <TableHead className="text-right">Salud (empresa)</TableHead>
                    <TableHead className="text-right">ARL $</TableHead>
                    <TableHead className="text-right">Caja</TableHead>
                    <TableHead className="text-right">SENA</TableHead>
                    <TableHead className="text-right">ICBF</TableHead>
                    <TableHead className="text-right">Total empresa</TableHead>
                    <TableHead className="text-right">Pensión (retenido)</TableHead>
                    <TableHead className="text-right">Salud (retenido)</TableHead>
                    <TableHead className="text-right">Total retenido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((p) => (
                    <TableRow key={p.identificacion || p.persona}>
                      <TableCell>
                        <div className="font-medium">{p.persona}</div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{p.identificacion}</span>
                          {p.esAdmin && <span className="rounded bg-muted px-1 py-0.5 text-[10px]">Admin</span>}
                          {p.diasVacaciones > 0 && (
                            <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                              Vacaciones {p.diasVacaciones}d
                            </span>
                          )}
                          {p.diasIncapacidad > 0 && (
                            <span className="rounded bg-sky-500/15 px-1 py-0.5 text-[10px] text-sky-600 dark:text-sky-400">
                              Incapacidad {p.diasIncapacidad}d
                            </span>
                          )}
                          {p.diasAusentismo > 0 && (
                            <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                              Ausentismo {p.diasAusentismo}d
                            </span>
                          )}
                          {p.diasLicenciaRemunerada > 0 && (
                            <span className="rounded bg-violet-500/15 px-1 py-0.5 text-[10px] text-violet-600 dark:text-violet-400">
                              Licencia {p.diasLicenciaRemunerada}d
                            </span>
                          )}
                          {!p.exonerado && (
                            <span className="rounded bg-rose-500/15 px-1 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">
                              ≥ 10 SMMLV
                            </span>
                          )}
                          {p.vacacionesLiquidacion > 0 && (
                            <span
                              className="rounded bg-teal-500/15 px-1 py-0.5 text-[10px] text-teal-600 dark:text-teal-400"
                              title="Vacaciones pagadas en la liquidación de retiro -- suman al IBC de Caja de este mes"
                            >
                              +Vac. liquidación {money(p.vacacionesLiquidacion)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        <div className="font-medium">{p.dias}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {p.diasTrabajados}t
                          {p.diasVacaciones > 0 && ` · ${p.diasVacaciones}v`}
                          {p.diasIncapacidad > 0 && ` · ${p.diasIncapacidad}i`}
                          {p.diasAusentismo > 0 && ` · ${p.diasAusentismo}a`}
                          {p.diasLicenciaRemunerada > 0 && ` · ${p.diasLicenciaRemunerada}l`}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {editandoReal === p.identificacion ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              step="1"
                              placeholder="Fórmula"
                              className="h-7 w-28 text-right"
                              value={valorReal}
                              onChange={(e) => setValorReal(e.target.value)}
                              autoFocus
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              disabled={guardandoReal === p.identificacion}
                              onClick={() => guardarReal(p)}
                              title="Guardar valor real"
                            >
                              {guardandoReal === p.identificacion ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => setEditandoReal(null)}
                              title="Cancelar"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="inline-flex items-center justify-end gap-1">
                            {p.tieneValorReal && (
                              <BadgeCheck
                                className="h-3.5 w-3.5 text-emerald-600"
                                aria-label="IBC real confirmado (Aportes en Línea)"
                              />
                            )}
                            {money(p.ibc)}
                            <button
                              type="button"
                              onClick={() => abrirEdicionReal(p)}
                              className="text-muted-foreground/60 hover:text-foreground"
                              title="Editar IBC real (Aportes en Línea)"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {p.ibcSalud === 0 ? "—" : money(p.ibcSalud)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {p.ibcArl === 0 ? "—" : money(p.ibcArl)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {money(p.auxilio)}
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {p.claseArl} · {p.pctArl}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.pensionEmpleador)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.saludEmpleador === 0 ? <span className="text-muted-foreground">—</span> : money(p.saludEmpleador)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.arl === 0 ? <span className="text-muted-foreground">—</span> : money(p.arl)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.caja)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.sena === 0 ? <span className="text-muted-foreground">—</span> : money(p.sena)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.icbf === 0 ? <span className="text-muted-foreground">—</span> : money(p.icbf)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(p.totalEmpresa)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{money(p.pensionEmpleado)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {p.saludEmpleado === 0 ? <span className="text-muted-foreground">—</span> : money(p.saludEmpleado)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(p.totalEmpleado)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <p>
                  <strong>Días</strong>: t = trabajados · v = vacaciones · i = incapacidad · a = ausentismo ·
                  l = licencia remunerada. Cada día cotiza según la norma:{" "}
                  <strong>vacaciones</strong> → pensión + salud + caja (no ARL);{" "}
                  <strong>incapacidad</strong> → pensión (12% empresa + 4% trabajador) + SOLO el 4% de salud del
                  trabajador — la empresa no paga su 8.5% (lo asume la EPS/ARL); no causa caja ni ARL;{" "}
                  <strong>licencia remunerada</strong> (luto/maternidad/paternidad) → pensión + salud + caja;{" "}
                  <strong>ausentismo</strong> (licencia no remunerada / suspensión temporal de contrato) → solo el
                  12% de pensión (empleador). La{" "}
                  <strong>ARL solo se causa sobre los días trabajados</strong>: cualquier novedad que impida asistir a
                  trabajar no paga ARL (por eso “IBC ARL” suele ser menor que el IBC total). No se liquidan días
                  posteriores a la fecha de retiro.
                </p>
                <p>
                  “—” = no se causa: por la exoneración del art. 114-1 del E.T. (devenga menos de{" "}
                  {params.umbralExoneracionSmlv} SMMLV), porque ese concepto no aplica a los días del mes, o porque
                  la novedad es incapacidad (salud empresa). La <strong>Caja de Compensación</strong> nunca se
                  exonera. Las <strong>vacaciones pagadas en una liquidación de retiro</strong> (badge “+Vac.
                  liquidación”) suman su valor solo al IBC de Caja del mes del retiro.
                </p>
                <p>
                  <BadgeCheck className="inline h-3 w-3 text-emerald-600" /> junto al IBC = se guardó el valor{" "}
                  <strong>REAL</strong> radicado en Aportes en Línea para ese mes (prevalece sobre la fórmula). El
                  ícono de lápiz permite registrarlo o borrarlo — dejar el campo vacío vuelve a la fórmula en vivo.
                </p>
              </div>
            </CardContent>
          </Card>

          <PrestacionesActivos />
        </>
      )}
    </div>
  )
}
