"use client"

// Cuadro de mando de nómina: parámetros legales por INTERVALO DE FECHA (vigencias).
// Cada vigencia (SMLV, auxilio, días, jornada y % de recargos) rige desde su
// `fecha_desde` hasta la siguiente. La vista pagonomina toma, para cada turno, la
// vigencia con el mayor fecha_desde ≤ fecha — así los cambios legales de mitad de año
// (jornada 16-jul, recargo dominical 16-jul y sus derivados hedf/hef) se aplican solos.
// Fuente: parametros_legales_vigencia (Paso SQL). El preview usa el SMLV de la vigencia.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Info, Loader2, Save, Plus, Trash2, CalendarClock, RefreshCw } from "lucide-react"
import {
  getVigenciasParametros,
  guardarVigenciaParametros,
  eliminarVigenciaParametros,
} from "@/lib/parametros-nomina-actions"
import {
  calcularRecargos,
  PARAMS_NOMINA_DEFAULTS,
  type ParametrosLegalesBase,
  type VigenciaParametros,
} from "@/lib/parametros-nomina"
import { useClaveAccion } from "@/components/clave-accion-provider"

const money = (n: number) =>
  "$" + (Number(n) || 0).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })
const fmtFecha = (f: string) =>
  new Date(f + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })

type Recargos = ReturnType<typeof calcularRecargos>
const RECARGO_ROWS: {
  campo: keyof ParametrosLegalesBase
  label: string
  tipo: "extra" | "recargo" | "dia"
  col: string
  val: (r: Recargos) => number
}[] = [
  { campo: "pctHed", label: "Hora extra diurna (HED)", tipo: "extra", col: "hed", val: (r) => r.hed },
  { campo: "pctHen", label: "Hora extra nocturna (HEN)", tipo: "extra", col: "hen", val: (r) => r.hen },
  { campo: "pctHn", label: "Recargo nocturno (HN)", tipo: "recargo", col: "hn", val: (r) => r.hn },
  { campo: "pctHedf", label: "H.E. diurna dom/festiva (HEDF)", tipo: "extra", col: "hedf", val: (r) => r.hedf },
  { campo: "pctHef", label: "H.E. nocturna dom/festiva (HEF)", tipo: "extra", col: "hef", val: (r) => r.hef },
  {
    campo: "pctRecargoDominical",
    label: "Recargo dominical/festivo",
    tipo: "dia",
    col: "recargodominical",
    val: (r) => r.recargoDominical,
  },
  {
    campo: "pctRecargoNocturnoDominical",
    label: "Recargo nocturno dominical",
    tipo: "recargo",
    col: "—",
    val: (r) => r.recargoNocturnoDominical,
  },
]

function factorTxt(tipo: "extra" | "recargo" | "dia", pct: number): string {
  const f = (Number(pct) || 0) / 100
  if (tipo === "extra") return `×${(1 + f).toFixed(2)}`
  if (tipo === "dia") return `día ×${f.toFixed(2)}`
  return `×${f.toFixed(2)}`
}

const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const nuevaVigencia = (fechaDesde: string): VigenciaParametros => ({
  fechaDesde,
  smlv: 0,
  auxilio: 0,
  ...PARAMS_NOMINA_DEFAULTS,
})

