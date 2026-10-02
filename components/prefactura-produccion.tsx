"use client"

// Gestión Financiera › Facturación › Prefactura de Producción.
//
// Emite el documento cobrable de lo que se factura por PRODUCCIÓN:
//   · Avimol  — Salvado y Estibado PT por tonelaje (con festivos) + horas extra.
//   · Indupan — órdenes de Tolva / Tolva f.
//
// El mismo componente se monta en dos sitios: como módulo propio con selector de
// proyecto, y embebido como pestaña dentro de Conciliación Avimol (ahí llega con
// `idempresaFija={2}` y el selector se oculta). Por eso el proyecto es una prop
// opcional en vez de estado interno.
//
// Ciclo: generar → marcar qué facturar → guardar borrador → aprobar. Un
// borrador se puede eliminar; una aprobada no (ya se le pasó al cliente).

import { useCallback, useEffect, useMemo, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle, Check, Download, FileText, Loader2, RotateCcw, Save, Trash2 } from "lucide-react"
import {
  getPrefacturaProduccion,
  guardarPrefacturaProduccion,
  listarPrefacturasProduccion,
  aprobarPrefacturaProduccion,
  reabrirPrefacturaProduccion,
  eliminarPrefacturaProduccion,
  type PrefacturaProduccionData,
  type PrefacturaProduccionGuardada,
  type LineaResumen,
  type SoporteProduccion,
} from "@/lib/prefactura-produccion-actions"
import { PROYECTOS_PRODUCCION } from "@/lib/prefactura-produccion-constants"

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO")
// La tarifa (a diferencia del Total) puede ser fraccionaria de verdad -- ej.
// Huevo $2,95/unidad -- money() la redondeaba a $3 y ocultaba el decimal real.
const moneyTarifa = (n: number) => {
  const v = Number(n) || 0
  return Number.isInteger(v) ? money(v) : "$" + v.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const cant = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 })
// Separado de cant() a propósito: toneladas siempre a 3 decimales (mismo
// criterio que el anexo de facturación); cant() sigue en 2 para cantidades
// por unidad (bultos, kg, Huevos) que no deben ganar decimales de más.
const ton = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { minimumFractionDigits: 3, maximumFractionDigits: 3 })

/** Hoy en Colombia (el servidor puede estar en otra zona). */
function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
}

const TITULO_ALERTA: Record<string, string> = {
  lote_invalido: "Ingresos con lote inválido (no se facturan)",
  sin_tarifa: "Sin tarifa vigente — se cobra $0",
  sin_liquidar: "Turnos sin liquidar en nómina",
  sin_solicitud: "Horas extra sin solicitud aprobada",
  sin_tarifa_he: "Horas extra sin tarifa vigente — se cobran $0",
  exceso_solicitud: "Se ejecutaron más horas de las solicitadas",
}

/** Tope de filas del anexo en pantalla: el soporte de un mes puede ser enorme. */
const TOPE_SOPORTE = 400

