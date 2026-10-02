"use client"

/**
 * Pestaña ANÁLISIS FINANCIERO del Estado de Resultados — CONFIDENCIAL.
 *
 * Por proyecto: acuerdo de volúmenes (tarifa × volumen mensual mínimo) vs el
 * volumen REAL del período. Si el real queda por debajo, el déficit se
 * valora a tarifa y se muestra como "$ A FACTURAR ADICIONAL" — la señal
 * concreta para gerencia de que hay que facturar algo que impacta positivo
 * el Estado de Resultados. Además: margen real contra nómina, margen por
 * tonelada, punto de equilibrio y proyección al cierre si el período está
 * en curso.
 *
 * Los datos vienen del padre (mismo alcance/período del P&L): esta vista es
 * presentacional + edición ligera de los acuerdos (reajustes anuales).
 *
 * OJO — dos tarifas distintas conviven aquí (no son la misma columna dos veces):
 * "Factura acordada" usa la tarifa del CUADRO de gerencia (lo que se aspira a
 * facturar); "Factura real" y "Margen real" usan la tarifa VIGENTE del sistema
 * (la misma que ya factura el Cierre Financiero/Cuadro de Control), que puede
 * diferir por ajustes de tarifa a mitad de año. El déficit siempre se valora a
 * la tarifa ACORDADA (es lo que hay que facturar para cumplir el mínimo).
 */

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  Pencil,
  Scale,
  ShieldAlert,
  Target,
  TrendingUp,
  Users,
} from "lucide-react"
import { KpiCard } from "@/components/orders/dashboard-pedidos/kpi-card"
import {
  getAcuerdosVolumenes,
  guardarAcuerdoVolumen,
  type AnalisisFinanciero as AnalisisData,
  type ProyectoAnalisis,
} from "@/lib/analisis-financiero-actions"
import { GESTION_LIPGO_DESDE } from "@/lib/facturacion-constantes"

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO")
const moneyS = (n: number) =>
  (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(Number(n) || 0)).toLocaleString("es-CO")
// La tarifa (a diferencia de un total) puede ser fraccionaria de verdad -- ej.
// Huevo $2,95/unidad -- money() la redondeaba a $3.
const moneyTarifa = (n: number) => {
  const v = Number(n) || 0
  return Number.isInteger(v) ? money(v) : "$" + v.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const ton = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 1 })

interface Props {
  data: AnalisisData | null
  isLoading: boolean
  error?: string
  periodoLabel: string
  refrescar: () => void
}

// ---------------------------------------------------------------------------
// Resumen ejecutivo — el titular del período, automático para el alcance y
// el período seleccionados (mes, quincena o año completo).
// ---------------------------------------------------------------------------