export function CuadroMandoNomina() {
  const { toast } = useToast()
  const { conClave } = useClaveAccion()
  const [vigencias, setVigencias] = useState<VigenciaParametros[]>([])
  const [sel, setSel] = useState<string | null>(null) // fechaDesde seleccionada
  const [params, setParams] = useState<VigenciaParametros>(() => nuevaVigencia(hoyISO()))
  const [esNueva, setEsNueva] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const cargar = useCallback(
    async (seleccionar?: string) => {
      setLoading(true)
      const r = await getVigenciasParametros()
      if (r.success && r.data) {
        setVigencias(r.data)
        const pick = seleccionar ?? sel ?? r.data[0]?.fechaDesde ?? null
        const found = r.data.find((v) => v.fechaDesde === pick)
        if (found) {
          setSel(found.fechaDesde)
          setParams(found)
          setEsNueva(false)
        } else if (r.data.length === 0) {
          setSel(null)
        }
      } else {
        toast({ title: "No se pudieron cargar las vigencias", description: r.message, variant: "destructive" })
      }
      setLoading(false)
    },
    [sel, toast],
  )

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const seleccionar = (v: VigenciaParametros) => {
    setSel(v.fechaDesde)
    setParams(v)
    setEsNueva(false)
  }

  const nueva = () => {
    const v = nuevaVigencia(hoyISO())
    setSel(null)
    setParams(v)
    setEsNueva(true)
  }

  const set = <K extends keyof VigenciaParametros>(campo: K, value: VigenciaParametros[K]) =>
    setParams((p) => ({ ...p, [campo]: value }))

  const calc = useMemo(() => calcularRecargos(params.smlv, params.auxilio, params), [params])
  const divisorMensual = (Number(params.diasCalendario) || 0) * (Number(params.jornadaHoras) || 0)

  const guardar = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fechaDesde)) {
      toast({ title: "Fecha inválida", description: "Use el formato AAAA-MM-DD.", variant: "destructive" })
      return
    }
    setSaving(true)
    const r = await conClave("Liquidaciones", "configurar", (clave) => guardarVigenciaParametros(params, clave))
    setSaving(false)
    if (r.success) {
      toast({ title: "Vigencia guardada", description: `Rige desde ${fmtFecha(params.fechaDesde)}.` })
      await cargar(params.fechaDesde)
    } else toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
  }

  const eliminar = async () => {
    if (esNueva || !sel) return
    if (!confirm(`¿Eliminar la vigencia que rige desde ${fmtFecha(sel)}?`)) return
    setSaving(true)
    const r = await conClave("Liquidaciones", "configurar", (clave) => eliminarVigenciaParametros(sel, clave))
    setSaving(false)
    if (r.success) {
      toast({ title: "Vigencia eliminada" })
      setSel(null)
      await cargar()
    } else toast({ title: "No se pudo eliminar", description: r.message, variant: "destructive" })
  }

  return (
    <div className="space-y-4">
      {/* Selector de vigencias */}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
            <CalendarClock className="h-4 w-4 text-primary" /> Vigencias de parámetros legales
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => cargar()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
            <Button size="sm" variant="outline" onClick={nueva}>
              <Plus className="mr-2 h-4 w-4" /> Nueva vigencia
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {vigencias.map((v) => (
            <Button
              key={v.fechaDesde}
              size="sm"
              variant={!esNueva && v.fechaDesde === sel ? "default" : "outline"}
              onClick={() => seleccionar(v)}
              className="tabular-nums"
            >
              {fmtFecha(v.fechaDesde)}
              <span className="ml-1.5 text-[10px] opacity-70">
                {num(v.jornadaHoras)}h · dom {num(v.pctRecargoDominical)}%
              </span>
            </Button>
          ))}
          {esNueva && (
            <span className="inline-flex items-center rounded-md bg-primary/10 px-2 text-xs text-primary">
              Nueva vigencia (sin guardar)
            </span>
          )}
          {!vigencias.length && !loading && (
            <span className="text-xs text-muted-foreground">No hay vigencias. Crea la primera con “Nueva vigencia”.</span>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Rige desde (fecha)</Label>
            <DatePickerField
              className="w-44"
              value={params.fechaDesde}
              disabled={!esNueva}
              onChange={(value) => set("fechaDesde", value)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={guardar} disabled={saving || loading} size="sm">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar vigencia
            </Button>
            {!esNueva && sel && (
              <Button onClick={eliminar} disabled={saving || loading} size="sm" variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" /> Eliminar
              </Button>
            )}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Cada vigencia rige desde su fecha hasta la siguiente. Ej.: una desde el 1-ene (nuevo SMLV) y otra
            desde el 16-jul (nueva jornada/recargo).
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1) Base salarial */}
        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold text-card-foreground">1. Base salarial</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Salario mínimo (SMLV)</Label>
              <Input type="number" value={params.smlv || ""} onChange={(e) => set("smlv", Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Auxilio de transporte</Label>
              <Input
                type="number"
                value={params.auxilio || ""}
                onChange={(e) => set("auxilio", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex items-baseline justify-between rounded-md bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">Base de recargos (salario)</span>
            <span className="text-lg font-bold tabular-nums text-foreground">{money(calc.base)}</span>
          </div>
          <div className="flex items-baseline justify-between px-3 text-xs text-muted-foreground">
            <span>Ingreso total con auxilio (informativo)</span>
            <span className="tabular-nums">{money(calc.ingresoTotal)}</span>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p>
              La base de recargos/horas extra es el <strong>salario</strong>; el auxilio de transporte{" "}
              <strong>no entra en la base</strong>. En producción, para cada persona se usa{" "}
              <strong>su salario de contrato</strong> (<code>headcount.salario</code>); el SMLV es el mínimo legal
              (salario de prueba del preview y fallback).
            </p>
          </div>
          <div className="space-y-1 border-t border-border pt-3">
            <Label className="text-xs text-muted-foreground">% pagado en incapacidad (13/14/15)</Label>
            <Input
              type="number"
              step="0.01"
              value={params.pctPagoIncapacidad ?? ""}
              onChange={(e) => set("pctPagoIncapacidad", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              % del día que LIP reconoce en cualquier incapacidad, sin importar el "50%"/"66%" del nombre de la
              novedad (esa etiqueta es solo la clasificación legal de quién asume el día). Hoy: 100%.
            </p>
          </div>
        </Card>

        {/* 2) Jornada */}
        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold text-card-foreground">2. Parámetros de jornada</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Días calendario</Label>
              <Input
                type="number"
                value={params.diasCalendario || ""}
                onChange={(e) => set("diasCalendario", Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Jornada (horas/día)</Label>
              <Input
                type="number"
                step="0.0001"
                value={params.jornadaHoras || ""}
                onChange={(e) => set("jornadaHoras", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex items-baseline justify-between rounded-md bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              Divisor mensual = {num(params.diasCalendario)} × {params.jornadaHoras}
            </span>
            <span className="text-lg font-bold tabular-nums text-foreground">{num(divisorMensual)} h/mes</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">Valor día (salario ÷ {num(params.diasCalendario)})</p>
              <p className="text-base font-bold tabular-nums text-foreground">{money(calc.valorDia)}</p>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">Hora ordinaria HOD (salario ÷ {num(divisorMensual)})</p>
              <p className="text-base font-bold tabular-nums text-foreground">{money(calc.hod)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* 3) Recargos y horas extra */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-card-foreground">
            3. Recargos y horas extra — % editable · $/hora calculado
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2">Concepto</th>
                <th className="px-4 py-2 w-28">%</th>
                <th className="px-4 py-2">Factor</th>
                <th className="px-4 py-2 text-right">$ / hora</th>
                <th className="px-4 py-2">Columna</th>
              </tr>
            </thead>
            <tbody>
              {RECARGO_ROWS.map((row) => (
                <tr key={row.campo} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 text-foreground">{row.label}</td>
                  <td className="px-4 py-2">
                    <Input
                      type="number"
                      className="h-8 w-24"
                      value={(params[row.campo] as number) || ""}
                      onChange={(e) => set(row.campo, Number(e.target.value))}
                    />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {factorTxt(row.tipo, params[row.campo] as number)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums text-foreground">
                    {money(row.val(calc))}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.col}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-start gap-2 border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            <strong>hedf/hef</strong> (hora extra dominical) y el <strong>recargo nocturno dominical</strong>{" "}
            incluyen el recargo dominical, así que al cambiar el <strong>recargo dominical/festivo</strong>{" "}
            deben ajustarse: hedf = 25 + dominical, hef = 75 + dominical, noct. dom = 35 + dominical.
          </p>
        </div>
      </Card>
    </div>
  )
}