export default function PrefacturaProduccion({ idempresaFija }: { idempresaFija?: number }) {
  const { toast } = useToast()
  const hoy = hoyISO()

  const [idempresa, setIdempresa] = useState<number>(idempresaFija ?? 2)
  const [desde, setDesde] = useState(hoy.slice(0, 8) + "01")
  const [hasta, setHasta] = useState(hoy)
  const [data, setData] = useState<PrefacturaProduccionData | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [observacion, setObservacion] = useState("")
  const [loading, setLoading] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardadas, setGuardadas] = useState<PrefacturaProduccionGuardada[]>([])
  const [verSoporte, setVerSoporte] = useState<number | null>(null)
  const [confirmar, setConfirmar] = useState<
    { accion: "aprobar" | "eliminar" | "solape"; id?: number; texto: string } | null
  >(null)

  const empresa = idempresaFija ?? idempresa
  const esAvimol = empresa === 2

  const cargarGuardadas = useCallback(async () => {
    const r = await listarPrefacturasProduccion(empresa)
    if (r.success) setGuardadas(r.data)
  }, [empresa])

  useEffect(() => {
    cargarGuardadas()
  }, [cargarGuardadas])

  // Al cambiar de proyecto el documento anterior deja de tener sentido.
  useEffect(() => {
    setData(null)
    setSel(new Set())
  }, [empresa])

  const generar = useCallback(async () => {
    setLoading(true)
    setError(null)
    const r = await getPrefacturaProduccion(empresa, desde, hasta)
    setLoading(false)
    if (r.success && r.data) {
      setData(r.data)
      // Arranca con TODO marcado: lo normal es facturar el período completo.
      setSel(new Set([...r.data.produccion, ...r.data.horasExtra].map((l) => `${l.tipo}|${l.concepto}`)))
    } else {
      setData(null)
      setSel(new Set())
      setError(r.message || "No se pudo armar la prefactura.")
      toast({ title: "No se pudo generar", description: r.message, variant: "destructive" })
    }
  }, [empresa, desde, hasta, toast])

  const todasLineas = useMemo(() => (data ? [...data.produccion, ...data.horasExtra] : []), [data])
  const keyDe = (l: LineaResumen) => `${l.tipo}|${l.concepto}`
  const seleccionadas = useMemo(() => todasLineas.filter((l) => sel.has(keyDe(l))), [todasLineas, sel])

  const totalSel = seleccionadas.reduce((a, l) => a + l.total, 0)
  const tonSel = seleccionadas.filter((l) => l.unidad === "t").reduce((a, l) => a + l.cantidad, 0)
  const prodSel = seleccionadas.filter((l) => l.tipo === "produccion")
  const heSel = seleccionadas.filter((l) => l.tipo === "hora_extra")

  /** El soporte sigue a la selección: si no se cobra el concepto, su detalle no
   *  debe ir en el anexo. */
  const soporteSel = useMemo(() => {
    if (!data) return [] as SoporteProduccion[]
    const conceptos = new Set(
      seleccionadas.map((l) => (l.tipo === "hora_extra" ? `Hora extra · ${l.concepto}` : l.concepto)),
    )
    return data.soporte.filter((s) => conceptos.has(s.concepto) && s.valor > 0)
  }, [data, seleccionadas])

  const guardar = useCallback(
    async (confirmarSolape: boolean) => {
      if (!data || seleccionadas.length === 0) {
        toast({ title: "Nada que guardar", description: "Marca al menos un concepto.", variant: "destructive" })
        return
      }
      setGuardando(true)
      const r = await guardarPrefacturaProduccion({
        idempresa: empresa,
        proyecto: data.proyecto,
        periodo_desde: desde,
        periodo_hasta: hasta,
        lineas: seleccionadas,
        soporte: soporteSel,
        total: totalSel,
        toneladas: Number(tonSel.toFixed(3)),
        observacion: observacion.trim() || null,
        confirmarSolape,
      })
      setGuardando(false)
      if (r.success) {
        toast({ title: `Prefactura #${r.id} generada`, description: "Ya arrancó el Ciclo de Facturación." })
        setObservacion("")
        cargarGuardadas()
      } else if (!confirmarSolape && r.message?.includes("APROBADA")) {
        // El servidor detectó solape: se le muestra al usuario y decide.
        setConfirmar({ accion: "solape", texto: r.message })
      } else {
        toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      }
    },
    [data, seleccionadas, soporteSel, empresa, desde, hasta, totalSel, tonSel, observacion, toast, cargarGuardadas],
  )

  const accionGuardada = async (fn: () => Promise<{ success: boolean; message?: string }>, ok: string) => {
    const r = await fn()
    if (r.success) {
      toast({ title: ok })
      cargarGuardadas()
    } else {
      toast({ title: "No se pudo completar", description: r.message, variant: "destructive" })
    }
  }

  // Reabrir bloqueado por avance del Ciclo de Facturación: se ofrece forzar
  // con una confirmación aparte, en vez de dejar la acción muerta.
  const reabrirConConfirmacion = async (id: number) => {
    const r = await reabrirPrefacturaProduccion(id)
    if (r.success) {
      toast({ title: "Prefactura reabierta" })
      cargarGuardadas()
    } else if (r.message?.includes("Ciclo de Facturación") && window.confirm(`${r.message}\n\n¿Forzar de todas formas?`)) {
      await accionGuardada(() => reabrirPrefacturaProduccion(id, true), "Prefactura reabierta")
    } else {
      toast({ title: "No se pudo completar", description: r.message, variant: "destructive" })
    }
  }

  const exportarExcel = async () => {
    const XLSX = await import("xlsx")
    if (!data || seleccionadas.length === 0) return
    const wb = XLSX.utils.book_new()
    const cab: any[][] = [
      ["PREFACTURA DE PRODUCCIÓN"],
      ["Proyecto", data.proyecto],
      ["Período", `${desde} a ${hasta}`],
      [],
      ["Concepto", "Cantidad", "Unidad", "Tarifa", "Total"],
    ]
    if (prodSel.length) {
      cab.push(["PRODUCCIÓN"])
      for (const l of prodSel) cab.push([l.concepto, l.cantidad, l.unidad, l.tarifa, l.total])
      cab.push(["Subtotal producción", "", "", "", prodSel.reduce((a, l) => a + l.total, 0)])
    }
    if (heSel.length) {
      cab.push([])
      cab.push(["HORAS EXTRA"])
      for (const l of heSel) cab.push([l.concepto, l.cantidad, l.unidad, l.tarifa, l.total])
      cab.push(["Subtotal horas extra", "", "", "", heSel.reduce((a, l) => a + l.total, 0)])
    }
    cab.push([])
    cab.push(["TOTAL", "", "", "", totalSel])
    const ws = XLSX.utils.aoa_to_sheet(cab)
    ws["!cols"] = [{ wch: 34 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, ws, "PREFACTURA")

    const wsSop = XLSX.utils.json_to_sheet(
      soporteSel.map((s) => ({
        Fecha: s.fecha,
        Lote: s.lote ?? "",
        Concepto: s.concepto,
        Detalle: s.detalle,
        Orden: s.referencia ?? "",
        Bultos: s.bultos ?? "",
        Kg: s.kg ?? "",
        Cantidad: s.cantidad,
        Unidad: s.unidad,
        Tarifa: s.tarifa,
        Valor: s.valor,
      })),
    )
    XLSX.utils.book_append_sheet(wb, wsSop, "SOPORTE")
    XLSX.writeFile(wb, `Prefactura_${data.proyecto}_${desde}_a_${hasta}.xlsx`.replace(/[\\/?*[\]:]/g, ""))
  }

  const alertasPorTipo = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const a of data?.alertas || []) {
      if (!m.has(a.tipo)) m.set(a.tipo, [])
      m.get(a.tipo)!.push(a.detalle)
    }
    return Array.from(m.entries())
  }, [data])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Prefactura de Producción</h1>
          <p className="text-sm text-muted-foreground">
            Lo que se cobra por producción: Salvado y Estibado PT en Avimol, Tolva en Indupan. Base antes de IVA y
            retenciones.
          </p>
        </div>
      </div>

      <Tabs defaultValue="generar" className="w-full">
        <TabsList>
          <TabsTrigger value="generar">Generar prefactura</TabsTrigger>
          <TabsTrigger value="guardadas">Guardadas ({guardadas.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="generar" className="mt-4 space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          {!idempresaFija && (
            <div className="space-y-1">
              <Label>Proyecto</Label>
              <Select value={String(idempresa)} onValueChange={(v) => setIdempresa(Number(v))}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROYECTOS_PRODUCCION.map((p) => (
                    <SelectItem key={p.idempresa} value={String(p.idempresa)}>
                      {p.nombre} (id {p.idempresa})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label>Desde</Label>
            <DatePickerField value={desde} onChange={setDesde} className="w-[160px]" />
          </div>
          <div className="space-y-1">
            <Label>Hasta</Label>
            <DatePickerField value={hasta} onChange={setHasta} className="w-[160px]" />
          </div>
          <Button onClick={generar} disabled={loading} className="min-w-[150px]">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            {data ? "Actualizar" : "Generar"}
          </Button>
          <Button variant="outline" onClick={() => guardar(false)} disabled={guardando || seleccionadas.length === 0}>
            {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar borrador
          </Button>
          <Button variant="outline" onClick={exportarExcel} disabled={seleccionadas.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Excel
          </Button>
          {idempresaFija && <Badge variant="secondary">Proyecto: Avimol (id 2)</Badge>}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2 py-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="font-medium text-destructive">No se pudo armar la prefactura</div>
              <div className="mt-1 text-muted-foreground">{error}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Solape con una prefactura ya aprobada */}
          {data.solapes.length > 0 && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="flex items-start gap-2 py-5 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <div className="font-semibold text-destructive">
                    Este período ya tiene {data.solapes.length} prefactura(s) APROBADA(S)
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {data.solapes.map((s) => `#${s.id} (${s.periodo}, ${money(s.total)})`).join(" · ")}. Emitir otra
                    cobraría dos veces lo mismo.
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Toneladas" value={ton(tonSel)} hint="de los conceptos marcados" />
            <Kpi label="Subtotal producción" value={money(prodSel.reduce((a, l) => a + l.total, 0))} />
            <Kpi
              label="Subtotal horas extra"
              value={money(heSel.reduce((a, l) => a + l.total, 0))}
              hint={esAvimol ? undefined : "no aplica en este proyecto"}
            />
            <Kpi label="Total a facturar" value={money(totalSel)} destacado />
          </div>

          {/* Alertas heredadas de la conciliación */}
          {alertasPorTipo.map(([tipo, items]) => (
            <Card key={tipo} className="border-amber-500/40 bg-amber-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-amber-700 dark:text-amber-400">
                  {TITULO_ALERTA[tipo] || tipo} — {items.length}
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-40 overflow-y-auto">
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {items.slice(0, 50).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                  {items.length > 50 && <li>… y {items.length - 50} más</li>}
                </ul>
              </CardContent>
            </Card>
          ))}

          {/* Qué facturar */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  ¿Qué facturar? ({seleccionadas.length}/{todasLineas.length} conceptos)
                </CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSel(new Set(todasLineas.map(keyDe)))}>
                    Todo
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
                    Nada
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {todasLineas.map((l) => {
                  const k = keyDe(l)
                  return (
                    <label
                      key={k}
                      className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={sel.has(k)}
                        onCheckedChange={(c) =>
                          setSel((prev) => {
                            const n = new Set(prev)
                            if (c) n.add(k)
                            else n.delete(k)
                            return n
                          })
                        }
                      />
                      <span className={`h-2 w-2 shrink-0 rounded-full ${l.sinTarifa ? "bg-rose-500" : "bg-emerald-500"}`} />
                      <span className="flex-1 truncate">
                        {l.tipo === "hora_extra" ? `H. extra · ${l.concepto}` : l.concepto}
                      </span>
                      <span className="tabular-nums text-xs text-muted-foreground">{money(l.total)}</span>
                    </label>
                  )
                })}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Observación (opcional)</Label>
                <Input
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  placeholder="Nota que queda guardada con la prefactura…"
                />
              </div>
            </CardContent>
          </Card>

          {/* Documento */}
          {seleccionadas.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Marca al menos un concepto arriba para armar la prefactura.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {data.proyecto} · {desde} a {hasta}
                  </CardTitle>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Total a facturar</div>
                    <div className="lg-num text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {money(totalSel)}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 overflow-x-auto">
                {prodSel.length > 0 && (
                  <BloqueLineas titulo="Producción" lineas={prodSel} unidadLabel="Toneladas" />
                )}
                {heSel.length > 0 && <BloqueLineas titulo="Horas extra" lineas={heSel} unidadLabel="Horas" />}
                <div className="flex items-center justify-between border-t-2 border-primary/40 pt-3">
                  <span className="text-sm font-bold">TOTAL PREFACTURA</span>
                  <span className="text-lg font-extrabold tabular-nums text-primary">{money(totalSel)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Valor base, antes de IVA y retenciones — esos los suma Siigo al emitir la factura.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Soporte */}
          {soporteSel.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Soporte / anexo — {soporteSel.length} líneas</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <TablaSoporte lineas={soporteSel} />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!data && !error && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Elige el período y genera la prefactura.
          </CardContent>
        </Card>
      )}
        </TabsContent>

        <TabsContent value="guardadas" className="mt-4 space-y-4">
      {/* Prefacturas guardadas */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Prefacturas guardadas — {guardadas.length}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Toneladas</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Guardó</TableHead>
                <TableHead>Aprobó</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {guardadas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-20 text-center text-sm text-muted-foreground">
                    Todavía no hay prefacturas de producción guardadas.
                  </TableCell>
                </TableRow>
              ) : (
                guardadas.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>#{p.id}</TableCell>
                    <TableCell>{p.proyecto || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {String(p.periodo_desde).slice(0, 10)} a {String(p.periodo_hasta).slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-right">{ton(p.toneladas)}</TableCell>
                    <TableCell className="text-right font-medium">{money(p.total)}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          p.estado === "aprobada"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {p.estado}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.usuario || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.aprobado_por || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2"
                          onClick={() => setVerSoporte(verSoporte === p.id ? null : p.id)}
                        >
                          <FileText className="h-3 w-3" /> Soporte
                        </Button>
                        {p.estado === "borrador" ? (
                          <>
                            <Button
                              size="sm"
                              className="h-7 gap-1 px-2"
                              onClick={() =>
                                setConfirmar({
                                  accion: "aprobar",
                                  id: p.id,
                                  texto: `Vas a aprobar la prefactura #${p.id} por ${money(p.total)}. Una vez aprobada ya no se puede eliminar.`,
                                })
                              }
                            >
                              <Check className="h-3 w-3" /> Aprobar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive"
                              title="Eliminar"
                              onClick={() =>
                                setConfirmar({
                                  accion: "eliminar",
                                  id: p.id,
                                  texto: `Se eliminará la prefactura #${p.id} por ${money(p.total)}. Esta acción no se puede deshacer.`,
                                })
                              }
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2"
                            onClick={() => reabrirConConfirmacion(p.id)}
                          >
                            Reabrir
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {verSoporte != null && (
            <div className="mt-3 rounded-md border p-3">
              {(() => {
                const p = guardadas.find((x) => x.id === verSoporte)
                if (!p) return null
                if (!p.soporte?.length)
                  return <div className="py-4 text-center text-xs text-muted-foreground">Sin soporte guardado.</div>
                return <TablaSoporte lineas={p.soporte} />
              })()}
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmaciones */}
      <AlertDialog open={confirmar != null} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar?.accion === "aprobar"
                ? "Aprobar prefactura"
                : confirmar?.accion === "eliminar"
                  ? "Eliminar prefactura"
                  : "Este período ya se facturó"}
            </AlertDialogTitle>
            <AlertDialogDescription>{confirmar?.texto}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const c = confirmar
                setConfirmar(null)
                if (!c) return
                if (c.accion === "aprobar" && c.id)
                  accionGuardada(() => aprobarPrefacturaProduccion(c.id!), "Prefactura aprobada")
                else if (c.accion === "eliminar" && c.id)
                  accionGuardada(() => eliminarPrefacturaProduccion(c.id!), "Prefactura eliminada")
                else if (c.accion === "solape") guardar(true)
              }}
            >
              {confirmar?.accion === "solape" ? "Guardar de todas formas" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function BloqueLineas({
  titulo,
  lineas,
  unidadLabel,
}: {
  titulo: string
  lineas: LineaResumen[]
  unidadLabel: string
}) {
  const subtotal = lineas.reduce((a, l) => a + l.total, 0)
  return (
    <div>
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{titulo}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Concepto</TableHead>
            <TableHead className="text-right">{unidadLabel}</TableHead>
            <TableHead className="text-right">Tarifa</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          {lineas.map((l) => (
            <TableRow key={`${l.tipo}|${l.concepto}`} className={l.sinTarifa ? "bg-destructive/5" : ""}>
              <TableCell>
                {l.concepto}
                {l.sinTarifa && (
                  <span className="ml-2 text-xs font-medium text-destructive">sin tarifa vigente</span>
                )}
              </TableCell>
              <TableCell className="text-right">{cant(l.cantidad)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{moneyTarifa(l.tarifa)}</TableCell>
              <TableCell className="text-right font-medium">{money(l.total)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t bg-muted/30 font-semibold">
            <TableCell colSpan={3}>Subtotal {titulo.toLowerCase()}</TableCell>
            <TableCell className="text-right">{money(subtotal)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

function TablaSoporte({ lineas }: { lineas: SoporteProduccion[] }) {
  const mostradas = lineas.slice(0, TOPE_SOPORTE)
  const totalVal = lineas.reduce((a, l) => a + l.valor, 0)
  return (
    <>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-muted-foreground">
            <th className="py-1 pl-2 font-medium">Fecha</th>
            <th className="py-1 font-medium">Lote</th>
            <th className="py-1 font-medium">Concepto</th>
            <th className="py-1 font-medium">Detalle</th>
            <th className="py-1 text-right font-medium">Bultos</th>
            <th className="py-1 text-right font-medium">Kg</th>
            <th className="py-1 text-right font-medium">Cant.</th>
            <th className="py-1 text-right font-medium">Tarifa</th>
            <th className="py-1 pr-2 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {mostradas.map((l, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-1 pl-2">{l.fecha}</td>
              <td className="py-1">{l.lote ?? "—"}</td>
              <td className="py-1">{l.concepto}</td>
              <td className="py-1">{l.detalle}</td>
              <td className="py-1 text-right">{l.bultos != null ? cant(l.bultos) : "—"}</td>
              <td className="py-1 text-right">{l.kg != null ? cant(l.kg) : "—"}</td>
              <td className="py-1 text-right">
                {cant(l.cantidad)} {l.unidad}
              </td>
              <td className="py-1 text-right text-muted-foreground">{moneyTarifa(l.tarifa)}</td>
              <td className="py-1 pr-2 text-right">{money(l.valor)}</td>
            </tr>
          ))}
          <tr className="border-t-2 font-semibold">
            <td className="py-1 pl-2" colSpan={8}>
              TOTAL SOPORTE
            </td>
            <td className="py-1 pr-2 text-right">{money(totalVal)}</td>
          </tr>
        </tbody>
      </table>
      {lineas.length > TOPE_SOPORTE && (
        <p className="mt-2 text-xs text-muted-foreground">
          Mostrando {TOPE_SOPORTE} de {lineas.length} líneas. El Excel las trae todas.
        </p>
      )}
    </>
  )
}

function Kpi({
  label,
  value,
  hint,
  destacado,
}: {
  label: string
  value: string
  hint?: string
  destacado?: boolean
}) {
  return (
    <Card className={destacado ? "border-primary/40" : ""}>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${destacado ? "text-primary" : ""}`}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}