function ResumenEjecutivo({ data }: { data: AnalisisData }) {
  const proyectos = data.proyectos
  if (proyectos.length === 0) return null

  const totalAFacturar = proyectos.reduce((s, p) => s + p.totalAFacturarAdicional, 0)
  const tonAcordadas = proyectos.reduce((s, p) => s + p.tonAcordadas, 0)
  const tonReales = proyectos.reduce((s, p) => s + p.tonReales, 0)
  const cumplimiento = tonAcordadas > 0 ? Math.round((tonReales / tonAcordadas) * 100) : null
  const margenTotal = proyectos.reduce((s, p) => s + p.margenReal, 0)

  // Antes de jul-2026 los cuadros de acuerdo apenas se estaban montando: ese
  // déficit YA SE FACTURÓ MANUAL fuera de LIPgo (confirmado por gerencia) — no
  // es una alarma abierta. Desde jul-2026 sí es una acción pendiente real.
  const esHistorico = data.hasta < GESTION_LIPGO_DESDE
  const incluyeHistorico = !esHistorico && data.desde < GESTION_LIPGO_DESDE

  // Los 3 huecos más grandes del período, entre todos los proyectos.
  const huecos = proyectos
    .flatMap((p) => p.actividades.filter((a) => a.deficit > 0).map((a) => ({ ...a, proyecto: p.proyecto })))
    .sort((a, b) => b.aFacturarAdicional - a.aFacturarAdicional)
    .slice(0, 3)

  return (
    <Card
      className={
        esHistorico
          ? "border-muted-foreground/20"
          : totalAFacturar > 0
            ? "border-amber-300 bg-amber-50/40 dark:bg-amber-950/10"
            : "border-emerald-300"
      }
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="lg-eyebrow">
              Resumen ejecutivo del período
            </div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                esHistorico
                  ? "text-muted-foreground"
                  : totalAFacturar > 0
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-emerald-700"
              }`}
            >
              {esHistorico
                ? `${money(totalAFacturar)} ya facturado manual (histórico)`
                : totalAFacturar > 0
                  ? `${money(totalAFacturar)} por facturar adicional`
                  : "Volumen acordado cumplido"}
            </div>
            <div className="text-xs text-muted-foreground">
              Cumplimiento global {cumplimiento !== null ? `${cumplimiento}%` : "—"} ({ton(tonReales)} t de {ton(tonAcordadas)} t
              acordadas) · margen real (tarifa vigente) {moneyS(margenTotal)}
            </div>
            {esHistorico && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Período anterior a jul-2026: los cuadros de acuerdo se estaban montando — este déficit ya se
                  facturó manualmente fuera de LIPgo, no requiere acción.
                </span>
              </div>
            )}
            {incluyeHistorico && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Este total incluye meses anteriores a jul-2026 ya facturados manualmente fuera de LIPgo; desde
                  jul-2026 en adelante es lo que sí queda pendiente por gestionar aquí.
                </span>
              </div>
            )}
          </div>
          {/* Chips por proyecto */}
          <div className="flex flex-wrap gap-2">
            {proyectos.map((p) => (
              <div
                key={p.idempresa}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  p.totalAFacturarAdicional > 0
                    ? "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    : "border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                }`}
                title={`${p.proyecto}: ${ton(p.tonReales)} t de ${ton(p.tonAcordadas)} t`}
              >
                {p.proyecto}: {p.cumplimientoPct !== null ? `${p.cumplimientoPct}%` : "—"}
                {p.totalAFacturarAdicional > 0 && ` · ${money(p.totalAFacturarAdicional)}`}
              </div>
            ))}
          </div>
        </div>

        {huecos.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-background/60 p-2.5 dark:border-amber-900">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Huecos principales del período
            </div>
            <ul className="space-y-0.5 text-xs">
              {huecos.map((h) => (
                <li key={`${h.proyecto}-${h.codigo}`} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-medium">{h.actividad}</span>
                  <span className="text-muted-foreground">({h.proyecto})</span>
                  <span className="text-red-600">
                    {h.cumplimientoPct !== null ? `${h.cumplimientoPct}%` : "—"} · faltan {ton(h.deficit)} t ={" "}
                    <span className="font-semibold">{money(h.aFacturarAdicional)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Tarjeta de un proyecto
// ---------------------------------------------------------------------------

function ProyectoCard({ p, meses, esHistorico }: { p: ProyectoAnalisis; meses: number; esHistorico: boolean }) {
  const [verEstructura, setVerEstructura] = useState(false)
  const [verPersonal, setVerPersonal] = useState(false)
  const deficitTotal = p.totalAFacturarAdicional
  const cumple = deficitTotal <= 0

  return (
    <Card className={esHistorico ? "" : cumple ? "" : "border-amber-300"}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{p.proyecto}</CardTitle>
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              esHistorico
                ? "bg-muted text-muted-foreground"
                : cumple
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            }`}
          >
            {esHistorico ? (
              <History className="h-3.5 w-3.5" />
            ) : cumple ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            {esHistorico
              ? cumple
                ? "Histórico — cumple el volumen acordado"
                : `Histórico — ${money(deficitTotal)} ya facturado manual`
              : cumple
                ? "Cumple el volumen acordado"
                : `${money(deficitTotal)} por facturar al cliente`}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPIs del proyecto */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Cumplimiento de volumen"
            value={p.cumplimientoPct !== null ? `${p.cumplimientoPct}%` : "—"}
            subtext={`${ton(p.tonReales)} t reales de ${ton(p.tonAcordadas)} t acordadas${
              p.proyeccionTon !== null ? ` · proyección: ${ton(p.proyeccionTon)} t` : ""
            }`}
            icon={Target}
            variant={p.cumplimientoPct !== null && p.cumplimientoPct >= 100 ? "success" : "warning"}
          />
          <KpiCard
            label="$ adicional a facturar"
            value={money(deficitTotal)}
            subtext={cumple ? "sin déficit en el período" : "déficit de volumen × tarifa acordada"}
            icon={ShieldAlert}
            variant={cumple ? "success" : "danger"}
          />
          <KpiCard
            label="Margen real (tarifa vigente)"
            value={moneyS(p.margenReal)}
            subtext={`facturado real ${money(p.totalFacturaReal)} − nómina ${money(p.costoNomina)}${
              p.margenPorTon !== null ? ` · ${moneyS(p.margenPorTon)}/t` : ""
            }`}
            icon={TrendingUp}
            variant={p.margenReal < 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Punto de equilibrio"
            value={p.puntoEquilibrioTon !== null ? `${ton(p.puntoEquilibrioTon)} t` : "—"}
            subtext={
              p.puntoEquilibrioTon !== null
                ? p.tonReales >= p.puntoEquilibrioTon
                  ? `superado (${ton(p.tonReales)} t reales)`
                  : `faltan ${ton(p.puntoEquilibrioTon - p.tonReales)} t para cubrir la nómina`
                : "sin tarifas en el acuerdo"
            }
            icon={Scale}
            variant={p.puntoEquilibrioTon !== null && p.tonReales >= p.puntoEquilibrioTon ? "success" : "warning"}
          />
        </div>

        {/* Tabla por actividad */}
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead>Actividad</TableHead>
                <TableHead className="text-right">Tarifa acordada</TableHead>
                <TableHead className="text-right">Acordado{meses !== 1 ? " (período)" : " (mes)"}</TableHead>
                <TableHead className="text-right">Real</TableHead>
                <TableHead className="text-right">Cumpl.</TableHead>
                <TableHead className="text-right">Déficit</TableHead>
                <TableHead className="text-right">$ a facturar adicional</TableHead>
                <TableHead className="text-right" title="Volumen real × tarifa del cuadro de gerencia (aspiracional)">
                  Factura acordada
                </TableHead>
                <TableHead className="text-right" title="Volumen real × tarifa vigente del sistema (lo que hoy factura el Cuadro/Cierre Financiero)">
                  Factura real
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.actividades.map((a) => {
                const enDeficit = a.deficit > 0
                return (
                  <TableRow key={a.codigo} className={enDeficit ? "bg-red-50 dark:bg-red-950/20" : ""}>
                    <TableCell className="text-xs font-medium">{a.actividad}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{moneyTarifa(a.tarifa)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{ton(a.volumenAcordado)} t</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{ton(a.volumenReal)} t</TableCell>
                    <TableCell
                      className={`text-right text-xs font-semibold tabular-nums ${
                        a.cumplimientoPct !== null && a.cumplimientoPct >= 100 ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {a.cumplimientoPct !== null ? `${a.cumplimientoPct}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {enDeficit ? `${ton(a.deficit)} t` : "—"}
                    </TableCell>
                    <TableCell className={`text-right text-xs font-semibold tabular-nums ${enDeficit ? "text-red-600" : "text-muted-foreground"}`}>
                      {enDeficit ? money(a.aFacturarAdicional) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{money(a.facturaAcordada)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{money(a.facturaReal)}</TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="border-t-2 font-semibold">
                <TableCell className="text-xs">TOTAL</TableCell>
                <TableCell />
                <TableCell className="text-right text-xs tabular-nums">{ton(p.tonAcordadas)} t</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{ton(p.tonReales)} t</TableCell>
                <TableCell
                  className={`text-right text-xs tabular-nums ${
                    p.cumplimientoPct !== null && p.cumplimientoPct >= 100 ? "text-emerald-700" : "text-red-600"
                  }`}
                >
                  {p.cumplimientoPct !== null ? `${p.cumplimientoPct}%` : "—"}
                </TableCell>
                <TableCell />
                <TableCell className={`text-right text-xs tabular-nums ${deficitTotal > 0 ? "text-red-600" : ""}`}>
                  {deficitTotal > 0 ? money(deficitTotal) : "—"}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">{money(p.totalFacturaAcordada)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{money(p.totalFacturaReal)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Estructura acordada (informativa) */}
        {p.estructura.length > 0 && (
          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setVerEstructura((v) => !v)}
            >
              {verEstructura ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Estructura de personal acordada
            </button>
            {verEstructura && (
              <div className="mt-2 overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px]">
                      <TableHead>Rol</TableHead>
                      <TableHead className="text-right"># Auxiliares</TableHead>
                      <TableHead>Muelle</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.estructura.map((e, i) => (
                      <TableRow key={`${e.actividad}-${i}`}>
                        <TableCell className="text-xs">{e.actividad}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{e.auxiliares ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.muelle ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Personal activo hoy (real, Head Count) — el equipo es flexible
            ("Auxiliar Mixto") y rota entre cargue/tolva/distribución según la
            tonelada del día, así que NO se compara 1 a 1 contra la estructura
            acordada de arriba: es solo la foto de quién está activo hoy. */}
        {p.personalActivo.length > 0 && (
          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setVerPersonal((v) => !v)}
            >
              {verPersonal ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Users className="h-3.5 w-3.5" />
              Personal activo hoy ({p.totalPersonalActivo})
            </button>
            {verPersonal && (
              <div className="mt-2 overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px]">
                      <TableHead>Cargo</TableHead>
                      <TableHead className="text-right">Activos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.personalActivo.map((f, i) => (
                      <TableRow key={`${f.cargo}-${i}`}>
                        <TableCell className="text-xs">{f.cargo}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{f.cantidad}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell className="text-xs font-semibold">Total</TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">{p.totalPersonalActivo}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {p.notas.length > 0 && (
          <ul className="space-y-0.5 text-[11px] text-muted-foreground">
            {p.notas.map((n, i) => (
              <li key={i}>· {n}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Edición de acuerdos (reajustes anuales)
// ---------------------------------------------------------------------------

interface AcuerdoRow {
  id: number
  idempresa: number
  actividad: string
  actividad_codigo: string | null
  auxiliares: number | null
  muelle: string | null
  tarifa: number | null
  volumen_acordado: number | null
  fechainicio: string
  fechafin: string
}

function EditorAcuerdos({ onCambio }: { onCambio: () => void }) {
  const { toast } = useToast()
  const [abierto, setAbierto] = useState(false)
  const [filas, setFilas] = useState<AcuerdoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editando, setEditando] = useState<AcuerdoRow | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const r = await getAcuerdosVolumenes()
    if (r.success) setFilas(r.data)
    else toast({ title: "Error", description: r.message, variant: "destructive" })
    setLoading(false)
  }, [toast])

  useEffect(() => {
    if (abierto) cargar()
  }, [abierto, cargar])

  const guardar = async () => {
    if (!editando) return
    setGuardando(true)
    const r = await guardarAcuerdoVolumen({ ...editando, id: editando.id || undefined })
    setGuardando(false)
    if (r.success) {
      toast({ title: "Acuerdo guardado" })
      setEditando(null)
      cargar()
      onCambio()
    } else {
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAbierto(true)}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar acuerdos
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-auto">
          <DialogHeader>
            <DialogTitle>Acuerdos de volúmenes (confidencial)</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>ID</TableHead>
                    <TableHead>Actividad</TableHead>
                    <TableHead className="text-right">Tarifa</TableHead>
                    <TableHead className="text-right">Vol/mes</TableHead>
                    <TableHead>Vigencia</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs">{f.idempresa}</TableCell>
                      <TableCell className="text-xs">{f.actividad}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{f.tarifa !== null ? moneyTarifa(f.tarifa) : "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {f.volumen_acordado !== null ? ton(f.volumen_acordado) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {f.fechainicio} → {f.fechafin}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => setEditando(f)}>
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editando} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar acuerdo</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Actividad</Label>
                <Input value={editando.actividad} onChange={(e) => setEditando({ ...editando, actividad: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Tarifa</Label>
                  <Input
                    type="number"
                    value={editando.tarifa ?? ""}
                    onChange={(e) => setEditando({ ...editando, tarifa: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Volumen acordado (t/mes)</Label>
                  <Input
                    type="number"
                    value={editando.volumen_acordado ?? ""}
                    onChange={(e) =>
                      setEditando({ ...editando, volumen_acordado: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Vigente desde</Label>
                  <DatePickerField value={editando.fechainicio} onChange={(value) => setEditando({ ...editando, fechainicio: value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Vigente hasta</Label>
                  <DatePickerField value={editando.fechafin} onChange={(value) => setEditando({ ...editando, fechafin: value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={guardando}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Contenedor de la pestaña
// ---------------------------------------------------------------------------

export default function AnalisisFinanciero({ data, isLoading, error, periodoLabel, refrescar }: Props) {
  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-red-600">{error}</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Acuerdo de volúmenes vs volumen real del período <span className="font-medium text-foreground">{periodoLabel}</span>.
          Se paga fijo por turno y se cobra por tonelada: si el volumen no se cumple,{" "}
          <span className="font-medium text-foreground">el faltante se factura al cliente</span> — si no, se pierde dinero.
        </p>
        <EditorAcuerdos onCambio={refrescar} />
      </div>

      {(data?.proyectos ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay acuerdos de volúmenes configurados para este alcance.
            <br />
            Corre <code className="text-xs">scripts/113_create_acuerdo_volumenes.sql</code> para cargar los cuadros por proyecto.
          </CardContent>
        </Card>
      ) : (
        <>
          {data && <ResumenEjecutivo data={data} />}
          {(data?.proyectos ?? []).map((p) => (
            <ProyectoCard
              key={p.idempresa}
              p={p}
              meses={data?.meses ?? 1}
              esHistorico={!!data && data.hasta < GESTION_LIPGO_DESDE}
            />
          ))}
        </>
      )}
    </div>
  )
}
